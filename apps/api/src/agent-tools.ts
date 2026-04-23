import { z } from 'zod';
import { createTicket } from './tickets.js';
import type { readConfig } from './agent-config.js';
import { appendTraceEvent } from './traces.js';
import { findFreeSlots, bookSlot } from './calendar.js';
import { sendBookingConfirmationSms, sendTicketAckSms } from './sms.js';

export const KnownToolNameSchema = z.enum(['calendar.findSlots', 'calendar.book', 'ticket.create']);

/** OpenAI requires tool names to match ^[a-zA-Z0-9_-]+$ */
function sanitizeToolName(name: string): string {
  return name.replace(/\./g, '_');
}
export type KnownToolName = z.infer<typeof KnownToolNameSchema>;

const FindSlotsArgsSchema = z.object({
  service: z.string().min(1).optional(),
  range: z.string().min(1).optional(),
  preferredTime: z.string().min(1).optional(),
});

const BookArgsSchema = z.object({
  customerName: z.string().min(1).optional(),
  customerPhone: z.string().min(1).optional(),
  preferredTime: z.string().min(1),
  service: z.string().min(1),
  notes: z.string().min(1).optional(),
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

export function getEnabledKnownTools(cfg: AgentConfig): KnownToolName[] {
  return cfg.tools.filter((tool): tool is KnownToolName => KnownToolNameSchema.safeParse(tool).success);
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
        },
        additionalProperties: false,
      },
    });
  }

  if (enabled.has('calendar.book')) {
    tools.push({
      type: 'function',
      name: sanitizeToolName('calendar.book'),
      description: 'Create a booking after the user confirmed a slot and service.',
      parameters: {
        type: 'object',
        properties: {
          customerName: { type: 'string' },
          customerPhone: { type: 'string' },
          preferredTime: { type: 'string', description: 'Confirmed slot/time.' },
          service: { type: 'string', description: 'Booked service.' },
          notes: { type: 'string' },
        },
        required: ['preferredTime', 'service'],
        additionalProperties: false,
      },
    });
  }

  if (enabled.has('ticket.create')) {
    tools.push({
      type: 'function',
      name: sanitizeToolName('ticket.create'),
      description: 'Create a callback or handoff ticket when the user wants human follow-up or booking cannot be completed live.',
      parameters: {
        type: 'object',
        properties: {
          customerName: { type: 'string' },
          customerPhone: { type: 'string', description: 'Callback phone number.' },
          preferredTime: { type: 'string' },
          service: { type: 'string' },
          notes: { type: 'string' },
          reason: { type: 'string' },
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
    case 'ticket.create':
    case 'ticket_create':
      return 'ticket.create';
    default:
      return null;
  }
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
      const result = await findFreeSlots(input.tenantId, {
        date: args.preferredTime,
        range: args.range,
        service: args.service,
      });
      return {
        ok: true,
        source: result.source,
        slots: result.slots,
        service: args.service ?? null,
      };
    }

    case 'calendar.book': {
      const args = BookArgsSchema.parse(input.args ?? {});
      const result = await bookSlot(input.tenantId, {
        customerName: args.customerName ?? 'Unbekannt',
        customerPhone: args.customerPhone ?? '',
        time: args.preferredTime,
        service: args.service,
        notes: args.notes,
        sourceCallId: input.sessionId,
      });
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
      };
    }

    case 'ticket.create': {
      const args = TicketCreateArgsSchema.parse(input.args ?? {});
      const row = await createTicket({
        tenantId: input.tenantId,
        source: input.source,
        sessionId: input.sessionId,
        reason: args.reason ?? input.cfg.fallback.reason,
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
