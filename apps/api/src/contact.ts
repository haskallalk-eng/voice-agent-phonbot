import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const CONTACT_TO = process.env.CONTACT_EMAIL ?? 'info@mindrails.de';
const FROM_EMAIL = process.env.EMAIL_FROM ?? 'Phonbot <noreply@phonbot.de>';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const ContactBody = z.object({
  name: z.string().max(200).optional(),
  email: z.string().email().max(200),
  message: z.string().min(1).max(5000),
});

export async function registerContact(app: FastifyInstance) {
  app.post('/contact', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = ContactBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Name, E-Mail und Nachricht erforderlich.' });

    const { name, email, message } = parsed.data;

    if (!resend) {
      req.log.warn('[contact] Resend not configured, logging contact form submission');
      req.log.info({ name, email, message: message.slice(0, 100) }, '[contact] form submission');
      return { ok: true };
    }

    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: CONTACT_TO,
        replyTo: email,
        subject: `Kontaktanfrage von ${name || email}`,
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

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
