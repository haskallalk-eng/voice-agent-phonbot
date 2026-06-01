import { describe, expect, it } from 'vitest';
import {
  REQUIRED_RUNTIME_DEGRADATION_MODES,
  validateRuntimeDegradationMatrix,
  type RuntimeDegradationEntry,
} from '../runtime-degradation-matrix.js';

function entry(
  mode: RuntimeDegradationEntry['mode'],
  overrides: Partial<RuntimeDegradationEntry> = {},
): RuntimeDegradationEntry {
  return {
    mode,
    agentResponse: 'safe_status_then_clarify_or_escalate',
    escalationBehavior: 'escalate_when_task_cannot_be_completed_safely',
    traceEvent: `${mode}_degraded`,
    userVisibleWording: 'Ich kann das gerade nicht sicher abschliessen und gebe es kontrolliert weiter.',
    killSwitchOrFeatureFlag: `${mode}_kill_switch`,
    retryPolicy: 'single_bounded_retry_then_fallback',
    deadlineMs: 800,
    callDisposition: 'abstain_or_escalate',
    highRiskBehavior: 'abstain_or_escalate',
    mayGuess: false,
    mayClaimToolSuccess: false,
    metricsRequired: ['degradation_count', 'latency_ms'],
    respectsFirstSafeAudioAntiGaming: true,
    ...overrides,
  };
}

function completeMatrix(): RuntimeDegradationEntry[] {
  return REQUIRED_RUNTIME_DEGRADATION_MODES.map((mode) => entry(mode, mode === 'asr_tts_degraded'
    ? {
      agentResponse: 'targeted_clarification_or_escalation',
      callDisposition: 'continue_with_clarification',
      metricsRequired: ['asr_confidence', 'tts_error_rate', 'latency_ms'],
    }
    : mode === 'provider_latency_spike'
      ? {
        agentResponse: 'first_safe_task_relevant_status_then_stop_loss',
        callDisposition: 'abstain_or_escalate',
        deadlineMs: 700,
        metricsRequired: ['voice_e2e_ms', 'first_safe_audio_ms', 'provider_latency_ms'],
      }
      : {}));
}

describe('runtime degradation matrix contract', () => {
  it('accepts a complete matrix for all required degradation modes', () => {
    const report = validateRuntimeDegradationMatrix(completeMatrix());

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.coverage.missingModes).toEqual([]);
  });

  it('requires all planned degradation modes and explicit operational fields', () => {
    const incomplete = completeMatrix().filter((item) => item.mode !== 'redis_unavailable');
    incomplete[0] = {
      ...incomplete[0]!,
      traceEvent: '',
      userVisibleWording: '',
      killSwitchOrFeatureFlag: '',
      retryPolicy: '',
      deadlineMs: null,
    };

    const report = validateRuntimeDegradationMatrix(incomplete);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('DEGRADATION_MODE_MISSING');
    expect(report.blockers).toContain('DEGRADATION_OPERATIONAL_FIELDS_MISSING');
  });

  it('blocks degraded retrieval from guessing high-risk or tenant-specific facts', () => {
    const broken = completeMatrix().map((item) => item.mode === 'own_kb_unavailable'
      ? {
        ...item,
        callDisposition: 'continue',
        highRiskBehavior: 'continue_with_best_effort',
        mayGuess: true,
      } satisfies RuntimeDegradationEntry
      : item);

    const report = validateRuntimeDegradationMatrix(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('DEGRADED_RETRIEVAL_MAY_GUESS_HIGH_RISK');
  });

  it('blocks tool API down entries that can claim success', () => {
    const broken = completeMatrix().map((item) => item.mode === 'tool_api_down'
      ? {
        ...item,
        userVisibleWording: 'Der Termin wurde erfolgreich gebucht.',
        mayClaimToolSuccess: true,
      }
      : item);

    const report = validateRuntimeDegradationMatrix(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('TOOL_DEGRADATION_FALSE_SUCCESS_RISK');
  });

  it('requires ASR/TTS degradation metrics and clarification or escalation behavior', () => {
    const broken = completeMatrix().map((item) => item.mode === 'asr_tts_degraded'
      ? {
        ...item,
        agentResponse: 'continue_normally',
        callDisposition: 'continue',
        metricsRequired: ['latency_ms'],
      } satisfies RuntimeDegradationEntry
      : item);

    const report = validateRuntimeDegradationMatrix(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('ASR_TTS_DEGRADATION_NOT_MEASURABLE');
    expect(report.blockers).toContain('ASR_TTS_DEGRADATION_NEEDS_CLARIFICATION_OR_ESCALATION');
  });

  it('requires provider latency spikes to respect stop-loss and first-safe-audio anti-gaming', () => {
    const broken = completeMatrix().map((item) => item.mode === 'provider_latency_spike'
      ? {
        ...item,
        deadlineMs: 2200,
        respectsFirstSafeAudioAntiGaming: false,
        metricsRequired: ['latency_ms'],
      } satisfies RuntimeDegradationEntry
      : item);

    const report = validateRuntimeDegradationMatrix(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('PROVIDER_LATENCY_STOP_LOSS_MISSING');
    expect(report.blockers).toContain('FIRST_SAFE_AUDIO_ANTI_GAMING_MISSING');
  });
});
