import { describe, expect, it } from 'vitest';
import {
  DRKALLA_RAG_BEGIN_MESSAGE,
  DRKALLA_RAG_KB_CONFIG,
  DRKALLA_RAG_PROMPT,
  buildDrkallaProductVoiceName,
  buildDrkallaProductCatalogEntries,
  buildDrkallaKnowledgeTexts,
  formatDrkallaProductFact,
  type DrkallaProduct,
  type DrkallaKnowledgeSnapshot,
} from '../drkalla-rag-agent.js';

function productFixture(overrides: Partial<DrkallaProduct> = {}): DrkallaProduct {
  return {
    id: 1,
    title: 'Test Produkt',
    handle: 'test-produkt',
    url: 'https://drkalla.com/products/test-produkt',
    vendor: 'Dr.Kalla Cosmetics',
    productType: 'Haarpflege',
    tags: ['test'],
    description: 'Ein oeffentliches Shop-Produkt fuer Friseurbedarf.',
    variants: [
      {
        id: 'variant-1',
        title: 'Standard',
        price: '9.99',
        compareAtPrice: null,
        available: true,
        sku: 'SKU-1',
      },
    ],
    ...overrides,
  };
}

function snapshotWithProducts(count: number): DrkallaKnowledgeSnapshot {
  return {
    scrapedAt: '2026-05-31T12:00:00.000Z',
    source: 'https://drkalla.com',
    productCount: count,
    categories: ['Haarpflege', 'Salonbedarf'],
    vendors: ['Black Professional Line'],
    pages: [
      {
        title: 'Kontakt',
        url: 'https://drkalla.com/pages/contact',
        text: 'Silbersteinstrasse 83, 12051 Berlin. Montag bis Freitag 10 bis 18 Uhr.',
      },
    ],
    products: Array.from({ length: count }, (_, i) => productFixture({
      id: i + 1,
      title: `Test Produkt ${i + 1}`,
      handle: `test-produkt-${i + 1}`,
      url: `https://drkalla.com/products/test-produkt-${i + 1}`,
      vendor: 'Black Professional Line',
      productType: i % 2 === 0 ? 'Haarpflege' : 'Salonbedarf',
      tags: ['friseurbedarf', 'test'],
      variants: [
        {
          id: `variant-${i + 1}`,
          title: 'Standard',
          price: '9.99',
          compareAtPrice: null,
          available: true,
          sku: `SKU-${i + 1}`,
        },
      ],
    })),
  };
}

describe('DrKalla RAG voice agent contract', () => {
  it('uses a shop-focused greeting and not a salon appointment greeting', () => {
    expect(DRKALLA_RAG_BEGIN_MESSAGE).toBe(
      'Hallo, hier ist der Dr. Kalla Assistent. Wie kann ich dir bei Friseurbedarf helfen?',
    );
    expect(DRKALLA_RAG_BEGIN_MESSAGE).toContain('Friseurbedarf');
    expect(DRKALLA_RAG_BEGIN_MESSAGE).not.toMatch(/termin|haarschnitt/i);
  });

  it('hard-codes that Dr.Kalla is a supplier shop, not a hair salon', () => {
    expect(DRKALLA_RAG_PROMPT).toContain('Friseurbedarf');
    expect(DRKALLA_RAG_PROMPT).toContain('Salonbedarf-Shop');
    expect(DRKALLA_RAG_PROMPT).toContain('kein Friseursalon');
    expect(DRKALLA_RAG_PROMPT).toContain('keine Salontermine, Haarschnitte');
    expect(DRKALLA_RAG_PROMPT).toContain('keine Salontermine');
  });

  it('prevents invented product facts, prices, stock, and diagnosis-style advice', () => {
    expect(DRKALLA_RAG_PROMPT).toContain('Erfinde keine Produkte');
    expect(DRKALLA_RAG_PROMPT).toContain('Produktpreise');
    expect(DRKALLA_RAG_PROMPT).toContain('koennen sich aendern');
    expect(DRKALLA_RAG_PROMPT).toContain('Keine Diagnose/verbindliche Farbberatung');
    expect(DRKALLA_RAG_PROMPT).toContain('Nutze zuerst die KB');
  });

  it('does not pretend to understand inaudible caller turns', () => {
    expect(DRKALLA_RAG_PROMPT).toContain('"(inaudible speech)"');
    expect(DRKALLA_RAG_PROMPT).toContain('Ich habe dich gerade schlecht verstanden');
    expect(DRKALLA_RAG_PROMPT).toContain('Antworte nicht mit "natürlich"');
    expect(DRKALLA_RAG_PROMPT).toContain('"natuerlich"');
  });

  it('requires voice-friendly product names instead of raw long shop titles', () => {
    expect(DRKALLA_RAG_PROMPT).toContain('Sprachname');
    expect(DRKALLA_RAG_PROMPT).toContain('Lies im Voice-Call keine langen URLs vor');
    expect(DRKALLA_RAG_PROMPT).toContain('Entwickler/Oxidant/Wasserstoffperoxid');
    expect(DRKALLA_RAG_PROMPT).toContain('Bei Herren-, Damen- oder Unisex-Duft');
  });

  it('keeps Retell KB retrieval conservative for a voice RAG agent', () => {
    expect(DRKALLA_RAG_KB_CONFIG).toEqual({ top_k: 3, filter_score: 0.6 });
  });

  it('builds short human spoken names for long product titles', () => {
    const voiceName = buildDrkallaProductVoiceName(productFixture({
      title: 'Delrin-Kamm 4054: 3-in-1-Seitenscheidekamm, Profi-Kamm für Herren, Stylingkamm, Ölkamm, Kamm mit breiten Zinken, Friseurkamm',
      handle: 'delrin-kamm-4054-3-in-1-seitenscheidekamm',
      productType: 'Barber & Herrenpflege',
    }));

    expect(voiceName.spokenName).toBe('Delrin 4054 Seitenscheidekamm');
    expect(voiceName.spokenName.length).toBeLessThanOrEqual(64);
    expect(voiceName.searchAliases).toContain('Kamm');
  });

  it('adds human aliases for perfume gender and fragrance searches', () => {
    const voiceName = buildDrkallaProductVoiceName(productFixture({
      title: 'Lattafa Fakhar for Men Eau de Parfum 100 ml - Herren Duft',
      handle: 'lattafa-fakhar-for-men-eau-de-parfum-100ml',
      vendor: 'Lattafa',
      productType: 'Eau de Parfum',
      tags: ['parfuem'],
    }));

    expect(voiceName.spokenName).toBe('Lattafa Fakhar for Men');
    expect(voiceName.searchAliases).toContain('Herrenduft');
    expect(voiceName.searchAliases).toContain('Parfum');
  });

  it('does not treat Damen perfumes as Herrenduft aliases', () => {
    const voiceName = buildDrkallaProductVoiceName(productFixture({
      title: 'Exclusif Rose – Eau de Parfum für Damen (100 ml / 3.4 oz)',
      handle: 'exclusif-rose-for-women-3-4-oz-edp-spray-beauty-personal-care',
      productType: 'Eau de Parfum',
    }));

    expect(voiceName.spokenName).toBe('Exclusif Rose');
    expect(voiceName.searchAliases).toContain('Damenduft');
    expect(voiceName.searchAliases).not.toContain('Herrenduft');
  });

  it('adds percentage and developer aliases for peroxide variants', () => {
    const voiceName = buildDrkallaProductVoiceName(productFixture({
      title: 'Emulgiertes Wasserstoffperoxid',
      handle: 'emulgiertes-wasserstoffperoxid',
      productType: 'Entwickler & Vorbereitung',
      variants: [
        {
          id: '30vol',
          title: '30 Volume - 9%',
          price: '12.00',
          compareAtPrice: null,
          available: true,
          sku: null,
        },
      ],
    }));

    expect(voiceName.spokenName).toBe('Emulgiertes Wasserstoffperoxid');
    expect(voiceName.searchAliases).toContain('9 Prozent Entwickler');
    expect(voiceName.searchAliases).toContain('30 Vol Entwickler');
  });

  it('adds L Oreal voice aliases for common German ASR brand confusions', () => {
    const voiceName = buildDrkallaProductVoiceName(productFixture({
      title: "L'Oréal Inoa Haarfärbemittel 6.8 Ammoniakfrei 60g",
      handle: 'dye-no-ammonia-loreal-professionnel-paris-inoa-n-68-60-g',
      vendor: "L'Oreal Professionnel Paris",
      productType: 'Haarfärbemittel',
    }));

    expect(voiceName.searchAliases).toContain("L'Oréal");
    expect(voiceName.searchAliases).toContain('Loreal');
    expect(voiceName.searchAliases).toContain('Lorian');
    expect(voiceName.searchAliases).toContain('Loyal');
    expect(voiceName.searchAliases).toContain("L'Oréal Haarfarbe");
    expect(voiceName.searchAliases).toContain('Haarfarbe');
  });

  it('embeds spoken names, structured product fields, human search aliases, and original titles into product facts', () => {
    const fact = formatDrkallaProductFact(productFixture({
      title: 'Anti-Frizz-Oil Shampoo',
      handle: 'anti-frizz-oil-shampoo',
      productType: 'Shampoo',
      images: [
        {
          src: 'https://cdn.shopify.com/example/anti-frizz.jpg',
          alt: 'Anti-Frizz-Oil Shampoo Produktbild',
        },
      ],
    }));

    expect(fact).toContain('Sprachname: Anti-Frizz-Oil Shampoo');
    expect(fact).toContain('Produktart: Shampoo');
    expect(fact).toContain('Shop: Dr.Kalla Cosmetics / drkalla.com');
    expect(fact).toContain('Marke: Dr.Kalla Cosmetics (Hausmarke/Shopmarke)');
    expect(fact).not.toContain('Externe Marke: keine externe Marke im Snapshot');
    expect(fact).not.toContain('CJ Dropshipping');
    expect(fact).toContain('Bilddaten: 1 Bilder');
    expect(fact).toContain('Anti-Frizz-Oil Shampoo Produktbild');
    expect(fact).toContain('Menschliche Suchnamen:');
    expect(fact).toContain('Anti Frizz');
    expect(fact).toContain('Original-Shop-Titel: Anti-Frizz-Oil Shampoo');
  });

  it('builds structured product catalog rows for every product without treating shop labels as brands', () => {
    const entries = buildDrkallaProductCatalogEntries({
      ...snapshotWithProducts(0),
      productCount: 3,
      products: [
        productFixture({
          id: 1,
          title: "L'Oréal Inoa Haarfärbemittel 6.8 Ammoniakfrei 60g",
          handle: 'dye-no-ammonia-loreal-professionnel-paris-inoa-n-68-60-g',
          vendor: "L'Oreal Professionnel Paris",
          productType: 'Haarfärbemittel',
        }),
        productFixture({
          id: 2,
          title: 'Sintesis Color Cream 7.43 Kupferblond 100 ml',
          handle: 'sintesis-color-cream-743-kupferblond',
          vendor: 'Dr.Kalla Cosmetics',
          productType: 'Color Cream',
        }),
        productFixture({
          id: 3,
          title: 'Lattafa Fakhar for Men Eau de Parfum 100 ml',
          handle: 'lattafa-fakhar-for-men',
          vendor: 'Lattafa',
          productType: 'Eau de Parfum',
        }),
      ],
    });

    expect(entries).toHaveLength(3);
    expect(entries.find((entry) => entry.spokenName.includes('Inoa'))).toMatchObject({
      productKind: 'Haarfarbe/Farbcreme',
      externalBrand: "L'Oreal Professionnel Paris",
      brandName: "L'Oreal Professionnel Paris",
      shopName: 'Dr.Kalla Cosmetics',
      priceRange: '9,99 EUR',
    });
    expect(entries.find((entry) => entry.spokenName.includes('Sintesis'))).toMatchObject({
      productKind: 'Haarfarbe/Farbcreme',
      externalBrand: null,
      brandName: 'Dr.Kalla Cosmetics',
      brandSource: 'house_brand',
      shopName: 'Dr.Kalla Cosmetics',
      productLine: 'Sintesis Color Cream',
    });
    expect(entries.find((entry) => entry.spokenName.includes('Lattafa'))).toMatchObject({
      productKind: 'Duft/Parfum',
      externalBrand: 'Lattafa',
      brandName: 'Lattafa',
    });
  });

  it('always exposes the shop as Dr.Kalla and a customer-facing brand for every product', () => {
    const entries = buildDrkallaProductCatalogEntries({
      ...snapshotWithProducts(0),
      productCount: 3,
      products: [
        productFixture({
          id: 1,
          title: "L'Oréal Inoa Haarfärbemittel 6.8 Ammoniakfrei 60g",
          handle: 'dye-no-ammonia-loreal-professionnel-paris-inoa-n-68-60-g',
          vendor: "L'Oreal Professionnel Paris",
          productType: 'Haarfärbemittel',
        }),
        productFixture({
          id: 2,
          title: 'Sintesis Color Cream 7.43 Kupferblond 100 ml',
          handle: 'sintesis-color-cream-743-kupferblond',
          vendor: 'Dr.Kalla Cosmetics',
          productType: 'Color Cream',
        }),
        productFixture({
          id: 3,
          title: 'Neutraler Salonartikel',
          handle: 'neutraler-salonartikel',
          vendor: 'CJ Dropshipping',
          productType: 'Salonbedarf',
        }),
      ],
    });

    expect(entries.map((entry) => entry.shopName)).toEqual([
      'Dr.Kalla Cosmetics',
      'Dr.Kalla Cosmetics',
      'Dr.Kalla Cosmetics',
    ]);
    expect(entries.map((entry) => entry.brandName)).toEqual([
      "L'Oreal Professionnel Paris",
      'Dr.Kalla Cosmetics',
      'Dr.Kalla Cosmetics',
    ]);
    expect(entries.map((entry) => entry.brandSource)).toEqual([
      'external_brand',
      'house_brand',
      'house_brand',
    ]);
  });

  it('uses the concrete product function before broad Shopify categories', () => {
    const entries = buildDrkallaProductCatalogEntries({
      ...snapshotWithProducts(0),
      productCount: 4,
      products: [
        productFixture({
          id: 1,
          title: 'Anti-Yellow Shampoo & Gelb-Neutralisation für blondes Haar',
          handle: 'anti-yellow-shampoo',
          productType: 'Haarfarbe und Blondierung',
        }),
        productFixture({
          id: 2,
          title: 'Anti Gelb Conditioner',
          handle: 'anti-gelb-conditioner',
          productType: 'Haarfarbe und Blondierung',
        }),
        productFixture({
          id: 3,
          title: 'Ammoniakfreie duftende Dauerwellenlösung 500ml',
          handle: 'ammoniakfreie-duftende-dauerwellenlosung',
          productType: 'Styling',
        }),
        productFixture({
          id: 4,
          title: 'Sintesis Color Cream 7.43 Kupferblond 100 ml',
          handle: 'sintesis-color-cream-743-kupferblond',
          productType: 'Haarfarbe und Blondierung',
        }),
      ],
    });

    expect(entries.find((entry) => entry.websiteTitle.includes('Shampoo'))?.productKind).toBe('Shampoo');
    expect(entries.find((entry) => entry.websiteTitle.includes('Conditioner'))?.productKind).toBe('Conditioner/Spülung');
    expect(entries.find((entry) => entry.websiteTitle.includes('Dauerwellen'))?.productKind).toBe('Styling');
    expect(entries.find((entry) => entry.websiteTitle.includes('Sintesis'))?.productKind).toBe('Haarfarbe/Farbcreme');
  });

  it('infers real external brands from product titles without treating Dr.Kalla as a brand', () => {
    const entries = buildDrkallaProductCatalogEntries({
      ...snapshotWithProducts(0),
      productCount: 2,
      products: [
        productFixture({
          id: 1,
          title: 'Wella Koleston Perfect Pure naturalis 60 ml',
          handle: 'wella-koleston-perfect-pure-naturalis-60-ml',
          vendor: null,
          productType: null,
        }),
        productFixture({
          id: 2,
          title: 'Anti-Frizz-Oil Shampoo',
          handle: 'anti-frizz-oil-shampoo',
          vendor: 'Dr.Kalla Cosmetics',
          productType: 'Shampoo',
        }),
      ],
    });

    expect(entries.find((entry) => entry.websiteTitle.includes('Wella'))).toMatchObject({
      productKind: 'Haarfarbe/Farbcreme',
      externalBrand: 'Wella',
      productLine: 'Koleston Perfect',
    });
    expect(entries.find((entry) => entry.websiteTitle.includes('Anti-Frizz'))).toMatchObject({
      externalBrand: null,
      brandName: 'Dr.Kalla Cosmetics',
      shopName: 'Dr.Kalla Cosmetics',
    });
  });

  it('classifies common scraped product edge cases into useful product kinds', () => {
    const entries = buildDrkallaProductCatalogEntries({
      ...snapshotWithProducts(0),
      productCount: 6,
      products: [
        productFixture({ id: 1, title: 'Farbentfernungs Tücher mit aloe vera extract', handle: 'farbentfernungs-tucher', productType: null }),
        productFixture({ id: 2, title: 'Flüssiges Leinsamenkristalle', handle: 'flussiges-leinsamenkristalle', productType: null }),
        productFixture({ id: 3, title: 'Glättungscreme 100ml+100ml neutralisierendes Fixiermittel', handle: 'glattungscreme-neutralisierendes-fixiermittel', productType: null }),
        productFixture({ id: 4, title: 'Koleston Perfect ME+ Farbkarte', handle: 'koleston-perfect-me-farbkarte', productType: null }),
        productFixture({ id: 5, title: 'Super-aufhellendes Bleichpulver', handle: 'super-aufhellendes-bleichpulver', productType: null }),
        productFixture({ id: 6, title: 'Genseng für trockenes und lebloses Haar', handle: 'genseng-trockenes-lebloses-haar', productType: null }),
      ],
    });

    expect(entries.map((entry) => entry.productKind)).toEqual([
      'Farbentferner',
      'Serum',
      'Haarglättung',
      'Farbkarte',
      'Blondierung',
      'Haarpflege',
    ]);
  });

  it('adds a generated spoken image label when Shopify image alt text is missing', () => {
    const [entry] = buildDrkallaProductCatalogEntries({
      ...snapshotWithProducts(0),
      productCount: 1,
      products: [
        productFixture({
          title: 'Anti-Frizz-Oil Shampoo',
          handle: 'anti-frizz-oil-shampoo',
          images: [{ src: 'https://cdn.shopify.com/example/anti-frizz.jpg', alt: null }],
        }),
      ],
    });

    expect(entry?.imageCount).toBe(1);
    expect(entry?.imageAltTexts).toContain('Produktbild: Anti-Frizz-Oil Shampoo');
    expect(formatDrkallaProductFact(productFixture({
      title: 'Anti-Frizz-Oil Shampoo',
      handle: 'anti-frizz-oil-shampoo',
      images: [{ src: 'https://cdn.shopify.com/example/anti-frizz.jpg', alt: null }],
    }))).toContain('Bildhinweis: Produktbild: Anti-Frizz-Oil Shampoo');
  });

  it('turns all scraped products into chunked Retell knowledge texts', () => {
    const texts = buildDrkallaKnowledgeTexts(snapshotWithProducts(91));

    expect(texts[0]?.text).toContain('Dr.Kalla ist ein Friseurbedarf-Shop und kein Friseursalon');
    expect(texts.some((entry) => entry.title.includes('DrKalla Kontakt'))).toBe(true);
    expect(texts.some((entry) => entry.text.includes('Silbersteinstrasse 83, 12051 Berlin'))).toBe(true);
    expect(texts.some((entry) => entry.text.includes('Test Produkt 1'))).toBe(true);
    expect(texts.some((entry) => entry.text.includes('Test Produkt 91'))).toBe(true);
    expect(texts.filter((entry) => entry.title.includes('DrKalla Products'))).toHaveLength(3);
  });

  it('builds a general product catalog index and separates external brands from shop providers', () => {
    const loreal = productFixture({
      id: 2,
      title: "L'Oréal Inoa Haarfärbemittel 6.8 Ammoniakfrei 60g",
      handle: 'dye-no-ammonia-loreal-professionnel-paris-inoa-n-68-60-g',
      url: 'https://drkalla.com/products/dye-no-ammonia-loreal-professionnel-paris-inoa-nº-68-60-g',
      vendor: "L'Oreal Professionnel Paris",
      productType: 'Haarfärbemittel',
    });
    const ownColor = productFixture({
      id: 3,
      title: 'Sintesis Color Cream 7.43 Kupferblond 100 ml',
      handle: 'sintesis-color-cream-743-kupferblond',
      vendor: 'Dr.Kalla Cosmetics',
      productType: 'Color Cream',
    });
    const texts = buildDrkallaKnowledgeTexts({
      ...snapshotWithProducts(0),
      productCount: 2,
      vendors: ['Dr.Kalla Cosmetics', "L'Oreal Professionnel Paris"],
      products: [loreal, ownColor],
    });
    const catalogIndex = texts.find((entry) => entry.title.includes('Strukturierter Produktkatalog'));

    expect(catalogIndex?.text).toContain('Produktart: Haarfarbe/Farbcreme');
    expect(catalogIndex?.text).toContain("Externe Marken: L'Oreal Professionnel Paris");
    expect(catalogIndex?.text).toContain('Shop: Dr.Kalla Cosmetics / drkalla.com');
    expect(catalogIndex?.text).toContain('Marken: Dr.Kalla Cosmetics, L\'Oreal Professionnel Paris');
    expect(catalogIndex?.text).toContain('Dr.Kalla Cosmetics ist Shop und Hausmarke');
    expect(catalogIndex?.text).toContain('Lorian');
    expect(catalogIndex?.text).toContain('Produktlink aus der Produkt-KB');
    expect(catalogIndex?.text).not.toContain('Wella');
    expect(catalogIndex?.text).not.toContain('Schwarzkopf');
  });
});
