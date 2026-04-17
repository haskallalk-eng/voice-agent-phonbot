import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getBillingPlans,
  getBillingStatus,
  createCheckoutSession,
  createPortalSession,
  type Plan,
  type BillingStatus,
} from '../lib/api.js';
import { SkeletonCard } from '../components/ui.js';

const PLAN_FEATURES: Record<string, string[]> = {
  free: ['30 Freiminuten (einmalig)', '1 Agent', 'Web-Call Test', 'Community Support'],
  nummer: ['✦ Eigene Telefonnummer', '70 Minuten / Monat', '1 Agent', 'Ticket-System', '+0,20€/Min bei Überschreitung'],
  starter: ['✦ Telefonnummer inklusive', '360 Minuten / Monat', '1 Agent', 'Ticket-System', 'E-Mail Support', '+0,22€/Min bei Überschreitung'],
  pro: ['✦ Telefonnummer inklusive', '1.000 Minuten / Monat', '3 Agents', 'Kalender-Integration', 'Priority Support', '+0,20€/Min bei Überschreitung'],
  agency: ['✦ Telefonnummer inklusive', '2.400 Minuten / Monat', '10 Agents', 'White-Label', 'Dedicated Support', '+0,15€/Min bei Überschreitung'],
};

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-400' : 'bg-gradient-to-r from-orange-500 to-cyan-500';
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-white/40 mb-1">
        <span>{used} Min verwendet</span>
        <span>{limit} Min inkl.</span>
      </div>
      <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-white/30 mt-1">{pct}% verbraucht</p>
    </div>
  );
}

function PlanBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    active: { label: 'Aktiv', className: 'bg-green-500/20 text-green-400' },
    trialing: { label: 'Testphase', className: 'bg-blue-500/20 text-blue-400' },
    past_due: { label: 'Zahlung überfällig', className: 'bg-red-500/20 text-red-400' },
    canceled: { label: 'Gekündigt', className: 'bg-white/10 text-white/40' },
    free: { label: 'Gratis', className: 'bg-white/10 text-white/40' },
  };
  const style = map[status] ?? { label: status, className: 'bg-white/10 text-white/40' };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.className}`}>
      {style.label}
    </span>
  );
}

export function BillingPage() {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: 'ok' | 'error'; text: string } | null>(() => {
    const params = new URLSearchParams(window.location.search);
    let initial: { type: 'ok' | 'error'; text: string } | null = null;
    if (params.get('success')) initial = { type: 'ok', text: 'Zahlung erfolgreich! Dein Plan wurde aktiviert.' };
    if (params.get('canceled')) initial = { type: 'error', text: 'Zahlung abgebrochen.' };
    if (params.has('success') || params.has('canceled')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    return initial;
  });
  const [billingInterval, setBillingInterval] = useState<'month' | 'year'>('month');

  const { data, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['billing'],
    queryFn: async () => {
      const [s, p] = await Promise.all([getBillingStatus(), getBillingPlans()]);
      return { status: s, plans: p.plans };
    },
  });

  const status = data?.status ?? null;
  const plans = data?.plans ?? [];

  // Merge query error into the flash display
  const effectiveFlash = flash ?? (queryError ? { type: 'error' as const, text: 'Billing-Daten konnten nicht geladen werden.' } : null);

  async function handleUpgrade(planId: string) {
    setActionLoading(planId);
    try {
      const { url } = await createCheckoutSession(planId, billingInterval);
      window.location.href = url;
    } catch (e: unknown) {
      // F4: don't echo raw `e.message` into the UI — pg-error / stack traces
      // would leak schema/internal details to the user. Log to console for dev,
      // show a user-safe generic to the human.
      if (typeof console !== 'undefined') console.warn('billing checkout failed', e);
      setFlash({ type: 'error', text: 'Checkout konnte nicht geöffnet werden. Bitte versuche es erneut oder kontaktiere uns.' });
      setActionLoading(null);
    }
  }

  async function handlePortal() {
    setActionLoading('portal');
    try {
      const { url } = await createPortalSession();
      window.location.href = url;
    } catch (e: unknown) {
      if (typeof console !== 'undefined') console.warn('billing portal failed', e);
      setFlash({ type: 'error', text: 'Billing-Portal konnte nicht geöffnet werden. Bitte versuche es erneut.' });
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <SkeletonCard />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      </div>
    );
  }

  const currentPlan = status?.plan ?? 'free';
  const isPaid = currentPlan !== 'free' && status?.planStatus === 'active';

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">

      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white">Billing & Plan</h2>
        <p className="text-sm text-white/50 mt-1">Verwalte dein Abonnement und deinen Verbrauch.</p>
      </div>

      {/* Flash */}
      {effectiveFlash && (
        <div className={`rounded-xl px-4 py-3 text-sm border ${
          effectiveFlash.type === 'ok'
            ? 'bg-green-500/10 text-green-400 border-green-500/20'
            : 'bg-red-500/10 text-red-400 border-red-500/20'
        }`}>
          {effectiveFlash.text}
          <button onClick={() => setFlash(null)} className="ml-3 opacity-50 hover:opacity-100" aria-label="Schließen">✕</button>
        </div>
      )}

      {/* Current Plan Card */}
      {status && (
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white">
                {status.planName} Plan
              </h3>
              {status.currentPeriodEnd && (
                <p className="text-xs text-white/40 mt-0.5">
                  Verlängert am {new Date(status.currentPeriodEnd).toLocaleDateString('de-DE')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <PlanBadge status={status.planStatus} />
              {isPaid && (
                <button
                  onClick={handlePortal}
                  disabled={actionLoading === 'portal'}
                  className="text-sm text-orange-400 hover:text-orange-300 font-medium disabled:opacity-50"
                >
                  {actionLoading === 'portal' ? '…' : 'Abo verwalten →'}
                </button>
              )}
            </div>
          </div>
          <UsageBar used={status.minutesUsed} limit={status.minutesLimit} />
        </div>
      )}

      {/* Plan Cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white/40 uppercase tracking-wide">Verfügbare Pläne</h3>
          {plans.some((p) => p.hasYearly) && (
            <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1 border border-white/10">
              <button
                onClick={() => setBillingInterval('month')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  billingInterval === 'month' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                Monatlich
              </button>
              <button
                onClick={() => setBillingInterval('year')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  billingInterval === 'year' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                Jährlich
                <span className="bg-green-500/20 text-green-400 text-[10px] px-1.5 py-0.5 rounded-full font-semibold">
                  2 Mo. gratis
                </span>
              </button>
            </div>
          )}
        </div>
        {/* ── Main plans: 3-col grid (Starter / Pro / Agency) ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          {plans.filter(p => !['free', 'nummer'].includes(p.id)).map((plan) => {
            const isCurrent = plan.id === currentPlan;
            const features = PLAN_FEATURES[plan.id] ?? [];
            const showYearly = billingInterval === 'year' && plan.hasYearly && plan.price > 0;
            const yearlyMonthlyPrice = Math.round((plan.price * 10) / 12);

            return (
              <div
                key={plan.id}
                className={`rounded-2xl border p-5 flex flex-col gap-4 transition-all ${
                  isCurrent
                    ? 'border-orange-500/40 bg-gradient-to-b from-orange-500/10 to-cyan-500/5 shadow-lg shadow-orange-500/10'
                    : 'border-white/10 bg-white/5 hover:bg-white/8 hover:border-white/20'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-semibold text-white">{plan.name}</h4>
                    {isCurrent && (
                      <span className="text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full">Aktuell</span>
                    )}
                  </div>
                  {showYearly ? (
                    <div>
                      <p className="text-2xl font-bold text-white">{yearlyMonthlyPrice}€<span className="text-sm font-normal text-white/40">/Mo</span></p>
                      <p className="text-xs text-white/30 mt-0.5"><span className="line-through">{plan.price}€</span> · {plan.price * 10}€/Jahr</p>
                    </div>
                  ) : (
                    <p className="text-2xl font-bold text-white">{plan.price}€<span className="text-sm font-normal text-white/40">/Mo</span></p>
                  )}
                </div>
                <ul className="space-y-1.5 flex-1">
                  {features.map((f) => {
                    const hl = f.startsWith('✦');
                    const label = hl ? f.slice(2) : f;
                    return (
                      <li key={f} className="flex items-center gap-2 text-sm">
                        {hl ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" className="shrink-0"><defs><linearGradient id="fgBl" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#F97316"/><stop offset="100%" stopColor="#06B6D4"/></linearGradient></defs><path d="M12 1C12.8 7.6 16.4 11.2 23 12c-6.6.8-10.2 4.4-11 11-.8-6.6-4.4-10.2-11-11C7.6 11.2 11.2 7.6 12 1z" fill="url(#fgBl)"/></svg>
                        ) : (
                          <span className="text-green-400">✓</span>
                        )}
                        <span className={hl ? 'font-semibold bg-clip-text text-transparent' : 'text-white/60'}
                          style={hl ? { backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' } : undefined}>{label}</span>
                      </li>
                    );
                  })}
                </ul>
                {!isCurrent && (
                  <button onClick={() => handleUpgrade(plan.id)} disabled={!!actionLoading}
                    className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-cyan-500 hover:opacity-90 disabled:opacity-50 text-white text-sm font-medium py-2 transition-opacity">
                    {actionLoading === plan.id ? '…' : `Zu ${plan.name} wechseln`}
                  </button>
                )}
                {isCurrent && isPaid && (
                  <button onClick={handlePortal} disabled={!!actionLoading}
                    className="w-full rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white/60 text-sm font-medium py-2 transition-colors disabled:opacity-50">
                    {actionLoading === 'portal' ? '…' : 'Verwalten'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Nummer — subtle line at bottom ── */}
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-5 py-3 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.12.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.58 2.81.7A2 2 0 0122 16.92z"/>
            </svg>
            <span className="text-white/50">
              <span className="text-white/70 font-medium">Eigene Telefonnummer</span> · 8,99€/Mo · 70 Min inkl. · +0,20€/Min Überschreitung
            </span>
          </div>
          {currentPlan !== 'nummer' ? (
            <button onClick={() => handleUpgrade('nummer')} disabled={!!actionLoading}
              className="text-sm font-medium text-orange-400 hover:text-orange-300 transition-colors whitespace-nowrap">
              {actionLoading === 'nummer' ? '…' : 'Nummer aktivieren →'}
            </button>
          ) : (
            <span className="text-xs text-orange-300/60">Aktiv</span>
          )}
        </div>
      </div>

      {/* Overage note */}
      <p className="text-xs text-white/30">
        Überschreitung: Nummer 0,20€/Min · Starter 0,10€/Min · Pro 0,08€/Min · Agency 0,06€/Min. Alle Preise zzgl. MwSt.
      </p>
    </div>
  );
}
