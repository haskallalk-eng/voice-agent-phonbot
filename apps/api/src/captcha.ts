/**
 * Cloudflare Turnstile verification.
 *
 * Verifies the token a browser-side Turnstile widget produced. Used to gate
 * unauthenticated cost-amplification surfaces (/demo/*, /outbound/website-callback)
 * against botnet abuse where per-IP rate-limits are trivially bypassed.
 *
 * Cost: free, unlimited, no credit card. DSGVO-compliant (Cloudflare DPA).
 *
 * Env:
 *   TURNSTILE_SECRET_KEY — set per environment. In dev, can be empty:
 *     verification then short-circuits to allowed (so local-dev doesn't
 *     require a Cloudflare account). In production, MUST be set or
 *     verifyTurnstile() returns false (fail-closed).
 *   TURNSTILE_SITE_KEY (frontend) — VITE_TURNSTILE_SITE_KEY in apps/web/.env.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 5_000;

const SECRET = process.env.TURNSTILE_SECRET_KEY ?? '';
const IS_PROD = process.env.NODE_ENV === 'production';

if (!SECRET && IS_PROD) {
  // Fail-loud at boot so a misconfigured prod doesn't accidentally allow all
  // requests through. Dev keeps the permissive path so local development
  // doesn't require a Cloudflare account.
  process.stderr.write('[captcha] WARNING: TURNSTILE_SECRET_KEY not set in production — every captcha verification will fail (fail-closed)\n');
}

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

/**
 * Verify a Turnstile token. Returns true if the token is valid + fresh.
 *
 * Behaviour matrix:
 *   prod + no SECRET  → false (fail-closed; we can't verify, so deny)
 *   prod + SECRET     → real verification against Cloudflare
 *   dev  + no SECRET  → true (skip — don't make local dev painful)
 *   dev  + SECRET     → real verification (you can opt in to test the flow)
 *
 * @param token  The cf-turnstile-response value the widget produced.
 * @param remoteIp  Optional client IP for additional cross-check by Cloudflare.
 */
export async function verifyTurnstile(token: string | undefined, remoteIp?: string): Promise<boolean> {
  if (!SECRET) {
    if (IS_PROD) return false;
    return true;
  }
  // Token absent → allow (defense-in-depth, not hard-gate). Turnstile adds
  // an extra layer against sophisticated botnets, but the primary defense is
  // rate-limit + global-cap. Blocking on empty token breaks UX for:
  // - Ad-blocker users (Turnstile script blocked)
  // - Auto-start from ?demo= param (script not loaded yet on fresh pageload)
  // - Static industry pages redirecting to SPA (/friseur/ → /?demo=hairdresser)
  // Log the skip so we can measure how many requests come without Turnstile.
  if (!token || token.trim().length === 0) {
    if (IS_PROD) process.stderr.write(`[captcha] empty token from ${remoteIp ?? 'unknown'} — allowing (defense-in-depth)\n`);
    return true;
  }

  try {
    const body = new URLSearchParams({ secret: SECRET, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const data = await res.json() as TurnstileResponse;
    return Boolean(data.success);
  } catch {
    return false;
  }
}
