/**
 * Retell AI webhook endpoints.
 *
 * Retell calls these URLs when the agent invokes a custom function or when
 * the call lifecycle changes. Two distinct auth bars apply (TOOL_AUTH_NOTE):
 *
 *   • POST /retell/webhook   (lifecycle: call_started/_ended/_analyzed)
 *     STRICT verifyRetellSignature(): HMAC-SHA256 over rawBody using
 *     RETELL_API_KEY, timing-safe compared against x-retell-signature.
 *     No body-only fallback — these events MUTATE billing
 *     (orgs.minutes_used) and persist transcripts/insights, so a forged
 *     event must be impossible without the API key.
 *
 *   • POST /retell/tools/*   (custom-function dispatchers)
 *     verifyRetellToolRequest() — OR-chain:
 *       1. valid HMAC (Retell may add per-tool signing in future), OR
 *       2. signed-tenant-id query param we set when registering the tool, OR
 *       3. body-carried _retell_agent_id, cross-checked via
 *          getOrgIdByAgentId() against agent_configs (unknown agent → 403
 *          / demo-only fallback per handler).
 *     Acceptable here because Retell does NOT send x-retell-signature on
 *     Custom-Function calls. The agent_id check binds the call to a known
 *     org, giving the same tenant-isolation guarantee HMAC would.
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logBg } from './logger.js';
import { createTicket, mergeTicketMetadata } from './tickets.js';
import { appendTraceEvent } from './traces.js';
import { reconcileMinutes, DEFAULT_CALL_RESERVE_MINUTES } from './usage.js';
import { pool } from './db.js';
import { findFreeSlots, bookSlot } from './calendar.js';
import { triggerCallback, readConfig } from './agent-config.js';
import { executeIntegrationCall, type ApiIntegration } from './api-integrations.js';
import { analyzeCall } from './insights.js';
import { analyzeOutboundCall } from './outbound-insights.js';
import { getOrgIdByAgentId } from './org-id-cache.js';
import { checkForwardingVerificationMatch } from './phone.js';
import { getCall, deleteCall } from './retell.js';
import { fireInboundWebhooks } from './inbound-webhooks.js';
import { sendBookingConfirmationSms, sendTicketAckSms } from './sms.js';
import { readDemoCallTemplate, maybeSendDemoSignupLink } from './demo.js';
import { redactPII } from './pii.js';
import { customerModuleActiveForAgentConfig, lookupCustomer, upsertCustomer } from './customers.js';

const RETELL_API_KEY = process.env.RETELL_API_KEY ?? '';

function now() {
  return Date.now();
}

async function getOrgName(orgId: string | null | undefined): Promise<string | null> {
  if (!pool || !orgId) return null;
  const res = await pool.query(`SELECT name FROM orgs WHERE id = $1 LIMIT 1`, [orgId]).catch(() => null);
  return (res?.rows[0]?.name as string | undefined) ?? null;
}

/** Internal shape of the extended request with rawBody attached by the content-type parser. */
type RawBodyRequest = FastifyRequest & { rawBody?: Buffer | string };

/**
 * Verify the Retell webhook signature.
 * Retell sends `x-retell-signature: <hex>` which is HMAC-SHA256 of the raw body
 * signed with RETELL_API_KEY.
 * Returns true when valid or when RETELL_API_KEY is not configured (dev mode).
 */
function verifyRetellSignature(req: RawBodyRequest): boolean {
  // Always require signature — no NODE_ENV bypass. Misconfigured env would otherwise
  // let attackers forge call_ended webhooks (manipulate minutes_used, inject transcripts, etc.).
  if (!RETELL_API_KEY) {
    // Dev-only escape: require explicit opt-in via ALLOW_UNSIGNED_WEBHOOKS=true
    if (process.env.ALLOW_UNSIGNED_WEBHOOKS === 'true' && process.env.NODE_ENV !== 'production') return true;
    return false;
  }

  const signature = (req.headers['x-retell-signature'] as string) ?? '';

  // rawBody MUST be set by the addContentTypeParser in index.ts for application/json.
  // If it's missing, the request came over a content-type we can't reliably re-serialize
  // (form-urlencoded, multipart) — falling back to JSON.stringify(req.body) would
  // produce a different byte sequence than what Retell signed → every signature would
  // fail anyway, plus we'd lose the audit trail. Refuse outright.
  let rawBody: string;
  if (typeof req.rawBody === 'string') {
    rawBody = req.rawBody;
  } else if (Buffer.isBuffer(req.rawBody)) {
    rawBody = req.rawBody.toString();
  } else {
    return false;
  }

  // Validate hex string before creating buffer (prevents Buffer allocation errors)
  if (!/^[0-9a-f]*$/.test(signature)) return false;
  if (signature.length === 0) return false;

  const expected = crypto
    .createHmac('sha256', RETELL_API_KEY)
    .update(rawBody)
    .digest('hex');

  // Ensure same byte length before timingSafeEqual
  if (signature.length !== expected.length) return false;

  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

/**
 * Auth gate for Retell Custom-Function (tool) endpoints.
 *
 * Retell's tool calls do NOT include x-retell-signature by default — HMAC
 * signing is only used on the call lifecycle webhook. A strict signature
 * check here returns 401 for every legitimate tool call, which is what
 * broke calendar.findSlots / calendar.book / ticket.create in production.
 *
 * Accept EITHER:
 *   1. Valid HMAC signature (if Retell ever adds it per-tool in future), OR
 *   2. Body contains _retell_agent_id — the handler below will then
 *      getOrgIdByAgentId() it; unknown agents get 403 or demo-only fallback,
 *      matching the isolation guarantee HMAC would provide. An attacker
 *      would need to know a specific 32-char agent_id from Retell's namespace
 *      to forge a tool call, and even then only the agent's own org is
 *      affected.
 *
 * Webhook auth (call_ended etc.) stays strict HMAC — those mutate billing.
 */
function verifyRetellToolRequest(req: RawBodyRequest): boolean {
  if (verifyRetellSignature(req)) return true;
  if (getSignedToolTenantId(req)) return true;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const args = (body.args ?? body) as Record<string, unknown>;
  const call = (body.call ?? {}) as Record<string, unknown>;
  const agentId = (args?._retell_agent_id ?? args?.agent_id ?? body?._retell_agent_id ?? body?.agent_id ?? call.agent_id) as unknown;
  return typeof agentId === 'string' && agentId.length > 0;
}

// getOrgIdByAgentId + invalidateOrgIdCache live in org-id-cache.ts (breaks
// the circular dependency agent-config ↔ retell-webhooks). Imported at top.

/** Narrowed shape of the Retell event body. */
interface RetellEventBody {
  event?: string;
  call?: RetellCallData;
  args?: Record<string, unknown>;
  _retell_call_id?: string;
  _retell_agent_id?: string;
  agent_id?: string;
  [key: string]: unknown;
}

interface RetellCallData {
  call_id?: string;
  call_status?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  agent_id?: string;
  from_number?: string;
  fromNumber?: string;
  to_number?: string;
}

function retellArgs(body: RetellEventBody): Record<string, unknown> {
  return (body?.args ?? body ?? {}) as Record<string, unknown>;
}

function getRetellCall(body: RetellEventBody): RetellCallData | Record<string, unknown> {
  return (body?.call ?? body) as RetellCallData | Record<string, unknown>;
}

function getRetellAgentId(body: RetellEventBody, args = retellArgs(body)): string | undefined {
  const call = getRetellCall(body) as Record<string, unknown>;
  const value =
    args._retell_agent_id ??
    args.agent_id ??
    body._retell_agent_id ??
    body.agent_id ??
    call.agent_id;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getRetellCallId(body: RetellEventBody, args = retellArgs(body)): string | undefined {
  const call = getRetellCall(body) as Record<string, unknown>;
  const value = args._retell_call_id ?? body._retell_call_id ?? call.call_id;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function firstStringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (/^\{\{[^}]+\}\}$/.test(trimmed)) continue;
    // LLM "no number" placeholders across our supported languages — keep extending
    // as we add more locales (voice-catalog covers ~30; common 5-language minimum
    // listed here covers DACH + EU/global routing). If the LLM picks anything
    // outside this set we'd rather keep the (probably broken) value than silently
    // route to demo — at least it surfaces in the logs.
    if (/^(unknown|anonymous|unbekannt|nicht angegeben|nicht bekannt|keine angabe|keine telefonnummer|kein eintrag|kein wert|desconocido|anónimo|no proporcionado|no facilitado|inconnu|anonyme|non communiqué|sconosciuto|anonimo|non fornito|onbekend|anoniem|niet opgegeven|bilinmiyor|anonim|verilmedi|nieznany|anonimowy|nie podano|n\/?a|none|null|undefined)$/i.test(trimmed)) continue;
    return trimmed;
  }
  return '';
}

function stringField(source: unknown, keys: string[]): string {
  if (!source || typeof source !== 'object') return '';
  const record = source as Record<string, unknown>;
  return firstStringValue(...keys.map((key) => record[key]));
}

function getCallerPhone(body: RetellEventBody, args = retellArgs(body)): string {
  const call = getRetellCall(body) as Record<string, unknown>;
  const phoneKeys = [
    'customerPhone',
    'customer_phone',
    'customer_phone_number',
    'customerNumber',
    'customer_number',
    'phone',
    'phoneNumber',
    'phone_number',
    'callerPhone',
    'caller_phone',
    'callerNumber',
    'caller_number',
    'fromNumber',
    'from_number',
    'caller',
    'ani',
  ];

  return firstStringValue(
    stringField(args, phoneKeys),
    stringField(args.customer, phoneKeys),
    stringField(args.contact, phoneKeys),
    stringField(body, phoneKeys),
    stringField(call, phoneKeys),
  );
}

async function resolveCallerPhone(body: RetellEventBody, args: Record<string, unknown>, callId?: string): Promise<string> {
  const fromPayload = getCallerPhone(body, args);
  if (fromPayload) return fromPayload;
  if (!callId || callId === 'retell') return '';

  try {
    const call = await getCall(callId);
    return stringField(call, ['from_number', 'fromNumber', 'caller_number', 'callerNumber', 'phone', 'phoneNumber']);
  } catch {
    return '';
  }
}

function ticketPhoneOrUnknown(phone: string): string {
  return phone.trim() || 'unknown';
}

function isCallbackSafePhone(phone: string): boolean {
  const allowed = (process.env.ALLOWED_PHONE_PREFIXES ?? '+49,+43,+41').split(',').map((p) => p.trim()).filter(Boolean);
  return allowed.some((prefix) => phone.startsWith(prefix));
}

function compactRetellSlots(slots: string[]): { slots: string[]; allSlotsCount: number; moreCount: number; instruction: string } {
  const visible = slots.slice(0, 6);
  return {
    slots: visible,
    allSlotsCount: slots.length,
    moreCount: Math.max(0, slots.length - visible.length),
    instruction: 'Nenne maximal drei passende Optionen in einem kurzen Satz, nicht jede Uhrzeit einzeln. Wenn mehr Slots vorhanden sind, sage dass es weitere Zeiten gibt.',
  };
}

function toolAuthSecret(): string {
  const secret = process.env.RETELL_TOOL_AUTH_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('RETELL_TOOL_AUTH_SECRET (or JWT_SECRET) required in production — refusing to verify tool URLs with a well-known fallback');
    }
    return 'dev-retell-tool-auth';
  }
  return secret;
}

function signToolTenant(tenantId: string): string {
  return crypto.createHmac('sha256', toolAuthSecret()).update(tenantId).digest('base64url');
}

function getSignedToolTenantId(req: FastifyRequest): string | null {
  const query = (req.query ?? {}) as Record<string, unknown>;
  const tenantId = query.tenant_id;
  const sig = query.tool_sig;
  if (typeof tenantId !== 'string' || typeof sig !== 'string' || !tenantId || !sig) return null;

  const expected = signToolTenant(tenantId);
  const actualBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return null;
  return crypto.timingSafeEqual(actualBuf, expectedBuf) ? tenantId : null;
}

async function getOrgIdByTenantId(tenantId: string): Promise<string | null> {
  if (!pool) return null;
  const res = await pool.query(
    `SELECT org_id FROM agent_configs WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  return (res.rows[0]?.org_id as string | undefined) ?? null;
}

async function getToolOrgContext(req: FastifyRequest, body: RetellEventBody, args: Record<string, unknown>): Promise<{
  callId: string;
  agentId?: string;
  signedTenantId: string | null;
  orgId: string | null;
  tenantId: string | null;
}> {
  const callId = getRetellCallId(body, args) ?? 'retell';
  const agentId = getRetellAgentId(body, args);
  const signedTenantId = getSignedToolTenantId(req);
  const orgId = agentId
    ? await getOrgIdByAgentId(agentId)
    : signedTenantId
      ? await getOrgIdByTenantId(signedTenantId)
      : null;
  return { callId, agentId, signedTenantId, orgId, tenantId: signedTenantId ?? orgId };
}

function stringArg(args: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

async function resolveCalendarStaffForTool(
  orgId: string,
  args: Record<string, unknown>,
): Promise<{ staffId: string | null; requested: string | null; matchedName: string | null }> {
  const explicitStaffId = stringArg(args, 'staffId', 'staff_id');
  const requested = stringArg(args, 'preferredStylist', 'preferred_stylist', 'staffName', 'staff_name', 'stylist', 'employeeName') ?? null;
  if (!pool) return { staffId: explicitStaffId ?? null, requested, matchedName: null };

  if (explicitStaffId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(explicitStaffId)) {
    const byId = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM calendar_staff WHERE org_id = $1 AND id = $2 AND active = true LIMIT 1`,
      [orgId, explicitStaffId],
    );
    if (byId.rows[0]) return { staffId: byId.rows[0].id, requested, matchedName: byId.rows[0].name };
    return { staffId: null, requested: requested ?? explicitStaffId, matchedName: null };
  }

  if (!requested || requested.length < 2) return { staffId: null, requested, matchedName: null };
  const byName = await pool.query<{ id: string; name: string }>(
    `SELECT id, name
       FROM calendar_staff
      WHERE org_id = $1
        AND active = true
        AND (
          lower(name) = lower($2)
          OR lower(name) LIKE lower($2) || '%'
          OR lower(name) LIKE '%' || lower($2) || '%'
          OR lower($2) LIKE '%' || lower(name) || '%'
        )
      ORDER BY
        CASE
          WHEN lower(name) = lower($2) THEN 0
          WHEN lower(name) LIKE lower($2) || '%' THEN 1
          ELSE 2
        END,
        sort_order,
        name
      LIMIT 1`,
    [orgId, requested],
  );
  return { staffId: byName.rows[0]?.id ?? null, requested, matchedName: byName.rows[0]?.name ?? null };
}

async function isCustomerModuleActiveForTool(tenantId: string | null, orgId: string | null): Promise<boolean> {
  if (!tenantId || !orgId) return false;
  const cfg = await readConfig(tenantId, orgId);
  return customerModuleActiveForAgentConfig(cfg);
}

async function maybeUpsertCustomerFromTool(params: {
  tenantId: string | null;
  orgId: string | null;
  callId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerType?: 'new' | 'existing' | 'unknown';
  details?: Record<string, unknown>;
  notes?: string | null;
  log: FastifyRequest['log'];
}): Promise<void> {
  try {
    const name = params.customerName?.trim();
    if (!params.orgId || !name || /^(unbekannt|unknown|anonymous)$/i.test(name)) return;
    if (!await isCustomerModuleActiveForTool(params.tenantId, params.orgId)) return;
    await upsertCustomer({
      orgId: params.orgId,
      fullName: name,
      phone: params.customerPhone,
      customerType: params.customerType ?? 'unknown',
      sourceCallId: params.callId,
      details: params.details ?? {},
      notes: params.notes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    params.log.warn({ err: message, orgId: params.orgId, callId: params.callId }, 'customer upsert failed');
  }
}

export async function registerRetellWebhooks(app: FastifyInstance) {
  // ── Call lifecycle webhook ─────────────────────────────────────────────────
  // Retell sends call_started / call_ended / call_analyzed events here.
  // These events MUTATE billing (orgs.minutes_used) and persist transcripts +
  // trigger insights — so the auth bar is the strict HMAC check, no body-only
  // fallback. A spoofed call_ended would otherwise inflate minutes, inject
  // fake transcripts, fan out to customer webhooks, and (with a guessable
  // call_id) trigger DELETE on real Retell calls. The OR-fallback chain that
  // tool endpoints below use is acceptable there because tool calls are
  // read-mostly and bound by agent_id ownership; lifecycle is not.
  app.post('/retell/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyRetellSignature(req as RawBodyRequest)) {
      // Loud-log — if Retell ever sends an unsigned lifecycle event we want
      // to see it immediately, not silently lose data. Body context (event +
      // agent_id) helps figure out which org's webhook setup needs attention.
      const body = (req.body ?? {}) as Record<string, unknown>;
      const call = (body.call ?? {}) as Record<string, unknown>;
      req.log.error(
        {
          event: body.event ?? call.call_status ?? null,
          agentId: call.agent_id ?? body.agent_id ?? null,
          hasSignature: !!req.headers['x-retell-signature'],
        },
        'retell lifecycle webhook rejected — HMAC signature missing or invalid',
      );
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = req.body as RetellEventBody;
    const event = body?.event ?? body?.call?.call_status;
    const call = body?.call ?? body;

    if (event === 'call_started') {
      const agentId = (call as RetellCallData).agent_id;
      const orgId = agentId ? await getOrgIdByAgentId(agentId) : null;
      const fromNumber = (call as RetellCallData).from_number;
      const toNumber = (call as RetellCallData).to_number;

      // Close the forwarding-verification loop: if there's a pending verifier
      // dial against this Phonbot inbound, match the inbound caller-ID and
      // resolve the pending result. Fire-and-forget; the verify endpoint polls
      // the Redis result key until TTL expires.
      checkForwardingVerificationMatch(toNumber, fromNumber).catch((err: Error) =>
        req.log.warn(
          { err: err.message, toNumber, fromNumber },
          'forwarding-verification match check failed',
        ),
      );

      if (orgId) {
        fireInboundWebhooks(orgId, 'call.started', {
          callId: (call as RetellCallData).call_id,
          agentId,
          fromNumber,
          toNumber,
          startTimestamp: (call as RetellCallData).start_timestamp,
        }).catch((err: Error) =>
          req.log.warn(
            { err: err.message, orgId, event: 'call.started' },
            'inbound-webhook fan-out failed',
          ),
        );
      }
    }

    if (event === 'call_ended') {
      const startTs = (call as RetellCallData).start_timestamp;
      const endTs = (call as RetellCallData).end_timestamp;
      const agentId = (call as RetellCallData).agent_id;
      const dedupCallId = (call as RetellCallData).call_id;

      // Idempotency gate: Retell retries call_ended on timeout/non-2xx.
      // Without this, a retried webhook runs reconcileMinutes twice and
      // double-bills overages (€9 bill → €28 on 3x retry) and doubles
      // analyzeCall (double OpenAI cost). INSERT ... ON CONFLICT returns 0
      // rows on second call → we short-circuit.
      if (dedupCallId && pool) {
        const claim = await pool.query(
          `INSERT INTO processed_retell_events (call_id, event_type)
           VALUES ($1, $2)
           ON CONFLICT (call_id, event_type) DO NOTHING
           RETURNING call_id`,
          [dedupCallId, 'call_ended'],
        );
        if (!claim.rowCount) {
          req.log.info({ callId: dedupCallId }, 'retell call_ended dedup hit — skipping');
          return { ok: true, deduped: true };
        }
      }

      // § 201 StGB compliance: caller withdrew recording consent mid-call.
      // We still bill the used minutes (service was rendered) but skip
      // transcript persistence + analysis and DELETE the call from Retell.
      let recordingDeclined = false;
      if (dedupCallId && pool) {
        const flag = await pool.query(
          `SELECT 1 FROM recording_declined_calls WHERE call_id = $1`,
          [dedupCallId],
        );
        recordingDeclined = (flag.rowCount ?? 0) > 0;
      }

      if (startTs && endTs && agentId) {
        const callDurationMs = Math.max(0, endTs - startTs);
        // Second-accurate billing: 61s = 1.02 min, not 2 min. Customers pay
        // for what they actually used. Stored as NUMERIC(10,2) in orgs.minutes_used.
        // See AGB § 5: "sekundengenaue Abrechnung".
        const minutes = Math.round((callDurationMs / 60000) * 100) / 100;

        const orgId = await getOrgIdByAgentId(agentId);
        if (orgId) {
          // Pre-call reserved DEFAULT_CALL_RESERVE_MINUTES (E7). Reconcile
          // delta now: actual ≤ reserved → refund the over-reservation;
          // actual > reserved → top up the difference. agentId is also passed
          // so premium-voice surcharge can be looked up and billed inside.
          // callId threads through to make the Stripe idempotency key stable
          // across webhook retries — a retried call_ended can no longer
          // double-charge the customer.
          await reconcileMinutes(orgId, DEFAULT_CALL_RESERVE_MINUTES, minutes, agentId, dedupCallId);
        }

        // AI analysis — fire and forget, never blocks the webhook response
        const transcript = (call as RetellCallData & { transcript?: string }).transcript;
        const callId = (call as RetellCallData).call_id;
        const callType = (call as RetellCallData & { call_type?: string }).call_type;
        const durationMs = (call as RetellCallData & { duration_ms?: number }).duration_ms;
        const fromNumber = (call as RetellCallData).from_number;
        const toNumber = (call as RetellCallData).to_number;
        const disconnectionReason = (call as RetellCallData & { disconnection_reason?: string }).disconnection_reason;
        const silenceDurationMs = (call as RetellCallData & { silence_duration_ms?: number }).silence_duration_ms;

        if (recordingDeclined && callId) {
          // Fire-and-forget: DELETE Retell's stored audio + transcript.
          // Keep the flag row as audit trail that deletion was requested.
          deleteCall(callId).then(
            () => req.log.info({ callId }, 'recording_declined → Retell call deleted'),
            (err: Error) => req.log.error({ err: err.message, callId }, 'deleteCall failed'),
          );
          // Skip transcript DB insert + analyzeCall — bill minutes only.
          return { ok: true, recordingDeclined: true };
        }

        if (orgId && callId && transcript) {
          const metadata = (call as RetellCallData & { metadata?: Record<string, unknown> }).metadata;
          const isOutbound = !!(metadata?.outboundRecordId);

          // Store transcript for learning system (fire-and-forget, but LOGGED
          // on failure — silent catches hide transcript loss, which then
          // cascades into no audit trail, no billing check, no learning).
          if (pool) {
            pool.query(
              `INSERT INTO call_transcripts (org_id, call_id, direction, transcript, duration_sec, from_number, to_number, disconnection_reason, metadata)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (call_id) DO NOTHING`,
              [
                orgId,
                callId,
                isOutbound ? 'outbound' : 'inbound',
                transcript,
                durationMs ? Math.round(durationMs / 1000) : null,
                fromNumber ?? null,
                toNumber ?? null,
                disconnectionReason ?? null,
                JSON.stringify(metadata ?? {}),
              ],
            ).catch((err: Error) => req.log.error({ err: err.message, orgId, callId }, 'call_transcripts insert failed'));
          }

          if (isOutbound) {
            // Outbound sales call — use outbound learning system
            analyzeOutboundCall(orgId, callId, transcript, durationMs ? Math.round(durationMs / 1000) : undefined)
              .catch((err: Error) => req.log.error({ err: err.message, orgId, callId }, 'analyzeOutboundCall failed'));
          } else {
            // Inbound call — use inbound learning system
            analyzeCall(orgId, callId, transcript, {
              duration_ms: durationMs ?? undefined,
              disconnection_reason: disconnectionReason ?? undefined,
              from_number: fromNumber ?? undefined,
              silence_duration_ms: silenceDurationMs ?? undefined,
            }).catch((err: Error) => req.log.error({ err: err.message, orgId, callId }, 'analyzeCall failed'));
          }
        }

        // Extract Retell's post-call-analysis custom fields (Phase 2).
        // For short calls the analysis is usually already done when call_ended
        // fires, so custom_analysis_data is present. For long calls Retell
        // sends a separate call_analyzed event later — see that branch below.
        const analysis = (call as RetellCallData & { call_analysis?: Record<string, unknown> }).call_analysis;
        const extracted = (analysis?.custom_analysis_data as Record<string, unknown> | undefined) ?? null;

        // Attach extracted variables to the ticket this call created, if any.
        // mergeTicketMetadata is org-scoped — Retell's HMAC only authenticates
        // the platform-wide event, not the target org, so we must match on
        // org_id to prevent cross-tenant metadata writes.
        if (extracted && callId && orgId) {
          mergeTicketMetadata(callId, orgId, extracted).catch((err: Error) =>
            req.log.warn({ err: err.message, orgId, callId }, 'mergeTicketMetadata failed'),
          );
        }

        // Inbound-webhook fan-out: deliver `call.ended` to customer URLs.
        // Fire-and-forget — customer outages must never delay our webhook ACK.
        if (orgId && callId) {
          fireInboundWebhooks(orgId, 'call.ended', {
            callId,
            agentId,
            direction: (call as RetellCallData & { metadata?: Record<string, unknown> }).metadata?.outboundRecordId ? 'outbound' : 'inbound',
            fromNumber: fromNumber ?? null,
            toNumber: toNumber ?? null,
            durationSec: durationMs ? Math.round(durationMs / 1000) : null,
            minutesBilled: minutes,
            disconnectionReason: disconnectionReason ?? null,
            startTimestamp: startTs,
            endTimestamp: endTs,
            variables: extracted ?? {},
          }).catch((err: Error) =>
            req.log.warn(
              { err: err.message, orgId, callId, event: 'call.ended' },
              'inbound-webhook fan-out failed',
            ),
          );
        }

        // Demo-call persistence: when the agent isn't bound to a paying org,
        // it might be one of our /demo/call agents. Look up by agent_id; if
        // it's a demo, insert into demo_calls so admins can review + promote
        // to crm_leads. The post_call_analysis_data fields (caller_name,
        // caller_email, caller_phone, intent_summary) come back in `extracted`
        // for short calls; for long calls they arrive later in call_analyzed.
        if (!orgId && callId && agentId) {
          const templateId = await readDemoCallTemplate(agentId);
          if (templateId && pool) {
            const cn = (extracted?.caller_name as string | undefined)?.trim() || null;
            const ce = (extracted?.caller_email as string | undefined)?.trim().toLowerCase() || null;
            const cp = (extracted?.caller_phone as string | undefined)?.trim() || null;
            const intent = (extracted?.intent_summary as string | undefined)?.trim() || null;
            // UPSERT — `call_analyzed` may arrive BEFORE `call_ended` for short
            // calls (Retell does not guarantee ordering). If call_analyzed
            // already inserted a stub row with only caller_*/intent fields,
            // the call_ended path here MUST fill in transcript/duration/
            // disconnection_reason via UPDATE. ON CONFLICT DO NOTHING (the
            // previous behaviour) would silently drop these fields, leaving
            // the demo_calls row half-populated. COALESCE keeps any earlier-
            // written analysis fields; transcript/duration are call_ended-
            // only so they always come from EXCLUDED.
            pool.query(
              `INSERT INTO demo_calls (call_id, agent_id, template_id, duration_sec, transcript, caller_name, caller_email, caller_phone, intent_summary, disconnection_reason)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (call_id) DO UPDATE SET
                 agent_id             = COALESCE(demo_calls.agent_id, EXCLUDED.agent_id),
                 template_id          = COALESCE(demo_calls.template_id, EXCLUDED.template_id),
                 duration_sec         = COALESCE(EXCLUDED.duration_sec, demo_calls.duration_sec),
                 transcript           = COALESCE(EXCLUDED.transcript, demo_calls.transcript),
                 caller_name          = COALESCE(demo_calls.caller_name, EXCLUDED.caller_name),
                 caller_email         = COALESCE(demo_calls.caller_email, EXCLUDED.caller_email),
                 caller_phone         = COALESCE(demo_calls.caller_phone, EXCLUDED.caller_phone),
                 intent_summary       = COALESCE(demo_calls.intent_summary, EXCLUDED.intent_summary),
                 disconnection_reason = COALESCE(EXCLUDED.disconnection_reason, demo_calls.disconnection_reason)`,
              [
                callId,
                agentId,
                templateId,
                durationMs ? Math.round(durationMs / 1000) : null,
                // Audit-Round-8 (Codex M07-MEDIUM-B): demo_calls keeps
                // transcripts for 90 days for promotion to leads. Redact PII
                // at write-time so credit-card / IBAN / phone / email / DOB
                // never sit raw in the table — admin-bulk-views and any
                // future leak surface only see the redacted form.
                transcript ? redactPII(transcript) : null,
                cn,
                ce,
                cp,
                intent,
                disconnectionReason ?? null,
              ],
            ).catch((err: Error) => req.log.error({ err: err.message, callId, templateId }, 'demo_calls insert failed'));
            // Post-call signup-link send: if Chipy asked + caller said "ja",
            // dispatch email/SMS now. Helper is internally fire-and-forget,
            // dedup'd via DB UPDATE-RETURNING claim. For SHORT calls Retell
            // attaches custom_analysis_data on call_ended; for long calls the
            // mirror in call_analyzed branch below handles it.
            if (extracted) {
              maybeSendDemoSignupLink(callId, extracted, req.log).catch((err: Error) =>
                req.log.warn({ err: err.message, callId }, 'maybeSendDemoSignupLink (call_ended) failed'),
              );
            }
          }
        }
      }
    }

    // Late-arriving post-call analysis for longer calls. Retell re-POSTs with
    // event='call_analyzed' once the transcript analysis finishes; we merge
    // the fresh custom_analysis_data into the ticket (JSONB concat preserves
    // any keys call_ended already wrote — first-writer-wins) and fan out the
    // `variable.extracted` event separately so customers can subscribe to
    // just the extraction without re-processing full call.ended payloads.
    if (event === 'call_analyzed') {
      const agentId = (call as RetellCallData).agent_id;
      const callId = (call as RetellCallData).call_id;

      // Audit-Round-10 BLOCKER 1: idempotency gate for call_analyzed (was only
      // on call_ended). Without this, Retell-retry on a slow handler runs
      // mergeTicketMetadata twice (idempotent via JSONB-COALESCE) AND
      // double-fires `variable.extracted` to customer webhooks (NOT idempotent
      // — customer sees the event twice). Composite PK (call_id, event_type)
      // lets call_ended and call_analyzed dedup independently for the same
      // call_id.
      if (callId && pool) {
        const claim = await pool.query(
          `INSERT INTO processed_retell_events (call_id, event_type)
           VALUES ($1, $2)
           ON CONFLICT (call_id, event_type) DO NOTHING
           RETURNING call_id`,
          [callId, 'call_analyzed'],
        );
        if (!claim.rowCount) {
          req.log.info({ callId }, 'retell call_analyzed dedup hit — skipping');
          return { ok: true, deduped: true };
        }
      }

      const analysis = (call as RetellCallData & { call_analysis?: Record<string, unknown> }).call_analysis;
      const extracted = (analysis?.custom_analysis_data as Record<string, unknown> | undefined) ?? null;
      const orgId = agentId ? await getOrgIdByAgentId(agentId) : null;

      if (extracted && callId && orgId) {
        await mergeTicketMetadata(callId, orgId, extracted).catch((err: Error) =>
          req.log.warn({ err: err.message, orgId, callId }, 'call_analyzed: mergeTicketMetadata failed'),
        );
      }

      if (orgId && callId && extracted) {
        fireInboundWebhooks(orgId, 'variable.extracted', {
          callId,
          agentId,
          variables: extracted,
        }).catch((err: Error) =>
          req.log.warn(
            { err: err.message, orgId, callId, event: 'variable.extracted' },
            'inbound-webhook fan-out failed',
          ),
        );
      }

      // Late-arriving extraction for demo calls. UPSERT (not bare UPDATE) so
      // that if call_analyzed actually arrives BEFORE call_ended (Retell does
      // not guarantee event ordering), we still create the demo_calls row
      // with the analysis fields — call_ended will then UPSERT and fill in
      // transcript/duration/disconnection_reason. COALESCE keeps the earlier
      // value when both events carry the same field, so a later (less
      // confident) extraction can't blank out an earlier one.
      if (!orgId && callId && agentId && extracted && pool) {
        const templateId = await readDemoCallTemplate(agentId);
        if (templateId) {
          const cn = (extracted.caller_name as string | undefined)?.trim() || null;
          const ce = (extracted.caller_email as string | undefined)?.trim().toLowerCase() || null;
          const cp = (extracted.caller_phone as string | undefined)?.trim() || null;
          const intent = (extracted.intent_summary as string | undefined)?.trim() || null;
          pool.query(
            `INSERT INTO demo_calls (call_id, agent_id, template_id, caller_name, caller_email, caller_phone, intent_summary)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (call_id) DO UPDATE SET
               caller_name    = COALESCE(demo_calls.caller_name, EXCLUDED.caller_name),
               caller_email   = COALESCE(demo_calls.caller_email, EXCLUDED.caller_email),
               caller_phone   = COALESCE(demo_calls.caller_phone, EXCLUDED.caller_phone),
               intent_summary = COALESCE(demo_calls.intent_summary, EXCLUDED.intent_summary)`,
            [callId, agentId, templateId, cn, ce, cp, intent],
          ).catch((err: Error) => req.log.warn({ err: err.message, callId }, 'demo_calls late-upsert failed'));
          // Post-call signup-link send for long calls — call_analyzed is the
          // primary path (call_ended above handles the short-call case where
          // analysis already arrived). Dedup is in the helper (DB UPDATE-
          // RETURNING) so a doppelt-fire across both branches is harmless.
          maybeSendDemoSignupLink(callId, extracted, req.log).catch((err: Error) =>
            req.log.warn({ err: err.message, callId }, 'maybeSendDemoSignupLink (call_analyzed) failed'),
          );
        }
      }
    }

    return { ok: true };
  });

  // ── Tool endpoints ─────────────────────────────────────────────────────────

  // --- customer.lookup ---
  app.post('/retell/tools/customer.lookup', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyRetellToolRequest(req as RawBodyRequest)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = req.body as RetellEventBody;
    const args = retellArgs(body);
    const ctx = await getToolOrgContext(req, body, args);

    await appendTraceEvent({
      type: 'tool_call',
      sessionId: ctx.callId,
      tenantId: ctx.orgId ?? undefined,
      agentId: ctx.agentId ?? undefined,
      tool: 'customer.lookup',
      input: args,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    let result: Record<string, unknown>;
    if (!ctx.orgId || !await isCustomerModuleActiveForTool(ctx.tenantId, ctx.orgId)) {
      result = {
        ok: true,
        status: 'disabled',
        instruction: 'Kundenmodul ist nicht aktiv. Stelle keine Bestandskunden-/Neukundenfrage und nutze den normalen Flow.',
      };
    } else {
      const phone = stringArg(args, 'customerPhone', 'customer_phone', 'phone', 'from_number') ?? await resolveCallerPhone(body, args, ctx.callId);
      const name = stringArg(args, 'customerName', 'customer_name', 'name');
      result = await lookupCustomer({ orgId: ctx.orgId, phone, name });
    }

    await appendTraceEvent({
      type: 'tool_result',
      sessionId: ctx.callId,
      tenantId: ctx.orgId ?? undefined,
      agentId: ctx.agentId ?? undefined,
      tool: 'customer.lookup',
      output: result,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    return result;
  });

  // --- customer.upsert ---
  app.post('/retell/tools/customer.upsert', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyRetellToolRequest(req as RawBodyRequest)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = req.body as RetellEventBody;
    const args = retellArgs(body);
    const ctx = await getToolOrgContext(req, body, args);

    await appendTraceEvent({
      type: 'tool_call',
      sessionId: ctx.callId,
      tenantId: ctx.orgId ?? undefined,
      agentId: ctx.agentId ?? undefined,
      tool: 'customer.upsert',
      input: args,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    let result: Record<string, unknown>;
    if (!ctx.orgId || !await isCustomerModuleActiveForTool(ctx.tenantId, ctx.orgId)) {
      result = {
        ok: true,
        status: 'disabled',
        instruction: 'Kundenmodul ist nicht aktiv. Speichere keine Kundendaten.',
      };
    } else {
      const customerName = stringArg(args, 'customerName', 'customer_name', 'name');
      if (!customerName || /^(unbekannt|unknown|anonymous)$/i.test(customerName)) {
        result = {
          ok: false,
          error: 'MISSING_CUSTOMER_NAME',
          instruction: 'Frage erst nach dem Namen, dann rufe customer_upsert erneut auf.',
        };
      } else {
        const customerPhone = stringArg(args, 'customerPhone', 'customer_phone', 'phone') ?? await resolveCallerPhone(body, args, ctx.callId);
        const details = {
          service: stringArg(args, 'service'),
          preferredTime: stringArg(args, 'preferredTime', 'preferred_time', 'time'),
          preferredStylist: stringArg(args, 'preferredStylist', 'preferred_stylist'),
          hairLength: stringArg(args, 'hairLength', 'hair_length'),
          hairHistory: stringArg(args, 'hairHistory', 'hair_history'),
          allergies: stringArg(args, 'allergies'),
          source: 'retell-tool',
        };
        const row = await upsertCustomer({
          orgId: ctx.orgId,
          fullName: customerName,
          phone: customerPhone,
          email: stringArg(args, 'email'),
          customerType: stringArg(args, 'customerType', 'customer_type') as 'new' | 'existing' | 'unknown' | undefined,
          notes: stringArg(args, 'notes'),
          sourceCallId: ctx.callId,
          details,
        });
        result = {
          ok: true,
          status: row ? 'saved' : 'not_persisted',
          customerId: row?.id ?? null,
          instruction: 'Kundendaten wurden still aktualisiert. Sage nicht, dass ein Datenbankeintrag erstellt wurde; fahre normal im Gespraech fort.',
        };
      }
    }

    await appendTraceEvent({
      type: 'tool_result',
      sessionId: ctx.callId,
      tenantId: ctx.orgId ?? undefined,
      agentId: ctx.agentId ?? undefined,
      tool: 'customer.upsert',
      output: result,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    return result;
  });

  // --- calendar.findSlots ---
  app.post('/retell/tools/calendar.findSlots', async (req: FastifyRequest, reply: FastifyReply) => {
    // Tool auth: see TOOL_AUTH_NOTE at top of file. Lifecycle webhook uses
    // strict HMAC; tool endpoints use the OR-fallback chain because Retell's
    // Custom-Function calls don't carry x-retell-signature.
    if (!verifyRetellToolRequest(req as RawBodyRequest)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = req.body as RetellEventBody;
    const args = retellArgs(body);
    const callId = getRetellCallId(body, args) ?? 'retell';
    const agentIdForSlots = getRetellAgentId(body, args);
    const signedTenantIdForSlots = getSignedToolTenantId(req);
    const orgIdForSlots = agentIdForSlots
      ? await getOrgIdByAgentId(agentIdForSlots)
      : signedTenantIdForSlots
        ? await getOrgIdByTenantId(signedTenantIdForSlots)
        : null;

    await appendTraceEvent({
      type: 'tool_call',
      sessionId: callId,
      tenantId: orgIdForSlots ?? undefined,
      agentId: agentIdForSlots ?? undefined,
      tool: 'calendar.findSlots',
      input: args,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    let result: {
      ok: boolean;
      source: string;
      slots: string[];
      service?: unknown;
      range?: unknown;
      preferredTime?: unknown;
      preferredStylist?: unknown;
      staffId?: string | null;
      allSlotsCount?: number;
      moreCount?: number;
      instruction?: string;
    };

    if (orgIdForSlots) {
      const staff = await resolveCalendarStaffForTool(orgIdForSlots, args);
      const { slots, source } = await findFreeSlots(orgIdForSlots, {
        date: (args.date as string | undefined) ?? (args.preferredTime as string | undefined),
        range: args.range as string | undefined,
        service: args.service as string | undefined,
        staffId: staff.staffId,
      });
      result = {
        ok: true,
        source,
        ...compactRetellSlots(slots),
        service: args.service ?? null,
        range: args.range ?? null,
        preferredTime: args.preferredTime ?? null,
        preferredStylist: staff.matchedName ?? staff.requested,
        staffId: staff.staffId,
        ...(staff.requested && !staff.staffId ? { instruction: 'Der Wunschfriseur wurde nicht eindeutig gefunden. Biete die gefundenen Salon-Termine an oder frage kurz nach einem anderen Mitarbeiter.' } : {}),
      };
    } else {
      // Fallback: no calendar connected — return demo slots
      result = {
        ok: true,
        source: 'demo',
        slots: ['Dienstag 10:00', 'Mittwoch 14:00', 'Donnerstag 09:30'],
        service: args.service ?? null,
        range: args.range ?? null,
        preferredTime: args.preferredTime ?? null,
        preferredStylist: args.preferredStylist ?? args.preferred_stylist ?? null,
      };
    }

    await appendTraceEvent({
      type: 'tool_result',
      sessionId: callId,
      tenantId: orgIdForSlots ?? undefined,
      agentId: agentIdForSlots ?? undefined,
      tool: 'calendar.findSlots',
      output: result,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    return result;
  });

  // --- calendar.book ---
  app.post('/retell/tools/calendar.book', async (req: FastifyRequest, reply: FastifyReply) => {
    // Tool auth: see TOOL_AUTH_NOTE at top of file. Lifecycle webhook uses
    // strict HMAC; tool endpoints use the OR-fallback chain because Retell's
    // Custom-Function calls don't carry x-retell-signature.
    if (!verifyRetellToolRequest(req as RawBodyRequest)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = req.body as RetellEventBody;
    const args = retellArgs(body);
    const callId = getRetellCallId(body, args) ?? 'retell';
    const agentIdForBook = getRetellAgentId(body, args);
    const signedTenantIdForBook = getSignedToolTenantId(req);
    const orgIdForBook = agentIdForBook
      ? await getOrgIdByAgentId(agentIdForBook)
      : signedTenantIdForBook
        ? await getOrgIdByTenantId(signedTenantIdForBook)
        : null;

    await appendTraceEvent({
      type: 'tool_call',
      sessionId: callId,
      tenantId: orgIdForBook ?? undefined,
      agentId: agentIdForBook ?? undefined,
      tool: 'calendar.book',
      input: args,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    let result: Record<string, unknown>;

    if (orgIdForBook) {
      const customerName = (args.customerName as string | undefined) ?? 'Unbekannt';
      const customerPhone = await resolveCallerPhone(body, args, callId);
      const preferredTime = (args.preferredTime as string | undefined) ?? (args.time as string | undefined) ?? '';
      const staff = await resolveCalendarStaffForTool(orgIdForBook, args);
      const service = (args.service as string | undefined) ?? '';
      const notes = args.notes as string | undefined;
      if (staff.requested && !staff.staffId) {
        result = {
          ok: false,
          status: 'staff_not_found',
          error: 'STAFF_NOT_FOUND',
          message: 'Der Wunschfriseur wurde nicht eindeutig gefunden.',
          instruction: 'Buche keinen allgemeinen Salon-Termin. Frage kurz nach einem anderen Mitarbeiter oder ob ein beliebiger verfuegbarer Mitarbeiter passt.',
          customerName,
          customerPhone,
          preferredTime,
          preferredStylist: staff.requested,
          staffId: null,
          service,
        };
      } else {
        const businessName = await getOrgName(orgIdForBook);
        const booking = await bookSlot(orgIdForBook, {
          customerName,
          customerPhone,
          time: preferredTime,
          service,
          notes,
          sourceCallId: callId,
          staffId: staff.staffId,
        });

        if (!booking.ok) {
          try {
            const ticket = await createTicket({
              tenantId: signedTenantIdForBook ?? orgIdForBook,
              source: 'phone',
              sessionId: callId,
              reason: 'calendar-unavailable',
              customerName,
              customerPhone: ticketPhoneOrUnknown(customerPhone),
              preferredTime,
              service,
              notes,
            }, { allowUnverifiedPhone: true });
            const sms = await sendTicketAckSms({
              to: ticket.customer_phone,
              businessName,
              reason: 'calendar-unavailable',
              service,
              logger: req.log,
            });

            result = {
              ok: true,
              status: 'fallback_ticket_created',
              fallback: true,
              ticketId: ticket.id,
              ticketStatus: ticket.status,
              error: booking.error ?? null,
              chipyBookingId: booking.chipyBookingId ?? null,
              externalResults: booking.externalResults ?? [],
              partial: booking.partial ?? false,
              smsSent: sms.ok,
              smsError: sms.ok ? null : sms.error,
              message: 'Kalenderbuchung fehlgeschlagen, Rueckruf-Ticket wurde erstellt.',
              customerName,
              customerPhone: ticket.customer_phone,
              preferredTime,
              preferredStylist: staff.matchedName ?? staff.requested,
              staffId: staff.staffId,
              service,
            };
          } catch (e: unknown) {
            const code = (e as { code?: string })?.code;
            req.log.error(
              {
                err: e instanceof Error ? e.message : String(e),
                code,
                orgId: orgIdForBook,
                callId,
              },
              'retell calendar.book fallback ticket failed',
            );
            result = {
              ok: false,
              status: 'failed',
              fallback: false,
              error: booking.error ?? 'CALENDAR_BOOK_FAILED',
              fallbackError: code ?? 'TICKET_CREATE_FAILED',
              chipyBookingId: booking.chipyBookingId ?? null,
              externalResults: booking.externalResults ?? [],
              partial: booking.partial ?? false,
              customerName,
              customerPhone,
              preferredTime,
              preferredStylist: staff.matchedName ?? staff.requested,
              staffId: staff.staffId,
              service,
            };
          }
        } else {
          const sms = await sendBookingConfirmationSms({
            to: customerPhone,
            businessName,
            customerName,
            service,
            preferredTime,
            logger: req.log,
          });
          result = {
            ok: booking.ok,
            status: booking.ok ? 'confirmed' : 'failed',
            eventId: booking.eventId ?? null,
            bookingId: booking.bookingId ?? null,
            chipyBookingId: booking.chipyBookingId ?? null,
            externalResults: booking.externalResults ?? [],
            partial: booking.partial ?? false,
            error: booking.error ?? null,
            smsSent: sms.ok,
            smsError: sms.ok ? null : sms.error,
            customerName,
            customerPhone,
            preferredTime,
            preferredStylist: staff.matchedName ?? staff.requested,
            staffId: staff.staffId,
            service,
          };
        }
      }
    } else {
      // Fallback: no org/calendar — confirm as demo
      result = {
        ok: true,
        status: 'confirmed',
        bookingId: `demo_${Date.now()}`,
        customerName: args.customerName ?? null,
        customerPhone: args.customerPhone ?? null,
        preferredTime: args.preferredTime ?? args.time ?? null,
        service: args.service ?? null,
        notes: args.notes ?? null,
      };
    }

    if (orgIdForBook) {
      await maybeUpsertCustomerFromTool({
        tenantId: signedTenantIdForBook ?? orgIdForBook,
        orgId: orgIdForBook,
        callId,
        customerName: (result.customerName as string | undefined) ?? (args.customerName as string | undefined),
        customerPhone: (result.customerPhone as string | undefined) ?? await resolveCallerPhone(body, args, callId),
        customerType: 'unknown',
        details: {
          service: result.service,
          preferredTime: result.preferredTime,
          preferredStylist: result.preferredStylist,
          bookingStatus: result.status,
          source: 'calendar.book',
        },
        notes: args.notes as string | undefined,
        log: req.log,
      });
    }

    await appendTraceEvent({
      type: 'tool_result',
      sessionId: callId,
      tenantId: orgIdForBook ?? undefined,
      agentId: agentIdForBook ?? undefined,
      tool: 'calendar.book',
      output: result,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    return result;
  });

  // --- ticket.create ---
  app.post('/retell/tools/ticket.create', async (req: FastifyRequest, reply: FastifyReply) => {
    // Tool auth: see TOOL_AUTH_NOTE at top of file. Lifecycle webhook uses
    // strict HMAC; tool endpoints use the OR-fallback chain because Retell's
    // Custom-Function calls don't carry x-retell-signature.
    if (!verifyRetellToolRequest(req as RawBodyRequest)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = req.body as RetellEventBody;
    const args = retellArgs(body);
    const callId = getRetellCallId(body, args) ?? 'retell';
    const signedTenantId = getSignedToolTenantId(req);

    // Resolve tenantId from the agent_id in the request. Refuse when we can't
    // map — previously we silently fell back to tenantId='demo', which caused
    // unknown-agent webhooks to land in the demo silo and mix with real demo
    // tickets. Signature was already verified, so a 403 here means either a
    // stale Retell agent (we deleted it) or a misconfigured webhook URL.
    const agentId = getRetellAgentId(body, args);
    const orgId = agentId
      ? await getOrgIdByAgentId(agentId)
      : signedTenantId
        ? await getOrgIdByTenantId(signedTenantId)
        : null;
    if (!orgId) {
      req.log.warn({ agentId }, 'retell ticket.create: unknown agent_id, refusing');
      return reply.status(403).send({ error: 'unknown agent' });
    }
    const tenantId = signedTenantId ?? orgId;

    await appendTraceEvent({
      type: 'tool_call',
      sessionId: callId,
      tenantId: orgId ?? undefined,
      agentId: agentId ?? undefined,
      tool: 'ticket.create',
      input: args,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    try {
      const preferredTime = args.preferredTime as string | undefined;
      const row = await createTicket({
        tenantId,
        source: 'phone',
        sessionId: callId,
        reason: (args.reason as string | undefined) ?? 'handoff',
        customerName: args.customerName as string | undefined,
        customerPhone: ticketPhoneOrUnknown(await resolveCallerPhone(body, args, callId)),
        preferredTime,
        service: args.service as string | undefined,
        notes: args.notes as string | undefined,
      }, { allowUnverifiedPhone: true });

      // Auto-trigger callback if customer wants immediate callback
      const isImmediate = !preferredTime
        || /sofort|jetzt|now|asap|gleich|baldmöglich/i.test(preferredTime);

      if (isImmediate && orgId && row.customer_phone && isCallbackSafePhone(row.customer_phone)) {
        // Fire-and-forget — don't block the agent's response
        triggerCallback({
          orgId,
          customerPhone: row.customer_phone,
          customerName: row.customer_name,
          reason: row.reason,
          service: row.service,
        }).catch(logBg('triggerCallback', { orgId }));
      }

      // Inbound-webhook fan-out: deliver `ticket.created` to customer URLs.
      fireInboundWebhooks(orgId, 'ticket.created', {
        ticketId: row.id,
        status: row.status,
        reason: row.reason,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        preferredTime: row.preferred_time,
        service: row.service,
        callId,
      }).catch((err: Error) =>
        req.log.warn(
          { err: err.message, orgId, ticketId: row.id, event: 'ticket.created' },
          'inbound-webhook fan-out failed',
        ),
      );

      const sms = await sendTicketAckSms({
        to: row.customer_phone,
        businessName: await getOrgName(orgId),
        reason: row.reason,
        service: row.service,
        logger: req.log,
      });

      const result = {
        ok: true,
        ticketId: row.id,
        status: row.status,
        customerPhone: row.customer_phone,
        callbackScheduled: isImmediate && !!orgId,
        smsSent: sms.ok,
        smsError: sms.ok ? null : sms.error,
      };

      await maybeUpsertCustomerFromTool({
        tenantId,
        orgId,
        callId,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        customerType: 'unknown',
        details: {
          service: row.service,
          preferredTime: row.preferred_time,
          reason: row.reason,
          source: 'ticket.create',
        },
        notes: row.notes,
        log: req.log,
      });

      await appendTraceEvent({
        type: 'tool_result',
        sessionId: callId,
        tenantId: orgId ?? undefined,
        agentId: agentId ?? undefined,
        tool: 'ticket.create',
        output: result,
        at: now(),
      } as Parameters<typeof appendTraceEvent>[0]);

      return result;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      const result = {
        ok: false,
        error: code === 'INVALID_PHONE' ? 'INVALID_PHONE' : 'INTERNAL',
        message: code === 'INVALID_PHONE'
          ? 'Telefonnummer fehlt oder ist ungueltig. Bitte nach einer Rueckrufnummer fragen.'
          : 'Ticket konnte nicht erstellt werden.',
      };
      req.log.warn(
        {
          err: e instanceof Error ? e.message : String(e),
          code,
          orgId,
          tenantId,
          callId,
        },
        'retell ticket.create failed',
      );
      await appendTraceEvent({
        type: 'tool_result',
        sessionId: callId,
        tenantId: orgId ?? undefined,
        agentId: agentId ?? undefined,
        tool: 'ticket.create',
        output: result,
        at: now(),
      } as Parameters<typeof appendTraceEvent>[0]);
      return result;
    }
  });

  // ── recording_declined ─────────────────────────────────────────────────
  // Agent invokes this when the caller withdraws consent to recording.
  // We persist a flag keyed by call_id; call_ended handler reads it,
  // skips transcript DB insert + analyzeCall, and DELETEs the call from
  // Retell so audio + transcript are scrubbed.
  app.post('/retell/tools/recording.declined', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyRetellToolRequest(req as RawBodyRequest)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = req.body as RetellEventBody;
    const args = retellArgs(body);
    const callId = getRetellCallId(body, args);
    const agentId = getRetellAgentId(body, args);
    const signedTenantId = getSignedToolTenantId(req);
    const orgId = agentId
      ? await getOrgIdByAgentId(agentId)
      : signedTenantId
        ? await getOrgIdByTenantId(signedTenantId)
        : null;

    if (!callId) {
      req.log.warn({ agentId }, 'recording.declined: no call_id in body');
      return { ok: true };
    }

    // CRITICAL DSGVO/§201 StGB path: if this insert silently fails, call_ended
    // won't see the flag and will persist the transcript despite the caller's
    // explicit withdrawal of consent. We need a HARD error here so Retell + the
    // LLM know the decline was not stored — then the agent can ask the caller
    // to repeat / hang up safely instead of pretending everything is fine.
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO recording_declined_calls (call_id, org_id, tenant_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (call_id) DO NOTHING`,
          [callId, orgId, signedTenantId ?? null],
        );
      } catch (err) {
        req.log.error(
          { err: (err as Error).message, callId, orgId },
          'recording.declined: storage failed — refusing tool with 503 so transcript is NOT silently kept',
        );
        return reply.status(503).send({
          ok: false,
          error: 'STORAGE_UNAVAILABLE',
          message:
            'Konnte den Widerspruch nicht speichern. Bitte wiederhole den Wunsch oder beende den Anruf.',
        });
      }
    }

    await appendTraceEvent({
      type: 'tool_call',
      sessionId: callId,
      tenantId: orgId ?? undefined,
      agentId: agentId ?? undefined,
      tool: 'recording.declined',
      input: args,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    return { ok: true };
  });

  // ── external.call — proxy for customer API integrations ────────────────
  // Every tool URL registered by api-integrations.ts points here with
  // integration_id (+ optional endpoint_id) in the query string. The
  // integration's authValue is decrypted server-side ONLY here; Retell
  // never sees it. See api-integrations.ts for the full security model
  // (SSRF guard, method whitelist, response-size cap, per-call rate limit).
  app.post('/retell/tools/external.call', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyRetellToolRequest(req as RawBodyRequest)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const query = req.query as Record<string, string | undefined>;
    const integrationId = query.integration_id;
    const endpointId = query.endpoint_id;
    const signedTenantId = getSignedToolTenantId(req);
    if (!integrationId) return reply.status(400).send({ ok: false, error: 'NO_INTEGRATION_ID' });

    const body = req.body as RetellEventBody;
    const args = retellArgs(body);
    const callId = getRetellCallId(body, args);
    const agentId = getRetellAgentId(body, args);

    // Tenant resolution: prefer signed tenant param (comes from our own
    // tool registration), fall back to agent_id → org lookup for a
    // defence-in-depth cross-check.
    const orgIdFromAgent = agentId ? await getOrgIdByAgentId(agentId) : null;
    const tenantId = signedTenantId ?? orgIdFromAgent;
    if (!tenantId) {
      req.log.warn({ agentId, integrationId }, 'external.call: could not resolve tenant');
      return reply.status(403).send({ ok: false, error: 'UNKNOWN_TENANT' });
    }

    // Load config — use the READ path that returns the encrypted authValue
    // (readConfig, NOT the HTTP-masked view). Both args are tenantId here:
    // tenantId was already resolved from a signed param OR an agent_id DB
    // lookup above, so it is the trusted org context for this call.
    const config = await readConfig(tenantId, tenantId).catch(() => null);
    if (!config) return reply.status(404).send({ ok: false, error: 'CONFIG_NOT_FOUND' });

    const integrations = (config as Record<string, unknown>).apiIntegrations as
      | ApiIntegration[] | undefined;
    const integration = integrations?.find((i) => i.id === integrationId);
    if (!integration || !integration.enabled) {
      return reply.status(404).send({ ok: false, error: 'INTEGRATION_NOT_FOUND' });
    }

    const endpoint = endpointId ? integration.endpoints?.find((e) => e.id === endpointId) : undefined;
    if (endpointId && !endpoint) {
      return reply.status(404).send({ ok: false, error: 'ENDPOINT_NOT_FOUND' });
    }

    // Trace param *names* only — never values. LLM-extracted args can contain
    // caller PII (names, phone numbers, customer IDs) that we must not persist
    // under DSGVO Art. 5(1)(c) Datenminimierung. The integration+endpoint name
    // is enough for debugging the routing.
    await appendTraceEvent({
      type: 'tool_call',
      sessionId: callId ?? 'retell',
      tenantId,
      agentId: agentId ?? undefined,
      tool: `external:${integration.name}${endpoint ? `:${endpoint.name}` : ''}`,
      input: { argKeys: Object.keys(args) },
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    const result = await executeIntegrationCall({
      integration,
      endpoint,
      args,
      callId: callId ?? undefined,
    });

    await appendTraceEvent({
      type: 'tool_result',
      sessionId: callId ?? 'retell',
      tenantId,
      agentId: agentId ?? undefined,
      tool: `external:${integration.name}${endpoint ? `:${endpoint.name}` : ''}`,
      output: result.ok ? { status: result.status } : { error: result.error, status: result.status },
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    return result;
  });
}
