import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createKnowledgeBase: vi.fn(),
  waitForKnowledgeBaseComplete: vi.fn(),
  deleteKnowledgeBase: vi.fn(),
  protectRetellKnowledgeBaseWindow: vi.fn(),
  deleteKnowledgeBaseWithRetry: vi.fn(),
}));

vi.mock('../db.js', () => ({ pool: null }));
vi.mock('../retell.js', () => mocks);
vi.mock('../retell-kb-cleanup.js', () => ({
  protectRetellKnowledgeBaseWindow: mocks.protectRetellKnowledgeBaseWindow,
  deleteKnowledgeBaseWithRetry: mocks.deleteKnowledgeBaseWithRetry,
}));

const { syncRetellKnowledgeBase } = await import('../knowledge.js');

describe('knowledge base sync lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.protectRetellKnowledgeBaseWindow.mockResolvedValue(undefined);
    mocks.deleteKnowledgeBaseWithRetry.mockResolvedValue(undefined);
  });

  it('deletes a newly created Retell KB when readiness polling fails and preserves the old KB', async () => {
    mocks.createKnowledgeBase.mockResolvedValue({
      knowledge_base_id: 'kb_new',
      knowledge_base_name: 'New KB',
      status: 'in_progress',
    });
    mocks.waitForKnowledgeBaseComplete.mockRejectedValue(new Error('RETELL_KB_NOT_READY:kb_new:in_progress'));

    await expect(syncRetellKnowledgeBase({
      businessName: 'Studio',
      retellKnowledgeBaseId: 'kb_old',
      knowledgeBaseSignature: 'old_signature',
    })).rejects.toThrow('RETELL_KB_NOT_READY');

    expect(mocks.deleteKnowledgeBaseWithRetry).toHaveBeenCalledWith('kb_new', expect.objectContaining({
      knowledgeBaseName: 'New KB',
    }));
    expect(mocks.deleteKnowledgeBaseWithRetry).not.toHaveBeenCalledWith('kb_old', expect.anything());
  });

  it('fails closed and queues cleanup when pending deploy protection cannot be recorded', async () => {
    mocks.createKnowledgeBase.mockResolvedValue({
      knowledge_base_id: 'kb_new',
      knowledge_base_name: 'New KB',
      status: 'in_progress',
    });
    mocks.protectRetellKnowledgeBaseWindow.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(syncRetellKnowledgeBase({
      businessName: 'Studio',
      tenantId: 'tenant_1',
    }, 'org_1')).rejects.toThrow('RETELL_KB_PROTECTION_FAILED');

    expect(mocks.waitForKnowledgeBaseComplete).not.toHaveBeenCalled();
    expect(mocks.deleteKnowledgeBaseWithRetry).toHaveBeenCalledWith('kb_new', expect.objectContaining({
      context: expect.objectContaining({ source: 'pending-protection-failed' }),
    }));
  });

  it('does not delete the old KB during sync before deploy persistence is durable', async () => {
    mocks.createKnowledgeBase.mockResolvedValue({
      knowledge_base_id: 'kb_new',
      knowledge_base_name: 'New KB',
      status: 'in_progress',
    });
    mocks.waitForKnowledgeBaseComplete.mockResolvedValue({
      knowledge_base_id: 'kb_new',
      knowledge_base_name: 'New KB',
      status: 'complete',
    });

    const synced = await syncRetellKnowledgeBase({
      businessName: 'Studio',
      retellKnowledgeBaseId: 'kb_old',
      knowledgeBaseSignature: 'old_signature',
    });

    expect(synced.retellKnowledgeBaseId).toBe('kb_new');
    expect(mocks.deleteKnowledgeBase).not.toHaveBeenCalledWith('kb_old');
  });

  it('verifies a matching stored KB before reusing it', async () => {
    mocks.createKnowledgeBase.mockResolvedValue({
      knowledge_base_id: 'kb_old',
      knowledge_base_name: 'Old KB',
      status: 'in_progress',
    });
    mocks.waitForKnowledgeBaseComplete.mockResolvedValue({
      knowledge_base_id: 'kb_old',
      knowledge_base_name: 'Old KB',
      status: 'complete',
    });

    const first = await syncRetellKnowledgeBase<Record<string, unknown>>({ businessName: 'Studio' });
    const reused = await syncRetellKnowledgeBase({
      businessName: 'Studio',
      retellKnowledgeBaseId: 'kb_old',
      knowledgeBaseSignature: first.knowledgeBaseSignature,
    });

    expect(reused.retellKnowledgeBaseId).toBe('kb_old');
    expect(mocks.createKnowledgeBase).toHaveBeenCalledTimes(1);
    expect(mocks.waitForKnowledgeBaseComplete).toHaveBeenCalledWith('kb_old', { timeoutMs: 5000, intervalMs: 1000 });
  });

  it('sends knowledge sources to Retell as fixed text snapshots instead of auto-refresh URLs', async () => {
    mocks.createKnowledgeBase.mockResolvedValue({
      knowledge_base_id: 'kb_new',
      knowledge_base_name: 'New KB',
      status: 'in_progress',
    });
    mocks.waitForKnowledgeBaseComplete.mockResolvedValue({
      knowledge_base_id: 'kb_new',
      knowledge_base_name: 'New KB',
      status: 'complete',
    });

    await syncRetellKnowledgeBase({
      businessName: 'Studio',
      tenantId: 'tenant_1',
      knowledgeSources: [
        { id: 'txt_1', type: 'text', name: 'FAQ', content: 'Starter kostet 89 Euro.' },
      ],
    }, 'org_1');

    expect(mocks.createKnowledgeBase).toHaveBeenCalledWith(expect.objectContaining({
      urls: [],
      enableAutoRefresh: false,
      texts: expect.arrayContaining([
        expect.objectContaining({ title: 'FAQ', text: expect.stringContaining('Starter kostet 89 Euro.') }),
      ]),
    }));
  });
});
