import React from 'react';
import type { AgentConfig } from '../../lib/api.js';
import { IconAgent } from './shared.js';

export interface AgentListViewProps {
  allAgents: AgentConfig[];
  config: AgentConfig | null;
  agentsLimit: number;
  creatingAgent: boolean;
  status: { type: 'ok' | 'error'; text: string } | null;
  onSelectAgent: (tenantId: string) => void;
  onCreateAgent: () => void;
}

export function AgentListView({
  allAgents,
  config,
  agentsLimit,
  creatingAgent,
  status,
  onSelectAgent,
  onCreateAgent,
}: AgentListViewProps) {
  const displayAgents = allAgents.length > 0 ? allAgents : (config ? [config] : []);
  const canAddAgent = displayAgents.length < agentsLimit;

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
            className="group flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-5 py-4 hover:border-white/[0.12] hover:bg-white/[0.05] transition-all duration-200 cursor-pointer"
            onClick={() => onSelectAgent(agent.tenantId)}
          >
            <div className="shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center">
              <IconAgent size={16} className="text-orange-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{agent.name || 'Unbenannter Agent'}</p>
              <p className="text-xs text-white/40 truncate mt-0.5">{agent.businessName || '\—'}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {agent.retellAgentId ? (
                <span className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-full font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                  Live
                </span>
              ) : (
                <span className="text-xs text-amber-400/70 bg-amber-500/10 border border-amber-500/15 px-2.5 py-1 rounded-full font-medium">Entwurf</span>
              )}
              <span className="text-xs text-white/30 group-hover:text-white/60 transition-colors">Bearbeiten \→</span>
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
          {creatingAgent ? 'Wird erstellt\…' : '+ Neuen Agenten erstellen'}
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
            {agentsLimit < 3 ? 'ab Pro' : 'Limit'}
          </span>
        </div>
      )}
    </div>
  );
}
