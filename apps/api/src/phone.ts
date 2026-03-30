/**
 * Phone number management — provision, assign, and verify numbers.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import type { JwtPayload } from './auth.js';

// ── DB Migration ────────────────────────────────────────────────────────────

export async function migratePhone() {
  if (!pool) return;
  await pool.query(`
    create table if not exists phone_numbers (
      id            uuid primary key default gen_random_uuid(),
      created_at    timestamptz not null default now(),
      org_id        uuid not null references orgs(id) on delete cascade,
      number        text not null,
      number_pretty text,
      provider      text not null default 'retell',
      provider_id   text,
      agent_id      text,
      method        text not null default 'provisioned',
      verified      boolean not null default false
    );
  `);
  await pool.query(`create index if not exists phone_numbers_org_idx on phone_numbers(org_id);`);
}

// ── Retell phone number provisioning ────────────────────────────────────────

const RETELL_API = 'https://api.retellai.com';

async function retellImportPhoneNumber(phoneNumber: string, agentId?: string) {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new Error('RETELL_API_KEY not set');

  const res = await fetch(`${RETELL_API}/create-phone-number`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone_number: phoneNumber,
      ...(agentId ? { inbound_agent_id: agentId } : {}),
    }),
  });

  if (!res.ok) throw new Error(`Retell: ${res.status} ${await res.text()}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function retellPurchasePhoneNumber(areaCode: string, agentId?: string) {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new Error('RETELL_API_KEY not set');

  const res = await fetch(`${RETELL_API}/create-phone-number`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      area_code: parseInt(areaCode, 10),
      ...(agentId ? { inbound_agent_id: agentId } : {}),
    }),
  });

  if (!res.ok) throw new Error(`Retell: ${res.status} ${await res.text()}`);
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Routes ──────────────────────────────────────────────────────────────────

export async function registerPhone(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] };

  // GET /phone — list phone numbers for org
  app.get('/phone', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return { items: [] };

    const { rows } = await pool.query(
      `SELECT id, number, number_pretty, provider, method, verified, agent_id
       FROM phone_numbers WHERE org_id = $1 ORDER BY created_at`,
      [orgId],
    );
    return { items: rows };
  });

  // POST /phone/provision — get a new number via Retell
  app.post('/phone/provision', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const parsed = z.object({ areaCode: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'areaCode required (e.g. "30" for Berlin)' });
    const { areaCode } = parsed.data;

    // Get the org's deployed agent ID
    const configRes = await pool.query(
      `SELECT data FROM agent_configs WHERE org_id = $1 OR tenant_id = $1::text LIMIT 1`,
      [orgId],
    );
    const agentId = configRes.rows[0]?.data?.retellAgentId ?? null;

    try {
      const result = await retellPurchasePhoneNumber(areaCode, agentId);
      const number = String(result.phone_number ?? result.phone_number_pretty ?? '');
      const pretty = String(result.phone_number_pretty ?? number);

      await pool.query(
        `INSERT INTO phone_numbers (org_id, number, number_pretty, provider, provider_id, agent_id, method, verified)
         VALUES ($1, $2, $3, 'retell', $4, $5, 'provisioned', true)`,
        [orgId, number, pretty, (result.phone_number_id as string | undefined) ?? null, agentId],
      );

      return { ok: true, number, numberPretty: pretty };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to provision number';
      return reply.status(500).send({ error: msg });
    }
  });

  // POST /phone/forward — register an existing number with call forwarding
  app.post('/phone/forward', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const fwdParsed = z.object({ number: z.string().min(1) }).safeParse(req.body);
    if (!fwdParsed.success) return reply.status(400).send({ error: 'number required' });
    const { number } = fwdParsed.data;

    // Get our inbound number that the user should forward to
    const existing = await pool.query(
      `SELECT number FROM phone_numbers WHERE org_id = $1 AND method = 'provisioned' LIMIT 1`,
      [orgId],
    );

    const forwardTo = existing.rows[0]?.number ?? process.env.TWILIO_FROM_NUMBER ?? null;
    if (!forwardTo) {
      return reply.status(400).send({ error: 'No inbound number available. Provision one first.' });
    }

    await pool.query(
      `INSERT INTO phone_numbers (org_id, number, number_pretty, provider, method, verified)
       VALUES ($1, $2, $2, 'forwarding', 'forwarding', false)`,
      [orgId, number],
    );

    return {
      ok: true,
      forwardTo,
      instructions: {
        iphone: `Einstellungen → Telefon → Rufumleitung → Aktivieren → Nummer: ${forwardTo}`,
        android: `Telefon App → ⋮ → Einstellungen → Anrufweiterleitung → Bei Besetzt: ${forwardTo}`,
        fritzbox: `Telefonie → Rufumleitung → Neue Rufumleitung → Bei besetzt → An: ${forwardTo}`,
      },
    };
  });

  // POST /phone/verify — verify forwarding works (we call the original number)
  app.post('/phone/verify', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const verifyParsed = z.object({ phoneId: z.string().uuid() }).safeParse(req.body);
    if (!verifyParsed.success) return reply.status(400).send({ error: 'phoneId required (UUID)' });
    const { phoneId } = verifyParsed.data;

    // For now, just mark as verified (actual call-verification is Sprint 3)
    await pool.query(
      `UPDATE phone_numbers SET verified = true WHERE id = $1 AND org_id = $2`,
      [phoneId, orgId],
    );

    return { ok: true, verified: true };
  });
}
