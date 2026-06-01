export const OWN_KB_PRIVATE_TABLES = [
  'kb_sources',
  'kb_source_versions',
  'kb_documents',
  'kb_chunks',
  'kb_embeddings',
  'kb_ingestion_jobs',
  'kb_retrieval_events',
  'kb_retrieval_citations',
  'kb_eval_runs',
  'kb_eval_results',
  'voice_rag_turn_metrics',
  'kb_shadow_runs',
  'kb_shadow_results',
] as const;

export const OWN_KB_SCOPE_CONSTRAINTS = [
  'kb_sources_current_version_scope_fk',
  'kb_documents_source_scope_fk',
  'kb_documents_source_version_scope_fk',
  'kb_chunks_document_lineage_scope_fk',
  'kb_embeddings_chunk_scope_fk',
  'kb_retrieval_citations_event_scope_fk',
  'kb_retrieval_citations_chunk_lineage_scope_fk',
  'kb_eval_runs_scope_required_chk',
  'kb_eval_results_run_scope_fk',
] as const;

export type OwnKbReadinessFailureCode =
  | 'MISSING_TABLE'
  | 'MISSING_ORG_ID'
  | 'MISSING_TENANT_ID'
  | 'MISSING_RLS'
  | 'MISSING_TENANT_RLS_POLICY'
  | 'PUBLIC_ROLE_GRANT'
  | 'MISSING_SCOPE_INDEX'
  | 'MISSING_SCOPE_CONSTRAINT'
  | 'UNVALIDATED_SCOPE_CONSTRAINT'
  | 'PRIVATE_KB_VIEW_PUBLIC_WITHOUT_SECURITY_INVOKER'
  | 'SECURITY_DEFINER_TOUCHES_KB'
  | 'KB_FUNCTION_WITHOUT_EXPLICIT_SCOPE';

export type OwnKbReadinessFailure = {
  code: OwnKbReadinessFailureCode;
  subject: string;
  detail?: string;
};

export type OwnKbReadinessReport = {
  ok: boolean;
  checkedAt: string;
  failures: OwnKbReadinessFailure[];
};

type QueryResult<T> = { rows: T[] };
export type OwnKbReadinessQueryable = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
};

type TableCatalogRow = {
  table_name: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
  has_org_id_column: boolean;
  has_tenant_id_column: boolean;
  org_id_not_null: boolean;
  tenant_id_not_null: boolean;
};

type GrantRow = {
  relation_name: string;
  grantee: string;
  privilege_type: string;
};

type ConstraintRow = {
  constraint_name: string;
  convalidated: boolean;
};

type IndexRow = {
  table_name: string;
  has_scope_index: boolean;
};

type PolicyRow = {
  table_name: string;
  has_tenant_scope_policy: boolean;
};

type ViewRow = {
  view_name: string;
  security_invoker: boolean;
  public_grants: string[];
};

type FunctionRow = {
  function_name: string;
  security_definer: boolean;
  has_org_id: boolean;
  has_tenant_id: boolean;
};

function addFailure(failures: OwnKbReadinessFailure[], code: OwnKbReadinessFailureCode, subject: string, detail?: string): void {
  failures.push(detail ? { code, subject, detail } : { code, subject });
}

const SCOPE_CONSTRAINT_GUARDED_TABLES: Readonly<Record<string, string>> = {
  kb_eval_runs: 'kb_eval_runs_scope_required_chk',
};

export async function checkOwnKbDatabaseReadiness(db: OwnKbReadinessQueryable): Promise<OwnKbReadinessReport> {
  const failures: OwnKbReadinessFailure[] = [];

  const tableRows = await db.query<TableCatalogRow>(`
    select
      c.relname::text as table_name,
      c.relrowsecurity::boolean as relrowsecurity,
      c.relforcerowsecurity::boolean as relforcerowsecurity,
      bool_or(a.attname = 'org_id')::boolean as has_org_id_column,
      bool_or(a.attname = 'tenant_id')::boolean as has_tenant_id_column,
      bool_or(a.attname = 'org_id' and a.attnotnull)::boolean as org_id_not_null,
      bool_or(a.attname = 'tenant_id' and a.attnotnull)::boolean as tenant_id_not_null
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname = any($1::text[])
    group by c.relname, c.relrowsecurity, c.relforcerowsecurity
  `, [[...OWN_KB_PRIVATE_TABLES]]);
  const tablesByName = new Map(tableRows.rows.map((row) => [row.table_name, row]));
  for (const table of OWN_KB_PRIVATE_TABLES) {
    const row = tablesByName.get(table);
    if (!row) {
      addFailure(failures, 'MISSING_TABLE', table);
      continue;
    }
    if (!row.has_org_id_column) {
      addFailure(failures, 'MISSING_ORG_ID', table);
    } else if (!SCOPE_CONSTRAINT_GUARDED_TABLES[table] && !row.org_id_not_null) {
      addFailure(failures, 'MISSING_ORG_ID', table, 'org_id is nullable without an approved scope-guard constraint');
    }
    if (!row.has_tenant_id_column) {
      addFailure(failures, 'MISSING_TENANT_ID', table);
    } else if (!SCOPE_CONSTRAINT_GUARDED_TABLES[table] && !row.tenant_id_not_null) {
      addFailure(failures, 'MISSING_TENANT_ID', table, 'tenant_id is nullable without an approved scope-guard constraint');
    }
    if (!row.relrowsecurity) addFailure(failures, 'MISSING_RLS', table);
  }

  const grantRows = await db.query<GrantRow>(`
    select
      table_name::text as relation_name,
      grantee::text,
      privilege_type::text
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = any($1::text[])
      and grantee in ('anon', 'authenticated')
  `, [[...OWN_KB_PRIVATE_TABLES]]);
  for (const grant of grantRows.rows) {
    addFailure(failures, 'PUBLIC_ROLE_GRANT', grant.relation_name, `${grant.grantee}:${grant.privilege_type}`);
  }

  const constraintRows = await db.query<ConstraintRow>(`
    select conname::text as constraint_name, convalidated::boolean
    from pg_constraint
    where conname = any($1::text[])
  `, [[...OWN_KB_SCOPE_CONSTRAINTS]]);
  const constraintsByName = new Map(constraintRows.rows.map((row) => [row.constraint_name, row]));
  for (const constraint of OWN_KB_SCOPE_CONSTRAINTS) {
    const row = constraintsByName.get(constraint);
    if (!row) {
      addFailure(failures, 'MISSING_SCOPE_CONSTRAINT', constraint);
    } else if (!row.convalidated) {
      addFailure(failures, 'UNVALIDATED_SCOPE_CONSTRAINT', constraint);
    }
  }

  const indexRows = await db.query<IndexRow>(`
    select
      tablename::text as table_name,
      bool_or(indexdef ~* '\\morg_id\\M' and indexdef ~* '\\mtenant_id\\M')::boolean as has_scope_index
    from pg_indexes
    where schemaname = 'public'
      and tablename = any($1::text[])
    group by tablename
  `, [[...OWN_KB_PRIVATE_TABLES]]);
  const indexesByTable = new Map(indexRows.rows.map((row) => [row.table_name, row]));
  for (const table of OWN_KB_PRIVATE_TABLES) {
    if (!indexesByTable.get(table)?.has_scope_index) {
      addFailure(failures, 'MISSING_SCOPE_INDEX', table);
    }
  }

  const policyRows = await db.query<PolicyRow>(`
    select
      c.relname::text as table_name,
      bool_or(
        (
          coalesce(pg_get_expr(p.polqual, p.polrelid), '')
          || ' '
          || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ) ~* '\\morg_id\\M'
        and (
          coalesce(pg_get_expr(p.polqual, p.polrelid), '')
          || ' '
          || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ) ~* '\\mtenant_id\\M'
      )::boolean as has_tenant_scope_policy
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_policy p on p.polrelid = c.oid
    where n.nspname = 'public'
      and c.relname = any($1::text[])
    group by c.relname
  `, [[...OWN_KB_PRIVATE_TABLES]]);
  const policiesByTable = new Map(policyRows.rows.map((row) => [row.table_name, row]));
  for (const table of OWN_KB_PRIVATE_TABLES) {
    if (!policiesByTable.get(table)?.has_tenant_scope_policy) {
      addFailure(failures, 'MISSING_TENANT_RLS_POLICY', table);
    }
  }

  const viewRows = await db.query<ViewRow>(`
    with kb_views as (
      select
        c.oid,
        c.relname::text as view_name,
        coalesce(array_to_string(c.reloptions, ','), '') ~* 'security_invoker=true' as security_invoker
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('v', 'm')
        and pg_get_viewdef(c.oid, true) ~* '\\mkb_[a-z0-9_]+\\M'
    )
    select
      v.view_name,
      v.security_invoker,
      coalesce(array_agg(g.grantee || ':' || g.privilege_type) filter (where g.grantee is not null), '{}')::text[] as public_grants
    from kb_views v
    left join information_schema.role_table_grants g
      on g.table_schema = 'public'
     and g.table_name = v.view_name
     and g.grantee in ('anon', 'authenticated')
    group by v.view_name, v.security_invoker
  `);
  for (const view of viewRows.rows) {
    if (!view.security_invoker && view.public_grants.length > 0) {
      addFailure(failures, 'PRIVATE_KB_VIEW_PUBLIC_WITHOUT_SECURITY_INVOKER', view.view_name, view.public_grants.join(','));
    }
  }

  const functionRows = await db.query<FunctionRow>(`
    with candidate_functions as (
      select
        p.oid,
        (n.nspname || '.' || p.proname)::text as function_name,
        p.prosecdef::boolean as security_definer,
        pg_get_functiondef(p.oid) as function_def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.prokind = 'f'
    )
    select
      function_name,
      security_definer,
      function_def ~* '\\morg_id\\M' as has_org_id,
      function_def ~* '\\mtenant_id\\M' as has_tenant_id
    from candidate_functions
    where function_def ~* '\\mkb_[a-z0-9_]+\\M'
  `);
  for (const fn of functionRows.rows) {
    if (fn.security_definer) {
      addFailure(failures, 'SECURITY_DEFINER_TOUCHES_KB', fn.function_name);
    }
    if (!fn.has_org_id || !fn.has_tenant_id) {
      addFailure(failures, 'KB_FUNCTION_WITHOUT_EXPLICIT_SCOPE', fn.function_name);
    }
  }

  return {
    ok: failures.length === 0,
    checkedAt: new Date().toISOString(),
    failures,
  };
}
