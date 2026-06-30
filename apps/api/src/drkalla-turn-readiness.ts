/**
 * Live turn-readiness estimate for content-aware turn-taking.
 *
 * Retell decides at the AUDIO layer when the caller stopped and sends us a
 * response_required. This module is the CONTENT layer on top: given that
 * (possibly mid-sentence) utterance, it estimates the probability that the
 * caller is actually FINISHED and the agent should take its turn now — vs. the
 * caller is still mid-build and we should stay silent and let them continue.
 *
 * It is a pure, synchronous, in-memory function (microseconds) that runs on the
 * already-arrived turn event — NO extra network/LLM call, NO added latency. It
 * runs as a parallel decision layer in the transport before the turn is
 * processed (see retell-drkalla-custom-llm-ws), and emits the probability for
 * live observability/tuning.
 *
 * Design rule (inherited from drkalla-turn-completeness): PRECISION over recall.
 * A false hold (going silent when the caller actually finished) is the only
 * harmful error, so we only drop readiness below the hold threshold on
 * UNAMBIGUOUS "more is coming" signals. The hold is also bounded by the caller
 * (their next words arrive as a fresh turn), by the per-gap hold cap in the
 * transport, and by Retell's silence reminder, so a misfire can never leave the
 * agent permanently silent.
 */

import { looksIncompleteDrkallaUtterance } from './drkalla-turn-completeness.js';

// Below this estimated readiness we hold (let the caller finish); at or above we
// take the turn. Tunable via env for live calibration, but the ceiling is
// deliberately clamped BELOW the lowest "complete" score (0.70) so that NO env
// value can ever demote a genuinely-complete turn into a hold — the one harmful
// error this module exists to prevent (precision over recall). Tuning therefore
// only ever moves the dangling/contracted holds (0.15/0.20). A non-numeric env
// value falls back to the safe default.
const DRKALLA_TURN_HOLD_THRESHOLD = (() => {
  const raw = Number(process.env.DRKALLA_TURN_HOLD_THRESHOLD ?? 0.5);
  const value = Number.isFinite(raw) ? raw : 0.5;
  return Math.min(0.65, Math.max(0.05, value));
})();

// Contracted preposition+article forms that ALWAYS demand a following noun, so a
// trailing one is an unambiguous mid-build dangle. These are missed by the core
// detector's preposition set (which excludes separable-prefix lookalikes); the
// contractions have no such ambiguity ("Ich gehe zum" is never a finished turn).
const DANGLING_CONTRACTED = new Set([
  'zum', 'zur', 'beim', 'vom', 'ins', 'ans', 'aufs', 'fuers', 'fürs', 'uebers', 'übers',
]);

function lastToken(text: string): string {
  const toks = text
    .toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return toks[toks.length - 1] ?? '';
}

function wordCount(text: string): number {
  return text.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).length;
}

export type DrkallaTurnReadiness = {
  readiness: number;              // P(caller finished → take the turn), 0..1
  decision: 'respond' | 'hold';
  reasons: string[];
};

/**
 * Estimate whether the agent should take its turn now. `pendingQuestion` = the
 * agent's last turn asked the caller something, which makes a SHORT reply a
 * complete turn (so we don't wrongly hold on "ja, gerne").
 */
export function scoreDrkallaTurnReadiness(
  text: string,
  opts: { pendingQuestion?: boolean } = {},
): DrkallaTurnReadiness {
  const raw = (text ?? '').trim();
  // Empty = call opener (handled by the greeting path) — never hold.
  if (!raw) return { readiness: 1, decision: 'respond', reasons: ['empty-opener'] };

  const reasons: string[] = [];
  let readiness: number;

  if (raw.includes('?')) {
    // A question is a complete turn.
    readiness = 0.97;
    reasons.push('question');
  } else if (looksIncompleteDrkallaUtterance(raw, { pendingQuestion: opts.pendingQuestion })) {
    // Proven unambiguous dangle (conjunction / indefinite determiner / object
    // preposition / filler / "am besten" / attributive descriptor). A pending
    // question relaxes the soft descriptor case (an elliptical answer is complete).
    readiness = 0.15;
    reasons.push('dangling');
  } else if (DANGLING_CONTRACTED.has(lastToken(raw))) {
    // Trailing contracted preposition demanding a noun ("zum", "vom", …).
    readiness = 0.2;
    reasons.push('dangling-contracted');
  } else if (/,\s*$/.test(raw) && wordCount(raw) >= 2 && !opts.pendingQuestion) {
    // An utterance that ends on a comma is a list/clause still in progress
    // ("ich suche ein Shampoo, ein Serum,") — let the caller continue. But a
    // short answer to the agent's OWN question is complete even with a trailing
    // ASR comma ("Eher das günstige,"), so the pendingQuestion escape wins there.
    readiness = 0.3;
    reasons.push('trailing-comma');
  } else if (opts.pendingQuestion && wordCount(raw) <= 4) {
    // Short reply to the agent's own question → complete (avoid a false hold).
    readiness = 0.92;
    reasons.push('answer-to-question');
  } else {
    // Looks complete; terminal punctuation nudges confidence up a little (ASR
    // periods are unreliable, so only a nudge).
    readiness = /[.!]$/.test(raw) ? 0.85 : 0.7;
    reasons.push('complete');
  }

  return {
    readiness,
    decision: readiness < DRKALLA_TURN_HOLD_THRESHOLD ? 'hold' : 'respond',
    reasons,
  };
}
