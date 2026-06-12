import { describe, expect, it } from 'vitest';
import { runDrkallaKbQualityAudit } from '../drkalla-kb-quality-audit.js';
import type { DrkallaKnowledgeSnapshot, DrkallaProduct } from '../drkalla-rag-agent.js';

function productFixture(overrides: Partial<DrkallaProduct> = {}): DrkallaProduct {
  return {
    id: overrides.id ?? 'product-1',
    title: overrides.title ?? 'Sintesis Color Cream 7.43 Kupferblond 100 ml',
    handle: overrides.handle ?? 'sintesis-color-cream-743-kupferblond',
    url: overrides.url ?? 'https://drkalla.com/products/sintesis-color-cream-743-kupferblond',
    vendor: overrides.vendor ?? 'Dr.Kalla Cosmetics',
    productType: overrides.productType ?? 'Color Cream',
    tags: overrides.tags ?? ['friseurbedarf'],
    description: overrides.description ?? 'Synthetic product fixture.',
    variants: overrides.variants ?? [
      {
        id: 'variant-1',
        title: 'Standard',
        price: '9.99',
        compareAtPrice: null,
        available: true,
        sku: null,
      },
    ],
    images: overrides.images ?? [
      {
        src: 'https://cdn.shopify.com/example/product.jpg',
        alt: null,
      },
    ],
  };
}

function snapshotFixture(products: DrkallaProduct[]): DrkallaKnowledgeSnapshot {
  return {
    scrapedAt: '2026-06-10T10:00:00.000Z',
    source: 'https://drkalla.com',
    productCount: products.length,
    products,
    pages: [],
    categories: ['Color Cream', 'Shampoo', 'Eau de Parfum'],
    vendors: ['Dr.Kalla Cosmetics', "L'Oreal Professionnel Paris", 'Lattafa'],
  };
}

describe('DrKalla KB quality audit', () => {
  it('runs exactly 1000 expert-perspective cases and separates hard failures from warnings', () => {
    const report = runDrkallaKbQualityAudit({
      cases: 1000,
      seed: 'test-audit',
      snapshot: snapshotFixture([
        productFixture(),
        productFixture({
          id: 'loreal-inoa',
          title: "L'Oréal Inoa Haarfärbemittel 6.8 Ammoniakfrei 60g",
          handle: 'dye-no-ammonia-loreal-professionnel-paris-inoa-n-68-60-g',
          vendor: "L'Oreal Professionnel Paris",
          productType: 'Haarfärbemittel',
          url: 'https://drkalla.com/products/dye-no-ammonia-loreal-professionnel-paris-inoa-n-68-60-g',
          images: [{ src: 'https://cdn.shopify.com/example/loreal.jpg', alt: 'L Oreal Inoa Produktbild' }],
        }),
        productFixture({
          id: 'lattafa',
          title: 'Lattafa Fakhar for Men Eau de Parfum 100 ml',
          handle: 'lattafa-fakhar-for-men',
          vendor: 'Lattafa',
          productType: 'Eau de Parfum',
          url: 'https://drkalla.com/products/lattafa-fakhar-for-men',
        }),
      ]),
    });

    expect(report.totalCases).toBe(1000);
    expect(report.failed).toBe(0);
    expect(report.blockers).toEqual([]);
    expect(report.warnings).not.toContain('image_url_available_but_alt_text_missing');
    expect(report.catalog.imageAltCoveragePercent).toBe(100);
    expect(report.catalog.externalBrands).toEqual(["L'Oreal Professionnel Paris", 'Lattafa']);
    expect(report.catalog.customerBrands).toEqual(['Dr.Kalla Cosmetics', "L'Oreal Professionnel Paris", 'Lattafa']);
    expect(report.catalog.shopProviderLabels).toEqual(['Dr.Kalla Cosmetics']);
    expect(report.byExpert.brand_expert.total).toBe(100);
    expect(report.byExpert.conversation_context_expert.total).toBe(100);
  });

  it('does not classify a shop provider as an external brand', () => {
    const report = runDrkallaKbQualityAudit({
      cases: 1000,
      seed: 'bad-brand',
      snapshot: snapshotFixture([
        productFixture({
          vendor: 'Dr.Kalla Cosmetics',
          title: 'Anti-Frizz-Oil Shampoo',
          productType: 'Shampoo',
        }),
      ]),
    });

    expect(report.failed).toBe(0);
    expect(report.blockers).not.toContain('shop_provider_leaked_as_external_brand');
  });

  it('recognizes a real brand from the title when the vendor field is missing', () => {
    const report = runDrkallaKbQualityAudit({
      cases: 1000,
      seed: 'title-brand',
      snapshot: snapshotFixture([
        productFixture({
          id: 'wella-koleston',
          vendor: '',
          title: 'Wella Koleston Perfect Pure naturalis 60 ml',
          productType: '',
          handle: 'wella-koleston-perfect-pure-naturalis-60-ml',
        }),
      ]),
    });

    expect(report.failed).toBe(0);
    expect(report.catalog.externalBrands).toEqual(['Wella']);
    expect(report.catalog.customerBrands).toEqual(['Wella']);
    expect(report.catalog.productKinds).toContain('Haarfarbe/Farbcreme');
    expect(report.catalog.shopProviderLabels).toEqual([]);
  });
});
