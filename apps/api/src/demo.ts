/**
 * Demo endpoints — no auth required.
 * Allows landing page visitors to try a voice agent before signing up.
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createWebCall, createLLM, createAgent as retellCreateAgent, createPhoneCall, updatePhoneNumber } from './retell.js';
import { TEMPLATES } from './templates.js';
import { pool } from './db.js';

// Cache demo agents so we don't re-create them on every request
const demoAgentCache = new Map<string, { agentId: string; createdAt: number }>();
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24h

async function getOrCreateDemoAgent(templateId: string): Promise<string> {
  const cached = demoAgentCache.get(templateId);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL) {
    return cached.agentId;
  }

  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new Error('Unknown template');

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

  demoAgentCache.set(templateId, { agentId: agent.agent_id, createdAt: Date.now() });
  return agent.agent_id;
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

let salesAgentId: string | null = null;

export async function getOrCreateSalesAgent(): Promise<string> {
  if (salesAgentId) return salesAgentId;

  const model = process.env.RETELL_LLM_MODEL ?? 'gpt-4o-mini';
  const llm = await createLLM({
    generalPrompt: SALES_PROMPT,
    tools: [],
    model,
  });

  const agent = await retellCreateAgent({
    name: 'Phonbot Sales Callback',
    llmId: llm.llm_id,
    voiceId: 'custom_voice_28bd4920fa6523c6ac8c4e527b',
    language: 'de-DE',
  });

  salesAgentId = agent.agent_id;

  // Register as outbound agent on the configured phone number
  const outboundNumber = process.env.RETELL_OUTBOUND_NUMBER;
  if (outboundNumber) {
    await updatePhoneNumber(outboundNumber, { outboundAgentId: salesAgentId });
  }

  return salesAgentId;
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
});

const DemoCallbackBody = z.object({
  // Sanitize name: only letters, digits, spaces, hyphens, apostrophes, umlauts
  // (prompt-injection mitigation — name is interpolated into agent prompt)
  name: z.string().min(1).max(50).regex(/^[\p{L}\p{N}\s'-]+$/u, 'Invalid characters in name'),
  email: z.string().email().max(200),
  phone: z.string().min(5).max(30),
});

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
  // Rate limited to 3 calls per hour per IP via @fastify/rate-limit
  app.post('/demo/call', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const parsed = DemoCallBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'templateId required' });
    }
    const { templateId } = parsed.data;

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
