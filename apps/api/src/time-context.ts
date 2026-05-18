const BERLIN_TIME_ZONE = 'Europe/Berlin';

type DateParts = {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
  weekday: string;
};

export type CurrentDateDynamicVariables = Record<string, string> & {
  current_date_iso: string;
  current_date_de: string;
  current_weekday_de: string;
  current_time_de: string;
  current_year: string;
  timezone: string;
  tomorrow_date_iso: string;
  tomorrow_date_de: string;
  tomorrow_weekday_de: string;
  day_after_tomorrow_date_iso: string;
  day_after_tomorrow_date_de: string;
  day_after_tomorrow_weekday_de: string;
  date_lookup_de: string;
};

function partsFor(date: Date): DateParts {
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: BERLIN_TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    day: map.day ?? '01',
    month: map.month ?? '01',
    year: map.year ?? '1970',
    hour: map.hour === '24' ? '00' : (map.hour ?? '00'),
    minute: map.minute ?? '00',
    weekday: map.weekday ?? '',
  };
}

function isoDate(parts: DateParts): string {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function deDate(parts: DateParts): string {
  return `${parts.day}.${parts.month}.${parts.year}`;
}

function addLocalCalendarDays(parts: DateParts, days: number): Date {
  return new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day) + days,
    12,
    0,
    0,
  ));
}

function dateLookup(nowParts: DateParts, days: number): string {
  return Array.from({ length: days }, (_, index) => {
    const parts = partsFor(addLocalCalendarDays(nowParts, index));
    const label = index === 0
      ? 'heute'
      : index === 1
        ? 'morgen'
        : index === 2
          ? 'uebermorgen'
          : `in ${index} Tagen`;
    return `${label}: ${parts.weekday}, ${deDate(parts)} (${isoDate(parts)})`;
  }).join(' | ');
}

export function buildCurrentDateDynamicVariables(now = new Date()): CurrentDateDynamicVariables {
  const current = partsFor(now);
  const tomorrow = partsFor(addLocalCalendarDays(current, 1));
  const dayAfterTomorrow = partsFor(addLocalCalendarDays(current, 2));

  return {
    current_date_iso: isoDate(current),
    current_date_de: deDate(current),
    current_weekday_de: current.weekday,
    current_time_de: `${current.hour}:${current.minute}`,
    current_year: current.year,
    timezone: BERLIN_TIME_ZONE,
    tomorrow_date_iso: isoDate(tomorrow),
    tomorrow_date_de: deDate(tomorrow),
    tomorrow_weekday_de: tomorrow.weekday,
    day_after_tomorrow_date_iso: isoDate(dayAfterTomorrow),
    day_after_tomorrow_date_de: deDate(dayAfterTomorrow),
    day_after_tomorrow_weekday_de: dayAfterTomorrow.weekday,
    date_lookup_de: dateLookup(current, 14),
  };
}
