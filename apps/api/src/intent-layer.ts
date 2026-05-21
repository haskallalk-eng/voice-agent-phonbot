export type VoiceIntent =
  | 'faq'
  | 'book_appointment'
  | 'cancel_appointment'
  | 'reschedule_appointment'
  | 'find_customer'
  | 'update_customer'
  | 'create_ticket'
  | 'privacy_decline'
  | 'end_call'
  | 'unknown';

const TOOL_INTENTS: Record<string, VoiceIntent> = {
  customer_lookup: 'find_customer',
  customer_upsert: 'update_customer',
  calendar_find_slots: 'book_appointment',
  calendar_book: 'book_appointment',
  calendar_find_bookings: 'reschedule_appointment',
  calendar_cancel: 'cancel_appointment',
  calendar_reschedule: 'reschedule_appointment',
  ticket_create: 'create_ticket',
  recording_declined: 'privacy_decline',
  end_call: 'end_call',
};

export function intentFromTool(toolName: string): VoiceIntent {
  return TOOL_INTENTS[toolName] ?? 'unknown';
}

export function intentFromUtterance(text: string): VoiceIntent {
  const normalized = text
    .toLowerCase()
    .replace(/\u00e4/g, 'ae')
    .replace(/\u00f6/g, 'oe')
    .replace(/\u00fc/g, 'ue')
    .replace(/\u00df/g, 'ss');
  if (/\b(absagen|stornieren|canceln)\b/.test(normalized)) return 'cancel_appointment';
  if (/\b(verschieben|verlegen|andere uhrzeit|anderer tag)\b/.test(normalized)) return 'reschedule_appointment';
  if (/\b(termin|buchen|reservieren|slot)\b/.test(normalized)) return 'book_appointment';
  if (/\b(aufzeichnung|aufnahme|datenschutz|speicherung).*?(nein|nicht|ablehnen|widerspreche)\b/.test(normalized)) return 'privacy_decline';
  if (/\b(tschuess|auflegen|beenden)\b/.test(normalized)) return 'end_call';
  if (/\b(rueckruf|mensch|mitarbeiter|support)\b/.test(normalized)) return 'create_ticket';
  return 'unknown';
}
