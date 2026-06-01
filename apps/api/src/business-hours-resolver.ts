export type BusinessHoursTimezone = 'Europe/Berlin';

export type BusinessHoursSourceStatus = 'approved_current' | 'draft' | 'expired' | 'rejected' | 'archived';

export type BusinessHoursInterval = {
  start: string;
  end: string;
};

export type BusinessHoursWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type BusinessHoursSource = {
  sourceVersionId: string;
  sourceVersionHash: string;
  sourceStatus: BusinessHoursSourceStatus;
  timezone: BusinessHoursTimezone;
  verifiedAt: string;
  expiresAt: string;
  weeklyHours: Array<{
    weekday: BusinessHoursWeekday;
    intervals: BusinessHoursInterval[];
  }>;
  specialHours: Array<{
    date: string;
    intervals: BusinessHoursInterval[];
    reason: string;
  }>;
  holidays: Array<{
    date: string;
    name: string;
    closed: boolean;
  }>;
  closures: Array<{
    startDate: string;
    endDate: string;
    reason: string;
  }>;
};

export type BusinessHoursQuery = 'open_now' | 'open_tomorrow';

export type BusinessHoursEvidenceKind =
  | 'weekly_hours'
  | 'special_hours'
  | 'holiday'
  | 'betriebsferien';

export type BusinessHoursBlocker =
  | 'CURRENT_SOURCE_VERSION_REQUIRED'
  | 'SOURCE_NOT_APPROVED_CURRENT'
  | 'SOURCE_EXPIRED'
  | 'EUROPE_BERLIN_TIMEZONE_REQUIRED'
  | 'INVALID_NOW'
  | 'OPENING_HOURS_NOT_FOUND';

export type BusinessHoursResolution = {
  answerable: boolean;
  status: 'open' | 'closed' | 'unknown';
  query: BusinessHoursQuery;
  localDate: string | null;
  localTime: string | null;
  sourceVersionId: string | null;
  sourceVersionHash: string | null;
  evidenceKind: BusinessHoursEvidenceKind | null;
  reason: string;
  usedStaticPinnedContext: false;
  blocker?: BusinessHoursBlocker;
};

export type ResolveBusinessHoursInput = {
  query: BusinessHoursQuery;
  nowIso: string;
  source: BusinessHoursSource | null;
  staticPinnedOpeningHoursText?: string | null;
};

type BerlinDateParts = {
  date: string;
  time: string;
  minutes: number;
  weekday: BusinessHoursWeekday;
};

const BERLIN_TIMEZONE: BusinessHoursTimezone = 'Europe/Berlin';
const WEEKDAY: Record<string, BusinessHoursWeekday> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const berlinFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BERLIN_TIMEZONE,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function blank(
  query: BusinessHoursQuery,
  blocker: BusinessHoursBlocker,
  reason: string,
  parts?: Partial<Pick<BusinessHoursResolution, 'localDate' | 'localTime'>>,
): BusinessHoursResolution {
  return {
    answerable: false,
    status: 'unknown',
    query,
    localDate: parts?.localDate ?? null,
    localTime: parts?.localTime ?? null,
    sourceVersionId: null,
    sourceVersionHash: null,
    evidenceKind: null,
    reason,
    usedStaticPinnedContext: false,
    blocker,
  };
}

function parseLocalParts(date: Date): BerlinDateParts | null {
  const values = Object.fromEntries(
    berlinFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const year = values.year;
  const month = values.month;
  const day = values.day;
  const hour = values.hour;
  const minute = values.minute;
  const weekday = values.weekday ? WEEKDAY[values.weekday] : undefined;
  if (!year || !month || !day || !hour || !minute || !weekday) return null;
  const hh = Number(hour);
  const mm = Number(minute);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    minutes: hh * 60 + mm,
    weekday,
  };
}

function tomorrow(parts: BerlinDateParts): BerlinDateParts | null {
  const [year, month, day] = parts.date.split('-').map(Number);
  if (!year || !month || !day) return null;
  return parseLocalParts(new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0)));
}

function minutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function containsMinute(intervals: BusinessHoursInterval[], localMinutes: number): boolean {
  return intervals.some((interval) => {
    const start = minutes(interval.start);
    const end = minutes(interval.end);
    if (start === null || end === null || end <= start) return false;
    return localMinutes >= start && localMinutes < end;
  });
}

function hasValidInterval(intervals: BusinessHoursInterval[]): boolean {
  return intervals.some((interval) => {
    const start = minutes(interval.start);
    const end = minutes(interval.end);
    return start !== null && end !== null && end > start;
  });
}

function isExpired(source: BusinessHoursSource, now: Date): boolean {
  const expires = new Date(source.expiresAt);
  return Number.isNaN(expires.getTime()) || expires.getTime() <= now.getTime();
}

function closedByRange(date: string, source: BusinessHoursSource): { evidenceKind: 'betriebsferien'; reason: string } | null {
  const closure = source.closures.find((item) => date >= item.startDate && date <= item.endDate);
  return closure ? { evidenceKind: 'betriebsferien', reason: closure.reason } : null;
}

function resolveForDate(
  input: ResolveBusinessHoursInput,
  source: BusinessHoursSource,
  target: BerlinDateParts,
): BusinessHoursResolution {
  const base = {
    query: input.query,
    localDate: target.date,
    localTime: target.time,
    sourceVersionId: source.sourceVersionId,
    sourceVersionHash: source.sourceVersionHash,
    usedStaticPinnedContext: false as const,
  };

  const closure = closedByRange(target.date, source);
  if (closure) {
    return {
      ...base,
      answerable: true,
      status: 'closed',
      evidenceKind: closure.evidenceKind,
      reason: closure.reason,
    };
  }

  const holiday = source.holidays.find((item) => item.date === target.date && item.closed);
  if (holiday) {
    return {
      ...base,
      answerable: true,
      status: 'closed',
      evidenceKind: 'holiday',
      reason: holiday.name,
    };
  }

  const special = source.specialHours.find((item) => item.date === target.date);
  if (special) {
    return {
      ...base,
      answerable: true,
      status: input.query === 'open_tomorrow'
        ? (hasValidInterval(special.intervals) ? 'open' : 'closed')
        : (containsMinute(special.intervals, target.minutes) ? 'open' : 'closed'),
      evidenceKind: 'special_hours',
      reason: special.reason,
    };
  }

  const weekly = source.weeklyHours.find((item) => item.weekday === target.weekday);
  if (!weekly) {
    return {
      ...base,
      answerable: true,
      status: 'closed',
      evidenceKind: 'weekly_hours',
      reason: 'No weekly opening interval for this day.',
    };
  }

  return {
    ...base,
    answerable: true,
    status: input.query === 'open_tomorrow'
      ? (hasValidInterval(weekly.intervals) ? 'open' : 'closed')
      : (containsMinute(weekly.intervals, target.minutes) ? 'open' : 'closed'),
    evidenceKind: 'weekly_hours',
    reason: 'Resolved from approved current weekly opening hours.',
  };
}

export function resolveBusinessHours(input: ResolveBusinessHoursInput): BusinessHoursResolution {
  const now = new Date(input.nowIso);
  if (Number.isNaN(now.getTime())) return blank(input.query, 'INVALID_NOW', 'Current time is invalid.');
  const nowParts = parseLocalParts(now);
  if (!nowParts) return blank(input.query, 'INVALID_NOW', 'Current time could not be converted to Europe/Berlin.');

  if (!input.source) {
    return blank(input.query, 'CURRENT_SOURCE_VERSION_REQUIRED', 'Opening-hours answers require current source-versioned evidence.', {
      localDate: nowParts.date,
      localTime: nowParts.time,
    });
  }
  if (input.source.timezone !== BERLIN_TIMEZONE) {
    return blank(input.query, 'EUROPE_BERLIN_TIMEZONE_REQUIRED', 'Opening-hours resolver requires Europe/Berlin timezone.', {
      localDate: nowParts.date,
      localTime: nowParts.time,
    });
  }
  if (input.source.sourceStatus !== 'approved_current') {
    return blank(input.query, 'SOURCE_NOT_APPROVED_CURRENT', 'Opening-hours source is not approved/current.', {
      localDate: nowParts.date,
      localTime: nowParts.time,
    });
  }
  if (!input.source.sourceVersionId || !input.source.sourceVersionHash) {
    return blank(input.query, 'CURRENT_SOURCE_VERSION_REQUIRED', 'Opening-hours source version metadata is missing.', {
      localDate: nowParts.date,
      localTime: nowParts.time,
    });
  }
  if (isExpired(input.source, now)) {
    return blank(input.query, 'SOURCE_EXPIRED', 'Opening-hours source is expired.', {
      localDate: nowParts.date,
      localTime: nowParts.time,
    });
  }

  const target = input.query === 'open_tomorrow' ? tomorrow(nowParts) : nowParts;
  if (!target) return blank(input.query, 'INVALID_NOW', 'Target date could not be resolved.');
  return resolveForDate(input, input.source, target);
}
