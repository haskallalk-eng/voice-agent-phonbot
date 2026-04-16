/**
 * Smoke tests for crypto.ts — AES-256-GCM encrypt/decrypt symmetry.
 * Validates that tokens survive a round-trip, plaintext passthrough works
 * (backwards-compat), and edge cases (null, empty, corrupt) are handled.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

// Provide a valid 64-hex-char encryption key for tests
vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));
vi.stubEnv('NODE_ENV', 'test');

const { encrypt, decrypt, ENCRYPTION_ENABLED } = await import('../crypto.js');

describe('crypto (AES-256-GCM)', () => {
  beforeAll(() => {
    expect(ENCRYPTION_ENABLED).toBe(true);
  });

  it('encrypt → decrypt round-trip preserves plaintext', () => {
    const original = 'ya29.a0ARrdaM-secret-oauth-token-here';
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(encrypted).toMatch(/^enc:v1:/);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it('each encryption produces different ciphertext (random IV)', () => {
    const text = 'same-input-different-output';
    const a = encrypt(text);
    const b = encrypt(text);
    expect(a).not.toBe(b); // different IV → different ciphertext
    expect(decrypt(a)).toBe(text);
    expect(decrypt(b)).toBe(text);
  });

  it('decrypt returns plaintext passthrough for non-prefixed values (legacy compat)', () => {
    const legacy = 'ya29.legacy-plaintext-token';
    expect(decrypt(legacy)).toBe(legacy);
  });

  it('handles null and undefined', () => {
    expect(encrypt(null)).toBeNull();
    expect(encrypt(undefined)).toBeNull();
    expect(decrypt(null)).toBeNull();
    expect(decrypt(undefined)).toBeNull();
  });

  it('handles empty string', () => {
    expect(encrypt('')).toBe('');
    expect(decrypt('')).toBe('');
  });

  it('decrypt returns null for corrupt ciphertext', () => {
    const corrupt = 'enc:v1:deadbeef:deadbeef:deadbeef';
    expect(decrypt(corrupt)).toBeNull();
  });

  it('decrypt returns null for malformed prefix (wrong part count)', () => {
    expect(decrypt('enc:v1:only-two-parts')).toBeNull();
  });

  it('encrypts unicode correctly', () => {
    const unicode = 'Müller straße 42 — ñoño@example.de';
    const enc = encrypt(unicode);
    expect(decrypt(enc)).toBe(unicode);
  });
});
