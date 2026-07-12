// Generates deterministic, reviewable blog pages from structured briefs.
// This is "automated" in the build sense: briefs in blog-posts.mjs become
// static, crawlable HTML with schema, sitemap integration and audit gates.
import fs from 'node:fs';
import path from 'node:path';
import { NAV_STYLE, NAV_HTML } from './_nav.mjs';
import { FOOTER_STYLE, FOOTER_HTML } from './_footer.mjs';
import { SITE, TODAY, ALL_INDUSTRY_PAGES, SUPPORT_PAGES } from './seo-pages.mjs';
import { BLOG_INDEX, BLOG_POSTS, blogUrl } from './blog-posts.mjs';

const OUT_DIR = path.resolve('apps/web/public/blog');
const BLOG_LASTMOD = BLOG_POSTS.reduce(
  (max, post) => post.dateModified > max ? post.dateModified : max,
  TODAY,
);

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function json(value) {
  return JSON.stringify(value, null, 2).replace(/<\//g, '<\\/');
}

// Anzeige-Titel ohne SEO-Suffix (der bleibt im <title>/Schema erhalten).
function displayTitle(title) {
  return String(title).replace(/\s*\|\s*Phonbot$/, '');
}

// ISO-Datum → redaktionelles deutsches Datum ("11. Juli 2026").
const DE_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
function deDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return `${d}. ${DE_MONTHS[m - 1]} ${y}`;
}

const STYLE = `${NAV_STYLE}
:root{color-scheme:dark;--bg:#090A0F;--panel:#11131B;--ink:#fff;--muted:rgba(255,255,255,.68);--soft:rgba(255,255,255,.1);--orange:#ff5b0a;--cyan:#20d9ff}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.7;overflow-x:clip}
a{color:inherit}.page{min-height:100vh}.wrap{width:min(1040px,calc(100% - 40px));margin:0 auto}.article-wrap{width:min(820px,calc(100% - 40px));margin:0 auto}.hero{padding:70px 0 42px}.crumbs{display:flex;gap:8px;flex-wrap:wrap;color:rgba(255,255,255,.48);font-size:.9rem;margin-bottom:28px}.crumbs a{color:rgba(255,255,255,.72);text-decoration:none}.eyebrow{font-family:'Space Grotesk','Inter',ui-sans-serif,system-ui,sans-serif;color:rgba(148,226,255,.72);text-transform:uppercase;letter-spacing:.32em;font-size:.75rem;font-weight:600}.hero h1{font-size:clamp(2.15rem,4.8vw,4.25rem);line-height:1.06;letter-spacing:-.02em;max-width:920px;margin:14px 0 20px}.lead{font-size:1.13rem;color:var(--muted);max-width:790px}.meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px;color:rgba(255,255,255,.54);font-size:.92rem}.meta span{border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:6px 10px;background:rgba(255,255,255,.04)}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border-radius:999px;padding:0 18px;text-decoration:none;font-weight:700;border:1px solid rgba(255,255,255,.18);text-shadow:0 1px 2px rgba(0,0,0,.3);box-shadow:inset 0 1px 0 rgba(255,255,255,.42);background:linear-gradient(112deg,rgba(255,91,10,.88) 0%,rgba(255,148,61,.78) 32%,rgba(103,232,249,.58) 56%,rgba(32,217,255,.78) 74%,rgba(0,141,230,.8) 100%),rgba(10,12,20,.65);color:#fff}.btn.secondary{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14)}
section{padding:42px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.card{border:1px solid var(--soft);background:rgba(255,255,255,.045);border-radius:8px;padding:18px;text-decoration:none;display:block}.card h2,.card h3{font-size:1.08rem;line-height:1.25;margin:0 0 8px}.card p{color:var(--muted);margin:0}.article{padding:24px 0 44px}.article h2{font-size:1.65rem;line-height:1.2;margin:34px 0 12px}.article p{color:rgba(255,255,255,.76);margin:0 0 16px}.article ul{margin:10px 0 18px;padding-left:22px;color:rgba(255,255,255,.76)}.article li{margin:8px 0}.summary{border-left:3px solid var(--orange);background:rgba(255,91,10,.08);padding:16px 18px;color:rgba(255,255,255,.78);margin:18px 0 28px}.keywords{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.chip{border:1px solid rgba(32,217,255,.28);background:rgba(32,217,255,.08);color:#9DECF8;border-radius:999px;padding:7px 11px;font-size:.88rem}.checklist{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.035);border-radius:8px;padding:18px;margin:28px 0}.checklist h2{margin-top:0}.faq{display:grid;gap:10px}.faq details{border:1px solid var(--soft);background:rgba(255,255,255,.035);border-radius:8px;padding:0}.faq summary{cursor:pointer;padding:16px 18px;font-weight:800}.faq p{color:var(--muted);margin:0;padding:0 18px 16px}.link-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.link-list a{border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:14px;text-decoration:none;background:rgba(255,255,255,.035)}.link-list span{display:block;color:rgba(255,255,255,.58);font-size:.9rem;margin-top:4px}.site-footer{margin-top:0}
@media(max-width:640px){.wrap,.article-wrap{width:min(100% - 28px,1040px)}.hero{padding-top:48px}.hero h1{font-size:2.25rem}.grid{grid-template-columns:1fr}}
${FOOTER_STYLE}`;

function pageHead({ title, description, url, jsonLd }) {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0A0A0F" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="author" content="Phonbot" />
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
<link rel="canonical" href="${url}" />
<link rel="alternate" hreflang="de-DE" href="${url}" />
<link rel="alternate" hreflang="de" href="${url}" />
<link rel="alternate" hreflang="x-default" href="${url}" />
<link rel="alternate" type="text/markdown" title="LLM-friendly description (concise)" href="/llms.txt" />
<link rel="alternate" type="text/markdown" title="LLM-friendly full content" href="/llms-full.txt" />
<link rel="alternate" type="text/plain" title="AI usage policy" href="/ai.txt" />
<meta property="og:type" content="article" />
<meta property="og:locale" content="de_DE" />
<meta property="og:site_name" content="Phonbot" />
<meta property="og:url" content="${url}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${SITE}/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${SITE}/og-image.png" />
<link rel="icon" type="image/svg+xml" href="/icon.svg" />
<script type="application/ld+json">
${json(jsonLd)}
</script>
<style>${STYLE}</style>
</head>`;
}

// Nur aktive Seiten verlinken — alle anderen Branchen sind stillgelegt (301 → /friseur/).
const ACTIVE_RELATED = new Set(['friseur', 'kontakt']);
function relatedPage(slug) {
  if (!ACTIVE_RELATED.has(slug)) return null;
  return [...ALL_INDUSTRY_PAGES, ...SUPPORT_PAGES].find((page) => page.slug === slug) ?? null;
}

function indexJsonLd() {
  const url = `${SITE}/blog/`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Blog',
        '@id': `${url}#blog`,
        url,
        name: BLOG_INDEX.title,
        description: BLOG_INDEX.description,
        inLanguage: 'de-DE',
        dateModified: BLOG_LASTMOD,
        publisher: { '@type': 'Organization', name: 'Phonbot', url: SITE },
        blogPost: BLOG_POSTS.map((post) => ({ '@id': `${blogUrl(post)}#article` })),
      },
      {
        '@type': 'ItemList',
        '@id': `${url}#itemlist`,
        itemListElement: BLOG_POSTS.map((post, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: post.title,
          url: blogUrl(post),
        })),
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Phonbot', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: url },
        ],
      },
    ],
  };
}

function postJsonLd(post) {
  const url = blogUrl(post);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        '@id': `${url}#article`,
        url,
        mainEntityOfPage: { '@id': `${url}#webpage` },
        headline: post.title,
        description: post.description,
        articleSection: post.category,
        keywords: [post.primaryKeyword, ...post.secondaryKeywords],
        inLanguage: 'de-DE',
        datePublished: post.datePublished,
        dateModified: post.dateModified,
        author: { '@type': 'Organization', name: 'Phonbot', url: SITE },
        publisher: { '@type': 'Organization', name: 'Phonbot', url: SITE },
        isAccessibleForFree: true,
        about: post.primaryKeyword,
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: post.title,
        description: post.description,
        inLanguage: 'de-DE',
        isPartOf: { '@id': `${SITE}/blog/#blog` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        mainEntity: post.faq.map(([q, a]) => ({
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: a },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Phonbot', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog/` },
          { '@type': 'ListItem', position: 3, name: post.title, item: url },
        ],
      },
    ],
  };
}

function renderIndex() {
  const url = `${SITE}/blog/`;
  const cards = BLOG_POSTS
    .map((post) => `<a class="card" href="/blog/${post.slug}/"><h2>${esc(displayTitle(post.title))}</h2><p>${esc(post.description)}</p><div class="meta"><span>${esc(post.category)}</span><span>${post.readingMinutes} Min</span></div></a>`)
    .join('');
  return `${pageHead({ ...BLOG_INDEX, url, jsonLd: indexJsonLd() })}
<body>
${NAV_HTML}
<main class="page">
  <header class="hero">
    <div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Phonbot</a><span>/</span><span>Blog</span></nav>
      <p class="eyebrow">Phonbot Blog</p>
      <h1>${esc(BLOG_INDEX.headline)}</h1>
      <p class="lead">${esc(BLOG_INDEX.intro)}</p>
      <div class="actions"><a class="btn" href="/?page=register">Kostenlos testen</a><a class="btn secondary" href="/friseur/">Für Friseure</a></div>
    </div>
  </header>
  <section>
    <div class="wrap">
      <div class="grid">${cards}</div>
    </div>
  </section>
  <section>
    <div class="wrap">
      <div class="summary">Jeder Blogartikel entsteht aus einem strukturierten Brief, hat einen klaren Suchintent, eigene Beispiele und ein Review-Feld. Neue Artikel werden nicht automatisch veröffentlicht, wenn Pflichtfelder oder Qualitätschecks fehlen.</div>
    </div>
  </section>
</main>
${FOOTER_HTML}
<script src="/nav.js" defer></script>
</body>
</html>`;
}

function renderPost(post) {
  const url = blogUrl(post);
  const keywords = [post.primaryKeyword, ...post.secondaryKeywords]
    .map((keyword) => `<span class="chip">${esc(keyword)}</span>`)
    .join('');
  const sections = post.sections
    .map((section) => {
      const body = section.paragraphs
        ? section.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')
        : `<ul>${section.bullets.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
      return `<h2>${esc(section.heading)}</h2>${body}`;
    })
    .join('');
  const checklist = post.checklist.map((item) => `<li>${esc(item)}</li>`).join('');
  const faq = post.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('');
  const related = post.related
    .map((slug) => relatedPage(slug))
    .filter(Boolean)
    .map((page) => `<a href="/${page.slug}/">${esc(page.title)}<span>${esc(page.description)}</span></a>`)
    .join('');

  return `${pageHead({ title: post.title, description: post.description, url, jsonLd: postJsonLd(post) })}
<body>
${NAV_HTML}
<main class="page">
  <header class="hero">
    <div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Phonbot</a><span>/</span><a href="/blog/">Blog</a><span>/</span><span>${esc(post.category)}</span></nav>
      <p class="eyebrow">${esc(post.category)}</p>
      <h1>${esc(post.headline)}</h1>
      <p class="lead">${esc(post.description)}</p>
      <div class="meta"><span>${esc(deDate(post.dateModified))}</span><span>${post.readingMinutes} Minuten Lesezeit</span></div>
      <div class="keywords">${keywords}</div>
    </div>
  </header>
  <article class="article article-wrap">
    <div class="summary"><strong>Kurzfassung:</strong> ${esc(post.summary)}</div>
    ${sections}
    <div class="checklist">
      <h2>Praktische Checkliste</h2>
      <ul>${checklist}</ul>
    </div>
    <h2>Häufige Fragen</h2>
    <div class="faq">${faq}</div>
  </article>
  <section>
    <div class="wrap">
      <div class="link-list">${related}<a href="/blog/">Alle Blogartikel<span>Zurück zum Phonbot Blog</span></a></div>
    </div>
  </section>
</main>
${FOOTER_HTML}
<script src="/nav.js" defer></script>
</body>
</html>`;
}

function writeFile(rel, html) {
  const file = path.join(OUT_DIR, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  console.log(`✓ ${path.relative(path.resolve('apps/web/public'), file).replace(/\\/g, '/')}`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
writeFile('index.html', renderIndex());
for (const post of BLOG_POSTS) writeFile(`${post.slug}/index.html`, renderPost(post));
console.log(`\nGenerated ${BLOG_POSTS.length + 1} blog pages`);
