import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getBillingStatus,
  getCalls,
  getTickets,
  getAgentConfig,
  getChippyBookings,
  type BillingStatus,
  type RetellCall,
  type Ticket,
  type AgentConfig,
  type ChippyBooking,
} from '../lib/api.js';
import type { Page } from './App.js';
import { SkeletonCard } from '../components/ui.js';
import { FoxLogo } from './FoxLogo.js';
import {
  IconCalls,
  IconPhone,
  IconTickets,
  IconBilling,
  IconAgent,
  IconTest,
  IconCalendar,
} from './PhonbotIcons.js';

type Props = {
  onNavigate: (page: Page) => void;
};

function StatCard({
  Icon,
  label,
  value,
  sub,
}: {
  Icon: React.FC<{ size?: number; className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="glass rounded-2xl p-5 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-white/50 text-sm">
        <Icon size={16} className="shrink-0" />
        <span>{label}</span>
      </div>
      <p className="text-3xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-white/40">{sub}</p>}
    </div>
  );
}

function formatTime(ts?: number): string {
  if (!ts) return '–';
  return new Date(ts).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms?: number): string {
  if (!ms) return '–';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

const STATUS_STYLES: Record<string, string> = {
  ended: 'bg-green-500/20 text-green-400',
  ongoing: 'bg-blue-500/20 text-blue-400',
  registered: 'bg-yellow-500/20 text-yellow-400',
  error: 'bg-red-500/20 text-red-400',
};

const TICKET_STATUS_STYLES: Record<string, string> = {
  open: 'bg-green-500/20 text-green-400',
  assigned: 'bg-yellow-500/20 text-yellow-400',
  done: 'bg-white/10 text-white/40',
};

const TICKET_STATUS_LABELS: Record<string, string> = {
  open: 'Offen',
  assigned: 'Zugewiesen',
  done: 'Erledigt',
};

export function DashboardHome({ onNavigate }: Props) {
  const { data, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const bookingsFrom = new Date().toISOString().slice(0, 10);
      const bookingsTo = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const [b, c, t, a, bk] = await Promise.all([
        getBillingStatus().catch((err) => { console.error('getBillingStatus failed', err); return null; }),
        getCalls().catch((err) => { console.error('getCalls failed', err); return { items: [] as RetellCall[] }; }),
        getTickets().catch((err) => { console.error('getTickets failed', err); return { items: [] as Ticket[] }; }),
        getAgentConfig().catch((err) => { console.error('getAgentConfig failed', err); return null; }),
        getChippyBookings(bookingsFrom, bookingsTo).catch(() => ({ bookings: [] as ChippyBooking[] })),
      ]);
      return {
        billing: b,
        calls: c?.items ?? [],
        tickets: t?.items ?? [],
        agentConfig: a,
        bookings: bk?.bookings ?? [],
      };
    },
  });

  const billing = data?.billing ?? null;
  const calls = data?.calls ?? [];
  const tickets = data?.tickets ?? [];
  const agentConfig = data?.agentConfig ?? null;
  const bookings = data?.bookings ?? [];
  const error = queryError ? 'Daten konnten nicht geladen werden' : null;

  // Upcoming bookings – sorted by slot_time, max 4
  const upcomingBookings = [...bookings]
    .sort((a, b) => new Date(a.slot_time).getTime() - new Date(b.slot_time).getTime())
    .slice(0, 4);

  // Derived stats
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const callsToday = calls.filter(
    (c) => c.start_timestamp && c.start_timestamp >= todayStart.getTime()
  ).length;

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const callsThisWeek = calls.filter(
    (c) => c.start_timestamp && c.start_timestamp >= weekStart.getTime()
  ).length;

  const savedMinutes = calls.length * 3;
  const savedHours = (savedMinutes / 60).toFixed(1);

  const avgDurationMs =
    calls.length > 0
      ? calls.reduce((sum, c) => sum + (c.duration_ms ?? 0), 0) / calls.length
      : 0;

  const successRate =
    calls.length > 0
      ? Math.round((calls.filter((c) => c.call_status === 'ended').length / calls.length) * 100)
      : 0;

  const openTickets = tickets.filter((t) => t.status === 'open').length;
  const solvedTickets = tickets.filter((t) => t.status === 'done').length;

  const recentCalls = calls.slice(0, 5);
  const recentOpenTickets = tickets.filter((t) => t.status === 'open').slice(0, 5);

  // Checklist
  const step1Done = !!(agentConfig?.name && agentConfig.name !== 'Demo Business' && agentConfig.name !== '');
  const step2Done = !!agentConfig?.retellAgentId;
  const step3Done = calls.length > 0;
  const step4Done = !!(agentConfig as (AgentConfig & { phoneNumber?: string }) | null)?.phoneNumber;
  const step5Done = step1Done && step2Done && step3Done && step4Done;
  const allSetupDone = step1Done && step2Done && step3Done;

  if (loading) return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <SkeletonCard />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
      <SkeletonCard />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <FoxLogo size="lg" animate />
        <div>
          <h2 className="text-3xl font-bold text-white">Dashboard</h2>
          <p className="text-white/50 mt-1 text-sm">Hier ist dein Überblick.</p>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          {error}
        </div>
      )}

      {/* Getting-started / All done */}
      {!loading && (
        allSetupDone ? (
          <div
            className="glass rounded-2xl p-6 border border-green-500/20"
            style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.08), rgba(6,182,212,0.05))' }}
          >
            <div className="flex items-center gap-3">
              <div>
                <h3 className="text-lg font-bold text-white">Alles eingerichtet!</h3>
                <p className="text-sm text-white/60 mt-0.5">
                  Dein Agent ist konfiguriert und aktiv. Schau dir die Anruf-Logs an.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="glass rounded-2xl p-6 border border-orange-500/20"
            style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.08), rgba(6,182,212,0.05))' }}
          >
            <h3 className="text-lg font-bold text-white mb-2">Willkommen bei Phonbot!</h3>
            <p className="text-sm text-white/60 mb-4">
              Dein KI-Telefonassistent ist fast startklar. Folge diesen Schritten:
            </p>
            <ol className="space-y-3 text-sm mb-5">
              {[
                { label: 'Agent konfiguriert', done: step1Done, action: () => onNavigate('agent') },
                { label: 'Agent deployed', done: step2Done, action: () => onNavigate('agent') },
                { label: 'Erster Testanruf', done: step3Done, action: () => onNavigate('test') },
                { label: 'Telefonnummer verbunden', done: step4Done, action: () => onNavigate('phone') },
                { label: 'Live gehen', done: step5Done, action: () => onNavigate('phone') },
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  {step.done ? (
                    <span className="w-5 h-5 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                      ✓
                    </span>
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                  )}
                  <button
                    onClick={step.action}
                    className={`text-left ${step.done ? 'text-white/40 line-through' : 'text-white/70 hover:text-white'} transition-colors`}
                  >
                    {step.label}
                  </button>
                </li>
              ))}
            </ol>
            {!step1Done && (
              <button
                onClick={() => onNavigate('agent')}
                className="rounded-lg bg-gradient-to-r from-orange-500 to-cyan-500 px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
              >
                Jetzt Agent einrichten
              </button>
            )}
          </div>
        )
      )}

      {/* Stats Grid – 2 rows */}
      <div className="space-y-4">
          {/* Row 1 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              Icon={IconCalls}
              label="Calls heute"
              value={callsToday}
              sub={`${calls.length} gesamt`}
            />
            <StatCard
              Icon={IconPhone}
              label="Zeit gespart"
              value={`~${savedHours} Std`}
              sub={`${savedMinutes} Min / ${calls.length} Calls`}
            />
            <StatCard
              Icon={IconTickets}
              label="Offene Tickets"
              value={openTickets}
              sub={`${tickets.length} gesamt`}
            />
            <StatCard
              Icon={IconBilling}
              label="Plan"
              value={billing?.planName ?? 'Free'}
              sub={billing?.planStatus ?? undefined}
            />
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              Icon={IconCalendar}
              label="Calls diese Woche"
              value={callsThisWeek}
              sub="laufende Woche"
            />
            <StatCard
              Icon={IconCalls}
              label="Ø Dauer"
              value={formatDuration(avgDurationMs)}
              sub="Durchschnitt"
            />
            <StatCard
              Icon={IconAgent}
              label="Erfolgsrate"
              value={`${successRate}%`}
              sub="status=ended"
            />
            <StatCard
              Icon={IconTickets}
              label="Tickets gelöst"
              value={solvedTickets}
              sub={`von ${tickets.length} gesamt`}
            />
          </div>
      </div>

      {/* Quick Actions */}
      <div className="glass rounded-2xl p-6">
        <h3 className="text-white font-semibold mb-4">Schnellaktionen</h3>
        <div className="flex flex-wrap gap-3">
          {/* Primary — outline-only with orange accent */}
          <button
            onClick={() => onNavigate('test')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium
              bg-transparent border border-orange-500/40 text-orange-300
              hover:border-orange-500/60 hover:text-white hover:shadow-[0_0_14px_rgba(249,115,22,0.25)]
              transition-all duration-200"
          >
            <IconTest size={16} />
            Agent testen
          </button>

          {/* Secondary */}
          {(
            [
              { label: 'Nummer verbinden', Icon: IconPhone, page: 'phone' as Page },
              { label: 'Plan upgraden', Icon: IconBilling, page: 'billing' as Page },
              { label: 'Anrufe ansehen', Icon: IconCalls, page: 'logs' as Page },
              { label: 'Tickets prüfen', Icon: IconTickets, page: 'tickets' as Page },
            ] as const
          ).map(({ label, Icon, page }) => (
            <button
              key={page}
              onClick={() => onNavigate(page)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white
                bg-transparent border border-white/15
                hover:border-orange-500/60 hover:text-white hover:shadow-[0_0_14px_rgba(249,115,22,0.25)]
                transition-all duration-200"
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Calls */}
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">Letzte Calls</h3>
            <button
              onClick={() => onNavigate('logs')}
              className="text-xs text-white/40 hover:text-white/70 transition-colors"
            >
              Alle anzeigen →
            </button>
          </div>
          {recentCalls.length === 0 ? (
            <div className="text-center py-8 text-white/30">
              <IconCalls size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium text-white/40 mb-1">Noch keine Anrufe</p>
              <p className="text-xs text-white/25">Teste deinen Agenten zuerst in der Test Console.</p>
              <button
                onClick={() => onNavigate('test')}
                className="mt-3 text-xs text-orange-400/70 hover:text-orange-400 transition-colors underline"
              >
                Zur Test Console →
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {recentCalls.map((call) => (
                <div
                  key={call.call_id}
                  className="flex items-center justify-between px-4 py-3 bg-white/5 rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        STATUS_STYLES[call.call_status] ?? 'bg-white/10 text-white/50'
                      }`}
                    >
                      {call.call_status}
                    </span>
                    <span className="text-sm text-white/60">{formatDuration(call.duration_ms)}</span>
                  </div>
                  <span className="text-xs text-white/40">{formatTime(call.start_timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Open Tickets */}
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">Offene Tickets</h3>
            <button
              onClick={() => onNavigate('tickets')}
              className="text-xs text-white/40 hover:text-white/70 transition-colors"
            >
              Alle anzeigen →
            </button>
          </div>
          {recentOpenTickets.length === 0 ? (
            <div className="text-center py-8 text-white/30">
              <IconTickets size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Keine offenen Tickets</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentOpenTickets.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between px-4 py-3 bg-white/5 rounded-xl"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                        TICKET_STATUS_STYLES[t.status] ?? 'bg-white/10 text-white/50'
                      }`}
                    >
                      {TICKET_STATUS_LABELS[t.status] ?? t.status}
                    </span>
                    <span className="text-sm text-white truncate">
                      {t.customer_name ?? t.customer_phone}
                    </span>
                  </div>
                  <span className="text-xs text-white/40 shrink-0 ml-2">
                    {new Date(t.created_at).toLocaleDateString('de-DE')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Nächste Termine */}
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">Nächste Termine</h3>
            <button onClick={() => onNavigate('calendar')} className="text-xs text-white/40 hover:text-white/70 transition-colors">
              Kalender →
            </button>
          </div>
          {upcomingBookings.length === 0 ? (
            <div className="text-center py-8 text-white/30">
              <IconCalendar size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium text-white/40 mb-1">Keine Termine</p>
              <p className="text-xs text-white/25">Termine werden automatisch vom Agent gebucht.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {upcomingBookings.map(b => (
                <div key={b.id} className="flex items-center justify-between px-4 py-3 bg-white/5 rounded-xl">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-orange-500/15 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-orange-400">
                        {new Date(b.slot_time).getDate()}.{(new Date(b.slot_time).getMonth()+1)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{b.customer_name}</p>
                      <p className="text-xs text-white/40 truncate">{b.service ?? 'Termin'}</p>
                    </div>
                  </div>
                  <span className="text-xs text-white/50 shrink-0 ml-2">
                    {new Date(b.slot_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
