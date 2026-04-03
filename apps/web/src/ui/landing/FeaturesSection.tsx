import React from 'react';
import { FEATURES } from './shared.js';

export function FeaturesSection() {
  return (
    <section id="features" className="relative z-10 px-6 py-24 max-w-5xl mx-auto">
      <div className="text-center mb-16">
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-3">Was Phonbot für dich erledigt</h2>
        <p className="text-white/50 text-base max-w-lg mx-auto">Sechs Gründe warum du nie wieder einen Anruf verpasst.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {FEATURES.map((f, i) => (
          <div
            key={f.title}
            className="group relative rounded-2xl p-6 border border-white/[0.06] bg-white/[0.02]
              hover:border-orange-500/30 hover:bg-white/[0.04]
              transition-all duration-300"
            style={{
              animationDelay: `${i * 80}ms`,
            }}
          >
            {/* Icon */}
            <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4
              bg-gradient-to-br from-orange-500/15 to-cyan-500/10 border border-orange-500/20
              group-hover:border-orange-500/40 group-hover:shadow-[0_0_16px_rgba(249,115,22,0.15)]
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
