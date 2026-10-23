# Technischer Prüfnachweis – Phonbot

Stand: **22. Oktober 2026**. Prüfung in einem frischen lokalen Checkout mit Node.js 24.19.0 und pnpm 9.15.3.

Ausgangsstand: `f84679214ab8525bd52a43851959fe26e2758fa1`. Die Ergebnisse unten beziehen sich auf diesen Code plus die in diesem Commit enthaltenen Prüfverbesserungen.

## Ergebnisse

| Prüfung | Ergebnis |
| --- | --- |
| API-Testlauf | 1.745 Tests in 131 Dateien bestanden |
| Shared-Paket | 6 Tests bestanden |
| Voice-Core-Referenz | 2 Tests bestanden |
| Web-Paket | 2 Tests bestanden |
| Zugangsdaten-Checker | 4 Regressionstests bestanden; versionierte Dateien ohne Treffer der bekannten Muster |
| TypeScript | API und Web bestanden |
| Build | Shared, Voice Core, API und Web bestanden |
| Datenbankmigrationen | 6 Migrationsdateien formal geprüft; statische Own-KB-Prüfung bestanden |
| SEO-Artefakte | Reproduzierbar generiert; Audit mit 0 Warnungen und 0 Fehlern |

## Lokaler Prüfstand und laufende CI

Die Tabelle oben dokumentiert einen **lokalen Prüfstand vom 22. Oktober 2026**. Sie ist keine Aussage, dass jeder aktuelle CI-Lauf alle aufgeführten Prüfungen wiederholt.

Der [CI-Workflow](../.github/workflows/ci.yml) verwendet Node.js 22 und prüft API-Tests, API-/Web-Typen, den Zugangsdaten-Checker, die formale Migrationsprüfung sowie Shared-/Web-Builds und SEO-Artefakte. Der lokale Prüfstand oben wurde mit Node.js 24.19.0 erstellt.

Die zusätzlichen Shared-, Voice-Core- und Web-Tests, der API-/Voice-Core-Build und die statische Own-KB-Prüfung gehören zum dokumentierten lokalen Prüfstand; der verlinkte CI-Workflow erzwingt sie derzeit nicht. Für die Bewertung eines anderen Commits müssen diese Prüfungen erneut ausgeführt und mit dessen Revision dokumentiert werden.

## Reproduzieren

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @vas/shared --filter @vas/voice-core build
corepack pnpm --filter @vas/api exec vitest run
corepack pnpm --filter @vas/shared --filter @vas/voice-core --filter @vas/web exec vitest run
corepack pnpm --filter @vas/api typecheck
corepack pnpm --filter @vas/web typecheck
corepack pnpm --filter @vas/api build
corepack pnpm --filter @vas/web build
node --test scripts/check-secrets.test.mjs
node scripts/check-secrets.mjs
corepack pnpm supabase:migrations:check
corepack pnpm seo:generate
corepack pnpm seo:audit
```

## Behobene Prüflücken

- Ein URL-/PII-Test hing von einer echten DNS-Antwort für `example.com` ab. Die DNS-Antwort wird nun im Test kontrolliert. Zusätzliche Fälle prüfen, dass private Zieladressen und DNS-Ausfälle weiterhin blockiert werden. Die Schutzlogik der Anwendung wurde nicht gelockert.
- Der lokale Pre-Commit-Hook und CI verwenden einen gemeinsamen Zugangsdaten-Checker. Er nennt Datei, Zeile und Regel, gibt aber keine gefundenen Geheimnisse aus. Der Hook prüft den Git-Index, CI die versionierten Dateien.

## Aussagekraft

Diese Ergebnisse belegen automatisierte Tests und Builds des veröffentlichten Codes. Sie belegen **keinen vollständigen Live-Telefonietest**, keine gemessene Produktionslatenz und keine Funktionsprüfung des separaten GPT-Live-1-Stacks. Externe Anbieter, echte Anrufe, Live-Datenbanken und produktive Buchungen wurden nicht ausgeführt.

Der Zugangsdaten-Checker erkennt definierte Muster. Er ersetzt weder einen vollständigen Sicherheitsaudit noch den Nachweis einer Schlüsselrotation beim Anbieter. Die Git-Historie ist nicht Teil dieses Checks.

[Projektübersicht](../README.md) · [CI-Läufe](https://github.com/haskallalk-eng/voice-agent-phonbot/actions/workflows/ci.yml)
