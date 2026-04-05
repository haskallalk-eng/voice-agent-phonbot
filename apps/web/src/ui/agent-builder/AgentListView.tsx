import React, { useState, useEffect } from 'react';
import type { AgentConfig } from '../../lib/api.js';
import { deleteAgent } from '../../lib/api.js';
import { IconAgent } from './shared.js';

function usePhoneNumbers() {
  const [numbers, setNumbers] = useState<{ agent_id: string | null }[]>([]);
  useEffect(() => {
    fetch('/api/phone', { headers: { authorization: `Bearer ${localStorage.getItem('vas_token') ?? ''}` } })
      .then(r => r.json())
      .then(d => setNumbers(d.items ?? []))
      .catch(() => {});
  }, []);
  return numbers;
}

export interface AgentListViewProps {
  allAgents: AgentConfig[];
  config: AgentConfig | null;
  agentsLimit: number;
  creatingAgent: boolean;
  status: { type: 'ok' | 'error'; text: string } | null;
  onSelectAgent: (tenantId: string) => void;
  onCreateAgent: () => void;
  onAgentDeleted?: () => void;
  onNavigate?: (page: 'home' | 'agent' | 'test' | 'tickets' | 'logs' | 'billing' | 'phone' | 'calendar' | 'insights' | 'outbound') => void;
}

export function AgentListView({
  allAgents,
  config,
  agentsLimit,
  creatingAgent,
  status,
  onSelectAgent,
  onCreateAgent,
  onAgentDeleted,
  onNavigate,
}: AgentListViewProps) {
  const displayAgents = allAgents.length > 0 ? allAgents : (config ? [config] : []);
  const canAddAgent = displayAgents.length < agentsLimit;
  const [deleteTarget, setDeleteTarget] = useState<AgentConfig | null>(null);
  const [noPhoneHint, setNoPhoneHint] = useState<string | null>(null);
  const phoneNumbers = usePhoneNumbers();

  return (
    <div className="max-w-4xl mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-white">Deine Agenten</h2>
          <p className="text-xs text-white/35 mt-0.5">
            {displayAgents.length} / {agentsLimit} Agent{agentsLimit !== 1 ? 'en' : ''} aktiv
          </p>
        </div>
        {status && (
          <span className={`text-xs px-2.5 py-1 rounded-lg font-medium ${
            status.type === 'ok'
              ? 'text-green-400 bg-green-500/10 border border-green-500/20'
              : 'text-red-400 bg-red-500/10 border border-red-500/20'
          }`}>
            {status.text}
          </span>
        )}
      </div>

      {/* Agent Cards */}
      <div className="space-y-2 mb-5">
        {displayAgents.map((agent) => (
          <div
            key={agent.tenantId}
            className="group flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-5 py-4 hover:border-white/[0.12] hover:bg-white/[0.05] transition-all duration-200"
          >
            <div className="shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center cursor-pointer" onClick={() => onSelectAgent(agent.tenantId)}>
              <IconAgent size={16} className="text-orange-400" />
            </div>
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelectAgent(agent.tenantId)}>
              <p className="text-sm font-semibold text-white truncate">{agent.name || 'Unbenannter Agent'}</p>
              <p className="text-xs text-white/40 truncate mt-0.5">{agent.businessName || '—'}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {agent.retellAgentId ? (() => {
                const hasPhone = phoneNumbers.some(p => p.agent_id === agent.retellAgentId);
                return hasPhone ? (
                  <span className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-full font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                    Live
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-[11px] text-cyan-400/70 px-2 py-0.5 rounded-full font-medium relative">
                    <span className="w-1 h-1 rounded-full bg-cyan-400/70 inline-block" />
                    Web
                  </span>
                );
              })() : (
                <span className="text-xs text-amber-400/70 bg-amber-500/10 border border-amber-500/15 px-2.5 py-1 rounded-full font-medium">Entwurf</span>
              )}
              <button
                onClick={() => onSelectAgent(agent.tenantId)}
                className="text-xs text-white/30 hover:text-white/60 transition-colors cursor-pointer"
              >
                Bearbeiten
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(agent); }}
                className="text-xs text-white/30 hover:text-red-400 transition-colors cursor-pointer ml-1"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Agent Button */}
      {canAddAgent ? (
        <button
          onClick={onCreateAgent}
          disabled={creatingAgent}
          className="w-full rounded-2xl border border-dashed border-white/10 hover:border-orange-500/30 py-4 text-sm text-white/30 hover:text-orange-400/70 disabled:opacity-50 transition-all duration-200 cursor-pointer"
        >
          {creatingAgent ? 'Wird erstellt…' : '+ Neuen Agenten erstellen'}
        </button>
      ) : (
        <div className="relative">
          <button
            disabled
            className="w-full rounded-2xl border border-dashed border-white/5 py-4 text-sm text-white/20 cursor-not-allowed"
          >
            + Neuen Agenten erstellen
          </button>
          <span className="absolute top-1/2 -translate-y-1/2 right-4 text-[10px] bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full font-medium">
            {agentsLimit <= 1 ? 'ab Starter' : agentsLimit <= 3 ? 'ab Agency' : `Max. ${agentsLimit} Agenten`}
          </span>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <DeleteAgentModal
          agent={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); onAgentDeleted?.(); }}
        />
      )}
    </div>
  );
}

function DeleteAgentModal({ agent, onClose, onDeleted }: { agent: AgentConfig; onClose: () => void; onDeleted: () => void }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if agent is older than 30 days (requires password)
  // We don't have created_at on frontend, so backend handles the check.
  // We'll show password field if backend returns password_required error.
  const [needsPassword, setNeedsPassword] = useState(false);

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {
      await deleteAgent(agent.tenantId, needsPassword ? password : undefined);
      onDeleted();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('password_required')) {
        setNeedsPassword(true);
        setError(null);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-sm rounded-2xl border border-white/10 p-6 space-y-4" style={{ background: '#14141f' }}>
        <div>
          <h3 className="text-base font-bold text-white">Agent löschen</h3>
          <p className="text-sm text-white/50 mt-1">
            <span className="text-white/80 font-medium">{agent.name}</span> wird unwiderruflich gelöscht. Verbundene Telefonnummern werden getrennt.
          </p>
        </div>

        {needsPassword && (
          <div>
            <label className="block text-xs text-white/40 mb-1.5">
              Dieser Agent ist länger als 30 Tage aktiv. Bitte Passwort bestätigen:
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Dein Passwort"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-red-500/40"
            />
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm text-white/50 hover:text-white hover:border-white/20 transition-all cursor-pointer"
          >
            Abbrechen
          </button>
          <button
            onClick={handleDelete}
            disabled={loading || (needsPassword && !password)}
            className="flex-1 py-2.5 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-sm font-medium hover:bg-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            {loading ? '…' : 'Löschen'}
          </button>
        </div>
      </div>
    </div>
  );
}
