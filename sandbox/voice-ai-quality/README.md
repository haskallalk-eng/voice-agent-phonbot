# Phonbot Voice AI Quality Sandbox

Ziel: RAG, Custom-LLM/Fine-Tuning und Custom-STT fuer Phonbot getrennt testen,
ohne produktive Agents, echte Kunden, echte Termine oder echte Nachrichten zu
veraendern.

## Kurzfazit fuer unseren Use Case

1. RAG lohnt sich sofort fuer kundenspezifisches Wissen:
   Preise, Leistungen, Oeffnungszeiten, FAQ, Branchenregeln, Handoff-Regeln,
   Objekt-/Service-Daten und rechtlich erlaubte Standardantworten.

2. RAG lohnt sich nicht fuer harte Verhaltensregeln:
   Terminbuchung nur nach Bestaetigung, keine erfundenen Tool-Ergebnisse,
   Datenschutz, DNC, Recording-Decline, SMS nur bei smsSent=true. Diese Regeln
   gehoeren in Backend, Tool-Schema und Baseline-Prompt.

3. Fine-Tuning/Custom LLM kann spaeter helfen:
   Tonfall, Kuerze, Tool-Disziplin, E-Mail-Buchstabierlogik, Einwandbehandlung
   und Branchenpattern. Es ersetzt aber weder RAG noch Backend-Guards.

4. Custom STT kann besonders bei Phonbot helfen:
   deutsche Namen, Firmen, E-Mail-Adressen, "at/punkt", Telefonnummern, lokale
   Begriffe, Dialekte und laute Telefonumgebungen. Voll eigenes STT ist aber
   teuer und riskant. Starten sollten wir mit STT-Normalisierung und Vergleichs-
   Transkription, nicht mit einem eigenen ASR-Modell.

## Was der Code schon hat

- Retell Knowledge Bases:
  `apps/api/src/knowledge.ts` bereitet Text, URL und PDF als Retell-KB vor.
  `apps/api/src/agent-config.ts` haengt `retellKnowledgeBaseId` beim Deploy an
  den Retell LLM.

- Retell LLM KB Config:
  `apps/api/src/retell.ts` nutzt aktuell `top_k: 3` und `filter_score: 0.6`,
  wenn Knowledge Bases aktiv sind.

- Call-Daten:
  `apps/api/src/db.ts` enthaelt `call_transcripts`, `call_analyses`,
  `prompt_suggestions`, `conversation_patterns`, `template_learnings` und
  `training_examples`.

- Training Export:
  `apps/api/src/training-export.ts` kann Beispiele aus Transkripten erzeugen
  und JSONL exportieren. PII wird vor Persistenz/Export redigiert.

- STT-Seitenpfad:
  `packages/voice-core/src/index.ts` nutzt OpenAI Realtime mit
  `gpt-4o-transcribe` als Transkription. Produktion laeuft aktuell ueber
  Retell; dieser Pfad eignet sich als Experiment/Sidecar.

## Wo RAG unser System besser macht

- Weniger Prompt-Laenge:
  Statt alle FAQ/Preise/Services in den Prompt zu schreiben, holt RAG nur die
  passende Info. Das senkt Prompt-Drift und kann LLM-Latenz reduzieren.

- Bessere Aktualitaet:
  Preise, Leistungen, Regeln und Webseiteninhalte koennen aktualisiert werden,
  ohne den kompletten Agent-Prompt zu editieren.

- Mehr Mandanten-Sicherheit:
  Jeder Kunde bekommt nur seine Knowledge Base. Voraussetzung: org-scoped
  Quellen, keine cross-org Retrieval-Mischung.

- Bessere AI-SEO/Website-Demo:
  Die Demo kann Fragen zu Phonbot, DSGVO, Preisen, Einrichtung und Branchen
  beantworten, ohne dass der Demo-Prompt riesig wird.

- Bessere Branchen-Skalierung:
  Standardwissen pro Branche kann als kuratierte Knowledge Source laufen,
  waehrend harte Prozessregeln im Baseline-Prompt/Backend bleiben.

## Wo RAG unser System schlechter machen kann

- Latenz:
  Retell misst `latency.knowledge_base`. Jeder KB-Retrieval-Schritt kann e2e
  verlangsamen, besonders mit grossen PDFs/URLs und hohem top_k.

- Falscher Kontext:
  Wenn ein alter Preis oder eine alte FAQ-Seite retrieved wird, klingt die KI
  sehr ueberzeugend falsch.

- Prompt-Injection in Wissen:
  Webseiten/PDFs koennen Text enthalten wie "ignoriere alle Regeln". RAG-Daten
  muessen als untrusted context behandelt werden.

- Tool-Halluzination:
  RAG kann "Kalender buchen" erklaeren, aber darf niemals den Backend-Erfolg
  ersetzen. Kritische Aktionen muessen Tool-Response-basiert bleiben.

- Datenschutz:
  Transkripte, Kundennamen, Telefonnummern oder E-Mails duerfen nicht als
  generelle Knowledge Sources in andere Orgs gelangen.

## Custom LLM / Fine-Tuning

### Sinnvoll fuer

- Antwortstil: kurz, deutsch, natuerlich, wenig Filler.
- Tool-Disziplin: nie Toolnamen aussprechen, kein Erfolg ohne Tool-Response.
- E-Mail- und Telefonnummern-Dialog: gezielt nachfragen, buchstabieren,
  bestaetigen, nicht wiederholen.
- Branchenpattern: Friseur, Handwerker, Restaurant usw. mit typischen Dialogen.
- Outbound-Respekt: DNC sofort akzeptieren, kein Hard-Close.

### Nicht sinnvoll fuer

- Faktenwissen, Preise, Oeffnungszeiten: gehoert in RAG/DB.
- Kalenderlogik, Idempotenz, Zahlungen, DSGVO: gehoert in Backend.
- STT-Fehler wie "gmx" vs "gee em ex": gehoert in STT/Postprocessing und
  Dialogstrategie.

### Datenbedarf

Minimum fuer einen ersten SFT-Test:

- 300 bis 500 bereinigte, PII-freie Turns mit gutem Zielverhalten.
- 50 bis 100 harte Negativfaelle als Eval, nicht als Training.
- Pro Branche mindestens 50 gute Beispiele, bevor branchenspezifisches Tuning
  Sinn ergibt.

Minimum fuer DPO/Preference:

- 200+ Paare: gleiche Situation, gute Antwort vs schlechte Antwort.
- Klare Labels: chosen/rejected mit Grund.

## Custom STT

### Sinnvoll fuer

- Deutsche E-Mail-Adressen: "max at gmx punkt de", "M wie Maria".
- Firmen- und Kundennamen.
- Telefonnummern, Datumsangaben, Uhrzeiten.
- Dialekte, Nebengeraeusche, Unterbrechungswoerter: "stopp", "nein", "warte".

### Reihenfolge

1. Normalisierer verbessern:
   Post-STT-Regeln fuer E-Mail, Zahlen, Datum, Telefonnummern, Namen.

2. Dual-STT-Eval:
   Retell-Transkript vs OpenAI `gpt-4o-transcribe` Sidecar auf denselben
   Aufnahmen vergleichen. Nur offline/Sandbox, keine produktive Aktion.

3. Custom Vocabulary / Biasing:
   Falls Anbieter es ermoeglicht: Branchenwoerter, Namen, Stadtteile, Services.

4. Eigenes STT/Fine-Tune:
   Erst wenn wir genug Audio+Referenztranskript haben und Consent/Retention
   sauber geloest ist.

### Datenbedarf

- Audio + manuell korrigiertes Referenztranskript.
- Segment-Level Labels: E-Mail, Telefonnummer, Name, Datum, Stop-Wort,
  Unterbrechung, Hintergrundgeraeusch.
- Mindestens 5 bis 10 Stunden relevante deutsche Telefon-Audio-Daten fuer eine
  serioese STT-Eval. Fuer echtes Training deutlich mehr.

## Experiment-Reihenfolge

Phase 1: RAG sauber machen
- KB-Quellen klassifizieren: facts, policies, services, prices, faq, unsafe.
- Retrieval-Ausgabe testen: korrekter Fakt, kein Fakt, alter Fakt,
  widerspruechlicher Fakt.
- Retell `top_k` und `filter_score` variieren.

Phase 2: STT-Fehler messen
- 100 harte Audio-/Transcript-Faelle sammeln.
- E-Mail, Zahlen, Stop/Nein und Datumsfaelle separat scoren.
- Erst Normalisierung/Postprocessing fixen, bevor Custom-STT gebaut wird.

Phase 3: Prompt-vs-Fine-Tune Test
- Gleiche 500 bis 1000 simulierte Faelle mit:
  A current prompt,
  B kuerzer Prompt + harte Backend-Regeln,
  C RAG + kuerzer Prompt,
  D spaeter Fine-Tune + RAG.

Phase 4: Fine-Tune nur bei echtem Gewinn
- Nur starten, wenn C noch klare wiederkehrende Style/Tool-Fehler hat.
- Fine-Tune nie ohne Holdout-Eval und Rollback.

## Guardrails

- Keine produktiven Tool-Aufrufe in der Sandbox.
- Keine echten SMS/E-Mails/Termine/Zahlungen.
- Kein Training mit nicht redigierten personenbezogenen Daten.
- Keine cross-org Trainingspaare.
- Kein RAG aus ungeprueften Webseiten ohne Injection-Filter.
- Erfolg nur zaehlen, wenn Testfall + Metrik bestanden sind.
