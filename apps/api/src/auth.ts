import crypto from 'node:crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { pool } from './db.js';
import { z } from 'zod';
import { sendPasswordResetEmail, sendVerificationEmail } from './email.js';

const RegisterBody = z.object({
  orgName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function registerAuth(app: FastifyInstance) {
  // POST /auth/register — create org + owner user
  app.post('/auth/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const { orgName, email, password } = parsed.data;

    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    // Check email uniqueness
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount && existing.rowCount > 0) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verifyToken = crypto.randomBytes(32).toString('hex');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';
      const orgResult = await client.query(
        'INSERT INTO orgs (name, slug) VALUES ($1, $2) RETURNING id, name, slug',
        [orgName, slug + '-' + Date.now().toString(36)],
      );
      const org = orgResult.rows[0];

      const userResult = await client.query(
        `INSERT INTO users (org_id, email, password_hash, role, email_verify_token)
         VALUES ($1, $2, $3, 'owner', $4)
         RETURNING id, email, role`,
        [org.id, email, passwordHash, verifyToken],
      );
      const user = userResult.rows[0];

      await client.query('COMMIT');

      // Send verification email (fire-and-forget, don't block registration)
      const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
      sendVerificationEmail({
        toEmail: email,
        verifyUrl: `${appUrl}/verify-email?token=${verifyToken}`,
      }).catch(() => {/* already logged inside */});

      const token = app.jwt.sign(
        { userId: user.id, orgId: org.id, role: user.role },
        { expiresIn: '7d' },
      );

      return reply.status(201).send({ token, org, user: { id: user.id, email: user.email, role: user.role } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /auth/login
  app.post('/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }
    const { email, password } = parsed.data;

    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const result = await pool.query(
      `SELECT u.id, u.email, u.role, u.password_hash, u.org_id, u.email_verified,
              o.name as org_name, o.slug as org_slug
       FROM users u
       JOIN orgs o ON o.id = u.org_id
       WHERE u.email = $1 AND u.is_active = true`,
      [email],
    );

    if (result.rowCount === 0) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    if (!user.email_verified) {
      return reply.status(403).send({ error: 'Bitte bestätige zuerst deine E-Mail-Adresse. Sieh in deinem Postfach nach.' });
    }

    const token = app.jwt.sign(
      { userId: user.id, orgId: user.org_id, role: user.role },
      { expiresIn: '7d' },
    );

    return reply.send({
      token,
      org: { id: user.org_id, name: user.org_name, slug: user.org_slug },
      user: { id: user.id, email: user.email, role: user.role },
    });
  });

  // GET /auth/me — validate token + return current user
  app.get('/auth/me', { onRequest: [app.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const result = await pool.query(
      `SELECT u.id, u.email, u.role, u.email_verified, o.id as org_id, o.name as org_name, o.slug as org_slug
       FROM users u JOIN orgs o ON o.id = u.org_id
       WHERE u.id = $1`,
      [userId],
    );
    if (result.rowCount === 0) return reply.status(404).send({ error: 'User not found' });

    return reply.send(result.rows[0]);
  });

  // POST /auth/forgot-password
  app.post('/auth/forgot-password', {
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }
    const { email } = parsed.data;

    // Always return ok to prevent enumeration
    if (!pool) return reply.send({ ok: true });

    const userResult = await pool.query('SELECT id FROM users WHERE email = $1 AND is_active = true', [email]);
    if (!userResult.rowCount || userResult.rowCount === 0) {
      return reply.send({ ok: true });
    }

    const userId = userResult.rows[0].id;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [userId, token, expiresAt],
    );

    const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
    sendPasswordResetEmail({
      toEmail: email,
      resetUrl: `${appUrl}/reset-password?token=${token}`,
    }).catch(() => {/* already logged inside */});

    return reply.send({ ok: true });
  });

  // POST /auth/reset-password
  app.post('/auth/reset-password', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = z.object({
      token: z.string().min(1),
      password: z.string().min(8),
    }).safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const { token, password } = parsed.data;

    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const resetResult = await pool.query(
      `SELECT id, user_id FROM password_resets
       WHERE token = $1 AND used = false AND expires_at > now()`,
      [token],
    );

    if (!resetResult.rowCount || resetResult.rowCount === 0) {
      return reply.status(400).send({ error: 'Invalid or expired token' });
    }

    const { id: resetId, user_id: userId } = resetResult.rows[0];
    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    await pool.query('UPDATE password_resets SET used = true WHERE id = $1', [resetId]);

    return reply.send({ ok: true });
  });

  // POST /auth/verify-email
  app.post('/auth/verify-email', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }
    const { token } = parsed.data;

    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const result = await pool.query(
      `UPDATE users SET email_verified = true, email_verify_token = null
       WHERE email_verify_token = $1
       RETURNING id`,
      [token],
    );

    if (!result.rowCount || result.rowCount === 0) {
      return reply.status(400).send({ error: 'Invalid or already used token' });
    }

    return reply.send({ ok: true });
  });

  // POST /auth/resend-verification — requires auth
  app.post('/auth/resend-verification', {
    onRequest: [app.authenticate],
    config: { rateLimit: { max: 2, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId } = req.user as JwtPayload;

    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const userResult = await pool.query(
      'SELECT email, email_verified FROM users WHERE id = $1',
      [userId],
    );
    if (!userResult.rowCount || userResult.rowCount === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    if (user.email_verified) {
      return reply.send({ ok: true }); // already verified, nothing to do
    }

    const verifyToken = crypto.randomBytes(32).toString('hex');
    await pool.query('UPDATE users SET email_verify_token = $1 WHERE id = $2', [verifyToken, userId]);

    const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
    sendVerificationEmail({
      toEmail: user.email,
      verifyUrl: `${appUrl}/verify-email?token=${verifyToken}`,
    }).catch(() => {/* already logged inside */});

    return reply.send({ ok: true });
  });

  // DELETE /auth/account — GDPR: delete own account + org data
  app.delete('/auth/account', {
    onRequest: [app.authenticate],
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId, orgId, role } = req.user as JwtPayload;

    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    // Only owner can delete the entire org
    if (role !== 'owner') {
      return reply.status(403).send({ error: 'Only the org owner can delete the account' });
    }

    // Cancel Stripe subscription before deleting (avoid dangling subscriptions)
    const orgRow = await pool.query(
      'SELECT stripe_subscription_id FROM orgs WHERE id = $1',
      [orgId],
    );
    const stripeSubId = orgRow.rows[0]?.stripe_subscription_id as string | null;

    if (stripeSubId) {
      try {
        const stripeKey = process.env.STRIPE_SECRET_KEY;
        if (stripeKey) {
          await fetch(`https://api.stripe.com/v1/subscriptions/${stripeSubId}`, {
            method: 'DELETE',
            headers: { Authorization: `Basic ${Buffer.from(stripeKey + ':').toString('base64')}` },
          });
        }
      } catch {
        // Non-critical — continue with deletion even if Stripe cancel fails
      }
    }

    // Delete Retell agent if deployed (non-critical)
    const agentRow = await pool.query(
      `SELECT data->>'retellAgentId' as retell_agent_id FROM agent_configs WHERE org_id = $1 LIMIT 1`,
      [orgId],
    );
    const retellAgentId = agentRow.rows[0]?.retell_agent_id as string | null;
    if (retellAgentId) {
      try {
        const retellKey = process.env.RETELL_API_KEY;
        if (retellKey) {
          await fetch(`https://api.retellai.com/delete-agent/${retellAgentId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${retellKey}` },
          });
        }
      } catch {
        // Non-critical
      }
    }

    // Deleting the org cascades to: users, tickets, agent_configs,
    // calendar_connections, phone_numbers, password_resets
    await pool.query('DELETE FROM orgs WHERE id = $1', [orgId]);

    // Also hard-delete the user record in case org cascade didn't catch it
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {/* already gone */});

    return reply.send({ ok: true });
  });
}

export interface JwtPayload {
  userId: string;
  orgId: string;
  role: 'owner' | 'admin' | 'member';
}
