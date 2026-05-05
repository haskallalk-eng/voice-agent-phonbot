import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { JwtPayload } from './auth.js';
import { pool } from './db.js';
import { buildAgentInstructions } from './agent-instructions.js';
import { tryReserveMinutes, DEFAULT_CALL_RESERVE_MINUTES } from './usage.js';
import { invalidateOrgIdCache } from './org-id-cache.js';
import {
  createLLM,
  updateLLM,
  createAgent as retellCreateAgent,
  updateAgent as retellUpdateAgent,
  createWebCall,
  listCalls,
  getCall,
  getAgent as retellGetAgent,
  getLLM as retellGetLlm,
  DEFAULT_VOICE_ID,
  type RetellTool,
  type PostCallAnalysisField,
} from './retell.js';
import { triggerBridgeCall } from './twilio-openai-bridge.js';
import { loadPlatformBaseline } from './platform-baseline.js';
import { loadOutboundBaseline } from './outbound-baseline.js';
import { deriveTechnicalRuntimeSettings, toE164 } from '@vas/shared';
import { log } from './logger.js';
import { normalizeKnowledgeSources, storeKnowledgePdf, syncRetellKnowledgeBase } from './knowledge.js';
import {
  buildIntegrationTools,
  mergeAndEncryptIntegrations,
  maskApiIntegrationsForClient,
  type ApiIntegration,
} from './api-integrations.js';
import { syncOpeningHoursToChipy } from './opening-hours-sync.js';
import { PLANS, type PlanId } from './billing.js';
import { invalidateInboundWebhooksCache } from './inbound-webhooks.js';
import { isVoiceAllowedForOrg } from './voice-ownership.js';
import {
  customerModuleActiveForAgentConfig,
  customerModuleStatus,
  getActiveCustomerQuestions,
  getCustomCustomerQuestions,
  normalizeCustomerModuleConfig,
} from './customers.js';

const CustomerQuestionConfigSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(180),
  prompt: z.string().max(240).optional(),
  enabled: z.boolean().optional(),
  required: z.boolean().optional(),
  builtin: z.boolean().optional(),
  detailsKey: z.string().max(80).optional(),
  condition: z.string().max(180).optional(),
}).passthrough();

const AgentConfigSchema = z.object({
  tenantId: z.string().min(1).default('demo'),
  name: z.string().min(1).default('Demo Agent'),
  // Language code — validated shape only. Full list (ElevenLabs Multilingual
  // v2 coverage, ~30 locales) lives in apps/web/src/ui/agent-builder/shared +
  // apps/api/src/voice-catalog. Kept as `z.string` so adding a new language
  // doesn't require a schema bump.
  language: z.string().min(2).max(5).default('de'),
  voice: z.string().min(1).default(DEFAULT_VOICE_ID),
  businessName: z.string().min(1).default('Demo Business'),
  businessDescription: z.string().min(1).default('Local service business for appointments, FAQs, and callbacks.'),
  address: z.string().optional().default(''),
  openingHours: z.string().optional().default(''),
  servicesText: z.string().optional().default(''),
  // Structured services catalog — each row surfaces in the LLM prompt with
  // price + duration so the agent can quote cleanly. Legacy `servicesText`
  // stays as a fallback for configs that haven't migrated yet.
  services: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(120),
    price: z.string().max(20).optional(),
    priceFrom: z.boolean().optional(),
    priceUpTo: z.string().max(20).optional(),
    duration: z.string().max(30).optional(),
    description: z.string().max(400).optional(),
    tag: z.enum(['BELIEBT', 'NEU', 'AKTION']).nullable().optional(),
  })).optional().default([]),
  systemPrompt: z.string().min(1).default(
    'You are a helpful German/English voice agent for a small local business. Goal: book appointments, answer FAQs, and request missing details. Keep answers short, spoken, and polite. If information is missing, ask a single concrete question.',
  ),
  // Multi-select roles — ids match PROMPT_TEMPLATES on the web side
  // (reception / support / emergency / info). systemPrompt is re-assembled
  // client-side whenever this array changes; backward-compatible as an
  // optional passthrough so old configs without the field keep working.
  selectedRoles: z.array(z.string().min(1)).optional().default([]),
  // Freeform additions the customer types below the assembled role prompt.
  // Preserved across role toggles so manual house-rules never get wiped.
  customPromptAddition: z.string().optional().default(''),
  // Optional per-role block overrides. Keyed by role id (see PROMPT_TEMPLATES
  // on web). If a role is selected and the customer edited its block, the
  // override text wins in the assembled systemPrompt. Survives de-/re-select
  // so toggling a role back on restores the customer's version.
  roleBlockOverrides: z.record(z.string(), z.string()).optional().default({}),
  // Editable section blocks (PROMPT_SECTIONS) — saved per section id so a
  // toggle-off + toggle-on preserves the customer's edited text.
  sectionTextOverrides: z.record(z.string(), z.string()).optional().default({}),
  tools: z.array(z.string().min(1)).default(['calendar.findSlots', 'calendar.book', 'ticket.create']),
  fallback: z.object({
    enabled: z.boolean().default(true),
    reason: z.string().min(1).default('handoff'),
  }).default({ enabled: true, reason: 'handoff' }),

  // Industry cluster-key for cross-org pattern-pool (template-learning.ts).
  // Set when the customer applies a curated template (id of the template) or
  // hand-picked later. Without it (or templateId-fallback through
  // CURATED_INDUSTRY_KEYS) the org's calls never enter the cross-org learning
  // pipeline — `processTemplateLearning` early-returns when both fields are
  // null. Round-12 (Pattern-Pool fix): keeping this `optional()` so existing
  // configs without the field don't get force-materialized to a random
  // industry, just like recordCalls in Round 11.
  industry: z.string().optional(),

  // Recording-Toggle (PrivacyTab → "Anrufe aufzeichnen"). When true:
  //   • disclosure prompt-block in agent-instructions.ts mentions recording,
  //   • Retell agent uses data_storage_setting='everything' (default),
  //   • recording.declined-tool is registered.
  // When false:
  //   • disclosure prompt-block keeps the EU-AI-Act KI-Hinweis but DROPS
  //     the recording-line (no false promise to the caller),
  //   • Retell agent uses data_storage_setting='basic_attributes_only' so
  //     transcripts/audio are not stored on Retell's side either,
  //   • recording.declined-tool is omitted (would be misleading).
  //
  // Codex Round-11 review HIGH: NOT `default(true)` because that would
  // materialise the field on every parseAgentConfig() round-trip — existing
  // customer-configs without an explicit toggle would silently flip to
  // `recordCalls: true` in the DB on the next save, even though the user
  // never touched the toggle. Optional + treat `undefined` as legacy-on at
  // every consumer site (`!== false` checks instead of `=== true`).
  recordCalls: z.boolean().optional(),
  customerModule: z.object({
    enabled: z.boolean().optional(),
    allowBookingWithoutApproval: z.boolean().optional(),
    questions: z.array(CustomerQuestionConfigSchema).max(24).optional(),
    // Server-only flag. The API sets this for info@mindrails.de so the module
    // can be tested outside a hairdresser-tagged agent without exposing it as
    // a client-controlled permission bit.
    mindrailsInternal: z.boolean().optional(),
  }).optional(),

  // Retell AI references (set after first deploy)
  retellAgentId: z.string().optional(),
  retellLlmId: z.string().optional(),

  // Callback agent (separate Retell LLM+Agent used for outbound callbacks)
  retellCallbackAgentId: z.string().optional(),
  retellCallbackLlmId: z.string().optional(),
}).passthrough(); // Allow extra fields (knowledgeSources, speakingSpeed, calendarIntegrations, etc.) to pass through

type AgentConfig = z.infer<typeof AgentConfigSchema>;

const CORE_AGENT_TOOLS = ['calendar.findSlots', 'calendar.book', 'ticket.create'] as const;
const KNOWLEDGE_PDF_MAX_BYTES = 50 * 1024 * 1024;

function withCoreAgentTools(tools: string[] | undefined): string[] {
  return [...new Set([...CORE_AGENT_TOOLS, ...(tools ?? [])])];
}

function parseAgentConfig(input: unknown): AgentConfig {
  const config = AgentConfigSchema.parse(input);
  return { ...config, tools: withCoreAgentTools(config.tools) };
}

const memory = new Map<string, AgentConfig>();

export async function readConfig(tenantId: string, orgId: string): Promise<AgentConfig> {
  if (!pool) {
    return memory.get(tenantId) ?? parseAgentConfig({ tenantId });
  }

  // Multi-tenant filter is mandatory: a caller who only knows the tenantId
  // (e.g. an attacker who scraped one out of a Sentry payload) must not be
  // able to read another org's config (prompt, retellAgentId, business
  // details, knowledge sources). The OR-on-tenant_id branch survives the
  // legacy single-agent-per-org case where tenant_id was set to the orgId
  // string before org_id became its own column.
  const res = await pool.query(
    'select data from agent_configs where tenant_id = $1 and (org_id = $2 or tenant_id = $2::text)',
    [tenantId, orgId],
  );
  if (!res.rows.length) return parseAgentConfig({ tenantId });
  return parseAgentConfig(res.rows[0].data);
}

/**
 * Returns the agent_configs row for (tenantId, orgId) or null when the caller
 * doesn't own it. Centralises the ownership check for PUT/deploy/web-call paths.
 */
async function loadOwnedConfigRow(
  tenantId: string,
  orgId: string,
): Promise<{ data: AgentConfig; exists: true } | { data: null; exists: false }> {
  if (!pool) return { data: null, exists: false };
  const res = await pool.query(
    'SELECT data FROM agent_configs WHERE tenant_id = $1 AND (org_id = $2 OR (org_id IS NULL AND tenant_id = $2::text))',
    [tenantId, orgId],
  );
  if (!res.rowCount) return { data: null, exists: false };
  return { data: parseAgentConfig(res.rows[0].data), exists: true };
}

/**
 * Returns true if the tenantId is unclaimed (no row yet) or already owned by orgId.
 * Prevents hostile tenantId-takeover via PUT before the real owner created a row.
 */
async function tenantIdAvailableOrOwned(tenantId: string, orgId: string): Promise<boolean> {
  if (!pool) return true;
  const res = await pool.query(
    'SELECT org_id FROM agent_configs WHERE tenant_id = $1',
    [tenantId],
  );
  if (!res.rowCount) return true;                // unclaimed
  return res.rows[0].org_id === orgId;           // already mine
}

/**
 * Replace the masked-sentinel authValue round-trips from the client with
 * the existing encrypted values in the DB, and encrypt any freshly-provided
 * plaintext. Plaintext never reaches agent_configs.data — the config stored
 * in the DB only ever has `enc:v1:…` prefixed values or null.
 */
async function applyIntegrationEncryption(
  normalized: AgentConfig,
  orgId?: string,
): Promise<AgentConfig> {
  const incoming = (normalized as Record<string, unknown>).apiIntegrations as
    | ApiIntegration[] | undefined;
  if (!incoming?.length) return normalized;

  let existing: ApiIntegration[] | undefined;
  if (pool) {
    const row = await pool.query(
      'SELECT data FROM agent_configs WHERE tenant_id = $1' +
      (orgId ? ' AND (org_id = $2 OR org_id IS NULL)' : ''),
      orgId ? [normalized.tenantId, orgId] : [normalized.tenantId],
    ).catch(() => null);
    existing = (row?.rows[0]?.data?.apiIntegrations as ApiIntegration[] | undefined) ?? undefined;
  }

  const merged = mergeAndEncryptIntegrations(incoming, existing);
  return { ...normalized, apiIntegrations: merged } as AgentConfig;
}

/**
 * Transform the stored config into the client-facing view: encrypted
 * authValues are replaced with a masked sentinel + last-4-chars hint so
 * the UI can show `••••xyz9` without ever leaking the key to the browser.
 * Every HTTP response that returns AgentConfig must funnel through this.
 */
function toClientConfig(config: AgentConfig): AgentConfig {
  let out = config;
  const customerModule = (config as Record<string, unknown>).customerModule as
    | { enabled?: boolean; mindrailsInternal?: boolean; allowBookingWithoutApproval?: boolean; questions?: unknown[] }
    | undefined;
  if (customerModule?.mindrailsInternal !== undefined) {
    const { mindrailsInternal: _mindrailsInternal, ...clientCustomerModule } = customerModule;
    out = { ...config, customerModule: clientCustomerModule } as AgentConfig;
  }
  const integrations = (config as Record<string, unknown>).apiIntegrations as
    | ApiIntegration[] | undefined;
  if (!integrations?.length) return out;
  const masked = maskApiIntegrationsForClient(integrations);
  return { ...out, apiIntegrations: masked } as AgentConfig;
}

async function applyCustomerModuleServerFlags(raw: Record<string, unknown>, orgId: string, userId: string): Promise<Record<string, unknown>> {
  const incoming = raw.customerModule;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return raw;
  const requested = incoming as Record<string, unknown>;
  const status = await customerModuleStatus(orgId, userId);
  const requestedForHairdresser = raw.industry === 'hairdresser';
  if (requested.enabled === true && !status.available && !requestedForHairdresser) {
    const err = new Error('CUSTOMER_MODULE_UNAVAILABLE') as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }
  const normalized = normalizeCustomerModuleConfig({
    enabled: requested.enabled !== false,
    allowBookingWithoutApproval: requested.allowBookingWithoutApproval !== false,
    questions: Array.isArray(requested.questions) ? requested.questions as never : undefined,
    mindrailsInternal: status.reason === 'mindrails',
  });
  return {
    ...raw,
    customerModule: normalized,
  };
}

/**
 * Enforce the plan's agentsLimit when a write would create a new agent_configs
 * row for this org. Looked up from PLANS in billing.ts (single source of truth).
 * Throws AGENTS_LIMIT_REACHED (HTTP 403) when the org is at its cap.
 *
 * Closes the bypass where PUT /agent-config or POST /agent-config/knowledge/pdf
 * could create a brand-new tenant_id past the plan limit, evading the explicit
 * /agent-config/new check.
 */
async function enforcePlanAgentLimitOnCreate(orgId: string, tenantId: string): Promise<void> {
  if (!pool) return;
  const owned = await pool.query(
    'SELECT 1 FROM agent_configs WHERE tenant_id = $1 AND org_id = $2',
    [tenantId, orgId],
  );
  if (owned.rowCount) return; // existing row → it's an UPDATE, no limit applies
  const orgRow = await pool.query('SELECT plan FROM orgs WHERE id = $1', [orgId]);
  const plan = (orgRow.rows[0]?.plan as string) ?? 'free';
  const limit = PLANS[plan as PlanId]?.agentsLimit ?? PLANS.free.agentsLimit;
  const countRes = await pool.query(
    'SELECT COUNT(*)::int AS c FROM agent_configs WHERE org_id = $1',
    [orgId],
  );
  const count = (countRes.rows[0]?.c as number) ?? 0;
  if (count >= limit) {
    const err = new Error('AGENTS_LIMIT_REACHED') as Error & { statusCode?: number; details?: unknown };
    err.statusCode = 403;
    err.details = { limit, current: count, plan };
    throw err;
  }
}

async function enforceVoiceAllowedForOrg(orgId: string, config: AgentConfig): Promise<void> {
  if (await isVoiceAllowedForOrg(orgId, config.voice)) return;
  const err = new Error('VOICE_NOT_ALLOWED') as Error & { statusCode?: number };
  err.statusCode = 403;
  throw err;
}

async function writeConfig(config: AgentConfig, orgId?: string, actorUserId?: string): Promise<AgentConfig> {
  const parsed = parseAgentConfig(config);
  if (orgId) await enforceVoiceAllowedForOrg(orgId, parsed);
  const withIntegrations = await applyIntegrationEncryption(parsed, orgId);
  const normalized = await normalizeKnowledgeSources(withIntegrations as unknown as Record<string, unknown>) as AgentConfig;
  if (!pool) {
    memory.set(normalized.tenantId, normalized);
    return normalized;
  }

  // Plan-limit guard: if this write would create a new row for the org,
  // enforce agentsLimit. Skipped for the orgId-less legacy path (memory only).
  if (orgId) await enforcePlanAgentLimitOnCreate(orgId, normalized.tenantId);

  // Privacy-Audit-Trail (DSGVO Art. 5 Abs. 2 Rechenschaftspflicht): when the
  // recordCalls toggle changes, log structured so Sentry/Pino retains a
  // forensic record of who flipped recording on or off and when. Read the
  // previous value from the DB row before the upsert so we capture the
  // delta — `undefined → undefined` and unchanged values stay quiet.
  let previousRecordCalls: boolean | undefined;
  try {
    const prev = await pool.query<{ data: { recordCalls?: boolean } | null }>(
      `SELECT data FROM agent_configs WHERE tenant_id = $1 LIMIT 1`,
      [normalized.tenantId],
    );
    previousRecordCalls = prev.rows[0]?.data?.recordCalls;
  } catch { /* non-fatal; audit is best-effort */ }

  // Defence-in-depth: even though the HTTP handlers gate by tenantIdAvailableOrOwned,
  // a future caller that forgets the gate must NOT be able to overwrite another org's
  // config. The DO UPDATE WHERE clause makes the conflict path a no-op when the row
  // is owned by a different org. RETURNING tenant_id lets us detect the no-op —
  // the table's primary key is tenant_id (there is no `id` column).
  const res = await pool.query(
    `INSERT INTO agent_configs (tenant_id, org_id, data, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (tenant_id) DO UPDATE
       SET data = EXCLUDED.data,
           org_id = COALESCE(EXCLUDED.org_id, agent_configs.org_id),
           updated_at = now()
       WHERE agent_configs.org_id IS NULL
          OR agent_configs.org_id = EXCLUDED.org_id
     RETURNING tenant_id`,
    [normalized.tenantId, orgId ?? null, normalized],
  );
  if (!res.rowCount) {
    const err = new Error('TENANT_OWNED_BY_OTHER_ORG') as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  // Audit-Round-11 (Codex review): DSGVO Art. 5 Abs. 2 / Art. 24
  // Rechenschaftspflicht. Treat undefined as legacy-on so a flip
  // undefined → false is logged as on→off. Persists to privacy_setting_changes
  // (365d retention) — Sentry-breadcrumb-only ist nicht ausreichend für
  // belastbare Nachweisbarkeit bei Behördenprüfungen.
  const wasOn = previousRecordCalls !== false;
  const isOn = normalized.recordCalls !== false;
  if (wasOn !== isOn) {
    const changeKind = wasOn ? 'recording_disabled' : 'recording_enabled';
    log.info(
      {
        orgId: orgId ?? null,
        tenantId: normalized.tenantId,
        recordCallsBefore: previousRecordCalls ?? '(legacy-undefined-true)',
        recordCallsAfter: normalized.recordCalls ?? '(undefined-true)',
        change: changeKind,
      },
      'privacy: recordCalls toggle changed',
    );
    // Persistent audit row (best-effort: never block the save). Insert-fail
    // gets logged but doesn't reverse the actual config change.
    // Audit-Round-14 (Codex Plan-Review M1): changed_by is now the actor's
    // userId when the call comes from a request-handler (PUT/POST). Falls
    // back to orgId for callers that don't have a user-context (e.g. internal
    // back-office writes from triggerCallback's auto-provisioning path) so
    // the audit row never goes NULL — but the userId path is the one that
    // answers "who flipped the toggle?" under behördlicher Prüfung.
    pool.query(
      `INSERT INTO privacy_setting_changes (org_id, tenant_id, setting, value_before, value_after, changed_by)
       VALUES ($1, $2, 'recordCalls', $3, $4, $5)`,
      [
        orgId ?? null,
        normalized.tenantId,
        previousRecordCalls === undefined ? null : String(previousRecordCalls),
        normalized.recordCalls === undefined ? null : String(normalized.recordCalls),
        actorUserId ?? orgId ?? null,
      ],
    ).catch((err: Error) => log.warn({ err: err.message, tenantId: normalized.tenantId }, 'privacy: audit-insert failed'));
  }

  // Keep chipy_schedules in sync with what the customer just edited in the
  // Agent Builder. Loop-breaker + empty-string handling live in the helper.
  // Fire-and-forget: the openingHours string is already persisted on
  // agent_configs, so a chipy-schedules write failure doesn't need to roll
  // the user's save back — but we log loudly so drift is visible (CLAUDE.md §13).
  syncOpeningHoursToChipy(orgId, normalized.openingHours).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, orgId }, 'opening-hours-sync to chipy_schedules failed');
  });

  // Audit-Round-8: invalidate the inbound-webhooks cache so the next
  // fireInboundWebhooks call re-reads the fresh config (otherwise edits
  // wouldn't take effect for up to 60s — the TTL fallback).
  invalidateInboundWebhooksCache(normalized.tenantId);

  return normalized;
}

/**
 * Deterministic name for a transfer_call tool given a target number.
 * Must stay identical on both sides: agent-config.ts registers the tool
 * with this name; agent-instructions.ts references it by this name in
 * the system prompt so the LLM knows which tool to invoke.
 */
export function transferToolName(target: string): string {
  return 'transfer_' + target.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
}

/** Map our tool names to Retell custom function definitions. */
function buildRetellTools(config: AgentConfig, webhookBaseUrl: string): RetellTool[] {
  const tools: RetellTool[] = [];
  const enabled = new Set(withCoreAgentTools(config.tools));
  const signedQuery = buildToolAuthQuery(config.tenantId);

  // Retell's built-in end_call tool — must be explicitly registered
  // (not auto-available). Lets the LLM hang up cleanly, which is
  // mandatory when the caller declines recording (§ 201 StGB).
  tools.push({
    type: 'end_call',
    name: 'end_call',
    description: 'End the call. Use when the conversation is naturally over or the caller declined recording.',
  });

  // Custom tool: caller refused recording. Webhook flags the call for
  // post-call deletion of the audio + transcript. The LLM must still
  // call end_call immediately after this to actually hang up.
  // Only registered when recording is actually active — otherwise the tool
  // is irreführend (would-be-no-op since nothing is recorded). PrivacyTab's
  // `recordCalls` toggle drives this.
  if (config.recordCalls !== false) {
    tools.push({
      type: 'custom',
      name: 'recording_declined',
      description: 'Call this BEFORE end_call when the caller refuses consent to recording. Deletes the call transcript and audio after the call ends.',
      url: `${webhookBaseUrl}/retell/tools/recording.declined?${signedQuery}`,
      execution_message_description: 'Markiere für Löschung.',
      parameters: { type: 'object', properties: {} },
    });
  }

  if (customerModuleActiveForAgentConfig(config)) {
    const activeCustomerQuestions = getActiveCustomerQuestions(config.customerModule);
    const activeCustomerQuestionIds = new Set(activeCustomerQuestions.map((q) => q.id));
    const customCustomerQuestions = getCustomCustomerQuestions(config.customerModule);
    const upsertProperties: Record<string, unknown> = {
      customerName: { type: 'string' },
      customerPhone: { type: 'string', description: 'Caller phone number. Optional when Retell provides from_number.' },
      email: { type: 'string' },
      customerType: { type: 'string', enum: ['pending'], description: 'Always pending for bot-created customers; the salon confirms existing customers later in Phonbot.' },
      notes: { type: 'string' },
    };
    if (activeCustomerQuestionIds.has('service')) upsertProperties.service = { type: 'string', description: 'Requested salon service.' };
    if (activeCustomerQuestionIds.has('preferredTime')) upsertProperties.preferredTime = { type: 'string', description: 'Requested or confirmed appointment time.' };
    if (activeCustomerQuestionIds.has('preferredStylist')) upsertProperties.preferredStylist = { type: 'string', description: 'Requested staff member/stylist.' };
    if (activeCustomerQuestionIds.has('hairLength')) upsertProperties.hairLength = { type: 'string', description: 'kurz, schulterlang, lang, or caller wording.' };
    if (activeCustomerQuestionIds.has('hairHistory')) upsertProperties.hairHistory = { type: 'string', description: 'Recent color, bleaching, smoothing, perm or other chemical treatment.' };
    if (activeCustomerQuestionIds.has('allergies')) upsertProperties.allergies = { type: 'string', description: 'Allergies, intolerances, sensitive scalp, only if relevant.' };
    if (customCustomerQuestions.length) {
      upsertProperties.customFields = {
        type: 'object',
        description: `Answers to these tenant-specific salon questions: ${customCustomerQuestions.map((q) => q.label).join('; ')}`,
        additionalProperties: { type: 'string' },
      };
    }

    tools.push({
      type: 'custom',
      name: 'customer_lookup',
      description: 'Silent customer lookup for hairdresser agents. Use at the beginning of an inbound call with the caller phone number, and later with a spelled name if phone did not match. Do not mention the lookup to the caller.',
      url: `${webhookBaseUrl}/retell/tools/customer.lookup?${signedQuery}`,
      parameters: {
        type: 'object',
        properties: {
          customerPhone: { type: 'string', description: 'Caller phone number. Prefer Retell from_number when available.' },
          customerName: { type: 'string', description: 'Full customer name, especially when the caller claims to be an existing customer but the number did not match.' },
        },
      },
    });
    tools.push({
      type: 'custom',
      name: 'customer_upsert',
      description: 'Silently create or update a hairdresser customer after collecting minimal booking details. Do not tell the caller that a database tool is running.',
      url: `${webhookBaseUrl}/retell/tools/customer.upsert?${signedQuery}`,
      parameters: {
        type: 'object',
        required: ['customerName'],
        properties: upsertProperties,
      },
    });
  }

  if (enabled.has('calendar.findSlots')) {
    tools.push({
      type: 'custom',
      name: 'calendar_find_slots',
      description: 'Find available appointment slots. Present at most three options to the caller, grouped by day.',
      url: `${webhookBaseUrl}/retell/tools/calendar.findSlots?${signedQuery}`,
      execution_message_description: 'Searching for available slots…',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Requested service, if known.' },
          range: { type: 'string', description: 'Requested date range, e.g. next week.' },
          preferredTime: { type: 'string', description: 'Preferred time or day from the customer.' },
          preferredStylist: { type: 'string', description: 'Requested staff member/stylist name. Use "beliebig" when the caller has no staff preference.' },
        },
      },
    });
  }

  if (enabled.has('calendar.book')) {
    tools.push({
      type: 'custom',
      name: 'calendar_book',
      description: 'Create a booking after the user confirmed a slot and service. Mention SMS confirmation only when the result returns smsSent=true.',
      url: `${webhookBaseUrl}/retell/tools/calendar.book?${signedQuery}`,
      execution_message_description: 'Booking your appointment…',
      parameters: {
        type: 'object',
        required: ['preferredTime', 'service'],
        properties: {
          customerName: { type: 'string' },
          customerPhone: { type: 'string', description: 'Caller phone number. Optional when Retell provides from_number.' },
          preferredTime: { type: 'string', description: 'Confirmed slot/time.' },
          service: { type: 'string', description: 'Booked service.' },
          preferredStylist: { type: 'string', description: 'Requested staff member/stylist name. Use "beliebig" when the caller has no staff preference.' },
          notes: { type: 'string' },
        },
      },
    });
  }

  if (enabled.has('ticket.create')) {
    tools.push({
      type: 'custom',
      name: 'ticket_create',
      description: 'Create a callback or handoff ticket when the user wants human follow-up. Mention SMS only when the result returns smsSent=true.',
      url: `${webhookBaseUrl}/retell/tools/ticket.create?${signedQuery}`,
      execution_message_description: 'Creating your callback request…',
      parameters: {
        type: 'object',
        properties: {
          customerName: { type: 'string' },
          customerPhone: { type: 'string', description: 'Callback phone number. Optional when Retell provides from_number.' },
          preferredTime: { type: 'string' },
          service: { type: 'string' },
          notes: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    });
  }

  // ── Built-in Retell transfer_call tool ──────────────────────────────────
  // When callRoutingRules contain at least one enabled 'transfer' rule,
  // register Retell's native transfer_call so the LLM can hand off the
  // live call to a human. The actual routing logic lives in the system
  // prompt (see agent-instructions.ts).
  //
  // Every target is run through toE164() first — Retell/Twilio require a
  // proper E.164 number (`+4917676679632`), not a German local-dial
  // string (`017676679632`). Before this normalisation the live transfer
  // silently failed at dial time and the LLM would just hang because the
  // tool call never resolved. Rules that don't normalise (unrecognised
  // format) are skipped with a log warning so the deploy still works for
  // the remaining valid rules.
  const routingRules = (config as Record<string, unknown>).callRoutingRules as
    | Array<{ action: string; target?: string; enabled?: boolean; description?: string }> | undefined;
  const transferRules = (routingRules ?? []).filter(
    (r) => r.enabled !== false && r.action === 'transfer' && r.target,
  );

  if (transferRules.length > 0) {
    const seenTargets = new Set<string>();
    for (const rule of transferRules) {
      const e164 = toE164(rule.target!);
      if (!e164) {
        log.warn(
          { tenantId: config.tenantId, rawTarget: rule.target },
          'agent-config: transfer rule has unparseable target, skipping',
        );
        continue;
      }
      if (seenTargets.has(e164)) continue;
      seenTargets.add(e164);

      const safeName = transferToolName(e164);
      tools.push({
        type: 'transfer_call',
        name: safeName,
        description: `Transfer call to ${e164}. ${rule.description ?? ''}`.trim(),
        transfer_destination: {
          type: 'predefined',
          number: e164,
        },
        transfer_option: {
          type: 'warm_transfer',
          show_transferee_as_caller: true,
        },
        speak_during_execution: true,
        execution_message_description: 'Ich verbinde Sie jetzt weiter. Einen Moment bitte.',
      });
    }
  }

  // Phase 3: customer-configured API integrations (webhook/zapier/rest).
  // Each enabled integration produces one or more custom tools routed
  // through our /retell/tools/external.call proxy. The proxy loads the
  // integration by id, decrypts the authValue, and fires the outbound
  // request with SSRF + rate + timeout guards. See api-integrations.ts
  // for the full security model.
  const apiIntegrations = (config as Record<string, unknown>).apiIntegrations as
    | ApiIntegration[] | undefined;
  const integrationTools = buildIntegrationTools(
    apiIntegrations,
    webhookBaseUrl,
    signedQuery,
    config.tenantId,
    // Reserve core + transfer tool names so a customer integration can't
    // shadow them. buildIntegrationTools will append `_2` etc. on collision.
    tools.map((t) => t.name).filter((n): n is string => typeof n === 'string'),
  );
  for (const t of integrationTools) tools.push(t);

  return tools;
}

function toolAuthSecret(): string {
  const secret = process.env.RETELL_TOOL_AUTH_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('RETELL_TOOL_AUTH_SECRET (or JWT_SECRET) required in production — refusing to sign tool URLs with a well-known fallback');
    }
    return 'dev-retell-tool-auth';
  }
  return secret;
}

function signToolTenant(tenantId: string): string {
  return crypto.createHmac('sha256', toolAuthSecret()).update(tenantId).digest('base64url');
}

function buildToolAuthQuery(tenantId: string): string {
  const params = new URLSearchParams({
    tenant_id: tenantId,
    tool_sig: signToolTenant(tenantId),
  });
  return params.toString();
}

function getWebhookBaseUrl(): string {
  const raw = process.env.WEBHOOK_BASE_URL;
  if (raw) return raw.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('WEBHOOK_BASE_URL is required in production');
  }
  return 'https://your-server.example.com';
}

/**
 * Deploy config to Retell AI (create or update LLM + Agent).
 * Returns the updated config with Retell IDs.
 */
/**
 * Build Retell's `post_call_analysis_data` schema from the customer's
 * extractedVariables config. Retell natively supports only string / enum /
 * system-presets — we map every non-string type to string and encode the
 * expected shape in the description, so the LLM returns `"2026-04-23"` as
 * a string and downstream code can parse or pass through as-is.
 *
 * A catch-all `sonstige_relevante_infos` string field is appended so the
 * LLM has a place to put context the customer didn't think of up front
 * (Modell C / Hybrid). If the customer defined zero variables we still
 * send the catch-all so Retell always runs the analysis pass — keeps the
 * `call.ended` webhook payload consistent.
 */
function buildPostCallAnalysisData(config: AgentConfig): PostCallAnalysisField[] {
  const vars = (config as Record<string, unknown>).extractedVariables as
    | Array<{ name?: string; description?: string; type?: string; required?: boolean }>
    | undefined;

  const fields: PostCallAnalysisField[] = [];
  for (const v of vars ?? []) {
    const name = (v.name ?? '').trim();
    if (!name) continue;
    const hint =
      v.type === 'number' ? ' (als Zahl, z.B. "42" oder "12.5")'
        : v.type === 'boolean' ? ' (als "true" oder "false")'
        : v.type === 'date' ? ' (als ISO-Datum, z.B. "2026-04-23")'
        : '';
    fields.push({
      type: 'string',
      name,
      description: `${v.description ?? ''}${hint}`.trim() || name,
      required: v.required ?? false,
    });
  }

  fields.push({
    type: 'string',
    name: 'sonstige_relevante_infos',
    description:
      'Alles andere was der Anrufer erwähnte und relevant sein könnte — z.B. Stimmung, Dringlichkeit, Besonderheiten. Nur ausfüllen wenn wirklich erwähnenswert.',
    required: false,
  });

  return fields;
}

export async function deployToRetell(config: AgentConfig, orgId?: string): Promise<AgentConfig> {
  if (orgId) await enforceVoiceAllowedForOrg(orgId, config);
  const preparedConfig = await syncRetellKnowledgeBase(config as unknown as Record<string, unknown>, orgId) as AgentConfig;
  const webhookBase = getWebhookBaseUrl();
  // Platform-Baseline-Prefix: admin-edited quality floor (spelling alphabet,
  // end-call rules, promise-discipline) that applies to every Phonbot agent —
  // even customers who configured nothing. Falls back to PLATFORM_BASELINE_PROMPT
  // when no admin override exists. Customer's own systemPrompt + roles + custom
  // additions then layer on top.
  const platformBaseline = await loadPlatformBaseline();
  const customerPrompt = buildAgentInstructions(preparedConfig);
  const instructions = `${platformBaseline}\n\n${customerPrompt}`;
  const retellTools = buildRetellTools(preparedConfig, webhookBase);
  const postCallAnalysisData = buildPostCallAnalysisData(preparedConfig);
  const technical = deriveTechnicalRuntimeSettings(preparedConfig as Parameters<typeof deriveTechnicalRuntimeSettings>[0]);
  const knowledgeBaseId = (preparedConfig as Record<string, unknown>).retellKnowledgeBaseId as string | undefined;
  const knowledgeBaseIds = knowledgeBaseId ? [knowledgeBaseId] : [];
  const model = process.env.RETELL_LLM_MODEL ?? 'gpt-4o-mini';
  const LANG_MAP: Record<string, string> = {
    de: 'de-DE', en: 'en-US', fr: 'fr-FR', es: 'es-ES',
    it: 'it-IT', tr: 'tr-TR', pl: 'pl-PL', nl: 'nl-NL',
    pt: 'pt-PT', ru: 'ru-RU', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN',
    ar: 'ar-SA', hi: 'hi-IN', sv: 'sv-SE', da: 'da-DK', fi: 'fi-FI',
    no: 'nb-NO', cs: 'cs-CZ', sk: 'sk-SK', hu: 'hu-HU', ro: 'ro-RO',
    el: 'el-GR', bg: 'bg-BG', hr: 'hr-HR', uk: 'uk-UA', id: 'id-ID',
    ms: 'ms-MY', vi: 'vi-VN',
  };
  const language = LANG_MAP[preparedConfig.language] ?? 'de-DE';

  // PrivacyTab `recordCalls` toggle → Retell data_storage_setting:
  //   true (or legacy undefined) → 'everything' (transcripts + recordings + logs).
  //   false                       → 'basic_attributes_only' (no transcripts, no
  //                                  audio, no logs persisted on Retell's side).
  // Paired with the conditional disclosure-block in agent-instructions.ts so
  // the prompt promise (or absence thereof) actually matches what Retell does.
  const dataStorageSetting: 'everything' | 'basic_attributes_only' =
    preparedConfig.recordCalls === false ? 'basic_attributes_only' : 'everything';

  let llmId = preparedConfig.retellLlmId;
  let agentId = preparedConfig.retellAgentId;

  const webhookUrl = `${webhookBase}/retell/webhook`;
  if (llmId && agentId) {
    // Both exist → parallelize the two Retell API round-trips (each ~5s).
    // LLM update doesn't depend on agent-update and vice versa — the
    // agent already references this llmId.
    await Promise.all([
      updateLLM(llmId, {
        generalPrompt: instructions,
        tools: retellTools,
        model,
        modelTemperature: technical.modelTemperature,
        knowledgeBaseIds,
      }),
      retellUpdateAgent(agentId, {
        name: preparedConfig.name,
        voiceId: preparedConfig.voice,
        language,
        llmId,
        voiceSpeed: technical.voiceSpeed,
        responsiveness: technical.responsiveness,
        maxCallDurationMs: technical.maxCallDurationMs,
        interruptionSensitivity: technical.interruptionSensitivity,
        enableBackchannel: technical.enableBackchannel,
        allowUserDtmf: technical.allowUserDtmf,
        webhookUrl,
        postCallAnalysisData,
        dataStorageSetting,
      }),
    ]);
  } else if (llmId && !agentId) {
    // LLM exists but no agent → update LLM, then create agent (agent needs llmId).
    await updateLLM(llmId, {
      generalPrompt: instructions,
      tools: retellTools,
      model,
      modelTemperature: technical.modelTemperature,
      knowledgeBaseIds,
    });
    const agent = await retellCreateAgent({
      name: preparedConfig.name,
      llmId,
      voiceId: preparedConfig.voice,
      language,
      voiceSpeed: technical.voiceSpeed,
      responsiveness: technical.responsiveness,
      maxCallDurationMs: technical.maxCallDurationMs,
      interruptionSensitivity: technical.interruptionSensitivity,
      enableBackchannel: technical.enableBackchannel,
      allowUserDtmf: technical.allowUserDtmf,
      webhookUrl,
      postCallAnalysisData,
      dataStorageSetting,
    });
    agentId = agent.agent_id;
  } else {
    // Fresh deploy: create LLM first (agent needs llmId), then create agent.
    const llm = await createLLM({
      generalPrompt: instructions,
      tools: retellTools,
      model,
      modelTemperature: technical.modelTemperature,
      knowledgeBaseIds,
    });
    llmId = llm.llm_id;
    const agent = await retellCreateAgent({
      name: preparedConfig.name,
      llmId,
      voiceId: preparedConfig.voice,
      language,
      voiceSpeed: technical.voiceSpeed,
      responsiveness: technical.responsiveness,
      maxCallDurationMs: technical.maxCallDurationMs,
      interruptionSensitivity: technical.interruptionSensitivity,
      enableBackchannel: technical.enableBackchannel,
      allowUserDtmf: technical.allowUserDtmf,
      webhookUrl,
      postCallAnalysisData,
      dataStorageSetting,
    });
    agentId = agent.agent_id;
  }

  return { ...preparedConfig, retellLlmId: llmId, retellAgentId: agentId };
}

/**
 * Callback LLM prompt. Uses Retell dynamic variables:
 * {{customer_name}}, {{callback_reason}}, {{callback_service}}, {{agent_name}}, {{business_name}}
 */
function buildCallbackPrompt(): string {
  return [
    'Du bist {{agent_name}}, der KI-Telefonassistent von {{business_name}}.',
    'Du führst gerade einen AUSGEHENDEN Rückruf durch — du rufst den Kunden zurück, nicht umgekehrt.',
    '',
    'Kundenname: {{customer_name}}',
    'Anliegen: {{callback_reason}}',
    'Service: {{callback_service}}',
    '',
    'Beginne das Gespräch mit: "Hallo {{customer_name}}, hier ist {{agent_name}} von {{business_name}}. Ich rufe Sie zurück bezüglich: {{callback_reason}}. Kann ich Ihnen jetzt helfen?"',
    'Halte Antworten kurz und klar. Stelle nur eine Frage auf einmal.',
    'Wenn du einen Termin buchen kannst, tue es direkt. Wenn nicht, erstelle ein neues Ticket.',
    'Beende das Gespräch freundlich wenn alles geklärt ist.',
  ].join('\n');
}

/**
 * Ensure a callback Retell LLM + Agent exists for this config.
 * Creates them on first call, then caches the IDs in agent_configs.
 * Returns the (possibly updated) config.
 */
async function ensureCallbackAgent(config: AgentConfig, orgId?: string): Promise<AgentConfig> {
  const model = process.env.RETELL_LLM_MODEL ?? 'gpt-4o-mini';
  const LANG_MAP: Record<string, string> = {
    de: 'de-DE', en: 'en-US', fr: 'fr-FR', es: 'es-ES',
    it: 'it-IT', tr: 'tr-TR', pl: 'pl-PL', nl: 'nl-NL',
    pt: 'pt-PT', ru: 'ru-RU', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN',
    ar: 'ar-SA', hi: 'hi-IN', sv: 'sv-SE', da: 'da-DK', fi: 'fi-FI',
    no: 'nb-NO', cs: 'cs-CZ', sk: 'sk-SK', hu: 'hu-HU', ro: 'ro-RO',
    el: 'el-GR', bg: 'bg-BG', hr: 'hr-HR', uk: 'uk-UA', id: 'id-ID',
    ms: 'ms-MY', vi: 'vi-VN',
  };
  const language = LANG_MAP[config.language] ?? 'de-DE';
  let callbackLlmId = config.retellCallbackLlmId;
  let callbackAgentId = config.retellCallbackAgentId;

  if (!callbackLlmId) {
    // Outbound flow (we call THE CUSTOMER'S customer back): prepend the
    // outbound baseline (DSGVO Art. 21 widerspruchsrecht, KI-Identifikation,
    // kein Hard-Close, höflicher Auftakt). Inbound platform baseline would be
    // wrong here — outbound has fundamentally different rules.
    const outboundBaseline = await loadOutboundBaseline();
    const llm = await createLLM({
      generalPrompt: `${outboundBaseline}\n\n${buildCallbackPrompt()}`,
      tools: [],
      model,
    });
    callbackLlmId = llm.llm_id;
  } else {
    // Audit-Round-9 H4: refresh existing callback LLM with the current outbound
    // baseline. Without this branch, admin edits to the outbound baseline
    // (DSGVO Art. 21 wording, KI-Identifikation phrasing, …) never propagate
    // to existing customers — the LLM stays frozen at whatever baseline was
    // active at first deploy. updateLLM is idempotent on Retell's side, so
    // re-running with identical text is a no-op. Failure is non-fatal: we
    // log and continue, the customer's previous prompt remains active.
    const outboundBaseline = await loadOutboundBaseline();
    await updateLLM(callbackLlmId, {
      generalPrompt: `${outboundBaseline}\n\n${buildCallbackPrompt()}`,
    }).catch((err: Error) => {
      log.warn({ err: err.message, orgId, callbackLlmId }, 'callback LLM baseline-refresh failed (non-fatal)');
    });
  }

  if (!callbackAgentId) {
    // Callback agent inherits the org's recordCalls setting — outbound callbacks
    // are bound by the same § 201 StGB / Art. 6 DSGVO recording-consent rules
    // as inbound calls. Same toggle, same Retell side-effect.
    const callbackDataStorage: 'everything' | 'basic_attributes_only' =
      config.recordCalls === false ? 'basic_attributes_only' : 'everything';
    const agent = await retellCreateAgent({
      name: `${config.name} (Callback)`,
      llmId: callbackLlmId,
      voiceId: config.voice,
      language,
      dataStorageSetting: callbackDataStorage,
    });
    callbackAgentId = agent.agent_id;
  }

  if (callbackLlmId !== config.retellCallbackLlmId || callbackAgentId !== config.retellCallbackAgentId) {
    const updated = { ...config, retellCallbackLlmId: callbackLlmId, retellCallbackAgentId: callbackAgentId };
    await writeConfig(updated, orgId);
    return updated;
  }

  return config;
}

/**
 * Trigger an outbound callback call for a ticket.
 * Looks up the org's provisioned phone number and callback agent,
 * then initiates the call via Retell.
 */
export async function triggerCallback(params: {
  orgId: string;
  customerPhone: string;
  customerName?: string | null;
  reason?: string | null;
  service?: string | null;
}): Promise<{ ok: boolean; callId?: string; error?: string }> {
  // Customer-outbound feature flag. Phonbot ist INBOUND-only; Kunden-Rückrufe sind
  // aktuell nicht als Produkt-Feature freigegeben. Einziger legitimer Outbound-Pfad
  // ist der Sales-Callback vom Landingpage-Demo-Formular (siehe demo.ts → getOrCreateSalesAgent),
  // der nicht über triggerCallback läuft. Zum Reaktivieren: CUSTOMER_OUTBOUND_ENABLED=true.
  if (process.env.CUSTOMER_OUTBOUND_ENABLED !== 'true') {
    return { ok: false, error: 'FEATURE_DISABLED' };
  }

  try {
    // Get the org's first deployed config
    let config: AgentConfig | null = null;
    if (pool) {
      const res = await pool.query(
        `SELECT data FROM agent_configs WHERE org_id = $1 OR tenant_id = $1::text ORDER BY updated_at DESC LIMIT 1`,
        [params.orgId],
      );
      if (res.rows[0]) config = parseAgentConfig(res.rows[0].data);
    } else {
      config = memory.get(params.orgId) ?? null;
    }

    if (!config) return { ok: false, error: 'NO_CONFIG' };

    // Get the org's outbound phone number
    let fromNumber: string | null = null;
    if (pool) {
      const phoneRes = await pool.query(
        `SELECT number FROM phone_numbers WHERE org_id = $1 AND method = 'provisioned' ORDER BY created_at LIMIT 1`,
        [params.orgId],
      );
      fromNumber = phoneRes.rows[0]?.number ?? null;
    }

    if (!fromNumber) {
      fromNumber = process.env.RETELL_OUTBOUND_NUMBER ?? null;
    }

    if (!fromNumber) return { ok: false, error: 'NO_OUTBOUND_NUMBER' };

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    const webhookBase = process.env.WEBHOOK_BASE_URL ?? (
      process.env.NODE_ENV === 'production'
        ? (() => { throw new Error('WEBHOOK_BASE_URL is required in production'); })()
        : 'http://localhost:3001'
    );

    if (!twilioSid || !twilioToken) return { ok: false, error: 'TWILIO_NOT_CONFIGURED' };

    const customerName = params.customerName ?? 'Kunde';
    const reason = params.reason ?? 'Rückruf';
    const prompt = `Du bist ${config.name}, ein KI-Telefonassistent von ${config.businessName}. Du rufst ${customerName} zurück.

Grund des Rückrufs: ${reason}${params.service ? `\nService/Bereich: ${params.service}` : ''}

DEIN ZIEL: Beantworte den Anruf professionell, kläre das Anliegen von ${customerName} und helfe weiter.

REGELN:
- Begrüße ${customerName} freundlich: "Guten Tag ${customerName}, hier ist ${config.name} von ${config.businessName}. Ich melde mich wegen Ihrer Anfrage zu ${reason}."
- Sprich natürlich Deutsch, professionell und hilfsbereit
- Maximal 2-3 kurze Sätze pro Antwort
- Kläre das Anliegen vollständig bevor du das Gespräch beendest`;

    const result = await triggerBridgeCall({
      toNumber: params.customerPhone,
      fromNumber,
      prompt,
      name: customerName,
      webhookBase,
      twilioSid,
      twilioToken,
    });

    if (!result.ok) return { ok: false, error: result.error ?? 'CALL_FAILED' };
    return { ok: true, callId: result.twilioCallSid ?? result.sessionId };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'UNKNOWN';
    return { ok: false, error: msg };
  }
}

export async function registerAgentConfig(app: FastifyInstance) {
  if (!app.hasPlugin('@fastify/multipart')) {
    await app.register(multipart, { limits: { fileSize: KNOWLEDGE_PDF_MAX_BYTES } });
  }

  const auth = { onRequest: [app.authenticate] };

  // List all agent configs for org
  app.get('/agent-configs', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) {
      const cfg = memory.get(orgId);
      return { items: cfg ? [toClientConfig(cfg)] : [] };
    }
    const res = await pool.query(
      `SELECT tenant_id, data FROM agent_configs WHERE org_id = $1 OR tenant_id = $1::text ORDER BY updated_at DESC`,
      [orgId],
    );
    const items = res.rows.map((r) => toClientConfig(parseAgentConfig(r.data)));
    // Always include at least the default config
    if (items.length === 0) {
      return { items: [toClientConfig(parseAgentConfig({ tenantId: orgId }))] };
    }
    return { items };
  });

  // Create a new agent config (respects plan agentsLimit)
  app.post('/agent-config/new', { ...auth }, async (req: FastifyRequest, reply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    // Check plan agents limit (single source of truth: PLANS in billing.ts).
    const orgRow = await pool.query(`SELECT plan FROM orgs WHERE id = $1`, [orgId]);
    const plan = (orgRow.rows[0]?.plan as string) ?? 'free';
    const limit = PLANS[plan as PlanId]?.agentsLimit ?? PLANS.free.agentsLimit;

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM agent_configs WHERE org_id = $1`,
      [orgId],
    );
    const count = parseInt(String(countRes.rows[0]?.count ?? '0'), 10);

    if (count >= limit) {
      return reply.status(403).send({
        error: 'AGENTS_LIMIT_REACHED',
        message: `Dein Plan erlaubt maximal ${limit} Agent(s). Upgrade für mehr.`,
        limit,
        current: count,
      });
    }

    const newTenantId = `${orgId}-${Date.now()}`;
    const body = req.body as Record<string, unknown>;
    const cfg = parseAgentConfig({ ...body, tenantId: newTenantId });

    await pool.query(
      `INSERT INTO agent_configs (tenant_id, org_id, data, updated_at) VALUES ($1, $2, $3, now())`,
      [newTenantId, orgId, cfg],
    );

    // Audit-Round-8 (Codex Q2): /new bypasses writeConfig, so we must
    // invalidate the inbound-webhooks cache here too. Otherwise a fresh
    // agent's webhook config could miss a stale TTL window when readConfig
    // is called via fireInboundWebhooks before TTL expires.
    invalidateInboundWebhooksCache(newTenantId);

    return toClientConfig(cfg);
  });

  // Read config (default = first for org, or specific by ?tenantId=).
  // Ownership enforced via readConfig(tenantId, orgId) — returns an empty default
  // when the tenantId belongs to a different org (prevents config-leak by
  // iterating tenantIds).
  app.get('/agent-config', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const query = req.query as Record<string, string>;
    const tenantId = query.tenantId ?? orgId;
    return toClientConfig(await readConfig(tenantId, orgId));
  });

  app.get('/agent-config/webhooks-health', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const query = z.object({ tenantId: z.string().optional() }).parse(req.query);
    const tenantId = query.tenantId ?? orgId;
    if (!pool) return { items: [] };

    const owned = await loadOwnedConfigRow(tenantId, orgId);
    if (!owned.exists) return { items: [] };

    const res = await pool.query(
      `SELECT webhook_id, consecutive_failures, last_success_at, disabled_until
       FROM inbound_webhook_health
       WHERE tenant_id = $1
       ORDER BY webhook_id ASC`,
      [tenantId],
    );

    // Round-10 Claude-Review (Codex Uncertainty #3): filter out orphan health
    // rows whose webhook no longer exists in the current config. Without this,
    // a customer who deleted a webhook still sees its (stale) failure-count
    // in the dashboard banner — confusing and suggests fix-action where there
    // is none. The DB rows themselves are kept (cleanup-cron drops them at 90d)
    // for audit purposes, but the API surface stays honest about live state.
    const liveWebhookIds = new Set(
      ((owned.data as unknown as { inboundWebhooks?: { id: string }[] }).inboundWebhooks ?? [])
        .map((h) => h.id),
    );

    return {
      items: res.rows
        .filter((row: { webhook_id: string }) => liveWebhookIds.has(row.webhook_id))
        .map((row: {
          webhook_id: string;
          consecutive_failures: number;
          last_success_at: string | Date | null;
          disabled_until: string | Date | null;
        }) => ({
          webhook_id: row.webhook_id,
          consecutive_failures: row.consecutive_failures,
          last_success_at: row.last_success_at instanceof Date ? row.last_success_at.toISOString() : row.last_success_at,
          disabled_until: row.disabled_until instanceof Date ? row.disabled_until.toISOString() : row.disabled_until,
        })),
    };
  });

  app.post(
    '/agent-config/knowledge/pdf',
    {
      ...auth,
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!pool) return reply.status(503).send({ error: 'Database not configured' });

      const { orgId } = req.user as JwtPayload;
      let data: Awaited<ReturnType<typeof req.file>>;
      try {
        data = await req.file();
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.status(413).send({ error: 'PDF_TOO_LARGE' });
        }
        throw err;
      }
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });

      const fields = data.fields as Record<string, { value?: unknown } | undefined>;
      const rawTenantId = fields.tenantId?.value ?? fields.agentTenantId?.value;
      const tenantId = typeof rawTenantId === 'string' && rawTenantId.trim() ? rawTenantId.trim() : orgId;
      if (!(await tenantIdAvailableOrOwned(tenantId, orgId))) {
        return reply.status(403).send({ error: 'Not your agent' });
      }

      const filename = data.filename || 'wissen.pdf';
      const isPdf = data.mimetype === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
      if (!isPdf) return reply.status(400).send({ error: 'PDF_ONLY' });

      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of data.file) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > KNOWLEDGE_PDF_MAX_BYTES) {
          return reply.status(413).send({ error: 'PDF_TOO_LARGE' });
        }
        chunks.push(buf);
      }

      try {
        const source = await storeKnowledgePdf({
          orgId,
          tenantId,
          filename,
          mimeType: data.mimetype,
          data: Buffer.concat(chunks),
        });
        return reply.status(201).send(source);
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode ?? 400;
        const message = err instanceof Error ? err.message : 'PDF_UPLOAD_FAILED';
        return reply.status(statusCode).send({ error: message });
      }
    },
  );

  // Preview generated instructions
  app.get('/agent-config/preview', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const config = await readConfig(orgId, orgId);
    return {
      instructions: buildAgentInstructions(config),
      tools: config.tools,
      fallback: config.fallback,
    };
  });

  // Live agent stats — avg measured e2e latency across the last 20 calls,
  // pulled straight from Retell. Each request triggers a fresh listCalls
  // so the number in the builder header always reflects current reality.
  // Returns callsCount=0 when the agent hasn't been deployed or had no
  // calls yet; frontend shows "—" in that case instead of a fake estimate.
  // Rate-limit guards Retell-API budget: frontend polls every 15s per open
  // builder tab; cap at 60/min per IP keeps a single user-with-4-tabs from
  // burning Retell quota across the org.
  app.get('/agent-config/stats', {
    ...auth,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const query = req.query as Record<string, string>;
    const tenantId = query.tenantId ?? orgId;
    const owned = await loadOwnedConfigRow(tenantId, orgId);
    if (!owned.exists) return reply.status(404).send({ error: 'Agent not found' });
    const retellAgentId = owned.data.retellAgentId;
    const emptyBreakdown = { llm: null, tts: null, asr: null, e2e: null };
    const emptyResponse = {
      callsCount: 0,
      sampleSize: 0,
      latencyMs: null,
      latencySource: 'none' as const,
      breakdownMs: emptyBreakdown,
      turnsInCall: 0,
      lastCallAt: null,
      modelName: null as string | null,
      modelBaselineMs: null as number | null,
      measuredLlmMs: null as number | null,
      error: null as string | null,
    };
    if (!retellAgentId) return { ...emptyResponse, error: 'not_deployed' };

    try {
      // Retell's agent-builder UI shows a model-based latency estimate
      // that changes when the user switches LLM. It doesn't come from
      // /list-calls or /get-agent — it's a per-model baseline baked
      // into Retell's UI. We mirror the same lookup so Phonbot's chip
      // matches the user's Retell-builder view 1:1.
      const MODEL_LATENCY_MS: Record<string, number> = {
        'gpt-4o-mini': 500,
        'gpt-4o': 800,
        'gpt-4.1-mini': 500,
        'gpt-4.1': 800,
        'gpt-4.1-nano': 400,
        'claude-haiku-3.5': 400,
        'claude-3-haiku': 400,
        'claude-sonnet-3.5': 900,
        'claude-3.5-sonnet': 900,
        'claude-sonnet-4': 900,
      };

      // Pull agent + LLM in parallel with the call list so we know the
      // current model every refresh (the user can change it without a
      // redeploy through the builder).
      const [calls, agent] = await Promise.all([
        listCalls(retellAgentId, 20),
        (async () => {
          try {
            const a = await retellGetAgent(retellAgentId);
            return a;
          } catch { return null; }
        })(),
      ]);

      let modelName: string | null = null;
      let modelBaselineMs: number | null = null;
      const llmId = agent?.response_engine?.llm_id;
      if (llmId) {
        try {
          const llm = await retellGetLlm(llmId);
          modelName = typeof llm?.model === 'string' ? llm.model : null;
          if (modelName) {
            modelBaselineMs = MODEL_LATENCY_MS[modelName] ?? null;
          }
        } catch { /* keep null */ }
      }

      const pickNum = (v: unknown): number | null =>
        typeof v === 'number' && v > 0 ? Math.round(v) : null;

      const endedCalls = calls.filter((c) => c.call_status === 'ended');
      const latest = endedCalls[0];
      const l = latest?.latency;

      const llm = pickNum(l?.llm?.p50);
      const tts = pickNum(l?.tts?.p50);
      const asr = pickNum(l?.asr?.p50);
      const e2e = pickNum(l?.e2e?.p50);
      const turnsInCall = l?.e2e?.values?.length ?? 0;

      // Primary = model baseline (matches Retell's agent-builder UI).
      // Fall back to measured llm.p50 only when Retell's model map
      // doesn't know the LLM — at least the user sees *something* real.
      const primary = modelBaselineMs ?? llm;
      const source: 'model-baseline' | 'measured' | 'none' =
        modelBaselineMs != null ? 'model-baseline'
        : llm != null ? 'measured'
        : 'none';

      return {
        callsCount: endedCalls.length,
        sampleSize: primary != null ? 1 : 0,
        latencyMs: primary,
        latencySource: source === 'model-baseline' ? 'p50' : source === 'measured' ? 'values' : 'none',
        breakdownMs: { llm, tts, asr, e2e },
        turnsInCall,
        lastCallAt: latest?.end_timestamp ?? null,
        modelName,
        modelBaselineMs,
        measuredLlmMs: llm,
        error: null,
      };
    } catch (err) {
      app.log.warn({ err: err instanceof Error ? err.message : String(err), tenantId }, 'listCalls failed');
      return { ...emptyResponse, error: 'retell_unreachable' };
    }
  });

  // Save config (local only, no Retell deploy).
  // Ownership: tenantId must be unclaimed or already owned by caller.orgId.
  // Retell IDs are taken from the server-side row, NEVER from the request body —
  // otherwise an attacker could target a victim's retellLlmId via deploy.
  app.put('/agent-config', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId, userId } = req.user as JwtPayload;
    const raw = req.body as Record<string, unknown>;
    const tenantId = (typeof raw.tenantId === 'string' && raw.tenantId) ? raw.tenantId : orgId;

    if (!(await tenantIdAvailableOrOwned(tenantId, orgId))) {
      return reply.status(403).send({ error: 'Not your agent' });
    }

    let rawWithServerFlags: Record<string, unknown>;
    try {
      rawWithServerFlags = await applyCustomerModuleServerFlags(raw, orgId, userId);
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      if (e.statusCode === 403) return reply.status(403).send({ error: e.message });
      throw err;
    }

    const existing = await loadOwnedConfigRow(tenantId, orgId);
    const serverIds = existing.exists ? existing.data : {} as Partial<AgentConfig>;
    const body = parseAgentConfig({
      ...rawWithServerFlags,
      tenantId,
      retellLlmId: serverIds.retellLlmId,
      retellAgentId: serverIds.retellAgentId,
      retellCallbackLlmId: serverIds.retellCallbackLlmId,
      retellCallbackAgentId: serverIds.retellCallbackAgentId,
      retellKnowledgeBaseId: (serverIds as Record<string, unknown>).retellKnowledgeBaseId,
      knowledgeBaseSignature: (serverIds as Record<string, unknown>).knowledgeBaseSignature,
    });
    try {
      return toClientConfig(await writeConfig(body, orgId, userId));
    } catch (err) {
      const e = err as Error & { statusCode?: number; details?: { limit?: number; current?: number } };
      if (e.message === 'AGENTS_LIMIT_REACHED') {
        return reply.status(403).send({
          error: 'AGENTS_LIMIT_REACHED',
          message: `Dein Plan erlaubt maximal ${e.details?.limit ?? '?'} Agent(s). Upgrade für mehr.`,
          ...e.details,
        });
      }
      if (e.message === 'VOICE_NOT_ALLOWED') {
        return reply.status(403).send({
          error: 'VOICE_NOT_ALLOWED',
          message: 'Diese geklonte Stimme gehoert nicht zu deiner Organisation.',
        });
      }
      if (e.statusCode === 409) return reply.status(409).send({ error: e.message });
      throw err;
    }
  });

  // Deploy config to Retell AI (save + sync).
  // Same ownership gate + server-authoritative Retell IDs as PUT.
  app.post('/agent-config/deploy', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId, userId } = req.user as JwtPayload;
    const raw = req.body as Record<string, unknown>;
    const tenantId = (typeof raw.tenantId === 'string' && raw.tenantId) ? raw.tenantId : orgId;

    if (!(await tenantIdAvailableOrOwned(tenantId, orgId))) {
      return reply.status(403).send({ error: 'Not your agent' });
    }

    let rawWithServerFlags: Record<string, unknown>;
    try {
      rawWithServerFlags = await applyCustomerModuleServerFlags(raw, orgId, userId);
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      if (e.statusCode === 403) return reply.status(403).send({ error: e.message });
      throw err;
    }

    const existing = await loadOwnedConfigRow(tenantId, orgId);
    const serverIds = existing.exists ? existing.data : {} as Partial<AgentConfig>;
    const body = parseAgentConfig({
      ...rawWithServerFlags,
      tenantId,
      retellLlmId: serverIds.retellLlmId,
      retellAgentId: serverIds.retellAgentId,
      retellCallbackLlmId: serverIds.retellCallbackLlmId,
      retellCallbackAgentId: serverIds.retellCallbackAgentId,
      retellKnowledgeBaseId: (serverIds as Record<string, unknown>).retellKnowledgeBaseId,
      knowledgeBaseSignature: (serverIds as Record<string, unknown>).knowledgeBaseSignature,
    });
    let deployed: AgentConfig;
    try {
      deployed = await deployToRetell(body, orgId);
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      if (e.message === 'VOICE_NOT_ALLOWED') {
        return reply.status(403).send({
          error: 'VOICE_NOT_ALLOWED',
          message: 'Diese geklonte Stimme gehoert nicht zu deiner Organisation.',
        });
      }
      throw err;
    }
    let saved: AgentConfig;
    try {
      saved = await writeConfig(deployed, orgId, userId);
    } catch (err) {
      const e = err as Error & { statusCode?: number; details?: { limit?: number } };
      if (e.message === 'AGENTS_LIMIT_REACHED') {
        return reply.status(403).send({
          error: 'AGENTS_LIMIT_REACHED',
          message: `Dein Plan erlaubt maximal ${e.details?.limit ?? '?'} Agent(s). Upgrade für mehr.`,
          ...e.details,
        });
      }
      if (e.message === 'VOICE_NOT_ALLOWED') {
        return reply.status(403).send({
          error: 'VOICE_NOT_ALLOWED',
          message: 'Diese geklonte Stimme gehoert nicht zu deiner Organisation.',
        });
      }
      if (e.statusCode === 409) return reply.status(409).send({ error: e.message });
      throw err;
    }
    // Flush stale agentId→orgId mapping so retell-webhooks.ts picks up the
    // new agent on the next webhook call instead of serving from cache.
    if (saved.retellAgentId) invalidateOrgIdCache(saved.retellAgentId);
    if (saved.retellCallbackAgentId) invalidateOrgIdCache(saved.retellCallbackAgentId);
    return { ok: true, config: toClientConfig(saved), retellAgentId: saved.retellAgentId, retellLlmId: saved.retellLlmId };
  });

  // Delete an agent config
  app.delete('/agent-config/:tenantId', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId, userId } = req.user as JwtPayload;
    const { tenantId } = req.params as { tenantId: string };
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    // Verify the agent belongs to this org
    const check = await pool.query(
      `SELECT data, updated_at FROM agent_configs WHERE tenant_id = $1 AND org_id = $2`,
      [tenantId, orgId],
    );
    if (!check.rowCount) return reply.status(404).send({ error: 'Agent nicht gefunden' });

    // If agent is older than 30 days, require password confirmation
    const updated = check.rows[0].updated_at as string | null;
    const ageMs = updated ? Date.now() - new Date(updated).getTime() : 0;
    const needsPassword = ageMs > 30 * 24 * 60 * 60 * 1000;

    if (needsPassword) {
      const body = req.body as { password?: string } | null;
      if (!body?.password) return reply.status(400).send({ error: 'password_required', message: 'Bitte Passwort eingeben um diesen Agent zu löschen.' });

      // Verify password
      const userRow = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
      const hash = userRow.rows[0]?.password_hash;
      if (!hash) return reply.status(403).send({ error: 'Passwort konnte nicht verifiziert werden.' });

      const bcrypt = await import('bcrypt');
      const valid = await bcrypt.compare(body.password, hash as string);
      if (!valid) return reply.status(403).send({ error: 'Falsches Passwort.' });
    }

    // Delete from DB
    await pool.query(`DELETE FROM agent_configs WHERE tenant_id = $1 AND org_id = $2`, [tenantId, orgId]);

    // Unassign phone numbers that were connected to this agent's retell ID
    const retellAgentId = check.rows[0].data?.retellAgentId;
    if (retellAgentId) {
      await pool.query(`UPDATE phone_numbers SET agent_id = NULL WHERE agent_id = $1 AND org_id = $2`, [retellAgentId, orgId]);
    }

    return { ok: true };
  });

  // Create a web call for testing (requires deployed agent)
  app.post('/agent-config/web-call', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;

    // Atomically reserve DEFAULT_CALL_RESERVE_MINUTES (E7). Closes the race
    // where parallel pre-call checks could each pass and exceed the limit
    // post-deduct. Webhook reconciles to actual minutes at call_ended.
    const reserve = await tryReserveMinutes(orgId, DEFAULT_CALL_RESERVE_MINUTES);
    if (!reserve.allowed) {
      return {
        ok: false,
        error: 'USAGE_LIMIT_REACHED',
        minutesUsed: reserve.minutesUsed,
        minutesLimit: reserve.minutesLimit,
      };
    }

    // Use specific agent if tenantId provided, otherwise fall back to first deployed agent.
    // agentTenantId is user input — verify ownership before creating a web call,
    // otherwise an attacker could open live web-call sessions against any org's agent.
    const parsed = z.object({ agentTenantId: z.string().optional() }).safeParse(req.body);
    const tenantId = parsed.success ? parsed.data.agentTenantId : undefined;

    let config: AgentConfig;
    if (tenantId) {
      const owned = await loadOwnedConfigRow(tenantId, orgId);
      if (!owned.exists) return { ok: false, error: 'NOT_YOUR_AGENT' };
      config = owned.data;
    } else {
      if (!pool) return { ok: false, error: 'AGENT_NOT_DEPLOYED', message: 'Deploy the agent first.' };
      // Multi-agent orgs (Pro/Agency) MUST send agentTenantId — otherwise
      // "Test" against one agent could hit a sibling agent that someone else
      // just saved. We refuse the call rather than guess. Single-agent orgs
      // keep the fallback so existing flows don't break.
      const res = await pool.query(
        `SELECT data FROM agent_configs
         WHERE org_id = $1 AND data->>'retellAgentId' IS NOT NULL
         ORDER BY updated_at DESC
         LIMIT 2`,
        [orgId],
      );
      if (res.rows.length > 1) {
        return {
          ok: false,
          error: 'AGENT_TENANT_REQUIRED',
          message: 'Bitte einen konkreten Agent auswählen — diese Org hat mehrere.',
        };
      }
      config = res.rows[0]?.data ? parseAgentConfig(res.rows[0].data) : await readConfig(orgId, orgId);
    }

    if (!config.retellAgentId) {
      return { ok: false, error: 'AGENT_NOT_DEPLOYED', message: 'Deploy the agent first.' };
    }
    const call = await createWebCall(config.retellAgentId);
    return { ok: true, ...call };
  });

  // Call history from Retell — filtered to agents owned by the caller's org.
  // Passing agent_id: [] would return everything; we short-circuit instead when
  // the org has no deployed agents yet, and never call Retell without filter.
  app.get('/calls', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    if (!pool) return { items: [] };

    const cfgRes = await pool.query(
      `SELECT DISTINCT data->>'retellAgentId' AS a, data->>'retellCallbackAgentId' AS b
       FROM agent_configs WHERE org_id = $1`,
      [orgId],
    );
    const agentIds = cfgRes.rows
      .flatMap((r: { a: string | null; b: string | null }) => [r.a, r.b])
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (agentIds.length === 0) return { items: [] };

    const calls = await listCalls(agentIds, q.limit);
    return { items: calls };
  });

  app.get('/calls/:callId', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const params = z.object({ callId: z.string().min(1) }).parse(req.params);
    const call = await getCall(params.callId);
    if (!call) return reply.status(404).send({ error: 'Not found' });

    // Verify the call's agent belongs to the caller's org — prevents reading
    // any org's transcript + recording URL with just a guessed call_id.
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const agentId = (call as { agent_id?: string }).agent_id;
    if (!agentId) return reply.status(404).send({ error: 'Not found' });

    const owned = await pool.query(
      `SELECT 1 FROM agent_configs
       WHERE org_id = $1
         AND (data->>'retellAgentId' = $2 OR data->>'retellCallbackAgentId' = $2)
       LIMIT 1`,
      [orgId, agentId],
    );
    if (!owned.rowCount) return reply.status(404).send({ error: 'Not found' });
    return call;
  });
}
