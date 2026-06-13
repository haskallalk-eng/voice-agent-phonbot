import { detectDrkallaUserProductType } from './drkalla-product-type-detector.js';

export type DrkallaProductNameEntry = {
  productId: string;
  spokenName: string;
  productKind: string | null;
  url?: string;
  aliases: string[];
};

export type DrkallaDetectedProduct = {
  productId: string;
  spokenName: string;
  productKind: string | null;
  url?: string;
};

export type DrkallaProductNameDetector = (text: string) => DrkallaDetectedProduct[];

// Shop/company context must never resolve to a single product (AGENTS weak spot:
// "Dr. Kalla / Dr. Color Cosmetics" is shop context, not a product brand).
const SHOP_CONTEXT_ALIAS = /^(?:dr\.?\s*kalla(?:\s+cosmetics)?|dr\.?\s*color(?:\s+cosmetics)?|doktor\s+(?:kalla|color)|drkalla(?:\.com)?|profi[\s-]?sortiment|salon\s+geeignet)$/i;

const MAX_DETECTED_PRODUCTS = 2;

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('de-DE')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSpecificAlias(alias: string, normalized: string): boolean {
  if (!normalized || normalized.length < 6) return false;
  if (SHOP_CONTEXT_ALIAS.test(alias.trim())) return false;
  const isSingleWord = !normalized.includes(' ');
  if (isSingleWord && normalized.length < 8) return false;
  // A single word that the product-type detector already understands is a
  // category-level request ("Haarspray"), not a product name.
  if (isSingleWord && detectDrkallaUserProductType(alias) !== null) return false;
  return true;
}

// German function/filler words that must never count as a product-name token.
const TOKEN_STOPWORDS = new Set([
  'ich', 'sie', 'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'einen', 'einem', 'einer',
  'und', 'oder', 'mit', 'fuer', 'von', 'vom', 'zum', 'zur', 'auf', 'aus', 'bei', 'habt', 'haben',
  'hast', 'hat', 'suche', 'suchen', 'sucht', 'brauche', 'brauchen', 'moechte', 'moechten', 'will',
  'wollen', 'was', 'wer', 'wie', 'wo', 'wann', 'warum', 'welche', 'welcher', 'welches', 'kostet',
  'kosten', 'preis', 'preise', 'mir', 'mich', 'uns', 'euch', 'bitte', 'gerne', 'mal', 'noch',
  'auch', 'etwas', 'eigentlich', 'denn', 'schon', 'gibt', 'gibts', 'eure', 'euer', 'euren', 'ihr',
  'ist', 'sind', 'man', 'so', 'nur', 'mehr', 'ein', 'zwei', 'drei', 'dann', 'also', 'okay', 'aber',
]);
// Shop/company tokens that are never distinctive product tokens.
const SHOP_TOKENS = new Set(['dr', 'kalla', 'cosmetics', 'doktor', 'drkalla', 'shop', 'team']);
// At least 2 matched tokens to even consider a partial name (a single generic
// word never matches). Auto-resolution to one product needs >=3 distinctive
// tokens: 2-token brand+line is too collision-prone for a sales agent
// (wrong price/link), so 2-token multi-matches become a variant clarification.
const MIN_SUBSET_TOKENS = 2;

function contentTokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((token) => token.length >= 3 && !TOKEN_STOPWORDS.has(token));
}

/**
 * Distinctive token set built from the product's actual spoken name only
 * (not aliases, which are broad), minus shop/company tokens. Used for the
 * precision-controlled partial-name match.
 */
function productNameTokenSet(spokenName: string): Set<string> {
  return new Set(
    contentTokens(spokenName).filter((token) => !SHOP_TOKENS.has(token)),
  );
}

function titleCase(tokens: string[]): string {
  return tokens.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(' ');
}

type ProductTokenEntry = { product: DrkallaDetectedProduct; tokens: Set<string> };

function buildProductTokenIndex(entries: DrkallaProductNameEntry[]): {
  tokenEntries: ProductTokenEntry[];
  vocab: Set<string>;
} {
  const tokenEntries: ProductTokenEntry[] = [];
  const vocab = new Set<string>();
  for (const entry of entries) {
    if (!entry.productId || !entry.spokenName) continue;
    const tokens = productNameTokenSet(entry.spokenName);
    if (!tokens.size) continue;
    for (const t of tokens) vocab.add(t);
    tokenEntries.push({
      product: { productId: entry.productId, spokenName: entry.spokenName, productKind: entry.productKind ?? null, url: entry.url },
      tokens,
    });
  }
  return { tokenEntries, vocab };
}

/**
 * Partial-name candidates: products whose distinctive name tokens are a
 * superset of every catalog-known content token the caller said. Requires at
 * least MIN_SUBSET_TOKENS so a single generic word cannot trigger a match.
 */
function subsetCandidates(
  text: string,
  index: { tokenEntries: ProductTokenEntry[]; vocab: Set<string> },
): { candidates: ProductTokenEntry[]; userTokens: string[] } {
  const userTokens = [...new Set(contentTokens(text).filter((t) => index.vocab.has(t)))];
  if (userTokens.length < MIN_SUBSET_TOKENS) return { candidates: [], userTokens };
  const candidates = index.tokenEntries.filter((entry) => userTokens.every((t) => entry.tokens.has(t)));
  return { candidates, userTokens };
}

export function buildDrkallaProductNameDetector(
  entries: DrkallaProductNameEntry[],
): DrkallaProductNameDetector {
  const aliasToProducts = new Map<string, Set<string>>();
  const productById = new Map<string, DrkallaDetectedProduct>();

  for (const entry of entries) {
    if (!entry.productId || !entry.spokenName) continue;
    productById.set(entry.productId, {
      productId: entry.productId,
      spokenName: entry.spokenName,
      productKind: entry.productKind ?? null,
      url: entry.url,
    });
    const candidates = [entry.spokenName, ...entry.aliases];
    for (const alias of candidates) {
      if (typeof alias !== 'string') continue;
      const normalized = normalize(alias);
      if (!isSpecificAlias(alias, normalized)) continue;
      const existing = aliasToProducts.get(normalized) ?? new Set<string>();
      existing.add(entry.productId);
      aliasToProducts.set(normalized, existing);
    }
  }

  // Aliases shared by more than one product are brand/line/type level
  // ("Koleston", "Evelon Pro") and must not resolve to a single product.
  // Pre-padded for the containment check so the per-turn scan allocates
  // nothing per alias.
  const uniqueAliases = [...aliasToProducts.entries()]
    .filter(([, products]) => products.size === 1)
    .map(([alias, products]) => ({ padded: ` ${alias} `, productId: [...products][0] as string }))
    .sort((left, right) => right.padded.length - left.padded.length);

  return (text: string) => {
    const normalizedText = ` ${normalize(text)} `;
    if (normalizedText.trim().length < 6) return [];
    const found: DrkallaDetectedProduct[] = [];
    const seen = new Set<string>();
    for (const { padded, productId } of uniqueAliases) {
      if (found.length >= MAX_DETECTED_PRODUCTS) break;
      if (seen.has(productId)) continue;
      if (!normalizedText.includes(padded)) continue;
      const product = productById.get(productId);
      if (!product) continue;
      seen.add(productId);
      found.push(product);
    }
    // The fuzzy partial-name (token-subset) path deliberately NEVER auto-
    // resolves a specific product: against the real catalog (messy aliases,
    // translation duplicates, shared product lines) partial matches collide,
    // and a wrong price/link is far worse than a clarifying question. Partial
    // matches are surfaced only as a variant clarification by the ambiguous
    // detector. Specific products still resolve here via the exact unique-alias
    // pass above (i.e. the caller spoke the full product name).
    return found;
  };
}

export type DrkallaAmbiguousProductNameHit = {
  label: string;
  productCount: number;
};

export type DrkallaAmbiguousProductNameDetector = (text: string) => DrkallaAmbiguousProductNameHit | null;

/**
 * Detects product names that are shared by multiple catalog products
 * (duplicate spoken names fall out of the unique-alias product detector).
 * Instead of silent zero detection the runtime can ask a variant question.
 */
export function buildDrkallaAmbiguousProductNameDetector(
  entries: DrkallaProductNameEntry[],
): DrkallaAmbiguousProductNameDetector {
  const nameToProducts = new Map<string, { label: string; products: Set<string> }>();
  for (const entry of entries) {
    if (!entry.productId || !entry.spokenName) continue;
    const normalized = normalize(entry.spokenName);
    if (!isSpecificAlias(entry.spokenName, normalized)) continue;
    const existing = nameToProducts.get(normalized) ?? { label: entry.spokenName, products: new Set<string>() };
    existing.products.add(entry.productId);
    nameToProducts.set(normalized, existing);
  }
  const ambiguous = [...nameToProducts.entries()]
    .filter(([, value]) => value.products.size > 1)
    .map(([normalized, value]) => ({ padded: ` ${normalized} `, label: value.label, productCount: value.products.size }))
    .sort((left, right) => right.padded.length - left.padded.length);

  const index = buildProductTokenIndex(entries);

  return (text: string) => {
    const normalizedText = ` ${normalize(text)} `;
    if (normalizedText.trim().length < 6) return null;
    for (const candidate of ambiguous) {
      if (normalizedText.includes(candidate.padded)) {
        return { label: candidate.label, productCount: candidate.productCount };
      }
    }
    // Partial brand/line ("Koleston Perfect") that matches several SKUs:
    // surface as ambiguous so the runtime asks which variant rather than
    // guessing one.
    const { candidates, userTokens } = subsetCandidates(text, index);
    if (candidates.length > 1) {
      return { label: titleCase(userTokens), productCount: candidates.length };
    }
    return null;
  };
}

export type DrkallaProductNameCoverageReport = {
  totalProducts: number;
  detectableBySpokenName: number;
  undetectableProductIds: string[];
};

/**
 * Reports which catalog products cannot be detected by speaking their own
 * spokenName (duplicate or too-generic names fall out of the unique-alias
 * rule). Diagnostic for KB/alias curation; not a runtime path.
 */
export function reportDrkallaProductNameDetectorCoverage(
  entries: DrkallaProductNameEntry[],
): DrkallaProductNameCoverageReport {
  const detect = buildDrkallaProductNameDetector(entries);
  const undetectableProductIds: string[] = [];
  for (const entry of entries) {
    if (!entry.productId || !entry.spokenName) continue;
    const found = detect(`Ich suche ${entry.spokenName}.`);
    if (!found.some((product) => product.productId === entry.productId)) {
      undetectableProductIds.push(entry.productId);
    }
  }
  const totalProducts = entries.filter((entry) => entry.productId && entry.spokenName).length;
  return {
    totalProducts,
    detectableBySpokenName: totalProducts - undetectableProductIds.length,
    undetectableProductIds,
  };
}

const PRICE_MARKER = /\d+(?:[.,]\d{1,2})?\s*(?:euro|eur|€)|\bpreis\b[^.?!]*\d/i;
// Spelled-out German prices ("neunundneunzig Euro", "zwölf Euro fünfzig").
const SPELLED_PRICE_MARKER = /\b(?:ein|zwei|drei|vier|f(?:ü|ue)nf|sechs|sieben|acht|neun|zehn|elf|zw(?:ö|oe)lf|zwanzig|drei(?:ß|ss)ig|vierzig|f(?:ü|ue)nfzig|sechzig|siebzig|achtzig|neunzig|hundert)[a-zäöüß]*\s+euro\b/i;
const SIZE_MARKER = /\b\d+\s*(?:ml|milliliter|liter|l|g|gramm|kg)\b/i;
const LINK_MARKER = /(?:produktlink|link)[^.?!]*\bsms\b|\bsms\b[^.?!]*(?:produktlink|link)/i;
// A negated sentence ("kostet nicht ...", "kein 1 Liter", "folgt nicht per
// SMS") must never mark a fact as already answered: a wrong mark would block
// later legitimate answers, while a missed mark only risks repetition.
const NEGATION_MARKER = /\b(?:nicht|kein(?:e|en|em|er|s)?|nie|niemals|ohne|leider)\b/i;
const PROFI_DISCLOSURE_MARKER = /profi[\s-]?(?:friseur)?preise?\b[^.?!]*telefonisch[^.?!]*nicht|normale\s+k(?:ä|ae)ufer/i;

export type DrkallaDerivedAgentSpoke = {
  type: 'agent_spoke';
  turnIndex: number;
  text: string;
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
  factsMentioned?: Array<{ key: `product.${string}.${'price' | 'size' | 'link'}`; label: string }>;
  lastAgentQuestion?: string;
  profiPriceDisclosureGiven?: boolean;
};

function lastQuestionSentence(text: string): string | undefined {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    const sentence = sentences[i];
    if (sentence && sentence.endsWith('?')) return sentence;
  }
  return undefined;
}

function factKindsInSentence(sentence: string): Array<'price' | 'size' | 'link'> {
  if (NEGATION_MARKER.test(sentence)) return [];
  const kinds: Array<'price' | 'size' | 'link'> = [];
  if (PRICE_MARKER.test(sentence) || SPELLED_PRICE_MARKER.test(sentence)) kinds.push('price');
  if (SIZE_MARKER.test(sentence)) kinds.push('size');
  if (LINK_MARKER.test(sentence)) kinds.push('link');
  return kinds;
}

/**
 * Deterministically derive an agent_spoke memory event from the reply the
 * custom runtime is about to speak. Pure text analysis: no LLM call, no KB
 * call. Facts are extracted per sentence with a negation guard and attributed
 * to the product named in that sentence; sentences without a product name
 * attribute to the single overall product, never across two products.
 */
export function deriveDrkallaAgentSpokeEvent(input: {
  text: string;
  turnIndex: number;
  detectProducts?: DrkallaProductNameDetector;
  fallbackProduct?: { spokenName: string; productId?: string; productKind?: string | null };
}): DrkallaDerivedAgentSpoke {
  const detected = input.detectProducts?.(input.text) ?? [];
  const primary = detected[0]
    ?? (input.fallbackProduct
      ? {
          productId: input.fallbackProduct.productId ?? input.fallbackProduct.spokenName,
          spokenName: input.fallbackProduct.spokenName,
          productKind: input.fallbackProduct.productKind ?? null,
        }
      : undefined);

  const factsMentioned: NonNullable<DrkallaDerivedAgentSpoke['factsMentioned']> = [];
  for (const sentence of input.text.split(/(?<=[.!?])\s+/)) {
    const kinds = factKindsInSentence(sentence);
    if (!kinds.length) continue;
    const inSentence = input.detectProducts?.(sentence) ?? [];
    const target = inSentence.length === 1
      ? inSentence[0]
      : inSentence.length === 0 && detected.length <= 1
        ? primary
        : undefined;
    if (!target) continue;
    for (const kind of kinds) {
      factsMentioned.push({ key: `product.${target.productId}.${kind}`, label: kind });
    }
  }

  return {
    type: 'agent_spoke',
    turnIndex: input.turnIndex,
    text: input.text,
    lastProduct: primary
      ? {
          spokenName: primary.spokenName,
          productId: primary.productId,
          productKind: primary.productKind ?? undefined,
        }
      : undefined,
    productsMentioned: detected.length
      ? detected.map((product) => ({
          spokenName: product.spokenName,
          productId: product.productId,
          productKind: product.productKind,
        }))
      : undefined,
    factsMentioned: factsMentioned.length ? factsMentioned : undefined,
    lastAgentQuestion: lastQuestionSentence(input.text),
    profiPriceDisclosureGiven: PROFI_DISCLOSURE_MARKER.test(input.text) || undefined,
  };
}
