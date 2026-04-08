import React from 'react';
import { FoxLogo } from '../FoxLogo.js';
import { IconPrivacy, IconBolt, IconCheckCircle } from '../PhonbotIcons.js';
import { useVisible } from './shared.js';

export function CallbackSection() {
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [name, setName] = React.useState('');
  const [state, setState] = React.useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const ref = React.useRef<HTMLElement>(null);
  const visible = useVisible(ref);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim() || !email.trim()) return;
    setState('loading');
    try {
      const res = await fetch('/api/outbound/website-callback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), email: email.trim(), name: name.trim() || undefined }),
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
      className="relative z-10 px-6 py-24 ambient-glow"
      style={{ opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(32px)', transition: 'opacity 0.7s ease, transform 0.7s ease' }}
    >
      <div className="max-w-3xl mx-auto">
        {/* Section intro */}
        <div className="text-center mb-10">
          <p className="text-xs font-semibold tracking-widest text-orange-400/80 uppercase mb-3">Live erleben</p>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight">
            Hör selbst, wie{' '}
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
              Chipy
            </span>{' '}klingt
          </h2>
          <p className="text-white/40 text-sm mt-3 max-w-lg mx-auto">
            Ein 30-Sekunden-Anruf sagt mehr als jede Demo-Seite. Chipy ruft dich an und zeigt dir live, wie natürlich ein KI-Agent klingt.
          </p>
        </div>

        {/* Card */}
        <div
          className="relative rounded-3xl overflow-hidden"
          style={{
            background: 'linear-gradient(160deg, rgba(20,20,32,0.98), rgba(12,12,22,0.98))',
            border: '1px solid rgba(249,115,22,0.2)',
            boxShadow: '0 0 60px rgba(249,115,22,0.08), 0 0 120px rgba(6,182,212,0.04)',
          }}
        >
          {/* Glow blobs */}
          <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.12) 0%, transparent 70%)' }} />
          <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 70%)' }} />

          <div className="relative grid grid-cols-1 sm:grid-cols-5 gap-0">
            {/* Left — visual (3/5 width) */}
            <div className="sm:col-span-2 p-8 sm:p-10 flex flex-col items-center sm:items-start justify-center text-center sm:text-left">
              {/* Chipy avatar with pulse */}
              <div className="relative mb-6">
                <div className="absolute inset-0 rounded-full animate-ping opacity-20"
                  style={{ background: 'rgba(249,115,22,0.3)', animationDuration: '2.5s' }} />
                <div className="relative w-20 h-20 rounded-full flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.2), rgba(6,182,212,0.15))', border: '1px solid rgba(249,115,22,0.2)' }}>
                  <FoxLogo size={48} glow />
                </div>
              </div>

              <h3 className="text-xl font-bold text-white mb-2 leading-snug">
                30 Sekunden.<br />Ein Anruf. Überzeugt.
              </h3>
              <p className="text-white/40 text-xs leading-relaxed mb-5">
                Kein Formular, kein Vertriebsgespräch — nur dein Telefon klingelt und Chipy zeigt dir was er kann.
              </p>

              {/* Trust signals */}
              <div className="space-y-2.5">
                {[
                  { Icon: IconPrivacy, text: 'Daten werden vertraulich behandelt' },
                  { Icon: IconBolt, text: 'Anruf kommt in unter 60 Sekunden' },
                  { Icon: IconCheckCircle, text: 'Kostenlos & unverbindlich' },
                ].map(t => (
                  <div key={t.text} className="flex items-center gap-2.5 text-xs text-white/50">
                    <t.Icon size={13} className="text-orange-400/50 shrink-0" />
                    {t.text}
                  </div>
                ))}
              </div>
            </div>

            {/* Right — form (2/5 width) */}
            <div className="sm:col-span-3 p-8 sm:p-10 sm:border-l" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              {state === 'success' ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-5 py-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)' }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-green-300 font-bold text-lg">Chipy ruft dich gleich an!</p>
                    <p className="text-white/40 text-sm mt-1.5">Dein Telefon klingelt in wenigen Sekunden.</p>
                  </div>
                  <button onClick={() => setState('idle')} className="text-xs text-white/25 hover:text-white/50 transition-colors mt-1">
                    Nochmal versuchen
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5 h-full flex flex-col justify-center">
                  <div>
                    <label className="block text-xs text-white/50 mb-1.5 font-medium">Dein Name <span className="text-white/20">(optional)</span></label>
                    <input
                      type="text"
                      placeholder="Wie heißt du?"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-xl bg-white/[0.05] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/50 mb-1.5 font-medium">E-Mail</label>
                    <input
                      type="email"
                      placeholder="deine@email.de"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full rounded-xl bg-white/[0.05] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/50 mb-1.5 font-medium">Telefonnummer</label>
                    <input
                      type="tel"
                      placeholder="+49 176 12345678"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                      className="w-full rounded-xl bg-white/[0.05] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-all"
                    />
                  </div>
                  {state === 'error' && (
                    <p className="text-red-400/80 text-xs bg-red-500/8 border border-red-500/15 rounded-xl px-4 py-2.5">
                      Etwas ist schiefgelaufen — bitte versuche es erneut.
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={state === 'loading' || !phone.trim() || !email.trim()}
                    className="w-full rounded-xl px-6 py-3.5 font-bold text-white text-sm disabled:opacity-40 transition-all duration-300 hover:scale-[1.02] cursor-pointer"
                    style={{
                      background: 'linear-gradient(135deg, #F97316, #EA580C)',
                      boxShadow: state !== 'loading' && phone.trim() && email.trim() ? '0 4px 24px rgba(249,115,22,0.3)' : 'none',
                    }}
                  >
                    {state === 'loading' ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Chipy wählt deine Nummer…
                      </span>
                    ) : (
                      'Jetzt anrufen lassen →'
                    )}
                  </button>
                  <p className="text-[11px] text-white/20 text-center">Einmaliger Demo-Anruf · Deine Nummer wird nicht weitergegeben</p>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
