import React, { useRef, useState } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';
import { createDemoCall } from '../lib/api.js';
import { FoxLogo, PhonbotBrand } from './FoxLogo.js';
import { OwlyDemoModal } from './OwlyDemoModal.js';
import { LegalModal } from './LegalModal.js';
import { CookieBanner } from './CookieBanner.js';
import { IconScissors, IconWrench, IconMedical, IconBroom, IconRestaurant, IconCar, IconPhone, IconBolt, IconStar, IconPlay, IconCalendar, IconTickets, IconCalls, IconSettings } from './PhonbotIcons.js';


type CallState = 'idle' | 'connecting' | 'active' | 'ended' | 'error';

const TEMPLATES = [
  { id: 'hairdresser', Icon: IconScissors, name: 'Friseur', description: 'Terminbuchungen & Öffnungszeiten' },
  { id: 'tradesperson', Icon: IconWrench, name: 'Handwerker', description: 'Auftragsannahme & Notdienst' },
  { id: 'medical', Icon: IconMedical, name: 'Arztpraxis', description: 'Terminvergabe & Sprechzeiten' },
  { id: 'cleaning', Icon: IconBroom, name: 'Reinigung', description: 'Angebote & Terminplanung' },
  { id: 'restaurant', Icon: IconRestaurant, name: 'Restaurant', description: 'Reservierungen & Bestellungen' },
  { id: 'auto', Icon: IconCar, name: 'Autowerkstatt', description: 'Terminvereinbarung & Kostenvoranschläge' },
] as const;

const TEMPLATE_PREVIEWS: Record<string, string> = {
  hairdresser: '"Hallo! Salon Müller, wie kann ich helfen? Termin buchen?"',
  tradesperson: '"Handwerk Müller! Notfall oder regulärer Termin?"',
  medical: '"Praxis Dr. Müller. Termin oder dringende Frage?"',
  cleaning: '"Reinigung Müller! Für welche Räume suchen Sie Hilfe?"',
  restaurant: '"Willkommen! Tisch reservieren oder Fragen zur Karte?"',
  auto: '"Guten Tag, Werkstatt Schmidt! Für welches Fahrzeug benötigen Sie einen Termin?"',
};

type FeatureItem = {
  Icon: React.FC<{ size?: number; className?: string }>;
  title: string;
  desc: string;
};
const FEATURES: FeatureItem[] = [
  { Icon: IconBolt, title: 'In 2 Minuten live', desc: 'Template wählen, Daten eintragen, fertig. Kein Techniker, kein Setup-Marathon.' },
  { Icon: IconPhone, title: 'Kein Anruf geht verloren', desc: '24/7 erreichbar — auch nachts und am Wochenende. Jeder Anruf ist ein möglicher Auftrag.' },
  { Icon: IconSettings, title: 'Deine Nummer bleibt', desc: 'Einfach weiterleiten. Kein Nummernwechsel, keine Unterbrechung für deine Kunden.' },
  { Icon: IconCalendar, title: 'Termine? Erledigt.', desc: 'Phonbot bucht direkt in deinen Kalender — ohne Rückfragen, ohne Wartezeit.' },
  { Icon: IconTickets, title: 'Nichts bleibt liegen', desc: 'Was Phonbot nicht sofort löst, wird zum strukturierten Ticket. Kein Zettelchaos.' },
  { Icon: IconCalls, title: 'Voller Überblick', desc: 'Anrufe, Buchungen, Tickets — alles auf einem Dashboard. Du siehst was läuft.' },
];

const STEPS = [
  { num: '1', title: 'Template wählen', desc: 'Friseur, Handwerker, Arztpraxis — wähle ein passendes Template.' },
  { num: '2', title: 'Business-Daten eingeben', desc: 'Name, Öffnungszeiten, Services. Dauert unter 2 Minuten.' },
  { num: '3', title: 'Agent ist live', desc: 'Dein Agent beantwortet Anrufe sofort. Rund um die Uhr.' },
];

const FAQ_ITEMS = [
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
    a: 'Phonbot verbindet sich mit Google Calendar oder Cal.com. Termine werden direkt eingetragen — ohne dass du eingreifen musst.',
  },
  {
    q: 'Ist Phonbot DSGVO-konform?',
    a: 'Ja. Server stehen in Deutschland (EU). Gesprächsdaten werden verschlüsselt gespeichert und können auf Wunsch jederzeit gelöscht werden.',
  },
  {
    q: 'Kann ich den Agenten auf mehrere Sprachen einstellen?',
    a: 'Phonbot unterstützt Deutsch, Englisch und weitere EU-Sprachen. Du stellst die Hauptsprache im Agent Builder ein.',
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

function CallbackSection() {
  const [phone, setPhone] = React.useState('');
  const [name, setName] = React.useState('');
  const [state, setState] = React.useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const ref = React.useRef<HTMLElement>(null);
  const visible = useVisible(ref);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;
    setState('loading');
    try {
      const res = await fetch('/api/outbound/website-callback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), name: name.trim() || undefined }),
      });
      if (!res.ok) throw new Error();
      setState('success');
    } catch {
      setState('error');
    }
  }

  return (
    <section
      ref={ref}
      id="callback"
      className="relative z-10 px-6 py-24"
      style={{ opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(32px)', transition: 'opacity 0.7s ease, transform 0.7s ease' }}
    >
      <div className="max-w-2xl mx-auto">
        {/* Card */}
        <div
          className="relative rounded-3xl overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(15,15,28,0.98), rgba(10,10,20,0.98))',
            border: '1px solid rgba(249,115,22,0.25)',
            boxShadow: '0 0 80px rgba(249,115,22,0.12), 0 0 160px rgba(6,182,212,0.06), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          {/* Glow blob */}
          <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.15) 0%, transparent 70%)' }} />
          <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.10) 0%, transparent 70%)' }} />

          <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-0">
            {/* Left — visual side */}
            <div className="p-8 sm:p-10 flex flex-col justify-center">
              {/* Phone icon with ring animation */}
              <div className="relative w-16 h-16 mb-6">
                <div className="absolute inset-0 rounded-full animate-ping"
                  style={{ background: 'rgba(249,115,22,0.15)', animationDuration: '2s' }} />
                <div className="absolute inset-1 rounded-full animate-ping"
                  style={{ background: 'rgba(249,115,22,0.1)', animationDuration: '2s', animationDelay: '0.5s' }} />
                <div className="relative w-full h-full rounded-full flex items-center justify-center text-2xl"
                  style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.3), rgba(6,182,212,0.2))' }}>
                  📞
                </div>
              </div>

              <h2 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight mb-3">
                Chippy ruft dich<br />
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
                  in 60 Sekunden
                </span>{' '}an
              </h2>
              <p className="text-white/45 text-sm leading-relaxed mb-6">
                Erfahre live wie ein KI-Agent klingt — kostenlos, ohne Risiko, direkt auf dein Handy.
              </p>

              {/* Trust signals */}
              <div className="space-y-2">
                {['Kein Spam, kein Sales-Druck', 'Funktioniert auf jede Handynummer', 'Kostenlos & unverbindlich'].map(t => (
                  <div key={t} className="flex items-center gap-2 text-xs text-white/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500/70 shrink-0" />
                    {t}
                  </div>
                ))}
              </div>
            </div>

            {/* Right — form side */}
            <div className="p-8 sm:p-10 sm:border-l" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              {state === 'success' ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
                    style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)' }}>
                    ✓
                  </div>
                  <div>
                    <p className="text-green-300 font-bold text-lg">Chippy ruft dich an!</p>
                    <p className="text-white/40 text-sm mt-1">Bitte hab dein Telefon bereit — der Anruf kommt gleich.</p>
                  </div>
                  <button onClick={() => setState('idle')} className="text-xs text-white/30 hover:text-white/50 transition-colors mt-2">
                    Nochmal versuchen
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4 h-full flex flex-col justify-center">
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-wide">Dein Name</label>
                    <input
                      type="text"
                      placeholder="Max Mustermann"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-xl bg-white/[0.06] border border-white/10 px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-wide">Telefonnummer *</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-sm select-none">📱</span>
                      <input
                        type="tel"
                        placeholder="+49 123 456789"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                        className="w-full rounded-xl bg-white/[0.06] border border-white/10 pl-10 pr-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40 transition-all"
                      />
                    </div>
                  </div>
                  {state === 'error' && (
                    <p className="text-red-400 text-xs bg-red-500/10 rounded-lg px-3 py-2">
                      ⚠️ Etwas ist schiefgelaufen — bitte versuche es erneut.
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={state === 'loading' || !phone.trim()}
                    className="w-full rounded-xl px-6 py-3.5 font-bold text-white text-sm disabled:opacity-40 transition-all duration-300 hover:scale-[1.02]"
                    style={{
                      background: 'linear-gradient(135deg, #F97316, #06B6D4)',
                      boxShadow: state !== 'loading' && phone.trim() ? '0 0 32px rgba(249,115,22,0.35)' : 'none',
                    }}
                  >
                    {state === 'loading' ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Verbinde Chippy…
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <span>Jetzt kostenlos anrufen lassen</span>
                        <span>→</span>
                      </span>
                    )}
                  </button>
                  <p className="text-xs text-white/20 text-center">Einmaliger Demo-Anruf · Keine Kosten · Keine Weitergabe</p>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  const [open, setOpen] = React.useState<number | null>(null);
  const ref = React.useRef<HTMLElement>(null);
  const visible = useVisible(ref);

  return (
    <section ref={ref} id="faq" className="relative z-10 px-6 py-20 max-w-3xl mx-auto">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-3">Häufige Fragen</h2>
        <p className="text-white/50 text-base">Alles was du wissen musst — kurz und ehrlich.</p>
      </div>
      <div className="space-y-3">
        {FAQ_ITEMS.map((item, i) => (
          <div
            key={i}
            className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden transition-all duration-300"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? 'none' : 'translateY(20px)',
              transition: `opacity 0.5s ease ${i * 0.05}s, transform 0.5s ease ${i * 0.05}s, background 0.2s`,
              background: open === i ? 'rgba(249,115,22,0.05)' : undefined,
              borderColor: open === i ? 'rgba(249,115,22,0.2)' : undefined,
            }}
          >
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full flex items-center justify-between px-6 py-4 text-left group"
            >
              <span className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors pr-4">{item.q}</span>
              <span
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white/40 group-hover:text-white/60 transition-all duration-200"
                style={{ transform: open === i ? 'rotate(45deg)' : 'none' }}
              >
                +
              </span>
            </button>
            {open === i && (
              <div className="px-6 pb-5">
                <p className="text-sm text-white/55 leading-relaxed">{item.a}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

const PLANS = [
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
    badge: null,
  },
  {
    name: 'Starter',
    price: '49€',
    yearlyPrice: '39€',
    period: '/Monat',
    features: [
      '500 Min/Monat',
      '1 Agent',
      'Eigene Telefonnummer',
      'E-Mail-Benachrichtigungen',
      '+0,10€/Min bei Überschreitung',
    ],
    cta: 'Jetzt starten',
    highlight: false,
    badge: null,
  },
  {
    name: 'Pro',
    price: '149€',
    yearlyPrice: '119€',
    period: '/Monat',
    features: [
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
      '5.000 Min/Monat',
      '10 Agents',
      'White-Label',
      'Dedicated Support',
      '+0,06€/Min bei Überschreitung',
    ],
    cta: 'Kontakt aufnehmen',
    highlight: false,
    badge: null,
  },
];

// ── Savings Calculator ────────────────────────────────────────────────────

function SavingsCalculator({ onCTA }: { onCTA: () => void }) {
  const [anrufe, setAnrufe] = React.useState(20);
  const [dauer, setDauer] = React.useState(4);
  const [stundenlohn, setStundenlohn] = React.useState(20);
  const [nachbearbeitung, setNachbearbeitung] = React.useState(5);
  const [botQuote, setBotQuote] = React.useState(65);

  const gesamtMinProTag = anrufe * (dauer + nachbearbeitung);
  const botMinProTag = gesamtMinProTag * (botQuote / 100);
  const gesparteMinProMonat = botMinProTag * 22;
  const gesparteStunden = gesparteMinProMonat / 60;
  const gesparteKosten = gesparteStunden * stundenlohn;
  const phonbotKosten = anrufe <= 5 ? 0 : anrufe <= 20 ? 49 : anrufe <= 50 ? 149 : 299;
  const nettoErsparnis = gesparteKosten - phonbotKosten;
  const roi = phonbotKosten > 0 ? Math.round((nettoErsparnis / phonbotKosten) * 100) : 0;

  const sliders = [
    { label: 'Anrufe pro Tag', value: anrufe, set: setAnrufe, min: 1, max: 100, step: 1, display: `${anrufe}` },
    { label: 'Ø Anrufdauer', value: dauer, set: setDauer, min: 1, max: 15, step: 1, display: `${dauer} min` },
    { label: 'Stundenlohn MA', value: stundenlohn, set: setStundenlohn, min: 10, max: 80, step: 1, display: `${stundenlohn} €/h` },
    { label: 'Nachbearbeitung', value: nachbearbeitung, set: setNachbearbeitung, min: 0, max: 30, step: 1, display: `${nachbearbeitung} min` },
    { label: 'Bot löst alleine', value: botQuote, set: setBotQuote, min: 30, max: 90, step: 1, display: `${botQuote}%` },
  ];

  return (
    <section className="relative z-10 px-6 py-20 max-w-5xl mx-auto">
      <div className="text-center mb-12">
        <span className="inline-block text-xs font-semibold uppercase tracking-widest text-orange-400/80 mb-3 px-3 py-1 rounded-full border border-orange-500/20 bg-orange-500/5">Ehrlicher ROI-Rechner</span>
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-3">Was sparst du wirklich?</h2>
        <p className="text-white/45 text-base">Schieb die Regler — wir zeigen dir die echten Zahlen, auch wenn sie noch nicht passen.</p>
      </div>

      <div
        className="rounded-3xl overflow-hidden"
        style={{
          border: '1px solid rgba(249,115,22,0.2)',
          background: 'linear-gradient(135deg, rgba(15,15,28,0.95), rgba(10,10,20,0.95))',
          boxShadow: '0 0 80px rgba(249,115,22,0.08), 0 0 160px rgba(6,182,212,0.04)',
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-5">
          {/* LEFT — Sliders (3 cols) */}
          <div className="lg:col-span-3 p-8 space-y-5" style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-6">Deine Zahlen</p>
            {sliders.map((s) => {
              const pct = ((s.value - s.min) / (s.max - s.min)) * 100;
              return (
                <div key={s.label}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-white/60">{s.label}</span>
                    <span className="text-sm font-bold font-mono px-2 py-0.5 rounded-lg text-orange-400"
                      style={{ background: 'rgba(249,115,22,0.1)' }}>
                      {s.display}
                    </span>
                  </div>
                  <div className="relative">
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-150"
                        style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #F97316, #06B6D4)' }} />
                    </div>
                    <input
                      type="range" min={s.min} max={s.max} step={s.step} value={s.value}
                      onChange={(e) => s.set(Number(e.target.value))}
                      className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
                      style={{ margin: 0 }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* RIGHT — Results (2 cols) */}
          <div className="lg:col-span-2 p-8 flex flex-col justify-between">
            <div className="space-y-5">
              <p className="text-xs font-semibold text-white/30 uppercase tracking-widest">Dein Ergebnis</p>

              {/* Hours */}
              <div className="rounded-2xl p-4" style={{ background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.15)' }}>
                <p className="text-3xl font-extrabold bg-clip-text text-transparent leading-none mb-0.5"
                  style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
                  {gesparteStunden.toFixed(0)} Std
                </p>
                <p className="text-xs text-white/40 font-medium">gespart pro Monat</p>
              </div>

              {/* Cost */}
              <div className="rounded-2xl p-4 bg-white/[0.04]" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-2xl font-extrabold text-white leading-none mb-0.5">
                  {gesparteKosten.toLocaleString('de-DE', { maximumFractionDigits: 0 })} €
                </p>
                <p className="text-xs text-white/40 font-medium">Personalkosten gespart</p>
              </div>

              {/* Net / ROI */}
              <div className={`rounded-2xl p-4 ${nettoErsparnis > 0 ? '' : ''}`}
                style={{
                  background: nettoErsparnis > 0 ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)',
                  border: `1px solid ${nettoErsparnis > 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                }}>
                <div className="flex items-end justify-between">
                  <div>
                    <p className={`text-2xl font-extrabold leading-none mb-0.5 ${nettoErsparnis > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {nettoErsparnis > 0 ? '+' : ''}{nettoErsparnis.toLocaleString('de-DE', { maximumFractionDigits: 0 })} €
                    </p>
                    <p className="text-xs font-medium" style={{ color: nettoErsparnis > 0 ? 'rgba(134,239,172,0.7)' : 'rgba(252,165,165,0.7)' }}>
                      Netto nach Phonbot ({phonbotKosten} €/Mo)
                    </p>
                  </div>
                  {phonbotKosten > 0 && nettoErsparnis > 0 && (
                    <div className="text-right">
                      <p className="text-sm font-bold text-green-400">{roi}%</p>
                      <p className="text-[10px] text-white/30">ROI</p>
                    </div>
                  )}
                </div>
              </div>

              {nettoErsparnis <= 0 && (
                <p className="text-xs text-white/30 leading-relaxed">
                  Noch nicht rentabel? Mehr Anrufe pro Tag oder höhere Bot-Quote — dann klappt's.
                </p>
              )}
            </div>

            <button
              onClick={onCTA}
              className="mt-6 w-full rounded-xl px-6 py-3.5 font-bold text-white transition-all duration-300 hover:scale-[1.02]"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)', boxShadow: '0 0 24px rgba(249,115,22,0.3)' }}
            >
              Kostenlos testen →
            </button>
            <p className="text-[10px] text-white/20 text-center mt-2">100 Freiminuten · Keine Kreditkarte nötig</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Hooks ──────────────────────────────────────────────────────────────────

function useVisible(ref: React.RefObject<HTMLElement | null>) {
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

function useCountUp(target: number, duration: number, active: boolean) {
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

// ── Sub-components ─────────────────────────────────────────────────────────

function WaveformViz({ active }: { active: boolean }) {
  return (
    <div className={`waveform-container my-8 px-4 ${active ? 'waveform-active' : ''}`}>
      <svg viewBox="0 0 1200 80" preserveAspectRatio="none" className="w-full h-20">
        <path className="wave wave-1" d="M0,40 C150,10 300,70 450,40 C600,10 750,70 900,40 C1050,10 1200,70 1200,40" />
        <path className="wave wave-2" d="M0,40 C200,15 350,65 500,40 C650,15 800,65 950,40 C1100,15 1200,55 1200,40" />
        <path className="wave wave-3" d="M0,40 C100,20 250,60 400,40 C550,20 700,60 850,40 C1000,20 1150,60 1200,40" />
      </svg>
    </div>
  );
}

function StatsSection() {
  const ref = React.useRef<HTMLElement>(null);
  const visible = useVisible(ref);
  const calls = useCountUp(500, 1800, visible);
  const businesses = useCountUp(50, 1400, visible);

  return (
    <section ref={ref} className="relative z-10 border-t border-b border-white/5 py-16 px-6">
      <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-10 text-center">
        <div>
          <p
            className="text-5xl font-extrabold mb-2 bg-clip-text text-transparent"
            style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
          >
            {calls}+
          </p>
          <p className="text-white/55 text-sm font-medium">Anrufe beantwortet</p>
        </div>
        <div>
          <p
            className="text-5xl font-extrabold mb-2 bg-clip-text text-transparent"
            style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
          >
            {businesses}+
          </p>
          <p className="text-white/55 text-sm font-medium">Stunden gespart</p>
        </div>
        <div>
          <p
            className="text-5xl font-extrabold mb-2 bg-clip-text text-transparent"
            style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
          >
            &lt; 2 Min
          </p>
          <p className="text-white/55 text-sm font-medium">Setup-Zeit</p>
        </div>
      </div>
    </section>
  );
}

function HowSection() {
  const ref = React.useRef<HTMLElement>(null);
  const visible = useVisible(ref);
  return (
    <section ref={ref} id="how" className="relative z-10 px-6 py-20 max-w-5xl mx-auto">
      <div className="text-center mb-16">
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">So funktioniert's</h2>
      </div>
      <div className="relative flex flex-col md:flex-row items-start md:items-center gap-8 md:gap-0">
        <div
          className="hidden md:block absolute top-10 left-[calc(16.66%+1rem)] right-[calc(16.66%+1rem)] h-px"
          style={{ borderTop: '2px dashed rgba(249,115,22,0.3)' }}
          aria-hidden="true"
        />
        {STEPS.map((step, i) => (
          <div
            key={i}
            className="relative flex-1 flex flex-col items-center text-center px-4"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? 'none' : 'translateY(30px)',
              transition: `all 0.6s cubic-bezier(0.16,1,0.3,1) ${i * 0.18}s`,
            }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-extrabold text-white mb-5 relative z-10"
              style={{
                background: 'linear-gradient(135deg, #F97316, #06B6D4)',
                boxShadow: '0 0 24px rgba(249,115,22,0.4)',
              }}
            >
              {step.num}
            </div>
            <h3 className="font-bold text-lg mb-2">{step.title}</h3>
            <p className="text-white/55 text-sm leading-relaxed">{step.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Template Card ──────────────────────────────────────────────────────────

type TemplateCardProps = {
  template: { id: string; Icon: React.ComponentType<{ size?: number; className?: string }>; name: string; description: string };
  onClick: () => void;
};

function TemplateCard({ template, onClick }: TemplateCardProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="gradient-border group relative flex flex-col items-center gap-4 p-8 rounded-2xl glass
        hover:bg-white/10 hover:shadow-[0_0_40px_rgba(249,115,22,0.3)]
        hover:scale-[1.03] transition-all duration-300 text-center"
      style={{ zIndex: hovered ? 30 : 1 }}
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{
          background: 'linear-gradient(135deg, rgba(249,115,22,0.2), rgba(6,182,212,0.15))',
          border: '1px solid rgba(249,115,22,0.15)',
        }}
      >
        <template.Icon size={28} className="text-white/70 group-hover:text-orange-300 transition-colors" />
      </div>
      <div>
        <p className="font-bold text-base text-white mb-1 group-hover:text-orange-300 transition-colors">{template.name}</p>
        <p className="text-xs text-white/45 leading-snug">{template.description}</p>
      </div>

      {/* Speech bubble preview — below the card */}
      <div
        style={{
          opacity: hovered ? 1 : 0,
          position: 'absolute',
          bottom: '-3.5rem',
          left: '50%',
          transform: hovered ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(6px)',
          transition: 'all 0.25s ease',
          zIndex: 50,
          minWidth: '220px',
          pointerEvents: 'none',
        }}
      >
        <div className="glass-strong rounded-xl px-3 py-2 text-xs text-white/70 italic text-center relative">
          <div
            className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45"
            style={{
              background: 'rgba(255,255,255,0.08)',
              borderTop: '1px solid rgba(255,255,255,0.15)',
              borderLeft: '1px solid rgba(255,255,255,0.15)',
            }}
          />
          {TEMPLATE_PREVIEWS[template.id]}
        </div>
      </div>

      <span className="absolute bottom-4 right-4 text-xs text-orange-400/70 opacity-0 group-hover:opacity-100 transition-opacity duration-200 font-medium">
        ▶ Demo starten
      </span>
    </button>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

type Props = {
  onGoToRegister: () => void;
  onGoToLogin: () => void;
};

export function LandingPage({ onGoToRegister, onGoToLogin }: Props) {
  const [callState, setCallState] = useState<CallState>('idle');
  const [agentTalking, setAgentTalking] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yearly, setYearly] = useState(false);
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [legalPage, setLegalPage] = useState<'impressum' | 'datenschutz' | 'agb' | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const clientRef = useRef<RetellWebClient | null>(null);

  const PLANS_COMPUTED = PLANS.map((p) => ({
    ...p,
    displayPrice: yearly && p.yearlyPrice ? p.yearlyPrice : p.price,
  }));

  async function handleTemplateClick(templateId: string) {
    if (callState === 'active' || callState === 'connecting') return;
    setActiveTemplate(templateId);
    setCallState('connecting');
    setError(null);

    try {
      const res = await createDemoCall(templateId);
      if (!res.access_token) {
        throw new Error('Kein Zugriffstoken erhalten');
      }

      const client = new RetellWebClient();
      clientRef.current = client;

      client.on('call_started', () => setCallState('active'));
      client.on('call_ended', () => {
        setCallState('ended');
        setAgentTalking(false);
      });
      client.on('agent_start_talking', () => setAgentTalking(true));
      client.on('agent_stop_talking', () => setAgentTalking(false));
      client.on('error', (err: unknown) => {
        setError(String(err));
        setCallState('error');
        setAgentTalking(false);
      });

      await client.startCall({ accessToken: res.access_token });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(msg);
      setCallState('error');
    }
  }

  function stopCall() {
    clientRef.current?.stopCall();
    clientRef.current = null;
    setCallState('ended');
    setAgentTalking(false);
  }

  function resetCall() {
    setCallState('idle');
    setActiveTemplate(null);
    setError(null);
    setAgentTalking(false);
  }

  const isInCall = callState === 'connecting' || callState === 'active' || callState === 'ended' || callState === 'error';

  return (
    <div className="noise bg-[#0A0A0F] text-white relative">
      {/* Background glow orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
        <div
          className="glow-pulse absolute -top-40 -left-40 w-[700px] h-[700px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.18) 0%, transparent 70%)' }}
        />
        <div
          className="glow-pulse absolute top-1/2 -right-60 w-[600px] h-[600px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.12) 0%, transparent 70%)', animationDelay: '1.5s' }}
        />
        <div
          className="glow-pulse absolute -bottom-40 left-1/3 w-[500px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.10) 0%, transparent 70%)', animationDelay: '3s' }}
        />
      </div>

      {/* ── NAV ── */}
      <header className="relative z-20 border-b border-white/5 backdrop-blur-md bg-[#0A0A0F]/80 sticky top-0">
        <div className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
          {/* Logo */}
          <PhonbotBrand size="sm" />

          {/* Center nav links — hidden on mobile */}
          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-white/60 hover:text-white transition-colors duration-200">Features</a>
            <a href="#how" className="text-sm text-white/60 hover:text-white transition-colors duration-200">So funktioniert's</a>
            <a href="#demo" className="text-sm text-white/60 hover:text-white transition-colors duration-200">Demo</a>
            <a href="#preise" className="text-sm text-white/60 hover:text-white transition-colors duration-200">Preise</a>
            <a href="#faq" className="text-sm text-white/60 hover:text-white transition-colors duration-200">FAQ</a>
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-4">
            <button
              onClick={onGoToLogin}
              className="text-sm text-white/60 hover:text-white transition-colors duration-200 hidden sm:block"
            >
              Einloggen
            </button>
            <button
              onClick={onGoToRegister}
              className="text-sm font-semibold text-white rounded-full px-5 py-2.5 transition-all duration-300 hover:shadow-[0_0_24px_rgba(249,115,22,0.5)] hover:scale-105 hidden sm:block"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
            >
              Kostenlos testen
            </button>
            {/* Hamburger — mobile only */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden flex flex-col gap-1.5 p-2 rounded-lg hover:bg-white/5 transition-colors"
              aria-label="Menü öffnen"
            >
              <span className={`block w-5 h-0.5 bg-white/60 transition-all duration-200 ${mobileMenuOpen ? 'rotate-45 translate-y-2' : ''}`} />
              <span className={`block w-5 h-0.5 bg-white/60 transition-all duration-200 ${mobileMenuOpen ? 'opacity-0' : ''}`} />
              <span className={`block w-5 h-0.5 bg-white/60 transition-all duration-200 ${mobileMenuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-white/5 bg-[#0A0A0F]/95 backdrop-blur-md px-6 py-4 space-y-1">
            {[
              { href: '#features', label: 'Features' },
              { href: '#how', label: "So funktioniert's" },
              { href: '#demo', label: 'Demo' },
              { href: '#preise', label: 'Preise' },
              { href: '#faq', label: 'FAQ' },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className="block py-3 text-sm text-white/60 hover:text-white transition-colors border-b border-white/5 last:border-0"
              >
                {item.label}
              </a>
            ))}
            <div className="pt-3 flex flex-col gap-2">
              <button
                onClick={() => { setMobileMenuOpen(false); onGoToLogin(); }}
                className="w-full py-2.5 text-sm text-white/60 rounded-xl border border-white/10 hover:text-white hover:border-white/20 transition-colors"
              >
                Einloggen
              </button>
              <button
                onClick={() => { setMobileMenuOpen(false); onGoToRegister(); }}
                className="w-full py-2.5 text-sm font-semibold text-white rounded-xl"
                style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
              >
                Kostenlos testen
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ── HERO ── */}
      <section className="relative z-10 px-6 pt-16 pb-16 max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-center gap-10 md:gap-16">
          {/* Left: Text content */}
          <div className="flex-1 text-center md:text-left">
            {/* Social proof — ABOVE headline for immediate trust */}
            <div className="inline-flex items-center gap-2 mb-6">
              <span
                className="inline-flex items-center gap-2 text-sm font-medium text-white/80 rounded-full px-4 py-1.5 glass"
                style={{ boxShadow: '0 0 20px rgba(249,115,22,0.3), inset 0 0 20px rgba(249,115,22,0.05)' }}
              >
                <IconStar size={14} className="text-orange-400" />
                Über 500 Unternehmen vertrauen Phonbot
              </span>
            </div>

            {/* Headline */}
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold leading-[1.1] tracking-tight mb-6">
              Nie wieder einen
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: 'linear-gradient(135deg, #F97316 0%, #06B6D4 100%)' }}
              >
                Anruf verpassen.
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-white/55 text-lg sm:text-xl max-w-2xl mb-10 leading-relaxed">
              KI-Assistent der Anrufe beantwortet, Termine bucht —{' '}
              <span className="text-white/80 font-medium">rund um die Uhr.</span>
            </p>

            {/* CTA buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center md:justify-start gap-4">
              <button
                onClick={onGoToRegister}
                className="w-full sm:w-auto text-base font-semibold text-white rounded-full px-8 py-4 transition-all duration-300 hover:shadow-[0_0_40px_rgba(249,115,22,0.5)] hover:scale-105"
                style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
              >
                Kostenlos testen
              </button>
              <button
                onClick={() => setShowDemoModal(true)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 text-base font-semibold text-white/90 rounded-full px-8 py-4 transition-all duration-300 text-center hover:text-white hover:scale-105"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(12px)' }}
              >
                <IconPlay size={18} className="opacity-70" />
                Demo anhören
              </button>
            </div>
            {/* Trust line — subtle, no "Keine Kreditkarte" badge */}
            <p className="text-xs text-white/40 mt-4">✓ Kostenlos · ✓ Sofort einsatzbereit · ✓ DSGVO-konform</p>
          </div>

          {/* Right: Chippy mascot — clickable, opens demo modal */}
          <div className="flex-shrink-0 flex flex-col items-center">
            <div className="relative group cursor-pointer" onClick={() => setShowDemoModal(true)}>
              {/* Glow ring */}
              <div
                className="glow-pulse w-56 h-56 sm:w-64 sm:h-64 rounded-full flex items-center justify-center"
                style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.12) 0%, rgba(6,182,212,0.06) 60%, transparent 100%)' }}
              >
                <FoxLogo size="xl" glow animate className="group-hover:scale-110 transition-transform duration-300" />
              </div>

              {/* Floating speech bubble — always visible, bouncy on hover */}
              <div
                className="absolute -top-6 -right-2 glass rounded-2xl px-3 py-2 text-xs text-white/70 italic group-hover:scale-105 transition-transform"
                style={{ border: '1px solid rgba(255,255,255,0.12)', maxWidth: '160px' }}
              >
                „Hallo! Wie kann ich helfen?" 📞
              </div>

              {/* Click hint */}
              <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap">
                <span className="text-xs text-orange-400/70 font-medium flex items-center gap-1 group-hover:text-orange-400 transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 breathe inline-block" />
                  Klick für Live-Demo
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUST BAR ── */}
      <section className="relative z-10 px-6 py-6 max-w-4xl mx-auto">
        <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
          <div className="flex items-center gap-2 text-sm text-white/60">
            <IconBolt size={14} className="text-white/50" />
            <span>In 2 Minuten live</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-white/60">
            <span>Server in Deutschland</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-white/60">
            <IconPhone size={14} className="text-white/50" />
            <span>Eigene Telefonnummer inklusive</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-white/60">
            <IconStar size={14} className="text-orange-400/70" />
            <span>4.9/5 Bewertung</span>
          </div>
        </div>
      </section>

      {/* ── WAVEFORM VIZ (between hero and demo) ── */}
      <WaveformViz active={callState === 'active' && agentTalking} />

      {/* ── DEMO SECTION ── */}
      <section id="demo" className="relative z-10 px-6 py-20 max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4 flex-wrap">
            <h2 className="text-3xl sm:text-4xl font-extrabold">
              Hör <span style={{ color: '#F97316' }}>Chippy</span> zu — wähle dein Business
            </h2>
            <span className="inline-flex items-center gap-1 text-xs font-bold text-white bg-red-500/20 border border-red-500/30 rounded-full px-3 py-1">
              <span className="breathe inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />
              LIVE
            </span>
          </div>
          <p className="text-white/60 text-lg max-w-xl mx-auto">
            Kein Account nötig. Einfach klicken, sprechen, überzeugen lassen.
          </p>
        </div>

        {/* Template grid — shown when idle or error */}
        {!isInCall && (
          <div style={{ overflow: 'visible' }}>
            {/* How it works inline hint */}
            <div className="flex items-center justify-center gap-6 mb-8 flex-wrap">
              {[
                { step: '1', label: 'Business klicken' },
                { step: '2', label: 'Mikrofon erlauben' },
                { step: '3', label: 'Chippy live hören' },
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-white/50">
                  <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/70">{s.step}</span>
                  {s.label}
                  {i < 2 && <span className="text-white/20 ml-2">→</span>}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-x-4 gap-y-16 pb-10" style={{ overflow: 'visible' }}>
              {TEMPLATES.map((t) => (
                <TemplateCard key={t.id} template={t} onClick={() => handleTemplateClick(t.id)} />
              ))}
            </div>
            {/* Reassurance */}
            <p className="text-center text-xs text-white/35 mt-2">
              🔒 Kein Account, kein Risiko — einfach ausprobieren
            </p>
            {/* Mic hint */}
            <p className="text-center text-xs text-white/30 mt-2 italic">
              Dein Mikrofon wird benötigt — das Gespräch dauert ca. 30 Sekunden.
            </p>
          </div>
        )}

        {/* Call state card */}
        {isInCall && (
          <div className="fade-up flex justify-center">
            <div
              className="glass-strong rounded-3xl p-10 max-w-md w-full text-center"
              style={{ boxShadow: '0 0 60px rgba(249,115,22,0.15), 0 0 120px rgba(6,182,212,0.08)' }}
            >
              {/* Connecting */}
              {callState === 'connecting' && (
                <>
                  <div className="flex items-center justify-center gap-3 mb-4 text-orange-300">
                    <span className="w-6 h-6 rounded-full border-2 border-orange-400 border-t-transparent spin inline-block" />
                    <span className="font-medium">Verbinde…</span>
                  </div>
                  <p className="text-white/50 text-sm">
                    Starte {TEMPLATES.find((t) => t.id === activeTemplate)?.name}-Agent
                  </p>
                </>
              )}

              {/* Active */}
              {callState === 'active' && (
                <>
                  <div className={`relative mx-auto mb-6 ${agentTalking ? 'mic-pulse' : ''}`}>
                    {agentTalking && (
                      <>
                        <div className="sound-ring" />
                        <div className="sound-ring" />
                        <div className="sound-ring" />
                      </>
                    )}
                    <FoxLogo size="xl" glow animate={agentTalking} />
                  </div>
                  <div className="flex items-center justify-center gap-2 mb-6">
                    {agentTalking ? (
                      <>
                        <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 breathe inline-block" />
                        <span className="text-cyan-300 text-sm font-medium">Agent spricht…</span>
                      </>
                    ) : (
                      <>
                        <span className="w-2.5 h-2.5 rounded-full bg-orange-400 breathe inline-block" />
                        <span className="text-orange-300 text-sm font-medium">Warte auf dich…</span>
                      </>
                    )}
                  </div>
                  <button
                    onClick={stopCall}
                    className="flex items-center justify-center gap-2 mx-auto rounded-full bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 px-8 py-3 text-red-300 text-sm font-medium transition-all duration-200 hover:scale-105"
                  >
                    <IconPhone size={16} className="opacity-70" />
                    Auflegen
                  </button>
                </>
              )}

              {/* Ended */}
              {callState === 'ended' && (
                <>
                  <FoxLogo size="xl" glow className="mx-auto mb-4" />
                  <h3 className="text-2xl font-bold mb-2">Wie war dein Agent?</h3>
                  <p className="text-white/60 text-sm mb-8">
                    Erstelle jetzt deinen eigenen, personalisierten Agenten — in unter 2 Minuten.
                  </p>
                  <button
                    onClick={onGoToRegister}
                    className="w-full rounded-xl px-6 py-3.5 font-semibold text-white transition-all duration-300 hover:shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:scale-[1.02]"
                    style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
                  >
                    Jetzt eigenen Agenten erstellen →
                  </button>
                  <button
                    onClick={resetCall}
                    className="mt-4 text-sm text-white/40 hover:text-white/60 transition-colors"
                  >
                    Nochmal testen
                  </button>
                </>
              )}

              {/* Error */}
              {callState === 'error' && error && (
                <>
                  <div className="text-4xl mb-4 flex justify-center">
                    <span className="text-amber-400/80 text-4xl font-bold">
                      {error.includes('429') || error.toLowerCase().includes('rate limit') || error.toLowerCase().includes('too many requests')
                        ? '!' : '×'}
                    </span>
                  </div>
                  {error.includes('429') || error.toLowerCase().includes('rate limit') || error.toLowerCase().includes('too many requests') ? (
                    <>
                      <p className="text-amber-300 text-sm font-medium mb-2">
                        Du hast die Demo-Grenze erreicht (3 Anrufe/Stunde).
                      </p>
                      <p className="text-white/50 text-sm mb-6">
                        Melde dich an um unbegrenzt zu testen!
                      </p>
                      <button
                        onClick={onGoToRegister}
                        className="w-full rounded-xl px-6 py-3 font-semibold text-white text-sm mb-3 transition-all duration-200 hover:opacity-90"
                        style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
                      >
                        Jetzt anmelden →
                      </button>
                      <button
                        onClick={resetCall}
                        className="text-sm text-white/40 hover:text-white/60 underline transition-colors"
                      >
                        Zurück zu den Templates
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-red-300 text-sm mb-6">{error}</p>
                      <button
                        onClick={resetCall}
                        className="text-sm text-white/50 hover:text-white underline transition-colors"
                      >
                        Zurück zu den Templates
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── HOW IT WORKS (scroll-triggered) ── */}
      <HowSection />

      {/* ── FEATURES ── */}
      <section id="features" className="relative z-10 px-6 py-24 max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-extrabold mb-3">Was Phonbot für dich erledigt</h2>
          <p className="text-white/50 text-base max-w-lg mx-auto">Sechs Gründe warum du nie wieder einen Anruf verpasst.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="group relative rounded-2xl p-6 border border-white/[0.06] bg-white/[0.02]
                hover:border-orange-500/30 hover:bg-white/[0.04]
                transition-all duration-300"
              style={{
                animationDelay: `${i * 80}ms`,
              }}
            >
              {/* Icon */}
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4
                bg-gradient-to-br from-orange-500/15 to-cyan-500/10 border border-orange-500/20
                group-hover:border-orange-500/40 group-hover:shadow-[0_0_16px_rgba(249,115,22,0.15)]
                transition-all duration-300">
                <f.Icon size={20} className="text-orange-400/80 group-hover:text-orange-300 transition-colors" />
              </div>
              {/* Text */}
              <h3 className="font-semibold text-[15px] text-white mb-1.5 group-hover:text-orange-50 transition-colors">{f.title}</h3>
              <p className="text-white/45 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── SAVINGS CALCULATOR ── */}
      <SavingsCalculator onCTA={onGoToRegister} />

      {/* ── STATS (count-up) ── */}
      <StatsSection />

      {/* ── FAQ ── */}
      <FaqSection />

      {/* ── PRICING ── */}
      <section id="preise" className="relative z-10 px-6 py-20 max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">Einfache Preise. Starte kostenlos.</h2>
        </div>

        {/* Billing toggle */}
        <div className="flex items-center justify-center gap-4 mb-10">
          <span className={`text-sm font-medium ${!yearly ? 'text-white' : 'text-white/40'}`}>Monatlich</span>
          <button
            onClick={() => setYearly(!yearly)}
            className="relative w-14 h-7 rounded-full transition-all duration-300"
            style={{ background: yearly ? 'linear-gradient(135deg, #F97316, #06B6D4)' : 'rgba(255,255,255,0.1)' }}
          >
            <span
              className="absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-all duration-300"
              style={{ transform: yearly ? 'translateX(28px)' : 'translateX(0)' }}
            />
          </button>
          <span className={`text-sm font-medium ${yearly ? 'text-white' : 'text-white/40'}`}>
            Jährlich <span className="text-green-400 text-xs font-bold">-20%</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto items-start">
          {PLANS_COMPUTED.map((plan) => (
            <div
              key={plan.name}
              className={`gradient-border relative glass rounded-2xl p-8 flex flex-col transition-all duration-300 hover:shadow-[0_0_40px_rgba(249,115,22,0.25)] hover:scale-[1.02] ${plan.highlight ? 'scale-[1.02]' : ''}`}
              style={
                plan.highlight
                  ? {
                      border: '1px solid rgba(249,115,22,0.6)',
                      background: 'linear-gradient(160deg, rgba(249,115,22,0.14) 0%, rgba(6,182,212,0.10) 100%)',
                      boxShadow: '0 0 0 3px rgba(249,115,22,0.25), 0 0 60px rgba(249,115,22,0.20), 0 0 120px rgba(6,182,212,0.08)',
                    }
                  : {}
              }
            >
              {plan.badge && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold text-white rounded-full px-3 py-1"
                  style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
                >
                  {plan.badge}
                </div>
              )}
              <div className="mb-6">
                <p className="text-white/60 text-sm font-medium mb-2">{plan.name}</p>
                <div className="flex items-end gap-1">
                  <span className="text-5xl font-extrabold transition-all duration-300">{plan.displayPrice}</span>
                  <span className="text-white/50 text-sm mb-1">{plan.period}</span>
                </div>
                {plan.name === 'Free' && (
                  <p className="text-xs text-green-400/70 mt-1 font-medium">Für immer kostenlos</p>
                )}
              </div>

              <ul className="flex-1 space-y-3 mb-8">
                {plan.features.map((feat) => (
                  <li key={feat} className="flex items-center gap-2 text-sm text-white/70">
                    <span
                      className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
                    >
                      ✓
                    </span>
                    {feat}
                  </li>
                ))}
              </ul>

              <button
                onClick={onGoToRegister}
                className="w-full rounded-xl px-6 py-3 font-semibold text-sm transition-all duration-300 hover:scale-[1.02]"
                style={
                  plan.highlight
                    ? { background: 'linear-gradient(135deg, #F97316, #06B6D4)', color: '#fff' }
                    : { background: 'rgba(255,255,255,0.07)', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }
                }
              >
                {plan.cta}
              </button>
              
            </div>
          ))}
        </div>
      </section>

      {/* ── RÜCKRUF-FORMULAR ── */}
      <CallbackSection />

      {/* ── FINAL CTA ── */}
      <section className="relative z-10 px-6 py-24 text-center max-w-2xl mx-auto">
        <h2 className="text-4xl sm:text-5xl font-extrabold mb-6 leading-tight">
          Dein Telefon. Jetzt intelligent.
        </h2>
        <p className="text-white/55 text-lg mb-8">
          Kostenlos starten — kein Abo, keine Bindung.
        </p>
        <button
          onClick={onGoToRegister}
          className="text-lg font-semibold text-white rounded-full px-10 py-5 transition-all duration-300 hover:shadow-[0_0_50px_rgba(249,115,22,0.6)] hover:scale-105"
          style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
        >
          Kostenlos testen
        </button>
      </section>

      {/* ── FOOTER ── */}
      <footer className="relative z-10 border-t border-white/5 px-6 py-12">
        <div className="max-w-6xl mx-auto">
          {/* Top row: brand + link columns */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-8 mb-10">
            {/* Brand */}
            <div className="sm:col-span-1">
              <PhonbotBrand size="sm" />
              <p className="text-xs text-white/35 mt-2 leading-relaxed">Dein KI-Telefonassistent.<br />Immer erreichbar.</p>
            </div>

            {/* Produkt */}
            <div>
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-3">Produkt</h4>
              <ul className="space-y-2">
                <li><a href="#features" className="text-sm text-white/40 hover:text-white/70 transition-colors">Features</a></li>
                <li><a href="#demo" className="text-sm text-white/40 hover:text-white/70 transition-colors">Demo</a></li>
                <li><a href="#preise" className="text-sm text-white/40 hover:text-white/70 transition-colors">Preise</a></li>
              </ul>
            </div>

            {/* Rechtliches */}
            <div>
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-3">Rechtliches</h4>
              <ul className="space-y-2">
                <li><button onClick={() => setLegalPage('datenschutz')} className="text-sm text-white/40 hover:text-white/70 transition-colors">Datenschutz</button></li>
                <li><button onClick={() => setLegalPage('impressum')} className="text-sm text-white/40 hover:text-white/70 transition-colors">Impressum</button></li>
                <li><button onClick={() => setLegalPage('agb')} className="text-sm text-white/40 hover:text-white/70 transition-colors">AGB</button></li>
              </ul>
            </div>

            {/* Social */}
            <div>
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-3">Social</h4>
              <a
                href="#"
                aria-label="GitHub"
                className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
                GitHub
              </a>
            </div>
          </div>

          {/* Bottom row: copyright + DSGVO */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/5 pt-6">
            <p className="text-xs text-white/30">© 2026 Phonbot · Alle Rechte vorbehalten</p>
            <p className="text-xs text-white/30">DSGVO-konform · Server in Deutschland</p>
          </div>
        </div>
      </footer>

      {/* ── CHIPPY DEMO MODAL ── */}
      {showDemoModal && (
        <OwlyDemoModal onClose={() => setShowDemoModal(false)} onGoToRegister={onGoToRegister} />
      )}

      {/* ── LEGAL MODAL ── */}
      {legalPage && (
        <LegalModal page={legalPage} onClose={() => setLegalPage(null)} />
      )}

      {/* ── COOKIE BANNER ── */}
      <CookieBanner />

    </div>
  );
}
