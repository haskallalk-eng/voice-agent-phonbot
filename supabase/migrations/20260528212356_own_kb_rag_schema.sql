-- Own KB/RAG foundation for Phonbot voice agents.
--
-- This migration is intentionally additive. It does not switch runtime behavior,
-- delete Retell KBs, or expose KB tables to browser clients.

create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null default 'Unknown Org',
  slug text unique,
  plan text not null default 'free',
  is_active boolean not null default true
);

create table if not exists public.kb_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  agent_tenant_id text,
  type text not null check (type in ('text', 'url', 'pdf', 'db_canonical', 'upload')),
  name text not null,
  uri text,
  category text not null,
  allowed_use text not null,
  owner text not null,
  review_status text not null default 'draft'
    check (review_status in ('draft', 'approved', 'needs_review', 'rejected', 'expired')),
  risk text not null default 'medium'
    check (risk in ('low', 'medium', 'high')),
  contains_pii boolean not null default false,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kb_source_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.kb_sources(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  version_no int not null check (version_no > 0),
  content_hash text not null,
  mime_type text,
  size_bytes bigint,
  parser text,
  parser_version text,
  fetched_at timestamptz,
  verified_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'indexed', 'rejected', 'expired', 'deleted')),
  rejection_reason text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (source_id, version_no),
  unique (source_id, content_hash)
);

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'kb_sources_current_version_fk'
  ) then
    alter table public.kb_sources
      add constraint kb_sources_current_version_fk
      foreign key (current_version_id)
      references public.kb_source_versions(id)
      on delete set null;
  end if;
end $$;

create table if not exists public.kb_documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.kb_sources(id) on delete cascade,
  source_version_id uuid not null references public.kb_source_versions(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  title text not null,
  canonical_url text,
  language text not null default 'de',
  content_hash text not null,
  token_count int,
  status text not null default 'ready'
    check (status in ('ready', 'rejected', 'deleted')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.kb_documents(id) on delete cascade,
  source_id uuid not null references public.kb_sources(id) on delete cascade,
  source_version_id uuid not null references public.kb_source_versions(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  chunk_index int not null check (chunk_index >= 0),
  text text not null,
  search_tsv tsvector generated always as (to_tsvector('german', coalesce(text, ''))) stored,
  token_count int,
  char_start int,
  char_end int,
  content_hash text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create table if not exists public.kb_embeddings (
  id uuid primary key default gen_random_uuid(),
  chunk_id uuid not null references public.kb_chunks(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  embedding_model text not null,
  embedding_dim int not null check (embedding_dim = 1536),
  embedding vector(1536) not null,
  created_at timestamptz not null default now(),
  unique (chunk_id, embedding_model)
);

create table if not exists public.kb_ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  source_id uuid references public.kb_sources(id) on delete cascade,
  source_version_id uuid references public.kb_source_versions(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'retry', 'done', 'failed', 'cancelled')),
  priority int not null default 100,
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  error text,
  input jsonb not null default '{}',
  output jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kb_retrieval_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  agent_id text,
  call_id text,
  turn_id text,
  provider text not null,
  query_hash text not null,
  query_text_redacted text,
  mode text not null check (mode in ('strict', 'balanced', 'broad')),
  top_k int not null check (top_k > 0 and top_k <= 10),
  latency_ms int not null check (latency_ms >= 0),
  answerable boolean not null,
  confidence numeric(4,3),
  error_code text,
  created_at timestamptz not null default now()
);

create table if not exists public.kb_retrieval_citations (
  event_id uuid not null references public.kb_retrieval_events(id) on delete cascade,
  rank int not null check (rank > 0),
  chunk_id uuid not null references public.kb_chunks(id) on delete cascade,
  source_id uuid not null references public.kb_sources(id) on delete cascade,
  source_version_id uuid not null references public.kb_source_versions(id) on delete cascade,
  distance numeric,
  snippet_redacted text,
  primary key (event_id, rank)
);

create table if not exists public.kb_eval_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade,
  tenant_id text,
  name text not null,
  git_sha text,
  config jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.kb_eval_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.kb_eval_runs(id) on delete cascade,
  case_id text not null,
  status text not null check (status in ('passed', 'failed', 'skipped')),
  score numeric(4,3),
  failure_reason text,
  latency_ms int,
  citations jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists public.voice_rag_turn_metrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  agent_id text,
  call_id text,
  provider text not null,
  turn_index int,
  asr_ms int,
  kb_ms int,
  llm_ms int,
  tts_ms int,
  tool_ms int,
  e2e_ms int,
  interrupted boolean,
  created_at timestamptz not null default now()
);

create index if not exists kb_sources_scope_idx
  on public.kb_sources(org_id, tenant_id);
create index if not exists kb_sources_review_idx
  on public.kb_sources(org_id, tenant_id, review_status);
create index if not exists kb_source_versions_scope_idx
  on public.kb_source_versions(org_id, tenant_id, status, expires_at);
create index if not exists kb_documents_scope_idx
  on public.kb_documents(org_id, tenant_id, source_version_id);
create index if not exists kb_chunks_scope_idx
  on public.kb_chunks(org_id, tenant_id, source_version_id);
create index if not exists kb_chunks_hash_idx
  on public.kb_chunks(org_id, tenant_id, content_hash);
create index if not exists kb_chunks_tsv_idx
  on public.kb_chunks using gin(search_tsv);
create index if not exists kb_embeddings_scope_idx
  on public.kb_embeddings(org_id, tenant_id, embedding_model);
create index if not exists kb_embeddings_hnsw_idx
  on public.kb_embeddings using hnsw (embedding vector_cosine_ops);
create index if not exists kb_jobs_pending_idx
  on public.kb_ingestion_jobs(priority, run_after, created_at)
  where status in ('queued', 'retry');
create index if not exists kb_jobs_locked_idx
  on public.kb_ingestion_jobs(locked_at)
  where status = 'running';
create index if not exists kb_retrieval_events_scope_idx
  on public.kb_retrieval_events(org_id, tenant_id, created_at desc);
create index if not exists kb_retrieval_events_call_idx
  on public.kb_retrieval_events(call_id, turn_id);
create index if not exists kb_retrieval_citations_chunk_idx
  on public.kb_retrieval_citations(chunk_id);
create index if not exists kb_eval_runs_scope_idx
  on public.kb_eval_runs(org_id, created_at desc);
create index if not exists kb_eval_results_run_idx
  on public.kb_eval_results(run_id, status);
create index if not exists voice_rag_turn_metrics_scope_idx
  on public.voice_rag_turn_metrics(org_id, agent_id, created_at desc);
create index if not exists voice_rag_turn_metrics_call_idx
  on public.voice_rag_turn_metrics(call_id, turn_index);
create index if not exists voice_rag_turn_metrics_created_brin
  on public.voice_rag_turn_metrics using brin(created_at);

alter table public.kb_sources enable row level security;
alter table public.kb_source_versions enable row level security;
alter table public.kb_documents enable row level security;
alter table public.kb_chunks enable row level security;
alter table public.kb_embeddings enable row level security;
alter table public.kb_ingestion_jobs enable row level security;
alter table public.kb_retrieval_events enable row level security;
alter table public.kb_retrieval_citations enable row level security;
alter table public.kb_eval_runs enable row level security;
alter table public.kb_eval_results enable row level security;
alter table public.voice_rag_turn_metrics enable row level security;

revoke all on table public.kb_sources from anon, authenticated;
revoke all on table public.kb_source_versions from anon, authenticated;
revoke all on table public.kb_documents from anon, authenticated;
revoke all on table public.kb_chunks from anon, authenticated;
revoke all on table public.kb_embeddings from anon, authenticated;
revoke all on table public.kb_ingestion_jobs from anon, authenticated;
revoke all on table public.kb_retrieval_events from anon, authenticated;
revoke all on table public.kb_retrieval_citations from anon, authenticated;
revoke all on table public.kb_eval_runs from anon, authenticated;
revoke all on table public.kb_eval_results from anon, authenticated;
revoke all on table public.voice_rag_turn_metrics from anon, authenticated;

comment on table public.kb_sources is
  'Own Phonbot KB sources. Every row is org/tenant scoped and must pass metadata gates before indexing.';
comment on table public.kb_source_versions is
  'Immutable source versions with parser, hash, freshness, and review state for rollback and audit.';
comment on table public.kb_chunks is
  'Voice-ready retrieval chunks. Treat text as untrusted facts, never instructions.';
comment on table public.kb_embeddings is
  'pgvector embeddings for own knowledge.search. One row per chunk/model.';
comment on table public.kb_retrieval_events is
  'Redacted retrieval telemetry for latency, quality, citations, and incident forensics.';
