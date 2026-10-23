/**
 * Smoke tests for crypto.ts — AES-256-GCM encrypt/decrypt symmetry.
 * Validates that tokens survive a round-trip, plaintext passthrough works
 * (backwards-compat), and edge cases (null, empty, corrupt) are handled.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

// Provide a valid 64-hex-char encryption key for tests
vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));
vi.stubEnv('NODE_ENV', 'test');

const { encrypt, decrypt, ENCRYPTION_ENABLED } = await import('../crypto.js');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

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

  it.each([0, 1, 2])('rejects tampering of IV, auth tag or ciphertext (part %i)', (index) => {
    const parts = encrypt('synthetic-token')!.slice('enc:v1:'.length).split(':');
    const part = parts[index]!;
    parts[index] = (part[0] === '0' ? '1' : '0') + part.slice(1);
    expect(decrypt('enc:v1:' + parts.join(':'))).toBeNull();
  });

  it.each([0, 1, 2])('rejects noncanonical hex in every encrypted part (part %i)', (index) => {
    for (const suffix of ['a', 'zz']) {
      const parts = encrypt('synthetic-token')!.slice('enc:v1:'.length).split(':');
      parts[index] += suffix;
      expect(decrypt('enc:v1:' + parts.join(':'))).toBeNull();
    }
  });

  it('rejects truncated authentication tags, even if Node accepts a shorter GCM tag', () => {
    const parts = encrypt('synthetic-token')!.slice('enc:v1:'.length).split(':');
    parts[1] = parts[1]!.slice(0, 8);
    expect(decrypt('enc:v1:' + parts.join(':'))).toBeNull();
  });

  it('returns null when an otherwise valid envelope was encrypted with another key', async () => {
    const encrypted = encrypt('synthetic-token');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ENCRYPTION_KEY', 'b'.repeat(64));
    vi.resetModules();
    const otherKeyCrypto = await import('../crypto.js');
    expect(otherKeyCrypto.ENCRYPTION_ENABLED).toBe(true);
    expect(otherKeyCrypto.decrypt(encrypted)).toBeNull();
  });

  it('encrypts unicode correctly', () => {
    const unicode = 'Müller straße 42 — ñoño@example.de';
    const enc = encrypt(unicode);
    expect(decrypt(enc)).toBe(unicode);
  });
});

describe('crypto startup configuration', () => {
  it.each([undefined, '', 'a'.repeat(63), 'a'.repeat(65), 'z'.repeat(64)])(
    'refuses production startup for a missing or invalid key (%j)', async (key) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('ENCRYPTION_KEY', key);
      vi.resetModules();
      await expect(import('../crypto.js')).rejects.toThrow(/ENCRYPTION_KEY.*refusing to boot/);
    },
  );

  it('allows production startup only with a valid key and actually encrypts', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENCRYPTION_KEY', 'A'.repeat(64));
    vi.resetModules();
    const configured = await import('../crypto.js');
    expect(configured.ENCRYPTION_ENABLED).toBe(true);
    expect(configured.encrypt('synthetic-token')).toMatch(/^enc:v1:/);
    expect(configured.decrypt(configured.encrypt('synthetic-token'))).toBe('synthetic-token');
  });

  it.each([undefined, 'invalid'])('keeps explicit development plaintext compatibility with key %j', async (key) => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENCRYPTION_KEY', key);
    vi.resetModules();
    const unconfigured = await import('../crypto.js');
    expect(unconfigured.ENCRYPTION_ENABLED).toBe(false);
    expect(unconfigured.encrypt('synthetic-token')).toBe('synthetic-token');
    expect(unconfigured.decrypt('legacy-plaintext')).toBe('legacy-plaintext');
    expect(unconfigured.decrypt(encrypt('synthetic-token'))).toBeNull();
  });
});
