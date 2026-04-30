# Phonbot · Compliance-Akte

Zentrale Ablage für alle DSGVO-relevanten Dokumente. Dieses Verzeichnis ist die operative Ergänzung zum öffentlichen AVV (`/avv/`) und der öffentlichen Sub-Processor-Liste (`/sub-processors/`).

## Struktur

```
compliance/
├── README.md                       ← diese Datei
├── dpa-checklist.md                ← lebendiger Status pro Anbieter
├── vvt.md                          ← Verzeichnis Verarbeitungstätigkeiten (Art. 30 DSGVO)
├── mindrails-dpa-template.md       ← eigener Standard-DPA zum Mitschicken
│
├── dpa-requests/                   ← Mail-Vorlagen für DPA-Anfragen
│   ├── 2026-04-30-retell-dpa-request.eml
│   └── 2026-04-30-cartesia-dpa-request.eml
│
├── tias/                           ← Transfer Impact Assessments (Schrems II)
│   ├── _template.md
│   ├── TIA-OpenAI.md
│   ├── TIA-Retell.md
│   ├── TIA-Twilio.md
│   ├── TIA-Cartesia.md
│   ├── TIA-ElevenLabs.md
│   ├── TIA-Resend.md
│   ├── TIA-Sentry.md
│   └── TIA-Cloudflare.md
│
├── dpas/                           ← signierte/akzeptierte DPAs (gitignored)
│   ├── retell/
│   ├── cartesia/
│   ├── openai/
│   ├── twilio/
│   ├── supabase/
│   ├── ionos/
│   ├── stripe/
│   ├── resend/
│   ├── sentry/
│   ├── elevenlabs/
│   └── cloudflare/
│
└── dpf-verifications/              ← halbjährliche Screenshots von dataprivacyframework.gov (gitignored)
```

## Was ist getrackt vs. ignoriert?

| Pfad | Status | Grund |
|---|---|---|
| `README.md` · `dpa-checklist.md` · `vvt.md` · `mindrails-dpa-template.md` | **getrackt** | Reproduzierbar + Team-einsehbar |
| `dpa-requests/*.eml` | **getrackt** | Mail-Templates, keine Geheimnisse |
| `tias/*.md` | **getrackt** | Eigene Bewertungen, kein Anbieter-Geheimnis |
| `dpas/**` | gitignored | enthält Vertragstexte mit potenziell vertraulichen Anbieter-Informationen |
| `tias/<vertraulich>` | gitignored falls erweitert | bei Bedarf separat schützen |
| `dpf-verifications/` | gitignored | Screenshots können Anbieter-spezifische Identifier enthalten |

Siehe `.gitignore` Sektion „Compliance".

## Workflow

### A. Neuer Sub-Processor wird hinzugefügt
1. AVV-Anfrage an Anbieter — entweder Click-Wrap im Dashboard oder per Mail (Vorlage in `dpa-requests/` ableiten)
2. Signed DPA als PDF in `dpas/<anbieter>/<datum>-DPA.pdf` ablegen
3. TIA für US-Anbieter: `tias/_template.md` kopieren als `TIA-<Anbieter>.md`, ausfüllen
4. **Öffentliche Sub-Processor-Liste** auf `apps/web/public/sub-processors/index.html` ergänzen
5. **AVV** (`apps/web/public/avv/index.html`) Anhang 2 erweitern
6. Mail an Bestandskunden (mind. 30 Tage Vorlauf) mit Hinweis auf neuen Sub-Processor
7. `vvt.md` Sektion erweitern, falls Verarbeitungstätigkeit neu

### B. DPA-Re-Verifikation (halbjährlich)
1. DPF-Status auf https://www.dataprivacyframework.gov/list für jeden US-Anbieter prüfen
2. Screenshot in `dpf-verifications/<datum>-<anbieter>.png` ablegen
3. Falls Anbieter dezertifiziert: TIA neu bewerten, ggf. SCC nachverhandeln, ggf. Anbieter wechseln
4. Bei Re-Verifikation: kurze Notiz in der TIA-Tabelle „Re-Verifikation"
5. Status in `dpa-checklist.md` updaten

### C. Datenschutzverletzung tritt ein
1. Innerhalb **48 Stunden** nach Kenntniserlangung interne Doku im Incident-Response-Prozess (separate Akte: `compliance/incidents/`)
2. Innerhalb **72 Stunden** Meldung an die zuständige Aufsichtsbehörde (für Mindrails: BlnBDI Berlin) — Pflicht nach Art. 33 DSGVO
3. Falls hohes Risiko für Betroffene: zusätzlich Meldung an Betroffene (Art. 34 DSGVO)
4. Sub-Processor-seitige Verletzungen: müssen vom Anbieter gemäß DPA innerhalb von 48h an Mindrails gemeldet werden

### D. Datenauskunfts-/Löschungsanfrage einer betroffenen Person
1. Kontakt: info@phonbot.de
2. Identitäts-Verifikation
3. Phonbot-Daten: Auto-Tools im Admin-Dashboard (`/admin/leads`, `/admin/users`)
4. Bei Sub-Processor-Daten: Anbieter kontaktieren, Auskunft/Löschung anstoßen, Bestätigung beim Anbieter einholen
5. Bestätigung an Betroffenen, max. **1 Monat** nach Anfrage (Art. 12 Abs. 3 DSGVO)

## Verantwortlichkeiten

| Verantwortung | Rolle |
|---|---|
| Geschäftsführung Datenschutz | Hans Waier, Geschäftsführer |
| Vertragsabschluss DPA / SCC | Geschäftsführung |
| Technische Sicherheitsmaßnahmen | Engineering-Lead (Hans Waier) |
| Anlaufstelle Betroffenenrechte | info@phonbot.de |
| DSGVO-Behörde (Aufsicht) | Berliner Beauftragte für Datenschutz und Informationsfreiheit (BlnBDI), Friedrichstraße 219, 10969 Berlin |

## Rechtliche Eckpunkte

- **AVV-Pflicht:** Art. 28 DSGVO
- **VVT-Pflicht:** Art. 30 DSGVO
- **TIA-Pflicht:** Schrems II (EuGH C-311/18) + EDPB Empfehlungen 01/2020
- **§5 TMG (Impressum):** offen — HRB + USt-IdNr fehlen aktuell noch
- **§ 147 AO (Steuerrecht):** 10-Jahre-Aufbewahrung für Rechnungen — wird in `vvt.md` Sektion E getrackt
- **§ 201 StGB (Aufzeichnungs-Verbot):** Anrufer muss vor Aufzeichnung explizit einwilligen — Phonbot setzt Recording per Default OFF, Recording-Decline-Mode konfigurierbar pro Customer
