# UX-Konzept — Voice Agent SaaS
_"Futuristic, simple, instant value"_

---

## Philosophie

> Der User soll seinen Agent **hören** bevor er sich registriert.
> Keine Kreditkarte, kein Formular-Marathon, kein technisches Jargon.
> Jeder Schritt liefert sofort sichtbaren/hörbaren Wert.

**Benchmark-Referenzen:**
- **GoodCall**: Agent-Nummer sofort, keine Wartezeit
- **Synthflow**: Live-Demo auf der Landingpage, Flow-Preview
- **Linear**: Futuristic Design, Speed-first
- **Cal.com**: 1-Klick-Kalenderanbindung via OAuth

---

## Der komplette Flow (Landing → Paying Customer)

### Phase 0 — Landing Page (kein Account nötig)

```
┌─────────────────────────────────────────────────┐
│  🎙️ "Dein KI-Telefonassistent in 2 Minuten"   │
│                                                   │
│  [Hör dir an wie dein Agent klingt →]            │
│                                                   │
│  ▶ Demo-Call direkt im Browser starten           │
│    (kein Account, kein Login)                     │
│                                                   │
│  💇 Friseur  🔧 Handwerk  🏥 Praxis  🧹 Mehr   │
└─────────────────────────────────────────────────┘
```

**Ablauf:**
1. User klickt "Friseur" Template
2. Demo-Agent startet SOFORT im Browser (Retell Web Call)
3. Agent begrüßt: _"Hallo, hier ist der KI-Assistent von Demo-Salon. Wie kann ich Ihnen helfen?"_
4. User spricht mit Agent → **Wow-Moment in 10 Sekunden**
5. Nach dem Call: _"Gefällt dir dein Agent? In 2 Minuten gehört er dir."_
6. → CTA: **"Jetzt meinen Agent erstellen"** → Registration

### Phase 1 — Registrierung (minimal)

```
┌─────────────────────────────────────┐
│  Erstelle deinen Account            │
│                                       │
│  Email:     [________________]       │
│  Passwort:  [________________]       │
│                                       │
│  [Weiter →]                          │
│                                       │
│  Kein Kreditkarte nötig · Gratis    │
└─────────────────────────────────────┘
```

- **Nur 2 Felder**: Email + Passwort
- Org-Name kommt im nächsten Step
- Kein Captcha, keine Bestätigung
- JWT → direkt eingeloggt

### Phase 2 — Setup-Wizard (4 Schritte, inline)

Alle Steps auf einer Seite, mit smooth Scroll/Transitions.
Futuristic: glassmorphism, subtle animations, dunkles Theme möglich.

#### Step 1: Template wählen
```
Was für ein Business hast du?

💇 Friseur        🔧 Handwerker
🏥 Arztpraxis     🧹 Reinigung
🍕 Restaurant     ⚙️ Eigener Agent
```
→ Auswahl füllt alles vor. User sieht sofort den vorgeschlagenen Agentennamen, Stimme, Begrüßung.

#### Step 2: Dein Business
```
Name:           [Salon Müller          ]
Adresse:        [Hauptstr. 12, Berlin  ]  (optional)
Öffnungszeiten: [Mo-Fr 9-18, Sa 9-14  ]
Services:       [Schnitt, Färben, ...  ]
```
→ Rechts daneben: **Live-Preview** des Agent-Prompts (vereinfacht, kein Jargon)
→ _"Dein Agent wird sagen: Hallo, hier ist der Assistent von Salon Müller..."_

#### Step 3: Sofort hören — Test-Call
```
┌──────────────────────────────────────┐
│  🎙️ Dein Agent ist bereit!          │
│                                        │
│     [  ● Jetzt anrufen  ]             │
│                                        │
│  Sprich mit deinem personalisierten    │
│  Agent direkt über den Browser.        │
└──────────────────────────────────────┘
```
→ Agent begrüßt mit dem echten Business-Namen
→ User testet 30 Sekunden
→ **Zweiter Wow-Moment**

#### Step 4: Nummer verbinden
```
┌──────────────────────────────────────┐
│  📞 Verbinde deine Telefonnummer     │
│                                        │
│  Option A: Neue Nummer erhalten       │
│  Wir geben dir eine lokale Nummer     │
│  die dein Agent sofort beantwortet.   │
│  [Nummer aktivieren →]                │
│                                        │
│  Option B: Bestehende Nummer          │
│  Leite Anrufe an deinen Agent weiter: │
│                                        │
│  1. Öffne deine Telefoneinstellungen  │
│  2. Rufumleitung bei Besetzt auf:     │
│     📋 +49 30 1234567 [Kopieren]      │
│  3. Fertig! Teste mit einem Anruf.    │
│                                        │
│  [Ich habs eingerichtet ✓]            │
│                                        │
│  ○ Später machen (überspringe)        │
└──────────────────────────────────────┘
```

**Schlüsselinsight aus GoodCall:** Die Nummer-Anbindung muss idiotensicher sein.
- Option A: Wir kaufen via Retell/Twilio eine lokale Nummer
- Option B: Schritt-für-Schritt Anleitung mit Bildschirmfotos für iPhone/Android/Fritzbox
- Kein SIP-Jargon, keine Ports, keine DNS-Einträge

### Phase 3 — Kalender-Anbindung (optional, im Wizard oder danach)

```
┌──────────────────────────────────────┐
│  📅 Kalender verbinden (optional)    │
│                                        │
│  Dein Agent kann direkt Termine       │
│  buchen wenn du deinen Kalender       │
│  verbindest.                          │
│                                        │
│  [🟢 Google Calendar verbinden]       │
│  [🔵 Microsoft Outlook verbinden]     │
│  [📅 Cal.com verbinden]               │
│                                        │
│  Oder: Agent nimmt Terminwünsche      │
│  entgegen und du buchst manuell.      │
│                                        │
│  [Ohne Kalender weiter →]             │
└──────────────────────────────────────┘
```

**Implementation:**
- Google Calendar: OAuth 2.0 → `calendar.events.insert` Scope
- Cal.com: OAuth oder API Key (einfachster Weg)
- Outlook: Microsoft Graph OAuth
- Fallback: Agent erstellt ein Ticket mit Terminwunsch → Owner bekommt E-Mail

### Phase 4 — Dashboard (nach Wizard)

```
┌──────────────────────────────────────────────────────┐
│  🎙️ Voice Agent                      Salon Müller   │
│                                                        │
│  ┌─────────┬─────────┬─────────┬────────┐            │
│  │ 0 Calls │ 30 Min  │ 0       │ Free   │            │
│  │ heute   │ übrig   │ Tickets │ Plan   │            │
│  └─────────┴─────────┴─────────┴────────┘            │
│                                                        │
│  ⚡ Quick Actions:                                     │
│  [Agent testen]  [Nummer verbinden]  [Plan upgraden]  │
│                                                        │
│  📊 Letzte Calls        📋 Offene Tickets             │
│  (noch keine)           (noch keine)                   │
└──────────────────────────────────────────────────────┘
```

### Phase 5 — Upgrade (Stripe Checkout, in-app)

Trigger-Punkte:
- Minuten aufgebraucht → Banner: _"Du hast 28 von 30 Gratis-Minuten verbraucht"_
- Feature-Gate: Telefonnummer nur ab Starter
- Billing-Page mit Plan-Vergleich

**Kein Pop-up, kein Druck.** Dezentes Banner + Billing-Page.

---

## Design-System — Futuristic

### Farben
- **Primary**: Deep Indigo (#4F46E5) → Electric Violet
- **Bg**: Near-black (#0F0F14) oder Off-white (#FAFAFA) (light/dark toggle)
- **Accent**: Cyan-Glow (#06B6D4) für CTAs und Active-States
- **Glass**: `backdrop-blur-xl bg-white/5 border-white/10`

### Typografie
- Headlines: Inter oder Satoshi, Bold
- Body: Inter, Regular
- Mono (Code): JetBrains Mono

### Animationen
- Smooth step-transitions (Framer Motion / CSS transitions)
- Pulsing mic icon während Agent spricht
- Glassmorphism Cards
- Subtle gradient borders

### Mobile
- Vollständig responsive
- Test-Call funktioniert auf Mobile-Browser
- Nummer-Setup mit Deep-Links zu Telefon-Einstellungen

---

## Technische Implementation — Anbindungen

### 1. Telefonnummer-Anbindung

**Option A — Wir stellen die Nummer (einfachster Weg):**
```
POST /api/phone-numbers/provision
  → Retell: retell.createPhoneNumber({ areaCode: '030' })
  → Speichert phoneNumberId + number in org
  → Agent wird automatisch zugewiesen
```
User sieht: _"Deine Nummer: +49 30 1234567 — Anrufe werden ab sofort von deinem Agent beantwortet."_

**Option B — Rufumleitung (bestehende Nummer):**
```
Wir zeigen eine Schritt-für-Schritt Anleitung:

iPhone:
  Einstellungen → Telefon → Rufumleitung → An: [unsere Nummer]

Android:
  Telefon App → ⋮ → Einstellungen → Anrufweiterleitung → Bei Besetzt: [unsere Nummer]

Fritzbox:
  Telefonie → Rufumleitung → Neue Rufumleitung
  → Bei besetzt → An: [unsere Nummer]
```
Wir speichern nur dass der User die Weiterleitung eingerichtet hat.

**Option C — SIP Trunk (Advanced, für Agenturen):**
Nur im Agency-Plan. Standard SIP-Credentials.

### 2. Kalender-Anbindung

**Google Calendar (empfohlen für v1):**
```
1. User klickt "Google Calendar verbinden"
2. OAuth Flow → wir bekommen access_token + refresh_token
3. Agent-Tool calendar.findSlots:
   → GET /calendars/primary/freeBusy
   → Findet freie Slots
4. Agent-Tool calendar.book:
   → POST /calendars/primary/events
   → Erstellt Termin mit Kundenname + Telefon
5. User bekommt Termin in seinem Google Calendar
```

**Cal.com (Alternative):**
```
1. User gibt Cal.com Username ein (oder OAuth)
2. Agent nutzt Cal.com API:
   → GET /availability → freie Slots
   → POST /bookings → Buchung erstellen
3. Cal.com sendet automatisch Bestätigung an Kunden
```

**Ohne Kalender (Fallback):**
```
Agent sagt: "Ich notiere Ihren Terminwunsch und wir melden uns."
→ Ticket wird erstellt
→ Owner bekommt E-Mail mit Kundendaten + gewünschtem Termin
→ Owner bucht manuell und ruft zurück
```

### 3. Nummern-Code-System (Verifizierung)

Damit wir sicherstellen dass die Weiterleitung funktioniert:
```
1. User richtet Weiterleitung ein
2. Klickt "Verifizieren"
3. Wir rufen die Originalnummer an
4. Call wird an unsere Nummer weitergeleitet
5. Unser System erkennt den eingehenden Call
6. ✅ "Verifiziert! Dein Agent beantwortet jetzt Anrufe."
```

---

## Prioritäten für Implementation

### Sprint 1 (diese Woche):
1. Landing-Page mit Live-Demo-Call (kein Login nötig)
2. Neuer Onboarding-Wizard (komplett überarbeitet)
3. Telefonnummer-Provisioning (Option A: Retell/Twilio)
4. Setup-Anleitung für Rufumleitung (Option B)

### Sprint 2:
5. Google Calendar OAuth + Tools
6. Dashboard-Redesign mit Quick Actions + Stats
7. Dark-Mode / Futuristic Theme

### Sprint 3:
8. Cal.com Integration
9. Rufumleitungs-Verifizierung
10. Mobile-Optimierung

---

## Key Metriken (was wir tracken)

| Metrik | Ziel |
|---|---|
| Landing → Demo-Call | >40% |
| Demo-Call → Registration | >25% |
| Registration → Agent deployed | >80% |
| Agent deployed → Nummer verbunden | >50% |
| Free → Paid (30 Tage) | >15% |
