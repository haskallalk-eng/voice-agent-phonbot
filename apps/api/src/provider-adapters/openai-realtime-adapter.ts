import type {
  CanonicalBase,
  CanonicalRuntimeEvent,
  ProviderAdapter,
  RuntimeCommand,
} from '../voice-runtime-contract.js';
import type { TrustedScope } from '../trusted-scope.js';
import { redactForTrace } from '../pii.js';

export type OpenAIRealtimeRawRuntimeEvent = {
  type:
    | 'session.started'
    | 'conversation.item.input_audio_transcription.delta'
    | 'conversation.item.input_audio_transcription.completed'
    | 'response.create'
    | 'input_audio_buffer.speech_started'
    | 'response.done';
  event_id: string;
  session_id: string;
  item_id?: string;
  response_id?: string;
  turn_id?: string;
  sequence?: number;
  created_at: string;
  delta?: string;
  transcript?: string;
  reason?: 'completed' | 'cancelled' | 'failed';
};

export type OpenAIRealtimeProviderMessage = {
  type: string;
  response_id?: string;
  text?: string;
  final?: boolean;
  session?: {
    audio?: {
      input?: { enabled?: boolean };
      output?: { enabled?: boolean };
    };
    turn_detection?: {
      threshold?: number;
      silence_duration_ms?: number;
    };
  };
};

export type OpenAIRealtimeAdapterContext = {
  trustedScope: TrustedScope;
  traceId: string;
  receivedAt: string;
  providerCallId?: string;
};

function base(raw: OpenAIRealtimeRawRuntimeEvent, context: OpenAIRealtimeAdapterContext): CanonicalBase {
  return {
    eventId: raw.event_id,
    traceId: context.traceId,
    trustedScope: context.trustedScope,
    provider: 'openai_realtime',
    channel: 'voice',
    providerEventId: raw.event_id,
    providerCallId: context.providerCallId,
    providerSessionId: raw.session_id,
    sequence: raw.sequence,
    turnId: raw.turn_id ?? raw.item_id,
    responseId: raw.response_id,
    occurredAt: raw.created_at,
    receivedAt: context.receivedAt,
  };
}

function vadSensitivityToThreshold(value: 'low' | 'medium' | 'high' | undefined): number | undefined {
  if (value === 'low') return 0.35;
  if (value === 'medium') return 0.5;
  if (value === 'high') return 0.7;
  return undefined;
}

export function createOpenAIRealtimeAdapter(
  context: OpenAIRealtimeAdapterContext,
): ProviderAdapter<OpenAIRealtimeRawRuntimeEvent, OpenAIRealtimeProviderMessage> {
  return {
    normalizeEvent(raw) {
      const canonicalBase = base(raw, context);
      if (raw.type === 'session.started') {
        return [{
          ...canonicalBase,
          type: 'CallStarted',
        }];
      }
      if (raw.type === 'conversation.item.input_audio_transcription.delta') {
        return [{
          ...canonicalBase,
          type: 'UserSpeechPartial',
          text: raw.delta ?? '',
        }];
      }
      if (raw.type === 'conversation.item.input_audio_transcription.completed') {
        return [{
          ...canonicalBase,
          type: 'UserSpeechFinal',
          text: raw.transcript ?? '',
          redactedRecentTurns: raw.transcript ? [{ role: 'user', text: redactForTrace(raw.transcript), occurredAt: raw.created_at }] : [],
        }];
      }
      if (raw.type === 'response.create') {
        return [{
          ...canonicalBase,
          type: 'AgentTurnRequested',
          currentUserText: raw.transcript,
          redactedRecentTurns: raw.transcript ? [{ role: 'user', text: redactForTrace(raw.transcript), occurredAt: raw.created_at }] : [],
        }];
      }
      if (raw.type === 'input_audio_buffer.speech_started') {
        return [{
          ...canonicalBase,
          type: 'UserInterrupted',
          interruptedTurnId: raw.turn_id,
          interruptedResponseId: raw.response_id,
        }];
      }
      return [{
        ...canonicalBase,
        type: 'CallEnded',
        reason: raw.reason === 'completed' ? 'agent_end_call' : raw.reason === 'failed' ? 'provider_error' : 'unknown',
      }];
    },
    renderCommand(command: RuntimeCommand) {
      if (command.type === 'SpeakStart' || command.type === 'SpeakDelta') {
        return [{
          type: 'response.output_text.delta',
          response_id: command.responseId,
          text: command.text,
          final: command.isFinal,
        }];
      }
      if (command.type === 'SpeakEnd') {
        return [{
          type: 'response.output_text.done',
          response_id: command.responseId,
          final: true,
        }];
      }
      if (command.type === 'EndCall') return [{ type: 'response.cancel' }];
      if (command.type === 'UpdateRuntimeTuning') {
        return [{
          type: 'session.update',
          session: {
            audio: {
              input: { enabled: command.patch.audioInputEnabled },
              output: { enabled: command.patch.audioOutputEnabled },
            },
            turn_detection: {
              threshold: vadSensitivityToThreshold(command.patch.vadSensitivity),
              silence_duration_ms: command.patch.maxSilenceMs,
            },
          },
        }];
      }
      return [];
    },
  };
}
