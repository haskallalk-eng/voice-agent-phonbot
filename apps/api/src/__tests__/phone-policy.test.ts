import { afterEach, expect, it, vi } from 'vitest';
import { isPhonePrefixAllowed } from '../phone-policy.js';
afterEach(() => vi.unstubAllEnvs());
it('preserves DACH defaults and refuses other countries', () => {
  vi.stubEnv('ALLOWED_PHONE_PREFIXES', undefined);
  for (const number of ['+493012345678', '+43123456789', '+41441234567']) expect(isPhonePrefixAllowed(number)).toBe(true);
  for (const number of ['+12025550123', '+442012345678', '', '03012345678']) expect(isPhonePrefixAllowed(number)).toBe(false);
});
it('honours an explicit override and does not silently replace an empty allowlist', () => {
  vi.stubEnv('ALLOWED_PHONE_PREFIXES', ' +43 , +41 ');
  expect(isPhonePrefixAllowed('+493012345678')).toBe(false);
  expect(isPhonePrefixAllowed('+43123456789')).toBe(true);
  vi.stubEnv('ALLOWED_PHONE_PREFIXES', '');
  expect(isPhonePrefixAllowed('+43123456789')).toBe(false);
});
