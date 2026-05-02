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

## Pro-aktive Richtungs-Angabe — wenn der Anrufer unsicher ist
Wenn der Anrufer in den ersten 1–2 Turns nicht klar sagt was er will (zögert, "ähm", "weiß nicht", Stille), führe das Gespräch aktiv und biete 3 konkrete Optionen an. Beispiel-Formulierungen je nach Branche:
- Friseur: "Soll ich dir einen Termin buchen, dir kurz erzählen welche Services wir haben, oder hast du eine Frage zu mir und Phonbot?"
- Handwerker: "Geht's um einen neuen Auftrag, eine Frage zu unseren Leistungen, oder zu Phonbot selbst — was passt am besten?"
- Restaurant: "Reservierung, Frage zur Speisekarte, oder zur Demo selbst — wo darf ich anfangen?"
- Selbstständige: "Discovery-Call buchen, kurz Sandras Themen erfragen, oder eine Frage zu Phonbot — was wär für dich gerade interessant?"

Die DRITTE Option ist immer "Frage zu Phonbot / zur Demo" — das öffnet die Meta-Konversation explizit. Das gehört zur Demo-Erfahrung dazu: der Anrufer testet ja auch ob du als KI-Assistent über dich selbst sprechen kannst.

Wenn er eine konkrete Richtung wählt, fokussiere dich darauf. Wenn er meta will (Phonbot, KI, Preise) → siehe Selbstreflexion-Sektion unten.

## Selbstreflexion (Meta-Fragen über dich, Phonbot, KI) — GILT FÜR JEDE BRANCHE
Diese Sektion gilt UNABHÄNGIG davon welche Branchen-Rolle (Friseur, Handwerker, Reinigung, Restaurant, Werkstatt, Selbstständige …) du gerade spielst. Auch wenn dein Branchen-Prompt sagt "Du bist die Telefonassistenz von Demo-Salon" — du bleibst gleichzeitig Chipy, der KI-Telefonassistent von Phonbot, und du KENNST dich.

Du heißt **Chipy** — das ist DEIN Name. NIE sagen "Ich bin ein virtueller Assistent und habe keinen Namen". Wenn der Anrufer dich nach DEINEM Namen fragt, antworte direkt: "Ich heiße Chipy". Wenn er dich um die Buchstabierung bittet: "C wie Chemnitz, H wie Hamburg, I wie Ingelheim, P wie Potsdam, Y wie Ypsilon".

Du bist Chipy — der KI-Telefonassistent von Phonbot. In dieser Demo übernimmst du die Rolle der Telefonassistenz dieses Geschäfts. Wenn der Anrufer DICH oder Phonbot anspricht, antworte ehrlich und kurz, und führ dann sanft zurück zum Demo-Inhalt. Beispiele:
- "Bist du echt?" / "Bist du eine KI?" → "Ja, ich bin Chipy, ein KI-Telefonassistent von Phonbot. Ich klinge wie ein Mensch, bin aber Software. Soll ich dir trotzdem dein Anliegen abnehmen?"
- "Wie heißt du?" → "Ich heiße Chipy."
- "Wie funktioniert das?" → "Phonbot lässt Geschäfte sich von mir am Telefon vertreten — Termine, Tickets, Weiterleitungen. Was zeig ich dir? Einen Termin buchen oder eine Frage zum Service?"
- "Was kostet Phonbot?" / "Wie buche ich das?" → "Die Preise und der kostenlose Test-Account stehen auf phonbot.de. Hier in der Demo zeig ich dir lieber LIVE wie ich für dieses Geschäft arbeite."
- "Wer hat dich gebaut?" → "Phonbot ist von Mindrails. Mehr dazu auf phonbot.de. Soll ich dir lieber direkt zeigen wie ich dich am Telefon entlasten kann?"

**Regel:** Maximal 1–2 Meta-Antworten pro Anruf, dann sanft zurück zur Demo-Aufgabe. Wenn der Anrufer ausschließlich Meta-Fragen stellt und die Demo nicht ausprobieren will, sag nach der zweiten: "Cool dass dich das interessiert — alle Details auf phonbot.de. Ich bin gleich wieder im Service-Modus, falls du die Demo ausprobieren willst." und ruf bei klarer Verabschiedung \`end_call\` auf.

## Kontakt-Daten in dieser Demo erheben (Pflicht-Trio)
Wenn das Gespräch zu einem Termin, Rückruf, Angebot oder Ticket führt, erfrage IMMER drei Daten in dieser Reihenfolge: 1) Name, 2) Mobil- oder Festnetznummer, 3) E-Mail-Adresse. Beide Kontaktwege werden gebraucht: die Nummer für SMS-Bestätigung, die E-Mail für Termin-Einladung. Wiederhole die Telefonnummer in Zweier- oder Dreier-Blöcken zur Kontrolle. Erst nachdem alle drei sauber bestätigt sind, sag "Alles klar, ich hab's eingetragen" — vorher nicht.

## Phonbot-Testlink aktiv anbieten (am Ende des Calls)
Bevor du dich verabschiedest und den Call beendest: frag den Anrufer EINMAL natürlich, ob er den Phonbot-Testlink bekommen will. Beispiel: "Übrigens — falls du Phonbot selbst ausprobieren willst, schick ich dir gerne den kostenlosen Testlink per Mail oder SMS. Magst du den haben?"

- Wenn JA: bestätige kurz ("Klar, schick ich dir gleich an [Email]") — KEIN nochmaliges Abfragen wenn die Email bereits vorliegt. Wenn die Email fehlt, frag sie EXPLIZIT ab.
- Wenn NEIN / ablehnt: kein Drama, "Alles gut. Trotzdem viel Erfolg!" — und Verabschiedung.
- Wenn der Anrufer nicht von selbst nach Phonbot-Infos fragt UND die Demo gut lief: trotzdem EINMAL anbieten — aber nicht aufdringlich, nicht zwei Mal nachhaken.

Das System sendet die Mail/SMS post-Call NUR wenn die Post-Call-Analyse \`wants_signup_link = "ja"\` extrahiert. Wenn du die Frage nie gestellt hast oder der Anrufer nichts dazu gesagt hat: bleibt es bei "nein" → kein Versand. Visitor kriegt NIE unsolicited mail.

## Fähigkeiten dieser Demo
Du verhältst dich genau wie der Live-Agent dieses Geschäfts: Termine vorschlagen + buchen, Tickets erfassen, weiterleiten falls nötig. Wenn ein Anliegen über das hinausgeht, was du in der Demo simulieren kannst (echte Verfügbarkeit, echter Preis, Status eines bestehenden Auftrags), kündige eine Weiterleitung an und beende den Anruf — siehe Plattform-Baseline.

## Kritische Tool-Disziplin (FATALER Fehler-Typ)
Wenn du den Anruf beenden willst, **RUF DAS TOOL \`end_call\` AUF — sage es NICHT als Wort**. Du darfst NIEMALS "{end_call}", "end_call", "ich beende jetzt das Tool" oder ähnliches Wortwörtliches sagen. Tool-Namen sind interne Funktionen, keine Sprechtexte. Genauso bei \`transfer_call\`, \`calendar.book\`, \`ticket.create\` etc. — RUF sie AUF, sage sie nicht.

Falsch: Agent sagt: "Tschüss! {end_call}" → der Call läuft weiter, Anrufer hört "öffnende geschweifte Klammer end underscore call schließende geschweifte Klammer".
Richtig: Agent sagt: "Tschüss!" UND ruft danach im selben Turn die Funktion \`end_call\` auf.

Wenn der Anrufer dich KORRIGIERT ("du sollst end_call ausführen, nicht sagen") — entschuldige dich kurz, sag den Verabschiedungssatz EINMAL klar, und ruf das Tool auf. NICHT nochmal entschuldigen-und-trotzdem-sprechen.

## Slot-Auswahl explizit bestätigen
Wenn du dem Anrufer ZWEI oder MEHR Termin-Optionen vorschlägst ("Donnerstag 10 Uhr oder Freitag 15 Uhr") und er bestätigt knapp ("ja, passt", "okay, gerne"), darfst du NIE einfach mit "super, eingetragen" weitermachen — das ist ambig: WELCHEN Termin meinte er? Frag IMMER zurück: "Welchen der beiden — Donnerstag 10 Uhr oder Freitag 15 Uhr?" und warte auf eine eindeutige Antwort.

Erst wenn der konkrete Slot eindeutig bestätigt ist, weiterführen. "Eindeutig" heißt: der Anrufer hat den Tag/Uhrzeit explizit wiederholt oder per "der erste/zweite/letzte" auf eine deiner Optionen gezeigt.`;

// Retell post-call analysis — fields the model extracts from the transcript
// after the call ends. Sent to /retell/webhook in the call_analysis event,
// then persisted on the demo_calls row so admins can scan + promote leads.
const DEMO_POST_CALL_FIELDS: PostCallAnalysisField[] = [
  { type: 'string', name: 'caller_name', description: 'Vollständiger Name des Anrufers, falls genannt. Nur Vorname OK. Leer lassen wenn nicht erwähnt.' },
  { type: 'string', name: 'caller_email', description: 'E-Mail-Adresse des Anrufers in lowercase und voll validiert (max@gmx.de). Leer wenn nicht genannt.' },
  { type: 'string', name: 'caller_phone', description: 'Telefonnummer des Anrufers in E.164-Format (+49…). Leer wenn nicht genannt.' },
  { type: 'string', name: 'intent_summary', description: 'Ein-Satz-Zusammenfassung des Anliegens auf Deutsch (max. 140 Zeichen). Was wollte der Anrufer?' },
  // wants_signup_link drives post-call email/SMS in retell-webhooks.ts
  // (maybeSendDemoSignupLink). Only "ja" triggers a send — "nein" or "unklar"
  // remains opt-out by default. Visitor never gets unsolicited mail.
  { type: 'enum', name: 'wants_signup_link', description: 'Hat der Anrufer am Ende EXPLIZIT bestätigt dass er den Phonbot-Testlink per E-Mail / SMS bekommen will? "ja" nur wenn Chipy gefragt hat UND der Anrufer klar zugestimmt hat. "nein" wenn Anrufer ablehnt oder nichts dazu gesagt hat. "unklar" nur wenn das Gespräch abrupt endete (z.B. Verbindung weg).', choices: ['ja', 'nein', 'unklar'] },
];

import { pool } from './db.js';
import { redis } from './redis.js';
import { log } from './logger.js';
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
    const v = await redis.get(`demo_agent:v9:${templateId}`).catch(() => null);
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
      redis.set(`demo_agent:v9:${templateId}`, agentId, { EX: CACHE_TTL_SEC }).catch(() => {}),
      // Reverse direction: webhook sees agent_id, needs templateId. Same TTL.
      redis.set(`demo_agent_meta:v9:${agentId}`, templateId, { EX: CACHE_TTL_SEC }).catch(() => {}),
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
    ).catch((err: Error) => {
      // Audit-Round-10 MEDIUM: don't silent-swallow per CLAUDE.md §13. Redis
      // still serves the fast-path so this is non-critical, but if the DB
      // backstop is broken we want Ops to see it before a Redis flush takes
      // out the lookup.
      log.warn({ err: err.message, agentId, templateId }, 'demo_agent_templates insert failed (non-critical, Redis still authoritative)');
    });
  }
}

/**
 * Post-call send of the Phonbot signup link to a demo-call visitor.
 *
 * Trigger: retell-webhooks call_analyzed (and call_ended for short calls
 * where analysis is already attached) sees demo extraction with
 * `wants_signup_link === 'ja'` AND a caller_email/caller_phone. Calls this.
 *
 * Dedup: atomic UPDATE-RETURNING on demo_calls.signup_link_*_sent_at — a
 * webhook retry sees the timestamp set and the WHERE clause filters out the
 * row. No double sends. On send failure, the timestamp is rolled back so a
 * later retry can re-attempt.
 *
 * Privacy: only sends when caller EXPLICITLY agreed during the call (post-
 * call analysis returns "ja", not "nein" or "unklar"). Default = no send.
 */
export async function maybeSendDemoSignupLink(
  callId: string,
  extracted: Record<string, unknown>,
  logger: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void },
): Promise<void> {
  if (!pool) return;
  const wantsRaw = (extracted.wants_signup_link as string | undefined)?.toLowerCase().trim() ?? '';
  if (wantsRaw !== 'ja' && wantsRaw !== 'yes') {
    return; // explicit opt-in only — never send on "nein"/"unklar"/missing
  }
  const email = (extracted.caller_email as string | undefined)?.trim().toLowerCase() || null;
  const phone = (extracted.caller_phone as string | undefined)?.trim() || null;
  const name = (extracted.caller_name as string | undefined)?.trim() || null;

  if (email) {
    const claim = await pool.query(
      `UPDATE demo_calls SET signup_link_email_sent_at = now()
       WHERE call_id = $1 AND signup_link_email_sent_at IS NULL
       RETURNING call_id`,
      [callId],
    ).catch((err: Error) => {
      logger.warn({ err: err.message, callId }, 'demo signup-link claim (email) DB error');
      return null;
    });
    if (claim?.rowCount) {
      sendSignupLinkEmail({ toEmail: email, name }).then((res) => {
        if (!res.ok) {
          logger.warn({ err: res.error, callId, kind: 'demo_signup_link', channel: 'email' }, 'demo signup-link email send failed');
          // roll back claim so a future webhook retry can re-attempt
          pool!.query(`UPDATE demo_calls SET signup_link_email_sent_at = NULL WHERE call_id = $1`, [callId]).catch(() => { /* best-effort */ });
        } else {
          logger.info({ callId, kind: 'demo_signup_link', channel: 'email' }, 'demo signup-link email sent');
        }
      }).catch((err: Error) => logger.warn({ err: err.message, callId }, 'demo signup-link email threw'));
    }
  }

  if (phone) {
    const claim = await pool.query(
      `UPDATE demo_calls SET signup_link_sms_sent_at = now()
       WHERE call_id = $1 AND signup_link_sms_sent_at IS NULL
       RETURNING call_id`,
      [callId],
    ).catch((err: Error) => {
      logger.warn({ err: err.message, callId }, 'demo signup-link claim (sms) DB error');
      return null;
    });
    if (claim?.rowCount) {
      sendSignupLinkSms({ to: phone, name, logger }).then((res) => {
        if (!res.ok) {
          logger.warn({ err: res.error, callId, kind: 'demo_signup_link', channel: 'sms' }, 'demo signup-link SMS send failed');
          pool!.query(`UPDATE demo_calls SET signup_link_sms_sent_at = NULL WHERE call_id = $1`, [callId]).catch(() => { /* best-effort */ });
        } else {
          logger.info({ callId, kind: 'demo_signup_link', channel: 'sms' }, 'demo signup-link SMS sent');
        }
      }).catch((err: Error) => logger.warn({ err: err.message, callId }, 'demo signup-link SMS threw'));
    }
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
    const v = await redis.get(`demo_agent_meta:v9:${agentId}`).catch(() => null);
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
      // Clean up previous versions on the way past.
      await redis.del(['sales_agent:phonbot:v3', 'sales_agent:phonbot:v4', 'sales_agent:phonbot:v5', 'sales_agent:phonbot:v6', 'sales_agent:phonbot:v7', 'sales_agent:phonbot:v8']).catch(() => {});
    } catch {
      /* non-critical */
    }
    // Include older versioned keys in the scan so a deploy that bumps the
    // cache key cleans up its own predecessors. Cheap — Redis SCAN is O(N)
    // total across all keys, not O(N) per pattern.
    // Audit-Round-10 MEDIUM: batch DEL statt N sequenzieller RTTs. Bei 200
    // gecachten Demo-Agents waren das vorher 200 Redis-Roundtrips (~100 ms
    // bei LAN, sekundenlang bei Cross-Region). Jetzt 1 RTT pro 100 Keys.
    // Local `r` capture so the closure's type-narrowing survives.
    const r = redis;
    for (const pattern of [
      'demo_agent:v9:*', 'demo_agent_meta:v9:*',
      'demo_agent:v8:*', 'demo_agent_meta:v8:*',
      'demo_agent:v7:*', 'demo_agent_meta:v7:*',
      'demo_agent:v6:*', 'demo_agent_meta:v6:*',
      'demo_agent:v5:*', 'demo_agent_meta:v5:*',
      'demo_agent:v4:*', 'demo_agent_meta:v4:*',
      'demo_agent:v3:*', 'demo_agent_meta:v3:*',
    ]) {
      try {
        const batch: string[] = [];
        const drain = async () => {
          if (!batch.length) return;
          await r.del(batch);
          flushed += batch.length;
          batch.length = 0;
        };
        for await (const key of r.scanIterator({ MATCH: pattern, COUNT: 100 })) {
          if (Array.isArray(key)) batch.push(...key);
          else batch.push(key);
          if (batch.length >= 100) await drain();
        }
        await drain();
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
  // Audit-Round-10 BLOCKER 2: reserve the in-flight slot SYNCHRONOUSLY before
  // any await. The previous order (cache-check → in-flight-check → IIFE → set)
  // had a window where two parallel callers both passed the cache miss, both
  // saw an empty in-flight map, and both created a fresh IIFE → 2× Retell-
  // Agent. Set + get on Map are synchronous, so checking + reserving in the
  // same micro-task makes this race-free per-container.
  const existing = pendingDemoCreate.get(templateId);
  if (existing) return existing;

  let resolveClaim!: (v: string) => void;
  let rejectClaim!: (e: unknown) => void;
  const claim = new Promise<string>((resolve, reject) => {
    resolveClaim = resolve;
    rejectClaim = reject;
  });
  // Audit-Round-11 (Codex post-fix concern): the first caller does NOT await
  // `claim` — they run the creation work inline and resolve/reject the claim
  // for any concurrent second callers. If creation fails and no second caller
  // arrived, the rejected `claim` is observerless → Node emits an unhandled-
  // rejection warning, and on `--unhandled-rejections=strict` (or future
  // Node defaults) it crashes the process. The no-op `.catch` adds a silent
  // observer that does NOT swallow the original error: the first caller's
  // try/catch still re-throws to its own caller.
  claim.catch(() => { /* observer for second-caller-absent case */ });
  pendingDemoCreate.set(templateId, claim);

  try {
    // Cache-check happens AFTER reserving the slot. Any caller arriving during
    // the cache-lookup or downstream creation already sees `claim` and waits.
    const cached = await readDemoAgent(templateId);
    if (cached) { resolveClaim(cached); return cached; }

    const template = TEMPLATES.find((t) => t.id === templateId);
    if (!template) throw new Error('Unknown template');

    // Three-layer prompt for demo agents:
    //   1. Platform-Baseline — admin-editable, applies to every Phonbot agent
    //      (paid customers + demos). Quality floor: spelling, end-call,
    //      promise-discipline. Lives in platform-baseline.ts + DB override.
    //   2. Branche-prompt — per-template (Friseur/Handwerker/…), admin can
    //      override individually via demo_prompt_overrides.
    //   3. Demo-addendum — admin-editable, applies only to demos. Demo-mode
    //      disclaimer, contact-trio, simulation note.
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
    const webhookBase = process.env.WEBHOOK_BASE_URL?.replace(/\/$/, '');
    const agent = await retellCreateAgent({
      name: `Demo: ${template.name}`,
      llmId: llm.llm_id,
      voiceId: template.voice,
      language: template.language === 'de' ? 'de-DE' : 'en-US',
      // Demo-only: Sensitivity runter von 1.0 (default) auf 0.5. Web-Demos
      // laufen auf wechselnder Audio-Qualität (Laptop-Mics, Hintergrund), wo
      // 1.0 zu Fehl-Interruptions führte — Anrufer fängt zu sprechen an, Agent
      // hält kurz für ein Räuspern oder Tipp-Geräusch und wirkt zappelig.
      // Paid-Customers behalten ihre eigene Tuning-Konfig (updateAgent setzt
      // sensitivity nur explizit, nie als Side-Effect).
      interruptionSensitivity: 0.5,
      webhookUrl: webhookBase ? `${webhookBase}/retell/webhook` : undefined,
      postCallAnalysisData: DEMO_POST_CALL_FIELDS,
    });

    await writeDemoAgent(templateId, agent.agent_id);
    resolveClaim(agent.agent_id);
    return agent.agent_id;
  } catch (err) {
    rejectClaim(err);
    throw err;
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

DEIN NAME ist **Chipy**. Wenn der Anrufer dich nach DEINEM Namen fragt: "Ich heiße Chipy". NIE "ich habe keinen Namen" oder "ich bin nur ein virtueller Assistent". Buchstabierung deines Namens: "C wie Chemnitz, H wie Hamburg, I wie Ingelheim, P wie Potsdam, Y wie Ypsilon".

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
- **Bei "Möchtest du..."-Fragen NIE doppelt nachhaken**: wenn der Anrufer "nein" / "vielleicht später" / abweisend sagt, akzeptiere es sofort und führ das Gespräch weiter. Maximal 1× sanft erinnern, NIE drücken.
- **Anti-Repetition**: wenn der Anrufer schon eine Information gegeben hat (Branche, Anrufzahl, Kontaktdaten), frag NICHT nochmal danach. Halte intern fest was er gesagt hat und arbeite damit weiter. Bei akustischen Unklarheiten frag SPEZIFISCH ("Habe ich das richtig: VW Golf?") statt die Slot-Frage zu wiederholen.
- **Mehrere Optionen → explizite Bestätigung**: bei zwei vorgeschlagenen Slots / Plänen / Branchen-Beispielen NIE bei "ja, passt" einfach "super" sagen — frag immer "welcher der beiden?" zurück.
- Wenn der Interessent den Link möchte: Sage, dass der Testlink an die angegebene E-Mail geschickt wurde. Wenn {{signup_sms_sent}} = true ist, sage zusätzlich dass er auch per SMS verschickt wurde. Nenne bei Bedarf diesen Link: {{signup_link}}
`;

// Read admin-edited Sales prompt if set, otherwise the compiled-in default.
// Audit-Round-11 LOW (Codex F-05): 5-min in-process cache. Mirrors the
// pattern in platform-baseline / outbound-baseline. Bust on admin write
// via bustSalesPromptCache() (called from the PUT/restore handlers, same
// places that flush demo + outbound caches).
let _salesPromptCache: { value: string; loadedAt: number } | null = null;
const SALES_PROMPT_TTL_MS = 5 * 60 * 1000;
export function bustSalesPromptCache() { _salesPromptCache = null; }

async function loadSalesPrompt(): Promise<string> {
  const now = Date.now();
  if (_salesPromptCache && now - _salesPromptCache.loadedAt < SALES_PROMPT_TTL_MS) {
    return _salesPromptCache.value;
  }
  if (!pool) {
    _salesPromptCache = { value: DEFAULT_SALES_PROMPT, loadedAt: now };
    return DEFAULT_SALES_PROMPT;
  }
  const res = await pool.query(
    `SELECT epilogue FROM demo_prompt_overrides WHERE template_id = '__sales__'`,
  ).catch(() => null);
  let value = DEFAULT_SALES_PROMPT;
  if (res && res.rowCount) {
    const stored = res.rows[0].epilogue as string;
    if (stored && stored.trim()) value = stored;
  }
  _salesPromptCache = { value, loadedAt: now };
  return value;
}

// Sales agent ID — Redis-backed (shared across containers, survives restarts)
// In-memory fallback for when Redis is down. Cache key bumps to v9 because
// platform-baseline gained Date/Time-Awareness (with {{current_*}} dynamic
// variables), Empathy + Frust-Erkennung, Single-Question-Disziplin,
// Konversations-Ton, Out-of-Scope-with-Alternative, and Confidence-Honesty
// (anti-hallucination). Web-call + sales-call now inject current_date_de /
// current_weekday_de / current_time_de via retell_llm_dynamic_variables.
let salesAgentIdMem: string | null = null;
const SALES_AGENT_KEY = 'sales_agent:phonbot:v9';
let pendingSalesCreate: Promise<string> | null = null;

export async function getOrCreateSalesAgent(): Promise<string> {
  // Audit-Round-11 MED (Codex): mirror the demo-agent dedup. Without this,
  // two parallel callbacks racing on a cold cache both miss Redis, both
  // create a fresh sales LLM + Retell-Agent, and the loser becomes orphan
  // spend. A single in-flight Promise (sales agent is global, so no key
  // map) is enough: synchronously check + assign before any await.
  if (pendingSalesCreate) return pendingSalesCreate;

  let resolveClaim!: (v: string) => void;
  let rejectClaim!: (e: unknown) => void;
  const claim = new Promise<string>((resolve, reject) => {
    resolveClaim = resolve;
    rejectClaim = reject;
  });
  // Same observerless-rejection guard as getOrCreateDemoAgent.
  claim.catch(() => { /* observer for second-caller-absent case */ });
  pendingSalesCreate = claim;

  try {
    if (redis?.isOpen) {
      const cached = await redis.get(SALES_AGENT_KEY).catch(() => null);
      if (cached) { resolveClaim(cached); return cached; }
      // Audit-Round-9 H1/M3: do NOT write back into salesAgentIdMem here.
      // The in-mem fallback is only for Redis-offline mode; a fresh Redis
      // read during a concurrent flushDemoAgentCache() could otherwise re-
      // populate the in-mem with the soon-to-be-deleted value, leaving a
      // stale value that surfaces if Redis later goes offline.
    } else if (salesAgentIdMem) {
      resolveClaim(salesAgentIdMem);
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
      // Sales-Callback ruft Leute an die einen Rückruf angefragt haben — die
      // sind beim ersten "Hallo?" oft zögerlich, hören kurz hin, fragen "wer
      // ist da?". Bei interruption_sensitivity=1.0 unterbricht Chipy seinen
      // eigenen Pitch wegen jedem "äh" → wirkt nervös. 0.5 lässt den Pitch
      // sauber durchlaufen.
      interruptionSensitivity: 0.5,
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

    resolveClaim(agent.agent_id);
    return agent.agent_id;
  } catch (err) {
    rejectClaim(err);
    throw err;
  } finally {
    pendingSalesCreate = null;
  }
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
      // Inject current date/time as dynamic variables — the LLM can't know
      // "today" otherwise and would hallucinate "tomorrow Donnerstag" in the
      // wrong week. Retell substitutes {{current_*}} placeholders in the
      // compiled prompt at call-start.
      const now = new Date();
      const berlinFmt = new Intl.DateTimeFormat('de-DE', {
        timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      });
      const timeFmt = new Intl.DateTimeFormat('de-DE', {
        timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit',
      });
      const isoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(now);
      const weekdayDe = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long' }).format(now);
      const call = await createWebCall(agentId, {
        dynamicVariables: {
          current_date_de: berlinFmt.format(now),     // "Freitag, 02. Mai 2026"
          current_date_iso: isoDate,                   // "2026-05-02"
          current_weekday_de: weekdayDe,               // "Freitag"
          current_time_de: timeFmt.format(now),        // "14:30"
        },
      });
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
        // Surface Resend errors via Pino — silent fire-and-forget hid from-
        // address-not-verified / bounce / rate-limit failures and the user
        // never got the link they asked for.
        sendSignupLinkEmail({ toEmail: email, name })
          .then((res) => {
            if (!res.ok) app.log.warn({ err: res.error, kind: 'signup_link', branch: 'dedup' }, 'demo/callback signup-link email failed');
            else app.log.info({ kind: 'signup_link', branch: 'dedup' }, 'demo/callback signup-link email sent');
          })
          .catch((err: Error) => app.log.warn({ err: err.message, kind: 'signup_link', branch: 'dedup' }, 'demo/callback signup-link email threw'));
        const sms = await sendSignupLinkSms({ to: phone, name, logger: app.log });
        return { ok: true, smsSent: sms.ok };
      }
    }

    // Audit-Round-11 BLOCKER (Codex): persist the lead and use its DB id as
    // the correlation key for both the Retell metadata AND the post-call
    // UPDATE. Previously a fire-and-forget INSERT was followed by an
    // UPDATE matching on (email, phone, status='new'), which could touch
    // multiple rows (old uncontacted leads outside the 24h dedup window) —
    // and the random `leadId` we sent to Retell was never persisted at all.
    // DSGVO Art. 5: leads are auto-deleted after 90 days by cleanupOldLeads() in db.ts
    let leadId: string | null = null;
    if (pool) {
      try {
        const ins = await pool.query(
          `INSERT INTO crm_leads (name, email, phone, source, status) VALUES ($1, $2, $3, 'demo-callback', 'new') RETURNING id`,
          [name, email, phone],
        );
        leadId = (ins.rows[0]?.id as string) ?? null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        app.log.warn({ err: msg }, 'crm_leads insert failed');
      }
    }
    app.log.info({ leadId, name, email, phone }, 'New demo callback lead');

    sendSignupLinkEmail({ toEmail: email, name })
      .then((res) => {
        if (!res.ok) app.log.warn({ err: res.error, kind: 'signup_link', branch: 'main', leadId }, 'demo/callback signup-link email failed');
        else app.log.info({ kind: 'signup_link', branch: 'main', leadId }, 'demo/callback signup-link email sent');
      })
      .catch((err: Error) => app.log.warn({ err: err.message, kind: 'signup_link', branch: 'main', leadId }, 'demo/callback signup-link email threw'));
    const signupSms = await sendSignupLinkSms({ to: phone, name, logger: app.log });

    // Try outbound call via Retell.
    // Audit-Round-12 P3 (review-pass security agent): if pool is configured
    // but the lead INSERT failed, the outbound call would otherwise create
    // a Retell call we cannot anchor to a DB lead — DSGVO Art. 5(1)(e)
    // (storage limitation) + Art. 17 (right to erasure) require us to be
    // able to delete every personal data trace via cleanupOldLeads().
    // Without a leadId there's no DB hook for that. Skip the call.
    const fromNumber = process.env.RETELL_OUTBOUND_NUMBER; // e.g. "+4930123456"
    const canCall = fromNumber && (!pool || leadId);
    if (fromNumber && pool && !leadId) {
      app.log.warn({ phone }, 'demo/callback: skipping outbound call because lead INSERT failed (DSGVO untracked-call guard)');
    }
    if (canCall) {
      try {
        const agentId = await getOrCreateSalesAgent();
        const metadata: Record<string, string> = { leadName: name };
        if (leadId) metadata.leadId = leadId;
        const call = await createPhoneCall({
          agentId,
          toNumber: phone,
          fromNumber,
          metadata,
          dynamicVariables: {
            signup_link: signupLinkUrl(),
            signup_sms_sent: signupSms.ok ? 'true' : 'false',
            // Same date/time injection as web demo — without these the agent
            // hallucinates which day "morgen" means and books wrong slots.
            current_date_de: new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date()),
            current_date_iso: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date()),
            current_weekday_de: new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long' }).format(new Date()),
            current_time_de: new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(new Date()),
          },
        });
        app.log.info({ callId: call.call_id, phone, leadId }, 'Outbound sales call initiated');
        // Mark lead as called — by id, never by (email,phone,status)
        if (pool && leadId) {
          pool.query(
            `UPDATE crm_leads SET status = 'contacted', call_id = $1 WHERE id = $2`,
            [call.call_id, leadId],
          ).catch((err: Error) => app.log.warn({ err: err.message, leadId }, 'crm_leads contacted-update failed'));
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'unknown error';
        app.log.warn({ err: msg, phone }, 'Outbound call failed');
      }
    } else if (!fromNumber) {
      app.log.warn('RETELL_OUTBOUND_NUMBER not configured — skipping outbound call');
    }

    return { ok: true, message: 'Chipy ruft dich bald an! Wir haben deine Nummer gespeichert.', smsSent: signupSms.ok };
  });

  // Note: /demo/leads was removed — use /admin/leads instead (platform-admin only, reads from crm_leads DB).
}
