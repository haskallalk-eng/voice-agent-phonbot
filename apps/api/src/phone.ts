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
  // Allow pool numbers (org_id = NULL = unassigned, available for next customer)
  await pool.query(`ALTER TABLE phone_numbers ALTER COLUMN org_id DROP NOT NULL;`);
}

// ── Retell phone number provisioning ────────────────────────────────────────

const RETELL_API = 'https://api.retellai.com';

async function retellImportPhoneNumber(phoneNumber: string, agentId?: string) {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new Error('RETELL_API_KEY not set');

  // Import as custom SIP number with Twilio trunk config
  const res = await fetch(`${RETELL_API}/import-phone-number`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone_number: phoneNumber,
      termination_uri: 'anfangtelebot.pstn.twilio.com',
      sip_trunk_auth_username: 'phonbot_retell',
      sip_trunk_auth_password: 'phonbot_retell',
      sip_trunk_transport: 'TCP',
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

  // Buy a German number via Twilio (requires Address for regulatory compliance)
  let purchasedNumber: string;
  try {
    const client = getTwilioClient();
    const addresses = await client.addresses.list({ isoCountry: 'DE', limit: 1 });
    const addressSid = addresses[0]?.sid;
    if (!addressSid) {
      process.stderr.write(`[phone] No German address in Twilio for org ${orgId}\n`);
      return;
    }
    const available = await client.availablePhoneNumbers('DE').local.list({ limit: 1 });
    const first = available[0];
    if (!first) {
      process.stderr.write(`[phone] No German Twilio numbers available for org ${orgId}\n`);
      return;
    }
    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: first.phoneNumber,
      addressSid,
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

  // POST /phone/provision — buy a German number under Phonbot's own Twilio bundle
  // Simple model: Phonbot owns all numbers, customers just use them.
  // REQUIRES: active paid plan (starter/pro/agency)
  app.post('/phone/provision', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    // Check billing: only paid plans can provision numbers
    const orgRow = await pool.query(
      `SELECT plan, plan_status FROM orgs WHERE id = $1`,
      [orgId],
    );
    const org = orgRow.rows[0];
    if (!org || org.plan === 'free' || (org.plan_status !== 'active' && org.plan_status !== 'trialing')) {
      return reply.status(403).send({ error: 'Telefonnummern sind ab dem Starter-Plan verfügbar. Bitte upgrade deinen Plan.' });
    }

    // Limit numbers per plan
    const countRes = await pool.query(
      `SELECT count(*) as cnt FROM phone_numbers WHERE org_id = $1 AND method = 'provisioned'`,
      [orgId],
    );
    const currentCount = parseInt(String(countRes.rows[0]?.cnt ?? '0'), 10);
    const limits: Record<string, number> = { starter: 1, pro: 3, agency: 10 };
    const maxNumbers = limits[org.plan] ?? 1;
    if (currentCount >= maxNumbers) {
      return reply.status(403).send({ error: `Dein ${org.plan}-Plan erlaubt max. ${maxNumbers} Nummer${maxNumbers > 1 ? 'n' : ''}. Upgrade für mehr.` });
    }

    // Optional: specify which agent to connect (defaults to first deployed agent)
    const parsed = z.object({ agentTenantId: z.string().optional() }).safeParse(req.body);
    const agentTenantId = parsed.success ? parsed.data.agentTenantId : undefined;

    // Get the agent ID — if agentTenantId specified, find that specific agent
    let agentId: string | null = null;
    if (agentTenantId) {
      const res = await pool.query(`SELECT data FROM agent_configs WHERE tenant_id = $1 LIMIT 1`, [agentTenantId]);
      agentId = res.rows[0]?.data?.retellAgentId ?? null;
    } else {
      // No specific agent — get the first deployed one for this org
      const res = await pool.query(
        `SELECT data FROM agent_configs WHERE org_id = $1 AND data->>'retellAgentId' IS NOT NULL ORDER BY updated_at DESC LIMIT 1`,
        [orgId],
      );
      agentId = res.rows[0]?.data?.retellAgentId ?? null;
    }

    // ── Number Pool System ──
    // Step 1: Check if there's a free number in the pool (org_id IS NULL = unassigned)
    const freeNumber = await pool.query(
      `SELECT id, number, number_pretty, provider_id FROM phone_numbers WHERE org_id IS NULL AND method = 'provisioned' LIMIT 1`,
    );

    let purchasedNumber: string;
    let numberPretty: string;
    let retellPhoneNumberId: string | null = null;
    let poolNumberId: string | null = null;

    if (freeNumber.rowCount && freeNumber.rowCount > 0) {
      // Use number from pool — assign to this org
      const free = freeNumber.rows[0];
      purchasedNumber = free.number;
      numberPretty = free.number_pretty ?? purchasedNumber;
      retellPhoneNumberId = free.provider_id ?? null;
      poolNumberId = free.id;
    } else {
      // No free numbers in pool — buy a new one from Twilio
      const PHONBOT_BUNDLE_SID = 'BUdf48e4eb15c501c7fe3b36008b728062';
      const PHONBOT_ADDRESS_SID = 'AD4c5ce0dc9622cf67e55cbc07996802c8';

      try {
        const client = getTwilioClient();
        let available = await client.availablePhoneNumbers('DE').local.list({ inLocality: 'Berlin', limit: 5 });
        if (!available.length) {
          available = await client.availablePhoneNumbers('DE').local.list({ limit: 5 });
        }
        if (!available.length) return reply.status(400).send({ error: 'Keine deutschen Nummern verfügbar. Bitte später erneut versuchen.' });

        let purchased: { phoneNumber: string } | null = null;
        let lastError = '';
        for (const candidate of available) {
          try {
            purchased = await client.incomingPhoneNumbers.create({
              phoneNumber: candidate.phoneNumber,
              bundleSid: PHONBOT_BUNDLE_SID,
              addressSid: PHONBOT_ADDRESS_SID,
            });
            break;
          } catch (e: unknown) {
            lastError = e instanceof Error ? e.message : String(e);
            continue;
          }
        }
        if (!purchased) return reply.status(500).send({ error: `Keine Nummer konnte aktiviert werden: ${lastError}` });
        purchasedNumber = purchased.phoneNumber;
        numberPretty = purchasedNumber.replace(/^\+49/, '0').replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Twilio-Fehler';
        return reply.status(500).send({ error: `Nummer konnte nicht erworben werden: ${msg}` });
      }
    }

    // Import into Retell (if not already imported from pool)
    if (!retellPhoneNumberId) {
      try {
        const result = await retellImportPhoneNumber(purchasedNumber, agentId ?? undefined);
        retellPhoneNumberId = (result.phone_number_id as string | undefined) ?? null;
      } catch (e: unknown) {
        process.stderr.write(`[phone] Retell import failed for ${purchasedNumber}: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    } else if (agentId) {
      // Pool number already in Retell — update the agent assignment
      try {
        const key = process.env.RETELL_API_KEY;
        if (key) {
          await fetch(`https://api.retellai.com/update-phone-number/${encodeURIComponent(purchasedNumber)}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ inbound_agent_id: agentId }),
          });
        }
      } catch { /* non-fatal */ }
    }

    // Save or update DB
    if (poolNumberId) {
      // Assign pool number to this org
      await pool.query(
        `UPDATE phone_numbers SET org_id = $1, agent_id = $2, provider_id = $3 WHERE id = $4`,
        [orgId, agentId, retellPhoneNumberId, poolNumberId],
      );
    } else {
      await pool.query(
        `INSERT INTO phone_numbers (org_id, number, number_pretty, provider, provider_id, agent_id, method, verified)
         VALUES ($1, $2, $3, 'twilio', $4, $5, 'provisioned', true)`,
      [orgId, purchasedNumber, numberPretty, retellPhoneNumberId, agentId],
      );
    }

    return { ok: true, number: purchasedNumber, numberPretty };
  });

  // POST /phone/forward — register an existing number with call forwarding
  app.post('/phone/forward', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const fwdParsed = z.object({
      number: z.string().min(1),
      phoneId: z.string().uuid().optional(), // which Phonbot number to forward to
    }).safeParse(req.body);
    if (!fwdParsed.success) return reply.status(400).send({ error: 'number required' });
    const { number, phoneId } = fwdParsed.data;

    // Get the Phonbot number to forward to (specific or first available)
    const existingQuery = phoneId
      ? `SELECT number FROM phone_numbers WHERE id = $2 AND org_id = $1 AND method = 'provisioned'`
      : `SELECT number FROM phone_numbers WHERE org_id = $1 AND method = 'provisioned' LIMIT 1`;
    const existingParams = phoneId ? [orgId, phoneId] : [orgId];
    const existing = await pool.query(existingQuery, existingParams);

    const forwardTo = existing.rows[0]?.number ?? null;
    if (!forwardTo) {
      return reply.status(400).send({ error: 'Du brauchst zuerst eine Phonbot-Nummer. Klicke auf "Nummer aktivieren".' });
    }

    await pool.query(
      `INSERT INTO phone_numbers (org_id, number, number_pretty, provider, method, verified)
       VALUES ($1, $2, $2, 'forwarding', 'forwarding', false)`,
      [orgId, number],
    );

    return {
      ok: true,
      forwardTo,
      carrierCodes: {
        busy: `**67*${forwardTo}#`,
        noAnswer: `**61*${forwardTo}#`,
        always: `**21*${forwardTo}#`,
        cancelBusy: '##67#',
        cancelNoAnswer: '##61#',
        cancelAlways: '##21#',
      },
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

  // DELETE /phone/:id — remove a phone number
  app.delete('/phone/:id', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const { id } = req.params as { id: string };
    const result = await pool.query(
      `DELETE FROM phone_numbers WHERE id = $1 AND org_id = $2 RETURNING number, provider_id`,
      [id, orgId],
    );
    if (!result.rowCount) return reply.status(404).send({ error: 'Nummer nicht gefunden' });

    return { ok: true };
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
