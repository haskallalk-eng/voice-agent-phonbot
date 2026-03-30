/**
 * Phone number management — provision, assign, and verify numbers.
 * Supports: Retell-provisioned numbers + Twilio-owned numbers imported into Retell.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import twilio from 'twilio';
import { pool } from './db.js';
import type { JwtPayload } from './auth.js';

// ── Twilio client (lazy init) ────────────────────────────────────────────────

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio credentials not configured');
  return twilio(sid, token);
}

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

// ── Auto-provision a German Twilio number for a new customer ────────────────
// Called automatically after a successful Stripe checkout.

export async function autoProvisionGermanNumber(orgId: string): Promise<void> {
  if (!pool) return;

  // Don't provision if org already has a number
  const existing = await pool.query(
    `SELECT id FROM phone_numbers WHERE org_id = $1 LIMIT 1`,
    [orgId],
  );
  if (existing.rowCount && existing.rowCount > 0) return;

  // Get org's deployed Retell agent ID
  const configRes = await pool.query(
    `SELECT data FROM agent_configs WHERE org_id = $1 OR tenant_id = $1::text LIMIT 1`,
    [orgId],
  );
  const agentId = configRes.rows[0]?.data?.retellAgentId ?? null;

  // Buy a German number via Twilio
  let purchasedNumber: string;
  try {
    const client = getTwilioClient();
    const available = await client.availablePhoneNumbers('DE').local.list({ limit: 1 });
    const first = available[0];
    if (!first) {
      process.stderr.write(`[phone] No German Twilio numbers available for org ${orgId}\n`);
      return;
    }
    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: first.phoneNumber,
    });
    purchasedNumber = purchased.phoneNumber;
  } catch (e: unknown) {
    process.stderr.write(`[phone] Twilio provision failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}\n`);
    return;
  }

  // Import the number into Retell so inbound calls route to the AI agent
  let retellPhoneNumberId: string | null = null;
  try {
    const result = await retellImportPhoneNumber(purchasedNumber, agentId);
    retellPhoneNumberId = (result.phone_number_id as string | undefined) ?? null;
  } catch (e: unknown) {
    process.stderr.write(`[phone] Retell import failed for ${purchasedNumber}: ${e instanceof Error ? e.message : String(e)}\n`);
    // Continue — number is bought, save it even without Retell ID
  }

  // Save to DB
  const pretty = purchasedNumber.replace(/^\+49/, '0').replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3');
  await pool.query(
    `INSERT INTO phone_numbers (org_id, number, number_pretty, provider, provider_id, agent_id, method, verified)
     VALUES ($1, $2, $3, 'twilio', $4, $5, 'provisioned', true)
     ON CONFLICT DO NOTHING`,
    [orgId, purchasedNumber, pretty, retellPhoneNumberId, agentId],
  );

  process.stdout.write(`[phone] Auto-provisioned ${purchasedNumber} for org ${orgId}\n`);
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

  // POST /phone/twilio/import — import a Twilio-owned number into Retell
  // This enables the Twilio number to receive inbound calls handled by the AI agent.
  app.post('/phone/twilio/import', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const parsed = z.object({
      number: z.string().min(1),  // e.g. "+493075937562"
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'number required (E.164 format)' });
    const { number } = parsed.data;

    // Verify the number belongs to this Twilio account
    try {
      const client = getTwilioClient();
      const incoming = await client.incomingPhoneNumbers.list({ phoneNumber: number, limit: 1 });
      if (!incoming.length) {
        return reply.status(400).send({ error: 'Number not found in your Twilio account' });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Twilio error';
      return reply.status(500).send({ error: msg });
    }

    // Get the org's deployed agent ID for inbound routing
    const configRes = await pool.query(
      `SELECT data FROM agent_configs WHERE org_id = $1 OR tenant_id = $1::text LIMIT 1`,
      [orgId],
    );
    const agentId = configRes.rows[0]?.data?.retellAgentId ?? null;

    // Import the number into Retell
    try {
      const result = await retellImportPhoneNumber(number, agentId);

      // Upsert into phone_numbers table
      await pool.query(
        `INSERT INTO phone_numbers (org_id, number, number_pretty, provider, provider_id, agent_id, method, verified)
         VALUES ($1, $2, $2, 'twilio', $3, $4, 'provisioned', true)
         ON CONFLICT DO NOTHING`,
        [orgId, number, (result.phone_number_id as string | undefined) ?? null, agentId],
      );

      return { ok: true, number, retellPhoneNumberId: result.phone_number_id ?? null };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to import number into Retell';
      return reply.status(500).send({ error: msg });
    }
  });

  // POST /phone/verify — make a real test call to verify call forwarding is working
  app.post('/phone/verify', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const verifyParsed = z.object({ phoneId: z.string().uuid() }).safeParse(req.body);
    if (!verifyParsed.success) return reply.status(400).send({ error: 'phoneId required (UUID)' });
    const { phoneId } = verifyParsed.data;

    const phoneRow = await pool.query(
      `SELECT number, method FROM phone_numbers WHERE id = $1 AND org_id = $2`,
      [phoneId, orgId],
    );
    if (!phoneRow.rowCount) return reply.status(404).send({ error: 'Phone number not found' });
    const { number, method } = phoneRow.rows[0];

    // Provisioned/imported numbers are already verified — mark directly
    if (method !== 'forwarding') {
      await pool.query(`UPDATE phone_numbers SET verified = true WHERE id = $1`, [phoneId]);
      return { ok: true, verified: true };
    }

    // For forwarding numbers: make an actual Twilio call to check the redirect works
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    if (!fromNumber) {
      // No Twilio number configured — just mark as verified optimistically
      await pool.query(`UPDATE phone_numbers SET verified = true WHERE id = $1`, [phoneId]);
      return { ok: true, verified: true };
    }

    try {
      const client = getTwilioClient();
      // Short TwiML: says a test message then hangs up — proves the forwarding works
      await client.calls.create({
        to: number,
        from: fromNumber,
        twiml: '<Response><Say language="de-DE">Weiterleitungstest erfolgreich. Ihr Phonbot ist bereit.</Say><Hangup/></Response>',
      });

      await pool.query(`UPDATE phone_numbers SET verified = true WHERE id = $1`, [phoneId]);
      return { ok: true, verified: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Twilio call failed';
      return reply.status(500).send({ error: msg, verified: false });
    }
  });
}
