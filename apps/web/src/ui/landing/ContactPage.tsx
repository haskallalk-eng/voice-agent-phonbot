import React from 'react';
import { PhonbotBrand } from '../FoxLogo.js';
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

      {/* Simple nav — links go back to landing */}
      <header className="relative z-20 border-b border-white/5 backdrop-blur-md bg-[#0A0A0F]/80 sticky top-0">
        <div className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
          <button onClick={onBack} className="cursor-pointer">
            <PhonbotBrand size="sm" />
          </button>
          <nav className="hidden md:flex items-center gap-8">
            <button onClick={onBack} className="text-sm text-white/60 hover:text-white transition-colors duration-200">Demo</button>
            <button onClick={onBack} className="text-sm text-white/60 hover:text-white transition-colors duration-200">Features</button>
            <button onClick={onBack} className="text-sm text-white/60 hover:text-white transition-colors duration-200">Preise</button>
            <button onClick={onBack} className="text-sm text-white/60 hover:text-white transition-colors duration-200">FAQ</button>
            <span className="text-sm text-white font-medium">Kontakt</span>
          </nav>
          <div className="flex items-center gap-4">
            <button onClick={onGoToLogin} className="text-sm text-white/60 hover:text-white transition-colors duration-200 hidden sm:block">Einloggen</button>
            <button onClick={onGoToRegister}
              className="text-sm font-semibold text-white rounded-full px-5 py-2.5 transition-all duration-300 hover:shadow-[0_0_24px_rgba(249,115,22,0.5)] hover:scale-105 hidden sm:block"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
              Kostenlos testen
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1">
        <ContactSection />
      </div>

      <FooterSection onShowLegal={setLegalPage} onGoToContact={() => {}} />

      {legalPage && <LegalModal page={legalPage} onClose={() => setLegalPage(null)} />}
      <CookieBanner onShowDatenschutz={() => setLegalPage('datenschutz')} />
    </div>
  );
}
