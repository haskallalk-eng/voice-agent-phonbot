import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { sendContactFormEmail } from './email.js';

const CONTACT_TO = process.env.CONTACT_EMAIL ?? 'info@mindrails.de';
const RESEND_CONFIGURED = !!process.env.RESEND_API_KEY;

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

    if (!RESEND_CONFIGURED) {
      // Don't log message plaintext — it's user-authored and Pino/Sentry can't
      // round-trip it safely. Log only a length fingerprint for ops visibility.
      req.log.warn({ messageLen: message.length, hasEmail: Boolean(email) }, '[contact] Resend not configured, form submission dropped');
      return { ok: true };
    }

    // Sanitize anything that could land in an email header (subject, reply-to).
    // sendContactFormEmail itself HTML-escapes the body copy for the card.
    const safeName = name ? sanitizeHeaderValue(name) : '';
    const safeEmail = sanitizeHeaderValue(email);

    const result = await sendContactFormEmail({
      toEmail: CONTACT_TO,
      fromName: safeName,
      fromEmail: safeEmail,
      message,
    });
    if (!result.ok) {
      req.log.error({ error: result.error }, '[contact] email send failed');
      return reply.status(500).send({ error: 'Nachricht konnte nicht gesendet werden.' });
    }
    return { ok: true };
  });
}

