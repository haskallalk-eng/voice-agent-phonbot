import React from 'react';
import { NavHeader } from './NavHeader.js';
import { FooterSection } from './FooterSection.js';
import { ContactSection } from './ContactSection.js';
import { LegalModal } from '../LegalModal.js';
import { CookieBanner } from '../CookieBanner.js';

type Props = {
  onGoToRegister: () => void;
  onGoToLogin: () => void;
  onBack: () => void;
};

export function ContactPage({ onGoToRegister, onGoToLogin, onBack }: Props) {
  const [legalPage, setLegalPage] = React.useState<'impressum' | 'datenschutz' | 'agb' | null>(null);

  return (
    <div className="noise bg-[#0A0A0F] text-white relative min-h-screen flex flex-col">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
        <div className="glow-pulse absolute -top-40 left-1/4 w-[600px] h-[600px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.12) 0%, transparent 70%)' }} />
        <div className="glow-pulse absolute bottom-0 -right-40 w-[500px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 70%)', animationDelay: '1.5s' }} />
      </div>

      <NavHeader
        onGoToRegister={onGoToRegister}
        onGoToLogin={onGoToLogin}
        onGoToContact={() => { /* already here */ }}
        activePage="contact"
        onNavigate={(anchor) => {
          // Go back to landing, then let the hash scroll it into place.
          window.location.hash = anchor;
          onBack();
        }}
        onSelectIndustry={(id) => {
          // Navigate back to landing with ?demo=<id> — DemoSection auto-triggers on mount.
          const url = new URL(window.location.href);
          url.searchParams.set('demo', id);
          window.history.replaceState({}, '', url.toString());
          onBack();
        }}
      />

      <div className="flex-1">
        <ContactSection />
      </div>

      <FooterSection onShowLegal={setLegalPage} onGoToContact={() => {}} />

      {legalPage && <LegalModal page={legalPage} onClose={() => setLegalPage(null)} />}
      <CookieBanner onShowDatenschutz={() => setLegalPage('datenschutz')} />
    </div>
  );
}
