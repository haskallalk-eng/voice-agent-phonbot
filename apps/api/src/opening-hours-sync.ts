/**
 * Two-way sync between agent_configs.data.openingHours (free-text) and
 * chipy_schedules.schedule (JSONB keyed by weekday number).
 *
 * Both represent the same fact — when the customer changes one, the other
 * must follow. The canonical format used by buildAgentInstructions + the
 * front-end OpeningHoursEditor is "Mo-Fr 09:00-18:00, Sa 10:00-14:00".
 *
 * Day-key mapping: JS Date.getDay() convention → 0=Sun, 1=Mon … 6=Sat.
 * CalendarPage.tsx DEFAULT_SCHEDULE uses these exact string keys.
 */

import { pool } from './db.js';

type Day = 'Mo' | 'Di' | 'Mi' | 'Do' | 'Fr' | 'Sa' | 'So';
const DAY_ORDER: Day[] = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DAY_TO_NUM: Record<Day, string> = { Mo: '1', Di: '2', Mi: '3', Do: '4', Fr: '5', Sa: '6', So: '0' };
const NUM_TO_DAY: Record<string, Day> = { '1': 'Mo', '2': 'Di', '3': 'Mi', '4': 'Do', '5': 'Fr', '6': 'Sa', '0': 'So' };

type DayState = { enabled: boolean; start: string; end: string };
type ChipySchedule = Record<string, DayState>;

const DEFAULT_DAY: DayState = { enabled: false, start: '09:00', end: '17:00' };

function daysInToken(tok: string): Day[] | null {
  const clean = tok.trim().replace(/\s+/g, '');
  const m = /^(Mo|Di|Mi|Do|Fr|Sa|So)(?:[-–](Mo|Di|Mi|Do|Fr|Sa|So))?$/.exec(clean);
  if (!m) return null;
  const a = m[1] as Day;
  const b = (m[2] ?? m[1]) as Day;
  const ai = DAY_ORDER.indexOf(a);
  const bi = DAY_ORDER.indexOf(b);
  if (ai < 0 || bi < 0 || bi < ai) return null;
  return DAY_ORDER.slice(ai, bi + 1);
}

function normaliseTime(t: string): string | null {
  const clean = t.trim().replace(/\s+/g, '').replace('Uhr', '');
  const [h, m] = clean.split(':');
  if (!h) return null;
  const hh = parseInt(h, 10);
  if (!Number.isFinite(hh) || hh < 0 || hh > 24) return null;
  const mm = m ? parseInt(m, 10) : 0;
  if (!Number.isFinite(mm) || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Parse the free-text openingHours into a ChipySchedule. Returns null when
 * the string can't be structured (e.g. "nach Vereinbarung") — caller should
 * leave the existing chipy_schedules row untouched in that case.
 */
export function openingHoursToChipySchedule(raw: string | null | undefined): ChipySchedule | null {
  if (!raw || !raw.trim()) return null;
  const result: ChipySchedule = {
    '0': { ...DEFAULT_DAY }, '1': { ...DEFAULT_DAY }, '2': { ...DEFAULT_DAY },
    '3': { ...DEFAULT_DAY }, '4': { ...DEFAULT_DAY }, '5': { ...DEFAULT_DAY }, '6': { ...DEFAULT_DAY },
  };
  const segments = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;

  for (const seg of segments) {
    const spaceIdx = seg.search(/\s/);
    if (spaceIdx < 0) return null;
    const dayTok = seg.slice(0, spaceIdx);
    const rest = seg.slice(spaceIdx + 1).trim();
    const days = daysInToken(dayTok);
    if (!days) return null;
    if (/geschlossen|zu|closed/i.test(rest)) {
      for (const d of days) result[DAY_TO_NUM[d]] = { ...DEFAULT_DAY, enabled: false };
      continue;
    }
    const m = /^(\d{1,2}(?::\d{2})?)\s*[-–]\s*(\d{1,2}(?::\d{2})?)/.exec(rest);
    if (!m) return null;
    const from = normaliseTime(m[1] ?? '');
    const to = normaliseTime(m[2] ?? '');
    if (!from || !to) return null;
    for (const d of days) result[DAY_TO_NUM[d]] = { enabled: true, start: from, end: to };
  }
  return result;
}

/**
 * Serialize a ChipySchedule back to the canonical "Mo-Fr 09:00-18:00, Sa
 * 10:00-14:00" form. Collapses consecutive days with identical hours.
 */
export function chipyScheduleToOpeningHours(schedule: ChipySchedule): string {
  const groups: Array<{ days: Day[]; label: string }> = [];
  let i = 0;
  while (i < DAY_ORDER.length) {
    const d = DAY_ORDER[i]!;
    const cur = schedule[DAY_TO_NUM[d]] ?? DEFAULT_DAY;
    let j = i;
    while (j + 1 < DAY_ORDER.length) {
      const nd = DAY_ORDER[j + 1]!;
      const n = schedule[DAY_TO_NUM[nd]] ?? DEFAULT_DAY;
      if (n.enabled !== cur.enabled || n.start !== cur.start || n.end !== cur.end) break;
      j++;
    }
    const label = cur.enabled ? `${cur.start}-${cur.end}` : 'geschlossen';
    const days = DAY_ORDER.slice(i, j + 1);
    groups.push({ days, label });
    i = j + 1;
  }
  return groups
    .map(({ days, label }) => {
      const dayRange = days.length === 1 ? days[0]! : `${days[0]}-${days[days.length - 1]}`;
      return `${dayRange} ${label}`;
    })
    .join(', ');
}

/**
 * Sync direction: agent_configs.data.openingHours → chipy_schedules.
 * Call this after a successful writeConfig. No-op when orgId is missing
 * (demo tenants without an org) or when the string can't be parsed into
 * a structured week ("nach Vereinbarung", etc.).
 *
 * Idempotent: reads current chipy schedule first and skips the write if
 * the content already matches — this is the loop-breaker so the reverse
 * sync doesn't bounce back.
 */
export async function syncOpeningHoursToChipy(orgId: string | undefined, openingHours: string | null | undefined): Promise<void> {
  if (!orgId || !pool) return;
  const parsed = openingHoursToChipySchedule(openingHours);
  if (!parsed) return;
  const current = await pool.query<{ schedule: ChipySchedule }>(
    'SELECT schedule FROM chipy_schedules WHERE org_id = $1',
    [orgId],
  ).catch(() => ({ rows: [] as { schedule: ChipySchedule }[] }));
  if (current.rows[0] && JSON.stringify(current.rows[0].schedule) === JSON.stringify(parsed)) return;
  await pool.query(
    `INSERT INTO chipy_schedules (org_id, schedule, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (org_id) DO UPDATE SET schedule = EXCLUDED.schedule, updated_at = now()`,
    [orgId, JSON.stringify(parsed)],
  ).catch(() => {/* non-fatal — the canonical copy stays on agent_configs */});
}

/**
 * Sync direction: chipy_schedules.schedule → agent_configs.data.openingHours.
 * Call this after a successful PUT /calendar/chipy. Same loop-breaker via
 * string-equality check before writing.
 */
export async function syncChipyToOpeningHours(orgId: string | undefined, schedule: ChipySchedule | null | undefined): Promise<void> {
  if (!orgId || !pool || !schedule) return;
  const canonical = chipyScheduleToOpeningHours(schedule);
  const current = await pool.query<{ oh: string | null }>(
    `SELECT data->>'openingHours' AS oh FROM agent_configs WHERE org_id = $1`,
    [orgId],
  ).catch(() => ({ rows: [] as { oh: string | null }[] }));
  const rows = current.rows ?? [];
  if (rows.length === 0) return; // no agent config yet
  if ((rows[0]!.oh ?? '') === canonical) return;
  await pool.query(
    `UPDATE agent_configs
     SET data = jsonb_set(data, '{openingHours}', to_jsonb($2::text)),
         updated_at = now()
     WHERE org_id = $1`,
    [orgId, canonical],
  ).catch(() => {/* non-fatal */});
}
