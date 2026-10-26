import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CalendarStaff,
  CalendarStatus,
  ChipyBlock,
  ChipyBooking,
  ChipyBookingDeleteResult,
  ChipyBookingWriteResult,
  ChipySchedule,
  ExternalCalendarEvent,
} from '../lib/api.js';
import {
  deleteChipyBooking,
  deleteStaffChipyBooking,
  getAgentConfig,
  getCalendarStaff,
  getChipyBookings,
  getChipyCalendar,
  getCustomers,
  getExternalCalendarEvents,
  getStaffChipyBookings,
  getStaffExternalCalendarEvents,
} from '../lib/api.js';
import { HAIRDRESSER_SERVICE_PRESET } from '../lib/service-presets.js';
import { IconCalendar } from './PhonbotIcons.js';
import {
  CalendarViewSwitch,
  DailyCalendar,
  MonthlyCalendar,
  WeeklyCalendar,
} from './calendar/CalendarViews.js';
import { customerLookupMessage, resolveBookingCustomer } from './calendar/customerLookup.js';
import {
  bookingKey,
  bookingWithBusinessMeta,
  bookingWithStaffMeta,
  colorHash,
  DEFAULT_PROVIDER_META,
  deriveServiceOptions,
  externalSyncWarning,
  groupCalendarBookingsByStart,
  isoDate,
  PROVIDER_META,
  startOfWeek,
  TEAM_BOOKING_COLORS,
  type CalendarBooking,
  type CalendarServiceOption,
  type CalendarViewMode,
} from './calendar/model.js';

import { BookingDetailsModal } from './calendar/BookingDetailsModal.js';
import { BookingModal } from './calendar/BookingModal.js';
import { ConnectionsPanel } from './calendar/ConnectionsPanel.js';
import { SettingsPanel } from './calendar/SettingsPanel.js';
import { StaffPanel } from './calendar/StaffPanel.js';
import { DEFAULT_SCHEDULE } from './calendar/configuration.js';
import { initialCalendarView, storeCustomerFocus } from './calendar/uiState.js';

type Tab = 'calendar' | 'staff';

export function CalendarPage({
  focusBookingId,
  onNavigate,
}: {
  focusBookingId?: string | null;
  onNavigate?: (page: 'customers', focusId?: string | null) => void;
} = {}) {
  const [tab, setTab] = useState<Tab>('calendar');
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | null>(null);
  const [staffCount, setStaffCount] = useState(0);
  const [calendarStaff, setCalendarStaff] = useState<CalendarStaff[]>([]);
  const [teamBookings, setTeamBookings] = useState<CalendarBooking[]>([]);
  const [teamExternalEvents, setTeamExternalEvents] = useState<ExternalCalendarEvent[]>([]);

  // Chipy data (shared between calendar + settings)
  const [schedule, setSchedule] = useState<ChipySchedule>(DEFAULT_SCHEDULE);
  const [blocks, setBlocks] = useState<ChipyBlock[]>([]);
  const [bookings, setBookings] = useState<ChipyBooking[]>([]);
  // External events (Google / Microsoft / cal.com) — populated by the
  // background cron on the API, fetched here for display only. Empty array
  // when no kalender is connected, which is the common case for new orgs.
  const [externalEvents, setExternalEvents] = useState<ExternalCalendarEvent[]>([]);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [serviceOptions, setServiceOptions] = useState<CalendarServiceOption[]>([]);

  // Modal state
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [showAddBooking, setShowAddBooking] = useState(false);
  const [selectedCalendarBooking, setSelectedCalendarBooking] = useState<CalendarBooking | null>(null);
  const [calendarView, setCalendarView] = useState<CalendarViewMode>(initialCalendarView);
  const [calendarWeekStart, setCalendarWeekStart] = useState(startOfWeek(new Date()));
  const [calendarViewDay, setCalendarViewDay] = useState(new Date());
  const staffModeActive = staffCount > 0;
  const businessCalendarBookings = useMemo(() => bookings.map(bookingWithBusinessMeta), [bookings]);
  const calendarBookings = useMemo(
    () => [...businessCalendarBookings, ...(staffModeActive ? teamBookings : [])].sort((a, b) => a.slot_time.localeCompare(b.slot_time)),
    [businessCalendarBookings, staffModeActive, teamBookings],
  );
  const calendarDisplayBookings = useMemo(
    () => staffModeActive ? groupCalendarBookingsByStart(calendarBookings) : calendarBookings,
    [calendarBookings, staffModeActive],
  );
  const calendarExternalEvents = useMemo(
    () => staffModeActive ? [...externalEvents, ...teamExternalEvents] : externalEvents,
    [externalEvents, staffModeActive, teamExternalEvents],
  );

  // Deep-link from dashboard click: arrive with ?focusBookingId → switch to
  // the calendar tab, open the day panel for that booking's date, and pulse
  // the row briefly so the user sees which one they clicked.
  useEffect(() => {
    if (!focusBookingId || calendarBookings.length === 0) return;
    const b = calendarBookings.find((x) => x.id === focusBookingId);
    if (!b) return;
    setTab('calendar');
    setCalendarView('day');
    setCalendarViewDay(new Date(b.slot_time));
    setCalendarWeekStart(startOfWeek(new Date(b.slot_time)));
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-booking-id="${CSS.escape(b.id)}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('focus-pulse');
      window.setTimeout(() => el.classList.remove('focus-pulse'), 2200);
    }, 200);
    return () => window.clearTimeout(t);
  }, [focusBookingId, calendarBookings]);

  // Load chipy data + bookings + external events for a 3-month window.
  // External-events call is non-blocking: if the endpoint errors (e.g. on
  // fresh boots before the cron has run once, or when the user isn't
  // connected to any external calendar), we silently show an empty list
  // rather than breaking the page.
  const loadChipy = useCallback(async () => {
    const from = isoDate(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
    const to = isoDate(new Date(new Date().getFullYear(), new Date().getMonth() + 3, 0));
    const warnings: string[] = [];
    try {
      setCalendarError(null);
      const [chipy, bkgs, ext, staffRes] = await Promise.all([
        getChipyCalendar(),
        getChipyBookings(from, to),
        getExternalCalendarEvents(from, to).catch(() => {
          warnings.push('Externe Betriebskalender konnten nicht geladen werden.');
          return { events: [] as ExternalCalendarEvent[] };
        }),
        getCalendarStaff().catch(() => {
          warnings.push('Mitarbeiterkalender konnten nicht geladen werden.');
          return { staff: [] as CalendarStaff[] };
        }),
      ]);
      const staff = staffRes.staff ?? [];
      const team = await Promise.all(staff.map(async (member) => {
        const [staffBkgs, staffExt] = await Promise.all([
          getStaffChipyBookings(member.id, from, to).catch(() => {
            warnings.push(`Termine von ${member.name} konnten nicht geladen werden.`);
            return { bookings: [] as ChipyBooking[] };
          }),
          getStaffExternalCalendarEvents(member.id, from, to).catch(() => {
            warnings.push(`Externe Kalender von ${member.name} konnten nicht geladen werden.`);
            return { events: [] as ExternalCalendarEvent[] };
          }),
        ]);
        return {
          member,
          bookings: staffBkgs.bookings.map((booking) => bookingWithStaffMeta(booking, member)),
          externalEvents: staffExt.events,
        };
      }));
      setSchedule({ ...DEFAULT_SCHEDULE, ...chipy.schedule });
      setBlocks(chipy.blocks);
      setBookings(bkgs.bookings);
      setExternalEvents(ext.events);
      setCalendarStaff(staff);
      setStaffCount(staff.length);
      setTeamBookings(team.flatMap((item) => item.bookings).sort((a, b) => a.slot_time.localeCompare(b.slot_time)));
      setTeamExternalEvents(team.flatMap((item) => item.externalEvents));
      if (warnings.length) {
        setCalendarError([...new Set(warnings)].join(' '));
      }
    } catch (e: unknown) {
      setCalendarError((e instanceof Error ? e.message : null) ?? 'Kalenderdaten konnten nicht geladen werden');
    }
  }, []);

  useEffect(() => { loadChipy(); }, [loadChipy]);
  useEffect(() => {
    getAgentConfig()
      .then((cfg) => setServiceOptions(deriveServiceOptions(cfg)))
      .catch(() => setServiceOptions(deriveServiceOptions({ services: HAIRDRESSER_SERVICE_PRESET })));
  }, []);
  useEffect(() => {
    if (!staffModeActive) return;
    setTab(current => (current === 'calendar' ? 'staff' : current));
  }, [staffModeActive]);

  async function handleDeleteCalendarBooking(booking: CalendarBooking) {
    try {
      let res: ChipyBookingDeleteResult;
      if (booking.calendarScope === 'staff' && booking.staffId) {
        res = await deleteStaffChipyBooking(booking.staffId, booking.id);
        setTeamBookings(prev => prev.filter(b => bookingKey(b) !== bookingKey(booking)));
      } else {
        res = await deleteChipyBooking(booking.id);
        setBookings(prev => prev.filter(b => b.id !== booking.id));
      }
      const warning = externalSyncWarning(res, 'deleted');
      if (warning) setCalendarError(warning);
    } catch (e: unknown) {
      const message = (e instanceof Error ? e.message : null) ?? 'Termin konnte nicht gelöscht werden';
      setCalendarError(message);
      throw new Error(message);
    }
  }

  async function handleOpenBookingCustomer(booking: ChipyBooking) {
    if (!onNavigate) return;
    setCalendarError(null);
    try {
      const result = await resolveBookingCustomer(booking, getCustomers);
      if (result.status !== 'matched') {
        setCalendarError(customerLookupMessage(result.status));
        return;
      }
      storeCustomerFocus(result.customer, result.query);
      setSelectedDay(null);
      onNavigate('customers', result.customer.id);
    } catch (e: unknown) {
      setCalendarError((e instanceof Error ? e.message : null) ?? 'Kunde konnte nicht geöffnet werden');
    }
  }

  function handleBookingSaved(booking: ChipyBooking, result: ChipyBookingWriteResult) {
    setBookings(prev => [...prev, booking].sort((a, b) => a.slot_time.localeCompare(b.slot_time)));
    const warning = externalSyncWarning(result, 'created');
    if (warning) setCalendarError(warning);
    setShowAddBooking(false);
    setSelectedDay(null);
  }

  const providerMeta = PROVIDER_META[calendarStatus?.provider ?? ''] ?? DEFAULT_PROVIDER_META;

  const TABS: { id: Tab; label: string }[] = staffModeActive
    ? [
      { id: 'staff', label: 'Aktiver Kalender' },
      { id: 'calendar', label: 'Betriebskalender' },
    ]
    : [
      { id: 'calendar', label: 'Betriebskalender' },
      { id: 'staff', label: 'Mitarbeiterkalender' },
    ];

  return (
    <div className="min-h-full bg-[#0A0A0F] text-white px-4 py-4 sm:px-6 sm:py-5">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/3 w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(255,91,10,0.07) 0%, transparent 65%)' }} />
        <div className="absolute bottom-0 right-1/4 w-[250px] sm:w-[400px] h-[250px] sm:h-[400px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(32,217,255,0.05) 0%, transparent 65%)' }} />
      </div>

      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-[1900px] flex-col">
        {/* Header */}
        <div className="mb-4 flex shrink-0 items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Kalender</h1>
            <p className="text-sm text-white/40 mt-1">
              {calendarStatus?.provider && calendarStatus.provider !== 'chipy'
                  ? `Verbunden mit ${providerMeta.label}`
                : staffModeActive
                  ? 'Aktiver Bot-Kalender: Mitarbeiterkalender. Der Betriebskalender bleibt als Referenz erreichbar.'
                  : calendarStatus?.connected
                    ? 'Ohne Mitarbeiter gilt der Betriebskalender allgemein, mit Mitarbeitern bucht Chipy gezielt pro Person'
                  : 'Richte den Betriebskalender ein oder lege Mitarbeiter mit eigenen Kalendern an'}
            </p>
          </div>
          {tab === 'calendar' && !staffModeActive && calendarView !== 'day' && (
            <button
              onClick={() => { setSelectedDay(new Date()); setShowAddBooking(true); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}>
              + Termin
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="mb-4 flex shrink-0 gap-1 rounded-2xl p-1" style={{ background: 'rgba(255,255,255,0.03)' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={[
                'flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer',
                tab === t.id ? 'bg-white/8' : 'text-white/35 hover:text-white/55',
              ].join(' ')}>
              {tab === t.id ? (
                <span className="bg-clip-text text-transparent font-semibold" style={{ backgroundImage: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}>{t.label}</span>
              ) : t.label}
            </button>
          ))}
        </div>

        {/* Calendar error banner */}
        {calendarError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 flex items-center justify-between mb-4">
            <span>{calendarError}</span>
            <button onClick={() => setCalendarError(null)} className="text-red-400/50 hover:text-red-400 ml-2" aria-label="Schließen">✕</button>
          </div>
        )}

        {/* Calendar integration hint */}
        {tab === 'calendar' && !staffModeActive && (!calendarStatus?.connected || calendarStatus?.provider === 'chipy') && (
          <div
            className="mb-4 shrink-0 rounded-2xl p-4 flex items-start gap-3"
            style={{
              background: 'linear-gradient(135deg, rgba(255,91,10,0.08), rgba(32,217,255,0.05))',
              border: '1px solid rgba(255,91,10,0.15)',
            }}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-orange-500/15 bg-orange-500/10 text-orange-300">
              <IconCalendar size={18} />
            </span>
            <div>
              <p className="text-sm font-medium text-white/90 mb-1">
                Verbinde deinen Kalender für automatische Terminbuchungen
              </p>
              <p className="text-xs text-white/45 leading-relaxed">
                Phonbot unterstützt <strong className="text-white/70">Google Calendar</strong>, <strong className="text-white/70">Microsoft Outlook</strong>, <strong className="text-white/70">Cal.com</strong> und den <strong className="text-white/70">eingebauten Chipy Kalender</strong>.
                Du kannst auch mehrere Kalender gleichzeitig verbinden — Termine werden in alle synchronisiert.
              </p>
              <button
                onClick={() => document.getElementById('calendar-connections')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:opacity-90"
                style={{ background: 'rgba(255,91,10,0.2)', color: '#FB923C' }}
              >
                Kalender verbinden →
              </button>
            </div>
          </div>
        )}

        {tab === 'calendar' && (
          <div className="grid gap-4">
            <div className="flex min-w-0 flex-col gap-4">
            {staffModeActive && (
              <div className="shrink-0 rounded-3xl border border-orange-500/20 p-4 shadow-[0_18px_60px_rgba(255,91,10,0.10)]" style={{ background: 'linear-gradient(135deg, rgba(255,91,10,0.13), rgba(255,255,255,0.035) 48%, rgba(32,217,255,0.10))' }}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-100/65">Kalenderlogik</p>
                    <p className="mt-1 text-base font-bold text-white">Mitarbeiterkalender aktiv</p>
                    <p className="mt-1 text-xs text-white/55 leading-relaxed">
                      Chipy nutzt jetzt die Mitarbeiter als Buchungsziele. Wenn du nur einen allgemeinen Kalender willst, lass die Mitarbeiterliste leer.
                    </p>
                  </div>
                  <div className="grid gap-2 text-xs">
                    <span className="rounded-full border border-orange-400/25 bg-orange-500/15 px-3 py-1.5 text-orange-100">{staffCount} Mitarbeiter aktiv</span>
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-white/45">Betriebskalender bleibt sichtbar</span>
                  </div>
                </div>
                {calendarStaff.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {calendarStaff.slice(0, 7).map((member) => {
                      const color = member.color ?? TEAM_BOOKING_COLORS[colorHash(member.id) % TEAM_BOOKING_COLORS.length]!;
                      return (
                        <span key={member.id} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-3 py-1.5 text-xs text-white/55">
                          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                          {member.name}
                        </span>
                      );
                    })}
                    {calendarStaff.length > 7 && <span className="rounded-full border border-white/10 bg-black/18 px-3 py-1.5 text-xs text-white/35">+{calendarStaff.length - 7} weitere</span>}
                  </div>
                )}
                <button onClick={() => setTab('staff')} className="mt-4 rounded-xl border border-orange-500/25 bg-orange-500/15 px-3 py-2 text-xs font-semibold text-orange-100 hover:bg-orange-500/20">
                  Mitarbeiterkalender öffnen
                </button>
              </div>
            )}

            <section className="flex min-w-0 flex-col rounded-2xl border border-white/10 p-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Betriebskalender</p>
                  <p className="text-xs text-white/35 mt-1">{staffModeActive ? 'Team-Übersicht: Betriebstermine und alle Mitarbeitertermine liegen hier gemeinsam übereinander.' : 'Wenn kein Mitarbeiter angelegt ist, nutzt Chipy diesen Kalender allgemein.'}</p>
                </div>
              </div>
              <div className="mb-3 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-white/35">
                  {calendarView === 'day'
                    ? 'Tagesansicht mit allen Mitarbeiterterminen, Farben und echter Terminlänge.'
                    : calendarView === 'week'
                      ? 'Google-ähnliche Wochenansicht mit elegant überlagerten Team-Terminen.'
                      : 'Monatsüberblick. Ein Tag öffnet die Tagesansicht.'}
                </p>
                <CalendarViewSwitch value={calendarView} onChange={setCalendarView} />
              </div>

              {calendarView === 'day' ? (
                <DailyCalendar
                  className="flex-1"
                  date={calendarViewDay}
                  bookings={calendarDisplayBookings}
                  blocks={blocks}
                  externalEvents={calendarExternalEvents}
                  schedule={schedule}
                  onDateChange={(date) => {
                    setCalendarViewDay(date);
                    setCalendarWeekStart(startOfWeek(date));
                  }}
                  onBookingClick={setSelectedCalendarBooking}
                  onAddBooking={staffModeActive ? undefined : (date) => {
                    setSelectedDay(date);
                    setShowAddBooking(true);
                  }}
                />
              ) : calendarView === 'month' ? (
                <MonthlyCalendar
                  bookings={calendarDisplayBookings}
                  blocks={blocks}
                  onDayClick={(d) => {
                    setCalendarViewDay(d);
                    setCalendarWeekStart(startOfWeek(d));
                    setCalendarView('day');
                  }}
                />
              ) : (
                <WeeklyCalendar
                  className="flex-1"
                  bookings={calendarDisplayBookings}
                  blocks={blocks}
                  externalEvents={calendarExternalEvents}
                  schedule={schedule}
                  weekStart={calendarWeekStart}
                  onWeekStartChange={setCalendarWeekStart}
                  onBookingClick={setSelectedCalendarBooking}
                  onDayClick={(date) => {
                    setCalendarViewDay(date);
                    setCalendarView('day');
                  }}
                  onAddBookingForDay={staffModeActive ? undefined : (date) => {
                    setSelectedDay(date);
                    setShowAddBooking(true);
                  }}
                />
              )}

              <div className="mt-3 flex shrink-0 items-center gap-4 border-t border-white/5 pt-3 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs text-white/40"><div className="w-3 h-3 rounded-sm border border-orange-500/40 bg-orange-500/10" />Termin</div>
                <div className="flex items-center gap-1.5 text-xs text-white/40"><div className="w-3 h-3 rounded-sm border border-red-500/30 bg-red-500/10" />Ganztägig gesperrt</div>
                <div className="flex items-center gap-1.5 text-xs text-white/40"><div className="w-3 h-3 rounded-sm border border-amber-500/30 bg-amber-500/8" />Zeiten gesperrt</div>
                <div className="flex items-center gap-1.5 text-xs text-white/40"><div className="w-3 h-3 rounded-sm ring-2 ring-orange-500/50 border border-white/10" />Heute</div>
              </div>
            </section>
            </div>

            <aside className="min-w-0 space-y-4">
            <section
              className="rounded-2xl border border-orange-500/20 p-4 shadow-[0_18px_52px_rgba(255,91,10,0.08)]"
              style={{ background: 'linear-gradient(135deg, rgba(255,91,10,0.10), rgba(255,255,255,0.025) 46%, rgba(32,217,255,0.07))' }}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-100/55">Sperrzeiten</p>
                  <p className="mt-1 text-sm font-bold text-white">Tage & Zeiten sperren</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/42">Urlaub, Feiertage, mehrere Tage oder Uhrzeiten, an denen keine Bot-Buchungen möglich sind.</p>
                </div>
                <span className="rounded-full border border-orange-400/20 bg-black/20 px-3 py-1.5 text-xs font-semibold text-orange-100/70">
                  Tag/Zeit
                </span>
              </div>
              <SettingsPanel
                schedule={schedule}
                setSchedule={setSchedule}
                blocks={blocks}
                setBlocks={setBlocks}
                showSchedule={false}
                blockModeOptions={['day', 'range', 'hours']}
                blockTitle="Sperren"
                blockDescription="Blockiere einen einzelnen Tag, mehrere Tage oder bestimmte Uhrzeiten."
              />
            </section>

            <section id="calendar-connections" className="space-y-2 rounded-2xl border border-white/10 p-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <p className="text-[11px] font-semibold text-white/25 uppercase tracking-[0.15em]">Kalender-Verbindungen</p>
              <p className="text-xs text-white/40">
                {staffModeActive ? 'Für Mitarbeiter-Buchungen verbindest du Kalender direkt beim jeweiligen Mitarbeiter.' : 'Verbinde Google, Outlook oder Cal.com im gleichen Stil wie im Agent Builder.'}
              </p>
              <ConnectionsPanel onStatusChange={setCalendarStatus} />
            </section>
            </aside>
          </div>
        )}

        {tab === 'staff' && (
          <StaffPanel onStaffChange={setStaffCount} onNavigate={onNavigate} onBookingsChange={loadChipy} />
        )}
      </div>

      {/* Booking create modal */}
      {showAddBooking && selectedDay && (
        <BookingModal
          date={selectedDay}
          serviceOptions={serviceOptions}
          onClose={() => { setShowAddBooking(false); }}
          onSave={handleBookingSaved}
        />
      )}
      {selectedCalendarBooking && (
        <BookingDetailsModal
          booking={selectedCalendarBooking}
          onClose={() => setSelectedCalendarBooking(null)}
          onOpenCustomer={handleOpenBookingCustomer}
          customerLookupError={calendarError}
          onDelete={handleDeleteCalendarBooking}
        />
      )}
    </div>
  );
}
