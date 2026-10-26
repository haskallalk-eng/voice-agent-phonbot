import { useEffect, useState } from 'react';
import type { ChipyBlock, ChipySchedule } from '../../lib/api.js';
import { addChipyBlock, removeChipyBlock, saveChipySchedule } from '../../lib/api.js';
import { isoDate, todayISO } from './model.js';

import { DEFAULT_SCHEDULE } from './configuration.js';

const DAY_NAMES: Record<string, string> = {
  '1': 'Montag', '2': 'Dienstag', '3': 'Mittwoch',
  '4': 'Donnerstag', '5': 'Freitag', '6': 'Samstag', '0': 'Sonntag',
};
const DAY_ORDER = ['1','2','3','4','5','6','0'];
type BlockMode = 'day' | 'range' | 'hours';
const ALL_BLOCK_MODES: BlockMode[] = ['day', 'range', 'hours'];

export function SettingsPanel({
  schedule, setSchedule, blocks, setBlocks, saveScheduleApi, addBlockApi, removeBlockApi,
  showSchedule = true,
  blockModeOptions = ALL_BLOCK_MODES,
  blockTitle = 'Ausnahmen & Sperrzeiten',
  blockDescription = 'Urlaub, Krankheit, Mittagspause oder einzelne Stunden.',
}: {
  schedule: ChipySchedule;
  setSchedule: React.Dispatch<React.SetStateAction<ChipySchedule>>;
  blocks: ChipyBlock[];
  setBlocks: React.Dispatch<React.SetStateAction<ChipyBlock[]>>;
  saveScheduleApi?: (schedule: ChipySchedule) => Promise<unknown>;
  addBlockApi?: (date: string, opts?: { start_time?: string; end_time?: string; reason?: string }) => Promise<{ ok: boolean; id: string }>;
  removeBlockApi?: (id: string) => Promise<unknown>;
  showSchedule?: boolean;
  blockModeOptions?: BlockMode[];
  blockTitle?: string;
  blockDescription?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newBlockDate, setNewBlockDate] = useState('');
  const [newBlockEndDate, setNewBlockEndDate] = useState('');
  const [newBlockStartTime, setNewBlockStartTime] = useState('');
  const [newBlockEndTime, setNewBlockEndTime] = useState('');
  const [newBlockReason, setNewBlockReason] = useState('');
  const [blockError, setBlockError] = useState<string | null>(null);
  const [blockMode, setBlockMode] = useState<BlockMode>('day');
  const allowedBlockModes = blockModeOptions.length ? blockModeOptions : ALL_BLOCK_MODES;

  useEffect(() => {
    if (!allowedBlockModes.includes(blockMode)) {
      setBlockMode(allowedBlockModes[0] ?? 'day');
    }
  }, [allowedBlockModes, blockMode]);

  async function handleSave() {
    setSaving(true); setSaved(false); setSaveError(null);
    try {
      await (saveScheduleApi ?? saveChipySchedule)(schedule);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setSaveError((e instanceof Error ? e.message : null) ?? 'Fehler');
    } finally { setSaving(false); }
  }

  async function handleAddBlock() {
    if (!newBlockDate) return;
    setBlockError(null);
    try {
      const res = await (addBlockApi ?? addChipyBlock)(newBlockDate, { reason: newBlockReason || undefined });
      setBlocks(prev => [...prev, { id: res.id, date: newBlockDate, start_time: null, end_time: null, reason: newBlockReason || null }]);
      setNewBlockDate(''); setNewBlockReason('');
    } catch (e: unknown) {
      setBlockError((e instanceof Error ? e.message : null) ?? 'Fehler');
    }
  }

  async function handleAddRange() {
    if (!newBlockDate || !newBlockEndDate) return;
    setBlockError(null);
    try {
      // Create a block for each day in the range
      const start = new Date(newBlockDate + 'T00:00:00');
      const end = new Date(newBlockEndDate + 'T00:00:00');
      const newBlocks: ChipyBlock[] = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = isoDate(d);
        const res = await (addBlockApi ?? addChipyBlock)(dateStr, { reason: newBlockReason || undefined });
        newBlocks.push({ id: res.id, date: dateStr, start_time: null, end_time: null, reason: newBlockReason || null });
      }
      setBlocks(prev => [...prev, ...newBlocks]);
      setNewBlockDate(''); setNewBlockEndDate(''); setNewBlockReason('');
    } catch (e: unknown) {
      setBlockError((e instanceof Error ? e.message : null) ?? 'Fehler');
    }
  }

  async function handleAddHoursBlock() {
    if (!newBlockDate || !newBlockStartTime || !newBlockEndTime) return;
    setBlockError(null);
    try {
      const res = await (addBlockApi ?? addChipyBlock)(newBlockDate, {
        start_time: newBlockStartTime,
        end_time: newBlockEndTime,
        reason: newBlockReason || undefined,
      });
      setBlocks(prev => [...prev, { id: res.id, date: newBlockDate, start_time: newBlockStartTime, end_time: newBlockEndTime, reason: newBlockReason || null }]);
      setNewBlockDate(''); setNewBlockStartTime(''); setNewBlockEndTime(''); setNewBlockReason('');
    } catch (e: unknown) {
      setBlockError((e instanceof Error ? e.message : null) ?? 'Fehler');
    }
  }

  async function handleRemoveBlock(id: string) {
    try { await (removeBlockApi ?? removeChipyBlock)(id); setBlocks(prev => prev.filter(b => b.id !== id)); } catch (e: unknown) {
      setBlockError((e instanceof Error ? e.message : null) ?? 'Sperre konnte nicht entfernt werden');
    }
  }

  const inputClass = "min-w-0 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-all";
  const inputStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' };

  return (
    <div className="space-y-8">
      {/* Weekly schedule */}
      {showSchedule && (
      <div>
        <p className="text-[11px] font-semibold text-white/25 uppercase tracking-[0.15em] mb-4">Wöchentliche Verfügbarkeit</p>
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          {DAY_ORDER.map((dow, i) => {
            const day = schedule[dow] ?? DEFAULT_SCHEDULE[dow]!;
            return (
              <div key={dow} className="flex flex-wrap items-center gap-3 px-5 py-3.5 sm:gap-4"
                style={i < DAY_ORDER.length - 1 ? { borderBottom: '1px solid rgba(255,255,255,0.03)' } : undefined}>
                <button
                  aria-pressed={day.enabled}
                  onClick={() => setSchedule(s => ({ ...s, [dow]: { ...day, enabled: !day.enabled } }))}
                  className="relative w-9 h-5 rounded-full transition-all shrink-0 cursor-pointer"
                  style={day.enabled ? { background: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' } : { background: 'rgba(255,255,255,0.08)' }}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${day.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <span className={`w-20 text-[13px] font-medium ${day.enabled ? 'text-white' : 'text-white/25'}`}>{DAY_NAMES[dow]}</span>
                {day.enabled ? (
                  <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:w-auto sm:flex-1 sm:justify-end">
                    <input type="time" value={day.start} onChange={e => setSchedule(s => ({ ...s, [dow]: { ...day, start: e.target.value } }))}
                      className={inputClass} style={inputStyle} />
                    <span className="text-white/20 text-[11px]">–</span>
                    <input type="time" value={day.end} onChange={e => setSchedule(s => ({ ...s, [dow]: { ...day, end: e.target.value } }))}
                      className={inputClass} style={inputStyle} />
                  </div>
                ) : (
                  <span className="text-[11px] text-white/15 flex-1 text-right">Geschlossen</span>
                )}
              </div>
            );
          })}
        </div>
        {saveError && <p className="text-xs text-red-300 mt-3">{saveError}</p>}
        <button onClick={handleSave} disabled={saving}
          className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all disabled:opacity-40 hover:scale-[1.01] cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #ff5b0a, #20d9ff)', boxShadow: '0 4px 20px rgba(255,91,10,0.15)' }}>
          {saving ? 'Speichern…' : saved ? 'Gespeichert ✓' : 'Speichern'}
        </button>
      </div>
      )}

      {/* Date blocks */}
      <div>
        <p className="text-[11px] font-semibold text-white/25 uppercase tracking-[0.15em] mb-2">{blockTitle}</p>
        <p className="text-[11px] text-white/20 mb-4">{blockDescription}</p>

        {blocks.length > 0 && (
          <div className="rounded-2xl overflow-hidden mb-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            {blocks.map((b, i) => (
              <div key={b.id} className="flex items-center justify-between px-5 py-3"
                style={i < blocks.length - 1 ? { borderBottom: '1px solid rgba(255,255,255,0.03)' } : undefined}>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[13px] text-white/70">{new Date(b.date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
                  {b.start_time && b.end_time ? (
                    <span className="text-[10px] text-amber-400/60 font-medium">{b.start_time.slice(0, 5)} – {b.end_time.slice(0, 5)}</span>
                  ) : (
                    <span className="text-[10px] text-red-400/50 font-medium">Ganztägig</span>
                  )}
                  {b.reason && <span className="text-[10px] text-white/25">{b.reason}</span>}
                </div>
                <button onClick={() => handleRemoveBlock(b.id)} className="text-white/15 hover:text-red-400 transition-colors shrink-0 ml-2 cursor-pointer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {blockError && <p className="text-xs text-red-300 mb-3">{blockError}</p>}

        {/* Block type toggle */}
        {allowedBlockModes.length > 1 && (
        <div className="flex gap-1.5 mb-4 rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.03)' }}>
          {allowedBlockModes.map(m => (
            <button key={m} onClick={() => setBlockMode(m)}
              className={`flex-1 py-2 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                blockMode === m ? 'bg-white/8' : 'text-white/30 hover:text-white/50'
              }`}>
              {blockMode === m ? (
                <span className="bg-clip-text text-transparent font-semibold" style={{ backgroundImage: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}>{m === 'day' ? 'Tag' : m === 'range' ? 'Zeitraum' : 'Uhrzeiten'}</span>
              ) : (m === 'day' ? 'Tag' : m === 'range' ? 'Zeitraum' : 'Uhrzeiten')}
            </button>
          ))}
        </div>
        )}

        {blockMode === 'day' && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input type="date" value={newBlockDate} min={todayISO()} onChange={e => setNewBlockDate(e.target.value)}
              className={`${inputClass} flex-1`} style={inputStyle} />
            <input type="text" value={newBlockReason} onChange={e => setNewBlockReason(e.target.value)} placeholder="Grund"
              className={`${inputClass} flex-1 placeholder-white/15`} style={inputStyle} />
            <button onClick={handleAddBlock} disabled={!newBlockDate}
              className="w-full shrink-0 rounded-lg px-4 py-2 text-xs font-semibold transition-all hover:brightness-110 disabled:opacity-30 sm:w-auto cursor-pointer"
              style={{ background: 'rgba(255,91,10,0.06)', border: '1px solid rgba(255,91,10,0.15)' }}>
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}>Sperren</span>
            </button>
          </div>
        )}

        {blockMode === 'range' && (
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input type="date" value={newBlockDate} min={todayISO()} onChange={e => setNewBlockDate(e.target.value)}
                className={`${inputClass} flex-1`} style={inputStyle} />
              <span className="text-white/20 text-[11px]">–</span>
              <input type="date" value={newBlockEndDate} min={newBlockDate || todayISO()} onChange={e => setNewBlockEndDate(e.target.value)}
                className={`${inputClass} flex-1`} style={inputStyle} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input type="text" value={newBlockReason} onChange={e => setNewBlockReason(e.target.value)} placeholder="Grund"
                className={`${inputClass} flex-1 placeholder-white/15`} style={inputStyle} />
              <button onClick={handleAddRange} disabled={!newBlockDate || !newBlockEndDate}
                className="w-full shrink-0 rounded-lg px-4 py-2 text-xs font-semibold transition-all hover:brightness-110 disabled:opacity-30 sm:w-auto cursor-pointer"
                style={{ background: 'rgba(255,91,10,0.06)', border: '1px solid rgba(255,91,10,0.15)' }}>
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}>Sperren</span>
              </button>
            </div>
          </div>
        )}

        {blockMode === 'hours' && (
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input type="date" value={newBlockDate} min={todayISO()} onChange={e => setNewBlockDate(e.target.value)}
                className={`${inputClass} flex-1`} style={inputStyle} />
              <input type="time" value={newBlockStartTime} onChange={e => setNewBlockStartTime(e.target.value)}
                className={inputClass} style={inputStyle} />
              <span className="text-white/20 text-[11px]">–</span>
              <input type="time" value={newBlockEndTime} onChange={e => setNewBlockEndTime(e.target.value)}
                className={inputClass} style={inputStyle} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input type="text" value={newBlockReason} onChange={e => setNewBlockReason(e.target.value)} placeholder="Grund"
                className={`${inputClass} flex-1 placeholder-white/15`} style={inputStyle} />
              <button onClick={handleAddHoursBlock} disabled={!newBlockDate || !newBlockStartTime || !newBlockEndTime}
                className="w-full shrink-0 rounded-lg px-4 py-2 text-xs font-semibold transition-all hover:brightness-110 disabled:opacity-30 sm:w-auto cursor-pointer"
                style={{ background: 'rgba(255,91,10,0.06)', border: '1px solid rgba(255,91,10,0.15)' }}>
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}>Sperren</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
