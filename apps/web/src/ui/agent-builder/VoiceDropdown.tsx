import React, { useState, useEffect, useRef } from 'react';
import type { Voice } from '../../lib/api.js';
import { IconChevronDown, IconStar } from './shared.js';

export function getProviderLabel(voice: Voice): string {
  if (voice.voice_type === 'cloned') return 'Eigene Stimme';
  const provider = voice.provider ?? voice.voice_id.split('-')[0] ?? 'Retell';
  const map: Record<string, string> = {
    retell: 'Retell',
    openai: 'OpenAI',
    '11labs': 'ElevenLabs',
    elevenlabs: 'ElevenLabs',
    cartesia: 'Cartesia',
    minimax: 'Minimax',
    deepgram: 'Deepgram',
  };
  return map[provider.toLowerCase()] ?? provider;
}

// Voice counts as "Premium" (triggers +5 Ct/Min surcharge) when:
//  - backend annotated it with surchargePerMinute > 0, OR
//  - the provider is an ElevenLabs variant, OR
//  - voice_id starts with the well-known ElevenLabs prefix, OR
//  - it's the known premium Chipy clone.
// Fallback chain exists because the Retell API response shape is not
// always guaranteed — we'd rather over-flag than miss and undercharge.
const PREMIUM_PROVIDERS = new Set(['elevenlabs', '11labs', 'eleven_labs']);
const KNOWN_PREMIUM_IDS = new Set(['custom_voice_5269b3f4732a77b9030552fd67']);
export function isPremiumVoice(voice: Voice): boolean {
  if ((voice.surchargePerMinute ?? 0) > 0) return true;
  const prov = (voice.provider ?? '').toLowerCase();
  if (PREMIUM_PROVIDERS.has(prov)) return true;
  const id = voice.voice_id.toLowerCase();
  if (id.startsWith('11labs-') || id.startsWith('elevenlabs-')) return true;
  if (KNOWN_PREMIUM_IDS.has(voice.voice_id)) return true;
  return false;
}
export function voiceSurcharge(voice: Voice): number {
  if ((voice.surchargePerMinute ?? 0) > 0) return voice.surchargePerMinute as number;
  return isPremiumVoice(voice) ? 0.05 : 0;
}

export interface VoiceDropdownProps {
  voices: Voice[];
  loading: boolean;
  currentVoiceId: string;
  dropdownOpen: boolean;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  onOpenToggle: () => void;
  onSelect: (id: string) => void;
}

export function VoiceDropdown({
  voices,
  loading,
  currentVoiceId,
  dropdownOpen,
  dropdownRef,
  onOpenToggle,
  onSelect,
}: VoiceDropdownProps) {
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Auto-focus search when dropdown opens
  useEffect(() => {
    if (dropdownOpen) {
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [dropdownOpen]);

  const currentVoice = voices.find((v) => v.voice_id === currentVoiceId);
  const displayLabel = currentVoice
    ? `${currentVoice.voice_name} (${getProviderLabel(currentVoice)})`
    : currentVoiceId;
  const currentIsPremium = currentVoice ? isPremiumVoice(currentVoice) : false;
  const currentSurcharge = currentVoice ? voiceSurcharge(currentVoice) : 0;

  // Modal state: asks the user to confirm switching to a premium voice.
  // Only appears when the target voice is premium AND the current one isn't,
  // so repeatedly clicking between premium voices doesn't nag.
  const [confirmVoice, setConfirmVoice] = useState<Voice | null>(null);

  const searchLower = search.toLowerCase();

  // Format a per-minute surcharge like "+5 Ct/Min". We keep the unit
  // in German cents since all pricing on the site is German-centric.
  function formatSurcharge(eurPerMin: number): string {
    const cents = Math.round(eurPerMin * 100);
    return `+${cents} Ct/Min`;
  }

  function handleSelect(v: Voice) {
    // Ask once before switching to a premium voice from a non-premium one.
    if (isPremiumVoice(v) && !currentIsPremium && currentVoiceId !== v.voice_id) {
      setConfirmVoice(v);
      return;
    }
    onSelect(v.voice_id);
  }

  // Group voices: cloned first, then by provider
  const cloned = voices.filter((v) => v.voice_type === 'cloned' && (!search || v.voice_name.toLowerCase().includes(searchLower)));
  const builtIn = voices.filter((v) => v.voice_type !== 'cloned' && (!search || v.voice_name.toLowerCase().includes(searchLower) || (v.accent ?? '').toLowerCase().includes(searchLower) || (v.provider ?? '').toLowerCase().includes(searchLower)));

  // Group built-in by provider
  const providerGroups: Record<string, Voice[]> = {};
  for (const v of builtIn) {
    const prov = getProviderLabel(v);
    if (!providerGroups[prov]) providerGroups[prov] = [];
    providerGroups[prov].push(v);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={onOpenToggle}
        className="w-full flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-orange-500/50 outline-none"
      >
        <span className="truncate flex items-center gap-2">
          {loading ? 'Stimmen werden geladen…' : displayLabel}
          {currentIsPremium && (
            <span className="text-[10px] font-semibold text-orange-300 bg-orange-500/10 border border-orange-500/30 rounded-full px-1.5 py-0.5">
              Premium {formatSurcharge(currentSurcharge)}
            </span>
          )}
        </span>
        <IconChevronDown size={16} className="ml-2 text-white/40 shrink-0" />
      </button>
      {currentIsPremium && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2">
          <span className="text-sm leading-none" aria-hidden="true">⚡</span>
          <p className="text-xs text-orange-100/90 leading-snug">
            <strong className="text-orange-200">Premium-Stimme ausgewählt.</strong> ElevenLabs HD kostet{' '}
            <span className="text-orange-200 font-semibold">{formatSurcharge(currentSurcharge)}</span>{' '}
            zusätzlich zum Minutenpreis deines Plans. Die Abrechnung erfolgt am Monatsende über Stripe.
          </p>
        </div>
      )}

      {/* Confirmation modal when switching from standard → premium voice */}
      {confirmVoice && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}
          onClick={() => setConfirmVoice(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="premium-voice-title"
        >
          <div
            className="relative max-w-md w-full rounded-3xl overflow-hidden"
            style={{
              background: 'rgba(15,15,24,0.98)',
              border: '1px solid rgba(249,115,22,0.35)',
              boxShadow: '0 0 60px rgba(249,115,22,0.15), 0 0 0 1px rgba(255,255,255,0.05)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Gradient top accent line */}
            <div
              className="absolute top-0 left-0 right-0 h-px"
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(249,115,22,0.6), rgba(6,182,212,0.6), transparent)',
              }}
            />

            <div className="px-8 pt-8 pb-7 flex flex-col items-center text-center">
              {/* Icon badge */}
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                style={{
                  background: 'linear-gradient(135deg, rgba(249,115,22,0.18), rgba(6,182,212,0.12))',
                  border: '1px solid rgba(249,115,22,0.35)',
                  boxShadow: '0 0 24px rgba(249,115,22,0.25)',
                }}
                aria-hidden="true"
              >
                <span className="text-2xl leading-none">⚡</span>
              </div>

              {/* Title */}
              <h3 id="premium-voice-title" className="text-lg font-bold text-white mb-2">
                Premium-Stimme wählen?
              </h3>

              {/* Voice chip */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 mb-4">
                <span className="text-sm font-medium text-white">{confirmVoice.voice_name}</span>
                <span className="text-xs text-white/40">·</span>
                <span className="text-xs text-white/60">{getProviderLabel(confirmVoice)}</span>
              </div>

              {/* Body */}
              <p className="text-sm text-white/70 leading-relaxed mb-1">
                Diese HD-Stimme kostet einen Aufschlag von
              </p>
              <p className="text-3xl font-extrabold mb-1"
                style={{
                  background: 'linear-gradient(135deg, #F97316, #06B6D4)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                {formatSurcharge(voiceSurcharge(confirmVoice))}
              </p>
              <p className="text-sm text-white/55 leading-relaxed mb-6">
                zusätzlich zum Minutenpreis deines Plans.<br />
                Abrechnung am Monatsende über Stripe.
              </p>

              {/* Symmetric buttons */}
              <div className="grid grid-cols-2 gap-3 w-full">
                <button
                  type="button"
                  onClick={() => setConfirmVoice(null)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-medium text-white/75 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition-all"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(confirmVoice.voice_id);
                    setConfirmVoice(null);
                  }}
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:scale-[1.02] hover:shadow-[0_0_24px_rgba(249,115,22,0.45)]"
                  style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
                >
                  Bestätigen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {dropdownOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border border-white/10 bg-[#0F0F18] shadow-xl max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
          style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent' }}>
          {/* Search */}
          <div className="sticky top-0 bg-[#0F0F18] border-b border-white/5 p-2 z-10">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Stimme suchen…"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          {/* Custom (cloned) voices */}
          {cloned.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 px-4 py-2 bg-cyan-500/5 border-b border-white/5">
                <IconStar size={12} className="text-cyan-400" />
                <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wide">Eigene Stimmen</span>
              </div>
              {cloned.map((v) => (
                <button
                  key={v.voice_id}
                  type="button"
                  onClick={() => handleSelect(v)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-left ${
                    currentVoiceId === v.voice_id ? 'text-cyan-300 bg-cyan-500/10' : 'text-white/80'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="truncate">{v.voice_name}</span>
                    {isPremiumVoice(v) && (
                      <span className="text-[10px] font-semibold text-orange-300 bg-orange-500/10 border border-orange-500/30 rounded-full px-1.5 py-0.5 shrink-0">
                        Premium {formatSurcharge(voiceSurcharge(v))}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-cyan-400/60 bg-cyan-500/10 px-1.5 py-0.5 rounded shrink-0">Eigene</span>
                </button>
              ))}
            </>
          )}

          {/* Built-in voices grouped by provider */}
          {Object.entries(providerGroups).map(([provider, provVoices]) => (
            <React.Fragment key={provider}>
              <div className="px-4 py-1.5 bg-white/3 border-b border-t border-white/5">
                <span className="text-xs font-semibold text-white/40 uppercase tracking-wide">{provider}</span>
              </div>
              {provVoices.map((v) => (
                <button
                  key={v.voice_id}
                  type="button"
                  onClick={() => handleSelect(v)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-left ${
                    currentVoiceId === v.voice_id ? 'text-orange-300 bg-orange-500/10' : 'text-white/80'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="truncate">{v.voice_name}</span>
                    {isPremiumVoice(v) && (
                      <span className="text-[10px] font-semibold text-orange-300 bg-orange-500/10 border border-orange-500/30 rounded-full px-1.5 py-0.5 shrink-0">
                        Premium {formatSurcharge(voiceSurcharge(v))}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-white/30 shrink-0">{v.accent ?? v.gender ?? ''}</span>
                </button>
              ))}
            </React.Fragment>
          ))}

          {/* No search results */}
          {search && cloned.length === 0 && Object.keys(providerGroups).length === 0 && (
            <div className="px-4 py-6 text-sm text-white/40 text-center">
              Keine Stimmen für „{search}\“ gefunden.
            </div>
          )}

          {/* Fallback: no voices loaded yet */}
          {voices.length === 0 && !loading && !search && (
            <div className="px-4 py-4 text-sm text-white/40 text-center">
              Keine Stimmen geladen. Prüfe deine Retell API-Verbindung.
            </div>
          )}
          {loading && (
            <div className="px-4 py-4 text-sm text-white/40 text-center">Stimmen werden geladen…</div>
          )}
        </div>
      )}
    </div>
  );
}
