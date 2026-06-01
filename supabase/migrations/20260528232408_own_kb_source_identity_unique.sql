-- Prevent concurrent Own-KB backfills from creating duplicate source rows for
-- the same agent/source identity. We fail loudly if duplicates already exist so
-- an operator can merge them without silently dropping citation history.

do $$
begin
  if exists (
    select 1
      from public.kb_sources
     group by org_id, tenant_id, coalesce(agent_tenant_id, ''), type, coalesce(uri, '')
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_KB_SOURCES_EXIST';
  end if;
end $$;

create unique index if not exists kb_sources_identity_unique_idx
  on public.kb_sources (
    org_id,
    tenant_id,
    coalesce(agent_tenant_id, ''),
    type,
    coalesce(uri, '')
  );
