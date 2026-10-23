import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';

const RETELL_API_KEY = process.env.RETELL_API_KEY ?? '';

/** Internal shape of the extended request with rawBody attached by the content-type parser. */
export type RawBodyRequest = FastifyRequest & { rawBody?: Buffer | string };

/**
 * Verify the Retell webhook signature.
 * Current Retell signatures are `v=<unix-ms>,d=<64 hex chars>` over raw body
 * plus timestamp. The inclusive five-minute clock window limits their age.
 * Legacy body-only HMAC remains compatible, but has no timestamp/replay limit;
 * lifecycle handlers must independently deduplicate side effects.
 * Unsigned requests require a missing key AND explicit non-production opt-in.
 */
export function verifyRetellSignature(req: RawBodyRequest): boolean {
  // Always require signature — no NODE_ENV bypass. Misconfigured env would otherwise
  // let attackers forge call_ended webhooks (manipulate minutes_used, inject transcripts, etc.).
  if (!RETELL_API_KEY) {
    // Dev-only escape: require explicit opt-in via ALLOW_UNSIGNED_WEBHOOKS=true
    if (process.env.ALLOW_UNSIGNED_WEBHOOKS === 'true' && process.env.NODE_ENV !== 'production') return true;
    return false;
  }

  const signature = req.headers['x-retell-signature'];
  if (typeof signature !== 'string') return false;

  // rawBody MUST be set by the addContentTypeParser in index.ts for application/json.
  // If it's missing, the request came over a content-type we can't reliably re-serialize
  // (form-urlencoded, multipart) — falling back to JSON.stringify(req.body) would
  // produce a different byte sequence than what Retell signed → every signature would
  // fail anyway, plus we'd lose the audit trail. Refuse outright.
  let rawBody: string;
  if (typeof req.rawBody === 'string') {
    rawBody = req.rawBody;
  } else if (Buffer.isBuffer(req.rawBody)) {
    rawBody = req.rawBody.toString();
  } else {
    return false;
  }

  const signed = signature.match(/^v=(\d+),d=([0-9a-f]{64})$/i);
  if (signed) {
    const timestampRaw = signed[1];
    const digest = signed[2];
    if (!timestampRaw || !digest) return false;
    const timestamp = Number(timestampRaw);
    if (!Number.isSafeInteger(timestamp)) return false;
    if (Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) return false;

    const expected = crypto
      .createHmac('sha256', RETELL_API_KEY)
      .update(rawBody + timestampRaw)
      .digest('hex');
    return timingSafeHexEqual(digest, expected);
  }

  // Legacy fallback kept for older Retell deliveries/tests that carried only
  // HMAC(rawBody) as hex. Current Retell sends v=<timestamp>,d=<digest>.
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', RETELL_API_KEY).update(rawBody).digest('hex');
  return timingSafeHexEqual(signature, expected);
}

function timingSafeHexEqual(a: string, b: string): boolean {
  // Buffer.from(hex) silently drops a final nibble. Reject noncanonical SHA256
  // lengths before decoding so a 65-character digest cannot pass as 32 bytes.
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
