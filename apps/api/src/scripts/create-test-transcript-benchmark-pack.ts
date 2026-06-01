import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { pool } from '../db.js';
import {
  buildBenchmarkArtifactGapReport,
  buildBenchmarkLabelingCsv,
  buildDraftBenchmarkArtifactTemplate,
} from '../own-kb-benchmark-artifact.js';
import type { KnowledgeBenchmarkSafetyGates } from '../own-kb-benchmark.js';
import { extractShadowQuestionsFromTranscript } from '../own-kb-shadow.js';
import {
  addDaysIso,
  canonicalUtcTimestampArgValue,
  csvValue,
  hashTestTranscriptQuestion,
  isSafeTestTranscriptQuestion,
  testTranscriptIntentName,
  testTranscriptQuestionFingerprint,
  testTranscriptQuestionId,
} from '../test-transcript-benchmark-pack.js';

type CliArgs = {
  outputDir: string;
  questionCount: number;
  maxRows: number;
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

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim() || null;
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1]?.trim() || null;
  return null;
}

function intArg(name: string, fallback: number, min: number, max: number): number {
  const raw = argValue(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  const label = name.toUpperCase().replace(/^--/, '');
  if (!Number.isFinite(parsed) || String(parsed) !== raw) throw new Error(`${label}_INVALID`);
  if (parsed < min || parsed > max) throw new Error(`${label}_OUT_OF_RANGE_${min}_${max}`);
  return parsed;
}

function canonicalUtcNow(): string {
  return new Date().toISOString();
}

function canonicalUtcTimestampArg(name: string): string | null {
  return canonicalUtcTimestampArgValue(name, argValue(name));
}

function parseArgs(): CliArgs {
  return {
    outputDir: argValue('--output-dir') ?? 'scratch/own-kb-benchmark/test-transcripts',
    questionCount: intArg('--questions', 50, 50, 200),
    maxRows: intArg('--max-rows', 200, 1, 500),
    generatedAt: canonicalUtcTimestampArg('--generated-at'),
  };
}

function readmeText(): string {
  return [
    '# Test Transcript 0.5B Draft Pack',
    '',
    'This pack is DRAFT_ONLY and non-promotional.',
    'It is generated from user-confirmed test/demo transcripts using the redacted shadow-question extractor.',
    'Do not copy raw transcripts into this folder or into external review exports.',
    'Use the redacted question bank only for local QA labeling.',
    '',
    '## Own-KB Authoring',
    '',
    '`test-transcript-own-kb-source-authoring.csv` is a local authoring aid only.',
    'Do not ingest draft rows.',
    'Before source JSON can be generated, every row must have:',
    '',
    '- an evidence-backed `proposedAnswer`;',
    '- a concrete `sourceTitle`;',
    '- `reviewStatus` set to `approved` or `verified`;',
    '- allowed `risk` and `allowedUse` values;',
    '- exact UTC ISO `verifiedAt` and future `expiresAt` timestamps with milliseconds;',
    '- no placeholder notes, PII, prompt-injection text, redaction tokens, spreadsheet formulas, duplicate question IDs, or oversized fields.',
    '',
    'Validate locally with:',
    '',
    '```bash',
    'corepack pnpm --filter @vas/api own-kb:authoring-validate -- --input scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-source-authoring.csv --output scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-sources.json --report-output scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-authoring-validation-report.json',
    '```',
    '',
    'Create a sanitized row/action gap report with:',
    '',
    '```bash',
    'corepack pnpm --filter @vas/api own-kb:authoring-gaps -- --input scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-source-authoring.csv --output scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-authoring-gap-report.json',
    '```',
    '',
    'The gap report intentionally omits raw transcript text and redacted question text; use row numbers and hashes to coordinate local authoring.',
    '',
    'Create a simulation/enrichment pack with transcript-derived intent hypotheses, evidence checklists, and synthetic everyday-call scenarios:',
    '',
    '```bash',
    'corepack pnpm --filter @vas/api own-kb:authoring-enrich -- --input scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-source-authoring.csv',
    '```',
    '',
    'The enrichment pack is `DRAFT_ONLY`, `syntheticOnly`, and not promotion evidence. It must not fill business facts, prices, opening hours, or source approval for you.',
    'It also writes source-requirements and fact-intake template CSV files so reviewed business facts can be supplied explicitly later.',
    'Validate a filled fact-intake template with:',
    '',
    '```bash',
    'corepack pnpm --filter @vas/api own-kb:fact-intake-validate -- --input scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-fact-intake-template.csv --source-requirements scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-source-requirements.csv --report-output scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-fact-intake-validation-report.json',
    '```',
    '',
    'The fact-intake validator is fail-closed and does not write Own-KB sources or create business facts.',
    '',
    'The validator defaults to `--min-rows 50`. Invalid runs fail closed and clear source output to `[]`.',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required');
  const args = parseArgs();
  const outputDir = path.resolve(args.outputDir);

  const rows = await pool.query<{ transcript: string }>(`
    select transcript
    from demo_calls
    where transcript is not null and length(transcript) > 0
    order by created_at desc
    limit $1
  `, [args.maxRows]);

  const questionsByHash = new Map<string, string>();
  let unsafeQuestionsSkipped = 0;
  for (const row of rows.rows) {
    for (const question of extractShadowQuestionsFromTranscript(row.transcript, 3)) {
      if (!isSafeTestTranscriptQuestion(question.query)) {
        unsafeQuestionsSkipped += 1;
        continue;
      }
      const key = hashTestTranscriptQuestion(question.query);
      if (!questionsByHash.has(key)) questionsByHash.set(key, question.query);
    }
  }

  const selected = Array.from(questionsByHash.entries())
    .slice(0, args.questionCount)
    .map(([hash, query], index) => ({
      questionId: testTranscriptQuestionId(index + 1, hash),
      questionFingerprint: testTranscriptQuestionFingerprint(hash),
      intent: testTranscriptIntentName(index + 1),
      redactedQuestion: query,
    }));
  if (selected.length < args.questionCount) {
    throw new Error('TEST_TRANSCRIPT_QUESTION_COVERAGE_BELOW_REQUESTED');
  }

  const generatedAt = args.generatedAt ?? canonicalUtcNow();
  const artifact = buildDraftBenchmarkArtifactTemplate({
    pairedQuestionCount: Math.max(50, args.questionCount),
    generatedAt,
  });
  artifact.containsPotentialPii = true;
  artifact.usesRealTranscripts = false;
  artifact.usesShadowData = false;
  artifact.usesCallLogs = true;
  artifact.notes = [
    'DRAFT_ONLY generated from user-confirmed test demo transcripts.',
    'Questions were extracted through the redacted shadow-question extractor; raw transcripts are not included.',
    'This pack is for QA preparation only and is not promotion evidence.',
  ].join(' ');

  for (let index = 0; index < selected.length; index += 1) {
    const question = selected[index];
    if (!question) continue;
    const oldQuestionId = `TODO_q${index + 1}`;
    for (const sample of artifact.samples) {
      if (sample.questionId === oldQuestionId) {
        sample.questionId = question.questionId;
        sample.questionFingerprint = question.questionFingerprint;
        sample.intent = question.intent;
      }
    }
  }

  const gapReport = buildBenchmarkArtifactGapReport({
    artifact,
    safetyGates: completeNoRolloutSafetyGates,
    generatedAt,
  });
  const sourceAuthoringCsv = [
    [
      'questionId',
      'redactedQuestion',
      'proposedAnswer',
      'sourceTitle',
      'risk',
      'allowedUse',
      'reviewStatus',
      'verifiedAt',
      'expiresAt',
      'notes',
    ].map(csvValue).join(','),
    ...selected.map((item) => [
      item.questionId,
      item.redactedQuestion,
      '',
      '',
      'low',
      'voice_agent',
      'draft',
      generatedAt,
      addDaysIso(generatedAt, 30),
      'Fill answer from approved/current business source before ingesting into Own-KB.',
    ].map(csvValue).join(',')),
  ].join('\n') + '\n';

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, 'test-transcript-0.5b-draft.json'),
    `${JSON.stringify(artifact, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(outputDir, 'test-transcript-0.5b-labeling.csv'),
    buildBenchmarkLabelingCsv(artifact.samples),
    'utf8',
  );
  await writeFile(
    path.join(outputDir, 'test-transcript-redacted-question-bank.csv'),
    [
      'questionId,redactedQuestion',
      ...selected.map((item) => `${csvValue(item.questionId)},${csvValue(item.redactedQuestion)}`),
    ].join('\n') + '\n',
    'utf8',
  );
  await writeFile(
    path.join(outputDir, 'test-transcript-own-kb-source-authoring.csv'),
    sourceAuthoringCsv,
    'utf8',
  );
  await writeFile(
    path.join(outputDir, 'test-transcript-0.5b-gap-report.json'),
    `${JSON.stringify(gapReport, null, 2)}\n`,
    'utf8',
  );
  await writeFile(path.join(outputDir, 'README.md'), readmeText(), 'utf8');

  process.stdout.write(`${JSON.stringify({
    kind: 'test_transcript_0_5b_draft_pack',
    outputDirectoryWritten: true,
    filesWritten: [
      'test-transcript-0.5b-draft.json',
      'test-transcript-0.5b-labeling.csv',
      'test-transcript-redacted-question-bank.csv',
      'test-transcript-own-kb-source-authoring.csv',
      'test-transcript-0.5b-gap-report.json',
      'README.md',
    ],
    sourceRows: rows.rows.length,
    unsafeQuestionsSkipped,
    uniqueRedactedQuestions: questionsByHash.size,
    selectedQuestions: selected.length,
    promotionEvidenceUsable: false,
    artifactStatus: artifact.approvedForMilestone,
  }, null, 2)}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Unknown test transcript benchmark pack error'}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end().catch(() => {});
  });
