import { describe, expect, it } from 'vitest';
import { speakDrkallaText, speakDrkallaPriceText } from '../drkalla-speakable.js';

describe('speakDrkallaText TTS normalization', () => {
  it('renders the brand as "Doktor Kalla"', () => {
    expect(speakDrkallaText('Vielen Dank für Ihren Anruf bei Dr.Kalla. Auf Wiederhören!'))
      .toBe('Vielen Dank für Ihren Anruf bei Doktor Kalla. Auf Wiederhören!');
    expect(speakDrkallaText('der Assistent von Dr. Kalla')).toBe('der Assistent von Doktor Kalla');
  });

  it('speaks the written website as the brand, not the letters of the handle', () => {
    // Live complaint 2026-06-27: "drkalla.com" was read as letters; it must be
    // SPOKEN as the brand "Doktor Kalla punkt com".
    expect(speakDrkallaText('Sie finden das auf drkalla.com.')).toBe('Sie finden das auf Doktor Kalla punkt com.');
    expect(speakDrkallaText('auf drkalla.com')).toContain('Doktor Kalla punkt com');
    // a written email domain is spoken the same consistent way
    expect(speakDrkallaText('Schreiben Sie an kontakt@drkalla.com.')).toBe('Schreiben Sie an kontakt at Doktor Kalla punkt com.');
  });

  it('spells decimal cents as words so the voice never reads "Euro O"', () => {
    // Live complaints 2026-06-27 .. 2026-06-30: a whole-euro price read ",00" as
    // an extra "o o", and decimal cents ("7,60") were read digit-by-digit
    // ("...sechs null"). Whole euros drop the cents; decimals spell them out.
    expect(speakDrkallaText('Es kostet 9,00 Euro.')).toBe('Es kostet 9 Euro.');
    expect(speakDrkallaText('10,00 €')).toBe('10 Euro');
    expect(speakDrkallaText('von 9,00 Euro bis 11,99 Euro')).toBe('von 9 Euro bis 11 Euro neunundneunzig');
    expect(speakDrkallaText('Es kostet 11,99 Euro.')).toBe('Es kostet 11 Euro neunundneunzig.');
    expect(speakDrkallaText('7,60 Euro')).toBe('7 Euro sechzig');
    expect(speakDrkallaText('9,05 Euro')).toBe('9 Euro fünf');
    expect(speakDrkallaText('22,90 Euro')).toBe('22 Euro neunzig');
    // A SINGLE cent digit is tenths: "7,5 Euro" = 7 Euro 50 (review fix 2026-06-30).
    expect(speakDrkallaText('7,5 Euro')).toBe('7 Euro fünfzig');
    expect(speakDrkallaText('9,5 EUR')).toBe('9 Euro fünfzig');
    // A bare "EUR" abbreviation is said as the word, never spelled "E-U-R".
    expect(speakDrkallaText('Das macht 9 EUR.')).toBe('Das macht 9 Euro.');
    // The "Euro O" shapes — a comma-decimal or a digit AFTER "Euro" — never survive
    // (the spoken euro amount "8 Euro" is fine; only "8,40" / "Euro 40" are wrong).
    expect(speakDrkallaText('8,40 Euro')).not.toMatch(/,\d|Euro\s*\d/);
  });

  it('speakDrkallaPriceText normalizes a price mid-sentence for streamed model frames', () => {
    expect(speakDrkallaPriceText('Das Locken Shampoo kostet 7,60 Euro und pflegt.'))
      .toBe('Das Locken Shampoo kostet 7 Euro sechzig und pflegt.');
    expect(speakDrkallaPriceText('Der Neutralisator kostet 12 Euro.')).toBe('Der Neutralisator kostet 12 Euro.');
    expect(speakDrkallaPriceText('Das gibt es ab 8.40 EUR.')).toBe('Das gibt es ab 8 Euro vierzig.');
  });

  it('spells a BARE decimal price (model dropped the "Euro" word) so it is never read digit-by-digit', () => {
    // Review/live 2026-06-30..07-01: the model occasionally emits a price without a
    // currency word ("das macht 24,50") — the voice read ",50" as "...fünf null".
    expect(speakDrkallaPriceText('Das macht dann 24,50.')).toBe('Das macht dann 24 fünfzig.');
    expect(speakDrkallaPriceText('Der Preis ist 12,00 zusammen.')).toBe('Der Preis ist 12 zusammen.');
    // Measurement / percent units are NOT prices — leave them untouched.
    expect(speakDrkallaPriceText('Die Flasche hat 1,50 l Inhalt.')).toBe('Die Flasche hat 1,50 l Inhalt.');
    expect(speakDrkallaPriceText('Enthält 3,50 % Wirkstoff.')).toBe('Enthält 3,50 % Wirkstoff.');
  });

  it('expands symbols and abbreviations', () => {
    expect(speakDrkallaText('Glanz & Pflege')).toBe('Glanz und Pflege');
    expect(speakDrkallaText('20% Rabatt')).toBe('20 Prozent Rabatt');
    expect(speakDrkallaText('z.B. Haarfarbe')).toBe('zum Beispiel Haarfarbe');
    expect(speakDrkallaText('5 € pro Stück')).toBe('5 Euro pro Stück');
  });

  it('leaves clean German text and SMS/E-Mail untouched', () => {
    const clean = 'Soll ich Ihnen den Link per SMS schicken?';
    expect(speakDrkallaText(clean)).toBe(clean);
    expect(speakDrkallaText('Hallo, hier ist der Assistent von Doktor Kalla Cosmetics. Wie kann ich Ihnen beim Friseurbedarf helfen?'))
      .toBe('Hallo, hier ist der Assistent von Doktor Kalla Cosmetics. Wie kann ich Ihnen beim Friseurbedarf helfen?');
  });
});
