import React, { useEffect, useState } from 'react';
import { OwlyDemoModal } from '../OwlyDemoModal.js';
import { LegalModal } from '../LegalModal.js';
import { CookieBanner } from '../CookieBanner.js';
import { NavHeader } from './NavHeader.js';
import { HeroSection } from './HeroSection.js';
import { DemoSection } from './DemoSection.js';
import { HowSection } from './HowSection.js';
import { FeaturesSection } from './FeaturesSection.js';
import { SavingsCalculator } from './SavingsCalculator.js';
import { StatsSection } from './StatsSection.js';
import { FaqSection } from './FaqSection.js';
import { PricingSection } from './PricingSection.js';
import { CallbackSection } from './CallbackSection.js';
import { FinalCTA } from './FinalCTA.js';
import { FooterSection } from './FooterSection.js';

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
      <NavHeader
        onGoToRegister={onGoToRegister}
        onGoToLogin={onGoToLogin}
        onGoToContact={onGoToContact}
        activePage="landing"
        onSelectIndustry={(id) => {
          // Set ?demo=<id> and jump to the demo section — DemoSection already
          // picks the param up and auto-triggers the web call, then strips it.
          const url = new URL(window.location.href);
          url.searchParams.set('demo', id);
          window.history.replaceState({}, '', url.toString());
          document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' });
          // Fire a popstate-ish signal so DemoSection re-reads the URL if it listens,
          // otherwise a scroll is enough — the param will be read on next mount.
          window.dispatchEvent(new Event('phonbot:demo-param-updated'));
        }}
      />

      <main id="main" role="main">
        {/* ── HERO + TRUST BAR ── */}
        <HeroSection onGoToRegister={onGoToRegister} onShowDemoModal={() => setShowDemoModal(true)} />

        {/* ── WAVEFORM + DEMO ── */}
        <DemoSection onGoToRegister={onGoToRegister} />

        {/* ── HOW IT WORKS (scroll-triggered) ── */}
        <HowSection />

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
        <CallbackSection />

        {/* ── FINAL CTA ── */}
        <FinalCTA onGoToRegister={onGoToRegister} />
      </main>

      {/* ── FOOTER ── */}
      <FooterSection onShowLegal={setLegalPage} onGoToContact={onGoToContact} />

      {/* ── CHIPPY DEMO MODAL ── */}
      {showDemoModal && (
        <OwlyDemoModal onClose={() => setShowDemoModal(false)} onGoToRegister={onGoToRegister} />
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
