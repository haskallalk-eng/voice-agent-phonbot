import { describe, expect, it } from 'vitest';
import { summarizeRecentCallLatency } from '../latency-stats.js';

describe('latency stats', () => {
  it('includes Retell knowledge_base latency beside llm, tts, asr, and e2e', () => {
    const summary = summarizeRecentCallLatency([
      {
        call_id: 'call_1',
        agent_id: 'agent_1',
        call_type: 'web_call',
        call_status: 'ended',
        start_timestamp: 1000,
        end_timestamp: 2000,
        latency: {
          e2e: { values: [1.2, 1.4] },
          llm: { p50: 0.42 },
          tts: { p50: 0.31 },
          asr: { p50: 0.2 },
          knowledge_base: { values: [0.11, 0.21, 0.31] },
        },
      },
    ]);

    expect(summary.breakdownMs).toEqual({
      e2e: 1200,
      llm: 420,
      tts: 310,
      asr: 200,
      knowledge_base: 210,
    });
    expect(summary.recentLatencyMs.knowledge_base).toMatchObject({
      p50: 210,
      p95: 310,
      samples: 3,
      latestP50: null,
    });
  });
});
