-- Milestone 1D: Own-KB DB scope/RLS/readiness validation.
--
-- This migration is additive and intentionally does not change runtime flags,
-- Retell-KB behavior, Own-KB primary status, or provider behavior.
--
-- It validates the tenant-lineage constraints introduced earlier. Applying it
-- must fail if existing data violates Own-KB org/tenant invariants.

update public.kb_eval_results r
   set org_id = run.org_id,
       tenant_id = run.tenant_id
  from public.kb_eval_runs run
 where r.run_id = run.id
   and run.org_id is not null
   and run.tenant_id is not null
   and (r.org_id is null or r.tenant_id is null);

do $$
begin
  if exists (
    select 1
      from public.kb_eval_results
     where org_id is null or tenant_id is null
  ) then
    raise exception 'Own-KB readiness failed: kb_eval_results rows lack org_id/tenant_id';
  end if;
end $$;

alter table public.kb_eval_results alter column org_id set not null;
alter table public.kb_eval_results alter column tenant_id set not null;

create index if not exists kb_ingestion_jobs_scope_idx
  on public.kb_ingestion_jobs(org_id, tenant_id, status, run_after);

create index if not exists kb_retrieval_citations_scope_idx
  on public.kb_retrieval_citations(org_id, tenant_id, event_id);

create index if not exists kb_eval_results_scope_idx
  on public.kb_eval_results(org_id, tenant_id, run_id);

create index if not exists kb_eval_runs_tenant_scope_idx
  on public.kb_eval_runs(org_id, tenant_id, created_at desc);

create index if not exists voice_rag_turn_metrics_tenant_scope_idx
  on public.voice_rag_turn_metrics(org_id, tenant_id, created_at desc);

create index if not exists kb_shadow_results_retrieval_event_scope_idx
  on public.kb_shadow_results(org_id, tenant_id, retrieval_event_id)
  where retrieval_event_id is not null;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'kb_sources_current_version_scope_fk') then
    alter table public.kb_sources validate constraint kb_sources_current_version_scope_fk;
  end if;

  if exists (select 1 from pg_constraint where conname = 'kb_documents_source_scope_fk') then
    alter table public.kb_documents validate constraint kb_documents_source_scope_fk;
  end if;

  if exists (select 1 from pg_constraint where conname = 'kb_documents_source_version_scope_fk') then
    alter table public.kb_documents validate constraint kb_documents_source_version_scope_fk;
  end if;

  if exists (select 1 from pg_constraint where conname = 'kb_chunks_document_lineage_scope_fk') then
    alter table public.kb_chunks validate constraint kb_chunks_document_lineage_scope_fk;
  end if;

  if exists (select 1 from pg_constraint where conname = 'kb_embeddings_chunk_scope_fk') then
    alter table public.kb_embeddings validate constraint kb_embeddings_chunk_scope_fk;
  end if;

  if exists (select 1 from pg_constraint where conname = 'kb_retrieval_citations_event_scope_fk') then
    alter table public.kb_retrieval_citations validate constraint kb_retrieval_citations_event_scope_fk;
  end if;

  if exists (select 1 from pg_constraint where conname = 'kb_retrieval_citations_chunk_lineage_scope_fk') then
    alter table public.kb_retrieval_citations validate constraint kb_retrieval_citations_chunk_lineage_scope_fk;
  end if;

  if exists (select 1 from pg_constraint where conname = 'kb_eval_runs_scope_required_chk') then
    alter table public.kb_eval_runs validate constraint kb_eval_runs_scope_required_chk;
  end if;

  if exists (select 1 from pg_constraint where conname = 'kb_eval_results_run_scope_fk') then
    alter table public.kb_eval_results validate constraint kb_eval_results_run_scope_fk;
  end if;
end $$;
