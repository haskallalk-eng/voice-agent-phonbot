import { describe, expect, it } from 'vitest';
import {
  buildDrkallaKnowledgeRetriever,
  tokenizeDrkallaKnowledge,
  type DrkallaKnowledgeChunk,
  type DrkallaKnowledgeChunksSnapshot,
} from '../drkalla-knowledge-chunks-retriever.js';
import { normalizeDrkallaFaqText } from '../drkalla-faq-match.js';

const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';

function mk(partial: Partial<DrkallaKnowledgeChunk> & { chunkId: string; text: string }): DrkallaKnowledgeChunk {
  return {
    sourceId: partial.sourceId ?? partial.chunkId.split(':')[0] ?? 'src',
    sourceTitle: partial.sourceTitle ?? 'Quelle',
    category: partial.category ?? 'policies',
    index: partial.index ?? 0,
    normalizedText: partial.normalizedText ?? '', // retriever falls back to normalize(text)
    keywords: partial.keywords ?? [],
    charStart: 0,
    charEnd: partial.text.length,
    tokenCount: Math.ceil(partial.text.length / 4),
    contentHash: 'hash',
    embedding: null,
    risk: partial.risk ?? 'low',
    verifiedAt: FUTURE,
    expiresAt: partial.expiresAt ?? FUTURE,
    ...partial,
  };
}

function snap(chunks: DrkallaKnowledgeChunk[]): DrkallaKnowledgeChunksSnapshot {
  return {
    version: 'test', generatedAt: FUTURE, embeddingModel: 'none', embeddingDim: 1536,
    chunkParams: { maxChars: 700, overlapChars: 120 },
    metadata: { totalSources: chunks.length, totalChunks: chunks.length, embeddingsCount: 0 },
    chunks,
    bm25: { avgDocLen: 0, df: {} }, // force the in-memory df fallback path
  };
}

const corpus = snap([
  mk({ chunkId: 'page:1', sourceTitle: 'Versand und Lieferung', category: 'policies',
       text: 'Wir liefern innerhalb Deutschlands. Die Versandkosten werden im Bestellvorgang angezeigt. Die Lieferung dauert zwei bis vier Werktage.' }),
  mk({ chunkId: 'page:2', sourceTitle: 'Widerruf und Rueckgabe', category: 'policies',
       text: 'Sie haben ein gesetzliches Widerrufsrecht von vierzehn Tagen. Eine Rueckgabe ist innerhalb dieser Frist moeglich.' }),
  mk({ chunkId: 'faq:zahlung', sourceTitle: 'Zahlung', category: 'policies',
       text: 'Welche Zahlungsarten moeglich sind, sehen Sie an der Kasse beim Abschluss der Bestellung.' }),
  mk({ chunkId: 'product:maske', sourceTitle: 'Pflegende Haarmaske', category: 'usage',
       text: 'Die pflegende Haarmaske tragen Sie nach der Waesche auf das handtuchtrockene Haar auf und lassen sie einige Minuten einwirken.' }),
  // A chunk that says only "Versand" (never "Lieferung") to prove synonym recall.
  mk({ chunkId: 'page:3', sourceTitle: 'Express', category: 'policies',
       text: 'Ein Express Versand ist gegen Aufpreis verfuegbar und besonders schnell.' }),
]);

describe('DrKalla knowledge-chunk retriever', () => {
  it('tokenizer drops stopwords and sub-3-char tokens, shares the FAQ normalizer', () => {
    expect(tokenizeDrkallaKnowledge(normalizeDrkallaFaqText('Wie lange dauert die Lieferung?')))
      .toEqual(['lange', 'dauert', 'lieferung']);
  });

  it('ranks the shipping chunk top for a delivery question, with confidence over threshold', () => {
    const r = buildDrkallaKnowledgeRetriever(corpus);
    const hit = r('Wie lange dauert die Lieferung?');
    expect(hit).not.toBeNull();
    expect(hit!.confidence).toBeGreaterThanOrEqual(0.55);
    expect(hit!.hits[0]?.chunkId).toBe('page:1');
  });

  it('matches umlaut/eszett paraphrases via the shared normalizer (Versandkosten)', () => {
    const r = buildDrkallaKnowledgeRetriever(corpus);
    const hit = r('Was kostet der Versand?');
    expect(hit?.hits[0]?.chunkId).toBe('page:1');
  });

  it('recalls a chunk that only uses a synonym (query "Lieferung" -> chunk says "Versand")', () => {
    // Restrict to the express chunk + an unrelated one so only synonym recall can win.
    // Lower the threshold to isolate the synonym MECHANISM from the confidence
    // shaping (a 2-doc fixture has tiny idf; the real 1094-chunk corpus scores
    // these ~0.95 — confidence shaping is covered by its own test below).
    const r = buildDrkallaKnowledgeRetriever(snap([
      corpus.chunks[4]!, // "Express Versand ..." (no "Lieferung")
      corpus.chunks[3]!, // Haarmaske (unrelated)
    ]), { confidence: 0.3 });
    const hit = r('Gibt es eine schnelle Lieferung?');
    expect(hit).not.toBeNull();
    expect(hit!.hits[0]?.chunkId).toBe('page:3');
  });

  it('returns the usage chunk for a product-application question', () => {
    const r = buildDrkallaKnowledgeRetriever(corpus);
    const hit = r('Wie wende ich die Haarmaske an?');
    expect(hit?.hits[0]?.category).toBe('usage');
  });

  it('returns null for gibberish (no grounding, no hallucination)', () => {
    const r = buildDrkallaKnowledgeRetriever(corpus);
    expect(r('asdfqwer zxcvbnm')).toBeNull();
  });

  it('returns null for an empty / stopword-only query', () => {
    const r = buildDrkallaKnowledgeRetriever(corpus);
    expect(r('und die das')).toBeNull();
    expect(r('')).toBeNull();
  });

  it('drops expired chunks at build time', () => {
    const r = buildDrkallaKnowledgeRetriever(snap([
      mk({ chunkId: 'old:1', sourceTitle: 'Alt', text: 'Die Lieferung dauert lange Werktage Versand', expiresAt: PAST }),
    ]));
    expect(r('Wie lange dauert die Lieferung?')).toBeNull();
  });

  it('never surfaces high-risk chunks', () => {
    const r = buildDrkallaKnowledgeRetriever(snap([
      mk({ chunkId: 'risky:1', sourceTitle: 'Geheim', text: 'Die Lieferung dauert lange Werktage Versand', risk: 'high' }),
    ]));
    expect(r('Wie lange dauert die Lieferung?')).toBeNull();
  });

  it('an empty snapshot yields a retriever that always returns null', () => {
    const r = buildDrkallaKnowledgeRetriever(snap([]));
    expect(r('Wie lange dauert die Lieferung?')).toBeNull();
  });

  it('respects a custom confidence threshold via options', () => {
    const strict = buildDrkallaKnowledgeRetriever(corpus, { confidence: 0.99 });
    expect(strict('Wie lange dauert die Lieferung?')).toBeNull(); // nothing clears 0.99
  });
});
