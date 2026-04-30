# Transfer Impact Assessment (TIA) — Resend

> **Stand:** 2026-04-30 · **Verantwortlich:** Hans Waier, Mindrails UG · **Re-Verifikation:** 2026-10-30

## 1. Verantwortlicher
Mindrails UG, Berlin · Phonbot.

## 2. Datenimporteur
**Resend, Inc.** · 2261 Market Street #4111, San Francisco, CA 94114, USA · Rolle: Sub-Auftragsverarbeiter · Vertrag: DPA + SCC (Click-Wrap auf resend.com/legal/dpa) · DPF: zu verifizieren.

## 3. Übertragene Daten
| Kategorie | Beispiel | Sensitivität | Art. 9? |
|---|---|---|---|
| Empfänger-E-Mail | `kunde@example.de` | gewöhnlich | nein |
| Empfänger-Name (optional, im Mail-Body) | „Max Mustermann" | gewöhnlich | nein |
| Mail-Inhalt | Anmelde-Bestätigung, Reset-Link, Termin-Einladung | gewöhnlich | nein |
| Versand-Metadaten | Zeit, Status, Open-/Click-Tracking falls aktiviert | gewöhnlich | nein |

**Volumen:** Schätzung Live-Launch ~200 Mails/Tag · **Frequenz:** transaktional (event-getriggert) · **Speicherdauer beim Importeur:** Resend speichert Mail-Logs 30 Tage Standard; Mail-Bodies werden nach Versand verworfen (gemäß Resend-ToS).

## 4. Schutz vertraglich
- [ ] DPA via Account → Settings → Legal — `compliance/dpas/resend/<datum>-DPA.pdf`
- [ ] SCC im DPA-Anhang
- [ ] DPF: zu verifizieren

## 5. US-Drittlandsrecht
**FISA 702 / CLOUD Act:** US-Firma, regulärer SaaS. EO 14086 + DPRC anwendbar via DPF.

## 6. Zusätzliche Schutzmaßnahmen
- [x] TLS 1.2+ in transit (TLS-OpportunisticSTARTTLS auf SMTP-Hops danach abhängig vom Empfänger-Server)
- [x] DKIM + SPF + DMARC für phonbot.de korrekt konfiguriert
- [x] **Datenminimierung:** Resend bekommt nur die Mail-Adresse + Mail-Inhalt; keine Phonbot-internen Customer-IDs, keine Org-Zuordnung
- [x] **Open-/Click-Tracking deaktiviert** im Phonbot-Setup (kein Tracking-Pixel, keine Tracking-Links) — verhindert zusätzliche User-Behavior-Exposure
- [x] **Keine Bulk-Mails:** Resend wird nur transaktional verwendet, nicht für Marketing — kein Mailing-List-Storage

## 7. Betroffenenrechte
DSGVO Art. 15-22 durchsetzbar gegen Mindrails. Resend speichert Mail-Inhalte nicht persistent; Auskunfts-Anfragen können daher praktisch nur die 30-Tage-Logs betreffen, nicht die Inhalte.

## 8. Bewertung

**Hauptschutz: Transaktionalität + No-Tracking + minimaler Daten-Footprint.** Selbst bei FISA-Beschlagnahme lägen bei Resend nur Mail-Logs (Empfänger-Adresse + Zeit + Status), keine Mail-Bodies, keine Customer-Behaviour-Daten.

**Rest-Risiko: niedrig**

**Ergebnis:** ☑ **Transfer rechtmäßig** unter den genannten Schutzmaßnahmen.

## 9. Re-Verifikation
| Datum | Status | DPF |
|---|---|---|
| 2026-04-30 | initiale Erstellung | TBD |

**Re-Check:** 2026-10-30
