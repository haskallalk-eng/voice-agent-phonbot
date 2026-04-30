/**
 * resolveOrgIdFromSubscription tests — Audit-Round-15 (M3 from R14 Codex
 * review).
 *
 * The deleted/pause/resume Stripe-webhook branches previously trusted
 * `sub.metadata.orgId` directly. Edits in the Stripe dashboard could redirect
 * a webhook to mutate the wrong org. The resolver cross-checks via
 * `orgs.stripe_customer_id` and prefers the DB on mismatch.
 *
 * Mock-pool pattern (matches usage.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockWarn = vi.fn();
vi.mock('../logger.js', () => {
  const noop = () => {};
  return {
    log: { info: noop, warn: mockWarn, error: noop, debug: noop },
    logBg: () => noop,
  };
});

// Codex Round-15 review HIGH: stub the actual exports billing.ts imports
// (sendPlanActivatedEmail + sendPaymentFailedEmail). Earlier mock used the
// wrong names; tests still passed because the resolver path doesn't invoke
// them, but a future webhook-branch test would have crashed at import.
vi.mock('../email.js', () => ({
  sendPlanActivatedEmail: vi.fn(),
  sendPaymentFailedEmail: vi.fn(),
}));

const { resolveOrgIdFromSubscription } = await import('../billing.js');

// Build a minimal Stripe.Subscription stub with just the fields the resolver
// reads (metadata, customer). The resolver is the only consumer of these
// fields in the test, so a partial cast is safe.
function makeSub(opts: {
  metaOrgId?: string | null;
  customerId?: string | null;
  customerExpanded?: boolean;
}): Stripe.Subscription {
  const customer = opts.customerId === null
    ? null
    : opts.customerExpanded
      ? ({ id: opts.customerId, deleted: false } as unknown as Stripe.Customer)
      : opts.customerId ?? '';
  return {
    id: 'sub_test',
    metadata: opts.metaOrgId === null ? {} : { orgId: opts.metaOrgId ?? 'org-meta-default' },
    customer,
  } as unknown as Stripe.Subscription;
}

describe('resolveOrgIdFromSubscription (M3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers DB-mapped orgId when both metadata and DB resolve and match', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'org-from-db' }], rowCount: 1 });
    const got = await resolveOrgIdFromSubscription(
      makeSub({ metaOrgId: 'org-from-db', customerId: 'cus_abc' }),
    );
    expect(got).toBe('org-from-db');
    // Confirm SQL shape: SELECT id FROM orgs WHERE stripe_customer_id = $1
    const sql = mockQuery.mock.calls[0]![0] as string;
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(sql).toContain('FROM orgs');
    expect(sql).toContain('stripe_customer_id');
    expect(params[0]).toBe('cus_abc');
  });

  it('prefers DB-mapped orgId on mismatch (defence against dashboard edits)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'org-real' }], rowCount: 1 });
    const got = await resolveOrgIdFromSubscription(
      makeSub({ metaOrgId: 'org-tampered', customerId: 'cus_abc' }),
    );
    expect(got).toBe('org-real');
    // Codex Round-15 LOW: pin the warning side-effect — without it, an
    // operator silently writing the wrong org's id to subscription metadata
    // would never surface in logs even though we route correctly.
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ metaOrgId: 'org-tampered', dbOrgId: 'org-real', customerId: 'cus_abc' }),
      expect.stringContaining('mismatch'),
    );
  });

  it('falls back to metadata when DB has no mapping for the customer', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const got = await resolveOrgIdFromSubscription(
      makeSub({ metaOrgId: 'org-from-meta', customerId: 'cus_unknown' }),
    );
    expect(got).toBe('org-from-meta');
  });

  it('returns null when neither metadata nor DB yields an orgId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const got = await resolveOrgIdFromSubscription(
      makeSub({ metaOrgId: null, customerId: 'cus_unknown' }),
    );
    expect(got).toBeNull();
  });

  it('skips DB lookup and returns metadata when customer is missing', async () => {
    const got = await resolveOrgIdFromSubscription(
      makeSub({ metaOrgId: 'org-from-meta', customerId: null }),
    );
    expect(got).toBe('org-from-meta');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns null when customer is missing and metadata is empty', async () => {
    const got = await resolveOrgIdFromSubscription(
      makeSub({ metaOrgId: null, customerId: null }),
    );
    expect(got).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('handles expanded customer object (sub.customer.id) the same as a string', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'org-real' }], rowCount: 1 });
    const got = await resolveOrgIdFromSubscription(
      makeSub({ metaOrgId: 'org-from-meta', customerId: 'cus_expanded', customerExpanded: true }),
    );
    expect(got).toBe('org-real');
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe('cus_expanded');
  });

  // Codex Round-15 LOW: explicit DeletedCustomer-shape. Stripe webhooks for
  // deleted/canceled flows can carry a Customer that has been deleted —
  // resolveOrgIdFromSubscription only needs `.id`, which DeletedCustomer
  // also exposes, so the same code path applies.
  it('handles DeletedCustomer object (deleted: true) by reading .id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'org-real' }], rowCount: 1 });
    const sub = {
      id: 'sub_test',
      metadata: { orgId: 'org-from-meta' },
      customer: { id: 'cus_deleted', deleted: true } as unknown as Stripe.Customer,
    } as unknown as Stripe.Subscription;
    const got = await resolveOrgIdFromSubscription(sub);
    expect(got).toBe('org-real');
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe('cus_deleted');
  });
});
