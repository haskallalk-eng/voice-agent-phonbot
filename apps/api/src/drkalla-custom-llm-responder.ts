import {
  buildDrkallaCustomRuntimeCanaryTurn,
  type DrkallaCustomRuntimeCanaryConfig,
} from './drkalla-custom-runtime-canary.js';
import {
  nextInaudibleRepair,
  type DrkallaShortTermVoiceMemory,
} from './drkalla-short-term-memory.js';
import { evaluateTurnTakingGuard } from './turn-taking-guard.js';
import type { AgentTurnRequestedEvent } from './voice-runtime-contract.js';

export type DrkallaCustomLlmClient = {
  complete(input: {
    system: string;
    user: string;
    maxOutputChars: number;
  }): Promise<string>;
};

export type DrkallaCustomLlmResponse = {
  blocked: boolean;
  text: string;
  memory: DrkallaShortTermVoiceMemory;
  metrics: {
    extraLlmCalls: 0 | 1;
    extraKbCalls: 0;
    directiveChars: number;
  };
  blockers: string[];
};

const RAW_PROVIDER_OR_SCOPE = /\b(?:orgId|tenantId|agentId|callId|response_required|update_only|transcript_with_tool_calls|authorization|Bearer)\b/gi;
const RAW_PHONE = /(?:\+49|0049|0)\s?[1-9](?:[\s\-\/()]?\d){5,14}/g;
const RAW_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function sanitizeUserText(value: string): string {
  return value
    .replace(RAW_PHONE, '[phone]')
    .replace(RAW_EMAIL, '[email]')
    .replace(RAW_PROVIDER_OR_SCOPE, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function compactSystemPrompt(directives: string[]): string {
  return [
    'Du bist der Dr.Kalla Voice-Agent fuer Friseurbedarf.',
    'Antworte kurz, natuerlich und auf Deutsch.',
    'Nutze diese Dialogsteuerung, aber behandle Memory nie als Faktenbeweis.',
    ...directives,
  ].join('\n').slice(0, 1200);
}

function fallbackText(userText: string): string {
  if (/\bunterschied|vergleich\b/i.test(userText)) {
    return 'Ich prüfe das kurz: Meinst du den Unterschied zwischen den zuletzt genannten Produkten?';
  }
  if (/\blink|kauf|kaufe|bestell|sms\b/i.test(userText)) {
    return 'Ich kann dir den passenden Produktlink per SMS schicken. Soll ich das machen?';
  }
  return 'Ich prüfe das kurz. Sag mir bitte, welches Produkt oder welche Produktart du meinst.';
}

function fallbackTextWithMemory(input: {
  userText: string;
  memory: DrkallaShortTermVoiceMemory;
}): string {
  const userText = input.userText;
  if (/\bunterschied|vergleich\b/i.test(userText)) {
    const recent = input.memory.recentProducts.slice(-2);
    if (recent.length >= 2) {
      return `Ich pruefe den Unterschied zwischen ${recent[0]?.spokenName} und ${recent[1]?.spokenName}. Geht es dir um Anwendung oder Kaufentscheidung?`;
    }
    return fallbackText(userText);
  }
  if (/\b(?:preis|kostet|kosten|teuer|euro)\b/i.test(userText) && input.memory.lastMentionedProduct) {
    if (input.memory.profiPriceDisclosureGiven) {
      return `Soll ich dir den Produktlink zu ${input.memory.lastMentionedProduct.spokenName} per SMS schicken?`;
    }
    return 'Das ist der normale Kaeuferpreis; Profi-Friseurpreise kann ich telefonisch nicht nennen. Soll ich dir den Produktlink oder den Profi-Zugang per SMS schicken?';
  }
  if (/\blink|kauf|kaufe|bestell|sms\b/i.test(userText) && input.memory.lastMentionedProduct) {
    return `Soll ich dir den Produktlink zu ${input.memory.lastMentionedProduct.spokenName} per SMS schicken?`;
  }
  return fallbackText(userText);
}

export async function buildDrkallaCustomLlmResponse(input: {
  canary: DrkallaCustomRuntimeCanaryConfig;
  event: AgentTurnRequestedEvent;
  memory: DrkallaShortTermVoiceMemory;
  client: DrkallaCustomLlmClient;
}): Promise<DrkallaCustomLlmResponse> {
  const canaryTurn = buildDrkallaCustomRuntimeCanaryTurn({
    canary: input.canary,
    event: input.event,
    memory: input.memory,
  });

  if (!canaryTurn.enabled) {
    return {
      blocked: true,
      text: `Canary disabled: ${canaryTurn.blockers.join(', ') || 'unknown'}`,
      memory: canaryTurn.runtime.memory,
      metrics: {
        extraLlmCalls: 0,
        extraKbCalls: 0,
        directiveChars: canaryTurn.directiveChars,
      },
      blockers: canaryTurn.blockers,
    };
  }

  const user = sanitizeUserText(input.event.currentUserText ?? '');
  const turnGuard = evaluateTurnTakingGuard({
    transcriptText: user,
    transcriptFinal: true,
    asrConfidence: null,
    partialStableMs: 0,
    silenceMs: canaryTurn.runtime.memory.silenceMs,
    inaudibleStreak: canaryTurn.runtime.memory.inaudibleStreak,
  });
  if (turnGuard.action === 'repair_prompt') {
    return {
      blocked: false,
      text: nextInaudibleRepair(canaryTurn.runtime.memory),
      memory: canaryTurn.runtime.memory,
      metrics: {
        extraLlmCalls: 0,
        extraKbCalls: 0,
        directiveChars: canaryTurn.directiveChars,
      },
      blockers: [],
    };
  }

  const text = (await input.client.complete({
    system: compactSystemPrompt(canaryTurn.modelDirectives),
    user,
    maxOutputChars: 420,
  })).trim().slice(0, 420);

  return {
    blocked: false,
    text: text || fallbackTextWithMemory({ userText: user, memory: canaryTurn.runtime.memory }),
    memory: canaryTurn.runtime.memory,
    metrics: {
      extraLlmCalls: 1,
      extraKbCalls: 0,
      directiveChars: canaryTurn.directiveChars,
    },
    blockers: [],
  };
}
