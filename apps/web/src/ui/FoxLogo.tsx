// Chipy — Phonbot mascot (the hamster)
import React from 'react';

/**
 * Chipy design principles:
 *  - 50-65% of face = eyes (Duolingo principle)
 *  - Max 5 colors, recognizable at 16px
 *  - Signature chubby cheek pouches
 *  - ONE tech detail: tiny cyan speech bubble
 *  - viewBox crops tightly around head so he looks full, not cut-off
 */

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'hero';
const SIZES: Record<Size, number> = { xs: 20, sm: 32, md: 48, lg: 72, xl: 110, hero: 160 };

type Props = { size?: Size | number; className?: string; glow?: boolean; animate?: boolean };

export function FoxLogo({ size = 'md', className = '', glow = false, animate = false }: Props) {
  const px = typeof size === 'number' ? size : SIZES[size];
  // Unique ID per instance to avoid gradient collisions when multiple Chipys on page
  const uid = React.useId().replace(/:/g, '');

  return (
    <div
      className={`inline-flex items-center justify-center select-none ${animate ? 'chipy-float' : ''} ${className}`}
      style={{
        width: px, height: px,
        ...(glow ? { filter: 'drop-shadow(0 0 10px rgba(249,115,22,0.55)) drop-shadow(0 2px 28px rgba(249,115,22,0.2))' } : {}),
      }}
    >
      {/*
        viewBox "0 8 100 92" — crops from y=8 so ears are fully visible at top,
        and stops at y=100 (bottom of head+cheeks). Chipy fills the square nicely.
      */}
      <svg viewBox="0 8 100 92" fill="none" xmlns="http://www.w3.org/2000/svg" width={px} height={px}>
        <defs>
          <radialGradient id={`${uid}-head`} cx="50%" cy="40%" r="65%">
            <stop offset="0%" stopColor="#F5C842" />
            <stop offset="100%" stopColor="#D49B12" />
          </radialGradient>
          <radialGradient id={`${uid}-cheek`} cx="50%" cy="40%" r="70%">
            <stop offset="0%" stopColor="#F7D04A" />
            <stop offset="100%" stopColor="#D9A015" />
          </radialGradient>
          <radialGradient id={`${uid}-eye`} cx="30%" cy="25%" r="75%">
            <stop offset="0%" stopColor="#FCD34D" />
            <stop offset="100%" stopColor="#B45309" />
          </radialGradient>

          {/* Sparkle filter for eye glitter */}
          <filter id={`${uid}-glit`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.4" result="blur" />
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        {/* ── EARS ── */}
        <circle cx="28" cy="22" r="9" fill="#D49B12" />
        <circle cx="28" cy="22" r="5.5" fill="#E8B32D" />
        <circle cx="72" cy="22" r="9" fill="#D49B12" />
        <circle cx="72" cy="22" r="5.5" fill="#E8B32D" />

        {/* ── HEAD ── */}
        <circle cx="50" cy="55" r="38" fill={`url(#${uid}-head)`} />

        {/* ── CHEEK POUCHES ── */}
        <ellipse cx="14" cy="62" rx="12" ry="11" fill={`url(#${uid}-cheek)`} />
        <ellipse cx="86" cy="62" rx="12" ry="11" fill={`url(#${uid}-cheek)`} />

        {/* ── EYES — with blink animation ── */}
        {/* Left eye white */}
        <circle cx="36" cy="50" r="13" fill="white" />
        {/* Left iris */}
        <circle cx="36" cy="50" r="10" fill={`url(#${uid}-eye)`} />
        {/* Left pupil — blink via scaleY on a group */}
        <g style={{ transformOrigin: '36px 50px' }}>
          <ellipse cx="36" cy="50" rx="6" ry="6" fill="#1C1917" className="chipy-blink-l" />
        </g>
        {/* Left highlight */}
        <circle cx="40" cy="46" r="3" fill="white" filter={`url(#${uid}-glit)`} />
        <circle cx="33" cy="54" r="1.2" fill="white" opacity="0.5" />
        {/* Left sparkle — tiny star glint */}
        <circle cx="41.5" cy="44.5" r="1" fill="white" className="chipy-sparkle" />

        {/* Right eye white */}
        <circle cx="64" cy="50" r="13" fill="white" />
        {/* Right iris */}
        <circle cx="64" cy="50" r="10" fill={`url(#${uid}-eye)`} />
        {/* Right pupil */}
        <g style={{ transformOrigin: '64px 50px' }}>
          <ellipse cx="64" cy="50" rx="6" ry="6" fill="#1C1917" className="chipy-blink-r" />
        </g>
        {/* Right highlight */}
        <circle cx="68" cy="46" r="3" fill="white" filter={`url(#${uid}-glit)`} />
        <circle cx="61" cy="54" r="1.2" fill="white" opacity="0.5" />
        {/* Right sparkle */}
        <circle cx="69.5" cy="44.5" r="1" fill="white" className="chipy-sparkle chipy-sparkle-delay" />

        {/* ── NOSE ── */}
        <ellipse cx="50" cy="64" rx="3" ry="2.2" fill="#B45309" />

        {/* ── SMILE ── */}
        <path d="M44 68 Q50 73 56 68" stroke="#8B4513" strokeWidth="1.6" fill="none" strokeLinecap="round" />

        {/* ── BLUSH ── */}
        <ellipse cx="24" cy="60" rx="5" ry="3.5" fill="#FB923C" opacity="0.22" />
        <ellipse cx="76" cy="60" rx="5" ry="3.5" fill="#FB923C" opacity="0.22" />

        {/* ── SPEECH BUBBLE ── */}
        <rect x="75" y="16" width="18" height="12" rx="5" fill="#22D3EE" />
        <path d="M80 28 L77 32 L83 28" fill="#22D3EE" />
        <circle cx="80" cy="22" r="1.3" fill="white" opacity="0.9" />
        <circle cx="84" cy="22" r="1.3" fill="white" opacity="0.9" />
        <circle cx="88" cy="22" r="1.3" fill="white" opacity="0.9" />
      </svg>
    </div>
  );
}

/** Chipy Eyes — minimal variant, just the big eyes */
export function FoxEyes({ size = 28, className = '' }: { size?: number; className?: string }) {
  const uid = React.useId().replace(/:/g, '');
  return (
    <div className={`inline-flex items-center justify-center select-none ${className}`}
      style={{ width: size, height: size }}>
      <svg viewBox="0 0 60 36" fill="none" xmlns="http://www.w3.org/2000/svg" width={size} height={size * 0.6}>
        <defs>
          <radialGradient id={`${uid}-el`} cx="30%" cy="25%" r="75%">
            <stop offset="0%" stopColor="#FCD34D" />
            <stop offset="100%" stopColor="#B45309" />
          </radialGradient>
          <radialGradient id={`${uid}-er`} cx="30%" cy="25%" r="75%">
            <stop offset="0%" stopColor="#FCD34D" />
            <stop offset="100%" stopColor="#B45309" />
          </radialGradient>
        </defs>
        <circle cx="14" cy="18" r="13" fill="white" />
        <circle cx="14" cy="18" r="10" fill={`url(#${uid}-el)`} />
        <circle cx="15" cy="19" r="6" fill="#1C1917" />
        <circle cx="18" cy="14" r="3" fill="white" />
        <circle cx="46" cy="18" r="13" fill="white" />
        <circle cx="46" cy="18" r="10" fill={`url(#${uid}-er)`} />
        <circle cx="47" cy="19" r="6" fill="#1C1917" />
        <circle cx="50" cy="14" r="3" fill="white" />
      </svg>
    </div>
  );
}

/** Phonbot wordmark */
export function PhonbotBrand({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const cfg = {
    sm: { s: 'sm' as Size, t: 'text-base', g: 'gap-1.5' },
    md: { s: 'md' as Size, t: 'text-xl',   g: 'gap-2'   },
    lg: { s: 'lg' as Size, t: 'text-3xl',  g: 'gap-3'   },
  }[size];
  return (
    <div className={`flex items-center ${cfg.g} ${className}`}>
      <FoxLogo size={cfg.s} />
      <span className={`font-black tracking-tight leading-none ${cfg.t}`}>
        <span className="text-white">Phon</span>
        <span style={{ background: 'linear-gradient(135deg,#F97316,#06B6D4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>bot</span>
      </span>
    </div>
  );
}
