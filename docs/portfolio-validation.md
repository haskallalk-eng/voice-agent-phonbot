# Technischer Prüfnachweis – Phonbot

Stand: **23. Oktober 2026**. Lokale Prüfung nach Installation mit eingefrorenem Lockfile, Node.js 24.16.0, pnpm 9.15.3 und isoliertem PostgreSQL 16.15.

Code- und Testrevision: [`83df877`](https://github.com/haskallalk-eng/voice-agent-phonbot/commit/83df877c621a311b101bda16e2ae0e967274c37d). Spätere reine Dokumentationsänderungen stellen keinen neuen Anwendungstest dar.

## Ergebnisse

| Prüfung | Ergebnis |
| --- | --- |
| API-Testlauf | 1.902 Tests in 134 Dateien bestanden |
| Shared-Paket | 6 Tests bestanden |
| Voice-Core-Referenz | 2 Tests bestanden |
| Web-Paket | 2 Tests bestanden |
| PostgreSQL-Integration | 32 Tests mit getrennten echten Datenbankverbindungen bestanden |
| Testempfindlichkeit | Entferntes `FOR UPDATE` in isolierter Testmutation ließ den Freitarif-Konkurrenztest erwartungsgemäß fehlschlagen |
| Zugangsdaten-Checker | 4 Regressionstests bestanden; versionierte Dateien ohne Treffer der bekannten Muster |
| TypeScript | API und Web bestanden |
| Build | Shared, Voice Core, API und Web bestanden |
| Datenbankmigrationen | 7 Migrationsdateien formal geprüft; statische Own-KB-Prüfung bestanden |
| SEO-Artefakte | Reproduzierbar generiert; Audit mit 0 Warnungen und 0 Fehlern |

Die PostgreSQL-Suite prüft tatsächlich ausgeführte SQL, Sperren und Transaktionen. Die Datenbankgrenze wird auf isolierte Verbindungen gelenkt; Tarifkonstanten sind Testwerte. Sie prüft keine produktive Datenbank und keine Zahlungsabwicklung beim Anbieter. Die Webhook-Routentests verwenden hingegen simulierte fachliche Datenbankantworten. Diese unterschiedlichen Nachweise sind nicht austauschbar.

## Lokaler Prüfstand und laufende CI

Der [Workflow](../.github/workflows/ci.yml) verwendet Node.js 22 und einen kurzlebigen PostgreSQL-16-Dienst. Er enthält Tests aller Workspace-Pakete, PostgreSQL-Integration, Shared-/Voice-Core-/API-/Web-Builds, API-/Web-Typprüfung, Zugangsdaten-Checker, formale Migrationen, statische Own-KB-Prüfung und SEO-Prüfungen.

Die Tabelle dokumentiert lokale Ergebnisse mit Node.js 24.16.0. Ob ein veröffentlichter Commit auch unter den CI-Bedingungen bestanden hat, ist im [zugehörigen GitHub-Lauf](https://github.com/haskallalk-eng/voice-agent-phonbot/actions/workflows/ci.yml) anhand seiner Revision zu prüfen. Ein früherer grüner Lauf ist kein Nachweis für spätere Änderungen.

## Reproduzieren

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @vas/shared --filter @vas/voice-core build
corepack pnpm --filter @vas/api build
corepack pnpm --filter @vas/web typecheck
corepack pnpm -r --workspace-concurrency=1 run test --run
node --test scripts/check-secrets.test.mjs
node scripts/check-secrets.mjs
corepack pnpm supabase:migrations:check
corepack pnpm seo:generate
git diff --exit-code -- apps/web/public
corepack pnpm --filter @vas/web build
corepack pnpm seo:audit
```

Für die zusätzliche Datenbankprüfung zuerst die [isolierte PostgreSQL-Testumgebung](../apps/api/integration/README.md) einrichten und dann ausführen:

```sh
corepack pnpm --filter @vas/api test:integration
```

Die Suite verlangt eine ausdrückliche Testdatenbank-Konfiguration und überspringt fehlende Voraussetzungen nicht stillschweigend. Sie lädt keine Anwendungs-`.env` und verwendet keine produktive Datenbankadresse.

## Aussagekraft

Der [Review-Nachtrag](review-follow-up.md) ordnet Signatur- und JWT-Routentests, Verschlüsselungsgrenzen, Ereignis-Deduplizierung und Datenbanktests den jeweiligen Befunden zu. Der frühere Nachweis vom 22. Oktober enthielt 1.745 API-Tests; die obigen Zahlen stammen aus dem neuen vollständigen Lauf.

Diese Ergebnisse belegen automatisierte Prüfungen des Codes. Sie belegen **keinen vollständigen Live-Telefonietest**, keine gemessene Produktionslatenz, keine Anbieter-Abnahme und keine Funktionsprüfung des separaten GPT-Live-1-Stacks. Externe Telefonie, produktive Buchungen und Dienstkonfigurationen wurden nicht ausgeführt.

Der Zugangsdaten-Checker erkennt definierte Muster. Er ersetzt weder einen vollständigen Sicherheitsaudit noch den Nachweis einer Schlüsselrotation. Die Git-Historie ist nicht Teil dieses Checks. Die Historienbereinigung vom 23. Oktober ist ein separater Vorgang und kein Rotationsnachweis.

[Projektübersicht](../README.md) · [CI-Läufe](https://github.com/haskallalk-eng/voice-agent-phonbot/actions/workflows/ci.yml)
