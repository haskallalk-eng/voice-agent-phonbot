import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useAuth } from '../lib/auth.js';
import { forgotPassword } from '../lib/api.js';
import { FoxLogo } from './FoxLogo.js';

type Mode = 'login' | 'register';

type Props = {
  onGoToLanding?: () => void;
  initialMode?: Mode;
};

export function LoginPage({ onGoToLanding, initialMode = 'login' }: Props) {
  const { login, register: authRegister } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [dsgvoAccepted, setDsgvoAccepted] = useState(false);

  // Forgot password state
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);

  // Main login/register form
  const {
    register,
    handleSubmit: handleFormSubmit,
    formState: { errors, isSubmitting },
    reset: resetMainForm,
  } = useForm<{ orgName: string; email: string; password: string }>({ mode: 'onBlur' });

  // Forgot password form
  const {
    register: registerForgot,
    handleSubmit: handleForgotFormSubmit,
    formState: { isSubmitting: isForgotSubmitting },
    reset: resetForgotForm,
  } = useForm<{ forgotEmail: string }>();

  async function onMainSubmit(data: { orgName: string; email: string; password: string }) {
    setError(null);
    try {
      if (mode === 'login') {
        await login(data.email, data.password);
      } else {
        await authRegister(data.orgName, data.email, data.password);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Etwas ist schiefgelaufen';
      setError(msg);
    }
  }

  async function onForgotSubmit(data: { forgotEmail: string }) {
    try {
      await forgotPassword(data.forgotEmail);
      setForgotSuccess(true);
    } catch {
      // Still show success to prevent email enumeration
      setForgotSuccess(true);
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] flex flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="glow-pulse absolute top-1/4 left-1/2 -translate-x-1/2 w-[300px] sm:w-[600px] h-[300px] sm:h-[600px] rounded-full"
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
        <div className="flex gap-1 mb-6 bg-white/5 rounded-xl p-1" role="tablist" aria-label="Login oder Registrierung">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            onClick={() => { setMode('login'); setError(null); resetMainForm(); }}
            className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-200"
            style={mode === 'login'
              ? { background: 'linear-gradient(135deg, #F97316, #06B6D4)', color: '#fff' }
              : { color: 'rgba(255,255,255,0.4)' }}
          >
            Einloggen
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            onClick={() => { setMode('register'); setError(null); resetMainForm(); }}
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
              <form onSubmit={handleForgotFormSubmit(onForgotSubmit)} className="space-y-4" aria-label="Passwort zurücksetzen">
                <div>
                  <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                    E-Mail
                  </label>
                  <input
                    type="email"
                    placeholder="du@beispiel.de"
                    autoComplete="email"
                    className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/30
                      focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all duration-200"
                    {...registerForgot('forgotEmail', { required: true })}
                  />
                </div>
                <button
                  type="submit"
                  disabled={isForgotSubmitting}
                  className="w-full rounded-xl px-4 py-3 font-semibold text-white text-sm
                    disabled:opacity-50 transition-all duration-300
                    hover:shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:scale-[1.02]"
                  style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
                >
                  {isForgotSubmitting ? (
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
              onClick={() => { setShowForgotPassword(false); setForgotSuccess(false); resetForgotForm(); }}
              className="mt-4 text-sm text-orange-400 hover:text-orange-300 font-medium transition-colors"
            >
              ← Zurück zum Login
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleFormSubmit(onMainSubmit)} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                    Organisationsname
                  </label>
                  <input
                    type="text"
                    placeholder="Muster GmbH"
                    className={`w-full rounded-xl bg-white/5 border px-4 py-2.5 text-sm text-white placeholder-white/30
                      focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all duration-200 ${errors.orgName ? 'border-red-500/60' : 'border-white/10'}`}
                    {...register('orgName', { required: mode === 'register', minLength: { value: 2, message: 'Mindestens 2 Zeichen' } })}
                  />
                  {errors.orgName && <p className="mt-1 text-xs text-red-400">{errors.orgName.message}</p>}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                  E-Mail
                </label>
                <input
                  type="email"
                  placeholder="du@beispiel.de"
                  autoComplete="email"
                  className={`w-full rounded-xl bg-white/5 border px-4 py-2.5 text-sm text-white placeholder-white/30
                    focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all duration-200 ${errors.email ? 'border-red-500/60' : 'border-white/10'}`}
                  {...register('email', {
                    required: 'E-Mail ist erforderlich',
                    pattern: {
                      value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                      message: 'Bitte gib eine gültige E-Mail-Adresse ein.',
                    },
                  })}
                />
                {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email.message}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                  Passwort
                </label>
                <input
                  type="password"
                  placeholder={mode === 'register' ? 'Min. 8 Zeichen' : '••••••••'}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  className={`w-full rounded-xl bg-white/5 border px-4 py-2.5 text-sm text-white placeholder-white/30
                    focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all duration-200 ${errors.password ? 'border-red-500/60' : 'border-white/10'}`}
                  {...register('password', {
                    required: 'Passwort ist erforderlich',
                    minLength: { value: 8, message: 'Mindestens 8 Zeichen' },
                  })}
                />
                {errors.password && <p className="mt-1 text-xs text-red-400">{errors.password.message}</p>}
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

              {mode === 'register' && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dsgvoAccepted}
                    onChange={(e) => setDsgvoAccepted(e.target.checked)}
                    className="mt-0.5 rounded border-white/20 bg-white/5 text-orange-500 focus:ring-orange-500/50"
                  />
                  <span className="text-xs text-white/50 leading-relaxed">
                    Ich akzeptiere die{' '}
                    <a href="/?page=legal" className="text-orange-400 hover:text-orange-300 underline transition-colors">
                      Datenschutzerkl&auml;rung
                    </a>{' '}
                    und{' '}
                    <a href="/?page=legal" className="text-orange-400 hover:text-orange-300 underline transition-colors">
                      AGB
                    </a>.
                  </span>
                </label>
              )}

              {error && (
                <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
                  ⚠️ {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || (mode === 'register' && !dsgvoAccepted)}
                className="w-full rounded-xl px-4 py-3 font-semibold text-white text-sm
                  disabled:opacity-50 transition-all duration-300
                  hover:shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:scale-[1.02]"
                style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
              >
                {isSubmitting ? (
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
