# Transfer Impact Assessment (TIA) — ElevenLabs

> **Stand:** 2026-04-30 · **Verantwortlich:** Hassieb Kalla, Mindrails UG · **Re-Verifikation:** 2026-10-30

## 1. Verantwortlicher
Mindrails UG, Berlin · Phonbot.

## 2. Datenimporteur
**ElevenLabs Inc.** · 169 Madison Avenue STE 11008, New York, NY 10016, USA · Rolle: Sub-Auftragsverarbeiter (nur bei aktiviertem Voice-Clone-Feature) · Vertrag: DPA + SCC Modul 3 (Click-Wrap auf elevenlabs.io/dpa) · DPF: zu verifizieren auf dataprivacyframework.gov.

## 3. Übertragene Daten
| Kategorie | Beispiel | Sensitivität | Art. 9? |
|---|---|---|---|
| Text-Input für TTS | Antwort-Text aus Chipy-Persona | gewöhnlich | nein |
| Voice-Clone-Sample (NUR sofern Add-on aktiviert) | 30-90 Sek. Stimm-Probe des Kunden | **hoch (biometrisch verwandt)** | **JA — Art. 9 möglich** |
| Voice-ID (Konfiguration) | n/a | n/a | n/a |

**Volumen:** Standard-TTS ~500 Snippets/Tag (sofern statt Cartesia genutzt); Voice-Clone-Sample einmalig pro Kunde · **Frequenz:** kontinuierlich für TTS, einmalig für Clone · **Speicherdauer:** Voice-Clones bleiben dauerhaft im ElevenLabs-Account bis zur Löschung.

## 4. Schutz vertraglich
- [ ] DPA via Account → Settings → Legal — `compliance/dpas/elevenlabs/<datum>-DPA.pdf`
- [ ] SCC Modul 3 (im DPA)
- [ ] DPF-Status: zu verifizieren

## 5. US-Drittlandsrecht
**FISA 702 / CLOUD Act:** US-Firma. EO 14086 + DPRC anwendbar via DPF.

## 6. Zusätzliche Schutzmaßnahmen
- [x] TLS 1.2+ in transit
- [x] **Voice-Clone-Feature standardmäßig OFF** im Phonbot — wird nur bei expliziter Customer-Buchung aktiviert
- [x] **Voice-Clone-Einwilligung** als separater Consent-Flow im Phonbot-UI: Customer muss separat zustimmen, dass seine Stimme in ElevenLabs hochgeladen wird
- [x] **Datenminimierung Standard-TTS:** wie Cartesia — nur Antwort-Text, keine Anrufer-PII
- [ ] **Voice-Sample-Lifecycle:** Phonbot löscht Voice-Clones via API-Call wenn der Customer den Service kündigt (TODO im Code: `deleteElevenLabsVoiceClone(customerId)` bei Account-Closure)

## 7. Betroffenenrechte
DSGVO Art. 15-22 durchsetzbar. **Voice-Clone-Spezialfall:** der Customer (nicht der Endkunde) ist hier zugleich Betroffener — sein Voice-Sample fällt unter Art. 9 DSGVO (besondere Kategorien). Phonbot speichert nur Voice-IDs, der biometrische Rohdaten-Container ist bei ElevenLabs.

## 8. Bewertung

**Zwei sehr unterschiedliche Use-Cases:**

1. **Standard-TTS** (Chipy spricht mit Standard-Stimme): identisch mit Cartesia-Bewertung — Datenminimierung als Hauptschutz, Rest-Risiko niedrig.

2. **Voice-Clone-Add-on:** sensibler. Stimme ist biometrisch-verwandtes Datum. Art. 9 DSGVO greift potenziell. Schutz nur durch:
   - Explizite, freie, informierte Einwilligung (Art. 9 Abs. 2 lit. a DSGVO)
   - Voice-Clone OFF per Default
   - Löschungs-Workflow bei Vertragsende

**Rest-Risiko:**
- Standard-TTS: niedrig
- Voice-Clone: **mittel** — abhängig von Einwilligungs-Implementierung im Phonbot-UI

**Ergebnis:**
- ☑ Standard-TTS: **rechtmäßig** unter Datenminimierung
- ☑ Voice-Clone: **mit zusätzlichen Maßnahmen rechtmäßig** — Pflichtbedingungen:
  1. Standalone-Consent-Dialog im Customer-Onboarding
  2. Voice-Clone OFF per Default
  3. Auto-Löschung des Voice-Clones bei Account-Closure (`deleteElevenLabsVoiceClone()` API-Hook)

## 9. Re-Verifikation
| Datum | Status | DPF |
|---|---|---|
| 2026-04-30 | initiale Erstellung | TBD |

**Re-Check:** 2026-10-30
