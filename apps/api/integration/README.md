# Usage reservation integration tests

`pnpm --filter @vas/api test:integration` executes the SQL in `usage.ts` against
real PostgreSQL. CI provisions a disposable PostgreSQL 16 service for this step.
The suite fails if its test database is not explicitly configured; it never
silently skips the database checks.

For a local run, provision a disposable PostgreSQL instance on `127.0.0.1`, with
a database and role both named `phonbot_usage_test`. Set:

- `USAGE_TEST_DATABASE=phonbot_usage_test` (explicit opt-in)
- `USAGE_TEST_DATABASE_PASSWORD` to that local test role's password
- `USAGE_TEST_DATABASE_PORT` if it is not `5432`

The harness does not load `.env`, `DATABASE_URL`, the application's DB module, or
deployment settings. It fixes the host, database and role, creates a unique
`usage_test_<uuid>` schema containing synthetic fixtures, and restricts every
connection's search path to that schema. Cleanup drops only this generated schema.
Do not run it against a database containing real application data.

The actual additive migration executes inside this schema, starts inactive, and
is reapplied through the startup schema for an idempotence check. Only synthetic
fixtures are explicitly activated. See the [required rollout sequence](../../../docs/usage-ledger-rollout.md).

Three connections are used: two independent PostgreSQL backends execute usage
transactions, while a control connection observes the second backend waiting on
the row lock. The suite checks free-plan admission, rollback, decimal consumption,
invoice minutes and cents, paid-plan overage, simultaneous settlements, cross-org
and call binding, replay, failed invoice persistence and inactive/legacy guards.
Invoice assertions inspect committed outbox items; no Stripe API is contacted.
These checks do not prove production capacity, provider behavior, invoice delivery,
customer payment, or end-to-end call performance.
