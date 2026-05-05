import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { normalizePhoneLight } from '@vas/shared';
import type { JwtPayload } from './auth.js';
import { pool } from './db.js';

export type CustomerModuleConfig = {
  enabled?: boolean;
  mindrailsInternal?: boolean;
};

type AgentConfigLike = {
  industry?: string;
  customerModule?: CustomerModuleConfig;
};

export type CustomerRow = {
  id: string;
  created_at: string;
  updated_at: string;
  org_id: string;
  full_name: string;
  normalized_name: string;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  customer_type: 'new' | 'existing' | 'unknown';
  status: 'active' | 'deleted';
  notes: string | null;
  details: Record<string, unknown>;
  last_seen_at: string | null;
  source_call_id: string | null;
};

export function customerModuleActiveForAgentConfig(config: AgentConfigLike | null | undefined): boolean {
  const module = config?.customerModule;
  if (module?.enabled !== true) return false;
  return config?.industry === 'hairdresser' || module.mindrailsInternal === true;
}

function normalizeName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCustomerPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const { digits, normalized } = normalizePhoneLight(input);
  if (!digits) return null;
  if (normalized.startsWith('+')) return normalized.slice(0, 64);
  if (digits.startsWith('00')) return `+${digits.slice(2)}`.slice(0, 64);
  if (digits.startsWith('0')) return `+49${digits.slice(1)}`.slice(0, 64);
  if (digits.startsWith('49') && digits.length >= 11) return `+${digits}`.slice(0, 64);
  return normalized.slice(0, 64);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const cur = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((cur[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j < prev.length; j += 1) prev[j] = cur[j] ?? 0;
  }
  return prev[b.length] ?? Math.max(a.length, b.length);
}

function nameSimilarity(query: string, candidate: string): number {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.includes(q) || q.includes(c)) return 0.88;

  const qTokens = new Set(q.split(' ').filter(Boolean));
  const cTokens = new Set(c.split(' ').filter(Boolean));
  const shared = [...qTokens].filter((token) => cTokens.has(token)).length;
  const tokenScore = shared / Math.max(qTokens.size, cTokens.size, 1);
  const distanceScore = 1 - levenshtein(q, c) / Math.max(q.length, c.length, 1);
  return Math.max(tokenScore * 0.82, distanceScore);
}

async function isMindrailsUser(userId: string): Promise<boolean> {
  if (!pool) return false;
  const res = await pool.query<{ email: string }>(
    `SELECT email FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  return res.rows[0]?.email?.trim().toLowerCase() === 'info@mindrails.de';
}

async function hasHairdresserAgent(orgId: string): Promise<boolean> {
  if (!pool) return true;
  const res = await pool.query(
    `SELECT 1
       FROM agent_configs
      WHERE org_id = $1
        AND (data->>'industry' = 'hairdresser' OR data->>'templateId' = 'hairdresser')
      LIMIT 1`,
    [orgId],
  );
  return Boolean(res.rowCount);
}

export async function canUseCustomerModule(orgId: string, userId?: string): Promise<boolean> {
  if (userId && await isMindrailsUser(userId)) return true;
  return hasHairdresserAgent(orgId);
}

export async function customerModuleStatus(orgId: string, userId?: string): Promise<{
  available: boolean;
  enabled: boolean;
  reason: 'hairdresser' | 'mindrails' | 'unavailable';
}> {
  const mindrails = userId ? await isMindrailsUser(userId) : false;
  const hairdresser = await hasHairdresserAgent(orgId);
  const available = mindrails || hairdresser;
  let enabled = false;
  if (pool) {
    const res = await pool.query<{ enabled: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM agent_configs
          WHERE org_id = $1
            AND COALESCE((data->'customerModule'->>'enabled')::boolean, false) = true
       ) AS enabled`,
      [orgId],
    );
    enabled = Boolean(res.rows[0]?.enabled);
  }
  return {
    available,
    enabled,
    reason: mindrails ? 'mindrails' : hairdresser ? 'hairdresser' : 'unavailable',
  };
}

const CustomerInput = z.object({
  fullName: z.string().min(1).max(200),
  phone: z.string().max(80).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  customerType: z.enum(['new', 'existing', 'unknown']).optional().default('unknown'),
  notes: z.string().max(2000).optional().nullable(),
  sourceCallId: z.string().max(200).optional().nullable(),
  details: z.record(z.string(), z.unknown()).optional().default({}),
});

export async function lookupCustomer(params: {
  orgId: string;
  phone?: string | null;
  name?: string | null;
}): Promise<{
  ok: boolean;
  status: 'matched' | 'not_found' | 'candidates' | 'unavailable';
  matchType?: 'phone' | 'name';
  customer?: CustomerRow;
  candidates?: Array<CustomerRow & { score: number }>;
  instruction: string;
}> {
  if (!pool) {
    return {
      ok: true,
      status: 'not_found',
      instruction: 'Keine Kundendatenbank im lokalen Dev-Modus. Behandle den Anrufer als Neukunde.',
    };
  }

  const phone = normalizeCustomerPhone(params.phone);
  if (phone) {
    const res = await pool.query<CustomerRow>(
      `SELECT id, created_at, updated_at, org_id, full_name, normalized_name,
              phone, phone_normalized, email, customer_type, status, notes,
              details, last_seen_at, source_call_id
         FROM customers
        WHERE org_id = $1 AND phone_normalized = $2 AND status = 'active'
        LIMIT 1`,
      [params.orgId, phone],
    );
    if (res.rows[0]) {
      return {
        ok: true,
        status: 'matched',
        matchType: 'phone',
        customer: res.rows[0],
        instruction: 'Nummer erkannt. Frage nicht nach Bestandskunde oder Neukunde; fuehre den normalen Friseur-Flow fort.',
      };
    }
  }

  const name = params.name?.trim();
  if (name) {
    const normalized = normalizeName(name);
    const tokens = normalized.split(' ').filter((token) => token.length >= 2).slice(0, 4);
    const patterns = tokens.map((token) => `%${token}%`);
    const res = await pool.query<CustomerRow>(
      `SELECT id, created_at, updated_at, org_id, full_name, normalized_name,
              phone, phone_normalized, email, customer_type, status, notes,
              details, last_seen_at, source_call_id
         FROM customers
        WHERE org_id = $1
          AND status = 'active'
          AND (
            normalized_name = $2
            OR (array_length($3::text[], 1) IS NOT NULL AND normalized_name LIKE ANY($3::text[]))
          )
        ORDER BY
          CASE WHEN normalized_name = $2 THEN 0 ELSE 1 END,
          updated_at DESC
        LIMIT 1000`,
      [params.orgId, normalized, patterns],
    );
    const candidates = res.rows
      .map((row) => ({ ...row, score: nameSimilarity(name, row.full_name) }))
      .filter((row) => row.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (candidates[0] && candidates[0].score >= 0.86 && (!candidates[1] || candidates[0].score - candidates[1].score >= 0.08)) {
      return {
        ok: true,
        status: 'matched',
        matchType: 'name',
        customer: candidates[0],
        candidates,
        instruction: 'Name mit hoher Sicherheit erkannt. Fahre normal fort, aber buchstabiere kritische Daten wie E-Mail oder Namen bei Unsicherheit zurueck.',
      };
    }

    if (candidates.length) {
      return {
        ok: true,
        status: 'candidates',
        candidates,
        instruction: 'Es gibt aehnliche Namen. Frage kurz nach Vorname/Nachname oder Buchstabierung; lege nichts offen, was der Anrufer nicht selbst genannt hat.',
      };
    }
  }

  return {
    ok: true,
    status: 'not_found',
    instruction: 'Kein Kunde gefunden. Wenn der Anrufer sagt, er war schon einmal da, mache kein Problem daraus; lege ihn still neu an und fahre mit dem Neukunden-Friseurflow fort.',
  };
}

export async function upsertCustomer(params: {
  orgId: string;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  customerType?: 'new' | 'existing' | 'unknown';
  notes?: string | null;
  sourceCallId?: string | null;
  details?: Record<string, unknown>;
}): Promise<CustomerRow | null> {
  const parsed = CustomerInput.parse({
    fullName: params.fullName,
    phone: params.phone,
    email: params.email,
    customerType: params.customerType,
    notes: params.notes,
    sourceCallId: params.sourceCallId,
    details: params.details,
  });
  const phoneNormalized = normalizeCustomerPhone(parsed.phone);
  const normalizedName = normalizeName(parsed.fullName);

  if (!pool) return null;
  if (phoneNormalized) {
    const res = await pool.query<CustomerRow>(
      `INSERT INTO customers (
         org_id, full_name, normalized_name, phone, phone_normalized,
         email, customer_type, notes, details, last_seen_at, source_call_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now(), $10)
       ON CONFLICT (org_id, phone_normalized) WHERE phone_normalized IS NOT NULL AND status = 'active'
       DO UPDATE SET
         full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), customers.full_name),
         normalized_name = COALESCE(NULLIF(EXCLUDED.normalized_name, ''), customers.normalized_name),
         phone = COALESCE(EXCLUDED.phone, customers.phone),
         email = COALESCE(EXCLUDED.email, customers.email),
         customer_type = CASE WHEN customers.customer_type = 'existing' THEN 'existing' ELSE EXCLUDED.customer_type END,
         notes = COALESCE(EXCLUDED.notes, customers.notes),
         details = customers.details || EXCLUDED.details,
         last_seen_at = now(),
         source_call_id = COALESCE(EXCLUDED.source_call_id, customers.source_call_id),
         updated_at = now()
       RETURNING id, created_at, updated_at, org_id, full_name, normalized_name,
                 phone, phone_normalized, email, customer_type, status, notes,
                 details, last_seen_at, source_call_id`,
      [
        params.orgId,
        parsed.fullName.trim(),
        normalizedName,
        parsed.phone ?? null,
        phoneNormalized,
        parsed.email ?? null,
        parsed.customerType,
        parsed.notes ?? null,
        JSON.stringify(parsed.details ?? {}),
        parsed.sourceCallId ?? null,
      ],
    );
    return res.rows[0] ?? null;
  }

  const res = await pool.query<CustomerRow>(
    `INSERT INTO customers (
       org_id, full_name, normalized_name, phone, phone_normalized,
       email, customer_type, notes, details, last_seen_at, source_call_id
     )
     VALUES ($1, $2, $3, NULL, NULL, $4, $5, $6, $7::jsonb, now(), $8)
     RETURNING id, created_at, updated_at, org_id, full_name, normalized_name,
               phone, phone_normalized, email, customer_type, status, notes,
               details, last_seen_at, source_call_id`,
    [
      params.orgId,
      parsed.fullName.trim(),
      normalizedName,
      parsed.email ?? null,
      parsed.customerType,
      parsed.notes ?? null,
      JSON.stringify(parsed.details ?? {}),
      parsed.sourceCallId ?? null,
    ],
  );
  return res.rows[0] ?? null;
}

async function requireCustomerModule(req: FastifyRequest, reply: FastifyReply): Promise<JwtPayload | null> {
  const user = req.user as JwtPayload;
  if (await canUseCustomerModule(user.orgId, user.userId)) return user;
  reply.status(403).send({ error: 'CUSTOMER_MODULE_UNAVAILABLE' });
  return null;
}

export async function registerCustomers(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] };

  app.get('/customers/status', { ...auth }, async (req: FastifyRequest) => {
    const { orgId, userId } = req.user as JwtPayload;
    return customerModuleStatus(orgId, userId);
  });

  app.get('/customers', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireCustomerModule(req, reply);
    if (!user) return reply;
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(100),
      search: z.string().max(100).optional(),
    }).parse(req.query);
    if (!pool) return { items: [] };

    const args: unknown[] = [user.orgId, q.limit];
    let where = `org_id = $1 AND status = 'active'`;
    if (q.search?.trim()) {
      args.push(`%${q.search.trim().toLowerCase()}%`);
      where += ` AND (LOWER(full_name) LIKE $${args.length} OR phone_normalized LIKE $${args.length} OR LOWER(COALESCE(email, '')) LIKE $${args.length})`;
    }
    const res = await pool.query<CustomerRow>(
      `SELECT id, created_at, updated_at, org_id, full_name, normalized_name,
              phone, phone_normalized, email, customer_type, status, notes,
              details, last_seen_at, source_call_id
         FROM customers
        WHERE ${where}
        ORDER BY updated_at DESC
        LIMIT $2`,
      args,
    );
    return { items: res.rows };
  });

  app.post('/customers', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireCustomerModule(req, reply);
    if (!user) return reply;
    const body = CustomerInput.parse(req.body ?? {});
    const row = await upsertCustomer({
      orgId: user.orgId,
      fullName: body.fullName,
      phone: body.phone,
      email: body.email,
      customerType: body.customerType,
      notes: body.notes,
      sourceCallId: body.sourceCallId,
      details: body.details,
    });
    reply.code(201);
    return row;
  });

  app.patch('/customers/:id', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireCustomerModule(req, reply);
    if (!user) return reply;
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = CustomerInput.partial().parse(req.body ?? {});
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });
    const phoneNormalized = normalizeCustomerPhone(body.phone);
    const normalizedName = body.fullName ? normalizeName(body.fullName) : undefined;
    const res = await pool.query<CustomerRow>(
      `UPDATE customers
          SET full_name = COALESCE($3, full_name),
              normalized_name = COALESCE($4, normalized_name),
              phone = COALESCE($5, phone),
              phone_normalized = COALESCE($6, phone_normalized),
              email = COALESCE($7, email),
              customer_type = COALESCE($8, customer_type),
              notes = COALESCE($9, notes),
              details = details || COALESCE($10::jsonb, '{}'::jsonb),
              updated_at = now()
        WHERE id = $1 AND org_id = $2 AND status = 'active'
        RETURNING id, created_at, updated_at, org_id, full_name, normalized_name,
                  phone, phone_normalized, email, customer_type, status, notes,
                  details, last_seen_at, source_call_id`,
      [
        params.id,
        user.orgId,
        body.fullName?.trim() ?? null,
        normalizedName ?? null,
        body.phone ?? null,
        phoneNormalized,
        body.email ?? null,
        body.customerType ?? null,
        body.notes ?? null,
        body.details ? JSON.stringify(body.details) : null,
      ],
    );
    if (!res.rows[0]) return reply.status(404).send({ error: 'NOT_FOUND' });
    return res.rows[0];
  });

  app.delete('/customers/:id', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireCustomerModule(req, reply);
    if (!user) return reply;
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!pool) return { ok: true };
    const res = await pool.query(
      `UPDATE customers SET status = 'deleted', updated_at = now()
        WHERE id = $1 AND org_id = $2 AND status = 'active'
        RETURNING id`,
      [params.id, user.orgId],
    );
    if (!res.rowCount) return reply.status(404).send({ error: 'NOT_FOUND' });
    return { ok: true };
  });
}
