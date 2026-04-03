import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const FROM_EMAIL = process.env.EMAIL_FROM ?? 'Voice Agent <noreply@voiceagent.app>';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export async function sendTicketNotification(opts: {
  toEmail: string;
  orgName: string;
  customerName: string | null;
  customerPhone: string;
  reason: string | null;
  service: string | null;
}) {
  if (!resend) {
    // Resend not configured — skip silently (logged at startup)
    return;
  }

  const subject = `Neues Ticket: ${opts.customerName ?? opts.customerPhone}`;
  const text = [
    `Neues Ticket für ${opts.orgName}`,
    '',
    `Kunde: ${opts.customerName ?? '—'}`,
    `Telefon: ${opts.customerPhone}`,
    opts.reason ? `Grund: ${opts.reason}` : null,
    opts.service ? `Service: ${opts.service}` : null,
    '',
    'Öffne dein Dashboard um das Ticket zu bearbeiten.',
  ]
    .filter(Boolean)
    .join('\n');

  const safeCustomerName = opts.customerName ? escapeHtml(opts.customerName) : '—';
  const safeCustomerPhone = escapeHtml(opts.customerPhone);
  const safeReason = opts.reason ? escapeHtml(opts.reason) : null;
  const safeService = opts.service ? escapeHtml(opts.service) : null;
  const safeOrgName = escapeHtml(opts.orgName);
  const safeAppUrl = escapeHtml(process.env.APP_URL ?? 'http://localhost:5173');

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #1f2937;">Neues Ticket</h2>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 6px 0; color: #6b7280; width: 100px;">Kunde</td><td style="padding: 6px 0; font-weight: 600;">${safeCustomerName}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b7280;">Telefon</td><td style="padding: 6px 0;"><a href="tel:${safeCustomerPhone}" style="color: #4f46e5;">${safeCustomerPhone}</a></td></tr>
        ${safeReason ? `<tr><td style="padding: 6px 0; color: #6b7280;">Grund</td><td style="padding: 6px 0;">${safeReason}</td></tr>` : ''}
        ${safeService ? `<tr><td style="padding: 6px 0; color: #6b7280;">Service</td><td style="padding: 6px 0;">${safeService}</td></tr>` : ''}
      </table>
      <a href="${safeAppUrl}/tickets"
         style="display: inline-block; background: #4f46e5; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 14px;">
        Ticket öffnen →
      </a>
      <p style="margin-top: 24px; font-size: 12px; color: #9ca3af;">
        ${safeOrgName} · Voice Agent Dashboard
      </p>
    </div>
  `;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: opts.toEmail,
      subject,
      text,
      html,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Use console.error here since we may not have app logger in scope
    // Callers catch and ignore this — the error is surfaced via the thrown/logged path
    process.stderr.write(`[email] Failed to send ticket notification: ${msg}\n`);
  }
}

export async function sendPasswordResetEmail(opts: {
  toEmail: string;
  resetUrl: string;
}) {
  if (!resend) {
    return;
  }

  const subject = 'Passwort zurücksetzen';
  const text = `Klicke auf den folgenden Link um dein Passwort zurückzusetzen:\n\n${opts.resetUrl}\n\nDer Link ist 1 Stunde gültig.`;
  const safeResetUrl = escapeHtml(opts.resetUrl);
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #1f2937;">Passwort zurücksetzen</h2>
      <p style="color: #4b5563;">Klicke auf den Button um dein Passwort zurückzusetzen.</p>
      <a href="${safeResetUrl}"
         style="display: inline-block; background: #4f46e5; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; margin: 16px 0;">
        Passwort zurücksetzen →
      </a>
      <p style="margin-top: 24px; font-size: 12px; color: #9ca3af;">
        Der Link ist 1 Stunde gültig. Falls du diese E-Mail nicht angefordert hast, ignoriere sie.
      </p>
    </div>
  `;

  try {
    await resend.emails.send({ from: FROM_EMAIL, to: opts.toEmail, subject, text, html });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[email] Failed to send password reset email: ${msg}\n`);
  }
}

export async function sendPhoneNumberActiveEmail(opts: {
  toEmail: string;
  orgName: string;
  phoneNumber: string;
  phoneNumberPretty: string;
  city: string;
}) {
  if (!resend) return;

  const subject = `Deine Telefonnummer ist aktiv: ${opts.phoneNumberPretty}`;
  const text = [
    `Gute Nachrichten, ${opts.orgName}!`,
    '',
    `Deine neue Telefonnummer ${opts.phoneNumberPretty} (${opts.city}) ist jetzt aktiv.`,
    'Dein KI-Agent nimmt ab sofort Anrufe entgegen.',
    '',
    'Du kannst die Nummer jetzt testen — ruf sie einfach an!',
    '',
    `Öffne dein Dashboard: ${process.env.APP_URL ?? 'https://phonbot.de'}`,
  ].join('\n');

  const safeOrgName = escapeHtml(opts.orgName);
  const safeNumber = escapeHtml(opts.phoneNumberPretty);
  const safeCity = escapeHtml(opts.city);
  const safeAppUrl = escapeHtml(process.env.APP_URL ?? 'https://phonbot.de');

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #1f2937;">Deine Nummer ist aktiv! 🎉</h2>
      <p style="color: #4b5563;">Gute Nachrichten, <strong>${safeOrgName}</strong>!</p>
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 20px; margin: 16px 0; text-align: center;">
        <p style="color: #6b7280; font-size: 13px; margin: 0 0 4px 0;">Deine neue Nummer (${safeCity})</p>
        <p style="font-size: 28px; font-weight: 700; color: #059669; margin: 0; letter-spacing: 1px;">${safeNumber}</p>
      </div>
      <p style="color: #4b5563;">Dein KI-Agent nimmt ab sofort Anrufe auf dieser Nummer entgegen. Teste es — ruf die Nummer einfach an!</p>
      <a href="${safeAppUrl}"
         style="display: inline-block; background: linear-gradient(135deg, #f97316, #06b6d4); color: white; padding: 12px 28px; border-radius: 10px; text-decoration: none; font-size: 14px; font-weight: 600; margin: 16px 0;">
        Dashboard öffnen →
      </a>
      <p style="margin-top: 24px; font-size: 12px; color: #9ca3af;">
        ${safeOrgName} · Phonbot Voice Agent
      </p>
    </div>
  `;

  try {
    await resend.emails.send({ from: FROM_EMAIL, to: opts.toEmail, subject, text, html });
  } catch (e: unknown) {
    process.stderr.write(`[email] Failed to send phone number active email: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

export async function sendVerificationEmail(opts: {
  toEmail: string;
  verifyUrl: string;
}) {
  if (!resend) {
    return;
  }

  const subject = 'E-Mail bestätigen';
  const text = `Bestätige deine E-Mail-Adresse:\n\n${opts.verifyUrl}`;
  const safeVerifyUrl = escapeHtml(opts.verifyUrl);
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #1f2937;">E-Mail bestätigen</h2>
      <p style="color: #4b5563;">Klicke auf den Button um deine E-Mail-Adresse zu bestätigen.</p>
      <a href="${safeVerifyUrl}"
         style="display: inline-block; background: #4f46e5; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; margin: 16px 0;">
        E-Mail bestätigen →
      </a>
    </div>
  `;

  try {
    await resend.emails.send({ from: FROM_EMAIL, to: opts.toEmail, subject, text, html });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[email] Failed to send verification email: ${msg}\n`);
  }
}
