import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Resend } from 'resend';
import { escapeHtml } from './utils.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const CONTACT_TO = process.env.CONTACT_EMAIL ?? 'info@mindrails.de';
const FROM_EMAIL = process.env.EMAIL_FROM ?? 'Phonbot <noreply@phonbot.de>';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const ContactBody = z.object({
  name: z.string().max(200).optional(),
  email: z.string().email().max(200),
  message: z.string().min(1).max(5000),
});

// Strip header-splitting characters (CR/LF/\0) that could be used to inject
// extra Bcc: / Cc: headers via the subject/name fields.
function sanitizeHeaderValue(s: string): string {
  return s.replace(/[\r\n\0]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export async function registerContact(app: FastifyInstance) {
  app.post('/contact', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = ContactBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Name, E-Mail und Nachricht erforderlich.' });

    const { name, email, message } = parsed.data;

    if (!resend) {
      // Don't log name/email/message plaintext — Pino redact covers name/email
      // but message is the user-authored body and can't round-trip as plaintext
      // to stdout/Sentry. Log only a length fingerprint for ops visibility.
      req.log.warn({ messageLen: message.length, hasEmail: Boolean(email) }, '[contact] Resend not configured, form submission dropped');
      return { ok: true };
    }

    // Sanitize anything that could end up in an email header (subject, reply-to)
    const safeName = name ? sanitizeHeaderValue(name) : '';
    const safeEmail = sanitizeHeaderValue(email);

    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: CONTACT_TO,
        replyTo: safeEmail,
        subject: `Kontaktanfrage von ${safeName || safeEmail}`,
        html: `
          <div style="font-family: system-ui, sans-serif; max-width: 500px;">
            <h2 style="color: #F97316;">Neue Kontaktanfrage</h2>
            <p><strong>Name:</strong> ${escapeHtml(name || '–')}</p>
            <p><strong>E-Mail:</strong> ${escapeHtml(email)}</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;" />
            <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>
          </div>
        `,
      });
    } catch (e) {
      req.log.error({ error: e instanceof Error ? e.message : String(e) }, '[contact] email send failed');
      return reply.status(500).send({ error: 'Nachricht konnte nicht gesendet werden.' });
    }

    return { ok: true };
  });
}

