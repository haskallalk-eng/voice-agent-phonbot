import React from 'react';
import { useVisible } from './shared.js';

type SavingsCalculatorProps = { onCTA: () => void };

function Num({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [d, setD] = React.useState(value);
  React.useEffect(() => {
    const s = d, diff = value - s;
    if (!diff) return;
    const t0 = Date.now();
    const tick = () => { const p = Math.min((Date.now() - t0) / 280, 1); setD(Math.round(s + diff * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }, [value]);
  return <>{d.toLocaleString('de-DE')}{suffix}</>;
}

export function SavingsCalculator({ onCTA }: SavingsCalculatorProps) {
  const [anrufe, setAnrufe] = React.useState(15);
  const [dauer, setDauer] = React.useState(4);
  const [lohn, setLohn] = React.useState(22);
  const [nacharbeit, setNacharbeit] = React.useState(5);
  const [quote, setQuote] = React.useState(60);
  const ref = React.useRef<HTMLElement>(null);
  const vis = useVisible(ref);

  const botMin = anrufe * (dauer + nacharbeit) * (quote / 100) * 22;
  const stunden = Math.round(botMin / 60);
  const personal = Math.round((botMin / 60) * lohn);
  const plan = anrufe <= 5 ? 0 : anrufe <= 20 ? 49 : anrufe <= 50 ? 149 : 299;
  const planName = plan === 0 ? 'Free' : plan === 49 ? 'Starter' : plan === 149 ? 'Pro' : 'Agency';
  const netto = personal - plan;
  const roi = plan > 0 ? Math.round((netto / plan) * 100) : 0;

  const sliders = [
    { l: 'Anrufe / Tag', v: anrufe, s: setAnrufe, min: 1, max: 100, step: 1, d: `${anrufe}` },
    { l: 'Gesprächsdauer', v: dauer, s: setDauer, min: 1, max: 15, step: 1, d: `${dauer} min` },
    { l: 'Stundenlohn', v: lohn, s: setLohn, min: 10, max: 80, step: 1, d: `${lohn} €` },
    { l: 'Nacharbeit', v: nacharbeit, s: setNacharbeit, min: 0, max: 30, step: 1, d: `${nacharbeit} min` },
    { l: 'Bot-Quote', v: quote, s: setQuote, min: 10, max: 95, step: 5, d: `${quote} %` },
  ];

  return (
    <section
      ref={ref}
      className="relative z-10 px-6 py-24 max-w-4xl mx-auto ambient-glow-alt ambient-glow"
      style={{ opacity: vis ? 1 : 0, transform: vis ? 'none' : 'translateY(20px)', transition: 'all 0.5s cubic-bezier(.4,0,.2,1)' }}
    >
      <div className="text-center mb-14">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-orange-400/60 uppercase mb-4">ROI-Rechner</p>
        <h2 className="text-3xl sm:text-[40px] font-extrabold text-white leading-tight">Lohnt sich <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>Phonbot</span> für dich?</h2>
      </div>

      {/* Glass card */}
      <div className="relative rounded-3xl overflow-hidden">
        <div className="absolute inset-0 backdrop-blur-[48px]" style={{ background: 'rgba(255,255,255,0.03)' }} />
        <div className="absolute inset-0 rounded-3xl" style={{ border: '1px solid rgba(255,255,255,0.07)' }} />
        <div className="absolute -top-40 -left-40 w-80 h-80 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.06) 0%, transparent 70%)' }} />
        <div className="absolute -bottom-40 -right-40 w-80 h-80 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.04) 0%, transparent 70%)' }} />

        <div className="relative grid grid-cols-1 lg:grid-cols-2">
          {/* Sliders */}
          <div className="p-8 sm:p-10 lg:border-r" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            <div className="space-y-7">
              {sliders.map((sl) => {
                const pct = ((sl.v - sl.min) / (sl.max - sl.min)) * 100;
                return (
                  <div key={sl.l}>
                    <div className="flex items-baseline justify-between mb-3">
                      <span className="text-sm text-white/45 tracking-wide">{sl.l}</span>
                      <span className="text-lg font-bold text-white tracking-tight tabular-nums">{sl.d}</span>
                    </div>
                    <div className="relative h-7 flex items-center group cursor-pointer">
                      <div className="absolute inset-x-0 h-[3px] rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
                      <div className="absolute left-0 h-[3px] rounded-full transition-[width] duration-75"
                        style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #F97316, #06B6D4)' }} />
                      <div className="absolute w-4 h-4 rounded-full transition-all duration-75 pointer-events-none group-hover:scale-125"
                        style={{
                          left: `calc(${pct}% - 8px)`,
                          background: 'rgba(255,255,255,0.9)',
                          backdropFilter: 'blur(8px)',
                          boxShadow: '0 0 12px rgba(249,115,22,0.4), 0 1px 3px rgba(0,0,0,0.4)',
                        }} />
                      <input type="range" min={sl.min} max={sl.max} step={sl.step} value={sl.v}
                        onChange={(e) => sl.s(Number(e.target.value))}
                        className="absolute inset-0 w-full opacity-0 cursor-pointer" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Results */}
          <div className="p-8 sm:p-10 flex flex-col justify-between">
            <div>
              {/* Hero number */}
              <div className="mb-10">
                <p className="text-xs text-white/25 uppercase tracking-[0.15em] font-medium mb-3">Netto-Ersparnis / Monat</p>
                <p className={`text-[56px] sm:text-[64px] font-extrabold leading-[0.9] tracking-tighter transition-colors duration-300 ${
                  netto > 0 ? '' : netto === 0 ? 'text-white/30' : 'text-red-400'
                }`}
                  style={netto > 0 ? { backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)', WebkitBackgroundClip: 'text', color: 'transparent' } : undefined}
                >
                  <Num value={netto} />
                  <span className="text-[32px] sm:text-[36px] ml-1 font-semibold" style={netto > 0 ? { backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)', WebkitBackgroundClip: 'text', color: 'transparent' } : undefined}>€</span>
                </p>
                {plan > 0 && (
                  <p className="text-xs text-white/20 mt-3 tracking-wide">
                    {planName}-Plan ({plan} €/Mo)
                    {netto > 0 && <span className="text-orange-400/40 ml-2">{roi}% ROI</span>}
                  </p>
                )}
              </div>

              {/* Breakdown */}
              <div className="space-y-0 rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span className="text-[13px] text-white/35 tracking-wide">Zeitersparnis</span>
                  <span className="text-[15px] text-white/80 font-semibold tracking-tight tabular-nums"><Num value={stunden} /> h / Monat</span>
                </div>
                <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span className="text-[13px] text-white/35 tracking-wide">Personalkosten gespart</span>
                  <span className="text-[15px] text-white/80 font-semibold tracking-tight tabular-nums"><Num value={personal} /> €</span>
                </div>
                <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span className="text-[13px] text-white/35 tracking-wide">Chipy ({planName})</span>
                  <span className="text-[15px] text-white/35 font-semibold tracking-tight tabular-nums">–{plan} €</span>
                </div>
                <div className="flex items-center justify-between px-5 py-3.5">
                  <span className="text-[13px] text-white/50 font-medium tracking-wide">Dein Vorteil</span>
                  <span className={`text-[15px] font-bold tracking-tight tabular-nums ${netto >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {netto >= 0 ? '+' : ''}<Num value={netto} /> €
                  </span>
                </div>
              </div>

              {/* Context hint */}
              <p className="text-[11px] text-white/15 mt-4 leading-relaxed text-center">
                {netto > 200
                  ? 'Entspricht ca. ' + Math.round(netto / lohn) + ' Stunden die dein Team für wichtigere Aufgaben nutzen kann.'
                  : netto > 0
                    ? 'Schon ab wenigen Anrufen pro Tag rechnet sich Chipy für dein Business.'
                    : 'Starte kostenlos und teste ob die Bot-Quote für dein Business passt.'}
              </p>
            </div>

            {/* CTA */}
            <button
              onClick={onCTA}
              className="mt-6 w-full rounded-2xl px-6 py-4 text-sm font-semibold text-white transition-all duration-200 hover:scale-[1.02] cursor-pointer"
              style={{
                background: 'linear-gradient(135deg, #F97316, #06B6D4)',
                boxShadow: '0 4px 24px rgba(249,115,22,0.2)',
              }}
            >
              Kostenlos testen
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
