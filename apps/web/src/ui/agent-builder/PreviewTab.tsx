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
  const activeVoice = voices.find((voice) => voice.voice_id === config.voice);
  const savedFallbackReasons = preview?.fallback.reasons?.filter((reason) => reason.enabled !== false).length;
  const activeFallbackReasons = savedFallbackReasons ?? (config.fallback.reasons ?? []).filter((reason) => reason.enabled !== false).length;
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  async function refreshPreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      onPreviewUpdate(await getAgentPreview(config.tenantId));
    } catch {
      setPreviewError('Vorschau konnte nicht geladen werden.');
    } finally {
      setPreviewLoading(false);
    }
  }

  if (!config.retellAgentId) {
    return (
      <div className="relative overflow-hidden rounded-[1.7rem] border border-white/[0.09] bg-gradient-to-br from-white/[0.08] via-white/[0.035] to-cyan-400/[0.05] p-8 md:p-10 text-center shadow-[0_24px_90px_rgba(0,0,0,0.25)]">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-orange-400/15 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 bottom-0 h-64 w-64 rounded-full bg-cyan-300/10 blur-3xl" />
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-orange-300/25 bg-orange-400/10 text-orange-100 shadow-[0_0_40px_rgba(249,115,22,0.18)]">
          <IconDeploy size={30} />
        </div>
        <h3 className="relative mt-5 text-xl font-semibold text-white">Agent noch nicht live testbar</h3>
        <p className="relative mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/45">
          Aktiviere den Agent einmal. Danach siehst du hier Web-Call, aktive Stimme, Tools und den echten Laufzeit-Prompt.
        </p>
        <button
          onClick={onDeploy}
          disabled={deploying}
          className="relative mt-6 inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-xs font-semibold text-white disabled:opacity-50 transition-all cursor-pointer hover:scale-[1.02]"
          style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
        >
          {deploying ? 'Aktiviere...' : <><IconDeploy size={13} />Jetzt aktivieren</>}
        </button>
      </div>
    );
  }

  const runtimeItems = [
    { label: 'Tempo', value: `${runtime.voiceSpeed.toFixed(1)}x` },
    { label: 'Reaktion', value: runtime.responsiveness.toFixed(2) },
    { label: 'Unterbrechung', value: runtime.interruptionSensitivity.toFixed(2) },
    { label: 'Max. Dauer', value: formatCallDuration(runtime.maxCallDurationSeconds) },
    { label: 'Backchannel', value: runtime.enableBackchannel ? 'An' : 'Aus' },
    { label: 'DTMF', value: runtime.allowUserDtmf ? 'An' : 'Aus' },
  ];

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-[1.7rem] border border-white/[0.09] bg-gradient-to-br from-white/[0.085] via-white/[0.035] to-cyan-400/[0.055] p-5 md:p-6 shadow-[0_22px_85px_rgba(0,0,0,0.24)]">
        <div className="pointer-events-none absolute right-0 top-0 h-56 w-56 rounded-full bg-orange-400/14 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl border border-orange-300/25 bg-orange-400/10 text-orange-100 shadow-[0_0_36px_rgba(249,115,22,0.18)]">
              <IconAgent size={22} />
            </div>
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-green-300/25 bg-green-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-green-100/75">
                  Live
                </span>
                <span className="rounded-full border border-white/[0.08] bg-black/20 px-2.5 py-1 text-[10px] font-semibold text-white/45">
                  Tenant {config.tenantId}
                </span>
              </div>
              <h2 className="truncate text-xl font-semibold text-white">{config.name || 'Agent'}</h2>
              <p className="mt-1 truncate text-sm text-white/42">{config.businessName || 'Konfiguration'} wird gegen die aktive Live-Version getestet.</p>
            </div>
          </div>
          <button
            onClick={() => void refreshPreview()}
            disabled={previewLoading}
            className="inline-flex w-fit items-center gap-2 rounded-2xl border border-white/[0.10] bg-black/25 px-4 py-2.5 text-xs font-semibold text-white/60 transition-colors hover:border-orange-300/35 hover:text-orange-100"
          >
            <IconRefresh size={13} className={previewLoading ? 'animate-spin' : ''} />
            {previewLoading ? 'Lade Vorschau...' : 'Vorschau aktualisieren'}
          </button>
        </div>
        {previewError && (
          <div className="relative mt-4 rounded-xl border border-red-300/20 bg-red-400/10 px-3 py-2 text-xs text-red-100/75">
            {previewError}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-5">
        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-[1.55rem] border border-white/[0.09] bg-white/[0.045] p-5">
            <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-orange-400/10 blur-3xl" />
            <div className="relative mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-white/75">
                  <IconMic size={14} className="text-orange-300" />
                  Web-Call Test
                </div>
                <p className="text-[11px] text-white/35">Direkt im Browser sprechen. Ideal für schnelle Prompt- und Logikchecks.</p>
              </div>
              <span className="rounded-full border border-orange-300/20 bg-orange-400/10 px-2 py-1 text-[10px] font-semibold text-orange-100/70">
                Mikrofon
              </span>
            </div>
            <div className="relative rounded-2xl border border-white/[0.08] bg-black/20 p-3">
              <WebCallWidget agentTenantId={config.tenantId} />
            </div>
          </section>

          <section className="rounded-[1.55rem] border border-white/[0.09] bg-white/[0.04] p-5">
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-white/75">
              <IconMicUpload size={14} className="text-cyan-300" />
              Aktive Laufzeit
            </div>
            <div className="grid grid-cols-2 gap-2">
              <RuntimeItem label="Stimme" value={activeVoice?.voice_name ?? config.voice ?? '-'} />
              <RuntimeItem label="Provider" value={activeVoice?.provider ?? (activeVoice?.voice_type === 'cloned' ? 'Eigene Stimme' : 'Built-in')} />
              <RuntimeItem label="Tools" value={`${preview?.tools.length ?? config.tools.length}`} />
              <RuntimeItem label="Gespeicherte Eskalationen" value={config.fallback.enabled ? `${activeFallbackReasons}` : 'Aus'} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {runtimeItems.map((item) => (
                <RuntimeItem key={item.label} label={item.label} value={item.value} />
              ))}
            </div>
          </section>
        </div>

        <section className="min-w-0 rounded-[1.55rem] border border-white/[0.09] bg-white/[0.04] p-5">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-100/45">Technische Vorschau</p>
              <h3 className="mt-1 text-base font-semibold text-white">Runtime-Prompt und Retell-Tools</h3>
              <p className="mt-1 text-xs leading-relaxed text-white/38">
                Diese Vorschau kombiniert Plattform-Kernel, Agent-Anweisungen und die Tool-Beschreibungen, die beim Deploy sichtbar sind.
              </p>
            </div>
            <button
              onClick={() => void refreshPreview()}
              disabled={previewLoading}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/[0.09] bg-black/20 px-3 py-2 text-[11px] font-semibold text-white/50 transition-colors hover:text-cyan-100"
            >
              <IconRefresh size={12} className={previewLoading ? 'animate-spin' : ''} />
              {previewLoading ? 'Laedt...' : 'Neu laden'}
            </button>
          </div>

          {preview ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {preview.tools.map((tool) => (
                  <span key={tool} className="rounded-lg border border-orange-300/20 bg-orange-400/10 px-2 py-1 text-[10px] font-semibold text-orange-100/75">
                    {tool}
                  </span>
                ))}
              </div>
              <pre className="max-h-[34rem] overflow-auto rounded-2xl border border-white/[0.07] bg-black/35 p-4 text-[11px] leading-relaxed text-white/58 whitespace-pre-wrap">
                {preview.instructions}
              </pre>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/[0.10] bg-black/20 p-8 text-center">
              <IconRefresh size={20} className="mx-auto mb-3 text-white/25" />
              <p className="text-sm font-semibold text-white/65">Noch keine Vorschau geladen</p>
              <p className="mt-1 text-xs text-white/35">Lade die aktuelle Laufzeit-Konfiguration, bevor du testest.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function RuntimeItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5">
      <div className="text-[9px] uppercase tracking-[0.14em] text-white/30">{label}</div>
      <div className="mt-1 truncate text-xs font-semibold text-white/80">{value}</div>
    </div>
  );
}
