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

  it('builds a live overlay whose faqMatch answers a normalized query', () => {
    const overlay = buildDrkallaLiveOverlay(
      { faq: [{ id: 'v', question: 'Wie lange dauert der Versand?', answer: 'Zwei bis vier Werktage.' }] },
      '2026-06-23T00:00:00.000Z',
    );
    expect(overlay.faqCount).toBe(1);
    expect(overlay.publishedAt).toBe('2026-06-23T00:00:00.000Z');
    const hit = overlay.faqMatch?.('Wie lange dauert der Versand denn?');
    expect(hit?.answer).toBe('Zwei bis vier Werktage.');
  });

  it('carries the on/off override only when a boolean is given', () => {
    expect(buildDrkallaLiveOverlay({ enabled: false, faq: [] }, 'x').enabled).toBe(false);
    expect(buildDrkallaLiveOverlay({ enabled: true, faq: [] }, 'x').enabled).toBe(true);
    expect(buildDrkallaLiveOverlay({ faq: [] }, 'x').enabled).toBeUndefined();
  });

  it('an empty FAQ list yields no matcher (falls back to baked)', () => {
    const overlay = buildDrkallaLiveOverlay({ faq: [] }, 'x');
    expect(overlay.faqMatch).toBeUndefined();
    expect(overlay.faqCount).toBe(0);
  });
});
