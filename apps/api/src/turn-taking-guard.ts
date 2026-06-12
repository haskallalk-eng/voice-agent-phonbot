export type TurnTakingGuardAction =
  | 'respond_now'
  | 'wait_short'
  | 'keep_listening'
  | 'repair_prompt';

export type TurnTakingGuardReason =
  | 'final_transcript_complete'
  | 'partial_still_changing'
  | 'trailing_connector'
  | 'low_asr_confidence'
  | 'interruption_or_correction'
  | 'long_silence'
  | 'inaudible_streak'
  | 'empty_or_missing_text';

export type TurnTakingGuardInput = {
  transcriptText?: string | null;
  transcriptFinal: boolean;
  asrConfidence?: number | null;
  partialStableMs?: number | null;
  silenceMs?: number | null;
  inaudibleStreak?: number | null;
  interruptionDetected?: boolean | null;
  nowMs?: number | null;
};

export type TurnTakingGuardDecision = {
  action: TurnTakingGuardAction;
  reason: TurnTakingGuardReason;
  userLikelyDone: number;
  userLikelyContinuing: number;
  confidence: number;
  maxWaitMs: number;
  p95BudgetMs: 20;
  mayCallLlm: false;
  mayCallKb: false;
  mayAuthorizeTool: false;
  mayEndCall: false;
};

export type TurnTakingGuardSimulationReport = {
  caseCount: number;
  p50DecisionMs: number;
  p95DecisionMs: number;
  maxDecisionMs: number;
  extraLlmCalls: 0;
  extraKbCalls: 0;
  failures: string[];
  actionCounts: Record<TurnTakingGuardAction, number>;
};

const P95_BUDGET_MS = 20 as const;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const PARTIAL_STILL_CHANGING_MS = 90;
const SHORT_WAIT_MS = 220;

const TRAILING_CONNECTOR =
  /\b(?:und|oder|aber|weil|wenn|also|äh|ähm|ehm|aehm|hm|ich meine|ich wollte|warte|moment)\s*$/i;
const CORRECTION_OR_INTERRUPTION =
  /\b(?:nein|warte|moment|stopp|stop|falsch|ich meinte|korrektur|anders|nicht das)\b/i;
const INAUDIBLE_MARKER = /\b(?:inaudible|unverständlich|akustisch nicht verstanden)\b/i;

function finiteNumber(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampProbability(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function decision(input: {
  action: TurnTakingGuardAction;
  reason: TurnTakingGuardReason;
  userLikelyDone: number;
  userLikelyContinuing: number;
  confidence: number;
  maxWaitMs?: number;
}): TurnTakingGuardDecision {
  return {
    action: input.action,
    reason: input.reason,
    userLikelyDone: clampProbability(input.userLikelyDone),
    userLikelyContinuing: clampProbability(input.userLikelyContinuing),
    confidence: clampProbability(input.confidence),
    maxWaitMs: Math.max(0, Math.round(input.maxWaitMs ?? 0)),
    p95BudgetMs: P95_BUDGET_MS,
    mayCallLlm: false,
    mayCallKb: false,
    mayAuthorizeTool: false,
    mayEndCall: false,
  };
}

export function evaluateTurnTakingGuard(input: TurnTakingGuardInput): TurnTakingGuardDecision {
  const text = (input.transcriptText ?? '').replace(/\s+/g, ' ').trim();
  const confidence = finiteNumber(input.asrConfidence, 1);
  const partialStableMs = finiteNumber(input.partialStableMs, 0);
  const silenceMs = finiteNumber(input.silenceMs, 0);
  const inaudibleStreak = Math.max(0, Math.round(finiteNumber(input.inaudibleStreak, 0)));

  if (!text) {
    if (silenceMs >= 4000) {
      return decision({
        action: 'repair_prompt',
        reason: 'long_silence',
        userLikelyDone: 0.4,
        userLikelyContinuing: 0.2,
        confidence: 0.6,
      });
    }
    return decision({
      action: 'keep_listening',
      reason: 'empty_or_missing_text',
      userLikelyDone: 0.1,
      userLikelyContinuing: 0.75,
      confidence: 0.7,
    });
  }

  if (inaudibleStreak >= 2 || INAUDIBLE_MARKER.test(text)) {
    return decision({
      action: 'repair_prompt',
      reason: 'inaudible_streak',
      userLikelyDone: 0.35,
      userLikelyContinuing: 0.35,
      confidence: 0.85,
    });
  }

  if (confidence < LOW_CONFIDENCE_THRESHOLD) {
    return decision({
      action: 'repair_prompt',
      reason: 'low_asr_confidence',
      userLikelyDone: 0.3,
      userLikelyContinuing: 0.45,
      confidence: 0.9,
    });
  }

  if (input.interruptionDetected || CORRECTION_OR_INTERRUPTION.test(text)) {
    return decision({
      action: 'respond_now',
      reason: 'interruption_or_correction',
      userLikelyDone: 0.78,
      userLikelyContinuing: 0.18,
      confidence: 0.86,
    });
  }

  if (!input.transcriptFinal && partialStableMs < PARTIAL_STILL_CHANGING_MS) {
    return decision({
      action: 'keep_listening',
      reason: 'partial_still_changing',
      userLikelyDone: 0.12,
      userLikelyContinuing: 0.82,
      confidence: 0.88,
    });
  }

  if (TRAILING_CONNECTOR.test(text)) {
    return decision({
      action: 'wait_short',
      reason: 'trailing_connector',
      userLikelyDone: 0.22,
      userLikelyContinuing: 0.74,
      confidence: 0.84,
      maxWaitMs: SHORT_WAIT_MS,
    });
  }

  if (input.transcriptFinal || silenceMs >= 250) {
    return decision({
      action: 'respond_now',
      reason: 'final_transcript_complete',
      userLikelyDone: 0.86,
      userLikelyContinuing: 0.1,
      confidence: Math.max(0.72, confidence),
    });
  }

  return decision({
    action: 'wait_short',
    reason: 'partial_still_changing',
    userLikelyDone: 0.32,
    userLikelyContinuing: 0.58,
    confidence: 0.74,
    maxWaitMs: SHORT_WAIT_MS,
  });
}

function seededHash(seed: string, index: number): number {
  let hash = 2166136261;
  const value = `${seed}:${index}`;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function simulationInput(seed: string, index: number): TurnTakingGuardInput {
  const bucket = seededHash(seed, index) % 8;
  switch (bucket) {
    case 0:
      return { transcriptText: 'Ich suche eine Haarfarbe.', transcriptFinal: true, asrConfidence: 0.92, partialStableMs: 420, silenceMs: 360 };
    case 1:
      return { transcriptText: 'Ich suche eine Haarfarbe und', transcriptFinal: false, asrConfidence: 0.88, partialStableMs: 120, silenceMs: 160 };
    case 2:
      return { transcriptText: 'Ich wollte', transcriptFinal: false, asrConfidence: 0.83, partialStableMs: 40, silenceMs: 60 };
    case 3:
      return { transcriptText: 'ha farb', transcriptFinal: true, asrConfidence: 0.37, partialStableMs: 300, silenceMs: 420 };
    case 4:
      return { transcriptText: '(inaudible speech)', transcriptFinal: true, asrConfidence: 0.2, partialStableMs: 500, silenceMs: 700, inaudibleStreak: 3 };
    case 5:
      return { transcriptText: 'Nein warte, ich meinte die andere Farbe.', transcriptFinal: true, asrConfidence: 0.9, partialStableMs: 260, silenceMs: 260, interruptionDetected: true };
    case 6:
      return { transcriptText: '', transcriptFinal: false, asrConfidence: null, partialStableMs: 0, silenceMs: 5000 };
    default:
      return { transcriptText: 'Was kostet die Synthesis Color Cream?', transcriptFinal: true, asrConfidence: 0.94, partialStableMs: 500, silenceMs: 300 };
  }
}

function percentile(values: number[], pct: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return Number((sorted[index] ?? 0).toFixed(3));
}

export function runTurnTakingGuardSimulation(input: {
  cases: number;
  seed: string;
}): TurnTakingGuardSimulationReport {
  const caseCount = Math.max(0, Math.floor(input.cases));
  const durations: number[] = [];
  const failures: string[] = [];
  const actionCounts: Record<TurnTakingGuardAction, number> = {
    respond_now: 0,
    wait_short: 0,
    keep_listening: 0,
    repair_prompt: 0,
  };

  for (let index = 0; index < caseCount; index += 1) {
    const started = performance.now();
    const result = evaluateTurnTakingGuard(simulationInput(input.seed, index));
    durations.push(performance.now() - started);
    actionCounts[result.action] += 1;

    if (result.mayCallLlm || result.mayCallKb || result.mayAuthorizeTool || result.mayEndCall) {
      failures.push(`case_${index}_authority_violation`);
    }
    if (result.p95BudgetMs !== P95_BUDGET_MS) {
      failures.push(`case_${index}_budget_violation`);
    }
  }

  const p95DecisionMs = percentile(durations, 95);
  if (p95DecisionMs > P95_BUDGET_MS) failures.push('p95_decision_budget_exceeded');

  return {
    caseCount,
    p50DecisionMs: percentile(durations, 50),
    p95DecisionMs,
    maxDecisionMs: Number((durations.length ? Math.max(...durations) : 0).toFixed(3)),
    extraLlmCalls: 0,
    extraKbCalls: 0,
    failures,
    actionCounts,
  };
}
