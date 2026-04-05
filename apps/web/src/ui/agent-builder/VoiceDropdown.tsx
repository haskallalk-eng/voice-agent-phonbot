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

  const searchLower = search.toLowerCase();

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
        <span className="truncate">{loading ? 'Stimmen werden geladen…' : displayLabel}</span>
        <IconChevronDown size={16} className="ml-2 text-white/40 shrink-0" />
      </button>
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
                  onClick={() => onSelect(v.voice_id)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-left ${
                    currentVoiceId === v.voice_id ? 'text-cyan-300 bg-cyan-500/10' : 'text-white/80'
                  }`}
                >
                  <span>{v.voice_name}</span>
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
                  onClick={() => onSelect(v.voice_id)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-left ${
                    currentVoiceId === v.voice_id ? 'text-orange-300 bg-orange-500/10' : 'text-white/80'
                  }`}
                >
                  <span>{v.voice_name}</span>
                  <span className="text-xs text-white/30">{v.accent ?? v.gender ?? ''}</span>
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
