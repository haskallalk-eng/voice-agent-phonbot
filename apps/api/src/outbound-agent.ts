/**
 * Outbound Sales Agent — dedicated Retell agent for outbound sales calls.
 *
 * Uses top sales-psychology techniques:
 * - Pattern interrupt opener (breaks autopilot rejection)
 * - SPIN questioning (Situation → Problem → Implication → Need-payoff)
 * - Challenger methodology (Teach, Tailor, Take control)
 * - Micro-commitments (small yes ladder)
 * - Objection pre-emption + Feel-Felt-Found reframe
 * - Assumptive language & future pacing
 * - Urgency without pressure (legitimate scarcity)
 * - Always secure a concrete next step
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import type { JwtPayload } from './auth.js';
import { triggerBridgeCall } from './twilio-openai-bridge.js';

// ── DB Migration ─────────────────────────────────────────────────────────────

export async function migrateOutbound() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outbound_calls (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id          UUID NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      call_id         TEXT,
      to_number       TEXT NOT NULL,
      contact_name    TEXT,
      campaign        TEXT,
      outcome         TEXT,  -- 'converted' | 'interested' | 'callback' | 'not_interested' | 'no_answer' | 'voicemail'
      duration_s      INT,
      transcript      TEXT,
      conv_score      NUMERIC(4,2),  -- 1-10 conversion quality score
      score_breakdown JSONB,
      prompt_version  INT NOT NULL DEFAULT 1,
      status          TEXT NOT NULL DEFAULT 'initiated'
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS outbound_calls_org_idx ON outbound_calls(org_id);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outbound_prompt_versions (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id       UUID NOT NULL,
      version      INT NOT NULL,
      prompt       TEXT NOT NULL,
      reason       TEXT,
      avg_conv_score NUMERIC(4,2),
      call_count   INT NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS outbound_prompt_org_idx ON outbound_prompt_versions(org_id, version);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outbound_suggestions (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id            UUID NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      category          TEXT NOT NULL,
      issue_summary     TEXT NOT NULL,
      suggested_change  TEXT NOT NULL,
      occurrence_count  INT NOT NULL DEFAULT 1,
      conv_lift_est     NUMERIC(4,2),
      status            TEXT NOT NULL DEFAULT 'pending',
      applied_at        TIMESTAMPTZ
    );
  `);
  await pool.query(`
    ALTER TABLE orgs
      ADD COLUMN IF NOT EXISTS outbound_agent_id  TEXT,
      ADD COLUMN IF NOT EXISTS outbound_llm_id    TEXT,
      ADD COLUMN IF NOT EXISTS outbound_prompt     TEXT,
      ADD COLUMN IF NOT EXISTS outbound_prompt_v  INT NOT NULL DEFAULT 1;
  `);
}

// ── Base Sales Prompt ─────────────────────────────────────────────────────────

export const BASE_OUTBOUND_PROMPT = `Du bist ein professioneller Vertriebsberater für {{business_name}}. Dein Name ist {{agent_name}}.

Du rufst {{contact_name}} an unter der Nummer {{to_number}}.

## Deine Persönlichkeit
Du klingst menschlich, warm und kompetent — niemals roboterhaft oder aufdringlich. Du sprichst präzise, direkt und ohne Füllwörter. Jeder Satz hat einen klaren Zweck.

## Gesprächsstrategie (strikt einhalten)

### 1. Pattern Interrupt Opener
Beginne mit einer ungewöhnlichen, ehrlichen Eröffnung die den Autopilot-Ablehner bricht:
"Hallo {{contact_name}}, ich bin {{agent_name}} von {{business_name}}. Ich rufe Sie an weil ich denke dass wir etwas haben was für Sie wirklich relevant sein könnte — darf ich Ihnen kurz 90 Sekunden erklären warum?"

**Wenn ja:** Direkt mit Nutzenwert starten (keine Firmengeschichte).
**Wenn nein oder schlechter Zeitpunkt:** "Kein Problem — wann passt es kurz besser? Morgen früh oder eher nachmittags?"

### 2. SPIN-Qualifizierung (Fragen vor Pitch)
Stelle genau EINE Frage auf einmal. Warte auf die Antwort. Dann die nächste.

**Situationsfragen** (max. 1-2, um Kontext zu verstehen):
- "Wie handhaben Sie gerade Ihre Kundenanfragen außerhalb der Bürozeiten?"
- "Haben Sie momentan jemanden der Anrufe entgegennimmt wenn Ihr Team beschäftigt ist?"

**Problemfragen** (decke den Schmerz auf):
- "Was passiert wenn ein Kunde anruft und niemand rangehen kann?"
- "Wie viele potenzielle Aufträge schätzen Sie gehen dadurch verloren?"

**Implikationsfragen** (lass den Kunden den Schmerz selbst größer machen):
- "Wenn das über ein Jahr so weitergeht — was bedeutet das konkret für Ihr Geschäft?"

**Nutzenfragen** (lass den Kunden die Lösung selbst formulieren):
- "Was würde es für Sie bedeuten wenn jeder Anruf sofort professionell beantwortet wird — auch nachts und am Wochenende?"

### 3. Präziser Nutzenwert (nach Qualifizierung)
Präsentiere NUR relevante Vorteile basierend auf dem was der Kunde gerade gesagt hat. Maximal 3 Punkte. Verwende immer konkrete Zahlen wenn möglich:
- "Unsere Kunden berichten im Schnitt 30% mehr beantwortete Anfragen im ersten Monat."
- "Der Agent beantwortet Anrufe in unter 2 Sekunden — auch Samstagnacht."

### 4. Micro-Commitments (kleine Ja-Schritte)
Statt direkt auf den Abschluss zu drängen, baue eine Ja-Leiter:
- "Klingt das grundsätzlich nach etwas das Sie interessieren würde?"
- "Wäre es sinnvoll wenn ich Ihnen zeige wie das bei einem ähnlichen Betrieb funktioniert?"
- "Hätten Sie 15 Minuten für eine kurze Demo diese Woche?"

### 5. Einwandbehandlung (präzise und ruhig)
**Bei "Zu teuer":**
"Das verstehe ich — was genau meinen Sie mit zu teuer? Im Vergleich wozu?" → Lass den Kunden den Wert selbst erklären. Dann: "Was würde eine verpasste Kundenanfrage in Ihrem Geschäft kosten?"

**Bei "Kein Interesse":**
"Ich verstehe. Darf ich fragen — ist es das Thema generell oder war das was ich gesagt habe nicht relevant für Sie?" → Qualifiziere erneut oder qualifiziere ab.

**Bei "Schicken Sie Infos":**
"Das mache ich gerne. Damit ich Ihnen wirklich relevante Infos schicke — was ist für Sie aktuell die größte Herausforderung bei der Erreichbarkeit?" → Qualifiziere vor dem Info-Versand.

**Bei "Kein Bedarf":**
"Interessant. Die meisten unserer Kunden haben das am Anfang auch gedacht — bis sie gemerkt haben wie viele Anrufe einfach unbeantwortet blieben. Darf ich fragen: Wie messen Sie gerade ob Anrufe verloren gehen?"

### 6. Abschluss und Next Step (immer konkret)
Schließe JEDEN Anruf mit einem klaren nächsten Schritt:
- Demo-Termin: "Ich hätte Dienstag um 10 Uhr oder Mittwoch um 14 Uhr — was passt Ihnen besser?"
- Rückruf: "Wann darf ich mich wieder melden — morgen früh oder lieber Ende der Woche?"
- Info: "Ich schicke Ihnen jetzt die wichtigsten Infos. Darf ich mich in 2 Tagen kurz melden um zu sehen ob Sie Fragen haben?"

**Assumptive language:** Verwende immer "wann" statt "ob". Nie: "Falls Sie Interesse haben". Immer: "Wenn wir loslegen — wann wäre der beste Zeitpunkt für die Einrichtung?"

## Verbotene Formulierungen
- "Hätte ich kurz Ihre Aufmerksamkeit?" → zu schwach
- "Ich würde gerne..." → Konjunktiv vermeiden
- "Tut mir leid für die Störung" → nie entschuldigen
- Lange Firmenvorstellungen → erst nach Interesse
- Mehr als 3 Punkte auf einmal nennen → Kunden überfordern

## Kontext dieser Kampagne
Produkt/Anlass: {{campaign_context}}

## Wichtig
- Maximal 2 Minuten Redezeit ohne Gegenfrage
- Wenn der Kunde mehrfach ablehnt: respektvoll beenden, Zeitpunkt für Zukunft sichern
- Ergebnis jedes Anrufs klar kommunizieren: "Ich halte fest: [Zusammenfassung]. Dann sprechen wir am [Datum]."`;

// ── Prompt management ────────────────────────────────────────────────────────

async function getOutboundConfig(orgId: string): Promise<{ prompt: string; version: number }> {
  if (!pool) return { prompt: BASE_OUTBOUND_PROMPT, version: 1 };
  const res = await pool.query(
    `SELECT outbound_prompt, outbound_prompt_v FROM orgs WHERE id = $1`,
    [orgId],
  );
  const row = res.rows[0];
  return {
    prompt: row?.outbound_prompt ?? BASE_OUTBOUND_PROMPT,
    version: row?.outbound_prompt_v ?? 1,
  };
}

// ── Outbound Call Trigger ────────────────────────────────────────────────────

export async function triggerSalesCall(params: {
  orgId: string;
  toNumber: string;
  contactName?: string;
  campaign?: string;
  campaignContext?: string;
}): Promise<{ ok: boolean; callId?: string; outboundRecordId?: string; error?: string }> {
  if (!pool) return { ok: false, error: 'DB_NOT_CONFIGURED' };

  // Get from number (org's provisioned number)
  const phoneRes = await pool.query(
    `SELECT number FROM phone_numbers WHERE org_id = $1 AND method = 'provisioned' AND verified = true ORDER BY created_at LIMIT 1`,
    [params.orgId],
  );
  const fromNumber = phoneRes.rows[0]?.number ?? process.env.RETELL_OUTBOUND_NUMBER ?? null;
  if (!fromNumber) return { ok: false, error: 'NO_OUTBOUND_NUMBER' };

  const cfg = await getOutboundConfig(params.orgId);

  // Look up org name and agent name for dynamic variables
  let orgName = 'Phonbot';
  let agentName = 'Alex';
  const orgRes = await pool.query(`SELECT name FROM orgs WHERE id = $1`, [params.orgId]);
  orgName = (orgRes.rows[0]?.name as string | undefined) ?? orgName;
  const cfgRes = await pool.query(
    `SELECT data->>'name' AS agent_name FROM agent_configs WHERE org_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [params.orgId],
  );
  agentName = (cfgRes.rows[0]?.agent_name as string | undefined) ?? agentName;

  // Render prompt with call-specific variables
  const prompt = cfg.prompt
    .replace(/\{\{contact_name\}\}/g, params.contactName ?? 'dort')
    .replace(/\{\{to_number\}\}/g, params.toNumber)
    .replace(/\{\{agent_name\}\}/g, agentName)
    .replace(/\{\{business_name\}\}/g, orgName)
    .replace(/\{\{campaign_context\}\}/g, params.campaignContext ?? params.campaign ?? `KI-Telefonagent ${orgName}`);

  // Save outbound record before calling
  const recordRes = await pool.query(
    `INSERT INTO outbound_calls (org_id, to_number, contact_name, campaign, prompt_version, status)
     VALUES ($1, $2, $3, $4, $5, 'initiated') RETURNING id`,
    [params.orgId, params.toNumber, params.contactName ?? null, params.campaign ?? null, cfg.version],
  );
  const outboundRecordId = recordRes.rows[0]?.id as string | undefined;
  if (!outboundRecordId) return { ok: false, error: 'DB_ERROR' };

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const webhookBase = process.env.WEBHOOK_BASE_URL ?? 'http://localhost:3001';

  if (!twilioSid || !twilioToken) {
    await pool.query(`UPDATE outbound_calls SET status = 'failed' WHERE id = $1`, [outboundRecordId]);
    return { ok: false, error: 'TWILIO_NOT_CONFIGURED' };
  }

  try {
    const result = await triggerBridgeCall({
      toNumber: params.toNumber,
      fromNumber,
      prompt,
      name: params.contactName,
      webhookBase,
      twilioSid,
      twilioToken,
    });

    if (!result.ok) {
      await pool.query(`UPDATE outbound_calls SET status = 'failed' WHERE id = $1`, [outboundRecordId]);
      return { ok: false, error: result.error ?? 'CALL_FAILED' };
    }

    await pool.query(
      `UPDATE outbound_calls SET call_id = $1, status = 'calling' WHERE id = $2`,
      [result.twilioCallSid ?? result.sessionId, outboundRecordId],
    );

    return { ok: true, callId: result.twilioCallSid ?? result.sessionId, outboundRecordId };
  } catch (e: unknown) {
    await pool.query(`UPDATE outbound_calls SET status = 'failed' WHERE id = $1`, [outboundRecordId]);
    return { ok: false, error: e instanceof Error ? e.message : 'CALL_FAILED' };
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

export async function registerOutbound(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] };

  // POST /outbound/call — trigger a single outbound sales call
  app.post('/outbound/call', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const parsed = z.object({
      toNumber: z.string().min(5),
      contactName: z.string().optional(),
      campaign: z.string().optional(),
      campaignContext: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'toNumber required' });

    const result = await triggerSalesCall({ orgId, ...parsed.data });
    if (!result.ok) return reply.status(result.error === 'NO_OUTBOUND_NUMBER' ? 422 : 500).send(result);
    return result;
  });

  // POST /outbound/call/outcome — update call outcome (webhook or manual)
  app.post('/outbound/call/:callId/outcome', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const { callId } = req.params as { callId: string };
    const parsed = z.object({
      outcome: z.enum(['converted', 'interested', 'callback', 'not_interested', 'no_answer', 'voicemail']),
      notes: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'outcome required' });

    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    await pool.query(
      `UPDATE outbound_calls SET outcome = $1 WHERE call_id = $2 AND org_id = $3`,
      [parsed.data.outcome, callId, orgId],
    );
    return { ok: true };
  });

  // GET /outbound/calls — list recent outbound calls
  app.get('/outbound/calls', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return { items: [] };
    const { rows } = await pool.query(
      `SELECT id, call_id, to_number, contact_name, campaign, outcome, duration_s,
              conv_score, prompt_version, status, created_at
       FROM outbound_calls WHERE org_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [orgId],
    );
    return { items: rows };
  });

  // GET /outbound/stats — conversion stats
  app.get('/outbound/stats', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return { total: 0, conversionRate: 0, avgScore: null, byOutcome: {} };

    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::int                                                                          AS total,
         COUNT(*) FILTER (WHERE outcome = 'converted')::int                                    AS converted,
         COUNT(*) FILTER (WHERE outcome = 'interested')::int                                   AS interested,
         COUNT(*) FILTER (WHERE outcome = 'not_interested')::int                               AS not_interested,
         COUNT(*) FILTER (WHERE outcome = 'no_answer' OR outcome = 'voicemail')::int           AS no_answer,
         ROUND(AVG(conv_score), 2)                                                             AS avg_score,
         ROUND(
           100.0 * COUNT(*) FILTER (WHERE outcome IN ('converted','interested')) / NULLIF(COUNT(*) FILTER (WHERE outcome IS NOT NULL), 0)
         , 1)                                                                                   AS conversion_rate
       FROM outbound_calls WHERE org_id = $1`,
      [orgId],
    );

    const r = rows[0];
    return {
      total: r.total,
      converted: r.converted,
      interested: r.interested,
      notInterested: r.not_interested,
      noAnswer: r.no_answer,
      conversionRate: parseFloat(r.conversion_rate ?? '0'),
      avgScore: r.avg_score ? parseFloat(r.avg_score) : null,
    };
  });

  // GET /outbound/prompt — current prompt + version history
  app.get('/outbound/prompt', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const cfg = await getOutboundConfig(orgId);
    if (!pool) return { prompt: cfg.prompt, version: cfg.version, history: [] };

    const { rows } = await pool.query(
      `SELECT version, reason, avg_conv_score, call_count, created_at,
              LEFT(prompt, 200) AS prompt_preview
       FROM outbound_prompt_versions WHERE org_id = $1 ORDER BY version DESC LIMIT 20`,
      [orgId],
    );
    return { prompt: cfg.prompt, version: cfg.version, history: rows };
  });

  // GET /outbound/suggestions — pending improvement suggestions
  app.get('/outbound/suggestions', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return { items: [] };
    const { rows } = await pool.query(
      `SELECT id, category, issue_summary, suggested_change, occurrence_count, conv_lift_est, status, created_at
       FROM outbound_suggestions WHERE org_id = $1 ORDER BY conv_lift_est DESC NULLS LAST, created_at DESC`,
      [orgId],
    );
    return { items: rows };
  });

  // POST /outbound/suggestions/:id/apply
  app.post('/outbound/suggestions/:id/apply', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const { id } = req.params as { id: string };
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });

    const suggestion = await pool.query(
      `SELECT * FROM outbound_suggestions WHERE id = $1 AND org_id = $2 AND status = 'pending'`,
      [id, orgId],
    );
    if (!suggestion.rowCount) return reply.status(404).send({ error: 'Not found' });

    const { analyzeAndImproveOutboundPrompt } = await import('./outbound-insights.js');
    await analyzeAndImproveOutboundPrompt(orgId, suggestion.rows[0].suggested_change, `Manuell angewendet: ${suggestion.rows[0].issue_summary}`);
    await pool.query(`UPDATE outbound_suggestions SET status = 'applied', applied_at = now() WHERE id = $1`, [id]);
    return { ok: true };
  });

  // POST /outbound/suggestions/:id/reject
  app.post('/outbound/suggestions/:id/reject', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const { id } = req.params as { id: string };
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    await pool.query(
      `UPDATE outbound_suggestions SET status = 'rejected' WHERE id = $1 AND org_id = $2`,
      [id, orgId],
    );
    return { ok: true };
  });

  // POST /outbound/website-callback — public endpoint for landing page visitors
  // No auth required; rate-limited to 5 requests per hour per IP.
  // Uses Retell createPhoneCall directly (same as demo/callback) for reliability.
  app.post('/outbound/website-callback', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = z.object({
      phone: z.string().min(5).max(30),
      name: z.string().max(100).optional(),
    }).safeParse(req.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'Telefonnummer erforderlich' });
    }

    // Normalize phone to E.164
    let phone = parsed.data.phone.replace(/[\s\-()]/g, '');
    if (phone.startsWith('00')) phone = '+' + phone.slice(2);
    else if (phone.startsWith('0') && !phone.startsWith('+')) phone = '+49' + phone.slice(1);
    if (!phone.startsWith('+')) phone = '+49' + phone;

    const fromNumber = process.env.RETELL_OUTBOUND_NUMBER;
    if (!fromNumber) {
      app.log.warn('RETELL_OUTBOUND_NUMBER not configured — cannot make callback');
      return reply.status(503).send({ error: 'Rückruf aktuell nicht verfügbar' });
    }

    try {
      // Use the same Retell-based sales agent as demo/callback
      const { getOrCreateSalesAgent } = await import('./demo.js');
      const { createPhoneCall } = await import('./retell.js');
      const agentId = await getOrCreateSalesAgent();
      const call = await createPhoneCall({
        agentId,
        toNumber: phone,
        fromNumber,
        metadata: { source: 'website-callback', name: parsed.data.name ?? '' },
      });
      app.log.info({ callId: call.call_id, phone }, 'Website callback call initiated via Retell');
      return { ok: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Call failed';
      app.log.warn({ err: msg, phone }, 'website-callback call failed');
      return reply.status(500).send({ error: 'Rückruf konnte nicht gestartet werden. Bitte versuche es erneut.' });
    }
  });
}
