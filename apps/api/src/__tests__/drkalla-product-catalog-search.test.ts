import { describe, expect, it } from 'vitest';
import {
  buildDrkallaProductCatalogSearch,
  buildDrkallaShortName,
  buildDrkallaExternalBrandStock,
} from '../drkalla-product-catalog-search.js';

const products = [
  {
    handle: 'perm-light',
    title: '• Ammoniakfreie duftende Dauerwellenlösung 500ml',
    productType: 'Styling',
    tags: ['Dauerwelle', 'Locken', 'Styling', 'Dr.Kalla', 'Profi-Sortiment'],
    variants: [{ price: '16.00', available: true }],
  },
  {
    handle: 'perm-fix',
    title: 'Dauerwellen-Fixierer & Locken-Stabilisierung',
    productType: 'Dauerwellen-Fixierer',
    tags: ['Dauerwelle', 'Fixierer'],
    variants: [{ price: '8.40', available: true }],
  },
  {
    handle: 'color-cream',
    title: 'Sintesis Color Cream 100 ml – Haarfarbe',
    productType: 'Haarfarbe und Blondierung',
    tags: ['Haarfarbe', 'Blondierung', 'Color'],
    variants: [{ price: '9.99', available: true }],
  },
  {
    handle: 'shampoo-schuppen',
    title: 'Reinigendes Anti-Schuppen-Shampoo',
    productType: 'Haarpflege',
    tags: ['Schuppen', 'Shampoo', 'Kopfhaut'],
    variants: [{ price: '15.00', available: true }],
  },
];

const search = buildDrkallaProductCatalogSearch(products);

describe('DrKalla product catalog category search', () => {
  it('names real products for an open category need (the live-call gap)', () => {
    const r = search('Was habt ihr für Dauerwelle?', 3);
    expect(r.map((p) => p.productId).sort()).toEqual(['perm-fix', 'perm-light']);
    expect(r[0]?.priceText).toBeTruthy();
  });

  it('matches a coloring need to the color products', () => {
    const r = search('Ich möchte mein Haar färben, Haarfarbe', 3);
    expect(r.some((p) => p.productId === 'color-cream')).toBe(true);
  });

  it('matches a scalp/dandruff need', () => {
    const r = search('Habt ihr ein Shampoo gegen Schuppen?', 3);
    expect(r[0]?.productId).toBe('shampoo-schuppen');
  });

  it('returns nothing for a contentless or non-category utterance', () => {
    expect(search('Hallo')).toEqual([]);
    expect(search('Was empfehlen Sie mir?')).toEqual([]);
    expect(search('Ja bitte')).toEqual([]);
  });

  it('ranks category (tag/type) matches above title-only matches and caps the limit', () => {
    const r = search('Dauerwelle Locken', 1);
    expect(r).toHaveLength(1);
    expect(['perm-light', 'perm-fix']).toContain(r[0]?.productId);
  });

  it('returns short speakable names and a categoryHit flag, not the full title', () => {
    const r = search('Habt ihr ein Shampoo gegen Schuppen?', 1);
    expect(r[0]?.shortName).toBe('Reinigendes Anti-Schuppen-Shampoo');
    expect(r[0]?.categoryHit).toBe(true);
  });

  it('buildDrkallaShortName drops bullets, sizes, codes and the second &-phrase', () => {
    expect(buildDrkallaShortName('• Evelon Pro NutriElements Haarmaske für häufige Haarpflege 500 Ml'))
      .toBe('Evelon Pro NutriElements Haarmaske');
    expect(buildDrkallaShortName('Nährendes Haarspray & Starkes Halt 200 Ml')).toBe('Nährendes Haarspray');
    expect(buildDrkallaShortName('Delrin-Kamm 4053 Profi')).toBe('Delrin-Kamm Profi');
  });

  it('finds products by brand/vendor so "von Wella" is not falsely "nicht im Sortiment" (real call 2026-06-15)', () => {
    const branded = buildDrkallaProductCatalogSearch([
      { handle: 'blondor', title: 'Blondor Multi Blonde Powder', productType: 'Blondierung', tags: ['Blondierung'], vendor: 'Wella', variants: [{ price: '22.99', available: true }] },
      { handle: 'house-sham', title: 'Pflege Shampoo', productType: 'Shampoo', tags: ['Shampoo'], vendor: 'Dr.Kalla Cosmetics', variants: [{ price: '9.00', available: true }] },
    ]);
    const r = branded('Haben Sie Produkte von Wella?', 3);
    expect(r.map((p) => p.productId)).toContain('blondor');
    // the house-brand vendor tokens are stopwords, so a generic brand probe does
    // not pull every house product as a "brand" hit.
    expect(branded('Wella', 3)[0]?.productId).toBe('blondor');
  });

  it('buildDrkallaShortName strips quality-tier / shop-channel suffixes (real call 2026-06-15)', () => {
    // These suffixes trail many titles WITHOUT a leading "&", so the first-segment
    // cut does not remove them; they read as noise on a spoken name.
    expect(buildDrkallaShortName('Colorationscreme Haarfarbe Grauabdeckung Profi-Salonbedarf'))
      .not.toMatch(/salonbedarf/i);
    expect(buildDrkallaShortName('Haarfarbe Ammoniakfrei Coloration Profi-Qualität'))
      .not.toMatch(/profi-?\s?qualit/i);
    expect(buildDrkallaShortName('Farbentwickler Oxidationsmittel Salonbedarf'))
      .toBe('Farbentwickler Oxidationsmittel');
  });

  it('buildDrkallaShortName strips unpronounceable codes (ALL-CAPS, vowel-less, digit-codes)', () => {
    expect(buildDrkallaShortName('ARGENT Glanz-Shampoo & B3-PLEX Keravis')).toBe('Glanz-Shampoo');
    expect(buildDrkallaShortName('Evelon Pro Hairspray Pro Lch 500 Ml')).toBe('Evelon Pro Hairspray');
    expect(buildDrkallaShortName('BARCELONA Friseur-Salonwagen mit Schubladen')).toBe('Friseur-Salonwagen mit Schubladen');
    // never returns empty even if every token is a code
    expect(buildDrkallaShortName('CLR LCH').length).toBeGreaterThan(0);
  });

  it('deduplicates results that share a spoken short name (no "X und X")', () => {
    const dup = buildDrkallaProductCatalogSearch([
      { handle: 'a', title: 'Black Professional Line Sintesis Color Cream 100 ml', productType: 'Haarfarbe und Blondierung', tags: ['Haarfarbe'], variants: [{ price: '9.00', available: true }] },
      { handle: 'b', title: 'Black Professional Line Sintesis Color Cream 60 ml', productType: 'Haarfarbe und Blondierung', tags: ['Haarfarbe'], variants: [{ price: '7.00', available: true }] },
      { handle: 'c', title: 'Igora Royal Permanent Coloration', productType: 'Haarfarbe und Blondierung', tags: ['Haarfarbe'], variants: [{ price: '11.00', available: true }] },
    ]);
    const names = dup('Haarfarbe', 5).map((x) => x.shortName);
    expect(new Set(names).size).toBe(names.length); // every spoken name is unique
    expect(names.filter((n) => n === 'Black Professional Line Sintesis')).toHaveLength(1);
  });

  it('ranks a productType match above a comb that only carries a topical tag (shampoo != comb)', () => {
    const withComb = buildDrkallaProductCatalogSearch([
      ...products,
      {
        handle: 'comb-curl',
        title: 'Delrin-Kamm 4053 für lockiges Haar',
        productType: 'Friseur-Tool',
        tags: ['Kamm', 'Locken', 'lockiges Haar'],
        variants: [{ price: '4.00', available: true }],
      },
      {
        handle: 'shampoo-curl',
        title: 'Locken Shampoo für lockiges Haar',
        productType: 'Locken Shampoo',
        tags: ['Shampoo', 'Locken'],
        variants: [{ price: '12.00', available: true }],
      },
    ]);
    const r = withComb('Ich suche ein Shampoo für lockiges Haar', 3);
    expect(r[0]?.productId).toBe('shampoo-curl');           // shampoo wins
    expect(r.findIndex((p) => p.productId === 'comb-curl'))  // comb ranks below, if present
      .toBeGreaterThan(0);
  });
});

describe('DrKalla vendor-strict external-brand stock', () => {
  // Mirrors the real catalog shape (2026-06-16): almost all house brand, one real
  // L'Oréal product (the Inoa), and a house product carrying a competitor SEO tag.
  const stock = buildDrkallaExternalBrandStock([
    {
      handle: 'inoa',
      title: "L'Oréal Inoa Haarfärbemittel 6.8 Ammoniakfrei 60g",
      productType: 'Haarfärbemittel',
      tags: ["L'Oreal Professionnel Paris", 'Haarfärbemittel'],
      vendor: 'L\'Oreal Professionnel Paris',
      variants: [{ price: '13.00', available: true }],
    },
    {
      // House product that carries a competitor name only as an SEO tag.
      handle: 'house-blond',
      title: 'Blondierpulver Bond-Schutz',
      productType: 'Haarfarbe und Blondierung',
      tags: ['Wella', 'Blondierung'],
      vendor: 'Dr.Kalla Cosmetics',
      variants: [{ price: '24.19', available: true }],
    },
  ]);

  it('reports a genuinely stocked external brand by VENDOR, accent/spelling tolerant', () => {
    for (const q of ["L'Oréal", 'L’Oréal', 'Loreal', 'oreal']) {
      const hits = stock(q);
      expect(hits, q).toHaveLength(1);
      expect(hits[0]?.productId, q).toBe('inoa');
      expect(hits[0]?.priceText, q).toBe('13,00 Euro');
      expect(hits[0]?.available, q).toBe(1);
      expect(hits[0]?.shortName, q).toMatch(/Inoa/);
    }
  });

  it('does NOT report a brand that only appears as a competitor SEO tag on a house product', () => {
    // The house "Blondierpulver" is tagged "Wella" but its vendor is the house
    // brand — a vendor-strict lookup must return [] so we never falsely claim Wella.
    expect(stock('Wella')).toEqual([]);
    expect(stock('Schwarzkopf')).toEqual([]);
    expect(stock('Garnier')).toEqual([]);
  });

  it('excludes the house vendor and ignores too-short brand probes', () => {
    expect(stock('Dr.Kalla')).toEqual([]);
    expect(stock('Kalla')).toEqual([]);
    expect(stock('a')).toEqual([]); // < 3 chars after folding
  });
});
