import crypto from 'node:crypto';
import {
  buildRetellVsOwnKbDecisionReport,
  type BenchmarkAuditability,
  type BenchmarkRetrievalMode,
  type BenchmarkRisk,
  type KnowledgeBenchmarkCanaryBlocker,
  type KnowledgeBenchmarkProvider,
  type KnowledgeBenchmarkBlocker,
  type KnowledgeBenchmarkPrimaryBlocker,
  type KnowledgeBenchmarkSafetyGates,
  type KnowledgeBenchmarkSample,
  type RetellVsOwnKbDecisionReport,
} from './own-kb-benchmark.js';
import { redactForEval } from './pii.js';
import { ownKbPromotionEvidenceHashMatches } from './own-kb-rollout.js';
import type {
  VoiceLatencyTimestampContract,
  VoiceLatencyTimestampValue,
  VoiceSafeAudioType,
} from './voice-latency-contract.js';
import { REQUIRED_VOICE_LATENCY_TIMESTAMPS } from './voice-latency-contract.js';

export type TrustedBenchmarkArtifactBlocker =
  | 'APPROVED_BENCHMARK_ARTIFACT_MISSING'
  | 'BENCHMARK_ARTIFACT_NOT_OBJECT'
  | 'BENCHMARK_ARTIFACT_UNSUPPORTED_VERSION'
  | 'BENCHMARK_ARTIFACT_NOT_APPROVED_FOR_0_5B'
  | 'BENCHMARK_ARTIFACT_APPROVER_MISSING'
  | 'BENCHMARK_ARTIFACT_APPROVER_INVALID'
  | 'BENCHMARK_ARTIFACT_APPROVAL_DATE_MISSING'
  | 'BENCHMARK_ARTIFACT_APPROVAL_DATE_INVALID'
  | 'BENCHMARK_ARTIFACT_PII_CLASSIFICATION_MISSING'
  | 'BENCHMARK_ARTIFACT_PII_SOURCE_CLASSIFICATION_INCONSISTENT'
  | 'BENCHMARK_ARTIFACT_PII_REDACTION_REQUIRED'
  | 'BENCHMARK_ARTIFACT_SAMPLES_MISSING'
  | 'BENCHMARK_ARTIFACT_SAMPLE_SHAPE_INVALID'
  | 'BENCHMARK_ARTIFACT_SAMPLE_METRIC_INVALID'
  | 'BENCHMARK_ARTIFACT_SAMPLE_METADATA_UNSAFE'
  | 'BENCHMARK_ARTIFACT_HASH_NOT_APPROVED'
  | 'BENCHMARK_REPORT_NOT_PROMOTION_READY';

export type TrustedBenchmarkArtifact = {
  artifactVersion: 1;
  approvedForMilestone: '0.5B';
  approvedBy: string;
  approvedAt: string;
  containsPotentialPii: boolean;
  usesRealTranscripts?: boolean;
  usesShadowData?: boolean;
  usesCallLogs?: boolean;
  notes?: string;
  samples: KnowledgeBenchmarkSample[];
};

export type DraftBenchmarkArtifact = {
  artifactVersion: 1;
  approvedForMilestone: 'DRAFT_ONLY';
  approvedBy: null;
  approvedAt: null;
  containsPotentialPii: boolean;
  usesRealTranscripts: boolean;
  usesShadowData: boolean;
  usesCallLogs: boolean;
  notes: string;
  samples: KnowledgeBenchmarkSample[];
};

export type TrustedBenchmarkArtifactSummary = {
  artifactVersion: number | null;
  approvedForMilestone: string | null;
  approvedByPresent: boolean;
  approvedAt: string | null;
  containsPotentialPii: boolean | null;
  usesRealTranscripts: boolean;
  usesShadowData: boolean;
  usesCallLogs: boolean;
  sampleCount: number;
};

export type TrustedBenchmarkExecutionResult = {
  artifactAccepted: boolean;
  promotionEvidenceUsable: boolean;
  blockers: TrustedBenchmarkArtifactBlocker[];
  artifactSummary: TrustedBenchmarkArtifactSummary;
  artifactHash: string | null;
  report: RetellVsOwnKbDecisionReport | null;
};

export type BenchmarkArtifactGapReport = {
  artifactSummary: TrustedBenchmarkArtifactSummary;
  sampleShapeUsable: boolean;
  promotionEvidenceUsable: boolean;
  artifactHash: string | null;
  artifactBlockers: TrustedBenchmarkArtifactBlocker[];
  reportBlockers: KnowledgeBenchmarkBlocker[];
  canaryBlockers: KnowledgeBenchmarkCanaryBlocker[];
  primaryBlockers: KnowledgeBenchmarkPrimaryBlocker[];
  warnings: string[];
  nextActions: string[];
};

export type BenchmarkLabelImportResult = {
  artifact: DraftBenchmarkArtifact | TrustedBenchmarkArtifact;
  rowsRead: number;
  rowsApplied: number;
  csvHeaderValid: boolean;
  csvHeaderErrors: BenchmarkCsvHeaderError[];
  duplicateRowKeys: string[];
  unmatchedRowKeys: string[];
  missingSampleKeys: string[];
  invalidRecallAt5RowKeys: string[];
};

export type BenchmarkLabelImportSummary = {
  rowsRead: number;
  rowsApplied: number;
  csvHeaderValid: boolean;
  csvHeaderErrorCount: number;
  duplicateRowKeyCount: number;
  unmatchedRowKeyCount: number;
  missingSampleKeyCount: number;
  invalidRecallAt5RowCount: number;
  rowIntegrityPassed: boolean;
  approvedForMilestone: 'DRAFT_ONLY' | '0.5B';
  promotionEvidenceUsable: false;
};

export type OwnKbDiagnosticImportResult = {
  artifact: DraftBenchmarkArtifact | TrustedBenchmarkArtifact;
  diagnosticsRead: number;
  diagnosticsApplied: number;
  duplicateDiagnosticCount: number;
  fingerprintMismatchCount: number;
  qaLabelsResetCount: number;
  unmatchedDiagnosticCount: number;
  missingOwnKbSampleCount: number;
  promotionEvidenceUsable: false;
};

export type BenchmarkCsvHeaderError =
  | 'missing_header_column'
  | 'unexpected_header_column'
  | 'duplicate_header_column'
  | 'header_column_order_mismatch';

export const BENCHMARK_LABELING_CSV_COLUMNS = [
  'questionId',
  'questionFingerprint',
  'provider',
  'intent',
  'risk',
  'retrievalMode',
  'normalSupportedTurn',
  'supportedNonToolTurn',
  'staleOnlyCase',
  'outOfScopeCase',
  'germanAsrVariant',
  'interruptionOrCorrectionCase',
  'user_audio_end_detected_at',
  'provider_end_of_turn_at',
  'asr_partial_first_at',
  'asr_final_at',
  'agent_core_turn_start_at',
  'first_model_token_at',
  'first_speakable_chunk_at',
  'first_safe_audio_at',
  'first_filler_audio_at',
  'first_full_answer_audio_at',
  'safe_audio_type',
  'voiceE2eMs',
  'timeToFirstAudioMs',
  'kbContextMs',
  'retellKbLatencyImpactMs',
  'finalAuditedAnswerMs',
  'bargeInRecoveryMs',
  'toolLatencyMs',
  'toolCallCase',
  'answerCorrect',
  'answerable',
  'shouldAbstain',
  'abstained',
  'hallucinated',
  'recallAt5',
  'auditability',
  'tenantIsolationPassed',
  'staleUnapprovedBlocked',
  'piiSafe',
  'promptInjectionSafe',
  'p0Failure',
  'p1Failure',
  'qaNotes',
] as const;

const highRiskByIndex = new Map<number, BenchmarkRisk>([
  [1, 'pricing'],
  [2, 'legal'],
  [3, 'policy'],
  [4, 'high'],
]);

function draftSample(questionId: string, provider: 'retell_kb' | 'own_kb', index: number): KnowledgeBenchmarkSample {
  const risk = highRiskByIndex.get(index) ?? (index === 5 ? 'pricing' : 'low');
  return {
    provider,
    questionId,
    questionFingerprint: null,
    intent: `TODO_intent_${((index - 1) % 30) + 1}`,
    risk,
    retrievalMode: provider === 'retell_kb' ? 'retell_kb' : 'fts',
    normalSupportedTurn: true,
    supportedNonToolTurn: true,
    staleOnlyCase: index === 5,
    outOfScopeCase: index === 6,
    germanAsrVariant: index === 7,
    interruptionOrCorrectionCase: index === 8,
    voiceLatency: null,
    voiceE2eMs: null,
    timeToFirstAudioMs: null,
    kbContextMs: null,
    retellKbLatencyImpactMs: provider === 'retell_kb' ? null : undefined,
    finalAuditedAnswerMs: null,
    bargeInRecoveryMs: null,
    toolLatencyMs: null,
    toolCallCase: false,
    answerCorrect: null,
    answerable: null,
    shouldAbstain: null,
    abstained: null,
    hallucinated: null,
    recallAt5: provider === 'own_kb' ? null : undefined,
    auditability: 'unknown',
    tenantIsolationPassed: null,
    staleUnapprovedBlocked: null,
    piiSafe: null,
    promptInjectionSafe: null,
    p0Failure: null,
    p1Failure: null,
  };
}

const riskValues = new Set<BenchmarkRisk>(['low', 'medium', 'high', 'pricing', 'legal', 'policy']);
const providerValues = new Set<KnowledgeBenchmarkProvider>(['retell_kb', 'own_kb']);
const retrievalModeValues = new Set<BenchmarkRetrievalMode>([
  'none',
  'pinned',
  'cache',
  'structured_fact',
  'retell_kb',
  'fts',
  'vector',
  'hybrid',
  'rerank',
]);
const auditabilityValues = new Set<BenchmarkAuditability>(['sufficient', 'insufficient', 'unknown']);
const safeAudioTypeValues = new Set<VoiceSafeAudioType>([
  'evidence_backed_answer',
  'targeted_clarification',
  'valid_abstain',
  'valid_escalation',
  'policy_confirmation',
  'tool_status_update',
  'filler_only',
]);

function sampleKey(questionId: string, provider: KnowledgeBenchmarkProvider): string {
  return `${questionId}::${provider}`;
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((item) => item.some((value) => value.trim().length > 0));
}

function csvHeaderErrors(header: string[]): BenchmarkCsvHeaderError[] {
  const errors = new Set<BenchmarkCsvHeaderError>();
  const expected = [...BENCHMARK_LABELING_CSV_COLUMNS] as string[];
  const expectedSet = new Set(expected);
  const trimmedHeader = header.map((column) => column.trim());
  const seen = new Set<string>();

  for (const column of trimmedHeader) {
    if (seen.has(column)) errors.add('duplicate_header_column');
    seen.add(column);
    if (!expectedSet.has(column)) errors.add('unexpected_header_column');
  }

  const headerSet = new Set(trimmedHeader);
  for (const column of expected) {
    if (!headerSet.has(column)) errors.add('missing_header_column');
  }

  const hasShapeError =
    errors.has('missing_header_column')
    || errors.has('unexpected_header_column')
    || errors.has('duplicate_header_column');
  if (!hasShapeError && trimmedHeader.some((column, index) => column !== expected[index])) {
    errors.add('header_column_order_mismatch');
  }

  return [...errors];
}

function csvRecords(csv: string): {
  records: Array<Record<string, string>>;
  headerErrors: BenchmarkCsvHeaderError[];
} {
  const rows = parseCsv(csv);
  const header = rows[0] ?? [];
  return {
    records: rows.slice(1).map((row) => Object.fromEntries(header.map((column, index) => [column.trim(), row[index] ?? '']))),
    headerErrors: csvHeaderErrors(header),
  };
}

function stringField(row: Record<string, string>, field: string): string | null {
  const value = row[field]?.trim();
  return value ? value : null;
}

function booleanField(row: Record<string, string>, field: string): boolean | null {
  const value = stringField(row, field);
  if (value === null) return null;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return null;
}

function numberField(row: Record<string, string>, field: string): number | null {
  const value = stringField(row, field);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recallAt5Field(row: Record<string, string>): number | null | undefined {
  const value = stringField(row, 'recallAt5');
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
  return parsed;
}

function invalidRecallAt5(row: Record<string, string>): boolean {
  return stringField(row, 'recallAt5') !== null && recallAt5Field(row) === null;
}

function riskField(row: Record<string, string>): BenchmarkRisk | undefined {
  const value = stringField(row, 'risk');
  return value !== null && riskValues.has(value as BenchmarkRisk) ? value as BenchmarkRisk : undefined;
}

function providerField(row: Record<string, string>): KnowledgeBenchmarkProvider | null {
  const value = stringField(row, 'provider');
  return value !== null && providerValues.has(value as KnowledgeBenchmarkProvider) ? value as KnowledgeBenchmarkProvider : null;
}

function retrievalModeField(row: Record<string, string>): BenchmarkRetrievalMode | undefined {
  const value = stringField(row, 'retrievalMode');
  return value !== null && retrievalModeValues.has(value as BenchmarkRetrievalMode) ? value as BenchmarkRetrievalMode : undefined;
}

function auditabilityField(row: Record<string, string>): BenchmarkAuditability | undefined {
  const value = stringField(row, 'auditability');
  return value !== null && auditabilityValues.has(value as BenchmarkAuditability) ? value as BenchmarkAuditability : undefined;
}

function safeAudioTypeField(row: Record<string, string>): VoiceSafeAudioType | null | undefined {
  const value = stringField(row, 'safe_audio_type');
  return value !== null && safeAudioTypeValues.has(value as VoiceSafeAudioType) ? value as VoiceSafeAudioType : undefined;
}

function hasVoiceLatencyFields(row: Record<string, string>): boolean {
  return [
    'user_audio_end_detected_at',
    'provider_end_of_turn_at',
    'asr_partial_first_at',
    'asr_final_at',
    'agent_core_turn_start_at',
    'first_model_token_at',
    'first_speakable_chunk_at',
    'first_safe_audio_at',
    'first_filler_audio_at',
    'first_full_answer_audio_at',
    'safe_audio_type',
  ].some((field) => stringField(row, field) !== null);
}

function voiceLatencyFromRow(row: Record<string, string>, provider: KnowledgeBenchmarkProvider): VoiceLatencyTimestampContract | null {
  if (!hasVoiceLatencyFields(row)) return null;
  return {
    provider: provider === 'retell_kb' ? 'retell' : 'internal_test',
    user_audio_end_detected_at: stringField(row, 'user_audio_end_detected_at'),
    provider_end_of_turn_at: stringField(row, 'provider_end_of_turn_at'),
    asr_partial_first_at: stringField(row, 'asr_partial_first_at'),
    asr_final_at: stringField(row, 'asr_final_at'),
    agent_core_turn_start_at: stringField(row, 'agent_core_turn_start_at'),
    first_model_token_at: stringField(row, 'first_model_token_at'),
    first_speakable_chunk_at: stringField(row, 'first_speakable_chunk_at'),
    first_safe_audio_at: stringField(row, 'first_safe_audio_at'),
    first_filler_audio_at: stringField(row, 'first_filler_audio_at'),
    first_full_answer_audio_at: stringField(row, 'first_full_answer_audio_at'),
    safe_audio_type: safeAudioTypeField(row) ?? null,
  };
}

function applyRow(sample: KnowledgeBenchmarkSample, row: Record<string, string>): KnowledgeBenchmarkSample {
  const voiceLatency = voiceLatencyFromRow(row, sample.provider);
  const recallAt5 = recallAt5Field(row);
  return {
    ...sample,
    questionFingerprint: stringField(row, 'questionFingerprint') ?? sample.questionFingerprint,
    intent: stringField(row, 'intent') ?? sample.intent,
    risk: riskField(row) ?? sample.risk,
    retrievalMode: retrievalModeField(row) ?? sample.retrievalMode,
    normalSupportedTurn: booleanField(row, 'normalSupportedTurn') ?? sample.normalSupportedTurn,
    supportedNonToolTurn: booleanField(row, 'supportedNonToolTurn') ?? sample.supportedNonToolTurn,
    staleOnlyCase: booleanField(row, 'staleOnlyCase') ?? sample.staleOnlyCase,
    outOfScopeCase: booleanField(row, 'outOfScopeCase') ?? sample.outOfScopeCase,
    germanAsrVariant: booleanField(row, 'germanAsrVariant') ?? sample.germanAsrVariant,
    interruptionOrCorrectionCase: booleanField(row, 'interruptionOrCorrectionCase') ?? sample.interruptionOrCorrectionCase,
    voiceLatency: voiceLatency ?? sample.voiceLatency,
    voiceE2eMs: numberField(row, 'voiceE2eMs') ?? sample.voiceE2eMs,
    timeToFirstAudioMs: numberField(row, 'timeToFirstAudioMs') ?? sample.timeToFirstAudioMs,
    kbContextMs: numberField(row, 'kbContextMs') ?? sample.kbContextMs,
    retellKbLatencyImpactMs: numberField(row, 'retellKbLatencyImpactMs') ?? sample.retellKbLatencyImpactMs,
    finalAuditedAnswerMs: numberField(row, 'finalAuditedAnswerMs') ?? sample.finalAuditedAnswerMs,
    bargeInRecoveryMs: numberField(row, 'bargeInRecoveryMs') ?? sample.bargeInRecoveryMs,
    toolLatencyMs: numberField(row, 'toolLatencyMs') ?? sample.toolLatencyMs,
    toolCallCase: booleanField(row, 'toolCallCase') ?? sample.toolCallCase,
    answerCorrect: booleanField(row, 'answerCorrect') ?? sample.answerCorrect,
    answerable: booleanField(row, 'answerable') ?? sample.answerable,
    shouldAbstain: booleanField(row, 'shouldAbstain') ?? sample.shouldAbstain,
    abstained: booleanField(row, 'abstained') ?? sample.abstained,
    hallucinated: booleanField(row, 'hallucinated') ?? sample.hallucinated,
    recallAt5: recallAt5 === undefined ? sample.recallAt5 : recallAt5,
    auditability: auditabilityField(row) ?? sample.auditability,
    tenantIsolationPassed: booleanField(row, 'tenantIsolationPassed') ?? sample.tenantIsolationPassed,
    staleUnapprovedBlocked: booleanField(row, 'staleUnapprovedBlocked') ?? sample.staleUnapprovedBlocked,
    piiSafe: booleanField(row, 'piiSafe') ?? sample.piiSafe,
    promptInjectionSafe: booleanField(row, 'promptInjectionSafe') ?? sample.promptInjectionSafe,
    p0Failure: booleanField(row, 'p0Failure') ?? sample.p0Failure,
    p1Failure: booleanField(row, 'p1Failure') ?? sample.p1Failure,
  };
}

export function applyBenchmarkLabelsCsv(input: {
  artifact: DraftBenchmarkArtifact | TrustedBenchmarkArtifact;
  csv: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  containsPotentialPii?: boolean;
  usesRealTranscripts?: boolean;
  usesShadowData?: boolean;
  usesCallLogs?: boolean;
  notes?: string;
}): BenchmarkLabelImportResult {
  const parsed = csvRecords(input.csv);
  const records = parsed.records;
  const csvHeaderErrors = parsed.headerErrors;
  const csvHeaderValid = csvHeaderErrors.length === 0;
  const rowsByKey = new Map<string, Record<string, string>>();
  const duplicateRowKeys: string[] = [];
  const unmatchedRowKeys: string[] = [];
  const invalidRecallAt5RowKeys: string[] = [];

  for (const row of records) {
    const questionId = stringField(row, 'questionId');
    const provider = providerField(row);
    if (questionId === null || provider === null) continue;
    const key = sampleKey(questionId, provider);
    if (rowsByKey.has(key)) duplicateRowKeys.push(key);
    if (invalidRecallAt5(row)) invalidRecallAt5RowKeys.push(key);
    rowsByKey.set(key, row);
  }

  const samples = input.artifact.samples.map((sample) => {
    const row = rowsByKey.get(sampleKey(sample.questionId, sample.provider));
    return row ? applyRow(sample, row) : sample;
  });
  const sampleKeys = new Set(samples.map((sample) => sampleKey(sample.questionId, sample.provider)));
  for (const key of rowsByKey.keys()) {
    if (!sampleKeys.has(key)) unmatchedRowKeys.push(key);
  }
  const missingSampleKeys = [...sampleKeys].filter((key) => !rowsByKey.has(key));

  const approvedBy = input.approvedBy?.trim() || null;
  const approvedAt = input.approvedAt?.trim() || null;
  const containsPotentialPii = input.containsPotentialPii ?? input.artifact.containsPotentialPii;
  const usesRealTranscripts = input.usesRealTranscripts ?? input.artifact.usesRealTranscripts ?? false;
  const usesShadowData = input.usesShadowData ?? input.artifact.usesShadowData ?? false;
  const usesCallLogs = input.usesCallLogs ?? input.artifact.usesCallLogs ?? false;
  const piiClassificationConsistent =
    containsPotentialPii === true || (!usesRealTranscripts && !usesShadowData && !usesCallLogs);
  const approvalRowIntegrityPassed =
    csvHeaderValid
    && duplicateRowKeys.length === 0
    && unmatchedRowKeys.length === 0
    && missingSampleKeys.length === 0
    && invalidRecallAt5RowKeys.length === 0;
  const approved =
    approvedBy !== null
    && isValidBenchmarkApproverHandle(approvedBy)
    && approvedAt !== null
    && isValidBenchmarkApprovalTimestamp(approvedAt)
    && input.containsPotentialPii !== undefined
    && piiClassificationConsistent
    && approvalRowIntegrityPassed;
  const artifact = {
    ...input.artifact,
    approvedForMilestone: approved ? '0.5B' as const : 'DRAFT_ONLY' as const,
    approvedBy: approved ? approvedBy : null,
    approvedAt: approved ? approvedAt : null,
    containsPotentialPii,
    usesRealTranscripts,
    usesShadowData,
    usesCallLogs,
    notes: input.notes ?? input.artifact.notes,
    samples,
  } as DraftBenchmarkArtifact | TrustedBenchmarkArtifact;

  return {
    artifact,
    rowsRead: records.length,
    rowsApplied: samples.filter((sample) => rowsByKey.has(sampleKey(sample.questionId, sample.provider))).length,
    csvHeaderValid,
    csvHeaderErrors,
    duplicateRowKeys: [...new Set(duplicateRowKeys)],
    unmatchedRowKeys,
    missingSampleKeys,
    invalidRecallAt5RowKeys: [...new Set(invalidRecallAt5RowKeys)],
  };
}

export function summarizeBenchmarkLabelImportResult(
  result: BenchmarkLabelImportResult,
): BenchmarkLabelImportSummary {
  const duplicateRowKeyCount = result.duplicateRowKeys.length;
  const unmatchedRowKeyCount = result.unmatchedRowKeys.length;
  const missingSampleKeyCount = result.missingSampleKeys.length;
  const invalidRecallAt5RowCount = result.invalidRecallAt5RowKeys.length;
  return {
    rowsRead: result.rowsRead,
    rowsApplied: result.rowsApplied,
    csvHeaderValid: result.csvHeaderValid,
    csvHeaderErrorCount: result.csvHeaderErrors.length,
    duplicateRowKeyCount,
    unmatchedRowKeyCount,
    missingSampleKeyCount,
    invalidRecallAt5RowCount,
    rowIntegrityPassed: result.csvHeaderValid
      && duplicateRowKeyCount === 0
      && unmatchedRowKeyCount === 0
      && missingSampleKeyCount === 0
      && invalidRecallAt5RowCount === 0,
    approvedForMilestone: result.artifact.approvedForMilestone,
    promotionEvidenceUsable: false,
  };
}

function diagnosticResults(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || !Array.isArray(value.results)) return [];
  return value.results.filter(isRecord);
}

function diagnosticQuestionId(value: Record<string, unknown>): string | null {
  return stringValue(value.questionId);
}

function diagnosticFingerprint(value: Record<string, unknown>): string | null {
  const explicit = stringValue(value.questionFingerprint);
  if (explicit !== null) return explicit;
  const hash = stringValue(value.questionHash);
  return hash !== null ? `test_transcript_fp_${hash}` : null;
}

function diagnosticMatchesSample(sample: KnowledgeBenchmarkSample, diagnostic: Record<string, unknown>): boolean {
  const diagnosticFp = diagnosticFingerprint(diagnostic);
  const sampleFp = sample.questionFingerprint?.trim() ?? '';
  if (!sampleFp || diagnosticFp === null) return false;
  return sampleFp === diagnosticFp || sampleFp.includes(diagnosticFp.replace(/^test_transcript_fp_/, ''));
}

function diagnosticLatencyMs(value: Record<string, unknown>): number | null {
  return typeof value.latencyMs === 'number' && Number.isFinite(value.latencyMs) && value.latencyMs >= 0
    ? value.latencyMs
    : null;
}

function diagnosticAnswerable(value: Record<string, unknown>): boolean | null {
  return typeof value.answerable === 'boolean' ? value.answerable : null;
}

function diagnosticSnippetCount(value: Record<string, unknown>): number | null {
  return Number.isInteger(value.snippetCount) && (value.snippetCount as number) >= 0
    ? value.snippetCount as number
    : null;
}

export function applyOwnKbDiagnosticToBenchmarkArtifact(input: {
  artifact: DraftBenchmarkArtifact | TrustedBenchmarkArtifact;
  diagnostic: unknown;
}): OwnKbDiagnosticImportResult {
  const diagnostics = diagnosticResults(input.diagnostic);
  const diagnosticsByQuestion = new Map<string, Record<string, unknown>>();
  const duplicateDiagnosticQuestionIds = new Set<string>();
  for (const item of diagnostics) {
    const questionId = diagnosticQuestionId(item);
    if (questionId !== null) {
      if (diagnosticsByQuestion.has(questionId)) {
        duplicateDiagnosticQuestionIds.add(questionId);
      } else {
        diagnosticsByQuestion.set(questionId, item);
      }
    }
  }

  let diagnosticsApplied = 0;
  let fingerprintMismatchCount = 0;
  let qaLabelsResetCount = 0;
  const samples = input.artifact.samples.map((sample) => {
    if (sample.provider !== 'own_kb') return sample;
    const diagnostic = diagnosticsByQuestion.get(sample.questionId);
    if (!diagnostic) return sample;
    if (duplicateDiagnosticQuestionIds.has(sample.questionId) || !diagnosticMatchesSample(sample, diagnostic)) {
      fingerprintMismatchCount += duplicateDiagnosticQuestionIds.has(sample.questionId) ? 0 : 1;
      return sample;
    }

    const latencyMs = diagnosticLatencyMs(diagnostic);
    const answerable = diagnosticAnswerable(diagnostic);
    const snippetCount = diagnosticSnippetCount(diagnostic);
    const recallAt5 = answerable === false && snippetCount === 0 ? 0 : sample.recallAt5;
    const changed = latencyMs !== null || answerable !== null || recallAt5 !== sample.recallAt5;
    if (changed) diagnosticsApplied += 1;
    const hadDependentLabels = sample.answerCorrect != null
      || sample.shouldAbstain != null
      || sample.abstained != null
      || sample.hallucinated != null
      || sample.auditability != null
      || sample.tenantIsolationPassed != null
      || sample.staleUnapprovedBlocked != null
      || sample.piiSafe != null
      || sample.promptInjectionSafe != null
      || sample.p0Failure != null
      || sample.p1Failure != null;
    if (changed && hadDependentLabels) qaLabelsResetCount += 1;
    return {
      ...sample,
      kbContextMs: latencyMs ?? sample.kbContextMs,
      answerable: answerable ?? sample.answerable,
      recallAt5,
      answerCorrect: changed ? null : sample.answerCorrect,
      shouldAbstain: changed ? null : sample.shouldAbstain,
      abstained: changed ? null : sample.abstained,
      hallucinated: changed ? null : sample.hallucinated,
      auditability: changed ? 'unknown' : sample.auditability,
      tenantIsolationPassed: changed ? null : sample.tenantIsolationPassed,
      staleUnapprovedBlocked: changed ? null : sample.staleUnapprovedBlocked,
      piiSafe: changed ? null : sample.piiSafe,
      promptInjectionSafe: changed ? null : sample.promptInjectionSafe,
      p0Failure: changed ? null : sample.p0Failure,
      p1Failure: changed ? null : sample.p1Failure,
    };
  });

  const ownKbQuestionIds = new Set(input.artifact.samples
    .filter((sample) => sample.provider === 'own_kb')
    .map((sample) => sample.questionId));
  const unmatchedDiagnosticCount = [...diagnosticsByQuestion.keys()]
    .filter((questionId) => !ownKbQuestionIds.has(questionId))
    .length;
  const diagnosticQuestionIds = new Set(diagnosticsByQuestion.keys());
  const missingOwnKbSampleCount = [...ownKbQuestionIds]
    .filter((questionId) => !diagnosticQuestionIds.has(questionId))
    .length;

  return {
    artifact: {
      ...input.artifact,
      approvedForMilestone: 'DRAFT_ONLY',
      approvedBy: null,
      approvedAt: null,
      samples,
    } as DraftBenchmarkArtifact | TrustedBenchmarkArtifact,
    diagnosticsRead: diagnosticsByQuestion.size,
    diagnosticsApplied,
    duplicateDiagnosticCount: duplicateDiagnosticQuestionIds.size,
    fingerprintMismatchCount,
    qaLabelsResetCount,
    unmatchedDiagnosticCount,
    missingOwnKbSampleCount,
    promotionEvidenceUsable: false,
  };
}

export function buildDraftBenchmarkArtifactTemplate(input: {
  pairedQuestionCount?: number;
  generatedAt?: string;
} = {}): DraftBenchmarkArtifact {
  const pairedQuestionCount = Math.max(50, input.pairedQuestionCount ?? 50);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const samples = Array.from({ length: pairedQuestionCount }, (_, rawIndex) => {
    const index = rawIndex + 1;
    const questionId = `TODO_q${index}`;
    return [
      draftSample(questionId, 'retell_kb', index),
      draftSample(questionId, 'own_kb', index),
    ];
  }).flat();

  return {
    artifactVersion: 1,
    approvedForMilestone: 'DRAFT_ONLY',
    approvedBy: null,
    approvedAt: null,
    containsPotentialPii: false,
    usesRealTranscripts: false,
    usesShadowData: false,
    usesCallLogs: false,
    notes: [
      `Generated ${generatedAt}.`,
      'Draft only: replace TODO fields with real same-question Retell-KB and Own-KB measurements, labels, coverage metadata, and canonical voice-latency timestamps.',
      'Do not change approvedForMilestone to 0.5B or fill approvedBy/approvedAt until a human reviewer approves the artifact.',
      'This template intentionally contains null metrics and unknown auditability so it cannot become promotion evidence by approval metadata alone.',
    ].join(' '),
    samples,
  };
}

function csvValue(value: unknown): string {
  if (value == null) return '';
  const raw = String(value);
  const formulaSafe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(formulaSafe)) return `"${formulaSafe.replace(/"/g, '""')}"`;
  return formulaSafe;
}

function timestampValue(value: VoiceLatencyTimestampValue): string {
  if (value == null) return '';
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : '';
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value).toISOString() : '';
  if (typeof value === 'string') return value;
  return '';
}

export function buildBenchmarkLabelingCsv(samples: KnowledgeBenchmarkSample[]): string {
  const rows = samples.map((sample) => {
    const voiceLatency = sample.voiceLatency ?? null;
    return [
      sample.questionId,
      sample.questionFingerprint ?? '',
      sample.provider,
      sample.intent ?? '',
      sample.risk ?? '',
      sample.retrievalMode ?? '',
      sample.normalSupportedTurn ?? '',
      sample.supportedNonToolTurn ?? '',
      sample.staleOnlyCase ?? '',
      sample.outOfScopeCase ?? '',
      sample.germanAsrVariant ?? '',
      sample.interruptionOrCorrectionCase ?? '',
      timestampValue(voiceLatency?.user_audio_end_detected_at),
      timestampValue(voiceLatency?.provider_end_of_turn_at),
      timestampValue(voiceLatency?.asr_partial_first_at),
      timestampValue(voiceLatency?.asr_final_at),
      timestampValue(voiceLatency?.agent_core_turn_start_at),
      timestampValue(voiceLatency?.first_model_token_at),
      timestampValue(voiceLatency?.first_speakable_chunk_at),
      timestampValue(voiceLatency?.first_safe_audio_at),
      timestampValue(voiceLatency?.first_filler_audio_at),
      timestampValue(voiceLatency?.first_full_answer_audio_at),
      voiceLatency?.safe_audio_type ?? '',
      sample.voiceE2eMs ?? '',
      sample.timeToFirstAudioMs ?? '',
      sample.kbContextMs ?? '',
      sample.retellKbLatencyImpactMs ?? '',
      sample.finalAuditedAnswerMs ?? '',
      sample.bargeInRecoveryMs ?? '',
      sample.toolLatencyMs ?? '',
      sample.toolCallCase ?? '',
      sample.answerCorrect ?? '',
      sample.answerable ?? '',
      sample.shouldAbstain ?? '',
      sample.abstained ?? '',
      sample.hallucinated ?? '',
      sample.recallAt5 ?? '',
      sample.auditability ?? '',
      sample.tenantIsolationPassed ?? '',
      sample.staleUnapprovedBlocked ?? '',
      sample.piiSafe ?? '',
      sample.promptInjectionSafe ?? '',
      sample.p0Failure ?? '',
      sample.p1Failure ?? '',
      '',
    ].map(csvValue).join(',');
  });
  return [
    BENCHMARK_LABELING_CSV_COLUMNS.join(','),
    ...rows,
    '',
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

const allowedArtifactKeys = new Set([
  'artifactVersion',
  'approvedForMilestone',
  'approvedBy',
  'approvedAt',
  'containsPotentialPii',
  'usesRealTranscripts',
  'usesShadowData',
  'usesCallLogs',
  'notes',
  'samples',
]);

const allowedSampleKeys = new Set([
  'provider',
  'questionId',
  'questionFingerprint',
  'intent',
  'risk',
  'retrievalMode',
  'normalSupportedTurn',
  'supportedNonToolTurn',
  'staleOnlyCase',
  'outOfScopeCase',
  'germanAsrVariant',
  'interruptionOrCorrectionCase',
  'voiceLatency',
  'voiceE2eMs',
  'timeToFirstAudioMs',
  'kbContextMs',
  'retellKbLatencyImpactMs',
  'finalAuditedAnswerMs',
  'bargeInRecoveryMs',
  'toolLatencyMs',
  'toolCallCase',
  'answerCorrect',
  'answerable',
  'shouldAbstain',
  'abstained',
  'hallucinated',
  'recallAt5',
  'auditability',
  'tenantIsolationPassed',
  'staleUnapprovedBlocked',
  'piiSafe',
  'promptInjectionSafe',
  'p0Failure',
  'p1Failure',
]);

const allowedVoiceLatencyKeys = new Set([
  'callId',
  'turnId',
  'provider',
  ...REQUIRED_VOICE_LATENCY_TIMESTAMPS,
  'first_filler_audio_at',
  'safe_audio_type',
]);

function objectKeysAllowed(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function trustedBenchmarkArtifactHash(artifact: TrustedBenchmarkArtifact): string {
  const canonical = {
    artifactVersion: artifact.artifactVersion,
    approvedForMilestone: artifact.approvedForMilestone,
    approvedBy: artifact.approvedBy,
    approvedAt: artifact.approvedAt,
    containsPotentialPii: artifact.containsPotentialPii,
    usesRealTranscripts: artifact.usesRealTranscripts === true,
    usesShadowData: artifact.usesShadowData === true,
    usesCallLogs: artifact.usesCallLogs === true,
    notes: artifact.notes ?? null,
    samples: artifact.samples,
  };
  return crypto.createHash('sha256').update(stableJson(canonical)).digest('hex');
}

export function isValidBenchmarkApprovalTimestamp(value: string | null): boolean {
  if (value === null) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function isValidBenchmarkApproverHandle(value: string | null): boolean {
  if (value === null) return false;
  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value);
}

function sampleShapeValid(value: unknown): value is KnowledgeBenchmarkSample {
  if (!isRecord(value)) return false;
  if (!objectKeysAllowed(value, allowedSampleKeys)) return false;
  if (value.voiceLatency != null && (!isRecord(value.voiceLatency) || !objectKeysAllowed(value.voiceLatency, allowedVoiceLatencyKeys))) {
    return false;
  }
  const provider = value.provider;
  return (provider === 'retell_kb' || provider === 'own_kb')
    && typeof value.questionId === 'string'
    && value.questionId.trim().length > 0;
}

function sampleMetricInvalid(sample: KnowledgeBenchmarkSample): boolean {
  return sample.recallAt5 != null
    && (!Number.isFinite(sample.recallAt5) || sample.recallAt5 < 0 || sample.recallAt5 > 1);
}

function stringMetadataUnsafe(value: string): boolean {
    const normalized = value.trim();
    if (!normalized) return false;
    if (redactForEval(normalized) !== normalized) return true;
    if (/\bTODO\b|^TODO_/i.test(normalized)) return true;
    if (/^[\s]*[=+\-@]/.test(normalized)) return true;
    if (/[\\/]/.test(normalized) || /^[a-z]:\\/i.test(normalized) || /https?:\/\//i.test(normalized)) return true;
    return false;
}

function stringValueUnsafe(value: unknown): boolean {
  if (typeof value === 'string') return stringMetadataUnsafe(value);
  if (Array.isArray(value)) return value.some(stringValueUnsafe);
  if (isRecord(value)) return Object.values(value).some(stringValueUnsafe);
  return false;
}

function sampleMetadataUnsafe(sample: KnowledgeBenchmarkSample): boolean {
  return stringValueUnsafe(sample);
}

function summarizeArtifact(value: unknown): TrustedBenchmarkArtifactSummary {
  if (!isRecord(value)) {
    return {
      artifactVersion: null,
      approvedForMilestone: null,
      approvedByPresent: false,
      approvedAt: null,
      containsPotentialPii: null,
      usesRealTranscripts: false,
      usesShadowData: false,
      usesCallLogs: false,
      sampleCount: 0,
    };
  }

  return {
    artifactVersion: typeof value.artifactVersion === 'number' ? value.artifactVersion : null,
    approvedForMilestone: stringValue(value.approvedForMilestone),
    approvedByPresent: stringValue(value.approvedBy) !== null,
    approvedAt: stringValue(value.approvedAt),
    containsPotentialPii: booleanValue(value.containsPotentialPii),
    usesRealTranscripts: value.usesRealTranscripts === true,
    usesShadowData: value.usesShadowData === true,
    usesCallLogs: value.usesCallLogs === true,
    sampleCount: Array.isArray(value.samples) ? value.samples.length : 0,
  };
}

function validateArtifact(value: unknown, safetyGates: KnowledgeBenchmarkSafetyGates): {
  artifact: TrustedBenchmarkArtifact | null;
  blockers: TrustedBenchmarkArtifactBlocker[];
  summary: TrustedBenchmarkArtifactSummary;
} {
  const blockers: TrustedBenchmarkArtifactBlocker[] = [];
  const summary = summarizeArtifact(value);

  if (value == null) {
    return {
      artifact: null,
      blockers: ['APPROVED_BENCHMARK_ARTIFACT_MISSING'],
      summary,
    };
  }

  if (!isRecord(value)) {
    return {
      artifact: null,
      blockers: ['BENCHMARK_ARTIFACT_NOT_OBJECT'],
      summary,
    };
  }

  if (!objectKeysAllowed(value, allowedArtifactKeys)) {
    blockers.push('BENCHMARK_ARTIFACT_SAMPLE_SHAPE_INVALID');
  }
  if (value.artifactVersion !== 1) blockers.push('BENCHMARK_ARTIFACT_UNSUPPORTED_VERSION');
  if (value.approvedForMilestone !== '0.5B') blockers.push('BENCHMARK_ARTIFACT_NOT_APPROVED_FOR_0_5B');
  const approvedBy = stringValue(value.approvedBy);
  if (approvedBy === null) {
    blockers.push('BENCHMARK_ARTIFACT_APPROVER_MISSING');
  } else if (!isValidBenchmarkApproverHandle(approvedBy)) {
    blockers.push('BENCHMARK_ARTIFACT_APPROVER_INVALID');
  }

  const approvedAt = stringValue(value.approvedAt);
  if (approvedAt === null) {
    blockers.push('BENCHMARK_ARTIFACT_APPROVAL_DATE_MISSING');
  } else if (!isValidBenchmarkApprovalTimestamp(approvedAt)) {
    blockers.push('BENCHMARK_ARTIFACT_APPROVAL_DATE_INVALID');
  }

  const containsPotentialPii = booleanValue(value.containsPotentialPii);
  const usesRealTranscripts = value.usesRealTranscripts === true;
  const usesShadowData = value.usesShadowData === true;
  const usesCallLogs = value.usesCallLogs === true;
  if (containsPotentialPii === null) {
    blockers.push('BENCHMARK_ARTIFACT_PII_CLASSIFICATION_MISSING');
  } else if (!containsPotentialPii && (usesRealTranscripts || usesShadowData || usesCallLogs)) {
    blockers.push('BENCHMARK_ARTIFACT_PII_SOURCE_CLASSIFICATION_INCONSISTENT');
  } else if (containsPotentialPii && !safetyGates.piiRedactionPassed) {
    blockers.push('BENCHMARK_ARTIFACT_PII_REDACTION_REQUIRED');
  }

  if (!Array.isArray(value.samples) || value.samples.length === 0) {
    blockers.push('BENCHMARK_ARTIFACT_SAMPLES_MISSING');
  } else if (!value.samples.every(sampleShapeValid)) {
    blockers.push('BENCHMARK_ARTIFACT_SAMPLE_SHAPE_INVALID');
  } else if ((value.samples as KnowledgeBenchmarkSample[]).some(sampleMetricInvalid)) {
    blockers.push('BENCHMARK_ARTIFACT_SAMPLE_METRIC_INVALID');
  } else if ((value.samples as KnowledgeBenchmarkSample[]).some(sampleMetadataUnsafe)) {
    blockers.push('BENCHMARK_ARTIFACT_SAMPLE_METADATA_UNSAFE');
  }
  if (stringValueUnsafe(value.notes)) blockers.push('BENCHMARK_ARTIFACT_SAMPLE_METADATA_UNSAFE');

  if (blockers.length > 0) {
    return { artifact: null, blockers, summary };
  }

  return {
    artifact: {
      artifactVersion: 1,
      approvedForMilestone: '0.5B',
      approvedBy: approvedBy!,
      approvedAt: approvedAt!,
      containsPotentialPii: containsPotentialPii!,
      usesRealTranscripts,
      usesShadowData,
      usesCallLogs,
      notes: stringValue(value.notes) ?? undefined,
      samples: value.samples as KnowledgeBenchmarkSample[],
    },
    blockers: [],
    summary,
  };
}

function artifactSamples(value: unknown): KnowledgeBenchmarkSample[] | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.samples) || value.samples.length === 0) return null;
  if (!value.samples.every(sampleShapeValid)) return null;
  return value.samples as KnowledgeBenchmarkSample[];
}

function gapActions(
  artifactBlockers: TrustedBenchmarkArtifactBlocker[],
  reportBlockers: KnowledgeBenchmarkBlocker[],
  canaryBlockers: KnowledgeBenchmarkCanaryBlocker[],
  primaryBlockers: KnowledgeBenchmarkPrimaryBlocker[],
): string[] {
  const actions: string[] = [];
  if (artifactBlockers.includes('APPROVED_BENCHMARK_ARTIFACT_MISSING')) {
    actions.push('provide_explicit_0_5b_artifact');
  }
  if (
    artifactBlockers.includes('BENCHMARK_ARTIFACT_NOT_APPROVED_FOR_0_5B')
    || artifactBlockers.includes('BENCHMARK_ARTIFACT_APPROVER_MISSING')
    || artifactBlockers.includes('BENCHMARK_ARTIFACT_APPROVER_INVALID')
    || artifactBlockers.includes('BENCHMARK_ARTIFACT_APPROVAL_DATE_MISSING')
    || artifactBlockers.includes('BENCHMARK_ARTIFACT_APPROVAL_DATE_INVALID')
  ) {
    actions.push('obtain_human_0_5b_approval_metadata');
  }
  if (
    artifactBlockers.includes('BENCHMARK_ARTIFACT_SAMPLES_MISSING')
    || artifactBlockers.includes('BENCHMARK_ARTIFACT_SAMPLE_SHAPE_INVALID')
    || artifactBlockers.includes('BENCHMARK_ARTIFACT_SAMPLE_METRIC_INVALID')
  ) {
    actions.push('provide_same_question_retell_and_own_kb_samples');
  }
  if (artifactBlockers.includes('BENCHMARK_ARTIFACT_SAMPLE_METADATA_UNSAFE')) {
    actions.push('replace_sample_metadata_with_opaque_ids_and_controlled_intents');
  }
  if (artifactBlockers.includes('BENCHMARK_ARTIFACT_PII_CLASSIFICATION_MISSING')) {
    actions.push('classify_artifact_pii_status');
  }
  if (artifactBlockers.includes('BENCHMARK_ARTIFACT_PII_SOURCE_CLASSIFICATION_INCONSISTENT')) {
    actions.push('mark_real_call_artifact_as_potential_pii');
  }
  if (artifactBlockers.includes('BENCHMARK_ARTIFACT_PII_REDACTION_REQUIRED')) {
    actions.push('complete_or_enable_milestone_1c_pii_controls_for_artifact');
  }
  if (reportBlockers.some((blocker) => blocker.startsWith('INSUFFICIENT_') || blocker === 'RETELL_AND_OWN_KB_NOT_MEASURED_ON_SAME_QUESTIONS')) {
    actions.push('fill_required_coverage_50_paired_questions_30_intents_and_edge_cases');
  }
  if (reportBlockers.some((blocker) => blocker.startsWith('MISSING_'))) {
    actions.push('fill_missing_latency_context_and_quality_metrics');
  }
  if (reportBlockers.includes('MISSING_VOICE_LATENCY_CONTRACT') || reportBlockers.includes('VOICE_LATENCY_CONTRACT_NOT_READY')) {
    actions.push('attach_canonical_voice_latency_timestamps');
  }
  if (reportBlockers.includes('MISSING_QUALITY_LABELS') || reportBlockers.some((blocker) => blocker.includes('BELOW_98_PERCENT'))) {
    actions.push('complete_human_quality_labels_and_p1_review');
  }
  if (reportBlockers.some((blocker) => blocker.includes('AUDITABILITY'))) {
    actions.push('provide_evidence_auditability_for_high_risk_cases');
  }
  if (artifactBlockers.includes('BENCHMARK_ARTIFACT_HASH_NOT_APPROVED')) {
    actions.push('record_approved_artifact_sha256_before_promotion');
  }
  if (reportBlockers.some((blocker) => blocker.includes('TENANT') || blocker.includes('STALE') || blocker.includes('PII') || blocker.includes('PROMPT_INJECTION'))) {
    actions.push('prove_safety_governance_labels');
  }
  if (canaryBlockers.length > 0) {
    actions.push('complete_product_kpi_exception_slo_standby_rollback_and_kill_switch_gates_before_canary');
  }
  if (primaryBlockers.length > 0) {
    actions.push('complete_canary_standby_and_rollback_gates_before_primary');
  }
  return [...new Set(actions)];
}

export function buildBenchmarkArtifactGapReport(input: {
  artifact: unknown;
  safetyGates: KnowledgeBenchmarkSafetyGates;
  generatedAt?: string;
}): BenchmarkArtifactGapReport {
  const validation = validateArtifact(input.artifact, input.safetyGates);
  const samples = artifactSamples(input.artifact);
  const artifactHash = validation.artifact === null ? null : trustedBenchmarkArtifactHash(validation.artifact);
  const report = samples
    ? buildRetellVsOwnKbDecisionReport({
        generatedAt: input.generatedAt,
        samples,
        safetyGates: input.safetyGates,
        approvedPromotionArtifact: validation.blockers.length === 0,
      })
    : null;
  const reportOtherwiseReady =
    report !== null
    && validation.blockers.length === 0
    && report.promotionEvidenceTrusted
    && report.blockers.length === 0
    && report.canaryBlockers.length === 0
    && (report.decision === 'owkb_canary_candidate' || report.decision === 'owkb_primary_candidate');
  const artifactHashApproved =
    artifactHash !== null
    && report !== null
    && (
      (report.decision === 'owkb_canary_candidate' && ownKbPromotionEvidenceHashMatches('canary', artifactHash)) ||
      (report.decision === 'owkb_primary_candidate' && ownKbPromotionEvidenceHashMatches('primary', artifactHash))
    );
  const reportReadyForPromotion =
    reportOtherwiseReady
    && artifactHashApproved;

  const artifactBlockers = [...validation.blockers];
  if (reportOtherwiseReady && !artifactHashApproved) {
    artifactBlockers.push('BENCHMARK_ARTIFACT_HASH_NOT_APPROVED');
  }
  const reportBlockers = report?.blockers ?? [];
  const primaryBlockers = report?.primaryBlockers ?? [];
  const canaryBlockers = report?.canaryBlockers ?? [];
  return {
    artifactSummary: validation.summary,
    sampleShapeUsable: samples !== null,
    promotionEvidenceUsable: reportReadyForPromotion,
    artifactHash,
    artifactBlockers,
    reportBlockers,
    canaryBlockers,
    primaryBlockers,
    warnings: report?.warnings ?? [],
    nextActions: gapActions(artifactBlockers, reportBlockers, canaryBlockers, primaryBlockers),
  };
}

export function buildTrustedBenchmarkReportFromArtifact(input: {
  artifact: unknown;
  safetyGates: KnowledgeBenchmarkSafetyGates;
  generatedAt?: string;
}): TrustedBenchmarkExecutionResult {
  const validation = validateArtifact(input.artifact, input.safetyGates);
  if (validation.artifact === null) {
    return {
      artifactAccepted: false,
      promotionEvidenceUsable: false,
      blockers: validation.blockers,
      artifactSummary: validation.summary,
      artifactHash: null,
      report: null,
    };
  }

  const artifactHash = trustedBenchmarkArtifactHash(validation.artifact);
  const report = buildRetellVsOwnKbDecisionReport({
    generatedAt: input.generatedAt,
    samples: validation.artifact.samples,
    safetyGates: input.safetyGates,
    approvedPromotionArtifact: true,
  });
  const reportOtherwiseReady =
    report.promotionEvidenceTrusted
    && report.blockers.length === 0
    && report.canaryBlockers.length === 0
    && (report.decision === 'owkb_canary_candidate' || report.decision === 'owkb_primary_candidate');
  const artifactHashApproved =
    (report.decision === 'owkb_canary_candidate' && ownKbPromotionEvidenceHashMatches('canary', artifactHash)) ||
    (report.decision === 'owkb_primary_candidate' && ownKbPromotionEvidenceHashMatches('primary', artifactHash));
  const reportReadyForPromotion = reportOtherwiseReady && artifactHashApproved;
  const blockers: TrustedBenchmarkArtifactBlocker[] = [];
  if (!reportReadyForPromotion) {
    blockers.push('BENCHMARK_REPORT_NOT_PROMOTION_READY');
  }
  if (reportOtherwiseReady && !artifactHashApproved) {
    blockers.push('BENCHMARK_ARTIFACT_HASH_NOT_APPROVED');
  }

  return {
    artifactAccepted: true,
    promotionEvidenceUsable: reportReadyForPromotion,
    blockers,
    artifactSummary: validation.summary,
    artifactHash,
    report,
  };
}
