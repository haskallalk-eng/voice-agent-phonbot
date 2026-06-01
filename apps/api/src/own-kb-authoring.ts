import crypto from 'node:crypto';

import type { KnowledgeSource } from './knowledge.js';
import { redactForEval } from './pii.js';

export type OwnKbAuthoringRow = {
  questionId: string;
  redactedQuestion: string;
  proposedAnswer: string;
  sourceTitle: string;
  risk: string;
  allowedUse: string;
  reviewStatus: string;
  verifiedAt: string;
  expiresAt: string;
  notes: string;
};

export type OwnKbAuthoringValidationIssue =
  | 'ANSWER_REQUIRED'
  | 'ANSWER_TOO_SHORT'
  | 'SOURCE_TITLE_REQUIRED'
  | 'REVIEW_STATUS_NOT_APPROVED'
  | 'RISK_NOT_ALLOWED'
  | 'ALLOWED_USE_NOT_ALLOWED'
  | 'VERIFIED_AT_INVALID'
  | 'EXPIRES_AT_INVALID'
  | 'EXPIRES_AT_NOT_FUTURE'
  | 'QUESTION_ID_REQUIRED'
  | 'REDACTED_QUESTION_REQUIRED'
  | 'PII_DETECTED'
  | 'PROMPT_INJECTION_DETECTED'
  | 'DUPLICATE_QUESTION_ID'
  | 'AUTHORING_ROWS_REQUIRED'
  | 'QUESTION_ID_TOO_LONG'
  | 'REDACTED_QUESTION_TOO_LONG'
  | 'ANSWER_TOO_LONG'
  | 'SOURCE_TITLE_TOO_LONG'
  | 'NOTES_TOO_LONG'
  | 'CSV_HEADER_REQUIRED'
  | 'CSV_DUPLICATE_COLUMNS'
  | 'CSV_REQUIRED_COLUMNS_MISSING'
  | 'CSV_UNKNOWN_COLUMNS'
  | 'CSV_ROW_COLUMN_COUNT_MISMATCH'
  | 'CSV_MALFORMED_QUOTES'
  | 'PLACEHOLDER_CONTENT'
  | 'ANSWER_EQUALS_QUESTION'
  | 'CSV_FORMULA_INJECTION_DETECTED'
  | 'AUTHORING_ROW_COVERAGE_BELOW_MINIMUM'
  | 'REDACTION_TOKEN_IN_SOURCE_CONTENT'
  | 'VERIFIED_AT_IN_FUTURE'
  | 'EXPIRES_AT_NOT_AFTER_VERIFIED_AT'
  | 'AUTHORING_SOURCE_GENERATION_DISABLED';

export type OwnKbAuthoringValidationReport = {
  kind: 'own_kb_authoring_validation';
  rows: number;
  validRows: number;
  invalidRows: number;
  issueCounts: Record<string, number>;
  sourceGenerationReady: false;
  sourceGenerationBlockers: OwnKbAuthoringValidationIssue[];
  sourcesWritten: boolean;
  outputCleared?: boolean;
  minRowsRequired?: number;
  promotionEvidenceUsable: false;
};

export type OwnKbAuthoringGapCode =
  | 'PROVIDE_EVIDENCE_BACKED_ANSWER'
  | 'PROVIDE_SOURCE_TITLE'
  | 'SET_REVIEW_STATUS_APPROVED_OR_VERIFIED'
  | 'FIX_RISK_OR_ALLOWED_USE'
  | 'SET_CANONICAL_FRESHNESS'
  | 'REMOVE_UNSAFE_CONTENT'
  | 'REMOVE_PLACEHOLDER_CONTENT'
  | 'FIX_CSV_STRUCTURE'
  | 'MEET_MINIMUM_ROW_COVERAGE'
  | 'RESOLVE_DUPLICATE_QUESTION_ID'
  | 'TRIM_OVERSIZED_FIELD'
  | 'FIX_REQUIRED_IDENTIFIERS';

export type OwnKbAuthoringGapReport = {
  kind: 'own_kb_authoring_gap_report';
  rows: number;
  validRows: number;
  invalidRows: number;
  minRowsRequired?: number;
  issueCounts: Record<string, number>;
  gapCounts: Record<string, number>;
  rowGaps: {
    rowNumber: number | null;
    questionIdHash: string;
    issues: OwnKbAuthoringValidationIssue[];
    gaps: OwnKbAuthoringGapCode[];
  }[];
  nextActions: string[];
  containsCallerContent: false;
  exportsRedactedQuestions: false;
  sourcesWritten: false;
  promotionEvidenceUsable: false;
};

export const OWN_KB_AUTHORING_ALLOWED_REVIEW_STATUSES = new Set(['approved']);
export const OWN_KB_AUTHORING_ALLOWED_RISKS = new Set(['low', 'medium']);
export const OWN_KB_AUTHORING_ALLOWED_USES = new Set(['agent_facts', 'customer_faq', 'voice_agent', 'public_faq']);

export const OWN_KB_AUTHORING_FIELD_LIMITS = {
  questionId: 160,
  redactedQuestion: 600,
  proposedAnswer: 2_000,
  sourceTitle: 180,
  notes: 800,
} as const;

export const OWN_KB_AUTHORING_REQUIRED_COLUMNS = [
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
] as const;

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

const PLACEHOLDER_PATTERNS = [
  /\b(todo|tbd|platzhalter|placeholder|fill me|fill answer|fill source|to fill|noch ausfuellen|noch ausfüllen|bitte ausfuellen|bitte ausfüllen)\b/i,
  /^\s*(n\/a|na|none|null|-|—)\s*$/i,
];

const REDACTION_TOKEN_PATTERN = /\[(?:PHONE|EMAIL|IBAN|CC|ADDRESS|DOB|REDACTED|PII)\]/i;

function parseCsvWithStatus(csv: string): { rows: string[][]; malformedQuotes: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return { rows, malformedQuotes: inQuotes };
}

function parseCsv(csv: string): string[][] {
  return parseCsvWithStatus(csv).rows;
}

function nonEmptyCsvRows(csv: string): { rows: string[][]; malformedQuotes: boolean } {
  const parsed = parseCsvWithStatus(csv);
  return {
    rows: parsed.rows.filter((row) => row.some((cell) => cell.trim())),
    malformedQuotes: parsed.malformedQuotes,
  };
}

function compact(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function parseOwnKbAuthoringCsv(csv: string): OwnKbAuthoringRow[] {
  const [headerRow, ...dataRows] = nonEmptyCsvRows(csv).rows;
  if (!headerRow) return [];
  const headers = headerRow.map((cell) => cell.trim());
  return dataRows.map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = compact(row[index] ?? '');
    });
    return {
      questionId: record.questionId ?? '',
      redactedQuestion: record.redactedQuestion ?? '',
      proposedAnswer: record.proposedAnswer ?? '',
      sourceTitle: record.sourceTitle ?? '',
      risk: record.risk ?? '',
      allowedUse: record.allowedUse ?? '',
      reviewStatus: record.reviewStatus ?? '',
      verifiedAt: record.verifiedAt ?? '',
      expiresAt: record.expiresAt ?? '',
      notes: record.notes ?? '',
    };
  });
}

export function validateOwnKbAuthoringCsvHeaders(csv: string): OwnKbAuthoringValidationIssue[] {
  const parsed = nonEmptyCsvRows(csv);
  if (parsed.malformedQuotes) return ['CSV_MALFORMED_QUOTES'];
  const [headerRow] = parsed.rows;
  if (!headerRow) return ['CSV_HEADER_REQUIRED'];
  const headers = headerRow.map((cell) => cell.trim());
  const duplicateColumns = headers.some((header, index) => headers.indexOf(header) !== index);
  const missing = OWN_KB_AUTHORING_REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  const unknown = headers.filter((header) => !OWN_KB_AUTHORING_REQUIRED_COLUMNS.includes(header as typeof OWN_KB_AUTHORING_REQUIRED_COLUMNS[number]));
  return [
    ...(duplicateColumns ? ['CSV_DUPLICATE_COLUMNS' as const] : []),
    ...(missing.length > 0 ? ['CSV_REQUIRED_COLUMNS_MISSING' as const] : []),
    ...(unknown.length > 0 ? ['CSV_UNKNOWN_COLUMNS' as const] : []),
  ];
}

function validDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString() !== value ? null : date;
}

function containsPii(value: string): boolean {
  return Boolean(value) && redactForEval(value) !== value;
}

function containsPromptInjection(value: string): boolean {
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(value));
}

function containsPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function startsWithSpreadsheetFormula(value: string): boolean {
  return /^'?[=+\-@]/.test(value.trimStart());
}

export function validateOwnKbAuthoringRow(
  row: OwnKbAuthoringRow,
  now = new Date(),
): OwnKbAuthoringValidationIssue[] {
  const issues: OwnKbAuthoringValidationIssue[] = [];
  if (!row.questionId) issues.push('QUESTION_ID_REQUIRED');
  if (!row.redactedQuestion) issues.push('REDACTED_QUESTION_REQUIRED');
  if (!row.proposedAnswer) issues.push('ANSWER_REQUIRED');
  else if (row.proposedAnswer.length < 20) issues.push('ANSWER_TOO_SHORT');
  if (!row.sourceTitle) issues.push('SOURCE_TITLE_REQUIRED');
  if (row.questionId.length > OWN_KB_AUTHORING_FIELD_LIMITS.questionId) issues.push('QUESTION_ID_TOO_LONG');
  if (row.redactedQuestion.length > OWN_KB_AUTHORING_FIELD_LIMITS.redactedQuestion) {
    issues.push('REDACTED_QUESTION_TOO_LONG');
  }
  if (row.proposedAnswer.length > OWN_KB_AUTHORING_FIELD_LIMITS.proposedAnswer) issues.push('ANSWER_TOO_LONG');
  if (row.sourceTitle.length > OWN_KB_AUTHORING_FIELD_LIMITS.sourceTitle) issues.push('SOURCE_TITLE_TOO_LONG');
  if (row.notes.length > OWN_KB_AUTHORING_FIELD_LIMITS.notes) issues.push('NOTES_TOO_LONG');
  if (!OWN_KB_AUTHORING_ALLOWED_REVIEW_STATUSES.has(row.reviewStatus.toLowerCase())) {
    issues.push('REVIEW_STATUS_NOT_APPROVED');
  }
  if (!OWN_KB_AUTHORING_ALLOWED_RISKS.has(row.risk.toLowerCase())) issues.push('RISK_NOT_ALLOWED');
  if (!OWN_KB_AUTHORING_ALLOWED_USES.has(row.allowedUse.toLowerCase())) issues.push('ALLOWED_USE_NOT_ALLOWED');
  const verifiedAt = validDate(row.verifiedAt);
  if (!verifiedAt) issues.push('VERIFIED_AT_INVALID');
  else if (verifiedAt.getTime() > now.getTime()) issues.push('VERIFIED_AT_IN_FUTURE');
  const expiresAt = validDate(row.expiresAt);
  if (!expiresAt) issues.push('EXPIRES_AT_INVALID');
  else {
    if (expiresAt.getTime() <= now.getTime()) issues.push('EXPIRES_AT_NOT_FUTURE');
    if (verifiedAt && expiresAt.getTime() <= verifiedAt.getTime()) issues.push('EXPIRES_AT_NOT_AFTER_VERIFIED_AT');
  }
  const sourceText = [row.redactedQuestion, row.proposedAnswer, row.sourceTitle, row.notes].join('\n');
  if (containsPii(sourceText)) issues.push('PII_DETECTED');
  if (containsPromptInjection(sourceText)) issues.push('PROMPT_INJECTION_DETECTED');
  if ([row.proposedAnswer, row.sourceTitle, row.notes].some(containsPlaceholder)) issues.push('PLACEHOLDER_CONTENT');
  if (
    row.redactedQuestion
    && row.proposedAnswer
    && row.redactedQuestion.toLowerCase() === row.proposedAnswer.toLowerCase()
  ) {
    issues.push('ANSWER_EQUALS_QUESTION');
  }
  if ([row.redactedQuestion, row.proposedAnswer, row.sourceTitle, row.notes].some(startsWithSpreadsheetFormula)) {
    issues.push('CSV_FORMULA_INJECTION_DETECTED');
  }
  if ([row.redactedQuestion, row.proposedAnswer, row.sourceTitle, row.notes].some((value) => REDACTION_TOKEN_PATTERN.test(value))) {
    issues.push('REDACTION_TOKEN_IN_SOURCE_CONTENT');
  }
  return issues;
}

export function hashOwnKbAuthoringId(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function validateOwnKbAuthoringRows(rows: OwnKbAuthoringRow[], now = new Date(), options: {
  minRows?: number;
} = {}): {
  report: OwnKbAuthoringValidationReport;
  rowReports: { questionIdHash: string; issues: OwnKbAuthoringValidationIssue[] }[];
  validRows: OwnKbAuthoringRow[];
} {
  const minRows = Math.max(0, options.minRows ?? 0);
  if (rows.length === 0) {
    return {
      report: {
        kind: 'own_kb_authoring_validation',
        rows: 0,
        validRows: 0,
        invalidRows: 1,
        issueCounts: { AUTHORING_ROWS_REQUIRED: 1 },
        sourceGenerationReady: false,
        sourceGenerationBlockers: ['AUTHORING_SOURCE_GENERATION_DISABLED', 'AUTHORING_ROWS_REQUIRED'],
        sourcesWritten: false,
        minRowsRequired: minRows || undefined,
        promotionEvidenceUsable: false,
      },
      rowReports: [{ questionIdHash: hashOwnKbAuthoringId('missing_authoring_rows'), issues: ['AUTHORING_ROWS_REQUIRED'] }],
      validRows: [],
    };
  }

  const questionIdCounts = rows.reduce<Record<string, number>>((acc, row) => {
    const key = row.questionId.trim();
    if (key) acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const rowReports = rows.map((row) => ({
    questionIdHash: hashOwnKbAuthoringId(row.questionId),
    issues: [
      ...validateOwnKbAuthoringRow(row, now),
      ...((questionIdCounts[row.questionId.trim()] ?? 0) > 1
        ? ['DUPLICATE_QUESTION_ID' as const]
      : []),
    ],
  }));
  const batchIssues: OwnKbAuthoringValidationIssue[] = [];
  if (minRows > 0 && rows.length < minRows) {
    batchIssues.push('AUTHORING_ROW_COVERAGE_BELOW_MINIMUM');
    rowReports.push({
      questionIdHash: hashOwnKbAuthoringId('authoring_row_coverage_below_minimum'),
      issues: ['AUTHORING_ROW_COVERAGE_BELOW_MINIMUM'],
    });
  }
  const validRows = rows.filter((row) => {
    const key = row.questionId.trim();
    return validateOwnKbAuthoringRow(row, now).length === 0 && (!key || (questionIdCounts[key] ?? 0) === 1);
  });
  const issueCounts = rowReports
    .flatMap((row) => row.issues)
    .reduce<Record<string, number>>((acc, issue) => {
      acc[issue] = (acc[issue] ?? 0) + 1;
      return acc;
    }, {});

  return {
    report: {
      kind: 'own_kb_authoring_validation',
      rows: rows.length,
      validRows: validRows.length,
      invalidRows: rows.length - validRows.length + batchIssues.length,
      issueCounts,
      sourceGenerationReady: false,
      sourceGenerationBlockers: ['AUTHORING_SOURCE_GENERATION_DISABLED'],
      sourcesWritten: false,
      minRowsRequired: minRows || undefined,
      promotionEvidenceUsable: false,
    },
    rowReports,
    validRows,
  };
}

export function validateOwnKbAuthoringCsv(csv: string, now = new Date(), options: {
  minRows?: number;
} = {}): {
  report: OwnKbAuthoringValidationReport;
  rowReports: { questionIdHash: string; issues: OwnKbAuthoringValidationIssue[] }[];
  validRows: OwnKbAuthoringRow[];
} {
  const headerIssues = validateOwnKbAuthoringCsvHeaders(csv);
  if (headerIssues.length > 0) {
    const issueCounts = headerIssues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue] = (acc[issue] ?? 0) + 1;
      return acc;
    }, {});
    return {
      report: {
        kind: 'own_kb_authoring_validation',
        rows: 0,
        validRows: 0,
        invalidRows: 1,
        issueCounts,
        sourceGenerationReady: false,
        sourceGenerationBlockers: ['AUTHORING_SOURCE_GENERATION_DISABLED', ...headerIssues],
        sourcesWritten: false,
        minRowsRequired: options.minRows || undefined,
        promotionEvidenceUsable: false,
      },
      rowReports: [{ questionIdHash: hashOwnKbAuthoringId('invalid_authoring_header'), issues: headerIssues }],
      validRows: [],
    };
  }
  const [headerRow, ...dataRows] = nonEmptyCsvRows(csv).rows;
  const rowShapeIssues: OwnKbAuthoringValidationIssue[] = dataRows.some((row) => row.length !== headerRow!.length)
    ? ['CSV_ROW_COLUMN_COUNT_MISMATCH']
    : [];
  if (rowShapeIssues.length > 0) {
    return {
      report: {
        kind: 'own_kb_authoring_validation',
        rows: 0,
        validRows: 0,
        invalidRows: 1,
        issueCounts: { CSV_ROW_COLUMN_COUNT_MISMATCH: 1 },
        sourceGenerationReady: false,
        sourceGenerationBlockers: ['AUTHORING_SOURCE_GENERATION_DISABLED', 'CSV_ROW_COLUMN_COUNT_MISMATCH'],
        sourcesWritten: false,
        minRowsRequired: options.minRows || undefined,
        promotionEvidenceUsable: false,
      },
      rowReports: [{ questionIdHash: hashOwnKbAuthoringId('invalid_authoring_csv_structure'), issues: rowShapeIssues }],
      validRows: [],
    };
  }

  return validateOwnKbAuthoringRows(parseOwnKbAuthoringCsv(csv), now, options);
}

export function buildOwnKbSourcesFromAuthoringRows(rows: OwnKbAuthoringRow[], now = new Date(), options: {
  minRows?: number;
} = {}): {
  report: OwnKbAuthoringValidationReport;
  rowReports: { questionIdHash: string; issues: OwnKbAuthoringValidationIssue[] }[];
  sources: KnowledgeSource[];
} {
  const validation = validateOwnKbAuthoringRows(rows, now, options);
  return {
    report: validation.report,
    rowReports: validation.rowReports,
    sources: [],
  };
}

export function buildOwnKbSourcesFromAuthoringCsv(csv: string, now = new Date(), options: {
  minRows?: number;
} = {}): {
  report: OwnKbAuthoringValidationReport;
  rowReports: { questionIdHash: string; issues: OwnKbAuthoringValidationIssue[] }[];
  sources: KnowledgeSource[];
} {
  const validation = validateOwnKbAuthoringCsv(csv, now, options);
  return {
    report: validation.report,
    rowReports: validation.rowReports,
    sources: [],
  };
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function gapsForIssue(issue: OwnKbAuthoringValidationIssue): OwnKbAuthoringGapCode[] {
  switch (issue) {
    case 'ANSWER_REQUIRED':
    case 'ANSWER_TOO_SHORT':
    case 'ANSWER_EQUALS_QUESTION':
      return ['PROVIDE_EVIDENCE_BACKED_ANSWER'];
    case 'SOURCE_TITLE_REQUIRED':
      return ['PROVIDE_SOURCE_TITLE'];
    case 'REVIEW_STATUS_NOT_APPROVED':
      return ['SET_REVIEW_STATUS_APPROVED_OR_VERIFIED'];
    case 'RISK_NOT_ALLOWED':
    case 'ALLOWED_USE_NOT_ALLOWED':
      return ['FIX_RISK_OR_ALLOWED_USE'];
    case 'VERIFIED_AT_INVALID':
    case 'EXPIRES_AT_INVALID':
    case 'EXPIRES_AT_NOT_FUTURE':
    case 'VERIFIED_AT_IN_FUTURE':
    case 'EXPIRES_AT_NOT_AFTER_VERIFIED_AT':
      return ['SET_CANONICAL_FRESHNESS'];
    case 'PII_DETECTED':
    case 'PROMPT_INJECTION_DETECTED':
    case 'CSV_FORMULA_INJECTION_DETECTED':
    case 'REDACTION_TOKEN_IN_SOURCE_CONTENT':
      return ['REMOVE_UNSAFE_CONTENT'];
    case 'PLACEHOLDER_CONTENT':
      return ['REMOVE_PLACEHOLDER_CONTENT'];
    case 'CSV_HEADER_REQUIRED':
    case 'CSV_DUPLICATE_COLUMNS':
    case 'CSV_REQUIRED_COLUMNS_MISSING':
    case 'CSV_UNKNOWN_COLUMNS':
    case 'CSV_ROW_COLUMN_COUNT_MISMATCH':
    case 'CSV_MALFORMED_QUOTES':
      return ['FIX_CSV_STRUCTURE'];
    case 'AUTHORING_ROW_COVERAGE_BELOW_MINIMUM':
    case 'AUTHORING_ROWS_REQUIRED':
      return ['MEET_MINIMUM_ROW_COVERAGE'];
    case 'DUPLICATE_QUESTION_ID':
      return ['RESOLVE_DUPLICATE_QUESTION_ID'];
    case 'QUESTION_ID_TOO_LONG':
    case 'REDACTED_QUESTION_TOO_LONG':
    case 'ANSWER_TOO_LONG':
    case 'SOURCE_TITLE_TOO_LONG':
    case 'NOTES_TOO_LONG':
      return ['TRIM_OVERSIZED_FIELD'];
    case 'QUESTION_ID_REQUIRED':
    case 'REDACTED_QUESTION_REQUIRED':
      return ['FIX_REQUIRED_IDENTIFIERS'];
    case 'AUTHORING_SOURCE_GENERATION_DISABLED':
      return [];
    default: {
      const exhaustive: never = issue;
      return exhaustive;
    }
  }
}

function nextActionsForGaps(gapCounts: Record<string, number>): string[] {
  const actions: string[] = [];
  if (gapCounts.PROVIDE_EVIDENCE_BACKED_ANSWER) {
    actions.push('Fill `proposedAnswer` from approved/current business evidence for every listed row.');
  }
  if (gapCounts.PROVIDE_SOURCE_TITLE) {
    actions.push('Add a concrete `sourceTitle` that identifies the reviewed source/version for every answer.');
  }
  if (gapCounts.SET_REVIEW_STATUS_APPROVED_OR_VERIFIED) {
    actions.push('Set `reviewStatus` to `approved` only after human review.');
  }
  if (gapCounts.FIX_RISK_OR_ALLOWED_USE) {
    actions.push('Use allowed `risk` and `allowedUse` values before source generation.');
  }
  if (gapCounts.SET_CANONICAL_FRESHNESS) {
    actions.push('Set exact UTC ISO `verifiedAt` and future `expiresAt` timestamps with milliseconds.');
  }
  if (gapCounts.REMOVE_UNSAFE_CONTENT) {
    actions.push('Remove PII, prompt-injection text, redaction tokens, and spreadsheet formulas from authoring fields.');
  }
  if (gapCounts.REMOVE_PLACEHOLDER_CONTENT) {
    actions.push('Replace placeholder notes/titles/answers with reviewed content or blank safe notes.');
  }
  if (gapCounts.FIX_CSV_STRUCTURE) {
    actions.push('Fix the CSV header/row shape before reviewing row-level content.');
  }
  if (gapCounts.MEET_MINIMUM_ROW_COVERAGE) {
    actions.push('Provide the required minimum number of authoring rows before generating Own-KB sources.');
  }
  if (gapCounts.RESOLVE_DUPLICATE_QUESTION_ID) {
    actions.push('Resolve duplicate `questionId` rows so each question has exactly one reviewed answer.');
  }
  if (gapCounts.TRIM_OVERSIZED_FIELD) {
    actions.push('Trim oversized fields so generated KB chunks remain bounded for voice latency.');
  }
  if (gapCounts.FIX_REQUIRED_IDENTIFIERS) {
    actions.push('Restore required question identifiers and redacted question text in the local authoring CSV.');
  }
  if (actions.length === 0) {
    actions.push('Authoring rows pass structural validation; run source generation and continue the non-promotional 0.5B QA flow.');
  }
  return actions;
}

export function buildOwnKbAuthoringGapReportFromCsv(csv: string, now = new Date(), options: {
  minRows?: number;
} = {}): OwnKbAuthoringGapReport {
  const validation = validateOwnKbAuthoringCsv(csv, now, options);
  const rowGaps = validation.rowReports
    .map((rowReport, index) => {
      const gaps = unique(rowReport.issues.flatMap(gapsForIssue));
      return {
        rowNumber: index < validation.report.rows ? index + 2 : null,
        questionIdHash: rowReport.questionIdHash,
        issues: rowReport.issues,
        gaps,
      };
    })
    .filter((rowReport) => rowReport.issues.length > 0 || rowReport.gaps.length > 0);
  const gapCounts = rowGaps
    .flatMap((rowReport) => rowReport.gaps)
    .reduce<Record<string, number>>((acc, gap) => {
      acc[gap] = (acc[gap] ?? 0) + 1;
      return acc;
    }, {});

  return {
    kind: 'own_kb_authoring_gap_report',
    rows: validation.report.rows,
    validRows: validation.report.validRows,
    invalidRows: validation.report.invalidRows,
    minRowsRequired: validation.report.minRowsRequired,
    issueCounts: validation.report.issueCounts,
    gapCounts,
    rowGaps,
    nextActions: nextActionsForGaps(gapCounts),
    containsCallerContent: false,
    exportsRedactedQuestions: false,
    sourcesWritten: false,
    promotionEvidenceUsable: false,
  };
}
