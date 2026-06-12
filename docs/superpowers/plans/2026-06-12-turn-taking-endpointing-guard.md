# Turn-Taking / Endpointing Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, low-latency Turn-Taking / Endpointing Guard that improves voice conversation timing without adding a normal-path LLM or KB call.

**Architecture:** Retell remains the voice runtime for the current canary. The new guard sits after provider adapter normalization and before Agent Core response planning; it may advise wait/respond/repair behavior, but it cannot decide business facts, KB evidence, tool authorization, tenant scope, or mutations. The first implementation is a pure function and tests only; live wiring into the DrKalla Custom Runtime Canary happens only after focused local tests and canary smoke tests are green.

**Tech Stack:** TypeScript, Vitest, existing canonical voice runtime contracts, Retell Custom LLM WebSocket canary.

---

## Current Reality

- Retell is still the production voice runtime and remains the voice transport for the canary.
- The DrKalla Custom Runtime Canary now speaks through Retell Custom LLM WebSocket.
- The latest reviewed canary call proved transport works but response quality is still minimal: the agent repeated a fallback clarification for product/category questions.
- The current canary is not the finished DrKalla RAG/product/funnel agent.
- Text WebSocket simulations can test response format, memory, and turn decisions without paid live calls.
- Real STT/VAD/TTS quality still needs audio or Retell webcall evidence.

## 99% Review Dimensions

Every review loop must evaluate:

1. Latency: no added normal-path LLM call, no added KB call, guard decision p95 <= 20 ms.
2. Voice quality: fewer cut-offs, fewer stale answers, fewer false end-call moments, better repair behavior.
3. Architecture: runtime-only decision layer; no business logic in provider adapters or turn guard.
4. Retell reality: Retell still performs primary endpointing; guard can use `update_only` history and influence response planning only inside Custom Runtime.
5. Canary safety: no phone-number reassignment, no Retell-KB sync, no Own-KB primary, no production rollout flag changes.
6. STT/TTT/TTS attribution: guard failures must be classified as runtime interaction or STT ambiguity, not hidden as reasoning errors.
7. German voice behavior: German fillers, trailing connectors, corrections, interruptions, short answers, and incomplete phrases are handled.
8. Product-funnel compatibility: guard must not reset active product/category state or ask category-level questions after product-level context is established.
9. Measurement: guard emits reason/action/latency metadata; no filler-only audio counts toward SLO.
10. Rollback: canary-only wiring behind explicit env flag; pure function can be disabled without changing Retell agents.

## Agent Review Loop

Run this loop until no P0/P1 gaps remain:

1. Aspect Agent defines the dimensions above and checks coverage.
2. Architecture Agent checks provider/runtime/core boundaries.
3. Voice Agent checks German conversation timing, interruption, and repair behavior.
4. Latency Agent checks p95 decision cost and no extra LLM/KB calls.
5. Safety Agent checks scope, PII, evidence, tools, and end-call behavior.
6. A/B Agent checks red/green cases: A reproduces the issue, B fixes it.
7. Contextless Agent reviews only this spec plus code diff for contradictions.
8. Fix Agent closes any P0/P1 issue.
9. Percent Agent may say 99% only if the preceding four independent percent passes have no P0/P1 blocker.

## Milestone 1J: Turn-Taking / Endpointing Guard

### Contract

```ts
type TurnTakingGuardAction =
  | 'respond_now'
  | 'wait_short'
  | 'keep_listening'
  | 'repair_prompt';

type TurnTakingGuardReason =
  | 'final_transcript_complete'
  | 'partial_still_changing'
  | 'trailing_connector'
  | 'low_asr_confidence'
  | 'interruption_or_correction'
  | 'long_silence'
  | 'inaudible_streak'
  | 'empty_or_missing_text';

type TurnTakingGuardDecision = {
  action: TurnTakingGuardAction;
  reason: TurnTakingGuardReason;
  userLikelyDone: number;
  userLikelyContinuing: number;
  confidence: number;
  maxWaitMs: number;
  p95BudgetMs: 20;
  mayCallLlm: false;
  mayCallKb: false;
  mayAuthorizeTool: false;
  mayEndCall: false;
};
```

### Acceptance

- Final German utterances respond immediately.
- Trailing connectors such as `und`, `also`, `weil`, `äh`, `ich meine`, `ich wollte` wait briefly instead of responding.
- Partial text that is still changing keeps listening.
- Low ASR confidence asks a short repair prompt.
- Repeated inaudible speech escalates repair wording without ending the call.
- Interruption/correction phrases prioritize the newest user intent.
- Long true silence is represented as wait/repair guidance, not direct end-call authority.
- Guard decision p95 <= 20 ms in synthetic 1000-case simulation.
- Guard result has `mayCallLlm=false`, `mayCallKb=false`, `mayAuthorizeTool=false`, `mayEndCall=false`.

## Task 1: Add Pure Guard Tests

**Files:**
- Create: `apps/api/src/__tests__/turn-taking-guard.test.ts`
- Create later: `apps/api/src/turn-taking-guard.ts`

- [x] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  evaluateTurnTakingGuard,
  runTurnTakingGuardSimulation,
} from '../turn-taking-guard.js';

describe('Turn-Taking / Endpointing Guard', () => {
  it('responds immediately for complete German final utterances', () => {
    const decision = evaluateTurnTakingGuard({
      transcriptText: 'Ich suche eine Haarfarbe.',
      transcriptFinal: true,
      asrConfidence: 0.92,
      partialStableMs: 420,
      silenceMs: 360,
      nowMs: 1000,
    });

    expect(decision.action).toBe('respond_now');
    expect(decision.reason).toBe('final_transcript_complete');
    expect(decision.mayCallLlm).toBe(false);
    expect(decision.mayCallKb).toBe(false);
    expect(decision.mayEndCall).toBe(false);
  });

  it('waits briefly on trailing German connectors instead of cutting in', () => {
    const decision = evaluateTurnTakingGuard({
      transcriptText: 'Ich suche eine Haarfarbe und',
      transcriptFinal: false,
      asrConfidence: 0.88,
      partialStableMs: 120,
      silenceMs: 160,
      nowMs: 1000,
    });

    expect(decision.action).toBe('wait_short');
    expect(decision.reason).toBe('trailing_connector');
    expect(decision.maxWaitMs).toBeGreaterThanOrEqual(150);
    expect(decision.maxWaitMs).toBeLessThanOrEqual(300);
  });

  it('uses repair prompt for low-confidence speech without authorizing end call', () => {
    const decision = evaluateTurnTakingGuard({
      transcriptText: 'ha farb',
      transcriptFinal: true,
      asrConfidence: 0.37,
      partialStableMs: 300,
      silenceMs: 420,
      nowMs: 1000,
    });

    expect(decision.action).toBe('repair_prompt');
    expect(decision.reason).toBe('low_asr_confidence');
    expect(decision.mayEndCall).toBe(false);
  });

  it('keeps listening when a partial transcript is still changing', () => {
    const decision = evaluateTurnTakingGuard({
      transcriptText: 'Ich wollte',
      transcriptFinal: false,
      asrConfidence: 0.83,
      partialStableMs: 40,
      silenceMs: 60,
      nowMs: 1000,
    });

    expect(decision.action).toBe('keep_listening');
    expect(decision.reason).toBe('partial_still_changing');
  });

  it('keeps the 1000-case synthetic decision p95 under 20 ms', () => {
    const report = runTurnTakingGuardSimulation({ cases: 1000, seed: 'turn-guard-v1' });

    expect(report.caseCount).toBe(1000);
    expect(report.p95DecisionMs).toBeLessThanOrEqual(20);
    expect(report.extraLlmCalls).toBe(0);
    expect(report.extraKbCalls).toBe(0);
    expect(report.failures).toEqual([]);
  });
});
```

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
corepack pnpm --filter @vas/api test -- --run src/__tests__/turn-taking-guard.test.ts
```

Expected: fail because `../turn-taking-guard.js` does not exist.

## Task 2: Implement Pure Guard

**Files:**
- Create: `apps/api/src/turn-taking-guard.ts`

- [x] **Step 1: Implement deterministic function**

Use no model, no KB, no network, no provider SDK.

- [x] **Step 2: Run GREEN verification**

```bash
corepack pnpm --filter @vas/api test -- --run src/__tests__/turn-taking-guard.test.ts
corepack pnpm --filter @vas/api typecheck
```

Expected: all tests pass.

## Task 3: Canary Integration Planning Only

Do not wire live behavior until Task 1 and 2 are green and a second review pass approves it.

Future canary wiring:

- Parse `update_only` into a per-socket turn-state buffer.
- On `response_required`, ask guard for action.
- If `respond_now`, proceed to current response composer.
- If `repair_prompt`, return a short repair prompt.
- If `wait_short`, delay up to `maxWaitMs` only inside canary and only if no newer final text arrives.
- Never use guard to call tools, authorize end-call, select KB facts, or mutate state.

## Percent-Agent Passes

1. Architecture Percent Agent: 99% plan confidence if guard remains runtime-only and pure.
2. Latency Percent Agent: 99% plan confidence if p95 <= 20 ms and no extra calls.
3. Voice Percent Agent: 99% plan confidence if German trailing connector, correction, interruption, silence, and inaudible cases are covered.
4. Safety Percent Agent: 99% plan confidence if no tool/end-call/scope authority exists in the guard.

If any pass finds P0/P1 blockers, return to Task 1 and add a red test before changing implementation.
