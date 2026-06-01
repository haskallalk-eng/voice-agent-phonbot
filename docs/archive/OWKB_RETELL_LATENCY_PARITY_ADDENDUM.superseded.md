# Superseded / Historical Reference

This file is not authoritative for Codex implementation. Its active content has been merged into `../../PLANS.md`.

If this file conflicts with `../../AGENTS.md` or `../../PLANS.md`, those files win.

Do not use this file as implementation instruction.

# OWKB Retell-KB Latency Parity Addendum

Version: 2026-05-29

Purpose: prevent building Own-KB as a production replacement for Retell-KB unless Own-KB proves equal or better latency, quality, and governance in realistic voice conditions.

## Core Decision

Do not replace Retell-KB in production by assumption.

Retell-KB remains the production latency baseline and fallback until Own-KB passes parity gates.

Own-KB may become primary only after it proves:

- equal or better answer quality on transcript-derived evals
- equal or acceptable voice latency under realistic load
- stronger governance, tenant isolation, freshness, and auditability
- no P0 failures and P1 pass rate >= 98%
- 14 days canary without P0

If Own-KB cannot match the required latency after benchmarked optimization, keep Retell-KB as the production runtime retriever and use Own-KB as governance/control plane, source of truth, eval/shadow system, or non-Retell provider knowledge layer.

## Why This Addendum Exists

The project goal is not to replace Retell-KB for ideological reasons.

The goal is the best voice agent: lowest safe latency, highest answer quality, strong governance, tenant isolation, auditability, and provider-neutral architecture.

Retell-KB is documented as real-time optimized and should generally add under 100 ms latency impact. Own-KB must be compared against that, not against an abstract RAG target.

The current Own-KB smoke showed retrieval reachability but not production readiness: 10 questions, 0 answerable, p95 about 715 ms. That is not enough to justify replacing Retell-KB.

## New Milestone 0.5: Retell-KB Baseline And Build-vs-Retell Decision

Milestone 0.5 is split into two parts:

- 0.5A builds benchmark/eval scaffolding only.
- 0.5B runs and trusts the benchmark as promotion evidence only after Milestone 1A TrustedScope and Milestone 1D DB/RLS/readiness validation pass.

Benchmark scaffolding may exist before security enforcement. Promotion evidence must not.

### Goal

Measure Retell-KB vs Own-KB on the same realistic voice questions before committing to Own-KB as primary.

### Scope

- No production behavior change.
- No OpenAI Realtime expansion.
- No Own-KB primary flag.
- No Retell-KB deletion or disabling.
- Benchmark/eval scaffolding only.

### Test Set

Use at least:

- top 50 real caller questions
- top 30 real intents
- pricing/legal/policy cases
- stale-only cases
- out-of-scope cases
- German ASR variants
- interruption/correction cases where possible

### Measure Retell-KB

- time-to-first-audio
- KB latency impact where observable
- answer correctness
- wrong-chunk or irrelevant-context failures
- abstain behavior
- hallucination rate
- chunk count and similarity threshold
- whether retrieved context/chunk details are observable enough for audit

Recommended measurement methods:

- A/B Retell runtime benchmark where possible: same agent, same test questions, Retell-KB enabled vs controlled baseline, external time-to-first-audio and response latency measured.
- Production-shadow benchmark: same transcript-derived questions compare Retell-KB production response against Own-KB shadow retrieval.
- High-risk benchmark: answer quality may pass only if auditability is sufficient or the answer is independently supported by Own-KB evidence.

### Measure Own-KB

- time-to-first-audio
- `knowledge.search` latency p50/p95/p99
- cached, exact, FTS, vector, and hybrid mode latency
- answerability
- recall@5
- evidence correctness
- abstain behavior
- tenant isolation
- stale/unapproved blocking
- PII and prompt-injection handling

### Decision Output

The benchmark report must output exactly one recommendation:

- `keep_retell_primary`
- `owkb_shadow_only`
- `owkb_canary_candidate`
- `owkb_primary_candidate`

Suggested report shape:

```ts
type RetellVsOwnKbDecisionReport = {
  decision:
    | 'keep_retell_primary'
    | 'owkb_shadow_only'
    | 'owkb_canary_candidate'
    | 'owkb_primary_candidate';
  retell: {
    ttfaP50: number;
    ttfaP95: number;
    ttfaP99?: number;
    answerCorrectness: number;
    abstainCorrectness: number;
    auditability: 'sufficient' | 'insufficient' | 'unknown';
  };
  owkb: {
    knowledgeSearchP50: number;
    knowledgeSearchP95: number;
    knowledgeSearchP99: number;
    ttfaP50: number;
    ttfaP95: number;
    recallAt5: number;
    answerability: number;
    evidenceCorrectness: number;
    staleBlockingPassed: boolean;
    tenantIsolationPassed: boolean;
  };
  blockers: string[];
};
```

## Three Allowed Production Modes

### Mode A: Retell-KB Primary, Own-KB Shadow

Use when Retell-KB has better latency or Own-KB is not ready.

- Retell-KB answers production.
- Own-KB runs shadow retrieval and eval.
- Own-KB gaps are logged by intent, source, and risk.
- No production answer depends on Own-KB.

### Mode B: Own-KB Governance + Retell-KB Runtime Retriever

Use when Retell-KB latency is clearly best but Own-KB governance is still required.

- Own-KB is the source of truth for approved/current sources.
- Only approved/current Own-KB-derived content is synced into Retell-KB.
- Retell-KB is used as the low-latency runtime retriever for Retell production.
- Own-KB tracks source versions, approvals, `expires_at`, risk, `allowed_use`, and sync state.
- High-risk answers still require evidence/freshness policy checks where observable.
- If Retell retrieval evidence is not observable enough for audit, high-risk use must be limited or routed through Own-KB.

### Mode C: Own-KB Primary

Use only after parity gates pass.

- Own-KB provides context to the Agent Core.
- Retell-KB remains standby for 14-30 days.
- Dual-read continues during canary.
- Rollback to Retell-KB is tested.

## Required Knowledge Router

Implement a provider-neutral `KnowledgeContextProvider` abstraction before any primary switch:

```ts
type KnowledgeContextProvider = 'retell_kb' | 'owkb' | 'none';

type KnowledgeContextDecision = {
  provider: KnowledgeContextProvider;
  reason:
    | 'no_kb_needed'
    | 'retell_primary'
    | 'owkb_primary'
    | 'owkb_required_for_high_risk'
    | 'latency_fallback_to_retell'
    | 'evidence_missing_abstain'
    | 'shadow_only';
  risk: 'low' | 'medium' | 'high' | 'pricing' | 'legal' | 'policy';
  latencyBudgetMs: number;
  requiresAuditEvidence: boolean;
};
```

Rules:

- Low-risk FAQ may use the fastest safe context provider.
- Pricing/legal/policy requires approved/current evidence and auditability.
- If Retell-KB is faster but evidence is not auditable, do not use it for high-risk primary answers unless a human-approved exception exists.
- For high-risk answers, Retell-KB may be used as runtime context only if the synced content source version is known, the answer is also supported by Own-KB evidence, or a human-approved exception exists.
- If Own-KB misses latency gates, do not force it into production.
- If neither provider has safe evidence, abstain, clarify, or escalate.

## Stop-Loss Rule

Stop Own-KB primary work and keep Retell-KB production if, after latency optimization and realistic evals:

- Own-KB `knowledge.search` warm p95 remains > 250 ms for normal cases
- Own-KB normal supported voice e2e p95 remains > 800 ms
- Own-KB supported non-tool voice e2e p95 remains > 1000 ms
- Own-KB KB/context path p95 remains > 100 ms for normal live turns
- Own-KB answerability or recall remains below gate
- optimization requires removing governance, tenant isolation, freshness, or answerability checks

Do not optimize by weakening governance.
Do not replace Retell-KB unless the measured agent becomes better, not just more custom.

## Codex Prompt For This Addendum

Read `AGENTS.md` and `PLANS.md` first. This archived addendum is historical only.

Task:
Add or implement Milestone 0.5A: Retell-KB vs Own-KB benchmark scaffolding.

Goal:
Prevent Own-KB from becoming primary unless it proves Retell-level latency, equal or better quality, and stronger governance.

Constraints:

- Do not change production behavior.
- Do not enable Own-KB primary.
- Do not delete or disable Retell-KB.
- Do not build OpenAI Realtime features.
- Add benchmark/eval scaffolding only.
- Keep Retell-KB as production baseline and fallback.
- Do not use benchmark results as promotion evidence until Milestone 1A and Milestone 1D pass.

Done when:

- A benchmark plan exists for Retell-KB vs Own-KB on the same questions.
- Metrics include answer quality, answerability, latency p50/p95/p99, TTFA, abstain behavior, and auditability.
- A decision report can output `keep_retell_primary | owkb_shadow_only | owkb_canary_candidate | owkb_primary_candidate`.
- `PLANS.md` records that Own-KB primary is blocked until parity gates pass.
