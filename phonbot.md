# Phonbot — Planer, Worker und Backoffice

Stand: 2026-09-21. Koordinationsrevision: 1.

## Auftrag und Status

Der Nutzer hat einen separaten Jev-/Stabilitätsplan sowie eine Worker- und eine Backoffice-Aufgabe über diese Datei angefordert. Der bisherige Chat übernimmt die Planer-Rolle. Der Worker übernimmt zunächst die unabhängige Umsetzbarkeitsprüfung, später einzeln freigegebene Umsetzungspakete. Das Backoffice organisiert vorerst interne Testnachweise, Kosten, Dokumentation und offene Punkte; Kundensupport ist nicht freigegeben.

Aktiver separater Plan: [`plans/2026-09-21-jev-audio-stabilitaet.md`](plans/2026-09-21-jev-audio-stabilitaet.md).

**Aktuell freigegeben:** Recherche, Planung, Dokumentation und lesendes Review. **Nicht durch diesen Auftrag freigegeben:** Codefix, Modellwechsel, Deployment, Neustart, Anruf/SMS, neue Zugangsdaten oder Abrechnung. Historische Wünsche nicht als automatische neue Freigabe behandeln.

Das alte `PLANS.md` bleibt unverändert. `AGENTS.md` und dessen Schutzregeln gelten weiter. Dieser vom Nutzer ausdrücklich angeforderte Zusatzplan priorisiert nur die neue Arbeit. Bei Konflikten den konkreten Widerspruch melden, nicht eigenmächtig Grenzen lockern.

## Wichtiger Quellstand-Hinweis

Dieser GitHub-Zweig enthält eine **sanitisierte Dokumentübergabe**, nicht den vollständigen derzeitigen Implementierungsstand. Wesentliche aktuelle Änderungen liegen im bestehenden lokalen Checkout. Keine Planungsbranch deployen, kein Reset/Checkout zur Angleichung an GitHub, keine fremden Änderungen zurücksetzen. Den lokalen Pfad erhält der zweite Chat in seinem Startauftrag, nicht in diesem öffentlichen Dokument.

Aktuell bekannte Lage: technische Audioeingangs-Abschaltung im letzten untersuchten Telefonversuch, kein modellseitiges Auflegen; Pufferüberlauf wahrscheinlich, konkrete Unterursache noch unbewiesen. Jev von TypeSafe ist ein Entscheidungsmodell und Kandidat für optionale lesende Such-/Rechercheentscheidungen, kein Ersatz für Gesprächsmodell oder Audiostabilität.

## Zuständigkeit und Übergabeprotokoll

- **Planer:** besitzt Ziel, Prioritäten, diesen separaten Plan, Freigabekriterien und Reviewentscheidungen. Keine laufenden Implementierungsdateien parallel bearbeiten.
- **Umsetzer:** prüft tatsächlichen Quellstand, dokumentiert Befunde, schlägt minimale Dateiänderungen und Tests vor; implementiert erst nach Nutzerfreigabe. Nicht allein im Checkout; Änderungen anderer erhalten.
- **Backoffice:** besitzt ausschließlich seinen Abschnitt unten: konsistente Statusübersicht, Test-/Evidenzlücken, offene Zugangs-/Budgetentscheidungen, Kostenannahmen und Fristen. Keine Quellcodeänderungen, Deployments, Kundennachrichten, Tickets, SMS oder Kontozugriffe. Keinen dauerhaft laufenden Monitor aus der Rollenbezeichnung ableiten.
- **Gemeinsame Datei:** vor jeder Änderung erneut lesen. Änderungen klein halten, nur eigenen Abschnitt ergänzen. Bei abweichender Revision oder überlappender Bearbeitung stoppen und abstimmen; keine vollständige Datei aus altem Stand überschreiben.
- **GitHub:** nur bewusst freigegebene, sanitisierte Doku veröffentlichen. Reine öffentliche Dokumentationskopie; lokaler Quellstand und private Nachweise bleiben getrennt. Kein automatisches Pushen sämtlicher Änderungen.
- **Berichte:** Datum, Paket-ID, Quelle/Datei, Änderungsvorschlag, A/B-Nachweis, bestandene und fehlgeschlagene Tests, Restunsicherheit, nächster Schritt. Eine Planerbewertung ersetzt weder Nutzereinwilligung noch reale Betriebsprüfung.
- **Kommunikation:** Datei ist dauerhafte Übergabe, kein automatisches Nachrichtensystem. Der aktive Chat liest sie bei Arbeitsbeginn und vor Abschluss; eine Aufgabe wird nur durch ausdrücklichen Auftrag oder App-Nachricht gestartet. Keine behauptete permanente Hintergrundüberwachung.

Nie veröffentlichen: API-Schlüssel, private Telefonnummern, Anruftexte, Audio, Kunden-/Anruf-IDs, private Serveradressen, SSH-Befehle, Betriebsziele oder unredigierte Logs. Allgemeine technische Befunde, öffentliche Quellen und synthetische Beispiele genügen hier.

## Paketliste

| ID | Arbeit | Status | Nächster Nachweis |
| --- | --- | --- | --- |
| P0-A | Audiofehler differenzieren und post-admission A/B reproduzieren | REVIEW ANGEFORDERT | minimaler reproduzierbarer Runtime-Test |
| P0-B | Begrenzte Takt-/Queue-Koordination | NICHT FREIGEGEBEN | A/B, Bilanz, Start-/Aktionsregressionen |
| P1 | Werkzeug-/Suchfehler getrennt messbar machen | GEPLANT | deutsches gelabeltes Szenarioset |
| P2 | Jev-Adapter nur offline/shadow | GEPLANT, KEIN ZUGANG GEPRÜFT | API-/Daten-/Budgetfreigabe und unabhängiger Vergleich |
| P3 | Optionaler lesender Jev-Pfad | NICHT FREIGEGEBEN | Vorteil ohne Qualitäts-/Latenzverlust, Rollback |

## Planer-Übergabe 001

Status: bereit für unabhängiges lesendes Review. Vorrang hat der technische Audiofehler. Die Modellrecherche ist dokumentiert; Herstellerangaben sind keine eigenen Messungen. Stimme, Gesprächsmodell und bisher gute Beratungsführung bewahren.

Auftrag an den zweiten Chat: lies lokalen `AGENTS.md`, neuesten relevanten Stand in `PLANS.md`, diesen Zusatzplan und die betroffenen Audio-Dateien. Prüfe insbesondere die 13-Frames-/fälliger-Takt-Reproduktion und ob eine vorgeschlagene Lösung den Rückstau nur in den SDK-Puffer verschieben würde. Ergänze unten Review 001 mit konkretem minimalem Test-/Änderungsumfang und offenen Fragen. Keine Implementierung, kein Serverzugriff und kein Provideraufruf in diesem ersten Review.

## Umsetzer-Review 001

Ausstehend. Diesen Abschnitt besitzt der zweite Chat. Nach dem Review mit Befunden und dem kleinsten empfohlenen nächsten Paket ersetzen; keine privaten Belege kopieren.

## Backoffice-Review 001

Ausstehend. Diesen Abschnitt besitzt die Backoffice-Aufgabe. Erster Auftrag: den neuen Plan auf Status-, Mess- und Freigabelücken prüfen; eine kurze Liste mit Verantwortlichem, benötigtem Nachweis und nächstem Schritt ergänzen. Historische Testerfolge nicht mit behobenem aktuellen Telefonfehler gleichsetzen. Keine privaten Anrufdaten oder Betriebsziele veröffentlichen. Fristen ohne Erneuerung als offen markieren. Nur diesen Abschnitt bearbeiten und davor die ganze aktuelle Datei erneut lesen.
