import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  pool: null,
}));

vi.mock('../redis.js', () => ({
  redis: null,
}));

vi.mock('../logger.js', () => {
  const noop = () => {};
  return {
    log: { info: noop, warn: noop, error: noop, debug: noop },
    logBg: () => noop,
  };
});

const {
  PUBLIC_PHONE_DEMO_BEGIN_MESSAGE,
  PUBLIC_PHONE_DEMO_DENOISING_MODE,
  PUBLIC_PHONE_DEMO_END_CALL_DESCRIPTION,
  PUBLIC_PHONE_DEMO_FIXED_GOODBYE,
  PUBLIC_PHONE_DEMO_INTERRUPTION_SENSITIVITY,
  PUBLIC_PHONE_DEMO_PROMPT,
  PUBLIC_PHONE_DEMO_REMINDER_MAX_COUNT,
  PUBLIC_PHONE_DEMO_RESPONSIVENESS,
  buildPublicPhoneDemoPrompt,
} = await import('../scripts/sync-public-demo-phone.js');

describe('public demo transcript-driven A/B regressions', () => {
  it('A asks recording consent before the name; B starts name-first and informs after the name', () => {
    const legacyBeginMessage =
      'Hi, hier ist Chipy von Phonbot, ein KI-Telefonassistent. Bist du damit einverstanden?';

    expect(legacyBeginMessage).toContain('Bist du damit einverstanden?');
    expect(PUBLIC_PHONE_DEMO_BEGIN_MESSAGE).toBe('Hi, hier ist Chippy von PhoneBot. Mit wem darf ich sprechen?');
    expect(PUBLIC_PHONE_DEMO_BEGIN_MESSAGE).not.toMatch(/einverstanden|Aufzeichnung|Speicherung|Transkript/i);
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('Hallo {Name}. Zur Qualitaetssicherung wird dieser Demo-Anruf');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('Wenn du das nicht moechtest, beende bitte jetzt den Anruf');
  });

  it('A repeats the two-option mode prompt after inaudible speech; B uses a hearing repair prompt', () => {
    const legacyTranscript = [
      'Agent: Ich kann dir die Demo zeigen oder Fragen zu PhoneBot beantworten.',
      'User: (inaudible speech)',
      'Agent: Ich kann dir die Demo zeigen oder Fragen zu PhoneBot beantworten.',
    ].join('\n');

    expect(legacyTranscript.match(/Ich kann dir die Demo zeigen/g)?.length).toBe(2);
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('Unhoerbare Sprache ist immer ein Reparatur-Turn');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('erstes Mal "Wie bitte?"');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('zweites Mal "Ich habe es akustisch nicht verstanden');
  });

  it('A refuses confirmation SMS vaguely; B explains simulated test link and appointment-confirmation content', () => {
    const legacyAnswer =
      'Gern, in dieser Demo kann ich keine echte SMS senden. Ich kann dir aber den Bestaetigungs-Text hier kurz formulieren.';

    expect(legacyAnswer).not.toContain('PhoneBot-Testlink');
    expect(legacyAnswer).not.toContain('Terminbestaetigung');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('PhoneBot-Testlink');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('normale Kunden-SMS die Terminbestaetigung enthalten wuerde');
  });

  it('A leaves date pronunciation underspecified; B requires natural spoken German dates and weekdays', () => {
    const legacyPrompt = 'Sage Uhrzeiten natuerlich: zehn Uhr.';

    expect(legacyPrompt).not.toContain('Montag, den');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('Datum und Uhrzeit langsam und natuerlich sprechen');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('Montag, den ersten Juni um dreizehn Uhr');
  });

  it('A gives a too-short self-goodbye; B uses one warmer fixed goodbye and then ends once', () => {
    const legacyGoodbye = 'Alles klar, danke dir fuers Testen. Ich wuensche dir noch einen schoenen Tag. Tschuess!';

    expect(legacyGoodbye).toMatch(/fuers|wuensche|Tschuess/);
    expect(PUBLIC_PHONE_DEMO_FIXED_GOODBYE).toBe(
      'Danke dir fürs Testen. Wenn du weiter ausprobieren möchtest, ruf jederzeit wieder an. Einen schönen Tag noch. Tschüss!',
    );
    expect(PUBLIC_PHONE_DEMO_FIXED_GOODBYE).not.toMatch(/fuers|wuensche|Tschuess/);
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain(`sage exakt "${PUBLIC_PHONE_DEMO_FIXED_GOODBYE}"`);
    expect(PUBLIC_PHONE_DEMO_PROMPT).not.toContain('ich beende die Demo');
  });

  it('A hangs up after inaudible speech; B treats inaudible speech as a general repair turn', () => {
    const legacyTranscript = [
      'Agent: Morgen ist Dienstag, der 2. Juni 2026.',
      'User: (inaudible speech)',
      'Agent: Alles klar, danke dir fuers Testen. Ich wuensche dir noch einen schoenen Tag. Tschuess!',
    ].join('\n');

    expect(legacyTranscript).toContain('User: (inaudible speech)');
    expect(legacyTranscript).toContain('Tschuess!');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('Unhoerbare Sprache ist immer ein Reparatur-Turn');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('nie Zustimmung, Abschied oder End-Call');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('drittes Mal "Die Verbindung ist gerade schwer zu verstehen');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('Retell-Silence-Frist');
    expect(PUBLIC_PHONE_DEMO_END_CALL_DESCRIPTION).toContain('Never call after inaudible speech');
  });

  it('A skips an unheard caller name; B asks an acoustic repair and does not mark the name as known', () => {
    const legacyTranscript = [
      'Agent: Hi, hier ist Chippy von PhoneBot. Mit wem darf ich sprechen?',
      'User: mein Name ist (inaudible speech)',
      'Agent: Hallo. Zur Qualitätssicherung wird dieser Demo-Anruf aufgezeichnet.',
      'Agent: Ich nutze den Namen aus eben.',
    ].join('\n');

    expect(legacyTranscript).toContain('Agent: Hallo.');
    expect(legacyTranscript).toContain('Namen aus eben');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('keinen verwertbaren Namen');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('sage nicht "Hallo" ohne Namen');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('Wie bitte? Ich habe deinen Namen akustisch nicht verstanden');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('merke: name_unknown');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('Der Name aus dem Start ist nur dann der Demo-Kundenname');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('behaupte spaeter nicht, der Name sei bekannt');
  });

  it('A treats missing required values as filled; B repairs any expected field without ending the call', () => {
    const legacyBehavior = 'Agent asked for service, heard no usable value, then booked anyway or ended the call.';

    expect(legacyBehavior).toContain('no usable value');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('Pflichtfeld-Regel');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('Name, Service, Datum, Uhrzeit, Produkt oder Kontaktweg');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('keinen sicher verwertbaren Wert');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('frage kurz nach diesem Wert');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('statt ihn zu erfinden, zu ueberspringen oder spaeter als bekannt zu verwenden');
    expect(PUBLIC_PHONE_DEMO_END_CALL_DESCRIPTION).toContain('Never call while collecting name, service, date, time, contact, or confirmation');
  });

  it('A lets the year sound like twenty-twenty-six fragments; B requires spoken German year words', () => {
    const promptWithDate = buildPublicPhoneDemoPrompt(new Date('2026-06-01T10:00:00.000Z'));

    expect(promptWithDate).toContain('morgen: Dienstag, 2026-06-02');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('Jahreszahlen natuerlich als deutsches Jahr sprechen');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('2026 = "zweitausendsechsundzwanzig"');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('nicht "zwanzig sechs"');
  });

  it('documents current Retell hearing knobs separately from true low-volume audio capture', () => {
    expect(PUBLIC_PHONE_DEMO_RESPONSIVENESS).toBe(0.87);
    expect(PUBLIC_PHONE_DEMO_INTERRUPTION_SENSITIVITY).toBe(0.77);
    expect(PUBLIC_PHONE_DEMO_DENOISING_MODE).toBe('no-denoise');
    expect(PUBLIC_PHONE_DEMO_REMINDER_MAX_COUNT).toBe(0);
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('Retell-Hoergrenzen');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('responsiveness und interruption_sensitivity');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('nicht als sicher verstandenen Inhalt behandeln');
  });
});
