# Transfer Impact Assessment (TIA) — `<Anbieter>`

> Pflicht-Dokument nach Schrems II (EuGH C-311/18) für jeden Datentransfer in ein Drittland ohne Angemessenheitsbeschluss. Eines pro Sub-Processor.
>
> **Stand:** YYYY-MM-DD · **Verantwortlich:** Hassieb Kalla, Mindrails UG · **Re-Verifikation:** halbjährlich

---

## 1. Verantwortlicher (Datenexporteur)

- **Firma:** Mindrails UG (haftungsbeschränkt)
- **Sitz:** Scharnhorststraße 8, 12307 Berlin, Deutschland
- **Anwendung:** Phonbot — KI-Telefonassistent SaaS
- **Geschäftsführung:** Hassieb Kalla
- **DSB:** *kein bestellter DSB; geringe Zahl von Beschäftigten unter Pflichtschwelle*

## 2. Datenimporteur (Sub-Processor)

- **Firma:** `<offizieller Name lt. AGB>`
- **Sitz / Hauptsitz:** `<Stadt, Bundesstaat, USA>`
- **EU-Tochter (sofern vorhanden):** `<Name + Sitz>`
- **Rolle:** Auftragsverarbeiter (Art. 4 Nr. 8 DSGVO) bzw. Sub-Auftragsverarbeiter
- **Vertragsart:** `<DPA + SCC Modul X>` / `<DPF + DPA>` / nur EU-Vertrag

## 3. Welche personenbezogenen Daten werden übertragen?

| Datenkategorie | Beispiel | Sensitivität | Art. 9 DSGVO? |
|---|---|---|---|
| `<…>` | `<…>` | gewöhnlich / hoch | nein / ja |

**Übertragungs-Volumen:** ca. `<X>` Datensätze/Monat · ca. `<Y>` Anrufer/Monat
**Übertragungs-Frequenz:** kontinuierlich (Stream) / periodisch / on-demand
**Speicherdauer beim Importeur:** `<X>` Tage / Zero-Retention / Trainings-Ausschluss

## 4. Welcher Schutz gilt vertraglich?

- [ ] DPA gemäß Art. 28 DSGVO unterzeichnet (Datum: `YYYY-MM-DD`, Datei: `compliance/dpas/<anbieter>/...`)
- [ ] EU-Standardvertragsklauseln (SCC), Modul `<2 / 3>`, Datum: `YYYY-MM-DD`
- [ ] EU-US Data Privacy Framework (DPF) — Status verifiziert am `YYYY-MM-DD` auf [dataprivacyframework.gov/list](https://www.dataprivacyframework.gov/list)
- [ ] Sonstiges: `<z. B. ISO 27001, SOC 2 Type II, BCR>`

## 5. Welches Drittlandsrecht gilt?

**USA:**
- **FISA 702** (50 U.S.C. § 1881a): Geheimdienst-Zugriff auf Daten US-amerikanischer „Electronic Communications Service Providers" möglich, ohne Richter-Anordnung im Einzelfall, Schrems-II-Hauptkritikpunkt.
- **CLOUD Act** (18 U.S.C. § 2713): US-Behörden können von US-Unternehmen die Herausgabe von Daten verlangen, auch wenn die Daten außerhalb der USA gespeichert sind.
- **Executive Order 14086** (2022) + **DPF Review Court** (2023): zusätzliche Rechtsbehelfe für EU-Bürger; Grundlage des aktuellen DPF-Angemessenheitsbeschlusses.

**Risiko-Bewertung des Anbieter-Risikos für FISA 702:**
- [ ] Anbieter fällt unter „Electronic Communications Service Provider" Definition (eher hohes Risiko)
- [ ] Anbieter ist regulärer SaaS ohne Carrier-/ISP-Funktion (geringeres Risiko)

## 6. Welche zusätzlichen Schutzmaßnahmen sind implementiert?

### Technisch
- [ ] **Verschlüsselung in transit:** TLS 1.2+ zwischen Phonbot und Anbieter
- [ ] **Verschlüsselung at rest beim Anbieter:** `<Status laut AVV>`
- [ ] **Verschlüsselung at rest bei uns:** AES-256-GCM für sensible Felder, Supabase-TDE für DB
- [ ] **Pseudonymisierung vor Übertragung:** `<ja / nein / teilweise>`
- [ ] **PII-Filter:** Pino-redact + `redactPII()` vor allen Logs

### Organisatorisch
- [ ] **Datenminimierung:** `<welche Felder werden bewusst NICHT übertragen>`
- [ ] **Zweckbindung:** kontraktlich auf Vertragserfüllung beschränkt
- [ ] **Access-Control beim Anbieter:** `<Status laut SOC 2 / ISO 27001>`

### Vertraglich
- [ ] **Behörden-Anfragen-Notification:** AVV/SCC verpflichtet Anbieter, Mindrails über behördliche Datenanfragen zu informieren (sofern rechtlich zulässig).
- [ ] **Audit-Recht:** mind. 1× jährlich, mit 30 Tagen Vorlauf.
- [ ] **Sub-Processor-Wechsel:** 30-Tage-Vorlauf-Pflicht.

## 7. Können Betroffene ihre Rechte durchsetzen?

- **EU-DSGVO-Rechte beim Verantwortlichen (Mindrails):** ja, vollständig (Art. 15-22) — Single Point of Contact via `info@phonbot.de`.
- **DPF-Beschwerdeverfahren** (sofern Anbieter zertifiziert): ja, über DPF-Panel + DPRC.
- **Klage in den USA:** für EU-Bürger praktisch unwirksam ohne DPF; mit DPF + EO 14086 erweiterte Rechtsbehelfe verfügbar.

## 8. Bewertung

> Trotz der theoretischen Zugriffsmöglichkeiten von US-Behörden nach FISA 702 / CLOUD Act ist der Datentransfer in folgenden Punkten ausreichend abgesichert:
> 1. `<konkrete Maßnahme 1>`
> 2. `<konkrete Maßnahme 2>`
> 3. `<konkrete Maßnahme 3>`
>
> Rest-Risiko: `<niedrig / mittel / hoch>` — `<Begründung>`

**Ergebnis:**

- [ ] **Transfer rechtmäßig** unter den genannten Schutzmaßnahmen
- [ ] **Transfer nur mit zusätzlichen Maßnahmen rechtmäßig** — diese sind: `<Liste>`
- [ ] **Transfer NICHT rechtmäßig** — Konsequenz: Anbieter ablösen oder Daten anders verarbeiten

## 9. Re-Verifikation

| Datum | Verifiziert von | Änderungen seit letzter Prüfung | DPF-Status |
|---|---|---|---|
| `YYYY-MM-DD` | Hassieb Kalla | initiale Erstellung | `<aktiv / inaktiv>` |

**Nächste Re-Verifikation fällig:** `YYYY-MM-DD` (+6 Monate)

---

## Quellen / weiterführende Literatur

- EuGH-Urteil C-311/18 („Schrems II") — https://curia.europa.eu/juris/document/document.jsf?docid=228677
- EU-Kommission Angemessenheitsbeschluss EU-US DPF (10.07.2023) — https://eur-lex.europa.eu/eli/dec_impl/2023/1795
- EDPB Empfehlungen 01/2020 zu zusätzlichen Maßnahmen — https://edpb.europa.eu/system/files/2021-06/edpb_recommendations_202001vo.2.0_supplementarymeasurestransferstools_en.pdf
- TIA-Tool der CNPD Luxemburg — https://tia.cnpd.lu/
- DPF-Liste (verifizieren) — https://www.dataprivacyframework.gov/list
