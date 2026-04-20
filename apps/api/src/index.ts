import './env.js'; // must be first — loads .env before anything reads process.env
import { initSentry, Sentry } from './sentry.js';

import Fastify, { type FastifyError, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import formbody from '@fastify/formbody';
import { migrate, pool, cleanupOldTranscripts, cleanupOldLeads, cleanupOldWebhookDedupKeys } from './db.js';
import { connectRedis, redis } from './redis.js';
import { registerAuth } from './auth.js';
import { registerTickets } from './tickets.js';
import { registerTraces } from './traces.js';
import { registerChat } from './chat.js';
import { registerAgentConfig } from './agent-config.js';
import { registerRetellWebhooks } from './retell-webhooks.js';
import { registerBilling } from './billing.js';
import { registerDemo } from './demo.js';
import { registerPhone, migratePhone, syncTwilioNumbersToDb } from './phone.js';
import { registerCalendar, migrateCalendar } from './calendar.js';
import { registerVoices } from './voices.js';
import { registerInsights } from './insights.js';
import { registerOutbound, migrateOutbound } from './outbound-agent.js';
import { registerTwilioBridge } from './twilio-openai-bridge.js';
import { registerCopilot } from './copilot.js';
import { registerLearningApi } from './learning-api.js';
import { registerTrainingExport } from './training-export.js';
import { registerContact } from './contact.js';
import { registerAdmin } from './admin.js';
import { setBgLogger } from './logger.js';

initSentry();
const SENTRY_DSN = process.env.SENTRY_DSN ?? '';

// trustProxy: behind Caddy reverse-proxy we need real client IPs (for rate-limit + logs).
// 'true' trusts all hops — safe here because only Caddy can reach the API container.
const app = Fastify({
  // Redact secrets from structured log output so Sentry/docker-logs/stdout don't
  // archive Bearer tokens or cookie jars. Pino redacts by full path; `*.authorization`
  // covers both inbound req.headers and outbound fetch breadcrumbs.
  logger: {
    // Redact secrets AND GDPR-sensitive PII from structured log output so
    // Sentry/docker-logs/stdout don't archive Bearer tokens, cookie jars, or
    // customer contact data. Pino redacts by path; `*.x` matches one level deep,
    // bare `x` matches root. Every call-site that logs `{ email, phone, name }`
    // gets redacted regardless of nesting depth.
    redact: {
      paths: [
        // Secrets in request headers
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'req.headers["x-retell-signature"]',
        'req.headers["stripe-signature"]',
        '*.authorization',
        '*.password',
        // Customer PII (DSGVO) — logged by demo.ts, contact.ts, outbound-agent.ts,
        // twilio-openai-bridge.ts, phone.ts etc. when recording lead/callback events.
        // Bare key redacts the root of the log object (log.info({ email } ...));
        // *.key redacts one level deep (log.info({ lead: { email } } ...)).
        'email', 'phone', 'customerName', 'customerPhone', 'caller',
        '*.email', '*.phone', '*.customerName', '*.customerPhone', '*.caller',
        'req.body.email', 'req.body.phone', 'req.body.name',
        'req.body.customerName', 'req.body.customerPhone',
        'req.body.message',
        // Pino doesn't set a root "name" by default (we don't use logger.name),
        // so redacting root "name" only hits PII call-sites (demo/contact leads).
        'name',
      ],
      censor: '[REDACTED]',
    },
  },
  trustProxy: true,
});
// Expose the root pino logger to module-scope code (logger.ts) so
// background jobs can use the same pipeline (Sentry, redaction, etc.).
setBgLogger(app.log);
await app.register(websocket);
// Twilio webhooks (TwiML, StatusCallback) use application/x-www-form-urlencoded.
// Without this plugin Fastify returns 415 Unsupported Media Type.
await app.register(formbody);
// Helmet with CSP — mitigates XSS → token-exfiltration (localStorage JWT is at risk).
// Allows: self, inline scripts/styles (React build), Google Fonts, Retell web-call WS, own api.
await app.register(helmet, {
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      // Cloudflare Turnstile (CAPTCHA) lädt JS von challenges.cloudflare.com.
      // H3: removed 'unsafe-inline' — XSS risk; Vite/React builds don't need it.
      scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      // M9: narrowed from 'https:' to specific domains to reduce attack surface
      imgSrc: ["'self'", 'data:', 'https://phonbot.de', 'https://*.retellai.com', 'https://challenges.cloudflare.com'],
      // Retell's browser SDK (retell-client-js-sdk) connects to its managed
      // LiveKit cluster at wss://retell-ai-*.livekit.cloud for the WebRTC
      // realtime audio pipe — without livekit.cloud in connect-src the browser
      // CSP-blocks room.connect() and the SDK emits a vague "Error starting call".
      connectSrc: ["'self'", 'wss://*.retellai.com', 'https://*.retellai.com', 'wss://*.livekit.cloud', 'https://*.livekit.cloud', 'wss://phonbot.de', 'https://challenges.cloudflare.com'],
      // Turnstile rendert sich in einem iframe von challenges.cloudflare.com.
      frameSrc: ["'self'", 'https://challenges.cloudflare.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // avoid blocking 3rd-party voice audio
});
await app.register(cors, {
  origin: (process.env.APP_URL ?? 'http://localhost:5173').split(',').map(s => s.trim()),
  credentials: true, // required so the browser sends the refresh-token cookie on /auth/refresh
});

// Global rate limit — 100 req/min per IP
// Retell webhook endpoints are server-to-server calls — exempt from IP-based limiting
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  // Allowlist server-to-server webhooks (have their own signature/auth checks)
  allowList: (req, _key) =>
    req.url.startsWith('/retell/') ||
    req.url.startsWith('/billing/webhook') ||
    req.url.startsWith('/outbound/twiml/') ||
    req.url.startsWith('/outbound/ws/') ||
    req.url.startsWith('/outbound/status/'),
});

// Raw-body capture for Stripe webhook signature verification
// Must be registered before any body parser
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req, body: Buffer, done) => {
    (req as FastifyRequest & { rawBody: Buffer }).rawBody = body;
    // Empty body (e.g. POST /auth/refresh with Content-Type: application/json
    // but no payload) must not crash the parser — return null so the route
    // handler can proceed (it may not use req.body at all).
    if (body.length === 0) return done(null, null);
    try {
      done(null, JSON.parse(body.toString()));
    } catch (e: unknown) {
      done(e instanceof Error ? e : new Error(String(e)), undefined);
    }
  },
);

// JWT — secret MUST be set in production (refuse to boot otherwise)
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production — refusing to start with insecure default');
  }
  app.log.warn('JWT_SECRET not set; using insecure default (dev only)');
}
await app.register(jwt, { secret: jwtSecret ?? 'dev-secret-change-in-prod' });

// Cookie plugin — required for the refresh-token httpOnly cookie used by /auth/refresh.
// Signed with JWT_SECRET so we can detect tampering even though refresh tokens
// are also DB-validated; defence-in-depth.
await app.register(cookie, { secret: jwtSecret ?? 'dev-secret-change-in-prod' });

// Attach app.authenticate decorator used by protected routes
app.decorate('authenticate', async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
  try {
    await req.jwtVerify();
  } catch {
    reply.status(401).send({ error: 'Unauthorized' });
  }
});

try {
  await migrate();
} catch (e) {
  app.log.error({ err: (e as Error).message }, 'DB migration failed — running without database');
}
await connectRedis();
if (!process.env.DATABASE_URL) {
  app.log.warn('DATABASE_URL not set; using in-memory stores (dev fallback).');
}

// Register routes
await registerAuth(app);
await registerTickets(app);
await registerTraces(app);
await registerChat(app);
await registerAgentConfig(app);
await registerRetellWebhooks(app);
await registerBilling(app);
await registerDemo(app);
await registerPhone(app);
await registerCalendar(app);
await registerVoices(app);
await registerInsights(app);
await registerOutbound(app);
await registerTwilioBridge(app);
await registerCopilot(app);
await registerLearningApi(app);
await registerTrainingExport(app);
await registerContact(app);
await registerAdmin(app);

// Additional migrations
for (const fn of [migratePhone, migrateCalendar, migrateOutbound]) {
  try { await fn(); } catch (e) { app.log.error({ err: (e as Error).message }, `Migration failed: ${fn.name}`); }
}

// Global error handler — generic messages in prod to prevent DB/schema leaks.
// D11 hardening: Fastify validation errors expose the entire schema path
// (e.g. `body/orgId must be string`) plus the rejected value; that's a
// fingerprinting + introspection vector. We sanitise validation errors to a
// fixed `'Invalid input'` (the route-level Zod handlers already produce
// detailed-yet-safe responses where verbose feedback is genuinely useful).
const IS_PROD = process.env.NODE_ENV === 'production';
app.setErrorHandler((error: FastifyError, request, reply) => {
  if (SENTRY_DSN) {
    Sentry.captureException(error);
  }
  request.log.error(error);
  const status = error.statusCode ?? 500;
  const isClientError = status >= 400 && status < 500;
  const isValidation = error.validation || error.code === 'FST_ERR_VALIDATION';
  let message: string;
  if (isValidation) {
    message = 'Invalid input';
  } else if (isClientError) {
    message = error.message ?? 'Bad Request';
  } else {
    message = IS_PROD ? 'Internal Server Error' : (error.message ?? 'Internal Server Error');
  }
  reply.status(status).send({ error: message });
});

// Hourly cleanup: mark outbound_calls stuck in 'calling' > 1h as 'timeout'
// (Handles cases where Twilio StatusCallback is missed — VoiceMail, network drop, etc.)
if (pool) {
  const cleanupStuck = async () => {
    try {
      const res = await pool!.query(
        `UPDATE outbound_calls
         SET status = 'timeout'
         WHERE status IN ('calling', 'initiated')
           AND created_at < now() - interval '1 hour'`,
      );
      if ((res as { rowCount?: number }).rowCount) {
        app.log.info({ rows: (res as { rowCount?: number }).rowCount }, 'Cleaned up stuck outbound_calls');
      }
    } catch (e) {
      app.log.warn({ err: (e as Error).message }, 'outbound_calls cleanup failed');
    }
  };
  setInterval(cleanupStuck, 60 * 60 * 1000); // every hour
  // Run once on startup (best-effort, non-blocking)
  setTimeout(cleanupStuck, 30_000);

  // DSGVO Art. 5: purge call_transcripts older than 90 days (daily)
  const runTranscriptCleanup = async () => {
    try {
      const deleted = await cleanupOldTranscripts();
      if (deleted > 0) app.log.info({ deleted }, 'DSGVO retention: purged old call_transcripts');
    } catch (e) {
      app.log.warn({ err: (e as Error).message }, 'DSGVO transcript cleanup failed');
    }
  };
  setInterval(runTranscriptCleanup, 24 * 60 * 60 * 1000); // every 24h
  setTimeout(runTranscriptCleanup, 60_000); // first run 60s after startup

  // DSGVO Art. 5: purge crm_leads older than 90 days (daily)
  const runLeadsCleanup = async () => {
    try {
      const deleted = await cleanupOldLeads();
      if (deleted > 0) app.log.info({ deleted }, 'DSGVO retention: purged old crm_leads');
    } catch (e) {
      app.log.warn({ err: (e as Error).message }, 'DSGVO leads cleanup failed');
    }
  };
  setInterval(runLeadsCleanup, 24 * 60 * 60 * 1000); // every 24h
  setTimeout(runLeadsCleanup, 65_000); // first run 65s after startup (staggered from transcripts)

  // Twilio phone-pool sync: without this, orphan numbers (from deleted orgs or
  // failed provisioning) keep incurring €1/month at Twilio until the next
  // server restart. syncTwilioNumbersToDb() has a 10-min Redis advisory lock
  // so multiple replicas can't stampede Twilio's rate limit. Every 6h is a
  // balance between Twilio API cost and how long orphan numbers linger.
  const runPhoneSync = async () => {
    try { await syncTwilioNumbersToDb(); }
    catch (e) { app.log.warn({ err: (e as Error).message }, 'scheduled phone sync failed'); }
  };
  setInterval(runPhoneSync, 6 * 60 * 60 * 1000); // every 6h
  // Initial startup sync already runs in migratePhone(); don't double it here.

  // Prune webhook-event dedup keys older than 90 days so those tables don't
  // grow unbounded (at 10k calls/month the combined row count adds up fast).
  // Runs daily, staggered from other nightly jobs.
  const runWebhookDedupCleanup = async () => {
    try {
      const { stripe, retell } = await cleanupOldWebhookDedupKeys();
      if (stripe > 0 || retell > 0) {
        app.log.info({ stripe, retell }, 'Pruned old webhook dedup keys');
      }
    } catch (e) {
      app.log.warn({ err: (e as Error).message }, 'webhook dedup cleanup failed');
    }
  };
  setInterval(runWebhookDedupCleanup, 24 * 60 * 60 * 1000); // every 24h
  setTimeout(runWebhookDedupCleanup, 90_000); // first run 90s after startup (staggered)
}

app.get('/health', async () => {
  const checks: Record<string, string> = {};

  // DB check
  if (pool) {
    try {
      await pool.query('SELECT 1');
      checks.db = 'ok';
    } catch {
      checks.db = 'error';
    }
  } else {
    checks.db = 'not_configured';
  }

  // Redis check
  if (redis) {
    try {
      await redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    }
  } else {
    checks.redis = 'not_configured';
  }

  const ok = Object.values(checks).every((v) => v === 'ok' || v === 'not_configured');

  // Read version from package.json (bundled at build time via import)
  let version = 'unknown';
  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version: string };
    version = pkg.version;
  } catch {
    // non-critical
  }

  return {
    ok,
    checks,
    version,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down gracefully…`);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
