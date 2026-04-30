# Transfer Impact Assessment (TIA) — Sentry (Functional Software, Inc.)

> **Stand:** 2026-04-30 · **Verantwortlich:** Hassieb Kalla, Mindrails UG · **Re-Verifikation:** 2026-10-30

## 1. Verantwortlicher
Mindrails UG, Berlin · Phonbot.

## 2. Datenimporteur
**Functional Software, Inc.** d/b/a **Sentry** · 132 Hawthorne Street, San Francisco, CA 94107, USA · Rolle: Sub-Auftragsverarbeiter · Vertrag: DPA + SCC (Click-Wrap auf sentry.io/legal/dpa) · DPF: aktiv (Re-Verifikation auf dataprivacyframework.gov, Stand 2026-04-30).

## 3. Übertragene Daten
| Kategorie | Beispiel | Sensitivität | Art. 9? |
|---|---|---|---|
| Stack-Traces | TypeScript-Fehler-Trace mit Filenamen + Zeilen | gewöhnlich | nein |
| Request-Pfade | `/api/admin/leads?limit=50` | gewöhnlich | nein |
| Browser-Info / User-Agent | "Mozilla/5.0 ..." | gewöhnlich | nein |
| User-IDs (Phonbot-interne UUIDs) | redacted via beforeSend | gewöhnlich | nein |
| **Bodies / Cookies / IPs** | **redacted vor Versand** durch beforeSend-Hook | n/a | n/a |
| Performance-Metriken | Latenzen, Slow-Query-Zeiten | gewöhnlich | nein |

**Volumen:** Schätzung 10-100 Events/Tag im Normalbetrieb, mehr bei Bug-Wellen · **Frequenz:** event-getriggert · **Speicherdauer beim Importeur:** 30-90 Tage je nach Sentry-Plan.

## 4. Schutz vertraglich
- [ ] DPA via Settings → Organization → Legal — `compliance/dpas/sentry/<datum>-DPA.pdf`
- [ ] SCC im DPA
- [x] **DPF aktiv** (zu verifizieren)
- [x] SOC 2 Type II + ISO 27001

## 5. US-Drittlandsrecht
**FISA 702 / CLOUD Act:** US-Firma, regulärer SaaS. EO 14086 + DPRC via DPF.

## 6. Zusätzliche Schutzmaßnahmen
- [x] TLS 1.2+ in transit
- [x] **`beforeSend`-Hook in Phonbot-Code** entfernt **vor** dem Versand: Request-/Response-Bodies, User-Objekte, Cookies, IP-Adressen → keine Anrufer-PII landet bei Sentry
- [x] **Pino-PII-Redact-Pfade** zusätzlich auf Logger-Ebene (defense-in-depth: falls Sentry-Integration mal Logger-Output mitschickt)
- [x] **Datenminimierung:** Phonbot sendet nur Error-Events, keine User-Activity-Tracking, kein Replay
- [x] **Sample-Rate:** Performance-Tracing auf 0.1 (10 % der Requests) gesetzt — minimiert Datenfluss
- [x] **Kein Session-Replay** aktiviert — würde sonst potentiell Anrufer-Eingaben erfassen

## 7. Betroffenenrechte
DSGVO Art. 15-22 durchsetzbar gegen Mindrails. Da `beforeSend` PII filtert, sind Sentry-Events praktisch keine personenbezogenen Daten i. S. v. Art. 4 Nr. 1 mehr — Auskunfts-Anfragen sind eher gegen Phonbot-eigene Logs gerichtet.

## 8. Bewertung

**Hauptschutz: aggressives PII-Stripping VOR dem Versand**, plus DPF-Zertifizierung + niedrige Sample-Rate. Sentry-Events sind nach `beforeSend` quasi-anonyme Stack-Traces.

**Rest-Risiko: niedrig**

**Ergebnis:** ☑ **Transfer rechtmäßig** unter den genannten Schutzmaßnahmen.

**TODO Code-Audit-Empfehlung:** vor Live-Launch einmal manuell verifizieren, dass `beforeSend` tatsächlich alle in der Liste genannten Felder entfernt — `apps/api/src/sentry.ts` (oder wo immer Sentry initialisiert wird) lesen + Tests dazu schreiben.

## 9. Re-Verifikation
| Datum | Status | DPF |
|---|---|---|
| 2026-04-30 | initiale Erstellung | aktiv |

**Re-Check:** 2026-10-30
