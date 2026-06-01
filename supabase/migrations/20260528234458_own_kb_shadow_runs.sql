-- Own KB shadow / dual-read telemetry.
--
-- This is a read-only rollout evidence layer: it records redacted transcript
-- questions and own-KB retrieval results without changing live Retell behavior.

create table if not exists public.kb_shadow_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  agent_id text,
  name text not null,
  source text not null default 'transcripts'
    check (source in ('transcripts', 'manual', 'ci')),
  status text not null default 'running'
    check (status in ('running', 'done', 'failed')),
  sample_size int not null default 0 check (sample_size >= 0),
  config jsonb not null default '{}',
  summary jsonb not null default '{}',
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index if not exists kb_shadow_runs_id_scope_uidx
  on public.kb_shadow_runs(id, org_id, tenant_id);

create table if not exists public.kb_shadow_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  agent_id text,
  call_id text,
  turn_index int,
  query_hash text not null,
  query_text_redacted text not null,
  own_answerable boolean not null,
  own_confidence numeric(4,3) not null default 0,
  own_latency_ms int not null check (own_latency_ms >= 0),
  own_citations jsonb not null default '[]',
  retrieval_event_id uuid,
  status text not null check (status in ('answerable', 'not_answerable', 'error', 'skipped')),
  failure_reason text,
  baseline_provider text not null default 'retell_kb_production',
  baseline_signal text not null default 'unknown'
    check (baseline_signal in ('retell_answered', 'retell_abstained', 'unknown')),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kb_shadow_results_run_scope_fk') then
    alter table public.kb_shadow_results
      add constraint kb_shadow_results_run_scope_fk
      foreign key (run_id, org_id, tenant_id)
      references public.kb_shadow_runs(id, org_id, tenant_id)
      on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'kb_shadow_results_retrieval_event_scope_fk') then
    alter table public.kb_shadow_results
      add constraint kb_shadow_results_retrieval_event_scope_fk
      foreign key (retrieval_event_id, org_id, tenant_id)
      references public.kb_retrieval_events(id, org_id, tenant_id)
      on delete no action;
  end if;
end $$;

create index if not exists kb_shadow_runs_scope_idx
  on public.kb_shadow_runs(org_id, tenant_id, started_at desc);

create index if not exists kb_shadow_runs_agent_idx
  on public.kb_shadow_runs(org_id, tenant_id, agent_id, started_at desc);

create index if not exists kb_shadow_results_run_idx
  on public.kb_shadow_results(run_id, status);

create index if not exists kb_shadow_results_scope_idx
  on public.kb_shadow_results(org_id, tenant_id, created_at desc);

create index if not exists kb_shadow_results_call_idx
  on public.kb_shadow_results(call_id, turn_index)
  where call_id is not null;

create unique index if not exists kb_shadow_results_run_query_uidx
  on public.kb_shadow_results(run_id, coalesce(call_id, ''), coalesce(turn_index, -1), query_hash);

create index if not exists kb_shadow_results_expires_idx
  on public.kb_shadow_results(expires_at);

alter table public.kb_shadow_runs enable row level security;
alter table public.kb_shadow_results enable row level security;

revoke all on table public.kb_shadow_runs from anon, authenticated;
revoke all on table public.kb_shadow_results from anon, authenticated;

comment on table public.kb_shadow_runs is
  'Own-KB shadow/dual-read runs. Used for rollout evidence only; does not change live voice behavior.';

comment on table public.kb_shadow_results is
  'Redacted transcript-derived Own-KB retrieval results for canary evidence. Raw transcripts must not be stored here.';
