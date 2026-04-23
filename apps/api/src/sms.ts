import twilio from 'twilio';
import { isPlausiblePhone, toE164 } from '@vas/shared';

type SmsLogger = {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
};

export type SmsSendResult =
  | { ok: true; to: string; sid: string | null }
  | { ok: false; error: string; to?: string };

const APP_URL = process.env.APP_URL ?? 'https://phonbot.de';
const SMS_TIMEOUT_MS = Number(process.env.SMS_SEND_TIMEOUT_MS ?? 8000);

let twilioClient: ReturnType<typeof twilio> | null = null;

function allowedPrefixes(): string[] {
  return (process.env.ALLOWED_PHONE_PREFIXES ?? '+49,+43,+41')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

function smsFromNumber(): string {
  return process.env.TWILIO_SMS_FROM_NUMBER?.trim()
    || process.env.TWILIO_FROM_NUMBER?.trim()
    || '';
}

function messagingServiceSid(): string {
  return process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() ?? '';
}

function getTwilioClient(): ReturnType<typeof twilio> | null {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) return null;
  twilioClient ??= twilio(sid, token);
  return twilioClient;
}

export function isSmsConfigured(): boolean {
  return !!getTwilioClient() && (!!smsFromNumber() || !!messagingServiceSid());
}

export function normalizeSmsRecipient(input: string | null | undefined): string | null {
  if (!input) return null;
  const e164 = toE164(input);
  if (!e164 || !isPlausiblePhone(e164)) return null;
  if (!allowedPrefixes().some((prefix) => e164.startsWith(prefix))) return null;
  return e164;
}

function compact(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function trimBody(body: string): string {
  const normalized = compact(body);
  return normalized.length > 600 ? `${normalized.slice(0, 597)}...` : normalized;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('SMS_SEND_TIMEOUT')), SMS_TIMEOUT_MS);
    }),
  ]);
}

export async function sendSms(opts: {
  to: string | null | undefined;
  body: string;
  kind: string;
  logger?: SmsLogger;
}): Promise<SmsSendResult> {
  const to = normalizeSmsRecipient(opts.to);
  if (!to) return { ok: false, error: 'INVALID_SMS_RECIPIENT' };

  const client = getTwilioClient();
  const from = smsFromNumber();
  const messagingSid = messagingServiceSid();
  if (!client || (!from && !messagingSid)) return { ok: false, error: 'SMS_NOT_CONFIGURED', to };

  const body = trimBody(opts.body);
  if (!body) return { ok: false, error: 'EMPTY_SMS_BODY', to };

  try {
    const message = await withTimeout(client.messages.create({
      to,
      body,
      ...(messagingSid ? { messagingServiceSid: messagingSid } : { from }),
    }));
    opts.logger?.info?.({ to, kind: opts.kind, sid: message.sid }, 'sms sent');
    return { ok: true, to, sid: message.sid ?? null };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    opts.logger?.warn?.({ to, kind: opts.kind, err: error }, 'sms send failed');
    return { ok: false, error, to };
  }
}

export function signupLinkUrl(): string {
  return `${APP_URL}/login`;
}

export async function sendSignupLinkSms(opts: {
  to: string | null | undefined;
  name?: string | null;
  logger?: SmsLogger;
}): Promise<SmsSendResult> {
  const greeting = compact(opts.name) ? `Hi ${compact(opts.name)}, ` : '';
  return sendSms({
    to: opts.to,
    kind: 'signup_link',
    body: `${greeting}dein Phonbot-Testlink: ${signupLinkUrl()}`,
    logger: opts.logger,
  });
}

export async function sendBookingConfirmationSms(opts: {
  to: string | null | undefined;
  businessName?: string | null;
  customerName?: string | null;
  service?: string | null;
  preferredTime?: string | null;
  logger?: SmsLogger;
}): Promise<SmsSendResult> {
  const business = compact(opts.businessName);
  const service = compact(opts.service) || 'Termin';
  const time = compact(opts.preferredTime);
  const prefix = business ? `${business}: ` : '';
  const details = time ? `${service}, ${time}` : service;
  return sendSms({
    to: opts.to,
    kind: 'booking_confirmation',
    body: `${prefix}Termin bestaetigt: ${details}.`,
    logger: opts.logger,
  });
}

export async function sendTicketAckSms(opts: {
  to: string | null | undefined;
  businessName?: string | null;
  reason?: string | null;
  service?: string | null;
  logger?: SmsLogger;
}): Promise<SmsSendResult> {
  const business = compact(opts.businessName);
  const subject = compact(opts.service) || compact(opts.reason) || 'Ihre Anfrage';
  const prefix = business ? `${business}: ` : '';
  return sendSms({
    to: opts.to,
    kind: 'ticket_ack',
    body: `${prefix}${subject} wurde aufgenommen. Wir melden uns schnellstmoeglich.`,
    logger: opts.logger,
  });
}
