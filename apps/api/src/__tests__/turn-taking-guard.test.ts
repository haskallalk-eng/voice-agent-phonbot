import { describe, expect, it } from 'vitest';
import {
  evaluateTurnTakingGuard,
  runTurnTakingGuardSimulation,
} from '../turn-taking-guard.js';

describe('Turn-Taking / Endpointing Guard', () => {
  it('responds immediately for complete German final utterances', () => {
    const decision = evaluateTurnTakingGuard({
      transcriptText: 'Ich suche eine Haarfarbe.',
      transcriptFinal: true,
      asrConfidence: 0.92,
      partialStableMs: 420,
      silenceMs: 360,
      nowMs: 1000,
    });

    expect(decision.action).toBe('respond_now');
    expect(decision.reason).toBe('final_transcript_complete');
    expect(decision.userLikelyDone).toBeGreaterThan(decision.userLikelyContinuing);
    expect(decision.mayCallLlm).toBe(false);
    expect(decision.mayCallKb).toBe(false);
    expect(decision.mayAuthorizeTool).toBe(false);
    expect(decision.mayEndCall).toBe(false);
  });

  it('waits briefly on trailing German connectors instead of cutting in', () => {
    const decision = evaluateTurnTakingGuard({
      transcriptText: 'Ich suche eine Haarfarbe und',
      transcriptFinal: false,
      asrConfidence: 0.88,
      partialStableMs: 120,
      silenceMs: 160,
      nowMs: 1000,
    });

    expect(decision.action).toBe('wait_short');
    expect(decision.reason).toBe('trailing_connector');
    expect(decision.userLikelyContinuing).toBeGreaterThan(decision.userLikelyDone);
    expect(decision.maxWaitMs).toBeGreaterThanOrEqual(150);
    expect(decision.maxWaitMs).toBeLessThanOrEqual(300);
  });

  it('waits on German thinking fillers such as aehm instead of treating them as complete', () => {
    const decision = evaluateTurnTakingGuard({
      transcriptText: 'Ich suche eine Haarfarbe aehm',
      transcriptFinal: false,
      asrConfidence: 0.86,
      partialStableMs: 140,
      silenceMs: 140,
      nowMs: 1000,
    });

    expect(decision.action).toBe('wait_short');
    expect(decision.reason).toBe('trailing_connector');
  });

  it('uses repair prompt for low-confidence speech without authorizing end call', () => {
    const decision = evaluateTurnTakingGuard({
      transcriptText: 'ha farb',
      transcriptFinal: true,
      asrConfidence: 0.37,
      partialStableMs: 300,
      silenceMs: 420,
      nowMs: 1000,
    });

    expect(decision.action).toBe('repair_prompt');
    expect(decision.reason).toBe('low_asr_confidence');
    expect(decision.mayEndCall).toBe(false);
  });

  it('keeps listening when a partial transcript is still changing', () => {
    const decision = evaluateTurnTakingGuard({
      transcriptText: 'Ich wollte',
      transcriptFinal: false,
      asrConfidence: 0.83,
      partialStableMs: 40,
      silenceMs: 60,
      nowMs: 1000,
    });

    expect(decision.action).toBe('keep_listening');
    expect(decision.reason).toBe('partial_still_changing');
  });

  it('treats repeated inaudible speech as repair, not as permission to end the call', () => {
    const decision = evaluateTurnTakingGuard({
      transcriptText: '(inaudible speech)',
      transcriptFinal: true,
      asrConfidence: 0.2,
      partialStableMs: 500,
      silenceMs: 700,
      inaudibleStreak: 3,
      nowMs: 1000,
    });

    expect(decision.action).toBe('repair_prompt');
    expect(decision.reason).toBe('inaudible_streak');
    expect(decision.mayEndCall).toBe(false);
  });

  it('prioritizes correction and interruption phrases instead of continuing stale output', () => {
    const decision = evaluateTurnTakingGuard({
      transcriptText: 'Nein warte, ich meinte die andere Farbe.',
      transcriptFinal: true,
      asrConfidence: 0.9,
      partialStableMs: 260,
      silenceMs: 260,
      interruptionDetected: true,
      nowMs: 1000,
    });

    expect(decision.action).toBe('respond_now');
    expect(decision.reason).toBe('interruption_or_correction');
  });

  it('does not authorize end call even on long true silence', () => {
    const decision = evaluateTurnTakingGuard({
      transcriptText: '',
      transcriptFinal: false,
      asrConfidence: null,
      partialStableMs: 0,
      silenceMs: 5000,
      nowMs: 1000,
    });

    expect(decision.action).toBe('repair_prompt');
    expect(decision.reason).toBe('long_silence');
    expect(decision.mayEndCall).toBe(false);
    expect(decision.mayAuthorizeTool).toBe(false);
  });

  it('keeps the 1000-case synthetic decision p95 under 20 ms without extra calls', () => {
    const report = runTurnTakingGuardSimulation({ cases: 1000, seed: 'turn-guard-v1' });

    expect(report.caseCount).toBe(1000);
    expect(report.p95DecisionMs).toBeLessThanOrEqual(20);
    expect(report.extraLlmCalls).toBe(0);
    expect(report.extraKbCalls).toBe(0);
    expect(report.failures).toEqual([]);
  });
});
