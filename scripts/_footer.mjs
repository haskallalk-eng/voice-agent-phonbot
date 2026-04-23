// Shared site-footer partial — matches apps/web/src/ui/landing/FooterSection.tsx 1:1.
// Emits the 5-column footer (brand + Produkt + Branchen + Rechtliches + Kontakt)
// with the copyright/DSGVO bottom row. Used on every static HTML page (5 branch
// pages + impressum + datenschutz + agb). Render order: markers first, then
// content, so `scripts/sync-legal-nav.mjs` can find-and-replace the block
// idempotently.

const FOX_LOGO_SVG_SM = [
  '<svg viewBox="0 8 100 92" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">',
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

export const FOOTER_STYLE = `/*--footer-css-begin--*/
.site-footer{position:relative;z-index:10;border-top:1px solid rgba(255,255,255,.05);padding:3rem 1.5rem 2rem;margin-top:4rem;background:rgba(10,10,15,.6)}
.site-footer .footer-container{max-width:1152px;margin:0 auto;padding:0;text-align:left}
.footer-grid{display:grid;grid-template-columns:1fr repeat(4,1fr);gap:2rem;margin-bottom:2.5rem}
@media(max-width:1024px){.footer-grid{grid-template-columns:1fr 1fr;gap:2rem 1.5rem}.footer-grid .col-brand{grid-column:1/-1}}
@media(max-width:480px){.footer-grid{grid-template-columns:1fr}}
.col-brand{display:flex;flex-direction:column;gap:.5rem;align-items:flex-start}
.col-brand .brand-row{display:flex;align-items:center;gap:6px;text-decoration:none}
.col-brand .brand-row .brand{font-size:18px;font-weight:800;letter-spacing:-.5px}
.col-brand .brand-row .brand .w{color:#fff}
.col-brand .brand-row .brand .o{background:linear-gradient(135deg,#F97316,#06B6D4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.col-brand p{font-size:.75rem;color:rgba(255,255,255,.35);line-height:1.6;margin:.35rem 0 0}
.site-footer h4{font-size:.7rem;font-weight:600;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.12em;margin-bottom:.75rem}
.site-footer ul.links{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.5rem}
.site-footer ul.links a{font-size:.875rem;color:rgba(255,255,255,.4);text-decoration:none;transition:color .2s}
.site-footer ul.links a:hover{color:rgba(255,255,255,.75)}
.footer-bottom{display:flex;flex-direction:column;gap:.75rem;align-items:center;padding-top:1.5rem;border-top:1px solid rgba(255,255,255,.05);text-align:center}
@media(min-width:640px){.footer-bottom{flex-direction:row;justify-content:space-between;text-align:left}}
.footer-bottom p{font-size:.75rem;color:rgba(255,255,255,.3);margin:0}
.footer-bottom a{color:rgba(255,255,255,.5);text-decoration:underline;text-decoration-color:rgba(255,255,255,.2);transition:all .2s}
.footer-bottom a:hover{color:rgba(255,255,255,.8);text-decoration-color:rgba(249,115,22,.6)}
/*--footer-css-end--*/`;

export const FOOTER_HTML = `<!--footer-html-begin-->
<footer class="site-footer">
  <div class="footer-container">
    <div class="footer-grid">
      <div class="col-brand">
        <a href="/" class="brand-row">${FOX_LOGO_SVG_SM}<span class="brand"><span class="w">Phon</span><span class="o">bot</span></span></a>
        <p>Chipy — dein KI-Telefonassistent.<br>Immer erreichbar.</p>
      </div>
      <div>
        <h4>Produkt</h4>
        <ul class="links">
          <li><a href="/#features">Features</a></li>
          <li><a href="/#demo">Demo</a></li>
          <li><a href="/#preise">Preise</a></li>
        </ul>
      </div>
      <div>
        <h4>Branchen</h4>
        <ul class="links">
          <li><a href="/friseur/">Friseur</a></li>
          <li><a href="/handwerker/">Handwerker</a></li>
          <li><a href="/reinigung/">Reinigung</a></li>
          <li><a href="/restaurant/">Restaurant</a></li>
          <li><a href="/autowerkstatt/">Autowerkstatt</a></li>
          <li><a href="/selbststaendig/">Selbstständig</a></li>
        </ul>
      </div>
      <div>
        <h4>Rechtliches</h4>
        <ul class="links">
          <li><a href="/datenschutz/">Datenschutz</a></li>
          <li><a href="/impressum/">Impressum</a></li>
          <li><a href="/agb/">AGB</a></li>
        </ul>
      </div>
      <div>
        <h4>Kontakt</h4>
        <ul class="links">
          <li><a href="/?page=contact">Anfragen</a></li>
          <li><a href="/#faq">FAQ</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <p>© 2026 Phonbot · Ein Produkt der <a href="https://mindrails.de" rel="noopener">Mindrails UG</a> · Alle Rechte vorbehalten</p>
      <p>DSGVO-konform · Server in Deutschland · <a href="mailto:info@phonbot.de">info@phonbot.de</a></p>
    </div>
  </div>
</footer>
<!--footer-html-end-->`;
