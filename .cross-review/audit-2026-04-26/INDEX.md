# Phonbot Vollaudit · 2026-04-26 · Claude × Codex

Großes Audit aller Phonbot-Module — vom Architektur-Big-Picture bis runter zu jeder einzelnen Frontend-Aktion und externen Verbindung. Kein Code-Fix in diesem Audit, nur **Befund + konkreter Fix-Vorschlag**. Jeder Befund vom jeweils anderen Modell verifiziert.

## Status-Tracker

| # | Datei | Author | Reviewer | Status |
|---|---|---|---|---|
| 00 | `00-overview.md` — Architektur-Map + Trust-Boundaries | Claude | Codex | ⏳ Author done, awaiting review |
| 01 | `01-auth-jwt.md` — Auth, JWT, Refresh-Token, Sessions | Claude | Codex | 🔧 HIGH-2 + MEDIUM-1 + MEDIUM-2 + MEDIUM-5 + LOW-1 ✅ GEFIXT · HIGH-1 (cross-tab-race) noch offen |
| 02 | `02-agent-config-tenancy.md` — Agent-Config + Multi-Tenant-Isolation | Claude | Codex | 🔧 CRITICAL-1 + HIGH-1 + HIGH-2 + MEDIUM-1/2/3 + LOW-1 ✅ GEFIXT |
| 03 | `03-retell-webhooks-tools.md` — Retell-Webhooks + Tool-Dispatch | Claude | Codex | 🔧 CRITICAL-1 + HIGH-1 + HIGH-2 + MEDIUM-1/2/3 + LOW-1/2 ✅ GEFIXT |
| 04 | `04-billing-stripe.md` — Stripe Subscription + Invoicing | Claude | Codex | 🔧 CRITICAL-1 + HIGH-1 + HIGH-2 + MEDIUM-2/3 ✅ GEFIXT · MEDIUM-1/4 noch offen |
| 05 | `05-calendar-oauth-sync.md` — Calendar OAuth + Poll-Sync | Claude | Codex | 🔧 HIGH-1 + HIGH-2 + MEDIUM-3 ✅ GEFIXT · MEDIUM-1/2/4 noch offen |
| 06 | `06-phone-twilio.md` — Twilio Numbers + Forwarding | Claude | Codex | 🔧 Codex-Counter + Round-8 · HIGH-1/3/B + MEDIUM-1/A/B/5/4 ✅ GEFIXT · HIGH-2 + MEDIUM-X/3/C noch offen |
| 07 | `07-tickets-insights-leads.md` — Tickets + Insights + CRM | Claude | Codex | 🔧 Codex-Counter + Round-8 · HIGH-1 (Quarantine-Pfad) + HIGH-3 + HIGH-4 + MEDIUM-1/2/3/4/5/6/A/B/C + LOW-1/2/3/A/B ✅ GEFIXT · HIGH-2 (UX) + LOW-5 + NICE noch offen |
| 08 | `08-db-schema-migrations.md` — Postgres Schema + Migrations | — | — | ⬜ Pending |
| 09 | `09-frontend-agent-builder.md` — AgentBuilder + Sub-Tabs | — | — | ⬜ Pending |
| 10 | `10-frontend-public.md` — Landing, Onboarding, Login | — | — | ⬜ Pending |
| 11 | `11-ux-flows-e2e.md` — End-to-End-Flows | — | — | ⬜ Pending |
| 12 | `12-security-dsgvo.md` — Cross-cutting Security + Compliance | — | — | ⬜ Pending |
| 99 | `99-synthesis-priority.md` — Sortierte Must-Fix-Liste | — | — | ⬜ Pending |

**Status-Legende**: ⬜ Pending · 🔄 In progress · ⏳ Awaiting review · 💬 Discussion open · ✅ Done (synthesised)

## Befund-Severity (in jedem Modul-Audit benutzt)

| Stufe | Bedeutung |
|---|---|
| 🔴 **CRITICAL** | Sicherheits-/Compliance-/Data-Loss-Risiko. Vor erstem zahlenden Kunden zu fixen. |
| 🟠 **HIGH** | Funktioneller Bug oder echte Stabilitätslücke. Vor Skalierung zu fixen. |
| 🟡 **MEDIUM** | UX-Schaden oder Code-Schmerz der Fehler maskiert. Bald fixen. |
| 🔵 **LOW** | Polishing, Naming, kleine Refactors. Wenn Zeit ist. |
| 💡 **NICE** | Anregung, kein Bug. Optional. |

## Audit-Methodik (4 Achsen pro Befund)

Jeder Befund wird auf den vier Achsen aus `RULES.md` geprüft:

1. **Sinnhaftigkeit** — löst der Code ein echtes Problem? Richtige Abstraktion?
2. **Funktionalität** — tut er was er soll? Edge-Cases? Race-Conditions?
3. **Sauberkeit** — lesbar, idiomatisch, keine toten Pfade?
4. **Sicherheit** — Injection? PII? Auth-Bypass? Secret? Silent-Catch?

## Cross-Review-Workflow für dieses Audit

1. **Claude** schreibt jedes Modul-Dokument als „Author-Pass" — Befund + vorgeschlagener Fix.
2. **Codex** liest, schreibt Counter-Review als zweite Sektion ans Ende der gleichen Datei: stimmt zu / widerspricht / ergänzt.
3. Bei **Disagreement** → Discussion-File `.cross-review/discussions/<topic>.md`, Synthese binnen 2 Iterationen.
4. **User entscheidet** bei Eskalation oder bei Severity-Streit (wir bewerten unterschiedlich).
5. Sobald alle 14 Module durch sind → **Synthese in `99-synthesis-priority.md`** mit der finalen sortierten Must-Fix-Liste.

## Zeitabschätzung

- Phase 1 (Overview + 1. Modul) — 1 Session ✓ (heute)
- Phase 2 (Module 2–8, Backend) — 2–3 Sessions
- Phase 3 (Module 9–11, Frontend + UX) — 1–2 Sessions
- Phase 4 (Module 12, Security cross-cut) — 1 Session
- Phase 5 (Synthese) — 1 Session

Gesamt: ~6–8 Sessions geschätzt. Wenn Codex parallel reviewed, deutlich schneller weil Befunde sofort gegengeprüft werden.
