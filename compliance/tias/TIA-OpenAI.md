# Transfer Impact Assessment (TIA) — OpenAI

> **Stand:** 2026-04-30 · **Verantwortlich:** Hassieb Kalla, Mindrails UG · **Re-Verifikation:** 2026-10-30

## 1. Verantwortlicher
Mindrails UG (haftungsbeschränkt), Scharnhorststraße 8, 12307 Berlin · Phonbot — KI-Telefonassistent SaaS · Geschäftsführung: Hassieb Kalla.

## 2. Datenimporteur
**OpenAI, L.L.C.** · 1455 3rd Street, San Francisco, CA 94158, USA · *(EU-Tochter: OpenAI Ireland Ltd, Dublin — Vertragspartner für API-Kunden seit 2024)* · Rolle: Sub-Auftragsverarbeiter · Vertrag: DPA + SCC Modul 3 · DPF-Status: **aktiv** (Stand der Prüfung: 2026-04-30, Quelle: dataprivacyframework.gov)

## 3. Übertragene Daten
| Kategorie | Beispiel | Sensitivität | Art. 9? |
|---|---|---|---|
| Anrufer-Transkripte | „Ich brauche einen Termin nächsten Donnerstag, mein Name ist Müller" | gewöhnlich | nein |
| Extrahierte Anliegen-Zusammenfassungen | „Termin-Anfrage" | gewöhnlich | nein |
| Anrufer-Stammdaten falls vom LLM rekonstruiert (Name, Tel., Email) | gewöhnlich | nein |
| Agent-Prompts (Konfiguration) | enthält keine personenbezogenen Daten | n/a | n/a |

**Volumen:** Schätzung Live-Launch: ~1.000 LLM-Calls/Tag · **Frequenz:** kontinuierlich (Streaming-API) · **Speicherdauer beim Importeur:** 0 Tage (Zero-Retention für API-Tier aktiviert).

## 4. Schutz vertraglich
- [ ] DPA gemäß Art. 28 unterzeichnet — `compliance/dpas/openai/<datum>-DPA.pdf`
- [ ] SCC Modul 3 (Anhang im DPA)
- [x] **DPF-zertifiziert** seit 17.07.2023 (Verifikation: <Screenshot Pfad>)
- [x] **Zero-Retention-Mode** aktiviert (Setting im OpenAI-Account → "API data is not used to train")
- [x] SOC 2 Type II Bericht verfügbar auf Anfrage

## 5. US-Drittlandsrecht
**FISA 702 + CLOUD Act:** OpenAI fällt unter Definition „remote computing service" und kann theoretisch FISA-702-Anfragen erhalten. CLOUD-Act-Risiko: hoch für US-domiziliert.
**EO 14086 + DPRC:** EU-Bürger haben über DPF erweiterte Rechtsbehelfe seit 2023.
**Eigene Risiko-Bewertung:** OpenAI ist regulärer SaaS-Anbieter ohne Carrier-/ISP-Funktion → moderates FISA-702-Risiko.

## 6. Zusätzliche Schutzmaßnahmen
- [x] TLS 1.2+ zwischen Phonbot und OpenAI-API
- [x] OpenAI-seitige Verschlüsselung at rest (AES-256, lt. SOC 2)
- [x] **Zero-Retention** für API-Calls — keine Speicherung beim Anbieter
- [x] **Datenminimierung:** keine Übertragung von Audio-Daten an OpenAI; nur Text-Transkripte (kommen aus Retell, nicht direkt vom Mikrofon)
- [x] **Pseudonymisierung-Versuch:** Pino-Redact entfernt Telefonnummern + E-Mails aus Logs *vor* Sentry-Versand (separate Maßnahme); LLM-Prompt selbst enthält allerdings den Klartext-Transkript
- [x] **Behörden-Anfragen-Notification** im DPA verankert (sofern rechtlich zulässig)
- [x] **Audit-Recht:** im DPA mind. 1×/Jahr

## 7. Betroffenenrechte
- DSGVO Art. 15-22 vollständig durchsetzbar gegen Mindrails (Single Point of Contact: info@phonbot.de)
- DPF-Beschwerdeverfahren über OpenAI direkt + DPRC verfügbar

## 8. Bewertung

Der Datentransfer ist ausreichend abgesichert weil:
1. **Zero-Retention** für API-Tier eliminiert den Großteil der Speicherrisiken bei OpenAI selbst — ohne gespeicherte Daten kann nichts beschlagnahmt werden.
2. **DPF-Zertifizierung** + EO 14086 + DPRC schaffen die rechtsstaatlichen Garantien, die der EuGH in Schrems II vermisst hatte.
3. **Datenminimierung** auf reine Text-Transkripte (kein Audio) reduziert Sensitivität.
4. **TLS in transit + AES at rest** schützen vor passivem Mithören.

**Rest-Risiko: niedrig** — der Trade-off zwischen DSGVO-Compliance und der technischen Notwendigkeit eines Sprach-Modells für KI-Telefonassistenz ist mit OpenAI + DPF + Zero-Retention ausreichend austariert.

**Ergebnis:** ☑ **Transfer rechtmäßig** unter den genannten Schutzmaßnahmen.

## 9. Re-Verifikation

| Datum | Verifiziert von | Änderungen seit letzter Prüfung | DPF-Status |
|---|---|---|---|
| 2026-04-30 | Hassieb Kalla | initiale Erstellung | aktiv |

**Nächste Re-Verifikation:** 2026-10-30
