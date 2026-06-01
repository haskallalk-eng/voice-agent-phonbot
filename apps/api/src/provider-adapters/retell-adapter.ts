import type {
  CanonicalBase,
  CanonicalRuntimeEvent,
  ProviderAdapter,
  RuntimeCommand,
} from '../voice-runtime-contract.js';
import type { TrustedScope } from '../trusted-scope.js';
import { redactForTrace } from '../pii.js';

export type RetellRawTranscriptTurn = {
  role: 'user' | 'agent' | 'tool';
  content: string;
  timestamp?: string;
};

export type RetellRawRuntimeEvent = {
  event:
    | 'call_started'
    | 'response_required'
    | 'update_only'
    | 'user_interrupted'
    | 'call_ended';
  event_id: string;
  call_id: string;
  response_id?: string;
  turn_id?: string;
  sequence?: number;
  timestamp: string;
  last_user_transcript?: string;
  transcript?: RetellRawTranscriptTurn[];
  transcript_with_tool_calls?: unknown;
  interruption?: {
    response_id?: string;
    partial_transcript?: string;
  };
  end_reason?: 'user_hangup' | 'agent_end_call' | 'transfer' | 'provider_error';
};

export type RetellProviderMessage = {
  response_id?: string;
  content?: string;
  content_complete?: boolean;
  end_call?: boolean;
  transfer_to?: string;
  runtime_options?: {
    audio_output_enabled?: boolean;
    response_interruptible?: boolean;
    vad_sensitivity?: 'low' | 'medium' | 'high';
    max_silence_ms?: number;
  };
};

export type RetellAdapterContext = {
  trustedScope: TrustedScope;
  traceId: string;
  receivedAt: string;
};

function base(raw: RetellRawRuntimeEvent, context: RetellAdapterContext): CanonicalBase {
  return {
    eventId: raw.event_id,
    traceId: context.traceId,
    trustedScope: context.trustedScope,
    provider: 'retell',
    channel: 'voice',
    providerEventId: raw.event_id,
    providerCallId: raw.call_id,
    sequence: raw.sequence,
    turnId: raw.turn_id,
    responseId: raw.response_id,
    occurredAt: raw.timestamp,
    receivedAt: context.receivedAt,
  };
}

function redactedRecentTurns(raw: RetellRawRuntimeEvent) {
  return (raw.transcript ?? []).slice(-4).map((turn) => ({
    role: turn.role,
    text: redactForTrace(turn.content),
    occurredAt: turn.timestamp,
  }));
}

export function createRetellAdapter(context: RetellAdapterContext): ProviderAdapter<RetellRawRuntimeEvent, RetellProviderMessage> {
  return {
    normalizeEvent(raw) {
      const canonicalBase = base(raw, context);
      if (raw.event === 'call_started') {
        return [{
          ...canonicalBase,
          type: 'CallStarted',
        }];
      }
      if (raw.event === 'response_required') {
        return [{
          ...canonicalBase,
          type: 'AgentTurnRequested',
          currentUserText: raw.last_user_transcript,
          redactedRecentTurns: redactedRecentTurns(raw),
          compactStateSummary: raw.transcript_with_tool_calls == null ? undefined : 'provider_transcript_reduced',
        }];
      }
      if (raw.event === 'update_only') {
        return raw.last_user_transcript
          ? [{
            ...canonicalBase,
            type: 'UserSpeechPartial',
            text: raw.last_user_transcript,
          }]
          : [];
      }
      if (raw.event === 'user_interrupted') {
        return [{
          ...canonicalBase,
          type: 'UserInterrupted',
          interruptedTurnId: raw.turn_id,
          interruptedResponseId: raw.interruption?.response_id ?? raw.response_id,
          currentPartialText: raw.interruption?.partial_transcript,
        }];
      }
      return [{
        ...canonicalBase,
        type: 'CallEnded',
        reason: raw.end_reason ?? 'unknown',
      }];
    },
    renderCommand(command: RuntimeCommand) {
      if (command.type === 'SpeakStart' || command.type === 'SpeakDelta') {
        return [{
          response_id: command.responseId,
          content: command.text,
          content_complete: command.isFinal,
        }];
      }
      if (command.type === 'SpeakEnd') {
        return [{
          response_id: command.responseId,
          content_complete: true,
        }];
      }
      if (command.type === 'EndCall') return [{ end_call: true }];
      if (command.type === 'TransferCall') return [{ transfer_to: command.targetId }];
      if (command.type === 'UpdateRuntimeTuning') {
        return [{
          runtime_options: {
            audio_output_enabled: command.patch.audioOutputEnabled,
            response_interruptible: command.patch.responseInterruptible,
            vad_sensitivity: command.patch.vadSensitivity,
            max_silence_ms: command.patch.maxSilenceMs,
          },
        }];
      }
      return [];
    },
  };
}
