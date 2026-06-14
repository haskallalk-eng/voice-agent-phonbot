import { describe, expect, it } from 'vitest';
import { looksIncompleteDrkallaUtterance } from '../drkalla-turn-completeness.js';

describe('DrKalla utterance completeness (content-aware turn hold)', () => {
  // The ONLY harmful error is a false hold (silence when the caller finished).
  // Every complete/answer/question/request utterance MUST be answered (false).
  const mustRespond = [
    'Eine dauerhafte Farbe.',                                   // complete NP answer (real call)
    'Ich möchte mein Produkt irgendwie kaufen. Und zwar Haarfarben, am besten eine dauerhafte Farbe.',
    'Ja', 'Nein', 'Nee, alles gut', 'Danke', 'Tschüss', 'Okay', 'Genau', 'Doch',
    'Was kostet das?', 'Wie teuer ist die dauerhafte Farbe?', 'Haben Sie geöffnet?',
    'Wann haben Sie geöffnet', 'Hallo?', 'Können Sie das wiederholen?',
    'Ich suche ein Shampoo für lockiges Haar.',
    'Ich möchte eine dauerhafte Haarfarbe kaufen.',
    'Koleston Perfect.', 'Ja, per SMS bitte.', 'Ja, schicken Sie mir den Link.',
    'Ich weiß nicht', 'Das machen Sie.', 'Ich rufe an.', 'Ich nehme das mit.',
  ];
  for (const text of mustRespond) {
    it(`responds (never holds) on: ${text}`, () => {
      expect(looksIncompleteDrkallaUtterance(text)).toBe(false);
    });
  }

  // Unambiguous "still talking" — these SHOULD hold.
  const mustHold = [
    'Ich möchte mein Produkt irgendwie kaufen. Und',  // real failing fragment
    'Und', 'und zwar', 'Ich suche eine Haarfarbe und', 'Ich brauche Shampoo oder',
    'Das ist gut, aber', 'Nicht das Rote, sondern', 'Ich nehme es, weil',
    'Können Sie mir sagen, ob', 'Geben Sie mir bitte ein', 'Ich will eine Farbe für',
    'Guten Tag, ich rufe an wegen', 'Also', 'Ähm', 'Ja also', 'Ich brauche äh',
    'und am besten',
  ];
  for (const text of mustHold) {
    it(`holds on: ${text}`, () => {
      expect(looksIncompleteDrkallaUtterance(text)).toBe(true);
    });
  }

  it('a pending question does not force a hold on a complete answer', () => {
    expect(looksIncompleteDrkallaUtterance('Schwarz.', { pendingQuestion: true })).toBe(false);
  });

  it('empty opener is treated as complete (greeting path owns it)', () => {
    expect(looksIncompleteDrkallaUtterance('')).toBe(false);
    expect(looksIncompleteDrkallaUtterance('   ')).toBe(false);
  });
});
