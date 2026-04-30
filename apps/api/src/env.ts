import dotenv from 'dotenv';

// Single source of truth: apps/api/.env
//
// Why no root-.env fallback: a root .env that quietly shadows missing keys is
// a security foot-gun — when someone forgets to update apps/api/.env after
// rotating a secret, the stale root value silently keeps the app running on
// the wrong DB password, expired API key, or weak JWT secret. Fail loud,
// fail early. .env.example lives next to this file as a template.
dotenv.config({ path: new URL('../.env', import.meta.url) });

// Model whitelist — warn at boot if OPENAI_MODEL is set to something that
// doesn't support tool/function-calling (agent-runtime + copilot both pass
// tools; a model like "davinci-002" would silently 400 on every request).
// The check is a warning, not a throw, so we can still run experimental
// models out of hours without editing the allowlist.
const KNOWN_TOOL_CAPABLE_MODELS = new Set([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4o-2024-08-06',
  'gpt-4o-mini-2024-07-18',
  'gpt-4-turbo',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-5',
  'gpt-5-mini',
]);
const model = process.env.OPENAI_MODEL;
if (model && !KNOWN_TOOL_CAPABLE_MODELS.has(model)) {
  process.stderr.write(
    `[env] WARNING: OPENAI_MODEL="${model}" is not in the known tool-capable allowlist. ` +
    `If this model doesn't support tool calling, agent-runtime and copilot will fail. ` +
    `Known-good: ${[...KNOWN_TOOL_CAPABLE_MODELS].join(', ')}\n`,
  );
}

// Fail-loud boot-check for secrets that are load-bearing in production.
// A missing RETELL/OPENAI/TWILIO key lets the app boot and serve /health OK,
// but every voice call or AI analysis silently errors — an incident that
// only shows up in user reports. Throwing at boot turns it into a deploy
// failure, which is the right place to catch it.
//
// Dev / test: skipped so contributors don't need every key to run the app
// locally. JWT_SECRET and DATABASE_URL are enforced elsewhere (auth / db).
if (process.env.NODE_ENV === 'production') {
  // Audit-Round-13: WEBHOOK_SIGNING_SECRET ist jetzt hard-required nachdem
  // die env-var auf prod gesetzt wurde (Round 7 → soft-warn → Round 13 →
  // promote). Separation von JWT_SECRET schützt Customer-Webhook-Signaturen
  // vor JWT-Rotation. Falls die Werte aktuell gleich sind (Migration-
  // Strategie), ist das OK — nur muss WEBHOOK_SIGNING_SECRET ab jetzt
  // explizit existieren, sonst boot-fail statt silent JWT_SECRET-Fallback.
  const REQUIRED_PROD_SECRETS = [
    'DATABASE_URL',
    'JWT_SECRET',
    'ENCRYPTION_KEY',
    'RETELL_API_KEY',
    'OPENAI_API_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'WEBHOOK_SIGNING_SECRET',
  ] as const;
  const missing = REQUIRED_PROD_SECRETS.filter((k) => !process.env[k] || process.env[k]!.trim() === '');
  if (missing.length > 0) {
    process.stderr.write(`[env] FATAL: missing required production secrets: ${missing.join(', ')}\n`);
    throw new Error(`Missing required production env vars: ${missing.join(', ')}`);
  }

  // Audit-Round-15 (M2 from R14 Codex Plan-Review): RETELL_TOOL_AUTH_SECRET is
  // entering soft-warn phase. The actual signing code (agent-config.ts:554 +
  // retell-webhooks.ts:271) already throws in prod when neither this nor
  // JWT_SECRET is set, so we never sign tool URLs with `dev-retell-tool-auth`
  // by accident. The risk is the *fallback* itself: every Retell agent
  // currently in production has tool URLs HMAC-signed using JWT_SECRET. If an
  // operator rotates JWT_SECRET tomorrow without first migrating to a separate
  // RETELL_TOOL_AUTH_SECRET, every existing agent's tool calls instantly fail
  // signature verification — same class of incident as the WEBHOOK_SIGNING_
  // SECRET drift R7→R13 fixed for customer webhooks.
  //
  // Migration: set RETELL_TOOL_AUTH_SECRET = JWT_SECRET on prod first
  // (signatures stay valid because deterministic HMAC over the same key), then
  // promote to REQUIRED_PROD_SECRETS in a future round. JWT_SECRET can then be
  // rotated without breaking Retell tool-URL validation.
  if (!process.env.RETELL_TOOL_AUTH_SECRET || process.env.RETELL_TOOL_AUTH_SECRET.trim() === '') {
    process.stderr.write(
      `[env] WARNING: RETELL_TOOL_AUTH_SECRET is unset in production — ` +
      `tool-URL signatures will fall back to JWT_SECRET. Set RETELL_TOOL_AUTH_SECRET = JWT_SECRET ` +
      `before rotating JWT_SECRET, otherwise every existing Retell agent's tool calls will fail. ` +
      `Will become hard-required in a future round (matches the WEBHOOK_SIGNING_SECRET migration).\n`,
    );
  }
}
