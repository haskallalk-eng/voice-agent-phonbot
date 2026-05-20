import React from 'react';
import { FoxLogo } from '../FoxLogo.js';
import { IconPhone, IconPrivacy } from '../PhonbotIcons.js';
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

function TemplateCard({ template }: TemplateCardProps) {
  return (
    <div
      className="gradient-border group relative flex h-full w-full max-w-sm flex-col items-center gap-4 rounded-2xl p-8 text-center glass
        transition-all duration-300 hover:scale-[1.03] hover:bg-white/10 hover:shadow-[0_0_40px_rgba(249,115,22,0.3)]"
    >
      <a
        href={`/${template.slug}/`}
        className="absolute inset-0 z-10 rounded-2xl"
        aria-label={`Mehr über Phonbot für ${template.name}`}
      />

      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{
          background: 'linear-gradient(135deg, rgba(249,115,22,0.2), rgba(6,182,212,0.15))',
          border: '1px solid rgba(249,115,22,0.15)',
        }}
      >
        <template.Icon size={28} className="text-white/70 transition-colors group-hover:text-orange-300" />
      </div>

      <div>
        <p className="mb-1 text-base font-bold text-white transition-colors group-hover:text-orange-300">{template.name}</p>
        <p className="text-xs leading-snug text-white/45">{template.description}</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs italic text-white/55">
        {TEMPLATE_PREVIEWS[template.id]}
      </div>

      <a
        href={DEMO_PHONE_HREF}
        onClick={(e) => e.stopPropagation()}
        className="relative z-20 mt-1 inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/10 px-4 py-2 text-xs font-semibold text-orange-200 transition-all hover:bg-orange-500/20 hover:text-white"
      >
        <IconPhone size={14} className="opacity-80" />
        Telefon-Demo anrufen
      </a>
    </div>
  );
}

export function DemoSection({ onGoToRegister }: DemoSectionProps) {
  return (
    <section id="demo" className="relative z-10 mx-auto max-w-6xl px-6 py-20 ambient-glow-alt ambient-glow">
      <div className="mb-12 text-center">
        <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
          <h2 className="text-3xl font-extrabold sm:text-4xl">
            Hör <span style={{ color: '#F97316' }}>Chipy</span> live am Telefon
          </h2>
          <span className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/20 px-3 py-1 text-xs font-bold text-white">
            <span className="breathe inline-block h-2 w-2 rounded-full bg-red-500" />
            LIVE
          </span>
        </div>
        <p className="mx-auto max-w-2xl text-lg text-white/60">
          Die Demo läuft jetzt wie ein echter Kundenanruf: Du rufst direkt mit deiner Nummer an
          oder lässt dich zurückrufen. So funktionieren Rufnummer, Unterbrechungen, SMS und
          Terminlink so realistisch wie in einem normalen Kundenanruf.
        </p>
      </div>

      <div className="mx-auto mb-12 grid max-w-5xl gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <div
          className="rounded-3xl border border-white/10 bg-white/[0.05] p-7"
          style={{ boxShadow: '0 0 60px rgba(249,115,22,0.12), 0 0 110px rgba(6,182,212,0.06)' }}
        >
          <div className="mb-5 flex items-center gap-4">
            <FoxLogo size="lg" glow animate />
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-300/80">Direkt anrufen</p>
              <h3 className="text-2xl font-bold text-white">Sprich sofort mit Chipy</h3>
            </div>
          </div>

          <a
            href={DEMO_PHONE_HREF}
            className="mb-4 flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 text-lg font-bold text-white transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_0_35px_rgba(249,115,22,0.38)]"
            style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
          >
            <IconPhone size={22} className="opacity-85" />
            {DEMO_PHONE_LABEL}
          </a>

          <p className="text-sm leading-relaxed text-white/55">
            Am Handy antippen, anrufen, lossprechen. Chipy erkennt, dass es eine Demo ist,
            beantwortet Phonbot-Fragen und simuliert Branchenabläufe wie Terminbuchung oder Weiterleitung.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-7">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200/75">Rückruf</p>
          <h3 className="mb-3 text-2xl font-bold text-white">Lieber angerufen werden?</h3>
          <p className="mb-5 text-sm leading-relaxed text-white/55">
            Trag dich unten beim Rückruf ein. Dann ruft Chipy dich auf deiner echten Nummer an,
            mit normalem Telefon-Audio und realistischer Rufnummer-Erkennung.
          </p>
          <a
            href="#callback"
            className="inline-flex w-full items-center justify-center rounded-2xl border border-white/12 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white/85 transition-all hover:bg-white/[0.1] hover:text-white"
          >
            Rückruf-Formular öffnen
          </a>
        </div>
      </div>

      <div className="mb-8 flex flex-wrap items-center justify-center gap-6">
        {[
          { step: '1', label: 'Nummer antippen' },
          { step: '2', label: 'Vom Handy sprechen' },
          { step: '3', label: 'Demo wie echter Anruf' },
        ].map((item, index) => (
          <div key={item.step} className="flex items-center gap-2 text-sm text-white/50">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white/70">
              {item.step}
            </span>
            {item.label}
            {index < 2 && <span className="ml-2 text-white/20">/</span>}
          </div>
        ))}
      </div>

      <div className="grid w-full grid-cols-1 justify-items-center gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((template) => (
          <TemplateCard key={template.id} template={template} />
        ))}
      </div>

      <div className="mt-10 text-center">
        <p className="mb-4 inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/40">
          <IconPrivacy size={14} className="text-orange-300" />
          Datenschutz-Hinweise laufen im Telefon-Demo-Flow bzw. im Rückruf-Formular.
        </p>
        <div>
          <button
            type="button"
            onClick={onGoToRegister}
            className="rounded-full px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:scale-105"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            Eigenen Agent erstellen
          </button>
        </div>
      </div>
    </section>
  );
}
