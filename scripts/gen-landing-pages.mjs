// Generates industry-specific landing pages under apps/web/public/<slug>/index.html
// Shared template + per-industry data. Run: node scripts/gen-landing-pages.mjs
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('apps/web/public');

const BRANCHEN = [
  {
    slug: 'handwerker',
    emoji: '🔧',
    h1Accent: 'Baustelle',
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
        '📞 <strong>Phonbot Starter</strong>: 49 €/Monat (inkl. 500 Minuten)',
        '💰 <strong>Ersparnis</strong>: ~1.950 €/Monat',
      ],
      hint: 'Plus: Auf der Baustelle ohne Unterbrechung weiterarbeiten.',
    },
    faq: [
      { q: 'Erkennt Phonbot den Unterschied zwischen Notfall und regulärem Termin?', a: 'Ja. Keywords wie "sofort", "Wasserschaden", "brennt" lösen automatisch Priorität-hoch aus. Du kannst im Agent Builder deine eigenen Notfall-Regeln ergänzen.' },
      { q: 'Kann ich unterwegs auf Anfragen reagieren?', a: 'Ja. Alle Tickets kommen im Dashboard an, zusätzlich per E-Mail-Benachrichtigung. Mobile-App kommt 2026.' },
      { q: 'Versteht Phonbot Handwerks-Fachbegriffe (Thermostat, Siphon, etc.)?', a: 'Ja. Das LLM kennt deutsche Handwerks-Terminologie und kann bei Unklarheit gezielt nachfragen.' },
      { q: 'Was wenn mehrere Kunden gleichzeitig anrufen?', a: 'Phonbot nimmt mehrere Anrufe parallel an (eigener Agent pro Gespräch). Niemand hängt in der Warteschleife.' },
    ],
    ctaHeading: 'Teste Phonbot für deinen Handwerksbetrieb — 100 Freiminuten',
  },
  {
    slug: 'arztpraxis',
    emoji: '🩺',
    h1Accent: 'MFA',
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
        '📞 <strong>Phonbot Pro</strong>: 149 €/Monat (inkl. 2.000 Minuten)',
        '💰 <strong>Ersparnis</strong>: ~1.650 €/Monat',
      ],
      hint: 'Plus: Bestehende MFA macht weniger Überstunden, weniger Burnout-Risiko.',
    },
    faq: [
      { q: 'Ist Phonbot DSGVO-konform für Patientendaten?', a: 'Ja. Server stehen in Deutschland, Daten sind AES-256 verschlüsselt, AV-Vertrag wird bereitgestellt. PII-Redaction entfernt sensible Daten aus Transkripten.' },
      { q: 'Kann Phonbot zwischen Akut- und Routine-Fällen unterscheiden?', a: 'Ja. Keywords wie "Schmerzen", "akut", "Notfall" triggern Priorisierung. Bei echten Notfällen weist Phonbot an 112 zu rufen.' },
      { q: 'Passt das zu meiner Praxis-Software?', a: 'Phonbot arbeitet mit dem Kalender-System (Google, Outlook, Cal.com). Direkte Integration mit PVS-Systemen wie MediStar/Elefant auf Anfrage.' },
      { q: 'Werden Gespräche aufgenommen?', a: 'Standardmäßig werden Transkripte erstellt, keine Audio-Aufzeichnung. Patienten werden zu Gesprächsbeginn auf die KI-Nutzung hingewiesen.' },
    ],
    ctaHeading: 'Praxis-Team entlasten — 100 Freiminuten testen',
  },
  {
    slug: 'kanzlei',
    emoji: '⚖️',
    h1Accent: 'Sekretariat',
    h1Text: 'Dein <span class="accent">Sekretariat</span> schafft nicht mehr alle Mandats-Anfragen.',
    title: 'KI-Telefonassistent für Kanzleien & Anwälte | Phonbot',
    description: 'Phonbot ist der KI-Telefonassistent für Kanzleien. Qualifiziert Mandats-Anfragen, bucht Erstberatungs-Termine, entlastet dein Sekretariat — diskret und DSGVO-konform. Ab 49 €/Monat.',
    eyebrow: 'KI-Telefonassistent für Kanzleien',
    subtitle: 'Phonbot nimmt Anrufe an während dein Sekretariat in Meetings ist, qualifiziert neue Mandats-Anfragen nach Rechtsgebiet und Dringlichkeit, und bucht Erstberatungs-Termine direkt.',
    ogTitle: 'KI-Telefonassistent für Kanzleien · Phonbot',
    ogDesc: 'Keine Mandats-Anfrage mehr verloren. Phonbot qualifiziert, bucht Erstberatung, entlastet Sekretariat.',
    serviceName: 'KI-Telefonassistent für Kanzleien',
    audienceType: 'Rechtsanwaltskanzleien, Notare, Steuerberater',
    features: [
      { icon: '📋', title: 'Mandats-Qualifizierung', desc: 'Phonbot erfasst Rechtsgebiet, Streitwert, Zeithorizont — du siehst vorher ob der Fall passt.' },
      { icon: '📅', title: 'Erstberatung buchen', desc: 'Passt der Fall, wird automatisch ein Erstberatungs-Termin im Anwalts-Kalender eingetragen.' },
      { icon: '🎯', title: 'Rechtsgebiete filtern', desc: 'Nur Fälle deiner Spezialisierung werden weitergeleitet, andere bekommen höflich einen Verweis.' },
      { icon: '🔒', title: 'Verschwiegenheit', desc: 'Alle Gespräche vertraulich, DSGVO-konform, anwaltliche Schweigepflicht-Flows unterstützt.' },
    ],
    dialogue: [
      { speaker: 'user', text: '📞 Interessent: „Guten Tag, ich wurde abgemahnt wegen eines Fotos auf meinem Blog."' },
      { speaker: 'bot', text: 'Phonbot: „Das ist Urheberrecht — ein Schwerpunkt unserer Kanzlei. Ich nehme kurz Details auf. Wie hoch ist die geforderte Summe?"' },
      { speaker: 'user', text: '📞 Interessent: „Etwa 1.200 Euro."' },
      { speaker: 'bot', text: 'Phonbot: „Verstanden. Ich buche dir einen Erstberatungs-Termin für morgen 14 Uhr mit Herrn Dr. Weber. OK?"' },
      { speaker: 'user', text: '📞 Interessent: „Ja, passt."' },
      { speaker: 'bot', text: 'Phonbot: „Gebucht. Du bekommst eine Bestätigung per E-Mail mit Vorbereitungshinweisen."' },
    ],
    dialogueNote: '→ Termin in Outlook-Kalender · qualifiziertes Mandat vorab im CRM · Dauer: 41 Sek',
    savings: {
      intro: 'Typische Kanzlei mit 150 Anrufen/Monat:',
      items: [
        '👤 <strong>Sekretariats-Verstärkung</strong>: ~2.200 €/Monat',
        '📞 <strong>Phonbot Starter</strong>: 49 €/Monat',
        '💰 <strong>Ersparnis</strong>: ~2.150 €/Monat',
      ],
      hint: 'Plus: Mandanten warten nie in der Schleife — wichtiges Qualitätssignal.',
    },
    faq: [
      { q: 'Ist das mit der anwaltlichen Schweigepflicht vereinbar?', a: 'Ja. Phonbot ist Datenverarbeiter im Sinne der DSGVO mit AV-Vertrag. Erste Mandats-Details werden verschlüsselt gespeichert, der finale Mandatsvertrag bleibt wie gewohnt direkter Anwalt-Mandant-Bezug.' },
      { q: 'Kann Phonbot zwischen verschiedenen Rechtsgebieten unterscheiden?', a: 'Ja. Im Agent Builder legst du deine Spezialisierungen fest (z.B. IT-Recht, Arbeitsrecht). Phonbot qualifiziert eingehende Fälle entsprechend.' },
      { q: 'Was bei Fristen-Fällen (z.B. Klagefrist)?', a: 'Fristen-relevante Keywords lösen Prioritäts-Ticket aus. Anwalt bekommt sofortige Push-Nachricht für dringliche Kontaktaufnahme.' },
      { q: 'Können wir eigene Fragen stellen lassen (z.B. zur RSV)?', a: 'Ja. Im Agent Builder definierst du eigene Pflichtfragen für die Mandats-Qualifizierung (Rechtsschutz, Mandanten-Historie, etc.).' },
    ],
    ctaHeading: 'Kanzlei entlasten — 100 Freiminuten',
  },
  {
    slug: 'gastronomie',
    emoji: '🍽️',
    h1Accent: 'Küche',
    h1Text: 'In der <span class="accent">Küche</span> das Telefon verpasst? Nie wieder.',
    title: 'KI-Telefonassistent für Restaurants & Gastronomie | Phonbot',
    description: 'Phonbot ist der KI-Telefonassistent für Restaurants. Nimmt Reservierungen an, beantwortet Speisekarten-Fragen, erfasst Take-away-Bestellungen — 24/7, auf Deutsch. Ab 49 €/Monat.',
    eyebrow: 'KI-Telefonassistent für Restaurants',
    subtitle: 'Phonbot nimmt Reservierungen an während du in der Küche bist, beantwortet Fragen zur Speisekarte, erfasst Take-away-Bestellungen und bucht direkt in dein Reservierungssystem.',
    ogTitle: 'KI-Telefonassistent für Restaurants · Phonbot',
    ogDesc: 'Reservierungen automatisch annehmen, Speisekarte erklären, Take-away bestellen — 24/7 auf Deutsch.',
    serviceName: 'KI-Telefonassistent für Restaurants',
    audienceType: 'Restaurants, Cafés, Bars, Lieferdienste',
    features: [
      { icon: '🍴', title: 'Reservierungen', desc: 'Tisch-Reservierung mit Uhrzeit und Gästezahl direkt im Restaurant-Kalender eingetragen.' },
      { icon: '📜', title: 'Speisekarten-Auskunft', desc: '„Habt ihr glutenfreie Pizza?" — Phonbot kennt deine Karte und antwortet präzise.' },
      { icon: '📦', title: 'Take-away Bestellungen', desc: 'Bestellungen werden telefonisch aufgenommen und an die Küche durchgereicht (per Ticket oder SMS).' },
      { icon: '🕒', title: 'Öffnungszeiten & Wegbeschreibung', desc: 'Standard-Fragen (Anfahrt, Parkplätze, Öffnungszeiten) — sofort beantwortet, keine Ablenkung für Service-Personal.' },
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
      { q: 'Klappt das mit meinem Reservierungs-System (z.B. Resmio, Quandoo)?', a: 'Google Calendar und Outlook funktionieren direkt. Spezifische Reservierungs-Systeme auf Anfrage — meist via Kalender-Sync machbar.' },
      { q: 'Was bei Sonderwünschen (Allergien, Kinderhochstuhl)?', a: 'Phonbot fragt standardmäßig nach Allergien und fügt Notizen zur Reservierung. Individuelle Felder definierst du im Agent Builder.' },
      { q: 'Kann Phonbot Bestellungen für Lieferdienst annehmen?', a: 'Ja. Bestellungen werden als Ticket mit Artikeln + Lieferadresse an die Küche weitergeleitet. Alternativ: Integration mit Lieferando/Wolt auf Anfrage.' },
      { q: 'Versteht Phonbot Dialekte (Bayrisch, Berlinerisch)?', a: 'Ja. Deutsches Sprach-Modell erkennt regionale Varianten und Gerichte-Slang.' },
    ],
    ctaHeading: 'Restaurant-Telefon automatisieren — 100 Freiminuten',
  },
  {
    slug: 'kosmetik',
    emoji: '💅',
    h1Accent: 'Behandlung',
    h1Text: 'Mitten in der <span class="accent">Behandlung</span> klingelt das Telefon?',
    title: 'KI-Telefonassistent für Kosmetikstudios & Nagelstudios | Phonbot',
    description: 'Phonbot ist der KI-Telefonassistent für Kosmetik- und Nagelstudios. Bucht Termine, beantwortet Preisfragen, informiert über Behandlungen — 24/7, auf Deutsch. Ab 49 €/Monat.',
    eyebrow: 'KI-Telefonassistent für Kosmetikstudios',
    subtitle: 'Phonbot nimmt Termin-Anfragen entgegen während du Kundinnen betreust, beantwortet Fragen zu Preisen und Behandlungen und bucht direkt in deinen Salon-Kalender.',
    ogTitle: 'KI-Telefonassistent für Kosmetikstudios · Phonbot',
    ogDesc: 'Mitten in der Behandlung keinen Anruf mehr verpassen. Phonbot bucht Termine automatisch.',
    serviceName: 'KI-Telefonassistent für Kosmetik- und Nagelstudios',
    audienceType: 'Kosmetikstudios, Nagelstudios, Beauty-Salons, Massage-Praxen',
    features: [
      { icon: '📅', title: 'Terminbuchung', desc: 'Behandlungs-Termine (Maniküre, Gesichtsbehandlung, Permanent Make-up) werden direkt im Kalender eingetragen.' },
      { icon: '💶', title: 'Preisauskunft', desc: 'Detaillierte Preislisten pro Behandlung sofort abrufbar — auch für Pakete und Gutscheine.' },
      { icon: '🧴', title: 'Behandlungs-Beratung', desc: '„Ist Microneedling bei Akne geeignet?" — Phonbot gibt erste Infos oder verweist auf Beratungstermin.' },
      { icon: '🎁', title: 'Gutschein-Verkauf', desc: 'Anfragen zu Geschenkgutscheinen werden als Ticket weitergeleitet — du rufst mit Kaufmöglichkeit zurück.' },
    ],
    dialogue: [
      { speaker: 'user', text: '📞 Kundin: „Hi, ich hätte gern einen Termin für klassische Maniküre nächste Woche."' },
      { speaker: 'bot', text: 'Phonbot: „Gern! Klassische Maniküre dauert 45 Minuten. Montag 14 Uhr oder Mittwoch 16 Uhr — was passt dir?"' },
      { speaker: 'user', text: '📞 Kundin: „Mittwoch 16 Uhr."' },
      { speaker: 'bot', text: 'Phonbot: „Super, Mittwoch 16 Uhr ist gebucht. Dein Name bitte?"' },
      { speaker: 'user', text: '📞 Kundin: „Lisa Becker."' },
      { speaker: 'bot', text: 'Phonbot: „Danke Lisa. Du bekommst gleich die Bestätigung per SMS. Bis Mittwoch!"' },
    ],
    dialogueNote: '→ Termin im Salon-Kalender · SMS-Bestätigung · Dauer: 29 Sek',
    savings: {
      intro: 'Kosmetikstudio mit 250 Anrufen/Monat:',
      items: [
        '👤 <strong>Empfangsdame Teilzeit</strong>: ~1.400 €/Monat',
        '📞 <strong>Phonbot Starter</strong>: 49 €/Monat',
        '💰 <strong>Ersparnis</strong>: ~1.350 €/Monat',
      ],
      hint: 'Plus: Kundinnen bekommen sofort Antwort statt Warteschleife.',
    },
    faq: [
      { q: 'Kann Phonbot zwischen meinen Service-Kategorien unterscheiden?', a: 'Ja. Im Agent Builder definierst du deine Behandlungen mit Dauer und Preis. Phonbot wählt passende Kalender-Slots automatisch.' },
      { q: 'Was bei besonderen Behandlungen (Permanent Make-up, Beratung)?', a: 'Komplexe Behandlungen werden als Termin-Anfrage erfasst und du bestätigst persönlich nach kurzer Rückfrage.' },
      { q: 'Kann ich verschiedene Filialen verwalten?', a: 'Ja. Mit dem Pro-Plan hast du 3 Agents, mit Agency 10. Je Filiale ein eigener Kalender möglich.' },
      { q: 'Wie läuft die Gutschein-Verkauf?', a: 'Phonbot nimmt Interesse auf, du rufst zurück und verschickst den Gutschein per E-Mail. Direkter Gutschein-Verkauf via Phonbot kommt 2026.' },
    ],
    ctaHeading: 'Kosmetik-Studio automatisieren — 100 Freiminuten',
  },
];

// ── Shared template ────────────────────────────────────────────────────────
const STYLE = `*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#0A0A0F;color:#fff;line-height:1.6;overflow-x:hidden}
a{color:inherit;text-decoration:none}
.container{max-width:960px;margin:0 auto;padding:0 1.5rem}
nav{position:sticky;top:0;z-index:50;background:rgba(15,15,24,.85);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.05)}
nav .container{display:flex;align-items:center;justify-content:space-between;padding-top:1rem;padding-bottom:1rem}
.brand{font-weight:800;font-size:1.25rem;background:linear-gradient(135deg,#F97316,#06B6D4);-webkit-background-clip:text;background-clip:text;color:transparent}
.btn{display:inline-block;padding:.75rem 1.5rem;border-radius:999px;font-weight:600;font-size:.9rem;transition:all .3s;cursor:pointer;border:none}
.btn-primary{background:linear-gradient(135deg,#F97316,#06B6D4);color:#fff}
.btn-primary:hover{transform:scale(1.03);box-shadow:0 0 40px rgba(249,115,22,.4)}
.btn-ghost{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.85)}
.btn-ghost:hover{background:rgba(255,255,255,.08);color:#fff}
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
.breadcrumb a:hover{color:#F97316}`;

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
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: '49',
        priceCurrency: 'EUR',
        unitText: 'MONTH',
      },
    },
  };

  const features = d.features
    .map(
      (f) =>
        `<div class="feature"><div class="feature-icon">${f.icon}</div><h3>${f.title}</h3><p>${f.desc}</p></div>`,
    )
    .join('\n        ');

  const dialogue = d.dialogue
    .map((line) => {
      const cls = line.speaker === 'user' ? 'user' : 'bot';
      return `<p class="${cls}">${line.text}</p>`;
    })
    .join('\n      ');

  const faq = d.faq
    .map(
      (q) =>
        `<div class="faq-item"><h3>${q.q}</h3><p>${q.a}</p></div>`,
    )
    .join('\n      ');

  const savingsItems = d.savings.items.map((i) => `<li>${i}</li>`).join('\n        ');

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0A0A0F" />
<title>${d.title}</title>
<meta name="description" content="${d.description}" />
<link rel="canonical" href="https://phonbot.de/${d.slug}" />
<link rel="alternate" hreflang="de" href="https://phonbot.de/${d.slug}" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="de_DE" />
<meta property="og:url" content="https://phonbot.de/${d.slug}" />
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
<nav>
  <div class="container">
    <a href="/" class="brand">Phonbot</a>
    <a href="/" class="btn btn-ghost">Kostenlos testen</a>
  </div>
</nav>

<div class="container">
  <nav class="breadcrumb" aria-label="Brotkrumennavigation">
    <a href="/">Phonbot</a> › <a href="/#features">Branchen</a> › <span>${d.eyebrow.replace(/^KI-Telefonassistent für /, '')}</span>
  </nav>
</div>

<header class="hero">
  <div class="container">
    <span class="hero-eyebrow">${d.emoji} ${d.eyebrow}</span>
    <h1>${d.h1Text}</h1>
    <p class="subtitle">${d.subtitle}</p>
    <div class="cta-row">
      <a href="/" class="btn btn-primary">Kostenlos testen</a>
      <a href="/#demo" class="btn btn-ghost">Demo anhören</a>
    </div>
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
    </div>
  </div>
</section>

<footer>
  <div class="container">
    <p>© 2026 Phonbot · Ein Produkt der <a href="https://mindrails.de" rel="noopener">Mindrails UG</a> · <a href="/">Zur Hauptseite</a> · <a href="/#faq">Allgemeine FAQ</a></p>
    <p style="margin-top:.5rem">DSGVO-konform · Server in Deutschland · <a href="mailto:info@phonbot.de">info@phonbot.de</a></p>
  </div>
</footer>
</body>
</html>
`;
}

for (const b of BRANCHEN) {
  const dir = path.join(OUT_DIR, b.slug);
  fs.mkdirSync(dir, { recursive: true });
  const html = buildPage(b);
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  console.log(`✓ ${b.slug}/index.html (${html.length} bytes)`);
}
console.log(`\nGenerated ${BRANCHEN.length} landing pages in ${OUT_DIR}/`);
