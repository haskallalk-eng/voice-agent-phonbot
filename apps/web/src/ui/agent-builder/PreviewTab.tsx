import React from 'react';
import type { AgentConfig, AgentPreview, Voice } from '../../lib/api.js';
import { getAgentPreview } from '../../lib/api.js';
import { WebCallWidget } from '../WebCallWidget.js';
import { IconAgent, IconDeploy, IconMic, IconMicUpload, IconRefresh } from './shared.js';
import { deriveTechnicalRuntimeSettings, formatCallDuration } from '../../../../../packages/shared/src/technical.js';

export interface PreviewTabProps {
  config: AgentConfig;
  preview: AgentPreview | null;
  voices: Voice[];
  deploying: boolean;
  onDeploy: () => void;
  onPreviewUpdate: (preview: AgentPreview) => void;
}

export function PreviewTab({ config, preview, voices, deploying, onDeploy, onPreviewUpdate }: PreviewTabProps) {
  const runtime = deriveTechnicalRuntimeSettings(config);

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
            {deploying ? 'Deploying…' : <><IconDeploy size={13} />Jetzt deployen</>}
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
          <WebCallWidget agentTenantId={config.tenantId} />
        </div>

        {/* Right: Voice + Details */}
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <IconMicUpload size={14} className="text-cyan-400 shrink-0" />
              <span className="text-xs font-semibold text-white/70">Aktive Stimme</span>
            </div>
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.07] px-3 py-2.5 mt-2 min-w-0">
              <p className="text-xs font-medium text-white truncate">{config.voice || '—'}</p>
              {(() => {
                const v = voices.find(x => x.voice_id === config.voice);
                return v ? (
                  <p className="text-[10px] text-white/35 mt-0.5 truncate">
                    {v.voice_name}{' \· '}
                    {v.voice_type === 'cloned'
                      ? <span className="text-cyan-400">Eigene Stimme</span>
                      : <span>{v.provider ?? 'Built-in'}</span>}
                  </p>
                ) : null;
              })()}
            </div>
            <p className="text-[10px] text-white/25 mt-1.5">
              Stimme ändern im Tab <span className="text-white/45">Identität</span>.
            </p>
          </div>

          <div className="border-t border-white/[0.05] pt-4">
            <div className="mb-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35">
                Aktive Technik
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <RuntimeItem label="Tempo" value={`${runtime.voiceSpeed.toFixed(1)}x`} />
                <RuntimeItem label="Kreativitaet" value={runtime.modelTemperature.toFixed(2)} />
                <RuntimeItem label="Max. Dauer" value={formatCallDuration(runtime.maxCallDurationSeconds)} />
                <RuntimeItem label="Profil" value={runtime.interruptionModeLabel} />
                <RuntimeItem label="Reaktion" value={runtime.responsiveness.toFixed(2)} />
                <RuntimeItem label="Unterbrechung" value={runtime.interruptionSensitivity.toFixed(2)} />
                <RuntimeItem label="Backchannel" value={runtime.enableBackchannel ? 'An' : 'Aus'} />
                <RuntimeItem label="DTMF" value={runtime.allowUserDtmf ? 'An' : 'Aus'} />
              </div>
            </div>

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

function RuntimeItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/30">{label}</div>
      <div className="mt-1 truncate text-xs font-medium text-white/80">{value}</div>
    </div>
  );
}
