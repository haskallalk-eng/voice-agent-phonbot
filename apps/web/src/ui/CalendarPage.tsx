import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  getCalendarStatus, connectCalcom, disconnectCalendar,
  getGoogleCalendarAuthUrl, getMicrosoftCalendarAuthUrl,
  getChippyCalendar, saveChippySchedule, addChippyBlock, removeChippyBlock,
  getChippyBookings, createChippyBooking, deleteChippyBooking,
} from '../lib/api.js';
import type { ChippySchedule, ChippyBlock, ChippyBooking } from '../lib/api.js';

type CalendarStatus = { connected: boolean; provider: string | null; email: string | null; expired?: boolean; expiredProvider?: string; chippy?: { configured: boolean } };

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function todayISO() { return isoDate(new Date()); }

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return days;
}

const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const DAY_SHORT = ['Mo','Di','Mi','Do','Fr','Sa','So'];

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── Provider badge ────────────────────────────────────────────────────────────

type ProviderMeta = { label: string; color: string; bg: string; icon: string };
const PROVIDER_META: Record<string, ProviderMeta> = {
  google:    { label: 'Google Calendar',   color: '#22C55E', bg: 'rgba(34,197,94,0.12)',    icon: '🟢' },
  microsoft: { label: 'Microsoft Outlook', color: '#0078D4', bg: 'rgba(0,120,212,0.12)',    icon: '🪟' },
  calcom:    { label: 'Cal.com',           color: '#3B82F6', bg: 'rgba(59,130,246,0.12)',   icon: '🔵' },
  chippy:    { label: 'Chippy Kalender',   color: '#F97316', bg: 'rgba(249,115,22,0.12)',   icon: '🐾' },
};
const DEFAULT_PROVIDER_META: ProviderMeta = { label: 'Chippy Kalender', color: '#F97316', bg: 'rgba(249,115,22,0.12)', icon: '🐾' };

// ── Booking Modal ─────────────────────────────────────────────────────────────

function BookingModal({
  date, onClose, onSave,
}: {
  date: Date;
  onClose: () => void;
  onSave: (booking: ChippyBooking) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [service, setService] = useState('');
  const [notes, setNotes] = useState('');
  const [time, setTime] = useState('09:00');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateStr = isoDate(date);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !phone) return;
    setLoading(true);
    setError(null);
    try {
      const slotTime = new Date(`${dateStr}T${time}:00`).toISOString();
      const res = await createChippyBooking({ customer_name: name, customer_phone: phone, service: service || undefined, notes: notes || undefined, slot_time: slotTime });
      onSave(res.booking);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Fehler beim Speichern');
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 p-6 space-y-5" style={{ background: '#14141F' }} role="dialog" aria-modal="true" aria-labelledby="booking-modal-title">
        <div className="flex items-center justify-between">
          <div>
            <h3 id="booking-modal-title" className="text-base font-bold text-white">Neuer Termin</h3>
            <p className="text-sm text-white/40 mt-0.5">
              {date.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}
            </p>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors text-xl" aria-label="Schließen">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Uhrzeit</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} required
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="Kundenname"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Telefon *</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} required placeholder="+49 123 456789"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Service</label>
            <input type="text" value={service} onChange={e => setService(e.target.value)} placeholder="z.B. Haarschnitt, Beratung…"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Notizen</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Optionale Hinweise…"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40 resize-none" />
          </div>
          {error && <p className="text-xs text-red-400">⚠️ {error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm text-white/50 hover:text-white hover:border-white/20 transition-all">
              Abbrechen
            </button>
            <button type="submit" disabled={loading || !name || !phone}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-all"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
              {loading ? 'Speichern…' : 'Termin anlegen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Day Detail Drawer ─────────────────────────────────────────────────────────

function DayDrawer({
  date, bookings, blocks, onClose, onAddBooking, onDeleteBooking, onAddBlock, onRemoveBlock,
}: {
  date: Date;
  bookings: ChippyBooking[];
  blocks: ChippyBlock[];
  onClose: () => void;
  onAddBooking: () => void;
  onDeleteBooking: (id: string) => void;
  onAddBlock: (opts?: { start_time?: string; end_time?: string; reason?: string }) => void;
  onRemoveBlock: (id: string) => Promise<void>;
}) {
  const dateStr = isoDate(date);
  const dayBlocks = blocks.filter(b => b.date === dateStr);
  const fullDayBlock = dayBlocks.find(b => !b.start_time);
  const isFullBlocked = !!fullDayBlock;
  const dayBookings = bookings.filter(b => b.slot_time.startsWith(dateStr));

  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function doRemove(id: string) {
    setRemovingId(id); setRemoveError(null);
    try { await onRemoveBlock(id); }
    catch (e: unknown) { setRemoveError((e instanceof Error ? e.message : null) ?? 'Fehler beim Aufheben'); setRemovingId(null); }
    finally { setRemovingId(null); }
  }


  // Inline time-block form
  const [addingTimeBlock, setAddingTimeBlock] = useState(false);
  const [tbStart, setTbStart] = useState('09:00');
  const [tbEnd, setTbEnd] = useState('17:00');
  const [tbReason, setTbReason] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 overflow-hidden" style={{ background: '#14141F' }} role="dialog" aria-modal="true" aria-labelledby="day-drawer-title">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div>
            <p id="day-drawer-title" className="text-sm font-bold text-white">
              {date.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              {isFullBlocked && <span className="text-xs text-red-400 font-medium">Ganztägig gesperrt</span>}
              {!isFullBlocked && dayBlocks.length > 0 && (
                <span className="text-xs text-amber-400 font-medium">{dayBlocks.length} Zeitsperre{dayBlocks.length > 1 ? 'n' : ''}</span>
              )}
              {!isFullBlocked && dayBlocks.length === 0 && (
                <span className="text-xs text-white/40">{dayBookings.length} Termin{dayBookings.length !== 1 ? 'e' : ''}</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors text-lg leading-none" aria-label="Schließen">✕</button>
        </div>

        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto space-y-4">
          {/* Active blocks list */}
          {dayBlocks.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">Sperren</p>
              {dayBlocks.map(bl => (
                <div key={bl.id} className="flex items-center justify-between rounded-xl px-3 py-2.5 border border-red-500/20 bg-red-500/8">
                  <div className="flex items-center gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                    <div>
                      {bl.start_time
                        ? <p className="text-sm text-white font-medium">{bl.start_time.slice(0, 5)} – {bl.end_time?.slice(0, 5) ?? '?'}</p>
                        : <p className="text-sm text-white font-medium">Ganztägig</p>
                      }
                      {bl.reason && <p className="text-xs text-white/40">{bl.reason}</p>}
                    </div>
                  </div>
                  <button
                    onClick={() => void doRemove(bl.id)}
                    disabled={removingId === bl.id}
                    className="text-xs text-red-400/60 hover:text-red-400 transition-colors font-medium cursor-pointer disabled:opacity-40"
                  >
                    {removingId === bl.id ? '...' : 'Aufheben'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Bookings list */}
          {dayBookings.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">Termine</p>
              {dayBookings.map(b => (
                <div key={b.id} className="flex items-start gap-3 rounded-xl bg-white/5 px-3 py-2.5">
                  <div className="shrink-0 text-orange-400 font-mono text-xs mt-0.5 w-10">{formatTime(b.slot_time)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{b.customer_name}</p>
                    <p className="text-xs text-white/40">{b.customer_phone}{b.service ? ` · ${b.service}` : ''}</p>
                    {b.notes && <p className="text-xs text-white/30 mt-0.5">{b.notes}</p>}
                  </div>
                  <button onClick={() => onDeleteBooking(b.id)} className="shrink-0 text-red-400/50 hover:text-red-400 transition-colors text-xs cursor-pointer">Löschen</button>
                </div>
              ))}
            </div>
          )}

          {dayBookings.length === 0 && dayBlocks.length === 0 && (
            <p className="text-sm text-white/25 text-center py-2">Keine Termine oder Sperren</p>
          )}

          {/* Time-block form */}
          {addingTimeBlock && !isFullBlocked && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 space-y-3">
              <p className="text-xs font-semibold text-amber-300/80 uppercase tracking-wide">Zeitraum sperren</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-white/40 mb-1 uppercase tracking-wide">Von</label>
                  <input type="time" value={tbStart} onChange={e => setTbStart(e.target.value)}
                    className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500/50" />
                </div>
                <div>
                  <label className="block text-[10px] text-white/40 mb-1 uppercase tracking-wide">Bis</label>
                  <input type="time" value={tbEnd} onChange={e => setTbEnd(e.target.value)}
                    className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500/50" />
                </div>
              </div>
              <input type="text" value={tbReason} onChange={e => setTbReason(e.target.value)}
                placeholder="Grund (optional, z.B. Mittagspause)"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-amber-500/50" />
              <div className="flex gap-2">
                <button onClick={() => setAddingTimeBlock(false)}
                  className="flex-1 py-2 rounded-lg text-sm text-white/40 border border-white/10 hover:text-white/60 transition-all cursor-pointer">
                  Abbrechen
                </button>
                <button
                  onClick={() => {
                    onAddBlock({ start_time: tbStart, end_time: tbEnd, reason: tbReason || undefined });
                    setAddingTimeBlock(false); setTbReason('');
                  }}
                  disabled={!tbStart || !tbEnd || tbStart >= tbEnd}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 transition-all cursor-pointer"
                  style={{ background: 'linear-gradient(135deg, #F59E0B, #EF4444)' }}>
                  Sperren
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Remove error */}
        {removeError && (
          <p className="text-xs text-red-300 px-5 pb-2">{removeError}</p>
        )}
        {/* Actions footer */}
        <div className="px-5 pb-5 pt-3 border-t border-white/5 flex flex-wrap gap-2">
          {!isFullBlocked && (
            <button onClick={onAddBooking}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
              + Termin
            </button>
          )}
          {!isFullBlocked && !addingTimeBlock && (
            <button onClick={() => setAddingTimeBlock(true)}
              className="px-4 py-2.5 rounded-xl text-sm text-amber-300/80 border border-amber-500/25 hover:border-amber-500/50 hover:text-amber-300 transition-all cursor-pointer whitespace-nowrap">
              Zeitraum sperren
            </button>
          )}
          {!isFullBlocked ? (
            <button onClick={() => onAddBlock()}
              className="px-4 py-2.5 rounded-xl text-sm text-red-300/70 border border-red-500/20 hover:border-red-500/40 hover:text-red-300 transition-all cursor-pointer whitespace-nowrap">
              Tag sperren
            </button>
          ) : (
            <button onClick={() => void doRemove(fullDayBlock!.id)}
              disabled={removingId === fullDayBlock!.id}
              className="flex-1 py-2.5 rounded-xl text-sm text-white/60 border border-white/10 hover:border-white/20 hover:text-white/80 transition-all cursor-pointer disabled:opacity-40">
              {removingId === fullDayBlock!.id ? 'Wird aufgehoben…' : 'Sperre aufheben'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Monthly Calendar Grid ─────────────────────────────────────────────────────

function MonthlyCalendar({
  bookings, blocks, onDayClick,
}: {
  bookings: ChippyBooking[];
  blocks: ChippyBlock[];
  onDayClick: (date: Date) => void;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const days = getDaysInMonth(year, month);
  const firstDay = days[0]!;
  // Monday-based: Mon=0 ... Sun=6
  const startOffset = (firstDay.getDay() + 6) % 7;

  const fullDayBlockedSet = useMemo(() => new Set(blocks.filter(b => !b.start_time).map(b => b.date)), [blocks]);
  const timeBlockedSet = useMemo(() => new Set(blocks.filter(b => !!b.start_time).map(b => b.date)), [blocks]);

  const bookingsByDay = useMemo(() => {
    const map = new Map<string, ChippyBooking[]>();
    for (const b of bookings) {
      const ds = b.slot_time.slice(0, 10);
      const arr = map.get(ds);
      if (arr) arr.push(b);
      else map.set(ds, [b]);
    }
    return map;
  }, [bookings]);

  function bookingsForDay(d: Date) {
    return bookingsByDay.get(isoDate(d)) ?? [];
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  return (
    <div>
      {/* Month nav */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-white/5 text-white/50 hover:text-white transition-all" aria-label="Vorheriger Monat">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h2 className="text-sm font-bold text-white">{MONTH_NAMES[month]} {year}</h2>
        <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-white/5 text-white/50 hover:text-white transition-all" aria-label="Nächster Monat">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_SHORT.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-white/30 uppercase tracking-wider py-1">{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-1">
        {/* Empty cells before first day */}
        {Array.from({ length: startOffset }).map((_, i) => <div key={`e${i}`} />)}

        {days.map(d => {
          const ds = isoDate(d);
          const isToday = ds === isoDate(today);
          const isPast = d < today && !isToday;
          const isFullBlocked = fullDayBlockedSet.has(ds);
          const hasTimeBlocks = timeBlockedSet.has(ds);
          const dayBookings = bookingsForDay(d);
          const hasBookings = dayBookings.length > 0;

          return (
            <button
              key={ds}
              onClick={() => onDayClick(d)}
              className={[
                'relative rounded-xl p-1.5 min-h-[52px] text-left transition-all duration-150 group cursor-pointer',
                isFullBlocked ? 'bg-red-500/10 border border-red-500/20 hover:border-red-500/30' :
                hasTimeBlocks ? 'bg-amber-500/8 border border-amber-500/20 hover:border-amber-500/35' :
                hasBookings ? 'bg-orange-500/10 border border-orange-500/20 hover:border-orange-500/40' :
                isPast ? 'border border-white/[0.04] hover:border-white/10 opacity-50' :
                'border border-white/[0.06] hover:border-white/20 hover:bg-white/[0.03]',
                isToday ? 'ring-2 ring-orange-500/50' : '',
              ].join(' ')}
            >
              <span className={[
                'text-xs font-semibold block',
                isToday ? 'text-orange-400' : isPast ? 'text-white/25' : 'text-white/70',
              ].join(' ')}>
                {d.getDate()}
              </span>
              {isFullBlocked && (
                <span className="block text-[9px] text-red-400/70 leading-tight mt-0.5">Gesperrt</span>
              )}
              {hasTimeBlocks && !isFullBlocked && (
                <span className="block text-[9px] text-amber-400/70 leading-tight mt-0.5">Zeiten gesperrt</span>
              )}
              {hasBookings && !isFullBlocked && (
                <div className="mt-0.5 space-y-0.5">
                  {dayBookings.slice(0, 2).map(b => (
                    <div key={b.id} className="truncate text-[9px] text-orange-300/80 leading-tight">
                      {formatTime(b.slot_time)} {b.customer_name}
                    </div>
                  ))}
                  {dayBookings.length > 2 && (
                    <div className="text-[9px] text-orange-400/60">+{dayBookings.length - 2} weitere</div>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Settings Panel (Schedule + Blocks) ────────────────────────────────────────

const DAY_NAMES: Record<string, string> = {
  '1': 'Montag', '2': 'Dienstag', '3': 'Mittwoch',
  '4': 'Donnerstag', '5': 'Freitag', '6': 'Samstag', '0': 'Sonntag',
};
const DAY_ORDER = ['1','2','3','4','5','6','0'];
const DEFAULT_SCHEDULE: ChippySchedule = {
  '0': { enabled: false, start: '09:00', end: '17:00' },
  '1': { enabled: true,  start: '09:00', end: '17:00' },
  '2': { enabled: true,  start: '09:00', end: '17:00' },
  '3': { enabled: true,  start: '09:00', end: '17:00' },
  '4': { enabled: true,  start: '09:00', end: '17:00' },
  '5': { enabled: true,  start: '09:00', end: '17:00' },
  '6': { enabled: false, start: '09:00', end: '17:00' },
};

function SettingsPanel({
  schedule, setSchedule, blocks, setBlocks,
}: {
  schedule: ChippySchedule;
  setSchedule: React.Dispatch<React.SetStateAction<ChippySchedule>>;
  blocks: ChippyBlock[];
  setBlocks: React.Dispatch<React.SetStateAction<ChippyBlock[]>>;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newBlockDate, setNewBlockDate] = useState('');
  const [newBlockReason, setNewBlockReason] = useState('');
  const [blockError, setBlockError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true); setSaved(false); setSaveError(null);
    try {
      await saveChippySchedule(schedule);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setSaveError((e instanceof Error ? e.message : null) ?? 'Fehler');
    } finally { setSaving(false); }
  }

  async function handleAddBlock() {
    if (!newBlockDate) return;
    setBlockError(null);
    try {
      const res = await addChippyBlock(newBlockDate, { reason: newBlockReason || undefined });
      setBlocks(prev => [...prev, { id: res.id, date: newBlockDate, start_time: null, end_time: null, reason: newBlockReason || null }]);
      setNewBlockDate(''); setNewBlockReason('');
    } catch (e: unknown) {
      setBlockError((e instanceof Error ? e.message : null) ?? 'Fehler');
    }
  }

  async function handleRemoveBlock(id: string) {
    try { await removeChippyBlock(id); setBlocks(prev => prev.filter(b => b.id !== id)); } catch {}
  }

  return (
    <div className="space-y-6">
      {/* Weekly schedule */}
      <div>
        <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Wöchentliche Verfügbarkeit</p>
        <div className="space-y-2">
          {DAY_ORDER.map(dow => {
            const day = schedule[dow] ?? DEFAULT_SCHEDULE[dow]!;
            return (
              <div key={dow} className="flex items-center gap-3">
                <button
                  aria-pressed={day.enabled}
                  onClick={() => setSchedule(s => ({ ...s, [dow]: { ...day, enabled: !day.enabled } }))}
                  className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${day.enabled ? 'bg-orange-500' : 'bg-white/10'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${day.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
                <span className={`w-24 text-sm ${day.enabled ? 'text-white' : 'text-white/30'}`}>{DAY_NAMES[dow]}</span>
                {day.enabled ? (
                  <div className="flex items-center gap-2">
                    <input type="time" value={day.start} onChange={e => setSchedule(s => ({ ...s, [dow]: { ...day, start: e.target.value } }))}
                      className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-orange-500/50" />
                    <span className="text-white/30 text-xs">bis</span>
                    <input type="time" value={day.end} onChange={e => setSchedule(s => ({ ...s, [dow]: { ...day, end: e.target.value } }))}
                      className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-orange-500/50" />
                  </div>
                ) : (
                  <span className="text-xs text-white/20">nicht verfügbar</span>
                )}
              </div>
            );
          })}
        </div>
        {saveError && <p className="text-sm text-red-300 mt-3">⚠️ {saveError}</p>}
        <button onClick={handleSave} disabled={saving}
          className="mt-4 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
          style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}>
          {saving ? 'Speichern…' : saved ? 'Gespeichert ✓' : 'Verfügbarkeit speichern'}
        </button>
      </div>

      {/* Date blocks */}
      <div className="pt-4 border-t border-white/5">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">Ausnahmetage</p>
        <p className="text-xs text-white/30 mb-3">Urlaub, Krankheit oder einzelne freie Tage.</p>
        {blocks.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {blocks.map(b => (
              <div key={b.id} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                <div>
                  <span className="text-sm text-white">{new Date(b.date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                  {b.reason && <span className="ml-2 text-xs text-white/40">{b.reason}</span>}
                </div>
                <button onClick={() => handleRemoveBlock(b.id)} className="text-xs text-red-400/60 hover:text-red-400 transition-colors">Entfernen</button>
              </div>
            ))}
          </div>
        )}
        {blockError && <p className="text-sm text-red-300 mb-2">⚠️ {blockError}</p>}
        <div className="flex gap-2">
          <input type="date" value={newBlockDate} min={todayISO()} onChange={e => setNewBlockDate(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-orange-500/50" />
          <input type="text" value={newBlockReason} onChange={e => setNewBlockReason(e.target.value)} placeholder="Grund (optional)"
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-orange-500/50" />
          <button onClick={handleAddBlock} disabled={!newBlockDate}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-white/10 hover:bg-white/15 disabled:opacity-30 transition-all">
            Sperren
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Calendar Connections Panel ────────────────────────────────────────────────

function ConnectionsPanel({ onStatusChange }: { onStatusChange: (s: CalendarStatus) => void }) {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calcomKey, setCalcomKey] = useState('');
  const [calcomLoading, setCalcomLoading] = useState(false);
  const [calcomError, setCalcomError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [microsoftLoading, setMicrosoftLoading] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);

  async function loadStatus() {
    setLoading(true); setError(null);
    try { const d = await getCalendarStatus(); setStatus(d); onStatusChange(d); }
    catch (e: unknown) { setError((e instanceof Error ? e.message : null) ?? 'Fehler'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('calendarConnected') === 'true' || params.get('calendarError')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('calendarConnected'); url.searchParams.delete('calendarError');
      window.history.replaceState({}, '', url.toString());
      if (params.get('calendarError')) setError(`OAuth fehlgeschlagen: ${params.get('calendarError')}`);
    }
    loadStatus();
  }, []);

  if (loading) return <div className="flex justify-center py-8"><span className="w-5 h-5 rounded-full border-2 border-orange-400 border-t-transparent animate-spin" /></div>;

  const meta = PROVIDER_META[status?.provider ?? ''];

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-2xl p-4 border border-red-500/20 bg-red-500/5">
          <p className="text-sm text-red-300">⚠️ {error}</p>
          <button onClick={loadStatus} className="mt-2 text-xs text-white/40 hover:text-white/60 transition-colors">Erneut versuchen</button>
        </div>
      )}

      {status?.connected && meta && (
        <div className="rounded-2xl p-5 border border-white/10" style={{ background: meta.bg }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 bg-white/5">{meta.icon}</div>
              <div>
                <p className="text-sm font-semibold text-white">{meta.label}</p>
                {status.email && <p className="text-xs text-white/50">{status.email}</p>}
                <div className="flex items-center gap-1 mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  <span className="text-[10px] text-green-400 font-medium">Verbunden</span>
                </div>
              </div>
            </div>
            <button onClick={async () => { setDisconnectLoading(true); try { await disconnectCalendar(); await loadStatus(); } catch {} finally { setDisconnectLoading(false); } }}
              disabled={disconnectLoading}
              className="shrink-0 px-3 py-1.5 rounded-xl text-xs text-red-300 border border-red-500/20 hover:bg-red-500/10 transition-all disabled:opacity-50">
              {disconnectLoading ? 'Trenne…' : 'Trennen'}
            </button>
          </div>
        </div>
      )}

      {!status?.connected && (
        <div className="space-y-3">
          <p className="text-xs text-white/40 mb-3">
            Verbinde einen oder mehrere Kalender. Termine werden automatisch in alle verbundenen Kalender gebucht.
          </p>
          {(status as CalendarStatus | null)?.expired && (
            <div className="rounded-xl px-4 py-3 mb-2 text-xs" style={{ background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.2)', color: '#FB923C' }}>
              ⚠️ Deine {(status as CalendarStatus).expiredProvider === 'google' ? 'Google' : (status as CalendarStatus).expiredProvider === 'microsoft' ? 'Microsoft' : ''}-Verbindung ist abgelaufen. Bitte neu verbinden.
            </div>
          )}

          {/* Google */}
          <div className="rounded-2xl p-5 border border-white/10 hover:border-white/20 transition-all" style={{ background: (PROVIDER_META.google ?? DEFAULT_PROVIDER_META).bg }}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl bg-white/5">🟢</div>
                <div>
                  <p className="text-sm font-semibold text-white">Google Calendar</p>
                  <p className="text-xs text-white/40">OAuth 2.0</p>
                </div>
              </div>
              <button onClick={async () => { setGoogleLoading(true); try { const { url } = await getGoogleCalendarAuthUrl(); window.location.href = url; } catch { setGoogleLoading(false); } }}
                disabled={googleLoading}
                className="shrink-0 rounded-xl px-4 py-2 font-semibold text-xs text-white disabled:opacity-50 transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #22C55E, #06B6D4)' }}>
                {googleLoading ? 'Verbinde…' : 'Verbinden →'}
              </button>
            </div>
          </div>

          {/* Microsoft */}
          <div className="rounded-2xl p-5 border border-white/10 hover:border-white/20 transition-all" style={{ background: (PROVIDER_META.microsoft ?? DEFAULT_PROVIDER_META).bg }}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl bg-white/5">🪟</div>
                <div>
                  <p className="text-sm font-semibold text-white">Microsoft Outlook</p>
                  <p className="text-xs text-white/40">Office 365 / Outlook.com</p>
                </div>
              </div>
              <button onClick={async () => { setMicrosoftLoading(true); try { const { url } = await getMicrosoftCalendarAuthUrl(); window.location.href = url; } catch { setMicrosoftLoading(false); } }}
                disabled={microsoftLoading}
                className="shrink-0 rounded-xl px-4 py-2 font-semibold text-xs text-white disabled:opacity-50 transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #0078D4, #00BCF2)' }}>
                {microsoftLoading ? 'Verbinde…' : 'Verbinden →'}
              </button>
            </div>
          </div>

          {/* Cal.com */}
          <div className="rounded-2xl p-5 border border-white/10 hover:border-white/20 transition-all" style={{ background: (PROVIDER_META.calcom ?? DEFAULT_PROVIDER_META).bg }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl bg-white/5">🔵</div>
              <div>
                <p className="text-sm font-semibold text-white">Cal.com</p>
                <p className="text-xs text-white/40">API Key</p>
              </div>
            </div>
            <div className="flex gap-2">
              <input type="text" value={calcomKey} onChange={e => setCalcomKey(e.target.value)} placeholder="cal_live_xxxx…"
                className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-blue-500/50" />
              <button onClick={async () => { setCalcomLoading(true); setCalcomError(null); try { await connectCalcom(calcomKey); setCalcomKey(''); await loadStatus(); } catch (e: unknown) { setCalcomError((e instanceof Error ? e.message : null) ?? 'Fehler'); } finally { setCalcomLoading(false); } }}
                disabled={calcomLoading || !calcomKey.trim()}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all"
                style={{ background: 'linear-gradient(135deg, #3B82F6, #F97316)' }}>
                {calcomLoading ? '…' : 'OK'}
              </button>
            </div>
            {calcomError && <p className="text-xs text-red-300 mt-2">⚠️ {calcomError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = 'calendar' | 'schedule' | 'connections';

export function CalendarPage() {
  const [tab, setTab] = useState<Tab>('calendar');
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | null>(null);

  // Chippy data (shared between calendar + settings)
  const [schedule, setSchedule] = useState<ChippySchedule>(DEFAULT_SCHEDULE);
  const [blocks, setBlocks] = useState<ChippyBlock[]>([]);
  const [bookings, setBookings] = useState<ChippyBooking[]>([]);

  // Modal state
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [showAddBooking, setShowAddBooking] = useState(false);

  // Load chippy data + bookings for a 3-month window
  const loadChippy = useCallback(async () => {
    try {
      const [chippy, bkgs] = await Promise.all([
        getChippyCalendar(),
        getChippyBookings(
          isoDate(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)),
          isoDate(new Date(new Date().getFullYear(), new Date().getMonth() + 3, 0)),
        ),
      ]);
      setSchedule({ ...DEFAULT_SCHEDULE, ...chippy.schedule });
      setBlocks(chippy.blocks);
      setBookings(bkgs.bookings);
    } catch {}
  }, []);

  useEffect(() => { loadChippy(); }, [loadChippy]);

  async function handleDeleteBooking(id: string) {
    try {
      await deleteChippyBooking(id);
      setBookings(prev => prev.filter(b => b.id !== id));
    } catch {}
  }

  async function handleAddBlock(date: Date, opts?: { start_time?: string; end_time?: string; reason?: string }) {
    const dateStr = isoDate(date);
    try {
      const res = await addChippyBlock(dateStr, opts);
      setBlocks(prev => [...prev, {
        id: res.id, date: dateStr,
        start_time: opts?.start_time ?? null,
        end_time: opts?.end_time ?? null,
        reason: opts?.reason ?? null,
      }]);
    } catch {}
  }

  function handleBookingSaved(booking: ChippyBooking) {
    setBookings(prev => [...prev, booking].sort((a, b) => a.slot_time.localeCompare(b.slot_time)));
    setShowAddBooking(false);
    setSelectedDay(null);
  }

  const providerMeta = PROVIDER_META[calendarStatus?.provider ?? ''] ?? DEFAULT_PROVIDER_META;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'calendar', label: 'Kalender' },
    { id: 'schedule', label: 'Verfügbarkeit' },
    { id: 'connections', label: 'Verbindungen' },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white px-4 sm:px-6 py-8">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/3 w-[500px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.07) 0%, transparent 65%)' }} />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.05) 0%, transparent 65%)' }} />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Kalender</h1>
            <p className="text-sm text-white/40 mt-1">
              {calendarStatus?.provider && calendarStatus.provider !== 'chippy'
                ? `Verbunden mit ${providerMeta.label}`
                : calendarStatus?.connected
                  ? 'Chippy Kalender aktiv — verbinde optional einen externen Kalender'
                  : 'Kein Kalender konfiguriert — richte Verfügbarkeit ein oder verbinde einen Kalender'}
            </p>
          </div>
          {tab === 'calendar' && (
            <button
              onClick={() => { setSelectedDay(new Date()); setShowAddBooking(true); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
              + Termin
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white/[0.04] rounded-2xl p-1 mb-6">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={[
                'flex-1 py-2 rounded-xl text-sm font-medium transition-all duration-200',
                tab === t.id ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white/60',
              ].join(' ')}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Calendar integration hint */}
        {tab === 'calendar' && (!calendarStatus?.connected || calendarStatus?.provider === 'chippy') && (
          <div
            className="mb-4 rounded-2xl p-4 flex items-start gap-3"
            style={{
              background: 'linear-gradient(135deg, rgba(249,115,22,0.08), rgba(6,182,212,0.05))',
              border: '1px solid rgba(249,115,22,0.15)',
            }}
          >
            <span className="text-xl shrink-0 mt-0.5">📅</span>
            <div>
              <p className="text-sm font-medium text-white/90 mb-1">
                Verbinde deinen Kalender für automatische Terminbuchungen
              </p>
              <p className="text-xs text-white/45 leading-relaxed">
                Phonbot unterstützt <strong className="text-white/70">Google Calendar</strong>, <strong className="text-white/70">Microsoft Outlook</strong>, <strong className="text-white/70">Cal.com</strong> und den <strong className="text-white/70">eingebauten Chippy Kalender</strong>.
                Du kannst auch mehrere Kalender gleichzeitig verbinden — Termine werden in alle synchronisiert.
              </p>
              <button
                onClick={() => setTab('connections')}
                className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:opacity-90"
                style={{ background: 'rgba(249,115,22,0.2)', color: '#FB923C' }}
              >
                Kalender verbinden →
              </button>
            </div>
          </div>
        )}

        {/* Calendar tab */}
        {tab === 'calendar' && (
          <div className="rounded-2xl border border-white/10 p-5" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <MonthlyCalendar
              bookings={bookings}
              blocks={blocks}
              onDayClick={(d) => { setSelectedDay(d); setShowAddBooking(false); }}
            />

            {/* Legend */}
            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/5 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs text-white/40">
                <div className="w-3 h-3 rounded-sm border border-orange-500/40 bg-orange-500/10" />
                Termin
              </div>
              <div className="flex items-center gap-1.5 text-xs text-white/40">
                <div className="w-3 h-3 rounded-sm border border-red-500/30 bg-red-500/10" />
                Ganztägig gesperrt
              </div>
              <div className="flex items-center gap-1.5 text-xs text-white/40">
                <div className="w-3 h-3 rounded-sm border border-amber-500/30 bg-amber-500/8" />
                Zeiten gesperrt
              </div>
              <div className="flex items-center gap-1.5 text-xs text-white/40">
                <div className="w-3 h-3 rounded-sm ring-2 ring-orange-500/50 border border-white/10" />
                Heute
              </div>
            </div>
          </div>
        )}

        {/* Availability + blocks tab */}
        {tab === 'schedule' && (
          <div className="rounded-2xl border border-white/10 p-5" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <p className="text-xs text-white/40 mb-4">
              {calendarStatus?.connected
                ? 'Dein externer Kalender ist aktiv. Chippy dient als Fallback.'
                : 'Kein externer Kalender? Trag hier deine Verfügbarkeit ein — der Agent nutzt diese automatisch.'}
            </p>
            <SettingsPanel
              schedule={schedule} setSchedule={setSchedule}
              blocks={blocks} setBlocks={setBlocks}
            />
          </div>
        )}

        {/* Connections tab */}
        {tab === 'connections' && (
          <ConnectionsPanel onStatusChange={setCalendarStatus} />
        )}
      </div>

      {/* Day detail drawer */}
      {selectedDay && !showAddBooking && (
        <DayDrawer
          date={selectedDay}
          bookings={bookings}
          blocks={blocks}
          onClose={() => setSelectedDay(null)}
          onAddBooking={() => setShowAddBooking(true)}
          onDeleteBooking={handleDeleteBooking}
          onAddBlock={(opts) => { handleAddBlock(selectedDay, opts); if (!opts?.start_time) setSelectedDay(null); }}
          onRemoveBlock={async (id) => { await removeChippyBlock(id); setBlocks(prev => prev.filter(b => b.id !== id)); }}
        />
      )}

      {/* Booking create modal */}
      {showAddBooking && selectedDay && (
        <BookingModal
          date={selectedDay}
          onClose={() => { setShowAddBooking(false); }}
          onSave={handleBookingSaved}
        />
      )}
    </div>
  );
}
