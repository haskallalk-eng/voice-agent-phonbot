import React from 'react';
import { STEPS, useVisible } from './shared.js';

export function HowSection() {
  const ref = React.useRef<HTMLElement>(null);
  const visible = useVisible(ref);
  return (
    <section ref={ref} id="how" className="relative z-10 px-6 py-20 max-w-5xl mx-auto">
      <div className="text-center mb-16">
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">So funktioniert's</h2>
      </div>
      <div className="relative flex flex-col md:flex-row items-start md:items-center gap-8 md:gap-0">
        <div
          className="hidden md:block absolute top-10 left-[calc(16.66%+1rem)] right-[calc(16.66%+1rem)] h-px"
          style={{ borderTop: '2px dashed rgba(249,115,22,0.3)' }}
          aria-hidden="true"
        />
        {STEPS.map((step, i) => (
          <div
            key={i}
            className="relative flex-1 flex flex-col items-center text-center px-4"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? 'none' : 'translateY(30px)',
              transition: `all 0.6s cubic-bezier(0.16,1,0.3,1) ${i * 0.18}s`,
            }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-extrabold text-white mb-5 relative z-10"
              style={{
                background: 'linear-gradient(135deg, #F97316, #06B6D4)',
                boxShadow: '0 0 24px rgba(249,115,22,0.4)',
              }}
            >
              {step.num}
            </div>
            <h3 className="font-bold text-lg mb-2">{step.title}</h3>
            <p className="text-white/55 text-sm leading-relaxed">{step.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
