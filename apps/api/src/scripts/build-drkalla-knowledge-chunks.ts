/**
 * Offline ingest: build the DrKalla knowledge-chunk snapshot.
 *
 * Produces apps/api/data/drkalla-rag/drkalla-knowledge-chunks.json — the in-memory
 * grounding source for free-text knowledge (shop policies, product usage/info, and
 * any ingested document/PDF). Runs OFFLINE (deploy / content-update only); nothing
 * here touches the call path. Mirrors the sibling snapshot generators: read seeds,
 * normalize, chunk, precompute the lexical (BM25) statistics, write JSON.
 *
 * Seeds (v1, all real, makes the KB complete immediately):
 *   - shop pages from drkalla-products.json (Versand, Widerruf, AGB, Kontakt, …) -> policies
 *   - product descriptions from drkalla-products.json -> usage/info
 *   - curated FAQ answers from drkalla-faq.json -> policies
 *   - optional --doc <txt|md> and --pdf <file> (PDF via OCR, fail-soft) -> generic
 *
 * Embeddings are precomputed only with --embeddings (default OFF, so a no-OpenAI
 * build still ships a valid lexical snapshot; runtime is lexical-only either way).
 *
 * Usage (from apps/api): node node_modules/tsx/dist/cli.mjs src/scripts/build-drkalla-knowledge-chunks.ts [--out PATH] [--doc PATH]... [--pdf PATH]... [--embeddings]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeDrkallaFaqText, type DrkallaFaqRawEntry } from '../drkalla-faq-match.js';
import { tokenizeDrkallaKnowledge, type DrkallaKnowledgeChunk, type DrkallaKnowledgeChunksSnapshot } from '../drkalla-knowledge-chunks-retriever.js';
import { ocrPdfWithOpenAI } from '../knowledge-ocr.js';

const DEFAULT_MAX_CHARS = 700;
const DEFAULT_OVERLAP = 120;
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
const EMBED_DIM = 1536;
const EXPIRES_DAYS = 90;
const KEYWORDS_PER_CHUNK = 6;

export type KnowledgeSeed = { sourceId: string; sourceTitle: string; category: string; text: string };

function dataDir(): string {
  // Script lives in apps/api/src/scripts; data is apps/api/data/drkalla-rag.
  return path.resolve(process.cwd(), 'data', 'drkalla-rag');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&amp;/g, 'und')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&[a-z]+;/gi, ' ');
}

// Voice-safe cleanup: decode entities, strip leading bullets/codes, collapse
// whitespace, drop URLs (the agent points to drkalla.com itself).
function cleanText(value: string): string {
  return decodeEntities(value)
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/^[\s•·\-–—*]+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanTitle(value: string): string {
  return decodeEntities(value).split('|')[0]?.replace(/\s+/g, ' ').trim() || decodeEntities(value).trim();
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

// Local chunker mirroring own-kb's chunkKnowledgeText (kept dependency-free so the
// offline build never imports the DB pool). Splits on paragraph + sentence
// boundaries, accumulates up to maxChars with a char overlap carried forward.
function chunkText(input: string, maxChars: number, overlapChars: number): string[] {
  const normalized = input.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!normalized) return [];
  const parts = normalized
    .split(/\n{2,}/g)
    .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/g))
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  const push = () => { const t = current.trim(); if (t) chunks.push(t); };
  for (const part of parts.length ? parts : [normalized]) {
    if (!current) { current = part; continue; }
    if (`${current} ${part}`.length <= maxChars) { current = `${current} ${part}`; continue; }
    push();
    const overlap = overlapChars > 0 ? current.slice(-overlapChars).replace(/^\S*\s*/, '').trim() : '';
    current = overlap ? `${overlap} ${part}` : part;
    while (current.length > maxChars) {
      chunks.push(current.slice(0, maxChars).trim());
      current = current.slice(Math.max(0, maxChars - overlapChars)).trim();
    }
  }
  push();
  return chunks;
}

const POLICY_PAGE_RE = /versand|lieferung|widerruf|r(ü|ue)ckgab|agb|gesch(ä|ae)ftsbeding|kontakt|impressum|datenschutz|(ü|ue)ber\s+dr/i;

// Data-based seed builder, shared by this CLI and the in-process central-
// knowledge refresh (drkalla-central-knowledge.ts) so both derive IDENTICAL
// chunks from the same catalog state.
export function buildDrkallaKnowledgeSeedsFromData(input: {
  products?: Array<{ handle?: string; title?: string; description?: string }>;
  pages?: Array<{ title?: string; url?: string; text?: string }>;
  faqEntries?: DrkallaFaqRawEntry[];
}): KnowledgeSeed[] {
  const seeds: KnowledgeSeed[] = [];
  for (const page of input.pages ?? []) {
    if (typeof page?.text !== 'string' || page.text.trim().length < 40) continue;
    const title = cleanTitle(page.title ?? 'Information');
    if (!POLICY_PAGE_RE.test(title)) continue; // skip home / nav index pages
    seeds.push({ sourceId: `page:${sha256(page.url ?? title).slice(0, 10)}`, sourceTitle: title, category: 'policies', text: cleanText(page.text) });
  }
  for (const p of input.products ?? []) {
    if (typeof p?.handle !== 'string' || !p.handle) continue;
    if (typeof p.description !== 'string' || p.description.trim().length < 40) continue;
    const title = cleanTitle(p.title ?? p.handle);
    seeds.push({
      sourceId: `product:${p.handle}`,
      sourceTitle: title.slice(0, 70),
      category: 'usage',
      text: cleanText(`${title}. ${p.description}`),
    });
  }
  for (const e of input.faqEntries ?? []) {
    if (e?.enabled === false) continue;
    if (typeof e?.id !== 'string' || typeof e?.answer !== 'string' || e.answer.trim().length < 20) continue;
    const tag = Array.isArray(e.tags) && typeof e.tags[0] === 'string' ? e.tags[0] : e.id;
    seeds.push({ sourceId: `faq:${e.id}`, sourceTitle: cleanTitle(String(tag)), category: 'policies', text: cleanText(e.answer) });
  }
  return seeds;
}

function seedsFromProducts(productsPath: string): KnowledgeSeed[] {
  const raw = JSON.parse(readFileSync(productsPath, 'utf8')) as {
    products?: Array<{ handle?: string; title?: string; description?: string; productType?: string; vendor?: string }>;
    pages?: Array<{ title?: string; url?: string; text?: string }>;
  };
  return buildDrkallaKnowledgeSeedsFromData({ products: raw.products, pages: raw.pages });
}

function seedsFromFaq(faqPath: string): KnowledgeSeed[] {
  let parsed: { entries?: DrkallaFaqRawEntry[] };
  try { parsed = JSON.parse(readFileSync(faqPath, 'utf8')); } catch { return []; }
  return buildDrkallaKnowledgeSeedsFromData({ faqEntries: parsed.entries });
}

function seedFromDoc(docPath: string): KnowledgeSeed {
  const text = cleanText(readFileSync(docPath, 'utf8'));
  return { sourceId: `doc:${sha256(docPath).slice(0, 10)}`, sourceTitle: cleanTitle(path.basename(docPath).replace(/\.[a-z0-9]+$/i, '')), category: 'generic', text };
}

async function seedFromPdf(pdfPath: string): Promise<KnowledgeSeed | null> {
  const data = readFileSync(pdfPath);
  const result = await ocrPdfWithOpenAI({ filename: path.basename(pdfPath), mimeType: 'application/pdf', sizeBytes: data.byteLength, data });
  if ('error' in result) {
    console.warn(`[pdf] skipped ${pdfPath}: ${result.error}`);
    return null;
  }
  return { sourceId: `pdf:${sha256(pdfPath).slice(0, 10)}`, sourceTitle: cleanTitle(path.basename(pdfPath).replace(/\.pdf$/i, '')), category: 'generic', text: cleanText(result.text) };
}

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !texts.length) return texts.map(() => null);
  const out: (number[] | null)[] = [];
  const BATCH = 96;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, input: batch, dimensions: EMBED_DIM }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`embed ${res.status}`);
      const data = await res.json() as { data?: Array<{ embedding?: number[]; index?: number }> };
      const sorted = (data.data ?? []).sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
      for (const item of sorted) out.push(Array.isArray(item.embedding) && item.embedding.length === EMBED_DIM ? item.embedding : null);
      if (sorted.length !== batch.length) for (let k = sorted.length; k < batch.length; k++) out.push(null);
      process.stderr.write(`  embedded ${Math.min(i + BATCH, texts.length)}/${texts.length}\n`);
    } catch (err) {
      console.warn(`[embed] batch ${i} failed: ${err instanceof Error ? err.message : String(err)} — continuing with null`);
      for (const _ of batch) out.push(null);
    }
  }
  return out;
}

export async function buildDrkallaKnowledgeChunks(opts: {
  seeds: KnowledgeSeed[];
  maxChars?: number;
  overlapChars?: number;
  withEmbeddings?: boolean;
  now?: Date;
}): Promise<DrkallaKnowledgeChunksSnapshot> {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = opts.overlapChars ?? DEFAULT_OVERLAP;
  const now = opts.now ?? new Date();
  const verifiedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + EXPIRES_DAYS * 86_400_000).toISOString();

  type Built = { chunk: Omit<DrkallaKnowledgeChunk, 'keywords' | 'embedding'>; tokens: string[]; uniqueTokens: string[] };
  const built: Built[] = [];
  for (const seed of opts.seeds) {
    const pieces = chunkText(seed.text, maxChars, overlapChars);
    let offset = 0;
    pieces.forEach((text, index) => {
      const normalizedText = normalizeDrkallaFaqText(text);
      const tokens = tokenizeDrkallaKnowledge(normalizedText);
      if (!tokens.length) return;
      const charStart = offset;
      const charEnd = offset + text.length;
      offset = charEnd;
      built.push({
        chunk: {
          chunkId: `${seed.sourceId}:${index}`,
          sourceId: seed.sourceId,
          sourceTitle: seed.sourceTitle,
          category: seed.category,
          index,
          text,
          normalizedText,
          charStart,
          charEnd,
          tokenCount: estimateTokens(text),
          contentHash: sha256(text),
          risk: 'low',
          verifiedAt,
          expiresAt,
        },
        tokens,
        uniqueTokens: [...new Set(tokens)],
      });
    });
  }

  // Corpus stats for BM25 + tf-idf keyword extraction.
  const df: Record<string, number> = {};
  for (const b of built) for (const t of b.uniqueTokens) df[t] = (df[t] ?? 0) + 1;
  const docCount = built.length;
  const avgDocLen = docCount ? built.reduce((s, b) => s + b.tokens.length, 0) / docCount : 1;
  const idf = (t: string) => { const n = df[t] ?? 0; return n > 0 ? Math.log(1 + (docCount - n + 0.5) / (n + 0.5)) : 0; };

  const embeddings = opts.withEmbeddings ? await embedBatch(built.map((b) => b.chunk.text)) : built.map(() => null);

  const chunks: DrkallaKnowledgeChunk[] = built.map((b, i) => {
    const tf = new Map<string, number>();
    for (const t of b.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const keywords = [...tf.entries()]
      .map(([t, c]) => ({ t, s: c * idf(t) }))
      .sort((a, z) => z.s - a.s)
      .slice(0, KEYWORDS_PER_CHUNK)
      .map((x) => x.t);
    return { ...b.chunk, keywords, embedding: embeddings[i] ?? null };
  });

  return {
    version: 'drkalla-knowledge-chunks-v1',
    generatedAt: now.toISOString(),
    embeddingModel: EMBED_MODEL,
    embeddingDim: EMBED_DIM,
    chunkParams: { maxChars, overlapChars },
    metadata: {
      totalSources: new Set(opts.seeds.map((s) => s.sourceId)).size,
      totalChunks: chunks.length,
      embeddingsCount: chunks.filter((c) => Array.isArray(c.embedding)).length,
    },
    chunks,
    bm25: { avgDocLen: Number(avgDocLen.toFixed(3)), df },
  };
}

function parseArgs(argv: string[]) {
  const out: { out?: string; products?: string; faq?: string; docs: string[]; pdfs: string[]; embeddings: boolean; maxChars?: number; overlap?: number } =
    { docs: [], pdfs: [], embeddings: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i];
    else if (a === '--products') out.products = argv[++i];
    else if (a === '--faq') out.faq = argv[++i];
    else if (a === '--doc') { const v = argv[++i]; if (v) out.docs.push(v); }
    else if (a === '--pdf') { const v = argv[++i]; if (v) out.pdfs.push(v); }
    else if (a === '--embeddings') out.embeddings = true;
    else if (a === '--max-chars') out.maxChars = Number(argv[++i]);
    else if (a === '--overlap') out.overlap = Number(argv[++i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = dataDir();
  const productsPath = args.products ?? path.join(dir, 'drkalla-products.json');
  const faqPath = args.faq ?? path.join(dir, 'drkalla-faq.json');
  const outPath = args.out ?? path.join(dir, 'drkalla-knowledge-chunks.json');

  const seeds: KnowledgeSeed[] = [];
  seeds.push(...seedsFromProducts(productsPath));
  seeds.push(...seedsFromFaq(faqPath));
  for (const doc of args.docs) seeds.push(seedFromDoc(doc));
  for (const pdf of args.pdfs) { const s = await seedFromPdf(pdf); if (s) seeds.push(s); }

  const policyCount = seeds.filter((s) => s.category === 'policies').length;
  const usageCount = seeds.filter((s) => s.category === 'usage').length;
  const genericCount = seeds.filter((s) => s.category === 'generic').length;
  console.log(`Seeds: ${seeds.length} (policies ${policyCount}, usage ${usageCount}, generic ${genericCount})`);

  const snapshot = await buildDrkallaKnowledgeChunks({
    seeds,
    maxChars: args.maxChars,
    overlapChars: args.overlap,
    withEmbeddings: args.embeddings,
  });

  if (!snapshot.chunks.length) { console.error('No chunks produced — aborting.'); process.exit(1); }
  writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  console.log(`Wrote ${snapshot.chunks.length} chunks (${snapshot.metadata.embeddingsCount} embedded) -> ${outPath} (${(bytes / 1024).toFixed(0)} KB)`);
  if (bytes > 5 * 1024 * 1024) console.warn('WARNING: snapshot > 5MB; consider dropping embeddings (runtime is lexical-only).');
}

// Run only when invoked directly (not when imported by tests).
if ((process.argv[1] ?? '').endsWith('build-drkalla-knowledge-chunks.ts')) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
