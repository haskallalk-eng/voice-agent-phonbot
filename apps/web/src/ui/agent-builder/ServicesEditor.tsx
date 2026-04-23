import React, { useEffect, useRef, useState } from 'react';
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

// Segmented-pill chip used for the Preis-Modus switch. Lives inside a
// pill-shaped container so the three options read as one control with a
// sliding-selection feel rather than three independent buttons.
function PriceModeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="text-[11px] font-medium px-3 py-1.5 rounded-full transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
      style={
        active
          ? { background: 'linear-gradient(135deg, #F97316, #06B6D4)', color: '#fff' }
          : { background: 'transparent', color: 'rgba(255,255,255,0.55)' }
      }
    >
      {children}
    </button>
  );
}

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

  // Ref tracks the latest array so two patch() calls inside the same React
  // batch (e.g. the user clicks "ab X" + "BELIEBT" in quick succession on a
  // keyboard nav) don't overwrite each other. Without this, both calls close
  // over the same `value` prop, and the second apply wins.
  const latestRef = useRef(value);
  useEffect(() => { latestRef.current = value; }, [value]);

  function patch(id: string, p: Partial<ServiceItem>) {
    const next = latestRef.current.map((s) => (s.id === id ? { ...s, ...p } : s));
    latestRef.current = next;
    onChange(next);
  }
  function remove(id: string) {
    const next = latestRef.current.filter((s) => s.id !== id);
    latestRef.current = next;
    onChange(next);
    if (expandedId === id) setExpandedId(null);
  }
  function add() {
    const newItem: ServiceItem = { id: newId(), name: '' };
    const next = [...latestRef.current, newItem];
    latestRef.current = next;
    onChange(next);
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
    const next = [...latestRef.current, ...items];
    latestRef.current = next;
    onChange(next);
    onConsumeLegacy();
  }

  // Chipy-design: rounded-xl, px-3 py-2, orange-500/50 focus ring (matches
  // the spec in apps/web/src/ui/landing/ input fields).
  const inputBase =
    'bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2 text-xs text-white/90 outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 placeholder:text-white/30 transition-colors';

  return (
    <div className="space-y-2.5">
      {/* Legacy-text migration banner */}
      {value.length === 0 && legacyText.trim().length > 0 && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-200/90 flex items-center justify-between gap-3">
          <span className="leading-relaxed">
            Alter Freitext: <span className="italic text-white/70">„{legacyText.slice(0, 80)}{legacyText.length > 80 ? '…' : ''}"</span>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={migrateLegacy}
              className="text-xs px-4 py-2 rounded-full font-semibold text-white transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_0_20px_rgba(249,115,22,0.35)] cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
            >
              Übernehmen
            </button>
            <button
              type="button"
              onClick={onConsumeLegacy}
              className="text-xs text-white/50 hover:text-white/85 transition-colors cursor-pointer"
            >
              Verwerfen
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {value.length === 0 && legacyText.trim().length === 0 && (
        <div
          className="glass rounded-2xl px-5 py-6 text-center"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.12)' }}
        >
          <p className="text-sm text-white/60 mb-3">Noch keine Services eingetragen.</p>
          <button
            type="button"
            onClick={add}
            className="text-xs px-5 py-2 rounded-full font-semibold text-white transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_0_24px_rgba(249,115,22,0.4)] cursor-pointer"
            style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
          >
            Ersten Service anlegen
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
            className="rounded-2xl border overflow-hidden transition-colors duration-200"
            style={{
              borderColor: isExpanded ? 'rgba(249,115,22,0.25)' : 'rgba(255,255,255,0.10)',
              background: isExpanded
                ? 'linear-gradient(135deg, rgba(249,115,22,0.04) 0%, rgba(6,182,212,0.02) 100%)'
                : 'rgba(255,255,255,0.04)',
            }}
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
              <div className="flex items-center gap-1 shrink-0">
                <input
                  type="text"
                  value={s.price ?? ''}
                  onChange={(e) => patch(s.id, { price: e.target.value })}
                  placeholder="Preis"
                  inputMode="decimal"
                  aria-label="Preis"
                  className={`w-20 text-right ${inputBase}`}
                />
                <span className="text-xs text-white/45 px-0.5">€</span>
              </div>
              <input
                type="text"
                value={s.duration ?? ''}
                onChange={(e) => patch(s.id, { duration: e.target.value })}
                placeholder="Dauer"
                aria-label="Dauer"
                className={`w-24 shrink-0 ${inputBase}`}
              />
              {tagStyle && (
                <span
                  className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0"
                  style={{ borderColor: tagStyle.border, background: tagStyle.bg, color: tagStyle.text }}
                >
                  {s.tag}
                </span>
              )}
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : s.id)}
                title="Weitere Optionen"
                aria-expanded={isExpanded}
                aria-label={isExpanded ? 'Optionen schließen' : 'Optionen öffnen'}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/[0.08] text-white/45 hover:text-white/90 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
                style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => remove(s.id)}
                title="Service entfernen"
                aria-label="Service entfernen"
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-red-500/15 text-white/30 hover:text-red-300 transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                </svg>
              </button>
            </div>

            {/* Expanded options */}
            {isExpanded && (
              <div
                className="border-t px-4 py-4 space-y-4"
                style={{ borderColor: 'rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.15)' }}
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-wider text-white/40">Preis-Modus</label>
                    <div className="inline-flex p-0.5 rounded-full bg-white/[0.05] border border-white/10 gap-0.5">
                      <PriceModeChip active={!s.priceFrom && typeof s.priceUpTo !== 'string'}
                        onClick={() => patch(s.id, { priceFrom: false, priceUpTo: undefined })}>Fest</PriceModeChip>
                      <PriceModeChip active={!!s.priceFrom}
                        onClick={() => patch(s.id, { priceFrom: true, priceUpTo: undefined })}>ab X</PriceModeChip>
                      <PriceModeChip active={!s.priceFrom && typeof s.priceUpTo === 'string'}
                        onClick={() => patch(s.id, { priceFrom: false, priceUpTo: s.priceUpTo ?? '' })}>Von–Bis</PriceModeChip>
                    </div>
                  </div>
                  {typeof s.priceUpTo === 'string' && !s.priceFrom && (
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-wider text-white/40">Preis bis</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={s.priceUpTo}
                          onChange={(e) => patch(s.id, { priceUpTo: e.target.value })}
                          placeholder="60"
                          inputMode="decimal"
                          className={`flex-1 text-right ${inputBase}`}
                        />
                        <span className="text-xs text-white/45 px-0.5">€</span>
                      </div>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-wider text-white/40">Tag</label>
                    <div className="flex gap-1.5 flex-wrap items-center">
                      {(Object.keys(TAG_COLORS) as TagId[]).map((t) => {
                        const active = s.tag === t;
                        const style = TAG_COLORS[t];
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => patch(s.id, { tag: active ? null : t })}
                            className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full border transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
                            style={{
                              borderColor: active ? style.border : 'rgba(255,255,255,0.1)',
                              background: active ? style.bg : 'rgba(255,255,255,0.03)',
                              color: active ? style.text : 'rgba(255,255,255,0.4)',
                              boxShadow: active ? `0 0 16px ${style.border}` : 'none',
                            }}
                          >
                            {t}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
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

      {/* + Add button — glass pill, centred, matches the secondary-CTA
          family used elsewhere in the builder. */}
      {value.length > 0 && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={add}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium text-white/75 border border-white/15 bg-white/[0.05] hover:text-white hover:border-orange-500/40 hover:bg-white/[0.08] transition-all duration-300 hover:scale-[1.02] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
            style={{ backdropFilter: 'blur(12px)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Service hinzufügen
          </button>
        </div>
      )}

      {/* Preview card — how the agent will read this list. Same glass
          treatment as the "Agent sieht"-preview under Öffnungszeiten. */}
      {value.length > 0 && (
        <div
          className="rounded-2xl border px-4 py-3 mt-2"
          style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.25)' }}
        >
          <p className="text-[10px] uppercase tracking-wider text-white/35 mb-1.5">Agent sieht</p>
          <pre className="text-[11px] text-white/75 font-mono leading-relaxed whitespace-pre-wrap break-words">
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
