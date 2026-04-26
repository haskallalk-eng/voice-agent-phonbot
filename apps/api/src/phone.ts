/**
 * Phone number management — provision, assign, and verify numbers.
 * Supports: Retell-provisioned numbers + Twilio-owned numbers imported into Retell.
 */
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import twilio from 'twilio';
import { pool } from './db.js';
import { redis } from './redis.js';
import type { JwtPayload } from './auth.js';

// ── Twilio client (lazy init) ────────────────────────────────────────────────

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio credentials not configured');
  return twilio(sid, token);
}

// ── Phone-prefix whitelist (anti-toll-fraud) ─────────────────────────────────
// Any route that initiates a real outbound Twilio call on a user-supplied number
// MUST validate it against this list. Without this, an authenticated user can
// POST arbitrary +1-900-* / +44-9-* premium-rate numbers and drain the Twilio
// budget (classic IRSF). Environment-override for legitimate international
// expansion.
const ALLOWED_PHONE_PREFIXES = (process.env.ALLOWED_PHONE_PREFIXES ?? '+49,+43,+41')
  .split(',').map(p => p.trim()).filter(Boolean);

function isPhonePrefixAllowed(number: string): boolean {
  return ALLOWED_PHONE_PREFIXES.some(p => number.startsWith(p));
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
  // Unique index on number to prevent duplicates
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS phone_numbers_number_uniq ON phone_numbers(number);`);
  // T-27: audit-trail for number lifecycle (assign / unassign / agent reassign).
  // updated_at is auto-maintained by a trigger so application code stays clean.
  await pool.query(`ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`);
  await pool.query(`
    CREATE OR REPLACE FUNCTION phone_numbers_touch_updated_at() RETURNS trigger AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'phone_numbers_touch_updated_at_trg') THEN
        CREATE TRIGGER phone_numbers_touch_updated_at_trg
          BEFORE UPDATE ON phone_numbers
          FOR EACH ROW EXECUTE FUNCTION phone_numbers_touch_updated_at();
      END IF;
    END $$;
  `);

  // forwarding_type: 'always' | 'no_answer' | null — set by /phone/verify-forwarding
  // when the loop-test confirms forwarding to a Phonbot inbound. Pre-2026-04
  // rows may carry legacy values ('busy', 'unknown', 'not_forwarded'); the
  // frontend treats those as unverified (maybe_loop) and prompts re-test.
  await pool.query(`ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS forwarding_type TEXT;`);
  // customer_number: the business's own number that forwards to this Phonbot number
  await pool.query(`ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS customer_number TEXT;`);

  // Sync: ensure all Twilio numbers exist in DB (prevents buying duplicates)
  await syncTwilioNumbersToDb();
}

// Max unassigned numbers to keep in pool — rest gets released from Twilio to save costs
const MAX_POOL_SIZE = 3;

/**
 * Sync all Twilio-owned numbers into the DB.
 * Numbers that exist in Twilio but not in DB are added as pool numbers (org_id = NULL).
 * Then trims pool to MAX_POOL_SIZE by releasing excess numbers from Twilio.
 * Runs on every startup to prevent the "bought numbers not in DB" bug.
 *
 * T-22: a rolling-deploy with N replicas would otherwise call Twilio's
 * incomingPhoneNumbers.list N times within seconds, plus N delete chains via
 * trimPool. Twilio's REST API rate-limit (~10 req/s per account) bites fast.
 * Redis advisory lock with a 10-min TTL coalesces the work to one container
 * per deploy window. Fail-open if Redis is down (single instance scenario).
 */
export async function syncTwilioNumbersToDb() {
  if (!pool) return;

  if (redis?.isOpen) {
    const gotLock = await redis.set('phone:twilio-sync-lock', String(Date.now()), { NX: true, EX: 600 }).catch(() => null);
    if (!gotLock) {
      process.stdout.write('[phone] syncTwilioNumbersToDb skipped — another instance holds the sync lock\n');
      return;
    }
  }

  try {
    const client = getTwilioClient();
    const twilioNumbers = await client.incomingPhoneNumbers.list({ limit: 100 });

    // Step 1: Sync missing numbers into DB (batch check to avoid N+1 queries)
    const existingRes = await pool.query('SELECT number FROM phone_numbers');
    const existingNumbers = new Set(existingRes.rows.map((r: { number: string }) => r.number));

    let synced = 0;
    for (const num of twilioNumbers) {
      if (existingNumbers.has(num.phoneNumber)) continue;

      const pretty = num.phoneNumber.replace(/^\+49/, '0').replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3');
      await pool.query(
        `INSERT INTO phone_numbers (org_id, number, number_pretty, provider, method, verified)
         VALUES (NULL, $1, $2, 'twilio', 'provisioned', true)
         ON CONFLICT (number) DO NOTHING`,
        [num.phoneNumber, pretty],
      );
      synced++;
    }
    if (synced > 0) {
      process.stdout.write(`[phone] Synced ${synced} Twilio numbers to DB pool\n`);
    }

    // Step 2: Trim pool — release excess unassigned numbers from Twilio
    await trimPool(client);
  } catch (e) {
    process.stderr.write(`[phone] Twilio sync skipped: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

/**
 * Release excess pool numbers from Twilio to save costs.
 * Keeps MAX_POOL_SIZE unassigned numbers, releases the rest.
 *
 * Concurrency: two containers booting simultaneously would otherwise both
 * enumerate the same "excess" set and each issue the same remove() calls →
 * phone numbers lost / double-billed cancel. Guard with Redis advisory lock.
 * TTL 5 min so a crashed holder releases eventually.
 */
async function trimPool(client?: ReturnType<typeof getTwilioClient>) {
  if (!pool) return;

  // Only one container trims at a time.
  if (redis?.isOpen) {
    const gotLock = await redis.set('phone:trim-lock', String(Date.now()), { NX: true, EX: 300 }).catch(() => null);
    if (!gotLock) {
      process.stdout.write('[phone] trimPool skipped — another instance holds the lock\n');
      return;
    }
  }

  try {
    // Get all unassigned pool numbers, oldest first
    const poolNumbers = await pool.query(
      `SELECT id, number FROM phone_numbers
       WHERE org_id IS NULL AND method = 'provisioned'
       ORDER BY created_at ASC`,
    );

    const excess = (poolNumbers.rowCount ?? 0) - MAX_POOL_SIZE;
    if (excess <= 0) return;

    const cli = client ?? getTwilioClient();
    let released = 0;

    // Release oldest excess numbers
    for (let i = 0; i < excess; i++) {
      const num = poolNumbers.rows[i];
      try {
        // Find in Twilio and release
        const incoming = await cli.incomingPhoneNumbers.list({ phoneNumber: num.number, limit: 1 });
        if (incoming[0]) {
          await cli.incomingPhoneNumbers(incoming[0].sid).remove();
        }
        // Remove from DB
        await pool.query(`DELETE FROM phone_numbers WHERE id = $1`, [num.id]);
        released++;
        process.stdout.write(`[phone] Released ${num.number} from pool (cost saving)\n`);
      } catch (e) {
        process.stderr.write(`[phone] Failed to release ${num.number}: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    }

    if (released > 0) {
      process.stdout.write(`[phone] Pool trimmed: released ${released} numbers, keeping ${MAX_POOL_SIZE}\n`);
    }
  } catch (e) {
    process.stderr.write(`[phone] Pool trim failed: ${e instanceof Error ? e.message : String(e)}\n`);
  } finally {
    if (redis?.isOpen) await redis.del('phone:trim-lock').catch(() => {});
  }
}

// ── Retell phone number provisioning ────────────────────────────────────────

const RETELL_API = 'https://api.retellai.com';

async function retellImportPhoneNumber(phoneNumber: string, agentId?: string) {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new Error('RETELL_API_KEY not set');

  // SIP trunk credentials must be explicit — defaulting to the published example
  // ('phonbot_retell') effectively publishes our trunk password in the repo and
  // lets anyone register to anfangtelebot.pstn.twilio.com → inbound call hijack.
  const sipUser = process.env.SIP_TRUNK_USERNAME;
  const sipPass = process.env.SIP_TRUNK_PASSWORD;
  if (!sipUser || !sipPass) {
    throw new Error('SIP_TRUNK_USERNAME and SIP_TRUNK_PASSWORD must be set — refusing to import phone number with default creds');
  }

  // Import as custom SIP number with Twilio trunk config
  const res = await fetch(`${RETELL_API}/import-phone-number`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone_number: phoneNumber,
      // T-23: in production we refuse the legacy 'anfangtelebot.pstn.twilio.com'
      // default — a fork or fresh deployment must explicitly point at its own SIP
      // termination URI so calls can't accidentally route through Phonbot's trunk.
      termination_uri: process.env.SIP_TERMINATION_URI ?? (
        process.env.NODE_ENV === 'production'
          ? (() => { throw new Error('SIP_TERMINATION_URI is required in production'); })()
          : 'anfangtelebot.pstn.twilio.com'
      ),
      sip_trunk_auth_username: sipUser,
      sip_trunk_auth_password: sipPass,
      sip_trunk_transport: 'TCP',
      ...(agentId ? { inbound_agent_id: agentId } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
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
    // T-26: match retellImportPhoneNumber — 15s hard cap so a hung Retell call
    // can't stall the provisioning request indefinitely. The caller
    // (/phone/provision) already sets a Fastify timeout on top; this is a
    // belt-and-suspenders deadline for the individual upstream hop.
    signal: AbortSignal.timeout(15_000),
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
    `SELECT data FROM agent_configs WHERE org_id = $1 LIMIT 1`,
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

// ── Forwarding-Verification (real loop test) ────────────────────────────────
//
// The honest way to verify a customer's call-forwarding actually targets our
// Phonbot inbound: dial the customer's number from a SEPARATE verifier trunk
// (a Twilio number that is NOT imported into Retell), and watch the inbound
// webhook on the Phonbot number for a call whose caller-ID matches either the
// verifier (carrier preserved caller-ID — most German GSM with **21#/**61#)
// or the customer number itself (some SIP/Fritzbox setups rewrite caller-ID).
//
// Two halves:
//   • setPendingForwardingVerification + setForwardingVerificationResult are
//     called by /phone/verify-forwarding.
//   • checkForwardingVerificationMatch is called fire-and-forget from the
//     retell call_started webhook hook to close the loop.

const VERIFY_PENDING_TTL_S = 90;
const VERIFY_RESULT_TTL_S = 60;

type PendingForwardingVerification = {
  token: string;
  orgId: string;
  phonbotNumberId: string;
  phonbotNumber: string;
  customerNumber: string;
  verifierNumber: string;
  startedAt: number;
};

type ForwardingVerificationResult = {
  ok: true;
  confidence: 'high' | 'medium';
  matchedFrom: string;
  forwardingType: 'always' | 'no_answer';
  elapsedMs: number;
};

function pendingVerifyKey(phonbotNumber: string): string {
  return `phone-verify:pending:${phonbotNumber}`;
}

function resultVerifyKey(token: string): string {
  return `phone-verify:result:${token}`;
}

function normalizeE164(n: string): string {
  return n.replace(/[\s\-()]/g, '').trim();
}

async function setPendingForwardingVerification(p: PendingForwardingVerification): Promise<boolean> {
  if (!redis?.isOpen) return false;
  const ok = await redis
    .set(pendingVerifyKey(p.phonbotNumber), JSON.stringify(p), { EX: VERIFY_PENDING_TTL_S })
    .catch(() => null);
  return ok != null;
}

async function getPendingForwardingVerification(phonbotNumber: string): Promise<PendingForwardingVerification | null> {
  if (!redis?.isOpen) return null;
  const raw = await redis.get(pendingVerifyKey(phonbotNumber)).catch(() => null);
  if (!raw) return null;
  try { return JSON.parse(raw) as PendingForwardingVerification; } catch { return null; }
}

async function clearPendingForwardingVerification(phonbotNumber: string): Promise<void> {
  if (!redis?.isOpen) return;
  await redis.del(pendingVerifyKey(phonbotNumber)).catch(() => null);
}

async function setForwardingVerificationResult(token: string, result: ForwardingVerificationResult): Promise<void> {
  if (!redis?.isOpen) return;
  await redis
    .set(resultVerifyKey(token), JSON.stringify(result), { EX: VERIFY_RESULT_TTL_S })
    .catch(() => null);
}

async function getForwardingVerificationResult(token: string): Promise<ForwardingVerificationResult | null> {
  if (!redis?.isOpen) return null;
  const raw = await redis.get(resultVerifyKey(token)).catch(() => null);
  if (!raw) return null;
  try { return JSON.parse(raw) as ForwardingVerificationResult; } catch { return null; }
}

/**
 * Called fire-and-forget from the retell call_started webhook handler.
 * If a forwarding-verification is pending for the inbound's destination
 * number AND the caller-ID matches the verifier (or the customer number as
 * fallback), records a successful match in Redis. The /phone/verify-forwarding
 * endpoint polls that result.
 *
 * Must not throw — webhook flow is critical and unrelated to verification.
 */
export async function checkForwardingVerificationMatch(
  toNumber: string | null | undefined,
  fromNumber: string | null | undefined,
): Promise<void> {
  if (!toNumber || !fromNumber) return;
  const toNorm = normalizeE164(toNumber);
  const pending = await getPendingForwardingVerification(toNorm);
  if (!pending) return;

  const fromNorm = normalizeE164(fromNumber);
  const verifierNorm = normalizeE164(pending.verifierNumber);
  const customerNorm = normalizeE164(pending.customerNumber);

  let confidence: 'high' | 'medium' | null = null;
  if (fromNorm === verifierNorm) confidence = 'high';
  else if (fromNorm === customerNorm) confidence = 'medium';
  if (!confidence) return;

  const elapsedMs = Date.now() - pending.startedAt;
  // CFNR ("Bei Nichtannahme") needs ~15-25s before the carrier forwards.
  // CFU ("Immer") forwards within a few seconds. 10s is the practical cutoff.
  const forwardingType: 'always' | 'no_answer' = elapsedMs < 10_000 ? 'always' : 'no_answer';

  await setForwardingVerificationResult(pending.token, {
    ok: true,
    confidence,
    matchedFrom: fromNumber,
    forwardingType,
    elapsedMs,
  });
  await clearPendingForwardingVerification(toNorm);
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
    // T-24: do not echo the full request body — future schema additions could
    // accidentally include PII and end up in structured logs.
    req.log.info({ agentTenantId }, '[phone/provision] received');

    // Get the agent ID — if agentTenantId specified, find that specific agent.
    // CRITICAL: scope by org_id. Without this, a user could bind a phone number
    // they just provisioned to another org's Retell agent (cross-tenant hijack
    // → incoming calls route to victim's agent → PII leak).
    let agentId: string | null = null;
    if (agentTenantId) {
      const res = await pool.query(
        `SELECT data FROM agent_configs WHERE tenant_id = $1 AND org_id = $2 LIMIT 1`,
        [agentTenantId, orgId],
      );
      if (!res.rowCount) {
        return reply.status(403).send({ error: 'Dieser Agent gehört nicht zu deiner Organisation.' });
      }
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
    // Atomically claim a free number from the pool using CTE (race-condition safe)
    const claimed = await pool.query(
      `WITH free AS (
         SELECT id FROM phone_numbers
         WHERE org_id IS NULL AND method = 'provisioned'
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE phone_numbers
       SET org_id = $1
       FROM free
       WHERE phone_numbers.id = free.id
       RETURNING phone_numbers.id, phone_numbers.number, phone_numbers.number_pretty, phone_numbers.provider_id`,
      [orgId],
    );

    let purchasedNumber: string;
    let numberPretty: string;
    let retellPhoneNumberId: string | null = null;
    let poolNumberId: string | null = null;

    if (claimed.rowCount && claimed.rowCount > 0) {
      const free = claimed.rows[0];
      purchasedNumber = free.number;
      numberPretty = free.number_pretty ?? purchasedNumber;
      retellPhoneNumberId = free.provider_id ?? null;
      poolNumberId = free.id;
    } else {
      // No free numbers in pool — try to buy a new one from Twilio
      // But if Twilio fails (no credit, auth issues), give a clear error
      // T-25: hardcoded fallbacks fingerprint Phonbot's Twilio account in source.
      // In prod we require explicit env so a fork can't unintentionally reuse them.
      const PHONBOT_BUNDLE_SID = process.env.TWILIO_BUNDLE_SID ?? (
        process.env.NODE_ENV === 'production'
          ? (() => { throw new Error('TWILIO_BUNDLE_SID is required in production'); })()
          : 'BUdf48e4eb15c501c7fe3b36008b728062'
      );
      const PHONBOT_ADDRESS_SID = process.env.TWILIO_ADDRESS_SID ?? (
        process.env.NODE_ENV === 'production'
          ? (() => { throw new Error('TWILIO_ADDRESS_SID is required in production'); })()
          : 'AD4c5ce0dc9622cf67e55cbc07996802c8'
      );

      try {
        const client = getTwilioClient();
        let available = await client.availablePhoneNumbers('DE').local.list({ inLocality: 'Berlin', limit: 5 });
        if (!available.length) {
          available = await client.availablePhoneNumbers('DE').local.list({ limit: 5 });
        }
        if (!available.length) return reply.status(400).send({ error: 'Keine freien Nummern im Pool und keine neuen verfügbar. Bitte kontaktiere den Support.' });

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
        if (!purchased) return reply.status(503).send({ error: 'Aktuell sind keine Nummern verfügbar. Bitte versuche es später erneut oder kontaktiere den Support.' });
        purchasedNumber = purchased.phoneNumber;
        numberPretty = purchasedNumber.replace(/^\+49/, '0').replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3');
      } catch (e: unknown) {
        // Twilio failed (auth, billing, etc.) — give user-friendly error
        return reply.status(503).send({ error: 'Aktuell sind keine Nummern verfügbar. Bitte versuche es später erneut oder kontaktiere den Support.' });
      }
    }

    // Connect number to agent in Retell
    const key = process.env.RETELL_API_KEY;
    if (key && agentId) {
      if (poolNumberId) {
        // Pool number — already in Retell, just update the agent
        try {
          await fetch(`https://api.retellai.com/update-phone-number/${encodeURIComponent(purchasedNumber)}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ inbound_agent_id: agentId }),
          });
          req.log.info({ number: purchasedNumber, agentId }, '[phone/provision] Retell agent updated');
        } catch (e: unknown) {
          req.log.error({ error: e instanceof Error ? e.message : String(e) }, '[phone/provision] Retell update failed');
        }
      } else {
        // New number — import into Retell
        try {
          const result = await retellImportPhoneNumber(purchasedNumber, agentId ?? undefined);
          retellPhoneNumberId = (result.phone_number_id as string | undefined) ?? null;
        } catch (e: unknown) {
          req.log.error({ error: e instanceof Error ? e.message : String(e) }, '[phone/provision] Retell import failed');
        }
      }
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
  // Rate-limited: the persisted forwarding number is later dialled by /phone/verify.
  // Spamming forward inserts + verify-triggers is a classic toll-fraud fan-out.
  app.post('/phone/forward', {
    ...auth,
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const fwdParsed = z.object({
      number: z.string().min(1),
      phoneId: z.string().uuid().optional(), // which Phonbot number to forward to
    }).safeParse(req.body);
    if (!fwdParsed.success) return reply.status(400).send({ error: 'number required' });
    const { number, phoneId } = fwdParsed.data;

    // Anti-toll-fraud: reject non-whitelisted prefixes. /phone/verify dials this
    // number back to test forwarding; an unvalidated entry turns the verify
    // endpoint into an arbitrary-dial vector (premium-rate / IRSF).
    if (!isPhonePrefixAllowed(number)) {
      return reply.status(400).send({ error: 'Aktuell nur Telefonnummern aus DACH (DE/AT/CH) unterstützt.' });
    }

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

    // T-29: prevent duplicate forwarding entries for the same org + number.
    // Without ON CONFLICT the same user could POST /phone/forward 10× with
    // the same number and pollute phone_numbers with identical rows — each
    // later showing up as a separate "forwarding number" in the dashboard.
    await pool.query(
      `INSERT INTO phone_numbers (org_id, number, number_pretty, provider, method, verified)
       VALUES ($1, $2, $2, 'forwarding', 'forwarding', false)
       ON CONFLICT (number) DO NOTHING`,
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
      `SELECT data FROM agent_configs WHERE org_id = $1 LIMIT 1`,
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

  // DELETE /phone/:id — remove a phone number (provisioned → return to pool, forwarding → delete)
  app.delete('/phone/:id', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const { id } = req.params as { id: string };

    // Check what kind of number it is
    const phoneRow = await pool.query(
      `SELECT id, number, method, provider_id FROM phone_numbers WHERE id = $1 AND org_id = $2`,
      [id, orgId],
    );
    if (!phoneRow.rowCount) return reply.status(404).send({ error: 'Nummer nicht gefunden' });

    const phone = phoneRow.rows[0];

    if (phone.method === 'provisioned') {
      // Provisioned Twilio numbers → return to pool (don't delete, don't release from Twilio)
      // Unassign agent in Retell so it's clean for next customer
      const key = process.env.RETELL_API_KEY;
      if (key && phone.provider_id) {
        try {
          await fetch(`https://api.retellai.com/update-phone-number/${encodeURIComponent(phone.number)}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ inbound_agent_id: null }),
          });
        } catch { /* non-fatal */ }
      }
      // Return to pool: set org_id and agent_id to NULL
      await pool.query(
        `UPDATE phone_numbers SET org_id = NULL, agent_id = NULL WHERE id = $1`,
        [id],
      );
    } else {
      // Forwarding numbers → fully delete (no Twilio cost)
      await pool.query(
        `DELETE FROM phone_numbers WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );
    }

    return { ok: true };
  });

  // POST /phone/reassign — change which agent a number is connected to
  app.post('/phone/reassign', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const parsed = z.object({
      phoneId: z.string().uuid(),
      agentTenantId: z.string().min(1),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'phoneId and agentTenantId required' });

    // Get the phone number
    const phoneRow = await pool.query(
      `SELECT number FROM phone_numbers WHERE id = $1 AND org_id = $2`,
      [parsed.data.phoneId, orgId],
    );
    if (!phoneRow.rowCount) return reply.status(404).send({ error: 'Nummer nicht gefunden' });
    const phoneNumber = phoneRow.rows[0].number;

    // Get the new agent's retell ID. CRITICAL: scope by org_id so a user cannot
    // reassign their own phone to a foreign org's agent (same hijack pattern as
    // /phone/provision).
    const agentRow = await pool.query(
      `SELECT data FROM agent_configs WHERE tenant_id = $1 AND org_id = $2 LIMIT 1`,
      [parsed.data.agentTenantId, orgId],
    );
    if (!agentRow.rowCount) {
      return reply.status(403).send({ error: 'Dieser Agent gehört nicht zu deiner Organisation.' });
    }
    const newRetellAgentId = agentRow.rows[0]?.data?.retellAgentId;
    if (!newRetellAgentId) return reply.status(400).send({ error: 'Agent hat keine Retell-ID. Bitte erst deployen.' });

    // Update in Retell
    const key = process.env.RETELL_API_KEY;
    if (key) {
      try {
        await fetch(`https://api.retellai.com/update-phone-number/${encodeURIComponent(phoneNumber)}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ inbound_agent_id: newRetellAgentId }),
        });
      } catch (e: unknown) {
        return reply.status(500).send({ error: `Retell-Update fehlgeschlagen: ${e instanceof Error ? e.message : 'Unbekannt'}` });
      }
    }

    // Update in DB
    await pool.query(
      `UPDATE phone_numbers SET agent_id = $1 WHERE id = $2`,
      [newRetellAgentId, parsed.data.phoneId],
    );

    return { ok: true };
  });

  // POST /phone/verify-forwarding — REAL loop test for call forwarding.
  //
  // Flow:
  //   1. Generate a verification token, store pending state in Redis keyed
  //      by the Phonbot inbound number.
  //   2. Dial the customer-number from VERIFIER_TWILIO_NUMBER (a Twilio number
  //      that is NOT imported into Retell — otherwise the verifier outbound
  //      would short-circuit through Retell instead of going through PSTN).
  //      The TwiML hangs up immediately so no theatre TTS is played to whoever
  //      picks up.
  //   3. If the customer's carrier has CFU/CFNR set up to our Phonbot inbound,
  //      the forwarded call arrives at the inbound and Retell fires
  //      call_started. The hook in retell-webhooks.ts compares the inbound's
  //      caller-ID against the pending verifier/customer number and writes
  //      a result key to Redis (see checkForwardingVerificationMatch above).
  //   4. We poll the result key for up to 35s (covers CFU ~5s + CFNR ~25s).
  //   5. On match → mark verified=true and persist customer_number +
  //      forwarding_type. On timeout → verified stays false and customer is
  //      told to test manually.
  //
  // Rate-limited + DACH-prefix-whitelisted: without these, an authenticated
  // user could POST premium-rate numbers and trigger Twilio to dial them
  // (toll-fraud / IRSF).
  app.post('/phone/verify-forwarding', {
    ...auth,
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const verifierNumber = process.env.VERIFIER_TWILIO_NUMBER
      ? normalizeE164(process.env.VERIFIER_TWILIO_NUMBER)
      : null;
    if (!verifierNumber) {
      // Honest 503: no fake verified=true fallback. Frontend should fall back
      // to the manual test instructions.
      return reply.status(503).send({
        error: 'Verifikations-Trunk nicht konfiguriert. Bitte VERIFIER_TWILIO_NUMBER in der Server-Konfiguration setzen oder die Weiterleitung manuell testen (z.B. von einem fremden Telefon aus die eigene Nummer anrufen — wenn Chipy rangeht, läuft die Weiterleitung).',
        configurationMissing: true,
      });
    }

    const parsed = z.object({
      customerNumber: z.string().min(1),
      phonbotNumberId: z.string().uuid(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'customerNumber and phonbotNumberId required' });

    const customerNumber = normalizeE164(parsed.data.customerNumber);
    if (!isPhonePrefixAllowed(customerNumber)) {
      return reply.status(400).send({ error: 'Aktuell nur Telefonnummern aus DACH (DE/AT/CH) unterstützt.' });
    }

    // Defense-in-depth: the verifier MUST be a number that is NOT one of our
    // provisioned Phonbot inbounds. Otherwise Retell intercepts the verifier
    // outbound's destination side, and the loop never closes via PSTN.
    const verifierConflict = await pool.query(
      `SELECT 1 FROM phone_numbers WHERE number = $1 AND method = 'provisioned' LIMIT 1`,
      [verifierNumber],
    );
    if (verifierConflict.rowCount && verifierConflict.rowCount > 0) {
      req.log.error(
        { verifierNumber },
        '[verify-forwarding] VERIFIER_TWILIO_NUMBER collides with a provisioned Phonbot inbound — loop test would short-circuit',
      );
      return reply.status(503).send({
        error: 'Server-Konfigurationsfehler: Verifikations-Nummer überschneidet sich mit einer Phonbot-Eingangsnummer. Bitte Support kontaktieren.',
      });
    }

    const phonbotNum = await pool.query(
      `SELECT number FROM phone_numbers WHERE id = $1 AND org_id = $2`,
      [parsed.data.phonbotNumberId, orgId],
    );
    if (!phonbotNum.rowCount) return reply.status(404).send({ error: 'Phonbot-Nummer nicht gefunden' });
    const phonbotNumber = phonbotNum.rows[0].number;

    if (!redis?.isOpen) {
      // Loop test depends on Redis to coordinate the inbound webhook hit with
      // this poller. No silent fake-verify fallback.
      return reply.status(503).send({
        error: 'Verifikation aktuell nicht verfügbar (Redis nicht erreichbar). Bitte später erneut testen.',
      });
    }

    const token = crypto.randomUUID();
    const pending: PendingForwardingVerification = {
      token,
      orgId,
      phonbotNumberId: parsed.data.phonbotNumberId,
      phonbotNumber: normalizeE164(phonbotNumber),
      customerNumber,
      verifierNumber,
      startedAt: Date.now(),
    };
    const stored = await setPendingForwardingVerification(pending);
    if (!stored) {
      return reply.status(503).send({ error: 'Verifikation konnte nicht initialisiert werden.' });
    }

    let twilioCallSid: string | null = null;
    try {
      const client = getTwilioClient();
      // <Hangup/> only — verifier call's purpose is solely to trigger the
      // customer's carrier to forward. Whoever picks up shouldn't hear a
      // misleading "Test successful" message.
      const call = await client.calls.create({
        to: customerNumber,
        from: verifierNumber,
        twiml: '<Response><Hangup/></Response>',
        timeout: 30,
      });
      twilioCallSid = call.sid;
    } catch (e: unknown) {
      await clearPendingForwardingVerification(pending.phonbotNumber);
      return reply.status(500).send({
        error: e instanceof Error ? e.message : 'Twilio-Anruf fehlgeschlagen',
        verified: false,
      });
    }

    // Poll for the inbound webhook hit. CFNR carriers may take up to ~25s
    // before forwarding kicks in — 35s gives margin. Short polling interval
    // keeps the response snappy when CFU answers within a few seconds.
    const POLL_INTERVAL_MS = 1500;
    const MAX_WAIT_MS = 35_000;
    const deadline = Date.now() + MAX_WAIT_MS;
    let result: ForwardingVerificationResult | null = null;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      result = await getForwardingVerificationResult(token);
      if (result?.ok) break;
    }

    // Best-effort cleanup of the verifier outbound. Whether it was forwarded
    // or just kept ringing the customer, we don't want it to keep going.
    if (twilioCallSid) {
      try {
        const client = getTwilioClient();
        await client.calls(twilioCallSid).update({ status: 'completed' });
      } catch { /* call may already be ended; ignore */ }
    }

    if (result?.ok) {
      await pool.query(
        `UPDATE phone_numbers
         SET customer_number = $1, forwarding_type = $2, verified = true
         WHERE id = $3 AND org_id = $4`,
        [customerNumber, result.forwardingType, parsed.data.phonbotNumberId, orgId],
      );
      return {
        ok: true,
        verified: true,
        confidence: result.confidence,
        forwardingType: result.forwardingType,
        callSid: twilioCallSid,
      };
    }

    await clearPendingForwardingVerification(pending.phonbotNumber);
    return {
      ok: true,
      verified: false,
      callSid: twilioCallSid,
      hint: 'Wir haben innerhalb von 30 Sekunden keinen weitergeleiteten Anruf empfangen. Prüfe die Carrier-Codes auf deinem Handy oder teste manuell von einem anderen Telefon aus.',
    };
  });

  // POST /phone/verify — mark a number as verified.
  //
  // Two cases:
  //   • method = 'provisioned' / 'twilio'  → the number is owned by Phonbot,
  //     bought via Twilio + imported into Retell during provisioning. There is
  //     nothing further to verify; we just flip the flag.
  //   • method = 'forwarding'              → real verification can ONLY happen
  //     via the loop test in /phone/verify-forwarding. We refuse to mark
  //     verified=true here because previously this endpoint was setting
  //     verified=true purely on a Twilio call-create 2xx, which had zero
  //     correlation with whether the customer's carrier actually forwarded.
  app.post('/phone/verify', {
    ...auth,
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const verifyParsed = z.object({ phoneId: z.string().uuid() }).safeParse(req.body);
    if (!verifyParsed.success) return reply.status(400).send({ error: 'phoneId required (UUID)' });
    const { phoneId } = verifyParsed.data;

    const phoneRow = await pool.query(
      `SELECT method FROM phone_numbers WHERE id = $1 AND org_id = $2`,
      [phoneId, orgId],
    );
    if (!phoneRow.rowCount) return reply.status(404).send({ error: 'Phone number not found' });
    const { method } = phoneRow.rows[0];

    if (method === 'forwarding') {
      return reply.status(409).send({
        error: 'Eine Rufweiterleitung lässt sich nur über den Loop-Test bestätigen. Bitte den "Erreichbarkeits-Test" im Telefon-Manager nutzen.',
        useEndpoint: '/phone/verify-forwarding',
        verified: false,
      });
    }

    // Provisioned/imported numbers — Phonbot owns them, Twilio + Retell already
    // confirmed their existence at provisioning time. Just flip the flag.
    await pool.query(`UPDATE phone_numbers SET verified = true WHERE id = $1`, [phoneId]);
    return { ok: true, verified: true };
  });

  // POST /phone/admin/seed-pool — add existing phone numbers to the pool (platform-admin only)
  // Gated on payload.admin (set only by /admin/login) — NOT on role:'owner' since every
  // registered user automatically becomes 'owner' of their own org (previous check was
  // effectively no-op → anyone could seed the shared pool with junk numbers).
  app.post('/phone/admin/seed-pool', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const payload = req.user as Record<string, unknown>;
    if (!payload.admin) return reply.status(403).send({ error: 'Platform-admin only' });
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const parsed = z.object({
      numbers: z.array(z.object({
        number: z.string().min(1),       // E.164 format, e.g. "+493012345678"
        providerId: z.string().optional(), // Retell phone_number_id if already imported
      })).max(50),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'numbers array required' });

    const results: Array<{ number: string; status: string }> = [];

    for (const entry of parsed.data.numbers) {
      // Check if number already exists in DB
      const existing = await pool.query(
        `SELECT id FROM phone_numbers WHERE number = $1`,
        [entry.number],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        results.push({ number: entry.number, status: 'already_exists' });
        continue;
      }

      const pretty = entry.number.replace(/^\+49/, '0').replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3');
      await pool.query(
        `INSERT INTO phone_numbers (org_id, number, number_pretty, provider, provider_id, agent_id, method, verified)
         VALUES (NULL, $1, $2, 'twilio', $3, NULL, 'provisioned', true)`,
        [entry.number, pretty, entry.providerId ?? null],
      );
      results.push({ number: entry.number, status: 'added_to_pool' });
    }

    return { ok: true, results };
  });

  // GET /phone/admin/pool — list all pool numbers (platform-admin only)
  // Leaks every org's phone-number → org_id mapping if gated only by role:'owner',
  // since every user is owner of their own org. Require payload.admin (platform admin).
  app.get('/phone/admin/pool', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const payload = req.user as Record<string, unknown>;
    if (!payload.admin) return reply.status(403).send({ error: 'Platform-admin only' });
    if (!pool) return { items: [] };

    const { rows } = await pool.query(
      `SELECT id, number, number_pretty, provider_id, org_id, agent_id, created_at
       FROM phone_numbers WHERE method = 'provisioned' ORDER BY org_id NULLS FIRST, created_at`,
    );
    return {
      items: rows,
      pool: rows.filter(r => !r.org_id).length,
      assigned: rows.filter(r => r.org_id).length,
    };
  });
}
