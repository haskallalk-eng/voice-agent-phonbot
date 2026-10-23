# Secrets Rotation Runbook

Bei vermuteter Offenlegung betroffene Zugangsdaten und ihre Abhängigkeiten
ermitteln, die Umstellung koordinieren und alte Geheimnisse widerrufen. Neue
Werte gehören ausschließlich in den geschützten Secret-Speicher der bestätigten
Zielumgebung. Keine Schlüssel, Serverzugänge oder Verbindungszeichenfolgen in
Issues, Commits, Screenshots oder Prüfberichte aufnehmen.

## Abschlussnachweis

Entfernung aus dem aktuellen Quellcode, Bereinigung der Git-Historie und
Ungültigkeit eines alten Geheimnisses sind drei unterschiedliche Maßnahmen.
Ein inaktives Projekt oder ein sauberer Secret-Scan beweist keine Rotation.
Ein Abschluss benötigt je betroffenem Geheimnis:

- betroffenen Dienst und eine nicht geheime Schlüsselkennung,
- Datum und verantwortliche Person für Austausch und Widerruf,
- Anbieterbestätigung oder einen geeigneten Nachweis, dass der alte Zugang
  nicht mehr gültig ist,
- überprüfte abhängige Dienste, Ergebnis und verbleibende Einschränkungen.

Diese Nachweise privat aufbewahren; öffentlich reichen ein redigierter Status
und gegebenenfalls eine freigegebene Referenz. Niemals den alten oder neuen
Geheimwert als Nachweis veröffentlichen.

## Anbieterzugänge

Die aktuelle Rotationsfunktion des jeweiligen Anbieters verwenden. Wo möglich,
neuen Zugang bereitstellen, Verbraucher umstellen, Funktion prüfen und den alten
Zugang widerrufen. Bei aktiver Kompromittierung kann sofortiger Widerruf vor
Wiederherstellung des Dienstes erforderlich sein. Überlappung, Unterbrechung und
Auswirkungen müssen für den jeweiligen Dienst geplant werden.

| Dienst | Konfiguration und zu prüfende Abhängigkeiten |
|--------|---------------------------------------------|
| Stripe | `STRIPE_SECRET_KEY` und separat `STRIPE_WEBHOOK_SECRET`; API-Zugriff, Webhook-Prüfung und Invoice-Worker in der richtigen Test-/Live-Umgebung. |
| Twilio | `TWILIO_AUTH_TOKEN` und gegebenenfalls separate API-/SIP-Zugänge; ausgehende Anfragen und signierte Callbacks. Eine Account SID ist kein Ersatz für die Rotation eines Authentifizierungsgeheimnisses. |
| Retell | `RETELL_API_KEY`; API-Zugriff und eingehende Webhook-Signaturen. Der aktuelle [Verifier](../apps/api/src/retell-signature.ts) verwendet diesen Schlüssel und liest kein separates `RETELL_WEBHOOK_SECRET`. |
| OpenAI, Resend und weitere aktivierte Anbieter | Tatsächlich verwendete API-Schlüssel widerrufen und ersetzen; alle Verbraucher des jeweiligen Schlüssels prüfen. |
| PostgreSQL | Passwort der tatsächlich verwendeten Datenbankrolle ändern und geschützte `DATABASE_URL`-/Migrationskonfiguration konsistent aktualisieren. Eine Änderung von `POSTGRES_PASSWORD` in Compose ändert ein bestehendes Datenbankpasswort nicht. Bestehende Verbindungen separat berücksichtigen. |
| Google / Microsoft OAuth | Client-Geheimnisse nach Anbieterprozess wechseln; OAuth-Callback und Token-Erneuerung prüfen. Die Wirkung auf bestehende Grants und Refresh-Tokens prüfen, nicht pauschal eine automatische Abmeldung annehmen. |
| Redis | Tatsächliche Netzfreigaben und Authentifizierung prüfen. Die Root-Compose-Datei veröffentlicht keinen Redis-Hostport und konfiguriert derzeit kein Passwort. Eine Einführung oder Rotation muss Server und `REDIS_URL` gemeinsam umstellen. |

## Anwendungsschlüssel mit Zustandsabhängigkeiten

### Verschlüsselte Integrationsdaten

`ENCRYPTION_KEY` verschlüsselt gespeicherte Integrationsgeheimnisse mit
AES-256-GCM. Ein bloßer Austausch macht bestehende verschlüsselte Werte
unlesbar; [crypto.ts](../apps/api/src/crypto.ts) enthält keinen automatischen
Mehrschlüssel- oder Re-Encryption-Ablauf. Vor einem Wechsel entweder eine
kontrollierte Migration mit geprüftem Wiederherstellungsweg vorbereiten oder
betroffene Integrationen gezielt invalidieren und neu verbinden lassen. Zugriff
auf den alten Schlüssel während einer Migration ist ebenfalls zu schützen.

### Sitzungen und signierte URLs

`JWT_SECRET` signiert Access-JWTs und die Refresh-Cookies. Nach einem Wechsel
werden auch vorhandene Cookie-Signaturen abgelehnt, obwohl zugehörige
Refresh-Token-Datensätze weiterhin in der Datenbank liegen können. Bei einer
Kompromittierung die Sitzungssperrung und den Widerruf gespeicherter Tokens
ausdrücklich einplanen; ein Schlüsselwechsel löscht diese Datensätze nicht.

Retell-Tool-URLs verwenden `RETELL_TOOL_AUTH_SECRET` mit einem Fallback auf
`JWT_SECRET`. Ein Wechsel des wirksamen Schlüssels erfordert die koordinierte
Erneuerung und Prüfung der betroffenen Tool-URLs. Einen kompromittierten
JWT-Schlüssel lediglich unter dem separaten Variablennamen weiterzuverwenden
ist keine Rotation.

Weitere Abhängigkeiten sind `WEBHOOK_SIGNING_SECRET`, `OAUTH_STATE_SECRET` und
gegebenenfalls `CALENDAR_CHANGE_TOKEN_SECRET`. Prüfen, welche ausstehenden
Signaturen, Links, OAuth-Vorgänge oder Webhook-Verbraucher ein Wechsel ungültig
macht. Kein Schlüsselwechsel allein darf als Nachweis gelten, dass alle
abhängigen Integrationen bereits umgestellt sind.

## Ausrollen und prüfen

Den vom Betreiber bestätigten Zugang und Secret-Speicher verwenden; diese
öffentliche Anleitung enthält bewusst keine konkreten Infrastrukturadressen.
Nach der Änderung müssen die betroffenen Prozesse ihre neue Konfiguration
tatsächlich laden. Bei Compose liest ein einfacher Container-Neustart eine
geänderte `env_file` nicht neu ein; eine kontrollierte Neuerstellung der
betroffenen Container gehört zum vereinbarten Release-Verfahren.

Den [Deployment-Leitfaden](deployment.md) und bei einem Versionswechsel den
[Usage-Ledger-Cutover](usage-ledger-rollout.md) beachten. Das Deployment-Skript
kann Retell-Konfigurationen und die öffentliche Demo verändern; diese
Nebenwirkungen müssen bewusst eingeplant oder über die dokumentierten Schalter
ausgenommen werden. Anschließend Dienstbereitschaft, Signaturen und betroffene
Integrationen prüfen und den redigierten Abschlussnachweis festhalten.

## Vorbeugung

- Lokale `.env`-Dateien und Secret-Speicher aus Git heraushalten.
- Beispielkonfigurationen ausschließlich mit Platzhaltern pflegen.
- Geheimnisse nicht in Logs, Fehlermeldungen oder Telemetrie schreiben.
- Den redigierenden Repository-Secret-Check verwenden; ein Treffer wird ohne
  Geheimwert bearbeitet. Ein erfolgreicher Musterscan ist keine vollständige
  Sicherheitsprüfung oder Garantie für eine saubere Git-Historie.
