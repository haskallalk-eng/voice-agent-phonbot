import { describe, expect, it } from 'vitest';
import { speakDrkallaText } from '../drkalla-speakable.js';

describe('speakDrkallaText TTS normalization', () => {
  it('renders the brand as "Doktor Kalla"', () => {
    expect(speakDrkallaText('Vielen Dank für Ihren Anruf bei Dr.Kalla. Auf Wiederhören!'))
      .toBe('Vielen Dank für Ihren Anruf bei Doktor Kalla. Auf Wiederhören!');
    expect(speakDrkallaText('der Assistent von Dr. Kalla')).toBe('der Assistent von Doktor Kalla');
  });

  it('speaks the domain/email without mangling the handle into the brand name', () => {
    expect(speakDrkallaText('Sie finden das auf drkalla.com.')).toBe('Sie finden das auf drkalla punkt com.');
    expect(speakDrkallaText('Schreiben Sie an kontakt@drkalla.com.')).toBe('Schreiben Sie an kontakt at drkalla punkt com.');
    // the lowercase domain handle must NOT become "Doktor Kalla"
    expect(speakDrkallaText('auf drkalla.com')).not.toContain('Doktor Kalla');
  });

  it('speaks money naturally (no comma-zeros)', () => {
    expect(speakDrkallaText('Es kostet 9,00 Euro.')).toBe('Es kostet 9 Euro.');
    expect(speakDrkallaText('Es kostet 11,99 Euro.')).toBe('Es kostet 11 Euro 99.');
    expect(speakDrkallaText('von 9,00 Euro bis 11,99 Euro')).toBe('von 9 Euro bis 11 Euro 99');
    expect(speakDrkallaText('9,05 Euro')).toBe('9 Euro 5'); // drop the leading zero
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
    expect(speakDrkallaText('Hallo, hier ist der Assistent von Doktor Kalla. Wie kann ich Ihnen beim Friseurbedarf helfen?'))
      .toBe('Hallo, hier ist der Assistent von Doktor Kalla. Wie kann ich Ihnen beim Friseurbedarf helfen?');
  });
});
