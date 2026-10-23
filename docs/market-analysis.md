# Historische Markthypothesen — Voice Agent SaaS
_Planungsnotiz vom März 2026; keine aktuelle Markt- oder Preisrecherche._

Anbieterangaben, Budgets, Preise und Produktideen unten sind damalige Arbeitsannahmen. Sie wurden hier nicht anhand aktueller Quellen oder Kundendaten verifiziert und belegen keine Conversion, Marge oder Compliance.

---

## 1. Damalige Wettbewerber-Annahmen

| Anbieter | Positionierung | Pricing-Modell | Zielgruppe |
|---|---|---|---|
| **Retell AI** | Voice-Infra für Entwickler | Pay-as-you-go, $0.07–0.31/min | Dev-Teams, Agenturen |
| **Vapi** | Developer-first Voice API | Pay-as-you-go | Entwickler |
| **Synthflow** | No-code Voice Agent Builder | Usage-based, Free-Start + Enterprise | SMB bis Enterprise |
| **Bland AI** | Enterprise AI Call Center | Enterprise-only, self-hosted | Large Enterprise |
| **Twilio Flex** | Contact Center Platform | $1/active user hour oder $150/user/mo | Enterprise |
| **Aircall** | Cloud Phone System | Seat-based, ab ~$40/user/mo | SMB Sales/Support |

### Positionierungshypothesen:
- **Retell, Vapi** = Infrastruktur-Layer — kein fertiges Produkt für Endkunden
- **Synthflow** = nächster Wettbewerber: No-code Builder, Free-to-start, White-Label für Reseller
- **Bland** = Enterprise, großes Ticket-Sales
- **Marktlücke**: Einfaches, sofort nutzbares Voice Agent Produkt für **lokale Businesses** (Handwerk, Friseur, Arztpraxis) mit klarem deutschen/europäischen Fokus

---

## 2. Zu prüfende Pricing- und Onboarding-Hypothesen

### Modelloptionen; keine gemessene Rangfolge:

**1. Freemium / Free-Start**
- Kein Kreditkartenpflicht zum Start
- Limitiertes Gratis-Kontingent (z.B. 50 Minuten/Monat)
- Upgrade-Prompts wenn Limit erreicht
- Hypothese: Ein Einstieg ohne Zahlungshürde erleichtert den ersten Test.

**2. Flat-Rate mit Minutenkontingent**
- z.B. Starter 89€/mo = 300 Min inkl.
- Überschreitung = €/Min
- Hypothese: Ein sichtbares Kontingent erleichtert die Kostenplanung.

**3. Per-Minute ohne Grundgebühr**
- Hypothese: Nutzungsabhängige Kosten erleichtern kleine Tests.
- Offene Frage: Wie beeinflusst variable Abrechnung Nutzung und Bindung?

**Empfehlung für uns:** Flat-Rate-Tier + Minuten-Add-On

---

## 3. UX-Ideen für Nutzertests

### Onboarding (kritischster Schritt):

**Zu testende Erleichterungen:**
- ✅ "5-Minuten Setup" — Agent sofort konfigurieren und testen ohne Kreditkarte
- ✅ Vorausgefüllte Templates ("Friseur-Agent starten", "Handwerker-Agent starten")
- ✅ Sofort hörbares Ergebnis — User muss beim Onboarding mit dem Agent sprechen können
- ✅ Progress-Indicator: Setup-Wizard statt leerer Formular
- ✅ Telefonnummer-Step am Ende (Commitment-Punkt nach "Wow-Moment")

**Mögliche Hürden:**
- ❌ Kreditkarte vor erstem Test
- ❌ Technisches Jargon ("LLM", "STT", "webhook")
- ❌ Leere State ohne Guidance
- ❌ Zu viele Felder beim Register (nur Email + Passwort)

### Dashboard UX:

**Vorgeschlagene Dashboard-Elemente:**
- Single-Page-App mit klarer Navigation
- "Health" Widget oben: Minuten verbraucht, Calls heute, offene Tickets
- Agent-Status immer sichtbar (deployed / nicht deployed)
- Call-Transcript direkt im Dashboard lesbar
- Mobile-friendly (Owner checkt Tickets vom Handy)

---

## 4. Feature-Prioritäten für eine verkaufsfähige Software

### Damals priorisierte Kernfunktionen:
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

## 5. Zielgruppen- und Differenzierungshypothesen

### Wer ist unser Kunde?
**Primär:** Lokale Dienstleister in DACH (Friseur, Handwerker, Arztpraxis, Reinigung)
- Kein Tech-Background
- Brauchen jemanden der Anrufe abnimmt wenn sie beschäftigt sind
- Angenommenes Budget: 89–349€/Monat, hier nicht durch Kundenbefragungen belegt
- Ziel: Nutzen und Einrichtung schnell verständlich machen; Entscheidungsdauer ungemessen

**Sekundär:** Agenturen die Voice Agents für ihre Kunden konfigurieren (Reseller)
- Wollen White-Label
- Angenommenes Budget: 200–500€/Monat pro Kunde, hier nicht durch Kundenbefragungen belegt

### Angestrebte Differenzierung:
- **DACH-fokussiert** — Deutsche Stimmen, deutsches UI; Datenschutzanforderungen gesondert prüfen
- **Einfachere Einrichtung** — Ziel für das Onboarding, keine gemessene Einrichtungszeit
- **Retell als Infra** — wir bauen nur das Produkt drauf

---

## 6. Empfohlene Produkt-Roadmap

### Phase 1 — damalige MVP-Planung:
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

## 7. Historischer Pricing-Entwurf

Illustrative Planannahmen; kein aktuelles Angebot und kein Nachweis wirtschaftlicher Tragfähigkeit:

| Plan | Preis | Inkl. | Überschreitung |
|---|---|---|---|
| **Free** | 0€ | 30 Min/Mo, 1 Agent | — (kein Upgrade-Prompt) |
| **Starter** | 89€/Mo | 300 Min, 1 Agent, 1 Nummer | 0.25€/Min |
| **Pro** | 179€/Mo | 900 Min, 3 Agents, 3 Nummern | 0.23€/Min |
| **Agency** | 349€/Mo | 2.000 Min, 10 Agents, White-Label | 0.19€/Min |

_Damals angenommener Retell-Kostenansatz: ~0.07€/Min; hier nicht verifiziert. Ohne vollständige Anbieter-, Telefonie-, Infrastruktur-, Support- und Auslastungsdaten lässt sich daraus keine belastbare Marge ableiten._
