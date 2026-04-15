import pg from 'pg';
import dns from 'node:dns/promises';
import { URL } from 'node:url';
import './env.js'; // ensure dotenv is loaded before we read process.env

const { Pool } = pg;

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
    ssl: { rejectUnauthorized: false, servername: hostname },
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

export async function migrate() {
  if (!pool) {
    // Keep API usable for websocket + UI prototyping.
    // Tickets will fall back to an in-memory store.
    return;
  }

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
  await pool.query(`alter table orgs add column if not exists stripe_subscription_id text unique;`);
  await pool.query(`alter table orgs add column if not exists plan_status text not null default 'free';`);
  // plan_status: free | trialing | active | past_due | canceled
  await pool.query(`alter table orgs add column if not exists plan_interval text;`); // month | year
  await pool.query(`alter table orgs add column if not exists current_period_end timestamptz;`);
  await pool.query(`alter table orgs add column if not exists minutes_used int not null default 0;`);
  await pool.query(`alter table orgs add column if not exists minutes_limit int not null default 100;`);

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
  await pool.query(`DELETE FROM refresh_tokens WHERE user_id NOT IN (SELECT id FROM users);`).catch(() => {});
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

  // Migrate agent_configs to reference orgs when possible (non-breaking).
  await pool.query(`alter table agent_configs add column if not exists org_id uuid references orgs(id) on delete cascade;`);
  await pool.query(`alter table tickets add column if not exists org_id uuid references orgs(id) on delete cascade;`);

  // In case table existed before these fields were introduced.
  await pool.query(`alter table tickets add column if not exists source text;`);
  await pool.query(`alter table tickets add column if not exists session_id text;`);
  await pool.query(`alter table tickets add column if not exists reason text;`);

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
