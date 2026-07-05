/**
 * Central-knowledge pipeline (owner architecture 2026-07-05): website scrape
 * → central Postgres (canonical for all agents) → DETERMINISTIC derivation of
 * the voice agent's in-memory snapshots. These tests cover the pure pieces —
 * scrape validation (a broken scrape must never replace good data) and the
 * derive step (aliases patched, search/evidence/chunks rebuilt, deterministic).
 */
import { describe, expect, it } from 'vitest';
import { validateDrkallaCentralScrape } from '../drkalla-central-knowledge.js';
import { deriveDrkallaVoiceRuntimeFromSnapshot } from '../retell-drkalla-custom-llm-ws.js';

function product(handle: string, title: string, opts?: { price?: string; type?: string; description?: string }) {
  return {
    id: handle,
    title,
    handle,
    url: `https://drkalla.com/products/${handle}`,
    vendor: 'Dr.Kalla Cosmetics',
    productType: opts?.type ?? 'Shampoo',
    tags: [],
    description: opts?.description ?? `${title} ist ein Pflegeprodukt für professionelle Anwendung im Salon und zu Hause.`,
    variants: [{ id: `${handle}-v1`, title: 'Standard', price: opts?.price ?? '9.90', compareAtPrice: null, available: true, sku: null }],
    images: [],
  };
}

const PAGES = [
  { title: 'Versand', url: 'https://drkalla.com/policies/shipping-policy', text: 'Versandinformationen für alle Bestellungen im Shop, inklusive Lieferzeiten und Konditionen.' },
  { title: 'Widerruf', url: 'https://drkalla.com/policies/refund-policy', text: 'Widerrufsbelehrung mit vierzehn Tagen Widerrufsrecht für Verbraucherinnen und Verbraucher.' },
  { title: 'Kontakt', url: 'https://drkalla.com/pages/contact', text: 'Kontaktinformationen: Silbersteinstraße 83, 12051 Berlin, kontakt@drkalla.com, Montag bis Freitag.' },
];

function bigSnapshot(count: number) {
  return {
    products: Array.from({ length: count }, (_, i) => product(`produkt-${i}`, `Produkt ${i}`)),
    pages: PAGES,
  };
}

describe('central-knowledge scrape validation (bad scrapes never replace good data)', () => {
  it('accepts a healthy full scrape', () => {
    const v = validateDrkallaCentralScrape(bigSnapshot(400), 423);
    expect(v).toEqual({ ok: true, reasons: [] });
  });

  it('rejects a tiny scrape (Shopify hiccup / bot block)', () => {
    const v = validateDrkallaCentralScrape(bigSnapshot(12), 423);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(',')).toContain('too_few_products');
  });

  it('rejects a scrape that halved against the previous active state', () => {
    const v = validateDrkallaCentralScrape(bigSnapshot(150), 423);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(',')).toContain('shrunk_vs_previous');
  });

  it('rejects broken price coverage', () => {
    const snapshot = bigSnapshot(200);
    for (const p of snapshot.products.slice(0, 60)) p.variants = [{ ...p.variants[0]!, price: '' }];
    const v = validateDrkallaCentralScrape(snapshot, 200);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(',')).toContain('price_coverage');
  });

  it('rejects missing policy pages', () => {
    const snapshot = { ...bigSnapshot(200), pages: [] };
    const v = validateDrkallaCentralScrape(snapshot, 200);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(',')).toContain('too_few_pages');
  });
});

describe('deterministic voice derivation from the central snapshot', () => {
  const snapshot = {
    products: [
      product('locken-shampoo', 'Locken Shampoo', { type: 'Shampoo' }),
      product('neu-glaettkamm', 'Hitze-Glättkamm für präzise Styles', { type: 'Friseur-Tool', price: '22.11' }),
    ],
    pages: PAGES,
    scrapedAt: '2026-07-05T03:00:00.000Z',
  };
  const bakedAliasEntries = [
    // Curated entry for a product still live: survives WITH its aliases.
    { productId: 'locken-shampoo', spokenName: 'Locken Shampoo', productKind: 'Shampoo', url: 'https://drkalla.com/products/locken-shampoo', aliases: ['curly dream'] },
    // Curated entry for a product REMOVED from the shop: dropped.
    { productId: 'basis-schere', spokenName: 'Basis Schere', productKind: 'Friseur-Tool', aliases: [] },
  ];

  it('patches aliases (curated survive, dead drop, new products get exact-title entries)', async () => {
    const parts = await deriveDrkallaVoiceRuntimeFromSnapshot({ snapshot, bakedAliasEntries });
    const ids = parts.aliasEntries.map((e) => e.productId).sort();
    expect(ids).toEqual(['locken-shampoo', 'neu-glaettkamm']);
    expect(parts.aliasEntries.find((e) => e.productId === 'locken-shampoo')?.aliases).toEqual(['curly dream']);
    expect(parts.aliasEntries.find((e) => e.productId === 'neu-glaettkamm')?.aliases).toEqual([]);
  });

  it('rebuilds search + evidence + knowledge chunks from the snapshot', async () => {
    const parts = await deriveDrkallaVoiceRuntimeFromSnapshot({ snapshot, bakedAliasEntries });
    const hits = parts.catalogSearch?.('Habt ihr einen Hitze-Glättkamm?', 3) ?? [];
    expect(hits[0]?.productId).toBe('neu-glaettkamm');
    expect(parts.evidenceLookup?.byId('neu-glaettkamm')?.url).toBe('https://drkalla.com/products/neu-glaettkamm');
    // Product descriptions + policy pages become retriever chunks.
    expect(parts.knowledgeRetriever?.('Wie lange habe ich Widerrufsrecht?')?.hits.length ?? 0).toBeGreaterThan(0);
  });

  it('derives DETERMINISTICALLY (same input, same result)', async () => {
    const a = await deriveDrkallaVoiceRuntimeFromSnapshot({ snapshot, bakedAliasEntries });
    const b = await deriveDrkallaVoiceRuntimeFromSnapshot({ snapshot, bakedAliasEntries });
    expect(a.aliasEntries).toEqual(b.aliasEntries);
    expect(a.catalogSearch?.('Shampoo', 3).map((h) => h.productId)).toEqual(
      b.catalogSearch?.('Shampoo', 3).map((h) => h.productId),
    );
  });
});
