import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';

// ADMIN_PASSWORD is required in production (no default — defaulted pw = instant platform-compromise)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD && process.env.NODE_ENV === 'production') {
  throw new Error('ADMIN_PASSWORD is required in production — refusing to start');
}

/** Middleware: verify admin JWT token */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    const payload = req.user as Record<string, unknown>;
    if (!payload.admin) {
      reply.status(403).send({ error: 'Admin access required' });
    }
  } catch {
    reply.status(401).send({ error: 'Unauthorized' });
  }
}

export async function registerAdmin(app: FastifyInstance) {
  const auth = { onRequest: [requireAdmin] };

  // ── POST /admin/login ─────────────────────────────────────────────────────
  app.post('/admin/login', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Password required' });

    // Constant-time compare to prevent timing-attacks + reject when password not set
    if (!ADMIN_PASSWORD) return reply.status(503).send({ error: 'Admin login disabled (not configured)' });
    const providedBuf = Buffer.from(parsed.data.password);
    const expectedBuf = Buffer.from(ADMIN_PASSWORD);
    const match = providedBuf.length === expectedBuf.length
      && (await import('node:crypto')).timingSafeEqual(providedBuf, expectedBuf);
    if (!match) {
      return reply.status(401).send({ error: 'Invalid admin password' });
    }

    // admin:true marker separates admin-tokens from user-tokens (verified by requireAdmin middleware)
    const token = app.jwt.sign({ admin: true }, { expiresIn: '24h' });
    return { token };
  });

  // ── GET /admin/leads ──────────────────────────────────────────────────────
  app.get('/admin/leads', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });

    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
      status: z.enum(['new', 'contacted', 'converted', 'lost']).optional(),
      source: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }).parse(req.query);

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (q.status) {
      conditions.push(`status = $${idx++}`);
      values.push(q.status);
    }
    if (q.source) {
      conditions.push(`source = $${idx++}`);
      values.push(q.source);
    }
    if (q.from) {
      conditions.push(`created_at >= $${idx++}`);
      values.push(q.from);
    }
    if (q.to) {
      conditions.push(`created_at <= $${idx++}`);
      values.push(q.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await pool.query(`SELECT COUNT(*) as cnt FROM crm_leads ${where}`, values);
    const total = parseInt(String(countRes.rows[0]?.cnt ?? '0'), 10);

    const dataValues = [...values, q.limit, q.offset];
    const { rows } = await pool.query(
      `SELECT id, created_at, name, email, phone, source, status, notes, call_id, converted_at
       FROM crm_leads ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      dataValues,
    );

    return { items: rows, total };
  });

  // ── GET /admin/leads/stats ────────────────────────────────────────────────
  app.get('/admin/leads/stats', { ...auth }, async (_req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });

    const statusRes = await pool.query(
      `SELECT status, COUNT(*) as cnt FROM crm_leads GROUP BY status`,
    );
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of statusRes.rows) {
      const cnt = parseInt(String(r.cnt), 10);
      byStatus[r.status as string] = cnt;
      total += cnt;
    }

    const sourceRes = await pool.query(
      `SELECT source, COUNT(*) as cnt FROM crm_leads GROUP BY source`,
    );
    const bySource: Record<string, number> = {};
    for (const r of sourceRes.rows) {
      bySource[(r.source as string) ?? 'unknown'] = parseInt(String(r.cnt), 10);
    }

    const converted = byStatus['converted'] ?? 0;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

    const dailyRes = await pool.query(
      `SELECT DATE(created_at) as day, COUNT(*) as cnt
       FROM crm_leads
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY day DESC`,
    );
    const perDay = dailyRes.rows.map(r => ({
      day: r.day,
      count: parseInt(String(r.cnt), 10),
    }));

    return { total, byStatus, bySource, conversionRate, perDay };
  });

  // ── PATCH /admin/leads/:id ────────────────────────────────────────────────
  app.patch('/admin/leads/:id', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });

    const { id } = req.params as { id: string };
    const body = z.object({
      status: z.enum(['new', 'contacted', 'converted', 'lost']).optional(),
      notes: z.string().optional(),
    }).parse(req.body);

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.status !== undefined) {
      updates.push(`status = $${idx++}`);
      values.push(body.status);
      if (body.status === 'converted') {
        updates.push(`converted_at = NOW()`);
      }
    }
    if (body.notes !== undefined) {
      updates.push(`notes = $${idx++}`);
      values.push(body.notes);
    }

    if (updates.length === 0) return { ok: true };

    values.push(id);
    await pool.query(`UPDATE crm_leads SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    return { ok: true };
  });

  // ── DELETE /admin/leads/:id ───────────────────────────────────────────────
  app.delete('/admin/leads/:id', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const { id } = req.params as { id: string };
    await pool.query(`DELETE FROM crm_leads WHERE id = $1`, [id]);
    return { ok: true };
  });

  // ── GET /admin/metrics ────────────────────────────────────────────────────
  app.get('/admin/metrics', { ...auth }, async (_req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });

    const [
      usersRes,
      orgsRes,
      planRes,
      callsRes,
      ticketsRes,
      phoneTotalRes,
      phoneAssignedRes,
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*) as cnt FROM users`),
      pool.query(`SELECT COUNT(*) as cnt FROM orgs`),
      pool.query(`SELECT plan, COUNT(*) as cnt FROM orgs GROUP BY plan`),
      pool.query(`SELECT COUNT(*) as cnt FROM call_transcripts`),
      pool.query(`SELECT COUNT(*) as cnt FROM tickets`),
      pool.query(`SELECT COUNT(*) as cnt FROM phone_numbers`).catch(() => ({ rows: [{ cnt: 0 }] })),
      pool.query(`SELECT COUNT(*) as cnt FROM phone_numbers WHERE org_id IS NOT NULL`).catch(() => ({ rows: [{ cnt: 0 }] })),
    ]);

    const planCounts: Record<string, number> = {};
    for (const r of planRes.rows) {
      planCounts[(r.plan as string) ?? 'free'] = parseInt(String(r.cnt), 10);
    }

    // Revenue estimate based on plan prices
    const planPrices: Record<string, number> = {
      free: 0,
      starter: 49,
      professional: 99,
      business: 199,
      enterprise: 499,
    };
    let totalRevenue = 0;
    for (const [plan, count] of Object.entries(planCounts)) {
      totalRevenue += (planPrices[plan] ?? 0) * count;
    }

    return {
      totalUsers: parseInt(String(usersRes.rows[0]?.cnt ?? '0'), 10),
      totalOrgs: parseInt(String(orgsRes.rows[0]?.cnt ?? '0'), 10),
      planCounts,
      totalRevenue,
      totalCalls: parseInt(String(callsRes.rows[0]?.cnt ?? '0'), 10),
      totalTickets: parseInt(String(ticketsRes.rows[0]?.cnt ?? '0'), 10),
      phoneTotal: parseInt(String(phoneTotalRes.rows[0]?.cnt ?? '0'), 10),
      phoneAssigned: parseInt(String(phoneAssignedRes.rows[0]?.cnt ?? '0'), 10),
    };
  });

  // ── GET /admin/users ──────────────────────────────────────────────────────
  app.get('/admin/users', { ...auth }, async (_req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role, u.created_at, u.is_active,
              o.id as org_id, o.name as org_name, o.plan, o.plan_status
       FROM users u
       LEFT JOIN orgs o ON o.id = u.org_id
       ORDER BY u.created_at DESC
       LIMIT 500`,
    );
    return { items: rows };
  });

  // ── GET /admin/orgs ───────────────────────────────────────────────────────
  app.get('/admin/orgs', { ...auth }, async (_req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });

    const { rows } = await pool.query(
      `SELECT o.id, o.name, o.slug, o.plan, o.plan_status, o.is_active, o.created_at,
              o.minutes_used, o.minutes_limit,
              (SELECT COUNT(*) FROM agent_configs ac WHERE ac.org_id = o.id) as agents_count,
              (SELECT COUNT(*) FROM users u2 WHERE u2.org_id = o.id) as users_count
       FROM orgs o
       ORDER BY o.created_at DESC
       LIMIT 500`,
    );
    return { items: rows };
  });
}
