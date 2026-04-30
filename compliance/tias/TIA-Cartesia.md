# Transfer Impact Assessment (TIA) — Cartesia

> **Stand:** 2026-04-30 · **Verantwortlich:** Hassieb Kalla, Mindrails UG · **Re-Verifikation:** 2026-10-30

## 1. Verantwortlicher
Mindrails UG, Berlin · Phonbot.

## 2. Datenimporteur
**Cartesia, Inc.** · San Francisco, CA, USA · *(keine bekannte EU-Tochter)* · Rolle: Sub-Auftragsverarbeiter · Vertrag: DPA + SCC Modul 3 (in Anfrage 2026-04-30, vgl. `compliance/dpa-requests/2026-04-30-cartesia-dpa-request.eml`) · DPF-Status: **noch zu verifizieren** auf dataprivacyframework.gov.

## 3. Übertragene Daten
| Kategorie | Beispiel | Sensitivität | Art. 9? |
|---|---|---|---|
| Text-Input für TTS | „Hallo, mein Name ist Chipy. Wie kann ich helfen?" | gewöhnlich | nein |
| Voice-ID (Konfiguration) | „de-DE-female-warm" | n/a | n/a |
| Sprach-Code | "de-DE" | n/a | n/a |

**Volumen:** Live-Launch ~2.000 TTS-Snippets/Tag · **Frequenz:** kontinuierlich · **Speicherdauer beim Importeur:** TBD (im DPA-Anfrage-Punkt 4 angefragt — typisch bei kleineren TTS-Anbietern: ephemeral, 0 Tage).

## 4. Schutz vertraglich
- [ ] DPA + SCC Modul 3 — angefordert, Frist: 4 Wochen
- [ ] DPF-Status: **noch zu verifizieren**
- [ ] Bei Cartesia (Startup, gegründet 2023): SOC 2 nicht garantiert, im DPA-Punkt 5 nach Sub-Processoren gefragt

## 5. US-Drittlandsrecht
**FISA 702 / CLOUD Act:** US-Firma, regulärer SaaS ohne Carrier-Funktion → moderates Risiko. EO 14086 + DPRC anwendbar via DPF (sofern zertifiziert).

## 6. Zusätzliche Schutzmaßnahmen
- [x] TLS 1.2+ zwischen Phonbot und Cartesia-API
- [x] **Datenminimierung extrem:** Cartesia bekommt nur den fertigen Antwort-Text vom LLM — keine Anrufer-PII, keine Eingangs-Transkripte, keine Telefonnummern
- [x] **Keine Identifizierbarkeit:** Cartesia weiß nicht, wer der Anrufer ist; Text-Input ist Antwort-Text aus Chipy-Persona
- [ ] **Behörden-Notification + Audit-Recht** im DPA-Anfrage-Punkt 1 enthalten

## 7. Betroffenenrechte
DSGVO Art. 15-22 durchsetzbar gegen Mindrails. Cartesia speichert (gemäß angefragter Bestätigung) keine identifizierbaren Daten — Auskunfts-/Löschungsanfragen müssen daher praktisch nicht an Cartesia weitergegeben werden.

## 8. Bewertung

**Stärkster Schutz hier ist Datenminimierung:** Cartesia sieht nur Antwort-Text, keinerlei Anrufer-Daten. Selbst bei FISA-702-Beschlagnahme wäre die forensische Wertigkeit für US-Behörden ≈ 0, weil keine Personen-Zuordnung möglich.

**Pre-DPA-Status:** Transfer ist **noch nicht final rechtmäßig** ohne DPA. Bis Vertragsabschluss: Cartesia-Einsatz nur für anonyme Demo- und Test-Anrufe.

**Rest-Risiko: niedrig** (vorbehaltlich DPA-Eingang)

**Ergebnis:** ☑ **Transfer mit Datenminimierung als Hauptmaßnahme + ausstehendem DPA rechtmäßig** für nicht-produktive Anrufe; ☐ produktiv erst nach DPA-Eingang.

## 9. Re-Verifikation
| Datum | Status | DPF |
|---|---|---|
| 2026-04-30 | initiale Erstellung — DPA in Anfrage | TBD |

**Re-Check:** sobald DPA eingegangen + halbjährlich → 2026-10-30
