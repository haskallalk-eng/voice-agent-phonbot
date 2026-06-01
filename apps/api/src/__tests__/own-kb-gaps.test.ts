import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock('../db.js', () => ({
  pool: {
    query: mocks.poolQuery,
  },
}));

const { diagnoseOwnKbShadowGaps } = await import('../own-kb-gaps.js');

describe('own KB shadow gap diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('summarizes coverage blockers without returning raw shadow questions', async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('from kb_shadow_runs')) {
        return { rows: [{ id: 'run_1' }], rowCount: 1 };
      }
      if (sql.includes('from kb_sources') && sql.includes('sources_total')) {
        return {
          rows: [{
            sources_total: 1,
            sources_approved: 1,
            sources_without_pii: 1,
            sources_with_current_version: 1,
            sources_allowed_for_search: 1,
            sources_not_high_risk: 1,
          }],
        };
      }
      if (sql.includes('from kb_source_versions')) {
        return {
          rows: [{
            versions_total: 1,
            versions_indexed: 1,
            versions_verified: 1,
            versions_current: 1,
          }],
        };
      }
      if (sql.includes('from kb_chunks')) {
        return {
          rows: [{
            chunks_total: 2,
            chunks_retrievable: 2,
            embeddings_total: 2,
          }],
        };
      }
      if (sql.includes('group by type, category')) {
        return {
          rows: [{
            type: 'db_canonical',
            category: 'verified_facts',
            allowed_use: 'agent_facts',
            review_status: 'approved',
            risk: 'low',
            contains_pii: false,
            count: 1,
          }],
        };
      }
      if (sql.includes('from kb_shadow_results')) {
        return {
          rows: [{
            query_bucket: 'opening_hours',
            status: 'not_answerable',
            failure_reason: 'NO_APPROVED_CURRENT_SOURCE',
            count: 3,
            p95_latency_ms: 346,
          }],
        };
      }
      return { rows: [] };
    });

    const report = await diagnoseOwnKbShadowGaps({
      orgId: '00000000-0000-0000-0000-000000000001',
      tenantId: 'tenant_1',
    });

    expect(report.runId).toBe('run_1');
    expect(report.chunkInventory.chunks_retrievable).toBe(2);
    expect(report.shadowBuckets).toEqual([expect.objectContaining({
      query_bucket: 'opening_hours',
      bucket_hash: expect.any(String),
      count: 3,
    })]);
    expect(report.recommendations).toContain('Add or verify an approved opening-hours source; current retrievable chunks did not answer these questions.');
    expect(JSON.stringify(report)).not.toContain('Was kostet');
    expect(JSON.stringify(report)).not.toContain('test@example.com');
  });

  it('does not trust a supplied runId unless it belongs to the requested org and tenant', async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('from kb_shadow_runs') && sql.includes('where id = $1')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('from kb_sources') && sql.includes('sources_total')) {
        return { rows: [{ sources_total: 0, sources_approved: 0 }] };
      }
      if (sql.includes('from kb_source_versions')) return { rows: [{}] };
      if (sql.includes('from kb_chunks')) return { rows: [{ chunks_total: 0, chunks_retrievable: 0, embeddings_total: 0 }] };
      if (sql.includes('group by type, category')) return { rows: [] };
      if (sql.includes('from kb_shadow_results')) {
        throw new Error('shadow results must not be queried for an unscoped run');
      }
      return { rows: [] };
    });

    const report = await diagnoseOwnKbShadowGaps({
      orgId: '00000000-0000-0000-0000-000000000001',
      tenantId: 'tenant_1',
      runId: 'run_from_other_tenant',
    });

    expect(report.runId).toBeNull();
    expect(report.shadowBuckets).toEqual([]);
    expect(mocks.poolQuery).toHaveBeenCalledWith(expect.stringContaining('where id = $1'), [
      'run_from_other_tenant',
      '00000000-0000-0000-0000-000000000001',
      'tenant_1',
    ]);
  });
});
