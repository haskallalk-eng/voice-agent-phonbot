import React from 'react';
import { FAQ_ITEMS, useVisible } from './shared.js';

export function FaqSection() {
  const [open, setOpen] = React.useState<number | null>(null);
  const ref = React.useRef<HTMLElement>(null);
  const visible = useVisible(ref);

  return (
    <section ref={ref} id="faq" className="relative z-10 px-6 py-20 max-w-3xl mx-auto ambient-glow-alt ambient-glow">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-3">Häufige Fragen</h2>
        <p className="text-white/50 text-base">Alles was du wissen musst — kurz und ehrlich.</p>
      </div>
      <div className="space-y-3">
        {FAQ_ITEMS.map((item, i) => (
          <div
            key={i}
            className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden transition-all duration-300"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? 'none' : 'translateY(20px)',
              transition: `opacity 0.5s ease ${i * 0.05}s, transform 0.5s ease ${i * 0.05}s, background 0.2s`,
              background: open === i ? 'rgba(249,115,22,0.05)' : undefined,
              borderColor: open === i ? 'rgba(249,115,22,0.2)' : undefined,
            }}
          >
            <button
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
              className="w-full flex items-center justify-between px-6 py-4 text-left group"
            >
              <span className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors pr-4">{item.q}</span>
              <span
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white/40 group-hover:text-white/60 transition-all duration-200"
                style={{ transform: open === i ? 'rotate(45deg)' : 'none' }}
              >
                +
              </span>
            </button>
            {open === i && (
              <div className="px-6 pb-5">
                <p className="text-sm text-white/55 leading-relaxed">{item.a}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
