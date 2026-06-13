import { describe, expect, it } from 'vitest';
import {
  buildDrkallaAmbiguousProductNameDetector,
  buildDrkallaProductNameDetector,
  deriveDrkallaAgentSpokeEvent,
  reportDrkallaProductNameDetectorCoverage,
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

  it('the fuzzy partial path never auto-resolves a specific product (correctness-safe)', () => {
    // Partial/brand+line matches collide against the real catalog, so the
    // detector must never guess one SKU (wrong price/link). Specific products
    // still resolve only via the exact unique-alias path (full spoken name).
    const entries = [
      { productId: 'evelon', spokenName: 'Evelon Pro Hairspray Pro Lch', productKind: 'Haarpflege', aliases: ['Evelon Pro', 'Haarspray'] },
      { productId: 'other', spokenName: 'Synthesis Color Cream', productKind: 'Haarfarbe/Farbcreme', aliases: [] },
    ];
    const det2 = buildDrkallaProductNameDetector(entries);
    // Partial token match -> no auto-resolution.
    expect(det2('Was kostet das Evelon Hairspray?')).toEqual([]);
    // Full unique spoken name still resolves (exact-alias path).
    expect(det2('Ich suche die Synthesis Color Cream.')[0]?.productId).toBe('other');
  });

  it('surfaces a brand+line that matches several SKUs as a variant clarification', () => {
    const entries = [
      { productId: 'kp-7-0', spokenName: 'Koleston Perfect 7/0', productKind: 'Haarfarbe/Farbcreme', aliases: ['Koleston'] },
      { productId: 'kp-9-1', spokenName: 'Koleston Perfect 9/1', productKind: 'Haarfarbe/Farbcreme', aliases: ['Koleston'] },
    ];
    const det2 = buildDrkallaProductNameDetector(entries);
    const amb = buildDrkallaAmbiguousProductNameDetector(entries);
    expect(det2('Was kostet die Koleston Perfect?')).toEqual([]); // never guess one SKU
    const hit = amb('Was kostet die Koleston Perfect?');
    expect(hit?.productCount).toBe(2);
    expect(hit?.label).toContain('Koleston');
  });

  it('requires at least two content tokens so a single generic word never triggers clarification', () => {
    const entries = [
      { productId: 'a', spokenName: 'Synthesis Color Cream', productKind: 'Haarfarbe/Farbcreme', aliases: [] },
      { productId: 'b', spokenName: 'Synthesis Color Booster', productKind: 'Haarfarbe/Farbcreme', aliases: [] },
    ];
    const amb = buildDrkallaAmbiguousProductNameDetector(entries);
    expect(amb('Habt ihr Color?')).toBeNull();
    expect(amb('Was kostet das?')).toBeNull();
    // Two shared tokens (synthesis + color) -> clarification.
    expect(amb('Was kostet die Synthesis Color?')?.productCount).toBe(2);
  });

  it('never clarifies on shop/company terms via the partial path', () => {
    const amb = buildDrkallaAmbiguousProductNameDetector([
      { productId: 'a', spokenName: 'Synthesis Color Cream', productKind: 'Haarfarbe/Farbcreme', aliases: [] },
      { productId: 'b', spokenName: 'Synthesis Color Booster', productKind: 'Haarfarbe/Farbcreme', aliases: [] },
    ]);
    expect(amb('Was macht Dr.Kalla Cosmetics?')).toBeNull();
  });

  it('reports duplicate spoken names as coverage gaps instead of hiding them (Codex P2)', () => {
    const report = reportDrkallaProductNameDetectorCoverage([
      { productId: 'a', spokenName: 'Universal Haaroel', productKind: null, aliases: [] },
      { productId: 'b', spokenName: 'Universal Haaroel', productKind: null, aliases: [] },
      { productId: 'c', spokenName: 'Synthesis Color Cream', productKind: null, aliases: [] },
    ]);
    expect(report.totalProducts).toBe(3);
    expect(report.detectableBySpokenName).toBe(1);
    expect(report.undetectableProductIds.sort()).toEqual(['a', 'b']);
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

  it('B: negated sentences never mark facts as already answered (Codex P1)', () => {
    // A-red: "nicht per SMS" marked link, "kostet nicht 9 Euro" marked price,
    // "kein 1 Liter" marked size — blocking later legitimate answers.
    const negated = deriveDrkallaAgentSpokeEvent({
      text: 'Der Link zur Synthesis Color Cream folgt nicht per SMS. Sie kostet nicht 9 Euro. Es ist kein 1 Liter Produkt.',
      turnIndex: 7,
      detectProducts: detect,
    });
    expect(negated.factsMentioned).toBeUndefined();
  });

  it('B: spelled-out German prices count as a price fact (Codex P1)', () => {
    const event = deriveDrkallaAgentSpokeEvent({
      text: 'Die Synthesis Color Cream kostet neunundneunzig Euro.',
      turnIndex: 8,
      detectProducts: detect,
    });
    expect(event.factsMentioned?.map((fact) => fact.key)).toEqual([
      'product.synthesis-color-cream.price',
    ]);
  });

  it('B: both mentioned products become known with facts on the right one (Codex P1)', () => {
    const event = deriveDrkallaAgentSpokeEvent({
      text: 'Synthesis Color Cream kostet 9 Euro. Luxe-Oel Serum hat 100 ml.',
      turnIndex: 9,
      detectProducts: detect,
    });
    expect(event.productsMentioned?.map((product) => product.productId).sort()).toEqual([
      'luxe-oel-serum',
      'synthesis-color-cream',
    ]);
    expect(event.factsMentioned?.map((fact) => fact.key).sort()).toEqual([
      'product.luxe-oel-serum.size',
      'product.synthesis-color-cream.price',
    ]);
  });
});
