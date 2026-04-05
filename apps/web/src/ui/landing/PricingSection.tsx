import React, { useState } from 'react';
import { PLANS } from './shared.js';

type PricingSectionProps = {
  onGoToRegister: () => void;
};

export function PricingSection({ onGoToRegister }: PricingSectionProps) {
  const [yearly, setYearly] = useState(false);

  const PLANS_COMPUTED = PLANS.map((p) => ({
    ...p,
    displayPrice: yearly && p.yearlyPrice ? p.yearlyPrice : p.price,
  }));

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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto items-start">
        {PLANS_COMPUTED.map((plan) => (
          <div
            key={plan.name}
            className={`gradient-border relative glass rounded-2xl p-8 flex flex-col transition-all duration-300 hover:shadow-[0_0_40px_rgba(249,115,22,0.25)] hover:scale-[1.02] ${plan.highlight ? 'scale-[1.02]' : ''}`}
            style={
              plan.highlight
                ? {
                    border: '1px solid rgba(249,115,22,0.6)',
                    background: 'linear-gradient(160deg, rgba(249,115,22,0.14) 0%, rgba(6,182,212,0.10) 100%)',
                    boxShadow: '0 0 0 3px rgba(249,115,22,0.25), 0 0 60px rgba(249,115,22,0.20), 0 0 120px rgba(6,182,212,0.08)',
                  }
                : {}
            }
          >
            {plan.badge && (
              <div
                className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold text-white rounded-full px-3 py-1"
                style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
              >
                {plan.badge}
              </div>
            )}
            <div className="mb-6">
              <p className="text-white/60 text-sm font-medium mb-2">{plan.name}</p>
              <div className="flex items-end gap-1">
                <span className="text-5xl font-extrabold transition-all duration-300">{plan.displayPrice}</span>
                <span className="text-white/50 text-sm mb-1">{plan.period}</span>
              </div>
              {plan.name === 'Free' && (
                <p className="text-xs text-green-400/70 mt-1 font-medium">Für immer kostenlos</p>
              )}
            </div>

            <ul className="flex-1 space-y-3 mb-8">
              {plan.features.map((feat) => {
                const isHighlight = feat.startsWith('✦');
                const label = isHighlight ? feat.slice(2) : feat;
                return (
                  <li key={feat} className="flex items-center gap-2 text-sm">
                    {isHighlight ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" className="shrink-0 fancy-star"><defs><linearGradient id="fg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#F97316"/><stop offset="100%" stopColor="#06B6D4"/></linearGradient></defs><path d="M12 1C12.8 7.6 16.4 11.2 23 12c-6.6.8-10.2 4.4-11 11-.8-6.6-4.4-10.2-11-11C7.6 11.2 11.2 7.6 12 1z" fill="url(#fg)"/></svg>
                    ) : (
                      <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
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

            <button
              onClick={onGoToRegister}
              className="w-full rounded-xl px-6 py-3 font-semibold text-sm transition-all duration-300 hover:scale-[1.02]"
              style={
                plan.highlight
                  ? { background: 'linear-gradient(135deg, #F97316, #06B6D4)', color: '#fff' }
                  : { background: 'rgba(255,255,255,0.07)', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }
              }
            >
              {plan.cta}
            </button>

          </div>
        ))}
      </div>
    </section>
  );
}
