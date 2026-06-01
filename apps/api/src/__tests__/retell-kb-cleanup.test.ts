import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteKnowledgeBase: vi.fn(),
  listKnowledgeBases: vi.fn(),
  listLLMs: vi.fn(),
  poolQuery: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('../retell.js', () => ({
  deleteKnowledgeBase: mocks.deleteKnowledgeBase,
  listKnowledgeBases: mocks.listKnowledgeBases,
  listLLMs: mocks.listLLMs,
}));

vi.mock('../logger.js', () => ({
  log: {
    info: mocks.logInfo,
    warn: mocks.logWarn,
    error: vi.fn(),
  },
}));

vi.mock('../db.js', () => ({
  pool: {
    query: mocks.poolQuery,
  },
}));

const {
  cleanupUnreferencedRetellKnowledgeBases,
  deleteKnowledgeBaseWithRetry,
  referencedKnowledgeBaseIds,
  retryRetellKnowledgeBaseCleanupFailures,
} = await import('../retell-kb-cleanup.js');

describe('Retell knowledge base cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('collects KB references from Retell LLM fields', () => {
    const ids = referencedKnowledgeBaseIds([
      { llm_id: 'llm_1', knowledge_base_ids: ['kb_a'], kb_config: { knowledge_base_ids: ['kb_b'] } },
      { llm_id: 'llm_2', knowledge_base_ids: null },
    ]);

    expect([...ids].sort()).toEqual(['kb_a', 'kb_b']);
  });

  it('deletes only old, complete, unreferenced KBs', async () => {
    const nowMs = Date.parse('2026-05-28T20:00:00.000Z');
    mocks.listKnowledgeBases.mockResolvedValue([
      {
        knowledge_base_id: 'kb_keep',
        knowledge_base_name: 'Active',
        status: 'complete',
        user_modified_timestamp: nowMs - 2 * 60 * 60 * 1000,
      },
      {
        knowledge_base_id: 'kb_delete',
        knowledge_base_name: 'Old orphan',
        status: 'complete',
        user_modified_timestamp: nowMs - 2 * 60 * 60 * 1000,
      },
      {
        knowledge_base_id: 'kb_recent',
        knowledge_base_name: 'Fresh deploy',
        status: 'complete',
        user_modified_timestamp: nowMs - 5 * 60 * 1000,
      },
      {
        knowledge_base_id: 'kb_loading',
        knowledge_base_name: 'Still loading',
        status: 'in_progress',
        user_modified_timestamp: nowMs - 2 * 60 * 60 * 1000,
      },
    ]);
    mocks.listLLMs.mockResolvedValue({
      items: [{ llm_id: 'llm_1', knowledge_base_ids: ['kb_keep'] }],
      hasMore: false,
    });
    mocks.deleteKnowledgeBase.mockResolvedValue(undefined);

    const result = await cleanupUnreferencedRetellKnowledgeBases({
      dryRun: false,
      nowMs,
      minAgeMs: 60 * 60 * 1000,
      retryDelayMs: 0,
      protectedKnowledgeBaseIds: new Set(),
    });

    expect(mocks.deleteKnowledgeBase).toHaveBeenCalledTimes(1);
    expect(mocks.deleteKnowledgeBase).toHaveBeenCalledWith('kb_delete');
    expect(result).toMatchObject({
      total: 4,
      referenced: 1,
      candidates: 1,
      deleted: 1,
      failed: 0,
      skippedRecent: 1,
      skippedStatus: 1,
    });
  });

  it('does not delete when the LLM list is paginated', async () => {
    mocks.listKnowledgeBases.mockResolvedValue([
      {
        knowledge_base_id: 'kb_orphan',
        knowledge_base_name: 'Orphan',
        status: 'complete',
        user_modified_timestamp: Date.now() - 2 * 60 * 60 * 1000,
      },
    ]);
    mocks.listLLMs.mockResolvedValue({ items: [], hasMore: true });

    const result = await cleanupUnreferencedRetellKnowledgeBases({ retryDelayMs: 0 });

    expect(mocks.deleteKnowledgeBase).not.toHaveBeenCalled();
    expect(result.skippedReason).toBe('LLM_LIST_PAGINATED');
  });

  it('does not delete DB-protected KBs', async () => {
    const nowMs = Date.parse('2026-05-28T20:00:00.000Z');
    mocks.listKnowledgeBases.mockResolvedValue([
      {
        knowledge_base_id: 'kb_db_keep',
        knowledge_base_name: 'DB protected',
        status: 'complete',
        user_modified_timestamp: nowMs - 2 * 60 * 60 * 1000,
      },
    ]);
    mocks.listLLMs.mockResolvedValue({ items: [], hasMore: false });

    const result = await cleanupUnreferencedRetellKnowledgeBases({
      dryRun: false,
      nowMs,
      minAgeMs: 60 * 60 * 1000,
      retryDelayMs: 0,
      protectedKnowledgeBaseIds: new Set(['kb_db_keep']),
    });

    expect(mocks.deleteKnowledgeBase).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      dbProtected: 1,
      skippedDbProtected: 1,
      candidates: 0,
      deleted: 0,
    });
  });

  it('dry-runs by default and does not delete candidates', async () => {
    const nowMs = Date.parse('2026-05-28T20:00:00.000Z');
    mocks.listKnowledgeBases.mockResolvedValue([
      {
        knowledge_base_id: 'kb_candidate',
        knowledge_base_name: 'Old orphan',
        status: 'complete',
        user_modified_timestamp: nowMs - 2 * 60 * 60 * 1000,
      },
    ]);
    mocks.listLLMs.mockResolvedValue({ items: [], hasMore: false });

    const result = await cleanupUnreferencedRetellKnowledgeBases({
      nowMs,
      minAgeMs: 60 * 60 * 1000,
      retryDelayMs: 0,
      protectedKnowledgeBaseIds: new Set(),
    });

    expect(mocks.deleteKnowledgeBase).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dryRun: true, candidates: 1, deleted: 0 });
  });

  it('fails closed in delete mode when DB protection is unavailable', async () => {
    mocks.poolQuery.mockRejectedValueOnce(new Error('db down'));
    mocks.listKnowledgeBases.mockResolvedValue([
      {
        knowledge_base_id: 'kb_candidate',
        knowledge_base_name: 'Old orphan',
        status: 'complete',
        user_modified_timestamp: Date.now() - 2 * 60 * 60 * 1000,
      },
    ]);
    mocks.listLLMs.mockResolvedValue({ items: [], hasMore: false });

    const result = await cleanupUnreferencedRetellKnowledgeBases({
      dryRun: false,
      retryDelayMs: 0,
    });

    expect(mocks.deleteKnowledgeBase).not.toHaveBeenCalled();
    expect(result.skippedReason).toBe('DB_PROTECTION_UNAVAILABLE');
  });

  it('retries KB deletion before failing', async () => {
    mocks.deleteKnowledgeBase
      .mockRejectedValueOnce(new Error('Retell 500'))
      .mockResolvedValueOnce(undefined);

    await expect(deleteKnowledgeBaseWithRetry('kb_retry', { attempts: 2, delayMs: 0 }))
      .resolves.toBeUndefined();

    expect(mocks.deleteKnowledgeBase).toHaveBeenCalledTimes(2);
    expect(mocks.logWarn).toHaveBeenCalledTimes(1);
  });

  it('retries durable cleanup failures only after current safety guards pass', async () => {
    const nowMs = Date.parse('2026-05-28T20:00:00.000Z');
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('from retell_kb_cleanup_failures')) {
        return {
          rows: [{
            id: 'fail_1',
            knowledge_base_id: 'kb_retry_safe',
            knowledge_base_name: 'Retry me',
            attempts: 3,
            context: {},
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    mocks.listKnowledgeBases.mockResolvedValue([{
      knowledge_base_id: 'kb_retry_safe',
      knowledge_base_name: 'Retry me',
      status: 'complete',
      user_modified_timestamp: nowMs - 2 * 60 * 60 * 1000,
    }]);
    mocks.listLLMs.mockResolvedValue({ items: [], hasMore: false });
    mocks.deleteKnowledgeBase.mockResolvedValue(undefined);

    const result = await retryRetellKnowledgeBaseCleanupFailures({
      limit: 5,
      attempts: 1,
      delayMs: 0,
      minAgeMs: 60 * 60 * 1000,
      nowMs,
    });

    expect(mocks.deleteKnowledgeBase).toHaveBeenCalledWith('kb_retry_safe');
    expect(result).toMatchObject({ attempted: 1, resolved: 1, failed: 0 });
  });

  it('does not retry durable cleanup failures that became referenced', async () => {
    const nowMs = Date.parse('2026-05-28T20:00:00.000Z');
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('from retell_kb_cleanup_failures')) {
        return {
          rows: [{
            id: 'fail_1',
            knowledge_base_id: 'kb_now_active',
            knowledge_base_name: 'Active again',
            attempts: 3,
            context: {},
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    mocks.listKnowledgeBases.mockResolvedValue([{
      knowledge_base_id: 'kb_now_active',
      knowledge_base_name: 'Active again',
      status: 'complete',
      user_modified_timestamp: nowMs - 2 * 60 * 60 * 1000,
    }]);
    mocks.listLLMs.mockResolvedValue({
      items: [{ llm_id: 'llm_1', knowledge_base_ids: ['kb_now_active'] }],
      hasMore: false,
    });

    const result = await retryRetellKnowledgeBaseCleanupFailures({
      limit: 5,
      attempts: 1,
      delayMs: 0,
      minAgeMs: 60 * 60 * 1000,
      nowMs,
    });

    expect(mocks.deleteKnowledgeBase).not.toHaveBeenCalled();
    expect(result).toMatchObject({ attempted: 0, skippedReferenced: 1 });
  });
});
