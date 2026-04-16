/**
 * Tests for org-id-cache.ts — validates LRU caching, null-exclusion,
 * cache-invalidation (5a032f5 bug), and callback-agent-ID resolution
 * (6a7eaa3 fix).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const mockQueryResults: Array<{ rows: Array<Record<string, unknown>> }> = [];
const mockQuery = vi.fn().mockImplementation(async () => {
  return mockQueryResults.shift() ?? { rows: [] };
});

vi.mock('../db.js', () => ({
  pool: { query: mockQuery },
}));

const { getOrgIdByAgentId, invalidateOrgIdCache } = await import('../org-id-cache.js');

describe('org-id-cache', () => {
  beforeEach(() => {
    // Reset cache by invalidating known keys + clear mock
    invalidateOrgIdCache('agent-main');
    invalidateOrgIdCache('agent-callback');
    invalidateOrgIdCache('agent-unknown');
    mockQuery.mockClear();
    mockQueryResults.length = 0;
  });

  it('resolves orgId via retellAgentId and caches the result', async () => {
    mockQueryResults.push({ rows: [{ org_id: 'org-123' }] });

    const first = await getOrgIdByAgentId('agent-main');
    expect(first).toBe('org-123');
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // Second call should hit cache — no new DB query
    const second = await getOrgIdByAgentId('agent-main');
    expect(second).toBe('org-123');
    expect(mockQuery).toHaveBeenCalledTimes(1); // still 1
  });

  it('does NOT cache null results (prevents permanent 403 on new agents)', async () => {
    mockQueryResults.push({ rows: [] }); // first: not found
    mockQueryResults.push({ rows: [{ org_id: 'org-new' }] }); // second: found (agent just deployed)

    const miss = await getOrgIdByAgentId('agent-unknown');
    expect(miss).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // Second lookup should re-query DB (null was NOT cached)
    const hit = await getOrgIdByAgentId('agent-unknown');
    expect(hit).toBe('org-new');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('invalidateOrgIdCache evicts a cached entry', async () => {
    mockQueryResults.push({ rows: [{ org_id: 'org-old' }] });
    mockQueryResults.push({ rows: [{ org_id: 'org-new' }] });

    await getOrgIdByAgentId('agent-main'); // cached as org-old
    expect(mockQuery).toHaveBeenCalledTimes(1);

    invalidateOrgIdCache('agent-main'); // evict

    const fresh = await getOrgIdByAgentId('agent-main'); // re-query → org-new
    expect(fresh).toBe('org-new');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('query checks both retellAgentId AND retellCallbackAgentId', async () => {
    mockQueryResults.push({ rows: [{ org_id: 'org-callback' }] });

    await getOrgIdByAgentId('agent-callback');

    // Verify the SQL includes OR for callback agent
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("retellAgentId");
    expect(sql).toContain("retellCallbackAgentId");
    expect(sql).toContain("OR");
  });
});
