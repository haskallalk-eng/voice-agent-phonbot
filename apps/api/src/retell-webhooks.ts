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
  if (!RETELL_API_KEY) return true; // dev mode — skip verification

  const signature = (req.headers['x-retell-signature'] as string) ?? '';
  const rawBody: string =
    typeof req.rawBody === 'string'
      ? req.rawBody
      : Buffer.isBuffer(req.rawBody)
        ? req.rawBody.toString()
        : JSON.stringify(req.body ?? {});

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
  call_status?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  agent_id?: string;
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
        const durationSeconds = Math.max(0, endTs - startTs);
        const minutes = Math.ceil(durationSeconds / 60);

        const orgId = await getOrgIdByAgentId(agentId);
        if (orgId) {
          await incrementMinutesUsed(orgId, minutes);
        }

        // AI analysis — fire and forget, never blocks the webhook response
        const transcript = (call as RetellCallData & { transcript?: string }).transcript;
        const callId = (call as RetellCallData).call_id;
        if (orgId && callId && transcript) {
          analyzeCall(orgId, callId, transcript).catch(() => {});
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

    await appendTraceEvent({
      type: 'tool_call',
      sessionId: (args._retell_call_id as string | undefined) ?? 'retell',
      tool: 'ticket.create',
      input: args,
      at: now(),
    } as Parameters<typeof appendTraceEvent>[0]);

    // Resolve tenantId from the agent_id in the request (falls back to 'demo' for backward compat)
    const agentId = (args._retell_agent_id as string | undefined) ?? (args.agent_id as string | undefined);
    const orgId = agentId ? await getOrgIdByAgentId(agentId) : null;
    const tenantId = orgId ?? 'demo';

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
