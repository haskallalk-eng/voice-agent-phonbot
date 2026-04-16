/**
 * Demo endpoints — no auth required.
 * Allows landing page visitors to try a voice agent before signing up.
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createWebCall, createLLM, createAgent as retellCreateAgent, createPhoneCall, updatePhoneNumber, DEFAULT_VOICE_ID } from './retell.js';
import { TEMPLATES } from './templates.js';
import { pool } from './db.js';
import { redis } from './redis.js';
import { verifyTurnstile } from './captcha.js';

// Demo agent cache — Redis-backed so horizontal scaling (multiple API containers)
// doesn't create duplicate Retell agents. Falls back to in-memory Map when Redis down.
const CACHE_TTL_SEC = 24 * 60 * 60;
const inMemDemoAgents = new Map<string, { agentId: string; createdAt: number }>();

async function readDemoAgent(templateId: string): Promise<string | null> {
  if (redis?.isOpen) {
    const v = await redis.get(`demo_agent:${templateId}`).catch(() => null);
    if (v) return v;
  }
  const cached = inMemDemoAgents.get(templateId);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_SEC * 1000) return cached.agentId;
  return null;
}

async function writeDemoAgent(templateId: string, agentId: string): Promise<void> {
  inMemDemoAgents.set(templateId, { agentId, createdAt: Date.now() });
  if (redis?.isOpen) await redis.set(`demo_agent:${templateId}`, agentId, { EX: CACHE_TTL_SEC }).catch(() => {});
}

// In-process dedup: when N parallel /demo/call arrive for the same template
// with a cold cache, we want ONE createLLM+createAgent, not N. The pending
// map holds the in-flight promise; every subsequent caller awaits the same
// result. Per-container — horizontal scale adds at-most N agents per N
// containers (acceptable, since the Redis cache fill from the first winner
// suppresses further duplicates on restart).
const pendingDemoCreate = new Map<string, Promise<string>>();

async function getOrCreateDemoAgent(templateId: string): Promise<string> {
  const cached = await readDemoAgent(templateId);
  if (cached) return cached;

  const inflight = pendingDemoCreate.get(templateId);
  if (inflight) return inflight;

  const creation = (async () => {
    const template = TEMPLATES.find((t) => t.id === templateId);
    if (!template) throw new Error('Unknown template');

    // Double-check under the in-flight lock: another container may have cached.
    const cached2 = await readDemoAgent(templateId);
    if (cached2) return cached2;

    const model = process.env.RETELL_LLM_MODEL ?? 'gpt-4o-mini';
    const llm = await createLLM({
      generalPrompt: template.prompt,
      tools: [],
      model,
    });

    const agent = await retellCreateAgent({
      name: `Demo: ${template.name}`,
      llmId: llm.llm_id,
      voiceId: template.voice,
      language: template.language === 'de' ? 'de-DE' : 'en-US',
    });

    await writeDemoAgent(templateId, agent.agent_id);
    return agent.agent_id;
  })();

  pendingDemoCreate.set(templateId, creation);
  try {
    return await creation;
  } finally {
    pendingDemoCreate.delete(templateId);
  }
}

/* ── Sales callback agent ── */

const SALES_PROMPT = `Du bist Chipy, der freundliche KI-Assistent von Phonbot. Du rufst gerade jemanden an, der sich für Phonbot interessiert hat und einen Rückruf angefordert hat.

DEIN ZIEL: Finde heraus welches Business der Interessent hat und zeige ihm wie Phonbot konkret helfen kann. Sei ehrlich, sympathisch und beratend — nicht aufdringlich.

GESPRÄCHSABLAUF:
1. Begrüße den Anrufer: "Hallo! Hier ist Chipy von Phonbot — du hattest gerade einen Rückruf angefordert. Cooler Move! Ich bin ein KI-Telefonassistent und zeige dir gerade live was ich kann."
2. Frage: "Was für ein Unternehmen hast du? Erzähl mir kurz was du machst."
3. Basierend auf der Antwort: erkläre wie Phonbot speziell für diese Branche hilft. Gib konkrete Beispiele:
   - Friseur: "Stell dir vor, deine Kunden rufen an, ich buche direkt den Termin — du schneidest einfach weiter."
   - Handwerker: "Du bist auf der Baustelle, Telefon klingelt — ich nehme alles auf und du bekommst ein sauberes Ticket."
   - Arzt: "Deine MFA ist am Limit — ich nehme Terminanfragen an, du entlastest dein Team."
4. Frage: "Wie viele Anrufe bekommst du so am Tag die du nicht annehmen kannst?"
5. Rechne vor: "Das sind roughly X verpasste Chancen im Monat. Mit Phonbot gehst du bei jedem einzelnen ran."
6. Abschluss: "Du kannst Phonbot komplett kostenlos testen — 100 Freiminuten, kein Risiko. Soll ich dir den Link zur Registrierung schicken?"

REGELN:
- Sprich auf Deutsch, natürlich und locker — du bist kein Callcenter-Bot
- Max 2-3 Sätze pro Antwort, lass den Gesprächspartner reden
- Sei ehrlich: wenn Phonbot für jemanden keinen Sinn macht, sag das
- Kein Druck, keine Tricks — einfach zeigen was möglich ist
- Halte das Gespräch unter 2 Minuten
`;

// Sales agent ID — Redis-backed (shared across containers, survives restarts)
// In-memory fallback for when Redis is down.
let salesAgentIdMem: string | null = null;
const SALES_AGENT_KEY = 'sales_agent:phonbot';

export async function getOrCreateSalesAgent(): Promise<string> {
  if (redis?.isOpen) {
    const cached = await redis.get(SALES_AGENT_KEY).catch(() => null);
    if (cached) { salesAgentIdMem = cached; return cached; }
  } else if (salesAgentIdMem) {
    return salesAgentIdMem;
  }

  const model = process.env.RETELL_LLM_MODEL ?? 'gpt-4o-mini';
  const llm = await createLLM({
    generalPrompt: SALES_PROMPT,
    tools: [],
    model,
  });

  const agent = await retellCreateAgent({
    name: 'Phonbot Sales Callback',
    llmId: llm.llm_id,
    voiceId: DEFAULT_VOICE_ID,
    language: 'de-DE',
  });

  salesAgentIdMem = agent.agent_id;
  // 7-day TTL — if the Retell agent gets deleted (manual cleanup, account
  // rotation), the cache expires and the next call regenerates it. Without
  // TTL a stale agent_id sticks forever and every Sales call after deletion
  // would 404 from Retell.
  if (redis?.isOpen) await redis.set(SALES_AGENT_KEY, agent.agent_id, { EX: 7 * 24 * 60 * 60 }).catch(() => {});

  // Register as outbound agent on the configured phone number
  const outboundNumber = process.env.RETELL_OUTBOUND_NUMBER;
  if (outboundNumber) {
    await updatePhoneNumber(outboundNumber, { outboundAgentId: agent.agent_id });
  }

  return agent.agent_id;
}

// Demo leads are persisted in crm_leads (DB). No in-memory duplicate —
// that was redundant and didn't survive restarts or horizontal scaling.

const DemoCallBody = z.object({
  // Whitelist templateId against known TEMPLATES to prevent unbounded Retell
  // agent creation (each unknown templateId used to create a new Retell LLM + Agent → cost)
  templateId: z.string().min(1).refine(
    (id) => TEMPLATES.some((t) => t.id === id),
    { message: 'Unknown templateId' },
  ),
  // Cloudflare Turnstile token from the widget. Required in prod (server gates
  // via verifyTurnstile()); dev with no TURNSTILE_SECRET_KEY skips the check.
  turnstileToken: z.string().optional(),
});

const DemoCallbackBody = z.object({
  // Sanitize name: only letters, digits, spaces, hyphens, apostrophes, umlauts
  // (prompt-injection mitigation — name is interpolated into agent prompt)
  name: z.string().min(1).max(50).regex(/^[\p{L}\p{N}\s'-]+$/u, 'Invalid characters in name'),
  email: z.string().email().max(200),
  phone: z.string().min(5).max(30),
  turnstileToken: z.string().optional(),
});

// Global hourly cost cap across ALL IPs — the per-IP rate-limit (10/h) is
// easily bypassed by a botnet, and every demo call burns OpenAI + Retell
// spend. Env-configurable so we can raise it for campaigns.
const DEMO_GLOBAL_HOURLY_CAP = Number(process.env.DEMO_GLOBAL_HOURLY_CAP ?? 200);

async function enforceGlobalDemoCap(kind: 'call' | 'callback'): Promise<{ ok: true } | { ok: false; count: number }> {
  if (!redis?.isOpen) return { ok: true }; // fail open when Redis down
  const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const key = `demo:global:${kind}:${hour}`;
  try {
    const results = await redis.multi().incr(key).expire(key, 3700).exec();
    const count = Number(results?.[0] ?? 0);
    if (count > DEMO_GLOBAL_HOURLY_CAP) return { ok: false, count };
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

export async function registerDemo(app: FastifyInstance) {
  // GET /demo/templates — list available templates
  app.get('/demo/templates', async () => {
    return {
      templates: TEMPLATES.map(({ id, icon, name, description }) => ({
        id, icon, name, description,
      })),
    };
  });

  // POST /demo/call — create a web call with a demo agent (no auth)
  // Per-IP rate limit (10/h) + global hourly cap + Turnstile CAPTCHA to stop
  // botnet cost-amplification (each demo call burns OpenAI + Retell spend).
  app.post('/demo/call', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const parsed = DemoCallBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'templateId required' });
    }
    const { templateId, turnstileToken } = parsed.data;

    // Perf: check the cheap Redis cap FIRST (sub-ms), then the Cloudflare
    // Turnstile verify (up to 5s network round-trip). On a cap-hit we skip
    // the Cloudflare call entirely and return 429 faster.
    const cap = await enforceGlobalDemoCap('call');
    if (!cap.ok) {
      app.log.warn({ count: cap.count, limit: DEMO_GLOBAL_HOURLY_CAP }, 'demo/call global hourly cap hit');
      return reply.status(429).send({ error: 'Demo temporarily unavailable — please try again later.' });
    }

    // CAPTCHA-Gate (N6). In dev without TURNSTILE_SECRET_KEY this is a no-op;
    // in prod a missing/invalid token is rejected.
    const captchaOk = await verifyTurnstile(turnstileToken, req.ip);
    if (!captchaOk) {
      app.log.warn({ ip: req.ip }, 'demo/call captcha verification failed');
      return reply.status(403).send({ error: 'captcha_failed', message: 'Bitte Captcha bestätigen.' });
    }

    try {
      const agentId = await getOrCreateDemoAgent(templateId);
      const call = await createWebCall(agentId);
      return { ok: true, ...call };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create demo call';
      return reply.status(500).send({ error: msg });
    }
  });

  // POST /demo/callback
  app.post('/demo/callback', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const parsed = DemoCallbackBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'name, email and phone required (name only letters/digits)', details: parsed.error.flatten() });
    }

    const captchaOk = await verifyTurnstile(parsed.data.turnstileToken, req.ip);
    if (!captchaOk) {
      app.log.warn({ ip: req.ip }, 'demo/callback captcha verification failed');
      return reply.status(403).send({ error: 'captcha_failed', message: 'Bitte Captcha bestätigen.' });
    }

    const cap = await enforceGlobalDemoCap('callback');
    if (!cap.ok) {
      app.log.warn({ count: cap.count, limit: DEMO_GLOBAL_HOURLY_CAP }, 'demo/callback global hourly cap hit');
      return reply.status(429).send({ error: 'Demo temporarily unavailable — please try again later.' });
    }

    const { name, email } = parsed.data;
    // Normalize phone to E.164 format
    let phone = parsed.data.phone.replace(/[\s\-()]/g, '');
    if (phone.startsWith('00')) phone = '+' + phone.slice(2);
    else if (phone.startsWith('0') && !phone.startsWith('+')) phone = '+49' + phone.slice(1);
    if (!phone.startsWith('+')) phone = '+49' + phone;

    // Abuse guard: country whitelist (default DACH — configurable via ALLOWED_PHONE_PREFIXES)
    const ALLOWED_PREFIXES = (process.env.ALLOWED_PHONE_PREFIXES ?? '+49,+43,+41').split(',').map((p) => p.trim()).filter(Boolean);
    if (!ALLOWED_PREFIXES.some((p) => phone.startsWith(p))) {
      app.log.warn({ phone, ip: req.ip }, 'Rejected demo/callback: non-allowed country prefix');
      return reply.status(400).send({ error: 'Aktuell nur Telefonnummern aus der DACH-Region (DE/AT/CH) unterstützt' });
    }

    // Dedup — same phone within 24h won't retrigger a callback. Prevents a
    // botnet from stuffing the CRM with the same victim number + burning
    // Twilio/Retell spend on repeated calls. Caller still gets 200 so the
    // response-time is indistinguishable (no enumeration signal).
    if (pool) {
      const dup = await pool.query(
        `SELECT 1 FROM crm_leads WHERE phone = $1 AND created_at > now() - interval '24 hours' LIMIT 1`,
        [phone],
      );
      if (dup.rowCount) {
        app.log.info({ phone, ip: req.ip }, 'demo/callback dedup hit — skipping outbound call');
        return { ok: true };
      }
    }

    const leadId = crypto.randomUUID();
    app.log.info({ leadId, name, email, phone }, 'New demo callback lead');

    // Persist lead in CRM database (single source of truth; org_id=NULL = platform-anonymous)
    if (pool) {
      pool.query(
        `INSERT INTO crm_leads (name, email, phone, source, status) VALUES ($1, $2, $3, 'demo-callback', 'new')`,
        [name, email, phone],
      ).catch((err: Error) => app.log.warn({ err: err.message }, 'crm_leads insert failed'));
    }

    // Try outbound call via Retell
    const fromNumber = process.env.RETELL_OUTBOUND_NUMBER; // e.g. "+4930123456"
    if (fromNumber) {
      try {
        const agentId = await getOrCreateSalesAgent();
        const call = await createPhoneCall({
          agentId,
          toNumber: phone,
          fromNumber,
          metadata: { leadId, leadName: name },
        });
        app.log.info({ callId: call.call_id, phone }, 'Outbound sales call initiated');
        // Mark lead as called
        if (pool) {
          pool.query(
            `UPDATE crm_leads SET status = 'contacted', call_id = $1 WHERE email = $2 AND phone = $3 AND status = 'new'`,
            [call.call_id, email, phone],
          ).catch(() => {/* non-critical */});
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'unknown error';
        app.log.warn({ err: msg, phone }, 'Outbound call failed');
      }
    } else {
      app.log.warn('RETELL_OUTBOUND_NUMBER not configured — skipping outbound call');
    }

    return { ok: true, message: 'Chipy ruft dich bald an! Wir haben deine Nummer gespeichert.' };
  });

  // Note: /demo/leads was removed — use /admin/leads instead (platform-admin only, reads from crm_leads DB).
}
