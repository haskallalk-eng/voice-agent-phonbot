/**
 * Rolling background summary for LONG DrKalla phone calls.
 *
 * Step 1 (drkalla-custom-llm-responder) feeds the model the last few turns
 * verbatim. On long calls the older context falls out of that window. This
 * module maintains a compact rolling NOTE of the older part of the call, built
 * by a background LLM call that NEVER runs on the turn's hot path: the turn only
 * READS the last completed note (a string), so it adds zero turn latency. The
 * note is refreshed every few turns from the older turns + the previous note
 * (incremental), so even a very long call stays bounded.
 */

import type { DrkallaConversationTurn } from './drkalla-custom-llm-responder.js';
import { redactForPrompt } from './pii.js';

// Turns kept verbatim by Step 1; the rolling note summarizes everything OLDER
// than this window, so note + window together cover the whole call with no gap
// and no overlap.
export const DRKALLA_SUMMARY_RECENT_WINDOW = 6;
// Re-summarize only once this many new turns have accrued since the last note
// (keeps the background calls sparse).
const DRKALLA_SUMMARY_REFRESH_EVERY = 4;
// Need at least this many older turns before a note is worthwhile.
const DRKALLA_SUMMARY_MIN_OLDER = 2;
// Cap how many older turns feed one summary call (the previous note carries the
// even-older context forward, so this stays bounded on very long calls).
export const DRKALLA_SUMMARY_MAX_OLDER_INPUT = 16;

/**
 * Should we (re)build the rolling note now? Pure + cheap; called AFTER a turn's
 * reply is already sent. True only when there are enough older turns beyond the
 * verbatim window and enough new turns since the last note.
 */
export function shouldRefreshDrkallaSummary(input: {
  totalTurns: number;            // non-current turns available (older + window)
  summarizedThroughTurn: number; // totalTurns covered by the current note
}): boolean {
  const olderTurns = input.totalTurns - DRKALLA_SUMMARY_RECENT_WINDOW;
  if (olderTurns < DRKALLA_SUMMARY_MIN_OLDER) return false;
  return input.totalTurns - input.summarizedThroughTurn >= DRKALLA_SUMMARY_REFRESH_EVERY;
}

/** The older turns to summarize: everything before the verbatim window, capped. */
export function selectDrkallaOlderTurns(allTurns: DrkallaConversationTurn[]): DrkallaConversationTurn[] {
  const older = allTurns.slice(0, Math.max(0, allTurns.length - DRKALLA_SUMMARY_RECENT_WINDOW));
  return older.slice(-DRKALLA_SUMMARY_MAX_OLDER_INPUT);
}

export const DRKALLA_SUMMARY_SYSTEM = [
  'Du pflegst das Kurzzeitgedaechtnis des Telefon-Assistenten eines Friseurbedarf-Haendlers (Dr.Kalla).',
  'Fasse den AELTEREN Teil des laufenden Telefonats zu einer KOMPAKTEN Notiz zusammen (hoechstens 4 kurze Saetze, Deutsch).',
  'Halte fest: worum es dem Anrufer geht, welche Produkte/Marken/Themen schon genannt wurden, welche Zusagen/Entscheidungen gefallen sind und welche Frage offen ist.',
  // Live 2026-07-03: the note carried early-call topics (Oeffnungszeiten, the
  // first product) forever, and the model resurrected them many turns later
  // ("Ja, gerne." was answered with the hours again). Closed topics must DECAY.
  'STREICHE Erledigtes und Abgelehntes: bereits beantwortete Fragen (z.B. genannte Oeffnungszeiten), abgelehnte Produkte und abgeschlossene Themen gehoeren NICHT mehr in die Notiz — nur das aktuell relevante Anliegen und offene Punkte.',
  'Nur Fakten aus dem Gespraech — nichts erfinden, keine Anrede, keine Begruessung, kein Vorlesen, keine Aufzaehlungszeichen. Reine Gedaechtnisnotiz.',
].join('\n');

/** Build the {system,user} messages for one rolling-summary call. */
export function buildDrkallaSummaryMessages(
  olderTurns: DrkallaConversationTurn[],
  previousSummary: string,
): { system: string; user: string } {
  // Redact caller PII (phone/email/address/IBAN/…) from each older turn BEFORE
  // it reaches the summarizer LLM — otherwise PII could leak into the rolling
  // note and then into the main model prompt. Mirrors the recent-window path.
  const lines = olderTurns
    .map((t) => {
      const safe = redactForPrompt(t.text).replace(/\s+/g, ' ').trim().slice(0, 180);
      return safe ? `${t.role === 'agent' ? 'Assistent' : 'Anrufer'}: ${safe}` : '';
    })
    .filter(Boolean);
  const user = [
    previousSummary.trim() ? `Bisherige Notiz:\n${previousSummary.trim()}` : 'Bisherige Notiz: (noch keine)',
    '',
    'Aelterer Gespraechsverlauf:',
    lines.join('\n'),
    '',
    'Aktualisierte Gedaechtnisnotiz (max. 4 Saetze):',
  ].join('\n');
  return { system: DRKALLA_SUMMARY_SYSTEM, user };
}
