import { describe, expect, it } from 'vitest';
import { detectDrkallaUserProductType } from '../drkalla-product-type-detector.js';

describe('DrKalla product type detector', () => {
  it.each([
    ['Ich suche Haarfarben.', 'Haarfarbe/Farbcreme'],
    ['Habt ihr Salonwagen?', 'Salonmöbel/-ausstattung'],
    ['Habt ihr Sprühflaschen?', 'Salon-Verbrauchsmaterial'],
    ['Ich brauche Watteschnur.', 'Salon-Verbrauchsmaterial'],
    ['Habt ihr Spiegel?', 'Salon-Zubehör'],
    ['Ich suche einen Aufsteller.', 'Salon-Zubehör'],
    ['Ich suche einen Servicewagen.', 'Salon-Zubehör'],
    ['Habt ihr Kosmetikwagen?', 'Salon-Zubehör'],
    ['Ich brauche einen Haarsauger.', 'Friseur-Tool'],
    ['Habt ihr Clean All?', 'Friseur-Tool'],
    ['Ich suche Alligatorclips.', 'Styling'],
    ['Habt ihr Hair-Clips?', 'Styling'],
    ['Ich brauche Handtücher.', 'Salon-Verbrauchsmaterial'],
    ['Habt ihr Strähnenhauben?', 'Friseur-Tool'],
    ['Habt ihr Kosmetikbedarf?', 'Kosmetikbedarf'],
    ['Habt ihr Depilationszubehör?', 'Kosmetikbedarf'],
    ['Ich brauche Hitzeschutz.', 'Haarpflege'],
    ['Habt ihr Ampullen?', 'Haarpflege'],
    ['Ich suche Nackenstreifen.', 'Salon-Verbrauchsmaterial'],
    ['Habt ihr Haarschaum?', 'Styling'],
    ['Ich brauche Bright-Wax.', 'Styling'],
    ['Habt ihr Glanz-Spray?', 'Styling'],
    ['Habt ihr Laminier-Spray?', 'Styling'],
    ['Ich suche Vorbereitungsshampoo.', 'Shampoo'],
    ['Habt ihr Strähnchenfolie?', 'Friseur-Tool'],
    ['Ich brauche Blond-Booster.', 'Blondierung'],
    ['Habt ihr Desinfektionswagen?', 'Salonmöbel/-ausstattung'],
    ['Ich brauche eine UVC Lampe.', 'Friseur-Tool'],
  ])('detects "%s" as %s', (text, expectedProductType) => {
    expect(detectDrkallaUserProductType(text)).toBe(expectedProductType);
  });
});
