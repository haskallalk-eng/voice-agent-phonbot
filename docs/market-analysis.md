# Market Analysis — Voice Agent SaaS
_Stand: März 2026_

---

## 1. Wettbewerber-Übersicht

| Anbieter | Positionierung | Pricing-Modell | Zielgruppe |
|---|---|---|---|
| **Retell AI** | Voice-Infra für Entwickler | Pay-as-you-go, $0.07–0.31/min | Dev-Teams, Agenturen |
| **Vapi** | Developer-first Voice API | Pay-as-you-go | Entwickler |
| **Synthflow** | No-code Voice Agent Builder | Usage-based, Free-Start + Enterprise | SMB bis Enterprise |
| **Bland AI** | Enterprise AI Call Center | Enterprise-only, self-hosted | Large Enterprise |
| **Twilio Flex** | Contact Center Platform | $1/active user hour oder $150/user/mo | Enterprise |
| **Aircall** | Cloud Phone System | Seat-based, ab ~$40/user/mo | SMB Sales/Support |

### Key Insights:
- **Retell, Vapi** = Infrastruktur-Layer — kein fertiges Produkt für Endkunden
- **Synthflow** = nächster Wettbewerber: No-code Builder, Free-to-start, White-Label für Reseller
- **Bland** = Enterprise, großes Ticket-Sales
- **Marktlücke**: Einfaches, sofort nutzbares Voice Agent Produkt für **lokale Businesses** (Handwerk, Friseur, Arztpraxis) mit klarem deutschen/europäischen Fokus

---

## 2. Was konvertiert gut — Pricing & Onboarding Patterns

### Pricing-Modelle nach Conversion-Rate (Industrie-Standard):

**1. Freemium / Free-Start** (höchste Trial-to-Paid-Conversion ~15–25%)
- Kein Kreditkartenpflicht zum Start
- Limitiertes Gratis-Kontingent (z.B. 50 Minuten/Monat)
- Upgrade-Prompts wenn Limit erreicht
- → Synthflow macht das genau so

**2. Flat-Rate mit Minutenkontingent** (einfachste Kaufentscheidung)
- z.B. Starter 49€/mo = 300 Min inkl.
- Überschreitung = €/Min
- Kunden wissen was sie zahlen — niedrige Abbruchrate

**3. Per-Minute ohne Grundgebühr** (niedrigste Einstiegshürde, schlechter für Retention)
- Gut für Testen, schlecht für Bindung
- Kunden denken zu viel über Kosten nach

**Empfehlung für uns:** Flat-Rate-Tier + Minuten-Add-On

---

## 3. Beste UX Patterns für Conversion

### Onboarding (kritischster Schritt):

**Was funktioniert:**
- ✅ "5-Minuten Setup" — Agent sofort konfigurieren und testen ohne Kreditkarte
- ✅ Vorausgefüllte Templates ("Friseur-Agent starten", "Handwerker-Agent starten")
- ✅ Sofort hörbares Ergebnis — User muss beim Onboarding mit dem Agent sprechen können
- ✅ Progress-Indicator: Setup-Wizard statt leerer Formular
- ✅ Telefonnummer-Step am Ende (Commitment-Punkt nach "Wow-Moment")

**Was tötet Conversion:**
- ❌ Kreditkarte vor erstem Test
- ❌ Technisches Jargon ("LLM", "STT", "webhook")
- ❌ Leere State ohne Guidance
- ❌ Zu viele Felder beim Register (nur Email + Passwort)

### Dashboard UX:

**Best Practice (gelernt aus Intercom, Crisp, Freshdesk):**
- Single-Page-App mit klarer Navigation
- "Health" Widget oben: Minuten verbraucht, Calls heute, offene Tickets
- Agent-Status immer sichtbar (deployed / nicht deployed)
- Call-Transcript direkt im Dashboard lesbar
- Mobile-friendly (Owner checkt Tickets vom Handy)

---

## 4. Feature-Prioritäten für eine verkaufsfähige Software

### Must-Have (ohne das kein Verkauf):
1. **Agent-Konfiguration ohne Code** — Formular mit Business-Name, Öffnungszeiten, Services
2. **Live-Test direkt im Browser** — Mic-Button, sofort sprechen
3. **Telefonnummer zuweisen** — Eingehende Calls landen beim Agent
4. **Call-Logs + Transcripts** — Was hat der Agent gesagt?
5. **Ticket/Callback-System** — Was konnte der Agent nicht lösen?
6. **Auth + Multi-Tenant** ✅ bereits gebaut
7. **Billing / Subscription** — Stripe, klare Pläne

### Should-Have (für Retention & Upsell):
8. **Analytics Dashboard** — Calls/Tag, Conversion-Rate, durchschnittliche Call-Dauer
9. **Öffnungszeiten-Logik** — Agent sagt "wir sind gerade geschlossen"
10. **Mehrsprachigkeit** — DE + EN mindestens ✅ vorbereitet
11. **Wissensdatenbank / FAQ Upload** — PDF/Text hochladen, Agent kennt Antworten
12. **E-Mail-Benachrichtigungen bei neuen Tickets**
13. **Webhook-Integration** — z.B. in Kalender (Cal.com, Google Calendar)

### Nice-to-Have (Enterprise/später):
14. **White-Label** — Agentur verkauft unter eigenem Brand
15. **Invite/Team-Management** — mehrere User pro Org
16. **SSO / SAML**
17. **Audit Logs**
18. **Custom Telefonnummern-Pool**

---

## 5. Unser Produkt-Fit & Differenzierung

### Wer ist unser Kunde?
**Primär:** Lokale Dienstleister in DACH (Friseur, Handwerker, Arztpraxis, Reinigung)
- Kein Tech-Background
- Brauchen jemanden der Anrufe abnimmt wenn sie beschäftigt sind
- Budget: 49–149€/Monat
- Entscheidung in <5 Minuten

**Sekundär:** Agenturen die Voice Agents für ihre Kunden konfigurieren (Reseller)
- Wollen White-Label
- Budget: 200–500€/Monat pro Kunde

### Unser Vorteil:
- **DACH-fokussiert** — Deutsche Stimmen, DSGVO-konform, deutsches UI
- **Kein Tech-Setup** — sofort nutzbar
- **Retell als Infra** — wir bauen nur das Produkt drauf

---

## 6. Empfohlene Produkt-Roadmap

### Phase 1 — Sellable MVP (jetzt):
- [x] Auth + Multi-Tenant
- [ ] Onboarding-Wizard (Template-Auswahl → Business-Daten → Test-Call → Telefonnummer)
- [ ] Stripe Billing (2 Pläne: Starter 49€/mo, Pro 149€/mo)
- [ ] E-Mail bei neuem Ticket (Resend/Postmark)
- [ ] Öffnungszeiten-Logik im Agent

### Phase 2 — Retention & Upsell:
- [ ] Analytics Dashboard (Calls, Minuten, Tickets)
- [ ] Wissensdatenbank Upload (PDF → RAG)
- [ ] Kalender-Integration (Cal.com API)
- [ ] Transcript-Anzeige im Dashboard

### Phase 3 — Scale:
- [ ] White-Label / Reseller
- [ ] Team-Invite
- [ ] Multi-Agent pro Org
- [ ] Outbound Calls (Terminerinnerungen)

---

## 7. Empfohlene Pricing-Struktur

| Plan | Preis | Inkl. | Überschreitung |
|---|---|---|---|
| **Free** | 0€ | 30 Min/Mo, 1 Agent | — (kein Upgrade-Prompt) |
| **Starter** | 49€/Mo | 300 Min, 1 Agent, 1 Nummer | 0.12€/Min |
| **Pro** | 149€/Mo | 1.000 Min, 3 Agents, 2 Nummern | 0.10€/Min |
| **Agency** | 399€/Mo | 5.000 Min, 10 Agents, White-Label | 0.08€/Min |

_Unsere Kosten bei Retell: ~0.07€/Min → Marge ~40–70% je nach Plan_
