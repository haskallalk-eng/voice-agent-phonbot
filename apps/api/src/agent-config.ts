import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from './auth.js';
import { pool } from './db.js';
import { buildAgentInstructions } from './agent-instructions.js';
import { checkUsageLimit } from './usage.js';
import {
  createLLM,
  updateLLM,
  createAgent as retellCreateAgent,
  updateAgent as retellUpdateAgent,
  createWebCall,
  listCalls,
  getCall,
  type RetellTool,
} from './retell.js';
import { triggerBridgeCall } from './twilio-openai-bridge.js';

const AgentConfigSchema = z.object({
  tenantId: z.string().min(1).default('demo'),
  name: z.string().min(1).default('Demo Agent'),
  language: z.enum(['de', 'en', 'fr', 'es', 'it', 'tr', 'pl', 'nl']).default('de'),
  voice: z.string().min(1).default('retell-Cimo'),
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
});

type AgentConfig = z.infer<typeof AgentConfigSchema>;

const memory = new Map<string, AgentConfig>();

export async function readConfig(tenantId: string): Promise<AgentConfig> {
  if (!pool) {
    return memory.get(tenantId) ?? AgentConfigSchema.parse({ tenantId });
  }

  const res = await pool.query('select data from agent_configs where tenant_id = $1', [tenantId]);
  if (!res.rows.length) return AgentConfigSchema.parse({ tenantId });
  return AgentConfigSchema.parse(res.rows[0].data);
}

async function writeConfig(config: AgentConfig, orgId?: string): Promise<AgentConfig> {
  if (!pool) {
    memory.set(config.tenantId, config);
    return config;
  }

  await pool.query(
    `insert into agent_configs (tenant_id, org_id, data, updated_at)
     values ($1, $2, $3, now())
     on conflict (tenant_id)
     do update set data = excluded.data,
                   org_id = COALESCE(excluded.org_id, agent_configs.org_id),
                   updated_at = now()`,
    [config.tenantId, orgId ?? null, config],
  );
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

  return tools;
}

function getWebhookBaseUrl(): string {
  return process.env.WEBHOOK_BASE_URL?.replace(/\/$/, '') ?? 'https://your-server.example.com';
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

  // Create or update LLM
  if (llmId) {
    await updateLLM(llmId, { generalPrompt: instructions, tools: retellTools, model });
  } else {
    const llm = await createLLM({ generalPrompt: instructions, tools: retellTools, model });
    llmId = llm.llm_id;
  }

  // Create or update Agent
  if (agentId) {
    await retellUpdateAgent(agentId, {
      name: config.name,
      voiceId: config.voice,
      language,
      llmId,
    });
  } else {
    const agent = await retellCreateAgent({
      name: config.name,
      llmId: llmId!,
      voiceId: config.voice,
      language,
    });
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
    const webhookBase = process.env.WEBHOOK_BASE_URL ?? 'http://localhost:3001';

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

  // Read config (default = first for org, or specific by ?tenantId=)
  app.get('/agent-config', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const query = req.query as Record<string, string>;
    const tenantId = query.tenantId ?? orgId;
    return readConfig(tenantId);
  });

  // Preview generated instructions
  app.get('/agent-config/preview', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const config = await readConfig(orgId);
    return {
      instructions: buildAgentInstructions(config),
      tools: config.tools,
      fallback: config.fallback,
    };
  });

  // Save config (local only, no Retell deploy)
  app.put('/agent-config', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const raw = req.body as Record<string, unknown>;
    // Allow tenantId from body for multi-agent — fallback to orgId
    const tenantId = (typeof raw.tenantId === 'string' && raw.tenantId) ? raw.tenantId : orgId;
    const body = AgentConfigSchema.parse({ ...raw, tenantId });
    return writeConfig(body, orgId);
  });

  // Deploy config to Retell AI (save + sync)
  app.post('/agent-config/deploy', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const raw = req.body as Record<string, unknown>;
    const tenantId = (typeof raw.tenantId === 'string' && raw.tenantId) ? raw.tenantId : orgId;
    const body = AgentConfigSchema.parse({ ...raw, tenantId });
    const deployed = await deployToRetell(body);
    const saved = await writeConfig(deployed, orgId);
    return { ok: true, config: saved, retellAgentId: saved.retellAgentId, retellLlmId: saved.retellLlmId };
  });

  // Delete an agent config
  app.delete('/agent-config/:tenantId', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
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
      const userRow = await pool.query(`SELECT password_hash FROM users WHERE org_id = $1 LIMIT 1`, [orgId]);
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

    // Enforce usage limit before creating the call
    const usage = await checkUsageLimit(orgId);
    if (!usage.allowed) {
      return {
        ok: false,
        error: 'USAGE_LIMIT_REACHED',
        minutesUsed: usage.minutesUsed,
        minutesLimit: usage.minutesLimit,
      };
    }

    // Use specific agent if tenantId provided, otherwise fall back to first deployed agent
    const parsed = z.object({ agentTenantId: z.string().optional() }).safeParse(req.body);
    const tenantId = parsed.success ? parsed.data.agentTenantId : undefined;

    let config: AgentConfig;
    if (tenantId) {
      config = await readConfig(tenantId);
    } else {
      // Fallback: find first deployed agent for this org
      if (!pool) return { ok: false, error: 'AGENT_NOT_DEPLOYED', message: 'Deploy the agent first.' };
      const res = await pool.query(
        `SELECT data FROM agent_configs WHERE org_id = $1 AND data->>'retellAgentId' IS NOT NULL ORDER BY updated_at DESC LIMIT 1`,
        [orgId],
      );
      config = res.rows[0]?.data ? AgentConfigSchema.parse(res.rows[0].data) : await readConfig(orgId);
    }

    if (!config.retellAgentId) {
      return { ok: false, error: 'AGENT_NOT_DEPLOYED', message: 'Deploy the agent first.' };
    }
    const call = await createWebCall(config.retellAgentId);
    return { ok: true, ...call };
  });

  // Call history from Retell
  app.get('/calls', { ...auth }, async (req: FastifyRequest) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const calls = await listCalls(undefined, q.limit);
    return { items: calls };
  });

  app.get('/calls/:callId', { ...auth }, async (req: FastifyRequest) => {
    const params = z.object({ callId: z.string().min(1) }).parse(req.params);
    const call = await getCall(params.callId);
    return call;
  });
}
