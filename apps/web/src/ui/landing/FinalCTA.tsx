import React from 'react';

type FinalCTAProps = {
  onGoToRegister: () => void;
};

export function FinalCTA({ onGoToRegister }: FinalCTAProps) {
  return (
    <section className="relative z-10 px-6 py-24 text-center max-w-2xl mx-auto ambient-glow">
      <h2 className="text-4xl sm:text-5xl font-extrabold mb-6 leading-tight">
        Dein Telefon. Jetzt intelligent.
      </h2>
      <p className="text-white/55 text-lg mb-8">
        Kostenlos starten — kein Abo, keine Bindung.
      </p>
      <button
        onClick={onGoToRegister}
        className="text-lg font-semibold text-white rounded-full px-10 py-5 transition-all duration-300 hover:shadow-[0_0_50px_rgba(249,115,22,0.6)] hover:scale-105"
        style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
      >
        Kostenlos testen
      </button>
    </section>
  );
}
