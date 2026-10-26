/** Shared country allowlist. Callers retain their existing number validation. */
export function isPhonePrefixAllowed(number: string): boolean {
  const prefixes = (process.env.ALLOWED_PHONE_PREFIXES ?? '+49,+43,+41')
    .split(',').map(prefix => prefix.trim()).filter(Boolean);
  return prefixes.some(prefix => number.startsWith(prefix));
}
