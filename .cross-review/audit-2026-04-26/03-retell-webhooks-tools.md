# 03 · Retell-Webhooks + Tool-Dispatchers

**Author**: Claude · **Reviewer**: Codex · **Status**: Awaiting counter-review
**Geprüfte Datei**: [apps/api/src/retell-webhooks.ts](../../apps/api/src/retell-webhooks.ts) (1088 LOC)
**Routen**: 6 (`/retell/webhook` lifecycle + 5 tool-endpoints: `calendar.findSlots`, `calendar.book`, `ticket.create`, `recording.declined`, `external.call`)

Dieses Modul ist die größte Trust-Boundary von Phonbot — jeder Anruf läuft hier durch, jede Buchung, jedes Ticket, jede Minuten-Abrechnung.

## Was solide ist

1. **`verifyRetellSignature` ist hart**: kein NODE_ENV-Bypass (außer explizitem `ALLOW_UNSIGNED_WEBHOOKS=true`-Opt-in in Dev), strict hex-validation der Signatur, `timingSafeEqual` mit length-pre-check.
2. **Idempotency-Gate für `call_ended`**: `INSERT INTO processed_retell_events ON CONFLICT DO NOTHING RETURNING call_id` — Retell-Retries verdoppeln nicht die `minutes_used` oder OpenAI-Insights-Kosten.
3. **§201 StGB recording-declined Pfad**: Tool-Aufruf setzt Flag → `call_ended` liest Flag → `deleteCall(callId)` bei Retell + skip Transcript-Insert. Gut gedacht.
4. **Sekundengenaue Abrechnung**: `Math.round((callDurationMs / 60000) * 100) / 100` → NUMERIC(10,2) → 61s = 1.02 min, deckt AGB §5.
5. **`reconcileMinutes` mit Pre-Reservation**: closing der race wo parallele Pre-Call-Checks beide das letzte Kontingent freigeben.
6. **Tenant-Resolution mit Doppel-Pfad**: `signedTenantId` (aus signed query param wir-zu-uns) + `getOrgIdByAgentId` (DB-Lookup für defence-in-depth).
7. **`mergeTicketMetadata` org-scoped**: First-writer-wins JSONB-Concat, mit `org_id`-Match → kein Cross-Tenant-Write.
8. **`call_analyzed` late-merge**: für lange Calls kommt die Analyse als separater Event → COALESCE-Update updatet nur bisher null Felder, überschreibt nichts.
9. **Trace nur Param-NAMES, keine Values** (line 1057): LLM-extrahierte Args können PII enthalten (Name, Phone, Customer-IDs) → DSGVO-Datenminimierung erfüllt.
10. **`external.call` getrennt von Tool-Logik**: SSRF + Method-Whitelist + 100KB Response-Cap + Per-Call-Rate-Limit leben in `api-integrations.ts` (saubere Verantwortungs-Trennung).

---

## Befunde

### 🔴 CRITICAL-1 · Lifecycle-Webhook akzeptiert ungesignierte `call_ended`-Events

**Datei**: [retell-webhooks.ts:288–298](../../apps/api/src/retell-webhooks.ts#L288-L298)

```ts
// ── Call lifecycle webhook ─────────────────────────────────────────────────
// Retell sends call_started, call_ended, call_analyzed events here.
app.post('/retell/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
  // Tool-endpoint auth: ...
  // ... We keep HMAC strict on the call lifecycle webhook (above) because
  // those directly write minutes_used + transcripts.
  if (!verifyRetellToolRequest(req as RawBodyRequest)) {     // ⚠️ NICHT HMAC-only
    return reply.status(401).send({ error: 'Unauthorized' });
  }
```

**Befund**:
- Der Comment sagt klar: HMAC strict für lifecycle-events weil sie `minutes_used` + `call_transcripts` mutieren.
- Der **Code** ruft aber `verifyRetellToolRequest` — und das ist eine **OR**-Kette:
  ```ts
  function verifyRetellToolRequest(req): boolean {
    if (verifyRetellSignature(req)) return true;        // ← versucht HMAC zuerst
    if (getSignedToolTenantId(req)) return true;        // ← signed query fallback
    const agentId = ... body._retell_agent_id ...;
    return typeof agentId === 'string' && agentId.length > 0;  // ← nur agent_id im body reicht
  }
  ```
- Heißt: wenn ein Angreifer einen **bekannten `agent_id`** im body schickt (z. B. aus einem Sentry-Payload geleakter agent_id), wird der **call_ended-Webhook ungesignert akzeptiert**.

**Impact**:
- **Finanzieller Schaden**: fake `call_ended` mit hoher `start_timestamp/end_timestamp`-Diff → `reconcileMinutes` fügt fake Minuten zu `orgs.minutes_used` hinzu → Customer landet ungerechtfertigt im Overage-Bereich → Stripe rechnet Geld ab das gar nicht für echte Calls war.
- **Datenintegrität**: fake Transcripts in `call_transcripts` table → vergiftet die OpenAI-Insights-Pipeline → Auto-Suggestion-Engine schlägt unsinnige Prompt-Änderungen vor.
- **Customer-Webhook-Spam**: `fireInboundWebhooks(orgId, 'call.ended', ...)` feuert auf die kunden-konfigurierten Webhook-URLs → Customer's CRM bekommt fake events.
- **Lautes DELETE-Triggering**: ein fake call_ended mit fake-recording-declined-flag könnte `deleteCall()` für eine LEGITIME `callId` triggern (wenn man die call_id eines echten Calls erraten/leaken kann) — Retell löscht den echten Call.

**Mitigationen die teilweise greifen**:
- `getOrgIdByAgentId(agentId)` returnt `null` für unbekannte agent_ids → side-effects skippen für completely-fake agents. Aber: wenn agent_id leaked (Sentry, Customer-Support-Screen-Share), ist der dazugehörige org das Ziel.
- `processed_retell_events.call_id` Idempotency hilft nur bei Retries DESSELBEN Events — fakes mit zufälligen call_ids hauen alle durch.

**Severity**: **🔴 CRITICAL** — direkter finanzieller Schaden + Datenintegrität bei publik-gewordener agent_id.

**Status**: ✅ **GEFIXT** in commit `87a9f60` — Lifecycle-Webhook nutzt jetzt strict `verifyRetellSignature`, kein body-only-Fallback mehr. Bei Reject loud-error-log mit event + agent_id für Sichtbarkeit.

**Vorsichtiger Fix**:
```ts
app.post('/retell/webhook', async (req, reply) => {
  // Lifecycle events MUTATE billing + persist transcripts. HMAC mandatory,
  // no body-only fallback. The OR-chain stays for tool endpoints.
  if (!verifyRetellSignature(req as RawBodyRequest)) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  // ... rest unchanged
```

**Pre-Deploy-Verifikation**: bei Retell prüfen dass **alle** lifecycle-Events (`call_started`, `call_ended`, `call_analyzed`) tatsächlich `x-retell-signature` setzen. Wenn ein Event ungesignert kommt, würden wir den nach diesem Fix als 401 ablehnen — Verlust von call_ended-Daten = Geld-Loss in der anderen Richtung.

---

### 🟠 HIGH-1 · `recording_declined`-Race wenn DB-Insert silent fails

**Datei**: [retell-webhooks.ts:985–992](../../apps/api/src/retell-webhooks.ts#L985-L992)

```ts
if (pool) {
  await pool.query(
    `INSERT INTO recording_declined_calls (call_id, org_id, tenant_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (call_id) DO NOTHING`,
    [callId, orgId, signedTenantId ?? null],
  ).catch((err: Error) => req.log.error({ err: err.message, callId }, 'recording_declined_calls insert failed'));
}
```

**Befund**:
- `.catch()` swallowed den Fehler nach Logging → der Tool-Handler returnt `{ ok: true }` als hätte alles funktioniert.
- Wenn der INSERT scheitert (DB-Hiccup, Connection-Pool-Erschöpfung, Schema-Drift), bleibt **kein Flag in der DB**.
- Beim folgenden `call_ended`-Webhook liest `SELECT 1 FROM recording_declined_calls WHERE call_id = $1` → 0 rows → `recordingDeclined = false` → **Transcript wird gespeichert obwohl der Anrufer widersprochen hat**.
- §201 StGB-Verstoß: Speicherung ohne Einwilligung. Bis zu 3 Jahre Haft (theoretisch — praktisch DSGVO-Bußgeld + Reputationsschaden).

**Severity**: **🟠 HIGH** — selten triggernd (DB muss failen genau in dem 50ms-Fenster), aber wenn es trifft, ist es ein Compliance-Verstoß.

**Status**: ✅ **GEFIXT** in commit `87a9f60` — `await` + try/catch, Tool returnt 503 mit Message wenn der INSERT failed → LLM kann den Caller nochmal fragen oder den Anruf sauber beenden.

**Vorsichtiger Fix**:
- Tool muss `503` returnen wenn der Flag-INSERT failed, NICHT `200`. So weiß Retell + LLM dass etwas nicht klappte und kann den User informieren („Ich konnte deinen Widerspruch nicht speichern, bitte nenne ihn nochmal").
- Alternative: `recording_declined`-Flag zusätzlich in einer **In-Memory + Redis**-Layer halten als safety net (call_ended-Pfad checkt beide).
- Plus: `await` statt `.catch()`, dann strukturiertes 503 wenn rejected. Try/catch mit explicit reply.status(503).

```ts
try {
  await pool.query(/* same INSERT */);
} catch (err) {
  req.log.error({ err: (err as Error).message, callId }, 'recording_declined_calls insert failed');
  return reply.status(503).send({ ok: false, error: 'STORAGE_UNAVAILABLE' });
}
return { ok: true };
```

---

### 🟠 HIGH-2 · `fireInboundWebhooks` silent-catches verstecken Customer-Webhook-Failures

**Dateien**: 5 Stellen — [retell-webhooks.ts:314, 469, 531](../../apps/api/src/retell-webhooks.ts#L314)

```ts
fireInboundWebhooks(orgId, 'call.started', { ... }).catch(() => {}); // logged inside
```

**Befund**:
- `.catch(() => {})` overall — der Comment behauptet „logged inside", aber das ist nur wahr wenn `fireInboundWebhooks` selbst ein eigenes try/catch hat (sieht nach `inbound-webhooks.ts:97` so aus, OK für `readConfig`-Fehler).
- ABER: jede unhandled Promise rejection irgendwo tiefer — z. B. ein synchroner throw vor dem first await in `fireInboundWebhooks`, oder ein Promise-Reject das an dem inneren try/catch vorbeischlängelt — landet im outer `.catch(() => {})` und ist verloren.
- CLAUDE.md §13 verbietet `.catch(() => {})` ohne Logging. Comment „logged inside" ist nicht selbst-tragend (man muss in `inbound-webhooks.ts` reinschauen um zu prüfen).

**Severity**: **🟠 HIGH** — wenn der Code in `inbound-webhooks.ts` future-edited wird ohne den `try/catch` zu erhalten, sind alle Customer-Webhook-Failures dark.

**Status**: ✅ **GEFIXT** in commit `87a9f60` — alle 5 `.catch(() => {})` ersetzt durch `.catch((err) => req.log.warn({ err.message, orgId, event, ... }, 'inbound-webhook fan-out failed'))`. Failures jetzt im prod-Log strukturiert sichtbar.

**Vorsichtiger Fix**:
```ts
fireInboundWebhooks(orgId, 'call.started', { ... }).catch((err: Error) =>
  req.log.warn({ err: err.message, orgId, event: 'call.started' }, 'inbound-webhook fan-out failed'),
);
```
Bei allen 5 Aufrufstellen.

---

### 🟡 MEDIUM-1 · Demo-Call-Tabelle ohne anti-spam · ✅ COVERED (Round 1, via CRITICAL-1)

**Status**: ✅ COVERED — CRITICAL-1-Fix (lifecycle-webhook strict HMAC) verhindert komplett ungesignerte fake call_ended-Events. Damit kann ein Angreifer demo_calls nicht mehr per Body-Forge fluten. Per-agent-Rate-Limit als zusätzliche Schicht weiterhin sinnvoll für später.

**Datei**: [retell-webhooks.ts:478–503](../../apps/api/src/retell-webhooks.ts#L478-L503)

**Befund**:
- Wenn `orgId === null` (agent ist kein paying-customer-Agent), wird via `readDemoCallTemplate(agentId)` geprüft ob's ein Demo-Agent ist. Wenn ja → INSERT INTO demo_calls.
- Mitigation: `templateId` muss matchen — Demo-Agent-IDs sind eine endliche Menge.
- Aber: ein Angreifer der eine Demo-Agent-ID kennt (z. B. aus einer Marketing-Demo-URL) kann beliebig viele fake call_ended events POSTen mit unique call_ids → demo_calls table fluten.
- Jeder fake row hat optional caller_email / caller_phone aus dem fake `extracted` payload → eventuell triggert Lead-Promotion.

**Vorsichtiger Fix**: 
- Per-`agent_id`-Rate-Limit auf demo_calls Insert (z. B. 50/Stunde).
- ODER (cleaner): Demo-Call-Insert NUR wenn lifecycle-webhook strikt HMAC-verified ist (CRITICAL-1 fix wirkt hier mit).

---

### 🟡 MEDIUM-2 · `analyzeCall` + `analyzeOutboundCall` dynamic-import in hot path · ✅ GEFIXT (Round 1)

**Status**: ✅ GEFIXT — `analyzeOutboundCall` jetzt top-level static-imported (kein Circular-Dep). Konsistent mit `analyzeCall`. Spart 50–200ms first-call-Latenz.

**Datei**: [retell-webhooks.ts:420–425, 428–433](../../apps/api/src/retell-webhooks.ts#L420-L425)

```ts
import('./outbound-insights.js').then(({ analyzeOutboundCall }) =>
  analyzeOutboundCall(...)
).catch((err: Error) => req.log.error(...));
```

**Befund**:
- Dynamic-import bei jedem outbound call_ended → 50-200ms first-time-cost, danach gecached.
- Vermutlich um Circular-Dep zu brechen, aber `analyzeCall` (für inbound) ist top-level imported (line 12 oder ähnlich) — Inkonsistenz.

**Fix**: top-level static import wenn keine Circular-Dep besteht. Falls doch — dann beide Calls per dynamic import, einheitliches Pattern.

---

### 🟡 MEDIUM-3 · Tracing nutzt `tenantId` als orgId — semantische Verwirrung · ✅ GEFIXT (Round 1)

**Status**: ✅ GEFIXT — `TraceEventSchema` um optionales `agentId` erweitert (mit Doc-Comment dass `tenantId` weiterhin Org-Isolation-Key ist, NICHT renamed wegen Backwards-Compat). Alle 9 Trace-Call-Sites in `retell-webhooks.ts` schicken jetzt `agentId`. Multi-Agent-Orgs können Traces pro Agent gruppieren.

**Datei**: [retell-webhooks.ts:638, 674, 806](../../apps/api/src/retell-webhooks.ts#L638)

```ts
await appendTraceEvent({
  type: 'tool_call',
  sessionId: callId,
  tenantId: orgIdForSlots ?? undefined,   // ← Field heißt tenantId aber der Wert ist orgId
  ...
});
```

**Befund**: 
- `appendTraceEvent`-Parameter heißt `tenantId` aber der übergeben Wert ist tatsächlich `orgId` (das DB-`org_id`-UUID).
- Bei Multi-Agent-Orgs (Pro/Agency) sind tenantId und orgId verschieden → Trace-Tabelle gruppiert auf orgId-Ebene, nicht agent-Ebene → man verliert die Differenzierung welcher Agent ein Tool aufgerufen hat.

**Fix**:
- `appendTraceEvent`-Schema erweitern um echtes `tenantId` (the agent's tenant) **plus** `orgId`. Beide tracken.
- Naming klarer: `agentTenantId` und `orgId`.

---

### 🔵 LOW-1 · Comment-Lüge: „strict HMAC on lifecycle webhook (above)" copy-pasted in 5 Tool-Endpoints

**Datei**: in 5 Stellen identisch, z. B. [retell-webhooks.ts:566–572](../../apps/api/src/retell-webhooks.ts#L566-L572)

```ts
// ... We keep HMAC strict on the call lifecycle webhook (above) because
// those directly write minutes_used + transcripts.
```

**Befund**: 
1. Es gibt **kein** „above" — es gibt nur den lifecycle-webhook OBERHALB im selben File, und der ist gerade NICHT HMAC-strict (siehe CRITICAL-1).
2. Der Block ist 5× wortwörtlich kopiert. Wenn Comments driften (was sie hier tun), driften alle 5 Kopien.

**Fix**: 
- Nach CRITICAL-1-Fix: Comment-Aktualisieren auf „lifecycle webhook above is strict HMAC; tool endpoints accept body-only auth because Retell doesn't sign Custom-Function calls".
- Comment aus jedem Tool-Handler in eine **einzige** zentrale Konstante / Module-Doc-Comment ziehen — DRY für Comments auch.

**Status**: ✅ **GEFIXT** in commit `87a9f60` — File-Header-Doc-Block (TOOL_AUTH_NOTE) erklärt jetzt beide Auth-Bars zentral; jedes Tool-Handler-Comment ist 1-Zeile-Pointer dorthin.

---

### 🔵 LOW-2 · `getCallerPhone` blacklist mit „unknown"-Strings ist fragile · ✅ GEFIXT (Round 1)

**Status**: ✅ GEFIXT — Multilinguale „no number"-Phrases ergänzt: DE/EN/ES/FR/IT/NL/TR/PL + n/a/null/none/undefined. Voice-Catalog-Sprachen abgedeckt.

**Datei**: [retell-webhooks.ts:174](../../apps/api/src/retell-webhooks.ts#L174)

```ts
if (/^(unknown|anonymous|unbekannt|nicht angegeben)$/i.test(trimmed)) continue;
```

**Befund**: hard-coded Blacklist von Phrases die LLM zurückgeben könnte wenn keine Telefonnummer extrahiert wurde. Spanisch, Französisch, Türkisch fehlen — alles Sprachen die wir seit dem Voice-Catalog-Sweep bedienen.

**Fix**: per-Sprache-Synonyme erweitern — `desconocido`, `inconnu`, `bilinmiyor`, etc. Oder besser: LLM-Prompt zwingen Phone-Nummern in E.164-Format auszugeben oder leeren String, dann simple `if (!trimmed)` reicht.

---

## Open Questions for Codex

**Q1**: Bei CRITICAL-1 (HMAC fehlt im lifecycle-webhook) — kannst du das Verhalten reproduzieren? Konkret: ein curl-POST gegen `https://phonbot.de/api/retell/webhook` mit body `{"event":"call_ended","call":{"agent_id":"<bekannter agent_id>","call_id":"fake-uuid","start_timestamp":1000000,"end_timestamp":2000000}}` ohne `x-retell-signature` — wenn der durchgeht und in `processed_retell_events` ein insert ist, ist der Bug bestätigt. **Achtung**: nicht in Prod testen, sonst sind echte minutes_used inflated.

**Q2**: Bei HIGH-1 (recording_declined Race) — siehst du eine bessere Strategie als „Tool returnt 503 bei Insert-Fail"? Z. B. ein synchronen DB-Health-Check vor dem Tool-Insert um schneller zu schwächeln?

**Q3**: Bei MEDIUM-1 (demo_calls Anti-Spam) — wäre der Fix „Demo-Call-Insert nur bei strikt HMAC-verified lifecycle-webhook" (gekoppelt an CRITICAL-1) ausreichend, oder brauchen wir zusätzlich pro-agent-rate-limit?

**Q4**: Allgemein — siehst du im File etwas was ich übersprungen habe? Insbesondere `calendar.book` Fallback-Pfad (Line 698-762 — Ticket-Fallback wenn Booking failt) hab ich nur überflogen. Edge-cases?

**Q5**: `verifyRetellToolRequest` mit body-only-fallback — ist das überhaupt eine bewusste Design-Entscheidung, oder hat sich das aus „Retell Custom-Functions sind nicht signiert" zwangsläufig ergeben? Falls Letzteres: ist es Zeit Retell-Support zu pingen ob sie HMAC für Custom-Functions inzwischen anbieten?

---

## Codex Counter-Review

<!-- Codex schreibt hier rein -->

_Pending — Plugin in User's Claude Code aktuell nicht aktiv._
