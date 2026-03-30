# Plan (Step-by-step)

## 0) Product decisions (we must lock early)
1. Target use-cases (initial): **appointment booking + FAQ + handoff for edge cases** (hair salons / tradespeople).
2. Channels (for best demo): **web (in-browser)** + **phone (Twilio/SIP)**.
3. Languages, accents, TTS voice quality targets ("wow" quality).
4. Compliance: GDPR, call recording consent, data retention.

## 1) Core architecture (MVP → scalable)
- Realtime voice pipeline:
  - Inbound audio → VAD (voice activity detection)
  - Streaming STT (speech-to-text)
  - LLM reasoning (tool-using agent)
  - Streaming TTS (text-to-speech)
  - Low-latency audio out
- Orchestration + state:
  - Conversation/session store
  - Tool execution (CRM lookup, calendar booking, ticket creation)
  - Observability (traces, metrics, call recordings)
- Admin UI:
  - Configure agents (prompts, tools, knowledge)
  - Test console (talk to agent)
  - Analytics dashboard

## 2) Tech stack (recommended)
- Runtime: Node.js + TypeScript
- API: NestJS or Fastify (lean) + OpenAPI
- DB: Postgres (core), Redis (sessions/queues)
- Realtime: WebSockets + WebRTC gateway (for web) and SIP provider (for phone)
- Queues: BullMQ / Redis streams
- Observability: OpenTelemetry + Grafana/Tempo/Loki
- Deployment: Docker compose (dev) + Kubernetes (prod) or managed container platform

## 3) Milestones
M1. Local demo: web mic → agent → speaker (stable <700ms perceived latency if possible)
M2. Phone demo: Twilio SIP → agent → voice response
M3. Multi-tenant SaaS: orgs/users, billing, per-tenant config
M4. Enterprise polish: SSO, audit logs, role-based access, retention policies

## 4) What we build first
- `packages/voice-core`: streaming pipeline interfaces + adapters
- `apps/api`: session orchestration + config store
- `apps/web`: test console + agent config UI
