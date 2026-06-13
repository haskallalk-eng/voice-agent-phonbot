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
import type { DrkallaProductCatalogSearch } from './drkalla-product-catalog-search.js';
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
  /** True when the agent should hard hang-up after speaking (clear farewell). */
  endCall?: boolean;
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
    'Wenn der Bedarf oder die Produktart bekannt ist, NENNE konkrete Produkte aus der Katalog-Treffer-Zeile oder grenze nach Marke/Variante ein. Stelle nicht wiederholt dieselbe Kategorie-Frage; wenn der Anrufer den Bedarf schon genannt hat, gehe weiter, statt erneut zu fragen.',
    'Nutze diese Dialogsteuerung, aber behandle Memory nie als Faktenbeweis.',
    'Behaupte nie, eine SMS oder einen Link bereits gesendet zu haben; frage nie nach der Telefonnummer (eine SMS geht automatisch an die Anrufernummer).',
    'Bei klarer Verabschiedung verabschiede dich kurz und haenge keine neue Frage an.',
    ...directives,
  ].join('\n').slice(0, 2600);
}

// Match ANY phrasing where the agent's last question offered to SEND a
// link/SMS — a send verb together with a link/SMS target, in either order —
// so a caller's "ja" is caught by the deterministic confirm path instead of
// reaching the model (which otherwise loops or invents asking for the number).
// Covers "per SMS schicken/senden/zusenden/schreiben", "den Produktlink
// senden", "schicke Ihnen den Link", "per Nachricht zusenden", etc.
const SMS_OFFER_QUESTION = /(?:produktlink|\blink\b|per\s+sms|per\s+nachricht|\bsms\b)[^.?!]*\b(?:schick|sende|senden|zusend|zuschick|zukomm|schreib|versend)|\b(?:schick|sende|senden|zusend|zuschick|zukomm|schreib|versend)\w*[^.?!]*(?:produktlink|\blink\b|\bsms\b|nachricht)/i;
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

// Explicit request to see the brand/product selection for the active type
// ("welche Marken habt ihr?", "zeig mir die Auswahl", "was habt ihr da?").
const DRKALLA_TYPE_LIST_REQUEST = /(?:marken|auswahl|welche habt|was habt|zeig|liste)/i;

/**
 * Deterministic, grounded brand/product list for the "Soll ich mit Marken
 * anfangen?" -> "Ja" funnel gap. The agent offers to list brands/products for
 * an active product type; on a bare "Ja" the open-ended catalog search runs on
 * "ja" and finds nothing, so the model loops on the same offer (live call).
 * When an active product type is known and the caller either bare-affirms or
 * explicitly asks for the selection, name up to three REAL catalog products
 * for that type in full Sie sentences. Returns null when this is not that
 * situation (then the normal model path handles it). Grounded: only real
 * catalog names are spoken, never invented.
 */
function tryDeterministicTypeListReply(input: {
  userText: string;
  memory: DrkallaShortTermVoiceMemory;
  catalogSearch?: DrkallaProductCatalogSearch;
}): string | null {
  const activeType = input.memory.activeProductType;
  if (!activeType) return null;
  const text = input.userText;
  const wantsList = SHORT_AFFIRMATION.test(text) || DRKALLA_TYPE_LIST_REQUEST.test(text);
  if (!wantsList) return null;
  const hits = (input.catalogSearch?.(activeType.label, 4) ?? []).slice(0, 3);
  if (!hits.length) return null;
  const names = hits.map((p, index) =>
    index === 0 && p.priceText ? `${p.spokenName} (${p.priceText})` : p.spokenName,
  );
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
  return `Bei ${activeType.label} haben wir zum Beispiel ${list}. Welches davon interessiert Sie?`;
}

// LATENCY fast-path matchers for low-content caller turns. Anchored to the
// START of the (sanitized) utterance so they only fire on a turn that is
// essentially nothing but the acknowledgement — never on a real question that
// happens to begin with "ok" or "danke".
// Pure thanks: "danke", "vielen Dank", "dankeschön", "merci".
const SMALLTALK_THANKS = /^(?:vielen\s+)?(?:danke|dankesch(?:ö|oe)n|merci)/i;
// Bare acknowledgement that fills the whole turn ("okay.", "alles klar", "passt").
const SMALLTALK_ACK = /^(?:ok(?:ay)?|alles klar|super|gut|verstanden|in ordnung|passt)[.! ]*$/i;
// Bare negation that fills the whole turn ("nein", "nö", "nee") — NOT a farewell.
const SMALLTALK_NEGATION = /^(?:nein|n(?:ö|oe)|nee)[.! ]*$/i;
// Any product/price/contact signal in the turn vetoes the smalltalk path so it
// can never swallow a real request ("danke, was kostet das?" -> model/price).
const SMALLTALK_VETO = /\?|\b(?:preis|preise|kostet|kosten|teuer|euro|kauf|kaufe|bestell|link|sms|produkt|marke|marken|auswahl|adresse|öffnungszeit|oeffnungszeit|email|e-mail|profi|unterschied|vergleich|verf[üu]gbar)\b/i;

/**
 * Deterministic Sie reply for very common low-content "smalltalk" caller turns
 * (pure thanks, a bare acknowledgement, a bare non-farewell "nein"). These make
 * up a large share of live turns and currently each costs a full model round
 * trip (~95% of turns hit the model). Answering them deterministically removes
 * that latency without ever inventing facts. Returns null whenever this is NOT
 * a pure smalltalk turn, so anything with real content falls through to the
 * normal model/price/funnel paths. Guards:
 *   - vetoed if the turn carries a product/price/contact/comparison signal or a
 *     question mark (so "danke, und der Preis?" is never swallowed);
 *   - a bare "nein" is skipped while a send-link offer is pending (the existing
 *     SMS-confirm logic must own that "nein"); farewells are handled earlier.
 */
function tryDeterministicSmalltalkReply(input: {
  userText: string;
  memory: DrkallaShortTermVoiceMemory;
}): string | null {
  const text = input.userText.trim();
  if (!text) return null;
  // Never let smalltalk swallow a turn that also asks for something concrete.
  if (SMALLTALK_VETO.test(text)) return null;
  if (detectDrkallaContactIntent(text)) return null;

  if (SMALLTALK_THANKS.test(text)) {
    return 'Sehr gern! Kann ich sonst noch etwas für Sie tun?';
  }
  if (SMALLTALK_ACK.test(text)) {
    return 'Gern. Womit kann ich Ihnen weiterhelfen?';
  }
  if (SMALLTALK_NEGATION.test(text)) {
    // A "nein" answering a pending SMS/link offer means "do not send" — leave it
    // to the existing confirm logic / model, do NOT treat it as smalltalk.
    if (SMS_OFFER_QUESTION.test(input.memory.lastAgentQuestion ?? '')) return null;
    return 'Alles klar. Kann ich Ihnen sonst noch weiterhelfen?';
  }
  return null;
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
  catalogSearch?: DrkallaProductCatalogSearch;
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

  // Clear caller farewell: say goodbye deterministically and hang up. No model,
  // no new question. (Memory set endCallEligible on the caller's farewell turn;
  // the agent_spoke reduction resets it, so we read it here before replying.)
  if (
    canaryTurn.runtime.memory.endCallEligible
    && canaryTurn.runtime.memory.endCallReason === 'caller_farewell'
  ) {
    const byeText = 'Vielen Dank für Ihren Anruf bei Dr.Kalla. Auf Wiederhören!';
    return {
      blocked: false,
      text: byeText,
      memory: reduceDrkallaShortTermMemory(
        canaryTurn.runtime.memory,
        deriveDrkallaAgentSpokeEvent({ text: byeText, turnIndex }),
      ),
      metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
      blockers: [],
      endCall: true,
    };
  }

  // LATENCY fast-path: pure thanks / bare ack / bare non-farewell "nein" get a
  // deterministic Sie reply with no model call. Placed AFTER the farewell and
  // SMS-confirm short-circuits (so it cannot swallow a goodbye or a pending
  // link answer) and BEFORE the ambiguous/price/funnel paths (its own veto
  // already rules out any turn that carries a product/price/contact signal).
  const smalltalkReply = tryDeterministicSmalltalkReply({
    userText: user,
    memory: canaryTurn.runtime.memory,
  });
  if (smalltalkReply) {
    return {
      blocked: false,
      text: smalltalkReply,
      memory: reduceDrkallaShortTermMemory(
        canaryTurn.runtime.memory,
        deriveDrkallaAgentSpokeEvent({ text: smalltalkReply, turnIndex }),
      ),
      metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
      blockers: [],
      quality: { duFormDetected: false, duFormConfidence: 'none', duFormSlips: [] },
    };
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

  // Deterministic brand/product list for the "Soll ich mit Marken anfangen?"
  // -> "Ja" funnel gap: when an active product type is known and the caller
  // bare-affirms or asks for the selection, name real catalog products for that
  // type instead of letting catalogSearch("ja") return nothing and the model
  // loop on the same offer (live call). Grounded: only real catalog names.
  const typeListReply = tryDeterministicTypeListReply({
    userText: user,
    memory: canaryTurn.runtime.memory,
    catalogSearch: input.catalogSearch,
  });
  if (typeListReply) {
    return {
      blocked: false,
      text: typeListReply,
      memory: reduceDrkallaShortTermMemory(
        canaryTurn.runtime.memory,
        deriveDrkallaAgentSpokeEvent({ text: typeListReply, turnIndex }),
      ),
      metrics: { extraLlmCalls: 0, extraKbCalls: 0, directiveChars: canaryTurn.directiveChars },
      blockers: [],
      quality: { duFormDetected: false, duFormConfidence: 'none', duFormSlips: [] },
    };
  }

  // Open-ended need ("was habt ihr für Dauerwelle / welche Marken?"): when the
  // caller did NOT name a specific product, surface real catalog products by
  // category so the model NAMES them instead of looping on clarifying questions
  // (live call 2026-06-13). Grounded: only real catalog names are injected.
  const namedNow = input.detectProducts?.(user) ?? [];
  const catalogHits = namedNow.length === 0 ? (input.catalogSearch?.(user, 4) ?? []) : [];
  let system = compactSystemPrompt(canaryTurn.modelDirectives);
  if (catalogHits.length) {
    const list = catalogHits
      .map((p) => (p.priceText ? `${p.spokenName} (${p.priceText})` : p.spokenName))
      .join('; ');
    system += `\nKatalog-Treffer zum Bedarf (nenne dem Anrufer konkret ein bis drei dieser echten Produkte, erfinde nichts dazu, und frage nicht erneut nach der Produktart): ${list}`;
  }
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
