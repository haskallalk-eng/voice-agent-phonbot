import { describe, expect, it } from 'vitest';
import {
  ULTRA_LOW_LATENCY_SLO,
  buildRetellVsOwnKbDecisionReport,
  type KnowledgeBenchmarkProvider,
  type KnowledgeBenchmarkSafetyGates,
  type KnowledgeBenchmarkSample,
} from '../own-kb-benchmark.js';
import type { VoiceLatencyTimestampContract } from '../voice-latency-contract.js';

const trustedSafetyGates: KnowledgeBenchmarkSafetyGates = {
  trustedScopePassed: true,
  dbRlsReadinessPassed: true,
  piiRedactionPassed: true,
  traceScopePassed: true,
  voiceLatencyMeasurementPassed: true,
  productKpiHardGatesPassed: false,
  exceptionPathSloReported: false,
  canaryWithoutP0Days: 0,
  retellStandbyReady: false,
  rollbackTested: false,
  killSwitchTested: false,
};

const canaryReadySafetyGates: KnowledgeBenchmarkSafetyGates = {
  ...trustedSafetyGates,
  productKpiHardGatesPassed: true,
  exceptionPathSloReported: true,
  retellStandbyReady: true,
  rollbackTested: true,
  killSwitchTested: true,
};

function voiceLatencyContract(latencyMs: number, overrides: Partial<VoiceLatencyTimestampContract> = {}): VoiceLatencyTimestampContract {
  const t0 = Date.parse('2026-05-29T10:00:00.000Z');
  return {
    callId: 'call_benchmark',
    turnId: 'turn_benchmark',
    provider: 'internal_test',
    user_audio_end_detected_at: t0,
    provider_end_of_turn_at: t0 + 20,
    asr_partial_first_at: t0 - 300,
    asr_final_at: t0 + 35,
    agent_core_turn_start_at: t0 + 50,
    first_model_token_at: t0 + 120,
    first_speakable_chunk_at: t0 + 180,
    first_safe_audio_at: t0 + latencyMs,
    first_filler_audio_at: null,
    first_full_answer_audio_at: t0 + latencyMs + 120,
    safe_audio_type: 'evidence_backed_answer',
    ...overrides,
  };
}

function metadataFor(index: number): Partial<KnowledgeBenchmarkSample> {
  const metadata: Partial<KnowledgeBenchmarkSample> = {
    intent: `intent_${((index - 1) % 30) + 1}`,
    risk: 'low',
    staleOnlyCase: false,
    outOfScopeCase: false,
    germanAsrVariant: false,
    interruptionOrCorrectionCase: false,
    answerable: true,
    shouldAbstain: false,
    abstained: false,
  };
  if (index === 1) metadata.risk = 'pricing';
  if (index === 2) metadata.risk = 'legal';
  if (index === 3) metadata.risk = 'policy';
  if (index === 4) metadata.risk = 'high';
  if (index === 5) {
    metadata.risk = 'pricing';
    metadata.staleOnlyCase = true;
    metadata.normalSupportedTurn = false;
    metadata.answerable = false;
    metadata.shouldAbstain = true;
    metadata.abstained = true;
  }
  if (index === 6) {
    metadata.outOfScopeCase = true;
    metadata.normalSupportedTurn = false;
    metadata.answerable = false;
    metadata.shouldAbstain = true;
    metadata.abstained = true;
  }
  if (index === 7) metadata.germanAsrVariant = true;
  if (index === 8) metadata.interruptionOrCorrectionCase = true;
  return metadata;
}

function sample(input: Partial<KnowledgeBenchmarkSample> & {
  provider: KnowledgeBenchmarkProvider;
  questionId: string;
}): KnowledgeBenchmarkSample {
  const voiceE2eMs = input.voiceE2eMs ?? (input.provider === 'retell_kb' ? 760 : 480);
  const risk = input.risk ?? 'low';
  const highRisk = risk === 'high' || risk === 'pricing' || risk === 'legal' || risk === 'policy';
  return {
    normalSupportedTurn: true,
    supportedNonToolTurn: true,
    questionFingerprint: input.questionFingerprint ?? input.questionId,
    voiceLatency: voiceLatencyContract(voiceE2eMs),
    timeToFirstAudioMs: voiceE2eMs,
    voiceE2eMs,
    kbContextMs: input.provider === 'retell_kb' ? 72 : 80,
    retellKbLatencyImpactMs: input.provider === 'retell_kb' ? 85 : null,
    finalAuditedAnswerMs: highRisk ? voiceE2eMs + 220 : null,
    bargeInRecoveryMs: input.interruptionOrCorrectionCase === true ? 320 : null,
    toolLatencyMs: input.toolCallCase === true ? 180 : null,
    toolCallCase: false,
    answerCorrect: true,
    answerable: true,
    shouldAbstain: false,
    abstained: false,
    hallucinated: false,
    recallAt5: input.provider === 'own_kb' ? 0.95 : null,
    auditability: 'sufficient',
    tenantIsolationPassed: true,
    staleUnapprovedBlocked: true,
    piiSafe: true,
    promptInjectionSafe: true,
    p0Failure: false,
    p1Failure: false,
    retrievalMode: input.provider === 'retell_kb' ? 'retell_kb' : 'fts',
    ...input,
  };
}

function pairedCoverageSamples(input: {
  retellLatencyMs?: number;
  ownKbLatencyMs?: number;
  count?: number;
  override?: (provider: KnowledgeBenchmarkProvider, index: number) => Partial<KnowledgeBenchmarkSample>;
} = {}): KnowledgeBenchmarkSample[] {
  const count = input.count ?? 50;
  return Array.from({ length: count }, (_, rawIndex) => {
    const index = rawIndex + 1;
    const questionId = `q${index}`;
    const metadata = metadataFor(index);
    return [
      sample({
        provider: 'retell_kb',
        questionId,
        voiceE2eMs: input.retellLatencyMs ?? 760,
        ...metadata,
        ...(input.override?.('retell_kb', index) ?? {}),
      }),
      sample({
        provider: 'own_kb',
        questionId,
        voiceE2eMs: input.ownKbLatencyMs ?? 480,
        ...metadata,
        ...(input.override?.('own_kb', index) ?? {}),
      }),
    ];
  }).flat();
}

describe('Retell-KB vs Own-KB benchmark decision report', () => {
  it('exports the hard Ultra-Low-Latency SLO defaults', () => {
    expect(ULTRA_LOW_LATENCY_SLO).toEqual({
      normalSupportedVoiceP50Ms: 500,
      normalSupportedVoiceP90Ms: 700,
      normalSupportedVoiceP95Ms: 800,
      supportedNonToolVoiceP95Ms: 1000,
      voiceP99TargetMs: 1200,
      kbContextP95Ms: 100,
      cacheOrPinnedP95Ms: 50,
      retellKbImpactP95Ms: 100,
      ownKbFtsFirstP95Ms: 100,
    });
  });

  it('keeps Own-KB in shadow when Milestone 1A/1B/1D/1E safety gates have not passed', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples(),
      safetyGates: {
        ...trustedSafetyGates,
        trustedScopePassed: false,
        traceScopePassed: false,
        dbRlsReadinessPassed: false,
        voiceLatencyMeasurementPassed: false,
      },
      approvedPromotionArtifact: true,
    });

    expect(report.decision).toBe('owkb_shadow_only');
    expect(report.promotionEvidenceTrusted).toBe(false);
    expect(report.blockers).toContain('PROMOTION_EVIDENCE_UNTRUSTED_UNTIL_MILESTONE_1A_1B_1D_AND_1E_PASS');
    expect(report.blockers).toContain('TRACE_SCOPE_GATE_FAILED');
    expect(report.blockers).toContain('VOICE_LATENCY_MEASUREMENT_GATE_FAILED');
    expect(report.questionCoverage).toMatchObject({
      retellQuestionCount: 50,
      ownKbQuestionCount: 50,
      pairedQuestionCount: 50,
      uniqueIntentCount: 30,
      pricingCaseCount: 2,
      legalCaseCount: 1,
      policyCaseCount: 1,
      staleOnlyCaseCount: 1,
      outOfScopeCaseCount: 1,
      germanAsrVariantCount: 1,
      interruptionOrCorrectionCaseCount: 1,
      normalSupportedCaseCount: 48,
      supportedNonToolCaseCount: 50,
    });
  });

  it('keeps Retell-KB primary when Retell is materially faster with equal quality', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({ retellLatencyMs: 400, ownKbLatencyMs: 500 }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('RETELL_KB_MATERIALLY_FASTER_WITH_EQUAL_OR_BETTER_QUALITY');
  });

  it('does not mark Retell as materially faster at a 99 ms p95 difference', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({ retellLatencyMs: 400, ownKbLatencyMs: 499 }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.blockers).not.toContain('RETELL_KB_MATERIALLY_FASTER_WITH_EQUAL_OR_BETTER_QUALITY');
    expect(report.decision).toBe('owkb_canary_candidate');
  });

  it('marks Own-KB as canary candidate only after coverage, safety, quality, and latency gates pass', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples(),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.decision).toBe('owkb_canary_candidate');
    expect(report.blockers).toEqual([]);
    expect(report.primaryBlockers).toEqual([
      'PRIMARY_REQUIRES_14_DAY_CANARY_WITHOUT_P0',
    ]);
    expect(report.canaryBlockers).toEqual([]);
    expect(report.ownKb).toMatchObject({
      p50VoiceE2eMs: 480,
      p90VoiceE2eMs: 480,
      p95VoiceE2eMs: 480,
      p99VoiceE2eMs: 480,
      p95ProviderEndToSafeAudioMs: 460,
      p95AsrPartialToFinalMs: 335,
      p95AsrFinalToSafeAudioMs: 445,
      p95AgentCoreToSafeAudioMs: 430,
      p95AgentCoreToFirstTokenMs: 70,
      p95FirstTokenToSpeakableChunkMs: 60,
      p95FirstSpeakableChunkToSafeAudioMs: 300,
      p95FirstFullAnswerAudioMs: 600,
      p95KbContextMs: 80,
      p95FtsFirstMs: 80,
      answerCorrectnessRate: 1,
      abstainCorrectnessRate: 1,
      p1PassRate: 1,
      meanRecallAt5: 0.95,
      retrievalRequiredCount: 50,
      missingRecallAt5Count: 0,
      invalidRecallAt5Count: 0,
      fastPathCoverageRate: 0.96,
      highRiskAuditabilityPassed: true,
      tenantIsolationPassed: true,
      staleUnapprovedBlockingPassed: true,
      piiHandlingPassed: true,
      promptInjectionHandlingPassed: true,
    });
  });

  it('blocks Own-KB when it is materially slower than Retell even if Own-KB quality is slightly higher', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        retellLatencyMs: 300,
        ownKbLatencyMs: 480,
        override: (provider, index) => provider === 'retell_kb' && index === 1
          ? { answerCorrect: false, p1Failure: true }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.retell.answerCorrectnessRate).toBe(0.98);
    expect(report.ownKb.answerCorrectnessRate).toBe(1);
    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_DOES_NOT_MEET_RETELL_LATENCY_PARITY');
  });

  it('does not let normal supported turns escape the SLO by marking them unanswerable', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index === 1
          ? { answerable: false, voiceE2eMs: 1600, timeToFirstAudioMs: 1600 }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.ownKb.normalSupportedUnanswerableCount).toBe(1);
    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_NORMAL_SUPPORTED_TURN_NOT_ANSWERABLE');
    expect(report.blockers).toContain('OWN_KB_NORMAL_E2E_P99_ABOVE_1200MS_TARGET');
  });

  it('requires exception-path latency metrics for high-risk and interruption cases', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && (index === 1 || index === 8)
          ? { finalAuditedAnswerMs: null, bargeInRecoveryMs: null }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.ownKb.missingExceptionPathMetricCount).toBe(2);
    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_EXCEPTION_PATH_SLO_METRICS_MISSING');
  });

  it('requires 14 canary days, Retell standby, and rollback before Own-KB primary candidate', () => {
    const canaryReport = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples(),
      safetyGates: {
        ...canaryReadySafetyGates,
        canaryWithoutP0Days: 13,
        retellStandbyReady: true,
        rollbackTested: true,
      },
      approvedPromotionArtifact: true,
    });
    const primaryReport = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples(),
      safetyGates: {
        ...canaryReadySafetyGates,
        canaryWithoutP0Days: 14,
        retellStandbyReady: true,
        rollbackTested: true,
      },
      approvedPromotionArtifact: true,
    });

    expect(canaryReport.decision).toBe('owkb_canary_candidate');
    expect(canaryReport.primaryBlockers).toContain('PRIMARY_REQUIRES_14_DAY_CANARY_WITHOUT_P0');
    expect(primaryReport.decision).toBe('owkb_primary_candidate');
    expect(primaryReport.primaryBlockers).toEqual([]);
  });

  it('keeps direct diagnostic reports in shadow without an approved 0.5B artifact', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples(),
      safetyGates: canaryReadySafetyGates,
    });

    expect(report.decision).toBe('owkb_shadow_only');
    expect(report.promotionEvidenceTrusted).toBe(false);
    expect(report.blockers).toContain('APPROVED_0_5B_ARTIFACT_REQUIRED');
  });

  it('blocks canary when product KPI, exception SLO, standby, rollback, or kill switch gates are missing', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples(),
      safetyGates: trustedSafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.decision).toBe('owkb_shadow_only');
    expect(report.blockers).toEqual([]);
    expect(report.canaryBlockers).toEqual([
      'CANARY_REQUIRES_PRODUCT_KPI_HARD_GATES',
      'CANARY_REQUIRES_EXCEPTION_PATH_SLO_REPORTING',
      'CANARY_REQUIRES_RETELL_STANDBY_READY',
      'CANARY_REQUIRES_ROLLBACK_TESTED',
      'CANARY_REQUIRES_KILL_SWITCH_TESTED',
    ]);
  });

  it('blocks Own-KB if paired question coverage is below 50', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({ count: 20 }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.decision).toBe('owkb_shadow_only');
    expect(report.blockers).toContain('INSUFFICIENT_PAIRED_QUESTION_COVERAGE');
  });

  it('does not inflate coverage with duplicate question IDs', () => {
    const samples = pairedCoverageSamples({
      override: (_provider, index) => ({
        questionId: `duplicate_${((index - 1) % 5) + 1}`,
      }),
    });
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples,
      safetyGates: trustedSafetyGates,
    });

    expect(report.questionCoverage.pairedQuestionCount).toBe(5);
    expect(report.decision).toBe('owkb_shadow_only');
    expect(report.blockers).toContain('INSUFFICIENT_PAIRED_QUESTION_COVERAGE');
    expect(report.blockers).toContain('DUPLICATE_PROVIDER_SAMPLE_FOR_QUESTION');
  });

  it('blocks promotion when same-question provider pairs lack matching fingerprints', () => {
    const missing = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index === 1
          ? { questionFingerprint: null }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });
    const mismatch = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index === 1
          ? { questionFingerprint: 'different-question' }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(missing.decision).toBe('owkb_shadow_only');
    expect(missing.blockers).toContain('MISSING_QUESTION_FINGERPRINT');
    expect(mismatch.decision).toBe('owkb_shadow_only');
    expect(mismatch.blockers).toContain('QUESTION_FINGERPRINT_MISMATCH');
  });

  it('blocks promotion when fingerprints are reused across different question IDs', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (_provider, index) => index <= 2
          ? { questionFingerprint: 'same-redacted-question' }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.decision).toBe('owkb_shadow_only');
    expect(report.blockers).toContain('DUPLICATE_QUESTION_FINGERPRINT');
  });

  it('blocks promotion when same-question provider metadata does not match', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index === 1
          ? { risk: 'low' }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.decision).toBe('owkb_shadow_only');
    expect(report.blockers).toContain('QUESTION_METADATA_MISMATCH');
  });

  it('blocks promotion when realistic normal supported coverage is too low', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (_provider, index) => index <= 25
          ? { normalSupportedTurn: false }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.questionCoverage.normalSupportedCaseCount).toBe(25);
    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('INSUFFICIENT_NORMAL_SUPPORTED_COVERAGE');
  });

  it('blocks promotion when supported non-tool coverage is too low', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (_provider, index) => index <= 15
          ? { supportedNonToolTurn: false }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.questionCoverage.supportedNonToolCaseCount).toBe(35);
    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('INSUFFICIENT_SUPPORTED_NON_TOOL_COVERAGE');
  });

  it('blocks Own-KB canary when unique intent coverage is below 30', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: () => ({ intent: 'single_intent' }),
      }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.decision).toBe('owkb_shadow_only');
    expect(report.blockers).toContain('INSUFFICIENT_INTENT_COVERAGE');
  });

  it('blocks Own-KB canary when high-risk coverage is missing', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: () => ({ risk: 'low' }),
      }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.decision).toBe('owkb_shadow_only');
    expect(report.blockers).toContain('INSUFFICIENT_HIGH_RISK_COVERAGE');
    expect(report.blockers).toContain('INSUFFICIENT_PRICING_COVERAGE');
    expect(report.blockers).toContain('INSUFFICIENT_LEGAL_COVERAGE');
    expect(report.blockers).toContain('INSUFFICIENT_POLICY_COVERAGE');
  });

  it('blocks Own-KB canary when stale-only, out-of-scope, German ASR, or interruption coverage is missing', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: () => ({
          staleOnlyCase: false,
          outOfScopeCase: false,
          germanAsrVariant: false,
          interruptionOrCorrectionCase: false,
          normalSupportedTurn: true,
          answerable: true,
          shouldAbstain: false,
          abstained: false,
        }),
      }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.decision).toBe('owkb_shadow_only');
    expect(report.blockers).toContain('INSUFFICIENT_STALE_ONLY_COVERAGE');
    expect(report.blockers).toContain('INSUFFICIENT_OUT_OF_SCOPE_COVERAGE');
    expect(report.blockers).toContain('INSUFFICIENT_GERMAN_ASR_COVERAGE');
    expect(report.blockers).toContain('INSUFFICIENT_INTERRUPTION_OR_CORRECTION_COVERAGE');
  });

  it('blocks Own-KB if the normal supported p95 exceeds 800 ms', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({ ownKbLatencyMs: 900 }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_NORMAL_E2E_P95_ABOVE_800MS');
  });

  it('blocks Own-KB if supported non-tool p95 exceeds 1000 ms', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider) => provider === 'own_kb'
          ? { normalSupportedTurn: false, voiceE2eMs: 1100, timeToFirstAudioMs: 1100 }
          : {},
      }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_SUPPORTED_NON_TOOL_P95_ABOVE_1000MS');
  });

  it('blocks Own-KB if KB/context p95 or FTS-first p95 exceeds 100 ms', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider) => provider === 'own_kb' ? { kbContextMs: 120, retrievalMode: 'fts' } : {},
      }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_CONTEXT_P95_ABOVE_100MS');
    expect(report.blockers).toContain('OWN_KB_FTS_FIRST_P95_ABOVE_100MS');
  });

  it('blocks Own-KB if cache or pinned context exceeds 50 ms', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider) => provider === 'own_kb' ? { kbContextMs: 60, retrievalMode: 'cache' } : {},
      }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_CACHE_OR_PINNED_P95_ABOVE_50MS');
  });

  it('reports p99 separately and does not hide p99 breaches', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index === 50
          ? { voiceE2eMs: 1300, timeToFirstAudioMs: 1300 }
          : {},
      }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.ownKb.p95VoiceE2eMs).toBe(480);
    expect(report.ownKb.p99VoiceE2eMs).toBe(1300);
    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_NORMAL_E2E_P99_ABOVE_1200MS_TARGET');
  });

  it('blocks normal live slow RAG when the full e2e path is not proven under budget', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider) => provider === 'own_kb'
          ? { retrievalMode: 'hybrid', voiceE2eMs: 900, timeToFirstAudioMs: 900, kbContextMs: 80 }
          : {},
      }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('SLOW_RAG_USED_IN_NORMAL_800MS_PATH');
  });

  it('blocks promotion when Own-KB has any P0', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index === 1 ? { p0Failure: true } : {},
      }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_P0_FAILURES_PRESENT');
  });

  it('blocks promotion when P1 pass rate is below 98 percent', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && (index === 1 || index === 2)
          ? { p1Failure: true }
          : {},
      }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.ownKb.p1PassRate).toBe(0.96);
    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_P1_PASS_RATE_BELOW_98_PERCENT');
    expect(report.blockers).toContain('OWN_KB_P1_FAILURES_PRESENT');
  });

  it('blocks promotion when any Own-KB hallucination is labeled', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index === 1
          ? { hallucinated: true, answerCorrect: true, p0Failure: false, p1Failure: false }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.ownKb.hallucinationCount).toBe(1);
    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_HALLUCINATIONS_PRESENT');
    expect(report.blockers).toContain('OWN_KB_HALLUCINATION_LABEL_CONFLICT');
  });

  it('blocks promotion when any unresolved Own-KB P1 remains even if pass rate is 98 percent', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index === 1
          ? { p1Failure: true }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.ownKb.p1PassRate).toBe(0.98);
    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_P1_FAILURES_PRESENT');
  });

  it('blocks promotion when retrieval-required Own-KB samples are missing recall@5 labels', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index === 1
          ? { recallAt5: null }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.ownKb.missingRecallAt5Count).toBe(1);
    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('MISSING_RECALL_AT_5_LABELS');
  });

  it('blocks promotion when Recall@5 labels are outside the 0..1 range', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index === 1
          ? { recallAt5: 10 }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.ownKb.invalidRecallAt5Count).toBe(1);
    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('INVALID_RECALL_AT_5_LABELS');
  });

  it('blocks promotion when fast-path coverage is below 80 percent', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index <= 12
          ? { answerable: false, normalSupportedTurn: false }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.ownKb.fastPathCoverageRate).toBe(0.76);
    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_FAST_PATH_COVERAGE_BELOW_80_PERCENT');
  });

  it('does not let no-KB labels satisfy fast-path coverage or recall gates', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider) => provider === 'own_kb'
          ? { retrievalMode: 'none', kbContextMs: null, recallAt5: null }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.ownKb.retrievalRequiredCount).toBe(0);
    expect(report.ownKb.fastPathCoverageRate).toBe(0);
    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_RETRIEVAL_REQUIRED_SAMPLES_MISSING');
    expect(report.blockers).toContain('OWN_KB_FAST_PATH_COVERAGE_BELOW_80_PERCENT');
  });

  it('computes abstain correctness from shouldAbstain matching abstained', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index === 5
          ? { shouldAbstain: true, abstained: false, p1Failure: true }
          : {},
      }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.ownKb.abstainCorrectnessRate).toBe(0.98);
    expect(report.ownKb.p1PassRate).toBe(0.98);
    expect(report.blockers).not.toContain('OWN_KB_ABSTAIN_CORRECTNESS_BELOW_98_PERCENT');
  });

  it('blocks high-risk Own-KB answers when auditability is insufficient', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index === 1
          ? { auditability: 'insufficient' }
          : {},
      }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_HIGH_RISK_AUDITABILITY_NOT_SUFFICIENT');
  });

  it('still blocks global Own-KB canary when Retell is materially faster but high-risk Retell auditability is insufficient', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        retellLatencyMs: 300,
        ownKbLatencyMs: 480,
        override: (provider, index) => provider === 'retell_kb' && index === 1
          ? { auditability: 'insufficient' }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('OWN_KB_DOES_NOT_MEET_RETELL_LATENCY_PARITY');
    expect(report.blockers).not.toContain('RETELL_KB_MATERIALLY_FASTER_WITH_EQUAL_OR_BETTER_QUALITY');
    expect(report.warnings).toContain('RETELL_KB_HIGH_RISK_AUDITABILITY_NOT_SUFFICIENT');
  });

  it('does not count missing metrics as passing', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index === 1
          ? { voiceLatency: null, voiceE2eMs: null, timeToFirstAudioMs: null, kbContextMs: null, answerCorrect: null }
          : {},
      }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.decision).toBe('owkb_shadow_only');
    expect(report.blockers).toContain('MISSING_VOICE_E2E_METRICS');
    expect(report.blockers).toContain('MISSING_VOICE_LATENCY_CONTRACT');
    expect(report.blockers).toContain('MISSING_KB_CONTEXT_METRICS');
    expect(report.blockers).toContain('MISSING_QUALITY_LABELS');
  });

  it('blocks promotion when Retell baseline quality and P0/P1 labels are missing', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider) => provider === 'retell_kb'
          ? { answerCorrect: null, p0Failure: null, p1Failure: null }
          : {},
      }),
      safetyGates: canaryReadySafetyGates,
      approvedPromotionArtifact: true,
    });

    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('MISSING_QUALITY_LABELS');
    expect(report.blockers).toContain('MISSING_P0_P1_LABELS');
    expect(report.blockers).toContain('RETELL_BASELINE_LABELS_MISSING');
  });

  it('requires the canonical voice latency contract even when raw latency numbers are present', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index === 1
          ? { voiceLatency: null, voiceE2eMs: 300, timeToFirstAudioMs: 300 }
          : {},
      }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.decision).toBe('owkb_shadow_only');
    expect(report.blockers).toContain('MISSING_VOICE_LATENCY_CONTRACT');
  });

  it('does not let filler-only audio satisfy Own-KB voice latency gates', () => {
    const fillerContract = voiceLatencyContract(300, {
      first_full_answer_audio_at: Date.parse('2026-05-29T10:00:01.100Z'),
      safe_audio_type: 'filler_only',
    });
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: pairedCoverageSamples({
        override: (provider, index) => provider === 'own_kb' && index === 1
          ? { voiceLatency: fillerContract, voiceE2eMs: 300, timeToFirstAudioMs: 300 }
          : {},
      }),
      safetyGates: trustedSafetyGates,
    });

    expect(report.decision).toBe('keep_retell_primary');
    expect(report.blockers).toContain('VOICE_LATENCY_CONTRACT_NOT_READY');
    expect(report.blockers).toContain('FILLER_ONLY_USED_AS_SAFE_AUDIO');
  });

  it('blocks promotion if Retell-KB and Own-KB were not measured on the same questions', () => {
    const report = buildRetellVsOwnKbDecisionReport({
      generatedAt: '2026-05-29T00:00:00.000Z',
      samples: [
        sample({ provider: 'retell_kb', questionId: 'retell_only', voiceE2eMs: 760, retellKbLatencyImpactMs: 85 }),
        sample({ provider: 'own_kb', questionId: 'own_only', voiceE2eMs: 480, kbContextMs: 80 }),
      ],
      safetyGates: trustedSafetyGates,
    });

    expect(report.decision).toBe('owkb_shadow_only');
    expect(report.questionCoverage.pairedQuestionCount).toBe(0);
    expect(report.blockers).toContain('RETELL_AND_OWN_KB_NOT_MEASURED_ON_SAME_QUESTIONS');
  });
});
