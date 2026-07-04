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
// Spoken cent words (1..99) so the voice never reads decimal cents digit-by-digit.
const SPOKEN_CENT_ONES = [
  '', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun',
  'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn',
];
const SPOKEN_CENT_TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

function spokenCents(n: number): string {
  if (n < 20) return SPOKEN_CENT_ONES[n] ?? '';
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  if (ones === 0) return SPOKEN_CENT_TENS[tens] ?? '';
  return `${ones === 1 ? 'ein' : (SPOKEN_CENT_ONES[ones] ?? '')}und${SPOKEN_CENT_TENS[tens] ?? ''}`;
}

/**
 * Normalize ANY written price to a TTS-safe SPOKEN form so the low-latency voice
 * never reads decimal cents digit-by-digit ("7,60" -> "...sechs null" = the
 * recurring live "Euro O" complaint). Unlike the rest of speakDrkallaText this is
 * SAFE to apply to streamed MODEL frames too — the model still occasionally emits
 * "7,60 Euro" despite the prompt rule, and those frames otherwise bypass all
 * normalization on their way to the wire. It is purely local (operates within a
 * single price token), so applying it per streamed chunk yields the same result
 * as applying it to the whole text — provided a price is never split across a
 * flush boundary (the transport guarantees that).
 *   "12,00 Euro" / "12,00 €" -> "12 Euro"
 *   "7,60 Euro" / "7.60 EUR" -> "7 Euro sechzig"
 *   "9 €"                    -> "9 Euro"
 */
export function speakDrkallaPriceText(text: string): string {
  return text
    // Decimal price WITH its currency word — replace the whole token so there is
    // never a leftover/double "Euro" ("7 Euro sechzig", not "7 Euro sechzig Euro").
    // The currency terminator is a negative-letter lookahead (NOT \b — "€" is a
    // non-word char, so "\b" after it never matches "10,00 €"); this still rejects
    // "Europa"/"Euros" while accepting "€", "EUR", "Euro" and "Euro.".
    // Accept ONE OR TWO cent digits: "7,5 Euro" is 7 Euro 50 (a single decimal
    // digit is TENTHS), so pad it ×10 — otherwise the cent-speller missed it and
    // "7,5 Euro" reached TTS digit-by-digit (review finding 2026-06-30).
    .replace(/(\d{1,4})[.,](\d{1,2})\s*(?:€|EUR|Euro)(?![A-Za-zÄÖÜäöüß])/gi, (_m, euro: string, cents: string) => {
      const c = cents.length === 1 ? Number(cents) * 10 : Number(cents);
      return c === 0 ? `${euro} Euro` : `${euro} Euro ${spokenCents(c)}`;
    })
    .replace(/(\d{1,4})\s*€/g, '$1 Euro')
    .replace(/€/g, ' Euro')
    // A bare "EUR" abbreviation (e.g. an integer "9 EUR") would be spelled out
    // letter-by-letter by the voice — say the word instead.
    .replace(/\bEUR\b/g, 'Euro')
    // Last-resort net: a decimal in the German MONEY format (comma + exactly two
    // digits) with NO currency word. The model sometimes drops "Euro" ("das macht
    // 24,50"), which the voice reads "...fünf null" — the recurring "Euro O". Spell
    // the cents / drop ",00". Excludes measurement & percent units ("1,50 m",
    // "3,50 %") so only prices are touched; we do NOT invent "Euro" (unit unknown),
    // "24 fünfzig" reads as a price colloquially.
    .replace(
      /\b(\d{1,4}),(\d{2})\b(?!\s*(?:€|EUR|Euro|ml|milliliter|liter|gramm|kg|prozent|%|cm|mm|meter|st(?:ü|ue)ck|stk|l\b|g\b|m\b))/gi,
      (_m, euro: string, cents: string) => {
        const c = Number(cents);
        return c === 0 ? euro : `${euro} ${spokenCents(c)}`;
      },
    );
}

export function speakDrkallaText(text: string): string {
  const normalized = text
    // Domain/email FIRST, so the brand rule never double-processes the handle.
    // The website is written "drkalla.com" but must be SPOKEN as the brand:
    // "Doktor Kalla punkt com" (live complaint 2026-06-27 — it was read as the
    // letters "de-er-kalla").
    .replace(/\bdrkalla\.com\b/gi, 'Doktor Kalla punkt com')
    // Texts that already carry the SPOKEN handle ("… auf drkalla punkt com")
    // get the same brand treatment — the voice read the bare handle as
    // "Der Kalla" (owner complaint live 2026-07-04).
    .replace(/\bdrkalla\s+punkt\s+com\b/gi, 'Doktor Kalla punkt com')
    .replace(/\s*@\s*/g, ' at ')
    // Brand name in a sentence -> spoken name. Require the period or a space
    // ("Dr.Kalla" / "Dr. Kalla") so a bare lowercase handle is left untouched.
    .replace(/\bDr\.\s?Kalla\b/g, 'Doktor Kalla')
    .replace(/\bDr\s+Kalla\b/g, 'Doktor Kalla')
    .replace(/\bDr\.\s?(?=[A-ZÄÖÜ])/g, 'Doktor ')
    // Symbols → spoken words. A slash between words made the voice SPELL the
    // whole token (live 2026-07-04: the category "Entwickler/Oxidant-Auswahl"
    // was read letter by letter).
    .replace(/\s*&\s*/g, ' und ')
    .replace(/(\p{L})\s*\/\s*(\p{L})/gu, '$1 und $2')
    .replace(/(\d)\s*%/g, '$1 Prozent')
    // Common German abbreviations the voice would otherwise spell or mangle.
    .replace(/\bz\.\s?B\.\s?/gi, 'zum Beispiel ')
    .replace(/\bu\.\s?a\.\s?/gi, 'unter anderem ')
    .replace(/\bbzw\.\s?/gi, 'beziehungsweise ')
    .replace(/\b(?:usw|etc)\.\s?/gi, 'und so weiter ')
    .replace(/\bca\.\s?/gi, 'circa ')
    .replace(/\bNr\.\s?/gi, 'Nummer ')
    .replace(/\bStr\.\s?/g, 'Straße ');
  // Prices LAST so the cent-speller sees clean "X,YZ Euro" tokens. Cents are
  // spelled out ("7 Euro sechzig") — reading "7,60" digit-by-digit produced the
  // live "Euro O" complaint (2026-06-27 .. 2026-06-30).
  return speakDrkallaPriceText(normalized)
    // Tidy whitespace and a stray space before sentence punctuation.
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
