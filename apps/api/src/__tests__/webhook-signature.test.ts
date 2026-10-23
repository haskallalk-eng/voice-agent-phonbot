import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const TEST_API_KEY = 'test-retell-key-for-hmac-verification';
const NOW = 1_790_000_000_000;
const WINDOW_MS = 5 * 60 * 1000;
const BODY = '{"event":"call_ended","call":{"call_id":"test","minutes":5}}';

let verifyRetellSignature: typeof import('../retell-webhooks.js').verifyRetellSignature;

function signedReq(rawBody: unknown, signature: unknown) {
  return { headers: { 'x-retell-signature': signature }, rawBody } as unknown as Parameters<typeof verifyRetellSignature>[0];
}

function currentSignature(body = BODY, timestamp = NOW, key = TEST_API_KEY): string {
  const digest = crypto.createHmac('sha256', key).update(body + timestamp).digest('hex');
  return `v=${timestamp},d=${digest}`;
}

function legacySignature(body = BODY, key = TEST_API_KEY): string {
  return crypto.createHmac('sha256', key).update(body).digest('hex');
}

async function loadVerifier(key: string | undefined, mode = 'test', allowUnsigned: string | undefined = undefined) {
  vi.stubEnv('RETELL_API_KEY', key);
  vi.stubEnv('NODE_ENV', mode);
  vi.stubEnv('ALLOW_UNSIGNED_WEBHOOKS', allowUnsigned);
  vi.resetModules();
  // The production route imports this same isolated verifier.
  ({ verifyRetellSignature } = await import('../retell-signature.js'));
}

beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  await loadVerifier(TEST_API_KEY);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Retell production signature verifier', () => {
  it.each([BODY, Buffer.from(BODY)])('accepts exact signed raw bytes (string and Buffer)', (rawBody) => {
    expect(verifyRetellSignature(signedReq(rawBody, currentSignature()))).toBe(true);
  });

  it.each([-WINDOW_MS, -WINDOW_MS + 1, 0, WINDOW_MS - 1, WINDOW_MS])(
    'accepts the inclusive five-minute clock window at offset %i ms', (offset) => {
      expect(verifyRetellSignature(signedReq(BODY, currentSignature(BODY, NOW + offset)))).toBe(true);
    },
  );

  it.each([-WINDOW_MS - 1, WINDOW_MS + 1])('rejects stale or future signatures at offset %i ms', (offset) => {
    expect(verifyRetellSignature(signedReq(BODY, currentSignature(BODY, NOW + offset)))).toBe(false);
  });

  it('rejects a changed timestamp even within the accepted window', () => {
    const signature = currentSignature().replace(`v=${NOW}`, `v=${NOW + 1}`);
    expect(verifyRetellSignature(signedReq(BODY, signature))).toBe(false);
  });

  it('rejects a changed body and a semantically identical reserialization', () => {
    expect(verifyRetellSignature(signedReq(BODY.replace('5', '9'), currentSignature()))).toBe(false);
    expect(verifyRetellSignature(signedReq(JSON.stringify(JSON.parse(BODY), null, 2), currentSignature()))).toBe(false);
  });

  it('rejects a signature generated with a different key', () => {
    expect(verifyRetellSignature(signedReq(BODY, currentSignature(BODY, NOW, 'wrong-key')))).toBe(false);
  });

  it.each([undefined, null, {}, 123])('rejects missing or unsupported rawBody %j', (rawBody) => {
    expect(verifyRetellSignature(signedReq(rawBody, currentSignature()))).toBe(false);
  });

  it.each([undefined, null, '', [], [currentSignature()], 123, 'not-hex', `v=${NOW},d=${'z'.repeat(64)}`])(
    'rejects malformed or missing signature %j without throwing', (signature) => {
      expect(verifyRetellSignature(signedReq(BODY, signature))).toBe(false);
    },
  );

  it.each([
    ['current', currentSignature()],
    ['legacy', legacySignature()],
  ])('rejects truncated, extended and odd-length %s digests', (_format, signature) => {
    for (const malformed of [signature.slice(0, -1), signature + 'a', signature + 'ab']) {
      expect(verifyRetellSignature(signedReq(BODY, malformed))).toBe(false);
    }
  });

  it('retains the existing legacy body-only HMAC compatibility', () => {
    expect(verifyRetellSignature(signedReq(BODY, legacySignature()))).toBe(true);
    expect(verifyRetellSignature(signedReq(BODY + ' ', legacySignature()))).toBe(false);
    expect(verifyRetellSignature(signedReq(BODY, legacySignature(BODY, 'wrong-key')))).toBe(false);
  });

  it('does not pretend the legacy format has a timestamp/replay limit', () => {
    const signature = legacySignature();
    vi.mocked(Date.now).mockReturnValue(NOW + 24 * 60 * 60 * 1000);
    expect(verifyRetellSignature(signedReq(BODY, signature))).toBe(true);
  });

  it.each([
    ['test', undefined, false],
    ['development', undefined, false],
    ['development', '1', false],
    ['development', 'false', false],
    ['development', 'true', true],
    ['test', 'true', true],
    ['production', undefined, false],
    ['production', 'true', false],
  ] as const)('missing key: %s mode / opt-in %s => %s', async (mode, optIn, accepted) => {
    await loadVerifier(undefined, mode, optIn);
    expect(verifyRetellSignature(signedReq(undefined, undefined))).toBe(accepted);
  });

  it.each(['test', 'development', 'production'])('a configured key remains mandatory with dev opt-in in %s', async (mode) => {
    await loadVerifier(TEST_API_KEY, mode, 'true');
    expect(verifyRetellSignature(signedReq(BODY, undefined))).toBe(false);
    expect(verifyRetellSignature(signedReq(BODY, currentSignature()))).toBe(true);
  });
});
