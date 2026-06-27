import { describe, expect, it } from 'vitest';
import { speakDrkallaText } from '../drkalla-speakable.js';

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

  it('drops ,00 cents (no "null null") but keeps real decimal prices', () => {
    // Live complaint 2026-06-27: a whole-euro price read ",00" as an extra "o o".
    expect(speakDrkallaText('Es kostet 9,00 Euro.')).toBe('Es kostet 9 Euro.');
    expect(speakDrkallaText('10,00 €')).toBe('10 Euro');
    expect(speakDrkallaText('von 9,00 Euro bis 11,99 Euro')).toBe('von 9 Euro bis 11,99 Euro');
    expect(speakDrkallaText('Es kostet 11,99 Euro.')).toBe('Es kostet 11,99 Euro.');
    expect(speakDrkallaText('9,05 Euro')).toBe('9,05 Euro');
    expect(speakDrkallaText('22,90 Euro')).not.toContain('22 Euro 90');
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
