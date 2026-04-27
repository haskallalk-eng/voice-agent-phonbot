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
import { verifyTurnstile } from './captcha.js';
import { sendSignupLinkEmail } from './email.js';
import { sendSignupLinkSms, signupLinkUrl } from './sms.js';

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
  // Website/demo callbacks are platform-level leads before signup, so org_id
  // must be nullable for those anonymous outbound calls.
  await pool.query(`ALTER TABLE outbound_calls ALTER COLUMN org_id DROP NOT NULL`).catch(() => {});
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
  // Partial UNIQUE for the atomic ON CONFLICT upsert in upsertSuggestion().
  // Scoped to pending rows so applied/rejected suggestions with the same text
  // can coexist as historical records.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS outbound_suggestions_pending_unique
      ON outbound_suggestions (org_id, issue_summary) WHERE status = 'pending';
  `);
  await pool.query(`
    ALTER TABLE orgs
      ADD COLUMN IF NOT EXISTS outbound_agent_id  TEXT,
      ADD COLUMN IF NOT EXISTS outbound_llm_id    TEXT,
      ADD COLUMN IF NOT EXISTS outbound_prompt     TEXT,
      ADD COLUMN IF NOT EXISTS outbound_prompt_v  INT NOT NULL DEFAULT 1;
  `);

  // CRM Leads table
  // DSGVO Art. 5: leads auto-deleted after 90 days by cleanupOldLeads() in db.ts
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_leads (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      name          TEXT,
      email         TEXT NOT NULL,
      phone         TEXT,
      source        TEXT NOT NULL DEFAULT 'website-callback',
      status        TEXT NOT NULL DEFAULT 'new',
      notes         TEXT,
      call_id       TEXT,
      converted_at  TIMESTAMPTZ
    );
  `);
  await pool.query(`COMMENT ON TABLE crm_leads IS 'DSGVO Art. 5: 90-day retention policy. Rows older than 90 days are purged daily by cleanupOldLeads().';`);

  // Demo-Web-Call persistence — every Retell call_ended on a /demo/call agent
  // lands here so platform admins can review what visitors discussed and
  // promote useful conversations into crm_leads. Standalone table (not
  // crm_leads) because demo calls have no email constraint and are noisier
  // (hang-ups, test pings). Same 90-day retention as crm_leads.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS demo_calls (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      call_id             TEXT NOT NULL UNIQUE,
      agent_id            TEXT,
      template_id         TEXT NOT NULL,
      duration_sec        INTEGER,
      transcript          TEXT,
      caller_name         TEXT,
      caller_email        TEXT,
      caller_phone        TEXT,
      intent_summary      TEXT,
      disconnection_reason TEXT,
      promoted_lead_id    UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
      promoted_at         TIMESTAMPTZ
    );
  `);
  await pool.query(`COMMENT ON TABLE demo_calls IS 'DSGVO Art. 5: 90-day retention policy. Rows purged daily by cleanupOldLeads().';`);
  await pool.query(`CREATE INDEX IF NOT EXISTS demo_calls_template_created_idx ON demo_calls(template_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS demo_calls_promoted_idx ON demo_calls(promoted_at) WHERE promoted_at IS NULL;`);

  // Demo system-prompt overrides — admin-editable epilogue per template, plus
  // a "global" row (template_id=NULL) for the cross-template DEMO_END_INSTRUCTIONS
  // suffix. Demo agents pick up the override on next cache-miss / admin-trigger.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS demo_prompt_overrides (
      template_id   TEXT PRIMARY KEY,
      epilogue      TEXT NOT NULL,
      base_prompt   TEXT,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by    TEXT
    );
  `);
  await pool.query(`COMMENT ON TABLE demo_prompt_overrides IS 'Admin-editable demo prompt fragments. template_id=__global__ stores the cross-template epilogue. base_prompt overrides templates.ts when set.';`);

  // Append-only history of every prompt override edit. demo_prompt_overrides
  // only carries the latest state; without this table the admin has no way to
  // see previous versions or roll back. Insert happens in the PUT handler
  // BEFORE the upsert so the prior state is captured on every change.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prompt_override_history (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      template_id   TEXT NOT NULL,
      epilogue      TEXT,
      base_prompt   TEXT,
      changed_by    TEXT,
      change_kind   TEXT NOT NULL CHECK (change_kind IN ('edit', 'revert'))
    );
  `);
  await pool.query(`COMMENT ON TABLE prompt_override_history IS 'Append-only history of demo_prompt_overrides edits. DSGVO Art. 5(1)(e): 365-day retention via cleanupOldLeads().';`);
  await pool.query(`CREATE INDEX IF NOT EXISTS prompt_override_history_template_idx ON prompt_override_history(template_id, created_at DESC);`);

  // Learning-improvement decisions — extends the existing prompt_suggestions /
  // template_learnings flow with an admin-controlled `scope` field. Each row
  // links to the source improvement and records whether the admin decided it
  // should ship to (a) one org only, (b) the system globally, or (c) both.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS learning_decisions (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_at        TIMESTAMPTZ,
      decided_by        TEXT,
      source_kind       TEXT NOT NULL CHECK (source_kind IN ('prompt_suggestion', 'template_learning')),
      source_id         UUID NOT NULL,
      org_id            UUID,
      template_id       TEXT,
      scope             TEXT CHECK (scope IN ('systemic', 'org', 'both')),
      status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected')),
      summary           TEXT,
      proposed_change   TEXT NOT NULL,
      reject_reason     TEXT
    );
  `);
  await pool.query(`COMMENT ON TABLE learning_decisions IS 'Admin queue for learning improvements. Each row = one decision (apply scope=systemic|org|both, or reject). DSGVO Art. 5(1)(e): 365-day retention via cleanupOldLeads().';`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS learning_decisions_source_uniq ON learning_decisions(source_kind, source_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS learning_decisions_status_idx ON learning_decisions(status, created_at DESC);`);

  // Meta-Lernen: when an admin applies a learning suggestion in CORRECTED form
  // (not as the system proposed it), we keep the (original, corrected, reason)
  // tuple here. These rows are the training data for the next iteration of the
  // suggestion-generator — the learning system learns from being corrected.
  // Admin-only feed; never surfaced to customers.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS learning_corrections (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      source_kind         TEXT NOT NULL,
      source_id           UUID NOT NULL,
      summary             TEXT,
      original_text       TEXT NOT NULL,
      corrected_text      TEXT NOT NULL,
      correction_reason   TEXT,
      scope_applied       TEXT,
      applied_by          TEXT,
      used_for_meta_at    TIMESTAMPTZ
    );
  `);
  await pool.query(`COMMENT ON TABLE learning_corrections IS 'Meta-Lernen: admin-Korrekturen an Lern-Vorschlägen. Speist die nächste Generation des Suggestion-Generators. DSGVO Art. 5(1)(e): 365-day retention via cleanupOldLeads(). original_text kann Anruf-Zitate enthalten, daher PII-relevant.';`);
  await pool.query(`CREATE INDEX IF NOT EXISTS learning_corrections_created_idx ON learning_corrections(created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS learning_corrections_source_idx ON learning_corrections(source_kind, source_id);`);

  // Composite index for the 24h phone-dedup query in /demo/callback +
  // /outbound/website-callback (E2 + T-38). Without this the dedup is
  // O(n) seq scan per request — fine at 100 leads, slow at 10k+.
  // (phone, created_at DESC) supports both `WHERE phone = $1` and the
  // recency predicate.
  await pool.query(`CREATE INDEX IF NOT EXISTS crm_leads_phone_created_idx ON crm_leads(phone, created_at DESC);`);
  // Index call_id for Retell webhook lookups (UPDATE ... WHERE call_id = $1). Without this → full table scan.
  await pool.query(`CREATE INDEX IF NOT EXISTS outbound_calls_call_id_idx ON outbound_calls(call_id);`);
  // UNIQUE to match call_transcripts.call_id and prevent duplicate rows from webhook retries.
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'outbound_calls_call_id_uniq') THEN
        BEGIN
          CREATE UNIQUE INDEX outbound_calls_call_id_uniq ON outbound_calls(call_id) WHERE call_id IS NOT NULL;
        EXCEPTION WHEN unique_violation THEN
          NULL; -- pre-existing duplicates; leave idx off until cleanup
        END;
      END IF;
    END $$;
  `);

  // org_id: nullable for anonymous platform-level leads (e.g. Phonbot's own demo/callback);
  // required for future multi-tenant embed. ON DELETE CASCADE ensures GDPR right-to-erasure cleanup.
  await pool.query(`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS org_id UUID;`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_leads_org_fk') THEN
        ALTER TABLE crm_leads
          ADD CONSTRAINT crm_leads_org_fk
          FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS crm_leads_email_idx ON crm_leads(email);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS crm_leads_status_idx ON crm_leads(status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS crm_leads_org_idx ON crm_leads(org_id);`);
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
  // Defense-in-depth: customer outbound sales calls are off unless feature flag is on.
  // Routes already gate on requireCustomerOutbound, but this function is also imported
  // from worker paths (auto-improve loops, scheduled campaigns); refusing at the
  // function edge prevents silent reactivation through a future caller.
  if (process.env.CUSTOMER_OUTBOUND_ENABLED !== 'true') {
    return { ok: false, error: 'FEATURE_DISABLED' };
  }

  if (!pool) return { ok: false, error: 'DB_NOT_CONFIGURED' };

  // Anti-toll-fraud: whitelist the target number's country. Defense-in-depth so
  // a future caller (campaign-worker, webhook, internal job) that skipped the
  // route-level check cannot make Phonbot dial +1-900-* / +44-9-* premium-rate
  // numbers on behalf of any org. See memory/fix-specs.md:T-32.
  const ALLOWED_PHONE_PREFIXES = (process.env.ALLOWED_PHONE_PREFIXES ?? '+49,+43,+41')
    .split(',').map(p => p.trim()).filter(Boolean);
  if (!ALLOWED_PHONE_PREFIXES.some(p => params.toNumber.startsWith(p))) {
    return { ok: false, error: 'PHONE_PREFIX_NOT_ALLOWED' };
  }

  // Atomically reserve minutes (E7) — closes the race vs. parallel calls.
  // Webhook reconciles to actual at call_ended.
  const { tryReserveMinutes, DEFAULT_CALL_RESERVE_MINUTES } = await import('./usage.js');
  const reserve = await tryReserveMinutes(params.orgId, DEFAULT_CALL_RESERVE_MINUTES);
  if (!reserve.allowed) return { ok: false, error: 'USAGE_LIMIT_REACHED' };

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
  // WEBHOOK_BASE_URL drives the outbound TwiML and WS URLs. A localhost fallback
  // in prod silently breaks every call (Twilio can't reach the bridge) — refuse
  // rather than swallow. Dev keeps the default so `pnpm dev` just works.
  const webhookBase = process.env.WEBHOOK_BASE_URL ?? (
    process.env.NODE_ENV === 'production'
      ? (() => { throw new Error('WEBHOOK_BASE_URL is required in production'); })()
      : 'http://localhost:3001'
  );

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
      outboundRecordId,
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

  // Customer-outbound feature flag. Phonbot is an INBOUND-only product right now;
  // outbound endpoints are only for the landing-page demo callback (public) and Twilio webhooks.
  // Set CUSTOMER_OUTBOUND_ENABLED=true to re-expose customer outbound features.
  const CUSTOMER_OUTBOUND_ENABLED = process.env.CUSTOMER_OUTBOUND_ENABLED === 'true';

  const requireCustomerOutbound = async (_req: FastifyRequest, reply: FastifyReply) => {
    if (!CUSTOMER_OUTBOUND_ENABLED) {
      return reply.status(503).send({
        error: 'FEATURE_DISABLED',
        message: 'Outbound-Anrufe sind aktuell nicht als Kunden-Feature verfügbar. Kontakt: info@phonbot.de',
      });
    }
  };

  // POST /outbound/call — trigger a single outbound sales call (customer-feature, gated)
  app.post('/outbound/call', { onRequest: [app.authenticate, requireCustomerOutbound] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const parsed = z.object({
      toNumber: z.string().min(5),
      contactName: z.string().optional(),
      campaign: z.string().optional(),
      campaignContext: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'toNumber required' });

    const result = await triggerSalesCall({ orgId, ...parsed.data });
    if (!result.ok) {
      const statusCode = result.error === 'FEATURE_DISABLED' ? 503
        : result.error === 'NO_OUTBOUND_NUMBER' ? 422
        : 500;
      return reply.status(statusCode).send(result);
    }
    return result;
  });

  // POST /outbound/call/outcome — update call outcome (webhook or manual)
  app.post('/outbound/call/:callId/outcome', { onRequest: [app.authenticate, requireCustomerOutbound] }, async (req: FastifyRequest, reply: FastifyReply) => {
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
  app.get('/outbound/calls', { onRequest: [app.authenticate, requireCustomerOutbound] }, async (req: FastifyRequest) => {
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
  app.get('/outbound/stats', { onRequest: [app.authenticate, requireCustomerOutbound] }, async (req: FastifyRequest) => {
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
  app.get('/outbound/prompt', { onRequest: [app.authenticate, requireCustomerOutbound] }, async (req: FastifyRequest) => {
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
  app.get('/outbound/suggestions', { onRequest: [app.authenticate, requireCustomerOutbound] }, async (req: FastifyRequest) => {
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
  app.post('/outbound/suggestions/:id/apply', { onRequest: [app.authenticate, requireCustomerOutbound] }, async (req: FastifyRequest, reply: FastifyReply) => {
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
  app.post('/outbound/suggestions/:id/reject', { onRequest: [app.authenticate, requireCustomerOutbound] }, async (req: FastifyRequest, reply: FastifyReply) => {
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
      email: z.string().email().max(200),
      // Sanitize name: only letters, numbers, spaces, hyphens, apostrophes, umlauts (prompt-injection mitigation)
      name: z.string().max(50).regex(/^[\p{L}\p{N}\s'-]+$/u, 'Invalid characters in name').optional(),
      turnstileToken: z.string().optional(),
    }).safeParse(req.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'E-Mail und Telefonnummer erforderlich (Name nur mit Buchstaben/Ziffern)' });
    }

    // CAPTCHA-Gate (N6) — same Turnstile flow as /demo/*. Dev without
    // TURNSTILE_SECRET_KEY: skip; prod: required.
    const captchaOk = await verifyTurnstile(parsed.data.turnstileToken, req.ip);
    if (!captchaOk) {
      app.log.warn({ ip: req.ip }, 'website-callback captcha verification failed');
      return reply.status(403).send({ error: 'captcha_failed', message: 'Bitte Captcha bestätigen.' });
    }

    // Normalize phone to E.164
    let phone = parsed.data.phone.replace(/[\s\-()]/g, '');
    if (phone.startsWith('00')) phone = '+' + phone.slice(2);
    else if (phone.startsWith('0') && !phone.startsWith('+')) phone = '+49' + phone.slice(1);
    if (!phone.startsWith('+')) phone = '+49' + phone;

    // Abuse guard: country whitelist (default DACH region — configurable via env)
    const ALLOWED_PREFIXES = (process.env.ALLOWED_PHONE_PREFIXES ?? '+49,+43,+41').split(',').map((p) => p.trim()).filter(Boolean);
    if (!ALLOWED_PREFIXES.some((p) => phone.startsWith(p))) {
      app.log.warn({ phone, ip: req.ip }, 'Rejected website-callback: non-allowed country prefix');
      return reply.status(400).send({ error: 'Aktuell nur Telefonnummern aus der DACH-Region (DE/AT/CH) unterstützt' });
    }

    const fromNumber = process.env.RETELL_OUTBOUND_NUMBER;
    if (!fromNumber) {
      app.log.warn('RETELL_OUTBOUND_NUMBER not configured — cannot make callback');
      return reply.status(503).send({ error: 'Rückruf aktuell nicht verfügbar' });
    }

    // Dedup — same phone within 24h won't retrigger a callback. Identical to
    // demo/callback's dedup (E2): phone is the identity, source is metadata
    // and intentionally NOT in the WHERE so an attacker can't bypass the
    // window by spoofing source. Both public entry points must apply the
    // same predicate or the gap is exploitable (T-38).
    if (pool) {
      const dup = await pool.query(
        `SELECT 1 FROM crm_leads
         WHERE phone = $1 AND created_at > now() - interval '24 hours'
         LIMIT 1`,
        [phone],
      );
      if (dup.rowCount) {
        app.log.info({ phone, ip: req.ip }, 'website-callback dedup hit — skipping outbound call');
        sendSignupLinkEmail({ toEmail: parsed.data.email, name: parsed.data.name ?? null })
          .catch((err: Error) => app.log.warn({ err: err.message }, 'website-callback signup-link email failed'));
        const sms = await sendSignupLinkSms({ to: phone, name: parsed.data.name ?? null, logger: app.log });
        return { ok: true, smsSent: sms.ok };
      }
    }

    try {
      // Save lead to CRM (log rather than swallow — audit trail matters for
      // GDPR right-of-access and for operational visibility when inserts fail).
      let leadId: string | null = null;
      if (pool) {
        const leadRes = await pool.query(
          `INSERT INTO crm_leads (name, email, phone, source, status)
           VALUES ($1, $2, $3, 'website-callback', 'new')
           RETURNING id`,
          [parsed.data.name ?? null, parsed.data.email, phone],
        ).catch((err: Error) => {
          app.log.warn({ err: err.message, phone }, 'website-callback: crm_leads insert failed');
          return null;
        });
        leadId = (leadRes?.rows[0]?.id as string) ?? null;
      }

      // Track call in DB
      let websiteCallId: string | null = null;
      if (pool) {
        const res = await pool.query(
          `INSERT INTO outbound_calls (org_id, to_number, contact_name, campaign, prompt_version, status)
           VALUES (NULL, $1, $2, 'website-callback', 1, 'initiated') RETURNING id`,
          [phone, parsed.data.name ?? null],
        ).catch((err: Error) => {
          app.log.warn({ err: err.message, phone }, 'website-callback: outbound_calls insert failed');
          return null;
        });
        websiteCallId = (res?.rows[0]?.id as string) ?? null;
      }

      // Update lead with call reference
      if (leadId && websiteCallId && pool) {
        pool.query(`UPDATE crm_leads SET call_id = $1 WHERE id = $2`, [websiteCallId, leadId])
          .catch((err: Error) => app.log.warn({ err: err.message, leadId }, 'website-callback: link crm_leads.call_id failed'));
      }

      sendSignupLinkEmail({ toEmail: parsed.data.email, name: parsed.data.name ?? null })
        .catch((err: Error) => app.log.warn({ err: err.message }, 'website-callback signup-link email failed'));
      const signupSms = await sendSignupLinkSms({ to: phone, name: parsed.data.name ?? null, logger: app.log });

      // Use the same Retell-based sales agent as demo/callback.
      // Retell metadata is forwarded into their systems; keep it minimal and
      // PII-free. Customer name stays in our DB only (crm_leads.name) where
      // the DPA covers it. `outboundRecordId` is needed for webhook correlation.
      const { getOrCreateSalesAgent } = await import('./demo.js');
      const { createPhoneCall } = await import('./retell.js');
      const agentId = await getOrCreateSalesAgent();
      const call = await createPhoneCall({
        agentId,
        toNumber: phone,
        fromNumber,
        metadata: { source: 'website-callback', outboundRecordId: websiteCallId ?? '' },
        dynamicVariables: {
          signup_link: signupLinkUrl(),
          signup_sms_sent: signupSms.ok ? 'true' : 'false',
        },
      });

      if (websiteCallId && pool) {
        pool.query(`UPDATE outbound_calls SET call_id = $1, status = 'calling' WHERE id = $2`, [call.call_id, websiteCallId])
          .catch((err: Error) => app.log.warn({ err: err.message, websiteCallId }, 'website-callback: link outbound_calls.call_id failed'));
      }

      app.log.info({ callId: call.call_id, phone }, 'Website callback call initiated via Retell');
      return { ok: true, smsSent: signupSms.ok };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Call failed';
      app.log.warn({ err: msg, phone }, 'website-callback call failed');
      return reply.status(500).send({ error: 'Rückruf konnte nicht gestartet werden. Bitte versuche es erneut.' });
    }
  });

  // ── CRM Leads API (admin only) ──────────────────────────────────────────

  // GET /outbound/leads — list leads scoped to the caller's org only
  // (anonymous platform-level leads with org_id IS NULL are visible only via /admin/leads)
  app.get('/outbound/leads', { onRequest: [app.authenticate, requireCustomerOutbound] }, async (req: FastifyRequest) => {
    if (!pool) return { items: [], total: 0 };
    const { orgId } = req.user as JwtPayload;
    const q = z.object({
      status: z.enum(['new', 'contacted', 'converted', 'lost']).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const values: unknown[] = [orgId];
    let where = `WHERE org_id = $1`;
    if (q.status) {
      values.push(q.status);
      where += ` AND status = $${values.length}`;
    }
    values.push(q.limit, q.offset);
    const { rows } = await pool.query(
      `SELECT id, created_at, name, email, phone, source, status, notes, call_id, converted_at
       FROM crm_leads ${where} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const countRes = await pool.query(`SELECT COUNT(*) as cnt FROM crm_leads ${where}`, values.slice(0, -2));
    return { items: rows, total: parseInt(String(countRes.rows[0]?.cnt ?? '0'), 10) };
  });

  // PATCH /outbound/leads/:id — update lead status/notes (org-scoped)
  app.patch('/outbound/leads/:id', { onRequest: [app.authenticate, requireCustomerOutbound] }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const { orgId } = req.user as JwtPayload;
    const { id } = req.params as { id: string };
    const body = z.object({
      status: z.enum(['new', 'contacted', 'converted', 'lost']).optional(),
      notes: z.string().max(2000).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Invalid input' });

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.data.status) {
      updates.push(`status = $${idx++}`);
      values.push(body.data.status);
      if (body.data.status === 'converted') {
        updates.push(`converted_at = now()`);
      }
    }
    if (body.data.notes !== undefined) {
      updates.push(`notes = $${idx++}`);
      values.push(body.data.notes);
    }

    if (updates.length === 0) return { ok: true };

    values.push(id, orgId);
    await pool.query(`UPDATE crm_leads SET ${updates.join(', ')} WHERE id = $${idx} AND org_id = $${idx + 1}`, values);
    return { ok: true };
  });

  // DELETE /outbound/leads/:id — delete a lead (org-scoped)
  app.delete('/outbound/leads/:id', { onRequest: [app.authenticate, requireCustomerOutbound] }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const { orgId } = req.user as JwtPayload;
    const { id } = req.params as { id: string };
    await pool.query(`DELETE FROM crm_leads WHERE id = $1 AND org_id = $2`, [id, orgId]);
    return { ok: true };
  });

  // GET /outbound/leads/stats — lead funnel stats (org-scoped)
  app.get('/outbound/leads/stats', { onRequest: [app.authenticate, requireCustomerOutbound] }, async (req: FastifyRequest) => {
    if (!pool) return { total: 0, new: 0, contacted: 0, converted: 0, lost: 0 };
    const { orgId } = req.user as JwtPayload;
    const { rows } = await pool.query(
      `SELECT status, COUNT(*) as cnt FROM crm_leads WHERE org_id = $1 GROUP BY status`,
      [orgId],
    );
    const stats: Record<string, number> = { new: 0, contacted: 0, converted: 0, lost: 0 };
    for (const r of rows) stats[r.status as string] = parseInt(String(r.cnt), 10);
    return { total: Object.values(stats).reduce((a, b) => a + b, 0), ...stats };
  });
}
