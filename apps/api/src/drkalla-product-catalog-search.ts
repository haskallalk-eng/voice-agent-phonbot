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
 *
 * Ranking weights a productType match far above a tag match and a tag match
 * above a title-only match, so a "Shampoo" need surfaces shampoos, not a comb
 * that merely carries a "lockiges Haar" tag (real-call failure 2026-06-13).
 * `shortName` is a speakable name (brand + type, no size/code/long title) for
 * the voice agent; the caller complained the full titles were unspeakable.
 */

export type DrkallaCatalogMatch = {
  productId: string;
  spokenName: string;
  shortName: string;
  productType: string | null;
  priceText: string | null;
  priceValue: number | null; // min variant price, for "cheapest" sorting
  score: number;
  categoryHit: boolean; // matched the productType or a tag (not title-only)
  typeHit: boolean;     // matched the productType itself (a clear category need)
};

export type DrkallaProductCatalogSearch = (text: string, limit?: number) => DrkallaCatalogMatch[];

export type DrkallaCatalogSearchRawProduct = {
  handle?: unknown;
  title?: unknown;
  productType?: unknown;
  tags?: unknown;
  vendor?: unknown;
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

// Speakable German money: low-latency neural TTS often has currency
// normalization OFF, so "9,00 Euro" surfaces as "neun Komma null null Euro".
// Pre-format to how Germans say it: "9 Euro" (whole), "11 Euro 99" (with cents,
// leading zero dropped so "9,05" reads "neun Euro fünf").
export function formatDrkallaPrice(value: number): string {
  const cents = Math.round(value * 100);
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `${euros} Euro` : `${euros} Euro ${rest}`;
}

function formatEuro(value: number): string {
  return formatDrkallaPrice(value);
}

function pricesFromVariants(variants: unknown): { text: string | null; min: number | null } {
  if (!Array.isArray(variants)) return { text: null, min: null };
  const prices: number[] = [];
  for (const v of variants) {
    if (!v || typeof v !== 'object') continue;
    const p = Number(String((v as { price?: unknown }).price ?? '').replace(',', '.'));
    if (Number.isFinite(p) && p > 0) prices.push(p);
  }
  if (!prices.length) return { text: null, min: null };
  const min = Math.min(...prices), max = Math.max(...prices);
  return { text: min === max ? formatEuro(min) : `von ${formatEuro(min)} bis ${formatEuro(max)}`, min };
}

function cleanSpokenName(title: string): string {
  return title.replace(/^[^0-9A-Za-zÄÖÜäöüß]+/u, '').replace(/\s+/g, ' ').trim();
}

// Size/volume/quantity tokens that make a spoken name long and unnatural.
const SIZE_RE = /\b\d+[.,]?\d*\s?(?:ml|milliliter|liter|gramm|gr|kg|stk|st(?:ü|ue)ck|cm|mm|prozent|%|x)\b/gi;

// A token a German voice cannot say as a word: an ALL-CAPS code (CLR, LCH, EDP,
// ARGENT, BARCELONA), a vowel-less consonant cluster (Lch, CLR), or a token with
// an embedded digit (B3-PLEX, 10in1). These read as letter-spelling and break
// prosody, so they are stripped from the spoken short name.
function isUnpronounceableToken(word: string): boolean {
  if (/\d/.test(word)) return true;                      // embedded digit code
  if (word.length >= 2 && /^[A-ZÄÖÜ]+$/.test(word)) return true; // ALL-CAPS code
  if (word.length >= 2 && !/[aeiouäöüy]/i.test(word)) return true; // no vowel
  return false;
}

/**
 * A short, speakable product name for voice: drop leading bullets, size/volume
 * tokens, numeric and unpronounceable codes, de-duplicate repeated words (e.g.
 * "Pro Pro") and keep the first few meaningful words. Falls back to the cleaned
 * title (without codes, else the raw clean title) if nothing speakable remains.
 * The caller said the full catalog titles ("... Haarmaske für häufige Haarpflege
 * 500 Ml", "ARGENT Glanz-Shampoo & B3-PLEX") were unspeakable.
 */
export function buildDrkallaShortName(title: string): string {
  // Titles often join two marketing phrases with & | / – — keep the first.
  const firstSegment = cleanSpokenName(title).split(/\s*[&|/–—]+\s*/)[0] ?? '';
  const base = firstSegment
    .replace(SIZE_RE, ' ')
    .replace(/\b\d{2,}\b/g, ' ')   // standalone numeric size/article codes
    // Drop quality-tier / shop-channel suffixes that read as noise on a voice
    // name ("Colorationscreme Haarfarbe Profi-Salonbedarf" -> "Colorationscreme
    // Haarfarbe"). These trail many titles WITHOUT a leading "&", so the
    // first-segment cut above does not remove them (real call 2026-06-15).
    .replace(/\bProfi-?\s?(?:Salonbedarf|Qualit(?:ä|ae)t|Friseurbedarf)\b/gi, ' ')
    .replace(/\b(?:Salonbedarf|Friseurbedarf|Salonqualit(?:ä|ae)t)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const seen = new Set<string>();
  const words: string[] = [];
  for (const w of base.split(' ')) {
    if (!w) continue;
    const key = w.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(w);
  }
  const speakable = words.filter((w) => !isUnpronounceableToken(w));
  // Prefer the code-free words; if stripping leaves nothing, keep the originals
  // so we never return an empty name.
  const chosen = speakable.length ? speakable : words;
  let short = chosen.slice(0, 4).join(' ').trim();
  if (short.length > 42) short = short.slice(0, 42).replace(/\s+\S*$/, '').trim();
  return short || cleanSpokenName(title);
}

type IndexedProduct = {
  productId: string;
  spokenName: string;
  shortName: string;
  productType: string | null;
  priceText: string | null;
  priceValue: number | null;
  available: number;
  typeTokens: Set<string>; // productType only (strongest signal)
  catTokens: Set<string>;  // productType + tags (category-level)
  allTokens: Set<string>;  // + title (product-level)
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
    const typeTokens = new Set<string>(contentTokens(productType ?? ''));
    const catTokens = new Set<string>(typeTokens);
    for (const tag of tags) {
      for (const tok of contentTokens(tag)) catTokens.add(tok);
    }
    // Brand/vendor tokens are category-level (×2): so "von Wella" / "haben Sie
    // L'Oréal?" finds the real Wella/L'Oréal products instead of the model
    // hallucinating "führen wir nicht" (real call 2026-06-15: Wella IS stocked
    // but the search ignored the vendor field). House-brand tokens (dr/kalla/
    // cosmetics) are stopwords, so only external brands add a signal here.
    const vendor = typeof product.vendor === 'string' ? product.vendor : '';
    for (const tok of contentTokens(vendor)) catTokens.add(tok);
    const allTokens = new Set<string>(catTokens);
    for (const tok of contentTokens(product.title)) allTokens.add(tok);
    if (!allTokens.size) continue;
    let available = 0;
    if (Array.isArray(product.variants)) {
      for (const v of product.variants) {
        if (v && typeof v === 'object' && (v as { available?: unknown }).available === true) available += 1;
      }
    }
    const prices = pricesFromVariants(product.variants);
    indexed.push({
      productId: product.handle,
      spokenName: cleanSpokenName(product.title),
      shortName: buildDrkallaShortName(product.title),
      productType,
      priceText: prices.text,
      priceValue: prices.min,
      available,
      typeTokens,
      catTokens,
      allTokens,
    });
  }

  return (text: string, limit = 4): DrkallaCatalogMatch[] => {
    const userTokens = [...new Set(contentTokens(text))];
    if (!userTokens.length) return [];
    const scored: Array<{ p: IndexedProduct; score: number; typeHits: number; catHits: number; allHits: number }> = [];
    for (const p of indexed) {
      let typeHits = 0;
      let catHits = 0;
      let allHits = 0;
      for (const t of userTokens) {
        if (p.typeTokens.has(t)) typeHits += 1;
        if (p.catTokens.has(t)) catHits += 1;
        if (p.allTokens.has(t)) allHits += 1;
      }
      if (allHits === 0) continue;
      // A productType match is the strongest "this is the right kind of product"
      // signal; a tag match is next; a title-only match is weakest. This keeps a
      // comb out of a shampoo result even when the comb carries a topical tag.
      const score = typeHits * 4 + (catHits - typeHits) * 2 + (allHits - catHits);
      scored.push({ p, score, typeHits, catHits, allHits });
    }
    if (!scored.length) return [];
    scored.sort((a, b) =>
      (b.score - a.score)
      || (b.catHits - a.catHits)
      || (b.p.available - a.p.available)
      || (a.p.shortName.length - b.p.shortName.length)); // shorter speakable name first
    // Two different products can share a spoken short name; for voice that reads
    // as "X und X", so keep only the first (highest-scored) of each spoken name.
    const seenSpoken = new Set<string>();
    const deduped = scored.filter((s) => {
      const key = s.p.shortName.toLocaleLowerCase('de-DE');
      if (seenSpoken.has(key)) return false;
      seenSpoken.add(key);
      return true;
    });
    return deduped.slice(0, Math.max(1, limit)).map(({ p, score, typeHits, catHits }) => ({
      productId: p.productId,
      spokenName: p.spokenName,
      shortName: p.shortName,
      productType: p.productType,
      priceText: p.priceText,
      priceValue: p.priceValue,
      score,
      categoryHit: catHits > 0,
      typeHit: typeHits > 0,
    }));
  };
}
