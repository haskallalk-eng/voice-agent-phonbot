import React, { useEffect, useState } from 'react';
import {
  getBillingPlans,
  getBillingStatus,
  createCheckoutSession,
  createPortalSession,
  type Plan,
  type BillingStatus,
} from '../lib/api.js';

const PLAN_FEATURES: Record<string, string[]> = {
  free: ['100 Freiminuten (einmalig)', '1 Agent', 'Web-Call Test', 'Community Support'],
  starter: ['500 Minuten / Monat', '1 Agent', 'Telefonnummer inklusive', 'Ticket-System', 'E-Mail Support', '+0,10€/Min bei Überschreitung'],
  pro: ['2.000 Minuten / Monat', '3 Agents', '2 Telefonnummern', 'Analytics Dashboard', 'Priority Support', '+0,08€/Min bei Überschreitung'],
  agency: ['5.000 Minuten / Monat', '10 Agents', 'White-Label', 'Dedicated Support', 'API-Zugang', '+0,06€/Min bei Überschreitung'],
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
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [interval, setInterval] = useState<'month' | 'year'>('month');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success')) setFlash({ type: 'ok', text: 'Zahlung erfolgreich! Dein Plan wurde aktiviert.' });
    if (params.get('canceled')) setFlash({ type: 'error', text: 'Zahlung abgebrochen.' });
    if (params.has('success') || params.has('canceled')) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    Promise.all([getBillingStatus(), getBillingPlans()])
      .then(([s, p]) => { setStatus(s); setPlans(p.plans); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleUpgrade(planId: string) {
    setActionLoading(planId);
    try {
      const { url } = await createCheckoutSession(planId, interval);
      window.location.href = url;
    } catch (e: unknown) {
      setFlash({ type: 'error', text: (e instanceof Error ? e.message : null) ?? 'Fehler beim Öffnen des Checkouts' });
      setActionLoading(null);
    }
  }

  async function handlePortal() {
    setActionLoading('portal');
    try {
      const { url } = await createPortalSession();
      window.location.href = url;
    } catch (e: unknown) {
      setFlash({ type: 'error', text: (e instanceof Error ? e.message : null) ?? 'Fehler beim Öffnen des Portals' });
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white/30 text-sm">Lade Billing…</p>
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
      {flash && (
        <div className={`rounded-xl px-4 py-3 text-sm border ${
          flash.type === 'ok'
            ? 'bg-green-500/10 text-green-400 border-green-500/20'
            : 'bg-red-500/10 text-red-400 border-red-500/20'
        }`}>
          {flash.text}
          <button onClick={() => setFlash(null)} className="ml-3 opacity-50 hover:opacity-100">✕</button>
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
                onClick={() => setInterval('month')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  interval === 'month' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                Monatlich
              </button>
              <button
                onClick={() => setInterval('year')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  interval === 'year' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => {
            const isCurrent = plan.id === currentPlan;
            const features = PLAN_FEATURES[plan.id] ?? [];
            const showYearly = interval === 'year' && plan.hasYearly && plan.price > 0;
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
                      <span className="text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full">
                        Aktuell
                      </span>
                    )}
                  </div>
                  {showYearly ? (
                    <div>
                      <p className="text-2xl font-bold text-white">
                        {yearlyMonthlyPrice}€
                        <span className="text-sm font-normal text-white/40">/Mo</span>
                      </p>
                      <p className="text-xs text-white/30 mt-0.5">
                        <span className="line-through">{plan.price}€</span>
                        {' '}· {plan.price * 10}€/Jahr
                      </p>
                    </div>
                  ) : (
                    <p className="text-2xl font-bold text-white">
                      {plan.price === 0 ? 'Gratis' : `${plan.price}€`}
                      {plan.price > 0 && <span className="text-sm font-normal text-white/40">/Mo</span>}
                    </p>
                  )}
                </div>

                <ul className="space-y-1.5 flex-1">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-white/60">
                      <span className="text-green-400 mt-0.5">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {!isCurrent && plan.id !== 'free' && (
                  <button
                    onClick={() => handleUpgrade(plan.id)}
                    disabled={!!actionLoading}
                    className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-cyan-500 hover:opacity-90 disabled:opacity-50 text-white text-sm font-medium py-2 transition-opacity"
                  >
                    {actionLoading === plan.id ? '…' : `Zu ${plan.name} wechseln`}
                  </button>
                )}

                {isCurrent && isPaid && (
                  <button
                    onClick={handlePortal}
                    disabled={!!actionLoading}
                    className="w-full rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white/60 text-sm font-medium py-2 transition-colors disabled:opacity-50"
                  >
                    {actionLoading === 'portal' ? '…' : 'Verwalten'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Overage note */}
      <p className="text-xs text-white/30">
        Überschreitung: Starter 0,10€/Min · Pro 0,08€/Min · Agency 0,06€/Min. Alle Preise zzgl. MwSt.
      </p>
    </div>
  );
}
