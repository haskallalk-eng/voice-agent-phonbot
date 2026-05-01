# Transfer Impact Assessment (TIA) — Twilio

> **Stand:** 2026-04-30 · **Verantwortlich:** Hans Waier, Hans Ulrich Waier · **Re-Verifikation:** 2026-10-30

## 1. Verantwortlicher
Hans Ulrich Waier, Berlin · Phonbot.

## 2. Datenimporteur
**Twilio Inc.** · 101 Spear Street, San Francisco, CA 94105, USA · *(EU-Vertragspartner: Twilio Ireland Limited, Dublin)* · Rolle: Sub-Auftragsverarbeiter · Vertrag: DPA + SCC Modul 3 · DPF: aktiv (Stand 2026-04-30, Quelle: dataprivacyframework.gov).

## 3. Übertragene Daten
| Kategorie | Beispiel | Sensitivität | Art. 9? |
|---|---|---|---|
| Telefonnummer Anrufer (CLI) | +49 30 ... | gewöhnlich | nein |
| Telefonnummer Empfänger | +49 ... | gewöhnlich | nein |
| Audio-Stream | Live-Sprache | gewöhnlich (akustisch) | nein |
| Call-Metadaten | Dauer, Zeit, Status | gewöhnlich | nein |
| SMS-Inhalte (Bestätigungen) | „Dein Termin am ..." | gewöhnlich | nein |

**Volumen:** Live-Launch ~500 Anrufe/Tag · **Frequenz:** kontinuierlich · **Speicherdauer beim Importeur:** Audio-Recordings nur sofern aktiviert (Default off), Metadaten nach Twilio-Standardretention bis zu 90 Tage.

## 4. Schutz vertraglich
- [ ] DPA via Twilio Console → Compliance → Sign DPA — `compliance/dpas/twilio/<datum>-DPA.pdf`
- [ ] SCC Modul 3 (im DPA enthalten)
- [x] **DPF-zertifiziert** seit 2023 (Re-Verifikation halbjährlich)
- [x] PCI DSS Level 1 (für Voice-Carrier-Funktion)
- [x] ISO 27001, SOC 2 Type II (Berichte auf Anfrage)

## 5. US-Drittlandsrecht
**FISA 702:** Twilio fällt **definitiv** unter ECSP-Definition (Telekommunikations-Carrier) → **erhöhtes** FISA-Risiko, eines der historisch bekanntesten Beispiele.
**CLOUD Act:** US-Behörden können Datenherausgabe verlangen.
**EO 14086 + DPRC:** anwendbar via DPF.

## 6. Zusätzliche Schutzmaßnahmen
- [x] TLS 1.2+ + SRTP für Voice-Streams
- [x] **Webhook-Signatur** (Twilio-Signature-Header) auf allen Mindrails-Webhook-Endpunkten verifiziert
- [x] **Anti-Toll-Fraud:** ALLOWED_PHONE_PREFIXES auf DACH (+49/+43/+41) hardcoded — verhindert Premium-Nummer-Abuse
- [x] **isPlausiblePhone()** + Premium-Blocklist
- [x] **Datenminimierung:** keine längere Speicherung von Audio bei Twilio (Default off in Setup)
- [x] **Rate-Limit:** stündliche Caps + Redis-Global-Counter auf Outbound-Endpunkten
- [x] EU-Vertragspartner = Twilio Ireland Ltd → primärer Vertrag europäisch, US-Sub via SCC innerhalb der Twilio-Gruppe

## 7. Betroffenenrechte
DSGVO Art. 15-22 vollständig durchsetzbar (Mindrails Single Point of Contact). DPF-Beschwerdeverfahren über Twilio + DPRC verfügbar.

## 8. Bewertung

**Hauptrisiko:** Twilio's Carrier-Funktion erhöht FISA-702-Exposure inhärent. Demgegenüber:
1. **EU-Vertrag** mit Twilio Ireland reduziert primären Exposure
2. **DPF-Zertifizierung** + EO 14086 + DPRC schaffen Rechtsbehelfe
3. **Kein Telefonie-Alternativ-Carrier** mit vergleichbarer Reichweite + DSGVO-Vertragslage in der EU verfügbar (sipgate ist eine Option, aber API-Reife eingeschränkt)
4. **Datenminimierung** im Phonbot-Setup: kein Recording-Storage, Audio nur live-stream

**Rest-Risiko: mittel** — wird in Kauf genommen aufgrund operativer Notwendigkeit + abgesicherter Vertragslage + DPF.

**Ergebnis:** ☑ **Transfer rechtmäßig** unter den genannten Schutzmaßnahmen.

## 9. Re-Verifikation
| Datum | Status | DPF-Status |
|---|---|---|
| 2026-04-30 | initiale Erstellung | aktiv |

**Nächste Re-Verifikation:** 2026-10-30
