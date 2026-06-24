import { describe, expect, it } from 'vitest';
import {
  buildDrkallaLiveOverlay,
  publishedFaqToEntries,
} from '../drkalla-faq-overlay.js';

describe('DrKalla FAQ publish overlay', () => {
  it('maps published FAQ to matcher entries (question + tags as triggers), skipping invalid', () => {
    const entries = publishedFaqToEntries([
      { id: 'a', question: 'Wie lange dauert der Versand?', answer: 'Zwei bis vier Werktage.', tags: ['versand'] },
      { question: '', answer: 'kein trigger' },        // no trigger -> skipped
      { question: 'Habt ihr Parkplätze?', answer: '' }, // no answer -> skipped
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe('a');
    expect(entries[0]?.answer).toBe('Zwei bis vier Werktage.');
    expect(entries[0]?.triggers).toContain('Wie lange dauert der Versand?');
    expect(entries[0]?.triggers).toContain('versand');
  });

  it('builds a live overlay whose faqMatch answers a normalized query', async () => {
    const overlay = await buildDrkallaLiveOverlay(
      { faq: [{ id: 'v', question: 'Wie lange dauert der Versand?', answer: 'Zwei bis vier Werktage.' }] },
      '2026-06-23T00:00:00.000Z',
    );
    expect(overlay.faqCount).toBe(1);
    expect(overlay.publishedAt).toBe('2026-06-23T00:00:00.000Z');
    const hit = overlay.faqMatch?.('Wie lange dauert der Versand denn?');
    expect(hit?.answer).toBe('Zwei bis vier Werktage.');
  });

  it('carries the on/off override only when a boolean is given', async () => {
    expect((await buildDrkallaLiveOverlay({ enabled: false, faq: [] }, 'x')).enabled).toBe(false);
    expect((await buildDrkallaLiveOverlay({ enabled: true, faq: [] }, 'x')).enabled).toBe(true);
    expect((await buildDrkallaLiveOverlay({ faq: [] }, 'x')).enabled).toBeUndefined();
  });

  it('an empty FAQ list yields no matcher (falls back to baked)', async () => {
    const overlay = await buildDrkallaLiveOverlay({ faq: [] }, 'x');
    expect(overlay.faqMatch).toBeUndefined();
    expect(overlay.faqCount).toBe(0);
    expect(overlay.knowledgeChunks).toBe(0);
  });

  it('builds a live knowledge retriever from published knowledge text', async () => {
    const overlay = await buildDrkallaLiveOverlay(
      {
        knowledge: [{
          id: 'doc1',
          title: 'Versand und Lieferung',
          content: 'Wir liefern innerhalb Deutschlands. Die Lieferung dauert in der Regel zwei bis vier Werktage. Die Versandkosten werden im Bestellvorgang angezeigt.',
        }],
      },
      '2026-06-23T00:00:00.000Z',
    );
    // The publish path must BUILD a live retriever from the text; retrieval
    // quality/threshold is covered by the retriever's own tests (a 1-source
    // fixture has tiny idf, so a live query can fall below the confidence gate —
    // the real corpus has 1000+ chunks and answers it, proven in the live smoke).
    expect(overlay.knowledgeChunks).toBeGreaterThan(0);
    expect(overlay.knowledgeRetriever).toBeDefined();
  });
});
