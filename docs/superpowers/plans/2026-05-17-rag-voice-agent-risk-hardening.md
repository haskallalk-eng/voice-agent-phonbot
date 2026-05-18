# RAG Voice Agent Risk Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phonbot's RAG useful for German voice-agent facts while preventing latency, stale facts, prompt injection, privacy leaks, and tool/action hallucinations.

**Architecture:** Keep RAG as factual context only. Backend and tool responses remain the source of truth for side effects; prompt rules govern conversation behavior; knowledge governance controls what can be retrieved; evals prove the system does not regress.

**Tech Stack:** Node.js, TypeScript, Fastify API, React/Vite web app, Vitest, Retell Knowledge Base, Postgres-backed agent config.

---

## File Structure

- Modify: `apps/api/src/knowledge.ts`
  - Add source governance metadata normalization and PII/freshness checks.
- Modify: `apps/web/src/lib/api.ts`
  - Mirror source metadata types for the Agent Builder.
- Modify: `apps/web/src/ui/agent-builder/KnowledgeTab.tsx`
  - Surface source category, freshness, and risk labels.
- Modify: `apps/api/src/platform-baseline.ts`
  - Keep RAG as untrusted factual context and add concise German behavior rules if needed.
- Modify: `apps/api/src/__tests__/knowledge.test.ts`
  - Add source governance tests.
- Modify/Create: `sandbox/voice-ai-quality/*.json*`
  - Expand eval cases for RAG risk classes.
- Create: `scripts/run-voice-ai-evals.mjs`
  - Offline scorer for must-say, must-not-say, forbidden tool and risk buckets.
- Create: `docs/vault/voice-ai-rag-risk-ultimate-plan-2026-05-17.md`
  - Persistent Obsidian-style memory of risks, shielding strategy, and next steps.

## Research Agent Requirement

Before implementing or deploying any RAG/Knowledge change, dispatch independent research/explorer agents:

- Data Security Research Agent:
  - Check OWASP LLM Top 10, NIST AI RMF Generative AI Profile, provider security guidance, and Phonbot-specific privacy constraints.
  - Return P0/P1/P2 controls for PII, prompt injection, data poisoning, vector/embedding weakness, cross-tenant leakage, retention/deletion and tool exfiltration.
- Freshness Research Agent:
  - Check pricing/minutes/legal/privacy/FAQ source freshness, single-source-of-truth conflicts, recrawl cadence and source-owner workflow.
  - Return concrete stale-data risks and required metadata.
- Code Explorer:
  - Inspect local files for exact implementation points and tests.
  - Do not edit files; return file/line recommendations.

Research findings must be reviewed before code changes. Speculative findings stay in docs as observations, not code.

## P0 Security And Freshness Gates

These gates must be true before any production RAG/Knowledge deploy:

- No PII in shared/global/industry knowledge.
- `pricing`, `legal_public`, `contract`, `recording`, `subprocessor`, and `promo` sources require server-validated `verifiedAt` and valid `expiresAt`.
- Backend/Tool/Billing beats RAG on every conflict.
- Retell `data_storage_setting` and retention are explicit per agent.
- Retell KB status is known, and sync errors fail closed.
- RAG injection, stale pricing, cross-tenant leakage, and tool false-positive evals pass.

## Task 1: Source Governance Types

**Files:**
- Modify: `apps/api/src/knowledge.ts`
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/api/src/__tests__/knowledge.test.ts`

- [ ] **Step 1: Add failing tests for source metadata normalization**

Add cases to `apps/api/src/__tests__/knowledge.test.ts`:

```ts
it('marks pricing knowledge without freshness as warning-risk', async () => {
  const normalized = await normalizeKnowledgeSources<Record<string, unknown>>({
    knowledgeSources: [
      { id: 'price_1', type: 'text', name: 'Preise', content: 'Starter kostet 89 Euro.', category: 'pricing' },
    ],
  });
  const source = (normalized.knowledgeSources as Array<Record<string, unknown>>)[0];
  expect(source?.category).toBe('pricing');
  expect(source?.risk).toBe('needs_review');
});

it('rejects global knowledge sources that contain obvious PII', async () => {
  const payload = await prepareKnowledgePayload({
    knowledgeSources: [
      {
        id: 'pii_1',
        type: 'text',
        name: 'Kundenliste',
        content: 'Max Mustermann, max@example.com, +49 176 12345678',
        category: 'industry_playbook',
      },
    ],
  });
  expect(payload.sources[0]?.status).toBe('error');
  expect(payload.sources[0]?.error).toBe('PII_IN_SHARED_KNOWLEDGE');
  expect(payload.signature).toBeNull();
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --dir apps/api run test -- --run src/__tests__/knowledge.test.ts
```

Expected: FAIL because `category`, `risk`, and PII category blocking are not implemented.

- [ ] **Step 3: Implement metadata normalization**

In `apps/api/src/knowledge.ts`, extend `KnowledgeSource`:

```ts
  category?: 'verified_facts' | 'pricing' | 'customer_faq' | 'industry_playbook' | 'legal_public' | 'unsafe_untrusted';
  verifiedAt?: string;
  expiresAt?: string;
  containsPii?: boolean;
  allowedUse?: 'agent_facts' | 'demo_facts' | 'internal_review_only';
  risk?: 'ok' | 'needs_review' | 'blocked';
```

Add helpers:

```ts
function looksLikePii(text: string): boolean {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)
    || /\+?\d[\d\s()./-]{8,}\d/.test(text)
    || /\bDE\d{20}\b/i.test(text);
}

function normalizeKnowledgeCategory(raw: unknown): KnowledgeSource['category'] {
  if (raw === 'verified_facts' || raw === 'pricing' || raw === 'customer_faq' || raw === 'industry_playbook' || raw === 'legal_public' || raw === 'unsafe_untrusted') return raw;
  return 'customer_faq';
}

function sourceRisk(src: KnowledgeSource): KnowledgeSource['risk'] {
  if (src.category === 'unsafe_untrusted') return 'blocked';
  if ((src.category === 'pricing' || src.category === 'legal_public') && !src.verifiedAt) return 'needs_review';
  return 'ok';
}
```

During source normalization, set category/risk and block shared/global categories with PII.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --dir apps/api run test -- --run src/__tests__/knowledge.test.ts
pnpm --dir apps/api run typecheck
pnpm --dir apps/web run typecheck
```

Expected: all pass.

## Task 2: Source Freshness Gates

**Files:**
- Modify: `apps/api/src/knowledge.ts`
- Modify: `apps/api/src/__tests__/knowledge.test.ts`
- Modify: `sandbox/voice-ai-quality/sample-eval-cases.jsonl`

- [ ] **Step 1: Add failing freshness tests**

Add tests:

```ts
it('blocks expired pricing knowledge from Retell payload', async () => {
  const payload = await prepareKnowledgePayload({
    knowledgeSources: [
      {
        id: 'price_expired',
        type: 'text',
        name: 'Alte Preise',
        content: 'Starter kostet 79 Euro.',
        category: 'pricing',
        verifiedAt: '2026-04-01T00:00:00.000Z',
        expiresAt: '2026-04-08T00:00:00.000Z',
      },
    ],
  });
  expect(payload.texts).toEqual([]);
  expect(payload.sources[0]?.status).toBe('error');
  expect(payload.sources[0]?.error).toBe('SOURCE_EXPIRED');
});

it('marks legal knowledge without approval as not safe for voice certainty', async () => {
  const normalized = await normalizeKnowledgeSources<Record<string, unknown>>({
    knowledgeSources: [
      { id: 'legal_1', type: 'text', name: 'DSGVO', content: 'DSGVO-konform.', category: 'legal_public' },
    ],
  });
  const source = (normalized.knowledgeSources as Array<Record<string, unknown>>)[0];
  expect(source?.risk).toBe('needs_review');
});
```

- [ ] **Step 2: Implement server-side freshness evaluation**

In `apps/api/src/knowledge.ts`, add:

```ts
function parseTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function requiresFreshApproval(category: KnowledgeSource['category']): boolean {
  return category === 'pricing'
    || category === 'legal_public'
    || category === 'contract'
    || category === 'recording'
    || category === 'subprocessor'
    || category === 'promo';
}
```

Then block expired P0 categories before adding `texts`, `urls`, or `files`.

- [ ] **Step 3: Add eval cases**

Add JSONL cases for:

- stale price;
- stale minutes;
- legal guarantee without approval;
- website price conflicting with backend/billing;
- promo after expiration.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --dir apps/api run test -- --run src/__tests__/knowledge.test.ts
node -e "const fs=require('fs'); for (const line of fs.readFileSync('sandbox/voice-ai-quality/sample-eval-cases.jsonl','utf8').trim().split(/\n/)) JSON.parse(line); console.log('jsonl ok')"
```

Expected: all pass.

## Task 3: DB Canonical Facts To RAG

**Files:**
- Modify: `apps/api/src/knowledge.ts`
- Modify: `apps/api/src/agent-config.ts`
- Modify: `apps/api/src/__tests__/knowledge.test.ts`
- Test-only/mock DB context as needed for schedules/staff.

- [ ] **Step 1: Add failing test for generated DB facts**

Add a test that verifies allowed config fields become a deterministic knowledge text while customer/ticket/call data is absent:

```ts
it('builds org-scoped canonical business facts from agent config without customer PII', async () => {
  const facts = buildCanonicalBusinessFacts({
    tenantId: 'tenant_1',
    businessName: 'Salon Kalla',
    businessDescription: 'Friseur in Berlin.',
    address: 'Musterstrasse 1, Berlin',
    openingHours: 'Mo-Fr 09:00-18:00',
    services: [
      { id: 'svc_1', name: 'Haarschnitt', price: '29', duration: '30 Min' },
    ],
    servicesText: '',
    customVocabulary: [{ term: 'Balayage', explanation: 'Faerbetechnik' }],
    industry: 'friseur',
    customerModule: { enabled: true, questions: [{ id: 'preferredStylist', label: 'Wunschstylist' }] },
  } as any);

  expect(facts.text).toContain('Salon Kalla');
  expect(facts.text).toContain('Haarschnitt');
  expect(facts.text).toContain('29');
  expect(facts.text).toContain('Mo-Fr 09:00-18:00');
  expect(facts.text).not.toContain('customer_phone');
  expect(facts.source.category).toBe('verified_facts');
  expect(facts.source.allowedUse).toBe('agent_facts');
});
```

- [ ] **Step 2: Implement `buildCanonicalBusinessFacts`**

In `apps/api/src/knowledge.ts`, export a helper:

```ts
export function buildCanonicalBusinessFacts(config: Record<string, unknown>): {
  source: KnowledgeSource;
  text: string;
} {
  const lines: string[] = ['Phonbot canonical business facts.'];
  const businessName = compact(String(config.businessName ?? ''));
  if (businessName) lines.push(`Business: ${businessName}`);
  const description = compact(String(config.businessDescription ?? ''));
  if (description) lines.push(`Beschreibung: ${description}`);
  const address = compact(String(config.address ?? ''));
  if (address) lines.push(`Adresse: ${address}`);
  const openingHours = compact(String(config.openingHours ?? ''));
  if (openingHours) lines.push(`Oeffnungszeiten laut Business-Einstellungen: ${openingHours}`);
  // Render structured services, legacy servicesText and vocabulary here.
  // Do not read customers, tickets, transcripts, bookings, call logs or billing status.
  const text = lines.join('\n');
  return {
    source: {
      id: 'db_canonical_business_facts',
      type: 'text',
      name: 'Phonbot Business Fakten',
      content: text,
      category: 'verified_facts',
      allowedUse: 'agent_facts',
      status: 'indexed',
    },
    text,
  };
}
```

- [ ] **Step 3: Merge generated DB facts before Retell KB sync**

In the deploy/knowledge preparation path, merge generated DB facts with user `knowledgeSources` before computing `knowledgeBaseSignature`.

Rules:

- DB facts are org-scoped and generated, not user-uploaded.
- DB facts override manual sources on direct conflict.
- Do not include `customers`, `tickets`, `call_transcripts`, concrete bookings, blocks, external events or Stripe customer status.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --dir apps/api run test -- --run src/__tests__/knowledge.test.ts src/__tests__/voice-prompt-guards.test.ts
pnpm --dir apps/api run typecheck
```

Expected: all pass.

## Task 4: Retell Data Storage And KB Health

**Files:**
- Modify: `apps/api/src/retell.ts`
- Modify: `apps/api/src/agent-config.ts`
- Modify: `apps/api/src/__tests__/retell-rag.test.ts`

- [ ] **Step 1: Add tests for explicit Retell storage and KB status reads**

Extend `retell-rag.test.ts` with a test that `createAgent`/`updateAgent` receives explicit `data_storage_setting` and that a new `getKnowledgeBase` wrapper requests `/get-knowledge-base/:id`.

- [ ] **Step 2: Add `getKnowledgeBase` wrapper**

In `apps/api/src/retell.ts`:

```ts
export async function getKnowledgeBase(knowledgeBaseId: string): Promise<RetellKnowledgeBase> {
  return retellRequest(`/get-knowledge-base/${encodeURIComponent(knowledgeBaseId)}`);
}
```

- [ ] **Step 3: Fail closed on KB sync uncertainty**

In deploy/sync logic, persist `last_retell_sync_error` and do not silently treat failed KB sync as safe current knowledge.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --dir apps/api run test -- --run src/__tests__/retell-rag.test.ts
pnpm --dir apps/api run typecheck
```

Expected: all pass.

## Task 5: Knowledge UI Risk Labels

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/ui/agent-builder/KnowledgeTab.tsx`

- [ ] **Step 1: Extend frontend type**

Add matching fields to `KnowledgeSource` in `apps/web/src/lib/api.ts`:

```ts
  category?: 'verified_facts' | 'pricing' | 'customer_faq' | 'industry_playbook' | 'legal_public' | 'unsafe_untrusted';
  verifiedAt?: string;
  expiresAt?: string;
  containsPii?: boolean;
  allowedUse?: 'agent_facts' | 'demo_facts' | 'internal_review_only';
  risk?: 'ok' | 'needs_review' | 'blocked';
```

- [ ] **Step 2: Add labels in KnowledgeTab**

In the source list row, show:

```tsx
{src.risk === 'needs_review' && <Badge color="orange">Pruefen</Badge>}
{src.risk === 'blocked' && <Badge color="red">Blockiert</Badge>}
{src.category && <span className="text-[10px] text-white/30">{src.category}</span>}
```

- [ ] **Step 3: Verify**

Run:

```bash
pnpm --dir apps/web run typecheck
pnpm --dir apps/web run build
```

Expected: both pass.

## Task 6: Offline RAG Eval Harness

**Files:**
- Create: `scripts/run-voice-ai-evals.mjs`
- Modify: `sandbox/voice-ai-quality/sample-eval-cases.jsonl`

- [ ] **Step 1: Add scorer script**

Create a script that loads JSONL, accepts a result JSONL path, and checks:

```js
const fs = require('node:fs');

function readJsonl(path) {
  return fs.readFileSync(path, 'utf8').trim().split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}

function includesAll(text, values = []) {
  const lower = text.toLowerCase();
  return values.every((v) => lower.includes(String(v).toLowerCase()));
}

function includesNone(text, values = []) {
  const lower = text.toLowerCase();
  return values.every((v) => !lower.includes(String(v).toLowerCase()));
}
```

It should fail if must-say is missing, must-not-say appears, or forbidden tool is called.

- [ ] **Step 2: Add at least 30 RAG cases**

Add cases for:

- stale pricing;
- conflicting pricing;
- prompt injection;
- missing source;
- privacy;
- legal guarantee;
- calendar conflict;
- demo simulation;
- ambiguous user yes;
- STT plan-name confusion.

- [ ] **Step 3: Verify script with sample output**

Run:

```bash
node scripts/run-voice-ai-evals.mjs sandbox/voice-ai-quality/sample-eval-cases.jsonl sandbox/voice-ai-quality/sample-results.jsonl
```

Expected: PASS for known good sample; FAIL for one intentionally bad sample.

## Task 7: Backend Critical Action Contract

**Files:**
- Modify: `apps/api/src/calendar.ts`
- Modify: `apps/api/src/retell-webhooks.ts`
- Modify: `apps/api/src/agent-config.ts`
- Test: `apps/api/src/__tests__/calendar-availability.test.ts`

- [ ] **Step 1: Assert booking success contract**

Add/extend tests so a booking is only voice-confirmable when:

```ts
expect(result).toMatchObject({
  ok: true,
  status: 'confirmed',
  bookingConfirmed: true,
});
```

Fallback tickets must return:

```ts
expect(result).toMatchObject({
  ok: true,
  status: 'fallback_ticket_created',
  bookingConfirmed: false,
});
```

- [ ] **Step 2: Make tool descriptions match**

In `apps/api/src/agent-config.ts`, ensure `calendar_book` says:

```ts
description: 'Create a booking only after explicit user confirmation. The agent may only say booked when the result has status=confirmed and bookingConfirmed=true.'
```

- [ ] **Step 3: Verify**

Run:

```bash
pnpm --dir apps/api run test -- --run src/__tests__/calendar-availability.test.ts src/__tests__/voice-prompt-guards.test.ts
pnpm --dir apps/api run typecheck
```

Expected: all pass.

## Task 8: Live RAG Metrics After Deploy

**Files:**
- Modify/Create only after locating current telemetry code.

- [ ] **Step 1: Locate Retell latency ingestion**

Run:

```bash
rg -n "latency|knowledge_base|call_analysis|retell" apps/api/src apps/web/src
```

- [ ] **Step 2: Store KB latency if Retell exposes it**

Add fields to call analysis metadata if available:

```ts
latencyKnowledgeBaseMs
latencyLlmMs
latencyE2eMs
```

- [ ] **Step 3: Add API stats and dashboard/readout**

Wire `latency.knowledge_base` through the existing stats endpoint and UI type. Verify Retell units before labeling milliseconds/seconds.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --dir apps/api run test -- --run
pnpm --dir apps/api run typecheck
pnpm --dir apps/web run typecheck
```

Expected: all pass.

## Review Checklist

- [ ] RAG never triggers side-effect tools by itself.
- [ ] Tool/Backend results override RAG in every documented path.
- [ ] Pricing/legal sources have freshness or review status.
- [ ] PII cannot be indexed into shared/global knowledge.
- [ ] Demo actions remain explicitly simulations.
- [ ] No old pricing/minute claims are reintroduced.
- [ ] Eval cases include prompt injection and stale facts.
- [ ] Live latency is measured before increasing `top_k`.

## Verification Commands

Run before claiming completion:

```bash
node -e "const fs=require('fs'); for (const f of ['sandbox/voice-ai-quality/dataset-schema.json','sandbox/voice-ai-quality/experiment-matrix.json']) JSON.parse(fs.readFileSync(f,'utf8')); for (const line of fs.readFileSync('sandbox/voice-ai-quality/sample-eval-cases.jsonl','utf8').trim().split(/\n/)) JSON.parse(line); console.log('sandbox json ok')"
pnpm --dir apps/api run test -- --run
pnpm --dir apps/api run typecheck
pnpm --dir apps/web run typecheck
pnpm --dir apps/web run build
```
