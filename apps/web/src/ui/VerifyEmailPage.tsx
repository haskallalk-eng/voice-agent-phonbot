import { useEffect, useMemo, useState } from 'react';
import { verifyEmail } from '../lib/api.js';
import { PhonbotBrand } from './FoxLogo.js';

type VerifyState = 'loading' | 'success' | 'error';

export function VerifyEmailPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') ?? '', []);
  const [state, setState] = useState<VerifyState>(token ? 'loading' : 'error');
  const [error, setError] = useState(
    token ? '' : 'Kein Token gefunden. Bitte nutze den Link aus der E-Mail.',
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    verifyEmail(token)
      .then(() => {
        if (!cancelled) setState('success');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState('error');
        setError(
          err instanceof Error && err.message
            ? err.message
            : 'Der Link ist ungueltig, abgelaufen oder wurde bereits genutzt.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0A0A0F] text-white px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <PhonbotBrand size="md" />
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          {state === 'loading' && (
            <>
              <div className="mx-auto mb-5 h-10 w-10 rounded-full border-2 border-white/10 border-t-orange-400 animate-spin" />
              <h1 className="text-lg font-bold mb-2">E-Mail wird bestaetigt...</h1>
              <p className="text-white/50 text-sm">Einen Moment, wir pruefen deinen Link.</p>
            </>
          )}

          {state === 'success' && (
            <>
              <div className="text-3xl mb-4">&#10003;</div>
              <h1 className="text-lg font-bold mb-2">E-Mail bestaetigt!</h1>
              <p className="text-white/50 text-sm mb-6">
                Dein Phonbot-Konto ist jetzt verifiziert. Du kannst dich einloggen und weitermachen.
              </p>
              <a
                href="/?page=login"
                className="block w-full rounded-xl px-6 py-3 font-semibold text-white text-sm text-center transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}
              >
                Zum Login
              </a>
            </>
          )}

          {state === 'error' && (
            <>
              <div className="text-3xl mb-4">!</div>
              <h1 className="text-lg font-bold mb-2">Link konnte nicht bestaetigt werden</h1>
              <div className="my-5 rounded-xl border border-orange-400/20 bg-orange-500/10 px-4 py-3">
                <p className="text-sm text-orange-100/80">{error}</p>
              </div>
              <p className="text-white/45 text-sm mb-6">
                Logge dich ein und sende dir die Bestaetigungs-E-Mail erneut. Falls du schon verifiziert bist,
                kannst du direkt weitermachen.
              </p>
              <a
                href="/?page=login"
                className="block w-full rounded-xl px-6 py-3 font-semibold text-white text-sm text-center transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}
              >
                Zum Login
              </a>
            </>
          )}
        </div>

        <p className="text-center text-white/20 text-xs mt-6">
          <a href="/" className="hover:text-white/40 transition-colors">Zur Startseite</a>
        </p>
      </div>
    </div>
  );
}
