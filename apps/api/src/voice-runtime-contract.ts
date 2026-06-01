import type { TrustedScope, UntrustedToolArgs } from './trusted-scope.js';

export type RuntimeProvider = 'retell' | 'openai_realtime' | 'web_chat' | 'unknown';
export type InteractionChannel = 'voice' | 'web' | 'internal_test';

export type CanonicalBase = {
  eventId: string;
  traceId: string;
  trustedScope: TrustedScope;
  provider: RuntimeProvider;
  channel: InteractionChannel;
  providerEventId?: string;
  providerCallId?: string;
  providerSessionId?: string;
  sequence?: number;
  turnId?: string;
  responseId?: string;
  occurredAt: string;
  receivedAt: string;
};

export type CanonicalCommandBase = {
  commandId: string;
  traceId: string;
  trustedScope: TrustedScope;
  provider: RuntimeProvider;
  channel: InteractionChannel;
  providerCallId?: string;
  providerSessionId?: string;
  sequence?: number;
};

export type RedactedConversationTurn = {
  role: 'user' | 'agent' | 'tool';
  text: string;
  occurredAt?: string;
};

export type RuntimeErrorSeverity = 'recoverable' | 'degraded' | 'fatal';

export type CallStartedEvent = CanonicalBase & {
  type: 'CallStarted';
  callerReference?: string;
};

export type UserSpeechPartialEvent = CanonicalBase & {
  type: 'UserSpeechPartial';
  text: string;
  confidence?: number;
};

export type UserSpeechFinalEvent = CanonicalBase & {
  type: 'UserSpeechFinal';
  text: string;
  confidence?: number;
  redactedRecentTurns?: RedactedConversationTurn[];
  compactStateSummary?: string;
};

export type AgentTurnRequestedEvent = CanonicalBase & {
  type: 'AgentTurnRequested';
  currentUserText?: string;
  redactedRecentTurns?: RedactedConversationTurn[];
  compactStateSummary?: string;
};

export type UserInterruptedEvent = CanonicalBase & {
  type: 'UserInterrupted';
  interruptedTurnId?: string;
  interruptedResponseId?: string;
  currentPartialText?: string;
};

export type ToolResultReceivedEvent = CanonicalBase & {
  type: 'ToolResultReceived';
  toolName: string;
  toolCallId: string;
  result: unknown;
  mayMutate: boolean;
};

export type CallEndedEvent = CanonicalBase & {
  type: 'CallEnded';
  reason: 'user_hangup' | 'agent_end_call' | 'transfer' | 'provider_error' | 'unknown';
};

export type RuntimeErrorEvent = CanonicalBase & {
  type: 'RuntimeError';
  severity: RuntimeErrorSeverity;
  reason: string;
  recoverable: boolean;
};

export type CanonicalRuntimeEvent =
  | CallStartedEvent
  | UserSpeechPartialEvent
  | UserSpeechFinalEvent
  | AgentTurnRequestedEvent
  | UserInterruptedEvent
  | ToolResultReceivedEvent
  | CallEndedEvent
  | RuntimeErrorEvent;

export type VoiceStyle = 'short' | 'confirmation' | 'handoff' | 'abstain' | 'tool_status';

export type SpeakStartCommand = CanonicalCommandBase & {
  type: 'SpeakStart';
  turnId: string;
  responseId: string;
  text: string;
  isFinal: boolean;
  interruptible: boolean;
  evidenceIds: string[];
  voiceStyle: VoiceStyle;
};

export type SpeakDeltaCommand = CanonicalCommandBase & {
  type: 'SpeakDelta';
  turnId: string;
  responseId: string;
  text: string;
  isFinal: boolean;
  interruptible: boolean;
  evidenceIds: string[];
  voiceStyle: VoiceStyle;
};

export type SpeakEndCommand = CanonicalCommandBase & {
  type: 'SpeakEnd';
  turnId: string;
  responseId: string;
  evidenceIds: string[];
};

export type WaitCommand = CanonicalCommandBase & {
  type: 'Wait';
  reason: 'listening' | 'tool_pending' | 'safe_acknowledgement' | 'handoff_pending';
  maxWaitMs?: number;
};

export type RequestToolExecutionCommand = CanonicalCommandBase & {
  type: 'RequestToolExecution';
  turnId: string;
  toolName: string;
  toolCallId: string;
  args: UntrustedToolArgs;
};

export type EndCallCommand = CanonicalCommandBase & {
  type: 'EndCall';
  reason: 'caller_request' | 'completed' | 'policy_required' | 'provider_error' | 'safety';
  traceableReason: string;
};

export type TransferCallCommand = CanonicalCommandBase & {
  type: 'TransferCall';
  targetId: string;
  reason: 'caller_request' | 'policy_required' | 'human_needed' | 'tool_unavailable';
  traceableReason: string;
};

export type LogShadowEvidenceCommand = CanonicalCommandBase & {
  type: 'LogShadowEvidence';
  evidenceIds: string[];
  redactionPurpose: 'trace' | 'eval' | 'shadow';
};

export type RuntimeTuningPatch = {
  audioInputEnabled?: boolean;
  audioOutputEnabled?: boolean;
  responseInterruptible?: boolean;
  vadSensitivity?: 'low' | 'medium' | 'high';
  maxSilenceMs?: number;
};

export type UpdateRuntimeTuningCommand = CanonicalCommandBase & {
  type: 'UpdateRuntimeTuning';
  patch: RuntimeTuningPatch;
  reason: 'barge_in_recovery' | 'silence_handling' | 'handoff' | 'runtime_degradation';
};

export type RuntimeCommand =
  | SpeakStartCommand
  | SpeakDeltaCommand
  | SpeakEndCommand
  | WaitCommand
  | RequestToolExecutionCommand
  | EndCallCommand
  | TransferCallCommand
  | LogShadowEvidenceCommand
  | UpdateRuntimeTuningCommand;

export type ProviderAdapter<RawEvent, ProviderMessage> = {
  normalizeEvent(raw: RawEvent): CanonicalRuntimeEvent[];
  renderCommand(command: RuntimeCommand): ProviderMessage[];
};
