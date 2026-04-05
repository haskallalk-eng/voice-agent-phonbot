import React, { useEffect, useState } from 'react';
import { EmptyState } from '../components/ui.js';
import { getTickets, updateTicketStatus, triggerTicketCallback, type Ticket } from '../lib/api.js';

const STATUS_STYLES: Record<Ticket['status'], string> = {
  open: 'bg-green-500/20 text-green-400',
  assigned: 'bg-yellow-500/20 text-yellow-400',
  done: 'bg-white/10 text-white/40',
};

const STATUS_LABELS: Record<Ticket['status'], string> = {
  open: 'Offen',
  assigned: 'Zugewiesen',
  done: 'Erledigt',
};

export function TicketInbox() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Ticket['status'] | 'all'>('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  async function load() {
    setLoading(true);
    try {
      const res = await getTickets();
      setTickets(res.items);
    } catch {
      // silent
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
    } catch {
      // Reload to show current state even if update failed
      await load();
    }
  }

  const filtered = filter === 'all' ? tickets : tickets.filter((t) => t.status === filter);

  const counts = {
    all: tickets.length,
    open: tickets.filter((t) => t.status === 'open').length,
    assigned: tickets.filter((t) => t.status === 'assigned').length,
    done: tickets.filter((t) => t.status === 'done').length,
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Ticket Inbox</h2>
          <p className="text-sm text-white/50 mt-1">Callbacks und Handoffs deiner Kunden.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-sm text-orange-400 hover:text-orange-300 transition-colors"
        >
          {loading ? 'Lade…' : 'Aktualisieren'}
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 bg-white/5 p-1 rounded-xl w-fit border border-white/10">
        {(['all', 'open', 'assigned', 'done'] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setFilter(s); setPage(1); }}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              filter === s
                ? 'bg-white/10 text-white font-medium shadow-sm'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            {s === 'all' ? 'Alle' : STATUS_LABELS[s]}{' '}
            <span className="text-xs text-white/30">({counts[s]})</span>
          </button>
        ))}
      </div>

      {/* Ticket list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          title="Keine Tickets"
          description={filter !== 'all' ? `Keine Tickets mit Status "${STATUS_LABELS[filter as Ticket['status']]}"` : 'Wenn Anrufer einen Rückruf wünschen, erscheinen die Tickets hier.'}
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
            <span className="text-sm text-white/40">{filtered.length} Tickets</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm rounded-lg bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-30"
              >Zurück</button>
              <span className="px-3 py-1.5 text-sm text-white/40">
                {page} / {Math.ceil(filtered.length / PAGE_SIZE)}
              </span>
              <button
                onClick={() => setPage(p => Math.min(Math.ceil(filtered.length / PAGE_SIZE), p + 1))}
                disabled={page >= Math.ceil(filtered.length / PAGE_SIZE)}
                className="px-3 py-1.5 text-sm rounded-lg bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-30"
              >Weiter</button>
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
  const [calling, setCalling] = useState(false);
  const [callResult, setCallResult] = useState<'ok' | 'error' | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  async function handleCallback() {
    setCalling(true);
    setCallResult(null);
    setCallError(null);
    try {
      const res = await triggerTicketCallback(t.id);
      setCallResult(res.ok ? 'ok' : 'error');
      if (!res.ok) setCallError(res.error ?? 'Fehler');
    } catch (e: unknown) {
      setCallResult('error');
      setCallError(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-sm font-semibold text-white/60">#{t.id}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[t.status]}`}>
              {STATUS_LABELS[t.status]}
            </span>
            {t.reason && (
              <span className="text-xs text-white/30">{t.reason}</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div>
              <span className="text-white/40">Name:</span>{' '}
              <span className="text-white/80">{t.customer_name ?? '–'}</span>
            </div>
            <div>
              <span className="text-white/40">Telefon:</span>{' '}
              <span className="text-white/80 font-mono">{t.customer_phone}</span>
            </div>
            <div>
              <span className="text-white/40">Wunschtermin:</span>{' '}
              <span className="text-white/80">{t.preferred_time ?? '–'}</span>
            </div>
            <div>
              <span className="text-white/40">Service:</span>{' '}
              <span className="text-white/80">{t.service ?? '–'}</span>
            </div>
          </div>

          {t.notes && (
            <p className="text-sm text-white/50 mt-2 bg-white/5 rounded-lg px-3 py-2">{t.notes}</p>
          )}

          <div className="text-xs text-white/30 mt-2">
            {new Date(t.created_at).toLocaleString('de-DE')}
            {t.source && <> · Quelle: {t.source}</>}
          </div>

          {/* Callback feedback */}
          {callResult === 'ok' && (
            <p className="text-xs text-green-400 mt-2">✓ Rückruf gestartet — Agent ruft jetzt an.</p>
          )}
          {callResult === 'error' && (
            <p className="text-xs text-red-400 mt-2">
              {callError === 'NO_OUTBOUND_NUMBER'
                ? 'Keine Outbound-Nummer konfiguriert. Provisioniere zuerst eine Telefonnummer.'
                : `Fehler: ${callError}`}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5 shrink-0">
          {/* Callback button — only for open/assigned tickets with a phone number */}
          {t.status !== 'done' && t.customer_phone && (
            <button
              onClick={handleCallback}
              disabled={calling}
              className="text-xs px-3 py-1 rounded-lg border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 hover:border-orange-500/50 transition-colors disabled:opacity-40"
            >
              {calling ? '…' : '📞 Zurückrufen'}
            </button>
          )}
          {t.status !== 'open' && (
            <StatusButton label="Offen" onClick={() => onChangeStatus(t.id, 'open')} />
          )}
          {t.status !== 'assigned' && (
            <StatusButton label="Zuweisen" onClick={() => onChangeStatus(t.id, 'assigned')} />
          )}
          {t.status !== 'done' && (
            <StatusButton label="Erledigt" onClick={() => onChangeStatus(t.id, 'done')} />
          )}
        </div>
      </div>
    </div>
  );
}

function StatusButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-xs px-3 py-1 rounded-lg border border-white/10 text-white/50 hover:bg-white/5 hover:text-white/80 transition-colors"
    >
      {label}
    </button>
  );
}
