/**
 * Demo endpoints — no auth required.
 * Allows landing page visitors to try a voice agent before signing up.
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createWebCall, createLLM, createAgent as retellCreateAgent, createPhoneCall, updatePhoneNumber, DEFAULT_VOICE_ID, type RetellTool, type PostCallAnalysisField } from './retell.js';
import { TEMPLATES } from './templates.js';
import { loadPlatformBaseline } from './platform-baseline.js';
import { loadOutboundBaseline } from './outbound-baseline.js';

// Retell built-in end_call tool. Lets GPT-4o-mini hang up the demo when the
// caller says goodbye OR after the agent has announced a forwarding
// ("Ich verbinde dich gleich"). Without this, demos run until 45 s silence
// timeout — burns minutes and feels broken.
const DEMO_END_CALL_TOOL: RetellTool = {
  type: 'end_call',
  name: 'end_call',
  description:
    'Beende den Anruf, sobald (a) der Anrufer sich verabschiedet — "tschüss", "ciao", "danke das war\'s", "auf wiederhören" — ODER (b) du gerade angekündigt hast, dass du den Anruf weiterleitest ("Ich verbinde dich kurz", "Einen Moment, ich stelle durch"). In beiden Fällen erst die Verabschiedung/Ankündigung sprechen, DANACH diese Funktion aufrufen.',
};

// Demo-spezifische Regeln, die NICHT für zahlende Kunden gelten — Demo-Modus-
// Disclaimer, harte 3-Daten-Pflicht (beide Kanäle für die CRM-Aufnahme), und
// Capability-Simulation. Universelle Qualitäts-Regeln (Buchstabieren, end_call,
// Promise-Disziplin) liegen in apps/api/src/platform-baseline.ts und werden
// für JEDEN Agent vorne angehängt.
//
// Exported so the admin UI can show the in-code default next to the override.
export const DEMO_END_INSTRUCTIONS = `

# Demo-spezifische Regeln (gilt nur für Demo-Calls)

## Demo-Modus
Du bist eine LIVE-Demo auf phonbot.de. Der Anrufer ist ein Website-Besucher, der dich gerade testet. Spiel realistisch mit, aber erfinde keine echten Termine, Preise oder Kalenderdaten — wenn du einen Slot vorschlägst, sind Beispiel-Slots wie "Donnerstag 14 Uhr" ok, aber bestätige nichts als "verbindlich gebucht".

## Kontakt-Daten in dieser Demo erheben (Pflicht-Trio)
Wenn das Gespräch zu einem Termin, Rückruf, Angebot oder Ticket führt, erfrage IMMER drei Daten in dieser Reihenfolge: 1) Name, 2) Mobil- oder Festnetznummer, 3) E-Mail-Adresse. Beide Kontaktwege werden gebraucht: die Nummer für SMS-Bestätigung, die E-Mail für Termin-Einladung. Wiederhole die Telefonnummer in Zweier- oder Dreier-Blöcken zur Kontrolle. Erst nachdem alle drei sauber bestätigt sind, sag "Alles klar, ich hab's eingetragen" — vorher nicht.

## Fähigkeiten dieser Demo
Du verhältst dich genau wie der Live-Agent dieses Geschäfts: Termine vorschlagen + buchen, Tickets erfassen, weiterleiten falls nötig. Wenn ein Anliegen über das hinausgeht, was du in der Demo simulieren kannst (echte Verfügbarkeit, echter Preis, Status eines bestehenden Auftrags), kündige eine Weiterleitung an und beende den Anruf — siehe Plattform-Baseline.`;

// Retell post-call analysis — fields the model extracts from the transcript
// after the call ends. Sent to /retell/webhook in the call_analysis event,
// then persisted on the demo_calls row so admins can scan + promote leads.
const DEMO_POST_CALL_FIELDS: PostCallAnalysisField[] = [
  { type: 'string', name: 'caller_name', description: 'Vollständiger Name des Anrufers, falls genannt. Nur Vorname OK. Leer lassen wenn nicht erwähnt.' },
  { type: 'string', name: 'caller_email', description: 'E-Mail-Adresse des Anrufers in lowercase und voll validiert (max@gmx.de). Leer wenn nicht genannt.' },
  { type: 'string', name: 'caller_phone', description: 'Telefonnummer des Anrufers in E.164-Format (+49…). Leer wenn nicht genannt.' },
  { type: 'string', name: 'intent_summary', description: 'Ein-Satz-Zusammenfassung des Anliegens auf Deutsch (max. 140 Zeichen). Was wollte der Anrufer?' },
];

import { pool } from './db.js';
import { redis } from './redis.js';
import { verifyTurnstile } from './captcha.js';
import { sendSignupLinkEmail } from './email.js';
import { sendSignupLinkSms, signupLinkUrl } from './sms.js';

// Demo agent cache — Redis-backed so horizontal scaling (multiple API containers)
// doesn't create duplicate Retell agents. Falls back to in-memory Map when Redis down.
// H6: Cap in-memory maps to prevent OOM when Redis is unavailable.
const CACHE_TTL_SEC = 24 * 60 * 60;
const MAX_DEMO_AGENTS = 1000;
const inMemDemoAgents = new Map<string, { agentId: string; createdAt: number }>();

async function readDemoAgent(templateId: string): Promise<string | null> {
  if (redis?.isOpen) {
    const v = await redis.get(`demo_agent:v4:${templateId}`).catch(() => null);
    return v ?? null;
    // Audit-Round-9 H1: when Redis is online but the key is absent (legit
    // flush, scaled-out container B that never wrote it), DO NOT fall back
    // to in-mem. In-mem can carry stale values from before a cross-container
    // flushDemoAgentCache(), causing user-visible old prompts. The cost of
    // returning null here = one extra Retell agent gets created on the next
    // /demo/call, which is cheap and self-healing via Redis.
  }
  // Redis offline → in-mem is the only fallback we have.
  const cached = inMemDemoAgents.get(templateId);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_SEC * 1000) return cached.agentId;
  return null;
}

// Reverse lookup so the Retell webhook can recognise demo calls. The webhook
// only knows the agent_id; we map it back to a templateId so we can persist
// into demo_calls with the right branche-tag.
const inMemDemoAgentMeta = new Map<string, { templateId: string; createdAt: number }>();

async function writeDemoAgent(templateId: string, agentId: string): Promise<void> {
  // H6: Evict oldest entry when hitting the cap.
  if (inMemDemoAgents.size >= MAX_DEMO_AGENTS && !inMemDemoAgents.has(templateId)) {
    const firstKey = inMemDemoAgents.keys().next().value;
    if (firstKey !== undefined) inMemDemoAgents.delete(firstKey);
  }
  if (inMemDemoAgentMeta.size >= MAX_DEMO_AGENTS) {
    const firstKey = inMemDemoAgentMeta.keys().next().value;
    if (firstKey !== undefined) inMemDemoAgentMeta.delete(firstKey);
  }
  inMemDemoAgents.set(templateId, { agentId, createdAt: Date.now() });
  inMemDemoAgentMeta.set(agentId, { templateId, createdAt: Date.now() });
  if (redis?.isOpen) {
    await Promise.all([
      redis.set(`demo_agent:v4:${templateId}`, agentId, { EX: CACHE_TTL_SEC }).catch(() => {}),
      // Reverse direction: webhook sees agent_id, needs templateId. Same TTL.
      redis.set(`demo_agent_meta:v4:${agentId}`, templateId, { EX: CACHE_TTL_SEC }).catch(() => {}),
    ]);
  }
  // Audit-Round-9 H3: durable DB mirror of the reverse-lookup. Redis is the
  // fast-path; this row backstops it when the Redis key expires (24h TTL) or
  // is dropped by flushDemoAgentCache() while a demo call is still in flight.
  // Without this, retell-webhooks call_ended/call_analyzed handlers can't
  // resolve agent_id → templateId and silently drop the lead. Fire-and-forget
  // (the demo creation already worked at the Retell side; durability of the
  // mapping is a secondary concern that shouldn't fail the demo flow).
  if (pool) {
    pool.query(
      `INSERT INTO demo_agent_templates (agent_id, template_id)
       VALUES ($1, $2)
       ON CONFLICT (agent_id) DO UPDATE SET template_id = EXCLUDED.template_id`,
      [agentId, templateId],
    ).catch(() => { /* non-critical — Redis still serves the fast-path */ });
  }
}

/**
 * Look up the templateId for a Retell agent_id. Returns null when the agent
 * isn't a demo agent we created (e.g. a paid-tenant agent whose call_ended
 * webhook fired through this same handler).
 *
 * Lookup chain (fastest → most durable):
 *   1. Redis (24h TTL, written on getOrCreateDemoAgent)
 *   2. In-memory map (per-container, 24h TTL — only consulted when Redis offline
 *      to avoid the cross-container stale-read trap from Audit-Round 9 H1)
 *   3. demo_agent_templates DB row (30-day retention) — Audit-Round 9 H3.
 *      Catches the case where Redis was flushed mid-call OR the cache TTL
 *      lapsed before call_ended/call_analyzed fired. Without this, leads
 *      were silently dropped.
 */
export async function readDemoCallTemplate(agentId: string): Promise<string | null> {
  if (redis?.isOpen) {
    const v = await redis.get(`demo_agent_meta:v4:${agentId}`).catch(() => null);
    if (v) return v;
    // Skip in-mem when Redis is online (H1): in-mem could be stale across
    // containers and we now have a durable DB layer below.
  } else {
    const cached = inMemDemoAgentMeta.get(agentId);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL_SEC * 1000) return cached.templateId;
  }
  // H3: durable DB fallback. Cheap single-row PK lookup.
  if (pool) {
    const res = await pool.query(
      `SELECT template_id FROM demo_agent_templates WHERE agent_id = $1`,
      [agentId],
    ).catch(() => null);
    if (res && res.rowCount) return res.rows[0].template_id as string;
  }
  return null;
}

/**
 * Read admin-edited prompt fragments. Returns either {basePrompt, epilogue}
 * with whichever rows exist, or both null (= use the hard-coded defaults
 * from templates.ts + DEMO_END_INSTRUCTIONS). The "global" epilogue is
 * stored under template_id='__global__'; per-template rows can additionally
 * override base_prompt.
 */
async function readDemoPromptOverrides(templateId: string): Promise<{ basePrompt: string | null; epilogue: string | null }> {
  if (!pool) return { basePrompt: null, epilogue: null };
  const res = await pool.query(
    `SELECT template_id, epilogue, base_prompt
       FROM demo_prompt_overrides
      WHERE template_id IN ($1, '__global__')`,
    [templateId],
  ).catch(() => null);
  if (!res || !res.rowCount) return { basePrompt: null, epilogue: null };
  let basePrompt: string | null = null;
  let epilogue: string | null = null;
  for (const row of res.rows as Array<{ template_id: string; epilogue: string; base_prompt: string | null }>) {
    if (row.template_id === templateId) basePrompt = row.base_prompt ?? null;
    // Per-template epilogue beats the global one. We pick the most specific
    // epilogue that's set (template-specific > global). Both null = default.
    if (row.template_id === templateId && row.epilogue) epilogue = row.epilogue;
    else if (row.template_id === '__global__' && row.epilogue && epilogue === null) epilogue = row.epilogue;
  }
  return { basePrompt, epilogue };
}

/**
 * Drop all cached demo agents (Redis + in-memory). Next /demo/call hit re-
 * creates them via Retell with whatever prompt+tool config is current. Used
 * by the admin endpoint after editing a prompt override.
 */
export async function flushDemoAgentCache(): Promise<{ flushed: number }> {
  inMemDemoAgents.clear();
  inMemDemoAgentMeta.clear();
  salesAgentIdMem = null;
  let flushed = 0;
  if (redis?.isOpen) {
    // Sales-Callback agent (single key, no wildcard) — drop directly.
    try {
      const removed = await redis.del(SALES_AGENT_KEY);
      flushed += typeof removed === 'number' ? removed : 0;
      // Clean up the previous v3 key too on the way past.
      await redis.del('sales_agent:phonbot:v3').catch(() => {});
    } catch {
      /* non-critical */
    }
    // Include older versioned keys in the scan so a deploy that bumps the
    // cache key cleans up its own predecessors. Cheap — Redis SCAN is O(N)
    // total across all keys, not O(N) per pattern.
    for (const pattern of ['demo_agent:v4:*', 'demo_agent_meta:v4:*', 'demo_agent:v3:*', 'demo_agent_meta:v3:*']) {
      try {
        for await (const key of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
          const list = Array.isArray(key) ? key : [key];
          for (const k of list) {
            await redis.del(k);
            flushed++;
          }
        }
      } catch {
        /* non-critical */
      }
    }
  }
  return { flushed };
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

    // Three-layer prompt for demo agents:
    //   1. Platform-Baseline — admin-editable, applies to every Phonbot agent
    //      (paid customers + demos). Quality floor: spelling, end-call,
    //      promise-discipline. Lives in platform-baseline.ts + DB override.
    //   2. Branche-prompt — per-template (Friseur/Handwerker/…), admin can
    //      override individually via demo_prompt_overrides.
    //   3. Demo-addendum — admin-editable, applies only to demos. Demo-mode
    //      disclaimer, contact-trio, simulation note.
    // Cache key v3 is bumped whenever the assembly logic changes — the admin
    // "Cache leeren"-Button hard-flushes Redis if needed.
    const platformBaseline = await loadPlatformBaseline();
    const overrides = await readDemoPromptOverrides(templateId);
    const basePrompt = overrides.basePrompt ?? template.prompt;
    const demoAddendum = overrides.epilogue ?? DEMO_END_INSTRUCTIONS;

    const model = process.env.RETELL_LLM_MODEL ?? 'gpt-4o-mini';
    const llm = await createLLM({
      generalPrompt: platformBaseline + '\n\n' + basePrompt + demoAddendum,
      tools: [DEMO_END_CALL_TOOL],
      model,
    });

    // Wire webhook so call_ended pings /retell/webhook → demo_calls insert.
    // Without WEBHOOK_BASE_URL (dev) we skip the URL — calls still work, but
    // there's nowhere for Retell to POST to, so no persistence in dev.
    const webhookBase = process.env.WEBHOOK_BASE_URL?.replace(/\/$/, '');
    const agent = await retellCreateAgent({
      name: `Demo: ${template.name}`,
      llmId: llm.llm_id,
      voiceId: template.voice,
      language: template.language === 'de' ? 'de-DE' : 'en-US',
      webhookUrl: webhookBase ? `${webhookBase}/retell/webhook` : undefined,
      postCallAnalysisData: DEMO_POST_CALL_FIELDS,
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

// Compiled-in default for the Phonbot Sales-Callback (Rückruf) agent.
// Admin can override at runtime via demo_prompt_overrides row template_id='__sales__'
// (see loadSalesPrompt below). Exported so the admin UI can show the default
// next to the override.
export const DEFAULT_SALES_PROMPT = `Du bist Chipy, der freundliche KI-Assistent von Phonbot. Du rufst gerade jemanden an, der sich für Phonbot interessiert hat und einen Rückruf angefordert hat.

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
- Wenn der Interessent den Link möchte: Sage, dass der Testlink an die angegebene E-Mail geschickt wurde. Wenn {{signup_sms_sent}} = true ist, sage zusätzlich dass er auch per SMS verschickt wurde. Nenne bei Bedarf diesen Link: {{signup_link}}
`;

// Read admin-edited Sales prompt if set, otherwise the compiled-in default.
async function loadSalesPrompt(): Promise<string> {
  if (!pool) return DEFAULT_SALES_PROMPT;
  const res = await pool.query(
    `SELECT epilogue FROM demo_prompt_overrides WHERE template_id = '__sales__'`,
  ).catch(() => null);
  if (!res || !res.rowCount) return DEFAULT_SALES_PROMPT;
  const stored = res.rows[0].epilogue as string;
  return stored && stored.trim() ? stored : DEFAULT_SALES_PROMPT;
}

// Sales agent ID — Redis-backed (shared across containers, survives restarts)
// In-memory fallback for when Redis is down. Cache key bumps to v4 because
// the prompt now layers Outbound-Baseline + Sales-Prompt — old v3 cached
// agents lack that.
let salesAgentIdMem: string | null = null;
const SALES_AGENT_KEY = 'sales_agent:phonbot:v4';

export async function getOrCreateSalesAgent(): Promise<string> {
  if (redis?.isOpen) {
    const cached = await redis.get(SALES_AGENT_KEY).catch(() => null);
    if (cached) return cached;
    // Audit-Round-9 H1/M3: do NOT write back into salesAgentIdMem here.
    // The in-mem fallback is only for Redis-offline mode; a fresh Redis
    // read during a concurrent flushDemoAgentCache() could otherwise re-
    // populate the in-mem with the soon-to-be-deleted value, leaving a
    // stale value that surfaces if Redis later goes offline.
  } else if (salesAgentIdMem) {
    return salesAgentIdMem;
  }

  const model = process.env.RETELL_LLM_MODEL ?? 'gpt-4o-mini';
  // Layer Outbound-Baseline + (admin-overridable) Sales-Prompt. Outbound
  // baseline carries DSGVO-Widerspruch + KI-Identifikation + DIN-5009 etc.
  const outboundBaseline = await loadOutboundBaseline();
  const salesPrompt = await loadSalesPrompt();
  const llm = await createLLM({
    generalPrompt: `${outboundBaseline}\n\n${salesPrompt}`,
    tools: [DEMO_END_CALL_TOOL],
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
        sendSignupLinkEmail({ toEmail: email, name })
          .catch((err: Error) => app.log.warn({ err: err.message }, 'demo/callback signup-link email failed'));
        const sms = await sendSignupLinkSms({ to: phone, name, logger: app.log });
        return { ok: true, smsSent: sms.ok };
      }
    }

    const leadId = crypto.randomUUID();
    app.log.info({ leadId, name, email, phone }, 'New demo callback lead');

    // Persist lead in CRM database (single source of truth; org_id=NULL = platform-anonymous)
    // DSGVO Art. 5: leads are auto-deleted after 90 days by cleanupOldLeads() in db.ts
    if (pool) {
      pool.query(
        `INSERT INTO crm_leads (name, email, phone, source, status) VALUES ($1, $2, $3, 'demo-callback', 'new')`,
        [name, email, phone],
      ).catch((err: Error) => app.log.warn({ err: err.message }, 'crm_leads insert failed'));
    }

    sendSignupLinkEmail({ toEmail: email, name })
      .catch((err: Error) => app.log.warn({ err: err.message }, 'demo/callback signup-link email failed'));
    const signupSms = await sendSignupLinkSms({ to: phone, name, logger: app.log });

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
          dynamicVariables: {
            signup_link: signupLinkUrl(),
            signup_sms_sent: signupSms.ok ? 'true' : 'false',
          },
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

    return { ok: true, message: 'Chipy ruft dich bald an! Wir haben deine Nummer gespeichert.', smsSent: signupSms.ok };
  });

  // Note: /demo/leads was removed — use /admin/leads instead (platform-admin only, reads from crm_leads DB).
}
