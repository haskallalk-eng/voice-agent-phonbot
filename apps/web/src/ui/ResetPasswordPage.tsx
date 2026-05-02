import { useState } from 'react';
import { resetPassword } from '../lib/api.js';
import { FoxLogo } from './FoxLogo.js';
import { PasswordInput } from './PasswordInput.js';

export function ResetPasswordPage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError('Mindestens 8 Zeichen.'); return; }
    if (password !== confirm) { setError('Passwörter stimmen nicht überein.'); return; }
    if (!token) { setError('Kein Token gefunden. Bitte nutze den Link aus der E-Mail.'); return; }

    setStatus('loading');
    setError('');
    try {
      await resetPassword(token, password);
      setStatus('success');
    } catch (err: unknown) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Fehler beim Zurücksetzen. Der Link ist möglicherweise abgelaufen.');
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0A0A0F] text-white px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <FoxLogo size="lg" glow />
          <span className="text-xl font-black tracking-tight">
            <span className="text-white">Phon</span>
            <span style={{ background: 'linear-gradient(135deg,#F97316,#06B6D4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>bot</span>
          </span>
        </div>

        {status === 'success' ? (
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 text-center">
            <div className="text-3xl mb-4">&#10003;</div>
            <h2 className="text-lg font-bold mb-2">Passwort geändert!</h2>
            <p className="text-white/50 text-sm mb-6">Du kannst dich jetzt mit deinem neuen Passwort einloggen.</p>
            <a
              href="/?page=login"
              className="block w-full rounded-xl px-6 py-3 font-semibold text-white text-sm text-center transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
            >
              Zum Login
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
            <h2 className="text-lg font-bold mb-1 text-center">Neues Passwort setzen</h2>
            <p className="text-white/40 text-sm mb-6 text-center">Mindestens 8 Zeichen</p>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4">
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-white/40 mb-1.5">Neues Passwort</label>
                <PasswordInput
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none"
                  placeholder="••••••••"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1.5">Passwort bestätigen</label>
                <PasswordInput
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={status === 'loading'}
              className="w-full mt-6 rounded-xl px-6 py-3 font-semibold text-white text-sm transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
            >
              {status === 'loading' ? 'Wird gespeichert…' : 'Passwort ändern'}
            </button>
          </form>
        )}

        <p className="text-center text-white/20 text-xs mt-6">
          <a href="/" className="hover:text-white/40 transition-colors">← Zurück zur Startseite</a>
        </p>
      </div>
    </div>
  );
}
