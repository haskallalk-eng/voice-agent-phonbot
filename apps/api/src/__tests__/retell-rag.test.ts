import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLLM, updateLLM } from '../retell.js';

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
});
