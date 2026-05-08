import { describe, expect, it, vi } from 'vitest';

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

const { parseSlotTime } = await import('../calendar.js');

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
  it('keeps explicit UTC instants as the intended Berlin wall-clock time', () => {
    expect(berlinTime(parseSlotTime('2026-05-11T07:00:00.000Z'))).toBe('09:00');
  });

  it('treats timezone-less ISO input as Berlin local wall-clock time', () => {
    expect(berlinTime(parseSlotTime('2026-05-11T09:00:00'))).toBe('09:00');
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
});
