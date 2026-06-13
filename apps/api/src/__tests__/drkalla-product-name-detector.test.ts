import { describe, expect, it } from 'vitest';
import {
  buildDrkallaProductNameDetector,
  deriveDrkallaAgentSpokeEvent,
  type DrkallaProductNameEntry,
} from '../drkalla-product-name-detector.js';

const entries: DrkallaProductNameEntry[] = [
  {
    productId: 'synthesis-color-cream',
    spokenName: 'Synthesis Color Cream',
    productKind: 'Haarfarbe/Farbcreme',
    url: 'https://drkalla.com/products/synthesis-color-cream',
    aliases: ['Synthesis Color Cream', 'Synthesis Farbcreme', 'Haarfarbe', 'Dr.Kalla', 'Koleston'],
  },
  {
    productId: 'luxe-oel-serum',
    spokenName: 'Luxe-Oel Serum',
    productKind: 'Serum',
    aliases: ['Luxe-Oel Serum', 'Luxe Öl Serum', 'Koleston'],
  },
  {
    productId: 'luxe-oel-leave-in',
    spokenName: 'Luxe-Oel Leave-in',
    productKind: 'Leave-in',
    aliases: ['Luxe-Oel Leave-in', 'Haarspray'],
  },
  {
    productId: 'alkalisches-vorbereitungsshampoo',
    spokenName: 'Alkalisches Vorbereitungsshampoo',
    productKind: 'Vorbereitungsshampoo',
    aliases: ['Alkalisches Vorbereitungsshampoo', '1000ml'],
  },
];

const detect = buildDrkallaProductNameDetector(entries);

describe('DrKalla product name detector', () => {
  it('detects a specific product name in a user price question', () => {
    expect(detect('Was kostet die Synthesis Color Cream?')).toEqual([
      {
        productId: 'synthesis-color-cream',
        spokenName: 'Synthesis Color Cream',
        productKind: 'Haarfarbe/Farbcreme',
        url: 'https://drkalla.com/products/synthesis-color-cream',
      },
    ]);
  });

  it('matches German umlaut and ae/oe/ue ASR variants', () => {
    expect(detect('Ich meine das Luxe Öl Serum.')).toHaveLength(1);
    expect(detect('Ich meine das Luxe Oel Serum.')).toHaveLength(1);
    expect(detect('ich meine das luxe oel serum')[0]?.productId).toBe('luxe-oel-serum');
  });

  it('detects both products in a comparison question, capped at two', () => {
    const found = detect('Was ist der Unterschied zwischen Luxe-Oel Serum und Luxe-Oel Leave-in?');
    expect(found.map((product) => product.productId).sort()).toEqual([
      'luxe-oel-leave-in',
      'luxe-oel-serum',
    ]);
  });

  it('never maps category-level words to a single product', () => {
    // "Haarfarbe" and "Haarspray" are aliases on exactly one entry each here,
    // but they are product-type words, not product names.
    expect(detect('Ich suche eine Haarfarbe.')).toEqual([]);
    expect(detect('Ich brauche Haarspray.')).toEqual([]);
  });

  it('never maps shared brand/line aliases to a single product', () => {
    expect(detect('Habt ihr Koleston?')).toEqual([]);
  });

  it('never treats the shop/company name as a product', () => {
    expect(detect('Was macht Dr.Kalla eigentlich?')).toEqual([]);
    expect(detect('Ist das von Dr. Color Cosmetics?')).toEqual([]);
  });

  it('ignores junk aliases such as bare sizes', () => {
    expect(detect('Ich brauche 1000ml.')).toEqual([]);
  });
});

describe('DrKalla agent-spoke derivation', () => {
  it('attributes price and size facts to the single product in the reply', () => {
    const event = deriveDrkallaAgentSpokeEvent({
      text: 'Die Synthesis Color Cream kostet laut Shop-Datenstand 9,99 Euro und hat 100 ml. Soll ich dir den Produktlink per SMS schicken?',
      turnIndex: 3,
      detectProducts: detect,
    });
    expect(event.lastProduct?.productId).toBe('synthesis-color-cream');
    expect(event.factsMentioned?.map((fact) => fact.key).sort()).toEqual([
      'product.synthesis-color-cream.link',
      'product.synthesis-color-cream.price',
      'product.synthesis-color-cream.size',
    ]);
    expect(event.lastAgentQuestion).toBe('Soll ich dir den Produktlink per SMS schicken?');
  });

  it('attributes facts per sentence when two products are mentioned', () => {
    const event = deriveDrkallaAgentSpokeEvent({
      text: 'Das Luxe-Oel Serum kostet 12,99 Euro. Das Luxe-Oel Leave-in bleibt im Haar.',
      turnIndex: 4,
      detectProducts: detect,
    });
    expect(event.factsMentioned?.map((fact) => fact.key)).toEqual([
      'product.luxe-oel-serum.price',
    ]);
  });

  it('marks the Profi price disclosure when the canonical sentence is spoken', () => {
    const event = deriveDrkallaAgentSpokeEvent({
      text: 'Das sind die Preise für normale Käufer. Spezielle Profi-Friseurpreise kann ich telefonisch nicht nennen; dafür können Sie sich über den Profi-Zugang registrieren. Soll ich Ihnen den Produktlink oder den Link zum Profi-Zugang per SMS schicken?',
      turnIndex: 5,
      detectProducts: detect,
    });
    expect(event.profiPriceDisclosureGiven).toBe(true);
  });

  it('does not mark the disclosure for ordinary price sentences', () => {
    const event = deriveDrkallaAgentSpokeEvent({
      text: 'Die Synthesis Color Cream kostet 9,99 Euro.',
      turnIndex: 6,
      detectProducts: detect,
    });
    expect(event.profiPriceDisclosureGiven).toBeUndefined();
  });
});
