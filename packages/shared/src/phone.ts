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

export function isPlausiblePhone(input: string): boolean {
  const { digits } = normalizePhoneLight(input);
  // E.164 max is 15 digits; min 7 is enough for national 10-digit numbers with area code.
  if (digits.length < 7 || digits.length > 15) return false;

  // Normalise DE/international variants to a local 0-prefix form for prefix matching.
  // +49 / 0049 / 49 → 0...
  let de = digits;
  if (de.startsWith('0049')) de = '0' + de.slice(4);
  else if (de.startsWith('49')) de = '0' + de.slice(2);

  if (DE_BLOCKED_PREFIXES.some((p) => de.startsWith(p))) return false;
  return true;
}
