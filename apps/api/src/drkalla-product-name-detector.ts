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
  const uniqueAliases = [...aliasToProducts.entries()]
    .filter(([, products]) => products.size === 1)
    .map(([alias, products]) => ({ alias, productId: [...products][0] as string }))
    .sort((left, right) => right.alias.length - left.alias.length);

  return (text: string) => {
    const normalizedText = ` ${normalize(text)} `;
    if (normalizedText.trim().length < 6) return [];
    const found: DrkallaDetectedProduct[] = [];
    const seen = new Set<string>();
    for (const { alias, productId } of uniqueAliases) {
      if (found.length >= MAX_DETECTED_PRODUCTS) break;
      if (seen.has(productId)) continue;
      if (!normalizedText.includes(` ${alias} `)) continue;
      const product = productById.get(productId);
      if (!product) continue;
      seen.add(productId);
      found.push(product);
    }
    return found;
  };
}

const PRICE_MARKER = /\d+(?:[.,]\d{1,2})?\s*(?:euro|eur|€)|\bpreis\b[^.?!]*\d/i;
const SIZE_MARKER = /\b\d+\s*(?:ml|milliliter|liter|l|g|gramm|kg)\b/i;
const LINK_MARKER = /(?:produktlink|link)[^.?!]*\bsms\b|\bsms\b[^.?!]*(?:produktlink|link)/i;
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

function factKindsInText(text: string): Array<'price' | 'size' | 'link'> {
  const kinds: Array<'price' | 'size' | 'link'> = [];
  if (PRICE_MARKER.test(text)) kinds.push('price');
  if (SIZE_MARKER.test(text)) kinds.push('size');
  if (LINK_MARKER.test(text)) kinds.push('link');
  return kinds;
}

/**
 * Deterministically derive an agent_spoke memory event from the reply the
 * custom runtime is about to speak. Pure text analysis: no LLM call, no KB
 * call. Facts are attributed conservatively — to the single product detected
 * in the whole reply, or per sentence when two products are mentioned.
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
  if (detected.length <= 1 && primary) {
    for (const kind of factKindsInText(input.text)) {
      factsMentioned.push({ key: `product.${primary.productId}.${kind}`, label: kind });
    }
  } else if (detected.length > 1) {
    for (const sentence of input.text.split(/(?<=[.!?])\s+/)) {
      const inSentence = input.detectProducts?.(sentence) ?? [];
      if (inSentence.length !== 1) continue;
      const product = inSentence[0];
      if (!product) continue;
      for (const kind of factKindsInText(sentence)) {
        factsMentioned.push({ key: `product.${product.productId}.${kind}`, label: kind });
      }
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
    factsMentioned: factsMentioned.length ? factsMentioned : undefined,
    lastAgentQuestion: lastQuestionSentence(input.text),
    profiPriceDisclosureGiven: PROFI_DISCLOSURE_MARKER.test(input.text) || undefined,
  };
}
