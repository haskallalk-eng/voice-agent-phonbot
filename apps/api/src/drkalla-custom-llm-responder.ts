import {
  buildDrkallaCustomRuntimeCanaryTurn,
  type DrkallaCustomRuntimeCanaryConfig,
} from './drkalla-custom-runtime-canary.js';
import type { DrkallaProductEvidenceLookup } from './drkalla-product-evidence.js';
import {
  deriveDrkallaAgentSpokeEvent,
  type DrkallaProductNameDetector,
} from './drkalla-product-name-detector.js';
import {
  nextInaudibleRepair,
  reduceDrkallaShortTermMemory,
  type DrkallaShortTermVoiceMemory,
} from './drkalla-short-term-memory.js';
import { evaluateTurnTakingGuard } from './turn-taking-guard.js';
import type { AgentTurnRequestedEvent } from './voice-runtime-contract.js';

// Canonical first-price wording (project spec): said once per call for
// non-perfume prices, then never repeated unless the caller explicitly asks
// about Profi prices again.
export const DRKALLA_PROFI_PRICE_DISCLOSURE =
  'Das sind die Preise für normale Käufer. Spezielle Profi-Friseurpreise kann ich telefonisch nicht nennen; dafür können Sie sich über den Profi-Zugang registrieren.';
export const DRKALLA_PROFI_LINK_QUESTION =
  'Soll ich Ihnen den Produktlink oder den Link zum Profi-Zugang per SMS schicken?';

export type DrkallaCustomLlmClient = {
  complete(input: {
    system: string;
    user: string;
    maxOutputChars: number;
  }): Promise<string>;
  /**
   * Optional streaming completion. Must call onDelta for each text chunk and
   * resolve with the full accumulated text. The responder enforces the
   * output cap across the stream.
   */
  completeStream?(input: {
    system: string;
    user: string;
    maxOutputChars: number;
    onDelta: (chunk: string) => void;
  }): Promise<string>;
};

// Spoken when the caller confirms an SMS link offer while no real SMS tool
// is wired into the custom runtime. The agent must never claim a link was
// sent before a successful tool execution.
export const DRKALLA_SMS_NOT_WIRED_TEXT =
  'Der SMS-Versand ist in diesem Testanruf noch nicht freigeschaltet. Du findest das Produkt direkt auf drkalla punkt com. Kann ich sonst noch etwas klären?';

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
    'Behaupte nie, eine SMS oder einen Link bereits gesendet zu haben.',
    ...directives,
  ].join('\n').slice(0, 1400);
}

const SMS_OFFER_QUESTION = /per sms schicken\?/i;
const SHORT_AFFIRMATION = /^(?:ja|ja,?\s*(?:bitte|gerne?)|gerne?|okay?|ok|bitte|mach das|machen sie das|klar)[.! ]*$/i;

function fallbackText(userText: string): string {
  if (/\bunterschied|vergleich\b/i.test(userText)) {
    return 'Ich prüfe das kurz: Meinst du den Unterschied zwischen den zuletzt genannten Produkten?';
  }
  if (/\blink|kauf|kaufe|bestell|sms\b/i.test(userText)) {
    return 'Ich kann dir den passenden Produktlink per SMS schicken. Soll ich das machen?';
  }
  return 'Ich prüfe das kurz. Sag mir bitte, welches Produkt oder welche Produktart du meinst.';
}

type DrkallaFallbackResult = {
  text: string;
  product?: { spokenName: string; productId?: string; productKind?: string | null };
};

function fallbackTextWithMemory(input: {
  userText: string;
  memory: DrkallaShortTermVoiceMemory;
  evidenceLookup?: DrkallaProductEvidenceLookup;
}): DrkallaFallbackResult {
  const userText = input.userText;
  const lastProduct = input.memory.lastMentionedProduct;
  if (/\bunterschied|vergleich\b/i.test(userText)) {
    const recent = input.memory.recentProducts.slice(-2);
    if (recent.length >= 2) {
      return {
        text: `Ich pruefe den Unterschied zwischen ${recent[0]?.spokenName} und ${recent[1]?.spokenName}. Geht es dir um Anwendung oder Kaufentscheidung?`,
      };
    }
    return { text: fallbackText(userText) };
  }
  if (/\b(?:preis|kostet|kosten|teuer|euro)\b/i.test(userText) && lastProduct) {
    // Catalog evidence lets the fallback answer the actual price truthfully
    // instead of dodging to a link offer (price facts come from the catalog
    // snapshot, never from memory).
    const evidence = input.evidenceLookup?.byKeyHash(lastProduct.productKeyHash) ?? null;
    const priceSentence = evidence?.priceText
      ? `${lastProduct.spokenName} kostet laut Shop-Datenstand ${evidence.priceText}. `
      : '';
    if (input.memory.profiPriceDisclosureGiven && !/\bprofi/i.test(userText)) {
      return {
        text: `${priceSentence}Soll ich dir den Produktlink zu ${lastProduct.spokenName} per SMS schicken?`,
        product: lastProduct,
      };
    }
    return {
      text: `${priceSentence}${DRKALLA_PROFI_PRICE_DISCLOSURE} ${DRKALLA_PROFI_LINK_QUESTION}`,
      product: lastProduct,
    };
  }
  if (/\blink|kauf|kaufe|bestell|sms\b/i.test(userText) && lastProduct) {
    return {
      text: `Soll ich dir den Produktlink zu ${lastProduct.spokenName} per SMS schicken?`,
      product: lastProduct,
    };
  }
  if (input.memory.activeProductType) {
    return {
      text: `Bei ${input.memory.activeProductType.label} kann ich dir eine kurze Auswahl nach Marken, Varianten oder Nuancen nennen. Soll ich mit Marken anfangen?`,
    };
  }
  return { text: fallbackText(userText) };
}

export async function buildDrkallaCustomLlmResponse(input: {
  canary: DrkallaCustomRuntimeCanaryConfig;
  event: AgentTurnRequestedEvent;
  memory: DrkallaShortTermVoiceMemory;
  client: DrkallaCustomLlmClient;
  detectProducts?: DrkallaProductNameDetector;
  evidenceLookup?: DrkallaProductEvidenceLookup;
  onDelta?: (chunk: string) => void;
}): Promise<DrkallaCustomLlmResponse> {
  const canaryTurn = buildDrkallaCustomRuntimeCanaryTurn({
    canary: input.canary,
    event: input.event,
    memory: input.memory,
    runtimeOptions: { detectProducts: input.detectProducts },
    evidenceLookup: input.evidenceLookup,
  });
  const turnIndex = input.event.sequence ?? 0;

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
    const repairText = nextInaudibleRepair(canaryTurn.runtime.memory);
    return {
      blocked: false,
      text: repairText,
      memory: reduceDrkallaShortTermMemory(
        canaryTurn.runtime.memory,
        deriveDrkallaAgentSpokeEvent({ text: repairText, turnIndex }),
      ),
      metrics: {
        extraLlmCalls: 0,
        extraKbCalls: 0,
        directiveChars: canaryTurn.directiveChars,
      },
      blockers: [],
    };
  }

  // A confirmed SMS-link offer must never reach the model while no real SMS
  // tool is wired: the model could claim a link was sent. Answer truthfully
  // and deterministically (also saves the model call).
  if (
    canaryTurn.runtime.memory.lastAgentQuestion
    && SMS_OFFER_QUESTION.test(canaryTurn.runtime.memory.lastAgentQuestion)
    && SHORT_AFFIRMATION.test(user)
  ) {
    return {
      blocked: false,
      text: DRKALLA_SMS_NOT_WIRED_TEXT,
      memory: reduceDrkallaShortTermMemory(
        canaryTurn.runtime.memory,
        deriveDrkallaAgentSpokeEvent({ text: DRKALLA_SMS_NOT_WIRED_TEXT, turnIndex }),
      ),
      metrics: {
        extraLlmCalls: 0,
        extraKbCalls: 0,
        directiveChars: canaryTurn.directiveChars,
      },
      blockers: [],
    };
  }

  const system = compactSystemPrompt(canaryTurn.modelDirectives);
  const maxOutputChars = 420;
  let modelText = '';
  if (input.client.completeStream && input.onDelta) {
    // Stream chunks upward so TTS can start on the first sentence; enforce
    // the output cap across the whole stream.
    let forwardedChars = 0;
    const onDelta = (chunk: string) => {
      if (!chunk || forwardedChars >= maxOutputChars) return;
      const allowed = chunk.slice(0, maxOutputChars - forwardedChars);
      forwardedChars += allowed.length;
      input.onDelta?.(allowed);
    };
    // No trim here: forwarded deltas must stay an exact prefix of the final
    // text so the transport can compute the remaining tail frame.
    const raw = await input.client.completeStream({ system, user, maxOutputChars, onDelta });
    modelText = raw.trim() ? raw.slice(0, maxOutputChars) : '';
  } else {
    modelText = (await input.client.complete({ system, user, maxOutputChars }))
      .trim()
      .slice(0, maxOutputChars);
  }

  const fallback = modelText
    ? null
    : fallbackTextWithMemory({
        userText: user,
        memory: canaryTurn.runtime.memory,
        evidenceLookup: input.evidenceLookup,
      });
  const spokenText = modelText || (fallback?.text ?? '');

  // Reduce what the agent is about to say back into short-term memory so the
  // funnel, per-product fact dedupe, and the once-only Profi disclosure work
  // across live turns. Pure text analysis: no extra LLM call, no KB call.
  const memoryAfterAgentTurn = reduceDrkallaShortTermMemory(
    canaryTurn.runtime.memory,
    deriveDrkallaAgentSpokeEvent({
      text: spokenText,
      turnIndex,
      detectProducts: input.detectProducts,
      fallbackProduct: fallback?.product,
    }),
  );

  return {
    blocked: false,
    text: spokenText,
    memory: memoryAfterAgentTurn,
    metrics: {
      extraLlmCalls: 1,
      extraKbCalls: 0,
      directiveChars: canaryTurn.directiveChars,
    },
    blockers: [],
  };
}
