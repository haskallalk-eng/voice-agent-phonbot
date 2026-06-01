import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildOwnKbSourcesFromFactIntakeCsv } from '../own-kb-simulation-enrichment.js';

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim() || null;
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1]?.trim() || null;
  return null;
}

function assertDistinctOutputPaths(input: string, output: string | null, reportOutput: string | null): void {
  const inputPath = path.resolve(input);
  const outputPath = output ? path.resolve(output) : null;
  const reportOutputPath = reportOutput ? path.resolve(reportOutput) : null;
  if (
    (outputPath && outputPath === inputPath)
    || (reportOutputPath && reportOutputPath === inputPath)
    || (outputPath && reportOutputPath && outputPath === reportOutputPath)
  ) {
    throw new Error('FACT_INTAKE_OUTPUT_PATH_CONFLICT');
  }
}

async function main(): Promise<void> {
  const input = argValue('--input')
    ?? 'scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-fact-intake-template.csv';
  const sourceRequirements = argValue('--source-requirements');
  const sourceApprovalManifest = argValue('--approval-manifest');
  const orgId = argValue('--org-id');
  const tenantId = argValue('--tenant-id');
  const approvalSecretEnv = argValue('--approval-secret-env');
  const output = argValue('--output');
  const reportOutput = argValue('--report-output');
  if (orgId || tenantId) {
    throw new Error('FACT_INTAKE_TRUSTED_SCOPE_CANNOT_BE_SUPPLIED_BY_CLI');
  }
  assertDistinctOutputPaths(input, output, reportOutput);

  const { report, sources } = buildOwnKbSourcesFromFactIntakeCsv(
    await readFile(path.resolve(input), 'utf8'),
    new Date(),
    sourceRequirements ? await readFile(path.resolve(sourceRequirements), 'utf8') : undefined,
    sourceApprovalManifest ? await readFile(path.resolve(sourceApprovalManifest), 'utf8') : undefined,
    {
      approvalSecret: approvalSecretEnv ? process.env[approvalSecretEnv] : undefined,
    },
  );
  if (output && sources.length > 0) {
    await writeFile(path.resolve(output), `${JSON.stringify(sources, null, 2)}\n`, 'utf8');
    report.sourcesWritten = true;
  } else if (output) {
    await writeFile(path.resolve(output), '[]\n', 'utf8');
  }
  if (reportOutput) {
    await writeFile(path.resolve(reportOutput), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`${JSON.stringify({
    ...report,
    sourcesWritten: sources.length > 0 && Boolean(output),
    reportWritten: Boolean(reportOutput),
  }, null, 2)}\n`);
  if (report.invalidRows > 0 || !report.sourceGenerationReady) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unknown Own-KB fact-intake validation error'}\n`);
  process.exitCode = 1;
});
