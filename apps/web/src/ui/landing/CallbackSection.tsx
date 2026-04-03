import React from 'react';
import { useVisible } from './shared.js';

export function CallbackSection() {
  const [phone, setPhone] = React.useState('');
  const [name, setName] = React.useState('');
  const [state, setState] = React.useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const ref = React.useRef<HTMLElement>(null);
  const visible = useVisible(ref);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;
    setState('loading');
    try {
      const res = await fetch('/api/outbound/website-callback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), name: name.trim() || undefined }),
      });
      if (!res.ok) throw new Error();
      setState('success');
    } catch {
      setState('error');
    }
  }

  return (
    <section
      ref={ref}
      id="callback"
      className="relative z-10 px-6 py-24"
      style={{ opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(32px)', transition: 'opacity 0.7s ease, transform 0.7s ease' }}
    >
      <div className="max-w-2xl mx-auto">
        {/* Card */}
        <div
          className="relative rounded-3xl overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(15,15,28,0.98), rgba(10,10,20,0.98))',
            border: '1px solid rgba(249,115,22,0.25)',
            boxShadow: '0 0 80px rgba(249,115,22,0.12), 0 0 160px rgba(6,182,212,0.06), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          {/* Glow blob */}
          <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.15) 0%, transparent 70%)' }} />
          <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.10) 0%, transparent 70%)' }} />

          <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-0">
            {/* Left — visual side */}
            <div className="p-8 sm:p-10 flex flex-col justify-center">
              {/* Phone icon with ring animation */}
              <div className="relative w-16 h-16 mb-6">
                <div className="absolute inset-0 rounded-full animate-ping"
                  style={{ background: 'rgba(249,115,22,0.15)', animationDuration: '2s' }} />
                <div className="absolute inset-1 rounded-full animate-ping"
                  style={{ background: 'rgba(249,115,22,0.1)', animationDuration: '2s', animationDelay: '0.5s' }} />
                <div className="relative w-full h-full rounded-full flex items-center justify-center text-2xl"
                  style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.3), rgba(6,182,212,0.2))' }}>
                  📞
                </div>
              </div>

              <h2 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight mb-3">
                Chippy ruft dich<br />
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
                  in 60 Sekunden
                </span>{' '}an
              </h2>
              <p className="text-white/45 text-sm leading-relaxed mb-6">
                Erfahre live wie ein KI-Agent klingt — kostenlos, ohne Risiko, direkt auf dein Handy.
              </p>

              {/* Trust signals */}
              <div className="space-y-2">
                {['Kein Spam, kein Sales-Druck', 'Funktioniert auf jede Handynummer', 'Kostenlos & unverbindlich'].map(t => (
                  <div key={t} className="flex items-center gap-2 text-xs text-white/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500/70 shrink-0" />
                    {t}
                  </div>
                ))}
              </div>
            </div>

            {/* Right — form side */}
            <div className="p-8 sm:p-10 sm:border-l" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              {state === 'success' ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
                    style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)' }}>
                    ✓
                  </div>
                  <div>
                    <p className="text-green-300 font-bold text-lg">Chippy ruft dich an!</p>
                    <p className="text-white/40 text-sm mt-1">Bitte hab dein Telefon bereit — der Anruf kommt gleich.</p>
                  </div>
                  <button onClick={() => setState('idle')} className="text-xs text-white/30 hover:text-white/50 transition-colors mt-2">
                    Nochmal versuchen
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4 h-full flex flex-col justify-center">
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-wide">Dein Name</label>
                    <input
                      type="text"
                      placeholder="Max Mustermann"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-xl bg-white/[0.06] border border-white/10 px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-wide">Telefonnummer *</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-sm select-none">📱</span>
                      <input
                        type="tel"
                        placeholder="+49 123 456789"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                        className="w-full rounded-xl bg-white/[0.06] border border-white/10 pl-10 pr-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40 transition-all"
                      />
                    </div>
                  </div>
                  {state === 'error' && (
                    <p className="text-red-400 text-xs bg-red-500/10 rounded-lg px-3 py-2">
                      ⚠️ Etwas ist schiefgelaufen — bitte versuche es erneut.
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={state === 'loading' || !phone.trim()}
                    className="w-full rounded-xl px-6 py-3.5 font-bold text-white text-sm disabled:opacity-40 transition-all duration-300 hover:scale-[1.02]"
                    style={{
                      background: 'linear-gradient(135deg, #F97316, #06B6D4)',
                      boxShadow: state !== 'loading' && phone.trim() ? '0 0 32px rgba(249,115,22,0.35)' : 'none',
                    }}
                  >
                    {state === 'loading' ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Verbinde Chippy…
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <span>Jetzt kostenlos anrufen lassen</span>
                        <span>→</span>
                      </span>
                    )}
                  </button>
                  <p className="text-xs text-white/20 text-center">Einmaliger Demo-Anruf · Keine Kosten · Keine Weitergabe</p>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
