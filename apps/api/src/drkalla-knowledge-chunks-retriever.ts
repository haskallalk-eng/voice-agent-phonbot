/**
 * Deterministic, in-memory chunked-document retriever for the DrKalla voice agent.
 *
 * The custom runtime grounds from in-memory snapshots with ZERO per-turn network
 * (catalog, evidence, FAQ). This adds the same for free-text knowledge (shop
 * policies, product usage/info, and any ingested PDF): a pure lexical BM25 search
 * over a precomputed chunk snapshot, with a small German synonym expansion so
 * paraphrases ("Lieferung" vs "Versand") still hit. It is SYNCHRONOUS by design —
 * the type is `(query) => result | null` so a per-turn embedding/fetch can never
 * be introduced on the voice critical path (own-kb's pgvector path at ~700ms p95
 * is too slow; embeddings here are precomputed OFFLINE only).
 *
 * It NEVER returns spoken text. The responder injects the top chunks as
 * source-labeled grounding into the model prompt ("use only these, invent
 * nothing"), so the governed model still owns wording (Sie-form, TTS rules).
 * Additive + conservative: returns null below a confidence threshold, and is only
 * consulted on a model turn when no product is named and no catalog hit exists.
 */

import { normalizeDrkallaFaqText } from './drkalla-faq-match.js';

export type DrkallaKnowledgeChunk = {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  category: string; // policies | usage | catalog | generic
  index: number;
  text: string;            // voice-safe display text (<= chunkParams.maxChars)
  normalizedText: string;  // normalizeDrkallaFaqText(text) — the ONLY field tokenized
  keywords: string[];      // precomputed bonus tokens (top IDF terms), already normalized
  charStart: number;
  charEnd: number;
  tokenCount: number;
  contentHash: string;
  embedding: number[] | null; // precomputed offline; UNUSED at runtime in v1
  risk: string;            // low | medium | high
  verifiedAt: string;
  expiresAt: string;
};

export type DrkallaKnowledgeChunksSnapshot = {
  version: string;
  generatedAt: string;
  embeddingModel: string;
  embeddingDim: number;
  chunkParams: { maxChars: number; overlapChars: number };
  metadata: { totalSources: number; totalChunks: number; embeddingsCount: number };
  chunks: DrkallaKnowledgeChunk[];
  bm25: { avgDocLen: number; df: Record<string, number> };
};

export type DrkallaKnowledgeChunkHit = {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  category: string;
  text: string;
  score: number;
};

export type DrkallaKnowledgeRetrieval = { hits: DrkallaKnowledgeChunkHit[]; confidence: number };
export type DrkallaKnowledgeRetriever = (query: string, topK?: number) => DrkallaKnowledgeRetrieval | null;

// Function words + meta-words that must never drive a chunk match. Mirrors the
// spirit of the catalog-search stopword list, normalized (ä->ae, ü->ue, ß->ss).
const STOPWORDS = new Set([
  'ich', 'sie', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer',
  'und', 'oder', 'mit', 'fuer', 'von', 'vom', 'zum', 'zur', 'auf', 'aus', 'bei', 'habt', 'haben',
  'hast', 'hat', 'habe', 'wird', 'werden', 'kann', 'koennen', 'koennt', 'soll', 'sollen', 'muss',
  'was', 'wer', 'wie', 'wo', 'wann', 'warum', 'wieso', 'weshalb', 'welche', 'welcher', 'welches',
  'mir', 'mich', 'uns', 'euch', 'ihr', 'ihre', 'ihren', 'eure', 'euer', 'mein', 'meine',
  'bitte', 'gerne', 'mal', 'noch', 'auch', 'etwas', 'eigentlich', 'denn', 'schon', 'gibt', 'gibts',
  'ist', 'sind', 'man', 'nur', 'mehr', 'dann', 'also', 'aber', 'nicht', 'kein', 'keine', 'als',
  'bin', 'war', 'wuerde', 'haette', 'dass', 'weil', 'damit', 'ueber', 'unter', 'nach', 'vor', 'an',
  'in', 'im', 'um', 'zu', 'so', 'es', 'er', 'wir', 'ja', 'nein', 'okay', 'hallo', 'guten', 'tag',
]);

// Small high-value German synonym groups for this shop's knowledge. Applied to the
// QUERY only (symmetric recall without bloating the index): a query token is
// expanded with its group so e.g. "Lieferung" also gathers chunks indexed under
// "versand". All entries are in normalized form (ä->ae etc.).
const SYNONYM_GROUPS: string[][] = [
  ['versand', 'lieferung', 'liefern', 'geliefert', 'verschicken', 'versenden', 'versendet', 'zustellung', 'lieferzeit', 'lieferdauer'],
  ['versandkosten', 'lieferkosten', 'versandkostenfrei', 'versandgebuehr'],
  ['rueckgabe', 'widerruf', 'retoure', 'ruecksendung', 'zurueckschicken', 'zurueckgeben', 'umtausch', 'reklamation', 'reklamieren'],
  ['zahlung', 'bezahlung', 'bezahlen', 'zahlen', 'zahlungsart', 'zahlungsarten', 'zahlungsmethode', 'zahlungsmethoden'],
  ['rechnung', 'quittung', 'beleg', 'rechnungskauf'],
  ['abholung', 'abholen', 'selbstabholung', 'abholbereit'],
  ['vegan', 'tierversuchsfrei', 'tierversuche'],
  ['profi', 'friseur', 'friseure', 'salon', 'gewerbe', 'gewerblich', 'haendler'],
  ['anwendung', 'anwenden', 'benutzung', 'benutzen', 'verwenden', 'verwendung', 'anwendet', 'aufgetragen', 'auftragen'],
  ['inhaltsstoffe', 'inhaltsstoff', 'inhalt', 'zutaten', 'enthalten'],
  ['vertraeglich', 'vertraeglichkeit', 'allergie', 'allergiker', 'allergisch'],
  ['oeffnungszeiten', 'oeffnungszeit', 'geoeffnet', 'offen'],
  ['adresse', 'standort', 'anschrift', 'filiale', 'geschaeft'],
  // After-sales / service — German inflection (defekt/defekte, Föhn/Föhne,
  // einschicken/eingeschickt) means exact-token BM25 misses most of a service
  // question; cross-linking these stems so any one of them also gathers chunks
  // indexed under the others lifts recall for repair/warranty/return questions.
  // Split into repair-ish vs warranty-ish groups: a single symmetric group let a
  // "Garantie" query expand to "repariert", which matched PRODUCT marketing copy
  // ("Reparierende Haarmaske") instead of service content (audit 2026-07-05).
  ['reparatur', 'reparieren', 'repariert', 'werkstatt', 'einschicken', 'eingeschickt', 'einsenden', 'einsendung'],
  ['garantie', 'gewaehrleistung', 'defekt', 'defekte', 'defekten', 'kaputt', 'ersatzteil', 'ersatzteile'],
  ['gutschein', 'gutscheincode', 'rabatt', 'rabattcode', 'aktionscode', 'aktion'],
];

// Policy-intent stems: when the query carries one of these, chunks from POLICY
// pages get a rank boost over product usage copy. Without it, generic tokens let
// a product description outrank the actual policy page (audit 2026-07-05: "Was
// macht ihr mit meinen Daten?" surfaced a Waschbeckenstuhl chunk instead of the
// Datenschutzerklärung). Prefix-matched against query tokens (incl. synonyms).
const POLICY_INTENT_STEMS = [
  'versand', 'liefer', 'zustellung', 'rueckgabe', 'ruecksend', 'widerruf', 'retour', 'umtausch',
  'zahlung', 'bezahl', 'rechnung', 'datenschutz', 'daten', 'dsgvo', 'agb', 'impressum',
  'garantie', 'gewaehrleistung', 'reparatur', 'defekt', 'kaputt', 'gutschein', 'rabatt',
  'bestell', 'abhol', 'oeffnungszeit', 'reklam', 'storn', 'newsletter', 'konto', 'porto',
];
const POLICY_BOOST = 1.5;

const SYNONYM_INDEX = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    const extra = group.filter((t) => t !== term);
    SYNONYM_INDEX.set(term, (SYNONYM_INDEX.get(term) ?? []).concat(extra));
  }
}

export function tokenizeDrkallaKnowledge(normalized: string): string[] {
  return normalized
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

// BM25 params.
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const KEYWORD_BONUS = 0.15; // extra weight when a query term hit a chunk's keyword

type IndexedChunk = {
  hit: DrkallaKnowledgeChunkHit;
  tf: Map<string, number>;     // token -> frequency in this chunk
  keywordSet: Set<string>;     // precomputed bonus tokens
  docLen: number;
};

function defaultConfidenceThreshold(): number {
  const raw = Number(process.env.DRKALLA_KB_CONFIDENCE);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.55;
}

/**
 * Build the retriever once at startup. Drops expired and high-risk chunks. Returns
 * a synchronous query function (or one that always yields null for an empty index).
 */
export function buildDrkallaKnowledgeRetriever(
  snapshot: DrkallaKnowledgeChunksSnapshot,
  options: { now?: number; confidence?: number } = {},
): DrkallaKnowledgeRetriever {
  const now = options.now ?? Date.now();
  const threshold = options.confidence ?? defaultConfidenceThreshold();
  const df = snapshot.bm25?.df ?? {};

  const indexed: IndexedChunk[] = [];
  const invertedIndex = new Map<string, number[]>(); // token -> indexed positions
  for (const chunk of snapshot.chunks ?? []) {
    if (!chunk || typeof chunk.text !== 'string' || !chunk.text.trim()) continue;
    if (chunk.risk === 'high') continue; // never surface high-risk content
    const expires = Date.parse(chunk.expiresAt ?? '');
    if (Number.isFinite(expires) && expires <= now) continue; // drop stale
    const normalized = typeof chunk.normalizedText === 'string' && chunk.normalizedText.trim()
      ? chunk.normalizedText
      : normalizeDrkallaFaqText(chunk.text);
    const tokens = tokenizeDrkallaKnowledge(normalized);
    if (!tokens.length) continue;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const keywordSet = new Set<string>(
      (Array.isArray(chunk.keywords) ? chunk.keywords : [])
        .map((k) => (typeof k === 'string' ? k.trim() : ''))
        .filter((k) => k.length >= 3),
    );
    const pos = indexed.length;
    indexed.push({
      hit: {
        chunkId: chunk.chunkId,
        sourceId: chunk.sourceId,
        sourceTitle: chunk.sourceTitle,
        category: chunk.category,
        text: chunk.text,
        score: 0,
      },
      tf,
      keywordSet,
      docLen: tokens.length,
    });
    const indexTokens = new Set<string>([...tf.keys(), ...keywordSet]);
    for (const t of indexTokens) {
      const list = invertedIndex.get(t);
      if (list) list.push(pos);
      else invertedIndex.set(t, [pos]);
    }
  }

  const docCount = indexed.length;
  const avgDocLen = snapshot.bm25?.avgDocLen && snapshot.bm25.avgDocLen > 0
    ? snapshot.bm25.avgDocLen
    : (indexed.reduce((s, c) => s + c.docLen, 0) / Math.max(1, docCount)) || 1;

  const idf = (token: string): number => {
    // Prefer the corpus-wide df from the snapshot; fall back to the in-memory
    // posting-list length so a hand-built snapshot without df still ranks.
    const n = df[token] ?? invertedIndex.get(token)?.length ?? 0;
    if (n <= 0) return 0;
    return Math.log(1 + (docCount - n + 0.5) / (n + 0.5));
  };

  return (query: string, topK = 3): DrkallaKnowledgeRetrieval | null => {
    if (!docCount) return null;
    const normalized = normalizeDrkallaFaqText(query ?? '');
    const baseTokens = tokenizeDrkallaKnowledge(normalized);
    if (!baseTokens.length) return null;
    // Expand with synonyms (deduped); keep original tokens for tf-based scoring.
    const queryTokens = new Set<string>(baseTokens);
    for (const t of baseTokens) {
      for (const syn of SYNONYM_INDEX.get(t) ?? []) queryTokens.add(syn);
    }

    const candidates = new Set<number>();
    for (const t of queryTokens) {
      for (const pos of invertedIndex.get(t) ?? []) candidates.add(pos);
    }
    if (!candidates.size) return null;

    const policyIntent = [...queryTokens].some((t) => POLICY_INTENT_STEMS.some((s) => t.startsWith(s)));
    const scored: DrkallaKnowledgeChunkHit[] = [];
    for (const pos of candidates) {
      const c = indexed[pos];
      if (!c) continue;
      let score = 0;
      for (const t of queryTokens) {
        const tf = c.tf.get(t) ?? 0;
        if (tf > 0) {
          const denom = tf + BM25_K1 * (1 - BM25_B + (BM25_B * c.docLen) / avgDocLen);
          score += idf(t) * ((tf * (BM25_K1 + 1)) / denom);
        } else if (c.keywordSet.has(t)) {
          score += KEYWORD_BONUS * idf(t);
        }
      }
      if (score > 0 && policyIntent && c.hit.category === 'policies') score *= POLICY_BOOST;
      if (score > 0) scored.push({ ...c.hit, score });
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.max(1, topK));
    const topScore = top[0]?.score ?? 0;
    // Shape the raw BM25 score into [0, 0.95]; a strong multi-term match clears 0.55.
    const confidence = Math.min(0.95, topScore / (topScore + 1.0));
    if (confidence < threshold) return null;
    return { hits: top, confidence };
  };
}
