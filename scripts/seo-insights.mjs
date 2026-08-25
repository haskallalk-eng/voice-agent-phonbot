import fs from 'node:fs';
import path from 'node:path';
import { SITE, CORE_INDUSTRY_PAGES, SEO_NICHE_PAGES, SUPPORT_PAGES, TODAY } from './seo-pages.mjs';
import { BLOG_INDEX, BLOG_POSTS, blogUrl } from './blog-posts.mjs';

const OUT_DIR = path.resolve('docs/seo-insights');
const REPORT_MD = path.join(OUT_DIR, 'latest.md');
const REPORT_JSON = path.join(OUT_DIR, 'latest.json');
const PUBLIC_DIR = path.resolve('apps/web/public');
const DIST_DIR = path.resolve('apps/web/dist');

const GOOGLE_GUIDANCE = [
  {
    label: 'Google SEO Starter Guide',
    url: 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide',
    principle: 'Make content easy for search engines to understand and useful for users.',
  },
  {
    label: 'Google structured data guidelines',
    url: 'https://developers.google.com/search/docs/appearance/structured-data/sd-policies',
    principle: 'Structured data must match visible page content and is eligibility, not a guarantee.',
  },
  {
    label: 'Google AI features optimization guide',
    url: 'https://developers.google.com/search/docs/fundamentals/ai-optimization-guide',
    principle: 'AI search visibility follows the same people-first, crawlable, well-structured content rules.',
  },
];

const FUNNEL_WEIGHT = {
  money: 10,
  comparison: 9,
  problem: 8,
  setup: 7,
  trust: 7,
  awareness: 5,
};

const candidates = [
  {
    id: 'feature-ki-terminbuchung-telefon',
    type: 'feature-page',
    slug: 'ki-terminbuchung-telefon',
    title: 'KI-Terminbuchung am Telefon',
    primaryKeyword: 'KI Terminbuchung Telefon',
    funnel: 'money',
    audience: 'Terminbasierte Betriebe mit Kalenderdruck',
    reason: 'Direkt kaufnah: Nutzer suchen nicht nur KI, sondern eine konkrete Terminbuchungsfunktion.',
    implementation: 'Static feature page with booking flow, calendar safety rules, visible FAQ answers, matching SoftwareApplication/Service JSON-LD, links to Friseur, Kosmetikstudio, Fitnessstudio, Kontakt.',
  },
  {
    id: 'feature-ki-anrufannahme-24-7',
    type: 'feature-page',
    slug: 'ki-anrufannahme-24-7',
    title: 'KI-Anrufannahme 24/7',
    primaryKeyword: 'KI Anrufannahme 24/7',
    funnel: 'money',
    audience: 'Lokale Dienstleister mit verpassten Anrufen',
    reason: 'Sehr nah am Kernproblem von Phonbot und breit genug fuer interne Verlinkung aus allen Branchen.',
    implementation: 'Static feature page with use cases, after-hours routing, no-false-promise section, FAQ, links from hero/footer/blog.',
  },
  {
    id: 'problem-anrufbeantworter-alternative',
    type: 'problem-page',
    slug: 'anrufbeantworter-alternative',
    title: 'Anrufbeantworter Alternative fuer kleine Unternehmen',
    primaryKeyword: 'Anrufbeantworter Alternative Unternehmen',
    funnel: 'problem',
    audience: 'Betriebe, die Mailbox/AB als ungenuegend erleben',
    reason: 'Guter SEO-Hebel, weil Nutzer ihr Problem bereits benennen, aber noch nicht zwingend nach KI suchen.',
    implementation: 'Comparison-style guide: Mailbox vs Sekretariat vs KI-Telefonassistent, honest limits, CTA to demo.',
  },
  {
    id: 'comparison-ki-telefonassistent-vs-telefonservice',
    type: 'comparison-page',
    slug: 'ki-telefonassistent-vs-telefonservice',
    title: 'KI-Telefonassistent vs Telefonservice',
    primaryKeyword: 'KI Telefonassistent vs Telefonservice',
    funnel: 'comparison',
    audience: 'Kaeufer, die Alternativen vergleichen',
    reason: 'Comparison pages sind kaufnah und koennen Einwaende zu Vertrauen, Datenschutz, Kosten und Qualitaet sauber abholen.',
    implementation: 'Neutral comparison with cost bands, response-time table, privacy caveats, FAQ, strong internal links.',
  },
  {
    id: 'trust-dsgvo-ki-telefonassistent',
    type: 'trust-page',
    slug: 'dsgvo-ki-telefonassistent',
    title: 'DSGVO und KI-Telefonassistenten',
    primaryKeyword: 'DSGVO KI Telefonassistent',
    funnel: 'trust',
    audience: 'Datenschutzbewusste Betriebe',
    reason: 'Bestehende Blogartikel decken DSGVO an, aber eine evergreen Trust-Landingpage kann intern und extern staerker ranken.',
    implementation: 'Evergreen page with processing overview, retention, AVV, sub-processors, no legal advice wording and visible FAQ answers.',
  },
  {
    id: 'local-ki-telefonassistent-berlin',
    type: 'local-page',
    slug: 'ki-telefonassistent-berlin',
    title: 'KI-Telefonassistent Berlin',
    primaryKeyword: 'KI Telefonassistent Berlin',
    funnel: 'money',
    audience: 'Lokale Betriebe in Berlin',
    reason: 'Mindrails/Phonbot has Germany/Berlin context; local intent can be valuable if content stays genuinely local.',
    implementation: 'Local page only if it has real local proof: Berlin phone demo, German hosting context, local service area text, ContactPoint schema.',
  },
  {
    id: 'industry-zahnarzt',
    type: 'industry-page',
    slug: 'zahnarzt',
    title: 'KI-Telefonassistent fuer Zahnarztpraxen',
    primaryKeyword: 'KI Telefonassistent Zahnarzt',
    funnel: 'money',
    audience: 'Zahnarztpraxen',
    reason: 'High-value appointment niche, but higher compliance risk because medical-adjacent claims must be carefully limited.',
    implementation: 'Industry page focused on appointment intake, recall, emergencies-to-human, no medical advice, strong disclaimers.',
  },
  {
    id: 'industry-steuerberater',
    type: 'industry-page',
    slug: 'steuerberater',
    title: 'KI-Telefonassistent fuer Steuerberater',
    primaryKeyword: 'KI Telefonassistent Steuerberater',
    funnel: 'money',
    audience: 'Steuerkanzleien',
    reason: 'Professional-services niche with clear phone pain and lead value; risk manageable with no-tax-advice guardrails.',
    implementation: 'Industry page for appointment intake, document reminders, callback tickets, no tax advice, visible FAQ answers and matching service schema.',
  },
  {
    id: 'industry-anwalt',
    type: 'industry-page',
    slug: 'anwalt',
    title: 'KI-Telefonassistent fuer Kanzleien',
    primaryKeyword: 'KI Telefonassistent Anwalt',
    funnel: 'money',
    audience: 'Anwaltskanzleien',
    reason: 'High lead value, but YMYL/legal risk means this must be intake-only and human-reviewed.',
    implementation: 'Only build with strict legal-disclaimer and intake positioning: no Rechtsberatung, conflict-check routing, urgent deadlines to human.',
  },
  {
    id: 'blog-kosten-ki-telefonassistent-2026',
    type: 'blog-post',
    slug: 'blog/ki-telefonassistent-kosten-2026',
    title: 'KI-Telefonassistent Kosten 2026',
    primaryKeyword: 'KI Telefonassistent Kosten',
    funnel: 'comparison',
    audience: 'Preisbewusste Kaufinteressenten',
    reason: 'There is an ROI article, but a clearer cost guide can capture price-intent queries and support conversion.',
    implementation: 'Blog guide with transparent Phonbot plans, total cost factors, examples by call volume, links to pricing/register.',
  },
  {
    id: 'blog-rufweiterleitung-telekom-o2-vodafone',
    type: 'blog-post',
    slug: 'blog/rufweiterleitung-telekom-o2-vodafone-ki',
    title: 'Rufweiterleitung Telekom, Vodafone und O2 fuer KI-Telefonie',
    primaryKeyword: 'Rufweiterleitung Telekom KI Telefon',
    funnel: 'setup',
    audience: 'Users setting up forwarding',
    reason: 'Setup queries are practical, low-risk and likely to convert after technical success.',
    implementation: 'Provider-specific setup overview with caveat to verify current carrier UI, screenshots only if maintained.',
  },
  {
    id: 'programmatic-city-industry-matrix',
    type: 'programmatic-system',
    slug: 'city-industry-matrix',
    title: 'City x Industry Matrix',
    primaryKeyword: 'KI Telefonassistent {Branche} {Stadt}',
    funnel: 'money',
    audience: 'Local service searches',
    reason: 'Potentially large reach, but risky if pages become thin or duplicate. Should start with 3 hand-written pilots.',
    implementation: 'Pilot only: Berlin x Friseur, Berlin x Handwerker, Berlin x Zahnarzt. Require local proof, unique FAQs and Search Console validation before scaling.',
  },
];

function fileExistsForSlug(slug) {
  const clean = slug.replace(/^blog\//, 'blog/');
  return fs.existsSync(path.join(PUBLIC_DIR, clean, 'index.html')) || fs.existsSync(path.join(DIST_DIR, clean, 'index.html'));
}

function readPublicPage(slug) {
  const clean = slug.replace(/^blog\//, 'blog/');
  const publicFile = path.join(PUBLIC_DIR, clean, 'index.html');
  const distFile = path.join(DIST_DIR, clean, 'index.html');
  const file = fs.existsSync(distFile) ? distFile : publicFile;
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pageQuality(slug) {
  const html = readPublicPage(slug);
  if (!html) return { exists: false, textChars: 0, hasCanonical: false, hasJsonLd: false, hasFaq: false, hasCta: false };
  const text = stripHtml(html);
  return {
    exists: true,
    textChars: text.length,
    hasCanonical: /<link\s+rel=["']canonical["']/i.test(html),
    hasJsonLd: /application\/ld\+json/i.test(html),
    hasFaq: /FAQPage|<details|H[äa]ufige Fragen/i.test(html),
    hasCta: /Kostenlos testen|Demo anrufen|Kontakt aufnehmen|page=register/i.test(html),
  };
}

function keywordCovered(keyword) {
  const needle = keyword.toLowerCase();
  const all = [
    ...CORE_INDUSTRY_PAGES,
    ...SEO_NICHE_PAGES,
    ...SUPPORT_PAGES,
    BLOG_INDEX,
    ...BLOG_POSTS,
  ];
  return all.some((page) => [
    page.primaryKeyword,
    page.title,
    page.description,
    page.headline,
    ...(page.secondaryKeywords ?? []),
  ].filter(Boolean).join(' ').toLowerCase().includes(needle));
}

function riskFor(candidate) {
  let risk = 2;
  if (candidate.type === 'programmatic-system') risk += 4;
  if (candidate.type === 'local-page') risk += 2;
  if (/(zahnarzt|anwalt|steuerberater|dsgvo)/i.test(candidate.slug)) risk += 2;
  if (/anwalt|zahnarzt/i.test(candidate.slug)) risk += 1;
  return Math.min(10, risk);
}

function effortFor(candidate) {
  if (candidate.type === 'programmatic-system') return 8;
  if (candidate.type === 'industry-page') return 5;
  if (candidate.type === 'comparison-page') return 4;
  if (candidate.type === 'trust-page') return 5;
  if (candidate.type === 'blog-post') return 3;
  return 4;
}

function impactFor(candidate, quality) {
  let impact = FUNNEL_WEIGHT[candidate.funnel] ?? 5;
  if (candidate.type === 'programmatic-system') impact += 1;
  if (candidate.type === 'industry-page') impact += 1;
  if (quality.exists) impact -= quality.textChars > 1800 ? 5 : 2;
  if (keywordCovered(candidate.primaryKeyword)) impact -= 2;
  return Math.max(1, Math.min(10, impact));
}

function confidenceFor(candidate, quality) {
  let confidence = 6;
  if (candidate.funnel === 'money' || candidate.funnel === 'comparison') confidence += 1;
  if (candidate.type === 'programmatic-system') confidence -= 2;
  if (candidate.type === 'local-page') confidence -= 1;
  if (quality.exists && quality.textChars > 1800) confidence -= 3;
  if (/anwalt|zahnarzt/i.test(candidate.slug)) confidence -= 1;
  return Math.max(1, Math.min(10, confidence));
}

function priorityScore({ impact, confidence, effort, risk }) {
  return Math.round(((impact * 1.9) + (confidence * 1.4) - (effort * 0.9) - (risk * 0.8)) * 5);
}

function evaluateCandidate(candidate) {
  const quality = pageQuality(candidate.slug);
  const impact = impactFor(candidate, quality);
  const confidence = confidenceFor(candidate, quality);
  const effort = effortFor(candidate);
  const risk = riskFor(candidate);
  const score = priorityScore({ impact, confidence, effort, risk });
  const gates = [];
  if (!quality.exists) gates.push('new-page-opportunity');
  if (quality.exists && quality.textChars < 2200) gates.push('needs-more-crawlable-helpful-content');
  if (!quality.hasCanonical) gates.push('canonical-required');
  if (!quality.hasJsonLd) gates.push('structured-data-required');
  if (!quality.hasFaq) gates.push('faq-answer-block-required');
  if (!quality.hasCta) gates.push('conversion-path-required');
  if (risk >= 6) gates.push('human-review-before-publish');
  if (candidate.type === 'programmatic-system') gates.push('pilot-before-scale');
  return { ...candidate, quality, impact, confidence, effort, risk, score, gates };
}

function currentInventory() {
  return {
    coreIndustryPages: CORE_INDUSTRY_PAGES.length,
    nichePages: SEO_NICHE_PAGES.length,
    supportPages: SUPPORT_PAGES.length,
    blogPosts: BLOG_POSTS.length,
    sitemapExists: fs.existsSync(path.join(PUBLIC_DIR, 'sitemap.xml')),
    robotsExists: fs.existsSync(path.join(PUBLIC_DIR, 'robots.txt')),
    distExists: fs.existsSync(DIST_DIR),
  };
}

function renderMarkdown(report) {
  const top = report.opportunities.slice(0, 10);
  const rows = top.map((item, index) => (
    `| ${index + 1} | ${item.title} | ${item.primaryKeyword} | ${item.type} | ${item.score} | ${item.impact}/${item.confidence}/${item.effort}/${item.risk} | ${item.gates.join(', ')} |`
  )).join('\n');

  const details = top.map((item, index) => `### ${index + 1}. ${item.title}
- Primary keyword: ${item.primaryKeyword}
- Why it should work: ${item.reason}
- Implementation: ${item.implementation}
- SEO gates: ${item.gates.join(', ')}
- Existing page: ${item.quality.exists ? `yes (${item.quality.textChars} crawlable chars)` : 'no'}
`).join('\n');

  const sources = GOOGLE_GUIDANCE
    .map((source) => `- [${source.label}](${source.url}) - ${source.principle}`)
    .join('\n');

  return `# SEO Insight Automation Report

Generated: ${report.generatedAt}
Site: ${SITE}
Content baseline date in repo: ${TODAY}

## Existing System Check

- Call insight automation: exists in \`apps/api/src/insights.ts\` and \`apps/api/src/outbound-insights.ts\`.
- Cross-org learning foundation: exists through \`call_transcripts\`, \`template_learnings\`, \`conversation_patterns\`, and \`learning-api.ts\`.
- SEO automation: exists for generation/audit/indexing through \`seo:generate\`, \`seo:audit\`, and \`seo:indexnow\`.
- Missing before this report: a repeatable SEO opportunity scoring loop that ranks ideas by expected impact and risk.

## Inventory

- Core industry pages: ${report.inventory.coreIndustryPages}
- Niche pages: ${report.inventory.nichePages}
- Support pages: ${report.inventory.supportPages}
- Blog posts: ${report.inventory.blogPosts}
- Sitemap present: ${report.inventory.sitemapExists ? 'yes' : 'no'}
- Robots present: ${report.inventory.robotsExists ? 'yes' : 'no'}
- Built dist present for deep checks: ${report.inventory.distExists ? 'yes' : 'no'}

## Scoring Model

Score combines:
- Impact: search intent, conversion proximity, internal-link value.
- Confidence: fit to Phonbot product truth and current content patterns.
- Effort: estimated content/design/code effort.
- Risk: YMYL, duplicate/thin-page risk, compliance risk.

The automation favors pages that are crawlable, visibly useful, structured with matching JSON-LD, and connected to a clear conversion path.

## Top Opportunities

| # | Idea | Keyword | Type | Score | Impact/Confidence/Effort/Risk | Gates |
|---|---|---|---|---:|---|---|
${rows}

## Recommended Build Order

1. Build the top 2 feature/problem pages first because they are broad, low-risk, and directly support all existing industry pages.
2. Add one comparison page to catch buyer-intent searches before competitors do.
3. Add one trust page for DSGVO/AI objections, but keep all claims tied to visible legal/compliance pages.
4. Pilot local/programmatic SEO with a tiny hand-written set only after Search Console data confirms impressions.
5. Treat medical/legal/tax niches as intake-only pages with human-review gates.

## Opportunity Details

${details}
## Automation Cadence

- Weekly: run \`pnpm seo:generate && pnpm --filter @vas/web build && pnpm seo:audit && pnpm seo:insights\`.
- After publishing pages: run \`pnpm seo:indexnow -- --execute\` only when the generated sitemap and IndexNow key are valid.
- Monthly: compare this report with Google Search Console impressions/clicks and promote only ideas with real demand signals.

## Source Principles

${sources}
`;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const opportunities = candidates
    .map(evaluateCandidate)
    .sort((a, b) => b.score - a.score);
  const report = {
    generatedAt: new Date().toISOString(),
    site: SITE,
    inventory: currentInventory(),
    opportunities,
    guidance: GOOGLE_GUIDANCE,
  };
  fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(REPORT_MD, renderMarkdown(report));
  console.log(`SEO insight report written:
- ${path.relative(process.cwd(), REPORT_MD)}
- ${path.relative(process.cwd(), REPORT_JSON)}`);
  console.log(`Top idea: ${opportunities[0]?.title ?? 'none'} (${opportunities[0]?.score ?? 0})`);
}

main();
