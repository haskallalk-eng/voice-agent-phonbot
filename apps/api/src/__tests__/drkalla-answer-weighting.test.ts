/**
 * Answer-weighting fixes from the 2026-07-05 audit:
 *  - tie ROTATION: score-tied catalog candidates share exposure across calls
 *    (before: the shortest-name winner — the Glanz-Shampoo — led every call);
 *  - speakable SHORT NAMES for shout-cased/foreign-particle titles ("I Eau de");
 *  - chunk-builder BOILERPLATE hygiene (currency picker, nav dupes 2-7x);
 *  - retriever POLICY BOOST (policy question must beat product marketing copy).
 */
import { describe, expect, it } from 'vitest';
import {
  buildDrkallaShortName,
  drkallaVarietySeedFromCallId,
  rotateDrkallaEqualScoreGroups,
  type DrkallaCatalogMatch,
} from '../drkalla-product-catalog-search.js';
import { buildDrkallaKnowledgeChunks } from '../scripts/build-drkalla-knowledge-chunks.js';
import { buildDrkallaKnowledgeRetriever } from '../drkalla-knowledge-chunks-retriever.js';

function hit(shortName: string, score: number): DrkallaCatalogMatch {
  return {
    productId: `id-${shortName}`,
    spokenName: shortName,
    shortName,
    productType: null,
    priceText: null,
    priceValue: null,
    score,
    categoryHit: true,
    typeHit: true,
    availableCount: 1,
  };
}

describe('tie rotation', () => {
  const hits = [hit('A', 8), hit('B', 8), hit('C', 8), hit('D', 5), hit('E', 5), hit('F', 2)];

  it('seed 0/undefined is the identity (tests and sims stay byte-identical)', () => {
    expect(rotateDrkallaEqualScoreGroups(hits, 0).map((h) => h.shortName)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(rotateDrkallaEqualScoreGroups(hits, undefined).map((h) => h.shortName)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('rotates WITHIN equal-score groups only — group order and membership stay', () => {
    const r1 = rotateDrkallaEqualScoreGroups(hits, 1).map((h) => h.shortName);
    expect(r1).toEqual(['B', 'C', 'A', 'E', 'D', 'F']);
    const r2 = rotateDrkallaEqualScoreGroups(hits, 2).map((h) => h.shortName);
    expect(r2).toEqual(['C', 'A', 'B', 'D', 'E', 'F']);
    // A better-scored product can never fall behind a worse-scored one.
    for (const rotated of [r1, r2]) {
      expect(rotated.indexOf('F')).toBe(5);
      expect(rotated.slice(0, 3).sort()).toEqual(['A', 'B', 'C']);
    }
  });

  it('different calls hear different tied winners, the same call always the same', () => {
    const seedA = drkallaVarietySeedFromCallId('call_aaa111');
    const seedB = drkallaVarietySeedFromCallId('call_bbb222');
    expect(drkallaVarietySeedFromCallId('call_aaa111')).toBe(seedA); // stable
    expect(drkallaVarietySeedFromCallId('')).toBe(0); // no id -> identity
    const tops = new Set([
      rotateDrkallaEqualScoreGroups(hits, seedA)[0]!.shortName,
      rotateDrkallaEqualScoreGroups(hits, seedB)[0]!.shortName,
      rotateDrkallaEqualScoreGroups(hits, seedA + 1)[0]!.shortName,
    ]);
    // With a 3-way tie at the top, three seeds must reach at least 2 distinct winners.
    expect(tops.size).toBeGreaterThanOrEqual(2);
  });
});

describe('speakable short names (audit fixes)', () => {
  it('keeps shout-cased NAMES instead of dropping them as codes', () => {
    expect(buildDrkallaShortName('OSCAR Herrenparfum EDP 100 ml – Eau de Parfum')).toBe('Oscar Herrenparfum');
    expect(buildDrkallaShortName('YABR LÉONIE INTENSE – Eau de Parfum (100 ml)')).toBe('Léonie Intense');
    expect(buildDrkallaShortName('ARGENT Glanz-Shampoo & B3-PLEX Keravis Sulfatfrei Ceramide')).toBe('Argent Glanz-Shampoo');
  });

  it('never ends on a foreign particle or loses the class noun', () => {
    const malik = buildDrkallaShortName('أنا الملك ANA AL MALIK I AM THE KING – Eau de Parfum für Herren (100 ml)');
    expect(malik).toBe('Malik Parfum');
    expect(buildDrkallaShortName('Ein Set aus zehn Kämmen für Friseursalons')).toContain('Kämmen');
  });
});

describe('chunk-builder boilerplate hygiene', () => {
  it('drops currency-picker junk and keeps repeated nav text only once', async () => {
    const nav = 'Sichere Zahlung mit Klarna und PayPal dort wo sie im Checkout angeboten werden.';
    const snapshot = await buildDrkallaKnowledgeChunks({
      seeds: [
        { sourceId: 'page:a', sourceTitle: 'Versand', category: 'policies', text: `${nav}\n\nBelgien EUR Bulgarien EUR Dänemark DKK Deutschland EUR Estland EUR Finnland EUR Frankreich EUR` },
        { sourceId: 'page:b', sourceTitle: 'AGB', category: 'policies', text: `${nav}\n\nEs gilt deutsches Recht. Gerichtsstand ist Berlin für alle Kaufleute im Sinne des Handelsgesetzbuches.` },
        { sourceId: 'page:c', sourceTitle: 'Warenkorb', category: 'policies', text: 'Bestellanweisungen: Geschätzte Gesamtkosten 0,00 EUR. Steuern, Rabatte und Versand werden beim Checkout berechnet.' },
      ],
      withEmbeddings: false,
      now: new Date('2026-07-05T00:00:00Z'),
    });
    const texts = snapshot.chunks.map((c) => c.text);
    expect(texts.filter((t) => t.includes('Klarna'))).toHaveLength(1); // dupe kept once
    expect(texts.some((t) => t.includes('Bulgarien'))).toBe(false);   // currency picker dropped
    expect(texts.some((t) => t.includes('Gesamtkosten'))).toBe(false); // cart template dropped
    expect(texts.some((t) => t.includes('deutsches Recht'))).toBe(true); // real content survives
  });
});

describe('retriever policy boost', () => {
  it('a policy-intent query prefers the policy page over product marketing copy', async () => {
    const snapshot = await buildDrkallaKnowledgeChunks({
      seeds: [
        {
          sourceId: 'product:waschbecken',
          sourceTitle: 'Luxus Waschbeckenstuhl',
          category: 'usage',
          text: 'Luxus Waschbeckenstuhl mit Kunstlederpolsterung. Die Daten des Stuhls: belastbar, pflegeleicht, mit verstellbarem Becken für alle Daten und Größen im Salonalltag.',
        },
        {
          sourceId: 'page:datenschutz',
          sourceTitle: 'Datenschutzerklärung',
          category: 'policies',
          text: 'Ihre Daten werden gemäß Datenschutzerklärung verarbeitet. Personenbezogene Daten nutzen wir zur Abwicklung der Bestellung.',
        },
      ],
      withEmbeddings: false,
      now: new Date('2026-07-05T00:00:00Z'),
    });
    const retrieve = buildDrkallaKnowledgeRetriever(snapshot, { confidence: 0.1, now: Date.parse('2026-07-05T00:00:00Z') });
    const result = retrieve('Was macht ihr mit meinen Daten?');
    expect(result).not.toBeNull();
    expect(result!.hits[0]!.sourceTitle).toBe('Datenschutzerklärung');
  });
});
