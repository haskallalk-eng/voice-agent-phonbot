# PLANS.md

This file turns the Voice Agent architecture into executable Codex work. It is a living ExecPlan index and must be kept current as work proceeds.

## Purpose / Big Picture

Build a provider-neutral Voice Agent Core where Retell remains production Layer 0, Retell-KB remains the production latency benchmark and fallback, OpenAI Realtime remains lab/canary, and Own-KB/RAG becomes the shared governed knowledge and evidence system.

The goal is not "more provider integration" and not "replace Retell-KB by assumption". The goal is provable answer quality, conversation quality, latency, functionality, tenant isolation, privacy, and cost safety. Own-KB may become primary only if it reaches or beats Retell-KB on realistic voice latency and quality while preserving stronger governance.

## Document Authority

Authoritative files:

1. `AGENTS.md` - non-negotiable architecture and safety contract.
2. `PLANS.md` - executable living ExecPlan and current milestone source.

Non-authoritative files:

- review files
- old baseline files
- copied addenda
- chat transcripts
- archived Markdown files

If any archived/review/baseline document conflicts with `AGENTS.md` or `PLANS.md`, `AGENTS.md` and `PLANS.md` win.

Do not use archived review files as implementation instructions.

Active Codex implementation runs should read only `AGENTS.md` and `PLANS.md` unless the user explicitly asks for historical comparison. Low-level repo hygiene needed by Codex must be present in `AGENTS.md`, this `PLANS.md`, or a sanitized `REPO_HYGIENE.md`; `CLAUDE.md` is not an active Codex input.

## Sanitized External Review Export Policy

External review exports may include only:

- `AGENTS.md`
- `PLANS.md`
- explicitly requested code snippets

Do not include `CLAUDE.md`, deployment targets, SSH paths, server IPs, production commands, coordination memory, historical secret incident details, or secret-adjacent operational details in external review exports.

If Codex needs repo hygiene instructions for an external review packet, copy only sanitized low-level rules into `REPO_HYGIENE.md`. `REPO_HYGIENE.md` must not contain production infrastructure, secrets, deploy targets, SSH paths, server IPs, historical secret details, or internal coordination paths.

`CLAUDE.md` remains non-authoritative for Codex strategy and must not be exported for external plan review unless the user explicitly asks for historical comparison.

Pre-export gate:

- Export artifacts are files intended for external plan/code review, including `docs/plan-review-export-*.md` and any future copied review packet.
- Before export, run a targeted scan for `CLAUDE.md`, SSH paths, server IPs, deployment targets, production commands, coordination memory, historical secret incident details, private-key markers, and secret-adjacent operational detail.
- Export may proceed only when the export contains `AGENTS.md`, `PLANS.md`, and explicitly requested code snippets, with no operational infrastructure detail.
- If the scan finds intentional policy text such as this section, the reviewer must confirm it is a prohibition, not leaked operational content.
- Every external review export needs an `export_sanitization_check` note with date, checked files, scan patterns, and pass/fail result. Without a passing `export_sanitization_check`, the export is not review-ready.

## Ultra-Low-Latency SLO

The production target is 500-800 ms end-to-end latency for normal supported voice turns.

End-to-end latency is measured from user stops speaking -> agent begins responding.

Targets:

- normal supported voice turn e2e p50 <= 500 ms
- normal supported voice turn e2e p90 <= 700 ms
- normal supported voice turn e2e p95 <= 800 ms
- all supported non-tool voice turns e2e p95 <= 1000 ms
- p99 target <= 1200 ms, reported separately
- KB/context path p95 <= 100 ms for normal live turns
- cache/pinned answer path p95 <= 30-50 ms
- Retell-KB latency impact target <= 100 ms
- Own-KB FTS-first p95 <= 80-100 ms if used in the normal live path

Legacy:

- `Voice-RAG p95 <= 2200 ms` is no longer the production target.
- It may only be used as a fallback/legacy upper bound or high-risk audited-answer allowance.
- Full RAG is not allowed in the normal live 800 ms path unless the full e2e path is proven under budget.

## How To Use This File

For every large change:

1. Keep production behavior stable unless the plan explicitly changes it.
2. Make one milestone executable at a time.
3. Define exact files, interfaces, tests, and acceptance criteria before editing code.
4. Update `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective`.
5. Do not mark a milestone done until tests and evidence match the acceptance criteria.

## Completed Repair: Verify PLANS.md Completeness

This completeness gate was run before Milestone 1A and remains the standard check before large future milestones. It guards against truncated uploads or stale copies being used as the working plan.

Run from the repository root:

```bash
rg -n "^## |^### " PLANS.md AGENTS.md
powershell -NoProfile -Command "Get-Content PLANS.md | Measure-Object -Line -Character; Get-Content AGENTS.md | Measure-Object -Line -Character"
```

Acceptance:

- `PLANS.md` contains Milestone 1A, 1B, 1C, and 1D with goal, likely files, work, before/after tests, commands, and acceptance.
- `PLANS.md` contains Non-Negotiable Promotion Gates.
- `PLANS.md` contains Measurement Definitions for `voice_e2e_ms`, `normal_supported_turn`, `kb_context_ms`, `full_rag_ms`, `first_safe_response_ms`, `final_audited_answer_ms`, `knowledge.search warm`, and P1 pass rate.
- `PLANS.md` contains `Validation and Acceptance`.
- `PLANS.md` contains `Idempotence and Recovery`.
- `PLANS.md` contains `Interfaces and Dependencies`.
- `AGENTS.md` remains below the Codex default project-doc limit unless the limit is intentionally raised.

## Progress

- [x] 2026-05-29: Created `AGENTS.md` provider-neutral architecture contract.
- [x] 2026-05-29: Created initial `PLANS.md` milestone roadmap.
- [x] 2026-05-29: Upgraded `AGENTS.md` with enforcement boundary, TrustedScope, retrieved-content safety, runtime action policy, and promotion gates.
- [x] 2026-05-29: Upgraded `PLANS.md` into a fuller living ExecPlan structure.
- [x] 2026-05-29: Verified `PLANS.md` is complete in the repo and hardened it with measurement definitions, global validation gates, interfaces/dependencies, and sharper Milestone 1A-1D criteria.
- [x] 2026-05-29: Added explicit completeness verification, plan-of-work sections, concrete Milestone 1A steps, and PII redaction purpose typing.
- [x] 2026-05-29: Added Retell-KB parity content and inserted Milestone 0.5 so Retell-KB remains benchmark/fallback until Own-KB parity is proven.
- [x] 2026-05-29: Merged Retell-KB parity addendum content into `PLANS.md`, archived the addendum, added document authority rules, and hardened production latency SLO to normal supported e2e p95 <= 800 ms.
- [x] 2026-05-29: Completed final document-authority cleanup: `CLAUDE.md` is non-authoritative for Codex strategy, active Codex implementation runs use `AGENTS.md` and `PLANS.md`, and archived addenda/reviews/baselines are not implementation authority.
- [x] 2026-05-29: Implemented Milestone 0.5A benchmark decision scaffolding in `apps/api/src/own-kb-benchmark.ts` with deterministic tests.
  - [x] benchmark/eval scaffolding exists
  - [x] Retell-KB and Own-KB same-question coverage is represented and blocks promotion if absent
  - [x] decision report outputs `keep_retell_primary | owkb_shadow_only | owkb_canary_candidate | owkb_primary_candidate`
  - [x] Own-KB primary remains blocked unless parity, safety, canary, and Retell-standby gates pass
- [x] 2026-05-29: Hardened Milestone 0.5A after review with coverage gates, missing-metric blockers, P1 pass rate, high-risk auditability, slow-RAG normal-path protection, and rollback-required primary gates.
- [x] 2026-05-29: Incorporated final external review guardrails as plan-only updates: sanitized review export policy, tighter 0.5B promotion-evidence gate, Retell auto-refresh/auto-crawl governance, architecture-drift CI plan, stronger TrustedScope/RLS readiness, OpenAI safety identifier planning, and first_safe_audio anti-gaming.
- [x] 2026-05-29: Replaced existing external plan review exports with sanitized exports containing only `AGENTS.md` and `PLANS.md`.
- [x] 2026-05-29: Ran multi-agent 98%-readiness loop and tightened plan ambiguity: AGENTS/PLANS promotion sync, Canary-vs-Primary split, active Codex input closure, exception-path SLOs, ordered execution path, Milestone 1B/1G acceptance, Product KPI measurement contract, export gate, and Milestone 2 architecture-drift gate.
- [x] 2026-05-29: Ran 99%-readiness loop and added final anti-ambiguity polish: trusted report necessary-not-sufficient wording, exact 0.5B gate mirroring in `AGENTS.md`, KPI inconclusive blockers, high-risk final-answer timeout/policy requirement, and export sanitization proof artifact.
- [x] 2026-05-29: Completed the final tiny plan cleanup for Measurement Definitions wording.
- [x] 2026-05-29: Completed Milestone 1A TrustedScope final acceptance for `knowledge.search`.
  - [x] branded `TrustedScope` type exists.
  - [x] lower-level `knowledgeSearch` rejects missing or unbranded `TrustedScope`.
  - [x] model/tool args cannot override org/tenant/agent/call/customer scope.
  - [x] scope/provenance-like args cannot affect retrieval, policy, mutations, or `knowledge.search` trace arg keys.
  - [x] OpenAI/Web and Retell tool schemas do not expose trusted scope fields and use `additionalProperties: false`.
  - [x] focused API typecheck and 31 focused tests pass.
- [x] 2026-05-29: Reviewed Milestone 1A against the current plan as the single source of truth and corrected post-1A ordering ambiguity in `AGENTS.md`/`PLANS.md`; Milestone 1D was the next implementation at that point and has since been completed.
- [x] 2026-05-29: Completed Milestone 1D DB/RLS/readiness validation with an additive scope-constraint validation migration, static Own-KB readiness check, live catalog-readiness checker, CLI, explicit org-scope requirements for Own-KB service-role scripts, focused readiness tests, and live target-database readiness evidence.
- [x] 2026-05-29: Completed Milestone 1C PII redaction purpose separation with central purpose-specific redaction APIs, migrated tool/runtime/trace/shadow/eval/training paths, user-visible confirmation preservation, and focused PII/tool/shadow tests.
- [x] 2026-05-29: Completed Milestone 1B Trace Scope Correctness with explicit trace scope fields, TrustedScope-to-trace mapping, org-vs-tenant separation, Retell tool trace scope enrichment, fail-closed trace isolation tests, and focused Retell/Knowledge boundary tests.
- [x] 2026-05-29: Completed Milestone 1E Voice Latency Measurement Contract with canonical timestamp types, safe-audio anti-gaming, Retell-vs-Own-KB report integration, and focused latency/benchmark tests.
- [x] 2026-05-29: Completed Milestone 1F Own-KB to Retell-KB Sync Contract with deterministic sync metadata, eligibility, idempotency, auto-refresh/auto-crawl blockers, model non-authority, and focused sync-contract tests.
- [x] 2026-05-29: Completed Milestone 1G Voice Compliance and Disclosure Controls with policy-source, disclosure, recording consent, retention, deletion, minimization, audit-event, and prompt-only-compliance gates.
- [x] 2026-05-29: Completed Milestone 1H German Voice Output Normalization Contract with written/spoken text separation, deterministic German voice normalization, evidence-preserving transformations, review-required name markers, and focused voice-output tests.
- [x] 2026-05-29: Added Milestone 0.5B approved-artifact gate scaffolding in `apps/api/src/own-kb-benchmark-artifact.ts`; repo discovery found no approved benchmark/eval artifact, so no promotion benchmark evidence was produced and 0.5B remains blocked on an explicit approved artifact.
- [x] 2026-05-29: Added first-pass architecture-drift guardrail tests in `apps/api/src/__tests__/architecture-drift.test.ts` for provider import boundaries, raw provider event names, `knowledge.search` schemas, TrustedScope fail-closed semantics, `mayMutate=false`, and full-transcript snapshot exclusion.
- [x] 2026-05-30: Ran non-promotional 0.5B diagnostic after local runtime env completion. Retell API was reachable and matched 10 existing shadow samples, but the run is not promotion evidence because no explicit approved 0.5B artifact exists, coverage is 10 samples instead of 50, intent coverage is insufficient, quality labels are missing, and Own-KB was 10/10 not answerable on the matched shadow set.
- [x] 2026-05-30: Closed a 0.5B gate drift in code so `buildRetellVsOwnKbDecisionReport` trusts promotion evidence only when Milestone 1A, 1B, 1D, and 1E gates are all true; added focused artifact/report tests and preserved fail-closed non-promotional behavior.
- [x] 2026-05-30: Added `own-kb:benchmark-artifact` CLI runner for sanitized 0.5B artifact validation; without an explicit approved artifact it fails closed with `APPROVED_BENCHMARK_ARTIFACT_MISSING` and produces no promotion evidence.
- [x] 2026-05-30: Added `own-kb:benchmark-template` draft generator for 0.5B artifact preparation. It creates a 50-question/30-intent `DRAFT_ONLY` template and tests prove approval metadata alone cannot turn the template into promotion evidence without real measurements and labels.
- [x] 2026-05-30: Added a sanitized 0.5B artifact gap report so the CLI can explain missing approval, coverage, labels, canonical latency timestamps, auditability, and canary/primary gates without printing samples, transcripts, call IDs, or caller content.
- [x] 2026-05-30: Generated a local gitignored 0.5B draft artifact and sanitized gap report under `apps/api/scratch/own-kb-benchmark/`; added `--report-only` so QA can produce gap reports with exit 0 while default validation still fails closed for non-promotional artifacts.
- [x] 2026-05-30: Added `own-kb:benchmark-pack` to generate a local gitignored QA pack with draft artifact JSON, labeling CSV, safety-gates JSON, sanitized gap report, and README. The CSV includes canonical latency timestamp, quality-label, auditability, and safety columns without transcript/caller-content columns.
- [x] 2026-05-30: Added `own-kb:benchmark-apply-labels` to merge the QA labeling CSV back into a candidate artifact. Approval remains explicit-only through CLI fields; importing labels alone keeps the artifact `DRAFT_ONLY` and non-promotional.
- [x] 2026-05-30: Hardened the 0.5B label-import approval path so explicit human approval also requires an explicit `containsPotentialPii` classification. Approval metadata without PII classification now stays `DRAFT_ONLY`, and the CLI fails closed when approval flags omit the classification.
- [x] 2026-05-30: Hardened 0.5B label-import row integrity: approval now also requires no duplicate CSV keys, no unmatched CSV rows, and no artifact samples missing CSV labels. Partial label imports remain draft-only.
- [x] 2026-05-30: Added optional `--gap-output` and `--safety-gates` support to `own-kb:benchmark-apply-labels` so a CSV import can immediately write a sanitized candidate gap report without exposing samples or caller content.
- [x] 2026-05-30: Sanitized `own-kb:benchmark-apply-labels` stdout so it reports row-integrity counts and status, not concrete `questionId::provider` sample keys.
- [x] 2026-05-30: Removed local output paths from `own-kb:benchmark-apply-labels` JSON stdout; it now reports `artifactWritten`/`gapReportWritten` booleans plus row-integrity counts. Silent CLI verification showed no sample keys or workspace paths in JSON stdout.
- [x] 2026-05-30: Sanitized `own-kb:benchmark-pack` JSON stdout so it reports `outputDirectoryWritten` and logical `filesWritten` keys instead of absolute output directories or file paths. Silent CLI verification showed no workspace paths or sample keys in stdout.
- [x] 2026-05-30: Sanitized `own-kb:benchmark-template` stdout so it no longer prints the full draft artifact by default. It now reports only whether a file was written, sample counts, draft status, and `promotionEvidenceUsable: false`; silent CLI verification showed no sample keys or workspace paths.
- [x] 2026-05-30: Hardened `own-kb:benchmark-apply-labels` boolean flags so `--contains-potential-pii`, `--uses-real-transcripts`, `--uses-shadow-data`, and `--uses-call-logs` accept only explicit `true` or `false`. Invalid values now fail closed instead of being silently ignored.
- [x] 2026-05-30: Hardened 0.5B PII/source consistency: imports using real transcripts, shadow data, or call logs cannot be classified as `containsPotentialPii=false`. The CLI fails closed and the core import function keeps inconsistent artifacts `DRAFT_ONLY`.
- [x] 2026-05-30: Hardened approved artifact validation itself against inconsistent PII/source classification. Externally supplied 0.5B artifacts now get `BENCHMARK_ARTIFACT_PII_SOURCE_CLASSIFICATION_INCONSISTENT` when real transcripts, shadow data, or call logs are marked non-PII.
- [x] 2026-05-30: Hardened 0.5B label-import approval timestamps. `approvedAt` must be parseable before an imported artifact can become `0.5B`; the CLI rejects invalid `--approved-at` values and the core importer keeps invalid approvals `DRAFT_ONLY`.
- [x] 2026-05-30: Tightened 0.5B approval timestamps to exact UTC ISO strings with milliseconds, e.g. `2026-05-30T00:00:00.000Z`. The shared validator is used by both label import and artifact validation, and rejects date-only, offset, missing-millisecond, or normalized-invalid dates.
- [x] 2026-05-30: Hardened 0.5B approver metadata to neutral handles. `approvedBy` must be a lowercase handle using letters, numbers, dot, underscore, or hyphen; emails, names with spaces, paths, and mixed-case values are rejected by import and validation.
- [x] 2026-05-30: Started Milestone 2 with a type-only canonical runtime contract in `apps/api/src/voice-runtime-contract.ts` and focused tests. Events and commands now share `TrustedScope` plus provider/channel correlation fields; no adapter wiring, provider behavior, rollout flag, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.
- [x] 2026-05-30: Expanded Milestone 2 with isolated Retell and OpenAI Realtime fixture adapters in `apps/api/src/provider-adapters/` plus golden normalization tests in `apps/api/src/__tests__/voice-runtime-provider-adapters.test.ts`. The fixtures prove same-turn canonical parity, Retell full-transcript reduction, redacted recent turns, interruption/response correlation, transport-only runtime tuning, no provider-side tool execution, and no provider SDK/policy-layer imports. No live adapter wiring or provider behavior changed.
- [x] 2026-05-30: Hardened architecture-drift checks for Milestone 2 fixture adapters. `apps/api/src/__tests__/architecture-drift.test.ts` now keeps the fixture adapters test-only until explicit live wiring work and proves provider adapters do not import provider SDKs, policy/action/tool layers, Agent Runtime, or Own-KB modules.
- [x] 2026-05-30: Added an additive Product KPI measurement contract in `apps/api/src/product-kpi-contract.ts` with focused tests in `apps/api/src/__tests__/product-kpi-contract.test.ts`. The validator distinguishes hard gates from monitored metrics, requires every hard-gate KPI, blocks missing baseline/sample/tolerance/owner/budget-band data as inconclusive, rejects hard/monitored misclassification, enforces lower-is-better, higher-is-better, and within-budget-band targets, and keeps owner approval identifiers neutral. The Milestone 6 rollout/cost/cleanup contract now also requires a hard-gate-ready KPI report instead of trusting only a naked KPI boolean.
- [x] 2026-05-30: Used user-confirmed test/demo transcripts to generate a local non-promotional 0.5B draft QA pack under `apps/api/scratch/own-kb-benchmark/test-transcripts/`. The pack contains 50 redacted questions, labeling CSV, gap report, Own-KB diagnostic, and Retell test-call latency diagnostic; it remains `DRAFT_ONLY` and not promotion evidence.
- [x] 2026-05-30: Added reproducible `own-kb:benchmark-test-transcripts` CLI for generating the non-promotional test/demo-transcript 0.5B draft pack. The command writes local QA files and emits only sanitized summary counts/status.
- [x] 2026-05-30: Added local `test-transcript-own-kb-source-authoring.csv` so the 50 redacted test questions can be turned into reviewed, source-backed Own-KB facts before any ingestion. This is an authoring aid only, not approved KB content.
- [x] 2026-05-30: Added `own-kb:authoring-validate` so test-transcript authoring rows fail closed until each row has an evidence-backed answer, source title, allowed use/risk, approved review status, and valid freshness dates. Current local authoring CSV validates as 0/50 valid rows, so no Own-KB source JSON is produced.
- [x] 2026-05-30: Refactored Own-KB authoring validation into a testable module and added focused tests for draft fail-closed behavior, CSV parsing, risk/use/date validation, and source JSON generation from validated human-reviewed rows.
- [x] 2026-05-30: Hardened Own-KB authoring validation against PII and prompt-injection content before source generation. Rows containing detectable PII or instruction-override text cannot become `containsPii=false` KnowledgeSource JSON.
- [x] 2026-05-30: Hardened Own-KB authoring output so Source JSON is written only when the entire CSV validates. Partial-valid CSVs now produce zero sources, preventing accidental ingestion of incomplete authoring batches.
- [x] 2026-05-30: Hardened Own-KB authoring validation against duplicate `questionId`s so a batch cannot silently choose between conflicting answers for the same transcript-derived question.
- [x] 2026-05-30: Hardened Own-KB authoring validation so empty or missing-row CSVs fail closed with `AUTHORING_ROWS_REQUIRED` instead of appearing as a successful zero-source run.
- [x] 2026-05-30: Hardened Own-KB authoring validation with field-size limits for question IDs, redacted questions, proposed answers, source titles, and notes so accidental full-transcript or oversized content cannot become latency-heavy KB source material.
- [x] 2026-05-30: Hardened Own-KB authoring CSV structure validation. Missing headers, missing required columns, or unknown columns now fail closed before row parsing, preventing raw-transcript or ad hoc columns from entering the authoring path.
- [x] 2026-05-30: Hardened Own-KB authoring freshness fields to require exact UTC ISO timestamps with milliseconds for `verifiedAt` and `expiresAt`, preventing ambiguous date/time parsing in generated source metadata.
- [x] 2026-05-30: Normalized generated Own-KB authoring source metadata for `allowedUse`, `reviewStatus`, and `risk` to lowercase canonical values so accepted mixed-case authoring input cannot create downstream metadata drift.
- [x] 2026-05-30: Hardened Own-KB authoring quality checks against placeholder answers/titles and copied-question answers so QA rows cannot fake coverage with TODO text or question-as-answer content.
- [x] 2026-05-30: Added deterministic `sha256`/`contentHash` metadata to generated Own-KB authoring sources so reviewed answer versions can be audited and future Retell-KB sync can compare exact content versions.
- [x] 2026-05-30: Hardened `own-kb:authoring-validate --output` against stale source files. Invalid authoring runs now overwrite the requested output with an empty array and report `outputCleared: true`, so a previous valid source file cannot survive a later failed validation.
- [x] 2026-05-30: Hardened `own-kb:authoring-validate` path handling so `--input`, `--output`, and `--report-output` must be distinct resolved paths. Misconfiguration now fails with `AUTHORING_OUTPUT_PATH_CONFLICT` before any read/write can clobber the source CSV or mix report/source output.
- [x] 2026-05-30: Hardened Own-KB authoring validation against spreadsheet formula injection in CSV-authored fields. Question, answer, title, and notes fields starting with formula characters now fail before source generation.
- [x] 2026-05-30: Hardened Own-KB authoring coverage gates. The CLI now defaults to `--min-rows 50`, reports `minRowsRequired`, and blocks source generation with `AUTHORING_ROW_COVERAGE_BELOW_MINIMUM` when a batch is too small.
- [x] 2026-05-30: Extended Own-KB authoring PII and prompt-injection checks to notes, not only question/answer/title fields, so local review notes cannot carry unsafe content into validation reports or review workflows.
- [x] 2026-05-30: Extended Own-KB authoring placeholder detection to reviewer notes such as `Fill answer...`, so draft guidance must be removed before rows can become generated source content.
- [x] 2026-05-30: Hardened Own-KB authoring validation against redaction tokens in generated source content fields. Proposed answers, source titles, and notes containing tokens such as `[PHONE]`, `[EMAIL]`, `[IBAN]`, or `[REDACTED]` now fail before source generation.
- [x] 2026-05-30: Made the test-transcript draft pack generator reproducibly emit `test-transcript-own-kb-source-authoring.csv` and an expanded README with the authoring validation rules and commands. Regenerated the local pack from 59 test/demo rows into 50 selected redacted questions.
- [x] 2026-05-30: Hardened `own-kb:benchmark-test-transcripts --generated-at` to require exact UTC ISO timestamps with milliseconds before using the value for artifact/report generation and authoring freshness dates.
- [x] 2026-05-30: Hardened the test-transcript draft-pack generator coverage gates. `--questions` must be 50-200, invalid numeric args fail closed, and the generator refuses to write a pack when unique redacted question coverage is below the requested count.
- [x] 2026-05-30: Hardened generated test-transcript CSV exports against spreadsheet formula injection. Shared pack helper functions now neutralize CSV cells that start with formula characters and are covered by focused tests.
- [x] 2026-05-30: Hardened 0.5B QA labeling CSV export against spreadsheet formula injection as well, so all generated test-transcript CSV artifacts are safe to open in spreadsheet tools.
- [x] 2026-05-30: Hardened Own-KB authoring CSV structure and freshness validation after independent review. Duplicate headers, malformed quotes, row/header column-count mismatches, future `verifiedAt`, and `expiresAt <= verifiedAt` now fail closed before source generation.
- [x] 2026-05-30: Hardened Own-KB authoring redaction-token checks to include `redactedQuestion`, because generated source content includes the reviewed question as well as the reviewed answer.
- [x] 2026-05-30: Hardened 0.5B decision reports so direct diagnostic reports cannot become promotion evidence outside the validated 0.5B artifact flow; missing P0/P1, abstain, hallucination, auditability, or safety labels now block promotion.
- [x] 2026-05-30: Split 0.5B canary blockers from primary blockers in code. Canary now requires Product KPI hard gates, exception-path SLO reporting, Retell-KB standby, rollback, and kill-switch evidence; primary still additionally requires 14 clean canary days.
- [x] 2026-05-30: Closed the independent-agent blocker where `own_kb_primary` could be deployed outside the 0.5B/Milestone-6 gate. Own-KB Primary now requires explicit primary deploy unlock plus a non-placeholder approved 0.5B artifact ID, 14 clean canary days, Retell standby, rollback, kill switch, Product KPI, and exception-SLO env evidence.
- [x] 2026-05-30: Hardened test-transcript draft pack inputs and approved-artifact metadata. Unsafe extracted questions with detectable PII, prompt injection, redaction tokens, or formula starts are skipped before CSV output, and approved artifacts reject PII/formula/path/placeholder-like sample metadata.
- [x] 2026-05-30: Hardened same-question benchmark pairing with `questionFingerprint`, duplicate-provider-sample blockers, and fingerprint mismatch/missing blockers so paired coverage cannot be fabricated with reused question IDs alone.
- [x] 2026-05-30: Hardened canary/primary rollout gates after contextless and rollout-agent review. Own-KB Canary search now requires an explicit canary deploy unlock, approved 0.5B artifact ID, artifact SHA-256, `owkb_canary_candidate`/`owkb_primary_candidate` decision evidence, Retell standby, rollback, kill-switch, Product KPI, and exception-SLO gates. Own-KB Primary additionally requires an explicit `owkb_primary_candidate` decision, separate primary artifact ID/hash, and 14 clean canary days.
- [x] 2026-05-30: Hardened 0.5B benchmark promotion blockers after independent review. Any Own-KB P1 failure now blocks promotion even when pass rate is exactly 98%, retrieval-required samples require Recall@5 labels, and fast-path coverage below 80% blocks promotion.
- [x] 2026-05-30: Hardened approved 0.5B artifact validation to reject unknown sample fields, unsafe notes, unsafe fingerprints, and arbitrary raw transcript fields instead of preserving unknown artifact/sample data by reference.
- [x] 2026-05-30: Hardened Own-KB to Retell-KB sync contract with explicit org/tenant/agent scope fields, scoped idempotency/audit data, and `SYNC_SCOPE_MISMATCH` fail-closed behavior for existing Retell sync state.
- [x] 2026-05-30: Hardened second-pass reviewer findings: approved artifacts reject unknown nested `voiceLatency` fields, Retell sync rejects missing/invalid `expires_at`, no-KB labels cannot satisfy fast-path coverage or Recall@5 gates, and Retell baseline samples now require quality/P0/P1 labels.
- [x] 2026-05-30: Hardened benchmark gap reports so `promotionEvidenceUsable` also requires an approved 0.5B artifact SHA-256 match; gap reports now emit `BENCHMARK_ARTIFACT_HASH_NOT_APPROVED` until the artifact hash is deliberately approved.
- [x] 2026-05-30: Hardened third-pass independent review findings: normal supported turns can no longer escape the 500-800 ms SLO by setting `answerable=false`, high-risk/interruption/tool exception-path latency metrics are required, same-question pairing now rejects duplicate fingerprints and provider metadata mismatches, hallucinated Own-KB samples block promotion, rollout env booleans require exact `true`, wildcard rollout allowlist entries no longer grant access, primary requires explicit post-canary latency/quality/safety/P1/standby-day evidence, Retell-KB standby IDs are preserved for Own-KB primary, and active Retell sync planning requires a concrete Retell KB ID.
- [x] 2026-05-30: Hardened final contextless review blockers: runtime canary/primary gates now require a persisted 0.5B attestation matching the approved artifact ID/SHA/decision instead of env-only claims, benchmark coverage now requires representative normal-supported and supported non-tool cases so slow turns cannot be relabeled out of the 500-800 ms SLO, and direct `deployToRetell` Own-KB primary calls now protect existing Retell-KB standby before deployment.
- [x] 2026-05-30: Added README/docs authority clarification and an architecture-drift check that keeps provider-specific `packages/voice-core` OpenAI Realtime code isolated to its explicit provider-reference section.
- [x] 2026-05-30: Implemented and hardened Milestone 1I as an additive type/test-only voice pipeline contract in `apps/api/src/voice-pipeline-contract.ts` with focused tests for STT, TTT, TTS, runtime interaction failure attribution, required timestamp boundaries, impossible cross-layer timestamp ordering, TTT timing separation, required redaction/source/review fields, canonical attribution/provider/channel validation, provider-specific payload/value rejection across pipeline, STT, TTT, TTS, and runtime fields including TTS output text, canonical allowlists for transcript source, TTT planning values, and pronunciation profile, finite confidence, finite non-negative runtime numeric values, and boolean review-state validation, typed bidirectional policy-to-safe-audio matching, safe-audio enum validation, interruption correlation with active provider response and next-turn separation, barge-in timestamp consistency, SLO classification fail-closed behavior that blocks relabeling normal turns into the looser supported-non-tool budget without an exception path, exception-path and live-SLO class mixing, explicit enum-validated exception paths with their own first-safe-audio budgets and semantic path matching, runtime interaction-state enum validation, and per-turn 800 ms SLO blockers. Verification passed: API typecheck plus 59 focused voice/runtime/architecture tests.
- [x] 2026-05-30: Re-ran the 0.5B artifact runner in report-only mode; it failed closed with `APPROVED_BENCHMARK_ARTIFACT_MISSING`, `promotionEvidenceUsable=false`, and next action `provide_explicit_0_5b_artifact`. No benchmark promotion evidence was produced.
- [x] 2026-05-30: Implemented and hardened Milestone 2C as an additive first-pass intent-playbook contract in `apps/api/src/intent-playbooks.ts` with focused tests in `apps/api/src/__tests__/intent-playbooks.test.ts`. The validator requires 30 unique top-intent playbooks, low-risk/high-risk/booking/escalation/out-of-scope coverage, explicit pricing/legal/policy risk-class coverage, required conversation fields, explicit required fields and tools, a typed allowed-tool registry with mutation metadata, German ASR variant class coverage, short spoken gold answers, and `confirmed_summary_before_tool` for all registry-mutating tools. This is contract evidence only; real top-30 playbook content and provider/runtime wiring remain future work before canary expansion.
- [x] 2026-05-30: Implemented Milestone 2D as an additive first-pass pure state-machine contract in `apps/api/src/tool-confirmation-state.ts` with focused tests in `apps/api/src/__tests__/tool-confirmation-state.test.ts`. The contract enforces the ordered mutation path from `intent_detected` through spoken summary, user confirmation, policy approval, idempotency key, tool execution, and truthful result speech; interruptions and corrections reopen confirmation before execution, repeated execution replays idempotently, and completed tool executions cannot be reopened in the same session.
- [x] 2026-05-30: Implemented Milestone 2E as an additive first-pass business-hours resolver contract in `apps/api/src/business-hours-resolver.ts` with focused tests in `apps/api/src/__tests__/business-hours-resolver.test.ts`. The resolver requires approved/current source-versioned evidence, `Europe/Berlin`, non-expired metadata, special hours, holidays, and `Betriebsferien`; static pinned opening-hours text never satisfies the answer path. `open_now` is minute-specific, while `open_tomorrow` asks whether any valid interval exists tomorrow.
- [x] 2026-05-30: Implemented Milestone 2F as an additive first-pass runtime-degradation matrix contract in `apps/api/src/runtime-degradation-matrix.ts` with focused tests in `apps/api/src/__tests__/runtime-degradation-matrix.test.ts`. The validator requires explicit behavior for Retell-KB unavailable, Own-KB unavailable, Redis unavailable, Supabase slow/down, tool API down, ASR/TTS degraded, and provider latency spike; degraded retrieval cannot guess high-risk facts, tool API down cannot claim success, ASR/TTS degradation needs metrics and clarification/escalation, and provider latency spikes must respect stop-loss plus first-safe-audio anti-gaming.
- [x] 2026-05-30: Implemented Milestone 3B as an additive first-pass KB-ingestion prompt-injection red-team suite contract in `apps/api/src/kb-ingestion-redteam.ts` with focused tests in `apps/api/src/__tests__/kb-ingestion-redteam.test.ts`. The validator requires HTML-hidden, PDF metadata, Markdown instruction, base64/unicode smuggling, tool-policy override, cross-tenant bait, and multilingual injection fixture classes; language coverage for German, English, Turkish, Arabic, and mixed-language attempts; excluded evidence summaries; injection logging; and blockers preventing KB content from authorizing mutations, changing scope/provider config, entering prompt instructions, or requesting secrets.
- [x] 2026-05-30: Implemented Milestone 4D as an additive first-pass German audio-chaos eval contract in `apps/api/src/german-audio-chaos-eval.ts` with focused tests in `apps/api/src/__tests__/german-audio-chaos-eval.test.ts`. The validator requires DACH telephone/audio chaos coverage, separate text/ASR/TTS/runtime labels, German/Austrian/Swiss phrase coverage, number/time/email/address correction examples, text-correct-but-voice-failed cases, and latency reporting under audio chaos.
- [x] 2026-05-30: Implemented Milestone 4E as an additive first-pass human-QA labeling workflow contract in `apps/api/src/human-qa-labeling.ts` with focused tests in `apps/api/src/__tests__/human-qa-labeling.test.ts`. The validator requires answer/abstain/escalation/evidence/voice/correction labels, P0/P1/P2 taxonomy, disagreement resolution with second review for P0/P1, eval/report/source/schema versioning, tenant/industry/intent/risk/language distribution tracking, raw-PII controls, and minimum label coverage before canary expansion.
- [x] 2026-05-30: Implemented Milestone 3 as an additive first-pass ContextContract builder in `apps/api/src/context-contract.ts` with focused tests in `apps/api/src/__tests__/context-contract.test.ts`. The builder requires branded server-derived `TrustedScope`, emits a stable compact snapshot, includes current utterance, redacted recent turns, task state, allowed tools, filtered evidence, excluded-evidence summaries, policy state, latency budgets, and output mode, while excluding model-supplied scope, full transcript markers, full KB dump markers, unapproved/stale high-risk evidence text, secrets, and raw PII.
- [x] 2026-05-30: Implemented and hardened Milestone 4 as an additive first-pass conversational eval harness contract in `apps/api/src/conversational-eval-harness.ts` with focused tests in `apps/api/src/__tests__/conversational-eval-harness.test.ts`. The validator requires P0/P1/P2 taxonomy, 30 top-intent coverage, required voice-reality case classes, redacted replay readiness, pass-rate and P1-pass-rate gates, p95 normal-supported latency <= 800 ms, stale high-risk abstain behavior, cross-tenant exposure blocking, frustration escalation handling, mutation denial, prompt-injection non-effect, concise voice answers, interruption handling, and correction handling.
- [x] 2026-05-30: Implemented Milestone 5 as an additive first-pass Shadow/Dual-Read Decision Matrix contract in `apps/api/src/shadow-dual-read-decision-matrix.ts` with focused tests in `apps/api/src/__tests__/shadow-dual-read-decision-matrix.test.ts`. The matrix classifies Retell-answerable/Own-KB-gap, Own-KB-only potential improvement, same answer, different answer requiring review, expected abstain, and KB-expansion-needed cases; promotion is blocked on Own-KB coverage gaps, unresolved P0/P1, missing fingerprints, duplicate fingerprints, insufficient intent coverage, unreviewed answer conflicts, unreviewed high-risk freshness/risk conflicts, and neither-answerable cases without an abstain/KB decision.
- [x] 2026-05-30: Implemented Milestone 6 as an additive first-pass Rollout, Cost, and Cleanup Controls contract in `apps/api/src/rollout-cost-cleanup-controls.ts` with focused tests in `apps/api/src/__tests__/rollout-cost-cleanup-controls.test.ts`. The validator separates rollout and cleanup blockers, requires trusted 0.5B evidence, Milestones 1A-1I, Product KPI gates, Ultra-Low-Latency SLO, exception-path SLO reporting, no unresolved Shadow/Dual-Read P0/P1, closed transcript coverage gaps, 7-day latency window, rollback, kill switch, Retell-KB standby, cost budget/spend/alert controls, strict canary-vs-primary decisions, 14 clean canary days for primary, no unresolved P1/SLO/KPI/governance regressions, 14-30 day Retell-KB standby, and protected Retell-KB cleanup rules.
- [x] 2026-05-30: Reconciled milestone detail statuses with the completed first-pass evidence for Milestones 2, 2C, 2D, 2E, 2F, 3, 3B, 4, 4D, 4E, 5, and 6. These sections now distinguish additive type/test-only contract completion from future live wiring, production fixture coverage, storage, dashboards, and canary work.
- [x] 2026-05-30: Re-verified the current first-pass architecture/rollout contract surface after the plan consistency pass. API typecheck passed, and 58 focused tests passed across architecture drift, runtime contracts/adapters, ContextContract, conversational eval, Shadow/Dual-Read, Product KPI, and rollout/cost/cleanup controls.
- [x] 2026-05-30: Re-ran the 0.5B artifact gate in report-only mode after the plan consistency pass. It still fails closed with `promotionEvidenceUsable=false`, `APPROVED_BENCHMARK_ARTIFACT_MISSING`, and next action `provide_explicit_0_5b_artifact`; no promotion benchmark evidence was produced.
- [x] 2026-05-30: Hardened 0.5B QA label-import CSV structure after review. CSV imports now require the exact benchmark labeling header with no missing, unexpected, duplicate, or out-of-order columns before approval can turn an artifact into `0.5B`. API typecheck passed, and 93 focused benchmark/rollout/architecture tests passed.
- [x] 2026-05-30: With user permission, regenerated the local test/demo transcript 0.5B pack using a temporary local DB TLS no-verify setting for that QA command only, replaced placeholder metadata with opaque question IDs, SHA-based question fingerprints, and non-placeholder `test_intent_*` names, then imported the QA CSV with explicit approval metadata. The resulting local candidate artifact is accepted structurally for milestone `0.5B`, has artifact hash `5f077e6c249d1fcf7b1271e640c529edb54b6124501c0d87723c3129e807e8c1`, and has no artifact blockers. It is still not promotion evidence: `promotionEvidenceUsable=false`, decision remains `keep_retell_primary`, and report blockers remain for missing same-question Retell baseline metrics, canonical voice-latency timestamps, quality/P0/P1/abstain/hallucination/auditability/safety labels, Recall@5 labels, Own-KB answerability/latency gates, and canary/primary rollout gates.
- [x] 2026-05-30: Added a safe Own-KB diagnostic merge path for 0.5B artifacts. Diagnostic merges can fill only Own-KB retrieval metrics such as `kbContextMs`, answerability, and recall for no-snippet not-answerable cases; they cannot fabricate QA labels, Retell metrics, auditability, safety labels, or voice timestamps, and they downgrade approval to `DRAFT_ONLY` until the changed artifact is explicitly re-approved. The re-approved local test/demo candidate has artifact hash `c0bb2aed1de450467dfc82ee81a0bd0956e643c07f74653c4dac5c62aab61cb3`, still reports `promotionEvidenceUsable=false`, still recommends `keep_retell_primary`, and now exposes the concrete Own-KB latency blocker `OWN_KB_FTS_FIRST_P95_ABOVE_100MS` with p95 about 708 ms.
- [x] 2026-05-30: Hardened 0.5B benchmark logic after independent architecture/voice review. Own-KB can no longer become a global canary candidate when Retell-KB is materially faster even if Own-KB has slightly higher quality labels; Recall@5 labels must be bounded to 0..1 in CSV import, artifact validation, and report metrics; Own-KB diagnostic imports require matching question fingerprints, reject duplicate diagnostic rows, reset dependent QA/safety labels on changed diagnostics, and surface STT/TTT/TTS split latency metrics in provider reports.
- [x] 2026-05-30: Hardened tenant-safety scaffolding after independent security review. Own-KB shadow-gap diagnostics now verify supplied `runId` values against the requested org/tenant before reading shadow results, and DB readiness now fails when KB RLS policies do not reference both `org_id` and `tenant_id`.
- [x] 2026-05-30: Re-verified after the 0.5B and tenant-safety hardening loop. API typecheck passed, the full API test suite passed with 84 files / 686 tests, and the local 0.5B diagnostic candidate still validates only as non-promotional report evidence: artifact accepted, decision `keep_retell_primary`, `promotionEvidenceUsable=false`, 30 report blockers, 5 canary blockers, 4 primary blockers, Own-KB KB/FTS p95 about 708 ms, and no invalid Recall@5 labels.
- [x] 2026-05-30: Added sanitized Own-KB authoring gap reporting so the remaining test-transcript source-authoring blocker is actionable without exposing caller content. The current local 50-row authoring CSV reports 0 valid rows and exactly 50 rows needing evidence-backed answers, source titles, human approval, and placeholder-note cleanup; no Own-KB source JSON or promotion evidence was produced.
- [x] 2026-05-30: Added a non-promotional Own-KB simulation/enrichment loop for the transcript-derived authoring CSV. It creates a deterministic local-business expert review pass, transcript-derived intent/risk/evidence hypotheses, and synthetic everyday-call scenarios while marking every output `syntheticOnly`, `DRAFT_ONLY`, and `promotionEvidenceUsable=false`.
- [x] 2026-05-30: Extended the non-promotional authoring enrichment with source-requirement grouping and a fact-intake template. The current local run produced 9 source requirement rows and a blank human-fill template for approved/current facts; it still creates no Own-KB source JSON, no business facts, no approval, and no 0.5B promotion evidence.
- [x] 2026-05-30: Ran an independent review/fix pass on the authoring-enrichment loop. Clarified that the JSON report and source/fact templates are text-free while the local expert-enrichment CSV intentionally includes redacted questions for human authoring, and clarified that trusted 0.5B safety-precondition paths are not usable promotion evidence.
- [x] 2026-05-30: Added fail-closed fact-intake validation for the generated source template. The validator checks source metadata, freshness, reviewer handle, approval status, prompt-injection, operational-detail, placeholder, and spreadsheet-formula risks while writing no Own-KB sources and creating no business facts.
- [x] 2026-05-30: Hardened fact-intake validation with source-requirement coverage checks. A filled fact-intake CSV must cover every required evidence category exactly once, with no missing, duplicate, or extra evidence needs, before it can be considered source-reviewed input.
- [x] 2026-05-30: Added fail-closed Fact-Intake-to-KnowledgeSource JSON generation. Validated batches can write sources only after row validation and source-requirement coverage pass; the current blank template writes an empty array, creates no business facts, and remains non-promotional.
- [x] 2026-05-30: Hardened Fact-Intake-to-KnowledgeSource generation after local review. Even fully valid rows cannot generate sources unless a source-requirements CSV is supplied and coverage passes; the focused test suite now proves the no-requirements path fails closed.
- [x] 2026-05-30: Hardened authoring and Fact-Intake-to-KnowledgeSource generation after contextless review. Source text containing detectable PII/redaction tokens is rejected, partial or structurally invalid source-requirements CSVs cannot unlock source generation, raw row-to-source helpers are no longer exported, and source rows must be `approved` rather than merely `verified`.
- [x] 2026-05-30: Hardened the older Own-KB source-authoring path to match Fact-Intake source generation. Test-transcript authoring source rows now require `approved`, the raw row-to-source helper is private, and source output remains available only through the validated batch builder.
- [x] 2026-05-30: Closed final independent source-generation blockers. Transcript-derived authoring can no longer emit Own-KB `KnowledgeSource` JSON, Fact-Intake requires `sourceVersionHash === sha256(sourceText)`, synthetic `DRAFT_ONLY` source-requirement CSVs are template coverage only, and both authoring/fact-intake CLIs now write `[]` and exit nonzero unless source generation is explicitly ready.
- [x] 2026-05-30: Closed follow-up contextless source-generation review. Fact-Intake source generation now requires a branded server-derived `TrustedScope`, a signed approval manifest bound to the exact fact-intake/source-requirements hashes, matching Own-KB source metadata, and an approval secret; generated sources carry org/tenant scope and remain `promotionEvidenceUsable=false`.
- [x] 2026-05-30: Hardened Fact-Intake approval custody. Source generation now rejects weak or whitespace-only approval secrets and rejects approval manifests where the manifest approver is also the source-row reviewer, preserving reviewer separation before any `KnowledgeSource` JSON can be emitted.
- [x] 2026-05-30: Closed synthetic source-requirements bypass. Generated `DRAFT_ONLY` source-requirements CSVs are now template coverage only and cannot unlock `KnowledgeSource` JSON; source generation requires reviewed non-synthetic source requirements marked `SOURCE_REQUIREMENTS_REVIEWED`.
- [x] 2026-05-30: Added additive Own-KB source-import readiness contract scaffolding. `apps/api/src/own-kb-source-import-contract.ts` validates that any later `KnowledgeSource` JSON import is scoped to branded server `TrustedScope`, blocked without DB/RLS/PII/approval/source-requirement/scoped-repository gates, rejects stale/unapproved/high-risk/PII/auto-refresh/hash-drift sources plus synthetic/draft/promotion markers, accepts Fact-Intake generated source JSON before payload status normalization, and always remains `promotionEvidenceUsable=false`. Independent review found and the fix closed the residual synthetic/draft marker bypass. Architecture-drift tests now keep the contract DB-free/non-promotional and keep authoring/fact-intake validators away from direct DB ingestion imports. A context-light re-review accepted the targeted regex guardrail after fixing a harmless `crypto.createHash(...).update(...)` false positive; it remains a focused guardrail, not a substitute for DB/RLS/readiness gates. Verification passed: API typecheck, focused architecture/source-import/fact-intake tests with 3 files / 50 tests, full API tests with 86 files / 729 tests. No DB write path, production behavior, runtime flag, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.
- [x] 2026-05-30: Added `own-kb:source-import-readiness` as a sanitized dry-run readiness reporter for future reviewed `KnowledgeSource` JSON. The CLI never accepts CLI-supplied org/tenant/agent/call scope as trusted, runs without a server `TrustedScope` as fail-closed reporting only, excludes source content from stdout/output reports, returns nonzero when import readiness is not proven, and remains covered by architecture-drift DB/promotion shortcut checks. This is not a DB import path and never creates 0.5B promotion evidence. Context-light review accepted the CLI as fail-closed, sanitized, side-effect-free, non-promotional, and covered by architecture-drift guardrails. Verification passed: API typecheck, focused source-import/architecture tests with 4 files / 53 tests, full API tests with 87 files / 732 tests.
- [x] 2026-05-30: Added and hardened additive Own-KB source-import planning contract in `apps/api/src/own-kb-source-import-plan.ts`. It reuses the import-readiness contract, requires branded server `TrustedScope`, emits only sanitized scoped `upsert_reviewed_source_version` operation metadata, hashes source IDs as `sourceIdHash`, excludes raw source IDs/names/content from JSON output, returns no operations unless readiness passes, keeps `promotionEvidenceUsable=false`, and remains covered by architecture-drift DB/promotion shortcut and plan-contract checks. This is not a DB write path and does not ingest sources. Context-light review first flagged raw `sourceId` leakage and insufficient plan-specific drift coverage; both were fixed and re-review found no blockers. Verification passed: API typecheck, focused source-import/architecture tests with 5 files / 58 tests, and full API tests with 88 files / 737 tests.
- [x] 2026-05-30: Hardened Milestone 2C intent-playbook validation so draft, synthetic, promotion-marked, TODO, placeholder, dummy, `template_*`, `draft_only`, `DRAFT_ONLY`, `syntheticOnly`, `promotionEvidenceUsable`, and similar snake_case/camelCase template markers cannot satisfy top-intent readiness. This protects future real top-30 playbook work from accidentally treating generated templates as canary-quality voice behavior evidence. Context-light review first found content-level marker bypasses; the fix closed them and re-review found no blockers. Verification passed: API typecheck, focused intent/confirmation/eval/QA/architecture tests with 5 files / 44 tests, and full API tests with 88 files / 739 tests.
- [x] 2026-06-10: Hardened the local DrKalla RAG KB/catalog quality surface after expert-perspective review. Product rows now preserve product kind, customer-facing brand, real external brand where known, constant shop name, product line, price/variant data, product URL, generated image hints, aliases, and descriptions. `Dr.Kalla Cosmetics` is always the shop/house brand fallback, technical supplier labels such as `CJ Dropshipping` are not customer-facing brands, and Wella/Koleston can be inferred from product titles when vendor metadata is missing. Verification passed with 1000/1000 local KB-audit cases, 1000/1000 memory A/B simulation cases, focused DrKalla tests, and API typecheck. This is local KB/agent evidence only; no Retell-KB live sync, production behavior, rollout flag, or Own-KB promotion evidence was created.
- [x] 2026-06-12: Added a gated DrKalla Custom Runtime Canary path for Retell Custom LLM. The API now has a Retell-compatible WebSocket response route with `response_type=response`, `/{call_id}` support, secret-gated path auth, short OpenAI timeout/fallback behavior, and a separate dry-run-first sync script for a standalone custom-LLM canary agent. Verification passed with local WebSocket smoke tests, 150 focused Retell/DrKalla tests, API typecheck, a sanitized Retell dry-run, and 1000/1000 memory A/B simulation cases. No phone number was reassigned, no Retell-KB was changed, and no live custom-runtime sync was executed; live canary remains blocked until the new server code is deployed and a persistent `DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET` is configured.
- [x] 2026-06-12: Closed a Custom Runtime Canary review finding: the Retell WebSocket route must keep short-term memory across messages in the same call session, not recreate memory per `response_required` event. The route now carries per-socket DrKalla memory, keeps TrustedScope server-internal, treats the Retell `call_id` only as provider correlation, and injects only a compact bounded memory line so directive budget and latency discipline remain intact. Verification passed with the new two-turn local WebSocket memory test, 151 focused Retell/DrKalla tests, API typecheck, and 1000/1000 memory A/B simulation cases. The A/B report now marks custom-runtime memory effective while still blocking live readiness on Retell-managed prompt limits and lack of explicit live sync approval; no phone number, Retell-KB, runtime flag, or live agent sync changed.
- [x] 2026-06-12: Hardened the DrKalla Custom Runtime Canary WebSocket gate before any live canary step. The route now rejects configured secrets shorter than 16 characters, keeps memory isolated per WebSocket session, and has focused tests proving one call session can remember two inaudible turns while a separate session starts fresh. Verification passed with 153 focused Retell/DrKalla/architecture tests, API typecheck, and 1000/1000 memory A/B simulation cases (`memoryP95Ms` 0.1, no extra KB calls). No phone number, Retell-KB, runtime flag, or live custom-runtime sync changed.
- [x] 2026-06-12: Created the separate Retell `DrKalla Custom Runtime Canary` agent through the dry-run-first sync path. The sync report confirms the canary uses `responseEngineType=custom-llm`, has a masked WebSocket URL, and has `phoneAssigned=false`; a follow-up dry-run now reports `action=update`, proving the canary exists. A public WebSocket smoke returned 404, so no webcall was started: the live test remains blocked until the new API route is deployed and the same persistent canary secret is configured on the live server. No existing phone number, Retell-KB, production DrKalla agent, or rollout flag changed.
- [x] 2026-06-12: Deployed the Live API with the DrKalla Custom Runtime Canary route and configured the persistent canary secret on the live server. Deploy used the existing Docker path with Retell sync skipped, so existing Retell agents, phone assignments, and Retell-KB were not changed. Public health returned 200 after startup, the custom-LLM WebSocket smoke succeeded with a Retell-compatible `response` message in about 500 ms, and the separate `DrKalla Custom Runtime Canary` agent was updated after deploy with `phoneAssigned=false`. No canary webcall or phone-number switch was started in this step.
- [x] 2026-06-12: Reviewed the first real DrKalla Custom Runtime Canary webcall. Retell reached the correct custom-LLM canary and ASR captured the user, but the transcript contained no assistant turns because live `response_required` events used numeric `response_id` values while the parser accepted only strings. The route now normalizes safe numeric response IDs to strings and still rejects invalid object IDs fail-closed. Verification passed with focused custom-runtime WebSocket tests, API typecheck, redeploy with Retell sync skipped, public health 200, and a public WebSocket smoke using numeric `response_id` that returned a Retell-compatible `response` in about 374 ms. No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Reviewed the next DrKalla Custom Runtime Canary webcall after the response-ID fix. The canary now produces assistant turns, proving Retell transport and Custom LLM response format work, but the call exposed the next quality gap: the canary repeated the same fallback clarification because live product/RAG/funnel response composition is not yet wired into Custom Runtime. Added the 99%-review implementation plan `docs/superpowers/plans/2026-06-12-turn-taking-endpointing-guard.md` and introduced Milestone 1J as the next runtime-quality layer: deterministic Turn-Taking / Endpointing Guard, no normal-path LLM/KB calls, p95 decision cost <= 20 ms, no authority over facts/tools/end-call/scope. No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Implemented Milestone 1J first pass as a pure deterministic Turn-Taking / Endpointing Guard in `apps/api/src/turn-taking-guard.ts` with focused tests in `apps/api/src/__tests__/turn-taking-guard.test.ts`. It distinguishes complete final utterances, trailing German connectors/fillers, unstable partials, low ASR confidence, inaudible streaks, corrections/interruptions, empty input, and long silence while proving it cannot call LLM/KB, authorize tools, or end calls. TDD evidence included a red test for German `aehm` filler handling before the regex fix. Verification passed with 61 focused voice/runtime/canary tests, API typecheck, and a 1000-case local simulation (`p95DecisionMs` about 0.008 ms, no extra LLM/KB calls). This is not live-wired yet; no phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Wired the Milestone 1J guard into the DrKalla Custom Runtime Canary responder for the safest live-relevant path only: inaudible/repair turns now update short-term memory, return a deterministic human repair prompt, keep `end_call=false`, and skip the model call. TDD evidence first reproduced the bug with red responder/route tests showing two model calls on two `(inaudible speech)` turns; the fix made the same tests green and proves per-session memory escalates from "Wie bitte?" to the second-miss repair while separate sessions start fresh. Verification passed with 65 focused turn-taking/voice-runtime/custom-LLM tests and API typecheck. Wait/delay endpointing behavior and full product/RAG/funnel response composition remain future work; no phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Continued DrKalla A/B hardening for the Custom Runtime fallback path. Added red/green responder tests for empty-model/timeout cases where active product context must not reset to generic category questions: product purchase fallback now offers the active product link by SMS, comparison fallback names the two recent products, and first price fallback follows the normal-buyer/Profi-Zugang SMS choice instead of asking for product category. Verification passed with 81 focused DrKalla/turn-taking tests, API typecheck, and the 1000-case memory A/B matrix (`1000/1000` B passed, A failures remained visible in bugfix categories, `memoryP95Ms=0.1`, no extra KB calls). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Closed the next DrKalla Custom Runtime A/B gap where user-stated product types such as "Ich will eine Haarfarbe" were not remembered before a concrete product was named. Added red/green tests proving the A-side lost `activeProductType` and repeated the generic product/product-type question; the B-side now stores user-stated product type as non-evidence short-term memory, injects bounded `active_product_type`, and uses a product-type fallback asking for brand/variant/need instead of resetting the funnel. Verification passed with 88 focused DrKalla/turn-taking tests, API typecheck, and the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.228`, no extra LLM/KB calls). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Continued the DrKalla A/B loop for German product-type voice variants and active product-type funnel wording. Red tests proved the A-side missed plural requests like "Ich suche Haarfarben" and fell back to the generic product/product-type question; another red test proved the fallback asked for "eine bestimmte Marke" instead of offering an active product-type selection. The B-side now recognizes plural/coloration variants as `Haarfarbe/Farbcreme`, keeps the product-type funnel active for follow-up brand/selection questions, and offers a short selection by brands/variants/nuances without resetting to category discovery. Verification passed with 92 focused DrKalla/turn-taking tests, API typecheck, and the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.1`, no extra LLM/KB calls). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Extended the DrKalla product-type A/B loop from hair color into additional catalogue-level voice requests. Red tests proved the A-side did not recognize "Blondierung", "Farbentferner", "Haarglättung", "Haarspray", or "Salonwagen" as active product-type context and fell back to generic discovery. The B-side now keeps these as bounded non-evidence `active_product_type` memory (`Blondierung`, `Farbentferner`, `Haarglättung`, `Styling`, `Salonmöbel/-ausstattung`) and routes follow-up selection/brand questions through the active product-type funnel without extra LLM/KB calls. Verification passed with 107 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.1`, no extra LLM/KB calls), and full API tests (`933/933`). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Extended the DrKalla product-type A/B loop into specific haircare catalogue requests. Red tests proved the A-side missed `Shampoos`, `Haarmasken`, `Conditioner`, `Leave-in`, and `Haarserum` as specific active product-type context or collapsed them into broad `Haarpflege`; the B-side now keeps them as bounded non-evidence `active_product_type` memory (`Shampoo`, `Haarmaske`, `Conditioner/Spülung`, `Leave-in`, `Serum`) and routes follow-up selection/brand questions through the active product-type funnel without extra LLM/KB calls. Verification passed with 122 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.106`, no extra LLM/KB calls), and full API tests (`106` files / `948` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Extended the DrKalla product-type A/B loop into plural Friseur-Tool voice requests. Red tests proved the A-side missed `Kämme`, `Bürsten`, and `Scheren` and reset to the generic product/product-type question; the B-side now keeps them as bounded non-evidence `active_product_type=Friseur-Tool` and routes follow-up selection/brand questions through the active product-type funnel without extra LLM/KB calls. Verification passed with 131 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.107`, no extra LLM/KB calls), and full API tests (`106` files / `957` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Extended the DrKalla product-type A/B loop into plural Salon-Ausstattung voice requests. Red tests proved the A-side missed `Wascheinheiten`, `Friseurstühle`, `Ablagen`, and `Stehmatten` and reset to the generic product/product-type question; the B-side now keeps them as bounded non-evidence `active_product_type=Salonmöbel/-ausstattung` and routes follow-up selection/brand questions through the active product-type funnel without extra LLM/KB calls. Verification passed with 143 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.1`, no extra LLM/KB calls), and full API tests (`106` files / `969` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Extended the DrKalla product-type A/B loop into Dauerwelle Styling voice requests. Red tests proved the A-side missed `Dauerwellenlösung`, `Dauerwelle`, and `Dauerwellenmittel` and reset to the generic product/product-type question; the B-side now keeps them as bounded non-evidence `active_product_type=Styling` and routes follow-up selection/brand questions through the active product-type funnel without extra LLM/KB calls. Verification passed with 152 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.1`, no extra LLM/KB calls), and full API tests (`106` files / `978` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Extended the DrKalla product-type A/B loop into Farbkarte voice requests. Red tests proved the A-side missed `Farbkarten`, `Farbkarte`, and `Koleston Farbkarte` and reset to the generic product/product-type question; the B-side now keeps them as bounded non-evidence `active_product_type=Farbkarte` and routes follow-up selection/brand questions through the active product-type funnel without extra LLM/KB calls. Verification passed with 161 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.1`, no extra LLM/KB calls), and full API tests (`106` files / `987` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Extended the DrKalla product-type A/B loop into color-service tool accessory requests. Red tests proved the A-side missed `Färbeschalen`, `Färbepinsel`, `Alufolie`, and `Strähnenfolie` and reset to the generic product/product-type question; the B-side now keeps them as bounded non-evidence `active_product_type=Friseur-Tool` and routes follow-up selection/brand questions through the active product-type funnel without extra LLM/KB calls. Verification passed with 173 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.1`, no extra LLM/KB calls), and full API tests (`106` files / `999` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Extended the DrKalla product-type A/B loop into electrical/barber tool requests. Red tests proved the A-side misclassified `Glätteisen` as `Haarglättung` and missed `Föhn`, `Haartrockner`, and `Shaver`; the B-side now keeps them as bounded non-evidence `active_product_type=Friseur-Tool` and routes follow-up selection/brand questions through the active product-type funnel without extra LLM/KB calls. Verification passed with 185 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.1`, no extra LLM/KB calls), and full API tests (`106` files / `1011` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Extended the DrKalla product-type A/B loop into German clipper/shaver tool requests. Red tests proved the A-side missed `Rasierer`, `Barttrimmer`, `Haarschneidemaschinen`, and `Schneidemaschinen` and reset to the generic product/product-type question; the B-side now keeps them as bounded non-evidence `active_product_type=Friseur-Tool` and routes follow-up selection/brand questions through the active product-type funnel without extra LLM/KB calls. Verification passed with 197 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.648`, no extra LLM/KB calls), and full API tests (`106` files / `1023` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Extended the DrKalla product-type A/B loop into German salonwagen synonyms. Red tests proved the A-side missed `Friseurwagen`, `Rollwagen`, and `Arbeitswagen` and reset to the generic product/product-type question; the B-side now keeps them as bounded non-evidence `active_product_type=Salonmöbel/-ausstattung` and routes follow-up selection/brand questions through the active product-type funnel without extra LLM/KB calls. Verification passed with 206 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.186`, no extra LLM/KB calls), and full API tests (`106` files / `1032` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Extended the DrKalla product-type A/B loop into German wash-place salon-equipment requests. Red tests proved the A-side missed `Waschbecken`, `Waschplatz`, and `Rückwärtswaschbecken` and reset to the generic product/product-type question; the B-side now keeps them as bounded non-evidence `active_product_type=Salonmöbel/-ausstattung` and routes follow-up selection/brand questions through the active product-type funnel without extra LLM/KB calls. Verification passed with 215 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.228`, no extra LLM/KB calls), and full API tests (`106` files / `1041` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Extended the DrKalla product-type A/B loop into `Ablagetisch` salon-equipment requests. Red tests proved the A-side missed `Ablagetisch` and `Ablagetische` and reset to the generic product/product-type question despite the local KB containing `Tutor Black Ablagetisch`; the B-side now keeps them as bounded non-evidence `active_product_type=Salonmöbel/-ausstattung` and routes follow-up selection/brand questions through the active product-type funnel without extra LLM/KB calls. Verification passed with 221 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.243`, no extra LLM/KB calls), and full API tests (`106` files / `1047` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Extended the DrKalla product-type A/B loop into barber-chair salon-equipment requests. Red tests proved the A-side missed `Barberstühle` and `Friseursessel`, while the A/B matrix also lacked `Salonstühle` coverage; the B-side now keeps `Barberstühle`, `Friseursessel`, and `Salonstühle` as bounded non-evidence `active_product_type=Salonmöbel/-ausstattung` and routes follow-up selection/brand questions through the active product-type funnel without extra LLM/KB calls. Verification passed with 230 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.298`, no extra LLM/KB calls), and full API tests (`106` files / `1056` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Extended the DrKalla product-type A/B loop into salon consumable requests. Red tests proved the A-side missed `Spitzenpapier`, `Nackenpapier`, `Friseurumhänge`, and `Handschuhe` and reset to the generic product/product-type question despite the local KB containing those catalog-backed consumables; the B-side now keeps them as bounded non-evidence `active_product_type=Salon-Verbrauchsmaterial` and routes follow-up selection/brand questions through the active product-type funnel without extra LLM/KB calls. Verification passed with 242 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.259`, no extra LLM/KB calls), and full API tests (`106` files / `1068` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Extended the DrKalla product-type A/B loop into barber accessory tool requests. Red tests proved the A-side missed `Rasierpinsel`, `Rasierklingen`, `Haarstaubwedel`, and `Nackenwedel` and reset to the generic product/product-type question despite catalog-backed Barber/Salon accessory rows; the B-side now keeps them as bounded non-evidence `active_product_type=Friseur-Tool` and routes follow-up selection/brand questions through the active product-type funnel without extra LLM/KB calls. Verification passed with 254 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.254`, no extra LLM/KB calls), and full API tests (`106` files / `1080` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Refactored DrKalla user-stated product-type detection into a shared pure detector instead of growing `short-term-memory` regexes. Red tests proved catalog-backed accessory requests for `Sprühflaschen`, `Watteschnur`, `Spiegel`, and `Aufsteller` still reset to the generic product/product-type question; the B-side now detects them through `drkalla-product-type-detector.ts`, keeps bounded non-evidence active product-type state (`Salon-Verbrauchsmaterial` or `Salon-Zubehör`), and keeps the structural guard that product-type alias matching stays outside `drkalla-short-term-memory.ts`. Verification passed with 267 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.304`, no extra LLM/KB calls), and full API tests (`106` files / `1093` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Continued the shared DrKalla product-type detector hardening with additional catalog-backed salon/accessory terms. Red tests proved the A-side missed `Servicewagen`, `Kosmetikwagen`, `Haarsauger`, `Clean All`, `Alligatorclips`, `Hair-Clips`, `HandtÃ¼cher`, and `StrÃ¤hnenhauben`, causing the responder to fall back to the generic product/product-type clarification and the 1000-case A/B matrix to drop to `992/1000`. The B-side now resolves these through `drkalla-product-type-detector.ts` as bounded non-evidence active product-type state (`Salon-ZubehÃ¶r`, `Friseur-Tool`, `Styling`, or `Salon-Verbrauchsmaterial`) without growing memory regexes. Verification passed with 305 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.352`, no extra LLM/KB calls), and full API tests (`107` files / `1131` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Continued the shared DrKalla product-type detector hardening into broader specialty product requests from the current catalog snapshot. Red tests proved the A-side missed `Kosmetikbedarf`, `Depilationszubehoer`, `Hitzeschutz`, `Ampullen`, `Nackenstreifen`, `Haarschaum`, `Bright-Wax`, `Glanz-Spray`, `Laminier-Spray`, `Vorbereitungsshampoo`, `Straehnchenfolie`, `Blond-Booster`, `Desinfektionswagen`, and `UVC Lampe`, causing the responder to fall back to the generic product/product-type clarification and the 1000-case A/B matrix to drop to `986/1000`. The B-side now resolves these through `drkalla-product-type-detector.ts` as bounded non-evidence active product-type state (`Kosmetikbedarf`, `Haarpflege`, `Salon-Verbrauchsmaterial`, `Styling`, `Shampoo`, `Friseur-Tool`, `Blondierung`, or `Salonmoebel/-ausstattung`) without prompt growth or extra calls. Verification passed with 361 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.264`, no extra LLM/KB calls), and full API tests (`107` files / `1187` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-12: Closed the current DrKalla catalog product-type detector audit to zero known misses across the local shop product-type snapshot. Red tests proved the A-side still missed `Depilationswachs`, `Haarpflege`, `Haarkur`, `klaerende Spuelung`, `Neutralshampoo`, `Haarfaerbemittel`, `Einweghandschuhe`, `Stylingwax`, `Gel-Spray`, `Volumen-Puder`, `Accessories`, `Zubehoer`, `Salonbedarf`, `Barber-Bedarf`, `Hair Dryer`, `konischer Heizstab`, plus the final audit misses `Delrin Hair Comb`, `Haarstyling`, `Pflegespuelung`, `Professionelles Salonhandtuch`, and literal `Salon-Verbrauchsmaterial`. The B-side now resolves all 99 unique local catalog product types through the shared pure detector as bounded non-evidence active product-type state without prompt growth, extra LLM calls, or extra KB calls. Verification passed with 443 focused DrKalla/turn-taking tests, API typecheck, the 1000-case memory A/B matrix (`1000/1000` B passed, `memoryP95Ms=0.689`, no extra LLM/KB calls), catalog audit `MISSES 0` / `TOTAL_TYPES 99`, and full API tests (`107` files / `1269` tests). No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-13: Closed the live memory-write gap in the DrKalla Custom Runtime: the responder now derives a deterministic `agent_spoke` event from every reply (model, fallback, and repair) and the WS route feeds real turn sequence numbers, so per-product fact dedupe, link dedupe, the once-only Profi disclosure, and funnel level progression work in real calls instead of only with pre-populated test memories. Added a pure catalog-backed product-name detector (`drkalla-product-name-detector.ts`, startup-loaded alias table, no per-turn IO, no extra LLM/KB calls) so user-named products reach `lastMentionedProduct` in the same turn; shop/brand terms (`Dr.Kalla`, `Dr. Color Cosmetics`) and shared brand/type aliases never resolve to a single product. Hardened end-call strictness with a NOT-farewell guard (red tests proved "leg nicht auf"/"das war noch nicht alles" previously became end-call candidates), aligned the inaudible repair ladder to the spec wording ("Wie bitte?" / "Ich habe es akustisch nicht verstanden." / louder-connection), introduced the canonical first-price Profi disclosure + SMS link question with an explicit Profi re-ask path, added a WS stale-response guard plus per-socket turn serialization, replaced spoken internal canary diagnostics with a safe German unavailability sentence, made `promptCompressionNoRegressionPassed` non-vacuous (the 0-case category can no longer fake the gate), extended per-product fact kinds with usage/brand/category/link, and gitignored `apps/api/tmp/` so raw-PII call artifacts cannot be committed. Verification: API typecheck, 13 focused DrKalla/WS suites with 509 tests, 1000/1000 memory A/B matrix (`memoryP95Ms` 0.1, 0 extra LLM/KB calls), KB audit 1000/1000, full API suite green. No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-13: Closed the two biggest custom-runtime gaps for quality and latency. (1) Grounded evidence: new pure `drkalla-product-evidence.ts` builds a startup-loaded structured product fact lookup (price/brand/kind/variants/link, keyed by productId and by the short-term-memory product key hash) from the local catalog snapshot; the canary directives now carry a compact `Evidence (Shop-Datenstand)` line (budget raised 650→800 chars) and the deterministic price fallback states the real catalog price with the once-only Profi disclosure instead of dodging to a link offer. Supplier labels like CJ Dropshipping can never become customer-facing brands. (2) Streaming: the Retell custom-LLM route now streams sentence-buffered `content_complete=false` frames (stale-guarded per frame) with a final tail frame, backed by an OpenAI streaming client with first-token timeout and total stream budget, so TTS can start on the first sentence instead of waiting for the full completion. Also added: deterministic truthful handling of confirmed SMS-link offers while no real SMS tool is wired (model is never asked, no false "sent" claims, plus a hard never-claim-sent prompt line) and sanitized per-turn latency logging (firstFrameMs/totalMs/streamedFrames). Verification: API typecheck, focused evidence/funnel/WS suites green, 1000/1000 memory A/B matrix (`memoryP95Ms` 0.1, 0 extra LLM/KB calls), KB audit 1000/1000, full API suite 110 files / 1309 tests. No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed; live SMS tool wiring and Retell endpointing settings remain approval-gated future work.
- [x] 2026-06-13: Closed the three P1 findings from the independent Codex review of the live agent-turn memory work. (1) Multi-product fact attribution: agent_spoke now carries `productsMentioned`, the reducer attributes each fact to the product in its fact key (never blanket to `lastMentionedProduct`), and both products in a two-product reply become recent products so comparison works. (2) Negation-safe fact marking: per-sentence extraction with a negation guard ("kostet nicht...", "kein 1 Liter", "folgt nicht per SMS" no longer mark facts as answered) plus spelled-out German price detection ("neunundneunzig Euro"). (3) Farewell take-backs: "das wars... ach nein" / "doch nicht" / "eine Sache noch" no longer become end-call candidates. Also fixed the overclaiming A-red test comments (Codex P2), added a detector coverage reporter for duplicate/generic spoken names (Codex P2), and pre-padded detector aliases against the per-turn allocation tail. Red tests reproduced all three P1s before the fixes. Verification: API typecheck, 9 affected suites 406/406, 1000/1000 memory A/B matrix (`memoryP95Ms` 0.1, 0 extra LLM/KB calls), full API suite 1315 tests green. The du/Sie voice-form decision (Codex P2) is deliberately left to the product owner. No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-13: Completed the remaining locally buildable custom-runtime work. (1) Secret-log redaction (local half of the open P0): the Fastify request serializer now masks the canary WS auth secret in `req.url` (path segment and secret/token query params) via `redactDrkallaCanarySecretFromUrl` before any log sink; header-based auth still needs a Retell agent sync later. (2) Gated SMS link executor: behind `DRKALLA_CUSTOM_RUNTIME_SMS_TOOL_ENABLED === 'true'` (exact-true, default off, no live behavior change) a confirmed SMS-link offer now executes through the existing policied `drkalla.send_link` tool endpoint via local injection — live-call verification with verified caller phone, drkalla.com URL allowlist, per-call dedupe, and audit traces all reused; the runtime speaks only truthful outcomes (sent/duplicate/failed), records sent links in memory link dedupe, and never lets the model claim a send. Explicit "Produktlink bitte" choices also trigger it; Profi-Zugang link sending stays on the truthful not-wired text until a canonical Profi URL is provided. (3) Ambiguous product names (Codex P2 follow-up): duplicate catalog spoken names are now detected by `buildDrkallaAmbiguousProductNameDetector` and answered deterministically with a variant clarification plus `pendingClarification` memory instead of silent zero detection or generic discovery. Verification: API typecheck, 7 affected suites 296/296, 1000/1000 memory A/B matrix (`memoryP95Ms` 0.259, 0 extra LLM/KB calls), full API suite 1320 tests green. No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, live deploy state, or OpenAI Realtime implementation changed; enabling the SMS executor in the live canary requires explicit approval plus deploy.
- [x] 2026-06-13: Prepared the approved DrKalla Custom Runtime Canary deploy. (1) Sie voice pass: all deterministic customer-facing custom-runtime texts (fallbacks, SMS outcomes, ambiguous-name clarification, third repair step) now use consistent Sie form, the model system prompt instructs Sie, and a regression test asserts deterministic replies never contain du-form. (2) Deploy artifact provisioning: the two catalog snapshots (products + voice aliases; public shop data, no caller PII) moved to tracked `apps/api/data/drkalla-rag/`, the API Dockerfile copies them into the runtime image, and the snapshot loaders resolve env override → tracked data path (container and local cwd) → local tmp, all fail-soft. Verification: API typecheck, 8 suites 406/406, 1000/1000 memory A/B matrix (`memoryP95Ms` 0.144, 0 extra LLM/KB calls). Retell sync stays skipped, SMS live flag stays off, no phone routing or Retell-KB change; server-side deploy execution and the speak-and-listen webcall validation are handed to the operator per approval.
- [x] 2026-06-13: Added deterministic silence handling to the DrKalla Custom Runtime. Previously the WS route ignored every interaction type except `response_required`, so a Retell `reminder_required` (caller went silent) produced dead air. The route now answers reminders with a context-aware Sie-form re-engagement (`nextDrkallaNoInputReminder`): first nudge re-engages on the active product/product-type or asks a generic helper question, a repeated nudge escalates to a softer closing line, and the silence counter resets when the caller speaks again. No model call, no KB call, and `end_call` stays false on silence (Retell still owns the hard silence timeout). Reminder turns claim arrival order so a barge-in drops a stale nudge, and the spoken nudge is reduced into short-term memory. Verification: API typecheck, 6 affected suites 280/280 (incl. new pure-function, reply-builder, and route escalation/reset tests), 1000/1000 memory A/B matrix (`memoryP95Ms` 0.169, 0 extra LLM/KB calls), full API suite 1325 tests green. No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-13: Verified the gated DrKalla SMS-link path end to end before live enablement. Confirmed the WS executor's `app.inject` payload (`{ call: { call_id }, args }`) resolves the call id through `getRetellCall` and reaches the policied `drkalla.send_link` endpoint correctly. Added an integration test (`drkalla-custom-runtime-sms-integration.test.ts`) that wires the custom-runtime WS route and the real send_link webhook on one Fastify app with mocked Retell `getCall`/`sendSms`: a confirmed offer sends the catalog product link to the verified caller `from_number` (never a model-supplied number), per-call dedupe reports "schon geschickt" on a repeat, and with the flag off no SMS is sent and no false "geschickt" claim is made. Verification: API typecheck, the 3-case integration suite green, full API suite 1328 tests. Important: the live flag `DRKALLA_CUSTOM_RUNTIME_SMS_TOOL_ENABLED=true` is a server env var that must be set on the deployed runtime — it cannot be set from the dev workstation, and real SMS only fire on real phone calls (a browser webcall has no caller `from_number`). No live flag was changed, no SMS was sent, and no phone routing, Retell-KB, Own-KB primary, rollout flag, or OpenAI Realtime implementation changed.
- [x] 2026-06-13: Deployed the DrKalla Custom Runtime Canary to the live server (existing Docker path, Retell sync + public-demo sync skipped, clean fast-forward, no phone routing / no SMS flag change) and ran live canary smokes. Findings: deploy clean, API healthy, both catalog snapshots present in the image, canary route answers in consistent Sie form. Root cause for the prior all-fallback behavior found and fixed: the server `OPENAI_API_KEY` was rejected with 401, so the model always returned empty; installed a validated key and the model now streams real answers. Live latency over 6 turns (server-logged): first-safe-audio ~563-752 ms (under the 800 ms p95 ceiling, but above the 500 ms p50 goal — model TTFT-bound), totalMs ~756-934 ms, streamed 6/6. Also found the 700 ms first-token timeout aborted the stream before the first token; raised it (env on server + code default now 1500 ms first-token / 3500 ms stream-total) so the model actually answers. Two open quality gaps surfaced live: (1) P1 grounding — the custom runtime feeds no contact/opening-hours facts, so the model invented "9 bis 18 Uhr" vs the KB's 10-18; (2) product-name detector recall is too strict for partial spoken names ("Evelon Pro Hairspray" misses), so price/brand evidence does not attach. SMS live sending stayed off; no phone number, Retell-KB, production agent, Own-KB primary flag, or rollout flag changed. Next: ground contact/hours + improve detector recall, then tune for the 500 ms p50 target (faster first token).
- [ ] Milestone 0.5B: Trusted Retell-KB vs Own-KB benchmark execution after Milestone 1A, 1B, 1D, and 1E; real transcript/shadow/call-log/eval artifact storage also requires Milestone 1C when potential PII is present.
- [x] Milestone 1A: TrustedScope for `knowledge.search`.
- [x] Milestone 1B: Trace scope correctness.
- [x] Milestone 1C: PII redaction purpose separation.
- [x] Milestone 1D: DB scope/RLS/readiness validation.
- [x] Milestone 1E: Voice Latency Measurement Contract.
- [x] Milestone 1F: Own-KB to Retell-KB Sync Contract.
- [x] Milestone 1G: Voice Compliance and Disclosure Controls.
- [x] Milestone 1H: German Voice Output Normalization Contract.
- [x] Milestone 1I: STT / TTT / TTS Voice Pipeline Contract.
- [complete first pass + repair canary wiring] Milestone 1J: Turn-Taking / Endpointing Guard.
- [complete first pass] Milestone 2C: Intent Playbooks for Top Real Calls.
- [complete first pass] Milestone 2D: Tool Confirmation State Machine.
- [complete first pass] Milestone 2E: Business Hours and Holiday Resolver.
- [complete first pass] Milestone 2F: Runtime Degradation Matrix.
- [complete first pass] Milestone 3B: KB Ingestion Prompt-Injection Red-Team Suite.
- [complete first pass] Milestone 4: P0/P1 Conversational Eval Harness.
- [complete first pass] Milestone 4D: German Audio Chaos Eval Suite.
- [complete first pass] Milestone 4E: Human QA and Labeling Workflow.
- [complete first pass] Milestone 5: Shadow/Dual-Read Decision Matrix.
- [complete first pass] Milestone 6: Rollout, Cost, And Cleanup Controls.
- [x] 2026-05-29: Incorporated external review findings as plan-only updates: voice latency measurement contract, Retell-KB auditability wording, Own-KB to Retell-KB sync contract, compliance/disclosure controls, KB ingestion red-team suite, and product KPIs.
- [x] 2026-05-29: Added final Voice Reality coverage as plan-only milestones for German voice normalization, intent playbooks, tool-confirmation state, business-hours/holiday resolution, runtime degradation, German audio chaos evals, human QA/labeling, and product KPI refinements.
- [x] 2026-05-30: Added STT / TTT / TTS Voice Pipeline boundaries as a plan-only Milestone 1I so speech-to-text, text reasoning/response composition, text-to-speech, and runtime interaction are separately measured and governed.

## Surprises & Discoveries

- Observation: Own-KB smoke proved retrieval reachability but not coverage quality.
  Evidence: live shadow smoke returned 10 questions, 0 answerable, p95 about 715 ms.
- Observation: `knowledge.search` has org/tenant ambiguity in the OpenAI/tool execution path.
  Evidence: current Milestone 1A exists to require trusted `orgId` and server-derived scope.
- Observation: Retell and OpenAI Realtime both expose enough runtime control to absorb business logic if adapters are not kept thin.
  Evidence: source register below.
- Observation: Supabase table exposure and RLS posture must be treated as production controls, not documentation-only guidance.
  Evidence: source register below.
- Observation: Retell-KB is not just a temporary dependency; it is the current production latency benchmark.
  Evidence: Retell documents automatic per-response KB retrieval and states KB retrieval is optimized for real-time use with generally under 100 ms latency impact.
- Observation: Own-KB may be valuable as governance/control plane even if Retell-KB remains the runtime retriever.
  Evidence: Own-KB adds source approval, freshness, risk, tenant scope, eval evidence, auditability, and provider-neutral fallback that Retell-KB alone does not prove.
- Observation: external review exports can leak operational detail if repo-hygiene or historical files are copied wholesale.
  Evidence: `CLAUDE.md` and historical notes can contain useful low-level repo guidance mixed with deployment or operational context that is not needed for external architecture review.
- Observation: a fast first audible token can game the 500-800 ms SLO if it is filler-only.
  Evidence: the voice SLO measures caller experience, so generic filler must be reported separately from evidence-backed answers, targeted clarifications, valid abstains, valid escalations, policy confirmations, and task-relevant tool status updates.
- Observation: Retell auto-refresh and auto-crawl can bypass Own-KB governance unless they are explicitly routed back through Own-KB ingestion and approval.
  Evidence: a governed Retell-KB runtime retriever is only safe if the active runtime content maps to approved/current Own-KB source versions.
- Observation: DrKalla catalog completeness improves fastest when every shop product type is audited against the shared voice product-type detector.
  Evidence: the 2026-06-12 detector audit reduced local catalog product-type misses from 35 to 0 across 99 unique product types without prompt growth, extra LLM calls, or extra KB calls.
- Observation: Milestone 1A confirmed the tool boundary needed hardening, not only documentation.
  Evidence: `executeKnownTool` now requires a branded server-derived `TrustedScope` for `knowledge.search`, and tests cover missing scope, model-supplied scope fields, same-tenant/different-org, same-org/different-tenant, and cross-tenant sentinel cases.
- Observation: earlier Own-KB tenant-lineage constraints were present as `NOT VALID`, which is useful for additive rollout but not enough for promotion evidence.
  Evidence: Milestone 1D added a follow-up migration that validates the scope constraints and adds missing scope/performance indexes so readiness can fail on unsafe existing data.
- Observation: `kb_eval_runs` needs a scoped-run exception for global synthetic runs, while stored `kb_eval_results` must carry hard org/tenant scope.
  Evidence: the live catalog-readiness checker was tightened to allow `kb_eval_runs` only through the validated `kb_eval_runs_scope_required_chk` constraint and to require non-null `kb_eval_results.org_id` and `kb_eval_results.tenant_id`.
- Observation: a German voice agent can pass text/RAG/security checks and still fail in real calls if spoken formatting, confirmations, business-hours logic, degradation behavior, audio chaos, and human QA are not explicitly planned.
  Evidence: final Voice Reality review added milestones for spoken normalization, top-intent playbooks, confirmation state, holiday/opening-hours resolution, runtime degradation, audio chaos evals, and labeling workflow.
- Observation: PII redaction needed purpose-specific call sites, not only a shared regex helper.
  Evidence: Milestone 1C found and replaced local tool-output regex sanitizers plus generic redaction in trace, shadow, eval, prompt/training, and Retell persistence paths with explicit purpose helpers.
- Observation: Trace scope correctness needed explicit field separation because existing trace storage uses `tenantId` as an org-isolation key.
  Evidence: Milestone 1B added `orgId`, `tenantScopeId`, `callId`, `provider`, provenance, and retrieval correlation fields while preserving the legacy org-based trace stamp for fail-closed reads.
- Observation: raw `voiceE2eMs` fields are too easy to misinterpret or game without the full timestamp contract.
  Evidence: Milestone 1E added canonical timestamp evaluation and connected Retell-vs-Own-KB benchmark samples to the contract so missing timestamps or `filler_only` audio cannot satisfy SLO readiness.
- Observation: Retell-KB sync needs a contract even before any runtime sync rollout changes.
  Evidence: Milestone 1F added deterministic sync eligibility, state metadata, idempotency, audit-event planning, and blockers for unapproved, expired, unsafe, disallowed, or externally refreshed Retell runtime content.
- Observation: existing recording/retention behavior needed a canonical compliance readiness layer before canary decisions.
  Evidence: Milestone 1G added policy-source, disclosure, consent, retention, deletion, minimization, audit-event, and prompt-only-compliance gates plus tests against existing recording/retention paths.
- Observation: German voice quality needs deterministic output normalization beyond prompt reminders.
  Evidence: Milestone 1H added written/spoken text separation and tests for weekday ranges, opening hours, dates, prices, phone numbers, emails, URLs, addresses, acronyms, and review-required names.
- Observation: voice failures need layer attribution, not only one generic voice-quality label.
  Evidence: Milestone 1I now separates STT/ASR input, TTT text reasoning/response planning, TTS/spoken output, and runtime interaction so evals can distinguish wrong transcript, wrong reasoning, wrong spoken output, and turn-taking/transport failures.
- Observation: source-generation approval is a security boundary, not a spreadsheet convenience.
  Evidence: follow-up contextless review first found a plain-scope CLI blocker; after the fix and re-review, source output is bound to branded `TrustedScope`, exact input hashes, HMAC-signed approval manifests, and non-promotional markers. Remaining risks are operational secret custody/rotation, reviewer separation, and downstream RLS/import enforcement.
- Observation: HMAC signatures are only meaningful if secret quality and reviewer separation are enforced.
  Evidence: Fact-Intake source generation now rejects approval secrets shorter than 32 non-whitespace characters and rejects approval manifests where `approvedBy` matches any source row `reviewerHandle`.
- Observation: reviewed source content still needs reviewed source-requirement coverage.
  Evidence: source-requirements validation now rejects generated `syntheticOnly=true` / `DRAFT_ONLY` rows for source generation; only `syntheticOnly=false` / `SOURCE_REQUIREMENTS_REVIEWED` requirements can satisfy the coverage gate.
- Observation: Milestone 0.5B must fail closed when approved benchmark/eval artifacts are absent.
  Evidence: repo discovery did not find an approved Retell-vs-Own-KB benchmark artifact; `own-kb-benchmark-artifact` now accepts only explicit 0.5B-approved artifacts and otherwise produces no promotion evidence.
- Observation: existing Retell/Own-KB data is useful for diagnosis but not sufficient for 0.5B promotion evidence.
  Evidence: the latest local diagnostic matched 10 existing shadow samples to Retell calls; Own-KB remained 10/10 not answerable with p95 715 ms, while Retell-KB latency was observable on only 4 matched samples with p95 78 ms. The run lacks an approved artifact, 50 paired questions, 30 intents, and quality labels.
- Observation: 0.5B code can drift from the stricter plan gate even when the prose is correct.
  Evidence: the report implementation still trusted promotion evidence with only TrustedScope and DB/RLS gates; it now requires TrustedScope, Trace Scope Correctness, DB/RLS/readiness, and Voice Latency Measurement Contract gates before promotion evidence is trusted.
- Observation: the remaining 0.5B blocker is partly procedural, not only technical.
  Evidence: Codex can generate a reviewable draft artifact template, but it cannot ethically create human approval, real quality labels, sufficient real coverage, or answerability evidence by itself.
- Observation: fail-closed benchmark tooling should still be actionable for QA.
  Evidence: the artifact CLI now returns sanitized `gapReport.nextActions` such as providing an explicit validated 0.5B artifact, obtaining human approval metadata, filling coverage, attaching canonical voice-latency timestamps, completing quality labels, and proving auditability.
- Observation: 0.5B approval metadata is not safe enough without a deliberate PII classification.
  Evidence: the label-import path now keeps approval attempts as `DRAFT_ONLY` unless `containsPotentialPii` is explicitly set; the CLI rejects approval flags that omit that classification.
- Observation: 0.5B label imports need row-integrity checks before approval is accepted.
  Evidence: label imports now require every artifact sample to have exactly one matching CSV row before a CSV-imported artifact can become `0.5B`; duplicate, unmatched, or missing rows keep the artifact draft-only or fail the approval CLI.
- Observation: QA needs a gap report immediately after importing labels, not only after a separate validation command.
  Evidence: `own-kb:benchmark-apply-labels` can now write a sanitized candidate gap report with `--gap-output` and optional safety-gates input; the generated report shows remaining blockers without raw samples or caller content.
- Observation: label-import stdout should not disclose sample keys.
  Evidence: the CLI now emits `duplicateRowKeyCount`, `unmatchedRowKeyCount`, `missingSampleKeyCount`, and `rowIntegrityPassed` instead of `questionId::provider` arrays; focused tests and a local CLI run verified concrete sample keys are absent from stdout.
- Observation: label-import stdout should not disclose local workspace paths.
  Evidence: `own-kb:benchmark-apply-labels` now emits `artifactWritten` and `gapReportWritten` booleans instead of absolute output paths; silent CLI verification showed JSON stdout contains no workspace path or sample-key strings.
- Observation: benchmark-pack stdout should not disclose local workspace paths either.
  Evidence: `own-kb:benchmark-pack` now emits `outputDirectoryWritten` and logical `filesWritten` keys instead of absolute directories/files; silent CLI verification showed JSON stdout contains no workspace path or sample-key strings.
- Observation: draft-template stdout should not print the full template artifact.
  Evidence: `own-kb:benchmark-template` now emits only `artifactWritten`, paired/sample counts, draft status, and `promotionEvidenceUsable: false`; silent CLI verification with and without `--output` showed no sample-key or workspace-path strings in stdout.
- Observation: boolean data-classification flags should fail closed on invalid values.
  Evidence: `own-kb:benchmark-apply-labels` now rejects non-`true`/`false` values for PII/transcript/shadow/call-log flags; CLI verification with `--contains-potential-pii maybe` fails closed, while explicit `false` succeeds.
- Observation: real transcript, shadow-data, or call-log imports must be treated as potential-PII artifacts.
  Evidence: `own-kb:benchmark-apply-labels` now rejects `--contains-potential-pii false` when any real transcript/shadow/call-log flag is true, and `applyBenchmarkLabelsCsv` keeps the same inconsistent combination `DRAFT_ONLY` if called directly.
- Observation: approved artifact validation needs the same PII/source consistency check as imports.
  Evidence: `buildTrustedBenchmarkReportFromArtifact` now rejects externally supplied approved artifacts with real transcript/shadow/call-log flags and `containsPotentialPii=false` using `BENCHMARK_ARTIFACT_PII_SOURCE_CLASSIFICATION_INCONSISTENT`.
- Observation: imported approval timestamps should be validated before writing `0.5B` artifacts.
  Evidence: `applyBenchmarkLabelsCsv` now requires `approvedAt` to parse as a valid date before setting `approvedForMilestone: 0.5B`; the CLI rejects invalid `--approved-at` values before writing an approved artifact.
- Observation: parseable timestamps are still too loose for promotion evidence.
  Evidence: `isValidBenchmarkApprovalTimestamp` now requires exact UTC ISO timestamps with milliseconds and rejects date-only, offset, missing-millisecond, and normalized-invalid dates; label import and artifact validation share this function.
- Observation: `approvedBy` should not carry PII or operational path-like metadata.
  Evidence: `isValidBenchmarkApproverHandle` now accepts only neutral lowercase handles and rejects emails, names with spaces, paths, and mixed-case values; label import and artifact validation share this function.
- Observation: the available transcript corpus is useful for QA preparation but not enough for promotion evidence.
  Evidence: sanitized inventory found 31 `call_transcripts` rows and 59 user-confirmed test/demo transcripts; real mapped call transcripts yielded only 16 unique redacted question candidates, while demo/test transcripts yielded 102 unique redacted question candidates.
- Observation: Own-KB coverage is currently the limiting factor on the transcript-derived QA pack.
  Evidence: the non-promotional 50-question Own-KB diagnostic returned 0 answerable and p95 about 708 ms; the selected scope has only 1 source version and 2 chunks/embeddings.
- Observation: the selected test-agent config has no configured KnowledgeSources or Retell-KB ID.
  Evidence: sanitized config inspection found `knowledgeSources: 0`, no `retellKnowledgeBaseId`, and no `knowledgeBaseSignature`; a backfill dry-run can only prepare the canonical db facts source with 2 chunks.
- Observation: Retell post-call diagnostics are available for the test calls, but not as same-question Retell-KB retrieval evidence.
  Evidence: 59/59 test calls were retrievable from Retell and 46 had e2e latency data, but none exposed separate `knowledge_base` latency or `knowledge_base_retrieved_contents_url` in the checked response.
- Observation: transcript-derived question candidates should not become Own-KB content just because they are redacted and local.
  Evidence: `own-kb:authoring-validate` requires reviewed answers, source titles, approved status, allowed use/risk, and freshness dates before writing KnowledgeSource JSON; the current local 50-row authoring CSV fails closed with 0 valid rows.
- Observation: remaining Own-KB answerability work needs an actionable local authoring report, not fabricated answers.
- Observation: the transcript-derived enrichment can now tell us what kinds of approved sources are missing, but it still cannot fill the missing facts.
  Evidence: the latest local source-requirement grouping produced 9 required source categories: `service_catalog` for 24 question hashes, `staff_or_human_escalation_policy` for 22, `booking_policy` and `conversation_policy` for 15 each, `business_hours_source`/`holiday_calendar`/`special_hours_source` for 9 each, `price_list` for 3, and `menu_or_product_catalog` for 1. The companion fact-intake template has blank source/fact fields and remains `DRAFT_ONLY`.
- Observation: German ASR/noisy transcript variants can hide obvious intents unless the diagnostic classifier accounts for mojibake and compound forms.
  Evidence: after opening-hours ASR/mojibake hardening, the local enrichment run moved from 7 to 9 `opening_hours` hypotheses and reduced `unknown` from 6 to 4 while staying non-promotional and synthetic-only.
- Observation: "sanitized report" and "local authoring CSV" need separate wording.
  Evidence: independent review found the JSON report, source-requirements CSV, and fact-intake CSV avoid redacted question text, while the expert-enrichment CSV intentionally includes `redactedQuestion` for local human authoring review.
  Evidence: `own-kb:authoring-gaps` now turns the current authoring CSV into a sanitized row/action report with no caller content or redacted question text; the latest run shows 50/50 rows still require evidence-backed answers, concrete source titles, approved review status, and placeholder-note cleanup.
- Observation: simulation can improve QA coverage, but it must not become factual Own-KB evidence.
  Evidence: `own-kb:authoring-enrich` classifies the 50 local test questions into intent/risk/evidence hypotheses and creates 128 synthetic everyday-call scenarios, while the report and generated simulation pack remain `syntheticOnly`, `DRAFT_ONLY`, and `promotionEvidenceUsable=false`.
- Observation: transcript-derived coverage is currently concentrated in local-business call basics, not a complete industry KB.
  Evidence: the enrichment report counts opening-hours, appointment, reservation, pricing, service, clarification, frustration, simulation, and unknown intents; it does not supply approved business facts for prices, hours, services, reservations, or staff availability.
- Observation: a valid-looking authoring row can still be unsafe if the answer or title contains PII or prompt-injection text.
  Evidence: Own-KB authoring validation now blocks detectable PII and common English/German instruction-override patterns before writing `containsPii=false` source JSON.
- Observation: partially valid authoring batches are ambiguous and should not produce partial Own-KB source files.
  Evidence: `buildOwnKbSourcesFromAuthoringRows` now returns sources only when `invalidRows === 0`; CLI verification with `--output` against the current invalid 50-row CSV wrote no source file.
- Observation: duplicate authoring question IDs can make source evidence ambiguous even when every row is otherwise valid.
  Evidence: Own-KB authoring validation now marks every duplicate `questionId` row with `DUPLICATE_QUESTION_ID`, causing the full batch to produce zero sources.
- Observation: an empty authoring file should be a blocker, not a successful no-op.
  Evidence: empty CSV validation now returns `invalidRows: 1`, `AUTHORING_ROWS_REQUIRED: 1`, `sourcesWritten: false`, `promotionEvidenceUsable: false`, and exits non-zero.
- Observation: oversized authoring fields can hide accidental transcript dumps or slow future KB paths.
  Evidence: Own-KB authoring validation now blocks oversized question IDs, redacted questions, answers, source titles, and notes before source generation.
- Observation: authoring CSV header drift can hide bad inputs or extra raw-data columns.
  Evidence: Own-KB authoring validation now requires the exact authoring columns and fails closed on missing or unknown columns before generating any source JSON.
- Observation: accepted mixed-case authoring metadata can drift after source generation.
  Evidence: generated authoring sources now lowercase `allowedUse`, `reviewStatus`, and `risk` while validation remains case-insensitive for authoring ergonomics.
- Observation: source-backed coverage can be inflated by placeholder text or copied questions.
  Evidence: Own-KB authoring validation now blocks placeholder markers such as TODO/fill-me and answers that exactly equal the redacted question.
- Observation: reviewed authoring sources need deterministic version evidence, not only stable IDs.
  Evidence: generated authoring sources now include full SHA-256 `sha256` and `contentHash` values over the generated question/answer content; tests prove content changes alter the hash while the question-derived ID stays stable.
- Observation: invalid authoring runs with `--output` must neutralize stale source files.
  Evidence: `own-kb:authoring-validate` now writes `[]` and reports `outputCleared: true` when validation fails with an output path; CLI verification replaced a seeded stale source file with `[]`.
- Observation: CLI output/report paths can be misconfigured to point at the input CSV or each other.
  Evidence: `own-kb:authoring-validate` now rejects path conflicts before reading or writing; CLI verification with `--output` equal to `--input` failed with `AUTHORING_OUTPUT_PATH_CONFLICT`, and the source CSV remained intact.
- Observation: CSV-authored content may be opened in spreadsheet tools before approval.
  Evidence: Own-KB authoring validation now rejects formula-like field starts (`=`, `+`, `-`, `@`) in redacted question, proposed answer, source title, and notes; current draft CSV still fails only on expected answer/source/review issues.
- Observation: small valid authoring batches could be mistaken for complete transcript-derived coverage.
  Evidence: `own-kb:authoring-validate` now defaults to `--min-rows 50`; below-minimum batches add `AUTHORING_ROW_COVERAGE_BELOW_MINIMUM` as a batch-level invalid issue and produce zero sources.
- Observation: authoring notes are not source content but can still enter local reports or review workflows.
  Evidence: Own-KB authoring validation now scans notes for detectable PII and prompt-injection text; focused tests cover IBAN and instruction-override text in notes.
- Observation: reviewer guidance notes can accidentally remain after answers are filled and hide incomplete QA state.
  Evidence: placeholder detection now includes `fill answer`/`fill source`; the current 50-row draft CSV reports `PLACEHOLDER_CONTENT: 50` in addition to missing answer/source/review blockers.
- Observation: redaction tokens are useful in logs/evals but unsafe as approved KB facts.
  Evidence: Own-KB authoring validation now blocks common redaction tokens in proposed answers, source titles, and notes before generated source content is written.
- Observation: local authoring guidance must be generated with the pack, not hand-maintained after the fact.
  Evidence: `own-kb:benchmark-test-transcripts` now writes the authoring CSV and README guidance; regeneration produced the expected six files and the validator reports the expected draft blockers plus `outputCleared: true`.
- Observation: generated authoring freshness dates inherit risk from loose pack timestamps.
  Evidence: `own-kb:benchmark-test-transcripts --generated-at 2026-05-30` now fails with `GENERATED-AT_MUST_BE_UTC_ISO_WITH_MILLISECONDS`, while `2026-05-30T04:30:00.000Z` regenerates the pack and writes canonical authoring timestamps.
- Observation: the test-transcript draft-pack generator should not produce partial coverage packs.
  Evidence: `--questions 10` now fails with `QUESTIONS_OUT_OF_RANGE_50_200`; requesting 103 questions against the current 102 unique redacted candidates fails with `TEST_TRANSCRIPT_QUESTION_COVERAGE_BELOW_REQUESTED` before writing output.
- Observation: generated redacted-question CSVs can be opened in spreadsheet tools during QA.
  Evidence: `test-transcript-benchmark-pack` helpers now prefix formula-leading CSV cells before quoting; focused tests cover `=`, `+`, `-`, `@`, leading whitespace, and quote escaping.
- Observation: the QA labeling CSV used a separate CSV writer from the test-transcript pack helper.
  Evidence: `buildBenchmarkLabelingCsv` now applies the same formula-leading cell neutralization and has a focused test for formula-like question and intent fields.
- Observation: loose date parsing can make source freshness ambiguous.
  Evidence: Own-KB authoring validation now accepts freshness dates only as exact UTC ISO timestamps with milliseconds and rejects date-only, offset, missing-millisecond, or normalized-invalid values.
- Observation: CSV parsers can silently absorb malformed structure unless the structure is validated before row mapping.
  Evidence: Own-KB authoring validation now fails closed on duplicate columns, malformed quotes, and data rows whose cell count does not match the header; focused tests cover each case.
- Observation: freshness metadata must be ordered, not only parseable.
  Evidence: Own-KB authoring validation now rejects future `verifiedAt` values and `expiresAt` values that are not after `verifiedAt`, preventing future-dated verification from making draft facts look current.
- Observation: redacted transcript questions still need a second local safety pass before pack output.
  Evidence: `own-kb:benchmark-test-transcripts` now skips extracted questions with detectable PII, prompt-injection text, redaction tokens, or spreadsheet-formula starts before writing the question bank or authoring CSV.
- Observation: direct Retell-vs-Own-KB report builders can look like promotion evidence if the approved-artifact gate is not encoded in code.
  Evidence: `buildRetellVsOwnKbDecisionReport` now defaults to diagnostic/shadow behavior and adds `APPROVED_0_5B_ARTIFACT_REQUIRED`; only the artifact validator path passes the approved-artifact override, and architecture-drift tests guard that boundary.
- Observation: canary readiness needs its own blockers, not only primary blockers.
  Evidence: report code now emits `canaryBlockers` for Product KPI hard gates, exception-path SLO reporting, Retell-KB standby, rollback, and kill switch; a report with metric parity but missing canary evidence remains `owkb_shadow_only`.
- Observation: `own_kb_primary` was still activatable through deployment config if rollout allowlists and search flags were set.
  Evidence: `own-kb-rollout.ts` now adds a separate fail-closed primary promotion gate requiring explicit primary deploy unlock, a non-placeholder approved 0.5B artifact ID, SHA-256 evidence, persisted matching attestation, 14 clean canary days, Retell standby, rollback, kill switch, Product KPI, and exception-path SLO evidence before primary deploy can proceed.
- Observation: same-question coverage can be fabricated if pairing uses only a reused `questionId`.
  Evidence: benchmark samples now carry optional `questionFingerprint`; promotion is blocked when paired Retell/Own-KB samples are missing fingerprints, have mismatched fingerprints, or include duplicate provider samples for the same `questionId`.

## Decision Log

- Decision: Implement scope/privacy hardening before Canonical Runtime Contract.
  Rationale: Provider-neutral abstraction is unsafe while retrieval scope and PII handling remain ambiguous.
  Date/Author: 2026-05-29 / Codex plan after external critique.

- Decision: Retell remains production; OpenAI Realtime remains lab/canary.
  Rationale: Provider switch requires the same core, policy, retrieval, response composer, and eval gates.
  Date/Author: 2026-05-29 / Codex plan.

- Decision: `AGENTS.md` is guidance, not enforcement.
  Rationale: Production safety must be enforced by code, DB constraints/RLS, CI/readiness, flags, policy, and deterministic allowlists.
  Date/Author: 2026-05-29 / Codex plan.

- Decision: Milestone 1A and 1D are both P0 for tenant safety.
  Rationale: 1A protects the application/tool boundary from model-supplied scope; 1D proves the database/readiness layer enforces or validates tenant invariants.
  Date/Author: 2026-05-29 / Codex plan after multi-perspective review.

- Decision: Own-KB must not replace Retell-KB in production by assumption.
  Rationale: Retell-KB is the current production latency benchmark; Own-KB must first prove equal or better voice latency, answer quality, and stronger governance on the same realistic questions.
  Date/Author: 2026-05-29 / Codex plan after Retell-KB latency parity review.

- Decision: Own-KB can be governance/control plane while Retell-KB remains runtime retriever.
  Rationale: If Retell-KB stays faster, the best architecture may be Own-KB as source-of-truth/evidence/eval/sync layer plus Retell-KB as low-latency Retell production retriever.
  Date/Author: 2026-05-29 / Codex plan.

- Decision: Milestone 0.5 benchmark results are not promotion evidence until Milestone 1A, 1B, 1D, and 1E pass.
  Rationale: benchmark scaffolding can be built before safety enforcement, but Own-KB benchmark results are only trustworthy for promotion after server-derived tool scope, trace/shadow/eval scope correctness, DB/RLS/readiness tenant invariants, and canonical voice-latency timestamps are proven. If trusted benchmark execution stores or processes real transcripts, shadow data, call logs, or eval artifacts containing potential PII beyond minimal local/dev testing, Milestone 1C must also pass first.
  Date/Author: 2026-05-29 / Codex plan after final external review.

- Decision: Milestone 0.5A decision reports are deterministic scaffolding, not a runtime switch.
  Rationale: `buildRetellVsOwnKbDecisionReport` can classify Retell-KB vs Own-KB evidence without changing production behavior, enabling future benchmark execution while keeping Own-KB primary blocked until safety and parity gates pass.
  Date/Author: 2026-05-29 / Codex implementation.

- Decision: Milestone 0.5A canary/primary decisions require coverage and observed metrics, not only good-looking latency.
  Rationale: Own-KB canary must be blocked when paired question coverage is below 50, unique intents are below 30, high-risk/stale/out-of-scope/German-ASR/interruption coverage is missing, required metrics are absent, P1 pass rate is below 98%, high-risk auditability is insufficient, or slow RAG is used in the normal live path without proving the full e2e budget.
  Date/Author: 2026-05-29 / Codex implementation after review.

- Decision: root authority is limited to `AGENTS.md` and `PLANS.md`.
  Rationale: archived addenda, reviews, old baselines, and chat-derived Markdown must not compete with current Codex instructions.
  Date/Author: 2026-05-29 / Codex plan.

- Decision: `AGENTS.md` and `PLANS.md` must agree on post-1A ordering.
  Rationale: Milestone 1A is accepted as complete; the active ordered path should preserve the TrustedScope invariant and point the next implementation to Milestone 1D, not reopen 1A by stale wording.
  Date/Author: 2026-05-29 / Codex Milestone 1A single-source review.

- Decision: `CLAUDE.md` is not an active Codex implementation input.
  Rationale: Low-level repo hygiene needed by Codex must be mirrored into `AGENTS.md`, `PLANS.md`, or sanitized `REPO_HYGIENE.md`; `CLAUDE.md` must not influence architecture, latency, KB, provider, rollout, security, or production gates.
  Date/Author: 2026-05-29 / Codex plan, tightened by multi-agent 98%-readiness loop.

- Decision: production voice latency target is 500-800 ms e2e for normal supported turns.
  Rationale: `Voice-RAG p95 <= 2200 ms` is too soft for the desired production voice agent and is retained only as legacy/fallback upper bound for exceptional audited paths.
  Date/Author: 2026-05-29 / Codex plan.

- Decision: Retell-KB auditability is useful but not equivalent to Own-KB pre-response governance.
  Rationale: Retell post-call artifacts such as public logs and `knowledge_base_retrieved_contents_url` can support after-the-fact review, but they do not replace server-side approval, freshness, tenant, risk, and allowed-use gates before a high-risk answer is composed.
  Date/Author: 2026-05-29 / Codex plan after external review.

- Decision: voice latency must be measured as a timestamp contract, not a single ambiguous duration.
  Rationale: The 500-800 ms SLO requires consistent capture of user audio end, provider turn detection, ASR partial/final, agent-core start, first model token, first speakable chunk, first safe audio, and first full-answer audio.
  Date/Author: 2026-05-29 / Codex plan after external review.

- Decision: Own-KB to Retell-KB sync is a governed content pipeline, not a blind copy.
  Rationale: Retell-KB may remain the low-latency runtime retriever, but only approved/current Own-KB source versions may sync, and expired/unapproved source versions must update, disable, or remove synced Retell-KB content.
  Date/Author: 2026-05-29 / Codex plan after external review.

- Decision: voice product success gates must include operational KPIs, not only architecture and latency metrics.
  Rationale: A fast and safe agent still fails the product goal if call containment, task completion, escalation quality, interruption recovery, confirmation correction, QA score, KB coverage, answerability, or cost per resolved call are poor.
  Date/Author: 2026-05-29 / Codex plan after external review.

- Decision: Encode the Product KPI measurement contract as a validator before trusting KPI pass booleans in rollout gates.
  Rationale: Product KPI pass/fail must not be inferred from a single flag. Canary expansion needs explicit hard-gate coverage, baselines, sample sizes, tolerances, budget-band source, and neutral owner approval; missing data must be inconclusive and rollout-blocking. Milestone 6 rollout evidence now requires a hard-gate-ready KPI report as well as the rollout gate boolean.
  Date/Author: 2026-05-30 / Codex Product KPI contract.

- Decision: external review exports must be sanitized.
  Rationale: plan review packets need architecture and milestone context, not deployment targets, SSH paths, server IPs, production commands, coordination memory, historical secret incident details, or secret-adjacent operational detail.
  Date/Author: 2026-05-29 / Codex plan after final external review.

- Decision: Retell-KB auto-refresh and auto-crawl are governance boundaries.
  Rationale: runtime content synced from Own-KB must not change outside Own-KB approval, versioning, hashing, risk, allowed-use, and freshness checks.
  Date/Author: 2026-05-29 / Codex plan after final external review.

- Decision: architecture-drift checks should start as lightweight CI/tests before large refactors.
  Rationale: static import/path checks, schema assertions, and ContextContract snapshot assertions can prevent provider-specific logic, model-supplied scope, full transcripts, and mutating semantics from drifting into the core.
  Date/Author: 2026-05-29 / Codex plan after final external review.

- Decision: Canary and Primary are separate gates.
  Rationale: `owkb_canary_candidate` may allow only canary preparation/start; Own-KB primary requires `owkb_primary_candidate`, a clean canary window, Product KPI hard gates, rollback/kill switch, Retell-KB standby, and no unresolved P0/P1/latency/governance gaps.
  Date/Author: 2026-05-29 / multi-agent 98%-readiness loop.

- Decision: Active Codex implementation inputs are closed to `AGENTS.md` and `PLANS.md`.
  Rationale: repo hygiene guidance must be mirrored into authoritative docs or sanitized `REPO_HYGIENE.md`; active implementation runs should not require `CLAUDE.md`.
  Date/Author: 2026-05-29 / multi-agent 98%-readiness loop.

- Decision: `knowledge.search` requires branded server-derived `TrustedScope`.
  Rationale: model/tool arguments are untrusted and must never provide or override org, tenant, agent, call, customer identity, or authorization context.
  Date/Author: 2026-05-29 / Codex Milestone 1A implementation.

- Decision: the lower-level Own-KB retrieval API also requires branded `TrustedScope`.
  Rationale: hardening only the model/tool wrapper is not enough; every `knowledgeSearch` invocation must prove server-derived scope before retrieval, logging, or citations can run.
  Date/Author: 2026-05-29 / Codex Milestone 1A final acceptance.

- Decision: Milestone 1D starts with additive DB/readiness enforcement and remains open until live catalog posture is verified.
  Rationale: static migration checks and focused tests can prevent drift, but production readiness also needs catalog-backed confirmation of RLS, grants, validated constraints, views, RPC/functions, and service-role access posture.
  Date/Author: 2026-05-29 / Codex Milestone 1D implementation.

- Decision: Milestone 1D is accepted after live target-database readiness passed.
  Rationale: the additive migration validated Own-KB tenant-lineage constraints, added missing org/tenant scope indexes, hardened `kb_eval_results` to non-null scope, and the live catalog-readiness CLI returned `ok: true` with no failures.
  Date/Author: 2026-05-29 / Codex Milestone 1D acceptance.

- Decision: Voice Reality coverage is a first-class plan requirement, not a polish bucket.
  Rationale: German phone calls require TTS-safe factual normalization, intent-specific playbooks, confirmation state, holiday/opening-hours correctness, degradation handling, audio/ASR chaos evals, and human QA labels before canary expansion can be trusted.
  Date/Author: 2026-05-29 / Codex plan after final Voice Reality review.

- Decision: DrKalla product RAG should use a general structured product catalog, not narrow special-case indexes.
  Rationale: Callers may ask for any product type, brand, variant, product link, price, application, or follow-up within the active product/category context. A row-like catalog surface with product kind, customer-facing brand, external brand where known, constant shop name, product line, price/variant fields, URL, image hints, aliases, and descriptions is less brittle than hair-color-only indexes. `Dr.Kalla Cosmetics` is the shop/house brand fallback when no external brand is known, while technical supplier labels such as `CJ Dropshipping` must not become customer-facing brands.
  Date/Author: 2026-06-10 / Codex DrKalla KB quality audit.

- Decision: DrKalla user-stated product types stay in the active product-type funnel.
  Rationale: Once a caller asks for a concrete product type such as hair color, blonding, salon equipment, shampoo, mask, conditioner, leave-in, or serum, the agent should not reset to a higher-level product-category discovery question. Short-term memory may store this as non-evidence dialogue state, while actual product facts, prices, brands, links, and availability still require KB/catalog evidence.
  Date/Author: 2026-06-12 / Codex DrKalla A/B hardening.

- Decision: DrKalla catalog product-type coverage is owned by the shared detector plus audit loop, not by prompt growth.
  Rationale: The local shop snapshot contains many product-type labels and mixed German/English catalog terms. Keeping recognition in `drkalla-product-type-detector.ts` lets the voice funnel remember caller intent as bounded non-evidence state with p95 sub-millisecond local cost, while product truth still comes from the structured KB/catalog. Prompt-specific prohibitions would be slower to review and easier to regress.
  Date/Author: 2026-06-12 / Codex DrKalla catalog detector hardening.

- Decision: DrKalla Custom Runtime Memory must be introduced through a separate Retell Custom-LLM canary agent, not by mutating the existing Retell-managed DrKalla agent in place.
  Rationale: Retell-managed prompting remains the current live-safe path, while effective per-turn short-term memory requires server-side custom runtime control. A separate custom-LLM canary preserves rollback, avoids phone-number reassignment, and lets the team compare latency/quality before any live route switch.
  Date/Author: 2026-06-12 / Codex DrKalla custom-runtime canary implementation.

- Decision: DrKalla Custom Runtime WebSocket memory is session-scoped per Retell call connection.
  Rationale: Recreating memory per `response_required` message would make the canary look wired while losing the actual short-term dialogue state. The route must keep memory in the WebSocket session, update it after each turn, and expose only compact non-evidence state to the model.
  Date/Author: 2026-06-12 / Codex DrKalla custom-runtime session-memory hardening.

- Decision: PII redaction is purpose-specific, with user-visible confirmation separated from logs/traces/evals/shadow.
  Rationale: logs, traces, evals, shadow results, prompts, tool arguments, and tool results must not store raw PII by accident, while voice confirmations still need an explicit policy-controlled path that can preserve caller-provided values when the user must hear them back.
  Date/Author: 2026-05-29 / Codex Milestone 1C implementation.

- Decision: Trace events must carry explicit org and tenant scope fields.
  Rationale: the legacy trace field `tenantId` is actually the org-isolation key; adding `orgId` and `tenantScopeId` prevents future shadow/eval/canary evidence from making cross-org or cross-tenant data look same-scope.
  Date/Author: 2026-05-29 / Codex Milestone 1B implementation.

- Decision: `first_safe_audio_at` is SLO-eligible only with task-relevant safe audio.
  Rationale: generic filler such as "one moment" may be useful as a separate UX signal, but it must not satisfy the 500-800 ms normal supported voice-turn SLO or hide a slow final audited answer.
  Date/Author: 2026-05-29 / Codex Milestone 1E implementation.

- Decision: Own-KB governed Retell-KB sync is deterministic infrastructure, never a model decision.
  Rationale: only approved/current source versions with governed refresh/crawl posture may become active Retell-KB runtime content; unsafe source-state changes produce deterministic disable/remove work.
  Date/Author: 2026-05-29 / Codex Milestone 1F implementation.

- Decision: voice compliance must be policy state plus audit readiness, not prompt text.
  Rationale: required AI disclosure, recording consent, retention, deletion, minimization, and audit events must be testable before canary expansion; copying compliance language into prompts is not sufficient.
  Date/Author: 2026-05-29 / Codex Milestone 1G implementation.

- Decision: German voice normalization belongs in a provider-neutral contract.
  Rationale: Agent Core needs deterministic `writtenText`/`spokenText` output and audit metadata, while provider-specific pronunciation dictionaries, SSML, and phoneme workarounds must stay inside runtime/adapters.
  Date/Author: 2026-05-29 / Codex Milestone 1H implementation.

- Decision: STT, TTT, TTS, and runtime interaction are separate voice pipeline boundaries.
  Rationale: a voice failure can come from ASR/STT, text reasoning/response composition, spoken-output/TTS, or runtime interaction/turn-taking. The plan must make these layers separately measurable so latency and quality evidence cannot collapse them into one ambiguous "voice" metric.
  Date/Author: 2026-05-30 / Codex plan-only STT/TTT/TTS boundary update.

- Decision: Milestone 0.5B benchmark execution requires an explicit approved artifact gate.
  Rationale: completed Milestone 1 guardrails make benchmark evidence eligible in principle, but Codex must not infer or fabricate Retell-vs-Own-KB promotion evidence from smoke data, old exports, or missing artifacts.
  Date/Author: 2026-05-29 / Codex Milestone 0.5B artifact-gate implementation.

- Decision: local Retell-vs-Own-KB diagnostics are not promotion evidence.
  Rationale: credentials and existing production/shadow data can reveal latency and coverage gaps, but promotion requires a deliberately approved 0.5B artifact with sufficient same-question coverage, intent distribution, labels, and PII controls.
  Date/Author: 2026-05-30 / Codex 0.5B diagnostic.

- Decision: 0.5B report code must mirror the active promotion-evidence gate exactly.
  Rationale: plan text alone is not enough; `buildRetellVsOwnKbDecisionReport` now sets `promotionEvidenceTrusted` only when Milestone 1A TrustedScope, Milestone 1B Trace Scope Correctness, Milestone 1D DB/RLS/readiness, and Milestone 1E Voice Latency Measurement Contract gates pass.
  Date/Author: 2026-05-30 / Codex 0.5B gate hardening.

- Decision: 0.5B may have draft artifacts, but only approved artifacts can produce promotion evidence.
  Rationale: draft templates reduce manual setup work while preserving the gate that only real same-question measurements, quality labels, coverage metadata, and explicit human approval can become trusted benchmark evidence.
  Date/Author: 2026-05-30 / Codex 0.5B blocker reduction.

- Decision: 0.5B gap reports must be sanitized.
  Rationale: QA needs actionable blocker detail, but artifact validation output must not print raw samples, transcripts, call IDs, or caller content.
  Date/Author: 2026-05-30 / Codex 0.5B gap-report implementation.

- Decision: 0.5B approval requires explicit PII classification.
  Rationale: an approved Retell-vs-Own-KB artifact may involve real transcripts, shadow data, call logs, or eval artifacts; approval without an explicit `containsPotentialPii` value is ambiguous and must not become promotion evidence.
  Date/Author: 2026-05-30 / Codex 0.5B approval-path hardening.

- Decision: 0.5B CSV-import approval requires complete row integrity.
  Rationale: duplicate, unmatched, or partial QA rows make the imported benchmark artifact ambiguous; partial label work can be saved as draft, but it must not become a trusted 0.5B artifact.
  Date/Author: 2026-05-30 / Codex 0.5B import-integrity hardening.

- Decision: 0.5B CSV-import approval requires exact benchmark labeling headers.
  Rationale: row integrity is insufficient if a spreadsheet export adds, removes, duplicates, or reorders columns. Approval must fail closed unless the CSV header exactly matches the expected benchmark labeling schema, so stale or malformed QA exports cannot accidentally preserve old labels or create trusted benchmark artifacts.
  Date/Author: 2026-05-30 / Codex 0.5B CSV-header hardening.

- Decision: accepted 0.5B artifacts are necessary but still not promotion evidence unless the report gates pass.
  Rationale: user approval can remove the explicit artifact-approval blocker, but it must not satisfy missing Retell same-question measurements, canonical voice-latency timestamps, human quality/safety labels, Own-KB answerability/latency gates, Product KPI gates, rollback, kill switch, or Retell standby requirements. The current approved test/demo candidate proves the artifact path works and still correctly recommends `keep_retell_primary`.
  Date/Author: 2026-05-30 / Codex 0.5B approved-candidate validation.

- Decision: missing Own-KB authoring truth must be reported, not invented.
  Rationale: Codex can make the source-authoring blocker actionable with sanitized row/action reports, but it must not fabricate evidence-backed answers, source titles, human approval, or placeholder cleanup for the test-transcript question bank.
  Date/Author: 2026-05-30 / Codex authoring-gap hardening.

- Decision: transcript simulation is a QA expansion tool, not promotion evidence.
  Rationale: everyday-call simulations can cover noisy/fast/correction/interruption/frustration variants and help expert review, but they must stay `syntheticOnly`/`DRAFT_ONLY` until backed by real same-question measurements, approved sources, and human QA labels.
  Date/Author: 2026-05-30 / Codex simulation-enrichment loop.

- Decision: source-requirement and fact-intake templates guide human authoring; they are not facts.
  Rationale: grouping required evidence by source category makes the 0.5B blocker actionable without inventing business truth. Blank fact-intake templates must be filled from approved/current business sources with source versioning, review status, freshness, risk, and allowed-use metadata before any Own-KB content can be created.
  Date/Author: 2026-05-30 / Codex source-requirement enrichment.

- Decision: report sanitization claims must name artifact scope.
  Rationale: the JSON report and source/fact templates can be safe for high-level review while a separate local authoring CSV intentionally contains redacted questions. Future review exports must not treat the entire local output pack as text-free unless the enrichment CSV is excluded.
  Date/Author: 2026-05-30 / Codex independent enrichment review.

- Decision: fact intake must be validated before source generation.
  Rationale: a blank or partially filled fact-intake template is only a human workflow aid. It must fail closed until it has explicit source title/reference/version/hash, approved review state, canonical freshness timestamps, neutral reviewer handle, safe content, cleared draft markers, and no prompt-injection or operational detail.
  Date/Author: 2026-05-30 / Codex fact-intake validation.

- Decision: fact intake must satisfy source-requirement coverage, not just row validity.
  Rationale: a single valid source row cannot stand in for the full source-authoring blocker. The fact-intake validator now compares filled rows to the generated source-requirements CSV and reports missing, duplicate, or extra evidence needs.
  Date/Author: 2026-05-30 / Codex fact-intake coverage hardening.

- Decision: fact-intake source generation is allowed only after full validation and explicit source-requirement coverage.
  Rationale: generating KnowledgeSource JSON is safe only when the full batch is source-reviewed, current, explicitly approved, sanitized, supplied with source-requirements, and covers every required evidence category exactly once. Blank, partial, unsafe, coverage-incomplete, or no-requirements templates must write an empty array and remain `promotionEvidenceUsable=false`.
  Date/Author: 2026-05-30 / Codex fact-intake source-generation hardening.

- Decision: fact-intake source generation rejects PII, partial source-requirement packs, and non-approved rows.
  Rationale: `KnowledgeSource.containsPii=false` is only safe when source text and metadata are checked for detectable PII/redaction tokens. The source-requirements CSV is also a gate, not a suggestion: it must have generated-style headers, enough rows, complete metadata, draft markers, positive question/hash coverage, and no duplicate evidence needs. `verified` alone is not treated as approval for source generation.
  Date/Author: 2026-05-30 / Codex contextless review hardening.

- Decision: raw Own-KB authoring/fact-intake row-to-source helpers are not public APIs.
  Rationale: source generation must go through validated batch builders so PII checks, approval state, freshness, coverage, duplicate detection, and all-or-nothing output rules cannot be bypassed by importing a low-level mapper.
  Date/Author: 2026-05-30 / Codex source-generation bypass hardening.

- Decision: transcript-derived authoring and synthetic source-requirements templates are not source-generation authority.
  Rationale: redacted test/demo transcripts and generated `DRAFT_ONLY` source-requirements are useful for QA planning, but they are not governed business source versions. Authoring now only produces validation/gap/template artifacts, and Fact-Intake source JSON remains blocked unless a signed, trusted-scope-bound approval manifest matches the exact fact-intake and source-requirements hashes.
  Date/Author: 2026-05-30 / Codex independent contextless source-generation review.

- Decision: Fact-Intake approval manifests must be trusted, signed, and hash-bound before source JSON can be emitted.
  Rationale: a self-declared approval manifest is not enough to create governed Own-KB sources. Source generation now requires branded `TrustedScope`, an HMAC signature using an approval secret, exact fact-intake and source-requirements SHA-256 matches, matching source IDs/hashes/reviewer metadata, and non-promotional markers. Plain CLI-supplied `orgId`/`tenantId` is rejected. Approval secret custody, rotation, and reviewer separation remain operational controls to enforce before live ingestion.
  Date/Author: 2026-05-30 / Codex follow-up contextless source-generation review.

- Decision: Fact-Intake source generation requires minimum approval-secret strength and reviewer separation.
  Rationale: an HMAC signature made with a weak or blank secret does not prove custody, and the same reviewer approving both source content and the manifest weakens the approval boundary. Source generation now rejects approval secrets with fewer than 32 non-whitespace characters and rejects manifests where `approvedBy` equals any source-row `reviewerHandle`.
  Date/Author: 2026-05-30 / Codex approval-custody hardening.

- Decision: synthetic source-requirements CSVs are not source-generation coverage authority.
  Rationale: generated source requirements are useful to show what humans must author, but they are not themselves a reviewed coverage artifact. Fact-Intake source generation now requires reviewed non-synthetic source requirements with `approvedForMilestone=SOURCE_REQUIREMENTS_REVIEWED`; generated `DRAFT_ONLY` requirements produce `SOURCE_REQUIREMENTS_ROW_INVALID` and cannot unlock sources.
  Date/Author: 2026-05-30 / Codex source-requirements authority hardening.

- Decision: Own-KB source JSON import must be gated before any DB write path can use it.
  Rationale: generating `KnowledgeSource` JSON is not enough to make it safe for ingestion. A downstream source-import readiness contract now requires branded server `TrustedScope`, matching org/tenant scope on every source, DB/RLS/readiness and PII gates, verified approval manifest and reviewed source requirements, scoped service-role repository use, current approved metadata, no high-risk/PII/auto-refresh content, matching content hashes, and no residual synthetic/draft/promotion markers. The contract is additive scaffolding only and never creates 0.5B promotion evidence.
  Date/Author: 2026-05-30 / Codex source-import readiness hardening.

- Decision: source-authoring and source-import architecture-drift tests are targeted guardrails, not the ingestion authority.
  Rationale: static text checks are useful to keep authoring, fact-intake, and import-readiness code away from direct KB DB writes and promotion shortcuts, but they can miss dynamic or renamed paths. DB/RLS/readiness, scoped repository use, TrustedScope, PII, approval, and import-readiness gates remain the authority before any real ingestion.
  Date/Author: 2026-05-30 / Codex context-light architecture-drift re-review.

- Decision: source-import readiness CLI is a dry-run report surface, not an authority boundary or ingestion path.
  Rationale: a local CLI cannot create branded server `TrustedScope` or prove service-role scoped repository use. The CLI can help humans see import blockers for reviewed `KnowledgeSource` JSON, but it must fail closed, reject CLI-supplied scope-like fields, omit source content from reports, return nonzero unless readiness is proven by the contract, and never mark benchmark promotion evidence usable.
  Date/Author: 2026-05-30 / Codex source-import readiness CLI hardening.

- Decision: source-import planning emits sanitized operation metadata only.
  Rationale: a future DB importer should consume a scoped repository boundary, not ad hoc source JSON or model/tool arguments. The first-pass planner therefore reuses the readiness contract, requires branded `TrustedScope`, emits org/tenant-scoped operation metadata without source text, source names, or raw source IDs, and returns no operations unless readiness passes. Source IDs are hashed in the plan because identifiers can contain PII. It is not an ingestion implementation and cannot create 0.5B promotion evidence.
  Date/Author: 2026-05-30 / Codex source-import plan hardening.

- Decision: intent-playbook readiness must reject templates and draft markers.
  Rationale: Milestone 2C is only useful if future top-30 playbook content is real tenant/industry behavior, not generated placeholder prose. The validator now blocks draft/synthetic/promotion markers plus TODO, placeholder, dummy, template, draft, synthetic, `DRAFT_ONLY`, `syntheticOnly`, `promotionEvidenceUsable`, and snake_case/camelCase marker text before playbooks can be considered ready.
  Date/Author: 2026-05-30 / Codex intent-playbook placeholder hardening.

- Decision: Own-KB diagnostic merges must downgrade artifact approval until re-approved.
  Rationale: merging diagnostic data changes the artifact hash and evidence contents. Even safe retrieval-only metrics must not inherit a prior approval by accident; the changed artifact must return to `DRAFT_ONLY` and can become `0.5B` again only through the explicit label/approval path. Diagnostic metrics may reduce unknowns, but they must not fabricate QA labels, Retell same-question evidence, auditability, safety labels, voice timestamps, or promotion evidence.
  Date/Author: 2026-05-30 / Codex 0.5B diagnostic-merge hardening.

- Decision: Retell-KB latency parity is an independent global Own-KB canary gate.
  Rationale: Own-KB must reach or beat Retell-KB on realistic voice latency and quality before becoming a global runtime canary or primary. A slightly higher Own-KB quality label must not compensate for materially worse latency in the global decision report; high-risk Retell auditability gaps may justify targeted routing or shadow investigation, but not a global Own-KB canary recommendation by themselves.
  Date/Author: 2026-05-30 / Codex independent voice-review hardening.

- Decision: Recall@5 and diagnostic provenance must be bounded evidence, not free-form labels.
  Rationale: Recall@5 is a rate and must be between 0 and 1. Own-KB diagnostic imports must match the artifact question fingerprint, reject duplicate diagnostics, and reset dependent QA/safety labels after changing retrieval evidence so stale labels cannot travel with new diagnostic metrics.
  Date/Author: 2026-05-30 / Codex independent security-review hardening.

- Decision: Shadow-gap diagnostics and DB readiness must prove tenant scope, not only accept scoped inputs.
  Rationale: a caller-provided `runId` is untrusted until it is resolved against the requested org/tenant, and RLS being enabled is not enough if there is no tenant-scope policy. Diagnostics and readiness checks now fail closed on cross-scope shadow runs and missing org/tenant RLS policy evidence.
  Date/Author: 2026-05-30 / Codex independent security-review hardening.

- Decision: 0.5B label imports should emit sanitized gap reports when requested.
  Rationale: QA needs immediate, repeatable blocker feedback after merging labels, while reports must avoid sample text, caller content, call IDs, secrets, and operational details.
  Date/Author: 2026-05-30 / Codex 0.5B import-gap-report wiring.

- Decision: 0.5B label-import stdout must be sample-key-safe.
  Rationale: even synthetic-looking `questionId::provider` keys can become sensitive or correlatable in real QA workflows; command output should expose counts and status, while detailed keys stay in local internal data structures.
  Date/Author: 2026-05-30 / Codex 0.5B import-output sanitization.

- Decision: 0.5B label-import stdout must avoid local path disclosure.
  Rationale: external review exports and pasted CLI output should not expose workspace paths or internal file layout; output booleans are enough to confirm that artifacts were written.
  Date/Author: 2026-05-30 / Codex 0.5B import-output path sanitization.

- Decision: 0.5B benchmark-pack stdout must avoid local path disclosure.
  Rationale: pack generation creates local files, but command output copied into review should not reveal the workspace path or local file layout; logical file keys are enough for operator feedback.
  Date/Author: 2026-05-30 / Codex 0.5B pack-output path sanitization.

- Decision: 0.5B draft-template stdout must be summary-only by default.
  Rationale: template files contain synthetic sample IDs and are meant to be written to local scratch files, not pasted into external review logs; stdout should communicate status without dumping artifact contents.
  Date/Author: 2026-05-30 / Codex 0.5B template-output sanitization.

- Decision: 0.5B data-classification CLI flags must be strict booleans.
  Rationale: mistyped values such as `maybe` must not silently fall back to false/undefined for PII, transcript, shadow-data, or call-log classification.
  Date/Author: 2026-05-30 / Codex 0.5B data-classification flag hardening.

- Decision: real transcript/shadow/call-log 0.5B artifacts imply potential PII.
  Rationale: benchmark artifacts derived from real calls or shadow/eval data are inherently PII-risky and must not be approved as non-PII through a mistaken flag combination.
  Date/Author: 2026-05-30 / Codex 0.5B PII/source consistency hardening.

- Decision: 0.5B artifact validation must reject real-call source data marked non-PII.
  Rationale: import-time checks are not enough; approved artifacts may be supplied externally, so the validator must independently enforce PII/source consistency before any promotion report can be trusted.
  Date/Author: 2026-05-30 / Codex 0.5B artifact-validation hardening.

- Decision: 0.5B label-import approval timestamps must be valid at import time.
  Rationale: writing an artifact marked `0.5B` with an invalid approval timestamp creates ambiguous evidence even if later validation would reject it.
  Date/Author: 2026-05-30 / Codex 0.5B approval timestamp hardening.

- Decision: 0.5B approval timestamps must be exact UTC ISO with milliseconds.
  Rationale: `Date.parse` accepts too many ambiguous forms; benchmark approval evidence should be timezone-explicit, canonical, and shared across CLI import and artifact validation.
  Date/Author: 2026-05-30 / Codex 0.5B canonical approval timestamp hardening.

- Decision: 0.5B approval approvers must be neutral handles.
  Rationale: approval metadata should not contain emails, personal names, paths, or operational details; a stable reviewer handle is sufficient for evidence linkage while keeping exports safer.
  Date/Author: 2026-05-30 / Codex 0.5B approver metadata hardening.

- Decision: Start Milestone 2 with the type-only canonical runtime contract before adapter mappings.
  Rationale: 0.5B promotion execution is blocked without an approved artifact, while the first Milestone 2 step can safely encode provider-neutral event/command boundaries after architecture-drift checks exist and pass. Adapter mappings, Retell fixture wiring, and OpenAI Realtime lab stubs remain future work.
  Date/Author: 2026-05-30 / Codex Milestone 2 contract hardening.

- Decision: Expand Milestone 2 with isolated provider fixture adapters before live adapter refactors.
  Rationale: golden Retell/OpenAI same-turn normalization can prove provider parity and adapter thinness without changing production behavior. The fixture adapters intentionally avoid SDK imports, network calls, policy imports, and provider-side tool execution.
  Date/Author: 2026-05-30 / Codex Milestone 2 fixture parity.

- Decision: Lock Milestone 2 fixture adapters behind architecture-drift checks until explicit live wiring work.
  Rationale: fixture adapters are useful contract evidence, but accidental live imports would change provider behavior before the rollout gates. Static tests now keep them test-only and prevent provider SDK, policy, tool, Agent Runtime, or Own-KB imports inside the adapters.
  Date/Author: 2026-05-30 / Codex Milestone 2 adapter isolation hardening.

- Decision: Encode Milestone 2C as a first-pass intent-playbook validation contract while 0.5B remains blocked.
  Rationale: The 0.5B runner still fails closed without an explicit approved artifact, so no benchmark promotion evidence can be produced. A type/test-only 2C contract can safely define the shape and readiness gates for top real call playbooks without changing production runtime behavior, Retell-KB, Own-KB primary state, or OpenAI Realtime features.
  Date/Author: 2026-05-30 / Codex Milestone 2C first-pass contract.

- Decision: Encode Milestone 2D as a pure additive confirmation state-machine contract before runtime mutation refactors.
  Rationale: Mutating voice tools need deterministic confirmation, policy approval, idempotency, interruption, correction, failure, and replay semantics before provider-neutral runtime code can safely execute them. A pure type/test-only contract records those rules without changing production tool behavior.
  Date/Author: 2026-05-30 / Codex Milestone 2D first-pass contract.

- Decision: Encode Milestone 2E as a source-versioned business-hours resolver contract before opening-hours answers are promoted.
  Rationale: Opening-hours answers are caller-visible and time-sensitive; static pinned context can become stale. A pure resolver contract can fail closed unless approved/current `Europe/Berlin` evidence with `expires_at`, source version, holidays, special hours, and closures is present.
  Date/Author: 2026-05-30 / Codex Milestone 2E first-pass contract.

- Decision: Encode Milestone 2F as a runtime-degradation matrix validator before canary expansion.
  Rationale: Dependency outages should produce deterministic safe behavior instead of latency stalls, guesses, or false tool-success claims. A pure matrix validator can require explicit user wording, escalation, logging, kill-switch/flag, retry/deadline, metrics, and disposition rules without changing runtime behavior.
  Date/Author: 2026-05-30 / Codex Milestone 2F first-pass contract.

- Decision: Encode Milestone 3B as a KB-ingestion prompt-injection red-team suite contract before canary KB expansion.
  Rationale: KB content is untrusted evidence, not instruction. A fixture-suite validator can prove coverage for hidden text, metadata, instruction blocks, encoding smuggling, tool-policy overrides, cross-tenant bait, and multilingual injection before parser/context wiring is promoted.
  Date/Author: 2026-05-30 / Codex Milestone 3B first-pass contract.

- Decision: Encode Milestone 4D as a German audio-chaos eval contract before treating text evals as voice quality evidence.
  Rationale: A German phone agent can produce correct text while failing ASR, TTS, interruption, correction, or runtime behavior. The eval contract must split text correctness from voice-pipeline success and require DACH/noise/correction/frustration coverage.
  Date/Author: 2026-05-30 / Codex Milestone 4D first-pass contract.

- Decision: Encode Milestone 4E as a human-QA labeling workflow contract before trusting eval trends.
  Rationale: Retell-vs-Own-KB, voice chaos, and conversational eval reports are only useful if labels are consistent, versioned, representative, adjudicated, and PII-controlled. The workflow contract makes label readiness a gate instead of an informal spreadsheet habit.
  Date/Author: 2026-05-30 / Codex Milestone 4E first-pass contract.

- Decision: Encode Milestone 3 as a deterministic ContextContract builder before replacing live prompt assembly.
  Rationale: Agent Core should receive a compact, scope-safe, redacted, evidence-filtered snapshot instead of implicit prompt concatenation. A pure builder and snapshot tests prove the contract excludes full transcripts, full KB dumps, stale/unapproved high-risk facts, model-supplied scope, secrets, and raw PII before runtime wiring begins.
  Date/Author: 2026-05-30 / Codex Milestone 3 first-pass contract.

- Decision: Encode Milestone 4 as a first-pass conversational eval harness contract before treating retrieval reachability as voice-agent quality.
  Rationale: correct retrieval is not enough for a phone agent. A pure validator can require top-intent coverage, P0/P1/P2 taxonomy, redacted replay readiness, latency budgets, concise German voice behavior, stale-evidence abstain, cross-tenant exposure blocking, frustration escalation handling, interruption/correction handling, mutation denial, and prompt-injection resistance before eval reports are used for canary review.
  Date/Author: 2026-05-30 / Codex Milestone 4 first-pass contract.

- Decision: Encode Milestone 5 as a first-pass Shadow/Dual-Read Decision Matrix before rollout decisions consume shadow logs.
  Rationale: shadow logs need deterministic classification before they can guide canary decisions. Retell-answerable/Own-KB-gap cases block promotion, Own-KB-only cases become improvement/eval candidates, conflicting answers require review, high-risk conflicts require freshness/risk review, and unresolved P0/P1 gaps block promotion.
  Date/Author: 2026-05-30 / Codex Milestone 5 first-pass contract.

- Decision: Encode Milestone 6 as a first-pass rollout/cost/cleanup control contract before any Own-KB canary or primary expansion.
  Rationale: approved benchmark evidence alone is not sufficient for rollout. Canary and primary need separate gates for 0.5B evidence, Milestones 1A-1I, Product KPI, latency, exception-path SLOs, shadow gaps, coverage gaps, rollback, kill switch, Retell-KB standby, cost controls, and cleanup safety.
  Date/Author: 2026-05-30 / Codex Milestone 6 first-pass contract.

- Decision: Add a fail-closed authoring validator before any test-transcript questions can become Own-KB sources.
  Rationale: redacted transcript-derived questions are useful for coverage repair, but they are not evidence; Own-KB source generation must require human-reviewed, source-backed answers and freshness metadata.
  Date/Author: 2026-05-30 / Codex test-transcript authoring hardening.

- Decision: Do not write partial Own-KB authoring source JSON.
  Rationale: batch-level authoring review is easier to audit; partial source output from a mixed valid/invalid CSV could accidentally hide missing answers, missing source titles, or unsafe rows.
  Date/Author: 2026-05-30 / Codex authoring batch fail-closed hardening.

- Decision: Treat approved-artifact evidence, canary readiness, and primary readiness as separate code gates.
  Rationale: direct diagnostic reports are useful for QA but must not be promotion evidence; canary preparation needs KPI/SLO/standby/rollback/kill-switch evidence; primary additionally needs a clean canary window.
  Date/Author: 2026-05-30 / Codex independent-agent review hardening.

- Decision: canary and primary runtime rollout gates require explicit decision evidence, not allowlist/search flags alone.
  Rationale: an allowlist proves only deployment scope, not that the Retell-vs-Own-KB report recommended canary or primary. Canary now requires canary artifact/decision evidence and rollout readiness gates; primary additionally requires `owkb_primary_candidate` decision evidence and 14 clean canary days.
  Date/Author: 2026-05-30 / Codex contextless and rollout-agent review hardening.

- Decision: any unresolved Own-KB P1 failure blocks promotion even if aggregate P1 pass rate is still 98%.
  Rationale: the 98% metric is necessary but not sufficient for promotion; unresolved high-impact failures must be triaged or explicitly reclassified before canary/primary.
  Date/Author: 2026-05-30 / Codex rollout-agent review hardening.

- Decision: approved benchmark artifacts must be strict, sanitized inputs.
  Rationale: unknown sample fields, raw transcripts, unsafe fingerprints, notes, paths, formulas, or PII-like metadata can leak into eval artifacts or make unsafe evidence look approved.
  Date/Author: 2026-05-30 / Codex security-agent review hardening.

- Decision: Own-KB to Retell-KB sync state must carry org, tenant, and agent scope.
  Rationale: sync idempotency, audit events, and existing Retell state comparisons must not cross scopes even when source/version IDs look similar.
  Date/Author: 2026-05-30 / Codex security-agent review hardening.

- Decision: `own_kb_primary` deploys require explicit primary promotion evidence in addition to the existing rollout allowlist.
  Rationale: an allowlist proves scope eligibility, not product readiness. Own-KB Primary can remove Retell-KB from the Retell runtime path, so it must fail closed until approved 0.5B, 14-day canary, Retell standby, rollback, kill switch, Product KPI, and exception-SLO gates are deliberately asserted.
  Date/Author: 2026-05-30 / Codex contextless-agent blocker fix.

- Decision: Test-transcript-derived QA inputs are untrusted even after redaction.
  Rationale: generated question banks and authoring CSVs can still carry redaction tokens, formula text, instruction-like content, or PII-like metadata; the generator and approved-artifact validator must reject unsafe inputs before they become review or promotion artifacts.
  Date/Author: 2026-05-30 / Codex independent-agent review hardening.

- Decision: 0.5B same-question pairing needs a fingerprint, not only `questionId`.
  Rationale: `questionId` is useful as a row key but can be reused accidentally or maliciously; Retell and Own-KB samples must prove they refer to the same redacted question/fingerprint before coverage can support canary or primary decisions.
  Date/Author: 2026-05-30 / Codex independent-agent review hardening.

- Decision: benchmark gap reports must use the same approved SHA-256 evidence gate as trusted promotion reports.
  Rationale: a diagnostic gap report can guide QA, but it must not say promotion evidence is usable unless the exact approved 0.5B artifact hash has been deliberately recorded for canary or primary.
  Date/Author: 2026-05-30 / Codex verification-loop hardening.

- Decision: treat Retell-vs-Own-KB benchmark metadata as adversarial until paired by fingerprint and matching provider metadata.
  Rationale: question IDs alone can be duplicated or reused; promotion evidence must prove that Retell and Own-KB were judged on the same redacted question, intent, risk, and voice-case flags.
  Date/Author: 2026-05-30 / Codex third-pass independent review hardening.

- Decision: runtime Own-KB rollout gates require exact deployment attestations and concrete allowlist IDs.
  Rationale: shorthand truthy values and wildcard allowlist entries are too easy to set accidentally; production/canary gates must be deliberate, explicit, and auditable.
  Date/Author: 2026-05-30 / Codex rollout-agent review hardening.

- Decision: runtime Own-KB rollout gates must not trust env-only 0.5B claims.
  Rationale: artifact IDs, hashes, and readiness booleans in environment variables are deploy-time inputs, not proof that the artifact validator accepted promotion evidence. Canary and primary gates now also require a persisted 0.5B attestation whose artifact ID, SHA-256, decision, and `promotionEvidenceUsable=true` match the environment values.
  Date/Author: 2026-05-30 / Codex final contextless review hardening.

- Decision: 0.5B latency coverage must include representative normal-supported and supported non-tool cases.
  Rationale: the 500-800 ms SLO can be gamed if slow realistic turns are labeled unsupported. Promotion coverage must include enough normal-supported and supported non-tool paired cases, and same-question provider metadata must match those flags.
  Date/Author: 2026-05-30 / Codex final contextless review hardening.

- Decision: Own-KB primary must preserve Retell-KB standby state instead of stripping or deleting it.
  Rationale: Own-KB primary still needs a 14-30 day rollback path; previous Retell-KB IDs remain standby metadata and must be protection-windowed before primary deploy.
  Date/Author: 2026-05-30 / Codex Retell fallback hardening.

- Decision: first-pass contract milestones must not be described as planned-only after focused type/test evidence exists.
  Rationale: the plan is the single source of truth; stale planned-only detail sections can mislead future Codex runs into either rebuilding completed scaffolding or ignoring the remaining live-wiring blockers. Detail statuses now distinguish first-pass additive contract evidence from future production wiring, storage, dashboard, canary, and rollout work.
  Date/Author: 2026-05-30 / Codex plan consistency pass.

- Decision: Retell Custom LLM `response_id` values are provider correlation IDs and may be string or safe integer on live events.
  Rationale: the first DrKalla Custom Runtime Canary webcall showed Retell sending numeric `response_id` values in `response_required` events. The adapter may normalize safe numeric IDs to strings for the canonical route response, but must still reject invalid/object IDs fail-closed and must not treat provider IDs as TrustedScope or authorization.
  Date/Author: 2026-06-12 / Codex custom-runtime canary review.

- Decision: Turn-Taking / Endpointing Guard is a deterministic runtime-quality layer, not a blocking LLM layer before orchestration.
  Rationale: a semantic turn detector can improve interruptions, unfinished German phrases, inaudible speech, and false endpointing, but a normal-path LLM call before every response would violate the 500-800 ms SLO. Milestone 1J therefore starts as a pure function over normalized STT/VAD/update state with p95 decision cost <= 20 ms, no extra LLM/KB calls, and no authority over facts, tools, end-call, tenant scope, or policy.
  Date/Author: 2026-06-12 / Codex turn-taking 99%-plan review.

- Decision: live canary guard wiring starts with repair prompts only, not wait/delay endpointing.
  Rationale: the latest DrKalla canary problem included inaudible/misheard turns and repeated fallback. Repair prompts are the lowest-risk guard action because they require no extra model/KB call, no provider timing delay, no facts, no tools, and no end-call authority. Delaying or overriding Retell endpointing for `wait_short`/`keep_listening` needs separate live timing evidence before it can affect calls.
  Date/Author: 2026-06-12 / Codex custom-runtime canary hardening.

## Outcomes & Retrospective

DrKalla catalog-complete product-type detector A/B outcome, 2026-06-12:

- Extended shared product-type detection for the remaining local catalog/audit terms: `Depilationswachs`, `Haarpflege`, `Haarkur`, `klaerende Spuelung`, `Neutralshampoo`, `Haarfaerbemittel`, `Einweghandschuhe`, `Stylingwax`, `Gel-Spray`, `Volumen-Puder`, `Accessories`, `Zubehoer`, `Salonbedarf`, `Barber-Bedarf`, `Hair Dryer`, `konischer Heizstab`, `Delrin Hair Comb`, `Haarstyling`, `Pflegespuelung`, `Professionelles Salonhandtuch`, and literal `Salon-Verbrauchsmaterial`.
- Red tests proved the A-side missed those terms, the memory runtime had no active product-type state, the responder fell back to the generic product/product-type clarification, and direct A/B cases failed before the detector fix.
- B-side fixes stay in the shared pure detector and A/B harness expectations; short-term memory remains bounded non-evidence dialogue state, while product facts, prices, brands, links, and availability still require KB/catalog evidence.
- Catalog audit now reports `MISSES 0` across `TOTAL_TYPES 99` unique local shop product types.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-product-type-detector.test.ts src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (443 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.689`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (107 files / 1269 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla specialty product-type detector A/B outcome, 2026-06-12:

- Extended shared product-type detection for broader catalog-backed specialty terms: `Kosmetikbedarf`, `Depilationszubehoer`, `Hitzeschutz`, `Ampullen`, `Nackenstreifen`, `Haarschaum`, `Bright-Wax`, `Glanz-Spray`, `Laminier-Spray`, `Vorbereitungsshampoo`, `Straehnchenfolie`, `Blond-Booster`, `Desinfektionswagen`, and `UVC Lampe`.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth, prices, links, brands, and availability still come from KB/catalog evidence.
- Added red/green tests proving A-side failure for the terms, B-side fixes through the shared detector, and no fallback to the generic product/product-type clarification.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-product-type-detector.test.ts src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (361 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.264`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (107 files / 1187 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla extended catalog accessory detector A/B outcome, 2026-06-12:

- Extended shared product-type detection for catalog-backed terms: `Servicewagen`, `Kosmetikwagen`, `Haarsauger`, `Clean All`, `Alligatorclips`, `Hair-Clips`, `HandtÃ¼cher`, and `StrÃ¤hnenhauben`.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth, prices, links, brands, and availability still come from KB/catalog evidence.
- Added direct detector tests plus runtime/responder/A-B tests proving A-side failure for the terms, B-side fixes through the shared detector, and no fallback to the generic product/product-type clarification.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-product-type-detector.test.ts src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (305 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.352`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (107 files / 1131 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla shared product-type detector A/B outcome, 2026-06-12:

- Refactored user-stated product-type detection into `apps/api/src/drkalla-product-type-detector.ts` and left `drkalla-short-term-memory.ts` as a bounded memory reducer that delegates alias matching.
- Extended catalog-backed accessory coverage: `Sprühflaschen` and `Watteschnur` keep the active product-type funnel as `Salon-Verbrauchsmaterial`; `Spiegel` and `Aufsteller` keep it as `Salon-Zubehör`.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth still comes from KB/catalog evidence.
- Added red/green tests proving A-side failure for the catalog-backed accessory terms, B-side fixes through the shared detector, and a structural guard against regrowing product-type regexes inside `drkalla-short-term-memory.ts`.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (267 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.304`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (106 files / 1093 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla barber accessory tool product-type A/B outcome, 2026-06-12:

- Extended user-stated product-type memory for catalog-backed barber accessory requests: `Rasierpinsel`, `Rasierklingen`, `Haarstaubwedel`, and `Nackenwedel` now keep the active product-type funnel as `Friseur-Tool`.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth still comes from KB/catalog evidence.
- Added red/green tests proving A-side failure for the barber accessory terms and B-side fixes through the active product-type funnel.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (254 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.254`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (106 files / 1080 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla salon-consumable product-type A/B outcome, 2026-06-12:

- Extended user-stated product-type memory for catalog-backed salon consumable requests: `Spitzenpapier`, `Nackenpapier`, `Friseurumhänge`, and `Handschuhe` now keep the active product-type funnel as `Salon-Verbrauchsmaterial`.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth still comes from KB/catalog evidence.
- Added red/green tests proving A-side failure for the consumable terms and B-side fixes through the active product-type funnel.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (242 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.259`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (106 files / 1068 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla barber-chair salon-equipment product-type A/B outcome, 2026-06-12:

- Extended user-stated product-type memory for catalog-backed barber-chair/salon-chair requests: `Barberstühle`, `Friseursessel`, and `Salonstühle` now keep the active product-type funnel as `Salonmöbel/-ausstattung`.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth still comes from KB/catalog evidence.
- Added red/green tests proving A-side failure for `Barberstühle` and `Friseursessel`, plus A/B-matrix coverage for `Salonstühle`, and B-side fixes through the active product-type funnel.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (230 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.298`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (106 files / 1056 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla ablagetisch salon-equipment product-type A/B outcome, 2026-06-12:

- Extended user-stated product-type memory for `Ablagetisch` salon-equipment requests: `Ablagetisch` and `Ablagetische` now keep the active product-type funnel as `Salonmöbel/-ausstattung`.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth still comes from KB/catalog evidence.
- Added red/green tests proving A-side failure for the ablagetisch forms and B-side fixes through the active product-type funnel.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (221 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.243`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (106 files / 1047 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla wash-place salon-equipment product-type A/B outcome, 2026-06-12:

- Extended user-stated product-type memory for German wash-place salon-equipment requests: `Waschbecken`, `Waschplatz`, and `Rückwärtswaschbecken` now keep the active product-type funnel as `Salonmöbel/-ausstattung`.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth still comes from KB/catalog evidence.
- Added red/green tests proving A-side failure for the wash-place forms and B-side fixes through the active product-type funnel.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (215 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.228`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (106 files / 1041 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla salonwagen synonym product-type A/B outcome, 2026-06-12:

- Extended user-stated product-type memory for German salonwagen synonym requests: `Friseurwagen`, `Rollwagen`, and `Arbeitswagen` now keep the active product-type funnel as `Salonmöbel/-ausstattung`.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth still comes from KB/catalog evidence.
- Added red/green tests proving A-side failure for the salonwagen synonym forms and B-side fixes through the active product-type funnel.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (206 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.186`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (106 files / 1032 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla German clipper/shaver tool product-type A/B outcome, 2026-06-12:

- Extended user-stated product-type memory for German clipper/shaver tool requests: `Rasierer`, `Barttrimmer`, `Haarschneidemaschinen`, and `Schneidemaschinen` now keep the active product-type funnel as `Friseur-Tool`.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth still comes from KB/catalog evidence.
- Added red/green tests proving A-side failure for German clipper/shaver forms and B-side fixes through the active product-type funnel.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (197 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.648`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (106 files / 1023 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla electrical/barber tool product-type A/B outcome, 2026-06-12:

- Extended user-stated product-type memory for electrical/barber tool requests: `Glätteisen`, `Föhn`, `Haartrockner`, and `Shaver` now keep the active product-type funnel as `Friseur-Tool`.
- Fixed a real misclassification: `Glätteisen` no longer routes to the `Haarglättung` product/treatment funnel.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth still comes from KB/catalog evidence.
- Added red/green tests proving A-side failure for electrical/barber tool forms and B-side fixes through the active product-type funnel.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (185 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.1`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (106 files / 1011 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla color-service tool accessory A/B outcome, 2026-06-12:

- Extended user-stated product-type memory for color-service tool accessory requests: `Färbeschalen`, `Färbepinsel`, `Alufolie`, and `Strähnenfolie` now keep the active product-type funnel as `Friseur-Tool`.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth still comes from KB/catalog evidence.
- Added red/green tests proving A-side failure for color-service tool accessory forms and B-side fixes through the active product-type funnel.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (173 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.1`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (106 files / 999 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla Farbkarte product-type A/B outcome, 2026-06-12:

- Extended user-stated product-type memory for Farbkarte requests: `Farbkarten`, `Farbkarte`, and `Koleston Farbkarte` now keep the active product-type funnel as `Farbkarte`.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth still comes from KB/catalog evidence.
- Added red/green tests proving A-side failure for Farbkarte forms and B-side fixes through the active product-type funnel.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (161 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.1`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (106 files / 987 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla Dauerwelle Styling product-type A/B outcome, 2026-06-12:

- Extended user-stated product-type memory for Dauerwelle styling requests: `Dauerwellenlösung`, `Dauerwelle`, and `Dauerwellenmittel` now keep the active product-type funnel as `Styling`.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth still comes from KB/catalog evidence.
- Added red/green tests proving A-side failure for Dauerwelle styling forms and B-side fixes through the active product-type funnel.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (152 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.1`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (106 files / 978 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla plural salon-equipment product-type A/B outcome, 2026-06-12:

- Extended user-stated product-type memory for plural salon-equipment requests: `Wascheinheiten`, `Friseurstühle`, `Ablagen`, and `Stehmatten` now keep the active product-type funnel as `Salonmöbel/-ausstattung`.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth still comes from KB/catalog evidence.
- Added red/green tests proving A-side failure for plural salon-equipment forms and B-side fixes through the active product-type funnel.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (143 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.1`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (106 files / 969 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla plural tool product-type A/B outcome, 2026-06-12:

- Extended user-stated product-type memory for plural tool requests: `Kämme`, `Bürsten`, and `Scheren` now keep the active product-type funnel as `Friseur-Tool`.
- Preserved the architecture boundary: this is bounded non-evidence dialogue state only; product truth still comes from KB/catalog evidence.
- Added red/green tests proving A-side failure for plural tool forms and B-side fixes through the active product-type funnel.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (131 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.107`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (106 files / 957 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

DrKalla product-type funnel A/B outcome, 2026-06-12:

- Extended user-stated product-type memory from broad catalogue buckets into specific haircare requests: `Shampoo`, `Haarmaske`, `Conditioner/Spülung`, `Leave-in`, and `Serum`.
- Preserved the architecture boundary: `active_product_type` is bounded non-evidence dialogue state only; product truth still comes from KB/catalog evidence.
- Added red/green tests proving A-side failures for missing or over-broad haircare detection and B-side fixes through the active product-type funnel.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/drkalla-memory-runtime.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts src/__tests__/drkalla-memory-ab-simulation.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-dialogue-view.test.ts src/__tests__/drkalla-rag-ab-regression.test.ts src/__tests__/turn-taking-guard.test.ts` (122 tests).
- Verified 1000-case A/B simulation passes: `corepack pnpm --filter @vas/api drkalla:ab-memory -- --cases 1000 --seed drkalla-memory-v1` (`1000/1000` B passed, `memoryP95Ms=0.106`, no extra LLM/KB calls).
- Verified API typecheck and full API tests pass: `corepack pnpm --filter @vas/api typecheck`; `corepack pnpm --filter @vas/api test -- --run` (106 files / 948 tests).
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.

Milestone 1J turn-taking guard outcome, 2026-06-12:

- Added `apps/api/src/turn-taking-guard.ts` as a deterministic guard for `respond_now`, `wait_short`, `keep_listening`, and `repair_prompt`.
- Added `apps/api/src/__tests__/turn-taking-guard.test.ts` with coverage for final German utterances, trailing fillers/connectors, unstable partials, low-confidence ASR, inaudible streaks, corrections/interruptions, empty input, true silence, no LLM/KB/tool/end-call authority, and a 1000-case latency simulation.
- Wired the guard into `apps/api/src/drkalla-custom-llm-responder.ts` for repair prompts after DrKalla memory updates and before model completion.
- Added responder and WebSocket route tests proving `(inaudible speech)` keeps `end_call=false`, avoids the model call, increments per-session short-term memory, escalates the second repair prompt, and does not leak memory across separate WebSocket sessions.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/turn-taking-guard.test.ts src/__tests__/voice-pipeline-contract.test.ts src/__tests__/voice-runtime-provider-adapters.test.ts src/__tests__/retell-drkalla-custom-llm-ws.test.ts src/__tests__/retell-drkalla-custom-llm-ws-route.test.ts src/__tests__/drkalla-custom-llm-responder.test.ts` (65 tests).
- Verified API typecheck passes: `corepack pnpm --filter @vas/api typecheck`.
- No phone number, Retell-KB, production DrKalla agent, Own-KB primary flag, runtime rollout flag, or OpenAI Realtime implementation changed.
- Remaining work: full product/RAG/funnel response composition is not wired into Custom Runtime yet; `wait_short`/`keep_listening` should stay advisory until live timing evidence proves they improve endpointing without hurting the 500-800 ms SLO.

Milestone 1I voice pipeline contract outcome, 2026-05-30:

- Added explicit STT / TTT / TTS / Runtime Interaction pipeline boundaries to `AGENTS.md`.
- Added planned Milestone 1I with required STT timestamps/confidence/locale/redaction state, TTT canonical utterance/intent/evidence/policy/response-plan fields, and TTS written/spoken text, safe-audio, first/full-audio, and pronunciation-profile fields.
- Added `apps/api/src/voice-pipeline-contract.ts` as an additive type/test-only contract for STT, TTT, TTS, and runtime interaction readiness.
- Added `apps/api/src/__tests__/voice-pipeline-contract.test.ts` covering ready-path metrics, low-confidence STT, TTT evidence/policy gaps, filler-only TTS anti-gaming, stale interruption audio, required canonical STT/TTT/TTS timestamp boundaries, required redaction/source/review fields, canonical attribution/provider/channel validation, invalid runtime values, invalid runtime numeric values, provider vocabulary in canonical values including TTS output text, unknown canonical boundary values that miss provider denylist words, provider-specific top-level/runtime payload fields, invalid redaction states, unsafe evidence decisions, bidirectional policy/safe-audio mismatch, invalid safe-audio values, unresolved pronunciation review, per-turn SLO misses, missing/invalid SLO classification, normal-turn relabeling into the looser supported-non-tool SLO, invalid exception/SLO class mixing, invalid/over-budget/semantically mismatched exception paths, interruption correlation including provider-response and next-turn mismatch, invalid runtime interaction state, barge-in timestamp mismatch, impossible cross-layer timestamp ordering, and provider-specific field leakage.
- Hardened the contract after independent review so TTT timing is separately measurable with `agentCoreTurnStartAt`, `firstModelTokenAt`, and `firstSpeakableChunkAt`; provider-specific payload fields and provider-specific canonical values are rejected across pipeline, STT, TTT, TTS, and runtime layers, including written/spoken TTS output text; leak-sensitive boundary values now use canonical allowlists for transcript source, TTT planning values, and pronunciation profile instead of relying only on provider-word denylisting; `provider` stays a runtime provider while test/internal routing belongs to `channel`; call/turn/provider/channel attribution is required; timestamp-order failures affect layer readiness/failure attribution; voice-turn SLO classification fails closed when missing, when normal turns opt out of the supported-non-tool class, when non-normal turns lack an enum-valid exception path, or when exception paths are mixed with live SLO classes; exception paths carry first-safe-audio budgets and must match policy/tool/runtime/evidence semantics; redaction states, safe-audio types, runtime interaction states, finite confidence, finite non-negative runtime numeric values, and pronunciation review state are validated; policy/tool decisions must match `safeAudioType` bidirectionally; TTS-only timing is separated from voice e2e timing; interrupted turns must correlate the active provider response, stopped response, interrupted response, and a distinct next turn; and barge-in recovery is derived from canonical timestamps or rejected when supplied metrics disagree.
- Added eval acceptance that separates ASR/STT failures, text reasoning/TTT failures, TTS/spoken-output failures, and runtime interaction failures.
- Verified 59 focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/voice-pipeline-contract.test.ts src/__tests__/voice-latency-contract.test.ts src/__tests__/voice-output-normalization.test.ts src/__tests__/voice-runtime-contract.test.ts src/__tests__/architecture-drift.test.ts`.
- Verified API typecheck passes: `corepack pnpm --filter @vas/api typecheck`.
- No production code, runtime flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Milestone 2 first-pass contract outcome, 2026-05-30:

- Added `apps/api/src/voice-runtime-contract.ts` as a type-only provider-neutral contract.
- Added `apps/api/src/__tests__/voice-runtime-contract.test.ts`.
- Represented separate `RuntimeProvider` and `InteractionChannel` axes.
- Represented canonical inbound events and outbound commands, including streaming speech fields for `turnId`, `responseId`, `sequence`, finality, interruptibility, evidence IDs, and voice style.
- Hardened the contract after review so canonical commands, not only events, carry `TrustedScope`, provider/channel, and provider call/session correlation.
- Constrained `UpdateRuntimeTuning` to runtime-safe transport parameters only.
- Added `apps/api/src/provider-adapters/retell-adapter.ts` and `apps/api/src/provider-adapters/openai-realtime-adapter.ts` as isolated fixture adapters with no provider SDK imports, no network use, and no production wiring.
- Added `apps/api/src/__tests__/voice-runtime-provider-adapters.test.ts` covering golden same-turn normalization from Retell/OpenAI fixtures, Retell full-transcript reduction, redacted recent turns, interruption/response correlation, speech-command rendering, no provider-side tool execution, transport-only runtime tuning, and no policy-layer imports.
- Hardened `apps/api/src/__tests__/architecture-drift.test.ts` so these fixture adapters remain test-only until explicit live wiring work and cannot import provider SDKs, policy/action/tool layers, Agent Runtime, or Own-KB modules.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/voice-runtime-provider-adapters.test.ts src/__tests__/voice-runtime-contract.test.ts`.
- Verified API typecheck passes: `corepack pnpm --filter @vas/api typecheck`.
- No production runtime behavior, rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.
- Remaining work: live provider-adapter wiring and production fixture coverage remain future implementation, gated by architecture-drift checks and rollout constraints.

Milestone 2C intent playbook contract outcome, 2026-05-30:

- Re-ran the 0.5B artifact runner in report-only mode and confirmed it still fails closed without an explicit approved artifact: `APPROVED_BENCHMARK_ARTIFACT_MISSING`, `promotionEvidenceUsable=false`.
- Added `apps/api/src/intent-playbooks.ts` as an additive type/test-only validator for top-intent playbook packs.
- Added `apps/api/src/__tests__/intent-playbooks.test.ts` covering 30 unique top-intent coverage, low-risk/high-risk/booking/escalation/out-of-scope risk-kind coverage, explicit pricing/legal/policy risk-class coverage, required conversation fields, explicit required fields and tools, unknown-tool rejection, ambiguous `none` tool declarations, registry-mutating tool confirmation, German ASR variant classes, mutation-tool confirmation via confirmed spoken summary, short spoken gold answers, and written-style answer rejection.
- Hardened the contract after independent review so mutating playbooks cannot pass with weaker `policy_confirmation_before_answer` or `human_handoff_required`, high-risk coverage requires actual pricing/legal/policy risk classes, German ASR variants must cover colloquial, misspelling, compound-word, umlaut, number/time, and service-name confusions, playbooks must explicitly declare required fields and allowed tools, allowed tools are validated through a typed registry with `mutates` metadata rather than free-form strings, and `none` cannot be mixed with real tools.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/intent-playbooks.test.ts src/__tests__/intent-layer.test.ts src/__tests__/voice-pipeline-contract.test.ts src/__tests__/architecture-drift.test.ts` (53 tests).
- Verified API typecheck passes: `corepack pnpm --filter @vas/api typecheck`.
- No production runtime behavior, rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.
- Remaining work: fill real tenant/industry top-30 playbook content, tie playbook versions to eval cases/Product KPI reports, and wire provider/runtime use only after the surrounding canary gates permit it.

Milestone 2D tool confirmation state-machine outcome, 2026-05-30:

- Added `apps/api/src/tool-confirmation-state.ts` as a pure type/test-only mutation confirmation contract.
- Added `apps/api/src/__tests__/tool-confirmation-state.test.ts` covering happy path ordering, blocked execution before spoken summary/user confirmation/policy approval/idempotency key, interruption and correction invalidating prior confirmation, repeated execution idempotent replay, policy denial, failed tool result speech, and preventing reopened confirmation after a tool already executed.
- Hardened the first pass after self-review so completed tool execution cannot be reset by later correction/field events in the same session, and truthful negative failure speech such as "nicht gebucht" is not rejected as a false success claim.
- This is contract evidence only; live mutating tool paths still need controlled wiring through policy/action gateway, audit, idempotency persistence, and provider/runtime confirmation UX before canary expansion.
- No production runtime behavior, rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Milestone 2E business-hours resolver outcome, 2026-05-30:

- Added `apps/api/src/business-hours-resolver.ts` as a pure type/test-only resolver contract for `open_now` and `open_tomorrow`.
- Added `apps/api/src/__tests__/business-hours-resolver.test.ts` covering approved/current source-version evidence, `Europe/Berlin`, static pinned context not overriding the resolver, minute-specific open-now logic, any-valid-interval open-tomorrow logic, special hours, holidays, `Betriebsferien`, stale/expired/unapproved source fail-closed behavior, and timezone rejection.
- This is contract evidence only; live answer composition, Own-KB source ingestion, and provider/runtime usage still need controlled wiring before opening-hours answers can be promoted.
- No production runtime behavior, rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Milestone 2F runtime degradation matrix outcome, 2026-05-30:

- Added `apps/api/src/runtime-degradation-matrix.ts` as a pure type/test-only validator for degradation behavior.
- Added `apps/api/src/__tests__/runtime-degradation-matrix.test.ts` covering all required degradation modes, explicit operational fields, retrieval outage high-risk abstain/escalation behavior, tool-API-down false-success prevention, ASR/TTS degradation metrics and clarification/escalation behavior, and provider-latency stop-loss plus first-safe-audio anti-gaming.
- This is contract evidence only; live health probes, feature flags, runtime routing, provider fallback, and alert wiring remain future implementation before canary expansion.
- No production runtime behavior, rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Milestone 3B KB-ingestion prompt-injection red-team outcome, 2026-05-30:

- Added `apps/api/src/kb-ingestion-redteam.ts` as a pure type/test-only red-team suite validator.
- Added `apps/api/src/__tests__/kb-ingestion-redteam.test.ts` covering required fixture classes, multilingual coverage, injection logging, excluded evidence summaries, prompt-instruction exclusion, mutation/scope/provider/secret blockers, cross-tenant bait rejection, and safe factual snippets adjacent to excluded injection.
- This is contract evidence only; live parser/OCR/Markdown ingestion, trace/eval emission, and ContextContract exclusion wiring remain future implementation.
- No production runtime behavior, rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Milestone 4D German audio-chaos eval outcome, 2026-05-30:

- Added `apps/api/src/german-audio-chaos-eval.ts` as a pure type/test-only audio-chaos eval suite validator.
- Added `apps/api/src/__tests__/german-audio-chaos-eval.test.ts` covering required DACH telephone quality, background noise, Bluetooth mic, fast speaker, dialect/colloquial German, umlaut/ASR confusion, interruption during confirmation, number/time/email correction, caller frustration, separate text/ASR/TTS/runtime labels, German/Austrian/Swiss coverage, text-correct-but-voice-failed cases, correction coverage, and latency reporting.
- This is contract evidence only; live audio fixtures, ASR/TTS execution, and eval-report generation remain future implementation.
- No production runtime behavior, rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Milestone 4E human-QA labeling workflow outcome, 2026-05-30:

- Added `apps/api/src/human-qa-labeling.ts` as a pure type/test-only QA workflow validator.
- Added `apps/api/src/__tests__/human-qa-labeling.test.ts` covering required answer/abstain/escalation/evidence/voice/correction labels, P0/P1/P2 taxonomy, disagreement resolution, eval/report/source/schema versioning, tenant/industry/intent/risk/language distribution tracking, raw-PII controls, and minimum label coverage.
- This is contract evidence only; real labeling UI, storage, reviewer assignment, adjudication workflow, and report generation remain future implementation.
- No production runtime behavior, rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Milestone 3 ContextContract outcome, 2026-05-30:

- Added `apps/api/src/context-contract.ts` as a pure type/test-only ContextContract builder.
- Added `apps/api/src/__tests__/context-contract.test.ts` covering stable inline snapshot output, branded `TrustedScope` requirement, approved/current evidence inclusion, unapproved and stale high-risk evidence exclusion, excluded-evidence summaries, no-evidence vs only-excluded-evidence distinction, recent-turn redaction, full transcript marker exclusion, full KB dump marker exclusion, model-supplied scope exclusion, secret exclusion, and raw PII redaction.
- This is contract evidence only; live `agent-runtime` and `agent-instructions` prompt assembly still need controlled wiring to the contract before canary expansion.
- No production runtime behavior, rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Milestone 4 conversational eval harness outcome, 2026-05-30:

- Added `apps/api/src/conversational-eval-harness.ts` as a pure type/test-only conversational eval validator.
- Added `apps/api/src/__tests__/conversational-eval-harness.test.ts` covering 30-intent coverage, required voice-reality eval classes, P0/P1/P2 taxonomy, redacted replay readiness, pass-rate and P1-pass-rate gates, p95 normal-supported latency <= 800 ms, stale high-risk abstain behavior, cross-tenant exposure blocking, frustration escalation handling, unauthorized mutation denial, prompt-injection non-effect, concise voice answers, interruption handling, and correction handling.
- This is contract evidence only; real transcript replay, real eval storage, labeling UI, provider audio fixtures, and promotion use remain gated by approved eval artifacts, PII controls, and Milestone 6 rollout gates.
- No production runtime behavior, rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Milestone 5 Shadow/Dual-Read Decision Matrix outcome, 2026-05-30:

- Added `apps/api/src/shadow-dual-read-decision-matrix.ts` as a pure type/test-only decision-matrix validator.
- Added `apps/api/src/__tests__/shadow-dual-read-decision-matrix.test.ts` covering each planned comparison classification, 30-intent coverage, Own-KB coverage-gap blockers, Own-KB-only potential improvement accounting, high-risk conflict review requirements, unresolved P0/P1 blockers, neither-answerable KB-decision blockers, missing fingerprints, and duplicate fingerprints.
- This is contract evidence only; live shadow-log ingestion, storage, dashboards, and rollout wiring remain future implementation and still require approved 0.5B evidence plus Milestone 6 gates before canary/primary use.
- No production runtime behavior, rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Milestone 6 rollout/cost/cleanup controls outcome, 2026-05-30:

- Added `apps/api/src/rollout-cost-cleanup-controls.ts` as a pure type/test-only rollout, cost, and cleanup validator.
- Added `apps/api/src/__tests__/rollout-cost-cleanup-controls.test.ts` covering canary readiness, canary decision requirements, missing global gates, missing 0.5B evidence, missing/not-ready Product KPI report, Product KPI/SLO/shadow/coverage blockers, rollback/kill-switch/Retell-standby blockers, cost budget/spend-cap/alert blockers, primary-only decision requirements, 14 clean canary days, unresolved P1/SLO/KPI/governance primary blockers, 14-30 day Retell-KB standby, and protected Retell-KB cleanup constraints.
- The report separates rollout blockers from cleanup blockers so cleanup audits can be reasoned about without hiding rollout-readiness failures.
- This is contract evidence only; live rollout wiring, dashboarding, cost telemetry, and cleanup execution remain future implementation and must preserve existing production flags and Retell-KB behavior.
- No production runtime behavior, rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Test-transcript 0.5B draft outcome, 2026-05-30:

- Generated a local non-promotional QA pack under `apps/api/scratch/own-kb-benchmark/test-transcripts/`.
- The pack includes `test-transcript-0.5b-draft.json`, `test-transcript-0.5b-labeling.csv`, `test-transcript-redacted-question-bank.csv`, `test-transcript-0.5b-gap-report.json`, `test-transcript-own-kb-diagnostic.json`, `test-retell-call-latency-diagnostic.json`, and `README.md`.
- Added `apps/api/src/scripts/create-test-transcript-benchmark-pack.ts` and package script `own-kb:benchmark-test-transcripts` so the draft pack can be regenerated without inline commands.
- Source classification: user-confirmed test/demo transcripts, not real production promotion data.
- Redacted extraction yielded 50 selected questions for QA from 102 unique redacted demo/test question candidates.
- Own-KB diagnostic on those 50 questions returned 0 answerable, p95 about 708 ms, and remains blocked by missing Retell same-question baseline, human quality labels, and canonical voice-latency timestamps.
- Sanitized config inspection found no configured `knowledgeSources` and no Retell-KB ID for the selected test-agent scope; backfill dry-run prepared only the canonical db facts source with 2 chunks.
- Added `test-transcript-own-kb-source-authoring.csv` as a local authoring aid for reviewed source-backed answers. Draft rows must not be ingested until a human fills evidence-backed answers and verifies risk, allowed_use, verified_at, and expires_at.
- Added `apps/api/src/scripts/validate-own-kb-authoring.ts` and package script `own-kb:authoring-validate`.
- Added `apps/api/src/own-kb-authoring.ts` and `apps/api/src/__tests__/own-kb-authoring.test.ts` so the authoring gate is covered by focused tests, not only manual CLI verification.
- Hardened the authoring gate so PII and prompt-injection content block source generation.
- Hardened source output so mixed valid/invalid CSVs produce no partial KnowledgeSource JSON.
- Hardened the authoring gate so duplicate `questionId`s block source generation rather than picking one row implicitly.
- Hardened empty/missing-row authoring CSVs so they fail closed with `AUTHORING_ROWS_REQUIRED`.
- Hardened authoring field-size limits so oversized transcript-like content cannot become generated KB source material.
- Hardened CSV header validation so missing required columns and unknown columns block source generation before row parsing.
- Hardened `verifiedAt`/`expiresAt` parsing to exact UTC ISO timestamps with milliseconds.
- Normalized generated source metadata for `allowedUse`, `reviewStatus`, and `risk`.
- Hardened quality checks against placeholder content and question-as-answer rows.
- Added deterministic `sha256`/`contentHash` metadata to generated authoring sources.
- Hardened CLI output handling so failed validation clears stale source output to `[]`.
- Hardened CLI path handling so input, source output, and report output cannot clobber each other.
- Hardened authoring validation against spreadsheet formula injection in CSV-authored fields.
- Hardened authoring row coverage with a default 50-row CLI minimum and batch-level blocker.
- Extended PII and prompt-injection validation to authoring notes.
- Extended placeholder detection to authoring notes that still instruct reviewers to fill answers or sources.
- Hardened generated source content fields against redaction-token placeholders.
- Updated the test-transcript draft-pack generator so authoring CSV and README guidance are reproducible outputs.
- Hardened the test-transcript draft-pack generator to accept only canonical UTC ISO `--generated-at` values.
- Hardened the test-transcript draft-pack generator against under-sized or insufficient-coverage packs.
- Hardened generated CSV values against spreadsheet formula injection and moved pack helpers into a focused testable module.
- Hardened 0.5B QA labeling CSV output against spreadsheet formula injection.
- Verified the current authoring CSV fails closed: 50 rows, 0 valid rows, 50 invalid rows, with issue counts for missing answers, missing source titles, and draft/non-approved review status. No source JSON was written and `promotionEvidenceUsable` remains false.
- Retell test-call diagnostic retrieved 59/59 test calls, found 46 calls with e2e latency data, but found no separate Retell KB latency and no `knowledge_base_retrieved_contents_url` in checked calls.
- This pack is `DRAFT_ONLY`; it must not be used as 0.5B promotion evidence.
- Verified `corepack pnpm --filter @vas/api typecheck` passes, `corepack pnpm --filter @vas/api test -- --run src/__tests__/own-kb-authoring.test.ts src/__tests__/pii.test.ts src/__tests__/knowledge.test.ts` passes, and `corepack pnpm --filter @vas/api test -- --run src/__tests__/own-kb-authoring.test.ts` passes after duplicate-ID, empty-file, field-size, CSV-header, canonical-date, metadata-normalization, placeholder, copied-answer, content-hash, stale-output, path-conflict, formula-injection, min-row coverage, notes-safety, note-placeholder, and redaction-token hardening. The CLI emits only summary counts/status while failing closed on invalid authoring rows. Verification with `--output` confirmed stale source output is replaced with `[]` for the current invalid CSV; verification with `--output` equal to `--input` confirmed the CLI fails before clobbering the source CSV. Current draft CSV reports `PLACEHOLDER_CONTENT: 50` because reviewer notes still say to fill answers from approved/current sources.
- Verified `corepack pnpm --filter @vas/api own-kb:benchmark-test-transcripts -- --output-dir scratch/own-kb-benchmark/test-transcripts --questions 50 --max-rows 200` regenerates the draft pack with `test-transcript-own-kb-source-authoring.csv` and README guidance. The command reported 59 source rows, 102 unique redacted question candidates, 50 selected questions, `artifactStatus: DRAFT_ONLY`, and `promotionEvidenceUsable: false`.
- Verified invalid `--generated-at 2026-05-30` fails closed with `GENERATED-AT_MUST_BE_UTC_ISO_WITH_MILLISECONDS`; verified valid `--generated-at 2026-05-30T04:30:00.000Z` regenerates the draft pack and authoring CSV with canonical `verifiedAt`/`expiresAt` timestamps.
- Verified `--questions 10` fails with `QUESTIONS_OUT_OF_RANGE_50_200`; verified `--questions 103` fails with `TEST_TRANSCRIPT_QUESTION_COVERAGE_BELOW_REQUESTED` against the current corpus; verified `--questions 50` still regenerates the DRAFT_ONLY pack with 59 source rows, 102 unique redacted question candidates, and 50 selected questions.
- Verified `corepack pnpm --filter @vas/api test -- --run src/__tests__/test-transcript-benchmark-pack.test.ts src/__tests__/own-kb-authoring.test.ts` passes with 24 focused tests, and `corepack pnpm --filter @vas/api typecheck` passes after extracting CSV/timestamp/hash helpers.
- Verified `corepack pnpm --filter @vas/api test -- --run src/__tests__/own-kb-benchmark-artifact.test.ts src/__tests__/test-transcript-benchmark-pack.test.ts src/__tests__/own-kb-authoring.test.ts` passes with 49 focused tests after formula-hardening both pack CSVs and QA labeling CSV output.

Test-transcript 0.5B diagnostic-merge outcome, 2026-05-30:

- Added `applyOwnKbDiagnosticToBenchmarkArtifact` and `apps/api/src/scripts/apply-own-kb-benchmark-diagnostic.ts` so local Own-KB diagnostics can be merged into a benchmark artifact without fabricating labels or promotion evidence.
- Diagnostic merge output always resets approval to `DRAFT_ONLY`; approval can be restored only through the explicit label-import path with approval metadata, PII classification, and exact CSV row/header integrity.
- Re-approved the changed local test/demo candidate after diagnostic merge. The accepted artifact hash is `c0bb2aed1de450467dfc82ee81a0bd0956e643c07f74653c4dac5c62aab61cb3`.
- The merged candidate remains non-promotional: `promotionEvidenceUsable=false`, decision `keep_retell_primary`, and canary/primary blockers remain.
- The merge removed unknown-metric blockers for Own-KB `kbContextMs` and Recall@5 labels, but exposed a concrete latency blocker: Own-KB FTS-first/KB context p95 is about 708 ms, above the normal live-path 80-100 ms target.
- Independent review then hardened the same path: Retell material latency advantage now blocks global Own-KB canary even when Own-KB has slightly higher quality labels, Recall@5 values outside 0..1 are invalid, diagnostic rows must match question fingerprints and cannot be duplicated, and changed diagnostics reset dependent QA/safety labels before any re-approval.
- Re-ran the diagnostic merge with the hardened code. The command applied 50/50 diagnostics, reported 0 duplicate diagnostics, 0 fingerprint mismatches, reset 50 dependent QA/safety label sets, downgraded the artifact to `DRAFT_ONLY`, and then the explicit label-import path re-approved it. The accepted artifact hash remained `c0bb2aed1de450467dfc82ee81a0bd0956e643c07f74653c4dac5c62aab61cb3`.
- Remaining blockers include missing same-question Retell baseline metrics, canonical voice-latency timestamps, human QA labels for answer correctness/P0/P1/abstain/hallucination/auditability/safety, Own-KB answerability 0/50, Product KPI gates, exception-SLO reporting, Retell standby, rollback, kill switch, and 14-day canary evidence.
- Final verification for this hardening loop passed: `corepack pnpm --filter @vas/api typecheck`, `corepack pnpm --filter @vas/api test -- --run` with 84 test files / 686 tests, and the 0.5B artifact runner in report-only mode. The runner reports the 0.5B safety precondition path as trusted, but root `promotionEvidenceUsable=false`; this is not promotion evidence and must not unlock Own-KB canary or primary. It still reports `artifactAccepted=true`, `decision=keep_retell_primary`, artifact hash `c0bb2aed1de450467dfc82ee81a0bd0956e643c07f74653c4dac5c62aab61cb3`, 30 report blockers, 5 canary blockers, and 4 primary blockers.

Independent-agent hardening outcome, 2026-05-30:

- Evaluated independent security/CSV, benchmark/promotion, and contextless architecture review findings against the current code instead of treating review prose as implementation authority.
- Hardened Own-KB authoring CSV validation with `CSV_DUPLICATE_COLUMNS`, `CSV_ROW_COLUMN_COUNT_MISMATCH`, and `CSV_MALFORMED_QUOTES`.
- Hardened Own-KB authoring freshness validation with `VERIFIED_AT_IN_FUTURE` and `EXPIRES_AT_NOT_AFTER_VERIFIED_AT`.
- Hardened redaction-token validation to include `redactedQuestion` because generated source bodies include both question and answer.
- Hardened test-transcript draft-pack input filtering so unsafe extracted questions are skipped before CSV/JSON output.
- Hardened approved 0.5B artifact validation against PII/formula/path/placeholder-like sample metadata.
- Hardened 0.5B decision reports so direct diagnostic reports require `APPROVED_0_5B_ARTIFACT_REQUIRED` and cannot produce promotion evidence without the artifact validator path.
- Hardened same-question pairing with `questionFingerprint`, `MISSING_QUESTION_FINGERPRINT`, `QUESTION_FINGERPRINT_MISMATCH`, and `DUPLICATE_PROVIDER_SAMPLE_FOR_QUESTION` blockers.
- Added missing-label blockers for P0/P1, abstain, hallucination, auditability, and safety labels.
- Added `canaryBlockers` for Product KPI hard gates, exception-path SLO reporting, Retell standby, rollback, and kill switch so canary is not inferred from metric parity alone.
- Added an architecture-drift test proving the approved-artifact override remains isolated to `own-kb-benchmark-artifact.ts`.
- Closed the contextless-agent blocker where `own_kb_primary` deploys could proceed with allowlist/search flags alone. Primary deploys now fail closed unless explicit primary deploy unlock, a non-placeholder approved 0.5B artifact ID, SHA-256 evidence, persisted matching attestation, 14-day canary, Retell standby, rollback, kill-switch, Product KPI, and exception-SLO evidence are set.
- Verified focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/architecture-drift.test.ts src/__tests__/agent-config-callback-retention.test.ts src/__tests__/own-kb-benchmark.test.ts src/__tests__/own-kb-benchmark-artifact.test.ts src/__tests__/own-kb-authoring.test.ts src/__tests__/test-transcript-benchmark-pack.test.ts` with 97 tests passing.
- Verified TrustedScope/knowledge-search focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/agent-tools-knowledge-gating.test.ts src/__tests__/agent-runtime-knowledge-tool.test.ts src/__tests__/knowledge-search-trusted-scope-boundary.test.ts src/__tests__/architecture-drift.test.ts` with 25 tests passing.
- Verified Voice Reality focused contract tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/voice-latency-contract.test.ts src/__tests__/voice-output-normalization.test.ts src/__tests__/voice-compliance-contract.test.ts src/__tests__/voice-runtime-contract.test.ts src/__tests__/own-kb-retell-sync-contract.test.ts` with 29 tests passing.
- Verified API typecheck passes: `corepack pnpm --filter @vas/api typecheck`.
- Re-running the test-transcript pack generator was blocked by a local DB TLS certificate error (`self-signed certificate in certificate chain`); no pack regeneration evidence was claimed from that run. Existing authoring validation still fails closed with 50 rows, 0 valid rows, `sourcesWritten=false`, and `outputCleared=true`.

Second independent-agent hardening outcome, 2026-05-30:

- Evaluated second-pass contextless architecture, rollout/benchmark, security/artifact, and German voice-planning reviews against current code.
- Hardened canary runtime search so `OWN_KB_SEARCH_ENABLED` plus rollout allowlist is no longer sufficient; canary requires explicit canary deploy unlock, approved 0.5B artifact ID, `owkb_canary_candidate` or `owkb_primary_candidate` decision evidence, Product KPI gates, exception-path SLO evidence, Retell standby, rollback, and kill-switch readiness.
- Hardened primary runtime deployment so a regex-shaped artifact ID alone is not sufficient; primary additionally requires explicit `owkb_primary_candidate` decision evidence, primary deploy unlock, separate non-placeholder primary artifact ID, and 14 clean canary days.
- Hardened benchmark promotion blockers so any unresolved Own-KB P1 failure blocks promotion, retrieval-required samples must provide Recall@5 labels, and fast-path coverage below 80% blocks promotion.
- Hardened approved 0.5B artifacts with strict sample-key whitelisting and unsafe-string scanning across sample metadata, notes, and fingerprints; unknown raw transcript fields are rejected.
- Hardened Own-KB to Retell-KB sync contract with org/tenant/agent scope fields, scoped idempotency/audit data, and `SYNC_SCOPE_MISMATCH` fail-closed behavior.
- Clarified README/docs authority so repo navigation points Codex work to root `AGENTS.md` and `PLANS.md`, and marked `docs/plan.md` historical/non-authoritative.
- Expanded architecture-drift checks to cover provider-specific `packages/voice-core` OpenAI Realtime code isolation.
- Verified broad focused guardrail suite passes: `corepack pnpm --filter @vas/api test -- --run src/__tests__/architecture-drift.test.ts src/__tests__/agent-config-callback-retention.test.ts src/__tests__/agent-tools-knowledge-gating.test.ts src/__tests__/agent-runtime-knowledge-tool.test.ts src/__tests__/knowledge-search-trusted-scope-boundary.test.ts src/__tests__/retell-knowledge-search-tool.test.ts src/__tests__/own-kb-benchmark.test.ts src/__tests__/own-kb-benchmark-artifact.test.ts src/__tests__/own-kb-authoring.test.ts src/__tests__/test-transcript-benchmark-pack.test.ts src/__tests__/own-kb-retell-sync-contract.test.ts src/__tests__/voice-latency-contract.test.ts src/__tests__/voice-output-normalization.test.ts src/__tests__/voice-compliance-contract.test.ts src/__tests__/voice-runtime-contract.test.ts` with 175 tests passing.
- Verified API typecheck passes: `corepack pnpm --filter @vas/api typecheck`.
- Remaining release blockers are intentionally explicit: production Retell-KB sync still needs to consume the scoped Own-KB sync contract, mutation flows still need live wiring to the Milestone 2D server-side confirmation state, and German voice/runtime QA milestones remain required before broad canary expansion.

Milestone 0.5A outcome, 2026-05-29:

- Added deterministic Retell-KB vs Own-KB decision-report scaffolding in `apps/api/src/own-kb-benchmark.ts`.
- Added and hardened focused tests in `apps/api/src/__tests__/own-kb-benchmark.test.ts`.
- Hardened decision gates for 50 paired questions, 30 intents, high-risk coverage, stale-only/out-of-scope/German-ASR/interruption coverage, missing metrics, P1 pass rate, high-risk auditability, slow-RAG normal-path protection, and primary rollback readiness.
- Verified `corepack pnpm --filter @vas/api test -- --run src/__tests__/own-kb-benchmark.test.ts` passes.
- Verified `corepack pnpm --filter @vas/api typecheck` passes.
- Production behavior and runtime flags were not changed.
- Remaining risk: report inputs are scaffolding only; benchmark results remain non-promotional unless an explicit approved 0.5B artifact exists with required coverage, labels, PII controls, and same-question Retell/Own-KB samples.
- Milestone 1A through 1I have since been accepted, with 1I as first-pass type/test-only evidence; current next gated step is Milestone 0.5B Trusted Retell-KB vs Own-KB Benchmark Execution with approved eval artifacts.

Plan update outcome, 2026-05-29:

- Added Milestones 1E, 1F, 1G, and 3B as plan-only acceptance criteria.
- Added Product KPI section.
- Updated Retell-KB auditability wording to distinguish post-call auditability from pre-response Own-KB governance.
- Production code, runtime flags, Retell-KB behavior, Own-KB primary state, and OpenAI Realtime scope were not changed.
- Milestone 1A through 1I have since been accepted, with 1I as first-pass type/test-only evidence; current next gated step is Milestone 0.5B Trusted Retell-KB vs Own-KB Benchmark Execution with approved eval artifacts.

Final guardrail polish outcome, 2026-05-29:

- Added sanitized external review export policy.
- Replaced existing external plan review exports with sanitized exports containing only `AGENTS.md` and `PLANS.md`.
- Tightened 0.5B trusted benchmark execution so promotion evidence requires Milestones 1A, 1B, 1D, and 1E, plus 1C before storing or processing real transcript/shadow/call-log/eval artifacts with potential PII beyond minimal local/dev testing.
- Added Retell auto-refresh/auto-crawl governance risk to Milestone 1F.
- Added architecture-drift CI/enforcement checks as planned lightweight guardrails.
- Tightened TrustedScope acceptance, DB/RLS readiness, OpenAI Realtime safety identifier planning, and first_safe_audio anti-gaming.
- Production code, runtime flags, Retell-KB behavior, Own-KB primary state, and OpenAI Realtime implementation were not changed.

98%-readiness loop outcome, 2026-05-29:

- Multi-agent review found remaining ambiguity around AGENTS/PLANS promotion sync, Canary-vs-Primary separation, active `CLAUDE.md` dependency, exception-path SLOs, post-1A ordering, Milestone 1B/1G proof criteria, Product KPI measurement, export gates, and Milestone 2 architecture-drift gating.
- Tightened those points in this plan and mirrored critical global gates in `AGENTS.md`.
- Production code, runtime flags, Retell-KB behavior, Own-KB primary state, and OpenAI Realtime implementation were not changed.

99%-readiness loop outcome, 2026-05-29:

- Added final guardrails requested by the 99%-review pass.
- Clarified that trusted 0.5B reports are necessary but never sufficient for canary start or primary.
- Mirrored exact 0.5B prerequisites in `AGENTS.md`.
- Made missing Product KPI baseline/sample/tolerance/budget/owner data `inconclusive` and rollout-blocking.
- Required high-risk `final_audited_answer_ms` target/timeout or explicit abstain/escalation policy before canary expansion.
- Required `export_sanitization_check` proof artifacts for external review exports.
- Production code, runtime flags, Retell-KB behavior, Own-KB primary state, and OpenAI Realtime implementation were not changed.

Milestone 0.5B artifact-gate outcome, 2026-05-29:

- Added approved-artifact gating in `apps/api/src/own-kb-benchmark-artifact.ts`.
- Added focused tests in `apps/api/src/__tests__/own-kb-benchmark-artifact.test.ts`.
- The gate fails closed when no artifact is supplied, when the artifact is not explicitly approved for 0.5B, when potential-PII artifacts lack the 1C redaction gate, or when the decision report is not promotion-ready.
- Repo discovery found no approved Retell-vs-Own-KB benchmark/eval artifact, so no promotion evidence was produced.
- Milestone 0.5B remains open and blocked on an explicit approved artifact.
- Production behavior, runtime flags, Retell-KB behavior, Own-KB primary state, and OpenAI Realtime implementation were not changed.

Architecture-drift guardrail outcome, 2026-05-29:

- Added first-pass static architecture-drift tests in `apps/api/src/__tests__/architecture-drift.test.ts`.
- Tests cover provider adapter imports in core/governance files, raw Retell/OpenAI event names in core/context files, OpenAI/Web and Retell `knowledge.search` schema scope-field exclusion, TrustedScope fail-closed checks, `mayMutate=false`, and full-transcript snapshot exclusion.
- Verified focused architecture tests pass.
- Production behavior, runtime flags, Retell-KB behavior, Own-KB primary state, and OpenAI Realtime implementation were not changed.

Milestone 0.5B diagnostic outcome, 2026-05-30:

- Completed a non-promotional diagnostic using local runtime credentials and existing stored shadow/call data.
- Retell API access was available and returned aggregate call latency metadata without exporting call IDs, transcripts, or raw caller content.
- Existing matched data had only 10 shadow samples, all `not_answerable` for Own-KB.
- Observed diagnostic metrics: Own-KB p95 latency 715 ms on 10 shadow samples; Retell E2E p95 6414 ms on 10 matched latency samples; Retell-KB p95 78 ms on 4 matched KB-latency samples.
- This is not 0.5B promotion evidence because no explicit approved 0.5B artifact exists, coverage is below 50 paired questions and 30 intents, quality labels are missing, and Own-KB answerability failed on the matched set.
- Own-KB primary remains blocked; Retell-KB remains production baseline/fallback.

Milestone 0.5B gate-hardening outcome, 2026-05-30:

- Updated `apps/api/src/own-kb-benchmark.ts` so `promotionEvidenceTrusted` requires Milestone 1A TrustedScope, Milestone 1B Trace Scope Correctness, Milestone 1D DB/RLS/readiness, and Milestone 1E Voice Latency Measurement Contract gates.
- Added `voiceLatencyMeasurementPassed` to `KnowledgeBenchmarkSafetyGates` and a `VOICE_LATENCY_MEASUREMENT_GATE_FAILED` blocker.
- Updated focused report and artifact tests so approved artifacts are accepted structurally but cannot become usable promotion evidence if the 1E latency-measurement gate is false.
- Added `apps/api/src/scripts/run-own-kb-benchmark-artifact.ts` and `own-kb:benchmark-artifact` so approved artifacts can be validated through a sanitized report path without printing samples, transcripts, call IDs, or raw caller content.
- Verified `corepack pnpm --filter @vas/api own-kb:benchmark-artifact` fails closed without an artifact and reports `APPROVED_BENCHMARK_ARTIFACT_MISSING`.
- Added `buildDraftBenchmarkArtifactTemplate`, `apps/api/src/scripts/create-own-kb-benchmark-artifact-template.ts`, and `own-kb:benchmark-template` to generate a `DRAFT_ONLY` 0.5B preparation artifact with 50 paired question placeholders and 30 intent placeholders.
- Focused tests prove the draft template is rejected as non-approved and that adding approval metadata alone still cannot create promotion evidence because metrics, canonical voice-latency contracts, quality labels, and sufficient auditability are missing.
- Added `buildBenchmarkArtifactGapReport` and wired it into `own-kb:benchmark-artifact` so validation output includes sanitized artifact blockers, report blockers, primary blockers, warnings, and next actions without exposing samples.
- Verified the CLI fail-closed path returns a `gapReport` with `APPROVED_BENCHMARK_ARTIFACT_MISSING` and `provide_explicit_0_5b_artifact`.
- Generated local ignored files for QA preparation:
  - `apps/api/scratch/own-kb-benchmark/retell-vs-own-kb-0.5b-draft.json`
  - `apps/api/scratch/own-kb-benchmark/retell-vs-own-kb-0.5b-labeling.csv`
  - `apps/api/scratch/own-kb-benchmark/retell-vs-own-kb-0.5b-candidate.json`
  - `apps/api/scratch/own-kb-benchmark/safety-gates-complete-no-rollout.json`
  - `apps/api/scratch/own-kb-benchmark/retell-vs-own-kb-0.5b-draft-gap-report.json`
  - `apps/api/scratch/own-kb-benchmark/README.md`
- Added `--report-only` to `own-kb:benchmark-artifact` for non-promotional QA gap-report runs; the default command still exits non-zero unless promotion evidence is usable.
- Added `buildBenchmarkLabelingCsv` and `own-kb:benchmark-pack`; the generated CSV carries canonical latency timestamp columns, quality labels, auditability labels, tenant/freshness/PII/prompt-injection labels, and `qaNotes`, while intentionally excluding transcript/caller-content columns.
- Added `applyBenchmarkLabelsCsv` and `own-kb:benchmark-apply-labels`; local import mapped 100 CSV rows back into `retell-vs-own-kb-0.5b-candidate.json` while preserving `approvedForMilestone: DRAFT_ONLY` because no explicit approval flags were supplied.
- Hardened `applyBenchmarkLabelsCsv` and `own-kb:benchmark-apply-labels` so approval metadata requires explicit `containsPotentialPii` classification; otherwise imported artifacts remain `DRAFT_ONLY` and the CLI rejects approval attempts.
- Hardened CSV-import approval integrity so an imported artifact can become `0.5B` only when every artifact sample has exactly one matching CSV row and there are no duplicate or unmatched rows.
- Aligned draft artifact typing with import reality: draft artifacts may carry PII/source-use classification metadata, but remain non-promotional until approval, row integrity, labels, metrics, and report gates pass.
- Added focused tests for all CSV row-integrity approval blockers: missing sample labels, duplicate question/provider rows, and unmatched question/provider rows.
- Added optional `--gap-output` and `--safety-gates` flags to `own-kb:benchmark-apply-labels`; local import now writes `retell-vs-own-kb-0.5b-candidate-gap-report.json` as a sanitized same-step blocker report.
- Added `summarizeBenchmarkLabelImportResult` so label-import command output reports only counts/status, not sample-key arrays.
- Verified a local `own-kb:benchmark-apply-labels` run with gap output reports row-integrity counts and `promotionEvidenceUsable: false` without printing concrete `TODO_q*` or `questionId::provider` keys.
- Removed absolute output paths from label-import JSON stdout; silent verification confirms the JSON output reports only `artifactWritten`, `gapReportWritten`, row-integrity counts, draft/approval status, and `promotionEvidenceUsable: false`.
- Removed absolute output paths from benchmark-pack JSON stdout; silent verification confirms it reports only `outputDirectoryWritten`, logical `filesWritten`, next actions, and `promotionEvidenceUsable: false`.
- Changed `own-kb:benchmark-template` to summary-only stdout; silent verification with and without `--output` confirms no full artifact, sample keys, or workspace paths are printed.
- Changed data-classification flag parsing in `own-kb:benchmark-apply-labels` to reject non-boolean values; verified invalid `--contains-potential-pii maybe` fails closed and explicit `false` still succeeds.
- Added PII/source consistency checks so real transcript, shadow-data, or call-log imports require `containsPotentialPii=true`; verified the CLI rejects inconsistent flags and the core importer keeps inconsistent artifacts draft-only.
- Added validator-level PII/source consistency checks so externally supplied approved artifacts with real-call sources marked non-PII are rejected before report generation.
- Added import-time approval timestamp validation; invalid `approvedAt` values now keep core imports draft-only and cause the CLI to fail closed.
- Replaced loose approval timestamp parsing with shared strict UTC ISO-with-milliseconds validation; focused tests cover accepted canonical timestamps and rejected date-only, offset, missing-millisecond, and normalized-invalid dates.
- Added shared neutral approver-handle validation; focused tests and CLI verification reject email-like, path-like, spaced, or mixed-case `approvedBy` values before an artifact can become `0.5B`.
- Verified the CLI fail-closed path rejects `--approved-by`/`--approved-at` without `--contains-potential-pii true|false` and does not write the requested output artifact.
- Verified generated QA pack files are ignored by `.gitignore` through the existing `**/scratch/` rule.
- Verified `corepack pnpm --filter @vas/api test -- --run src/__tests__/own-kb-benchmark.test.ts src/__tests__/own-kb-benchmark-artifact.test.ts` passes: 2 files, 50 tests.
- Verified `corepack pnpm --filter @vas/api typecheck` passes.
- Production behavior, runtime flags, Retell-KB behavior, Own-KB primary state, and OpenAI Realtime implementation were not changed.

Own-KB authoring gap-report outcome, 2026-05-30:

- Added `buildOwnKbAuthoringGapReportFromCsv` in `apps/api/src/own-kb-authoring.ts`.
- Added CLI `apps/api/src/scripts/report-own-kb-authoring-gaps.ts`, exposed as `own-kb:authoring-gaps`.
- The gap report intentionally omits caller content and redacted question text, and reports row numbers, question ID hashes, validation issues, gap categories, counts, and next actions.
- Updated generated test-transcript pack README guidance to include the sanitized authoring gap-report command.
- Ran the gap report against the local 50-row test-transcript source-authoring CSV. Result: 50 rows, 0 valid rows, 50 rows needing evidence-backed answers, 50 source titles missing, 50 review approvals missing, and 50 placeholder notes still present.
- Verified `corepack pnpm --filter @vas/api test -- --run src/__tests__/own-kb-authoring.test.ts` passes: 1 file, 26 tests.
- No Own-KB sources were generated, no promotion evidence was produced, and no production behavior, runtime flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Own-KB simulation/enrichment-loop outcome, 2026-05-30:

- Added deterministic local-business expert enrichment in `apps/api/src/own-kb-simulation-enrichment.ts`.
- Added CLI `apps/api/src/scripts/create-own-kb-simulation-enrichment.ts`, exposed as `own-kb:authoring-enrich`.
- The enrichment uses transcript-derived redacted questions to infer intent/risk/evidence needs and generate synthetic everyday-call scenarios for normal calls, noisy lines, fast speakers, ASR confusion, relative dates, corrections, interruptions, and frustrated callers.
- The expert review basis is limited to generic local-business voice safety plus researched EU allergen-information guardrails for restaurant/food-like questions. It does not create business-specific prices, hours, service availability, staff names, or policy facts.
- Added source-requirement grouping and a blank fact-intake template so a human can see which approved/current source categories must be authored before Own-KB answerability can improve.
- Ran the enrichment loop against the current 50-row local authoring CSV. Result: 50 enrichment rows, 132 synthetic simulation rows, 9 source requirement rows, intent distribution of 9 opening-hours, 14 appointment, 3 pricing, 7 services, 1 reservation, 1 menu/product, 7 clarification, 3 frustration, 1 simulation request, and 4 unknown.
- Source requirement counts from the current local run: `service_catalog` 24, `staff_or_human_escalation_policy` 22, `booking_policy` 15, `conversation_policy` 15, `business_hours_source` 9, `holiday_calendar` 9, `special_hours_source` 9, `price_list` 3, and `menu_or_product_catalog` 1.
- Generated local gitignored QA artifacts:
  - `apps/api/scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-expert-enrichment.csv`
  - `apps/api/scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-simulation-pack.json`
  - `apps/api/scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-simulation-enrichment-report.json`
  - `apps/api/scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-source-requirements.csv`
  - `apps/api/scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-fact-intake-template.csv`
  - `apps/api/scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-fact-intake-validation-report.json`
  - `apps/api/scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-fact-intake-sources.json`
- The report stdout and JSON are sanitized: `containsCallerContent=false`, `exportsRedactedQuestions=false`, `syntheticOnly=true`, `approvedForMilestone=DRAFT_ONLY`, and `promotionEvidenceUsable=false`. The local expert-enrichment CSV intentionally includes `redactedQuestion` for human authoring review; source-requirement and fact-intake outputs do not export question text.
- Source-requirements and fact-intake outputs contain only source categories, hashed question IDs, blank source/fact fields, reviewer instructions, forbidden content, and draft markers. They do not contain raw caller text, proposed business facts, approved source content, or promotion evidence.
- Added `validateOwnKbFactIntakeCsv`, `buildOwnKbSourcesFromFactIntakeCsv`, and CLI `own-kb:fact-intake-validate` so filled fact-intake templates can be checked before any later source-generation step. The validator remains non-promotional unless the entire batch validates, explicitly covers required evidence needs from a generated-style source-requirements CSV, rejects detectable PII/redaction tokens, and uses approved/current source-review state; the current local template has `sourcesWritten=false`, `createsBusinessFacts=false`, and `promotionEvidenceUsable=false`.
- Added optional `--source-requirements` coverage validation so fact-intake rows must match every required evidence need with no missing, duplicate, or extra categories.
- Ran the validator against the current blank local fact-intake template with `--output`. It failed closed with 9 rows, 0 valid rows, expected blockers for missing source title/reference/version/hash/source text, missing approval timestamps/reviewer, placeholder content, and uncleared draft markers, and wrote `test-transcript-own-kb-fact-intake-sources.json` as `[]`.
- Verified `corepack pnpm --filter @vas/api test -- --run src/__tests__/own-kb-simulation-enrichment.test.ts` passes: 1 file, 16 tests.
- Verified `corepack pnpm --filter @vas/api typecheck` passes.
- Independent review found no path where the new simulation/source-requirement/fact-intake rows can become 0.5B promotion evidence. It did flag ambiguous wording around the local enrichment CSV and `promotionEvidenceTrusted`; both were clarified.
- Full verification after the review/fix pass passed: `corepack pnpm --filter @vas/api test -- --run` with 85 test files / 704 tests.
- Sanitization scans found no dangerous promotion markers in the generated enrichment/source/fact outputs and no raw/redacted question strings in the JSON report, source-requirements CSV, or fact-intake CSV.
- No Own-KB sources were generated, no 0.5B promotion evidence was produced, and no production behavior, runtime flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.
- Follow-up hardening made both authoring and fact-intake row-to-source helpers private and requires `approved` status before source JSON generation. Verification passed: `corepack pnpm --filter @vas/api typecheck`, focused authoring/enrichment tests with 2 files / 43 tests, and full API tests with 85 files / 705 tests.
- Final independent source-generation review found three remaining blockers and they were fixed: direct transcript-derived authoring source JSON is disabled, Fact-Intake source hashes must match `sha256(sourceText)`, and synthetic `DRAFT_ONLY` source requirements no longer unlock `KnowledgeSource` output. The local authoring and fact-intake CLIs now clear output to `[]` and exit nonzero while `sourceGenerationReady=false`; no Own-KB sources or 0.5B promotion evidence were produced. Verification passed: `corepack pnpm --filter @vas/api typecheck`, focused authoring/enrichment tests with 2 files / 44 tests, and full API tests with 85 files / 706 tests.
- Follow-up contextless review first found one remaining scope-boundary blocker: the Fact-Intake CLI could pass plain `--org-id`/`--tenant-id` into a field called `trustedScope`. Fixed by requiring branded `TrustedScope` plus `isTrustedScope` checks in validation and source emission, adding a regression test that plain `{ orgId, tenantId }` is rejected, and making the CLI fail closed with `FACT_INTAKE_TRUSTED_SCOPE_CANNOT_BE_SUPPLIED_BY_CLI` if scope flags are supplied. Then approval-custody hardening added fail-closed checks for short, blank, low-entropy, or repetitive approval secrets and same-reviewer manifest approval. A later contextless review found that synthetic `DRAFT_ONLY` source requirements could still unlock source generation; fixed by requiring reviewed non-synthetic `SOURCE_REQUIREMENTS_REVIEWED` requirements before sources can be emitted. The follow-up independent re-review found no remaining blocker for this path. Remaining non-code risks are approval-secret custody and rotation, continued prompt-injection red-team expansion, and downstream import/RLS enforcement. Fresh verification passed: `corepack pnpm --filter @vas/api typecheck`, focused authoring/enrichment tests with 2 files / 57 tests, full API tests with 85 files / 719 tests, the CLI scope-flag guard fails closed, and the current blank Fact-Intake CLI path fails closed with `SOURCE_APPROVAL_MANIFEST_REQUIRED`, `SOURCE_REQUIREMENTS_ROW_INVALID`, `sourceGenerationReady=false`, `sourcesWritten=false`, and `promotionEvidenceUsable=false`. No Own-KB sources or 0.5B promotion evidence were produced.

Milestone 1A outcome, 2026-05-29:

- Added branded server-derived `TrustedScope` and explicit `UntrustedToolArgs` handling in `apps/api/src/agent-tools.ts`.
- `knowledge.search` now fails closed without `TrustedScope`.
- Model/tool args containing `orgId`, `tenantId`, `agentId`, `callId`, `sessionId`, `source`, `resolvedFrom`, `customerId`, `customerIdentity`, `authorization`, or `authContext` are treated as untrusted and logged via `untrusted_scope_arg_seen` when present.
- `TrustedScope` now requires provenance (`resolvedFrom`) and trusted agent scope before `knowledge.search` can run.
- `knowledge.search` schema keeps trusted scope fields out of model-controllable parameters and uses `additionalProperties: false`.
- Added shared `apps/api/src/trusted-scope.ts` so `TrustedScope` branding, validation, scope-like field detection, and stripping are shared by tool execution, runtime adapters, Own-KB retrieval, shadow, and eval paths.
- Lower-level `apps/api/src/own-kb.ts` `knowledgeSearch` now requires a branded `TrustedScope` and fails closed with `TRUSTED_SCOPE_REQUIRED` before touching retrieval when it is missing or invalid.
- `agent-runtime` now passes server-derived `TrustedScope` into tool execution.
- Web/OpenAI runtime uses an explicit server-owned `web_chat:<configTenant>` agent-scope fallback when no Retell agent id exists, instead of treating raw tenant scope as an agent id.
- Retell `knowledge_search` registration now uses `additionalProperties: false`.
- Scope/provenance-like model/tool args are stripped before `knowledge.search` policy evaluation and omitted from `knowledge.search` tool-call trace `argKeys`, so they cannot affect retrieval, traces, policy, or mutations.
- Internal Own-KB shadow and eval paths now create server-derived `TrustedScope` with `resolvedFrom: 'internal_job'`.
- Focused tests cover missing trusted scope, missing provenance, missing agent scope, model-supplied scope injection, same-tenant/different-org isolation, same-org/different-tenant isolation, cross-tenant sentinels, schema scope fields, and `mayMutate=false`.
- Added a static TrustedScope boundary test proving runtime `knowledgeSearch` entrypoints in `agent-tools`, Retell, Own-KB shadow, and Own-KB eval are behind TrustedScope validation/creation.
- Added behavioral Retell endpoint tests proving forged body-supplied scope fields cannot override signed/live-call context, live-call agent mismatches fail closed, missing signed agent context fails closed, disabled Own-KB rollout fails closed, and inactive calls fail closed.
- `knowledge.search` payloads hard-clamp `policy.mayMutate=false` at both OpenAI/Web and Retell boundaries.
- Verified `corepack pnpm --filter @vas/api typecheck` passes.
- Verified `corepack pnpm --filter @vas/api test -- --run src/__tests__/agent-tools-knowledge-gating.test.ts src/__tests__/agent-runtime-knowledge-tool.test.ts src/__tests__/knowledge-search-trusted-scope-boundary.test.ts src/__tests__/retell-knowledge-search-tool.test.ts src/__tests__/own-kb.test.ts src/__tests__/own-kb-shadow.test.ts` passes: 6 files, 31 tests.
- Verified `rg -n "knowledgeSearch\\(\\{[\\s\\S]{0,180}(orgId|tenantId|agentId|callId):" apps/api/src --glob "*.ts"` returns no raw-scope `knowledgeSearch` call sites.
- Multi-agent final re-review found no Milestone 1A completion blockers after the lower-level `TrustedScope`, trace-arg, and Retell schema fixes.
- Production rollout flags, Retell-KB behavior, Own-KB primary state, and OpenAI Realtime implementation were not changed.

Milestone 1A single-source review outcome, 2026-05-29:

- Rechecked 1A against `AGENTS.md` and `PLANS.md` only.
- Updated `AGENTS.md` Current Ordered Execution Path so 1A is explicitly accepted as complete and Milestone 1D is the next implementation.
- Updated this plan's completeness gate from an immediate pre-1A repair to a completed reusable completeness check.
- Marked the current ordered path with `[complete]` for Milestone 1A and `[next]` for Milestone 1D.
- No production code, runtime flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed as part of this single-source review.

Milestone 1D initial outcome, 2026-05-29:

- Added additive migration `supabase/migrations/20260529221700_own_kb_scope_readiness_validation.sql`.
- The migration validates Own-KB scope constraints that were introduced as `NOT VALID`, adds missing org/tenant scope indexes for ingestion jobs, citations, eval runs/results, voice metrics, and shadow retrieval-event lookup, and hardens stored `kb_eval_results` with non-null org/tenant scope.
- Added `scripts/check-own-kb-readiness.mjs` and wired it into `pnpm supabase:migrations:check`.
- Added live catalog-readiness checker `apps/api/src/own-kb-readiness.ts`.
- Added CLI `apps/api/src/scripts/check-own-kb-db-readiness.ts`, exposed as `pnpm own-kb:readiness`, for target-database catalog verification.
- The live checker fails on missing Own-KB tables, missing `org_id`/`tenant_id`, missing RLS, `anon`/`authenticated` grants, missing scope indexes, missing/unvalidated scope constraints, unsafe public KB views, KB-touching `SECURITY DEFINER` functions, and KB functions without explicit `org_id`/`tenant_id`.
- Removed tenant-only org resolution from Own-KB shadow/eval/gap service-role scripts; they now require explicit `--org` and `--tenant` scope.
- Added focused test coverage in `apps/api/src/__tests__/own-kb-readiness.test.ts` for the static readiness check, live catalog pass/fail behavior, and TrustedScope-scoped Own-KB retrieval/logging query patterns.
- Verified `corepack pnpm supabase:migrations:check` passes.
- Verified `corepack pnpm --filter @vas/api test -- --run src/__tests__/own-kb-readiness.test.ts` passes.
- Verified combined Milestone 1A + 1D focused tests pass: `corepack pnpm --filter @vas/api test -- --run src/__tests__/agent-tools-knowledge-gating.test.ts src/__tests__/agent-runtime-knowledge-tool.test.ts src/__tests__/knowledge-search-trusted-scope-boundary.test.ts src/__tests__/retell-knowledge-search-tool.test.ts src/__tests__/own-kb.test.ts src/__tests__/own-kb-shadow.test.ts src/__tests__/own-kb-readiness.test.ts` passes: 7 files, 36 tests.
- Verified `corepack pnpm --filter @vas/api typecheck` passes.
- Verified live target-database readiness with `corepack pnpm --filter @vas/api own-kb:readiness`; result was `ok: true` with no failures after applying the additive migration in one transaction.
- Milestone 1D is accepted as complete.
- No production runtime flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Voice Reality plan update outcome, 2026-05-29:

- Added plan-only milestones 1H, 2C, 2D, 2E, 2F, 4D, and 4E.
- Extended Product KPIs with false containment, wrongly contained calls, missed human-request escalation, repeat requests, pronunciation error rate, and opening-hours spoken correctness.
- No production code, runtime flags, real transcripts, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed as part of this Voice Reality plan update.
- Milestone 1A through 1I have since been accepted, with 1I as first-pass type/test-only evidence; current next gated step is Milestone 0.5B Trusted Retell-KB vs Own-KB Benchmark Execution with approved eval artifacts.

Milestone 1C outcome, 2026-05-29:

- Added central purpose-specific redaction APIs in `apps/api/src/pii.ts`: `redactForLog`, `redactForTrace`, `redactForEval`, `redactForShadow`, `redactForPrompt`, `redactForToolArgument`, `redactForToolResult`, `preserveForUserConfirmation`, and structured redaction.
- Replaced local email/phone regex sanitizers in runtime/tool output paths with `redactForToolResult`.
- Redacted chat trace text, Retell stored demo transcripts, Retell claimed-phone trace details, Own-KB retrieval query traces, Own-KB shadow/eval failure strings, and training/template-learning/insights prompt/eval paths by explicit purpose.
- Preserved the user-visible confirmation path through `preserveForUserConfirmation` so policy-approved read-back is not blindly redacted.
- Added focused tests covering email, German phone formats, IBAN, credit-card-like strings, address-like strings, DOB-like strings, mixed German PII phrasing, nested tool-result payloads, user-visible confirmation behavior, and Knowledge tool sanitization.
- Verified `corepack pnpm --filter @vas/api test -- --run src/__tests__/pii.test.ts src/__tests__/agent-runtime-knowledge-tool.test.ts src/__tests__/agent-tools-knowledge-gating.test.ts src/__tests__/own-kb-shadow.test.ts src/__tests__/retell-retention-webhook.test.ts src/__tests__/backfill-industry-route.test.ts` passes: 6 files, 52 tests.
- Verified `corepack pnpm --filter @vas/api typecheck` passes.
- No production rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Milestone 1B outcome, 2026-05-29:

- Added explicit trace scope fields in `apps/api/src/traces.ts`: `orgId`, `tenantScopeId`, `callId`, `provider`, `turnId`, `retrievalEventId`, `scopeSource`, and `scopeResolvedFrom`.
- Added `traceScopeFields()` so branded server-derived `TrustedScope` maps to trace fields while keeping legacy `tenantId` as the org-isolation key for backward-compatible fail-closed trace reads.
- Enriched OpenAI/Web `knowledge.search` tool traces and Retell `knowledge.search` traces with explicit org, tenant, agent, call, provider, and provenance fields.
- Added `retellTraceFields()` and applied it to Retell tool-call/tool-result trace paths so Retell tool traces distinguish org scope, tenant scope, agent, call, and provider context.
- Added focused `trace-scope` tests proving trace scope field mapping and same-tenant-id/different-org fail-closed trace reads.
- Hardened Retell Knowledge trace tests and TrustedScope boundary tests for scope/provenance trace fields.
- Verified `corepack pnpm --filter @vas/api test -- --run src/__tests__/trace-scope.test.ts src/__tests__/retell-knowledge-search-tool.test.ts src/__tests__/knowledge-search-trusted-scope-boundary.test.ts src/__tests__/retell-calendar-book-tool.test.ts src/__tests__/retell-calendar-change-tool.test.ts src/__tests__/retell-ticket-tool.test.ts src/__tests__/retell-customer-lookup-tool.test.ts src/__tests__/retell-policy-integration.test.ts` passes: 8 files, 27 tests.
- Verified `corepack pnpm --filter @vas/api typecheck` passes.
- No production rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Milestone 1E outcome, 2026-05-29:

- Added provider-neutral voice latency timestamp contract in `apps/api/src/voice-latency-contract.ts`.
- Contract covers user audio end, provider end-of-turn, ASR partial/final, Agent Core start, first model token, first speakable chunk, first safe audio, optional first filler audio, first full-answer audio, and `safe_audio_type`.
- Added safe-audio eligibility so only `evidence_backed_answer`, `targeted_clarification`, `valid_abstain`, `valid_escalation`, `policy_confirmation`, and `tool_status_update` can satisfy the 500-800 ms SLO; `filler_only` is reported separately and cannot satisfy readiness.
- Connected Retell-vs-Own-KB benchmark samples to the timestamp contract so missing contracts, invalid timestamp order, or filler-only audio block promotion readiness instead of relying on raw duration fields.
- Added focused tests in `apps/api/src/__tests__/voice-latency-contract.test.ts` and extended `apps/api/src/__tests__/own-kb-benchmark.test.ts`.
- Verified `corepack pnpm --filter @vas/api test -- --run src/__tests__/voice-latency-contract.test.ts src/__tests__/own-kb-benchmark.test.ts` passes: 2 files, 31 tests.
- Verified `corepack pnpm --filter @vas/api typecheck` passes.
- No production rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Milestone 1F outcome, 2026-05-29:

- Added Own-KB to Retell-KB sync contract in `apps/api/src/own-kb-retell-sync-contract.ts`.
- Contract tracks `own_source_id`, `source_version_id`, `source_version_hash`, Retell KB/source IDs, Retell auto-refresh/auto-crawl flags, `synced_at`, `expires_at`, `risk`, `allowed_use`, `sync_status`, and `last_sync_error`.
- Added deterministic eligibility and work planning for create/update, disable, remove, retry, or noop decisions with stable idempotency keys and planned audit events.
- Blocked unapproved, non-current, expired, archived, rejected, unsafe, disallowed, unverified auto-refresh, and unverified auto-crawl source versions from active Retell-KB sync state.
- Added `MODEL_MUST_NOT_CONTROL_SYNC` so the model can never decide sync, refresh, crawl, disable, or delete work.
- Added focused tests in `apps/api/src/__tests__/own-kb-retell-sync-contract.test.ts` and re-ran existing `apps/api/src/__tests__/knowledge-sync.test.ts`.
- Verified `corepack pnpm --filter @vas/api test -- --run src/__tests__/own-kb-retell-sync-contract.test.ts src/__tests__/knowledge-sync.test.ts` passes: 2 files, 12 tests.
- Verified `corepack pnpm --filter @vas/api typecheck` passes.
- No production rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Milestone 1G outcome, 2026-05-29:

- Added voice compliance and disclosure contract in `apps/api/src/voice-compliance-contract.ts`.
- Contract defines AI disclosure, recording-consent state, retention classes, deletion scopes, customer-data minimization proof, policy-source ownership, and required audit-event coverage.
- Missing AI disclosure or recording consent blocks the relevant flow; denied/withdrawn recording consent escalates; prompt-only compliance is explicitly rejected.
- Added focused tests in `apps/api/src/__tests__/voice-compliance-contract.test.ts` and re-ran existing recording/retention coverage.
- Verified `corepack pnpm --filter @vas/api test -- --run src/__tests__/voice-compliance-contract.test.ts src/__tests__/agent-instructions-recording.test.ts src/__tests__/retell-call-retention.test.ts src/__tests__/retell-retention-webhook.test.ts` passes: 4 files, 38 tests.
- Verified `corepack pnpm --filter @vas/api typecheck` passes.
- No production rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

Milestone 1H outcome, 2026-05-29:

- Added German voice output normalization contract in `apps/api/src/voice-output-normalization.ts`.
- Contract separates `writtenText` from `spokenText` so voice mode can speak normalized text while web/audit surfaces preserve the original written value.
- Added deterministic normalization for weekday ranges, opening hours, dates, prices, phone numbers, email addresses, URLs/domains, addresses, acronyms, and review-required brand/product/staff/city/street names.
- Transformations record kind, written value, spoken value, and `factPreserved`; pricing/legal/policy written values remain unchanged rather than rounded or reinterpreted.
- Provider-specific pronunciation dictionaries and SSML are intentionally absent from the core normalization result.
- Added focused tests in `apps/api/src/__tests__/voice-output-normalization.test.ts` and re-ran existing calendar/prompt/agent-instruction voice normalization tests.
- Verified `corepack pnpm --filter @vas/api test -- --run src/__tests__/voice-output-normalization.test.ts src/__tests__/calendar-slot-time.test.ts src/__tests__/agent-instructions-recording.test.ts src/__tests__/prompt-eval.test.ts` passes: 4 files, 56 tests.
- Verified `corepack pnpm --filter @vas/api typecheck` passes.
- No production rollout flags, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changed.

## Current Strategic Decision

Retell remains production Layer 0. Retell-KB remains production baseline, fallback, and possible runtime retriever. OpenAI Realtime remains lab/canary. Own-KB/RAG becomes the provider-neutral governance, evidence, eval, and eventually retrieval core only after parity is proven. Provider switching is allowed only after the same Agent Core, ContextContract, Tool Policy, Retrieval, Response Composer, and eval gates are shared across providers.

## Source Register

Last checked: 2026-05-29.

- Retell Custom LLM WebSocket
  URL: https://docs.retellai.com/api-references/llm-websocket
  Relevant facts:
  - Retell sends live transcript/update events.
  - Retell requests response/reminder content.
  - Server responses affect what the agent says and can affect actions such as ending calls.
  Implication:
  - Retell adapter must translate only and must not own business decisions.

- Retell Knowledge Base
  URL: https://docs.retellai.com/build/knowledge-base
  Relevant facts:
  - Retell KB content can be connected to agents and appended to prompts as related KB context.
  - Retell automatically tries to retrieve from linked KBs before every response generation and uses the transcript so far to find relevant chunks.
  - Retrieval chunk count and similarity can be configured. Defaults are 3 chunks and a 0.6 similarity threshold.
  - Retell states its KB retrieval is optimized for real-time latency and should generally add under 100 ms latency impact.
  - Retell post-call artifacts can support audit review when Get Call exposes public logs and `knowledge_base_retrieved_contents_url`.
  Implication:
  - Retell-KB remains the production latency benchmark and fallback. Retell-KB post-call auditability is useful, but it is not the same as Own-KB pre-response governance. Own-KB remains the governed source of truth/evidence layer because we need tenant scope, approval, freshness, risk, allowed-use gates, eval evidence, and pre-response auditability.

- OpenAI Realtime
  URL: https://developers.openai.com/api/docs/guides/realtime
  Relevant facts:
  - Voice-agent sessions send audio/text and receive model responses, tool calls, and session events.
  - Realtime event/session shapes can change across API versions.
  Implication:
  - OpenAI adapter must be versioned and isolated from Agent Core.

- Codex AGENTS.md
  URL: https://developers.openai.com/codex/guides/agents-md
  Relevant facts:
  - Codex discovers project instructions from `AGENTS.md`.
  - Instruction discovery is size-limited by default.
  Implication:
  - Keep `AGENTS.md` concise and use this `PLANS.md` for milestone detail.

- Codex Exec Plans
  URL: https://developers.openai.com/cookbook/articles/codex_exec_plans
  Relevant facts:
  - ExecPlans are living documents.
  - `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` should stay updated.
  Implication:
  - This file must be maintained during implementation, not treated as a static roadmap.

- Supabase RLS
  URL: https://supabase.com/docs/guides/database/postgres/row-level-security
  Relevant facts:
  - RLS policies act like automatic row filters attached to tables.
  - Exposed schemas need RLS policies that match the access model.
  Implication:
  - App-level filtering is not enough for multi-tenant KB safety.

## Non-Negotiable Promotion Gates

- Retell-KB baseline exists on the same realistic voice questions as Own-KB.
- Own-KB canary is blocked until a build-vs-Retell decision report recommends `owkb_canary_candidate` or `owkb_primary_candidate`.
- Own-KB primary is blocked until a build-vs-Retell decision report recommends `owkb_primary_candidate`; `owkb_canary_candidate` may never unlock primary.
- Own-KB canary runtime search requires explicit canary deploy unlock, approved 0.5B artifact ID, artifact SHA-256 evidence, a persisted 0.5B attestation matching that ID/SHA/decision, `owkb_canary_candidate` or `owkb_primary_candidate` decision evidence, Product KPI gates, exception-path SLO evidence, Retell standby, rollback, and kill-switch readiness.
- Own-KB primary runtime deployment requires explicit primary deploy unlock, a separate non-placeholder approved 0.5B artifact ID, separate artifact SHA-256 evidence, a separate persisted primary 0.5B attestation matching that ID/SHA/decision, explicit `owkb_primary_candidate` decision evidence, 14 clean canary days, Retell standby for 14-30 days, rollback, kill-switch, Product KPI, no unresolved P1 gaps, and explicit latency/quality/safety gate evidence.
- Runtime rollout booleans must use exact `true`; shorthand truthy values such as `1`, `yes`, or `on` are not promotion evidence.
- Rollout allowlists must list concrete org/tenant/agent IDs; wildcard `*` is not accepted inside rollout ID allowlists.
- Benchmark artifacts must include representative normal-supported and supported non-tool coverage; slow or hard turns must not be excluded from SLO measurement by relabeling them unsupported.
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
- 0 hallucinated Own-KB answers in promotion samples; hallucination labels must not conflict with `answerCorrect=true` and no P0/P1.
- Recall@5 >= 90% where retrieval is required.
- Retrieval-required samples must have Recall@5 labels; missing Recall@5 labels block promotion.
- Normal supported turns cannot be removed from the 500-800 ms SLO by marking them `answerable=false`; unsupported/stale/out-of-scope turns must be explicitly classified and counted separately.
- Same-question Retell/Own-KB samples require globally unique question fingerprints and matching provider metadata for intent, risk, stale-only, out-of-scope, German-ASR, and interruption/correction flags.
- At least top 30 real intents represented.
- Fast-path coverage >= 80% for normal real questions.
- 14 days canary without P0.
- Provider switch Retell/OpenAI requires no new business logic.
- Rollback to Retell/Retell-KB remains possible per org/agent during standby.
- Do not optimize Own-KB by weakening governance, tenant isolation, freshness, answerability, or auditability.

## Measurement Definitions

- `voice_e2e_ms`: user stops speaking -> agent begins responding.
- `normal_supported_turn`: a non-tool, non-mutation, non-escalation voice turn where safe evidence is already available via no-KB, pinned verified fact, cached answer, Retell-KB, Own-KB cache, structured fact, or measured FTS-first path.
- `kb_context_ms`: time spent choosing and retrieving safe context before response composition.
- `full_rag_ms`: Own-KB retrieval + optional vector/FTS + optional rerank + evidence classification + context build. Excludes final LLM generation and TTS unless explicitly stated.
- `first_safe_response_ms`: for high-risk turns, time to a safe acknowledgement, abstain, or clarify response.
- `final_audited_answer_ms`: for high-risk turns, time to final answer after evidence checks.
- `knowledge.search warm`: DB connection warm, tenant/org filter active, normalized query, fixed `top_k`, no ingestion work, no cold model startup.
- `Full RAG`: retrieval + optional rerank + evidence classification + ContextContract build, excluding final LLM generation and voice synthesis unless explicitly stated.
- `Voice-RAG time-to-first-audio`: finalized user utterance received -> first audible agent audio.
- `P1 pass rate`: measured on a transcript-derived eval set covering at least 30 top intents plus pricing/legal/policy edge cases.
- `14 days canary without P0`: continuous canary window with no unresolved P0 incidents, no hidden rollback disables, and evidence retention intact.
- Retell-KB latency benchmark: Retell documents real-time optimized KB retrieval and says it should generally add under 100 ms latency impact. Own-KB must explicitly measure against this benchmark before replacing Retell-KB for live voice.
- Retell-vs-Own-KB decision report: same question set, same agent scope, Retell-KB metrics, Own-KB metrics, conflict classification, and one of `keep_retell_primary`, `owkb_shadow_only`, `owkb_canary_candidate`, `owkb_primary_candidate`.
- Retell-KB benchmark method:
  - A/B Retell runtime benchmark where possible: same agent, same test questions, Retell-KB enabled vs controlled baseline, external TTFA/response latency measured.
  - Production-shadow benchmark: transcript-derived questions compare Retell-KB production response against Own-KB shadow retrieval.
  - High-risk cases must include auditability classification, not just answer correctness.

Required latency spans:

- `user_audio_end_detected_at`: local or provider-derived timestamp when caller audio is considered ended for the current turn.
- `provider_end_of_turn_at`: provider end-of-turn or turn-taking signal timestamp.
- `asr_partial_first_at`: first ASR partial transcript timestamp.
- `asr_final_at`: final ASR transcript timestamp.
- `agent_core_turn_start_at`: provider-neutral Agent Core starts handling the turn.
- `first_model_token_at`: first model token or equivalent model delta is observed.
- `first_speakable_chunk_at`: first chunk safe and ready to speak after evidence/policy checks.
- `first_safe_audio_at`: first audible safe acknowledgement, abstain, clarification, or answer audio starts.
- `first_filler_audio_at`: first audible filler-only audio starts, if any. This must be reported separately and must not satisfy the normal supported voice-turn SLO.
- `first_full_answer_audio_at`: first audible full answer audio starts when different from `first_safe_audio_at`.
- `safe_audio_type`: one of `evidence_backed_answer`, `targeted_clarification`, `valid_abstain`, `valid_escalation`, `policy_confirmation`, `tool_status_update`, or `filler_only`.
- `user_final_received_at`
- `retrieval_start` / `retrieval_end`
- `policy_start` / `policy_end`
- `context_build_start` / `context_build_end`
- `response_compose_start` / `response_compose_end`
- `first_model_token_at`
- `first_audio_at`
- `interruption_received_at`
- `barge_in_recovered_at`

The canonical `voice_e2e_ms` for the Ultra-Low-Latency SLO must be derived from `user_audio_end_detected_at` or `provider_end_of_turn_at` to `first_safe_audio_at`. Reports may additionally show `provider_end_of_turn_at -> first_safe_audio_at`, `asr_final_at -> first_safe_audio_at`, and `agent_core_turn_start_at -> first_safe_audio_at`, but they must not replace the end-to-end metric.

`first_safe_audio_at` must not be satisfied by generic filler such as "one moment" unless it also communicates a truthful, safe, task-relevant state. Only these `safe_audio_type` values may count toward the 500-800 ms SLO: `evidence_backed_answer`, `targeted_clarification`, `valid_abstain`, `valid_escalation`, `policy_confirmation`, and `tool_status_update`. `filler_only` must be reported separately and must not satisfy the normal supported voice-turn SLO. High-risk turns may use a fast safe acknowledgement only when it is truthful and task-relevant; it must not hide a slow final audited answer.

Exception-path latency:

- High-risk turns: `first_safe_audio_at` p95 <= 800 ms when the safe audio is truthful and task-relevant; `final_audited_answer_ms` must be reported separately and must not be hidden behind filler audio.
- Tool and mutation turns: first safe policy confirmation, targeted clarification, or truthful tool-status update should meet the normal first-safe-audio SLO; final tool execution latency must be reported by tool class before canary expansion.
- Barge-in: `barge_in_recovery_ms` p95 target <= 500 ms from interruption received to stale output stopped and newest user intent handled.
- Missing exception-path metrics or missing per-tool-class budgets block canary expansion.
- High-risk final answers: before canary expansion, each high-risk class must define a `final_audited_answer_ms` target/timeout or an explicit abstain/escalation policy. Missing targets/timeouts or missing policy block canary expansion and primary.

## Product KPIs

Architecture, safety, and latency gates are necessary but not sufficient. Product rollout reports must include these KPIs by org/tenant/agent and by top intent where applicable:

- `call_containment_rate`: percentage of calls resolved without human handoff when handoff was not required.
- `task_completion_rate`: percentage of calls where the intended user task was completed or correctly scheduled for follow-up.
- `wrong_escalation_rate`: percentage of calls escalated when the agent should have handled them.
- `missed_escalation_rate`: percentage of calls not escalated when policy/evidence/user state required escalation.
- `hang_up_after_silence_rate`: caller hang-ups after silence or delayed response beyond the voice SLO.
- `interruption_recovery_rate`: percentage of interruptions where the agent stops, updates state, and answers the newest user intent.
- `confirmation_correction_success_rate`: percentage of user corrections during confirmation that are acknowledged and reflected before any mutation.
- `post_call_qa_score`: human or eval-derived quality score covering correctness, tone, escalation, and policy adherence.
- `tenant_kb_coverage`: approved/current KB coverage by tenant, risk class, and source category.
- `top_intent_answerability`: answerability for top intents, including abstain correctness for unsupported intents.
- `cost_per_resolved_call`: total runtime, provider, retrieval, and tool cost divided by resolved calls.
- `false_containment_rate`: percentage of calls marked contained even though the caller's actual task was unresolved, unsafe, or should have escalated.
- `wrongly_contained_calls`: count and examples of contained calls later labeled as incorrect, incomplete, unsafe, or missing required follow-up.
- `missed_escalation_after_human_request_rate`: percentage of calls where the caller asked for a human but the agent did not escalate, transfer, schedule callback, or clearly explain the next human path.
- `repeat_request_rate`: percentage of calls where the caller repeats the same request because the agent did not understand, did not act, or answered the wrong thing.
- `pronunciation_error_rate`: rate of TTS/pronunciation issues for names, addresses, services, prices, phone numbers, URLs, acronyms, and local terms that materially hurt understanding or trust.
- `opening_hours_spoken_correctly_rate`: percentage of opening-hours answers where the spoken answer matches the current source/version and is understandable in German voice mode.

Hard gates before canary expansion:

- `wrong_escalation_rate` does not regress from baseline.
- `missed_escalation_rate` does not regress from baseline.
- `missed_escalation_after_human_request_rate` does not regress from baseline and must meet the configured target.
- `false_containment_rate` and `wrongly_contained_calls` do not exceed approved thresholds.
- `hang_up_after_silence_rate` does not exceed baseline.
- `interruption_recovery_rate` meets target.
- `top_intent_answerability` meets the coverage gate.
- `cost_per_resolved_call` stays within the approved budget band.
- `pronunciation_error_rate` and `opening_hours_spoken_correctly_rate` meet configured German voice-quality targets before canary expansion.

KPI measurement contract:

- Baseline window: at least the last 14 production days or an approved representative sample window, whichever has enough volume.
- Minimum sample size: define per org/tenant/agent and top intent before the report is trusted; if sample size is insufficient, canary expansion is blocked or explicitly marked inconclusive.
- Allowed tolerance: each non-regression gate must state the allowed absolute or relative tolerance before evaluation.
- Owner/approval source: each target or budget band must name the approving owner or documented source of truth.
- Reporting grain: report by org, tenant, agent, top intent, and risk class where applicable.
- Budget band source: cost gates must cite the approved budget band and calculation inputs.
- Missing baseline window, minimum sample size, allowed tolerance, budget-band source, or owner approval makes the KPI result `inconclusive` and blocks canary expansion and primary.
- Codex must not invent implicit KPI targets or default tolerances.
- First-pass contract evidence exists in `apps/api/src/product-kpi-contract.ts` with focused tests in `apps/api/src/__tests__/product-kpi-contract.test.ts`. Live KPI storage, dashboarding, and rollout wiring remain future work.

Monitored metrics:

- `call_containment_rate`
- `task_completion_rate`
- `confirmation_correction_success_rate`
- `post_call_qa_score`
- `tenant_kb_coverage`
- `fast_path_coverage_rate`
- `repeat_request_rate`

Acceptance:

- Product KPI reports distinguish hard canary gates from monitored metrics.
- Canary expansion cannot rely only on latency; it must also show no regression in escalation correctness, false containment, missed human-request escalation, silence/hang-up behavior, interruption recovery, answerability, pronunciation quality, opening-hours spoken correctness, or cost per resolved call.

## Ultra-Low-Latency Stop-Loss

Keep Retell-KB as production runtime retriever and block Own-KB primary if any of these are true:

- normal supported voice e2e p95 > 800 ms
- all supported non-tool voice e2e p95 > 1000 ms
- KB/context path p95 > 100 ms for normal live turns
- Own-KB misses p95/p99 targets on the same eval set
- Own-KB requires live hybrid/vector/rerank for common low-risk FAQs
- Own-KB becomes faster only by weakening governance, tenant isolation, freshness, PII, or answerability
- Retell-KB is materially faster and quality is equal or better

## Validation and Acceptance

Global done-when rules:

- Milestone 1 is not complete until Milestones 1A-1I pass, with Milestone 1I currently accepted as first-pass type/test-only contract evidence rather than production provider wiring.
- Milestone 1A and 1D remain both P0 for tenant safety because scope injection and DB/readiness enforcement are two halves of the same tenant-safety goal.
- Milestone 0.5B trusted benchmark execution may be used as promotion evidence only after Milestones 1A, 1B, 1D, and 1E pass. If 0.5B stores or processes real transcripts, shadow data, call logs, or eval artifacts containing potential PII beyond minimal local/dev testing, Milestone 1C must also pass first.
- `owkb_canary_candidate` may unlock only canary preparation/start; `owkb_primary_candidate` is required for Own-KB primary.
- Own-KB primary additionally requires 14 days canary without P0, no unresolved P1 gaps, Product KPI hard gates, rollback and kill-switch verification, Retell-KB standby for 14-30 days, and all latency/quality/safety gates.
- No milestone can be marked complete on documentation alone when it claims enforcement; it must include code/tests/readiness evidence.
- For rollout-related milestones, acceptance requires both pass/fail criteria and the command or query used to prove the result.
- For quality gates, the report must state sample size, dataset source, pass/fail counts, p95 latency, P0/P1 failures, and unresolved coverage gaps.
- For canary promotion, rollback and kill-switch behavior must be tested before expansion.

## Context and Orientation

Observed files/modules:

- `apps/api/src/agent-runtime.ts`: OpenAI web/chat agent turn loop, current prompt/tool orchestration.
- `apps/api/src/retell-webhooks.ts`: Retell lifecycle and tool endpoints.
- `apps/api/src/agent-tools.ts`: known tool registry, OpenAI tool schema, knowledge search execution.
- `apps/api/src/policy-layer.ts`: central mutation policy checks.
- `apps/api/src/own-kb.ts`: own-KB retrieval, citations, retrieval logging.
- `apps/api/src/own-kb-shadow.ts`: transcript-derived shadow runs.
- `apps/api/src/own-kb-gaps.ts`: coverage/latency gap diagnostics.
- `packages/voice-core/src/index.ts`: minimal voice provider/session abstraction and OpenAI Realtime provider reference.
- `supabase/migrations/*own_kb*`: own-KB, tenant integrity, protection windows, and shadow schema.

Current blockers:

- Own-KB coverage and answerability are not canary-ready until a validated 0.5B artifact proves same-question Retell-KB vs Own-KB coverage, labels, latency, auditability, and Product KPI gates.
- Retell-KB sync governance is contract-tested but production sync still needs a scoped Own-KB source-version path before high-risk Retell-KB runtime answers can rely on synced content.
- Tool mutation confirmation has first-pass Milestone 2D state-machine contract evidence, but live mutation flows still need controlled server-side wiring to that contract before they can be considered voice-production-ready.
- ContextContract has first-pass Milestone 3 contract evidence, business-hours/holiday resolution has first-pass Milestone 2E contract evidence, runtime degradation has first-pass Milestone 2F matrix evidence, German audio chaos has first-pass Milestone 4D eval-contract evidence, human QA labeling has first-pass Milestone 4E workflow-contract evidence, and canonical provider adapter parity has first-pass Milestone 2 fixture evidence, but live prompt assembly wiring, live source/resolver wiring, live degradation routing, live audio fixtures/execution, real labeling workflow/storage, live provider adapter wiring, and production fixture coverage remain later milestones before broad canary expansion.
- Canonical provider contract exists as types/contracts plus isolated Retell/OpenAI fixture adapters and golden same-turn normalization tests; live adapter wiring remains future implementation work.

## Interfaces and Dependencies

`TrustedScope` is the required scope object for retrieval, tool execution, traces, evals, and mutations:

```ts
type TrustedScope = {
  orgId: string;
  tenantId: string;
  agentId?: string;
  callId?: string;
  sessionId?: string;
  source: 'server';
  resolvedFrom: 'call_registry' | 'session_registry' | 'authenticated_request' | 'internal_job';
};
```

Scope producers:

- Retell tool/webhook paths resolve scope from signed tool context, live call registry, and agent config ownership.
- Web/OpenAI paths resolve scope from authenticated request/session and server-side agent config, not from the model.
- Background jobs resolve scope from durable DB rows and job input validated against ownership.

Scope consumers:

- `executeKnownTool`
- `knowledgeSearch`
- trace writers
- shadow/eval writers
- Tool Policy and Action Gateway

Forbidden dependencies:

- Model/tool args must not provide trusted `orgId`, `tenantId`, `agentId`, `callId`, user identity, or authorization context.
- Provider raw event IDs must not be used as authorization scope.
- Agent Core must not import raw Retell/OpenAI Realtime event names.

## Architecture-Drift CI / Enforcement Checks

Status: first-pass focused tests implemented in `apps/api/src/__tests__/architecture-drift.test.ts`; keep expanding these checks as Milestone 2 introduces canonical provider contracts.

Start with lightweight static tests/scripts rather than a broad framework. A focused test such as `apps/api/src/__tests__/architecture-drift.test.ts` or `apps/api/src/__tests__/architecture-boundaries.test.ts` is enough for the first pass.

Required checks:

- Agent Core, Context Engine, Tool Policy, Action Gateway, Response Composer, and Own-KB governance code must not import Retell/OpenAI Realtime provider SDKs or adapter modules directly.
- Raw Retell/OpenAI Realtime event names, websocket message shapes, provider response IDs, and provider-specific payload fields must not appear outside provider adapters, tests, fixtures, or explicitly canonicalized fields.
- Provider adapters must not import policy-layer mutation approval code except through canonical command/tool interfaces.
- `knowledge.search` tool schema must not expose trusted scope fields such as `orgId`, `tenantId`, `agentId`, `callId`, `customerId`, `authorization`, or `customerIdentity`.
- `knowledge.search` must fail closed without `TrustedScope`.
- Full provider transcript must not enter ContextContract snapshots.
- `mayMutate=false` must be preserved for `knowledge.search`.

Acceptance:

- Static import/path checks detect provider-specific dependencies outside adapters/tests/fixtures.
- Schema assertions prove `knowledge.search` does not expose trusted scope fields.
- ContextContract snapshot assertions prove full provider transcripts are excluded.
- The checks are targeted enough to run as focused CI without blocking unrelated local work.
- Milestone 2 provider-adapter/core refactors must not start until these architecture-drift checks exist and pass.

Knowledge provider decision:

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

Knowledge provider rules:

- Low-risk FAQ may use the fastest safe context provider.
- Pricing/legal/policy requires approved/current evidence and auditability.
- Retell-KB post-call retrieval artifacts may support audits when public logs and `knowledge_base_retrieved_contents_url` are available, but post-call auditability does not equal pre-response Own-KB governance.
- If Retell-KB is faster but pre-response evidence governance is not available, do not use it for high-risk primary answers unless Own-KB evidence also supports the answer or a human-approved exception exists.
- If Own-KB misses latency gates, do not force it into production.
- If neither provider has safe evidence, abstain, clarify, or escalate.

Pinned Core Context rules:

- May include stable identity facts, current date/time from runtime, short safety/behavior rules, and non-risk public metadata only when linked to source version and expiry metadata.
- Must not include pricing, legal/policy details, changing opening hours without `source_version` and `expires_at`, customer-specific data, or anything that bypasses Own-KB freshness gates.

`knowledge.search` wording:

- `knowledge.search` is a read-only evidence provider.
- It is authoritative for factual answer support only when the returned EvidencePacket passes source metadata gates.
- It is never authoritative for mutations, identity, authorization, booking, cancellation, payment, transfer, retention, deletion, or CRM changes.

## Plan of Work

Milestone 0.5 prevents Own-KB from becoming a Retell-KB replacement by assumption. Milestone 0.5A adds benchmark/eval scaffolding to compare Retell-KB and Own-KB on the same realistic voice questions. Milestone 0.5B runs/trusts the benchmark for promotion only after Milestones 1A, 1B, 1D, and 1E pass; real transcript/shadow/call-log/eval artifact storage or processing beyond minimal local/dev testing also requires Milestone 1C when potential PII is present.

Milestone 1 hardens the safety, measurement, sync, compliance, and German voice-output boundary before any provider abstraction work. Milestone 1A updates the tool execution path so `knowledge.search` can run only with server-derived `TrustedScope`. Milestone 1D proves the database/readiness layer enforces or validates the same tenant invariants. Milestone 1C separates PII redaction by purpose so privacy and voice confirmation can both work correctly. Milestone 1B fixes trace-scope evidence so future shadow/canary reports can be trusted. Milestone 1E defines the voice latency timestamp contract. Milestone 1F defines governed Own-KB to Retell-KB sync. Milestone 1G defines voice compliance and disclosure controls. Milestone 1H defines TTS-safe German voice-output normalization. Milestone 1I provides a first-pass additive type/test-only contract that makes STT, TTT, TTS, and runtime interaction separately measurable; it does not reopen completed Milestone 1A-1H work or change the current next gated step.

Only after Milestone 0.5 and Milestone 1A-1I pass should Codex implement Own-KB primary/canary work. OpenAI Realtime canary work stays blocked until the same core, context contract, policy, retrieval, response composer, eval gates, latency measurement, compliance controls, German voice reality controls, and product KPIs are shared across providers.

Current ordered execution path:

1. [complete] Milestone 1A: TrustedScope for `knowledge.search`.
2. [complete] Milestone 1D: DB/RLS/readiness validation.
3. [complete] Milestone 1C: PII redaction purpose separation.
4. [complete] Milestone 1B: Trace scope correctness.
5. [complete] Milestone 1E: Voice Latency Measurement Contract.
6. [complete] Milestone 1F: Own-KB to Retell-KB Sync Contract.
7. [complete] Milestone 1G: Voice Compliance and Disclosure Controls.
8. [complete] Milestone 1H: German Voice Output Normalization Contract.
9. [complete first pass] Milestone 1I: STT / TTT / TTS Voice Pipeline Contract.
10. [next gated] Milestone 0.5B: Trusted Retell-KB vs Own-KB Benchmark Execution.
11. [complete first pass] Architecture-drift CI checks.
12. [complete first pass] Milestone 2: Canonical Runtime Contract.
13. [complete first pass] Milestone 2C: Intent Playbooks for Top Real Calls.
14. [complete first pass] Milestone 2D: Tool Confirmation State Machine.
15. [complete first pass] Milestone 2E: Business Hours and Holiday Resolver.
16. [complete first pass] Milestone 2F: Runtime Degradation Matrix.
17. [complete first pass] Milestone 3: ContextContract.
18. [complete first pass] Milestone 3B: KB Ingestion Prompt-Injection Red-Team Suite.
19. [complete first pass] Milestone 4: P0/P1 Conversational Eval Harness.
20. [complete first pass] Milestone 4D: German Audio Chaos Eval Suite.
21. [complete first pass] Milestone 4E: Human QA and Labeling Workflow.
22. [complete first pass] Milestone 5: Shadow/Dual-Read Decision Matrix.
23. [complete first pass] Milestone 6: Rollout, Cost, And Cleanup Controls.

Any older ordering in this file is superseded by the current ordered execution path. Milestone 1A TrustedScope, Milestone 1B Trace Scope Correctness, Milestone 1C PII redaction purpose separation, Milestone 1D DB/RLS/readiness validation, Milestone 1E Voice Latency Measurement Contract, Milestone 1F Own-KB to Retell-KB Sync Contract, Milestone 1G Voice Compliance and Disclosure Controls, Milestone 1H German Voice Output Normalization Contract, and Milestone 1I STT / TTT / TTS Voice Pipeline Contract are accepted as complete or complete first pass as stated above. The next gated step is Milestone 0.5B Trusted Retell-KB vs Own-KB Benchmark Execution, but it must use approved eval data/artifacts and must not be run as an incidental side effect of unrelated implementation work.

## Concrete Steps

The next gated run should do only Milestone 0.5B Trusted Retell-KB vs Own-KB Benchmark Execution unless the user explicitly changes priority:

1. Read `AGENTS.md` and this `PLANS.md` only.
2. Use only approved benchmark/eval artifacts with the required coverage and PII controls.
3. Compare Retell-KB and Own-KB on the same questions using the Milestone 0.5A decision report and the Milestone 1E timestamp contract.
4. Do not promote Own-KB unless the report recommends `owkb_canary_candidate` or `owkb_primary_candidate` and all canary/primary gates still pass.
5. Do not enable Own-KB primary, disable/delete Retell-KB, or change production rollout flags during benchmark execution.
6. If approved eval artifacts are not available, record the blocker and do not fabricate benchmark evidence.
7. Update `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective`.

Archived addenda, reviews, and baseline plans are historical only. Active Retell-KB parity content has been merged into this `PLANS.md`; do not read archived files as implementation authority unless a future task explicitly asks for historical comparison.

Milestone 0.5B is now the next gated benchmark step unless the user explicitly changes priority. It may run/trust benchmark results as promotion evidence only with approved eval artifacts, the completed Milestone 1 guardrails, and Milestone 1C controls for any real transcript/shadow/call-log/eval artifact with potential PII. If those artifacts are not available, do not fabricate or infer benchmark evidence.

## Milestone 0: Repo Discovery And Gap Freeze

Status: complete enough for Milestone 1.

Acceptance:

- `AGENTS.md` exists with non-negotiable architecture rules.
- This `PLANS.md` exists with executable next milestones.
- Next milestone has clear files/tests/acceptance.

## Milestone 0.5A: Retell-KB Baseline And Build-vs-Retell Scaffolding

Status: scaffolding implemented; trusted benchmark execution remains blocked until Milestones 1A, 1B, 1D, and 1E pass. If real transcripts, shadow data, call logs, or eval artifacts with potential PII are stored or processed beyond minimal local/dev testing, Milestone 1C must also pass first.

Goal: create benchmark/eval scaffolding that can later prevent Own-KB from becoming primary unless it proves Retell-level latency, equal or better quality, and stronger governance in realistic voice conditions.

Scope:

- No production behavior change.
- No Own-KB primary flag.
- No Retell-KB deletion or disabling.
- No OpenAI Realtime feature work.
- Benchmark/eval scaffolding only.
- Results are provisional and not promotion evidence until Milestones 1A, 1B, 1D, and 1E pass; real transcript/shadow/call-log/eval artifact storage or processing beyond minimal local/dev testing also requires Milestone 1C when potential PII is present.
- Retell-KB remains production baseline and fallback.

Files likely touched:

- `PLANS.md`
- `apps/api/src/own-kb-shadow.ts`
- `apps/api/src/own-kb-gaps.ts`
- `apps/api/src/own-kb-eval.ts` or a new benchmark module
- `apps/api/src/scripts/*own-kb*` or a new benchmark CLI
- focused tests for the decision report

Test set:

- top 50 real caller questions
- top 30 real intents
- pricing/legal/policy cases
- stale-only cases
- out-of-scope cases
- German ASR variants
- interruption/correction cases where possible

Measure Retell-KB:

- time-to-first-audio
- KB latency impact where observable
- answer correctness
- wrong-chunk or irrelevant-context failures
- abstain behavior
- hallucination rate
- chunk count and similarity threshold
- whether retrieved context/chunk details are observable enough for audit

Measure Own-KB:

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

Decision report output:

- `keep_retell_primary`
- `owkb_shadow_only`
- `owkb_canary_candidate`
- `owkb_primary_candidate`

Acceptance:

- Benchmark plan exists for Retell-KB vs Own-KB on the same questions.
- Report metrics include answer quality, answerability, latency p50/p95/p99, time-to-first-audio, abstain behavior, and auditability.
- Report emits exactly one decision output.
- Own-KB canary remains blocked unless a trusted report recommends `owkb_canary_candidate` or `owkb_primary_candidate` and Milestones 1A, 1B, 1D, and 1E pass. If the report uses stored real transcript/shadow/call-log/eval artifacts with potential PII, Milestone 1C must also pass.
- A trusted report is necessary but never sufficient for canary start; actual canary start is governed by the Milestone 6 Canary/Primary readiness matrix.
- Own-KB primary remains blocked unless a trusted report recommends `owkb_primary_candidate`; `owkb_canary_candidate` may never unlock primary.
- Retell-KB remains production if it is materially faster, Own-KB misses p95/p99 targets, Own-KB has unresolved P0/P1 quality gaps, or Own-KB only becomes faster by weakening governance.

## Milestone 0.5B: Trusted Retell-KB vs Own-KB Benchmark Execution

Status: safety preconditions 1A, 1B, 1C, 1D, and 1E are complete. Approved-artifact gate scaffolding exists, but repo discovery found no approved Retell-vs-Own-KB benchmark/eval artifact. Execution remains blocked until an explicit 0.5B-approved artifact is provided. Real transcript/shadow/call-log/eval artifact storage or processing beyond minimal local/dev testing remains subject to the Milestone 1C purpose-specific PII redaction controls.

Goal: run and trust the Retell-KB vs Own-KB benchmark as promotion evidence only after application scope, trace/shadow/eval scope, database/readiness tenant invariants, and canonical voice-latency measurement gates are enforced.

Rationale:

- Milestone 1A proves server-derived scope at the tool boundary.
- Milestone 1B proves trace/shadow/eval scope correctness.
- Milestone 1D proves DB/RLS/readiness tenant invariants.
- Milestone 1E proves latency evidence uses the canonical timestamp contract.
- Milestone 1C protects transcript/eval/shadow data from raw PII leakage when real artifacts are stored or processed beyond minimal local/dev testing.

Acceptance:

- Milestone 1A TrustedScope is complete.
- Milestone 1B Trace Scope Correctness is complete.
- Milestone 1D DB/RLS/readiness validation is complete.
- Milestone 1E Voice Latency Measurement Contract is complete.
- Milestone 1C PII Purpose Redaction is complete before storing or processing real transcripts, shadow data, call logs, or eval artifacts with potential PII beyond minimal local/dev testing.
- An explicit 0.5B-approved benchmark/eval artifact exists with approver, approval timestamp, PII classification, and Retell/Own-KB samples.
- If no approved artifact exists, benchmark execution fails closed and produces no promotion evidence.
- Same realistic voice question set is used for Retell-KB and Own-KB.
- Report includes A/B Retell runtime measurements where possible and production-shadow comparisons.
- High-risk cases include auditability classification and Own-KB evidence support or a documented human-approved exception.
- Report emits exactly one decision output.
- Trusted report output is necessary but never sufficient for canary start or primary; rollout remains governed by Milestone 6.
- Promotion remains blocked on any unresolved P0, repeated P1, latency gate breach, auditability gap for high-risk answers, or governance-weakening optimization.

## Milestone 1: Scope And Privacy Hardening Before New Architecture

Status: complete for Milestone 1A-1I guardrails, with Milestone 1I accepted as a first-pass type/test-only voice pipeline contract. Next gated step is Milestone 0.5B Trusted Retell-KB vs Own-KB Benchmark Execution with approved eval artifacts.

Goal: close the highest-risk correctness gaps before adding more provider abstraction.

Files likely touched:

- `apps/api/src/agent-tools.ts`
- `apps/api/src/agent-runtime.ts`
- `apps/api/src/retell-webhooks.ts`
- `apps/api/src/pii.ts`
- `apps/api/src/__tests__/agent-tools-knowledge-gating.test.ts`
- `apps/api/src/__tests__/agent-runtime-knowledge-tool.test.ts`
- `apps/api/src/__tests__/retell-policy-integration.test.ts` or a new focused test
- `scripts/check-supabase-migrations.mjs` or a new readiness/check script if DB validation is added

### Milestone 1A: TrustedScope For `knowledge.search`

Status: complete.

Goal: make it impossible for model/tool arguments to provide or override orgId, tenantId, agentId, callId, customer identity, or authorization context for `knowledge.search`.

Files likely touched:

- `apps/api/src/agent-tools.ts`
- `apps/api/src/agent-runtime.ts`
- `apps/api/src/retell-webhooks.ts`
- `apps/api/src/__tests__/agent-tools-knowledge-gating.test.ts`
- `apps/api/src/__tests__/agent-runtime-knowledge-tool.test.ts`

Required interface:

```ts
type TrustedScope = {
  orgId: string;
  tenantId: string;
  agentId?: string;
  callId?: string;
  sessionId?: string;
  source: 'server';
  resolvedFrom: 'call_registry' | 'session_registry' | 'authenticated_request' | 'internal_job';
};

type UntrustedToolArgs = Record<string, unknown>;
```

Tasks:

1. Define or reuse `TrustedScope` for tool execution. Use a branded/opaque type where practical so plain objects from model/tool args cannot be accidentally treated as trusted scope.
2. Introduce `UntrustedToolArgs = Record<string, unknown>` or an equivalent explicit type for model-provided tool arguments.
3. Require trusted `orgId` in `executeKnownTool` for `knowledge.search`.
4. Pass `orgId` to `knowledgeSearch` from trusted server context, not from `tenantId`.
5. Fail closed if `knowledge.search` lacks trusted org/tenant/agent scope.
6. Ensure `knowledge.search` tool schema does not accept trusted `orgId`, `tenantId`, `agentId`, `callId`, `customerId`, `customerIdentity`, `authorization`, or `authContext` from model args.
7. Use `additionalProperties: false` for the `knowledge.search` JSON schema where compatible.
8. Tool args containing scope-like fields must be rejected or logged as a security event, not silently trusted. Suggested security event: `untrusted_scope_arg_seen`.
9. Add tests proving model/tool args cannot set or override org/tenant/agent/call/customer/authorization scope.
10. Add tests with same `tenantId` in two orgs proving cross-org leakage is impossible.
11. Add tests with same `orgId` and two `tenantId` values proving cross-tenant leakage is impossible.
12. Add tests with cross-tenant sentinel strings proving cross-tenant retrieval is impossible.
13. Ensure model-supplied customer identity or authorization context is rejected or logged as untrusted.
14. Ensure `knowledge.search` remains read-only and returns `mayMutate=false`.

Validation:

- Before the fix, the new test should fail because trusted scope is missing or ambiguous.
- After the fix, the same test must pass.
- Required tests:
  - missing `TrustedScope` rejects `knowledge.search`
  - model-supplied `orgId`/`tenantId`/`agentId`/`callId`/`customerId` is rejected or logged as `untrusted_scope_arg_seen`
  - same `tenantId` in two orgs cannot leak
  - same `orgId` with two `tenantId` values cannot leak
  - `orgId !== tenantId` remains correctly scoped
  - cross-tenant sentinel chunk is never returned
  - result policy keeps `mayMutate=false`
- Run:

```bash
corepack pnpm --filter @vas/api typecheck
corepack pnpm --filter @vas/api test -- apps/api/src/__tests__/agent-tools-knowledge-gating.test.ts apps/api/src/__tests__/agent-runtime-knowledge-tool.test.ts
```

Acceptance:

- `executeKnownTool` requires trusted scope for `knowledge.search`.
- `knowledge.search` fails closed if trusted scope is missing.
- Model-supplied scope is rejected or logged as a security event and never trusted.
- Model-supplied scope or authorization context cannot affect retrieval, traces, policy, or mutations.
- `knownToolSchemas` for `knowledge.search` do not contain `orgId`, `tenantId`, `agentId`, `callId`, `customerId`, `customerIdentity`, `authorization`, or `authContext`.
- A reviewer can grep the tool schema and confirm trusted scope is not model-controllable.
- Focused tests pass.
- No production rollout flag changes.

### Milestone 1B: Trace Scope Correctness

Status: complete. Explicit trace scope fields, TrustedScope-to-trace mapping, Retell tool trace enrichment, fail-closed trace isolation tests, and focused Retell/Knowledge boundary tests passed.

Goal: trace/eval/shadow records must not confuse org and tenant scope.

Files likely touched:

- `apps/api/src/agent-tools.ts`
- `apps/api/src/agent-runtime.ts`
- `apps/api/src/retell-webhooks.ts`
- `apps/api/src/own-kb.ts`
- `apps/api/src/own-kb-shadow.ts`
- `apps/api/src/own-kb-eval.ts`
- `apps/api/src/__tests__/agent-runtime-knowledge-tool.test.ts`
- `apps/api/src/__tests__/agent-tools-knowledge-gating.test.ts`
- `apps/api/src/__tests__/own-kb-shadow.test.ts`
- a new focused trace-scope test if needed

Tasks:

1. Fix Retell knowledge trace fields if any `tenantId` is logged as `orgId`.
2. Add test coverage for Retell `knowledge.search` traces.
3. Ensure retrieval events, citations, and shadow results carry the intended scope fields.
4. Add cross-org trace fixtures where the same `tenantId` exists in two orgs.
5. Add cross-tenant trace fixtures where the same `orgId` has two `tenantId` values.
6. Assert shadow/eval records carry trusted `orgId`, `tenantId`, `agentId`, `callId` or `sessionId`, and provider correlation separately.
7. Assert Retell traces do not collapse `orgId` and `tenantId`.
8. Assert raw provider IDs and model-supplied scope-like args are correlation or rejected security evidence, never trace authority.

Validation:

```bash
corepack pnpm --filter @vas/api typecheck
corepack pnpm --filter @vas/api test -- apps/api/src/__tests__/agent-runtime-knowledge-tool.test.ts apps/api/src/__tests__/agent-tools-knowledge-gating.test.ts apps/api/src/__tests__/own-kb-shadow.test.ts
```

Acceptance:

- Trace fields distinguish org, tenant, agent, call, and provider context.
- No trace can make cross-tenant evidence look same-tenant.
- No shadow/eval report can be trusted unless scope fields are server-derived and provider/model scope fields are non-authoritative.
- Milestone 1B cannot be marked complete by adding trace fields alone; it requires focused tests or readiness assertions proving cross-org and cross-tenant trace correctness.

### Milestone 1C: PII Redaction Purpose Separation

Status: complete. Purpose-specific redaction APIs, runtime/tool/trace/shadow/eval/training call sites, user-visible confirmation behavior, focused tests, and API typecheck passed.

Goal: avoid both privacy leaks and broken user-visible confirmations.

Define central PII utilities with explicit purpose:

```ts
type RedactionPurpose =
  | 'log'
  | 'trace'
  | 'eval'
  | 'shadow'
  | 'prompt'
  | 'tool_argument'
  | 'tool_result'
  | 'voice_user_visible_confirmation';
```

- `redactForLog`
- `redactForTrace`
- `redactForEval`
- `redactForPrompt`
- `redactForToolArgument`
- `redactForToolResult`
- `preserveForUserConfirmation` when policy allows user-visible confirmation

Tasks:

1. Replace local email/phone sanitizers in runtime/tool output paths.
2. Keep user-visible read-back possible when policy requires confirmation.
3. Ensure shadow/eval logs never store raw PII.
4. Add tests for email, German phone formats, IBAN-like strings, credit-card-like strings, address-like strings, DOB-like strings, free German PII phrasing, and tool result payloads.

Acceptance:

- Logs/traces/evals never store raw phone/email unless explicitly allowlisted.
- Voice user-visible output is not blindly redacted when the task requires read-back confirmation.
- Tests cover redaction and allowed confirmation.

### Milestone 1D: DB Scope/RLS/Readiness Validation

Status: complete. Static migration/readiness checks, live catalog-readiness CLI, target-database migration application, and live target-database readiness all passed.

Goal: tenant safety must not rely on app code alone.

Tasks:

1. Verify RLS status for Own-KB tables where applicable.
2. Verify every Own-KB query has trusted org/tenant filters.
3. Add a migration/readiness check that fails if KB tables lack required scope columns.
4. Add readiness failure for unvalidated KB scope constraints.
5. Add cross-tenant sentinel fixture tests.
6. Add one test or check where missing app-level scope is caught by DB/readiness.
7. Check `pg_class.relrowsecurity`, `pg_class.relforcerowsecurity` when RLS is expected.
8. Check public grants for `anon` and `authenticated` on private KB tables.
9. Check `pg_constraint.convalidated=false` for KB scope constraints.
10. Check exposed-schema posture and document any service-role-only exception.
11. Verify views over private KB tables are either `security_invoker=true` or not accessible to `anon`/`authenticated`.
12. Verify RPC/functions touching KB tables require explicit `org_id` and `tenant_id`, or use server-derived scope through a scoped repository path.
13. Deny `SECURITY DEFINER` functions touching KB data unless they are explicitly allowlisted and tested.
14. Verify service-role KB access paths call scoped repository functions only; no raw unscoped private KB table reads.
15. Index or performance-review RLS policy columns used for org/tenant filtering so latency pressure does not incentivize bypassing RLS.

Acceptance:

- No Own-KB read path can return chunks without trusted org/tenant scope.
- Readiness fails if live DB constraints/RLS/scope checks are missing or unvalidated.
- `anon` and `authenticated` do not have private KB table grants unless explicit RLS policies and access model exist.
- Readiness fails if private-KB views, RPC/functions, `SECURITY DEFINER` functions, service-role access paths, or RLS filter-column performance posture are unverified.

### Milestone 1E: Voice Latency Measurement Contract

Status: complete.

Goal: make the 500-800 ms voice SLO measurable in a provider-neutral and auditable way.

Required timestamp contract:

- `user_audio_end_detected_at`
- `provider_end_of_turn_at`
- `asr_partial_first_at`
- `asr_final_at`
- `agent_core_turn_start_at`
- `first_model_token_at`
- `first_speakable_chunk_at`
- `first_safe_audio_at`
- `first_filler_audio_at` optional, for filler-only audio that must not satisfy the normal supported voice-turn SLO
- `first_full_answer_audio_at`
- `safe_audio_type`: `evidence_backed_answer | targeted_clarification | valid_abstain | valid_escalation | policy_confirmation | tool_status_update | filler_only`

Tasks:

1. Define a provider-neutral voice latency event schema.
2. Map Retell timestamps into the contract without letting Retell-specific fields leak into Agent Core decisions.
3. Add OpenAI Realtime lab/stub mapping only after the canonical runtime contract exists.
4. Make `voice_e2e_ms` derive from user audio end or provider end-of-turn to `first_safe_audio_at`.
5. Separately report `first_safe_audio_at` and `first_full_answer_audio_at` so high-risk turns can acknowledge quickly without hiding slower audited final answers.
6. Track `first_filler_audio_at` separately from `first_safe_audio_at`.
7. Require `safe_audio_type` for latency reports.
8. Ensure `filler_only` does not count toward the 500-800 ms normal supported voice-turn SLO.
9. Add tests proving missing required timestamps fail report readiness rather than silently passing.
10. Add tests proving generic filler such as "one moment" cannot satisfy `first_safe_audio_at` unless it also communicates a truthful, safe, task-relevant state.

Acceptance:

- Reports include all required timestamp fields or explicitly fail readiness.
- `voice_e2e_ms` is consistently defined and cannot be replaced by a shorter internal-only span.
- `first_safe_audio_at` is counted only for `evidence_backed_answer`, `targeted_clarification`, `valid_abstain`, `valid_escalation`, `policy_confirmation`, or `tool_status_update`.
- `filler_only` is reported separately and does not satisfy the normal supported voice-turn SLO.
- Reports can break down ASR latency, Agent Core latency, model latency, first speakable chunk latency, first safe audio latency, and full answer latency.
- Barge-in/interruption recovery can be measured against the same turn/call identifiers.
- No production provider behavior changes are introduced by this milestone unless separately approved.

### Milestone 1F: Own-KB To Retell-KB Sync Contract

Status: complete.

Goal: allow Retell-KB to remain the low-latency runtime retriever only when synced content is governed by Own-KB source approval, freshness, risk, and allowed-use metadata.

Rules:

- Only approved/current Own-KB source versions may sync to Retell-KB.
- Retell-KB content synced from Own-KB must not be allowed to change outside Own-KB governance.
- For Own-KB-governed Retell-KB sources, Retell auto-refresh and auto-crawl must be disabled unless refreshed/crawled content is routed back through Own-KB ingestion, approval, versioning, hashing, risk classification, `allowed_use` checks, and `expires_at` checks before it can become active runtime content.
- If Retell auto-refresh or auto-crawl is enabled for any source, the source must be marked `external_runtime_refresh_enabled` and cannot be used for high-risk pricing/legal/policy answers unless Own-KB verifies the resulting content version.
- Expired, unapproved, archived, rejected, unsafe, or disallowed Own-KB source versions must deterministically update, disable, or remove corresponding Retell-KB runtime content.
- Sync must be deterministic infrastructure. The model must never decide what to sync, refresh, crawl, disable, or delete.

Synced Retell-KB items must track:

- `own_source_id`
- `source_version_id`
- `source_version_hash`
- `retell_knowledge_base_id`
- `retell_source_id` where available
- `retell_auto_refresh_enabled`
- `retell_auto_crawl_enabled`
- `synced_at`
- `expires_at`
- `risk`
- `allowed_use`
- `sync_status`
- `last_sync_error`

Tasks:

1. Define the sync metadata contract and idempotency key.
2. Define how source approval/currentness changes propagate to Retell-KB.
3. Define how expired/unapproved source versions disable, update, or remove synced Retell-KB content.
4. Define retry and durable error handling for Retell sync failures.
5. Define audit events for create/update/remove/disable sync actions.
6. Define how Retell auto-refresh/auto-crawl settings are disabled, or routed through Own-KB governance before refreshed/crawled content can become active runtime content.
7. Add tests that unapproved, expired, unsafe, disallowed, auto-refreshed-unverified, or stale source versions cannot remain active in Retell-KB sync state.

Acceptance:

- Retell-KB runtime content can be traced back to Own-KB source/version/hash metadata.
- Retell-KB synced content cannot change outside Own-KB governance.
- Retell auto-refresh/auto-crawl cannot bypass Own-KB ingestion, approval, versioning, hashing, risk, allowed-use, and freshness gates.
- No unapproved or expired source version can be newly synced.
- Source status changes produce deterministic update/disable/remove work.
- Sync failures are durable and visible in readiness/reporting.
- Retell-KB remains a runtime retriever; Own-KB remains the governed source of truth.

### Milestone 1G: Voice Compliance And Disclosure Controls

Status: complete.

Goal: ensure voice-agent operation satisfies disclosure, consent, retention, deletion, minimization, and audit obligations before broader canary expansion.

Controls:

- AI disclosure: caller-facing disclosure that the user is interacting with an AI agent where required by law, customer policy, or tenant configuration.
- Call recording consent: configurable consent flow, regional/tenant policy awareness, and fallback behavior when consent is missing or declined.
- Retention: per-tenant retention windows for raw audio, transcripts, traces, evals, shadow data, and tool/audit logs.
- DPA/deletion workflow: tenant/customer deletion requests must propagate through call artifacts, KB-derived personal data where applicable, traces, evals, and shadow results.
- Customer-data minimization: collect and store only data necessary for the task, policy, audit, or legal retention.
- Audit events: immutable enough events for disclosure shown, consent status, recording state, retention decision, deletion request, deletion completion, and policy exceptions.
- Regional/tenant policy source: every disclosure, consent, retention, and deletion rule must cite the source of truth or tenant policy owner.
- Failure modes: missing required disclosure or consent must block, abstain, or escalate the risky flow; it must not be solved by copying generic text into a prompt.

Tasks:

1. Define disclosure and recording-consent state in the call/session model.
2. Define retention classes for audio, transcript, redacted transcript, trace, eval, shadow, and tool/audit artifacts.
3. Define deletion workflow and verification report requirements.
4. Define customer-data minimization checks for prompts, traces, evals, and tool payloads.
5. Add tests or readiness checks proving calls cannot enter non-compliant recording/storage modes for configured tenants.
6. Define policy-source ownership for regional and tenant-specific disclosure/recording/retention/deletion rules.
7. Add failure-mode tests for missing disclosure, denied recording consent, missing retention policy, and deletion workflow failure.
8. Add proof artifacts: policy-source reference, audit-event schema, readiness report, and focused tests.

Acceptance:

- Tenant policy can require AI disclosure before normal handling proceeds.
- Recording consent is captured, denied, or escalated according to tenant/regional policy.
- Retention windows and deletion workflows cover raw and derived artifacts.
- Raw customer data is minimized in prompts, evals, and shadow artifacts.
- Audit events exist for disclosure, consent, retention, deletion, and exceptions.
- Missing required disclosure or consent blocks, abstains, or escalates the relevant flow.
- Compliance completion requires proof artifacts and tests/readiness checks, not only prompt copy.
- Regional and tenant policy source/owner is recorded for every compliance rule used in canary decisions.

### Milestone 1H: German Voice Output Normalization Contract

Status: complete.

Goal: make German voice output understandable, TTS-safe, and evidence-preserving without changing factual values or moving provider-specific pronunciation logic into Agent Core.

Normalization must cover:

- weekdays and ranges, for example `Mo-Fr` -> `Montag bis Freitag`
- opening hours, for example `9-18 Uhr` -> `von neun bis achtzehn Uhr`
- dates
- prices
- phone numbers
- email addresses
- URLs and domains
- addresses
- acronyms
- brand, product, staff, city, and street names

Contract:

- Voice mode should produce both `writtenText` and `spokenText` where text contains pronunciation-sensitive tokens.
- Web mode may keep `writtenText`.
- Voice mode must use `spokenText` for TTS or provider speech output.
- Normalization must be deterministic and auditable back to the source field/value.
- Provider-specific pronunciation dictionaries, SSML quirks, phoneme hints, and voice-provider workarounds must stay inside runtime/adapters.
- Agent Core may request normalized spoken output but must not import provider-specific pronunciation APIs.

Acceptance:

- Normalization preserves evidence-backed facts.
- Pricing/legal/policy values are not changed, rounded, softened, or reinterpreted.
- `spokenText` is used in voice mode for normalized values.
- `writtenText` remains available for web, trace, and audit surfaces.
- Tests cover weekday ranges, opening hours, dates, prices, phone numbers, email addresses, URLs/domains, addresses, acronyms, and representative German names.
- Provider-specific pronunciation dictionaries stay inside runtime/adapters.
- If normalization confidence is low for brand/product/staff/city/street names, the report marks the case for review rather than inventing pronunciation.

### Milestone 1I: STT / TTT / TTS Voice Pipeline Contract

Status: first-pass additive type/test-only contract implemented. This milestone must be expanded with provider fixtures before any future work claims production STT, TTT, or TTS readiness. It does not change production behavior or enable Own-KB primary.

Goal: make the voice pipeline explicitly separable into speech-to-text input, text reasoning/response composition, text-to-speech output, and runtime interaction so failures and latency are attributable to the right layer.

Pipeline layers:

1. Voice Input / STT Layer
   - Captures speech-to-text input before Agent Core reasoning.
   - Required fields:
     - `stt_audio_start_at`
     - `stt_audio_end_detected_at`
     - `stt_provider_end_of_turn_at`
     - `stt_partial_first_at`
     - `stt_final_at`
     - `stt_confidence`
     - `stt_locale`
     - `stt_transcript_redaction_state`: `raw_not_stored | redacted | pii_allowed_for_user_confirmation`
     - `stt_transcript_source`: provider/runtime source identifier normalized to a canonical value
   - Provider-specific STT event names, confidence scales, acoustic metadata, transcript payload shapes, and ASR runtime settings stay inside runtime/adapters.
   - STT latency and quality must be measured separately from text reasoning and TTS.

2. Text Reasoning / TTT Layer
   - Runs provider-neutral text reasoning and response planning.
   - Required fields:
     - `canonical_user_utterance`
     - `canonical_user_utterance_redaction_state`
     - `intent`
     - `task_state`
     - `required_fields_state`
     - `evidence_decision`
     - `policy_decision`
     - `tool_decision`
     - `response_plan`
     - `abstain_or_escalation_reason`
   - This layer includes Agent Core, Context Engine, Own-KB evidence decisions, Tool Policy, Action Gateway planning, and Response Composer.
   - TTT must not import provider-specific STT/TTS SDKs, event names, pronunciation dictionaries, audio payload formats, or transport message shapes.

3. Voice Output / TTS Layer
   - Converts the response plan into safe spoken output.
   - Required fields:
     - `writtenText`
     - `spokenText`
     - `safe_audio_type`
     - `first_safe_audio_at`
     - `first_full_answer_audio_at`
     - `tts_audio_start_at`
     - `tts_audio_end_at`
     - `pronunciation_profile`
     - `pronunciation_review_required`
   - `spokenText` must preserve evidence-backed facts and must not change pricing/legal/policy values.
   - German spokenText/TTS normalization from Milestone 1H remains required.
   - Provider-specific pronunciation dictionaries, SSML, phoneme hints, voice IDs, codec settings, and TTS provider payloads stay inside runtime/adapters.

4. Runtime Interaction Layer
   - Coordinates turn-taking, interruptions, barge-in recovery, streaming, provider response correlation, telephony/WebRTC/WebSocket transport, audio playback, and session lifecycle.
   - Runtime interaction can emit canonical events/commands but must not decide business policy, retrieval scope, mutation approval, tenant scope, or answer truthfulness.
   - Runtime metrics must distinguish transport delay from STT, TTT, and TTS delay.

Tests and evals:

- Add eval labels that distinguish:
  - ASR/STT failure: wrong or low-confidence transcript, locale mismatch, partial/final instability, missing redaction state.
  - Text reasoning/TTT failure: correct transcript but wrong intent, wrong task state, unsupported evidence decision, wrong policy decision, bad response plan, missing abstain/escalation.
  - TTS/spoken-output failure: correct written answer but wrong `spokenText`, pronunciation failure, unsafe filler counted as safe audio, German normalization error, changed factual value.
  - Runtime interaction failure: interruption ignored, stale audio continues, barge-in recovery slow, provider response correlation wrong, streaming finality mishandled.
- Evals must separately report STT latency, TTT latency, TTS first-safe-audio latency, TTS full-answer latency, and runtime interaction delay.
- German audio chaos evals from Milestone 4D must classify failures by STT, TTT, TTS, or runtime interaction instead of only pass/fail text correctness.

Acceptance:

- STT, TTT, TTS, and Runtime Interaction are explicitly represented as separate conceptual pipeline layers.
- STT/TTS quality and latency can be measured separately from Agent Core / TTT reasoning.
- `canonical_user_utterance`, `response_plan`, `writtenText`, and `spokenText` are distinct and traceable.
- German `spokenText`/TTS normalization remains required and provider-neutral.
- Provider-specific STT/TTS details stay inside runtime/adapters.
- Tests/evals distinguish ASR failure, text reasoning failure, TTS/spoken-output failure, and runtime interaction failure.
- No production runtime behavior, rollout flag, Retell-KB behavior, Own-KB primary state, or OpenAI Realtime implementation changes are introduced by this additive type/test-only milestone.

### Milestone 1J: Turn-Taking / Endpointing Guard

Status: first-pass additive type/test-only guard implemented; live canary wiring remains future work.

Goal: improve conversation timing without harming the 500-800 ms SLO. The guard may advise when to respond, briefly wait, keep listening, or ask a repair prompt based on normalized STT/VAD/update state. It must not become a blocking LLM layer before orchestration.

Contract:

```ts
type TurnTakingGuardAction = 'respond_now' | 'wait_short' | 'keep_listening' | 'repair_prompt';

type TurnTakingGuardDecision = {
  action: TurnTakingGuardAction;
  reason:
    | 'final_transcript_complete'
    | 'partial_still_changing'
    | 'trailing_connector'
    | 'low_asr_confidence'
    | 'interruption_or_correction'
    | 'long_silence'
    | 'inaudible_streak'
    | 'empty_or_missing_text';
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

Acceptance:

- Retell remains the current voice runtime; this guard improves Custom Runtime behavior without replacing provider audio endpointing by assumption.
- Normal path makes no extra LLM call, no extra KB call, and no network call.
- Guard decision p95 <= 20 ms on a 1000-case synthetic simulation.
- Final German utterances can respond immediately.
- Trailing connectors, unstable partials, low-confidence ASR, interruption/correction phrases, inaudible streaks, and true silence are distinguished.
- Inaudible speech and low-confidence speech can ask repair prompts but cannot authorize `EndCall`.
- Guard output cannot select KB facts, authorize tools, mutate state, decide tenant scope, or override Agent Core policy.
- Future canary wiring must use the guard as advisory runtime state only and must remain behind explicit canary approval.

## Milestone 2: Canonical Runtime Contract

Status: first-pass additive type/test-only contract plus isolated fixture adapters implemented. Retell/OpenAI golden same-turn normalization and adapter isolation checks pass. Live provider-adapter wiring and production fixture coverage remain future work.

Goal: make provider-neutrality testable.

Files likely added:

- `apps/api/src/voice-runtime-contract.ts`
- `apps/api/src/provider-adapters/retell-adapter.ts`
- `apps/api/src/provider-adapters/openai-realtime-adapter.ts`
- `apps/api/src/__tests__/voice-runtime-contract.test.ts`
- `apps/api/src/__tests__/provider-neutral-decision.test.ts`

Canonical base fields:

- `eventId`
- `traceId`
- `trustedScope`
- `provider`
- `channel`
- `providerEventId`
- `providerCallId`
- `providerSessionId`
- `sequence`
- `occurredAt`
- `receivedAt`

Runtime provider and channel must be distinct:

```ts
type RuntimeProvider = 'retell' | 'openai_realtime' | 'web_chat' | 'unknown';
type InteractionChannel = 'voice' | 'web' | 'internal_test';
```

OpenAI Realtime safety identifier rule:

- OpenAI Realtime remains lab/canary only.
- When an end-user identity exists, the OpenAI Realtime adapter should attach a stable, privacy-preserving safety identifier, for example `HMAC(user_id, server_secret)`.
- The identifier must not contain phone, email, name, `orgId`, `tenantId`, raw customer ID, or raw user ID.
- The safety identifier is abuse-monitoring metadata only.
- The safety identifier must never become `TrustedScope`, tenant scope, auth scope, or retrieval scope.
- Do not implement OpenAI Realtime features until a future milestone explicitly allows it.

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

Tasks:

1. Define canonical event and command TypeScript unions.
2. Define adapter interfaces.
3. Add Retell fixture mapping from raw event shape to canonical event.
4. Add OpenAI Realtime fixture mapping or lab stub mapping.
5. Add tests proving adapters do not return policy/tool/business decisions.
6. Add golden fixture test: same user turn normalized from both providers reaches the same core-facing event.
7. Ensure Retell full transcript is reduced to current utterance, redacted recent turns, compact state, and provider response IDs.
8. Ensure OpenAI Realtime GA/beta event names are contained inside versioned adapters.
9. Ensure `UpdateRuntimeTuning` can change only transport/runtime-safe parameters.

Minimal adapter interface:

```ts
interface ProviderAdapter<RawEvent, ProviderMessage> {
  normalizeEvent(raw: RawEvent): CanonicalEvent[];
  renderCommand(command: RuntimeCommand): ProviderMessage[];
}
```

Acceptance:

- Architecture-drift checks exist and pass before provider-adapter/core refactors begin.
- Provider adapters contain translation only.
- Same canonical input can be generated from Retell/OpenAI fixtures.
- Turn IDs, response IDs, sequence, finality, and interruptibility are represented.
- Tests prove Retell `response_id`/interrupt events and OpenAI response/audio deltas normalize into the same canonical `turnId`, `responseId`, `sequence`, and finality fields.
- No production Retell behavior changes unless explicitly wrapped in tests.

## Milestone 2C: Intent Playbooks For Top Real Calls

Status: first-pass additive type/test-only contract implemented. Real tenant/industry top-30 playbook content, eval linkage, and runtime use remain future work before canary expansion.

Goal: define deterministic conversation playbooks for the highest-volume real caller intents so the agent knows what to accomplish, what to ask, what tools may be used, and when to escalate.

For each top intent, define:

- goal
- success criteria
- required fields
- allowed questions
- allowed tools
- confirmation requirement
- escalation criteria
- forbidden claims
- 2-3 gold standard voice answers
- common German ASR variants

Acceptance:

- At least top 30 real intents have playbooks before broader canary expansion.
- Playbooks distinguish low-risk FAQ, high-risk pricing/legal/policy, booking/mutation, escalation, and out-of-scope intents.
- Gold answers are short, spoken, and compatible with the Voice Conversation Quality Rubric.
- German ASR variants include common colloquial, misspelled, compound-word, umlaut, number, time, and service-name confusions.
- Allowed tools and confirmation requirements are explicit; no playbook authorizes mutation without policy and confirmation.
- Playbooks are versioned and can be tied to eval cases and Product KPI reporting.

## Milestone 2D: Tool Confirmation State Machine

Status: first-pass additive type/test-only state-machine contract implemented. Live mutating tool wiring remains future work before production voice mutations.

Goal: make mutation confirmation deterministic and interruption-safe.

Required states:

```text
intent_detected -> fields_collected -> summary_spoken -> user_confirmed -> policy_approved -> idempotency_key_created -> tool_executed -> result_spoken
```

Rules:

- Mutation cannot execute before a confirmed spoken summary and policy approval.
- The confirmed summary must include the action, target, key fields, and irreversible/externally visible effect where applicable.
- Interruption cancels or reopens confirmation.
- User correction updates state and invalidates prior confirmation.
- Repeated confirmation must not duplicate tool execution.
- Idempotency key must be created before tool execution.
- Tool result must be spoken truthfully and must not claim success when execution failed or was blocked.

Acceptance:

- Focused state-machine tests cover happy path, interruption, correction, repeated confirmation, policy denial, tool failure, and idempotent retry.
- Mutating tools cannot be called from `intent_detected`, `fields_collected`, or `summary_spoken`.
- `user_confirmed` without `policy_approved` cannot execute.
- Repeated confirmation uses the same idempotency key or returns the previous result.
- Voice and web modes share the same confirmation state, with voice using spoken summaries.

## Milestone 2E: Business Hours And Holiday Resolver

Status: first-pass additive type/test-only resolver contract implemented. Live source/resolver wiring remains future work before opening-hours answers are promoted in canary.

Goal: answer "open now", "open tomorrow", and special-hours questions from current source/versioned evidence instead of static prompt text.

Resolver must include:

- timezone `Europe/Berlin`
- holiday calendar
- special opening hours
- `Betriebsferien`
- `source_version`
- `expires_at`
- "open now" logic
- "open tomorrow" logic

Rules:

- Static pinned context cannot override the resolver.
- Changing opening-hours answers require current source/version evidence.
- Stale, missing, contradictory, or expired hours must trigger clarification, abstain, or escalation according to risk and tenant policy.
- Spoken answers must pass German Voice Output Normalization before TTS.

Acceptance:

- No changing opening-hours answer is produced without current source/version.
- Tests cover weekday hours, weekend, public holiday, special hours, `Betriebsferien`, overnight hours, "open now", "open tomorrow", DST/timezone behavior, stale source, and missing source.
- Pinned context can identify the business but cannot answer dynamic opening-hours facts without resolver evidence.
- Resolver outputs both machine-readable state and short German spoken answer candidates.

## Milestone 2F: Runtime Degradation Matrix

Status: first-pass additive type/test-only degradation matrix implemented. Live routing, logging, kill-switch wiring, and dependency-specific deadlines remain future work before canary expansion.

Goal: define predictable agent behavior when dependencies degrade, instead of letting latency, outages, or partial failures produce hallucinations or unsafe actions.

Cover at least:

- Retell-KB unavailable
- Own-KB unavailable
- Redis unavailable
- Supabase slow/down
- tool API down
- ASR/TTS degraded
- provider latency spike

For each degradation mode, define:

- agent response
- escalation behavior
- logging/trace event
- user-visible wording
- kill-switch or feature-flag behavior
- retry/deadline policy
- whether the call can continue, should abstain, or should escalate

Acceptance:

- Every degradation mode has defined agent response, escalation, logging, and kill-switch behavior.
- Degraded retrieval never causes guessing for pricing/legal/policy or tenant-specific facts.
- Tool API down never produces a false success claim.
- ASR/TTS degradation is visible in metrics and can trigger clarification or escalation.
- Provider latency spike respects Ultra-Low-Latency Stop-Loss and first-safe-audio anti-gaming rules.

## Milestone 3: ContextContract

Status: first-pass additive type/test-only ContextContract builder implemented. Live prompt assembly wiring remains future work before canary expansion.

Goal: replace implicit prompt assembly with a deterministic, testable context contract.

Files likely added/touched:

- `apps/api/src/context-contract.ts`
- `apps/api/src/agent-runtime.ts`
- `apps/api/src/agent-instructions.ts`
- `apps/api/src/__tests__/context-contract.test.ts`

ContextContract must include:

- `scope: TrustedScope`
- compact call state
- current user utterance
- limited redacted recent turns
- task/intent state
- allowed tools
- retrieval answerability, evidence, excluded evidence summary, confidence, and freshness
- policy allowed/denied actions and pending confirmation
- latency budget split into total, retrieval, policy, and compose
- output mode: voice or web

ContextContract must exclude:

- full raw transcript
- full KB dump
- unapproved source content
- stale pricing/legal/policy facts
- model-supplied scope
- secrets and raw PII

Acceptance:

- Snapshot tests prove stable context output.
- Tests prove unapproved/stale KB facts do not enter context.
- Tests prove full transcript is not included.
- Tests distinguish "nothing found" from "only excluded evidence found".

## Milestone 3B: KB Ingestion Prompt-Injection Red-Team Suite

Status: first-pass additive type/test-only red-team suite contract implemented. Live ingestion/parser wiring and fixture execution remain future work before Own-KB canary/primary work.

Goal: catch malicious or instruction-like content during KB ingestion and prove retrieved KB text is treated as untrusted evidence, never as policy or system instruction.

Required red-team fixture classes:

- HTML hidden text, including hidden DOM nodes, CSS-hidden text, tiny text, comments, and offscreen content.
- PDF metadata, including title/author/subject/keywords, embedded annotations, invisible text layers, and attachment metadata.
- Markdown instruction blocks, including blockquotes, fenced code, frontmatter, admonitions, and "system/developer instruction" phrasing.
- Base64/unicode smuggling, including homoglyphs, zero-width characters, right-to-left controls, encoded instructions, and mixed normalization forms.
- Tool-policy override attempts that instruct the model to ignore policy, authorize mutations, expose secrets, or bypass confirmation.
- Cross-tenant bait that attempts to name another tenant, leak sentinel strings, or instruct retrieval across tenant boundaries.
- Multilingual injection, including German, English, Turkish, Arabic, and mixed-language attempts where practical.

Tasks:

1. Add ingestion fixtures for each red-team class.
2. Ensure parser/normalizer preserves enough suspicious-text evidence for detection while preventing it from entering trusted instructions.
3. Add metadata flags for suspected injection content and excluded evidence summaries.
4. Add retrieval/context tests proving injection content does not change tool policy, system behavior, provider config, tenant scope, or authorization context.
5. Add eval cases proving safe factual snippets can still be used when adjacent injection content is excluded.
6. Add reports that distinguish `safe_fact`, `excluded_injection`, `needs_human_review`, and `reject_source`.

Acceptance:

- Every fixture class has at least one failing-before/passing-after test.
- Retrieved content attempting to change behavior is ignored as instruction and logged as an injection attempt.
- Prompt-injection content cannot authorize mutations, change scope, change provider/session config, or request secrets.
- Cross-tenant bait never causes cross-tenant retrieval or context inclusion.
- Excluded injection evidence is visible in traces/evals without being placed into the model prompt as instruction.

## Milestone 4: P0/P1 Conversational Eval Harness

Status: first-pass additive type/test-only conversational eval harness implemented. Real transcript replay, eval storage, labels, and promotion reporting remain future work.

Goal: measure response quality and conversation guidance, not only retrieval reachability.

Voice response rubric:

- Normal answer: max 1-2 short sentences.
- Answer first, then one concise clarifying question only when needed.
- No long source explanations in voice output.
- If evidence is missing or stale, abstain naturally.
- If ASR confidence is low, ask a targeted clarification.
- If user corrects the agent, acknowledge and update state.
- If user interrupts, stop current response and prioritize the new user intent.
- No mutation without a confirmed summary.

Eval dimensions:

- correctness against approved evidence
- abstain when evidence missing
- short natural German voice style
- no overtalking
- useful clarifying question
- interruption and correction handling
- ASR variants and umlauts
- unauthorized mutation denial
- latency budgets
- prompt-injection resistance
- raw PII leak prevention

Required eval cases:

- noisy German ASR / umlaut variants
- interruption during answer
- user changes mind during confirmation
- stale pricing/legal/policy source only
- cross-tenant-like question
- prompt injection inside KB snippet
- caller frustration / escalation
- correct source retrieved but answer too long
- ambiguous appointment or service request
- KB prompt-injection fixture that tries to change tool policy, system behavior, provider config, or scope; expected result is ignored, logged, and no prompt/policy effect

Acceptance:

- P0/P1/P2 failure taxonomy exists in code or eval fixtures.
- At least 30 top real intents are represented.
- Transcript-derived evals can be replayed without storing raw PII.
- Report includes pass rate, p95 latency, coverage gaps, and promotion recommendation.

## Milestone 4D: German Audio Chaos Eval Suite

Status: first-pass additive type/test-only German audio chaos eval contract implemented. Real audio fixture collection/execution remains future work before treating text-only evals as sufficient for voice quality.

Goal: distinguish text correctness from real German audio/ASR/TTS success under messy phone-call conditions.

Eval suite must include:

- DACH telephone quality
- background noise
- Bluetooth mic
- fast speakers
- dialect and colloquial German
- umlaut and ASR confusions
- interruption during confirmation
- number/time/email correction
- caller frustration

Required report split:

- text correctness
- ASR understanding success
- TTS/spoken output success
- interruption handling
- correction handling
- escalation/frustration handling
- latency under audio chaos

Acceptance:

- Eval distinguishes text correctness from audio/ASR success.
- Cases can fail because the answer text is correct but ASR/TTS/voice behavior fails.
- DACH dialect/colloquial fixtures include at least German, Austrian, and Swiss-style phrasing where practical.
- Number, time, phone, email, and address correction cases are represented.
- Interruption during confirmation proves stale confirmation does not execute a mutation.
- Caller frustration cases measure escalation timing and tone.
- Reports include per-class failure rates and examples for labeling.

## Milestone 4E: Human QA And Labeling Workflow

Status: first-pass additive type/test-only human QA labeling workflow contract implemented. Real labeling UI/storage/adjudication workflow remains future work before expanding canary or trusting conversational eval trends.

Goal: make eval labels auditable, consistent, versioned, and representative across tenants and industries.

Workflow must include:

- `answerCorrect` labeling
- `shouldAbstain` labeling
- escalation labeling
- disagreement resolution
- eval case versioning
- tenant/industry distribution tracking

Rules:

- Raw PII must not be stored in labeling artifacts unless an explicit approved purpose and retention rule exists.
- Labelers must see enough redacted context, evidence, and expected policy to label consistently.
- Disagreements must be resolved by a documented owner or adjudication rule.
- Label versions must be tied to eval report versions so trend changes are interpretable.

Acceptance:

- Label schema includes answer correctness, abstain correctness, escalation correctness, evidence support, voice style, interruption/correction handling, and P0/P1/P2 severity.
- Disagreement workflow records initial labels, final label, resolver, reason, and version.
- Eval cases track tenant, industry, top intent, risk class, language/accent class, and source version without leaking raw PII.
- Reports can show tenant/industry distribution and identify overfit or underrepresented segments.
- Canary expansion is blocked when label coverage or disagreement resolution is insufficient.

## Milestone 5: Shadow/Dual-Read Decision Matrix

Status: first-pass additive type/test-only decision matrix contract implemented. Live shadow-log ingestion/storage, review workflow, and dashboards remain future work.

Goal: turn shadow logs into rollout decisions.

Decision matrix:

- Retell answerable, Own-KB not answerable: coverage gap, block promotion.
- Own-KB answerable, Retell not answerable: potential improvement, add eval case.
- Both answerable but different: review freshness/risk; human review for pricing/legal/policy.
- Neither answerable: expected abstain or KB expansion decision.

Acceptance:

- Shadow report classifies each comparison.
- Promotion gates fail on unresolved P0/P1 gaps.
- Canary cannot start while transcript coverage gaps remain open.

## Milestone 6: Rollout, Cost, And Cleanup Controls

Status: first-pass additive type/test-only rollout/cost/cleanup controls contract implemented. Live rollout telemetry, Product KPI storage, cleanup execution, and dashboards remain future work.

Goal: prevent cost explosions and unsafe deletes.

Canary promotion protocol:

- Canary may start only after Global Promotion Gates pass, Milestones 1A-1I pass, trusted 0.5B report exists, Product KPI hard gates pass, rollback and kill switch are verified, Retell-KB standby is ready, and Shadow/Dual-Read has no unresolved P0/P1 gaps.
- Coverage gaps from transcript-derived evals are closed.
- Latency gates pass for 7 consecutive days or an agreed sample window.
- Rollback to Retell/Retell-KB is tested per org/agent.
- Emergency kill switch is verified.
- Canary expansion stops on any P0, repeated P1, or p95 latency breach.

Canary/Primary readiness matrix:

- `owkb_canary_candidate`: may allow canary preparation/start only after Milestones 1A-1I, trusted 0.5B report, Product KPI hard gates, Ultra-Low-Latency SLO, exception-path SLO reporting, rollback, kill switch, and Retell-KB standby readiness all pass.
- `owkb_primary_candidate`: required for Own-KB primary. Primary also requires 14 days canary without P0, no unresolved P1 gaps, no latency gate breach, no KPI hard-gate regression, rollback tested, kill switch tested, Retell-KB standby 14-30 days, and no governance-weakening optimization.
- `owkb_canary_candidate` must never unlock Own-KB primary.
- Missing sample size, missing KPI baseline, missing exception-path metrics, or missing Retell-KB standby evidence blocks both canary expansion and primary.

Retell-KB standby and fallback gates:

- Retell-KB remains rollback path for 14-30 days after Own-KB primary.
- No active, canary, rollback, or pending-deploy KB may be deleted.
- Rollback must be possible per org/agent without code deploy.
- Standby health must be checked before each canary expansion.
- Final delete requires audit: no references, no rollback need, and no unresolved billing/support dispute.

Acceptance:

- Feature flags exist separately for Own-KB retrieval, Own-KB answering, mutating tools, and provider adapter canary.
- Emergency kill switch exists.
- Ingestion/embedding quotas exist per tenant/day.
- Cleanup remains dry-run by default.
- Destructive cleanup requires deterministic allowlist/protection checks.
- Retell KB standby window remains 14-30 days before final delete.
- Canary and primary readiness are evaluated separately; `owkb_primary_candidate` is mandatory for primary.
- Product KPI hard gates and exception-path latency metrics are included in canary expansion and primary decisions.

## Idempotence And Recovery

- Plan edits are documentation-only unless a milestone explicitly changes code.
- Each milestone should be reversible by feature flag or by reverting the specific code diff.
- DB migrations must be additive where possible and must include validation/rollback notes.
- Destructive cleanup must never be introduced without dry-run evidence and deterministic allowlists.

## Artifacts And Notes

- Architecture rules: `AGENTS.md`
- Living plan: `PLANS.md`
- Historical references exist only as non-authoritative local context and must not be exported or used as implementation authority unless a future user task explicitly asks for historical comparison.

## Current Next Step

Next gated step: Milestone 0.5B Trusted Retell-KB vs Own-KB Benchmark Execution. Milestone 1A TrustedScope for `knowledge.search`, Milestone 1B Trace Scope Correctness, Milestone 1C PII redaction purpose separation, Milestone 1D DB/RLS/readiness validation, Milestone 1E Voice Latency Measurement Contract, Milestone 1F Own-KB to Retell-KB Sync Contract, Milestone 1G Voice Compliance and Disclosure Controls, and Milestone 1H German Voice Output Normalization Contract are complete. Milestone 1I STT / TTT / TTS Voice Pipeline Contract, Milestone 2 Canonical Runtime Contract, Milestone 2C Intent Playbooks, Milestone 2D Tool Confirmation State Machine, Milestone 2E Business Hours and Holiday Resolver, Milestone 2F Runtime Degradation Matrix, Milestone 3 ContextContract, Milestone 3B KB Ingestion Prompt-Injection Red-Team Suite, Milestone 4 Conversational Eval Harness, Milestone 4D German Audio Chaos Eval Suite, Milestone 4E Human QA and Labeling Workflow, Milestone 5 Shadow/Dual-Read Decision Matrix, and Milestone 6 Rollout/Cost/Cleanup Controls are complete as first-pass additive type/test-only contracts; real top-30 playbook content, real transcript replay, live prompt assembly wiring, live provider-adapter wiring, live mutation wiring, live opening-hours source wiring, live degradation routing, live ingestion/parser wiring, live audio fixtures/execution, real QA storage/adjudication workflow, live shadow-log ingestion/storage, dashboards, live rollout/cost telemetry, cleanup execution, and production wiring remain future work. Do not fabricate benchmark evidence; use only approved eval artifacts. Do not enable Own-KB primary, do not disable/delete Retell-KB, do not build OpenAI Realtime features, and do not change production rollout flags.
