// Shared nav partial — matches apps/web/src/ui/landing/NavHeader.tsx 1:1.
// Emits the sticky unified nav that every static HTML page uses.
//
// The `--nav-css-begin/end--` block also carries the SITE THEME for static
// pages (Space-Grotesk @font-face + display-typography), so every page that
// embeds NAV_STYLE — generators AND the hand-maintained legal pages via
// scripts/sync-legal-nav.mjs — automatically matches the SPA design.
//
// HTML interaction (hamburger toggle) lives in /apps/web/public/nav.js —
// already loaded by every static page via <script src="/nav.js" defer>.

// Brand row = App-Icon (Quadrat mit Chipys Augen) + Schriftzug, exakt wie
// PhonbotBrand (FoxLogo.tsx) im SPA.
const BRAND_ROW_HTML =
  '<img class="ph-mark" src="/brand/phonbot-site-icon-transparent-512.png" alt="" width="34" height="34" decoding="async" loading="eager"><span class="ph-brand"><span class="w">Phon</span><span class="o">bot</span></span>';

/** Full nav CSS — bounded by the `--begin` / `--end` markers so
 *  `scripts/sync-legal-nav.mjs` can find + replace the block. */
export const NAV_STYLE = `/*--nav-css-begin--*/
@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:300 700;font-display:swap;src:url('/fonts/space-grotesk-latin.woff2') format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
h1,h2,h3,h4{font-family:'Space Grotesk','Inter',ui-sans-serif,system-ui,sans-serif}
h1,h2{font-weight:700;letter-spacing:-.022em;color:rgba(255,255,255,.96)}
.ph-header{position:sticky;top:0;z-index:50;border-bottom:1px solid rgba(255,255,255,.05);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);background:rgba(10,10,15,.8)}
.ph-inner{display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.5rem;max-width:1152px;margin:0 auto;gap:1rem}
.ph-logo{display:flex;align-items:center;gap:8px;text-decoration:none;flex-shrink:0}
.ph-mark{width:34px;height:34px;object-fit:contain;display:block;filter:drop-shadow(0 0 10px rgba(255,91,10,.30)) drop-shadow(0 0 12px rgba(32,217,255,.20))}
.ph-brand{font-family:'Space Grotesk','Inter',ui-sans-serif,system-ui,sans-serif;font-size:19px;font-weight:700;letter-spacing:-.5px;line-height:1}
.ph-brand .w{color:#fff}
.ph-brand .o{background:linear-gradient(112deg,#ff5b0a 0%,#ffb766 28%,#f7fbff 48%,#20d9ff 68%,#008de6 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.ph-nav{display:none;align-items:center;gap:2rem}
@media(min-width:768px){.ph-nav{display:flex}}
.ph-nav a,.ph-nav-btn{font-family:'Space Grotesk','Inter',ui-sans-serif,system-ui,sans-serif;font-size:.875rem;color:rgba(255,255,255,.6);text-decoration:none;transition:color .2s;background:none;border:none;cursor:pointer;padding:0;display:flex;align-items:center;gap:.25rem;font-weight:500}
.ph-nav a:hover,.ph-nav-btn:hover{color:#fff}
.ph-right{display:flex;align-items:center;gap:1rem;flex-shrink:0}
.ph-login{display:none;font-family:'Space Grotesk','Inter',ui-sans-serif,system-ui,sans-serif;font-size:.875rem;color:rgba(255,255,255,.6);text-decoration:none;transition:color .2s}
@media(min-width:768px){.ph-login{display:block}}
.ph-login:hover{color:#fff}
.ph-cta-btn{display:none;font-family:'Space Grotesk','Inter',ui-sans-serif,system-ui,sans-serif;font-size:.875rem;text-decoration:none;font-weight:600;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.18);border-radius:9999px;padding:10px 20px;background:linear-gradient(112deg,rgba(255,91,10,.88) 0%,rgba(255,148,61,.78) 32%,rgba(103,232,249,.58) 56%,rgba(32,217,255,.78) 74%,rgba(0,141,230,.8) 100%),rgba(10,12,20,.65);box-shadow:inset 0 1px 0 rgba(255,255,255,.42);transition:all .3s}
@media(min-width:768px){.ph-cta-btn{display:inline-block}}
.ph-cta-btn:hover{box-shadow:0 0 24px rgba(255,91,10,.45);transform:scale(1.05)}
.ph-burg{display:flex;flex-direction:column;gap:4px;padding:.5rem;border-radius:.5rem;background:transparent;border:none;cursor:pointer;transition:background .2s}
@media(min-width:768px){.ph-burg{display:none}}
.ph-burg:hover{background:rgba(255,255,255,.05)}
.ph-burg span{display:block;width:20px;height:2px;background:rgba(255,255,255,.6);transition:all .2s}
body.mopen .ph-burg span:nth-child(1){transform:translateY(6px) rotate(45deg)}
body.mopen .ph-burg span:nth-child(2){opacity:0}
body.mopen .ph-burg span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}
.ph-mob{display:none;border-top:1px solid rgba(255,255,255,.05);background:rgba(10,10,15,.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:.75rem 1.5rem}
body.mopen .ph-mob{display:block}
.ph-mob>a{display:flex;align-items:center;justify-content:space-between;padding:.875rem 0;font-family:'Space Grotesk','Inter',ui-sans-serif,system-ui,sans-serif;font-size:.875rem;color:rgba(255,255,255,.6);text-decoration:none;border-bottom:1px solid rgba(255,255,255,.05);font-weight:500}
.ph-mob>a:hover{color:#fff}
.ph-mob-cta{display:flex;flex-direction:column;gap:.5rem;padding:.75rem 0 .25rem}
.ph-mob-cta a{text-align:center;padding:.75rem;border-radius:9999px;font-family:'Space Grotesk','Inter',ui-sans-serif,system-ui,sans-serif;font-weight:600;text-decoration:none;font-size:.875rem}
.ph-mob-cta a.login{border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.7)}
.ph-mob-cta a.cta{background:linear-gradient(112deg,rgba(255,91,10,.88) 0%,rgba(255,148,61,.78) 32%,rgba(103,232,249,.58) 56%,rgba(32,217,255,.78) 74%,rgba(0,141,230,.8) 100%),rgba(10,12,20,.65);border:1px solid rgba(255,255,255,.18);text-shadow:0 1px 2px rgba(0,0,0,.3);color:#fff}
/*--nav-css-end--*/`;

/** Full nav HTML — bounded by the `--begin` / `--end` markers so
 *  `scripts/sync-legal-nav.mjs` can find + replace the block. */
export const NAV_HTML = `<!--nav-html-begin-->
<header class="ph-header">
  <div class="ph-inner">
    <a href="/" class="ph-logo" aria-label="Phonbot Startseite">${BRAND_ROW_HTML}</a>
    <nav class="ph-nav" aria-label="Hauptnavigation">
      <a href="/#demo">Demo</a>
      <a href="/#features">Features</a>
      <a href="/#preise">Preise</a>
      <a href="/#faq">FAQ</a>
      <a href="/friseur/">Für Friseure</a>
      <a href="/blog/">Blog</a>
      <a href="/kontakt/">Kontakt</a>
    </nav>
    <div class="ph-right">
      <a href="/?page=login" class="ph-login">Einloggen</a>
      <a href="/?page=register" class="ph-cta-btn">Kostenlos testen</a>
      <button type="button" id="ph-burg" class="ph-burg" aria-label="Menü öffnen" aria-expanded="false" aria-controls="ph-mob"><span></span><span></span><span></span></button>
    </div>
  </div>
  <div class="ph-mob" id="ph-mob">
    <a href="/#demo">Demo</a>
    <a href="/#features">Features</a>
    <a href="/#preise">Preise</a>
    <a href="/#faq">FAQ</a>
    <a href="/friseur/">Für Friseure</a>
    <a href="/blog/">Blog</a>
    <a href="/kontakt/">Kontakt</a>
    <div class="ph-mob-cta">
      <a href="/?page=login" class="login">Einloggen</a>
      <a href="/?page=register" class="cta">Kostenlos testen</a>
    </div>
  </div>
</header>
<!--nav-html-end-->`;
