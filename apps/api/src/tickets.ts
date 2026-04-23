import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { isPlausiblePhone, normalizePhoneLight } from '@vas/shared';
import type { JwtPayload } from './auth.js';
import { sendTicketNotification } from './email.js';
import { triggerCallback } from './agent-config.js';

type TicketRow = {
  id: number;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  status: 'open' | 'assigned' | 'done';
  source: string | null;
  session_id: string | null;
  reason: string | null;
  customer_name: string | null;
  customer_phone: string;
  preferred_time: string | null;
  service: string | null;
  notes: string | null;
  // Phase 2: custom fields extracted via Retell post-call-analysis.
  // Populated asynchronously by retell-webhooks on call_ended / call_analyzed.
  metadata: Record<string, unknown>;
};

let memId = 1;
const mem: TicketRow[] = [];

const TicketStatus = z.enum(['open', 'assigned', 'done']);

const CreateTicketBody = z.object({
  // tenantId is REQUIRED. Previous default ('demo') was a foot-gun: any future
  // caller of createTicket() that forgot to pass tenantId would silently land
  // tickets in the 'demo' silo, mixing tenants. The two real callers (POST
  // /tickets and the Retell ticket.create webhook) both provide it explicitly.
  tenantId: z.string().min(1),

  // Handoff context
  source: z.enum(['phone', 'web', 'system']).optional(),
  sessionId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),

  customerName: z.string().min(1).optional(),
  // Required: prevents anonymous spam and is needed for callbacks.
  customerPhone: z.string().min(1),
  preferredTime: z.string().min(1).optional(),
  service: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
});

const UpdateTicketBody = z.object({
  status: TicketStatus.optional(),
  notes: z.string().min(1).optional(),
});

function normalizeTicketPhoneForStorage(input: string): string {
  const { digits, normalized } = normalizePhoneLight(input);
  if (!digits) return 'unknown';
  if (normalized.startsWith('+')) return normalized;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+49${digits.slice(1)}`;
  return normalized;
}

function safeUnverifiedPhone(input: string): string {
  const normalized = normalizeTicketPhoneForStorage(input);
  return normalized.length > 64 ? normalized.slice(0, 64) : normalized;
}

export async function createTicket(
  input: z.infer<typeof CreateTicketBody>,
  opts: { allowUnverifiedPhone?: boolean } = {},
): Promise<TicketRow> {
  const body = CreateTicketBody.parse(input);

  if (!isPlausiblePhone(body.customerPhone)) {
    if (opts.allowUnverifiedPhone) {
      body.customerPhone = safeUnverifiedPhone(body.customerPhone);
    } else {
      const err = new Error('INVALID_PHONE') as Error & { code: string };
      err.code = 'INVALID_PHONE';
      throw err;
    }
  }

  // Defense-in-depth: reject non-DACH phone at creation time, not just at
  // callback-trigger time (E1). A ticket with customerPhone='+1-900-premium'
  // would otherwise sit in the DB and be callable via /tickets/:id/callback
  // by any user with access to the ticket — the callback endpoint does check
  // prefixes, but if a future endpoint or batch-job reads tickets and dials
  // without re-checking, we'd have a toll-fraud vector. Belt-and-suspenders.
  const ALLOWED_PREFIXES = (process.env.ALLOWED_PHONE_PREFIXES ?? '+49,+43,+41')
    .split(',').map(p => p.trim()).filter(Boolean);
  const normalizedPhone = normalizeTicketPhoneForStorage(body.customerPhone);
  if (!ALLOWED_PREFIXES.some(p => normalizedPhone.startsWith(p))) {
    if (opts.allowUnverifiedPhone) {
      body.customerPhone = safeUnverifiedPhone(body.customerPhone);
    } else {
      const err = new Error('PHONE_COUNTRY_NOT_ALLOWED') as Error & { code: string };
      err.code = 'PHONE_COUNTRY_NOT_ALLOWED';
      throw err;
    }
  }

  const finalPhone = opts.allowUnverifiedPhone
    ? safeUnverifiedPhone(body.customerPhone)
    : normalizedPhone;

  if (!pool) {
    const now = new Date().toISOString();
    const row: TicketRow = {
      id: memId++,
      created_at: now,
      updated_at: now,
      tenant_id: body.tenantId,
      status: 'open',
      source: body.source ?? null,
      session_id: body.sessionId ?? null,
      reason: body.reason ?? null,
      customer_name: body.customerName ?? null,
      customer_phone: finalPhone,
      preferred_time: body.preferredTime ?? null,
      service: body.service ?? null,
      notes: body.notes ?? null,
      metadata: {},
    };
    mem.unshift(row);
    return row;
  }

  // Resolve org_id from tenant_id
  let orgId: string | null = null;
  const orgRes = await pool.query(`SELECT org_id FROM agent_configs WHERE tenant_id = $1 LIMIT 1`, [body.tenantId]);
  if (orgRes.rows[0]?.org_id) orgId = orgRes.rows[0].org_id as string;

  const { rows } = await pool.query(
    `insert into tickets (
        tenant_id, org_id, status,
        source, session_id, reason,
        customer_name, customer_phone, preferred_time, service, notes
      )
     values ($1, $10, 'open', $2, $3, $4, $5, $6, $7, $8, $9)
     returning id, created_at, updated_at, tenant_id, status,
               source, session_id, reason,
               customer_name, customer_phone, preferred_time, service, notes,
               metadata`,
    [
      body.tenantId,
      body.source ?? null,
      body.sessionId ?? null,
      body.reason ?? null,
      body.customerName ?? null,
      finalPhone,
      body.preferredTime ?? null,
      body.service ?? null,
      body.notes ?? null,
      orgId,
    ]
  );

  const ticket = rows[0] as TicketRow;

  // Fire-and-forget: email the org owner about the new ticket.
  // Lookup via the already-resolved `orgId` (see above). The previous OR-branch
  // (id::text = $1 OR legacy agent_configs match) could match a legacy row
  // where another org's tenant_id happens to equal the current org's UUID as
  // text — leaking the new ticket's PII to the wrong owner. Resolves E9.
  if (pool && orgId) {
    pool.query(
      `SELECT u.email, o.name as org_name
       FROM users u JOIN orgs o ON o.id = u.org_id
       WHERE u.org_id = $1 AND u.role = 'owner' AND u.is_active = true
       ORDER BY u.created_at ASC
       LIMIT 1`,
      [orgId],
    ).then((res) => {
      if (res.rows[0]) {
        sendTicketNotification({
          toEmail: res.rows[0].email,
          orgName: res.rows[0].org_name,
          customerName: ticket.customer_name,
          customerPhone: ticket.customer_phone,
          reason: ticket.reason,
          service: ticket.service,
        }).catch((e: unknown) => {
          // Don't swallow silently — log so ops can see mail-send failures.
          process.stderr.write(`[tickets] sendTicketNotification failed: ${e instanceof Error ? e.message : String(e)}\n`);
        });
      }
    }).catch((e: unknown) => {
      process.stderr.write(`[tickets] owner-lookup for notification failed: ${e instanceof Error ? e.message : String(e)}\n`);
    });
  }

  return ticket;
}

export async function registerTickets(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] };

  app.get('/tickets', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const q = z
      .object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(req.query);

    if (!pool) {
      const items = mem
        .filter((t) => t.tenant_id === orgId)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, q.limit);
      return { items };
    }

    const { rows } = await pool.query(
      `select id, created_at, updated_at, tenant_id, status,
              source, session_id, reason,
              customer_name, customer_phone, preferred_time, service, notes,
              metadata
       from tickets
       where org_id = $1
       order by created_at desc
       limit $2`,
      [orgId, q.limit]
    );

    return { items: rows };
  });

  // POST /tickets — authenticated. tenantId is forced to the caller's orgId from JWT
  // (was previously unauthenticated with tenantId from body → allowed cross-tenant ticket
  // injection + phishing emails from the phonbot.de domain + outbound toll-fraud).
  // Retell webhooks have their own signed endpoint at /retell/tools/ticket.create.
  app.post('/tickets', { ...auth }, async (req, reply) => {
    try {
      const { orgId } = req.user as JwtPayload;
      const body = (req.body ?? {}) as Partial<z.infer<typeof CreateTicketBody>>;
      const row = await createTicket({ ...body, tenantId: orgId } as z.infer<typeof CreateTicketBody>);
      reply.code(201);
      return row;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      const msg = e instanceof Error ? e.message : '';
      if (code === 'INVALID_PHONE' || msg === 'INVALID_PHONE') {
        reply.code(400);
        return { ok: false, error: 'INVALID_PHONE' };
      }
      throw e;
    }
  });

  // POST /tickets/:id/callback — manually trigger an outbound callback call.
  // Dedicated low-quota rate-limit on top of the 100/min global: a single org
  // should not be able to fire more than 5 callbacks per hour. Without this,
  // an insider (or a leaked JWT) could dial premium-rate numbers via our
  // Twilio trunk at $-per-minute (IRSF/toll-fraud pattern).
  app.post('/tickets/:id/callback', {
    ...auth,
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (req: FastifyRequest, reply) => {
    const { orgId } = req.user as JwtPayload;
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);

    // Load the ticket (verify it belongs to this org)
    let ticket: TicketRow | null = null;
    if (!pool) {
      ticket = mem.find((t) => t.id === params.id && t.tenant_id === orgId) ?? null;
    } else {
      const res = await pool.query(
        `SELECT id, customer_phone, customer_name, reason, service, status
         FROM tickets
         WHERE id = $1 AND org_id = $2`,
        [params.id, orgId],
      );
      ticket = (res.rows[0] as TicketRow | undefined) ?? null;
    }

    if (!ticket) return reply.status(404).send({ ok: false, error: 'NOT_FOUND' });
    if (!ticket.customer_phone) return reply.status(400).send({ ok: false, error: 'NO_PHONE' });

    // Country-prefix allowlist — isPlausiblePhone (in createTicket) blocks DE
    // premium prefixes, but accepts any plausible international E.164. That
    // means a user can stuff customer_phone="+1-premium-rate" into a ticket
    // and bill it via callback. Gate here with the same DACH-default list used
    // by /demo/callback and /outbound-agent.
    const ALLOWED_PREFIXES = (process.env.ALLOWED_PHONE_PREFIXES ?? '+49,+43,+41').split(',').map((p) => p.trim()).filter(Boolean);
    if (!ALLOWED_PREFIXES.some((p) => ticket!.customer_phone!.startsWith(p))) {
      req.log.warn({ orgId, ticketId: params.id }, 'ticket callback rejected: non-DACH phone prefix');
      return reply.status(400).send({ ok: false, error: 'PHONE_PREFIX_NOT_ALLOWED' });
    }

    const result = await triggerCallback({
      orgId,
      customerPhone: ticket.customer_phone,
      customerName: ticket.customer_name,
      reason: ticket.reason,
      service: ticket.service,
    });

    if (!result.ok) {
      const statusCode = result.error === 'FEATURE_DISABLED' ? 503
        : result.error === 'NO_OUTBOUND_NUMBER' ? 422
        : 500;
      return reply.status(statusCode).send(result);
    }

    return result;
  });

  app.patch('/tickets/:id', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = UpdateTicketBody.parse(req.body ?? {});

    if (!pool) {
      const t = mem.find((x) => x.id === params.id && x.tenant_id === orgId);
      if (!t) return { ok: false, error: 'NOT_FOUND' };
      if (body.status) t.status = body.status;
      if (body.notes) t.notes = body.notes;
      t.updated_at = new Date().toISOString();
      return t;
    }

    const { rows } = await pool.query(
      `update tickets
       set status = coalesce($3, status),
           notes = coalesce($4, notes),
           updated_at = now()
       where id = $1 and org_id = $2
       returning id, created_at, updated_at, tenant_id, status,
                 source, session_id, reason,
                 customer_name, customer_phone, preferred_time, service, notes,
                 metadata`,
      [params.id, orgId, body.status ?? null, body.notes ?? null]
    );

    if (!rows[0]) return { ok: false, error: 'NOT_FOUND' };
    return rows[0];
  });
}

/**
 * Merge extracted variables into the ticket's metadata JSONB.
 *
 * Called by retell-webhooks on `call_ended` / `call_analyzed` once Retell's
 * post-call analysis returns `custom_analysis_data`. JSONB concat (`||`) is
 * left-dominant: already-present keys from an earlier analysis are preserved,
 * so a late-arriving `call_analyzed` cannot clobber what `call_ended` already
 * wrote. If both events carry the same key, the first-writer wins — which
 * is what we want for idempotency.
 *
 * Match is by `session_id` (Retell call_id) — there is exactly one ticket
 * per call in our current flow because ticket.create is tied 1:1 to the
 * agent's decision during that call.
 *
 * Returns the updated metadata (or null if no ticket matched).
 */
export async function mergeTicketMetadata(
  sessionId: string,
  extracted: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!pool) {
    const t = mem.find((x) => x.session_id === sessionId);
    if (!t) return null;
    t.metadata = { ...extracted, ...t.metadata };
    return t.metadata;
  }

  const { rows } = await pool.query(
    `update tickets
        set metadata = $2::jsonb || metadata,
            updated_at = now()
      where session_id = $1
    returning metadata`,
    [sessionId, JSON.stringify(extracted)],
  );
  return (rows[0]?.metadata as Record<string, unknown> | undefined) ?? null;
}
