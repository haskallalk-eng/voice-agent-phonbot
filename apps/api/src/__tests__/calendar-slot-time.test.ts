import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  pool: null,
}));

vi.mock('../redis.js', () => ({
  redis: null,
}));

vi.mock('../logger.js', () => {
  const noop = () => {};
  return {
    log: { info: noop, warn: noop, error: noop, debug: noop },
    logBg: () => noop,
  };
});

const { parseSlotTime, bookSlot, findFreeSlots, formatSpokenClockTime, formatSpokenSlotLabel } = await import('../calendar.js');

function berlinTime(date: Date | null): string {
  expect(date).not.toBeNull();
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date!);
}

describe('calendar slot time parsing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps explicit UTC instants as the intended Berlin wall-clock time', () => {
    expect(berlinTime(parseSlotTime('2026-05-11T07:00:00.000Z'))).toBe('09:00');
  });

  it('treats timezone-less ISO input as Berlin local wall-clock time', () => {
    expect(berlinTime(parseSlotTime('2026-05-11T09:00:00'))).toBe('09:00');
  });

  it('keeps explicit "heute" times in the past so booking can reject them', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T10:00:00.000Z')); // 12:00 Berlin

    const parsed = parseSlotTime('heute um 08:00');

    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBeLessThan(Date.now());
  });

  it('treats "naechsten Donnerstag" as the following week, not tomorrow', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T10:00:00.000Z')); // Mittwoch in Berlin

    const parsed = parseSlotTime('naechsten Donnerstag um 09:00');

    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(parsed!)).toBe('2026-05-14');
    expect(berlinTime(parsed)).toBe('09:00');
  });

  it('rejects absolute German dates in the past before any booking side effect', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T10:00:00.000Z'));

    const result = await bookSlot('org-1', {
      customerName: 'Max Mustermann',
      customerPhone: '+4917612345678',
      time: '18.04.2025 18 Uhr',
      service: 'Beratung',
    });

    expect(result).toEqual({ ok: false, error: 'PAST_SLOT' });
  });

  it('does not return slots for a requested past date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T10:00:00.000Z'));

    const result = await findFreeSlots('org-1', {
      date: '18.04.2025',
      service: 'Beratung',
    });

    expect(result).toEqual({ slots: [], source: 'past-date' });
  });

  it('parses speech-friendly German calendar slot labels', () => {
    const parsed = parseSlotTime('Dienstag 12. Mai 2026 um 11 Uhr 15');
    expect(berlinTime(parsed)).toBe('11:15');
    expect(new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(parsed!)).toBe('12.05.2026');
  });

  it('normalizes appointment times for German speech', () => {
    expect(formatSpokenClockTime('09:00')).toBe('neun Uhr');
    expect(formatSpokenClockTime('10:05')).toBe('zehn Uhr null fünf');
    expect(formatSpokenClockTime('11:15')).toBe('elf Uhr fünfzehn');
    expect(formatSpokenClockTime('14:30')).toBe('vierzehn Uhr dreißig');
  });

  it('builds spoken slot labels without technical dates or missing minute zeros', () => {
    expect(formatSpokenSlotLabel('Dienstag 12. Mai 2026 um 10 Uhr 05')).toBe(
      'Dienstag, zwölfter Mai um zehn Uhr null fünf',
    );
    expect(formatSpokenSlotLabel('Dienstag 12. Mai 2026 um 09 Uhr')).toBe(
      'Dienstag, zwölfter Mai um neun Uhr',
    );
    expect(formatSpokenSlotLabel('Mo-Fr 09:00-18:00')).toBe('Mo-Fr neun Uhr bis achtzehn Uhr');
  });
});
