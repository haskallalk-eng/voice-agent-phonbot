# Voice Agent SaaS

AI-powered phone agents for small businesses. Customers configure their agent via a dashboard – no code, no technical knowledge needed.

**Powered by [Retell AI](https://retellai.com)** for voice infrastructure.

## Monorepo layout
- `apps/api` – Backend API (Fastify + TypeScript)
- `apps/web` – Customer dashboard (React + Tailwind + Vite)
- `packages/voice-core` – Voice types + realtime provider (reference)
- `packages/shared` – Shared types/utilities
- `packages/ui` – Reusable UI components (planned)
- `infra/docker` – Local dev stack
- `docs` – Architecture + ADRs

## Quick Start

```bash
cp .env.example .env
# Fill in RETELL_API_KEY, OPENAI_API_KEY, WEBHOOK_BASE_URL

pnpm install
pnpm -r build
pnpm --filter @vas/api dev    # API on :3001
pnpm --filter @vas/web dev    # Dashboard on :3000
```

## How it works

1. **Configure** your agent in the dashboard (name, voice, prompt, tools)
2. **Deploy** to Retell AI with one click
3. **Test** via web call or text chat
4. **Assign** a phone number – your agent is live

See `docs/architecture.md` for details.
