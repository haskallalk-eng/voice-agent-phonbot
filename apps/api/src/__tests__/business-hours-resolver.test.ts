import { describe, expect, it } from 'vitest';
import {
  resolveBusinessHours,
  type BusinessHoursSource,
} from '../business-hours-resolver.js';

const baseSource: BusinessHoursSource = {
  sourceVersionId: 'hours-v1',
  sourceVersionHash: 'hash-v1',
  sourceStatus: 'approved_current',
  timezone: 'Europe/Berlin',
  verifiedAt: '2026-05-01T00:00:00.000Z',
  expiresAt: '2026-12-31T23:00:00.000Z',
  weeklyHours: [
    { weekday: 1, intervals: [{ start: '09:00', end: '18:00' }] },
    { weekday: 2, intervals: [{ start: '09:00', end: '18:00' }] },
    { weekday: 3, intervals: [{ start: '09:00', end: '18:00' }] },
    { weekday: 4, intervals: [{ start: '09:00', end: '18:00' }] },
    { weekday: 5, intervals: [{ start: '09:00', end: '18:00' }] },
  ],
  specialHours: [],
  holidays: [],
  closures: [],
};

describe('business hours resolver contract', () => {
  it('answers open now from approved current Europe/Berlin source-versioned evidence', () => {
    const result = resolveBusinessHours({
      query: 'open_now',
      nowIso: '2026-05-04T08:30:00.000Z',
      source: baseSource,
    });

    expect(result).toMatchObject({
      answerable: true,
      status: 'open',
      localDate: '2026-05-04',
      sourceVersionId: 'hours-v1',
      sourceVersionHash: 'hash-v1',
      usedStaticPinnedContext: false,
    });
    expect(result.evidenceKind).toBe('weekly_hours');
  });

  it('answers open tomorrow using tomorrow in Europe/Berlin, not UTC or pinned text', () => {
    const result = resolveBusinessHours({
      query: 'open_tomorrow',
      nowIso: '2026-05-04T21:30:00.000Z',
      source: baseSource,
      staticPinnedOpeningHoursText: 'Immer offen',
    });

    expect(result.answerable).toBe(true);
    expect(result.localDate).toBe('2026-05-05');
    expect(result.status).toBe('open');
    expect(result.usedStaticPinnedContext).toBe(false);
  });

  it('treats open tomorrow as any valid interval tomorrow, not the current clock time tomorrow', () => {
    const result = resolveBusinessHours({
      query: 'open_tomorrow',
      nowIso: '2026-05-04T21:30:00.000Z',
      source: {
        ...baseSource,
        weeklyHours: [
          { weekday: 2, intervals: [{ start: '07:00', end: '08:00' }] },
        ],
      },
    });

    expect(result.localDate).toBe('2026-05-05');
    expect(result.status).toBe('open');
    expect(result.evidenceKind).toBe('weekly_hours');
  });

  it('lets special opening hours override the weekly plan', () => {
    const result = resolveBusinessHours({
      query: 'open_now',
      nowIso: '2026-05-04T07:30:00.000Z',
      source: {
        ...baseSource,
        specialHours: [
          {
            date: '2026-05-04',
            intervals: [{ start: '12:00', end: '14:00' }],
            reason: 'Team-Schulung',
          },
        ],
      },
    });

    expect(result.status).toBe('closed');
    expect(result.evidenceKind).toBe('special_hours');
    expect(result.reason).toContain('Team-Schulung');
  });

  it('treats holidays and Betriebsferien as closed with explicit evidence', () => {
    const holiday = resolveBusinessHours({
      query: 'open_now',
      nowIso: '2026-05-14T08:00:00.000Z',
      source: {
        ...baseSource,
        holidays: [{ date: '2026-05-14', name: 'Christi Himmelfahrt', closed: true }],
      },
    });
    expect(holiday.status).toBe('closed');
    expect(holiday.evidenceKind).toBe('holiday');

    const closure = resolveBusinessHours({
      query: 'open_now',
      nowIso: '2026-08-10T08:00:00.000Z',
      source: {
        ...baseSource,
        closures: [{ startDate: '2026-08-01', endDate: '2026-08-15', reason: 'Betriebsferien' }],
      },
    });
    expect(closure.status).toBe('closed');
    expect(closure.evidenceKind).toBe('betriebsferien');
  });

  it('fails closed when source evidence is missing, stale, unapproved, or not Europe/Berlin', () => {
    expect(resolveBusinessHours({
      query: 'open_now',
      nowIso: '2026-05-04T08:30:00.000Z',
      source: null,
      staticPinnedOpeningHoursText: 'Mo-Fr 09:00-18:00',
    })).toMatchObject({
      answerable: false,
      blocker: 'CURRENT_SOURCE_VERSION_REQUIRED',
      usedStaticPinnedContext: false,
    });

    expect(resolveBusinessHours({
      query: 'open_now',
      nowIso: '2027-01-01T08:30:00.000Z',
      source: baseSource,
    })).toMatchObject({ answerable: false, blocker: 'SOURCE_EXPIRED' });

    expect(resolveBusinessHours({
      query: 'open_now',
      nowIso: '2026-05-04T08:30:00.000Z',
      source: { ...baseSource, sourceStatus: 'draft' },
    })).toMatchObject({ answerable: false, blocker: 'SOURCE_NOT_APPROVED_CURRENT' });

    expect(resolveBusinessHours({
      query: 'open_now',
      nowIso: '2026-05-04T08:30:00.000Z',
      source: { ...baseSource, timezone: 'UTC' as never },
    })).toMatchObject({ answerable: false, blocker: 'EUROPE_BERLIN_TIMEZONE_REQUIRED' });
  });
});
