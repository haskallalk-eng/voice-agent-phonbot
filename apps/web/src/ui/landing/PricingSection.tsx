import { useState } from 'react';
import { PLANS } from './shared.js';

type PricingSectionProps = {
  onGoToRegister: () => void;
};

export function PricingSection({ onGoToRegister }: PricingSectionProps) {
  const [yearly, setYearly] = useState(false);

  // Separate plans into layout groups
  const freePlan = PLANS.find(p => p.name === 'Free')!;
  const nummerPlan = PLANS.find(p => p.name === 'Nummer')!;
  const mainPlans = PLANS.filter(p => !['Free', 'Nummer'].includes(p.name)).map(p => ({
    ...p,
    displayPrice: yearly && p.yearlyPrice ? p.yearlyPrice : p.price,
  }));

  // Feature list renderer
  function FeatureList({ features, small }: { features: string[]; small?: boolean }) {
    return (
      <ul className={`space-y-${small ? '2' : '3'}`}>
        {features.map((feat) => {
          const isHighlight = feat.startsWith('✦');
          const label = isHighlight ? feat.slice(2) : feat;
          return (
            <li key={feat} className={`flex items-center gap-2 ${small ? 'text-xs' : 'text-sm'}`}>
              {isHighlight ? (
                <svg width="14" height="14" viewBox="0 0 24 24" className="shrink-0"><defs><linearGradient id="fg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#F97316"/><stop offset="100%" stopColor="#06B6D4"/></linearGradient></defs><path d="M12 1C12.8 7.6 16.4 11.2 23 12c-6.6.8-10.2 4.4-11 11-.8-6.6-4.4-10.2-11-11C7.6 11.2 11.2 7.6 12 1z" fill="url(#fg)"/></svg>
              ) : (
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>✓</span>
              )}
              <span className={isHighlight ? 'font-semibold bg-clip-text text-transparent' : 'text-white/70'}
                style={isHighlight ? { backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' } : undefined}>
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section id="preise" className="relative z-10 px-6 py-20 max-w-6xl mx-auto ambient-glow">
      <div className="text-center mb-14">
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">Einfache Preise. Starte kostenlos.</h2>
      </div>

      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-4 mb-10">
        <span className={`text-sm font-medium ${!yearly ? 'text-white' : 'text-white/40'}`}>Monatlich</span>
        <button
          onClick={() => setYearly(!yearly)}
          className="relative w-14 h-7 rounded-full transition-all duration-300"
          style={{ background: yearly ? 'linear-gradient(135deg, #F97316, #06B6D4)' : 'rgba(255,255,255,0.1)' }}
        >
          <span
            className="absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-all duration-300"
            style={{ transform: yearly ? 'translateX(28px)' : 'translateX(0)' }}
          />
        </button>
        <span className={`text-sm font-medium ${yearly ? 'text-white' : 'text-white/40'}`}>
          Jährlich <span className="text-green-400 text-xs font-bold">-20%</span>
        </span>
      </div>

      {/* ── FREE PLAN — wide banner at top ── */}
      <div className="glass rounded-2xl p-6 mb-8 flex flex-col sm:flex-row items-center justify-between gap-4 border border-white/10">
        <div className="flex-1">
          <div className="flex items-center gap-4 mb-2 sm:mb-0">
            <div>
              <p className="text-lg font-bold text-white">{freePlan.name}</p>
              <p className="text-xs text-green-400/70 font-medium">Für immer kostenlos</p>
            </div>
            <div className="hidden sm:flex items-center gap-6 ml-6">
              {freePlan.features.map(f => (
                <span key={f} className="text-sm text-white/50 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/30" />
                  {f}
                </span>
              ))}
            </div>
          </div>
          <p className="text-xs text-white/30 mt-1 sm:ml-0">
            Für eine eigene Telefonnummer → upgraden ab 8,99€/Mo
          </p>
        </div>
        <button
          onClick={onGoToRegister}
          className="rounded-xl px-6 py-2.5 text-sm font-semibold text-white whitespace-nowrap transition-all duration-200 hover:scale-105 shrink-0"
          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}
        >
          {freePlan.cta}
        </button>
      </div>

      {/* ── 3 MAIN PLANS — side by side ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto items-start mb-8">
        {mainPlans.map((plan) => {
          const isPopular = plan.name === 'Pro';
          return (
            <div
              key={plan.name}
              className={`gradient-border relative glass rounded-2xl p-8 flex flex-col transition-all duration-300 hover:shadow-[0_0_40px_rgba(249,115,22,0.25)] hover:scale-[1.02] ${isPopular ? 'scale-[1.02]' : ''}`}
              style={
                isPopular
                  ? {
                      border: '1px solid rgba(249,115,22,0.6)',
                      background: 'linear-gradient(160deg, rgba(249,115,22,0.14) 0%, rgba(6,182,212,0.10) 100%)',
                      boxShadow: '0 0 0 3px rgba(249,115,22,0.25), 0 0 60px rgba(249,115,22,0.20), 0 0 120px rgba(6,182,212,0.08)',
                    }
                  : {}
              }
            >
              {isPopular && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold text-white rounded-full px-3 py-1"
                  style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
                >
                  Empfohlen
                </div>
              )}
              <div className="mb-6">
                <p className="text-white/60 text-sm font-medium mb-2">{plan.name}</p>
                <div className="flex items-end gap-1">
                  <span className="text-5xl font-extrabold transition-all duration-300">{plan.displayPrice}</span>
                  <span className="text-white/50 text-sm mb-1">{plan.period}</span>
                </div>
              </div>

              <div className="flex-1 mb-8">
                <FeatureList features={plan.features} />
              </div>

              <button
                onClick={onGoToRegister}
                className="w-full rounded-xl px-6 py-3 font-semibold text-sm transition-all duration-300 hover:scale-[1.02]"
                style={
                  isPopular
                    ? { background: 'linear-gradient(135deg, #F97316, #06B6D4)', color: '#fff' }
                    : { background: 'rgba(255,255,255,0.07)', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }
                }
              >
                {plan.cta}
              </button>
            </div>
          );
        })}
      </div>

      {/* ── NUMMER TEASER — subtle hint, not a full plan card ── */}
      <p className="text-center text-sm text-white/40 mt-6 max-w-xl mx-auto">
        Eigene Telefonnummer ab 8,99€/Mo mit 70 inkl. Minuten — nach Registrierung im Dashboard aktivierbar.
      </p>
    </section>
  );
}
