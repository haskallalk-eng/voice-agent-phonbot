import React, { useState } from 'react';
import { useAuth } from '../lib/auth.js';
import { forgotPassword } from '../lib/api.js';
import { FoxLogo } from './FoxLogo.js';

type Mode = 'login' | 'register';

type Props = {
  onGoToLanding?: () => void;
  initialMode?: Mode;
};

export function LoginPage({ onGoToLanding, initialMode = 'login' }: Props) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Inline validation state
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Forgot password state
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(orgName, email, password);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Etwas ist schiefgelaufen';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setForgotLoading(true);
    try {
      await forgotPassword(forgotEmail);
      setForgotSuccess(true);
    } catch {
      // Still show success to prevent email enumeration
      setForgotSuccess(true);
    } finally {
      setForgotLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] flex flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="glow-pulse absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.1) 0%, transparent 65%)' }}
        />
      </div>

      {/* Back link */}
      {onGoToLanding && (
        <button
          onClick={onGoToLanding}
          className="relative z-10 flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-colors mb-8"
        >
          ← Zurück zur Startseite
        </button>
      )}

      {/* Card */}
      <div className="relative z-10 w-full max-w-sm glass rounded-2xl p-8">
        {/* Logo */}
        <div className="text-center mb-6">
          <FoxLogo size="lg" glow className="mx-auto mb-3" />
          <h1 className="text-2xl font-extrabold text-white">Phon<span className="text-orange-400">bot</span></h1>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 mb-6 bg-white/5 rounded-xl p-1">
          <button
            type="button"
            onClick={() => { setMode('login'); setError(null); setEmailError(null); setPasswordError(null); }}
            className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-200"
            style={mode === 'login'
              ? { background: 'linear-gradient(135deg, #F97316, #06B6D4)', color: '#fff' }
              : { color: 'rgba(255,255,255,0.4)' }}
          >
            Einloggen
          </button>
          <button
            type="button"
            onClick={() => { setMode('register'); setError(null); setEmailError(null); setPasswordError(null); }}
            className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-200"
            style={mode === 'register'
              ? { background: 'linear-gradient(135deg, #F97316, #06B6D4)', color: '#fff' }
              : { color: 'rgba(255,255,255,0.4)' }}
          >
            Registrieren
          </button>
        </div>

        {/* Forgot password inline form */}
        {showForgotPassword ? (
          <div>
            <h2 className="text-base font-semibold text-white mb-4">Passwort zurücksetzen</h2>
            {forgotSuccess ? (
              <div className="text-sm text-green-300 bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 mb-4">
                ✅ Falls ein Account mit dieser E-Mail existiert, haben wir dir einen Reset-Link gesendet.
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                    E-Mail
                  </label>
                  <input
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="du@beispiel.de"
                    className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/30
                      focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all duration-200"
                  />
                </div>
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full rounded-xl px-4 py-3 font-semibold text-white text-sm
                    disabled:opacity-50 transition-all duration-300
                    hover:shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:scale-[1.02]"
                  style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
                >
                  {forgotLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white spin" />
                      Bitte warten…
                    </span>
                  ) : (
                    'Reset-Link senden'
                  )}
                </button>
              </form>
            )}
            <button
              onClick={() => { setShowForgotPassword(false); setForgotSuccess(false); setForgotEmail(''); }}
              className="mt-4 text-sm text-orange-400 hover:text-orange-300 font-medium transition-colors"
            >
              ← Zurück zum Login
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                    Organisationsname
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="Muster GmbH"
                    className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/30
                      focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all duration-200"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                  E-Mail
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(null); }}
                  onBlur={() => {
                    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                      setEmailError('Bitte gib eine gültige E-Mail-Adresse ein.');
                    } else {
                      setEmailError(null);
                    }
                  }}
                  placeholder="du@beispiel.de"
                  className={`w-full rounded-xl bg-white/5 border px-4 py-2.5 text-sm text-white placeholder-white/30
                    focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all duration-200 ${emailError ? 'border-red-500/60' : 'border-white/10'}`}
                />
                {emailError && <p className="mt-1 text-xs text-red-400">{emailError}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                  Passwort
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (passwordError) setPasswordError(null); }}
                  onBlur={() => {
                    if (password && password.length < 8) {
                      setPasswordError('Mindestens 8 Zeichen');
                    } else {
                      setPasswordError(null);
                    }
                  }}
                  placeholder={mode === 'register' ? 'Min. 8 Zeichen' : '••••••••'}
                  className={`w-full rounded-xl bg-white/5 border px-4 py-2.5 text-sm text-white placeholder-white/30
                    focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all duration-200 ${passwordError ? 'border-red-500/60' : 'border-white/10'}`}
                />
                {passwordError && <p className="mt-1 text-xs text-red-400">{passwordError}</p>}
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => setShowForgotPassword(true)}
                    className="mt-1.5 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                  >
                    Passwort vergessen?
                  </button>
                )}
              </div>

              {error && (
                <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
                  ⚠️ {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl px-4 py-3 font-semibold text-white text-sm
                  disabled:opacity-50 transition-all duration-300
                  hover:shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:scale-[1.02]"
                style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white spin" />
                    Bitte warten…
                  </span>
                ) : mode === 'login' ? (
                  'Einloggen'
                ) : (
                  'Account erstellen'
                )}
              </button>
            </form>


          </>
        )}
      </div>
    </div>
  );
}
