import React from 'react';

type FinalCTAProps = {
  onGoToRegister: () => void;
};

export function FinalCTA({ onGoToRegister }: FinalCTAProps) {
  return (
    <section className="relative z-10 px-6 py-24 max-w-5xl mx-auto ambient-glow">
      <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-black/45 px-6 py-12 text-center shadow-[0_32px_140px_rgba(0,0,0,0.45)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_20%,rgba(249,115,22,0.20),transparent_28%),radial-gradient(ellipse_at_80%_35%,rgba(6,182,212,0.18),transparent_30%)]" />
        <img
          src="/brand/phonbot-crystal-icon-cropped.png"
          alt=""
          aria-hidden="true"
          className="relative mx-auto mb-5 h-24 w-24 object-contain"
          style={{ filter: 'drop-shadow(0 0 26px rgba(6,182,212,0.30)) drop-shadow(0 0 20px rgba(249,115,22,0.22))' }}
        />
        <h2 className="relative text-4xl sm:text-5xl font-extrabold mb-6 leading-tight">
          Dein Telefon. Jetzt intelligent.
        </h2>
        <p className="relative text-white/55 text-lg mb-8">
          Kostenlos starten — kein Abo, keine Bindung.
        </p>
        <button
          onClick={onGoToRegister}
          className="crystal-button relative text-lg font-semibold text-white rounded-full px-10 py-5 transition-all duration-300 hover:scale-105"
        >
          Kostenlos testen
        </button>
      </div>
    </section>
  );
}
