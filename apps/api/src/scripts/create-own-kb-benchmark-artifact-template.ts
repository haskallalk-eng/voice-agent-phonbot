import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildDraftBenchmarkArtifactTemplate } from '../own-kb-benchmark-artifact.js';

type CliArgs = {
  outputPath: string | null;
  pairedQuestionCount: number;
  generatedAt: string | null;
};

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    outputPath: null,
    pairedQuestionCount: 50,
    generatedAt: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--output') {
      args.outputPath = next ?? null;
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const template = buildDraftBenchmarkArtifactTemplate({
    pairedQuestionCount: args.pairedQuestionCount,
    generatedAt: args.generatedAt ?? undefined,
  });
  const json = `${JSON.stringify(template, null, 2)}\n`;

  if (args.outputPath) {
    await writeFile(path.resolve(args.outputPath), json, 'utf8');
  }
  process.stdout.write(`${JSON.stringify({
    kind: 'retell_vs_own_kb_0_5b_draft_template',
    artifactWritten: args.outputPath !== null,
    pairedQuestionCount: template.samples.length / 2,
    sampleCount: template.samples.length,
    approvedForMilestone: template.approvedForMilestone,
    promotionEvidenceUsable: false,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown benchmark artifact template error';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
