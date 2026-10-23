# Architecture

## Overview

Voice Agent SaaS – a customer-facing platform that lets businesses configure and deploy AI phone agents without technical knowledge.

This is a conceptual overview of the published Retell integration. It does not certify a deployed configuration or demonstrate live call performance. For a code review, start with the [source and test walkthrough](../README.md#in-5-minuten-prüfen) and the [dated verification record](portfolio-validation.md).

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
- **Tenant-scoped configuration**: The application associates business configuration and provider resources with tenant/organization context. Isolation must be assessed at each authorization and data-access boundary; this overview is not proof that every query enforces it.

## Data Flow: Phone Call

1. Customer calls the business phone number
2. Retell receives the call, runs STT + LLM
3. LLM decides to call a tool → Retell POSTs to our webhook
4. Our API handles the request through its validation and tool-dispatch path and returns a result; a model request alone is not authorization for a business action
5. Retell feeds result back to LLM → generates spoken response
6. Customer hears the response via TTS

## Monorepo Layout

- `apps/api` – Backend API (Fastify)
- `apps/web` – Dashboard (React + Vite)
- `packages/voice-core` – Voice types + OpenAI Realtime provider (legacy, kept for reference)
- `packages/shared` – Shared utilities (phone validation, etc.)
- `packages/ui` – Reusable UI components (planned)
- `infra/docker/` – Docker configuration
- `docs/` – Architecture + ADRs

## Architecture rules and implementation status

[AGENTS.md](../AGENTS.md) defines the boundaries between provider adapters, trusted scope, tool policy, knowledge governance and rollout. [PLANS.md](../PLANS.md) tracks their implementation status and remaining gates. Those documents contain requirements and targets as well as completed work; targets are not measured production results.

In this published architecture, Retell remains the production baseline and OpenAI Realtime is a lab/canary path. Evaluate each claim against its implementation, tests and recorded verification rather than inferring it from the diagram.
