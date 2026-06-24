/**
 * Runtime "publish overlay" for the DrKalla phone agent.
 *
 * The agent grounds from in-memory snapshots baked into the image. To let the
 * owner edit the FAQ in the platform (dr-kalla-ultimate-app) and have it take
 * effect WITHOUT a redeploy, the platform POSTs the approved FAQ (+ an on/off
 * flag) to an authenticated admin endpoint; this module turns that payload into a
 * live FAQ matcher that overrides the baked one, and carries the on/off override.
 *
 * v1 is IN-MEMORY only (no disk persistence): a publish takes effect in seconds;
 * a container restart reverts to the baked snapshot until the next publish (the
 * platform is the source of truth + shows "last published"). Pure, synchronous,
 * no network — same latency posture as the rest of the runtime.
 */

import {
  buildDrkallaFaqMatcher,
  type DrkallaFaqMatcher,
  type DrkallaFaqRawEntry,
} from './drkalla-faq-match.js';
import {
  buildDrkallaKnowledgeRetriever,
  type DrkallaKnowledgeRetriever,
} from './drkalla-knowledge-chunks-retriever.js';
import { buildDrkallaKnowledgeChunks } from './scripts/build-drkalla-knowledge-chunks.js';

export type DrkallaPublishFaqEntry = {
  id?: unknown;
  question?: unknown;
  triggers?: unknown;
  answer?: unknown;
  tags?: unknown;
};

export type DrkallaPublishKnowledgeSource = {
  id?: unknown;
  title?: unknown;
  content?: unknown;
};

export type DrkallaPublishPayload = {
  enabled?: unknown;   // boolean on/off override; omitted = no override
  faq?: unknown;       // DrkallaPublishFaqEntry[]
  knowledge?: unknown; // DrkallaPublishKnowledgeSource[]
};

export type DrkallaLiveOverlay = {
  faqMatch?: DrkallaFaqMatcher;                 // overrides the baked faqMatch when present
  knowledgeRetriever?: DrkallaKnowledgeRetriever; // overrides the baked retriever when present
  enabled?: boolean;                            // on/off override; undefined = defer to env
  publishedAt?: string;
  faqCount: number;
  knowledgeChunks: number;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Map a published FAQ list to the matcher's raw-entry shape. The question itself
 * (plus any tags/explicit triggers) become the normalized substring triggers; the
 * matcher already normalizes German text and picks the most specific match.
 */
export function publishedFaqToEntries(faq: unknown): DrkallaFaqRawEntry[] {
  if (!Array.isArray(faq)) return [];
  const entries: DrkallaFaqRawEntry[] = [];
  faq.forEach((raw, i) => {
    const e = raw as DrkallaPublishFaqEntry;
    const answer = typeof e?.answer === 'string' ? e.answer.trim() : '';
    if (!answer) return;
    const triggers = [
      ...(typeof e?.question === 'string' ? [e.question] : []),
      ...asStringArray(e?.triggers),
      ...asStringArray(e?.tags),
    ].map((t) => t.trim()).filter(Boolean);
    if (!triggers.length) return;
    entries.push({
      id: typeof e?.id === 'string' && e.id ? e.id : `pub-${i}`,
      triggers,
      answer,
      enabled: true,
    });
  });
  return entries;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Turn published knowledge sources (free text / PDF text) into a live retriever,
 * reusing the same offline chunker the baked snapshot uses (no embeddings → no
 * network). Returns null when there is nothing to index.
 */
export async function buildKnowledgeRetrieverFromPublish(
  knowledge: unknown,
  nowIso: string,
): Promise<{ retriever?: DrkallaKnowledgeRetriever; chunkCount: number }> {
  const sources = Array.isArray(knowledge) ? knowledge : [];
  const seeds = sources
    .map((raw, i) => {
      const s = raw as DrkallaPublishKnowledgeSource;
      const content = asString(s?.content).trim();
      if (content.length < 20) return null;
      return {
        sourceId: typeof s?.id === 'string' && s.id ? `pub:${s.id}` : `pub-doc:${i}`,
        sourceTitle: asString(s?.title).trim().slice(0, 200) || 'Wissensquelle',
        category: 'generic',
        text: content,
      };
    })
    .filter((v): v is { sourceId: string; sourceTitle: string; category: string; text: string } => v !== null);
  if (!seeds.length) return { chunkCount: 0 };
  const snapshot = await buildDrkallaKnowledgeChunks({ seeds, withEmbeddings: false, now: new Date(nowIso) });
  if (!snapshot.chunks.length) return { chunkCount: 0 };
  // Owner-curated + typically small: a looser confidence gate than the big baked
  // corpus (whose corpus-wide IDF is high). Otherwise a freshly-published source
  // with few chunks scores below the default gate and the model answers
  // UNGROUNDED — i.e. can hallucinate the opposite of what was just published.
  return {
    retriever: buildDrkallaKnowledgeRetriever(snapshot, { confidence: 0.3 }),
    chunkCount: snapshot.chunks.length,
  };
}

/**
 * Build the live overlay from a publish payload. `nowIso` is injected so the
 * stamping stays deterministic. Async because knowledge chunking is async.
 */
export async function buildDrkallaLiveOverlay(payload: DrkallaPublishPayload, nowIso: string): Promise<DrkallaLiveOverlay> {
  const entries = publishedFaqToEntries(payload?.faq);
  const knowledge = await buildKnowledgeRetrieverFromPublish(payload?.knowledge, nowIso);
  return {
    faqMatch: entries.length ? buildDrkallaFaqMatcher(entries) : undefined,
    knowledgeRetriever: knowledge.retriever,
    enabled: typeof payload?.enabled === 'boolean' ? payload.enabled : undefined,
    publishedAt: nowIso,
    faqCount: entries.length,
    knowledgeChunks: knowledge.chunkCount,
  };
}
