import React from 'react';

type FinalCTAProps = {
  onGoToRegister: () => void;
};

export function FinalCTA({ onGoToRegister }: FinalCTAProps) {
  return (
    <section className="relative z-10 px-6 py-24 max-w-5xl mx-auto ambient-glow">
      <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-black/45 px-6 py-12 text-center shadow-[0_32px_140px_rgba(0,0,0,0.45)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_20%,rgba(255,91,10,0.20),transparent_28%),radial-gradient(ellipse_at_80%_35%,rgba(32,217,255,0.18),transparent_30%)]" />
        {/* Chipys leuchtende Augen — aus dem App-Icon extrahiert (sauberes
            Alpha, kein Videorauschen), komponieren randlos auf das Panel. */}
        <img
          src="/media/chipy-eyes.png"
          alt=""
          aria-hidden="true"
          className="relative mx-auto mb-6 h-16 w-auto object-contain sm:h-20"
          style={{
            filter: 'drop-shadow(0 0 22px rgba(32,217,255,0.28)) drop-shadow(0 0 18px rgba(255,91,10,0.22))',
          }}
        />
        <h2 className="relative text-4xl sm:text-5xl font-extrabold mb-6 leading-tight">
          Dein Salon-Telefon. Jetzt intelligent.
        </h2>
        <p className="relative text-white/65 text-lg mb-8">
          Kostenlos starten — während du schneidest, bucht Phonbot.
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
