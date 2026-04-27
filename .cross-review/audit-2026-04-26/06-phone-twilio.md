# 06 · Phone-Numbers + Twilio + Forwarding-Verification

**Author**: Claude · **Reviewer**: Codex · **Status**: Awaiting counter-review
**Geprüfte Datei**: [apps/api/src/phone.ts](../../apps/api/src/phone.ts) (1151 LOC)
**Routen**: 11 (`GET /phone`, `POST /phone/provision`, `POST /phone/forward`, `POST /phone/twilio/import`, `DELETE /phone/:id`, `POST /phone/reassign`, `POST /phone/verify-forwarding`, `POST /phone/verify`, `POST /phone/admin/seed-pool`, `GET /phone/admin/pool`)
**Externe Funktionen**: `migratePhone`, `syncTwilioNumbersToDb`, `trimPool`, `retellImportPhoneNumber`, `retellPurchasePhoneNumber`, `autoProvisionGermanNumber`, `checkForwardingVerificationMatch` + 5 Forwarding-Verification-Helpers

Phone-Pfad ist Geld + Compliance + Trust-Boundary in einem: jede Toll-Fraud-Lücke kostet direkt Twilio-Budget, jeder Cross-Tenant-Bind leakt PII, jede stille Misskonfiguration des Forwarding-Tests verkauft Theater.

## Was solide ist

1. **`ALLOWED_PHONE_PREFIXES`-Whitelist auf `/phone/forward` + `/phone/verify-forwarding`** — DACH-Default (`+49,+43,+41`), env-overridable. Killt klassische IRSF-Vektoren (premium-rate `+1-900-*`, `+44-9-*`).
2. **SIP-Trunk-Creds Pflicht** — `retellImportPhoneNumber` wirft wenn `SIP_TRUNK_USERNAME`/`SIP_TRUNK_PASSWORD` fehlen. Verhindert dass eine fresh-Deployment den hardcoded `'phonbot_retell'`-Default nutzt → Inbound-Hijack-Vektor wäre.
3. **Production-required Env**: `SIP_TERMINATION_URI`, `TWILIO_BUNDLE_SID`, `TWILIO_ADDRESS_SID` werfen wenn `NODE_ENV=production` + Var fehlt. Fork kann nicht versehentlich auf Phonbot's Trunk routen.
4. **Pool-Claim atomisch** — `/phone/provision` mit CTE `SELECT ... FOR UPDATE SKIP LOCKED` → zwei parallele Provisions würden niemals dieselbe Pool-Nummer claimen.
5. **Cross-Tenant-Bind-Schutz auf `/phone/provision` + `/phone/reassign`** — Agent-Lookup ist `WHERE tenant_id = $1 AND org_id = $2`. Comment ruft den Hijack-Vektor explizit aus.
6. **Redis-Advisory-Locks auf `syncTwilioNumbersToDb` + `trimPool`** — verhindert N-Replica-Race wo jeder Container Twilio's REST API hämmert (10 req/s Limit). Fail-open für Single-Instance-Setup.
7. **`MAX_POOL_SIZE = 3` Pool-Trim** — verhindert dass alte unbeanspruchte Twilio-Nummern für Monate kostenpflichtig sind. Cost-Saving aktiv.
8. **Admin-Endpoints `payload.admin`-gated** — NICHT `role==='owner'` (jeder ist Owner seiner eigenen Org). Comment verweist auf den expliziten Bypass-Vektor.
9. **`/phone/verify` für `forwarding`-Method ehrlich 409** — refused mit Hinweis auf `/phone/verify-forwarding`. Vorher: pseudo-`verified=true` ohne echte Prüfung (war Theater).
10. **Forwarding-Verification echter Closed-Loop** — Verifier-Trunk + Redis-Korrelation + Caller-ID-Match (high=Verifier preserved, medium=Customer-Number-Fallback). Defense-in-Depth gegen Verifier-Inbound-Konflikt (`verifierConflict`-Check).
11. **TwiML `<Hangup/>` only** — Verifier-Outbound spielt keinem zufälligen Empfänger eine "Test successful"-Lüge vor.
12. **`/phone/forward` Rate-Limit 10/hour, `/phone/verify-forwarding` 5/hour, `/phone/verify` 10/hour** — Toll-Fraud-Fan-Out ist begrenzt.
13. **`isPhonePrefixAllowed` auf `customerNumber` in `/phone/verify-forwarding`** — Verifier kann nicht zu einer Premium-Rate-Nummer dialen.

---

## Befunde

### 🟠 HIGH-1 (revidiert von 🔴 CRITICAL nach Codex) · `/phone/twilio/import` umgeht Plan-Limits komplett · ✅ GEFIXT (Round 6)

**Codex-Severity-Korrektur**: CRITICAL → HIGH. Plan-Bypass real und code-bewiesen, der „Pool-Steal"-Pfad hängt aber an Retell-Duplikat-Verhalten und ist ohne Live-Test nicht bestätigt.

**Status**: ✅ GEFIXT — `/phone/twilio/import` macht jetzt:
1. Shared `checkPhoneProvisionPlan(orgId)`-Helper (gleiche Logik wie `/phone/provision`, liest aus `PLANS.phoneNumbersLimit`).
2. Cross-Org-Pre-Check: refused mit 409 wenn `phone_numbers.org_id` schon einer anderen Org gehört (statt silent ON CONFLICT DO NOTHING das Steal-Versuch unsichtbar macht).
3. ON CONFLICT DO UPDATE jetzt mit WHERE-Clause: nur idempotent wenn die Row dieser Org gehört oder unbeansprucht ist.

**Datei**: [phone.ts:732–778](../../apps/api/src/phone.ts#L732-L778)

```ts
app.post('/phone/twilio/import', { ...auth }, async (req, reply) => {
  const { orgId } = req.user as JwtPayload;
  // ... validates that the number is in this account's Twilio numbers ...
  // ... imports into Retell ...
  await pool.query(
    `INSERT INTO phone_numbers (org_id, number, number_pretty, provider, provider_id, agent_id, method, verified)
     VALUES ($1, $2, $2, 'twilio', $3, $4, 'provisioned', true)
     ON CONFLICT DO NOTHING`,
    [orgId, number, ...],
  );
```

**Befund**:
- `/phone/provision` checkt strikt `LIMITS[plan]` (1/3/10).
- `/phone/twilio/import` macht **keinen Plan-Limit-Check**. Ein Free-Plan-User mit eigenem Twilio-Account könnte unbegrenzt Nummern importieren — jeder davon wird als `'provisioned'` mit `verified=true` in `phone_numbers` gespeichert und in Retell importiert.
- Ja, der User braucht eigene Twilio-Creds (das ist eine kleine Hürde), aber: das Endpoint nutzt **unsere `getTwilioClient()`** mit `process.env.TWILIO_ACCOUNT_SID` — also unsere Twilio-Account-Numbers können auch importiert werden, sofern jemand sie in seiner Twilio-Console sieht. Der erste Twilio-Numbers-list-Call (`incomingPhoneNumbers.list({ phoneNumber: number, limit: 1 })`) iteriert über **unsere** Phonbot-Account-Nummern.
- Heißt: ein Free-Plan-User mit Kenntnis einer beliebigen unserer Phonbot-Telefonnummern (z. B. eine Pool-Nummer) kann sie via `/phone/twilio/import` für sich claimen → wir verlieren die Pool-Nummer + sie bekommt Calls die zu seinem Agent routen.
- Plus: kein Cross-Org-Schutz: gleiche Nummer könnte in zwei Orgs als `phone_numbers`-Row landen wenn `ON CONFLICT DO NOTHING` nicht greift (die `number_uniq` UNIQUE-Constraint fängt das, aber: silent-ignore → zweiter User bekommt `{ok:true}` ohne dass er die Nummer hat).

**Severity**: 🔴 CRITICAL — Kombination aus „kein Plan-Limit" + „kein Pool-Schutz" + „silent ON CONFLICT" gibt einem Angreifer mit einer Pool-Number-ID effektiv freien Number-Steal.

**Fix-Vorschlag**:
```ts
// 1. Plan-Limit-Check wie /phone/provision
const orgRow = await pool.query(`SELECT plan, plan_status FROM orgs WHERE id = $1`, [orgId]);
const org = orgRow.rows[0];
if (!org || org.plan === 'free' || (org.plan_status !== 'active' && org.plan_status !== 'trialing')) {
  return reply.status(403).send({ error: 'Telefonnummern-Import ist ab dem Starter-Plan verfügbar.' });
}
// 2. Pool-conflict-check VOR dem INSERT: refuse wenn die Nummer schon einer anderen Org gehört.
const existing = await pool.query(`SELECT org_id FROM phone_numbers WHERE number = $1`, [number]);
if (existing.rowCount && existing.rows[0].org_id && existing.rows[0].org_id !== orgId) {
  return reply.status(409).send({ error: 'Diese Nummer ist bereits in Verwendung.' });
}
// 3. Plan-Limit-Count wie /phone/provision (`SELECT count(*)... limits[org.plan]...`)
```

---

### 🟡 MEDIUM-X (revidiert von 🟠 HIGH nach Codex) · `/phone/forward` silent-failures bei doppelter Nummer · ⏳ NICHT GEFIXT — Endpoint im UI-Pfad nicht benutzt

**Codex-Severity-Korrektur**: HIGH → MEDIUM. Der `setupForwarding()`-Helper im Frontend ist unbenutzt, `PhoneManager` baut Carrier-Codes lokal aus `num.number`. Endpoint ist effektiv tot.

**Empfehlung von Codex**: Route entfernen oder read-only/idempotent machen — nicht silent-409-fixen. Aktion verschoben: erst Frontend-Audit (Module 09), dann Entscheid ob die Route weg kann.

**Datei**: [phone.ts:704–710](../../apps/api/src/phone.ts#L704-L710)

```ts
await pool.query(
  `INSERT INTO phone_numbers (org_id, number, number_pretty, provider, method, verified)
   VALUES ($1, $2, $2, 'forwarding', 'forwarding', false)
   ON CONFLICT (number) DO NOTHING`,
  [orgId, number],
);
return { ok: true, forwardTo, carrierCodes: { ... } };
```

**Befund**:
- `phone_numbers.number` hat eine UNIQUE-Constraint (line 57).
- Wenn ein anderer User dieselbe `number` als `forwarding` schon registriert hat (z. B. eine Telefonnummer die mehrere Personen kennen — Praxis-Sammelnummer), wird der INSERT silent skipped → kein Row für orgId, aber Endpoint returnt `{ok:true}`.
- User landet auf einem UI das "Forwarding registriert" sagt, im Dashboard taucht die Nummer aber nicht auf → User testet nochmal → frustrierender Loop.
- Schlimmer: in `/phone/verify-forwarding` läuft der Loop-Test gegen `phonbotNumberId` (unsere Phonbot-Nummer, nicht die `forwarding`-Number) — der Code macht keinen Lookup in den `forwarding`-Records. Heißt der `/phone/forward`-Schritt ist effektiv eine Dokumentations-Insert die nirgendwo ausgewertet wird... ist das Absicht?

**Severity**: 🟠 HIGH — silent-fail bei realem User-Flow + möglicherweise toter Code-Pfad.

**Fix-Vorschlag**:
```ts
const ins = await pool.query(
  `INSERT INTO phone_numbers (org_id, number, number_pretty, provider, method, verified)
   VALUES ($1, $2, $2, 'forwarding', 'forwarding', false)
   ON CONFLICT (number) DO NOTHING
   RETURNING id`,
  [orgId, number],
);
if (!ins.rowCount) {
  // Nummer schon in Verwendung. Prüfe ob's für DIESE Org schon existiert.
  const owned = await pool.query(
    `SELECT id FROM phone_numbers WHERE number = $1 AND org_id = $2`,
    [number, orgId],
  );
  if (!owned.rowCount) {
    return reply.status(409).send({ error: 'Diese Nummer ist bereits in einer anderen Organisation registriert.' });
  }
  // Sonst: idempotent — User postet zum 2. Mal mit gleicher Nummer, OK.
}
```
Plus: **klären ob `/phone/forward` heute überhaupt einen Zweck hat**. Wenn die Anzeige der Carrier-Codes der einzige Zweck ist, sollte sie die DB nicht touchen.

---

### 🟠 HIGH-2 · `autoProvisionGermanNumber` ignoriert Pool — verbrennt Twilio-Geld · ⏳ NICHT GEFIXT (größerer Refactor)

**Codex bestätigt**: HIGH passt. `bundleSid`-Compliance ist bestätigt mit aktueller Twilio-Doku ([Germany Guidelines](https://www.twilio.com/en-us/guidelines/de/regulatory) + [Bundle requirement changelog](https://www.twilio.com/en-us/changelog/regulated-number-bundle-provisioning-requirement)). Codex empfiehlt zusätzlich: Kauf-/Import-Logik in shared Helper extrahieren (heute dupliziert in `autoProvisionGermanNumber` + `/phone/provision`).

**Status**: ⏳ Geplant für Round 7 — größerer Refactor (shared `provisionAndImportNumber`-Helper benutzt von beiden Pfaden, plus Pool-First-Versuch in autoProvision).

**Datei**: [phone.ts:278–341](../../apps/api/src/phone.ts#L278-L341)

**Befund**:
- Stripe-Webhook `customer.subscription.created` → `autoProvisionGermanNumber(orgId)` (siehe billing.ts).
- Der Code macht **direkt** `client.availablePhoneNumbers('DE').local.list()` + `incomingPhoneNumbers.create()` → buy a fresh Twilio number.
- Es gibt aber den **Pool**: `MAX_POOL_SIZE = 3` Pool-Numbers liegen unbeansprucht in der DB als `org_id = NULL`. `/phone/provision` nutzt sie, `autoProvisionGermanNumber` ignoriert sie.
- Resultat: jeder neue Stripe-Customer kostet uns ~1€/Monat Twilio-Number-Cost extra, obwohl wir 3 Numbers im Pool hätten zum direkt-zuweisen.
- Plus: `autoProvisionGermanNumber` nutzt NICHT `bundleSid + addressSid` (DACH-Compliance) — `addresses.list({ isoCountry: 'DE', limit: 1 })` reicht für US/UK aber DE-Numbers brauchen oft beides für KYC. Möglicher Regulatory-Issue mit Twilio.

**Severity**: 🟠 HIGH — direkter Money-Burn + Compliance-Risk.

**Fix-Vorschlag**:
```ts
export async function autoProvisionGermanNumber(orgId: string): Promise<void> {
  if (!pool) return;
  const existing = await pool.query(`SELECT id FROM phone_numbers WHERE org_id = $1 LIMIT 1`, [orgId]);
  if (existing.rowCount && existing.rowCount > 0) return;

  // Try pool first — atomic claim like /phone/provision
  const claimed = await pool.query(
    `WITH free AS (
       SELECT id FROM phone_numbers
       WHERE org_id IS NULL AND method = 'provisioned'
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE phone_numbers SET org_id = $1
     FROM free WHERE phone_numbers.id = free.id
     RETURNING phone_numbers.number`,
    [orgId],
  );
  if (claimed.rowCount) {
    // Got a pool number — connect it to the org's deployed agent in Retell.
    // ... (extract agent-connection logic into a shared helper, used by both
    // /phone/provision and autoProvision)
    return;
  }

  // No pool — fall back to Twilio buy with bundle + address (DACH-compliant).
  // ... (existing buy logic but with bundleSid)
}
```

---

### 🟡 MEDIUM-1 · Plan-Limits hardcoded statt aus PLANS · ✅ GEFIXT (Round 6)

**Status**: ✅ GEFIXT — `PLANS` in `billing.ts` um `phoneNumbersLimit` erweitert (free=0, nummer=1, starter=1, pro=3, agency=10) — Codex's Empfehlung gefolgt: eigenes Feld statt agentsLimit-Reuse. `nummer`-Plan ist jetzt mit-abgedeckt (war vorher im hardcoded LIMITS gar nicht drin → Bug). `/phone/provision` nutzt den shared `checkPhoneProvisionPlan`-Helper.

**Datei**: [phone.ts:508–509](../../apps/api/src/phone.ts#L508-L509)

```ts
const limits: Record<string, number> = { starter: 1, pro: 3, agency: 10 };
```

**Befund**:
- Gleiche Pattern wie agent-config Module 02 MEDIUM-1 (dort gefixt). Hier nochmal hardcoded.
- `nummer`-Plan fehlt komplett (taucht in PLANS auf, aber nicht hier — Bug? Free-Plan oben gefiltert, aber `nummer` als bezahlter Plan würde hier durchfallen mit `?? 1`).
- Bei Plan-Änderungen drift mit `PLANS` in `billing.ts`.

**Fix-Vorschlag**: PLANS um `phoneNumbersLimit` erweitern (analog `agentsLimit`), hier importieren statt hardcoden. Oder Reuse von `agentsLimit` falls semantisch gleich.

---

### 🟠 HIGH-3 (revidiert von 🟡 MEDIUM nach Codex) · Retell-PATCH ohne `res.ok`-Check in 3 Endpoints · ✅ GEFIXT (Round 6)

**Codex-Severity-Korrektur**: MEDIUM → HIGH. Codex fand das Problem ist breiter als „evtl. throw" — alle 3 Endpoints (`/phone/provision`, `/phone/:id`, `/phone/reassign`) ignorierten 4xx/5xx und behandelten sie wie Erfolg.

**Status**: ✅ GEFIXT —
1. `/phone/provision`: explizites `if (!patchRes.ok)`, plus `retellOk`-Flag → bei Retell-Failure Pool-Rollback (`org_id = NULL` zurück), 503 an User.
2. `/phone/:id`: `if (!r.ok)` warn-log mit Status + Body-Snippet (Pool-Return läuft trotzdem weiter — wir wollen die Number nicht permanent gesperrt halten).
3. `/phone/reassign`: `if (!r.ok)` returnt 502 mit Status — DB wird nicht aktualisiert wenn Retell den Wechsel abgelehnt hat (vorher Drift zwischen DB-Aussage + Retell-Realität).

**Datei**: [phone.ts:622–658](../../apps/api/src/phone.ts#L622-L658)

**Befund**:
- Sequence: pool-claim → Retell-update/import (line 622–644) → DB-update mit `agent_id` (line 649–658).
- Wenn der Retell-PATCH (line 626) failed (Network-Hiccup, Retell down), wird der Fehler nur geloggt (`req.log.error`) — der Code geht weiter und macht den DB-UPDATE der `agent_id = $1` setzt.
- Resultat: DB sagt "Number is connected to agent X", Retell sagt "Number has no inbound_agent". Inbound-Calls auf diese Nummer landen ins Leere, User sieht im Dashboard "verbunden mit Agent X".
- Symptom: "Mein Agent nimmt nicht ab" obwohl alles grün aussieht im Builder.

**Severity**: 🟡 MEDIUM — funktional kaputt aber nicht teuer/leakable.

**Fix-Vorschlag**:
- Bei Retell-Fail: Pool-Number wieder zurückgeben (`UPDATE SET org_id = NULL WHERE id = $poolNumberId`) + 503 zurückgeben.
- ODER: `phone_numbers` mit `last_retell_error TEXT` + Frontend-Banner.

---

### 🟡 MEDIUM-3 · Polling-Loop hält Fastify-Worker 35s blockiert

**Datei**: [phone.ts:1004–1012](../../apps/api/src/phone.ts#L1004-L1012)

```ts
const POLL_INTERVAL_MS = 1500;
const MAX_WAIT_MS = 35_000;
const deadline = Date.now() + MAX_WAIT_MS;
let result: ForwardingVerificationResult | null = null;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  result = await getForwardingVerificationResult(token);
  if (result?.ok) break;
}
```

**Befund**:
- Pro `/phone/verify-forwarding`-Call: ein Worker bleibt bis zu 35s in einem Polling-Loop. Mit Rate-Limit 5/hour pro User klein, aber: Fastify hat per default eine begrenzte Anzahl gleichzeitiger Connections (Node Event-Loop). Bei z. B. 50 parallelen Verifications hängen alle Worker.
- Plus: Twilio-Outbound-Call (paid) wird VOR dem Polling-Loop gestartet — wenn der Customer den Call ablehnt (busy-tone, hangup), polled der Loop trotzdem volle 35s.

**Severity**: 🟡 MEDIUM — DoS-Vektor + Cost-Verschwendung.

**Fix-Vorschlag**:
- **Variante A (server-sent-events)**: Frontend bekommt SSE-Stream, Match in `checkForwardingVerificationMatch` schreibt in einen pubsub-Channel, Endpoint terminiert sofort beim Match.
- **Variante B (Twilio-Status-Webhook)**: bei `client.calls.create()` `statusCallback` setzen, in einem separaten Endpoint (`/phone/verify-forwarding/twilio-status`) bei `failed`/`busy`/`no-answer`/`canceled` den pending-Record killen, Polling sieht Result-Key=null + verifier-call=ended → early-exit.
- **Variante C (mid-poll Twilio-Status-Check)**: alle 5 Polls ein `client.calls(twilioCallSid).fetch()` → wenn `status in ('failed','busy','no-answer','canceled')` ohne match, früh raus.

---

### 🟡 MEDIUM-4 · Verifier-Outbound-Call wird globalen Cost nicht trackbar

**Datei**: [phone.ts:986–991](../../apps/api/src/phone.ts#L986-L991)

**Befund**:
- Per-User-Rate-Limit 5/hour. Mit 100 zahlenden Customers = 500 Verifier-Calls/Stunde worst case = jede Call ~1ct = ~5€/Stunde Worst-Case-Burn.
- Kein globaler Cap. Wenn ein User-Account kompromittiert ist und 5/hour macht (in der Lock-Wahrnehmung normal), aber 50 Accounts machen das gleichzeitig → Twilio-Bill explodiert ohne Alarm.

**Fix-Vorschlag**: Redis-keyed globaler Counter `phone:verify:global:hourly` mit hartem Cap (z. B. 200/hour) → 503 wenn überschritten.

---

### 🟡 MEDIUM-5 · `process.stderr.write` × 13 statt structured Pino · ✅ GEFIXT (Round 6)

**Status**: ✅ GEFIXT — alle 13 Stellen in `phone.ts` auf `log.info`/`log.warn`/`log.error` mit strukturierten Feldern (`{ orgId, number, err }`) migriert. Sentry sieht das jetzt als strukturierte Events.

**Datei**: [phone.ts:110, 137, 143, 163, 194, 196, 201, 204, 302, 308, 317, 327, 340](../../apps/api/src/phone.ts#L110)

**Befund**:
- 13 Stellen mit `process.stderr.write` / `process.stdout.write` statt `req.log.warn/error` oder modul-level `log`-Import (siehe billing.ts/calendar.ts Round-Sweep).
- Pino + Sentry sehen das nicht als strukturierte Events → keine Aggregation, keine Alarme bei Pool-trim-Failures.

**Fix-Vorschlag**: gleiche Migration wie billing/calendar — `import { log } from './logger.js'` + alle stderr-writes auf `log.warn/error/info` mit strukturierten Feldern.

---

### 🔵 LOW-1 · `syncTwilioNumbersToDb`-Lock fail-open bei Redis-down

**Datei**: [phone.ts:107–113](../../apps/api/src/phone.ts#L107-L113)

**Befund**:
- Wenn Redis beim Container-Cold-Start nicht ready ist, wird die Lock-Akquise nicht versucht (`if (redis?.isOpen)` ist false) → ALLE N Container laufen `syncTwilioNumbersToDb` parallel beim Boot.
- Twilio-API hat 10 req/s Limit → bei 5 Replicas + 100 Numbers = 500 GET-Calls in <2s → Rate-Limit-Hit → einige Container failen den Sync still.
- Plus: jeder Container ruft `trimPool` parallel → der innere `trim-lock` fängt das eigentlich, aber das ist ja auch Redis-abhängig...

**Fix-Vorschlag**: bei `!redis?.isOpen` warten 5s, retry. Wenn Redis nach 30s noch down → log.error + skip Sync (single-instance-prod-startup ist OK ohne Sync).

---

### 🔵 LOW-2 · `verifyConflict`-Check nur gegen `provisioned` — `forwarding`-Records ignoriert

**Datei**: [phone.ts:936–940](../../apps/api/src/phone.ts#L936-L940)

```ts
const verifierConflict = await pool.query(
  `SELECT 1 FROM phone_numbers WHERE number = $1 AND method = 'provisioned' LIMIT 1`,
  [verifierNumber],
);
```

**Befund**:
- Defense-in-Depth: Verifier-Number darf keine Phonbot-Inbound-Number sein.
- Aber: wenn der Verifier-Number versehentlich als `forwarding`-Method registriert ist (über `/phone/forward`), greift der Check nicht → Loop könnte short-circuiten wenn der `forwarding`-Pfad jemals zu Retell führt.
- Aktuell führt `forwarding`-Method nirgendwo zu Retell, also harmlos. Aber Defense-in-Depth verlangt den Check.

**Fix-Vorschlag**: Check ohne `method`-Filter. Eine Verifier-Nummer darf in `phone_numbers` GAR NICHT auftauchen.

---

### 🔵 LOW-3 · `customer_number`-Caller-ID-Match-Fenster (medium-confidence) hat kein Anti-Replay

**Datei**: [phone.ts:445–449](../../apps/api/src/phone.ts#L445-L449)

**Befund**:
- `medium`-confidence-Match: Customer ruft selbst Phonbot-Inbound an mit ihrem eigenen Caller-ID innerhalb des 90s-Pending-Windows → fälschlich als „verified" geloggt.
- Praktisch sehr selten (warum würde ein Customer im selben 90s-Fenster legitim anrufen?). Aber: bei einem Demo-Setup wo der Customer testet und gleichzeitig anruft, möglich.

**Fix-Vorschlag**: dokumentieren als known limitation + optional `medium`-confidence-Match nur akzeptieren wenn die Call-Direction eindeutig forwarded ist (z. B. Twilio-Diversion-Header `Diversion`/`History-Info` prüfen — funktioniert bei Carriers die's setzen).

---

### 💡 NICE · Pre-2026-04 `forwarding_type`-Records bleiben verified

**Datei**: [phone.ts:77–81](../../apps/api/src/phone.ts#L77-L81)

Comment sagt: pre-2026-04 rows mit `'busy'`/`'unknown'`/`'not_forwarded'` werden vom Frontend als unverified behandelt. Aber: in der DB ist `verified=true` aus dem alten Theater-Pfad. Frontend-Logik müsste das pro Render checken.

**Fix-Vorschlag**: einmalige Migration `UPDATE phone_numbers SET verified = false WHERE method = 'forwarding' AND forwarding_type NOT IN ('always', 'no_answer')` — dann ist die DB autoritativ + Frontend kann die Type-Guard rauslöschen.

---

## Open Questions for Codex

**Q1**: CRITICAL-1 — kannst du `/phone/twilio/import` reproduzieren? Konkret: `curl POST /phone/twilio/import` mit valid JWT eines Free-Plan-Users + `number = <eine bekannte Phonbot-Pool-Nummer aus /phone/admin/pool>`. Wenn die Pool-Number umgesetzt wird → bestätigt 🔴.

**Q2**: HIGH-1 (`/phone/forward` silent-fail) — bist du der Meinung dass `/phone/forward` heute noch einen funktionalen Zweck hat? Mein Read: das ist UI-Helper für Carrier-Code-Anzeige. Wenn ja, darf es die DB einfach gar nicht touchen — ist mein Vorschlag oben (refuse-409 bei foreign-org-number) zu konservativ?

**Q3**: HIGH-2 (autoProvision-no-pool) — siehst du bei `bundleSid` einen DACH-Compliance-Verstoß für die Auto-provision-Pfad? Twilio-Doku ist hier dünn; einige DE-Numbers brauchen Bundle für KYC, andere nicht.

**Q4**: MEDIUM-3 (Polling-DoS) — würdest du SSE oder Twilio-Status-Webhook bevorzugen? SSE ist einfacher, Webhook ist robuster aber braucht eine zusätzliche Route + Webhook-URL-Konfiguration in Twilio.

**Q5**: Allgemein — ich habe `migratePhone` (line 37–87), `trimPool` (line 156–208) und die Admin-Endpoints (line 1095–1150) nur überflogen. Wenn da Race-Conditions oder Cross-Tenant-Vektoren sind, bring sie ein.

---

## Codex Counter-Review

<!-- Codex schreibt hier rein -->

**Verdict**: `needs-changes`

**Vier Achsen**
- **Sinnhaftigkeit**: Der Kernpfad ist brauchbar, aber `/phone/forward` und `/phone/twilio/import` haben aktuell keine saubere Produktgrenze.
- **Funktionalität**: Mehrere Erfolgsantworten markieren Nummern als „aktiv“, obwohl Retell/Twilio den Zustand nicht zuverlässig tragen.
- **Sauberkeit**: Pool-, Import-, Verify- und Migrationslogik driften auseinander; einige Pfade sind faktisch tot oder halb verdrahtet.
- **Sicherheit**: Kein bestätigter direkter Tenant-Escape im Hauptpfad, aber Plan-Grenzen, Pool-Lifecycle und Admin-Parität sind an mehreren Stellen zu weich.

### Befund-Check

- **CRITICAL-1**: **Teilweise korrekt.** Der Plan-/Status-/Count-Bypass ist real, weil `/phone/twilio/import` keine Checks aus `/phone/provision` übernimmt (`apps/api/src/phone.ts:492-512` vs. `apps/api/src/phone.ts:732-778`). Der behauptete „Pool-Steal“ ist aus Code allein **nicht bewiesen**: die DB-Zeile bleibt wegen `ON CONFLICT DO NOTHING` unverändert (`apps/api/src/phone.ts:766-770`); ob ein zweiter Retell-Import dieselbe Nummer umbindet, ist ohne Live-Test/Retell-Doku offen. **Severity eher HIGH als CRITICAL**: Sinnhaftigkeit/Funktionalität/Sauberkeit klar betroffen; für **Sicherheit** reicht der Code-Beleg heute nur bis „Entitlement-Bypass“, nicht bis bestätigter Number-Hijack. Der Fix-Vorschlag ist **nur teilweise tragbar**: Plan-Check + expliziter 409 sind Pflicht, zusätzlich braucht es eine Produktentscheidung, weil der Endpoint immer den Plattform-Twilio-Account prüft (`getTwilioClient()`, `apps/api/src/phone.ts:15-20`) und nicht „Kundentwilio“.
- **HIGH-1**: **Formal korrekt, Severity aber zu hoch.** Das silent `ON CONFLICT DO NOTHING` existiert (`apps/api/src/phone.ts:704-709`), aber der First-Party-UI-Flow nutzt den Endpoint heute nicht: `setupForwarding()` ist unbenutzt (`apps/web/src/lib/api.ts:404-408`), `PhoneManager` baut die Carrier-Codes lokal aus `num.number` und ruft nur `/phone/verify-forwarding` (`apps/web/src/ui/PhoneManager.tsx:218-220`, `apps/web/src/ui/PhoneManager.tsx:257-259`). **Severity eher MEDIUM**: Funktionalität/Sauberkeit ja, aktuell aber kein sichtbarer Produktpfad. Der bessere Fix ist: Route entfernen oder read-only/idempotent machen; ein 409-Fix ist nur sinnvoll, wenn der Endpoint bewusst erhalten bleibt.
- **HIGH-2**: **Ja.** Cost-burn ist eindeutig: `autoProvisionGermanNumber()` kauft immer frisch (`apps/api/src/phone.ts:295-314`) statt erst den Pool wie `/phone/provision` zu claimen (`apps/api/src/phone.ts:546-559`). Der Compliance-Teil ist ebenfalls tragfähig: der manuelle Pfad nutzt `bundleSid` + `addressSid` (`apps/api/src/phone.ts:577-604`), der Auto-Pfad nur `addressSid` (`apps/api/src/phone.ts:299-314`). Stand **2026-04-27** sagen Twilio-Doku und Richtlinien, dass regulierte Nummern ein Bundle brauchen und Germany local/business reguliert ist: [Germany Guidelines](https://www.twilio.com/en-us/guidelines/de/regulatory), [IncomingPhoneNumber resource](https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource), [Bundle requirement changelog](https://www.twilio.com/en-us/changelog/regulated-number-bundle-provisioning-requirement). **HIGH passt**. Der Fix-Vorschlag ist tragbar; zusätzlich die Kauf-/Import-Logik in einen Shared-Helper ziehen.
- **MEDIUM-1**: **Ja.** Hardcoded Limits driften gegen `PLANS` (`apps/api/src/phone.ts:508-509`, `apps/api/src/billing.ts:23-74`), und `nummer` fehlt komplett. Nebenbei ist der Gate davor aktuell auf `starter/pro/agency` verengt (`apps/api/src/phone.ts:498-499`). **MEDIUM passt** über Sinnhaftigkeit/Funktionalität/Sauberkeit; Sicherheit hier unauffällig. Der Fix-Vorschlag ist tragbar, aber bitte eigenes `phoneNumbersLimit` statt Reuse von `agentsLimit`.
- **MEDIUM-2**: **Ja, aber unterbewertet.** Das Problem ist breiter als „PATCH wirft evtl.“: die Retell-PATCH-Pfade prüfen nicht einmal `res.ok`, also wird jeder 4xx/5xx wie Erfolg behandelt in `/phone/provision`, `/phone/:id` und `/phone/reassign` (`apps/api/src/phone.ts:626-631`, `apps/api/src/phone.ts:802-807`, `apps/api/src/phone.ts:861-868`). **Severity eher HIGH**: Funktionalität klar kaputt, Sauberkeit ebenfalls, Sicherheit indirekt über falsches Routing. Der Fix-Vorschlag ist nur tragbar, wenn er `res.ok` hart prüft und Rollback/Fehlerstatus einführt.
- **MEDIUM-3**: **Teilweise.** Der 35s-Pfad hält eine offene HTTP-Anfrage, blockiert aber keinen dedizierten Fastify-Worker-Thread; das ist Node-Timer-I/O (`apps/api/src/phone.ts:1004-1012`), nicht Thread-Blocking. Das echte Risiko sind offene Verbindungen, Proxy-Timeouts und unnötig lang laufende Verifier-Calls. **Severity eher LOW-MEDIUM**. Von den Fix-Optionen ist **Twilio-Status-Webhook** die bessere Richtung; SSE allein löst den Carrier-Failure-Fall nicht.
- **MEDIUM-4**: **Ja.** Globaler Cost-Cap fehlt; pro-User-Rate-Limits allein begrenzen keine Multi-Account-Welle (`apps/api/src/phone.ts:903-906`, `apps/api/src/phone.ts:986-991`). **MEDIUM ist vertretbar**: Sinnhaftigkeit/Funktionalität/Sicherheit ja, Sauberkeit neutral. Fix-Vorschlag tragbar.
- **MEDIUM-5**: **Ja.** `process.stdout/stderr.write` sitzt an vielen Stellen im Modul (`apps/api/src/phone.ts:107-143`, `apps/api/src/phone.ts:160-206`, `apps/api/src/phone.ts:301-340`) und umgeht Pino/Sentry. **Severity eher LOW-MEDIUM**. Fix-Vorschlag tragbar; zusätzlich die stillen `catch {}` / `.catch(() => null)`-Stellen angleichen.
- **LOW-1**: **Ja.** Redis-down => Lock fail-open (`apps/api/src/phone.ts:107-113`, `apps/api/src/phone.ts:160-166`). **LOW passt**. Fix-Vorschlag tragbar.
- **LOW-2**: **Ja.** `verifierConflict` prüft nur `method = 'provisioned'` (`apps/api/src/phone.ts:936-940`). Weil `forwarding` heute nicht routet, ist die praktische Wirkung klein; als Defense-in-Depth-Fix aber sauber. **LOW passt**. Fix-Vorschlag tragbar.
- **LOW-3**: **Ja, als Hypothese.** Der `medium`-Pfad matcht allein auf `customer_number` innerhalb des Pending-Fensters (`apps/api/src/phone.ts:447-464`). Ich kann ohne Carrier-/Retell-Signal nicht härter bewerten. **LOW passt**. Der Vorschlag „document + optional carrier header“ ist tragbar.
- **NICE**: **Ja.** Die DB ist hier nicht sauber autoritativ (`apps/api/src/phone.ts:77-83`). Gute Cleanup-Idee, kein Muss.

### Open Questions

1. **Q1 — CRITICAL-1 reproduzierbar via curl?** Den Live-curl habe ich in dieser Session **nicht** gefahren; dafür fehlen mir hier laufender Stack + gültiger User-JWT. Aus Code-Sicht ist der **Free-Plan-Bypass sicher reproduzierbar**, weil `/phone/twilio/import` keinerlei Planprüfung hat (`apps/api/src/phone.ts:732-778`). Der **vollständige Pool-Steal** ist dagegen mit Code allein nicht bestätigt, weil die DB-Ownership nicht wechselt und das Ergebnis an Retell-Duplikatverhalten hängt.
2. **Q2 — hat `/phone/forward` heute funktionalen Zweck?** Im aktuellen First-Party-Produkt praktisch **nein**. Der Endpoint ist API-seitig vorhanden, aber die UI nutzt ihn nicht; sie generiert die Codes lokal und springt direkt in den Loop-Test (`apps/web/src/ui/PhoneManager.tsx:218-220`, `apps/web/src/ui/PhoneManager.tsx:257-259`). Meine Tendenz: **DB-Touch raus oder Endpoint entfernen**.
3. **Q3 — DACH-Compliance bei `autoProvision` ohne Bundle?** **Nicht belastbar genug für Prod.** Stand **2026-04-27** sagen Twilio-Richtlinien für Germany local/business „reguliert“, und das aktuelle IncomingPhoneNumber-API dokumentiert `bundleSid` explizit für solche Regionen. Ich würde `addressSid`-only hier als **Compliance-/Provisioning-Risiko** werten, nicht als akzeptable Abkürzung.
4. **Q4 — SSE oder Twilio-Status-Webhook für den Polling-Loop?** **Twilio-Status-Webhook bevorzugt.** SSE hält weiter eine Client-Verbindung offen und hilft nicht bei `busy`/`no-answer`/`failed`. Der Status-Webhook liefert genau die fehlende Abbruchinformation. Wenn man UX-seitig pushen will, dann `POST` startet Test, Webhook schreibt Status in Redis, Frontend pollt kurz oder hängt sich optional per SSE daran.
5. **Q5 — Übersehenes?** Ja. Die größten Zusatzpunkte sind: `migratePhone()` ist nach aktuellem Codepfad gar nicht verdrahtet; Pool-Nummern ohne `provider_id` werden später wie „schon in Retell“ behandelt; Pool-Reuse lässt `customer_number`/`forwarding_type` stehen; `GET /phone` liefert diese Felder nicht zurück und sabotiert damit die vorhandene Loop-Warnlogik im Frontend; externe Twilio-Number-Drops werden nie aus der DB herausreconciled.

### Zusatzbefunde

- **HIGH-A · `migratePhone()` ist aktuell nicht verdrahtet.** Ich finde repo-weit keinen Aufruf außer Import + Kommentar (`apps/api/src/index.ts:22`, `apps/api/src/index.ts:315`, `apps/api/src/phone.ts:37`). Damit sind frische Umgebungen auf bestehende Alt-DB angewiesen. Und selbst wenn man es naiv beim Boot aufruft, läuft `syncTwilioNumbersToDb()` darin vor `connectRedis()` und damit ohne funktionierenden Redis-Lock (`apps/api/src/index.ts:184-189`, `apps/api/src/phone.ts:85-86`, `apps/api/src/phone.ts:107-113`). **Fixskizze:** DDL von Sync trennen; Schema unter `db.migrate()`/`pg_advisory_lock`, Initial-Sync erst nach Redis-Connect.
- **HIGH-B · Pool-Rows ohne `provider_id` werden falsch als „schon importiert“ behandelt.** `syncTwilioNumbersToDb()` legt Pool-Nummern mit `provider_id = NULL` an (`apps/api/src/phone.ts:128-132`), `/phone/admin/seed-pool` erlaubt dasselbe (`apps/api/src/phone.ts:1100-1125`). `/phone/provision` claimt diese Rows, geht bei `poolNumberId` aber immer in den PATCH-Pfad statt zu importieren (`apps/api/src/phone.ts:566-571`, `apps/api/src/phone.ts:623-650`). Ergebnis: Nummer kann im Dashboard „aktiv“ sein, ohne je sauber in Retell zu existieren. **Fixskizze:** `if (poolNumberId && !retellPhoneNumberId) { const r = await retellImportPhoneNumber(...); retellPhoneNumberId = ... }`.
- **MEDIUM-A · Pool-Reuse lässt org-fremde Forwarding-Metadaten stehen.** Beim Delete-to-pool werden nur `org_id` und `agent_id` geleert (`apps/api/src/phone.ts:809-812`); beim Re-Claim ebenfalls nur Org/Agent/Provider gesetzt (`apps/api/src/phone.ts:649-652`). `customer_number` und `forwarding_type` bleiben also an der Nummer hängen. Das ist Stale-PII und falscher Zustand für den nächsten Org-Claim. **Fixskizze:** `UPDATE phone_numbers SET org_id = NULL, agent_id = NULL, customer_number = NULL, forwarding_type = NULL WHERE id = $1`.
- **MEDIUM-B · `GET /phone` sabotiert die vorhandene Loop-Warnung im Frontend.** Der Backend-List-Endpoint liefert nur `id, number, number_pretty, provider, method, verified, agent_id` (`apps/api/src/phone.ts:477-480`). `CapabilitiesTab` erwartet aber `customer_number` + `forwarding_type`, um Loops bei Weiterleitung auf die eigene Geschäftsnummer zu warnen (`apps/web/src/ui/agent-builder/CapabilitiesTab.tsx:25-50`, `apps/web/src/ui/agent-builder/CapabilitiesTab.tsx:117-150`). Damit ist die Schutzlogik heute faktisch blind. **Fixskizze:** Felder im Select ergänzen oder die tote Warnlogik entfernen.
- **MEDIUM-C · Extern gedroppte Twilio-Nummern bleiben als tote DB-Rows erhalten.** `syncTwilioNumbersToDb()` ist rein additiv und trimmt nur Überschuss im Pool (`apps/api/src/phone.ts:117-141`, `apps/api/src/phone.ts:168-205`). Wenn eine Nummer in Twilio außerhalb des Systems gelöscht wird, bleibt sie in `phone_numbers` und kann später wieder geclaimt werden. **Fixskizze:** Sync muss DB-vs-Twilio diffen; fehlende Pool-Rows löschen, fehlende zugewiesene Rows mindestens markieren/alerten.

---

## Round-6 Synthesis · Claude × Codex (2026-04-26)

### Codex-Befund-Verifikation durch Claude

- **HIGH-A (`migratePhone()` nicht verdrahtet)**: ❌ Codex falsch. `migratePhone` IST verdrahtet — `index.ts:216` ruft sie in einer Schleife `[migratePhone, migrateCalendar, migrateOutbound]` auf. Boot-Order ist korrekt: `connectRedis()` (line 189) läuft VOR der Migration-Schleife (line 216), Redis-Lock funktioniert. Codex hat den Aufruf an line 216 übersehen.
- **HIGH-B (Pool-Rows ohne `provider_id`)**: ✅ bestätigt + ✅ GEFIXT. `/phone/provision` bei `poolNumberId && !retellPhoneNumberId` geht jetzt in den Import-Pfad statt PATCH.
- **MEDIUM-A (Pool-Reuse vergisst customer_number/forwarding_type — DSGVO!)**: ✅ bestätigt + ✅ GEFIXT. Beide Pfade — `DELETE /phone/:id` (Pool-Return) und `/phone/provision` (Pool-Reclaim) — clearen jetzt explizit `customer_number = NULL, forwarding_type = NULL, verified = false/true`. Stale-PII-Leak zwischen Orgs geschlossen.
- **MEDIUM-B (`GET /phone` fehlt Felder)**: ✅ bestätigt + ✅ GEFIXT. SELECT erweitert um `customer_number, forwarding_type`. CapabilitiesTab Loop-Warnung ist nicht mehr blind.
- **MEDIUM-C (Tote DB-Rows nach Twilio-extern-Drop)**: ⏳ NICHT GEFIXT — größerer Sync-Refactor (DB-vs-Twilio-Diff, Pool-Rows löschen, zugewiesene markieren/alerten). Codex's Fixskizze sinnvoll, in Round 7 mit `autoProvisionGermanNumber`-Refactor mit-erledigen.

### Severity-Korrekturen

| Original (Claude) | Korrigiert (nach Codex) | Begründung |
|---|---|---|
| 🔴 CRITICAL-1 (`/phone/twilio/import`) | 🟠 HIGH-1 | Plan-Bypass code-bewiesen, Pool-Steal nicht ohne Live-Test bestätigt |
| 🟠 HIGH-1 (`/phone/forward` silent) | 🟡 MEDIUM-X | Endpoint im UI-Pfad nicht benutzt (toter Code) |
| 🟡 MEDIUM-2 (Retell-PATCH partial-fail) | 🟠 HIGH-3 | Problem breiter als „evtl. throw" — alle 3 Endpoints ignorieren `res.ok` |
| 🟡 MEDIUM-3 (Polling-DoS) | 🔵 LOW-MEDIUM | Node ist Single-Threaded I/O, nicht Worker-Thread-Blocking |

### Fix-Status nach Round 6

| Befund | Status |
|---|---|
| 🟠 HIGH-1 (twilio/import Plan-Bypass) | ✅ GEFIXT (commit Round 6) |
| 🟡 MEDIUM-X (`/phone/forward` toter Code) | ⏳ Verschoben (Module 09 Frontend-Audit) |
| 🟠 HIGH-2 (autoProvision ohne Pool + Bundle) | ⏳ Verschoben (Round 7 Refactor) |
| 🟠 HIGH-3 (Retell-PATCH res.ok-Check) | ✅ GEFIXT (commit Round 6) |
| 🟠 HIGH-B (Pool-Rows ohne provider_id) | ✅ GEFIXT (commit Round 6) |
| 🟡 MEDIUM-1 (LIMITS-Hardcode) | ✅ GEFIXT (commit Round 6, PLANS.phoneNumbersLimit) |
| 🟡 MEDIUM-A (DSGVO Pool-PII) | ✅ GEFIXT (commit Round 6) |
| 🟡 MEDIUM-B (GET /phone Felder) | ✅ GEFIXT (commit Round 6) |
| 🟡 MEDIUM-4 (Globaler Cost-Cap) | ⏳ Offen |
| 🟡 MEDIUM-5 (stderr → log) | ✅ GEFIXT (commit Round 6) |
| 🔵 LOW-MEDIUM-3 (Polling-DoS) | ⏳ Offen (Twilio-Status-Webhook Refactor) |
| 🔵 LOW-1/2/3 + 🟡 MEDIUM-C + 💡 NICE | ⏳ Offen |

### Antworten auf Open Questions

- **Q1** (curl-Repro für `/phone/twilio/import`): aus Code-Review klar bewiesen, Live-Test bleibt für Round 7 oder Smoke-Test offen.
- **Q2** (`/phone/forward` Zweck): Codex hat verifiziert dass UI ihn nicht nutzt — Empfehlung Endpoint entfernen, in Module 09 Frontend-Audit final entscheiden.
- **Q3** (DACH-Compliance Bundle): Codex bestätigt mit Twilio-Doku-Links — `addressSid`-only ist Compliance-Risiko, nicht akzeptable Abkürzung.
- **Q4** (SSE vs Twilio-Status-Webhook): Codex bevorzugt Twilio-Status-Webhook (echte Abbruch-Information bei busy/no-answer/failed; SSE allein hilft nicht).
- **Q5** (Übersehenes): Codex hat 5 Zusatzbefunde gefunden, davon 4 bestätigt + 3 gefixt + 1 verschoben + 1 falsch (HIGH-A migratePhone).
