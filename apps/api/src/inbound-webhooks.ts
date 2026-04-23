/**
 * Inbound Webhook Fan-Out.
 *
 * Customers configure webhooks under Agent-Builder → Schnittstellen →
 * "Inbound Webhooks". This module reads config.inboundWebhooks and delivers
 * events (call.started / call.ended / ticket.created / variable.extracted)
 * to their endpoints.
 *
 * Design decisions (v1):
 *  - fire-and-forget: never block the calling request (call lifecycle, tool
 *    handlers, etc.). A slow customer endpoint must not slow our response
 *    to Retell.
 *  - per-request timeout: 5 s. A hanging customer URL must not leak sockets.
 *  - no retry: if the POST fails, we log and move on. Retry infrastructure
 *    (DLQ + exponential backoff) is v2.
 *  - SSRF guard: block localhost / link-local / private ranges so a
 *    misconfigured URL can't probe internal services from our prod box.
 *  - no PII signing: customers get a plain JSON POST with
 *    X-Phonbot-Event + X-Phonbot-Tenant headers. Payload does not include
 *    full transcripts by default — too sensitive. Duration + call_id +
 *    from/to numbers + ticket id are fine.
 */

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { log } from './logger.js';
import { readConfig } from './agent-config.js';

/** Supported event names (must match the UI's EVENT_OPTIONS in WebhooksTab.tsx). */
export type InboundWebhookEvent =
  | 'call.started'
  | 'call.ended'
  | 'ticket.created'
  | 'variable.extracted';

type InboundWebhookConfig = {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
};

const TIMEOUT_MS = 5_000;
const MAX_URL_LEN = 2000;
/** Hard cap per org per event to bound outbound socket usage per call. */
const MAX_WEBHOOKS_PER_FIRE = 10;

/** Block private / link-local / loopback IP ranges — and IPv6-mapped IPv4.
 *  Input must be a hostname or a bare IP (no port). */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '127.0.0.1' || h.startsWith('127.')) return true;
  if (h === '0.0.0.0') return true;
  if (h === '::1') return true;

  // IPv4 private ranges
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;

  // Link-local
  if (/^169\.254\./.test(h)) return true;

  // IPv6 unique local / link-local
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  if (/^fe80:/.test(h)) return true;

  // IPv6-mapped IPv4 (e.g. ::ffff:10.0.0.1 or ::ffff:a00:1). Extract the
  // trailing IPv4 or the final 32-bit hextets and re-check.
  if (/^::ffff:/.test(h)) {
    const tail = h.replace(/^::ffff:/, '');
    if (isPrivateHost(tail)) return true;
    // hex form (::ffff:a00:1 → 10.0.0.1)
    const parts = tail.split(':');
    if (parts.length === 2) {
      const hi = parseInt(parts[0] ?? '', 16);
      const lo = parseInt(parts[1] ?? '', 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        if (isPrivateHost(ipv4)) return true;
      }
    }
  }

  return false;
}

/** Resolve hostname and block if it maps to a private address.
 *  Closes the DNS-rebinding window on the parse-time `isPrivateHost` check
 *  (customer registers a public host, flips DNS to 169.254.169.254 between
 *  registration and fire). Not a full fix — undici still re-resolves at
 *  connect time, but the window shrinks from ∞ to a single pre-flight. */
async function isPrivateResolved(hostname: string): Promise<boolean> {
  if (isPrivateHost(hostname)) return true;
  try {
    const addrs = await dns.lookup(hostname, { all: true, verbatim: true });
    return addrs.some((a) => isPrivateHost(a.address));
  } catch {
    // Unresolvable host → refuse delivery (prevents accidental SSRF via
    // unreachable-but-spoofable internal DNS shadows).
    return true;
  }
}

function isAcceptableUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  if (!raw || raw.length > MAX_URL_LEN) return { ok: false, reason: 'empty_or_too_long' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'bad_protocol' };
  }
  // Disallow http:// in prod — customers should use https for webhooks.
  if (url.protocol === 'http:' && process.env.NODE_ENV === 'production') {
    return { ok: false, reason: 'http_in_prod' };
  }
  if (isPrivateHost(url.hostname)) return { ok: false, reason: 'private_host' };
  return { ok: true, url };
}

type WebhookEventPayload = Record<string, unknown>;

/**
 * Fire an event to all configured inbound webhooks that subscribe to it.
 *
 * NEVER awaited by callers on the hot path — always use:
 *   fireInboundWebhooks(...).catch(() => {}); // ignore — already logged
 *
 * @param tenantId  The agent config tenant (= org id in current design).
 * @param event     Event name (must be one of InboundWebhookEvent).
 * @param data      Event-specific payload. Shape documented per event below.
 */
export async function fireInboundWebhooks(
  tenantId: string,
  event: InboundWebhookEvent,
  data: WebhookEventPayload,
): Promise<void> {
  let hooks: InboundWebhookConfig[] = [];
  try {
    const config = await readConfig(tenantId);
    hooks = (config as unknown as { inboundWebhooks?: InboundWebhookConfig[] }).inboundWebhooks ?? [];
  } catch (err) {
    log.warn({ err: (err as Error).message, tenantId }, 'inbound-webhooks: readConfig failed');
    return;
  }

  const allMatches = hooks.filter((h) => h.enabled && Array.isArray(h.events) && h.events.includes(event));
  const matches = allMatches.slice(0, MAX_WEBHOOKS_PER_FIRE);
  if (allMatches.length > matches.length) {
    log.warn(
      { tenantId, event, total: allMatches.length, cap: MAX_WEBHOOKS_PER_FIRE },
      'inbound-webhooks: per-fire cap exceeded, excess skipped',
    );
  }
  if (matches.length === 0) return;

  const body = JSON.stringify({
    event,
    tenantId,
    timestamp: new Date().toISOString(),
    data,
  });

  // Parallel fan-out; each POST has its own timeout. Failures are logged,
  // never thrown — this function is fire-and-forget by contract.
  await Promise.allSettled(
    matches.map(async (h) => {
      const check = isAcceptableUrl(h.url);
      if (!check.ok) {
        log.warn({ tenantId, webhookId: h.id, reason: check.reason }, 'inbound-webhooks: url rejected');
        return;
      }
      if (await isPrivateResolved(check.url.hostname)) {
        log.warn(
          { tenantId, webhookId: h.id, host: check.url.hostname },
          'inbound-webhooks: hostname resolves to private range, blocked',
        );
        return;
      }
      // Per-webhook signing secret is derived deterministically from a single
      // server secret + (tenantId, webhookId). No DB column needed; customer
      // can reconstruct it on our side to expose in the UI later. If
      // WEBHOOK_SIGNING_SECRET is unset, fall back to JWT_SECRET (already
      // required in prod by env.ts) so there is never an unsigned delivery.
      const signingKey = process.env.WEBHOOK_SIGNING_SECRET || process.env.JWT_SECRET || '';
      const perHookSecret = crypto
        .createHmac('sha256', signingKey)
        .update(`${tenantId}:${h.id}`)
        .digest();
      const signature = crypto.createHmac('sha256', perHookSecret).update(body).digest('hex');
      try {
        const res = await fetch(check.url.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Phonbot-Webhook/1.0',
            'X-Phonbot-Event': event,
            'X-Phonbot-Tenant': tenantId,
            'X-Phonbot-Signature-256': `sha256=${signature}`,
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'manual', // don't follow 3xx — could redirect to internal host
        });
        if (!res.ok) {
          log.info(
            { tenantId, webhookId: h.id, status: res.status, event },
            'inbound-webhooks: delivery non-2xx',
          );
        }
      } catch (err) {
        const msg = (err as Error).message;
        log.info({ tenantId, webhookId: h.id, event, err: msg }, 'inbound-webhooks: delivery failed');
      }
    }),
  );
}

/**
 * Derive the per-webhook signing secret the customer needs to verify
 * `X-Phonbot-Signature-256`. Returns hex string (same HMAC-key the fan-out
 * uses). Intended for a future "copy secret" UI — not used on the hot path.
 */
export function deriveWebhookSecret(tenantId: string, webhookId: string): string {
  const signingKey = process.env.WEBHOOK_SIGNING_SECRET || process.env.JWT_SECRET || '';
  return crypto
    .createHmac('sha256', signingKey)
    .update(`${tenantId}:${webhookId}`)
    .digest('hex');
}
