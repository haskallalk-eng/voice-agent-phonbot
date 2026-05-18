# Phonbot Voice AI Superbrain Index

Stand: 2026-05-17
Zweck: Einstiegspunkt fuer wiederkehrende Voice-AI-, RAG-, Prompt-, Tool- und Sicherheitsarbeit.

## Wichtigste Dateien

- RAG Risiko- und Optimierungsplan: `docs/vault/voice-ai-rag-risk-ultimate-plan-2026-05-17.md`
- Umsetzungsplan fuer RAG-Hardening: `docs/superpowers/plans/2026-05-17-rag-voice-agent-risk-hardening.md`
- RAG/Fine-Tune/STT Sandbox: `sandbox/voice-ai-quality/README.md`
- Eval-Matrix: `sandbox/voice-ai-quality/experiment-matrix.json`
- Beispiel-Eval-Cases: `sandbox/voice-ai-quality/sample-eval-cases.jsonl`
- Function-/Tool-Validierung: `docs/function-tool-validation-2026-05-05.md`
- Learning-System-Design: `docs/learning-system-design.md`
- Datenschutz Recording: `docs/privacy-recording.md`

## System-Wahrheiten

1. Backend und Tool-Responses sind Wahrheit fuer echte Aktionen.
2. RAG ist nur factual context, nie Systemregel und nie Tool-Erfolg.
3. Prompt steuert Gespraechsverhalten, aber harte Regeln gehoeren so weit wie moeglich ins Backend.
4. STT-Fehler muessen separat gemessen werden; RAG kann falsch abrufen, wenn die Query falsch verstanden wurde.
5. Demo-Agenten muessen Simulationen klar markieren.
6. Pricing, Minuten, Datum und Rechts-/Datenschutztexte brauchen Single Source of Truth.
7. Keine produktiven Testaktionen ohne ausdrueckliche sichere Testumgebung.

## Naechste Arbeit mit hoechster Wirkung

1. Source Governance fuer Knowledge Sources.
2. Offline RAG-Eval-Harness.
3. Live-KB-Latenz aus Retell-Calls messen.
4. Preis-/Zahlen-/Datum-Drift final aufraeumen.
5. STT-normalisierte Retrieval Queries und harte E-Mail/Zahlen-Faelle testen.
6. Recherche-Agenten fuer Datensicherheit und Aktualitaet vor jedem RAG-/Prompt-/Demo-Deploy einsetzen.
7. Retell Storage/Retention explizit pruefen und dokumentieren.
8. Cross-Tenant-/PII-/Injection-Evals als Deploy-Gate etablieren.
9. DB-Canonical-Facts-Layer bauen: erlaubte `agent_configs`-/Kalender-Metadaten zu RAG, Kunden-/Ticket-/Call-Daten nie zu RAG.

## Recherche-Agenten Rollen

- Datensicherheits-Agent: OWASP/NIST/Provider-Guidance, PII, Prompt Injection, Cross-Tenant, Retention, Tool-Exfiltration.
- Aktualitaets-Agent: Preise, Minuten, Legal/Privacy, FAQ, Website-/Sitemap-/Knowledge-Drift, verifiedAt/expiresAt.
- Code-Explorer: lokale Implementierungspunkte und Tests, ohne ungefragt Dateien zu editieren.

## Aktuelle Research-Erkenntnisse 2026-05-17

- Retell-Retention und Data-Storage sind P0, weil Retell u.a. Transkripte, Recordings, dynamische Variablen und Knowledge-Base-Retrieval-Logs speichern kann.
- Retell `knowledge_base` latency ist bereits in den Typen sichtbar, aber muss in Stats/Monitoring weitergereicht werden.
- Pricing/Legal/Promo-Quellen brauchen `verifiedAt` und `expiresAt`; Auto-Refresh ersetzt keine fachliche Freigabe.
- `prepareKnowledgePayload` ist der richtige zentrale Gate-Punkt vor Retell-Sync.
- `pii.ts` sollte Detection/Classification bekommen, nicht nur Redaction.
- Governance-Felder muessen optional sein und serverseitig validiert werden, damit alte Agent-Configs nicht brechen und Client-Approval nicht spoofbar ist.
- Phonbot-DB-Felder wie Business, Beschreibung, Services, Oeffnungszeiten und Mitarbeiter-Metadaten sollen als generierte org-scoped canonical facts in RAG; echte Kunden, Tickets, Transkripte, Buchungen und Zahlungsstatus bleiben Tool-/Backend-only.

## Wiederaufnahme-Checkliste

Wenn ein neuer Agent oder eine neue Session an RAG/Voice-Qualitaet arbeitet:

1. Lies diese Index-Datei.
2. Lies den RAG Risiko- und Optimierungsplan.
3. Pruefe `git status --short`, weil der Workingtree oft parallel bearbeitet wird.
4. Beruehre nur die Dateien, die zur konkreten Aufgabe gehoeren.
5. Verifiziere mit den im Plan genannten Tests, bevor du Abschluss behauptest.
6. Bei Sicherheits- oder Aktualitaetsfragen zuerst die passenden Recherche-Agenten starten und deren Findings reviewen.
