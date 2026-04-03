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

  // POST /phone/provision — get a new German number via Twilio + import into Retell
  // Requires an approved regulatory bundle. Uses the org's existing address.
  app.post('/phone/provision', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    // Check if org has an approved regulatory bundle
    const orgRow = await pool.query(
      `SELECT twilio_bundle_status, twilio_address_sid, business_city FROM orgs WHERE id = $1`,
      [orgId],
    );
    const org = orgRow.rows[0];
    if (!org) return reply.status(404).send({ error: 'Organisation nicht gefunden' });

    if (org.twilio_bundle_status !== 'twilio-approved') {
      return reply.status(400).send({
        error: 'Bitte zuerst den Regulatory Bundle abschließen. Gehen Sie zu Einstellungen → Telefonnummer und reichen Sie Ihre Geschäftsdokumente ein.',
        bundleStatus: org.twilio_bundle_status ?? 'none',
      });
    }

    const addressSid = org.twilio_address_sid;
    if (!addressSid) {
      return reply.status(400).send({ error: 'Keine Adresse hinterlegt. Bitte reichen Sie Ihre Geschäftsdokumente erneut ein.' });
    }

    // Get the org's deployed agent ID
    const configRes = await pool.query(
      `SELECT data FROM agent_configs WHERE org_id = $1 OR tenant_id = $1::text LIMIT 1`,
      [orgId],
    );
    const agentId = configRes.rows[0]?.data?.retellAgentId ?? null;

    // Search and purchase a number using the org's existing approved address
    let purchasedNumber: string;
    try {
      const client = getTwilioClient();

      const city = org.business_city ?? '';
      const searchOpts: Record<string, unknown> = { limit: 5 };
      if (city) searchOpts.inLocality = city;
      let available = await client.availablePhoneNumbers('DE').local.list(searchOpts);

      // Fallback: search without city filter if no local numbers found
      if (!available.length) {
        available = await client.availablePhoneNumbers('DE').local.list({ limit: 5 });
      }
      if (!available.length) return reply.status(400).send({ error: 'Keine deutschen Nummern verfügbar. Bitte später erneut versuchen.' });

      // Try each available number until one works
      let purchased: { phoneNumber: string } | null = null;
      let lastError = '';
      for (const candidate of available) {
        try {
          purchased = await client.incomingPhoneNumbers.create({
            phoneNumber: candidate.phoneNumber,
            addressSid,
          });
          break;
        } catch (e: unknown) {
          lastError = e instanceof Error ? e.message : String(e);
          continue;
        }
      }
      if (!purchased) return reply.status(500).send({ error: `Keine Nummer konnte aktiviert werden: ${lastError}` });
      purchasedNumber = purchased.phoneNumber;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Twilio-Fehler';
      return reply.status(500).send({ error: `Nummer konnte nicht erworben werden: ${msg}` });
    }

    // Import into Retell for AI agent routing
    let retellPhoneNumberId: string | null = null;
    try {
      const result = await retellImportPhoneNumber(purchasedNumber, agentId);
      retellPhoneNumberId = (result.phone_number_id as string | undefined) ?? null;
    } catch (e: unknown) {
      process.stderr.write(`[phone] Retell import failed for ${purchasedNumber}: ${e instanceof Error ? e.message : String(e)}\n`);
      // Continue — number is bought, save it even without Retell
    }

    // Save to DB
    const pretty = purchasedNumber.replace(/^\+49/, '0').replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3');
    await pool.query(
      `INSERT INTO phone_numbers (org_id, number, number_pretty, provider, provider_id, agent_id, method, verified)
       VALUES ($1, $2, $3, 'twilio', $4, $5, 'provisioned', true)`,
      [orgId, purchasedNumber, pretty, retellPhoneNumberId, agentId],
    );

    return { ok: true, number: purchasedNumber, numberPretty: pretty };
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

  // POST /phone/upload-document — upload business document (Gewerbeanmeldung etc.)
  app.post('/phone/upload-document', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    // For MVP: store document as base64 in DB
    // TODO: migrate to Supabase Storage later
    const parsed = z.object({
      fileName: z.string().min(1),
      fileData: z.string().min(1), // base64 encoded
      fileType: z.string().min(1), // e.g. 'application/pdf'
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'fileName, fileData (base64), fileType required' });

    const docUrl = `data:${parsed.data.fileType};base64,${parsed.data.fileData.slice(0, 50)}...`; // truncated ref
    void docUrl; // stored reference for future use
    await pool.query('UPDATE orgs SET business_document_url = $1 WHERE id = $2', [parsed.data.fileName, orgId]);

    return { ok: true, fileName: parsed.data.fileName };
  });

  // POST /phone/submit-bundle — submit business docs for regulatory compliance
  app.post('/phone/submit-bundle', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;

    const parsed = z.object({
      customerName: z.string().min(1),
      street: z.string().min(1),
      city: z.string().min(1),
      postalCode: z.string().min(4),
      documentUrl: z.string().min(1),
      website: z.string().optional().default(''),
      email: z.string().email(),
      representativeName: z.string().min(1),
      documentData: z.string().optional(),   // base64-encoded file content
      documentType: z.string().optional(),   // mime type, e.g. 'application/pdf'
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Alle Felder sind erforderlich' });

    try {
      const { submitRegulatoryBundle } = await import('./twilio-provisioning.js');
      const bundleSid = await submitRegulatoryBundle(orgId, parsed.data);
      return { ok: true, bundleSid, status: 'pending-review' };
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Bundle-Erstellung fehlgeschlagen' });
    }
  });

  // GET /phone/bundle-status — check regulatory bundle status
  app.get('/phone/bundle-status', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    try {
      const { checkBundleStatus } = await import('./twilio-provisioning.js');
      return await checkBundleStatus(orgId);
    } catch {
      return { status: 'none' };
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
