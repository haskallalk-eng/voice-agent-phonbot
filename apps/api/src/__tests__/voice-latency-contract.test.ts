import { describe, expect, it } from 'vitest';
import {
  evaluateVoiceLatencyContract,
  safeAudioCountsForSlo,
  type VoiceLatencyTimestampContract,
} from '../voice-latency-contract.js';

function contract(overrides: Partial<VoiceLatencyTimestampContract> = {}): VoiceLatencyTimestampContract {
  const t0 = Date.parse('2026-05-29T10:00:00.000Z');
  return {
    callId: 'call_1',
    turnId: 'turn_1',
    provider: 'retell',
    user_audio_end_detected_at: t0,
    provider_end_of_turn_at: t0 + 20,
    asr_partial_first_at: t0 - 450,
    asr_final_at: t0 + 35,
    agent_core_turn_start_at: t0 + 50,
    first_model_token_at: t0 + 140,
    first_speakable_chunk_at: t0 + 210,
    first_safe_audio_at: t0 + 480,
    first_filler_audio_at: null,
    first_full_answer_audio_at: t0 + 650,
    safe_audio_type: 'evidence_backed_answer',
    ...overrides,
  };
}

describe('voice latency measurement contract', () => {
  it('derives voice_e2e_ms from user audio end to first safe audio', () => {
    const report = evaluateVoiceLatencyContract(contract());

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.metrics).toMatchObject({
      voiceE2eMs: 480,
      providerEndToSafeAudioMs: 460,
      asrPartialToFinalMs: 485,
      asrFinalToSafeAudioMs: 445,
      agentCoreToSafeAudioMs: 430,
      agentCoreToFirstTokenMs: 90,
      firstTokenToSpeakableChunkMs: 70,
      firstSpeakableChunkToSafeAudioMs: 270,
      firstSafeAudioMs: 480,
      firstFullAnswerAudioMs: 650,
      safeAudioCountsForSlo: true,
    });
  });

  it('fails readiness when required timestamps are missing', () => {
    const report = evaluateVoiceLatencyContract(contract({
      asr_final_at: null,
      first_model_token_at: undefined,
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('MISSING_REQUIRED_TIMESTAMP');
    expect(report.missingRequiredTimestamps).toEqual(['asr_final_at', 'first_model_token_at']);
  });

  it('rejects timestamp ordering that would replace e2e with a shorter internal span', () => {
    const report = evaluateVoiceLatencyContract(contract({
      first_safe_audio_at: Date.parse('2026-05-29T09:59:59.900Z'),
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('INVALID_TIMESTAMP_ORDER');
  });

  it('does not let filler-only audio satisfy the 500-800 ms SLO', () => {
    const report = evaluateVoiceLatencyContract(contract({
      first_safe_audio_at: Date.parse('2026-05-29T10:00:00.300Z'),
      first_full_answer_audio_at: Date.parse('2026-05-29T10:00:01.100Z'),
      safe_audio_type: 'filler_only',
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('FILLER_ONLY_NOT_SLO_ELIGIBLE');
    expect(report.metrics.safeAudioCountsForSlo).toBe(false);
    expect(report.metrics.voiceE2eMs).toBeNull();
    expect(report.metrics.firstSafeAudioMs).toBeNull();
    expect(report.metrics.firstFillerAudioMs).toBe(300);
    expect(report.metrics.firstFullAnswerAudioMs).toBe(1100);
  });

  it('allows only task-relevant safe audio types to count toward the SLO', () => {
    expect(safeAudioCountsForSlo('targeted_clarification')).toBe(true);
    expect(safeAudioCountsForSlo('valid_abstain')).toBe(true);
    expect(safeAudioCountsForSlo('tool_status_update')).toBe(true);
    expect(safeAudioCountsForSlo('filler_only')).toBe(false);
    expect(safeAudioCountsForSlo(null)).toBe(false);
  });
});
