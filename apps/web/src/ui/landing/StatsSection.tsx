import React from 'react';
import { useVisible, useCountUp } from './shared.js';

export function StatsSection() {
  const ref = React.useRef<HTMLElement>(null);
  const visible = useVisible(ref);
  const calls = useCountUp(500, 1800, visible);
  const businesses = useCountUp(50, 1400, visible);

  return (
    <section ref={ref} className="relative z-10 border-t border-b border-white/5 py-16 px-6">
      <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-10 text-center">
        <div>
          <p
            className="text-5xl font-extrabold mb-2 bg-clip-text text-transparent"
            style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
          >
            {calls}+
          </p>
          <p className="text-white/55 text-sm font-medium">Anrufe beantwortet</p>
        </div>
        <div>
          <p
            className="text-5xl font-extrabold mb-2 bg-clip-text text-transparent"
            style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
          >
            {businesses}+
          </p>
          <p className="text-white/55 text-sm font-medium">Stunden gespart</p>
        </div>
        <div>
          <p
            className="text-5xl font-extrabold mb-2 bg-clip-text text-transparent"
            style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
          >
            &lt; 2 Min
          </p>
          <p className="text-white/55 text-sm font-medium">Setup-Zeit</p>
        </div>
      </div>
    </section>
  );
}
