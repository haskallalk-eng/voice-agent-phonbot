# Phonbot
[![CI](https://github.com/haskallalk-eng/voice-agent-phonbot/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/haskallalk-eng/voice-agent-phonbot/actions/workflows/ci.yml)

**Ein Projekt von MindRails · KI-Telefonassistent für kleine Unternehmen**

Phonbot verbindet Telefonie, konfigurierbare KI-Agenten und ein Dashboard zur Verwaltung. Unternehmen können damit wiederkehrende Anfragen und angebundene Abläufe wie Terminwünsche über einen Telefonassistenten bearbeiten.

**Mein Beitrag:** Ich, Hassieb Kalla, entwickle Phonbot unter MindRails mit KI-Unterstützung, unter anderem Claude Code. Mein Schwerpunkt liegt auf dem Zusammenspiel von Agentenkonfiguration, Integrationen und Geschäftsabläufen.

[Profil und weitere Projekte](https://github.com/haskallalk-eng) · [Produktwebsite](https://phonbot.de) · [Kontakt](mailto:info@mindrails.de)

Phonbot ist bereits bei einem Kunden im echten Telefonbetrieb. Dieses Repository enthält die Retell-basierte Anwendung und Referenzcode für OpenAI Realtime. Der veröffentlichte Code und die konkrete Kundeninstallation können unterschiedliche Stände haben.

## Einstieg

- [Architektur](docs/architecture.md) und [API](apps/api/src/index.ts): Komponenten und angebundene Dienste.
- [Kalender](apps/web/src/ui/CalendarPage.tsx): Betriebs- und Mitarbeiterkalender, Buchungsdialoge und Einstellungen.
- [Tests und bisherige Ergebnisse](docs/portfolio-validation.md): Befehle, geprüfte Revisionen und Umfang.

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

Die neue Minutenverwaltung benötigt zusätzlich eine bewusst aktivierte Datenbank nach dem [beschriebenen Cutover](docs/usage-ledger-rollout.md). Migration und Startup lassen sie zunächst inaktiv, damit historische Reservierungen nicht versehentlich als Verbrauch abgerechnet werden. Einen bestehenden Betrieb erst nach Drain und Datenabgleich umstellen.

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

## Telefonassistent einrichten

1. Agent mit Stimme, Anweisungen, Werkzeugen und Kalender konfigurieren.
2. Konfiguration an Retell übertragen.
3. Per Browseranruf oder Textchat ausprobieren.
4. Eine eingerichtete Telefonnummer zuweisen.

## Codebeispiele

- [Webhook-Signaturen](apps/api/src/retell-signature.ts) und [Tests](apps/api/src/__tests__/webhook-signature.test.ts): Prüfung des unveränderten Request-Bodys, manipulierte Eingaben und Zeitgrenzen.
- [Kundenzuordnung](apps/web/src/ui/calendar/customerLookup.ts) und [Tests](apps/web/src/ui/calendar/customerLookup.test.ts): vollständige Treffer, Mehrdeutigkeiten und unvollständige Suchergebnisse.
- [Token-Verschlüsselung](apps/api/src/crypto.ts) und [Tests](apps/api/src/__tests__/crypto.test.ts): AES-256-GCM und Umgang mit beschädigten Eingaben. Die Konfiguration und der Umgang mit bestehenden Klartextwerten sind im Modul beschrieben.

## Tests

[Prüfnachweis vom 23.10.2026: Tests, Builds und Grenzen](docs/portfolio-validation.md).

[Kundenzuordnung und Kalenderaufteilung](docs/calendar-follow-up.md).

```bash
pnpm -r --workspace-concurrency=1 run test --run
pnpm check
node --test scripts/check-secrets.test.mjs
node scripts/check-secrets.mjs
```

CI führt außerdem die [PostgreSQL-Integrationstests](apps/api/integration/README.md) mit einer isolierten Datenbank aus. Der Zugangsdaten-Check sucht nach bekannten Mustern und gibt keine geheimen Werte aus. Umfang und Grenzen der bisherigen Testläufe stehen im verlinkten Prüfbericht.

## Dokumentation und Mitarbeit

- [Architekturübersicht](docs/architecture.md)
- [API-Konfigurationsvorlage](apps/api/.env.example)
- Für Änderungen am Projekt gelten der [Architekturvertrag](AGENTS.md) und der [Umsetzungsplan](PLANS.md).
