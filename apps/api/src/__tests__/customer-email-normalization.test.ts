import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../db.js', () => ({
  pool: { query: queryMock },
}));

const { normalizeSpokenEmail, upsertCustomer } = await import('../customers.js');

describe('spoken customer email normalization', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({
      rows: [{
        id: 'customer_1',
        created_at: '2026-05-16T08:00:00.000Z',
        updated_at: '2026-05-16T08:00:00.000Z',
        org_id: 'org_1',
        full_name: 'Max Muster',
        normalized_name: 'max muster',
        phone: null,
        phone_normalized: null,
        email: 'max@gmx.de',
        customer_type: 'pending',
        status: 'active',
        notes: null,
        details: {},
        last_seen_at: null,
        source_call_id: null,
      }],
    });
  });

  it('normalizes common German spoken email tokens', () => {
    expect(normalizeSpokenEmail('max at gmx punkt de')).toBe('max@gmx.de');
    expect(normalizeSpokenEmail('maria punkt meier at beispiel punkt de')).toBe('maria.meier@beispiel.de');
    expect(normalizeSpokenEmail('test plus demo at firma bindestrich berlin punkt com')).toBe('test+demo@firma-berlin.com');
  });

  it('persists normalized spoken email addresses', async () => {
    await upsertCustomer({
      orgId: 'org_1',
      fullName: 'Max Muster',
      email: 'max at gmx punkt de',
    });

    const params = queryMock.mock.calls[0]?.[1] as unknown[];
    expect(params).toContain('max@gmx.de');
  });

  it('still rejects incomplete email addresses after normalization', async () => {
    await expect(upsertCustomer({
      orgId: 'org_1',
      fullName: 'Max Muster',
      email: 'max at',
    })).rejects.toMatchObject({ name: 'ZodError' });
  });
});
