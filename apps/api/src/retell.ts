/**
 * Retell AI integration layer.
 *
 * Manages agents and LLMs via the Retell API.
 * Our dashboard creates/updates Retell resources through this module.
 */

const RETELL_API = 'https://api.retellai.com';

// Default voice for new demo agents + fallback when an agent config has no explicit voice.
// "Chipy" is now the ElevenLabs Hassieb-Kalla clone (custom voice at Retell,
// 11labs backend) — higher audio quality than the Cartesia version, at
// ~$0.040/min vs ~$0.015/min. Override via env RETELL_DEFAULT_VOICE_ID
// without a code deploy; the Cartesia original still exists at Retell as
// custom_voice_28bd4920fa6523c6ac8c4e527b for rollback if costs spike.
export const DEFAULT_VOICE_ID =
  process.env.RETELL_DEFAULT_VOICE_ID ?? 'custom_voice_5269b3f4732a77b9030552fd67';

function getApiKey(): string {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new Error('RETELL_API_KEY not set');
  return key;
}

// 15s timeout on every Retell call — prevents server-wide hang on API outage
// (would otherwise cascade into Fastify worker saturation + Stripe webhook retries).
const RETELL_TIMEOUT_MS = 15_000;

async function retellRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${RETELL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    signal: AbortSignal.timeout(RETELL_TIMEOUT_MS),
  }).catch((e: Error) => {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new Error(`Retell API timeout after ${RETELL_TIMEOUT_MS}ms at ${path}`);
    }
    throw e;
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

// Retell agent-tuning defaults — overridable per-call and via env (RETELL_AGENT_*)
// so we can A/B voice behaviour without a code deploy. Also lets individual agents
// differ (a sleepy arztpraxis shouldn't interrupt as eagerly as a hairdresser).
function defaultInterruption(): number {
  const raw = process.env.RETELL_AGENT_INTERRUPTION_SENSITIVITY;
  if (raw === undefined || raw === '') return 1.0;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    // Warn once at first use so a typo (e.g. "0,5" or "auto") doesn't silently
    // fall back to 1.0 without anyone noticing. Log to stderr (no pino here —
    // this module is imported synchronously before app logger is wired up).
    process.stderr.write(`[retell] RETELL_AGENT_INTERRUPTION_SENSITIVITY=${JSON.stringify(raw)} is not a number in [0,1] — using default 1.0\n`);
    return 1.0;
  }
  return v;
}
function defaultBackchannel(): boolean {
  return process.env.RETELL_AGENT_BACKCHANNEL !== 'false';
}

/** Hard timeout — Retell hangs up after N ms of unbroken silence.
 *  Default 45 s so a caller who wandered off / dropped the line can't
 *  rack up open minutes forever. */
function defaultEndCallSilenceMs(): number {
  const raw = process.env.RETELL_AGENT_END_CALL_SILENCE_MS;
  if (raw === undefined || raw === '') return 45_000;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 10_000) return 45_000;
  return v;
}

/** Post-call analysis field definition (Retell API shape).
 *  Retell only supports string / enum / system-presets — numeric or date
 *  values must come back as strings and be parsed on our side. */
export type PostCallAnalysisField = {
  type: 'string' | 'enum' | 'system-presets';
  name: string;
  description: string;
  required?: boolean;
  choices?: string[];
  conditional_prompt?: string;
};

export async function createAgent(config: {
  name: string;
  llmId: string;
  voiceId?: string;
  language?: string;
  interruptionSensitivity?: number;
  enableBackchannel?: boolean;
  webhookUrl?: string;
  postCallAnalysisData?: PostCallAnalysisField[];
}): Promise<RetellAgent> {
  const body: Record<string, unknown> = {
    agent_name: config.name,
    response_engine: { type: 'retell-llm', llm_id: config.llmId },
    voice_id: config.voiceId ?? DEFAULT_VOICE_ID,
    language: config.language ?? 'de-DE',
    interruption_sensitivity: config.interruptionSensitivity ?? defaultInterruption(),
    enable_backchannel: config.enableBackchannel ?? defaultBackchannel(),
    enable_dynamic_responsiveness: true,
    end_call_after_silence_ms: defaultEndCallSilenceMs(),
  };
  // webhook_url is per-agent — without it, Retell never sends call_ended
  // (which means no billing reconcile, no transcript store, no DELETE on
  // consent-declined calls). Agent-level is correct because web calls
  // inherit it; phone-number-level webhooks only apply to PSTN.
  if (config.webhookUrl) body.webhook_url = config.webhookUrl;
  if (config.postCallAnalysisData !== undefined) {
    body.post_call_analysis_data = config.postCallAnalysisData;
  }
  return retellRequest('/create-agent', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateAgent(
  agentId: string,
  config: {
    name?: string;
    voiceId?: string;
    language?: string;
    llmId?: string;
    interruptionSensitivity?: number;
    enableBackchannel?: boolean;
    webhookUrl?: string;
    postCallAnalysisData?: PostCallAnalysisField[];
  },
): Promise<RetellAgent> {
  // RET-08: only set tuning params when the caller explicitly provides them.
  // Previously both were ALWAYS sent (defaulting from env or 1.0/true), so a
  // name-only update silently reset any per-agent tuning the user had
  // configured in the Retell dashboard. Now we only override when asked.
  const body: Record<string, unknown> = {
    enable_dynamic_responsiveness: true,
    end_call_after_silence_ms: defaultEndCallSilenceMs(),
  };
  if (config.interruptionSensitivity !== undefined) body.interruption_sensitivity = config.interruptionSensitivity;
  if (config.enableBackchannel !== undefined) body.enable_backchannel = config.enableBackchannel;
  if (config.name !== undefined) body.agent_name = config.name;
  if (config.voiceId !== undefined) body.voice_id = config.voiceId;
  if (config.language !== undefined) body.language = config.language;
  if (config.llmId !== undefined) body.response_engine = { type: 'retell-llm', llm_id: config.llmId };
  if (config.webhookUrl !== undefined) body.webhook_url = config.webhookUrl;
  if (config.postCallAnalysisData !== undefined) body.post_call_analysis_data = config.postCallAnalysisData;

  return retellRequest(`/update-agent/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// --- Call History ---

/** Retell exposes measured latencies per call in seconds on top-level
 *  latency.* fields. e2e.p50 is the "first user input → first audio
 *  byte out" metric — the number users actually hear. */
export type RetellLatencyBreakdown = {
  p50?: number;
  p90?: number;
  p95?: number;
  p99?: number;
  min?: number;
  max?: number;
  num?: number;
  sum?: number;
  /** Per-turn raw measurements in chronological order. */
  values?: number[];
};
export type RetellLatency = {
  e2e?: RetellLatencyBreakdown;
  llm?: RetellLatencyBreakdown;
  llm_websocket_network_rtt?: RetellLatencyBreakdown;
  tts?: RetellLatencyBreakdown;
  asr?: RetellLatencyBreakdown;
  knowledge_base?: RetellLatencyBreakdown;
  s2s?: RetellLatencyBreakdown;
};

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
  latency?: RetellLatency;
};

export async function listCalls(agentId?: string | string[], limit = 50): Promise<RetellCall[]> {
  const body: Record<string, unknown> = { limit };
  if (agentId) {
    // Defensive filter — drop any falsy/whitespace IDs (an undeployed agent's
    // retellAgentId can be undefined). Without this, an empty entry could in
    // theory be interpreted as "no filter" by Retell and leak ALL tenants'
    // calls to a single org. The caller already filters, but defence in depth.
    const arr = (Array.isArray(agentId) ? agentId : [agentId])
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    if (arr.length === 0) return [];
    body.filter_criteria = { agent_id: arr };
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

/**
 * Delete a call's audio recording, transcript, and metadata from Retell.
 * Used to honour § 201 StGB / Art. 6 DSGVO when the caller declines consent
 * to recording mid-call: we let the call finish, then scrub it.
 * Retell docs: DELETE /v2/delete-call/{call_id} → 204.
 */
export async function deleteCall(callId: string): Promise<void> {
  const res = await fetch(`${RETELL_API}/v2/delete-call/${encodeURIComponent(callId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getApiKey()}` },
    signal: AbortSignal.timeout(RETELL_TIMEOUT_MS),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Retell delete-call ${res.status}: ${await res.text()}`);
  }
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
  mime: string = 'audio/wav',
  ext: string = 'wav',
): Promise<RetellVoice> {
  const formData = new FormData();
  formData.append('voice_name', name);
  formData.append('voice_provider', provider);
  formData.append('files', new Blob([new Uint8Array(audioBuffer)], { type: mime }), `voice.${ext}`);

  // RET-01: voice-clone uploads can be slow (large audio file + server-side
  // processing). 60s is generous but bounded — without it a hung upload pins
  // the Fastify worker indefinitely (every other Retell call has the 15s cap
  // via retellRequest, but this one bypasses it for FormData).
  const res = await fetch('https://api.retellai.com/clone-voice', {
    method: 'POST',
    headers: { Authorization: `Bearer ${getApiKey()}` },
    body: formData,
    signal: AbortSignal.timeout(60_000),
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
