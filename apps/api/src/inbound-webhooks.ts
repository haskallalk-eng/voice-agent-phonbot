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
import { log } from './logger.js';
import { readConfig } from './agent-config.js';
import { isPrivateHost, isPrivateResolved, isBlockedPort } from './ssrf-guard.js';

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

// Audit-Round-8 (Codex M07-MEDIUM-4): cache the inboundWebhooks-slice per
// tenantId for 60s. Without this, a busy customer with 5 events/sec eats 5
// agent_configs SELECTs/sec just for webhook-routing config that rarely
// changes. Invalidated explicitly from agent-config.ts:writeConfig via
// invalidateInboundWebhooksCache() — and falls back gracefully via TTL if
// some bypass-path skips the invalidation (max 60s drift).
const WEBHOOK_CACHE_TTL_MS = 60_000;
const WEBHOOK_CACHE_MAX_ENTRIES = 1000;
const webhookCache = new Map<string, { hooks: InboundWebhookConfig[]; expires: number }>();

function getCachedHooks(tenantId: string): InboundWebhookConfig[] | null {
  const e = webhookCache.get(tenantId);
  if (!e) return null;
  if (e.expires < Date.now()) {
    webhookCache.delete(tenantId);
    return null;
  }
  return e.hooks;
}

function setCachedHooks(tenantId: string, hooks: InboundWebhookConfig[]): void {
  // Bounded — drop oldest entry on overflow. Map iteration order is insertion-
  // order in V8 so the first key is the oldest.
  if (webhookCache.size >= WEBHOOK_CACHE_MAX_ENTRIES && !webhookCache.has(tenantId)) {
    const firstKey = webhookCache.keys().next().value;
    if (firstKey !== undefined) webhookCache.delete(firstKey);
  }
  webhookCache.set(tenantId, { hooks, expires: Date.now() + WEBHOOK_CACHE_TTL_MS });
}

/** Called by agent-config.ts:writeConfig after a successful save. */
export function invalidateInboundWebhooksCache(tenantId: string): void {
  webhookCache.delete(tenantId);
}

// isPrivateHost + isPrivateResolved moved to ssrf-guard.ts — single source
// of truth shared with api-integrations.ts. Prior to this, each module
// had its own copy and they drifted (api-integrations lost the ::ffff:-hex
// form check). The shared module also adds cloud-metadata blocks,
// numeric-IPv4 edge cases (0, decimal, hex, octal), and the blocked-port list.

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
  if (isBlockedPort(url.port)) return { ok: false, reason: 'blocked_port' };
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
  // Hot-path cache (Audit-Round-8 M07-MEDIUM-4): readConfig per event is
  // expensive — call.started + call.ended + ticket.created + variable.extracted
  // for one busy call already runs 4 SELECTs of a 10-50KB JSONB row. Cached
  // for 60s, invalidated by invalidateInboundWebhooksCache from writeConfig.
  const cached = getCachedHooks(tenantId);
  if (cached !== null) {
    hooks = cached;
  } else {
    try {
      // tenantId is the only context this fan-out has — pass it as both
      // parameters. Functionally equivalent to the previous one-arg call
      // (both filter to the row whose tenant_id matches), but readConfig now
      // requires orgId at the type level so a future caller can't silently
      // skip the multi-tenant filter.
      const config = await readConfig(tenantId, tenantId);
      hooks = (config as unknown as { inboundWebhooks?: InboundWebhookConfig[] }).inboundWebhooks ?? [];
      setCachedHooks(tenantId, hooks);
    } catch (err) {
      log.warn({ err: (err as Error).message, tenantId }, 'inbound-webhooks: readConfig failed');
      return;
    }
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
      //
      // ⚠️ Audit-Round-7 Codex MEDIUM-A: the JWT_SECRET fallback is dangerous
      // long-term — any JWT rotation breaks every customer's webhook-signature
      // validation silently. env.ts now warn-logs at boot when
      // WEBHOOK_SIGNING_SECRET is missing in prod. Move WEBHOOK_SIGNING_SECRET
      // into hard-required REQUIRED_PROD_SECRETS once it's set on all envs.
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
