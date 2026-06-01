import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildBenchmarkArtifactGapReport,
  buildTrustedBenchmarkReportFromArtifact,
  type TrustedBenchmarkExecutionResult,
} from '../own-kb-benchmark-artifact.js';
import type { KnowledgeBenchmarkSafetyGates } from '../own-kb-benchmark.js';

type CliArgs = {
  artifactPath: string | null;
  safetyGatesPath: string | null;
  outputPath: string | null;
  generatedAt: string | null;
  reportOnly: boolean;
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
    safetyGatesPath: null,
    outputPath: null,
    generatedAt: null,
    reportOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--artifact') {
      args.artifactPath = next ?? null;
      index += 1;
    } else if (arg === '--safety-gates') {
      args.safetyGatesPath = next ?? null;
      index += 1;
    } else if (arg === '--output') {
      args.outputPath = next ?? null;
      index += 1;
    } else if (arg === '--generated-at') {
      args.generatedAt = next ?? null;
      index += 1;
    } else if (arg === '--report-only') {
      args.reportOnly = true;
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

function sanitizedResult(result: TrustedBenchmarkExecutionResult) {
  return {
    artifactAccepted: result.artifactAccepted,
    promotionEvidenceUsable: result.promotionEvidenceUsable,
    artifactHash: result.artifactHash,
    blockers: result.blockers,
    artifactSummary: result.artifactSummary,
    report: result.report
      ? {
          decision: result.report.decision,
          promotionEvidenceTrusted: result.report.promotionEvidenceTrusted,
          generatedAt: result.report.generatedAt,
          questionCoverage: result.report.questionCoverage,
          blockers: result.report.blockers,
          canaryBlockers: result.report.canaryBlockers,
          primaryBlockers: result.report.primaryBlockers,
          warnings: result.report.warnings,
          retell: result.report.retell,
          ownKb: result.report.ownKb,
        }
      : null,
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const artifact = args.artifactPath ? await readJsonFile(args.artifactPath) : null;
  const safetyGates = args.safetyGatesPath
    ? parseSafetyGates(await readJsonFile(args.safetyGatesPath))
    : failClosedSafetyGates;

  const result = buildTrustedBenchmarkReportFromArtifact({
    artifact,
    safetyGates,
    generatedAt: args.generatedAt ?? undefined,
  });
  const gapReport = buildBenchmarkArtifactGapReport({
    artifact,
    safetyGates,
    generatedAt: args.generatedAt ?? undefined,
  });
  const output = {
    kind: 'retell_vs_own_kb_0_5b_artifact_report',
    promotionEvidenceUsable: result.promotionEvidenceUsable,
    generatedAt: new Date().toISOString(),
    gapReport,
    result: sanitizedResult(result),
  };
  const json = `${JSON.stringify(output, null, 2)}\n`;

  if (args.outputPath) {
    await writeFile(path.resolve(args.outputPath), json, 'utf8');
  } else {
    process.stdout.write(json);
  }

  if (args.reportOnly) return 0;
  return result.promotionEvidenceUsable ? 0 : 2;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown benchmark artifact runner error';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
