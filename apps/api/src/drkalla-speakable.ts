/**
 * TTS-normalization for the DrKalla voice agent's DETERMINISTIC spoken replies.
 *
 * Low-latency neural voices (Flash-class, as Retell uses) frequently run with
 * text normalization OFF for latency, so abbreviations and symbols can surface
 * literally ("Dr." spelled "De-Er", "&" silent). We pre-render only the parts
 * known to break this voice stack.
 *
 * Applied only to deterministic single-frame replies (greeting, need-reply,
 * price, SMS, smalltalk, farewell, contact, reminders); streamed model frames
 * are already on the wire, so the model is steered by prompt rules instead.
 */
export function speakDrkallaText(text: string): string {
  return text
    // Domain/email FIRST, so the brand rule never double-processes the handle.
    // The website is written "drkalla.com" but must be SPOKEN as the brand:
    // "Doktor Kalla punkt com" (live complaint 2026-06-27 — it was read as the
    // letters "de-er-kalla").
    .replace(/\bdrkalla\.com\b/gi, 'Doktor Kalla punkt com')
    .replace(/\s*@\s*/g, ' at ')
    // Brand name in a sentence -> spoken name. Require the period or a space
    // ("Dr.Kalla" / "Dr. Kalla") so a bare lowercase handle is left untouched.
    .replace(/\bDr\.\s?Kalla\b/g, 'Doktor Kalla')
    .replace(/\bDr\s+Kalla\b/g, 'Doktor Kalla')
    .replace(/\bDr\.\s?(?=[A-ZÄÖÜ])/g, 'Doktor ')
    // Symbols → spoken words.
    .replace(/\s*&\s*/g, ' und ')
    // Whole-euro prices: drop ",00" cents so the voice does not read an extra
    // "null null" / "o o" after the amount (live complaint 2026-06-27).
    .replace(/(\d+),00(?=\s*(?:€|Euro\b))/g, '$1')
    .replace(/€/g, ' Euro')
    .replace(/(\d)\s*%/g, '$1 Prozent')
    // Common German abbreviations the voice would otherwise spell or mangle.
    .replace(/\bz\.\s?B\.\s?/gi, 'zum Beispiel ')
    .replace(/\bu\.\s?a\.\s?/gi, 'unter anderem ')
    .replace(/\bbzw\.\s?/gi, 'beziehungsweise ')
    .replace(/\b(?:usw|etc)\.\s?/gi, 'und so weiter ')
    .replace(/\bca\.\s?/gi, 'circa ')
    .replace(/\bNr\.\s?/gi, 'Nummer ')
    .replace(/\bStr\.\s?/g, 'Straße ')
    // Keep German comma prices intact; "11 Euro 99" sounded wrong in live calls.
    // Tidy whitespace and a stray space before sentence punctuation.
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
