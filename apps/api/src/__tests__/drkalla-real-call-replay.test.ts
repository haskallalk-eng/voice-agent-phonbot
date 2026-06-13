import { describe, expect, it } from 'vitest';
import {
  buildDrkallaCustomLlmResponse,
  type DrkallaCustomLlmResponse,
} from '../drkalla-custom-llm-responder.js';
import {
  createDrkallaShortTermMemory,
  type DrkallaShortTermVoiceMemory,
} from '../drkalla-short-term-memory.js';
import {
  loadDrkallaProductCatalogSearch,
  loadDrkallaProductEvidenceLookup,
  loadDrkallaProductNameDetector,
  loadDrkallaProductNameEntries,
} from '../retell-drkalla-custom-llm-ws.js';
import { buildDrkallaAmbiguousProductNameDetector } from '../drkalla-product-name-detector.js';
import { createTrustedScope } from '../trusted-scope.js';
import type { AgentTurnRequestedEvent } from '../voice-runtime-contract.js';

/**
 * Replays the real failing call from 2026-06-13 against the REAL catalog
 * snapshot (not stubs) — the prior WS smoke kept passing while the live call
 * failed, so this guards the actual product layer: short speakable names,
 * shampoo != comb, grounded products so SMS/price work, and a clean hang-up.
 */

const trustedScope = createTrustedScope({
  orgId: 'org-1', tenantId: 'tenant-1', agentId: 'agent-drkalla', callId: 'call-1',
  source: 'server', resolvedFrom: 'call_registry',
});

const CANARY = { enabled: true, allowModelDirectives: true, allowLiveRollout: false, maxDirectiveChars: 800 } as const;

const catalogSearch = loadDrkallaProductCatalogSearch();
const evidenceLookup = loadDrkallaProductEvidenceLookup();
const detectProducts = loadDrkallaProductNameDetector();
// Wire the ambiguous detector exactly like production — the live failure was a
// generic "Shampoo" turn being treated as one ambiguous product line.
const aliasEntries = loadDrkallaProductNameEntries();
const detectAmbiguousProduct = aliasEntries.length
  ? buildDrkallaAmbiguousProductNameDetector(aliasEntries)
  : undefined;

function turn(currentUserText: string): AgentTurnRequestedEvent {
  return {
    type: 'AgentTurnRequested', eventId: 'e', traceId: 't', trustedScope,
    provider: 'retell', channel: 'voice', providerCallId: 'call-1', responseId: 'r',
    occurredAt: '2026-06-13T10:00:00.000Z', receivedAt: '2026-06-13T10:00:00.100Z',
    currentUserText,
  };
}

describe('DrKalla real-call replay against the live catalog snapshot', () => {
  it('has a loaded catalog, evidence and detector', () => {
    expect(catalogSearch).toBeTruthy();
    expect(evidenceLookup).toBeTruthy();
    expect(detectProducts).toBeTruthy();
  });

  it('names a short grounded product for a need, sends SMS on "ja", grounds a shampoo (not a comb), prices it, and hangs up', async () => {
    let modelCalls = 0;
    let smsSentForUrl: string | null = null;
    const client = { complete: async () => { modelCalls += 1; return 'MODEL_SHOULD_NOT_RUN'; } };
    const executeSendLink = async (link: { url: string }) => {
      smsSentForUrl = link.url;
      return { smsSent: true as const };
    };
    const run = (memory: DrkallaShortTermVoiceMemory, text: string): Promise<DrkallaCustomLlmResponse> =>
      buildDrkallaCustomLlmResponse({
        canary: CANARY,
        event: turn(text),
        memory,
        client,
        detectProducts,
        detectAmbiguousProduct,
        evidenceLookup,
        catalogSearch,
        executeSendLink,
      });

    // 1) Caller states a category need -> deterministic SHORT product + grounded link offer.
    const r1 = await run(createDrkallaShortTermMemory(), 'Ich möchte eine Haarfarbe kaufen.');
    expect(r1.metrics.extraLlmCalls).toBe(0);
    const grounded1 = r1.memory.lastMentionedProduct;
    expect(grounded1).toBeTruthy();
    expect(grounded1!.spokenName.length).toBeLessThanOrEqual(45);   // short, speakable
    expect(grounded1!.spokenName).not.toMatch(/\b\d+\s?ml\b/i);     // no size in the name
    expect(r1.text).toMatch(/per SMS schicken\?$/);                 // offered a sendable link
    expect(r1.text).not.toMatch(/\bdu\b|\bdich\b|\bdir\b/i);        // Sie

    // 2) Bare "ja" -> the SMS actually goes out (grounded product had a URL).
    const r2 = await run(r1.memory, 'ja');
    expect(r2.text).toContain('geschickt');
    expect(smsSentForUrl).toMatch(/^https:\/\//);
    expect(r2.metrics.extraLlmCalls).toBe(0);

    // 3) Switch need to shampoo for curly hair -> a SHAMPOO is grounded, never a comb.
    const r3 = await run(r2.memory, 'Ich suche ein Shampoo für lockiges Haar.');
    const grounded3 = r3.memory.lastMentionedProduct;
    expect(grounded3).toBeTruthy();
    expect(grounded3!.productKind ?? '').toMatch(/shampoo|haarpflege|pflege/i);
    expect(grounded3!.productKind ?? '').not.toMatch(/kamm|tool|b(ü|ue)rste/i);
    expect(r3.metrics.extraLlmCalls).toBe(0);

    // 4) Price question on the grounded shampoo -> deterministic grounded price.
    const r4 = await run(r3.memory, 'Was kostet das?');
    expect(r4.text).toMatch(/kostet|Euro/i);
    expect(r4.metrics.extraLlmCalls).toBe(0);

    // 5) "leg einfach auf" -> hang up (the real call never did).
    const r5 = await run(r4.memory, 'Nein, leg einfach auf.');
    expect(r5.endCall).toBe(true);
    expect(r5.metrics.extraLlmCalls).toBe(0);

    expect(modelCalls).toBe(0); // the entire happy-path flow is deterministic
  });
});
