export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; code: string; message: string; instruction: string };

export type PolicyInput = {
  toolName: string;
  args: Record<string, unknown>;
  callerPhoneVerified?: boolean;
  callerEmailConfirmed?: boolean;
  nowIsoDate: string;
};

function stringValue(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

function boolValue(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

function anyStringValue(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = stringValue(args, key);
    if (value) return value;
  }
  return '';
}

function hasIdentity(input: PolicyInput): boolean {
  return Boolean(
    input.callerPhoneVerified ||
    input.callerEmailConfirmed ||
    stringValue(input.args, 'customerPhone') ||
    stringValue(input.args, 'email') ||
    stringValue(input.args, 'phone'),
  );
}

function hasStrongIdentity(input: PolicyInput): boolean {
  return Boolean(input.callerPhoneVerified || input.callerEmailConfirmed);
}

function reject(code: string, message: string, instruction: string): PolicyDecision {
  return { allowed: false, code, message, instruction };
}

export function evaluateToolPolicy(input: PolicyInput): PolicyDecision {
  const { toolName, args } = input;

  if (toolName === 'calendar_book') {
    if (!boolValue(args, 'confirmed')) {
      return reject(
        'CONFIRMATION_REQUIRED',
        'Bitte bestaetige zuerst Name, Leistung, Datum und Uhrzeit.',
        'Frage den Anrufer nach ausdruecklicher Bestaetigung der konkreten Termindaten.',
      );
    }
    if (!anyStringValue(args, ['customerName', 'customer_name', 'name'])) {
      return reject(
        'CUSTOMER_NAME_REQUIRED',
        'Es fehlt der Name fuer die Terminbuchung.',
        'Frage nach dem Namen und bestaetige danach die Termindaten erneut.',
      );
    }
    if (!anyStringValue(args, ['startAt', 'preferredTime', 'preferred_time', 'time'])) {
      return reject(
        'PREFERRED_TIME_REQUIRED',
        'Es fehlt die konkrete Uhrzeit fuer die Terminbuchung.',
        'Frage nach Datum und Uhrzeit und pruefe danach die Verfuegbarkeit.',
      );
    }
    if (!stringValue(args, 'service')) {
      return reject('SERVICE_REQUIRED', 'Es fehlt die Leistung fuer die Terminbuchung.', 'Frage nach der gewuenschten Leistung.');
    }
    if (!hasIdentity(input)) {
      return reject('CONTACT_REQUIRED', 'Es fehlt ein Kontaktweg fuer Rueckfragen.', 'Frage nach Telefonnummer oder E-Mail.');
    }
  }

  if (toolName === 'calendar_find_bookings') {
    if (!hasStrongIdentity(input)) {
      return reject(
        'STRONG_IDENTITY_REQUIRED',
        'Bestehende Termine duerfen nur mit sicherer Identitaet gesucht werden.',
        'Nutze verifizierte Anrufernummer oder bestaetigte E-Mail; Name allein reicht nicht.',
      );
    }
  }

  if (toolName === 'calendar_cancel') {
    if (!hasStrongIdentity(input)) {
      return reject(
        'STRONG_IDENTITY_REQUIRED',
        'Terminabsagen brauchen sichere Identitaet.',
        'Klaere die Identitaet ueber verifizierte Telefonnummer oder bestaetigte E-Mail.',
      );
    }
    if (!anyStringValue(args, ['changeToken', 'change_token']) || !boolValue(args, 'confirmed')) {
      return reject(
        'CHANGE_CONFIRMATION_REQUIRED',
        'Terminabsage braucht Treffer und Bestaetigung.',
        'Finde zuerst den Termin, wiederhole ihn knapp und frage nach Bestaetigung.',
      );
    }
  }

  if (toolName === 'calendar_reschedule') {
    if (!hasStrongIdentity(input)) {
      return reject(
        'STRONG_IDENTITY_REQUIRED',
        'Terminverschiebungen brauchen sichere Identitaet.',
        'Klaere die Identitaet ueber verifizierte Telefonnummer oder bestaetigte E-Mail.',
      );
    }
    if (
      !anyStringValue(args, ['changeToken', 'change_token']) ||
      !anyStringValue(args, ['newStartAt', 'new_start_at', 'newTime', 'new_time', 'newPreferredTime', 'new_preferred_time']) ||
      !boolValue(args, 'confirmed')
    ) {
      return reject(
        'RESCHEDULE_CONFIRMATION_REQUIRED',
        'Terminverschiebung braucht alten Termin, neue Zeit und Bestaetigung.',
        'Finde den alten Termin, pruefe neue Verfuegbarkeit und lasse beides bestaetigen.',
      );
    }
  }

  return { allowed: true };
}
