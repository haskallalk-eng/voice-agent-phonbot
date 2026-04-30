import { Resend } from 'resend';
import { escapeHtml } from './utils.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const FROM_EMAIL = process.env.EMAIL_FROM ?? 'Phonbot <noreply@phonbot.de>';
const APP_URL = process.env.APP_URL ?? 'https://phonbot.de';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Boot-time diagnostic — visible in container start logs. The 2026-04-24
// "no emails for 6 days, no errors in Resend" debugging session showed that
// silent RESEND_NOT_CONFIGURED is the failure mode that's hardest to spot:
// nothing reaches Resend, nothing logs at request-time (before this fix), and
// the only signal is the absence of activity. Loud-log on boot so the next
// failure is visible the second the container starts.
if (!resend) {
  process.stderr.write(
    `[email] WARNING: RESEND_API_KEY is empty or missing — all transactional emails will be silently skipped (signup-link, verification, password-reset, ticket, plan, payment-failed). Check apps/api/.env on the production server.\n`,
  );
} else {
  // Mask the key prefix so we don't leak the value into Docker logs but still
  // see at a glance that something is configured.
  const masked = RESEND_API_KEY.length > 8 ? `${RESEND_API_KEY.slice(0, 4)}…${RESEND_API_KEY.slice(-4)}` : '<short>';
  process.stderr.write(
    `[email] Resend configured: key=${masked} from=${FROM_EMAIL} app=${APP_URL}\n`,
  );
}

// ── Branded Email Template ─────────────────────────────────────────────────

function brandedEmail(opts: { title: string; body: string; cta?: { label: string; url: string }; footer?: string }): string {
  const safeAppUrl = escapeHtml(APP_URL);
  const logoUrl = `${safeAppUrl}/chipy.svg`;
  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#0A0A0F;font-family:'Inter',system-ui,-apple-system,sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:40px 24px;">

  <!-- Header: Chipy logo + brand text (matches navbar) -->
  <div style="text-align:center;margin-bottom:32px;">
    <a href="${safeAppUrl}" style="text-decoration:none;display:inline-block;">
      <img src="${logoUrl}" width="36" height="36" alt="Phonbot" style="display:inline-block;vertical-align:middle;margin-right:8px;" />
      <span style="font-size:22px;font-weight:800;letter-spacing:-0.5px;vertical-align:middle;">
        <span style="color:#ffffff;">Phon</span><span style="color:#F97316;">bot</span>
      </span>
    </a>
  </div>

  <!-- Card -->
  <div style="background:#141420;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px 28px;text-align:center;">
    <h2 style="color:#ffffff;font-size:20px;font-weight:700;margin:0 0 16px 0;">${opts.title}</h2>
    <div style="color:rgba(255,255,255,0.6);font-size:14px;line-height:1.7;">
      ${opts.body}
    </div>
    ${opts.cta ? `
    <div style="margin:28px 0 8px 0;">
      <a href="${escapeHtml(opts.cta.url)}"
         style="display:inline-block;background:linear-gradient(135deg,#F97316,#06B6D4);color:#ffffff;padding:14px 36px;border-radius:12px;text-decoration:none;font-size:14px;font-weight:600;">
        ${escapeHtml(opts.cta.label)}
      </a>
    </div>
    ` : ''}
  </div>

  <!-- Footer -->
  <div style="text-align:center;margin-top:24px;">
    <p style="color:rgba(255,255,255,0.2);font-size:11px;margin:0;">
      ${opts.footer ? escapeHtml(opts.footer) : 'Phonbot by Mindrails \u00b7 phonbot.de'}
    </p>
  </div>

</div>
</body></html>`;
}

// Resend SDK uses undici with a ~300s default — way too long for a Fastify handler
// awaiting a verification mail. Race the send against a 10s timer.
//
// IMPORTANT: when the timeout wins, the underlying Resend promise is still
// in-flight and may later reject (e.g. network error after 30s). Attach a
// no-op .catch() to that promise so a late rejection does not bubble up as
// an unhandled rejection (which crashes the process under Node's default).
async function sendWithTimeout(p: Promise<unknown>, label: string, ms = 10_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`[email:${label}] timed out after ${ms}ms`)), ms);
  });
  // Swallow late rejections from the orphaned promise. Logged at debug level
  // for forensics, never bubbled.
  p.catch((err: unknown) => {
    process.stderr.write(`[email:${label}] late rejection (after timeout/win): ${err instanceof Error ? err.message : String(err)}\n`);
  });
  try {
    await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type EmailSendResult = { ok: true } | { ok: false; error: string };

async function send(to: string, subject: string, text: string, html: string, replyTo?: string): Promise<EmailSendResult> {
  if (!resend) return { ok: false, error: 'RESEND_NOT_CONFIGURED' };
  try {
    await sendWithTimeout(
      resend.emails.send({ from: FROM_EMAIL, to, subject, text, html, ...(replyTo ? { replyTo } : {}) }),
      subject,
    );
    return { ok: true };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    // stderr keeps the audit trail when the caller doesn't log; callers SHOULD
    // inspect the result and surface via Pino/Sentry so prod observability
    // sees the actual Resend reason (from-address not verified, bounce, rate
    // limit, etc.) — without this you lose the most common email-failure mode.
    process.stderr.write(`[email] Send failed (${subject}): ${error}\n`);
    return { ok: false, error };
  }
}

/**
 * Contact-form forwarding email — sent to the Phonbot team when someone
 * fills out the public contact form. Styled with the same dark-mode
 * brand template as the transactional mails so the inbox reads as one
 * family.
 */
export async function sendContactFormEmail(opts: {
  toEmail: string;
  fromName: string;
  fromEmail: string;
  message: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!resend) return { ok: false, error: 'Resend not configured' };
  const safeName = opts.fromName ? escapeHtml(opts.fromName) : '—';
  const safeEmail = escapeHtml(opts.fromEmail);
  // Preserve line breaks but escape the rest so HTML can't be injected.
  const safeMessage = escapeHtml(opts.message).replace(/\n/g, '<br />');
  const html = brandedEmail({
    title: 'Neue Kontaktanfrage',
    body: `
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px 0;text-align:left;">
        <tr><td style="padding:8px 0;color:rgba(255,255,255,0.4);width:90px;font-size:13px;">Name</td><td style="padding:8px 0;color:#fff;font-weight:600;font-size:14px;">${safeName}</td></tr>
        <tr><td style="padding:8px 0;color:rgba(255,255,255,0.4);font-size:13px;">E-Mail</td><td style="padding:8px 0;font-size:14px;"><a href="mailto:${safeEmail}" style="color:#F97316;text-decoration:none;">${safeEmail}</a></td></tr>
      </table>
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;text-align:left;color:rgba(255,255,255,0.75);font-size:14px;line-height:1.6;">
        ${safeMessage}
      </div>
    `,
    footer: 'Antwort direkt auf diese E-Mail geht an den Absender.',
  });
  try {
    await sendWithTimeout(
      resend.emails.send({
        from: FROM_EMAIL,
        to: opts.toEmail,
        replyTo: opts.fromEmail,
        subject: `Kontaktanfrage von ${opts.fromName || opts.fromEmail}`,
        html,
      }),
      'contact-form',
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Transactional Emails ─────────────────────────────────────────────────

export async function sendVerificationEmail(opts: { toEmail: string; verifyUrl: string }) {
  const html = brandedEmail({
    title: 'E-Mail bestätigen',
    body: '<p style="margin:0;">Klicke auf den Button um deine E-Mail-Adresse zu bestätigen und dein Konto zu aktivieren.</p>',
    cta: { label: 'E-Mail bestätigen', url: opts.verifyUrl },
    footer: 'Falls du dich nicht registriert hast, ignoriere diese E-Mail.',
  });
  await send(opts.toEmail, 'E-Mail bestätigen — Phonbot', `Bestätige deine E-Mail: ${opts.verifyUrl}`, html);
}

export async function sendPasswordResetEmail(opts: { toEmail: string; resetUrl: string }) {
  const html = brandedEmail({
    title: 'Passwort zurücksetzen',
    body: `
      <p style="margin:0 0 12px 0;">Jemand hat eine Passwort-Zurücksetzung für dein Konto angefordert.</p>
      <p style="margin:0;">Klicke auf den Button um ein neues Passwort zu setzen. Der Link ist <strong style="color:#fff;">1 Stunde</strong> gültig.</p>
    `,
    cta: { label: 'Neues Passwort setzen', url: opts.resetUrl },
    footer: 'Falls du das nicht angefordert hast, ignoriere diese E-Mail. Dein Passwort bleibt unverändert.',
  });
  await send(opts.toEmail, 'Passwort zurücksetzen — Phonbot', `Passwort zurücksetzen: ${opts.resetUrl}\n\nDer Link ist 1 Stunde gültig.`, html);
}

export async function sendTicketNotification(opts: {
  toEmail: string; orgName: string; customerName: string | null; customerPhone: string; reason: string | null; service: string | null;
}) {
  const safeName = opts.customerName ? escapeHtml(opts.customerName) : '—';
  const safePhone = escapeHtml(opts.customerPhone);
  const safeReason = opts.reason ? escapeHtml(opts.reason) : null;
  const safeService = opts.service ? escapeHtml(opts.service) : null;
  const html = brandedEmail({
    title: 'Neues Ticket',
    body: `
      <table style="width:100%;border-collapse:collapse;margin:0 0 8px 0;">
        <tr><td style="padding:8px 0;color:rgba(255,255,255,0.4);width:90px;font-size:13px;">Kunde</td><td style="padding:8px 0;color:#fff;font-weight:600;font-size:14px;">${safeName}</td></tr>
        <tr><td style="padding:8px 0;color:rgba(255,255,255,0.4);font-size:13px;">Telefon</td><td style="padding:8px 0;font-size:14px;"><a href="tel:${safePhone}" style="color:#F97316;text-decoration:none;">${safePhone}</a></td></tr>
        ${safeReason ? `<tr><td style="padding:8px 0;color:rgba(255,255,255,0.4);font-size:13px;">Grund</td><td style="padding:8px 0;color:rgba(255,255,255,0.7);font-size:14px;">${safeReason}</td></tr>` : ''}
        ${safeService ? `<tr><td style="padding:8px 0;color:rgba(255,255,255,0.4);font-size:13px;">Service</td><td style="padding:8px 0;color:rgba(255,255,255,0.7);font-size:14px;">${safeService}</td></tr>` : ''}
      </table>
    `,
    cta: { label: 'Ticket öffnen', url: `${APP_URL}/tickets` },
    footer: `${opts.orgName} · Phonbot`,
  });
  const text = `Neues Ticket: ${opts.customerName ?? opts.customerPhone}\nTelefon: ${opts.customerPhone}${opts.reason ? `\nGrund: ${opts.reason}` : ''}`;
  await send(opts.toEmail, `Neues Ticket: ${opts.customerName ?? opts.customerPhone}`, text, html);
}

// ── CRM / Lifecycle Emails ─────────────────────────────────────────────────

export async function sendWelcomeEmail(opts: { toEmail: string; orgName: string }) {
  const safeOrg = escapeHtml(opts.orgName);
  const html = brandedEmail({
    title: 'Willkommen bei Phonbot! 👋',
    body: `
      <p style="margin:0 0 12px 0;">Hey <strong style="color:#fff;">${safeOrg}</strong>,</p>
      <p style="margin:0 0 16px 0;">dein Account ist eingerichtet. In wenigen Minuten kann dein KI-Agent Anrufe entgegennehmen.</p>
      <div style="margin:16px 0;">
        <p style="margin:0 0 8px 0;color:rgba(255,255,255,0.5);font-size:13px;">Nächste Schritte:</p>
        <p style="margin:0 0 6px 0;">✦ Agent konfigurieren und deployen</p>
        <p style="margin:0 0 6px 0;">✦ Telefonnummer aktivieren</p>
        <p style="margin:0;">✦ Kalender verbinden</p>
      </div>
    `,
    cta: { label: 'Loslegen', url: APP_URL },
  });
  await send(opts.toEmail, 'Willkommen bei Phonbot!', `Willkommen bei Phonbot, ${opts.orgName}! Dein Agent wartet auf dich.`, html);
}

export async function sendSignupAbandonedEmail(opts: {
  toEmail: string;
  orgName: string;
  planName: string;
  planId: string;
  interval: 'month' | 'year';
}) {
  const safeOrg = escapeHtml(opts.orgName);
  const safePlan = escapeHtml(opts.planName);
  const resumeUrl = `${APP_URL}/?page=register&plan=${encodeURIComponent(opts.planId)}&interval=${encodeURIComponent(opts.interval)}`;
  const html = brandedEmail({
    title: 'Deine Anmeldung wartet auf dich',
    body: `
      <p style="margin:0 0 12px 0;">Hey <strong style="color:#fff;">${safeOrg}</strong>,</p>
      <p style="margin:0 0 16px 0;">du hast gerade versucht, dich bei Phonbot anzumelden — aber die Zahlung ist nicht abgeschlossen worden. Alles gut: wir haben noch nichts gespeichert.</p>
      <div style="background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.15);border-radius:12px;padding:16px;margin:0 0 16px 0;">
        <p style="margin:0;color:rgba(255,255,255,0.5);font-size:13px;">Dein gewählter Plan</p>
        <p style="margin:4px 0 0 0;font-size:18px;font-weight:700;color:#fff;">${safePlan}</p>
      </div>
      <p style="margin:0;">Falls du Phonbot trotzdem ausprobieren willst, kannst du die Anmeldung mit einem Klick fortsetzen — dein Plan ist vorausgewählt.</p>
    `,
    cta: { label: 'Anmeldung fortsetzen', url: resumeUrl },
    footer: 'Falls du es dir anders überlegt hast, ignoriere diese E-Mail einfach.',
  });
  const text = `Deine Anmeldung bei Phonbot wurde nicht abgeschlossen.\n\nFalls du es nochmal versuchen möchtest:\n${resumeUrl}`;
  await send(opts.toEmail, 'Deine Phonbot-Anmeldung wartet auf dich', text, html);
}

export async function sendSignupLinkEmail(opts: { toEmail: string; name?: string | null }): Promise<EmailSendResult> {
  const safeName = opts.name ? escapeHtml(opts.name) : null;
  const signupUrl = `${APP_URL}/login`;
  const html = brandedEmail({
    title: 'Dein Phonbot-Testlink',
    body: `
      <p style="margin:0 0 12px 0;">${safeName ? `Hey <strong style="color:#fff;">${safeName}</strong>,` : 'Hey,'}</p>
      <p style="margin:0 0 16px 0;">hier ist der Link, den Chipy dir im Demo-Rückruf angekündigt hat. Du kannst Phonbot kostenlos testen und deinen ersten Telefonagenten einrichten.</p>
      <p style="margin:0;color:rgba(255,255,255,0.5);font-size:13px;">Der Test startet direkt im Dashboard. Keine Kreditkarte nötig.</p>
    `,
    cta: { label: 'Phonbot kostenlos testen', url: signupUrl },
    footer: 'Demo-Rückruf angefordert · Phonbot',
  });
  const text = `Dein Phonbot-Testlink: ${signupUrl}\n\nDu kannst Phonbot kostenlos testen und deinen ersten Telefonagenten einrichten.`;
  return send(opts.toEmail, 'Dein Phonbot-Testlink', text, html);
}

export async function sendPlanActivatedEmail(opts: { toEmail: string; orgName: string; planName: string; minutesLimit: number }) {
  const safeOrg = escapeHtml(opts.orgName);
  const safePlan = escapeHtml(opts.planName);
  const html = brandedEmail({
    title: `${safePlan}-Plan aktiviert ✅`,
    body: `
      <p style="margin:0 0 16px 0;"><strong style="color:#fff;">${safeOrg}</strong>, dein ${safePlan}-Plan ist aktiv!</p>
      <div style="background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.15);border-radius:12px;padding:16px;margin:0 0 16px 0;">
        <p style="margin:0;color:rgba(255,255,255,0.5);font-size:13px;">Dein Kontingent</p>
        <p style="margin:4px 0 0 0;font-size:24px;font-weight:700;color:#F97316;">${opts.minutesLimit} Minuten / Monat</p>
      </div>
      <p style="margin:0;">Du kannst jetzt eine Telefonnummer aktivieren und deinen Agent live schalten.</p>
    `,
    cta: { label: 'Dashboard öffnen', url: APP_URL },
    footer: `${opts.orgName} · ${opts.planName}-Plan · Phonbot`,
  });
  await send(opts.toEmail, `${opts.planName}-Plan aktiviert — Phonbot`, `Dein ${opts.planName}-Plan ist aktiv! ${opts.minutesLimit} Min/Monat.`, html);
}

export async function sendUsageWarningEmail(opts: { toEmail: string; orgName: string; minutesUsed: number; minutesLimit: number; percent: number }) {
  const safeOrg = escapeHtml(opts.orgName);
  const html = brandedEmail({
    title: `${opts.percent}% deines Kontingents verbraucht`,
    body: `
      <p style="margin:0 0 16px 0;"><strong style="color:#fff;">${safeOrg}</strong>, du hast ${opts.percent}% deiner monatlichen Minuten verbraucht.</p>
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;margin:0 0 16px 0;">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="color:rgba(255,255,255,0.4);font-size:13px;">Verbraucht</span>
          <span style="color:#fff;font-weight:600;font-size:14px;">${opts.minutesUsed} / ${opts.minutesLimit} Min</span>
        </div>
        <div style="background:rgba(255,255,255,0.06);border-radius:4px;height:6px;overflow:hidden;">
          <div style="background:linear-gradient(90deg,#F97316,#06B6D4);height:100%;width:${Math.min(opts.percent, 100)}%;border-radius:4px;"></div>
        </div>
      </div>
      <p style="margin:0;color:rgba(255,255,255,0.5);">Zusätzliche Minuten werden automatisch zum Überschreitungspreis abgerechnet. Upgrade für mehr Kontingent.</p>
    `,
    cta: { label: 'Plan verwalten', url: `${APP_URL}/billing` },
  });
  await send(opts.toEmail, `${opts.percent}% Kontingent verbraucht — Phonbot`, `Du hast ${opts.minutesUsed}/${opts.minutesLimit} Minuten verbraucht (${opts.percent}%).`, html);
}

export async function sendPaymentFailedEmail(opts: { toEmail: string; orgName: string }) {
  const safeOrg = escapeHtml(opts.orgName);
  const html = brandedEmail({
    title: 'Zahlung fehlgeschlagen',
    body: `
      <p style="margin:0 0 12px 0;"><strong style="color:#fff;">${safeOrg}</strong>, deine letzte Zahlung konnte nicht verarbeitet werden.</p>
      <p style="margin:0 0 16px 0;">Bitte aktualisiere deine Zahlungsmethode um deinen Service ohne Unterbrechung weiterzunutzen.</p>
      <p style="margin:0;color:rgba(255,255,255,0.4);font-size:13px;">Wenn das Problem bestehen bleibt, kontaktiere uns unter info@mindrails.de.</p>
    `,
    cta: { label: 'Zahlungsmethode aktualisieren', url: `${APP_URL}/billing` },
  });
  await send(opts.toEmail, 'Zahlung fehlgeschlagen — Phonbot', `Deine Zahlung für ${opts.orgName} konnte nicht verarbeitet werden. Bitte aktualisiere deine Zahlungsmethode.`, html);
}
