export type VoiceSafeAudioType =
  | 'evidence_backed_answer'
  | 'targeted_clarification'
  | 'valid_abstain'
  | 'valid_escalation'
  | 'policy_confirmation'
  | 'tool_status_update'
  | 'filler_only';

export type VoiceLatencyTimestampField =
  | 'user_audio_end_detected_at'
  | 'provider_end_of_turn_at'
  | 'asr_partial_first_at'
  | 'asr_final_at'
  | 'agent_core_turn_start_at'
  | 'first_model_token_at'
  | 'first_speakable_chunk_at'
  | 'first_safe_audio_at'
  | 'first_full_answer_audio_at';

export type OptionalVoiceLatencyTimestampField = 'first_filler_audio_at';

export type VoiceLatencyContractBlocker =
  | 'MISSING_REQUIRED_TIMESTAMP'
  | 'INVALID_TIMESTAMP'
  | 'INVALID_TIMESTAMP_ORDER'
  | 'FILLER_ONLY_NOT_SLO_ELIGIBLE'
  | 'SAFE_AUDIO_TYPE_REQUIRED';

export type VoiceLatencyTimestampValue = string | number | Date | null | undefined;

export type VoiceLatencyTimestampContract = {
  callId?: string;
  turnId?: string;
  provider?: 'retell' | 'openai_realtime' | 'web_chat' | 'internal_test' | 'unknown';
  user_audio_end_detected_at?: VoiceLatencyTimestampValue;
  provider_end_of_turn_at?: VoiceLatencyTimestampValue;
  asr_partial_first_at?: VoiceLatencyTimestampValue;
  asr_final_at?: VoiceLatencyTimestampValue;
  agent_core_turn_start_at?: VoiceLatencyTimestampValue;
  first_model_token_at?: VoiceLatencyTimestampValue;
  first_speakable_chunk_at?: VoiceLatencyTimestampValue;
  first_safe_audio_at?: VoiceLatencyTimestampValue;
  first_filler_audio_at?: VoiceLatencyTimestampValue;
  first_full_answer_audio_at?: VoiceLatencyTimestampValue;
  safe_audio_type?: VoiceSafeAudioType | null;
};

export type VoiceLatencyMetrics = {
  voiceE2eMs: number | null;
  providerEndToSafeAudioMs: number | null;
  asrPartialToFinalMs: number | null;
  asrFinalToSafeAudioMs: number | null;
  agentCoreToSafeAudioMs: number | null;
  agentCoreToFirstTokenMs: number | null;
  firstTokenToSpeakableChunkMs: number | null;
  firstSpeakableChunkToSafeAudioMs: number | null;
  firstSafeAudioMs: number | null;
  firstFillerAudioMs: number | null;
  firstFullAnswerAudioMs: number | null;
  safeAudioCountsForSlo: boolean;
};

export type VoiceLatencyContractEvaluation = {
  ready: boolean;
  blockers: VoiceLatencyContractBlocker[];
  missingRequiredTimestamps: VoiceLatencyTimestampField[];
  invalidTimestampFields: Array<VoiceLatencyTimestampField | OptionalVoiceLatencyTimestampField>;
  metrics: VoiceLatencyMetrics;
};

export const SLO_ELIGIBLE_SAFE_AUDIO_TYPES: ReadonlySet<VoiceSafeAudioType> = new Set([
  'evidence_backed_answer',
  'targeted_clarification',
  'valid_abstain',
  'valid_escalation',
  'policy_confirmation',
  'tool_status_update',
]);

export const REQUIRED_VOICE_LATENCY_TIMESTAMPS: VoiceLatencyTimestampField[] = [
  'user_audio_end_detected_at',
  'provider_end_of_turn_at',
  'asr_partial_first_at',
  'asr_final_at',
  'agent_core_turn_start_at',
  'first_model_token_at',
  'first_speakable_chunk_at',
  'first_safe_audio_at',
  'first_full_answer_audio_at',
];

function toEpochMs(value: VoiceLatencyTimestampValue): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function diffMs(start: number | null, end: number | null): number | null {
  if (start === null || end === null) return null;
  return Math.round(end - start);
}

function hasNegative(values: Array<number | null>): boolean {
  return values.some((value) => typeof value === 'number' && value < 0);
}

export function safeAudioCountsForSlo(type: VoiceSafeAudioType | null | undefined): boolean {
  return type != null && SLO_ELIGIBLE_SAFE_AUDIO_TYPES.has(type);
}

export function evaluateVoiceLatencyContract(input: VoiceLatencyTimestampContract): VoiceLatencyContractEvaluation {
  const parsed = new Map<VoiceLatencyTimestampField | OptionalVoiceLatencyTimestampField, number | null>();
  for (const field of REQUIRED_VOICE_LATENCY_TIMESTAMPS) {
    parsed.set(field, toEpochMs(input[field]));
  }
  parsed.set('first_filler_audio_at', toEpochMs(input.first_filler_audio_at));

  const missingRequiredTimestamps = REQUIRED_VOICE_LATENCY_TIMESTAMPS.filter((field) => parsed.get(field) === null);
  const invalidTimestampFields: Array<VoiceLatencyTimestampField | OptionalVoiceLatencyTimestampField> = [];
  for (const field of [...REQUIRED_VOICE_LATENCY_TIMESTAMPS, 'first_filler_audio_at' as const]) {
    const raw = input[field];
    if (raw != null && parsed.get(field) === null) invalidTimestampFields.push(field);
  }

  const userAudioEnd = parsed.get('user_audio_end_detected_at') ?? null;
  const providerEnd = parsed.get('provider_end_of_turn_at') ?? null;
  const asrPartialFirst = parsed.get('asr_partial_first_at') ?? null;
  const asrFinal = parsed.get('asr_final_at') ?? null;
  const agentCoreStart = parsed.get('agent_core_turn_start_at') ?? null;
  const firstModelToken = parsed.get('first_model_token_at') ?? null;
  const firstSpeakableChunk = parsed.get('first_speakable_chunk_at') ?? null;
  const firstSafeAudio = parsed.get('first_safe_audio_at') ?? null;
  const firstFillerAudio = parsed.get('first_filler_audio_at') ?? null;
  const firstFullAnswerAudio = parsed.get('first_full_answer_audio_at') ?? null;
  const countsForSlo = safeAudioCountsForSlo(input.safe_audio_type);
  const fillerOnly = input.safe_audio_type === 'filler_only';

  const voiceE2eMs = countsForSlo ? diffMs(userAudioEnd ?? providerEnd, firstSafeAudio) : null;
  const firstSafeAudioMs = countsForSlo ? diffMs(userAudioEnd ?? providerEnd, firstSafeAudio) : null;
  const inferredFillerAudio = fillerOnly ? firstSafeAudio : firstFillerAudio;

  const metrics: VoiceLatencyMetrics = {
    voiceE2eMs,
    providerEndToSafeAudioMs: countsForSlo ? diffMs(providerEnd, firstSafeAudio) : null,
    asrPartialToFinalMs: diffMs(asrPartialFirst, asrFinal),
    asrFinalToSafeAudioMs: countsForSlo ? diffMs(asrFinal, firstSafeAudio) : null,
    agentCoreToSafeAudioMs: countsForSlo ? diffMs(agentCoreStart, firstSafeAudio) : null,
    agentCoreToFirstTokenMs: diffMs(agentCoreStart, firstModelToken),
    firstTokenToSpeakableChunkMs: diffMs(firstModelToken, firstSpeakableChunk),
    firstSpeakableChunkToSafeAudioMs: countsForSlo ? diffMs(firstSpeakableChunk, firstSafeAudio) : null,
    firstSafeAudioMs,
    firstFillerAudioMs: diffMs(userAudioEnd ?? providerEnd, inferredFillerAudio),
    firstFullAnswerAudioMs: diffMs(userAudioEnd ?? providerEnd, firstFullAnswerAudio),
    safeAudioCountsForSlo: countsForSlo,
  };

  const orderedDiffs = [
    diffMs(userAudioEnd, providerEnd),
    diffMs(asrPartialFirst, asrFinal),
    diffMs(providerEnd, agentCoreStart),
    diffMs(agentCoreStart, firstModelToken),
    diffMs(firstModelToken, firstSpeakableChunk),
    countsForSlo ? diffMs(firstSpeakableChunk, firstSafeAudio) : null,
    countsForSlo ? diffMs(firstSafeAudio, firstFullAnswerAudio) : null,
    fillerOnly ? diffMs(userAudioEnd ?? providerEnd, firstSafeAudio) : null,
    firstFillerAudio != null ? diffMs(userAudioEnd ?? providerEnd, firstFillerAudio) : null,
  ];

  const blockers = new Set<VoiceLatencyContractBlocker>();
  if (missingRequiredTimestamps.length > 0) blockers.add('MISSING_REQUIRED_TIMESTAMP');
  if (invalidTimestampFields.length > 0) blockers.add('INVALID_TIMESTAMP');
  if (input.safe_audio_type == null) blockers.add('SAFE_AUDIO_TYPE_REQUIRED');
  if (fillerOnly) blockers.add('FILLER_ONLY_NOT_SLO_ELIGIBLE');
  if (hasNegative(orderedDiffs)) blockers.add('INVALID_TIMESTAMP_ORDER');

  return {
    ready: blockers.size === 0,
    blockers: [...blockers],
    missingRequiredTimestamps,
    invalidTimestampFields,
    metrics,
  };
}
