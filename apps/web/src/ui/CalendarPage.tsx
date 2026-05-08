import { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  getCalendarStatus, connectCalcom, disconnectCalendar,
  getGoogleCalendarAuthUrl, getMicrosoftCalendarAuthUrl,
  getChipyCalendar, saveChipySchedule, addChipyBlock, removeChipyBlock,
  getChipyBookings, createChipyBooking, deleteChipyBooking,
  getExternalCalendarEvents, getStaffExternalCalendarEvents,
  getCalendarStaff,
  getStaffChipyCalendar, addStaffChipyBlock, removeStaffChipyBlock,
  getStaffChipyBookings, createStaffChipyBooking, deleteStaffChipyBooking,
  getCustomers, getAgentConfig,
} from '../lib/api.js';
import type { CalendarProvider, CalendarStatus, CalendarStaff, ChipySchedule, ChipyBlock, ChipyBooking, ChipyBookingInput, ExternalCalendarEvent, Customer, ServiceItem } from '../lib/api.js';
import { FoxLogo } from './FoxLogo.js';
import { HAIRDRESSER_SERVICE_PRESET, serviceItemToStaffLabel } from '../lib/service-presets.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
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
function _formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const CUSTOMER_FOCUS_STORAGE_KEY = 'phonbot_focus_customer';
const STAFF_CALENDAR_SELECTION_STORAGE_KEY = 'phonbot_calendar_selected_staff';

function normalizeLookupPhone(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function findBookingCustomer(booking: ChipyBooking, customers: Customer[]): Customer | null {
  const bookingPhone = normalizeLookupPhone(booking.customer_phone);
  if (bookingPhone) {
    const byPhone = customers.find((customer) => {
      const customerPhone = normalizeLookupPhone(customer.phone_normalized ?? customer.phone);
      return customerPhone && (customerPhone === bookingPhone || customerPhone.endsWith(bookingPhone) || bookingPhone.endsWith(customerPhone));
    });
    if (byPhone) return byPhone;
  }

  const bookingName = booking.customer_name.trim().toLowerCase();
  return customers.find((customer) => customer.full_name.trim().toLowerCase() === bookingName) ?? customers[0] ?? null;
}

function storeCustomerFocus(customer: Customer, search: string) {
  try {
    sessionStorage.setItem(CUSTOMER_FOCUS_STORAGE_KEY, JSON.stringify({ id: customer.id, search }));
  } catch {
    // Non-critical: the ID deep-link still works for customers in the loaded list.
  }
}

function splitServiceText(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (value ?? '').split(/[,\n]/)) {
    const item = raw.trim();
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function isHairdresserConfig(input: { industry?: string; businessDescription?: string; servicesText?: string }) {
  const haystack = `${input.industry ?? ''} ${input.businessDescription ?? ''} ${input.servicesText ?? ''}`.toLowerCase();
  return /friseur|salon|haar|farbe|kopfhaut|stylist/.test(haystack);
}

type CalendarServiceOption = {
  label: string;
  durationMinutes: number;
  bufferMinutes: number;
};

function parseMinutesText(value: string | null | undefined, fallback: number): number {
  const raw = value?.trim().toLowerCase();
  if (!raw) return fallback;
  const normalized = raw.replace(',', '.');
  const hours = Number(normalized.match(/(\d+(?:\.\d+)?)\s*(?:h|std|stunde|stunden)/)?.[1] ?? 0) * 60;
  const minutes = Number(normalized.match(/(\d+(?:\.\d+)?)\s*(?:min|minute|minutes|minuten)/)?.[1] ?? 0);
  const total = hours + minutes;
  if (total > 0) return Math.min(480, Math.max(5, Math.round(total)));
  const plain = Number(normalized.match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(plain) ? Math.min(480, Math.max(5, Math.round(plain))) : fallback;
}

function parseBufferText(value: string | null | undefined): number {
  const raw = value?.trim().toLowerCase();
  if (!raw || !/puffer|buffer|pause|abstand/.test(raw)) return 0;
  const match = raw.match(/(\d{1,3})\s*(?:min|minute|minutes|minuten)?\s*(?:puffer|buffer|pause|abstand)/)
    ?? raw.match(/(?:puffer|buffer|pause|abstand)\s*(\d{1,3})/);
  return match ? Math.min(180, Math.max(0, Number(match[1]))) : 0;
}

function normalizeServiceName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function deriveServiceOptions(input: { services?: ServiceItem[]; servicesText?: string; industry?: string; businessDescription?: string }): CalendarServiceOption[] {
  const source: ServiceItem[] = input.services?.length
    ? input.services
    : isHairdresserConfig(input)
      ? HAIRDRESSER_SERVICE_PRESET
      : splitServiceText(input.servicesText).map((name, index) => ({ id: `legacy-${index}`, name }));
  return source
    .filter((service) => service.name?.trim())
    .map((service) => ({
      label: serviceItemToStaffLabel(service),
      durationMinutes: parseMinutesText(service.duration, 30),
      bufferMinutes: Math.min(180, Math.max(0, service.bufferMinutes ?? parseBufferText(service.description))),
    }));
}

function serviceLabelsToOptions(labels: string[] | null | undefined): CalendarServiceOption[] {
  const seen = new Set<string>();
  return (labels ?? [])
    .map((label) => label.trim())
    .filter((label) => {
      const key = normalizeServiceName(label);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((label) => ({
      label,
      durationMinutes: parseMinutesText(label, 30),
      bufferMinutes: parseBufferText(label),
    }));
}

function bookingDateKey(booking: ChipyBooking): string {
  return isoDate(new Date(booking.slot_time));
}

function bookingDuration(booking: ChipyBooking): number {
  return Math.min(480, Math.max(5, Math.round(booking.duration_minutes ?? parseMinutesText(booking.service, 30))));
}

function bookingBuffer(booking: ChipyBooking): number {
  return Math.min(180, Math.max(0, Math.round(booking.buffer_minutes ?? parseBufferText(booking.service))));
}

function clockToMinutes(value: string | null | undefined): number | null {
  const match = value?.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return hour * 60 + minute;
}

function dateToLocalMinutes(value: string): number {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

function minutesLabel(value: number): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function clampTimelineMinute(value: number): number {
  return Math.min(24 * 60, Math.max(0, Math.round(value)));
}

const TIMELINE_WORKDAY_PADDING_MINUTES = 30;
const TIMELINE_GRID_STEP_MINUTES = 30;

function floorTimelineMinute(value: number, step = TIMELINE_GRID_STEP_MINUTES): number {
  return clampTimelineMinute(Math.floor(value / step) * step);
}

function ceilTimelineMinute(value: number, step = TIMELINE_GRID_STEP_MINUTES): number {
  return clampTimelineMinute(Math.ceil(value / step) * step);
}

function buildTimelineLabels(start: number, end: number): number[] {
  const labels: number[] = [];
  for (let minutes = start; minutes <= end; minutes += 60) labels.push(minutes);
  if (labels[labels.length - 1] !== end) labels.push(end);
  return labels;
}

function timelineLabelTop(minutes: number, start: number, span: number): string {
  return `clamp(10px, ${((minutes - start) / span) * 100}%, calc(100% - 10px))`;
}

type CalendarViewMode = 'day' | 'week' | 'month';
type CalendarBooking = ChipyBooking & {
  calendarScope?: 'business' | 'staff';
  staffId?: string | null;
  staffName?: string | null;
  staffColor?: string | null;
  groupedBookings?: CalendarBooking[];
};

const TEAM_BOOKING_COLORS = ['#F97316', '#06B6D4', '#22C55E', '#A855F7', '#F59E0B', '#EC4899', '#14B8A6'];

function colorHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash) + value.charCodeAt(i);
  return Math.abs(hash);
}

function bookingKey(booking: CalendarBooking): string {
  return `${booking.calendarScope ?? 'business'}:${booking.staffId ?? 'betrieb'}:${booking.id}`;
}

function bookingGroupMembers(booking: CalendarBooking): CalendarBooking[] {
  return booking.groupedBookings?.length ? booking.groupedBookings : [booking];
}

function bookingDisplayCount(booking: CalendarBooking): number {
  return bookingGroupMembers(booking).length;
}

function isGroupedBooking(booking: CalendarBooking): boolean {
  return bookingGroupMembers(booking).length > 1;
}

function bookingAccent(booking: CalendarBooking): string {
  if (isGroupedBooking(booking)) return '#06B6D4';
  if (booking.staffColor?.trim()) return booking.staffColor.trim();
  if (booking.calendarScope === 'staff') {
    const key = booking.staffId ?? booking.staffName ?? booking.id;
    return TEAM_BOOKING_COLORS[colorHash(key) % TEAM_BOOKING_COLORS.length]!;
  }
  return '#F97316';
}

function hexToRgba(color: string, alpha: number): string {
  const hex = color.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return `rgba(249,115,22,${alpha})`;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function bookingSourceLabel(booking: CalendarBooking): string {
  const members = bookingGroupMembers(booking);
  if (members.length > 1) return `${members.length} Termine`;
  return booking.calendarScope === 'staff' && booking.staffName ? booking.staffName : 'Betrieb';
}

function bookingWithBusinessMeta(booking: ChipyBooking): CalendarBooking {
  return { ...booking, calendarScope: 'business', staffId: null, staffName: 'Betrieb', staffColor: '#F97316' };
}

function bookingWithStaffMeta(booking: ChipyBooking, staff: CalendarStaff): CalendarBooking {
  return { ...booking, calendarScope: 'staff', staffId: staff.id, staffName: staff.name, staffColor: staff.color };
}

function bookingOverlapOffset(bookings: CalendarBooking[], booking: CalendarBooking): number {
  const start = dateToLocalMinutes(booking.slot_time);
  const end = start + bookingDuration(booking) + bookingBuffer(booking);
  return Math.min(4, bookings.filter((other) => {
    if (bookingKey(other) === bookingKey(booking)) return false;
    if (other.slot_time.localeCompare(booking.slot_time) > 0) return false;
    const otherStart = dateToLocalMinutes(other.slot_time);
    const otherEnd = otherStart + bookingDuration(other) + bookingBuffer(other);
    return otherStart < end && otherEnd > start;
  }).length);
}

function groupCalendarBookingsByStart(bookings: CalendarBooking[]): CalendarBooking[] {
  const groups = new Map<string, CalendarBooking[]>();
  for (const booking of bookings) {
    const key = new Date(booking.slot_time).getTime().toString();
    const arr = groups.get(key);
    if (arr) arr.push(booking);
    else groups.set(key, [booking]);
  }

  return [...groups.values()].flatMap((group) => {
    const sorted = [...group].sort((a, b) =>
      (a.staffName ?? '').localeCompare(b.staffName ?? '')
      || a.customer_name.localeCompare(b.customer_name)
      || a.id.localeCompare(b.id),
    );
    if (sorted.length < 2) return sorted;
    const first = sorted[0]!;
    const maxDuration = Math.max(...sorted.map(bookingDuration));
    const maxBuffer = Math.max(...sorted.map(bookingBuffer));
    return [{
      ...first,
      id: `group:${new Date(first.slot_time).getTime()}:${sorted.map((item) => bookingKey(item)).join('|')}`,
      customer_name: `${sorted.length} Termine gleichzeitig`,
      customer_phone: '',
      service: 'Mehrere Mitarbeiter',
      notes: null,
      duration_minutes: maxDuration,
      buffer_minutes: maxBuffer,
      calendarScope: 'business',
      staffId: null,
      staffName: 'Team',
      staffColor: '#06B6D4',
      groupedBookings: sorted,
    } satisfies CalendarBooking];
  }).sort((a, b) => a.slot_time.localeCompare(b.slot_time));
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatWeekRange(start: Date): string {
  const end = addDays(start, 6);
  const startLabel = start.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
  const endLabel = end.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${startLabel} - ${endLabel}`;
}

function dayBounds(dateStr: string) {
  return {
    start: new Date(`${dateStr}T00:00:00`),
    end: new Date(`${dateStr}T23:59:59.999`),
  };
}

// ── Provider badge ────────────────────────────────────────────────────────────

type ProviderMeta = { label: string; color: string; bg: string; icon: string };
const PROVIDER_META: Record<string, ProviderMeta> = {
  google:    { label: 'Google Calendar',   color: '#4285F4', bg: 'rgba(66,133,244,0.08)',   icon: '📅' },
  microsoft: { label: 'Microsoft Outlook', color: '#0078D4', bg: 'rgba(0,120,212,0.12)',    icon: '🪟' },
  calcom:    { label: 'Cal.com',           color: '#3B82F6', bg: 'rgba(59,130,246,0.12)',   icon: '🔵' },
  chipy:    { label: 'Chipy Kalender',   color: '#F97316', bg: 'rgba(249,115,22,0.12)',   icon: '🐾' },
};
const DEFAULT_PROVIDER_META: ProviderMeta = { label: 'Chipy Kalender', color: '#F97316', bg: 'rgba(249,115,22,0.12)', icon: '🐾' };

// ── Booking Modal ─────────────────────────────────────────────────────────────

function BookingModal({
  date, onClose, onSave, createBookingApi, serviceOptions = [],
}: {
  date: Date;
  onClose: () => void;
  onSave: (booking: ChipyBooking) => void;
  createBookingApi?: (data: ChipyBookingInput) => Promise<{ ok: boolean; booking: ChipyBooking }>;
  serviceOptions?: CalendarServiceOption[];
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [service, setService] = useState('');
  const [notes, setNotes] = useState('');
  const [time, setTime] = useState('09:00');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [bufferMinutes, setBufferMinutes] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateStr = isoDate(date);
  const serviceListId = `service-options-${dateStr}`;

  useEffect(() => {
    const normalized = normalizeServiceName(service);
    const match = serviceOptions.find((option) => normalizeServiceName(option.label) === normalized);
    if (!match) return;
    setDurationMinutes(match.durationMinutes);
    setBufferMinutes(match.bufferMinutes);
  }, [service, serviceOptions]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      const slotTime = `${dateStr}T${time}:00`;
      const res = await (createBookingApi ?? createChipyBooking)({
        customer_name: name,
        customer_phone: phone.trim(),
        service: service || undefined,
        notes: notes || undefined,
        slot_time: slotTime,
        duration_minutes: durationMinutes,
        buffer_minutes: bufferMinutes,
      });
      onSave(res.booking);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Fehler beim Speichern');
      setLoading(false);
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
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
            <label className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Telefon</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+49 123 456789"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Service</label>
            <input type="text" value={service} onChange={e => setService(e.target.value)} list={serviceOptions.length ? serviceListId : undefined} placeholder="z.B. Haarschnitt, Beratung..."
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
            {serviceOptions.length > 0 && (
              <datalist id={serviceListId}>
                {serviceOptions.map((option) => <option key={option.label} value={option.label} />)}
              </datalist>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Dauer</label>
              <input type="number" min={5} max={480} value={durationMinutes} onChange={e => setDurationMinutes(Number(e.target.value))}
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Puffer danach</label>
              <input type="number" min={0} max={180} value={bufferMinutes} onChange={e => setBufferMinutes(Number(e.target.value))}
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
            </div>
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
            <button type="submit" disabled={loading || !name || durationMinutes < 5 || bufferMinutes < 0}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-all"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
              {loading ? 'Speichern…' : 'Termin anlegen'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

// ── Day Detail Drawer ─────────────────────────────────────────────────────────

function BookingDetailsModal({
  booking, onClose, onOpenCustomer, onDelete,
}: {
  booking: CalendarBooking;
  onClose: () => void;
  onOpenCustomer?: (booking: CalendarBooking) => void | Promise<void>;
  onDelete?: (booking: CalendarBooking) => void | Promise<void>;
}) {
  const [confirmingDeleteKey, setConfirmingDeleteKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const groupMembers = bookingGroupMembers(booking);
  const grouped = groupMembers.length > 1;
  const startMinutes = dateToLocalMinutes(booking.slot_time);
  const duration = bookingDuration(booking);
  const buffer = bookingBuffer(booking);
  const endMinutes = startMinutes + duration;
  const bufferEnd = endMinutes + buffer;
  const accent = bookingAccent(booking);
  const dateLabel = new Date(booking.slot_time).toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const headerTitle = grouped ? `${groupMembers.length} Termine gleichzeitig` : booking.customer_name;
  const bookingDeleteKey = bookingKey(booking);
  const confirmingSingleDelete = confirmingDeleteKey === bookingDeleteKey;
  const deletingSingle = deletingKey === bookingDeleteKey;

  async function handleDelete(target: CalendarBooking) {
    if (!onDelete) return;
    const targetKey = bookingKey(target);
    if (confirmingDeleteKey !== targetKey) {
      setConfirmingDeleteKey(targetKey);
      setError(null);
      return;
    }
    setDeletingKey(targetKey);
    setError(null);
    try {
      await onDelete(target);
      onClose();
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Termin konnte nicht gelöscht werden.');
      setDeletingKey(null);
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 shadow-[0_32px_120px_rgba(0,0,0,0.62)]" style={{ background: '#14141F' }} role="dialog" aria-modal="true" aria-labelledby="booking-details-title">
        <div className="relative border-b border-white/8 p-5">
          <span className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${accent}, rgba(6,182,212,0.7))` }} />
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">Termindetails</p>
              <h3 id="booking-details-title" className="mt-1 truncate text-xl font-bold text-white">{headerTitle}</h3>
              <p className="mt-1 text-sm text-white/45">{bookingSourceLabel(booking)} · {dateLabel}</p>
            </div>
            <button onClick={onClose} className="rounded-xl px-2.5 py-1.5 text-xl leading-none text-white/35 transition-colors hover:bg-white/5 hover:text-white" aria-label="Schließen">×</button>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">Uhrzeit</p>
              <p className="mt-1 text-lg font-bold text-white">{minutesLabel(startMinutes)}-{minutesLabel(endMinutes)}</p>
              <p className="mt-1 text-xs text-white/40">{duration} Minuten{buffer > 0 ? ` + ${buffer} Minuten Puffer` : ''}</p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">Leistung</p>
              <p className="mt-1 text-sm font-semibold text-white">{booking.service || 'Termin'}</p>
              {buffer > 0 && <p className="mt-1 text-xs text-cyan-100/55">Blockiert bis {minutesLabel(bufferEnd)}</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-black/18 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">Kontakt</p>
            <p className="mt-2 text-sm text-white/70">{booking.customer_phone || 'Keine Telefonnummer hinterlegt'}</p>
          </div>

          {booking.notes && (
            <div className="rounded-2xl border border-white/8 bg-black/18 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">Notizen</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/62">{booking.notes}</p>
            </div>
          )}

          {grouped && (
            <div className="rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.055] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/55">Alle Termine in diesem Slot</p>
              <div className="mt-3 space-y-2">
                {groupMembers.map((member) => {
                  const memberKey = bookingKey(member);
                  const memberStart = dateToLocalMinutes(member.slot_time);
                  const memberDuration = bookingDuration(member);
                  const memberEnd = memberStart + memberDuration;
                  const memberConfirming = confirmingDeleteKey === memberKey;
                  const memberDeleting = deletingKey === memberKey;
                  const memberAccent = bookingAccent(member);
                  return (
                    <div key={memberKey} className="rounded-2xl border border-white/8 bg-black/18 p-3">
                      <div className="flex items-start gap-3">
                        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: memberAccent }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-white">{member.customer_name}</p>
                            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-semibold text-white/45">{bookingSourceLabel(member)}</span>
                          </div>
                          <p className="mt-1 text-xs text-white/50">{minutesLabel(memberStart)}-{minutesLabel(memberEnd)} · {memberDuration} min · {member.service || 'Termin'}</p>
                          {member.customer_phone && <p className="mt-0.5 text-[11px] text-white/32">{member.customer_phone}</p>}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {onOpenCustomer && (
                          <button type="button" onClick={() => { void onOpenCustomer(member); }} className="rounded-xl border border-orange-400/20 bg-orange-500/10 px-3 py-2 text-xs font-semibold text-orange-100/80 hover:text-orange-50">
                            Kundenmodul öffnen
                          </button>
                        )}
                        {onDelete && (
                          <button type="button" onClick={() => { void handleDelete(member); }} disabled={memberDeleting} className={[
                            'rounded-xl border px-3 py-2 text-xs font-semibold transition-all disabled:opacity-50',
                            memberConfirming ? 'border-red-400/40 bg-red-500/20 text-red-50' : 'border-red-400/20 bg-red-500/10 text-red-100/70 hover:bg-red-500/15',
                          ].join(' ')}>
                            {memberDeleting ? 'Löscht...' : memberConfirming ? 'Löschen bestätigen' : 'Termin löschen'}
                          </button>
                        )}
                        {memberConfirming && (
                          <button type="button" onClick={() => { setConfirmingDeleteKey(null); setError(null); }} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/50 hover:text-white">
                            Abbrechen
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {confirmingDeleteKey && !grouped && (
            <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-100/80">
              Bitte bestätige das Löschen bewusst. Der Termin wird aus diesem Kalender entfernt.
            </div>
          )}
          {error && <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-100/80">{error}</div>}

          {!grouped && <div className="flex flex-col gap-2 sm:flex-row">
            {onOpenCustomer && (
              <button type="button" onClick={() => { void onOpenCustomer(booking); }} className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_36px_rgba(249,115,22,0.18)]" style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
                Kundenmodul öffnen
              </button>
            )}
            {onDelete && (
              <button type="button" onClick={() => { void handleDelete(booking); }} disabled={deletingSingle} className={[
                'rounded-xl border px-4 py-3 text-sm font-semibold transition-all disabled:opacity-50',
                confirmingSingleDelete ? 'border-red-400/40 bg-red-500/20 text-red-50' : 'border-red-400/20 bg-red-500/10 text-red-100/75 hover:bg-red-500/15',
                onOpenCustomer ? 'sm:w-44' : 'flex-1',
              ].join(' ')}>
                {deletingSingle ? 'Löscht...' : confirmingSingleDelete ? 'Löschen bestätigen' : 'Termin löschen'}
              </button>
            )}
            {confirmingSingleDelete && (
              <button type="button" onClick={() => { setConfirmingDeleteKey(null); setError(null); }} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-white/55 hover:text-white">
                Abbrechen
              </button>
            )}
          </div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function _DayDrawer({
  date, bookings, blocks, externalEvents, schedule, onClose, onAddBooking, onDeleteBooking, onOpenCustomer, onAddBlock, onRemoveBlock,
}: {
  date: Date;
  bookings: ChipyBooking[];
  blocks: ChipyBlock[];
  externalEvents: ExternalCalendarEvent[];
  schedule?: ChipySchedule;
  onClose: () => void;
  onAddBooking: () => void;
  onDeleteBooking: (id: string) => void;
  onOpenCustomer: (booking: ChipyBooking) => void;
  onAddBlock: (opts?: { start_time?: string; end_time?: string; reason?: string }) => void;
  onRemoveBlock: (id: string) => Promise<void>;
}) {
  const dateStr = isoDate(date);
  const dayBlocks = blocks.filter(b => b.date === dateStr);
  const fullDayBlock = dayBlocks.find(b => !b.start_time);
  const isFullBlocked = !!fullDayBlock;
  const dayBookings = bookings.filter(b => bookingDateKey(b) === dateStr).sort((a, b) => a.slot_time.localeCompare(b.slot_time));
  // Filter external events to this day — provider returns UTC timestamps,
  // we compare against local date string. Events that span midnight show
  // up on both days (intentional — the user sees the "busy" bleed).
  const dayExternal = externalEvents.filter(ev => {
    const s = new Date(ev.slot_start);
    const e = new Date(ev.slot_end);
    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999`);
    return e > dayStart && s < dayEnd;
  });

  const daySchedule = schedule?.[date.getDay().toString()];
  const baseStart = daySchedule?.enabled ? clockToMinutes(daySchedule.start) ?? 8 * 60 : 8 * 60;
  const baseEnd = daySchedule?.enabled ? clockToMinutes(daySchedule.end) ?? 18 * 60 : 18 * 60;
  const timedBlockRanges = dayBlocks
    .filter((block) => block.start_time && block.end_time)
    .map((block) => ({
      block,
      start: clockToMinutes(block.start_time) ?? baseStart,
      end: clockToMinutes(block.end_time) ?? baseEnd,
    }));
  const bookingRanges = dayBookings.map((booking) => {
    const start = dateToLocalMinutes(booking.slot_time);
    const duration = bookingDuration(booking);
    const buffer = bookingBuffer(booking);
    return { booking, start, end: start + duration, bufferEnd: start + duration + buffer, duration, buffer };
  });
  const externalRanges = dayExternal
    .filter((event) => !event.all_day)
    .map((event) => {
      const startKey = isoDate(new Date(event.slot_start));
      const endKey = isoDate(new Date(event.slot_end));
      const start = startKey < dateStr ? 0 : dateToLocalMinutes(event.slot_start);
      const rawEnd = endKey > dateStr ? 24 * 60 : dateToLocalMinutes(event.slot_end);
      return { event, start, end: Math.max(start + 15, rawEnd) };
    });
  const timelineStart = Math.max(0, Math.min(baseStart, ...bookingRanges.map((item) => item.start), ...externalRanges.map((item) => item.start), ...timedBlockRanges.map((item) => item.start)));
  const timelineEnd = Math.min(24 * 60, Math.max(baseEnd, ...bookingRanges.map((item) => item.bufferEnd), ...externalRanges.map((item) => item.end), ...timedBlockRanges.map((item) => item.end)));
  const timelineSpan = Math.max(60, timelineEnd - timelineStart);
  const timelineHeight = Math.max(520, Math.ceil(timelineSpan * 1.35));
  const topFor = (minutes: number) => `${((minutes - timelineStart) / timelineSpan) * 100}%`;
  const heightFor = (start: number, end: number, min = 34) => Math.max(min, ((end - start) / timelineSpan) * timelineHeight);

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

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overscroll-contain" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-md max-h-[calc(100vh-2rem)] rounded-2xl border border-white/10 overflow-hidden shadow-[0_28px_90px_rgba(0,0,0,0.55)]" style={{ background: '#14141F' }} role="dialog" aria-modal="true" aria-labelledby="day-drawer-title">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-orange-200/60">Tagesansicht</p>
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

        <div className="px-5 py-4 max-h-[calc(100vh-12rem)] overflow-y-auto space-y-4">
          <div className="rounded-2xl border border-white/8 bg-black/18 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-white/75">{minutesLabel(timelineStart)} bis {minutesLabel(timelineEnd)}</p>
                <p className="text-[10px] text-white/32">Termine werden nach echter Dauer und Puffer dargestellt.</p>
              </div>
              {!daySchedule?.enabled && <span className="rounded-full border border-red-400/20 bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-200/80">Geschlossen</span>}
            </div>
            <div className="relative overflow-hidden rounded-xl border border-white/8 bg-white/[0.025]" style={{ height: timelineHeight }}>
              {Array.from({ length: Math.floor(timelineSpan / 60) + 1 }).map((_, index) => {
                const minutes = timelineStart + index * 60;
                if (minutes > timelineEnd) return null;
                return (
                  <div key={minutes} className="absolute left-0 right-0 border-t border-white/[0.055]" style={{ top: topFor(minutes) }}>
                    <span className="absolute left-2 -translate-y-1/2 rounded bg-[#14141F] px-1.5 py-0.5 font-mono text-[10px] text-white/35">{minutesLabel(minutes)}</span>
                  </div>
                );
              })}

              {timedBlockRanges.map(({ block, start, end }) => (
                <div
                  key={block.id}
                  className="absolute left-14 right-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100/80"
                  style={{ top: topFor(start), height: heightFor(start, end, 30) }}
                >
                  <p className="font-semibold">{minutesLabel(start)}-{minutesLabel(end)} gesperrt</p>
                  {block.reason && <p className="mt-0.5 truncate text-red-100/45">{block.reason}</p>}
                </div>
              ))}

              {externalRanges.map(({ event, start, end }) => (
                <div
                  key={`${event.provider}:${event.external_id}:timeline`}
                  className="absolute left-14 right-3 rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2 text-xs text-white/65"
                  style={{ top: topFor(start), height: heightFor(start, end, 30) }}
                >
                  <p className="truncate font-semibold">{event.summary || 'Externer Termin'}</p>
                  <p className="mt-0.5 text-[10px] text-white/32">{minutesLabel(start)}-{minutesLabel(end)} · {event.provider}</p>
                </div>
              ))}

              {bookingRanges.map(({ booking, start, end, bufferEnd, duration, buffer }) => (
                <button
                  key={`${booking.id}:timeline`}
                  type="button"
                  data-booking-id={booking.id}
                  onClick={() => onOpenCustomer(booking)}
                  className="absolute left-14 right-3 overflow-hidden rounded-2xl border border-orange-400/25 bg-gradient-to-r from-orange-500/[0.22] via-orange-500/[0.12] to-cyan-500/[0.13] px-3 py-2 text-left shadow-[0_14px_38px_rgba(0,0,0,0.24)]"
                  style={{ top: topFor(start), height: heightFor(start, bufferEnd, 42) }}
                  title="Kundendetails öffnen"
                >
                  <div className="relative z-10">
                    <p className="truncate text-sm font-bold text-white">{booking.customer_name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-orange-50/65">{booking.service || 'Termin'} · {minutesLabel(start)}-{minutesLabel(end)} · {duration} min</p>
                    {buffer > 0 && <p className="mt-1 text-[10px] text-cyan-100/55">Puffer bis {minutesLabel(bufferEnd)} ({buffer} min)</p>}
                  </div>
                  {buffer > 0 && <div className="absolute bottom-0 left-0 right-0 border-t border-dashed border-cyan-200/35 bg-cyan-300/[0.06]" style={{ height: `${Math.max(12, (buffer / Math.max(duration + buffer, 1)) * 100)}%` }} />}
                </button>
              ))}
            </div>
          </div>
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
                <div
                  key={b.id}
                  data-booking-id={b.id}
                  className="group relative overflow-hidden rounded-2xl border border-orange-500/15 bg-gradient-to-r from-orange-500/[0.10] via-white/[0.045] to-cyan-500/[0.07] p-3 shadow-[0_14px_42px_rgba(0,0,0,0.22)]"
                >
                  <div className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-orange-400/10 blur-2xl transition-opacity group-hover:opacity-80" />
                  <div className="relative flex items-start gap-3">
                    <div className="shrink-0 rounded-xl border border-orange-400/20 bg-black/25 px-2.5 py-2 text-center">
                      <p className="font-mono text-xs font-semibold text-orange-200">{formatTime(b.slot_time)}</p>
                      <p className="mt-0.5 text-[9px] uppercase tracking-[0.14em] text-white/25">Uhr</p>
                    </div>
                  <button
                    type="button"
                    onClick={() => onOpenCustomer(b)}
                    className="min-w-0 flex-1 text-left cursor-pointer"
                    title="Kundendetails öffnen"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-white transition-colors group-hover:text-orange-100">{b.customer_name}</p>
                      {b.service && <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/45">{b.service}</span>}
                    </div>
                    <p className="mt-1 truncate text-xs text-white/40">{b.customer_phone || 'Keine Nummer gespeichert'}</p>
                    {b.notes && <p className="mt-1 line-clamp-2 text-xs text-white/30">{b.notes}</p>}
                    <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-orange-400/20 bg-orange-500/10 px-2 py-1 text-[10px] font-semibold text-orange-100/70 transition-colors group-hover:text-orange-50">
                      Kundendetails öffnen
                    </span>
                  </button>
                  <button onClick={() => onDeleteBooking(b.id)} className="shrink-0 rounded-lg px-2 py-1 text-xs text-red-300/45 transition-colors hover:bg-red-500/10 hover:text-red-200 cursor-pointer">Löschen</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* External events — read-only, synced every 5 min by the
              calendar-sync cron. Muted grey styling so they're clearly
              distinguishable from Chipy-own bookings (which use orange). */}
          {dayExternal.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">Extern</p>
              {dayExternal.map(ev => (
                <div key={`${ev.provider}:${ev.external_id}`}
                  className="flex items-start gap-3 rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5">
                  <div className="shrink-0 text-white/40 font-mono text-xs mt-0.5 w-10">
                    {ev.all_day
                      ? '—'
                      : new Date(ev.slot_start).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/70 truncate">{ev.summary || 'Ohne Titel'}</p>
                    <p className="text-[10px] text-white/30 tracking-wide">
                      {ev.all_day ? 'Ganztägig · ' : ''}
                      {ev.provider === 'google' ? 'Google Calendar' : ev.provider === 'microsoft' ? 'Microsoft Outlook' : 'Cal.com'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {dayBookings.length === 0 && dayBlocks.length === 0 && dayExternal.length === 0 && (
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
    </div>,
    document.body,
  );
}

// ── Monthly Calendar Grid ─────────────────────────────────────────────────────

function CalendarViewSwitch({ value, onChange }: { value: CalendarViewMode; onChange: (value: CalendarViewMode) => void }) {
  const labels: Record<CalendarViewMode, string> = { day: 'Tag', week: 'Woche', month: 'Monat' };
  return (
    <div className="flex shrink-0 gap-1 rounded-2xl border border-white/8 bg-black/20 p-1">
      {(['day', 'week', 'month'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={[
            'rounded-xl px-3 py-2 text-xs font-semibold transition-all',
            value === mode ? 'text-white shadow-[0_10px_30px_rgba(249,115,22,0.16)]' : 'text-white/35 hover:text-white/65',
          ].join(' ')}
          style={value === mode ? { background: 'linear-gradient(135deg, rgba(249,115,22,0.28), rgba(6,182,212,0.22))' } : undefined}
        >
          {labels[mode]}
        </button>
      ))}
    </div>
  );
}

function WeeklyCalendar({
  bookings, blocks, externalEvents, schedule, weekStart, onWeekStartChange, onBookingClick, onAddBookingForDay, onDayClick,
  className = '',
}: {
  bookings: CalendarBooking[];
  blocks: ChipyBlock[];
  externalEvents: ExternalCalendarEvent[];
  schedule?: ChipySchedule;
  weekStart: Date;
  onWeekStartChange: (date: Date) => void;
  onBookingClick: (booking: CalendarBooking) => void;
  onAddBookingForDay?: (date: Date) => void;
  onDayClick?: (date: Date) => void;
  className?: string;
}) {
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const dayKeys = useMemo(() => new Set(weekDays.map(isoDate)), [weekDays]);

  const bookingsByDay = useMemo(() => {
    const map = new Map<string, CalendarBooking[]>();
    for (const booking of bookings) {
      const key = bookingDateKey(booking);
      if (!dayKeys.has(key)) continue;
      const arr = map.get(key);
      if (arr) arr.push(booking);
      else map.set(key, [booking]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.slot_time.localeCompare(b.slot_time));
    return map;
  }, [bookings, dayKeys]);

  const blocksByDay = useMemo(() => {
    const map = new Map<string, ChipyBlock[]>();
    for (const block of blocks) {
      if (!dayKeys.has(block.date)) continue;
      const arr = map.get(block.date);
      if (arr) arr.push(block);
      else map.set(block.date, [block]);
    }
    return map;
  }, [blocks, dayKeys]);

  const externalByDay = useMemo(() => {
    const map = new Map<string, ExternalCalendarEvent[]>();
    for (const day of weekDays) {
      const key = isoDate(day);
      const bounds = dayBounds(key);
      const dayEvents = externalEvents.filter((event) => {
        const start = new Date(event.slot_start);
        const end = new Date(event.slot_end);
        return end > bounds.start && start < bounds.end;
      });
      if (dayEvents.length) map.set(key, dayEvents);
    }
    return map;
  }, [externalEvents, weekDays]);

  const getExternalRange = (event: ExternalCalendarEvent, dateStr: string) => {
    const startKey = isoDate(new Date(event.slot_start));
    const endKey = isoDate(new Date(event.slot_end));
    const start = startKey < dateStr ? 0 : dateToLocalMinutes(event.slot_start);
    const rawEnd = endKey > dateStr ? 24 * 60 : dateToLocalMinutes(event.slot_end);
    return {
      start: Math.max(0, start),
      end: Math.min(24 * 60, Math.max(start + 15, rawEnd)),
    };
  };

  const timelineBounds = useMemo(() => {
    const ranges: Array<{ start: number; end: number; span: number }> = [];
    const recordStarts: number[] = [];
    const recordEnds: number[] = [];
    for (const day of weekDays) {
      const key = isoDate(day);
      const daySchedule = schedule?.[day.getDay().toString()];
      if (daySchedule?.enabled) {
        const start = clockToMinutes(daySchedule.start);
        const end = clockToMinutes(daySchedule.end);
        if (start !== null && end !== null && end > start) {
          ranges.push({ start, end, span: end - start });
        }
      }
      for (const booking of bookingsByDay.get(key) ?? []) {
        const start = dateToLocalMinutes(booking.slot_time);
        recordStarts.push(start);
        recordEnds.push(start + bookingDuration(booking) + bookingBuffer(booking));
      }
      for (const block of blocksByDay.get(key) ?? []) {
        if (!block.start_time || !block.end_time) continue;
        const start = clockToMinutes(block.start_time);
        const end = clockToMinutes(block.end_time);
        if (start !== null && end !== null && end > start) {
          recordStarts.push(start);
          recordEnds.push(end);
        }
      }
      for (const event of externalByDay.get(key) ?? []) {
        if (event.all_day) continue;
        const range = getExternalRange(event, key);
        recordStarts.push(range.start);
        recordEnds.push(range.end);
      }
    }
    const longestWorkday = ranges.sort((a, b) => b.span - a.span || a.start - b.start || b.end - a.end)[0] ?? { start: 8 * 60, end: 18 * 60, span: 10 * 60 };
    let start = floorTimelineMinute(longestWorkday.start - TIMELINE_WORKDAY_PADDING_MINUTES);
    let end = ceilTimelineMinute(Math.max(longestWorkday.end + TIMELINE_WORKDAY_PADDING_MINUTES, start + 60));
    if (recordStarts.length) {
      start = Math.min(start, floorTimelineMinute(Math.min(...recordStarts)));
    }
    if (recordEnds.length) {
      end = Math.max(end, ceilTimelineMinute(Math.max(...recordEnds)));
    }
    return { start, end };
  }, [blocksByDay, bookingsByDay, externalByDay, schedule, weekDays]);

  const timelineStart = timelineBounds.start;
  const timelineEnd = timelineBounds.end;
  const timelineSpan = Math.max(60, timelineEnd - timelineStart);
  const timelineHeight = Math.max(620, Math.min(920, Math.ceil(timelineSpan * 1.05)));
  const hours = useMemo(() => buildTimelineLabels(timelineStart, timelineEnd), [timelineEnd, timelineStart]);
  const topFor = (minutes: number) => `${((minutes - timelineStart) / timelineSpan) * 100}%`;
  const labelTopFor = (minutes: number) => timelineLabelTop(minutes, timelineStart, timelineSpan);
  const heightFor = (start: number, end: number, min = 38) => Math.max(min, ((end - start) / timelineSpan) * timelineHeight);
  const calendarGridColumns = 'clamp(66px, 5.5vw, 88px) repeat(7, minmax(0, 1fr))';
  return (
    <div className={['flex min-h-0 flex-col rounded-3xl border border-white/10 bg-black/18 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]', className].filter(Boolean).join(' ')}>
      <div className="mb-2 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/28">Wochenansicht</p>
          <h3 className="mt-1 text-sm font-bold text-white">{formatWeekRange(weekStart)}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onWeekStartChange(addDays(weekStart, -7))} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-white/55 hover:text-white">Vorherige</button>
          <button type="button" onClick={() => onWeekStartChange(startOfWeek(new Date()))} className="rounded-xl border border-orange-400/20 bg-orange-500/10 px-3 py-2 text-xs font-semibold text-orange-100/75 hover:text-orange-50">Diese Woche</button>
          <button type="button" onClick={() => onWeekStartChange(addDays(weekStart, 7))} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-white/55 hover:text-white">Nächste</button>
        </div>
      </div>

      <div
        data-testid="weekly-calendar-grid"
        className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/8 bg-white/[0.025]"
        style={{ touchAction: 'pan-y', overscrollBehaviorX: 'none' }}
        onWheel={(event) => {
          if (event.deltaY === 0) return;
          const pageScroller = event.currentTarget.closest('main');
          if (!pageScroller) return;
          event.preventDefault();
          pageScroller.scrollBy({ top: event.deltaY, left: 0 });
        }}
      >
        <div className="w-full min-w-0">
          <div className="grid border-b border-white/8" style={{ gridTemplateColumns: calendarGridColumns }}>
            <div className="border-r border-white/8 bg-black/16" />
            {weekDays.map((day, index) => {
              const key = isoDate(day);
              const isToday = key === todayISO();
              const daySchedule = schedule?.[day.getDay().toString()];
              const enabled = daySchedule?.enabled ?? true;
              const fullDayBlock = (blocksByDay.get(key) ?? []).find((block) => !block.start_time);
              const allDayExternal = (externalByDay.get(key) ?? []).filter((event) => event.all_day);
              const canAdd = Boolean(onAddBookingForDay && enabled && !fullDayBlock);
              return (
                <div key={key} className={['min-h-[72px] border-r border-white/8 p-2.5 last:border-r-0', isToday ? 'bg-orange-500/[0.07]' : 'bg-black/10'].join(' ')}>
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => onDayClick?.(day)} className="min-w-0 text-left">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/28">{DAY_SHORT[index]}</p>
                      <p className={['mt-1 text-sm font-bold transition-colors', isToday ? 'text-orange-200' : 'text-white hover:text-orange-100'].join(' ')}>{day.getDate()}. {MONTH_NAMES[day.getMonth()]}</p>
                    </button>
                    {canAdd && (
                      <button type="button" onClick={() => onAddBookingForDay?.(day)} className="rounded-lg border border-orange-400/20 bg-orange-500/10 px-2 py-1 text-xs font-bold text-orange-100/75 hover:text-orange-50" aria-label="Termin anlegen">+</button>
                    )}
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {!enabled && <p className="truncate rounded-lg border border-red-400/20 bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-200/75">Geschlossen</p>}
                    {fullDayBlock && <p className="truncate rounded-lg border border-red-400/20 bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-200/75">Ganztag gesperrt</p>}
                    {allDayExternal.slice(0, 2).map((event) => (
                      <p key={`${event.provider}:${event.external_id}:all-day`} className="truncate rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] text-white/45">{event.summary || 'Externer Termin'}</p>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid" style={{ gridTemplateColumns: calendarGridColumns }}>
            <div data-testid="calendar-time-column" className="relative border-r border-white/8 bg-black/20" style={{ height: timelineHeight }}>
              {hours.map((minutes) => (
                <div key={`${minutes}:line`} className="absolute left-0 right-0 border-t border-white/[0.055]" style={{ top: topFor(minutes) }} />
              ))}
              {hours.map((minutes) => (
                <span key={`${minutes}:label`} data-testid="calendar-time-label" className="absolute right-2 -translate-y-1/2 whitespace-nowrap rounded-sm bg-black/40 px-0.5 font-mono text-[11px] leading-none tabular-nums text-white/50" style={{ top: labelTopFor(minutes) }}>
                  {minutesLabel(minutes)}
                </span>
              ))}
            </div>

            {weekDays.map((day) => {
              const key = isoDate(day);
              const timedBlocks = (blocksByDay.get(key) ?? []).filter((block) => block.start_time && block.end_time);
              const dayBookings = bookingsByDay.get(key) ?? [];
              const dayExternal = externalByDay.get(key) ?? [];
              const isToday = key === todayISO();
              return (
                <div key={`${key}:body`} className={['relative border-r border-white/8 last:border-r-0', isToday ? 'bg-orange-500/[0.035]' : 'bg-transparent'].join(' ')} style={{ height: timelineHeight }}>
                  {hours.map((minutes) => (
                    <div key={`${key}:${minutes}`} className="absolute left-0 right-0 border-t border-white/[0.045]" style={{ top: topFor(minutes) }} />
                  ))}

                  {timedBlocks.map((block) => {
                    const start = clockToMinutes(block.start_time) ?? timelineStart;
                    const end = clockToMinutes(block.end_time) ?? timelineEnd;
                    return (
                      <div key={block.id} className="absolute left-1.5 right-1.5 overflow-hidden rounded-xl border border-red-400/25 bg-red-500/10 px-2 py-1.5 text-left" style={{ top: topFor(start), height: heightFor(start, end, 30) }}>
                        <p className="truncate text-[10px] font-semibold text-red-100/80">{minutesLabel(start)}-{minutesLabel(end)}</p>
                        <p className="truncate text-[10px] text-red-100/45">{block.reason || 'Gesperrt'}</p>
                      </div>
                    );
                  })}

                  {dayExternal.filter((event) => !event.all_day).map((event) => {
                    const range = getExternalRange(event, key);
                    return (
                      <div key={`${event.provider}:${event.external_id}:${key}`} className="absolute left-1.5 right-1.5 overflow-hidden rounded-xl border border-white/10 bg-white/[0.07] px-2 py-1.5 text-left" style={{ top: topFor(range.start), height: heightFor(range.start, range.end, 30) }}>
                        <p className="truncate text-[10px] font-semibold text-white/60">{event.summary || 'Externer Termin'}</p>
                        <p className="truncate text-[10px] text-white/28">{minutesLabel(range.start)}-{minutesLabel(range.end)} · {event.provider}</p>
                      </div>
                    );
                  })}

                  {dayBookings.map((booking) => {
                    const start = dateToLocalMinutes(booking.slot_time);
                    const duration = bookingDuration(booking);
                    const buffer = bookingBuffer(booking);
                    const end = start + duration;
                    const bufferEnd = end + buffer;
                    const accent = bookingAccent(booking);
                    const overlap = bookingOverlapOffset(dayBookings, booking);
                    const inset = 6 + overlap * 7;
                    return (
                      <button
                        key={bookingKey(booking)}
                        type="button"
                        data-booking-id={booking.id}
                        onClick={() => onBookingClick(booking)}
                        className="absolute overflow-hidden rounded-2xl border px-2.5 py-2 text-left shadow-[0_14px_36px_rgba(0,0,0,0.28)] transition-transform hover:-translate-y-0.5"
                        style={{
                          top: topFor(start),
                          height: heightFor(start, bufferEnd, 44),
                          left: `${inset}px`,
                          right: `${6 + Math.max(0, 4 - overlap) * 2}px`,
                          borderColor: hexToRgba(accent, 0.42),
                          background: `linear-gradient(135deg, ${hexToRgba(accent, 0.24)}, rgba(255,255,255,0.045) 48%, rgba(6,182,212,0.12))`,
                        }}
                        title="Kundendetails oeffnen"
                      >
                        <span className="absolute left-0 top-0 h-full w-1" style={{ background: accent }} />
                        <div className="relative z-10 pr-5">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
                            <p className="truncate text-xs font-bold text-white">{booking.customer_name}</p>
                          </div>
                          <p className="mt-0.5 truncate text-[10px] font-semibold text-white/55">{bookingSourceLabel(booking)}</p>
                          <p className="mt-0.5 truncate text-[10px] text-orange-50/70">{minutesLabel(start)}-{minutesLabel(end)} · {duration} min</p>
                          <p className="mt-0.5 truncate text-[10px] text-white/45">{booking.service || 'Termin'}</p>
                          {buffer > 0 && <p className="mt-1 truncate text-[10px] text-cyan-100/55">Puffer bis {minutesLabel(bufferEnd)}</p>}
                        </div>
                        {buffer > 0 && <div className="absolute bottom-0 left-0 right-0 border-t border-dashed border-cyan-200/35 bg-cyan-300/[0.07]" style={{ height: `${Math.max(12, (buffer / Math.max(duration + buffer, 1)) * 100)}%` }} />}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function DailyCalendar({
  date, bookings, blocks, externalEvents, schedule, onDateChange, onBookingClick, onAddBooking,
  className = '',
}: {
  date: Date;
  bookings: CalendarBooking[];
  blocks: ChipyBlock[];
  externalEvents: ExternalCalendarEvent[];
  schedule?: ChipySchedule;
  onDateChange: (date: Date) => void;
  onBookingClick: (booking: CalendarBooking) => void;
  onAddBooking?: (date: Date) => void;
  className?: string;
}) {
  const dateStr = isoDate(date);
  const dayBlocks = useMemo(() => blocks.filter((block) => block.date === dateStr), [blocks, dateStr]);
  const fullDayBlock = dayBlocks.find((block) => !block.start_time);
  const dayBookings = useMemo(
    () => bookings.filter((booking) => bookingDateKey(booking) === dateStr).sort((a, b) => a.slot_time.localeCompare(b.slot_time)),
    [bookings, dateStr],
  );
  const dayExternal = useMemo(() => {
    const bounds = dayBounds(dateStr);
    return externalEvents.filter((event) => {
      const start = new Date(event.slot_start);
      const end = new Date(event.slot_end);
      return end > bounds.start && start < bounds.end;
    });
  }, [dateStr, externalEvents]);

  const daySchedule = schedule?.[date.getDay().toString()];
  const baseStart = daySchedule?.enabled ? clockToMinutes(daySchedule.start) ?? 8 * 60 : 8 * 60;
  const baseEnd = daySchedule?.enabled ? clockToMinutes(daySchedule.end) ?? 18 * 60 : 18 * 60;
  const timedBlocks = dayBlocks
    .filter((block) => block.start_time && block.end_time)
    .map((block) => ({
      block,
      start: clockToMinutes(block.start_time) ?? baseStart,
      end: clockToMinutes(block.end_time) ?? baseEnd,
    }));
  const externalRanges = dayExternal
    .filter((event) => !event.all_day)
    .map((event) => {
      const startKey = isoDate(new Date(event.slot_start));
      const endKey = isoDate(new Date(event.slot_end));
      const start = startKey < dateStr ? 0 : dateToLocalMinutes(event.slot_start);
      const rawEnd = endKey > dateStr ? 24 * 60 : dateToLocalMinutes(event.slot_end);
      return { event, start, end: Math.min(24 * 60, Math.max(start + 15, rawEnd)) };
    });
  const bookingRanges = dayBookings.map((booking) => {
    const start = dateToLocalMinutes(booking.slot_time);
    const duration = bookingDuration(booking);
    const buffer = bookingBuffer(booking);
    return { booking, start, end: start + duration, bufferEnd: start + duration + buffer, duration, buffer };
  });
  const timelineStart = floorTimelineMinute(Math.min(
    baseStart - TIMELINE_WORKDAY_PADDING_MINUTES,
    ...bookingRanges.map((item) => item.start),
    ...externalRanges.map((item) => item.start),
    ...timedBlocks.map((item) => item.start),
  ));
  const timelineEnd = ceilTimelineMinute(Math.max(
    baseEnd + TIMELINE_WORKDAY_PADDING_MINUTES,
    ...bookingRanges.map((item) => item.bufferEnd),
    ...externalRanges.map((item) => item.end),
    ...timedBlocks.map((item) => item.end),
    timelineStart + 60,
  ));
  const timelineSpan = Math.max(60, timelineEnd - timelineStart);
  const timelineHeight = Math.max(620, Math.min(940, Math.ceil(timelineSpan * 1.05)));
  const hours = useMemo(() => buildTimelineLabels(timelineStart, timelineEnd), [timelineEnd, timelineStart]);
  const topFor = (minutes: number) => `${((minutes - timelineStart) / timelineSpan) * 100}%`;
  const labelTopFor = (minutes: number) => timelineLabelTop(minutes, timelineStart, timelineSpan);
  const heightFor = (start: number, end: number, min = 42) => Math.max(min, ((end - start) / timelineSpan) * timelineHeight);
  const sourceCounts = useMemo(() => {
    const map = new Map<string, { label: string; color: string; count: number }>();
    for (const booking of dayBookings) {
      const label = isGroupedBooking(booking) ? 'Gleichzeitige Termine' : bookingSourceLabel(booking);
      const count = bookingDisplayCount(booking);
      const existing = map.get(label);
      if (existing) existing.count += count;
      else map.set(label, { label, color: bookingAccent(booking), count });
    }
    return [...map.values()];
  }, [dayBookings]);
  const dayBookingCount = useMemo(
    () => dayBookings.reduce((sum, booking) => sum + bookingDisplayCount(booking), 0),
    [dayBookings],
  );
  const canAdd = Boolean(onAddBooking && daySchedule?.enabled !== false && !fullDayBlock);

  return (
    <div className={['rounded-3xl border border-white/10 bg-black/18 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]', className].filter(Boolean).join(' ')}>
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/28">Tagesansicht</p>
          <h3 className="mt-1 text-base font-bold text-white">
            {date.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
          </h3>
          <p className="mt-1 text-xs text-white/38">
            {dayBookingCount} Termin{dayBookingCount === 1 ? '' : 'e'} · {sourceCounts.length || 1} Kalenderquelle{sourceCounts.length === 1 ? '' : 'n'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onDateChange(addDays(date, -1))} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-white/55 hover:text-white">Vorheriger Tag</button>
          <button type="button" onClick={() => onDateChange(new Date())} className="rounded-xl border border-orange-400/20 bg-orange-500/10 px-3 py-2 text-xs font-semibold text-orange-100/75 hover:text-orange-50">Heute</button>
          <button type="button" onClick={() => onDateChange(addDays(date, 1))} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-white/55 hover:text-white">Naechster Tag</button>
          {canAdd && (
            <button type="button" onClick={() => onAddBooking?.(date)} className="rounded-xl px-3 py-2 text-xs font-semibold text-white shadow-[0_12px_30px_rgba(249,115,22,0.18)]" style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
              + Termin
            </button>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {sourceCounts.length > 0 ? sourceCounts.map((source) => (
          <span key={source.label} className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold text-white/70" style={{ borderColor: hexToRgba(source.color, 0.28), background: hexToRgba(source.color, 0.10) }}>
            <span className="h-2 w-2 rounded-full" style={{ background: source.color }} />
            {source.label} · {source.count}
          </span>
        )) : (
          <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-xs text-white/35">Keine Termine für diesen Tag</span>
        )}
        {fullDayBlock && <span className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200/75">Ganztag gesperrt</span>}
        {daySchedule?.enabled === false && <span className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200/75">Geschlossen</span>}
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-white/[0.025]" style={{ height: timelineHeight }}>
        {hours.map((minutes) => (
          <div key={`${minutes}:line`} className="absolute left-0 right-0 border-t border-white/[0.055]" style={{ top: topFor(minutes) }} />
        ))}
        {hours.map((minutes) => (
          <span key={`${minutes}:label`} className="absolute left-3 z-10 -translate-y-1/2 rounded-lg bg-[#11111A] px-2 py-0.5 font-mono text-[10px] text-white/45" style={{ top: labelTopFor(minutes) }}>
            {minutesLabel(minutes)}
          </span>
        ))}

        {timedBlocks.map(({ block, start, end }) => (
          <div key={block.id} className="absolute left-20 right-4 overflow-hidden rounded-2xl border border-red-400/22 bg-red-500/10 px-3 py-2 text-left" style={{ top: topFor(start), height: heightFor(start, end, 34) }}>
            <p className="truncate text-xs font-semibold text-red-100/80">{minutesLabel(start)}-{minutesLabel(end)} gesperrt</p>
            <p className="truncate text-[10px] text-red-100/45">{block.reason || 'Sperre'}</p>
          </div>
        ))}

        {externalRanges.map(({ event, start, end }) => (
          <div key={`${event.provider}:${event.external_id}:day`} className="absolute left-20 right-4 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-2 text-left" style={{ top: topFor(start), height: heightFor(start, end, 34) }}>
            <p className="truncate text-xs font-semibold text-white/60">{event.summary || 'Externer Termin'}</p>
            <p className="truncate text-[10px] text-white/28">{minutesLabel(start)}-{minutesLabel(end)} · {event.provider}</p>
          </div>
        ))}

        {bookingRanges.map(({ booking, start, end, bufferEnd, duration, buffer }) => {
          const accent = bookingAccent(booking);
          const overlap = bookingOverlapOffset(dayBookings, booking);
          const inset = 80 + overlap * 18;
          return (
            <button
              key={bookingKey(booking)}
              type="button"
              data-booking-id={booking.id}
              onClick={() => onBookingClick(booking)}
              className="absolute overflow-hidden rounded-3xl border px-4 py-3 text-left shadow-[0_18px_54px_rgba(0,0,0,0.32)] transition-transform hover:-translate-y-0.5"
              style={{
                top: topFor(start),
                height: heightFor(start, bufferEnd, 56),
                left: `${inset}px`,
                right: '16px',
                borderColor: hexToRgba(accent, 0.42),
                background: `linear-gradient(135deg, ${hexToRgba(accent, 0.25)}, rgba(255,255,255,0.045) 46%, rgba(6,182,212,0.12))`,
              }}
              title="Kundendetails oeffnen"
            >
              <span className="absolute left-0 top-0 h-full w-1.5" style={{ background: accent }} />
              <div className="relative z-10 pr-9">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
                  <p className="truncate text-sm font-bold text-white">{booking.customer_name}</p>
                  <span className="shrink-0 rounded-full border border-white/10 bg-black/18 px-2 py-0.5 text-[10px] font-semibold text-white/55">{bookingSourceLabel(booking)}</span>
                </div>
                <p className="mt-1 truncate text-xs text-orange-50/72">{minutesLabel(start)}-{minutesLabel(end)} · {duration} min · {booking.service || 'Termin'}</p>
                {booking.customer_phone && <p className="mt-0.5 truncate text-[10px] text-white/35">{booking.customer_phone}</p>}
                {buffer > 0 && <p className="mt-1 truncate text-[10px] text-cyan-100/58">Puffer bis {minutesLabel(bufferEnd)}</p>}
              </div>
              {buffer > 0 && <div className="absolute bottom-0 left-0 right-0 border-t border-dashed border-cyan-200/35 bg-cyan-300/[0.07]" style={{ height: `${Math.max(12, (buffer / Math.max(duration + buffer, 1)) * 100)}%` }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MonthlyCalendar({
  bookings, blocks, onDayClick,
}: {
  bookings: CalendarBooking[];
  blocks: ChipyBlock[];
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
    const map = new Map<string, CalendarBooking[]>();
    for (const b of bookings) {
      const ds = bookingDateKey(b);
      const arr = map.get(ds);
      if (arr) arr.push(b);
      else map.set(ds, [b]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.slot_time.localeCompare(b.slot_time));
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
          const visibleBookings = dayBookings.slice(0, 2);
          const dayBookingCount = dayBookings.reduce((sum, b) => sum + bookingDisplayCount(b), 0);
          const visibleBookingCount = visibleBookings.reduce((sum, b) => sum + bookingDisplayCount(b), 0);
          const hiddenBookingCount = Math.max(0, dayBookingCount - visibleBookingCount);

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
                  {visibleBookings.map(b => {
                    const grouped = isGroupedBooking(b);
                    return (
                      <div
                        key={bookingKey(b)}
                        className="truncate rounded-md border px-1.5 py-0.5 text-[9px] leading-tight text-white/80"
                        style={{
                          borderColor: hexToRgba(bookingAccent(b), 0.24),
                          background: hexToRgba(bookingAccent(b), 0.10),
                        }}
                      >
                        {formatTime(b.slot_time)} {grouped ? `${bookingDisplayCount(b)} gleichzeitig` : `${bookingSourceLabel(b)} · ${b.customer_name}`}
                      </div>
                    );
                  })}
                  {hiddenBookingCount > 0 && (
                    <div className="text-[9px] text-orange-400/60">+{hiddenBookingCount} weitere</div>
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
const DEFAULT_SCHEDULE: ChipySchedule = {
  '0': { enabled: false, start: '09:00', end: '17:00' },
  '1': { enabled: true,  start: '09:00', end: '17:00' },
  '2': { enabled: true,  start: '09:00', end: '17:00' },
  '3': { enabled: true,  start: '09:00', end: '17:00' },
  '4': { enabled: true,  start: '09:00', end: '17:00' },
  '5': { enabled: true,  start: '09:00', end: '17:00' },
  '6': { enabled: false, start: '09:00', end: '17:00' },
};

type BlockMode = 'day' | 'range' | 'hours';
const ALL_BLOCK_MODES: BlockMode[] = ['day', 'range', 'hours'];

function SettingsPanel({
  schedule, setSchedule, blocks, setBlocks, saveScheduleApi, addBlockApi, removeBlockApi,
  showSchedule = true,
  blockModeOptions = ALL_BLOCK_MODES,
  blockTitle = 'Ausnahmen & Sperrzeiten',
  blockDescription = 'Urlaub, Krankheit, Mittagspause oder einzelne Stunden.',
}: {
  schedule: ChipySchedule;
  setSchedule: React.Dispatch<React.SetStateAction<ChipySchedule>>;
  blocks: ChipyBlock[];
  setBlocks: React.Dispatch<React.SetStateAction<ChipyBlock[]>>;
  saveScheduleApi?: (schedule: ChipySchedule) => Promise<unknown>;
  addBlockApi?: (date: string, opts?: { start_time?: string; end_time?: string; reason?: string }) => Promise<{ ok: boolean; id: string }>;
  removeBlockApi?: (id: string) => Promise<unknown>;
  showSchedule?: boolean;
  blockModeOptions?: BlockMode[];
  blockTitle?: string;
  blockDescription?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newBlockDate, setNewBlockDate] = useState('');
  const [newBlockEndDate, setNewBlockEndDate] = useState('');
  const [newBlockStartTime, setNewBlockStartTime] = useState('');
  const [newBlockEndTime, setNewBlockEndTime] = useState('');
  const [newBlockReason, setNewBlockReason] = useState('');
  const [blockError, setBlockError] = useState<string | null>(null);
  const [blockMode, setBlockMode] = useState<BlockMode>('day');
  const allowedBlockModes = blockModeOptions.length ? blockModeOptions : ALL_BLOCK_MODES;

  useEffect(() => {
    if (!allowedBlockModes.includes(blockMode)) {
      setBlockMode(allowedBlockModes[0] ?? 'day');
    }
  }, [allowedBlockModes, blockMode]);

  async function handleSave() {
    setSaving(true); setSaved(false); setSaveError(null);
    try {
      await (saveScheduleApi ?? saveChipySchedule)(schedule);
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
      const res = await (addBlockApi ?? addChipyBlock)(newBlockDate, { reason: newBlockReason || undefined });
      setBlocks(prev => [...prev, { id: res.id, date: newBlockDate, start_time: null, end_time: null, reason: newBlockReason || null }]);
      setNewBlockDate(''); setNewBlockReason('');
    } catch (e: unknown) {
      setBlockError((e instanceof Error ? e.message : null) ?? 'Fehler');
    }
  }

  async function handleAddRange() {
    if (!newBlockDate || !newBlockEndDate) return;
    setBlockError(null);
    try {
      // Create a block for each day in the range
      const start = new Date(newBlockDate + 'T00:00:00');
      const end = new Date(newBlockEndDate + 'T00:00:00');
      const newBlocks: ChipyBlock[] = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = isoDate(d);
        const res = await (addBlockApi ?? addChipyBlock)(dateStr, { reason: newBlockReason || undefined });
        newBlocks.push({ id: res.id, date: dateStr, start_time: null, end_time: null, reason: newBlockReason || null });
      }
      setBlocks(prev => [...prev, ...newBlocks]);
      setNewBlockDate(''); setNewBlockEndDate(''); setNewBlockReason('');
    } catch (e: unknown) {
      setBlockError((e instanceof Error ? e.message : null) ?? 'Fehler');
    }
  }

  async function handleAddHoursBlock() {
    if (!newBlockDate || !newBlockStartTime || !newBlockEndTime) return;
    setBlockError(null);
    try {
      const res = await (addBlockApi ?? addChipyBlock)(newBlockDate, {
        start_time: newBlockStartTime,
        end_time: newBlockEndTime,
        reason: newBlockReason || undefined,
      });
      setBlocks(prev => [...prev, { id: res.id, date: newBlockDate, start_time: newBlockStartTime, end_time: newBlockEndTime, reason: newBlockReason || null }]);
      setNewBlockDate(''); setNewBlockStartTime(''); setNewBlockEndTime(''); setNewBlockReason('');
    } catch (e: unknown) {
      setBlockError((e instanceof Error ? e.message : null) ?? 'Fehler');
    }
  }

  async function handleRemoveBlock(id: string) {
    try { await (removeBlockApi ?? removeChipyBlock)(id); setBlocks(prev => prev.filter(b => b.id !== id)); } catch (e: unknown) {
      setBlockError((e instanceof Error ? e.message : null) ?? 'Sperre konnte nicht entfernt werden');
    }
  }

  const inputClass = "min-w-0 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-all";
  const inputStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' };

  return (
    <div className="space-y-8">
      {/* Weekly schedule */}
      {showSchedule && (
      <div>
        <p className="text-[11px] font-semibold text-white/25 uppercase tracking-[0.15em] mb-4">Wöchentliche Verfügbarkeit</p>
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          {DAY_ORDER.map((dow, i) => {
            const day = schedule[dow] ?? DEFAULT_SCHEDULE[dow]!;
            return (
              <div key={dow} className="flex flex-wrap items-center gap-3 px-5 py-3.5 sm:gap-4"
                style={i < DAY_ORDER.length - 1 ? { borderBottom: '1px solid rgba(255,255,255,0.03)' } : undefined}>
                <button
                  aria-pressed={day.enabled}
                  onClick={() => setSchedule(s => ({ ...s, [dow]: { ...day, enabled: !day.enabled } }))}
                  className="relative w-9 h-5 rounded-full transition-all shrink-0 cursor-pointer"
                  style={day.enabled ? { background: 'linear-gradient(135deg, #F97316, #06B6D4)' } : { background: 'rgba(255,255,255,0.08)' }}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${day.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <span className={`w-20 text-[13px] font-medium ${day.enabled ? 'text-white' : 'text-white/25'}`}>{DAY_NAMES[dow]}</span>
                {day.enabled ? (
                  <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:w-auto sm:flex-1 sm:justify-end">
                    <input type="time" value={day.start} onChange={e => setSchedule(s => ({ ...s, [dow]: { ...day, start: e.target.value } }))}
                      className={inputClass} style={inputStyle} />
                    <span className="text-white/20 text-[11px]">–</span>
                    <input type="time" value={day.end} onChange={e => setSchedule(s => ({ ...s, [dow]: { ...day, end: e.target.value } }))}
                      className={inputClass} style={inputStyle} />
                  </div>
                ) : (
                  <span className="text-[11px] text-white/15 flex-1 text-right">Geschlossen</span>
                )}
              </div>
            );
          })}
        </div>
        {saveError && <p className="text-xs text-red-300 mt-3">{saveError}</p>}
        <button onClick={handleSave} disabled={saving}
          className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all disabled:opacity-40 hover:scale-[1.01] cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)', boxShadow: '0 4px 20px rgba(249,115,22,0.15)' }}>
          {saving ? 'Speichern…' : saved ? 'Gespeichert ✓' : 'Speichern'}
        </button>
      </div>
      )}

      {/* Date blocks */}
      <div>
        <p className="text-[11px] font-semibold text-white/25 uppercase tracking-[0.15em] mb-2">{blockTitle}</p>
        <p className="text-[11px] text-white/20 mb-4">{blockDescription}</p>

        {blocks.length > 0 && (
          <div className="rounded-2xl overflow-hidden mb-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            {blocks.map((b, i) => (
              <div key={b.id} className="flex items-center justify-between px-5 py-3"
                style={i < blocks.length - 1 ? { borderBottom: '1px solid rgba(255,255,255,0.03)' } : undefined}>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[13px] text-white/70">{new Date(b.date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
                  {b.start_time && b.end_time ? (
                    <span className="text-[10px] text-amber-400/60 font-medium">{b.start_time.slice(0, 5)} – {b.end_time.slice(0, 5)}</span>
                  ) : (
                    <span className="text-[10px] text-red-400/50 font-medium">Ganztägig</span>
                  )}
                  {b.reason && <span className="text-[10px] text-white/25">{b.reason}</span>}
                </div>
                <button onClick={() => handleRemoveBlock(b.id)} className="text-white/15 hover:text-red-400 transition-colors shrink-0 ml-2 cursor-pointer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {blockError && <p className="text-xs text-red-300 mb-3">{blockError}</p>}

        {/* Block type toggle */}
        {allowedBlockModes.length > 1 && (
        <div className="flex gap-1.5 mb-4 rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.03)' }}>
          {allowedBlockModes.map(m => (
            <button key={m} onClick={() => setBlockMode(m)}
              className={`flex-1 py-2 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                blockMode === m ? 'bg-white/8' : 'text-white/30 hover:text-white/50'
              }`}>
              {blockMode === m ? (
                <span className="bg-clip-text text-transparent font-semibold" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>{m === 'day' ? 'Tag' : m === 'range' ? 'Zeitraum' : 'Uhrzeiten'}</span>
              ) : (m === 'day' ? 'Tag' : m === 'range' ? 'Zeitraum' : 'Uhrzeiten')}
            </button>
          ))}
        </div>
        )}

        {blockMode === 'day' && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input type="date" value={newBlockDate} min={todayISO()} onChange={e => setNewBlockDate(e.target.value)}
              className={`${inputClass} flex-1`} style={inputStyle} />
            <input type="text" value={newBlockReason} onChange={e => setNewBlockReason(e.target.value)} placeholder="Grund"
              className={`${inputClass} flex-1 placeholder-white/15`} style={inputStyle} />
            <button onClick={handleAddBlock} disabled={!newBlockDate}
              className="w-full shrink-0 rounded-lg px-4 py-2 text-xs font-semibold transition-all hover:brightness-110 disabled:opacity-30 sm:w-auto cursor-pointer"
              style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)' }}>
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>Sperren</span>
            </button>
          </div>
        )}

        {blockMode === 'range' && (
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input type="date" value={newBlockDate} min={todayISO()} onChange={e => setNewBlockDate(e.target.value)}
                className={`${inputClass} flex-1`} style={inputStyle} />
              <span className="text-white/20 text-[11px]">–</span>
              <input type="date" value={newBlockEndDate} min={newBlockDate || todayISO()} onChange={e => setNewBlockEndDate(e.target.value)}
                className={`${inputClass} flex-1`} style={inputStyle} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input type="text" value={newBlockReason} onChange={e => setNewBlockReason(e.target.value)} placeholder="Grund"
                className={`${inputClass} flex-1 placeholder-white/15`} style={inputStyle} />
              <button onClick={handleAddRange} disabled={!newBlockDate || !newBlockEndDate}
                className="w-full shrink-0 rounded-lg px-4 py-2 text-xs font-semibold transition-all hover:brightness-110 disabled:opacity-30 sm:w-auto cursor-pointer"
                style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)' }}>
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>Sperren</span>
              </button>
            </div>
          </div>
        )}

        {blockMode === 'hours' && (
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input type="date" value={newBlockDate} min={todayISO()} onChange={e => setNewBlockDate(e.target.value)}
                className={`${inputClass} flex-1`} style={inputStyle} />
              <input type="time" value={newBlockStartTime} onChange={e => setNewBlockStartTime(e.target.value)}
                className={inputClass} style={inputStyle} />
              <span className="text-white/20 text-[11px]">–</span>
              <input type="time" value={newBlockEndTime} onChange={e => setNewBlockEndTime(e.target.value)}
                className={inputClass} style={inputStyle} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input type="text" value={newBlockReason} onChange={e => setNewBlockReason(e.target.value)} placeholder="Grund"
                className={`${inputClass} flex-1 placeholder-white/15`} style={inputStyle} />
              <button onClick={handleAddHoursBlock} disabled={!newBlockDate || !newBlockStartTime || !newBlockEndTime}
                className="w-full shrink-0 rounded-lg px-4 py-2 text-xs font-semibold transition-all hover:brightness-110 disabled:opacity-30 sm:w-auto cursor-pointer"
                style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)' }}>
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>Sperren</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Calendar Connections Panel ────────────────────────────────────────────────

function getProviderConnection(status: CalendarStatus | null, provider: Exclude<CalendarProvider, 'chipy'>) {
  const fromList = status?.connections?.find((conn) => conn.provider === provider);
  if (fromList) return fromList;
  if (status?.provider === provider) {
    return {
      provider,
      connected: status.connected,
      email: status.email,
      calendarId: status.calendarId ?? null,
      expired: status.expired,
    };
  }
  return null;
}

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
  // Inline confirm instead of browser confirm() — chipy-design prefers
  // in-card affordances over system dialogs for quiet moments.
  const [confirmDisconnect, setConfirmDisconnect] = useState<Exclude<CalendarProvider, 'chipy'> | null>(null);

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

    // Listen for postMessage from OAuth popup (the callback page closes
    // itself and sends { type: 'calendarConnected' } to the opener).
    function onMessage(e: MessageEvent) {
      // Only accept messages from our own origin (not from random iframes/windows)
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'calendarConnected') {
        loadStatus();
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      {/* Skeleton: connection status card */}
      <div className="glass rounded-2xl p-5 border border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-white/8" />
          <div>
            <div className="h-4 w-40 bg-white/10 rounded mb-1" />
            <div className="h-3 w-24 bg-white/5 rounded" />
          </div>
        </div>
        <div className="h-8 w-36 bg-white/8 rounded-lg" />
      </div>
      {/* Skeleton: schedule grid */}
      <div className="glass rounded-2xl p-5 border border-white/10">
        <div className="h-4 w-32 bg-white/10 rounded mb-4" />
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="h-16 rounded-lg bg-white/5" />
          ))}
        </div>
      </div>
    </div>
  );

  // Shared helper: runs disconnect + reloads status. Wrapped so the inline
  // confirm strip and any other trigger uses exactly one code path.
  async function runDisconnect(provider: Exclude<CalendarProvider, 'chipy'>) {
    setDisconnectLoading(true);
    try {
      await disconnectCalendar(provider);
      await loadStatus();
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Trennen fehlgeschlagen');
    } finally {
      setDisconnectLoading(false);
      setConfirmDisconnect(null);
    }
  }

  // Small inline-confirm strip rendered under a connected provider row
  // instead of a modal. Same design in both CalendarPage and CapabilitiesTab
  // so the disconnect-flow feels identical everywhere.
  function InlineConfirmStrip({ provider, providerLabel }: { provider: Exclude<CalendarProvider, 'chipy'>; providerLabel: string }) {
    if (confirmDisconnect !== provider) return null;
    return (
      <div className="px-5 pb-4 -mt-1 border-t border-red-500/15 pt-3">
        <p className="text-xs text-white/70 mb-2.5 leading-relaxed">
          <span className="text-red-300">Sicher trennen?</span> Dein Agent kann nach dem Trennen keine Termine mehr in <span className="text-white">{providerLabel}</span> eintragen oder prüfen — bis du's wieder verbindest.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => setConfirmDisconnect(null)}
            className="rounded-lg px-3 py-1.5 text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 transition-colors cursor-pointer">
            Abbrechen
          </button>
          <button onClick={() => { void runDisconnect(provider); }} disabled={disconnectLoading}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-200 bg-red-500/15 hover:bg-red-500/25 border border-red-500/25 transition-colors disabled:opacity-50 cursor-pointer">
            {disconnectLoading ? 'Trenne…' : 'Ja, trennen'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-2xl p-4 border border-red-500/20 bg-red-500/5">
          <p className="text-sm text-red-300">⚠️ {error}</p>
          <button onClick={loadStatus} className="mt-2 text-xs text-white/40 hover:text-white/60 transition-colors">Erneut versuchen</button>
        </div>
      )}

      {/* The old top "Connected provider" card was removed 2026-04-23 —
          each provider now appears exactly once in the grid below with its
          status + disconnect action inline. */}

      <div className="space-y-3">
        <p className="text-xs text-white/40 mb-3">
          Verbinde einen Kalender, damit dein Agent Termine prüfen und buchen kann.
        </p>
        {(status as CalendarStatus | null)?.expired && (
          <div className="rounded-xl px-4 py-3 mb-2 text-xs" style={{ background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.2)', color: '#FB923C' }}>
            ⚠️ Deine {(status as CalendarStatus).expiredProvider === 'google' ? 'Google' : (status as CalendarStatus).expiredProvider === 'microsoft' ? 'Microsoft' : ''}-Verbindung ist abgelaufen. Bitte neu verbinden.
          </div>
        )}

        <div className="space-y-3">
          {/* Google */}
          {(() => {
            const conn = getProviderConnection(status, 'google');
            const isConnected = Boolean(conn?.connected);
            return (
              <div className="rounded-2xl hover:bg-white/[0.04] transition-all" style={{ background: 'rgba(255,255,255,0.02)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-4 px-5 py-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(66,133,244,0.08)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" className="fancy-star"><defs><linearGradient id="gglCal" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#4285F4"/><stop offset="33%" stopColor="#34A853"/><stop offset="66%" stopColor="#FBBC05"/><stop offset="100%" stopColor="#EA4335"/></linearGradient></defs><path d="M12 1C12.8 7.6 16.4 11.2 23 12c-6.6.8-10.2 4.4-11 11-.8-6.6-4.4-10.2-11-11C7.6 11.2 11.2 7.6 12 1z" fill="url(#gglCal)"/></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-white">Google Calendar</p>
                    <p className="text-[11px] text-white/30 truncate">{isConnected ? conn?.email ?? 'Verbunden' : 'OAuth 2.0'}</p>
                  </div>
                  {isConnected ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="flex items-center gap-1.5 text-[11px] text-green-400/80 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />Verbunden</span>
                      <button onClick={() => setConfirmDisconnect('google')} disabled={disconnectLoading || Boolean(confirmDisconnect)}
                        className="text-[11px] text-white/35 hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer">
                        Trennen
                      </button>
                    </div>
                  ) : (
                    <button onClick={async () => { setGoogleLoading(true); try { const { url } = await getGoogleCalendarAuthUrl(); window.location.href = url; } catch { setGoogleLoading(false); } }}
                      disabled={googleLoading}
                      className="shrink-0 rounded-lg px-4 py-2 font-semibold text-xs text-white disabled:opacity-50 transition-all hover:brightness-110 cursor-pointer"
                      style={{ background: 'linear-gradient(135deg, #4285F4, #34A853, #FBBC05, #EA4335)', backgroundSize: '300% 300%', animation: 'fancy-bg 4s ease infinite' }}>
                      {googleLoading ? 'Verbinde…' : 'Verbinden'}
                    </button>
                  )}
                </div>
                {isConnected && <InlineConfirmStrip provider="google" providerLabel="Google Calendar" />}
              </div>
            );
          })()}

          {/* Microsoft */}
          {(() => {
            const conn = getProviderConnection(status, 'microsoft');
            const isConnected = Boolean(conn?.connected);
            return (
              <div className="rounded-2xl hover:bg-white/[0.04] transition-all" style={{ background: 'rgba(255,255,255,0.02)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-4 px-5 py-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-lg" style={{ background: 'rgba(0,120,212,0.08)' }}>🪟</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-white">Microsoft Outlook</p>
                    <p className="text-[11px] text-white/30 truncate">{isConnected ? conn?.email ?? 'Verbunden' : 'Office 365 / Outlook.com'}</p>
                  </div>
                  {isConnected ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="flex items-center gap-1.5 text-[11px] text-green-400/80 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />Verbunden</span>
                      <button onClick={() => setConfirmDisconnect('microsoft')} disabled={disconnectLoading || Boolean(confirmDisconnect)}
                        className="text-[11px] text-white/35 hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer">
                        Trennen
                      </button>
                    </div>
                  ) : (
                    <button onClick={async () => { setMicrosoftLoading(true); try { const { url } = await getMicrosoftCalendarAuthUrl(); window.location.href = url; } catch { setMicrosoftLoading(false); } }}
                      disabled={microsoftLoading}
                      className="shrink-0 rounded-lg px-4 py-2 font-semibold text-xs text-white disabled:opacity-50 transition-all hover:brightness-110 cursor-pointer"
                      style={{ background: 'linear-gradient(135deg, #0078D4, #00BCF2)' }}>
                      {microsoftLoading ? 'Verbinde…' : 'Verbinden'}
                    </button>
                  )}
                </div>
                {isConnected && <InlineConfirmStrip provider="microsoft" providerLabel="Microsoft Outlook" />}
              </div>
            );
          })()}

          {/* Cal.com */}
          {(() => {
            const conn = getProviderConnection(status, 'calcom');
            const isConnected = Boolean(conn?.connected);
            return (
              <div className="rounded-2xl px-5 py-4 hover:bg-white/[0.04] transition-all" style={{ background: 'rgba(255,255,255,0.02)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(59,130,246,0.08)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-white">Cal.com</p>
                    <p className="text-[11px] text-white/30">{isConnected ? 'Verbunden' : 'API Key'}</p>
                  </div>
                  {isConnected && (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="flex items-center gap-1.5 text-[11px] text-green-400/80 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />Verbunden</span>
                      <button onClick={() => setConfirmDisconnect('calcom')} disabled={disconnectLoading || Boolean(confirmDisconnect)}
                        className="text-[11px] text-white/35 hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer">
                        Trennen
                      </button>
                    </div>
                  )}
                </div>
                {!isConnected && (
                  <div className="flex gap-2 mt-3">
                    <input type="text" value={calcomKey} onChange={e => setCalcomKey(e.target.value)} placeholder="cal_live_xxxx…"
                      className="flex-1 rounded-lg px-3 py-2 text-sm text-white placeholder-white/15 focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-all"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }} />
                    <button onClick={async () => { setCalcomLoading(true); setCalcomError(null); try { await connectCalcom(calcomKey); setCalcomKey(''); await loadStatus(); } catch (e: unknown) { setCalcomError((e instanceof Error ? e.message : null) ?? 'Fehler'); } finally { setCalcomLoading(false); } }}
                      disabled={calcomLoading || !calcomKey.trim()}
                      className="shrink-0 rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-40 cursor-pointer transition-all hover:brightness-110"
                      style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.12)' }}>
                      <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
                        {calcomLoading ? '…' : 'Verbinden'}
                      </span>
                    </button>
                    {calcomError && <p className="text-xs text-red-300 mt-2">{calcomError}</p>}
                  </div>
                )}
                {isConnected && <InlineConfirmStrip provider="calcom" providerLabel="Cal.com" />}
              </div>
            );
          })()}

          {/* Chipy (built-in) */}
          <div className="flex items-center gap-4 rounded-2xl px-5 py-4" style={{ background: 'rgba(249,115,22,0.03)', backdropFilter: 'blur(24px)', border: '1px solid rgba(249,115,22,0.08)' }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.1), rgba(6,182,212,0.06))' }}>
              <FoxLogo size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-white">Chipy Kalender</p>
              <p className="text-[11px] text-white/30">Eingebaut — immer aktiv</p>
            </div>
            <span className="flex items-center gap-1.5 text-[11px] text-green-400/70 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />Aktiv</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function StaffPanel({
  onStaffChange,
  onNavigate,
}: {
  onStaffChange?: (count: number) => void;
  onNavigate?: (page: 'customers', focusId?: string | null) => void;
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
  const [staffCalendarView, setStaffCalendarView] = useState<CalendarViewMode>('week');
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
      await deleteStaffChipyBooking(selected.id, id);
      setStaffBookings(prev => prev.filter(b => b.id !== id));
    } catch (e: unknown) {
      const message = (e instanceof Error ? e.message : null) ?? 'Termin konnte nicht gelöscht werden';
      setError(message);
      throw new Error(message);
    }
  }

  function handleStaffBookingSaved(booking: ChipyBooking) {
    setStaffBookings(prev => [...prev, booking].sort((a, b) => a.slot_time.localeCompare(b.slot_time)));
    setShowStaffAddBooking(false);
    setSelectedStaffDay(null);
  }

  async function _handleStaffAddBlock(date: Date, opts?: { start_time?: string; end_time?: string; reason?: string }) {
    if (!selected) return;
    const dateStr = isoDate(date);
    try {
      const res = await addStaffChipyBlock(selected.id, dateStr, opts);
      setStaffBlocks(prev => [...prev, {
        id: res.id,
        date: dateStr,
        start_time: opts?.start_time ?? null,
        end_time: opts?.end_time ?? null,
        reason: opts?.reason ?? null,
      }]);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Sperre konnte nicht hinzugefügt werden');
    }
  }

  async function handleStaffOpenBookingCustomer(booking: ChipyBooking) {
    if (!onNavigate) return;
    const phoneQuery = normalizeLookupPhone(booking.customer_phone);
    const queries = [phoneQuery, booking.customer_phone, booking.customer_name].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
    for (const query of queries) {
      try {
        const result = await getCustomers(query);
        const customer = findBookingCustomer(booking, result.items ?? []);
        if (customer) {
          storeCustomerFocus(customer, query);
          setSelectedStaffDay(null);
          setShowStaffAddBooking(false);
          onNavigate('customers', customer.id);
          return;
        }
      } catch (e: unknown) {
        setError((e instanceof Error ? e.message : null) ?? 'Kunde konnte nicht geöffnet werden');
        return;
      }
    }
    setError('Zu diesem Termin wurde kein passender Kunde im Kundenmodul gefunden.');
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
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
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
              Verbinden
            </button>
          </div>
        ) : (
            <button onClick={() => { void runConnect(provider); }} disabled={connectionLoading === provider}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
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
                  style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
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
            className="rounded-2xl border border-orange-500/20 p-4 shadow-[0_18px_52px_rgba(249,115,22,0.08)]"
            style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.10), rgba(255,255,255,0.025) 46%, rgba(6,182,212,0.07))' }}
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
          onOpenCustomer={(booking) => { void handleStaffOpenBookingCustomer(booking); }}
          onDelete={(booking) => handleStaffDeleteBooking(booking.id)}
        />
      )}
    </div>
  );
}

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
  const [calendarView, setCalendarView] = useState<CalendarViewMode>('week');
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
    try {
      const [chipy, bkgs, ext, staffRes] = await Promise.all([
        getChipyCalendar(),
        getChipyBookings(from, to),
        getExternalCalendarEvents(from, to).catch(() => ({ events: [] as ExternalCalendarEvent[] })),
        getCalendarStaff().catch(() => ({ staff: [] as CalendarStaff[] })),
      ]);
      const staff = staffRes.staff ?? [];
      const team = await Promise.all(staff.map(async (member) => {
        const [staffBkgs, staffExt] = await Promise.all([
          getStaffChipyBookings(member.id, from, to).catch(() => ({ bookings: [] as ChipyBooking[] })),
          getStaffExternalCalendarEvents(member.id, from, to).catch(() => ({ events: [] as ExternalCalendarEvent[] })),
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
      if (booking.calendarScope === 'staff' && booking.staffId) {
        await deleteStaffChipyBooking(booking.staffId, booking.id);
        setTeamBookings(prev => prev.filter(b => bookingKey(b) !== bookingKey(booking)));
      } else {
        await deleteChipyBooking(booking.id);
        setBookings(prev => prev.filter(b => b.id !== booking.id));
      }
    } catch (e: unknown) {
      const message = (e instanceof Error ? e.message : null) ?? 'Termin konnte nicht gelöscht werden';
      setCalendarError(message);
      throw new Error(message);
    }
  }

  async function handleOpenBookingCustomer(booking: ChipyBooking) {
    if (!onNavigate) return;
    const phoneQuery = normalizeLookupPhone(booking.customer_phone);
    const queries = [phoneQuery, booking.customer_phone, booking.customer_name].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
    for (const query of queries) {
      try {
        const result = await getCustomers(query);
        const customer = findBookingCustomer(booking, result.items ?? []);
        if (customer) {
          storeCustomerFocus(customer, query);
          setSelectedDay(null);
          onNavigate('customers', customer.id);
          return;
        }
      } catch (e: unknown) {
        setCalendarError((e instanceof Error ? e.message : null) ?? 'Kunde konnte nicht geöffnet werden');
        return;
      }
    }
    setCalendarError('Zu diesem Termin wurde kein passender Kunde im Kundenmodul gefunden.');
  }

  async function _handleAddBlock(date: Date, opts?: { start_time?: string; end_time?: string; reason?: string }) {
    const dateStr = isoDate(date);
    try {
      const res = await addChipyBlock(dateStr, opts);
      setBlocks(prev => [...prev, {
        id: res.id, date: dateStr,
        start_time: opts?.start_time ?? null,
        end_time: opts?.end_time ?? null,
        reason: opts?.reason ?? null,
      }]);
    } catch (e: unknown) {
      setCalendarError((e instanceof Error ? e.message : null) ?? 'Sperre konnte nicht hinzugefügt werden');
    }
  }

  function handleBookingSaved(booking: ChipyBooking) {
    setBookings(prev => [...prev, booking].sort((a, b) => a.slot_time.localeCompare(b.slot_time)));
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
          style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.07) 0%, transparent 65%)' }} />
        <div className="absolute bottom-0 right-1/4 w-[250px] sm:w-[400px] h-[250px] sm:h-[400px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.05) 0%, transparent 65%)' }} />
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
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
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
                <span className="bg-clip-text text-transparent font-semibold" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>{t.label}</span>
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
                Phonbot unterstützt <strong className="text-white/70">Google Calendar</strong>, <strong className="text-white/70">Microsoft Outlook</strong>, <strong className="text-white/70">Cal.com</strong> und den <strong className="text-white/70">eingebauten Chipy Kalender</strong>.
                Du kannst auch mehrere Kalender gleichzeitig verbinden — Termine werden in alle synchronisiert.
              </p>
              <button
                onClick={() => document.getElementById('calendar-connections')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:opacity-90"
                style={{ background: 'rgba(249,115,22,0.2)', color: '#FB923C' }}
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
              <div className="shrink-0 rounded-3xl border border-orange-500/20 p-4 shadow-[0_18px_60px_rgba(249,115,22,0.10)]" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.13), rgba(255,255,255,0.035) 48%, rgba(6,182,212,0.10))' }}>
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
              className="rounded-2xl border border-orange-500/20 p-4 shadow-[0_18px_52px_rgba(249,115,22,0.08)]"
              style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.10), rgba(255,255,255,0.025) 46%, rgba(6,182,212,0.07))' }}
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
          <StaffPanel onStaffChange={setStaffCount} onNavigate={onNavigate} />
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
          onOpenCustomer={(booking) => { void handleOpenBookingCustomer(booking); }}
          onDelete={handleDeleteCalendarBooking}
        />
      )}
    </div>
  );
}
