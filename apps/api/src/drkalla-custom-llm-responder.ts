import {
  buildDrkallaCustomRuntimeCanaryTurn,
  type DrkallaCustomRuntimeCanaryConfig,
} from './drkalla-custom-runtime-canary.js';
import {
  buildDrkallaContactAnswer,
  DRKALLA_CONTACT_FACTS,
  detectDrkallaContactIntent,
} from './drkalla-contact-facts.js';
import type { DrkallaProductEvidenceLookup } from './drkalla-product-evidence.js';
import { detectDrkallaDuForm } from './drkalla-formality-detector.js';
import { redactForPrompt } from './pii.js';
import {
  deriveDrkallaAgentSpokeEvent,
  type DrkallaAmbiguousProductNameDetector,
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
    /**
     * Optional barge-in signal. When it aborts (a newer caller turn arrived),
     * the model call should stop early so the serialized turn chain advances
     * immediately instead of waiting out the stale turn's budget.
     */
    signal?: AbortSignal;
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
    signal?: AbortSignal;
  }): Promise<string>;
};

// Spoken when the caller confirms an SMS link offer while no real SMS tool
// is wired into the custom runtime. The agent must never claim a link was
// sent before a successful tool execution.
export const DRKALLA_SMS_NOT_WIRED_TEXT =
  'Der SMS-Versand ist in diesem Testanruf noch nicht freigeschaltet. Sie finden das Produkt direkt auf drkalla punkt com. Kann ich sonst noch etwas klären?';

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
  /**
   * Non-blocking quality signal for observability. Only set on the model/
   * fallback path (deterministic paths are hardcoded Sie). Never alters text.
   */
  quality?: {
    duFormDetected: boolean;
    duFormConfidence: 'high' | 'medium' | 'none';
    duFormSlips: string[];
  };
};

const RAW_PROVIDER_OR_SCOPE = /\b(?:orgId|tenantId|agentId|callId|response_required|update_only|transcript_with_tool_calls|authorization|Bearer)\b/gi;

function sanitizeUserText(value: string): string {
  // Use the central purpose-specific redactor (Milestone 1C) so caller PII —
  // phone, email, address, IBAN, card, DOB — is stripped before the utterance
  // reaches the model, then strip provider/scope tokens specific to this path.
  return redactForPrompt(value)
    .replace(RAW_PROVIDER_OR_SCOPE, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function compactSystemPrompt(directives: string[]): string {
  return [
    'Du bist der Dr.Kalla Voice-Agent fuer Friseurbedarf.',
    // Register is the #1 live complaint: gpt-4.1-mini mirrors the caller and
    // slips into du. State the rule first, as a hard prohibition with the
    // exact forbidden words, so it actually sticks.
    'ANREDE (zwingend): Sprich den Anrufer ausschliesslich in der Sie-Form an — Sie, Ihnen, Ihr, Ihre. Verwende NIEMALS du, dich, dir, dein, deine, ihr (als Anrede), euch oder euer, auch wenn der Anrufer dich duzt.',
    'STIL: Antworte auf Deutsch in vollstaendigen, natuerlichen Saetzen. Niemals Stichpunkte, Aufzaehlungen, Doppelpunkt-Listen oder Telegrammstil. Fasse dich kurz, aber sprich in ganzen Saetzen.',
    'Buchstabiere Web-Adressen oder E-Mails nicht einzeln; nenne den Shop einfach als drkalla.com.',
    'Dr.Kalla ist ein Friseurbedarf-Shop, kein Friseursalon: keine Termine, keine Haarschnitte oder Faerbe-Dienstleistungen; verweise hoeflich auf Produkte/Salonbedarf.',
    'Nenne Adresse, Oeffnungszeiten, E-Mail, Preise oder Verfuegbarkeit nur aus der gegebenen Evidence- oder Kontakt-Fakt-Zeile. Fehlt die Angabe, erfinde nichts und verweise auf drkalla.com oder den Kontakt.',
    'Erklaere die Profi-Preise hoechstens einmal ausfuehrlich; wurde der Profi-Zugang schon erwaehnt, fasse dich knapp und biete nur kurz den Link an, ohne die Erklaerung zu wiederholen.',
    'Nutze diese Dialogsteuerung, aber behandle Memory nie als Faktenbeweis.',
    'Behaupte nie, eine SMS oder einen Link bereits gesendet zu haben; frage nie nach der Telefonnummer (eine SMS geht automatisch an die Anrufernummer).',
    'Bei klarer Verabschiedung verabschiede dich kurz und haenge keine neue Frage an.',
    ...directives,
  ].join('\n').slice(0, 2000);
}

// Match the model's paraphrases of the SMS offer too (schicken/senden/
// zusenden/...), not just the canonical "schicken", so a caller's "ja" is
// caught by the deterministic confirm path instead of reaching the model
// (which otherwise invents steps like asking for the phone number).
const SMS_OFFER_QUESTION = /per sms\s+(?:schick|send|zusend|zukomm)/i;
// The two-option offer ("Produktlink ODER Profi-Zugang per SMS"): a bare "ja"
// here is ambiguous and must be re-asked, not silently sent as product link.
const TWO_OPTION_OFFER = /produktlink\s+oder\s+(?:den\s+link\s+(?:zum\s+)?)?profi/i;
const SHORT_AFFIRMATION = /^(?:ja|ja,?\s*(?:bitte|gerne?)|gerne?|okay?|ok|bitte|mach das|machen sie das|klar)[.! ]*$/i;
const PRODUCT_LINK_CHOICE = /\b(?:produktlink|den ersten|das erste|das produkt|zum produkt)\b/i;
const PROFI_LINK_CHOICE = /\b(?:profi[\s-]?(?:zugang|link)|den profi|zum profi|das zweite|den zweiten|der zweite|registrier)\b/i;

export type DrkallaSendLinkKind = 'product' | 'profi';
export type DrkallaSendLinkExecutor = (input: {
  url: string;
  label: string;
  linkKind: DrkallaSendLinkKind;
}) => Promise<{ smsSent: boolean; duplicate?: boolean }>;

function fallbackText(userText: string): string {
  if (/\bunterschied|vergleich\b/i.test(userText)) {
    return 'Ich prüfe das kurz: Meinen Sie den Unterschied zwischen den zuletzt genannten Produkten?';
  }
  if (/\blink|kauf|kaufe|bestell|sms\b/i.test(userText)) {
    return 'Ich kann Ihnen den passenden Produktlink per SMS schicken. Soll ich das machen?';
  }
  return 'Ich prüfe das kurz. Sagen Sie mir bitte, welches Produkt oder welche Produktart Sie meinen.';
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
  // Grounded contact answer takes precedence: never let the fallback dodge a
  // contact question with a generic discovery prompt, and never invent.
  const contactIntent = detectDrkallaContactIntent(userText);
  if (contactIntent) {
    const contactAnswer = buildDrkallaContactAnswer(contactIntent);
    if (contactAnswer) return { text: contactAnswer };
  }
  if (/\bunterschied|vergleich\b/i.test(userText)) {
    const recent = input.memory.recentProducts.slice(-2);
    if (recent.length >= 2) {
      return {
        text: `Ich pruefe den Unterschied zwischen ${recent[0]?.spokenName} und ${recent[1]?.spokenName}. Geht es Ihnen um Anwendung oder Kaufentscheidung?`,
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
        text: `${priceSentence}Soll ich Ihnen den Produktlink zu ${lastProduct.spokenName} per SMS schicken?`,
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
      text: `Soll ich Ihnen den Produktlink zu ${lastProduct.spokenName} per SMS schicken?`,
      product: lastProduct,
    };
  }
  if (input.memory.activeProductType) {
    return {
      text: `Bei ${input.memory.activeProductType.label} kann ich Ihnen eine kurze Auswahl nach Marken, Varianten oder Nuancen nennen. Soll ich mit Marken anfangen?`,
    };
  }
  return { text: fallbackText(userText) };
}

// A clear, simple price question (not a comparison, not a contact question).
const DRKALLA_PRICE_INTENT = /\b(?:was\s+kostet|wie\s*viel|wie\s*teuer|preis|preise|kostet|kosten|teuer)\b/i;

/**
 * Deterministic, grounded price answer in full Sie sentences. The model
 * (gpt-4.1-mini) paraphrases prices/Profi into du-form fragments and repeats
 * the Profi disclosure across turns (observed live 2026-06-13), so when the
 * caller plainly asks the price of the resolved active product and the catalog
 * snapshot has a price, answer deterministically instead of via the model. The
 * once-only Profi disclosure is honoured via memory. Returns null when this is
 * not a clean single-product price question (then the model handles it).
 */
function tryDeterministicPriceAnswer(input: {
  userText: string;
  memory: DrkallaShortTermVoiceMemory;
  evidenceLookup?: DrkallaProductEvidenceLookup;
}): DrkallaFallbackResult | null {
  const text = input.userText;
  if (!DRKALLA_PRICE_INTENT.test(text)) return null;
  if (/\b(?:unterschied|vergleich|verglichen)\b/i.test(text)) return null; // comparison -> model
  if (detectDrkallaContactIntent(text)) return null; // contact/profi -> handled elsewhere
  const lastProduct = input.memory.lastMentionedProduct;
  if (!lastProduct) return null;
  const evidence = input.evidenceLookup?.byKeyHash(lastProduct.productKeyHash) ?? null;
  if (!evidence?.priceText) return null;
  const priceSentence = `${lastProduct.spokenName} kostet laut Shop-Datenstand ${evidence.priceText}. `;
  if (input.memory.profiPriceDisclosureGiven && !/\bprofi/i.test(text)) {
    return {
      text: `${priceSentence}Soll ich Ihnen den Produktlink zu ${lastProduct.spokenName} per SMS schicken?`,
      product: lastProduct,
    };
  }
  return {
    text: `${priceSentence}${DRKALLA_PROFI_PRICE_DISCLOSURE} ${DRKALLA_PROFI_LINK_QUESTION}`,
    product: lastProduct,
  };
}

export async function buildDrkallaCustomLlmResponse(input: {
  canary: DrkallaCustomRuntimeCanaryConfig;
  event: AgentTurnRequestedEvent;
  memory: DrkallaShortTermVoiceMemory;
  client: DrkallaCustomLlmClient;
  detectProducts?: DrkallaProductNameDetector;
  detectAmbiguousProduct?: DrkallaAmbiguousProductNameDetector;
  evidenceLookup?: DrkallaProductEvidenceLookup;
  executeSendLink?: DrkallaSendLinkExecutor;
  onDelta?: (chunk: string) => void;
  signal?: AbortSignal;
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

  // A confirmed SMS-link offer must never reach the model: with the gated
  // executor wired the server sends the real SMS through the policied
  // send_link tool; without it the agent answers truthfully. Either way the
  // model can never claim a send that did not happen.
  const lastQ = canaryTurn.runtime.memory.lastAgentQuestion ?? '';
  if (SMS_OFFER_QUESTION.test(lastQ)) {
    const twoOption = TWO_OPTION_OFFER.test(lastQ);
    const wantsProfi = PROFI_LINK_CHOICE.test(user);
    const wantsProduct = PRODUCT_LINK_CHOICE.test(user);
    const bareYes = SHORT_AFFIRMATION.test(user);

    if (twoOption && bareYes && !wantsProfi && !wantsProduct) {
      // Ambiguous yes to a two-option offer: ask which link, never guess.
      const clarify = 'Gern. Möchten Sie den Produktlink oder den Link zum Profi-Zugang?';
      return {
        blocked: false,
        text: clarify,
        memory: reduceDrkallaShortTermMemory(
          canaryTurn.runtime.memory,
          deriveDrkallaAgentSpokeEvent({ text: clarify, turnIndex }),
        ),
        metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
        blockers: [],
      };
    }

    if (wantsProfi || wantsProduct || bareYes) {
      const activeProduct = canaryTurn.runtime.memory.lastMentionedProduct;
      const evidence = activeProduct
        ? input.evidenceLookup?.byKeyHash(activeProduct.productKeyHash) ?? null
        : null;
      // Choice resolution: explicit Profi wins; else explicit product; else a
      // bare yes on a single-option offer follows that offer (product).
      const kind: DrkallaSendLinkKind = wantsProfi ? 'profi' : 'product';
      const target = kind === 'profi'
        ? { url: DRKALLA_CONTACT_FACTS.profiUrl, label: 'Profi-Zugang' }
        : activeProduct && evidence?.url
          ? { url: evidence.url, label: activeProduct.spokenName }
          : null;

      let text = DRKALLA_SMS_NOT_WIRED_TEXT;
      let linkSentUrl: string | null = null;
      if (input.executeSendLink && target) {
        const outcome = await input.executeSendLink({ url: target.url, label: target.label, linkKind: kind })
          .catch(() => ({ smsSent: false as const }));
        if (outcome.smsSent) {
          text = kind === 'profi'
            ? 'Erledigt, ich habe Ihnen den Link zum Profi-Zugang per SMS geschickt. Kann ich sonst noch etwas klären?'
            : `Erledigt, ich habe Ihnen den Produktlink zu ${target.label} per SMS geschickt. Kann ich sonst noch etwas klären?`;
          linkSentUrl = target.url;
        } else if ('duplicate' in outcome && outcome.duplicate) {
          text = `Den Link habe ich Ihnen in diesem Anruf schon geschickt. Kann ich sonst noch etwas klären?`;
        } else {
          text = kind === 'profi'
            ? 'Das hat gerade leider nicht geklappt, die SMS ging nicht raus. Den Profi-Zugang finden Sie auf drkalla punkt com.'
            : `Das hat gerade leider nicht geklappt, die SMS ging nicht raus. Sie finden ${target.label} auf drkalla punkt com.`;
        }
      }
      const agentEvent = deriveDrkallaAgentSpokeEvent({ text, turnIndex });
      return {
        blocked: false,
        text,
        memory: reduceDrkallaShortTermMemory(canaryTurn.runtime.memory, {
          ...agentEvent,
          linksSent: linkSentUrl && target ? [{ url: linkSentUrl, label: target.label }] : undefined,
        }),
        metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
        blockers: [],
      };
    }
  }

  // A product name shared by several catalog products cannot resolve to one
  // product; ask a targeted variant question instead of guessing or
  // resetting to generic discovery.
  const ambiguous = input.detectAmbiguousProduct?.(user) ?? null;
  if (ambiguous && (input.detectProducts?.(user) ?? []).length === 0) {
    const clarifyText = `Von ${ambiguous.label} gibt es bei uns mehrere Ausführungen. Welche Größe oder Ausführung meinen Sie?`;
    const withPending = reduceDrkallaShortTermMemory(canaryTurn.runtime.memory, {
      type: 'pending_clarification',
      turnIndex,
      kind: 'product_variant',
      prompt: `Welche Ausführung von ${ambiguous.label} meinen Sie?`,
    });
    return {
      blocked: false,
      text: clarifyText,
      memory: reduceDrkallaShortTermMemory(
        withPending,
        deriveDrkallaAgentSpokeEvent({ text: clarifyText, turnIndex }),
      ),
      metrics: {
        extraLlmCalls: 0,
        extraKbCalls: 0,
        directiveChars: canaryTurn.directiveChars,
      },
      blockers: [],
    };
  }

  // Deterministic, grounded price answer for the sales-critical path (full Sie
  // sentences, once-only Profi disclosure) — bypasses the model, which mangles
  // register/style/repetition here.
  const deterministicPrice = tryDeterministicPriceAnswer({
    userText: user,
    memory: canaryTurn.runtime.memory,
    evidenceLookup: input.evidenceLookup,
  });
  if (deterministicPrice) {
    return {
      blocked: false,
      text: deterministicPrice.text,
      memory: reduceDrkallaShortTermMemory(
        canaryTurn.runtime.memory,
        deriveDrkallaAgentSpokeEvent({
          text: deterministicPrice.text,
          turnIndex,
          detectProducts: input.detectProducts,
          fallbackProduct: deterministicPrice.product,
        }),
      ),
      metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
      blockers: [],
      quality: { duFormDetected: false, duFormConfidence: 'none', duFormSlips: [] },
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
    const raw = await input.client.completeStream({ system, user, maxOutputChars, onDelta, signal: input.signal });
    modelText = raw.trim() ? raw.slice(0, maxOutputChars) : '';
  } else {
    modelText = (await input.client.complete({ system, user, maxOutputChars, signal: input.signal }))
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

  // Non-blocking Sie-consistency check on the only path that can slip into du
  // (model-generated, or memory-driven fallback text). Logged upstream; never
  // rewrites the answer.
  const formality = detectDrkallaDuForm(spokenText);

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
    quality: {
      duFormDetected: formality.hasDuForm,
      duFormConfidence: formality.confidence,
      duFormSlips: formality.slips,
    },
  };
}
