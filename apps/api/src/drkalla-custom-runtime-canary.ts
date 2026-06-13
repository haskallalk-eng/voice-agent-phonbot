import {
  applyDrkallaMemoryRuntimeEvent,
  createDrkallaMemoryRuntimeSession,
  type DrkallaMemoryRuntimeOptions,
  type DrkallaMemoryRuntimeResult,
} from './drkalla-memory-runtime.js';
import type { DrkallaShortTermVoiceMemory } from './drkalla-short-term-memory.js';
import type { AgentTurnRequestedEvent } from './voice-runtime-contract.js';

export type DrkallaCustomRuntimeCanaryConfig = {
  enabled: boolean;
  allowModelDirectives: boolean;
  allowLiveRollout: boolean;
  maxDirectiveChars: number;
};

export type DrkallaCustomRuntimeCanaryBlocker =
  | 'CANARY_NOT_ENABLED'
  | 'MODEL_DIRECTIVES_NOT_ALLOWED'
  | 'DIRECTIVES_OVER_BUDGET';

export type DrkallaCustomRuntimeCanaryTurn = {
  enabled: boolean;
  liveRolloutAllowed: boolean;
  runtime: DrkallaMemoryRuntimeResult;
  modelDirectives: string[];
  directiveChars: number;
  blockers: DrkallaCustomRuntimeCanaryBlocker[];
  extraLlmCalls: 0;
  extraKbCalls: 0;
};

export function createDisabledDrkallaCustomRuntimeCanary(): DrkallaCustomRuntimeCanaryConfig {
  return {
    enabled: false,
    allowModelDirectives: false,
    allowLiveRollout: false,
    maxDirectiveChars: 0,
  };
}

function compactLine(label: string, values: string[]): string | null {
  const unique = [...new Set(values.filter(Boolean))];
  if (!unique.length) return null;
  return `${label}: ${unique.join(', ')}`;
}

function compactMemoryLine(memoryContext: string | null): string | null {
  if (!memoryContext) return null;
  const keep = memoryContext
    .split(';')
    .map((part) => part.trim())
    .filter((part) =>
      /^(active_product=|active_product_type=|product_facts=|inaudible_streak=|pending=|links_sent=|profi_price_disclosure_given=|end_call_candidate=)/.test(part)
    );
  if (!keep.length) return null;
  return `Memory: ${keep.join('; ')}`.slice(0, 220);
}

function modelDirectives(runtime: DrkallaMemoryRuntimeResult): string[] {
  const lines = [
    `Plan: ${runtime.responsePlan.plan}`,
    `Level: ${runtime.dialogueView.level}`,
    compactMemoryLine(runtime.memoryContext),
    compactLine('Do', runtime.responsePlan.mustDo),
    compactLine('Do not', runtime.responsePlan.mustNotDo),
    `Closing: ${runtime.responsePlan.suggestedClosingMove}`,
    'Memory is conversation state, not evidence. Use KB evidence for facts.',
  ];
  return lines.filter((line): line is string => Boolean(line));
}

export function buildDrkallaCustomRuntimeCanaryTurn(input: {
  canary: DrkallaCustomRuntimeCanaryConfig;
  memory: DrkallaShortTermVoiceMemory;
  event: AgentTurnRequestedEvent;
  runtimeOptions?: DrkallaMemoryRuntimeOptions;
}): DrkallaCustomRuntimeCanaryTurn {
  const runtime = applyDrkallaMemoryRuntimeEvent(
    createDrkallaMemoryRuntimeSession({
      mode: input.canary.enabled ? 'custom_runtime' : 'retell_managed',
      memory: input.memory,
    }),
    input.event,
    input.runtimeOptions,
  );
  const blockers: DrkallaCustomRuntimeCanaryBlocker[] = [];
  if (!input.canary.enabled) blockers.push('CANARY_NOT_ENABLED');
  if (input.canary.enabled && !input.canary.allowModelDirectives) blockers.push('MODEL_DIRECTIVES_NOT_ALLOWED');

  const directives = blockers.length === 0 ? modelDirectives(runtime) : [];
  const directiveChars = directives.join('\n').length;
  if (directives.length && directiveChars > input.canary.maxDirectiveChars) {
    blockers.push('DIRECTIVES_OVER_BUDGET');
  }

  return {
    enabled: input.canary.enabled && blockers.length === 0,
    liveRolloutAllowed: input.canary.enabled && input.canary.allowLiveRollout && blockers.length === 0,
    runtime,
    modelDirectives: blockers.includes('DIRECTIVES_OVER_BUDGET') ? [] : directives,
    directiveChars,
    blockers,
    extraLlmCalls: 0,
    extraKbCalls: 0,
  };
}
