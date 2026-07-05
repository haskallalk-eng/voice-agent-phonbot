/**
 * FAQ similar-question recognition — regression gate from the 2026-07-05 audit.
 *
 * The old raw-substring matcher recognized 1/25 realistic paraphrases (4%).
 * v2 (word-boundary matching + widened trigger vocabulary) must keep recall on
 * this battery high WITHOUT any false positive on product/consultation turns —
 * a wrong FAQ answer on a phone line is worse than falling through to the
 * KB-grounded model path.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDrkallaFaqMatcher, type DrkallaFaqRawEntry } from '../drkalla-faq-match.js';

const faqPath = path.resolve(process.cwd(), 'data', 'drkalla-rag', 'drkalla-faq.json');
const entries = (JSON.parse(readFileSync(faqPath, 'utf8')) as { entries: DrkallaFaqRawEntry[] }).entries;
const match = buildDrkallaFaqMatcher(entries);

// [expected entry id, caller paraphrase that avoids the original trigger wording]
const PARAPHRASES: Array<[string, string]> = [
  ['phone-order', 'Können Sie das eben für mich in den Warenkorb legen und abschicken?'],
  ['phone-order', 'Nehmen Sie Bestellungen entgegen?'],
  ['phone-order', 'Können Sie die Bestellung für mich aufnehmen?'],
  ['shipping-cost', 'Was kostet der Transport zu mir nach Hause?'],
  ['shipping-cost', 'Was zahle ich fürs Schicken?'],
  ['shipping-cost', 'Wie hoch ist das Porto?'],
  ['delivery-time', 'Wann kommt das Paket denn bei Ihnen raus, wie schnell bekomme ich das?'],
  ['delivery-time', 'Dauert das lange, bis das ankommt?'],
  ['delivery-countries', 'Geht das auch in die Schweiz?'],
  ['delivery-countries', 'Liefern Sie nach Österreich?'],
  ['returns', 'Was ist, wenn mir die Farbe nicht gefällt, krieg ich mein Geld wieder?'],
  ['returns', 'Ich würde das gern zurücksenden.'],
  ['payment', 'Geht Klarna bei euch?'],
  ['payment', 'Nehmt ihr Kreditkarte?'],
  ['payment', 'Kann ich per PayPal zahlen?'],
  ['profi-access', 'Ich habe einen Salon, bekomme ich bessere Preise?'],
  ['profi-access', 'Gibt es Rabatt für Friseure?'],
  ['vegan-cruelty-free', 'Testet ihr an Tieren?'],
  ['invoice', 'Ich brauche einen Beleg für die Steuer.'],
  ['pickup', 'Habt ihr einen Laden, wo ich vorbeischauen kann?'],
  ['pickup', 'Kann ich das im Geschäft mitnehmen?'],
  ['min-order', 'Kann ich auch einzeln bestellen oder braucht es eine kleine Bestellung gar nicht erst versuchen?'],
  ['free-shipping-threshold', 'Ab welchem Betrag zahle ich nichts für den Versand?'],
  ['discount', 'Habt ihr gerade einen Rabattcode?'],
  ['newsletter', 'Wie kann ich den Newsletter abbestellen?'],
  ['account-deletion', 'Ich möchte mein Kundenkonto löschen.'],
  ['privacy', 'Was macht ihr eigentlich mit meinen Daten?'],
];

// Product/consultation/contact turns that must NEVER get a canned FAQ answer.
const NEGATIVES: string[] = [
  'Ich suche ein Shampoo für lockige Haare.',
  'Was kostet das Farbschutz Shampoo?',
  'Wie lange muss die Farbe einwirken?',
  'Habt ihr auch Scheren im Sortiment?',
  'Mein Haar ist total trocken, was empfehlen Sie?',
  'Ich möchte mit einem Menschen sprechen.',
  'Wie heißen Sie eigentlich?',
  'Haben Sie sowas im Angebot?',
  'Die Berechnung auf der Seite kommt mir komisch vor.', // "rechnung" must not fire inside "Berechnung"
  'Welche Farbe würden Sie mir empfehlen?',
];

describe('drkalla faq paraphrase recall', () => {
  const MIN_RECALL = 0.8;

  it(`recognizes at least ${MIN_RECALL * 100}% of realistic paraphrases with the right entry`, () => {
    const misses: string[] = [];
    let hits = 0;
    for (const [want, q] of PARAPHRASES) {
      const m = match(q);
      if (m?.id === want) hits += 1;
      else misses.push(`"${q}" -> ${m?.id ?? 'null'} (wollte ${want})`);
    }
    expect(hits / PARAPHRASES.length, `misses:\n${misses.join('\n')}`).toBeGreaterThanOrEqual(MIN_RECALL);
  });

  it('never matches product/consultation/contact turns (zero false positives)', () => {
    for (const q of NEGATIVES) {
      const m = match(q);
      expect(m, `"${q}" falsely matched ${m?.id}`).toBeNull();
    }
  });

  it('word-boundary matching: a trigger only fires at a word start, compounds still match', () => {
    const m = buildDrkallaFaqMatcher([
      { id: 'x', triggers: ['rechnung', 'versandkosten'], answer: 'Antwort für den Test hier.' },
    ]);
    expect(m('die Berechnung stimmt nicht')).toBeNull();
    expect(m('brauche eine Rechnung')?.id).toBe('x');
    expect(m('wie hoch ist die Versandkostenpauschale')?.id).toBe('x');
  });
});
