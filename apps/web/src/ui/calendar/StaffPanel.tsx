import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CalendarProvider,
  CalendarStaff,
  CalendarStatus,
  ChipyBlock,
  ChipyBooking,
  ChipyBookingWriteResult,
  ChipySchedule,
  ExternalCalendarEvent,
} from '../../lib/api.js';
import {
  addStaffChipyBlock,
  connectCalcom,
  createStaffChipyBooking,
  deleteStaffChipyBooking,
  disconnectCalendar,
  getCalendarStaff,
  getCalendarStatus,
  getCustomers,
  getGoogleCalendarAuthUrl,
  getMicrosoftCalendarAuthUrl,
  getStaffChipyBookings,
  getStaffChipyCalendar,
  getStaffExternalCalendarEvents,
  removeStaffChipyBlock,
} from '../../lib/api.js';
import { IconMicrosoftWindow } from '../PhonbotIcons.js';
import { CalendarViewSwitch, DailyCalendar, MonthlyCalendar, WeeklyCalendar } from './CalendarViews.js';
import { customerLookupMessage, resolveBookingCustomer } from './customerLookup.js';
import {
  bookingWithStaffMeta,
  DEFAULT_PROVIDER_META,
  externalSyncWarning,
  isoDate,
  PROVIDER_META,
  serviceLabelsToOptions,
  startOfWeek,
  type CalendarBooking,
  type CalendarViewMode,
} from './model.js';

import { BookingDetailsModal } from './BookingDetailsModal.js';
import { BookingModal } from './BookingModal.js';
import { SettingsPanel } from './SettingsPanel.js';
import { DEFAULT_SCHEDULE, getProviderConnection } from './configuration.js';
import { initialCalendarView, storeCustomerFocus } from './uiState.js';

const STAFF_CALENDAR_SELECTION_STORAGE_KEY = 'phonbot_calendar_selected_staff';

export function StaffPanel({
  onStaffChange,
  onNavigate,
  onBookingsChange,
}: {
  onStaffChange?: (count: number) => void;
  onNavigate?: (page: 'customers', focusId?: string | null) => void;
  onBookingsChange?: () => void | Promise<void>;
} = {}) {
  const [staff, setStaff] = useState<CalendarStaff[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(STAFF_CALENDAR_SELECTION_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staffSchedule, setStaffSchedule] = useState<ChipySchedule>(DEFAULT_SCHEDULE);
  const [staffBlocks, setStaffBlocks] = useState<ChipyBlock[]>([]);
  const [staffBookings, setStaffBookings] = useState<ChipyBooking[]>([]);
  const [staffExternalEvents, setStaffExternalEvents] = useState<ExternalCalendarEvent[]>([]);
  const [selectedStaffDay, setSelectedStaffDay] = useState<Date | null>(null);
  const [showStaffAddBooking, setShowStaffAddBooking] = useState(false);
  const [staffCalendarView, setStaffCalendarView] = useState<CalendarViewMode>(initialCalendarView);
  const [staffWeekStart, setStaffWeekStart] = useState(startOfWeek(new Date()));
  const [staffViewDay, setStaffViewDay] = useState(new Date());
  const [selectedStaffBooking, setSelectedStaffBooking] = useState<CalendarBooking | null>(null);
  const [staffStatus, setStaffStatus] = useState<CalendarStatus | null>(null);
  const [calcomKey, setCalcomKey] = useState('');
  const [connectionLoading, setConnectionLoading] = useState<string | null>(null);

  const selectedIdIsLoaded = Boolean(selectedId && staff.some(s => s.id === selectedId));
  const selected = selectedIdIsLoaded ? staff.find(s => s.id === selectedId) ?? null : null;
  const selectedServiceOptions = useMemo(() => serviceLabelsToOptions(selected?.services), [selected?.services]);
  const selectedCalendarBookings = useMemo(
    () => selected ? staffBookings.map((booking) => bookingWithStaffMeta(booking, selected)) : [],
    [selected, staffBookings],
  );

  const loadStaff = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await getCalendarStaff();
      setStaff(res.staff);
      onStaffChange?.(res.staff.length);
      setSelectedId(current => {
        if (current && res.staff.some(member => member.id === current)) return current;
        return res.staff[0]?.id ?? null;
      });
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Mitarbeiter konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, [onStaffChange]);

  const loadSelectedCalendar = useCallback(async (staffId: string) => {
    setError(null);
    const from = isoDate(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
    const to = isoDate(new Date(new Date().getFullYear(), new Date().getMonth() + 3, 0));
    try {
      const [chipy, bookings, status, external] = await Promise.all([
        getStaffChipyCalendar(staffId),
        getStaffChipyBookings(staffId, from, to),
        getCalendarStatus(staffId),
        getStaffExternalCalendarEvents(staffId, from, to).catch(() => ({ events: [] as ExternalCalendarEvent[] })),
      ]);
      setStaffSchedule({ ...DEFAULT_SCHEDULE, ...chipy.schedule });
      setStaffBlocks(chipy.blocks);
      setStaffBookings(bookings.bookings);
      setStaffExternalEvents(external.events);
      setStaffStatus(status);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Mitarbeiter-Kalender konnte nicht geladen werden');
    }
  }, []);

  useEffect(() => { loadStaff(); }, [loadStaff]);
  useEffect(() => {
    try {
      if (selectedId && selectedIdIsLoaded) {
        window.localStorage.setItem(STAFF_CALENDAR_SELECTION_STORAGE_KEY, selectedId);
      } else {
        window.localStorage.removeItem(STAFF_CALENDAR_SELECTION_STORAGE_KEY);
      }
    } catch {
      // Persisting the open staff calendar is a UX nicety, not required for booking.
    }
  }, [selectedId, selectedIdIsLoaded]);
  useEffect(() => { if (selectedId && selectedIdIsLoaded) void loadSelectedCalendar(selectedId); }, [selectedId, selectedIdIsLoaded, loadSelectedCalendar]);
  useEffect(() => {
    setSelectedStaffDay(null);
    setShowStaffAddBooking(false);
    setSelectedStaffBooking(null);
  }, [selectedId]);
  useEffect(() => {
    if (selectedId) return;
    setStaffSchedule(DEFAULT_SCHEDULE);
    setStaffBlocks([]);
    setStaffBookings([]);
    setStaffExternalEvents([]);
    setStaffStatus(null);
  }, [selectedId]);

  async function runConnect(provider: Exclude<CalendarProvider, 'chipy'>) {
    if (!selected) return;
    setConnectionLoading(provider); setError(null);
    try {
      if (provider === 'google') {
        const { url } = await getGoogleCalendarAuthUrl(selected.id);
        window.location.href = url;
        return;
      }
      if (provider === 'microsoft') {
        const { url } = await getMicrosoftCalendarAuthUrl(selected.id);
        window.location.href = url;
        return;
      }
      await connectCalcom(calcomKey, selected.id);
      setCalcomKey('');
      await loadSelectedCalendar(selected.id);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Verbindung fehlgeschlagen');
    } finally {
      setConnectionLoading(null);
    }
  }

  async function runDisconnect(provider: Exclude<CalendarProvider, 'chipy'>) {
    if (!selected) return;
    setConnectionLoading(provider); setError(null);
    try {
      await disconnectCalendar(provider, selected.id);
      await loadSelectedCalendar(selected.id);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Trennen fehlgeschlagen');
    } finally {
      setConnectionLoading(null);
    }
  }

  async function handleStaffDeleteBooking(id: string) {
    if (!selected) return;
    try {
      const res = await deleteStaffChipyBooking(selected.id, id);
      setStaffBookings(prev => prev.filter(b => b.id !== id));
      const warning = externalSyncWarning(res, 'deleted');
      if (warning) setError(warning);
      void onBookingsChange?.();
    } catch (e: unknown) {
      const message = (e instanceof Error ? e.message : null) ?? 'Termin konnte nicht gelöscht werden';
      setError(message);
      throw new Error(message);
    }
  }

  function handleStaffBookingSaved(booking: ChipyBooking, result: ChipyBookingWriteResult) {
    setStaffBookings(prev => [...prev, booking].sort((a, b) => a.slot_time.localeCompare(b.slot_time)));
    const warning = externalSyncWarning(result, 'created');
    if (warning) setError(warning);
    void onBookingsChange?.();
    setShowStaffAddBooking(false);
    setSelectedStaffDay(null);
  }

  async function handleStaffOpenBookingCustomer(booking: ChipyBooking) {
    if (!onNavigate) return;
    setError(null);
    try {
      const result = await resolveBookingCustomer(booking, getCustomers);
      if (result.status !== 'matched') {
        setError(customerLookupMessage(result.status));
        return;
      }
      storeCustomerFocus(result.customer, result.query);
      setSelectedStaffDay(null);
      setShowStaffAddBooking(false);
      onNavigate('customers', result.customer.id);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Kunde konnte nicht geöffnet werden');
    }
  }

  const providerButton = (provider: Exclude<CalendarProvider, 'chipy'>, label: string) => {
    const conn = getProviderConnection(staffStatus, provider);
    const connected = Boolean(conn?.connected);
    const meta = PROVIDER_META[provider] ?? DEFAULT_PROVIDER_META;
    return (
      <div key={provider} className="rounded-2xl px-5 py-4 flex flex-col gap-4 hover:bg-white/[0.04] transition-all sm:flex-row sm:items-center" style={{ background: 'rgba(255,255,255,0.02)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-lg" style={{ background: meta.bg }}>
          {provider === 'google' ? (
            <svg width="18" height="18" viewBox="0 0 24 24" className="fancy-star"><defs><linearGradient id={`staffGglCal-${selected?.id ?? 'x'}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#4285F4"/><stop offset="33%" stopColor="#34A853"/><stop offset="66%" stopColor="#FBBC05"/><stop offset="100%" stopColor="#EA4335"/></linearGradient></defs><path d="M12 1C12.8 7.6 16.4 11.2 23 12c-6.6.8-10.2 4.4-11 11-.8-6.6-4.4-10.2-11-11C7.6 11.2 11.2 7.6 12 1z" fill={`url(#staffGglCal-${selected?.id ?? 'x'})`}/></svg>
          ) : provider === 'calcom' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#20d9ff" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ) : provider === 'microsoft' ? (
            <IconMicrosoftWindow size={19} className="text-[#00BCF2]" />
          ) : (
            <span>{meta.icon}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="text-xs text-white/30 truncate">{connected ? conn?.email ?? 'Verbunden' : 'Eigene Verbindung für diese Person'}</p>
        </div>
        {connected ? (
          <button onClick={() => { void runDisconnect(provider); }} disabled={connectionLoading === provider}
            className="rounded-lg px-3 py-1.5 text-xs text-red-300 bg-red-500/10 border border-red-500/20 disabled:opacity-40">
            Trennen
          </button>
        ) : provider === 'calcom' ? (
          <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row">
            <input value={calcomKey} onChange={e => setCalcomKey(e.target.value)} placeholder="cal_live_..."
              className="w-full min-w-0 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none sm:w-44"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }} />
            <button onClick={() => { void runConnect(provider); }} disabled={!calcomKey.trim() || connectionLoading === provider}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}>
              Verbinden
            </button>
          </div>
        ) : (
            <button onClick={() => { void runConnect(provider); }} disabled={connectionLoading === provider}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}>
            Verbinden
          </button>
        )}
      </div>
    );
  };

  if (loading) return <div className="rounded-2xl border border-white/10 p-5 text-sm text-white/40">Lade Mitarbeiter...</div>;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-2xl p-4 border border-red-500/20 bg-red-500/5 text-sm text-red-300">{error}</div>
      )}

      <div className="shrink-0 rounded-2xl border border-white/10 p-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="text-sm font-bold text-white">Mitarbeiterkalender</p>
            <p className="text-xs text-white/35 mt-1">Wähle aus, welchen Kalender du sehen möchtest. Mitarbeiterdaten pflegst du im Modul Mein Business.</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate?.('customers')}
            className="shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/55 hover:text-white hover:border-orange-500/30"
          >
            Mein Business
          </button>
        </div>

        {staff.length > 0 ? (
          <div className="flex flex-wrap gap-2 pb-1">
            {staff.map(member => (
              <button key={member.id} onClick={() => { setSelectedId(member.id); }}
                className={`shrink-0 rounded-xl px-4 py-2 text-sm border transition-all ${selectedId === member.id ? 'text-white border-orange-500/40 bg-orange-500/10' : 'text-white/45 border-white/8 bg-white/[0.02]'}`}>
                {member.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-white/35 py-4">Noch keine Mitarbeiter angelegt. Lege sie unter Mein Business an; bis dahin bleibt der Betriebskalender aktiv.</p>
        )}
      </div>

      {selected && (
        <div className="grid gap-4">
          <section className="flex min-w-0 flex-col rounded-2xl border border-white/10 p-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <div className="mb-3 flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold text-orange-100/60 uppercase tracking-[0.16em]">Mitarbeiterkalender</p>
                <h3 className="mt-1 text-base font-bold text-white">{selected.name}</h3>
                <p className="mt-1 text-xs text-white/45">Termine, Tagesdetails und Sperren genau für diesen Mitarbeiter.</p>
              </div>
              {staffCalendarView !== 'day' && (
                <button
                  onClick={() => { setSelectedStaffDay(new Date()); setShowStaffAddBooking(true); }}
                  className="shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}
                >
                  + Termin
                </button>
              )}
            </div>

            <div className="mb-3 grid shrink-0 grid-cols-2 gap-2">
              <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/25">Termine</p>
                <p className="mt-1 text-lg font-bold text-white">{staffBookings.length}</p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/25">Sperren</p>
                <p className="mt-1 text-lg font-bold text-white">{staffBlocks.length}</p>
              </div>
            </div>

            <div className="mb-3 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-white/35">
                {staffCalendarView === 'day'
                  ? 'Tagesansicht mit exakter Terminlänge, Puffer und dieser Person als Kalenderquelle.'
                  : staffCalendarView === 'week'
                  ? 'Exakte Wochenplanung mit Terminlänge, Puffer und externen Belegungen.'
                  : 'Monatsüberblick. Ein Tag springt direkt in die Tagesansicht.'}
              </p>
              <CalendarViewSwitch value={staffCalendarView} onChange={setStaffCalendarView} />
            </div>

            {staffCalendarView === 'day' ? (
              <DailyCalendar
                className="flex-1"
                date={staffViewDay}
                bookings={selectedCalendarBookings}
                blocks={staffBlocks}
                externalEvents={staffExternalEvents}
                schedule={staffSchedule}
                onDateChange={(date) => {
                  setStaffViewDay(date);
                  setStaffWeekStart(startOfWeek(date));
                }}
                onBookingClick={setSelectedStaffBooking}
                onAddBooking={(date) => {
                  setSelectedStaffDay(date);
                  setShowStaffAddBooking(true);
                }}
              />
            ) : staffCalendarView === 'month' ? (
              <MonthlyCalendar
                bookings={selectedCalendarBookings}
                blocks={staffBlocks}
                onDayClick={(d) => {
                  setStaffViewDay(d);
                  setStaffWeekStart(startOfWeek(d));
                  setStaffCalendarView('day');
                }}
              />
            ) : (
              <WeeklyCalendar
                className="flex-1"
                bookings={selectedCalendarBookings}
                blocks={staffBlocks}
                externalEvents={staffExternalEvents}
                schedule={staffSchedule}
                weekStart={staffWeekStart}
                onWeekStartChange={setStaffWeekStart}
                onBookingClick={setSelectedStaffBooking}
                onDayClick={(date) => {
                  setStaffViewDay(date);
                  setStaffCalendarView('day');
                }}
                onAddBookingForDay={(date) => {
                  setSelectedStaffDay(date);
                  setShowStaffAddBooking(true);
                }}
              />
            )}

            <div className="mt-3 flex shrink-0 items-center gap-4 border-t border-white/5 pt-3 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs text-white/45"><div className="w-3 h-3 rounded-sm border border-orange-500/40 bg-orange-500/10" />Termin</div>
              <div className="flex items-center gap-1.5 text-xs text-white/45"><div className="w-3 h-3 rounded-sm border border-red-500/30 bg-red-500/10" />Ganztag gesperrt</div>
            </div>
          </section>

          <aside className="min-w-0 space-y-4">
          <section
            className="rounded-2xl border border-orange-500/20 p-4 shadow-[0_18px_52px_rgba(255,91,10,0.08)]"
            style={{ background: 'linear-gradient(135deg, rgba(255,91,10,0.10), rgba(255,255,255,0.025) 46%, rgba(32,217,255,0.07))' }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-100/55">Sperrzeiten</p>
                <p className="mt-1 text-sm font-bold text-white">{selected.name} sperren</p>
                <p className="mt-1 text-xs leading-relaxed text-white/42">Einzelne Tage, mehrere Tage oder Uhrzeiten, an denen dieser Mitarbeiter nicht buchbar ist.</p>
              </div>
              <span className="rounded-full border border-orange-400/20 bg-black/20 px-3 py-1.5 text-xs font-semibold text-orange-100/70">
                Tag/Zeit
              </span>
            </div>
            <SettingsPanel
              schedule={staffSchedule}
              setSchedule={setStaffSchedule}
              blocks={staffBlocks}
              setBlocks={setStaffBlocks}
              addBlockApi={(date, opts) => addStaffChipyBlock(selected.id, date, opts)}
              removeBlockApi={(id) => removeStaffChipyBlock(selected.id, id)}
              showSchedule={false}
              blockModeOptions={['day', 'range', 'hours']}
              blockTitle="Sperren"
              blockDescription="Blockiere einen einzelnen Tag, mehrere Tage oder bestimmte Uhrzeiten."
            />
          </section>

          <section className="space-y-2 rounded-2xl border border-white/10 p-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <p className="text-[11px] font-semibold text-white/25 uppercase tracking-[0.15em]">Kalender-Verbindungen</p>
            {providerButton('google', 'Google Calendar')}
            {providerButton('microsoft', 'Microsoft Outlook')}
            {providerButton('calcom', 'Cal.com')}
          </section>
          </aside>
        </div>
      )}

      {selected && selectedStaffDay && showStaffAddBooking && (
        <BookingModal
          date={selectedStaffDay}
          serviceOptions={selectedServiceOptions}
          createBookingApi={(data) => createStaffChipyBooking(selected.id, data)}
          onClose={() => setShowStaffAddBooking(false)}
          onSave={handleStaffBookingSaved}
        />
      )}
      {selectedStaffBooking && (
        <BookingDetailsModal
          booking={selectedStaffBooking}
          onClose={() => setSelectedStaffBooking(null)}
          onOpenCustomer={handleStaffOpenBookingCustomer}
          customerLookupError={error}
          onDelete={(booking) => handleStaffDeleteBooking(booking.id)}
        />
      )}
    </div>
  );
}
