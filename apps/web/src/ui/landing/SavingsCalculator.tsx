import React from 'react';

type SavingsCalculatorProps = {
  onCTA: () => void;
};

export function SavingsCalculator({ onCTA }: SavingsCalculatorProps) {
  const [anrufe, setAnrufe] = React.useState(20);
  const [dauer, setDauer] = React.useState(4);
  const [stundenlohn, setStundenlohn] = React.useState(20);
  const [nachbearbeitung, setNachbearbeitung] = React.useState(5);
  const [botQuote, setBotQuote] = React.useState(65);

  const gesamtMinProTag = anrufe * (dauer + nachbearbeitung);
  const botMinProTag = gesamtMinProTag * (botQuote / 100);
  const gesparteMinProMonat = botMinProTag * 22;
  const gesparteStunden = gesparteMinProMonat / 60;
  const gesparteKosten = gesparteStunden * stundenlohn;
  const phonbotKosten = anrufe <= 5 ? 0 : anrufe <= 20 ? 49 : anrufe <= 50 ? 149 : 299;
  const nettoErsparnis = gesparteKosten - phonbotKosten;
  const roi = phonbotKosten > 0 ? Math.round((nettoErsparnis / phonbotKosten) * 100) : 0;

  const sliders = [
    { label: 'Anrufe pro Tag', value: anrufe, set: setAnrufe, min: 1, max: 100, step: 1, display: `${anrufe}` },
    { label: 'Ø Anrufdauer', value: dauer, set: setDauer, min: 1, max: 15, step: 1, display: `${dauer} min` },
    { label: 'Stundenlohn MA', value: stundenlohn, set: setStundenlohn, min: 10, max: 80, step: 1, display: `${stundenlohn} €/h` },
    { label: 'Nachbearbeitung', value: nachbearbeitung, set: setNachbearbeitung, min: 0, max: 30, step: 1, display: `${nachbearbeitung} min` },
    { label: 'Bot löst alleine', value: botQuote, set: setBotQuote, min: 30, max: 90, step: 1, display: `${botQuote}%` },
  ];

  return (
    <section className="relative z-10 px-6 py-20 max-w-5xl mx-auto">
      <div className="text-center mb-12">
        <span className="inline-block text-xs font-semibold uppercase tracking-widest text-orange-400/80 mb-3 px-3 py-1 rounded-full border border-orange-500/20 bg-orange-500/5">Ehrlicher ROI-Rechner</span>
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-3">Was sparst du wirklich?</h2>
        <p className="text-white/45 text-base">Schieb die Regler — wir zeigen dir die echten Zahlen, auch wenn sie noch nicht passen.</p>
      </div>

      <div
        className="rounded-3xl overflow-hidden"
        style={{
          border: '1px solid rgba(249,115,22,0.2)',
          background: 'linear-gradient(135deg, rgba(15,15,28,0.95), rgba(10,10,20,0.95))',
          boxShadow: '0 0 80px rgba(249,115,22,0.08), 0 0 160px rgba(6,182,212,0.04)',
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-5">
          {/* LEFT — Sliders (3 cols) */}
          <div className="lg:col-span-3 p-8 space-y-5" style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-6">Deine Zahlen</p>
            {sliders.map((s) => {
              const pct = ((s.value - s.min) / (s.max - s.min)) * 100;
              return (
                <div key={s.label}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-white/60">{s.label}</span>
                    <span className="text-sm font-bold font-mono px-2 py-0.5 rounded-lg text-orange-400"
                      style={{ background: 'rgba(249,115,22,0.1)' }}>
                      {s.display}
                    </span>
                  </div>
                  <div className="relative">
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-150"
                        style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #F97316, #06B6D4)' }} />
                    </div>
                    <input
                      type="range" min={s.min} max={s.max} step={s.step} value={s.value}
                      onChange={(e) => s.set(Number(e.target.value))}
                      className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
                      style={{ margin: 0 }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* RIGHT — Results (2 cols) */}
          <div className="lg:col-span-2 p-8 flex flex-col justify-between">
            <div className="space-y-5">
              <p className="text-xs font-semibold text-white/30 uppercase tracking-widest">Dein Ergebnis</p>

              {/* Hours */}
              <div className="rounded-2xl p-4" style={{ background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.15)' }}>
                <p className="text-3xl font-extrabold bg-clip-text text-transparent leading-none mb-0.5"
                  style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
                  {gesparteStunden.toFixed(0)} Std
                </p>
                <p className="text-xs text-white/40 font-medium">gespart pro Monat</p>
              </div>

              {/* Cost */}
              <div className="rounded-2xl p-4 bg-white/[0.04]" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-2xl font-extrabold text-white leading-none mb-0.5">
                  {gesparteKosten.toLocaleString('de-DE', { maximumFractionDigits: 0 })} €
                </p>
                <p className="text-xs text-white/40 font-medium">Personalkosten gespart</p>
              </div>

              {/* Net / ROI */}
              <div className={`rounded-2xl p-4 ${nettoErsparnis > 0 ? '' : ''}`}
                style={{
                  background: nettoErsparnis > 0 ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)',
                  border: `1px solid ${nettoErsparnis > 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                }}>
                <div className="flex items-end justify-between">
                  <div>
                    <p className={`text-2xl font-extrabold leading-none mb-0.5 ${nettoErsparnis > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {nettoErsparnis > 0 ? '+' : ''}{nettoErsparnis.toLocaleString('de-DE', { maximumFractionDigits: 0 })} €
                    </p>
                    <p className="text-xs font-medium" style={{ color: nettoErsparnis > 0 ? 'rgba(134,239,172,0.7)' : 'rgba(252,165,165,0.7)' }}>
                      Netto nach Phonbot ({phonbotKosten} €/Mo)
                    </p>
                  </div>
                  {phonbotKosten > 0 && nettoErsparnis > 0 && (
                    <div className="text-right">
                      <p className="text-sm font-bold text-green-400">{roi}%</p>
                      <p className="text-[10px] text-white/30">ROI</p>
                    </div>
                  )}
                </div>
              </div>

              {nettoErsparnis <= 0 && (
                <p className="text-xs text-white/30 leading-relaxed">
                  Noch nicht rentabel? Mehr Anrufe pro Tag oder höhere Bot-Quote — dann klappt's.
                </p>
              )}
            </div>

            <button
              onClick={onCTA}
              className="mt-6 w-full rounded-xl px-6 py-3.5 font-bold text-white transition-all duration-300 hover:scale-[1.02]"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)', boxShadow: '0 0 24px rgba(249,115,22,0.3)' }}
            >
              Kostenlos testen →
            </button>
            <p className="text-[10px] text-white/20 text-center mt-2">100 Freiminuten · Keine Kreditkarte nötig</p>
          </div>
        </div>
      </div>
    </section>
  );
}
