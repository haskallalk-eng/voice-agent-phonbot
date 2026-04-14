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
};

let memId = 1;
const mem: TicketRow[] = [];

const TicketStatus = z.enum(['open', 'assigned', 'done']);

const CreateTicketBody = z.object({
  tenantId: z.string().min(1).default('demo'),

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

export async function createTicket(input: z.infer<typeof CreateTicketBody>): Promise<TicketRow> {
  const body = CreateTicketBody.parse(input);

  if (!isPlausiblePhone(body.customerPhone)) {
    const err = new Error('INVALID_PHONE') as Error & { code: string };
    err.code = 'INVALID_PHONE';
    throw err;
  }
  const normalizedPhone = normalizePhoneLight(body.customerPhone).normalized;

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
      customer_phone: normalizedPhone,
      preferred_time: body.preferredTime ?? null,
      service: body.service ?? null,
      notes: body.notes ?? null,
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
               customer_name, customer_phone, preferred_time, service, notes`,
    [
      body.tenantId,
      body.source ?? null,
      body.sessionId ?? null,
      body.reason ?? null,
      body.customerName ?? null,
      normalizedPhone,
      body.preferredTime ?? null,
      body.service ?? null,
      body.notes ?? null,
      orgId,
    ]
  );

  const ticket = rows[0] as TicketRow;

  // Fire-and-forget: email the org owner about the new ticket
  if (pool) {
    pool.query(
      `SELECT u.email, o.name as org_name
       FROM users u JOIN orgs o ON o.id = u.org_id
       WHERE u.org_id IN (SELECT id FROM orgs WHERE id::text = $1 OR id IN (SELECT org_id FROM agent_configs WHERE tenant_id = $1))
         AND u.role = 'owner'
       LIMIT 1`,
      [body.tenantId],
    ).then((res) => {
      if (res.rows[0]) {
        sendTicketNotification({
          toEmail: res.rows[0].email,
          orgName: res.rows[0].org_name,
          customerName: ticket.customer_name,
          customerPhone: ticket.customer_phone,
          reason: ticket.reason,
          service: ticket.service,
        }).catch(() => {});
      }
    }).catch((e: unknown) => { console.error('[tickets] notification error:', e instanceof Error ? e.message : String(e)); });
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
              customer_name, customer_phone, preferred_time, service, notes
       from tickets
       where org_id = $1 or (org_id is null and tenant_id = $1::text)
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

  // POST /tickets/:id/callback — manually trigger an outbound callback call
  app.post('/tickets/:id/callback', { ...auth }, async (req: FastifyRequest, reply) => {
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
         WHERE id = $1 AND (org_id = $2 OR (org_id IS NULL AND tenant_id = $2::text))`,
        [params.id, orgId],
      );
      ticket = (res.rows[0] as TicketRow | undefined) ?? null;
    }

    if (!ticket) return reply.status(404).send({ ok: false, error: 'NOT_FOUND' });
    if (!ticket.customer_phone) return reply.status(400).send({ ok: false, error: 'NO_PHONE' });

    const result = await triggerCallback({
      orgId,
      customerPhone: ticket.customer_phone,
      customerName: ticket.customer_name,
      reason: ticket.reason,
      service: ticket.service,
    });

    if (!result.ok) {
      const statusCode = result.error === 'NO_OUTBOUND_NUMBER' ? 422 : 500;
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
       where id = $1 and (org_id = $2 or (org_id is null and tenant_id = $2::text))
       returning id, created_at, updated_at, tenant_id, status,
                 source, session_id, reason,
                 customer_name, customer_phone, preferred_time, service, notes`,
      [params.id, orgId, body.status ?? null, body.notes ?? null]
    );

    if (!rows[0]) return { ok: false, error: 'NOT_FOUND' };
    return rows[0];
  });
}
