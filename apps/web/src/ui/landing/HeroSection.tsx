import React from 'react';
import { FoxLogo } from '../FoxLogo.js';
import { IconBolt, IconPhone, IconStar, IconPlay } from '../PhonbotIcons.js';

type HeroSectionProps = {
  onGoToRegister: () => void;
  onShowDemoModal: () => void;
};

export function HeroSection({ onGoToRegister, onShowDemoModal }: HeroSectionProps) {
  return (
    <>
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
                Dein KI-Telefonassistent
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
              <span className="bg-clip-text text-transparent font-semibold" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>Chipy</span> beantwortet Anrufe, bucht Termine und{' '}
              <span className="text-white/80 font-medium">lernt mit jedem Gespräch dazu.</span>
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
                onClick={onShowDemoModal}
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

          {/* Right: Chipy mascot — clickable, opens demo modal */}
          <div className="flex-shrink-0 flex flex-col items-center">
            <div className="relative group cursor-pointer" onClick={onShowDemoModal}>
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
                „Hi, ich bin Chipy! Wie kann ich dir heute helfen?" 📞
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
            <span>Eigene Telefonnummer</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-white/60">
            <IconStar size={14} className="text-orange-400/70" />
            <span>Keine Bindung</span>
          </div>
        </div>
      </section>
    </>
  );
}
