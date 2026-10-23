# Usage ledger: behavior, evidence and rollout requirements

This change is repository code and locally tested migration preparation. It is
not a production deployment or evidence that a live database has been migrated.

## Consumption and holds

- `orgs.minutes_used` records settled, actual consumption.
- `orgs.minutes_reserved` records outstanding capacity holds. Holds are not
  consumed minutes and do not generate invoices.
- Admission considers actual consumption plus outstanding holds. Free plans
  cannot reserve beyond their quota; paid plans with an overage rate have a soft
  cap. This admission check is **not a hard duration limit** for an already
  running call or an inbound provider call that has no reservation.
- Each hold has an unguessable server-created ID, an organization, an amount and
  a lifecycle state. Provider metadata carries only the ID; settlement obtains
  the amount from the database and checks organization and call identity.
- Call settlement serializes on the organization row. Actual consumption,
  release of a proven hold, a unique organization/call settlement and invoice
  intents commit together. A failed invoice-intent write rolls back all of them.
- An unreserved inbound call adds its full measured duration. It does not subtract
  an assumed five-minute reservation. A conflicting duplicate duration or
  reservation identity is rejected for review rather than silently rewritten.

Synthetic example: with 100 consumed minutes and a 100-minute quota, a five-minute
hold followed by a two-, five-, or eight-minute call creates respectively two,
five, or eight overage minutes. At a synthetic rate of EUR 0.05/minute these are
10, 25, or 40 cents. Another outstanding hold does not influence this bill.
Amounts use the plan/rate at settlement and round each invoice item to cents;
this change does not introduce proration across billing periods.

## Required upgrade sequence

1. Stop admission on **all** old application instances and drain existing calls.
   Old and new versions must not operate concurrently: the old version writes
   reservations into `minutes_used`, while the new version treats that column as
   actual consumption only.
2. Reconcile the historical usage baseline and any outstanding billing against
   authoritative call and invoice records. Existing counters may include legacy
   holds or prior reconciliation errors. Neither the migration nor startup code
   guesses or automatically rewrites this baseline. Any financial correction is
   a separate operator-reviewed action.
3. Apply the additive migration using the application's approved migration
   procedure and verify the application's service DB role can access the ledger.
   New ledger tables have RLS enabled and no public/anonymous/authenticated
   client grants. They are server-side billing data, not browser APIs.
4. Deploy the new code consistently and explicitly set the single
   `usage_ledger_state.activated_at` cutover timestamp only after the drain and
   baseline review are complete. Startup and the migration leave this value
   **NULL**. Until activation, reservations and settlement fail closed; startup
   does not silently activate new billing semantics.
5. Confirm the invoice retry worker is running and monitor outstanding holds,
   rejected legacy events, pending invoice intents and failed attempts.

Unreserved calls need a trusted start timestamp at or after the cutover. Events
from before it, or events without sufficient evidence of a new call, are rejected
for review. New reservation records can supply the start evidence. Do not reset
the activation timestamp or roll back to the old application while new holds or
settlements exist. A rollback requires another drain and an explicit accounting
review; dropping tables is not a rollback strategy.

Legacy Twilio callback URLs do not carry the new reservation identity and are
rejected by the updated terminal callback handler. This is another reason to
drain old calls and their callbacks before switching application versions.

## Invoice delivery and remaining operational limits

Overage and premium-voice invoice intents are written to the existing
`failed_invoice_items` queue within the settlement transaction, with stable
organization/call idempotency keys and `retry_count = 0`. The existing
`retryFailedInvoiceItems` worker contacts Stripe only after commit. A process
crash immediately after settlement therefore leaves a durable invoice intent.

The existing worker checks at five-minute intervals, processes up to 20 pending
items per pass and stops automatic attempts at five retries. Items beyond the
retry cap require operator review. Its existing missing-customer behavior marks
the row with `org_or_customer_gone`; that is not proof that an invoice was
created. Monitor that condition and invoice backlogs. An invoice intent or a
successful API response is not evidence of customer payment. Stripe idempotency
retention and outages remain external constraints; this is not a claim of
unlimited exactly-once delivery.

Uncertain provider creation results retain their holds. The ledger does not
automatically expire a hold or refund an ambiguous call. Failed binding or a
missing terminal event requires reconciliation against provider evidence; only
then should an operator release or settle the exact hold. Premium-voice lookup
is scoped to the call's organization and is committed through the same queue.

## Reproducible local verification

Run `pnpm --filter @vas/api test:integration` against a disposable local test
database as described in [the integration README](../apps/api/integration/README.md).
The suite executes the actual migration, checks that it starts inactive, reapplies
the startup schema for idempotence, and activates only its synthetic test schema.
It uses two real PostgreSQL connections plus a control connection that observes
row-lock contention. It checks invoice minutes and cents, transaction rollback,
cross-org/call rejection, concurrent settlement, replay, decimal values and the
upgrade guard. No provider API or production data is used.
