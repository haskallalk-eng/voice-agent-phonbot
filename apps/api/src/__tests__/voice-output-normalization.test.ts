import { describe, expect, it } from 'vitest';
import { normalizeGermanVoiceOutput } from '../voice-output-normalization.js';

describe('German voice output normalization contract', () => {
  it('keeps web output written while voice output gets spokenText', () => {
    const web = normalizeGermanVoiceOutput({
      mode: 'web',
      text: 'Mo-Fr 9-18 Uhr',
    });
    const voice = normalizeGermanVoiceOutput({
      mode: 'voice',
      text: 'Mo-Fr 9-18 Uhr',
    });

    expect(web.spokenText).toBe('Mo-Fr 9-18 Uhr');
    expect(web.transformations).toEqual([]);
    expect(voice.writtenText).toBe('Mo-Fr 9-18 Uhr');
    expect(voice.spokenText).toBe('Montag bis Freitag von neun bis achtzehn Uhr');
    expect(voice.transformations.map((item) => item.kind)).toEqual(['weekday_range', 'opening_hours']);
  });

  it('normalizes dates, prices, phone numbers, email addresses, URLs, addresses, and acronyms', () => {
    const result = normalizeGermanVoiceOutput({
      mode: 'voice',
      text: 'Am 29.05.2026 kostet es 89,90 Euro. Ruf +49 176 12345678 an, Mail max.test@example.de, https://phonbot.de/kontakt, Hauptstr. 12, FAQ der Beispiel GmbH.',
    });

    expect(result.spokenText).toContain('neunundzwanzigster Mai zweitausendsechsundzwanzig');
    expect(result.spokenText).toContain('neunundachtzig Euro neunzig');
    expect(result.spokenText).toContain('plus vier neun eins sieben sechs eins zwei drei vier fuenf sechs sieben acht');
    expect(result.spokenText).toContain('max punkt test at example punkt de');
    expect(result.spokenText).toContain('phonbot punkt de slash kontakt');
    expect(result.spokenText).toContain('Hauptstrasse zwoelf');
    expect(result.spokenText).toContain('F A Q');
    expect(result.spokenText).toContain('G M B H');
    expect(result.transformations.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'date',
      'price',
      'phone',
      'email',
      'url',
      'address',
      'acronym',
    ]));
  });

  it('preserves pricing/legal/policy written facts instead of rounding or reinterpreting values', () => {
    const result = normalizeGermanVoiceOutput({
      mode: 'voice',
      text: 'Policy: Starter kostet 89,90 Euro und gilt bis 01.06.2026.',
    });

    expect(result.writtenText).toContain('89,90 Euro');
    expect(result.writtenText).toContain('01.06.2026');
    expect(result.transformations.every((item) => item.factPreserved)).toBe(true);
    expect(result.spokenText).toContain('neunundachtzig Euro neunzig');
    expect(result.spokenText).toContain('erster Juni zweitausendsechsundzwanzig');
  });

  it('marks brand, product, staff, city, or street names for review when requested', () => {
    const result = normalizeGermanVoiceOutput({
      mode: 'voice',
      text: 'Bitte Termin bei Xenia in Koeln-Ehrenfeld buchen.',
      reviewNames: ['Xenia', 'Koeln-Ehrenfeld'],
    });

    expect(result.reviewRequired).toBe(true);
    expect(result.transformations.filter((item) => item.kind === 'name_review')).toEqual([
      expect.objectContaining({ written: 'Xenia', spoken: 'Xenia', reviewRequired: true }),
      expect.objectContaining({ written: 'Koeln-Ehrenfeld', spoken: 'Koeln-Ehrenfeld', reviewRequired: true }),
    ]);
  });

  it('keeps provider-specific pronunciation hints out of the core normalization result', () => {
    const result = normalizeGermanVoiceOutput({
      mode: 'voice',
      text: 'API und URL bitte nicht technisch vorlesen.',
    });

    expect(result.spokenText).toContain('A P I');
    expect(result.spokenText).toContain('U R L');
    expect(Object.keys(result)).not.toContain('providerPronunciationDictionary');
    expect(Object.keys(result)).not.toContain('ssml');
  });
});
