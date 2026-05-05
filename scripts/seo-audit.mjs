// Lightweight SEO/AI-discovery audit for the built web artifact.
// Run after `pnpm --filter @vas/web build`.
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('apps/web/dist');
const SITE = 'https://phonbot.de';
const BRANCHES = ['friseur', 'handwerker', 'reinigung', 'restaurant', 'autowerkstatt', 'selbststaendig'];
const LEGAL = ['impressum', 'datenschutz', 'agb', 'avv', 'sub-processors'];

const failures = [];
const warnings = [];

function fail(msg) {
  failures.push(msg);
}

function warn(msg) {
  warnings.push(msg);
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
    const expected = slug === 'selbststaendig' ? '79' : '8.99';
    if (String(offer?.price) !== expected) fail(`${url}: offer price ${offer?.price ?? 'missing'} != ${expected}`);
  }
}

function checkLegal() {
  for (const slug of LEGAL) {
    checkPage(`${slug}/index.html`, `${SITE}/${slug}/`, { minText: 700 });
  }
}

function checkSitemapAndRobots() {
  const sitemap = read('sitemap.xml');
  const robots = read('robots.txt');
  const llms = read('llms.txt');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const expected = [`${SITE}/`, ...BRANCHES.map((s) => `${SITE}/${s}/`), ...LEGAL.map((s) => `${SITE}/${s}/`)];

  for (const url of expected) {
    if (!locs.includes(url)) fail(`Sitemap missing ${url}`);
    if (!llms.includes(url) && !url.endsWith('/impressum/') && !url.endsWith('/datenschutz/') && !url.endsWith('/agb/') && !url.endsWith('/avv/') && !url.endsWith('/sub-processors/')) {
      fail(`llms.txt missing ${url}`);
    }
  }
  if (!/Sitemap:\s*https:\/\/phonbot\.de\/sitemap\.xml/i.test(robots)) fail('robots.txt sitemap line missing');
  for (const bot of ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'PerplexityBot']) {
    if (!robots.includes(`User-agent: ${bot}`)) fail(`robots.txt missing AI search bot ${bot}`);
  }
  for (const bot of ['GPTBot', 'ClaudeBot', 'CCBot', 'anthropic-ai']) {
    const block = new RegExp(`User-agent:\\s*${bot}[\\s\\S]{0,80}Disallow:\\s*/`, 'i');
    if (!block.test(robots)) fail(`robots.txt should block training bot ${bot}`);
  }
}

if (!fs.existsSync(DIST)) {
  fail('apps/web/dist missing. Run `pnpm --filter @vas/web build` first.');
} else {
  checkRoot();
  checkBranches();
  checkLegal();
  checkSitemapAndRobots();
}

for (const msg of warnings) console.warn(`WARN ${msg}`);
for (const msg of failures) console.error(`FAIL ${msg}`);

if (failures.length) {
  console.error(`SEO audit failed: ${failures.length} failure(s), ${warnings.length} warning(s).`);
  process.exit(1);
}

console.log(`SEO audit passed: ${warnings.length} warning(s), 0 failures.`);
