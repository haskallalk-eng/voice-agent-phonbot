# Phonbot — Voice Agent SaaS

**Portfolio von Hassieb Kalla:** [Projektübersicht für Arbeitgeber](PORTFOLIO.md) · [Doctor-K-Fallstudie](CASE-STUDY-DOCTOR-K.md) · [LinkedIn](https://www.linkedin.com/in/hassieb-kalla-mindrails/)

KI-Telefonassistent für kleine Unternehmen mit konfigurierbaren Agenten und Dashboard.

**Projektstand:** Mein Phonbot-Stack mit GPT Live 1 funktioniert bereits. Dieses öffentliche Repository dokumentiert noch den älteren Retell-/OpenAI-Realtime-Stand. Die folgenden Einrichtungsangaben beziehen sich auf diesen veröffentlichten Code; die aktuelle GPT-Live-1-Implementierung ist hier noch nicht vollständig dokumentiert.

**Betreiber:** Hassieb Kalla (Einzelunternehmer), Berlin · [phonbot.de](https://phonbot.de)

## Monorepo

| Pfad | Beschreibung |
|------|-------------|
| `apps/api` | Fastify 5 + TypeScript Backend |
| `apps/web` | React 19 + Tailwind 4 + Vite 6 Dashboard |
| `packages/shared` | Shared types + phone-validation (`@vas/shared`) |
| `packages/voice-core` | Voice types + OpenAI Realtime provider (reference, not runtime) |
| `packages/ui` | Reusable UI components (planned) |

## Code gezielt ansehen

| Bereich | Einstieg |
| --- | --- |
| API, Routen und Integrationen | [API-Einstieg](apps/api/src/index.ts) |
| Konfiguration und Startprüfungen | [Umgebungsprüfung](apps/api/src/env.ts) |
| Dashboard und API-Verbindung | [Web-Paket](apps/web/package.json) · [Vite-Konfiguration](apps/web/vite.config.ts) |
| Projektstruktur und Telefonablauf | [Architekturübersicht](docs/architecture.md) |
| Lokale Prüfungen | [API-Skripte](apps/api/package.json) · [Workspace-Skripte](package.json) |

## Lokale Einrichtung

Das Projekt verwendet **pnpm 9.15.3** laut [package.json](package.json). Die vollständige Anwendung benötigt eine eingerichtete Datenbank und passende Zugangsdaten für die verwendeten Dienste; dies ist keine Demo ohne Konfiguration.

Vom Repository-Stamm aus:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Vor dem Start in der lokalen Datei `apps/api/.env` die vorhandenen Werte ersetzen:

```dotenv
NODE_ENV=development
PORT=3002
APP_URL=http://localhost:3000
```

Die Vorlage enthält Produktionswerte und Port 3001. Lokal erwartet der [Vite-Proxy](apps/web/vite.config.ts) die API auf Port 3002. Datenbank, eigene Schlüssel und gegebenenfalls Callback-Adressen anhand der Vorlagen einrichten. `VITE_*`-Werte sind öffentlich im Frontend-Build; dort gehören keine geheimen Schlüssel hinein.

```bash
pnpm install
pnpm -r build
```

**Terminal 1 – API:**

```bash
pnpm --filter @vas/api dev
```

**Terminal 2 – Dashboard:**

```bash
pnpm --filter @vas/web dev
```

Dashboard: `http://localhost:3000`. Externe Webhooks benötigen zusätzlich eine für den jeweiligen Anbieter erreichbare, korrekt konfigurierte Adresse. Die lokale Einrichtung allein aktiviert keine Telefonie.

## Ablauf im veröffentlichten Retell-Stand

1. **Configure** your agent (name, voice, prompt, tools, calendar)
2. **Deploy** to Retell AI with one click
3. **Test** via browser web-call or text chat
4. **Assign** a configured German phone number to make the agent reachable.

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
pnpm --filter @vas/api test --run
pnpm check
```

Die Befehle führen die vorhandenen API-Tests einmalig aus und prüfen die TypeScript-Typen von API und Web-App. Ein erfolgreicher lokaler Testlauf ersetzt keinen Test der eingerichteten Telefonie und externen Dienste.

## Docs

- `AGENTS.md` - Codex architecture and safety contract
- `PLANS.md` - Codex living execution plan

- `CLAUDE.md` - legacy Claude guidance; Codex may use it only for low-level repo hygiene, not architecture, rollout, KB, latency, provider, security-gate, or production decisions
- `docs/architecture.md` - system architecture
- `apps/api/.env.example` - all 40+ env vars documented
