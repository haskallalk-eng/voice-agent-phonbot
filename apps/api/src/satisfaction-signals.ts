/**
 * Implicit Satisfaction Signals — derive satisfaction without asking customers.
 *
 * Instead of annoying post-call ratings, we compute a 1-10 satisfaction score
 * from signals that naturally occur during the call lifecycle.
 */

import { pool } from './db.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SatisfactionSignals {
  callDurationSec: number;
  callerHungUpFirst: boolean;     // true = caller ended, false = agent/system ended
  repeatCaller: boolean;           // same number called within 7 days = wasn't resolved
  taskCompleted: boolean;          // ticket created, appointment booked, or info delivered
  escalationRequested: boolean;    // caller asked for human
  sentimentScore: number;          // -1 to 1, from transcript analysis
  silenceRatio: number;            // % of call that was silence (frustration indicator)
  interruptionCount: number;       // how many times caller interrupted agent
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Compute a 1-10 satisfaction score from implicit call signals.
 * Returns an integer — easier to reason about and display.
 */
export function computeSatisfactionScore(signals: SatisfactionSignals): number {
  let score = 7; // baseline: assume an average call unless signals say otherwise

  // Positive signals
  if (signals.taskCompleted) score += 1.5;
  if (signals.callDurationSec > 30 && signals.callDurationSec < 300) score += 0.5; // healthy duration
  if (signals.sentimentScore > 0.3) score += 1;

  // Negative signals
  if (signals.repeatCaller) score -= 1.5;       // had to call back = wasn't resolved
  if (signals.escalationRequested) score -= 2;
  if (signals.callerHungUpFirst && signals.callDurationSec < 15) score -= 2; // hung up fast = frustrated
  if (signals.interruptionCount > 5) score -= 1;
  if (signals.silenceRatio > 0.4) score -= 1;   // long silences = confusion
  if (signals.sentimentScore < -0.3) score -= 1.5;

  return Math.max(1, Math.min(10, Math.round(score)));
}

// ── Signal extraction ─────────────────────────────────────────────────────────

/**
 * Partial GPT-extracted fields that insights.ts adds to its JSON output.
 * All fields are optional so parsing is backward-compatible.
 */
export interface GptSatisfactionSignals {
  sentiment?: number;
  task_completed?: boolean;
  escalation_requested?: boolean;
  interruption_count?: number;
}

/**
 * Extract satisfaction signals from a Retell call_ended webhook payload
 * combined with GPT analysis results.
 *
 * DB query for repeat-caller is fire-and-forget safe — if pool is unavailable
 * we default to false.
 */
export async function extractSignalsFromCall(
  callData: {
    duration_ms?: number;
    disconnection_reason?: string;
    from_number?: string;
    call_id?: string;
    silence_duration_ms?: number;
  },
  gptSignals: GptSatisfactionSignals,
): Promise<SatisfactionSignals> {
  const durationSec = callData.duration_ms ? Math.round(callData.duration_ms / 1000) : 0;

  // Who hung up?
  const callerHungUpFirst = callData.disconnection_reason === 'user_hangup';

  // Silence ratio (if Retell provides silence duration)
  const silenceRatio =
    callData.silence_duration_ms && durationSec > 0
      ? callData.silence_duration_ms / (callData.duration_ms ?? 1)
      : 0;

  // Repeat caller — same number called in the last 7 days (excluding this call)
  let repeatCaller = false;
  if (pool && callData.from_number && callData.call_id) {
    try {
      const res = await pool.query(
        `SELECT 1 FROM call_transcripts
         WHERE from_number = $1
           AND created_at > now() - interval '7 days'
           AND call_id != $2
         LIMIT 1`,
        [callData.from_number, callData.call_id],
      );
      repeatCaller = res.rows.length > 0;
    } catch { /* default false */ }
  }

  return {
    callDurationSec: durationSec,
    callerHungUpFirst,
    repeatCaller,
    taskCompleted: gptSignals.task_completed ?? false,
    escalationRequested: gptSignals.escalation_requested ?? false,
    sentimentScore: gptSignals.sentiment ?? 0,
    silenceRatio,
    interruptionCount: gptSignals.interruption_count ?? 0,
  };
}

/**
 * Store satisfaction score and signals back on the call_transcripts row.
 * Fire-and-forget — caller should `.catch(() => {})`.
 */
export async function storeSatisfactionData(
  callId: string,
  score: number,
  signals: SatisfactionSignals,
  disconnectionReason: string | null | undefined,
): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE call_transcripts
     SET satisfaction_score     = $1,
         satisfaction_signals   = $2,
         repeat_caller          = $3,
         disconnection_reason   = $4
     WHERE call_id = $5`,
    [
      score,
      JSON.stringify(signals),
      signals.repeatCaller,
      disconnectionReason ?? null,
      callId,
    ],
  );
}
