import React from 'react';
import { IconScissors, IconWrench, IconMedical, IconBroom, IconRestaurant, IconCar, IconPhone, IconBolt, IconStar, IconCalendar, IconTickets, IconCalls, IconSettings, IconInsights } from '../PhonbotIcons.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type CallState = 'idle' | 'connecting' | 'active' | 'ended' | 'error';

export type FeatureItem = {
  Icon: React.FC<{ size?: number; className?: string }>;
  title: string;
  desc: string;
};

// ── Constants ────────────────────────────────────────────────────────────────

export const TEMPLATES = [
  { id: 'hairdresser',  slug: 'friseur',       Icon: IconScissors,   name: 'Friseur',       description: 'Terminbuchungen & Öffnungszeiten' },
  { id: 'tradesperson', slug: 'handwerker',    Icon: IconWrench,     name: 'Handwerker',    description: 'Auftragsannahme & Notdienst' },
  { id: 'medical',      slug: 'arztpraxis',    Icon: IconMedical,    name: 'Arztpraxis',    description: 'Terminvergabe & Sprechzeiten' },
  { id: 'cleaning',     slug: 'reinigung',     Icon: IconBroom,      name: 'Reinigung',     description: 'Angebote & Terminplanung' },
  { id: 'restaurant',   slug: 'restaurant',    Icon: IconRestaurant, name: 'Restaurant',    description: 'Reservierungen & Bestellungen' },
  { id: 'auto',         slug: 'autowerkstatt', Icon: IconCar,        name: 'Autowerkstatt', description: 'Terminvereinbarung & Kostenvoranschläge' },
] as const;

export const TEMPLATE_PREVIEWS: Record<string, string> = {
  hairdresser: '"Hallo! Salon Müller, wie kann ich helfen? Termin buchen?"',
  tradesperson: '"Handwerk Müller! Notfall oder regulärer Termin?"',
  medical: '"Praxis Dr. Müller. Termin oder dringende Frage?"',
  cleaning: '"Reinigung Müller! Für welche Räume suchen Sie Hilfe?"',
  restaurant: '"Willkommen! Tisch reservieren oder Fragen zur Karte?"',
  auto: '"Guten Tag, Werkstatt Schmidt! Für welches Fahrzeug benötigen Sie einen Termin?"',
};

export const FEATURES: FeatureItem[] = [
  { Icon: IconBolt, title: 'In 2 Minuten live', desc: 'Template wählen, Daten eintragen, fertig. Kein Techniker, kein Setup-Marathon.' },
  { Icon: IconPhone, title: 'Kein Anruf geht verloren', desc: '24/7 erreichbar — auch nachts und am Wochenende. Jeder Anruf ist ein möglicher Auftrag.' },
  { Icon: IconSettings, title: 'Deine Nummer bleibt', desc: 'Einfach weiterleiten. Kein Nummernwechsel, keine Unterbrechung für deine Kunden.' },
  { Icon: IconCalendar, title: 'Termine? Erledigt.', desc: 'Chipy bucht direkt in deinen Kalender — ohne Rückfragen, ohne Wartezeit.' },
  { Icon: IconTickets, title: 'Nichts bleibt liegen', desc: 'Was Chipy nicht sofort löst, wird zum strukturierten Ticket. Kein Zettelchaos.' },
  { Icon: IconInsights, title: 'Wird mit jedem Anruf besser', desc: 'Chipy analysiert Gespräche und optimiert sich selbst — dein Agent lernt aus jeder Interaktion.' },
];

export const STEPS = [
  { num: '1', title: 'Template wählen', desc: 'Friseur, Handwerker, Arztpraxis — wähle ein passendes Template.' },
  { num: '2', title: 'Business-Daten eingeben', desc: 'Name, Öffnungszeiten, Services. Dauert unter 2 Minuten.' },
  { num: '3', title: 'Agent ist live', desc: 'Dein Agent beantwortet Anrufe sofort. Rund um die Uhr.' },
];

export const FAQ_ITEMS = [
  {
    q: 'Brauche ich technisches Wissen?',
    a: 'Nein. Du gibst deinen Businessnamen, Öffnungszeiten und Services ein — fertig. Kein Code, kein Techniker.',
  },
  {
    q: 'Kann ich meine bisherige Telefonnummer behalten?',
    a: 'Ja. Richte eine Rufweiterleitung zu deiner Phonbot-Nummer ein. Deine bestehende Nummer bleibt unverändert.',
  },
  {
    q: 'Was passiert, wenn der Agent eine Frage nicht beantworten kann?',
    a: 'Der Agent erstellt automatisch ein Rückruf-Ticket mit allen relevanten Infos, damit du schnell nachfassen kannst.',
  },
  {
    q: 'Wie funktioniert die Kalender-Integration?',
    a: 'Phonbot verbindet sich mit Google Calendar, Microsoft Outlook oder Cal.com. Termine werden direkt eingetragen — ohne dass du eingreifen musst.',
  },
  {
    q: 'Ist Phonbot DSGVO-konform?',
    a: 'Ja. Server stehen in Deutschland (EU). Gesprächsdaten werden verschlüsselt gespeichert und können auf Wunsch jederzeit gelöscht werden.',
  },
  {
    q: 'Für welche Branchen ist Phonbot geeignet?',
    a: 'Phonbot ist optimiert für Friseure, Handwerker, Arztpraxen, Kanzleien, Gastronomie, Kosmetikstudios und alle kleinen Unternehmen die Anrufe und Terminbuchungen bearbeiten müssen. Der Agent passt sich deiner Branche über den Agent Builder an.',
  },
  {
    q: 'Kann ich den Agenten auf mehrere Sprachen einstellen?',
    a: 'Phonbot unterstützt Deutsch, Englisch, Französisch, Spanisch, Italienisch, Türkisch, Polnisch und Niederländisch. Du stellst die Hauptsprache im Agent Builder ein.',
  },
  {
    q: 'Gibt es eine Mindestlaufzeit?',
    a: 'Nein. Monatliche Pläne sind monatlich kündbar. Beim Jahresplan sparst du 20%, aber es gibt keine Strafgebühren.',
  },
  {
    q: 'Was passiert wenn mein Minutenkontingent aufgebraucht ist?',
    a: 'Der Agent bleibt aktiv — zusätzliche Minuten werden zum günstigen Überschreitungspreis (ab 0,06 €/Min) abgerechnet. Du wirst per E-Mail informiert.',
  },
];

export const PLANS = [
  {
    name: 'Free',
    price: '0€',
    yearlyPrice: '0€',
    period: '/Monat',
    features: [
      '100 Freiminuten (einmalig)',
      '1 Agent',
      'Web-Calls only',
      'Demo & Testen',
    ],
    cta: 'Kostenlos starten',
    highlight: false,
    badge: null as string | null,
  },
  {
    name: 'Starter',
    price: '49€',
    yearlyPrice: '39€',
    period: '/Monat',
    features: [
      '✦ Telefonnummer inklusive',
      '500 Min/Monat',
      '1 Agent',
      'E-Mail-Benachrichtigungen',
      '+0,10€/Min bei Überschreitung',
    ],
    cta: 'Jetzt starten',
    highlight: false,
    badge: null as string | null,
  },
  {
    name: 'Pro',
    price: '149€',
    yearlyPrice: '119€',
    period: '/Monat',
    features: [
      '✦ Telefonnummer inklusive',
      '2.000 Min/Monat',
      '3 Agents',
      'Kalender-Integration',
      'Priority Support',
      '+0,08€/Min bei Überschreitung',
    ],
    cta: 'Jetzt upgraden',
    highlight: true,
    badge: 'Empfohlen',
  },
  {
    name: 'Agency',
    price: '299€',
    yearlyPrice: '239€',
    period: '/Monat',
    features: [
      '✦ Telefonnummer inklusive',
      '5.000 Min/Monat',
      '10 Agents',
      'White-Label',
      'Dedicated Support',
      '+0,06€/Min bei Überschreitung',
    ],
    cta: 'Kontakt aufnehmen',
    highlight: false,
    badge: null as string | null,
  },
];

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useVisible(ref: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) setVisible(true); },
      { threshold: 0, rootMargin: '0px 0px -50px 0px' }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return visible;
}

export function useCountUp(target: number, duration: number, active: boolean) {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(tick);
      else setCount(target);
    };
    requestAnimationFrame(tick);
  }, [active, target, duration]);
  return count;
}
