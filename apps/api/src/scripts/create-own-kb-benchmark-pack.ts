import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildBenchmarkArtifactGapReport,
  buildBenchmarkLabelingCsv,
  buildDraftBenchmarkArtifactTemplate,
} from '../own-kb-benchmark-artifact.js';
import type { KnowledgeBenchmarkSafetyGates } from '../own-kb-benchmark.js';

type CliArgs = {
  outputDir: string;
  pairedQuestionCount: number;
  generatedAt: string | null;
};

const completeNoRolloutSafetyGates: KnowledgeBenchmarkSafetyGates = {
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

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    outputDir: 'scratch/own-kb-benchmark',
    pairedQuestionCount: 50,
    generatedAt: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--output-dir') {
      args.outputDir = next ?? args.outputDir;
      index += 1;
    } else if (arg === '--paired-questions') {
      args.pairedQuestionCount = parsePositiveInteger(next, 50);
      index += 1;
    } else if (arg === '--generated-at') {
      args.generatedAt = next ?? null;
      index += 1;
    }
  }

  return args;
}

function readmeText(): string {
  return [
    '# Retell-KB vs Own-KB 0.5B Benchmark Pack',
    '',
    'This local pack is for preparing an approved Milestone 0.5B benchmark artifact.',
    '',
    'Rules:',
    '',
    '- Do not add raw transcripts, phone numbers, emails, names, call IDs, or secrets.',
    '- Keep call/user references hashed or synthetic.',
    '- Fill the CSV and JSON with same-question Retell-KB and Own-KB measurements.',
    '- Use canonical voice latency timestamps, not filler-only audio.',
    '- Human approval is required before `approvedForMilestone` may become `0.5B`.',
    '- Approval metadata alone is not enough; metrics, labels, coverage, and auditability must pass.',
    '- Own-KB primary remains blocked even after a canary-candidate report.',
    '',
    'Files:',
    '',
    '- `retell-vs-own-kb-0.5b-draft.json`: draft artifact template.',
    '- `retell-vs-own-kb-0.5b-labeling.csv`: QA worksheet with required label/latency columns.',
    '- `safety-gates-complete-no-rollout.json`: current Milestone 1 gates complete, no rollout/primary gates.',
    '- `retell-vs-own-kb-0.5b-draft-gap-report.json`: sanitized blockers and next actions.',
    '',
    'Apply completed labels back into a candidate artifact from `apps/api`:',
    '',
    '```bash',
    'pnpm own-kb:benchmark-apply-labels --artifact scratch/own-kb-benchmark/retell-vs-own-kb-0.5b-draft.json --labels scratch/own-kb-benchmark/retell-vs-own-kb-0.5b-labeling.csv --output scratch/own-kb-benchmark/retell-vs-own-kb-0.5b-candidate.json --gap-output scratch/own-kb-benchmark/retell-vs-own-kb-0.5b-candidate-gap-report.json --safety-gates scratch/own-kb-benchmark/safety-gates-complete-no-rollout.json',
    '```',
    '',
    'Validate a completed artifact from `apps/api`:',
    '',
    '```bash',
    'pnpm own-kb:benchmark-artifact --artifact scratch/own-kb-benchmark/retell-vs-own-kb-0.5b-draft.json --safety-gates scratch/own-kb-benchmark/safety-gates-complete-no-rollout.json --report-only',
    '```',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = path.resolve(args.outputDir);
  await mkdir(outputDir, { recursive: true });

  const artifact = buildDraftBenchmarkArtifactTemplate({
    pairedQuestionCount: args.pairedQuestionCount,
    generatedAt: args.generatedAt ?? undefined,
  });
  const gapReport = buildBenchmarkArtifactGapReport({
    artifact,
    safetyGates: completeNoRolloutSafetyGates,
    generatedAt: args.generatedAt ?? undefined,
  });

  const files = {
    artifact: path.join(outputDir, 'retell-vs-own-kb-0.5b-draft.json'),
    labelingCsv: path.join(outputDir, 'retell-vs-own-kb-0.5b-labeling.csv'),
    safetyGates: path.join(outputDir, 'safety-gates-complete-no-rollout.json'),
    gapReport: path.join(outputDir, 'retell-vs-own-kb-0.5b-draft-gap-report.json'),
    readme: path.join(outputDir, 'README.md'),
  };

  await writeFile(files.artifact, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  await writeFile(files.labelingCsv, buildBenchmarkLabelingCsv(artifact.samples), 'utf8');
  await writeFile(files.safetyGates, `${JSON.stringify(completeNoRolloutSafetyGates, null, 2)}\n`, 'utf8');
  await writeFile(files.gapReport, `${JSON.stringify(gapReport, null, 2)}\n`, 'utf8');
  await writeFile(files.readme, readmeText(), 'utf8');

  process.stdout.write(`${JSON.stringify({
    kind: 'retell_vs_own_kb_0_5b_benchmark_pack',
    outputDirectoryWritten: true,
    filesWritten: Object.keys(files),
    promotionEvidenceUsable: false,
    nextActions: gapReport.nextActions,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown benchmark pack generation error';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
