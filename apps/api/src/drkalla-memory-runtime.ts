import {
  buildDrkallaMemoryContext,
  createDrkallaShortTermMemory,
  isDrkallaMemorySafeForModel,
  reduceDrkallaShortTermMemory,
  type DrkallaRuntimeMode,
  type DrkallaShortTermVoiceMemory,
} from './drkalla-short-term-memory.js';
import {
  buildDrkallaDialogueResponsePlan,
  buildDrkallaDialogueView,
  type DrkallaDialogueResponsePlan,
  type DrkallaDialogueView,
} from './drkalla-dialogue-view.js';
import type { CanonicalRuntimeEvent } from './voice-runtime-contract.js';

export type DrkallaMemoryRuntimeSession = {
  mode: DrkallaRuntimeMode;
  memory: DrkallaShortTermVoiceMemory;
};

export type DrkallaMemoryRuntimeResult = DrkallaMemoryRuntimeSession & {
  memoryContext: string | null;
  memoryContextInjected: boolean;
  dialogueView: DrkallaDialogueView;
  responsePlan: DrkallaDialogueResponsePlan;
  extraLlmCalls: 0;
  extraKbCalls: 0;
};

export function createDrkallaMemoryRuntimeSession(input: {
  mode: DrkallaRuntimeMode;
  memory?: DrkallaShortTermVoiceMemory;
}): DrkallaMemoryRuntimeSession {
  return {
    mode: input.mode,
    memory: input.memory ?? createDrkallaShortTermMemory(),
  };
}

function audioStateFromText(text: string): 'heard' | 'inaudible' {
  return /\(inaudible speech\)|unverständlich|unverstaendlich/i.test(text)
    ? 'inaudible'
    : 'heard';
}

function reduceRuntimeSpeech(
  memory: DrkallaShortTermVoiceMemory,
  event: Extract<CanonicalRuntimeEvent, { type: 'AgentTurnRequested' | 'UserSpeechFinal' | 'UserSpeechPartial' }>,
): DrkallaShortTermVoiceMemory {
  const text = event.type === 'AgentTurnRequested'
    ? event.currentUserText ?? ''
    : event.text;
  if (!text.trim()) return memory;
  return reduceDrkallaShortTermMemory(memory, {
    type: 'user_audio',
    turnIndex: event.sequence ?? 0,
    text,
    audioState: audioStateFromText(text),
  });
}

export function applyDrkallaMemoryRuntimeEvent(
  session: DrkallaMemoryRuntimeSession,
  event: CanonicalRuntimeEvent,
): DrkallaMemoryRuntimeResult {
  let memory = session.memory;
  if (
    event.type === 'AgentTurnRequested'
    || event.type === 'UserSpeechFinal'
    || event.type === 'UserSpeechPartial'
  ) {
    memory = reduceRuntimeSpeech(memory, event);
  }

  const canInject = session.mode === 'custom_runtime' && isDrkallaMemorySafeForModel(memory);
  const currentUserText = event.type === 'AgentTurnRequested'
    ? event.currentUserText ?? ''
    : event.type === 'UserSpeechFinal' || event.type === 'UserSpeechPartial'
      ? event.text
      : '';
  const dialogueView = buildDrkallaDialogueView(memory, currentUserText);
  return {
    mode: session.mode,
    memory,
    memoryContext: canInject ? buildDrkallaMemoryContext(memory) : null,
    memoryContextInjected: canInject,
    dialogueView,
    responsePlan: buildDrkallaDialogueResponsePlan(dialogueView),
    extraLlmCalls: 0,
    extraKbCalls: 0,
  };
}
