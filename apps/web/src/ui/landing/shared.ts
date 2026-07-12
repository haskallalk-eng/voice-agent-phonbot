import React from 'react';
import { IconScissors, IconPhone, IconBolt, IconStar, IconCalendar, IconTickets, IconCalls, IconSettings, IconInsights } from '../PhonbotIcons.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type CallState = 'idle' | 'connecting' | 'active' | 'ended' | 'error';

export type FeatureItem = {
  Icon: React.FC<{ size?: number; className?: string }>;
  title: string;
  desc: string;
};

// ── Constants ────────────────────────────────────────────────────────────────

// Phonbot ist auf Friseursalons fokussiert — bewusst nur ein Template.
// (Weitere Branchen-Daten leben in der Git-History, falls wir wieder öffnen.)
export const TEMPLATES = [
  { id: 'hairdresser',  slug: 'friseur',        Icon: IconScissors,   name: 'Friseur',        description: 'Terminbuchungen, Services & Öffnungszeiten' },
] as const;

export const TEMPLATE_PREVIEWS: Record<string, string> = {
  hairdresser: '"Hallo! Salon Müller, wie kann ich helfen? Termin buchen?"',
};

export const DEMO_PHONE_NUMBER = '+493075937286';
export const DEMO_PHONE_LABEL = '+49 30 75937286';
export const DEMO_PHONE_HREF = `tel:${DEMO_PHONE_NUMBER}`;

export const FEATURES: FeatureItem[] = [
  { Icon: IconBolt, title: 'In 2 Minuten live', desc: 'Salon-Daten eintragen, fertig. Kein Techniker, kein Setup-Marathon.' },
  { Icon: IconPhone, title: 'Weniger Anrufe verpassen', desc: '24/7 erreichbar — auch während du schneidest, färbst oder föhnst. Jeder verpasste Anruf ist ein verpasster Termin.' },
  { Icon: IconSettings, title: 'Deine Nummer bleibt', desc: 'Einfach weiterleiten. Kein Nummernwechsel, keine Unterbrechung für deine Kunden.' },
  { Icon: IconCalendar, title: 'Termine? Strukturiert.', desc: 'Phonbot prüft freie Slots und bucht erst, wenn dein Salonkalender die Buchung bestätigt.' },
  { Icon: IconTickets, title: 'Nichts bleibt liegen', desc: 'Was Phonbot nicht sofort löst, wird zum strukturierten Ticket. Kein Zettelchaos am Empfang.' },
  { Icon: IconInsights, title: 'Wird mit jedem Anruf besser', desc: 'Phonbot analysiert Gespräche und optimiert sich selbst — dein Agent lernt aus jeder Interaktion.' },
];

export const STEPS = [
  { num: '1', title: 'Salon anlegen', desc: 'Das Friseur-Template ist vorbereitet: Termine, Services, Preise, Öffnungszeiten.' },
  { num: '2', title: 'Salon-Daten eingeben', desc: 'Name, Öffnungszeiten, Leistungen. Dauert unter 2 Minuten.' },
  { num: '3', title: 'Phonbot ist live', desc: 'Dein Telefonassistent beantwortet Anrufe sofort. Rund um die Uhr.' },
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
    q: 'Was passiert, wenn Phonbot eine Frage nicht beantworten kann?',
    a: 'Phonbot erstellt automatisch ein Rückruf-Ticket mit allen relevanten Infos, damit du schnell nachfassen kannst.',
  },
  {
    q: 'Wie funktioniert die Kalender-Integration?',
    a: 'Phonbot verbindet sich mit Google Calendar, Microsoft Outlook oder Cal.com. Termine werden direkt eingetragen — ohne dass du eingreifen musst.',
  },
  {
    q: 'Wie ist Phonbot datenschutzrechtlich aufgestellt?',
    a: 'Phonbot ist DSGVO-fokussiert: AVV verfügbar, Hosting in Deutschland/EU und verschlüsselte Speicherung. Für Telefonie und KI werden einzelne Subprozessoren mit USA-Bezug über SCC/DPF abgesichert.',
  },
  {
    q: 'Für wen ist Phonbot geeignet?',
    a: 'Phonbot ist auf Friseursalons spezialisiert. Terminbuchung mit Wunschfriseur, Leistungen, Preise, Öffnungszeiten und Rückruf-Tickets sind auf Salon-Abläufe zugeschnitten — vom Einzelstuhl bis zum Team-Salon mit Mitarbeiterkalendern.',
  },
  {
    q: 'Kann ich den Agenten auf mehrere Sprachen einstellen?',
    a: 'Phonbot unterstützt über 30 Sprachen. Für 15 davon (u. a. Deutsch, Englisch, Französisch, Spanisch, Italienisch, Türkisch, Polnisch, Niederländisch, Portugiesisch, Russisch, Japanisch, Koreanisch, Chinesisch, Hindi, Schwedisch) gibt es native, muttersprachlich aufgenommene Stimmen. Die übrigen Sprachen nutzen multilinguale Fallback-Stimmen; für beste Qualität kannst du dort eine eigene Stimme klonen. Du stellst die Hauptsprache im Agent Builder ein.',
  },
  {
    q: 'Gibt es eine Mindestlaufzeit?',
    a: 'Nein. Monatliche Pläne sind monatlich kündbar. Beim Jahresplan sparst du je nach Plan ca. 15-18%, aber es gibt keine Strafgebühren.',
  },
  {
    q: 'Was passiert wenn mein Minutenkontingent aufgebraucht ist?',
    a: 'Der Agent bleibt aktiv — zusätzliche Minuten werden je nach Plan zum Überschreitungspreis von 0,19–0,25 €/Min abgerechnet. Du wirst per E-Mail informiert.',
  },
];

export const PLANS = [
  {
    name: 'Free',
    price: '0€',
    yearlyPrice: '0€',
    period: '/Monat',
    features: [
      '30 Freiminuten (einmalig)',
      '1 Agent',
      'Nur Web-Anrufe (Demo)',
      'Zum Ausprobieren',
    ],
    cta: 'Kostenlos starten',
    highlight: false,
    badge: null as string | null,
  },
  {
    name: 'Nummer',
    price: '8,99€',
    yearlyPrice: '7,67€',
    period: '/Monat',
    features: [
      '✦ Eigene Telefonnummer',
      '70 Minuten / Monat',
      '1 Agent',
      'Ticket-System',
    ],
    cta: 'Nummer kaufen',
    highlight: false,
    badge: null as string | null,
  },
  {
    name: 'Starter',
    price: '89€',
    yearlyPrice: '74€',
    period: '/Monat',
    features: [
      '✦ Telefonnummer inklusive',
      '300 Min/Monat',
      '1 Agent',
      'E-Mail-Benachrichtigungen',
      '+0,25€/Min bei Überschreitung',
    ],
    cta: 'Jetzt starten',
    highlight: false,
    badge: null as string | null,
  },
  {
    name: 'Professional',
    price: '179€',
    yearlyPrice: '149€',
    period: '/Monat',
    features: [
      '✦ Telefonnummer inklusive',
      '900 Min/Monat',
      '3 Agents',
      'Kalender-Integration',
      'Priority Support',
      '+0,23€/Min bei Überschreitung',
    ],
    cta: 'Jetzt upgraden',
    highlight: true,
    badge: 'Beliebt',
  },
  {
    name: 'Filialen',
    price: '349€',
    yearlyPrice: '289€',
    period: '/Monat',
    features: [
      '✦ Telefonnummer inklusive',
      '2.000 Min/Monat',
      '10 Agenten — z. B. je Standort',
      'Persönlicher Ansprechpartner',
      '+0,19€/Min bei Überschreitung',
    ],
    cta: 'Jetzt upgraden',
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
