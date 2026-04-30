# Transfer Impact Assessment (TIA) — Retell AI

> **Stand:** 2026-04-30 · **Verantwortlich:** Hans Waier, Mindrails UG · **Re-Verifikation:** 2026-10-30

## 1. Verantwortlicher
Mindrails UG, Berlin, Deutschland · Phonbot · Geschäftsführung: Hans Waier.

## 2. Datenimporteur
**Retell AI Inc.** · Palo Alto, CA, USA · *(keine bekannte EU-Tochter, Stand 2026-04-30)* · Rolle: Sub-Auftragsverarbeiter · Vertrag: DPA + SCC Modul 3 (in Anfrage 2026-04-30, vgl. `compliance/dpa-requests/2026-04-30-retell-dpa-request.eml`) · DPF: **noch zu verifizieren** auf dataprivacyframework.gov.

## 3. Übertragene Daten
| Kategorie | Beispiel | Sensitivität | Art. 9? |
|---|---|---|---|
| Audio-Stream live | Stimmen-Daten der Anrufer | gewöhnlich (akustisch) | nein |
| Transkripte | Text aus dem Audio | gewöhnlich | nein |
| LLM-Prompt (Agent-Konfiguration) | enthält keine PII | n/a | n/a |
| Anrufer-Telefonnummer (in Webhook-Metadaten) | E.164-Format | gewöhnlich | nein |
| Call-Metadaten | Dauer, Zeitstempel, Outcome | gewöhnlich | nein |

**Volumen:** Live-Launch ~500 Anrufe/Tag, durchschnittlich 90 Sek. · **Frequenz:** kontinuierlich (real-time WebRTC + Webhook). · **Speicherdauer beim Importeur:** Recordings nur sofern aktiviert (Default off) — Transkripte 30 Tage.

## 4. Schutz vertraglich
- [ ] DPA + SCC Modul 3 — angefordert am 2026-04-30, Frist: 4 Wochen, sonst Anbieter-Wechsel evaluieren
- [ ] DPF-Status: **noch nicht verifiziert** (TODO: dataprivacyframework.gov-Suche nach „Retell AI" oder „Retell.ai")
- [ ] SOC 2 / ISO 27001: noch zu erfragen

## 5. US-Drittlandsrecht
**FISA 702:** Retell könnte als „Electronic Communications Service Provider" (ECSP) klassifiziert werden, weil sie Real-Time-Telefonie übermitteln → **erhöhtes** FISA-Risiko gegenüber reinen API-SaaS.
**CLOUD Act:** US-Firma → US-Behörden können Datenherausgabe verlangen.
**EO 14086 + DPRC:** sofern DPF-zertifiziert, anwendbar.

## 6. Zusätzliche Schutzmaßnahmen
- [x] TLS 1.2+ + WebRTC mit DTLS-SRTP (Transport-Encryption für Audio)
- [ ] Verschlüsselung at rest beim Anbieter — im DPA-Anfrage-Punkt 4 angefragt
- [x] **Webhook-Signatur** (HMAC-SHA256 + timingSafeEqual) — verhindert Spoofing
- [x] **Anti-Toll-Fraud:** ALLOWED_PHONE_PREFIXES Whitelist DACH-only auf Outbound — verhindert Premium-Nummern-Abuse via Retell
- [x] **Datenminimierung:** Audio-Recording per Default OFF, Recording-Decline-Mode konfigurierbar
- [ ] **Behörden-Notification** im DPA anfragen
- [ ] **Audit-Recht** im DPA anfragen

## 7. Betroffenenrechte
- DSGVO Art. 15-22 durchsetzbar gegen Mindrails
- DPF-Beschwerdeverfahren: nur sofern Retell DPF-zertifiziert ist (TBD)

## 8. Bewertung

**Pre-DPA-Status (heute, 2026-04-30):** der Transfer ist **noch nicht final rechtmäßig**, weil:
- DPA + SCC noch nicht abgeschlossen (in Anfrage)
- DPF-Status nicht verifiziert
- Audio-Recordings können — sofern aktiviert — länger gespeichert werden als wir Kontrolle haben

**Risiko-Profil bei abgeschlossener Vertragslage:** mittel
- höher als OpenAI wegen FISA-ECSP-Risiko (Audio-Carrier-Funktion)
- niedriger als Twilio wegen kleinerem Daten-Footprint pro Anruf

**Vorgehen bis Vertragsabschluss:** Phonbot wird Retell **nur** im internen Demo-/Test-Modus nutzen — keine produktiven Live-Geschäftskunden-Anrufe — bis DPA + SCC + DPF-Verifikation vorliegen.

**Ergebnis:**
- ☐ Transfer rechtmäßig (steht aus, abhängig von DPA-Eingang)
- ☑ **Transfer mit zusätzlichen Maßnahmen rechtmäßig** — diese sind:
  1. Audio-Recording per Default deaktiviert
  2. Demo-/Test-Daten als Pseudonyme („Max Mustermann" etc.)
  3. Anti-Toll-Fraud-Whitelist
  4. **Bis DPA-Eingang:** kein produktiver Live-Einsatz mit echten Geschäftskunden-Anrufen

## 9. Re-Verifikation

| Datum | Status | Änderungen | DPF-Status |
|---|---|---|---|
| 2026-04-30 | Vorläufig — DPA in Anfrage | initiale Erstellung | TBD |

**Re-Check sobald DPA eingegangen ist** + dann halbjährlich: 2026-10-30.
