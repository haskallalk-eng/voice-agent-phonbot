// Generates industry-specific landing pages under apps/web/public/<slug>/index.html
// Slugs match TEMPLATES in apps/web/src/ui/landing/shared.ts — keep in sync!
// Run: node scripts/gen-landing-pages.mjs
import fs from 'node:fs';
import path from 'node:path';
import { NAV_STYLE, NAV_HTML } from './_nav.mjs';
import { FOOTER_STYLE, FOOTER_HTML } from './_footer.mjs';
import { icon } from './_icons.mjs';

// Emoji → house-icon mapping. All user-facing emojis in the branch-page
// data are mapped through this table so the rendered page uses our own
// SVG icons (consistent stroke / colour / size) instead of platform-
// specific Unicode fonts. Added 2026-04-22 as part of the chipy-design
// polish pass. Any new emoji in BRANCHEN data MUST also get an entry
// here — otherwise it falls through untouched and breaks visual unity.
const EMOJI_TO_ICON = {
  '✂️': 'scissors', '🔧': 'wrench', '🩺': 'medical', '🧹': 'broom',
  '🍽️': 'restaurant', '🍴': 'restaurant', '🚗': 'car', '🚘': 'car',
  '📅': 'calendar', '🕒': 'clock', '⏰': 'clock',
  '📞': 'phone', '📱': 'phone',
  '💶': 'euro', '💰': 'cash', '💳': 'card',
  '🚨': 'alert', '⚠️': 'alert',
  '↩️': 'ticket', '🎫': 'ticket',
  '💊': 'pill',
  '🏢': 'building', '🏠': 'home',
  '📋': 'clipboard', '📜': 'document', '📃': 'document',
  '🔒': 'lock', '🔐': 'lock',
  '📦': 'package',
  '👤': 'user', '👥': 'user',
  '⭐': 'star', '🌟': 'star',
  '💬': 'chat',
  '⚡': 'bolt', '🎙️': 'bolt',
};

// Wrap an emoji in the matching SVG; pass-through if no mapping exists.
function e2svg(emoji, size = 18) {
  const name = EMOJI_TO_ICON[emoji];
  return name ? icon(name, size) : emoji;
}

// Replace a leading emoji in a free-text string with a small inline SVG.
// Handles savings bullets ('👤 <strong>…</strong>: 1.500 €') and dialogue
// lines ('📞 Kundin: "…"') in one pass.
const LEADING_EMOJI_RE = new RegExp(
  '^(' + Object.keys(EMOJI_TO_ICON)
    .map((e) => e.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&'))
    .join('|') + ')\\s*',
  'u',
);
function stripLeadingEmoji(text, inlineSize = 14) {
  return text.replace(LEADING_EMOJI_RE, (_, emoji) => {
    const name = EMOJI_TO_ICON[emoji];
    if (!name) return emoji + ' ';
    return `<span class="ic-inline">${icon(name, inlineSize)}</span>`;
  });
}

const OUT_DIR = path.resolve('apps/web/public');

const BRANCHEN = [
  {
    slug: 'friseur',
    templateId: 'hairdresser',
    emoji: '✂️',
    h1Text: 'Nie wieder das <span class="accent">Telefon abnehmen</span> zwischen den Schnitten.',
    title: 'KI-Telefonassistent für Friseursalons · Termine automatisch buchen | Phonbot',
    description: 'Phonbot ist der KI-Telefonassistent speziell für Friseure & Salons. Bucht Termine direkt in deinen Kalender, nimmt Walk-in-Anfragen an, beantwortet Öffnungszeiten — 24/7 auf Deutsch. Ab 49 €/Monat.',
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
    dialogueNote: '→ Termin automatisch im Kalender eingetragen · Dauer: 28 Sekunden',
    value: {
      headline: 'Was passiert, wenn <span class="accent">keiner abnimmt?</span>',
      insight: {
        stat: '65 %',
        claim: 'der Erstanrufer rufen nicht noch einmal an, wenn der Salon besetzt ist. Sie wählen den Nächsten in der Google-Suche.',
      },
      scenario: 'Typischer Salon mit 300 Anrufen pro Monat:',
      roi: [
        { icon: 'user', label: 'Teilzeit-Rezeption', amount: '1.500 €', per: '/Monat' },
        { icon: 'chat', label: 'Phonbot Starter — 500 Min inklusive', amount: '49 €', per: '/Monat' },
        { icon: 'star', label: 'Deine Ersparnis', amount: '1.451 €', per: '/Monat', highlight: true },
      ],
      extras: [
        { icon: 'clock', title: 'Kein Anruf in Stoßzeiten verloren', desc: 'Während Föhnen, Färben oder Schnitt geht Chipy trotzdem dran — die Kundin bleibt.' },
        { icon: 'phone', title: 'Parallelgespräche, keine Warteschleife', desc: 'Mehrere Kundinnen gleichzeitig — niemand hängt in der Leitung, niemand legt auf.' },
        { icon: 'calendar', title: 'Nie doppelt gebucht', desc: 'Chipy prüft den Kalender in Echtzeit, bevor ein Termin bestätigt wird — sauberes Buch ohne Überlappungen.' },
      ],
    },
    faq: [
      { q: 'Kann Phonbot mehrere Stylisten im Salon unterscheiden?', a: 'Ja. Im Agent Builder legst du Mitarbeiter-Profile an, Phonbot bucht jedem den eigenen Kalender-Slot.' },
      { q: 'Was wenn eine Kundin sofort jemanden sprechen will?', a: 'Phonbot bietet Rückruf an („Ich notiere dich, ruf dich in 30 Min zurück") oder erstellt ein Prioritäts-Ticket.' },
      { q: 'Versteht Phonbot Friseur-Fachbegriffe (Pony, Balayage, Keratin)?', a: 'Ja. Die KI ist nativ auf deutschem Sprachgebrauch trainiert, inkl. Dialekte und Friseur-Fachbegriffe.' },
      { q: 'Kann ich meine bisherige Salon-Nummer behalten?', a: 'Ja. Rufweiterleitung bei deinem Telefonanbieter einrichten, fertig. Kein Nummernwechsel nötig.' },
    ],
    ctaHeading: 'Salon-Agent einrichten — 30 Freiminuten',
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
    value: {
      headline: 'Auf der Baustelle klingelt das Handy. <span class="accent">Und dann?</span>',
      insight: {
        stat: '1 von 3',
        claim: 'Notfall-Anrufern wechselt zur Konkurrenz, wenn beim ersten Handwerker niemand abhebt — Wasserschaden wartet nicht.',
      },
      scenario: 'Handwerksbetrieb mit 200 Anrufen pro Monat:',
      roi: [
        { icon: 'user', label: 'Angestellte Büro-Kraft', amount: '2.000 €', per: '/Monat' },
        { icon: 'chat', label: 'Phonbot Starter', amount: '49 €', per: '/Monat' },
        { icon: 'star', label: 'Deine Ersparnis', amount: '1.951 €', per: '/Monat', highlight: true },
      ],
      extras: [
        { icon: 'alert', title: 'Notfälle werden sofort priorisiert', desc: 'Keywords wie „Wasserschaden" oder „Heizung aus" lösen Priorität HOCH aus — du bekommst direkt eine Push-Nachricht.' },
        { icon: 'clipboard', title: 'Alle Kundendaten strukturiert', desc: 'Name, Adresse, Fehlerbild, Rückrufnummer — automatisch ins Ticket, keine verlorenen Zettel auf der Baustelle.' },
        { icon: 'clock', title: 'Abends und am Wochenende erreichbar', desc: 'Notdienst-Anrufer bekommen immer eine Antwort — und du entscheidest, wann du zurückrufst.' },
      ],
    },
    faq: [
      { q: 'Erkennt Phonbot den Unterschied zwischen Notfall und regulärem Termin?', a: 'Ja. Keywords wie "sofort", "Wasserschaden", "brennt" lösen automatisch Priorität-hoch aus. Du kannst im Agent Builder deine eigenen Notfall-Regeln ergänzen.' },
      { q: 'Kann ich unterwegs auf Anfragen reagieren?', a: 'Ja. Alle Tickets kommen im Dashboard an, zusätzlich per E-Mail-Benachrichtigung.' },
      { q: 'Versteht Phonbot Handwerks-Fachbegriffe (Thermostat, Siphon, etc.)?', a: 'Ja. Das LLM kennt deutsche Handwerks-Terminologie und kann bei Unklarheit gezielt nachfragen.' },
      { q: 'Was wenn mehrere Kunden gleichzeitig anrufen?', a: 'Phonbot nimmt mehrere Anrufe parallel an (eigener Agent pro Gespräch). Niemand hängt in der Warteschleife.' },
    ],
    ctaHeading: 'Handwerksbetrieb automatisieren — 30 Freiminuten',
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
    value: {
      headline: 'Deine MFA ist am Limit. <span class="accent">Was hilft wirklich?</span>',
      insight: {
        stat: '40 %',
        claim: 'aller Praxis-Telefonate drehen sich um Rezepte, Sprechzeiten oder Termine — genau die Routine, die deine MFA ersticken.',
      },
      scenario: 'Mittelgroße Praxis, 500 Anrufe pro Woche:',
      roi: [
        { icon: 'user', label: 'Zweite Teilzeit-MFA', amount: '1.800 €', per: '/Monat' },
        { icon: 'chat', label: 'Phonbot Pro — 2.000 Min inklusive', amount: '149 €', per: '/Monat' },
        { icon: 'star', label: 'Deine Ersparnis', amount: '1.651 €', per: '/Monat', highlight: true },
      ],
      extras: [
        { icon: 'pill', title: 'Rezept-Anfragen DSGVO-konform erfasst', desc: 'Patient + Medikament + Geburtsdatum landen strukturiert im Dashboard — keine Zettel auf dem Empfang.' },
        { icon: 'calendar', title: 'Routine-Termine direkt vergeben', desc: 'Chipy kennt deine Sprechzeiten und bucht freie Slots ohne MFA-Eingriff — sie bleibt für Patienten vor Ort frei.' },
        { icon: 'alert', title: 'Akute Notfälle werden weitergeleitet', desc: 'Symptome wie „Atemnot" oder „Brustschmerz" verweisen sofort an 112 — keine KI-Diagnose, aber saubere Triage.' },
      ],
    },
    faq: [
      { q: 'Ist Phonbot DSGVO-konform für Patientendaten?', a: 'Ja. Server in Deutschland, AES-256 verschlüsselt, AV-Vertrag verfügbar. PII-Redaction entfernt sensible Daten aus Transkripten.' },
      { q: 'Kann Phonbot zwischen Akut- und Routine-Fällen unterscheiden?', a: 'Ja. Keywords wie "Schmerzen", "akut", "Notfall" triggern Priorisierung. Bei echten Notfällen weist Phonbot an 112 zu rufen.' },
      { q: 'Passt das zu meiner Praxis-Software?', a: 'Phonbot arbeitet mit dem Kalender-System (Google, Outlook, Cal.com). Direkte Integration mit PVS-Systemen auf Anfrage.' },
      { q: 'Werden Gespräche aufgenommen?', a: 'Standardmäßig werden Transkripte erstellt, keine Audio-Aufzeichnung. Patienten werden zu Gesprächsbeginn auf die KI-Nutzung hingewiesen.' },
    ],
    ctaHeading: 'Praxis-Team entlasten — 30 Freiminuten',
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
    value: {
      headline: 'Anfragen kommen rein — <span class="accent">und keiner im Büro.</span>',
      insight: {
        stat: '78 %',
        claim: 'der gewerblichen Anfragen landen tagsüber — genau dann, wenn dein Team beim Kunden vor Ort ist.',
      },
      scenario: 'Reinigungsfirma, 150 Auftrags-Anfragen pro Monat:',
      roi: [
        { icon: 'user', label: 'Disposition / Bürokraft', amount: '1.800 €', per: '/Monat' },
        { icon: 'chat', label: 'Phonbot Starter', amount: '49 €', per: '/Monat' },
        { icon: 'star', label: 'Deine Ersparnis', amount: '1.751 €', per: '/Monat', highlight: true },
      ],
      extras: [
        { icon: 'document', title: 'Angebotsanfragen sauber aufgenommen', desc: 'Objekt-Art, Quadratmeter, Frequenz — alles systematisch im Ticket, keine Excel-Liste am Abend mehr.' },
        { icon: 'calendar', title: 'Wiederkehrende Aufträge live gebucht', desc: 'Freie Slots für Büroreinigung oder Gastro-Grundreinigung direkt vereinbart — feste Kunden freuen sich.' },
        { icon: 'euro', title: 'Preisauskunft für Standard-Leistungen', desc: 'Chipy kennt deine Preistabellen und gibt direkt Auskunft — der Interessent weiß sofort, woran er ist.' },
      ],
    },
    faq: [
      { q: 'Kann Phonbot nach Reinigungs-Art filtern (Unterhaltsreinigung vs. Grundreinigung)?', a: 'Ja. Im Agent Builder definierst du deine Leistungspakete mit Fragen zur Unterscheidung.' },
      { q: 'Was bei Notdienst-Reinigung (z.B. Wasserschaden)?', a: 'Phonbot flaggt Notfälle automatisch als Priorität-hoch. Du bekommst sofortige Push-Nachricht.' },
      { q: 'Kann ich verschiedene Service-Gebiete abdecken?', a: 'Ja. Phonbot fragt die PLZ ab und leitet je nach Gebiet an das richtige Team weiter (Agent Builder Routing-Regeln).' },
      { q: 'Lässt sich Phonbot für Hausreinigung UND Gewerbe gleichzeitig nutzen?', a: 'Ja. Im Pro-Plan hast du 3 Agents — z.B. einer für Privatkunden, einer für Gewerbe.' },
    ],
    ctaHeading: 'Reinigungs-Telefon automatisieren — 30 Freiminuten',
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
    value: {
      headline: 'Service-Spitze — und das Telefon <span class="accent">hört nicht auf.</span>',
      insight: {
        stat: '2 Tische',
        claim: 'pro Abend verliert ein durchschnittliches Restaurant an die Warteschleife — das sind 50 Tische pro Monat, die woanders essen.',
      },
      scenario: 'Restaurant mit 400 Anrufen pro Monat:',
      roi: [
        { icon: 'user', label: 'Service-Kraft nur fürs Telefon', amount: '1.700 €', per: '/Monat' },
        { icon: 'chat', label: 'Phonbot Starter', amount: '49 €', per: '/Monat' },
        { icon: 'star', label: 'Deine Ersparnis', amount: '1.651 €', per: '/Monat', highlight: true },
      ],
      extras: [
        { icon: 'calendar', title: 'Reservierungen parallel annehmen', desc: 'Mehrere Gäste gleichzeitig — keine Warteschleife, niemand legt vor der Reservierung auf.' },
        { icon: 'clipboard', title: 'Allergien und Wünsche strukturiert', desc: 'Kinderhochstuhl, Veganer, Allergien — alles notiert und im Reservierungssystem, bevor der Gast kommt.' },
        { icon: 'document', title: 'Take-Away-Bestellungen direkt zur Küche', desc: 'Bestellung mit Artikeln und Abholzeit landet als Ticket am Küchenpass — kein Notizblock mehr.' },
      ],
    },
    faq: [
      { q: 'Klappt das mit meinem Reservierungs-System (Resmio, Quandoo, OpenTable)?', a: 'Gängige Kalender (Google, Outlook, Cal.com) funktionieren direkt. Spezifische Reservierungs-Systeme auf Anfrage — meist via Kalender-Sync machbar.' },
      { q: 'Was bei Sonderwünschen (Allergien, Kinderhochstuhl)?', a: 'Phonbot fragt standardmäßig nach Allergien und fügt Notizen zur Reservierung. Individuelle Felder definierst du im Agent Builder.' },
      { q: 'Kann Phonbot Bestellungen für Lieferdienst annehmen?', a: 'Ja. Bestellungen werden als Ticket mit Artikeln + Lieferadresse an die Küche weitergeleitet.' },
      { q: 'Versteht Phonbot Dialekte (Bayrisch, Berlinerisch)?', a: 'Ja. Deutsches Sprach-Modell erkennt regionale Varianten und Gerichte-Slang.' },
    ],
    ctaHeading: 'Restaurant-Telefon automatisieren — 30 Freiminuten',
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
    value: {
      headline: 'Der Kunde will reparieren — <span class="accent">du liegst unterm Auto.</span>',
      insight: {
        stat: '1 von 3',
        claim: 'Werkstatt-Anrufen geht verloren, weil niemand am Tresen frei ist. Der Kunde ruft die nächste Werkstatt an.',
      },
      scenario: 'Werkstatt mit 250 Anrufen pro Monat:',
      roi: [
        { icon: 'user', label: 'Teilzeit-Tresen', amount: '1.800 €', per: '/Monat' },
        { icon: 'chat', label: 'Phonbot Starter', amount: '49 €', per: '/Monat' },
        { icon: 'star', label: 'Deine Ersparnis', amount: '1.751 €', per: '/Monat', highlight: true },
      ],
      extras: [
        { icon: 'car', title: 'Fahrzeug-Daten systematisch erfasst', desc: 'Modell, Baujahr, Kilometerstand, Fehlerbild — strukturiert im Ticket, nie auf dem Zettel verschlampt.' },
        { icon: 'calendar', title: 'TÜV und Inspektion automatisch gebucht', desc: 'Chipy kennt deine Werkstatt-Auslastung und vergibt passende Slots — ohne dass du anrufen musst.' },
        { icon: 'document', title: 'Kostenvoranschlag-Tickets sauber', desc: 'Komplexe Anfragen landen als Ticket im Dashboard — du rufst später in Ruhe mit dem Angebot zurück.' },
      ],
    },
    faq: [
      { q: 'Kann Phonbot verschiedene Werkstatt-Bereiche unterscheiden?', a: 'Ja. Du legst im Agent Builder fest: Reifen-Express (30 Min), Inspektion (2h), Unfall-Reparatur (Termin). Phonbot routet korrekt.' },
      { q: 'Was bei TÜV-Terminen?', a: 'Phonbot bucht TÜV-Vorbereitungs-Termine und erinnert auf Wunsch an ablaufende Plaketten.' },
      { q: 'Kann der Kunde ein Kostenvoranschlag-Angebot direkt bestätigen?', a: 'Aktuell erstellt Phonbot ein Ticket, du schickst das Angebot per E-Mail/SMS. Auto-Bestätigung via Link kommt 2026.' },
      { q: 'Versteht Phonbot Kfz-Fachbegriffe (Zahnriemen, Zylinderkopfdichtung)?', a: 'Ja. Deutsches LLM kennt Kfz-Terminologie.' },
    ],
    ctaHeading: 'Werkstatt-Telefon automatisieren — 30 Freiminuten',
  },
];

const STYLE = `*{margin:0;padding:0;box-sizing:border-box}
html{overflow-x:clip;max-width:100vw;scroll-behavior:smooth}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#0A0A0F;color:#fff;line-height:1.6;overflow-x:clip;max-width:100vw;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;position:relative}
a{color:inherit;text-decoration:none}
::selection{background:rgba(249,115,22,0.3);color:#fff}
.container{max-width:72rem;margin:0 auto;padding:0 1.5rem;position:relative;z-index:1}

/* ── Noise overlay (keeps dark from feeling plastic) ── */
.noise::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");opacity:.015}

/* ── Ambient glow orbs (3 pulsing radials, fixed full-bleed) ── */
.orbs{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:0}
.orb{position:absolute;border-radius:50%;filter:blur(40px);animation:glow-pulse 3s ease-in-out infinite}
.orb-1{width:700px;height:700px;top:-160px;left:-160px;background:radial-gradient(circle,rgba(249,115,22,.18) 0%,transparent 70%)}
.orb-2{width:600px;height:600px;top:50%;right:-240px;background:radial-gradient(circle,rgba(6,182,212,.12) 0%,transparent 70%);animation-delay:1.5s}
.orb-3{width:500px;height:500px;bottom:-160px;left:35%;background:radial-gradient(circle,rgba(249,115,22,.10) 0%,transparent 70%);animation-delay:3s}
@keyframes glow-pulse{0%,100%{opacity:.3}50%{opacity:.7}}

/* ── Glass utility ── */
.glass{backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10)}

/* ── Nav (unified with SPA + legal pages) ── */
${NAV_STYLE}

/* ── Buttons (canonical gradient pill + neutral glass pill) ── */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:1rem 2rem;border-radius:9999px;font-weight:600;font-size:1rem;transition:all .3s;cursor:pointer;border:none;text-decoration:none}
.btn-primary{background:linear-gradient(135deg,#F97316,#06B6D4);color:#fff}
.btn-primary:hover{transform:scale(1.05);box-shadow:0 0 40px rgba(249,115,22,.5)}
.btn-ghost{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.9);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.btn-ghost:hover{color:#fff;transform:scale(1.05)}
.btn-sm{padding:.625rem 1.25rem;font-size:.875rem}

/* ── Hero (section 1) ── */
header.hero{padding:5rem 0 4rem;text-align:center;position:relative;z-index:1}
@media(max-width:640px){header.hero{padding:3.5rem 0 2.5rem}}
.hero-eyebrow{display:inline-flex;align-items:center;gap:.5rem;padding:.45rem 1rem;border-radius:9999px;background:rgba(249,115,22,.10);border:1px solid rgba(249,115,22,.25);font-size:.8125rem;color:#FDBA74;margin-bottom:1.75rem;font-weight:500;box-shadow:0 0 20px rgba(249,115,22,.15),inset 0 0 20px rgba(249,115,22,.04)}
.hero-eyebrow .ic{display:inline-flex;align-items:center;color:#FDBA74}
.hero-eyebrow .ic svg{display:block;width:14px;height:14px}
.ic-inline{display:inline-flex;align-items:center;vertical-align:-3px;color:rgba(255,255,255,.55);margin-right:.4rem}
.ic-inline svg{display:block}
.dialogue .bot .ic-inline{color:#FDBA74}
.savings li .ic-inline{color:#FDBA74;margin-right:.55rem}
h1{font-size:clamp(2.5rem,6vw,4.5rem);font-weight:800;letter-spacing:-.025em;line-height:1.08;margin-bottom:1.5rem;max-width:48rem;margin-left:auto;margin-right:auto}
h1 .accent{background:linear-gradient(135deg,#F97316,#06B6D4);-webkit-background-clip:text;background-clip:text;color:transparent}
.subtitle{font-size:1.125rem;color:rgba(255,255,255,.6);max-width:42rem;margin:0 auto 2.5rem;line-height:1.6}
.cta-row{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;align-items:center}
.trust-line{margin-top:1rem;font-size:.8125rem;color:rgba(255,255,255,.4)}

/* ── Sections + headings ── */
section{padding:5rem 0;position:relative;z-index:1}
@media(max-width:640px){section{padding:3rem 0}}
h2{font-size:clamp(1.75rem,4vw,2.5rem);font-weight:700;margin-bottom:.75rem;letter-spacing:-.02em;line-height:1.15;text-align:center}
.section-lead{font-size:1rem;color:rgba(255,255,255,.5);text-align:center;max-width:36rem;margin:0 auto 3rem}
h3{font-size:1.0625rem;font-weight:600;margin-bottom:.5rem;color:#fff}
p{color:rgba(255,255,255,.7)}

/* ── Features (glass cards with gradient-tinted icon tiles) ── */
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1.25rem}
.feature{padding:1.75rem;border-radius:1rem;backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);transition:all .3s}
.feature:hover{border-color:rgba(249,115,22,.3);background:rgba(255,255,255,.07);transform:translateY(-2px)}
.feature-icon{width:48px;height:48px;border-radius:.875rem;background:linear-gradient(135deg,rgba(249,115,22,.18),rgba(6,182,212,.12));display:flex;align-items:center;justify-content:center;margin-bottom:1.25rem;border:1px solid rgba(249,115,22,.15);color:#FB923C}
.feature-icon svg{display:block;width:22px;height:22px}
.feature h3{font-size:1.0625rem;margin-bottom:.5rem}
.feature p{font-size:.9375rem;line-height:1.55}

/* ── Call-style dialogue (glass card with animated chat bubbles) ── */
.dialogue{backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:1.5rem;padding:1.75rem;max-width:640px;margin:0 auto;position:relative;overflow:hidden}
@media(max-width:640px){.dialogue{padding:1.25rem}}
.dialogue-header{display:flex;align-items:center;gap:.6rem;padding-bottom:1rem;margin-bottom:1.25rem;border-bottom:1px solid rgba(255,255,255,.06);font-size:.7rem;color:rgba(255,255,255,.55);text-transform:uppercase;letter-spacing:.1em;font-weight:600}
.dialogue-header .dot{width:8px;height:8px;border-radius:50%;background:#ef4444;animation:call-pulse 2s ease-in-out infinite}
@keyframes call-pulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.6),0 0 0 0 rgba(239,68,68,.35)}50%{box-shadow:0 0 0 6px rgba(239,68,68,0),0 0 0 12px rgba(239,68,68,0)}}
.dialogue-header .duration{margin-left:auto;font-variant-numeric:tabular-nums;color:rgba(255,255,255,.5);letter-spacing:.06em}

.msg{display:flex;gap:.65rem;align-items:flex-end;margin-bottom:.875rem;opacity:0;transform:translateY(10px);animation:msg-in .55s cubic-bezier(.16,1,.3,1) both}
.msg:last-child{margin-bottom:0}
@keyframes msg-in{to{opacity:1;transform:translateY(0)}}
.msg:nth-child(2){animation-delay:.20s}
.msg:nth-child(3){animation-delay:.45s}
.msg:nth-child(4){animation-delay:.70s}
.msg:nth-child(5){animation-delay:.95s}
.msg:nth-child(6){animation-delay:1.2s}
.msg:nth-child(7){animation-delay:1.45s}
.msg:nth-child(8){animation-delay:1.7s}
.msg:nth-child(9){animation-delay:1.95s}
.msg.user{flex-direction:row-reverse}
.msg .avatar{flex-shrink:0;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);color:rgba(255,255,255,.65);position:relative}
.msg .avatar svg{display:block;width:14px;height:14px}
.msg.bot .avatar{background:radial-gradient(circle at 50% 42%,#F5C842 0%,#D49B12 100%);border-color:rgba(249,115,22,.35);box-shadow:0 0 16px rgba(249,115,22,.25);animation:chipy-breathe 3s ease-in-out infinite}
.msg.bot .avatar::before,.msg.bot .avatar::after{content:'';position:absolute;top:11px;width:3px;height:3px;border-radius:50%;background:#1C1917}
.msg.bot .avatar::before{left:9px}
.msg.bot .avatar::after{right:9px}
@keyframes chipy-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
.msg .bubble{max-width:78%;padding:.75rem 1rem;border-radius:1rem;font-size:.9375rem;line-height:1.55;position:relative}
.msg.user .bubble{background:rgba(255,255,255,.06);color:rgba(255,255,255,.82);border-bottom-right-radius:.375rem}
.msg.bot .bubble{background:linear-gradient(135deg,rgba(249,115,22,.14),rgba(6,182,212,.08));color:#fff;border:1px solid rgba(249,115,22,.22);border-bottom-left-radius:.375rem;box-shadow:0 0 24px rgba(249,115,22,.08)}
.msg .bubble .name{display:block;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.3rem;opacity:.65}
.msg.user .bubble .name{color:rgba(255,255,255,.55);text-align:right}
.msg.bot .bubble .name{color:#FDBA74}

/* Typing dots — shown after final bot message with a fade-in */
.dialogue-typing{display:inline-flex;align-items:center;gap:.25rem;padding:.6rem .8rem;border-radius:1rem;background:linear-gradient(135deg,rgba(249,115,22,.12),rgba(6,182,212,.07));border:1px solid rgba(249,115,22,.2);margin-top:.5rem}
.dialogue-typing span{width:5px;height:5px;border-radius:50%;background:#FDBA74;animation:typing-bounce 1.2s ease-in-out infinite}
.dialogue-typing span:nth-child(2){animation-delay:.15s}
.dialogue-typing span:nth-child(3){animation-delay:.3s}
@keyframes typing-bounce{0%,80%,100%{transform:translateY(0);opacity:.5}40%{transform:translateY(-4px);opacity:1}}

.dialogue-note{text-align:center;margin-top:1.5rem;font-size:.875rem;color:rgba(255,255,255,.45);animation:msg-in .6s 2.2s ease-out both}

@media(prefers-reduced-motion:reduce){
  .msg,.dialogue-note{animation:none;opacity:1;transform:none}
  .dialogue-header .dot,.msg.bot .avatar,.dialogue-typing span{animation:none}
}

/* ── Value section (the professional "why this pays off" block) ── */
.value-insight{display:flex;flex-direction:column;align-items:center;text-align:center;max-width:48rem;margin:0 auto 3rem;padding:1.75rem 1.5rem;background:linear-gradient(135deg,rgba(249,115,22,.09),rgba(6,182,212,.05));border:1px solid rgba(249,115,22,.18);border-radius:1.25rem;gap:.5rem}
@media(min-width:768px){.value-insight{flex-direction:row;gap:1.75rem;text-align:left;padding:1.75rem 2rem}}
.value-stat{font-size:clamp(2.5rem,6vw,3.75rem);font-weight:800;letter-spacing:-.03em;line-height:1;background:linear-gradient(135deg,#F97316,#06B6D4);-webkit-background-clip:text;background-clip:text;color:transparent;flex-shrink:0;white-space:nowrap}
.value-claim{color:rgba(255,255,255,.78);font-size:1rem;line-height:1.55;max-width:34rem}
@media(max-width:640px){.value-claim{font-size:.9375rem}}

.value-grid{display:grid;grid-template-columns:1fr;gap:1.5rem;max-width:64rem;margin:0 auto}
@media(min-width:900px){.value-grid{grid-template-columns:1fr 1fr;gap:1.75rem}}

/* ROI card (left column) */
.roi-card{backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);border-radius:1.25rem;padding:1.75rem;display:flex;flex-direction:column}
.roi-scenario{font-size:.75rem;color:rgba(255,255,255,.5);margin-bottom:1rem;text-transform:uppercase;letter-spacing:.1em;font-weight:600}
.roi-row{display:flex;align-items:center;gap:.875rem;padding:.875rem 0;border-bottom:1px dashed rgba(255,255,255,.07)}
.roi-row:last-of-type{border-bottom:none}
.roi-row .ic{flex-shrink:0;width:36px;height:36px;border-radius:.75rem;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.6)}
.roi-row .ic svg{display:block;width:18px;height:18px}
.roi-row .label{flex:1;color:rgba(255,255,255,.78);font-size:.9375rem;font-weight:500;line-height:1.35}
.roi-row .amount{color:rgba(255,255,255,.9);font-size:1rem;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.roi-row .per{color:rgba(255,255,255,.5);font-size:.8125rem;font-weight:500;margin-left:.15rem}

/* Highlight row = the savings reveal */
.roi-row.highlight{margin-top:.75rem;padding:1rem 1.125rem;border:1px solid rgba(249,115,22,.3);background:linear-gradient(135deg,rgba(249,115,22,.12),rgba(6,182,212,.06));border-radius:.875rem;box-shadow:0 0 32px rgba(249,115,22,.12)}
.roi-row.highlight .ic{background:linear-gradient(135deg,rgba(249,115,22,.22),rgba(6,182,212,.14));border-color:rgba(249,115,22,.30);color:#FDBA74}
.roi-row.highlight .label{color:#fff;font-weight:600}
.roi-row.highlight .amount{background:linear-gradient(135deg,#F97316,#06B6D4);-webkit-background-clip:text;background-clip:text;color:transparent;font-size:1.375rem;font-weight:800}
.roi-row.highlight .per{color:rgba(255,255,255,.6)}

/* Extras stack (right column) */
.value-extras{display:flex;flex-direction:column;gap:.875rem}
.extra{display:flex;gap:1rem;padding:1.25rem;border-radius:1rem;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);transition:all .3s}
.extra:hover{border-color:rgba(249,115,22,.25);background:rgba(255,255,255,.05);transform:translateY(-1px)}
.extra .ic{flex-shrink:0;width:38px;height:38px;border-radius:.75rem;background:linear-gradient(135deg,rgba(249,115,22,.15),rgba(6,182,212,.10));display:flex;align-items:center;justify-content:center;color:#FB923C;border:1px solid rgba(249,115,22,.18)}
.extra .ic svg{display:block;width:18px;height:18px}
.extra-body{flex:1;min-width:0}
.extra-title{color:#fff;font-weight:600;font-size:.9375rem;margin-bottom:.2rem;line-height:1.35}
.extra-desc{color:rgba(255,255,255,.6);font-size:.875rem;line-height:1.55}

/* ── FAQ (native <details> accordion, chipy-design tint on open) ── */
.faq-list{max-width:48rem;margin:0 auto;display:flex;flex-direction:column;gap:.75rem}
.faq-item{border-radius:1rem;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.02);overflow:hidden;transition:all .3s}
.faq-item[open]{background:rgba(249,115,22,.05);border-color:rgba(249,115,22,.2)}
.faq-item summary{list-style:none;padding:1rem 1.5rem;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:1rem;font-size:.9375rem;font-weight:600;color:rgba(255,255,255,.85);transition:color .2s}
.faq-item summary::-webkit-details-marker{display:none}
.faq-item summary:hover{color:#fff}
.faq-item summary::after{content:'+';display:inline-flex;align-items:center;justify-content:center;width:1.5rem;height:1.5rem;border-radius:9999px;color:rgba(255,255,255,.4);font-size:1.25rem;font-weight:400;flex-shrink:0;transition:transform .2s}
.faq-item[open] summary::after{transform:rotate(45deg);color:#FDBA74}
.faq-item .answer{padding:0 1.5rem 1.25rem;font-size:.9375rem;color:rgba(255,255,255,.55);line-height:1.6}

/* ── Demo hint chip ── */
.demo-hint{display:inline-flex;align-items:center;padding:.5rem 1rem;border-radius:.625rem;background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.2);font-size:.8125rem;color:#67E8F9;margin-top:1.25rem}

/* ── Footer (shared partial) ── */
${FOOTER_STYLE}`;

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
    .map((f) => `<div class="feature"><div class="feature-icon">${e2svg(f.icon, 22)}</div><h3>${f.title}</h3><p>${f.desc}</p></div>`)
    .join('\n        ');

  // Dialogue → chat-style msg rows. Each line arrives as
  //   '📞 Kundin: "…"'  or  'Phonbot: "…"' — drop the leading emoji
  // and split the speaker label from the body so the row can render
  // with a proper avatar + name header + bubble.
  const dialogue = d.dialogue
    .map((line) => {
      const cleaned = line.text.replace(/^📞\s*/, '').trim();
      const m = cleaned.match(/^([^:]+):\s*(.*)$/);
      const name = m ? m[1].trim() : (line.speaker === 'user' ? 'Anrufer' : 'Phonbot');
      const body = m ? m[2].trim() : cleaned;
      const avatar = line.speaker === 'user'
        ? `<div class="avatar" aria-hidden="true">${icon('phone', 14)}</div>`
        : `<div class="avatar" aria-hidden="true"></div>`;
      return `<div class="msg ${line.speaker}">${avatar}<div class="bubble"><span class="name">${name}</span>${body}</div></div>`;
    })
    .join('\n      ');

  // Derive the call duration shown in the dialogue header from the
  // per-branch `dialogueNote` (e.g. "… · Dauer: 28 Sekunden" → "0:28").
  const durMatch = (d.dialogueNote || '').match(/Dauer:\s*(\d+)\s*Sek/i);
  const callDuration = durMatch
    ? `0:${String(durMatch[1]).padStart(2, '0')}`
    : 'Live';

  const faq = d.faq
    .map((q) => `<details class="faq-item"><summary>${q.q}</summary><div class="answer">${q.a}</div></details>`)
    .join('\n      ');
  // Value section — ROI rows + extras-grid.
  const roiRows = d.value.roi
    .map(
      (r) => `<div class="roi-row${r.highlight ? ' highlight' : ''}">
          <span class="ic">${icon(r.icon, 18)}</span>
          <span class="label">${r.label}</span>
          <span class="amount">${r.amount}<span class="per">${r.per}</span></span>
        </div>`,
    )
    .join('\n        ');

  const valueExtras = d.value.extras
    .map(
      (e) => `<div class="extra">
          <span class="ic">${icon(e.icon, 18)}</span>
          <div class="extra-body">
            <div class="extra-title">${e.title}</div>
            <div class="extra-desc">${e.desc}</div>
          </div>
        </div>`,
    )
    .join('\n        ');

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
<body class="noise">
<div class="orbs" aria-hidden="true">
  <div class="orb orb-1"></div>
  <div class="orb orb-2"></div>
  <div class="orb orb-3"></div>
</div>

${NAV_HTML}

<header class="hero">
  <div class="container">
    <span class="hero-eyebrow"><span class="ic" aria-hidden="true">${e2svg(d.emoji, 14)}</span>${d.eyebrow}</span>
    <h1>${d.h1Text}</h1>
    <p class="subtitle">${d.subtitle}</p>
    <div class="cta-row">
      <a href="/?page=register" class="btn btn-primary">Kostenlos testen</a>
      <a href="/?demo=${d.templateId}#demo" class="btn btn-ghost">▶ Chipy live hören</a>
    </div>
    <div class="trust-line">✓ Kostenlos starten · ✓ Sofort einsatzbereit · ✓ DSGVO-konform</div>
  </div>
</header>

<section>
  <div class="container">
    <h2>Typische Anrufe — automatisch bearbeitet</h2>
    <p class="section-lead">Was Chipy auf deiner Nummer ab Tag 1 übernimmt.</p>
    <div class="features">
      ${features}
    </div>
  </div>
</section>

<section>
  <div class="container">
    <h2>So klingt Phonbot am Telefon</h2>
    <div class="dialogue">
      <div class="dialogue-header">
        <span class="dot" aria-hidden="true"></span>
        <span>Live-Anruf · Chipy</span>
        <span class="duration">${callDuration}</span>
      </div>
      ${dialogue}
    </div>
    <p class="dialogue-note">${d.dialogueNote}</p>
    <div style="text-align:center;margin-top:2rem">
      <a href="/?demo=${d.templateId}#demo" class="btn btn-ghost btn-sm">${icon('phone', 18)}<span style="margin-left:.5rem">Chipy live am Telefon hören</span></a>
    </div>
  </div>
</section>

<section>
  <div class="container">
    <h2>${d.value.headline}</h2>
    <div class="value-insight">
      <span class="value-stat">${d.value.insight.stat}</span>
      <span class="value-claim">${d.value.insight.claim}</span>
    </div>
    <div class="value-grid">
      <div class="roi-card">
        <div class="roi-scenario">${d.value.scenario}</div>
        ${roiRows}
      </div>
      <div class="value-extras">
        ${valueExtras}
      </div>
    </div>
  </div>
</section>

<section>
  <div class="container">
    <h2>Häufige Fragen</h2>
    <p class="section-lead">Alles, was du wissen musst — kurz und ehrlich.</p>
    <div class="faq-list">
      ${faq}
    </div>
  </div>
</section>

<section style="text-align:center">
  <div class="container">
    <h2>${d.ctaHeading}</h2>
    <p class="section-lead">Registrierung in unter 2 Minuten · Keine Kreditkarte · Monatlich kündbar.</p>
    <div class="cta-row">
      <a href="/?page=register" class="btn btn-primary">Jetzt einrichten</a>
      <a href="/?demo=${d.templateId}#demo" class="btn btn-ghost">Erst Chipy testen</a>
    </div>
  </div>
</section>

${FOOTER_HTML}
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
