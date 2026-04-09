import './env.js'; // must be first — loads .env before anything reads process.env
import { initSentry, Sentry } from './sentry.js';

import Fastify, { type FastifyError, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { migrate, pool } from './db.js';
import { connectRedis, redis } from './redis.js';
import { registerAuth } from './auth.js';
import { registerTickets } from './tickets.js';
import { registerTraces } from './traces.js';
import { registerChat } from './chat.js';
import { registerAgentConfig } from './agent-config.js';
import { registerRetellWebhooks } from './retell-webhooks.js';
import { registerBilling } from './billing.js';
import { registerDemo } from './demo.js';
import { registerPhone, migratePhone } from './phone.js';
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

initSentry();
const SENTRY_DSN = process.env.SENTRY_DSN ?? '';

const app = Fastify({ logger: true });
await app.register(websocket);
await app.register(helmet, {
  contentSecurityPolicy: false, // CSP handled by Caddy / frontend
});
await app.register(cors, {
  origin: (process.env.APP_URL ?? 'http://localhost:5173').split(',').map(s => s.trim()),
});

// Global rate limit — 100 req/min per IP
// Retell webhook endpoints are server-to-server calls — exempt from IP-based limiting
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  allowList: (req, _key) => req.url.startsWith('/retell/'),
});

// Raw-body capture for Stripe webhook signature verification
// Must be registered before any body parser
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req, body: Buffer, done) => {
    (req as FastifyRequest & { rawBody: Buffer }).rawBody = body;
    try {
      done(null, JSON.parse(body.toString()));
    } catch (e: unknown) {
      done(e instanceof Error ? e : new Error(String(e)), undefined);
    }
  },
);

// JWT — secret must be set in production
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) app.log.warn('JWT_SECRET not set; using insecure default (dev only)');
await app.register(jwt, { secret: jwtSecret ?? 'dev-secret-change-in-prod' });

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

// Global error handler
app.setErrorHandler((error: FastifyError, request, reply) => {
  if (SENTRY_DSN) {
    Sentry.captureException(error);
  }
  request.log.error(error);
  reply.status(error.statusCode ?? 500).send({
    error: error.message ?? 'Internal Server Error',
  });
});

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
