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
import { createTicket } from './tickets.js';
import { appendTraceEvent } from './traces.js';
import { incrementMinutesUsed } from './usage.js';
import { pool } from './db.js';
import { findFreeSlots, bookSlot } from './calendar.js';
import { triggerCallback } from './agent-config.js';
import { analyzeCall } from './insights.js';

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
 * Look up org_id from agent_configs by retellAgentId stored in the JSONB data column.
 * Returns null when not found.
 */
async function getOrgIdByAgentId(agentId: string): Promise<string | null> {
  if (!pool) return null;
  const res = await pool.query(
    `SELECT org_id FROM agent_configs WHERE data->>'retellAgentId' = $1 LIMIT 1`,
    [agentId],
  );
  return (res.rows[0]?.org_id as string | undefined) ?? null;
}

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

export async function registerRetellWebhooks(app: FastifyInstance) {
  // ── Call lifecycle webhook ─────────────────────────────────────────────────
  // Retell sends call_started, call_ended, call_analyzed events here.
  app.post('/retell/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyRetellSignature(req as RawBodyRequest)) {
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const body = req.body as RetellEventBody;
    const event = body?.event ?? body?.call?.call_status;
    const call = body?.call ?? body;

    if (event === 'call_ended') {
      const startTs = (call as RetellCallData).start_timestamp;
      const endTs = (call as RetellCallData).end_timestamp;
      const agentId = (call as RetellCallData).agent_id;

      if (startTs && endTs && agentId) {
        const callDurationMs = Math.max(0, endTs - startTs);
        const minutes = Math.ceil(callDurationMs / 60000);

        const orgId = await getOrgIdByAgentId(agentId);
        if (orgId) {
          await incrementMinutesUsed(orgId, minutes);
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
    if (!verifyRetellSignature(req as RawBodyRequest)) {
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const body = req.body as RetellEventBody;
    const args = (body?.args ?? body ?? {}) as Record<string, unknown>;

    const agentIdForSlots = (args._retell_agent_id as string | undefined) ?? (args.agent_id as string | undefined);
    const orgIdForSlots = agentIdForSlots ? await getOrgIdByAgentId(agentIdForSlots) : null;

    await appendTraceEvent({
      type: 'tool_call',
      sessionId: (args._retell_call_id as string | undefined) ?? 'retell',
      tenantId: orgIdForSlots ?? undefined,
      tool: 'calendar.findSlots',
      input: args,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    let result: { ok: boolean; source: string; slots: string[]; service?: unknown; range?: unknown; preferredTime?: unknown };

    if (orgIdForSlots) {
      const { slots, source } = await findFreeSlots(orgIdForSlots, {
        date: args.date as string | undefined,
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
      sessionId: (args._retell_call_id as string | undefined) ?? 'retell',
      tenantId: orgIdForSlots ?? undefined,
      tool: 'calendar.findSlots',
      output: result,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    return result;
  });

  // --- calendar.book ---
  app.post('/retell/tools/calendar.book', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyRetellSignature(req as RawBodyRequest)) {
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const body = req.body as RetellEventBody;
    const args = (body?.args ?? body ?? {}) as Record<string, unknown>;

    const agentIdForBook = (args._retell_agent_id as string | undefined) ?? (args.agent_id as string | undefined);
    const orgIdForBook = agentIdForBook ? await getOrgIdByAgentId(agentIdForBook) : null;

    await appendTraceEvent({
      type: 'tool_call',
      sessionId: (args._retell_call_id as string | undefined) ?? 'retell',
      tenantId: orgIdForBook ?? undefined,
      tool: 'calendar.book',
      input: args,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    let result: Record<string, unknown>;

    if (orgIdForBook) {
      const booking = await bookSlot(orgIdForBook, {
        customerName: (args.customerName as string | undefined) ?? 'Unbekannt',
        customerPhone: (args.customerPhone as string | undefined) ?? '',
        time: (args.preferredTime as string | undefined) ?? (args.time as string | undefined) ?? '',
        service: (args.service as string | undefined) ?? '',
        notes: args.notes as string | undefined,
      });
      result = {
        ok: booking.ok,
        status: booking.ok ? 'confirmed' : 'failed',
        eventId: booking.eventId ?? null,
        bookingId: booking.bookingId ?? null,
        error: booking.error ?? null,
        customerName: args.customerName ?? null,
        customerPhone: args.customerPhone ?? null,
        preferredTime: args.preferredTime ?? args.time ?? null,
        service: args.service ?? null,
      };
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
      sessionId: (args._retell_call_id as string | undefined) ?? 'retell',
      tenantId: orgIdForBook ?? undefined,
      tool: 'calendar.book',
      output: result,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    return result;
  });

  // --- ticket.create ---
  app.post('/retell/tools/ticket.create', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyRetellSignature(req as RawBodyRequest)) {
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const body = req.body as RetellEventBody;
    const args = (body?.args ?? body ?? {}) as Record<string, unknown>;

    // Resolve tenantId from the agent_id in the request. Refuse when we can't
    // map — previously we silently fell back to tenantId='demo', which caused
    // unknown-agent webhooks to land in the demo silo and mix with real demo
    // tickets. Signature was already verified, so a 403 here means either a
    // stale Retell agent (we deleted it) or a misconfigured webhook URL.
    const agentId = (args._retell_agent_id as string | undefined) ?? (args.agent_id as string | undefined);
    const orgId = agentId ? await getOrgIdByAgentId(agentId) : null;
    if (!orgId) {
      req.log.warn({ agentId }, 'retell ticket.create: unknown agent_id, refusing');
      return reply.status(403).send({ error: 'unknown agent' });
    }
    const tenantId = orgId;

    await appendTraceEvent({
      type: 'tool_call',
      sessionId: (args._retell_call_id as string | undefined) ?? 'retell',
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
        sessionId: args._retell_call_id as string | undefined,
        reason: (args.reason as string | undefined) ?? 'handoff',
        customerName: args.customerName as string | undefined,
        customerPhone: (args.customerPhone as string | undefined) ?? '',
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
        }).catch(() => {});
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
        sessionId: (args._retell_call_id as string | undefined) ?? 'retell',
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
