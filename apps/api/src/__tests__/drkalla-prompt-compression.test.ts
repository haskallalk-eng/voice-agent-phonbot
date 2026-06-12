import { describe, expect, it } from 'vitest';
import {
  DRKALLA_RAG_PROMPT,
  DRKALLA_RAG_PROMPT_BASELINE,
  DRKALLA_RAG_PROMPT_COMPACT_CANDIDATE,
  DRKALLA_RAG_PROMPT_MAX_CHARS,
  DRKALLA_RAG_PROMPT_REQUIRED_ANCHORS,
  evaluateDrkallaPromptCompression,
} from '../drkalla-rag-agent.js';
import { isDrkallaMemoryLiveEffective } from '../drkalla-short-term-memory.js';

describe('DrKalla prompt compression guardrail', () => {
  it('keeps the active managed Retell prompt under the hard latency-oriented length cap', () => {
    expect(DRKALLA_RAG_PROMPT_MAX_CHARS).toBe(3200);
    expect(DRKALLA_RAG_PROMPT.length).toBeLessThanOrEqual(DRKALLA_RAG_PROMPT_MAX_CHARS);
    expect(DRKALLA_RAG_PROMPT_COMPACT_CANDIDATE.length).toBeLessThanOrEqual(DRKALLA_RAG_PROMPT_MAX_CHARS);
    expect(DRKALLA_RAG_PROMPT_BASELINE.length).toBeGreaterThan(DRKALLA_RAG_PROMPT_COMPACT_CANDIDATE.length);
  });

  it('preserves every required behavior anchor after compression', () => {
    const report = evaluateDrkallaPromptCompression(DRKALLA_RAG_PROMPT_COMPACT_CANDIDATE);

    expect(report.passed).toBe(true);
    expect(report.missingAnchors).toEqual([]);
    expect(DRKALLA_RAG_PROMPT_REQUIRED_ANCHORS).toEqual(expect.arrayContaining([
      'kein Friseursalon',
      'Erfinde keine Produkte',
      'Sprachname',
      'SMS-Link-Tool',
      'Akustische Reparatur',
      'Profi-Login',
      'Nimm keine Bestellung oder Zahlung',
      'Lege nur auf',
      '(inaudible speech)',
    ]));
  });

  it('keeps the Retell-managed limitation out of the prompt and in runtime capability checks', () => {
    expect(isDrkallaMemoryLiveEffective({ mode: 'retell_managed', memoryContextInjected: true })).toBe(false);
    expect(isDrkallaMemoryLiveEffective({ mode: 'custom_runtime', memoryContextInjected: false })).toBe(false);
    expect(DRKALLA_RAG_PROMPT).not.toContain('kein echtes Kurzzeitgedaechtnis');
  });
});
