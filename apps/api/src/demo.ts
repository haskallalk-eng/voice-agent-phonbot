/**
 * Demo endpoints — no auth required.
 * Allows landing page visitors to try a voice agent before signing up.
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createWebCall, createLLM, createAgent as retellCreateAgent, createPhoneCall, updatePhoneNumber, DEFAULT_VOICE_ID, type RetellTool } from './retell.js';
import { TEMPLATES } from './templates.js';

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

// Common epilogue appended to every demo template's prompt. Keeps the per-
// template prompts focused on their domain (booking, intake, services) while
// centralising demo-wide rules: shutdown semantics + promise-discipline +
// capability-parity-with-prod. Synced with DEMO_END_CALL_TOOL.
const DEMO_END_INSTRUCTIONS = `

# Demo-übergreifende Regeln

## Beenden des Gesprächs
- Verabschiedet sich der Anrufer (tschüss/ciao/danke das war's/auf wiederhören/bye/schönen Tag), sag knapp tschüss und ruf direkt danach die Funktion end_call auf.
- Kann das Anliegen nur die Inhaberin/der Inhaber persönlich klären (komplexe Beratung, individuelle Preise, Spezialfragen), sag freundlich "Einen Moment, ich verbinde dich gleich" und ruf danach end_call auf. Die Telefonanlage übernimmt die Weiterleitung — du selbst leitest NICHT um.
- Erfinde keine echte Weiterleitung. Sprich erst die Ankündigung, danach end_call.

## Versprich nichts, was du nicht (noch) tun kannst
- Sag NIE "ich schicke dir das per SMS/E-Mail/WhatsApp", wenn du Telefonnummer oder E-Mail des Anrufers noch nicht erfragt hast. Frag ZUERST: "Auf welche Nummer/E-Mail darf ich's schicken?" und wiederhol die Adresse zur Bestätigung BEVOR du den Versand zusagst.
- Sag NIE "ich trage dich in den Kalender ein", "ich notiere das im Ticket", "ich leite das weiter" — wenn du den Namen des Anrufers noch nicht hast. Daten zuerst, Versprechen danach.
- Wenn der Anrufer dich nach etwas fragt, das du in dieser Demo nicht prüfen kannst (live-Verfügbarkeit, echter Preis, Status eines bestehenden Auftrags), sag ehrlich: "Das müsste die Inhaberin/der Inhaber direkt mit dir klären — ich verbinde dich gleich" und ruf end_call auf.

## Kontakt-Daten in dieser Demo erheben
Wenn das Gespräch zu einem Termin, Rückruf, Angebot oder Ticket führt, erfrage IMMER drei Daten — und zwar in dieser Reihenfolge: 1) Name, 2) Mobil- oder Festnetznummer, 3) E-Mail-Adresse. Beide Kontaktwege werden gebraucht: die Nummer für SMS-Bestätigung, die E-Mail für Termin-Einladung. Buchstabiere die E-Mail nach Diktat zurück (siehe Buchstabier-Sektion unten) und wiederhole die Telefonnummer in Zweier- oder Dreier-Blöcken. Erst nachdem alle drei sauber bestätigt sind, sag "Alles klar, ich hab's eingetragen" — vorher nicht.

## Fähigkeiten dieser Demo
Du verhältst dich genau wie der Live-Agent dieses Geschäfts: Termine vorschlagen + buchen, Tickets erfassen, Kontakt-Daten aufnehmen, weiterleiten falls nötig. Beispiel-Slots wie "Donnerstag 14 Uhr" sind ok als Vorschläge — aber bevor du eine Buchung als bestätigt erklärst, MUSS Name + Rückrufweg vorhanden sein.

## Buchstabieren am Telefon (E-Mail, Namen, Adressen)
Telefon-Audio ist mehrdeutig — "B" und "P", "M" und "N", "T" und "D" klingen fast gleich. Erwarte deshalb, dass Anrufer ihre E-Mail/Namen über Buchstabier-Wörter durchgeben: "M wie Maria, A wie Anton, X wie X-Ray". Solche Wörter sind KEIN Bestandteil der Adresse — extrahiere immer NUR den ersten Buchstaben jedes Buchstabier-Worts.

Erkenne Spelling-Patterns an Phrasen wie: "wie", "wie in", "von", "groß ...", "klein ...", "mit ...", "Doppel-..." (= zwei gleiche Buchstaben in Folge). Beispiele die du als M-A-X-@-... interpretieren musst:
- "M wie Maria, A wie Anton, X wie Xanten, ät, gee em ex punkt de"  → max@gmx.de
- "T-O-M, ohne H, dann Punkt, Doppel-S"  → toms.s? — frag zurück bei Unklarheit
- "M wie Mama, an klein-a, klein-x, at, gmail punkt com"  → max@gmail.com
- "F-I-S-C-H-E-R, Doppel-N am Ende"  → fischern (= fischer + n? — frag zurück, Doppel kann am Ende von "Fischer" gemeint sein als zweites N)

Akzeptiere ALLE Wörter (auch Spitznamen, Städte, Phantasie-Begriffe, NATO-Alphabet auf Englisch) — entscheidend ist der erste Buchstabe. Wenn ein Buchstabe akustisch unklar war (Bahn-Geräusch, Verbindung), frag GEZIELT nach: "War das B wie Berlin oder P wie Potsdam?" — verwende dafür die DIN-5009-Wörter unten.

Zur RÜCK-Bestätigung von Adressen/Namen, die du mitgeschrieben hast, nutzt DU das amtliche deutsche Buchstabieralphabet nach DIN 5009 (Stand 2022, Städte-Variante — Behörden-Standard):

A=Aachen · B=Berlin · C=Chemnitz · D=Düsseldorf · E=Essen · F=Frankfurt · G=Goslar · H=Hamburg · I=Ingelheim · J=Jena · K=Köln · L=Leipzig · M=München · N=Nürnberg · O=Offenbach · P=Potsdam · Q=Quickborn · R=Rostock · S=Salzwedel · T=Tübingen · U=Unna · V=Völklingen · W=Wuppertal · X=Xanten · Y=Ypsilon · Z=Zwickau · Ä=Umlaut-A · Ö=Umlaut-O · Ü=Umlaut-U · ß=Eszett

Beispiel-Bestätigung: "Ich wiederhole zur Sicherheit: M wie München, A wie Aachen, X wie Xanten — at-Zeichen — G wie Goslar, M wie München, X wie Xanten — Punkt D wie Düsseldorf E wie Essen. Stimmt das so?"

Wenn der Anrufer nach DEINEM Spelling abweicht ("nein, das X war ein S"), korrigiere und wiederhole NUR das geänderte Stück, nicht die ganze Adresse.`;
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
    const v = await redis.get(`demo_agent:v2:${templateId}`).catch(() => null);
    if (v) return v;
  }
  const cached = inMemDemoAgents.get(templateId);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_SEC * 1000) return cached.agentId;
  return null;
}

async function writeDemoAgent(templateId: string, agentId: string): Promise<void> {
  // H6: Evict oldest entry when hitting the cap.
  if (inMemDemoAgents.size >= MAX_DEMO_AGENTS && !inMemDemoAgents.has(templateId)) {
    const firstKey = inMemDemoAgents.keys().next().value;
    if (firstKey !== undefined) inMemDemoAgents.delete(firstKey);
  }
  inMemDemoAgents.set(templateId, { agentId, createdAt: Date.now() });
  if (redis?.isOpen) await redis.set(`demo_agent:v2:${templateId}`, agentId, { EX: CACHE_TTL_SEC }).catch(() => {});
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
      generalPrompt: template.prompt + DEMO_END_INSTRUCTIONS,
      tools: [DEMO_END_CALL_TOOL],
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
- Wenn der Interessent den Link möchte: Sage, dass der Testlink an die angegebene E-Mail geschickt wurde. Wenn {{signup_sms_sent}} = true ist, sage zusätzlich dass er auch per SMS verschickt wurde. Nenne bei Bedarf diesen Link: {{signup_link}}
`;

// Sales agent ID — Redis-backed (shared across containers, survives restarts)
// In-memory fallback for when Redis is down.
let salesAgentIdMem: string | null = null;
const SALES_AGENT_KEY = 'sales_agent:phonbot:v3';

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
