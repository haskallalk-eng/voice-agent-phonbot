/**
 * Retell AI integration layer.
 *
 * Manages agents and LLMs via the Retell API.
 * Our dashboard creates/updates Retell resources through this module.
 */

import { buildCurrentDateDynamicVariables } from './time-context.js';

const RETELL_API = 'https://api.retellai.com';
const DEFAULT_RETELL_LLM_MODEL = 'gpt-5.4-mini';

export function getDefaultRetellLlmModel(): string {
  const configured = process.env.RETELL_LLM_MODEL?.trim();
  return configured || DEFAULT_RETELL_LLM_MODEL;
}

export function getDefaultRetellLlmHighPriority(): boolean {
  const raw = process.env.RETELL_LLM_FAST_TIER ?? process.env.RETELL_LLM_HIGH_PRIORITY;
  if (raw === undefined || raw.trim() === '') return true;
  return /^(1|true|yes|ja|on)$/i.test(raw.trim());
}

// Default voices for new demo agents + fallback when an agent config has no explicit voice.
// HQ prioritizes human quality, but phone preview needs low first-audio latency.
// eleven_flash_v2_5 keeps the ElevenLabs voice while avoiding multilingual_v2's
// ~1s TTS p50 stalls seen in live preview calls.
// Standard prioritizes robust/lower-cost phone delivery: Cartesia Sonic 3 German
// Conversational Woman, imported into this Retell workspace as a community voice.
export const DEFAULT_STANDARD_VOICE_ID =
  process.env.RETELL_DEFAULT_STANDARD_VOICE_ID ?? 'custom_voice_6c5fa792073cea70bc19314f26';

export const DEFAULT_VOICE_ID =
  process.env.RETELL_DEFAULT_HQ_VOICE_ID ??
  process.env.RETELL_DEFAULT_VOICE_ID ??
  'custom_voice_74a89687ae8c8f1ad19e239e7c';

const NATIVE_GERMAN_ELEVENLABS_VOICE_IDS = new Set<string>([
  'custom_voice_f428053d5d6100d7a2611e0cc4',
  'custom_voice_74a89687ae8c8f1ad19e239e7c',
  'custom_voice_3426c893b24dd3173a963f232c',
  'custom_voice_725e2277b354e8b7054d53be8c',
  'custom_voice_03f8ac3359115054f10be9b797',
  'custom_voice_b743578aa93ec1805bf60bd3d6',
  'custom_voice_90cc9e158bae7cc1cf2f529d2f',
  'custom_voice_da3278f195cd36f184519418a8',
  'custom_voice_68fd41f2d8c9a667ae7beaeb6a',
  'custom_voice_6ce325659b4010bc1548f71370',
  'custom_voice_e315018c30eeb6afe1c67e8606',
  'custom_voice_d93929fcbf7010ad6ed689e480',
  'custom_voice_1e7fa582a4061344be3ff1137b',
  'custom_voice_a743c0dfd71db77e5a44e330e1',
]);

function getApiKey(): string {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new Error('RETELL_API_KEY not set');
  return key;
}

// 15s timeout on every Retell call — prevents server-wide hang on API outage
// (would otherwise cascade into Fastify worker saturation + Stripe webhook retries).
const RETELL_TIMEOUT_MS = 15_000;
const DEFAULT_KB_READY_TIMEOUT_MS = 45_000;
const DEFAULT_KB_READY_INTERVAL_MS = 2_000;

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

async function retellFormRequest<T>(path: string, form: FormData, init?: RequestInit): Promise<T> {
  const res = await fetch(`${RETELL_API}${path}`, {
    ...init,
    method: init?.method ?? 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      ...init?.headers,
    },
    body: form,
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
  knowledge_base_ids?: string[] | null;
  kb_config?: { top_k?: number; filter_score?: number; knowledge_base_ids?: string[] } | null;
  states: RetellState[] | null;
  starting_state: string | null;
  model: string;
  model_high_priority?: boolean | null;
  begin_message?: string | null;
};

export type RetellLLMSummary = Partial<RetellLLMConfig> & {
  llm_id: string;
  version?: number;
  last_modification_timestamp?: number;
};

export type RetellLLMList = {
  items: RetellLLMSummary[];
  hasMore: boolean;
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
  response_engine: { type: string; llm_id?: string; llm_websocket_url?: string };
  voice_id: string;
  voice_model?: string | null;
  fallback_voice_ids?: string[] | null;
  voice_speed?: number;
  language?: string;
  responsiveness?: number;
  interruption_sensitivity?: number;
  enable_dynamic_responsiveness?: boolean;
  denoising_mode?: RetellDenoisingMode | null;
  reminder_trigger_ms?: number;
  reminder_max_count?: number;
};

export type RetellPhoneNumber = {
  phone_number: string;
  phone_number_pretty: string;
  agent_id: string | null;
  inbound_agents?: Array<{ agent_id?: string | null; agent_version?: number; weight?: number }> | null;
  outbound_agents?: Array<{ agent_id?: string | null; agent_version?: number; weight?: number }> | null;
};

export type RetellKnowledgeBase = {
  knowledge_base_id: string;
  knowledge_base_name: string;
  status: 'in_progress' | 'complete' | 'error' | 'refreshing_in_progress';
  knowledge_base_sources?: Array<Record<string, unknown>>;
  enable_auto_refresh?: boolean;
  user_modified_timestamp?: number;
};

// --- LLM ---

export async function createLLM(config: {
  generalPrompt: string;
  tools: RetellTool[];
  model?: string;
  modelTemperature?: number;
  modelHighPriority?: boolean;
  beginMessage?: string;
  knowledgeBaseIds?: string[];
  kbConfig?: { top_k?: number; filter_score?: number };
}): Promise<RetellLLMConfig> {
  return retellRequest('/create-retell-llm', {
    method: 'POST',
    body: JSON.stringify({
      general_prompt: config.generalPrompt,
      general_tools: config.tools.length ? config.tools : undefined,
      model: config.model ?? getDefaultRetellLlmModel(),
      model_temperature: config.modelTemperature,
      model_high_priority: config.modelHighPriority ?? getDefaultRetellLlmHighPriority(),
      begin_message: config.beginMessage,
      knowledge_base_ids: config.knowledgeBaseIds?.length ? config.knowledgeBaseIds : undefined,
      kb_config: config.knowledgeBaseIds?.length ? (config.kbConfig ?? { top_k: 3, filter_score: 0.6 }) : undefined,
    }),
  });
}

export async function updateLLM(
  llmId: string,
  config: {
    generalPrompt?: string;
    tools?: RetellTool[];
    model?: string;
    modelTemperature?: number;
    modelHighPriority?: boolean;
    beginMessage?: string;
    knowledgeBaseIds?: string[];
    kbConfig?: { top_k?: number; filter_score?: number };
  },
): Promise<RetellLLMConfig> {
  const body: Record<string, unknown> = {};
  if (config.generalPrompt !== undefined) body.general_prompt = config.generalPrompt;
  if (config.tools !== undefined) body.general_tools = config.tools.length ? config.tools : [];
  if (config.model !== undefined) body.model = config.model;
  if (config.modelTemperature !== undefined) body.model_temperature = config.modelTemperature;
  if (config.beginMessage !== undefined) body.begin_message = config.beginMessage;
  body.model_high_priority = config.modelHighPriority ?? getDefaultRetellLlmHighPriority();
  if (config.knowledgeBaseIds !== undefined) {
    body.knowledge_base_ids = config.knowledgeBaseIds.length ? config.knowledgeBaseIds : [];
    if (config.knowledgeBaseIds.length) body.kb_config = config.kbConfig ?? { top_k: 3, filter_score: 0.6 };
  }

  return retellRequest(`/update-retell-llm/${encodeURIComponent(llmId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function getLLM(llmId: string): Promise<RetellLLMConfig> {
  return retellRequest(`/get-retell-llm/${encodeURIComponent(llmId)}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayField<T>(record: Record<string, unknown>, keys: string[]): T[] | null {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value as T[];
  }
  return null;
}

function responseHasMore(record: Record<string, unknown>): boolean {
  if (record.has_more === true || record.hasMore === true) return true;
  if (typeof record.next_cursor === 'string' && record.next_cursor.trim()) return true;
  if (typeof record.nextCursor === 'string' && record.nextCursor.trim()) return true;
  const pagination = asRecord(record.pagination);
  return Boolean(pagination?.has_more === true || pagination?.hasMore === true);
}

export async function listLLMs(): Promise<RetellLLMList> {
  const res = await retellRequest<unknown>('/v2/list-retell-llms');
  if (Array.isArray(res)) return { items: res, hasMore: false };
  const record = asRecord(res);
  if (!record) throw new Error('RETELL_LLM_LIST_UNSUPPORTED_SHAPE');
  const items = arrayField<RetellLLMSummary>(record, ['items', 'data', 'llms', 'retell_llms']);
  if (!items) throw new Error('RETELL_LLM_LIST_UNSUPPORTED_SHAPE');
  return { items, hasMore: responseHasMore(record) };
}

// --- Knowledge Base ---

function appendKnowledgeArray(form: FormData, name: string, values: unknown[]): void {
  if (!values.length) return;
  form.append(name, JSON.stringify(values));
}

export async function createKnowledgeBase(config: {
  name: string;
  texts?: Array<{ title: string; text: string }>;
  urls?: string[];
  files?: Array<{ filename: string; mimeType: string; data: Buffer | Uint8Array }>;
  enableAutoRefresh?: boolean;
}): Promise<RetellKnowledgeBase> {
  const form = new FormData();
  form.append('knowledge_base_name', config.name);
  appendKnowledgeArray(form, 'knowledge_base_texts', config.texts ?? []);
  appendKnowledgeArray(form, 'knowledge_base_urls', config.urls ?? []);
  for (const file of config.files ?? []) {
    form.append(
      'knowledge_base_files',
      new Blob([new Uint8Array(file.data)], { type: file.mimeType || 'application/pdf' }),
      file.filename,
    );
  }
  if (config.urls?.length) form.append('enable_auto_refresh', String(config.enableAutoRefresh ?? true));

  return retellFormRequest('/create-knowledge-base', form);
}

export async function getKnowledgeBase(knowledgeBaseId: string): Promise<RetellKnowledgeBase> {
  return retellRequest(`/get-knowledge-base/${encodeURIComponent(knowledgeBaseId)}`);
}

export async function listKnowledgeBases(): Promise<RetellKnowledgeBase[]> {
  const res = await retellRequest<unknown>('/list-knowledge-bases');
  if (Array.isArray(res)) return res as RetellKnowledgeBase[];
  const record = asRecord(res);
  if (!record) throw new Error('RETELL_KB_LIST_UNSUPPORTED_SHAPE');
  if (responseHasMore(record)) throw new Error('RETELL_KB_LIST_PAGINATED');
  const items = arrayField<RetellKnowledgeBase>(record, ['items', 'data', 'knowledge_bases', 'knowledgeBases']);
  if (!items) throw new Error('RETELL_KB_LIST_UNSUPPORTED_SHAPE');
  return items;
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function envMilliseconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function waitForKnowledgeBaseComplete(
  knowledgeBaseId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<RetellKnowledgeBase> {
  const timeoutMs = opts.timeoutMs ?? envMilliseconds('RETELL_KB_READY_TIMEOUT_MS', DEFAULT_KB_READY_TIMEOUT_MS);
  const intervalMs = opts.intervalMs ?? envMilliseconds('RETELL_KB_READY_INTERVAL_MS', DEFAULT_KB_READY_INTERVAL_MS);
  const startedAt = Date.now();

  for (;;) {
    const kb = await getKnowledgeBase(knowledgeBaseId);
    if (kb.status === 'complete') return kb;
    if (kb.status === 'error') throw new Error(`RETELL_KB_ERROR:${knowledgeBaseId}`);
    if (Date.now() - startedAt >= timeoutMs) throw new Error(`RETELL_KB_NOT_READY:${knowledgeBaseId}:${kb.status}`);
    await sleep(intervalMs);
  }
}

export async function deleteKnowledgeBase(knowledgeBaseId: string): Promise<void> {
  const res = await fetch(`${RETELL_API}/delete-knowledge-base/${encodeURIComponent(knowledgeBaseId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getApiKey()}` },
    signal: AbortSignal.timeout(RETELL_TIMEOUT_MS),
  });
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    throw new Error(`Retell API ${res.status}: ${await res.text()}`);
  }
}

// --- Agent ---

// Retell agent-tuning defaults — overridable per-call and via env (RETELL_AGENT_*)
// so we can A/B voice behaviour without a code deploy. Also lets individual agents
// differ by tone and pacing across industries.
function defaultInterruption(): number {
  const raw = process.env.RETELL_AGENT_INTERRUPTION_SENSITIVITY;
  if (raw === undefined || raw === '') return 0.8;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    // Warn once at first use so a typo (e.g. "0,5" or "auto") doesn't silently
    // fall back to 0.8 without anyone noticing. Log to stderr (no pino here —
    // this module is imported synchronously before app logger is wired up).
    process.stderr.write(`[retell] RETELL_AGENT_INTERRUPTION_SENSITIVITY=${JSON.stringify(raw)} is not a number in [0,1] — using default 0.8\n`);
    return 0.8;
  }
  return v;
}
function defaultBackchannel(): boolean {
  const raw = process.env.RETELL_AGENT_BACKCHANNEL;
  if (raw === undefined || raw === '') return false;
  return raw === 'true';
}

function defaultReminderTriggerMs(): number {
  const raw = process.env.RETELL_AGENT_REMINDER_TRIGGER_MS;
  if (raw === undefined || raw === '') return 5_500;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 1_000) return 5_500;
  return v;
}

function defaultReminderMaxCount(): number {
  const raw = process.env.RETELL_AGENT_REMINDER_MAX_COUNT;
  if (raw === undefined || raw === '') return 1;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0 || v > 5) return 1;
  return Math.round(v);
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

/**
 * Retell `data_storage_setting` controls what Retell persists after a call:
 *  • 'everything'              — transcripts + recordings + logs (default)
 *  • 'everything_except_pii'   — same minus auto-detected PII fields
 *  • 'basic_attributes_only'   — call metadata only, no transcripts/recordings/logs
 *
 * Replaces the deprecated `opt_out_sensitive_data_storage` flag.
 */
export type RetellDataStorageSetting =
  | 'everything'
  | 'everything_except_pii'
  | 'basic_attributes_only';

type RetellVoiceModel =
  | 'eleven_turbo_v2'
  | 'eleven_flash_v2'
  | 'eleven_turbo_v2_5'
  | 'eleven_flash_v2_5'
  | 'eleven_multilingual_v2'
  | 'eleven_v3'
  | 'sonic-3'
  | 'sonic-3-latest'
  | 'tts-1'
  | 'gpt-4o-mini-tts'
  | 'speech-02-turbo'
  | 'speech-2.8-turbo'
  | 's1'
  | 's2-pro';

export type RetellDenoisingMode =
  | 'no-denoise'
  | 'noise-cancellation'
  | 'noise-and-background-speech-cancellation';

type VoiceRuntimeConfig = {
  voiceModel?: RetellVoiceModel | null;
  voiceTemperature?: number;
  fallbackVoiceIds?: string[] | null;
};

type CustomLlmAgentConfig = {
  name: string;
  llmWebsocketUrl: string;
  voiceId?: string;
  language?: string;
  voiceSpeed?: number;
  voiceModel?: RetellVoiceModel | null;
  voiceTemperature?: number;
  fallbackVoiceIds?: string[] | null;
  responsiveness?: number;
  denoisingMode?: RetellDenoisingMode;
  maxCallDurationMs?: number;
  interruptionSensitivity?: number;
  enableDynamicResponsiveness?: boolean;
  reminderTriggerMs?: number;
  reminderMaxCount?: number;
  enableBackchannel?: boolean;
  allowUserDtmf?: boolean;
  webhookUrl?: string;
  postCallAnalysisData?: PostCallAnalysisField[];
  dataStorageSetting?: RetellDataStorageSetting;
  dataStorageRetentionDays?: number;
};

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

function envCsv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
}

function defaultHqRuntime(): VoiceRuntimeConfig {
  return {
    voiceModel: (process.env.RETELL_DEFAULT_VOICE_MODEL as RetellVoiceModel | undefined) ?? 'eleven_flash_v2_5',
    voiceTemperature: envNumber('RETELL_DEFAULT_VOICE_TEMPERATURE', 0.55, 0, 2),
    fallbackVoiceIds: envCsv('RETELL_DEFAULT_FALLBACK_VOICE_IDS', [DEFAULT_STANDARD_VOICE_ID]),
  };
}

function defaultStandardRuntime(): VoiceRuntimeConfig {
  return {
    voiceModel: (process.env.RETELL_DEFAULT_STANDARD_VOICE_MODEL as RetellVoiceModel | undefined) ?? 'sonic-3-latest',
    voiceTemperature: envNumber('RETELL_DEFAULT_STANDARD_VOICE_TEMPERATURE', 0.55, 0, 2),
    fallbackVoiceIds: envCsv('RETELL_DEFAULT_STANDARD_FALLBACK_VOICE_IDS', [DEFAULT_VOICE_ID]),
  };
}

function defaultRuntimeForVoice(voiceId: string): VoiceRuntimeConfig | null {
  if (voiceId === DEFAULT_VOICE_ID || NATIVE_GERMAN_ELEVENLABS_VOICE_IDS.has(voiceId)) {
    return defaultHqRuntime();
  }
  if (voiceId === DEFAULT_STANDARD_VOICE_ID) {
    return defaultStandardRuntime();
  }
  return null;
}

function applyVoiceRuntime(
  body: Record<string, unknown>,
  voiceId: string,
  config: VoiceRuntimeConfig,
): void {
  const defaults = defaultRuntimeForVoice(voiceId);
  const voiceModel = config.voiceModel !== undefined ? config.voiceModel : defaults?.voiceModel;
  const voiceTemperature = config.voiceTemperature !== undefined ? config.voiceTemperature : defaults?.voiceTemperature;
  const fallbackVoiceIds = config.fallbackVoiceIds !== undefined ? config.fallbackVoiceIds : defaults?.fallbackVoiceIds;

  if (voiceModel !== undefined) body.voice_model = voiceModel;
  if (voiceTemperature !== undefined) body.voice_temperature = voiceTemperature;
  if (fallbackVoiceIds !== undefined) body.fallback_voice_ids = fallbackVoiceIds;
}

export async function createAgent(config: {
  name: string;
  llmId: string;
  voiceId?: string;
  language?: string;
  voiceSpeed?: number;
  voiceModel?: RetellVoiceModel | null;
  voiceTemperature?: number;
  fallbackVoiceIds?: string[] | null;
  responsiveness?: number;
  denoisingMode?: RetellDenoisingMode;
  maxCallDurationMs?: number;
  interruptionSensitivity?: number;
  enableDynamicResponsiveness?: boolean;
  reminderTriggerMs?: number;
  reminderMaxCount?: number;
  enableBackchannel?: boolean;
  allowUserDtmf?: boolean;
  webhookUrl?: string;
  postCallAnalysisData?: PostCallAnalysisField[];
  dataStorageSetting?: RetellDataStorageSetting;
  dataStorageRetentionDays?: number;
}): Promise<RetellAgent> {
  const voiceId = config.voiceId ?? DEFAULT_VOICE_ID;
  const body: Record<string, unknown> = {
    agent_name: config.name,
    response_engine: { type: 'retell-llm', llm_id: config.llmId },
    voice_id: voiceId,
    language: config.language ?? 'de-DE',
    voice_speed: config.voiceSpeed,
    responsiveness: config.responsiveness,
    denoising_mode: config.denoisingMode,
    interruption_sensitivity: config.interruptionSensitivity ?? defaultInterruption(),
    enable_backchannel: config.enableBackchannel ?? defaultBackchannel(),
    allow_user_dtmf: config.allowUserDtmf,
    // Default stays snappy for existing agents; specific demos can opt into
    // slower listening without changing global runtime behavior.
    enable_dynamic_responsiveness: config.enableDynamicResponsiveness ?? false,
    max_call_duration_ms: config.maxCallDurationMs,
    reminder_trigger_ms: config.reminderTriggerMs ?? defaultReminderTriggerMs(),
    reminder_max_count: config.reminderMaxCount ?? defaultReminderMaxCount(),
    end_call_after_silence_ms: defaultEndCallSilenceMs(),
  };
  applyVoiceRuntime(body, voiceId, config);
  // webhook_url is per-agent — without it, Retell never sends call_ended
  // (which means no billing reconcile, no transcript store, no DELETE on
  // consent-declined calls). Agent-level is correct because web calls
  // inherit it; phone-number-level webhooks only apply to PSTN.
  if (config.webhookUrl) body.webhook_url = config.webhookUrl;
  if (config.postCallAnalysisData !== undefined) {
    body.post_call_analysis_data = config.postCallAnalysisData;
  }
  if (config.dataStorageSetting !== undefined) {
    body.data_storage_setting = config.dataStorageSetting;
  }
  if (config.dataStorageRetentionDays !== undefined) {
    body.data_storage_retention_days = config.dataStorageRetentionDays;
  }
  return retellRequest('/create-agent', { method: 'POST', body: JSON.stringify(body) });
}

function customLlmAgentBody(config: CustomLlmAgentConfig): Record<string, unknown> {
  const voiceId = config.voiceId ?? DEFAULT_VOICE_ID;
  const body: Record<string, unknown> = {
    agent_name: config.name,
    response_engine: {
      type: 'custom-llm',
      llm_websocket_url: config.llmWebsocketUrl,
    },
    voice_id: voiceId,
    language: config.language ?? 'de-DE',
    voice_speed: config.voiceSpeed,
    responsiveness: config.responsiveness,
    denoising_mode: config.denoisingMode,
    interruption_sensitivity: config.interruptionSensitivity ?? defaultInterruption(),
    enable_backchannel: config.enableBackchannel ?? defaultBackchannel(),
    allow_user_dtmf: config.allowUserDtmf,
    enable_dynamic_responsiveness: config.enableDynamicResponsiveness ?? false,
    max_call_duration_ms: config.maxCallDurationMs,
    reminder_trigger_ms: config.reminderTriggerMs ?? defaultReminderTriggerMs(),
    reminder_max_count: config.reminderMaxCount ?? defaultReminderMaxCount(),
    end_call_after_silence_ms: defaultEndCallSilenceMs(),
  };
  applyVoiceRuntime(body, voiceId, config);
  if (config.webhookUrl) body.webhook_url = config.webhookUrl;
  if (config.postCallAnalysisData !== undefined) body.post_call_analysis_data = config.postCallAnalysisData;
  if (config.dataStorageSetting !== undefined) body.data_storage_setting = config.dataStorageSetting;
  if (config.dataStorageRetentionDays !== undefined) body.data_storage_retention_days = config.dataStorageRetentionDays;
  return body;
}

export async function createCustomLlmAgent(config: CustomLlmAgentConfig): Promise<RetellAgent> {
  return retellRequest('/create-agent', {
    method: 'POST',
    body: JSON.stringify(customLlmAgentBody(config)),
  });
}

export async function updateCustomLlmAgent(agentId: string, config: CustomLlmAgentConfig): Promise<RetellAgent> {
  return retellRequest(`/update-agent/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(customLlmAgentBody(config)),
  });
}

export async function updateAgent(
  agentId: string,
  config: {
    name?: string;
    voiceId?: string;
    language?: string;
    llmId?: string;
    voiceSpeed?: number;
    voiceModel?: RetellVoiceModel | null;
    voiceTemperature?: number;
    fallbackVoiceIds?: string[] | null;
    responsiveness?: number;
    denoisingMode?: RetellDenoisingMode;
    maxCallDurationMs?: number;
    interruptionSensitivity?: number;
    enableDynamicResponsiveness?: boolean;
    reminderTriggerMs?: number;
    reminderMaxCount?: number;
    enableBackchannel?: boolean;
    allowUserDtmf?: boolean;
    webhookUrl?: string;
    postCallAnalysisData?: PostCallAnalysisField[];
    dataStorageSetting?: RetellDataStorageSetting;
    dataStorageRetentionDays?: number;
  },
): Promise<RetellAgent> {
  // RET-08: only set tuning params when the caller explicitly provides them.
  // Previously both were ALWAYS sent (defaulting from env or 1.0/true), so a
  // name-only update silently reset any per-agent tuning the user had
  // configured in the Retell dashboard. Now we only override when asked.
  const body: Record<string, unknown> = {
    enable_dynamic_responsiveness: config.enableDynamicResponsiveness ?? false,
    reminder_trigger_ms: config.reminderTriggerMs ?? defaultReminderTriggerMs(),
    reminder_max_count: config.reminderMaxCount ?? defaultReminderMaxCount(),
    end_call_after_silence_ms: defaultEndCallSilenceMs(),
  };
  if (config.interruptionSensitivity !== undefined) body.interruption_sensitivity = config.interruptionSensitivity;
  if (config.enableBackchannel !== undefined) body.enable_backchannel = config.enableBackchannel;
  if (config.voiceSpeed !== undefined) body.voice_speed = config.voiceSpeed;
  if (config.responsiveness !== undefined) body.responsiveness = config.responsiveness;
  if (config.denoisingMode !== undefined) body.denoising_mode = config.denoisingMode;
  if (config.maxCallDurationMs !== undefined) body.max_call_duration_ms = config.maxCallDurationMs;
  if (config.allowUserDtmf !== undefined) body.allow_user_dtmf = config.allowUserDtmf;
  if (config.name !== undefined) body.agent_name = config.name;
  if (config.voiceId !== undefined) body.voice_id = config.voiceId;
  if (config.language !== undefined) body.language = config.language;
  if (config.llmId !== undefined) body.response_engine = { type: 'retell-llm', llm_id: config.llmId };
  if (config.voiceId !== undefined) applyVoiceRuntime(body, config.voiceId, config);
  if (config.webhookUrl !== undefined) body.webhook_url = config.webhookUrl;
  if (config.postCallAnalysisData !== undefined) body.post_call_analysis_data = config.postCallAnalysisData;
  if (config.dataStorageSetting !== undefined) body.data_storage_setting = config.dataStorageSetting;
  if (config.dataStorageRetentionDays !== undefined) body.data_storage_retention_days = config.dataStorageRetentionDays;

  return retellRequest(`/update-agent/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// --- Call History ---

/** Retell exposes measured latencies per call in milliseconds on top-level
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

export async function deleteAgent(agentId: string): Promise<void> {
  const res = await fetch(`${RETELL_API}/delete-agent/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getApiKey()}` },
    signal: AbortSignal.timeout(RETELL_TIMEOUT_MS),
  });
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    throw new Error(`Retell delete-agent ${res.status}: ${await res.text()}`);
  }
}

export async function deleteLLM(llmId: string): Promise<void> {
  const res = await fetch(`${RETELL_API}/delete-retell-llm/${encodeURIComponent(llmId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getApiKey()}` },
    signal: AbortSignal.timeout(RETELL_TIMEOUT_MS),
  });
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    throw new Error(`Retell delete-retell-llm ${res.status}: ${await res.text()}`);
  }
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
  config: { outboundAgentId?: string | null; inboundAgentId?: string | null },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (config.outboundAgentId !== undefined) {
    body.outbound_agents = config.outboundAgentId
      ? [{ agent_id: config.outboundAgentId, agent_version: 0, weight: 1 }]
      : null;
  }
  if (config.inboundAgentId !== undefined) {
    body.inbound_agents = config.inboundAgentId
      ? [{ agent_id: config.inboundAgentId, agent_version: 0, weight: 1 }]
      : null;
  }

  const res = await fetch(`${RETELL_API}/update-phone-number/${encodeURIComponent(phoneNumber)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(RETELL_TIMEOUT_MS),
  });
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`Retell API ${res.status}: ${await res.text()}`);
}

// --- Web Call (for test console) ---

export type WebCallResponse = {
  call_id: string;
  web_call_link: string;
  access_token: string;
};

export async function createWebCall(
  agentId: string,
  opts?: { dynamicVariables?: Record<string, string>; metadata?: Record<string, string> },
): Promise<WebCallResponse> {
  const body: Record<string, unknown> = { agent_id: agentId };
  // Inject per-call temporal awareness + any caller-supplied vars. Without
  // this, the LLM has no idea what "today" or "tomorrow" maps to and either
  // hallucinates or refuses to book — known Retell-community pattern.
  body.retell_llm_dynamic_variables = {
    ...buildCurrentDateDynamicVariables(),
    ...(opts?.dynamicVariables ?? {}),
  };
  if (opts?.metadata) body.metadata = opts.metadata;
  return retellRequest('/v2/create-web-call', {
    method: 'POST',
    body: JSON.stringify(body),
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
  dynamicVariables?: Record<string, string>;
}): Promise<RegisterCallResponse> {
  const dynamicVariables = {
    ...buildCurrentDateDynamicVariables(),
    ...(config.dynamicVariables ?? {}),
  };
  return retellRequest('/v2/register-call', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: config.agentId,
      audio_websocket_protocol: 'twilio',
      audio_encoding: 'mulaw_8000',
      sample_rate: 8000,
      from_number: config.fromNumber,
      to_number: config.toNumber,
      retell_llm_dynamic_variables: dynamicVariables,
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
 *
 * Retell v2 uses the phone number's configured outbound_agent_id by default.
 * To force a specific one-off agent for callbacks/tests, the API expects
 * override_agent_id, not agent_id.
 */
export async function createPhoneCall(config: {
  agentId: string;
  toNumber: string;
  fromNumber: string;
  metadata?: Record<string, string>;
  dynamicVariables?: Record<string, string>;
}): Promise<PhoneCallResponse> {
  const dynamicVariables = {
    ...buildCurrentDateDynamicVariables(),
    ...(config.dynamicVariables ?? {}),
  };
  return retellRequest('/v2/create-phone-call', {
    method: 'POST',
    body: JSON.stringify({
      override_agent_id: config.agentId,
      to_number: config.toNumber,
      from_number: config.fromNumber,
      metadata: config.metadata,
      retell_llm_dynamic_variables: dynamicVariables,
    }),
  });
}
