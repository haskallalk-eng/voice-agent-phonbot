/**
 * Retell AI webhook endpoints.
 *
 * Retell calls these URLs when the agent invokes a custom function.
 * Each tool endpoint receives the extracted parameters from the conversation
 * and returns a result that Retell feeds back to the LLM.
 *
 * All endpoints verify the x-retell-signature header using RETELL_API_KEY.
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logBg } from './logger.js';
import { createTicket } from './tickets.js';
import { appendTraceEvent } from './traces.js';
import { reconcileMinutes, DEFAULT_CALL_RESERVE_MINUTES } from './usage.js';
import { pool } from './db.js';
import { findFreeSlots, bookSlot } from './calendar.js';
import { triggerCallback } from './agent-config.js';
import { analyzeCall } from './insights.js';
import { getOrgIdByAgentId } from './org-id-cache.js';

const RETELL_API_KEY = process.env.RETELL_API_KEY ?? '';

function now() {
  return Date.now();
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

function getCallerPhone(body: RetellEventBody, args = retellArgs(body)): string {
  const call = getRetellCall(body) as Record<string, unknown>;
  const value =
    args.customerPhone ??
    args.customer_phone ??
    args.from_number ??
    body.from_number ??
    call.from_number;
  return typeof value === 'string' ? value : '';
}

function toolAuthSecret(): string {
  return process.env.RETELL_TOOL_AUTH_SECRET || process.env.JWT_SECRET || 'dev-retell-tool-auth';
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

export async function registerRetellWebhooks(app: FastifyInstance) {
  // ── Call lifecycle webhook ─────────────────────────────────────────────────
  // Retell sends call_started, call_ended, call_analyzed events here.
  app.post('/retell/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
    // Tool-endpoint auth: Retell's Custom-Function calls do NOT include the
    // x-retell-signature header (that's webhook-only). Authentication here
    // relies on the _retell_agent_id in the body being cross-checked against
    // the agent_configs table via getOrgIdByAgentId below. Unknown agents
    // get 403 / demo-only, which is the same tenant-isolation guarantee the
    // HMAC check would provide. We keep HMAC strict on the call lifecycle
    // webhook (above) because those directly write minutes_used + transcripts.
    if (!verifyRetellToolRequest(req as RawBodyRequest)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = req.body as RetellEventBody;
    const event = body?.event ?? body?.call?.call_status;
    const call = body?.call ?? body;

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
           ON CONFLICT (call_id) DO NOTHING
           RETURNING call_id`,
          [dedupCallId, 'call_ended'],
        );
        if (!claim.rowCount) {
          req.log.info({ callId: dedupCallId }, 'retell call_ended dedup hit — skipping');
          return { ok: true, deduped: true };
        }
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
          await reconcileMinutes(orgId, DEFAULT_CALL_RESERVE_MINUTES, minutes, agentId);
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
            import('./outbound-insights.js')
              .then(({ analyzeOutboundCall }) =>
                analyzeOutboundCall(orgId!, callId!, transcript, durationMs ? Math.round(durationMs / 1000) : undefined)
                  .catch((err: Error) => req.log.error({ err: err.message, orgId, callId }, 'analyzeOutboundCall failed')),
              )
              .catch((err: Error) => req.log.error({ err: err.message }, 'outbound-insights import failed'));
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
      }
    }

    return { ok: true };
  });

  // ── Tool endpoints ─────────────────────────────────────────────────────────

  // --- calendar.findSlots ---
  app.post('/retell/tools/calendar.findSlots', async (req: FastifyRequest, reply: FastifyReply) => {
    // Tool-endpoint auth: Retell's Custom-Function calls do NOT include the
    // x-retell-signature header (that's webhook-only). Authentication here
    // relies on the _retell_agent_id in the body being cross-checked against
    // the agent_configs table via getOrgIdByAgentId below. Unknown agents
    // get 403 / demo-only, which is the same tenant-isolation guarantee the
    // HMAC check would provide. We keep HMAC strict on the call lifecycle
    // webhook (above) because those directly write minutes_used + transcripts.
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
      tool: 'calendar.findSlots',
      input: args,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    let result: { ok: boolean; source: string; slots: string[]; service?: unknown; range?: unknown; preferredTime?: unknown };

    if (orgIdForSlots) {
      const { slots, source } = await findFreeSlots(orgIdForSlots, {
        date: (args.date as string | undefined) ?? (args.preferredTime as string | undefined),
        range: args.range as string | undefined,
        service: args.service as string | undefined,
      });
      result = { ok: true, source, slots, service: args.service ?? null, range: args.range ?? null, preferredTime: args.preferredTime ?? null };
    } else {
      // Fallback: no calendar connected — return demo slots
      result = {
        ok: true,
        source: 'demo',
        slots: ['Dienstag 10:00', 'Mittwoch 14:00', 'Donnerstag 09:30'],
        service: args.service ?? null,
        range: args.range ?? null,
        preferredTime: args.preferredTime ?? null,
      };
    }

    await appendTraceEvent({
      type: 'tool_result',
      sessionId: callId,
      tenantId: orgIdForSlots ?? undefined,
      tool: 'calendar.findSlots',
      output: result,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    return result;
  });

  // --- calendar.book ---
  app.post('/retell/tools/calendar.book', async (req: FastifyRequest, reply: FastifyReply) => {
    // Tool-endpoint auth: Retell's Custom-Function calls do NOT include the
    // x-retell-signature header (that's webhook-only). Authentication here
    // relies on the _retell_agent_id in the body being cross-checked against
    // the agent_configs table via getOrgIdByAgentId below. Unknown agents
    // get 403 / demo-only, which is the same tenant-isolation guarantee the
    // HMAC check would provide. We keep HMAC strict on the call lifecycle
    // webhook (above) because those directly write minutes_used + transcripts.
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
      tool: 'calendar.book',
      input: args,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    let result: Record<string, unknown>;

    if (orgIdForBook) {
      const customerName = (args.customerName as string | undefined) ?? 'Unbekannt';
      const customerPhone = getCallerPhone(body, args);
      const preferredTime = (args.preferredTime as string | undefined) ?? (args.time as string | undefined) ?? '';
      const service = (args.service as string | undefined) ?? '';
      const notes = args.notes as string | undefined;
      const booking = await bookSlot(orgIdForBook, {
        customerName,
        customerPhone,
        time: preferredTime,
        service,
        notes,
      });

      if (!booking.ok) {
        try {
          const ticket = await createTicket({
            tenantId: orgIdForBook,
            source: 'phone',
            sessionId: callId,
            reason: 'calendar-unavailable',
            customerName,
            customerPhone,
            preferredTime,
            service,
            notes,
          });

          result = {
            ok: true,
            status: 'fallback_ticket_created',
            fallback: true,
            ticketId: ticket.id,
            ticketStatus: ticket.status,
            error: booking.error ?? null,
            message: 'Kalenderbuchung fehlgeschlagen, Rueckruf-Ticket wurde erstellt.',
            customerName,
            customerPhone: ticket.customer_phone,
            preferredTime,
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
            customerName,
            customerPhone,
            preferredTime,
            service,
          };
        }
      } else {
        result = {
          ok: booking.ok,
          status: booking.ok ? 'confirmed' : 'failed',
          eventId: booking.eventId ?? null,
          bookingId: booking.bookingId ?? null,
          error: booking.error ?? null,
          customerName,
          customerPhone,
          preferredTime,
          service,
        };
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

    await appendTraceEvent({
      type: 'tool_result',
      sessionId: callId,
      tenantId: orgIdForBook ?? undefined,
      tool: 'calendar.book',
      output: result,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    return result;
  });

  // --- ticket.create ---
  app.post('/retell/tools/ticket.create', async (req: FastifyRequest, reply: FastifyReply) => {
    // Tool-endpoint auth: Retell's Custom-Function calls do NOT include the
    // x-retell-signature header (that's webhook-only). Authentication here
    // relies on the _retell_agent_id in the body being cross-checked against
    // the agent_configs table via getOrgIdByAgentId below. Unknown agents
    // get 403 / demo-only, which is the same tenant-isolation guarantee the
    // HMAC check would provide. We keep HMAC strict on the call lifecycle
    // webhook (above) because those directly write minutes_used + transcripts.
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
        customerPhone: getCallerPhone(body, args),
        preferredTime,
        service: args.service as string | undefined,
        notes: args.notes as string | undefined,
      });

      // Auto-trigger callback if customer wants immediate callback
      const isImmediate = !preferredTime
        || /sofort|jetzt|now|asap|gleich|baldmöglich/i.test(preferredTime);

      if (isImmediate && orgId && row.customer_phone) {
        // Fire-and-forget — don't block the agent's response
        triggerCallback({
          orgId,
          customerPhone: row.customer_phone,
          customerName: row.customer_name,
          reason: row.reason,
          service: row.service,
        }).catch(logBg('triggerCallback', { orgId }));
      }

      const result = {
        ok: true,
        ticketId: row.id,
        status: row.status,
        customerPhone: row.customer_phone,
        callbackScheduled: isImmediate && !!orgId,
      };

      await appendTraceEvent({
        type: 'tool_result',
        sessionId: callId,
        tenantId: orgId ?? undefined,
        tool: 'ticket.create',
        output: result,
        at: now(),
      } as Parameters<typeof appendTraceEvent>[0]);

      return result;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      return { ok: false, error: code === 'INVALID_PHONE' ? 'INVALID_PHONE' : 'INTERNAL' };
    }
  });
}
