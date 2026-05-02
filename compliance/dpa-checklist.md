# DPA / SCC / TIA Checkliste — Phonbot Sub-Processoren

Stand: 2026-04-30 · Owner: Hassieb · Ziel: vor Live-Launch alle Häkchen.

Verwende dies als Tracking-Liste. Lege jede signierte/heruntergeladene Vertragskopie ab unter `compliance/dpas/<anbieter>/<datum>-<dokument>.pdf`.

## Click-Wrap (~5 min pro Anbieter)

| Anbieter | DPA-Dialog | DPF? | Status | Datei abgelegt |
|---|---|---|---|---|
| **Supabase** | [supabase.com/legal/dpa](https://supabase.com/legal/dpa) → Dashboard → Settings → Organization → Legal · DocuSign-Flow | EU-only (Frankfurt) | ✅ 2026-05-02 (DocuSign) | ✅ `dpas/supabase/2026-05-02-Supabase-DPA-DocuSign.pdf` |
| **OpenAI** | DPA **by-incorporation** in OpenAI Services Agreement — keine separate Annahme nötig. PDF von [openai.com/policies/data-processing-addendum](https://openai.com/policies/data-processing-addendum/) als Dokumentations-Nachweis. **EU-Vertragspartner: OpenAI Ireland Ltd.** | DPF ✓ + EU-Vertragspartner (Ireland) | ✅ 2026-05-02 by-incorporation | ✅ `dpas/openai/2026-05-02-OpenAI-DPA.pdf` |
| **Twilio** | DPA **by-incorporation** in Customer Agreement — keine separate Annahme nötig. PDF-Text von [twilio.com/legal/data-protection-addendum](https://www.twilio.com/legal/data-protection-addendum) als Dokumentations-Nachweis | DPF ✓ + BCRs + SCC + UK-IDTA (4 parallele Mechanismen) | ✅ 2026-05-02 by-incorporation (April-2026-Version) | ✅ `dpas/twilio/2026-05-02-Twilio-DPA-text.md` |
| **Stripe** | DPA **by-incorporation** in Stripe Services Agreement. EU-Customer = Stripe Payments Europe Ltd (Dublin). PDF von Dashboard → Settings → Compliance als Dokumentations-Nachweis | EU-Vertragspartner (Dublin) | ✅ 2026-05-02 by-incorporation (DPA-Version 2025-Nov-18) | ✅ `dpas/stripe/2026-05-02-Stripe-DPA-2025-Nov-18.pdf` |
| **Resend** | [resend.com/legal/dpa](https://resend.com/legal/dpa) → Account → Settings → Legal | SCC inkludiert | ✅ 2026-04-30 | ✅ `dpas/resend/2026-04-30-Resend-DPA-DocuSign.pdf` |
| **Sentry** | DocuSign-Flow via Sentry Settings → Organization → Legal → "Sign DPA" | DPF ✓ | ✅ 2026-05-02 (DocuSign — Customer-Entity „Mindrails", siehe Re-Sign-TODO) | ✅ `dpas/sentry/2026-05-02-Sentry-DPA-DocuSign.pdf` |
| **ElevenLabs** | DPA **by-incorporation** in ElevenLabs Terms of Use („Our Data Processing Addendum, which governs our processing..."). PDF-Text von [elevenlabs.io/dpa](https://elevenlabs.io/dpa) als Dokumentations-Nachweis. Materiell relevant erst sobald Voice-Clone-Add-on aktiviert wird | DPF + SCC Modul 2/3 (PL Gerichtsstand) + UK Addendum | ✅ 2026-05-02 by-incorporation | ✅ `dpas/elevenlabs/2026-05-02-ElevenLabs-DPA-text.md` |
| **Cloudflare** | DPA **by-incorporation** in Self-Serve Subscription Agreement — keine separate Annahme nötig. PDF von [cloudflare.com/cloudflare-customer-dpa](https://www.cloudflare.com/cloudflare-customer-dpa/) als Dokumentations-Nachweis | DPF ✓ | ✅ 2026-05-02 (gültig via Subscription, DPA v6.4) | ✅ `dpas/cloudflare/2026-05-02-Cloudflare-DPA-v6.4.pdf` |
| **IONOS** | IONOS-Kundencenter → Vertragsunterlagen → "AV-Vertrag (Art. 28 DSGVO)" · alternativ direkt: [ionos.de/terms-gtc/terms-data-processing](https://www.ionos.de/terms-gtc/terms-data-processing) | EU-only · BSI C5 zertifiziert | ✅ 2026-04-30 | ✅ `dpas/ionos/2026-04-30-IONOS-AVV.pdf` |

## Per E-Mail anfragen (Mail-Vorlagen liegen unter `compliance/dpa-requests/`)

| Anbieter | E-Mail | Vorlage | Status |
|---|---|---|---|
| **Retell AI** | ~~support@retellai.com, legal@retellai.com~~ — direkt via DocuSign-Self-Service akzeptiert (Mail-Anfrage nicht mehr nötig) | [`2026-04-30-retell-dpa-request.eml`](dpa-requests/2026-04-30-retell-dpa-request.eml) (obsolet) | ✅ 2026-04-30 DocuSign-signiert · `dpas/retell/2026-04-30-Retell-DPA-DocuSign.pdf` |
| **Cartesia** | ~~support@cartesia.ai~~ — Cartesia-Support antwortete mit Verweis auf [cartesia.ai/legal/dpa](https://www.cartesia.ai/legal/dpa). DPA ist **by-incorporation** Teil der Master Service Agreement, keine separate Signatur nötig. **TODO: Zero Data Retention im Account aktivieren** | [`2026-04-30-cartesia-dpa-request.eml`](dpa-requests/2026-04-30-cartesia-dpa-request.eml) (obsolet) | ✅ 2026-05-02 by-incorporation · `dpas/cartesia/2026-05-02-Cartesia-DPA-text.md` |

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
