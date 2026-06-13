import { describe, expect, it } from 'vitest';
import { buildDrkallaProductCatalogSearch } from '../drkalla-product-catalog-search.js';

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
});
