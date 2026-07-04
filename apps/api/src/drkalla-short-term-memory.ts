import crypto from 'node:crypto';
import { detectDrkallaUserProductType } from './drkalla-product-type-detector.js';

export type DrkallaRuntimeMode = 'retell_managed' | 'custom_runtime';
export type DrkallaRuntimeMemoryState = {
  mode: DrkallaRuntimeMode;
  memoryContextInjected: boolean;
};

export type DrkallaMemoryFactKey =
  | 'contact.address'
  | 'contact.hours'
  | 'contact.email'
  | 'contact.phone'
  | 'route.hermannplatz'
  | 'product.last'
  | `product.${string}.description`
  | `product.${string}.size`
  | `product.${string}.price`
  | `product.${string}.location`
  | `product.${string}.availability`
  | `product.${string}.usage`
  | `product.${string}.brand`
  | `product.${string}.category`
  | `product.${string}.link`;

export type DrkallaStoredMemoryFactKey =
  | 'contact.address'
  | 'contact.hours'
  | 'contact.email'
  | 'contact.phone'
  | 'route.hermannplatz'
  | 'product.last'
  | `dynamic_product.${string}`;

export type DrkallaMemoryFact = {
  key: DrkallaMemoryFactKey;
  label: string;
};

export type DrkallaMemoryAudioState = 'heard' | 'inaudible' | 'silence';
export type DrkallaProductFactKind =
  | 'description'
  | 'size'
  | 'price'
  | 'location'
  | 'availability'
  | 'usage'
  | 'brand'
  | 'category'
  | 'link';
export type DrkallaProductFunnelAction =
  | 'ask_goal_or_product_type'
  | 'clarify_variant'
  | 'compare_recent_products'
  | 'list_active_product_type_selection'
  | 'offer_product_link'
  | 'offer_product_or_profi_link';

export type DrkallaProductConversationState = {
  spokenName: string;
  productKeyHash: string;
  productKind: string | null;
  facts: Partial<Record<DrkallaProductFactKind, boolean>>;
  firstMentionedTurn: number;
  lastMentionedTurn: number;
};

export type DrkallaShortTermMemoryEvent =
  | {
      type: 'agent_spoke';
      turnIndex: number;
      text: string;
      factsMentioned?: DrkallaMemoryFact[];
      lastProduct?: {
        spokenName: string;
        productId?: string;
        productKind?: string;
      };
      productsMentioned?: Array<{
        spokenName: string;
        productId?: string;
        productKind?: string | null;
      }>;
      lastAgentQuestion?: string;
      linksSent?: Array<{
        url: string;
        label: string;
      }>;
      /** The caller just DECLINED this product/offer — remember to not re-offer. */
      rejectedProduct?: string;
      profiPriceDisclosureGiven?: boolean;
      /**
       * The agent spoke a wind-down turn ("Kann ich Ihnen sonst noch
       * weiterhelfen?" after a decline/bare Nein). Increments windDownStreak and
       * closes the topic, so a repeated "Nein" escalates to a goodbye instead of
       * looping the identical question (real call 2026-06-30: 4x "Nein" -> 4x
       * the same sentence), and the silence reminder stops resurrecting the
       * declined product.
       */
      windDown?: boolean;
    }
  | {
      type: 'user_audio';
      turnIndex: number;
      text: string;
      audioState: DrkallaMemoryAudioState;
      silenceMs?: number;
      productsMentioned?: Array<{
        spokenName: string;
        productId?: string;
        productKind?: string | null;
      }>;
    }
  | {
      type: 'pending_clarification';
      turnIndex: number;
      kind: 'product_variant' | 'contact_channel' | 'order_status' | 'category' | 'name';
      prompt: string;
      options?: string[];
    };

export type DrkallaRememberedFact = {
  label: string;
  firstMentionedTurn: number;
  lastMentionedTurn: number;
  mentionCount: number;
};

export type DrkallaShortTermVoiceMemory = {
  version: 'drkalla-short-term-memory-v1';
  heardFacts: Partial<Record<DrkallaStoredMemoryFactKey, DrkallaRememberedFact>>;
  sentLinkHashes: Partial<Record<string, { label: string; sentTurn: number }>>;
  lastMentionedProduct: null | {
    spokenName: string;
    productKeyHash: string;
    productKind: string | null;
    turnIndex: number;
  };
  recentProducts: Array<{
    spokenName: string;
    productKeyHash: string;
    productKind: string | null;
    turnIndex: number;
  }>;
  productConversations: Partial<Record<string, DrkallaProductConversationState>>;
  activeProductType: null | {
    label: string;
    turnIndex: number;
  };
  pendingClarification: null | {
    kind: 'product_variant' | 'contact_channel' | 'order_status' | 'category' | 'name';
    prompt: string;
    options: string[];
    turnIndex: number;
  };
  lastAgentQuestion: string | null;
  /**
   * The link the agent OFFERED to send — question OR statement form, from any
   * path (deterministic or model). A following "ja"/"schick" must send EXACTLY
   * this target: the live 2026-07-03 call resolved a "Ja, gerne." after a
   * Profi-Link offer to the remembered PRODUCT instead, and the caller got the
   * wrong SMS. Survives repair turns ("Wie bitte?"); cleared by a send, a
   * decline wind-down, or a product-type switch.
   */
  pendingLinkOffer: null | {
    kind: 'product' | 'profi' | 'category' | 'page';
    label: string;
    turnIndex: number;
  };
  /**
   * True iff the agent's IMMEDIATELY PRECEDING turn asked a question. Unlike
   * lastAgentQuestion (which deliberately persists so pending offers survive
   * interim statements), this flag is refreshed on EVERY agent turn — it is the
   * correct signal for the turn-taking pendingQuestion escape (live: a stale
   * question from turns ago disabled holds long after it was answered).
   */
  askedQuestionLastTurn: boolean;
  /**
   * Products the caller explicitly DECLINED this call (label + turn). The
   * recommender and the model (via avoid=) must not re-offer them.
   */
  rejectedProducts: Array<{ label: string; turnIndex: number }>;
  inaudibleStreak: number;
  silenceMs: number;
  endCallEligible: boolean;
  endCallReason: null | 'caller_farewell' | 'long_silence';
  profiPriceDisclosureGiven: boolean;
  /**
   * Hair type/problem descriptors the caller stated ("lockige", "trockenes").
   * A caller's hair profile holds for the WHOLE call: it survives product-type
   * switches and steers later product selection, so "ich habe lockige Haare"
   * in turn 1 still picks the Locken Shampoo when the caller asks for "ein
   * Shampoo" in turn 5 (real calls 2026-06-27/2026-07-02: the agent had no
   * memory of the hair type and pitched the wrong shampoo repeatedly).
   */
  callerNeeds: Array<{ label: string; turnIndex: number }>;
  /** Consecutive wind-down turns the agent spoke (see agent_spoke.windDown). */
  windDownStreak: number;
  /**
   * The caller declined the pending offer / wound the call down. Cleared as
   * soon as either side brings up a product again. The silence reminder must
   * NOT resurrect the declined product while this is set.
   */
  topicClosed: boolean;
};

const RAW_URL = /https?:\/\/\S+/gi;
const RAW_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const RAW_PHONE = /(?:\+49|0049|0)\s?[1-9](?:[\s\-\/()]?\d){5,14}/g;
const RAW_OPERATIONAL_ID = /\b(?:call|order|session|customer|agent|knowledge_base|kb)_[a-z0-9][a-z0-9_-]{5,}\b/gi;
const RAW_ORDER_ID = /\b(?:ord|order|bestellung)[-\s]?[a-z0-9]{4,}\b/gi;
const RAW_ADDRESS = /\b[\p{L}ÄÖÜäöüß-]+(?:strasse|straße|weg|platz|allee|gasse|damm)\s+\d+[a-z]?(?:\s+[A-ZÄÖÜ][\p{L}ÄÖÜäöüß-]+)?\b/giu;
const TITLED_PERSON_NAME = /\b(?:Herr|Frau)\s+[A-ZÄÖÜ][\p{L}ÄÖÜäöüß-]+\s+[A-ZÄÖÜ][\p{L}ÄÖÜäöüß-]+\b/gu;
const FOR_PERSON_NAME = /\b(f(?:ue|ü)r)\s+[A-ZÄÖÜ][\p{L}ÄÖÜäöüß-]+\s+[A-ZÄÖÜ][\p{L}ÄÖÜäöüß-]+\b/gu;
const LEADING_PERSON_NAME = /^[A-ZÄÖÜ][\p{L}ÄÖÜäöüß-]+\s+[A-ZÄÖÜ][\p{L}ÄÖÜäöüß-]+(?=,)/u;
const REPEAT_REQUEST = /\b(?:(?:nochmal|noch mal)\s+(?:sagen|wiederholen|nennen|erkl[aä]ren|h[oö]ren)|wiederhol|sag.*noch|kannst du (?:das|es)\s+(?:nochmal|noch mal|wiederholen)|k[oö]nnen sie (?:das|es)\s+(?:nochmal|noch mal|wiederholen)|adresse nochmal|zeiten nochmal|wie war das|was war das|(?:wie|was) war (?:der|die|das) (?:preis|name|link|adresse|uhrzeit|telefonnummer|nummer|produkt))\b/i;
// Real calls showed callers ending with forms the old literal "leg auf" missed
// ("tschau", "leg einfach/bitte/doch auf", bare "auflegen"), so the agent never
// hung up. Cover the common German farewell + hang-up phrasings; NOT_FAREWELL
// below still vetoes negated/continuing turns ("leg nicht auf", "noch nicht").
// Trailing guard is a letter-lookahead, not \b: umlaut-final tokens like
// "tschö" have no \w on the right so \b would never match after them.
const FAREWELL = /\b(?:tsch(?:[üu]ss?(?:i|le)?|uess?|au|ö|oe)|ciao|auf\s+wiederh[oö]ren|bis\s+dann|sch[oö]nen\s+tag\s+noch|das\s+war(?:'| e)?s|das\s+war\s+alles|nein\s+danke,?\s+das\s+war\s+alles|(?:hat\s+sich\s+)?alles\s+gekl[äa]rt|hat\s+sich\s+(?:das|es|'?s)\s+gekl[äa]rt|leg(?:e|st)?(?:\s+(?:bitte|doch|einfach|endlich|jetzt|mal|ruhig|gerne?|schon|halt|sofort|du))*\s+auf|(?:bitte\s+|einfach\s+|jetzt\s+|sofort\s+)?auflegen|beende(?:n)?\s+(?:bitte\s+)?(?:den\s+)?(?:anruf|gespr[äa]ch)|mach(?:\s+bitte)?\s+schluss|du\s+kannst\s+auflegen)(?![a-zäöüß])/i;
// A farewell keyword inside a negated or continuing turn is NOT a goodbye:
// "leg nicht auf", "nicht auflegen", "das war's noch nicht", "noch eine Frage".
const NOT_FAREWELL = /\b(?:nicht|nie)\s+auf(?:legen|h[äa]ngen)|leg\s+nicht\s+auf|nicht\s+(?:beenden|auflegen)|noch\s+nicht\b|noch\s+(?:eine|ne|'?n)?\s*frage|warte|moment\b|ach\s+nein|doch\s+nicht|eine?\s+sache\s+noch|noch\s+(?:et)?was\b/i;
// A frustrated "why can't/won't you hang up" IS a request to end the call, but
// it contains "nicht auflegen" (matched by NOT_FAREWELL) and usually a trailing
// "?", so it would otherwise be vetoed and reach the model, which then says
// "Ich kann nicht auflegen" (real call 2026-06-15). An interrogative
// warum/wieso/weshalb + auflegen/aufhängen is unambiguously a hang-up request
// and overrides both the NOT_FAREWELL veto and the trailing-"?" guard. The
// genuine stay-request ("bitte nicht auflegen") has no such interrogative.
const HANGUP_COMPLAINT = /\b(?:warum|wieso|weshalb)\b[^?!.]{0,40}\bauf(?:legen|h(?:ä|ae)ngen)\b/i;
const ACK_ONLY = /^(?:alles klar|okay|ok|ja|genau|passt|danke)$/i;

// An agent sentence that OFFERS to send a link/SMS — question ("Soll ich Ihnen
// den Link per SMS schicken?") or statement form ("Wenn Sie möchten, kann ich
// Ihnen den Profi-Link noch einmal per SMS schicken."). Past confirmations
// ("… habe ich Ihnen geschickt") never match: the send verbs are matched at a
// word boundary, so participles (geschickt/gesendet) stay out. [^.?!]* keeps
// each alternation inside one sentence.
const AGENT_LINK_OFFER = /(?:produktlink|\blink\b|per\s+sms|per\s+nachricht)[^.?!]*\b(?:schick|send|zusend|zuschick|zukomm|schreib|versend)\w*|\b(?:schick|send|zusend|zuschick|zukomm|schreib|versend)\w*[^.?!]*(?:produktlink|\blink\b|\bsms\b|nachricht)|\b(?:m(?:ö|oe)chten|wollen|soll(?:en)?|darf|h(?:ä|ae)tten)\b[^.?!]*\b(?:produktlink|\blink\b)\b[^.?!]*\?/i;
// A two-option offer ("Produktlink oder Profi-Zugang") stays ambiguous — the
// SMS-confirm path re-asks on a bare yes, so no pending target is recorded.
const AGENT_TWO_OPTION_OFFER = /produktlink\s+oder\s+(?:den\s+link\s+(?:zum\s+)?)?profi/i;
const AGENT_PROFI_OFFER = /\bprofi[\s-]?(?:link|zugang)\b/i;
const AGENT_CATEGORY_OFFER = /\b([\p{L}-]+)-auswahl\b/iu;
// A shop PAGE (not a product): "Soll ich Ihnen den Link zur Kontaktseite
// schicken?" — live 2026-07-04 the yes was resolved to the remembered PRODUCT
// and the caller got the wrong link twice.
const AGENT_PAGE_OFFER = /\bkontakt(?:seite|daten|informationen|infos)?\b/i;

function detectAgentLinkOffer(
  text: string,
  productLabel: string | null,
  turnIndex: number,
): NonNullable<DrkallaShortTermVoiceMemory['pendingLinkOffer']> | null {
  if (!AGENT_LINK_OFFER.test(text) || AGENT_TWO_OPTION_OFFER.test(text)) return null;
  if (AGENT_PROFI_OFFER.test(text)) {
    return { kind: 'profi', label: 'Profi-Zugang', turnIndex };
  }
  if (AGENT_PAGE_OFFER.test(text)) {
    return { kind: 'page', label: 'Kontaktseite', turnIndex };
  }
  const category = text.match(AGENT_CATEGORY_OFFER);
  if (category?.[1]) {
    return { kind: 'category', label: sanitizeMemoryText(`${category[1]}-Auswahl`, 60), turnIndex };
  }
  if (productLabel) {
    return { kind: 'product', label: sanitizeMemoryText(productLabel, 80), turnIndex };
  }
  return null;
}

// Hair-condition descriptors a caller uses to describe their OWN hair. Only
// captured when the turn is actually about hair (HAIR_CONTEXT), so "blond" in
// a bare color wish is not misread as a hair profile. The stored label is the
// verbatim adjective ("lockige"), which the catalog search maps onto catalog
// vocabulary (lockig -> Locken) via its query synonyms.
const HAIR_NEED_DESCRIPTOR = /\b(?:trocken|fein|lockig|kraus|coloriert|gef(?:ä|ae)rbt|blond|grau|dunkl|strapazier|fettig|empfindlich|gereizt|spr(?:ö|oe)d|br(?:ü|ue)chig|gesch(?:ä|ae)digt|d(?:ü|ue)nn|schuppen|spliss|frizz|glanzlos|kaputt)\w*/gi;
const HAIR_CONTEXT = /\b(?:haar\w*|locken|frisur|kopfhaut|spitzen|spliss|schuppen)\b/i;
const MAX_CALLER_NEEDS = 3;

function detectCallerHairNeeds(text: string): string[] {
  if (!HAIR_CONTEXT.test(text)) return [];
  const out: string[] = [];
  for (const match of text.matchAll(HAIR_NEED_DESCRIPTOR)) {
    const label = match[0].toLocaleLowerCase('de-DE').slice(0, 24);
    if (!out.includes(label)) out.push(label);
  }
  return out.slice(0, MAX_CALLER_NEEDS);
}

// Inflection-tolerant key so "lockige"/"lockigen" update one entry, not two.
function callerNeedKey(label: string): string {
  return label.slice(0, 5);
}
const PERFUME_PRICE_CONTEXT = /\b(?:parfum|eau de parfum|duft|herrenduft|damenduft|unisexduft|edp|cologne|lattafa)\b/i;
const PRODUCT_FACT_KEY = /^product\.(.+)\.(description|size|price|location|availability|usage|brand|category|link)$/;
const PRODUCT_FACT_ORDER: DrkallaProductFactKind[] = [
  'description',
  'size',
  'price',
  'location',
  'availability',
  'usage',
  'brand',
  'category',
  'link',
];
const MAX_HEARD_FACTS = 40;
const MAX_SENT_LINKS = 12;
const MAX_PRODUCT_CONVERSATIONS = 6;
// 5, not 3: a genuine 3-4-way comparison call evicted the first product and
// broke both compare_recent_products and the discussed_products anti-repeat.
const MAX_RECENT_PRODUCTS = 5;
const MAX_REJECTED_PRODUCTS = 3;
const STATIC_FACT_KEYS = new Set<DrkallaStoredMemoryFactKey>([
  'contact.address',
  'contact.hours',
  'contact.email',
  'contact.phone',
  'route.hermannplatz',
  'product.last',
]);

function detectUserProductType(text: string): string | null {
  return detectDrkallaUserProductType(text);
}

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function sanitizeMemoryText(value: string, max = 120): string {
  return value
    .replace(RAW_URL, '[url]')
    .replace(RAW_EMAIL, '[email]')
    .replace(RAW_PHONE, '[phone]')
    .replace(RAW_OPERATIONAL_ID, '[id]')
    .replace(RAW_ORDER_ID, '[order]')
    .replace(RAW_ADDRESS, '[address]')
    .replace(TITLED_PERSON_NAME, '[name]')
    .replace(FOR_PERSON_NAME, '$1 [name]')
    .replace(LEADING_PERSON_NAME, '[name]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function sortedKeys<T extends string>(value: Partial<Record<T, unknown>>): T[] {
  return Object.keys(value).sort() as T[];
}

function capRecord<T>(
  value: Partial<Record<string, T>>,
  max: number,
  recency: (entry: T) => number,
): Partial<Record<string, T>> {
  const entries = Object.entries(value).filter((entry): entry is [string, T] => Boolean(entry[1]));
  if (entries.length <= max) return value;
  return Object.fromEntries(
    entries
      .sort((left, right) => recency(right[1]) - recency(left[1]))
      .slice(0, max),
  ) as Partial<Record<string, T>>;
}

function capHeardFacts(
  value: Partial<Record<DrkallaStoredMemoryFactKey, DrkallaRememberedFact>>,
): Partial<Record<DrkallaStoredMemoryFactKey, DrkallaRememberedFact>> {
  const staticEntries = (Object.entries(value)
    .filter(([key, entry]) => STATIC_FACT_KEYS.has(key as DrkallaStoredMemoryFactKey) && entry)
  ) as Array<[DrkallaStoredMemoryFactKey, DrkallaRememberedFact]>;
  const dynamicEntries = (Object.entries(value)
    .filter(([key, entry]) => !STATIC_FACT_KEYS.has(key as DrkallaStoredMemoryFactKey) && entry)
  ) as Array<[DrkallaStoredMemoryFactKey, DrkallaRememberedFact]>;
  const dynamicLimit = Math.max(0, MAX_HEARD_FACTS - staticEntries.length);
  const keptDynamicEntries = dynamicEntries
    .sort((left, right) => right[1].lastMentionedTurn - left[1].lastMentionedTurn)
    .slice(0, dynamicLimit);
  return Object.fromEntries([...staticEntries, ...keptDynamicEntries]) as Partial<Record<DrkallaStoredMemoryFactKey, DrkallaRememberedFact>>;
}

function memorySafeFactKey(key: DrkallaMemoryFactKey): DrkallaStoredMemoryFactKey {
  if (STATIC_FACT_KEYS.has(key as DrkallaStoredMemoryFactKey)) return key as DrkallaStoredMemoryFactKey;
  return `dynamic_product.${hashValue(key)}`;
}

function productFactFromKey(key: DrkallaMemoryFactKey): null | {
  productId: string;
  factKind: DrkallaProductFactKind;
} {
  const match = key.match(PRODUCT_FACT_KEY);
  if (!match?.[1] || !match[2]) return null;
  return {
    productId: match[1],
    factKind: match[2] as DrkallaProductFactKind,
  };
}

function productKeyHash(productIdOrName: string): string {
  return hashValue(productIdOrName);
}

function rememberedProduct(
  product: NonNullable<Extract<DrkallaShortTermMemoryEvent, { type: 'agent_spoke' }>['lastProduct']>,
  turnIndex: number,
): NonNullable<DrkallaShortTermVoiceMemory['lastMentionedProduct']> {
  return {
    spokenName: sanitizeMemoryText(product.spokenName, 80),
    productKeyHash: productKeyHash(product.productId ?? product.spokenName),
    productKind: product.productKind ? sanitizeMemoryText(product.productKind, 60) : null,
    turnIndex,
  };
}

function upsertProductConversation(
  productConversations: Partial<Record<string, DrkallaProductConversationState>>,
  input: {
    productKeyHash: string;
    spokenName: string;
    productKind?: string | null;
    turnIndex: number;
    factKind?: DrkallaProductFactKind;
  },
): Partial<Record<string, DrkallaProductConversationState>> {
  const existing = productConversations[input.productKeyHash];
  const facts = { ...(existing?.facts ?? {}) };
  if (input.factKind) facts[input.factKind] = true;
  return {
    ...productConversations,
    [input.productKeyHash]: {
      spokenName: sanitizeMemoryText(existing?.spokenName ?? input.spokenName, 80),
      productKeyHash: input.productKeyHash,
      productKind: sanitizeMemoryText(input.productKind ?? existing?.productKind ?? '', 60) || null,
      facts,
      firstMentionedTurn: existing?.firstMentionedTurn ?? input.turnIndex,
      lastMentionedTurn: input.turnIndex,
    },
  };
}

export function createDrkallaShortTermMemory(): DrkallaShortTermVoiceMemory {
  return {
    version: 'drkalla-short-term-memory-v1',
    heardFacts: {},
    sentLinkHashes: {},
    lastMentionedProduct: null,
    recentProducts: [],
    productConversations: {},
    activeProductType: null,
    pendingClarification: null,
    lastAgentQuestion: null,
    pendingLinkOffer: null,
    askedQuestionLastTurn: false,
    rejectedProducts: [],
    inaudibleStreak: 0,
    silenceMs: 0,
    endCallEligible: false,
    endCallReason: null,
    profiPriceDisclosureGiven: false,
    callerNeeds: [],
    windDownStreak: 0,
    topicClosed: false,
  };
}

function withNoEndCall(memory: DrkallaShortTermVoiceMemory): DrkallaShortTermVoiceMemory {
  return { ...memory, endCallEligible: false, endCallReason: null };
}

function reduceAgentSpoke(
  memory: DrkallaShortTermVoiceMemory,
  event: Extract<DrkallaShortTermMemoryEvent, { type: 'agent_spoke' }>,
): DrkallaShortTermVoiceMemory {
  const heardFacts = { ...memory.heardFacts };
  let productConversations = { ...memory.productConversations };
  let lastMentionedProduct = memory.lastMentionedProduct;
  let recentProducts = memory.recentProducts;
  let activeProductType = memory.activeProductType;

  // Make every product spoken about in this turn known (conversation state
  // and recency), before the primary lastProduct so the primary stays the
  // most recent entry.
  for (const mention of (event.productsMentioned ?? []).slice(0, MAX_RECENT_PRODUCTS)) {
    const product = rememberedProduct(
      {
        spokenName: mention.spokenName,
        productId: mention.productId,
        productKind: mention.productKind ?? undefined,
      },
      event.turnIndex,
    );
    productConversations = upsertProductConversation(productConversations, {
      productKeyHash: product.productKeyHash,
      spokenName: product.spokenName,
      productKind: product.productKind,
      turnIndex: event.turnIndex,
    });
    recentProducts = [
      ...recentProducts.filter((item) => item.productKeyHash !== product.productKeyHash),
      product,
    ].slice(-MAX_RECENT_PRODUCTS);
  }

  if (event.lastProduct) {
    const product = rememberedProduct(event.lastProduct, event.turnIndex);
    productConversations = upsertProductConversation(productConversations, {
      productKeyHash: product.productKeyHash,
      spokenName: product.spokenName,
      productKind: product.productKind,
      turnIndex: event.turnIndex,
    });
    lastMentionedProduct = product;
    recentProducts = [
      ...recentProducts.filter((item) => item.productKeyHash !== product.productKeyHash),
      product,
    ].slice(-MAX_RECENT_PRODUCTS);
    activeProductType = product.productKind
      ? { label: product.productKind, turnIndex: event.turnIndex }
      : activeProductType;
  }

  for (const fact of event.factsMentioned ?? []) {
    const safeKey = memorySafeFactKey(fact.key);
    const existing = heardFacts[safeKey];
    heardFacts[safeKey] = {
      label: sanitizeMemoryText(fact.label, 60),
      firstMentionedTurn: existing?.firstMentionedTurn ?? event.turnIndex,
      lastMentionedTurn: event.turnIndex,
      mentionCount: (existing?.mentionCount ?? 0) + 1,
    };

    const productFact = productFactFromKey(fact.key);
    if (productFact) {
      // Attribute the fact to the product named in its key — never blanket
      // to lastMentionedProduct (multi-product replies would otherwise write
      // facts onto the wrong product).
      const factHash = productKeyHash(productFact.productId);
      const knownName = productConversations[factHash]?.spokenName
        ?? (lastMentionedProduct?.productKeyHash === factHash ? lastMentionedProduct.spokenName : 'Produkt');
      productConversations = upsertProductConversation(productConversations, {
        productKeyHash: factHash,
        spokenName: knownName,
        productKind: productConversations[factHash]?.productKind
          ?? (lastMentionedProduct?.productKeyHash === factHash ? lastMentionedProduct.productKind : null),
        turnIndex: event.turnIndex,
        factKind: productFact.factKind,
      });
    }
  }

  const sentLinkHashes = { ...memory.sentLinkHashes };
  for (const link of event.linksSent ?? []) {
    sentLinkHashes[hashValue(link.url)] = {
      label: sanitizeMemoryText(link.label, 80),
      sentTurn: event.turnIndex,
    };
  }

  // A wind-down turn can come from ANY path (deterministic smalltalk sets the
  // flag; MODEL turns phrase the same thing without it — live 2026-07-04 the
  // streak broke on a model wind-down and the closing loop repeated 3x).
  // Derive it from the text as well: a product-free turn ending in the
  // canonical closing question counts.
  const windDown = event.windDown === true || (
    !event.lastProduct
    && (event.productsMentioned?.length ?? 0) === 0
    && /\b(?:kann ich (?:ihnen )?sonst noch|wenn sie sp(?:ä|ae)ter noch etwas brauchen|dann lasse ich es dabei)\b/i.test(event.text)
  );

  // Record what link the agent just OFFERED (question or statement form). A
  // turn that actually SENT a link resolves any pending offer; a wind-down
  // (offer declined) clears it; a non-offer turn ("Wie bitte?") keeps it, so
  // "Ja, schick, gerne." after a repair still finds the right target.
  const pendingLinkOffer = (event.linksSent?.length ?? 0) > 0 || windDown
    ? null
    : detectAgentLinkOffer(event.text, lastMentionedProduct?.spokenName ?? null, event.turnIndex)
      ?? memory.pendingLinkOffer;

  // The caller declined this product — cap-bounded, inflection-tolerant dedupe.
  let rejectedProducts = memory.rejectedProducts;
  if (event.rejectedProduct) {
    const label = sanitizeMemoryText(event.rejectedProduct, 80);
    rejectedProducts = [
      ...rejectedProducts.filter((r) => r.label !== label),
      { label, turnIndex: event.turnIndex },
    ].slice(-MAX_REJECTED_PRODUCTS);
  }

  return {
    ...withNoEndCall(memory),
    heardFacts: capHeardFacts(heardFacts),
    sentLinkHashes: capRecord(sentLinkHashes, MAX_SENT_LINKS, (entry) => entry.sentTurn),
    lastMentionedProduct,
    recentProducts,
    productConversations: capRecord(productConversations, MAX_PRODUCT_CONVERSATIONS, (entry) => entry.lastMentionedTurn),
    activeProductType,
    lastAgentQuestion: event.lastAgentQuestion
      ? sanitizeMemoryText(event.lastAgentQuestion, 160)
      : memory.lastAgentQuestion,
    pendingLinkOffer,
    // Refreshed EVERY agent turn (unlike lastAgentQuestion, which persists for
    // the offer logic) — the turn-taking pendingQuestion escape needs the truth
    // about the IMMEDIATELY preceding turn.
    askedQuestionLastTurn: Boolean(event.lastAgentQuestion),
    rejectedProducts,
    profiPriceDisclosureGiven: memory.profiPriceDisclosureGiven || event.profiPriceDisclosureGiven === true,
    // A wind-down turn stacks; ANY other agent turn breaks the streak. A turn
    // that names a product re-opens the topic; a wind-down closes it.
    windDownStreak: windDown ? memory.windDownStreak + 1 : 0,
    topicClosed: windDown
      ? true
      : event.lastProduct || (event.productsMentioned?.length ?? 0) > 0
        ? false
        : memory.topicClosed,
  };
}

function reduceUserAudio(
  memory: DrkallaShortTermVoiceMemory,
  event: Extract<DrkallaShortTermMemoryEvent, { type: 'user_audio' }>,
): DrkallaShortTermVoiceMemory {
  if (event.audioState === 'inaudible') {
    return {
      ...withNoEndCall(memory),
      inaudibleStreak: memory.inaudibleStreak + 1,
      silenceMs: 0,
    };
  }
  if (event.audioState === 'silence') {
    const silenceMs = event.silenceMs ?? memory.silenceMs;
    return {
      ...memory,
      inaudibleStreak: 0,
      silenceMs,
      endCallEligible: silenceMs >= 40_000,
      endCallReason: silenceMs >= 40_000 ? 'long_silence' : null,
    };
  }
  const text = event.text.trim();
  const hangupComplaint = HANGUP_COMPLAINT.test(text);
  const clearFarewell = (FAREWELL.test(text) || hangupComplaint)
    && !ACK_ONLY.test(text)
    && (!NOT_FAREWELL.test(text) || hangupComplaint)
    && (hangupComplaint || !/\?\s*$/.test(text));
  const clearsPending = text.length > 0 && !ACK_ONLY.test(text);
  const userProductType = detectUserProductType(text);

  let productConversations = memory.productConversations;
  let lastMentionedProduct = memory.lastMentionedProduct;
  let recentProducts = memory.recentProducts;
  let mentionedProductKind: string | null = null;
  for (const mention of (event.productsMentioned ?? []).slice(0, 2)) {
    const product = rememberedProduct(
      {
        spokenName: mention.spokenName,
        productId: mention.productId,
        productKind: mention.productKind ?? undefined,
      },
      event.turnIndex,
    );
    productConversations = upsertProductConversation(productConversations, {
      productKeyHash: product.productKeyHash,
      spokenName: product.spokenName,
      productKind: product.productKind,
      turnIndex: event.turnIndex,
    });
    lastMentionedProduct = product;
    recentProducts = [
      ...recentProducts.filter((item) => item.productKeyHash !== product.productKeyHash),
      product,
    ].slice(-MAX_RECENT_PRODUCTS);
    mentionedProductKind = product.productKind ?? mentionedProductKind;
  }

  // The caller stated a NEW product type (not a concrete product) that differs
  // from the active product's kind: drop the stale product so the funnel moves
  // to the new type instead of repeatedly offering the old product.
  const switchedType = Boolean(
    userProductType
    && !mentionedProductKind
    && lastMentionedProduct
    && (lastMentionedProduct.productKind ?? '').toLocaleLowerCase('de-DE')
      !== userProductType.toLocaleLowerCase('de-DE'),
  );
  if (switchedType) {
    // Only the ACTIVE product goes stale on a type switch. recentProducts stays:
    // wiping it emptied the discussed_products anti-repeat hint, so a caller who
    // returned to the earlier topic could get the identical pitch again.
    lastMentionedProduct = null;
  }

  // The caller's hair profile persists across the whole call (deliberately NOT
  // reset by switchedType — curly hair stays curly when the caller moves from
  // Shampoo to Maske). Inflection variants update one entry.
  let callerNeeds = memory.callerNeeds;
  const hairNeeds = detectCallerHairNeeds(text);
  if (hairNeeds.length) {
    const byKey = new Map(callerNeeds.map((n) => [callerNeedKey(n.label), n]));
    for (const label of hairNeeds) {
      byKey.set(callerNeedKey(label), { label: sanitizeMemoryText(label, 24), turnIndex: event.turnIndex });
    }
    callerNeeds = [...byKey.values()].slice(-MAX_CALLER_NEEDS);
  }

  // A caller turn that brings up a product/type/need re-opens a wound-down call.
  const reopensTopic = Boolean(
    userProductType || mentionedProductKind || (event.productsMentioned?.length ?? 0) > 0 || hairNeeds.length,
  );

  return {
    ...memory,
    pendingClarification: clearsPending ? null : memory.pendingClarification,
    // A switched product type makes a stale PRODUCT-link offer moot; a Profi/
    // category offer stays valid across a topic change.
    pendingLinkOffer: switchedType && memory.pendingLinkOffer?.kind === 'product'
      ? null
      : memory.pendingLinkOffer,
    productConversations: capRecord(productConversations, MAX_PRODUCT_CONVERSATIONS, (entry) => entry.lastMentionedTurn),
    lastMentionedProduct,
    recentProducts,
    activeProductType: userProductType
      ? { label: userProductType, turnIndex: event.turnIndex }
      : mentionedProductKind
        ? { label: mentionedProductKind, turnIndex: event.turnIndex }
        : memory.activeProductType,
    callerNeeds,
    topicClosed: reopensTopic ? false : memory.topicClosed,
    windDownStreak: reopensTopic ? 0 : memory.windDownStreak,
    inaudibleStreak: 0,
    silenceMs: 0,
    endCallEligible: clearFarewell,
    endCallReason: clearFarewell ? 'caller_farewell' : null,
  };
}

export function reduceDrkallaShortTermMemory(
  memory: DrkallaShortTermVoiceMemory,
  event: DrkallaShortTermMemoryEvent,
): DrkallaShortTermVoiceMemory {
  if (event.type === 'agent_spoke') return reduceAgentSpoke(memory, event);
  if (event.type === 'user_audio') return reduceUserAudio(memory, event);
  return {
    ...withNoEndCall(memory),
    pendingClarification: {
      kind: event.kind,
      prompt: sanitizeMemoryText(event.prompt, 180),
      options: (event.options ?? []).map((option) => sanitizeMemoryText(option, 60)).slice(0, 5),
      turnIndex: event.turnIndex,
    },
  };
}

/** The caller explicitly asks to repeat something — repeats are then allowed. */
export function isDrkallaRepeatRequest(text: string): boolean {
  return REPEAT_REQUEST.test(text);
}

export function isFactMentionAllowed(
  memory: DrkallaShortTermVoiceMemory,
  key: DrkallaMemoryFactKey,
  userText: string,
): boolean {
  if (!memory.heardFacts[memorySafeFactKey(key)]) return true;
  return REPEAT_REQUEST.test(userText);
}

export function getDrkallaProductConversationState(
  memory: DrkallaShortTermVoiceMemory,
  productIdOrName: string,
): DrkallaProductConversationState | null {
  const direct = memory.productConversations[productKeyHash(productIdOrName)];
  if (direct) return direct;
  const sanitized = sanitizeMemoryText(productIdOrName, 80).toLocaleLowerCase('de-DE');
  return Object.values(memory.productConversations).find((product) =>
    product?.spokenName.toLocaleLowerCase('de-DE') === sanitized
  ) ?? null;
}

export function isProductFactMentionAllowed(
  memory: DrkallaShortTermVoiceMemory,
  productIdOrName: string,
  factKind: DrkallaProductFactKind,
  userText: string,
): boolean {
  const state = getDrkallaProductConversationState(memory, productIdOrName);
  if (!state?.facts[factKind]) return true;
  return REPEAT_REQUEST.test(userText);
}

export function isLinkAlreadySent(memory: DrkallaShortTermVoiceMemory, url: string): boolean {
  return Boolean(memory.sentLinkHashes[hashValue(url)]);
}

export function shouldIncludeDrkallaProfiPriceDisclosure(
  memory: DrkallaShortTermVoiceMemory,
  productOrQuestionContext: string,
): boolean {
  if (memory.profiPriceDisclosureGiven) return false;
  return !PERFUME_PRICE_CONTEXT.test(productOrQuestionContext);
}

/**
 * Deterministic re-engagement when the caller has gone silent (Retell
 * reminder_required / no-input nudge). Sie-form, context-aware, never a model
 * call and never an end-call: a soft silence prompt must not hang up. The
 * count is the running reminder count for this call (1 = first nudge).
 */
export function nextDrkallaNoInputReminder(memory: DrkallaShortTermVoiceMemory, count: number): string {
  // A wound-down call must NOT resurrect the declined product ("Wir waren bei
  // Black Professional Line Sintesis. Soll ich dazu weitermachen?" came after
  // the caller had said Nein four times, real call 2026-06-30). Offer a
  // graceful exit instead.
  if (memory.topicClosed) {
    return 'Sind Sie noch dran? Wenn Sie nichts mehr brauchen, wünsche ich Ihnen einen schönen Tag.';
  }
  if (count >= 2) {
    return 'Ich höre gerade nichts von Ihnen. Melden Sie sich gern wieder, wenn Sie so weit sind.';
  }
  if (memory.lastMentionedProduct) {
    return `Sind Sie noch dran? Wir waren bei ${memory.lastMentionedProduct.spokenName}. Soll ich dazu weitermachen?`;
  }
  if (memory.activeProductType) {
    return `Sind Sie noch in der Leitung? Es ging um ${memory.activeProductType.label}. Wie kann ich Ihnen weiterhelfen?`;
  }
  return 'Sind Sie noch in der Leitung? Wobei darf ich Ihnen helfen — Produkt, Bestellung oder Kontakt?';
}

export function nextInaudibleRepair(memory: DrkallaShortTermVoiceMemory): string {
  if (memory.inaudibleStreak <= 1) {
    return 'Wie bitte?';
  }
  if (memory.pendingClarification && memory.inaudibleStreak === 2) {
    return `Ich habe es akustisch nicht verstanden. ${memory.pendingClarification.prompt}`;
  }
  if (memory.lastMentionedProduct && memory.inaudibleStreak === 2) {
    return `Ich habe es akustisch nicht verstanden. Bleiben wir bei ${memory.lastMentionedProduct.spokenName}?`;
  }
  if (memory.activeProductType && memory.inaudibleStreak === 2) {
    return `Ich habe es akustisch nicht verstanden. Geht es weiter um ${memory.activeProductType.label}?`;
  }
  if (memory.inaudibleStreak === 2) {
    return 'Ich habe es akustisch nicht verstanden. Geht es um ein Produkt, eine Bestellung oder Kontakt?';
  }
  return 'Die Verbindung ist gerade schwer zu verstehen. Sagen Sie es bitte noch einmal lauter und deutlicher.';
}

export function nextDrkallaProductFunnelAction(
  memory: DrkallaShortTermVoiceMemory,
  userText: string,
): DrkallaProductFunnelAction {
  const text = userText.toLocaleLowerCase('de-DE');
  if (memory.pendingClarification?.kind === 'product_variant') return 'clarify_variant';
  if (/\b(?:unterschied|vergleich|verglichen)\b/.test(text) && memory.recentProducts.length >= 2) {
    return 'compare_recent_products';
  }
  // An explicit Profi-price/Profi-Zugang question reopens the Profi link offer
  // even after the one-time normal-buyer disclosure was already given.
  if (
    /\bprofi[\s-]?(?:preis|preise|preisen|zugang|konditionen|rabatt)/.test(text)
    && (memory.lastMentionedProduct || memory.activeProductType)
  ) {
    return 'offer_product_or_profi_link';
  }
  if (/\b(?:marken|auswahl|welche habt|was habt)\b/.test(text) && memory.activeProductType) {
    return 'list_active_product_type_selection';
  }
  if (/\b(?:preis|kostet|kosten|teuer|euro)\b/.test(text) && memory.lastMentionedProduct) {
    return shouldIncludeDrkallaProfiPriceDisclosure(
      memory,
      `${memory.lastMentionedProduct.spokenName} ${memory.lastMentionedProduct.productKind ?? ''} ${text}`,
    )
      ? 'offer_product_or_profi_link'
      : 'offer_product_link';
  }
  if (/\b(?:kauf|kaufe|bestell|link|sms|schick|verf[üu]gbarkeit|wo bekomme)\b/.test(text) && memory.lastMentionedProduct) {
    return 'offer_product_link';
  }
  if (memory.lastMentionedProduct) return 'offer_product_link';
  return 'ask_goal_or_product_type';
}

export function buildDrkallaMemoryContext(memory: DrkallaShortTermVoiceMemory): string {
  const alreadySpoken = sortedKeys(memory.heardFacts);
  const activeProduct = memory.lastMentionedProduct
    ? getDrkallaProductConversationState(memory, memory.lastMentionedProduct.spokenName)
    : null;
  const activeProductFacts = activeProduct
    ? PRODUCT_FACT_ORDER.filter((fact) => activeProduct.facts[fact])
    : [];
  const parts = [
    'drkalla_memory_v1',
    'not_evidence=true',
    `already_spoken=${alreadySpoken.join(',') || 'none'}`,
    `links_sent=${Object.keys(memory.sentLinkHashes).length}`,
    `inaudible_streak=${memory.inaudibleStreak}`,
    `profi_price_disclosure_given=${memory.profiPriceDisclosureGiven}`,
  ];
  if (memory.lastMentionedProduct) parts.push(`active_product=${sanitizeMemoryText(memory.lastMentionedProduct.spokenName, 80)}`);
  if (memory.activeProductType) parts.push(`active_product_type=${sanitizeMemoryText(memory.activeProductType.label, 60)}`);
  // The caller's stated hair profile ("lockige", "trockenes") — the model must
  // tailor recommendations to it instead of forgetting it after one turn.
  if (memory.callerNeeds.length) parts.push(`caller_hair=${memory.callerNeeds.map((n) => sanitizeMemoryText(n.label, 24)).join(',')}`);
  if (memory.topicClosed) parts.push('topic_closed=true');
  if (activeProductFacts.length) parts.push(`product_facts=${activeProductFacts.join(',')}`);
  // Products already named this call, so the model can SEE what not to re-pitch
  // (live call: it re-offered the same Shampoo + its link several times). The
  // anti-repeat prompt rule references this list explicitly.
  const discussed = memory.recentProducts.map((p) => sanitizeMemoryText(p.spokenName, 40)).filter(Boolean);
  if (discussed.length) parts.push(`discussed_products=${discussed.join(',')}`);
  if (memory.pendingClarification) parts.push(`pending=${memory.pendingClarification.kind}`);
  // The OFFERED link target — the model must keep the referent ("Ja, schick"
  // after a Profi-Link offer means the Profi link, never a remembered product).
  if (memory.pendingLinkOffer) {
    parts.push(`pending_link=${memory.pendingLinkOffer.kind}:${sanitizeMemoryText(memory.pendingLinkOffer.label, 40)}`);
  }
  // Products the caller declined — the model must not re-offer them.
  if (memory.rejectedProducts.length) {
    parts.push(`avoid=${memory.rejectedProducts.map((r) => sanitizeMemoryText(r.label, 40)).join(',')}`);
  }
  if (memory.endCallEligible && memory.endCallReason) parts.push(`end_call_candidate=${memory.endCallReason}`);
  return parts.join('; ').slice(0, 550);
}

export function isDrkallaMemorySafeForModel(memory: DrkallaShortTermVoiceMemory): boolean {
  const text = JSON.stringify(memory);
  const hasRawValue = (pattern: RegExp) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  };
  return !hasRawValue(RAW_URL)
    && !hasRawValue(RAW_EMAIL)
    && !hasRawValue(RAW_PHONE)
    && !hasRawValue(RAW_OPERATIONAL_ID)
    && !hasRawValue(RAW_ORDER_ID)
    && !hasRawValue(RAW_ADDRESS)
    && !hasRawValue(TITLED_PERSON_NAME)
    && !hasRawValue(FOR_PERSON_NAME)
    && !hasRawValue(LEADING_PERSON_NAME);
}

export function isDrkallaMemoryLiveEffective(state: DrkallaRuntimeMemoryState): boolean {
  return state.mode === 'custom_runtime' && state.memoryContextInjected;
}
