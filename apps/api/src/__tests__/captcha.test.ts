/**
 * Smoke tests for captcha.ts — validates the Turnstile verification flow
 * without hitting Cloudflare's real endpoint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture env before import
const originalEnv = { ...process.env };

describe('verifyTurnstile', () => {
  let verifyTurnstile: (token: string | undefined, remoteIp?: string) => Promise<boolean>;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset module cache so env changes take effect
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns true in dev when SECRET is unset (fail-open)', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.NODE_ENV = 'development';
    const mod = await import('../captcha.js');
    verifyTurnstile = mod.verifyTurnstile;
    expect(await verifyTurnstile('any-token')).toBe(true);
  });

  it('returns false in prod when SECRET is unset (fail-closed)', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.NODE_ENV = 'production';
    const mod = await import('../captcha.js');
    verifyTurnstile = mod.verifyTurnstile;
    expect(await verifyTurnstile('any-token')).toBe(false);
  });

  // After 1e8e0dc: empty token → true (defense-in-depth, not hard-gate).
  // Turnstile adds a layer but primary defense is rate-limit + global-cap.
  it('returns true when token is empty (defense-in-depth, not hard-gate)', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    process.env.NODE_ENV = 'production';
    const mod = await import('../captcha.js');
    verifyTurnstile = mod.verifyTurnstile;
    expect(await verifyTurnstile('')).toBe(true);
    expect(await verifyTurnstile(undefined)).toBe(true); // also defense-in-depth
  });

  it('returns true when Cloudflare responds success:true', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    process.env.NODE_ENV = 'production';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const mod = await import('../captcha.js');
    verifyTurnstile = mod.verifyTurnstile;
    expect(await verifyTurnstile('valid-token', '1.2.3.4')).toBe(true);

    // Verify correct URL + method
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toContain('challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(opts.method).toBe('POST');
  });

  it('returns false when Cloudflare responds success:false', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    process.env.NODE_ENV = 'production';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    }));

    const mod = await import('../captcha.js');
    verifyTurnstile = mod.verifyTurnstile;
    expect(await verifyTurnstile('bad-token')).toBe(false);
  });

  it('returns false on network error (fail-closed)', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    process.env.NODE_ENV = 'production';

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const mod = await import('../captcha.js');
    verifyTurnstile = mod.verifyTurnstile;
    expect(await verifyTurnstile('any-token')).toBe(false);
  });
});
