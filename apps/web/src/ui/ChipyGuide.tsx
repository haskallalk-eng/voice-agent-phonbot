import React, { useState, useEffect, useRef } from 'react';
import { FoxLogo } from './FoxLogo.js';

/**
 * ChipyGuide — Chipy rolls dynamically through the landing page.
 * 
 * NOT a fixed corner widget. Instead, Chipy is embedded between sections
 * and "rolls" across the screen as you scroll. Speech bubbles appear inline.
 * He never covers content — he lives in dedicated gaps between sections.
 * 
 * Usage: Place <ChipyWaypoint /> components between sections in LandingPage.
 * Each waypoint is a "stop" where Chipy appears, rolls in, shows a bubble.
 */

interface WaypointProps {
  message: string;
  from?: 'left' | 'right';
  size?: number;
}

/**
 * A single Chipy waypoint — place between sections.
 * Chipy rolls in from left or right, pauses, shows speech bubble, then the user scrolls on.
 */
export function ChipyWaypoint({ message, from = 'left', size = 52 }: WaypointProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [bubbleShow, setBubbleShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry && entry.isIntersecting) {
          setVisible(true);
          // Stagger bubble appearance
          setTimeout(() => setBubbleShow(true), 400);
        } else {
          setVisible(false);
          setBubbleShow(false);
        }
      },
      { threshold: 0.3 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const isLeft = from === 'left';

  return (
    <div
      ref={ref}
      className="relative w-full overflow-hidden pointer-events-none select-none"
      style={{ height: 80 }}
    >
      {/* Chipy rolling in */}
      <div
        className={`
          absolute top-1/2 flex items-center gap-3
          transition-all duration-700 ease-out
          ${isLeft ? 'flex-row' : 'flex-row-reverse'}
        `}
        style={{
          [isLeft ? 'left' : 'right']: visible ? '6%' : '-80px',
          transform: `translateY(-50%) rotate(${visible ? '0deg' : isLeft ? '-360deg' : '360deg'})`,
          opacity: visible ? 1 : 0,
          transition: 'all 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {/* Chipy mascot with subtle bounce */}
        <div
          style={{
            animation: visible ? 'chipy-bounce 2s ease-in-out infinite' : 'none',
            animationDelay: '0.7s',
          }}
        >
          <FoxLogo size={size} />
        </div>

        {/* Speech bubble */}
        <div
          className={`
            relative bg-white/[0.07] backdrop-blur-sm border border-white/10
            px-4 py-2.5 rounded-2xl max-w-xs
            transition-all duration-500 ease-out
            ${bubbleShow ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}
          `}
          style={{
            transitionDelay: bubbleShow ? '0.1s' : '0s',
          }}
        >
          {/* Bubble tail */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white/[0.07] border border-white/10 rotate-45
              ${isLeft ? '-left-1.5 border-r-0 border-t-0' : '-right-1.5 border-l-0 border-b-0'}
            `}
          />
          <p className="text-sm text-white/70 font-medium leading-snug relative z-10">
            {message}
          </p>
        </div>
      </div>

      {/* Rolling trail — subtle dots */}
      <div
        className="absolute top-1/2 -translate-y-1/2 flex gap-1.5 transition-all duration-1000"
        style={{
          [isLeft ? 'left' : 'right']: visible ? '2%' : '-40px',
          opacity: visible ? 0.15 : 0,
          transitionDelay: '0.2s',
        }}
      >
        {[0.3, 0.2, 0.12].map((op, i) => (
          <div
            key={i}
            className="rounded-full bg-orange-400"
            style={{ width: 4 - i, height: 4 - i, opacity: op }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Inject the bounce keyframes into <head> once.
 * Call this component once at the top level (e.g. in LandingPage).
 */
export function ChipyStyles() {
  return (
    <style>{`
      @keyframes chipy-bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-4px); }
      }
    `}</style>
  );
}
