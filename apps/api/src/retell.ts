/**
 * Retell AI integration layer.
 *
 * Manages agents and LLMs via the Retell API.
 * Our dashboard creates/updates Retell resources through this module.
 */

const RETELL_API = 'https://api.retellai.com';

function getApiKey(): string {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new Error('RETELL_API_KEY not set');
  return key;
}

async function retellRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${RETELL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Retell API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// --- Types ---

export type RetellLLMConfig = {
  llm_id: string;
  general_prompt: string | null;
  general_tools: RetellTool[] | null;
  states: RetellState[] | null;
  starting_state: string | null;
  model: string;
};

export type RetellTool = {
  type: string;
  name: string;
  description: string;
  url?: string;
  execution_message_description?: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
};

export type RetellState = {
  name: string;
  state_prompt: string;
  tools?: RetellTool[];
  edges?: { destination_state_name: string; description: string }[];
};

export type RetellAgent = {
  agent_id: string;
  agent_name: string | null;
  response_engine: { type: string; llm_id: string };
  voice_id: string;
  voice_speed?: number;
  language?: string;
};

export type RetellPhoneNumber = {
  phone_number: string;
  phone_number_pretty: string;
  agent_id: string | null;
};

// --- LLM ---

export async function createLLM(config: {
  generalPrompt: string;
  tools: RetellTool[];
  model?: string;
}): Promise<RetellLLMConfig> {
  return retellRequest('/create-retell-llm', {
    method: 'POST',
    body: JSON.stringify({
      general_prompt: config.generalPrompt,
      general_tools: config.tools.length ? config.tools : undefined,
      model: config.model ?? 'gpt-4o-mini',
    }),
  });
}

export async function updateLLM(
  llmId: string,
  config: {
    generalPrompt?: string;
    tools?: RetellTool[];
    model?: string;
  },
): Promise<RetellLLMConfig> {
  const body: Record<string, unknown> = {};
  if (config.generalPrompt !== undefined) body.general_prompt = config.generalPrompt;
  if (config.tools !== undefined) body.general_tools = config.tools.length ? config.tools : [];
  if (config.model !== undefined) body.model = config.model;

  return retellRequest(`/update-retell-llm/${encodeURIComponent(llmId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function getLLM(llmId: string): Promise<RetellLLMConfig> {
  return retellRequest(`/get-retell-llm/${encodeURIComponent(llmId)}`);
}

// --- Agent ---

export async function createAgent(config: {
  name: string;
  llmId: string;
  voiceId?: string;
  language?: string;
}): Promise<RetellAgent> {
  return retellRequest('/create-agent', {
    method: 'POST',
    body: JSON.stringify({
      agent_name: config.name,
      response_engine: { type: 'retell-llm', llm_id: config.llmId },
      voice_id: config.voiceId ?? 'custom_voice_28bd4920fa6523c6ac8c4e527b',
      language: config.language ?? 'de-DE',
      interruption_sensitivity: 1.0,
      enable_backchannel: true,
      enable_dynamic_responsiveness: true,
    }),
  });
}

export async function updateAgent(
  agentId: string,
  config: {
    name?: string;
    voiceId?: string;
    language?: string;
    llmId?: string;
  },
): Promise<RetellAgent> {
  const body: Record<string, unknown> = {
    interruption_sensitivity: 1.0,
    enable_backchannel: true,
    enable_dynamic_responsiveness: true,
  };
  if (config.name !== undefined) body.agent_name = config.name;
  if (config.voiceId !== undefined) body.voice_id = config.voiceId;
  if (config.language !== undefined) body.language = config.language;
  if (config.llmId !== undefined) body.response_engine = { type: 'retell-llm', llm_id: config.llmId };

  return retellRequest(`/update-agent/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// --- Call History ---

export type RetellCall = {
  call_id: string;
  agent_id: string;
  call_type: string;
  call_status: string;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  transcript?: string;
  recording_url?: string;
  call_analysis?: unknown;
  disconnection_reason?: string;
};

export async function listCalls(agentId?: string, limit = 50): Promise<RetellCall[]> {
  const body: Record<string, unknown> = { limit };
  if (agentId) {
    body.filter_criteria = { agent_id: [agentId] };
  }
  const res = await retellRequest<RetellCall[] | { value?: RetellCall[] }>('/v2/list-calls', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  // Retell returns { value: [...] } or an array directly
  return Array.isArray(res) ? res : ((res as { value?: RetellCall[] })?.value ?? []);
}

export async function getCall(callId: string): Promise<RetellCall> {
  return retellRequest(`/v2/get-call/${encodeURIComponent(callId)}`);
}

export async function getAgent(agentId: string): Promise<RetellAgent> {
  return retellRequest(`/get-agent/${encodeURIComponent(agentId)}`);
}

export async function listAgents(): Promise<RetellAgent[]> {
  return retellRequest('/list-agents');
}

// --- Voices ---

export type RetellVoice = {
  voice_id: string;
  voice_name: string;
  voice_type: 'built_in' | 'cloned';
  provider?: string;
  accent?: string;
  gender?: string;
  age?: string;
  preview_audio_url?: string;
};

// List all voices (built-in + custom)
export async function listVoices(): Promise<RetellVoice[]> {
  const res = await retellRequest<RetellVoice[] | { voices?: RetellVoice[] }>('/list-voices');
  return Array.isArray(res) ? res : ((res as { voices?: RetellVoice[] })?.voices ?? []);
}

// Clone voice from audio file
// voice_provider: 'elevenlabs' | 'cartesia' | 'minimax' | 'fish_audio' | 'platform'
export async function createVoice(
  name: string,
  audioBuffer: Buffer,
  provider: string = 'cartesia',
): Promise<RetellVoice> {
  const formData = new FormData();
  formData.append('voice_name', name);
  formData.append('voice_provider', provider);
  formData.append('files', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/wav' }), 'voice.wav');

  const res = await fetch('https://api.retellai.com/clone-voice', {
    method: 'POST',
    headers: { Authorization: `Bearer ${getApiKey()}` },
    body: formData,
  });
  if (!res.ok) throw new Error(`Retell API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<RetellVoice>;
}

// --- Phone Numbers ---

export async function listPhoneNumbers(): Promise<RetellPhoneNumber[]> {
  return retellRequest('/list-phone-numbers');
}

// --- Phone Number Config ---

export async function updatePhoneNumber(
  phoneNumber: string,
  config: { outboundAgentId?: string; inboundAgentId?: string },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (config.outboundAgentId) body.outbound_agent_id = config.outboundAgentId;
  if (config.inboundAgentId) body.inbound_agent_id = config.inboundAgentId;

  await retellRequest(`/update-phone-number/${encodeURIComponent(phoneNumber)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// --- Web Call (for test console) ---

export type WebCallResponse = {
  call_id: string;
  web_call_link: string;
  access_token: string;
};

export async function createWebCall(agentId: string): Promise<WebCallResponse> {
  return retellRequest('/v2/create-web-call', {
    method: 'POST',
    body: JSON.stringify({ agent_id: agentId }),
  });
}

// --- BYOT: Register Call (Bring Your Own Telephony) ---

export type RegisterCallResponse = {
  call_id: string;
  access_token: string; // used as WebSocket URL suffix
};

/**
 * Register a call with Retell so a third-party telephony provider (e.g. Twilio)
 * can stream audio to the Retell AI agent.
 * Returns a call_id whose audio WebSocket is at:
 *   wss://api.retellai.com/audio-websocket/<call_id>
 */
export async function registerCall(config: {
  agentId: string;
  fromNumber: string;
  toNumber: string;
}): Promise<RegisterCallResponse> {
  return retellRequest('/v2/register-call', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: config.agentId,
      audio_websocket_protocol: 'twilio',
      audio_encoding: 'mulaw_8000',
      sample_rate: 8000,
      from_number: config.fromNumber,
      to_number: config.toNumber,
    }),
  });
}

// --- Outbound Phone Call ---

export type PhoneCallResponse = {
  call_id: string;
  agent_id: string;
  call_type: 'phone_call';
  call_status: string;
};

/**
 * Initiate an outbound phone call via Retell.
 * Requires a provisioned "from" phone number in your Retell account.
 */
export async function createPhoneCall(config: {
  agentId: string;
  toNumber: string;
  fromNumber: string;
  metadata?: Record<string, string>;
  dynamicVariables?: Record<string, string>;
}): Promise<PhoneCallResponse> {
  return retellRequest('/v2/create-phone-call', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: config.agentId,
      to_number: config.toNumber,
      from_number: config.fromNumber,
      metadata: config.metadata,
      retell_llm_dynamic_variables: config.dynamicVariables,
    }),
  });
}
