/**
 * DrKalla CENTRAL knowledge store (Postgres) + refresh orchestration.
 *
 * Architecture (owner decision 2026-07-05): the website scrape lands in the
 * central `drkalla_central_knowledge` table first — the canonical company
 * knowledge for ALL agents. The voice agent's latency-optimized in-memory
 * structures (catalog search, evidence, aliases, knowledge chunks) are then
 * derived DETERMINISTICALLY from the central rows (see the reload hook in
 * retell-drkalla-custom-llm-ws.ts). Fail-soft end to end: a failed scrape or
 * an unavailable DB never degrades the running voice agent — it keeps the
 * last good state.
 *
 * Why this exists: the baked snapshot drifted ~25% against the live shop in
 * one month (2026-07-05: 116 new products missing, 102 dead ones still
 * recommended) — data freshness must not depend on a manual re-scrape.
 */
import crypto from 'node:crypto';
import { pool } from './db.js';
import { scrapeDrkallaSite } from './scripts/scrape-drkalla-site.js';
import type { DrkallaKnowledgeSnapshot, DrkallaPageFact, DrkallaProduct } from './drkalla-rag-agent.js';

export type DrkallaCentralValidation = { ok: boolean; reasons: string[] };
export type DrkallaCentralUpsertCounts = {
  added: number;
  changed: number;
  unchanged: number;
  removed: number;
  activeProducts: number;
  activePages: number;
};
export type DrkallaCentralRefreshResult =
  | { status: 'ok'; snapshot: DrkallaKnowledgeSnapshot; counts: DrkallaCentralUpsertCounts; dbPersisted: boolean; durationMs: number }
  | { status: 'validation_failed'; reasons: string[]; durationMs: number }
  | { status: 'error'; error: string; durationMs: number };

// Scrape sanity gates — a broken/partial scrape (Shopify hiccup, bot block,
// theme change) must NEVER replace good data. Thresholds are deliberately
// loose; they catch catastrophes, not routine catalog churn.
const MIN_PRODUCTS = 100;
const MIN_PAGES = 3;
const MIN_PRICE_COVERAGE = 0.9;
const MIN_PREVIOUS_RATIO = 0.5;

export function validateDrkallaCentralScrape(
  snapshot: Pick<DrkallaKnowledgeSnapshot, 'products' | 'pages'>,
  previousActiveProducts: number,
): DrkallaCentralValidation {
  const reasons: string[] = [];
  const products = snapshot.products ?? [];
  const pages = snapshot.pages ?? [];
  if (products.length < MIN_PRODUCTS) reasons.push(`too_few_products:${products.length}`);
  if (previousActiveProducts > 0 && products.length < previousActiveProducts * MIN_PREVIOUS_RATIO) {
    reasons.push(`shrunk_vs_previous:${products.length}/${previousActiveProducts}`);
  }
  const broken = products.filter((p) => !p.handle || !p.title).length;
  if (broken > 0) reasons.push(`broken_products:${broken}`);
  if (products.length > 0) {
    const priced = products.filter((p) => (p.variants ?? []).some((v) => {
      const value = Number.parseFloat(String(v.price ?? ''));
      return Number.isFinite(value) && value > 0;
    })).length;
    if (priced / products.length < MIN_PRICE_COVERAGE) reasons.push(`price_coverage:${priced}/${products.length}`);
  }
  if (pages.length < MIN_PAGES) reasons.push(`too_few_pages:${pages.length}`);
  return { ok: reasons.length === 0, reasons };
}

function hashPayload(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

export async function readDrkallaCentralActiveProductCount(): Promise<number> {
  if (!pool) return 0;
  const res = await pool.query(`SELECT count(*)::int AS n FROM drkalla_central_knowledge WHERE kind = 'product' AND active`);
  return (res.rows[0]?.n as number | undefined) ?? 0;
}

export async function upsertDrkallaCentralKnowledge(
  snapshot: Pick<DrkallaKnowledgeSnapshot, 'products' | 'pages'>,
): Promise<DrkallaCentralUpsertCounts> {
  if (!pool) throw new Error('DB_UNAVAILABLE');
  const incoming: Array<{ kind: 'product' | 'page'; ref: string; payload: unknown }> = [
    ...(snapshot.products ?? []).map((p) => ({ kind: 'product' as const, ref: p.handle, payload: p })),
    ...(snapshot.pages ?? []).map((p) => ({ kind: 'page' as const, ref: p.url, payload: p })),
  ];
  const client = await pool.connect();
  const counts: DrkallaCentralUpsertCounts = { added: 0, changed: 0, unchanged: 0, removed: 0, activeProducts: 0, activePages: 0 };
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT kind, ref, content_hash, active FROM drkalla_central_knowledge WHERE kind IN ('product', 'page')`,
    );
    const byKey = new Map<string, { content_hash: string; active: boolean }>(
      existing.rows.map((r: { kind: string; ref: string; content_hash: string; active: boolean }) => [
        `${r.kind}:${r.ref}`,
        { content_hash: r.content_hash, active: r.active },
      ]),
    );
    for (const item of incoming) {
      const hash = hashPayload(item.payload);
      const prev = byKey.get(`${item.kind}:${item.ref}`);
      if (!prev) counts.added += 1;
      else if (prev.content_hash !== hash || !prev.active) counts.changed += 1;
      else counts.unchanged += 1;
      await client.query(
        `INSERT INTO drkalla_central_knowledge (kind, ref, payload, content_hash, active)
         VALUES ($1, $2, $3::jsonb, $4, TRUE)
         ON CONFLICT (kind, ref) DO UPDATE SET
           payload = EXCLUDED.payload,
           content_hash = EXCLUDED.content_hash,
           active = TRUE,
           updated_at = CASE
             WHEN drkalla_central_knowledge.content_hash IS DISTINCT FROM EXCLUDED.content_hash
               OR NOT drkalla_central_knowledge.active
             THEN now() ELSE drkalla_central_knowledge.updated_at END`,
        [item.kind, item.ref, JSON.stringify(item.payload), hash],
      );
    }
    const productRefs = (snapshot.products ?? []).map((p) => p.handle);
    const pageRefs = (snapshot.pages ?? []).map((p) => p.url);
    const removedProducts = await client.query(
      `UPDATE drkalla_central_knowledge SET active = FALSE, updated_at = now()
       WHERE kind = 'product' AND active AND NOT (ref = ANY($1::text[]))`,
      [productRefs],
    );
    const removedPages = await client.query(
      `UPDATE drkalla_central_knowledge SET active = FALSE, updated_at = now()
       WHERE kind = 'page' AND active AND NOT (ref = ANY($1::text[]))`,
      [pageRefs],
    );
    counts.removed = (removedProducts.rowCount ?? 0) + (removedPages.rowCount ?? 0);
    counts.activeProducts = productRefs.length;
    counts.activePages = pageRefs.length;
    await client.query('COMMIT');
    return counts;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => (value ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'de'))
    .slice(0, 80);
}

/**
 * Reconstruct the canonical snapshot from the ACTIVE central rows — the
 * deterministic source the voice derivation reads. Returns null when the DB
 * is unavailable or holds no products (then the baked file stays in charge).
 */
export async function readDrkallaCentralSnapshot(): Promise<DrkallaKnowledgeSnapshot | null> {
  if (!pool) return null;
  const res = await pool.query(
    `SELECT kind, payload, updated_at FROM drkalla_central_knowledge WHERE active ORDER BY kind, ref`,
  );
  const products: DrkallaProduct[] = [];
  const pages: DrkallaPageFact[] = [];
  let newest = 0;
  for (const row of res.rows as Array<{ kind: string; payload: unknown; updated_at: Date }>) {
    if (row.kind === 'product') products.push(row.payload as DrkallaProduct);
    else if (row.kind === 'page') pages.push(row.payload as DrkallaPageFact);
    const ts = row.updated_at instanceof Date ? row.updated_at.getTime() : Date.parse(String(row.updated_at));
    if (Number.isFinite(ts) && ts > newest) newest = ts;
  }
  if (!products.length) return null;
  return {
    scrapedAt: new Date(newest || Date.now()).toISOString(),
    source: 'drkalla-central-knowledge',
    productCount: products.length,
    products,
    pages,
    categories: uniqueSorted(products.map((p) => p.productType)),
    vendors: uniqueSorted(products.map((p) => p.vendor)),
  };
}

async function recordRefreshRun(run: {
  startedAt: Date;
  status: string;
  productCount?: number;
  pageCount?: number;
  added?: number;
  changed?: number;
  removed?: number;
  note?: string;
}): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO drkalla_central_refresh_runs (started_at, finished_at, status, product_count, page_count, added, changed, removed, note)
       VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8)`,
      [run.startedAt, run.status, run.productCount ?? null, run.pageCount ?? null, run.added ?? null, run.changed ?? null, run.removed ?? null, run.note ?? null],
    );
  } catch {
    // Run bookkeeping is best-effort — never let it break a refresh.
  }
}

/**
 * One full refresh cycle: scrape the live site → validate → persist to the
 * central DB → read the canonical state back. The returned snapshot is what
 * the voice derivation must consume (DB readback when persisted; the raw
 * validated scrape only when the DB is unavailable).
 */
export async function refreshDrkallaCentralKnowledge(
  scrape: () => Promise<DrkallaKnowledgeSnapshot> = scrapeDrkallaSite,
): Promise<DrkallaCentralRefreshResult> {
  const startedAt = new Date();
  try {
    const previousActive = await readDrkallaCentralActiveProductCount().catch(() => 0);
    const scraped = await scrape();
    const validation = validateDrkallaCentralScrape(scraped, previousActive);
    if (!validation.ok) {
      await recordRefreshRun({
        startedAt,
        status: 'validation_failed',
        productCount: scraped.products.length,
        pageCount: scraped.pages.length,
        note: validation.reasons.join(','),
      });
      return { status: 'validation_failed', reasons: validation.reasons, durationMs: Date.now() - startedAt.getTime() };
    }
    let counts: DrkallaCentralUpsertCounts = { added: 0, changed: 0, unchanged: 0, removed: 0, activeProducts: scraped.products.length, activePages: scraped.pages.length };
    let snapshot: DrkallaKnowledgeSnapshot = scraped;
    let dbPersisted = false;
    let dbNote: string | undefined;
    if (pool) {
      // A dead/paused DB must not stop the VOICE refresh (live 2026-07-05:
      // the Supabase project was paused and the whole refresh hard-failed).
      // The derive consumes the validated scrape directly; central
      // persistence resumes automatically once the DB is back.
      try {
        counts = await upsertDrkallaCentralKnowledge(scraped);
        snapshot = (await readDrkallaCentralSnapshot()) ?? scraped;
        dbPersisted = true;
      } catch (error) {
        dbNote = `db_error:${error instanceof Error ? error.message : String(error)}`.slice(0, 200);
      }
    }
    await recordRefreshRun({
      startedAt,
      status: dbPersisted ? 'ok' : 'ok_no_db',
      productCount: snapshot.products.length,
      pageCount: snapshot.pages.length,
      added: counts.added,
      changed: counts.changed,
      removed: counts.removed,
      note: dbNote,
    });
    return { status: 'ok', snapshot, counts, dbPersisted, durationMs: Date.now() - startedAt.getTime() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordRefreshRun({ startedAt, status: 'error', note: message.slice(0, 300) });
    return { status: 'error', error: message, durationMs: Date.now() - startedAt.getTime() };
  }
}
