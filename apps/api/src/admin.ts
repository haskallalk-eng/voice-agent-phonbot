import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { pool } from './db.js';
import { log } from './logger.js';
import { TEMPLATES } from './templates.js';
import { DEMO_END_INSTRUCTIONS, DEFAULT_SALES_PROMPT, flushDemoAgentCache } from './demo.js';
import { PLATFORM_BASELINE_PROMPT, bustPlatformBaselineCache } from './platform-baseline.js';
import { OUTBOUND_BASELINE_PROMPT, bustOutboundBaselineCache } from './outbound-baseline.js';

/**
 * Audit-Round-8 (Codex M07-MEDIUM-C): admin cross-org reads are intentional
 * (platform-admin can see every customer's data) but we had no read-audit-
 * trail and no per-route rate-limit. With a compromised admin token, bulk
 * exfiltration was invisible and unbounded.
 *
 * `recordAdminRead` is fire-and-forget — never block the GET. Failures only
 * mean the audit row is missing; we surface them via log so Ops sees the
 * pattern without it taking the response path down.
 */
async function recordAdminRead(
  req: FastifyRequest,
  route: string,
  resultCount: number | null,
  paramsForAudit: Record<string, unknown> = {},
): Promise<void> {
  if (!pool) return;
  const payload = (req.user as Record<string, unknown>) ?? {};
  const adminEmail = (payload.email as string | undefined) ?? 'unknown';
  pool.query(
    `INSERT INTO admin_read_audit_log (admin_email, route, params, result_count, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [adminEmail, route, JSON.stringify(paramsForAudit), resultCount, req.ip ?? null],
  ).catch((err: Error) => log.warn({ err: err.message, route, adminEmail }, 'admin: audit-log insert failed'));
}

// Admin login accepts either:
//  • ADMIN_PASSWORD_HASH (bcrypt, recommended for prod) — plaintext never in
//    process memory, `docker inspect` or `/proc/<pid>/environ` can't leak it;
//  • ADMIN_PASSWORD (plaintext, fine for local/dev) — kept for backward-compat.
// In production at least one must be set, else boot fails.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
if (!ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH && process.env.NODE_ENV === 'production') {
  throw new Error('ADMIN_PASSWORD or ADMIN_PASSWORD_HASH is required in production — refusing to start');
}

/** Middleware: verify admin JWT token */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    const payload = req.user as Record<string, unknown>;
    // H2: Verify both admin flag AND audience claim to prevent user-JWTs
    // from being accepted on admin endpoints.
    if (!payload.admin || payload.aud !== 'phonbot:admin') {
      // Explicit return after send: Fastify does short-circuit on sent replies,
      // but being explicit guarantees no handler code below this block ever
      // runs after a 403/401 — a refactor-safe defence-in-depth for auth.
      return reply.status(403).send({ error: 'Admin access required' });
    }
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
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

    // Prefer bcrypt-hash path (plaintext never in process memory). Fall back
    // to plaintext ADMIN_PASSWORD only if hash not provided. bcrypt.compare
    // is constant-time internally.
    let match = false;
    if (ADMIN_PASSWORD_HASH) {
      match = await bcrypt.compare(parsed.data.password, ADMIN_PASSWORD_HASH);
    } else if (ADMIN_PASSWORD) {
      const providedBuf = Buffer.from(parsed.data.password);
      const expectedBuf = Buffer.from(ADMIN_PASSWORD);
      match = providedBuf.length === expectedBuf.length
        && (await import('node:crypto')).timingSafeEqual(providedBuf, expectedBuf);
    } else {
      return reply.status(503).send({ error: 'Admin login disabled (not configured)' });
    }
    if (!match) {
      return reply.status(401).send({ error: 'Invalid admin password' });
    }

    // H2: admin:true + aud:'phonbot:admin' separates admin-tokens from user-tokens
    // (both verified by requireAdmin middleware to prevent user-JWT privilege escalation)
    // `email` is carried so audit columns (demo_prompt_overrides.updated_by,
    // learning_decisions.decided_by, learning_corrections.applied_by) can
    // actually record who acted. Single-shared-password operation means we
    // can't tell admins apart, but ADMIN_EMAIL env-var lets ops tag their
    // identity (e.g. set to "max@mindrails.de" on max's container) so the
    // audit trail isn't all-NULL.
    const adminEmail = process.env.ADMIN_EMAIL ?? 'platform-admin';
    const token = app.jwt.sign(
      { admin: true, aud: 'phonbot:admin', email: adminEmail },
      { expiresIn: '24h' },
    );
    return { token };
  });

  // ── GET /admin/leads ──────────────────────────────────────────────────────
  // Audit-Round-8: Per-route rate-limit (60/min) caps bulk-exfiltration with
  // a compromised admin token. + recordAdminRead audit-log on every read.
  app.get('/admin/leads', {
    ...auth,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
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

    void recordAdminRead(req, '/admin/leads', rows.length, q);
    return { items: rows, total };
  });

  // ── GET /admin/leads/stats ────────────────────────────────────────────────
  app.get('/admin/leads/stats', {
    ...auth,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
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

    void recordAdminRead(req, '/admin/leads/stats', total, {});
    return { total, byStatus, bySource, conversionRate, perDay };
  });

  // ── PATCH /admin/leads/:id ────────────────────────────────────────────────
  // Audit-Round-10 MEDIUM: Rate-Limit + UUID-Validation. Without limit, a
  // hijacked admin token can mass-mutate leads in a tight loop. UUID-Schema
  // prevents 500-Postgres-error-leak when malformed id strings hit the query.
  app.patch('/admin/leads/:id', {
    ...auth,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });

    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid id' });
    const { id } = params.data;
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
  app.delete('/admin/leads/:id', {
    ...auth,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid id' });
    await pool.query(`DELETE FROM crm_leads WHERE id = $1`, [params.data.id]);
    return { ok: true };
  });

  // ── GET /admin/demo-calls ─────────────────────────────────────────────────
  // Persisted /demo/call sessions (template_id, transcript, extracted contact
  // fields). Promoted demo calls keep the row but show their crm_leads id.
  // Audit-Round-8: rate-limit + recordAdminRead.
  app.get('/admin/demo-calls', {
    ...auth,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(100),
      template: z.string().optional(),
      onlyUnpromoted: z.coerce.boolean().optional(),
      hasContact: z.coerce.boolean().optional(),
    }).safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', details: q.error.flatten() });

    const where: string[] = [];
    const args: unknown[] = [];
    if (q.data.template) { args.push(q.data.template); where.push(`template_id = $${args.length}`); }
    if (q.data.onlyUnpromoted) where.push(`promoted_at IS NULL`);
    if (q.data.hasContact) where.push(`(caller_email IS NOT NULL OR caller_phone IS NOT NULL)`);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    args.push(q.data.limit);
    const res = await pool.query(
      `SELECT id, created_at, call_id, template_id, duration_sec,
              caller_name, caller_email, caller_phone, intent_summary,
              disconnection_reason, promoted_lead_id, promoted_at,
              LEFT(transcript, 4000) AS transcript_excerpt
         FROM demo_calls ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${args.length}`,
      args,
    );
    void recordAdminRead(req, '/admin/demo-calls', res.rows.length, q.data);
    return { calls: res.rows };
  });

  // ── POST /admin/demo-calls/:id/promote ────────────────────────────────────
  // Move a demo_calls row into crm_leads. Caller's email is required (the CRM
  // table makes it NOT NULL); when the demo only captured a phone, the admin
  // must supply an email manually via the request body.
  app.post('/admin/demo-calls/:id/promote', {
    ...auth,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid id' });
    const { id } = params.data;
    const overrides = z.object({
      email: z.string().email().optional(),
      phone: z.string().optional(),
      name: z.string().optional(),
      notes: z.string().optional(),
    }).safeParse(req.body ?? {});
    if (!overrides.success) return reply.status(400).send({ error: 'Invalid body', details: overrides.error.flatten() });

    // Audit-Round-10 LOW: don't SELECT * — transcript is potentially KB-large
    // and not needed for promote. Only the columns we use plus the conflict-
    // marker promoted_lead_id are read.
    const dcRes = await pool.query(
      `SELECT id, call_id, template_id, caller_name, caller_email, caller_phone, intent_summary, promoted_lead_id
         FROM demo_calls WHERE id = $1`,
      [id],
    );
    if (!dcRes.rowCount) return reply.status(404).send({ error: 'Demo call not found' });
    const dc = dcRes.rows[0] as {
      id: string; call_id: string; template_id: string;
      caller_name: string | null; caller_email: string | null; caller_phone: string | null;
      intent_summary: string | null; promoted_lead_id: string | null;
    };
    if (dc.promoted_lead_id) {
      return reply.status(409).send({ error: 'Already promoted', leadId: dc.promoted_lead_id });
    }

    const email = overrides.data.email ?? dc.caller_email;
    if (!email) return reply.status(400).send({ error: 'Email missing — pass `email` in body to promote' });
    const phone = overrides.data.phone ?? dc.caller_phone ?? null;
    const name = overrides.data.name ?? dc.caller_name ?? null;
    const notes = overrides.data.notes
      ?? [
        `Demo-Call (${dc.template_id}) — ${dc.intent_summary ?? 'kein Intent erfasst'}`,
        `Retell call_id: ${dc.call_id}`,
      ].join('\n');

    const insertRes = await pool.query(
      `INSERT INTO crm_leads (name, email, phone, source, status, notes, call_id)
       VALUES ($1, $2, $3, 'demo-web-call', 'new', $4, $5)
       RETURNING id`,
      [name, email, phone, notes, dc.call_id],
    );
    const leadId = insertRes.rows[0].id as string;

    await pool.query(
      `UPDATE demo_calls SET promoted_lead_id = $1, promoted_at = now() WHERE id = $2`,
      [leadId, id],
    );

    return { ok: true, leadId };
  });

  // ── GET /admin/demo-prompts ───────────────────────────────────────────────
  // Returns the in-code defaults + every admin-stored override side-by-side
  // so the editor can render "default vs. live" diffs. The shape is keyed by
  // template_id; the special key '__global__' is the cross-template epilogue.
  app.get('/admin/demo-prompts', { ...auth }, async (_req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });

    const overridesRes = await pool.query(
      `SELECT template_id, epilogue, base_prompt, updated_at, updated_by
         FROM demo_prompt_overrides`,
    );
    const overrides = new Map<string, { epilogue: string; basePrompt: string | null; updatedAt: string; updatedBy: string | null }>();
    for (const row of overridesRes.rows as Array<{ template_id: string; epilogue: string; base_prompt: string | null; updated_at: Date; updated_by: string | null }>) {
      overrides.set(row.template_id, {
        epilogue: row.epilogue,
        basePrompt: row.base_prompt,
        updatedAt: row.updated_at.toISOString(),
        updatedBy: row.updated_by,
      });
    }

    return {
      defaults: {
        platformBaseline: PLATFORM_BASELINE_PROMPT,
        outboundBaseline: OUTBOUND_BASELINE_PROMPT,
        salesPrompt: DEFAULT_SALES_PROMPT,
        globalEpilogue: DEMO_END_INSTRUCTIONS,
        templates: TEMPLATES.map((t) => ({
          id: t.id,
          name: t.name,
          icon: t.icon,
          basePrompt: t.prompt,
        })),
      },
      overrides: {
        platformBaseline: overrides.get('__platform__') ?? null,
        outboundBaseline: overrides.get('__outbound__') ?? null,
        salesPrompt: overrides.get('__sales__') ?? null,
        globalEpilogue: overrides.get('__global__') ?? null,
        templates: TEMPLATES.map((t) => ({
          id: t.id,
          override: overrides.get(t.id) ?? null,
        })),
      },
    };
  });

  // ── PUT /admin/demo-prompts/:scope ────────────────────────────────────────
  // scope = '__global__' (epilogue applies to every template) or a templateId.
  // Setting epilogue=null deletes the override (= falls back to in-code default).
  app.put('/admin/demo-prompts/:scope', {
    ...auth,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const { scope } = req.params as { scope: string };
    const RESERVED_SCOPES = ['__global__', '__platform__', '__outbound__', '__sales__'];
    if (!RESERVED_SCOPES.includes(scope) && !TEMPLATES.some((t) => t.id === scope)) {
      return reply.status(400).send({ error: 'Unknown scope', scope });
    }
    const parsed = z.object({
      epilogue: z.string().min(0).max(20_000).nullable(),
      basePrompt: z.string().min(0).max(20_000).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', details: parsed.error.flatten() });

    const { epilogue, basePrompt } = parsed.data;
    const adminEmail = (req.user as Record<string, unknown> | undefined)?.email as string | undefined;

    // Audit-Round-10 MEDIUM: history+upsert in one transaction. Without this,
    // a doppelclick (or two parallel admins editing the same scope) reads
    // the same pre-state, both insert it into history (duplicate audit
    // entries), and one of the upserts is the loser of a read-modify-write
    // race. SELECT ... FOR UPDATE on the demo_prompt_overrides row
    // serialises edits per scope; if no row exists yet, the upsert creates
    // it under the same lock.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const preState = await client.query(
        `SELECT epilogue, base_prompt FROM demo_prompt_overrides WHERE template_id = $1 FOR UPDATE`,
        [scope],
      );
      if (preState.rowCount) {
        await client.query(
          `INSERT INTO prompt_override_history (template_id, epilogue, base_prompt, changed_by, change_kind)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            scope,
            (preState.rows[0].epilogue as string) ?? null,
            (preState.rows[0].base_prompt as string) ?? null,
            adminEmail ?? null,
            epilogue === null && (basePrompt === null || basePrompt === undefined) ? 'revert' : 'edit',
          ],
        );
      }

      if (epilogue === null && (basePrompt === null || basePrompt === undefined)) {
        await client.query(`DELETE FROM demo_prompt_overrides WHERE template_id = $1`, [scope]);
      } else {
        await client.query(
          `INSERT INTO demo_prompt_overrides (template_id, epilogue, base_prompt, updated_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (template_id) DO UPDATE SET
             epilogue    = COALESCE(EXCLUDED.epilogue, demo_prompt_overrides.epilogue),
             base_prompt = CASE WHEN $5 THEN EXCLUDED.base_prompt ELSE demo_prompt_overrides.base_prompt END,
             updated_at  = now(),
             updated_by  = EXCLUDED.updated_by`,
          [scope, epilogue ?? '', basePrompt ?? null, adminEmail ?? null, basePrompt !== undefined],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => { /* already rolled back */ });
      throw err;
    } finally {
      client.release();
    }

    // Audit-Round-10 HIGH: bust the in-process baseline caches so the
    // edited prompt takes effect immediately for new agent-deploys, not after
    // the 5-min TTL.
    if (scope === '__platform__') bustPlatformBaselineCache();
    if (scope === '__outbound__') bustOutboundBaselineCache();

    // Force every cached demo agent to re-create with the new prompt next call.
    const flush = await flushDemoAgentCache();
    return { ok: true, flushed: flush.flushed };
  });

  // ── GET /admin/demo-prompts/history ───────────────────────────────────────
  // Append-only history of every demo_prompt_overrides edit. Useful for
  // diffing what the prompt USED to look like vs. now, and for rollback.
  app.get('/admin/demo-prompts/history', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const q = z.object({
      scope: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }).safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', details: q.error.flatten() });

    const args: unknown[] = [];
    let where = '';
    if (q.data.scope) {
      args.push(q.data.scope);
      where = `WHERE template_id = $${args.length}`;
    }
    args.push(q.data.limit);
    const res = await pool.query(
      `SELECT id, created_at, template_id, epilogue, base_prompt, changed_by, change_kind
         FROM prompt_override_history
         ${where}
         ORDER BY created_at DESC
         LIMIT $${args.length}`,
      args,
    );
    return {
      history: res.rows.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        createdAt: (r.created_at as Date).toISOString(),
        scope: r.template_id as string,
        epilogue: r.epilogue as string | null,
        basePrompt: r.base_prompt as string | null,
        changedBy: r.changed_by as string | null,
        changeKind: r.change_kind as 'edit' | 'revert',
      })),
    };
  });

  // ── POST /admin/demo-prompts/history/:id/restore ─────────────────────────
  // Restore a prior snapshot from prompt_override_history into the live
  // demo_prompt_overrides row. The current state is itself appended to
  // history first (so the restore is also reversible).
  app.post('/admin/demo-prompts/history/:id/restore', {
    ...auth,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const { id } = req.params as { id: string };
    const adminEmail = (req.user as Record<string, unknown> | undefined)?.email as string | undefined;

    const snap = await pool.query(
      `SELECT template_id, epilogue, base_prompt FROM prompt_override_history WHERE id = $1`,
      [id],
    );
    if (!snap.rowCount) return reply.status(404).send({ error: 'History entry not found' });
    const row = snap.rows[0] as { template_id: string; epilogue: string | null; base_prompt: string | null };

    const current = await pool.query(
      `SELECT epilogue, base_prompt FROM demo_prompt_overrides WHERE template_id = $1`,
      [row.template_id],
    );
    if (current.rowCount) {
      await pool.query(
        `INSERT INTO prompt_override_history (template_id, epilogue, base_prompt, changed_by, change_kind)
         VALUES ($1, $2, $3, $4, 'edit')`,
        [row.template_id, current.rows[0].epilogue ?? null, current.rows[0].base_prompt ?? null, adminEmail ?? null],
      ).catch((err: Error) => req.log.warn({ err: err.message }, 'prompt_override_history pre-restore insert failed'));
    }

    if (row.epilogue === null && row.base_prompt === null) {
      await pool.query(`DELETE FROM demo_prompt_overrides WHERE template_id = $1`, [row.template_id]);
    } else {
      await pool.query(
        `INSERT INTO demo_prompt_overrides (template_id, epilogue, base_prompt, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (template_id) DO UPDATE SET
           epilogue    = EXCLUDED.epilogue,
           base_prompt = EXCLUDED.base_prompt,
           updated_at  = now(),
           updated_by  = EXCLUDED.updated_by`,
        [row.template_id, row.epilogue ?? '', row.base_prompt, adminEmail ?? null],
      );
    }

    if (row.template_id === '__platform__') bustPlatformBaselineCache();
    if (row.template_id === '__outbound__') bustOutboundBaselineCache();
    const flush = await flushDemoAgentCache();
    return { ok: true, restoredScope: row.template_id, flushed: flush.flushed };
  });

  // ── POST /admin/demo-prompts/flush-cache ──────────────────────────────────
  // Manual flush — useful when changing tools/voice/post-call config in code
  // without editing the prompt itself. Rate-limited because it triggers a
  // full Redis SCAN over demo_agent:* + demo_agent_meta:* + sales_agent:*;
  // an attacker with a hijacked admin token (1h TTL) could otherwise loop on
  // it as a DoS amplifier.
  app.post('/admin/demo-prompts/flush-cache', {
    ...auth,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async () => {
    return flushDemoAgentCache();
  });

  // ── GET /admin/learnings ──────────────────────────────────────────────────
  // Combined queue of "improvement candidates" — org-specific prompt_suggestions
  // AND systemic template_learnings — joined to learning_decisions to surface
  // any prior admin action. Every row carries `source_kind` so the frontend
  // knows which decide-target to send back.
  app.get('/admin/learnings', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const q = z.object({
      status: z.enum(['pending', 'applied', 'rejected', 'all']).default('pending'),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }).safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', details: q.error.flatten() });

    // Audit-Round-10 HIGH: status-Filter + ORDER + LIMIT in EINER SQL-Query
    // statt 2× LIMIT 200 + JS-merge + JS-filter. Vorher konnten bis zu 400
    // Rows geladen werden, um nach Filter ggf. nur 1 zu zeigen.
    // - effective_status: pending falls keine Decision, sonst decision.status.
    // - WHERE-Filter in beiden UNION-Branches identisch via $1.
    const want = q.data.status;
    const effectiveFilter = want === 'all'
      ? 'TRUE'
      : `COALESCE(ld.status, 'pending') = $2`;
    const args: unknown[] = [q.data.limit];
    if (want !== 'all') args.push(want);

    const merged = await pool.query(
      `SELECT * FROM (
         SELECT 'prompt_suggestion'::text AS kind,
                ps.id, ps.created_at, ps.org_id, o.name AS org_name,
                NULL::text AS template_id,
                ps.issue_summary AS summary, ps.suggested_addition AS proposed,
                jsonb_build_object('category', ps.category) AS source_meta,
                ps.status AS source_status,
                ld.scope, ld.status AS decision_status,
                ld.decided_at, ld.decided_by, ld.reject_reason
           FROM prompt_suggestions ps
           LEFT JOIN orgs o ON o.id = ps.org_id
           LEFT JOIN learning_decisions ld
             ON ld.source_kind = 'prompt_suggestion' AND ld.source_id = ps.id
          WHERE ${effectiveFilter}
         UNION ALL
         SELECT 'template_learning'::text AS kind,
                tl.id, tl.created_at, NULL::uuid AS org_id, NULL::text AS org_name,
                tl.template_id,
                tl.learning_type AS summary, tl.content AS proposed,
                jsonb_build_object('sourceCount', tl.source_count, 'confidence', tl.confidence) AS source_meta,
                tl.status AS source_status,
                ld.scope, ld.status AS decision_status,
                ld.decided_at, ld.decided_by, ld.reject_reason
           FROM template_learnings tl
           LEFT JOIN learning_decisions ld
             ON ld.source_kind = 'template_learning' AND ld.source_id = tl.id
          WHERE ${effectiveFilter}
       ) merged
       ORDER BY created_at DESC
       LIMIT $1`,
      args,
    );

    const items = merged.rows.map((r: Record<string, unknown>) => ({
      kind: r.kind as 'prompt_suggestion' | 'template_learning',
      id: r.id as string,
      created_at: (r.created_at as Date).toISOString(),
      summary: (r.summary as string) ?? '',
      proposed: (r.proposed as string) ?? '',
      orgId: (r.org_id as string) ?? null,
      orgName: (r.org_name as string) ?? null,
      templateId: (r.template_id as string) ?? null,
      sourceMeta: (r.source_meta as Record<string, unknown>) ?? {},
      sourceStatus: (r.source_status as string) ?? 'pending',
      decision: r.scope || r.decision_status ? {
        scope: (r.scope as string) ?? null,
        status: (r.decision_status as string) ?? null,
        decidedAt: r.decided_at ? (r.decided_at as Date).toISOString() : null,
        decidedBy: (r.decided_by as string) ?? null,
        rejectReason: (r.reject_reason as string) ?? null,
      } : null,
    }));

    return { items };
  });

  // ── POST /admin/learnings/decide ──────────────────────────────────────────
  // Admin records a decision per improvement. When status='applied' and the
  // scope contains 'systemic', we append the proposed_change to the global
  // demo epilogue so the demo agents pick it up on next cache miss. When
  // scope contains 'org', we mark the underlying prompt_suggestion as
  // 'applied' so the org's own learning pipeline will roll it into their
  // prompt on next deploy.
  app.post('/admin/learnings/decide', {
    ...auth,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const parsed = z.object({
      sourceKind: z.enum(['prompt_suggestion', 'template_learning']),
      sourceId: z.string().uuid(),
      // 'correct' = apply with admin-edited text (saved to learning_corrections
      // for meta-learning). Same scope semantics as 'apply'.
      decision: z.enum(['apply', 'correct', 'reject']),
      scope: z.enum(['systemic', 'org', 'both']).optional(),
      // Required when decision='correct'.
      // Refuse marker-syntax: we use `<!-- learning:KIND:UUID -->` to delimit
      // applied learning blocks in the global epilogue and idempotency-strip
      // them on re-apply. A correctedText carrying its own marker would
      // (a) survive the strip-regex (lookahead matches the next marker), so
      // it'd persist as a ghost-block, AND
      // (b) be a prompt-injection vector if the strip ever runs greedy.
      // Easier: forbid the literal sequence in user input.
      correctedText: z.string().min(1).max(20_000)
        .refine((t) => !/<!--\s*learning:/i.test(t), {
          message: 'correctedText may not contain "<!-- learning:" marker syntax',
        })
        .optional(),
      correctionReason: z.string().max(2000).optional(),
      // Required when decision='reject'
      rejectReason: z.string().max(500).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    const { sourceKind, sourceId, decision } = parsed.data;
    if ((decision === 'apply' || decision === 'correct') && !parsed.data.scope) {
      return reply.status(400).send({ error: 'scope is required when decision=apply or correct' });
    }
    if (decision === 'correct' && !parsed.data.correctedText) {
      return reply.status(400).send({ error: 'correctedText is required when decision=correct' });
    }
    const adminEmail = (req.user as Record<string, unknown> | undefined)?.email as string | undefined;
    const status = decision === 'reject' ? 'rejected' : 'applied';
    const scope = (decision === 'apply' || decision === 'correct') ? (parsed.data.scope ?? null) : null;
    const rejectReason = decision === 'reject' ? (parsed.data.rejectReason ?? null) : null;
    const isApplying = decision === 'apply' || decision === 'correct';

    // Audit-Round-9 H2: wrap the entire multi-statement decide-flow in one
    // transaction. Without this, a crash mid-way (e.g. between learning_
    // corrections-INSERT and learning_decisions-UPSERT) left inconsistent
    // state: orphaned correction rows, applied-but-no-source-update, etc.
    //
    // Audit-Round-9 M5: SELECT … FOR UPDATE on the source row at the top of
    // the transaction serialises parallel decide-clicks on the same source,
    // so a double-clicking admin produces exactly one correction insert and
    // one global-epilogue write — no read-modify-write race on the override.
    //
    // The cache-flush is INTENTIONALLY outside the transaction (M4): it's
    // a Redis op that can take seconds; we do it fire-and-forget after
    // commit so the admin's HTTP response isn't blocked.
    const client = await pool.connect();
    let systemicApplied = false;
    let orgApplied = false;
    let needsFlush = false;
    let notFound = false;
    let proposedChange = '';
    let summary: string | null = null;
    let orgId: string | null = null;
    let templateId: string | null = null;
    let textToApply = '';

    try {
      await client.query('BEGIN');

      // Lock the source row so concurrent decide-calls on the same source
      // serialise. `FOR UPDATE` is safe here — both source tables are small
      // and the lock is held for the rest of this transaction (sub-second).
      if (sourceKind === 'prompt_suggestion') {
        const r = await client.query(
          `SELECT issue_summary, suggested_addition, org_id FROM prompt_suggestions WHERE id = $1 FOR UPDATE`,
          [sourceId],
        );
        if (!r.rowCount) { notFound = true; }
        else {
          summary = (r.rows[0].issue_summary as string) ?? null;
          proposedChange = (r.rows[0].suggested_addition as string) ?? '';
          orgId = (r.rows[0].org_id as string) ?? null;
        }
      } else {
        const r = await client.query(
          `SELECT learning_type, content, template_id FROM template_learnings WHERE id = $1 FOR UPDATE`,
          [sourceId],
        );
        if (!r.rowCount) { notFound = true; }
        else {
          summary = (r.rows[0].learning_type as string) ?? null;
          proposedChange = (r.rows[0].content as string) ?? '';
          templateId = (r.rows[0].template_id as string) ?? null;
        }
      }

      if (notFound) {
        await client.query('ROLLBACK');
      } else {
        // The text we actually apply: corrected version if admin edited it,
        // otherwise the original system-generated proposal.
        textToApply = decision === 'correct'
          ? (parsed.data.correctedText ?? '').trim()
          : proposedChange;

        // Save the (original, corrected, reason) tuple to seed the meta-
        // learning pipeline. Inside the transaction so a rollback drops
        // the correction row too — keeps state consistent if a downstream
        // step fails.
        if (decision === 'correct' && textToApply !== proposedChange) {
          await client.query(
            `INSERT INTO learning_corrections
               (source_kind, source_id, summary, original_text, corrected_text,
                correction_reason, scope_applied, applied_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              sourceKind, sourceId, summary,
              proposedChange, textToApply,
              parsed.data.correctionReason ?? null,
              scope, adminEmail ?? null,
            ],
          );
        }

        await client.query(
          `INSERT INTO learning_decisions
            (source_kind, source_id, org_id, template_id, scope, status,
             summary, proposed_change, decided_at, decided_by, reject_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10)
           ON CONFLICT (source_kind, source_id) DO UPDATE SET
             scope = EXCLUDED.scope,
             status = EXCLUDED.status,
             proposed_change = EXCLUDED.proposed_change,
             decided_at = now(),
             decided_by = EXCLUDED.decided_by,
             reject_reason = EXCLUDED.reject_reason`,
          [sourceKind, sourceId, orgId, templateId, scope, status, summary, textToApply, adminEmail ?? null, rejectReason],
        );

        if (isApplying && scope && (scope === 'systemic' || scope === 'both')) {
          // Append to the global demo epilogue. Idempotent per (sourceKind, sourceId)
          // via the marker line; if the same source is applied twice (e.g. apply
          // then correct), the marker block is replaced rather than re-appended.
          const marker = `<!-- learning:${sourceKind}:${sourceId} -->`;
          const block = `\n\n${marker}\n${textToApply.trim()}`;
          const existing = await client.query(
            `SELECT epilogue FROM demo_prompt_overrides WHERE template_id = '__global__' FOR UPDATE`,
          );
          const current = existing.rowCount ? (existing.rows[0].epilogue as string) : DEMO_END_INSTRUCTIONS;
          // Strip any prior block for this source (pattern: marker + everything
          // up to the next marker or EOF). Using a non-greedy lookahead keeps
          // sibling blocks intact.
          const stripped = current.replace(
            new RegExp(`\\n*${marker.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}[\\s\\S]*?(?=\\n*<!-- learning:|$)`, 'g'),
            '',
          );
          const next = stripped + block;
          await client.query(
            `INSERT INTO demo_prompt_overrides (template_id, epilogue, updated_by)
             VALUES ('__global__', $1, $2)
             ON CONFLICT (template_id) DO UPDATE SET
               epilogue   = EXCLUDED.epilogue,
               updated_at = now(),
               updated_by = EXCLUDED.updated_by`,
            [next, adminEmail ?? null],
          );
          systemicApplied = true;
          needsFlush = true;

          // For template_learnings, also flag the source row so the existing
          // org-side propagation pipeline sees it. On a correction, ALSO write
          // the corrected text back into template_learnings.content so any
          // future re-ingest (apply-to-template flow, learning-export) uses
          // the corrected version, not the original auto-generated text.
          if (sourceKind === 'template_learning') {
            if (decision === 'correct') {
              await client.query(
                `UPDATE template_learnings
                    SET content = $2, status = 'applied', applied_at = now()
                  WHERE id = $1`,
                [sourceId, textToApply],
              );
            } else {
              await client.query(
                `UPDATE template_learnings SET status = 'applied', applied_at = now() WHERE id = $1`,
                [sourceId],
              );
            }
          }
        }

        if (isApplying && scope && (scope === 'org' || scope === 'both')) {
          if (sourceKind === 'prompt_suggestion') {
            // For corrections, we ALSO want the corrected text to land in the
            // org's source row so any future re-deploy uses the corrected version
            // rather than the original auto-generated one.
            if (decision === 'correct') {
              await client.query(
                `UPDATE prompt_suggestions
                    SET suggested_addition = $2, status = 'applied', applied_at = now()
                  WHERE id = $1`,
                [sourceId, textToApply],
              );
            } else {
              await client.query(
                `UPDATE prompt_suggestions SET status = 'applied', applied_at = now() WHERE id = $1`,
                [sourceId],
              );
            }
            orgApplied = true;
          }
          // template_learning + org-scope makes no sense (the row is system-level by
          // definition); we silently no-op so the admin can still pick "both" for a
          // template_learning that also has an analogous prompt_suggestion they
          // applied separately.
        }

        if (decision === 'reject') {
          if (sourceKind === 'prompt_suggestion') {
            await client.query(`UPDATE prompt_suggestions SET status = 'rejected' WHERE id = $1`, [sourceId]);
          } else {
            await client.query(`UPDATE template_learnings SET status = 'rejected' WHERE id = $1`, [sourceId]);
          }
        }

        await client.query('COMMIT');
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => { /* already rolled back or connection broken */ });
      throw err;
    } finally {
      client.release();
    }

    if (notFound) {
      return reply.status(404).send({
        error: sourceKind === 'prompt_suggestion' ? 'Suggestion not found' : 'Learning not found',
      });
    }

    // M4 fix: cache-flush is fire-and-forget AFTER commit. Admin response
    // returns immediately; the (potentially slow) Redis SCAN runs in the
    // background. If it fails we log — the next demo agent creation still
    // picks up the new prompt because the cache miss naturally re-creates.
    if (needsFlush) {
      flushDemoAgentCache().catch((err: Error) =>
        req.log.warn({ err: err.message }, 'flushDemoAgentCache after decide failed'),
      );
    }

    return { ok: true, systemicApplied, orgApplied, corrected: decision === 'correct' };
  });

  // ── GET /admin/learnings/corrections ──────────────────────────────────────
  // Meta-Lernen-Feed: chronologische Liste der admin-Korrekturen. Diese Tupel
  // (original → corrected) sind das Trainingsmaterial für die nächste Iteration
  // des Suggestion-Generators. Reine Read-Only-Sicht für Admin; nicht für Kunden.
  app.get('/admin/learnings/corrections', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }).safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', details: q.error.flatten() });

    const res = await pool.query(
      `SELECT id, created_at, source_kind, source_id, summary,
              original_text, corrected_text, correction_reason,
              scope_applied, applied_by, used_for_meta_at
         FROM learning_corrections
        ORDER BY created_at DESC
        LIMIT $1`,
      [q.data.limit],
    );
    return {
      corrections: res.rows.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        createdAt: (r.created_at as Date).toISOString(),
        sourceKind: r.source_kind as string,
        sourceId: r.source_id as string,
        summary: r.summary as string | null,
        originalText: r.original_text as string,
        correctedText: r.corrected_text as string,
        correctionReason: r.correction_reason as string | null,
        scopeApplied: r.scope_applied as string | null,
        appliedBy: r.applied_by as string | null,
        usedForMetaAt: r.used_for_meta_at ? (r.used_for_meta_at as Date).toISOString() : null,
      })),
    };
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
      nummer: 8.99,
      starter: 79,
      pro: 179,
      agency: 349,
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
  app.get('/admin/users', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });

    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role, u.created_at, u.is_active,
              o.id as org_id, o.name as org_name, o.plan, o.plan_status
       FROM users u
       LEFT JOIN orgs o ON o.id = u.org_id
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [q.limit, q.offset],
    );
    return { items: rows };
  });

  // ── GET /admin/orgs ───────────────────────────────────────────────────────
  app.get('/admin/orgs', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });

    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const { rows } = await pool.query(
      `SELECT o.id, o.name, o.slug, o.plan, o.plan_status, o.is_active, o.created_at,
              o.minutes_used, o.minutes_limit,
              (SELECT COUNT(*) FROM agent_configs ac WHERE ac.org_id = o.id) as agents_count,
              (SELECT COUNT(*) FROM users u2 WHERE u2.org_id = o.id) as users_count
       FROM orgs o
       ORDER BY o.created_at DESC
       LIMIT $1 OFFSET $2`,
      [q.limit, q.offset],
    );
    return { items: rows };
  });
}
