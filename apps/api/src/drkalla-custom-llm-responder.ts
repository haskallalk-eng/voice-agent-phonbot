import {
  buildDrkallaCustomRuntimeCanaryTurn,
  type DrkallaCustomRuntimeCanaryConfig,
} from './drkalla-custom-runtime-canary.js';
import {
  buildDrkallaContactAnswer,
  DRKALLA_CONTACT_FACTS,
  detectDrkallaContactIntent,
  type DrkallaContactFacts,
} from './drkalla-contact-facts.js';
import type { DrkallaProductEvidenceLookup } from './drkalla-product-evidence.js';
import type { DrkallaProductCatalogSearch, DrkallaExternalBrandStock } from './drkalla-product-catalog-search.js';
import type { DrkallaKnowledgeRetriever } from './drkalla-knowledge-chunks-retriever.js';
import type { DrkallaFaqMatcher } from './drkalla-faq-match.js';
import { detectDrkallaDuForm } from './drkalla-formality-detector.js';
import { detectDrkallaUserProductType } from './drkalla-product-type-detector.js';
import { redactForPrompt } from './pii.js';
import {
  deriveDrkallaAgentSpokeEvent,
  type DrkallaAmbiguousProductNameDetector,
  type DrkallaProductNameDetector,
} from './drkalla-product-name-detector.js';
import {
  nextInaudibleRepair,
  reduceDrkallaShortTermMemory,
  type DrkallaShortTermVoiceMemory,
} from './drkalla-short-term-memory.js';
import { evaluateTurnTakingGuard } from './turn-taking-guard.js';
import type { AgentTurnRequestedEvent } from './voice-runtime-contract.js';

// Canonical first-price wording (project spec): said once per call for
// non-perfume prices, then never repeated unless the caller explicitly asks
// about Profi prices again.
export const DRKALLA_PROFI_PRICE_DISCLOSURE =
  'Das sind die Preise für normale Käufer. Spezielle Profi-Friseurpreise kann ich telefonisch nicht nennen; dafür können Sie sich über den Profi-Zugang registrieren.';
export const DRKALLA_PROFI_LINK_QUESTION =
  'Soll ich Ihnen den Produktlink oder den Link zum Profi-Zugang per SMS schicken?';

export type DrkallaCustomLlmClient = {
  complete(input: {
    system: string;
    user: string;
    maxOutputChars: number;
    /**
     * Optional barge-in signal. When it aborts (a newer caller turn arrived),
     * the model call should stop early so the serialized turn chain advances
     * immediately instead of waiting out the stale turn's budget.
     */
    signal?: AbortSignal;
  }): Promise<string>;
  /**
   * Optional streaming completion. Must call onDelta for each text chunk and
   * resolve with the full accumulated text. The responder enforces the
   * output cap across the stream.
   */
  completeStream?(input: {
    system: string;
    user: string;
    maxOutputChars: number;
    onDelta: (chunk: string) => void;
    signal?: AbortSignal;
  }): Promise<string>;
  /**
   * Optional background summarizer for the rolling conversation note. NEVER
   * called on a turn's hot path — only by the transport's off-path summary job
   * (see drkalla-conversation-summary). May use a longer timeout than complete.
   */
  summarize?(input: { system: string; user: string; signal?: AbortSignal }): Promise<string>;
};

// Spoken when the caller confirms an SMS link offer while no real SMS tool
// is wired into the custom runtime. The agent must never claim a link was
// sent before a successful tool execution.
export const DRKALLA_SMS_NOT_WIRED_TEXT =
  'Der SMS-Versand ist in diesem Testanruf noch nicht freigeschaltet. Sie finden das Produkt direkt auf drkalla punkt com. Kann ich sonst noch etwas klären?';

export type DrkallaCustomLlmResponse = {
  blocked: boolean;
  text: string;
  memory: DrkallaShortTermVoiceMemory;
  metrics: {
    extraLlmCalls: 0 | 1;
    extraKbCalls: 0;
    directiveChars: number;
  };
  blockers: string[];
  /** True when the agent should hard hang-up after speaking (clear farewell). */
  endCall?: boolean;
  /**
   * Non-blocking quality signal for observability. Only set on the model/
   * fallback path (deterministic paths are hardcoded Sie). Never alters text.
   */
  quality?: {
    duFormDetected: boolean;
    duFormConfidence: 'high' | 'medium' | 'none';
    duFormSlips: string[];
  };
};

const RAW_PROVIDER_OR_SCOPE = /\b(?:orgId|tenantId|agentId|callId|response_required|update_only|transcript_with_tool_calls|authorization|Bearer)\b/gi;

function sanitizeUserText(value: string): string {
  // Use the central purpose-specific redactor (Milestone 1C) so caller PII —
  // phone, email, address, IBAN, card, DOB — is stripped before the utterance
  // reaches the model, then strip provider/scope tokens specific to this path.
  return redactForPrompt(value)
    .replace(RAW_PROVIDER_OR_SCOPE, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

// One prior turn of the live call, supplied by the transport from Retell's
// transcript. The model otherwise only sees the current utterance, so it
// "forgot" the topic mid-call; feeding a short recent window restores context
// with NO extra LLM/KB call and no added latency (the turns are already in the
// inbound message — see extractRetellDrkallaRecentTurns).
export type DrkallaConversationTurn = { role: 'user' | 'agent'; text: string };

// Build a compact, PII-redacted recent-history block for the model's user
// message. Newest turns are kept first under the char budget; each turn is run
// through the same redactor as the current utterance. Returns '' when there is
// no usable history (then the model just gets the current utterance, as before).
function buildDrkallaHistoryBlock(history: DrkallaConversationTurn[] | undefined): string {
  if (!history || !history.length) return '';
  const kept: string[] = [];
  let budget = 1200;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (!turn) continue;
    const text = sanitizeUserText(turn.text).slice(0, 180);
    if (!text) continue;
    const line = `${turn.role === 'agent' ? 'Sie' : 'Anrufer'}: ${text}`;
    if (budget - line.length < 0) break;
    budget -= line.length;
    kept.unshift(line);
  }
  if (!kept.length) return '';
  return `Bisheriger Gespraechsverlauf (nur zur Erinnerung; nicht erneut begruessen, nicht wiederholen):\n${kept.join('\n')}`;
}

function compactSystemPrompt(
  directives: string[],
  contactFacts: DrkallaContactFacts = DRKALLA_CONTACT_FACTS,
): string {
  const staticRules = [
    'Du bist der Dr.Kalla Voice-Agent fuer Friseurbedarf.',
    // Live call 2026-06-14: the model re-greeted mid-call ("Guten Tag! Wie kann
    // ich Ihnen helfen?") on a fragmented turn. The opener is already spoken
    // deterministically — forbid any further greeting.
    'Du hast den Anrufer bereits begruesst. Begruesse NICHT erneut (kein "Hallo", "Guten Tag", "Willkommen", "Hallo, hier ist der Dr.Kalla Assistent"); antworte sofort auf das Anliegen.',
    // Register is the #1 live complaint: gpt-4.1-mini mirrors the caller and
    // slips into du. State the rule first, as a hard prohibition with the
    // exact forbidden words, so it actually sticks.
    'ANREDE (zwingend): Sprich den Anrufer ausschliesslich in der Sie-Form an — Sie, Ihnen, Ihr, Ihre. Verwende NIEMALS du, dich, dir, dein, deine, ihr (als Anrede), euch oder euer, auch wenn der Anrufer dich duzt.',
    'STIL: Antworte auf Deutsch in vollstaendigen, natuerlichen Saetzen. Niemals Stichpunkte, Aufzaehlungen, Doppelpunkt-Listen oder Telegrammstil. Fasse dich kurz, aber sprich in ganzen Saetzen.',
    `Buchstabiere Web-Adressen oder E-Mails nicht. Nenne die Website gesprochen als "Doktor Kalla punkt com" und die E-Mail als "${contactFacts.emailSpoken}" — niemals mit Punkt-Zeichen, Schraegstrich oder At-Zeichen. Erwaehne die Website nur, wenn es noetig ist, nicht in jeder Antwort.`,
    'AUSSPRACHE: Sprich den Markennamen immer als "Doktor Kalla" aus, nie als "Dr.Kalla" oder buchstabiert. Nenne Preise GENAU so, wie sie in der Evidence-/Katalog-Treffer-Zeile stehen (z. B. "12 Euro", "7 Euro sechzig") — sprich Cent als ausgeschriebenes Wort, NIEMALS als Komma-Zahl ("7,60"), als Ziffern ("7 Euro 60") oder mit "null". Verwende keine Abkuerzungen zum Vorlesen (kein "z.B.", "bzw.", "usw.", "Nr.", "Str.", "&", "%").',
    'Dr.Kalla ist ein Friseurbedarf-Shop, kein Friseursalon: keine Termine, keine Haarschnitte oder Faerbe-Dienstleistungen; verweise hoeflich auf Produkte/Salonbedarf.',
    'Nenne Adresse, Oeffnungszeiten, E-Mail, Preise oder Verfuegbarkeit nur aus der gegebenen Evidence- oder Kontakt-Fakt-Zeile. Fehlt die Angabe, erfinde nichts und verweise hoeflich auf die Website oder den Kontakt.',
    'Erklaere die Profi-Preise hoechstens einmal ausfuehrlich; wurde der Profi-Zugang schon erwaehnt, fasse dich knapp und biete nur kurz den Link an, ohne die Erklaerung zu wiederholen.',
    'Wenn der Bedarf oder die Produktart bekannt ist, NENNE konkrete Produkte aus der Katalog-Treffer-Zeile oder grenze nach Marke/Variante ein. Stelle nicht wiederholt dieselbe Kategorie-Frage; wenn der Anrufer den Bedarf schon genannt hat, gehe weiter, statt erneut zu fragen.',
    'BERATEN STATT ABLADEN: Ist der Bedarf vage oder beratungsorientiert ("etwas fuer Haarpflege", "was kann ich gegen ... machen", "fuer meine Haare", "nach der Dauerwelle"), frage zuerst KURZ nach Haartyp, Problem oder Ziel, bevor du ein konkretes Produkt empfiehlst — dumpe nicht sofort ein Produkt. Variiere deine Formulierung; nutze nicht stur denselben Satzbau ("Da kann ich Ihnen X empfehlen ...").',
    'Bei Vergleichs- oder Beratungsfragen ("was ist besser", "welches passt") vergleiche die genannten Produkte konkret und gib eine klare Empfehlung; wiederhole nicht denselben Vorschlag.',
    'Nutze diese Dialogsteuerung, aber behandle Memory nie als Faktenbeweis.',
    'LINK-VERSAND: Du kannst einen Link NICHT selbst verschicken — er geht erst raus, wenn der Anrufer auf deine Frage mit Ja antwortet. Biete einen Link DAHER IMMER als Frage an ("Soll ich Ihnen den Link zu X per SMS schicken?") und sage NIEMALS als Aussage "ich sende/schicke Ihnen den Link" oder "ich habe den Link geschickt". Frage nie nach der Telefonnummer (die SMS geht automatisch an die Anrufernummer).',
    'Bei klarer Verabschiedung verabschiede dich kurz und haenge keine neue Frage an.',
    'Wenn der Anrufer abwinkt ("nein danke", "alles gut", "passt"), biete NICHT erneut denselben Link oder dasselbe Produkt an; bestaetige kurz und frage hoechstens einmal, ob du sonst helfen kannst.',
    'Produkte aus der Memory-Zeile "discussed_products" hast du schon genannt: wiederhole dazu NICHT denselben Pitch oder dieselbe Link-Frage; nenne etwas Neues oder schliesse ab.',
  ];
  // Cap the FIXED static policy block, but ALWAYS append the per-turn grounding
  // directives (Plan/Evidence/Kontakt-Fakt/Memory) in full — they must never be
  // truncated by a static-rule addition, or the model loses its grounding.
  const dir = directives.length ? `\n${directives.join('\n')}` : '';
  return `${staticRules.join('\n').slice(0, 4200)}${dir}`;
}

// Match ANY phrasing where the agent's last question offered to SEND a
// link/SMS — a send verb together with a link/SMS target, in either order —
// so a caller's "ja" is caught by the deterministic confirm path instead of
// reaching the model (which otherwise loops or invents asking for the number).
// Covers "per SMS schicken/senden/zusenden/schreiben", "den Produktlink
// senden", "schicke Ihnen den Link", "per Nachricht zusenden", etc. Also catches
// MODEL-phrased link offers without an explicit send verb ("Möchten Sie den Link
// zu X?", "den Link erhalten") — otherwise a caller's "ja, schick" misses the
// deterministic SMS path and the model hallucinates "Ich sende Ihnen den Link"
// while no SMS actually goes out (real call 2026-06-15).
const SMS_OFFER_QUESTION = /(?:produktlink|\blink\b|per\s+sms|per\s+nachricht|\bsms\b)[^.?!]*\b(?:schick|sende|senden|zusend|zuschick|zukomm|schreib|versend)|\b(?:schick|sende|senden|zusend|zuschick|zukomm|schreib|versend)\w*[^.?!]*(?:produktlink|\blink\b|\bsms\b|nachricht)|\b(?:m(?:ö|oe)chten|wollen|soll(?:en)?|darf|h(?:ä|ae)tten)\b[^.?!]*\b(?:produktlink|\blink\b)\b|\b(?:produktlink|\blink\b)\b[^.?!]*\b(?:erhalten|bekommen|zusenden|zugeschickt|zukommen)\b/i;
// The two-option offer ("Produktlink ODER Profi-Zugang per SMS"): a bare "ja"
// here is ambiguous and must be re-asked, not silently sent as product link.
const TWO_OPTION_OFFER = /produktlink\s+oder\s+(?:den\s+link\s+(?:zum\s+)?)?profi/i;
const SHORT_AFFIRMATION = /^(?:ja|ja,?\s*(?:bitte|gerne?)|gerne?|okay?|ok|bitte|mach das|machen sie das|klar)[.! ]*$/i;
const PRODUCT_LINK_CHOICE = /\b(?:produktlink|den ersten|das erste|das produkt|zum produkt|den\s+link|schick|sende|zusend|zuschick|versend)\b/i;
const PROFI_LINK_CHOICE = /\b(?:profi[\s-]?(?:zugang|link)|den profi|zum profi|das zweite|den zweiten|der zweite|registrier)\b/i;
// An explicit decline of a pending link/SMS offer that is NOT a bare "nein"
// (those are caught by SMALLTALK_NEGATION): "passt", "alles gut", "brauche ich
// nicht", "lieber nicht", "kein Link", "reicht so". Wind down, never re-offer.
const DRKALLA_LINK_DECLINE = /\b(?:nicht\s+n(?:ö|oe)tig|brauche?\s+(?:ich\s+)?(?:das\s+|den\s+)?nicht|lieber\s+nicht|kein(?:en)?\s+link|lass(?:en\s+sie)?\s+(?:das\s+)?(?:mal\s+)?(?:gut|stecken|sein)|passt(?:\s+schon)?|alles\s+(?:gut|klar|bestens)|reicht(?:\s+so)?|sp(?:ä|ae)ter)\b/i;

export type DrkallaSendLinkKind = 'product' | 'profi' | 'category';
export type DrkallaSendLinkExecutor = (input: {
  url: string;
  label: string;
  linkKind: DrkallaSendLinkKind;
}) => Promise<{ smsSent: boolean; duplicate?: boolean }>;

function fallbackText(userText: string): string {
  if (/\bunterschied|vergleich\b/i.test(userText)) {
    return 'Ich prüfe das kurz: Meinen Sie den Unterschied zwischen den zuletzt genannten Produkten?';
  }
  if (/\blink|kauf|kaufe|bestell|sms\b/i.test(userText)) {
    return 'Ich kann Ihnen den passenden Produktlink per SMS schicken. Soll ich das machen?';
  }
  return 'Ich prüfe das kurz. Sagen Sie mir bitte, welches Produkt oder welche Produktart Sie meinen.';
}

type DrkallaFallbackResult = {
  text: string;
  product?: { spokenName: string; productId?: string; productKind?: string | null };
};

function fallbackTextWithMemory(input: {
  userText: string;
  memory: DrkallaShortTermVoiceMemory;
  evidenceLookup?: DrkallaProductEvidenceLookup;
  contactFacts?: DrkallaContactFacts;
}): DrkallaFallbackResult {
  const userText = input.userText;
  const lastProduct = input.memory.lastMentionedProduct;
  // Grounded contact answer takes precedence: never let the fallback dodge a
  // contact question with a generic discovery prompt, and never invent.
  const contactIntent = detectDrkallaContactIntent(userText);
  if (contactIntent) {
    const contactAnswer = buildDrkallaContactAnswer(contactIntent, input.contactFacts);
    if (contactAnswer) return { text: contactAnswer };
  }
  if (/\bunterschied|vergleich\b/i.test(userText)) {
    const recent = input.memory.recentProducts.slice(-2);
    if (recent.length >= 2) {
      return {
        text: `Ich pruefe den Unterschied zwischen ${recent[0]?.spokenName} und ${recent[1]?.spokenName}. Geht es Ihnen um Anwendung oder Kaufentscheidung?`,
      };
    }
    return { text: fallbackText(userText) };
  }
  if (/\b(?:preis|kostet|kosten|teuer|euro)\b/i.test(userText) && lastProduct) {
    // Catalog evidence lets the fallback answer the actual price truthfully
    // instead of dodging to a link offer (price facts come from the catalog
    // snapshot, never from memory).
    const evidence = input.evidenceLookup?.byKeyHash(lastProduct.productKeyHash) ?? null;
    const priceSentence = evidence?.priceText
      ? `${lastProduct.spokenName} kostet laut Shop-Datenstand ${evidence.priceText}. `
      : '';
    if (input.memory.profiPriceDisclosureGiven && !/\bprofi/i.test(userText)) {
      return {
        text: `${priceSentence}Soll ich Ihnen den Produktlink zu ${lastProduct.spokenName} per SMS schicken?`,
        product: lastProduct,
      };
    }
    return {
      text: `${priceSentence}${DRKALLA_PROFI_PRICE_DISCLOSURE} ${DRKALLA_PROFI_LINK_QUESTION}`,
      product: lastProduct,
    };
  }
  if (/\blink|kauf|kaufe|bestell|sms\b/i.test(userText) && lastProduct) {
    return {
      text: `Soll ich Ihnen den Produktlink zu ${lastProduct.spokenName} per SMS schicken?`,
      product: lastProduct,
    };
  }
  if (input.memory.activeProductType) {
    return {
      text: `Bei ${input.memory.activeProductType.label} kann ich Ihnen eine kurze Auswahl nach Marken, Varianten oder Nuancen nennen. Soll ich mit Marken anfangen?`,
    };
  }
  return { text: fallbackText(userText) };
}

// Explicit request to see the brand/product selection for the active type
// ("welche Marken habt ihr?", "zeig mir die Auswahl", "was habt ihr da?").
const DRKALLA_TYPE_LIST_REQUEST = /(?:marken|auswahl|welche habt|was habt|zeig|liste)/i;

/**
 * Deterministic, grounded brand/product list for the "Soll ich mit Marken
 * anfangen?" -> "Ja" funnel gap. The agent offers to list brands/products for
 * an active product type; on a bare "Ja" the open-ended catalog search runs on
 * "ja" and finds nothing, so the model loops on the same offer (live call).
 * When an active product type is known and the caller either bare-affirms or
 * explicitly asks for the selection, name up to three REAL catalog products
 * for that type in full Sie sentences. Returns null when this is not that
 * situation (then the normal model path handles it). Grounded: only real
 * catalog names are spoken, never invented.
 */
function tryDeterministicTypeListReply(input: {
  userText: string;
  memory: DrkallaShortTermVoiceMemory;
  catalogSearch?: DrkallaProductCatalogSearch;
}): string | null {
  const activeType = input.memory.activeProductType;
  if (!activeType) return null;
  const text = input.userText;
  // An attribute question ("was habt ihr für FARBEN / welche Nuancen?") needs the
  // model to list the options or ask which one — a product-LINE list does not
  // answer it (live 2026-07-01: "was für Farben" got a product list, not colors).
  if (DRKALLA_ATTRIBUTE_QUESTION.test(text)) return null;
  const wantsList = SHORT_AFFIRMATION.test(text) || DRKALLA_TYPE_LIST_REQUEST.test(text);
  if (!wantsList) return null;
  const hits = (input.catalogSearch?.(activeType.label, 4) ?? []).slice(0, 3);
  if (!hits.length) return null;
  const names = hits.map((p, index) =>
    index === 0 && p.priceText ? `${p.shortName} (${p.priceText})` : p.shortName,
  );
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
  return `Bei ${activeType.label} haben wir zum Beispiel ${list}. Welches davon interessiert Sie?`;
}

// Comparison / advice / usage / why turns need real reasoning — leave those to
// the model instead of answering with a canned product list. Real call
// 2026-06-15: "Was ist besser, X oder Y?" / "welches für blondes Haar?" hit the
// deterministic recommender, which repeated the same template and never compared.
const NEED_VETO = /\b(?:unterschied|vergleich\w*|verglichen|besser|schlechter|empfehlenswert|ratsam|empfiehl\w*|wie\s+(?:wende|benutz|verwend|trag|oft|lange|viel)|was\s+(?:kann|soll|muss)\s+ich|was\s+brauch\w*|was\s+ben(?:ö|oe)tig\w*|geeignet|haartyp\w*|warum|wieso|weshalb|anwend|inhaltsstoff|vertr[äa]glich|allergie|wof[üu]r|wozu)\b/i;

// A "how do I use/apply this?" turn. NEED_VETO's stems use a trailing \b, so an
// inflected "wie trage ich ... auf" slips past it (trag\b != "trage") and the
// recommender wrongly pitched a product instead of explaining application (live
// smoke 2026-06-16). This catches the inflected how-to forms so a usage question
// is answered from the knowledge layer, not pitched as a product.
const DRKALLA_USAGE_HOWTO = /\bwie\s+(?:wende|benutz|verwend|trag|nutz|nehm|anwend|auftrag)\w*|\banwendung\b|\bauftrag\w*\b/i;

// A SERVICE/after-sales question (repair, warranty, return, exchange, spare parts,
// cancellation). These read as a SERVICE intent, not a product need — but stems
// like "reparatur" also live in DRKALLA_CARE_INTENT, so without this veto a
// "kann ich den defekten Föhn zur Reparatur einschicken?" gets hijacked by the
// catalog/care path and pitches a product. Vetoing routes it to the FAQ/knowledge
// layer instead. None of these stems appear in a buy intent ("Föhn kaufen" has no
// service token → still hits the catalog).
const DRKALLA_SERVICE_INTENT = /\b(?:reparatur|reparier\w*|defekt\w*|kaputt\w*|garantie|gew(?:ä|ae)hrleistung|einschick\w*|einsend\w*|zur(?:ü|ue)cksend\w*|r(?:ü|ue)cksend\w*|retour\w*|umtausch\w*|reklamat\w*|reklamier\w*|storno|stornier\w*|nachbestell\w*|ersatzteil\w*|widerruf\w*)\b/i;

// A store-VISIT / browse-in-person / pickup question is NOT a product search. We
// are a reiner Versandhandel, so the honest answer ("kein Ladenverkauf, nur
// Versand") comes from the model/contact layer — never the recommender. Without
// this veto the active-category fallback fused the remembered type onto the
// question and dumped a random product (live 2026-06-30: caller asked "kann man
// bei euch vorbeischauen und Sachen gucken?" and the agent pitched a Färbepinsel).
// NOTE: bare browse verbs (ansehen/anschauen/angucken/besichtigen) were removed —
// they are ordinary PRODUCT verbs ("ich möchte mir ein Shampoo ansehen") and
// over-vetoing them sent a legit product request to the model instead of the
// grounded recommender (review 2026-06-30). Only unambiguous store-visit / pickup
// tokens remain; the disaster turn ("...vorbeischauen und angucken?") is still
// caught by "vorbeischau*".
const DRKALLA_STORE_VISIT_INTENT = /\b(?:vorbei(?:schau|komm|kommen|geschaut)\w*|vorbeizuschauen|reinschau\w*|vor\s?ort|abhol\w*|abzuhol\w*|filiale|ladengesch(?:ä|ae)ft|ladenlokal|showroom|ausstellungsraum|pers(?:ö|oe)nlich\s+(?:vorbei|abhol|komm|da))\b/i;

// An ASSORTMENT / attribute question ("was habt ihr für FARBEN?", "welche NUANCEN
// gibt es?", "welche Sorten/Varianten?") — the caller wants the RANGE of an
// attribute, NOT a single product pitch. Route to the grounded model, which can
// list the options or ask which one. Live 2026-07-01: "Was habt ihr denn für
// Farben?" got the robotic template ("Da kann ich Ihnen Haarfarbe Ammoniakfrei
// empfehlen. Das kostet 4 Euro fünfzig …") instead of an answer, twice in a row.
// Scoped to ATTRIBUTE nouns (farbe/nuance/ton/sorte/variante/…) so a genuine
// product-CATEGORY question ("was habt ihr für Dauerwelle/Shampoo?") still names a
// product deterministically.
const DRKALLA_ATTRIBUTE_QUESTION = /\b(?:f(?:ü|ue)r|welche[rsmn]?)\s+(?:farbe|farben|farbt(?:o|ö|oe)ne?|nuance|nuancen|t(?:o|ö|oe)ne?|t(?:o|ö|oe)nung(?:en)?|schattierung(?:en)?|sorte|sorten|variante|varianten|ausf(?:ü|ue)hrung(?:en)?|gr(?:ö|oe)(?:ß|ss)e[n]?|d(?:ü|ue)fte?|geruch|ger(?:ü|ue)che)\b/i;

// An explicit buy/continuation signal. The active-category fallback (which fuses
// the remembered category onto a turn that alone has no category token) may only
// fire for a SHORT brand/nuance turn ("von Wella", caught by the <=4-word gate)
// or one of these GENUINE buy verbs — never for a long off-topic sentence. We
// deliberately EXCLUDE ambient fillers ("noch", "von", "gern", "weiter",
// "ander"): they appear in ordinary off-topic chatter ("ich überlege noch …",
// "das erinnert mich an … von früher") and let it hijack a remembered category
// into a non-sequitur pitch (review 2026-06-30). Brand-only turns are short, so
// the word-count gate still reaches them without these fillers.
const DRKALLA_BUY_CONTINUATION = /\b(?:kauf\w*|m(?:ö|oe)cht\w*|woll\w*|will\b|h(?:ä|ae)tt\w*|brauch\w*|such\w*|nehm\w*|zeig\w*|bestell\w*)\b/i;

// A generic hair-type descriptor ("trockenes Haar", "feines & coloriertes Haar")
// is a NEED, not a specific product line — it must never drive a variant
// clarification. Matches a hair-condition adjective somewhere before "Haar".
const DRKALLA_HAIR_DESCRIPTOR = /\b(?:trocken|fein|lockig|kraus|gef[äa]rbt|coloriert|blond|grau|dunkl|hell|strapazier|gesund|normal|fettig|empfindlich|gereizt|spr(?:ö|oe)d|br(?:ü|ue)chig|gesch(?:ä|ae)digt|d(?:ü|ue)nn|krause)\w*\b[^.?!]*\bhaar/i;

// "Was ist die günstigste/billigste …?" AND price objections ("das ist mir zu
// teuer", "haben Sie was Günstigeres", "geht das günstiger") — rank the category
// by price ascending so the agent can NEGOTIATE: it names a cheaper alternative
// instead of repeating the same product (caller: "er kann nicht verhandeln").
const DRKALLA_CHEAP_INTENT = /\b(?:g[üu]nstig\w*|billig\w*|preiswert\w*|preisg[üu]nstig\w*|am\s+g[üu]nstigsten|am\s+billigsten|zu\s+teuer|zu\s+viel|zu\s+hoch|nicht\s+so\s+teuer)\b/i;

// The agent's own variant-clarification question ("… mehrere Ausführungen.
// Welche … Ausführung meinen Sie?"). If it was the last thing the agent asked,
// the caller's reply must REACH a product, not trigger the same question again
// (anti-loop: real call 2026-06-15 asked "welche Nuance?" seven times).
const VARIANT_CLARIFY_MARKER = /ausf(?:ü|ue)hrung/i;

// The catalog "Haarpflege" productType is a junk catch-all that mixes real care
// products with Blondierung/Entwickler CHEMICALS (real call 2026-06-15: "lieber
// eine Pflege" -> Blondierungspulver Blau). A care/cleanse need must never
// surface a bleach/developer; drop those titles for a care intent unless the
// caller actually wants color/bleach. Title-based because the productType field
// is unreliable (bleach is mis-typed "Haarpflege" in the Shopify data).
const DRKALLA_CARE_INTENT = /\b(?:pflege|haarpflege|maske|kur|conditioner|sp(?:ü|ue)lung|leave[-\s]?in|serum|repair|reparatur|feuchtigkeit|n(?:ä|ae)hrend\w*|shampoo)\b/i;
const DRKALLA_COLOR_BLEACH_INTENT = /\b(?:blondier\w*|aufhell\w*|haarfarbe|f(?:ä|ae)rb\w*|\bfarbe\b|t(?:ö|oe)nung|color|entwickler|oxidant)\b/i;
const DRKALLA_CHEMICAL_TITLE = /\b(?:blondier\w*|aufhellung|entwickler|oxidant|wasserstoffperoxid|peroxid)\b/i;

function dropChemicalForCareIntent<T extends { spokenName?: string; shortName?: string }>(
  hits: T[],
  userText: string,
  activeTypeLabel: string | null,
): T[] {
  const careIntent = DRKALLA_CARE_INTENT.test(userText)
    || (activeTypeLabel ? DRKALLA_CARE_INTENT.test(activeTypeLabel) : false);
  if (!careIntent || DRKALLA_COLOR_BLEACH_INTENT.test(userText)) return hits;
  return hits.filter(
    (h) => !DRKALLA_CHEMICAL_TITLE.test(h.spokenName ?? '') && !DRKALLA_CHEMICAL_TITLE.test(h.shortName ?? ''),
  );
}

/**
 * Deterministic product discovery for a clear category need. On the real call
 * 2026-06-13 the model looped on clarifying questions and named long,
 * ungroundable titles, so nothing could be sent by SMS or priced. When the
 * caller expresses a need that hits a real catalog CATEGORY (productType/tag)
 * and has NOT named a specific product, recommend the top SHORT real product,
 * offer up to two alternatives, and — only if it has a sendable link — offer to
 * SMS it. Returns the top product so the caller's "ja" can confirm an SMS and a
 * follow-up price is grounded. Grounded: only real catalog names; never invents.
 */
function tryDeterministicNeedReply(input: {
  userText: string;
  memory: DrkallaShortTermVoiceMemory;
  catalogSearch?: DrkallaProductCatalogSearch;
  evidenceLookup?: DrkallaProductEvidenceLookup;
  allowActiveTypeFallback?: boolean;
}): DrkallaFallbackResult | null {
  const text = input.userText;
  // A how-to/usage question ("wie trage ich ... auf"), a service/after-sales
  // matter, a store-visit/browse question, or a contact lookup must NOT be
  // answered with a product pitch — they fall through to the knowledge/contact
  // layer + model, which answer in context and vary their phrasing.
  if (
    NEED_VETO.test(text)
    || DRKALLA_USAGE_HOWTO.test(text)
    || DRKALLA_SERVICE_INTENT.test(text)
    || DRKALLA_STORE_VISIT_INTENT.test(text)
    || DRKALLA_ATTRIBUTE_QUESTION.test(text)
    || detectDrkallaContactIntent(text)
  ) return null;
  // A plain price question about the active product ("was kostet das?") belongs
  // to the deterministic price path, which answers it from the catalog — not a
  // fresh recommendation that pitches a DIFFERENT product (real call 2026-06-15).
  // Cheap-intent ("günstigste", "zu teuer") stays here for the negotiation sort.
  if (
    DRKALLA_PRICE_INTENT.test(text)
    && !DRKALLA_CHEAP_INTENT.test(text)
    && input.memory.lastMentionedProduct
  ) return null;
  // Require a productType match (a clear product CATEGORY), not a tag/title hit,
  // so this names products for "ich suche ein Shampoo" but leaves a specific
  // ambiguous product line ("Koleston Perfect") to the variant clarification.
  let strong = (input.catalogSearch?.(text, 8) ?? []).filter((h) => h.typeHit);
  // REACHABILITY: the caller already named a category earlier (activeProductType)
  // but this turn alone has no category token — a brand only ("von Wella"), bare
  // intent ("ich will ein Produkt") or garbled ASR ("Bällehaarfarbe"). Combine
  // the remembered category WITH this turn so a brand/nuance still narrows it and
  // we reliably reach products instead of looping (real call 2026-06-15). Skipped
  // for a real ambiguous product line so the variant clarification still wins.
  // (a bare "Ja" / "welche Marken" is owned by the brand-list path, not here.)
  if (
    !strong.length
    && input.allowActiveTypeFallback
    && input.memory.activeProductType
    && !SHORT_AFFIRMATION.test(text)
    && !DRKALLA_TYPE_LIST_REQUEST.test(text)
    // Only fall back for a genuine product continuation: a SHORT brand/nuance
    // turn ("von Wella", garbled ASR) or an explicit buy token — never a question
    // or a long off-topic sentence that merely follows a product turn. This stops
    // the recommender from dumping a remembered-category product onto an unrelated
    // question (live 2026-06-30).
    && !text.includes('?')
    && (text.trim().split(/\s+/).filter(Boolean).length <= 4 || DRKALLA_BUY_CONTINUATION.test(text))
  ) {
    const combined = `${input.memory.activeProductType.label} ${text}`;
    strong.push(...(input.catalogSearch?.(combined, 8) ?? []).filter((h) => h.typeHit));
  }
  // A care/cleanse need must never surface a Blondierung/Entwickler chemical from
  // the junk "Haarpflege" type (real call 2026-06-15).
  strong = dropChemicalForCareIntent(strong, text, input.memory.activeProductType?.label ?? null);
  // "günstigste/billigste" -> rank the category by price so we name the cheapest.
  if (DRKALLA_CHEAP_INTENT.test(text)) {
    strong.sort((a, b) => (a.priceValue ?? Number.POSITIVE_INFINITY) - (b.priceValue ?? Number.POSITIVE_INFINITY));
  }
  const top = strong[0];
  if (!top) return null;
  // Anti-broken-record: never re-pitch the SAME product we just recommended.
  // A follow-up about it ("und von L'Oréal?", "haben Sie noch andere?") must vary
  // via the model, not repeat the identical "Da kann ich Ihnen X empfehlen … Soll
  // ich den Link schicken?" template (real call 2026-06-15: the agent looped the
  // same line and the caller said "immer wieder das Gleiche, was ist mit dir los?").
  // Check lastAgentQuestion (the SMS offer naming the product), NOT just
  // lastMentionedProduct — a re-mention of the same category clears the latter via
  // the switched-type reset, which would otherwise let the loop through.
  const justAsked = input.memory.lastAgentQuestion ?? '';
  if (
    top.shortName
    && (top.shortName === input.memory.lastMentionedProduct?.spokenName || justAsked.includes(top.shortName))
  ) return null;
  const evidence = input.evidenceLookup?.byId(top.productId) ?? null;
  const alts = strong.slice(1, 3).map((h) => h.shortName).filter((n) => n && n !== top.shortName);
  let reply = `Da kann ich Ihnen ${top.shortName} empfehlen.`;
  // Gender-neutral "Das kostet" (not "Es kostet" — the product may be feminine,
  // e.g. "die Haarmaske"). Range priceText already reads "von X bis Y".
  if (top.priceText) reply += ` Das kostet ${top.priceText}.`;
  if (alts.length) {
    reply += alts.length === 1
      ? ` Alternativ haben wir ${alts[0]}.`
      : ` Alternativ haben wir ${alts[0]} und ${alts[1]}.`;
  }
  // Offer the SMS link only when a sendable URL exists, so we never promise a
  // link we cannot deliver (the old fallback claimed SMS, then it failed). And
  // ANTI-LINK-SPAM: if the agent's last question already offered a link/SMS, do
  // not pile on yet another link offer (live 2026-06-30: caller snapped "wie oft
  // fragst du denn nach Link?"). Offer more info instead; they can still ask.
  const justOfferedLink = /\b(?:link|sms)\b/i.test(input.memory.lastAgentQuestion ?? '');
  reply += evidence?.url && !justOfferedLink
    ? ` Soll ich Ihnen den Link zu ${top.shortName} per SMS schicken?`
    : ` Möchten Sie zu ${top.shortName} mehr wissen?`;
  return {
    text: reply,
    product: { spokenName: top.shortName, productId: top.productId, productKind: top.productType },
  };
}

// LATENCY fast-path matchers for low-content caller turns. Anchored to the
// START of the (sanitized) utterance so they only fire on a turn that is
// essentially nothing but the acknowledgement — never on a real question that
// happens to begin with "ok" or "danke".
// Pure thanks: "danke", "vielen Dank", "dankeschön", "merci".
const SMALLTALK_THANKS = /^(?:vielen\s+)?(?:danke|dankesch(?:ö|oe)n|merci)/i;
// Bare acknowledgement that fills the whole turn ("okay.", "alles klar", "passt").
const SMALLTALK_ACK = /^(?:ok(?:ay)?|alles\s+(?:klar|gut|bestens|in\s+ordnung)|super|gut|verstanden|in ordnung|passt(?:\s+schon)?)[.! ]*$/i;
// Bare negation that fills the whole turn, optionally with an ack tail
// ("nein", "nö", "nee", "nee alles gut", "nein danke") — NOT a farewell. Live
// call 2026-06-14: "Nee, alles gut" reached the model, which re-offered the link.
const SMALLTALK_NEGATION = /^(?:nein|n(?:ö|oe)|nee)(?:[,.\s]+(?:danke|alles\s+(?:gut|klar|bestens|in\s+ordnung)|passt(?:\s+schon)?|gut|bestens))*[.! ]*$/i;
// Any product/price/contact signal in the turn vetoes the smalltalk path so it
// can never swallow a real request ("danke, was kostet das?" -> model/price).
const SMALLTALK_VETO = /\?|\b(?:preis|preise|kostet|kosten|teuer|euro|kauf|kaufe|bestell|link|sms|produkt|marke|marken|auswahl|adresse|öffnungszeit|oeffnungszeit|email|e-mail|profi|unterschied|vergleich|verf[üu]gbar)\b/i;

/**
 * Deterministic Sie reply for very common low-content "smalltalk" caller turns
 * (pure thanks, a bare acknowledgement, a bare non-farewell "nein"). These make
 * up a large share of live turns and currently each costs a full model round
 * trip (~95% of turns hit the model). Answering them deterministically removes
 * that latency without ever inventing facts. Returns null whenever this is NOT
 * a pure smalltalk turn, so anything with real content falls through to the
 * normal model/price/funnel paths. Guards:
 *   - vetoed if the turn carries a product/price/contact/comparison signal or a
 *     question mark (so "danke, und der Preis?" is never swallowed);
 *   - a bare "nein" is skipped while a send-link offer is pending (the existing
 *     SMS-confirm logic must own that "nein"); farewells are handled earlier.
 */
function tryDeterministicSmalltalkReply(input: {
  userText: string;
  memory: DrkallaShortTermVoiceMemory;
}): string | null {
  const text = input.userText.trim();
  if (!text) return null;
  // Never let smalltalk swallow a turn that also asks for something concrete.
  if (SMALLTALK_VETO.test(text)) return null;
  if (detectDrkallaContactIntent(text)) return null;

  if (SMALLTALK_THANKS.test(text)) {
    return 'Sehr gern! Kann ich sonst noch etwas für Sie tun?';
  }
  if (SMALLTALK_ACK.test(text)) {
    return 'Gern. Womit kann ich Ihnen weiterhelfen?';
  }
  if (SMALLTALK_NEGATION.test(text)) {
    // A "nein" answering a pending SMS/link offer means "do not send" — leave it
    // to the existing confirm logic / model, do NOT treat it as smalltalk.
    if (SMS_OFFER_QUESTION.test(input.memory.lastAgentQuestion ?? '')) return null;
    return 'Alles klar. Kann ich Ihnen sonst noch weiterhelfen?';
  }
  return null;
}

// A clear, simple price question (not a comparison, not a contact question).
const DRKALLA_PRICE_INTENT = /\b(?:was\s+kostet|wie\s*viel|wie\s*teuer|preis|preise|kostet|kosten|teuer)\b/i;
const DRKALLA_USAGE_INTENT = /\b(?:anwendung|anwenden|angewendet|verwenden|benutzen|auftragen|einwirk\w*|wie\s+(?:nimmt|nutzt|verwendet|wendet|traegt|tr[äa]gt)|wieviel|wie\s+viel\s+davon)\b/i;

/**
 * Deterministic, grounded price answer in full Sie sentences. The model
 * (gpt-4.1-mini) paraphrases prices/Profi into du-form fragments and repeats
 * the Profi disclosure across turns (observed live 2026-06-13), so when the
 * caller plainly asks the price of the resolved active product and the catalog
 * snapshot has a price, answer deterministically instead of via the model. The
 * once-only Profi disclosure is honoured via memory. Returns null when this is
 * not a clean single-product price question (then the model handles it).
 */
function tryDeterministicPriceAnswer(input: {
  userText: string;
  memory: DrkallaShortTermVoiceMemory;
  evidenceLookup?: DrkallaProductEvidenceLookup;
}): DrkallaFallbackResult | null {
  const text = input.userText;
  if (!DRKALLA_PRICE_INTENT.test(text)) return null;
  if (/\b(?:unterschied|vergleich|verglichen)\b/i.test(text)) return null; // comparison -> model
  if (detectDrkallaContactIntent(text)) return null; // contact/profi -> handled elsewhere
  const lastProduct = input.memory.lastMentionedProduct;
  if (!lastProduct) return null;
  const evidence = input.evidenceLookup?.byKeyHash(lastProduct.productKeyHash) ?? null;
  if (!evidence?.priceText) return null;
  const priceSentence = `${lastProduct.spokenName} kostet laut Shop-Datenstand ${evidence.priceText}. `;
  if (input.memory.profiPriceDisclosureGiven && !/\bprofi/i.test(text)) {
    return {
      text: `${priceSentence}Soll ich Ihnen den Produktlink zu ${lastProduct.spokenName} per SMS schicken?`,
      product: lastProduct,
    };
  }
  return {
    text: `${priceSentence}${DRKALLA_PROFI_PRICE_DISCLOSURE} ${DRKALLA_PROFI_LINK_QUESTION}`,
    product: lastProduct,
  };
}

function tryDeterministicUsageAnswer(input: {
  userText: string;
  memory: DrkallaShortTermVoiceMemory;
}): DrkallaFallbackResult | null {
  if (!DRKALLA_USAGE_INTENT.test(input.userText)) return null;
  const lastProduct = input.memory.lastMentionedProduct;
  if (!lastProduct) return null;
  return {
    text: `Zur genauen Anwendung von ${lastProduct.spokenName} liegen mir im Shop-Datenstand gerade keine sicheren Details vor. Bitte pruefen Sie die Produktseite oder kontaktieren Sie uns fuer genaue Anwendungshinweise.`,
    product: lastProduct,
  };
}

// Brands customers commonly ask for that the shop does NOT stock as a range (it
// is almost entirely the house brand Doktor Kalla). Real calls loop when a
// caller asks for L'Oréal/"Loreal"/"Loyal": the recommender keeps naming a
// wrong-brand product instead of answering. Give ONE honest, spelling-robust
// answer + a grounded house alternative, consistently across ASR variants.
const DRKALLA_BRANDS: Array<{ name: string; re: RegExp }> = [
  { name: "L'Oréal", re: /\b(?:l\s*['’]?\s*or[ée]al|lor[ée]al|loreal|lorial|loriel|loyal|oreal)\b/i },
  { name: 'Wella', re: /\bwella\b/i },
  { name: 'Schwarzkopf', re: /\bschwarzkopf\b/i },
  { name: 'Garnier', re: /\bgarnier\b/i },
  { name: 'Syoss', re: /\bsyoss\b/i },
  { name: 'Goldwell', re: /\bgoldwell\b/i },
  { name: 'Redken', re: /\bredken\b/i },
  { name: 'Olaplex', re: /\bolaplex\b/i },
  { name: 'Indola', re: /\bindola\b/i },
  { name: 'Alcina', re: /\balcina\b/i },
];

// A leading brand word on a spoken short name, stripped so the brand line does
// not echo the name twice ("Von L'Oréal haben wir nur L'Oréal Inoa ..." ->
// "... haben wir nur Inoa ..."). Accent/apostrophe tolerant (ASR + curly quotes).
const BRAND_NAME_LEAD = /^\s*(?:l['’]?\s*or[ée]al|lor[ée]al|loreal|wella|schwarzkopf|garnier|syoss|goldwell|redken|olaplex|indola|alcina|lattafa)\b[\s-]*/i;

// Range priceText reads "von X bis Y" — prefixing "für" yields the ungrammatical
// "für von 12 Euro bis 17 Euro", so a range is appended with a comma instead.
function joinDrkallaPriceClause(priceText: string | null | undefined): string {
  if (!priceText) return '';
  return /^von\b/i.test(priceText) ? `, ${priceText}` : ` für ${priceText}`;
}

/**
 * Deterministic, consistent answer when the caller names a known external brand.
 * Real calls 2026-06-16: "L'Oréal / Loreal / Loyal" looped — the recommender
 * re-pitched a wrong-brand product. Two honest outcomes, never a wrong-brand loop:
 *   - We DO carry the brand (vendor-strict check; e.g. the L'Oréal Inoa, in stock
 *     at 13 Euro): name the real product. A flat "führen wir nicht" would be a
 *     false denial of a product we actually sell.
 *   - We do NOT carry it (Wella/Schwarzkopf/…): say so once and offer a grounded
 *     house alternative of the requested/active type.
 * Returns null when no known brand is named or the turn is a comparison/usage
 * question (-> model), or when we would repeat last turn's product (anti-loop).
 */
function tryDeterministicBrandReply(input: {
  userText: string;
  memory: DrkallaShortTermVoiceMemory;
  catalogSearch?: DrkallaProductCatalogSearch;
  brandStock?: DrkallaExternalBrandStock;
}): DrkallaFallbackResult | null {
  const text = input.userText;
  if (NEED_VETO.test(text)) return null; // comparison/advice/usage -> model
  const brand = DRKALLA_BRANDS.find((b) => b.re.test(text));
  if (!brand) return null;

  // Do we actually carry this brand? Vendor-strict, so competitor SEO tags on
  // house products can never fake a "yes", and the accent-folded key finds the
  // L'Oréal vendor the token search drops.
  const stock = (input.brandStock?.(brand.name) ?? []).filter((s) => s.shortName);
  const top = stock[0];
  if (top) {
    const namePart = top.shortName.replace(BRAND_NAME_LEAD, '').trim() || top.shortName;
    // Anti-repeat: if we already named this product last turn, hand the insistence
    // to the model instead of repeating the identical line. Check lastAgentQuestion
    // (which still carries the product name) too, because a follow-up that names a
    // type ("und L'Oréal Shampoo?") switches activeProductType and clears
    // lastMentionedProduct — that reset is why the bare check looped live.
    const justAsked = input.memory.lastAgentQuestion ?? '';
    if (input.memory.lastMentionedProduct?.spokenName === top.shortName || justAsked.includes(namePart)) return null;
    const lead = stock.length === 1 ? 'nur' : 'zum Beispiel';
    return {
      text: `Von ${brand.name} haben wir ${lead} ${namePart}${joinDrkallaPriceClause(top.priceText)}. Sonst führen wir überwiegend unsere Hausmarke. Möchten Sie mehr zu ${namePart} wissen?`,
      product: { spokenName: top.shortName, productId: top.productId, productKind: top.productType },
    };
  }

  // Not stocked: honest "we don't carry it" + a grounded house alternative of the
  // requested/active type.
  const typeLabel = detectDrkallaUserProductType(text) ?? input.memory.activeProductType?.label ?? null;
  let alt = null as null | { shortName: string; priceText: string | null; productId: string; productType: string | null };
  if (typeLabel && input.catalogSearch) {
    const hits = input.catalogSearch(typeLabel, 8).filter((h) => h.typeHit);
    const careOk = dropChemicalForCareIntent(hits, text, typeLabel);
    alt = careOk[0] ?? hits[0] ?? null;
  }
  // Anti-loop: if we already steered the caller to this alternative last turn,
  // let the model handle the insistence instead of repeating the brand line.
  if (alt && input.memory.lastMentionedProduct?.spokenName === alt.shortName) return null;
  const altClause = alt
    ? ` Bei ${typeLabel} haben wir aber zum Beispiel ${alt.shortName}${joinDrkallaPriceClause(alt.priceText)}. Möchten Sie mehr dazu wissen?`
    : ' Wir haben aber eine eigene Auswahl an Friseurbedarf. Wonach suchen Sie genau?';
  return {
    text: `Produkte von ${brand.name} führen wir leider nicht im Sortiment.${altClause}`,
    product: alt ? { spokenName: alt.shortName, productId: alt.productId, productKind: alt.productType } : undefined,
  };
}

export async function buildDrkallaCustomLlmResponse(input: {
  canary: DrkallaCustomRuntimeCanaryConfig;
  event: AgentTurnRequestedEvent;
  memory: DrkallaShortTermVoiceMemory;
  client: DrkallaCustomLlmClient;
  detectProducts?: DrkallaProductNameDetector;
  detectAmbiguousProduct?: DrkallaAmbiguousProductNameDetector;
  evidenceLookup?: DrkallaProductEvidenceLookup;
  catalogSearch?: DrkallaProductCatalogSearch;
  brandStock?: DrkallaExternalBrandStock;
  faqMatch?: DrkallaFaqMatcher;
  knowledgeRetriever?: DrkallaKnowledgeRetriever;
  // True when the knowledge comes from owner-published content (platform overlay):
  // it then grounds even if the catalog has (weak) hits, so a service/knowledge
  // question is not shadowed by a coincidental product tag-match. Baked knowledge
  // keeps the catalog-first precedence.
  knowledgePriority?: boolean;
  // Owner-published contact facts (platform overlay) that override the baked
  // canonical address/hours/email/anfahrt. Omitted = baked facts are used.
  contactFacts?: DrkallaContactFacts;
  // Recent prior turns of THIS call (from Retell's transcript), fed to the model
  // so it keeps the topic across turns. Deterministic paths still use only the
  // current utterance; this is added to the model's user message only.
  conversationHistory?: DrkallaConversationTurn[];
  // Rolling background note summarizing the OLDER part of a long call (built off
  // the hot path; see drkalla-conversation-summary). Added to the model message
  // only, before the verbatim recent window.
  conversationSummary?: string;
  executeSendLink?: DrkallaSendLinkExecutor;
  onDelta?: (chunk: string) => void;
  onFaqCandidate?: (question: string, answer: string) => void;
  onKnowledgeChunk?: (sourceId: string, chunkId: string, query: string, score: number) => void;
  signal?: AbortSignal;
}): Promise<DrkallaCustomLlmResponse> {
  const canaryTurn = buildDrkallaCustomRuntimeCanaryTurn({
    canary: input.canary,
    event: input.event,
    memory: input.memory,
    runtimeOptions: { detectProducts: input.detectProducts },
    evidenceLookup: input.evidenceLookup,
    contactFacts: input.contactFacts,
  });
  const turnIndex = input.event.sequence ?? 0;

  if (!canaryTurn.enabled) {
    return {
      blocked: true,
      text: `Canary disabled: ${canaryTurn.blockers.join(', ') || 'unknown'}`,
      memory: canaryTurn.runtime.memory,
      metrics: {
        extraLlmCalls: 0,
        extraKbCalls: 0,
        directiveChars: canaryTurn.directiveChars,
      },
      blockers: canaryTurn.blockers,
    };
  }

  const user = sanitizeUserText(input.event.currentUserText ?? '');
  const turnGuard = evaluateTurnTakingGuard({
    transcriptText: user,
    transcriptFinal: true,
    asrConfidence: null,
    partialStableMs: 0,
    silenceMs: canaryTurn.runtime.memory.silenceMs,
    inaudibleStreak: canaryTurn.runtime.memory.inaudibleStreak,
  });
  if (turnGuard.action === 'repair_prompt') {
    const repairText = nextInaudibleRepair(canaryTurn.runtime.memory);
    return {
      blocked: false,
      text: repairText,
      memory: reduceDrkallaShortTermMemory(
        canaryTurn.runtime.memory,
        deriveDrkallaAgentSpokeEvent({ text: repairText, turnIndex }),
      ),
      metrics: {
        extraLlmCalls: 0,
        extraKbCalls: 0,
        directiveChars: canaryTurn.directiveChars,
      },
      blockers: [],
    };
  }

  const usageAnswer = tryDeterministicUsageAnswer({
    userText: user,
    memory: canaryTurn.runtime.memory,
  });
  if (usageAnswer) {
    return {
      blocked: false,
      text: usageAnswer.text,
      memory: reduceDrkallaShortTermMemory(
        canaryTurn.runtime.memory,
        deriveDrkallaAgentSpokeEvent({
          text: usageAnswer.text,
          turnIndex,
          detectProducts: input.detectProducts,
          fallbackProduct: usageAnswer.product,
        }),
      ),
      metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
      blockers: [],
      quality: { duFormDetected: false, duFormConfidence: 'none', duFormSlips: [] },
    };
  }

  // A confirmed SMS-link offer must never reach the model: with the gated
  // executor wired the server sends the real SMS through the policied
  // send_link tool; without it the agent answers truthfully. Either way the
  // model can never claim a send that did not happen.
  const lastQ = canaryTurn.runtime.memory.lastAgentQuestion ?? '';
  if (SMS_OFFER_QUESTION.test(lastQ)) {
    const twoOption = TWO_OPTION_OFFER.test(lastQ);
    const wantsProfi = PROFI_LINK_CHOICE.test(user);
    const wantsProduct = PRODUCT_LINK_CHOICE.test(user);
    const bareYes = SHORT_AFFIRMATION.test(user);

    // Decline of the offer ("nein danke, alles gut", "passt", "brauche ich nicht").
    // The SMS-confirm path only handled YES, and SMALLTALK_NEGATION is deliberately
    // vetoed while an SMS offer is pending — so a decline fell through to the model,
    // which RE-OFFERED the link (real battery 2026-06-16, the "immer wieder" feel).
    // Wind down deterministically and end on a non-offer question so the pending
    // offer is cleared.
    const declinesLink = !wantsProfi && !wantsProduct && !bareYes && !/\?/.test(user)
      && (SMALLTALK_NEGATION.test(user) || DRKALLA_LINK_DECLINE.test(user));
    if (declinesLink) {
      const text = 'Alles klar, dann schicke ich nichts. Kann ich sonst noch etwas für Sie tun?';
      return {
        blocked: false,
        text,
        memory: reduceDrkallaShortTermMemory(
          canaryTurn.runtime.memory,
          deriveDrkallaAgentSpokeEvent({ text, turnIndex }),
        ),
        metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
        blockers: [],
      };
    }

    if (twoOption && bareYes && !wantsProfi && !wantsProduct) {
      // Ambiguous yes to a two-option offer: ask which link, never guess.
      const clarify = 'Gern. Möchten Sie den Produktlink oder den Link zum Profi-Zugang?';
      return {
        blocked: false,
        text: clarify,
        memory: reduceDrkallaShortTermMemory(
          canaryTurn.runtime.memory,
          deriveDrkallaAgentSpokeEvent({ text: clarify, turnIndex }),
        ),
        metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
        blockers: [],
      };
    }

    if (wantsProfi || wantsProduct || bareYes) {
      const activeProduct = canaryTurn.runtime.memory.lastMentionedProduct;
      const evidence = activeProduct
        ? input.evidenceLookup?.byKeyHash(activeProduct.productKeyHash) ?? null
        : null;
      // Resolve the product link URL robustly: prefer the grounded product's
      // evidence; if that product has no URL (a turn re-grounded the spoken name
      // to a URL-less duplicate — real battery 2026-06-14), look the spoken name
      // up in the catalog and take that product's URL. Never claim NOT_WIRED for
      // a product we can actually link.
      let productUrl = evidence?.url ?? null;
      if (!productUrl && activeProduct && input.catalogSearch && input.evidenceLookup) {
        const hit = input.catalogSearch(activeProduct.spokenName, 1)[0];
        if (hit) productUrl = input.evidenceLookup.byId(hit.productId)?.url ?? null;
      }
      // Resolve the link target: explicit Profi; else the grounded product; else,
      // when the caller asked about a CATEGORY/"Sortiment" with no single product
      // resolved, a category SEARCH link for the active product type (a valid
      // drkalla.com link) instead of the misleading "noch nicht freigeschaltet"
      // — makes links flexible enough for "schick mir das Scheren-Sortiment".
      let target: { url: string; label: string; linkKind: DrkallaSendLinkKind } | null = null;
      if (wantsProfi) {
        target = { url: DRKALLA_CONTACT_FACTS.profiUrl, label: 'Profi-Zugang', linkKind: 'profi' };
      } else if (activeProduct && productUrl) {
        target = { url: productUrl, label: activeProduct.spokenName, linkKind: 'product' };
      } else {
        const categoryTerm = canaryTurn.runtime.memory.activeProductType?.label?.trim();
        if (categoryTerm) {
          target = {
            url: `https://drkalla.com/search?q=${encodeURIComponent(categoryTerm)}`,
            label: `${categoryTerm}-Auswahl`,
            linkKind: 'category',
          };
        }
      }

      let text = DRKALLA_SMS_NOT_WIRED_TEXT;
      let linkSentUrl: string | null = null;
      if (input.executeSendLink && target) {
        const outcome = await input.executeSendLink({ url: target.url, label: target.label, linkKind: target.linkKind })
          .catch(() => ({ smsSent: false as const }));
        if (outcome.smsSent) {
          text = target.linkKind === 'profi'
            ? 'Erledigt, ich habe Ihnen den Link zum Profi-Zugang per SMS geschickt. Kann ich sonst noch etwas klären?'
            : target.linkKind === 'category'
              ? `Erledigt, ich habe Ihnen den Link zu unserer ${target.label} per SMS geschickt. Kann ich sonst noch etwas klären?`
              : `Erledigt, ich habe Ihnen den Produktlink zu ${target.label} per SMS geschickt. Kann ich sonst noch etwas klären?`;
          linkSentUrl = target.url;
        } else if ('duplicate' in outcome && outcome.duplicate) {
          text = `Den Link habe ich Ihnen in diesem Anruf schon geschickt. Kann ich sonst noch etwas klären?`;
        } else {
          // End with a question so lastAgentQuestion is no longer the SMS offer
          // — otherwise a following "nee, alles gut" stays vetoed by the pending
          // offer and never reaches the deterministic wind-down.
          text = target.linkKind === 'profi'
            ? 'Das hat gerade leider nicht geklappt, die SMS ging nicht raus. Den Profi-Zugang finden Sie auf drkalla punkt com. Kann ich sonst noch etwas klären?'
            : `Das hat gerade leider nicht geklappt, die SMS ging nicht raus. Sie finden ${target.label} auf drkalla punkt com. Kann ich sonst noch etwas klären?`;
        }
      }
      const agentEvent = deriveDrkallaAgentSpokeEvent({ text, turnIndex });
      return {
        blocked: false,
        text,
        memory: reduceDrkallaShortTermMemory(canaryTurn.runtime.memory, {
          ...agentEvent,
          linksSent: linkSentUrl && target ? [{ url: linkSentUrl, label: target.label }] : undefined,
        }),
        metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
        blockers: [],
      };
    }
  }

  // Clear caller farewell: say goodbye deterministically and hang up. No model,
  // no new question. (Memory set endCallEligible on the caller's farewell turn;
  // the agent_spoke reduction resets it, so we read it here before replying.)
  if (
    canaryTurn.runtime.memory.endCallEligible
    && canaryTurn.runtime.memory.endCallReason === 'caller_farewell'
  ) {
    const byeText = 'Vielen Dank für Ihren Anruf bei Dr.Kalla. Auf Wiederhören!';
    return {
      blocked: false,
      text: byeText,
      memory: reduceDrkallaShortTermMemory(
        canaryTurn.runtime.memory,
        deriveDrkallaAgentSpokeEvent({ text: byeText, turnIndex }),
      ),
      metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
      blockers: [],
      endCall: true,
    };
  }

  // LATENCY fast-path: pure thanks / bare ack / bare non-farewell "nein" get a
  // deterministic Sie reply with no model call. Placed AFTER the farewell and
  // SMS-confirm short-circuits (so it cannot swallow a goodbye or a pending
  // link answer) and BEFORE the ambiguous/price/funnel paths (its own veto
  // already rules out any turn that carries a product/price/contact signal).
  const smalltalkReply = tryDeterministicSmalltalkReply({
    userText: user,
    memory: canaryTurn.runtime.memory,
  });
  if (smalltalkReply) {
    return {
      blocked: false,
      text: smalltalkReply,
      memory: reduceDrkallaShortTermMemory(
        canaryTurn.runtime.memory,
        deriveDrkallaAgentSpokeEvent({ text: smalltalkReply, turnIndex }),
      ),
      metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
      blockers: [],
      quality: { duFormDetected: false, duFormConfidence: 'none', duFormSlips: [] },
    };
  }

  // A real ambiguous product LINE ("Koleston Perfect") gets a variant
  // clarification; a generic hair-type descriptor ("trockenes Haar") does not
  // (it is a NEED). Computed here so deterministic discovery can defer to a real
  // ambiguous line but otherwise fall back to the remembered category.
  const ambiguous = input.detectAmbiguousProduct?.(user) ?? null;
  const ambiguousIsHairDescriptor = ambiguous ? DRKALLA_HAIR_DESCRIPTOR.test(ambiguous.label) : false;
  // Once we know the category, a brand/line is a FILTER, not a variant choice —
  // reach a concrete product instead of looping a clarification. We "know the
  // category" when the caller named a product TYPE in THIS turn ("Haarfarbe von
  // L'Oréal") or we already asked a variant question last turn and they answered.
  // A bare ambiguous product LINE with neither ("Koleston Perfect", type only
  // from an earlier turn) still gets the variant clarification.
  const typeNamedThisTurn = detectDrkallaUserProductType(user) !== null;
  const askedVariantLastTurn = VARIANT_CLARIFY_MARKER.test(canaryTurn.runtime.memory.lastAgentQuestion ?? '');
  const ambiguousIsRealProduct =
    !!ambiguous && !ambiguousIsHairDescriptor && !typeNamedThisTurn && !askedVariantLastTurn;

  // Deterministic discovery for a CATEGORY need: recommend the top SHORT product
  // and ground it, so the agent stops looping and a follow-up "ja" sends the SMS
  // (real call 2026-06-13). When this turn alone has no category token it falls
  // back to the remembered category + this turn (brand/garbled ASR) so it still
  // reaches products (real call 2026-06-15) — unless it is a real ambiguous line.
  // No detectProducts in the reduce so the recommended TOP hit wins as
  // lastMentionedProduct for a follow-up SMS confirm + price.
  if ((input.detectProducts?.(user) ?? []).length === 0) {
    // A named external brand we do not stock (L'Oréal/Wella/...) is answered
    // honestly + with a house alternative BEFORE the recommender, so it never
    // loops a wrong-brand product (real calls 2026-06-16).
    const brandReply = tryDeterministicBrandReply({
      userText: user,
      memory: canaryTurn.runtime.memory,
      catalogSearch: input.catalogSearch,
      brandStock: input.brandStock,
    });
    if (brandReply) {
      return {
        blocked: false,
        text: brandReply.text,
        memory: reduceDrkallaShortTermMemory(
          canaryTurn.runtime.memory,
          deriveDrkallaAgentSpokeEvent({ text: brandReply.text, turnIndex, fallbackProduct: brandReply.product }),
        ),
        metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
        blockers: [],
        quality: { duFormDetected: false, duFormConfidence: 'none', duFormSlips: [] },
      };
    }
    const needReply = tryDeterministicNeedReply({
      userText: user,
      memory: canaryTurn.runtime.memory,
      catalogSearch: input.catalogSearch,
      evidenceLookup: input.evidenceLookup,
      allowActiveTypeFallback: !ambiguousIsRealProduct,
    });
    if (needReply) {
      return {
        blocked: false,
        text: needReply.text,
        memory: reduceDrkallaShortTermMemory(
          canaryTurn.runtime.memory,
          deriveDrkallaAgentSpokeEvent({ text: needReply.text, turnIndex, fallbackProduct: needReply.product }),
        ),
        metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
        blockers: [],
        quality: { duFormDetected: false, duFormConfidence: 'none', duFormSlips: [] },
      };
    }
  }

  if (ambiguousIsRealProduct && ambiguous && (input.detectProducts?.(user) ?? []).length === 0) {
    const clarifyText = `Von ${ambiguous.label} gibt es bei uns mehrere Ausführungen. Welche Größe oder Ausführung meinen Sie?`;
    const withPending = reduceDrkallaShortTermMemory(canaryTurn.runtime.memory, {
      type: 'pending_clarification',
      turnIndex,
      kind: 'product_variant',
      prompt: `Welche Ausführung von ${ambiguous.label} meinen Sie?`,
    });
    return {
      blocked: false,
      text: clarifyText,
      memory: reduceDrkallaShortTermMemory(
        withPending,
        deriveDrkallaAgentSpokeEvent({ text: clarifyText, turnIndex }),
      ),
      metrics: {
        extraLlmCalls: 0,
        extraKbCalls: 0,
        directiveChars: canaryTurn.directiveChars,
      },
      blockers: [],
    };
  }

  // Deterministic, grounded price answer for the sales-critical path (full Sie
  // sentences, once-only Profi disclosure) — bypasses the model, which mangles
  // register/style/repetition here.
  const deterministicPrice = tryDeterministicPriceAnswer({
    userText: user,
    memory: canaryTurn.runtime.memory,
    evidenceLookup: input.evidenceLookup,
  });
  if (deterministicPrice) {
    return {
      blocked: false,
      text: deterministicPrice.text,
      memory: reduceDrkallaShortTermMemory(
        canaryTurn.runtime.memory,
        deriveDrkallaAgentSpokeEvent({
          text: deterministicPrice.text,
          turnIndex,
          detectProducts: input.detectProducts,
          fallbackProduct: deterministicPrice.product,
        }),
      ),
      metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
      blockers: [],
      quality: { duFormDetected: false, duFormConfidence: 'none', duFormSlips: [] },
    };
  }

  // Deterministic brand/product list for the "Soll ich mit Marken anfangen?"
  // -> "Ja" funnel gap: when an active product type is known and the caller
  // bare-affirms or asks for the selection, name real catalog products for that
  // type instead of letting catalogSearch("ja") return nothing and the model
  // loop on the same offer (live call). Grounded: only real catalog names.
  const typeListReply = tryDeterministicTypeListReply({
    userText: user,
    memory: canaryTurn.runtime.memory,
    catalogSearch: input.catalogSearch,
  });
  if (typeListReply) {
    return {
      blocked: false,
      text: typeListReply,
      memory: reduceDrkallaShortTermMemory(
        canaryTurn.runtime.memory,
        deriveDrkallaAgentSpokeEvent({ text: typeListReply, turnIndex }),
      ),
      metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
      blockers: [],
      quality: { duFormDetected: false, duFormConfidence: 'none', duFormSlips: [] },
    };
  }

  const namedNow = input.detectProducts?.(user) ?? [];

  // Curated FAQ: a human-approved answer to a STABLE general question (shipping,
  // returns, payment, profi access …) — instant, no model call, no hallucination.
  // Runs AFTER all structured paths (contact/price/product) so those stay
  // authoritative, and only on a high-confidence trigger match; otherwise null
  // and the model answers as before. Additive, never a gate.
  if (namedNow.length === 0) {
    const faq = input.faqMatch?.(user) ?? null;
    if (faq) {
      return {
        blocked: false,
        text: faq.answer,
        memory: reduceDrkallaShortTermMemory(
          canaryTurn.runtime.memory,
          deriveDrkallaAgentSpokeEvent({ text: faq.answer, turnIndex }),
        ),
        metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
        blockers: [],
        quality: { duFormDetected: false, duFormConfidence: 'none', duFormSlips: [] },
      };
    }
  }

  // Fallback for an open need that did NOT hit a productType (handled above) but
  // still matches catalog products by tag/title: surface real products (short
  // names) so the model NAMES them instead of looping. Grounded: real names only.
  // HARD CATEGORY CONSTRAINT: when the caller's category is known
  // (activeProductType), search the remembered category WITH this turn and keep
  // only productType matches, so a cross-category item never reaches the model —
  // e.g. a "Shampoo" request must never surface a "Friseur-Tool" comb that merely
  // carries a "lockiges Haar" tag (real call 2026-06-15). Without a known
  // category the open tag/title search is preserved.
  const activeType = canaryTurn.runtime.memory.activeProductType;
  const catalogHitsRaw = namedNow.length === 0
    ? activeType
      ? (input.catalogSearch?.(`${activeType.label} ${user}`, 4) ?? []).filter((h) => h.typeHit)
      : (input.catalogSearch?.(user, 4) ?? [])
    : [];
  // Care need must not feed a Blondierung/Entwickler chemical to the model either.
  const catalogHits = dropChemicalForCareIntent(catalogHitsRaw, user, activeType?.label ?? null);
  // A how-to/usage OR service question wants an explanation / the right policy, not
  // a product pitched — suppress the catalog grounding and let the knowledge/FAQ
  // layer ground it instead (routing-index Stage 1: route by intent before the
  // catalog can hijack a service question that merely contains a product word).
  const isUsageHowto = DRKALLA_USAGE_HOWTO.test(user);
  const suppressCatalog = isUsageHowto || DRKALLA_SERVICE_INTENT.test(user);
  let system = compactSystemPrompt(canaryTurn.modelDirectives, input.contactFacts);
  if (catalogHits.length && !suppressCatalog) {
    const list = catalogHits
      .map((p) => (p.priceText ? `${p.shortName} (${p.priceText})` : p.shortName))
      .join('; ');
    system += `\nKatalog-Treffer zum Bedarf (nenne dem Anrufer konkret ein bis drei dieser echten Produkte mit genau diesen kurzen Namen, erfinde nichts dazu, und frage nicht erneut nach der Produktart): ${list}`;
  }
  // Free-text knowledge grounding (shop policies, product usage/info, ingested
  // PDFs): additive + conservative. Fires ONLY when no product is named AND the
  // catalog gave no structured grounding, so catalog/FAQ always win. Pure
  // in-memory lexical retrieval (no network/DB) so the deterministic-turn p50 is
  // untouched (this block only runs on a model turn). Injected as a SOURCE-LABELED
  // line the model must answer FROM and nothing else — same anti-hallucination
  // posture as the catalog line; it never speaks raw chunk text itself.
  if (namedNow.length === 0 && (catalogHits.length === 0 || suppressCatalog || input.knowledgePriority) && input.knowledgeRetriever) {
    const kb = input.knowledgeRetriever(user);
    if (kb && kb.hits.length) {
      const block = kb.hits
        .slice(0, 2)
        .map((h) => `Quelle ${h.sourceTitle}: ${h.text.slice(0, 300)}`)
        .join(' | ')
        .slice(0, 640);
      system += `\nWissens-Beleg (beantworte die Frage NUR mit diesen Quellen, nenne keine Fakten, die hier nicht stehen, erfinde nichts; wenn die Antwort hier nicht steht, sage das ehrlich und verweise auf drkalla punkt com): ${block}`;
      const lead = kb.hits[0]!;
      input.onKnowledgeChunk?.(lead.sourceId, lead.chunkId, user, kb.confidence);
    }
  }
  const maxOutputChars = 420;
  // The model sees an optional rolling note (older context on long calls) + a
  // short verbatim recent-history block + the current utterance, so it keeps the
  // topic across turns. Deterministic paths above used `user` (current utterance
  // only) on purpose — only the generative model call gets this context.
  const historyBlock = buildDrkallaHistoryBlock(input.conversationHistory);
  const summaryNote = input.conversationSummary?.trim().slice(0, 600);
  const summaryBlock = summaryNote ? `Gedaechtnisnotiz zum bisherigen Gespraech: ${summaryNote}` : '';
  const contextParts = [summaryBlock, historyBlock].filter(Boolean);
  const modelUser = contextParts.length
    ? `${contextParts.join('\n\n')}\n\nAktuelle Aussage des Anrufers: ${user}`
    : user;
  let modelText = '';
  if (input.client.completeStream && input.onDelta) {
    // Stream chunks upward so TTS can start on the first sentence; enforce
    // the output cap across the whole stream.
    let forwardedChars = 0;
    const onDelta = (chunk: string) => {
      if (!chunk || forwardedChars >= maxOutputChars) return;
      const allowed = chunk.slice(0, maxOutputChars - forwardedChars);
      forwardedChars += allowed.length;
      input.onDelta?.(allowed);
    };
    // No trim here: forwarded deltas must stay an exact prefix of the final
    // text so the transport can compute the remaining tail frame.
    const raw = await input.client.completeStream({ system, user: modelUser, maxOutputChars, onDelta, signal: input.signal });
    modelText = raw.trim() ? raw.slice(0, maxOutputChars) : '';
  } else {
    modelText = (await input.client.complete({ system, user: modelUser, maxOutputChars, signal: input.signal }))
      .trim()
      .slice(0, maxOutputChars);
  }

  const fallback = modelText
    ? null
    : fallbackTextWithMemory({
        userText: user,
        memory: canaryTurn.runtime.memory,
        evidenceLookup: input.evidenceLookup,
        contactFacts: input.contactFacts,
      });
  const spokenText = modelText || (fallback?.text ?? '');

  // FAQ-candidate capture: a general question (no product category matched) that
  // the MODEL had to answer is a candidate for a future curated FAQ entry. Logged
  // only; the owner reviews + approves via the propose loop. No live-call effect.
  if (modelText && catalogHits.length === 0) {
    input.onFaqCandidate?.(user, spokenText);
  }

  // Reduce what the agent is about to say back into short-term memory so the
  // funnel, per-product fact dedupe, and the once-only Profi disclosure work
  // across live turns. Pure text analysis: no extra LLM call, no KB call.
  const memoryAfterAgentTurn = reduceDrkallaShortTermMemory(
    canaryTurn.runtime.memory,
    deriveDrkallaAgentSpokeEvent({
      text: spokenText,
      turnIndex,
      detectProducts: input.detectProducts,
      fallbackProduct: fallback?.product,
    }),
  );

  // Non-blocking Sie-consistency check on the only path that can slip into du
  // (model-generated, or memory-driven fallback text). Logged upstream; never
  // rewrites the answer.
  const formality = detectDrkallaDuForm(spokenText);

  return {
    blocked: false,
    text: spokenText,
    memory: memoryAfterAgentTurn,
    metrics: {
      extraLlmCalls: 1,
      extraKbCalls: 0,
      directiveChars: canaryTurn.directiveChars,
    },
    blockers: [],
    quality: {
      duFormDetected: formality.hasDuForm,
      duFormConfidence: formality.confidence,
      duFormSlips: formality.slips,
    },
  };
}
