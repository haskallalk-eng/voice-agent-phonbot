# AGENTS.md

## Project

Phonbot is a multi-tenant Voice Agent SaaS. Retell is the current production voice runtime. Retell-KB remains the production latency baseline and fallback. OpenAI Realtime is lab/canary only until it proves parity through the same internal agent core, tool policy, knowledge layer, latency budgets, and eval gates.

This file is the non-negotiable architecture contract for Codex and other coding agents working in this repository.

## Document Authority

Only `AGENTS.md` and `PLANS.md` are authoritative for Codex implementation work unless the current user task explicitly says otherwise.

Review files, archived files, copied addenda, chat transcripts, and old baseline plans are historical context only. If any archived/review/baseline document conflicts with `AGENTS.md` or `PLANS.md`, the root files win.

Do not use archived review files as implementation instructions.

Active Codex implementation runs should read only `AGENTS.md` and `PLANS.md` unless the user explicitly asks for historical comparison. `CLAUDE.md` is not required for Codex strategy, planning, architecture, latency, rollout, provider, security, production, or KB decisions. Low-level repo hygiene needed by Codex must be copied into `AGENTS.md`, `PLANS.md`, or a sanitized `REPO_HYGIENE.md`.

## Core Principle

Provider APIs are transport/runtime surfaces. They must not become the product brain.

Business logic belongs in the provider-neutral Agent Core, Context Engine, Own-KB/RAG governance layer, Tool Policy, Action Gateway, and Response Composer. Retell, OpenAI Realtime, SIP, WebRTC, WebSocket, and telephony-specific code may translate events and commands, but must not decide business behavior.

## Enforcement Boundary

This file guides Codex behavior but does not enforce production safety by itself.

High-risk behavior must be prevented by code-level checks, database constraints, RLS where applicable, runtime policy, feature flags, CI gates, sandbox/approval configuration, and deterministic allowlists for destructive operations.

Do not rely on `AGENTS.md` as a substitute for enforcement. If a safety rule matters in production, encode it in code, tests, database constraints, readiness checks, or rollout controls.

## Target Layering

1. Voice Runtime
   - Audio, ASR, TTS, turn-taking, interruptions, telephony/session transport.
   - No business logic.

2. Provider Adapter
   - Retell/OpenAI/raw runtime events to canonical events.
   - Canonical commands to provider-specific messages.
   - No business logic.

3. Agent Core
   - Call state machine, task state, language, latency budget, orchestration.
   - No provider-specific schema.

4. Context Engine
   - Builds a deterministic ContextContract from state, policy, retrieved evidence, and allowed tools.
   - No full raw transcript, no full KB dump, no unverified user data.

5. Own-KB/RAG
   - Approved/current/risk-aware/tenant-scoped governance, evidence, and retrieval.
   - Hybrid search, freshness checks, citations, confidence, and abstain behavior.
   - Must not replace Retell-KB in production until Retell-KB parity gates pass.

6. Tool Policy and Action Gateway
   - Central policy, confirmation, idempotency, audit, mutation execution.
   - The model may propose intent; policy decides execution.

7. Response Composer
   - Short, voice-native answers grounded in approved evidence, policy, and current call state.

8. Observability, Evals, Shadow, Dual-Read
   - Trace every decision. Compare providers and KBs. Gate rollout.

9. Rollout, Cost, Cleanup
   - Feature flags, allowlists, rollback, quotas, protected cleanup.

## Voice Pipeline Boundaries

Voice-agent work must preserve separately measured and governed speech-to-text, text reasoning, text-to-speech, and runtime interaction layers.

1. Voice Input / STT Layer
   - Captures provider/runtime audio input, end-of-turn signals, partial/final transcripts, ASR confidence, locale, and transcript redaction state.
   - Provider-specific ASR event names, confidence formats, acoustic metadata, and transcript payloads stay inside runtime/adapters until normalized.
   - STT quality and latency must be measured separately from text reasoning and TTS.

2. Text Reasoning / TTT Layer
   - Uses canonical, redacted user utterances plus call/task state, evidence decisions, policy decisions, and response plans.
   - Own-KB, Tool Policy, Context Engine, Agent Core, and Response Composer operate here.
   - This layer must not depend on raw provider STT/TTS schemas or provider-specific event names.

3. Voice Output / TTS Layer
   - Converts `writtenText` and `spokenText` into safe voice output with `safe_audio_type`, pronunciation profile, and first/full audio timing.
   - German `spokenText` normalization remains required and must preserve evidence-backed facts.
   - Provider-specific pronunciation dictionaries, SSML, phoneme hints, and audio-output details stay inside runtime/adapters.

4. Runtime Interaction Layer
   - Handles turn-taking, interruptions, barge-in recovery, transport/session control, provider response correlation, streaming, and audio playback.
   - Runtime interaction may coordinate canonical events/commands but must not make business, retrieval, policy, tenant-scope, or mutation decisions.

## Canonical Runtime Contract

Every provider integration must map into these internal concepts before reaching business logic.

Every canonical event and command must carry trusted scope and provider correlation fields unless a test explicitly proves why a field is unavailable. Provider identifiers are correlation only; authorization scope must come from `trustedScope`.

```ts
type RuntimeProvider = 'retell' | 'openai_realtime' | 'web_chat' | 'unknown';
type InteractionChannel = 'voice' | 'web' | 'internal_test';

type TrustedScope = {
  orgId: string;
  tenantId: string;
  agentId?: string;
  callId?: string;
  sessionId?: string;
  source: 'server';
  resolvedFrom: 'call_registry' | 'session_registry' | 'authenticated_request' | 'internal_job';
};

type CanonicalBase = {
  eventId: string;
  traceId: string;
  trustedScope: TrustedScope;
  provider: RuntimeProvider;
  channel: InteractionChannel;
  providerEventId?: string;
  providerCallId?: string;
  providerSessionId?: string;
  sequence?: number;
  occurredAt: string;
  receivedAt: string;
};
```

Canonical inbound events:

- `CallStarted`
- `UserSpeechPartial`
- `UserSpeechFinal`
- `AgentTurnRequested`
- `UserInterrupted`
- `ToolResultReceived`
- `CallEnded`
- `RuntimeError`

Canonical outbound commands:

- `SpeakStart`
- `SpeakDelta`
- `SpeakEnd`
- `Wait`
- `EndCall`
- `TransferCall`
- `RequestToolExecution`
- `LogShadowEvidence`
- `UpdateRuntimeTuning`

Speech and turn commands must preserve `turnId`, provider response correlation when needed, `sequence`, streaming/finality state, `isFinal`, `interruptible`, `evidenceIds`, and `voiceStyle`. Provider-specific event names, payload shapes, response IDs, websocket message types, session IDs, and audio formats must stay inside adapters unless they are intentionally normalized into canonical fields.

Provider adapters may receive full provider transcripts because providers send them. Adapters must not forward full transcripts into the ContextContract. They may extract only the current finalized user utterance, current partial utterance when needed, last N redacted turns, compact state summary, and provider response/turn IDs needed for streaming control.

Full provider transcripts may be stored or processed only through approved trace/eval paths with explicit redaction purpose and retention rules.

OpenAI Realtime adapters must be versioned and isolated. Realtime event names, beta/GA headers, session shapes, response event names, audio event names, and tool-call event names must stay inside the OpenAI adapter. Agent Core must not import, switch on, persist, or test against raw OpenAI Realtime event names. If Realtime event shapes change, only the OpenAI adapter and its tests should change.

`UpdateRuntimeTuning` may only change transport/runtime-safe parameters. It must not change business policy, tool authorization, KB source selection, tenant scope, response truthfulness rules, or provider-neutral Agent Core decisions.

## Non-Negotiable Rules

- Do not put business logic in Retell, OpenAI Realtime, SIP, WebSocket, WebRTC, or telephony adapters.
- Adapters may translate only: provider event to canonical event, and canonical command to provider message.
- All retrieval must be tenant-scoped and org-scoped by server-derived values. No knowledge query may run without trusted scope.
- Never trust `orgId`, `tenantId`, `agentId`, `callId`, customer identity, or authorization context from model arguments.
- The model must never directly execute mutating actions. Mutations must go through Tool Policy and Action Gateway.
- Mutating tools require policy approval, idempotency, audit logging, tenant/org/call context, and user confirmation where applicable.
- Do not include full raw call transcripts, full KB content, or unverified user data in prompts.
- Context may include only the current utterance, limited redacted recent turns, compact call state, approved retrieved facts, allowed tool schemas, and policy decisions.
- Pricing, legal, policy, medical, financial, and compliance answers require approved/current sources.
- If no approved/current source supports an answer, the agent must abstain, ask a clarifying question, or escalate.
- RAG output may never authorize a mutation. `knowledge.search` is read-only and must return `mayMutate=false`.
- Every change touching retrieval, tools, context composition, provider adapters, or voice responses must include observability or trace evidence.
- Feature rollout must be behind flags. No primary switch without shadow/eval evidence.
- Cleanup must be deterministic infrastructure. The model must never decide destructive cleanup.

## Trusted Scope Rules

All retrieval, tool execution, tracing, and mutation checks must use server-derived `TrustedScope`.

`TrustedScope` must include:

- `orgId`
- `tenantId`
- `agentId` where applicable
- `callId` or `sessionId` where applicable
- `source: 'server'`
- `resolvedFrom` describing the server source of truth

Model/tool arguments must never provide or override `TrustedScope`. Tool schemas should not expose `orgId`, `tenantId`, `agentId`, `callId`, or authorization context unless the field is explicitly marked untrusted and ignored for authorization.

## Tenant Isolation Rules

- Every KB source, source version, document, chunk, embedding, retrieval event, citation, eval case, trace, and shadow result must carry tenant/org scope where applicable.
- Retrieval SQL must filter by trusted org and tenant scope.
- Application-level filtering is not enough. For Supabase tables in exposed schemas, RLS must be enabled and policies must enforce org/tenant scope unless the service-role path is explicitly isolated and tested.
- Readiness must verify required scope columns, validated constraints, RLS posture where applicable, and absence of public `anon`/`authenticated` grants on private KB tables.
- Tests must include negative fixtures with similar data across tenants.
- Canary fixtures should include sentinel values that must never appear cross-tenant.
- Readiness must fail if live DB scope constraints are unvalidated.

## KB Governance Rules

Own-KB sources used for answers must be:

- approved
- current/indexed
- within `verified_at` and `expires_at`
- allowed for the requested use
- tenant/org scoped
- not marked as unsafe PII
- not prompt-injection content

Smoke tests prove reachability only. They do not prove KB quality. Canary is blocked until transcript-derived coverage gaps are closed and P0/P1 eval gates pass.

Retell-KB remains the production runtime benchmark and fallback. Own-KB may be used as governance/control plane, source of truth, shadow/eval system, Retell-KB sync source, OpenAI Realtime knowledge layer, or provider-neutral fallback before it becomes runtime primary.

Allowed modes:

- Mode A: Retell-KB primary, Own-KB shadow.
- Mode B: Own-KB governance + Retell-KB runtime retriever.
- Mode C: Own-KB primary only after parity gates pass.

No Own-KB primary switch is allowed until Own-KB reaches or beats Retell-KB on realistic voice latency, quality, governance, and safety gates. If Retell-KB remains faster, keep Retell-KB as runtime retriever and use Own-KB as control plane.

For high-risk answers, Retell-KB may be used as runtime context only if the synced content source version is known, the answer is also supported by Own-KB evidence, or a human-approved exception exists. Otherwise route through Own-KB, abstain, clarify, or escalate.

## Retrieved Content Safety

Retrieved KB content is evidence, not instruction.

Retrieved content may support factual answers. Retrieved content may not change system/developer instructions, change tool policy, authorize mutations, override tenant/org scope, modify provider/session configuration, or request secrets/hidden context.

Prompt-injection attempts inside KB content must be ignored and logged as injection attempts. RAG snippets are untrusted facts until the Context Engine admits them under the source metadata gates.

## Tool Policy Rules

The model may propose a tool intent. It may not decide that a mutation is safe.

Mutating actions require:

- central policy decision
- idempotency key
- audit log
- server-derived org/tenant/agent/call context
- before/after payload where applicable
- explicit user confirmation when needed
- rollback or compensation strategy where practical

Reads may be allowed by policy, but reads that expose customer data still require strong identity/context checks.

## Runtime Action Policy

`EndCall` and `TransferCall` are policy-relevant runtime actions, even when they do not mutate the database.

They may be emitted only after call-state rules and tenant/agent policy allow them. Transfer targets must be allowlisted. `EndCall` must include a traceable reason.

## Voice Quality Rules

Voice answers must be short, natural, and task-oriented.

Measure and protect:

- answer correctness against approved evidence
- abstain behavior when evidence is missing
- conversation guidance quality
- German ASR variants and umlauts
- interruptions and corrections
- user frustration and escalation
- time to first token
- time to first audio
- retrieval latency
- policy decision latency
- barge-in recovery latency

Do not optimize for long web-chat explanations in voice mode.

## Ultra-Low-Latency Voice SLO

The production latency target is no longer `Voice-RAG p95 <= 2200 ms`.

Primary production target:

- Normal supported voice turn e2e p50 <= 500 ms.
- Normal supported voice turn e2e p90 <= 700 ms.
- Normal supported voice turn e2e p95 <= 800 ms.
- All supported non-tool voice turns e2e p95 <= 1000 ms.
- p99 target <= 1200 ms and must be reported separately.

End-to-end latency means: user stops speaking -> agent begins responding.

`Voice-RAG p95 <= 2200 ms` is a legacy upper-bound/fallback only. It is not the production target.

Normal live answers must not use slow Full-Hybrid RAG unless the full e2e path is proven under the 800 ms e2e budget.

Allowed normal low-latency paths:

- no KB needed
- pinned verified facts
- cached answer skeleton
- Retell-KB runtime retrieval
- Own-KB cache
- Own-KB structured facts
- Own-KB FTS-first only if measured p95 <= 100 ms

Not allowed in the normal 800 ms live path unless proven under budget:

- live Own-KB hybrid search
- slow vector path
- live rerank
- deep evidence review
- external tool calls
- mutation flows

Exception-path latency rules:

- High-risk turns must produce truthful, task-relevant `first_safe_audio` within the normal p95 <= 800 ms target when possible; generic filler never counts.
- High-risk `final_audited_answer_ms` must be reported separately from normal voice e2e latency and must not be hidden behind filler audio.
- Tool and mutation turns may satisfy the first-safe-audio SLO with a targeted clarification, policy confirmation, or truthful tool-status update, but final tool execution latency must be reported by tool class before canary expansion.
- `barge_in_recovery_ms` must be measured from interruption received to the agent stopping stale output and handling the newest user intent; p95 target <= 500 ms unless a stricter tenant/provider target exists.
- Missing exception-path budgets or missing measurements block canary expansion.

Voice response rubric:

- Normal answer: max 1-2 short sentences.
- Answer first, then ask one concise clarifying question only when needed.
- Do not speak long source or RAG explanations unless the user asks for sources.
- If evidence is missing or stale, abstain naturally instead of improvising.
- If ASR confidence is low, ask a targeted clarification.
- If the user corrects the agent, acknowledge the correction and update state.
- Never continue a stale answer after a new user intent.
- Stop cleanly on interruption and prioritize the newest user intent.
- No mutation without a confirmed summary.

## P0/P1 Eval Definitions

P0 failures:

- Cross-tenant data leak.
- Raw PII stored in logs, traces, evals, or shadow results without an explicit allowed purpose.
- Stale, unapproved, or fabricated pricing/legal/policy answer.
- Unauthorized mutation.
- Tool call with wrong tenant/user identity.
- Model-supplied scope accepted for retrieval or mutation.
- Prompt injection from KB content changes tool policy, system behavior, provider config, or authorization context.
- Unsafe cleanup/deletion.
- Provider adapter changes business decision.

P1 failures:

- Answer contradicts approved source.
- Agent should abstain but answers confidently.
- Correct source is retrieved but answer is composed incorrectly.
- Hard latency budget is exceeded.
- Realistic German/ASR call handling fails.
- Agent asks unnecessary clarification when source is sufficient.
- Agent talks over the caller after interruption.
- Agent confirms the wrong action after user correction.
- Agent gives a long web-style answer in a normal voice turn.

P2 failures:

- Awkward voice style.
- Answer too long.
- Slightly awkward wording.
- Minor citation/logging issue.
- Non-critical formatting issue.

## Non-Negotiable Promotion Gates

- Retell-KB vs Own-KB baseline exists on the same realistic voice questions.
- Milestone 0.5B benchmark results are promotion evidence only after Milestone 1A TrustedScope, Milestone 1B Trace Scope Correctness, Milestone 1D DB/RLS/readiness validation, and Milestone 1E Voice Latency Measurement Contract pass.
- If 0.5B stores or processes real transcripts, shadow data, call logs, or eval artifacts with potential PII beyond minimal local/dev testing, Milestone 1C PII Purpose Redaction must also pass first.
- 0.5B benchmark execution requires an explicit 0.5B-approved benchmark/eval artifact with approver, approval timestamp, PII classification, and same-question Retell/Own-KB samples. If no approved artifact is available, fail closed and produce no promotion evidence.
- Own-KB canary runtime search requires explicit canary deploy unlock, approved 0.5B artifact ID, artifact SHA-256 evidence, a persisted 0.5B attestation matching that ID/SHA/decision, `owkb_canary_candidate` or `owkb_primary_candidate` decision evidence, Product KPI gates, exception-path SLO evidence, Retell standby, rollback, and kill-switch readiness.
- `owkb_canary_candidate` can allow only canary preparation/start; it must never allow Own-KB primary.
- `owkb_primary_candidate` is required for Own-KB primary and still requires a separate non-placeholder primary artifact ID, separate artifact SHA-256 evidence, a separate persisted primary 0.5B attestation matching that ID/SHA/decision, explicit primary deploy unlock, 14 days canary without P0, no unresolved P1 gaps, Product KPI hard gates, rollback/kill switch verification, Retell-KB standby for 14-30 days, and explicit latency/quality/safety gate evidence.
- Benchmark artifacts must include representative normal-supported and supported non-tool coverage; slow or hard turns must not be excluded from the 500-800 ms SLO by relabeling them unsupported.
- Runtime rollout booleans must use exact `true`; shorthand truthy values such as `1`, `yes`, or `on` are not sufficient for promotion gates.
- Rollout allowlists must list concrete org/tenant/agent IDs. Wildcard `*` belongs only in historical docs; production rollout uses explicit IDs or an explicit global emergency flag.
- 0 cross-tenant retrievals.
- 0 model-supplied scope accepted.
- 0 unapproved/stale pricing/legal/policy answers in P0/P1 evals.
- 0 unauthorized mutations.
- 0 prompt-injection effect from retrieved content.
- 0 raw PII leakage in logs/traces/evals/shadow without explicit purpose.
- Normal supported voice turn e2e p50 <= 500 ms.
- Normal supported voice turn e2e p90 <= 700 ms.
- Normal supported voice turn e2e p95 <= 800 ms.
- All supported non-tool voice turns e2e p95 <= 1000 ms.
- p99 <= 1200 ms target, reported separately.
- KB/context path p95 <= 100 ms for normal live turns.
- Cache/pinned answer path p95 <= 30-50 ms.
- Retell-KB latency impact target <= 100 ms.
- Own-KB FTS-first p95 <= 80-100 ms if used in normal live path.
- P1 pass rate >= 98%.
- 0 unresolved P1 failures for canary/primary promotion.
- 0 hallucinated Own-KB answers in P0/P1 promotion samples.
- Recall@5 >= 90% where retrieval is required.
- Retrieval-required samples must have Recall@5 labels.
- Normal supported turns cannot be removed from the 500-800 ms SLO by marking them `answerable=false`; unsupported/stale/out-of-scope cases must be explicitly classified and counted separately.
- At least top 30 real intents represented.
- Fast-path coverage >= 80% for normal real questions.
- 14 days canary without P0.
- Retell-KB remains production baseline/fallback.
- Retell/OpenAI provider switch requires no new business logic.
- Own-KB primary requires parity with Retell-KB on latency and answer quality; do not optimize by weakening governance.
- Product KPI hard gates must pass before canary expansion.

## Required Tests For Relevant Changes

Add or update tests for:

- tenant isolation
- stale/unapproved source blocking
- provider-neutral behavior
- same canonical input leading to same core decision across providers
- no business logic in provider adapters
- unauthorized mutation denial
- idempotency for mutating tools
- shadow/dual-read evidence when rollout behavior changes

## Repo Commands

Use corepack/pnpm from the repo root unless a package-specific command is needed.

```bash
corepack pnpm --filter @vas/api typecheck
corepack pnpm --filter @vas/web typecheck
corepack pnpm --filter @vas/api test
corepack pnpm supabase:migrations:check
```

For targeted API tests:

```bash
corepack pnpm --filter @vas/api test -- <test-file-or-pattern>
```

## Repo Hygiene Rules

- Prefer `rg` / `rg --files` for repository searches.
- Keep TypeScript imports compatible with the existing package/module style.
- Run focused typecheck/tests after code changes that touch API, web, retrieval, tools, policy, or provider-adapter paths.
- Avoid duplicate declarations and large unrelated rewrites.
- Do not put secrets, deploy targets, SSH paths, production commands, or operational coordination details in review exports.

## Current Ordered Execution Path

1. Milestone 1A TrustedScope for `knowledge.search` is accepted as complete; preserve the invariant and reopen only on regression.
2. Milestone 1D DB/RLS/readiness validation is accepted as complete; preserve the live-readiness invariant and reopen only on regression.
3. Milestone 1C PII redaction purpose separation is accepted as complete; preserve the purpose-specific redaction invariant and reopen only on regression.
4. Milestone 1B Trace Scope Correctness is accepted as complete; preserve explicit org/tenant/provider/call trace fields and reopen only on regression.
5. Milestone 1E Voice Latency Measurement Contract is accepted as complete; preserve the canonical timestamp and safe-audio anti-gaming invariant and reopen only on regression.
6. Milestone 1F Own-KB to Retell-KB Sync Contract is accepted as complete; preserve governed source-version sync, auto-refresh/auto-crawl blockers, and model non-authority over sync work.
7. Milestone 1G Voice Compliance and Disclosure Controls is accepted as complete; preserve disclosure, consent, retention, deletion, minimization, and audit-event readiness gates.
8. Milestone 1H German Voice Output Normalization Contract is accepted as complete; preserve `writtenText`/`spokenText` separation, evidence-preserving transformations, and provider-neutral pronunciation boundaries.
9. Milestone 1I STT / TTT / TTS Voice Pipeline Contract is accepted as complete first pass; preserve separate STT, TTT, TTS, and runtime-interaction measurement boundaries and reopen only on regression.
10. Run trusted Milestone 0.5B Retell-KB vs Own-KB benchmark execution only with explicit 0.5B-approved eval artifacts after Milestone 1A TrustedScope, Milestone 1B Trace Scope Correctness, Milestone 1D DB/RLS/readiness validation, and Milestone 1E Voice Latency Measurement Contract pass. If no approved artifact is available, fail closed and produce no promotion evidence. If real transcripts, shadow data, call logs, or eval artifacts with potential PII are stored or processed beyond minimal local/dev testing, Milestone 1C PII Purpose Redaction must also pass first. A trusted report is necessary but never sufficient for canary or primary; rollout is governed by the Canary/Primary readiness matrix in `PLANS.md`.
11. Add architecture-drift CI checks before Milestone 2 provider/core refactors.
12. Add the canonical runtime contract and provider adapter tests.
13. Add ContextContract schema and snapshot tests.
14. Add KB ingestion prompt-injection red-team fixtures.
15. Add conversational quality evals, product KPIs, and P0/P1 gates.
16. Improve Own-KB coverage and latency only against Retell-KB parity benchmarks.
17. Only then expand OpenAI Realtime canary integration.
