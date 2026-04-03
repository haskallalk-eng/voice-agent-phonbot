import React from 'react';
import type { AgentConfig, AgentPreview, Voice } from '../../lib/api.js';
import { getAgentPreview } from '../../lib/api.js';
import { WebCallWidget } from '../WebCallWidget.js';
import { IconAgent, IconDeploy, IconMic, IconMicUpload, IconRefresh } from './shared.js';

export interface PreviewTabProps {
  config: AgentConfig;
  preview: AgentPreview | null;
  voices: Voice[];
  deploying: boolean;
  onDeploy: () => void;
  onPreviewUpdate: (preview: AgentPreview) => void;
}

export function PreviewTab({ config, preview, voices, deploying, onDeploy, onPreviewUpdate }: PreviewTabProps) {
  if (!config.retellAgentId) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-10 text-center space-y-4">
          <IconDeploy size={36} className="mx-auto text-orange-400/30" />
          <div>
            <h3 className="text-sm font-semibold text-white/80">Agent noch nicht deployed</h3>
            <p className="text-xs text-white/35 mt-1">Speichere und deploye deinen Agent, um ihn zu testen.</p>
          </div>
          <button
            onClick={onDeploy}
            disabled={deploying}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-50 transition-all cursor-pointer hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
          >
            {deploying ? 'Deploying\u2026' : <><IconDeploy size={13} />Jetzt deployen</>}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Agent identity strip */}
      <div className="flex items-center gap-3 px-1 min-w-0">
        <div className="w-8 h-8 shrink-0 rounded-xl bg-gradient-to-br from-orange-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center">
          <IconAgent size={15} className="text-orange-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">{config.name || 'Agent'}</p>
          <p className="text-[11px] text-white/35 truncate">{config.businessName || ''}</p>
        </div>
        <span className="shrink-0 flex items-center gap-1.5 text-[11px] text-green-400 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-full font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Live
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Live Call */}
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
          <div className="flex items-center gap-2 mb-1">
            <IconMic size={14} className="text-orange-400 shrink-0" />
            <span className="text-xs font-semibold text-white/70">Web-Call</span>
          </div>
          <p className="text-[11px] text-white/30 mb-4">Mikrofon erforderlich — sprich direkt mit dem Agenten.</p>
          <WebCallWidget />
        </div>

        {/* Right: Voice + Details */}
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <IconMicUpload size={14} className="text-cyan-400 shrink-0" />
              <span className="text-xs font-semibold text-white/70">Aktive Stimme</span>
            </div>
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.07] px-3 py-2.5 mt-2 min-w-0">
              <p className="text-xs font-medium text-white truncate">{config.voice || '\u2014'}</p>
              {(() => {
                const v = voices.find(x => x.voice_id === config.voice);
                return v ? (
                  <p className="text-[10px] text-white/35 mt-0.5 truncate">
                    {v.voice_name}{' \u00b7 '}
                    {v.voice_type === 'cloned'
                      ? <span className="text-cyan-400">Eigene Stimme</span>
                      : <span>{v.provider ?? 'Built-in'}</span>}
                  </p>
                ) : null;
              })()}
            </div>
            <p className="text-[10px] text-white/25 mt-1.5">
              Stimme \u00e4ndern im Tab <span className="text-white/45">Identit\u00e4t</span>.
            </p>
          </div>

          <div className="border-t border-white/[0.05] pt-4">
            <button
              onClick={() => getAgentPreview().then(onPreviewUpdate)}
              className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-orange-400 transition-colors cursor-pointer mb-3"
            >
              <IconRefresh size={12} /> Technische Vorschau laden
            </button>
            {preview && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {preview.tools.map((t) => (
                    <span key={t} className="text-[10px] bg-orange-500/15 text-orange-300/80 px-2 py-0.5 rounded font-mono">{t}</span>
                  ))}
                </div>
                <pre className="bg-black/30 text-white/50 text-[10px] p-3 rounded-lg overflow-auto max-h-40 whitespace-pre-wrap border border-white/[0.05] leading-relaxed">
                  {preview.instructions}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
