import { z } from 'zod';
import { createTicket } from './tickets.js';
import type { readConfig } from './agent-config.js';
import { appendTraceEvent } from './traces.js';
import {
  findFreeSlots,
  findFreeSlotsForAnyStaff,
  bookSlot,
  bookSlotForAnyStaff,
  findChipyBookingsForChange,
  cancelChipyBookingForChange,
  rescheduleChipyBookingForChange,
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
  return name.replace(/\./g, '_');
}
export type KnownToolName = z.infer<typeof KnownToolNameSchema>;

const FindSlotsArgsSchema = z.object({
  service: z.string().min(1).optional(),
  range: z.string().min(1).optional(),
  preferredTime: z.string().min(1).optional(),
  preferredStylist: z.string().min(1).optional(),
});

const BookArgsSchema = z.object({
  customerName: z.string().min(1).optional(),
  customerPhone: z.string().min(1).optional(),
  preferredTime: z.string().min(1),
  service: z.string().min(1),
  preferredStylist: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
});

const FindBookingsArgsSchema = z.object({
  bookingId: z.string().min(1).optional(),
  customerName: z.string().min(1).optional(),
  customerPhone: z.string().min(1).optional(),
  currentTime: z.string().min(1).optional(),
  service: z.string().min(1).optional(),
  preferredStylist: z.string().min(1).optional(),
});

const CancelBookingArgsSchema = FindBookingsArgsSchema.extend({
  confirmed: z.boolean().optional().default(false),
  reason: z.string().min(1).optional(),
});

const RescheduleBookingArgsSchema = FindBookingsArgsSchema.extend({
  newTime: z.string().min(1),
  newService: z.string().min(1).optional(),
  newPreferredStylist: z.string().min(1).optional(),
  confirmed: z.boolean().optional().default(false),
  reason: z.string().min(1).optional(),
});

const TicketCreateArgsSchema = z.object({
  customerName: z.string().min(1).optional(),
  customerPhone: z.string().min(1),
  preferredTime: z.string().min(1).optional(),
  service: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
});

type AgentConfig = Awaited<ReturnType<typeof readConfig>>;

const DEFAULT_FALLBACK_REASON = 'Allgemeine Übergabe';

function normalizeFallbackReasonValue(reason: string | null | undefined): string {
  const trimmed = reason?.trim();
  if (!trimmed || trimmed === 'handoff') return DEFAULT_FALLBACK_REASON;
  return trimmed;
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
      description: 'Find available appointment slots. Present at most three options to the caller, grouped by day.',
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
      description: 'Create a booking after the user confirmed a slot and service. Mention SMS confirmation only when the result returns smsSent=true.',
      parameters: {
        type: 'object',
        properties: {
          customerName: { type: 'string' },
          customerPhone: { type: 'string' },
          preferredTime: { type: 'string', description: 'Confirmed slot/time.' },
          service: { type: 'string', description: 'Booked service.' },
          preferredStylist: { type: 'string', description: 'Requested staff member/stylist name. Use "beliebig" when the caller has no staff preference.' },
          notes: { type: 'string' },
        },
        required: ['preferredTime', 'service'],
        additionalProperties: false,
      },
    });
  }

  if (enabled.has('calendar.findBookings')) {
    tools.push({
      type: 'function',
      name: sanitizeToolName('calendar.findBookings'),
      description: 'Find an existing future appointment before cancellation or rescheduling. Do not reveal other customer data; use caller phone, name, current appointment time, or bookingId to narrow the match.',
      parameters: {
        type: 'object',
        properties: {
          bookingId: { type: 'string', description: 'Booking id returned by a previous findBookings call.' },
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
          bookingId: { type: 'string', description: 'Booking id returned by findBookings.' },
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
          bookingId: { type: 'string', description: 'Booking id returned by findBookings.' },
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
            : 'Mitarbeiterkalender ist aktiv. Frage nach Wunschfriseur oder ob ein beliebiger verfuegbarer Mitarbeiter passt.',
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
      return {
        ok: true,
        source: result.source,
        slots: result.slots,
        service: args.service ?? null,
        preferredStylist: staff.matchedName ?? (teamMode ? 'Beliebiger freier Mitarbeiter' : staff.requested),
        staffId: staff.staffId,
        ...(teamMode ? { instruction: 'Biete diese Zeiten als Team-Termine an. Der konkrete Mitarbeiter wird beim Buchen automatisch nach Verfuegbarkeit zugewiesen.' } : {}),
      };
    }

    case 'calendar.book': {
      const args = BookArgsSchema.parse(input.args ?? {});
      const staff = await resolveStaffByName(input.tenantId, args.preferredStylist);
      const teamMode = staff.staffModeActive && !staff.staffId && (!staff.requested || staff.anyStaff);
      if (staff.staffModeActive && !staff.staffId && staff.requested && !staff.anyStaff) {
        return {
          ok: false,
          status: staff.requested ? 'staff_not_found' : 'staff_required',
          error: staff.requested ? 'STAFF_NOT_FOUND' : 'STAFF_REQUIRED',
          instruction: staff.requested
            ? 'Buche keinen allgemeinen Salon-Termin. Frage kurz nach einem anderen Mitarbeiter oder ob ein beliebiger verfuegbarer Mitarbeiter passt.'
            : 'Buche keinen allgemeinen Salon-Termin. Frage nach Wunschfriseur oder ob ein beliebiger verfuegbarer Mitarbeiter passt.',
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
        return {
          ok: true,
          fallback: true,
          ticketId: ticket.id,
          chipyBookingId: result.chipyBookingId,
          partial: result.partial ?? false,
          smsSent: sms.ok,
          smsError: sms.ok ? null : sms.error,
          preferredStylist: resultStylist,
          staffId: assignedStaffId,
          message: 'Terminwunsch als Ticket gespeichert.',
        };
      }
      const sms = await sendBookingConfirmationSms({
        to: args.customerPhone ?? '',
        businessName: input.cfg.businessName,
        customerName: args.customerName,
        service: args.service,
        preferredTime: args.preferredTime,
      });
      return {
        ok: true,
        eventId: result.eventId,
        bookingId: result.bookingId,
        chipyBookingId: result.chipyBookingId,
        status: 'confirmed',
        smsSent: sms.ok,
        smsError: sms.ok ? null : sms.error,
        ...args,
        preferredStylist: resultStylist,
        staffId: assignedStaffId,
      };
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
      return findChipyBookingsForChange(input.tenantId, {
        bookingId: args.bookingId,
        staffId: staff.staffId,
        customerName: args.customerName,
        customerPhone: args.customerPhone,
        currentTime: args.currentTime,
        service: args.service,
      });
    }

    case 'calendar.cancel': {
      const args = CancelBookingArgsSchema.parse(input.args ?? {});
      if (!args.confirmed) {
        return {
          ok: false,
          status: 'confirmation_required',
          error: 'CONFIRMATION_REQUIRED',
          instruction: 'Wiederhole den gefundenen Termin kurz und frage ausdruecklich, ob er wirklich abgesagt werden soll. Rufe danach erst calendar.cancel mit confirmed=true auf.',
        };
      }
      const staff = await resolveStaffByName(input.tenantId, args.preferredStylist);
      const result = await cancelChipyBookingForChange(input.tenantId, {
        bookingId: args.bookingId,
        staffId: staff.staffId,
        customerName: args.customerName,
        customerPhone: args.customerPhone,
        currentTime: args.currentTime,
        service: args.service,
        reason: args.reason,
        sourceCallId: input.sessionId,
      });
      return {
        ...result,
        instruction: result.ok
          ? 'Sage kurz, dass der Termin abgesagt wurde. Erwaehne externe Kalender nur bei partial=true als internen Nachfasspunkt.'
          : 'Behaupte nicht, dass der Termin abgesagt wurde. Frage nach weiteren Details oder erstelle ein Rueckruf-Ticket.',
      };
    }

    case 'calendar.reschedule': {
      const args = RescheduleBookingArgsSchema.parse(input.args ?? {});
      if (!args.confirmed) {
        return {
          ok: false,
          status: 'confirmation_required',
          error: 'CONFIRMATION_REQUIRED',
          instruction: 'Bestaetige alten Termin und neue Uhrzeit in einem Satz und frage ausdruecklich nach Ja. Rufe danach erst calendar.reschedule mit confirmed=true auf.',
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
        bookingId: args.bookingId,
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
      return {
        ...result,
        instruction: result.ok
          ? 'Sage kurz, dass der Termin verschoben wurde. Wenn partial=true, sage dass das Team intern noch einmal nachfasst.'
          : 'Behaupte nicht, dass der Termin verschoben wurde. Biete alternative Zeiten oder Rueckruf an.',
      };
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
      return {
        ok: true,
        ticketId: row.id,
        status: row.status,
        customerPhone: row.customer_phone,
        smsSent: sms.ok,
        smsError: sms.ok ? null : sms.error,
      };
    }

    default:
      return { ok: false, error: 'UNKNOWN_TOOL' };
  }
}
