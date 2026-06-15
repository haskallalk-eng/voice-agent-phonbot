/**
 * TTS-normalization for the DrKalla voice agent's DETERMINISTIC spoken replies.
 *
 * Low-latency neural voices (Flash-class, as Retell uses) frequently run with
 * text normalization OFF for latency, so abbreviations, symbols and decimal
 * commas surface literally ("Dr." spelled "De-Er", "&" silent, "9,00 Euro" as
 * "neun Komma null null"). We pre-render the text the way it should be spoken.
 *
 * Applied only to deterministic single-frame replies (greeting, need-reply,
 * price, SMS, smalltalk, farewell, contact, reminders); streamed model frames
 * are already on the wire, so the model is steered by prompt rules instead.
 */
export function speakDrkallaText(text: string): string {
  return text
    // Domain/email FIRST, so the brand rule never rewrites the URL handle.
    // "drkalla.com" -> "drkalla punkt com" (the "." would read as a pause / the
    // brand rule would wrongly turn the handle into "Doktor Kalla.com").
    .replace(/\bdrkalla\.com\b/gi, 'drkalla punkt com')
    .replace(/\s*@\s*/g, ' at ')
    // Brand name in a sentence -> spoken name. Require the period or a space
    // ("Dr.Kalla" / "Dr. Kalla") so the lowercase domain handle "drkalla" is
    // left untouched.
    .replace(/\bDr\.\s?Kalla\b/g, 'Doktor Kalla')
    .replace(/\bDr\s+Kalla\b/g, 'Doktor Kalla')
    .replace(/\bDr\.\s?(?=[A-ZÄÖÜ])/g, 'Doktor ')
    // Symbols → spoken words.
    .replace(/\s*&\s*/g, ' und ')
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
    // Money backup: any "9,00 Euro" that slipped through → "9 Euro" / "11 Euro 99".
    .replace(/(\d+),(\d{2})\s*Euro/g, (_m, euros, cents) =>
      (cents === '00' ? `${euros} Euro` : `${euros} Euro ${Number(cents)}`))
    // Tidy whitespace and a stray space before sentence punctuation.
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
