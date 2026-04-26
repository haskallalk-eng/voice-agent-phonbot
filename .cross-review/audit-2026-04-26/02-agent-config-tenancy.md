# 02 · Agent-Config + Multi-Tenancy

**Author**: Claude · **Reviewer**: Codex · **Status**: Awaiting counter-review
**Geprüfte Datei**: [apps/api/src/agent-config.ts](../../apps/api/src/agent-config.ts) (1224 LOC)
**Routen**: 13 (`/agent-configs`, `/agent-config/new`, `/agent-config`, `/agent-config/preview`, `/agent-config/stats`, `/agent-config/knowledge/pdf`, PUT `/agent-config`, `/agent-config/deploy`, DELETE `/agent-config/:tenantId`, `/agent-config/web-call`, `/calls`, `/calls/:callId`, weitere)

## Was solide ist

1. **`loadOwnedConfigRow` zentralisiert Ownership-Check** — `WHERE tenant_id = $1 AND (org_id = $2 OR (org_id IS NULL AND tenant_id = $2::text))`. Konsistente Lese-Pfad in PUT/Deploy/Stats.
2. **`tenantIdAvailableOrOwned` Pre-Check** — schützt vor hostile takeover via PUT mit fremder tenant_id.
3. **`writeConfig` mit `ON CONFLICT WHERE`-Defense-in-Depth** — selbst wenn ein Handler den Pre-Check vergisst, kann der INSERT keine fremde Org überschreiben (`agent_configs.org_id IS NULL OR agent_configs.org_id = EXCLUDED.org_id`). 0-rows-RETURNING löst sauber 409 aus.
4. **`applyIntegrationEncryption` + `mergeAndEncryptIntegrations`** — Plaintext-`authValue` wird vor DB-Write durch AES-256-GCM ersetzt; existierende `enc:v1:`-Werte werden bei Save übernommen, sodass das Frontend die Sentinel-Maske roundtripped.
5. **`toClientConfig` für jede Response** — Encrypted Auth-Values werden via `maskApiIntegrationsForClient` zu `••••xyz9` maskiert; **das Klartext-Secret verlässt nie die DB-Encryption-Boundary**.
6. **Server-authoritative Retell-IDs** in PUT + Deploy — `parseAgentConfig({...raw, retellLlmId: serverIds.retellLlmId, ...})` überschreibt clientside-Werte; Frontend kann nicht behaupten „this is my retellAgentId".
7. **Plan-Limit-Check** in `/agent-config/new` (Free=1, Starter=1, Pro=3, Agency=10).
8. **Reservation-Pattern** in `/agent-config/web-call` via `tryReserveMinutes()` — atomic CAS verhindert dass parallele Pre-Call-Checks beide das gleiche letzte Kontingent freigeben.
9. **PDF-Upload-Hardening** — `KNOWLEDGE_PDF_MAX_BYTES` (50 MB), MIME + filename-suffix-check, body-size-loop mit early-abort, multipart-plugin mit `limits.fileSize`.
10. **DELETE-mit-Re-Auth ab 30 Tagen Alter** — interessant: `/agent-config/:tenantId` verlangt Passwort-Bestätigung wenn der Agent älter als 30d ist (junge Agents sind „experimental, easy to delete"). Schmaler aber kluger Schutz vor schneller Löschung von Production-Agents.
11. **`invalidateOrgIdCache` nach Deploy** — verhindert dass `retell-webhooks.ts` den Cache mit stalem agent→org-Mapping bedient.

---

## Befunde

### 🔴 CRITICAL-1 · `readConfig` ohne `orgId` umgeht Multi-Tenant-Isolation

**Datei**: [agent-config.ts:113](../../apps/api/src/agent-config.ts#L113)

```ts
export async function readConfig(tenantId: string, orgId?: string): Promise<AgentConfig> {
  // ...
  const sql = orgId
    ? 'select data from agent_configs where tenant_id = $1 and (org_id = $2 or tenant_id = $2::text)'
    : 'select data from agent_configs where tenant_id = $1';   // ⚠️ no org filter
```

**Befund**:
- `orgId` ist als **optional** typisiert. Wenn ein Caller den Parameter vergisst (oder ein neuer Code-Path den Default nimmt), liest die Funktion die Config OHNE Org-Filter — d. h. **jeder andere Tenant kann gelesen werden** wenn man nur `tenant_id` kennt.
- `tenant_id` ist **niedriges Geheimnis**: bei Free-Plan-Default ist es identisch mit `orgId` (UUID), bei custom Multi-Agent-Setups ist es `${orgId}-${timestamp}` — letzteres kann man nicht direkt erraten, aber ein Snapshot eines Configs (etwa Sentry-Error-Body, Customer-Support-Screen-Share) könnte ihn leaken.
- Aktuell: ich sehe **5 Aufrufer** im Code (`registerAgentConfig` Endpoints, `agent-runtime.ts`, `retell-webhooks.ts`, `voices.ts`). Bei einem davon könnte `orgId` versehentlich nicht gesetzt sein → schweigsamer Cross-Tenant-Leak.

**Severity-Begründung**: Multi-Tenant-Isolation ist ein **Architektur-Versprechen** (CLAUDE.md §15). Eine Funktion die per Default ohne Filter abfragt, ist wie eine SQL-Query ohne `WHERE org_id`. Auch wenn alle bekannten Aufrufer aktuell sauber sind, ist die Existenz des „kein-orgId"-Pfads ein latentes 🔴.

**Fix-Vorschlag**:
```ts
// Variante A: orgId mandatory machen (saubere Lösung)
export async function readConfig(tenantId: string, orgId: string): Promise<AgentConfig> {
  // single SQL with org filter, kein Branch
}

// Variante B: explizit gefährlich markieren wenn Backend-Tool das wirklich braucht
export async function readConfigUnsafeNoOrgFilter(tenantId: string): Promise<AgentConfig> {
  // Klar via Naming gekennzeichnet, code-review fängt Aufrufer
}
```
Plus: `grep` nach Aufrufern und sicherstellen dass alle den orgId-Pfad nehmen.

---

### 🟠 HIGH-1 · `web-call` Fallback kann anderen Agent als gemeint nehmen

**Datei**: [agent-config.ts:1163–1170](../../apps/api/src/agent-config.ts#L1163-L1170)

```ts
} else {
  // Fallback: find first deployed agent for this org
  const res = await pool.query(
    `SELECT data FROM agent_configs WHERE org_id = $1 AND data->>'retellAgentId' IS NOT NULL ORDER BY updated_at DESC LIMIT 1`,
    [orgId],
  );
  config = res.rows[0]?.data ? parseAgentConfig(res.rows[0].data) : await readConfig(orgId, orgId);
}
```

**Befund**:
- Bei Pro/Agency-Orgs (3/10 Agents) kann der User „Agent A" im UI öffnen und auf „Test" klicken — wenn das Frontend `agentTenantId` nicht im Body schickt, fällt der Backend auf `ORDER BY updated_at DESC LIMIT 1` zurück.
- Wenn jemand parallel „Agent B" gerade gespeichert hat (anderer Tab, anderer Mitarbeiter), wird der Web-Call gegen Agent B gestartet — **User testet Agent B obwohl er Agent A im Builder offen hat**.
- Symptom: „mein Agent verhält sich nicht wie konfiguriert" → tatsächlich war's der falsche Agent.

**Fix-Vorschlag**:
- Frontend MUSS `agentTenantId` immer mitschicken — Pflicht-Parameter machen, sonst 400.
- Wenn alte Clients diesen Param nicht senden, transitional: server-side Default = der **zuletzt geöffnete** Agent statt zuletzt gespeicherte (DB-Spalte `last_opened_at` oder Session-Storage).

---

### 🟠 HIGH-2 · PDF-Upload + PUT umgehen Plan-Limit

**Datei**: [agent-config.ts:797–832](../../apps/api/src/agent-config.ts#L797-L832) vs. [agent-config.ts:1035–1057](../../apps/api/src/agent-config.ts#L1035-L1057) vs. [agent-config.ts:868–870](../../apps/api/src/agent-config.ts#L868-L870)

**Befund**:
- `/agent-config/new` checkt strikt `LIMITS[plan]` und blockt bei Überschreitung.
- **Aber**: `PUT /agent-config` mit einer **brandneuen** `tenantId` (z. B. `${orgId}-backdoor`) läuft durch:
  1. `tenantIdAvailableOrOwned()` returnt `true` für unclaimed.
  2. `loadOwnedConfigRow()` returnt `exists: false`.
  3. `writeConfig` macht INSERT (keine row da).
  4. Result: Free-Plan-User mit harter `1`-Agent-Grenze hat jetzt 2.
- Gleicher Trick mit `POST /agent-config/knowledge/pdf` (Line 868) — neuer `tenantId` im Multipart-Field, durch `tenantIdAvailableOrOwned()` durch, INSERT in agent_configs.

**Severity-Begründung**: Plan-Limit ist Geld. Wenn ein Free-User unbegrenzt Agents anlegen kann via direktem PUT, brennt das Retell-/Twilio-Budget durch. **Echtes Revenue-Loss-Risiko**.

**Fix-Vorschlag**:
- `writeConfig` einen optionalen `creating: boolean` Flag mitgeben. Wenn `creating === true` und `loadOwnedConfigRow().exists === false`, dann **vor dem INSERT** den agents-Limit-Check ausführen (gleicher Code wie in `/agent-config/new`).
- ODER (simpler): `tenantIdAvailableOrOwned` returnt `false` wenn der User sein Plan-Limit schon ausgeschöpft hat — `tenantIdAvailableOrOwnedRespectingLimit(tenantId, orgId, planLimit)`.
- PDF-Upload-Pfad muss denselben Schutz nutzen.

---

### 🟡 MEDIUM-1 · `LIMITS`-Map duplikat zur PLANS-Definition

**Datei**: [agent-config.ts:804](../../apps/api/src/agent-config.ts#L804) vs. [billing.ts](../../apps/api/src/billing.ts)

```ts
const LIMITS: Record<string, number> = { free: 1, starter: 1, pro: 3, agency: 10 };
```

**Befund**:
- Hardcoded statt aus `PLANS` aus `billing.ts` importiert.
- Wenn Plan-Limits ändern (Marketing entscheidet „Pro hat jetzt 5 Agents"), muss man an 2 Stellen anpassen → eine vergessen → silent inconsistency.

**Fix-Vorschlag**:
```ts
import { PLANS, type PlanId } from './billing.js';
// ...
const limit = PLANS[plan as PlanId]?.agents ?? 1;
```
Single source of truth.

---

### 🟡 MEDIUM-2 · `/agent-config/stats` ohne per-route Rate-Limit

**Datei**: [agent-config.ts:922](../../apps/api/src/agent-config.ts#L922)

**Befund**:
- Frontend pollt diese Route alle 15 s (siehe `agent-builder/index.tsx`) im offenen Builder, plus Auto-Refresh nach Save/Deploy.
- Drei offene Tabs in einem Browser → 3 Polls × 4/min = 12 calls/min pro User.
- Jeder Call macht ein Retell API call (`listCalls`) — Retell hat eigenes Rate-Limit.
- Wenn 50 User gleichzeitig den Builder offen haben: 600 Retell-Calls/min, davon Großteil unnötig.

**Fix-Vorschlag**:
- Per-route Rate-Limit `60/min per orgId` (nicht per-IP, weil Mehrere User pro Org).
- Backend-side Cache: Ergebnis pro `retellAgentId` für 30 s in Memory cachen, Frontend-Poll bedient das Cached-Result.
- Frontend: `Page Visibility API` nutzen, Polling stoppen wenn Tab nicht sichtbar.

---

### 🟡 MEDIUM-3 · `opening-hours-sync` fire-and-forget ohne Log

**Datei**: [agent-config.ts:240–242](../../apps/api/src/agent-config.ts#L240-L242)

```ts
void import('./opening-hours-sync.js').then(({ syncOpeningHoursToChipy }) =>
  syncOpeningHoursToChipy(orgId, normalized.openingHours),
).catch(() => {/* non-fatal */});
```

**Befund**:
- `catch (() => {})` — verstößt direkt gegen CLAUDE.md §13 (Verbot von silent-swallow ohne `app.log.warn`).
- Wenn der Sync scheitert (DB hiccup, race condition mit calendar-page), bleibt Inkonsistenz: Builder zeigt Öffnungszeiten OK, Calendar-Tab zeigt sie nicht oder veraltet.
- User merkt's evtl. erst beim nächsten Test-Call (Chipy bietet falsche Slots an).

**Fix-Vorschlag**:
```ts
.catch((err) => {
  // Don't fail the agent-config save just because the chipy-schedules
  // mirror is out of sync — but log loudly so we can detect drift.
  // Mirror is best-effort UI cache, agent-config.openingHours is the truth.
  // (Optional: Sentry-capture for drift-detection alarms)
  console.warn(
    'opening-hours-sync failed for org',
    orgId,
    (err as Error).message,
  );
});
```
Plus: top-level static import statt dynamic — siehe LOW-1.

---

### 🔵 LOW-1 · Dynamic-import im Hot-Path

**Datei**: [agent-config.ts:240](../../apps/api/src/agent-config.ts#L240)

`void import('./opening-hours-sync.js').then(...)` macht bei jedem `writeConfig` ein dynamic import. Erstes mal: 50–200 ms Latenz. Danach gecached, aber trotzdem ein async-hop. War vermutlich um Circular-Dependency zu vermeiden.

**Fix-Vorschlag**: prüfen ob top-level `import { syncOpeningHoursToChipy } from './opening-hours-sync.js';` einen Circular-Dep-Crash gibt. Wenn nicht: static import.

---

### 🔵 LOW-2 · `/agent-config/preview` zeigt immer Default-Agent

**Datei**: [agent-config.ts:907–915](../../apps/api/src/agent-config.ts#L907-L915)

```ts
app.get('/agent-config/preview', { ...auth }, async (req: FastifyRequest) => {
  const { orgId } = req.user as JwtPayload;
  const config = await readConfig(orgId, orgId);  // tenantId = orgId
```

**Befund**: Bei Multi-Agent-Org wird immer der „Default-Agent" (tenantId == orgId) preview'd, nicht der gerade im UI editierte. Frontend muss `?tenantId=` mitschicken oder bekommt falsche Vorschau.

**Fix-Vorschlag**: `tenantId` aus query-params lesen, fallback auf orgId.

---

### 🔵 LOW-3 · `parseAgentConfig` mit `.passthrough()` lässt Typo-Felder durch

**Datei**: [agent-config.ts:94](../../apps/api/src/agent-config.ts#L94)

`AgentConfigSchema.passthrough()` heißt: alle nicht-im-Schema-stehenden Felder werden klaglos in die DB geschrieben. Pro: backward-compat bei neuen Frontend-Feldern. Contra: ein Tippfehler wie `customPromtBlock` (statt `customPromptBlock`) landet als unsichtbares JSONB-Garbage in der DB.

**Fix-Vorschlag**:
- `.passthrough()` ist OK fürs überleben älterer Clients, ABER: ein periodischer Scanner (oder Schema-Diff bei deploy) der unbekannte Felder loggt. Detection > Prevention.
- Alternative: definierte Whitelist erlaubter Extra-Felder (`knowledgeSources`, `apiIntegrations`, `extractedVariables`, etc.) statt freier passthrough.

---

### 💡 NICE · `transferToolName` 30-char-truncation

**Datei**: [agent-config.ts:253–255](../../apps/api/src/agent-config.ts#L253-L255)

Phone-Numbers > 30 nicht-alphanumerische Zeichen → name-collision möglich. Praktisch bei DACH-Phones nie. Dokumentieren als known limitation.

---

### 💡 NICE · `tenantIdAvailableOrOwned` doppelte Round-Trip

`writeConfig` macht ON CONFLICT mit Owner-Check; davor wird im Handler `tenantIdAvailableOrOwned` als Pre-Check aufgerufen — das ist eine extra DB-Roundtrip die der ON CONFLICT eh schon abfängt.

**Fix-Vorschlag**: Pre-Check entfernen, ON CONFLICT ist autoritativ. Sicherheit kommt aus der WHERE-Klausel im Conflict-Path, nicht aus dem Pre-Check. ABER: der Pre-Check liefert eine bessere Fehlermeldung („Not your agent" 403 vs. „TENANT_OWNED_BY_OTHER_ORG" 409). Frage zur Codex-Diskussion: ist die saubere Fehlermeldung den Extra-Roundtrip wert?

---

## Open Questions for Codex

**Q1**: Bei CRITICAL-1 — siehst du einen Aufrufer von `readConfig(tenantId)` ohne `orgId`-Argument? Mein Grep findet nur Stellen die orgId mitschicken, aber bei 1224 LOC könnte ich was übersehen haben. Bestätige + zähle die Aufrufer.

**Q2**: Bei HIGH-2 (Plan-Limit-Bypass) — testbar via curl? Wenn du einen schnellen `curl PUT /agent-config -d '{"tenantId":"backdoor",...}'` mit valid JWT durchbringst und nachher `SELECT count(*) FROM agent_configs WHERE org_id = $orgId` zeigt 2 statt 1 → bestätigt. Bist du in der Lage das auf Staging zu reproduzieren?

**Q3**: Bei MEDIUM-1 — ist `PLANS.agents` ein bestehendes Feld in `billing.ts`? Wenn nicht, müssen wir das erst dort einführen, dann hier importieren.

**Q4**: Bei NICE „tenantIdAvailableOrOwned doppelte Round-Trip" — würdest du den Pre-Check rauswerfen oder behalten? Mein Bauchgefühl: behalten weil 403 vs. 409 für UI klarer.

**Q5**: Allgemein — siehst du in dem 1224-LOC-File einen Bereich wo ich gar nicht hingeschaut habe? `deployToRetell` (137 Zeilen, viel Retell-Logik), `ensureCallbackAgent` (45 Zeilen) und `triggerCallback` habe ich nur überflogen. Wenn da Befunde sind, bring sie ein.

---

## Codex Counter-Review

<!-- Codex schreibt hier rein -->

_Pending — Plugin in User's Claude Code aktuell nicht aktiv. Wird ab dem Moment befüllt sobald `/codex:review` durchläuft._
