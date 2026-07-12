import React from 'react';
import { FEATURES } from './shared.js';

export function FeaturesSection() {
  return (
    <section id="features" className="relative z-10 px-6 py-24 max-w-6xl mx-auto ambient-glow">
      <div className="text-center mb-16">
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-3">Was <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, var(--crystal-warm), var(--crystal-cyan))' }}>Phonbot</span> für dich erledigt</h2>
        <p className="text-white/50 text-base max-w-lg mx-auto">Sechs Gründe warum du nie wieder einen Anruf verpasst.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {FEATURES.map((f, i) => (
          <div
            key={f.title}
            className="group relative overflow-hidden rounded-2xl p-6 border border-white/[0.08] bg-black/35
              shadow-[0_18px_70px_rgba(0,0,0,0.28)]
              hover:border-cyan-300/25 hover:bg-white/[0.045]
              transition-all duration-300"
            style={{
              animationDelay: `${i * 80}ms`,
            }}
          >
            <div className="crystal-page-glow crystal-page-glow-cyan pointer-events-none absolute -right-16 -top-16 h-32 w-32 bg-cyan-400/10 transition-opacity duration-300 group-hover:opacity-100 opacity-40" />
            <div className="crystal-page-glow pointer-events-none absolute -bottom-20 left-4 h-32 w-32 bg-orange-500/10 transition-opacity duration-300 group-hover:opacity-100 opacity-30" />
            {/* Icon */}
            <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4
              bg-gradient-to-br from-orange-500/15 to-cyan-500/10 border border-orange-500/20
              group-hover:border-orange-500/40 group-hover:shadow-[0_0_16px_rgba(255,91,10,0.15)]
              transition-all duration-300">
              <f.Icon size={20} className="text-orange-400/80 group-hover:text-orange-300 transition-colors" />
            </div>
            {/* Text */}
            <h3 className="font-semibold text-[15px] text-white mb-1.5 group-hover:text-orange-50 transition-colors">{f.title}</h3>
            <p className="text-white/45 text-sm leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
