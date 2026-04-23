/**
 * SSRF guard — single source of truth for "may the server make an HTTP
 * request to this hostname?".
 *
 * Used by:
 *  - inbound-webhooks.ts (customer-configured webhook receiver URLs)
 *  - api-integrations.ts (customer-configured API integration base URLs)
 *
 * Previously each module had its own copy of these functions and the two
 * drifted apart (inbound-webhooks grew a `::ffff:`-hex check that
 * api-integrations never got). Keeping one file means both paths get the
 * same protection and drift is structurally impossible.
 *
 * Two layers:
 *  1. `isPrivateHost(hostname)` — synchronous string check. Blocks
 *     localhost, RFC-1918, link-local, IPv6 ULA + link-local, all
 *     representations of IPv6-mapped IPv4 (colon-dotted AND
 *     colon-hex forms), numeric IPv4 shortcuts (`0`, `0x7f000001`,
 *     octal, decimal integer), and the cloud-metadata magic IPs
 *     (169.254.169.254, fd00:ec2::254).
 *  2. `isPrivateResolved(hostname)` — async wrapper that also DNS-
 *     resolves and re-runs the check on every A/AAAA record. Closes
 *     the DNS-rebinding window at request time (undici re-resolves at
 *     connect, so there is still a narrow TOCTOU gap — fully closing
 *     it requires the whatwg-fetch-via-pinned-IP pattern which we
 *     consider v2).
 */

import dns from 'node:dns/promises';
import net from 'node:net';

/** Known cloud-metadata IPs that MUST never be targeted from outbound calls. */
const METADATA_HOSTS = new Set<string>([
  '169.254.169.254',          // AWS / GCP / Azure IMDS v1/v2 + OpenStack
  'fd00:ec2::254',             // AWS IMDS IPv6
  'metadata.google.internal',  // GCP metadata hostname alias
  'metadata',                  // Kubernetes-style
]);

/**
 * Normalize a hostname for comparison. Strips brackets around IPv6
 * literals, lowercases, trims whitespace.
 */
function normalize(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').trim();
}

/**
 * Parse all numeric IPv4 representations that Node's fetch / DNS layer
 * may end up resolving. Returns the canonical dotted form, or null when
 * the input isn't a plausible IPv4 number.
 *
 * Covers:
 *  - "0"                   → "0.0.0.0"
 *  - "127"                 → "0.0.0.127"    (some OSes accept)
 *  - "2130706433"          → "127.0.0.1"    (integer form)
 *  - "0x7f000001"          → "127.0.0.1"    (hex)
 *  - "0177.0.0.1"          → "127.0.0.1"    (octal)
 *  - "0x7f.0x0.0x0.0x1"    → "127.0.0.1"
 */
function expandNumericIPv4(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  // Already a plain dotted IPv4? net.isIP handles that.
  if (net.isIPv4(s)) return s;

  // Single-integer form (decimal or hex).
  if (/^(0x[0-9a-f]+|[0-9]+)$/i.test(s)) {
    let n: number;
    try {
      n = s.toLowerCase().startsWith('0x') ? parseInt(s, 16) : parseInt(s, 10);
    } catch { return null; }
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
  }

  // Dotted with mixed bases per octet.
  const parts = s.split('.');
  if (parts.length < 2 || parts.length > 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^(0x[0-9a-f]+|[0-9]+)$/i.test(p)) return null;
    let n: number;
    if (p.toLowerCase().startsWith('0x')) n = parseInt(p, 16);
    else if (p.length > 1 && p.startsWith('0')) n = parseInt(p, 8);
    else n = parseInt(p, 10);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    octets.push(n);
  }
  // Collapse short forms (e.g. "10.1" → "10.0.0.1").
  while (octets.length < 4) octets.splice(octets.length - 1, 0, 0);
  if (octets.some((o) => o < 0 || o > 255)) return null;
  return octets.join('.');
}

/**
 * Synchronous check — does this hostname look private/dangerous without
 * even resolving DNS? Called twice: once on the literal hostname from the
 * URL, and once per resolved IP in `isPrivateResolved`.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = normalize(hostname);
  if (!h) return true;

  // Metadata hostnames (both as IP and hostname).
  if (METADATA_HOSTS.has(h)) return true;

  // Localhost / loopback variants.
  if (h === 'localhost' || h.endsWith('.localhost')) return true;

  // Plain literal matches we can short-circuit.
  if (h === '0.0.0.0' || h === '0' || h === '::' || h === '::1') return true;

  // IPv4 — handle numeric edge cases (decimal integer, hex, octal, short-dotted).
  const expanded = expandNumericIPv4(h);
  if (expanded) {
    if (expanded.startsWith('127.')) return true;       // loopback
    if (expanded.startsWith('10.')) return true;        // RFC1918
    if (expanded.startsWith('192.168.')) return true;   // RFC1918
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(expanded)) return true;
    if (expanded.startsWith('169.254.')) return true;   // link-local (incl. cloud metadata)
    if (expanded.startsWith('0.')) return true;         // this-network
    if (expanded.startsWith('100.64.')) return true;    // CGNAT — reachable from inside some networks
    // Also block private via literal dotted form to catch parsers that
    // don't normalize (e.g. a hostname like "192.168.001.001").
    return false;
  }

  // IPv6.
  if (h.includes(':')) {
    // Unique-local (RFC 4193): fc00::/7 → first two chars "fc" or "fd".
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
    // Link-local: fe80::/10.
    if (/^fe80:/.test(h)) return true;
    // IPv6-mapped IPv4: ::ffff:a.b.c.d  OR  ::ffff:abcd:ef01
    if (/^::ffff:/.test(h)) {
      const tail = h.replace(/^::ffff:/, '');
      // Dotted form — recurse.
      if (net.isIPv4(tail)) return isPrivateHost(tail);
      // Hex form, two hextets.
      const parts = tail.split(':');
      if (parts.length === 2) {
        const hi = parseInt(parts[0] ?? '', 16);
        const lo = parseInt(parts[1] ?? '', 16);
        if (Number.isFinite(hi) && Number.isFinite(lo)) {
          const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
          return isPrivateHost(ipv4);
        }
      }
    }
  }

  return false;
}

/**
 * Async check — resolve DNS and verify no returned address is private.
 * Call this once before fetch(); the outbound request may still get a
 * different IP at connect time (DNS-rebinding TOCTOU) but the pre-check
 * shrinks that window from "unbounded" to "milliseconds".
 *
 * Returns true when the request should be BLOCKED.
 */
export async function isPrivateResolved(hostname: string): Promise<boolean> {
  const h = normalize(hostname);
  if (isPrivateHost(h)) return true;
  try {
    const addrs = await dns.lookup(h, { all: true, verbatim: true });
    return addrs.some((a) => isPrivateHost(a.address));
  } catch {
    // Unresolvable host — block. Prevents surprise routing via internal
    // DNS shadows that only resolve from inside the prod network.
    return true;
  }
}

/**
 * Ports we refuse to outbound to. SSH, SMTP, database ports, metadata
 * ports — these aren't HTTP and we don't want the customer (or LLM) to
 * cross-protocol smuggle requests through them. Empty string = accept.
 */
const BLOCKED_PORTS = new Set<string>([
  '22',    // SSH
  '23',    // Telnet
  '25',    // SMTP
  '465',   // SMTPS
  '587',   // SMTP submission
  '110',   // POP3
  '143',   // IMAP
  '993',   // IMAPS
  '995',   // POP3S
  '3306',  // MySQL
  '5432',  // PostgreSQL
  '6379',  // Redis
  '11211', // Memcached
  '27017', // MongoDB
  '2375',  // Docker daemon
  '2376',  // Docker daemon TLS
]);

/**
 * Returns true when the port should be blocked. Standard HTTP/HTTPS
 * ports (empty string after URL parse) and common dev ports (3000, 8000,
 * 8080, 8443) pass through — cloud APIs serve on weird ports regularly.
 */
export function isBlockedPort(port: string): boolean {
  if (!port) return false;             // empty → default 80/443, fine
  return BLOCKED_PORTS.has(port);
}
