import fs from 'node:fs';
import path from 'node:path';
import { SITE, TODAY, CORE_INDUSTRY_PAGES, SEO_NICHE_PAGES, SUPPORT_PAGES } from './seo-pages.mjs';

const OUT = path.resolve('apps/web/public/sitemap.xml');

const LEGAL_PAGES = [
  { slug: 'impressum', lastmod: TODAY, changefreq: 'yearly', priority: '0.3' },
  { slug: 'datenschutz', lastmod: TODAY, changefreq: 'monthly', priority: '0.3' },
  { slug: 'agb', lastmod: TODAY, changefreq: 'yearly', priority: '0.3' },
  { slug: 'avv', lastmod: TODAY, changefreq: 'monthly', priority: '0.4' },
  { slug: 'sub-processors', lastmod: TODAY, changefreq: 'monthly', priority: '0.4' },
];

const urls = [
  { loc: `${SITE}/`, lastmod: TODAY, changefreq: 'weekly', priority: '1.0', imageTitle: 'Phonbot - KI-Telefonassistent' },
  ...SUPPORT_PAGES.map((page) => ({
    loc: `${SITE}/${page.slug}/`,
    lastmod: TODAY,
    changefreq: 'weekly',
    priority: page.slug === 'branchen' ? '0.95' : '0.7',
  })),
  ...CORE_INDUSTRY_PAGES.map((page) => ({
    loc: `${SITE}/${page.slug}/`,
    lastmod: TODAY,
    changefreq: 'monthly',
    priority: '0.9',
    imageTitle: page.title,
  })),
  ...SEO_NICHE_PAGES.map((page) => ({
    loc: `${SITE}/${page.slug}/`,
    lastmod: TODAY,
    changefreq: 'monthly',
    priority: '0.82',
    imageTitle: page.eyebrow,
  })),
  ...LEGAL_PAGES.map((page) => ({
    loc: `${SITE}/${page.slug}/`,
    lastmod: page.lastmod,
    changefreq: page.changefreq,
    priority: page.priority,
  })),
];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function alternate(loc) {
  return [
    `    <xhtml:link rel="alternate" hreflang="de-DE" href="${escapeXml(loc)}" />`,
    `    <xhtml:link rel="alternate" hreflang="de" href="${escapeXml(loc)}" />`,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(loc)}" />`,
  ].join('\n');
}

const body = urls.map((url) => {
  const image = url.imageTitle
    ? `\n    <image:image>\n      <image:loc>${SITE}/og-image.png</image:loc>\n      <image:title>${escapeXml(url.imageTitle)}</image:title>\n    </image:image>`
    : '';
  return `  <url>
    <loc>${escapeXml(url.loc)}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
${alternate(url.loc)}${image}
  </url>`;
}).join('\n\n');

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">

${body}

</urlset>
`;

fs.writeFileSync(OUT, sitemap);
console.log(`✓ ${path.relative(process.cwd(), OUT)}`);
