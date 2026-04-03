import React from 'react';
import { PhonbotBrand } from '../FoxLogo.js';

type FooterSectionProps = {
  onShowLegal: (page: 'impressum' | 'datenschutz' | 'agb') => void;
};

export function FooterSection({ onShowLegal }: FooterSectionProps) {
  return (
    <footer className="relative z-10 border-t border-white/5 px-6 py-12">
      <div className="max-w-6xl mx-auto">
        {/* Top row: brand + link columns */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-8 mb-10">
          {/* Brand */}
          <div className="sm:col-span-1">
            <PhonbotBrand size="sm" />
            <p className="text-xs text-white/35 mt-2 leading-relaxed">Dein KI-Telefonassistent.<br />Immer erreichbar.</p>
          </div>

          {/* Produkt */}
          <div>
            <h4 className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-3">Produkt</h4>
            <ul className="space-y-2">
              <li><a href="#features" className="text-sm text-white/40 hover:text-white/70 transition-colors">Features</a></li>
              <li><a href="#demo" className="text-sm text-white/40 hover:text-white/70 transition-colors">Demo</a></li>
              <li><a href="#preise" className="text-sm text-white/40 hover:text-white/70 transition-colors">Preise</a></li>
            </ul>
          </div>

          {/* Rechtliches */}
          <div>
            <h4 className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-3">Rechtliches</h4>
            <ul className="space-y-2">
              <li><button onClick={() => onShowLegal('datenschutz')} className="text-sm text-white/40 hover:text-white/70 transition-colors">Datenschutz</button></li>
              <li><button onClick={() => onShowLegal('impressum')} className="text-sm text-white/40 hover:text-white/70 transition-colors">Impressum</button></li>
              <li><button onClick={() => onShowLegal('agb')} className="text-sm text-white/40 hover:text-white/70 transition-colors">AGB</button></li>
            </ul>
          </div>

          {/* Social */}
          <div>
            <h4 className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-3">Social</h4>
            <a
              href="#"
              aria-label="GitHub"
              className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              GitHub
            </a>
          </div>
        </div>

        {/* Bottom row: copyright + DSGVO */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/5 pt-6">
          <p className="text-xs text-white/30">© 2026 Phonbot · Alle Rechte vorbehalten</p>
          <p className="text-xs text-white/30">DSGVO-konform · Server in Deutschland</p>
        </div>
      </div>
    </footer>
  );
}
