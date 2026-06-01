-- Temporary protection windows for Retell KBs that must not be swept as
-- orphans while deploys settle or rollback standby is active.

create table if not exists public.retell_kb_protection_windows (
  knowledge_base_id text primary key,
  org_id uuid references public.orgs(id) on delete cascade,
  tenant_id text,
  reason text not null check (reason in ('pending_deploy', 'rollback_standby', 'manual_hold')),
  expires_at timestamptz not null,
  context jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists retell_kb_protection_windows_active_idx
  on public.retell_kb_protection_windows(expires_at);

create index if not exists retell_kb_protection_windows_org_idx
  on public.retell_kb_protection_windows(org_id, tenant_id, expires_at desc);

alter table public.retell_kb_protection_windows enable row level security;
revoke all on table public.retell_kb_protection_windows from anon, authenticated;

comment on table public.retell_kb_protection_windows is
  'Retell KB IDs protected from orphan cleanup during pending deploy and rollback standby windows.';
