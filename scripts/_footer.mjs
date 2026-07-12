// Shared site-footer partial — matches apps/web/src/ui/landing/FooterSection.tsx 1:1.
// Emits the 5-column footer (brand + Produkt + Branchen + Rechtliches + Kontakt)
// with the copyright/DSGVO bottom row. Used on every static HTML page (5 branch
// pages + impressum + datenschutz + agb). Render order: markers first, then
// content, so `scripts/sync-legal-nav.mjs` can find-and-replace the block
// idempotently.

// Brand row = App-Icon + Schriftzug, exakt wie PhonbotBrand (FoxLogo.tsx) im SPA-Footer.
const BRAND_ROW_HTML =
  '<img class="footer-mark" src="/brand/phonbot-site-icon-transparent-512.png" alt="" width="30" height="30" decoding="async" loading="lazy"><span class="footer-brand"><span class="w">Phon</span><span class="o">bot</span></span>';

export const FOOTER_STYLE = `/*--footer-css-begin--*/
.site-footer{position:relative;z-index:10;border-top:1px solid rgba(255,255,255,.05);padding:3rem 1.5rem 2rem;margin-top:4rem;background:rgba(10,10,15,.6)}
.site-footer .footer-container{max-width:1152px;margin:0 auto;padding:0;text-align:left}
.footer-grid{display:grid;grid-template-columns:1fr repeat(4,1fr);gap:2rem;margin-bottom:2.5rem}
@media(max-width:1024px){.footer-grid{grid-template-columns:1fr 1fr;gap:2rem 1.5rem}.footer-grid .col-brand{grid-column:1/-1}}
@media(max-width:480px){.footer-grid{grid-template-columns:1fr}}
.col-brand{display:flex;flex-direction:column;gap:.5rem;align-items:flex-start}
.col-brand .brand-row{display:flex;align-items:center;gap:7px;text-decoration:none}
.col-brand .footer-mark{width:30px;height:30px;object-fit:contain;display:block;filter:drop-shadow(0 0 10px rgba(255,91,10,.30)) drop-shadow(0 0 12px rgba(32,217,255,.20))}
.col-brand .footer-brand{font-family:'Space Grotesk','Inter',ui-sans-serif,system-ui,sans-serif;font-size:17px;font-weight:700;letter-spacing:-.5px;line-height:1}
.col-brand .footer-brand .w{color:#fff}
.col-brand .footer-brand .o{background:linear-gradient(112deg,#ff5b0a 0%,#ffb766 28%,#f7fbff 48%,#20d9ff 68%,#008de6 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.col-brand p{font-size:.75rem;color:rgba(255,255,255,.62);line-height:1.6;margin:.35rem 0 0}
.site-footer .footer-heading{font-size:.7rem;font-weight:600;color:rgba(255,255,255,.68);text-transform:uppercase;letter-spacing:.12em;margin:0 0 .75rem}
.site-footer ul.links{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.5rem}
.site-footer ul.links a{font-size:.875rem;color:rgba(255,255,255,.62);text-decoration:none;transition:color .2s}
.site-footer ul.links a:hover{color:rgba(255,255,255,.9)}
.footer-bottom{display:flex;flex-direction:column;gap:.75rem;align-items:center;padding-top:1.5rem;border-top:1px solid rgba(255,255,255,.05);text-align:center}
@media(min-width:640px){.footer-bottom{flex-direction:row;justify-content:space-between;text-align:left}}
.footer-bottom p{font-size:.75rem;color:rgba(255,255,255,.58);margin:0}
.footer-bottom a{color:rgba(255,255,255,.76);text-decoration:underline;text-decoration-color:rgba(255,255,255,.28);transition:all .2s}
.footer-bottom a:hover{color:rgba(255,255,255,.8);text-decoration-color:rgba(255,91,10,.6)}
/*--footer-css-end--*/`;

export const FOOTER_HTML = `<!--footer-html-begin-->
<footer class="site-footer">
  <div class="footer-container">
    <div class="footer-grid">
      <div class="col-brand">
        <a href="/" class="brand-row" aria-label="Phonbot Startseite">${BRAND_ROW_HTML}</a>
        <p>Der KI-Telefonassistent für Friseursalons.<br>Immer erreichbar.</p>
      </div>
      <div>
        <p class="footer-heading">Produkt</p>
        <ul class="links">
          <li><a href="/#features">Features</a></li>
          <li><a href="/#demo">Demo</a></li>
          <li><a href="/#preise">Preise</a></li>
          <li><a href="/friseur/">Für Friseure</a></li>
          <li><a href="/blog/">Blog</a></li>
        </ul>
      </div>
      <div>
        <p class="footer-heading">Rechtliches</p>
        <ul class="links">
          <li><a href="/datenschutz/">Datenschutz</a></li>
          <li><a href="/avv/">AVV</a></li>
          <li><a href="/sub-processors/">Subprozessoren</a></li>
          <li><a href="/impressum/">Impressum</a></li>
          <li><a href="/agb/">AGB</a></li>
        </ul>
      </div>
      <div>
        <p class="footer-heading">Kontakt</p>
        <ul class="links">
          <li><a href="/kontakt/">Anfragen</a></li>
          <li><a href="/#faq">FAQ</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <p>© 2026 Phonbot · Ein Produkt von <a href="https://mindrails.de" rel="noopener">Hassieb Kalla</a> (Einzelunternehmer) · Alle Rechte vorbehalten</p>
      <p>Hosting in Deutschland/EU · AVV verfügbar · <a href="mailto:info@phonbot.de">info@phonbot.de</a></p>
    </div>
  </div>
</footer>
<!--footer-html-end-->`;
