import { describe, expect, it } from 'vitest';
import { evaluateToolPolicy } from '../policy-layer.js';

const nowIsoDate = '2026-05-21';

describe('evaluateToolPolicy', () => {
  it('blocks calendar booking without explicit confirmation', () => {
    const result = evaluateToolPolicy({
      toolName: 'calendar_book',
      nowIsoDate,
      callerPhoneVerified: true,
      args: { customerName: 'Mina', service: 'Haarschnitt', startAt: '2026-05-22T10:00:00+02:00' },
    });
    expect(result).toMatchObject({ allowed: false, code: 'CONFIRMATION_REQUIRED' });
  });

  it('allows calendar booking with confirmation and contact identity', () => {
    const result = evaluateToolPolicy({
      toolName: 'calendar_book',
      nowIsoDate,
      callerPhoneVerified: true,
      args: { customerName: 'Mina', service: 'Haarschnitt', startAt: '2026-05-22T10:00:00+02:00', confirmed: true },
    });
    expect(result).toEqual({ allowed: true });
  });

  it('blocks finding existing bookings with name-only identity', () => {
    const result = evaluateToolPolicy({
      toolName: 'calendar_find_bookings',
      nowIsoDate,
      args: { customerName: 'Mina' },
    });
    expect(result).toMatchObject({ allowed: false, code: 'STRONG_IDENTITY_REQUIRED' });
  });

  it('does not treat a typed email as confirmed identity for existing bookings', () => {
    const result = evaluateToolPolicy({
      toolName: 'calendar_find_bookings',
      nowIsoDate,
      args: { email: 'mina@example.com' },
    });
    expect(result).toMatchObject({ allowed: false, code: 'STRONG_IDENTITY_REQUIRED' });
  });

  it('blocks cancel without change token', () => {
    const result = evaluateToolPolicy({
      toolName: 'calendar_cancel',
      nowIsoDate,
      callerPhoneVerified: true,
      args: { confirmed: true },
    });
    expect(result).toMatchObject({ allowed: false, code: 'CHANGE_CONFIRMATION_REQUIRED' });
  });

  it('allows cancel with strong identity, change token, and confirmation', () => {
    const result = evaluateToolPolicy({
      toolName: 'calendar_cancel',
      nowIsoDate,
      callerPhoneVerified: true,
      args: { changeToken: 'opaque-token', confirmed: true },
    });
    expect(result).toEqual({ allowed: true });
  });
});
