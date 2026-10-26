import type { ChipyBooking, CalendarStaff, ServiceItem } from '../../lib/api.js';
import { HAIRDRESSER_SERVICE_PRESET, serviceItemToStaffLabel } from '../../lib/service-presets.js';

export function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function todayISO() { return isoDate(new Date()); }

export function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return days;
}

export const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
export const DAY_SHORT = ['Mo','Di','Mi','Do','Fr','Sa','So'];

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
export function _formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function splitServiceText(value: string | null | undefined): string[] {
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

export function isHairdresserConfig(input: { industry?: string; businessDescription?: string; servicesText?: string }) {
  const haystack = `${input.industry ?? ''} ${input.businessDescription ?? ''} ${input.servicesText ?? ''}`.toLowerCase();
  return /friseur|salon|haar|farbe|kopfhaut|stylist/.test(haystack);
}

export type CalendarServiceOption = {
  label: string;
  durationMinutes: number;
  bufferMinutes: number;
};

export function parseMinutesText(value: string | null | undefined, fallback: number): number {
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

export function parseBufferText(value: string | null | undefined): number {
  const raw = value?.trim().toLowerCase();
  if (!raw || !/puffer|buffer|pause|abstand/.test(raw)) return 0;
  const match = raw.match(/(\d{1,3})\s*(?:min|minute|minutes|minuten)?\s*(?:puffer|buffer|pause|abstand)/)
    ?? raw.match(/(?:puffer|buffer|pause|abstand)\s*(\d{1,3})/);
  return match ? Math.min(180, Math.max(0, Number(match[1]))) : 0;
}

export function normalizeServiceName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function deriveServiceOptions(input: { services?: ServiceItem[]; servicesText?: string; industry?: string; businessDescription?: string }): CalendarServiceOption[] {
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

export function serviceLabelsToOptions(labels: string[] | null | undefined): CalendarServiceOption[] {
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

export function bookingDateKey(booking: ChipyBooking): string {
  return isoDate(new Date(booking.slot_time));
}

export function bookingDuration(booking: ChipyBooking): number {
  return Math.min(480, Math.max(5, Math.round(booking.duration_minutes ?? parseMinutesText(booking.service, 30))));
}

export function bookingBuffer(booking: ChipyBooking): number {
  return Math.min(180, Math.max(0, Math.round(booking.buffer_minutes ?? parseBufferText(booking.service))));
}

export function clockToMinutes(value: string | null | undefined): number | null {
  const match = value?.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return hour * 60 + minute;
}

export function dateToLocalMinutes(value: string): number {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

export function minutesLabel(value: number): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function clampTimelineMinute(value: number): number {
  return Math.min(24 * 60, Math.max(0, Math.round(value)));
}

export const TIMELINE_WORKDAY_PADDING_MINUTES = 30;
export const TIMELINE_GRID_STEP_MINUTES = 30;

export function floorTimelineMinute(value: number, step = TIMELINE_GRID_STEP_MINUTES): number {
  return clampTimelineMinute(Math.floor(value / step) * step);
}

export function ceilTimelineMinute(value: number, step = TIMELINE_GRID_STEP_MINUTES): number {
  return clampTimelineMinute(Math.ceil(value / step) * step);
}

export function buildTimelineLabels(start: number, end: number): number[] {
  const labels: number[] = [];
  for (let minutes = start; minutes <= end; minutes += 60) labels.push(minutes);
  if (labels[labels.length - 1] !== end) labels.push(end);
  return labels;
}

export function timelineLabelTop(minutes: number, start: number, span: number): string {
  return `clamp(10px, ${((minutes - start) / span) * 100}%, calc(100% - 10px))`;
}

export type CalendarViewMode = 'day' | 'week' | 'month';
export type CalendarBooking = ChipyBooking & {
  calendarScope?: 'business' | 'staff';
  staffId?: string | null;
  staffName?: string | null;
  staffColor?: string | null;
  groupedBookings?: CalendarBooking[];
};

export const TEAM_BOOKING_COLORS = ['#ff5b0a', '#20d9ff', '#22C55E', '#A855F7', '#F59E0B', '#EC4899', '#14B8A6'];

export function colorHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash) + value.charCodeAt(i);
  return Math.abs(hash);
}

export function bookingKey(booking: CalendarBooking): string {
  return `${booking.calendarScope ?? 'business'}:${booking.staffId ?? 'betrieb'}:${booking.id}`;
}

export function bookingGroupMembers(booking: CalendarBooking): CalendarBooking[] {
  return booking.groupedBookings?.length ? booking.groupedBookings : [booking];
}

export function bookingDisplayCount(booking: CalendarBooking): number {
  return bookingGroupMembers(booking).length;
}

export function isGroupedBooking(booking: CalendarBooking): boolean {
  return bookingGroupMembers(booking).length > 1;
}

export function bookingAccent(booking: CalendarBooking): string {
  if (isGroupedBooking(booking)) return '#20d9ff';
  if (booking.staffColor?.trim()) return booking.staffColor.trim();
  if (booking.calendarScope === 'staff') {
    const key = booking.staffId ?? booking.staffName ?? booking.id;
    return TEAM_BOOKING_COLORS[colorHash(key) % TEAM_BOOKING_COLORS.length]!;
  }
  return '#ff5b0a';
}

export function hexToRgba(color: string, alpha: number): string {
  const hex = color.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return `rgba(255,91,10,${alpha})`;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function bookingSourceLabel(booking: CalendarBooking): string {
  const members = bookingGroupMembers(booking);
  if (members.length > 1) return `${members.length} Termine`;
  return booking.calendarScope === 'staff' && booking.staffName ? booking.staffName : 'Betrieb';
}

export function bookingWithBusinessMeta(booking: ChipyBooking): CalendarBooking {
  return { ...booking, calendarScope: 'business', staffId: null, staffName: 'Betrieb', staffColor: '#ff5b0a' };
}

export function bookingWithStaffMeta(booking: ChipyBooking, staff: CalendarStaff): CalendarBooking {
  return { ...booking, calendarScope: 'staff', staffId: staff.id, staffName: staff.name, staffColor: staff.color };
}

export function externalSyncWarning(result: { partial?: boolean; externalResults?: { provider: string; ok: boolean; error?: string }[] }, action: 'created' | 'deleted') {
  const failed = result.externalResults?.filter((item) => !item.ok) ?? [];
  if (!result.partial && failed.length === 0) return null;
  const providers = failed.map((item) => item.provider).filter(Boolean).join(', ') || 'externe Kalender';
  return action === 'created'
    ? `Termin wurde in Chipy gespeichert, aber nicht vollstaendig in ${providers} gespiegelt. Bitte Verbindung pruefen oder extern kontrollieren.`
    : `Termin wurde in Chipy geloescht, aber nicht vollstaendig aus ${providers} entfernt. Bitte Verbindung pruefen oder extern kontrollieren.`;
}

export function bookingOverlapOffset(bookings: CalendarBooking[], booking: CalendarBooking): number {
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

export function groupCalendarBookingsByStart(bookings: CalendarBooking[]): CalendarBooking[] {
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
      staffColor: '#20d9ff',
      groupedBookings: sorted,
    } satisfies CalendarBooking];
  }).sort((a, b) => a.slot_time.localeCompare(b.slot_time));
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function formatWeekRange(start: Date): string {
  const end = addDays(start, 6);
  const startLabel = start.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
  const endLabel = end.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${startLabel} - ${endLabel}`;
}

export function dayBounds(dateStr: string) {
  return {
    start: new Date(`${dateStr}T00:00:00`),
    end: new Date(`${dateStr}T23:59:59.999`),
  };
}

export type ProviderMeta = { label: string; color: string; bg: string; icon: string };
export const PROVIDER_META: Record<string, ProviderMeta> = {
  google:    { label: 'Google Calendar',   color: '#4285F4', bg: 'rgba(66,133,244,0.08)',   icon: 'G' },
  microsoft: { label: 'Microsoft Outlook', color: '#0078D4', bg: 'rgba(0,120,212,0.12)',    icon: 'M' },
  calcom:    { label: 'Cal.com',           color: '#20d9ff', bg: 'rgba(32,217,255,0.10)',   icon: 'C' },
  chipy:    { label: 'Chipy Kalender',   color: '#ff5b0a', bg: 'rgba(255,91,10,0.12)',   icon: 'P' },
};
export const DEFAULT_PROVIDER_META: ProviderMeta = { label: 'Chipy Kalender', color: '#ff5b0a', bg: 'rgba(255,91,10,0.12)', icon: 'P' };
