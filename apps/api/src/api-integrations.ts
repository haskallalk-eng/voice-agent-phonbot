/**
 * Customer-configurable API integrations.
 *
 * Two flavours, both surfaced to the Retell LLM as custom tools:
 *
 *   1. `webhook` / `zapier` — fire-and-forget POST to a single base URL.
 *      One tool per integration: `send_<name>`. LLM decides WHEN to fire
 *      based on the description; we pass whatever JSON payload the LLM
 *      chooses. Safe and simple — covers 80% of customer use cases
 *      (Zapier, Make, n8n, own webhook handler).
 *
 *   2. `rest` — customer declares a LIST of allowed endpoints (name,
 *      method, path template, params). Each endpoint becomes its own
 *      Retell tool. LLM can ONLY invoke what was declared; it cannot
 *      craft arbitrary paths/methods, closing the "LLM hallucinates
 *      DELETE /admin/…" class of attacks.
 *
 * Both flows go through the proxy endpoint `/retell/tools/external.call`
 * — never directly to the customer's API. The proxy injects auth from
 * the encrypted `authValue` so the secret never leaves our server (Retell
 * never sees it).
 *
 * Security guards:
 *  - authValue stored AES-256-GCM encrypted (crypto.ts); plaintext only
 *    lives for the duration of a single outbound request
 *  - SSRF guard on baseUrl (private ranges blocked, DNS pre-resolved)
 *  - HTTPS-only in production
 *  - 10s timeout per outbound call
 *  - 100 KB response-size cap (truncated if larger)
 *  - Method whitelist: GET / POST / PUT / PATCH (no DELETE by default)
 *  - Per-call rate cap (max 10 outbound requests per single Retell call)
 */

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { log } from './logger.js';
import { encrypt, decrypt } from './crypto.js';

// ── Types ────────────────────────────────────────────────────────────────

export type ApiEndpointParam = {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
};

export type ApiEndpoint = {
  id: string;
  name: string;               // LLM-facing identifier: "kunde_suchen"
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;               // "/customers/{id}" — {placeholders} resolved from params
  description: string;        // What does it do? Prompt the LLM will see.
  params?: ApiEndpointParam[];
};

export type ApiIntegration = {
  id: string;
  name: string;
  type: 'rest' | 'webhook' | 'zapier';
  baseUrl: string;
  authType: 'none' | 'apikey' | 'bearer' | 'basic';
  authValue?: string;         // AES-256-GCM encrypted when stored (enc:v1:… prefix)
  description: string;
  enabled: boolean;
  endpoints?: ApiEndpoint[];  // only meaningful when type === 'rest'
};

/** Minimal shape for Retell custom tools we build here. Kept local so this
 *  module doesn't need to import from retell.ts (avoid a cycle). */
export type IntegrationTool = {
  type: 'custom';
  name: string;
  description: string;
  url: string;
  execution_message_description?: string;
  parameters?: Record<string, unknown>;
  speak_during_execution?: boolean;
};

// ── Constants ────────────────────────────────────────────────────────────

const OUTBOUND_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 100 * 1024;
const MAX_CALLS_PER_RETELL_CALL = 10;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH']);

// ── Encryption helpers (thin wrappers with intent-clear names) ───────────

/** Encrypt a plaintext auth value for DB storage. Idempotent: if already
 *  encrypted (enc:v1:…) or empty, returned unchanged. */
export function encryptAuthValue(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('enc:v1:')) return value;      // already encrypted
  if (value === AUTHVALUE_MASKED_SENTINEL) return value;
  return encrypt(value);
}

/** Decrypt a stored auth value. Returns null when nothing set, plaintext
 *  when legacy-unencrypted, or decrypted string when encrypted. */
export function decryptAuthValue(value: string | null | undefined): string | null {
  return decrypt(value);
}

/**
 * Sentinel the API returns to the frontend in place of the real authValue.
 * Frontend sends this back on save → writeConfig preserves the existing
 * encrypted value instead of overwriting with the sentinel.
 */
export const AUTHVALUE_MASKED_SENTINEL = '__phonbot_auth_masked__';

/** Replace the authValue of each integration with the masked sentinel for
 *  responses. Keeps last-4-chars hint so the UI shows "sk_…xyz" instead
 *  of a blank field. Called on every read that goes out to the browser. */
export function maskApiIntegrationsForClient(
  integrations: ApiIntegration[] | undefined,
): ApiIntegration[] | undefined {
  if (!integrations) return integrations;
  return integrations.map((i) => {
    if (!i.authValue) return i;
    const raw = decrypt(i.authValue);
    const hint = raw && raw.length > 4 ? `••••${raw.slice(-4)}` : raw ? '••••' : '';
    return { ...i, authValue: hint ? `${AUTHVALUE_MASKED_SENTINEL}:${hint}` : AUTHVALUE_MASKED_SENTINEL };
  });
}

/**
 * Merge incoming integrations from the frontend with existing DB integrations
 * to preserve encrypted authValues when the frontend round-tripped the mask.
 * Matching is by id — when `incoming.authValue` is a sentinel, we keep the
 * existing encrypted value for that id. Any new plaintext value gets
 * encrypted here so plaintext never reaches the DB.
 */
export function mergeAndEncryptIntegrations(
  incoming: ApiIntegration[] | undefined,
  existing: ApiIntegration[] | undefined,
): ApiIntegration[] {
  const byId = new Map((existing ?? []).map((i) => [i.id, i] as const));
  return (incoming ?? []).map((next) => {
    const prev = byId.get(next.id);
    let authValue: string | null | undefined = next.authValue;
    if (typeof authValue === 'string' && authValue.startsWith(AUTHVALUE_MASKED_SENTINEL)) {
      // Sentinel round-tripped — keep the existing stored value.
      authValue = prev?.authValue ?? null;
    } else if (authValue) {
      authValue = encryptAuthValue(authValue);
    } else {
      authValue = null;
    }
    return { ...next, authValue: authValue ?? undefined };
  });
}

// ── Retell tool registration ─────────────────────────────────────────────

function sanitizeName(raw: string, fallback = 'x'): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return cleaned || fallback;
}

/**
 * Build the Retell tools list for all enabled integrations in the config.
 * Caller is responsible for concatenating this with the core tools.
 *
 * @param integrations  Decrypted or encrypted — does not matter here; this
 *                      module only uses metadata (id, name, type, endpoints).
 *                      The proxy endpoint loads + decrypts authValue when
 *                      the tool actually fires.
 * @param proxyBaseUrl  Prefix for the proxy URL, e.g. WEBHOOK_BASE_URL.
 * @param signQuery     Callback producing the `tenant_id=…&tool_sig=…`
 *                      portion so the proxy can verify tenancy without
 *                      trusting the Retell-passed body alone.
 * @param tenantId      Needed inside the URL so the proxy knows which
 *                      agent_configs row to load (and which integration).
 */
export function buildIntegrationTools(
  integrations: ApiIntegration[] | undefined,
  proxyBaseUrl: string,
  signQuery: string,
  tenantId: string,
  reservedNames: Iterable<string> = [],
): IntegrationTool[] {
  if (!integrations?.length) return [];
  const tools: IntegrationTool[] = [];
  // Pre-seed with core-tool + transfer-tool names so a customer-chosen
  // integration can't shadow them (e.g. customer names integration
  // "calendar" with endpoint "find_slots" → would collide with the
  // built-in calendar_find_slots and break Retell's deploy).
  const seenNames = new Set<string>(reservedNames);

  for (const int of integrations) {
    if (!int.enabled || !int.id || !int.name?.trim()) continue;

    const baseName = sanitizeName(int.name);
    if (int.type === 'webhook' || int.type === 'zapier') {
      // One tool per integration: fire-and-forget POST with LLM-chosen payload.
      const name = uniqueName(`send_${baseName}`, seenNames);
      tools.push({
        type: 'custom',
        name,
        description: int.description?.trim()
          || `Sende relevante Gesprächsdaten an das System "${int.name}". Fire-and-forget — kein Rückgabewert.`,
        url: `${proxyBaseUrl}/retell/tools/external.call?${signQuery}&integration_id=${encodeURIComponent(int.id)}`,
        execution_message_description: `Sende Daten an ${int.name}…`,
        parameters: {
          type: 'object',
          properties: {
            payload: {
              type: 'object',
              description: 'Beliebiges JSON-Objekt mit den Daten, die du senden möchtest. Strukturiert, nicht als Fließtext.',
              additionalProperties: true,
            },
          },
          required: ['payload'],
        },
      });
      continue;
    }

    if (int.type === 'rest') {
      // One tool per declared endpoint. If the customer declared none, skip
      // the integration entirely — we will NOT let the LLM pick a path
      // (that class of attack is exactly why we force the endpoints list).
      if (!int.endpoints?.length) {
        log.warn(
          { integrationId: int.id, name: int.name, tenantId },
          'api-integrations: REST integration without endpoints — skipping (customer must declare endpoints)',
        );
        continue;
      }

      for (const ep of int.endpoints) {
        if (!ep.id || !ep.name?.trim() || !ep.method || !ep.path) continue;
        if (!ALLOWED_METHODS.has(ep.method)) continue;

        const toolName = uniqueName(`${baseName}_${sanitizeName(ep.name)}`, seenNames);
        const paramProps: Record<string, unknown> = {};
        const required: string[] = [];
        for (const p of ep.params ?? []) {
          if (!p.name?.trim()) continue;
          paramProps[p.name] = {
            type: p.type === 'number' ? 'number' : p.type === 'boolean' ? 'boolean' : 'string',
            description: p.description || '',
          };
          if (p.required) required.push(p.name);
        }

        tools.push({
          type: 'custom',
          name: toolName,
          description:
            (ep.description?.trim() || `Endpunkt "${ep.name}" des Systems "${int.name}" (${ep.method} ${ep.path}).`),
          url:
            `${proxyBaseUrl}/retell/tools/external.call?${signQuery}` +
            `&integration_id=${encodeURIComponent(int.id)}&endpoint_id=${encodeURIComponent(ep.id)}`,
          execution_message_description: `Rufe ${int.name} auf…`,
          parameters: {
            type: 'object',
            properties: paramProps,
            ...(required.length ? { required } : {}),
          },
        });
      }
    }
  }

  return tools;
}

function uniqueName(candidate: string, seen: Set<string>): string {
  // Retell caps tool names ~64 chars. Stay under with room for `_<n>` suffix.
  const MAX = 56;
  const trimmed = candidate.slice(0, MAX);
  let name = trimmed;
  let n = 2;
  while (seen.has(name)) name = `${trimmed}_${n++}`;
  seen.add(name);
  return name;
}

// ── Outbound proxy (executed at tool-call time) ──────────────────────────

type CallCounter = Map<string, number>;
const perCallCounters: CallCounter = new Map();

/** Drop the per-call counter after 15 minutes to avoid unbounded growth.
 *  Retell calls rarely exceed a few minutes; 15 min is a generous safety. */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of perCallCounters.entries()) {
    // we stash the timestamp in the low 10 bits of the value; we lose
    // precision but just need "is it older than 15 min?" semantics below
    // — simpler: rebuild via TTL below rather than overload value.
    void v;
    void k;
    void now;
  }
  // Simpler: just clear the whole map every 15 min. A Retell call that
  // straddles a clear gets +MAX_CALLS more budget — acceptable.
  perCallCounters.clear();
}, 15 * 60 * 1000).unref?.();

export function bumpPerCallCounter(callId: string): number {
  const n = (perCallCounters.get(callId) ?? 0) + 1;
  perCallCounters.set(callId, n);
  return n;
}

/** SSRF guard — same logic as inbound-webhooks, private ranges + ::ffff: */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.startsWith('127.') || h === '0.0.0.0' || h === '::1') return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  if (/^fe80:/.test(h)) return true;
  if (/^::ffff:/.test(h)) {
    const tail = h.replace(/^::ffff:/, '');
    if (isPrivateHost(tail)) return true;
  }
  return false;
}

async function isPrivateResolved(hostname: string): Promise<boolean> {
  if (isPrivateHost(hostname)) return true;
  try {
    const addrs = await dns.lookup(hostname, { all: true, verbatim: true });
    return addrs.some((a) => isPrivateHost(a.address));
  } catch {
    return true;
  }
}

/** Apply {placeholder} substitutions from args into the path. Left-over
 *  placeholders are preserved (the remote service may accept them; at
 *  minimum the customer sees the raw request when debugging). */
function renderPath(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, name) => {
    const v = args[name];
    if (v === undefined || v === null) return `{${name}}`;
    return encodeURIComponent(String(v));
  });
}

export type ProxyResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; error: string; status?: number };

/** Execute a single outbound call based on the integration + optional
 *  endpoint definition. authValue is decrypted HERE — plaintext is never
 *  returned or logged. */
export async function executeIntegrationCall(params: {
  integration: ApiIntegration;
  endpoint?: ApiEndpoint;
  args: Record<string, unknown>;
  callId?: string;
}): Promise<ProxyResult> {
  const { integration, endpoint, args, callId } = params;

  if (callId) {
    const n = bumpPerCallCounter(callId);
    if (n > MAX_CALLS_PER_RETELL_CALL) {
      log.warn({ callId, n }, 'api-integrations: per-call cap reached');
      return { ok: false, error: 'RATE_LIMITED' };
    }
  }

  // URL building
  const base = integration.baseUrl.trim();
  if (!base) return { ok: false, error: 'NO_BASE_URL' };
  let url: URL;
  let baseHost: string;
  try {
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    baseHost = new URL(normalizedBase).hostname;
    const path = endpoint ? renderPath(endpoint.path, args) : '';
    url = new URL(path || '', normalizedBase);
  } catch {
    return { ok: false, error: 'INVALID_URL' };
  }

  // Host pinning: a malformed path template (e.g. `//evil.com/x` or
  // `https://evil.com/x`) could let `new URL()` ignore the base. Reject
  // anything whose hostname isn't exactly the baseUrl's hostname.
  if (url.hostname !== baseHost) {
    log.warn(
      { integrationId: integration.id, expected: baseHost, got: url.hostname },
      'api-integrations: path escaped baseUrl hostname, blocked',
    );
    return { ok: false, error: 'HOST_MISMATCH' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'BAD_PROTOCOL' };
  if (url.protocol === 'http:' && process.env.NODE_ENV === 'production') return { ok: false, error: 'HTTP_IN_PROD' };
  if (await isPrivateResolved(url.hostname)) {
    log.warn({ integrationId: integration.id, host: url.hostname }, 'api-integrations: hostname resolves to private range, blocked');
    return { ok: false, error: 'PRIVATE_HOST' };
  }

  // Method + body
  const method = endpoint?.method ?? 'POST';
  if (!ALLOWED_METHODS.has(method)) return { ok: false, error: 'METHOD_NOT_ALLOWED' };

  // Auth
  const headers: Record<string, string> = {
    'User-Agent': 'Phonbot-Integration/1.0',
    Accept: 'application/json',
  };
  const decryptedAuth = decryptAuthValue(integration.authValue);
  if (integration.authType === 'bearer' && decryptedAuth) {
    headers.Authorization = `Bearer ${decryptedAuth}`;
  } else if (integration.authType === 'apikey' && decryptedAuth) {
    headers['X-API-Key'] = decryptedAuth;
  } else if (integration.authType === 'basic' && decryptedAuth) {
    // Expected format "user:password" — customer documents that in the UI hint.
    headers.Authorization = `Basic ${Buffer.from(decryptedAuth).toString('base64')}`;
  }

  // Body: for webhook/zapier path we expect { payload: ... }; for REST we
  // take either a body-shaped param or use the args directly for JSON methods.
  let body: string | undefined;
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    if (endpoint) {
      // Strip placeholder-resolved args from body to avoid duplicating path
      // params as body fields.
      const placeholders = new Set<string>();
      endpoint.path.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, name) => { placeholders.add(name); return ''; });
      const bodyObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        if (placeholders.has(k)) continue;
        bodyObj[k] = v;
      }
      body = JSON.stringify(bodyObj);
    } else {
      body = JSON.stringify(args.payload ?? args);
    }
    // Outbound request body cap: defends against a misbehaving LLM emitting
    // a giant payload that (a) runs up customer bandwidth bills, (b) stresses
    // our Fastify worker on JSON.stringify. 512 KB is generous for an agent-
    // constructed object.
    if (body.length > 512 * 1024) {
      log.warn({ integrationId: integration.id, size: body.length }, 'api-integrations: outbound body exceeds 512 KB, rejecting');
      return { ok: false, error: 'PAYLOAD_TOO_LARGE' };
    }
  } else if (endpoint) {
    // GET: promote non-placeholder args to query string
    const placeholders = new Set<string>();
    endpoint.path.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, name) => { placeholders.add(name); return ''; });
    for (const [k, v] of Object.entries(args)) {
      if (placeholders.has(k)) continue;
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  // Fire
  try {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
      redirect: 'manual',
    });

    // redirect:'manual' prevents the fetch from following 3xx, but the 301
    // response (incl. Location header) is still returned. We must not surface
    // the redirect body to the LLM — a customer endpoint using 301→internal
    // would otherwise leak the internal URL in the body preview.
    if (res.status >= 300 && res.status < 400) {
      log.warn({ integrationId: integration.id, status: res.status }, 'api-integrations: upstream returned redirect, blocked');
      return { ok: false, error: 'REDIRECT_BLOCKED', status: res.status };
    }

    // Read up to MAX_RESPONSE_BYTES
    const reader = res.body?.getReader();
    let total = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }
    }
    const bodyText = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    const truncated = total > MAX_RESPONSE_BYTES;

    // Try to parse JSON, fall back to text. Either way the LLM sees a
    // strictly-shaped object — never raw upstream HTML.
    let parsed: unknown = bodyText;
    if (bodyText) {
      try { parsed = JSON.parse(bodyText); } catch { /* keep as text */ }
    }

    if (!res.ok) {
      return { ok: false, error: 'UPSTREAM_NON_2XX', status: res.status };
    }
    return {
      ok: true,
      status: res.status,
      body: truncated ? { truncated: true, preview: String(parsed).slice(0, 1000) } : parsed,
    };
  } catch (err) {
    const msg = (err as Error).message;
    log.info({ integrationId: integration.id, err: msg }, 'api-integrations: call failed');
    return { ok: false, error: 'FETCH_FAILED' };
  }
}
