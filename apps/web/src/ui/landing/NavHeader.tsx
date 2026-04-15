import React, { useEffect, useRef, useState } from 'react';
import { PhonbotBrand } from '../FoxLogo.js';
import { TEMPLATES } from './shared.js';

type NavHeaderProps = {
  onGoToRegister: () => void;
  onGoToLogin: () => void;
  onGoToContact?: () => void;
  /** Called when a branche is chosen from the dropdown. Parent decides how to route
   *  (e.g. navigate to landing + set ?demo=<id> + scroll to #demo). */
  onSelectIndustry?: (templateId: string) => void;
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
  onSelectIndustry,
  onNavigate,
  activePage = 'landing',
}: NavHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [branchenOpen, setBranchenOpen] = useState(false);
  const branchenRef = useRef<HTMLDivElement | null>(null);

  // Close the desktop dropdown when clicking outside.
  useEffect(() => {
    if (!branchenOpen) return;
    function onDoc(e: MouseEvent) {
      if (branchenRef.current && !branchenRef.current.contains(e.target as Node)) {
        setBranchenOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [branchenOpen]);

  const handleNav = (anchor: 'demo' | 'features' | 'preise' | 'faq') => (e: React.MouseEvent) => {
    if (onNavigate) {
      e.preventDefault();
      onNavigate(anchor);
    }
    // else: plain anchor link (landing page) — default behaviour
  };

  const handleIndustry = (id: string) => {
    setBranchenOpen(false);
    setMobileMenuOpen(false);
    onSelectIndustry?.(id);
  };

  const navLinkClass = 'text-sm text-white/60 hover:text-white transition-colors duration-200';

  return (
    <header className="relative z-20 border-b border-white/5 backdrop-blur-md bg-[#0A0A0F]/80 sticky top-0">
      <div className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        {/* Logo */}
        <PhonbotBrand size="sm" />

        {/* Center nav — desktop */}
        <nav className="hidden md:flex items-center gap-8">
          {NAV_ITEMS.map((item) => (
            <a key={item.anchor} href={`#${item.anchor}`} onClick={handleNav(item.anchor)} className={navLinkClass}>
              {item.label}
            </a>
          ))}

          {/* Branchen dropdown */}
          <div className="relative" ref={branchenRef}>
            <button
              type="button"
              onClick={() => setBranchenOpen((v) => !v)}
              className={`${navLinkClass} flex items-center gap-1`}
              aria-haspopup="true"
              aria-expanded={branchenOpen}
            >
              Branchen
              <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform ${branchenOpen ? 'rotate-180' : ''}`} aria-hidden="true">
                <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {branchenOpen && (
              <div
                className="absolute left-1/2 -translate-x-1/2 top-full mt-3 w-64 rounded-2xl border border-white/10 bg-[#0A0A0F]/95 backdrop-blur-xl shadow-xl py-2 z-30"
                role="menu"
              >
                {TEMPLATES.map((t) => {
                  const Icon = t.Icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleIndustry(t.id)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-white/80 hover:bg-white/5 hover:text-white transition-colors"
                      role="menuitem"
                    >
                      <Icon size={18} className="text-orange-400 shrink-0" />
                      <span className="flex-1">{t.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

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

          {/* Branchen — collapsible group */}
          <details className="group border-b border-white/5">
            <summary className="flex items-center justify-between py-3 text-sm text-white/60 hover:text-white transition-colors cursor-pointer list-none">
              <span>Branchen</span>
              <svg width="10" height="10" viewBox="0 0 10 10" className="transition-transform group-open:rotate-180" aria-hidden="true">
                <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </summary>
            <div className="pb-2">
              {TEMPLATES.map((t) => {
                const Icon = t.Icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleIndustry(t.id)}
                    className="w-full flex items-center gap-3 px-2 py-2 text-left text-sm text-white/70 hover:text-white transition-colors"
                  >
                    <Icon size={16} className="text-orange-400 shrink-0" />
                    <span>{t.name}</span>
                  </button>
                );
              })}
            </div>
          </details>

          <button
            onClick={() => { setMobileMenuOpen(false); onGoToContact?.(); }}
            className={`block w-full text-left py-3 text-sm transition-colors ${activePage === 'contact' ? 'text-white font-medium' : 'text-white/60 hover:text-white'}`}
          >
            Kontakt
          </button>
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
