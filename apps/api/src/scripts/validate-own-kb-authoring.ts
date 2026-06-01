import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildOwnKbSourcesFromAuthoringCsv,
} from '../own-kb-authoring.js';

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim() || null;
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1]?.trim() || null;
  return null;
}

function intArg(name: string, fallback: number): number {
  const value = argValue(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name.toUpperCase().replace(/^--/, '')}_INVALID`);
  return parsed;
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
    throw new Error('AUTHORING_OUTPUT_PATH_CONFLICT');
  }
}

async function main(): Promise<void> {
  const input = argValue('--input')
    ?? 'scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-source-authoring.csv';
  const output = argValue('--output');
  const reportOutput = argValue('--report-output');
  const minRows = intArg('--min-rows', 50);
  assertDistinctOutputPaths(input, output, reportOutput);
  const { report, rowReports, sources } = buildOwnKbSourcesFromAuthoringCsv(
    await readFile(path.resolve(input), 'utf8'),
    new Date(),
    { minRows },
  );

  if (output && sources.length > 0) {
    await writeFile(path.resolve(output), `${JSON.stringify(sources, null, 2)}\n`, 'utf8');
    report.sourcesWritten = true;
  } else if (output) {
    await writeFile(path.resolve(output), '[]\n', 'utf8');
    report.outputCleared = true;
  }
  if (reportOutput) {
    await writeFile(path.resolve(reportOutput), `${JSON.stringify({ ...report, rowReports }, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.invalidRows > 0 || !report.sourceGenerationReady) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unknown Own-KB authoring validation error'}\n`);
  process.exitCode = 1;
});
