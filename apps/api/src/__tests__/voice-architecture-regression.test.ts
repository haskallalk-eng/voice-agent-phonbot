import { describe, expect, it } from 'vitest';
import { buildVoiceContext } from '../context-builder.js';
import { evaluateToolPolicy } from '../policy-layer.js';
import { PLATFORM_BASELINE_PROMPT } from '../platform-baseline.js';

describe('voice architecture regression guard', () => {
  it('resolves tomorrow from injected Berlin date context instead of model memory', () => {
    const ctx = buildVoiceContext({ now: new Date('2026-05-21T12:00:00Z') });

    expect(ctx.time.current_date_iso).toBe('2026-05-21');
    expect(ctx.time.tomorrow_date_iso).toBe('2026-05-22');
    expect(ctx.time.tomorrow_weekday_de.toLowerCase()).toBe('freitag');
  });

  it('blocks a vague yes before a booking mutation', () => {
    const decision = evaluateToolPolicy({
      toolName: 'calendar_book',
      args: {
        customerName: 'Mina Beispiel',
        customerPhone: '+491701234567',
        service: 'Beratung',
        preferredTime: 'morgen 10 Uhr',
      },
      nowIsoDate: '2026-05-21',
    });

    expect(decision).toMatchObject({ allowed: false, code: 'CONFIRMATION_REQUIRED' });
  });

  it('blocks name-only lookup before cancellation or reschedule', () => {
    const decision = evaluateToolPolicy({
      toolName: 'calendar_find_bookings',
      args: { customerName: 'Mina Beispiel' },
      nowIsoDate: '2026-05-21',
    });

    expect(decision).toMatchObject({ allowed: false, code: 'STRONG_IDENTITY_REQUIRED' });
  });

  it('keeps barge-in and stop signals above readback scripts', () => {
    expect(PLATFORM_BASELINE_PROMPT).toContain('Stoppsignale schlagen Skript');
    expect(PLATFORM_BASELINE_PROMPT).toContain('sofort stoppen');
    expect(PLATFORM_BASELINE_PROMPT).toContain('stopp');
  });

  it('forbids speaking internal tool names even under user pressure', () => {
    expect(PLATFORM_BASELINE_PROMPT).toContain('NIEMALS aussprechen');
    expect(PLATFORM_BASELINE_PROMPT).toContain('Tool-Namen');
    expect(PLATFORM_BASELINE_PROMPT).toContain('end_call');
  });
});
