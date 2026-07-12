import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IconBolt, IconPhone, IconStar } from '../PhonbotIcons.js';

type HeroSectionProps = {
  onGoToRegister: () => void;
  onShowDemoModal: () => void;
};

/**
 * Hero entrance sequence.
 *
 * 'intro'   — the crystal video is flying in on a dark stage, all copy hidden.
 * 'settled' — the crystal has landed: it recedes into the background (dim +
 *             scrim) and the copy staggers in line by line (CSS-driven via
 *             the data-hero-phase attribute).
 *
 * The full cinematic runs once per session; repeat visits, reduced-motion
 * users and headless crawlers get the settled state immediately. A scroll or
 * focus during the intro skips straight to the content.
 */
type HeroPhase = 'intro' | 'settled';

const INTRO_SEEN_KEY = 'pb-hero-intro-seen';
/** Video runtime is ~3.0s — settle even if `ended` never fires (blocked
 *  autoplay, stalled network, data-saver). */
const INTRO_FALLBACK_MS = 4200;
/** Mobile shows the poster only — shorter, CSS-driven drop-in. */
const INTRO_MOBILE_MS = 1900;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function introAlreadySeen(): boolean {
  try {
    return window.sessionStorage.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    return false; // private mode / storage blocked — just play the intro
  }
}

export function HeroSection({ onGoToRegister, onShowDemoModal }: HeroSectionProps) {
  const [phase, setPhase] = useState<HeroPhase>(() => {
    if (typeof window === 'undefined') return 'settled';
    if (prefersReducedMotion() || introAlreadySeen()) return 'settled';
    return 'intro';
  });
  // Whether THIS mount runs the cinematic — drives the one-off mobile
  // drop-in that must not replay on repeat visits.
  const entranceRef = useRef<'cinematic' | 'instant'>(phase === 'intro' ? 'cinematic' : 'instant');
  const videoRef = useRef<HTMLVideoElement>(null);

  // The 2.7 MB video is desktop-only; CSS `hidden` alone would still
  // download it on mobile (display:none doesn't stop media preload), so the
  // element only renders when the viewport can actually show it.
  const [hasVideo, setHasVideo] = useState(() =>
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(min-width: 640px)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const onChange = () => setHasVideo(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const settle = useCallback(() => {
    setPhase('settled');
    try {
      window.sessionStorage.setItem(INTRO_SEEN_KEY, '1');
    } catch { /* private mode — intro simply replays next visit */ }
  }, []);

  // Whenever the video exists while the hero is already settled (repeat
  // visit, or it mounted after a resize), freeze it on its final frame
  // instead of (re)playing the fly-in behind the visible copy.
  useEffect(() => {
    if (!hasVideo || phase !== 'settled') return;
    const video = videoRef.current;
    if (!video) return;
    const freezeAtEnd = () => {
      try {
        video.currentTime = Math.max(0, (video.duration || 3) - 0.04);
        video.pause();
      } catch { /* seeking unsupported — worst case the video replays dimmed */ }
    };
    if (video.readyState >= 1) freezeAtEnd();
    else video.addEventListener('loadedmetadata', freezeAtEnd, { once: true });
    return () => video.removeEventListener('loadedmetadata', freezeAtEnd);
  }, [hasVideo, phase]);

  // Never leave the copy hidden: settle after the video runtime + margin
  // even when `ended` doesn't fire.
  useEffect(() => {
    if (phase === 'settled') return;
    const fallback = window.setTimeout(settle, INTRO_FALLBACK_MS);
    return () => window.clearTimeout(fallback);
  }, [phase, settle]);

  // Mobile (no video): shorter poster drop-in, then settle.
  useEffect(() => {
    if (phase === 'settled') return;
    if (!window.matchMedia('(min-width: 640px)').matches) {
      const t = window.setTimeout(settle, INTRO_MOBILE_MS);
      return () => window.clearTimeout(t);
    }
  }, [phase, settle]);

  // A scroll during the intro means the user wants content, not cinema.
  useEffect(() => {
    if (phase === 'settled') return;
    const onScroll = () => {
      if (window.scrollY > 40) settle();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [phase, settle]);

  // Owner-Regel 2026-07-11: nach dem Settle bewegt sich das Video nicht mehr
  // — kein Parallax, kein Float, kein Zoom. Nur Scrim + Schrift kommen drüber.

  return (
    <>
      <section className="relative z-10 w-full px-0 pb-0 pt-0">
        <div
          data-hero-phase={phase}
          data-hero-entrance={entranceRef.current}
          className="crystal-plain-bg relative min-h-[700px] overflow-hidden px-4 pb-8 pt-0 sm:min-h-[calc(100svh-72px)] sm:px-8 sm:pb-9 sm:pt-0 lg:min-h-[790px] lg:px-10 lg:pb-10 lg:pt-0"
        >

          <button
            type="button"
            onClick={onShowDemoModal}
            className="hero-crystal-stage group absolute inset-x-0 top-0 bottom-0 overflow-hidden bg-black text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            aria-label="Telefon-Demo öffnen"
          >
            {hasVideo ? (
              <video
                ref={videoRef}
                className="hero-crystal-video absolute inset-0 z-0 hidden h-full w-full object-contain object-center sm:block"
                src="/media/chipy-crystal-reveal.mp4"
                poster="/media/chipy-crystal-reveal-poster.png"
                autoPlay
                muted
                controls={false}
                disablePictureInPicture
                onEnded={settle}
                playsInline
                preload="auto"
              />
            ) : (
              <img
                className="hero-crystal-video hero-crystal-poster absolute inset-0 z-0 h-full w-full object-contain object-center sm:hidden"
                src="/media/chipy-crystal-reveal-poster.png"
                alt=""
                aria-hidden="true"
                draggable={false}
              />
            )}
            {/* Legibility scrim — fades in when the crystal settles so the
                headline never fights the bright facets behind it. The video
                itself never moves. */}
            <div className="hero-crystal-scrim absolute inset-0 z-10" aria-hidden="true" />
          </button>

          <div className="pointer-events-none relative z-20 flex min-h-[660px] flex-col justify-start sm:min-h-[calc(100svh-136px)] sm:justify-between lg:min-h-[700px]">
            <div
              className="mx-auto w-full max-w-[21rem] pt-20 text-center sm:max-w-4xl sm:pt-20 lg:pt-20"
              onFocusCapture={settle}
            >
              <p
                className="hero-copy-item mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] sm:mb-4 sm:text-xs"
                style={{ '--hero-delay': '0s' } as React.CSSProperties}
              >
                Der KI-Telefonassistent für Friseursalons
              </p>
              <h1 className="mx-auto mb-4 max-w-[20rem] text-[2.08rem] font-extrabold leading-[1.04] tracking-tight sm:mb-5 sm:max-w-4xl sm:text-5xl md:text-6xl lg:text-7xl">
                <span className="hero-line">
                  <span className="hero-line-inner" style={{ '--hero-delay': '0.1s' } as React.CSSProperties}>
                    Nie wieder einen
                  </span>
                </span>
                <span className="hero-line">
                  <span
                    className="hero-line-inner bg-clip-text text-transparent"
                    style={{ '--hero-delay': '0.22s', backgroundImage: 'var(--crystal-gradient)' } as React.CSSProperties}
                  >
                    Anruf verpassen.
                  </span>
                </span>
              </h1>

              <p
                className="hero-copy-item mx-auto mb-6 max-w-[20rem] text-[0.95rem] leading-relaxed text-white/64 sm:mb-7 sm:max-w-3xl sm:text-xl"
                style={{ '--hero-delay': '0.4s' } as React.CSSProperties}
              >
                <span className="bg-clip-text font-semibold text-transparent" style={{ backgroundImage: 'var(--crystal-gradient)' }}>Phonbot</span> nimmt die Anrufe deines Salons an, bucht Termine und{' '}
                <span className="font-medium text-white/82">lernt mit jedem Gespräch dazu.</span>
              </p>

              <div
                className="hero-copy-item pointer-events-auto mx-auto flex w-full max-w-[20.5rem] flex-col items-center justify-center gap-3 sm:max-w-none sm:flex-row sm:gap-4"
                style={{ '--hero-delay': '0.55s' } as React.CSSProperties}
              >
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
              <p
                className="hero-copy-item hero-trust-line mx-auto mt-4 inline-flex max-w-full items-center justify-center rounded-full px-2.5 py-1.5 text-[11px] font-semibold leading-none text-white/68 min-[390px]:text-xs"
                style={{ '--hero-delay': '0.7s' } as React.CSSProperties}
              >✓ Kostenlos · ✓ Sofort einsatzbereit · ✓ DSGVO-fokussiert</p>
            </div>

            {/* Die 3 Schritte leben in der HowSection direkt unter dem Hero —
                hier oben bleibt die Bühne für Kristall + Kernbotschaft. */}
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
