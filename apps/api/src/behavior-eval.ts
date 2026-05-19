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
  | 'forbidden_tool_called'
  | 'unexpected_tool_called'
  | 'spoken_tool_name'
  | 'latency_over_budget'
  | 'knowledge_latency_over_budget'
  | 'task_score_too_low';

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
  'ticket.create',
  'customer.lookup',
  'customer.upsert',
  'recording_declined',
  'end_call',
  'transfer_call',
];

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
  return [...new Set((output.toolCalls ?? []).map((tool) => tool.name).filter(Boolean))];
}

export function judgeBehaviorCase(testCase: BehaviorEvalCase, output: BehaviorModelOutput): BehaviorCaseResult {
  const violations: BehaviorViolation[] = [];
  const text = output.text ?? '';
  const calledTools = uniqueToolNames(output);
  const allowedTools = testCase.expected.allowedTools ?? [];
  const forbiddenTools = new Set(testCase.expected.forbiddenTools ?? []);

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

  for (const toolName of calledTools) {
    if (forbiddenTools.has(toolName)) {
      violations.push({ kind: 'forbidden_tool_called', expected: toolName, actual: toolName });
    }
    if (!allowedTools.includes(toolName)) {
      violations.push({ kind: 'unexpected_tool_called', expected: allowedTools.join(', ') || 'no tool call', actual: toolName });
    }
  }

  for (const toolName of ALWAYS_INTERNAL_TOOL_NAMES) {
    if (containsExpected(text, toolName)) {
      violations.push({ kind: 'spoken_tool_name', expected: `do not speak ${toolName}`, actual: text });
    }
  }

  if (testCase.metrics?.maxE2eLatencyMs != null && output.latencyMs != null && output.latencyMs > testCase.metrics.maxE2eLatencyMs) {
    violations.push({
      kind: 'latency_over_budget',
      expected: `<= ${testCase.metrics.maxE2eLatencyMs}ms`,
      actual: `${output.latencyMs}ms`,
    });
  }

  if (
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

  if (testCase.metrics?.minTaskScore != null && output.taskScore != null && output.taskScore < testCase.metrics.minTaskScore) {
    violations.push({
      kind: 'task_score_too_low',
      expected: `>= ${testCase.metrics.minTaskScore}`,
      actual: String(output.taskScore),
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
