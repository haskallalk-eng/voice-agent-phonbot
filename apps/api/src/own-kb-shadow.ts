import crypto from 'node:crypto';
import { pool } from './db.js';
import { knowledgeSearch, type KnowledgeSearchResult } from './own-kb.js';
import { redactForShadow } from './pii.js';
import { createTrustedScope } from './trusted-scope.js';

type TranscriptRow = {
  call_id: string | null;
  agent_id: string | null;
  transcript: string;
};

export type ShadowQuestionCandidate = {
  callId: string | null;
  agentId: string | null;
  turnIndex: number;
  query: string;
};

export type OwnKbShadowRunInput = {
  orgId: string;
  tenantId: string;
  agentId?: string | null;
  name: string;
  limit?: number;
  sinceHours?: number;
  store?: boolean;
};

export type OwnKbShadowResult = {
  callId: string | null;
  agentId: string | null;
  turnIndex: number;
  status: 'answerable' | 'not_answerable' | 'error' | 'skipped';
  failureReason: string | null;
  confidence: number;
  latencyMs: number;
};

export type OwnKbShadowRunResult = {
  runId: string | null;
  name: string;
  total: number;
  answerable: number;
  notAnswerable: number;
  errors: number;
  skipped: number;
  p95LatencyMs: number;
  results: OwnKbShadowResult[];
};

const DEFAULT_LIMIT = 25;
const DEFAULT_SINCE_HOURS = 168;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_TRANSCRIPT_ROWS_PER_CANDIDATE = 5;
const PII_TOKEN_PATTERN = /\[(PHONE|EMAIL|IBAN|CC|ADDRESS|DOB)\]/;
const AGENT_SPEAKER_PATTERN = /^(agent|assistant|bot|phonbot|retell|system|mitarbeiter|berater|support)\b/;
const USER_SPEAKER_PATTERN = /^(user|kunde|kundin|caller|anrufer|anruferin|gast|patient|patientin|lead|client|customer|interessent)\b/;
const QUESTION_WORD_PATTERN =
  /\b(was|wie|wann|wo|wer|warum|wieso|weshalb|welche|welcher|welchen|welches|wieviel|kostet|kosten|preis|preise|oeffnungszeit|oeffnungszeiten|offnungszeit|offnungszeiten|termin|service|leistung|adresse|dauer|buchen|stornieren|kuendigen|kundigen|rueckruf|ruckruf)\b/;
const BLOCKED_CUSTOMER_ACTION_PATTERN =
  /\b(ich heisse|mein name|meine iban|meine adresse|meine kundennummer|zahlungsdaten|kreditkarte|ruf mich|mich zurueck|mich zuruck|termin buchen|buchen sie mich|ich moechte einen termin|ich mochte einen termin|ich will einen termin|storniere|kuendige|kundige|beschwerde)\b/;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function normalizeForMatching(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00df/g, 'ss')
    .toLowerCase();
}

function compactText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function queryHash(query: string): string {
  return crypto.createHash('sha256').update(compactText(query).toLowerCase()).digest('hex');
}

function parseTranscriptLine(line: string): { speaker: string | null; text: string } {
  const trimmed = line.trim();
  const match = trimmed.match(/^([A-Za-z][A-Za-z0-9 _.-]{0,30})\s*[:\-]\s*(.+)$/);
  if (!match) return { speaker: null, text: trimmed };
  return {
    speaker: normalizeForMatching(match[1] ?? ''),
    text: (match[2] ?? '').trim(),
  };
}

function splitUtterance(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?]?/g) ?? [text])
    .map(compactText)
    .filter(Boolean);
}

function isQuestionLike(text: string): boolean {
  const normalized = normalizeForMatching(text);
  return text.includes('?') || QUESTION_WORD_PATTERN.test(normalized);
}

function sanitizeQuestion(text: string): string | null {
  const redacted = compactText(redactForShadow(text));
  if (redacted.length < 6 || redacted.length > 220) return null;
  if (PII_TOKEN_PATTERN.test(redacted)) return null;
  if (BLOCKED_CUSTOMER_ACTION_PATTERN.test(normalizeForMatching(redacted))) return null;
  if (!isQuestionLike(redacted)) return null;
  return redacted;
}

export function extractShadowQuestionsFromTranscript(
  transcript: string,
  maxPerTranscript = 3,
): Array<{ turnIndex: number; query: string }> {
  const limit = clampInt(maxPerTranscript, 3, 1, 10);
  const candidates: Array<{ turnIndex: number; query: string; preferred: boolean }> = [];
  const seen = new Set<string>();

  transcript
    .split(/\r?\n/g)
    .map(parseTranscriptLine)
    .forEach((line, lineIndex) => {
      if (!line.text || (line.speaker && AGENT_SPEAKER_PATTERN.test(line.speaker))) return;
      const preferred = line.speaker ? USER_SPEAKER_PATTERN.test(line.speaker) : false;
      if (!preferred) return;
      for (const utterance of splitUtterance(line.text)) {
        const query = sanitizeQuestion(utterance);
        if (!query) continue;
        const key = queryHash(query);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ turnIndex: lineIndex, query, preferred });
      }
    });

  return candidates
    .slice(0, limit)
    .map(({ turnIndex, query }) => ({ turnIndex, query }));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

async function loadAllowedAgentIds(input: {
  orgId: string;
  tenantId: string;
  agentId?: string | null;
}): Promise<string[]> {
  if (!pool) throw new Error('DATABASE_URL is required');
  const params: unknown[] = [input.orgId, input.tenantId];
  const requestedAgentFilter = input.agentId ? `and (
    data->>'retellAgentId' = $3
    or data->>'retellCallbackAgentId' = $3
    or data->>'agentId' = $3
  )` : '';
  if (input.agentId) params.push(input.agentId);
  const rows = await pool.query<{ agent_id: string | null }>(`
    select distinct agent_id
    from (
      select nullif(data->>'retellAgentId', '') as agent_id
        from agent_configs
       where org_id = $1
         and tenant_id = $2
         ${requestedAgentFilter}
      union all
      select nullif(data->>'retellCallbackAgentId', '') as agent_id
        from agent_configs
       where org_id = $1
         and tenant_id = $2
         ${requestedAgentFilter}
      union all
      select nullif(data->>'agentId', '') as agent_id
        from agent_configs
       where org_id = $1
         and tenant_id = $2
         ${requestedAgentFilter}
    ) allowed
    where agent_id is not null
  `, params);
  return rows.rows
    .map((row) => row.agent_id)
    .filter((agentId): agentId is string => typeof agentId === 'string' && agentId.length > 0);
}

export async function loadShadowQuestionsFromTranscripts(input: {
  orgId: string;
  tenantId: string;
  agentId?: string | null;
  limit?: number;
  sinceHours?: number;
}): Promise<ShadowQuestionCandidate[]> {
  if (!pool) throw new Error('DATABASE_URL is required');
  const limit = clampInt(input.limit, DEFAULT_LIMIT, 1, 200);
  const sinceHours = clampInt(input.sinceHours, DEFAULT_SINCE_HOURS, 1, 24 * 365);
  const allowedAgentIds = await loadAllowedAgentIds({
    orgId: input.orgId,
    tenantId: input.tenantId,
    agentId: input.agentId ?? null,
  });
  if (allowedAgentIds.length === 0) return [];
  const params: unknown[] = [input.orgId, sinceHours, allowedAgentIds];
  const where = [
    'org_id = $1',
    `created_at >= now() - ($2::int * interval '1 hour')`,
    'agent_id = any($3::text[])',
  ];
  params.push(limit * MAX_TRANSCRIPT_ROWS_PER_CANDIDATE);

  const rows = await pool.query<TranscriptRow>(`
    select call_id, agent_id, transcript
    from call_transcripts
    where ${where.join(' and ')}
    order by created_at desc
    limit $${params.length}
  `, params);

  const candidates: ShadowQuestionCandidate[] = [];
  for (const row of rows.rows) {
    const questions = extractShadowQuestionsFromTranscript(row.transcript, 3);
    for (const question of questions) {
      candidates.push({
        callId: row.call_id,
        agentId: row.agent_id,
        turnIndex: question.turnIndex,
        query: question.query,
      });
      if (candidates.length >= limit) return candidates;
    }
  }
  return candidates;
}

function citationSummary(search: KnowledgeSearchResult): Array<Record<string, unknown>> {
  return search.snippets.map((snippet) => ({
    chunkId: snippet.chunkId,
    sourceId: snippet.sourceId,
    sourceVersionId: snippet.sourceVersionId,
    rank: snippet.rank,
    score: Number(snippet.score.toFixed(6)),
    distance: snippet.distance ?? null,
    confidence: search.confidence,
  }));
}

function summarize(name: string, runId: string | null, results: OwnKbShadowResult[]): OwnKbShadowRunResult {
  return {
    runId,
    name,
    total: results.length,
    answerable: results.filter((result) => result.status === 'answerable').length,
    notAnswerable: results.filter((result) => result.status === 'not_answerable').length,
    errors: results.filter((result) => result.status === 'error').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    p95LatencyMs: percentile(results.map((result) => result.latencyMs), 95),
    results,
  };
}

export async function runOwnKbShadowFromTranscripts(input: OwnKbShadowRunInput): Promise<OwnKbShadowRunResult> {
  if (!pool) throw new Error('DATABASE_URL is required');
  const store = input.store !== false;
  const limit = clampInt(input.limit, DEFAULT_LIMIT, 1, 200);
  const sinceHours = clampInt(input.sinceHours, DEFAULT_SINCE_HOURS, 1, 24 * 365);
  const retentionDays = clampInt(process.env.OWN_KB_SHADOW_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, 1, 90);
  const candidates = await loadShadowQuestionsFromTranscripts({
    orgId: input.orgId,
    tenantId: input.tenantId,
    agentId: input.agentId ?? null,
    limit,
    sinceHours,
  });

  let runId: string | null = null;
  if (store) {
    const run = await pool.query<{ id: string }>(`
      insert into kb_shadow_runs
        (org_id, tenant_id, agent_id, name, source, status, sample_size, config)
      values ($1, $2, $3, $4, 'transcripts', 'running', $5, $6::jsonb)
      returning id
    `, [
      input.orgId,
      input.tenantId,
      input.agentId ?? null,
      input.name,
      candidates.length,
      JSON.stringify({ provider: 'own_kb_shadow', limit, sinceHours, retentionDays }),
    ]);
    runId = run.rows[0]?.id ?? null;
  }

  const results: OwnKbShadowResult[] = [];
  for (const candidate of candidates) {
    const redactedQuery = compactText(redactForShadow(candidate.query));
    try {
      const search = await knowledgeSearch({
        trustedScope: createTrustedScope({
          orgId: input.orgId,
          tenantId: input.tenantId,
          agentId: candidate.agentId ?? input.agentId ?? 'internal_job:own_kb_shadow',
          callId: candidate.callId ?? undefined,
          source: 'server',
          resolvedFrom: 'internal_job',
        }),
        turnId: `shadow:${candidate.turnIndex}`,
        query: redactedQuery,
        provider: 'own_kb_shadow',
        topK: 3,
        mode: 'balanced',
      });
      const status = search.policy.reason === 'RETRIEVAL_ERROR'
        ? 'error'
        : search.answerable ? 'answerable' : 'not_answerable';
      const result: OwnKbShadowResult = {
        callId: candidate.callId,
        agentId: candidate.agentId ?? input.agentId ?? null,
        turnIndex: candidate.turnIndex,
        status,
        failureReason: status === 'answerable' ? null : search.policy.reason,
        confidence: search.confidence,
        latencyMs: search.latencyMs,
      };
      results.push(result);

      if (store && runId) {
        await pool.query(`
          insert into kb_shadow_results
            (run_id, org_id, tenant_id, agent_id, call_id, turn_index, query_hash, query_text_redacted,
             own_answerable, own_confidence, own_latency_ms, own_citations, retrieval_event_id, status, failure_reason, expires_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, now() + ($16::int * interval '1 day'))
          on conflict do nothing
        `, [
          runId,
          input.orgId,
          input.tenantId,
          result.agentId,
          result.callId,
          result.turnIndex,
          queryHash(redactedQuery),
          redactedQuery.slice(0, 500),
          search.answerable,
          search.confidence,
          search.latencyMs,
          JSON.stringify(citationSummary(search)),
          search.retrievalEventId ?? null,
          status,
          result.failureReason,
          retentionDays,
        ]);
      }
    } catch (err) {
      const result: OwnKbShadowResult = {
        callId: candidate.callId,
        agentId: candidate.agentId ?? input.agentId ?? null,
        turnIndex: candidate.turnIndex,
        status: 'error',
        failureReason: err instanceof Error ? redactForShadow(err.message).slice(0, 200) : 'SHADOW_RETRIEVAL_ERROR',
        confidence: 0,
        latencyMs: 0,
      };
      results.push(result);
      if (store && runId) {
        await pool.query(`
          insert into kb_shadow_results
            (run_id, org_id, tenant_id, agent_id, call_id, turn_index, query_hash, query_text_redacted,
             own_answerable, own_confidence, own_latency_ms, own_citations, status, failure_reason, expires_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, false, 0, 0, '[]'::jsonb, 'error', $9, now() + ($10::int * interval '1 day'))
          on conflict do nothing
        `, [
          runId,
          input.orgId,
          input.tenantId,
          result.agentId,
          result.callId,
          result.turnIndex,
          queryHash(candidate.query),
          redactForShadow(candidate.query).slice(0, 500),
          result.failureReason,
          retentionDays,
        ]);
      }
    }
  }

  const summary = summarize(input.name, runId, results);
  if (store && runId) {
    await pool.query(`
      update kb_shadow_runs
         set status = 'done',
             summary = $2::jsonb,
             finished_at = now()
       where id = $1
    `, [
      runId,
      JSON.stringify({
        total: summary.total,
        answerable: summary.answerable,
        notAnswerable: summary.notAnswerable,
        errors: summary.errors,
        skipped: summary.skipped,
        p95LatencyMs: summary.p95LatencyMs,
      }),
    ]);
  }

  return summary;
}
