/**
 * Deterministic category/need search over the DrKalla catalog snapshot.
 *
 * The product-name detector resolves a product the caller NAMES exactly; this
 * module answers the other half — "what do you have for Dauerwelle / blonde /
 * which brands?" — by matching the caller's content tokens against each
 * product's productType, tags and title. Without it the agent had nothing to
 * offer for open-ended needs and looped on clarifying questions (live call
 * 2026-06-13). Built once at startup; per-turn access is a pure in-memory scan
 * with no LLM/KB/network. Returns real product names only — never invents.
 */

export type DrkallaCatalogMatch = {
  productId: string;
  spokenName: string;
  productType: string | null;
  priceText: string | null;
};

export type DrkallaProductCatalogSearch = (text: string, limit?: number) => DrkallaCatalogMatch[];

export type DrkallaCatalogSearchRawProduct = {
  handle?: unknown;
  title?: unknown;
  productType?: unknown;
  tags?: unknown;
  variants?: unknown;
};

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('de-DE')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Function words + meta-words ("marke", "produkt") + shop/quality tags that
// must never drive a category match.
const STOPWORDS = new Set([
  'ich', 'sie', 'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'einen', 'einem', 'einer',
  'und', 'oder', 'mit', 'fuer', 'von', 'vom', 'zum', 'zur', 'auf', 'aus', 'bei', 'habt', 'haben',
  'hast', 'hat', 'suche', 'suchen', 'sucht', 'brauche', 'brauchen', 'moechte', 'moechten', 'will',
  'wollen', 'was', 'wer', 'wie', 'wo', 'wann', 'warum', 'welche', 'welcher', 'welches', 'kostet',
  'kosten', 'preis', 'preise', 'mir', 'mich', 'uns', 'euch', 'bitte', 'gerne', 'mal', 'noch',
  'auch', 'etwas', 'eigentlich', 'denn', 'schon', 'gibt', 'gibts', 'eure', 'euer', 'euren', 'ihr',
  'ist', 'sind', 'man', 'so', 'nur', 'mehr', 'zwei', 'drei', 'dann', 'also', 'okay', 'aber',
  'marke', 'marken', 'produkt', 'produkte', 'artikel', 'sortiment', 'empfehlen', 'empfiehlst',
  'empfehlung', 'haar', 'haare', 'haaren', 'meine', 'mein', 'machen', 'kann', 'koennen',
  // shop/quality tags that appear on nearly every product
  'dr', 'kalla', 'cosmetics', 'profi', 'salon', 'geeignet', 'sortiment',
]);

const SHADE_TOKEN = /^\d/; // drop bare size/shade tokens like "500", "100ml"

function contentTokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !SHADE_TOKEN.test(t));
}

function formatEuro(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} Euro`;
}

function priceTextFromVariants(variants: unknown): string | null {
  if (!Array.isArray(variants)) return null;
  const prices: number[] = [];
  for (const v of variants) {
    if (!v || typeof v !== 'object') continue;
    const p = Number(String((v as { price?: unknown }).price ?? '').replace(',', '.'));
    if (Number.isFinite(p) && p > 0) prices.push(p);
  }
  if (!prices.length) return null;
  const min = Math.min(...prices), max = Math.max(...prices);
  return min === max ? formatEuro(min) : `von ${formatEuro(min)} bis ${formatEuro(max)}`;
}

function cleanSpokenName(title: string): string {
  return title.replace(/^[^0-9A-Za-zÄÖÜäöüß]+/u, '').replace(/\s+/g, ' ').trim();
}

type IndexedProduct = {
  productId: string;
  spokenName: string;
  productType: string | null;
  priceText: string | null;
  available: number;
  catTokens: Set<string>; // productType + tags (category-level)
  allTokens: Set<string>; // + title (product-level)
};

export function buildDrkallaProductCatalogSearch(
  products: DrkallaCatalogSearchRawProduct[],
): DrkallaProductCatalogSearch {
  const indexed: IndexedProduct[] = [];
  for (const product of products) {
    if (typeof product?.handle !== 'string' || !product.handle) continue;
    if (typeof product.title !== 'string' || !product.title.trim()) continue;
    const productType = typeof product.productType === 'string' && product.productType.trim()
      ? product.productType.trim()
      : null;
    const tags = Array.isArray(product.tags)
      ? product.tags.filter((t): t is string => typeof t === 'string')
      : [];
    const catTokens = new Set<string>();
    for (const source of [productType ?? '', ...tags]) {
      for (const tok of contentTokens(source)) catTokens.add(tok);
    }
    const allTokens = new Set<string>(catTokens);
    for (const tok of contentTokens(product.title)) allTokens.add(tok);
    if (!allTokens.size) continue;
    let available = 0;
    if (Array.isArray(product.variants)) {
      for (const v of product.variants) {
        if (v && typeof v === 'object' && (v as { available?: unknown }).available === true) available += 1;
      }
    }
    indexed.push({
      productId: product.handle,
      spokenName: cleanSpokenName(product.title),
      productType,
      priceText: priceTextFromVariants(product.variants),
      available,
      catTokens,
      allTokens,
    });
  }

  return (text: string, limit = 4): DrkallaCatalogMatch[] => {
    const userTokens = [...new Set(contentTokens(text))];
    if (!userTokens.length) return [];
    const scored: Array<{ p: IndexedProduct; catHits: number; allHits: number }> = [];
    for (const p of indexed) {
      let catHits = 0;
      let allHits = 0;
      for (const t of userTokens) {
        if (p.catTokens.has(t)) catHits += 1;
        if (p.allTokens.has(t)) allHits += 1;
      }
      if (allHits === 0) continue;
      scored.push({ p, catHits, allHits });
    }
    if (!scored.length) return [];
    // Category-level matches (productType/tags) rank above title-only matches;
    // then more matched tokens, then in-stock variety. This surfaces real,
    // on-topic products for an open need.
    scored.sort((a, b) =>
      (b.catHits - a.catHits)
      || (b.allHits - a.allHits)
      || (b.p.available - a.p.available)
      || (b.p.spokenName.length - a.p.spokenName.length));
    return scored.slice(0, Math.max(1, limit)).map(({ p }) => ({
      productId: p.productId,
      spokenName: p.spokenName,
      productType: p.productType,
      priceText: p.priceText,
    }));
  };
}
