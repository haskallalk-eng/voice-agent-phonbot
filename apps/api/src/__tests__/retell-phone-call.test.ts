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
    expect(body.retell_llm_dynamic_variables).toMatchObject({
      model_under_test: 'gpt-4.1-mini',
    });
    expect((body.retell_llm_dynamic_variables as Record<string, unknown>).current_date_iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('registerCall', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('injects date context into BYOT Retell calls', async () => {
    vi.stubEnv('RETELL_API_KEY', 'key_test');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      call_id: 'call_1',
      access_token: 'token_1',
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { registerCall } = await import('../retell.js');
    await registerCall({
      agentId: 'agent_test',
      fromNumber: '+4930123456',
      toNumber: '+491701234567',
      dynamicVariables: { flow: 'twilio' },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(body.agent_id).toBe('agent_test');
    expect(body.retell_llm_dynamic_variables).toMatchObject({ flow: 'twilio' });
    expect((body.retell_llm_dynamic_variables as Record<string, unknown>).date_lookup_de).toContain('heute:');
    expect((body.retell_llm_dynamic_variables as Record<string, unknown>).day_after_tomorrow_date_iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

  it('passes an explicit begin_message to Retell LLMs when configured', async () => {
    vi.stubEnv('RETELL_API_KEY', 'key_test');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      llm_id: 'llm_1',
      model: 'gpt-5.4-mini',
      general_prompt: 'prompt',
      general_tools: null,
      states: null,
      starting_state: null,
      model_high_priority: true,
      begin_message: 'Hallo einmal.',
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { createLLM } = await import('../retell.js');
    await createLLM({ generalPrompt: 'prompt', tools: [], beginMessage: 'Hallo einmal.' });

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(body.begin_message).toBe('Hallo einmal.');
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

  it('updates existing Retell LLM begin_message when configured', async () => {
    vi.stubEnv('RETELL_API_KEY', 'key_test');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      llm_id: 'llm_1',
      model: 'gpt-5.4-mini',
      general_prompt: 'prompt',
      general_tools: null,
      states: null,
      starting_state: null,
      model_high_priority: true,
      begin_message: 'Hallo einmal.',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { updateLLM } = await import('../retell.js');
    await updateLLM('llm_1', { beginMessage: 'Hallo einmal.' });

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(body.begin_message).toBe('Hallo einmal.');
  });
});

describe('Retell agent runtime tuning', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('can create a public demo agent with explicit turntaking and denoising tuning', async () => {
    vi.stubEnv('RETELL_API_KEY', 'key_test');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      agent_id: 'agent_1',
      agent_name: 'Agent',
      response_engine: { type: 'retell-llm', llm_id: 'llm_1' },
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { createAgent } = await import('../retell.js');
    await createAgent({
      name: 'Agent',
      llmId: 'llm_1',
      responsiveness: 0.87,
      interruptionSensitivity: 0.77,
      denoisingMode: 'no-denoise',
      enableDynamicResponsiveness: true,
      reminderTriggerMs: 9000,
      reminderMaxCount: 0,
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(body.responsiveness).toBe(0.87);
    expect(body.interruption_sensitivity).toBe(0.77);
    expect(body.denoising_mode).toBe('no-denoise');
    expect(body.enable_dynamic_responsiveness).toBe(true);
    expect(body.reminder_trigger_ms).toBe(9000);
    expect(body.reminder_max_count).toBe(0);
  });

  it('can update an existing public demo agent with explicit turntaking and denoising tuning', async () => {
    vi.stubEnv('RETELL_API_KEY', 'key_test');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      agent_id: 'agent_1',
      agent_name: 'Agent',
      response_engine: { type: 'retell-llm', llm_id: 'llm_1' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { updateAgent } = await import('../retell.js');
    await updateAgent('agent_1', {
      responsiveness: 0.87,
      interruptionSensitivity: 0.77,
      denoisingMode: 'no-denoise',
      enableDynamicResponsiveness: true,
      reminderTriggerMs: 9000,
      reminderMaxCount: 0,
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(body.responsiveness).toBe(0.87);
    expect(body.interruption_sensitivity).toBe(0.77);
    expect(body.denoising_mode).toBe('no-denoise');
    expect(body.enable_dynamic_responsiveness).toBe(true);
    expect(body.reminder_trigger_ms).toBe(9000);
    expect(body.reminder_max_count).toBe(0);
  });
});

describe('Retell phone number routing', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('updates phone numbers with weighted inbound/outbound agent lists', async () => {
    vi.stubEnv('RETELL_API_KEY', 'key_test');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { updatePhoneNumber } = await import('../retell.js');
    await updatePhoneNumber('+4930123456', {
      inboundAgentId: 'agent_in',
      outboundAgentId: 'agent_out',
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      inbound_agents: [{ agent_id: 'agent_in', agent_version: 0, weight: 1 }],
      outbound_agents: [{ agent_id: 'agent_out', agent_version: 0, weight: 1 }],
    });
    expect(body).not.toHaveProperty('inbound_agent_id');
    expect(body).not.toHaveProperty('outbound_agent_id');
  });
});
