// Generates industry-specific landing pages under apps/web/public/<slug>/index.html
// Slugs match TEMPLATES in apps/web/src/ui/landing/shared.ts — keep in sync!
// Run: node scripts/gen-landing-pages.mjs
import fs from 'node:fs';
import path from 'node:path';
import { NAV_STYLE, NAV_HTML } from './_nav.mjs';

const OUT_DIR = path.resolve('apps/web/public');

const BRANCHEN = [
  {
    slug: 'friseur',
    templateId: 'hairdresser',
    emoji: '✂️',
    h1Text: 'Nie wieder das <span class="accent">Telefon abnehmen</span> zwischen den Schnitten.',
    title: 'KI-Telefonassistent für Friseursalons · Termine automatisch buchen | Phonbot',
    description: 'Phonbot ist der KI-Telefonassistent speziell für Friseure & Salons. Bucht Termine direkt in Google Calendar, nimmt Walk-in-Anfragen an, beantwortet Öffnungszeiten — 24/7 auf Deutsch. Ab 49 €/Monat.',
    eyebrow: 'KI-Telefonassistent für Friseure',
    subtitle: 'Phonbot nimmt Anrufe an, bucht Termine direkt in deinen Kalender und beantwortet Standardfragen — während du föhnst, färbst oder schneidest. 24/7 auf Deutsch. Ab 49 €/Monat.',
    ogTitle: 'KI-Telefonassistent für Friseursalons · Phonbot',
    ogDesc: 'Nie wieder Terminanrufe zwischen den Schnitten annehmen. Phonbot nimmt Anrufe an, bucht Termine direkt — 24/7 auf Deutsch.',
    serviceName: 'KI-Telefonassistent für Friseursalons',
    audienceType: 'Friseursalons & Barbershops',
    features: [
      { icon: '📅', title: 'Terminbuchung', desc: '„Einen Haarschnitt am Donnerstag nachmittag?" — Phonbot prüft Kalender-Slots und bucht direkt. Keine Rückrufe nötig.' },
      { icon: '🕒', title: 'Öffnungszeiten', desc: '„Wann habt ihr Samstag offen?" — Phonbot antwortet sofort mit deinen konkreten Öffnungszeiten. Auch an Feiertagen.' },
      { icon: '💶', title: 'Preisauskunft', desc: '„Was kostet bei euch Färben?" — Phonbot kennt dein Leistungsverzeichnis und gibt präzise Preise weiter.' },
      { icon: '↩️', title: 'Rückruf-Tickets', desc: 'Für komplexe Anfragen (Beratungstermin, Spezial-Services) erstellt Phonbot automatisch ein Ticket mit allen Infos.' },
    ],
    dialogue: [
      { speaker: 'user', text: '📞 Kundin: „Hi, ich hätte gern einen Schnitt nächste Woche, am besten Donnerstag nachmittag."' },
      { speaker: 'bot', text: 'Phonbot: „Klar! Donnerstag haben wir um 14 Uhr und 16:30 Uhr frei — welche Zeit passt dir?"' },
      { speaker: 'user', text: '📞 Kundin: „16:30 Uhr."' },
      { speaker: 'bot', text: 'Phonbot: „Super, 16:30 Uhr Donnerstag ist gebucht. Dein Name bitte?"' },
      { speaker: 'user', text: '📞 Kundin: „Julia Müller."' },
      { speaker: 'bot', text: 'Phonbot: „Danke Julia. Du bekommst gleich eine Bestätigungs-SMS. Bis Donnerstag!"' },
    ],
    dialogueNote: '→ Termin automatisch in Google Calendar eingetragen · Dauer: 28 Sekunden',
    savings: {
      intro: 'Ein durchschnittlicher Salon mit 300 Anrufen/Monat kostet:',
      items: [
        '👤 <strong>Teilzeit-Rezeption</strong>: ~1.500 €/Monat',
        '📞 <strong>Phonbot Starter</strong>: 49 €/Monat (500 Min inkl.)',
        '💰 <strong>Ersparnis</strong>: ~1.450 €/Monat',
      ],
      hint: 'Plus: Keine Sprechpause, keine Krankheit, kein Urlaub — rund um die Uhr.',
    },
    faq: [
      { q: 'Kann Phonbot mehrere Stylisten im Salon unterscheiden?', a: 'Ja. Im Agent Builder legst du Mitarbeiter-Profile an, Phonbot bucht jedem den eigenen Kalender-Slot.' },
      { q: 'Was wenn eine Kundin sofort jemanden sprechen will?', a: 'Phonbot bietet Rückruf an („Ich notiere dich, ruf dich in 30 Min zurück") oder erstellt ein Prioritäts-Ticket.' },
      { q: 'Versteht Phonbot Friseur-Fachbegriffe (Pony, Balayage, Keratin)?', a: 'Ja. Die KI ist nativ auf deutschem Sprachgebrauch trainiert, inkl. Dialekte und Friseur-Fachbegriffe.' },
      { q: 'Kann ich meine bisherige Salon-Nummer behalten?', a: 'Ja. Rufweiterleitung bei deinem Telefonanbieter einrichten, fertig. Kein Nummernwechsel nötig.' },
    ],
    ctaHeading: 'Salon-Agent einrichten — 100 Freiminuten',
  },
  {
    slug: 'handwerker',
    templateId: 'tradesperson',
    emoji: '🔧',
    h1Text: 'Du bist auf der <span class="accent">Baustelle</span> — Phonbot nimmt den Anruf an.',
    title: 'KI-Telefonassistent für Handwerker & Handwerksbetriebe | Phonbot',
    description: 'Phonbot ist der KI-Telefonassistent speziell für Handwerker. Nimmt Aufträge entgegen, priorisiert Notfälle, erstellt Tickets mit Kundendaten — 24/7 auf Deutsch. Ab 49 €/Monat.',
    eyebrow: 'KI-Telefonassistent für Handwerk',
    subtitle: 'Phonbot nimmt Anrufe an während du auf der Baustelle bist, unterscheidet Notdienst von regulären Terminen und erstellt strukturierte Tickets mit Kundendaten und Priorität.',
    ogTitle: 'KI-Telefonassistent für Handwerker · Phonbot',
    ogDesc: 'Nie wieder Baustellen-Anrufe ins Leere laufen lassen. Phonbot nimmt Aufträge an, flaggt Notdienst, erstellt Tickets — 24/7.',
    serviceName: 'KI-Telefonassistent für Handwerksbetriebe',
    audienceType: 'Handwerksbetriebe (Heizung, Sanitär, Elektro, Fliesenleger, etc.)',
    features: [
      { icon: '📞', title: 'Auftragsannahme', desc: '„Ich hab einen Wasserschaden" — Phonbot nimmt Adresse, Art des Problems und Rückrufnummer auf.' },
      { icon: '🚨', title: 'Notdienst-Priorisierung', desc: 'Notfälle werden als Priorität "hoch" geflaggt und sofort per Push-Nachricht an dich weitergeleitet.' },
      { icon: '📅', title: 'Terminvereinbarung', desc: 'Reguläre Aufträge landen als Ticket mit Wunschtermin im Dashboard — keine Zettel mehr.' },
      { icon: '💶', title: 'Kostenvoranschlag-Anfrage', desc: 'Preisauskunft zu Standard-Leistungen sofort, für komplexe Angebote wird ein Termin vereinbart.' },
    ],
    dialogue: [
      { speaker: 'user', text: '📞 Kunde: „Meine Heizung geht nicht mehr, es ist Samstag!"' },
      { speaker: 'bot', text: 'Phonbot: „Oh je, das klingt dringend. Ich nehme deinen Notdienst-Fall sofort auf. Deine Adresse bitte?"' },
      { speaker: 'user', text: '📞 Kunde: „Hauptstraße 12 in Berlin."' },
      { speaker: 'bot', text: 'Phonbot: „Danke. Wie heißt du und unter welcher Nummer kann der Techniker dich zurückrufen?"' },
      { speaker: 'user', text: '📞 Kunde: „Thomas Schmidt, 0176-1234567."' },
      { speaker: 'bot', text: 'Phonbot: „Notdienst-Ticket ist erstellt mit Priorität hoch. Du wirst in ~15 Min zurückgerufen."' },
    ],
    dialogueNote: '→ Ticket mit Priorität=high im Dashboard · Push an Handwerker · Dauer: 34 Sek',
    savings: {
      intro: 'Ein Handwerker mit 200 Anrufen/Monat rechnet sich so:',
      items: [
        '👤 <strong>Angestellte Büro-Kraft</strong>: ~2.000 €/Monat',
        '📞 <strong>Phonbot Starter</strong>: 49 €/Monat',
        '💰 <strong>Ersparnis</strong>: ~1.950 €/Monat',
      ],
      hint: 'Plus: Auf der Baustelle ohne Unterbrechung weiterarbeiten.',
    },
    faq: [
      { q: 'Erkennt Phonbot den Unterschied zwischen Notfall und regulärem Termin?', a: 'Ja. Keywords wie "sofort", "Wasserschaden", "brennt" lösen automatisch Priorität-hoch aus. Du kannst im Agent Builder deine eigenen Notfall-Regeln ergänzen.' },
      { q: 'Kann ich unterwegs auf Anfragen reagieren?', a: 'Ja. Alle Tickets kommen im Dashboard an, zusätzlich per E-Mail-Benachrichtigung.' },
      { q: 'Versteht Phonbot Handwerks-Fachbegriffe (Thermostat, Siphon, etc.)?', a: 'Ja. Das LLM kennt deutsche Handwerks-Terminologie und kann bei Unklarheit gezielt nachfragen.' },
      { q: 'Was wenn mehrere Kunden gleichzeitig anrufen?', a: 'Phonbot nimmt mehrere Anrufe parallel an (eigener Agent pro Gespräch). Niemand hängt in der Warteschleife.' },
    ],
    ctaHeading: 'Handwerksbetrieb automatisieren — 100 Freiminuten',
  },
  {
    slug: 'arztpraxis',
    templateId: 'medical',
    emoji: '🩺',
    h1Text: 'Deine <span class="accent">MFA</span> ist am Limit? Phonbot nimmt den Druck raus.',
    title: 'KI-Telefonassistent für Arztpraxen · Terminvergabe 24/7 | Phonbot',
    description: 'Phonbot ist der KI-Telefonassistent speziell für Arztpraxen. Nimmt Terminanfragen, Rezeptwünsche und Notfälle entgegen, entlastet deine MFA — DSGVO-konform. Ab 49 €/Monat.',
    eyebrow: 'KI-Telefonassistent für Arztpraxen',
    subtitle: 'Phonbot unterstützt dein Praxis-Team bei Spitzenzeiten: nimmt Terminanfragen entgegen, notiert Rezeptverlängerungen, triagiert Notfälle und entlastet deine MFA spürbar. DSGVO-konform, Server in Deutschland.',
    ogTitle: 'KI-Telefonassistent für Arztpraxen · Phonbot',
    ogDesc: 'Entlaste dein Praxis-Team. Phonbot nimmt Termine, Rezepte und Anfragen entgegen — DSGVO-konform, 24/7.',
    serviceName: 'KI-Telefonassistent für Arztpraxen',
    audienceType: 'Arztpraxen, Therapeuten, medizinische Versorgungszentren',
    features: [
      { icon: '📅', title: 'Terminvergabe', desc: 'Patienten buchen Termine direkt im Praxis-Kalender. Wunschzeiten werden auf Verfügbarkeit geprüft.' },
      { icon: '💊', title: 'Rezept-Anfragen', desc: 'Anträge auf Rezeptverlängerung werden strukturiert erfasst, MFA ruft mit fertigem Rezept zurück.' },
      { icon: '🚨', title: 'Notfall-Triage', desc: 'Bei akuten Notfällen weist Phonbot an 112 zu rufen, sonst wird Prioritäts-Ticket erstellt.' },
      { icon: '🔒', title: 'DSGVO-konform', desc: 'Server in Deutschland, verschlüsselte Speicherung, PII-Redaction in Transkripten. AV-Vertrag verfügbar.' },
    ],
    dialogue: [
      { speaker: 'user', text: '📞 Patient: „Guten Tag, ich brauche mein Blutdruck-Rezept verlängert."' },
      { speaker: 'bot', text: 'Phonbot: „Gern. Ich notiere das als Rezept-Anfrage für die MFA. Dein Name und Geburtsdatum bitte?"' },
      { speaker: 'user', text: '📞 Patient: „Maria Schmidt, 12.03.1962."' },
      { speaker: 'bot', text: 'Phonbot: „Danke. Welches Medikament brauchst du?"' },
      { speaker: 'user', text: '📞 Patient: „Ramipril, 5mg."' },
      { speaker: 'bot', text: 'Phonbot: „Notiert. Die MFA ruft dich innerhalb von 24h mit dem fertigen Rezept zurück."' },
    ],
    dialogueNote: '→ Ticket für MFA · Patient muss nicht in Warteschleife · Dauer: 38 Sek',
    savings: {
      intro: 'Entlastung für eine mittelgroße Praxis (500 Anrufe/Monat):',
      items: [
        '👤 <strong>2. Teilzeit-MFA</strong>: ~1.800 €/Monat',
        '📞 <strong>Phonbot Pro</strong>: 149 €/Monat (inkl. 2.000 Min)',
        '💰 <strong>Ersparnis</strong>: ~1.650 €/Monat',
      ],
      hint: 'Plus: Bestehende MFA macht weniger Überstunden, weniger Burnout-Risiko.',
    },
    faq: [
      { q: 'Ist Phonbot DSGVO-konform für Patientendaten?', a: 'Ja. Server in Deutschland, AES-256 verschlüsselt, AV-Vertrag verfügbar. PII-Redaction entfernt sensible Daten aus Transkripten.' },
      { q: 'Kann Phonbot zwischen Akut- und Routine-Fällen unterscheiden?', a: 'Ja. Keywords wie "Schmerzen", "akut", "Notfall" triggern Priorisierung. Bei echten Notfällen weist Phonbot an 112 zu rufen.' },
      { q: 'Passt das zu meiner Praxis-Software?', a: 'Phonbot arbeitet mit dem Kalender-System (Google, Outlook, Cal.com). Direkte Integration mit PVS-Systemen auf Anfrage.' },
      { q: 'Werden Gespräche aufgenommen?', a: 'Standardmäßig werden Transkripte erstellt, keine Audio-Aufzeichnung. Patienten werden zu Gesprächsbeginn auf die KI-Nutzung hingewiesen.' },
    ],
    ctaHeading: 'Praxis-Team entlasten — 100 Freiminuten',
  },
  {
    slug: 'reinigung',
    templateId: 'cleaning',
    emoji: '🧹',
    h1Text: 'Keine <span class="accent">Auftragsanfrage</span> mehr verpassen — auch beim Putzen.',
    title: 'KI-Telefonassistent für Reinigungsfirmen | Phonbot',
    description: 'Phonbot ist der KI-Telefonassistent für Reinigungsbetriebe. Nimmt Auftragsanfragen entgegen, erfasst Objekt-Details (Größe, Frequenz), plant Besichtigungstermine — 24/7 auf Deutsch. Ab 49 €/Monat.',
    eyebrow: 'KI-Telefonassistent für Reinigung',
    subtitle: 'Phonbot nimmt Auftragsanfragen an, erfasst Objekt-Details und Leistungswünsche, und bucht Besichtigungstermine — während dein Team bei Kunden vor Ort putzt. 24/7 auf Deutsch.',
    ogTitle: 'KI-Telefonassistent für Reinigungsfirmen · Phonbot',
    ogDesc: 'Während du putzt, nimmt Phonbot Anfragen an, erfasst Objekt-Details und plant Termine.',
    serviceName: 'KI-Telefonassistent für Reinigungsbetriebe',
    audienceType: 'Gebäudereinigung, Büroreinigung, Privatreinigung, Glasreinigung',
    features: [
      { icon: '📋', title: 'Angebots-Anfrage', desc: 'Phonbot erfasst Objekt-Art, Quadratmeter, Reinigungs-Intervall, Spezialwünsche — du schickst das Angebot.' },
      { icon: '📅', title: 'Besichtigung buchen', desc: 'Für größere Aufträge bucht Phonbot automatisch Vor-Ort-Termine im Kalender.' },
      { icon: '🏢', title: 'Kundenarten unterscheiden', desc: 'Privatkunde, Gewerbe, Eigentümergemeinschaft — jede Branche mit eigenen Rückfragen.' },
      { icon: '↩️', title: 'Reklamations-Tickets', desc: 'Bei Qualitäts-Beschwerden wird sofort ein Ticket mit Priorität erstellt — der Teamleiter wird benachrichtigt.' },
    ],
    dialogue: [
      { speaker: 'user', text: '📞 Kunde: „Hallo, ich suche für unser Büro eine wöchentliche Reinigung."' },
      { speaker: 'bot', text: 'Phonbot: „Gern. Wie groß ist das Büro in Quadratmetern?"' },
      { speaker: 'user', text: '📞 Kunde: „Ca. 200 qm, 8 Arbeitsplätze, 2 Meetingräume."' },
      { speaker: 'bot', text: 'Phonbot: „Verstanden. Gibt es besondere Wünsche — Glas, Teppich-Tiefenreinigung?"' },
      { speaker: 'user', text: '📞 Kunde: „Teppich alle 3 Monate, Glas monatlich."' },
      { speaker: 'bot', text: 'Phonbot: „Perfekt. Ich notiere alles. Unser Team schickt dir bis morgen ein konkretes Angebot."' },
    ],
    dialogueNote: '→ Detailliertes Ticket im Dashboard · Angebot-E-Mail automatisch an Vertrieb · Dauer: 44 Sek',
    savings: {
      intro: 'Typische Reinigungsfirma mit 150 Auftragsanfragen/Monat:',
      items: [
        '👤 <strong>Verwaltung/Disposition</strong>: ~1.800 €/Monat',
        '📞 <strong>Phonbot Starter</strong>: 49 €/Monat',
        '💰 <strong>Ersparnis</strong>: ~1.750 €/Monat',
      ],
      hint: 'Plus: Keine Anfragen gehen verloren wenn das Team unterwegs ist.',
    },
    faq: [
      { q: 'Kann Phonbot nach Reinigungs-Art filtern (Unterhaltsreinigung vs. Grundreinigung)?', a: 'Ja. Im Agent Builder definierst du deine Leistungspakete mit Fragen zur Unterscheidung.' },
      { q: 'Was bei Notdienst-Reinigung (z.B. Wasserschaden)?', a: 'Phonbot flaggt Notfälle automatisch als Priorität-hoch. Du bekommst sofortige Push-Nachricht.' },
      { q: 'Kann ich verschiedene Service-Gebiete abdecken?', a: 'Ja. Phonbot fragt die PLZ ab und leitet je nach Gebiet an das richtige Team weiter (Agent Builder Routing-Regeln).' },
      { q: 'Lässt sich Phonbot für Hausreinigung UND Gewerbe gleichzeitig nutzen?', a: 'Ja. Im Pro-Plan hast du 3 Agents — z.B. einer für Privatkunden, einer für Gewerbe.' },
    ],
    ctaHeading: 'Reinigungs-Telefon automatisieren — 100 Freiminuten',
  },
  {
    slug: 'restaurant',
    templateId: 'restaurant',
    emoji: '🍽️',
    h1Text: 'In der <span class="accent">Küche</span> das Telefon verpasst? Nie wieder.',
    title: 'KI-Telefonassistent für Restaurants & Gastronomie | Phonbot',
    description: 'Phonbot ist der KI-Telefonassistent für Restaurants. Nimmt Reservierungen an, beantwortet Speisekarten-Fragen, erfasst Take-away-Bestellungen — 24/7 auf Deutsch. Ab 49 €/Monat.',
    eyebrow: 'KI-Telefonassistent für Restaurants',
    subtitle: 'Phonbot nimmt Reservierungen an während du in der Küche bist, beantwortet Fragen zur Speisekarte, erfasst Take-away-Bestellungen und bucht direkt in dein Reservierungssystem.',
    ogTitle: 'KI-Telefonassistent für Restaurants · Phonbot',
    ogDesc: 'Reservierungen automatisch annehmen, Speisekarte erklären, Take-away bestellen — 24/7 auf Deutsch.',
    serviceName: 'KI-Telefonassistent für Restaurants',
    audienceType: 'Restaurants, Cafés, Bars, Lieferdienste',
    features: [
      { icon: '🍴', title: 'Reservierungen', desc: 'Tisch-Reservierung mit Uhrzeit und Gästezahl direkt im Restaurant-Kalender eingetragen.' },
      { icon: '📜', title: 'Speisekarten-Auskunft', desc: '„Habt ihr glutenfreie Pizza?" — Phonbot kennt deine Karte und antwortet präzise.' },
      { icon: '📦', title: 'Take-away Bestellungen', desc: 'Bestellungen werden telefonisch aufgenommen und an die Küche durchgereicht.' },
      { icon: '🕒', title: 'Öffnungszeiten & Wegbeschreibung', desc: 'Standard-Fragen (Anfahrt, Parkplätze, Öffnungszeiten) — sofort beantwortet.' },
    ],
    dialogue: [
      { speaker: 'user', text: '📞 Gast: „Hi, ich wollte einen Tisch für 4 Personen heute um 19 Uhr reservieren."' },
      { speaker: 'bot', text: 'Phonbot: „Heute 19 Uhr für 4 Personen — schaue kurz. Ja, geht klar. Dein Name bitte?"' },
      { speaker: 'user', text: '📞 Gast: „Martin Kaiser."' },
      { speaker: 'bot', text: 'Phonbot: „Gebucht, Martin. Du bekommst eine Bestätigungs-SMS. Eine letzte Frage: Gibt es Allergien oder Wünsche?"' },
      { speaker: 'user', text: '📞 Gast: „Nein, alles gut."' },
      { speaker: 'bot', text: 'Phonbot: „Perfekt. Bis heute Abend 19 Uhr!"' },
    ],
    dialogueNote: '→ Reservierung im System · SMS-Bestätigung an Gast · Dauer: 31 Sek',
    savings: {
      intro: 'Restaurant mit 400 Anrufen/Monat rechnet sich so:',
      items: [
        '👤 <strong>Service-Mitarbeiter nur für Telefon</strong>: ~1.700 €/Monat',
        '📞 <strong>Phonbot Starter</strong>: 49 €/Monat',
        '💰 <strong>Ersparnis</strong>: ~1.650 €/Monat',
      ],
      hint: 'Plus: Keine Warteschleife = weniger verlorene Gäste an Konkurrenz.',
    },
    faq: [
      { q: 'Klappt das mit meinem Reservierungs-System (Resmio, Quandoo, OpenTable)?', a: 'Google Calendar und Outlook funktionieren direkt. Spezifische Reservierungs-Systeme auf Anfrage — meist via Kalender-Sync machbar.' },
      { q: 'Was bei Sonderwünschen (Allergien, Kinderhochstuhl)?', a: 'Phonbot fragt standardmäßig nach Allergien und fügt Notizen zur Reservierung. Individuelle Felder definierst du im Agent Builder.' },
      { q: 'Kann Phonbot Bestellungen für Lieferdienst annehmen?', a: 'Ja. Bestellungen werden als Ticket mit Artikeln + Lieferadresse an die Küche weitergeleitet.' },
      { q: 'Versteht Phonbot Dialekte (Bayrisch, Berlinerisch)?', a: 'Ja. Deutsches Sprach-Modell erkennt regionale Varianten und Gerichte-Slang.' },
    ],
    ctaHeading: 'Restaurant-Telefon automatisieren — 100 Freiminuten',
  },
  {
    slug: 'autowerkstatt',
    templateId: 'auto',
    emoji: '🚗',
    h1Text: 'Der <span class="accent">Hebebühne</span> keinen Vorrang vor dem Kunden geben müssen.',
    title: 'KI-Telefonassistent für Autowerkstätten & Kfz-Meisterbetriebe | Phonbot',
    description: 'Phonbot ist der KI-Telefonassistent für Autowerkstätten. Nimmt Terminanfragen, erfasst Fahrzeug- und Problemdaten, erstellt Kostenvoranschlag-Tickets — 24/7 auf Deutsch. Ab 49 €/Monat.',
    eyebrow: 'KI-Telefonassistent für Autowerkstätten',
    subtitle: 'Phonbot nimmt Anrufe während du unter dem Auto liegst. Erfasst Fahrzeug (Marke, Modell, Baujahr), das Problem und den Wunschtermin — direkt als Ticket im Dashboard.',
    ogTitle: 'KI-Telefonassistent für Autowerkstätten · Phonbot',
    ogDesc: 'Termine, Kostenvoranschläge und Reifenwechsel automatisch am Telefon annehmen — während du schraubst.',
    serviceName: 'KI-Telefonassistent für Autowerkstätten',
    audienceType: 'Autowerkstätten, Kfz-Meisterbetriebe, Reifenhändler, Lackierereien',
    features: [
      { icon: '🚘', title: 'Fahrzeug-Erfassung', desc: 'Marke, Modell, Baujahr, Kilometerstand — Phonbot fragt systematisch ab für präzise Einschätzung.' },
      { icon: '🔧', title: 'Problem-Beschreibung', desc: '„Komische Geräusche beim Bremsen" — Phonbot notiert das Symptom fürs Werkstatt-Team.' },
      { icon: '📅', title: 'Termin-Vorschläge', desc: 'Phonbot bucht freie Werkstatt-Slots passend zur geschätzten Dauer der Reparatur.' },
      { icon: '💶', title: 'Kostenvoranschlag-Tickets', desc: 'Für komplexe Reparaturen wird ein Ticket erstellt — du rufst mit Angebot zurück.' },
    ],
    dialogue: [
      { speaker: 'user', text: '📞 Kunde: „Mein Auto macht komische Geräusche beim Bremsen."' },
      { speaker: 'bot', text: 'Phonbot: „Das kann Bremsen sein — am besten gleich checken lassen. Welches Auto hast du?"' },
      { speaker: 'user', text: '📞 Kunde: „VW Golf 7, Baujahr 2018, 85.000 km."' },
      { speaker: 'bot', text: 'Phonbot: „Ok. Wann könntest du vorbeikommen? Ich habe morgen 10 Uhr oder Mittwoch 14 Uhr."' },
      { speaker: 'user', text: '📞 Kunde: „Morgen 10 Uhr passt."' },
      { speaker: 'bot', text: 'Phonbot: „Gebucht. Bring bitte den Fahrzeugschein mit. Dein Name und Telefonnummer?"' },
    ],
    dialogueNote: '→ Termin im Werkstatt-Kalender · Ticket mit Fahrzeug-Details · Dauer: 42 Sek',
    savings: {
      intro: 'Werkstatt mit 250 Anrufen/Monat:',
      items: [
        '👤 <strong>Werkstatt-Büro-Kraft</strong>: ~1.800 €/Monat',
        '📞 <strong>Phonbot Starter</strong>: 49 €/Monat',
        '💰 <strong>Ersparnis</strong>: ~1.750 €/Monat',
      ],
      hint: 'Plus: Unter der Hebebühne keine Unterbrechung mehr.',
    },
    faq: [
      { q: 'Kann Phonbot verschiedene Werkstatt-Bereiche unterscheiden?', a: 'Ja. Du legst im Agent Builder fest: Reifen-Express (30 Min), Inspektion (2h), Unfall-Reparatur (Termin). Phonbot routet korrekt.' },
      { q: 'Was bei TÜV-Terminen?', a: 'Phonbot bucht TÜV-Vorbereitungs-Termine und erinnert auf Wunsch an ablaufende Plaketten.' },
      { q: 'Kann der Kunde ein Kostenvoranschlag-Angebot direkt bestätigen?', a: 'Aktuell erstellt Phonbot ein Ticket, du schickst das Angebot per E-Mail/SMS. Auto-Bestätigung via Link kommt 2026.' },
      { q: 'Versteht Phonbot Kfz-Fachbegriffe (Zahnriemen, Zylinderkopfdichtung)?', a: 'Ja. Deutsches LLM kennt Kfz-Terminologie.' },
    ],
    ctaHeading: 'Werkstatt-Telefon automatisieren — 100 Freiminuten',
  },
];

const STYLE = `*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#0A0A0F;color:#fff;line-height:1.6;overflow-x:hidden}
a{color:inherit;text-decoration:none}
.container{max-width:960px;margin:0 auto;padding:0 1.5rem}
@media(max-width:640px){.container{padding:0 1rem}header.hero{padding:3rem 0 2rem}section{padding:2.5rem 0}}
/* ── Nav (unified with SPA + legal pages) ── */
${NAV_STYLE}
.btn{display:inline-block;padding:.75rem 1.5rem;border-radius:999px;font-weight:600;font-size:.9rem;transition:all .3s;cursor:pointer;border:none}
.btn-primary{background:linear-gradient(135deg,#F97316,#06B6D4);color:#fff}
.btn-primary:hover{transform:scale(1.03);box-shadow:0 0 40px rgba(249,115,22,.4)}
.btn-ghost{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.85)}
.btn-ghost:hover{background:rgba(255,255,255,.08);color:#fff}
.btn-demo{background:rgba(249,115,22,.12);border:1px solid rgba(249,115,22,.4);color:#FDBA74;display:inline-flex;align-items:center;gap:.5rem}
.btn-demo:hover{background:rgba(249,115,22,.2);color:#fff;transform:scale(1.03)}
header.hero{padding:5rem 0 3rem;text-align:center;position:relative}
.hero-eyebrow{display:inline-block;padding:.4rem 1rem;border-radius:999px;background:rgba(249,115,22,.1);border:1px solid rgba(249,115,22,.25);font-size:.8rem;color:#FDBA74;margin-bottom:1.5rem}
h1{font-size:clamp(2.25rem,5vw,3.75rem);font-weight:800;letter-spacing:-.02em;line-height:1.1;margin-bottom:1.25rem}
h1 .accent{background:linear-gradient(135deg,#F97316,#06B6D4);-webkit-background-clip:text;background-clip:text;color:transparent}
.subtitle{font-size:1.125rem;color:rgba(255,255,255,.6);max-width:640px;margin:0 auto 2.5rem}
.cta-row{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap}
section{padding:3.5rem 0}
h2{font-size:clamp(1.5rem,3.5vw,2.25rem);font-weight:700;margin-bottom:1.5rem;letter-spacing:-.015em}
h3{font-size:1.125rem;font-weight:600;margin-bottom:.5rem;color:#fff}
p{color:rgba(255,255,255,.7)}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1.25rem;margin-top:2rem}
.feature{padding:1.5rem;border-radius:1rem;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);transition:border-color .3s}
.feature:hover{border-color:rgba(249,115,22,.3)}
.feature-icon{width:40px;height:40px;border-radius:.75rem;background:linear-gradient(135deg,rgba(249,115,22,.15),rgba(6,182,212,.1));display:flex;align-items:center;justify-content:center;font-size:1.25rem;margin-bottom:1rem}
.dialogue{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:1.25rem;padding:1.75rem;max-width:720px;margin:2rem auto 0}
.dialogue p{margin-bottom:.75rem;padding:.75rem 1rem;border-radius:.75rem}
.dialogue .user{background:rgba(255,255,255,.04);color:rgba(255,255,255,.75)}
.dialogue .bot{background:linear-gradient(135deg,rgba(249,115,22,.08),rgba(6,182,212,.05));border-left:3px solid #F97316;color:#fff}
.faq-list{margin-top:2rem}
.faq-item{padding:1.25rem 0;border-bottom:1px solid rgba(255,255,255,.06)}
.faq-item h3{color:#fff;margin-bottom:.5rem}
.pricing-hint{display:inline-block;margin-top:1rem;padding:.5rem 1rem;border-radius:.5rem;background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.2);font-size:.85rem;color:#67E8F9}
footer{border-top:1px solid rgba(255,255,255,.05);padding:2.5rem 0;margin-top:3rem;font-size:.85rem;color:rgba(255,255,255,.4);text-align:center}
footer a{color:rgba(255,255,255,.65);text-decoration:underline;text-decoration-color:rgba(255,255,255,.15)}
footer a:hover{color:#fff}
.breadcrumb{font-size:.8rem;color:rgba(255,255,255,.4);padding:1rem 0}
.breadcrumb a{color:rgba(255,255,255,.6)}
.breadcrumb a:hover{color:#F97316}
.demo-hint{display:inline-block;padding:.5rem 1rem;border-radius:.5rem;background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.2);font-size:.85rem;color:#67E8F9;margin-top:1rem}`;

function buildPage(d) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: d.serviceName,
    serviceType: 'AI Voice Agent',
    provider: {
      '@type': 'Organization',
      name: 'Phonbot',
      url: 'https://phonbot.de/',
      parentOrganization: {
        '@type': 'Organization',
        name: 'Mindrails UG (haftungsbeschränkt)',
        url: 'https://mindrails.de/',
      },
    },
    areaServed: { '@type': 'Country', name: 'Deutschland' },
    description: d.description,
    audience: { '@type': 'BusinessAudience', audienceType: d.audienceType },
    offers: {
      '@type': 'Offer',
      price: '49',
      priceCurrency: 'EUR',
      priceSpecification: { '@type': 'UnitPriceSpecification', price: '49', priceCurrency: 'EUR', unitText: 'MONTH' },
    },
  };

  const features = d.features
    .map((f) => `<div class="feature"><div class="feature-icon">${f.icon}</div><h3>${f.title}</h3><p>${f.desc}</p></div>`)
    .join('\n        ');

  const dialogue = d.dialogue
    .map((line) => `<p class="${line.speaker === 'user' ? 'user' : 'bot'}">${line.text}</p>`)
    .join('\n      ');

  const faq = d.faq.map((q) => `<div class="faq-item"><h3>${q.q}</h3><p>${q.a}</p></div>`).join('\n      ');
  const savingsItems = d.savings.items.map((i) => `<li>${i}</li>`).join('\n        ');

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0A0A0F" />
<title>${d.title}</title>
<meta name="description" content="${d.description}" />
<link rel="canonical" href="https://phonbot.de/${d.slug}/" />
<link rel="alternate" hreflang="de" href="https://phonbot.de/${d.slug}/" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="de_DE" />
<meta property="og:url" content="https://phonbot.de/${d.slug}/" />
<meta property="og:title" content="${d.ogTitle}" />
<meta property="og:description" content="${d.ogDesc}" />
<meta property="og:image" content="https://phonbot.de/og-image.svg" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="robots" content="index, follow, max-image-preview:large" />
<link rel="icon" href="/favicon.ico" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
<script type="application/ld+json">
${JSON.stringify(jsonLd)}
</script>
<style>${STYLE}</style>
</head>
<body>
${NAV_HTML}

<div class="container">
  <nav class="breadcrumb" aria-label="Brotkrumennavigation">
    <a href="/">Phonbot</a> › <a href="/#demo">Branchen</a> › <span>${d.eyebrow.replace(/^KI-Telefonassistent für /, '')}</span>
  </nav>
</div>

<header class="hero">
  <div class="container">
    <span class="hero-eyebrow">${d.emoji} ${d.eyebrow}</span>
    <h1>${d.h1Text}</h1>
    <p class="subtitle">${d.subtitle}</p>
    <div class="cta-row">
      <a href="/?demo=${d.templateId}#demo" class="btn btn-demo">▶ Chipy live hören</a>
      <a href="/" class="btn btn-primary">Kostenlos testen</a>
    </div>
    <div class="demo-hint">🎙️ Klick „live hören" — Phonbot spricht mit dir im Browser (Mikrofon nötig)</div>
  </div>
</header>

<section>
  <div class="container">
    <h2>Typische Anrufe — automatisch bearbeitet</h2>
    <div class="features">
      ${features}
    </div>
  </div>
</section>

<section>
  <div class="container">
    <h2>So klingt Phonbot am Telefon</h2>
    <div class="dialogue">
      ${dialogue}
    </div>
    <p style="text-align:center;margin-top:1.5rem;font-size:.9rem;color:rgba(255,255,255,.5)">${d.dialogueNote}</p>
    <div style="text-align:center;margin-top:1.5rem">
      <a href="/?demo=${d.templateId}#demo" class="btn btn-demo">▶ Chipy live am Telefon hören</a>
    </div>
  </div>
</section>

<section>
  <div class="container">
    <h2>Rechnet sich das?</h2>
    <p>${d.savings.intro}</p>
    <ul style="margin-top:1rem;padding-left:1.25rem;color:rgba(255,255,255,.75)">
      ${savingsItems}
    </ul>
    <span class="pricing-hint">${d.savings.hint}</span>
  </div>
</section>

<section>
  <div class="container">
    <h2>Häufige Fragen</h2>
    <div class="faq-list">
      ${faq}
    </div>
  </div>
</section>

<section style="text-align:center;padding:4rem 0">
  <div class="container">
    <h2>${d.ctaHeading}</h2>
    <p style="margin-bottom:1.5rem">Registrierung in unter 2 Minuten · Keine Kreditkarte · Monatlich kündbar</p>
    <div class="cta-row">
      <a href="/" class="btn btn-primary">Jetzt einrichten</a>
      <a href="/?demo=${d.templateId}#demo" class="btn btn-demo">Erst Chipy testen</a>
    </div>
  </div>
</section>

<footer>
  <div class="container">
    <p>© 2026 Phonbot · Ein Produkt der <a href="https://mindrails.de" rel="noopener">Mindrails UG</a> · <a href="/">Zur Hauptseite</a> · <a href="/#faq">FAQ</a> · <a href="/#pricing">Preise</a></p>
    <p style="margin-top:.5rem">DSGVO-konform · Server in Deutschland · <a href="mailto:info@phonbot.de">info@phonbot.de</a></p>
  </div>
</footer>
<script src="/nav.js" defer></script>
</body>
</html>
`;
}

// Generate all pages (and wipe out any existing files in those folders first)
for (const b of BRANCHEN) {
  const dir = path.join(OUT_DIR, b.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), buildPage(b));
  console.log(`✓ ${b.slug}/index.html`);
}
console.log(`\nGenerated ${BRANCHEN.length} landing pages`);
