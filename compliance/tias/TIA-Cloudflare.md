# Transfer Impact Assessment (TIA) — Cloudflare

> **Stand:** 2026-04-30 · **Verantwortlich:** Hassieb Kalla, Mindrails UG · **Re-Verifikation:** 2026-10-30

## 1. Verantwortlicher
Mindrails UG, Berlin · Phonbot.

## 2. Datenimporteur
**Cloudflare, Inc.** · 101 Townsend Street, San Francisco, CA 94107, USA · *(EU-Vertragspartner möglich: Cloudflare Germany GmbH)* · Rolle: Sub-Auftragsverarbeiter (Edge/CDN/CAPTCHA) · Vertrag: DPA + SCC (Click-Wrap auf cloudflare.com/cloudflare-customer-dpa) · DPF: aktiv.

## 3. Übertragene Daten
| Kategorie | Beispiel | Sensitivität | Art. 9? |
|---|---|---|---|
| HTTP-Request-Header | User-Agent, Referer, Accept-Language | gewöhnlich | nein |
| IP-Adressen Anrufer | für DDoS-Schutz + Rate-Limit | gewöhnlich (kann personenbeziehbar sein) | nein |
| Turnstile-CAPTCHA-Tokens | bei Demo-/Outbound-Submissions | n/a | n/a |
| TLS-Termination-Daten | Zertifikat-Verhandlung | n/a | n/a |
| **Inhalte (Request-/Response-Bodies)** | **passieren Cloudflare-Edge in transit, KEINE Speicherung** | n/a | n/a |

**Volumen:** alle phonbot.de-HTTP-Requests · **Frequenz:** kontinuierlich (Edge-Layer) · **Speicherdauer beim Importeur:** Logs typisch 24h-30 Tage; CAPTCHA-Tokens ephemeral.

## 4. Schutz vertraglich
- [ ] DPA via Account → Configurations — `compliance/dpas/cloudflare/<datum>-DPA.pdf`
- [ ] SCC im DPA
- [x] **DPF aktiv** (zu verifizieren halbjährlich)
- [x] ISO 27001, SOC 2 Type II, PCI DSS

## 5. US-Drittlandsrecht
**FISA 702:** Cloudflare als CDN könnte als „remote computing service" eingestuft werden. **CLOUD Act:** US-Firma. EO 14086 + DPRC via DPF.

## 6. Zusätzliche Schutzmaßnahmen
- [x] TLS 1.2+ End-to-End (Cloudflare → Origin Hetzner/IONOS auch verschlüsselt)
- [x] **Datenminimierung:** Cloudflare ist reine Edge-Funktion ohne persistente Inhalts-Speicherung
- [x] **DACH-Region-Routing:** Cloudflare-Edge-Nodes verteilen sich global, aber für DACH-User wird typisch über FRA/Paris/AMS terminiert (kein Trans-Atlantik-Hop für 99 % der Phonbot-Visitors)
- [x] **Turnstile** ist DSGVO-bewusst gestaltet (kein User-Tracking-Cookie, keine Cross-Site-Identifier)
- [x] **Logs-Retention** auf 24h gestellt (statt Default 30 Tage)
- [ ] **Cloudflare Workers / R2 / KV** werden NICHT verwendet → kein zusätzlicher Daten-Stack bei Cloudflare

## 7. Betroffenenrechte
DSGVO Art. 15-22 durchsetzbar gegen Mindrails. Cloudflare hat eigenständige Datenschutz-Erklärung + Anlaufstelle für DSGVO-Anfragen, parallel als Edge-Provider.

## 8. Bewertung

**Hauptschutz: Edge-only ohne persistente Speicherung von Anrufer-Inhalten + DPF + Logs auf 24h reduziert.** IP-Adressen sind das einzige tatsächlich personenbeziehbare Datum, das passieren kann; FISA-702-Risiko ist im Vergleich zu Twilio (echter Carrier) deutlich kleiner, weil Cloudflare reines Routing macht.

**Rest-Risiko: niedrig** (vorbehaltlich DPA-Akzeptanz im Dashboard)

**Ergebnis:** ☑ **Transfer rechtmäßig** unter den genannten Schutzmaßnahmen.

## 9. Re-Verifikation
| Datum | Status | DPF |
|---|---|---|
| 2026-04-30 | initiale Erstellung | aktiv |

**Re-Check:** 2026-10-30
