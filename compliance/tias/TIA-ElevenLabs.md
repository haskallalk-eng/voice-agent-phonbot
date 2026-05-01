# Transfer Impact Assessment (TIA) — ElevenLabs

> **Stand:** 2026-04-30 · **Verantwortlich:** Hans Waier, Hans Ulrich Waier · **Re-Verifikation:** 2026-10-30

## 1. Verantwortlicher
Hans Ulrich Waier, Berlin · Phonbot.

## 2. Datenimporteur
**ElevenLabs Inc.** · 169 Madison Avenue STE 11008, New York, NY 10016, USA · Rolle: Sub-Auftragsverarbeiter (aktiv für Premium-Stimmen-Tier) · Vertrag: DPA + SCC Modul 3 (Click-Wrap auf elevenlabs.io/dpa) · DPF: zu verifizieren auf dataprivacyframework.gov.

## 3. Übertragene Daten
| Kategorie | Beispiel | Sensitivität | Art. 9? |
|---|---|---|---|
| Text-Input für TTS | Antwort-Text aus Chipy-Persona ("Guten Tag, ...") | gewöhnlich | nein |
| Voice-ID | "11labs-Sarah", "11labs-Charlotte", "11labs-Daniel" etc. | n/a | n/a |
| Sprach-Code | "de" via Multilingual-v2 | n/a | n/a |
| Voice-Clone-Sample (NUR sofern Voice-Clone-Add-on aktiviert) | 30-90 Sek. Stimm-Probe | **hoch (biometrisch verwandt)** | **JA — Art. 9 möglich** |

**Volumen:** Live-Launch-Schätzung ~500 TTS-Snippets/Tag (für Premium-Stimmen-Tier), pro Snippet 1-3 Sätze · **Frequenz:** kontinuierlich · **Speicherdauer beim Importeur:** Text-Inputs ephemeral (gemäß ElevenLabs API-Tier-Default), Voice-Clones bleiben dauerhaft im ElevenLabs-Account bis zur expliziten Löschung.

## 4. Schutz vertraglich
- [ ] DPA via Account → Settings → Legal — `compliance/dpas/elevenlabs/<datum>-DPA.pdf`
- [ ] SCC Modul 3 (im DPA)
- [ ] DPF-Status: zu verifizieren
- [ ] SOC 2 / ISO 27001: bei DPA-Anfrage erwähnt prüfen

## 5. US-Drittlandsrecht
**FISA 702 / CLOUD Act:** US-Firma, regulärer SaaS ohne Carrier-Funktion → moderates Risiko. EO 14086 + DPRC anwendbar via DPF (sofern zertifiziert).

## 6. Zusätzliche Schutzmaßnahmen
- [x] TLS 1.2+ in transit zwischen Phonbot und ElevenLabs-API
- [x] **Datenminimierung Text-Tier:** ElevenLabs bekommt nur den fertigen Antwort-Text vom LLM — keine Anrufer-PII, keine Eingangs-Transkripte, keine Telefonnummern
- [x] **Keine Identifizierbarkeit (Standard-Premium-Stimmen):** ElevenLabs weiß nicht, wer der Anrufer ist; Text-Input ist Antwort-Text aus Chipy-Persona, der hypothetisch von einem beliebigen Kunden stammen könnte
- [x] **Voice-Clone OFF per Default** — wird nur bei expliziter Customer-Buchung aktiviert; separater Consent-Flow im Phonbot-UI
- [ ] **Voice-Sample-Lifecycle (sofern Clone aktiviert):** Phonbot-Code-TODO `deleteElevenLabsVoiceClone(customerId)` bei Account-Closure — sicherstellen dass biometrisch-verwandte Daten am Ende des Vertrages aktiv aus ElevenLabs entfernt werden
- [ ] **Behörden-Notification + Audit-Recht** im DPA verankert prüfen

## 7. Betroffenenrechte
DSGVO Art. 15-22 durchsetzbar gegen Mindrails (Single Point of Contact: info@phonbot.de). DPF-Beschwerdeverfahren über ElevenLabs + DPRC verfügbar (sofern DPF-zertifiziert).

**Voice-Clone-Spezialfall:** der Customer (nicht der Endkunde) ist hier zugleich Betroffener — sein Voice-Sample fällt unter Art. 9 DSGVO (besondere Kategorien). Phonbot speichert nur Voice-IDs, der biometrische Rohdaten-Container ist bei ElevenLabs.

## 8. Bewertung

**Zwei Use-Cases mit unterschiedlicher Risiko-Profil:**

**8.1 Standard-Premium-Stimmen (8 ElevenLabs Multilingual-v2-Voices in DE-Catalog):**
Datenfluss = Text → ElevenLabs → Audio. Schutz primär durch:
1. **Datenminimierung extrem:** ElevenLabs sieht nur Antwort-Text-Snippets, keinerlei Anrufer-Daten
2. **DPF-Zertifizierung** + EO 14086 + DPRC (sofern zertifiziert)
3. **TLS in transit + AES at rest beim Anbieter** (lt. SOC 2)

→ **Rest-Risiko: niedrig** (vorbehaltlich DPA-Akzeptanz im Dashboard)

**8.2 Voice-Clone-Add-on (sofern aktiviert):**
Stimme ist biometrisch-verwandtes Datum. Art. 9 DSGVO greift potenziell. Schutz nur durch:
1. **Explizite, freie, informierte Einwilligung** (Art. 9 Abs. 2 lit. a DSGVO) — separater Consent-Dialog im Customer-Onboarding
2. **Voice-Clone OFF per Default**
3. **Auto-Löschung** des Voice-Clones bei Account-Closure (`deleteElevenLabsVoiceClone()` Hook)

→ **Rest-Risiko: mittel** — abhängig von Einwilligungs-Implementierung im Phonbot-UI

**Ergebnis:**
- ☑ **Standard-Premium-Stimmen:** rechtmäßig unter Datenminimierung + ausstehendem DPA
- ☑ **Voice-Clone:** mit zusätzlichen Maßnahmen rechtmäßig — Pflichtbedingungen:
  1. Standalone-Consent-Dialog im Customer-Onboarding
  2. Voice-Clone OFF per Default
  3. Auto-Löschung bei Account-Closure (`deleteElevenLabsVoiceClone()` API-Hook)

## 9. Re-Verifikation
| Datum | Status | DPF |
|---|---|---|
| 2026-04-30 | initiale Erstellung — DPA-Click-Wrap ausstehend | TBD |

**Re-Check:** 2026-10-30
