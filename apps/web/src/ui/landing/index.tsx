import React, { Suspense, useEffect, useRef, useState } from 'react';
import { LegalModal } from '../LegalModal.js';
import { CookieBanner } from '../CookieBanner.js';
import { NavHeader } from './NavHeader.js';
import { HeroSection } from './HeroSection.js';
import { HowSection } from './HowSection.js';
import { FeaturesSection } from './FeaturesSection.js';
import { SavingsCalculator } from './SavingsCalculator.js';
import { StatsSection } from './StatsSection.js';
import { FaqSection } from './FaqSection.js';
import { PricingSection } from './PricingSection.js';
import { FinalCTA } from './FinalCTA.js';
import { FooterSection } from './FooterSection.js';

const DemoSection = React.lazy(() => import('./DemoSection.js').then((m) => ({ default: m.DemoSection })));
const CallbackSection = React.lazy(() => import('./CallbackSection.js').then((m) => ({ default: m.CallbackSection })));
const OwlyDemoModal = React.lazy(() => import('../OwlyDemoModal.js').then((m) => ({ default: m.OwlyDemoModal })));

function useLoadWhenVisible(rootMargin = '0px') {
  const [load, setLoad] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (load) return;
    let observer: IntersectionObserver | null = null;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries, currentObserver) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setLoad(true);
          currentObserver.disconnect();
        }
      }, { rootMargin });
      if (ref.current) observer.observe(ref.current);
    } else {
      setLoad(true);
    }
    return () => observer?.disconnect();
  }, [load, rootMargin]);

  return { load, setLoad, ref };
}

function DeferredDemoSection({ onGoToRegister }: { onGoToRegister: () => void }) {
  const { load: visible, ref } = useLoadWhenVisible('0px');
  const [forceLoad, setForceLoad] = useState(() => {
    if (typeof window === 'undefined') return false;
    const url = new URL(window.location.href);
    return window.location.hash === '#demo' || url.searchParams.has('demo');
  });
  const loadDemo = visible || forceLoad;

  useEffect(() => {
    const shouldLoad = () => {
      const url = new URL(window.location.href);
      if (window.location.hash === '#demo' || url.searchParams.has('demo')) setForceLoad(true);
    };
    shouldLoad();
    window.addEventListener('hashchange', shouldLoad);
    window.addEventListener('phonbot:demo-param-updated', shouldLoad);
    return () => {
      window.removeEventListener('hashchange', shouldLoad);
      window.removeEventListener('phonbot:demo-param-updated', shouldLoad);
    };
  }, []);

  if (!loadDemo) {
    return (
      <section id="demo" ref={ref} className="relative z-10 px-6 py-20 max-w-5xl mx-auto ambient-glow-alt ambient-glow text-center">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-orange-400/60 uppercase mb-4">Telefon-Demo</p>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">Phonbot live anrufen</h2>
        <p className="text-white/50 max-w-2xl mx-auto mb-6">
          Die Telefon-Demo wird erst geladen, wenn du sie wirklich ansehen möchtest. So bleibt die Startseite schnell.
        </p>
        <button
          type="button"
          onClick={() => setForceLoad(true)}
          className="crystal-button rounded-full px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:scale-105"
        >
          Demo laden
        </button>
      </section>
    );
  }

  return (
    <Suspense fallback={<div id="demo" className="relative z-10 px-6 py-24 text-center text-white/40">Demo wird geladen...</div>}>
      <DemoSection onGoToRegister={onGoToRegister} />
    </Suspense>
  );
}

function DeferredCallbackSection() {
  const { load, setLoad, ref } = useLoadWhenVisible('0px');
  if (!load) {
    return (
      <section ref={ref} className="relative z-10 px-6 py-20 max-w-4xl mx-auto text-center">
        <p className="text-white/45 mb-4">Lieber Rückruf statt selbst testen?</p>
        <button
          type="button"
          onClick={() => setLoad(true)}
          className="crystal-button crystal-button-secondary rounded-full px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:scale-105"
        >
          Rückruf-Formular laden
        </button>
      </section>
    );
  }

  return (
    <Suspense fallback={<div className="relative z-10 px-6 py-20 text-center text-white/40">Rückruf-Formular wird geladen...</div>}>
      <CallbackSection />
    </Suspense>
  );
}

type Props = {
  onGoToRegister: () => void;
  onGoToLogin: () => void;
  onGoToContact?: () => void;
};

export function LandingPage({ onGoToRegister, onGoToLogin, onGoToContact }: Props) {
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [legalPage, setLegalPage] = useState<'impressum' | 'datenschutz' | 'agb' | null>(null);

  // When the user arrives at /#features (e.g. from a static page footer link),
  // the browser tries to scroll before React has rendered the section — so the
  // target doesn't exist yet and the browser gives up. We re-do the scroll
  // after mount, once the DOM is actually there. Also handles same-page hash
  // clicks that target in-page sections (features/demo/preise/faq).
  useEffect(() => {
    const SECTION_IDS = new Set(['features', 'demo', 'preise', 'faq']);
    const tryScroll = () => {
      const id = window.location.hash.replace('#', '');
      if (!SECTION_IDS.has(id)) return;
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    // Hydration can still be settling — run twice, once now and once after paint.
    tryScroll();
    const t = setTimeout(tryScroll, 120);
    window.addEventListener('hashchange', tryScroll);
    return () => {
      clearTimeout(t);
      window.removeEventListener('hashchange', tryScroll);
    };
  }, []);

  return (
    <div className="phonbot-landing bg-[#050508] text-white relative">

      {/* ── NAV ── */}
      <NavHeader
        onGoToRegister={onGoToRegister}
        onGoToLogin={onGoToLogin}
        onGoToContact={onGoToContact}
        activePage="landing"
      />

      <main id="main" role="main">
        {/* ── HERO + TRUST BAR ── */}
        <HeroSection onGoToRegister={onGoToRegister} onShowDemoModal={() => setShowDemoModal(true)} />

        {/* ── HOW IT WORKS — direkt nach dem Hero (die Schritte stehen nur
            noch hier, nicht mehr als Karten im Hero) ── */}
        <HowSection />

        {/* ── TELEFON-DEMO ── */}
        <DeferredDemoSection onGoToRegister={onGoToRegister} />

        {/* ── FEATURES ── */}
        <FeaturesSection />

        {/* ── SAVINGS CALCULATOR ── */}
        <SavingsCalculator onCTA={onGoToRegister} />

        {/* ── STATS (count-up) ── */}
        <StatsSection />

        {/* ── FAQ ── */}
        <FaqSection />

        {/* ── PRICING ── */}
        <PricingSection onGoToRegister={onGoToRegister} onGoToContact={onGoToContact} />

        {/* ── RÜCKRUF-FORMULAR ── */}
        <DeferredCallbackSection />

        {/* ── FINAL CTA ── */}
        <FinalCTA onGoToRegister={onGoToRegister} />
      </main>

      {/* ── FOOTER ── */}
      <FooterSection onShowLegal={setLegalPage} onGoToContact={onGoToContact} />

      {/* ── CHIPPY DEMO MODAL ── */}
      {showDemoModal && (
        <Suspense fallback={null}>
          <OwlyDemoModal onClose={() => setShowDemoModal(false)} onGoToRegister={onGoToRegister} />
        </Suspense>
      )}

      {/* ── LEGAL MODAL ── */}
      {legalPage && (
        <LegalModal page={legalPage} onClose={() => setLegalPage(null)} />
      )}

      {/* ── COOKIE BANNER ── */}
      <CookieBanner onShowDatenschutz={() => setLegalPage('datenschutz')} />
    </div>
  );
}
