# Deployment Guide

The repository provides a Docker Compose build. A GitHub push and a passing CI
run publish and verify source code; the [CI workflow](../.github/workflows/ci.yml)
does not deploy the application. Record the source commit, built image digest,
target environment and rollback image for each release. Confirm how the target
receives images or source before choosing a deployment procedure.

## Before starting or upgrading

The usage-ledger release requires the controlled sequence in
[Usage ledger rollout](usage-ledger-rollout.md): stop admission on all old
instances, drain calls and callbacks, review the historical usage baseline,
apply the additive schema, verify the service database role, deploy consistently
and explicitly activate the cutover. Old and new versions must not bill in
parallel. Migration and startup leave the ledger inactive; reservations and
settlement fail closed until activation. A code rollback after new ledger
activity also requires a drain and accounting review.

Before any rollout, confirm the actual database target from protected runtime
configuration, a usable backup and restore procedure, available build resources,
and the rollback plan. Do not infer the active database from a provider dashboard
or a sample connection string. Keep environment-specific access details and
release evidence in the operator's private records.

## Compose services

The root [docker-compose.yml](../docker-compose.yml) and
[Caddyfile](../Caddyfile) define the application stack. `infra/docker` is a legacy
local/development stack and does not carry the same routing and security rules.

| Service | Internal port | Purpose |
|---------|---------------|---------|
| api | 3001 | Fastify API |
| web | 80 | React SPA served by nginx |
| db | 5432 | PostgreSQL 16 with a persistent named volume |
| redis | 6379 | Redis 7 with persistent storage |
| caddy | 80, 443 | Public reverse proxy and TLS termination |

Only Caddy publishes host ports in the root configuration. PostgreSQL, Redis,
API and Web use the internal Docker network. The API's `DATABASE_URL` determines
which database it actually uses; the presence of the `db` service alone does not
prove that a running API connects to it. Back up PostgreSQL data separately from
application images and verify restore procedures before upgrades.

## Configuration

Use [apps/api/.env.example](../apps/api/.env.example) as a variable reference,
not as a ready-to-run production configuration. Its sample database and Redis
URLs must be adapted to the intended topology. Store actual values outside Git.

- The API loads `apps/api/.env` through Compose's `env_file`.
- Compose obtains `POSTGRES_PASSWORD` separately through its interpolation
  environment, such as a protected root `.env`. Configure the API's database
  connection consistently. Changing this variable does not rotate the password
  inside an already initialized PostgreSQL volume.
- Set `REDIS_URL` for the selected Redis service; `localhost` inside the API
  container refers to that container.
- Configure the frontend URL, webhook base URL, DNS and reverse proxy together.
  The root Compose file currently does not pass `DOMAIN` into the Caddy
  container. Setting a host-shell `DOMAIN` variable alone therefore does not
  configure Caddy; explicitly supply the container setting or adapt the
  Caddyfile and validate the resulting routing.
- Check [env.ts](../apps/api/src/env.ts) and the relevant integration startup
  checks for production requirements. They include the database, JWT,
  encryption, Retell, OpenAI, Twilio, Stripe and webhook-signing configuration.
  OpenAI is required by the current production validator even though Retell
  remains the voice runtime. OAuth and other enabled features have additional
  requirements.
- `ENCRYPTION_KEY` must be 64 hexadecimal characters. Plan changes to signing
  and encryption keys using [Secrets rotation](secrets-rotation.md).

## What the deployment script does

[scripts/deploy.sh](../scripts/deploy.sh) assumes a Git checkout with the expected
remote and Docker Compose available. It pulls `origin master`, builds locally,
then starts or recreates services. It is not an image-transfer procedure for a
host without a checkout, and it does not pin a release commit for the operator.
Resolve and record the intended revision before using a release procedure.

The script also has these effects:

| Setting | Behavior |
|---------|----------|
| `RUN_SUPABASE_MIGRATIONS=1` | Runs the migration check and Supabase CLI database push; requires `MIGRATION_DATABASE_URL`. Confirm that URL's target independently. |
| `BUILD_CLEAN=1` | Disables Docker build cache; requires sufficient build memory and storage. |
| Default after service startup | Executes active Retell configuration sync and then public-demo phone sync. These can change provider state. |
| `SKIP_RETELL_SYNC=1` | Skips the entire Retell sync block, including public-demo sync. |
| `SKIP_PUBLIC_DEMO_SYNC=1` | Skips only public-demo sync; active Retell configuration sync still runs unless separately skipped. |

The optional migration flag does not disable the API's startup schema
initialization. Neither path replaces the ledger cutover procedure above.
For an infrastructure or ledger update, explicitly decide whether provider
configuration changes belong in the release and use the appropriate opt-out.
Skipping sync also requires verifying that existing signed tool URLs remain
compatible. A sync failure can occur after containers have already changed;
the script does not automatically roll back that partial deployment.

## Provider setup and verification

Configure Stripe products and price IDs, the billing webhook and its signing
secret for the same test or live environment. Configure Retell lifecycle and
tool webhooks against the intended public base URL and verify signatures after
any key or URL change. Use a verified sender domain for Resend. Follow the
current provider setup instructions and check the routes handled by this
revision rather than assuming a historical event list is complete.

`GET /health` reports process liveness and Redis status. Its database check is
deferred; an `ok` response does not establish database readiness. The API's
`GET /ready` probes the database and applicable Own-KB prerequisites. With the
root Caddy routing, use `/api/ready` for that API route. Readiness does not prove
ledger activation, successful billing, voice quality or latency.

After a controlled rollout, verify the running image identity, database
readiness, ledger state, webhook authentication and invoice-worker status.
Observe failed invoice intents, rejected events and unresolved holds. Keep
customer data and credentials out of logs and public verification reports.
Real call quality and latency require separate, authorized call measurements;
a successful build or health response is not that evidence.

## Scaling and local development

Additional API instances must share the intended PostgreSQL and Redis services
and use compatible schema and application versions. Add load balancing and
capacity planning explicitly; do not run mixed ledger versions during cutover.

For local development, install workspace dependencies and use `pnpm dev` with
development credentials and disposable services. The default API and Web
development ports are 3001 and 5173. Local setup does not provision or deploy a
production environment.
