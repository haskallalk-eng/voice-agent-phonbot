/**
 * Conservative German utterance-completeness check for content-aware turn-taking.
 *
 * Retell endpointed mid-sentence on a real call (2026-06-14): the caller said
 * "Ich möchte mein Produkt irgendwie kaufen. Und" — Retell thought the turn
 * ended (it even inserted a period), the agent started answering, the caller
 * kept talking, and the agent's fragment was cut off ("Darf…"). Raising Retell's
 * global responsiveness would make EVERY turn wait — dumb. Instead we look at the
 * CONTENT: if the just-finished utterance clearly dangles (ends on a conjunction,
 * a bare article/preposition or a filler), the agent stays silent for that turn
 * and lets the caller finish; otherwise it answers immediately.
 *
 * Design rule: PRECISION over recall. A false hold (going silent when the caller
 * actually finished) is the only harmful error, so the detector only fires on
 * unambiguous "more is coming" signals. It deliberately MISSES ambiguous cases
 * (trailing definite article/demonstrative "das", separable-prefix particles
 * "an/auf/zu/mit", bare subject pronouns, trailing numbers) and answers them —
 * that is the current behaviour, never worse. The hold is also bounded by the
 * caller (their next words arrive as a fresh turn) and by Retell's silence
 * reminder, so a misfire can never leave the agent permanently silent.
 */

// Single-token answers/closings that are COMPLETE on their own — never hold.
const COMPLETE_SHORT = new Set([
  'ja', 'jawohl', 'jo', 'joa', 'jepp', 'jep', 'klar', 'gerne', 'gern', 'okay', 'ok', 'oki',
  'gut', 'passt', 'stimmt', 'richtig', 'genau', 'korrekt', 'doch',
  'nein', 'nee', 'ne', 'noe', 'nö', 'nope',
  'danke', 'dankeschön', 'merci',
  'tschüss', 'tschüssi', 'tschau', 'tschö', 'ciao', 'wiederhören', 'bye',
  'hallo', 'hi', 'hey', 'hej', 'moin', 'servus', 'mhm', 'aha', 'hm',
]);

// Dangling LAST token → the speaker is mid-build. These almost never end a turn.
const DANGLING_CONJ = new Set([
  'und', 'oder', 'aber', 'sondern', 'denn', 'sowie', 'beziehungsweise', 'bzw', 'zwar',
  'weil', 'dass', 'daß', 'damit', 'obwohl', 'sodass', 'sobald', 'bevor', 'nachdem',
  'falls', 'während', 'indem', 'ob', 'wobei', 'sofern', 'sowohl', 'entweder',
]);
// Indefinite/negation determiners demand a following noun (definite der/die/das are
// excluded — they double as demonstratives that DO end a clause, e.g. "Ich nehme das").
const DANGLING_DET = new Set([
  'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'kein', 'keine', 'keinen', 'keinem', 'keiner', 'keines',
]);
// Prepositions that are NOT common separable verb prefixes, so a trailing one is a
// missing object. (an/auf/aus/mit/zu/um/in/im/bei/vor/nach/ab/über/unter are excluded
// because they double as separable prefixes that DO end a clause: "Ich rufe an.")
const DANGLING_PREP = new Set([
  'für', 'von', 'wegen', 'gegen', 'ohne', 'seit', 'zwischen', 'neben', 'hinter',
  'gegenüber', 'trotz', 'statt', 'samt', 'bezüglich',
]);
// Trailing hesitation/filler → still buffering.
const TRAILING_FILLER = new Set(['äh', 'ähm', 'öhm', 'ähem', 'hmm', 'also', 'tja']);

function tokenize(text: string): string[] {
  return text
    .toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // strip punctuation (ASR periods are unreliable)
    .split(/\s+/)
    .filter(Boolean);
}

export function looksIncompleteDrkallaUtterance(
  text: string,
  opts: { pendingQuestion?: boolean } = {},
): boolean {
  void opts; // reserved: a pending agent question makes short answers complete
  const raw = (text ?? '').trim();
  if (!raw) return false; // empty = call opener, handled by the greeting path
  if (raw.includes('?')) return false; // a question is a complete turn
  const toks = tokenize(raw);
  if (!toks.length) return false;
  const last = toks[toks.length - 1]!;

  // A bare known short answer ("ja", "danke", "tschüss") is always complete.
  if (toks.length === 1 && COMPLETE_SHORT.has(last)) return false;

  // Unambiguous "more is coming" signals on the LAST token.
  if (DANGLING_CONJ.has(last)) return true;
  if (DANGLING_DET.has(last)) return true;
  if (DANGLING_PREP.has(last)) return true;
  if (TRAILING_FILLER.has(last)) return true;

  // Trailing "am besten" / "am liebsten" with no head noun yet.
  if (toks.length >= 2) {
    const lastTwo = `${toks[toks.length - 2]} ${last}`;
    if (lastTwo === 'am besten' || lastTwo === 'am liebsten') return true;
  }

  return false;
}
