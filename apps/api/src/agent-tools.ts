import { z } from 'zod';
import { createTicket } from './tickets.js';
import type { readConfig } from './agent-config.js';
import {
  findFreeSlots,
  findFreeSlotsForAnyStaff,
  bookSlot,
  bookSlotForAnyStaff,
  findChipyBookingsForChange,
  cancelChipyBookingForChange,
  rescheduleChipyBookingForChange,
  formatSpokenSlotLabel,
} from './calendar.js';
import { sendBookingConfirmationSms, sendTicketAckSms } from './sms.js';
import { pool } from './db.js';

export const KnownToolNameSchema = z.enum([
  'calendar.findSlots',
  'calendar.book',
  'calendar.findBookings',
  'calendar.cancel',
  'calendar.reschedule',
  'ticket.create',
]);

/** OpenAI requires tool names to match ^[a-zA-Z0-9_-]+$ */
function sanitizeToolName(name: string): string {
  switch (name) {
    case 'calendar.findSlots':
      return 'calendar_find_slots';
    case 'calendar.findBookings':
      return 'calendar_find_bookings';
    case 'calendar.book':
      return 'calendar_book';
    case 'calendar.cancel':
      return 'calendar_cancel';
    case 'calendar.reschedule':
      return 'calendar_reschedule';
    case 'ticket.create':
      return 'ticket_create';
    default:
      return name.replace(/\./g, '_');
  }
}
export type KnownToolName = z.infer<typeof KnownToolNameSchema>;

const OptionalNonEmptyString = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}, z.string().min(1).optional());

const FindSlotsArgsSchema = z.object({
  service: OptionalNonEmptyString,
  range: OptionalNonEmptyString,
  preferredTime: OptionalNonEmptyString,
  preferredStylist: OptionalNonEmptyString,
});

const BookArgsSchema = z.object({
  customerName: OptionalNonEmptyString,
  customerPhone: OptionalNonEmptyString,
  preferredTime: z.string().min(1),
  service: z.string().min(1),
  preferredStylist: OptionalNonEmptyString,
  confirmed: z.boolean().optional().default(false),
  notes: OptionalNonEmptyString,
});

const FindBookingsArgsSchema = z.object({
  changeToken: OptionalNonEmptyString,
  customerName: OptionalNonEmptyString,
  customerPhone: OptionalNonEmptyString,
  currentTime: OptionalNonEmptyString,
  service: OptionalNonEmptyString,
  preferredStylist: OptionalNonEmptyString,
});

const CancelBookingArgsSchema = FindBookingsArgsSchema.extend({
  confirmed: z.boolean().optional().default(false),
  reason: OptionalNonEmptyString,
});

const RescheduleBookingArgsSchema = FindBookingsArgsSchema.extend({
  newTime: z.string().min(1),
  newService: OptionalNonEmptyString,
  newPreferredStylist: OptionalNonEmptyString,
  confirmed: z.boolean().optional().default(false),
  reason: OptionalNonEmptyString,
});

const TicketCreateArgsSchema = z.object({
  customerName: OptionalNonEmptyString,
  customerPhone: z.string().min(1),
  preferredTime: OptionalNonEmptyString,
  service: OptionalNonEmptyString,
  notes: OptionalNonEmptyString,
  reason: OptionalNonEmptyString,
});

type AgentConfig = Awaited<ReturnType<typeof readConfig>>;

const DEFAULT_FALLBACK_REASON = 'Allgemeine Übergabe';

function normalizeFallbackReasonValue(reason: string | null | undefined): string {
  const trimmed = reason?.trim();
  if (!trimmed || trimmed === 'handoff') return DEFAULT_FALLBACK_REASON;
  return trimmed;
}

function calendarSlotLookupOk(source: string): boolean {
  return !/(^|:|\+)past-date($|\+)|service-not-offered|calendar-unavailable/.test(source);
}

function calendarSlotInstruction(source: string, fallbackInstruction: string): string {
  if (/(^|:|\+)past-date($|\+)/.test(source)) {
    return 'Das gewuenschte Datum liegt in der Vergangenheit. Keine Zeiten vorschlagen und nach einem zukuenftigen Datum fragen.';
  }
  if (source.includes('service-not-offered')) {
    return 'Der gewuenschte Service wird von dieser Person/diesem Betrieb nicht angeboten. Nicht buchen; Alternative oder Rueckruf anbieten.';
  }
  if (source.includes('calendar-unavailable')) {
    return 'Der Kalender ist gerade nicht sicher pruefbar. Keine Zeiten erfinden; Rueckruf- oder Terminwunsch-Ticket anbieten.';
  }
  return fallbackInstruction;
}

function isPastSlotError(error: unknown): boolean {
  return typeof error === 'string' && error.includes('PAST_SLOT');
}

function sanitizeKnownToolResultForModel(result: Record<string, unknown>): Record<string, unknown> {
  const cleanString = (value: unknown, max = 500): string | undefined => {
    if (typeof value !== 'string') return undefined;
    return value
      .slice(0, max)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      .replace(/\+?\d[\d\s()./-]{6,}\d/g, '[phone]');
  };
  const out: Record<string, unknown> = {};
  for (const key of ['ok', 'partial', 'fallback', 'reused', 'smsSent', 'callbackScheduled']) {
    if (typeof result[key] === 'boolean') out[key] = result[key];
  }
  for (const key of ['status', 'error', 'message', 'instruction', 'deliveryInstruction', 'source', 'service', 'preferredTime', 'preferredStylist']) {
    const value = cleanString(result[key], key === 'instruction' || key === 'message' ? 800 : 220);
    if (value) out[key] = value;
  }
  if (Array.isArray(result.externalResults)) out.externalResultCount = result.externalResults.length;
  if (typeof result.externalResultCount === 'number') out.externalResultCount = result.externalResultCount;
  if (typeof result.candidateCount === 'number') out.candidateCount = result.candidateCount;
  if (typeof result.allSlotsCount === 'number') out.allSlotsCount = result.allSlotsCount;
  if (typeof result.moreCount === 'number') out.moreCount = result.moreCount;
  if (Array.isArray(result.slots)) out.slots = result.slots.filter((slot): slot is string => typeof slot === 'string').slice(0, 6);
  if (Array.isArray(result.slotOptions)) {
    out.slotOptions = result.slotOptions.slice(0, 6).map((item) => {
      const option = item as Record<string, unknown>;
      return {
        slot: cleanString(option.slot, 80),
        spokenLabel: cleanString(option.spokenLabel, 120),
      };
    });
  }
  const spokenOptionsText = cleanString(result.spokenOptionsText, 500);
  if (spokenOptionsText) out.spokenOptionsText = spokenOptionsText;
  if (Array.isArray(result.matches)) {
    out.matches = result.matches.slice(0, 3).map((item) => {
      const match = item as Record<string, unknown>;
      return {
        changeToken: cleanString(match.changeToken, 1000),
        service: cleanString(match.service, 160),
        startAt: cleanString(match.startAt, 80),
        label: cleanString(match.label, 160),
        spokenLabel: cleanString(match.spokenLabel, 160),
        staffName: cleanString(match.staffName, 160),
      };
    });
    out.matchCount = result.matches.length;
  }
  return out;
}

export function getEnabledKnownTools(cfg: AgentConfig): KnownToolName[] {
  const enabled = cfg.tools.filter((tool): tool is KnownToolName => KnownToolNameSchema.safeParse(tool).success);
  if (enabled.includes('calendar.book')) {
    for (const tool of ['calendar.findBookings', 'calendar.cancel', 'calendar.reschedule'] as const) {
      if (!enabled.includes(tool)) enabled.push(tool);
    }
  }
  return enabled;
}

function fallbackReasonDescription(cfg: AgentConfig): string {
  const fallbackReason = normalizeFallbackReasonValue(cfg.fallback.reason);
  const reasons = (cfg.fallback as { reasons?: Array<{ reason?: string; enabled?: boolean }> }).reasons
    ?.filter((item) => item.enabled !== false && typeof item.reason === 'string' && item.reason.trim())
    .map((item) => item.reason!.trim())
    .slice(0, 10) ?? [];
  if (!reasons.length) return `Ticket reason. Default to "${fallbackReason}" when unsure.`;
  return `Ticket reason. Use one configured reason exactly when it fits: ${reasons.map((reason) => `"${reason}"`).join(', ')}. Default to "${fallbackReason}" when unsure.`;
}

export function getOpenAITools(cfg: AgentConfig) {
  const enabled = new Set(getEnabledKnownTools(cfg));
  const tools: any[] = [];

  if (enabled.has('calendar.findSlots')) {
    tools.push({
      type: 'function',
      name: sanitizeToolName('calendar.findSlots'),
      description: 'Find available appointment slots. Present at most three options to the caller. When the result includes spokenOptionsText or slotOptions[].spokenLabel, use that spoken text and never read technical times like 09:00 or 10:05 aloud.',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Requested service, if known.' },
          range: { type: 'string', description: 'Requested date range, e.g. next week.' },
          preferredTime: { type: 'string', description: 'Preferred time or day from the customer.' },
          preferredStylist: { type: 'string', description: 'Requested staff member/stylist name. Use "beliebig" when the caller has no staff preference.' },
        },
        additionalProperties: false,
      },
    });
  }

  if (enabled.has('calendar.book')) {
    tools.push({
      type: 'function',
      name: sanitizeToolName('calendar.book'),
      description: 'Create a booking only after the caller explicitly confirmed the exact future date/time, service, and customer name. Mention SMS confirmation only when the result returns smsSent=true.',
      parameters: {
        type: 'object',
        properties: {
          customerName: { type: 'string', description: 'Confirmed caller/customer name. Do not use "unknown".' },
          customerPhone: { type: 'string' },
          preferredTime: { type: 'string', description: 'Confirmed future slot/time, never a past date.' },
          service: { type: 'string', description: 'Booked service.' },
          preferredStylist: { type: 'string', description: 'Requested staff member/stylist name. Use "beliebig" when the caller has no staff preference.' },
          confirmed: { type: 'boolean', description: 'True only after the caller explicitly confirmed exact future date/time, service, and name in the latest turn.' },
          notes: { type: 'string' },
        },
        required: ['customerName', 'preferredTime', 'service', 'confirmed'],
        additionalProperties: false,
      },
    });
  }

  if (enabled.has('calendar.findBookings')) {
    tools.push({
      type: 'function',
      name: sanitizeToolName('calendar.findBookings'),
      description: 'Find an existing future appointment before cancellation or rescheduling. Do not reveal other customer data. Use verified caller phone plus name/current appointment time/service to narrow the match; use returned changeToken for mutations.',
      parameters: {
        type: 'object',
        properties: {
          changeToken: { type: 'string', description: 'Short-lived change token returned by calendar_find_bookings. Never invent it.' },
          customerName: { type: 'string' },
          customerPhone: { type: 'string' },
          currentTime: { type: 'string', description: 'Current appointment date/time as stated by the caller.' },
          service: { type: 'string' },
          preferredStylist: { type: 'string', description: 'Current staff member/stylist if known.' },
        },
        additionalProperties: false,
      },
    });
  }

  if (enabled.has('calendar.cancel')) {
    tools.push({
      type: 'function',
      name: sanitizeToolName('calendar.cancel'),
      description: 'Cancel an existing appointment only after findBookings identified the appointment and the caller explicitly confirmed the cancellation.',
      parameters: {
        type: 'object',
        required: ['confirmed'],
        properties: {
          changeToken: { type: 'string', description: 'Short-lived change token returned by calendar_find_bookings. Required for changing a booking.' },
          customerName: { type: 'string' },
          customerPhone: { type: 'string' },
          currentTime: { type: 'string' },
          service: { type: 'string' },
          preferredStylist: { type: 'string' },
          confirmed: { type: 'boolean', description: 'True only after the caller explicitly confirmed the exact appointment cancellation.' },
          reason: { type: 'string' },
        },
        additionalProperties: false,
      },
    });
  }

  if (enabled.has('calendar.reschedule')) {
    tools.push({
      type: 'function',
      name: sanitizeToolName('calendar.reschedule'),
      description: 'Move an existing appointment to a new slot only after old appointment and new slot were both explicitly confirmed.',
      parameters: {
        type: 'object',
        required: ['newTime', 'confirmed'],
        properties: {
          changeToken: { type: 'string', description: 'Short-lived change token returned by calendar_find_bookings. Required for changing a booking.' },
          customerName: { type: 'string' },
          customerPhone: { type: 'string' },
          currentTime: { type: 'string', description: 'Current appointment date/time.' },
          service: { type: 'string', description: 'Current service if known.' },
          preferredStylist: { type: 'string', description: 'Current staff member/stylist if known.' },
          newTime: { type: 'string', description: 'New confirmed appointment slot.' },
          newService: { type: 'string' },
          newPreferredStylist: { type: 'string', description: 'New requested staff member/stylist, or "beliebig".' },
          confirmed: { type: 'boolean', description: 'True only after the caller explicitly confirmed both old and new appointment details.' },
          reason: { type: 'string' },
        },
        additionalProperties: false,
      },
    });
  }

  if (enabled.has('ticket.create')) {
    tools.push({
      type: 'function',
      name: sanitizeToolName('ticket.create'),
      description: 'Create a callback or transfer-fallback ticket when the user needs human follow-up or booking cannot be completed live. Mention SMS only when the result returns smsSent=true.',
      parameters: {
        type: 'object',
        properties: {
          customerName: { type: 'string' },
          customerPhone: { type: 'string', description: 'Callback phone number.' },
          preferredTime: { type: 'string' },
          service: { type: 'string' },
          notes: { type: 'string' },
          reason: { type: 'string', description: fallbackReasonDescription(cfg) },
        },
        required: ['customerPhone'],
        additionalProperties: false,
      },
    });
  }

  return tools;
}

function normalizeIncomingToolName(name: string): KnownToolName | null {
  switch (name) {
    case 'calendar.findSlots':
    case 'calendar_findSlots':
      return 'calendar.findSlots';
    case 'calendar.book':
    case 'calendar_book':
      return 'calendar.book';
    case 'calendar.findBookings':
    case 'calendar_findBookings':
    case 'calendar_find_bookings':
      return 'calendar.findBookings';
    case 'calendar.cancel':
    case 'calendar_cancel':
      return 'calendar.cancel';
    case 'calendar.reschedule':
    case 'calendar_reschedule':
      return 'calendar.reschedule';
    case 'ticket.create':
    case 'ticket_create':
      return 'ticket.create';
    default:
      return null;
  }
}

async function resolveStaffByName(orgId: string, requested: string | undefined): Promise<{ staffId: string | null; requested: string | null; matchedName: string | null; staffModeActive: boolean; anyStaff: boolean }> {
  const name = requested?.trim() ?? '';
  const activeStaff = pool
    ? (await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM calendar_staff WHERE org_id = $1 AND active = true ORDER BY sort_order, name`,
        [orgId],
      )).rows
    : [];
  const staffModeActive = activeStaff.length > 0;
  const anyStaff = /^(egal|beliebig|irgendwer|wer frei ist|wer gerade frei ist|kein wunsch|keine praferenz|keine präferenz|any|anyone)$/i.test(name);
  if (anyStaff) {
    return { staffId: null, requested: name || null, matchedName: null, staffModeActive, anyStaff: true };
  }
  if (!name || name.length < 2 || !pool) return { staffId: null, requested: name || null, matchedName: null, staffModeActive, anyStaff: false };
  const byName = await pool.query<{ id: string; name: string }>(
    `SELECT id, name
       FROM calendar_staff
      WHERE org_id = $1
        AND active = true
        AND (
          lower(name) = lower($2)
          OR lower(name) LIKE lower($2) || '%'
          OR lower(name) LIKE '%' || lower($2) || '%'
          OR lower($2) LIKE '%' || lower(name) || '%'
        )
      ORDER BY
        CASE
          WHEN lower(name) = lower($2) THEN 0
          WHEN lower(name) LIKE lower($2) || '%' THEN 1
          ELSE 2
        END,
        sort_order,
        name
      LIMIT 1`,
    [orgId, name],
  );
  return { staffId: byName.rows[0]?.id ?? null, requested: name, matchedName: byName.rows[0]?.name ?? null, staffModeActive, anyStaff: false };
}

export async function executeKnownTool(input: {
  name: string;
  args: unknown;
  tenantId: string;
  sessionId: string;
  source: 'web' | 'phone' | 'system';
  cfg: AgentConfig;
}) {
  switch (normalizeIncomingToolName(input.name)) {
    case 'calendar.findSlots': {
      const args = FindSlotsArgsSchema.parse(input.args ?? {});
      const staff = await resolveStaffByName(input.tenantId, args.preferredStylist);
      if (staff.staffModeActive && !staff.staffId && staff.requested && !staff.anyStaff) {
        return {
          ok: false,
          source: 'staff-required',
          slots: [],
          service: args.service ?? null,
          preferredStylist: staff.requested,
          staffId: null,
          instruction: staff.requested
            ? 'Der Wunschfriseur wurde nicht eindeutig gefunden. Frage kurz nach einem anderen Mitarbeiter oder ob ein beliebiger verfuegbarer Mitarbeiter passt.'
            : 'Es gibt Personen-Kalender. Frage nach Wunschfriseur oder ob eine beliebige verfuegbare Person passt.',
        };
      }
      const teamMode = staff.staffModeActive && !staff.staffId;
      const result = teamMode
        ? await findFreeSlotsForAnyStaff(input.tenantId, {
            date: args.preferredTime,
            range: args.range,
            service: args.service,
          })
        : await findFreeSlots(input.tenantId, {
            date: args.preferredTime,
            range: args.range,
            service: args.service,
            staffId: staff.staffId,
          });
      const visibleSlots = result.slots.slice(0, 3);
      const slotOptions = visibleSlots.map((slot) => ({ slot, spokenLabel: formatSpokenSlotLabel(slot) }));
      return {
        ok: calendarSlotLookupOk(result.source),
        source: result.source,
        slots: result.slots,
        slotOptions,
        spokenOptionsText: slotOptions.length
          ? `Sag exakt diese Sprechfassung in einem Satz: ${slotOptions.map((slot) => slot.spokenLabel).join(' oder ')}.`
          : 'Keine freien Zeiten gefunden.',
        service: args.service ?? null,
        preferredStylist: staff.matchedName ?? (teamMode ? 'Beliebiger freier Mitarbeiter' : staff.requested),
        staffId: staff.staffId,
        instruction: calendarSlotInstruction(
          result.source,
          teamMode
            ? 'Biete diese Zeiten als Team-Termine an und nutze spokenOptionsText. Der konkrete Mitarbeiter wird beim Buchen automatisch nach Verfuegbarkeit zugewiesen.'
            : 'Nenne maximal drei passende Optionen in einem kurzen Satz und nutze spokenOptionsText. Wenn keine Slots vorhanden sind, erfinde keine Zeiten.',
        ),
      };
    }

    case 'calendar.book': {
      const args = BookArgsSchema.parse(input.args ?? {});
      if (!args.confirmed) {
        return {
          ok: false,
          status: 'confirmation_required',
          error: 'CONFIRMATION_REQUIRED',
          instruction: 'Buche noch nicht. Wiederhole Datum, Uhrzeit, Service und Name kurz und frage ausdruecklich nach Ja. Rufe calendar_book erst danach mit confirmed=true auf.',
        };
      }
      if (!args.customerName || /^(unbekannt|unknown|anonymous|kunde|kundin|gast)$/i.test(args.customerName.trim())) {
        return {
          ok: false,
          status: 'customer_name_required',
          error: 'CUSTOMER_NAME_REQUIRED',
          instruction: 'Buche noch nicht. Frage zuerst nach dem Namen und bestaetige danach Slot, Service und Name noch einmal.',
        };
      }
      const staff = await resolveStaffByName(input.tenantId, args.preferredStylist);
      const teamMode = staff.staffModeActive && !staff.staffId && (!staff.requested || staff.anyStaff);
      if (staff.staffModeActive && !staff.staffId && staff.requested && !staff.anyStaff) {
        return {
          ok: false,
          status: staff.requested ? 'staff_not_found' : 'staff_required',
          error: staff.requested ? 'STAFF_NOT_FOUND' : 'STAFF_REQUIRED',
          instruction: staff.requested
            ? 'Buche nicht ohne Person. Frage kurz nach einem anderen Mitarbeiter oder ob eine beliebige verfuegbare Person passt.'
            : 'Buche nicht ohne Person. Frage nach Wunschfriseur oder ob eine beliebige verfuegbare Person passt.',
          preferredStylist: staff.requested,
          staffId: null,
        };
      }
      const result = teamMode
        ? await bookSlotForAnyStaff(input.tenantId, {
            customerName: args.customerName ?? 'Unbekannt',
            customerPhone: args.customerPhone ?? '',
            time: args.preferredTime,
            service: args.service,
            notes: args.notes,
            sourceCallId: input.sessionId,
          })
        : await bookSlot(input.tenantId, {
            customerName: args.customerName ?? 'Unbekannt',
            customerPhone: args.customerPhone ?? '',
            time: args.preferredTime,
            service: args.service,
            notes: args.notes,
            sourceCallId: input.sessionId,
            staffId: staff.staffId,
          });
      const assignedStaffId = 'assignedStaffId' in result ? result.assignedStaffId ?? null : staff.staffId;
      const assignedStaffName = 'assignedStaffName' in result ? result.assignedStaffName ?? null : staff.matchedName ?? staff.requested;
      const resultStylist = assignedStaffName ?? (teamMode ? 'Beliebiger freier Mitarbeiter' : staff.requested);
      if (!result.ok) {
        if (isPastSlotError(result.error)) {
          return {
            ok: false,
            status: 'past_time_rejected',
            error: 'PAST_SLOT',
            fallback: false,
            instruction: 'Der gewuenschte Termin liegt in der Vergangenheit. Keine Buchung und kein Fallback-Ticket fuer diesen Slot erstellen; frage nach einem zukuenftigen Datum.',
            preferredTime: args.preferredTime,
            service: args.service,
            preferredStylist: resultStylist,
            staffId: assignedStaffId,
          };
        }
        // Fallback: create ticket when calendar unavailable
        const ticket = await createTicket({
          tenantId: input.tenantId,
          source: input.source,
          sessionId: input.sessionId,
          reason: 'calendar-unavailable',
          customerName: args.customerName,
          customerPhone: args.customerPhone ?? '',
          preferredTime: args.preferredTime,
          service: args.service,
          notes: args.notes,
        });
        const sms = await sendTicketAckSms({
          to: ticket.customer_phone,
          businessName: input.cfg.businessName,
          reason: 'calendar-unavailable',
          service: args.service,
        });
        return sanitizeKnownToolResultForModel({
          ok: false,
          status: 'fallback_ticket_created',
          fallback: true,
          ticketId: ticket.id,
          chipyBookingId: result.chipyBookingId,
          partial: result.partial ?? false,
          smsSent: sms.ok,
          smsError: sms.ok ? null : sms.error,
          deliveryInstruction: sms.ok ? 'SMS-Bestaetigung darf erwaehnt werden.' : 'Keine SMS-Bestaetigung behaupten; smsSent ist false.',
          preferredStylist: resultStylist,
          staffId: assignedStaffId,
          message: 'Kalenderbuchung fehlgeschlagen, Rueckruf-Ticket wurde erstellt.',
          instruction: 'Behaupte nicht, dass der Termin gebucht wurde. Sage kurz, dass der Kalender die Buchung nicht bestaetigt hat und dass ein Rueckruf-Ticket erstellt wurde.',
        });
      }
      const sms = await sendBookingConfirmationSms({
        to: args.customerPhone ?? '',
        businessName: input.cfg.businessName,
        customerName: args.customerName,
        service: args.service,
        preferredTime: args.preferredTime,
      });
      return sanitizeKnownToolResultForModel({
        ok: true,
        eventId: result.eventId,
        bookingId: result.bookingId,
        chipyBookingId: result.chipyBookingId,
        status: 'confirmed',
        smsSent: sms.ok,
        smsError: sms.ok ? null : sms.error,
        deliveryInstruction: sms.ok ? 'SMS-Bestaetigung darf erwaehnt werden.' : 'Keine SMS-Bestaetigung behaupten; smsSent ist false.',
        ...args,
        preferredStylist: resultStylist,
        staffId: assignedStaffId,
      });
    }

    case 'calendar.findBookings': {
      const args = FindBookingsArgsSchema.parse(input.args ?? {});
      const staff = await resolveStaffByName(input.tenantId, args.preferredStylist);
      if (staff.staffModeActive && !staff.staffId && staff.requested && !staff.anyStaff) {
        return {
          ok: false,
          status: 'staff_not_found',
          error: 'STAFF_NOT_FOUND',
          instruction: 'Frage nach dem genauen Mitarbeiter oder nutze Name plus Terminzeit, ohne fremde Termine preiszugeben.',
          preferredStylist: staff.requested,
        };
      }
      return sanitizeKnownToolResultForModel(await findChipyBookingsForChange(input.tenantId, {
        changeToken: args.changeToken,
        staffId: staff.staffId,
        customerName: args.customerName,
        customerPhone: args.customerPhone,
        currentTime: args.currentTime,
        service: args.service,
      }));
    }

    case 'calendar.cancel': {
      const args = CancelBookingArgsSchema.parse(input.args ?? {});
      if (!args.confirmed) {
        return {
          ok: false,
          status: 'confirmation_required',
          error: 'CONFIRMATION_REQUIRED',
          instruction: 'Wiederhole den gefundenen Termin kurz und frage ausdruecklich, ob er wirklich abgesagt werden soll. Rufe danach erst calendar_cancel mit changeToken und confirmed=true auf.',
        };
      }
      const staff = await resolveStaffByName(input.tenantId, args.preferredStylist);
      const result = await cancelChipyBookingForChange(input.tenantId, {
        changeToken: args.changeToken,
        staffId: staff.staffId,
        customerName: args.customerName,
        customerPhone: args.customerPhone,
        currentTime: args.currentTime,
        service: args.service,
        reason: args.reason,
        sourceCallId: input.sessionId,
      });
      return sanitizeKnownToolResultForModel({
        ...result,
        instruction: result.ok
          ? 'Sage kurz, dass der Termin abgesagt wurde. Erwaehne externe Kalender nur bei partial=true als internen Nachfasspunkt.'
          : 'Behaupte nicht, dass der Termin abgesagt wurde. Frage nach weiteren Details oder erstelle ein Rueckruf-Ticket.',
      });
    }

    case 'calendar.reschedule': {
      const args = RescheduleBookingArgsSchema.parse(input.args ?? {});
      if (!args.confirmed) {
        return {
          ok: false,
          status: 'confirmation_required',
          error: 'CONFIRMATION_REQUIRED',
          instruction: 'Bestaetige alten Termin und neue Uhrzeit in einem Satz und frage ausdruecklich nach Ja. Rufe danach erst calendar_reschedule mit changeToken und confirmed=true auf.',
        };
      }
      const currentStaff = await resolveStaffByName(input.tenantId, args.preferredStylist);
      const newStaff = await resolveStaffByName(input.tenantId, args.newPreferredStylist);
      if (newStaff.staffModeActive && !newStaff.staffId && newStaff.requested && !newStaff.anyStaff) {
        return {
          ok: false,
          status: 'staff_not_found',
          error: 'STAFF_NOT_FOUND',
          instruction: 'Der neue Wunschmitarbeiter wurde nicht gefunden. Frage nach einem anderen Mitarbeiter oder ob ein beliebiger freier Mitarbeiter passt.',
        };
      }
      const result = await rescheduleChipyBookingForChange(input.tenantId, {
        changeToken: args.changeToken,
        staffId: currentStaff.staffId,
        customerName: args.customerName,
        customerPhone: args.customerPhone,
        currentTime: args.currentTime,
        service: args.service,
        newTime: args.newTime,
        newService: args.newService,
        newStaffId: newStaff.staffModeActive && args.newPreferredStylist ? newStaff.staffId : undefined,
        newAnyStaff: newStaff.staffModeActive && newStaff.anyStaff,
        reason: args.reason,
        sourceCallId: input.sessionId,
      });
      return sanitizeKnownToolResultForModel({
        ...result,
        instruction: result.ok
          ? 'Sage kurz, dass der Termin verschoben wurde.'
          : result.status === 'reschedule_needs_review'
            ? 'Behaupte nicht, dass die Verschiebung vollstaendig erledigt ist. Sage, dass der neue Termin intern vorgemerkt ist, aber das Team die alte Buchung/externen Kalender noch prueft und nachfasst.'
            : 'Behaupte nicht, dass der Termin verschoben wurde. Biete alternative Zeiten oder Rueckruf an.',
      });
    }

    case 'ticket.create': {
      const args = TicketCreateArgsSchema.parse(input.args ?? {});
      const row = await createTicket({
        tenantId: input.tenantId,
        source: input.source,
        sessionId: input.sessionId,
        reason: args.reason ?? normalizeFallbackReasonValue(input.cfg.fallback.reason),
        customerName: args.customerName,
        customerPhone: args.customerPhone,
        preferredTime: args.preferredTime,
        service: args.service,
        notes: args.notes,
      });
      const sms = await sendTicketAckSms({
        to: row.customer_phone,
        businessName: input.cfg.businessName,
        reason: row.reason,
        service: row.service,
      });
      return sanitizeKnownToolResultForModel({
        ok: true,
        ticketId: row.id,
        status: row.status,
        customerPhone: row.customer_phone,
        smsSent: sms.ok,
        smsError: sms.ok ? null : sms.error,
      });
    }

    default:
      return { ok: false, error: 'UNKNOWN_TOOL' };
  }
}
