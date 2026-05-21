export type ActionCriticality = 'read' | 'write' | 'irreversible' | 'privacy';

export type ActionContract = {
  id: string;
  toolName: string;
  purpose: string;
  criticality: ActionCriticality;
  requiredFields: string[];
  confirmationFields: string[];
  identityRequirement: 'none' | 'phone_or_email' | 'verified_phone_or_confirmed_email';
  mayMutate: boolean;
  successVerbs: string[];
  forbiddenClaimsWithoutSuccess: string[];
};

export const ACTION_CONTRACTS = {
  customerLookup: {
    id: 'customer.lookup',
    toolName: 'customer_lookup',
    purpose: 'Find an existing customer without exposing private data unless identity is strong enough.',
    criticality: 'read',
    requiredFields: [],
    confirmationFields: [],
    identityRequirement: 'phone_or_email',
    mayMutate: false,
    successVerbs: ['gefunden'],
    forbiddenClaimsWithoutSuccess: ['ich habe deine Daten gefunden'],
  },
  customerUpsert: {
    id: 'customer.upsert',
    toolName: 'customer_upsert',
    purpose: 'Create or update customer details after the caller gave them for this purpose.',
    criticality: 'write',
    requiredFields: ['nameOrPhoneOrEmail'],
    confirmationFields: [],
    identityRequirement: 'phone_or_email',
    mayMutate: true,
    successVerbs: ['gespeichert', 'aktualisiert'],
    forbiddenClaimsWithoutSuccess: ['ich habe deine Daten gespeichert'],
  },
  calendarFindSlots: {
    id: 'calendar.findSlots',
    toolName: 'calendar_find_slots',
    purpose: 'Find available future appointment options.',
    criticality: 'read',
    requiredFields: ['requestedDateOrRange', 'service'],
    confirmationFields: [],
    identityRequirement: 'none',
    mayMutate: false,
    successVerbs: ['gefunden'],
    forbiddenClaimsWithoutSuccess: ['ich habe einen Termin frei'],
  },
  calendarBook: {
    id: 'calendar.book',
    toolName: 'calendar_book',
    purpose: 'Create a confirmed future appointment.',
    criticality: 'write',
    requiredFields: ['customerName', 'service', 'startAt', 'confirmed'],
    confirmationFields: ['customerName', 'service', 'startAt'],
    identityRequirement: 'phone_or_email',
    mayMutate: true,
    successVerbs: ['gebucht', 'eingetragen'],
    forbiddenClaimsWithoutSuccess: ['der Termin ist gebucht', 'ich habe den Termin eingetragen'],
  },
  calendarFindBookings: {
    id: 'calendar.findBookings',
    toolName: 'calendar_find_bookings',
    purpose: 'Find existing bookings for cancellation or rescheduling.',
    criticality: 'read',
    requiredFields: ['customerIdentity'],
    confirmationFields: [],
    identityRequirement: 'verified_phone_or_confirmed_email',
    mayMutate: false,
    successVerbs: ['gefunden'],
    forbiddenClaimsWithoutSuccess: ['ich habe deinen Termin gefunden'],
  },
  calendarCancel: {
    id: 'calendar.cancel',
    toolName: 'calendar_cancel',
    purpose: 'Cancel a confirmed existing appointment.',
    criticality: 'irreversible',
    requiredFields: ['changeToken', 'confirmed'],
    confirmationFields: ['existingAppointment'],
    identityRequirement: 'verified_phone_or_confirmed_email',
    mayMutate: true,
    successVerbs: ['abgesagt', 'storniert'],
    forbiddenClaimsWithoutSuccess: ['der Termin ist abgesagt'],
  },
  calendarReschedule: {
    id: 'calendar.reschedule',
    toolName: 'calendar_reschedule',
    purpose: 'Move a confirmed existing appointment to a confirmed future slot.',
    criticality: 'write',
    requiredFields: ['changeToken', 'newStartAt', 'confirmed'],
    confirmationFields: ['existingAppointment', 'newStartAt'],
    identityRequirement: 'verified_phone_or_confirmed_email',
    mayMutate: true,
    successVerbs: ['verschoben'],
    forbiddenClaimsWithoutSuccess: ['der Termin ist verschoben'],
  },
  ticketCreate: {
    id: 'ticket.create',
    toolName: 'ticket_create',
    purpose: 'Create a callback or handoff ticket.',
    criticality: 'write',
    requiredFields: [],
    confirmationFields: [],
    identityRequirement: 'none',
    mayMutate: true,
    successVerbs: ['notiert', 'weitergegeben'],
    forbiddenClaimsWithoutSuccess: ['ich habe es weitergegeben'],
  },
} satisfies Record<string, ActionContract>;
