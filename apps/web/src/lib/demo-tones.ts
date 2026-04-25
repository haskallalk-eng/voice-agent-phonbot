// Synth-only transfer ringback for the demo. No bundled audio asset — keeps
// the SPA build lean. The European ringback pattern is 425 Hz, 1 s on / 4 s
// off; we shorten it to two short rings (~2.4 s total) so the demo modal
// doesn't stall after the agent has hung up.

const RINGBACK_HZ = 425;

export function playForwardingTone(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve();
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return resolve();
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = RINGBACK_HZ;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);

    const t0 = ctx.currentTime;
    // Ring 1: 0.0 – 1.0 s
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.18, t0 + 0.05);
    gain.gain.setValueAtTime(0.18, t0 + 0.95);
    gain.gain.linearRampToValueAtTime(0, t0 + 1.0);
    // Pause 1.0 – 1.4 s, Ring 2: 1.4 – 2.4 s
    gain.gain.setValueAtTime(0, t0 + 1.4);
    gain.gain.linearRampToValueAtTime(0.18, t0 + 1.45);
    gain.gain.setValueAtTime(0.18, t0 + 2.35);
    gain.gain.linearRampToValueAtTime(0, t0 + 2.4);

    osc.start(t0);
    osc.stop(t0 + 2.5);
    osc.onended = () => {
      ctx.close().catch(() => { /* ignore */ });
      resolve();
    };
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
