import pg from 'pg';
import './env.js'; // ensure dotenv is loaded before we read process.env

const { Pool } = pg;

export const DATABASE_URL = process.env.DATABASE_URL;

// Postgres is optional for now (dev machines without Docker).
export const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 20),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : null;

export async function migrate() {
  if (!pool) {
    // Keep API usable for websocket + UI prototyping.
    // Tickets will fall back to an in-memory store.
    return;
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
}
