import React, { useEffect, useState } from 'react';
import { IconBolt, IconPhone, IconStar } from '../PhonbotIcons.js';
import { STEPS } from './shared.js';

type HeroSectionProps = {
  onGoToRegister: () => void;
  onShowDemoModal: () => void;
};

export function HeroSection({ onGoToRegister, onShowDemoModal }: HeroSectionProps) {
  const [crystalSettled, setCrystalSettled] = useState(false);

  useEffect(() => {
    const fallback = window.setTimeout(() => setCrystalSettled(true), 3600);
    return () => window.clearTimeout(fallback);
  }, []);

  return (
    <>
      {/* Hero */}
      <section className="relative z-10 px-4 sm:px-6 pt-16 pb-12 max-w-7xl mx-auto">
        <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-black/35 px-4 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-12 shadow-[0_40px_160px_rgba(0,0,0,0.45)]">
          <div className="pointer-events-none absolute -inset-24 bg-[radial-gradient(circle_at_18%_18%,rgba(249,115,22,0.20),transparent_28%),radial-gradient(circle_at_82%_22%,rgba(6,182,212,0.18),transparent_30%),radial-gradient(circle_at_50%_88%,rgba(249,115,22,0.10),transparent_36%)] blur-2xl" />

          <div className="relative z-10 text-center">
            <div className="inline-flex items-center gap-2 mb-6">
              <span
                className="inline-flex items-center gap-2 text-sm font-medium text-white/80 rounded-full px-4 py-1.5 glass"
                style={{ boxShadow: '0 0 20px rgba(249,115,22,0.3), inset 0 0 20px rgba(249,115,22,0.05)' }}
              >
                <IconStar size={14} className="text-orange-400" />
                Dein KI-Telefonassistent
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold leading-[1.05] tracking-tight mb-6 max-w-4xl mx-auto">
              Nie wieder einen{' '}
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: 'linear-gradient(135deg, #F97316 0%, #06B6D4 100%)' }}
              >
                Anruf verpassen.
              </span>
            </h1>

            <p className="text-white/55 text-lg sm:text-xl max-w-3xl mx-auto mb-8 leading-relaxed">
              <span className="bg-clip-text text-transparent font-semibold" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>Chipy</span> beantwortet Anrufe, bucht Termine und{' '}
              <span className="text-white/80 font-medium">lernt mit jedem Gespräch dazu.</span>
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={onGoToRegister}
                className="crystal-button w-full sm:w-auto text-base font-semibold text-white rounded-full px-8 py-4 transition-all duration-300 hover:scale-105"
              >
                Kostenlos testen
              </button>
              <button
                onClick={onShowDemoModal}
                className="crystal-button crystal-button-secondary w-full sm:w-auto inline-flex items-center justify-center gap-2 text-base font-semibold text-white/90 rounded-full px-8 py-4 transition-all duration-300 text-center hover:text-white hover:scale-105"
              >
                <IconPhone size={18} className="opacity-70" />
                Demo anrufen
              </button>
            </div>
            <p className="text-xs text-white/40 mt-4">✓ Kostenlos · ✓ Sofort einsatzbereit · ✓ DSGVO-fokussiert</p>
          </div>

          <div className="relative z-10 mt-8 sm:mt-10">
            <button
              type="button"
              onClick={onShowDemoModal}
              className="group relative block w-full overflow-hidden rounded-[28px] border border-white/10 bg-black text-left shadow-[0_32px_120px_rgba(0,0,0,0.50)] transition-transform duration-500 hover:scale-[1.008] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
              aria-label="Telefon-Demo öffnen"
            >
              <div className="absolute -inset-20 bg-[radial-gradient(circle_at_28%_45%,rgba(249,115,22,0.36),transparent_30%),radial-gradient(circle_at_70%_48%,rgba(6,182,212,0.34),transparent_32%)] blur-3xl opacity-75 transition-opacity duration-500 group-hover:opacity-100" />
              <div className="relative aspect-[16/10] sm:aspect-[16/8] lg:aspect-[16/7]">
                <video
                  className="h-full w-full object-cover"
                  src="/media/chipy-crystal-reveal.mp4"
                  poster="/media/chipy-crystal-reveal-poster.png"
                  autoPlay
                  muted
                  onEnded={() => setCrystalSettled(true)}
                  playsInline
                  preload="auto"
                />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_38%,rgba(0,0,0,0.62)_100%)]" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />
                <div
                  className={[
                    'absolute inset-x-3 top-3 grid gap-2 transition-all duration-700 sm:inset-x-6 sm:top-6 sm:grid-cols-3 sm:gap-3',
                    crystalSettled ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0',
                  ].join(' ')}
                >
                  {STEPS.map((step) => (
                    <div
                      key={step.num}
                      className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/45 px-3 py-3 text-left shadow-[0_16px_50px_rgba(0,0,0,0.35)] backdrop-blur-md sm:px-4 sm:py-4"
                    >
                      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(249,115,22,0.18),transparent_42%),radial-gradient(circle_at_84%_20%,rgba(6,182,212,0.14),transparent_44%)]" />
                      <div className="relative">
                        <div className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-cyan-400 text-xs font-black text-white shadow-[0_0_20px_rgba(6,182,212,0.22)]">
                          {step.num}
                        </div>
                        <p className="text-xs font-semibold text-white sm:text-sm">{step.title}</p>
                        <p className="mt-1 hidden text-xs leading-relaxed text-white/55 lg:block">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-4 p-5 sm:p-6 lg:p-8">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/70">Chipy Crystal</p>
                    <p className="mt-1 text-sm sm:text-base font-semibold text-white">
                      {crystalSettled ? 'Die Schritte sind bereit - klick für die Demo' : 'Klick aufs Crystal, um die Demo zu hören'}
                    </p>
                  </div>
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white shadow-[0_0_30px_rgba(6,182,212,0.24)] backdrop-blur transition-colors group-hover:bg-white/15">
                    <IconPhone size={18} />
                  </span>
                </div>
              </div>
            </button>
          </div>
        </div>
      </section>

      {/* Trust bar */}
      <section className="relative z-10 px-6 py-6 max-w-4xl mx-auto">
        <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
          <div className="flex items-center gap-2 text-sm text-white/60">
            <IconBolt size={14} className="text-white/50" />
            <span>In 2 Minuten live</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-white/60">
            <span>Hosting in Deutschland/EU</span>
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
