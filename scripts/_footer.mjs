// Shared site-footer partial — matches apps/web/src/ui/landing/FooterSection.tsx 1:1.
// Emits the 5-column footer (brand + Produkt + Branchen + Rechtliches + Kontakt)
// with the copyright/DSGVO bottom row. Used on every static HTML page (5 branch
// pages + impressum + datenschutz + agb). Render order: markers first, then
// content, so `scripts/sync-legal-nav.mjs` can find-and-replace the block
// idempotently.

const CRYSTAL_LOGO_HTML =
  '<img class="footer-mark" src="/brand/phonbot-crystal-icon-cropped.png" alt="" width="28" height="28" decoding="async" loading="lazy">';

export const FOOTER_STYLE = `/*--footer-css-begin--*/
.site-footer{position:relative;z-index:10;border-top:1px solid rgba(255,255,255,.05);padding:3rem 1.5rem 2rem;margin-top:4rem;background:rgba(10,10,15,.6)}
.site-footer .footer-container{max-width:1152px;margin:0 auto;padding:0;text-align:left}
.footer-grid{display:grid;grid-template-columns:1fr repeat(4,1fr);gap:2rem;margin-bottom:2.5rem}
@media(max-width:1024px){.footer-grid{grid-template-columns:1fr 1fr;gap:2rem 1.5rem}.footer-grid .col-brand{grid-column:1/-1}}
@media(max-width:480px){.footer-grid{grid-template-columns:1fr}}
.col-brand{display:flex;flex-direction:column;gap:.5rem;align-items:flex-start}
.col-brand .brand-row{display:flex;align-items:center;gap:6px;text-decoration:none}
.col-brand .footer-mark{width:28px;height:28px;object-fit:contain;filter:drop-shadow(0 0 10px rgba(249,115,22,.42)) drop-shadow(0 0 12px rgba(6,182,212,.22))}
.col-brand .brand-row .brand{font-size:18px;font-weight:800;letter-spacing:-.5px}
.col-brand .brand-row .brand .w{color:#fff}
.col-brand .brand-row .brand .o{background:linear-gradient(135deg,#ff5b0a,#20d9ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.col-brand p{font-size:.75rem;color:rgba(255,255,255,.62);line-height:1.6;margin:.35rem 0 0}
.site-footer .footer-heading{font-size:.7rem;font-weight:600;color:rgba(255,255,255,.68);text-transform:uppercase;letter-spacing:.12em;margin:0 0 .75rem}
.site-footer ul.links{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.5rem}
.site-footer ul.links a{font-size:.875rem;color:rgba(255,255,255,.62);text-decoration:none;transition:color .2s}
.site-footer ul.links a:hover{color:rgba(255,255,255,.9)}
.footer-bottom{display:flex;flex-direction:column;gap:.75rem;align-items:center;padding-top:1.5rem;border-top:1px solid rgba(255,255,255,.05);text-align:center}
@media(min-width:640px){.footer-bottom{flex-direction:row;justify-content:space-between;text-align:left}}
.footer-bottom p{font-size:.75rem;color:rgba(255,255,255,.58);margin:0}
.footer-bottom a{color:rgba(255,255,255,.76);text-decoration:underline;text-decoration-color:rgba(255,255,255,.28);transition:all .2s}
.footer-bottom a:hover{color:rgba(255,255,255,.8);text-decoration-color:rgba(249,115,22,.6)}
/*--footer-css-end--*/`;

export const FOOTER_HTML = `<!--footer-html-begin-->
<footer class="site-footer">
  <div class="footer-container">
    <div class="footer-grid">
      <div class="col-brand">
        <a href="/" class="brand-row">${CRYSTAL_LOGO_HTML}<span class="brand"><span class="w">Phon</span><span class="o">bot</span></span></a>
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
          <li><a href="/sub-processors/">Sub-Processoren</a></li>
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
      <p>DSGVO-fokussiert · AVV verfügbar · <a href="mailto:info@phonbot.de">info@phonbot.de</a></p>
    </div>
  </div>
</footer>
<!--footer-html-end-->`;
