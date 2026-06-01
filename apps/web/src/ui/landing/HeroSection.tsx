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
      <section className="relative z-10 w-full px-0 pb-12 pt-0">
        <div className="relative min-h-[1080px] overflow-hidden px-4 py-8 sm:min-h-[calc(100svh-72px)] sm:px-8 sm:py-9 lg:min-h-[790px] lg:px-10 lg:py-10">
          <div className="pointer-events-none absolute -inset-24 bg-[radial-gradient(circle_at_18%_18%,rgba(255,91,10,0.24),transparent_28%),radial-gradient(circle_at_82%_22%,rgba(32,217,255,0.22),transparent_30%),radial-gradient(circle_at_50%_88%,rgba(255,183,102,0.10),transparent_36%)] blur-2xl" />

          <button
            type="button"
            onClick={onShowDemoModal}
            className="group absolute inset-x-0 top-0 bottom-0 overflow-hidden bg-transparent text-left transition-transform duration-500 hover:scale-[1.002] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            aria-label="Telefon-Demo öffnen"
          >
            <div className="absolute -inset-20 bg-[radial-gradient(circle_at_30%_36%,rgba(255,91,10,0.40),transparent_30%),radial-gradient(circle_at_52%_40%,rgba(255,247,232,0.10),transparent_28%),radial-gradient(circle_at_70%_42%,rgba(32,217,255,0.36),transparent_34%)] opacity-80 blur-3xl transition-opacity duration-500 group-hover:opacity-100" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,transparent_48%,rgba(0,0,0,0.36)_78%,rgba(0,0,0,0.66)_100%)]" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/72" />

            <video
              className="hero-crystal-video absolute inset-0 z-0 h-full w-full object-cover object-center"
              src="/media/chipy-crystal-reveal.mp4"
              poster="/media/chipy-crystal-reveal-poster.png"
              autoPlay
              muted
              onEnded={() => setCrystalSettled(true)}
              playsInline
              preload="auto"
            />

            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[64%] bg-gradient-to-t from-black via-black/92 to-transparent" />

            <div className="absolute inset-x-4 bottom-4 z-20 flex items-center justify-between gap-4 sm:inset-x-6 sm:bottom-6 lg:inset-x-8 lg:bottom-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/70">Chipy Crystal</p>
                <p className="mt-1 text-sm font-semibold text-white sm:text-base">
                  {crystalSettled ? 'Die Schritte sind bereit - klick für die Demo' : 'Der Crystal landet gleich - klick für die Demo'}
                </p>
              </div>
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white shadow-[0_0_30px_rgba(32,217,255,0.24)] backdrop-blur transition-colors group-hover:bg-white/15">
                <IconPhone size={18} />
              </span>
            </div>
          </button>

          <div className="pointer-events-none relative z-20 flex min-h-[1020px] flex-col justify-between sm:min-h-[calc(100svh-136px)] lg:min-h-[700px]">
            <div className="mx-auto max-w-4xl pt-5 text-center sm:pt-7 lg:pt-4">
              <div className="mb-5 inline-flex items-center gap-2">
                <span
                  className="glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-white/80"
                  style={{ boxShadow: '0 0 20px rgba(255,91,10,0.30), inset 0 0 20px rgba(255,183,102,0.06)' }}
                >
                  <IconStar size={14} className="text-[#ffb766]" />
                  Dein KI-Telefonassistent
                </span>
              </div>

              <h1 className="mx-auto mb-5 max-w-4xl text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
                Nie wieder einen{' '}
                <span
                  className="bg-clip-text text-transparent"
                  style={{ backgroundImage: 'var(--crystal-gradient)' }}
                >
                  Anruf verpassen.
                </span>
              </h1>

              <p className="mx-auto mb-7 max-w-3xl text-lg leading-relaxed text-white/58 sm:text-xl">
                <span className="bg-clip-text font-semibold text-transparent" style={{ backgroundImage: 'var(--crystal-gradient)' }}>Chipy</span> beantwortet Anrufe, bucht Termine und{' '}
                <span className="font-medium text-white/82">lernt mit jedem Gespräch dazu.</span>
              </p>

              <div className="pointer-events-auto flex flex-col items-center justify-center gap-4 sm:flex-row">
                <button
                  onClick={onGoToRegister}
                  className="crystal-button w-full rounded-full px-8 py-4 text-base font-semibold text-white transition-all duration-300 hover:scale-105 sm:w-auto"
                >
                  Kostenlos testen
                </button>
                <button
                  onClick={onShowDemoModal}
                  className="crystal-button crystal-button-secondary inline-flex w-full items-center justify-center gap-2 rounded-full px-8 py-4 text-center text-base font-semibold text-white/90 transition-all duration-300 hover:scale-105 hover:text-white sm:w-auto"
                >
                  <IconPhone size={18} className="opacity-70" />
                  Demo anrufen
                </button>
              </div>
              <p className="mt-4 text-xs text-white/42">✓ Kostenlos · ✓ Sofort einsatzbereit · ✓ DSGVO-fokussiert</p>
            </div>

            <div
              className="crystal-steps-shell pointer-events-none absolute inset-x-4 top-[560px] z-30 grid gap-3 sm:inset-x-6 sm:bottom-32 sm:top-auto sm:grid-cols-3 lg:inset-x-8 lg:bottom-36"
            >
              {STEPS.map((step) => (
                <div key={step.num} className="crystal-step-card">
                  <div className="relative flex items-start gap-3">
                    <div className="crystal-step-number">{step.num}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{step.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-white/58">{step.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-4xl px-6 py-6">
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
            <IconStar size={14} className="text-[#ffb766]/70" />
            <span>Keine Bindung</span>
          </div>
        </div>
      </section>
    </>
  );
}
