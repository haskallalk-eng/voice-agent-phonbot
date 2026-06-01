import { describe, expect, it } from 'vitest';
import {
  evaluateVoicePipelineContract,
  type VoicePipelineContract,
} from '../voice-pipeline-contract.js';

const t0 = Date.parse('2026-05-30T08:00:00.000Z');

function contract(overrides: Partial<VoicePipelineContract> = {}): VoicePipelineContract {
  return {
    callId: 'call-1',
    turnId: 'turn-1',
    provider: 'retell',
    channel: 'voice',
    normalSupportedTurn: true,
    supportedNonToolTurn: true,
    stt: {
      audioStartAt: t0 - 900,
      audioEndDetectedAt: t0,
      providerEndOfTurnAt: t0 + 20,
      partialFirstAt: t0 - 500,
      finalAt: t0 + 35,
      confidence: 0.92,
      locale: 'de-DE',
      transcriptRedactionState: 'redacted',
      transcriptSource: 'canonical_final',
    },
    ttt: {
      agentCoreTurnStartAt: t0 + 40,
      firstModelTokenAt: t0 + 190,
      firstSpeakableChunkAt: t0 + 360,
      canonicalUserUtterance: 'Wann habt ihr morgen geoeffnet?',
      canonicalUserUtteranceRedactionState: 'redacted',
      intent: 'opening_hours',
      taskState: 'answering',
      requiredFieldsState: 'not_required',
      evidenceDecision: 'approved_current',
      policyDecision: 'answer_allowed',
      toolDecision: 'no_tool_required',
      responsePlan: 'answer_with_current_hours',
      abstainOrEscalationReason: 'not_required',
    },
    tts: {
      writtenText: 'Morgen haben wir von 9-18 Uhr geoeffnet.',
      spokenText: 'Morgen haben wir von neun bis achtzehn Uhr geoeffnet.',
      safeAudioType: 'evidence_backed_answer',
      firstSafeAudioAt: t0 + 480,
      firstFullAnswerAudioAt: t0 + 650,
      audioStartAt: t0 + 480,
      audioEndAt: t0 + 1500,
      pronunciationProfile: 'de-DE-default',
      pronunciationReviewRequired: false,
      factPreserved: true,
    },
    runtime: {
      interactionState: 'normal_turn',
      providerResponseId: 'response-1',
      transportDelayMs: 20,
      bargeInRecoveryMs: null,
      staleAudioStopped: true,
    },
    ...overrides,
  };
}

describe('STT / TTT / TTS voice pipeline contract', () => {
  it('keeps STT, TTT, TTS, and runtime interaction readiness separate', () => {
    const report = evaluateVoicePipelineContract(contract());

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.layerReadiness).toEqual({
      stt: true,
      ttt: true,
      tts: true,
      runtime_interaction: true,
    });
    expect(report.metrics).toMatchObject({
      sttFinalLatencyMs: 35,
      tttFirstTokenLatencyMs: 150,
      tttSpeakableChunkLatencyMs: 320,
      firstSpeakableChunkToSafeAudioMs: 120,
      voiceE2eFirstSafeAudioMs: 480,
      voiceE2eFullAnswerAudioMs: 650,
      runtimeTransportDelayMs: 20,
    });
  });

  it('classifies low-confidence transcript problems as STT failures, not reasoning failures', () => {
    const report = evaluateVoicePipelineContract(contract({
      stt: {
        ...contract().stt,
        confidence: 0.41,
        transcriptRedactionState: 'raw_not_stored',
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.failureClasses).toContain('asr_stt_failure');
    expect(report.failureClasses).not.toContain('text_reasoning_ttt_failure');
    expect(report.blockers).toContain('STT_CONFIDENCE_BELOW_THRESHOLD');
  });

  it('classifies missing evidence or policy decisions as TTT reasoning failures', () => {
    const report = evaluateVoicePipelineContract(contract({
      ttt: {
        ...contract().ttt,
        evidenceDecision: 'missing',
        policyDecision: 'missing',
        responsePlan: '' as never,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.failureClasses).toContain('text_reasoning_ttt_failure');
    expect(report.failureClasses).not.toContain('asr_stt_failure');
    expect(report.blockers).toContain('TTT_DECISION_MISSING');
  });

  it('requires canonical STT source, TTT redaction, TTT timestamps, and TTS review fields', () => {
    const report = evaluateVoicePipelineContract(contract({
      stt: {
        ...contract().stt,
        transcriptSource: '' as never,
      },
      ttt: {
        ...contract().ttt,
        canonicalUserUtteranceRedactionState: null,
        agentCoreTurnStartAt: undefined,
      },
      tts: {
        ...contract().tts,
        pronunciationReviewRequired: null,
        factPreserved: null,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('STT_TRANSCRIPT_SOURCE_MISSING');
    expect(report.blockers).toContain('TTT_REDACTION_STATE_MISSING');
    expect(report.blockers).toContain('TTT_TIMESTAMP_MISSING');
    expect(report.blockers).toContain('TTS_PRONUNCIATION_REVIEW_STATE_MISSING');
    expect(report.blockers).toContain('TTS_FACT_PRESERVATION_UNVERIFIED');
  });

  it('fails closed when voice-turn SLO classification is missing or redaction states are invalid', () => {
    const report = evaluateVoicePipelineContract({
      ...contract(),
      normalSupportedTurn: undefined,
      supportedNonToolTurn: undefined,
      stt: {
        ...contract().stt,
        transcriptRedactionState: 'raw' as never,
      },
      ttt: {
        ...contract().ttt,
        canonicalUserUtteranceRedactionState: 'raw' as never,
      },
    });

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('TURN_SLO_CLASSIFICATION_MISSING');
    expect(report.blockers).toContain('STT_REDACTION_STATE_INVALID');
    expect(report.blockers).toContain('TTT_REDACTION_STATE_INVALID');
  });

  it('requires canonical turn attribution and validates provider/channel values', () => {
    const report = evaluateVoicePipelineContract({
      ...contract(),
      callId: '',
      turnId: '',
      provider: 'internal_test' as never,
      channel: 'phone' as never,
    });

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('PIPELINE_ATTRIBUTION_MISSING');
    expect(report.blockers).toContain('PIPELINE_PROVIDER_INVALID');
    expect(report.blockers).toContain('PIPELINE_CHANNEL_INVALID');
  });

  it('rejects non-finite or non-boolean runtime values', () => {
    const report = evaluateVoicePipelineContract(contract({
      stt: {
        ...contract().stt,
        confidence: Number.NaN,
      },
      tts: {
        ...contract().tts,
        pronunciationReviewRequired: 'false' as never,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('STT_CONFIDENCE_INVALID');
    expect(report.blockers).toContain('TTS_PRONUNCIATION_REVIEW_STATE_INVALID');
  });

  it('rejects invalid runtime numeric values', () => {
    const report = evaluateVoicePipelineContract(contract({
      runtime: {
        ...contract().runtime,
        transportDelayMs: Number.NaN,
        bargeInRecoveryMs: -1,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('RUNTIME_TRANSPORT_DELAY_INVALID');
    expect(report.blockers).toContain('RUNTIME_BARGE_IN_RECOVERY_INVALID');
  });

  it('rejects provider-specific vocabulary in canonical string values', () => {
    const report = evaluateVoicePipelineContract(contract({
      stt: {
        ...contract().stt,
        transcriptSource: 'retell_response_required_event' as never,
      },
      ttt: {
        ...contract().ttt,
        responsePlan: 'use_openai_realtime_payload_shape' as never,
      },
      tts: {
        ...contract().tts,
        pronunciationProfile: 'openai_voice_id_alloy' as never,
        spokenText: '<ssml>Hallo</ssml>',
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('STT_TRANSCRIPT_SOURCE_INVALID');
    expect(report.blockers).toContain('PROVIDER_SPECIFIC_STT_VALUE_PRESENT');
    expect(report.blockers).toContain('TTT_CANONICAL_FIELD_INVALID');
    expect(report.blockers).toContain('PROVIDER_SPECIFIC_TTT_VALUE_PRESENT');
    expect(report.blockers).toContain('TTS_PRONUNCIATION_PROFILE_INVALID');
    expect(report.blockers).toContain('PROVIDER_SPECIFIC_TTS_VALUE_PRESENT');
  });

  it('rejects unknown canonical boundary values even when they do not match provider denylist words', () => {
    const report = evaluateVoicePipelineContract(contract({
      stt: {
        ...contract().stt,
        transcriptSource: 'vendor_audio_done' as never,
      },
      ttt: {
        ...contract().ttt,
        intent: 'vendor_router_intent' as never,
        taskState: 'vendor_state' as never,
        requiredFieldsState: 'vendor_fields' as never,
        responsePlan: 'vendor_plan' as never,
        abstainOrEscalationReason: 'vendor_reason' as never,
      },
      tts: {
        ...contract().tts,
        pronunciationProfile: 'vendor_voice_profile' as never,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('STT_TRANSCRIPT_SOURCE_INVALID');
    expect(report.blockers).toContain('TTT_CANONICAL_FIELD_INVALID');
    expect(report.blockers).toContain('TTS_PRONUNCIATION_PROFILE_INVALID');
  });

  it('rejects provider-specific payload fields at pipeline and runtime levels', () => {
    const report = evaluateVoicePipelineContract({
      ...contract(),
      rawProviderPayload: { event: 'provider_payload' },
      runtime: {
        ...contract().runtime,
        providerAudioPayload: 'base64',
      } as never,
    } as never);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('PROVIDER_SPECIFIC_PIPELINE_FIELD_PRESENT');
    expect(report.blockers).toContain('PROVIDER_SPECIFIC_RUNTIME_FIELD_PRESENT');
  });

  it('fails closed when a turn opts out of all live SLO classes without an exception path', () => {
    const report = evaluateVoicePipelineContract({
      ...contract(),
      normalSupportedTurn: false,
      supportedNonToolTurn: false,
    });

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('TURN_SLO_CLASSIFICATION_INVALID');
  });

  it('validates exception paths before they can replace live SLO classes', () => {
    const report = evaluateVoicePipelineContract({
      ...contract(),
      normalSupportedTurn: false,
      supportedNonToolTurn: false,
      exceptionPath: 'slow_normal_turn' as never,
    });

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('EXCEPTION_PATH_INVALID');
  });

  it('does not allow a normal turn to relabel itself into the looser supported-non-tool SLO without an exception path', () => {
    const report = evaluateVoicePipelineContract({
      ...contract(),
      normalSupportedTurn: false,
      supportedNonToolTurn: true,
      tts: {
        ...contract().tts,
        firstSafeAudioAt: t0 + 920,
        firstFullAnswerAudioAt: t0 + 1100,
        audioStartAt: t0 + 920,
      },
    });

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('TURN_SLO_CLASSIFICATION_INVALID');
  });

  it('does not allow normal supported turns to opt out of the supported non-tool class', () => {
    const report = evaluateVoicePipelineContract({
      ...contract(),
      normalSupportedTurn: true,
      supportedNonToolTurn: false,
    });

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('TURN_SLO_CLASSIFICATION_INVALID');
  });

  it('does not allow exception paths to mix with live supported-non-tool SLO classes', () => {
    const report = evaluateVoicePipelineContract({
      ...contract(),
      normalSupportedTurn: false,
      supportedNonToolTurn: true,
      exceptionPath: 'high_risk_audited_answer',
      tts: {
        ...contract().tts,
        safeAudioType: 'targeted_clarification',
        firstSafeAudioAt: t0 + 920,
        firstFullAnswerAudioAt: t0 + 2400,
        audioStartAt: t0 + 920,
        audioEndAt: t0 + 2600,
      },
      ttt: {
        ...contract().ttt,
        policyDecision: 'clarification_required',
        responsePlan: 'ask_targeted_clarification',
        abstainOrEscalationReason: 'high_risk_answer_requires_audit',
      },
    });

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('TURN_SLO_CLASSIFICATION_INVALID');
    expect(report.blockers).toContain('EXCEPTION_PATH_SAFE_AUDIO_ABOVE_BUDGET');
  });

  it('requires exception paths to meet their own first-safe-audio budgets', () => {
    const report = evaluateVoicePipelineContract({
      ...contract(),
      normalSupportedTurn: false,
      supportedNonToolTurn: false,
      exceptionPath: 'high_risk_audited_answer',
      tts: {
        ...contract().tts,
        safeAudioType: 'targeted_clarification',
        firstSafeAudioAt: t0 + 920,
        firstFullAnswerAudioAt: t0 + 2400,
        audioStartAt: t0 + 920,
        audioEndAt: t0 + 2600,
      },
      ttt: {
        ...contract().ttt,
        policyDecision: 'clarification_required',
        responsePlan: 'ask_targeted_clarification',
        abstainOrEscalationReason: 'high_risk_answer_requires_audit',
      },
    });

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('EXCEPTION_PATH_SAFE_AUDIO_ABOVE_BUDGET');
  });

  it('requires exception paths to match runtime and policy semantics', () => {
    const report = evaluateVoicePipelineContract({
      ...contract(),
      normalSupportedTurn: false,
      supportedNonToolTurn: false,
      exceptionPath: 'runtime_degraded',
    });

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('EXCEPTION_PATH_SEMANTIC_MISMATCH');
  });

  it('blocks unsupported evidence from being treated as an allowed answer', () => {
    const report = evaluateVoicePipelineContract(contract({
      ttt: {
        ...contract().ttt,
        evidenceDecision: 'stale',
        policyDecision: 'answer_allowed',
        abstainOrEscalationReason: 'not_required',
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.failureClasses).toContain('text_reasoning_ttt_failure');
    expect(report.blockers).toContain('TTT_UNSAFE_EVIDENCE_DECISION');
  });

  it('requires policy decisions to match safe audio type', () => {
    const report = evaluateVoicePipelineContract(contract({
      ttt: {
        ...contract().ttt,
        policyDecision: 'abstain_required',
        abstainOrEscalationReason: 'source_stale',
      },
      tts: {
        ...contract().tts,
        safeAudioType: 'evidence_backed_answer',
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('TTT_POLICY_SAFE_AUDIO_MISMATCH');
    expect(report.failureClasses).toContain('text_reasoning_ttt_failure');
  });

  it('does not let tool decision branches bypass stricter policy audio requirements', () => {
    const report = evaluateVoicePipelineContract(contract({
      ttt: {
        ...contract().ttt,
        policyDecision: 'abstain_required',
        toolDecision: 'tool_required',
        abstainOrEscalationReason: 'source_stale',
      },
      tts: {
        ...contract().tts,
        safeAudioType: 'targeted_clarification',
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('TTT_POLICY_SAFE_AUDIO_MISMATCH');
  });

  it('does not allow answer_allowed to hide behind abstain or escalation audio', () => {
    const report = evaluateVoicePipelineContract(contract({
      tts: {
        ...contract().tts,
        safeAudioType: 'valid_abstain',
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('TTT_POLICY_SAFE_AUDIO_MISMATCH');
  });

  it('classifies broken spoken output or filler-only audio as TTS failures', () => {
    const report = evaluateVoicePipelineContract(contract({
      tts: {
        ...contract().tts,
        spokenText: '',
        safeAudioType: 'filler_only',
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.failureClasses).toContain('tts_spoken_output_failure');
    expect(report.blockers).toContain('TTS_SPOKEN_TEXT_MISSING');
    expect(report.blockers).toContain('TTS_FILLER_ONLY_NOT_SLO_ELIGIBLE');
    expect(report.metrics.ttsAudioStartToSafeAudioMs).toBeNull();
  });

  it('rejects invalid safe audio type values from runtime input', () => {
    const report = evaluateVoicePipelineContract(contract({
      tts: {
        ...contract().tts,
        safeAudioType: 'quick_noise' as never,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('TTS_SAFE_AUDIO_TYPE_INVALID');
    expect(report.failureClasses).toContain('tts_spoken_output_failure');
  });

  it('blocks unresolved pronunciation review before voice-output readiness', () => {
    const report = evaluateVoicePipelineContract(contract({
      tts: {
        ...contract().tts,
        pronunciationReviewRequired: true,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('TTS_PRONUNCIATION_REVIEW_UNRESOLVED');
    expect(report.failureClasses).toContain('tts_spoken_output_failure');
  });

  it('blocks normal supported turns that miss the 800 ms first-safe-audio SLO', () => {
    const report = evaluateVoicePipelineContract(contract({
      tts: {
        ...contract().tts,
        firstSafeAudioAt: t0 + 840,
        firstFullAnswerAudioAt: t0 + 980,
        audioStartAt: t0 + 840,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('NORMAL_SUPPORTED_SAFE_AUDIO_ABOVE_800_MS');
  });

  it('classifies stale audio after interruption as runtime interaction failure', () => {
    const report = evaluateVoicePipelineContract(contract({
      runtime: {
        interactionState: 'interrupted',
        providerResponseId: 'response-1',
        interruptedResponseId: 'response-1',
        stoppedResponseId: 'response-1',
        newTurnId: 'turn-2',
        interruptionReceivedAt: t0 + 120,
        bargeInRecoveredAt: t0 + 840,
        transportDelayMs: 20,
        bargeInRecoveryMs: 720,
        staleAudioStopped: false,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.failureClasses).toContain('runtime_interaction_failure');
    expect(report.blockers).toContain('RUNTIME_STALE_AUDIO_NOT_STOPPED');
    expect(report.blockers).toContain('RUNTIME_BARGE_IN_RECOVERY_ABOVE_500MS');
  });

  it('requires interruption timestamps and response correlation', () => {
    const report = evaluateVoicePipelineContract(contract({
      runtime: {
        interactionState: 'interrupted',
        providerResponseId: 'response-1',
        transportDelayMs: 20,
        bargeInRecoveryMs: 80,
        staleAudioStopped: true,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('RUNTIME_INTERRUPTION_TIMESTAMP_MISSING');
    expect(report.blockers).toContain('RUNTIME_INTERRUPTION_CORRELATION_MISSING');
  });

  it('requires interrupted provider response and next turn correlation', () => {
    const report = evaluateVoicePipelineContract(contract({
      runtime: {
        interactionState: 'interrupted',
        providerResponseId: 'response-active',
        interruptedResponseId: 'response-old',
        stoppedResponseId: 'response-old',
        newTurnId: 'turn-1',
        interruptionReceivedAt: t0 + 120,
        bargeInRecoveredAt: t0 + 220,
        transportDelayMs: 20,
        bargeInRecoveryMs: 100,
        staleAudioStopped: true,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('RUNTIME_INTERRUPTION_CORRELATION_MISSING');
  });

  it('rejects invalid runtime interaction states', () => {
    const report = evaluateVoicePipelineContract(contract({
      runtime: {
        ...contract().runtime,
        interactionState: 'user_interrupted' as never,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('RUNTIME_INTERACTION_STATE_INVALID');
    expect(report.failureClasses).toContain('runtime_interaction_failure');
  });

  it('rejects barge-in recovery metrics that conflict with canonical timestamps', () => {
    const report = evaluateVoicePipelineContract(contract({
      runtime: {
        interactionState: 'interrupted',
        providerResponseId: 'response-1',
        interruptedResponseId: 'response-1',
        stoppedResponseId: 'response-1',
        newTurnId: 'turn-2',
        interruptionReceivedAt: t0 + 100,
        bargeInRecoveredAt: t0 + 740,
        transportDelayMs: 20,
        bargeInRecoveryMs: 80,
        staleAudioStopped: true,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('RUNTIME_BARGE_IN_RECOVERY_MISMATCH');
    expect(report.blockers).toContain('RUNTIME_BARGE_IN_RECOVERY_ABOVE_500MS');
  });

  it('requires all canonical STT and TTS timestamp boundaries', () => {
    const report = evaluateVoicePipelineContract(contract({
      stt: {
        ...contract().stt,
        audioStartAt: undefined,
      },
      tts: {
        ...contract().tts,
        audioEndAt: undefined,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('STT_TIMESTAMP_MISSING');
    expect(report.blockers).toContain('TTS_AUDIO_TIMESTAMP_MISSING');
    expect(report.failureClasses).toContain('asr_stt_failure');
    expect(report.failureClasses).toContain('tts_spoken_output_failure');
  });

  it('rejects impossible cross-layer timestamp ordering', () => {
    const report = evaluateVoicePipelineContract(contract({
      tts: {
        ...contract().tts,
        firstSafeAudioAt: t0 + 20,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('INVALID_PIPELINE_TIMESTAMP_ORDER');
    expect(report.failureClasses).toContain('tts_spoken_output_failure');
    expect(report.layerReadiness.tts).toBe(false);
  });

  it('keeps provider-specific STT and TTS payloads out of the canonical contract', () => {
    const report = evaluateVoicePipelineContract(contract({
      stt: {
        ...contract().stt,
        providerSpecificEventName: 'provider_specific_audio_transcript_done',
      } as never,
      tts: {
        ...contract().tts,
        providerSynthesisMarkup: '<provider-speak>Hallo</provider-speak>',
      } as never,
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('PROVIDER_SPECIFIC_STT_FIELD_PRESENT');
    expect(report.blockers).toContain('PROVIDER_SPECIFIC_TTS_FIELD_PRESENT');
  });

  it('rejects renamed provider-specific payload fields outside adapters', () => {
    const report = evaluateVoicePipelineContract(contract({
      stt: {
        ...contract().stt,
        acousticMetadata: { vendor: 'provider' },
      } as never,
      tts: {
        ...contract().tts,
        providerPayloadShape: { audio: 'base64' },
      } as never,
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('PROVIDER_SPECIFIC_STT_FIELD_PRESENT');
    expect(report.blockers).toContain('PROVIDER_SPECIFIC_TTS_FIELD_PRESENT');
  });
});
