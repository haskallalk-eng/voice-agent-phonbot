import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createKnowledgeBase: vi.fn(),
  waitForKnowledgeBaseComplete: vi.fn(),
  deleteKnowledgeBase: vi.fn(),
}));

vi.mock('../db.js', () => ({ pool: null }));
vi.mock('../retell.js', () => mocks);

const { syncRetellKnowledgeBase } = await import('../knowledge.js');

describe('knowledge base sync lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(mocks.deleteKnowledgeBase).toHaveBeenCalledWith('kb_new');
    expect(mocks.deleteKnowledgeBase).not.toHaveBeenCalledWith('kb_old');
  });

  it('sends inspected website sources to Retell as fixed text snapshots instead of auto-refresh URLs', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => new Response(
      '<html><body><h1>FAQ</h1><p>Starter kostet 89 Euro.</p></body></html>',
      { headers: { 'content-type': 'text/html' } },
    ));
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

    try {
      await syncRetellKnowledgeBase({
        businessName: 'Studio',
        tenantId: 'tenant_1',
        knowledgeSources: [
          { id: 'url_1', type: 'url', name: 'FAQ', content: 'https://example.com/faq' },
        ],
      }, 'org_1');
    } finally {
      global.fetch = originalFetch;
    }

    expect(mocks.createKnowledgeBase).toHaveBeenCalledWith(expect.objectContaining({
      urls: [],
      enableAutoRefresh: false,
      texts: expect.arrayContaining([
        expect.objectContaining({ title: 'FAQ', text: expect.stringContaining('Starter kostet 89 Euro.') }),
      ]),
    }));
  });
});
