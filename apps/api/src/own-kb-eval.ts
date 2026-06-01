import { pool } from './db.js';
import { knowledgeSearch, type KnowledgeSearchResult } from './own-kb.js';
import { redactForEval } from './pii.js';
import { createTrustedScope } from './trusted-scope.js';

export type OwnKbEvalCase = {
  caseId: string;
  query: string;
  mustAnswer?: boolean;
  minConfidence?: number;
  maxLatencyMs?: number;
  expectedSnippetIncludes?: string[];
  forbiddenSnippetIncludes?: string[];
};

export type OwnKbEvalResult = {
  caseId: string;
  status: 'passed' | 'failed' | 'skipped';
  score: number;
  failureReason: string | null;
  latencyMs: number;
  citations: Array<{ chunkId: string; sourceId: string; sourceVersionId: string; rank: number; confidence: number }>;
};

export type OwnKbEvalRunResult = {
  runId: string | null;
  name: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  p95LatencyMs: number;
  results: OwnKbEvalResult[];
};

export function parseOwnKbEvalJsonl(jsonl: string): OwnKbEvalCase[] {
  return jsonl
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line, index) => {
      const parsed = JSON.parse(line) as Partial<OwnKbEvalCase>;
      const caseId = typeof parsed.caseId === 'string' && parsed.caseId.trim()
        ? parsed.caseId.trim()
        : `case_${index + 1}`;
      if (typeof parsed.query !== 'string' || !parsed.query.trim()) {
        throw new Error(`Invalid eval case ${caseId}: query required`);
      }
      return {
        caseId,
        query: parsed.query.trim(),
        mustAnswer: parsed.mustAnswer,
        minConfidence: parsed.minConfidence,
        maxLatencyMs: parsed.maxLatencyMs,
        expectedSnippetIncludes: Array.isArray(parsed.expectedSnippetIncludes) ? parsed.expectedSnippetIncludes : undefined,
        forbiddenSnippetIncludes: Array.isArray(parsed.forbiddenSnippetIncludes) ? parsed.forbiddenSnippetIncludes : undefined,
      };
    });
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function includesAll(haystack: string, needles: string[] | undefined): string | null {
  if (!needles || needles.length === 0) return null;
  const lower = haystack.toLowerCase();
  const missing = needles.find((needle) => !lower.includes(needle.toLowerCase()));
  return missing ? redactForEval(`EXPECTED_SNIPPET_MISSING:${missing}`).slice(0, 120) : null;
}

function includesForbidden(haystack: string, needles: string[] | undefined): string | null {
  if (!needles || needles.length === 0) return null;
  const lower = haystack.toLowerCase();
  const found = needles.find((needle) => lower.includes(needle.toLowerCase()));
  return found ? redactForEval(`FORBIDDEN_SNIPPET_PRESENT:${found}`).slice(0, 120) : null;
}

function evaluateCaseResult(testCase: OwnKbEvalCase, search: KnowledgeSearchResult): OwnKbEvalResult {
  const mustAnswer = testCase.mustAnswer !== false;
  const minConfidence = typeof testCase.minConfidence === 'number' ? testCase.minConfidence : 0.55;
  const snippetText = search.snippets.map((snippet) => snippet.text).join('\n').toLowerCase();
  const failureReason =
    mustAnswer && !search.answerable ? 'NOT_ANSWERABLE'
      : !mustAnswer && search.answerable ? 'SHOULD_ABSTAIN'
        : mustAnswer && search.confidence < minConfidence ? 'CONFIDENCE_TOO_LOW'
          : typeof testCase.maxLatencyMs === 'number' && search.latencyMs > testCase.maxLatencyMs ? 'LATENCY_TOO_HIGH'
            : includesAll(snippetText, testCase.expectedSnippetIncludes)
              ?? includesForbidden(snippetText, testCase.forbiddenSnippetIncludes);

  return {
    caseId: testCase.caseId,
    status: failureReason ? 'failed' : 'passed',
    score: failureReason ? 0 : search.confidence,
    failureReason: failureReason ? redactForEval(failureReason).slice(0, 200) : null,
    latencyMs: search.latencyMs,
    citations: search.snippets.map((snippet) => ({
      chunkId: snippet.chunkId,
      sourceId: snippet.sourceId,
      sourceVersionId: snippet.sourceVersionId,
      rank: snippet.rank,
      confidence: search.confidence,
    })),
  };
}

export async function evaluateOwnKbCases(input: {
  orgId: string;
  tenantId: string;
  name: string;
  cases: OwnKbEvalCase[];
  agentId?: string | null;
  store?: boolean;
}): Promise<OwnKbEvalRunResult> {
  const store = input.store !== false;
  let runId: string | null = null;
  if (store && pool) {
    const run = await pool.query<{ id: string }>(`
      insert into kb_eval_runs (org_id, tenant_id, name, config, is_global_synthetic)
      values ($1, $2, $3, $4::jsonb, false)
      returning id
    `, [
      input.orgId,
      input.tenantId,
      input.name,
      JSON.stringify({ agentId: input.agentId ?? null, caseCount: input.cases.length, provider: 'own_kb' }),
    ]);
    runId = run.rows[0]?.id ?? null;
  }

  const results: OwnKbEvalResult[] = [];
  for (const testCase of input.cases) {
    const search = await knowledgeSearch({
      trustedScope: createTrustedScope({
        orgId: input.orgId,
        tenantId: input.tenantId,
        agentId: input.agentId ?? 'internal_job:own_kb_eval',
        source: 'server',
        resolvedFrom: 'internal_job',
      }),
      query: testCase.query,
      provider: 'own_kb_eval',
      topK: 3,
      mode: 'balanced',
    });
    const result = evaluateCaseResult(testCase, search);
    results.push(result);

    if (runId && pool) {
      await pool.query(`
        insert into kb_eval_results
          (run_id, org_id, tenant_id, case_id, status, score, failure_reason, latency_ms, citations)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      `, [
        runId,
        input.orgId,
        input.tenantId,
        result.caseId,
        result.status,
        result.score,
        result.failureReason,
        result.latencyMs,
        JSON.stringify(result.citations),
      ]);
    }
  }

  return {
    runId,
    name: input.name,
    total: results.length,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    p95LatencyMs: percentile(results.map((result) => result.latencyMs), 95),
    results,
  };
}
