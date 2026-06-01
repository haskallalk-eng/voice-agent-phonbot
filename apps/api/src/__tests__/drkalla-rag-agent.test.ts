import { describe, expect, it } from 'vitest';
import {
  DRKALLA_RAG_BEGIN_MESSAGE,
  DRKALLA_RAG_KB_CONFIG,
  DRKALLA_RAG_PROMPT,
  buildDrkallaProductVoiceName,
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
    expect(DRKALLA_RAG_PROMPT).toContain('Antworte nicht mit "natuerlich"');
  });

  it('requires voice-friendly product names instead of raw long shop titles', () => {
    expect(DRKALLA_RAG_PROMPT).toContain('Sprachname');
    expect(DRKALLA_RAG_PROMPT).toContain('Lies im Voice-Call keine langen URLs vor');
    expect(DRKALLA_RAG_PROMPT).toContain('Bei Entwickler/Oxidant/Wasserstoffperoxid');
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

  it('embeds spoken names, human search aliases, and original titles into product facts', () => {
    const fact = formatDrkallaProductFact(productFixture({
      title: 'Anti-Frizz-Oil Shampoo',
      handle: 'anti-frizz-oil-shampoo',
      productType: 'Shampoo',
    }));

    expect(fact).toContain('Sprachname: Anti-Frizz-Oil Shampoo');
    expect(fact).toContain('Menschliche Suchnamen:');
    expect(fact).toContain('Anti Frizz');
    expect(fact).toContain('Original-Shop-Titel: Anti-Frizz-Oil Shampoo');
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
});
