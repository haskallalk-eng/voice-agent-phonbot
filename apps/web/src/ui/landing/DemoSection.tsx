import React from 'react';
import {
  IconBolt,
  IconCheckCircle,
  IconPhone,
  IconPhoneForward,
  IconPrivacy,
} from '../PhonbotIcons.js';
import {
  DEMO_PHONE_HREF,
  DEMO_PHONE_LABEL,
} from './shared.js';

type DemoSectionProps = {
  onGoToRegister: () => void;
};

function CrystalDemoMark() {
  return (
    <div className="crystal-demo-mark" aria-hidden="true">
      <img src="/brand/phonbot-crystal-icon-cropped.png" alt="" className="h-12 w-12 object-contain" />
    </div>
  );
}

export function DemoSection({ onGoToRegister }: DemoSectionProps) {
  const trustItems = [
    { Icon: IconCheckCircle, label: 'meldet sich als Phonbot' },
    { Icon: IconBolt, label: 'kurzer Demo-Prompt' },
    { Icon: IconPrivacy, label: 'Datenschutz im Flow' },
  ];

  return (
    <section id="demo" className="relative z-10 mx-auto max-w-6xl px-6 py-20 ambient-glow-alt ambient-glow">
      <div className="mb-10 flex flex-col gap-5 text-center">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-orange-400/30 bg-orange-500/12 px-3 py-1 text-xs font-bold text-orange-100">
            <span className="breathe inline-block h-2 w-2 rounded-full bg-orange-400 shadow-[0_0_14px_rgba(249,115,22,0.75)]" />
            Live-Telefon
          </span>
          <span className="rounded-full border border-cyan-400/20 bg-cyan-400/8 px-3 py-1 text-xs font-semibold text-cyan-100/80">
            neue Demo-Leitung
          </span>
        </div>

        <div>
          <h2 className="text-3xl font-extrabold leading-tight sm:text-5xl">
            Ruf{' '}
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
              Phonbot
            </span>{' '}
            direkt an
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-white/58 sm:text-lg">
            Ein echter Telefonanruf statt Web-Spielerei: Phonbot beantwortet Fragen,
            simuliert die Salon-Terminbuchung und reagiert auf Unterbrechungen wie im Kundencall.
          </p>
        </div>
      </div>

      <div className="mx-auto mb-12 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.035] shadow-[0_0_90px_rgba(249,115,22,0.10)]">
        <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
          <div
            className="relative p-6 sm:p-8 lg:p-10"
            style={{
              background: 'radial-gradient(ellipse at 18% 12%, rgba(249,115,22,0.16), transparent 34%), radial-gradient(ellipse at 85% 88%, rgba(6,182,212,0.13), transparent 32%)',
            }}
          >
            <div className="mb-7 flex items-center gap-4">
              <div className="relative">
                <CrystalDemoMark />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-300/80">Direkt anrufen</p>
                <h3 className="text-2xl font-bold text-white sm:text-3xl">Sprich sofort mit der echten Demo</h3>
              </div>
            </div>

            <a
              href={DEMO_PHONE_HREF}
              className="crystal-button mb-5 flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-5 text-xl font-extrabold text-white transition-all duration-300 hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-orange-400/60 sm:text-2xl"
            >
              <IconPhone size={22} className="opacity-85" />
              {DEMO_PHONE_LABEL}
            </a>

            <div className="grid gap-3 sm:grid-cols-3">
              {trustItems.map(({ Icon, label }) => (
                <div key={label} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs font-medium text-white/58">
                  <Icon size={15} className="shrink-0 text-orange-300" />
                  {label}
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-white/10 p-6 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200/75">Was du testen kannst</p>
            <div className="mb-6 space-y-3">
              {[
                'Frage frei nach Phonbot, Preisen, Einrichtung oder Datenschutz.',
                'Unterbrich Phonbot mit "stopp", "nein" oder einer Korrektur.',
                'Buche einen Salon-Termin wie ein Kunde — mit Wunschtermin und Leistung.',
              ].map((text) => (
                <div key={text} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-sm leading-relaxed text-white/60">
                  <IconCheckCircle size={16} className="mt-0.5 shrink-0 text-cyan-200/80" />
                  <span>{text}</span>
                </div>
              ))}
            </div>

            <a
              href="#callback"
              className="crystal-button crystal-button-secondary inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold text-white/85 transition-all hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/45"
            >
              <IconPhoneForward size={17} className="text-cyan-200/80" />
              Lieber Rückruf starten
            </a>
          </div>
        </div>
      </div>

      <div className="mb-8 flex flex-wrap items-center justify-center gap-3">
        {[
          { step: '1', label: 'Nummer antippen' },
          { step: '2', label: 'Vom Handy sprechen' },
          { step: '3', label: 'Demo wie echter Anruf' },
        ].map((item) => (
          <div key={item.step} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.025] px-3 py-2 text-sm text-white/50">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white/70">
              {item.step}
            </span>
            {item.label}
          </div>
        ))}
      </div>

      {/* Die frühere Branchen-Karten-Galerie ist raus — es gibt genau eine
          Branche (Friseur), und die präsentiert die Telefon-Demo oben. */}
      <div className="mt-10 text-center">
        <p className="mb-4 inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/40">
          <IconPrivacy size={14} className="text-orange-300" />
          Datenschutz-Hinweise laufen im Telefon-Demo-Flow bzw. im Rückruf-Formular.
        </p>
        <div>
          <button
            type="button"
            onClick={onGoToRegister}
            className="crystal-button crystal-button-secondary rounded-full px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-orange-400/50"
          >
            Eigenen Agent erstellen
          </button>
        </div>
      </div>
    </section>
  );
}
