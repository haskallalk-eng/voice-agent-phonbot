import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildOwnKbAuthoringGapReportFromCsv } from '../own-kb-authoring.js';

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

async function main(): Promise<void> {
  const input = argValue('--input')
    ?? 'scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-source-authoring.csv';
  const output = argValue('--output');
  const minRows = intArg('--min-rows', 50);

  const report = buildOwnKbAuthoringGapReportFromCsv(
    await readFile(path.resolve(input), 'utf8'),
    new Date(),
    { minRows },
  );

  if (output) {
    await writeFile(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`${JSON.stringify({
    kind: report.kind,
    rows: report.rows,
    validRows: report.validRows,
    invalidRows: report.invalidRows,
    minRowsRequired: report.minRowsRequired,
    issueCounts: report.issueCounts,
    gapCounts: report.gapCounts,
    rowGapCount: report.rowGaps.length,
    nextActions: report.nextActions,
    containsCallerContent: report.containsCallerContent,
    exportsRedactedQuestions: report.exportsRedactedQuestions,
    promotionEvidenceUsable: report.promotionEvidenceUsable,
    gapReportWritten: Boolean(output),
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unknown Own-KB authoring gap error'}\n`);
  process.exitCode = 1;
});
