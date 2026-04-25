// Shared nav partial — matches apps/web/src/ui/landing/NavHeader.tsx 1:1.
// Emits the sticky unified nav that every static HTML page uses
// (5 branch pages + impressum + datenschutz + agb).
//
// HTML interaction (hamburger toggle, Branchen-dropdown open/close,
// click-outside) lives in /apps/web/public/nav.js — already loaded by
// every static page via <script src="/nav.js" defer>.

const FOX_LOGO_SVG = [
  '<svg viewBox="0 8 100 92" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32">',
  '<defs>',
  '<radialGradient id="ch" cx="50%" cy="40%" r="65%"><stop offset="0%" stop-color="#F5C842"/><stop offset="100%" stop-color="#D49B12"/></radialGradient>',
  '<radialGradient id="cc" cx="50%" cy="40%" r="70%"><stop offset="0%" stop-color="#F7D04A"/><stop offset="100%" stop-color="#D9A015"/></radialGradient>',
  '<radialGradient id="ce" cx="30%" cy="25%" r="75%"><stop offset="0%" stop-color="#FCD34D"/><stop offset="100%" stop-color="#B45309"/></radialGradient>',
  '</defs>',
  '<circle cx="28" cy="22" r="9" fill="#D49B12"/><circle cx="28" cy="22" r="5.5" fill="#E8B32D"/>',
  '<circle cx="72" cy="22" r="9" fill="#D49B12"/><circle cx="72" cy="22" r="5.5" fill="#E8B32D"/>',
  '<circle cx="50" cy="55" r="38" fill="url(#ch)"/>',
  '<ellipse cx="14" cy="62" rx="12" ry="11" fill="url(#cc)"/><ellipse cx="86" cy="62" rx="12" ry="11" fill="url(#cc)"/>',
  '<circle cx="36" cy="50" r="13" fill="white"/><circle cx="36" cy="50" r="10" fill="url(#ce)"/>',
  '<ellipse cx="36" cy="50" rx="6" ry="6" fill="#1C1917"/><circle cx="40" cy="46" r="3" fill="white"/>',
  '<circle cx="64" cy="50" r="13" fill="white"/><circle cx="64" cy="50" r="10" fill="url(#ce)"/>',
  '<ellipse cx="64" cy="50" rx="6" ry="6" fill="#1C1917"/><circle cx="68" cy="46" r="3" fill="white"/>',
  '<ellipse cx="50" cy="64" rx="3" ry="2.2" fill="#B45309"/>',
  '<path d="M44 68 Q50 73 56 68" stroke="#8B4513" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  '</svg>',
].join('');

// Matches TEMPLATES in apps/web/src/ui/landing/shared.ts — keep in sync!
const INDUSTRIES = [
  { slug: 'friseur',       name: 'Friseur',       iconInner: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>' },
  { slug: 'handwerker',    name: 'Handwerker',    iconInner: '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>' },
  { slug: 'reinigung',     name: 'Reinigung',     iconInner: '<path d="M3 21l7-7"/><path d="M13.5 5.5l5.19-1.04 1.04 5.2-9.23 9.23a2 2 0 01-2.83 0l-2.83-2.83a2 2 0 010-2.83z"/><path d="M7.4 13.4l4.24-4.24"/>' },
  { slug: 'restaurant',    name: 'Restaurant',    iconInner: '<line x1="18" y1="2" x2="18" y2="22"/><path d="M22 8H14V2"/><line x1="6" y1="2" x2="6" y2="8"/><path d="M2 8a4 4 0 008 0"/><line x1="6" y1="12" x2="6" y2="22"/>' },
  { slug: 'autowerkstatt', name: 'Autowerkstatt', iconInner: '<path d="M5 17H3a2 2 0 01-2-2v-4l2.69-6.73A2 2 0 015.54 3h12.92a2 2 0 011.85 1.27L23 11v4a2 2 0 01-2 2h-2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/>' },
  // 6. Selbstständige / Solopreneur (2026-04-24) — dedicated target for
  // freelancers, coaches, consultants, creatives. Uses the headphones
  // glyph (matches TEMPLATES.IconHeadphones in shared.ts) to visually
  // differentiate from the 5 classical trade branches above.
  { slug: 'selbststaendig', name: 'Mein Agent', iconInner: '<path d="M3 14h3a2 2 0 012 2v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-8a9 9 0 0118 0v8a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3"/>' },
];

const industryIcon = (inner, s) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}" aria-hidden="true">${inner}</svg>`;

const industryLinksDesktop = INDUSTRIES
  .map((i) => `<a href="/${i.slug}/" role="menuitem">${industryIcon(i.iconInner, 18)}<span>${i.name}</span></a>`)
  .join('');

const industryLinksMobile = INDUSTRIES
  .map((i) => `<a href="/${i.slug}/">${industryIcon(i.iconInner, 16)}<span>${i.name}</span></a>`)
  .join('');

const CHEV = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1 3l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Full nav CSS — bounded by the `--begin` / `--end` markers so
 *  `scripts/sync-legal-nav.mjs` can find + replace the block. */
export const NAV_STYLE = `/*--nav-css-begin--*/
.ph-header{position:sticky;top:0;z-index:50;border-bottom:1px solid rgba(255,255,255,.05);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);background:rgba(10,10,15,.8)}
.ph-inner{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.5rem;max-width:1152px;margin:0 auto;gap:1rem}
.ph-logo{display:flex;align-items:center;gap:8px;text-decoration:none;flex-shrink:0}
.ph-brand{font-size:18px;font-weight:900;letter-spacing:-.5px;line-height:1}
.ph-brand .w{color:#fff}
.ph-brand .o{background:linear-gradient(135deg,#F97316,#06B6D4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.ph-nav{display:none;align-items:center;gap:2rem}
@media(min-width:768px){.ph-nav{display:flex}}
.ph-nav a,.ph-nav-btn{font-size:.875rem;color:rgba(255,255,255,.6);text-decoration:none;transition:color .2s;background:none;border:none;cursor:pointer;font-family:inherit;padding:0;display:flex;align-items:center;gap:.25rem;font-weight:500}
.ph-nav a:hover,.ph-nav-btn:hover{color:#fff}
.ph-dd-wrap{position:relative}
.ph-dd-btn svg{transition:transform .2s}
#ph-dd.open .ph-dd-btn svg{transform:rotate(180deg)}
.ph-dd-menu{position:absolute;left:50%;transform:translateX(-50%);top:calc(100% + .75rem);width:16rem;border-radius:1rem;border:1px solid rgba(255,255,255,.1);background:rgba(10,10,15,.95);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 20px 60px rgba(0,0,0,.5);padding:.5rem 0;z-index:60;display:none}
#ph-dd.open .ph-dd-menu{display:block}
.ph-dd-menu a{display:flex;align-items:center;gap:.75rem;padding:.625rem 1rem;font-size:.875rem;color:rgba(255,255,255,.8);text-decoration:none;transition:background .15s,color .15s}
.ph-dd-menu a:hover{background:rgba(255,255,255,.05);color:#fff}
.ph-dd-menu a svg{color:#FB923C;flex-shrink:0}
.ph-right{display:flex;align-items:center;gap:1rem;flex-shrink:0}
.ph-login{display:none;font-size:.875rem;color:rgba(255,255,255,.6);text-decoration:none;transition:color .2s}
@media(min-width:768px){.ph-login{display:block}}
.ph-login:hover{color:#fff}
.ph-cta-btn{display:none;font-size:.875rem;text-decoration:none;font-weight:600;color:#fff;border-radius:9999px;padding:10px 20px;background:linear-gradient(135deg,#F97316,#06B6D4);transition:all .3s}
@media(min-width:768px){.ph-cta-btn{display:inline-block}}
.ph-cta-btn:hover{box-shadow:0 0 24px rgba(249,115,22,.5);transform:scale(1.05)}
.ph-burg{display:flex;flex-direction:column;gap:4px;padding:.5rem;border-radius:.5rem;background:transparent;border:none;cursor:pointer;transition:background .2s}
@media(min-width:768px){.ph-burg{display:none}}
.ph-burg:hover{background:rgba(255,255,255,.05)}
.ph-burg span{display:block;width:20px;height:2px;background:rgba(255,255,255,.6);transition:all .2s}
body.mopen .ph-burg span:nth-child(1){transform:translateY(6px) rotate(45deg)}
body.mopen .ph-burg span:nth-child(2){opacity:0}
body.mopen .ph-burg span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}
.ph-mob{display:none;border-top:1px solid rgba(255,255,255,.05);background:rgba(10,10,15,.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:.75rem 1.5rem}
body.mopen .ph-mob{display:block}
.ph-mob>a,.ph-mob>details>summary{display:flex;align-items:center;justify-content:space-between;padding:.875rem 0;font-size:.875rem;color:rgba(255,255,255,.6);text-decoration:none;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;list-style:none;font-weight:500}
.ph-mob>a:hover,.ph-mob>details>summary:hover{color:#fff}
.ph-mob>details>summary::-webkit-details-marker{display:none}
.ph-mob>details summary svg{transition:transform .2s}
.ph-mob>details[open] summary svg{transform:rotate(180deg)}
.ph-mob-sub{padding:.25rem 0 .5rem}
.ph-mob-sub a{display:flex;align-items:center;gap:.75rem;padding:.5rem 0;font-size:.85rem;color:rgba(255,255,255,.7);text-decoration:none}
.ph-mob-sub a:hover{color:#fff}
.ph-mob-sub a svg{color:#FB923C;flex-shrink:0}
.ph-mob-cta{display:flex;flex-direction:column;gap:.5rem;padding:.75rem 0 .25rem}
.ph-mob-cta a{text-align:center;padding:.75rem;border-radius:.75rem;font-weight:600;text-decoration:none;font-size:.875rem}
.ph-mob-cta a.login{border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.7)}
.ph-mob-cta a.cta{background:linear-gradient(135deg,#F97316,#06B6D4);color:#fff}
/*--nav-css-end--*/`;

/** Full nav HTML — bounded by the `--begin` / `--end` markers so
 *  `scripts/sync-legal-nav.mjs` can find + replace the block. */
export const NAV_HTML = `<!--nav-html-begin-->
<header class="ph-header">
  <div class="ph-inner">
    <a href="/" class="ph-logo" aria-label="Phonbot Startseite">${FOX_LOGO_SVG}<span class="ph-brand"><span class="w">Phon</span><span class="o">bot</span></span></a>
    <nav class="ph-nav" aria-label="Hauptnavigation">
      <a href="/#demo">Demo</a>
      <a href="/#features">Features</a>
      <a href="/#preise">Preise</a>
      <a href="/#faq">FAQ</a>
      <div class="ph-dd-wrap" id="ph-dd">
        <button type="button" id="ph-dd-btn" class="ph-dd-btn ph-nav-btn" aria-haspopup="true" aria-expanded="false">Branchen ${CHEV}</button>
        <div class="ph-dd-menu" role="menu">${industryLinksDesktop}</div>
      </div>
      <a href="/?page=contact">Kontakt</a>
    </nav>
    <div class="ph-right">
      <a href="/?page=login" class="ph-login">Einloggen</a>
      <a href="/?page=register" class="ph-cta-btn">Kostenlos testen</a>
      <button type="button" id="ph-burg" class="ph-burg" aria-label="Menü öffnen"><span></span><span></span><span></span></button>
    </div>
  </div>
  <div class="ph-mob" id="ph-mob">
    <a href="/#demo">Demo</a>
    <a href="/#features">Features</a>
    <a href="/#preise">Preise</a>
    <a href="/#faq">FAQ</a>
    <details>
      <summary>Branchen ${CHEV}</summary>
      <div class="ph-mob-sub">${industryLinksMobile}</div>
    </details>
    <a href="/?page=contact">Kontakt</a>
    <div class="ph-mob-cta">
      <a href="/?page=login" class="login">Einloggen</a>
      <a href="/?page=register" class="cta">Kostenlos testen</a>
    </div>
  </div>
</header>
<!--nav-html-end-->`;
