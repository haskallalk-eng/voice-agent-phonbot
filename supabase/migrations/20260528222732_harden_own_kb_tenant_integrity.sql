-- Hardening for own KB/RAG multi-tenant integrity.
--
-- This migration is additive. It makes cross-tenant source/version/document/
-- chunk/citation links impossible for new writes and prepares eval/cleanup
-- tables for production rollout.

create table if not exists public.retell_kb_cleanup_failures (
  id uuid primary key default gen_random_uuid(),
  knowledge_base_id text not null,
  knowledge_base_name text,
  source text not null default 'unknown',
  error text not null,
  attempts int not null default 0,
  context jsonb not null default '{}',
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  next_retry_at timestamptz,
  resolved_at timestamptz
);

create index if not exists retell_kb_cleanup_failures_pending_idx
  on public.retell_kb_cleanup_failures(next_retry_at, last_failed_at)
  where resolved_at is null;

create index if not exists retell_kb_cleanup_failures_kb_idx
  on public.retell_kb_cleanup_failures(knowledge_base_id)
  where resolved_at is null;

alter table public.retell_kb_cleanup_failures enable row level security;
revoke all on table public.retell_kb_cleanup_failures from anon, authenticated;

alter table public.kb_retrieval_citations add column if not exists org_id uuid;
alter table public.kb_retrieval_citations add column if not exists tenant_id text;

update public.kb_retrieval_citations c
   set org_id = e.org_id,
       tenant_id = e.tenant_id
  from public.kb_retrieval_events e
 where c.event_id = e.id
   and (c.org_id is null or c.tenant_id is null);

alter table public.kb_retrieval_citations alter column org_id set not null;
alter table public.kb_retrieval_citations alter column tenant_id set not null;

alter table public.kb_eval_runs add column if not exists is_global_synthetic boolean not null default false;
alter table public.kb_eval_results add column if not exists org_id uuid;
alter table public.kb_eval_results add column if not exists tenant_id text;

update public.kb_eval_results r
   set org_id = run.org_id,
       tenant_id = run.tenant_id
  from public.kb_eval_runs run
 where r.run_id = run.id
   and (r.org_id is null or r.tenant_id is null);

create unique index if not exists kb_sources_id_scope_uidx
  on public.kb_sources(id, org_id, tenant_id);
create unique index if not exists kb_source_versions_id_scope_uidx
  on public.kb_source_versions(id, org_id, tenant_id);
create unique index if not exists kb_source_versions_id_source_scope_uidx
  on public.kb_source_versions(id, source_id, org_id, tenant_id);
create unique index if not exists kb_documents_id_scope_uidx
  on public.kb_documents(id, org_id, tenant_id);
create unique index if not exists kb_documents_id_lineage_scope_uidx
  on public.kb_documents(id, source_id, source_version_id, org_id, tenant_id);
create unique index if not exists kb_chunks_id_scope_uidx
  on public.kb_chunks(id, org_id, tenant_id);
create unique index if not exists kb_chunks_id_lineage_scope_uidx
  on public.kb_chunks(id, document_id, source_id, source_version_id, org_id, tenant_id);
create unique index if not exists kb_chunks_id_source_version_scope_uidx
  on public.kb_chunks(id, source_id, source_version_id, org_id, tenant_id);
create unique index if not exists kb_retrieval_events_id_scope_uidx
  on public.kb_retrieval_events(id, org_id, tenant_id);
create unique index if not exists kb_eval_runs_id_scope_uidx
  on public.kb_eval_runs(id, org_id, tenant_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kb_sources_current_version_scope_fk') then
    alter table public.kb_sources
      add constraint kb_sources_current_version_scope_fk
      foreign key (current_version_id, id, org_id, tenant_id)
      references public.kb_source_versions(id, source_id, org_id, tenant_id)
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'kb_documents_source_scope_fk') then
    alter table public.kb_documents
      add constraint kb_documents_source_scope_fk
      foreign key (source_id, org_id, tenant_id)
      references public.kb_sources(id, org_id, tenant_id)
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'kb_documents_source_version_scope_fk') then
    alter table public.kb_documents
      add constraint kb_documents_source_version_scope_fk
      foreign key (source_version_id, source_id, org_id, tenant_id)
      references public.kb_source_versions(id, source_id, org_id, tenant_id)
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'kb_chunks_document_lineage_scope_fk') then
    alter table public.kb_chunks
      add constraint kb_chunks_document_lineage_scope_fk
      foreign key (document_id, source_id, source_version_id, org_id, tenant_id)
      references public.kb_documents(id, source_id, source_version_id, org_id, tenant_id)
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'kb_embeddings_chunk_scope_fk') then
    alter table public.kb_embeddings
      add constraint kb_embeddings_chunk_scope_fk
      foreign key (chunk_id, org_id, tenant_id)
      references public.kb_chunks(id, org_id, tenant_id)
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'kb_retrieval_citations_event_scope_fk') then
    alter table public.kb_retrieval_citations
      add constraint kb_retrieval_citations_event_scope_fk
      foreign key (event_id, org_id, tenant_id)
      references public.kb_retrieval_events(id, org_id, tenant_id)
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'kb_retrieval_citations_chunk_lineage_scope_fk') then
    alter table public.kb_retrieval_citations
      add constraint kb_retrieval_citations_chunk_lineage_scope_fk
      foreign key (chunk_id, source_id, source_version_id, org_id, tenant_id)
      references public.kb_chunks(id, source_id, source_version_id, org_id, tenant_id)
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'kb_eval_runs_scope_required_chk') then
    alter table public.kb_eval_runs
      add constraint kb_eval_runs_scope_required_chk
      check (is_global_synthetic or (org_id is not null and tenant_id is not null))
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'kb_eval_results_run_scope_fk') then
    alter table public.kb_eval_results
      add constraint kb_eval_results_run_scope_fk
      foreign key (run_id, org_id, tenant_id)
      references public.kb_eval_runs(id, org_id, tenant_id)
      not valid;
  end if;
end $$;

comment on table public.retell_kb_cleanup_failures is
  'Durable queue of Retell KB delete failures; billable external resources must not disappear into logs only.';
