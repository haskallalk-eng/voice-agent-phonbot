import crypto from 'node:crypto';

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
  | `product.${string}.availability`;

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
export type DrkallaProductFactKind = 'description' | 'size' | 'price' | 'location' | 'availability';
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
      lastAgentQuestion?: string;
      linksSent?: Array<{
        url: string;
        label: string;
      }>;
      profiPriceDisclosureGiven?: boolean;
    }
  | {
      type: 'user_audio';
      turnIndex: number;
      text: string;
      audioState: DrkallaMemoryAudioState;
      silenceMs?: number;
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
  inaudibleStreak: number;
  silenceMs: number;
  endCallEligible: boolean;
  endCallReason: null | 'caller_farewell' | 'long_silence';
  profiPriceDisclosureGiven: boolean;
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
const REPEAT_REQUEST = /\b(?:(?:nochmal|noch mal)\s+(?:sagen|wiederholen|nennen|erkl[aä]ren|h[oö]ren)|wiederhol|sag.*noch|adresse nochmal|zeiten nochmal|(?:wie|was) war (?:der|die|das) (?:preis|name|link|adresse|uhrzeit|telefonnummer|nummer|produkt))\b/i;
const FAREWELL = /\b(?:tsch[uü]ss|ciao|auf wiederh[oö]ren|bis dann|sch[oö]nen tag noch|das war(?:'| e)?s|das war alles|nein danke,?\s+das war alles|leg auf|beende den anruf|du kannst auflegen)\b/i;
const ACK_ONLY = /^(?:alles klar|okay|ok|ja|genau|passt|danke)$/i;
const PERFUME_PRICE_CONTEXT = /\b(?:parfum|eau de parfum|duft|herrenduft|damenduft|unisexduft|edp|cologne|lattafa)\b/i;
const PRODUCT_FACT_KEY = /^product\.(.+)\.(description|size|price|location|availability)$/;
const PRODUCT_FACT_ORDER: DrkallaProductFactKind[] = ['description', 'size', 'price', 'location', 'availability'];
const MAX_HEARD_FACTS = 40;
const MAX_SENT_LINKS = 12;
const MAX_PRODUCT_CONVERSATIONS = 6;
const MAX_RECENT_PRODUCTS = 3;
const STATIC_FACT_KEYS = new Set<DrkallaStoredMemoryFactKey>([
  'contact.address',
  'contact.hours',
  'contact.email',
  'contact.phone',
  'route.hermannplatz',
  'product.last',
]);

function detectUserProductType(text: string): string | null {
  const normalized = text.toLocaleLowerCase('de-DE');
  if (/\b(?:farbentferner|farbentfernung(?:st(?:ü|ue)cher)?|farbe entfernen|color remover|remover)\b/u.test(normalized)) {
    return 'Farbentferner';
  }
  if (/\b(?:blondierung(?:en)?|blondierpulver|bleichpulver|aufheller|blondieren)\b/u.test(normalized)) {
    return 'Blondierung';
  }
  if (/\b(?:haargl(?:ä|ae)ttung|gl(?:ä|ae)ttung|gl(?:ä|ae)ttungscreme|keratin|haare? gl(?:ä|ae)tten)\b/u.test(normalized)) {
    return 'Haarglättung';
  }
  if (/\b(?:farbkarten?|nuancenkarten?)\b/u.test(normalized)) {
    return 'Farbkarte';
  }
  if (/\b(?:haarfarben?|farbcremes?|color creams?|coloration|haare? f(?:ä|ae)rben|f(?:ä|ae)rben|farben?)\b/u.test(normalized)) {
    return 'Haarfarbe/Farbcreme';
  }
  if (/\b(?:entwickler|oxidant|wasserstoffperoxid|peroxid|prozentst(?:ä|ae)rke)\b/u.test(normalized)) {
    return 'Entwickler/Oxidant';
  }
  if (/\b(?:shampoos?|silbershampoo|anti[-\s]?(?:gelb|yellow|orange)\s*shampoo)\b/u.test(normalized)) {
    return 'Shampoo';
  }
  if (/\b(?:haarmasken?|masken?|kuren?|anti[-\s]?(?:gelb|yellow|orange)\s*(?:maske|mask))\b/u.test(normalized)) {
    return 'Haarmaske';
  }
  if (/\b(?:conditioner|sp(?:ü|ue)lungen?|pflegesp(?:ü|ue)lungen?)\b/u.test(normalized)) {
    return 'Conditioner/Spülung';
  }
  if (/\b(?:leave[-\s]?in|leave in)\b/u.test(normalized)) {
    return 'Leave-in';
  }
  if (/\b(?:haarserum|seren|serum|(?:öl|oel)[-\s]?serum)\b/u.test(normalized)) {
    return 'Serum';
  }
  if (/\b(?:pflege|anti gelb|anti orange)\b/u.test(normalized)) {
    return 'Haarpflege';
  }
  if (/\b(?:parfum|duft|eau de parfum|herrenduft|damenduft|unisexduft)\b/u.test(normalized)) {
    return 'Parfum/Duft';
  }
  if (/\b(?:haarspray|mousse|haargel|styling|wachs|pomade|dauerwellen?(?:l(?:ö|oe)sung|mittel)?|dauerwelle)\b/u.test(normalized)) {
    return 'Styling';
  }
  if (/\b(?:salonwagen|friseurwagen|rollwagen|arbeitswagen|wascheinheiten?|waschbecken|waschpl(?:ä|ae)tze?|waschplatz|r(?:ü|ue)ckw(?:ä|ae)rtswaschbecken|friseurst(?:ü|ue)hle?|friseurstuhl|barberst(?:ü|ue)hle?|barberstuhl|friseursessel|salonst(?:ü|ue)hle?|stuhl|salonm(?:ö|oe)bel|friseurm(?:ö|oe)bel|ablagen?|ablagetische?|stehmatten?)\b/u.test(normalized)) {
    return 'Salonmöbel/-ausstattung';
  }
  if (/\b(?:kamm|k(?:ä|ae)mme|b(?:ü|ue)rsten?|scheren?|friseurscheren?|haarscheren?|clipper|trimmer|friseurtools?|tools?|f(?:ä|ae)rbeschalen?|farbschalen?|f(?:ä|ae)rbepinsel|farbpinsel|alufolie|str(?:ä|ae)hnenfolie|f(?:ä|ae)rbefolie|gl(?:ä|ae)tteisen|haartrockner|f(?:ö|oe)hn|shaver|rasierer|barttrimmer|haartrimmer|haarschneidemaschinen?|schneidemaschinen?)\b/u.test(normalized)) {
    return 'Friseur-Tool';
  }
  return null;
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
    inaudibleStreak: 0,
    silenceMs: 0,
    endCallEligible: false,
    endCallReason: null,
    profiPriceDisclosureGiven: false,
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
      productConversations = upsertProductConversation(productConversations, {
        productKeyHash: lastMentionedProduct?.productKeyHash ?? productKeyHash(productFact.productId),
        spokenName: lastMentionedProduct?.spokenName ?? 'Produkt',
        productKind: lastMentionedProduct?.productKind ?? null,
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
    profiPriceDisclosureGiven: memory.profiPriceDisclosureGiven || event.profiPriceDisclosureGiven === true,
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
  const clearFarewell = FAREWELL.test(text) && !ACK_ONLY.test(text);
  const clearsPending = text.length > 0 && !ACK_ONLY.test(text);
  const userProductType = detectUserProductType(text);
  return {
    ...memory,
    pendingClarification: clearsPending ? null : memory.pendingClarification,
    activeProductType: userProductType
      ? { label: userProductType, turnIndex: event.turnIndex }
      : memory.activeProductType,
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

export function nextInaudibleRepair(memory: DrkallaShortTermVoiceMemory): string {
  if (memory.inaudibleStreak <= 1) {
    return 'Wie bitte? Ich habe dich gerade schlecht verstanden. Suchst du ein Produkt, eine Kategorie oder Bestellung?';
  }
  if (memory.pendingClarification && memory.inaudibleStreak === 2) {
    return `Ich habe dich akustisch nicht verstanden. ${memory.pendingClarification.prompt}`;
  }
  if (memory.lastMentionedProduct && memory.inaudibleStreak === 2) {
    return `Ich habe dich akustisch nicht verstanden. Bleiben wir bei ${memory.lastMentionedProduct.spokenName}?`;
  }
  if (memory.activeProductType && memory.inaudibleStreak === 2) {
    return `Ich habe dich akustisch nicht verstanden. Geht es weiter um ${memory.activeProductType.label}?`;
  }
  if (memory.inaudibleStreak === 2) {
    return 'Sag bitte nur ein Stichwort: Produkt, Kategorie, Bestellung oder Kontakt.';
  }
  return 'Die Verbindung ist gerade schwer zu verstehen. Sag bitte etwas lauter ein Stichwort.';
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
  if (activeProductFacts.length) parts.push(`product_facts=${activeProductFacts.join(',')}`);
  if (memory.pendingClarification) parts.push(`pending=${memory.pendingClarification.kind}`);
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
