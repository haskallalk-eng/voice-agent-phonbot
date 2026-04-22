import React, { useMemo, useState } from 'react';

/**
 * Structured opening-hours editor.
 *
 * Value is a free-text string on the config — we parse it into 7 day rows,
 * let the customer edit via toggle + HH:MM inputs, then serialize back. The
 * canonical output collapses consecutive days with the same hours (so
 * "Mo 09:00-18:00, Di 09:00-18:00, ..." becomes "Mo-Fr 09:00-18:00"), which
 * matches both the existing agent-instructions parser and how humans read it.
 *
 * Parser is lenient: anything it can't classify falls back to the raw text
 * path. "Raw" mode also lets power-users keep special strings like
 * "24/7" or "nach Vereinbarung" without the editor destroying them.
 */

type Day = 'Mo' | 'Di' | 'Mi' | 'Do' | 'Fr' | 'Sa' | 'So';
const DAY_ORDER: Day[] = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DAY_LABEL: Record<Day, string> = {
  Mo: 'Montag', Di: 'Dienstag', Mi: 'Mittwoch', Do: 'Donnerstag',
  Fr: 'Freitag', Sa: 'Samstag', So: 'Sonntag',
};

type DayState = { open: boolean; from: string; to: string };
type WeekState = Record<Day, DayState>;

const DEFAULT_WEEK: WeekState = {
  Mo: { open: true, from: '09:00', to: '18:00' },
  Di: { open: true, from: '09:00', to: '18:00' },
  Mi: { open: true, from: '09:00', to: '18:00' },
  Do: { open: true, from: '09:00', to: '18:00' },
  Fr: { open: true, from: '09:00', to: '18:00' },
  Sa: { open: false, from: '10:00', to: '14:00' },
  So: { open: false, from: '10:00', to: '14:00' },
};

// Accepts single "Mo" or range "Mo-Fr"; returns the affected days in order.
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

// Leniency: "9-18" → "09:00-18:00", "9:30 - 18" → "09:30-18:00".
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

// Returns null when the string can't be parsed into a clean weekly schedule
// (signals: keep it as raw text so "nach Vereinbarung" / "24/7" etc. survive).
export function parseOpeningHours(raw: string): WeekState | null {
  if (!raw || !raw.trim()) return null;
  const work: WeekState = {
    Mo: { open: false, from: '09:00', to: '18:00' },
    Di: { open: false, from: '09:00', to: '18:00' },
    Mi: { open: false, from: '09:00', to: '18:00' },
    Do: { open: false, from: '09:00', to: '18:00' },
    Fr: { open: false, from: '09:00', to: '18:00' },
    Sa: { open: false, from: '09:00', to: '18:00' },
    So: { open: false, from: '09:00', to: '18:00' },
  };
  const segments = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;

  for (const seg of segments) {
    const dashIdx = seg.search(/\s/);
    if (dashIdx < 0) return null;
    const dayTok = seg.slice(0, dashIdx);
    const rest = seg.slice(dashIdx + 1).trim();
    const days = daysInToken(dayTok);
    if (!days) return null;
    if (/geschlossen|zu|closed/i.test(rest)) {
      for (const d of days) work[d] = { ...work[d]!, open: false };
      continue;
    }
    // HH[:MM]-HH[:MM]
    const m = /^(\d{1,2}(?::\d{2})?)\s*[-–]\s*(\d{1,2}(?::\d{2})?)/.exec(rest);
    if (!m) return null;
    const from = normaliseTime(m[1] ?? '');
    const to = normaliseTime(m[2] ?? '');
    if (!from || !to) return null;
    for (const d of days) work[d] = { open: true, from, to };
  }
  return work;
}

export function serialiseOpeningHours(week: WeekState): string {
  const groups: Array<{ days: Day[]; label: string }> = [];
  let i = 0;
  while (i < DAY_ORDER.length) {
    const d = DAY_ORDER[i]!;
    const cur = week[d]!;
    let j = i;
    // Collapse consecutive days that share the exact same open/from/to.
    while (j + 1 < DAY_ORDER.length) {
      const nd = DAY_ORDER[j + 1]!;
      const n = week[nd]!;
      if (n.open !== cur.open || n.from !== cur.from || n.to !== cur.to) break;
      j++;
    }
    const label = cur.open ? `${cur.from}-${cur.to}` : 'geschlossen';
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

const PRESETS: Array<{ name: string; apply: () => WeekState }> = [
  {
    name: 'Mo-Fr 9-18',
    apply: () => DAY_ORDER.reduce<WeekState>((acc, d) => {
      acc[d] = d === 'Sa' || d === 'So' ? { open: false, from: '09:00', to: '18:00' } : { open: true, from: '09:00', to: '18:00' };
      return acc;
    }, {} as WeekState),
  },
  {
    name: 'Mo-Fr 8-20 + Sa 10-14',
    apply: () => DAY_ORDER.reduce<WeekState>((acc, d) => {
      if (d === 'So') acc[d] = { open: false, from: '10:00', to: '14:00' };
      else if (d === 'Sa') acc[d] = { open: true, from: '10:00', to: '14:00' };
      else acc[d] = { open: true, from: '08:00', to: '20:00' };
      return acc;
    }, {} as WeekState),
  },
  {
    name: 'Mo-Sa 10-18',
    apply: () => DAY_ORDER.reduce<WeekState>((acc, d) => {
      acc[d] = d === 'So' ? { open: false, from: '10:00', to: '18:00' } : { open: true, from: '10:00', to: '18:00' };
      return acc;
    }, {} as WeekState),
  },
  {
    name: '24/7',
    apply: () => DAY_ORDER.reduce<WeekState>((acc, d) => {
      acc[d] = { open: true, from: '00:00', to: '24:00' };
      return acc;
    }, {} as WeekState),
  },
];

export function OpeningHoursEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parsed = useMemo(() => parseOpeningHours(value), [value]);
  // Raw mode: editor couldn't parse (e.g. "nach Vereinbarung") → expose a
  // plain textarea so power-user strings aren't destroyed. One-click
  // "Strukturiert bearbeiten" seeds DEFAULT_WEEK.
  const [rawMode, setRawMode] = useState(parsed === null && value.trim().length > 0);
  const week: WeekState = parsed ?? DEFAULT_WEEK;

  function setDay(d: Day, patch: Partial<DayState>) {
    const next: WeekState = { ...week, [d]: { ...week[d]!, ...patch } };
    onChange(serialiseOpeningHours(next));
  }

  function copyMondayToWeekdays() {
    const mo = week.Mo!;
    const next: WeekState = {
      ...week,
      Di: { ...mo },
      Mi: { ...mo },
      Do: { ...mo },
      Fr: { ...mo },
    };
    onChange(serialiseOpeningHours(next));
  }

  if (rawMode) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-white/40">Freitext-Modus — für besondere Angaben wie „nach Vereinbarung".</p>
          <button
            type="button"
            onClick={() => { setRawMode(false); onChange(serialiseOpeningHours(DEFAULT_WEEK)); }}
            className="text-[11px] text-orange-300/80 hover:text-orange-200 transition-colors"
          >
            Strukturiert bearbeiten →
          </button>
        </div>
        <textarea
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Mo–Fr 9–18 Uhr, Sa 10–14 Uhr"
          className="w-full rounded-xl bg-white/5 border border-white/10 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30 outline-none text-sm text-white/85 px-3 py-2 resize-y"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Presets */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-white/30 mr-1">Vorlage:</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => onChange(serialiseOpeningHours(p.apply()))}
            className="text-[11px] px-2 py-1 rounded-full border border-white/10 bg-white/[0.03] text-white/60 hover:text-white/90 hover:border-orange-500/30 hover:bg-orange-500/8 transition-colors"
          >
            {p.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setRawMode(true)}
          className="ml-auto text-[11px] text-white/40 hover:text-white/70 transition-colors"
        >
          Freitext
        </button>
      </div>

      {/* Day grid — flex-wrap lets narrow viewports stack the time block
          under the toggle instead of overflowing the rounded border. */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] divide-y divide-white/[0.05] overflow-hidden">
        {DAY_ORDER.map((d) => {
          const ds = week[d]!;
          const isMonday = d === 'Mo';
          return (
            <div key={d} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
              <span className="w-16 sm:w-24 shrink-0 text-xs font-medium text-white/70">{DAY_LABEL[d]}</span>
              {/* Toggle group — plain div, not label, to avoid nested <label> */}
              <div className="flex items-center gap-2 select-none shrink-0">
                <button
                  type="button"
                  role="switch"
                  aria-checked={ds.open}
                  aria-label={`${DAY_LABEL[d]}: ${ds.open ? 'geöffnet' : 'geschlossen'}`}
                  onClick={() => setDay(d, { open: !ds.open })}
                  className="relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0"
                  style={{ background: ds.open ? 'linear-gradient(135deg, #F97316, #06B6D4)' : 'rgba(255,255,255,0.12)' }}
                >
                  <span
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                    style={{ transform: ds.open ? 'translateX(18px)' : 'translateX(2px)' }}
                  />
                </button>
                <span className="text-[11px] text-white/50 w-20">{ds.open ? 'Geöffnet' : 'Geschlossen'}</span>
              </div>
              {ds.open && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <input
                    type="time"
                    value={ds.from}
                    onChange={(e) => setDay(d, { from: e.target.value })}
                    className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1 text-xs text-white/80 focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/30 outline-none [color-scheme:dark] w-[6.5rem]"
                  />
                  <span className="text-white/30 text-xs">bis</span>
                  <input
                    type="time"
                    value={ds.to}
                    onChange={(e) => setDay(d, { to: e.target.value })}
                    className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1 text-xs text-white/80 focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/30 outline-none [color-scheme:dark] w-[6.5rem]"
                  />
                </div>
              )}
              {isMonday && ds.open && (
                <button
                  type="button"
                  onClick={copyMondayToWeekdays}
                  title="Dienstag bis Freitag mit denselben Zeiten füllen"
                  className="ml-auto text-[10px] text-cyan-300/75 hover:text-cyan-200 transition-colors whitespace-nowrap cursor-pointer"
                >
                  → auf Di–Fr kopieren
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Preview — shows what the agent will actually see */}
      <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wider text-white/30 mb-0.5">Agent sieht</p>
        <p className="text-xs text-white/70 font-mono">{value || '—'}</p>
      </div>
    </div>
  );
}
