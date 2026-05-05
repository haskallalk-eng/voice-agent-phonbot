import { describe, expect, it, vi } from 'vitest';
import { insertLegalAcceptance, LEGAL_DOCUMENTS, legalSnapshot, legalSnapshotHash } from '../legal.js';

describe('legal acceptance trail', () => {
  it('builds a versioned absolute document snapshot', () => {
    const snapshot = legalSnapshot('https://phonbot.de/app');

    expect(snapshot.terms.url).toBe('https://phonbot.de/app/agb/');
    expect(snapshot.privacy.url).toBe('https://phonbot.de/app/datenschutz/');
    expect(snapshot.dpa.url).toBe('https://phonbot.de/app/avv/');
    expect(snapshot.terms.sha256).toBe(LEGAL_DOCUMENTS.terms.sha256);
    expect(snapshot.privacy.sha256).toBe(LEGAL_DOCUMENTS.privacy.sha256);
    expect(snapshot.dpa.sha256).toBe(LEGAL_DOCUMENTS.dpa.sha256);
    expect(legalSnapshotHash(snapshot)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('persists the legal acceptance with document hash and request metadata', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    await insertLegalAcceptance(
      { query },
      {
        source: 'checkout_signup',
        email: 'kunde@example.de',
        pendingRegistrationId: '11111111-1111-1111-1111-111111111111',
        planId: 'starter',
        billingInterval: 'month',
        stripeSessionId: 'cs_test_123',
        stripeCustomerId: 'cus_123',
        isBusiness: true,
        termsAccepted: true,
        privacyAccepted: true,
        avvAccepted: true,
        metadata: { checkoutUrlCreated: true },
        req: {
          ip: '203.0.113.42',
          headers: { 'user-agent': 'vitest-agent' },
        } as any,
      },
    );

    expect(query).toHaveBeenCalledTimes(1);
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe('checkout_signup');
    expect(params[4]).toBe('kunde@example.de');
    expect(params[7]).toBe('cs_test_123');
    expect(params[9]).toBe('203.0.113.42');
    expect(params[10]).toBe('vitest-agent');
    expect(params[11]).toMatch(/^[a-f0-9]{64}$/);
    expect(params[12]).toMatchObject({
      terms: { version: '2026-05-05', sha256: LEGAL_DOCUMENTS.terms.sha256 },
      privacy: { version: '2026-05-05', sha256: LEGAL_DOCUMENTS.privacy.sha256 },
      dpa: { version: '1.1-2026-05-05', sha256: LEGAL_DOCUMENTS.dpa.sha256 },
    });
    expect(params[13]).toEqual({ checkoutUrlCreated: true });
  });
});
