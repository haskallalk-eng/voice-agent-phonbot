# Phonbot RAG Architecture

This document is the working rule set for what may be indexed into the voice agent knowledge base.

## Core Rule

RAG explains stable facts. Backend tools execute actions and read live state.

If RAG conflicts with a backend rule, calendar result, billing status, privacy setting, or tool response, the backend/tool result wins.

## Module Matrix

| Module | Put into RAG | Keep out of RAG | Sync trigger |
| --- | --- | --- | --- |
| Agent Builder | Public business role, tone, enabled high-level capabilities, approved vocabulary | Internal system/debug prompts, secrets, hidden admin notes | Agent save/deploy |
| Mein Business: Betrieb | Business name, description, address, regular opening hours, service catalog, general FAQs | Owner login data, billing state, private documents | Business save/deploy |
| Mein Business: Mitarbeiter | Active staff name, public role, public service specialisation, working-hours summary | Private email/phone, internal notes, absence reasons, payroll, customer assignments | Staff profile/hours save/deploy |
| Mein Business: Kunden | Customer intake questions and booking approval policy | Customer names, phones, emails, notes, preferences, history | Customer-module save/deploy |
| Kalender | General schedule summaries already exposed as business/staff hours | Live slots, bookings, blocks, external event details, customer appointment notes | Calendar tool at runtime; no static slot RAG |
| Booking/cancel/reschedule | Stable policy text only, if explicitly configured | Actual booking mutation, appointment identity, cancellation/reschedule confirmation | Calendar tools only |
| Knowledge Sources | Approved public/tenant text, scanned URL snapshots, reviewed PDF/OCR text | Prompt injection, PII, secrets, expired/unapproved/high-risk sources | Knowledge source save/deploy |
| Sales | General sales scripts, public offer descriptions, objection handling | Individual leads, company contacts, pipeline stage, follow-up notes | Sales prompt/content save only |
| Billing/Stripe | Public plan descriptions if intentionally configured | Payment status, invoices, refunds, cards, IBANs, Stripe IDs | Billing tools/admin only |
| Calls/Transcripts | Curated anonymized patterns only after explicit opt-in | Raw audio, transcripts, summaries, call IDs, caller numbers | Pattern pipeline, never raw ingestion |
| SMS/Email | Approved template wording and communication style | Sent messages, delivery status, inbound replies, private contact data | Template save only |
| Integrations/Webhooks | Public capability description such as "CRM handoff exists" | Tokens, OAuth state, webhook URLs/secrets, API responses/logs | Tool schema/backend only |

## Hard Blocklist

Never index: customer records, bookings, transcripts, recordings, sales leads, payment data, API secrets, OAuth tokens, webhook secrets, logs, stack traces, private staff contacts, individual calendar events, live availability, or stale campaigns/prices without validity data.

## Allowed Canonical Facts

The current code intentionally builds canonical facts from:

- `agent_configs.data`: business name, description, industry, address, regular opening hours, services, custom vocabulary, customer-intake question schema, business aliases.
- `calendar_staff`: active staff name, role, public service labels.
- `chipy_schedules` and `staff_chipy_schedules`: regular business/staff working-hours summaries.
- Approved `knowledgeSources`: only after policy checks for review status, expiry, allowed use, risk, PII, prompt injection, SSRF, PDF validity, and OCR safety.

## Freshness

- Live availability and appointment identity: always tool-only.
- Business/staff facts: refresh on save/deploy.
- URL/PDF/OCR content: use fixed text snapshots with content hash; do not let Retell auto-refresh untrusted URLs.
- Prices/policies: only index when intentionally configured and source is approved. If conflicting or stale, remove or require review.

