# Own KB + Multi-Layer Voice Agent Plan

Date: 2026-05-28
Status: historical planning baseline, not authoritative, not production approval

Historical Baseline - Not Authoritative:

This file is background context only. Do not use it as implementation instruction. Authoritative instructions are in `../AGENTS.md` and `../PLANS.md`. If this file conflicts with those root files, the root files win.

Update 2026-05-29: This baseline is superseded where it implies that Own KB should replace Retell KB by default. See `../PLANS.md` Milestone 0.5; the former addendum now lives at `archive/OWKB_RETELL_LATENCY_PARITY_ADDENDUM.superseded.md` as historical context only. Retell-KB remains the production latency benchmark, fallback, and possible runtime retriever until Own-KB proves parity on realistic voice metrics.

## Executive Decision

Build Phonbot's own Knowledge Base and RAG governance/evidence layer first. Keep Retell as the current production voice runtime and fallback. Keep Retell-KB as the production latency benchmark and possible runtime retriever until Own-KB reaches or beats it on realistic voice quality and latency metrics. Move OpenAI Realtime into lab/canary only after tool parity, RAG parity, latency, and safety gates pass.

The own KB becomes the governed source-of-truth, evidence, eval, and shadow system for both runtimes. It becomes the runtime retriever only after parity gates pass:

- Retell runtime may continue using Retell-KB when it is the fastest safe retriever.
- Own-KB may sync approved/current content into Retell-KB as a governance/control-plane layer.
- OpenAI Realtime runtime uses the same `knowledge.search` tool.
- Retell KBs are kept during benchmark, shadow, canary, and rollback windows, then deleted only after evidence-based decommission.

This reduces the Retell per-KB hosting failure mode without sacrificing production voice latency by assumption. Own-KB must prove that pinned core facts, cache, structured lookups, hybrid retrieval, and selective reranking can match the Retell-KB runtime benchmark before replacing it.

## 98 Percent Definition

We do not define "98%" as a feeling. We define it as a release gate.

Architecture can be considered 98% ready when all of these are true:

1. 0 P0 failures across at least 150 independent high-risk replay/eval cases.
2. 0 cross-tenant retrievals in synthetic, shadow, and canary tests.
3. `knowledge.search` cold/full p95 <= 700 ms, warm p95 <= 250 ms, warm p99 <= 450 ms, Redis/cache hit p95 <= 50 ms.
4. Normal supported voice turn e2e p50 <= 500 ms, p90 <= 700 ms, p95 <= 800 ms; all supported non-tool voice turns e2e p95 <= 1000 ms; p99 target <= 1200 ms reported separately.
5. No stale pricing/legal/policy source can be used without valid metadata.
6. RAG never authorizes booking, cancellation, payment, deletion, transfer, retention, customer lookup, or CRM mutation.
7. Retell and OpenAI runtimes share one prompt/tool contract and one KB version.
8. Shadow and dual-read parity show own KB equals or beats Retell KB quality.
9. Retell-KB TTFA baseline is measured on the same eval set before any Own-KB primary promotion.
10. Rollback to Retell can happen per org/agent without data loss.
11. Monitoring, alerts, cost caps, retention cleanup, and incident runbooks exist.

Current confidence after 40-role review:

- Own KB architecture direction: 90%.
- DB/schema plan without live Supabase verification: 88%.
- Retrieval quality plan: 90%.
- Security/privacy plan: 92%.
- Migration/ops plan: 90%.
- OpenAI Realtime readiness as future Layer 0 candidate: 60-65%.
- Overall production readiness today: not 98%, because live DB access, real evals, and shadow telemetry are missing.

## Current Blockers

Local secrets currently missing:

- `DATABASE_URL`
- `SUPABASE_PROJECT_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

Available:

- `RETELL_API_KEY`

Cannot create/verify real DB until Supabase/Postgres access is available. Without live DB access we cannot verify pgvector version, extension availability, HNSW behavior, row counts, RLS/grants, EXPLAIN plans, or migration runtime.

## Multi-Layer Architecture

This baseline layer list is superseded by `../AGENTS.md` Target Layering where they differ. Provider Adapter is a separate layer between Voice Runtime and Agent Core. Do not place provider-specific schema, Retell response IDs, OpenAI event names, or websocket message shapes inside Agent Core.

```text
Layer 0 - Voice Runtime
  Retell production/fallback
  OpenAI Realtime lab -> internal -> canary -> production

Layer 1 - Provider Adapter
  Retell/OpenAI/raw runtime events -> canonical events.
  Canonical commands -> provider-specific messages.
  No business logic.

Layer 2 - Agent Core
  session state, call state, consent, barge-in, interruption handling,
  dynamic variables, call lifecycle, no provider-specific schema.

Layer 3 - Pinned Core Context
  business name, opening hours summary, top services, current date/time,
  hard safety rules, short public policies

Layer 4 - Tool Policy
  backend policy before every mutation
  confirmation gates
  tenant/agent/call auth

Layer 5 - knowledge.search
  read-only, fast, scoped evidence provider

Layer 6 - Retrieval Engine
  Redis cache -> structured facts -> FTS + pgvector -> RRF -> metadata gate
  optional rerank only for ambiguity/high-risk queries

Layer 7 - Own KB Store
  Supabase/Postgres, pgvector, tsvector/GIN, source versions, chunks,
  embeddings, ingestion jobs, retrieval events, citations

Layer 8 - Action Tools
  calendar, customer, ticket, billing public info, integrations,
  transfer/end-call/recording consent

Layer 9 - Evaluation and Observability
  behavior evals, retrieval evals, latency metrics, Sentry, cost caps,
  shadow compare, canary alerts
```

Pinned Core Context may include only stable identity facts, current date/time from runtime, short safety/behavior rules, and non-risk public metadata with source version and expiry metadata. It must not include pricing, legal/policy details, changing opening hours without `source_version` and `expires_at`, customer-specific data, or anything that bypasses Own-KB freshness gates.

`knowledge.search` is a read-only evidence provider. It is authoritative for factual answer support only when the returned EvidencePacket passes source metadata gates. It is never authoritative for mutations, identity, authorization, booking, cancellation, payment, transfer, retention, deletion, or CRM changes.

## Why Not Vector Search Every Turn

Voice quality drops if every turn blocks on retrieval. The correct flow is:

1. Answer from pinned core facts if enough.
2. Classify turn: smalltalk, factual KB, live state, action, unsafe, unclear.
3. Use backend tools for live/action data.
4. Use `knowledge.search` only for stable factual knowledge.
5. Use rerank only when the first retrieval is ambiguous or high-risk.

This keeps latency stable and reduces hallucination surface.

## `knowledge.search` Contract

Request:

```json
{
  "query": "string",
  "intent": "faq|pricing|service|policy|hours|staff|other",
  "orgId": "server-derived",
  "tenantId": "server-derived",
  "agentId": "server-derived",
  "callId": "server-derived optional",
  "language": "de",
  "allowedCategories": ["faq", "services", "pricing"],
  "maxAgeDays": 90,
  "topK": 3,
  "mode": "strict|balanced|broad"
}
```

Response:

```json
{
  "answerable": true,
  "confidence": 0.82,
  "latencyMs": 118,
  "snippets": [
    {
      "chunkId": "uuid",
      "sourceId": "uuid",
      "sourceVersionId": "uuid",
      "rank": 1,
      "text": "short voice-ready fact",
      "category": "services",
      "allowedUse": "voice_factual_answer",
      "verifiedAt": "2026-05-28T00:00:00Z",
      "expiresAt": "2026-08-28T00:00:00Z",
      "risk": "low",
      "distance": 0.18,
      "sourceOfTruth": "customer_approved"
    }
  ],
  "policy": {
    "mayAnswer": true,
    "mayMutate": false,
    "reason": "stable approved factual context"
  }
}
```

Rules:

- Server derives org/tenant/agent/call scope; model never chooses it.
- Returned snippets are untrusted factual context, never instructions.
- `mayMutate` is always false.
- Empty/low-confidence retrieval returns abstain, not a guessed answer.
- Pricing/legal/policy requires current `verifiedAt` and `expiresAt`.

## DB Schema Plan

Use existing `agent_configs` and `knowledge_files` as inputs, but add first-class KB tables.

Required extension:

```sql
create extension if not exists vector;
```

Core source tables:

```sql
create table if not exists kb_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  tenant_id text not null,
  agent_tenant_id text,
  type text not null check (type in ('text', 'url', 'pdf', 'db_canonical', 'upload')),
  name text not null,
  uri text,
  category text not null,
  allowed_use text not null,
  owner text not null,
  review_status text not null check (review_status in ('draft', 'approved', 'needs_review', 'rejected', 'expired')),
  risk text not null check (risk in ('low', 'medium', 'high')),
  contains_pii boolean not null default false,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kb_source_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references kb_sources(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  tenant_id text not null,
  version_no int not null,
  content_hash text not null,
  mime_type text,
  size_bytes bigint,
  parser text,
  parser_version text,
  fetched_at timestamptz,
  verified_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null check (status in ('pending', 'indexed', 'rejected', 'expired', 'deleted')),
  rejection_reason text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (source_id, version_no),
  unique (source_id, content_hash)
);
```

Document/chunk/index tables:

```sql
create table if not exists kb_documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references kb_sources(id) on delete cascade,
  source_version_id uuid not null references kb_source_versions(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  tenant_id text not null,
  title text not null,
  canonical_url text,
  language text not null default 'de',
  content_hash text not null,
  token_count int,
  status text not null default 'ready',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists kb_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references kb_documents(id) on delete cascade,
  source_id uuid not null references kb_sources(id) on delete cascade,
  source_version_id uuid not null references kb_source_versions(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  tenant_id text not null,
  chunk_index int not null,
  text text not null,
  search_tsv tsvector generated always as (to_tsvector('german', coalesce(text, ''))) stored,
  token_count int,
  char_start int,
  char_end int,
  content_hash text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create table if not exists kb_embeddings (
  id uuid primary key default gen_random_uuid(),
  chunk_id uuid not null references kb_chunks(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  tenant_id text not null,
  embedding_model text not null,
  embedding_dim int not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now(),
  unique (chunk_id, embedding_model)
);
```

Operational tables:

```sql
create table if not exists kb_ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  tenant_id text not null,
  source_id uuid references kb_sources(id) on delete cascade,
  source_version_id uuid references kb_source_versions(id) on delete cascade,
  job_type text not null,
  status text not null check (status in ('queued', 'running', 'retry', 'done', 'failed', 'cancelled')),
  priority int not null default 100,
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  error text,
  input jsonb not null default '{}',
  output jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kb_retrieval_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  tenant_id text not null,
  agent_id text,
  call_id text,
  turn_id text,
  provider text not null,
  query_hash text not null,
  query_text_redacted text,
  mode text not null,
  top_k int not null,
  latency_ms int not null,
  answerable boolean not null,
  confidence numeric(4,3),
  error_code text,
  created_at timestamptz not null default now()
);

create table if not exists kb_retrieval_citations (
  event_id uuid not null references kb_retrieval_events(id) on delete cascade,
  rank int not null,
  chunk_id uuid not null references kb_chunks(id) on delete cascade,
  source_id uuid not null references kb_sources(id) on delete cascade,
  source_version_id uuid not null references kb_source_versions(id) on delete cascade,
  distance numeric,
  snippet_redacted text,
  primary key (event_id, rank)
);
```

Evaluation/latency tables:

```sql
create table if not exists kb_eval_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id) on delete cascade,
  tenant_id text,
  name text not null,
  git_sha text,
  config jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists kb_eval_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references kb_eval_runs(id) on delete cascade,
  case_id text not null,
  status text not null,
  score numeric(4,3),
  failure_reason text,
  latency_ms int,
  citations jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists voice_rag_turn_metrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  tenant_id text not null,
  agent_id text,
  call_id text,
  provider text not null,
  turn_index int,
  asr_ms int,
  kb_ms int,
  llm_ms int,
  tts_ms int,
  tool_ms int,
  e2e_ms int,
  interrupted boolean,
  created_at timestamptz not null default now()
);
```

Indexes:

```sql
create index if not exists kb_sources_scope_idx on kb_sources(org_id, tenant_id);
create index if not exists kb_sources_review_idx on kb_sources(org_id, tenant_id, review_status);
create index if not exists kb_source_versions_scope_idx on kb_source_versions(org_id, tenant_id, status, expires_at);
create index if not exists kb_documents_scope_idx on kb_documents(org_id, tenant_id, source_version_id);
create index if not exists kb_chunks_scope_idx on kb_chunks(org_id, tenant_id, source_version_id);
create index if not exists kb_chunks_tsv_idx on kb_chunks using gin(search_tsv);
create index if not exists kb_embeddings_scope_idx on kb_embeddings(org_id, tenant_id, embedding_model);
create index if not exists kb_embeddings_hnsw_idx on kb_embeddings using hnsw (embedding vector_cosine_ops);
create index if not exists kb_jobs_pending_idx on kb_ingestion_jobs(priority, run_after, created_at) where status in ('queued', 'retry');
create index if not exists kb_retrieval_events_scope_idx on kb_retrieval_events(org_id, tenant_id, created_at desc);
create index if not exists voice_rag_turn_metrics_scope_idx on voice_rag_turn_metrics(org_id, agent_id, created_at desc);
```

HNSW note: Supabase documents HNSW as the default vector-index choice when approximate search is acceptable. Filtered searches can return fewer rows when org/tenant filters are selective, so we need overfetch and, when available, pgvector iterative scan settings.

## Metadata Gates

Fail closed. A source is indexable only when all required fields are present:

- `category`
- `allowedUse`
- `owner`
- `reviewStatus = approved`
- `verifiedAt`
- `expiresAt > now`
- `contentHash`
- `containsPii = false` unless category explicitly allows public staff facts
- `risk = low|medium` with explicit allowed use

Block always:

- raw transcripts
- recordings
- customer profiles
- customer notes
- bookings
- live slots
- Stripe/billing state
- payment/invoice/card/IBAN data
- API/OAuth/webhook secrets
- logs/stack traces
- internal prompts
- external API responses unless explicitly reviewed

## Retrieval Algorithm

Pseudocode:

```ts
async function knowledgeSearch(req) {
  const scope = deriveScopeFromSignedCall(req);
  const classified = classifyKnowledgeIntent(req.query);
  if (!classified.requiresKnowledge) return abstain('NO_KB_NEEDED');
  if (classified.requiresLiveState) return abstain('USE_BACKEND_TOOL');

  const cacheKey = hash(scope.orgId, scope.tenantId, scope.agentId, req.query, currentKbVersion(scope));
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const structured = await exactFactLookup(scope, req.query);
  if (structured.highConfidence) return cacheAndReturn(structured);

  const [fts, vector] = await Promise.all([
    fullTextSearch(scope, req.query, { limit: 12 }),
    vectorSearch(scope, req.query, { limit: 24, overfetch: true }),
  ]);

  const fused = reciprocalRankFusion(fts, vector);
  const gated = applyMetadataGates(fused);
  const top = maybeRerank(gated, classified);
  const result = shapeVoiceReadyAnswer(top.slice(0, 3));

  await logRetrievalEvent(result);
  return cacheAndReturn(result);
}
```

## Latency Budget

| Path | p50 | p95 | Action |
| --- | ---: | ---: | --- |
| Pinned core facts | < 10 ms | < 20 ms | no RAG |
| Redis cache | < 20 ms | < 50 ms | return directly |
| Structured DB fact | < 50 ms | < 120 ms | return directly |
| Hybrid FTS + vector | < 150 ms | < 250 ms | not normal live path unless full e2e <= 800 ms |
| Rerank | < 350 ms | < 700 ms | only ambiguous/high-risk; first safe response still <= 800 ms |
| Normal supported voice turn e2e | < 500 ms | < 800 ms | production target |
| Supported non-tool voice turn e2e | < 700 ms | < 1000 ms | upper production SLO |

If `knowledge.search` risks pushing a normal live turn past the 800 ms e2e budget, the runtime should use a faster safe path, abstain/clarify, or produce a short safe acknowledgement and avoid guessing. The old 2200 ms target is a legacy fallback upper bound only, not a production goal.

## Eval Plan

Minimum suites:

1. Retrieval recall suite: recall@3, MRR, source category correctness.
2. Stale-source suite: expired pricing/legal/policy must abstain.
3. Prompt injection suite: HTML, PDF, OCR, German/English paraphrases.
4. Tenant isolation suite: Tenant A cannot retrieve Tenant B facts.
5. Tool boundary suite: RAG cannot authorize calendar/customer/billing mutations.
6. German voice suite: umlauts, names, services, prices, noisy transcript variants.
7. Latency suite: p50/p95 per path.
8. Fallback suite: Redis down, DB slow, OpenAI down, Retell down, empty KB.
9. Retention suite: source deletion removes chunks, embeddings, citations, logs.
10. Migration parity suite: Retell KB vs own KB answers.

Release gate:

- At least 150 P0/P1 cases.
- 0 P0 failures.
- P1 pass rate >= 98%.
- No unresolved security/privacy finding.
- Latency budget passes on real infra.

## Migration Plan

Phase 0: Freeze unsafe growth

- Keep Retell KB orphan cleanup enabled.
- No broad auto-indexing.
- Enforce metadata as warning first, then fail-closed.

Phase 1: Schema and ingestion

- Add KB tables.
- Enable pgvector.
- Backfill from `agent_configs.data.knowledgeSources`.
- Reuse `knowledge_files` for PDFs.
- Build ingestion jobs for parse, chunk, embed, index.

Phase 2: Shadow index

- Own KB indexes but runtime still uses Retell KB.
- Log coverage and ingestion errors.
- No user-facing behavior change.

Phase 3: Shadow retrieval

- Query own KB in background on live calls.
- Compare latency and result quality.
- Do not influence answers.

Phase 4: Dual-read parity

- For eval/replay and safe calls, compare Retell KB vs own KB.
- Store retrieval events and citations.
- Fix mismatches before moving forward.

Phase 5: Own KB primary for internal agents

- Use own `knowledge.search` for internal/test numbers.
- Retell KB remains attached as rollback.

Phase 6: Canary customer agents

- 5% traffic or selected orgs.
- Auto rollback on latency/errors/quality.

Phase 7: Retell KB decommission

- Detach Retell KB from LLMs.
- Wait 14-30 days.
- Confirm no Retell references and no recent calls.
- Delete KBs with audit evidence.

## OpenAI Realtime Layer 0 Plan

No production switch until:

- Event schema updated to current Realtime events.
- Function calling works for every Retell-equivalent tool.
- `knowledge.search` works as a Realtime tool.
- Barge-in and truncation are tested.
- SIP/webhook lifecycle is implemented if using direct SIP.
- Tool outputs are streamed back safely.
- Same policy layer is applied before every mutation.
- Same eval suite passes against Retell and OpenAI.

OpenAI Realtime should start as:

1. Local lab.
2. Internal phone number.
3. Shadow/replay.
4. 5% canary.
5. Selected production.
6. Default runtime only after measured superiority or parity.

## Rollback

Every org/agent gets runtime flags:

- `voiceRuntime = retell|openai_realtime`
- `kbProvider = retell_kb|own_kb_shadow|own_kb_primary`
- `retellKbStandbyUntil`
- `ownKbVersion`
- `lastGoodKbVersion`

Rollback must be possible without DB migration rollback:

- switch runtime flag to Retell
- switch KB provider to Retell KB standby
- disable own `knowledge.search`
- keep ingestion running but unused
- preserve retrieval logs for debugging

## Ops And Alerts

Page immediately:

- cross-tenant retrieval suspicion
- PII/source blocklist violation
- booking/payment/customer mutation without backend confirmation
- retriever error rate > 1% over 15 min
- normal supported voice e2e p95 > 800 ms
- supported non-tool voice e2e p95 > 1000 ms
- KB/context path p95 > 100 ms for normal live turns
- Retell/OpenAI provider fallback rate > 10%
- KB deletion attempted for KB seen in recent calls

Warn:

- empty retrieval rate doubles baseline
- stale/expired source used in shadow
- ingestion queue lag > 15 min
- per-org RAG spend exceeds daily budget
- retry jobs accumulating

Dashboards:

- p50/p95/p99 voice turn latency by provider
- knowledge.search p50/p95/p99 by org/agent
- retrieval answerable rate
- citations by category/source
- empty/abstain/fallback rate
- ingestion job status
- source review/expired/blocked counts
- cost per call and cost per org

## Product/UX Requirements

Knowledge editor states:

- Pending scan
- Indexed
- Needs review
- Expired
- Blocked
- Partially indexed
- Sync failed
- Latency warning

Show source authority:

- Verified business fact
- FAQ
- Service/pricing
- Legal/privacy
- Website snapshot
- PDF/menu
- Blocked/unsafe

Customer-facing rule:

- "What should the agent know?" is separate from "What may the agent do?"

Packages:

- Free/Demo: canonical facts only.
- Starter: business facts, services, FAQ text.
- Professional: URLs/PDFs with review states and freshness.
- Agency: approvals, audits, source governance, eval reports, integrations.

## Remaining Work To Reach 98 Percent

1. Add missing credentials.
2. Verify Supabase pgvector version and extension.
3. Create schema in dev/staging.
4. Implement ingestion jobs.
5. Implement `knowledge.search`.
6. Add metadata fail-closed enforcement.
7. Add retrieval eval corpus.
8. Add shadow retrieval.
9. Run Retell vs own KB dual-read.
10. Implement OpenAI Realtime tool parity.
11. Run internal call canary.
12. Run selected customer canary.
13. Decommission Retell KBs only after grace-period evidence.

## Final Planning Verdict

The 98% path is viable, but it is evidence-based. The architecture itself is now shaped well enough to start implementation. We must not claim production 98% until the DB, eval, shadow, and canary evidence exists.

Best next implementation order:

1. Own KB schema and ingestion.
2. `knowledge.search` for Retell first.
3. Shadow and dual-read parity.
4. OpenAI Realtime tool parity.
5. Canary and decommission.
