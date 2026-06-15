/**
 * Deterministic curated-FAQ matcher for the DrKalla voice agent.
 *
 * For STABLE general questions (shipping, returns, payment, profi access …) a
 * human-approved answer is faster (no model call) and higher quality (no
 * hallucination) than the model. This layer is ADDITIVE and conservative: it
 * runs AFTER the grounded structured paths (contact/price/product) and only
 * returns an answer on a high-confidence trigger match; on no match it returns
 * null and the normal model/discovery path answers exactly as before. Pure
 * in-memory, no LLM/KB/network. Answers are curated to be Sie-form + TTS-clean.
 */

export type DrkallaFaqEntry = {
  id: string;
  triggers: string[];
  answer: string;
  tags?: string[];
  enabled?: boolean;
};

export type DrkallaFaqRawEntry = {
  id?: unknown;
  triggers?: unknown;
  answer?: unknown;
  tags?: unknown;
  enabled?: unknown;
};

export type DrkallaFaqMatch = { id: string; answer: string; tags: string[] };
export type DrkallaFaqMatcher = (text: string) => DrkallaFaqMatch | null;

export function normalizeDrkallaFaqText(value: string): string {
  return ` ${value
    .toLocaleLowerCase('de-DE')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

type IndexedFaq = { id: string; answer: string; tags: string[]; triggers: string[] };

export function buildDrkallaFaqMatcher(entries: DrkallaFaqRawEntry[]): DrkallaFaqMatcher {
  const indexed: IndexedFaq[] = [];
  for (const entry of entries) {
    if (entry?.enabled === false) continue; // drafts awaiting a real value
    if (typeof entry?.id !== 'string' || !entry.id) continue;
    if (typeof entry?.answer !== 'string' || !entry.answer.trim()) continue;
    const triggers = Array.isArray(entry.triggers)
      ? entry.triggers
          .filter((t): t is string => typeof t === 'string')
          .map((t) => normalizeDrkallaFaqText(t).trim())
          .filter((t) => t.length >= 3)
      : [];
    if (!triggers.length) continue;
    const tags = Array.isArray(entry.tags) ? entry.tags.filter((t): t is string => typeof t === 'string') : [];
    indexed.push({ id: entry.id, answer: entry.answer.trim(), tags, triggers });
  }

  return (text: string): DrkallaFaqMatch | null => {
    const haystack = normalizeDrkallaFaqText(text ?? '');
    if (haystack.trim().length < 3) return null;
    let best: IndexedFaq | null = null;
    let bestLen = 0;
    for (const entry of indexed) {
      for (const trigger of entry.triggers) {
        // Pad triggers so a multi-word trigger matches as a phrase; the most
        // specific (longest) matched trigger wins, which keeps it conservative.
        if (haystack.includes(` ${trigger} `) || haystack.includes(trigger)) {
          if (trigger.length > bestLen) { best = entry; bestLen = trigger.length; }
        }
      }
    }
    return best ? { id: best.id, answer: best.answer, tags: best.tags } : null;
  };
}
