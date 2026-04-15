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
