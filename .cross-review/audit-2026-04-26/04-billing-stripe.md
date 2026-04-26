# 04 · Billing + Stripe-Integration

**Author**: Claude · **Reviewer**: Codex · **Status**: Awaiting counter-review
**Geprüfte Datei**: [apps/api/src/billing.ts](../../apps/api/src/billing.ts) (572 LOC)
**Routen**: 4 (`/billing/plans`, `/billing/status`, `/billing/checkout`, `/billing/portal`, `/billing/webhook`)
**Externe Funktionen**: `chargeOverageMinutes`, `chargePremiumVoiceMinutes`, `getOrCreateStripeCustomer`, `syncSubscription`, `materializePendingFromSession` (re-export aus auth.ts)

Geld-Pfad. Hier muss alles besonders sauber sein.

## Was solide ist

1. **`getOrCreateStripeCustomer` mit `FOR UPDATE` lock** — schließt TOCTOU-Race wo parallele Checkouts beide einen Customer anlegen und eine UPDATE den anderen orphant macht (would still bill, never referenced).
2. **Webhook-Idempotency via `processed_stripe_events.event_id` PK** — Stripe-Retries verdoppeln nicht `minutes_used`-Resets oder Subscription-Cleanup-Cascades.
3. **`syncSubscription` Defence-in-Depth**: `metadata.orgId` + `stripe_customer_id → orgId` DB-Lookup gegengeprüft. Bei Mismatch wird der DB-Mapping vertraut + Warning geloggt — verhindert dass ein Dashboard-Operator durch Metadata-Edit Billing-State auf eine andere Org schiebt.
4. **Period-Renewal-Detection via SQL `EXTRACT(EPOCH)`** statt JS-`Date`-Math — DST-sicher, kein Drift bei Sommer-/Winterzeit-Wechsel.
5. **`tax_id_collection: true`** für B2B-EU-Reverse-Charge im Checkout.
6. **`STRIPE_AUTOMATIC_TAX` env-flag** ermöglicht graduelle Aktivierung wenn das Stripe-Tax-Dashboard fertig konfiguriert ist (Kleinunternehmer-Posture passt aktuell).
7. **Plan-Change-Flow in `/billing/checkout`**: Bei aktiver Sub wird `stripe.subscriptions.update` mit `proration_behavior: 'create_prorations'` aufgerufen — verhindert dass jeder Upgrade eine zweite parallele Subscription erzeugt → kein Double-Billing.
8. **Sofortiges `syncSubscription` nach Plan-Change** statt nur auf den asynchronen Webhook zu warten — User sieht den neuen Plan direkt nach Redirect, nicht 500ms-2s später.
9. **`invoice.payment_failed` → `past_due` + Mail an Owner** mit branded-Email.
10. **Sub-`paused`/`resumed` Branch** vorhanden — nicht nur active/cancelled.
11. **`materializePendingFromSession` als Webhook-Path UND Frontend-Finalize-Path** — beide Pfade idempotent über die `pending_registrations`-Row.

---

## Befunde

### 🔴 CRITICAL-1 · `chargeOverageMinutes` schluckt Stripe-Failures → permanenter Money-Loss

**Datei**: [billing.ts:148–159](../../apps/api/src/billing.ts#L148-L159)

```ts
try {
  await stripe.invoiceItems.create({
    customer: row.stripe_customer_id as string,
    amount: amountCents,
    currency: 'eur',
    description: `${overageMinutes} Min Überschreitung (${ratePerMinute.toFixed(2)} €/Min)`,
    metadata: { orgId, overageMinutes: String(overageMinutes), plan: row.plan as string },
  });
} catch (err) {
  process.stderr.write(`[billing] overage invoice item failed for org=${orgId}: ${(err as Error).message}\n`);
}
```

**Befund**:
- Wenn `stripe.invoiceItems.create` failed (Network-Hiccup, Stripe-API down, Customer-Id veraltet), wird der Fehler in stderr geloggt und **die Overage-Charge ist permanent verloren**.
- Es gibt keinen Persistenz-Layer (kein `pending_invoice_items`-Table), keinen Retry-Job, keine Dead-Letter-Queue.
- `reconcileMinutes` hat `minutes_used` bereits inkrementiert → DB sagt „User hat 720 Min verbraucht (200 Min over)" → Stripe sieht aber nichts → User zahlt für die Overage **nie**.

**Impact**:
- Bei aktiv-genutzten Pro/Agency-Customers können einzelne fehlende Charges schnell €5-50 pro Vorfall sein.
- Skalierung: bei 100 paying customers + 1% Stripe-API-Hiccup-Rate = stetige Money-Leakage von ~€100-500/Monat unbemerkt.
- Wenn Stripe mal eine 30-min-Outage hat, fehlen ALLE Overages aus dieser Zeit.

**Fix-Vorschlag** (zwei-stufig):

**Stufe 1 — Quick fix (sofort möglich)**: idempotente Stripe-Calls + Retry mit Backoff:
```ts
try {
  await stripe.invoiceItems.create(
    { customer: ..., amount: ..., ... },
    { idempotencyKey: `overage:${orgId}:${callId ?? Date.now()}` },
  );
} catch (err) {
  // 1 retry after 2s for transient failures (network, 5xx)
  await new Promise(r => setTimeout(r, 2000));
  try {
    await stripe.invoiceItems.create(/* same with same idempotencyKey */);
  } catch (retryErr) {
    // Persist to a follow-up queue so it's at least visible
    await pool.query(
      `INSERT INTO failed_invoice_items (org_id, call_id, amount_cents, kind, error, created_at)
       VALUES ($1, $2, $3, 'overage', $4, now())`,
      [orgId, callId, amountCents, (retryErr as Error).message],
    ).catch(() => {/* even logging failed */});
    req.log.error({ err, orgId, callId, amountCents }, 'overage invoice item failed twice — needs manual intervention');
  }
}
```

**Stufe 2 — Robust fix**: ein Cron-Job alle 5 min sieht in `failed_invoice_items` rein und retries. Ops-Dashboard zeigt offene Items.

⚠️ **Voraussetzung für die Idempotency-Variante**: `chargeOverageMinutes` braucht den `callId` als Parameter — aktuell wird der nicht durchgereicht. Caller (`reconcileMinutes` in `usage.ts`) muss den durchgeben.

---

### 🟠 HIGH-1 · `chargeOverageMinutes` + `chargePremiumVoiceMinutes` ohne `idempotencyKey`

**Dateien**: [billing.ts:149](../../apps/api/src/billing.ts#L149), [billing.ts:190](../../apps/api/src/billing.ts#L190)

**Befund**:
- Beide Calls nutzen NICHT den optionalen `idempotencyKey`-Header von Stripe.
- Wenn `reconcileMinutes` aus irgendeinem Grund mehrfach für denselben Call läuft (z. B. retell-webhook-Retry vor dem CRITICAL-1-Fix in Modul 3, oder ein internes Retry-Pattern in einem zukünftigen Refactor), würden wir den Customer **doppelt belasten** für dieselbe Overage.
- Stripe-Idempotency würde das atomar abfangen: gleicher Key + gleiche Payload = gleiche Response, kein zweiter Charge.

**Severity**: HIGH (nicht CRITICAL) weil aktueller Code-Pfad das nicht real triggert (reconcileMinutes ist im retell-webhook hinter Idempotency-Gate). ABER: defense-in-depth wichtig, eine Code-Änderung könnte das morgen brechen.

**Fix-Vorschlag**: siehe CRITICAL-1 Stufe 1.

---

### 🟠 HIGH-2 · `past_due`-Status blockt keine weiteren Calls — Money-Burn-Risiko

**Datei**: [billing.ts:546–566](../../apps/api/src/billing.ts#L546-L566) (Webhook setzt `past_due`) + [agent-config.ts](../../apps/api/src/agent-config.ts) (`/web-call`, deploy etc.)

**Befund**:
- Bei `invoice.payment_failed` wird `orgs.plan_status = 'past_due'` gesetzt.
- ABER: **kein anderer Code-Pfad prüft `plan_status`** — `/agent-config/web-call`, `/agent-config/deploy`, retell-webhook-tools laufen alle ungebremst weiter.
- Customer dessen Karte abgelaufen ist + Stripe-Dunning läuft (Stripe macht standardmäßig 4 Retry-Versuche über 21 Tage) hat **3 Wochen unbeschränkten Voice-Verbrauch** den wir niemals sehen werden.
- `tryReserveMinutes` (in usage.ts) prüft `minutes_used < minutes_limit`, NICHT `plan_status`.

**Impact**: bei 1 zahlungssäumigen Customer der täglich 50 Min telefoniert: 50 × 21 = 1.050 Minuten verbrannt × Cost-per-Minute (Retell + Twilio + ggf. ElevenLabs) ≈ €50-150 verbrannt pro Vorfall.

**Fix-Vorschlag**:
```ts
// In usage.ts tryReserveMinutes(), vor minutes_used check:
const planStatus = (await pool.query(
  'SELECT plan_status FROM orgs WHERE id = $1', [orgId]
)).rows[0]?.plan_status;
if (planStatus === 'past_due' || planStatus === 'unpaid' || planStatus === 'canceled') {
  return { allowed: false, reason: 'PLAN_PAST_DUE', /* ... */ };
}
```
Plus Frontend-Banner: „Zahlung fehlgeschlagen — Karte aktualisieren oder Calls pausieren".

---

### 🟡 MEDIUM-1 · Plan-Wechsel mid-cycle könnte `minutes_used` falsch belassen

**Datei**: [billing.ts:240–253](../../apps/api/src/billing.ts#L240-L253)

**Befund**:
- Reset-Logik triggert nur wenn `currentPeriodEnd` sich ändert.
- Bei Plan-Wechsel mid-cycle (Starter → Pro) hängt es von Stripe ab ob `current_period_end` sich verschiebt oder gleich bleibt:
  - Bei `proration_behavior: 'create_prorations'` (was wir nutzen) bleibt der Anchor meist gleich → period_end nicht geändert → `minutes_used` bleibt → User hat noch die alte Verbrauchszahl unter dem neuen (höheren) Limit. Vermutlich was wir wollen — aber bei DOWNGRADE Pro→Starter ist es problematisch, weil minutes_used > minutes_limit sein kann, und das wirkt sofort blockierend.

**Impact**: User downgraded mid-cycle, sieht plötzlich „You're over your limit" obwohl er gerade gewechselt hat → Verwirrung + Support-Ticket.

**Fix-Vorschlag**: bei subscription.updated zusätzlich prüfen:
```ts
if (newMinutesLimit < oldMinutesLimit) {
  // Downgrade: keep minutes_used capped at new limit so user isn't suddenly
  // "over" — they pay for the cycle they had, next cycle resets normally.
  await pool.query(
    `UPDATE orgs SET minutes_used = LEAST(minutes_used, $1) WHERE id = $2`,
    [newMinutesLimit, orgId],
  );
}
```

---

### 🟡 MEDIUM-2 · Free-Plan-Re-Entry Pfad fehlt

**Datei**: [billing.ts:202](../../apps/api/src/billing.ts#L202) Comment + Schema

**Befund**:
- Free-Plan = 30 Minuten one-time, kein monatlicher Reset.
- User-Pfad: Free (verbraucht 30) → Upgrade auf Starter → später Cancel → zurück auf Free.
- `subscription.deleted`-Branch ruft `syncSubscription`, das setzt `plan = 'free'` + `minutes_limit = 30`.
- ABER: `minutes_used` wird NICHT zurückgesetzt — User hat noch z. B. 350 Minuten verbraucht aus Starter-Zeit → kann auf Free-Plan **nie wieder** telefonieren.

**Impact**: Customer geht von paying → free → kann gar nichts mehr testen → kommt nicht zurück. Kleines aber sympathie-relevantes UX-Loch.

**Fix-Vorschlag**: bei subscription.deleted explizit `minutes_used = 0` (oder `LEAST(minutes_used, 30)` damit alte Free-User die schon mal 30 verbraucht haben nicht plötzlich ein Free-Refill bekommen).

---

### 🟡 MEDIUM-3 · `process.stderr.write` statt structured Pino-Log

**Dateien**: [billing.ts:157, 198](../../apps/api/src/billing.ts#L157)

**Befund**:
- Beide Charge-Funktionen loggen Failures via `process.stderr.write` mit String-Concat.
- Pino + Sentry sehen das **nicht** als strukturiertes Error-Event → keine Alarme, keine Aggregation, kein Org-Filter beim Investigieren.
- Verstößt gegen CLAUDE.md §15 Logging-Posture (PII-redaction, structured Pino).

**Fix-Vorschlag**: 
```ts
import { log } from './logger.js';
// ...
} catch (err) {
  log.error(
    { err: (err as Error).message, orgId, amountCents, kind: 'overage' },
    'stripe invoice item failed',
  );
}
```
Sentry kriegt das dann als Issue → Ops-Mail bei Spike.

---

### 🟡 MEDIUM-4 · `syncSubscription` ohne `subscription.created`-Idempotency wenn Webhook + Sofort-Sync race

**Datei**: [billing.ts:389–393](../../apps/api/src/billing.ts#L389-L393)

**Befund**:
- Plan-Change ruft `syncSubscription(updated)` synchron im HTTP-Handler.
- Webhook `customer.subscription.updated` läuft 500ms-2s später und ruft `syncSubscription` nochmal mit selben Daten.
- Beide Pfade UPDATEen `orgs` mit dem gleichen Stand → Last-Writer-Wins, idempotent durch Naturwesen der UPDATE-Statement.
- ABER: Period-Reset-Logik (Line 250) checkt `oldEndUnix !== currentPeriodEnd`. Wenn Webhook-Run nach Sofort-Sync läuft, sieht die DB schon den neuen `currentPeriodEnd` → kein weiterer Reset (richtig). Aber wenn die zwei in EXTREMEM Race wirklich exakt parallel laufen, könnte ein Race in der SELECT+UPDATE-Sequenz minutes_used auf 0 setzen wenn's nicht sollte ODER nicht auf 0 setzen wenn's sollte.

**Severity**: edge-case, theoretisch. Wahrscheinlich nicht real problematic in 99,9% der Fälle.

**Fix-Vorschlag**: SELECT...UPDATE in einer Transaction mit FOR UPDATE auf der orgs-row.

---

### 🔵 LOW-1 · `PLANS` hardcoded — Plan-Änderungen erfordern Code-Deploy

**Befund**: Preise, Limits, Stripe-Price-IDs alle in TypeScript-Constants. Marketing entscheidet „Pro-Plan 200 Min mehr" → Code-Edit + PR + Deploy.

**Fix-Vorschlag** (für später): optional `plans`-Tabelle mit fallback auf hardcoded für Dev. Für aktuellen Skala: hardcoded ist OK, dokumentieren als known limitation.

---

### 🔵 LOW-2 · `autoProvisionGermanNumber` Failure → User ohne Nummer + kein Ops-Alert

**Datei**: [billing.ts:514–516](../../apps/api/src/billing.ts#L514-L516)

**Befund**: Customer hat bezahlt, aber wenn `autoProvisionGermanNumber` fail (Twilio-pool leer, API-Fehler), kommt `req.log.warn` raus. Kein Sentry-spezifisches Tagging → leicht zu übersehen.

**Fix-Vorschlag**: `log.error` statt `warn` (Customer hat bezahlt, das ist schwerwiegend) + Tag damit Sentry alert-Regel matched.

---

### 🔵 LOW-3 · `subscription.deleted` schickt keine Bestätigungs-Mail

**Befund**: 
- `invoice.payment_failed` schickt branded „Zahlung fehlgeschlagen"-Mail.
- `subscription.deleted` schickt nichts. Customer bekommt von Stripe eine generische „Subscription cancelled"-Mail (in Englisch wenn Locale nicht passt).

**Fix-Vorschlag** (Nice-to-Have): branded „Schade dass du gehst — wir behalten deinen Account 30 Tage, einfach reaktivieren via [Link]"-Mail. Auch Win-Back-Funnel.

---

## Open Questions for Codex

**Q1**: CRITICAL-1 — siehst du eine elegantere Idempotency-Strategie als „idempotency-key + retry + persisted-failed-queue"? Z. B. Stripe-Invoice-API direkt mit Pre-allocated-Items?

**Q2**: HIGH-2 — sollte `past_due`-Block hart sein (sofort 0 Calls erlaubt) oder soft (30 Min Grace-Period damit User nicht mitten im Pitch ausgeschlossen werden)?

**Q3**: MEDIUM-1 + MEDIUM-2 — wie verhältst du dich zu mid-cycle-Down-/Upgrade-Edge-Cases? Stripe-Doku ist hier dünn — hast du Erfahrung wie andere SaaS das lösen?

**Q4**: Allgemein — siehst du etwas was ich übersprungen habe? `getOrCreateStripeCustomer` (78-122) hab ich nur überflogen. `materializePendingFromSession` ist in auth.ts (das audit Module 01 — ggf. cross-link nötig).

---

## Codex Counter-Review

<!-- Codex schreibt hier rein -->

_Pending — Plugin in User's Claude Code aktuell nicht aktiv._
