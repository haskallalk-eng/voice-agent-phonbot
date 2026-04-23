import React, { useEffect, useState } from 'react';
import { EmptyState } from '../components/ui.js';
import { getTickets, updateTicketStatus, type Ticket } from '../lib/api.js';
import { IconPhone, IconPhoneOff, IconRefresh, IconCheckCircle, IconAlertTriangle, IconTickets } from './PhonbotIcons.js';

// 'assigned' is still a valid status in the API/DB for legacy rows, but we
// don't expose it in the UI anymore — user asked to remove "Zugewiesen"
// (2026-04-22). Any incoming `assigned` ticket is displayed and filtered
// as if it were `open` so nothing drops out of the inbox.
type DisplayStatus = 'open' | 'done';
const displayStatus = (s: Ticket['status']): DisplayStatus => (s === 'done' ? 'done' : 'open');

const STATUS_LABELS: Record<DisplayStatus, string> = {
  open: 'Offen',
  done: 'Erledigt',
};

const STATUS_BADGE: Record<DisplayStatus, string> = {
  open: 'bg-orange-500/15 text-orange-400 border border-orange-500/25',
  done: 'bg-white/5 text-white/40 border border-white/10',
};

// 'unknown' occasionally arrives as a literal string for fields that
// Chipy couldn't capture on the call. Treat it the same as null/empty
// so the card shows a clean '–' and the ticket is flagged incomplete.
function fieldValue(v: string | null | undefined): string {
  if (v === null || v === undefined) return '–';
  const trimmed = v.trim();
  if (!trimmed) return '–';
  if (trimmed.toLowerCase() === 'unknown' || trimmed.toLowerCase() === 'unbekannt') return '–';
  return trimmed;
}
// A ticket is 'incomplete' whenever we don't have a dial-able phone
// number — that's the one field a callback actually needs, and Chipy is
// supposed to read it back on the call and write it down. If it's
// empty the agent most likely hung up before the number was captured.
function phoneUsable(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const trimmed = phone.trim();
  if (!trimmed) return false;
  return trimmed.toLowerCase() !== 'unknown' && trimmed.toLowerCase() !== 'unbekannt';
}

export function TicketInbox() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DisplayStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  async function load() {
    setLoading(true);
    try {
      const res = await getTickets();
      setTickets(res.items);
    } catch (err) {
      console.error('Failed to load tickets', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function changeStatus(id: number, status: Ticket['status']) {
    try {
      await updateTicketStatus(id, status);
      await load();
    } catch (err) {
      console.error('Failed to update ticket status', err);
      await load();
    }
  }

  const filtered = filter === 'all' ? tickets : tickets.filter((t) => displayStatus(t.status) === filter);

  const counts = {
    all: tickets.length,
    open: tickets.filter((t) => displayStatus(t.status) === 'open').length,
    done: tickets.filter((t) => displayStatus(t.status) === 'done').length,
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">Ticket-Eingang</h2>
          <p className="text-sm text-white/50 mt-1">Rückrufe und Handoffs deiner Kunden.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          aria-label="Tickets neu laden"
          className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white rounded-full px-4 py-2 bg-white/5 border border-white/10 backdrop-blur-md hover:bg-white/10 transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
        >
          <IconRefresh size={14} className={loading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{loading ? 'Lade…' : 'Aktualisieren'}</span>
        </button>
      </div>

      {/* Filter — segmented pill */}
      <div
        role="tablist"
        aria-label="Ticket-Status filtern"
        className="inline-flex p-1 mb-6 rounded-full bg-white/5 border border-white/10 backdrop-blur-md"
      >
        {(['all', 'open', 'done'] as const).map((s) => {
          const active = filter === s;
          const label = s === 'all' ? 'Alle' : STATUS_LABELS[s];
          return (
            <button
              key={s}
              role="tab"
              aria-selected={active}
              onClick={() => { setFilter(s); setPage(1); }}
              className={`relative inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 ${
                active
                  ? 'text-white font-medium bg-orange-500/15 border border-orange-500/25 shadow-[0_0_14px_rgba(249,115,22,0.18)]'
                  : 'text-white/50 hover:text-white/80 border border-transparent'
              }`}
            >
              {label}
              <span className={`text-xs tabular-nums ${active ? 'text-orange-300' : 'text-white/30'}`}>
                {counts[s]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Ticket list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<IconTickets size={48} className="text-white/30" />}
          title="Keine Tickets"
          description={
            filter === 'all'
              ? 'Wenn Anrufer einen Rückruf wünschen, erscheinen die Tickets hier.'
              : `Kein Ticket mit Status „${STATUS_LABELS[filter]}".`
          }
        />
      ) : (
        <>
          <div className="space-y-3">
            {filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((t) => (
              <TicketCard key={t.id} ticket={t} onChangeStatus={changeStatus} />
            ))}
          </div>
          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-4 px-2">
              <span className="text-sm text-white/40 tabular-nums">{filtered.length} Tickets</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm rounded-full bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Zurück
                </button>
                <span className="px-3 py-1.5 text-sm text-white/40 tabular-nums">
                  {page} / {Math.ceil(filtered.length / PAGE_SIZE)}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(Math.ceil(filtered.length / PAGE_SIZE), p + 1))}
                  disabled={page >= Math.ceil(filtered.length / PAGE_SIZE)}
                  className="px-3 py-1.5 text-sm rounded-full bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Weiter
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TicketCard({
  ticket: t,
  onChangeStatus,
}: {
  ticket: Ticket;
  onChangeStatus: (id: number, s: Ticket['status']) => void;
}) {
  const [copyResult, setCopyResult] = useState<'ok' | 'error' | null>(null);
  const dStatus = displayStatus(t.status);
  const hasPhone = phoneUsable(t.customer_phone);
  const isIncomplete = !hasPhone;

  async function handleCopyNumber() {
    if (!hasPhone) return;
    try {
      await navigator.clipboard.writeText(t.customer_phone.trim());
      setCopyResult('ok');
    } catch {
      setCopyResult('error');
    }
    // Auto-hide the feedback pill after 2.5 s so the next click feels
    // like a fresh confirmation.
    window.setTimeout(() => setCopyResult(null), 2500);
  }

  return (
    <div
      className={`glass rounded-2xl p-5 transition-all duration-200 ${
        isIncomplete
          ? 'opacity-60 hover:opacity-80 grayscale-[40%]'
          : 'hover:border-white/15'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5 mb-3">
            <span className="text-sm font-semibold text-white/60 tabular-nums">#{t.id}</span>
            <span className={`inline-flex items-center text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_BADGE[dStatus]}`}>
              {STATUS_LABELS[dStatus]}
            </span>
            {isIncomplete && (
              <span
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-white/15 bg-white/[0.04] text-white/50"
                title="Chipy konnte die Rufnummer nicht erfassen — Ticket ist unvollständig."
              >
                <IconAlertTriangle size={11} />
                Unvollständig
              </span>
            )}
            {t.reason && (
              <span className="text-xs text-white/35 truncate">{t.reason}</span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div>
              <span className="text-white/40">Name:</span>{' '}
              <span className="text-white/80">{fieldValue(t.customer_name)}</span>
            </div>
            <div>
              <span className="text-white/40">Telefon:</span>{' '}
              <span className={`${hasPhone ? 'text-white/80' : 'text-white/35'} font-mono tabular-nums`}>
                {hasPhone ? t.customer_phone : '–'}
              </span>
            </div>
            <div>
              <span className="text-white/40">Wunschtermin:</span>{' '}
              <span className="text-white/80">{fieldValue(t.preferred_time)}</span>
            </div>
            <div>
              <span className="text-white/40">Service:</span>{' '}
              <span className="text-white/80">{fieldValue(t.service)}</span>
            </div>
          </div>

          {t.notes && (
            <p className="text-sm text-white/60 mt-3 bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5">
              {t.notes}
            </p>
          )}

          <TicketMetadata metadata={t.metadata} />

          <div className="text-xs text-white/30 mt-3 tabular-nums">
            {new Date(t.created_at).toLocaleString('de-DE')}
            {t.source && <> · Quelle: {t.source}</>}
          </div>

          {/* Copy feedback */}
          {copyResult === 'ok' && (
            <p className="inline-flex items-center gap-1.5 text-xs text-orange-300 mt-3 bg-orange-500/10 border border-orange-500/20 rounded-full px-2.5 py-1">
              <IconCheckCircle size={14} />
              Nummer kopiert: <span className="font-mono tabular-nums">{t.customer_phone}</span>
            </p>
          )}
          {copyResult === 'error' && (
            <p className="inline-flex items-center gap-1.5 text-xs text-red-300 mt-3 bg-red-500/10 border border-red-500/30 rounded-full px-2.5 py-1">
              <IconAlertTriangle size={14} />
              Konnte Nummer nicht kopieren — manuell markieren.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5 shrink-0">
          {/* Copy-number action — only for tickets that actually have a phone
              number. No API call; this just drops the number into the
              clipboard so the user can dial it manually from their own
              phone. Without a number we show a small static hint instead so
              the user knows *why* the action is unavailable. */}
          {hasPhone && (
            <button
              onClick={handleCopyNumber}
              title={`Nummer in die Zwischenablage kopieren: ${t.customer_phone}`}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-orange-500/30 text-orange-300 hover:bg-orange-500/10 hover:border-orange-500/50 hover:text-orange-200 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
            >
              <IconPhone size={12} />
              Nummer kopieren
            </button>
          )}
          {!hasPhone && (
            <span
              className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03] text-white/45 leading-tight"
              title="Der Anrufer hat keine Rufnummer hinterlegt — ein manueller Rückruf ist nicht möglich."
            >
              <IconPhoneOff size={12} />
              Keine Rufnummer hinterlegt
            </span>
          )}

          {/* Status toggle — one binary action per state */}
          {dStatus === 'open' ? (
            <StatusButton
              icon={<IconCheckCircle size={12} />}
              label="Erledigt"
              onClick={() => onChangeStatus(t.id, 'done')}
            />
          ) : (
            <StatusButton
              icon={<IconRefresh size={12} />}
              label="Wieder öffnen"
              onClick={() => onChangeStatus(t.id, 'open')}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StatusButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-white/10 text-white/55 hover:bg-white/5 hover:text-white/85 hover:border-white/20 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Renders the extracted-variables block below the standard ticket fields.
 * Shows nothing when metadata is empty or only contains an empty
 * `sonstige_relevante_infos`. Keys are displayed in the original form the
 * customer chose in Agent-Builder → Variablen extrahieren, so "kundenbranche"
 * appears as "kundenbranche" — matching what their downstream systems see.
 */
function TicketMetadata({ metadata }: { metadata?: Record<string, unknown> }) {
  if (!metadata) return null;
  const entries = Object.entries(metadata).filter(([, v]) => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string' && !v.trim()) return false;
    return true;
  });
  if (entries.length === 0) return null;

  return (
    <dl className="mt-3 bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-sm space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3">
          <dt className="text-xs text-white/40 font-mono truncate" title={k}>{k}</dt>
          <dd className="text-white/80 break-words">{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
