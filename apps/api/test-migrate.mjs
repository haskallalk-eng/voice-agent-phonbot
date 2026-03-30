import pg from 'pg';
const pool = new pg.Pool({ connectionString: 'postgresql://postgres:TsBzUNC8yNNLTF2T@db.kmonxrmmkqjvifnaryfi.supabase.co:5432/postgres' });

const queries = [
  `create table if not exists orgs (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    name text not null,
    slug text unique,
    plan text not null default 'free',
    is_active boolean not null default true
  )`,
  `create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    org_id uuid not null references orgs(id) on delete cascade,
    email text unique not null,
    password_hash text not null,
    role text not null default 'member' check (role in ('owner','admin','member')),
    is_active boolean not null default true
  )`,
  `create index if not exists users_org_idx on users(org_id)`,
  `create index if not exists users_email_idx on users(email)`,
  `alter table orgs add column if not exists stripe_customer_id text unique`,
  `alter table orgs add column if not exists stripe_subscription_id text unique`,
  `alter table orgs add column if not exists plan_status text not null default 'free'`,
  `alter table orgs add column if not exists plan_interval text`,
  `alter table orgs add column if not exists current_period_end timestamptz`,
  `alter table orgs add column if not exists minutes_used int not null default 0`,
  `alter table orgs add column if not exists minutes_limit int not null default 30`,
];

for (const q of queries) {
  try {
    await pool.query(q);
    console.log('OK:', q.slice(0, 60));
  } catch (e) {
    console.error('FAIL:', q.slice(0, 60));
    console.error('  =>', e.message);
  }
}

await pool.end();
console.log('\nDone.');
