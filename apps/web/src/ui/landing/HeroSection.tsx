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
      <section className="relative z-10 w-full px-0 pb-0 pt-0">
        <div className="crystal-plain-bg relative min-h-[1130px] overflow-hidden px-4 pb-8 pt-0 sm:min-h-[calc(100svh-72px)] sm:px-8 sm:pb-9 sm:pt-0 lg:min-h-[790px] lg:px-10 lg:pb-10 lg:pt-0">

          <button
            type="button"
            onClick={onShowDemoModal}
            className="hero-crystal-stage group absolute inset-x-0 top-0 bottom-0 overflow-hidden bg-black text-left transition-transform duration-500 hover:scale-[1.002] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            aria-label="Telefon-Demo öffnen"
          >
            <div className="absolute inset-0 bg-transparent" />

            <video
              className="hero-crystal-video absolute inset-0 z-0 hidden h-full w-full object-contain object-center sm:block"
              src="/media/chipy-crystal-reveal.mp4"
              poster="/media/chipy-crystal-reveal-poster.png"
              autoPlay
              muted
              controls={false}
              disablePictureInPicture
              onEnded={() => setCrystalSettled(true)}
              playsInline
              preload="auto"
            />
            <img
              className="hero-crystal-video absolute inset-0 z-0 h-full w-full object-contain object-center sm:hidden"
              src="/media/chipy-crystal-reveal-poster.png"
              alt=""
              aria-hidden="true"
              draggable={false}
            />

            <div className="hidden">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/70">Phonbot Crystal</p>
                <p className="mt-1 text-sm font-semibold text-white sm:text-base">
                  {crystalSettled ? 'Die Schritte sind bereit - klick für die Demo' : 'Der Crystal landet gleich - klick für die Demo'}
                </p>
              </div>
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white shadow-[0_0_30px_rgba(32,217,255,0.24)] backdrop-blur transition-colors group-hover:bg-white/15">
                <IconPhone size={18} />
              </span>
            </div>
          </button>

          <div className="pointer-events-none relative z-20 flex min-h-[1060px] flex-col justify-start sm:min-h-[calc(100svh-136px)] sm:justify-between lg:min-h-[700px]">
            <div className="mx-auto w-full max-w-[21rem] pt-16 text-center sm:max-w-4xl sm:pt-20 lg:pt-20">
              <h1 className="mx-auto mb-4 max-w-[20rem] text-[2.08rem] font-extrabold leading-[1.04] tracking-tight sm:mb-5 sm:max-w-4xl sm:text-5xl md:text-6xl lg:text-7xl">
                Nie wieder einen{' '}
                <span
                  className="bg-clip-text text-transparent"
                  style={{ backgroundImage: 'var(--crystal-gradient)' }}
                >
                  Anruf verpassen.
                </span>
              </h1>

              <p className="mx-auto mb-6 max-w-[20rem] text-[0.95rem] leading-relaxed text-white/64 sm:mb-7 sm:max-w-3xl sm:text-xl">
                <span className="bg-clip-text font-semibold text-transparent" style={{ backgroundImage: 'var(--crystal-gradient)' }}>Phonbot</span> beantwortet Anrufe, bucht Termine und{' '}
                <span className="font-medium text-white/82">lernt mit jedem Gespräch dazu.</span>
              </p>

              <div className="pointer-events-auto mx-auto flex w-full max-w-[20.5rem] flex-col items-center justify-center gap-3 sm:max-w-none sm:flex-row sm:gap-4">
                <button
                  onClick={onGoToRegister}
                  className="crystal-button min-h-14 w-full rounded-full px-5 py-3.5 text-base font-semibold text-white transition-all duration-300 hover:scale-105 sm:w-auto sm:px-8 sm:py-4"
                >
                  Kostenlos testen
                </button>
                <button
                  onClick={onShowDemoModal}
                  className="crystal-button crystal-button-secondary inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full px-5 py-3.5 text-center text-base font-semibold text-white/90 transition-all duration-300 hover:scale-105 hover:text-white sm:w-auto sm:px-8 sm:py-4"
                >
                  <IconPhone size={18} className="opacity-70" />
                  Demo anrufen
                </button>
              </div>
              <p className="hero-trust-line mx-auto mt-4 inline-flex max-w-full items-center justify-center rounded-full px-2.5 py-1.5 text-[11px] font-semibold leading-none text-white/68 min-[390px]:text-xs">✓ Kostenlos · ✓ Sofort einsatzbereit · ✓ DSGVO-fokussiert</p>
            </div>

            <div
              className="crystal-steps-shell mobile-crystal-steps pointer-events-none relative z-30 mx-auto grid w-full max-w-[22rem] gap-3 sm:absolute sm:inset-x-6 sm:bottom-32 sm:top-auto sm:mx-0 sm:max-w-none sm:grid-cols-3 lg:inset-x-8 lg:bottom-36"
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

      <div className="hero-crystal-transition relative z-10 -mt-36 h-72 sm:-mt-44 sm:h-80" aria-hidden="true" />

      <section className="relative z-10 mx-auto -mt-24 max-w-4xl px-6 pb-8 pt-0 sm:-mt-28">
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
