// Lightweight SEO/AI-discovery audit for the built web artifact.
// Run after `pnpm --filter @vas/web build`.
import fs from 'node:fs';
import path from 'node:path';
import { SITE, TODAY, CORE_INDUSTRY_PAGES, SEO_NICHE_PAGES, SUPPORT_PAGES, ALL_SEO_PAGE_SLUGS } from './seo-pages.mjs';
import { BLOG_INDEX, BLOG_POSTS, blogUrl } from './blog-posts.mjs';

const DIST = path.resolve('apps/web/dist');
const BRANCHES = CORE_INDUSTRY_PAGES.map((page) => page.slug);
const NICHES = SEO_NICHE_PAGES.map((page) => page.slug);
const SUPPORT = SUPPORT_PAGES.map((page) => page.slug);
const LEGAL = ['impressum', 'datenschutz', 'agb', 'avv', 'sub-processors'];
const INDEXABLE = [...SUPPORT, ...BRANCHES, ...NICHES, ...LEGAL];

const failures = [];
const warnings = [];
const PRODUCT_TRUTH = {
  legalName: 'Hassieb Kalla (Einzelunternehmer)',
  nummerPlanPattern: /70\s+(Minuten|Min)\s*(pro\s*Monat|\/\s*Monat)/i,
  forbiddenAiDocPatterns: [
    { pattern: /Stand:\s*April\s+2026/i, label: 'stale April 2026 pricing date' },
    { pattern: /ab\s+79\s*€/i, label: 'stale 79 Euro entry price' },
    { pattern: /ab\s+79\s*EUR/i, label: 'stale 79 EUR entry price' },
    { pattern: /\|\s*Nummer\s*\|\s*8,99\s*€\s*\|\s*70\s*(\||\s)/i, label: 'stale Nummer 70-minute table row' },
    { pattern: /100\s+(Gesamt-Freiminuten|einmalig|Minuten-Gesamtguthaben|Freiminuten)/i, label: 'stale Nummer 100-minute one-time copy' },
    { pattern: /haftungsbeschr/i, label: 'stale legal entity form' },
    { pattern: /Jahresplan[^.\n]{0,100}\b20\s*%/i, label: 'overstated yearly discount copy' },
  ],
};

function fail(msg) {
  failures.push(msg);
}

function warn(msg) {
  warnings.push(msg);
}

function germanDate(isoDate) {
  return new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function read(rel) {
  const file = path.join(DIST, rel);
  if (!fs.existsSync(file)) {
    fail(`Missing file: ${rel}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function text(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function meta(html, name) {
  const re = new RegExp(`<meta\\s+name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i');
  return html.match(re)?.[1] ?? '';
}

function canonical(html) {
  return html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1] ?? '';
}

function title(html) {
  return html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? '';
}

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1].trim())
    .map((raw) => {
      try {
        return JSON.parse(raw);
      } catch (err) {
        fail(`Invalid JSON-LD: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`);
        return null;
      }
    })
    .filter(Boolean);
}

function graphItems(blocks) {
  return blocks.flatMap((b) => Array.isArray(b['@graph']) ? b['@graph'] : [b]);
}

function checkPage(rel, url, opts = {}) {
  const html = read(rel);
  if (!html) return;
  const pageTitle = title(html);
  const description = meta(html, 'description');
  const robots = meta(html, 'robots');
  const pageCanonical = canonical(html);
  const bodyText = text(html);
  const graph = graphItems(jsonLdBlocks(html));

  if (pageTitle.length < 20 || pageTitle.length > 80) warn(`${url}: title length ${pageTitle.length}`);
  if (description.length < 90 || description.length > 180) warn(`${url}: description length ${description.length}`);
  if (pageCanonical !== url) fail(`${url}: canonical mismatch (${pageCanonical || 'missing'})`);
  if (!robots.includes('index') || !robots.includes('follow')) fail(`${url}: robots index/follow missing`);
  if (bodyText.length < (opts.minText ?? 900)) fail(`${url}: too little crawlable body text (${bodyText.length} chars)`);
  if (!graph.length) fail(`${url}: JSON-LD missing`);
  if (!/<main\b/i.test(html)) fail(`${url}: main landmark missing`);
  if (!html.includes('/llms.txt') || !html.includes('/llms-full.txt')) fail(`${url}: LLM alternate links missing`);
  if (/fonts\.googleapis|fonts\.gstatic/.test(html)) fail(`${url}: external Google Fonts detected`);
  if (/Für Phonbot wird JavaScript benötigt|JavaScript benötigt/i.test(html)) fail(`${url}: JS-required snippet text still present`);
}

function checkRoot() {
  const html = read('index.html');
  checkPage('index.html', `${SITE}/`, { minText: 2200 });
  if (!/<div id=["']root["']>\s*<article class=["']seo-static["']>/i.test(html)) {
    fail('Root: static SEO article inside #root missing');
  }
  for (const slug of BRANCHES) {
    if (!html.includes(`${SITE}/${slug}/`)) fail(`Root: missing internal branch link ${slug}`);
  }
  const graph = graphItems(jsonLdBlocks(html));
  for (const type of ['Organization', 'SoftwareApplication', 'FAQPage', 'WebSite', 'WebPage']) {
    if (!graph.some((item) => item['@type'] === type)) fail(`Root: JSON-LD ${type} missing`);
  }
}

function checkBranches() {
  for (const slug of BRANCHES) {
    const rel = `${slug}/index.html`;
    const url = `${SITE}/${slug}/`;
    checkPage(rel, url, { minText: 2600 });
    const html = read(rel);
    const graph = graphItems(jsonLdBlocks(html));
    if (!graph.some((item) => item['@type'] === 'WebPage')) fail(`${url}: WebPage JSON-LD missing`);
    if (!graph.some((item) => item['@type'] === 'FAQPage')) fail(`${url}: FAQPage JSON-LD missing`);
    const offer = graph.find((item) => item['@type'] === 'Service')?.offers;
    const expected = '89';
    if (String(offer?.price) !== expected) fail(`${url}: offer price ${offer?.price ?? 'missing'} != ${expected}`);
  }
}

function checkNiches() {
  for (const slug of NICHES) {
    const rel = `${slug}/index.html`;
    const url = `${SITE}/${slug}/`;
    checkPage(rel, url, { minText: 2200 });
    const html = read(rel);
    const graph = graphItems(jsonLdBlocks(html));
    for (const type of ['WebPage', 'Service', 'FAQPage', 'BreadcrumbList']) {
      if (!graph.some((item) => item['@type'] === type)) fail(`${url}: JSON-LD ${type} missing`);
    }
    const offer = graph.find((item) => item['@type'] === 'Service')?.offers;
    if (String(offer?.price) !== '89') fail(`${url}: offer price ${offer?.price ?? 'missing'} != 89`);
  }
}

function checkSupportPages() {
  for (const slug of SUPPORT) {
    const rel = `${slug}/index.html`;
    const url = `${SITE}/${slug}/`;
    checkPage(rel, url, { minText: slug === 'kontakt' ? 900 : 1800 });
    const html = read(rel);
    const graph = graphItems(jsonLdBlocks(html));
    if (slug === 'branchen' && !graph.some((item) => item['@type'] === 'CollectionPage')) {
      fail(`${url}: CollectionPage JSON-LD missing`);
    }
    if (slug === 'kontakt' && !graph.some((item) => item['@type'] === 'ContactPage')) {
      fail(`${url}: ContactPage JSON-LD missing`);
    }
  }
}

function checkBlogPages() {
  const indexRel = `${BLOG_INDEX.slug}/index.html`;
  const indexUrl = `${SITE}/${BLOG_INDEX.slug}/`;
  checkPage(indexRel, indexUrl, { minText: 900 });
  const indexGraph = graphItems(jsonLdBlocks(read(indexRel)));
  if (!indexGraph.some((item) => item['@type'] === 'Blog')) fail(`${indexUrl}: Blog JSON-LD missing`);
  if (!indexGraph.some((item) => item['@type'] === 'ItemList')) fail(`${indexUrl}: ItemList JSON-LD missing`);

  const slugs = new Set();
  for (const post of BLOG_POSTS) {
    if (slugs.has(post.slug)) fail(`Blog: duplicate slug ${post.slug}`);
    slugs.add(post.slug);
    if (post.reviewedBy !== 'Phonbot SEO/Superhirn') fail(`Blog ${post.slug}: reviewedBy gate missing`);
    if (!post.intent || post.intent.length < 40) fail(`Blog ${post.slug}: intent too weak`);
    if (!post.primaryKeyword || post.secondaryKeywords.length < 2) fail(`Blog ${post.slug}: keyword cluster incomplete`);

    const rel = `${BLOG_INDEX.slug}/${post.slug}/index.html`;
    const url = blogUrl(post);
    checkPage(rel, url, { minText: 2600 });
    const html = read(rel);
    const graph = graphItems(jsonLdBlocks(html));
    for (const type of ['BlogPosting', 'WebPage', 'FAQPage', 'BreadcrumbList']) {
      if (!graph.some((item) => item['@type'] === type)) fail(`${url}: JSON-LD ${type} missing`);
    }
    if (!html.includes('/?page=register') || !html.includes('/blog/')) fail(`${url}: blog CTA/internal links missing`);
  }
}

function checkLegal() {
  for (const slug of LEGAL) {
    const rel = `${slug}/index.html`;
    const url = `${SITE}/${slug}/`;
    checkPage(rel, url, { minText: 700 });
    const graph = graphItems(jsonLdBlocks(read(rel)));
    if (!graph.some((item) => item['@type'] === 'WebPage')) fail(`${url}: WebPage JSON-LD missing`);
    if (!graph.some((item) => item['@type'] === 'BreadcrumbList')) fail(`${url}: BreadcrumbList JSON-LD missing`);
  }
}

function listIndexFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'assets' || entry.name === '.well-known') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listIndexFiles(full));
    else if (entry.name === 'index.html') out.push(full);
  }
  return out;
}

function checkSitemapAndRobots() {
  const sitemap = read('sitemap.xml');
  const robots = read('robots.txt');
  const llms = read('llms.txt');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const expected = [`${SITE}/`, ...INDEXABLE.map((s) => `${SITE}/${s}/`)];

  for (const url of expected) {
    if (!locs.includes(url)) fail(`Sitemap missing ${url}`);
    if (!llms.includes(url) && !url.endsWith('/impressum/') && !url.endsWith('/datenschutz/') && !url.endsWith('/agb/') && !url.endsWith('/avv/') && !url.endsWith('/sub-processors/')) {
      fail(`llms.txt missing ${url}`);
    }
  }
  if (!/Sitemap:\s*https:\/\/phonbot\.de\/sitemap\.xml/i.test(robots)) fail('robots.txt sitemap line missing');
  if (!/Disallow:\s*\/calendar/i.test(robots)) fail('robots.txt should disallow /calendar backend routes');
  for (const bot of ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'PerplexityBot']) {
    if (!robots.includes(`User-agent: ${bot}`)) fail(`robots.txt missing AI search bot ${bot}`);
  }
  for (const bot of ['GPTBot', 'ClaudeBot', 'CCBot', 'anthropic-ai']) {
    const block = new RegExp(`User-agent:\\s*${bot}[\\s\\S]{0,80}Disallow:\\s*/`, 'i');
    if (!block.test(robots)) fail(`robots.txt should block training bot ${bot}`);
  }
}

function checkIndexNow() {
  const key = fs.existsSync('.indexnow-key') ? fs.readFileSync('.indexnow-key', 'utf8').trim() : '';
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) fail('IndexNow key missing or invalid');
  const keyFile = read(`${key}.txt`).trim();
  if (keyFile !== key) fail(`IndexNow key file ${key}.txt mismatch`);
}

function checkProductTruthDrift() {
  const root = read('index.html');
  const llms = read('llms.txt');
  const llmsFull = read('llms-full.txt');
  const ai = read('ai.txt');
  const readme = fs.existsSync('README.md') ? fs.readFileSync('README.md', 'utf8') : '';

  const rootGraph = graphItems(jsonLdBlocks(root));
  const organization = rootGraph.find((item) => item['@type'] === 'Organization');
  if (organization?.legalName !== PRODUCT_TRUTH.legalName) {
    fail(`Root: legalName drift (${organization?.legalName ?? 'missing'})`);
  }
  if ('parentOrganization' in organization) {
    fail('Root: Phonbot Organization should not declare a parentOrganization while legal entity is an individual proprietor');
  }
  if (organization?.privacyPolicy !== `${SITE}/datenschutz/`) {
    fail(`Root: privacyPolicy should use canonical slash URL (${organization?.privacyPolicy ?? 'missing'})`);
  }
  if (organization?.termsOfService !== `${SITE}/agb/`) {
    fail(`Root: termsOfService should use canonical slash URL (${organization?.termsOfService ?? 'missing'})`);
  }

  const software = rootGraph.find((item) => item['@type'] === 'SoftwareApplication');
  const offers = Array.isArray(software?.offers) ? software.offers : [];
  const nummerOffer = offers.find((offer) => offer?.name === 'Nummer');
  if (!PRODUCT_TRUTH.nummerPlanPattern.test(String(nummerOffer?.description ?? ''))) {
    fail(`Root: Nummer offer description drift (${nummerOffer?.description ?? 'missing'})`);
  }

  const truthCheckedDocs = {
    'README.md': readme,
    'index.html': root,
    'llms.txt': llms,
    'llms-full.txt': llmsFull,
    'ai.txt': ai,
  };

  for (const [rel, content] of Object.entries(truthCheckedDocs)) {
    for (const { pattern, label } of PRODUCT_TRUTH.forbiddenAiDocPatterns) {
      if (label.includes('70-minute')) continue;
      if (pattern.test(content)) fail(`${rel}: ${label}`);
    }
  }

  for (const [rel, content] of Object.entries({ 'llms.txt': llms, 'llms-full.txt': llmsFull, 'ai.txt': ai })) {
    if (!content.includes(PRODUCT_TRUTH.legalName)) fail(`${rel}: legal entity truth missing`);
  }

  const latestPublicContentDate = BLOG_POSTS.reduce(
    (max, post) => post.dateModified > max ? post.dateModified : max,
    TODAY,
  );
  const expectedDate = germanDate(latestPublicContentDate);
  if (!llms.includes(expectedDate) || !llmsFull.includes(expectedDate)) {
    fail(`LLM docs update date drift; expected ${expectedDate} for current SEO release ${latestPublicContentDate}`);
  }

  for (const [rel, content] of Object.entries({ 'llms.txt': llms, 'llms-full.txt': llmsFull })) {
    if (!PRODUCT_TRUTH.nummerPlanPattern.test(content)) fail(`${rel}: Nummer monthly 70-minute truth missing`);
    for (const required of ['Starter', '300', 'Professional', '900', 'Agency', '2.000']) {
      if (!content.includes(required)) fail(`${rel}: pricing truth missing ${required}`);
    }
  }
}

function checkSitemapDrift() {
  const sitemap = read('sitemap.xml');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const indexFiles = listIndexFiles(DIST);
  const urlsFromFiles = indexFiles
    .map((file) => {
      const rel = path.relative(DIST, file).replace(/\\/g, '/');
      return rel === 'index.html' ? `${SITE}/` : `${SITE}/${rel.replace(/\/index\.html$/, '/')}`;
    })
    .filter((url) => !url.includes('/admin/') && !url.includes('/dashboard/'));

  for (const url of urlsFromFiles) {
    if (!locs.includes(url)) fail(`Sitemap missing public index file ${url}`);
  }
  for (const url of locs) {
    const rel = url === `${SITE}/`
      ? 'index.html'
      : `${url.replace(`${SITE}/`, '').replace(/\/$/, '')}/index.html`;
    if (!fs.existsSync(path.join(DIST, rel))) fail(`Sitemap URL has no static file ${url}`);
  }
}

function checkCanonicalRedirectConfig() {
  const caddy = fs.existsSync('Caddyfile') ? fs.readFileSync('Caddyfile', 'utf8') : '';
  const nginx = fs.existsSync('apps/web/nginx.conf') ? fs.readFileSync('apps/web/nginx.conf', 'utf8') : '';
  if (!/redir\s+\/index\.html\s+\/\s+301/.test(caddy)) fail('Caddyfile: /index.html canonical redirect missing');
  if (!/path\s+\/branchen\s+\/kontakt\s+\/blog/.test(caddy)) fail('Caddyfile: /blog canonical slash matcher missing');
  if (!/path_regexp\s+\^\/blog\/\[\^\/\]\+\$/.test(caddy)) fail('Caddyfile: blog post trailing-slash redirect missing');
  if (!/redir\s+\/friseur\/index\.html\s+\/friseur\/\s+301/.test(caddy)) fail('Caddyfile: branch /index.html canonical redirects missing');
  if (!/redir\s+\/blog\/index\.html\s+\/blog\/\s+301/.test(caddy)) fail('Caddyfile: /blog/index.html canonical redirect missing');
  if (!/path[\s\S]*\/calendar\s+\/calendar\/\*/.test(caddy)) fail('Caddyfile: /calendar noindex matcher must cover exact and nested paths');
  if (!/return\s+301\s+\/\$1/.test(nginx)) fail('nginx.conf: nested /index.html redirect missing');
  if (!/absolute_redirect\s+off;/.test(nginx)) fail('nginx.conf: nginx must not emit scheme-downgraded absolute redirects behind Caddy');
  if (/try_files\s+\$uri\s+\$uri\/\s+=404/.test(nginx)) fail('nginx.conf: directory try_files can emit http:// redirects behind Caddy');
  if (!/try_files\s+\$uri\/index\.html\s+\$uri\s+=404/.test(nginx)) fail('nginx.conf: SEO directory routes should serve index.html without nginx redirects');
  if (!/\(branchen\|kontakt\|blog\|friseur/.test(nginx)) fail('nginx.conf: /blog static route missing');
  if (/Cache-Control\s+"no-cache,\s*no-store,\s*must-revalidate"[\s\S]{0,160}try_files\s+\$uri\s+\$uri\/\s+=404/.test(nginx)) {
    fail('nginx.conf: public SEO routes still use no-store');
  }
  if (!/location\s+=\s+\/nav\.js[\s\S]*max-age=0/.test(nginx)) fail('nginx.conf: /nav.js must not be immutable cached');
}

function checkServerConfig() {
  const caddy = fs.readFileSync(path.resolve('Caddyfile'), 'utf8');
  const nginx = fs.readFileSync(path.resolve('apps/web/nginx.conf'), 'utf8');

  if (!/www\.\{\$DOMAIN:phonbot\.de\}/.test(caddy) || !/redir https:\/\/\{\$DOMAIN:phonbot\.de\}\{uri\} 301/.test(caddy)) {
    fail('Caddyfile: www apex redirect missing');
  }
  if (!/@private_query/.test(caddy) || !/query page=login page=register page=contact/.test(caddy)) {
    fail('Caddyfile: private query noindex matcher missing');
  }
  for (const slug of [...ALL_SEO_PAGE_SLUGS, ...LEGAL]) {
    if (!caddy.includes(`/${slug}`)) fail(`Caddyfile: missing canonical slash redirect for /${slug}`);
    if (!nginx.includes(slug)) fail(`nginx.conf: missing static route for /${slug}/`);
  }
  if (/try_files\s+\$uri\s+\$uri\/\s+\/index\.html/.test(nginx)) {
    fail('nginx.conf: catch-all SPA fallback still creates indexable soft-404s');
  }
  if (!/try_files\s+\$uri\/index\.html\s+\$uri\s+=404/.test(nginx)) {
    fail('nginx.conf: unknown routes should resolve to 404');
  }
}

if (!fs.existsSync(DIST)) {
  fail('apps/web/dist missing. Run `pnpm --filter @vas/web build` first.');
} else {
  checkRoot();
  checkSupportPages();
  checkBlogPages();
  checkBranches();
  checkNiches();
checkLegal();
checkSitemapAndRobots();
checkIndexNow();
checkProductTruthDrift();
checkSitemapDrift();
checkCanonicalRedirectConfig();
  checkServerConfig();
}

for (const msg of warnings) console.warn(`WARN ${msg}`);
for (const msg of failures) console.error(`FAIL ${msg}`);

if (failures.length) {
  console.error(`SEO audit failed: ${failures.length} failure(s), ${warnings.length} warning(s).`);
  process.exit(1);
}

console.log(`SEO audit passed: ${warnings.length} warning(s), 0 failures.`);
