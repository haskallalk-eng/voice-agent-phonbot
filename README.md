# Phonbot — Voice Agent SaaS

KI-Telefonassistent für kleine Unternehmen. Kunden konfigurieren ihren Agent per Dashboard — kein Code, kein Techniker nötig. Nativ deutschsprachig, DSGVO-konform, ab 89 €/Monat.

**Betreiber:** Hassieb Kalla (Einzelunternehmer), Berlin · [phonbot.de](https://phonbot.de)

## Monorepo

| Pfad | Beschreibung |
|------|-------------|
| `apps/api` | Fastify 5 + TypeScript Backend |
| `apps/web` | React 19 + Tailwind 4 + Vite 6 Dashboard |
| `packages/shared` | Shared types + phone-validation (`@vas/shared`) |
| `packages/voice-core` | Voice types + OpenAI Realtime provider (reference, not runtime) |
| `packages/ui` | Reusable UI components (planned) |

## Quick Start

```bash
cp apps/api/.env.example apps/api/.env   # fill in keys
cp apps/web/.env.example apps/web/.env   # fill in public keys
pnpm install
pnpm -r build
pnpm --filter @vas/api dev               # API on :3002
pnpm --filter @vas/web dev               # Dashboard on :3000
```

See `apps/api/.env.example` for all required env vars (40+).

## How it works

1. **Configure** your agent (name, voice, prompt, tools, calendar)
2. **Deploy** to Retell AI with one click
3. **Test** via browser web-call or text chat
4. **Assign** a German phone number — your agent is live 24/7

## Security

Codex authority: `AGENTS.md` and `PLANS.md` are the only authoritative
architecture, rollout, KB, latency, security-gate, and planning documents.
`CLAUDE.md` is legacy Claude guidance and may be used only for low-level repo
hygiene when explicitly useful.

- Multi-tenant isolation (`org_id` on every query, SQL-level ON CONFLICT guards)
- Webhook signature verification (Retell HMAC, Stripe constructEvent, Twilio)
- Token encryption at rest (AES-256-GCM for OAuth + Cal.com keys)
- Access JWT in memory only (no localStorage), refresh via httpOnly cookie
- Anti-toll-fraud phone-prefix whitelist (DACH default) on all dial paths
- Cloudflare Turnstile CAPTCHA on public demo endpoints
- PII redaction in logs (Pino paths + Sentry beforeSend)
- Rate-limiting per IP + per org + global Redis counters
- Atomic minute-reservation (`tryReserveMinutes`) against concurrent-call over-billing

For Codex architecture and rollout decisions, use `AGENTS.md` and `PLANS.md`.

## Tests

```bash
cd apps/api && pnpm test       # smoke tests (usage, captcha, session-store)
```

## Docs

- `AGENTS.md` - Codex architecture and safety contract
- `PLANS.md` - Codex living execution plan

- `CLAUDE.md` - legacy Claude guidance; Codex may use it only for low-level repo hygiene, not architecture, rollout, KB, latency, provider, security-gate, or production decisions
- `docs/architecture.md` - system architecture
- `apps/api/.env.example` - all 40+ env vars documented
