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
  TEMPLATES,
  TEMPLATE_PREVIEWS,
} from './shared.js';

type DemoSectionProps = {
  onGoToRegister: () => void;
};

type TemplateCardProps = {
  template: (typeof TEMPLATES)[number];
};

function CrystalDemoMark() {
  return (
    <div className="flex h-16 w-16 items-center justify-center" aria-hidden="true">
      <img className="brand-asset-mark" src="/brand/phonbot-crystal-phone.png" alt="" />
    </div>
  );
}

function TemplateCard({ template }: TemplateCardProps) {
  return (
    <div
      className="group relative flex h-full w-full flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-left
        transition-all duration-300 hover:-translate-y-1 hover:border-orange-400/35 hover:bg-white/[0.065] hover:shadow-[0_0_34px_rgba(249,115,22,0.18)]"
    >
      <a
        href={`/${template.slug}/`}
        className="absolute inset-0 z-10 rounded-2xl"
        aria-label={`Mehr ueber Phonbot fuer ${template.name}`}
      />

      <div
        className="flex h-12 w-12 items-center justify-center rounded-2xl"
        style={{
          background: 'linear-gradient(135deg, rgba(249,115,22,0.2), rgba(6,182,212,0.15))',
          border: '1px solid rgba(249,115,22,0.15)',
        }}
      >
        <template.Icon size={23} className="text-white/70 transition-colors group-hover:text-orange-300" />
      </div>

      <div>
        <p className="mb-1 text-base font-bold text-white transition-colors group-hover:text-orange-300">{template.name}</p>
        <p className="text-xs leading-snug text-white/45">{template.description}</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs italic leading-relaxed text-white/55">
        {TEMPLATE_PREVIEWS[template.id]}
      </div>

      <a
        href={DEMO_PHONE_HREF}
        onClick={(e) => e.stopPropagation()}
        className="relative z-20 mt-auto inline-flex items-center justify-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/10 px-4 py-2 text-xs font-semibold text-orange-200 transition-all hover:bg-orange-500/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-orange-400/50"
      >
        <IconPhone size={14} className="opacity-80" />
        Telefon-Demo anrufen
      </a>
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
            Ein echter Telefonanruf statt Web-Spielerei: Phonbot beantwortet Phonbot-Fragen,
            simuliert Branchenablaeufe und reagiert auf Unterbrechungen wie im Kundencall.
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
                'Starte eine Branchen-Simulation wie Friseur, Handwerk oder Restaurant.',
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
              Lieber Rueckruf starten
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

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((template) => (
          <TemplateCard key={template.id} template={template} />
        ))}
      </div>

      <div className="mt-10 text-center">
        <p className="mb-4 inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/40">
          <IconPrivacy size={14} className="text-orange-300" />
          Datenschutz-Hinweise laufen im Telefon-Demo-Flow bzw. im Rueckruf-Formular.
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
