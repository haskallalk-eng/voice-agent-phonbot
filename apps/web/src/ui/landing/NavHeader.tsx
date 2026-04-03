import React, { useState } from 'react';
import { PhonbotBrand } from '../FoxLogo.js';

type NavHeaderProps = {
  onGoToRegister: () => void;
  onGoToLogin: () => void;
};

export function NavHeader({ onGoToRegister, onGoToLogin }: NavHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="relative z-20 border-b border-white/5 backdrop-blur-md bg-[#0A0A0F]/80 sticky top-0">
      <div className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        {/* Logo */}
        <PhonbotBrand size="sm" />

        {/* Center nav links — hidden on mobile */}
        <nav className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-sm text-white/60 hover:text-white transition-colors duration-200">Features</a>
          <a href="#how" className="text-sm text-white/60 hover:text-white transition-colors duration-200">So funktioniert's</a>
          <a href="#demo" className="text-sm text-white/60 hover:text-white transition-colors duration-200">Demo</a>
          <a href="#preise" className="text-sm text-white/60 hover:text-white transition-colors duration-200">Preise</a>
          <a href="#faq" className="text-sm text-white/60 hover:text-white transition-colors duration-200">FAQ</a>
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-4">
          <button
            onClick={onGoToLogin}
            className="text-sm text-white/60 hover:text-white transition-colors duration-200 hidden sm:block"
          >
            Einloggen
          </button>
          <button
            onClick={onGoToRegister}
            className="text-sm font-semibold text-white rounded-full px-5 py-2.5 transition-all duration-300 hover:shadow-[0_0_24px_rgba(249,115,22,0.5)] hover:scale-105 hidden sm:block"
            style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
          >
            Kostenlos testen
          </button>
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden flex flex-col gap-1.5 p-2 rounded-lg hover:bg-white/5 transition-colors"
            aria-label="Menü öffnen"
          >
            <span className={`block w-5 h-0.5 bg-white/60 transition-all duration-200 ${mobileMenuOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`block w-5 h-0.5 bg-white/60 transition-all duration-200 ${mobileMenuOpen ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-0.5 bg-white/60 transition-all duration-200 ${mobileMenuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-white/5 bg-[#0A0A0F]/95 backdrop-blur-md px-6 py-4 space-y-1">
          {[
            { href: '#features', label: 'Features' },
            { href: '#how', label: "So funktioniert's" },
            { href: '#demo', label: 'Demo' },
            { href: '#preise', label: 'Preise' },
            { href: '#faq', label: 'FAQ' },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setMobileMenuOpen(false)}
              className="block py-3 text-sm text-white/60 hover:text-white transition-colors border-b border-white/5 last:border-0"
            >
              {item.label}
            </a>
          ))}
          <div className="pt-3 flex flex-col gap-2">
            <button
              onClick={() => { setMobileMenuOpen(false); onGoToLogin(); }}
              className="w-full py-2.5 text-sm text-white/60 rounded-xl border border-white/10 hover:text-white hover:border-white/20 transition-colors"
            >
              Einloggen
            </button>
            <button
              onClick={() => { setMobileMenuOpen(false); onGoToRegister(); }}
              className="w-full py-2.5 text-sm font-semibold text-white rounded-xl"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
            >
              Kostenlos testen
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
