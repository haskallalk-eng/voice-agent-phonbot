import { describe, expect, it } from 'vitest';
import { buildVoiceContext } from '../context-builder.js';

describe('buildVoiceContext', () => {
  it('injects deterministic Berlin time context', () => {
    const ctx = buildVoiceContext({ now: new Date('2026-05-21T12:00:00Z') });
    expect(ctx.time.current_date_iso).toBe('2026-05-21');
    expect(ctx.time.tomorrow_date_iso).toBe('2026-05-22');
    expect(ctx.time.tomorrow_weekday_de.toLowerCase()).toBe('freitag');
  });

  it('marks RAG as facts-only', () => {
    const ctx = buildVoiceContext({ ragEnabled: true });
    expect(ctx.rag).toEqual({ enabled: true, rule: 'facts_only_never_permission' });
  });
});

