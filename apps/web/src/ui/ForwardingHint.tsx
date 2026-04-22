import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconInfo } from './PhonbotIcons.js';

/**
 * Orange "Hinweis" pill that reveals a speech-bubble tooltip on hover or
 * keyboard focus. The bubble explains how forwarding-chain + Phonbot work
 * together (see Obsidian/Phonbot/Pages + the Call-Routing rule editor).
 *
 * Why portal + getBoundingClientRect + auto-flip:
 *  - The usual hosts (SectionCard in the Agent Builder, the phone-number
 *    card in PhoneManager) both use `overflow-hidden` on their wrapper
 *    for rounded-2xl border clipping. An absolute-positioned bubble
 *    inside that tree is invisible. Portalling into document.body sits
 *    outside every ancestor overflow boundary.
 *  - `position: fixed` + rect.left/rect.bottom anchors to the trigger's
 *    viewport position.
 *  - On trigger near the viewport bottom we flip the bubble above the
 *    pill, on narrow screens we clamp horizontally so the bubble never
 *    runs off-screen. The arrow stays visually anchored under the pill
 *    even when the bubble is clamped.
 *
 * Used on Capabilities-Tab (call routing) + Phone-Tab (forwarding
 * setup). Single component → copy only lives once.
 */

const BUBBLE_WIDTH = 320; // matches w-80
const BUBBLE_HEIGHT_MAX = 220; // upper-bound estimate for the 3-paragraph copy
const GAP = 10;
const EDGE_MARGIN = 12;

type Coords = {
  left: number;
  top: number;
  placeAbove: boolean;
  arrowX: number; // distance in px from the bubble's left edge to where the arrow should sit
};

export function ForwardingHint({ label = 'Hinweis' }: { label?: string } = {}) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);

  function show() {
    const el = triggerRef.current;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Vertical — try below first, flip above if there's no room.
    const roomBelow = vh - rect.bottom;
    const roomAbove = rect.top;
    const placeAbove = roomBelow < BUBBLE_HEIGHT_MAX + GAP && roomAbove > roomBelow;
    const top = placeAbove ? rect.top - GAP : rect.bottom + GAP;

    // Horizontal — centre on the trigger, then clamp so the bubble stays
    // `EDGE_MARGIN` px off both viewport edges.
    const triggerCenter = rect.left + rect.width / 2;
    const halfWidth = BUBBLE_WIDTH / 2;
    const minCenter = halfWidth + EDGE_MARGIN;
    const maxCenter = vw - halfWidth - EDGE_MARGIN;
    const bubbleCenter = Math.max(minCenter, Math.min(maxCenter, triggerCenter));

    // Arrow position inside the bubble — stays under the real trigger even
    // when the bubble was pushed to the side by the clamp.
    const bubbleLeftEdge = bubbleCenter - halfWidth;
    const arrowX = Math.max(
      12,
      Math.min(BUBBLE_WIDTH - 12, triggerCenter - bubbleLeftEdge),
    );

    setCoords({ left: bubbleCenter, top, placeAbove, arrowX });
    setVisible(true);
  }

  function hide() {
    setVisible(false);
  }

  return (
    <>
      <span
        ref={triggerRef}
        tabIndex={0}
        role="button"
        aria-label="Hinweis zur Rufweiterleitung"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-300 rounded-full px-2 py-0.5 bg-orange-500/10 border border-orange-500/25 hover:bg-orange-500/15 hover:text-orange-200 transition-colors cursor-help align-middle shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
      >
        <IconInfo size={10} />
        {label}
      </span>

      {visible && coords && typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              left: coords.left,
              top: coords.top,
              transform: `translateX(-50%)${coords.placeAbove ? ' translateY(-100%)' : ''}`,
              width: BUBBLE_WIDTH,
              maxWidth: 'calc(100vw - 2rem)',
              zIndex: 9999,
            }}
            className="pointer-events-none rounded-xl p-3.5 text-xs leading-relaxed text-white/85 bg-[#0A0A0F] border border-white/15 backdrop-blur-xl shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_20px_rgba(249,115,22,0.15)]"
          >
            {/* Speech-bubble arrow — flips with the bubble. Uses a 8-px
                square rotated 45° with two borders to get a clean corner
                that sits flush with the bubble edge. */}
            <span
              aria-hidden="true"
              style={{
                left: coords.arrowX,
                ...(coords.placeAbove
                  ? { bottom: -5, borderRight: '1px solid rgba(255,255,255,0.15)', borderBottom: '1px solid rgba(255,255,255,0.15)' }
                  : { top: -5, borderTop: '1px solid rgba(255,255,255,0.15)', borderLeft: '1px solid rgba(255,255,255,0.15)' }),
              }}
              className="absolute -translate-x-1/2 w-2 h-2 rotate-45 bg-[#0A0A0F]"
            />

            <p className="text-white font-medium mb-1.5">Wenn deine Nummer zu Phonbot umgeleitet ist:</p>
            <p>
              Die Weiterleitung vom Anrufer zur Zielnummer{' '}
              <span className="text-orange-300">funktioniert trotzdem</span>. Chipy nimmt den Anruf an und baut einen zweiten Anruf zur Zielnummer auf — beide Leitungen werden zusammengeschaltet.
            </p>
            <p className="mt-2">
              <span className="text-orange-300 font-medium">Einzige Falle:</span> die Zielnummer hat selbst eine „Immer weiterleiten"-Rufumleitung zu Phonbot — das wäre eine Endlosschleife. Am besten eine Mobilnummer ohne Rufumleitung eintragen.
            </p>
          </div>,
          document.body,
        )
      }
    </>
  );
}
