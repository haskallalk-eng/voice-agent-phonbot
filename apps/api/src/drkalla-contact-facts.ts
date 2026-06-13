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

export type DrkallaContactIntent = 'address' | 'hours' | 'email' | 'anfahrt' | 'profi' | null;

const ADDRESS_RE = /\b(?:adresse|anschrift|wo (?:seid|sind|ist|liegt|findet)|wo bei euch|standort|laden|gesch[äa]ft|filiale|vorbeikommen|besuchen|vorbei(?:schauen|kommen))\b/i;
// Capital umlauts listed explicitly because the `i` flag does not case-fold
// ö/Ö without the `u` flag. "auf" is matched only in clear hours phrasings
// ("habt ihr ... auf", "heute/jetzt ... auf") to avoid "ich lege auf".
const HOURS_RE = /[öÖo]ffnungszeit|ge[öÖo]ffnet|wann (?:habt|haben|macht|hat)|wie lange (?:habt|haben)|uhrzeit|wann (?:zu|geschlossen)|geschlossen|feiertag|habt ihr[^.?!]*\bauf\b|\b(?:heute|morgen|jetzt|noch|schon|gerade)\b[^.?!]*\bauf\b/i;
const EMAIL_RE = /\b(?:e-?mail|email|mail(?:adresse)?|anschreiben|schreiben an)\b/i;
const ANFAHRT_RE = /\b(?:anfahrt|wie komme ich|welche (?:bahn|linie|u-?bahn|s-?bahn)|[öo]ffentliche|parken|parkplatz|verbindung)\b/i;
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
export function buildDrkallaContactDirective(intent: DrkallaContactIntent): string | null {
  switch (intent) {
    case 'address':
      return `Kontakt-Fakt (verbatim nennen, nicht erfinden): Adresse ${DRKALLA_CONTACT_FACTS.addressSpoken}.`;
    case 'hours':
      return `Kontakt-Fakt (verbatim nennen, nicht erfinden): Öffnungszeiten ${DRKALLA_CONTACT_FACTS.hoursSpoken}.`;
    case 'email':
      return `Kontakt-Fakt (verbatim nennen, nicht erfinden): E-Mail ${DRKALLA_CONTACT_FACTS.emailSpoken}.`;
    case 'anfahrt':
      return `Kontakt-Fakt (verbatim nennen, nicht erfinden): Anfahrt ${DRKALLA_CONTACT_FACTS.anfahrtSpoken}.`;
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
export function buildDrkallaContactAnswer(intent: DrkallaContactIntent): string | null {
  switch (intent) {
    case 'address':
      return `Unsere Adresse ist ${DRKALLA_CONTACT_FACTS.addressSpoken}. Kann ich Ihnen sonst noch helfen?`;
    case 'hours':
      return `Wir haben ${DRKALLA_CONTACT_FACTS.hoursSpoken} geöffnet. Kann ich Ihnen sonst noch helfen?`;
    case 'email':
      return `Sie erreichen uns per E-Mail unter ${DRKALLA_CONTACT_FACTS.emailSpoken}. Kann ich Ihnen sonst noch helfen?`;
    case 'anfahrt':
      return `Wir sind in ${DRKALLA_CONTACT_FACTS.anfahrtSpoken}. Möchten Sie auch die genaue Adresse?`;
    case 'profi':
      return 'Profi-Preise können Friseure und Gewerbetreibende über den Profi-Zugang anfragen; für die Freischaltung ist eventuell ein Gewerbe- oder Steuernachweis nötig. Soll ich Ihnen den Link zum Profi-Zugang per SMS schicken?';
    default:
      return null;
  }
}
