/**
 * In-memory rolling latency recorder for the DrKalla custom-runtime canary.
 *
 * The custom-LLM WebSocket only observes two real per-turn timings: time to the
 * first spoken frame (first-safe-audio proxy) and total turn wall-clock. The
 * Retell-side ASR/provider handoff timestamps that the full voice-latency
 * contract wants are NOT delivered on the custom-LLM socket, so this recorder
 * intentionally tracks only what is genuinely measured here — no fabricated
 * timestamps. It is process-wide (shared across calls), bounded, allocation-
 * cheap, and exposes p50/p90/p95 for log-based observability. No call/turn IDs
 * are retained.
 */

export type DrkallaCanaryLatencySummary = {
  samples: number;
  firstFrameP50: number | null;
  firstFrameP90: number | null;
  firstFrameP95: number | null;
  totalP50: number | null;
  totalP90: number | null;
  totalP95: number | null;
  /** Fraction of samples that streamed model output (vs deterministic turns). */
  modelTurnShare: number;
};

export type DrkallaCanaryLatencyRecorder = {
  record(sample: { firstFrameMs: number; totalMs: number; streamed: boolean }): void;
  summary(): DrkallaCanaryLatencySummary;
  size(): number;
};

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank, matching latency-stats.ts so the two report consistently.
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

export function createDrkallaCanaryLatencyRecorder(maxSamples = 500): DrkallaCanaryLatencyRecorder {
  const cap = Math.max(1, maxSamples);
  const firstFrame: number[] = [];
  const total: number[] = [];
  let streamedCount = 0;
  let write = 0; // ring cursor; firstFrame/total/streamedFlags stay index-aligned
  const streamedFlags: boolean[] = [];

  return {
    record({ firstFrameMs, totalMs, streamed }) {
      const ff = Number.isFinite(firstFrameMs) && firstFrameMs >= 0 ? Math.round(firstFrameMs) : 0;
      const tt = Number.isFinite(totalMs) && totalMs >= 0 ? Math.round(totalMs) : 0;
      if (firstFrame.length < cap) {
        firstFrame.push(ff);
        total.push(tt);
        streamedFlags.push(streamed);
        if (streamed) streamedCount += 1;
      } else {
        // Overwrite oldest (ring), keeping the streamed counter consistent.
        if (streamedFlags[write]) streamedCount -= 1;
        firstFrame[write] = ff;
        total[write] = tt;
        streamedFlags[write] = streamed;
        if (streamed) streamedCount += 1;
        write = (write + 1) % cap;
      }
    },
    summary() {
      const samples = firstFrame.length;
      return {
        samples,
        firstFrameP50: percentile(firstFrame, 50),
        firstFrameP90: percentile(firstFrame, 90),
        firstFrameP95: percentile(firstFrame, 95),
        totalP50: percentile(total, 50),
        totalP90: percentile(total, 90),
        totalP95: percentile(total, 95),
        modelTurnShare: samples ? streamedCount / samples : 0,
      };
    },
    size() {
      return firstFrame.length;
    },
  };
}
