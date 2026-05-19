import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLLM, updateLLM, waitForKnowledgeBaseComplete } from '../retell.js';

describe('Retell RAG configuration', () => {
  beforeEach(() => {
    vi.stubEnv('RETELL_API_KEY', 'test-retell-key');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ llm_id: 'llm_test', general_prompt: null, general_tools: [] }),
    })));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends kb_config when creating an LLM with a knowledge base', async () => {
    await createLLM({
      generalPrompt: 'Prompt',
      tools: [],
      knowledgeBaseIds: ['kb_123'],
      kbConfig: { top_k: 2, filter_score: 0.72 },
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      knowledge_base_ids: ['kb_123'],
      kb_config: { top_k: 2, filter_score: 0.72 },
    });
  });

  it('sends kb_config when updating an LLM with a knowledge base', async () => {
    await updateLLM('llm_123', {
      knowledgeBaseIds: ['kb_123'],
      kbConfig: { top_k: 5, filter_score: 0.48 },
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      knowledge_base_ids: ['kb_123'],
      kb_config: { top_k: 5, filter_score: 0.48 },
    });
  });

  it('polls until a newly created knowledge base is complete', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ knowledge_base_id: 'kb_123', knowledge_base_name: 'KB', status: 'in_progress' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ knowledge_base_id: 'kb_123', knowledge_base_name: 'KB', status: 'complete' }),
      } as Response);

    const kb = await waitForKnowledgeBaseComplete('kb_123', { intervalMs: 0, timeoutMs: 1000 });

    expect(kb.status).toBe('complete');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain('/get-knowledge-base/kb_123');
  });

  it('fails fast when Retell marks a knowledge base as errored', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ knowledge_base_id: 'kb_123', knowledge_base_name: 'KB', status: 'error' }),
    } as Response);

    await expect(waitForKnowledgeBaseComplete('kb_123', { intervalMs: 0, timeoutMs: 1000 }))
      .rejects.toThrow('RETELL_KB_ERROR');
  });
});
