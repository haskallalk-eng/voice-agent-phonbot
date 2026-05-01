import pg from 'pg';
import dns from 'node:dns/promises';
import { URL } from 'node:url';
import './env.js'; // ensure dotenv is loaded before we read process.env
import { logBg } from './logger.js';

const { Pool } = pg;

// Parse Postgres NUMERIC/DECIMAL as JS number (not string). By default node-pg
// returns NUMERIC as string to preserve arbitrary precision, but we only use
// NUMERIC for minutes (2 decimals, small values) where float precision is fine.
// Returning numbers avoids string-math bugs at every read site. 1700 = NUMERIC.
pg.types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)) as unknown as string);

export const DATABASE_URL = process.env.DATABASE_URL;

/**
 * On networks where dns.lookup returns ENOENT for IPv6-only hosts,
 * pre-resolve the hostname to its IPv6 address and build pool config manually
 * so pg never needs to call dns.lookup at all.
 */
async function resolveHost(dbUrl: string): Promise<pg.PoolConfig> {
  const parsed = new URL(dbUrl);
  const hostname = parsed.hostname;

  // Time-boxed DNS resolution (5s). Without this, a DNS outage would hang
  // the module import indefinitely and block server startup.
  const dnsWithTimeout = <T>(p: Promise<T>, label: string): Promise<T | null> =>
    Promise.race<T | null>([
      p.catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => { resolve(null); process.stderr.write(`[db] ${label} DNS timeout\n`); }, 5000)),
    ]);

  let resolvedHost = hostname;
  try {
    const v4 = await dnsWithTimeout(dns.resolve4(hostname), 'resolve4');
    if (v4 && v4.length > 0) {
      resolvedHost = v4[0]!;
    } else {
      const v6 = await dnsWithTimeout(dns.resolve6(hostname), 'resolve6');
      if (v6 && v6.length > 0) resolvedHost = v6[0]!;
    }
  } catch {
    // Keep original hostname — let pg try
  }

  return {
    host: resolvedHost,
    port: parsed.port ? parseInt(parsed.port, 10) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),
    ssl: { rejectUnauthorized: process.env.DB_REJECT_UNAUTHORIZED === 'false' ? false : true, servername: hostname },
    max: Number(process.env.PG_POOL_MAX ?? 20),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };
}

// Pool is created lazily after hostname resolution
let _pool: pg.Pool | null = null;
let _poolReady: Promise<void> | null = null;

if (DATABASE_URL) {
  _poolReady = resolveHost(DATABASE_URL).then((config) => {
    _pool = new Pool(config);
  }).catch(() => {
    // Fall back to direct connection string
    _pool = new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 20),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  });
}

// Proxy: awaits lazy pool init, forwards both async methods (query, connect, end)
// and synchronous EventEmitter methods (on, off, addListener, removeListener, emit)
// so that pool.on('error', …) works correctly (avoids Node crash on idle-disconnect).
const EMITTER_METHODS = new Set<string | symbol>([
  'on', 'off', 'addListener', 'removeListener', 'once', 'emit', 'removeAllListeners',
  'listeners', 'rawListeners', 'eventNames', 'listenerCount', 'prependListener', 'prependOnceListener',
  'setMaxListeners', 'getMaxListeners',
]);

// Register error listener once pool is ready (prevents unhandled 'error' crash)
let _errorHandlerAttached = false;
function attachPoolErrorHandler() {
  if (!_pool || _errorHandlerAttached) return;
  _errorHandlerAttached = true;
  _pool.on('error', (err: Error) => {
    process.stderr.write(`[pg pool] Idle client error: ${err.message}\n`);
  });
}

export const pool = DATABASE_URL ? new Proxy({} as pg.Pool, {
  get(_target, prop) {
    if (prop === 'then') return undefined; // not a Promise

    // EventEmitter methods must be forwarded synchronously (can't await — returns `this` for chaining).
    if (typeof prop === 'string' && EMITTER_METHODS.has(prop)) {
      return (...args: unknown[]) => {
        const callFn = (p: pg.Pool) => {
          const fn = (p as unknown as Record<string, unknown>)[prop];
          if (typeof fn === 'function') return (fn as (...a: unknown[]) => unknown).call(p, ...args);
          return undefined;
        };
        if (!_pool) {
          if (!_poolReady) throw new Error('Pool not initialized — DNS init not started');
          _poolReady.then(() => {
            attachPoolErrorHandler();
            if (_pool) callFn(_pool);
          });
          return _target;
        }
        return callFn(_pool);
      };
    }

    // connect() returns a PoolClient directly — needs special handling
    if (prop === 'connect') {
      return async () => {
        if (_poolReady) await _poolReady;
        if (!_pool) throw new Error('Pool not initialized');
        return _pool.connect();
      };
    }
    return async (...args: unknown[]) => {
      if (_poolReady) await _poolReady;
      if (!_pool) throw new Error('Pool not initialized');
      // Register error handler lazily after first query (pool is definitely ready)
      attachPoolErrorHandler();
      return (_pool[prop as keyof pg.Pool] as (...a: unknown[]) => unknown)(...args);
    };
  },
}) : null;

type WebhookHealthSuccessParams = {
  outcome: 'success';
  tenantId: string;
  webhookId: string;
  event: string;
  status: number;
};

type WebhookHealthFailureParams = {
  outcome: 'failure';
  tenantId: string;
  webhookId: string;
  event: string;
  status: number | null;
  error: string;
  failThreshold: number;
  disableDuration: string;
};

type WebhookHealthUpsertParams = WebhookHealthSuccessParams | WebhookHealthFailureParams;

export async function upsertWebhookHealth(
  dbPool: pg.Pool | null,
  params: WebhookHealthUpsertParams,
): Promise<void> {
  if (!dbPool) return;

  if (params.outcome === 'success') {
    // Round-10 Claude-Review (Codex Uncertainty #1): naive `disabled_until = NULL`
    // in the success path can race with a freshly-set disable. Sequence:
    //   T0: parallel fetches A + B start
    //   T1: A completes with 5xx → consecutive_failures bumps to threshold,
    //       disabled_until = now() + 1h
    //   T2: B completes with 2xx (slow but successful) → naive UPDATE wipes
    //       disabled_until back to NULL
    // Guard: only clear disabled_until if it has already expired. A live
    // disable-window stays in force regardless of out-of-order success
    // arrivals; the natural cooldown still kicks in via expiry. consecutive_
    // failures = 0 is fine to reset — even if a later failure re-counts from 1,
    // the disabled_until preservation keeps the skip-decision honest until
    // its TTL.
    await dbPool.query(
      `INSERT INTO inbound_webhook_health (
         tenant_id,
         webhook_id,
         last_status,
         last_event,
         last_error,
         consecutive_failures,
         last_success_at,
         last_attempt_at,
         disabled_until
       )
       VALUES ($1, $2, $3, $4, NULL, 0, now(), now(), NULL)
       ON CONFLICT (tenant_id, webhook_id) DO UPDATE
       SET last_status = EXCLUDED.last_status,
           last_event = EXCLUDED.last_event,
           last_error = NULL,
           consecutive_failures = 0,
           last_success_at = EXCLUDED.last_success_at,
           last_attempt_at = EXCLUDED.last_attempt_at,
           disabled_until = CASE
             WHEN inbound_webhook_health.disabled_until > now()
               THEN inbound_webhook_health.disabled_until
             ELSE NULL
           END`,
      [params.tenantId, params.webhookId, params.status, params.event],
    );
    return;
  }

  await dbPool.query(
    `INSERT INTO inbound_webhook_health (
       tenant_id,
       webhook_id,
       last_status,
       last_event,
       last_error,
       consecutive_failures,
       last_attempt_at,
       disabled_until
     )
     VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       1,
       now(),
       CASE WHEN 1 >= $6 THEN now() + $7::interval ELSE NULL END
     )
     ON CONFLICT (tenant_id, webhook_id) DO UPDATE
     SET last_status = EXCLUDED.last_status,
         last_event = EXCLUDED.last_event,
         last_error = EXCLUDED.last_error,
         consecutive_failures = GREATEST(
           inbound_webhook_health.consecutive_failures + 1,
           EXCLUDED.consecutive_failures
         ),
         last_attempt_at = now(),
         disabled_until = CASE
           WHEN GREATEST(
             inbound_webhook_health.consecutive_failures + 1,
             EXCLUDED.consecutive_failures
           ) >= $6
             THEN GREATEST(
               COALESCE(inbound_webhook_health.disabled_until, '-infinity'::timestamptz),
               now() + $7::interval
             )
           ELSE NULL
         END`,
    [
      params.tenantId,
      params.webhookId,
      params.status,
      params.event,
      params.error,
      params.failThreshold,
      params.disableDuration,
    ],
  );
}

export async function cleanupOldWebhookHealth(dbPool: pg.Pool | null): Promise<number> {
  if (!dbPool) return 0;
  const res = await dbPool.query(
    `DELETE FROM inbound_webhook_health WHERE last_attempt_at < NOW() - INTERVAL '90 days'`,
  );
  return (res as { rowCount?: number }).rowCount ?? 0;
}

// Fixed advisory-lock key for the migration. pg_advisory_lock is a 64-bit
// session-scoped mutex that Postgres provides; any integer works as long as
// every replica uses the same one. Chosen arbitrarily.
const MIGRATION_ADVISORY_LOCK_KEY = 92541803715;

export async function migrate() {
  if (!pool) {
    // Keep API usable for websocket + UI prototyping.
    // Tickets will fall back to an in-memory store.
    return;
  }

  // Serialize concurrent migrate() calls across replicas. Without this, a
  // rolling-deploy with N API containers would run every ALTER / CREATE
  // INDEX in parallel; while each statement is idempotent (`IF NOT EXISTS`),
  // concurrent DDL on the same objects can deadlock or race on constraint
  // creation. pg_advisory_lock blocks until the other holder releases (or
  // until we error out and drop the session — Postgres auto-releases).
  //
  // Uses a dedicated client so the lock's session scope is deterministic:
  // lock + unlock on the same connection, regardless of pool routing.
  const migrationClient = await pool.connect();
  try {
    await migrationClient.query(`SELECT pg_advisory_lock($1)`, [MIGRATION_ADVISORY_LOCK_KEY]);
    try {
      await runMigrationBody();
    } finally {
      await migrationClient.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_ADVISORY_LOCK_KEY]).catch(() => {/* already released */});
    }
  } finally {
    migrationClient.release();
  }
}

async function runMigrationBody() {
  if (!pool) return;

  // ── Encryption-key sanity check ─────────────────────────────────────────
  // If ENCRYPTION_KEY is unset in production BUT there are already encrypted
  // calendar rows in the DB, refuse to boot. Without this, decrypt() silently
  // returns NULL and every calendar integration quietly breaks (user sees
  // "calendar not connected" with no explanation). Fail loud on the server
  // boot instead of debugging why bookings stopped working three days later.
  if (process.env.NODE_ENV === 'production' && !process.env.ENCRYPTION_KEY) {
    try {
      const cnt = await pool.query(
        `SELECT count(*)::int AS n FROM calendar_connections
         WHERE access_token LIKE 'enc:v1:%' OR refresh_token LIKE 'enc:v1:%'`,
      );
      if ((cnt.rows[0]?.n ?? 0) > 0) {
        throw new Error('[db] ENCRYPTION_KEY missing but encrypted calendar tokens exist — refusing to boot (decrypt would silently return NULL for all connections)');
      }
    } catch (e) {
      // If the table doesn't exist yet this is a fresh boot — pass through.
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('does not exist')) throw e;
    }
  }

  // ── Multi-tenant auth ────────────────────────────────────────────────────

  await pool.query(`
    create table if not exists orgs (
      id          uuid primary key default gen_random_uuid(),
      created_at  timestamptz not null default now(),
      name        text not null,
      slug        text unique,
      plan        text not null default 'free',
      is_active   boolean not null default true
    );
  `);

  await pool.query(`
    create table if not exists users (
      id            uuid primary key default gen_random_uuid(),
      created_at    timestamptz not null default now(),
      org_id        uuid not null references orgs(id) on delete cascade,
      email         text unique not null,
      password_hash text not null,
      role          text not null default 'member'
                    check (role in ('owner','admin','member')),
      is_active     boolean not null default true
    );
  `);

  await pool.query(`create index if not exists users_org_idx on users(org_id);`);
  await pool.query(`create index if not exists users_email_idx on users(email);`);

  // Stripe billing columns on orgs (non-breaking)
  await pool.query(`alter table orgs add column if not exists stripe_customer_id text unique;`);
  // Partial unique index: makes the intent explicit that only non-null values
  // must be unique. The column-level UNIQUE above already enforces this for
  // non-nulls (Postgres treats NULLs as distinct), but naming the index
  // clarifies and lets us reason about the guarantee in migrations.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS orgs_stripe_customer_id_notnull_uniq
    ON orgs (stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;
  `);
  await pool.query(`alter table orgs add column if not exists stripe_subscription_id text unique;`);
  await pool.query(`alter table orgs add column if not exists plan_status text not null default 'free';`);
  // plan_status: free | trialing | active | past_due | canceled
  await pool.query(`alter table orgs add column if not exists plan_interval text;`); // month | year
  await pool.query(`alter table orgs add column if not exists current_period_end timestamptz;`);
  await pool.query(`alter table orgs add column if not exists minutes_used int not null default 0;`);
  await pool.query(`alter table orgs add column if not exists minutes_limit int not null default 100;`);

  // Migrate minutes_used to NUMERIC(10,2) so we can bill to-the-second accuracy
  // instead of rounding every call up to the next full minute (Math.ceil was
  // ~10% over-billing the customer on short calls). Idempotent: the DO block
  // checks data_type before running ALTER. minutes_limit stays INT since
  // plans always quote whole-minute quotas.
  await pool.query(`
    DO $$
    BEGIN
      IF (SELECT data_type FROM information_schema.columns
          WHERE table_name='orgs' AND column_name='minutes_used') = 'integer' THEN
        ALTER TABLE orgs
          ALTER COLUMN minutes_used TYPE NUMERIC(10,2)
          USING minutes_used::NUMERIC(10,2);
      END IF;
    END $$;
  `);

  // Twilio subaccount + regulatory compliance
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS twilio_subaccount_sid text;`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS twilio_address_sid text;`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS twilio_bundle_sid text;`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS twilio_bundle_status text DEFAULT 'none';`);
  // bundle_status: none | draft | pending-review | in-review | twilio-approved | twilio-rejected
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS business_street text;`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS business_city text;`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS business_postal_code text;`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS business_document_url text;`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS business_website text;`);

  // Cross-org pattern sharing — opt-in (GDPR Art. 6 consent basis).
  // When TRUE, this org's high-scoring call patterns may be redacted and
  // contributed to the cross-tenant conversation_patterns pool. Default FALSE
  // so existing orgs aren't auto-enrolled — they must explicitly opt in via
  // settings (with a link to AGB §X about pattern sharing).
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS share_patterns boolean NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS share_patterns_consented_at timestamptz;`);

  // Refresh tokens for the 1h-access + 30d-refresh JWT scheme. We store the
  // SHA-256 hash so a DB read leak doesn't yield usable tokens. Rotation:
  // /auth/refresh deletes the row + inserts a new one in one transaction.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL,
      token_hash  TEXT NOT NULL UNIQUE,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at  TIMESTAMPTZ,
      user_agent  TEXT,
      ip          TEXT
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens(user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS refresh_tokens_expires_idx ON refresh_tokens(expires_at);`);
  // FK to users + ON DELETE CASCADE — when a user is deleted (account delete,
  // org delete cascade), all refresh tokens must go too. Without this, a
  // deleted account's stolen refresh cookie could resurrect as long as the
  // token row survives its own TTL.
  //
  // ORDER MATTERS: clean orphans BEFORE adding the FK, otherwise
  // ADD CONSTRAINT fails on existing deployments where orphan rows exist
  // (pre-FK users who got deleted manually). Idempotent DO block because
  // IF NOT EXISTS isn't supported on constraints directly.
  await pool.query(`DELETE FROM refresh_tokens WHERE user_id NOT IN (SELECT id FROM users);`).catch(logBg('cleanup-orphan-refresh-tokens'));
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'refresh_tokens_user_id_fkey'
      ) THEN
        ALTER TABLE refresh_tokens
          ADD CONSTRAINT refresh_tokens_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  // Stripe webhook idempotency. Stripe retries events on any non-2xx (and
  // sometimes on timeouts). Without a dedup key, a retried invoice.paid could
  // trigger a second period-reset or a retried subscription.deleted could
  // re-cascade cleanup. The PRIMARY KEY on event_id is the dedup mechanism.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_stripe_events (
      event_id    TEXT PRIMARY KEY,
      event_type  TEXT NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS processed_stripe_events_received_idx ON processed_stripe_events(received_at);`);

  // Failed-invoice-items dead-letter queue. When billing.ts overage / premium-
  // voice charges hit a transient Stripe failure (network, 5xx, customer-id
  // drift), the row is parked here so a cron job can retry it instead of
  // silently losing the charge. idempotency_key prevents Stripe from creating
  // duplicate invoice items if the original call actually succeeded server-
  // side and we just didn't see the response. succeeded_at marks completion;
  // retry_count caps the cron loop.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS failed_invoice_items (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      org_id          UUID NOT NULL,
      kind            TEXT NOT NULL,
      amount_cents    INTEGER NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'eur',
      description     TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      metadata        JSONB,
      last_error      TEXT,
      retry_count     INTEGER NOT NULL DEFAULT 0,
      last_retry_at   TIMESTAMPTZ,
      succeeded_at    TIMESTAMPTZ
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS failed_invoice_items_pending_idx ON failed_invoice_items(succeeded_at, retry_count) WHERE succeeded_at IS NULL;`);

  // Retell webhook idempotency. Retell retries call_ended on non-2xx or timeout.
  // Without dedup, a retried call_ended runs reconcileMinutes twice -> double
  // overage charge (€9 bill becomes €28 on 3x retries) and double analyzeCall
  // (doubles OpenAI analysis cost). PRIMARY KEY on call_id is the dedup key.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_retell_events (
      call_id     TEXT NOT NULL,
      event_type  TEXT NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Audit-Round-10 BLOCKER 1: PK was historically (call_id) which prevented
  // dedup of distinct event types for the same call (call_ended +
  // call_analyzed both fire for the same call_id). Composite PK lets each
  // event-type-per-call dedup independently. Migration: drop old PK if it
  // exists with the single-column shape, then create the composite PK.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'processed_retell_events'
          AND c.contype = 'p'
          AND array_length(c.conkey, 1) = 1
      ) THEN
        ALTER TABLE processed_retell_events DROP CONSTRAINT processed_retell_events_pkey;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'processed_retell_events' AND c.contype = 'p'
      ) THEN
        ALTER TABLE processed_retell_events ADD PRIMARY KEY (call_id, event_type);
      END IF;
    END$$;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS processed_retell_events_received_idx ON processed_retell_events(received_at);`);

  // § 201 StGB / Art. 6 DSGVO: when the caller declines recording mid-call,
  // the agent invokes the recording_declined tool. We flag the call here;
  // the call_ended webhook reads the flag, skips transcript persistence,
  // and DELETEs the call from Retell to scrub audio + transcript.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recording_declined_calls (
      call_id     TEXT PRIMARY KEY,
      org_id      TEXT,
      tenant_id   TEXT,
      declined_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Stripe-first registrations: stash credentials + org details here when the
  // user submits the register form. Real user + org rows are only created
  // after Stripe checkout succeeds (webhook or finalize-checkout endpoint).
  // A Stripe cancel leaves the pending row orphaned → cleaned up after 1h.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_registrations (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email               TEXT NOT NULL,
      org_name            TEXT NOT NULL,
      password_hash       TEXT NOT NULL,
      plan_id             TEXT NOT NULL,
      billing_interval    TEXT NOT NULL DEFAULT 'month',
      stripe_session_id   TEXT UNIQUE,
      stripe_customer_id  TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS pending_registrations_email_idx ON pending_registrations(email);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS pending_registrations_session_idx ON pending_registrations(stripe_session_id);`);

  // One-time cleanup: delete orphan tickets (org_id IS NULL). These existed from
  // pre-auth days when /tickets was unauthenticated and tenant_id was a free-form
  // string. The legacy "OR (org_id IS NULL AND tenant_id = $orgId::text)" branches
  // in tickets.ts let an attacker with a known orgId UUID see/modify those rows by
  // forging tenant_id. Branches removed; rows must go too. Idempotent.
  await pool.query(`DELETE FROM tickets WHERE org_id IS NULL;`).catch(() => {/* table may not exist yet */});

  // ── Minimal, idempotent schema creation (MVP) ─────────────────────────────

  await pool.query(`
    create table if not exists tickets (
      id bigserial primary key,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),

      tenant_id text not null default 'demo',

      status text not null default 'open',

      -- Handoff context
      source text,
      session_id text,
      reason text,

      customer_name text,
      customer_phone text not null,
      preferred_time text,
      service text,
      notes text
    );
  `);

  await pool.query(`
    create table if not exists agent_configs (
      tenant_id text primary key,
      updated_at timestamptz not null default now(),
      data jsonb not null
    );
  `);

  // Index for JSONB lookups on agent_configs (used by org-id-cache.ts for webhook routing)
  await pool.query(`CREATE INDEX IF NOT EXISTS agent_configs_retell_agent_id_idx ON agent_configs ((data->>'retellAgentId'));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS agent_configs_retell_cb_agent_id_idx ON agent_configs ((data->>'retellCallbackAgentId'));`);

  // Migrate agent_configs to reference orgs when possible (non-breaking).
  await pool.query(`alter table agent_configs add column if not exists org_id uuid references orgs(id) on delete cascade;`);
  await pool.query(`alter table tickets add column if not exists org_id uuid references orgs(id) on delete cascade;`);

  // Audit-Round-12 (review-pass perf agent): without this index the
  // LATERAL-JOIN COUNT(*) on /admin/orgs sequentially scans agent_configs
  // per org row. Same applies to any org-scoped lookup of an agent.
  await pool.query(`CREATE INDEX IF NOT EXISTS agent_configs_org_id_idx ON agent_configs(org_id);`);
  // Note: the partial composite index on outbound_calls (org_id, status)
  // WHERE conv_score IS NOT NULL lives in migrateOutbound() because the
  // outbound_calls table itself is created there. Doing it here would
  // throw on a fresh DB whose outbound schema has not been initialised.

  // Audit-Round-7 HIGH-3: surface Retell-LLM-sync failures (insights.setPrompt
  // fire-and-forget). Frontend banner can read these and prompt re-deploy.
  await pool.query(`alter table agent_configs add column if not exists last_retell_sync_error text;`);
  await pool.query(`alter table agent_configs add column if not exists last_retell_sync_at timestamptz;`);

  // Audit-Round-7 MEDIUM-3 (Codex): cancel zombie A/B-tests that started
  // before the 2026-04-23 auto-apply-disable date. recordAbTestCall would
  // otherwise keep accumulating variant_scores and eventually trigger an
  // unintended evaluateAbTest rollback. Idempotent — only fires while there
  // are stale 'running' rows older than the cutoff.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ab_tests') THEN
        UPDATE ab_tests
          SET status = 'cancelled',
              decision_reason = COALESCE(decision_reason, 'auto-apply disabled 2026-04-23'),
              completed_at = COALESCE(completed_at, now())
        WHERE status = 'running'
          AND created_at < '2026-04-23'::timestamptz;
      END IF;
    END $$;
  `);

  await pool.query(`
    create table if not exists knowledge_files (
      id uuid primary key default gen_random_uuid(),
      created_at timestamptz not null default now(),
      org_id uuid not null references orgs(id) on delete cascade,
      tenant_id text not null,
      filename text not null,
      mime_type text not null,
      size_bytes int not null,
      sha256 text not null,
      data bytea not null
    );
  `);
  await pool.query(`create index if not exists knowledge_files_org_tenant_idx on knowledge_files(org_id, tenant_id);`);
  await pool.query(`
    create unique index if not exists knowledge_files_org_tenant_sha_idx
    on knowledge_files(org_id, tenant_id, sha256);
  `);

  // In case table existed before these fields were introduced.
  await pool.query(`alter table tickets add column if not exists source text;`);
  await pool.query(`alter table tickets add column if not exists session_id text;`);
  await pool.query(`alter table tickets add column if not exists reason text;`);
  // Phase 2: custom fields extracted from the call transcript via Retell
  // post_call_analysis_data. Written by retell-webhooks on call_ended /
  // call_analyzed (jsonb concat so late-arriving analyses don't clobber
  // an already-populated metadata).
  await pool.query(`alter table tickets add column if not exists metadata jsonb not null default '{}'::jsonb;`);

  await pool.query(`
    create index if not exists tickets_tenant_created_idx
    on tickets (tenant_id, created_at desc);
  `);

  await pool.query(`
    create index if not exists tickets_tenant_status_idx
    on tickets (tenant_id, status);
  `);

  await pool.query(`
    create index if not exists tickets_session_idx
    on tickets (session_id);
  `);

  // ── Email verification columns on users ───────────────────────────────────
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token TEXT;`);
  // Expiry for the verify token (14d at issue time). Pre-existing tokens
  // without expiry stay valid (NULL = no expiry, treated as still-active in
  // the WHERE clause); new ones get a deadline.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token_expires_at TIMESTAMPTZ;`);

  // ── Password resets ────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used       BOOLEAN NOT NULL DEFAULT false
    );
  `);

  // ── Admin read-audit log ──────────────────────────────────────────────────
  // Audit-Round-8 (Codex M07-MEDIUM-C): platform-admin endpoints (/admin/leads,
  // /admin/leads/stats, /admin/demo-calls) read across orgs. Without an audit
  // trail a compromised admin token can bulk-exfiltrate invisibly. Each
  // GET to a bulk-read endpoint inserts one row here; DSGVO Art. 5(1)(e)
  // 365-day retention via cleanupOldAuditLogs() in index.ts cron.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_read_audit_log (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      admin_email   TEXT NOT NULL,
      route         TEXT NOT NULL,
      params        JSONB,
      result_count  INTEGER,
      ip            TEXT
    );
  `);
  await pool.query(`COMMENT ON TABLE admin_read_audit_log IS 'DSGVO Art. 5(1)(e): 365-day retention via cleanupOldAuditLogs(). Each row = one cross-org admin GET on a bulk-read endpoint (leads/demo-calls).';`);
  await pool.query(`CREATE INDEX IF NOT EXISTS admin_read_audit_log_created_idx ON admin_read_audit_log(created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS admin_read_audit_log_admin_idx ON admin_read_audit_log(admin_email, created_at DESC);`);

  // ── Privacy-setting changes audit ─────────────────────────────────────────
  // Audit-Round-11 (Codex post-deploy review): DSGVO Art. 5 Abs. 2 / Art. 24
  // Rechenschaftspflicht braucht persistenten Audit-Trail für privacy-toggles
  // (recordCalls etc.). log.info → Sentry-breadcrumb reicht nicht — Sentry-
  // retention ist plan-abhängig, nicht garantiert lange genug für Behörden-
  // prüfungen. 365-day retention via cleanupOldPrivacySettingChanges().
  await pool.query(`
    CREATE TABLE IF NOT EXISTS privacy_setting_changes (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      org_id        UUID,
      tenant_id     TEXT NOT NULL,
      setting       TEXT NOT NULL,
      value_before  TEXT,
      value_after   TEXT,
      changed_by    TEXT
    );
  `);
  await pool.query(`COMMENT ON TABLE privacy_setting_changes IS 'DSGVO Art. 5 Abs. 2 Rechenschaftspflicht: log every change of a privacy-relevant config toggle (recordCalls, share_patterns, dataRetentionDays, ...). 365-day retention via cleanupOldPrivacySettingChanges().';`);
  await pool.query(`CREATE INDEX IF NOT EXISTS privacy_setting_changes_tenant_idx ON privacy_setting_changes(tenant_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS privacy_setting_changes_org_idx ON privacy_setting_changes(org_id, created_at DESC) WHERE org_id IS NOT NULL;`);

  // Audit-Round-9 (Claude/Codex NICE-2): track per-webhook health so repeated
  // 5xx/timeouts can self-disable for 1h instead of burning hot-path time
  // forever. 90-day retention via cleanupOldWebhookHealth() in index.ts cron.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inbound_webhook_health (
      tenant_id            TEXT NOT NULL,
      webhook_id           TEXT NOT NULL,
      last_status          INTEGER,
      last_event           TEXT,
      last_error           TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_success_at      TIMESTAMPTZ,
      last_attempt_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      disabled_until       TIMESTAMPTZ,
      PRIMARY KEY (tenant_id, webhook_id)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS inbound_webhook_health_disabled_idx
      ON inbound_webhook_health (disabled_until)
      WHERE disabled_until IS NOT NULL;
  `);

  // ── AI Insights ────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_analyses (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id           UUID NOT NULL,
      call_id          TEXT NOT NULL,
      score            INT NOT NULL,
      bad_moments      JSONB NOT NULL DEFAULT '[]',
      overall_feedback TEXT NOT NULL DEFAULT '',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(call_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS call_analyses_org_id ON call_analyses(org_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS prompt_suggestions (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id              UUID NOT NULL,
      category            TEXT NOT NULL,
      issue_summary       TEXT NOT NULL,
      suggested_addition  TEXT NOT NULL,
      occurrence_count    INT NOT NULL DEFAULT 1,
      status              TEXT NOT NULL DEFAULT 'pending',
      applied_at          TIMESTAMPTZ,
      effectiveness       TEXT,
      all_examples        JSONB,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS prompt_suggestions_org_id ON prompt_suggestions(org_id, status);`);
  await pool.query(`ALTER TABLE prompt_suggestions ADD COLUMN IF NOT EXISTS effectiveness TEXT;`);
  await pool.query(`ALTER TABLE prompt_suggestions ADD COLUMN IF NOT EXISTS all_examples JSONB;`);
  await pool.query(`ALTER TABLE prompt_suggestions ADD COLUMN IF NOT EXISTS embedding JSONB;`);

  // ── Prompt versions (for rollback) ─────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prompt_versions (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id        UUID NOT NULL,
      prompt        TEXT NOT NULL,
      reason        TEXT NOT NULL DEFAULT '',
      avg_score     NUMERIC(4,2),
      call_count    INT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS prompt_versions_org_id ON prompt_versions(org_id);`);

  // ── A/B Tests ───────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ab_tests (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id              UUID NOT NULL,
      suggestion_id       UUID NOT NULL,
      variant_prompt      TEXT NOT NULL,
      control_prompt      TEXT NOT NULL,
      control_avg_score   NUMERIC(4,2),
      calls_target        INT NOT NULL DEFAULT 8,
      variant_calls       INT NOT NULL DEFAULT 0,
      variant_scores      JSONB NOT NULL DEFAULT '[]',
      status              TEXT NOT NULL DEFAULT 'running',
      decision_reason     TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at        TIMESTAMPTZ
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS ab_tests_org_status ON ab_tests(org_id, status);`);

  // ── Learning System: Call Transcripts ─────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_transcripts (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id       UUID NOT NULL,
      call_id      TEXT NOT NULL UNIQUE,
      direction    TEXT NOT NULL DEFAULT 'inbound',
      transcript   TEXT NOT NULL,
      duration_sec INT,
      from_number  TEXT,
      to_number    TEXT,
      template_id  TEXT,
      industry     TEXT,
      agent_prompt TEXT,
      score        NUMERIC(4,2),
      conv_score   NUMERIC(4,2),
      outcome      TEXT,
      bad_moments  JSONB,
      metadata     JSONB DEFAULT '{}',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_transcripts_org ON call_transcripts(org_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_transcripts_industry ON call_transcripts(industry);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_transcripts_score ON call_transcripts(score);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_transcripts_created ON call_transcripts(created_at DESC);`);
  // Audit-Round-17 (R16 self-finding): partial index dedicated to the
  // industry-backfill Phase-2 batch loop (insights.ts:1647). Without this,
  // each 1000-row batch triggers a sequential scan over the org_id slice
  // re-evaluating `industry IS NULL OR industry = ''` per row. Partial
  // indexes are tiny because they only cover rows matching the predicate —
  // shrinks to zero once the org is fully backfilled, then auto-grows
  // again only if NULL transcripts are inserted (which they shouldn't, but
  // defence-in-depth is cheap).
  //
  // CONCURRENTLY (Codex Round-17 BLOCKER): the rest of migrate() runs in
  // an implicit transaction-less context, but the *first* prod rollout of
  // this index would otherwise take ACCESS EXCLUSIVE on call_transcripts
  // and freeze every active call's transcript-write for the duration of
  // the build. CONCURRENTLY does a two-pass build that only takes a brief
  // SHARE UPDATE EXCLUSIVE lock — concurrent INSERTs proceed normally.
  // Trade-off: CONCURRENTLY can fail (e.g. constraint conflict) and leave
  // an INVALID index — wrap in try/catch so a failed build doesn't crash
  // boot. The route still works without the index (just slower); a manual
  // DROP + retry by ops handles the recovery path. NB: CONCURRENTLY cannot
  // run inside a transaction block, so this MUST stay a top-level
  // pool.query, not be hoisted into any future BEGIN/COMMIT migration
  // wrapper.
  try {
    await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transcripts_org_industry_null
      ON call_transcripts(org_id)
      WHERE industry IS NULL OR industry = '';
    `);
  } catch (err) {
    process.stderr.write(
      `[db] WARNING: idx_transcripts_org_industry_null CONCURRENTLY build failed: ${(err as Error).message}\n` +
      `Backfill route Phase-2 will fall back to sequential scans. ` +
      `Manual recovery: DROP INDEX IF EXISTS idx_transcripts_org_industry_null; then retry CREATE INDEX CONCURRENTLY.\n`,
    );
  }

  // ── Satisfaction signals columns (added in learning v2) ───────────────────
  await pool.query(`ALTER TABLE call_transcripts ADD COLUMN IF NOT EXISTS satisfaction_score NUMERIC(4,2);`);
  await pool.query(`ALTER TABLE call_transcripts ADD COLUMN IF NOT EXISTS satisfaction_signals JSONB;`);
  await pool.query(`ALTER TABLE call_transcripts ADD COLUMN IF NOT EXISTS repeat_caller BOOLEAN DEFAULT false;`);
  await pool.query(`ALTER TABLE call_transcripts ADD COLUMN IF NOT EXISTS disconnection_reason TEXT;`);

  // ── Learning System: Template Learnings ───────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS template_learnings (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id   TEXT NOT NULL,
      learning_type TEXT NOT NULL DEFAULT 'prompt_rule',
      content       TEXT NOT NULL,
      source_count  INT NOT NULL DEFAULT 1,
      avg_impact    NUMERIC(4,2),
      confidence    NUMERIC(3,2),
      embedding     JSONB,
      status        TEXT NOT NULL DEFAULT 'pending',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_at    TIMESTAMPTZ
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tl_template ON template_learnings(template_id, status);`);

  // ── Learning System: Conversation Patterns ────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversation_patterns (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      direction      TEXT NOT NULL DEFAULT 'inbound',
      industry       TEXT,
      pattern_type   TEXT NOT NULL,
      situation      TEXT NOT NULL,
      agent_response TEXT NOT NULL,
      effectiveness  NUMERIC(4,2),
      usage_count    INT NOT NULL DEFAULT 0,
      source_calls   INT NOT NULL DEFAULT 0,
      embedding      JSONB,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_patterns_industry ON conversation_patterns(industry, pattern_type);`);

  // ── Learning System: Training Examples ───────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS training_examples (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      example_type  TEXT NOT NULL DEFAULT 'chat_completion',
      direction     TEXT NOT NULL,
      industry      TEXT,
      system_prompt TEXT,
      messages      JSONB NOT NULL,
      score         NUMERIC(4,2),
      quality_label TEXT,
      metadata      JSONB DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Multi-tenant isolation + GDPR cascade — so /learning/export can filter by org
  // and org-delete cleanly removes training examples.
  await pool.query(`ALTER TABLE training_examples ADD COLUMN IF NOT EXISTS org_id UUID;`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_examples_org_fk') THEN
        ALTER TABLE training_examples
          ADD CONSTRAINT training_examples_org_fk
          FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_training_industry ON training_examples(industry, quality_label);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_training_org ON training_examples(org_id);`);

  // ── DSGVO Art. 5 retention comment on call_transcripts ─────────────────
  await pool.query(`COMMENT ON TABLE call_transcripts IS 'DSGVO Art. 5: 90-day retention policy. Rows older than 90 days are purged daily by cleanupOldTranscripts().';`);

  // Retrofit FK on call_transcripts (added org_id originally without cascade)
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='call_transcripts' AND column_name='org_id')
         AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_transcripts_org_fk') THEN
        BEGIN
          ALTER TABLE call_transcripts
            ADD CONSTRAINT call_transcripts_org_fk
            FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;
        EXCEPTION WHEN others THEN
          -- ignore if rows reference missing orgs (pre-existing data); can be cleaned up manually
          NULL;
        END;
      END IF;
    END $$;
  `);
}

/**
 * DSGVO Art. 5 — Data minimisation: delete call transcripts older than 90 days.
 * Called on startup and then every 24 hours via setInterval in index.ts.
 */
export async function cleanupOldTranscripts(): Promise<number> {
  if (!pool) return 0;
  const res = await pool.query(
    `DELETE FROM call_transcripts WHERE created_at < NOW() - INTERVAL '90 days'`,
  );
  return (res as { rowCount?: number }).rowCount ?? 0;
}

/**
 * Purge processed webhook-event dedup keys older than 90 days.
 *
 * processed_stripe_events and processed_retell_events exist only to reject
 * retried webhooks within the window a provider would actually retry (Stripe
 * retries for up to 3 days, Retell typically minutes). 90 days is a generous
 * buffer. Without this cleanup both tables grow ~300k rows per 10k
 * calls/month and eventually degrade query plans on the PRIMARY KEY lookup.
 */
export async function cleanupOldWebhookDedupKeys(): Promise<{ stripe: number; retell: number }> {
  if (!pool) return { stripe: 0, retell: 0 };
  const [stripeRes, retellRes] = await Promise.all([
    pool.query(`DELETE FROM processed_stripe_events WHERE received_at < NOW() - INTERVAL '90 days'`),
    pool.query(`DELETE FROM processed_retell_events WHERE received_at < NOW() - INTERVAL '90 days'`),
  ]);
  return {
    stripe: (stripeRes as { rowCount?: number }).rowCount ?? 0,
    retell: (retellRes as { rowCount?: number }).rowCount ?? 0,
  };
}

/**
 * Audit-Round-8 (Codex M07-MEDIUM-C): purge admin_read_audit_log rows
 * older than 365 days. Long retention so security incidents have a useful
 * forensic trail; daily cron in index.ts.
 */
export async function cleanupOldAuditLogs(): Promise<number> {
  if (!pool) return 0;
  const res = await pool.query(
    `DELETE FROM admin_read_audit_log WHERE created_at < NOW() - INTERVAL '365 days'`,
  ).catch(() => null);
  return (res as { rowCount?: number } | null)?.rowCount ?? 0;
}

/**
 * Audit-Round-11: purge privacy_setting_changes rows older than 365 days
 * — the same retention as admin_read_audit_log. Same daily cron, staggered.
 */
export async function cleanupOldPrivacySettingChanges(): Promise<number> {
  if (!pool) return 0;
  const res = await pool.query(
    `DELETE FROM privacy_setting_changes WHERE created_at < NOW() - INTERVAL '365 days'`,
  ).catch(() => null);
  return (res as { rowCount?: number } | null)?.rowCount ?? 0;
}

/**
 * DSGVO Art. 5 — Data minimisation: delete CRM leads older than 90 days.
 * Called on startup and then every 24 hours via setInterval in index.ts.
 */
export async function cleanupOldLeads(): Promise<number> {
  if (!pool) return 0;
  const res = await pool.query(
    `DELETE FROM crm_leads WHERE created_at < NOW() - INTERVAL '90 days'`,
  );
  // Demo-call retention mirrors crm_leads — same 90-day cap.
  await pool.query(
    `DELETE FROM demo_calls WHERE created_at < NOW() - INTERVAL '90 days'`,
  ).catch(() => { /* table may not exist yet on first boot */ });
  // Meta-learning artifacts (admin corrections + decisions) retain longer —
  // they're training-data signal, not personal-data per se. But original_text
  // can carry call-quote fragments, so DSGVO Art. 5(1)(e) Speicherbegrenzung
  // applies. 365 days balances "useful as few-shot history" against PII
  // exposure window. Same horizon for learning_decisions so the audit trail
  // and the corrections-feed stay aligned.
  await pool.query(
    `DELETE FROM learning_corrections WHERE created_at < NOW() - INTERVAL '365 days'`,
  ).catch(() => { /* table may not exist yet on first boot */ });
  await pool.query(
    `DELETE FROM learning_decisions WHERE created_at < NOW() - INTERVAL '365 days'`,
  ).catch(() => { /* table may not exist yet on first boot */ });
  // Prompt-edit history mirrors meta-learning retention. Same trade-off:
  // useful as audit trail, but the stored text can carry quotes from
  // transcripts, so capping at 365d.
  await pool.query(
    `DELETE FROM prompt_override_history WHERE created_at < NOW() - INTERVAL '365 days'`,
  ).catch(() => { /* table may not exist yet on first boot */ });
  // Audit-Round-9 H3: durable agent_id → template_id map for demo webhooks.
  // Mappings older than 30 days are dead weight (Retell agents have long
  // since rotated; no incoming webhook would still need them).
  await pool.query(
    `DELETE FROM demo_agent_templates WHERE created_at < NOW() - INTERVAL '30 days'`,
  ).catch(() => { /* table may not exist yet on first boot */ });
  return (res as { rowCount?: number }).rowCount ?? 0;
}

/**
 * Sweep pending_registrations rows that are older than STALE_MIN minutes
 * (= user started Stripe checkout and never came back, whether they
 * cancelled or just closed the tab). Turn each into a CRM lead + send
 * a "pick-up-where-you-left-off" email, then drop the pending row.
 *
 * Safe to call repeatedly: LIMIT + DELETE RETURNING means we process each
 * row exactly once. Called on startup and every 10 min via setInterval.
 *
 * STALE_MIN=30 gives the webhook + finalize path plenty of time to win
 * before we assume the user abandoned. Too short = we email someone who's
 * still typing their card number; too long = re-engagement email lands
 * when they've already forgotten us.
 */
export async function sweepAbandonedRegistrations(): Promise<number> {
  if (!pool) return 0;
  const STALE_MIN = 30;

  // DELETE ... RETURNING pops the rows atomically so a parallel call can't
  // see them. We only act on rows that still have NO corresponding user —
  // this covers the race where a webhook materialised the user after we
  // read the pending but before we DELETEd it.
  const res = await pool.query(
    `DELETE FROM pending_registrations p
       WHERE p.created_at < NOW() - (INTERVAL '1 minute' * $1)
         AND NOT EXISTS (SELECT 1 FROM users u WHERE u.email = p.email)
       RETURNING p.email, p.org_name, p.plan_id, p.billing_interval`,
    [STALE_MIN],
  );
  const rows = (res.rows ?? []) as Array<{
    email: string; org_name: string; plan_id: string; billing_interval: 'month' | 'year';
  }>;
  if (rows.length === 0) return 0;

  // Lazy-import email module so the worker bootstrap can run without
  // Resend configured (e.g. dev). Lazy import also breaks the auth → email
  // circular possibility.
  const { sendSignupAbandonedEmail } = await import('./email.js');

  const PLAN_DISPLAY: Record<string, string> = {
    nummer: 'Nummer', starter: 'Starter', pro: 'Professional', agency: 'Agency', free: 'Free',
  };

  for (const r of rows) {
    try {
      await pool.query(
        `INSERT INTO crm_leads (email, name, source, status, notes)
         VALUES ($1, $2, 'signup-abandoned', 'new', $3)`,
        [r.email, r.org_name, `Plan: ${r.plan_id} (${r.billing_interval})`],
      );
    } catch (err) {
      // Likely duplicate (same email sent two abandoned signups in 30min).
      // Not fatal — log via stderr and keep going.
      process.stderr.write(`[sweep] crm_leads insert failed for ${r.email}: ${(err as Error).message}\n`);
    }

    sendSignupAbandonedEmail({
      toEmail: r.email,
      orgName: r.org_name,
      planName: PLAN_DISPLAY[r.plan_id] ?? r.plan_id,
      planId: r.plan_id,
      interval: r.billing_interval,
    }).catch(() => {/* email module logs internally */});
  }

  return rows.length;
}
