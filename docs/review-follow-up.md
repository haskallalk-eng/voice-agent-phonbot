# Review-Nachtrag: überprüfbare Grenzen und Fehlerfälle

23. Oktober 2026. Nach einem unabhängigen automatisierten Review wurden die folgenden Code- und Testbefunde korrigiert. Dies ist kein menschliches Teamreview und kein Nachweis eines produktiven Betriebs.

## Signaturen und Webhook-Routen

Die [Retell-Prüfung](../apps/api/src/retell-signature.ts) lehnt nicht-stringförmige Header, unvollständige oder überlange Hex-Digests und ungültige Zeitstempel ab. Die 39 [Verifier-Tests](../apps/api/src/__tests__/webhook-signature.test.ts) rufen die tatsächliche Funktion auf: einschließlich der Fünf-Minuten-Grenzen, manipuliertem Raw Body, falschem Schlüssel, fehlendem Raw Body sowie den Kombinationen aus Produktionsmodus und Entwicklungsfreigabe.

Die [Stripe-Tests](../apps/api/src/__tests__/stripe-webhook-pause-resume.test.ts) senden echte signierte Testrequests durch Fastify und die Stripe-Signaturprüfung. Abgelaufene Signaturen, falsche Schlüssel und nachträglich veränderte Bodies erreichen keine Datenbankeffekte. Externe Dienste und die fachliche Datenbank bleiben in diesen Routentests simuliert.

Für `call_started` muss die [Retell-Route](../apps/api/src/retell-webhooks.ts) jetzt einen dauerhaften Claim für Call-ID und Ereignistyp erhalten, bevor sie Weiterleitungsprüfung oder Kunden-Webhooks anstößt. Fehlende Call-ID, fehlende Datenbank oder Claim-Fehler erlauben diese Effekte nicht. Die [Routentests](../apps/api/src/__tests__/retell-retention-webhook.test.ts) prüfen aktuelle und Legacy-Signaturen, wiederholte Ereignisse, konkurrierende Gewinner/Verlierer und serverseitige Mandantenzuordnung. Ihr Claim-Verhalten wird simuliert; das ist kein echter Datenbank-Konkurrenztest für diese Route.

**Grenzen:** Legacy-Signaturen enthalten keinen Zeitstempel. Claims werden durch die bestehende Aufbewahrungsregel nach 90 Tagen bereinigt; danach ist aus diesem Mechanismus kein unbegrenzter Replay-Schutz ableitbar. Der neue Claim verhindert doppelte Zustellversuche innerhalb seiner Lebensdauer, garantiert aber keine Zustellung: Ein Absturz nach dem Claim kann das Ereignis verlieren. Für verlässliche Wiederholungszustellung wäre ein eigenes Outbox-Verfahren erforderlich.

## Verschlüsselung und Admin-Zugang

Das [Kryptomodul](../apps/api/src/crypto.ts) akzeptiert nur das von `encrypt` erzeugte Format mit 12-Byte-IV, vollständigem 16-Byte-GCM-Tag und ganzen Hex-Bytes. 24 [Tests](../apps/api/src/__tests__/crypto.test.ts) prüfen unter anderem Produktionsstart ohne gültigen Schlüssel, Manipulationen und falsche Schlüssel. Vorhandene gültige Chiffrate bleiben kompatibel. Legacy-Klartext bleibt weiterhin lesbar; eine Migration alter Bestände oder Schlüsselrotation wird damit nicht nachgewiesen.

[Admin- und Learning-Routen](../apps/api/src/admin-auth.ts) verwenden denselben Guard. Er verlangt ein gültiges JWT, `admin === true` und die Audience `phonbot:admin`. 20 [Routentests](../apps/api/src/__tests__/admin-auth.test.ts) prüfen beide tatsächlichen Routengruppen mit echten JWTs, einschließlich Ablauf, ungültiger Signatur, falscher Audience und irreführend wahrheitswertigen Admin-Claims. Fachliche Integrationen sind dabei simuliert.

## Minutenreservierung mit echter Datenbank prüfen

Der bisher falsch benannte Test für einen fehlenden Pool verwendete einen vorhandenen Pool. Die [Unit-Tests](../apps/api/src/__tests__/usage.test.ts) laden jetzt tatsächlich `pool = null` und prüfen die Ablehnung ohne Datenbankzugriff. Weitere Fälle prüfen Datenbankfehler.

Die neue [PostgreSQL-Suite](../apps/api/integration/README.md) führt die tatsächlichen Transaktionen aus `usage.ts` über getrennte Datenbankverbindungen aus. Sie beobachtet die wartende Zeilensperre und prüft Zulassungsgrenze, Rollback, bezahlte Mehrnutzung, gesperrte Abonnements, Mandantenzuordnung und fehlende Organisationen. Nach der unten beschriebenen Ledger-Korrektur bestanden 32 Fälle lokal mit PostgreSQL 16.15. Eine ausschließlich im Test erstellte Mutation ohne `FOR UPDATE` ließ den gezielt ausgewählten Freitarif-Konkurrenztest fehlschlagen; die anderen Fälle wurden für diesen Mutationslauf ausgefiltert. Die Produktions-SQL wurde dafür nicht geändert.

## Wiederholbare Prüfungen und offene Nachweise

Das anschließende Nachreview fand einen weiteren Abrechnungsfehler: Oberhalb des Tariflimits führten fünf reservierte Minuten bei tatsächlichen zwei/fünf/acht Minuten zu Rechnungsaufrufen für null/null/drei Minuten. Der Folgefix trennt gehaltene Kapazität vom tatsächlichen Verbrauch, ordnet Reservierungen einer Organisation und einem Anruf zu und verarbeitet einen Anrufabschluss nur einmal. Die PostgreSQL-Tests prüfen jetzt die vollständigen zwei/fünf/acht Minuten und die zugehörigen Cent-Beträge der gespeicherten Rechnungsaufträge, auch bei weiteren offenen Reservierungen.

Verbrauch, Freigabe eines nachgewiesenen Holds und Rechnungsauftrag werden gemeinsam in einer Datenbanktransaktion gespeichert. Der vorhandene Hintergrundprozess übermittelt den dauerhaften Auftrag anschließend an den Zahlungsanbieter. Bei Retell läuft dieser idempotente Abgleich vor dem separaten Ereignis-Claim für nachgelagerte Effekte. Ein früherer Prozessabbruch nach diesem Claim verhindert deshalb keinen erneuten Abrechnungsversuch. Fehlende Dauer wird nicht als null angenommen und nicht erfolgreich bestätigt; signierte Zeitstempel oder eine signierte Dauer liefern die Messung.

Ein unreservierter Inbound-Anruf zieht keine erfundenen fünf Minuten mehr ab. Web- und Twilio-Anrufpfade prüfen ihre Voraussetzungen vor der Reservierung, binden die Anbieter-Call-ID und unterscheiden eindeutig abgelehnte Anrufstarts von unklaren Provider-Ergebnissen. Unklare Ergebnisse behalten ihren Hold zur späteren Prüfung; ein automatisches Freigeben nach Zeitablauf wäre kein Nachweis, dass kein Anruf stattfand.

**Rolloutvoraussetzung:** Die additive Migration verändert die Bedeutung der Verbrauchsverwaltung. Migration und Startup aktivieren die neue Semantik deshalb nicht automatisch. Alte Instanzen müssen angehalten, laufende Anrufe abgeschlossen und historische Verbrauchswerte abgeglichen werden, bevor der Cutover ausdrücklich aktiviert wird. Die [Rolloutanleitung](usage-ledger-rollout.md) erklärt auch alte Callback-URLs, Rechnungswiederholungen und ausstehende Holds. Keine dieser produktiven Maßnahmen wurde durch den lokalen Prüflauf ausgeführt.

Der [CI-Workflow](../.github/workflows/ci.yml) enthält nun die Tests aller vier Workspace-Pakete, Builds für Shared, Voice Core, API und Web, Typprüfungen, isolierte PostgreSQL-Tests, Zugangsdaten-Checker, Migrationen, statische Own-KB-Prüfung und SEO-Prüfungen. Der [datierte lokale Prüfnachweis](portfolio-validation.md) trennt diese Ergebnisse vom jeweiligen GitHub-CI-Lauf.

Weiterhin separat erforderlich sind belastbare Live-Telefonie- und Latenzmessungen, Anbieter-Konfiguration und Schlüsselrotation sowie freigegebene Kundenabnahmen. Eine Historienbereinigung oder ein grüner Muster-Scanner ersetzt diese Nachweise nicht. Historische Issue-Beschreibungen sollten anhand ihres konkreten Abschlussnachweises bewertet werden; dieser Patch erklärt keine nicht geprüften Betriebsprobleme für erledigt.
