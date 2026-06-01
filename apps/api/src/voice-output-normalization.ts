export type VoiceOutputMode = 'voice' | 'web';

export type GermanVoiceNormalizationKind =
  | 'weekday_range'
  | 'weekday'
  | 'opening_hours'
  | 'time'
  | 'date'
  | 'price'
  | 'phone'
  | 'email'
  | 'url'
  | 'address'
  | 'acronym'
  | 'name_review';

export type GermanVoiceNormalization = {
  kind: GermanVoiceNormalizationKind;
  written: string;
  spoken: string;
  factPreserved: boolean;
  reviewRequired?: boolean;
};

export type GermanVoiceNormalizedText = {
  mode: VoiceOutputMode;
  writtenText: string;
  spokenText: string;
  transformations: GermanVoiceNormalization[];
  reviewRequired: boolean;
};

const WEEKDAYS: Record<string, string> = {
  Mo: 'Montag',
  Di: 'Dienstag',
  Mi: 'Mittwoch',
  Do: 'Donnerstag',
  Fr: 'Freitag',
  Sa: 'Samstag',
  So: 'Sonntag',
};

const MONTHS: Record<string, string> = {
  '01': 'Januar',
  '02': 'Februar',
  '03': 'Maerz',
  '04': 'April',
  '05': 'Mai',
  '06': 'Juni',
  '07': 'Juli',
  '08': 'August',
  '09': 'September',
  '10': 'Oktober',
  '11': 'November',
  '12': 'Dezember',
};

const NUMBER_WORDS = [
  'null',
  'eins',
  'zwei',
  'drei',
  'vier',
  'fuenf',
  'sechs',
  'sieben',
  'acht',
  'neun',
  'zehn',
  'elf',
  'zwoelf',
  'dreizehn',
  'vierzehn',
  'fuenfzehn',
  'sechzehn',
  'siebzehn',
  'achtzehn',
  'neunzehn',
] as const;

const TENS: Record<number, string> = {
  20: 'zwanzig',
  30: 'dreissig',
  40: 'vierzig',
  50: 'fuenfzig',
  60: 'sechzig',
  70: 'siebzig',
  80: 'achtzig',
  90: 'neunzig',
};

const ORDINALS: Record<number, string> = {
  1: 'erster',
  2: 'zweiter',
  3: 'dritter',
  4: 'vierter',
  5: 'fuenfter',
  6: 'sechster',
  7: 'siebter',
  8: 'achter',
  9: 'neunter',
  10: 'zehnter',
  11: 'elfter',
  12: 'zwoelfter',
  13: 'dreizehnter',
  14: 'vierzehnter',
  15: 'fuenfzehnter',
  16: 'sechzehnter',
  17: 'siebzehnter',
  18: 'achtzehnter',
  19: 'neunzehnter',
  20: 'zwanzigster',
  21: 'einundzwanzigster',
  22: 'zweiundzwanzigster',
  23: 'dreiundzwanzigster',
  24: 'vierundzwanzigster',
  25: 'fuenfundzwanzigster',
  26: 'sechsundzwanzigster',
  27: 'siebenundzwanzigster',
  28: 'achtundzwanzigster',
  29: 'neunundzwanzigster',
  30: 'dreissigster',
  31: 'einunddreissigster',
};

function numberWord(value: number): string {
  if (value >= 0 && value < NUMBER_WORDS.length) return NUMBER_WORDS[value]!;
  if (value < 100) {
    const ten = Math.floor(value / 10) * 10;
    const rest = value % 10;
    if (rest === 0) return TENS[ten] ?? String(value);
    const unit = rest === 1 ? 'ein' : numberWord(rest);
    return `${unit}und${TENS[ten] ?? String(ten)}`;
  }
  if (value >= 2000 && value < 2100) return `zweitausend${value === 2000 ? '' : numberWord(value - 2000)}`;
  return String(value);
}

function clockWord(hourText: string, minuteText = '00', options: { omitHourSuffixWhenFullHour?: boolean } = {}): string {
  const hour = Number(hourText);
  const minute = Number(minuteText || '00');
  const hourWord = numberWord(hour);
  if (minute === 0) return options.omitHourSuffixWhenFullHour ? hourWord : `${hourWord} Uhr`;
  const minuteWord = numberWord(minute);
  return `${hourWord} Uhr ${minute < 10 ? `null ${minuteWord}` : minuteWord}`;
}

function digitsSpoken(value: string): string {
  return value
    .replace(/[^\d+]/g, '')
    .split('')
    .map((char) => (char === '+' ? 'plus' : numberWord(Number(char))))
    .join(' ');
}

function domainSpoken(value: string): string {
  return value
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\./g, ' punkt ')
    .replace(/\//g, ' slash ')
    .replace(/-/g, ' minus ')
    .replace(/\s+/g, ' ')
    .trim();
}

function replaceWithTracking(
  text: string,
  pattern: RegExp,
  kind: GermanVoiceNormalizationKind,
  transform: (...args: string[]) => string,
  transformations: GermanVoiceNormalization[],
): string {
  return text.replace(pattern, (...args: unknown[]) => {
    const match = String(args[0]);
    const captures = args.slice(1, -2).map((value) => value == null ? '' : String(value));
    const groups = captures.length > 0 ? captures : [match];
    const spoken = transform(...groups);
    transformations.push({ kind, written: match, spoken, factPreserved: true });
    return spoken;
  });
}

export function normalizeGermanVoiceOutput(input: {
  text: string;
  mode: VoiceOutputMode;
  reviewNames?: string[];
}): GermanVoiceNormalizedText {
  const writtenText = input.text;
  if (input.mode === 'web') {
    return { mode: input.mode, writtenText, spokenText: writtenText, transformations: [], reviewRequired: false };
  }

  const transformations: GermanVoiceNormalization[] = [];
  let spokenText = writtenText;

  spokenText = replaceWithTracking(
    spokenText,
    /\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    'email',
    (local, domain) => `${local.replace(/\./g, ' punkt ')} at ${domain.replace(/\./g, ' punkt ')}`,
    transformations,
  );
  spokenText = replaceWithTracking(
    spokenText,
    /\bhttps?:\/\/[^\s,;]+|\bwww\.[^\s,;]+/gi,
    'url',
    (url) => domainSpoken(url),
    transformations,
  );
  spokenText = replaceWithTracking(
    spokenText,
    /\b(\d{1,2})[.](\d{1,2})[.](20\d{2})\b/g,
    'date',
    (day, month, year) => `${ORDINALS[Number(day)] ?? `${numberWord(Number(day))}ter`} ${MONTHS[month.padStart(2, '0')] ?? month} ${numberWord(Number(year))}`,
    transformations,
  );
  spokenText = replaceWithTracking(
    spokenText,
    /\b(\d{1,4})(?:[,.](\d{2}))?\s*(?:EUR|Euro|€)\b/g,
    'price',
    (euro, cents = '') => cents ? `${numberWord(Number(euro))} Euro ${numberWord(Number(cents))}` : `${numberWord(Number(euro))} Euro`,
    transformations,
  );
  spokenText = replaceWithTracking(
    spokenText,
    /\b(Mo|Di|Mi|Do|Fr|Sa|So)\s*[-–]\s*(Mo|Di|Mi|Do|Fr|Sa|So)\b/g,
    'weekday_range',
    (from, to) => `${WEEKDAYS[from] ?? from} bis ${WEEKDAYS[to] ?? to}`,
    transformations,
  );
  spokenText = replaceWithTracking(
    spokenText,
    /\b(Mo|Di|Mi|Do|Fr|Sa|So)\b/g,
    'weekday',
    (day) => WEEKDAYS[day] ?? day,
    transformations,
  );
  spokenText = replaceWithTracking(
    spokenText,
    /\b(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*Uhr\b/g,
    'opening_hours',
    (h1, m1 = '00', h2, m2 = '00') => `von ${clockWord(h1, m1, { omitHourSuffixWhenFullHour: true })} bis ${clockWord(h2, m2)}`,
    transformations,
  );
  spokenText = replaceWithTracking(
    spokenText,
    /\b(\d{1,2}):(\d{2})\b/g,
    'time',
    (hour, minute) => clockWord(hour, minute),
    transformations,
  );
  spokenText = replaceWithTracking(
    spokenText,
    /(\+?\d[\d\s()./-]{6,}\d)/g,
    'phone',
    (phone) => digitsSpoken(phone),
    transformations,
  );
  spokenText = replaceWithTracking(
    spokenText,
    /\b([A-ZÄÖÜa-zäöü][\p{L}.-]*(?:str\.|strasse|straße|weg|platz|allee|gasse|ring))\s+(\d+[a-z]?)\b/giu,
    'address',
    (street, houseNo) => `${street.replace(/str\.$/i, 'strasse').replace(/straße/gi, 'strasse')} ${houseNo.replace(/\d+/, (n) => numberWord(Number(n)))}`,
    transformations,
  );
  spokenText = replaceWithTracking(
    spokenText,
    /\b(GmbH)\b/g,
    'acronym',
    () => 'G M B H',
    transformations,
  );
  spokenText = replaceWithTracking(
    spokenText,
    /\b([A-ZÄÖÜ]{2,6})\b/g,
    'acronym',
    (word) => word.split('').join(' '),
    transformations,
  );

  for (const name of input.reviewNames ?? []) {
    if (!name.trim()) continue;
    const regex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    if (regex.test(writtenText)) {
      transformations.push({
        kind: 'name_review',
        written: name,
        spoken: name,
        factPreserved: true,
        reviewRequired: true,
      });
    }
  }

  return {
    mode: input.mode,
    writtenText,
    spokenText: spokenText.replace(/\s+/g, ' ').trim(),
    transformations,
    reviewRequired: transformations.some((item) => item.reviewRequired === true),
  };
}
