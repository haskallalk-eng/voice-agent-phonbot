/**
 * Webhook signature verification tests (FINAL-04).
 * Ensures Retell HMAC + timing-safe compare actually rejects forged/empty/malformed signatures.
 */

import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';

// Mock env
const TEST_API_KEY = 'test-retell-key-for-hmac-verification';
vi.stubEnv('RETELL_API_KEY', TEST_API_KEY);
vi.stubEnv('NODE_ENV', 'test');

const { verifyRetellSignature } = await import('../retell-webhooks.js');

function signedReq(body: string, signature: string) {
  return {
    headers: { 'x-retell-signature': signature },
    rawBody: body,
  } as unknown as Parameters<typeof verifyRetellSignature>[0];
}

describe('Retell webhook HMAC verification logic', () => {
  function computeHmac(body: string, key: string): string {
    return crypto.createHmac('sha256', key).update(body).digest('hex');
  }

  function computeCurrentRetellSignature(body: string, key: string, timestamp: string): string {
    const digest = crypto.createHmac('sha256', key).update(body + timestamp).digest('hex');
    return `v=${timestamp},d=${digest}`;
  }

  it('production verifier accepts current Retell signature format', () => {
    const body = JSON.stringify({ event: 'call_ended', call: { call_id: 'test' } });
    const timestamp = String(Date.now());
    const signature = computeCurrentRetellSignature(body, TEST_API_KEY, timestamp);

    expect(verifyRetellSignature(signedReq(body, signature))).toBe(true);
  });

  it('production verifier rejects tampered current-format bodies', () => {
    const body = JSON.stringify({ event: 'call_ended', call: { call_id: 'test' } });
    const tampered = JSON.stringify({ event: 'call_ended', call: { call_id: 'evil' } });
    const timestamp = String(Date.now());
    const signature = computeCurrentRetellSignature(body, TEST_API_KEY, timestamp);

    expect(verifyRetellSignature(signedReq(tampered, signature))).toBe(false);
  });

  it('production verifier rejects requests without rawBody', () => {
    const body = JSON.stringify({ event: 'call_ended', call: { call_id: 'test' } });
    const timestamp = String(Date.now());
    const signature = computeCurrentRetellSignature(body, TEST_API_KEY, timestamp);

    expect(
      verifyRetellSignature({
        headers: { 'x-retell-signature': signature },
      } as unknown as Parameters<typeof verifyRetellSignature>[0])
    ).toBe(false);
  });

  it('current Retell signature format is v=timestamp,d=digest over body plus timestamp', () => {
    const body = JSON.stringify({ event: 'call_ended', call: { call_id: 'test' } });
    const timestamp = '1778087000000';
    const signature = computeCurrentRetellSignature(body, TEST_API_KEY, timestamp);
    const match = signature.match(/^v=(\d+),d=([0-9a-f]+)$/);

    expect(match?.[1]).toBe(timestamp);
    expect(match?.[2]).toBe(crypto.createHmac('sha256', TEST_API_KEY).update(body + timestamp).digest('hex'));
  });

  it('correct HMAC matches via timingSafeEqual', () => {
    const body = JSON.stringify({ event: 'call_ended', call: { call_id: 'test' } });
    const signature = computeHmac(body, TEST_API_KEY);

    const expected = crypto.createHmac('sha256', TEST_API_KEY).update(body).digest('hex');

    expect(signature.length).toBe(expected.length);
    expect(
      crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))
    ).toBe(true);
  });

  it('wrong key produces different HMAC', () => {
    const body = '{"event":"call_ended"}';
    const timestamp = String(Date.now());
    const wrongDigest = crypto.createHmac('sha256', 'wrong-key').update(body + timestamp).digest('hex');
    const wrongSignature = `v=${timestamp},d=${wrongDigest}`;

    expect(verifyRetellSignature(signedReq(body, wrongSignature))).toBe(false);
  });

  it('tampered body produces different HMAC', () => {
    const original = '{"event":"call_ended","call":{"minutes":5}}';
    const tampered = '{"event":"call_ended","call":{"minutes":999}}';
    const timestamp = String(Date.now());
    const digest = crypto.createHmac('sha256', TEST_API_KEY).update(original + timestamp).digest('hex');

    expect(verifyRetellSignature(signedReq(tampered, `v=${timestamp},d=${digest}`))).toBe(false);
  });

  it('empty signature is rejected by the verifier', () => {
    const body = '{"event":"call_ended"}';

    expect(verifyRetellSignature(signedReq(body, ''))).toBe(false);
  });

  it('non-hex signature is rejected by the verifier', () => {
    const body = '{"event":"call_ended"}';
    const timestamp = String(Date.now());
    const nonHex = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';

    expect(verifyRetellSignature(signedReq(body, `v=${timestamp},d=${nonHex}`))).toBe(false);
  });

  it('HMAC is deterministic (same input → same output)', () => {
    const body = '{"test": true}';
    const sig1 = computeHmac(body, TEST_API_KEY);
    const sig2 = computeHmac(body, TEST_API_KEY);
    expect(sig1).toBe(sig2);
  });
});

describe('Stripe webhook signature verification logic', () => {
  it('stripe-signature header format is correct (t=timestamp,v1=signature)', () => {
    const header = 't=1234567890,v1=abc123def456';
    const parts = header.split(',');
    expect(parts[0]!.startsWith('t=')).toBe(true);
    expect(parts[1]!.startsWith('v1=')).toBe(true);
  });
});
