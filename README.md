# Phonbot
[![CI](https://github.com/haskallalk-eng/voice-agent-phonbot/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/haskallalk-eng/voice-agent-phonbot/actions/workflows/ci.yml)

**Ein Projekt von MindRails · KI-Telefonassistent für kleine Unternehmen**

Phonbot verbindet Telefonie, konfigurierbare KI-Agenten und ein Dashboard zur Verwaltung. Unternehmen können damit wiederkehrende Anfragen und angebundene Abläufe wie Terminwünsche über einen Telefonassistenten bearbeiten.

**Mein Beitrag:** Ich, Hassieb Kalla, entwickle Phonbot unter MindRails mit KI-Unterstützung, unter anderem Claude Code. Mein Schwerpunkt liegt auf dem Zusammenspiel von Agentenkonfiguration, Integrationen und Geschäftsabläufen.

[Profil und weitere Projekte](https://github.com/haskallalk-eng) · [Produktwebsite](https://phonbot.de) · [Kontakt](mailto:info@mindrails.de)

**Veröffentlichter Stand:** Das Repository zeigt die Retell-basierte Anwendung und Referenz-/Lab-Code für OpenAI Realtime. Retell und Retell-KB bleiben laut Projektarchitektur Laufzeit und Rückfalloption; OpenAI Realtime und die eigene Wissenssuche unterliegen gesonderten Freigabekriterien. Die Einrichtung und Prüfnachweise unten beziehen sich auf den hier veröffentlichten Code. Ein vollständiger Live-Telefonietest und gemessene Produktionslatenzen sind im [Prüfnachweis](docs/portfolio-validation.md) nicht enthalten.

## In 5 Minuten prüfen

1. **Aufbau verstehen:** Die [Architekturübersicht](docs/architecture.md) und der [API-Einstieg](apps/api/src/index.ts) zeigen Komponenten und angebundene Dienste.
2. **Einen Fehlerfall nachvollziehen:** Die [Retell-Signaturprüfung](apps/api/src/retell-signature.ts) und ihre [Tests](apps/api/src/__tests__/webhook-signature.test.ts) zeigen, wie manipulierte Request-Bodies und fehlende Signaturen behandelt werden. Der [Review-Nachtrag](docs/review-follow-up.md) erklärt weitere Korrekturen und ihre Grenzen.
3. **Prüfumfang einordnen:** Der [Prüfnachweis vom 23. Oktober 2026](docs/portfolio-validation.md) nennt Quellstand, Test- und Build-Ergebnisse sowie Reproduktionsbefehle und offene Live-Prüfungen.

Dieser Einstieg lässt sich ohne Zugangsdaten lesen. Zum Ausführen der vollständigen Anwendung sind eigene Datenbank- und Dienstzugänge erforderlich.

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

## Ablauf im veröffentlichten Retell-Stand

1. **Configure** your agent (name, voice, prompt, tools, calendar)
2. **Deploy** to Retell AI with one click
3. **Test** via browser web-call or text chat
4. **Assign** a configured German phone number to make the agent reachable.

## Sicherheitsmechanismen nachvollziehen

Die folgenden Beispiele verknüpfen konkrete Funktionen mit ihren automatisierten Tests:

| Beispiel | Implementierung und Testumfang |
| --- | --- |
| Retell-Webhook-Signaturen | [`verifyRetellSignature`](apps/api/src/retell-signature.ts) prüft Signaturen anhand des unveränderten Request-Bodys. Die [Tests](apps/api/src/__tests__/webhook-signature.test.ts) decken manipulierte Bodies, Zeitfenster, falsche Schlüssel sowie fehlende und ungültige Signaturen ab. Unsignierte Entwicklungsanfragen erfordern eine ausdrückliche Ausnahme; Legacy-Signaturen enthalten keinen Zeitstempel. |
| Token-Verschlüsselung | Das [Kryptomodul](apps/api/src/crypto.ts) verwendet AES-256-GCM mit zufälligem IV. [Tests](apps/api/src/__tests__/crypto.test.ts) prüfen Ver- und Entschlüsselung, unterschiedliche Chiffrate und beschädigte Eingaben. Legacy-Klartext bleibt lesbar; ohne Schlüssel ist außerhalb der Produktion Klartextspeicherung möglich. |
| Redaktion personenbezogener Daten | Die [Redaktionsfunktionen](apps/api/src/pii.ts) ersetzen definierte Muster, etwa für E-Mail-Adressen, Telefonnummern und IBANs. [Tests](apps/api/src/__tests__/pii.test.ts) prüfen diese Muster, verschachtelte Daten und die Freigabe sichtbarer Bestätigungen. Mustererkennung erfasst nicht jede Form personenbezogener Daten. |
| Rufnummernprüfung | Die [gemeinsame Prüffunktion](packages/shared/src/phone.ts) normalisiert Eingaben und lehnt bestimmte Sonderrufnummern ab. [Tests](apps/api/src/__tests__/phone-validation.test.ts) prüfen unter anderem Länge und ausgewählte deutsche und internationale Sperrpräfixe. Ein positives Ergebnis ersetzt keine Freigabe des tatsächlichen Anrufziels. |

Diese Beispiele dokumentieren die gezeigten Codepfade und Tests. Sie sind kein vollständiger Sicherheitsaudit und kein Nachweis der Konfiguration eines laufenden Deployments.

## Tests

[Prüfnachweis vom 23.10.2026: Tests, Builds und Grenzen](docs/portfolio-validation.md).

Aktualisierung vom 26.10.2026: [Eindeutige Kundenzuordnung, Kalenderaufteilung und Regressionstests](docs/calendar-follow-up.md).

```bash
pnpm -r --workspace-concurrency=1 run test --run
pnpm check
node --test scripts/check-secrets.test.mjs
node scripts/check-secrets.mjs
```

Die Befehle führen die Tests aller Workspace-Pakete einmalig aus, prüfen die TypeScript-Typen von API und Web-App und suchen nach bekannten Zugangsdaten-Mustern in versionierten Dateien. Die zusätzliche [PostgreSQL-Integrationsprüfung](apps/api/integration/README.md) benötigt eine isolierte Testdatenbank; CI stellt sie bereit. Der Zugangsdaten-Check läuft auch in CI; der Pre-Commit-Hook prüft den Git-Index. Fundstellen werden ohne geheime Werte ausgegeben. Ein erfolgreicher lokaler Testlauf ersetzt keinen Test der eingerichteten Telefonie und externen Dienste.

## Dokumentation und Mitarbeit

- [Architekturübersicht](docs/architecture.md)
- [API-Konfigurationsvorlage](apps/api/.env.example)
- Für Änderungen am Projekt gelten der [Architekturvertrag](AGENTS.md) und der [Umsetzungsplan](PLANS.md).
