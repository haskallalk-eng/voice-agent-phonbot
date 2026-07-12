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
      {/* Background crystal glows */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
        <div className="crystal-page-glow glow-pulse absolute -top-40 left-1/4 h-[600px] w-[600px]"
          style={{ background: 'radial-gradient(ellipse, rgba(255,91,10,0.12) 0%, transparent 70%)' }} />
        <div className="crystal-page-glow crystal-page-glow-cyan glow-pulse absolute bottom-0 -right-40 h-[500px] w-[500px]"
          style={{ background: 'radial-gradient(ellipse, rgba(32,217,255,0.08) 0%, transparent 70%)', animationDelay: '1.5s' }} />
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
