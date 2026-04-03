import twilio from 'twilio';
import { pool } from './db.js';
import { sendPhoneNumberActiveEmail } from './email.js';

const MASTER_SID = process.env.TWILIO_ACCOUNT_SID!;
const MASTER_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

function getMasterClient() {
  if (!MASTER_SID || !MASTER_TOKEN) throw new Error('Twilio credentials not configured');
  return twilio(MASTER_SID, MASTER_TOKEN);
}

/**
 * Create a Twilio subaccount for a customer org.
 * Returns the subaccount SID.
 */
export async function createSubaccount(orgId: string, orgName: string): Promise<string> {
  if (!pool) throw new Error('Database not configured');

  // Check if already exists
  const existing = await pool.query('SELECT twilio_subaccount_sid FROM orgs WHERE id = $1', [orgId]);
  const existingSid = existing.rows[0]?.twilio_subaccount_sid;
  if (existingSid) return existingSid;

  const client = getMasterClient();
  const sub = await client.api.accounts.create({ friendlyName: `Phonbot: ${orgName} (${orgId})` });

  await pool.query('UPDATE orgs SET twilio_subaccount_sid = $1 WHERE id = $2', [sub.sid, orgId]);
  return sub.sid;
}

/**
 * Submit business address + document for regulatory compliance.
 * Creates: End-User, Address, Supporting Document, Regulatory Bundle.
 * Returns the bundle SID.
 */
export async function submitRegulatoryBundle(orgId: string, data: {
  customerName: string;
  street: string;
  city: string;
  postalCode: string;
  documentUrl: string;
  website: string;
  email: string;
  representativeName: string;
}): Promise<string> {
  if (!pool) throw new Error('Database not configured');

  const orgRow = await pool.query('SELECT twilio_subaccount_sid, name FROM orgs WHERE id = $1', [orgId]);
  const org = orgRow.rows[0];
  if (!org) throw new Error('Org not found');

  // Ensure subaccount exists
  let subSid = org.twilio_subaccount_sid;
  if (!subSid) {
    subSid = await createSubaccount(orgId, org.name);
  }

  const client = getMasterClient();

  // 1. Create End-User
  const endUser = await client.numbers.v2.regulatoryCompliance.endUsers.create({
    friendlyName: data.customerName,
    type: 'business',
    attributes: {
      business_name: data.customerName,
      business_registration_number: 'pending',
    },
  });

  // 2. Create Address
  const address = await client.addresses.create({
    friendlyName: `${data.customerName} — ${data.city}`,
    customerName: data.customerName,
    street: data.street,
    city: data.city,
    region: data.city,
    postalCode: data.postalCode,
    isoCountry: 'DE',
  });

  // 3. Create Regulatory Bundle
  const bundle = await client.numbers.v2.regulatoryCompliance.bundles.create({
    friendlyName: `${data.customerName} — ${data.city} Local`,
    email: data.email,
    regulationSid: 'RNfd11dde5d4b7252abf96139766f68034', // Germany Local Business regulation
    isoCountry: 'DE',
    numberType: 'local',
    endUserType: 'business',
  });

  // 4. Assign End-User to Bundle
  await client.numbers.v2.regulatoryCompliance
    .bundles(bundle.sid)
    .itemAssignments.create({ objectSid: endUser.sid });

  // 5. Assign Address to Bundle
  await client.numbers.v2.regulatoryCompliance
    .bundles(bundle.sid)
    .itemAssignments.create({ objectSid: address.sid });

  // 6. If document URL exists, create Supporting Document
  // Note: For now we skip actual document upload to Twilio —
  // the document is stored in our system. Full Twilio document
  // upload requires multipart form data which we'll add later.

  // 7. Submit bundle for review
  await client.numbers.v2.regulatoryCompliance
    .bundles(bundle.sid)
    .update({ status: 'pending-review' });

  // 8. Save to DB
  await pool.query(`
    UPDATE orgs SET
      twilio_address_sid = $1,
      twilio_bundle_sid = $2,
      twilio_bundle_status = 'pending-review',
      business_street = $3,
      business_city = $4,
      business_postal_code = $5,
      business_document_url = $6,
      business_website = $7
    WHERE id = $8
  `, [address.sid, bundle.sid, data.street, data.city, data.postalCode, data.documentUrl, data.website, orgId]);

  return bundle.sid;
}

/**
 * Check bundle status and update DB.
 * If approved, automatically provision a phone number.
 */
export async function checkBundleStatus(orgId: string): Promise<{
  status: string;
  phoneNumber?: string;
}> {
  if (!pool) throw new Error('Database not configured');

  const orgRow = await pool.query(
    'SELECT twilio_bundle_sid, twilio_bundle_status, twilio_address_sid, business_city FROM orgs WHERE id = $1',
    [orgId],
  );
  const org = orgRow.rows[0];
  if (!org?.twilio_bundle_sid) return { status: 'none' };
  if (org.twilio_bundle_status === 'twilio-approved') {
    // Already approved — check if number exists
    const phoneRow = await pool.query(
      'SELECT number FROM phone_numbers WHERE org_id = $1 LIMIT 1',
      [orgId],
    );
    return {
      status: 'twilio-approved',
      phoneNumber: phoneRow.rows[0]?.number ?? undefined,
    };
  }

  const client = getMasterClient();
  const bundle = await client.numbers.v2.regulatoryCompliance
    .bundles(org.twilio_bundle_sid)
    .fetch();

  // Update status in DB
  await pool.query(
    'UPDATE orgs SET twilio_bundle_status = $1 WHERE id = $2',
    [bundle.status, orgId],
  );

  // If approved, auto-provision a number and send email
  if (bundle.status === 'twilio-approved') {
    try {
      await autoProvisionNumber(orgId, org.twilio_address_sid, org.business_city);
    } catch (e) {
      process.stderr.write(`[twilio] Auto-provision failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}\n`);
    }

    const phoneRow = await pool.query(
      'SELECT number, number_pretty FROM phone_numbers WHERE org_id = $1 LIMIT 1',
      [orgId],
    );
    const newNumber = phoneRow.rows[0];

    // Send email notification to org owner
    if (newNumber) {
      try {
        const orgInfo = await pool.query('SELECT name, business_city FROM orgs WHERE id = $1', [orgId]);
        const userRow = await pool.query("SELECT email FROM users WHERE org_id = $1 AND role = 'owner' LIMIT 1", [orgId]);
        const ownerEmail = userRow.rows[0]?.email;
        if (ownerEmail) {
          await sendPhoneNumberActiveEmail({
            toEmail: ownerEmail,
            orgName: orgInfo.rows[0]?.name ?? 'Phonbot',
            phoneNumber: newNumber.number,
            phoneNumberPretty: newNumber.number_pretty ?? newNumber.number,
            city: orgInfo.rows[0]?.business_city ?? 'Deutschland',
          });
        }
      } catch (e) {
        process.stderr.write(`[twilio] Email failed: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    }

    return {
      status: 'twilio-approved',
      phoneNumber: newNumber?.number ?? undefined,
    };
  }

  return { status: bundle.status };
}

/**
 * Auto-provision a number after bundle approval.
 */
async function autoProvisionNumber(orgId: string, addressSid: string, city: string): Promise<void> {
  if (!pool) return;

  // Don't provision if already has a number
  const existing = await pool.query('SELECT id FROM phone_numbers WHERE org_id = $1 LIMIT 1', [orgId]);
  if (existing.rowCount && existing.rowCount > 0) return;

  const client = getMasterClient();

  // Get agent ID
  const configRes = await pool.query(
    'SELECT data FROM agent_configs WHERE org_id = $1 OR tenant_id = $1::text LIMIT 1',
    [orgId],
  );
  const agentId = configRes.rows[0]?.data?.retellAgentId ?? null;

  // Search numbers in customer's city
  const searchOpts: Record<string, unknown> = { limit: 5 };
  if (city) searchOpts.inLocality = city;
  let available = await client.availablePhoneNumbers('DE').local.list(searchOpts);
  if (!available.length) {
    available = await client.availablePhoneNumbers('DE').local.list({ limit: 5 });
  }
  if (!available.length) throw new Error('No German numbers available');

  // Try each
  let purchased: { phoneNumber: string } | null = null;
  for (const candidate of available) {
    try {
      purchased = await client.incomingPhoneNumbers.create({
        phoneNumber: candidate.phoneNumber,
        addressSid,
      });
      break;
    } catch { continue; }
  }
  if (!purchased) throw new Error('Could not purchase any available number');

  // Import to Retell
  let retellPhoneNumberId: string | null = null;
  if (agentId) {
    try {
      const key = process.env.RETELL_API_KEY;
      if (key) {
        const res = await fetch('https://api.retellai.com/create-phone-number', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone_number: purchased.phoneNumber, inbound_agent_id: agentId }),
        });
        if (res.ok) {
          const data = await res.json() as Record<string, unknown>;
          retellPhoneNumberId = (data.phone_number_id as string) ?? null;
        }
      }
    } catch { /* non-fatal */ }
  }

  // Save
  const pretty = purchased.phoneNumber.replace(/^\+49/, '0').replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3');
  await pool.query(
    `INSERT INTO phone_numbers (org_id, number, number_pretty, provider, provider_id, agent_id, method, verified)
     VALUES ($1, $2, $3, 'twilio', $4, $5, 'provisioned', true)`,
    [orgId, purchased.phoneNumber, pretty, retellPhoneNumberId, agentId],
  );
}
