/**
 * Runtime "publish overlay" for the DrKalla phone agent.
 *
 * The agent grounds from in-memory snapshots baked into the image. To let the
 * owner edit the FAQ in the platform (dr-kalla-ultimate-app) and have it take
 * effect WITHOUT a redeploy, the platform POSTs the approved FAQ (+ an on/off
 * flag) to an authenticated admin endpoint; this module turns that payload into a
 * live FAQ matcher that overrides the baked one, and carries the on/off override.
 *
 * v1 is IN-MEMORY only (no disk persistence): a publish takes effect in seconds;
 * a container restart reverts to the baked snapshot until the next publish (the
 * platform is the source of truth + shows "last published"). Pure, synchronous,
 * no network — same latency posture as the rest of the runtime.
 */

import {
  buildDrkallaFaqMatcher,
  type DrkallaFaqMatcher,
  type DrkallaFaqRawEntry,
} from './drkalla-faq-match.js';

export type DrkallaPublishFaqEntry = {
  id?: unknown;
  question?: unknown;
  triggers?: unknown;
  answer?: unknown;
  tags?: unknown;
};

export type DrkallaPublishPayload = {
  enabled?: unknown; // boolean on/off override; omitted = no override
  faq?: unknown;     // DrkallaPublishFaqEntry[]
};

export type DrkallaLiveOverlay = {
  faqMatch?: DrkallaFaqMatcher; // overrides the baked faqMatch when present
  enabled?: boolean;            // on/off override; undefined = defer to env
  publishedAt?: string;
  faqCount: number;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Map a published FAQ list to the matcher's raw-entry shape. The question itself
 * (plus any tags/explicit triggers) become the normalized substring triggers; the
 * matcher already normalizes German text and picks the most specific match.
 */
export function publishedFaqToEntries(faq: unknown): DrkallaFaqRawEntry[] {
  if (!Array.isArray(faq)) return [];
  const entries: DrkallaFaqRawEntry[] = [];
  faq.forEach((raw, i) => {
    const e = raw as DrkallaPublishFaqEntry;
    const answer = typeof e?.answer === 'string' ? e.answer.trim() : '';
    if (!answer) return;
    const triggers = [
      ...(typeof e?.question === 'string' ? [e.question] : []),
      ...asStringArray(e?.triggers),
      ...asStringArray(e?.tags),
    ].map((t) => t.trim()).filter(Boolean);
    if (!triggers.length) return;
    entries.push({
      id: typeof e?.id === 'string' && e.id ? e.id : `pub-${i}`,
      triggers,
      answer,
      enabled: true,
    });
  });
  return entries;
}

/**
 * Build the live overlay from a publish payload. `nowIso` is injected (the caller
 * stamps the time) so this stays a pure function.
 */
export function buildDrkallaLiveOverlay(payload: DrkallaPublishPayload, nowIso: string): DrkallaLiveOverlay {
  const entries = publishedFaqToEntries(payload?.faq);
  return {
    faqMatch: entries.length ? buildDrkallaFaqMatcher(entries) : undefined,
    enabled: typeof payload?.enabled === 'boolean' ? payload.enabled : undefined,
    publishedAt: nowIso,
    faqCount: entries.length,
  };
}
