export type BehaviorEvalDomain = 'demo' | 'inbound' | 'outbound' | 'agent_builder' | 'stt' | 'rag';

export type BehaviorToolCall = {
  name: string;
  arguments?: unknown;
};

export type BehaviorModelOutput = {
  text: string;
  toolCalls?: BehaviorToolCall[];
  latencyMs?: number;
  knowledgeLatencyMs?: number;
  taskScore?: number;
  wer?: number;
};

export type BehaviorEvalCase = {
  id: string;
  domain: BehaviorEvalDomain | string;
  industry?: string | null;
  language: string;
  scenario: string;
  input: {
    transcript: string;
    audioRef?: string | null;
    knowledgeRefs?: string[];
    toolState?: Record<string, unknown>;
    [key: string]: unknown;
  };
  expected: {
    mustSay?: string[];
    mustNotSay?: string[];
    allowedTools?: string[];
    requiredTools?: string[];
    requiredToolSequence?: string[];
    forbiddenTools?: string[];
    dataToConfirm?: string[];
    successCriteria?: string[];
    [key: string]: unknown;
  };
  riskTags: string[];
  metrics?: {
    maxE2eLatencyMs?: number;
    maxKbLatencyMs?: number;
    minTaskScore?: number;
    maxWer?: number;
    [key: string]: unknown;
  };
};

export type BehaviorModelInput = {
  case: BehaviorEvalCase;
  systemPrompt?: string;
  knowledgeSnippets: Array<{ id: string; text: string }>;
};

export type BehaviorModel = (input: BehaviorModelInput) => Promise<BehaviorModelOutput> | BehaviorModelOutput;

export type BehaviorViolationKind =
  | 'must_say_missing'
  | 'must_not_say_hit'
  | 'required_tool_missing'
  | 'required_tool_sequence_missing'
  | 'forbidden_tool_called'
  | 'unexpected_tool_called'
  | 'spoken_tool_name'
  | 'latency_over_budget'
  | 'knowledge_latency_over_budget'
  | 'task_score_too_low'
  | 'wer_over_budget'
  | 'metric_missing'
  | 'knowledge_ref_missing'
  | 'data_confirmation_missing'
  | 'success_criteria_unverified';

export type BehaviorViolation = {
  kind: BehaviorViolationKind;
  expected: string;
  actual?: string;
};

export type BehaviorCaseResult = {
  caseId: string;
  passed: boolean;
  output: BehaviorModelOutput;
  violations: BehaviorViolation[];
};

export type BehaviorEvalReport = {
  total: number;
  passed: number;
  failed: number;
  failures: BehaviorCaseResult[];
  results: BehaviorCaseResult[];
};

const ALWAYS_INTERNAL_TOOL_NAMES = [
  'calendar.book',
  'calendar.findSlots',
  'calendar.findBookings',
  'calendar.cancel',
  'calendar.reschedule',
  'calendar_book',
  'calendar_find_slots',
  'calendar_find_bookings',
  'calendar_cancel',
  'calendar_reschedule',
  'ticket.create',
  'ticket_create',
  'customer.lookup',
  'customer.upsert',
  'customer_lookup',
  'customer_upsert',
  'recording_declined',
  'end_call',
  'transfer_call',
];

function toolNameSpoken(text: string, toolName: string): boolean {
  const normalized = normalizeText(text);
  const canonical = normalizeText(toolName);
  if (containsExpected(normalized, canonical)) return true;
  const parts = canonical.split(/[._\s-]+/).filter(Boolean);
  if (parts.length <= 1) return false;
  const pattern = new RegExp(`\\b${parts.map(escapeRegex).join('[\\s._-]+')}\\b`, 'i');
  return pattern.test(normalized);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripCommonGermanSuffix(value: string): string {
  if (value.length <= 4 || value.includes(' ')) return value;
  return value.replace(/(er|en|em|es|e|s)$/i, '');
}

function containsExpected(haystack: string, needle: string): boolean {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle) return true;
  if (normalizedHaystack.includes(normalizedNeedle)) return true;

  const stem = stripCommonGermanSuffix(normalizedNeedle);
  if (stem !== normalizedNeedle && stem.length >= 4) {
    return new RegExp(`\\b${escapeRegex(stem)}\\w*`, 'i').test(normalizedHaystack);
  }
  return false;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueToolNames(output: BehaviorModelOutput): string[] {
  return [...new Set((output.toolCalls ?? []).map((tool) => normalizeToolName(tool.name)).filter(Boolean))];
}

function normalizeToolName(name: string): string {
  const normalized = name.trim().replace(/\./g, '_');
  if (/^transfer_/.test(normalized)) return 'transfer_call';
  return normalized;
}

const TERMINAL_TOOLS = new Set(['end_call', 'transfer_call']);

function hasToolSequence(actual: string[], expected: string[]): boolean {
  if (!expected.length) return true;
  for (let start = 0; start <= actual.length - expected.length; start += 1) {
    const matches = expected.every((toolName, offset) => actual[start + offset] === toolName);
    if (!matches) continue;
    const terminalBeforeSequence = actual.slice(0, start).some((toolName) => TERMINAL_TOOLS.has(toolName));
    return !terminalBeforeSequence;
  }
  return false;
}

export function judgeBehaviorCase(testCase: BehaviorEvalCase, output: BehaviorModelOutput): BehaviorCaseResult {
  const violations: BehaviorViolation[] = [];
  const text = output.text ?? '';
  const calledTools = uniqueToolNames(output);
  const calledToolSequence = (output.toolCalls ?? []).map((tool) => normalizeToolName(tool.name)).filter(Boolean);
  const requiredTools = (testCase.expected.requiredTools ?? []).map(normalizeToolName);
  const requiredToolSequence = (testCase.expected.requiredToolSequence ?? []).map(normalizeToolName);
  const allowedTools = (testCase.expected.allowedTools ?? [...new Set([...requiredTools, ...requiredToolSequence])]).map(normalizeToolName);
  const forbiddenTools = new Set((testCase.expected.forbiddenTools ?? []).map(normalizeToolName));

  for (const expectedText of testCase.expected.mustSay ?? []) {
    if (!containsExpected(text, expectedText)) {
      violations.push({ kind: 'must_say_missing', expected: expectedText, actual: text });
    }
  }

  for (const forbiddenText of testCase.expected.mustNotSay ?? []) {
    if (containsExpected(text, forbiddenText)) {
      violations.push({ kind: 'must_not_say_hit', expected: forbiddenText, actual: text });
    }
  }

  for (const requiredTool of requiredTools) {
    if (!calledTools.includes(requiredTool)) {
      violations.push({ kind: 'required_tool_missing', expected: requiredTool, actual: calledToolSequence.join(', ') || 'no tool call' });
    }
  }

  if (requiredToolSequence.length && !hasToolSequence(calledToolSequence, requiredToolSequence)) {
    violations.push({
      kind: 'required_tool_sequence_missing',
      expected: requiredToolSequence.join(' -> '),
      actual: calledToolSequence.join(' -> ') || 'no tool call',
    });
  }

  for (const toolName of calledTools) {
    if (forbiddenTools.has(toolName)) {
      violations.push({ kind: 'forbidden_tool_called', expected: toolName, actual: toolName });
    }
    if (!allowedTools.includes(toolName)) {
      violations.push({ kind: 'unexpected_tool_called', expected: allowedTools.join(', ') || 'no tool call', actual: toolName });
    }
  }

  for (const toolName of ALWAYS_INTERNAL_TOOL_NAMES) {
    if (toolNameSpoken(text, toolName)) {
      violations.push({ kind: 'spoken_tool_name', expected: `do not speak ${toolName}`, actual: text });
    }
  }
  if (/\btransfer[\s._-]+[a-z0-9_+.-]{4,}\b/i.test(normalizeText(text))) {
    violations.push({ kind: 'spoken_tool_name', expected: 'do not speak transfer_<number>', actual: text });
  }

  for (const requiredConfirmation of testCase.expected.dataToConfirm ?? []) {
    if (!containsExpected(text, requiredConfirmation)) {
      violations.push({ kind: 'data_confirmation_missing', expected: requiredConfirmation, actual: text });
    }
  }

  if ((testCase.expected.successCriteria?.length ?? 0) > 0 && output.taskScore == null) {
    violations.push({
      kind: 'success_criteria_unverified',
      expected: (testCase.expected.successCriteria ?? []).join('; '),
      actual: 'missing taskScore for declared successCriteria',
    });
  }

  if (testCase.metrics?.maxE2eLatencyMs != null && output.latencyMs == null) {
    violations.push({
      kind: 'metric_missing',
      expected: `latencyMs <= ${testCase.metrics.maxE2eLatencyMs}ms`,
      actual: 'missing latencyMs',
    });
  } else if (testCase.metrics?.maxE2eLatencyMs != null && output.latencyMs != null && output.latencyMs > testCase.metrics.maxE2eLatencyMs) {
    violations.push({
      kind: 'latency_over_budget',
      expected: `<= ${testCase.metrics.maxE2eLatencyMs}ms`,
      actual: `${output.latencyMs}ms`,
    });
  }

  if (
    testCase.metrics?.maxKbLatencyMs != null &&
    output.knowledgeLatencyMs == null
  ) {
    violations.push({
      kind: 'metric_missing',
      expected: `knowledgeLatencyMs <= ${testCase.metrics.maxKbLatencyMs}ms`,
      actual: 'missing knowledgeLatencyMs',
    });
  } else if (
    testCase.metrics?.maxKbLatencyMs != null &&
    output.knowledgeLatencyMs != null &&
    output.knowledgeLatencyMs > testCase.metrics.maxKbLatencyMs
  ) {
    violations.push({
      kind: 'knowledge_latency_over_budget',
      expected: `<= ${testCase.metrics.maxKbLatencyMs}ms`,
      actual: `${output.knowledgeLatencyMs}ms`,
    });
  }

  if (testCase.metrics?.minTaskScore != null && output.taskScore == null) {
    violations.push({
      kind: 'metric_missing',
      expected: `taskScore >= ${testCase.metrics.minTaskScore}`,
      actual: 'missing taskScore',
    });
  } else if (testCase.metrics?.minTaskScore != null && output.taskScore != null && output.taskScore < testCase.metrics.minTaskScore) {
    violations.push({
      kind: 'task_score_too_low',
      expected: `>= ${testCase.metrics.minTaskScore}`,
      actual: String(output.taskScore),
    });
  }

  if (testCase.metrics?.maxWer != null && output.wer == null) {
    violations.push({
      kind: 'metric_missing',
      expected: `wer <= ${testCase.metrics.maxWer}`,
      actual: 'missing wer',
    });
  } else if (testCase.metrics?.maxWer != null && output.wer != null && output.wer > testCase.metrics.maxWer) {
    violations.push({
      kind: 'wer_over_budget',
      expected: `<= ${testCase.metrics.maxWer}`,
      actual: String(output.wer),
    });
  }

  return {
    caseId: testCase.id,
    passed: violations.length === 0,
    output,
    violations,
  };
}

export async function evaluateBehaviorCases(args: {
  cases: BehaviorEvalCase[];
  model: BehaviorModel;
  systemPrompt?: string;
  knowledgeSnippets?: Record<string, string>;
}): Promise<BehaviorEvalReport> {
  const results: BehaviorCaseResult[] = [];

  for (const testCase of args.cases) {
    const missingKnowledgeRefs = (testCase.input.knowledgeRefs ?? [])
      .filter((id) => !(args.knowledgeSnippets?.[id]?.trim()));
    if (missingKnowledgeRefs.length) {
      results.push({
        caseId: testCase.id,
        passed: false,
        output: { text: '', toolCalls: [] },
        violations: missingKnowledgeRefs.map((id) => ({
          kind: 'knowledge_ref_missing',
          expected: id,
          actual: 'missing or empty knowledge snippet',
        })),
      });
      continue;
    }
    const knowledgeSnippets = (testCase.input.knowledgeRefs ?? []).map((id) => ({
      id,
      text: args.knowledgeSnippets?.[id] ?? '',
    }));
    const output = await args.model({
      case: testCase,
      systemPrompt: args.systemPrompt,
      knowledgeSnippets,
    });
    results.push(judgeBehaviorCase(testCase, output));
  }

  const failures = results.filter((result) => !result.passed);
  return {
    total: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    failures,
    results,
  };
}

function isBehaviorEvalCase(value: unknown): value is BehaviorEvalCase {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<BehaviorEvalCase>;
  return (
    typeof item.id === 'string' &&
    typeof item.domain === 'string' &&
    typeof item.language === 'string' &&
    typeof item.scenario === 'string' &&
    !!item.input &&
    typeof item.input === 'object' &&
    typeof item.input.transcript === 'string' &&
    !!item.expected &&
    typeof item.expected === 'object' &&
    Array.isArray(item.riskTags)
  );
}

export function parseBehaviorEvalJsonl(jsonl: string): BehaviorEvalCase[] {
  return jsonl
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`BEHAVIOR_EVAL_JSONL_PARSE_ERROR line ${index + 1}: ${message}`);
      }
      if (!isBehaviorEvalCase(parsed)) {
        throw new Error(`BEHAVIOR_EVAL_JSONL_INVALID_CASE line ${index + 1}`);
      }
      return parsed;
    });
}
