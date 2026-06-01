import {
  safeAudioCountsForSlo,
  type VoiceLatencyTimestampValue,
  type VoiceSafeAudioType,
} from './voice-latency-contract.js';
import type { InteractionChannel, RuntimeProvider } from './voice-runtime-contract.js';

export type SttTranscriptRedactionState =
  | 'raw_not_stored'
  | 'redacted'
  | 'pii_allowed_for_user_confirmation';

export type TextReasoningRedactionState = 'redacted' | 'pii_allowed_for_user_confirmation';

export type VoicePipelineTranscriptSource =
  | 'canonical_partial'
  | 'canonical_final'
  | 'manual_test_fixture';

export type VoicePipelineEvidenceDecision =
  | 'approved_current'
  | 'not_required'
  | 'unsupported'
  | 'stale'
  | 'unapproved'
  | 'missing';

export type VoicePipelinePolicyDecision =
  | 'answer_allowed'
  | 'clarification_required'
  | 'abstain_required'
  | 'escalation_required'
  | 'policy_denied'
  | 'missing';

export type VoicePipelineToolDecision =
  | 'no_tool_required'
  | 'tool_required'
  | 'tool_pending'
  | 'mutation_confirmation_required'
  | 'tool_unavailable'
  | 'missing';

export type VoicePipelineIntent =
  | 'opening_hours'
  | 'pricing_or_policy'
  | 'booking_or_reschedule'
  | 'human_escalation'
  | 'unsupported_or_out_of_scope'
  | 'unknown';

export type VoicePipelineTaskState =
  | 'answering'
  | 'collecting_fields'
  | 'confirming'
  | 'abstaining'
  | 'escalating'
  | 'tool_wait'
  | 'degraded';

export type VoicePipelineRequiredFieldsState =
  | 'not_required'
  | 'missing_required_fields'
  | 'complete'
  | 'needs_confirmation';

export type VoicePipelineResponsePlan =
  | 'answer_with_current_hours'
  | 'answer_with_evidence'
  | 'ask_targeted_clarification'
  | 'ask_policy_confirmation'
  | 'valid_abstain'
  | 'valid_escalation'
  | 'tool_status_update';

export type VoicePipelineAbstainOrEscalationReason =
  | 'not_required'
  | 'source_stale'
  | 'source_missing'
  | 'source_unapproved'
  | 'policy_denied'
  | 'high_risk_answer_requires_audit'
  | 'unsupported_or_out_of_scope'
  | 'runtime_degraded';

export type VoicePipelinePronunciationProfile =
  | 'de-DE-default'
  | 'de-AT-default'
  | 'de-CH-default'
  | 'tenant_verified'
  | 'human_reviewed';

export type VoicePipelineExceptionPath =
  | 'high_risk_audited_answer'
  | 'tool_mutation_confirmation'
  | 'valid_escalation'
  | 'unsupported_or_out_of_scope'
  | 'runtime_degraded';

export type VoicePipelineFailureClass =
  | 'asr_stt_failure'
  | 'text_reasoning_ttt_failure'
  | 'tts_spoken_output_failure'
  | 'runtime_interaction_failure';

export type VoicePipelineBlocker =
  | 'PIPELINE_ATTRIBUTION_MISSING'
  | 'PIPELINE_PROVIDER_INVALID'
  | 'PIPELINE_CHANNEL_INVALID'
  | 'PROVIDER_SPECIFIC_PIPELINE_FIELD_PRESENT'
  | 'STT_TIMESTAMP_MISSING'
  | 'STT_CONFIDENCE_MISSING'
  | 'STT_CONFIDENCE_INVALID'
  | 'STT_CONFIDENCE_BELOW_THRESHOLD'
  | 'STT_LOCALE_MISSING'
  | 'STT_LOCALE_UNSUPPORTED'
  | 'STT_REDACTION_STATE_MISSING'
  | 'STT_REDACTION_STATE_INVALID'
  | 'STT_TRANSCRIPT_SOURCE_MISSING'
  | 'STT_TRANSCRIPT_SOURCE_INVALID'
  | 'PROVIDER_SPECIFIC_STT_FIELD_PRESENT'
  | 'PROVIDER_SPECIFIC_STT_VALUE_PRESENT'
  | 'TURN_SLO_CLASSIFICATION_MISSING'
  | 'TURN_SLO_CLASSIFICATION_INVALID'
  | 'EXCEPTION_PATH_INVALID'
  | 'EXCEPTION_PATH_SAFE_AUDIO_ABOVE_BUDGET'
  | 'EXCEPTION_PATH_SEMANTIC_MISMATCH'
  | 'TTT_TIMESTAMP_MISSING'
  | 'TTT_CANONICAL_UTTERANCE_MISSING'
  | 'TTT_REDACTION_STATE_MISSING'
  | 'TTT_REDACTION_STATE_INVALID'
  | 'TTT_ABSTAIN_OR_ESCALATION_REASON_MISSING'
  | 'TTT_DECISION_MISSING'
  | 'TTT_CANONICAL_FIELD_INVALID'
  | 'TTT_UNSAFE_EVIDENCE_DECISION'
  | 'TTT_POLICY_NOT_ALLOWED'
  | 'TTT_POLICY_SAFE_AUDIO_MISMATCH'
  | 'PROVIDER_SPECIFIC_TTT_FIELD_PRESENT'
  | 'PROVIDER_SPECIFIC_TTT_VALUE_PRESENT'
  | 'TTS_WRITTEN_TEXT_MISSING'
  | 'TTS_SPOKEN_TEXT_MISSING'
  | 'TTS_SAFE_AUDIO_TYPE_MISSING'
  | 'TTS_SAFE_AUDIO_TYPE_INVALID'
  | 'TTS_FILLER_ONLY_NOT_SLO_ELIGIBLE'
  | 'TTS_AUDIO_TIMESTAMP_MISSING'
  | 'TTS_PRONUNCIATION_PROFILE_MISSING'
  | 'TTS_PRONUNCIATION_PROFILE_INVALID'
  | 'TTS_PRONUNCIATION_REVIEW_STATE_MISSING'
  | 'TTS_PRONUNCIATION_REVIEW_STATE_INVALID'
  | 'TTS_PRONUNCIATION_REVIEW_UNRESOLVED'
  | 'TTS_FACT_PRESERVATION_UNVERIFIED'
  | 'PROVIDER_SPECIFIC_TTS_FIELD_PRESENT'
  | 'PROVIDER_SPECIFIC_TTS_VALUE_PRESENT'
  | 'NORMAL_SUPPORTED_SAFE_AUDIO_ABOVE_800_MS'
  | 'SUPPORTED_NON_TOOL_SAFE_AUDIO_ABOVE_1000_MS'
  | 'RUNTIME_INTERACTION_STATE_MISSING'
  | 'RUNTIME_INTERACTION_STATE_INVALID'
  | 'PROVIDER_SPECIFIC_RUNTIME_FIELD_PRESENT'
  | 'RUNTIME_INTERRUPTION_TIMESTAMP_MISSING'
  | 'RUNTIME_INTERRUPTION_CORRELATION_MISSING'
  | 'RUNTIME_STALE_AUDIO_NOT_STOPPED'
  | 'RUNTIME_TRANSPORT_DELAY_INVALID'
  | 'RUNTIME_BARGE_IN_RECOVERY_INVALID'
  | 'RUNTIME_BARGE_IN_RECOVERY_ABOVE_500MS'
  | 'RUNTIME_BARGE_IN_RECOVERY_MISMATCH'
  | 'INVALID_PIPELINE_TIMESTAMP_ORDER';

export type VoicePipelineSttLayer = {
  audioStartAt?: VoiceLatencyTimestampValue;
  audioEndDetectedAt?: VoiceLatencyTimestampValue;
  providerEndOfTurnAt?: VoiceLatencyTimestampValue;
  partialFirstAt?: VoiceLatencyTimestampValue;
  finalAt?: VoiceLatencyTimestampValue;
  confidence?: number | null;
  locale?: string | null;
  transcriptRedactionState?: SttTranscriptRedactionState | null;
  transcriptSource?: VoicePipelineTranscriptSource | null;
};

export type VoicePipelineTttLayer = {
  agentCoreTurnStartAt?: VoiceLatencyTimestampValue;
  firstModelTokenAt?: VoiceLatencyTimestampValue;
  firstSpeakableChunkAt?: VoiceLatencyTimestampValue;
  canonicalUserUtterance?: string | null;
  canonicalUserUtteranceRedactionState?: TextReasoningRedactionState | null;
  intent?: VoicePipelineIntent | null;
  taskState?: VoicePipelineTaskState | null;
  requiredFieldsState?: VoicePipelineRequiredFieldsState | null;
  evidenceDecision?: VoicePipelineEvidenceDecision | null;
  policyDecision?: VoicePipelinePolicyDecision | null;
  toolDecision?: VoicePipelineToolDecision | null;
  responsePlan?: VoicePipelineResponsePlan | null;
  abstainOrEscalationReason?: VoicePipelineAbstainOrEscalationReason | null;
};

export type VoicePipelineTtsLayer = {
  writtenText?: string | null;
  spokenText?: string | null;
  safeAudioType?: VoiceSafeAudioType | null;
  firstSafeAudioAt?: VoiceLatencyTimestampValue;
  firstFullAnswerAudioAt?: VoiceLatencyTimestampValue;
  audioStartAt?: VoiceLatencyTimestampValue;
  audioEndAt?: VoiceLatencyTimestampValue;
  pronunciationProfile?: VoicePipelinePronunciationProfile | null;
  pronunciationReviewRequired?: boolean | null;
  factPreserved?: boolean | null;
};

export type VoicePipelineRuntimeInteractionLayer = {
  interactionState?: 'normal_turn' | 'interrupted' | 'tool_pending' | 'handoff' | 'degraded' | null;
  providerResponseId?: string | null;
  interruptedResponseId?: string | null;
  stoppedResponseId?: string | null;
  newTurnId?: string | null;
  interruptionReceivedAt?: VoiceLatencyTimestampValue;
  bargeInRecoveredAt?: VoiceLatencyTimestampValue;
  transportDelayMs?: number | null;
  bargeInRecoveryMs?: number | null;
  staleAudioStopped?: boolean | null;
};

export type VoicePipelineContract = {
  callId?: string;
  turnId?: string;
  provider?: RuntimeProvider;
  channel?: InteractionChannel;
  normalSupportedTurn?: boolean;
  supportedNonToolTurn?: boolean;
  exceptionPath?: VoicePipelineExceptionPath | null;
  stt: VoicePipelineSttLayer;
  ttt: VoicePipelineTttLayer;
  tts: VoicePipelineTtsLayer;
  runtime: VoicePipelineRuntimeInteractionLayer;
};

export type VoicePipelineMetrics = {
  sttFinalLatencyMs: number | null;
  tttToFirstSafeAudioMs: number | null;
  tttFirstTokenLatencyMs: number | null;
  tttSpeakableChunkLatencyMs: number | null;
  firstSpeakableChunkToSafeAudioMs: number | null;
  ttsAudioStartToSafeAudioMs: number | null;
  ttsAudioStartToFullAnswerMs: number | null;
  voiceE2eFirstSafeAudioMs: number | null;
  voiceE2eFullAnswerAudioMs: number | null;
  runtimeTransportDelayMs: number | null;
  bargeInRecoveryMs: number | null;
};

export type VoicePipelineContractEvaluation = {
  ready: boolean;
  blockers: VoicePipelineBlocker[];
  failureClasses: VoicePipelineFailureClass[];
  layerReadiness: {
    stt: boolean;
    ttt: boolean;
    tts: boolean;
    runtime_interaction: boolean;
  };
  metrics: VoicePipelineMetrics;
};

const ALLOWED_STT_FIELDS = new Set([
  'audioStartAt',
  'audioEndDetectedAt',
  'providerEndOfTurnAt',
  'partialFirstAt',
  'finalAt',
  'confidence',
  'locale',
  'transcriptRedactionState',
  'transcriptSource',
]);

const ALLOWED_TTT_FIELDS = new Set([
  'agentCoreTurnStartAt',
  'firstModelTokenAt',
  'firstSpeakableChunkAt',
  'canonicalUserUtterance',
  'canonicalUserUtteranceRedactionState',
  'intent',
  'taskState',
  'requiredFieldsState',
  'evidenceDecision',
  'policyDecision',
  'toolDecision',
  'responsePlan',
  'abstainOrEscalationReason',
]);

const ALLOWED_TTS_FIELDS = new Set([
  'writtenText',
  'spokenText',
  'safeAudioType',
  'firstSafeAudioAt',
  'firstFullAnswerAudioAt',
  'audioStartAt',
  'audioEndAt',
  'pronunciationProfile',
  'pronunciationReviewRequired',
  'factPreserved',
]);

const ALLOWED_PIPELINE_FIELDS = new Set([
  'callId',
  'turnId',
  'provider',
  'channel',
  'normalSupportedTurn',
  'supportedNonToolTurn',
  'exceptionPath',
  'stt',
  'ttt',
  'tts',
  'runtime',
]);

const ALLOWED_RUNTIME_FIELDS = new Set([
  'interactionState',
  'providerResponseId',
  'interruptedResponseId',
  'stoppedResponseId',
  'newTurnId',
  'interruptionReceivedAt',
  'bargeInRecoveredAt',
  'transportDelayMs',
  'bargeInRecoveryMs',
  'staleAudioStopped',
]);

const SUPPORTED_GERMAN_LOCALES = new Set(['de', 'de-DE', 'de-AT', 'de-CH']);
const STT_REDACTION_STATES = new Set<SttTranscriptRedactionState>([
  'raw_not_stored',
  'redacted',
  'pii_allowed_for_user_confirmation',
]);
const TTT_REDACTION_STATES = new Set<TextReasoningRedactionState>([
  'redacted',
  'pii_allowed_for_user_confirmation',
]);
const SAFE_AUDIO_TYPES = new Set<VoiceSafeAudioType>([
  'evidence_backed_answer',
  'targeted_clarification',
  'valid_abstain',
  'valid_escalation',
  'policy_confirmation',
  'tool_status_update',
  'filler_only',
]);
const EVIDENCE_DECISIONS = new Set<VoicePipelineEvidenceDecision>([
  'approved_current',
  'not_required',
  'unsupported',
  'stale',
  'unapproved',
  'missing',
]);
const POLICY_DECISIONS = new Set<VoicePipelinePolicyDecision>([
  'answer_allowed',
  'clarification_required',
  'abstain_required',
  'escalation_required',
  'policy_denied',
  'missing',
]);
const TOOL_DECISIONS = new Set<VoicePipelineToolDecision>([
  'no_tool_required',
  'tool_required',
  'tool_pending',
  'mutation_confirmation_required',
  'tool_unavailable',
  'missing',
]);
const TRANSCRIPT_SOURCES = new Set<VoicePipelineTranscriptSource>([
  'canonical_partial',
  'canonical_final',
  'manual_test_fixture',
]);
const INTENTS = new Set<VoicePipelineIntent>([
  'opening_hours',
  'pricing_or_policy',
  'booking_or_reschedule',
  'human_escalation',
  'unsupported_or_out_of_scope',
  'unknown',
]);
const TASK_STATES = new Set<VoicePipelineTaskState>([
  'answering',
  'collecting_fields',
  'confirming',
  'abstaining',
  'escalating',
  'tool_wait',
  'degraded',
]);
const REQUIRED_FIELDS_STATES = new Set<VoicePipelineRequiredFieldsState>([
  'not_required',
  'missing_required_fields',
  'complete',
  'needs_confirmation',
]);
const RESPONSE_PLANS = new Set<VoicePipelineResponsePlan>([
  'answer_with_current_hours',
  'answer_with_evidence',
  'ask_targeted_clarification',
  'ask_policy_confirmation',
  'valid_abstain',
  'valid_escalation',
  'tool_status_update',
]);
const ABSTAIN_OR_ESCALATION_REASONS = new Set<VoicePipelineAbstainOrEscalationReason>([
  'not_required',
  'source_stale',
  'source_missing',
  'source_unapproved',
  'policy_denied',
  'high_risk_answer_requires_audit',
  'unsupported_or_out_of_scope',
  'runtime_degraded',
]);
const PRONUNCIATION_PROFILES = new Set<VoicePipelinePronunciationProfile>([
  'de-DE-default',
  'de-AT-default',
  'de-CH-default',
  'tenant_verified',
  'human_reviewed',
]);
const RUNTIME_INTERACTION_STATES = new Set<NonNullable<VoicePipelineRuntimeInteractionLayer['interactionState']>>([
  'normal_turn',
  'interrupted',
  'tool_pending',
  'handoff',
  'degraded',
]);
const EXCEPTION_PATH_BUDGET_MS: Record<VoicePipelineExceptionPath, number> = {
  high_risk_audited_answer: 800,
  tool_mutation_confirmation: 1000,
  valid_escalation: 1000,
  unsupported_or_out_of_scope: 800,
  runtime_degraded: 1200,
};
const EXCEPTION_PATHS = new Set<VoicePipelineExceptionPath>(Object.keys(EXCEPTION_PATH_BUDGET_MS) as VoicePipelineExceptionPath[]);
const RUNTIME_PROVIDERS = new Set<RuntimeProvider>(['retell', 'openai_realtime', 'web_chat', 'unknown']);
const INTERACTION_CHANNELS = new Set<InteractionChannel>(['voice', 'web', 'internal_test']);
const PROVIDER_VALUE_PATTERN = /(retell|openai|realtime|response_required|response\.|websocket|voice_id|codec|ssml|phoneme|provider_payload)/i;

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

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasUnexpectedField(input: Record<string, unknown>, allowedFields: ReadonlySet<string>): boolean {
  return Object.keys(input).some((key) => !allowedFields.has(key));
}

function pushIf<T>(items: T[], condition: boolean, value: T): void {
  if (condition) items.push(value);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function hasNegative(values: Array<number | null>): boolean {
  return values.some((value) => typeof value === 'number' && value < 0);
}

function addFailureClass(items: VoicePipelineFailureClass[], value: VoicePipelineFailureClass): void {
  if (!items.includes(value)) items.push(value);
}

function supportedGermanLocale(value: string | null | undefined): boolean {
  return typeof value === 'string' && SUPPORTED_GERMAN_LOCALES.has(value);
}

function evidenceDecisionValid(value: VoicePipelineEvidenceDecision | null | undefined): value is VoicePipelineEvidenceDecision {
  return value != null && EVIDENCE_DECISIONS.has(value);
}

function policyDecisionValid(value: VoicePipelinePolicyDecision | null | undefined): value is VoicePipelinePolicyDecision {
  return value != null && POLICY_DECISIONS.has(value);
}

function toolDecisionValid(value: VoicePipelineToolDecision | null | undefined): value is VoicePipelineToolDecision {
  return value != null && TOOL_DECISIONS.has(value);
}

function transcriptSourceValid(value: VoicePipelineTranscriptSource | null | undefined): value is VoicePipelineTranscriptSource {
  return value != null && TRANSCRIPT_SOURCES.has(value);
}

function intentValid(value: VoicePipelineIntent | null | undefined): value is VoicePipelineIntent {
  return value != null && INTENTS.has(value);
}

function taskStateValid(value: VoicePipelineTaskState | null | undefined): value is VoicePipelineTaskState {
  return value != null && TASK_STATES.has(value);
}

function requiredFieldsStateValid(value: VoicePipelineRequiredFieldsState | null | undefined): value is VoicePipelineRequiredFieldsState {
  return value != null && REQUIRED_FIELDS_STATES.has(value);
}

function responsePlanValid(value: VoicePipelineResponsePlan | null | undefined): value is VoicePipelineResponsePlan {
  return value != null && RESPONSE_PLANS.has(value);
}

function abstainOrEscalationReasonValid(value: VoicePipelineAbstainOrEscalationReason | null | undefined): value is VoicePipelineAbstainOrEscalationReason {
  return value != null && ABSTAIN_OR_ESCALATION_REASONS.has(value);
}

function pronunciationProfileValid(value: VoicePipelinePronunciationProfile | null | undefined): value is VoicePipelinePronunciationProfile {
  return value != null && PRONUNCIATION_PROFILES.has(value);
}

function evidenceDecisionUnsafe(value: VoicePipelineEvidenceDecision | null | undefined): boolean {
  return value === 'unsupported' || value === 'stale' || value === 'unapproved' || value === 'missing';
}

function safeAudioTypeValid(value: VoiceSafeAudioType | null | undefined): value is VoiceSafeAudioType {
  return value != null && SAFE_AUDIO_TYPES.has(value);
}

function sttRedactionStateValid(value: SttTranscriptRedactionState | null | undefined): value is SttTranscriptRedactionState {
  return value != null && STT_REDACTION_STATES.has(value);
}

function tttRedactionStateValid(value: TextReasoningRedactionState | null | undefined): value is TextReasoningRedactionState {
  return value != null && TTT_REDACTION_STATES.has(value);
}

function policySafeAudioMismatch(input: VoicePipelineContract): boolean {
  const safeAudio = input.tts.safeAudioType;
  if (!policyDecisionValid(input.ttt.policyDecision) || !toolDecisionValid(input.ttt.toolDecision) || !safeAudioTypeValid(safeAudio)) return false;
  let mismatch = false;
  if (input.ttt.policyDecision === 'abstain_required' || input.ttt.policyDecision === 'policy_denied') {
    mismatch = mismatch || safeAudio !== 'valid_abstain';
  }
  if (input.ttt.policyDecision === 'escalation_required') mismatch = mismatch || safeAudio !== 'valid_escalation';
  if (input.ttt.policyDecision === 'clarification_required') mismatch = mismatch || safeAudio !== 'targeted_clarification';
  if (input.ttt.policyDecision === 'answer_allowed' && input.ttt.toolDecision === 'no_tool_required') {
    mismatch = mismatch || safeAudio !== 'evidence_backed_answer';
  }
  if (input.ttt.toolDecision === 'mutation_confirmation_required') mismatch = mismatch || safeAudio !== 'policy_confirmation';
  if (input.ttt.toolDecision === 'tool_pending') mismatch = mismatch || safeAudio !== 'tool_status_update';
  if (input.ttt.toolDecision === 'tool_required') {
    mismatch = mismatch || (safeAudio !== 'tool_status_update' && safeAudio !== 'targeted_clarification');
  }
  if (input.ttt.toolDecision === 'tool_unavailable') {
    mismatch = mismatch || (safeAudio !== 'valid_escalation' && safeAudio !== 'valid_abstain');
  }
  return mismatch;
}

function runtimeInteractionStateValid(value: VoicePipelineRuntimeInteractionLayer['interactionState']): boolean {
  return value != null && RUNTIME_INTERACTION_STATES.has(value);
}

function exceptionPathValid(value: VoicePipelineExceptionPath | null | undefined): value is VoicePipelineExceptionPath {
  return value != null && EXCEPTION_PATHS.has(value);
}

function runtimeProviderValid(value: RuntimeProvider | undefined): boolean {
  return value != null && RUNTIME_PROVIDERS.has(value);
}

function interactionChannelValid(value: InteractionChannel | undefined): boolean {
  return value != null && INTERACTION_CHANNELS.has(value);
}

function providerSpecificValuePresent(value: string | null | undefined): boolean {
  return typeof value === 'string' && PROVIDER_VALUE_PATTERN.test(value);
}

function invalidOptionalNonNegativeNumber(value: number | null | undefined): boolean {
  return value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0);
}

function exceptionPathSemanticMismatch(input: VoicePipelineContract): boolean {
  if (!exceptionPathValid(input.exceptionPath) || !safeAudioTypeValid(input.tts.safeAudioType)) return false;
  switch (input.exceptionPath) {
    case 'high_risk_audited_answer':
      return input.ttt.policyDecision !== 'clarification_required' ||
        input.tts.safeAudioType !== 'targeted_clarification';
    case 'tool_mutation_confirmation':
      return input.ttt.toolDecision !== 'mutation_confirmation_required' ||
        input.tts.safeAudioType !== 'policy_confirmation';
    case 'valid_escalation':
      return input.ttt.policyDecision !== 'escalation_required' ||
        input.tts.safeAudioType !== 'valid_escalation';
    case 'unsupported_or_out_of_scope':
      return !evidenceDecisionUnsafe(input.ttt.evidenceDecision) ||
        (input.tts.safeAudioType !== 'valid_abstain' && input.tts.safeAudioType !== 'targeted_clarification');
    case 'runtime_degraded':
      return input.runtime.interactionState !== 'degraded' ||
        (input.tts.safeAudioType !== 'tool_status_update' && input.tts.safeAudioType !== 'valid_escalation');
  }
}

export function evaluateVoicePipelineContract(input: VoicePipelineContract): VoicePipelineContractEvaluation {
  const failureClasses: VoicePipelineFailureClass[] = [];

  const sttAudioStart = toEpochMs(input.stt.audioStartAt);
  const sttAudioEnd = toEpochMs(input.stt.audioEndDetectedAt);
  const sttProviderEnd = toEpochMs(input.stt.providerEndOfTurnAt);
  const sttPartialFirst = toEpochMs(input.stt.partialFirstAt);
  const sttFinal = toEpochMs(input.stt.finalAt);
  const agentCoreTurnStart = toEpochMs(input.ttt.agentCoreTurnStartAt);
  const firstModelToken = toEpochMs(input.ttt.firstModelTokenAt);
  const firstSpeakableChunk = toEpochMs(input.ttt.firstSpeakableChunkAt);
  const firstSafeAudio = toEpochMs(input.tts.firstSafeAudioAt);
  const firstFullAnswerAudio = toEpochMs(input.tts.firstFullAnswerAudioAt);
  const ttsAudioStart = toEpochMs(input.tts.audioStartAt);
  const ttsAudioEnd = toEpochMs(input.tts.audioEndAt);
  const interruptionReceived = toEpochMs(input.runtime.interruptionReceivedAt);
  const bargeInRecovered = toEpochMs(input.runtime.bargeInRecoveredAt);
  const safeAudioCounts = safeAudioCountsForSlo(input.tts.safeAudioType);

  const attributionBlockers: VoicePipelineBlocker[] = [];
  pushIf(attributionBlockers, !hasText(input.callId) || !hasText(input.turnId), 'PIPELINE_ATTRIBUTION_MISSING');
  pushIf(attributionBlockers, !runtimeProviderValid(input.provider), 'PIPELINE_PROVIDER_INVALID');
  pushIf(attributionBlockers, !interactionChannelValid(input.channel), 'PIPELINE_CHANNEL_INVALID');
  pushIf(attributionBlockers, hasUnexpectedField(input as unknown as Record<string, unknown>, ALLOWED_PIPELINE_FIELDS), 'PROVIDER_SPECIFIC_PIPELINE_FIELD_PRESENT');

  const sttBlockers: VoicePipelineBlocker[] = [];
  pushIf(sttBlockers, sttAudioStart === null || sttAudioEnd === null || sttProviderEnd === null || sttPartialFirst === null || sttFinal === null, 'STT_TIMESTAMP_MISSING');
  pushIf(sttBlockers, input.stt.confidence == null, 'STT_CONFIDENCE_MISSING');
  pushIf(sttBlockers, input.stt.confidence != null && (typeof input.stt.confidence !== 'number' || !Number.isFinite(input.stt.confidence) || input.stt.confidence < 0 || input.stt.confidence > 1), 'STT_CONFIDENCE_INVALID');
  pushIf(sttBlockers, typeof input.stt.confidence === 'number' && Number.isFinite(input.stt.confidence) && input.stt.confidence < 0.5, 'STT_CONFIDENCE_BELOW_THRESHOLD');
  pushIf(sttBlockers, !hasText(input.stt.locale), 'STT_LOCALE_MISSING');
  pushIf(sttBlockers, hasText(input.stt.locale) && !supportedGermanLocale(input.stt.locale), 'STT_LOCALE_UNSUPPORTED');
  pushIf(sttBlockers, input.stt.transcriptRedactionState == null, 'STT_REDACTION_STATE_MISSING');
  pushIf(sttBlockers, input.stt.transcriptRedactionState != null && !sttRedactionStateValid(input.stt.transcriptRedactionState), 'STT_REDACTION_STATE_INVALID');
  pushIf(sttBlockers, !hasText(input.stt.transcriptSource), 'STT_TRANSCRIPT_SOURCE_MISSING');
  pushIf(sttBlockers, hasText(input.stt.transcriptSource) && !transcriptSourceValid(input.stt.transcriptSource), 'STT_TRANSCRIPT_SOURCE_INVALID');
  pushIf(sttBlockers, hasUnexpectedField(input.stt as Record<string, unknown>, ALLOWED_STT_FIELDS), 'PROVIDER_SPECIFIC_STT_FIELD_PRESENT');
  pushIf(sttBlockers, providerSpecificValuePresent(input.stt.transcriptSource), 'PROVIDER_SPECIFIC_STT_VALUE_PRESENT');

  const tttBlockers: VoicePipelineBlocker[] = [];
  pushIf(tttBlockers, agentCoreTurnStart === null || firstModelToken === null || firstSpeakableChunk === null, 'TTT_TIMESTAMP_MISSING');
  pushIf(tttBlockers, !hasText(input.ttt.canonicalUserUtterance), 'TTT_CANONICAL_UTTERANCE_MISSING');
  pushIf(tttBlockers, input.ttt.canonicalUserUtteranceRedactionState == null, 'TTT_REDACTION_STATE_MISSING');
  pushIf(tttBlockers, input.ttt.canonicalUserUtteranceRedactionState != null && !tttRedactionStateValid(input.ttt.canonicalUserUtteranceRedactionState), 'TTT_REDACTION_STATE_INVALID');
  pushIf(tttBlockers, !hasText(input.ttt.abstainOrEscalationReason), 'TTT_ABSTAIN_OR_ESCALATION_REASON_MISSING');
  const validEvidenceDecision = evidenceDecisionValid(input.ttt.evidenceDecision);
  const validPolicyDecision = policyDecisionValid(input.ttt.policyDecision);
  const validToolDecision = toolDecisionValid(input.ttt.toolDecision);
  const validIntent = intentValid(input.ttt.intent);
  const validTaskState = taskStateValid(input.ttt.taskState);
  const validRequiredFieldsState = requiredFieldsStateValid(input.ttt.requiredFieldsState);
  const validResponsePlan = responsePlanValid(input.ttt.responsePlan);
  const validAbstainOrEscalationReason = abstainOrEscalationReasonValid(input.ttt.abstainOrEscalationReason);
  pushIf(
    tttBlockers,
    !hasText(input.ttt.intent) ||
      !hasText(input.ttt.taskState) ||
      !hasText(input.ttt.requiredFieldsState) ||
      !validEvidenceDecision ||
      input.ttt.evidenceDecision === 'missing' ||
      !validPolicyDecision ||
      input.ttt.policyDecision === 'missing' ||
      !validToolDecision ||
      input.ttt.toolDecision === 'missing' ||
      !hasText(input.ttt.responsePlan),
    'TTT_DECISION_MISSING',
  );
  pushIf(
    tttBlockers,
    (hasText(input.ttt.intent) && !validIntent) ||
      (hasText(input.ttt.taskState) && !validTaskState) ||
      (hasText(input.ttt.requiredFieldsState) && !validRequiredFieldsState) ||
      (hasText(input.ttt.responsePlan) && !validResponsePlan) ||
      (hasText(input.ttt.abstainOrEscalationReason) && !validAbstainOrEscalationReason),
    'TTT_CANONICAL_FIELD_INVALID',
  );
  pushIf(
    tttBlockers,
    validEvidenceDecision &&
      evidenceDecisionUnsafe(input.ttt.evidenceDecision) &&
      (input.ttt.policyDecision === 'answer_allowed' || input.tts.safeAudioType === 'evidence_backed_answer'),
    'TTT_UNSAFE_EVIDENCE_DECISION',
  );
  pushIf(
    tttBlockers,
    validPolicyDecision && input.ttt.policyDecision === 'policy_denied' && input.tts.safeAudioType !== 'valid_abstain' && input.tts.safeAudioType !== 'valid_escalation',
    'TTT_POLICY_NOT_ALLOWED',
  );
  pushIf(tttBlockers, policySafeAudioMismatch(input), 'TTT_POLICY_SAFE_AUDIO_MISMATCH');
  pushIf(tttBlockers, hasUnexpectedField(input.ttt as Record<string, unknown>, ALLOWED_TTT_FIELDS), 'PROVIDER_SPECIFIC_TTT_FIELD_PRESENT');
  pushIf(
    tttBlockers,
    [
      input.ttt.canonicalUserUtterance,
      input.ttt.intent,
      input.ttt.taskState,
      input.ttt.requiredFieldsState,
      input.ttt.responsePlan,
      input.ttt.abstainOrEscalationReason,
    ].some(providerSpecificValuePresent),
    'PROVIDER_SPECIFIC_TTT_VALUE_PRESENT',
  );

  const ttsBlockers: VoicePipelineBlocker[] = [];
  pushIf(ttsBlockers, !hasText(input.tts.writtenText), 'TTS_WRITTEN_TEXT_MISSING');
  pushIf(ttsBlockers, !hasText(input.tts.spokenText), 'TTS_SPOKEN_TEXT_MISSING');
  pushIf(ttsBlockers, input.tts.safeAudioType == null, 'TTS_SAFE_AUDIO_TYPE_MISSING');
  pushIf(ttsBlockers, input.tts.safeAudioType != null && !safeAudioTypeValid(input.tts.safeAudioType), 'TTS_SAFE_AUDIO_TYPE_INVALID');
  pushIf(ttsBlockers, input.tts.safeAudioType === 'filler_only', 'TTS_FILLER_ONLY_NOT_SLO_ELIGIBLE');
  pushIf(ttsBlockers, firstSafeAudio === null || firstFullAnswerAudio === null || ttsAudioStart === null || ttsAudioEnd === null, 'TTS_AUDIO_TIMESTAMP_MISSING');
  pushIf(ttsBlockers, !hasText(input.tts.pronunciationProfile), 'TTS_PRONUNCIATION_PROFILE_MISSING');
  pushIf(ttsBlockers, hasText(input.tts.pronunciationProfile) && !pronunciationProfileValid(input.tts.pronunciationProfile), 'TTS_PRONUNCIATION_PROFILE_INVALID');
  pushIf(ttsBlockers, input.tts.pronunciationReviewRequired == null, 'TTS_PRONUNCIATION_REVIEW_STATE_MISSING');
  pushIf(ttsBlockers, input.tts.pronunciationReviewRequired != null && typeof input.tts.pronunciationReviewRequired !== 'boolean', 'TTS_PRONUNCIATION_REVIEW_STATE_INVALID');
  pushIf(ttsBlockers, input.tts.pronunciationReviewRequired === true, 'TTS_PRONUNCIATION_REVIEW_UNRESOLVED');
  pushIf(ttsBlockers, input.tts.factPreserved !== true, 'TTS_FACT_PRESERVATION_UNVERIFIED');
  const voiceE2eMs = safeAudioCounts ? diffMs(sttAudioEnd ?? sttProviderEnd, firstSafeAudio) : null;
  pushIf(
    ttsBlockers,
    typeof input.normalSupportedTurn !== 'boolean' || typeof input.supportedNonToolTurn !== 'boolean',
    'TURN_SLO_CLASSIFICATION_MISSING',
  );
  pushIf(ttsBlockers, input.exceptionPath != null && !exceptionPathValid(input.exceptionPath), 'EXCEPTION_PATH_INVALID');
  pushIf(ttsBlockers, exceptionPathSemanticMismatch(input), 'EXCEPTION_PATH_SEMANTIC_MISMATCH');
  pushIf(
    ttsBlockers,
    typeof input.normalSupportedTurn === 'boolean' &&
      typeof input.supportedNonToolTurn === 'boolean' &&
      (
        (input.normalSupportedTurn === true && input.supportedNonToolTurn !== true) ||
        (input.exceptionPath != null && (input.normalSupportedTurn !== false || input.supportedNonToolTurn !== false)) ||
        (input.normalSupportedTurn === false && input.exceptionPath == null)
      ),
    'TURN_SLO_CLASSIFICATION_INVALID',
  );
  pushIf(
    ttsBlockers,
    exceptionPathValid(input.exceptionPath) &&
      typeof voiceE2eMs === 'number' &&
      voiceE2eMs > EXCEPTION_PATH_BUDGET_MS[input.exceptionPath],
    'EXCEPTION_PATH_SAFE_AUDIO_ABOVE_BUDGET',
  );
  pushIf(ttsBlockers, input.normalSupportedTurn === true && typeof voiceE2eMs === 'number' && voiceE2eMs > 800, 'NORMAL_SUPPORTED_SAFE_AUDIO_ABOVE_800_MS');
  pushIf(ttsBlockers, input.supportedNonToolTurn === true && typeof voiceE2eMs === 'number' && voiceE2eMs > 1000, 'SUPPORTED_NON_TOOL_SAFE_AUDIO_ABOVE_1000_MS');
  pushIf(ttsBlockers, hasUnexpectedField(input.tts as Record<string, unknown>, ALLOWED_TTS_FIELDS), 'PROVIDER_SPECIFIC_TTS_FIELD_PRESENT');
  pushIf(
    ttsBlockers,
    [
      input.tts.writtenText,
      input.tts.spokenText,
      input.tts.pronunciationProfile,
    ].some(providerSpecificValuePresent),
    'PROVIDER_SPECIFIC_TTS_VALUE_PRESENT',
  );

  const runtimeBlockers: VoicePipelineBlocker[] = [];
  pushIf(runtimeBlockers, input.runtime.interactionState == null, 'RUNTIME_INTERACTION_STATE_MISSING');
  pushIf(runtimeBlockers, input.runtime.interactionState != null && !runtimeInteractionStateValid(input.runtime.interactionState), 'RUNTIME_INTERACTION_STATE_INVALID');
  pushIf(runtimeBlockers, hasUnexpectedField(input.runtime as Record<string, unknown>, ALLOWED_RUNTIME_FIELDS), 'PROVIDER_SPECIFIC_RUNTIME_FIELD_PRESENT');
  pushIf(runtimeBlockers, invalidOptionalNonNegativeNumber(input.runtime.transportDelayMs), 'RUNTIME_TRANSPORT_DELAY_INVALID');
  pushIf(runtimeBlockers, invalidOptionalNonNegativeNumber(input.runtime.bargeInRecoveryMs), 'RUNTIME_BARGE_IN_RECOVERY_INVALID');
  const timestampBargeInRecoveryMs = diffMs(interruptionReceived, bargeInRecovered);
  const suppliedBargeInRecoveryMs = typeof input.runtime.bargeInRecoveryMs === 'number' && Number.isFinite(input.runtime.bargeInRecoveryMs) ? input.runtime.bargeInRecoveryMs : null;
  const bargeInRecoveryMs = timestampBargeInRecoveryMs ?? suppliedBargeInRecoveryMs;
  if (input.runtime.interactionState === 'interrupted') {
    pushIf(runtimeBlockers, interruptionReceived === null || bargeInRecovered === null, 'RUNTIME_INTERRUPTION_TIMESTAMP_MISSING');
    pushIf(
      runtimeBlockers,
      !hasText(input.runtime.interruptedResponseId) ||
        !hasText(input.runtime.stoppedResponseId) ||
        !hasText(input.runtime.newTurnId) ||
        input.runtime.providerResponseId !== input.runtime.interruptedResponseId ||
        input.runtime.stoppedResponseId !== input.runtime.interruptedResponseId ||
        input.runtime.newTurnId === input.turnId,
      'RUNTIME_INTERRUPTION_CORRELATION_MISSING',
    );
    pushIf(runtimeBlockers, input.runtime.staleAudioStopped !== true, 'RUNTIME_STALE_AUDIO_NOT_STOPPED');
    pushIf(runtimeBlockers, (bargeInRecoveryMs ?? Number.POSITIVE_INFINITY) > 500, 'RUNTIME_BARGE_IN_RECOVERY_ABOVE_500MS');
    pushIf(
      runtimeBlockers,
      timestampBargeInRecoveryMs !== null &&
        suppliedBargeInRecoveryMs !== null &&
        Math.abs(timestampBargeInRecoveryMs - suppliedBargeInRecoveryMs) > 5,
      'RUNTIME_BARGE_IN_RECOVERY_MISMATCH',
    );
  }

  const sttTimestampOrderInvalid = hasNegative([
    diffMs(sttAudioStart, sttPartialFirst),
    diffMs(sttAudioStart, sttAudioEnd),
    diffMs(sttPartialFirst, sttFinal),
    diffMs(sttAudioEnd, sttProviderEnd),
    diffMs(sttAudioEnd, sttFinal),
  ]);
  const tttTimestampOrderInvalid = hasNegative([
    diffMs(sttFinal, agentCoreTurnStart),
    diffMs(agentCoreTurnStart, firstModelToken),
    diffMs(firstModelToken, firstSpeakableChunk),
  ]);
  const ttsTimestampOrderInvalid = hasNegative([
    safeAudioCounts ? diffMs(firstSpeakableChunk, firstSafeAudio) : null,
    safeAudioCounts ? diffMs(firstSafeAudio, firstFullAnswerAudio) : null,
    safeAudioCounts ? diffMs(ttsAudioStart, firstSafeAudio) : null,
    diffMs(firstFullAnswerAudio, ttsAudioEnd),
  ]);
  const runtimeTimestampOrderInvalid = hasNegative([
    diffMs(interruptionReceived, bargeInRecovered),
  ]);
  if (sttTimestampOrderInvalid) sttBlockers.push('INVALID_PIPELINE_TIMESTAMP_ORDER');
  if (tttTimestampOrderInvalid) tttBlockers.push('INVALID_PIPELINE_TIMESTAMP_ORDER');
  if (ttsTimestampOrderInvalid) ttsBlockers.push('INVALID_PIPELINE_TIMESTAMP_ORDER');
  if (runtimeTimestampOrderInvalid) runtimeBlockers.push('INVALID_PIPELINE_TIMESTAMP_ORDER');

  if (sttBlockers.length > 0) addFailureClass(failureClasses, 'asr_stt_failure');
  if (tttBlockers.length > 0) addFailureClass(failureClasses, 'text_reasoning_ttt_failure');
  if (ttsBlockers.length > 0) addFailureClass(failureClasses, 'tts_spoken_output_failure');
  if (runtimeBlockers.length > 0) addFailureClass(failureClasses, 'runtime_interaction_failure');

  const metrics: VoicePipelineMetrics = {
    sttFinalLatencyMs: diffMs(sttAudioEnd, sttFinal),
    tttToFirstSafeAudioMs: safeAudioCounts ? diffMs(agentCoreTurnStart, firstSafeAudio) : null,
    tttFirstTokenLatencyMs: diffMs(agentCoreTurnStart, firstModelToken),
    tttSpeakableChunkLatencyMs: diffMs(agentCoreTurnStart, firstSpeakableChunk),
    firstSpeakableChunkToSafeAudioMs: safeAudioCounts ? diffMs(firstSpeakableChunk, firstSafeAudio) : null,
    ttsAudioStartToSafeAudioMs: safeAudioCounts ? diffMs(ttsAudioStart, firstSafeAudio) : null,
    ttsAudioStartToFullAnswerMs: diffMs(ttsAudioStart, firstFullAnswerAudio),
    voiceE2eFirstSafeAudioMs: safeAudioCounts ? diffMs(sttAudioEnd, firstSafeAudio) : null,
    voiceE2eFullAnswerAudioMs: diffMs(sttAudioEnd, firstFullAnswerAudio),
    runtimeTransportDelayMs: typeof input.runtime.transportDelayMs === 'number' && Number.isFinite(input.runtime.transportDelayMs) ? input.runtime.transportDelayMs : null,
    bargeInRecoveryMs,
  };

  const uniqueBlockers = unique([
    ...attributionBlockers,
    ...sttBlockers,
    ...tttBlockers,
    ...ttsBlockers,
    ...runtimeBlockers,
  ]);
  return {
    ready: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    failureClasses,
    layerReadiness: {
      stt: sttBlockers.length === 0,
      ttt: tttBlockers.length === 0,
      tts: ttsBlockers.length === 0,
      runtime_interaction: runtimeBlockers.length === 0,
    },
    metrics,
  };
}
