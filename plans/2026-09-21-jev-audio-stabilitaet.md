# Phonbot: Audio stabilisieren, Jev gezielt evaluieren

Stand: 21. September 2026. Status: **Planung, keine Implementierungs- oder Livefreigabe.**

Dieser separate Plan wurde ausdrücklich vom Nutzer angefordert. Er ersetzt weder die Historie in `PLANS.md` noch die Schutzregeln in `AGENTS.md`. Die Zusammenarbeit zwischen Planer und Umsetzung läuft über [`../phonbot.md`](../phonbot.md). Das bestehende `PLANS.md` bleibt unverändert.

## 1. Entscheidung in einem Satz

Zuerst den technischen Gesprächsabbruch isoliert reparieren; danach Jev als optionalen Entscheider für lesende Recherche-/Suchwege und Trefferbewertung gegen den bestehenden Backendpfad testen. GPT-Live bleibt Gesprächsführer. Ein Modellwechsel repariert keinen Audiotransport.

Erfolg bedeutet verständliche, neutrale Produktberatung mit funktionierenden Werkzeugen, stabile Gespräche, gute gemessene Latenz und tragfähige Gesamtkosten bei angestrebten 0,10 EUR Nettoverkaufspreis pro Minute. Kein Versprechen von Perfektion oder verlustfreiem Modelltausch ohne Messung.

## 2. Gesicherter Ausgangsbefund

Im untersuchten menschlichen Telefonversuch endete das Gespräch nach ungefähr 78 Sekunden mit `LIVE_INPUT_FAILED` / `input_failed`. Es gab **keinen** Auflegevorschlag und **keine** EndCall-Anforderung. Der Worker wurde nicht neu gestartet.

Der Audioeingang erreichte 240 ms Pufferfüllung, genau die konfigurierte Grenze. Der Catch-Block verwirft die ursprüngliche Unterursache. Ein Überlauf durch gebündelte Audioanlieferung beziehungsweise verzögerten Audiotakt ist daher die stärkste Hypothese, nicht der bewiesene konkrete Auslöser. Die lokale Queue nimmt zwölf 20-ms-Frames an und lehnt einen dreizehnten ab.

Im selben Versuch: keine Backendfehler, Anfragen maximal 21.608 Bytes bei 32-KB-Grenze, keine ausgeführte Webrecherche. Das Gespräch endete während einer Antwort. Deshalb weder einen Tokenlimitfehler noch eine bewusst verweigerte Recherche oder ein falsches EndCall als Ursache behaupten. Der gespeicherte Text besteht aus Erkennungsfragmenten, nicht aus beweiskräftigem Originalaudio.

Aktueller lokaler Kandidat: GPT-Live-1 als Sprachmodell, GPT-5.6-Terra als Wissens-/Werkzeugbackend, bestehende Stimme und Beratungsführung. Öffentlicher Shopkatalog, fokussierte Detailsuche, begrenzte Wella-/KYO-Recherche und separat geprüfte Aktionsvorschläge existieren. Universelle Webrecherche, beliebige Weiterleitungen und Ticket-Erstellung sind nicht damit belegt.

Die aktuelle Implementierung enthält wesentliche lokale, noch nicht veröffentlichte Änderungen. **Der neue GitHub-Planungszweig ist kein Abbild der aktiven Software und keine Deploymentquelle.** Arbeitsverzeichnis und aktuelle Betriebsnachweise ausschließlich aus der lokalen Übergabe beziehen. Keine privaten Anruftexte, Anruferdaten, Zugangsdaten oder Betriebsziele hier veröffentlichen.

## 3. Jev: recherchierte Eigenschaften und Grenzen

Jev ist TypeSafes seit 15. September öffentlich angekündigtes System-One-Modell. Der Hersteller nennt 70–500 ms für eigene Messungen, überwiegend von der US-Westküste. Das ist kein Nachweis für unsere deutsche Telefonlatenz. Seine Workflow-Vergleiche sind herstellereigene Benchmarks, keine unabhängige Garantie für bessere Phonbot-Beratung. [Launch und Benchmark-Einordnung](https://typesafe.ai/blog/introducing-system-one-models-and-jev)

Das Modell bewertet übergebenen Zustand mit vordefinierten Fragen. `Choice` wählt eine Option, `Score` bewertet eine Skala, `Noul` liefert einen Wert für eine Ja/Nein-Frage. Es formuliert keine freie Antwort und führt keine Browsersuche aus. Mehrere Fragen dürfen unabhängig denselben Zustand auswerten. [Primitiven](https://docs.typesafe.ai/introduction)

Die Modelldokumentation nennt `jev-1.13.0`; `jev-latest` und `jev-preview` zeigen derzeit darauf. Für einen reproduzierbaren Test die Version pinnen und die zurückgemeldete Modellkennung prüfen. Jev verarbeitet Text, kein Audio. Englisch ist die stärkste Trainingssprache; deutsche Umgangssprache und ASR-Fehler brauchen eigene Tests. Dokumentierte Grenzen: 64k Tokens insgesamt, 32k für Zustand plus längste Frage; dynamische Ratenlimits sind keine zugesicherte Kontokapazität. [Modelle](https://docs.typesafe.ai/models)

`confidence` bei Choice/Score ist aus der Wahrscheinlichkeitsverteilung abgeleitet, nicht die empirisch bewiesene Fehlerfreiheit unserer Anwendung. Noul hat kein separates Confidence-Feld. Schwellenwerte erst auf deutschen, unabhängig beschrifteten Beispielen bestimmen. Ein formal gültiger Auswahlwert kann inhaltlich falsch sein. [Confidence](https://docs.typesafe.ai/confidence)

TypeSafe dokumentiert selbst Schwächen bei indirekten beziehungsweise negierten Formulierungen, Zahlen, Datumsvergleichen, ablenkendem Kontext und manipulierendem Inhalt im Zustand. Separate Gegenfragen müssen nicht logisch komplementäre Werte liefern. Preise, Bestandszahlen, Fristen und harte Schutzregeln deshalb nicht durch Jev berechnen oder überschreiben lassen. [Bekannte Grenzen von Jev 1.13](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

Die Datenschutzerklärung beschreibt US-Verarbeitung und keine Nutzung der Eingaben zum Modelltraining, aber keine pauschale Nullspeicherung für jedes Konto. Vor echten Gesprächsdaten müssen passende Vertrags-/Datenschutzbedingungen, Speicherfristen und Zugriffsfreigabe geklärt sein. Zunächst ausschließlich synthetische, personenfreie Testfälle und öffentliche Produktinformationen. [Datenschutz](https://typesafe.ai/legal/privacy-policy)

Die Dokumentation bietet Zero Data Retention ausdrücklich für Enterprise-Kunden auf Anfrage an; das nicht als Kontostandard annehmen. [Legal/ZDR](https://docs.typesafe.ai/legal)

## 4. So würde die Anbindung aussehen

- Eigener serverseitiger TypeSafe-Zugang; kein OpenAI-Schlüssel und keine Codex-Modellauswahl ersetzen diesen Zugang.
- Dokumentierter HTTP-Aufruf: `POST https://api.typesafe.ai/v1/systemone`, Bearer-Authentifizierung, JSON mit `model`, `state`, `questions`. Antwort enthält `model`, `answers`, `usage`. [API](https://docs.typesafe.ai/api)
- `TYPESAFE_API_KEY` nur aus privater Konfiguration. Kein Schlüssel in GitHub, Chat, Browsercode oder Trace. Kontoerstellung, Zahlung und API-Test sind in diesem Planungsschritt nicht durchgeführt.
- Native TypeScript-HTTP-Anbindung mit vorhandener Fetch-/Abort-Infrastruktur bevorzugt: kein zusätzlicher Python-Dienst. Der Anbieter dokumentiert auch Client-SDKs; deren automatische Wiederholungen dürfen nicht unbemerkt die Telefondeadline verlängern. [SDK-Übersicht](https://docs.typesafe.ai/sdk)
- Konkreter SDK-Fallstrick: 10 Sekunden Timeout pro Versuch ohne Gesamtbudget; Debug-Logging enthält unredigierte Bodies. Unabhängige kurze Gesamtdeadline und keine Body-Logs sind Pflicht. [Client-Konfiguration](https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig)
- Strikte Antwortprüfung: erwartete Frage-IDs und Typen, erlaubte Optionen, endliche Werte, Wahrscheinlichkeitsverteilung, Modellkennung und begrenzte Antwortgröße. Ungültig, verspätet oder falsche Generation bedeutet ignorieren und auf bestehenden Pfad zurückfallen; niemals Gespräch beenden.

Geplante Schnittstelle, ausdrücklich **keine behauptete bestehende API im Repository**:

```text
DecisionProvider.evaluate(redactedState, questions, deadline, abortSignal)
  -> typedDecision | unavailable

Lokaler Kontext + aktuelle Belege
  ├─ bestehender Gesprächs-/Terra-Pfad ──> belegte Antwort für GPT-Live
  └─ Jev im Schatten ──> Vergleichsmessung, zunächst ohne Verhaltenseinfluss
```

Geeignete atomare Fragen: Braucht die Anfrage Shopdaten, Herstellerinformationen oder eine Klärung? Welche vorhandenen Kandidaten passen zu ausdrücklich genannten Merkmalen? Beantwortet ein konkreter Quellenausschnitt die Zubehörfrage? Jev darf nur IDs vorgelegter Kandidaten wählen; freie Suchbegriffe/URLs und neue Fakten entstehen dadurch nicht.

Das offizielle Function-Calling-Beispiel wählt Funktionen und Argumente aus vorgegebenen Mengen. Es ersetzt keinen freien Query-Generator. [Function Calling](https://docs.typesafe.ai/cookbooks/function_calling)

Mehrfachanliegen nicht in eine einzige exklusive Kategorie pressen: getrennte Bedarfsfragen plus `unknown`/`none`/Mehrfachpfad. Ein Caller kann gleichzeitig Anwendung und Sortiment fragen. Kein künstlicher Gesprächsbaum aus Jev-Klassen; GPT-Live entscheidet weiterhin Formulierung, Rückfrage und Gesprächsführung.

## 5. Arbeitspakete in verbindlicher Reihenfolge

### P0-A — Abbruch messbar machen und reproduzieren

Zielbereiche: `apps/voice-agent/src/live-runtime.ts`, `live-audio.ts` und zugehörige Tests.

1. Lesefehler, Formatfehler, PCM-Fehler, VAD-Ausnahme und Queueüberlauf als feste technische Kategorien unterscheiden. Nur Zahlen ergänzen: Queue vor Fehler, Framegröße, Burstlänge, Taktverspätung. Keine rohen Ausnahmetexte oder Audioinhalte.
2. Gleiche Eingangsdaten und gleiche virtuelle Zeit gegen eingefrorenes A und neues B. Fehlgeschlagenes A aufbewahren. Eine reine Queue-Demo nicht als originalgetreue Wiedergabe des Telefonanrufs bezeichnen.
3. Test für gebündelte Frames **nach** Gesprächsfreigabe ergänzen; der schon vorhandene Starttest reicht nicht.

### P0-B — Begrenzte Audiotakt-Koordination

Prüfen und implementieren, ob bereits zeitlich fällige Frames vor weiterer Queuefüllung über denselben absoluten Takt verarbeitet werden können. Keine doppelte Zeitbuchung, kein Senden vor Fälligkeit, kein unbegrenztes Aufholen. Ein bloß wartender Reader darf Rückstau nicht unsichtbar ins SDK verschieben. Zunächst weder 240-ms-Grenze erhöhen noch Sprache still verwerfen.

V22-Startverhalten erhalten: Audiotakt während des Hinweises; vor Freigabe empfangenen Ton nicht später nachspielen. Unterbrechungen und vollständige Aktionsbelege müssen konsistent bleiben. Echte irreversible Überlast darf kontrolliert fehlschlagen, muss aber von einem tolerierbaren Burst unterscheidbar sein.

| Regression | Erforderlicher Nachweis |
| --- | --- |
| 13 lesbare 20-ms-Frames, mindestens eines bereits fällig | A reproduziert Überlauf; B überträgt eins, hält zwölf, keine Lücke/Doppelung |
| Burst ohne fällige Zeit oder über Nachholbudget | Eindeutige begrenzte Überlast, kein unbegrenzter Speicher |
| 15 Minuten virtueller Jitter, variable Framepakete | Reihenfolge und PCM-Bilanz korrekt, kein wachsender Drift |
| 400-ms-Hinweisverzögerung beim Start | Bestehender Startfix bleibt bestanden |
| Readerfehler, falsches Format, EOF, Teilnehmerabbruch | Getrennte Ursachen und idempotenter Abschluss |
| Neue Sprache bei SMS-/Auflegeprüfung | Veraltete Aktion ungültig; Audiolücke autorisiert nichts |

Freigabe: fokussierte A/B-Tests, Typprüfung, native Linux-Regressionen, neue unveränderliche Version und vorhandene Betriebs-/Rollbackprüfungen; danach menschlicher Telefonversuch. Keine automatische Livefreigabe aus diesem Plan. Ein RTC-Erfolg allein beweist keinen behobenen SIP-Fehler.

### P1 — Such- und Recherchequalität unabhängig von Jev absichern

Vor einem neuen Modell ein festes deutsches Testset bilden: Brand-ASR-Varianten (Black Professional Line), unbekannte Marke, mehrere neutrale Optionen, Privatkunde versus ausdrücklich gewünschte Profimarke, Zubehör für Dauerwelle, vorhandener versus fehlender Quellenausschnitt, Produktwechsel, Negation, Unterbrechung und Doppelfrage.

Bei jeder Wissensfrage messen: erkannter Bedarf → tatsächlich aufgerufenes Werkzeug → Treffer vor Kürzung → übergebene Belege → gesprochene Aussage. Dadurch sind Suchfehler, Werkzeugwahl, Belegverlust und Formulierungsfehler getrennt sichtbar. Nicht nur HTTP-Erfolg oder gültiges JSON zählen.

Webdaten ergänzen öffentliche Herstellerinformationen. Shoppreis, Sortiment, Verfügbarkeit und Kaufbedingungen bleiben ausschließlich aus aktuellen Shopbelegen. Keine chemische Kompatibilität, Eigenmarke oder Eignung erfinden. Erweiterte Herstellerabdeckung ist ein separates, geprüftes Quellenpaket, kein unbegrenzter URL-Zugriff.

### P2 — Optionaler Jev-Adapter und Schattenvergleich

Neue Komponenten nach Prüfung der aktuellen Architektur, beispielsweise `decision-provider.ts`, `jev-decision-provider.ts`, `decision-evaluation.ts` samt Tests. Businesslogik im neutralen Kern; HTTP-Schema nur im Adapter. Nicht Jev in den bestehenden OpenAI-Modellnamen-Parser hineinquetschen.

Vorgeschlagene Modi: `off` (Standard), `shadow`, später `read_only_assist`. Sie sind Planung, noch keine vorhandenen Flags. Im Schatten keine Änderung von Antworten, Werkzeugaufrufen, Gedächtnis, SMS, Auflegen oder Audio. Zuerst offline mit synthetischen Fällen; echter Schattenverkehr erst nach Datenschutz-/Nutzerfreigabe.

Startbudgets als zu prüfende Designvorgaben: höchstens eine gebündelte Jev-Abfrage je relevanter Generation, maximal vier atomare Fragen, maximal 8 KiB Anfrage und 4 KiB Antwort, 600 ms Gesamtdeadline, keine In-Call-Wiederholung, höchstens ein aktiver Jev-Aufruf pro Call, Kosten-/Parallelitätslimit serverseitig. Die 32-KB-Gesamtgrenze des bisherigen Backends bleibt erhalten. Überschreitungen führen zum bestehenden Pfad, nicht zu stiller Kürzung von Negationen, Produktidentität oder Bedingungen.

Keine gesamte Datenbank und kein vollständiges Gespräch senden. Kleinste relevante, zweckgebunden redigierte Äußerung, letzte relevante Frage, kompakte Wünsche und aktuelle Beleg-/Kandidaten-IDs. Quellendaten sind untrusted, keine Instruktionen. Vorläufige Erkennungsfragmente höchstens für nicht autorisierendes, verwerfbares Prefetching; niemals als bestätigte Aktion oder endgültige Kundenauswahl.

### P3 — Nur bewiesene lesende Abkürzungen aktivieren

Erst bei messbarem Vorteil darf Jev bestimmte bisherige Backend-Entscheidungsarbeit ersetzen, etwa einen zusätzlichen Suchentscheid. Es darf nicht lediglich seriell vor denselben unveränderten Terra-Aufruf gesetzt werden. Bekannte einfache Anfragen bleiben ohne zusätzlichen Netzwerkaufruf.

Timeout, geringe Sicherheit, widersprüchliche Wünsche oder unbekannter Fall gehen an den bestehenden generativen Backendpfad; keine starre Klärungsschleife. Ranking nur für eine bereits hinreichend breite, restriktionsgeprüfte Auswahl. Relevante Marken-/Preisspannen dürfen nicht durch frühes Top-k verschwinden. Forschung braucht weiterhin tatsächliche Such-/Fetch-Werkzeuge und Quellennachweise; Jev ist weder Browser noch Faktenautorität.

SMS und Auflegen bleiben ausschließlich beim bestehenden Policy-/Aktionsgateway mit unabhängiger Bestätigung, aktueller Generation, Identitätsbindung und Ausgabe-/Abbruchprüfung. Jev ersetzt weder diesen Schutz noch die akustische Turn-Erkennung.

## 6. A/B-Entscheidung und Abbruchkriterien

Getrennte Vergleiche, jeweils auf identischem Audio-/Backendstand:

- A0/B0: alter/neuer Audiopfad, **kein** Jev, gleiche Zeit-/Audiodaten.
- A1/B1: bisherige Entscheidungen gegen Jev im Schatten, gleiches Wissen, gleiche Fragen und Kostenbedingungen.
- A2/B2: erst später aktive lesende Abkürzung gegen reparierten Baselinepfad. Nicht gleichzeitig Stimme, Gesprächsmodell oder Suchindex austauschen.

Mindestens 120 synthetische, deutschsprachige Fälle über mindestens 30 relevante Anliegen; 40 Kalibrierungsfälle und 80 zurückgehaltene Prüffälle vor Tuning trennen. Drei Durchläufe zur Varianz sind keine 240 unabhängigen Fälle. Kritische Negations-, ASR-, Quellen-, Mehrfachanliegen- und Aktionsfälle separat ausweisen. Jev nicht als eigenen Wahrheitsrichter verwenden: Quellenlabels plus unabhängige Bewertung und menschliche Stichprobe.

Messen: richtige Werkzeugauswahl, Recall@5 auf gelabelten Retrievalfällen, unbelegte Behauptungen, unnötige Rückfragen, vollständige Antwort auf das Anliegen, Kalibrierung/Fehlentscheidungen nach Sicherheit, Timeoutquote, tatsächliche Tokens/Kosten, abgebrochene/überholte Arbeit. Deutsche Leistung darf nicht aus englischen Herstellerwerten abgeleitet werden.

Promotion nur bei null neuen Sicherheits-/Berechtigungsfehlern, null falschen Auflege-/SMS-Aktionen, keinen offenen kritischen Beratungsfehlern und mindestens Baselinequalität; bestehende strengere Repo-Gates bleiben gültig. Für beantwortbare Prüffälle Ziel mindestens 98 Prozent, Retrieval Recall@5 mindestens 90 Prozent. Kleine Stichproben belegen keine allgemeine Fehlerfreiheit.

Telefonlatenz messen vom Ende der Nutzersprache bis zur ersten sinnvollen Antwort; reine Füllsätze zählen nicht. Normale p50/p90/p95-Ziele aus `AGENTS.md` bleiben 500/700/800 ms. Backend-HTTP-Dauer getrennt von akustischer Latenz, Recherche-Endantwort und Barge-in erfassen. Vor größerer Freigabe kein statistisch relevantes Qualitäts-/Latenzminus; falls Daten dafür nicht reichen, bleibt Jev im Test. Ein 600-ms-Adapterbudget ist kein behauptetes 800-ms-End-to-End-Ergebnis.

Bei Regression Jev deaktivieren, geprüften Baselinepfad nutzen; keine stillschweigende Modelländerung. Bei Audio-/Aktionsregression keinen Kandidaten freigeben. Bereits laufende Gespräche bei jedem später autorisierten Rollout schützen.

## 7. Wirtschaftlichkeit richtig rechnen

Dokumentierter Jev-Preis: 0,042 USD je Million Eingabetokens, Ausgabetokens kostenlos. [Modellpreise](https://docs.typesafe.ai/models)

Rechenbeispiel, **kein gemessener Phonbotpreis**: 2.000 tatsächlich berechnete Eingabetokens kosten 0,000084 USD = 0,0084 US-Cent je Abfrage. Vier solche Abfragen pro Minute ergeben 0,0336 US-Cent pro Minute nur für Jev. Tatsächliches `usage.input_tokens` inklusive Fragenteil messen; kein Tokenbudget aus Zeichenanzahl ableiten.

Entscheidend ist die Gesamtrechnung: Sprachmodell + verbleibendes Terra-Backend + Jev + Recherche + Telefonie/Transport + Infrastruktur + gegebenenfalls SMS. Einsparung entsteht nur, wenn tatsächlich andere bezahlte Arbeit entfällt. 0,10 EUR Verkaufspreis garantiert damit noch keinen Gewinn. Wechselkurs, Steuern, Betrieb und gewünschte Marge getrennt ausweisen; USD und EUR nicht gleichsetzen.

## 8. Offene Freigaben und nächster konkreter Schritt

1. Zweiter Chat liest diesen Plan und den tatsächlichen lokalen Quellstand, prüft P0-Testbarkeit und meldet Konflikte in `phonbot.md`. Zunächst nur Review.
2. Nutzer gibt danach einen klaren Umsetzungsschritt frei; Planer prüft den Änderungsvorschlag und A/B-Nachweise. Planung ist keine Freigabe durch einen anderen Agenten.
3. Für Jev fehlen noch bestätigter Kontozugang, Testbudget und passende Datenverarbeitungsbedingungen. Keine Anmeldung oder Zahlung im Namen des Nutzers aus diesem Dokument ableiten.
4. Vor jedem späteren Telefonversuch frische Katalog-/Protokollgültigkeit prüfen; vorhandene Fristen nicht still verlängern. Keine privaten Testdaten auf GitHub.

Erste Reviewfrage: Können wir den Fehler **nach** Gesprächsfreigabe im echten Runtime-Test deterministisch reproduzieren, ohne die Audio-, Start- oder Aktionsregeln zu verändern? Diese Frage hat Vorrang vor Modelloptimierung.
