import { describe, expect, it } from 'vitest';
import { createDrkallaCanaryLatencyRecorder } from '../drkalla-canary-latency-stats.js';

describe('DrKalla canary latency recorder', () => {
  it('reports null percentiles and zero share when empty', () => {
    const r = createDrkallaCanaryLatencyRecorder();
    const s = r.summary();
    expect(s.samples).toBe(0);
    expect(s.firstFrameP50).toBeNull();
    expect(s.firstFrameP95).toBeNull();
    expect(s.modelTurnShare).toBe(0);
  });

  it('computes nearest-rank percentiles over recorded first-frame samples', () => {
    const r = createDrkallaCanaryLatencyRecorder();
    for (const ms of [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]) {
      r.record({ firstFrameMs: ms, totalMs: ms + 50, streamed: true });
    }
    const s = r.summary();
    expect(s.samples).toBe(10);
    expect(s.firstFrameP50).toBe(500);
    expect(s.firstFrameP90).toBe(900);
    expect(s.firstFrameP95).toBe(1000);
    expect(s.totalP50).toBe(550);
    expect(s.modelTurnShare).toBe(1);
  });

  it('tracks the model-turn share separately from deterministic turns', () => {
    const r = createDrkallaCanaryLatencyRecorder();
    r.record({ firstFrameMs: 5, totalMs: 5, streamed: false });   // deterministic
    r.record({ firstFrameMs: 700, totalMs: 900, streamed: true }); // model
    r.record({ firstFrameMs: 8, totalMs: 8, streamed: false });   // deterministic
    r.record({ firstFrameMs: 650, totalMs: 850, streamed: true }); // model
    expect(r.summary().modelTurnShare).toBe(0.5);
  });

  it('caps memory at maxSamples (ring buffer) and keeps the streamed counter consistent', () => {
    const r = createDrkallaCanaryLatencyRecorder(3);
    // First 3 streamed, then 3 deterministic overwrite the oldest entries.
    r.record({ firstFrameMs: 700, totalMs: 800, streamed: true });
    r.record({ firstFrameMs: 700, totalMs: 800, streamed: true });
    r.record({ firstFrameMs: 700, totalMs: 800, streamed: true });
    expect(r.size()).toBe(3);
    expect(r.summary().modelTurnShare).toBe(1);
    r.record({ firstFrameMs: 10, totalMs: 10, streamed: false });
    r.record({ firstFrameMs: 10, totalMs: 10, streamed: false });
    r.record({ firstFrameMs: 10, totalMs: 10, streamed: false });
    expect(r.size()).toBe(3); // never grows past the cap
    expect(r.summary().modelTurnShare).toBe(0); // streamed entries fully evicted
    expect(r.summary().firstFrameP50).toBe(10);
  });

  it('ignores invalid samples by flooring them to zero rather than throwing', () => {
    const r = createDrkallaCanaryLatencyRecorder();
    r.record({ firstFrameMs: Number.NaN, totalMs: -5, streamed: false });
    const s = r.summary();
    expect(s.samples).toBe(1);
    expect(s.firstFrameP50).toBe(0);
    expect(s.totalP50).toBe(0);
  });
});
