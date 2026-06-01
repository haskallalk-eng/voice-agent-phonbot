import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_LABELING_CSV_COLUMNS,
  applyOwnKbDiagnosticToBenchmarkArtifact,
  applyBenchmarkLabelsCsv,
  buildBenchmarkArtifactGapReport,
  buildBenchmarkLabelingCsv,
  buildDraftBenchmarkArtifactTemplate,
  buildTrustedBenchmarkReportFromArtifact,
  isValidBenchmarkApproverHandle,
  isValidBenchmarkApprovalTimestamp,
  summarizeBenchmarkLabelImportResult,
  trustedBenchmarkArtifactHash,
  type TrustedBenchmarkArtifact,
} from '../own-kb-benchmark-artifact.js';
import type {
  BenchmarkRisk,
  KnowledgeBenchmarkProvider,
  KnowledgeBenchmarkSafetyGates,
  KnowledgeBenchmarkSample,
} from '../own-kb-benchmark.js';
import type { VoiceLatencyTimestampContract } from '../voice-latency-contract.js';

function withEnv(values: Record<string, string>, fn: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

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

function voiceLatencyContract(latencyMs: number): VoiceLatencyTimestampContract {
  const t0 = Date.parse('2026-05-29T10:00:00.000Z');
  return {
    callId: 'call_benchmark_artifact',
    turnId: 'turn_benchmark_artifact',
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
  const riskByIndex: Record<number, BenchmarkRisk> = {
    1: 'pricing',
    2: 'legal',
    3: 'policy',
    4: 'high',
  };
  if (riskByIndex[index]) metadata.risk = riskByIndex[index];
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

function pairedCoverageSamples(count = 50): KnowledgeBenchmarkSample[] {
  return Array.from({ length: count }, (_, rawIndex) => {
    const index = rawIndex + 1;
    const questionId = `q${index}`;
    const metadata = metadataFor(index);
    return [
      sample({
        provider: 'retell_kb',
        questionId,
        voiceE2eMs: 760,
        ...metadata,
      }),
      sample({
        provider: 'own_kb',
        questionId,
        voiceE2eMs: 480,
        ...metadata,
      }),
    ];
  }).flat();
}

function artifact(overrides: Partial<TrustedBenchmarkArtifact> = {}): TrustedBenchmarkArtifact {
  return {
    artifactVersion: 1,
    approvedForMilestone: '0.5B',
    approvedBy: 'qa-review',
    approvedAt: '2026-05-29T12:00:00.000Z',
    containsPotentialPii: false,
    usesRealTranscripts: false,
    usesShadowData: false,
    usesCallLogs: false,
    samples: pairedCoverageSamples(),
    ...overrides,
  };
}

function csvRow(values: Partial<Record<typeof BENCHMARK_LABELING_CSV_COLUMNS[number], string>>): string {
  return BENCHMARK_LABELING_CSV_COLUMNS.map((column) => values[column] ?? '').join(',');
}

function filledCsvRow(questionId: string, provider: KnowledgeBenchmarkProvider): string {
  return csvRow({
    questionId,
    questionFingerprint: `fingerprint_${questionId}`,
    provider,
    intent: 'termin_buchen',
    risk: 'low',
    retrievalMode: provider === 'retell_kb' ? 'retell_kb' : 'fts',
    normalSupportedTurn: 'true',
    supportedNonToolTurn: 'true',
    staleOnlyCase: 'false',
    outOfScopeCase: 'false',
    germanAsrVariant: 'false',
    interruptionOrCorrectionCase: 'false',
    user_audio_end_detected_at: '2026-05-29T10:00:00.000Z',
    provider_end_of_turn_at: '2026-05-29T10:00:00.020Z',
    asr_partial_first_at: '2026-05-29T09:59:59.700Z',
    asr_final_at: '2026-05-29T10:00:00.035Z',
    agent_core_turn_start_at: '2026-05-29T10:00:00.050Z',
    first_model_token_at: '2026-05-29T10:00:00.120Z',
    first_speakable_chunk_at: '2026-05-29T10:00:00.180Z',
    first_safe_audio_at: provider === 'retell_kb' ? '2026-05-29T10:00:00.760Z' : '2026-05-29T10:00:00.480Z',
    first_filler_audio_at: '',
    first_full_answer_audio_at: provider === 'retell_kb' ? '2026-05-29T10:00:00.900Z' : '2026-05-29T10:00:00.600Z',
    safe_audio_type: 'evidence_backed_answer',
    voiceE2eMs: provider === 'retell_kb' ? '760' : '480',
    timeToFirstAudioMs: provider === 'retell_kb' ? '760' : '480',
    kbContextMs: provider === 'retell_kb' ? '70' : '80',
    retellKbLatencyImpactMs: provider === 'retell_kb' ? '80' : '',
    answerCorrect: 'true',
    answerable: 'true',
    shouldAbstain: 'false',
    abstained: 'false',
    hallucinated: 'false',
    recallAt5: provider === 'own_kb' ? '0.95' : '',
    auditability: 'sufficient',
    tenantIsolationPassed: 'true',
    staleUnapprovedBlocked: 'true',
    piiSafe: 'true',
    promptInjectionSafe: 'true',
    p0Failure: 'false',
    p1Failure: 'false',
    qaNotes: 'synthetic test row',
  });
}

function filledCsvForArtifactSamples(artifact: { samples: KnowledgeBenchmarkSample[] }): string {
  return [
    BENCHMARK_LABELING_CSV_COLUMNS.join(','),
    ...artifact.samples.map((sample) => filledCsvRow(sample.questionId, sample.provider)),
    '',
  ].join('\n');
}

describe('trusted Retell-KB vs Own-KB benchmark artifacts', () => {
  it('creates a draft template with required coverage but no approval or promotion-ready metrics', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(template).toMatchObject({
      artifactVersion: 1,
      approvedForMilestone: 'DRAFT_ONLY',
      approvedBy: null,
      approvedAt: null,
      containsPotentialPii: false,
      usesRealTranscripts: false,
      usesShadowData: false,
      usesCallLogs: false,
    });
    expect(template.samples).toHaveLength(100);
    expect(new Set(template.samples.map((item) => item.questionId)).size).toBe(50);
    expect(new Set(template.samples.map((item) => item.intent)).size).toBe(30);

    const result = buildTrustedBenchmarkReportFromArtifact({
      artifact: template,
      safetyGates: trustedSafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    expect(result.artifactAccepted).toBe(false);
    expect(result.promotionEvidenceUsable).toBe(false);
    expect(result.blockers).toContain('BENCHMARK_ARTIFACT_NOT_APPROVED_FOR_0_5B');
    expect(result.blockers).toContain('BENCHMARK_ARTIFACT_APPROVER_MISSING');
    expect(result.blockers).toContain('BENCHMARK_ARTIFACT_APPROVAL_DATE_MISSING');
  });

  it('creates a QA labeling CSV with canonical latency and safety columns', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const csv = buildBenchmarkLabelingCsv(template.samples);
    const [header, firstRow] = csv.trimEnd().split('\n');

    expect(header).toBe(BENCHMARK_LABELING_CSV_COLUMNS.join(','));
    expect(firstRow).toContain('TODO_q1,,retell_kb,TODO_intent_1,pricing,retell_kb');
    expect(header).toContain('user_audio_end_detected_at');
    expect(header).toContain('first_safe_audio_at');
    expect(header).toContain('safe_audio_type');
    expect(header).toContain('answerCorrect');
    expect(header).toContain('tenantIsolationPassed');
    expect(header).toContain('promptInjectionSafe');
    expect(header).toContain('qaNotes');
    expect(csv).not.toContain('transcript');
    expect(csv).not.toContain('phone');
    expect(csv).not.toContain('email');
  });

  it('neutralizes spreadsheet formula starts in QA labeling CSV fields', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const first = template.samples[0]!;
    const csv = buildBenchmarkLabelingCsv([{
      ...first,
      questionId: '=SUM(A1:A2)',
      intent: '@cmd',
    }]);

    expect(csv).toContain('\'=SUM(A1:A2),');
    expect(csv).toContain('\'@cmd');
  });

  it('applies QA CSV labels back into a draft artifact without implicit approval', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const csv = [
      BENCHMARK_LABELING_CSV_COLUMNS.join(','),
      filledCsvRow('TODO_q1', 'retell_kb'),
      filledCsvRow('TODO_q1', 'own_kb'),
      '',
    ].join('\n');

    const result = applyBenchmarkLabelsCsv({ artifact: template, csv });
    const ownSample = result.artifact.samples.find((item) => item.questionId === 'TODO_q1' && item.provider === 'own_kb');

    expect(result.rowsRead).toBe(2);
    expect(result.rowsApplied).toBe(2);
    expect(result.missingSampleKeys).toHaveLength(98);
    expect(result.invalidRecallAt5RowKeys).toEqual([]);
    expect(result.artifact.approvedForMilestone).toBe('DRAFT_ONLY');
    expect(result.artifact.approvedBy).toBeNull();
    expect(ownSample).toMatchObject({
      intent: 'termin_buchen',
      retrievalMode: 'fts',
      answerCorrect: true,
      answerable: true,
      recallAt5: 0.95,
      auditability: 'sufficient',
      tenantIsolationPassed: true,
      staleUnapprovedBlocked: true,
      piiSafe: true,
      promptInjectionSafe: true,
    });
    expect(ownSample?.voiceLatency).toMatchObject({
      provider: 'internal_test',
      first_safe_audio_at: '2026-05-29T10:00:00.480Z',
      safe_audio_type: 'evidence_backed_answer',
    });
  });

  it('requires explicit approval fields before CSV-imported artifacts become 0.5B artifacts', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const csv = filledCsvForArtifactSamples(template);

    const result = applyBenchmarkLabelsCsv({
      artifact: template,
      csv,
      approvedBy: 'qa-review',
      approvedAt: '2026-05-30T00:00:00.000Z',
      containsPotentialPii: false,
      notes: 'approved synthetic fixture',
    });

    expect(result.artifact.approvedForMilestone).toBe('0.5B');
    expect(result.artifact.approvedBy).toBe('qa-review');
    expect(result.artifact.approvedAt).toBe('2026-05-30T00:00:00.000Z');
    expect(result.artifact.approvedBy).toBe('qa-review');
    expect(result.artifact.approvedAt).toBe('2026-05-30T00:00:00.000Z');
    expect(result.artifact.containsPotentialPii).toBe(false);
    expect(result.missingSampleKeys).toEqual([]);
  });

  it('does not approve CSV-imported artifacts with extra header columns', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const csv = [
      `${BENCHMARK_LABELING_CSV_COLUMNS.join(',')},extraColumn`,
      ...template.samples.map((sample) => `${filledCsvRow(sample.questionId, sample.provider)},ignored`),
      '',
    ].join('\n');

    const result = applyBenchmarkLabelsCsv({
      artifact: template,
      csv,
      approvedBy: 'qa-review',
      approvedAt: '2026-05-30T00:00:00.000Z',
      containsPotentialPii: false,
      notes: 'approval attempt with malformed header',
    });
    const summary = summarizeBenchmarkLabelImportResult(result);

    expect(result.artifact.approvedForMilestone).toBe('DRAFT_ONLY');
    expect(result.csvHeaderValid).toBe(false);
    expect(result.csvHeaderErrors).toContain('unexpected_header_column');
    expect(summary).toMatchObject({
      csvHeaderValid: false,
      csvHeaderErrorCount: 1,
      rowIntegrityPassed: false,
    });
  });

  it('does not approve CSV-imported artifacts with duplicate header columns', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const header = [...BENCHMARK_LABELING_CSV_COLUMNS];
    header[1] = 'questionId';
    const csv = [
      header.join(','),
      ...template.samples.map((sample) => filledCsvRow(sample.questionId, sample.provider)),
      '',
    ].join('\n');

    const result = applyBenchmarkLabelsCsv({
      artifact: template,
      csv,
      approvedBy: 'qa-review',
      approvedAt: '2026-05-30T00:00:00.000Z',
      containsPotentialPii: false,
      notes: 'approval attempt with duplicate header',
    });

    expect(result.artifact.approvedForMilestone).toBe('DRAFT_ONLY');
    expect(result.csvHeaderValid).toBe(false);
    expect(result.csvHeaderErrors).toContain('duplicate_header_column');
  });

  it('does not approve CSV-imported artifacts without explicit PII classification', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const csv = [
      BENCHMARK_LABELING_CSV_COLUMNS.join(','),
      filledCsvRow('TODO_q1', 'retell_kb'),
      filledCsvRow('TODO_q1', 'own_kb'),
      '',
    ].join('\n');

    const result = applyBenchmarkLabelsCsv({
      artifact: template,
      csv,
      approvedBy: 'qa-review',
      approvedAt: '2026-05-30T00:00:00.000Z',
      notes: 'approval attempt without PII classification',
    });

    expect(result.artifact.approvedForMilestone).toBe('DRAFT_ONLY');
    expect(result.artifact.approvedBy).toBeNull();
    expect(result.artifact.approvedAt).toBeNull();
    expect(result.artifact.containsPotentialPii).toBe(false);
  });

  it('does not approve CSV-imported artifacts with invalid approval timestamps', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const csv = filledCsvForArtifactSamples(template);

    const result = applyBenchmarkLabelsCsv({
      artifact: template,
      csv,
      approvedBy: 'qa-review',
      approvedAt: 'not-a-date',
      containsPotentialPii: false,
      notes: 'approval attempt with invalid timestamp',
    });

    expect(result.artifact.approvedForMilestone).toBe('DRAFT_ONLY');
    expect(result.artifact.approvedBy).toBeNull();
    expect(result.artifact.approvedAt).toBeNull();
    expect(result.missingSampleKeys).toEqual([]);
  });

  it('requires approval timestamps to be exact UTC ISO strings with milliseconds', () => {
    expect(isValidBenchmarkApprovalTimestamp('2026-05-30T00:00:00.000Z')).toBe(true);
    expect(isValidBenchmarkApprovalTimestamp('2026-05-30T00:00:00Z')).toBe(false);
    expect(isValidBenchmarkApprovalTimestamp('2026-05-30')).toBe(false);
    expect(isValidBenchmarkApprovalTimestamp('2026-05-30T00:00:00.000+02:00')).toBe(false);
    expect(isValidBenchmarkApprovalTimestamp('2026-02-30T00:00:00.000Z')).toBe(false);
  });

  it('requires neutral approver handles for benchmark artifacts', () => {
    expect(isValidBenchmarkApproverHandle('qa-review')).toBe(true);
    expect(isValidBenchmarkApproverHandle('qa.reviewer_1')).toBe(true);
    expect(isValidBenchmarkApproverHandle('QA Reviewer')).toBe(false);
    expect(isValidBenchmarkApproverHandle('qa@example.com')).toBe(false);
    expect(isValidBenchmarkApproverHandle('qa/reviewer')).toBe(false);
  });

  it('does not approve CSV-imported artifacts with invalid approver handles', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const csv = filledCsvForArtifactSamples(template);

    const result = applyBenchmarkLabelsCsv({
      artifact: template,
      csv,
      approvedBy: 'qa@example.com',
      approvedAt: '2026-05-30T00:00:00.000Z',
      containsPotentialPii: false,
      notes: 'approval attempt with PII-like approver',
    });

    expect(result.artifact.approvedForMilestone).toBe('DRAFT_ONLY');
    expect(result.artifact.approvedBy).toBeNull();
    expect(result.artifact.approvedAt).toBeNull();
  });

  it('does not approve CSV-imported artifacts with missing sample labels', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const csv = [
      BENCHMARK_LABELING_CSV_COLUMNS.join(','),
      filledCsvRow('TODO_q1', 'retell_kb'),
      filledCsvRow('TODO_q1', 'own_kb'),
      '',
    ].join('\n');

    const result = applyBenchmarkLabelsCsv({
      artifact: template,
      csv,
      approvedBy: 'qa-review',
      approvedAt: '2026-05-30T00:00:00.000Z',
      containsPotentialPii: true,
      notes: 'approval attempt with partial labels and possible PII',
    });

    expect(result.artifact.approvedForMilestone).toBe('DRAFT_ONLY');
    expect(result.artifact.containsPotentialPii).toBe(true);
    expect(result.missingSampleKeys).toHaveLength(98);
  });

  it('does not approve real-transcript imports classified as non-PII', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const csv = filledCsvForArtifactSamples(template);

    const result = applyBenchmarkLabelsCsv({
      artifact: template,
      csv,
      approvedBy: 'qa-review',
      approvedAt: '2026-05-30T00:00:00.000Z',
      containsPotentialPii: false,
      usesRealTranscripts: true,
      notes: 'approval attempt with inconsistent PII classification',
    });

    expect(result.artifact.approvedForMilestone).toBe('DRAFT_ONLY');
    expect(result.artifact.containsPotentialPii).toBe(false);
    expect(result.artifact.usesRealTranscripts).toBe(true);
    expect(result.missingSampleKeys).toEqual([]);
  });

  it('does not approve CSV-imported artifacts with duplicate question/provider rows', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const csv = [
      BENCHMARK_LABELING_CSV_COLUMNS.join(','),
      ...template.samples.map((sample) => filledCsvRow(sample.questionId, sample.provider)),
      filledCsvRow('TODO_q1', 'retell_kb'),
      '',
    ].join('\n');

    const result = applyBenchmarkLabelsCsv({
      artifact: template,
      csv,
      approvedBy: 'qa-review',
      approvedAt: '2026-05-30T00:00:00.000Z',
      containsPotentialPii: false,
      notes: 'approval attempt with duplicate row',
    });

    expect(result.artifact.approvedForMilestone).toBe('DRAFT_ONLY');
    expect(result.duplicateRowKeys).toEqual(['TODO_q1::retell_kb']);
    expect(result.missingSampleKeys).toEqual([]);
  });

  it('does not approve CSV-imported artifacts with Recall@5 labels outside 0..1', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const csv = [
      BENCHMARK_LABELING_CSV_COLUMNS.join(','),
      ...template.samples.map((sample) => sample.questionId === 'TODO_q1' && sample.provider === 'own_kb'
        ? filledCsvRow(sample.questionId, sample.provider).replace(',0.95,sufficient,', ',10,sufficient,')
        : filledCsvRow(sample.questionId, sample.provider)),
      '',
    ].join('\n');

    const result = applyBenchmarkLabelsCsv({
      artifact: template,
      csv,
      approvedBy: 'qa-review',
      approvedAt: '2026-05-30T00:00:00.000Z',
      containsPotentialPii: false,
      notes: 'approval attempt with invalid recall label',
    });
    const ownSample = result.artifact.samples.find((item) => item.questionId === 'TODO_q1' && item.provider === 'own_kb');

    expect(result.artifact.approvedForMilestone).toBe('DRAFT_ONLY');
    expect(result.invalidRecallAt5RowKeys).toEqual(['TODO_q1::own_kb']);
    expect(ownSample?.recallAt5).toBeNull();
  });

  it('does not approve CSV-imported artifacts with unmatched question/provider rows', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const csv = [
      BENCHMARK_LABELING_CSV_COLUMNS.join(','),
      ...template.samples.map((sample) => filledCsvRow(sample.questionId, sample.provider)),
      filledCsvRow('unexpected_q999', 'own_kb'),
      '',
    ].join('\n');

    const result = applyBenchmarkLabelsCsv({
      artifact: template,
      csv,
      approvedBy: 'qa-review',
      approvedAt: '2026-05-30T00:00:00.000Z',
      containsPotentialPii: false,
      notes: 'approval attempt with unmatched row',
    });

    expect(result.artifact.approvedForMilestone).toBe('DRAFT_ONLY');
    expect(result.unmatchedRowKeys).toEqual(['unexpected_q999::own_kb']);
    expect(result.missingSampleKeys).toEqual([]);
  });

  it('summarizes label imports without exposing sample keys', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const csv = [
      BENCHMARK_LABELING_CSV_COLUMNS.join(','),
      filledCsvRow('TODO_q1', 'retell_kb'),
      filledCsvRow('unexpected_q999', 'own_kb'),
      '',
    ].join('\n');

    const result = applyBenchmarkLabelsCsv({ artifact: template, csv });
    const summary = summarizeBenchmarkLabelImportResult(result);
    const serialized = JSON.stringify(summary);

    expect(summary).toMatchObject({
      duplicateRowKeyCount: 0,
      unmatchedRowKeyCount: 1,
      missingSampleKeyCount: 99,
      rowIntegrityPassed: false,
      promotionEvidenceUsable: false,
    });
    expect(serialized).not.toContain('TODO_q1');
    expect(serialized).not.toContain('unexpected_q999');
    expect(serialized).not.toContain('::own_kb');
  });

  it('merges only Own-KB diagnostic retrieval metrics without fabricating QA labels', () => {
    const approvedArtifact = artifact();
    const result = applyOwnKbDiagnosticToBenchmarkArtifact({
      artifact: approvedArtifact,
      diagnostic: {
        results: [
          {
            questionId: 'q1',
            questionFingerprint: 'q1',
            answerable: false,
            latencyMs: 123,
            snippetCount: 0,
            policyReason: 'NO_APPROVED_CURRENT_SOURCE',
          },
          {
            questionId: 'does_not_match',
            answerable: true,
            latencyMs: 50,
            snippetCount: 3,
          },
        ],
      },
    });

    const ownSample = result.artifact.samples.find((item) => item.provider === 'own_kb' && item.questionId === 'q1');
    const retellSample = result.artifact.samples.find((item) => item.provider === 'retell_kb' && item.questionId === 'q1');

    expect(result).toMatchObject({
      diagnosticsRead: 2,
      diagnosticsApplied: 1,
      duplicateDiagnosticCount: 0,
      fingerprintMismatchCount: 0,
      qaLabelsResetCount: 1,
      unmatchedDiagnosticCount: 1,
      missingOwnKbSampleCount: 49,
      promotionEvidenceUsable: false,
    });
    expect(result.artifact.approvedForMilestone).toBe('DRAFT_ONLY');
    expect(result.artifact.approvedBy).toBeNull();
    expect(result.artifact.approvedAt).toBeNull();
    expect(ownSample).toMatchObject({
      kbContextMs: 123,
      answerable: false,
      recallAt5: 0,
      answerCorrect: null,
      tenantIsolationPassed: null,
      auditability: 'unknown',
    });
    expect(retellSample).toMatchObject({
      kbContextMs: 72,
      answerable: true,
    });
  });

  it('does not infer recall from answerable diagnostics that returned snippets', () => {
    const approvedArtifact = artifact({
      samples: pairedCoverageSamples().map((sample) => sample.provider === 'own_kb'
        ? { ...sample, recallAt5: null }
        : sample),
    });
    const result = applyOwnKbDiagnosticToBenchmarkArtifact({
      artifact: approvedArtifact,
      diagnostic: {
        results: [
          {
            questionId: 'q1',
            questionFingerprint: 'q1',
            answerable: false,
            latencyMs: 123,
            snippetCount: 2,
          },
        ],
      },
    });
    const ownSample = result.artifact.samples.find((item) => item.provider === 'own_kb' && item.questionId === 'q1');

    expect(ownSample?.recallAt5).toBeNull();
    expect(ownSample?.answerable).toBe(false);
    expect(ownSample?.kbContextMs).toBe(123);
  });

  it('does not merge diagnostics with duplicate question IDs or mismatched fingerprints', () => {
    const approvedArtifact = artifact();
    const duplicate = applyOwnKbDiagnosticToBenchmarkArtifact({
      artifact: approvedArtifact,
      diagnostic: {
        results: [
          { questionId: 'q1', questionFingerprint: 'q1', answerable: false, latencyMs: 123, snippetCount: 0 },
          { questionId: 'q1', questionFingerprint: 'q1', answerable: true, latencyMs: 42, snippetCount: 2 },
        ],
      },
    });
    const mismatch = applyOwnKbDiagnosticToBenchmarkArtifact({
      artifact: approvedArtifact,
      diagnostic: {
        results: [
          { questionId: 'q1', questionFingerprint: 'different-question', answerable: false, latencyMs: 123, snippetCount: 0 },
        ],
      },
    });
    const duplicateSample = duplicate.artifact.samples.find((item) => item.provider === 'own_kb' && item.questionId === 'q1');
    const mismatchSample = mismatch.artifact.samples.find((item) => item.provider === 'own_kb' && item.questionId === 'q1');

    expect(duplicate.duplicateDiagnosticCount).toBe(1);
    expect(duplicate.diagnosticsApplied).toBe(0);
    expect(duplicateSample?.kbContextMs).toBe(80);
    expect(mismatch.fingerprintMismatchCount).toBe(1);
    expect(mismatch.diagnosticsApplied).toBe(0);
    expect(mismatchSample?.kbContextMs).toBe(80);
  });

  it('does not let template approval metadata alone create promotion evidence', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const result = buildTrustedBenchmarkReportFromArtifact({
      artifact: {
        ...template,
        approvedForMilestone: '0.5B',
        approvedBy: 'qa-review',
        approvedAt: '2026-05-29T12:00:00.000Z',
      },
      safetyGates: trustedSafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(result.artifactAccepted).toBe(false);
    expect(result.promotionEvidenceUsable).toBe(false);
    expect(result.blockers).toContain('BENCHMARK_ARTIFACT_SAMPLE_METADATA_UNSAFE');
    expect(result.report).toBeNull();
  });

  it('reports actionable gaps for draft templates without exposing samples', () => {
    const template = buildDraftBenchmarkArtifactTemplate({
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const gapReport = buildBenchmarkArtifactGapReport({
      artifact: template,
      safetyGates: trustedSafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(gapReport.promotionEvidenceUsable).toBe(false);
    expect(gapReport.sampleShapeUsable).toBe(true);
    expect(gapReport.artifactSummary.sampleCount).toBe(100);
    expect(gapReport.artifactBlockers).toContain('BENCHMARK_ARTIFACT_NOT_APPROVED_FOR_0_5B');
    expect(gapReport.reportBlockers).toContain('MISSING_VOICE_E2E_METRICS');
    expect(gapReport.reportBlockers).toContain('MISSING_VOICE_LATENCY_CONTRACT');
    expect(gapReport.reportBlockers).toContain('MISSING_QUALITY_LABELS');
    expect(gapReport.nextActions).toContain('obtain_human_0_5b_approval_metadata');
    expect(gapReport.nextActions).toContain('fill_missing_latency_context_and_quality_metrics');
    expect(gapReport.nextActions).toContain('attach_canonical_voice_latency_timestamps');
    expect(gapReport.nextActions).toContain('complete_human_quality_labels_and_p1_review');
    expect(JSON.stringify(gapReport)).not.toContain('TODO_q1');
  });

  it('reports canary gate gaps when an approved artifact passes sample metrics but rollout gates are missing', () => {
    const gapReport = buildBenchmarkArtifactGapReport({
      artifact: artifact(),
      safetyGates: trustedSafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(gapReport.promotionEvidenceUsable).toBe(false);
    expect(gapReport.artifactBlockers).toEqual([]);
    expect(gapReport.reportBlockers).toEqual([]);
    expect(gapReport.canaryBlockers).toEqual([
      'CANARY_REQUIRES_PRODUCT_KPI_HARD_GATES',
      'CANARY_REQUIRES_EXCEPTION_PATH_SLO_REPORTING',
      'CANARY_REQUIRES_RETELL_STANDBY_READY',
      'CANARY_REQUIRES_ROLLBACK_TESTED',
      'CANARY_REQUIRES_KILL_SWITCH_TESTED',
    ]);
    expect(gapReport.nextActions).toContain('complete_product_kpi_exception_slo_standby_rollback_and_kill_switch_gates_before_canary');
  });

  it('requires the approved artifact hash before a gap report can mark promotion evidence usable', () => {
    const approvedArtifact = artifact();
    const gapReport = buildBenchmarkArtifactGapReport({
      artifact: approvedArtifact,
      safetyGates: canaryReadySafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(gapReport.artifactHash).toBe(trustedBenchmarkArtifactHash(approvedArtifact));
    expect(gapReport.promotionEvidenceUsable).toBe(false);
    expect(gapReport.artifactBlockers).toContain('BENCHMARK_ARTIFACT_HASH_NOT_APPROVED');
    expect(gapReport.nextActions).toContain('record_approved_artifact_sha256_before_promotion');
  });

  it('fails closed when no approved artifact is provided', () => {
    const result = buildTrustedBenchmarkReportFromArtifact({
      artifact: null,
      safetyGates: trustedSafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(result.artifactAccepted).toBe(false);
    expect(result.promotionEvidenceUsable).toBe(false);
    expect(result.report).toBeNull();
    expect(result.blockers).toEqual(['APPROVED_BENCHMARK_ARTIFACT_MISSING']);
  });

  it('rejects artifacts that are not explicitly approved for Milestone 0.5B', () => {
    const result = buildTrustedBenchmarkReportFromArtifact({
      artifact: {
        ...artifact(),
        approvedForMilestone: '0.5A',
      },
      safetyGates: trustedSafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(result.artifactAccepted).toBe(false);
    expect(result.promotionEvidenceUsable).toBe(false);
    expect(result.blockers).toContain('BENCHMARK_ARTIFACT_NOT_APPROVED_FOR_0_5B');
  });

  it('requires the PII redaction gate before accepting potential-PII artifacts', () => {
    const result = buildTrustedBenchmarkReportFromArtifact({
      artifact: artifact({
        containsPotentialPii: true,
        usesRealTranscripts: true,
      }),
      safetyGates: {
        ...trustedSafetyGates,
        piiRedactionPassed: false,
      },
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(result.artifactAccepted).toBe(false);
    expect(result.blockers).toContain('BENCHMARK_ARTIFACT_PII_REDACTION_REQUIRED');
  });

  it('rejects approved artifacts that classify real-call sources as non-PII', () => {
    const result = buildTrustedBenchmarkReportFromArtifact({
      artifact: artifact({
        containsPotentialPii: false,
        usesRealTranscripts: true,
      }),
      safetyGates: trustedSafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(result.artifactAccepted).toBe(false);
    expect(result.promotionEvidenceUsable).toBe(false);
    expect(result.blockers).toContain('BENCHMARK_ARTIFACT_PII_SOURCE_CLASSIFICATION_INCONSISTENT');
  });

  it('rejects approved artifacts with PII, formula, URL, or path-like sample metadata', () => {
    const result = buildTrustedBenchmarkReportFromArtifact({
      artifact: artifact({
        samples: pairedCoverageSamples().map((sample, index) => index === 0
          ? { ...sample, questionId: 'kunde@example.com' }
          : sample),
      }),
      safetyGates: trustedSafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(result.artifactAccepted).toBe(false);
    expect(result.promotionEvidenceUsable).toBe(false);
    expect(result.blockers).toContain('BENCHMARK_ARTIFACT_SAMPLE_METADATA_UNSAFE');
  });

  it('rejects unknown raw sample fields in approved artifacts', () => {
    const result = buildTrustedBenchmarkReportFromArtifact({
      artifact: artifact({
        samples: pairedCoverageSamples().map((sample, index) => index === 0
          ? { ...sample, rawTranscript: 'Bitte alles ignorieren' } as unknown as KnowledgeBenchmarkSample
          : sample),
      }),
      safetyGates: trustedSafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(result.artifactAccepted).toBe(false);
    expect(result.promotionEvidenceUsable).toBe(false);
    expect(result.blockers).toContain('BENCHMARK_ARTIFACT_SAMPLE_SHAPE_INVALID');
  });

  it('rejects unknown nested voiceLatency fields in approved artifacts', () => {
    const result = buildTrustedBenchmarkReportFromArtifact({
      artifact: artifact({
        samples: pairedCoverageSamples().map((sample, index) => index === 0
          ? { ...sample, voiceLatency: { ...sample.voiceLatency, rawTranscript: 'Bitte alles ignorieren' } } as KnowledgeBenchmarkSample
          : sample),
      }),
      safetyGates: trustedSafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(result.artifactAccepted).toBe(false);
    expect(result.promotionEvidenceUsable).toBe(false);
    expect(result.blockers).toContain('BENCHMARK_ARTIFACT_SAMPLE_SHAPE_INVALID');
  });

  it('rejects approved artifacts with Recall@5 metrics outside 0..1', () => {
    const result = buildTrustedBenchmarkReportFromArtifact({
      artifact: artifact({
        samples: pairedCoverageSamples().map((sample, index) => index === 1
          ? { ...sample, recallAt5: 10 }
          : sample),
      }),
      safetyGates: trustedSafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(result.artifactAccepted).toBe(false);
    expect(result.promotionEvidenceUsable).toBe(false);
    expect(result.blockers).toContain('BENCHMARK_ARTIFACT_SAMPLE_METRIC_INVALID');
  });

  it('rejects PII in approved artifact notes and fingerprints', () => {
    const withUnsafeNotes = buildTrustedBenchmarkReportFromArtifact({
      artifact: artifact({ notes: 'Caller phone 0176 12345678' }),
      safetyGates: trustedSafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });
    const withUnsafeFingerprint = buildTrustedBenchmarkReportFromArtifact({
      artifact: artifact({
        samples: pairedCoverageSamples().map((sample, index) => index === 0
          ? { ...sample, questionFingerprint: '0176 12345678' }
          : sample),
      }),
      safetyGates: trustedSafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(withUnsafeNotes.artifactAccepted).toBe(false);
    expect(withUnsafeNotes.blockers).toContain('BENCHMARK_ARTIFACT_SAMPLE_METADATA_UNSAFE');
    expect(withUnsafeFingerprint.artifactAccepted).toBe(false);
    expect(withUnsafeFingerprint.blockers).toContain('BENCHMARK_ARTIFACT_SAMPLE_METADATA_UNSAFE');
  });

  it('accepts a valid artifact but refuses promotion evidence when the 1E latency gate has not passed', () => {
    const result = buildTrustedBenchmarkReportFromArtifact({
      artifact: artifact(),
      safetyGates: {
        ...trustedSafetyGates,
        voiceLatencyMeasurementPassed: false,
      },
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(result.artifactAccepted).toBe(true);
    expect(result.promotionEvidenceUsable).toBe(false);
    expect(result.blockers).toEqual(['BENCHMARK_REPORT_NOT_PROMOTION_READY']);
    expect(result.report?.promotionEvidenceTrusted).toBe(false);
    expect(result.report?.blockers).toContain('PROMOTION_EVIDENCE_UNTRUSTED_UNTIL_MILESTONE_1A_1B_1D_AND_1E_PASS');
    expect(result.report?.blockers).toContain('VOICE_LATENCY_MEASUREMENT_GATE_FAILED');
  });

  it('accepts a valid artifact but refuses promotion evidence when the artifact hash is not approved', () => {
    const result = buildTrustedBenchmarkReportFromArtifact({
      artifact: artifact(),
      safetyGates: canaryReadySafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(result.artifactAccepted).toBe(true);
    expect(result.promotionEvidenceUsable).toBe(false);
    expect(result.blockers).toContain('BENCHMARK_ARTIFACT_HASH_NOT_APPROVED');
  });

  it('builds a usable promotion report only from an approved artifact and complete gates', () => {
    const approvedArtifact = artifact();
    withEnv({
      OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_SHA256: trustedBenchmarkArtifactHash(approvedArtifact),
    }, () => {
      const result = buildTrustedBenchmarkReportFromArtifact({
        artifact: approvedArtifact,
        safetyGates: canaryReadySafetyGates,
        generatedAt: '2026-05-29T00:00:00.000Z',
      });

      expect(result.artifactAccepted).toBe(true);
      expect(result.promotionEvidenceUsable).toBe(true);
      expect(result.artifactHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.blockers).toEqual([]);
      expect(result.report?.decision).toBe('owkb_canary_candidate');
      expect(result.report?.blockers).toEqual([]);
      expect(result.artifactSummary).toMatchObject({
        approvedForMilestone: '0.5B',
        approvedByPresent: true,
        sampleCount: 100,
      });
    });
  });

  it('accepts valid artifacts while refusing to treat weak coverage as promotion evidence', () => {
    const result = buildTrustedBenchmarkReportFromArtifact({
      artifact: artifact({
        samples: pairedCoverageSamples(10),
      }),
      safetyGates: trustedSafetyGates,
      generatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(result.artifactAccepted).toBe(true);
    expect(result.promotionEvidenceUsable).toBe(false);
    expect(result.blockers).toEqual(['BENCHMARK_REPORT_NOT_PROMOTION_READY']);
    expect(result.report?.decision).toBe('owkb_shadow_only');
    expect(result.report?.blockers).toContain('INSUFFICIENT_PAIRED_QUESTION_COVERAGE');
    expect(result.report?.blockers).toContain('INSUFFICIENT_INTENT_COVERAGE');
  });
});
