import crypto from 'node:crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { pool } from './db.js';
import { z } from 'zod';
import { sendPasswordResetEmail, sendVerificationEmail, sendWelcomeEmail } from './email.js';

// ── Token lifetime / cookie config ────────────────────────────────────────────
//
// Why split: a 7-day Bearer JWT in localStorage is a single point of compromise.
// XSS → token leak → 7 days of attacker access with no revocation. Splitting:
//   • Access JWT (1h, localStorage, Bearer header) — short blast radius.
//   • Refresh token (30d, httpOnly cookie, DB-validated) — out of JS reach,
//     server-side revocable, rotates on every use (replay detection).
const ACCESS_TOKEN_TTL = '1h';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_COOKIE = 'vas_refresh';
const REFRESH_COOKIE_PATH = '/auth'; // sent only to /auth/refresh + /auth/logout

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_MS / 1000,
    signed: true,
  };
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function issueRefreshToken(
  userId: string,
  req: FastifyRequest,
): Promise<string> {
  if (!pool) throw new Error('Database not configured');
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hash, expiresAt, req.headers['user-agent']?.slice(0, 500) ?? null, req.ip ?? null],
  );
  return raw;
}

async function issueTokenPair(
  app: FastifyInstance,
  user: { id: string; role: 'owner' | 'admin' | 'member'; org_id: string },
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ token: string }> {
  const accessToken = app.jwt.sign(
    { userId: user.id, orgId: user.org_id, role: user.role },
    { expiresIn: ACCESS_TOKEN_TTL },
  );
  const refreshRaw = await issueRefreshToken(user.id, req);
  reply.setCookie(REFRESH_COOKIE, refreshRaw, refreshCookieOptions());
  return { token: accessToken };
}

// password.max(72) — bcrypt silently truncates inputs past 72 bytes. Without
// this cap, "SecretABCDEFGHI…<60 chars>A" and "…B" hash identically → login
// with any >72-byte variant works, and an attacker with the hash only needs
// the first 72 bytes. Also caps body size so z.string() doesn't try to hash
// a gigabyte.
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

const RegisterBody = z.object({
  orgName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(PASSWORD_MAX),
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

    // Performance pre-check: bail early on known-duplicate emails (avoids
    // ~200ms bcrypt + org-INSERT + ROLLBACK overhead for a common error case).
    // NOT the primary dedup gate — the INSERT...ON CONFLICT below is (D4).
    // This SELECT is race-prone by design (two concurrent registers can both
    // pass it); ON CONFLICT catches the second one atomically.
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

      // If no email service is configured (dev), mark user as already verified.
      // ON CONFLICT closes the TOCTOU between the pre-check above and this
      // INSERT — a concurrent registration with the same email can't squeak
      // through. users.email has a UNIQUE constraint (see db.ts); on conflict
      // we RETURNING 0 rows → we detect, roll back, and return 409.
      const emailServiceConfigured = !!process.env.RESEND_API_KEY;
      const userResult = await client.query(
        `INSERT INTO users (org_id, email, password_hash, role, email_verify_token, email_verified)
         VALUES ($1, $2, $3, 'owner', $4, $5)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email, role`,
        [org.id, email, passwordHash, emailServiceConfigured ? verifyToken : null, !emailServiceConfigured],
      );
      if (!userResult.rowCount) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'Email already registered' });
      }
      const user = userResult.rows[0];

      await client.query('COMMIT');

      // Send verification + welcome emails when email service is configured
      if (emailServiceConfigured) {
        const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
        sendVerificationEmail({
          toEmail: email,
          verifyUrl: `${appUrl}/verify-email?token=${verifyToken}`,
        }).catch(() => {/* already logged inside */});
        sendWelcomeEmail({ toEmail: email, orgName }).catch(() => {/* logged inside email.ts */});
      }

      const { token } = await issueTokenPair(app, { id: user.id, role: user.role, org_id: org.id }, req, reply);

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

    // Email verification is informational only — never block login

    const { token } = await issueTokenPair(
      app,
      { id: user.id, role: user.role, org_id: user.org_id },
      req,
      reply,
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

    // Always return ok to prevent account enumeration via response-body.
    // Also prevent enumeration via RESPONSE-TIME: the existing-user path runs
    // INSERT + fire-and-forget email (~15ms), the non-existing path returned
    // instantly (~5ms). A timing attacker could tell them apart. Fix: bcrypt
    // hash a dummy on BOTH paths *before* branching, so the ~100ms bcrypt cost
    // dominates and dwarfs the ~10ms difference between the INSERT branch and
    // the skip branch. Email send is fire-and-forget → not part of the timing.
    //
    // Why bcrypt and not setTimeout: bcrypt actually consumes CPU symmetrically,
    // so the attacker can't distinguish branches via load-induced jitter either.
    await bcrypt.hash(`enum-guard-${email}`, 10);

    if (!pool) return reply.send({ ok: true });

    const userResult = await pool.query('SELECT id FROM users WHERE email = $1 AND is_active = true', [email]);
    if (!userResult.rowCount || userResult.rowCount === 0) {
      return reply.send({ ok: true });
    }

    const userId = userResult.rows[0].id;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // DEEP-05: invalidate any existing unused reset tokens for this user.
    // Without this, clicking "forgot password" twice creates two valid tokens;
    // the first link stays usable until its own expiry (1h). Cleanup ensures
    // only the LATEST link works — previous ones become dead links.
    await pool.query(
      `UPDATE password_resets SET used = true WHERE user_id = $1 AND used = false`,
      [userId],
    );
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
      password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
    }).safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const { token, password } = parsed.data;

    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    // Atomically: claim the token (used=true), update password, revoke all
    // refresh tokens for the user. Previously these were three independent
    // queries — if the used-flag UPDATE failed after the password UPDATE,
    // the reset link became replayable, and an attacker holding a stolen
    // refresh cookie kept their access (since passwords change but refresh
    // tokens weren't revoked).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Claim-and-gate in one statement: UPDATE returns the row only if it
      // was still unused at the moment of execution (no TOCTOU).
      const claim = await client.query(
        `UPDATE password_resets SET used = true
         WHERE token = $1 AND used = false AND expires_at > now()
         RETURNING user_id`,
        [token],
      );
      if (!claim.rowCount) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: 'Invalid or expired token' });
      }
      const userId = claim.rows[0].user_id as string;
      const passwordHash = await bcrypt.hash(password, 12);

      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);

      // Revoke every live refresh-cookie for this user. A password reset
      // often means "I think someone else has access"; keeping old refresh
      // tokens alive would defeat the reset.
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

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

  // POST /auth/refresh — exchange refresh-cookie for new access token + rotate refresh.
  // No Bearer required (the access token is expected to be expired here). The
  // refresh cookie alone authorises this endpoint; rotation invalidates the old
  // refresh on every successful call so a stolen cookie is single-use.
  app.post('/auth/refresh', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    // Wrap entire handler: ANY unexpected error (malformed cookie, DB down,
    // schema mismatch) must surface as 401 — never 500. The bootstrap
    // always tries /auth/refresh on page load; a 500 here shows up as a
    // scary console error for every unauthenticated visitor.
    try {
      if (!pool) return reply.status(503).send({ error: 'Database not configured' });

      const signed = req.cookies?.[REFRESH_COOKIE];
      if (!signed) return reply.status(401).send({ error: 'No refresh token' });

      const unsigned = req.unsignCookie(signed);
      if (!unsigned.valid || !unsigned.value) {
        return reply.status(401).send({ error: 'Invalid refresh token' });
      }
      const raw = unsigned.value;
      const hash = hashToken(raw);

      const rotateRes = await pool.query(
        `DELETE FROM refresh_tokens
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
         RETURNING user_id`,
        [hash],
      );
      if (!rotateRes.rowCount) {
        reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
        return reply.status(401).send({ error: 'Refresh token invalid or expired' });
      }
      const userId = rotateRes.rows[0].user_id as string;

      const userRes = await pool.query(
        `SELECT id, role, org_id FROM users WHERE id = $1 AND is_active = true`,
        [userId],
      );
      if (!userRes.rowCount) {
        reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
        return reply.status(401).send({ error: 'User no longer active' });
      }
      const user = userRes.rows[0] as { id: string; role: 'owner' | 'admin' | 'member'; org_id: string };

      const { token } = await issueTokenPair(app, user, req, reply);
      return reply.send({ token });
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, '/auth/refresh failed unexpectedly');
      reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
      return reply.status(401).send({ error: 'Refresh failed' });
    }
  });

  // POST /auth/logout — revoke refresh token + clear cookie.
  // No Bearer required so a logout still works after the access token expired.
  app.post('/auth/logout', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const signed = req.cookies?.[REFRESH_COOKIE];
    if (signed && pool) {
      const unsigned = req.unsignCookie(signed);
      if (unsigned.valid && unsigned.value) {
        await pool.query(
          `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
          [hashToken(unsigned.value)],
        ).catch(() => {/* non-critical */});
      }
    }
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
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
        const Stripe = (await import('stripe')).default;
        const stripeKey = process.env.STRIPE_SECRET_KEY;
        if (stripeKey) {
          const stripe = new Stripe(stripeKey);
          await stripe.subscriptions.cancel(stripeSubId);
        }
      } catch {
        // Non-critical — continue with deletion even if Stripe cancel fails
      }
    }

    // Delete Retell agents (main + callback) for this org
    const agentsRes = await pool.query(
      `SELECT data->>'retellAgentId' as a, data->>'retellCallbackAgentId' as b, data->>'retellLlmId' as c, data->>'retellCallbackLlmId' as d
       FROM agent_configs WHERE org_id = $1`,
      [orgId],
    );
    const retellKey = process.env.RETELL_API_KEY;
    const phonesRes = await pool.query(
      `SELECT number FROM phone_numbers WHERE org_id = $1`,
      [orgId],
    );
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;

    // Run all external-service cleanup fan-out in parallel with Promise.allSettled.
    // Previously: ~10 Retell agents + ~10 phone numbers × ~2 Twilio calls each
    // were awaited serially with 10s timeouts → worst case >150s request, client
    // timed out mid-cleanup, left zombies (Twilio numbers still billed, Retell
    // agents still taking calls). Parallel + allSettled = bounded by the slowest
    // single call (~10s) and every failure only takes down its own branch.
    const cleanupTasks: Promise<unknown>[] = [];

    if (retellKey) {
      const agentIds = new Set<string>();
      const llmIds = new Set<string>();
      for (const row of agentsRes.rows) {
        for (const id of [row.a, row.b]) if (id) agentIds.add(id as string);
        for (const id of [row.c, row.d]) if (id) llmIds.add(id as string);
      }
      for (const id of agentIds) {
        cleanupTasks.push(fetch(`https://api.retellai.com/delete-agent/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${retellKey}` },
          signal: AbortSignal.timeout(10_000),
        }));
      }
      for (const id of llmIds) {
        cleanupTasks.push(fetch(`https://api.retellai.com/delete-retell-llm/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${retellKey}` },
          signal: AbortSignal.timeout(10_000),
        }));
      }
    }

    // Release Twilio phone numbers + delete Retell phone-number assignments
    // Prevents monthly Twilio charges (~1 €/number) for deleted accounts.
    const auth = twilioSid && twilioToken
      ? 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')
      : null;
    for (const row of phonesRes.rows) {
      const number = row.number as string | null;
      if (!number) continue;

      if (auth && twilioSid) {
        cleanupTasks.push((async () => {
          const listRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(number)}`,
            { headers: { Authorization: auth }, signal: AbortSignal.timeout(10_000) },
          );
          const listData = await listRes.json() as { incoming_phone_numbers?: Array<{ sid: string }> };
          const phoneSid = listData.incoming_phone_numbers?.[0]?.sid;
          if (phoneSid) {
            await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers/${phoneSid}.json`,
              { method: 'DELETE', headers: { Authorization: auth }, signal: AbortSignal.timeout(10_000) },
            );
          }
        })());
      }

      if (retellKey) {
        cleanupTasks.push(fetch(
          `https://api.retellai.com/delete-phone-number/${encodeURIComponent(number)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${retellKey}` }, signal: AbortSignal.timeout(10_000) },
        ));
      }
    }

    const results = await Promise.allSettled(cleanupTasks);
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures) {
      req.log.warn({ orgId, failures, total: results.length }, 'account-delete: external cleanup had partial failures');
    }

    // GDPR right-to-erasure: also delete anonymous platform-level CRM leads that
    // match the user's email (in case they filled out a demo form before signup).
    // Org-owned crm_leads are cascaded by the FK below.
    const userRow = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    const userEmail = userRow.rows[0]?.email as string | undefined;
    if (userEmail) {
      await pool.query(
        `DELETE FROM crm_leads WHERE email = $1 AND org_id IS NULL`,
        [userEmail],
      ).catch(() => {/* non-critical */});
    }

    // Deleting the org cascades to: users, tickets, agent_configs,
    // calendar_connections, phone_numbers, password_resets, crm_leads (via FK)
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
