import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkOwnKbDatabaseReadiness,
  OWN_KB_PRIVATE_TABLES,
  OWN_KB_SCOPE_CONSTRAINTS,
  type OwnKbReadinessQueryable,
} from '../own-kb-readiness.js';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const srcRoot = join(__dirname, '..');

function readSource(relativePath: string): string {
  return readFileSync(join(srcRoot, relativePath), 'utf8');
}

describe('Own-KB DB scope/readiness guardrails', () => {
  it('passes the static Own-KB migration readiness check', () => {
    const output = execFileSync(process.execPath, ['scripts/check-own-kb-readiness.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(output).toContain('Own-KB readiness static check passed.');
  });

  it('keeps Own-KB retrieval queries scoped by TrustedScope org and tenant', () => {
    const source = readSource('own-kb.ts');

    const ftsSearch = source.slice(
      source.indexOf('async function ftsSearch('),
      source.indexOf('async function vectorSearch('),
    );
    expect(ftsSearch).toContain('where c.org_id = $1');
    expect(ftsSearch).toContain('and c.tenant_id = $2');
    expect(ftsSearch).toContain('[input.trustedScope.orgId, input.trustedScope.tenantId');

    const vectorSearch = source.slice(
      source.indexOf('async function vectorSearch('),
      source.indexOf('function reciprocalRankFuse('),
    );
    expect(vectorSearch).toContain('where e.org_id = $1');
    expect(vectorSearch).toContain('and e.tenant_id = $2');
    expect(vectorSearch).toContain('[input.trustedScope.orgId, input.trustedScope.tenantId');

    const logRetrieval = source.slice(
      source.indexOf('async function logRetrieval('),
      source.indexOf('export async function knowledgeSearch('),
    );
    expect(logRetrieval).toContain('input.trustedScope.orgId');
    expect(logRetrieval).toContain('input.trustedScope.tenantId');
    expect(logRetrieval).toContain('(event_id, org_id, tenant_id, rank, chunk_id, source_id, source_version_id, distance, snippet_redacted)');
  });

  it('requires explicit org scope in Own-KB service-role scripts', () => {
    for (const file of ['scripts/shadow-own-kb.ts', 'scripts/eval-own-kb.ts', 'scripts/diagnose-own-kb-gaps.ts']) {
      const source = readSource(file);
      expect(source).toContain('--org is required');
      expect(source).not.toContain('from kb_sources where tenant_id = $1');
      expect(source).not.toContain('from kb_shadow_runs where tenant_id = $1');
      expect(source).not.toContain('from agent_configs where tenant_id = $1 and org_id is not null');
      expect(source).not.toContain('function resolveOrgId');
    }
  });

  it('passes live catalog readiness when RLS, grants, constraints, indexes, views, and functions are safe', async () => {
    const report = await checkOwnKbDatabaseReadiness(mockCatalogDb());
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it('fails live catalog readiness for unsafe DB posture', async () => {
    const report = await checkOwnKbDatabaseReadiness(mockCatalogDb({
      tableOverrides: {
        kb_chunks: { relrowsecurity: false },
        kb_embeddings: { has_tenant_id_column: false },
        kb_eval_results: { tenant_id_not_null: false },
      },
      grants: [{ relation_name: 'kb_chunks', grantee: 'anon', privilege_type: 'SELECT' }],
      constraintOverrides: {
        kb_chunks_document_lineage_scope_fk: { convalidated: false },
      },
      indexOverrides: {
        kb_retrieval_events: { has_scope_index: false },
      },
      policyOverrides: {
        kb_retrieval_events: { has_tenant_scope_policy: false },
      },
      views: [{
        view_name: 'public_kb_chunks',
        security_invoker: false,
        public_grants: ['authenticated:SELECT'],
      }],
      functions: [{
        function_name: 'public.search_kb_chunks',
        security_definer: true,
        has_org_id: true,
        has_tenant_id: false,
      }],
    }));

    expect(report.ok).toBe(false);
    expect(report.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MISSING_RLS', subject: 'kb_chunks' }),
      expect.objectContaining({ code: 'MISSING_TENANT_ID', subject: 'kb_embeddings' }),
      expect.objectContaining({ code: 'MISSING_TENANT_ID', subject: 'kb_eval_results' }),
      expect.objectContaining({ code: 'PUBLIC_ROLE_GRANT', subject: 'kb_chunks' }),
      expect.objectContaining({ code: 'UNVALIDATED_SCOPE_CONSTRAINT', subject: 'kb_chunks_document_lineage_scope_fk' }),
      expect.objectContaining({ code: 'MISSING_SCOPE_INDEX', subject: 'kb_retrieval_events' }),
      expect.objectContaining({ code: 'MISSING_TENANT_RLS_POLICY', subject: 'kb_retrieval_events' }),
      expect.objectContaining({ code: 'PRIVATE_KB_VIEW_PUBLIC_WITHOUT_SECURITY_INVOKER', subject: 'public_kb_chunks' }),
      expect.objectContaining({ code: 'SECURITY_DEFINER_TOUCHES_KB', subject: 'public.search_kb_chunks' }),
      expect.objectContaining({ code: 'KB_FUNCTION_WITHOUT_EXPLICIT_SCOPE', subject: 'public.search_kb_chunks' }),
    ]));
  });
});

type TableRow = {
  table_name: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
  has_org_id_column: boolean;
  has_tenant_id_column: boolean;
  org_id_not_null: boolean;
  tenant_id_not_null: boolean;
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

type GrantRow = {
  relation_name: string;
  grantee: string;
  privilege_type: string;
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

type MockCatalogOverrides = {
  tableOverrides?: Partial<Record<string, Partial<TableRow>>>;
  constraintOverrides?: Partial<Record<string, Partial<ConstraintRow>>>;
  indexOverrides?: Partial<Record<string, Partial<IndexRow>>>;
  policyOverrides?: Partial<Record<string, Partial<PolicyRow>>>;
  grants?: GrantRow[];
  views?: ViewRow[];
  functions?: FunctionRow[];
};

function mockCatalogDb(overrides: MockCatalogOverrides = {}): OwnKbReadinessQueryable {
  const tables: TableRow[] = OWN_KB_PRIVATE_TABLES.map((table) => ({
    table_name: table,
    relrowsecurity: true,
    relforcerowsecurity: false,
    has_org_id_column: true,
    has_tenant_id_column: true,
    org_id_not_null: table !== 'kb_eval_runs',
    tenant_id_not_null: table !== 'kb_eval_runs',
    ...(overrides.tableOverrides?.[table] ?? {}),
  }));
  const constraints: ConstraintRow[] = OWN_KB_SCOPE_CONSTRAINTS.map((constraint) => ({
    constraint_name: constraint,
    convalidated: true,
    ...(overrides.constraintOverrides?.[constraint] ?? {}),
  }));
  const indexes: IndexRow[] = OWN_KB_PRIVATE_TABLES.map((table) => ({
    table_name: table,
    has_scope_index: true,
    ...(overrides.indexOverrides?.[table] ?? {}),
  }));
  const policies: PolicyRow[] = OWN_KB_PRIVATE_TABLES.map((table) => ({
    table_name: table,
    has_tenant_scope_policy: true,
    ...(overrides.policyOverrides?.[table] ?? {}),
  }));

  return {
    async query<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes('from pg_class c') && sql.includes("c.relkind in ('r', 'p')")) {
        return { rows: tables as T[] };
      }
      if (sql.includes('information_schema.role_table_grants') && sql.includes('table_name = any')) {
        return { rows: (overrides.grants ?? []) as T[] };
      }
      if (sql.includes('from pg_constraint')) {
        return { rows: constraints as T[] };
      }
      if (sql.includes('from pg_indexes')) {
        return { rows: indexes as T[] };
      }
      if (sql.includes('pg_policy')) {
        return { rows: policies as T[] };
      }
      if (sql.includes('with kb_views as')) {
        return { rows: (overrides.views ?? []) as T[] };
      }
      if (sql.includes('from pg_proc p')) {
        return { rows: (overrides.functions ?? []) as T[] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}
