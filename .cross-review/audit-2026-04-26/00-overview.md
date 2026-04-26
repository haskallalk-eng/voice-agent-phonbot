# 00 · Architektur-Overview + Trust-Boundaries

**Author**: Claude · **Reviewer**: Codex · **Status**: Awaiting counter-review

Diese Datei ist die **gemeinsame Karte** für alle Modul-Audits. Wenn ein Modul-Befund von hier abweicht (anderes Trust-Modell, anderer Datenfluss), MUSS der Befund das hier erwähnen.

## Repo-Größe (für Kontext)

| | LOC | Files |
|---|---|---|
| `apps/api/src` | ~21.300 | 51 `.ts` |
| `apps/web/src` | ~21.150 | 67 `.ts` / `.tsx` |
| `packages/shared` | klein | 2-3 module |
| `packages/voice-core` | klein | nur Typen, ungenutzt zur Laufzeit |

Total: ~42.500 LOC TypeScript ohne Tests, statische HTML, Skripte.

## 1. API-Entry-Surface (Fastify-Routes)

Bootstrapping: [apps/api/src/index.ts](../../apps/api/src/index.ts) registriert ~13 Route-Module:

| File | Verantwortet |
|---|---|
| [auth.ts](../../apps/api/src/auth.ts) | `/auth/login` `/auth/register` `/auth/refresh` `/auth/logout` `/auth/reset-password` `/auth/verify-email` `/auth/finalize-checkout` `/auth/account` (DELETE). JWT 1h + Refresh 30d. |
| [agent-config.ts](../../apps/api/src/agent-config.ts) | `/agent-config` (GET/PUT) `/agent-config/deploy` `/agent-config/web-call` `/agent-config/agents` (Multi-Agent-Liste) `/agent-config/preview`. Multi-Tenant via JWT-`orgId`. |
| [retell-webhooks.ts](../../apps/api/src/retell-webhooks.ts) | `/retell/webhook` (call lifecycle, HMAC) + Tool-Dispatch: `calendar.findSlots/.bookSlot`, `ticket.create`, `recording_declined`, `external.call`. |
| [billing.ts](../../apps/api/src/billing.ts) | `/billing/webhook` (Stripe, raw-body) `/billing/plans` `/billing/checkout` `/billing/portal`. Subscription-Lifecycle + Overage-Items. |
| [calendar.ts](../../apps/api/src/calendar.ts) | `/calendar/connect/google` `/microsoft` `/calcom` `/calendar/callback` `/calendar/list` `/calendar/chipy`. OAuth-Flow + Booking-Endpoint. |
| [calendar-sync.ts](../../apps/api/src/calendar-sync.ts) | Background-Cron alle 5 min: pulled externe Events ins UI-Cache (`external_calendar_events`). |
| [phone.ts](../../apps/api/src/phone.ts) | `/phone/list` `/phone/provision` `/phone/forward` `/phone/verify-forwarding` `/phone/verify` `/phone/assign`. Twilio-Number-Lifecycle. |
| [tickets.ts](../../apps/api/src/tickets.ts) | `/tickets` (CRUD) `/tickets/:id/callback`. Toll-Fraud-Guard auf Callback. |
| [insights.ts](../../apps/api/src/insights.ts) | Call-Insights: GPT-4o + Embeddings. `analyseCall()` nach jedem `call_ended`. |
| [demo.ts](../../apps/api/src/demo.ts) | `/demo/call` `/demo/callback` (Sales). Kein Auth, Cloudflare Turnstile + Rate-Limit. |
| [voices.ts](../../apps/api/src/voices.ts) | `/voices` `/voices/recommended` `/voices/clone`. Voice-Catalog + ElevenLabs/Cartesia-Clone. |
| [knowledge.ts](../../apps/api/src/knowledge.ts) | `/agent-config/knowledge` (PDF-Upload). SHA-256-Dedup, AES-256-GCM. |
| [contact.ts](../../apps/api/src/contact.ts) | `/contact` (Lead-Form). Cloudflare Turnstile. |
| [admin.ts](../../apps/api/src/admin.ts) | `/admin/*` Org-Settings, User-Invites, Feature-Flags. Owner-only. |
| [api-integrations.ts](../../apps/api/src/api-integrations.ts) | Custom-API-Aufrufe vom Agent (encrypted Auth, SSRF-guarded, 10s Timeout). |

**Globale Guards** (registriert in `index.ts`):
- 100 req/min per-IP (Rate-Limit-Plugin)
- CSP-Header (`@fastify/helmet`)
- CORS streng (nur `APP_URL`)
- Webhook-Pfade vom Rate-Limit ausgenommen

## 2. Trust-Boundaries

Wo externer Input das System betritt — jede dieser Stellen ist „untrusted edge" und braucht Zod + Auth + Rate-Limit + ggf. Signature-Check:

| Boundary | Datei | Auth-Modell | Anti-Abuse |
|---|---|---|---|
| **HTTP authed-routes** | alle `app.get/post + onRequest: [app.authenticate]` | JWT in `Authorization: Bearer` | global rate-limit + per-route |
| **Stripe webhook** | [billing.ts](../../apps/api/src/billing.ts) `/billing/webhook` | `stripe.webhooks.constructEvent()` HMAC + raw body | Idempotency via `processed_stripe_events` PK |
| **Retell call-lifecycle webhook** | [retell-webhooks.ts](../../apps/api/src/retell-webhooks.ts) `/retell/webhook` | HMAC-SHA256 + `timingSafeEqual` | Idempotency via `processed_retell_events` PK |
| **Retell tool endpoints** | [retell-webhooks.ts](../../apps/api/src/retell-webhooks.ts) `/retell/tools/*` | **Kein HMAC** — auth via `_retell_agent_id` Body-Field + Org-Lookup | Org-Isolation strict |
| **Twilio Status-Callback** | [outbound-* / phone.ts] | `twilio.validateRequest()` Signature | rate-limit |
| **Twilio TwiML Pull** | outbound-* | Twilio fragt; wir antworten — Tokens in URL als One-Time-Nonce | Nonce-Replay-Schutz Redis |
| **Calendar OAuth Callback** | [calendar.ts](../../apps/api/src/calendar.ts) `/calendar/callback` | `state`-Token HMAC + Redis-Nonce-Replay | TTL 15 min |
| **Public POST: Demo / Contact** | demo.ts, contact.ts | Kein Auth | Cloudflare Turnstile + Rate-Limit (Hourly Cap via Redis) |
| **Public POST: Outbound Website-Callback** | outbound-* | Kein Auth | Turnstile + Hourly Cap + DACH-Phone-Whitelist |
| **File Upload** | [knowledge.ts](../../apps/api/src/knowledge.ts) | JWT | 50 MB cap, MIME check, SSRF-guarded für URL-Sources |
| **Custom-API von Retell** | [api-integrations.ts](../../apps/api/src/api-integrations.ts) | Decrypted-on-use Auth | SSRF-guard (private-host blocklist + CGNAT range), 10s Timeout, 100 KB Response cap |

## 3. Datenfluss eines einzelnen Anrufs (Happy Path)

```
Anrufer wählt Twilio-Nummer
  ↓
Twilio routet zu Retell-managed Agent
  ↓
Retell startet Agent (LLM = OpenAI GPT-4o, Voice = ElevenLabs/Cartesia)
  ↓
LLM ruft Tool z.B. calendar.bookSlot
  ↓ HTTP POST → Phonbot API
[apps/api/src/retell-webhooks.ts]
  ↓ getOrgIdByAgentId() — org isolation via _retell_agent_id
  ↓ calendar.book() — encrypted token decrypt → Google API → DB insert
[apps/api/src/calendar.ts] + DB calendar_bookings
  ↓ sendBookingConfirmationSms() — Twilio SMS
[apps/api/src/sms.ts]
  ↓ Tool-Response zurück an Retell
  ↓ LLM bestätigt mündlich beim Anrufer
  ↓
Call ended
  ↓ Retell POST → /retell/webhook (HMAC)
[apps/api/src/retell-webhooks.ts] call_ended Branch
  ↓ Idempotency check (processed_retell_events)
  ↓ INSERT INTO call_transcripts
  ↓ analyseCall() → OpenAI GPT-4o → INSERT INTO insights
  ↓ reconcileMinutes() → Stripe Invoice-Item für Overage
  ↓ fireInboundWebhooks() — fire & forget an Customer-Webhooks
  ↓
Frontend pollt /insights/calls
[apps/web/src/lib/api.ts request<T>()]
  ↓
User sieht Transcript + Insights im Dashboard
```

**Tabellen die ein einzelner Anruf berührt**: `phone_numbers` (Lookup), `agent_configs` (Prompt-Pull beim Deploy, nicht pro Call), `calendar_connections` (Token-Decrypt), `calendar_bookings` (Insert), `tickets` (optional Insert), `call_transcripts` (Insert), `processed_retell_events` (Idempotency-Insert), `orgs` (`minutes_used` Update), `external_calendar_events` (Read-only Cache), evtl. `recording_declined_calls`.

## 4. Externe Services

| Service | Wo | Was wird gesendet | Risiko-Klasse |
|---|---|---|---|
| **Retell AI** | [retell.ts](../../apps/api/src/retell.ts), [retell-webhooks.ts](../../apps/api/src/retell-webhooks.ts) | Agent-Prompts + Tool-Definitions; eingehend Transcripts + Lifecycle | 🔴 Core (ohne kein Voice) |
| **Twilio** | [phone.ts](../../apps/api/src/phone.ts), [twilio-openai-bridge.ts](../../apps/api/src/twilio-openai-bridge.ts) | Number-Lookup, SMS, Outbound-Trigger | 🔴 Core (Voice-Carrier) |
| **Stripe** | [billing.ts](../../apps/api/src/billing.ts) | Subscription, Customer, Invoice-Items | 🔴 Money |
| **OpenAI API** | [insights.ts](../../apps/api/src/insights.ts) + 4 weitere (`outbound-insights`, `template-learning`, `learning-api`, `copilot`) | Call-Transcripts → GPT-4o + Embeddings | 🟠 Nice-to-have (Insights, nicht Voice) |
| **Google Calendar** | [calendar.ts](../../apps/api/src/calendar.ts) | OAuth, freeBusy, events.insert | 🟠 Pro Customer |
| **Microsoft Graph** | [calendar.ts](../../apps/api/src/calendar.ts) | OAuth, calendarView, events.insert | 🟠 Pro Customer |
| **Cal.com** | [calendar.ts](../../apps/api/src/calendar.ts) | API-Key, /bookings | 🟡 Pro Customer |
| **ElevenLabs** | [voices.ts](../../apps/api/src/voices.ts) (Voice-Clone) | Voice-Sample-Upload, Clone-API | 🟡 Premium-Voice |
| **Cartesia** | [voices.ts](../../apps/api/src/voices.ts) | Voice-Listing | 🟡 Standard-Voice |
| **Resend** | [email.ts](../../apps/api/src/email.ts) | Branded transactional emails | 🟠 (Verify, Reset, Booking-Bestätigung) |
| **Cloudflare Turnstile** | [captcha.ts](../../apps/api/src/captcha.ts) | Token-Verify | 🟠 (sonst Toll-Fraud-Vektor) |
| **Sentry** | [sentry.ts](../../apps/api/src/sentry.ts) | Error-Reports (mit `beforeSend` PII-Filter) | 🟡 Observability |
| **Supabase Postgres** | [db.ts](../../apps/api/src/db.ts) | Alle Reads/Writes | 🔴 Core |
| **Redis** | [redis.ts](../../apps/api/src/redis.ts) | Sessions, Locks, Dedup-Counter | 🔴 Core (für Sessions + Cron-Locks) |

## 5. Frontend-Top-Level-Surfaces

Routing via Hash + State in [App.tsx](../../apps/web/src/ui/App.tsx). Kein React Router — Page-State ist eine Variable.

**Authenticated:**

| Component | Datei | Was tut's |
|---|---|---|
| `DashboardHome` | (Sidebar-Default) | Summary-Karten: Calls, Minuten, Tickets, schneller Test-Call |
| `AgentBuilder` | [agent-builder/index.tsx](../../apps/web/src/ui/agent-builder/index.tsx) | **Größte Komponente (~2500 LOC)**. Tabs: Identity, Behavior, Capabilities, Knowledge, Voice-Clone, Webhooks, Privacy, Technical |
| `PhoneManager` | [PhoneManager.tsx](../../apps/web/src/ui/PhoneManager.tsx) | Twilio-Number kaufen, Forwarding einrichten, Test |
| `CalendarPage` | [CalendarPage.tsx](../../apps/web/src/ui/CalendarPage.tsx) | OAuth-Connect, Day-Drawer mit Bookings + externe Events |
| `TicketInbox` | [TicketInbox.tsx](../../apps/web/src/ui/TicketInbox.tsx) | Tickets-CRUD, Status-Filter |
| `CallLog` | [CallLog.tsx](../../apps/web/src/ui/CallLog.tsx) | Transcript-Viewer mit Search |
| `InsightsPage` | [InsightsPage.tsx](../../apps/web/src/ui/InsightsPage.tsx) | Charts: Volume, Sentiment, Top-Issues |
| `BillingPage` | [BillingPage.tsx](../../apps/web/src/ui/BillingPage.tsx) | Stripe-Checkout, Usage, Invoice-History |
| `AdminPage` | [AdminPage.tsx](../../apps/web/src/ui/AdminPage.tsx) | Owner-only Org-Settings |

**Unauthenticated:**

| Component | Datei | Was |
|---|---|---|
| `LandingPage` | [landing/index.tsx](../../apps/web/src/ui/landing/index.tsx) | Hero + Features + Demo + Pricing + FAQ + Contact |
| `LoginPage` | [LoginPage.tsx](../../apps/web/src/ui/LoginPage.tsx) | Login + Register + Reset-Password (B2B-only Checkbox seit 72708cc) |
| `OnboardingWizard` | [onboarding/OnboardingWizard.tsx](../../apps/web/src/ui/onboarding/OnboardingWizard.tsx) | Post-Signup: Branche → Business-Daten → Agent-Config |

**Static HTML-Seiten** (in `apps/web/public/`): 5 Branchen-Pages, 3 Legal (Impressum/Datenschutz/AGB), je via `scripts/_footer.mjs` + `scripts/_nav.mjs` synchronisiert.

## 6. Datenbank-Schema (Tabellen-Bestand)

Migration in [db.ts](../../apps/api/src/db.ts) `migrate()`-Function via `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`. Locking via `pg_advisory_lock(92541803715)` damit Rolling-Deploys nicht in DDL-Deadlock laufen.

**Kerntabellen** (Auswahl):

| Tabelle | Zweck | DSGVO-Lifecycle |
|---|---|---|
| `orgs` | Multi-Tenant-Wurzel; Stripe-Customer-Id; minutes_used | Permanent (User löscht via DELETE /auth/account) |
| `users` | Email + bcrypted password + role + org_id (FK) | Cascade on org delete |
| `refresh_tokens` | 30d httpOnly-Cookie-Tokens, hashed | Auto-expire |
| `agent_configs` | JSONB-Prompt + Tools + Wissen + Voice-Choice | Pro Tenant |
| `phone_numbers` | Twilio-Nummern + assignment + forwarding-state | Auto-purge bei Org-Delete |
| `tickets` | Handoff-Context (Name, Phone, Notes) | DSGVO 90d-Purge |
| `call_transcripts` | Persistent Transcripts | DSGVO 90d-Purge |
| `calendar_connections` | OAuth-Tokens AES-256-GCM | Cascade on org delete |
| `calendar_bookings` | Buchungen via Phonbot | Permanent |
| `external_calendar_events` | Cache aus Google/Outlook (Display only) | Re-syncs alle 5 min |
| `pending_registrations` | Stripe-First-Pre-User | Sweep alle 10 min wenn > 30 min orphan |
| `processed_stripe_events` | Webhook-Idempotency | 90d Cleanup |
| `processed_retell_events` | Webhook-Idempotency | 90d Cleanup |
| `recording_declined_calls` | DSGVO §201 StGB Opt-out-Flag | Permanent |
| `crm_leads` | Outbound-Kandidaten + abandoned signups | DSGVO 90d-Purge |
| `outbound_calls` | Outbound-Call-History | Permanent |
| `knowledge_files` | PDFs als bytea, SHA-256-Dedup | Pro Org |
| `traces` | Tool-Call-Traces für Debugging | Cleanup TBD |

## 7. Tool-Dispatchers (Retell ↔ Phonbot)

Alle in [retell-webhooks.ts](../../apps/api/src/retell-webhooks.ts) im selben File registriert (eine zentrale Dispatcher-Surface):

| Tool | Was tut's | Side-Effects |
|---|---|---|
| `calendar.findSlots` | Free-Slots ermitteln über Schnittmenge Chipy + alle ext. Kalender | Read-only |
| `calendar.bookSlot` | Insert in `calendar_bookings`; bei externen Kalendern ALLE schreiben + Chipy | SMS-Confirmation; bei Fehler → Ticket-Fallback |
| `ticket.create` | INSERT INTO tickets + sendTicketNotification | Mail an Owner |
| `transfer_call` | Echte Telefon-Weiterleitung via Retell-Tool — funktioniert nur PSTN-Calls | Bei Web-Calls: Agent sagt „kann nicht weiterleiten" |
| `recording_declined` | Flag in `recording_declined_calls`; call_ended liest und ruft DELETE /v2/delete-call | Audio + Transcript bei Retell gelöscht |
| `external.call` | Custom-API-Aufruf des Customers aus dem Agent heraus | Encrypted Auth, SSRF-Guard, 10s Timeout |

**Auth-Modell**: `_retell_agent_id` aus dem Body wird via `getOrgIdByAgentId()` zur Org aufgelöst. Wenn kein Match → 403. Das ist die einzige Auth — kein HMAC, weil Retell Custom-Tools nicht signiert.

## 8. Background-Jobs / Cron / Sweeps

Alle via `setInterval()` mit Boot-Stagger gegen Thundering-Herd. Keine Bull/RQ/Worker — alles in-process.

| Job | Frequenz | Was |
|---|---|---|
| Stuck-Outbound-Cleanup | 1h | `'calling'` > 1h alt → `'timeout'` |
| DSGVO-Transcript-Purge | 24h | DELETE FROM call_transcripts WHERE > 90d |
| DSGVO-Leads-Purge | 24h | DELETE FROM crm_leads WHERE > 90d |
| Abandoned-Registrations-Sweep | 10 min | Pending-Rows > 30 min → CRM-Lead + Re-Engagement-Mail |
| Twilio-Number-Sync | 6h (Redis-Lock 10 min TTL) | Pull alle Twilio-Numbers in DB; Pool auf MAX_POOL_SIZE=3 trimmen |
| Webhook-Dedup-Cleanup | 24h | processed_stripe_events + processed_retell_events > 90d weg |
| Calendar-Poll-Sync | 5 min | Google/Microsoft/Cal.com Events → external_calendar_events Cache |

**Risiko**: alles in-process → wenn ein Container-Restart genau im Cron-Moment passiert, kann ein Job-Run failen. Acceptable für aktuelle Skala (1 API-Container).

## 9. Shared Packages

| Package | Inhalt | Genutzt? |
|---|---|---|
| `packages/shared` | `phone.ts` (`normalizePhoneLight`, `isPlausiblePhone`), `technical.ts` (Typen), `formatTechnicalMode` | Ja, importiert von API + Web |
| `packages/ui` | Nur dist-Typen | Nein, Code hat sich verlagert nach `apps/web/src/ui/` |
| `packages/voice-core` | Abstrakte VoiceSession-Basis-Klassen | **Nein** — Reference only, kein Runtime-Import |

→ **`packages/voice-core` ist Dead-Code-Kandidat** für Cleanup. Befund-Slot vermerken.

## 10. Architektur-Patterns die durchgängig gelten

1. **Multi-Tenant-Isolation**: jede Query mit `WHERE org_id = $1` aus JWT. `agent_configs` hat zusätzlich SQL-Level `ON CONFLICT WHERE org_id`.
2. **Webhook-Signatures**: Retell HMAC + `timingSafeEqual`, Stripe `constructEvent` + raw body, Twilio `validateRequest`.
3. **Encryption at Rest**: AES-256-GCM für OAuth-Tokens + Cal.com-Keys + Custom-Integration-Keys (`enc:v1:` Prefix). Prod boot-throw wenn `ENCRYPTION_KEY` fehlt.
4. **JWT 1h + Refresh 30d**: Access-Token in-memory only (XSS-safe), Refresh httpOnly+sameSite=strict+rotated-on-each-use.
5. **DSGVO-Posture**: PII-redaction in Pino + `redactPII()` Helper, Sentry `beforeSend` strips bodies/cookies, Account-Delete cascade via FK, Google Fonts self-hosted (kein IP-Transfer).
6. **Anti-Toll-Fraud**: `ALLOWED_PHONE_PREFIXES` (DACH default) auf allen Twilio-Dial-Pfaden, intl-Premium-Blocklist.
7. **Rate-Limits**: Global 100/min per-IP + route-specific overrides + Hourly-Cap via Redis-Counter für Public-Endpoints.
8. **CAPTCHA**: Cloudflare Turnstile auf `/demo/*` + `/outbound/website-callback`. Prod fail-closed.
9. **Idempotency**: Stripe + Retell Webhooks via `processed_*_events` PK, Minute-Reservation atomic via `tryReserveMinutes()`.

---

## Open Questions for Codex (zu Counter-Review)

Bevor wir in die Modul-Audits gehen — bitte zu diesen Punkten Stellung nehmen:

**Q1**: Stimmt das Trust-Modell im Tool-Dispatch? `_retell_agent_id` aus dem Body als einzige Auth — ohne HMAC — ist das tragbar? Theoretischer Angriff: jemand kennt eine `agent_id`, ruft direkt `/retell/tools/calendar.bookSlot` mit beliebigen Slot-Daten auf. Mitigationen die ich sehe: (a) `agent_id`-Knowledge ist niedriges Geheimnis (nicht öffentlich, aber leicht erratbar wenn man irgendwie einen Snapshot des Configs bekommt), (b) Slot-Buchungen sind reversibel, (c) Toll-Fraud-Guards greifen bei SMS/Calls. Reicht das?

**Q2**: Background-Jobs in-process via `setInterval` — bei Multi-Container-Deploy würde jeder Container den gleichen Sweep ausführen und doppelte Mails verschicken. Aktuell gibt's nur `Twilio-Sync` mit Redis-Lock. Andere Sweeps (Abandoned-Registrations, DSGVO-Purge) laufen ohne Lock. Aktuell nur 1 API-Container → kein Problem. Aber sollte das vor erstem Skalierungs-Move dokumentiert sein?

**Q3**: `recording_declined_calls` — die DELETE-Aktion zur Retell-API passiert *nach* dem call_ended-Webhook. Race: was wenn zwischen Anruferende und unserem DELETE die `call_ended`-Webhook bereits Transcript in unsere DB geschrieben hat? Korrekt-Path müsste sein: erst DELETE bei Retell, danach unser DB-Insert skippen. Stimmt die Reihenfolge im aktuellen Code?

**Q4**: `packages/voice-core` ist im Code aber wird nicht zur Laufzeit importiert. Soll es weg, oder gibt's einen Plan dafür (z. B. zukünftige direkte WebRTC-Implementation jenseits von Retell)?

**Q5**: Frontend-Routing via String-State in `App.tsx` (kein React Router) — würdest du das so beibehalten oder einen echten Router empfehlen? Aktuell scheint's zu funktionieren, aber Deep-Links sind via `?page=...` etwas unidiomatisch.

---

## Codex Counter-Review

<!-- Codex schreibt hier rein nachdem er das Dokument gelesen hat.
     Für jede Section: stimmt zu / korrigiert / ergänzt.
     Open Questions Q1-Q5: Antwort mit eigener Tendenz. -->

_Pending._
