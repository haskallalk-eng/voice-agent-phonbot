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
  emailSpoken: 'kontakt at drkalla punkt com',
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
const HOURS_RE = /(?:oe|ö|Ö|o)ffnungszeit|ge(?:oe|ö|Ö|o)ffnet|wann (?:habt|haben|macht|hat)|wie lange (?:habt|haben)|uhrzeit|wann (?:zu|geschlossen)|geschlossen|feiertag|habt ihr[^.?!]*\bauf\b|\b(?:heute|morgen|jetzt|noch|schon|gerade)\b[^.?!]*\bauf\b/i;
const EMAIL_RE = /\b(?:e-?mail|email|mail(?:adresse)?|anschreiben|schreiben an)\b/i;
const ANFAHRT_RE = /\b(?:anfahrt|wie komme ich|welche (?:bahn|linie|u-?bahn|s-?bahn)|(?:oe|ö|Ö|o)ffentliche|parken|parkplatz|verbindung)\b/i;
const PROFI_RE = /\bprofi[\s-]?(?:zugang|preis|preise|preisen|konto|login|registr|freischalt|konditionen)|friseur[\s-]?(?:preis|konto|registr)|gewerbe(?:konto|preis|kunde)/i;

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
  switch (intent) {
    case 'address':
      return `Kontakt-Fakt (verbatim nennen, nicht erfinden): Adresse ${facts.addressSpoken}.`;
    case 'hours':
      return `Kontakt-Fakt (verbatim nennen, nicht erfinden): Öffnungszeiten ${facts.hoursSpoken}.`;
    case 'email':
      return `Kontakt-Fakt (verbatim nennen, nicht erfinden): E-Mail ${facts.emailSpoken}.`;
    case 'anfahrt':
      return `Kontakt-Fakt (verbatim nennen, nicht erfinden): Anfahrt ${facts.anfahrtSpoken}.`;
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
