import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  applyOwnKbDiagnosticToBenchmarkArtifact,
  buildBenchmarkArtifactGapReport,
} from '../own-kb-benchmark-artifact.js';
import type { KnowledgeBenchmarkSafetyGates } from '../own-kb-benchmark.js';

type CliArgs = {
  artifactPath: string | null;
  diagnosticPath: string | null;
  outputPath: string | null;
  gapOutputPath: string | null;
  safetyGatesPath: string | null;
  generatedAt: string | null;
};

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

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    artifactPath: null,
    diagnosticPath: null,
    outputPath: null,
    gapOutputPath: null,
    safetyGatesPath: null,
    generatedAt: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--artifact') {
      args.artifactPath = next ?? null;
      index += 1;
    } else if (arg === '--diagnostic') {
      args.diagnosticPath = next ?? null;
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
    }
  }

  return args;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const contents = await readFile(path.resolve(filePath), 'utf8');
  return JSON.parse(contents.replace(/^\uFEFF/, '')) as unknown;
}

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
  if (!args.artifactPath || !args.diagnosticPath || !args.outputPath) {
    throw new Error('Required: --artifact <json> --diagnostic <json> --output <json>');
  }

  const artifact = await readJsonFile(args.artifactPath);
  const diagnostic = await readJsonFile(args.diagnosticPath);
  const result = applyOwnKbDiagnosticToBenchmarkArtifact({
    artifact: artifact as Parameters<typeof applyOwnKbDiagnosticToBenchmarkArtifact>[0]['artifact'],
    diagnostic,
  });

  await writeFile(path.resolve(args.outputPath), `${JSON.stringify(result.artifact, null, 2)}\n`, 'utf8');
  if (args.gapOutputPath) {
    const safetyGates = args.safetyGatesPath
      ? parseSafetyGates(await readJsonFile(args.safetyGatesPath))
      : failClosedSafetyGates;
    const gapReport = buildBenchmarkArtifactGapReport({
      artifact: result.artifact,
      safetyGates,
      generatedAt: args.generatedAt ?? undefined,
    });
    await writeFile(path.resolve(args.gapOutputPath), `${JSON.stringify(gapReport, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`${JSON.stringify({
    kind: 'retell_vs_own_kb_0_5b_own_kb_diagnostic_import',
    artifactWritten: true,
    gapReportWritten: args.gapOutputPath !== null,
    diagnosticsRead: result.diagnosticsRead,
    diagnosticsApplied: result.diagnosticsApplied,
    duplicateDiagnosticCount: result.duplicateDiagnosticCount,
    fingerprintMismatchCount: result.fingerprintMismatchCount,
    qaLabelsResetCount: result.qaLabelsResetCount,
    unmatchedDiagnosticCount: result.unmatchedDiagnosticCount,
    missingOwnKbSampleCount: result.missingOwnKbSampleCount,
    approvedForMilestone: result.artifact.approvedForMilestone,
    promotionEvidenceUsable: false,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown Own-KB diagnostic import error';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
