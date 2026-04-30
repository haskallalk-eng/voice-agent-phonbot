/**
 * deriveWebhookSecret() tests — Audit-Round-14.
 *
 * Validates the precedence rule that lets us rotate JWT_SECRET independently
 * of customer-webhook signing keys: WEBHOOK_SIGNING_SECRET wins over
 * JWT_SECRET. Without this, every JWT-rotation would silently invalidate
 * every customer's webhook validator.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';

import { deriveWebhookSecret } from '../inbound-webhooks.js';

describe('deriveWebhookSecret (signing-secret precedence)', () => {
  const origWebhook = process.env.WEBHOOK_SIGNING_SECRET;
  const origJwt = process.env.JWT_SECRET;

  beforeEach(() => {
    delete process.env.WEBHOOK_SIGNING_SECRET;
    delete process.env.JWT_SECRET;
  });

  afterEach(() => {
    if (origWebhook === undefined) delete process.env.WEBHOOK_SIGNING_SECRET;
    else process.env.WEBHOOK_SIGNING_SECRET = origWebhook;
    if (origJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = origJwt;
    vi.restoreAllMocks();
  });

  function expectedDigest(masterKey: string, tenantId: string, webhookId: string): Buffer {
    return crypto
      .createHmac('sha256', masterKey)
      .update(`${tenantId}:${webhookId}`)
      .digest();
  }

  it('uses WEBHOOK_SIGNING_SECRET when present', () => {
    process.env.WEBHOOK_SIGNING_SECRET = 'webhook-master-key-32-chars-test!';
    process.env.JWT_SECRET = 'should-not-be-used-for-signing-jwt';
    const got = deriveWebhookSecret('tenant-a', 'hook-1');
    const want = expectedDigest('webhook-master-key-32-chars-test!', 'tenant-a', 'hook-1');
    expect(got.equals(want)).toBe(true);
  });

  it('falls back to JWT_SECRET only when WEBHOOK_SIGNING_SECRET is unset', () => {
    process.env.JWT_SECRET = 'jwt-only-key-32-chars-minimum-here';
    const got = deriveWebhookSecret('tenant-a', 'hook-1');
    const want = expectedDigest('jwt-only-key-32-chars-minimum-here', 'tenant-a', 'hook-1');
    expect(got.equals(want)).toBe(true);
  });

  it('JWT_SECRET rotation does NOT change the per-hook secret when WEBHOOK_SIGNING_SECRET is set', () => {
    process.env.WEBHOOK_SIGNING_SECRET = 'webhook-master-stable-12345-abcde';
    process.env.JWT_SECRET = 'jwt-original-32-chars-minimum-key!';
    const before = deriveWebhookSecret('t1', 'h1');

    // Simulate JWT rotation
    process.env.JWT_SECRET = 'jwt-rotated-32-chars-minimum-key!!';
    const after = deriveWebhookSecret('t1', 'h1');

    expect(before.equals(after)).toBe(true);
  });

  it('different (tenantId, webhookId) pairs produce different secrets', () => {
    process.env.WEBHOOK_SIGNING_SECRET = 'webhook-master-key-32-chars-test!';
    const a = deriveWebhookSecret('tenant-a', 'hook-1');
    const b = deriveWebhookSecret('tenant-a', 'hook-2');
    const c = deriveWebhookSecret('tenant-b', 'hook-1');
    expect(a.equals(b)).toBe(false);
    expect(a.equals(c)).toBe(false);
    expect(b.equals(c)).toBe(false);
  });

  it('returns 32-byte HMAC-SHA256 digest', () => {
    process.env.WEBHOOK_SIGNING_SECRET = 'webhook-master-key-32-chars-test!';
    const got = deriveWebhookSecret('t', 'h');
    expect(got.length).toBe(32);
  });

  it('deterministic: same inputs always produce same output', () => {
    process.env.WEBHOOK_SIGNING_SECRET = 'webhook-master-key-32-chars-test!';
    const a = deriveWebhookSecret('tenant-a', 'hook-1');
    const b = deriveWebhookSecret('tenant-a', 'hook-1');
    expect(a.equals(b)).toBe(true);
  });
});
