// Sync the unified <nav> onto every static HTML page that isn't generated
// by gen-landing-pages.mjs — impressum / datenschutz / agb.
//
// Finds the block bounded by /*--nav-css-begin--*/ .. /*--nav-css-end--*/
// in the page's <style> and replaces it with the shared NAV_STYLE from
// _nav.mjs. Same for <!--nav-html-begin--> .. <!--nav-html-end--> in body.
//
// Run: node scripts/sync-legal-nav.mjs
import fs from 'node:fs';
import path from 'node:path';
import { NAV_STYLE, NAV_HTML } from './_nav.mjs';

const LEGAL_PAGES = [
  'apps/web/public/impressum/index.html',
  'apps/web/public/datenschutz/index.html',
  'apps/web/public/agb/index.html',
];

const CSS_RE = /\/\*--nav-css-begin--\*\/[\s\S]*?\/\*--nav-css-end--\*\//;
const HTML_RE = /<!--nav-html-begin-->[\s\S]*?<!--nav-html-end-->/;

// First-run seeding patterns (only used when markers aren't present yet).
//
// CSS: find the existing ph-header block up through the `ph-login` media-query
// that always terminates the old block, so we can wrap it in fresh markers.
const CSS_SEED_RE = /\.ph-header\{[\s\S]*?@media\(min-width:768px\)\{\.ph-login\{display:block\}\}/;
// HTML: the first `<header class="ph-header">` up through its matching
// `</header>`. All legal pages have at most one such element.
const HTML_SEED_RE = /<header class="ph-header">[\s\S]*?<\/header>/;

function seedCss(src) {
  return src.replace(CSS_SEED_RE, `${NAV_STYLE}`);
}
function seedHtml(src) {
  let replaced = src.replace(HTML_SEED_RE, `${NAV_HTML}`);
  // Also ensure nav.js is loaded — add once before </body> if missing.
  if (!replaced.includes('/nav.js')) {
    replaced = replaced.replace('</body>', '<script src="/nav.js" defer></script>\n</body>');
  }
  return replaced;
}

let failures = 0;

for (const rel of LEGAL_PAGES) {
  const file = path.resolve(rel);
  if (!fs.existsSync(file)) {
    console.error(`✗ missing: ${rel}`);
    failures++;
    continue;
  }
  let src = fs.readFileSync(file, 'utf8');
  const original = src;

  // CSS: replace marked block if present, else seed-in markers + block.
  if (CSS_RE.test(src)) {
    src = src.replace(CSS_RE, NAV_STYLE);
  } else if (CSS_SEED_RE.test(src)) {
    src = seedCss(src);
    console.log(`  ↪ seeded CSS markers in ${rel}`);
  } else {
    console.warn(`! couldn't locate CSS block in ${rel}`);
    failures++;
    continue;
  }

  // HTML: same — replace marked block or seed in markers.
  if (HTML_RE.test(src)) {
    src = src.replace(HTML_RE, NAV_HTML);
  } else if (HTML_SEED_RE.test(src)) {
    src = seedHtml(src);
    console.log(`  ↪ seeded HTML markers in ${rel}`);
  } else {
    console.warn(`! couldn't locate <header class="ph-header"> in ${rel}`);
    failures++;
    continue;
  }

  // Make sure nav.js is pulled in (it powers hamburger + dropdown).
  if (!src.includes('/nav.js')) {
    src = src.replace('</body>', '<script src="/nav.js" defer></script>\n</body>');
  }

  if (src !== original) {
    fs.writeFileSync(file, src);
    console.log(`✓ ${rel}`);
  } else {
    console.log(`· ${rel} (no change)`);
  }
}

if (failures > 0) {
  process.exit(1);
}
