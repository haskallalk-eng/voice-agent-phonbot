import crypto from 'node:crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { pool } from './db.js';
import { redis } from './redis.js';
import { z } from 'zod';
import { sendPasswordResetEmail, sendVerificationEmail, sendWelcomeEmail } from './email.js';
import { stripe, PLANS, type PlanId } from './billing.js';

// Per-user brute-force counter. The route-level rate-limit is per-IP (5–10/min);
// a botnet of 100 IPs against one email easily slips through. We add a Redis-
// keyed per-email counter on top: 10 failures within an hour locks that account
// for the next 30 min regardless of the source IP. Resets on first success.
// In-memory fallback when Redis is offline so dev still works.
const LOGIN_FAIL_WINDOW_S = 60 * 60;  // 1 hour
const LOGIN_LOCK_AFTER = 10;
const LOGIN_LOCK_TTL_S = 30 * 60;     // 30 min lockout
const memLoginFails = new Map<string, { count: number; expires: number }>();
const memLoginLocks = new Map<string, number>();

function loginFailKey(email: string) { return `login:fail:${email.toLowerCase()}`; }
function loginLockKey(email: string) { return `login:lock:${email.toLowerCase()}`; }

async function isLoginLocked(email: string): Promise<boolean> {
  if (redis) {
    const v = await redis.get(loginLockKey(email)).catch(() => null);
    return !!v;
  }
  const lock = memLoginLocks.get(email.toLowerCase());
  if (!lock) return false;
  if (lock < Date.now()) { memLoginLocks.delete(email.toLowerCase()); return false; }
  return true;
}

async function recordLoginFailure(email: string): Promise<number> {
  const key = loginFailKey(email);
  if (redis) {
    const count = await redis.incr(key).catch(() => 0);
    if (count === 1) await redis.expire(key, LOGIN_FAIL_WINDOW_S).catch(() => {});
    if (count >= LOGIN_LOCK_AFTER) {
      await redis.set(loginLockKey(email), '1', { EX: LOGIN_LOCK_TTL_S }).catch(() => {});
    }
    return count;
  }
  const k = email.toLowerCase();
  const now = Date.now();
  const cur = memLoginFails.get(k);
  const fresh = cur && cur.expires > now ? cur : { count: 0, expires: now + LOGIN_FAIL_WINDOW_S * 1000 };
  fresh.count += 1;
  memLoginFails.set(k, fresh);
  if (fresh.count >= LOGIN_LOCK_AFTER) {
    memLoginLocks.set(k, now + LOGIN_LOCK_TTL_S * 1000);
  }
  return fresh.count;
}

async function clearLoginFailures(email: string): Promise<void> {
  if (redis) {
    await redis.del(loginFailKey(email)).catch(() => {});
    await redis.del(loginLockKey(email)).catch(() => {});
  } else {
    const k = email.toLowerCase();
    memLoginFails.delete(k);
    memLoginLocks.delete(k);
  }
}

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
// Browser-visible auth URLs are /api/auth/*; Caddy strips /api before the API
// sees the request. Cookie Path matching happens in the browser before proxying,
// so this must use /api/auth, not the internal Fastify route /auth.
const REFRESH_COOKIE_PATH = '/api/auth';
const LEGACY_REFRESH_COOKIE_PATH = '/auth';
// Non-httpOnly companion cookie. Pure presence-flag — JS reads it on bootstrap
// to decide whether to attempt /auth/refresh at all. Without this, anonymous
// landing-page visitors trigger a 401 console error every page load (the
// httpOnly refresh cookie is invisible to JS, so the bootstrap can't otherwise
// know it should skip). Carries no auth value — losing it just means one extra
// refresh probe.
const SESSION_HINT_COOKIE = 'vas_has_session';

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

function sessionHintCookieOptions() {
  return {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: REFRESH_TOKEN_TTL_MS / 1000,
  };
}

function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  // Clean up cookies issued before 2026-04-22 that used the internal route
  // path. They were not sent to /api/auth/refresh, which caused logout on reload.
  reply.clearCookie(REFRESH_COOKIE, { path: LEGACY_REFRESH_COOKIE_PATH });
  reply.clearCookie(SESSION_HINT_COOKIE, { path: '/' });
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
  reply.setCookie(SESSION_HINT_COOKIE, '1', sessionHintCookieOptions());
  return { token: accessToken };
}

// password.max(72) — bcrypt silently truncates inputs past 72 bytes. Without
// this cap, "SecretABCDEFGHI…<60 chars>A" and "…B" hash identically → login
// with any >72-byte variant works, and an attacker with the hash only needs
// the first 72 bytes. Also caps body size so z.string() doesn't try to hash
// a gigabyte.
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

// isBusiness + termsAccepted: B2B-only contract. Backend enforces literal(true)
// so a DevTools-edited form can't bypass the frontend checkbox — a consumer
// signing up would otherwise keep §312g BGB Widerrufsrecht regardless of AGB
// wording. AGB §1 + KVKG-Disclaimer rest on the user truthfully attesting they
// signed up as a Gewerbetreibender.
const RegisterBody = z.object({
  orgName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
  isBusiness: z.literal(true),
  termsAccepted: z.literal(true),
});

const CheckoutStartBody = z.object({
  orgName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
  planId: z.enum(['nummer', 'starter', 'pro', 'agency']),
  interval: z.enum(['month', 'year']).default('month'),
  isBusiness: z.literal(true),
  termsAccepted: z.literal(true),
});

const FinalizeCheckoutBody = z.object({
  sessionId: z.string().min(1),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(PASSWORD_MAX),
});

/**
 * Shared materialize step: given a Stripe Checkout session that's paid, turn
 * the pending_registrations row into a real users + orgs pair. Called both
 * from the webhook (fire-and-forget path) and /auth/finalize-checkout (when
 * the user's browser hits the success URL).
 *
 * Idempotent: if the pending row is gone, we return null — the other path
 * already materialized this session.
 */
async function materializePendingFromSession(
  sessionId: string,
  stripeCustomerId: string | null,
): Promise<{ userId: string; orgId: string; email: string; role: 'owner' | 'admin' | 'member' } | null> {
  if (!pool) throw new Error('Database not configured');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the pending row so a concurrent webhook + finalize can't double-insert.
    const pending = await client.query(
      `SELECT id, email, org_name, password_hash, plan_id
         FROM pending_registrations
        WHERE stripe_session_id = $1
        FOR UPDATE`,
      [sessionId],
    );
    if (!pending.rowCount) {
      await client.query('ROLLBACK');
      return null; // already materialized (or never existed)
    }
    const p = pending.rows[0] as {
      id: string; email: string; org_name: string; password_hash: string; plan_id: string;
    };

    // Double-check: if the email was registered elsewhere in the meantime,
    // bail. Safer than overwriting.
    const dup = await client.query('SELECT id FROM users WHERE email = $1', [p.email]);
    if (dup.rowCount) {
      await client.query('DELETE FROM pending_registrations WHERE id = $1', [p.id]);
      await client.query('COMMIT');
      return null;
    }

    const slug = p.org_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';
    const orgRes = await client.query(
      `INSERT INTO orgs (name, slug, stripe_customer_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [p.org_name, slug + '-' + Date.now().toString(36), stripeCustomerId],
    );
    const orgId = orgRes.rows[0].id as string;

    // email_verified=true here: payment implies ownership of that email via
    // Stripe's receipt flow, so the extra click-to-verify is redundant.
    const userRes = await client.query(
      `INSERT INTO users (org_id, email, password_hash, role, email_verified)
       VALUES ($1, $2, $3, 'owner', true)
       RETURNING id, role`,
      [orgId, p.email, p.password_hash],
    );
    const user = userRes.rows[0] as { id: string; role: 'owner' | 'admin' | 'member' };

    await client.query('DELETE FROM pending_registrations WHERE id = $1', [p.id]);
    await client.query('COMMIT');
    return { userId: user.id, orgId, email: p.email, role: user.role };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export { materializePendingFromSession };

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
    // H1: Store SHA-256 hash of the verify token in DB — if DB leaks, attacker
    // can't construct the verify URL (they'd need the pre-image). The plain
    // token is sent to the user's email only.
    const verifyTokenHash = hashToken(verifyToken);

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
      // 14-day expiry on the verify token: if the verification email is
      // intercepted (mailbox compromise, family member access) the token is
      // dead within two weeks, not forever.
      const verifyExpiresAt = emailServiceConfigured
        ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        : null;
      const userResult = await client.query(
        `INSERT INTO users (org_id, email, password_hash, role, email_verify_token, email_verify_token_expires_at, email_verified)
         VALUES ($1, $2, $3, 'owner', $4, $5, $6)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email, role`,
        [org.id, email, passwordHash, emailServiceConfigured ? verifyTokenHash : null, verifyExpiresAt, !emailServiceConfigured],
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

  // POST /auth/checkout-start — Stripe-first register flow.
  // Used when the user picked a paid plan on the pricing page. We do NOT
  // create the users/orgs rows here — only after Stripe checkout completes.
  // On cancel, the pending row is orphaned and cleaned up later (no user
  // account visible from the landing page).
  app.post('/auth/checkout-start', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!stripe || !pool) return reply.status(503).send({ error: 'Payments not configured' });

    const parsed = CheckoutStartBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const { orgName, email, password, planId, interval } = parsed.data;

    const plan = PLANS[planId as PlanId];
    const priceId = interval === 'year' ? plan.stripePriceIdYearly : plan.stripePriceId;
    if (!priceId) {
      return reply.status(400).send({ error: 'Plan price not configured' });
    }

    // Reject immediately if email is already claimed by a real user. Pending
    // rows are allowed to coexist — a second click while Stripe was open
    // shouldn't 409 the user, it should just start a fresh session.
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Create a Stripe Customer up front so the metadata on the subscription
    // has a stable id and the portal/receipt emails go to the right inbox.
    const customer = await stripe.customers.create({ email, name: orgName });

    // Insert pending first — if Stripe call fails below we roll back here.
    const pendingRes = await pool.query(
      `INSERT INTO pending_registrations (email, org_name, password_hash, plan_id, billing_interval, stripe_customer_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [email, orgName, passwordHash, planId, interval, customer.id],
    );
    const pendingId = pendingRes.rows[0].id as string;

    const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
    try {
      const session = await stripe.checkout.sessions.create({
        customer: customer.id,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { metadata: { pendingRegistrationId: pendingId } },
        metadata: { pendingRegistrationId: pendingId },
        // {CHECKOUT_SESSION_ID} is a Stripe placeholder replaced server-side.
        success_url: `${appUrl}/?checkoutSession={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/`,
        allow_promotion_codes: true,
        // §14 UStG / B2B-EU reverse-charge: collect customer VAT-ID so the
        // invoice carries it and reverse-charge applies for cross-border B2B.
        tax_id_collection: { enabled: true },
        // Stripe Tax — only enable when the Stripe Dashboard side is fully
        // configured (DE registration + product tax codes set). Until then,
        // billing keeps working with the Phonbot operator's existing VAT setup.
        // Set STRIPE_AUTOMATIC_TAX=1 once Stripe Tax is live.
        ...(process.env.STRIPE_AUTOMATIC_TAX === '1'
          ? { automatic_tax: { enabled: true } }
          : {}),
      });
      await pool.query(
        'UPDATE pending_registrations SET stripe_session_id = $1 WHERE id = $2',
        [session.id, pendingId],
      );
      return { url: session.url };
    } catch (err) {
      // Clean up the orphan pending row so the TTL job doesn't have to.
      await pool.query('DELETE FROM pending_registrations WHERE id = $1', [pendingId]).catch(() => {});
      req.log.error({ err: (err as Error).message, email }, 'stripe checkout create failed');
      return reply.status(502).send({ error: 'Zahlungsdienst nicht erreichbar. Bitte erneut versuchen.' });
    }
  });

  // POST /auth/finalize-checkout — called by the browser after Stripe redirects
  // back with ?checkoutSession=X. Verifies the session with Stripe, materializes
  // the pending registration into a real user + org (if the webhook didn't
  // already), and logs the user in.
  app.post('/auth/finalize-checkout', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!stripe || !pool) return reply.status(503).send({ error: 'Payments not configured' });

    const parsed = FinalizeCheckoutBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid sessionId' });
    }

    const session = await stripe.checkout.sessions.retrieve(parsed.data.sessionId).catch(() => null);
    if (!session || session.object !== 'checkout.session') {
      return reply.status(404).send({ error: 'Checkout session not found' });
    }
    // 'no_payment_required' covers trials / 100% coupons — still counts as
    // successful checkout for our purposes.
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      return reply.status(402).send({ error: 'Zahlung noch nicht abgeschlossen' });
    }

    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;

    // First try: pending row is still there → materialize now.
    const materialized = await materializePendingFromSession(session.id, customerId);

    // Look up the (now-existing) user/org either way. Webhook may have already
    // materialized before the browser got here; both paths land on the same row.
    let lookup: { id: string; org_id: string; role: 'owner' | 'admin' | 'member'; email: string; org_name: string; org_slug: string } | null = null;
    if (materialized) {
      const r = await pool.query(
        `SELECT u.id, u.org_id, u.role, u.email, o.name as org_name, o.slug as org_slug
           FROM users u JOIN orgs o ON o.id = u.org_id
          WHERE u.id = $1`,
        [materialized.userId],
      );
      lookup = r.rows[0] ?? null;
    } else if (customerId) {
      const r = await pool.query(
        `SELECT u.id, u.org_id, u.role, u.email, o.name as org_name, o.slug as org_slug
           FROM users u JOIN orgs o ON o.id = u.org_id
          WHERE o.stripe_customer_id = $1 AND u.role = 'owner'
          ORDER BY u.created_at
          LIMIT 1`,
        [customerId],
      );
      lookup = r.rows[0] ?? null;
    }

    if (!lookup) {
      return reply.status(404).send({ error: 'Account not yet provisioned — try again in a moment' });
    }

    const { token } = await issueTokenPair(
      app,
      { id: lookup.id, role: lookup.role, org_id: lookup.org_id },
      req,
      reply,
    );

    // Best-effort: send welcome email on first login after checkout.
    if (process.env.RESEND_API_KEY) {
      sendWelcomeEmail({ toEmail: lookup.email, orgName: lookup.org_name }).catch(() => {/* logged in email.ts */});
    }

    return reply.send({
      token,
      org: { id: lookup.org_id, name: lookup.org_name, slug: lookup.org_slug },
      user: { id: lookup.id, email: lookup.email, role: lookup.role },
    });
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

    // Per-user soft-lock: stops a distributed-IP brute-force where the per-IP
    // rate-limit at the route level can't see the pattern. We check BEFORE
    // hitting the DB so a locked account doesn't cause bcrypt CPU burn either.
    if (await isLoginLocked(email)) {
      return reply.status(429).send({
        error: 'Account temporarily locked due to repeated failed logins. Try again in 30 minutes.',
      });
    }

    const result = await pool.query(
      `SELECT u.id, u.email, u.role, u.password_hash, u.org_id, u.email_verified,
              o.name as org_name, o.slug as org_slug
       FROM users u
       JOIN orgs o ON o.id = u.org_id
       WHERE u.email = $1 AND u.is_active = true`,
      [email],
    );

    if (result.rowCount === 0) {
      // Still record under the supplied email so a probe of unknown emails
      // can't bypass the counter by varying user-base.
      await recordLoginFailure(email);
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const count = await recordLoginFailure(email);
      if (count >= LOGIN_LOCK_AFTER) {
        req.log.warn({ email, count }, 'login: per-user lock triggered');
      }
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // Successful login → reset the failure counter so a long-lived legit
    // account doesn't accumulate stale fails over months.
    await clearLoginFailures(email);

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
    // Store SHA-256 hash of the token in DB — if DB leaks, attacker can't
    // construct the reset URL (they'd need the pre-image). The plain token
    // is sent to the user's email only.
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // DEEP-05: invalidate any existing unused reset tokens for this user.
    await pool.query(
      `UPDATE password_resets SET used = true WHERE user_id = $1 AND used = false`,
      [userId],
    );
    await pool.query(
      `INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt],
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

    // Hash the incoming token to match the SHA-256 hash stored in the DB.
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const claim = await client.query(
        `UPDATE password_resets SET used = true
         WHERE token = $1 AND used = false AND expires_at > now()
         RETURNING user_id`,
        [tokenHash],
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

    // H1: Hash the incoming token to match the SHA-256 hash stored in DB.
    const tokenHash = hashToken(token);

    const result = await pool.query(
      `UPDATE users SET email_verified = true, email_verify_token = null, email_verify_token_expires_at = null
       WHERE email_verify_token = $1
         AND (email_verify_token_expires_at IS NULL OR email_verify_token_expires_at > now())
       RETURNING id`,
      [tokenHash],
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
    // H1: Store only the SHA-256 hash in DB; plain token goes in the email URL.
    const verifyTokenHash = hashToken(verifyToken);
    const verifyExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await pool.query(
      'UPDATE users SET email_verify_token = $1, email_verify_token_expires_at = $2 WHERE id = $3',
      [verifyTokenHash, verifyExpiresAt, userId],
    );

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
        clearRefreshCookie(reply);
        return reply.status(401).send({ error: 'Refresh token invalid or expired' });
      }
      const userId = rotateRes.rows[0].user_id as string;

      const userRes = await pool.query(
        `SELECT id, role, org_id FROM users WHERE id = $1 AND is_active = true`,
        [userId],
      );
      if (!userRes.rowCount) {
        clearRefreshCookie(reply);
        return reply.status(401).send({ error: 'User no longer active' });
      }
      const user = userRes.rows[0] as { id: string; role: 'owner' | 'admin' | 'member'; org_id: string };

      const { token } = await issueTokenPair(app, user, req, reply);
      return reply.send({ token });
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, '/auth/refresh failed unexpectedly');
      clearRefreshCookie(reply);
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
    clearRefreshCookie(reply);
    return reply.send({ ok: true });
  });

  // DELETE /auth/account — GDPR: delete own account + org data.
  // Re-auth: requires the current password in the body. The route is owner-only
  // and irreversible (cancels Stripe sub, releases Twilio numbers, drops Retell
  // agents, FK-cascades all customer data). A stolen 1h access token or an
  // unattended browser must NOT be enough to nuke the org.
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

    // Re-authenticate with password before destructive cascade.
    const reauthParse = z.object({
      password: z.string().min(1).max(PASSWORD_MAX),
    }).safeParse(req.body ?? {});
    if (!reauthParse.success) {
      return reply.status(400).send({ error: 'Password required for account deletion' });
    }
    const userRow = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1 AND is_active = true',
      [userId],
    );
    if (!userRow.rowCount) {
      return reply.status(401).send({ error: 'User not found' });
    }
    const reauthOk = await bcrypt.compare(reauthParse.data.password, userRow.rows[0].password_hash);
    if (!reauthOk) {
      req.log.warn({ userId, orgId }, 'account-delete: password reauth failed');
      return reply.status(401).send({ error: 'Invalid password' });
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
      } catch (err) {
        // Continue with deletion — but log loudly. A silent fail here means
        // the customer's account is gone but Stripe keeps billing them every
        // month. Ops needs to see this to manually cancel in the dashboard.
        req.log.error(
          { err: (err as Error).message, subId: stripeSubId, orgId },
          'account-delete: stripe subscription cancel failed — manual cancel required',
        );
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

    // GDPR right-to-erasure: wrap DB deletions in a transaction to prevent
    // partial cleanup if a query fails mid-way (M7: pool-exhaustion + consistency).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete anonymous platform-level CRM leads that match the user's email
      // (in case they filled out a demo form before signup).
      const userRow = await client.query('SELECT email FROM users WHERE id = $1', [userId]);
      const userEmail = userRow.rows[0]?.email as string | undefined;
      if (userEmail) {
        await client.query(
          `DELETE FROM crm_leads WHERE email = $1 AND org_id IS NULL`,
          [userEmail],
        ).catch(() => {/* non-critical — table may not exist */});
      }

      // Deleting the org cascades to: users, tickets, agent_configs,
      // calendar_connections, phone_numbers, password_resets, crm_leads (via FK)
      await client.query('DELETE FROM orgs WHERE id = $1', [orgId]);

      // Also hard-delete the user record in case org cascade didn't catch it
      await client.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {/* already gone */});

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return reply.send({ ok: true });
  });
}

export interface JwtPayload {
  userId: string;
  orgId: string;
  role: 'owner' | 'admin' | 'member';
}
