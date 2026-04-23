import React, { useState } from 'react';
import type { ServiceItem } from '../../lib/api.js';
import { AdaptiveTextarea } from '../../components/AdaptiveTextarea.js';

/**
 * Structured services editor — "Variante 4" from the design discussion.
 *
 * Row-per-service quick entry (name + price + duration) by default. A small
 * chevron on each row expands optional fields (description, price-up-to,
 * "ab"-toggle, tag) so 80% of customers stay in the one-liner flow while
 * power users get the full card without a mode switch.
 *
 * Edits flow straight to the parent's config.services array. No local state
 * for the row values — keeps history/undo consistent with the rest of the
 * builder and avoids the "save-lost-my-edits" trap.
 */

type TagId = 'BELIEBT' | 'NEU' | 'AKTION';
const TAG_COLORS: Record<TagId, { border: string; bg: string; text: string }> = {
  BELIEBT: { border: 'rgba(249,115,22,0.35)', bg: 'rgba(249,115,22,0.08)', text: '#FDBA74' },
  NEU:     { border: 'rgba(6,182,212,0.35)',  bg: 'rgba(6,182,212,0.08)',  text: '#67E8F9' },
  AKTION:  { border: 'rgba(251,191,36,0.4)',  bg: 'rgba(251,191,36,0.08)', text: '#FCD34D' },
};

function newId(): string {
  // Short stable id — only needs to be unique within the array, so a
  // date-suffixed random slug is plenty. Avoids pulling uuid just for this.
  return `svc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function ServicesEditor({
  value,
  legacyText,
  onChange,
  onConsumeLegacy,
}: {
  value: ServiceItem[];
  legacyText: string;
  onChange: (next: ServiceItem[]) => void;
  /** Called when the user accepts the legacy-to-structured migration —
   *  parent should clear `servicesText` so the banner disappears. */
  onConsumeLegacy: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function patch(id: string, p: Partial<ServiceItem>) {
    onChange(value.map((s) => (s.id === id ? { ...s, ...p } : s)));
  }
  function remove(id: string) {
    onChange(value.filter((s) => s.id !== id));
    if (expandedId === id) setExpandedId(null);
  }
  function add() {
    const next: ServiceItem = { id: newId(), name: '' };
    onChange([...value, next]);
    setExpandedId(null); // keep the new row collapsed — clean & focused on the name field
  }
  function migrateLegacy() {
    // Split the freetext on commas + line breaks, each fragment becomes one
    // service with only a name — user can then fill prices/durations.
    const items = legacyText
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 30)
      .map<ServiceItem>((name) => ({ id: newId(), name }));
    if (items.length === 0) return;
    onChange([...value, ...items]);
    onConsumeLegacy();
  }

  const inputBase =
    'bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white/85 outline-none focus:border-orange-500/45 focus:ring-1 focus:ring-orange-500/30 placeholder:text-white/25';

  return (
    <div className="space-y-2.5">
      {/* Legacy-text migration banner */}
      {value.length === 0 && legacyText.trim().length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5 text-[11px] text-amber-200/90 flex items-center justify-between gap-3">
          <span>
            Alter Freitext: <span className="italic text-white/65">„{legacyText.slice(0, 80)}{legacyText.length > 80 ? '…' : ''}"</span>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={migrateLegacy}
              className="text-[11px] px-2.5 py-1 rounded-full font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
              Übernehmen
            </button>
            <button type="button" onClick={onConsumeLegacy}
              className="text-[11px] text-white/50 hover:text-white/80 transition-colors">
              Verwerfen
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {value.length === 0 && legacyText.trim().length === 0 && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-4 text-center">
          <p className="text-xs text-white/50 mb-2">Noch keine Services eingetragen.</p>
          <button type="button" onClick={add}
            className="text-[11px] px-3 py-1.5 rounded-full font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
            ➕ Ersten Service anlegen
          </button>
        </div>
      )}

      {/* Rows */}
      {value.map((s) => {
        const isExpanded = expandedId === s.id;
        const tagStyle = s.tag ? TAG_COLORS[s.tag] : null;
        return (
          <div
            key={s.id}
            className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden"
          >
            {/* Main row — always visible */}
            <div className="flex items-center gap-2 px-3 py-2.5">
              <input
                type="text"
                value={s.name}
                onChange={(e) => patch(s.id, { name: e.target.value })}
                placeholder="Name des Services"
                className={`flex-1 min-w-0 ${inputBase}`}
              />
              <div className="flex items-center gap-0.5 shrink-0">
                <input
                  type="text"
                  value={s.price ?? ''}
                  onChange={(e) => patch(s.id, { price: e.target.value })}
                  placeholder="Preis"
                  inputMode="decimal"
                  className={`w-16 text-right ${inputBase}`}
                />
                <span className="text-xs text-white/40 pl-1">€</span>
              </div>
              <input
                type="text"
                value={s.duration ?? ''}
                onChange={(e) => patch(s.id, { duration: e.target.value })}
                placeholder="Dauer"
                className={`w-20 shrink-0 ${inputBase}`}
              />
              {tagStyle && (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border shrink-0"
                  style={{ borderColor: tagStyle.border, background: tagStyle.bg, color: tagStyle.text }}>
                  {s.tag}
                </span>
              )}
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : s.id)}
                title="Weitere Optionen"
                aria-expanded={isExpanded}
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.06] text-white/40 hover:text-white/75 transition-all cursor-pointer"
                style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 200ms ease, color 200ms, background 200ms' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => remove(s.id)}
                title="Service entfernen"
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500/15 text-white/30 hover:text-red-300 transition-colors cursor-pointer"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                </svg>
              </button>
            </div>

            {/* Expanded options */}
            {isExpanded && (
              <div className="border-t border-white/[0.05] bg-black/20 px-3 py-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider text-white/40">Preis-Modus</label>
                    <div className="flex gap-1">
                      <button type="button"
                        onClick={() => patch(s.id, { priceFrom: false, priceUpTo: undefined })}
                        className={`flex-1 text-[10px] px-2 py-1.5 rounded-md border transition-colors ${
                          !s.priceFrom && !s.priceUpTo ? 'border-orange-500/45 bg-orange-500/10 text-white' : 'border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80'
                        }`}>Fest</button>
                      <button type="button"
                        onClick={() => patch(s.id, { priceFrom: true, priceUpTo: undefined })}
                        className={`flex-1 text-[10px] px-2 py-1.5 rounded-md border transition-colors ${
                          s.priceFrom ? 'border-orange-500/45 bg-orange-500/10 text-white' : 'border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80'
                        }`}>ab X</button>
                      <button type="button"
                        onClick={() => patch(s.id, { priceFrom: false, priceUpTo: s.priceUpTo ?? '' })}
                        className={`flex-1 text-[10px] px-2 py-1.5 rounded-md border transition-colors ${
                          !s.priceFrom && typeof s.priceUpTo === 'string' ? 'border-orange-500/45 bg-orange-500/10 text-white' : 'border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80'
                        }`}>Von–Bis</button>
                    </div>
                  </div>
                  {typeof s.priceUpTo === 'string' && !s.priceFrom && (
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-wider text-white/40">Preis bis</label>
                      <div className="flex items-center gap-0.5">
                        <input
                          type="text"
                          value={s.priceUpTo}
                          onChange={(e) => patch(s.id, { priceUpTo: e.target.value })}
                          placeholder="60"
                          inputMode="decimal"
                          className={`flex-1 text-right ${inputBase}`}
                        />
                        <span className="text-xs text-white/40 pl-1">€</span>
                      </div>
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider text-white/40">Tag</label>
                    <div className="flex gap-1 flex-wrap">
                      {(Object.keys(TAG_COLORS) as TagId[]).map((t) => {
                        const active = s.tag === t;
                        const style = TAG_COLORS[t];
                        return (
                          <button key={t} type="button"
                            onClick={() => patch(s.id, { tag: active ? null : t })}
                            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border transition-opacity"
                            style={{
                              borderColor: style.border,
                              background: style.bg,
                              color: style.text,
                              opacity: active ? 1 : 0.45,
                            }}>
                            {t}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wider text-white/40">Beschreibung / Notiz</label>
                  <AdaptiveTextarea
                    value={s.description ?? ''}
                    onChange={(e) => patch(s.id, { description: e.target.value })}
                    placeholder={'z. B. „Langes Haar +10 €" · „Nur Dienstag & Donnerstag" · „Termin dauert +15 min bei Neukunden"'}
                    minRows={2}
                    className={`w-full ${inputBase}`}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* + Add button — always available once at least one row exists or
         once the empty state has been dismissed. */}
      {value.length > 0 && (
        <button type="button" onClick={add}
          className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] hover:bg-white/[0.05] hover:border-orange-500/30 py-2 text-xs text-white/55 hover:text-white/85 transition-colors cursor-pointer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Service hinzufügen
        </button>
      )}

      {/* Preview line — helps the customer see what the agent will quote */}
      {value.length > 0 && (
        <div className="rounded-lg border border-white/[0.05] bg-black/20 px-3 py-2 mt-2">
          <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Agent sieht</p>
          <pre className="text-[11px] text-white/70 font-mono leading-relaxed whitespace-pre-wrap break-words">
{value
  .filter((s) => s.name.trim())
  .map((s) => {
    const bits: string[] = [s.name];
    if (s.price) {
      let price: string;
      if (s.priceFrom) price = `ab ${s.price} €`;
      else if (s.priceUpTo) price = `${s.price}–${s.priceUpTo} €`;
      else price = `${s.price} €`;
      bits[0] = `${s.name}: ${price}`;
    }
    if (s.duration) bits[0] += ` (${s.duration})`;
    if (s.description?.trim()) bits.push(`— ${s.description.trim()}`);
    if (s.tag) bits.push(`· ${s.tag}`);
    return `- ${bits.join(' ')}`;
  })
  .join('\n') || '—'}
          </pre>
        </div>
      )}
    </div>
  );
}
