import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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
  DEFAULT_VOICE_ID,
  type RetellTool,
} from './retell.js';
import { triggerBridgeCall } from './twilio-openai-bridge.js';

const AgentConfigSchema = z.object({
  tenantId: z.string().min(1).default('demo'),
  name: z.string().min(1).default('Demo Agent'),
  language: z.enum(['de', 'en', 'fr', 'es', 'it', 'tr', 'pl', 'nl']).default('de'),
  voice: z.string().min(1).default(DEFAULT_VOICE_ID),
  businessName: z.string().min(1).default('Demo Business'),
  businessDescription: z.string().min(1).default('Local service business for appointments, FAQs, and callbacks.'),
  address: z.string().optional().default(''),
  openingHours: z.string().optional().default(''),
  servicesText: z.string().optional().default(''),
  systemPrompt: z.string().min(1).default(
    'You are a helpful German/English voice agent for a small local business. Goal: book appointments, answer FAQs, and request missing details. Keep answers short, spoken, and polite. If information is missing, ask a single concrete question.',
  ),
  tools: z.array(z.string().min(1)).default(['calendar.findSlots', 'calendar.book', 'ticket.create']),
  fallback: z.object({
    enabled: z.boolean().default(true),
    reason: z.string().min(1).default('handoff'),
  }).default({ enabled: true, reason: 'handoff' }),

  // Retell AI references (set after first deploy)
  retellAgentId: z.string().optional(),
  retellLlmId: z.string().optional(),

  // Callback agent (separate Retell LLM+Agent used for outbound callbacks)
  retellCallbackAgentId: z.string().optional(),
  retellCallbackLlmId: z.string().optional(),
}).passthrough(); // Allow extra fields (knowledgeSources, speakingSpeed, calendarIntegrations, etc.) to pass through

type AgentConfig = z.infer<typeof AgentConfigSchema>;

const memory = new Map<string, AgentConfig>();

export async function readConfig(tenantId: string, orgId?: string): Promise<AgentConfig> {
  if (!pool) {
    return memory.get(tenantId) ?? AgentConfigSchema.parse({ tenantId });
  }

  // When an orgId is supplied, enforce ownership — otherwise a caller with knowledge
  // of another tenant's id could read that tenant's config (prompt, retellAgentId,
  // business details, knowledge sources).
  const sql = orgId
    ? 'select data from agent_configs where tenant_id = $1 and (org_id = $2 or tenant_id = $2::text)'
    : 'select data from agent_configs where tenant_id = $1';
  const params = orgId ? [tenantId, orgId] : [tenantId];
  const res = await pool.query(sql, params);
  if (!res.rows.length) return AgentConfigSchema.parse({ tenantId });
  return AgentConfigSchema.parse(res.rows[0].data);
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
  return { data: AgentConfigSchema.parse(res.rows[0].data), exists: true };
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

async function writeConfig(config: AgentConfig, orgId?: string): Promise<AgentConfig> {
  if (!pool) {
    memory.set(config.tenantId, config);
    return config;
  }

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
    [config.tenantId, orgId ?? null, config],
  );
  if (!res.rowCount) {
    const err = new Error('TENANT_OWNED_BY_OTHER_ORG') as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }
  return config;
}

/** Map our tool names to Retell custom function definitions. */
function buildRetellTools(config: AgentConfig, webhookBaseUrl: string): RetellTool[] {
  const tools: RetellTool[] = [];
  const enabled = new Set(config.tools);

  if (enabled.has('calendar.findSlots')) {
    tools.push({
      type: 'custom',
      name: 'calendar_find_slots',
      description: 'Find available appointment slots for the requested service or time range.',
      url: `${webhookBaseUrl}/retell/tools/calendar.findSlots`,
      execution_message_description: 'Searching for available slots…',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Requested service, if known.' },
          range: { type: 'string', description: 'Requested date range, e.g. next week.' },
          preferredTime: { type: 'string', description: 'Preferred time or day from the customer.' },
        },
      },
    });
  }

  if (enabled.has('calendar.book')) {
    tools.push({
      type: 'custom',
      name: 'calendar_book',
      description: 'Create a booking after the user confirmed a slot and service.',
      url: `${webhookBaseUrl}/retell/tools/calendar.book`,
      execution_message_description: 'Booking your appointment…',
      parameters: {
        type: 'object',
        required: ['preferredTime', 'service'],
        properties: {
          customerName: { type: 'string' },
          customerPhone: { type: 'string' },
          preferredTime: { type: 'string', description: 'Confirmed slot/time.' },
          service: { type: 'string', description: 'Booked service.' },
          notes: { type: 'string' },
        },
      },
    });
  }

  if (enabled.has('ticket.create')) {
    tools.push({
      type: 'custom',
      name: 'ticket_create',
      description: 'Create a callback or handoff ticket when the user wants human follow-up.',
      url: `${webhookBaseUrl}/retell/tools/ticket.create`,
      execution_message_description: 'Creating your callback request…',
      parameters: {
        type: 'object',
        required: ['customerPhone'],
        properties: {
          customerName: { type: 'string' },
          customerPhone: { type: 'string', description: 'Callback phone number.' },
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
  const routingRules = (config as Record<string, unknown>).callRoutingRules as
    | Array<{ action: string; target?: string; enabled?: boolean; description?: string }> | undefined;
  const hasTransfer = routingRules?.some(r => r.enabled !== false && r.action === 'transfer' && r.target);

  if (hasTransfer) {
    const transferRules = routingRules!
      .filter(r => r.enabled !== false && r.action === 'transfer' && r.target);

    // Register one transfer_call tool per unique target number.
    // Retell requires transfer_destination + transfer_option for each.
    const seenTargets = new Set<string>();
    for (const rule of transferRules) {
      const target = rule.target!;
      if (seenTargets.has(target)) continue;
      seenTargets.add(target);

      const safeName = 'transfer_' + target.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
      tools.push({
        type: 'transfer_call',
        name: safeName,
        description: `Transfer call to ${target}. ${rule.description ?? ''}`.trim(),
        transfer_destination: {
          type: 'predefined',
          number: target,
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

  return tools;
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
async function deployToRetell(config: AgentConfig): Promise<AgentConfig> {
  const webhookBase = getWebhookBaseUrl();
  const instructions = buildAgentInstructions(config);
  const retellTools = buildRetellTools(config, webhookBase);
  const model = process.env.RETELL_LLM_MODEL ?? 'gpt-4o-mini';
  const LANG_MAP: Record<string, string> = {
    de: 'de-DE', en: 'en-US', fr: 'fr-FR', es: 'es-ES',
    it: 'it-IT', tr: 'tr-TR', pl: 'pl-PL', nl: 'nl-NL',
  };
  const language = LANG_MAP[config.language] ?? 'de-DE';

  let llmId = config.retellLlmId;
  let agentId = config.retellAgentId;

  if (llmId && agentId) {
    // Both exist → parallelize the two Retell API round-trips (each ~5s).
    // LLM update doesn't depend on agent-update and vice versa — the
    // agent already references this llmId.
    await Promise.all([
      updateLLM(llmId, { generalPrompt: instructions, tools: retellTools, model }),
      retellUpdateAgent(agentId, { name: config.name, voiceId: config.voice, language, llmId }),
    ]);
  } else if (llmId && !agentId) {
    // LLM exists but no agent → update LLM, then create agent (agent needs llmId).
    await updateLLM(llmId, { generalPrompt: instructions, tools: retellTools, model });
    const agent = await retellCreateAgent({ name: config.name, llmId, voiceId: config.voice, language });
    agentId = agent.agent_id;
  } else {
    // Fresh deploy: create LLM first (agent needs llmId), then create agent.
    const llm = await createLLM({ generalPrompt: instructions, tools: retellTools, model });
    llmId = llm.llm_id;
    const agent = await retellCreateAgent({ name: config.name, llmId, voiceId: config.voice, language });
    agentId = agent.agent_id;
  }

  return { ...config, retellLlmId: llmId, retellAgentId: agentId };
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
  };
  const language = LANG_MAP[config.language] ?? 'de-DE';
  let callbackLlmId = config.retellCallbackLlmId;
  let callbackAgentId = config.retellCallbackAgentId;

  if (!callbackLlmId) {
    const llm = await createLLM({ generalPrompt: buildCallbackPrompt(), tools: [], model });
    callbackLlmId = llm.llm_id;
  }

  if (!callbackAgentId) {
    const agent = await retellCreateAgent({
      name: `${config.name} (Callback)`,
      llmId: callbackLlmId,
      voiceId: config.voice,
      language,
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
      if (res.rows[0]) config = AgentConfigSchema.parse(res.rows[0].data);
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
  const auth = { onRequest: [app.authenticate] };

  // List all agent configs for org
  app.get('/agent-configs', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) {
      const cfg = memory.get(orgId);
      return { items: cfg ? [cfg] : [] };
    }
    const res = await pool.query(
      `SELECT tenant_id, data FROM agent_configs WHERE org_id = $1 OR tenant_id = $1::text ORDER BY updated_at DESC`,
      [orgId],
    );
    const items = res.rows.map((r) => AgentConfigSchema.parse(r.data));
    // Always include at least the default config
    if (items.length === 0) {
      return { items: [AgentConfigSchema.parse({ tenantId: orgId })] };
    }
    return { items };
  });

  // Create a new agent config (respects plan agentsLimit)
  app.post('/agent-config/new', { ...auth }, async (req: FastifyRequest, reply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    // Check plan agents limit
    const orgRow = await pool.query(`SELECT plan FROM orgs WHERE id = $1`, [orgId]);
    const plan = (orgRow.rows[0]?.plan as string) ?? 'free';
    const LIMITS: Record<string, number> = { free: 1, starter: 1, pro: 3, agency: 10 };
    const limit = LIMITS[plan] ?? 1;

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
    const cfg = AgentConfigSchema.parse({ ...body, tenantId: newTenantId });

    await pool.query(
      `INSERT INTO agent_configs (tenant_id, org_id, data, updated_at) VALUES ($1, $2, $3, now())`,
      [newTenantId, orgId, cfg],
    );

    return cfg;
  });

  // Read config (default = first for org, or specific by ?tenantId=).
  // Ownership enforced via readConfig(tenantId, orgId) — returns an empty default
  // when the tenantId belongs to a different org (prevents config-leak by
  // iterating tenantIds).
  app.get('/agent-config', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const query = req.query as Record<string, string>;
    const tenantId = query.tenantId ?? orgId;
    return readConfig(tenantId, orgId);
  });

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
  app.get('/agent-config/stats', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
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
      error: null as string | null,
    };
    if (!retellAgentId) return { ...emptyResponse, error: 'not_deployed' };

    try {
      const calls = await listCalls(retellAgentId, 20);
      // Single source of truth: latency.e2e.p50 of the latest ended
      // call — the exact number Retell shows on its own dashboard.
      // Pure passthrough, no aggregation over calls, no combining
      // of components, no estimation. If the user opens Retell's
      // call detail, they see the same number.
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
      return {
        callsCount: endedCalls.length,
        sampleSize: e2e != null ? 1 : 0,
        latencyMs: e2e,
        latencySource: e2e != null ? ('p50' as const) : ('none' as const),
        breakdownMs: { llm, tts, asr, e2e },
        turnsInCall,
        lastCallAt: latest?.end_timestamp ?? null,
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
    const { orgId } = req.user as JwtPayload;
    const raw = req.body as Record<string, unknown>;
    const tenantId = (typeof raw.tenantId === 'string' && raw.tenantId) ? raw.tenantId : orgId;

    if (!(await tenantIdAvailableOrOwned(tenantId, orgId))) {
      return reply.status(403).send({ error: 'Not your agent' });
    }

    const existing = await loadOwnedConfigRow(tenantId, orgId);
    const serverIds = existing.exists ? existing.data : {} as Partial<AgentConfig>;
    const body = AgentConfigSchema.parse({
      ...raw,
      tenantId,
      retellLlmId: serverIds.retellLlmId,
      retellAgentId: serverIds.retellAgentId,
      retellCallbackLlmId: serverIds.retellCallbackLlmId,
      retellCallbackAgentId: serverIds.retellCallbackAgentId,
    });
    return writeConfig(body, orgId);
  });

  // Deploy config to Retell AI (save + sync).
  // Same ownership gate + server-authoritative Retell IDs as PUT.
  app.post('/agent-config/deploy', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const raw = req.body as Record<string, unknown>;
    const tenantId = (typeof raw.tenantId === 'string' && raw.tenantId) ? raw.tenantId : orgId;

    if (!(await tenantIdAvailableOrOwned(tenantId, orgId))) {
      return reply.status(403).send({ error: 'Not your agent' });
    }

    const existing = await loadOwnedConfigRow(tenantId, orgId);
    const serverIds = existing.exists ? existing.data : {} as Partial<AgentConfig>;
    const body = AgentConfigSchema.parse({
      ...raw,
      tenantId,
      retellLlmId: serverIds.retellLlmId,
      retellAgentId: serverIds.retellAgentId,
      retellCallbackLlmId: serverIds.retellCallbackLlmId,
      retellCallbackAgentId: serverIds.retellCallbackAgentId,
    });
    const deployed = await deployToRetell(body);
    const saved = await writeConfig(deployed, orgId);
    // Flush stale agentId→orgId mapping so retell-webhooks.ts picks up the
    // new agent on the next webhook call instead of serving from cache.
    if (saved.retellAgentId) invalidateOrgIdCache(saved.retellAgentId);
    if (saved.retellCallbackAgentId) invalidateOrgIdCache(saved.retellCallbackAgentId);
    return { ok: true, config: saved, retellAgentId: saved.retellAgentId, retellLlmId: saved.retellLlmId };
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
      // Fallback: find first deployed agent for this org
      if (!pool) return { ok: false, error: 'AGENT_NOT_DEPLOYED', message: 'Deploy the agent first.' };
      const res = await pool.query(
        `SELECT data FROM agent_configs WHERE org_id = $1 AND data->>'retellAgentId' IS NOT NULL ORDER BY updated_at DESC LIMIT 1`,
        [orgId],
      );
      config = res.rows[0]?.data ? AgentConfigSchema.parse(res.rows[0].data) : await readConfig(orgId, orgId);
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
