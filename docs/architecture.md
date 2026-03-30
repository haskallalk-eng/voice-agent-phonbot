# Architecture

## Overview

Voice Agent SaaS – a customer-facing platform that lets businesses configure and deploy AI phone agents without technical knowledge.

## Stack

```
┌─────────────────────────────────────────────┐
│  Dashboard (React + Tailwind + Vite)        │
│  - Agent Builder (config + deploy)          │
│  - Test Console (text chat + web call)      │
│  - Ticket Inbox                             │
│  - Call Log / Traces                        │
└──────────────┬──────────────────────────────┘
               │ HTTP / WebSocket
┌──────────────▼──────────────────────────────┐
│  API (Fastify + TypeScript)                 │
│  - Agent Config CRUD + Retell sync          │
│  - Chat (text-based, OpenAI Responses API)  │
│  - Tickets (Postgres / in-memory)           │
│  - Retell Webhooks (custom functions)       │
│  - Traces / Observability                   │
└──────────────┬──────────────────────────────┘
               │ HTTPS
┌──────────────▼──────────────────────────────┐
│  Retell AI (managed)                        │
│  - Voice pipeline (STT → LLM → TTS)        │
│  - Telephony (Twilio / SIP)                 │
│  - Phone number provisioning                │
│  - WebRTC for browser test calls            │
│  - Barge-in, VAD, latency optimization      │
└─────────────────────────────────────────────┘
```

## Key Decisions

- **Retell AI as infrastructure**: We don't build our own voice pipeline. Retell handles STT, TTS, telephony, and real-time audio. We build the business layer on top.
- **Custom Functions**: Retell calls our webhook endpoints when the agent needs to execute tools (calendar, tickets). This keeps business logic in our control.
- **Dual mode**: Text chat via OpenAI Responses API (for quick testing without voice), voice via Retell (for production phone calls).
- **Multi-tenant from day 1**: Config is stored per `tenantId`. Each tenant gets their own Retell agent + LLM.

## Data Flow: Phone Call

1. Customer calls the business phone number
2. Retell receives the call, runs STT + LLM
3. LLM decides to call a tool → Retell POSTs to our webhook
4. Our API executes the tool (e.g. `calendar.findSlots`) and returns result
5. Retell feeds result back to LLM → generates spoken response
6. Customer hears the response via TTS

## Monorepo Layout

- `apps/api` – Backend API (Fastify)
- `apps/web` – Dashboard (React + Vite)
- `packages/voice-core` – Voice types + OpenAI Realtime provider (legacy, kept for reference)
- `packages/shared` – Shared utilities (phone validation, etc.)
- `packages/ui` – Reusable UI components (planned)
- `infra/` – Docker + K8s configs
- `docs/` – Architecture + ADRs
