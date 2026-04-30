# DPA / SCC / TIA Checkliste — Phonbot Sub-Processoren

Stand: 2026-04-30 · Owner: Hassieb · Ziel: vor Live-Launch alle Häkchen.

Verwende dies als Tracking-Liste. Lege jede signierte/heruntergeladene Vertragskopie ab unter `compliance/dpas/<anbieter>/<datum>-<dokument>.pdf`.

## Click-Wrap (~5 min pro Anbieter)

| Anbieter | DPA-Dialog | DPF? | Status | Datei abgelegt |
|---|---|---|---|---|
| **Supabase** | [supabase.com/legal/dpa](https://supabase.com/legal/dpa) → Dashboard → Settings → Organization → Legal | EU-only (Frankfurt) | ⬜ | ⬜ |
| **OpenAI** | [openai.com/policies/data-processing-addendum](https://openai.com/policies/data-processing-addendum/) → platform.openai.com → Settings → Compliance | DPF ✓ | ⬜ | ⬜ |
| **Twilio** | [twilio.com/legal/data-processing-addendum](https://www.twilio.com/en-us/legal/data-processing-addendum) → Console → Compliance | DPF ✓ | ⬜ | ⬜ |
| **Stripe** | DPA ist Teil der ToS bei Stripe Payments Europe Ltd (Dublin) — Dashboard → Settings → Compliance | EU-Vertrag | ⬜ | ⬜ |
| **Resend** | [resend.com/legal/dpa](https://resend.com/legal/dpa) → Account → Settings → Legal | SCC inkludiert | ✅ 2026-04-30 | ✅ `dpas/resend/2026-04-30-Resend-DPA-DocuSign.pdf` |
| **Sentry** | [sentry.io/legal/dpa](https://sentry.io/legal/dpa/) → Settings → Organization → Legal | DPF ✓ | ⬜ | ⬜ |
| **ElevenLabs** | [elevenlabs.io/dpa](https://elevenlabs.io/dpa) → Account → Settings → Legal | SCC inkludiert | ⬜ | ⬜ |
| **Cloudflare** | [cloudflare.com/cloudflare-customer-dpa](https://www.cloudflare.com/cloudflare-customer-dpa/) → Account Home → Configurations | DPF ✓ | ⬜ | ⬜ |
| **IONOS** | IONOS-Kundencenter → Vertragsunterlagen → "AV-Vertrag (Art. 28 DSGVO)" · alternativ direkt: [ionos.de/terms-gtc/terms-data-processing](https://www.ionos.de/terms-gtc/terms-data-processing) | EU-only · BSI C5 zertifiziert | ✅ 2026-04-30 | ✅ `dpas/ionos/2026-04-30-IONOS-AVV.pdf` |

## Per E-Mail anfragen (Mail-Vorlagen liegen unter `compliance/dpa-requests/`)

| Anbieter | E-Mail | Vorlage | Status |
|---|---|---|---|
| **Retell AI** | ~~support@retellai.com, legal@retellai.com~~ — direkt via DocuSign-Self-Service akzeptiert (Mail-Anfrage nicht mehr nötig) | [`2026-04-30-retell-dpa-request.eml`](dpa-requests/2026-04-30-retell-dpa-request.eml) (obsolet) | ✅ 2026-04-30 DocuSign-signiert · `dpas/retell/2026-04-30-Retell-DPA-DocuSign.pdf` |
| **Cartesia** | support@cartesia.ai, legal@cartesia.ai | [`2026-04-30-cartesia-dpa-request.eml`](dpa-requests/2026-04-30-cartesia-dpa-request.eml) | ⬜ versendet ⬜ Antwort erhalten ⬜ DPA signiert |

**Wie versenden:**
1. Doppelklick auf die `.eml`-Datei → öffnet sich in Outlook/Thunderbird/Apple Mail mit allen Headers vorbelegt
2. Absender prüfen (muss `info@phonbot.de` sein)
3. Senden

Alternativ: die Mail manuell aus dem Webmail-Account schreiben und den Text aus der `.eml` hineinkopieren.

## DPF-Status verifizieren

Nach jedem Click-Wrap kurz auf [dataprivacyframework.gov/list](https://www.dataprivacyframework.gov/list) prüfen, ob der Anbieter aktuell zertifiziert ist (kann sich monatlich ändern). Screenshot ablegen unter `compliance/dpf-verifications/<datum>-<anbieter>.png`.

**Halbjährliche Re-Verifikation einplanen** — am einfachsten als wiederkehrender Kalender-Termin.

## TIA (Transfer Impact Assessment)

Pflicht nach Schrems II für jeden US-Anbieter. Eine TIA pro Anbieter, ca. 2-3 Seiten:

1. ⬜ TIA-OpenAI
2. ⬜ TIA-Retell
3. ⬜ TIA-Twilio
4. ⬜ TIA-Cartesia
5. ⬜ TIA-ElevenLabs
6. ⬜ TIA-Resend
7. ⬜ TIA-Sentry
8. ⬜ TIA-Cloudflare

**Vorlage:** [tia.cnpd.lu](https://tia.cnpd.lu/) (Luxemburg, kostenlos, EU-anerkannt) oder GDD-Template (~50 €).

Ablage: `compliance/tias/TIA-<anbieter>.docx`.

## VVT (Verzeichnis von Verarbeitungstätigkeiten)

Pflicht nach Art. 30 DSGVO. Eine Excel/Notion-Tabelle pro Verarbeitungs-Zweck.

⬜ VVT angelegt unter `compliance/vvt.xlsx`
⬜ Verarbeitungszweck "Voice-Agent für Geschäftskunden" eingetragen
⬜ Verarbeitungszweck "Demo + Lead-Generierung" eingetragen
⬜ Verarbeitungszweck "Outbound-Rückrufe" eingetragen

**Vorlage:** [Bayerisches Landesamt für Datenschutzaufsicht — kleine Unternehmen](https://www.lda.bayern.de/de/kleine-unternehmen.html), kostenlos, gerichtsfest.

## Compliance-Akte (final ablage-Struktur)

```
compliance/
├── dpa-checklist.md                 ← diese Datei (lebendiges Dokument)
├── dpa-requests/                    ← Mail-Vorlagen für Anfragen
│   ├── 2026-04-30-retell-dpa-request.eml
│   └── 2026-04-30-cartesia-dpa-request.eml
├── dpas/                            ← signierte/akzeptierte DPAs
│   ├── supabase/
│   ├── openai/
│   ├── twilio/
│   └── ...
├── tias/                            ← Transfer Impact Assessments
│   ├── TIA-OpenAI.docx
│   └── ...
├── dpf-verifications/               ← halbjährliche Screenshots
└── vvt.xlsx                         ← Verzeichnis Verarbeitungstätigkeiten
```

## Reminder bei jedem Sub-Processor-Wechsel

Wenn ein Anbieter dazukommt oder wegfällt:
1. ⬜ Neuen DPA + ggf. SCC + ggf. TIA abschließen
2. ⬜ `apps/web/public/sub-processors/index.html` aktualisieren
3. ⬜ Mail an alle Bestandskunden — **mindestens 30 Tage vor Wirksamwerden**
4. ⬜ Änderung im "Änderungs-Historie"-Block der Sub-Processor-Seite eintragen
5. ⬜ AVV ggf. neu versionieren (Stand-Datum + Version-Bump)
