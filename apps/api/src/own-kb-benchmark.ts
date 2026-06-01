import {
  evaluateVoiceLatencyContract,
  type VoiceLatencyTimestampContract,
} from './voice-latency-contract.js';

export type RetellVsOwnKbDecision =
  | 'keep_retell_primary'
  | 'owkb_shadow_only'
  | 'owkb_canary_candidate'
  | 'owkb_primary_candidate';

export type KnowledgeBenchmarkProvider = 'retell_kb' | 'own_kb';

export type BenchmarkRisk = 'low' | 'medium' | 'high' | 'pricing' | 'legal' | 'policy';

export type BenchmarkRetrievalMode =
  | 'none'
  | 'pinned'
  | 'cache'
  | 'structured_fact'
  | 'retell_kb'
  | 'fts'
  | 'vector'
  | 'hybrid'
  | 'rerank';

export type BenchmarkAuditability = 'sufficient' | 'insufficient' | 'unknown';

export type KnowledgeBenchmarkBlocker =
  | 'APPROVED_0_5B_ARTIFACT_REQUIRED'
  | 'PROMOTION_EVIDENCE_UNTRUSTED_UNTIL_MILESTONE_1A_1B_1D_AND_1E_PASS'
  | 'PII_REDACTION_GATE_FAILED'
  | 'TRACE_SCOPE_GATE_FAILED'
  | 'VOICE_LATENCY_MEASUREMENT_GATE_FAILED'
  | 'RETELL_KB_BASELINE_MISSING'
  | 'RETELL_AND_OWN_KB_NOT_MEASURED_ON_SAME_QUESTIONS'
  | 'INSUFFICIENT_PAIRED_QUESTION_COVERAGE'
  | 'INSUFFICIENT_INTENT_COVERAGE'
  | 'INSUFFICIENT_HIGH_RISK_COVERAGE'
  | 'INSUFFICIENT_PRICING_COVERAGE'
  | 'INSUFFICIENT_LEGAL_COVERAGE'
  | 'INSUFFICIENT_POLICY_COVERAGE'
  | 'INSUFFICIENT_STALE_ONLY_COVERAGE'
  | 'INSUFFICIENT_OUT_OF_SCOPE_COVERAGE'
  | 'INSUFFICIENT_GERMAN_ASR_COVERAGE'
  | 'INSUFFICIENT_INTERRUPTION_OR_CORRECTION_COVERAGE'
  | 'INSUFFICIENT_NORMAL_SUPPORTED_COVERAGE'
  | 'INSUFFICIENT_SUPPORTED_NON_TOOL_COVERAGE'
  | 'MISSING_QUESTION_FINGERPRINT'
  | 'QUESTION_FINGERPRINT_MISMATCH'
  | 'DUPLICATE_QUESTION_FINGERPRINT'
  | 'QUESTION_METADATA_MISMATCH'
  | 'DUPLICATE_PROVIDER_SAMPLE_FOR_QUESTION'
  | 'MISSING_VOICE_E2E_METRICS'
  | 'MISSING_VOICE_LATENCY_CONTRACT'
  | 'VOICE_LATENCY_CONTRACT_NOT_READY'
  | 'FILLER_ONLY_USED_AS_SAFE_AUDIO'
  | 'MISSING_KB_CONTEXT_METRICS'
  | 'MISSING_QUALITY_LABELS'
  | 'MISSING_P0_P1_LABELS'
  | 'MISSING_ABSTAIN_LABELS'
  | 'MISSING_HALLUCINATION_LABELS'
  | 'MISSING_AUDITABILITY_LABELS'
  | 'MISSING_SAFETY_LABELS'
  | 'MISSING_RETELL_BASELINE_METRICS'
  | 'RETELL_BASELINE_LABELS_MISSING'
  | 'INVALID_RECALL_AT_5_LABELS'
  | 'OWN_KB_NO_SAMPLES'
  | 'OWN_KB_NO_NORMAL_SUPPORTED_TURNS'
  | 'OWN_KB_NO_SUPPORTED_NON_TOOL_TURNS'
  | 'OWN_KB_P0_FAILURES_PRESENT'
  | 'OWN_KB_ANSWER_CORRECTNESS_BELOW_98_PERCENT'
  | 'OWN_KB_ANSWERABILITY_BELOW_98_PERCENT'
  | 'OWN_KB_NORMAL_SUPPORTED_TURN_NOT_ANSWERABLE'
  | 'OWN_KB_ABSTAIN_CORRECTNESS_BELOW_98_PERCENT'
  | 'OWN_KB_P1_PASS_RATE_BELOW_98_PERCENT'
  | 'OWN_KB_P1_FAILURES_PRESENT'
  | 'OWN_KB_HALLUCINATIONS_PRESENT'
  | 'OWN_KB_HALLUCINATION_LABEL_CONFLICT'
  | 'OWN_KB_RETRIEVAL_REQUIRED_SAMPLES_MISSING'
  | 'MISSING_RECALL_AT_5_LABELS'
  | 'OWN_KB_RECALL_AT_5_BELOW_90_PERCENT'
  | 'OWN_KB_FAST_PATH_COVERAGE_BELOW_80_PERCENT'
  | 'OWN_KB_TENANT_ISOLATION_NOT_PROVEN'
  | 'OWN_KB_STALE_UNAPPROVED_BLOCKING_NOT_PROVEN'
  | 'OWN_KB_PII_HANDLING_NOT_PROVEN'
  | 'OWN_KB_PROMPT_INJECTION_HANDLING_NOT_PROVEN'
  | 'OWN_KB_AUDITABILITY_NOT_SUFFICIENT'
  | 'OWN_KB_HIGH_RISK_AUDITABILITY_NOT_SUFFICIENT'
  | 'OWN_KB_NORMAL_E2E_P50_ABOVE_500MS'
  | 'OWN_KB_NORMAL_E2E_P90_ABOVE_700MS'
  | 'OWN_KB_NORMAL_E2E_P95_ABOVE_800MS'
  | 'OWN_KB_SUPPORTED_NON_TOOL_P95_ABOVE_1000MS'
  | 'OWN_KB_NORMAL_E2E_P99_ABOVE_1200MS_TARGET'
  | 'OWN_KB_CONTEXT_P95_ABOVE_100MS'
  | 'OWN_KB_CACHE_OR_PINNED_P95_ABOVE_50MS'
  | 'OWN_KB_FTS_FIRST_P95_ABOVE_100MS'
  | 'OWN_KB_EXCEPTION_PATH_SLO_METRICS_MISSING'
  | 'SLOW_RAG_USED_IN_NORMAL_800MS_PATH'
  | 'OWN_KB_DOES_NOT_MEET_RETELL_LATENCY_PARITY'
  | 'RETELL_KB_MATERIALLY_FASTER_WITH_EQUAL_OR_BETTER_QUALITY';

export type KnowledgeBenchmarkPrimaryBlocker =
  | 'PRIMARY_REQUIRES_14_DAY_CANARY_WITHOUT_P0'
  | 'PRIMARY_REQUIRES_RETELL_STANDBY_READY'
  | 'PRIMARY_REQUIRES_ROLLBACK_TESTED'
  | 'PRIMARY_REQUIRES_KILL_SWITCH_TESTED';

export type KnowledgeBenchmarkCanaryBlocker =
  | 'CANARY_REQUIRES_PRODUCT_KPI_HARD_GATES'
  | 'CANARY_REQUIRES_EXCEPTION_PATH_SLO_REPORTING'
  | 'CANARY_REQUIRES_RETELL_STANDBY_READY'
  | 'CANARY_REQUIRES_ROLLBACK_TESTED'
  | 'CANARY_REQUIRES_KILL_SWITCH_TESTED';

export type KnowledgeBenchmarkSample = {
  provider: KnowledgeBenchmarkProvider;
  questionId: string;
  questionFingerprint?: string | null;
  intent?: string | null;
  risk?: BenchmarkRisk;
  retrievalMode?: BenchmarkRetrievalMode;
  normalSupportedTurn?: boolean;
  supportedNonToolTurn?: boolean;
  staleOnlyCase?: boolean;
  outOfScopeCase?: boolean;
  germanAsrVariant?: boolean;
  interruptionOrCorrectionCase?: boolean;
  voiceLatency?: VoiceLatencyTimestampContract | null;
  voiceE2eMs?: number | null;
  timeToFirstAudioMs?: number | null;
  kbContextMs?: number | null;
  retellKbLatencyImpactMs?: number | null;
  finalAuditedAnswerMs?: number | null;
  bargeInRecoveryMs?: number | null;
  toolLatencyMs?: number | null;
  toolCallCase?: boolean;
  answerCorrect?: boolean | null;
  answerable?: boolean | null;
  shouldAbstain?: boolean | null;
  abstained?: boolean | null;
  hallucinated?: boolean | null;
  recallAt5?: number | null;
  auditability?: BenchmarkAuditability;
  tenantIsolationPassed?: boolean | null;
  staleUnapprovedBlocked?: boolean | null;
  piiSafe?: boolean | null;
  promptInjectionSafe?: boolean | null;
  p0Failure?: boolean | null;
  p1Failure?: boolean | null;
};

export type KnowledgeBenchmarkSafetyGates = {
  trustedScopePassed: boolean;
  dbRlsReadinessPassed: boolean;
  piiRedactionPassed: boolean;
  traceScopePassed: boolean;
  voiceLatencyMeasurementPassed: boolean;
  productKpiHardGatesPassed: boolean;
  exceptionPathSloReported: boolean;
  canaryWithoutP0Days: number;
  retellStandbyReady: boolean;
  rollbackTested: boolean;
  killSwitchTested: boolean;
};

export type KnowledgeBenchmarkSlo = {
  normalSupportedVoiceP50Ms: number;
  normalSupportedVoiceP90Ms: number;
  normalSupportedVoiceP95Ms: number;
  supportedNonToolVoiceP95Ms: number;
  voiceP99TargetMs: number;
  kbContextP95Ms: number;
  cacheOrPinnedP95Ms: number;
  retellKbImpactP95Ms: number;
  ownKbFtsFirstP95Ms: number;
};

export type KnowledgeBenchmarkCoverageRequirements = {
  minPairedQuestions: number;
  minUniqueIntents: number;
  minHighRiskCases: number;
  minPricingCases: number;
  minLegalCases: number;
  minPolicyCases: number;
  minStaleOnlyCases: number;
  minOutOfScopeCases: number;
  minGermanAsrVariantCases: number;
  minInterruptionOrCorrectionCases: number;
  minNormalSupportedCases: number;
  minSupportedNonToolCases: number;
};

export type KnowledgeBenchmarkCoverage = {
  retellQuestionCount: number;
  ownKbQuestionCount: number;
  pairedQuestionCount: number;
  uniqueIntentCount: number;
  highRiskCaseCount: number;
  pricingCaseCount: number;
  legalCaseCount: number;
  policyCaseCount: number;
  staleOnlyCaseCount: number;
  outOfScopeCaseCount: number;
  germanAsrVariantCount: number;
  interruptionOrCorrectionCaseCount: number;
  normalSupportedCaseCount: number;
  supportedNonToolCaseCount: number;
};

export type KnowledgeProviderMetrics = {
  provider: KnowledgeBenchmarkProvider;
  sampleCount: number;
  normalSupportedTurnCount: number;
  supportedNonToolTurnCount: number;
  p50VoiceE2eMs: number | null;
  p90VoiceE2eMs: number | null;
  p95VoiceE2eMs: number | null;
  p99VoiceE2eMs: number | null;
  p95SupportedNonToolVoiceE2eMs: number | null;
  p95TimeToFirstAudioMs: number | null;
  p95ProviderEndToSafeAudioMs: number | null;
  p95AsrPartialToFinalMs: number | null;
  p95AsrFinalToSafeAudioMs: number | null;
  p95AgentCoreToSafeAudioMs: number | null;
  p95AgentCoreToFirstTokenMs: number | null;
  p95FirstTokenToSpeakableChunkMs: number | null;
  p95FirstSpeakableChunkToSafeAudioMs: number | null;
  p95FirstFullAnswerAudioMs: number | null;
  p95KbContextMs: number | null;
  p95RetellKbLatencyImpactMs: number | null;
  p95CacheOrPinnedMs: number | null;
  p95StructuredFactMs: number | null;
  p95FtsFirstMs: number | null;
  p95SlowRagMs: number | null;
  answerCorrectnessRate: number | null;
  answerabilityRate: number | null;
  normalSupportedUnanswerableCount: number;
  abstainCorrectnessRate: number | null;
  hallucinationRate: number | null;
  hallucinationCount: number;
  hallucinationLabelConflictCount: number;
  p1PassRate: number | null;
  meanRecallAt5: number | null;
  retrievalRequiredCount: number;
  missingRecallAt5Count: number;
  invalidRecallAt5Count: number;
  fastPathCoverageRate: number | null;
  auditability: BenchmarkAuditability;
  highRiskSampleCount: number;
  highRiskAuditabilityFailureCount: number;
  highRiskAuditabilityPassed: boolean;
  p0FailureCount: number;
  p1FailureCount: number;
  missingVoiceE2eMetricCount: number;
  missingVoiceLatencyContractCount: number;
  voiceLatencyContractFailureCount: number;
  fillerOnlySafeAudioCount: number;
  exceptionPathSampleCount: number;
  missingExceptionPathMetricCount: number;
  p95FinalAuditedAnswerMs: number | null;
  p95BargeInRecoveryMs: number | null;
  p95ToolLatencyMs: number | null;
  missingKbContextMetricCount: number;
  missingQualityLabelCount: number;
  missingP0P1LabelCount: number;
  missingAbstainLabelCount: number;
  missingHallucinationLabelCount: number;
  missingAuditabilityLabelCount: number;
  missingSafetyLabelCount: number;
  missingMetricCount: number;
  slowRagNormalPathCount: number;
  tenantIsolationPassed: boolean;
  staleUnapprovedBlockingPassed: boolean;
  piiHandlingPassed: boolean;
  promptInjectionHandlingPassed: boolean;
};

export type RetellVsOwnKbDecisionReport = {
  decision: RetellVsOwnKbDecision;
  promotionEvidenceTrusted: boolean;
  generatedAt: string;
  slo: KnowledgeBenchmarkSlo;
  coverageRequirements: KnowledgeBenchmarkCoverageRequirements;
  questionCoverage: KnowledgeBenchmarkCoverage;
  retell: KnowledgeProviderMetrics;
  ownKb: KnowledgeProviderMetrics;
  blockers: KnowledgeBenchmarkBlocker[];
  canaryBlockers: KnowledgeBenchmarkCanaryBlocker[];
  primaryBlockers: KnowledgeBenchmarkPrimaryBlocker[];
  warnings: string[];
};

export const ULTRA_LOW_LATENCY_SLO: KnowledgeBenchmarkSlo = {
  normalSupportedVoiceP50Ms: 500,
  normalSupportedVoiceP90Ms: 700,
  normalSupportedVoiceP95Ms: 800,
  supportedNonToolVoiceP95Ms: 1000,
  voiceP99TargetMs: 1200,
  kbContextP95Ms: 100,
  cacheOrPinnedP95Ms: 50,
  retellKbImpactP95Ms: 100,
  ownKbFtsFirstP95Ms: 100,
};

export const DEFAULT_BENCHMARK_COVERAGE_REQUIREMENTS: KnowledgeBenchmarkCoverageRequirements = {
  minPairedQuestions: 50,
  minUniqueIntents: 30,
  minHighRiskCases: 1,
  minPricingCases: 1,
  minLegalCases: 1,
  minPolicyCases: 1,
  minStaleOnlyCases: 1,
  minOutOfScopeCases: 1,
  minGermanAsrVariantCases: 1,
  minInterruptionOrCorrectionCases: 1,
  minNormalSupportedCases: 30,
  minSupportedNonToolCases: 40,
};

const MATERIAL_LATENCY_DELTA_MS = 100;
const MATERIAL_LATENCY_RATIO = 1.15;

const PROVISIONAL_BLOCKERS = new Set<KnowledgeBenchmarkBlocker>([
  'APPROVED_0_5B_ARTIFACT_REQUIRED',
  'PROMOTION_EVIDENCE_UNTRUSTED_UNTIL_MILESTONE_1A_1B_1D_AND_1E_PASS',
  'TRACE_SCOPE_GATE_FAILED',
  'VOICE_LATENCY_MEASUREMENT_GATE_FAILED',
  'RETELL_KB_BASELINE_MISSING',
  'RETELL_AND_OWN_KB_NOT_MEASURED_ON_SAME_QUESTIONS',
  'INSUFFICIENT_PAIRED_QUESTION_COVERAGE',
  'INSUFFICIENT_INTENT_COVERAGE',
  'INSUFFICIENT_HIGH_RISK_COVERAGE',
  'INSUFFICIENT_PRICING_COVERAGE',
  'INSUFFICIENT_LEGAL_COVERAGE',
  'INSUFFICIENT_POLICY_COVERAGE',
  'INSUFFICIENT_STALE_ONLY_COVERAGE',
  'INSUFFICIENT_OUT_OF_SCOPE_COVERAGE',
  'INSUFFICIENT_GERMAN_ASR_COVERAGE',
  'INSUFFICIENT_INTERRUPTION_OR_CORRECTION_COVERAGE',
  'INSUFFICIENT_NORMAL_SUPPORTED_COVERAGE',
  'INSUFFICIENT_SUPPORTED_NON_TOOL_COVERAGE',
  'MISSING_QUESTION_FINGERPRINT',
  'QUESTION_FINGERPRINT_MISMATCH',
  'DUPLICATE_QUESTION_FINGERPRINT',
  'QUESTION_METADATA_MISMATCH',
  'DUPLICATE_PROVIDER_SAMPLE_FOR_QUESTION',
  'MISSING_VOICE_E2E_METRICS',
  'MISSING_VOICE_LATENCY_CONTRACT',
  'VOICE_LATENCY_CONTRACT_NOT_READY',
  'MISSING_KB_CONTEXT_METRICS',
  'MISSING_QUALITY_LABELS',
  'MISSING_P0_P1_LABELS',
  'MISSING_ABSTAIN_LABELS',
  'MISSING_HALLUCINATION_LABELS',
  'MISSING_AUDITABILITY_LABELS',
  'MISSING_SAFETY_LABELS',
  'MISSING_RETELL_BASELINE_METRICS',
]);

function finiteMetric(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validRecallAt5(value: number | null | undefined): value is number {
  return finiteMetric(value) && value <= 1;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

function booleanRate(values: Array<boolean | null | undefined>, positive = true): number | null {
  const present = values.filter((value): value is boolean => typeof value === 'boolean');
  if (present.length === 0) return null;
  const matches = present.filter((value) => value === positive).length;
  return Number((matches / present.length).toFixed(6));
}

function mean(values: Array<number | null | undefined>): number | null {
  const present = values.filter(finiteMetric);
  if (present.length === 0) return null;
  const total = present.reduce((sum, value) => sum + value, 0);
  return Number((total / present.length).toFixed(6));
}

function p1PassRate(samples: KnowledgeBenchmarkSample[]): number | null {
  if (samples.length === 0) return null;
  if (samples.some((sample) => typeof sample.p1Failure !== 'boolean')) return null;
  const failures = samples.filter((sample) => sample.p1Failure === true).length;
  return Number(((samples.length - failures) / samples.length).toFixed(6));
}

function getLatency(samples: KnowledgeBenchmarkSample[], selector: (sample: KnowledgeBenchmarkSample) => number | null | undefined): number[] {
  return samples.map(selector).filter(finiteMetric);
}

function voiceLatencyEvaluation(sample: KnowledgeBenchmarkSample) {
  return sample.voiceLatency == null ? null : evaluateVoiceLatencyContract(sample.voiceLatency);
}

function sampleVoiceE2eMs(sample: KnowledgeBenchmarkSample): number | null | undefined {
  const evaluation = voiceLatencyEvaluation(sample);
  if (evaluation) return evaluation.ready ? evaluation.metrics.voiceE2eMs : null;
  return sample.voiceE2eMs;
}

function sampleTimeToFirstAudioMs(sample: KnowledgeBenchmarkSample): number | null | undefined {
  const evaluation = voiceLatencyEvaluation(sample);
  if (evaluation) {
    return evaluation.metrics.firstSafeAudioMs ?? evaluation.metrics.firstFillerAudioMs;
  }
  return sample.timeToFirstAudioMs;
}

function voiceLatencyMetric(
  sample: KnowledgeBenchmarkSample,
  selector: (metrics: NonNullable<ReturnType<typeof voiceLatencyEvaluation>>['metrics']) => number | null,
): number | null {
  const evaluation = voiceLatencyEvaluation(sample);
  return evaluation ? selector(evaluation.metrics) : null;
}

function isHighRisk(sample: Pick<KnowledgeBenchmarkSample, 'risk'>): boolean {
  return sample.risk === 'high' || sample.risk === 'pricing' || sample.risk === 'legal' || sample.risk === 'policy';
}

function isNormalSupportedTurn(sample: KnowledgeBenchmarkSample): boolean {
  return sample.normalSupportedTurn === true
    && sample.supportedNonToolTurn === true
    && sample.p0Failure !== true;
}

function isSupportedNonToolTurn(sample: KnowledgeBenchmarkSample): boolean {
  return sample.supportedNonToolTurn === true && sample.p0Failure !== true;
}

function isSlowRagMode(mode: BenchmarkRetrievalMode | undefined): boolean {
  return mode === 'vector' || mode === 'hybrid' || mode === 'rerank';
}

function isFastPathMode(mode: BenchmarkRetrievalMode | undefined): boolean {
  return mode === 'pinned' ||
    mode === 'cache' ||
    mode === 'structured_fact' ||
    mode === 'fts';
}

function needsKbContextMetric(sample: KnowledgeBenchmarkSample): boolean {
  return sample.provider === 'own_kb'
    && sample.retrievalMode !== undefined
    && sample.retrievalMode !== 'none'
    && sample.retrievalMode !== 'retell_kb';
}

function isExceptionPathSample(sample: KnowledgeBenchmarkSample): boolean {
  return isHighRisk(sample)
    || sample.interruptionOrCorrectionCase === true
    || sample.toolCallCase === true;
}

function missingExceptionPathMetric(sample: KnowledgeBenchmarkSample): boolean {
  if (isHighRisk(sample) && !finiteMetric(sample.finalAuditedAnswerMs)) return true;
  if (sample.interruptionOrCorrectionCase === true && !finiteMetric(sample.bargeInRecoveryMs)) return true;
  if (sample.toolCallCase === true && !finiteMetric(sample.toolLatencyMs)) return true;
  return false;
}

function deriveAuditability(samples: KnowledgeBenchmarkSample[]): BenchmarkAuditability {
  const values = samples
    .map((sample) => sample.auditability)
    .filter((value): value is BenchmarkAuditability => value === 'sufficient' || value === 'insufficient' || value === 'unknown');
  if (values.length === 0) return 'unknown';
  if (values.includes('insufficient')) return 'insufficient';
  if (values.includes('unknown')) return 'unknown';
  return 'sufficient';
}

function allKnownPassed(samples: KnowledgeBenchmarkSample[], selector: (sample: KnowledgeBenchmarkSample) => boolean | null | undefined): boolean {
  const values = samples.map(selector).filter((value): value is boolean => typeof value === 'boolean');
  return values.length === 0 ? false : values.every(Boolean);
}

function highRiskAuditabilityFailures(samples: KnowledgeBenchmarkSample[]): number {
  return samples.filter((sample) => isHighRisk(sample) && sample.auditability !== 'sufficient').length;
}

function slowRagNormalPathFailures(samples: KnowledgeBenchmarkSample[], slo: KnowledgeBenchmarkSlo): number {
  return samples.filter((sample) => (
    isNormalSupportedTurn(sample)
    && isSlowRagMode(sample.retrievalMode)
    && (!finiteMetric(sampleVoiceE2eMs(sample)) || sampleVoiceE2eMs(sample)! > slo.normalSupportedVoiceP95Ms)
  )).length;
}

function buildMetrics(
  provider: KnowledgeBenchmarkProvider,
  samples: KnowledgeBenchmarkSample[],
  slo: KnowledgeBenchmarkSlo,
): KnowledgeProviderMetrics {
  const providerSamples = samples.filter((sample) => sample.provider === provider);
  const normalSupportedSamples = providerSamples.filter(isNormalSupportedTurn);
  const supportedNonToolSamples = providerSamples.filter(isSupportedNonToolTurn);
  const cacheOrPinnedSamples = providerSamples.filter((sample) => sample.retrievalMode === 'cache' || sample.retrievalMode === 'pinned');
  const structuredFactSamples = providerSamples.filter((sample) => sample.retrievalMode === 'structured_fact');
  const ftsFirstSamples = providerSamples.filter((sample) => sample.retrievalMode === 'fts');
  const slowRagSamples = providerSamples.filter((sample) => isSlowRagMode(sample.retrievalMode));
  const retrievalRequiredSamples = providerSamples.filter(needsKbContextMetric);
  const exceptionPathSamples = providerSamples.filter(isExceptionPathSample);
  const fastPathSamples = normalSupportedSamples.filter((sample) => isFastPathMode(sample.retrievalMode));
  const missingRecallAt5Count = retrievalRequiredSamples.filter((sample) => sample.recallAt5 == null).length;
  const invalidRecallAt5Count = retrievalRequiredSamples.filter((sample) => (
    sample.recallAt5 != null && !validRecallAt5(sample.recallAt5)
  )).length;
  const normalSupportedUnanswerableCount = normalSupportedSamples.filter((sample) => sample.answerable !== true).length;
  const missingExceptionPathMetricCount = exceptionPathSamples.filter(missingExceptionPathMetric).length;
  const missingVoiceLatencyContractCount = providerSamples.filter((sample) => sample.voiceLatency == null).length;
  const voiceLatencyContractFailureCount = providerSamples.filter((sample) => {
    const evaluation = voiceLatencyEvaluation(sample);
    return evaluation != null && !evaluation.ready;
  }).length;
  const fillerOnlySafeAudioCount = providerSamples.filter((sample) => {
    const evaluation = voiceLatencyEvaluation(sample);
    return evaluation?.blockers.includes('FILLER_ONLY_NOT_SLO_ELIGIBLE') === true;
  }).length;
  const missingVoiceE2eMetricCount = providerSamples.filter((sample) => (
    (isNormalSupportedTurn(sample) || isSupportedNonToolTurn(sample))
    && !finiteMetric(sampleVoiceE2eMs(sample))
  )).length;
  const missingKbContextMetricCount = providerSamples.filter((sample) => needsKbContextMetric(sample) && !finiteMetric(sample.kbContextMs)).length;
  const missingQualityLabelCount = providerSamples.filter((sample) => typeof sample.answerCorrect !== 'boolean').length;
  const missingP0P1LabelCount = providerSamples.filter((sample) => (
    typeof sample.p0Failure !== 'boolean' || typeof sample.p1Failure !== 'boolean'
  )).length;
  const missingAbstainLabelCount = providerSamples.filter((sample) => (
    typeof sample.shouldAbstain !== 'boolean' || typeof sample.abstained !== 'boolean'
  )).length;
  const missingHallucinationLabelCount = providerSamples.filter((sample) => typeof sample.hallucinated !== 'boolean').length;
  const missingAuditabilityLabelCount = providerSamples.filter((sample) => sample.auditability == null || sample.auditability === 'unknown').length;
  const missingSafetyLabelCount = providerSamples.filter((sample) => (
    typeof sample.tenantIsolationPassed !== 'boolean'
    || typeof sample.staleUnapprovedBlocked !== 'boolean'
    || typeof sample.piiSafe !== 'boolean'
    || typeof sample.promptInjectionSafe !== 'boolean'
  )).length;
  const highRiskSampleCount = providerSamples.filter(isHighRisk).length;
  const highRiskAuditabilityFailureCount = highRiskAuditabilityFailures(providerSamples);
  const hallucinationCount = providerSamples.filter((sample) => sample.hallucinated === true).length;
  const hallucinationLabelConflictCount = providerSamples.filter((sample) =>
    sample.hallucinated === true
    && sample.answerCorrect === true
    && sample.p0Failure !== true
    && sample.p1Failure !== true,
  ).length;

  return {
    provider,
    sampleCount: providerSamples.length,
    normalSupportedTurnCount: normalSupportedSamples.length,
    supportedNonToolTurnCount: supportedNonToolSamples.length,
    p50VoiceE2eMs: percentile(getLatency(normalSupportedSamples, sampleVoiceE2eMs), 50),
    p90VoiceE2eMs: percentile(getLatency(normalSupportedSamples, sampleVoiceE2eMs), 90),
    p95VoiceE2eMs: percentile(getLatency(normalSupportedSamples, sampleVoiceE2eMs), 95),
    p99VoiceE2eMs: percentile(getLatency(normalSupportedSamples, sampleVoiceE2eMs), 99),
    p95SupportedNonToolVoiceE2eMs: percentile(getLatency(supportedNonToolSamples, sampleVoiceE2eMs), 95),
    p95TimeToFirstAudioMs: percentile(getLatency(providerSamples, sampleTimeToFirstAudioMs), 95),
    p95ProviderEndToSafeAudioMs: percentile(getLatency(providerSamples, (sample) => voiceLatencyMetric(sample, (metrics) => metrics.providerEndToSafeAudioMs)), 95),
    p95AsrPartialToFinalMs: percentile(getLatency(providerSamples, (sample) => voiceLatencyMetric(sample, (metrics) => metrics.asrPartialToFinalMs)), 95),
    p95AsrFinalToSafeAudioMs: percentile(getLatency(providerSamples, (sample) => voiceLatencyMetric(sample, (metrics) => metrics.asrFinalToSafeAudioMs)), 95),
    p95AgentCoreToSafeAudioMs: percentile(getLatency(providerSamples, (sample) => voiceLatencyMetric(sample, (metrics) => metrics.agentCoreToSafeAudioMs)), 95),
    p95AgentCoreToFirstTokenMs: percentile(getLatency(providerSamples, (sample) => voiceLatencyMetric(sample, (metrics) => metrics.agentCoreToFirstTokenMs)), 95),
    p95FirstTokenToSpeakableChunkMs: percentile(getLatency(providerSamples, (sample) => voiceLatencyMetric(sample, (metrics) => metrics.firstTokenToSpeakableChunkMs)), 95),
    p95FirstSpeakableChunkToSafeAudioMs: percentile(getLatency(providerSamples, (sample) => voiceLatencyMetric(sample, (metrics) => metrics.firstSpeakableChunkToSafeAudioMs)), 95),
    p95FirstFullAnswerAudioMs: percentile(getLatency(providerSamples, (sample) => voiceLatencyMetric(sample, (metrics) => metrics.firstFullAnswerAudioMs)), 95),
    p95KbContextMs: percentile(getLatency(providerSamples, (sample) => sample.kbContextMs), 95),
    p95RetellKbLatencyImpactMs: percentile(getLatency(providerSamples, (sample) => sample.retellKbLatencyImpactMs), 95),
    p95CacheOrPinnedMs: percentile(getLatency(cacheOrPinnedSamples, (sample) => sample.kbContextMs), 95),
    p95StructuredFactMs: percentile(getLatency(structuredFactSamples, (sample) => sample.kbContextMs), 95),
    p95FtsFirstMs: percentile(getLatency(ftsFirstSamples, (sample) => sample.kbContextMs), 95),
    p95SlowRagMs: percentile(getLatency(slowRagSamples, (sample) => sample.kbContextMs), 95),
    answerCorrectnessRate: booleanRate(providerSamples.map((sample) => sample.answerCorrect)),
    answerabilityRate: booleanRate(providerSamples
      .filter((sample) => sample.staleOnlyCase !== true && sample.outOfScopeCase !== true)
      .map((sample) => sample.answerable)),
    normalSupportedUnanswerableCount,
    abstainCorrectnessRate: booleanRate(providerSamples.map((sample) => {
      if (typeof sample.shouldAbstain !== 'boolean' || typeof sample.abstained !== 'boolean') return null;
      return sample.shouldAbstain === sample.abstained;
    })),
    hallucinationRate: booleanRate(providerSamples.map((sample) => sample.hallucinated)),
    hallucinationCount,
    hallucinationLabelConflictCount,
    p1PassRate: p1PassRate(providerSamples),
    meanRecallAt5: mean(retrievalRequiredSamples.map((sample) => validRecallAt5(sample.recallAt5) ? sample.recallAt5 : null)),
    retrievalRequiredCount: retrievalRequiredSamples.length,
    missingRecallAt5Count,
    invalidRecallAt5Count,
    fastPathCoverageRate: providerSamples.length === 0 ? null : Number((fastPathSamples.length / providerSamples.length).toFixed(6)),
    auditability: deriveAuditability(providerSamples),
    highRiskSampleCount,
    highRiskAuditabilityFailureCount,
    highRiskAuditabilityPassed: highRiskSampleCount > 0 && highRiskAuditabilityFailureCount === 0,
    p0FailureCount: providerSamples.filter((sample) => sample.p0Failure === true).length,
    p1FailureCount: providerSamples.filter((sample) => sample.p1Failure === true).length,
    missingVoiceE2eMetricCount,
    missingVoiceLatencyContractCount,
    voiceLatencyContractFailureCount,
    fillerOnlySafeAudioCount,
    exceptionPathSampleCount: exceptionPathSamples.length,
    missingExceptionPathMetricCount,
    p95FinalAuditedAnswerMs: percentile(getLatency(providerSamples.filter(isHighRisk), (sample) => sample.finalAuditedAnswerMs), 95),
    p95BargeInRecoveryMs: percentile(getLatency(providerSamples.filter((sample) => sample.interruptionOrCorrectionCase === true), (sample) => sample.bargeInRecoveryMs), 95),
    p95ToolLatencyMs: percentile(getLatency(providerSamples.filter((sample) => sample.toolCallCase === true), (sample) => sample.toolLatencyMs), 95),
    missingKbContextMetricCount,
    missingQualityLabelCount,
    missingP0P1LabelCount,
    missingAbstainLabelCount,
    missingHallucinationLabelCount,
    missingAuditabilityLabelCount,
    missingSafetyLabelCount,
    missingMetricCount:
      missingVoiceE2eMetricCount
      + missingVoiceLatencyContractCount
      + missingKbContextMetricCount
      + missingQualityLabelCount
      + missingP0P1LabelCount
      + missingAbstainLabelCount
      + missingHallucinationLabelCount
      + missingAuditabilityLabelCount
      + missingSafetyLabelCount,
    slowRagNormalPathCount: slowRagNormalPathFailures(providerSamples, slo),
    tenantIsolationPassed: allKnownPassed(providerSamples, (sample) => sample.tenantIsolationPassed),
    staleUnapprovedBlockingPassed: allKnownPassed(providerSamples, (sample) => sample.staleUnapprovedBlocked),
    piiHandlingPassed: allKnownPassed(providerSamples, (sample) => sample.piiSafe),
    promptInjectionHandlingPassed: allKnownPassed(providerSamples, (sample) => sample.promptInjectionSafe),
  };
}

function hasValueAtMost(value: number | null, max: number): boolean {
  return typeof value === 'number' && value <= max;
}

function hasRateAtLeast(value: number | null, min: number): boolean {
  return typeof value === 'number' && value >= min;
}

function pushIf<T extends string>(blockers: T[], condition: boolean, code: T): void {
  if (condition) blockers.push(code);
}

function isMateriallyFaster(left: number | null, right: number | null): boolean {
  if (typeof left !== 'number' || typeof right !== 'number') return false;
  return right - left >= MATERIAL_LATENCY_DELTA_MS && right >= left * MATERIAL_LATENCY_RATIO;
}

type QuestionCase = {
  questionId: string;
  providerCounts: Map<KnowledgeBenchmarkProvider, number>;
  fingerprints: Set<string>;
  intents: Set<string>;
  risks: Set<BenchmarkRisk>;
  staleOnlyCase: boolean;
  outOfScopeCase: boolean;
  germanAsrVariant: boolean;
  interruptionOrCorrectionCase: boolean;
  normalSupportedTurn: boolean;
  supportedNonToolTurn: boolean;
};

function questionCoverage(samples: KnowledgeBenchmarkSample[]): KnowledgeBenchmarkCoverage {
  const cases = new Map<string, QuestionCase>();
  for (const sample of samples) {
    const existing = cases.get(sample.questionId) ?? {
      questionId: sample.questionId,
      providerCounts: new Map<KnowledgeBenchmarkProvider, number>(),
      fingerprints: new Set<string>(),
      intents: new Set<string>(),
      risks: new Set<BenchmarkRisk>(),
      staleOnlyCase: false,
      outOfScopeCase: false,
      germanAsrVariant: false,
      interruptionOrCorrectionCase: false,
      normalSupportedTurn: false,
      supportedNonToolTurn: false,
    };
    existing.providerCounts.set(sample.provider, (existing.providerCounts.get(sample.provider) ?? 0) + 1);
    if (typeof sample.questionFingerprint === 'string' && sample.questionFingerprint.trim()) {
      existing.fingerprints.add(sample.questionFingerprint.trim());
    }
    if (typeof sample.intent === 'string' && sample.intent.trim()) existing.intents.add(sample.intent.trim());
    if (sample.risk) existing.risks.add(sample.risk);
    existing.staleOnlyCase ||= sample.staleOnlyCase === true;
    existing.outOfScopeCase ||= sample.outOfScopeCase === true;
    existing.germanAsrVariant ||= sample.germanAsrVariant === true;
    existing.interruptionOrCorrectionCase ||= sample.interruptionOrCorrectionCase === true;
    existing.normalSupportedTurn ||= sample.normalSupportedTurn === true;
    existing.supportedNonToolTurn ||= sample.supportedNonToolTurn === true;
    cases.set(sample.questionId, existing);
  }

  const allCases = [...cases.values()];
  const pairedCases = allCases.filter((item) => item.providerCounts.has('retell_kb') && item.providerCounts.has('own_kb'));
  const uniqueIntents = new Set<string>();
  for (const item of pairedCases) {
    for (const intent of item.intents) uniqueIntents.add(intent);
  }

  return {
    retellQuestionCount: allCases.filter((item) => item.providerCounts.has('retell_kb')).length,
    ownKbQuestionCount: allCases.filter((item) => item.providerCounts.has('own_kb')).length,
    pairedQuestionCount: pairedCases.length,
    uniqueIntentCount: uniqueIntents.size,
    highRiskCaseCount: pairedCases.filter((item) => [...item.risks].some((risk) => isHighRisk({ risk }))).length,
    pricingCaseCount: pairedCases.filter((item) => item.risks.has('pricing')).length,
    legalCaseCount: pairedCases.filter((item) => item.risks.has('legal')).length,
    policyCaseCount: pairedCases.filter((item) => item.risks.has('policy')).length,
    staleOnlyCaseCount: pairedCases.filter((item) => item.staleOnlyCase).length,
    outOfScopeCaseCount: pairedCases.filter((item) => item.outOfScopeCase).length,
    germanAsrVariantCount: pairedCases.filter((item) => item.germanAsrVariant).length,
    interruptionOrCorrectionCaseCount: pairedCases.filter((item) => item.interruptionOrCorrectionCase).length,
    normalSupportedCaseCount: pairedCases.filter((item) => item.normalSupportedTurn).length,
    supportedNonToolCaseCount: pairedCases.filter((item) => item.supportedNonToolTurn).length,
  };
}

function questionPairIntegrityBlockers(samples: KnowledgeBenchmarkSample[]): KnowledgeBenchmarkBlocker[] {
  const blockers = new Set<KnowledgeBenchmarkBlocker>();
  const cases = new Map<string, KnowledgeBenchmarkSample[]>();
  const fingerprintQuestionIds = new Map<string, Set<string>>();
  for (const sample of samples) {
    const items = cases.get(sample.questionId) ?? [];
    items.push(sample);
    cases.set(sample.questionId, items);
    const fingerprint = sample.questionFingerprint?.trim();
    if (fingerprint) {
      const ids = fingerprintQuestionIds.get(fingerprint) ?? new Set<string>();
      ids.add(sample.questionId);
      fingerprintQuestionIds.set(fingerprint, ids);
    }
  }

  for (const questionIds of fingerprintQuestionIds.values()) {
    if (questionIds.size > 1) blockers.add('DUPLICATE_QUESTION_FINGERPRINT');
  }

  for (const items of cases.values()) {
    const providerCounts = items.reduce<Record<KnowledgeBenchmarkProvider, number>>((acc, item) => {
      acc[item.provider] = (acc[item.provider] ?? 0) + 1;
      return acc;
    }, { retell_kb: 0, own_kb: 0 });
    if (providerCounts.retell_kb > 1 || providerCounts.own_kb > 1) {
      blockers.add('DUPLICATE_PROVIDER_SAMPLE_FOR_QUESTION');
    }
    if (providerCounts.retell_kb > 0 && providerCounts.own_kb > 0) {
      const fingerprints = items
        .map((item) => item.questionFingerprint?.trim() ?? '')
        .filter(Boolean);
      if (fingerprints.length !== items.length) {
        blockers.add('MISSING_QUESTION_FINGERPRINT');
      } else if (new Set(fingerprints).size !== 1) {
        blockers.add('QUESTION_FINGERPRINT_MISMATCH');
      }
      const first = items[0];
      if (!first) continue;
      const mismatch = items.some((item) =>
        (item.intent?.trim() ?? '') !== (first.intent?.trim() ?? '')
        || item.risk !== first.risk
        || item.staleOnlyCase === true !== (first.staleOnlyCase === true)
        || item.outOfScopeCase === true !== (first.outOfScopeCase === true)
        || item.germanAsrVariant === true !== (first.germanAsrVariant === true)
        || item.interruptionOrCorrectionCase === true !== (first.interruptionOrCorrectionCase === true)
        || item.normalSupportedTurn === true !== (first.normalSupportedTurn === true)
        || item.supportedNonToolTurn === true !== (first.supportedNonToolTurn === true),
      );
      if (mismatch) blockers.add('QUESTION_METADATA_MISMATCH');
    }
  }

  return [...blockers];
}

function coverageBlockers(
  coverage: KnowledgeBenchmarkCoverage,
  requirements: KnowledgeBenchmarkCoverageRequirements,
): KnowledgeBenchmarkBlocker[] {
  const blockers: KnowledgeBenchmarkBlocker[] = [];
  pushIf(blockers, coverage.pairedQuestionCount === 0, 'RETELL_AND_OWN_KB_NOT_MEASURED_ON_SAME_QUESTIONS');
  pushIf(blockers, coverage.pairedQuestionCount < requirements.minPairedQuestions, 'INSUFFICIENT_PAIRED_QUESTION_COVERAGE');
  pushIf(blockers, coverage.uniqueIntentCount < requirements.minUniqueIntents, 'INSUFFICIENT_INTENT_COVERAGE');
  pushIf(blockers, coverage.highRiskCaseCount < requirements.minHighRiskCases, 'INSUFFICIENT_HIGH_RISK_COVERAGE');
  pushIf(blockers, coverage.pricingCaseCount < requirements.minPricingCases, 'INSUFFICIENT_PRICING_COVERAGE');
  pushIf(blockers, coverage.legalCaseCount < requirements.minLegalCases, 'INSUFFICIENT_LEGAL_COVERAGE');
  pushIf(blockers, coverage.policyCaseCount < requirements.minPolicyCases, 'INSUFFICIENT_POLICY_COVERAGE');
  pushIf(blockers, coverage.staleOnlyCaseCount < requirements.minStaleOnlyCases, 'INSUFFICIENT_STALE_ONLY_COVERAGE');
  pushIf(blockers, coverage.outOfScopeCaseCount < requirements.minOutOfScopeCases, 'INSUFFICIENT_OUT_OF_SCOPE_COVERAGE');
  pushIf(blockers, coverage.germanAsrVariantCount < requirements.minGermanAsrVariantCases, 'INSUFFICIENT_GERMAN_ASR_COVERAGE');
  pushIf(blockers, coverage.interruptionOrCorrectionCaseCount < requirements.minInterruptionOrCorrectionCases, 'INSUFFICIENT_INTERRUPTION_OR_CORRECTION_COVERAGE');
  pushIf(blockers, coverage.normalSupportedCaseCount < requirements.minNormalSupportedCases, 'INSUFFICIENT_NORMAL_SUPPORTED_COVERAGE');
  pushIf(blockers, coverage.supportedNonToolCaseCount < requirements.minSupportedNonToolCases, 'INSUFFICIENT_SUPPORTED_NON_TOOL_COVERAGE');
  return blockers;
}

function providerMissingMetricBlockers(metrics: KnowledgeProviderMetrics): KnowledgeBenchmarkBlocker[] {
  const blockers: KnowledgeBenchmarkBlocker[] = [];
  pushIf(blockers, metrics.missingVoiceE2eMetricCount > 0, 'MISSING_VOICE_E2E_METRICS');
  pushIf(blockers, metrics.missingVoiceLatencyContractCount > 0, 'MISSING_VOICE_LATENCY_CONTRACT');
  pushIf(blockers, metrics.voiceLatencyContractFailureCount > 0, 'VOICE_LATENCY_CONTRACT_NOT_READY');
  if (metrics.provider === 'own_kb') {
    pushIf(blockers, metrics.missingKbContextMetricCount > 0, 'MISSING_KB_CONTEXT_METRICS');
  }
  pushIf(blockers, metrics.missingQualityLabelCount > 0 || metrics.answerCorrectnessRate === null, 'MISSING_QUALITY_LABELS');
  pushIf(blockers, metrics.missingP0P1LabelCount > 0 || metrics.p1PassRate === null, 'MISSING_P0_P1_LABELS');
  pushIf(blockers, metrics.missingAbstainLabelCount > 0 || metrics.abstainCorrectnessRate === null, 'MISSING_ABSTAIN_LABELS');
  pushIf(blockers, metrics.missingHallucinationLabelCount > 0 || metrics.hallucinationRate === null, 'MISSING_HALLUCINATION_LABELS');
  pushIf(blockers, metrics.missingAuditabilityLabelCount > 0, 'MISSING_AUDITABILITY_LABELS');
  pushIf(blockers, metrics.missingSafetyLabelCount > 0, 'MISSING_SAFETY_LABELS');
  return blockers;
}

function ownKbLatencyBlockers(metrics: KnowledgeProviderMetrics, slo: KnowledgeBenchmarkSlo): KnowledgeBenchmarkBlocker[] {
  const blockers: KnowledgeBenchmarkBlocker[] = [];
  pushIf(blockers, !hasValueAtMost(metrics.p50VoiceE2eMs, slo.normalSupportedVoiceP50Ms), 'OWN_KB_NORMAL_E2E_P50_ABOVE_500MS');
  pushIf(blockers, !hasValueAtMost(metrics.p90VoiceE2eMs, slo.normalSupportedVoiceP90Ms), 'OWN_KB_NORMAL_E2E_P90_ABOVE_700MS');
  pushIf(blockers, !hasValueAtMost(metrics.p95VoiceE2eMs, slo.normalSupportedVoiceP95Ms), 'OWN_KB_NORMAL_E2E_P95_ABOVE_800MS');
  pushIf(blockers, !hasValueAtMost(metrics.p95SupportedNonToolVoiceE2eMs, slo.supportedNonToolVoiceP95Ms), 'OWN_KB_SUPPORTED_NON_TOOL_P95_ABOVE_1000MS');
  pushIf(blockers, !hasValueAtMost(metrics.p99VoiceE2eMs, slo.voiceP99TargetMs), 'OWN_KB_NORMAL_E2E_P99_ABOVE_1200MS_TARGET');
  pushIf(blockers, !hasValueAtMost(metrics.p95KbContextMs, slo.kbContextP95Ms), 'OWN_KB_CONTEXT_P95_ABOVE_100MS');
  if (metrics.p95CacheOrPinnedMs !== null) {
    pushIf(blockers, metrics.p95CacheOrPinnedMs > slo.cacheOrPinnedP95Ms, 'OWN_KB_CACHE_OR_PINNED_P95_ABOVE_50MS');
  }
  if (metrics.p95FtsFirstMs !== null) {
    pushIf(blockers, metrics.p95FtsFirstMs > slo.ownKbFtsFirstP95Ms, 'OWN_KB_FTS_FIRST_P95_ABOVE_100MS');
  }
  pushIf(blockers, metrics.slowRagNormalPathCount > 0, 'SLOW_RAG_USED_IN_NORMAL_800MS_PATH');
  return blockers;
}

function ownKbSafetyQualityBlockers(metrics: KnowledgeProviderMetrics): KnowledgeBenchmarkBlocker[] {
  const blockers: KnowledgeBenchmarkBlocker[] = [];
  pushIf(blockers, metrics.sampleCount === 0, 'OWN_KB_NO_SAMPLES');
  pushIf(blockers, metrics.normalSupportedTurnCount === 0, 'OWN_KB_NO_NORMAL_SUPPORTED_TURNS');
  pushIf(blockers, metrics.supportedNonToolTurnCount === 0, 'OWN_KB_NO_SUPPORTED_NON_TOOL_TURNS');
  pushIf(blockers, metrics.p0FailureCount > 0, 'OWN_KB_P0_FAILURES_PRESENT');
  pushIf(blockers, !metrics.tenantIsolationPassed, 'OWN_KB_TENANT_ISOLATION_NOT_PROVEN');
  pushIf(blockers, !metrics.staleUnapprovedBlockingPassed, 'OWN_KB_STALE_UNAPPROVED_BLOCKING_NOT_PROVEN');
  pushIf(blockers, !metrics.piiHandlingPassed, 'OWN_KB_PII_HANDLING_NOT_PROVEN');
  pushIf(blockers, !metrics.promptInjectionHandlingPassed, 'OWN_KB_PROMPT_INJECTION_HANDLING_NOT_PROVEN');
  pushIf(blockers, metrics.auditability !== 'sufficient', 'OWN_KB_AUDITABILITY_NOT_SUFFICIENT');
  pushIf(blockers, metrics.highRiskSampleCount > 0 && !metrics.highRiskAuditabilityPassed, 'OWN_KB_HIGH_RISK_AUDITABILITY_NOT_SUFFICIENT');
  pushIf(blockers, metrics.fillerOnlySafeAudioCount > 0, 'FILLER_ONLY_USED_AS_SAFE_AUDIO');
  pushIf(blockers, metrics.exceptionPathSampleCount > 0 && metrics.missingExceptionPathMetricCount > 0, 'OWN_KB_EXCEPTION_PATH_SLO_METRICS_MISSING');
  pushIf(blockers, !hasRateAtLeast(metrics.answerCorrectnessRate, 0.98), 'OWN_KB_ANSWER_CORRECTNESS_BELOW_98_PERCENT');
  pushIf(blockers, !hasRateAtLeast(metrics.answerabilityRate, 0.98), 'OWN_KB_ANSWERABILITY_BELOW_98_PERCENT');
  pushIf(blockers, metrics.normalSupportedUnanswerableCount > 0, 'OWN_KB_NORMAL_SUPPORTED_TURN_NOT_ANSWERABLE');
  pushIf(blockers, !hasRateAtLeast(metrics.abstainCorrectnessRate, 0.98), 'OWN_KB_ABSTAIN_CORRECTNESS_BELOW_98_PERCENT');
  pushIf(blockers, !hasRateAtLeast(metrics.p1PassRate, 0.98), 'OWN_KB_P1_PASS_RATE_BELOW_98_PERCENT');
  pushIf(blockers, metrics.p1FailureCount > 0, 'OWN_KB_P1_FAILURES_PRESENT');
  pushIf(blockers, metrics.hallucinationCount > 0, 'OWN_KB_HALLUCINATIONS_PRESENT');
  pushIf(blockers, metrics.hallucinationLabelConflictCount > 0, 'OWN_KB_HALLUCINATION_LABEL_CONFLICT');
  pushIf(blockers, metrics.retrievalRequiredCount === 0, 'OWN_KB_RETRIEVAL_REQUIRED_SAMPLES_MISSING');
  pushIf(blockers, metrics.retrievalRequiredCount > 0 && metrics.missingRecallAt5Count > 0, 'MISSING_RECALL_AT_5_LABELS');
  pushIf(blockers, metrics.invalidRecallAt5Count > 0, 'INVALID_RECALL_AT_5_LABELS');
  pushIf(blockers, metrics.retrievalRequiredCount > 0 && !hasRateAtLeast(metrics.meanRecallAt5, 0.9), 'OWN_KB_RECALL_AT_5_BELOW_90_PERCENT');
  pushIf(blockers, !hasRateAtLeast(metrics.fastPathCoverageRate, 0.8), 'OWN_KB_FAST_PATH_COVERAGE_BELOW_80_PERCENT');
  return blockers;
}

function retellWarnings(metrics: KnowledgeProviderMetrics, slo: KnowledgeBenchmarkSlo): string[] {
  const warnings: string[] = [];
  if (metrics.sampleCount === 0) warnings.push('RETELL_KB_NO_BASELINE_SAMPLES');
  if (metrics.p95RetellKbLatencyImpactMs === null) warnings.push('RETELL_KB_LATENCY_IMPACT_NOT_OBSERVED');
  if (metrics.p95RetellKbLatencyImpactMs !== null && metrics.p95RetellKbLatencyImpactMs > slo.retellKbImpactP95Ms) {
    warnings.push('RETELL_KB_LATENCY_IMPACT_ABOVE_100MS');
  }
  if (!metrics.highRiskAuditabilityPassed) warnings.push('RETELL_KB_HIGH_RISK_AUDITABILITY_NOT_SUFFICIENT');
  return warnings;
}

function retellMissingBaselineBlockers(metrics: KnowledgeProviderMetrics): KnowledgeBenchmarkBlocker[] {
  const blockers: KnowledgeBenchmarkBlocker[] = [];
  pushIf(blockers, metrics.sampleCount === 0, 'RETELL_KB_BASELINE_MISSING');
  pushIf(blockers, metrics.p95VoiceE2eMs === null, 'MISSING_RETELL_BASELINE_METRICS');
  pushIf(blockers, metrics.missingVoiceLatencyContractCount > 0, 'MISSING_VOICE_LATENCY_CONTRACT');
  pushIf(blockers, metrics.voiceLatencyContractFailureCount > 0, 'VOICE_LATENCY_CONTRACT_NOT_READY');
  blockers.push(...providerMissingMetricBlockers(metrics));
  pushIf(blockers, metrics.missingQualityLabelCount > 0 || metrics.missingP0P1LabelCount > 0, 'RETELL_BASELINE_LABELS_MISSING');
  return blockers;
}

function primaryBlockers(safetyGates: KnowledgeBenchmarkSafetyGates): KnowledgeBenchmarkPrimaryBlocker[] {
  const blockers: KnowledgeBenchmarkPrimaryBlocker[] = [];
  pushIf(blockers, safetyGates.canaryWithoutP0Days < 14, 'PRIMARY_REQUIRES_14_DAY_CANARY_WITHOUT_P0');
  pushIf(blockers, safetyGates.retellStandbyReady !== true, 'PRIMARY_REQUIRES_RETELL_STANDBY_READY');
  pushIf(blockers, safetyGates.rollbackTested !== true, 'PRIMARY_REQUIRES_ROLLBACK_TESTED');
  pushIf(blockers, safetyGates.killSwitchTested !== true, 'PRIMARY_REQUIRES_KILL_SWITCH_TESTED');
  return blockers;
}

function canaryBlockers(safetyGates: KnowledgeBenchmarkSafetyGates): KnowledgeBenchmarkCanaryBlocker[] {
  const blockers: KnowledgeBenchmarkCanaryBlocker[] = [];
  pushIf(blockers, safetyGates.productKpiHardGatesPassed !== true, 'CANARY_REQUIRES_PRODUCT_KPI_HARD_GATES');
  pushIf(blockers, safetyGates.exceptionPathSloReported !== true, 'CANARY_REQUIRES_EXCEPTION_PATH_SLO_REPORTING');
  pushIf(blockers, safetyGates.retellStandbyReady !== true, 'CANARY_REQUIRES_RETELL_STANDBY_READY');
  pushIf(blockers, safetyGates.rollbackTested !== true, 'CANARY_REQUIRES_ROLLBACK_TESTED');
  pushIf(blockers, safetyGates.killSwitchTested !== true, 'CANARY_REQUIRES_KILL_SWITCH_TESTED');
  return blockers;
}

function uniqueBlockers<T extends string>(blockers: T[]): T[] {
  return [...new Set(blockers)];
}

export function buildRetellVsOwnKbDecisionReport(input: {
  samples: KnowledgeBenchmarkSample[];
  safetyGates: KnowledgeBenchmarkSafetyGates;
  generatedAt?: string;
  slo?: Partial<KnowledgeBenchmarkSlo>;
  coverageRequirements?: Partial<KnowledgeBenchmarkCoverageRequirements>;
  approvedPromotionArtifact?: boolean;
}): RetellVsOwnKbDecisionReport {
  const slo = { ...ULTRA_LOW_LATENCY_SLO, ...(input.slo ?? {}) };
  const coverageRequirements = { ...DEFAULT_BENCHMARK_COVERAGE_REQUIREMENTS, ...(input.coverageRequirements ?? {}) };
  const retell = buildMetrics('retell_kb', input.samples, slo);
  const ownKb = buildMetrics('own_kb', input.samples, slo);
  const coverage = questionCoverage(input.samples);
  const approvedPromotionArtifact = input.approvedPromotionArtifact === true;
  const promotionEvidenceTrusted = approvedPromotionArtifact
    && input.safetyGates.trustedScopePassed
    && input.safetyGates.traceScopePassed
    && input.safetyGates.dbRlsReadinessPassed
    && input.safetyGates.voiceLatencyMeasurementPassed;
  const blockers: KnowledgeBenchmarkBlocker[] = [];
  const canaryOnlyBlockers = canaryBlockers(input.safetyGates);
  const primaryOnlyBlockers = primaryBlockers(input.safetyGates);
  const warnings = retellWarnings(retell, slo);

  pushIf(blockers, !approvedPromotionArtifact, 'APPROVED_0_5B_ARTIFACT_REQUIRED');
  pushIf(blockers, !promotionEvidenceTrusted, 'PROMOTION_EVIDENCE_UNTRUSTED_UNTIL_MILESTONE_1A_1B_1D_AND_1E_PASS');
  pushIf(blockers, input.safetyGates.piiRedactionPassed === false, 'PII_REDACTION_GATE_FAILED');
  pushIf(blockers, input.safetyGates.traceScopePassed === false, 'TRACE_SCOPE_GATE_FAILED');
  pushIf(blockers, input.safetyGates.voiceLatencyMeasurementPassed === false, 'VOICE_LATENCY_MEASUREMENT_GATE_FAILED');
  blockers.push(...retellMissingBaselineBlockers(retell));
  blockers.push(...coverageBlockers(coverage, coverageRequirements));
  blockers.push(...questionPairIntegrityBlockers(input.samples));
  blockers.push(...providerMissingMetricBlockers(ownKb));
  blockers.push(...ownKbSafetyQualityBlockers(ownKb));
  blockers.push(...ownKbLatencyBlockers(ownKb, slo));

  const retellQuality = retell.answerCorrectnessRate ?? 0;
  const ownQuality = ownKb.answerCorrectnessRate ?? 0;
  const retellMateriallyFaster = isMateriallyFaster(retell.p95VoiceE2eMs, ownKb.p95VoiceE2eMs);
  const retellFasterWithEqualQuality =
    retellMateriallyFaster
    && retellQuality >= ownQuality
    && retell.highRiskAuditabilityPassed;
  pushIf(blockers, retellMateriallyFaster, 'OWN_KB_DOES_NOT_MEET_RETELL_LATENCY_PARITY');
  pushIf(blockers, retellFasterWithEqualQuality, 'RETELL_KB_MATERIALLY_FASTER_WITH_EQUAL_OR_BETTER_QUALITY');

  const unique = uniqueBlockers(blockers);
  const disqualifyingBlockers = unique.filter((blocker) => !PROVISIONAL_BLOCKERS.has(blocker));

  let decision: RetellVsOwnKbDecision;
  if (disqualifyingBlockers.length > 0) {
    decision = 'keep_retell_primary';
  } else if (unique.length > 0 || canaryOnlyBlockers.length > 0) {
    decision = 'owkb_shadow_only';
  } else if (primaryOnlyBlockers.length === 0) {
    decision = 'owkb_primary_candidate';
  } else {
    decision = 'owkb_canary_candidate';
  }

  return {
    decision,
    promotionEvidenceTrusted,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    slo,
    coverageRequirements,
    questionCoverage: coverage,
    retell,
    ownKb,
    blockers: unique,
    canaryBlockers: uniqueBlockers(canaryOnlyBlockers),
    primaryBlockers: uniqueBlockers(primaryOnlyBlockers),
    warnings: uniqueBlockers(warnings),
  };
}
