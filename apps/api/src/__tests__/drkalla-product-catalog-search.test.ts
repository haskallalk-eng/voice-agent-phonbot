import { describe, expect, it } from 'vitest';
import { buildDrkallaProductCatalogSearch, buildDrkallaShortName } from '../drkalla-product-catalog-search.js';

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
