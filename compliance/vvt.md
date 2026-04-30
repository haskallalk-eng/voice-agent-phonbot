# Verzeichnis von Verarbeitungstätigkeiten (VVT) — Mindrails UG / Phonbot

> Pflicht-Dokument nach **Art. 30 Abs. 1 DSGVO** für jeden Verantwortlichen mit ≥ 250 Beschäftigten ODER bei nicht-gelegentlicher / risikoreicher Verarbeitung. Beides trifft auf Mindrails zu (Phonbot verarbeitet kontinuierlich personenbezogene Daten von Anrufern).
>
> **Stand:** 2026-04-30 · **Version:** 1.0 · **Verantwortlich:** Hassieb Kalla, Geschäftsführer

## A. Verantwortlicher

| Feld | Wert |
|---|---|
| Firma | Mindrails UG (haftungsbeschränkt) |
| Anschrift | Scharnhorststraße 8, 12307 Berlin |
| Vertretungsberechtigt | Hassieb Kalla, Geschäftsführer |
| Kontakt Datenschutz | info@phonbot.de · +49 30 75937169 |
| Datenschutzbeauftragter | *kein bestellter DSB; Mindrails liegt unter den Pflichtschwellen des § 38 BDSG (regelmäßig < 20 Personen mit DV-Tätigkeiten, keine Kerngeschäfts-Verarbeitung besonderer Kategorien)* |

---

## B. Verarbeitungstätigkeit Nr. 1 — **Voice-Agent für Geschäftskunden**

| Feld | Wert |
|---|---|
| Zweck | Bereitstellung KI-gestützter Telefonassistenz für Geschäftskunden („Phonbot Live"); Annahme eingehender Anrufe, Termin-Verwaltung, Rückruf-Tickets |
| Rechtsgrundlage | Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung mit Geschäftskunde) — für Endkunden-Anrufer: zusätzlich Art. 6 Abs. 1 lit. f (berechtigtes Interesse des Anrufers an Anliegen-Bearbeitung + Geschäftskunden an effizienter Kundenkommunikation) |
| Betroffene | Anrufer der Geschäftskunden (Endverbraucher, Interessenten, Bestandskunden) |
| Datenkategorien | Stammdaten (Name, Telefonnummer, E-Mail), Inhaltsdaten (Audio sofern aktiviert, Transkripte, Anliegen-Zusammenfassungen), Metadaten (Datum, Dauer, Outcome) |
| Empfänger / Sub-Processoren | Supabase (DB, EU), IONOS (Hosting, EU), Retell AI (Voice-Runtime, US-SCC), OpenAI (LLM, US-DPF+SCC), Twilio (Telefonie, US-DPF+SCC), Cartesia (TTS, US-SCC), ElevenLabs (TTS-Clone, US-SCC, optional), Resend (Mail, US-SCC), Sentry (Error-Monitoring, US-DPF+SCC), Cloudflare (CDN+CAPTCHA, US-DPF+SCC) |
| Drittlandtransfer | USA — Schutzgarantien: SCC + ggf. DPF + TIA pro Anbieter (siehe `compliance/tias/`) |
| Aufbewahrungsfrist | Anrufer-Daten: 90 Tage rolling für nicht-konvertierte Leads; bis Vertragsende für Bestandskunden-Anrufe; max. 10 Jahre für Rechnungs-relevante Metadaten (§ 147 AO) |
| TOMs | siehe AVV Anhang 1 (`/avv/#a1`); zentral: AES-256-GCM at rest, TLS in transit, PII-Redaction in Logs, Rate-Limits, CAPTCHA, Multi-Tenant-org_id-Scoping |

---

## C. Verarbeitungstätigkeit Nr. 2 — **Demo + Lead-Generierung**

| Feld | Wert |
|---|---|
| Zweck | Kostenlose Voice-Agent-Demo auf phonbot.de zur Produktdemonstration + Leadgewinnung |
| Rechtsgrundlage | Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse: Produktdemonstration + Lead-Aufnahme nach freiwilliger Anfrage) |
| Betroffene | Website-Besucher, die aktiv die Demo nutzen oder das Rückruf-Formular ausfüllen |
| Datenkategorien | bei Webcall-Demo: Audio-Stream + Transkript; bei Rückruf-Formular: Name, E-Mail, Telefonnummer; bei beiden: Anliegen-Zusammenfassung |
| Empfänger / Sub-Processoren | gleiche Liste wie B, ohne ElevenLabs (kein Voice-Clone in Demos) |
| Drittlandtransfer | wie B |
| Aufbewahrungsfrist | 90 Tage rolling, danach Auto-Delete via `cleanupOldLeads()` in `apps/api/src/db.ts` |
| Widerspruchsrecht | Anrufer kann „Kein Interesse" / „Nicht mehr anrufen" sagen → Sales-Agent beendet Gespräch + setzt `status='lost'`. Manueller Widerspruch über info@phonbot.de möglich |
| TOMs | wie B + zusätzlich: CAPTCHA (Turnstile) auf Form, Rate-Limit auf /demo-Endpunkten, Anti-Toll-Fraud Whitelist DACH-only |

---

## D. Verarbeitungstätigkeit Nr. 3 — **Outbound-Rückrufe**

| Feld | Wert |
|---|---|
| Zweck | Initiierung ausgehender Anrufe an Anrufer, die einen Rückruf angefordert haben |
| Rechtsgrundlage | Art. 6 Abs. 1 lit. a DSGVO (Einwilligung durch Formular-Eintragung) ergänzt um Art. 6 Abs. 1 lit. b (Vertragserfüllung) |
| Betroffene | Personen, die das Rückruf-Formular ausgefüllt haben |
| Datenkategorien | identisch mit C; zusätzlich Outbound-Call-Metadaten (Wahlversuch, Verbindungsstatus, Dauer) |
| Empfänger / Sub-Processoren | wie B; zentral: Twilio + Retell |
| Drittlandtransfer | wie B |
| Aufbewahrungsfrist | wie C: 90 Tage |
| Sonderschutz | KI-Identifikation per Default in Outbound-Agent-Prompt („Sie sprechen mit einer KI-Telefonassistenz"); DSGVO Art. 21 Widerspruchsrecht aktiv; DIN-5009-konformes Buchstabieren in Agent-Prompt |
| TOMs | wie C + zusätzlich: Country-Whitelist DACH, Premium-Nummer-Blocklist, hourly + global Rate-Cap, isPlausiblePhone() Validierung |

---

## E. Verarbeitungstätigkeit Nr. 4 — **Account- und Rechnungsverarbeitung Geschäftskunden**

| Feld | Wert |
|---|---|
| Zweck | Authentifizierung Geschäftskunden, Rechnung, Zahlungsabwicklung, Kommunikation rund um den Vertrag |
| Rechtsgrundlage | Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung) + Art. 6 Abs. 1 lit. c (rechtliche Verpflichtung — § 147 AO Aufbewahrungspflicht) |
| Betroffene | Geschäftskunden + ggf. deren Mitarbeiter mit Phonbot-Account |
| Datenkategorien | Anmeldedaten (E-Mail, gehashtes Passwort), Rechnungsdaten (Firma, Anschrift, USt-IdNr, Rechnungsbetrag, Zahlungsstatus), Login-Audit-Logs |
| Empfänger / Sub-Processoren | Supabase (DB), Stripe (Zahlungsabwicklung, EU/Dublin), Resend (Mail) |
| Drittlandtransfer | Stripe-EU-Vertrag (Dublin); Resend-US-SCC |
| Aufbewahrungsfrist | Login-Logs 30 Tage; Account-Daten bis zur Vertragsbeendigung; Rechnungs-relevante Metadaten **10 Jahre** (§ 147 Abs. 1 Nr. 4 AO) |
| TOMs | Bcrypt-Hash für Passwörter, JWT-In-Memory + Refresh-Cookie httpOnly, Stripe-Webhook-Signatur-Verifikation, Idempotenz-Tabelle für Webhook-Replays |

---

## F. Verarbeitungstätigkeit Nr. 5 — **Verbesserung der KI-Modelle (interne Korrekturen-Loop)**

| Feld | Wert |
|---|---|
| Zweck | Trainingssignal-Generierung für nächste Vorschlags-Generator-Generation: Plattform-Admins korrigieren bestimmte Auto-Vorschläge manuell, das Tupel (Original + Korrektur + Begründung) wird in `learning_corrections` gespeichert |
| Rechtsgrundlage | Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an Produkt-Qualitätssicherung) |
| Betroffene | indirekt: Anrufer, deren Gespräch zur Korrektur-Generierung beitrug — aber: PII-Filter entfernt Telefonnummern, E-Mails, Kontodaten vor der Speicherung |
| Datenkategorien | Korrektur-Tupel: Original-Vorschlag-Text, überarbeiteter Text, Begründung, Admin-E-Mail (für Audit), Datum |
| Empfänger | nur Mindrails-intern; OpenAI bekommt diese Tupel als Few-Shot-Beispiele in nachfolgenden Vorschlags-Generator-Calls (siehe Verarbeitung B) |
| Drittlandtransfer | indirekt über OpenAI (siehe TIA-OpenAI), aber Tupel sind PII-bereinigt |
| Aufbewahrungsfrist | **365 Tage**; danach Auto-Delete |
| Widerspruchsrecht | DSGVO Art. 21 — schriftliche Anfrage an info@phonbot.de, dann manuelle Löschung des betroffenen Tupels |
| TOMs | PII-Redaction-Filter VOR Schreiben in `learning_corrections`; separate Tabelle, kein FK auf Anrufer-IDs |

---

## G. Änderungs-Historie

| Datum | Version | Änderung |
|---|---|---|
| 2026-04-30 | 1.0 | Initiale Erstellung mit 5 Verarbeitungstätigkeiten |
