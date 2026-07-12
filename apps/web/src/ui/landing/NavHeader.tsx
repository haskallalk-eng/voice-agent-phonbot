import React, { useState } from 'react';
import { PhonbotBrand } from '../FoxLogo.js';

type NavHeaderProps = {
  onGoToRegister: () => void;
  onGoToLogin: () => void;
  onGoToContact?: () => void;
  /** Called when a nav anchor (demo/features/preise/faq) is clicked. Needed on pages
   *  other than the landing page so in-page `#anchor` hrefs still work — parent
   *  can navigate back to the landing page first. If omitted, plain anchor links
   *  are used (default behaviour on the landing page itself). */
  onNavigate?: (anchor: 'demo' | 'features' | 'preise' | 'faq') => void;
  /** Highlights the active entry. */
  activePage?: 'landing' | 'contact';
};

const NAV_ITEMS: Array<{ anchor: 'demo' | 'features' | 'preise' | 'faq'; label: string }> = [
  { anchor: 'demo', label: 'Demo' },
  { anchor: 'features', label: 'Features' },
  { anchor: 'preise', label: 'Preise' },
  { anchor: 'faq', label: 'FAQ' },
];

export function NavHeader({
  onGoToRegister,
  onGoToLogin,
  onGoToContact,
  onNavigate,
  activePage = 'landing',
}: NavHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNav = (anchor: 'demo' | 'features' | 'preise' | 'faq') => (e: React.MouseEvent) => {
    if (onNavigate) {
      e.preventDefault();
      onNavigate(anchor);
    }
    // else: plain anchor link (landing page) — default behaviour
  };

  const navLinkClass = 'text-sm text-white/60 hover:text-white transition-colors duration-200';

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-50 bg-[#050508]">
      <div className="pointer-events-auto mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Logo */}
        <PhonbotBrand size="sm" />

        {/* Center nav — desktop */}
        <nav className="hidden lg:flex items-center gap-8">
          {NAV_ITEMS.map((item) => (
            <a key={item.anchor} href={`#${item.anchor}`} onClick={handleNav(item.anchor)} className={navLinkClass}>
              {item.label}
            </a>
          ))}

          <a href="/friseur/" className={navLinkClass}>
            Für Friseure
          </a>

          <a href="/blog/" className={navLinkClass}>
            Blog
          </a>

          <button
            onClick={onGoToContact}
            className={`${navLinkClass} ${activePage === 'contact' ? 'text-white font-medium' : ''}`}
          >
            Kontakt
          </button>
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-4">
          <button
            onClick={onGoToLogin}
            className="text-sm text-white/60 hover:text-white transition-colors duration-200 hidden lg:block"
          >
            Einloggen
          </button>
          <button
            onClick={onGoToRegister}
            className="crystal-button text-sm font-semibold text-white rounded-full px-5 py-2.5 transition-all duration-300 hover:scale-105 hidden lg:block"
          >
            Kostenlos testen
          </button>
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden flex flex-col gap-1.5 p-2 rounded-lg hover:bg-white/5 transition-colors"
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
        <div className="lg:hidden min-h-[calc(100svh-66px)] border-t border-white/5 bg-[#050508] px-6 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.anchor}
              href={`#${item.anchor}`}
              onClick={(e) => {
                setMobileMenuOpen(false);
                if (onNavigate) {
                  e.preventDefault();
                  onNavigate(item.anchor);
                }
              }}
              className="block py-3 text-sm text-white/60 hover:text-white transition-colors border-b border-white/5"
            >
              {item.label}
            </a>
          ))}

          <a
            href="/friseur/"
            onClick={() => setMobileMenuOpen(false)}
            className="block py-3 text-sm text-white/60 hover:text-white transition-colors border-b border-white/5"
          >
            Für Friseure
          </a>

          <a
            href="/blog/"
            onClick={() => setMobileMenuOpen(false)}
            className="block py-3 text-sm text-white/60 hover:text-white transition-colors border-b border-white/5"
          >
            Blog
          </a>

          <button
            onClick={() => { setMobileMenuOpen(false); onGoToContact?.(); }}
            className={`block w-full text-left py-3 text-sm transition-colors ${activePage === 'contact' ? 'text-white font-medium' : 'text-white/60 hover:text-white'}`}
          >
            Kontakt
          </button>
          <div className="pt-3 flex flex-col gap-2">
            <button
              onClick={() => { setMobileMenuOpen(false); onGoToLogin(); }}
              className="crystal-button crystal-button-secondary w-full py-2.5 text-sm text-white/75 rounded-xl hover:text-white transition-all"
            >
              Einloggen
            </button>
            <button
              onClick={() => { setMobileMenuOpen(false); onGoToRegister(); }}
              className="crystal-button w-full py-2.5 text-sm font-semibold text-white rounded-xl"
            >
              Kostenlos testen
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
