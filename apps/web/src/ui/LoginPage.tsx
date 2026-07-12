import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useAuth } from '../lib/auth.js';
import { forgotPassword, startCheckoutSignup, LEGAL_CONFIRMATION } from '../lib/api.js';
import { PhonbotBrand } from './FoxLogo.js';
import { PasswordInput } from './PasswordInput.js';
import {
  PAID_PLAN_LABELS,
  readPaidPlanPreselection,
  startPaidCheckoutSignupAndClearOnSuccess,
  type PaidPlanId,
} from './loginCheckout.js';

type Mode = 'login' | 'register';
type AuthFormValues = { orgName: string; email: string; phone: string; password: string };

type Props = {
  onGoToLanding?: () => void;
  onModeChange?: (mode: Mode) => void;
  initialMode?: Mode;
};

export function LoginPage({ onGoToLanding, onModeChange, initialMode = 'login' }: Props) {
  const { login, register: authRegister } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [dsgvoAccepted, setDsgvoAccepted] = useState(false);
  // §14 BGB Unternehmer-Bestätigung — Phonbot ist B2B-only. Ohne diese
  // Bestätigung greift bei natürlichen Personen das 14-Tage-Verbraucher-
  // Widerrufsrecht (§312g BGB). Die Checkbox ist Pflicht für Account-
  // Erstellung; der Backend-Audit-Trail dokumentiert die B2B-Bestätigung.
  const [isBusiness, setIsBusiness] = useState(false);
  const [preselectedPaidPlan, setPreselectedPaidPlan] = useState<PaidPlanId | null>(null);

  // Forgot password state
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);

  useEffect(() => {
    setMode(initialMode);
    setError(null);
    setShowForgotPassword(false);
    setForgotSuccess(false);
  }, [initialMode]);

  useEffect(() => {
    if (mode !== 'register') {
      setPreselectedPaidPlan(null);
      return;
    }
    setPreselectedPaidPlan(readPaidPlanPreselection().plan);
  }, [mode]);

  // Main login/register form
  const {
    register,
    handleSubmit: handleFormSubmit,
    formState: { errors, isSubmitting },
    reset: resetMainForm,
  } = useForm<AuthFormValues>({ mode: 'onBlur' });

  // Forgot password form
  const {
    register: registerForgot,
    handleSubmit: handleForgotFormSubmit,
    formState: { isSubmitting: isForgotSubmitting },
    reset: resetForgotForm,
  } = useForm<{ forgotEmail: string }>();

  async function onMainSubmit(data: AuthFormValues) {
    setError(null);

    // Check for pricing-card preselection BEFORE hitting any backend. If
    // the user picked a paid plan, we skip /auth/register entirely: the
    // account is only materialized after Stripe confirms payment. That way,
    // a Stripe cancel returns the user to the landing page with no account
    // persisted at all.
    const { plan, interval } = readPaidPlanPreselection();

    const wantsCheckoutFirst =
      mode === 'register' &&
      !!plan;

    try {
      if (wantsCheckoutFirst) {
        const url = await startPaidCheckoutSignupAndClearOnSuccess({
          form: data,
          plan,
          interval,
          legalConfirmation: LEGAL_CONFIRMATION,
          startCheckoutSignup,
        });
        window.location.href = url;
        return; // browser navigates away
      }

      if (mode === 'login') {
        await login(data.email, data.password);
      } else {
        await authRegister(data.orgName, data.email, data.phone, data.password, {
          ...LEGAL_CONFIRMATION,
        });
      }

      // Existing users confirm current legal documents in Billing before a
      // paid checkout is opened; keep the preselection for that view.
      if (plan) {
        try {
          sessionStorage.setItem('preselectedPlan', plan);
          sessionStorage.setItem('preselectedInterval', interval);
        } catch { /* ignore */ }
        const url = new URL(window.location.href);
        url.searchParams.delete('page');
        url.hash = 'billing';
        window.history.replaceState({}, '', url.toString());
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
    <div className="min-h-screen bg-[#0A0A0F] flex flex-col items-center justify-center px-4 py-8 relative overflow-x-hidden overflow-y-auto">
      {/* Background crystal glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="crystal-page-glow glow-pulse absolute top-1/4 left-1/2 h-[300px] w-[300px] -translate-x-1/2 sm:h-[600px] sm:w-[600px]"
          style={{ background: 'radial-gradient(ellipse, rgba(249,115,22,0.1) 0%, transparent 65%)' }}
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
          <PhonbotBrand size="md" className="mx-auto" />
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 mb-6 bg-white/5 rounded-xl p-1" role="tablist" aria-label="Login oder Registrierung">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            onClick={() => { setMode('login'); onModeChange?.('login'); setError(null); resetMainForm(); }}
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
            onClick={() => { setMode('register'); onModeChange?.('register'); setError(null); resetMainForm(); }}
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
              <div className="mb-4 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100/80">
                Falls ein Account mit dieser E-Mail existiert, haben wir dir einen Reset-Link gesendet.
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
                  className="crystal-button w-full rounded-full px-4 py-3 font-semibold text-white text-sm
                    disabled:opacity-50 transition-all duration-300
                    hover:shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:scale-[1.02]"
                  
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
              {mode === 'register' && preselectedPaidPlan && (
                <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 px-4 py-3 text-xs leading-relaxed text-orange-100/80">
                  Du registrierst dich für den {PAID_PLAN_LABELS[preselectedPaidPlan]}-Plan. Nach dem Klick öffnet sich Stripe; der Account wird erst nach erfolgreicher Zahlung aktiviert.
                </div>
              )}
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                    Salon-Name
                  </label>
                  <input
                    type="text"
                    placeholder="Salon Muster"
                    className={`w-full rounded-xl bg-white/5 border px-4 py-2.5 text-sm text-white placeholder-white/30
                      focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all duration-200 ${errors.orgName ? 'border-orange-400/70' : 'border-white/10'}`}
                    {...register('orgName', { required: mode === 'register', minLength: { value: 2, message: 'Mindestens 2 Zeichen' } })}
                  />
                  {errors.orgName && <p className="mt-1 text-xs text-orange-200">{errors.orgName.message}</p>}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                  {mode === 'login' ? 'E-Mail, Telefonnummer oder Login-Name' : 'E-Mail'}
                </label>
                <input
                  type={mode === 'login' ? 'text' : 'email'}
                  placeholder={mode === 'login' ? 'Salon Jimmy, E-Mail oder 0176 12345678' : 'du@beispiel.de'}
                  autoComplete={mode === 'login' ? 'username' : 'email'}
                  className={`w-full rounded-xl bg-white/5 border px-4 py-2.5 text-sm text-white placeholder-white/30
                    focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all duration-200 ${errors.email ? 'border-orange-400/70' : 'border-white/10'}`}
                  {...register('email', {
                    required: mode === 'login' ? 'E-Mail, Telefonnummer oder Login-Name ist erforderlich' : 'E-Mail ist erforderlich',
                    validate: (value) => {
                      if (mode === 'login') return value.trim().length >= 3 || 'Bitte gib E-Mail, Telefonnummer oder Login-Name ein.';
                      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || 'Bitte gib eine gültige E-Mail-Adresse ein.';
                    },
                  })}
                />
                {errors.email && <p className="mt-1 text-xs text-orange-200">{errors.email.message}</p>}
              </div>

              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                    Telefonnummer
                  </label>
                  <input
                    type="tel"
                    placeholder="+49 176 12345678"
                    autoComplete="tel"
                    className={`w-full rounded-xl bg-white/5 border px-4 py-2.5 text-sm text-white placeholder-white/30
                      focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all duration-200 ${errors.phone ? 'border-orange-400/70' : 'border-white/10'}`}
                    {...register('phone', {
                      required: mode === 'register' ? 'Telefonnummer ist erforderlich' : false,
                      minLength: { value: 7, message: 'Bitte gib eine gueltige Telefonnummer ein.' },
                    })}
                  />
                  {errors.phone && <p className="mt-1 text-xs text-orange-200">{errors.phone.message}</p>}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                  Passwort
                </label>
                <PasswordInput
                  placeholder={mode === 'register' ? 'Min. 8 Zeichen' : '••••••••'}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  className={`w-full rounded-xl bg-white/5 border px-4 py-2.5 text-sm text-white placeholder-white/30
                    focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all duration-200 ${errors.password ? 'border-orange-400/70' : 'border-white/10'}`}
                  {...register('password', {
                    required: 'Passwort ist erforderlich',
                    minLength: { value: 8, message: 'Mindestens 8 Zeichen' },
                  })}
                />
                {errors.password && <p className="mt-1 text-xs text-orange-200">{errors.password.message}</p>}
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
                <>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dsgvoAccepted}
                      onChange={(e) => setDsgvoAccepted(e.target.checked)}
                      className="mt-0.5 rounded border-white/20 bg-white/5 text-orange-500 focus:ring-orange-500/50"
                    />
                    <span className="text-xs text-white/50 leading-relaxed">
                      Ich akzeptiere die{' '}
                      <a href="/datenschutz/" target="_blank" rel="noopener" className="text-orange-400 hover:text-orange-300 underline transition-colors">
                        Datenschutzerkl&auml;rung
                      </a>
                      , die{' '}
                      <a href="/agb/" target="_blank" rel="noopener" className="text-orange-400 hover:text-orange-300 underline transition-colors">
                        AGB
                      </a>{' '}
                      und den{' '}
                      <a href="/avv/" target="_blank" rel="noopener" className="text-orange-400 hover:text-orange-300 underline transition-colors">
                        AVV
                      </a>.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isBusiness}
                      onChange={(e) => setIsBusiness(e.target.checked)}
                      className="mt-0.5 rounded border-white/20 bg-white/5 text-orange-500 focus:ring-orange-500/50"
                    />
                    <span className="text-xs text-white/50 leading-relaxed">
                      Ich best&auml;tige, dass ich Phonbot ausschlie&szlig;lich als Unternehmer
                      im Sinne von &sect;14 BGB teste oder nutze. {preselectedPaidPlan
                        ? 'Der ausgewählte kostenpflichtige Plan wird nach erfolgreicher Stripe-Zahlung aktiviert.'
                        : 'Ein kostenpflichtiger Plan entsteht erst durch eine spätere Buchung.'}
                    </span>
                  </label>
                </>
              )}

              {error && (
                <div className="break-words rounded-xl border border-orange-400/20 bg-orange-500/10 px-4 py-2.5 text-sm text-orange-100/80 [overflow-wrap:anywhere]">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || (mode === 'register' && (!dsgvoAccepted || !isBusiness))}
                className="crystal-button w-full rounded-full px-4 py-3 font-semibold text-white text-sm
                  disabled:opacity-50 transition-all duration-300
                  hover:shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:scale-[1.02]"
                
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white spin" />
                    Bitte warten…
                  </span>
                ) : mode === 'login' ? (
                  'Einloggen'
                ) : preselectedPaidPlan ? (
                  'Weiter zur sicheren Zahlung'
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
