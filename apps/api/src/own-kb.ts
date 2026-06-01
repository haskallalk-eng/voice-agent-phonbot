import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from './db.js';
import {
  buildCanonicalBusinessFacts,
  canonicalBusinessFactsSafetyError,
  loadStoredKnowledgePdf,
  prepareKnowledgePayload,
  type KnowledgeSource,
  type KnowledgeText,
} from './knowledge.js';
import { ocrPdfWithOpenAI } from './knowledge-ocr.js';
import { log } from './logger.js';
import { redactForPrompt, redactForTrace } from './pii.js';
import { isTrustedScope, type TrustedScope } from './trusted-scope.js';

const DEFAULT_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;
const OWN_KB_PARSER = 'phonbot-own-kb';
const OWN_KB_PARSER_VERSION = '2026-05-28-v1';
const DEFAULT_CANONICAL_TTL_DAYS = 30;
const DEFAULT_CHUNK_MAX_CHARS = 1400;
const DEFAULT_CHUNK_OVERLAP_CHARS = 180;
const parsedMaxVectorDistance = Number(process.env.OWN_KB_MAX_VECTOR_DISTANCE ?? 0.38);
const DEFAULT_MAX_VECTOR_DISTANCE = Number.isFinite(parsedMaxVectorDistance)
  ? Math.max(0.05, Math.min(1, parsedMaxVectorDistance))
  : 0.38;
const parsedQueryEmbedTimeoutMs = Number(process.env.OWN_KB_QUERY_EMBED_TIMEOUT_MS ?? 700);
const QUERY_EMBED_TIMEOUT_MS = Number.isFinite(parsedQueryEmbedTimeoutMs)
  ? Math.max(250, Math.min(3_000, parsedQueryEmbedTimeoutMs))
  : 700;
const ALLOWED_OWN_KB_USES = new Set(['agent_facts', 'customer_faq', 'voice_agent', 'public_faq']);
const APPROVED_OWN_KB_REVIEWS = new Set(['approved']);
const BLOCKED_OWN_KB_RISKS = new Set(['high', 'critical']);

export type KnowledgeSearchMode = 'strict' | 'balanced' | 'broad';

export type KnowledgeSearchInput = {
  query: string;
  trustedScope: TrustedScope;
  turnId?: string | null;
  language?: string;
  topK?: number;
  mode?: KnowledgeSearchMode;
  provider?: string;
};

export type KnowledgeSearchSnippet = {
  chunkId: string;
  sourceId: string;
  sourceVersionId: string;
  rank: number;
  text: string;
  category: string;
  allowedUse: string;
  verifiedAt: string;
  expiresAt: string;
  risk: 'low' | 'medium' | 'high';
  distance?: number;
  score: number;
};

export type KnowledgeSearchResult = {
  answerable: boolean;
  confidence: number;
  latencyMs: number;
  retrievalEventId?: string;
  snippets: KnowledgeSearchSnippet[];
  policy: {
    mayAnswer: boolean;
    mayMutate: false;
    reason: string;
  };
};

export type OwnKbIngestionStatus = 'indexed' | 'rejected' | 'failed' | 'dry_run';

export type OwnKbIngestionResult = {
  sourceName: string;
  sourceType: string;
  sourceId?: string;
  sourceVersionId?: string;
  documentId?: string;
  status: OwnKbIngestionStatus;
  chunks: number;
  embeddings: number;
  rejectionReason?: string;
};

export type OwnKbBackfillResult = {
  dryRun: boolean;
  orgId: string;
  tenantId: string;
  prepared: number;
  indexed: number;
  rejected: number;
  failed: number;
  chunks: number;
  embeddings: number;
  results: OwnKbIngestionResult[];
};

export type BackfillOwnKnowledgeBaseInput = {
  orgId: string;
  tenantId: string;
  agentTenantId?: string | null;
  agentId?: string | null;
  config: Record<string, unknown>;
  dryRun?: boolean;
  requireEmbeddings?: boolean;
  includeCanonicalBusinessFacts?: boolean;
  inspectUrlContent?: boolean;
  now?: Date | string;
};

type PreparedOwnKbItem = {
  source: KnowledgeSource;
  text: KnowledgeText;
  sourceType: 'text' | 'url' | 'pdf' | 'db_canonical' | 'upload';
  uri: string;
};

type KnowledgeChunk = {
  index: number;
  text: string;
  charStart: number;
  charEnd: number;
  tokenCount: number;
  contentHash: string;
};

function clampTopK(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, Math.trunc(n)));
}

function voiceSnippet(text: string): string {
  return redactForPrompt(text.replace(/\s+/g, ' ').trim()).slice(0, 700);
}

function compactText(input: unknown): string {
  return typeof input === 'string' ? input.replace(/\s+/g, ' ').trim() : '';
}

function normalizeDate(input: Date | string | undefined): Date {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input;
  if (typeof input === 'string' && input.trim()) {
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function addDaysIso(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function parseDateMs(input: unknown): number | null {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input.getTime();
  if (typeof input !== 'string' || !input.trim()) return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function hashContent(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function chunkKnowledgeText(
  input: string,
  options: { maxChars?: number; overlapChars?: number } = {},
): KnowledgeChunk[] {
  const maxChars = Math.max(500, Math.min(2400, Math.trunc(options.maxChars ?? DEFAULT_CHUNK_MAX_CHARS)));
  const overlapChars = Math.max(0, Math.min(400, Math.trunc(options.overlapChars ?? DEFAULT_CHUNK_OVERLAP_CHARS)));
  const normalized = input.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/g)
    .flatMap((paragraph) => paragraph.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/g))
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const chunks: KnowledgeChunk[] = [];
  let current = '';
  let currentStart = 0;
  let searchFrom = 0;

  const pushCurrent = () => {
    const text = current.trim();
    if (!text) return;
    const charStart = Math.max(0, normalized.indexOf(text.slice(0, Math.min(80, text.length)), currentStart));
    const safeStart = charStart >= 0 ? charStart : currentStart;
    chunks.push({
      index: chunks.length,
      text,
      charStart: safeStart,
      charEnd: safeStart + text.length,
      tokenCount: estimateTokens(text),
      contentHash: hashContent(text),
    });
  };

  for (const paragraph of paragraphs.length ? paragraphs : [normalized]) {
    const located = normalized.indexOf(paragraph.slice(0, Math.min(80, paragraph.length)), searchFrom);
    const paragraphStart = located >= 0 ? located : searchFrom;
    searchFrom = Math.max(searchFrom, paragraphStart + paragraph.length);

    if (!current) {
      current = paragraph;
      currentStart = paragraphStart;
      continue;
    }

    if (`${current}\n${paragraph}`.length <= maxChars) {
      current = `${current}\n${paragraph}`;
      continue;
    }

    pushCurrent();
    const overlap = overlapChars > 0 ? current.slice(-overlapChars).replace(/^\S*\s*/, '').trim() : '';
    current = overlap ? `${overlap}\n${paragraph}` : paragraph;
    currentStart = overlap ? Math.max(0, paragraphStart - overlap.length) : paragraphStart;

    while (current.length > maxChars) {
      const text = current.slice(0, maxChars).trim();
      chunks.push({
        index: chunks.length,
        text,
        charStart: currentStart,
        charEnd: currentStart + text.length,
        tokenCount: estimateTokens(text),
        contentHash: hashContent(text),
      });
      const nextStart = Math.max(0, maxChars - overlapChars);
      current = current.slice(nextStart).trim();
      currentStart += nextStart;
    }
  }

  pushCurrent();
  return chunks;
}

function queryHash(query: string): string {
  return crypto.createHash('sha256').update(query.trim().toLowerCase()).digest('hex');
}

async function embedQuery(query: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_EMBED_MODEL,
      input: query,
      dimensions: EMBEDDING_DIM,
    }),
    signal: AbortSignal.timeout(QUERY_EMBED_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OPENAI_EMBEDDING_FAILED:${res.status}:${body.slice(0, 160)}`);
  }
  const data = await res.json() as { data?: Array<{ embedding?: number[] }> };
  const embedding = data.data?.[0]?.embedding;
  return Array.isArray(embedding) && embedding.length === EMBEDDING_DIM ? embedding : null;
}

async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || texts.length === 0) return null;
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_EMBED_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIM,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OPENAI_EMBEDDING_FAILED:${res.status}:${body.slice(0, 160)}`);
  }
  const data = await res.json() as { data?: Array<{ embedding?: number[]; index?: number }> };
  const embeddings = data.data ?? [];
  if (embeddings.length !== texts.length) return null;
  return embeddings
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
    .map((item) => item.embedding)
    .filter((embedding): embedding is number[] => Array.isArray(embedding) && embedding.length === EMBEDDING_DIM);
}

function normalizeSourceType(source: KnowledgeSource): PreparedOwnKbItem['sourceType'] {
  if (source.type === 'text' && source.id === 'db_canonical_business_facts') return 'db_canonical';
  return source.type === 'text' || source.type === 'url' || source.type === 'pdf' ? source.type : 'upload';
}

function sourceUri(source: KnowledgeSource, tenantId: string): string {
  if (source.id === 'db_canonical_business_facts') return `canonical:agent:${tenantId}`;
  if (source.type === 'url') return compactText(source.url || source.content);
  if (source.type === 'pdf') return `knowledge_file:${compactText(source.fileId || source.id)}`;
  return `legacy:${source.type}:${compactText(source.id)}`;
}

function sourceMatchesText(source: KnowledgeSource, text: KnowledgeText): boolean {
  const sourceName = compactText(source.name).toLowerCase();
  const title = compactText(text.title).toLowerCase();
  if (!sourceName || !title) return false;
  return sourceName === title || `${sourceName} ocr` === title || title.startsWith(`${sourceName} `);
}

function matchPayloadSource(text: KnowledgeText, sources: KnowledgeSource[], used: Set<number>): KnowledgeSource | null {
  const exact = sources.findIndex((source, index) => !used.has(index) && sourceMatchesText(source, text));
  if (exact >= 0) {
    used.add(exact);
    return sources[exact] ?? null;
  }
  const next = sources.findIndex((_source, index) => !used.has(index));
  if (next >= 0) {
    used.add(next);
    return sources[next] ?? null;
  }
  return null;
}

function ownKbMetadataGate(source: KnowledgeSource, nowMs: number): string | null {
  const reviewStatus = compactText(source.reviewStatus).toLowerCase();
  if (!reviewStatus || !APPROVED_OWN_KB_REVIEWS.has(reviewStatus)) return 'SOURCE_REVIEW_REQUIRED';

  const allowedUse = compactText(source.allowedUse).toLowerCase();
  if (!allowedUse) return 'SOURCE_ALLOWED_USE_REQUIRED';
  if (!ALLOWED_OWN_KB_USES.has(allowedUse)) return 'SOURCE_USE_NOT_ALLOWED';

  const verifiedAt = parseDateMs(source.verifiedAt);
  if (verifiedAt === null) return 'SOURCE_VERIFIED_AT_REQUIRED';
  if (verifiedAt > nowMs + 5 * 60 * 1000) return 'SOURCE_VERIFIED_AT_IN_FUTURE';

  const expiresAt = parseDateMs(source.expiresAt);
  if (expiresAt === null) return 'SOURCE_EXPIRES_AT_REQUIRED';
  if (expiresAt <= nowMs) return 'SOURCE_EXPIRED';

  const risk = compactText(source.risk).toLowerCase();
  if (risk && BLOCKED_OWN_KB_RISKS.has(risk)) return 'SOURCE_RISK_TOO_HIGH';
  if (source.containsPii === true) return 'PII_DETECTED';
  return null;
}

async function prepareOwnKbItems(input: BackfillOwnKnowledgeBaseInput): Promise<{
  items: PreparedOwnKbItem[];
  rejected: OwnKbIngestionResult[];
}> {
  const now = normalizeDate(input.now);
  const rejected: OwnKbIngestionResult[] = [];
  const items: PreparedOwnKbItem[] = [];

  if (input.includeCanonicalBusinessFacts !== false) {
    const canonical = buildCanonicalBusinessFacts(input.config, { now });
    if (canonical) {
      const safetyError = canonicalBusinessFactsSafetyError(canonical.content);
      if (safetyError) {
        rejected.push({
          sourceName: canonical.name,
          sourceType: 'db_canonical',
          status: 'rejected',
          chunks: 0,
          embeddings: 0,
          rejectionReason: safetyError,
        });
      } else {
        const source: KnowledgeSource = {
          ...canonical,
          verifiedAt: canonical.verifiedAt ?? now.toISOString(),
          expiresAt: canonical.expiresAt ?? addDaysIso(now, DEFAULT_CANONICAL_TTL_DAYS),
        };
        items.push({
          source,
          text: { title: source.name, text: source.content },
          sourceType: 'db_canonical',
          uri: sourceUri(source, input.tenantId),
        });
      }
    }
  }

  const payload = await prepareKnowledgePayload(input.config, {
    includeCanonicalBusinessFacts: false,
    requirePdfBytes: input.dryRun === false,
    inspectUrlContent: input.inspectUrlContent ?? input.dryRun === false,
    loadPdfFile: !input.dryRun && input.orgId && input.tenantId
      ? (source) => loadStoredKnowledgePdf(input.orgId, input.tenantId, source)
      : undefined,
    ocrPdfFile: input.dryRun === false ? ocrPdfWithOpenAI : undefined,
    now,
  });

  for (const source of payload.sources) {
    if (source.status === 'error') {
      rejected.push({
        sourceName: source.name || source.id,
        sourceType: source.type,
        status: 'rejected',
        chunks: 0,
        embeddings: 0,
        rejectionReason: source.error ?? 'SOURCE_REJECTED',
      });
    }
  }

  const indexedSources = payload.sources.filter((source) => source.status === 'indexed');
  const used = new Set<number>();
  for (const text of payload.texts) {
    const source = matchPayloadSource(text, indexedSources, used);
    if (!source) {
      rejected.push({
        sourceName: text.title,
        sourceType: 'unknown',
        status: 'rejected',
        chunks: 0,
        embeddings: 0,
        rejectionReason: 'SOURCE_METADATA_MISSING',
      });
      continue;
    }
    const gatedSource: KnowledgeSource = source.id === 'db_canonical_business_facts'
      ? {
          ...source,
          verifiedAt: source.verifiedAt ?? now.toISOString(),
          expiresAt: source.expiresAt ?? addDaysIso(now, DEFAULT_CANONICAL_TTL_DAYS),
        }
      : source;
    items.push({
      source: gatedSource,
      text,
      sourceType: normalizeSourceType(gatedSource),
      uri: sourceUri(gatedSource, input.tenantId),
    });
  }

  return { items, rejected };
}

async function recordIngestionJob(
  client: PoolClient,
  input: BackfillOwnKnowledgeBaseInput,
  item: PreparedOwnKbItem,
  status: 'done' | 'failed',
  error: string | null,
  output: Record<string, unknown>,
): Promise<void> {
  await client.query(`
    insert into kb_ingestion_jobs
      (org_id, tenant_id, source_id, source_version_id, job_type, status, attempts, error, input, output, updated_at)
    values ($1, $2, $3, $4, 'backfill_agent_config', $5, 1, $6, $7::jsonb, $8::jsonb, now())
  `, [
    input.orgId,
    input.tenantId,
    typeof output.sourceId === 'string' ? output.sourceId : null,
    typeof output.sourceVersionId === 'string' ? output.sourceVersionId : null,
    status,
    error,
    JSON.stringify({
      agentTenantId: input.agentTenantId ?? null,
      agentId: input.agentId ?? null,
      sourceType: item.sourceType,
      sourceName: item.source.name,
      sourceUri: item.uri,
    }),
    JSON.stringify(output),
  ]);
}

async function writePreparedOwnKbItem(
  input: BackfillOwnKnowledgeBaseInput,
  item: PreparedOwnKbItem,
): Promise<OwnKbIngestionResult> {
  if (!pool) throw new Error('DATABASE_UNAVAILABLE');

  const sourceName = compactText(item.source.name || item.text.title) || 'Unnamed source';
  const chunks = chunkKnowledgeText(item.text.text);
  if (chunks.length === 0) {
    return {
      sourceName,
      sourceType: item.sourceType,
      status: 'rejected',
      chunks: 0,
      embeddings: 0,
      rejectionReason: 'SOURCE_EMPTY',
    };
  }

  const requireEmbeddings = input.requireEmbeddings !== false;
  const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
  if ((!embeddings || embeddings.length !== chunks.length) && requireEmbeddings) {
    return {
      sourceName,
      sourceType: item.sourceType,
      status: 'failed',
      chunks: chunks.length,
      embeddings: 0,
      rejectionReason: 'EMBEDDINGS_UNAVAILABLE',
    };
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [
        `own-kb-source:${input.orgId}:${input.tenantId}`,
        `${input.agentTenantId ?? ''}:${item.sourceType}:${item.uri ?? ''}`,
      ],
    );
    const sourceLookup = await client.query<{ id: string; review_status: string; risk: string; contains_pii: boolean }>(`
      select id, review_status, risk, contains_pii
      from kb_sources
      where org_id = $1
        and tenant_id = $2
        and agent_tenant_id is not distinct from $3
        and type = $4
        and uri is not distinct from $5
      order by created_at asc
      limit 1
      for update
    `, [input.orgId, input.tenantId, input.agentTenantId ?? null, item.sourceType, item.uri]);

    let sourceId = sourceLookup.rows[0]?.id;
    if (!sourceId) {
      const inserted = await client.query<{ id: string }>(`
        insert into kb_sources
          (org_id, tenant_id, agent_tenant_id, type, name, uri, category, allowed_use, owner, review_status, risk, contains_pii)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved', $10, false)
        returning id
      `, [
        input.orgId,
        input.tenantId,
        input.agentTenantId ?? null,
        item.sourceType,
        sourceName,
        item.uri,
        compactText(item.source.category) || 'general',
        compactText(item.source.allowedUse).toLowerCase(),
        compactText(item.source.owner) || 'tenant',
        compactText(item.source.risk).toLowerCase() || 'medium',
      ]);
      sourceId = inserted.rows[0]?.id;
    } else {
      const existing = sourceLookup.rows[0];
      if (
        existing?.contains_pii === true ||
        !APPROVED_OWN_KB_REVIEWS.has(String(existing?.review_status ?? '').toLowerCase()) ||
        BLOCKED_OWN_KB_RISKS.has(String(existing?.risk ?? '').toLowerCase())
      ) {
        await client.query('rollback');
        return {
          sourceName,
          sourceType: item.sourceType,
          sourceId,
          status: 'rejected',
          chunks: 0,
          embeddings: 0,
          rejectionReason: 'SOURCE_MANUALLY_DOWNGRADED',
        };
      }
      await client.query(`
        update kb_sources
           set name = $4,
               category = $5,
               allowed_use = $6,
               owner = $7,
               review_status = 'approved',
               risk = $8,
               contains_pii = false,
               updated_at = now()
         where id = $1 and org_id = $2 and tenant_id = $3
      `, [
        sourceId,
        input.orgId,
        input.tenantId,
        sourceName,
        compactText(item.source.category) || 'general',
        compactText(item.source.allowedUse).toLowerCase(),
        compactText(item.source.owner) || 'tenant',
        compactText(item.source.risk).toLowerCase() || 'medium',
      ]);
    }
    if (!sourceId) throw new Error('SOURCE_INSERT_FAILED');

    const contentHash = hashContent(item.text.text);
    const existingVersion = await client.query<{ id: string }>(`
      select id
      from kb_source_versions
      where source_id = $1 and content_hash = $2
      limit 1
      for update
    `, [sourceId, contentHash]);

    let sourceVersionId = existingVersion.rows[0]?.id;
    const sourceVersionAlreadyExisted = Boolean(sourceVersionId);
    if (!sourceVersionId) {
      const versionNoRes = await client.query<{ version_no: number }>(
        `select coalesce(max(version_no), 0)::int + 1 as version_no from kb_source_versions where source_id = $1`,
        [sourceId],
      );
      const insertedVersion = await client.query<{ id: string }>(`
        insert into kb_source_versions
          (source_id, org_id, tenant_id, version_no, content_hash, mime_type, size_bytes, parser, parser_version,
           fetched_at, verified_at, expires_at, status, metadata)
        values ($1, $2, $3, $4, $5, 'text/plain', $6, $7, $8, now(), $9, $10, 'indexed', $11::jsonb)
        returning id
      `, [
        sourceId,
        input.orgId,
        input.tenantId,
        versionNoRes.rows[0]?.version_no ?? 1,
        contentHash,
        Buffer.byteLength(item.text.text, 'utf8'),
        OWN_KB_PARSER,
        OWN_KB_PARSER_VERSION,
        item.source.verifiedAt,
        item.source.expiresAt,
        JSON.stringify({
          agentTenantId: input.agentTenantId ?? null,
          agentId: input.agentId ?? null,
          legacySourceId: item.source.id,
          sourceUri: item.uri,
        }),
      ]);
      sourceVersionId = insertedVersion.rows[0]?.id;
    } else {
      await client.query(`
        update kb_source_versions
           set status = 'indexed',
               verified_at = $2,
               expires_at = $3,
               rejection_reason = null,
               metadata = metadata || $4::jsonb
         where id = $1
      `, [
        sourceVersionId,
        item.source.verifiedAt,
        item.source.expiresAt,
        JSON.stringify({
          agentTenantId: input.agentTenantId ?? null,
          agentId: input.agentId ?? null,
          legacySourceId: item.source.id,
          sourceUri: item.uri,
        }),
      ]);
    }
    if (!sourceVersionId) throw new Error('VERSION_INSERT_FAILED');

    if (sourceVersionAlreadyExisted) {
      const existingStats = await client.query<{ documents: number; chunks: number; embeddings: number }>(`
        select
          count(distinct d.id)::int as documents,
          count(distinct c.id)::int as chunks,
          count(distinct e.id)::int as embeddings
        from kb_documents d
        left join kb_chunks c on c.document_id = d.id
        left join kb_embeddings e on e.chunk_id = c.id and e.embedding_model = $2
        where d.source_version_id = $1
      `, [sourceVersionId, DEFAULT_EMBED_MODEL]);
      const stats = existingStats.rows[0];
      const existingChunks = Number(stats?.chunks ?? 0);
      const existingEmbeddings = Number(stats?.embeddings ?? 0);
      if (existingChunks > 0 && (!requireEmbeddings || existingEmbeddings >= existingChunks)) {
        await client.query(`
          update kb_sources
             set current_version_id = $1,
                 updated_at = now()
           where id = $2
        `, [sourceVersionId, sourceId]);
        const result: OwnKbIngestionResult = {
          sourceName,
          sourceType: item.sourceType,
          sourceId,
          sourceVersionId,
          status: 'indexed',
          chunks: existingChunks,
          embeddings: existingEmbeddings,
        };
        await recordIngestionJob(client, input, item, 'done', null, { ...result, reusedVersion: true });
        await client.query('commit');
        return result;
      }
    }

    await client.query(`delete from kb_documents where source_version_id = $1`, [sourceVersionId]);
    const document = await client.query<{ id: string }>(`
      insert into kb_documents
        (source_id, source_version_id, org_id, tenant_id, title, language, content_hash, token_count, status, metadata)
      values ($1, $2, $3, $4, $5, 'de', $6, $7, 'ready', $8::jsonb)
      returning id
    `, [
      sourceId,
      sourceVersionId,
      input.orgId,
      input.tenantId,
      item.text.title,
      contentHash,
      estimateTokens(item.text.text),
      JSON.stringify({ parser: OWN_KB_PARSER, sourceUri: item.uri }),
    ]);
    const documentId = document.rows[0]?.id;
    if (!documentId) throw new Error('DOCUMENT_INSERT_FAILED');

    const chunkIds: string[] = [];
    for (const chunk of chunks) {
      const insertedChunk = await client.query<{ id: string }>(`
        insert into kb_chunks
          (document_id, source_id, source_version_id, org_id, tenant_id, chunk_index, text, token_count,
           char_start, char_end, content_hash, metadata)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        returning id
      `, [
        documentId,
        sourceId,
        sourceVersionId,
        input.orgId,
        input.tenantId,
        chunk.index,
        chunk.text,
        chunk.tokenCount,
        chunk.charStart,
        chunk.charEnd,
        chunk.contentHash,
        JSON.stringify({ parser: OWN_KB_PARSER, sourceUri: item.uri }),
      ]);
      const chunkId = insertedChunk.rows[0]?.id;
      if (!chunkId) throw new Error('CHUNK_INSERT_FAILED');
      chunkIds.push(chunkId);
    }

    for (let i = 0; i < chunkIds.length; i += 1) {
      const embedding = embeddings?.[i];
      if (!embedding) continue;
      await client.query(`
        insert into kb_embeddings
          (chunk_id, org_id, tenant_id, embedding_model, embedding_dim, embedding)
        values ($1, $2, $3, $4, $5, $6::vector)
        on conflict (chunk_id, embedding_model) do update
          set embedding = excluded.embedding,
              embedding_dim = excluded.embedding_dim,
              created_at = now()
      `, [
        chunkIds[i],
        input.orgId,
        input.tenantId,
        DEFAULT_EMBED_MODEL,
        EMBEDDING_DIM,
        `[${embedding.join(',')}]`,
      ]);
    }

    await client.query(`
      update kb_sources
         set current_version_id = $1,
             updated_at = now()
       where id = $2
    `, [sourceVersionId, sourceId]);

    const result: OwnKbIngestionResult = {
      sourceName,
      sourceType: item.sourceType,
      sourceId,
      sourceVersionId,
      documentId,
      status: 'indexed',
      chunks: chunks.length,
      embeddings: embeddings?.length ?? 0,
    };
    await recordIngestionJob(client, input, item, 'done', null, result);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function backfillOwnKnowledgeBaseFromAgentConfig(
  input: BackfillOwnKnowledgeBaseInput,
): Promise<OwnKbBackfillResult> {
  const dryRun = input.dryRun !== false;
  const nowMs = normalizeDate(input.now).getTime();
  if (!pool && !dryRun) throw new Error('DATABASE_UNAVAILABLE');

  const { items, rejected } = await prepareOwnKbItems({ ...input, dryRun });
  const results: OwnKbIngestionResult[] = [...rejected];

  for (const item of items) {
    const rejectionReason = ownKbMetadataGate(item.source, nowMs);
    if (rejectionReason) {
      results.push({
        sourceName: item.source.name || item.text.title,
        sourceType: item.sourceType,
        status: 'rejected',
        chunks: 0,
        embeddings: 0,
        rejectionReason,
      });
      continue;
    }

    const chunks = chunkKnowledgeText(item.text.text);
    if (dryRun) {
      results.push({
        sourceName: item.source.name || item.text.title,
        sourceType: item.sourceType,
        status: 'dry_run',
        chunks: chunks.length,
        embeddings: 0,
      });
      continue;
    }

    try {
      results.push(await writePreparedOwnKbItem({ ...input, dryRun: false }, item));
    } catch (err) {
      const failed: OwnKbIngestionResult = {
        sourceName: item.source.name || item.text.title,
        sourceType: item.sourceType,
        status: 'failed',
        chunks: chunks.length,
        embeddings: 0,
        rejectionReason: err instanceof Error ? err.message.slice(0, 120) : 'INGESTION_FAILED',
      };
      results.push(failed);
      log.warn({ err: failed.rejectionReason, tenantId: input.tenantId }, 'own KB ingestion item failed');
    }
  }

  return {
    dryRun,
    orgId: input.orgId,
    tenantId: input.tenantId,
    prepared: items.length,
    indexed: results.filter((result) => result.status === 'indexed' || result.status === 'dry_run').length,
    rejected: results.filter((result) => result.status === 'rejected').length,
    failed: results.filter((result) => result.status === 'failed').length,
    chunks: results.reduce((sum, result) => sum + result.chunks, 0),
    embeddings: results.reduce((sum, result) => sum + result.embeddings, 0),
    results,
  };
}

type RetrievalRow = {
  chunk_id: string;
  source_id: string;
  source_version_id: string;
  text: string;
  category: string;
  allowed_use: string;
  verified_at: string;
  expires_at: string;
  risk: 'low' | 'medium' | 'high';
  distance: number | null;
  rank: number;
  channel: 'fts' | 'vector';
};

async function ftsSearch(input: KnowledgeSearchInput, limit: number): Promise<RetrievalRow[]> {
  if (!pool) return [];
  const res = await pool.query<RetrievalRow>(`
    select
      c.id as chunk_id,
      c.source_id,
      c.source_version_id,
      c.text,
      s.category,
      s.allowed_use,
      v.verified_at::text as verified_at,
      v.expires_at::text as expires_at,
      s.risk,
      null::numeric as distance,
      row_number() over (order by ts_rank_cd(c.search_tsv, websearch_to_tsquery('german', $3)) desc, c.created_at desc)::int as rank,
      'fts'::text as channel
    from kb_chunks c
    join kb_sources s on s.id = c.source_id and s.org_id = c.org_id and s.tenant_id = c.tenant_id
    join kb_source_versions v on v.id = c.source_version_id and v.source_id = c.source_id and v.org_id = c.org_id and v.tenant_id = c.tenant_id
    where c.org_id = $1
      and c.tenant_id = $2
      and s.review_status = 'approved'
      and s.current_version_id = v.id
      and v.status = 'indexed'
      and v.verified_at is not null
      and v.expires_at > now()
      and s.contains_pii = false
      and s.allowed_use = any($5::text[])
      and s.risk <> 'high'
      and c.search_tsv @@ websearch_to_tsquery('german', $3)
    order by ts_rank_cd(c.search_tsv, websearch_to_tsquery('german', $3)) desc, c.created_at desc
    limit $4
  `, [input.trustedScope.orgId, input.trustedScope.tenantId, input.query, limit, [...ALLOWED_OWN_KB_USES]]);
  return res.rows;
}

async function vectorSearch(input: KnowledgeSearchInput, embedding: number[] | null, limit: number): Promise<RetrievalRow[]> {
  if (!pool || !embedding) return [];
  await pool.query(`set local hnsw.iterative_scan = relaxed_order`).catch(() => {});
  const vector = `[${embedding.join(',')}]`;
  const res = await pool.query<RetrievalRow>(`
    select
      c.id as chunk_id,
      c.source_id,
      c.source_version_id,
      c.text,
      s.category,
      s.allowed_use,
      v.verified_at::text as verified_at,
      v.expires_at::text as expires_at,
      s.risk,
      (e.embedding <=> $3::vector)::numeric as distance,
      row_number() over (order by e.embedding <=> $3::vector)::int as rank,
      'vector'::text as channel
    from kb_embeddings e
    join kb_chunks c on c.id = e.chunk_id and c.org_id = e.org_id and c.tenant_id = e.tenant_id
    join kb_sources s on s.id = c.source_id and s.org_id = c.org_id and s.tenant_id = c.tenant_id
    join kb_source_versions v on v.id = c.source_version_id and v.source_id = c.source_id and v.org_id = c.org_id and v.tenant_id = c.tenant_id
    where e.org_id = $1
      and e.tenant_id = $2
      and e.embedding_model = $4
      and s.review_status = 'approved'
      and s.current_version_id = v.id
      and v.status = 'indexed'
      and v.verified_at is not null
      and v.expires_at > now()
      and s.contains_pii = false
      and s.allowed_use = any($6::text[])
      and s.risk <> 'high'
      and (e.embedding <=> $3::vector) <= $7
    order by e.embedding <=> $3::vector
    limit $5
  `, [input.trustedScope.orgId, input.trustedScope.tenantId, vector, DEFAULT_EMBED_MODEL, limit, [...ALLOWED_OWN_KB_USES], DEFAULT_MAX_VECTOR_DISTANCE]);
  return res.rows;
}

function reciprocalRankFuse(rows: RetrievalRow[], topK: number): KnowledgeSearchSnippet[] {
  const byChunk = new Map<string, KnowledgeSearchSnippet>();
  for (const row of rows) {
    const score = 1 / (60 + row.rank);
    const existing = byChunk.get(row.chunk_id);
    if (existing) {
      existing.score += score;
      if (row.distance !== null && (existing.distance === undefined || row.distance < existing.distance)) {
        existing.distance = Number(row.distance);
      }
      continue;
    }
    byChunk.set(row.chunk_id, {
      chunkId: row.chunk_id,
      sourceId: row.source_id,
      sourceVersionId: row.source_version_id,
      rank: 0,
      text: voiceSnippet(row.text),
      category: row.category,
      allowedUse: row.allowed_use,
      verifiedAt: row.verified_at,
      expiresAt: row.expires_at,
      risk: row.risk,
      distance: row.distance === null ? undefined : Number(row.distance),
      score,
    });
  }
  return [...byChunk.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

async function logRetrieval(input: KnowledgeSearchInput, result: KnowledgeSearchResult, errorCode?: string): Promise<string | null> {
  if (!pool) return null;
  try {
    const event = await pool.query<{ id: string }>(`
      insert into kb_retrieval_events
        (org_id, tenant_id, agent_id, call_id, turn_id, provider, query_hash, query_text_redacted, mode, top_k, latency_ms, answerable, confidence, error_code)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      returning id
    `, [
      input.trustedScope.orgId,
      input.trustedScope.tenantId,
      input.trustedScope.agentId,
      input.trustedScope.callId ?? input.trustedScope.sessionId ?? null,
      input.turnId ?? null,
      input.provider ?? 'internal',
      queryHash(input.query),
      redactForTrace(input.query).slice(0, 500),
      input.mode ?? 'balanced',
      result.snippets.length || clampTopK(input.topK),
      result.latencyMs,
      result.answerable,
      result.confidence,
      errorCode ?? null,
    ]);
    const eventId = event.rows[0]?.id;
    if (!eventId) return null;
    for (const snippet of result.snippets) {
      await pool.query(`
        insert into kb_retrieval_citations
          (event_id, org_id, tenant_id, rank, chunk_id, source_id, source_version_id, distance, snippet_redacted)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        eventId,
        input.trustedScope.orgId,
        input.trustedScope.tenantId,
        snippet.rank,
        snippet.chunkId,
        snippet.sourceId,
        snippet.sourceVersionId,
        snippet.distance ?? null,
        snippet.text,
      ]);
    }
    return eventId;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'knowledge.search retrieval logging failed');
    return null;
  }
}

export async function knowledgeSearch(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult> {
  const started = Date.now();
  const topK = clampTopK(input.topK);
  if (!isTrustedScope(input.trustedScope)) {
    return {
      answerable: false,
      confidence: 0,
      latencyMs: Date.now() - started,
      snippets: [],
      policy: { mayAnswer: false, mayMutate: false, reason: 'TRUSTED_SCOPE_REQUIRED' },
    };
  }
  if (!pool) {
    return {
      answerable: false,
      confidence: 0,
      latencyMs: Date.now() - started,
      snippets: [],
      policy: { mayAnswer: false, mayMutate: false, reason: 'DATABASE_UNAVAILABLE' },
    };
  }

  try {
    const embeddingPromise = embedQuery(input.query).catch((err) => {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'knowledge.search embedding unavailable; using FTS only');
      return null;
    });
    const [fts, vector] = await Promise.all([
      ftsSearch(input, 12),
      embeddingPromise.then((embedding) => vectorSearch(input, embedding, 24)),
    ]);
    const snippets = reciprocalRankFuse([...fts, ...vector], topK);
    const confidence = snippets.length ? Math.min(0.95, 0.55 + snippets[0]!.score * 8) : 0;
    const result: KnowledgeSearchResult = {
      answerable: snippets.length > 0 && confidence >= 0.55,
      confidence: Number(confidence.toFixed(3)),
      latencyMs: Date.now() - started,
      snippets,
      policy: {
        mayAnswer: snippets.length > 0 && confidence >= 0.55,
        mayMutate: false,
        reason: snippets.length ? 'APPROVED_CURRENT_FACTUAL_CONTEXT' : 'NO_APPROVED_CURRENT_SOURCE',
      },
    };
    const retrievalEventId = await logRetrieval(input, result);
    if (retrievalEventId) result.retrievalEventId = retrievalEventId;
    return result;
  } catch (err) {
    const result: KnowledgeSearchResult = {
      answerable: false,
      confidence: 0,
      latencyMs: Date.now() - started,
      snippets: [],
      policy: { mayAnswer: false, mayMutate: false, reason: 'RETRIEVAL_ERROR' },
    };
    const retrievalEventId = await logRetrieval(input, result, err instanceof Error ? err.message.slice(0, 80) : 'RETRIEVAL_ERROR');
    if (retrievalEventId) result.retrievalEventId = retrievalEventId;
    return result;
  }
}
