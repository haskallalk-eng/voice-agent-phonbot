import React from 'react';
import { PhonbotBrand } from '../FoxLogo.js';

type FooterSectionProps = {
  onShowLegal: (page: 'impressum' | 'datenschutz' | 'agb') => void;
  onGoToContact?: () => void;
};

export function FooterSection({ onShowLegal, onGoToContact }: FooterSectionProps) {
  return (
    <footer className="relative z-10 border-t border-white/5 px-6 py-12">
      <div className="max-w-6xl mx-auto">
        {/* Top row: brand + link columns */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-8 mb-10">
          {/* Brand */}
          <div className="sm:col-span-1">
            <PhonbotBrand size="sm" />
            <p className="text-xs text-white/35 mt-2 leading-relaxed">Chipy — dein KI-Telefonassistent.<br />Immer erreichbar.</p>
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

          {/* Kontakt */}
          <div>
            <h4 className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-3">Kontakt</h4>
            <ul className="space-y-2">
              <li><button onClick={onGoToContact} className="text-sm text-white/40 hover:text-white/70 transition-colors">Anfragen</button></li>
              <li><a href="#faq" className="text-sm text-white/40 hover:text-white/70 transition-colors">FAQ</a></li>
            </ul>
          </div>
        </div>

        {/* Bottom row: copyright + DSGVO + parent company */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/5 pt-6">
          <p className="text-xs text-white/30">
            © {new Date().getFullYear()} Phonbot · Ein Produkt der{' '}
            <a
              href="https://mindrails.de"
              target="_blank"
              rel="noopener"
              className="text-white/50 hover:text-white/80 transition-colors underline decoration-white/20 hover:decoration-orange-400/60"
            >
              Mindrails UG
            </a>
            {' · Alle Rechte vorbehalten'}
          </p>
          <p className="text-xs text-white/30">
            DSGVO-konform · Server in Deutschland ·{' '}
            <a href="mailto:hello@phonbot.de" className="hover:text-white/50 transition-colors">hello@phonbot.de</a>
          </p>
        </div>
      </div>
    </footer>
  );
}
