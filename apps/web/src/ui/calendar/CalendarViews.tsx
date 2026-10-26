import { useMemo, useState } from 'react';
import type { ChipyBlock, ChipySchedule, ExternalCalendarEvent } from '../../lib/api.js';
import {
  isoDate, todayISO, getDaysInMonth, MONTH_NAMES, DAY_SHORT, formatTime,
  bookingDateKey, bookingDuration, bookingBuffer, clockToMinutes,
  dateToLocalMinutes, minutesLabel, TIMELINE_WORKDAY_PADDING_MINUTES,
  floorTimelineMinute, ceilTimelineMinute, buildTimelineLabels, timelineLabelTop,
  bookingKey, bookingDisplayCount, isGroupedBooking, bookingAccent, hexToRgba,
  bookingSourceLabel, bookingOverlapOffset, startOfWeek, addDays, formatWeekRange,
  dayBounds, type CalendarViewMode, type CalendarBooking,
} from './model.js';

export function CalendarViewSwitch({ value, onChange }: { value: CalendarViewMode; onChange: (value: CalendarViewMode) => void }) {
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
            value === mode ? 'text-white shadow-[0_10px_30px_rgba(255,91,10,0.16)]' : 'text-white/35 hover:text-white/65',
          ].join(' ')}
          style={value === mode ? { background: 'linear-gradient(135deg, rgba(255,91,10,0.28), rgba(32,217,255,0.22))' } : undefined}
        >
          {labels[mode]}
        </button>
      ))}
    </div>
  );
}

export function WeeklyCalendar({
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
                          background: `linear-gradient(135deg, ${hexToRgba(accent, 0.24)}, rgba(255,255,255,0.045) 48%, rgba(32,217,255,0.12))`,
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

export function DailyCalendar({
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
            <button type="button" onClick={() => onAddBooking?.(date)} className="rounded-xl px-3 py-2 text-xs font-semibold text-white shadow-[0_12px_30px_rgba(255,91,10,0.18)]" style={{ background: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}>
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
                background: `linear-gradient(135deg, ${hexToRgba(accent, 0.25)}, rgba(255,255,255,0.045) 46%, rgba(32,217,255,0.12))`,
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

export function MonthlyCalendar({
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
