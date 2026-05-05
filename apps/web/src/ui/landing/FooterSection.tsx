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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8 mb-10">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <PhonbotBrand size="sm" />
            <p className="text-xs text-white/60 mt-2 leading-relaxed">Chipy — dein KI-Telefonassistent.<br />Immer erreichbar.</p>
          </div>

          {/* Produkt */}
          <div>
            <p className="text-xs font-semibold text-white/65 uppercase tracking-widest mb-3">Produkt</p>
            <ul className="space-y-2">
              <li><a href="/#features" className="text-sm text-white/60 hover:text-white/90 transition-colors">Features</a></li>
              <li><a href="/#demo" className="text-sm text-white/60 hover:text-white/90 transition-colors">Demo</a></li>
              <li><a href="/#preise" className="text-sm text-white/60 hover:text-white/90 transition-colors">Preise</a></li>
            </ul>
          </div>

          {/* Branchen */}
          <div>
            <p className="text-xs font-semibold text-white/65 uppercase tracking-widest mb-3">Branchen</p>
            <ul className="space-y-2">
              <li><a href="/friseur/" className="text-sm text-white/60 hover:text-white/90 transition-colors">Friseur</a></li>
              <li><a href="/handwerker/" className="text-sm text-white/60 hover:text-white/90 transition-colors">Handwerker</a></li>
              <li><a href="/reinigung/" className="text-sm text-white/60 hover:text-white/90 transition-colors">Reinigung</a></li>
              <li><a href="/restaurant/" className="text-sm text-white/60 hover:text-white/90 transition-colors">Restaurant</a></li>
              <li><a href="/autowerkstatt/" className="text-sm text-white/60 hover:text-white/90 transition-colors">Autowerkstatt</a></li>
              <li><a href="/selbststaendig/" className="text-sm text-white/60 hover:text-white/90 transition-colors">Selbstständige</a></li>
            </ul>
          </div>

          {/* Rechtliches */}
          <div>
            <p className="text-xs font-semibold text-white/65 uppercase tracking-widest mb-3">Rechtliches</p>
            <ul className="space-y-2">
              <li><a href="/datenschutz/" className="text-sm text-white/60 hover:text-white/90 transition-colors">Datenschutz</a></li>
              <li><a href="/avv/" className="text-sm text-white/60 hover:text-white/90 transition-colors">AVV</a></li>
              <li><a href="/sub-processors/" className="text-sm text-white/60 hover:text-white/90 transition-colors">Sub-Processoren</a></li>
              <li><a href="/impressum/" className="text-sm text-white/60 hover:text-white/90 transition-colors">Impressum</a></li>
              <li><a href="/agb/" className="text-sm text-white/60 hover:text-white/90 transition-colors">AGB</a></li>
            </ul>
          </div>

          {/* Kontakt */}
          <div>
            <p className="text-xs font-semibold text-white/65 uppercase tracking-widest mb-3">Kontakt</p>
            <ul className="space-y-2">
              <li><button type="button" onClick={onGoToContact} className="text-sm text-white/60 hover:text-white/90 transition-colors">Anfragen</button></li>
              <li><a href="/#faq" className="text-sm text-white/60 hover:text-white/90 transition-colors">FAQ</a></li>
            </ul>
          </div>
        </div>

        {/* Bottom row: copyright + DSGVO + parent company */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/5 pt-6">
          <p className="text-xs text-white/55">
            © {new Date().getFullYear()} Phonbot · Ein Produkt von{' '}
            <a
              href="https://mindrails.de"
              target="_blank"
              rel="noopener"
              className="text-white/75 hover:text-white/95 transition-colors underline decoration-white/30 hover:decoration-orange-400/60"
            >
              Hans Ulrich Waier
            </a>
            {' (Einzelunternehmer) · Alle Rechte vorbehalten'}
          </p>
          <p className="text-xs text-white/55">
            DSGVO-fokussiert · AVV verfügbar ·{' '}
            <a href="mailto:info@phonbot.de" className="text-white/75 hover:text-white/95 transition-colors">info@phonbot.de</a>
          </p>
        </div>
      </div>
    </footer>
  );
}
