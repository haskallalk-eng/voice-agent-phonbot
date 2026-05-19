import type { RetellCall, RetellLatencyBreakdown } from './retell.js';

export type LatencyComponent = 'llm' | 'tts' | 'asr' | 'e2e' | 'knowledge_base';

export type LatencyMetricSummary = {
  p50: number | null;
  p95: number | null;
  avg: number | null;
  samples: number;
  latestP50: number | null;
};

export type RecentCallLatencySummary = {
  endedCalls: RetellCall[];
  latest: RetellCall | undefined;
  breakdownMs: Record<LatencyComponent, number | null>;
  recentLatencyMs: Record<LatencyComponent, LatencyMetricSummary | null>;
};

const COMPONENTS: LatencyComponent[] = ['llm', 'tts', 'asr', 'e2e', 'knowledge_base'];

export function latencyToMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value < 60 ? value * 1000 : value);
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

function summarizeMetric(
  endedCalls: RetellCall[],
  latest: RetellCall | undefined,
  key: LatencyComponent,
): LatencyMetricSummary | null {
  const values: number[] = [];
  for (const call of endedCalls) {
    const raw = call.latency?.[key] as RetellLatencyBreakdown | undefined;
    const rawValues = Array.isArray(raw?.values) ? raw.values : [];
    if (rawValues.length) {
      for (const value of rawValues) {
        const ms = latencyToMs(value);
        if (ms != null) values.push(ms);
      }
    } else {
      const ms = latencyToMs(raw?.p50);
      if (ms != null) values.push(ms);
    }
  }
  if (!values.length) return null;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    avg: Math.round(sum / values.length),
    samples: values.length,
    latestP50: latencyToMs(latest?.latency?.[key]?.p50),
  };
}

export function summarizeRecentCallLatency(calls: RetellCall[]): RecentCallLatencySummary {
  const endedCalls = calls
    .filter((call) => call.call_status === 'ended')
    .sort((a, b) => (b.end_timestamp ?? b.start_timestamp ?? 0) - (a.end_timestamp ?? a.start_timestamp ?? 0));
  const latest = endedCalls[0];

  const recentLatencyMs = Object.fromEntries(
    COMPONENTS.map((key) => [key, summarizeMetric(endedCalls, latest, key)]),
  ) as Record<LatencyComponent, LatencyMetricSummary | null>;

  return {
    endedCalls,
    latest,
    recentLatencyMs,
    breakdownMs: {
      llm: recentLatencyMs.llm?.latestP50 ?? recentLatencyMs.llm?.p50 ?? null,
      tts: recentLatencyMs.tts?.latestP50 ?? recentLatencyMs.tts?.p50 ?? null,
      asr: recentLatencyMs.asr?.latestP50 ?? recentLatencyMs.asr?.p50 ?? null,
      e2e: recentLatencyMs.e2e?.latestP50 ?? recentLatencyMs.e2e?.p50 ?? null,
      knowledge_base: recentLatencyMs.knowledge_base?.latestP50 ?? recentLatencyMs.knowledge_base?.p50 ?? null,
    },
  };
}
