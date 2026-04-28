// Synth-only transfer ringback for the demo. No bundled audio asset — keeps
// the SPA build lean. The European ringback pattern is 425 Hz, 1 s on / 4 s
// off; we shorten it to two short rings (~2.4 s total) so the demo modal
// doesn't stall after the agent has hung up.

const RINGBACK_HZ = 425;

// Audit-Round-10 MEDIUM: Module-level guard against overlapping tones (e.g.
// a Retell SDK reconnect firing call_ended twice). One tone in flight at a
// time; subsequent calls until it finishes are no-ops.
let _toneInFlight = false;

export async function playForwardingTone(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (_toneInFlight) return;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;

  _toneInFlight = true;
  const ctx = new Ctor();
  // Audit-Round-10 MEDIUM: iOS Safari + Chrome with strict autoplay policy
  // create AudioContexts in 'suspended' state when the first sound is not
  // adjacent to a user gesture. We were calling this from the retell-SDK
  // call_ended handler — ~30-60s after the original click — so the gesture
  // was long gone. Best-effort resume(); if it fails we still finish the
  // promise so the UI doesn't hang waiting for a tone that will never play.
  try { await ctx.resume(); } catch { /* policy denied — proceed silently */ }

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      _toneInFlight = false;
      ctx.close().catch(() => { /* already closed */ });
      resolve();
    };

    try {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = RINGBACK_HZ;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);

      const t0 = ctx.currentTime;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.05);
      gain.gain.setValueAtTime(0.18, t0 + 0.95);
      gain.gain.linearRampToValueAtTime(0, t0 + 1.0);
      gain.gain.setValueAtTime(0, t0 + 1.4);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 1.45);
      gain.gain.setValueAtTime(0.18, t0 + 2.35);
      gain.gain.linearRampToValueAtTime(0, t0 + 2.4);

      osc.start(t0);
      osc.stop(t0 + 2.5);
      osc.onended = finish;
      // Hard timeout backstop: if onended never fires (tab hidden, AudioContext
      // suspended again, browser bug), resolve after 3s so the Promise never
      // hangs in the heap.
      setTimeout(finish, 3000);
    } catch {
      finish();
    }
  });
}

// Heuristic: did the agent end the call by announcing a forwarding? The
// agent's prompt is locked to a small set of phrases ("ich verbinde dich",
// "stelle durch", "leite weiter") — we match any of them in the last agent
// message. Conservative: false-positives just play an extra ringback, false-
// negatives mean a forwarding-style end without a tone (silent hang-up).
const FORWARD_PHRASES = [
  'verbinde dich',
  'verbinde Sie',
  'stelle durch',
  'stelle Sie durch',
  'leite weiter',
  'leite Sie weiter',
  'leite dich weiter',
];

export function looksLikeForwarding(lastAgentMessage: string | null | undefined): boolean {
  if (!lastAgentMessage) return false;
  const lower = lastAgentMessage.toLowerCase();
  return FORWARD_PHRASES.some((p) => lower.includes(p.toLowerCase()));
}
