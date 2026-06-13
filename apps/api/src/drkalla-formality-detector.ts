/**
 * Non-mutating formality (Sie vs du) detector for DrKalla agent output.
 *
 * The DrKalla agent must address the caller consistently with "Sie". Auto-
 * rewriting du->Sie is intentionally NOT done here: German conjugation,
 * pronoun, and possessive cascades make safe auto-repair fragile. Instead this
 * detector flags du-form slips in the agent's outgoing text for observability
 * (logging/metrics) so real slip rates can be measured before any rewrite is
 * considered. It never changes the text.
 */

export type DrkallaFormalityResult = {
  hasDuForm: boolean;
  confidence: 'high' | 'medium' | 'none';
  /** Distinct matched tokens (lowercased), for log/metric sampling. */
  slips: string[];
};

// Unambiguous informal singular-address pronouns/possessives. Word boundaries
// keep these from matching inside unrelated words: \bdu\b never matches
// "Duft"/"durch"/"Dusche", \bdir\b never matches "direkt", \bdich\b never
// matches "dicht", \bdein\b only matches the possessive family.
const DU_PRONOUNS = /\b(?:du|dich|dir|dein(?:e|er|es|em|en)?)\b/gi;

// Curated 2nd-person-singular ("du") verb forms. A blanket \w+st\b would match
// non-verbs ("selbst", "Dienst", "Text"), so common conjugations are listed
// explicitly, including ae/oe/ue and ss transliterations. Each ends in -st and
// is a real du-verb, not a noun ("weißt" the verb, never "weiß" the colour).
const DU_VERBS = /\b(?:hast|bist|kannst|willst|musst|sollst|darfst|machst|brauchst|findest|m(?:oe|ö)chtest|schickst|gibst|nimmst|siehst|wei(?:ss|ß)t|h(?:ae|ä)ltst|wirst|w(?:ue|ü)nschst|suchst|meinst|sagst|fragst|kommst|gehst|hoerst|hörst|zeigst)\b/gi;

/**
 * Detect du-form slips in agent text. Pure: no side effects, no text change.
 * A du-pronoun is unambiguous informal address (high confidence). A du-verb
 * with no pronoun is still very likely a slip but slightly less certain
 * (medium). No matches -> not a slip.
 */
export function detectDrkallaDuForm(text: string): DrkallaFormalityResult {
  if (!text || !text.trim()) return { hasDuForm: false, confidence: 'none', slips: [] };
  const pronouns = [...text.matchAll(DU_PRONOUNS)].map((m) => m[0].toLowerCase());
  const verbs = [...text.matchAll(DU_VERBS)].map((m) => m[0].toLowerCase());
  const slips = [...new Set([...pronouns, ...verbs])];
  if (!slips.length) return { hasDuForm: false, confidence: 'none', slips: [] };
  return {
    hasDuForm: true,
    confidence: pronouns.length ? 'high' : 'medium',
    slips,
  };
}
