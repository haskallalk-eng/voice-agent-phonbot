import crypto from 'node:crypto';

/**
 * Catalog-backed structured product facts for the DrKalla custom runtime.
 * This is EVIDENCE (AGENTS.md "Own-KB structured facts" low-latency path),
 * distinct from short-term memory which must never carry fact values.
 * Built once at startup from the local catalog snapshot; per-turn access is
 * a pure in-memory lookup with no LLM, KB, network, or file IO.
 */

export type DrkallaProductEvidence = {
  productId: string;
  spokenName: string;
  productKind: string | null;
  brandName: string;
  priceText: string | null;
  variantCount: number;
  availableVariantCount: number;
  hasUrl: boolean;
  url?: string;
};

export type DrkallaProductEvidenceLookup = {
  byId(productId: string): DrkallaProductEvidence | null;
  byKeyHash(productKeyHash: string): DrkallaProductEvidence | null;
  size: number;
};

export type DrkallaRawCatalogProduct = {
  handle?: unknown;
  title?: unknown;
  vendor?: unknown;
  productType?: unknown;
  url?: unknown;
  variants?: unknown;
};

const HOUSE_BRAND = 'Dr.Kalla Cosmetics';
// Technical supplier labels are never customer-facing brands.
const SUPPLIER_VENDOR = /cj\s*dropshipping|aliexpress|alibaba|dropship/i;

// Must stay identical to the productKeyHash in drkalla-short-term-memory.ts
// so evidence stays resolvable for products remembered in earlier turns.
function productKeyHash(productIdOrName: string): string {
  return crypto.createHash('sha256').update(productIdOrName).digest('hex').slice(0, 16);
}

function cleanSpokenName(title: string): string {
  return title
    .replace(/^[^0-9A-Za-zÄÖÜäöüß]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatEuro(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} Euro`;
}

function priceTextFromVariants(variants: unknown): {
  priceText: string | null;
  variantCount: number;
  availableVariantCount: number;
} {
  if (!Array.isArray(variants)) return { priceText: null, variantCount: 0, availableVariantCount: 0 };
  const prices: number[] = [];
  let availableVariantCount = 0;
  for (const variant of variants) {
    if (!variant || typeof variant !== 'object') continue;
    const price = Number(String((variant as { price?: unknown }).price ?? '').replace(',', '.'));
    if (Number.isFinite(price) && price > 0) prices.push(price);
    if ((variant as { available?: unknown }).available === true) availableVariantCount += 1;
  }
  if (!prices.length) return { priceText: null, variantCount: variants.length, availableVariantCount };
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return {
    priceText: min === max ? formatEuro(min) : `von ${formatEuro(min)} bis ${formatEuro(max)}`,
    variantCount: variants.length,
    availableVariantCount,
  };
}

function brandNameFromVendor(vendor: unknown): string {
  if (typeof vendor !== 'string' || !vendor.trim()) return HOUSE_BRAND;
  if (SUPPLIER_VENDOR.test(vendor)) return HOUSE_BRAND;
  return vendor.trim();
}

export function buildDrkallaProductEvidenceLookup(
  products: DrkallaRawCatalogProduct[],
): DrkallaProductEvidenceLookup {
  const byId = new Map<string, DrkallaProductEvidence>();
  const byHash = new Map<string, DrkallaProductEvidence>();

  for (const product of products) {
    if (typeof product?.handle !== 'string' || !product.handle) continue;
    if (typeof product.title !== 'string' || !product.title.trim()) continue;
    const { priceText, variantCount, availableVariantCount } = priceTextFromVariants(product.variants);
    const evidence: DrkallaProductEvidence = {
      productId: product.handle,
      spokenName: cleanSpokenName(product.title),
      productKind: typeof product.productType === 'string' && product.productType.trim()
        ? product.productType.trim()
        : null,
      brandName: brandNameFromVendor(product.vendor),
      priceText,
      variantCount,
      availableVariantCount,
      hasUrl: typeof product.url === 'string' && product.url.startsWith('https://'),
      url: typeof product.url === 'string' && product.url.startsWith('https://') ? product.url : undefined,
    };
    byId.set(evidence.productId, evidence);
    byHash.set(productKeyHash(evidence.productId), evidence);
  }

  return {
    byId: (productId: string) => byId.get(productId) ?? null,
    byKeyHash: (hash: string) => byHash.get(hash) ?? null,
    size: byId.size,
  };
}

/**
 * Compact German evidence line for the model directives. Bounded so the
 * directive budget stays intact; never includes raw URLs (voice rule: no
 * URL read-outs; the link tool handles links).
 */
export function formatDrkallaProductEvidenceLine(evidence: DrkallaProductEvidence): string {
  const parts = [
    evidence.spokenName,
    evidence.productKind ? `Art ${evidence.productKind}` : null,
    `Marke ${evidence.brandName}`,
    evidence.priceText
      ? `Preis laut Shop-Datenstand ${evidence.priceText}`
      : 'Preis nicht im Datenstand',
    evidence.variantCount > 1 ? `${evidence.variantCount} Varianten` : null,
    // Never assert live stock from a snapshot: availability is day-current and
    // must be deferred to the website rather than spoken as fact.
    'Verfuegbarkeit tagesaktuell auf drkalla.com pruefen',
    evidence.hasUrl ? 'Produktlink vorhanden' : null,
  ].filter(Boolean);
  return `Evidence (Shop-Datenstand): ${parts.join('; ')}`.slice(0, 220);
}
