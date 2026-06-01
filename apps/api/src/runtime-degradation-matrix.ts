export type RuntimeDegradationMode =
  | 'retell_kb_unavailable'
  | 'own_kb_unavailable'
  | 'redis_unavailable'
  | 'supabase_slow_or_down'
  | 'tool_api_down'
  | 'asr_tts_degraded'
  | 'provider_latency_spike';

export const REQUIRED_RUNTIME_DEGRADATION_MODES: RuntimeDegradationMode[] = [
  'retell_kb_unavailable',
  'own_kb_unavailable',
  'redis_unavailable',
  'supabase_slow_or_down',
  'tool_api_down',
  'asr_tts_degraded',
  'provider_latency_spike',
];

export type RuntimeDegradationCallDisposition =
  | 'continue'
  | 'continue_with_clarification'
  | 'abstain_or_escalate'
  | 'escalate'
  | 'end_call_safely';

export type RuntimeDegradationHighRiskBehavior =
  | 'abstain_or_escalate'
  | 'require_audited_evidence'
  | 'continue_with_best_effort';

export type RuntimeDegradationEntry = {
  mode: RuntimeDegradationMode;
  agentResponse: string;
  escalationBehavior: string;
  traceEvent: string;
  userVisibleWording: string;
  killSwitchOrFeatureFlag: string;
  retryPolicy: string;
  deadlineMs: number | null;
  callDisposition: RuntimeDegradationCallDisposition;
  highRiskBehavior: RuntimeDegradationHighRiskBehavior;
  mayGuess: boolean;
  mayClaimToolSuccess: boolean;
  metricsRequired: string[];
  respectsFirstSafeAudioAntiGaming: boolean;
};

export type RuntimeDegradationBlocker =
  | 'DEGRADATION_MODE_MISSING'
  | 'DEGRADATION_OPERATIONAL_FIELDS_MISSING'
  | 'DEGRADED_RETRIEVAL_MAY_GUESS_HIGH_RISK'
  | 'TOOL_DEGRADATION_FALSE_SUCCESS_RISK'
  | 'ASR_TTS_DEGRADATION_NOT_MEASURABLE'
  | 'ASR_TTS_DEGRADATION_NEEDS_CLARIFICATION_OR_ESCALATION'
  | 'PROVIDER_LATENCY_STOP_LOSS_MISSING'
  | 'FIRST_SAFE_AUDIO_ANTI_GAMING_MISSING';

export type RuntimeDegradationCoverage = {
  modeCount: number;
  missingModes: RuntimeDegradationMode[];
};

export type RuntimeDegradationValidationReport = {
  ready: boolean;
  blockers: RuntimeDegradationBlocker[];
  coverage: RuntimeDegradationCoverage;
};

const RETRIEVAL_MODES = new Set<RuntimeDegradationMode>([
  'retell_kb_unavailable',
  'own_kb_unavailable',
  'supabase_slow_or_down',
]);

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function add(blockers: RuntimeDegradationBlocker[], condition: boolean, blocker: RuntimeDegradationBlocker): void {
  if (condition && !blockers.includes(blocker)) blockers.push(blocker);
}

function operationalFieldsMissing(entry: RuntimeDegradationEntry): boolean {
  return !hasText(entry.agentResponse) ||
    !hasText(entry.escalationBehavior) ||
    !hasText(entry.traceEvent) ||
    !hasText(entry.userVisibleWording) ||
    !hasText(entry.killSwitchOrFeatureFlag) ||
    !hasText(entry.retryPolicy) ||
    entry.deadlineMs == null ||
    !Number.isFinite(entry.deadlineMs) ||
    entry.deadlineMs <= 0 ||
    !Array.isArray(entry.metricsRequired) ||
    entry.metricsRequired.length === 0;
}

function wordingClaimsSuccess(entry: RuntimeDegradationEntry): boolean {
  return /\b(gebucht|erfolgreich|storniert|geaendert|erstellt|gespeichert)\b/i.test(entry.userVisibleWording);
}

function hasAsrTtsMetrics(entry: RuntimeDegradationEntry): boolean {
  return entry.metricsRequired.includes('asr_confidence') &&
    entry.metricsRequired.includes('tts_error_rate');
}

function hasClarificationOrEscalation(entry: RuntimeDegradationEntry): boolean {
  return /clarification|escalation|escalate|klaer|nachfrag|weiter/i.test(entry.agentResponse) ||
    entry.callDisposition === 'continue_with_clarification' ||
    entry.callDisposition === 'abstain_or_escalate' ||
    entry.callDisposition === 'escalate';
}

function hasProviderLatencyMetrics(entry: RuntimeDegradationEntry): boolean {
  return entry.metricsRequired.includes('voice_e2e_ms') &&
    entry.metricsRequired.includes('first_safe_audio_ms') &&
    entry.metricsRequired.includes('provider_latency_ms');
}

export function validateRuntimeDegradationMatrix(
  entries: RuntimeDegradationEntry[],
): RuntimeDegradationValidationReport {
  const blockers: RuntimeDegradationBlocker[] = [];
  const modes = new Set(entries.map((entry) => entry.mode));
  const missingModes = REQUIRED_RUNTIME_DEGRADATION_MODES.filter((mode) => !modes.has(mode));

  add(blockers, missingModes.length > 0, 'DEGRADATION_MODE_MISSING');

  for (const entry of entries) {
    add(blockers, operationalFieldsMissing(entry), 'DEGRADATION_OPERATIONAL_FIELDS_MISSING');

    add(
      blockers,
      RETRIEVAL_MODES.has(entry.mode) &&
        (entry.mayGuess ||
          entry.highRiskBehavior === 'continue_with_best_effort' ||
          entry.callDisposition === 'continue'),
      'DEGRADED_RETRIEVAL_MAY_GUESS_HIGH_RISK',
    );

    add(
      blockers,
      entry.mode === 'tool_api_down' &&
        (entry.mayClaimToolSuccess || wordingClaimsSuccess(entry)),
      'TOOL_DEGRADATION_FALSE_SUCCESS_RISK',
    );

    add(
      blockers,
      entry.mode === 'asr_tts_degraded' && !hasAsrTtsMetrics(entry),
      'ASR_TTS_DEGRADATION_NOT_MEASURABLE',
    );

    add(
      blockers,
      entry.mode === 'asr_tts_degraded' && !hasClarificationOrEscalation(entry),
      'ASR_TTS_DEGRADATION_NEEDS_CLARIFICATION_OR_ESCALATION',
    );

    add(
      blockers,
      entry.mode === 'provider_latency_spike' &&
        (entry.deadlineMs == null || entry.deadlineMs > 1000 || !hasProviderLatencyMetrics(entry)),
      'PROVIDER_LATENCY_STOP_LOSS_MISSING',
    );

    add(
      blockers,
      entry.mode === 'provider_latency_spike' && entry.respectsFirstSafeAudioAntiGaming !== true,
      'FIRST_SAFE_AUDIO_ANTI_GAMING_MISSING',
    );
  }

  return {
    ready: blockers.length === 0,
    blockers,
    coverage: {
      modeCount: modes.size,
      missingModes,
    },
  };
}
