import React, { useEffect, useState } from 'react';
import { getCalls, getCall, type RetellCall } from '../lib/api.js';

const STATUS_STYLES: Record<string, string> = {
  ended: 'bg-green-500/20 text-green-400',
  ongoing: 'bg-blue-500/20 text-blue-400',
  registered: 'bg-yellow-500/20 text-yellow-400',
  error: 'bg-red-500/20 text-red-400',
};

function formatDuration(ms?: number): string {
  if (!ms) return '–';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function formatTime(ts?: number): string {
  if (!ts) return '–';
  return new Date(ts).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function CallLog() {
  const [calls, setCalls] = useState<RetellCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCall, setSelectedCall] = useState<RetellCall | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await getCalls();
      setCalls(res.items ?? []);
    } catch {
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function openDetail(callId: string) {
    setDetailLoading(true);
    try {
      const call = await getCall(callId);
      setSelectedCall(call);
    } catch {
      // silent
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Call Log</h2>
          <p className="text-sm text-white/50 mt-1">Alle Calls deines Agents – Transcript, Dauer, Status.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-sm text-orange-400 hover:text-orange-300 transition-colors"
        >
          {loading ? 'Lade…' : 'Aktualisieren'}
        </button>
      </div>

      {/* Detail Modal */}
      {selectedCall && (
        <div className="mb-6 glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Call Detail</h3>
            <button onClick={() => setSelectedCall(null)} className="text-sm text-white/40 hover:text-white/70">✕ Schließen</button>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm mb-4">
            <div><span className="text-white/40">Call ID:</span> <code className="font-mono text-xs text-white/70">{selectedCall.call_id}</code></div>
            <div><span className="text-white/40">Status:</span> <span className="text-white/80">{selectedCall.call_status}</span></div>
            <div><span className="text-white/40">Typ:</span> <span className="text-white/80">{selectedCall.call_type}</span></div>
            <div><span className="text-white/40">Dauer:</span> <span className="text-white/80">{formatDuration(selectedCall.duration_ms)}</span></div>
            <div><span className="text-white/40">Start:</span> <span className="text-white/80">{formatTime(selectedCall.start_timestamp)}</span></div>
            <div><span className="text-white/40">Ende:</span> <span className="text-white/80">{formatTime(selectedCall.end_timestamp)}</span></div>
            {selectedCall.disconnection_reason && (
              <div className="col-span-2"><span className="text-white/40">Grund:</span> <span className="text-white/80">{selectedCall.disconnection_reason}</span></div>
            )}
          </div>
          {selectedCall.transcript && (
            <div>
              <h4 className="text-sm font-medium text-white/40 mb-2">Transcript</h4>
              <pre className="bg-black/40 border border-white/5 text-white/70 text-xs p-4 rounded-xl overflow-auto max-h-80 whitespace-pre-wrap">
                {selectedCall.transcript}
              </pre>
            </div>
          )}
          {selectedCall.recording_url && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-white/40 mb-2">Aufnahme</h4>
              <audio controls src={selectedCall.recording_url} className="w-full" />
            </div>
          )}
        </div>
      )}

      {/* Call List */}
      {calls.length === 0 ? (
        <div className="text-center py-16 text-white/30">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-sm">{loading ? 'Lade Calls…' : 'Noch keine Calls vorhanden.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {calls.map((call) => (
            <button
              key={call.call_id}
              onClick={() => openDetail(call.call_id)}
              className="w-full text-left glass rounded-2xl p-4 hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[call.call_status] ?? 'bg-white/10 text-white/50'}`}>
                    {call.call_status}
                  </span>
                  <span className="text-sm font-medium text-white/70">{call.call_type}</span>
                  <span className="text-xs text-white/40">{formatDuration(call.duration_ms)}</span>
                </div>
                <span className="text-xs text-white/40">{formatTime(call.start_timestamp)}</span>
              </div>
              <p className="text-xs text-white/30 mt-1 font-mono truncate">{call.call_id}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
