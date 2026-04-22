// Shared SVG icon set for static HTML pages — 1:1 ports of the Phonbot
// in-app icons in apps/web/src/ui/PhonbotIcons.tsx plus a handful of
// house icons for contexts the SPA didn't need yet (clock / euro / pill /
// cash / clipboard / package). All icons share the same sizing +
// stroke language so they read as one family:
//
//   - 24×24 viewBox, `fill="none"`, `stroke="currentColor"`, `stroke-width="1.75"`,
//     `stroke-linecap="round"`, `stroke-linejoin="round"`.
//   - Coloured at call-site via the parent's `color: #…` (e.g. `.text-orange-400`
//     equivalent in static CSS).
//
// Usage from any generator: `import { icon } from './_icons.mjs';` then
// `icon('wrench', 24)` returns an SVG string. Unknown names fall back to a
// small question-mark SVG so broken references stay visible but don't crash.
//
// ANY emoji that appears in user-facing copy on the Phonbot website must be
// routed through this file — emojis on branch pages were replaced on
// 2026-04-22 as part of the chipy-design roll-out.

const PATHS = {
  // Industries (the six that power Branchen dropdown + hero eyebrow)
  scissors:   '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>',
  wrench:     '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>',
  medical:    '<rect x="9" y="2" width="6" height="20" rx="2"/><rect x="2" y="9" width="20" height="6" rx="2"/>',
  broom:      '<path d="M3 21l7-7"/><path d="M13.5 5.5l5.19-1.04 1.04 5.2-9.23 9.23a2 2 0 01-2.83 0l-2.83-2.83a2 2 0 010-2.83z"/><path d="M7.4 13.4l4.24-4.24"/>',
  restaurant: '<line x1="18" y1="2" x2="18" y2="22"/><path d="M22 8H14V2"/><line x1="6" y1="2" x2="6" y2="8"/><path d="M2 8a4 4 0 008 0"/><line x1="6" y1="12" x2="6" y2="22"/>',
  car:        '<path d="M5 17H3a2 2 0 01-2-2v-4l2.69-6.73A2 2 0 015.54 3h12.92a2 2 0 011.85 1.27L23 11v4a2 2 0 01-2 2h-2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/>',

  // Core interaction
  phone:      '<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>',
  calendar:   '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="13" y2="18"/>',
  clock:      '<circle cx="12" cy="12" r="10"/><polyline points="12 7 12 12 16 14"/>',
  ticket:     '<path d="M2 9a3 3 0 010-6h20a3 3 0 010 6"/><path d="M2 15a3 3 0 000 6h20a3 3 0 000-6"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="6" x2="12" y2="6.01" stroke-width="2"/><line x1="12" y1="15" x2="12" y2="15.01" stroke-width="2"/>',
  user:       '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  building:   '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22V12h6v10"/><rect x="8" y="6" width="2" height="2" rx="0.5" fill="currentColor" stroke="none"/><rect x="14" y="6" width="2" height="2" rx="0.5" fill="currentColor" stroke="none"/><rect x="8" y="10" width="2" height="2" rx="0.5" fill="currentColor" stroke="none"/><rect x="14" y="10" width="2" height="2" rx="0.5" fill="currentColor" stroke="none"/>',
  lock:       '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/>',
  alert:      '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17" stroke-width="2.5"/>',
  document:   '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  clipboard:  '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>',

  // Money & commerce
  euro:       '<path d="M18 7a7 7 0 100 10"/><line x1="4" y1="10" x2="14" y2="10"/><line x1="4" y1="14" x2="11" y2="14"/>',
  cash:       '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4"/><path d="M18 10v4"/>',
  card:       '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',

  // Health / pharmacy
  pill:       '<path d="M10.5 20.5 3.5 13.5a5 5 0 017-7l7 7a5 5 0 01-7 7z"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/>',

  // Misc
  package:    '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  bolt:       '<polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  star:       '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  chat:       '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
  home:       '<path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1v-9.5z"/><path d="M9 21V12h6v9"/>',
  refresh:    '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>',

  // Fallback
  _:          '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2.5"/>',
};

/** Render a named icon as an inline SVG string. */
export function icon(name, size = 24) {
  const paths = PATHS[name] ?? PATHS._;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

/** List of names — useful for tests / diagnostics. */
export const ICON_NAMES = Object.keys(PATHS).filter((n) => n !== '_');
