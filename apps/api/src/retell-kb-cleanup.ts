import { deleteKnowledgeBase, listKnowledgeBases, listLLMs, type RetellKnowledgeBase, type RetellLLMSummary } from './retell.js';
import { log } from './logger.js';
import { pool } from './db.js';

const DEFAULT_DELETE_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_MIN_ORPHAN_AGE_MS = 60 * 60 * 1000;
const DEFAULT_MAX_DELETES_PER_RUN = 5;

type CleanupError = {
  knowledgeBaseId: string;
  message: string;
};

export type RetellKnowledgeBaseCleanupResult = {
  total: number;
  referenced: number;
  dbProtected: number;
  candidates: number;
  deleted: number;
  failed: number;
  skippedRecent: number;
  skippedNoTimestamp: number;
  skippedStatus: number;
  skippedDbProtected: number;
  skippedMaxDeletes: number;
  skippedReason?: 'LLM_LIST_PAGINATED' | 'DB_PROTECTION_UNAVAILABLE' | 'LOCK_NOT_ACQUIRED';
  dryRun: boolean;
  errors: CleanupError[];
};

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampMs(kb: RetellKnowledgeBase): number | null {
  const ts = kb.user_modified_timestamp;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  return ts < 10_000_000_000 ? ts * 1000 : ts;
}

function addKnowledgeBaseIds(target: Set<string>, ids: unknown): void {
  if (!Array.isArray(ids)) return;
  for (const id of ids) {
    if (typeof id === 'string' && id.trim()) target.add(id);
  }
}

function looksLikeRetellKnowledgeBaseId(value: string): boolean {
  return /^kb_[A-Za-z0-9_-]+$/.test(value.trim());
}

function keyMayContainRetellKnowledgeBaseId(key: string): boolean {
  return /(?:retell|knowledge|kb).*?(?:base|standby|rollback|previous|pending).*?id/i.test(key) ||
    /retellKnowledgeBaseId|previousRetellKnowledgeBaseId|retellKbStandbyId|retellKbRollbackId/i.test(key);
}

function collectRetellKnowledgeBaseIdsFromJson(value: unknown, target: Set<string>, parentKey = ''): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (looksLikeRetellKnowledgeBaseId(trimmed) && keyMayContainRetellKnowledgeBaseId(parentKey)) {
      target.add(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRetellKnowledgeBaseIdsFromJson(item, target, parentKey);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    collectRetellKnowledgeBaseIdsFromJson(item, target, key);
  }
}

export function referencedKnowledgeBaseIds(llms: RetellLLMSummary[]): Set<string> {
  const ids = new Set<string>();
  for (const llm of llms) {
    addKnowledgeBaseIds(ids, llm.knowledge_base_ids);
    addKnowledgeBaseIds(ids, llm.kb_config?.knowledge_base_ids);
  }
  return ids;
}

export async function dbProtectedKnowledgeBaseIds(): Promise<Set<string>> {
  const protectedIds = new Set<string>();
  if (!pool) throw new Error('DB_PROTECTION_UNAVAILABLE');

  const res = await pool.query<{ data: unknown }>(`select data from agent_configs`);
  for (const row of res.rows) collectRetellKnowledgeBaseIdsFromJson(row.data, protectedIds);
  const windows = await pool.query<{ knowledge_base_id: string }>(
    `select knowledge_base_id
       from retell_kb_protection_windows
      where expires_at > now()`,
  );
  for (const row of windows.rows) {
    if (row.knowledge_base_id) protectedIds.add(row.knowledge_base_id);
  }
  return protectedIds;
}

export async function protectRetellKnowledgeBaseWindow(input: {
  knowledgeBaseId: string;
  orgId?: string | null;
  tenantId?: string | null;
  reason: 'pending_deploy' | 'rollback_standby' | 'manual_hold';
  expiresAt: Date | string;
  context?: Record<string, unknown>;
}): Promise<void> {
  if (!pool) return;
  const expiresAt = input.expiresAt instanceof Date ? input.expiresAt.toISOString() : input.expiresAt;
  await pool.query(
    `insert into retell_kb_protection_windows
       (knowledge_base_id, org_id, tenant_id, reason, expires_at, context, updated_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, now())
     on conflict (knowledge_base_id) do update
       set org_id = coalesce(excluded.org_id, retell_kb_protection_windows.org_id),
           tenant_id = coalesce(excluded.tenant_id, retell_kb_protection_windows.tenant_id),
           reason = excluded.reason,
           expires_at = greatest(retell_kb_protection_windows.expires_at, excluded.expires_at),
           context = retell_kb_protection_windows.context || excluded.context,
           updated_at = now()`,
    [
      input.knowledgeBaseId,
      input.orgId ?? null,
      input.tenantId ?? null,
      input.reason,
      expiresAt,
      JSON.stringify(input.context ?? {}),
    ],
  );
}

export async function recordRetellKnowledgeBaseCleanupFailure(input: {
  knowledgeBaseId: string;
  knowledgeBaseName?: string;
  source?: string;
  error: unknown;
  attempts?: number;
  context?: Record<string, unknown>;
}): Promise<void> {
  if (!pool) return;
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  try {
    const updated = await pool.query(
      `update retell_kb_cleanup_failures
          set knowledge_base_name = coalesce($2, knowledge_base_name),
              source = $3,
              error = $4,
              attempts = attempts + $5,
              context = context || $6::jsonb,
              last_failed_at = now(),
              next_retry_at = now() + interval '1 hour'
        where knowledge_base_id = $1
          and resolved_at is null`,
      [
        input.knowledgeBaseId,
        input.knowledgeBaseName ?? null,
        input.source ?? 'unknown',
        message.slice(0, 2000),
        input.attempts ?? 0,
        JSON.stringify(input.context ?? {}),
      ],
    );
    if ((updated.rowCount ?? 0) > 0) return;

    await pool.query(
      `insert into retell_kb_cleanup_failures
        (knowledge_base_id, knowledge_base_name, source, error, attempts, context, next_retry_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, now() + interval '1 hour')`,
      [
        input.knowledgeBaseId,
        input.knowledgeBaseName ?? null,
        input.source ?? 'unknown',
        message.slice(0, 2000),
        input.attempts ?? 0,
        JSON.stringify(input.context ?? {}),
      ],
    );
  } catch (err) {
    log.warn(
      {
        knowledgeBaseId: input.knowledgeBaseId,
        err: err instanceof Error ? err.message : String(err),
      },
      'Failed to persist Retell KB cleanup failure',
    );
  }
}

export async function deleteKnowledgeBaseWithRetry(
  knowledgeBaseId: string,
  opts: {
    attempts?: number;
    delayMs?: number;
    knowledgeBaseName?: string;
    context?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_DELETE_ATTEMPTS);
  const delayMs = Math.max(0, opts.delayMs ?? DEFAULT_RETRY_DELAY_MS);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await deleteKnowledgeBase(knowledgeBaseId);
      if (attempt > 1) {
        log.info({ knowledgeBaseId, attempt, ...opts.context }, 'Retell KB cleanup succeeded after retry');
      }
      return;
    } catch (err) {
      lastErr = err;
      log.warn(
        {
          knowledgeBaseId,
          attempt,
          attempts,
          err: err instanceof Error ? err.message : String(err),
          ...opts.context,
        },
        'Retell KB cleanup attempt failed',
      );
      if (attempt < attempts) await sleep(delayMs * attempt);
    }
  }

  const finalError = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  await recordRetellKnowledgeBaseCleanupFailure({
    knowledgeBaseId,
    knowledgeBaseName: opts.knowledgeBaseName,
    source: typeof opts.context?.source === 'string' ? opts.context.source : 'delete-with-retry',
    error: finalError,
    attempts,
    context: opts.context,
  });
  throw finalError;
}

export type RetellKnowledgeBaseCleanupRetryResult = {
  attempted: number;
  resolved: number;
  failed: number;
  skippedReferenced: number;
  skippedDbProtected: number;
  skippedRecent: number;
  skippedStatus: number;
  skippedNoTimestamp: number;
  skippedMissing: number;
  skippedGuardUnavailable: number;
};

export async function retryRetellKnowledgeBaseCleanupFailures(opts: {
  limit?: number;
  attempts?: number;
  delayMs?: number;
  minAgeMs?: number;
  nowMs?: number;
} = {}): Promise<RetellKnowledgeBaseCleanupRetryResult> {
  const empty: RetellKnowledgeBaseCleanupRetryResult = {
    attempted: 0,
    resolved: 0,
    failed: 0,
    skippedReferenced: 0,
    skippedDbProtected: 0,
    skippedRecent: 0,
    skippedStatus: 0,
    skippedNoTimestamp: 0,
    skippedMissing: 0,
    skippedGuardUnavailable: 0,
  };
  if (!pool) return empty;

  const limit = Math.max(0, Math.min(20, opts.limit ?? DEFAULT_MAX_DELETES_PER_RUN));
  if (limit === 0) return empty;

  const attempts = Math.max(1, opts.attempts ?? DEFAULT_DELETE_ATTEMPTS);
  const delayMs = Math.max(0, opts.delayMs ?? DEFAULT_RETRY_DELAY_MS);
  const minAgeMs = Math.max(0, opts.minAgeMs ?? DEFAULT_MIN_ORPHAN_AGE_MS);
  const nowMs = opts.nowMs ?? Date.now();
  const rows = await pool.query<{
    id: string;
    knowledge_base_id: string;
    knowledge_base_name: string | null;
    attempts: number;
    context: unknown;
  }>(`
    select id, knowledge_base_id, knowledge_base_name, attempts, context
      from retell_kb_cleanup_failures
     where resolved_at is null
       and (next_retry_at is null or next_retry_at <= now())
     order by coalesce(next_retry_at, last_failed_at), first_failed_at
     limit $1
  `, [limit]);

  if (!rows.rows.length) return empty;

  let knowledgeBasesById: Map<string, RetellKnowledgeBase>;
  let referencedIds: Set<string>;
  let dbProtectedIds: Set<string>;
  try {
    const [knowledgeBases, llmPage] = await Promise.all([listKnowledgeBases(), listLLMs()]);
    if (llmPage.hasMore) {
      return { ...empty, skippedGuardUnavailable: rows.rows.length };
    }
    knowledgeBasesById = new Map(knowledgeBases.map((kb) => [kb.knowledge_base_id, kb]));
    referencedIds = referencedKnowledgeBaseIds(llmPage.items);
    dbProtectedIds = await dbProtectedKnowledgeBaseIds();
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Retell KB cleanup retry guard unavailable');
    return { ...empty, skippedGuardUnavailable: rows.rows.length };
  }

  const result: RetellKnowledgeBaseCleanupRetryResult = { ...empty };
  for (const row of rows.rows) {
    if (referencedIds.has(row.knowledge_base_id)) {
      result.skippedReferenced += 1;
      continue;
    }
    if (dbProtectedIds.has(row.knowledge_base_id)) {
      result.skippedDbProtected += 1;
      continue;
    }

    const kb = knowledgeBasesById.get(row.knowledge_base_id);
    if (!kb) {
      await pool.query(`update retell_kb_cleanup_failures set resolved_at = now() where id = $1`, [row.id]);
      result.resolved += 1;
      result.skippedMissing += 1;
      continue;
    }
    if (kb.status !== 'complete') {
      result.skippedStatus += 1;
      continue;
    }
    const modifiedMs = timestampMs(kb);
    if (modifiedMs === null) {
      result.skippedNoTimestamp += 1;
      continue;
    }
    if (nowMs - modifiedMs < minAgeMs) {
      result.skippedRecent += 1;
      continue;
    }

    result.attempted += 1;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await deleteKnowledgeBase(row.knowledge_base_id);
        await pool.query(`update retell_kb_cleanup_failures set resolved_at = now(), attempts = attempts + $2 where id = $1`, [row.id, attempt]);
        result.resolved += 1;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < attempts && delayMs > 0) await sleep(delayMs);
      }
    }
    if (lastErr) {
      result.failed += 1;
      const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
      await pool.query(`
        update retell_kb_cleanup_failures
           set error = $2,
               attempts = attempts + $3,
               last_failed_at = now(),
               next_retry_at = now() + interval '1 hour'
         where id = $1
      `, [row.id, message.slice(0, 2000), attempts]).catch(() => {});
      log.warn({
        knowledgeBaseId: row.knowledge_base_id,
        knowledgeBaseName: row.knowledge_base_name,
        err: message,
        context: row.context,
      }, 'Retell KB cleanup retry failed');
    }
  }

  return result;
}

export async function cleanupUnreferencedRetellKnowledgeBases(opts: {
  dryRun?: boolean;
  minAgeMs?: number;
  maxDeletes?: number;
  nowMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  requireDbProtection?: boolean;
  protectedKnowledgeBaseIds?: Set<string>;
} = {}): Promise<RetellKnowledgeBaseCleanupResult> {
  const dryRun = opts.dryRun ?? true;
  const minAgeMs = Math.max(0, opts.minAgeMs ?? DEFAULT_MIN_ORPHAN_AGE_MS);
  const maxDeletes = Math.max(0, opts.maxDeletes ?? DEFAULT_MAX_DELETES_PER_RUN);
  const nowMs = opts.nowMs ?? Date.now();
  const [knowledgeBases, llmPage] = await Promise.all([listKnowledgeBases(), listLLMs()]);

  const baseResult: RetellKnowledgeBaseCleanupResult = {
    total: knowledgeBases.length,
    referenced: 0,
    dbProtected: 0,
    candidates: 0,
    deleted: 0,
    failed: 0,
    skippedRecent: 0,
    skippedNoTimestamp: 0,
    skippedStatus: 0,
    skippedDbProtected: 0,
    skippedMaxDeletes: 0,
    dryRun,
    errors: [],
  };

  if (llmPage.hasMore) {
    return { ...baseResult, skippedReason: 'LLM_LIST_PAGINATED' };
  }

  let dbProtectedIds: Set<string>;
  try {
    dbProtectedIds = await dbProtectedKnowledgeBaseIds();
    for (const id of opts.protectedKnowledgeBaseIds ?? []) dbProtectedIds.add(id);
  } catch (err) {
    if (opts.requireDbProtection !== false && !dryRun) {
      return { ...baseResult, skippedReason: 'DB_PROTECTION_UNAVAILABLE' };
    }
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Retell KB cleanup DB protection unavailable; dry-run/report only');
    dbProtectedIds = new Set();
  }

  const referencedIds = referencedKnowledgeBaseIds(llmPage.items);
  const candidates: RetellKnowledgeBase[] = [];
  let referencedCount = 0;
  let dbProtectedCount = 0;

  for (const kb of knowledgeBases) {
    if (referencedIds.has(kb.knowledge_base_id)) {
      referencedCount += 1;
      continue;
    }
    if (dbProtectedIds.has(kb.knowledge_base_id)) {
      dbProtectedCount += 1;
      baseResult.skippedDbProtected += 1;
      continue;
    }
    if (kb.status !== 'complete') {
      baseResult.skippedStatus += 1;
      continue;
    }
    const modifiedMs = timestampMs(kb);
    if (modifiedMs === null) {
      baseResult.skippedNoTimestamp += 1;
      continue;
    }
    if (nowMs - modifiedMs < minAgeMs) {
      baseResult.skippedRecent += 1;
      continue;
    }
    candidates.push(kb);
  }

  baseResult.referenced = referencedCount;
  baseResult.dbProtected = dbProtectedCount;
  baseResult.candidates = candidates.length;

  const deleteNow = candidates.slice(0, maxDeletes);
  baseResult.skippedMaxDeletes = Math.max(0, candidates.length - deleteNow.length);

  for (const kb of deleteNow) {
    if (dryRun) continue;
    try {
      await deleteKnowledgeBaseWithRetry(kb.knowledge_base_id, {
        attempts: opts.retryAttempts,
        delayMs: opts.retryDelayMs,
        knowledgeBaseName: kb.knowledge_base_name,
        context: { knowledgeBaseName: kb.knowledge_base_name, source: 'orphan-sweep' },
      });
      baseResult.deleted += 1;
    } catch (err) {
      baseResult.failed += 1;
      baseResult.errors.push({
        knowledgeBaseId: kb.knowledge_base_id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return baseResult;
}
