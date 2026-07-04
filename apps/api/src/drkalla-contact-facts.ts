import { DRKALLA_PROFI_ACCESS_URL } from './drkalla-rag-agent.js';

/**
 * Governed, canonical DrKalla contact facts for the custom runtime.
 * Single source of truth, mirroring the public-website values used by the
 * Retell-KB path (drkalla-rag-agent.ts). The custom runtime previously fed
 * the model NO contact facts, so it could invent address/hours/email. These
 * values are EVIDENCE: spoken verbatim, never from memory, never guessed.
 */
export const DRKALLA_CONTACT_FACTS = {
  addressSpoken: 'Silbersteinstraße 83, 12051 Berlin',
  hoursSpoken: 'Montag bis Freitag von 10 bis 18 Uhr',
  // Spoken form: the TTS voice mangles the bare handle "drkalla" ("Der Kalla",
  // owner complaint live 2026-07-04); the website is already consistently
  // spoken "Doktor Kalla punkt com", the e-mail follows the same convention.
  emailSpoken: 'kontakt at Doktor Kalla punkt com',
  anfahrtSpoken: 'Berlin-Neukölln nahe S- und U-Bahn Hermannstraße; tagesaktuelle Verbindung bitte mit BVG oder Maps prüfen',
  profiUrl: DRKALLA_PROFI_ACCESS_URL,
} as const;

export type DrkallaContactFacts = {
  addressSpoken: string;
  hoursSpoken: string;
  emailSpoken: string;
  anfahrtSpoken: string;
  profiUrl: string;
};

// The owner-editable subset (everything except the system Profi link). The
// platform (dr-kalla-ultimate-app) publishes these so the owner can correct
// hours/address/email without an agent redeploy.
export type DrkallaContactOverrides = Partial<
  Pick<DrkallaContactFacts, 'addressSpoken' | 'hoursSpoken' | 'emailSpoken' | 'anfahrtSpoken'>
>;

/**
 * Merge owner overrides over the baked canonical facts. A field is overridden
 * ONLY when it is a non-empty string — an empty/missing override can never blank
 * out a governed fact, so the agent always has a real value to speak. profiUrl
 * is system-owned and never overridable. Returns the full facts object.
 */
export function mergeDrkallaContactFacts(overrides?: DrkallaContactOverrides | null): DrkallaContactFacts {
  const pick = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return {
    addressSpoken: pick(overrides?.addressSpoken, DRKALLA_CONTACT_FACTS.addressSpoken),
    hoursSpoken: pick(overrides?.hoursSpoken, DRKALLA_CONTACT_FACTS.hoursSpoken),
    emailSpoken: pick(overrides?.emailSpoken, DRKALLA_CONTACT_FACTS.emailSpoken),
    anfahrtSpoken: pick(overrides?.anfahrtSpoken, DRKALLA_CONTACT_FACTS.anfahrtSpoken),
    profiUrl: DRKALLA_CONTACT_FACTS.profiUrl,
  };
}

export type DrkallaContactIntent = 'address' | 'hours' | 'email' | 'anfahrt' | 'profi' | null;

const ADDRESS_RE = /\b(?:adresse|anschrift|wo (?:seid|sind|ist|liegt|findet)|wo bei euch|standort|laden|gesch(?:ae|ä|Ä|a)ft|filiale|vorbeikommen|besuchen|vorbei(?:schauen|kommen))\b/i;
// Capital umlauts listed explicitly because the `i` flag does not case-fold
// ö/Ö without the `u` flag; the oe/ae digraphs are listed too because German
// ASR/typing often transliterates umlauts ("Oeffnungszeiten", "Geschaeft").
// "auf" is matched only in clear hours phrasings ("habt ihr ... auf",
// "heute/jetzt ... auf") to avoid "ich lege auf".
// Subordinate-clause word order is covered too ("ich möchte wissen, wann ihr
// offen habt") — live 2026-07-04 the opener used exactly that form, missed the
// deterministic path AND the fact injection, and the model claimed it had no
// hours. "offen" needs a haben/sein verb in the same clause so "offen gesagt"
// or "ich bin offen für alles" never match.
const HOURS_RE = /(?:oe|ö|Ö|o)ffnungszeit|ge(?:oe|ö|Ö|o)ffnet|wann (?:habt|haben|macht|hat)|wie lange (?:habt|haben)|uhrzeit|wann (?:zu|geschlossen)|geschlossen|feiertag|habt ihr[^.?!]*\bauf\b|\b(?:heute|morgen|jetzt|noch|schon|gerade)\b[^.?!]*\bauf\b|\b(?:habt|haben|hat|seid|sind|ist)\b[^.?!]*\boffen\b|\boffen\b[^.?!]*\b(?:habt|haben|hat|seid|sind|ist)\b|\bwann\b[^.?!]*\b(?:aufmacht|zumacht|schlie(?:ß|ss)t|(?:oe|ö|Ö|o)ffnet)\b|\bwann\b[^.?!]*\b(?:macht|habt|haben|hat)\b[^.?!]*\bauf\b/i;
const EMAIL_RE = /\b(?:e-?mail|email|mail(?:adresse)?|anschreiben|schreiben an)\b/i;
const ANFAHRT_RE = /\b(?:anfahrt|wie komme ich|welche (?:bahn|linie|u-?bahn|s-?bahn)|(?:oe|ö|Ö|o)ffentliche|parken|parkplatz|verbindung)\b/i;
// Mengenrabatt/Staffelpreise: the honest answer IS the Profi-Zugang (no other
// bulk-pricing mechanism exists) — routed here so it gets the deterministic
// profi answer instead of a waffling model turn (review 2026-07-04).
const PROFI_RE = /\bprofi[\s-]?(?:zugang|preis|preise|preisen|konto|login|registr|freischalt|konditionen)|friseur[\s-]?(?:preis|konto|registr)|gewerbe(?:konto|preis|kunde)|\bmengenrabatt\w*|\bstaffelpreis\w*|\bgrossabnahme|\bgroßabnahme/i;

/**
 * Pure contact-intent detector over the latest user utterance. Profi takes
 * precedence (it is the most specific business intent), then email, address,
 * hours, anfahrt. Returns null when the turn is not a contact question.
 */
export function detectDrkallaContactIntent(text: string): DrkallaContactIntent {
  if (!text || !text.trim()) return null;
  if (PROFI_RE.test(text)) return 'profi';
  if (EMAIL_RE.test(text)) return 'email';
  if (ADDRESS_RE.test(text)) return 'address';
  if (HOURS_RE.test(text)) return 'hours';
  if (ANFAHRT_RE.test(text)) return 'anfahrt';
  return null;
}

/**
 * Compact grounded directive line for the model, listing only the fact the
 * caller asked about so the prompt stays small. Verbatim-quote instruction.
 */
export function buildDrkallaContactDirective(
  intent: DrkallaContactIntent,
  facts: DrkallaContactFacts = DRKALLA_CONTACT_FACTS,
): string | null {
  // A contact question is a topic CHANGE: the caller wants the fact, not a
  // return to the product funnel. Live 2026-07-03: the hours answer got an
  // unasked product pitch appended ("… kann ich Ihnen auch direkt noch die
  // passende Haarfarbe nennen") and the caller snapped ("ich frag grad nach
  // Öffnungszeiten"). Offer further CONTACT facts at most, never a product.
  // Kept SHORT: the canary directive budget is 800 chars, a long suffix
  // disables the whole canary turn (sim regression DIRECTIVES_OVER_BUDGET).
  const noUpsell = ' Danach KEIN Produktangebot; biete höchstens weitere Kontaktdaten an.';
  switch (intent) {
    case 'address':
      return `Kontakt-Fakt (verbatim nennen, nicht erfinden): Adresse ${facts.addressSpoken}.${noUpsell}`;
    case 'hours':
      return `Kontakt-Fakt (verbatim nennen, nicht erfinden): Öffnungszeiten ${facts.hoursSpoken}.${noUpsell}`;
    case 'email':
      return `Kontakt-Fakt (verbatim nennen, nicht erfinden): E-Mail ${facts.emailSpoken}.${noUpsell}`;
    case 'anfahrt':
      return `Kontakt-Fakt (verbatim nennen, nicht erfinden): Anfahrt ${facts.anfahrtSpoken}.${noUpsell}`;
    case 'profi':
      return 'Kontakt-Fakt: Profi-Preise nur ueber Profi-Zugang (ggf. Gewerbe-/Steuernachweis); Profi-Link per SMS anbieten, nie die URL vorlesen; keine Rabatte erfinden.';
    default:
      return null;
  }
}

/**
 * Deterministic grounded spoken answer for a contact question (Sie form),
 * used as the safe fallback when the model returns nothing. Never invents.
 */
export function buildDrkallaContactAnswer(
  intent: DrkallaContactIntent,
  facts: DrkallaContactFacts = DRKALLA_CONTACT_FACTS,
): string | null {
  switch (intent) {
    case 'address':
      return `Unsere Adresse ist ${facts.addressSpoken}. Kann ich Ihnen sonst noch helfen?`;
    case 'hours':
      return `Wir haben ${facts.hoursSpoken} geöffnet. Kann ich Ihnen sonst noch helfen?`;
    case 'email':
      return `Sie erreichen uns per E-Mail unter ${facts.emailSpoken}. Kann ich Ihnen sonst noch helfen?`;
    case 'anfahrt':
      return `Wir sind in ${facts.anfahrtSpoken}. Möchten Sie auch die genaue Adresse?`;
    case 'profi':
      return 'Profi-Preise können Friseure und Gewerbetreibende über den Profi-Zugang anfragen; für die Freischaltung ist eventuell ein Gewerbe- oder Steuernachweis nötig. Soll ich Ihnen den Link zum Profi-Zugang per SMS schicken?';
    default:
      return null;
  }
}
