import React, { useState } from 'react';
import { IconPhone, IconBolt } from '../PhonbotIcons.js';
import { FoxLogo } from '../FoxLogo.js';
import { useVisible } from './shared.js';

export function ContactSection() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const ref = React.useRef<HTMLElement>(null);
  const vis = useVisible(ref);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !message.trim()) return;
    setState('sending');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), message: message.trim() }),
      });
      if (!res.ok) throw new Error();
      setState('sent');
    } catch {
      setState('error');
    }
  }

  return (
    <section
      ref={ref}
      id="kontakt"
      className="relative z-10 px-6 py-24 ambient-glow"
      style={{ opacity: vis ? 1 : 0, transform: vis ? 'none' : 'translateY(20px)', transition: 'all 0.5s cubic-bezier(.4,0,.2,1)' }}
    >
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-14">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-orange-400/60 uppercase mb-4">Kontakt</p>
          <h2 className="text-3xl sm:text-[40px] font-extrabold text-white leading-tight">
            Wir sind für dich da
          </h2>
          <p className="text-white/40 text-sm mt-3 max-w-md mx-auto">
            Fragen, Feedback oder Partnerschaft — schreib uns. Wir antworten innerhalb von 24 Stunden.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left — Contact info cards */}
          <div className="lg:col-span-2 space-y-4">
            {/* Email card */}
            <div className="relative rounded-2xl p-6 overflow-hidden" style={{ backdropFilter: 'blur(48px)' }}>
              <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem' }} />
              <div className="relative">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(6,182,212,0.1))' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7"/>
                  </svg>
                </div>
                <p className="text-xs text-white/30 uppercase tracking-wider font-semibold mb-1">E-Mail</p>
                <a href="mailto:info@mindrails.de" className="text-sm text-white/80 hover:text-orange-400 transition-colors">
                  info@mindrails.de
                </a>
              </div>
            </div>

            {/* Response time card */}
            <div className="relative rounded-2xl p-6 overflow-hidden" style={{ backdropFilter: 'blur(48px)' }}>
              <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem' }} />
              <div className="relative">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.15), rgba(249,115,22,0.1))' }}>
                  <IconBolt size={18} className="text-cyan-400" />
                </div>
                <p className="text-xs text-white/30 uppercase tracking-wider font-semibold mb-1">Antwortzeit</p>
                <p className="text-sm text-white/80">Innerhalb von 24h</p>
              </div>
            </div>

            {/* Chipy card */}
            <div className="relative rounded-2xl p-6 overflow-hidden" style={{ backdropFilter: 'blur(48px)' }}>
              <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem' }} />
              <div className="relative flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(6,182,212,0.1))' }}>
                  <FoxLogo size={32} />
                </div>
                <div>
                  <p className="text-xs text-white/30 uppercase tracking-wider font-semibold mb-0.5">Live testen</p>
                  <p className="text-xs text-white/50">Ruf Chipy an und erlebe ihn selbst</p>
                </div>
              </div>
            </div>

            {/* Location */}
            <div className="px-2 pt-2">
              <p className="text-[11px] text-white/15 leading-relaxed">
                Mindrails · Hennigsdorf, Deutschland
              </p>
            </div>
          </div>

          {/* Right — Contact form */}
          <div className="lg:col-span-3">
            <div className="relative rounded-2xl overflow-hidden" style={{ backdropFilter: 'blur(48px)' }}>
              <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem' }} />

              <div className="relative p-8 sm:p-10">
                {state === 'sent' ? (
                  <div className="flex flex-col items-center justify-center text-center py-10 gap-5">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)' }}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-white">Nachricht gesendet!</p>
                      <p className="text-sm text-white/40 mt-1.5">Wir melden uns so schnell wie möglich bei dir.</p>
                    </div>
                    <button onClick={() => { setState('idle'); setName(''); setEmail(''); setMessage(''); }}
                      className="text-xs text-white/25 hover:text-white/50 transition-colors mt-2">
                      Weitere Nachricht senden
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5 font-medium">Name</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Dein Name"
                        className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-all"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5 font-medium">E-Mail *</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="deine@email.de"
                        required
                        className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-all"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5 font-medium">Nachricht *</label>
                      <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Wie können wir dir helfen?"
                        required
                        rows={5}
                        className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-all resize-y"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                      />
                    </div>

                    {state === 'error' && (
                      <p className="text-xs text-red-400/80 bg-red-500/8 border border-red-500/15 rounded-xl px-4 py-2.5">
                        Etwas ist schiefgelaufen — bitte versuche es erneut oder schreib direkt an info@mindrails.de
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={state === 'sending' || !email.trim() || !message.trim()}
                      className="w-full rounded-xl px-6 py-4 text-sm font-semibold text-white disabled:opacity-40 transition-all duration-200 hover:scale-[1.02] cursor-pointer"
                      style={{
                        background: 'linear-gradient(135deg, #F97316, #06B6D4)',
                        boxShadow: '0 4px 24px rgba(249,115,22,0.2)',
                      }}
                    >
                      {state === 'sending' ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                          Wird gesendet…
                        </span>
                      ) : 'Nachricht senden'}
                    </button>

                    <p className="text-[10px] text-white/15 text-center">Deine Daten werden vertraulich behandelt und nicht weitergegeben.</p>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
