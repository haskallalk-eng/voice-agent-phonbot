import { describe, expect, it } from 'vitest';

import { buildCurrentDateDynamicVariables } from '../time-context.js';

describe('current date dynamic variables', () => {
  it('provides German current, tomorrow, day-after-tomorrow, and lookup context', () => {
    const vars = buildCurrentDateDynamicVariables(new Date('2026-05-16T08:34:00.000Z'));

    expect(vars.current_date_iso).toBe('2026-05-16');
    expect(vars.current_date_de).toBe('16.05.2026');
    expect(vars.current_weekday_de).toBe('Samstag');
    expect(vars.current_time_de).toBe('10:34');
    expect(vars.tomorrow_date_iso).toBe('2026-05-17');
    expect(vars.tomorrow_weekday_de).toBe('Sonntag');
    expect(vars.day_after_tomorrow_date_iso).toBe('2026-05-18');
    expect(vars.day_after_tomorrow_weekday_de).toBe('Montag');
    expect(vars.date_lookup_de).toContain('heute: Samstag, 16.05.2026 (2026-05-16)');
    expect(vars.date_lookup_de).toContain('in 13 Tagen: Freitag, 29.05.2026 (2026-05-29)');
  });
});
