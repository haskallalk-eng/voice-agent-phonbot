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

// A trailing KNOWN hair/condition descriptor adjective in an ATTRIBUTIVE form is
// a mid-build dangle: the head noun ("Haare") is still coming. Live 2026-06-29:
// the caller said "…sind meine lockigen" and the agent jumped in on "Da" and was
// cut off by "Haare." We cannot use a generic "-e ending" test — most feminine/
// plural nouns end the same way ("eine Maske", "meine Haare", "meine Locken"),
// and holding on those would be the one harmful error (false hold). So we require
// BOTH: (1) the root is a known descriptor adjective (never a noun in this
// domain) AND (2) it carries an attributive inflection -e/-en/-es/-em. German
// PREDICATIVE adjectives are always BARE ("die Haare sind trocken"), so an
// inflected descriptor can only be attributive ("trockene …") → a noun follows.
// -er is deliberately excluded (it doubles as the predicative comparative
// "heller"/"feiner", which DOES end a clause).
// Roots are written so that root + one of -e/-en/-es/-em is exactly the
// ATTRIBUTIVE form ("trocken"+"e"="trockene", "strapaziert"+"e"="strapazierte").
// The bare predicative form (root with no ending, e.g. "strapaziert",
// "trocken") never matches, so "die Haare sind trocken" is correctly NOT held.
// Adjectives whose lemma itself ends in -e (spröde, müde) are excluded — they can
// be predicative AND already end in -e, which we cannot tell apart safely.
const TRAILING_DESCRIPTOR_ADJ =
  /^(?:trocken|feucht|fettig|lockig|wellig|glatt|kraus|fein|dick|d(?:ü|ue)nn|kaputt|blond|braun|schwarz|grau|dunkl|gef(?:ä|ae)rbt|coloriert|gestr(?:ä|ae)hnt|strapaziert|gesch(?:ä|ae)digt|br(?:ü|ue)chig|empfindlich|gereizt|stumpf)(?:e|en|es|em)$/i;

// A definite article / demonstrative right before the descriptor marks a
// NOMINALIZED ELLIPTICAL answer ("nimm die schwarze" = the black one), which is a
// COMPLETE turn — not the attributive dangle ("meine lockigen" → "Haare" coming).
// We must never hold these (a false hold is the only harmful error). Possessives /
// indefinites (meine, eine, keine) are NOT here — those ARE the mid-build signal.
const DEFINITE_BEFORE_ADJ = new Set([
  'die', 'der', 'das', 'den', 'dem', 'des',
  'dies', 'diese', 'dieser', 'dieses', 'diesen', 'diesem',
  'welche', 'welcher', 'welches', 'welchen', 'welchem',
]);

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

  // Trailing attributive descriptor adjective with the head noun still to come
  // ("…meine lockigen", "ich habe trockene"). Multi-word so a single bare adjective
  // ("trocken.") is never wrongly held. NOT held when a definite article precedes
  // it (nominalized elliptical answer "die schwarze") or a question is pending
  // (the descriptor is the caller's complete reply) — both would be false holds.
  if (
    toks.length >= 2
    && TRAILING_DESCRIPTOR_ADJ.test(last)
    && !opts.pendingQuestion
    && !DEFINITE_BEFORE_ADJ.has(toks[toks.length - 2]!)
  ) {
    return true;
  }

  return false;
}
