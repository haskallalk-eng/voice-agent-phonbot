// PII redaction for training data + logs.
// Conservative approach: redact obvious patterns we can detect with high confidence.
// Never redact agent/business content — only customer-identifying data.
//
// Redacts:
// - Phone numbers (DE variants + international)
// - Email addresses
// - IBANs (DE, EU general)
// - Credit card numbers (16-19 digits, basic Luhn not applied — conservative)
// - German street+house-number patterns ("Musterstraße 12")
// - Dates of birth (12.03.1985 style — birthdays, not future appointment times)
//
// Returns redacted text with tokens like [PHONE], [EMAIL], [IBAN], [CC], [ADDRESS], [DOB].

// Order matters: more specific patterns first so a phone doesn't get mis-matched as CC etc.
type Replacement = string | ((match: string) => string);
const PATTERNS: Array<[RegExp, Replacement]> = [
  // Email
  [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]'],

  // IBAN (DE + generic EU: 2 letters + 2 digits + 10-30 alphanumeric)
  [/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){10,30}\b/g, '[IBAN]'],

  // Phone — run BEFORE CC so 13+ digit phones don't match CC regex
  // International (+49 30 12345678)
  [/\+\d{1,3}[\s-]?\d{1,4}[\s-]?\d{2,}[\s-]?\d{2,}\d*/g, '[PHONE]'],
  // National (030 12345678 / 0176-12345678)
  [/\b0\d{2,4}[\s-]?\d{3,}[\s-]?\d*\b/g, '[PHONE]'],

  // Date of birth (DD.MM.YYYY) — birth-plausible years only
  [/\b(0?[1-9]|[12]\d|3[01])[./](0?[1-9]|1[0-2])[./](19\d{2}|20[0-2]\d)\b/g, '[DOB]'],

  // German street + house number
  [/\b[A-ZÄÖÜ][a-zäöüß]{2,}(?:straße|str\.|weg|platz|allee|gasse|ring|damm|ufer)\s+\d+[a-z]?\b/gi, '[ADDRESS]'],

  // Credit card (13-19 digits, formatted groups) — last because most permissive
  [/\b(?:\d[\s-]?){13,19}\b/g, (match: string) => {
    const digits = match.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 ? '[CC]' : match;
  }],
];

export function redactPII(text: string | null | undefined): string {
  if (!text) return text ?? '';
  let out = text;
  for (const [pattern, replacement] of PATTERNS) {
    if (typeof replacement === 'function') {
      out = out.replace(pattern, replacement);
    } else {
      out = out.replace(pattern, replacement);
    }
  }
  return out;
}

export function redactMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m) => {
    if (m && typeof m === 'object' && 'content' in m && typeof (m as { content: unknown }).content === 'string') {
      return { ...m, content: redactPII((m as { content: string }).content) };
    }
    return m;
  });
}
