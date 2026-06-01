import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  applyBenchmarkLabelsCsv,
  buildBenchmarkArtifactGapReport,
  isValidBenchmarkApproverHandle,
  isValidBenchmarkApprovalTimestamp,
  summarizeBenchmarkLabelImportResult,
} from '../own-kb-benchmark-artifact.js';
import type { KnowledgeBenchmarkSafetyGates } from '../own-kb-benchmark.js';

type CliArgs = {
  artifactPath: string | null;
  labelsPath: string | null;
  outputPath: string | null;
  gapOutputPath: string | null;
  safetyGatesPath: string | null;
  generatedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  containsPotentialPii: boolean | undefined;
  usesRealTranscripts: boolean | undefined;
  usesShadowData: boolean | undefined;
  usesCallLogs: boolean | undefined;
  notes: string | null;
};

function parseBooleanFlag(flag: string, value: string | undefined): boolean {
  if (value == null) throw new Error(`${flag} requires true or false.`);
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  throw new Error(`${flag} requires true or false.`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    artifactPath: null,
    labelsPath: null,
    outputPath: null,
    gapOutputPath: null,
    safetyGatesPath: null,
    generatedAt: null,
    approvedBy: null,
    approvedAt: null,
    containsPotentialPii: undefined,
    usesRealTranscripts: undefined,
    usesShadowData: undefined,
    usesCallLogs: undefined,
    notes: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--artifact') {
      args.artifactPath = next ?? null;
      index += 1;
    } else if (arg === '--labels') {
      args.labelsPath = next ?? null;
      index += 1;
    } else if (arg === '--output') {
      args.outputPath = next ?? null;
      index += 1;
    } else if (arg === '--gap-output') {
      args.gapOutputPath = next ?? null;
      index += 1;
    } else if (arg === '--safety-gates') {
      args.safetyGatesPath = next ?? null;
      index += 1;
    } else if (arg === '--generated-at') {
      args.generatedAt = next ?? null;
      index += 1;
    } else if (arg === '--approved-by') {
      args.approvedBy = next ?? null;
      index += 1;
    } else if (arg === '--approved-at') {
      args.approvedAt = next ?? null;
      index += 1;
    } else if (arg === '--contains-potential-pii') {
      args.containsPotentialPii = parseBooleanFlag(arg, next);
      index += 1;
    } else if (arg === '--uses-real-transcripts') {
      args.usesRealTranscripts = parseBooleanFlag(arg, next);
      index += 1;
    } else if (arg === '--uses-shadow-data') {
      args.usesShadowData = parseBooleanFlag(arg, next);
      index += 1;
    } else if (arg === '--uses-call-logs') {
      args.usesCallLogs = parseBooleanFlag(arg, next);
      index += 1;
    } else if (arg === '--notes') {
      args.notes = next ?? null;
      index += 1;
    }
  }

  return args;
}

async function readTextFile(filePath: string): Promise<string> {
  return (await readFile(path.resolve(filePath), 'utf8')).replace(/^\uFEFF/, '');
}

const failClosedSafetyGates: KnowledgeBenchmarkSafetyGates = {
  trustedScopePassed: false,
  dbRlsReadinessPassed: false,
  piiRedactionPassed: false,
  traceScopePassed: false,
  voiceLatencyMeasurementPassed: false,
  productKpiHardGatesPassed: false,
  exceptionPathSloReported: false,
  canaryWithoutP0Days: 0,
  retellStandbyReady: false,
  rollbackTested: false,
  killSwitchTested: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseSafetyGates(value: unknown): KnowledgeBenchmarkSafetyGates {
  if (!isRecord(value)) return failClosedSafetyGates;
  return {
    trustedScopePassed: readBoolean(value.trustedScopePassed),
    dbRlsReadinessPassed: readBoolean(value.dbRlsReadinessPassed),
    piiRedactionPassed: readBoolean(value.piiRedactionPassed),
    traceScopePassed: readBoolean(value.traceScopePassed),
    voiceLatencyMeasurementPassed: readBoolean(value.voiceLatencyMeasurementPassed),
    productKpiHardGatesPassed: readBoolean(value.productKpiHardGatesPassed),
    exceptionPathSloReported: readBoolean(value.exceptionPathSloReported),
    canaryWithoutP0Days: readNumber(value.canaryWithoutP0Days),
    retellStandbyReady: readBoolean(value.retellStandbyReady),
    rollbackTested: readBoolean(value.rollbackTested),
    killSwitchTested: readBoolean(value.killSwitchTested),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.artifactPath || !args.labelsPath || !args.outputPath) {
    throw new Error('Required: --artifact <json> --labels <csv> --output <json>');
  }
  const approvalRequested = args.approvedBy !== null || args.approvedAt !== null;
  if (approvalRequested && (!args.approvedBy || !args.approvedAt)) {
    throw new Error('0.5B approval requires both --approved-by and --approved-at.');
  }
  if (approvalRequested && !isValidBenchmarkApproverHandle(args.approvedBy)) {
    throw new Error('0.5B approval requires --approved-by as a neutral lowercase reviewer handle.');
  }
  if (approvalRequested && !isValidBenchmarkApprovalTimestamp(args.approvedAt)) {
    throw new Error('0.5B approval requires --approved-at as UTC ISO timestamp with milliseconds, e.g. 2026-05-30T00:00:00.000Z.');
  }
  if (approvalRequested && args.containsPotentialPii === undefined) {
    throw new Error('0.5B approval requires explicit --contains-potential-pii true|false.');
  }
  const usesPotentialPiiSource =
    args.usesRealTranscripts === true || args.usesShadowData === true || args.usesCallLogs === true;
  if (args.containsPotentialPii === false && usesPotentialPiiSource) {
    throw new Error('Real transcripts, shadow data, or call logs require --contains-potential-pii true.');
  }

  const artifact = JSON.parse(await readTextFile(args.artifactPath)) as unknown;
  const csv = await readTextFile(args.labelsPath);
  const result = applyBenchmarkLabelsCsv({
    artifact: artifact as Parameters<typeof applyBenchmarkLabelsCsv>[0]['artifact'],
    csv,
    approvedBy: args.approvedBy,
    approvedAt: args.approvedAt,
    containsPotentialPii: args.containsPotentialPii,
    usesRealTranscripts: args.usesRealTranscripts,
    usesShadowData: args.usesShadowData,
    usesCallLogs: args.usesCallLogs,
    notes: args.notes ?? undefined,
  });
  if (approvalRequested && result.artifact.approvedForMilestone !== '0.5B') {
    const reasons = [
      !result.csvHeaderValid ? 'invalid CSV header' : null,
      result.duplicateRowKeys.length > 0 ? 'duplicate CSV question/provider rows' : null,
      result.unmatchedRowKeys.length > 0 ? 'CSV rows that do not match artifact samples' : null,
      result.missingSampleKeys.length > 0 ? 'artifact samples without CSV labels' : null,
      result.invalidRecallAt5RowKeys.length > 0 ? 'invalid Recall@5 labels outside 0..1' : null,
    ].filter((reason): reason is string => reason !== null);
    throw new Error(`0.5B approval import failed row-integrity checks: ${reasons.join('; ') || 'unknown row-integrity failure'}.`);
  }

  await writeFile(path.resolve(args.outputPath), `${JSON.stringify(result.artifact, null, 2)}\n`, 'utf8');
  if (args.gapOutputPath) {
    const safetyGates = args.safetyGatesPath
      ? parseSafetyGates(JSON.parse(await readTextFile(args.safetyGatesPath)) as unknown)
      : failClosedSafetyGates;
    const gapReport = buildBenchmarkArtifactGapReport({
      artifact: result.artifact,
      safetyGates,
      generatedAt: args.generatedAt ?? undefined,
    });
    await writeFile(path.resolve(args.gapOutputPath), `${JSON.stringify(gapReport, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify({
    kind: 'retell_vs_own_kb_0_5b_label_import',
    artifactWritten: true,
    gapReportWritten: args.gapOutputPath !== null,
    ...summarizeBenchmarkLabelImportResult(result),
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown benchmark label import error';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
