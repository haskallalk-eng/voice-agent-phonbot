export function normalizePhoneLight(input: string): { digits: string; normalized: string } {
  const trimmed = input.trim();
  // Keep leading + if present, otherwise just digits.
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  const normalized = hasPlus ? `+${digits}` : digits;
  return { digits, normalized };
}

// German premium / short-code / information-service prefixes.
// Calling these from our Retell/Twilio trunk bills us per-minute at premium rates
// (0137 ≈ 0.14 €/min, 0180 up to 0.42 €/min, 0900 up to 3 €/min, 118xx Auskunft
// up to 2 €/min). An attacker who can submit a phone number via /retell/tools/ticket.create
// or /demo/callback etc. could otherwise burn our Twilio budget dialling these.
const DE_BLOCKED_PREFIXES = [
  '0137', '0180', '0190', '0900',  // Premium-rate
  '0116', '0118',                  // Information services (118xx Auskunft, 116xxx social)
  '0700',                          // Personal numbering (unpredictable routing cost)
];

// International premium-rate patterns we actively reject even if the higher-level
// whitelist (ALLOWED_PHONE_PREFIXES in phone.ts) would pass them. Keep this list
// conservative — false-positives block legit calls. Source: major regulator lists.
// Format: E.164 with leading '+'. Matched by prefix on the normalised value.
const INTL_BLOCKED_PREFIXES = [
  '+1900', '+1976',                // US/Canada 900 + adult/premium
  '+44871', '+44872', '+44873',    // UK service/business-rate (20p–13p/min)
  '+4470',                         // UK personal number (unpredictable routing cost)
  '+4490', '+44900',               // UK premium
  '+3308', '+3308',                // French 08xx service
  '+39899',                        // Italy 899 premium
  '+34803', '+34806', '+34807',    // Spain 80x premium
  '+4390', '+43930',               // Austria 0930 premium
  '+41901', '+41906',              // Switzerland 090x premium
];

/**
 * Reject obvious premium/toll numbers regardless of country. A positive result
 * does NOT mean the number is safe to dial — callsites must still run their own
 * allow-list check (ALLOWED_PHONE_PREFIXES) for country-level control.
 */
export function isPlausiblePhone(input: string): boolean {
  const { digits, normalized } = normalizePhoneLight(input);
  // E.164 max is 15 digits; min 7 is enough for national 10-digit numbers with area code.
  if (digits.length < 7 || digits.length > 15) return false;

  // Normalise DE/international variants to a local 0-prefix form for prefix matching.
  // +49 / 0049 / 49 → 0...
  let de = digits;
  if (de.startsWith('0049')) de = '0' + de.slice(4);
  else if (de.startsWith('49')) de = '0' + de.slice(2);

  if (DE_BLOCKED_PREFIXES.some((p) => de.startsWith(p))) return false;

  // International premium: match on '+' + digits form, but also on bare '00'
  // (european international-dial prefix) so '0044...' catches UK premium too.
  const plusForm = normalized.startsWith('+') ? normalized : `+${digits.replace(/^0+/, '')}`;
  const doubleZeroForm = digits.startsWith('00') ? `+${digits.slice(2)}` : plusForm;
  if (INTL_BLOCKED_PREFIXES.some((p) => plusForm.startsWith(p) || doubleZeroForm.startsWith(p))) return false;

  return true;
}

/**
 * Best-effort conversion of a user-typed phone string to E.164 (+<cc><digits>).
 *
 * Retell `transfer_call` and Twilio both require E.164 — feeding them a raw
 * German local number like `017676679632` makes the live transfer fail
 * silently, which is the #1 reason the 'weiter­leiten'-Regel im Agent Builder
 * nicht griff (2026-04-22). Normalising at deploy time + instruction-build
 * time keeps the raw string in the DB but always ships a valid E.164 to the
 * outside world.
 *
 * Returns null when the input clearly isn't a phone number (too short/long
 * or an unparseable leading run). Callers should treat null as "skip this
 * rule and warn the user to fix the number".
 *
 * Rules:
 *  - Already starts with '+'      → strip non-digits, prepend '+'.
 *  - Leading '0049'               → '+49' + rest.
 *  - Leading '49' (10+ digits)    → '+' + digits.
 *  - Leading '0'                  → treat as German local (default), '+49' + rest.
 *  - Anything else                → null.
 */
export function toE164(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;

  if (hasPlus) return '+' + digits;
  if (digits.startsWith('0049')) return '+' + digits.slice(2);
  // '49…' without leading '0' — assume E.164 minus the '+', but only when the
  // total length plausibly fits a German number (country code 49 + at least
  // 9 subscriber digits).
  if (digits.startsWith('49') && digits.length >= 11) return '+' + digits;
  // Leading '0' is the German local-dial prefix → swap for '+49'.
  if (digits.startsWith('0')) return '+49' + digits.slice(1);
  return null;
}
