import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildDrkallaProductEvidenceLookup,
  formatDrkallaProductEvidenceLine,
} from '../drkalla-product-evidence.js';

const lookup = buildDrkallaProductEvidenceLookup([
  {
    handle: 'synthesis-color-cream',
    title: '• Synthesis Color Cream 100 Ml',
    vendor: 'Dr.Kalla Cosmetics',
    productType: 'Haarfarbe/Farbcreme',
    url: 'https://drkalla.com/products/synthesis-color-cream',
    variants: [{ price: '9.99', available: true }],
  },
  {
    handle: 'lattafa-fakhar',
    title: 'Lattafa Fakhar Eau de Parfum',
    vendor: 'Lattafa',
    productType: 'Parfum',
    url: 'https://drkalla.com/products/lattafa-fakhar',
    variants: [
      { price: '24.99', available: true },
      { price: '39.99', available: false },
    ],
  },
  {
    handle: 'dropship-comb',
    title: 'Delrin Hair Comb',
    vendor: 'CJ Dropshipping',
    productType: 'Friseur-Tool',
    url: 'https://drkalla.com/products/dropship-comb',
    variants: [{ price: '0', available: false }],
  },
  { handle: '', title: 'kaputt', vendor: null, productType: null, url: null, variants: null },
]);

describe('DrKalla product evidence lookup', () => {
  it('exposes price, brand, kind, and link facts per product', () => {
    const evidence = lookup.byId('synthesis-color-cream');
    expect(evidence?.spokenName).toBe('Synthesis Color Cream 100 Ml');
    expect(evidence?.priceText).toBe('9,99 Euro');
    expect(evidence?.brandName).toBe('Dr.Kalla Cosmetics');
    expect(evidence?.productKind).toBe('Haarfarbe/Farbcreme');
    expect(evidence?.hasUrl).toBe(true);
    expect(evidence?.availableVariantCount).toBe(1);
  });

  it('formats multi-variant prices as a German range', () => {
    expect(lookup.byId('lattafa-fakhar')?.priceText).toBe('von 24,99 Euro bis 39,99 Euro');
    expect(lookup.byId('lattafa-fakhar')?.brandName).toBe('Lattafa');
  });

  it('never exposes technical supplier labels as customer-facing brand', () => {
    expect(lookup.byId('dropship-comb')?.brandName).toBe('Dr.Kalla Cosmetics');
    expect(lookup.byId('dropship-comb')?.priceText).toBeNull();
  });

  it('skips invalid catalog rows instead of failing', () => {
    expect(lookup.size).toBe(3);
    expect(lookup.byId('')).toBeNull();
  });

  it('resolves by the exact short-term-memory product key hash', () => {
    const hash = crypto.createHash('sha256').update('synthesis-color-cream').digest('hex').slice(0, 16);
    expect(lookup.byKeyHash(hash)?.productId).toBe('synthesis-color-cream');
    expect(lookup.byKeyHash('0000000000000000')).toBeNull();
  });

  it('keeps the evidence directive line compact and URL-free', () => {
    const evidence = lookup.byId('synthesis-color-cream');
    const line = formatDrkallaProductEvidenceLine(evidence!);
    expect(line).toContain('Evidence (Shop-Datenstand)');
    expect(line).toContain('9,99 Euro');
    expect(line).toContain('Marke Dr.Kalla Cosmetics');
    expect(line).not.toContain('https://');
    expect(line.length).toBeLessThanOrEqual(220);
  });
});
