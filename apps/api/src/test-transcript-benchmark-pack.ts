import crypto from 'node:crypto';

import { redactForEval } from './pii.js';

export type TestTranscriptQuestionSafetyIssue =
  | 'QUESTION_EMPTY'
  | 'QUESTION_TOO_LONG'
  | 'QUESTION_PII_DETECTED'
  | 'QUESTION_PROMPT_INJECTION_DETECTED'
  | 'QUESTION_REDACTION_TOKEN_PRESENT'
  | 'QUESTION_CSV_FORMULA_DETECTED';

const QUESTION_FIELD_LIMIT = 600;
const PROMPT_INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?previous\s+instructions\b/i,
  /\bdisregard\s+(?:all\s+)?previous\s+instructions\b/i,
  /\breveal\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|message|instructions)\b/i,
  /\bsystem\s+prompt\b/i,
  /\bdeveloper\s+message\b/i,
  /\btool\s*policy\s*override\b/i,
  /\bcross[-\s]?tenant\b/i,
  /\btenant\s+isolation\b/i,
  /\bignoriere\s+(?:alle\s+)?(?:vorherigen|bisherigen)\s+anweisungen\b/i,
  /\bsystem(?:-| )?prompt\b/i,
  /\bentwickler(?:-| )?nachricht\b/i,
];
const REDACTION_TOKEN_PATTERN = /\[(?:PHONE|EMAIL|IBAN|CC|ADDRESS|DOB|REDACTED|PII)\]/i;

export function hashTestTranscriptQuestion(question: string): string {
  return crypto.createHash('sha256').update(question).digest('hex');
}

export function testTranscriptQuestionId(index: number, questionHash: string): string {
  return `test_transcript_q${String(index).padStart(2, '0')}_${questionHash.slice(0, 10)}`;
}

export function testTranscriptQuestionFingerprint(questionHash: string): string {
  return `test_transcript_fp_${questionHash}`;
}

export function testTranscriptIntentName(index: number): string {
  return `test_intent_${String(((index - 1) % 30) + 1).padStart(2, '0')}`;
}

export function addDaysIso(baseIso: string, days: number): string {
  const date = new Date(baseIso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function canonicalUtcTimestampArgValue(name: string, raw: string | null): string | null {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) {
    throw new Error(`${name.toUpperCase().replace(/^--/, '')}_MUST_BE_UTC_ISO_WITH_MILLISECONDS`);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== raw) {
    throw new Error(`${name.toUpperCase().replace(/^--/, '')}_MUST_BE_UTC_ISO_WITH_MILLISECONDS`);
  }
  return raw;
}

export function csvValue(value: unknown): string {
  if (value == null) return '';
  const raw = String(value);
  const formulaSafe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(formulaSafe)) return `"${formulaSafe.replace(/"/g, '""')}"`;
  return formulaSafe;
}

export function testTranscriptQuestionSafetyIssues(question: string): TestTranscriptQuestionSafetyIssue[] {
  const issues: TestTranscriptQuestionSafetyIssue[] = [];
  const normalized = question.replace(/\s+/g, ' ').trim();
  if (!normalized) issues.push('QUESTION_EMPTY');
  if (normalized.length > QUESTION_FIELD_LIMIT) issues.push('QUESTION_TOO_LONG');
  if (normalized && redactForEval(normalized) !== normalized) issues.push('QUESTION_PII_DETECTED');
  if (PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    issues.push('QUESTION_PROMPT_INJECTION_DETECTED');
  }
  if (REDACTION_TOKEN_PATTERN.test(normalized)) issues.push('QUESTION_REDACTION_TOKEN_PRESENT');
  if (/^'?[=+\-@]/.test(normalized.trimStart())) issues.push('QUESTION_CSV_FORMULA_DETECTED');
  return [...new Set(issues)];
}

export function isSafeTestTranscriptQuestion(question: string): boolean {
  return testTranscriptQuestionSafetyIssues(question).length === 0;
}
