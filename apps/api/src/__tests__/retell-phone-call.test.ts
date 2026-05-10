import { afterEach, describe, expect, it, vi } from 'vitest';

describe('createPhoneCall', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('uses Retell v2 override_agent_id for one-off outbound agents', async () => {
    vi.stubEnv('RETELL_API_KEY', 'key_test');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      call_id: 'call_1',
      agent_id: 'agent_test',
      call_type: 'phone_call',
      call_status: 'registered',
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { createPhoneCall } = await import('../retell.js');
    await createPhoneCall({
      agentId: 'agent_test',
      fromNumber: '+4930123456',
      toNumber: '+491701234567',
      metadata: { source: 'test' },
      dynamicVariables: { model_under_test: 'gpt-4.1-mini' },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBeTypeOf('string');
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(body.override_agent_id).toBe('agent_test');
    expect(body).not.toHaveProperty('agent_id');
    expect(body.from_number).toBe('+4930123456');
    expect(body.to_number).toBe('+491701234567');
  });
});

describe('Retell LLM defaults', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('creates Retell LLMs on gpt-5.4-mini Fast Tier by default', async () => {
    vi.stubEnv('RETELL_API_KEY', 'key_test');
    vi.stubEnv('RETELL_LLM_MODEL', '');
    vi.stubEnv('RETELL_LLM_FAST_TIER', '');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      llm_id: 'llm_1',
      model: 'gpt-5.4-mini',
      general_prompt: 'prompt',
      general_tools: null,
      states: null,
      starting_state: null,
      model_high_priority: true,
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { createLLM } = await import('../retell.js');
    await createLLM({ generalPrompt: 'prompt', tools: [] });

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body.model_high_priority).toBe(true);
  });

  it('updates existing Retell LLMs onto Fast Tier', async () => {
    vi.stubEnv('RETELL_API_KEY', 'key_test');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      llm_id: 'llm_1',
      model: 'gpt-5.4-mini',
      general_prompt: 'prompt',
      general_tools: null,
      states: null,
      starting_state: null,
      model_high_priority: true,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { updateLLM } = await import('../retell.js');
    await updateLLM('llm_1', { model: 'gpt-5.4-mini', generalPrompt: 'prompt' });

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body.model_high_priority).toBe(true);
  });
});
