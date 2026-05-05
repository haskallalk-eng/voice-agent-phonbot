// Generates crawlable SEO cluster pages that are not part of the interactive SPA.
import fs from 'node:fs';
import path from 'node:path';
import { NAV_STYLE, NAV_HTML } from './_nav.mjs';
import { FOOTER_STYLE, FOOTER_HTML } from './_footer.mjs';
import { SITE, TODAY, CORE_INDUSTRY_PAGES, SEO_NICHE_PAGES, ALL_INDUSTRY_PAGES } from './seo-pages.mjs';

const OUT_DIR = path.resolve('apps/web/public');

const germanPairs = [
  ['fuer', 'für'], ['Fuer', 'Für'], ['Oeff', 'Öff'], ['oeff', 'öff'], ['Foerder', 'Förder'], ['foerder', 'förder'],
  ['ueber', 'über'], ['Ueber', 'Über'], ['waehrend', 'während'], ['Waehrend', 'Während'],
  ['Rueckruf', 'Rückruf'], ['rueckruf', 'rückruf'], ['Wuensch', 'Wünsch'], ['wuensch', 'wünsch'],
  ['pruef', 'prüf'], ['Pruef', 'Prüf'], ['Fuehrerschein', 'Führerschein'], ['Fuehrerscheinklasse', 'Führerscheinklasse'],
  ['klaer', 'klär'], ['Klaer', 'Klär'], ['moeg', 'mög'], ['Moeg', 'Mög'], ['waere', 'wäre'], ['Waere', 'Wäre'],
  ['haett', 'hätt'], ['Haett', 'Hätt'], ['Gaeste', 'Gäste'], ['gaeste', 'gäste'], ['staetten', 'stätten'],
  ['Staetten', 'Stätten'], ['staendig', 'ständig'], ['Staendig', 'Ständig'], ['Massnah', 'Maßnah'],
  ['Fahrlehrer', 'Fahrlehrer'], ['bestaet', 'bestät'], ['Bestaet', 'Bestät'], ['erklaer', 'erklär'],
  ['Erklaer', 'Erklär'], ['haeufig', 'häufig'], ['Haeufig', 'Häufig'], ['Gebaeude', 'Gebäude'],
  ['Flaeche', 'Fläche'], ['laeuft', 'läuft'], ['Laeuft', 'Läuft'], ['saeuber', 'säuber'],
  ['Schaed', 'Schäd'], ['schaed', 'schäd'], ['Schluessel', 'Schlüssel'], ['Zeitraeume', 'Zeiträume'],
  ['gaengig', 'gängig'], ['Gaengig', 'Gängig'], ['koennen', 'können'], ['Koennen', 'Können'],
  ['muessen', 'müssen'], ['Muessen', 'Müssen'], ['duerfen', 'dürfen'], ['Duerfen', 'Dürfen'],
  ['waehlt', 'wählt'], ['Waehlt', 'Wählt'], ['Kuenstliche', 'Künstliche'],
];

function pretty(value) {
  let text = String(value);
  for (const [from, to] of germanPairs) text = text.replaceAll(from, to);
  return text;
}

function esc(value) {
  return pretty(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function json(value) {
  return JSON.stringify(value, null, 2)
    .replace(/<\//g, '<\\/');
}

const STYLE = `${NAV_STYLE}
:root{color-scheme:dark;--bg:#090A0F;--panel:#11131B;--ink:#fff;--muted:rgba(255,255,255,.68);--soft:rgba(255,255,255,.1);--orange:#F97316;--cyan:#06B6D4}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6;overflow-x:clip}
a{color:inherit}.page{min-height:100vh}.wrap{width:min(1120px,calc(100% - 40px));margin:0 auto}.hero{padding:76px 0 42px}.crumbs{display:flex;gap:8px;flex-wrap:wrap;color:rgba(255,255,255,.48);font-size:.9rem;margin-bottom:28px}.crumbs a{color:rgba(255,255,255,.72);text-decoration:none}.eyebrow{color:#FDBA74;text-transform:uppercase;letter-spacing:.08em;font-size:.8rem;font-weight:800}.hero h1{font-size:clamp(2.2rem,5vw,4.4rem);line-height:1.05;letter-spacing:-.02em;max-width:900px;margin:14px 0 20px}.lead{font-size:1.13rem;color:var(--muted);max-width:780px}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border-radius:999px;padding:0 18px;text-decoration:none;font-weight:800;background:linear-gradient(135deg,var(--orange),var(--cyan));color:#fff}.btn.secondary{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14)}
section{padding:46px 0}.section-head{max-width:760px;margin-bottom:22px}.section-head h2{font-size:2rem;line-height:1.15;margin:0 0 10px}.section-head p{color:var(--muted);margin:0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(236px,1fr));gap:14px}.card{border:1px solid var(--soft);background:rgba(255,255,255,.045);border-radius:8px;padding:18px;text-decoration:none;display:block}.card h3{font-size:1rem;margin:0 0 8px}.card p{color:var(--muted);margin:0}.flow{counter-reset:step;display:grid;gap:10px}.step{counter-increment:step;display:flex;gap:12px;align-items:flex-start;padding:14px 0;border-bottom:1px solid rgba(255,255,255,.08)}.step:before{content:counter(step);display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:rgba(249,115,22,.16);color:#FDBA74;font-weight:900;flex:0 0 auto}.keywords{display:flex;flex-wrap:wrap;gap:8px}.chip{border:1px solid rgba(6,182,212,.28);background:rgba(6,182,212,.08);color:#9DECF8;border-radius:999px;padding:7px 11px;font-size:.88rem}.notice{border-left:3px solid var(--orange);background:rgba(249,115,22,.08);padding:16px 18px;color:rgba(255,255,255,.78);max-width:820px}.faq{display:grid;gap:10px}.faq details{border:1px solid var(--soft);background:rgba(255,255,255,.035);border-radius:8px;padding:0}.faq summary{cursor:pointer;padding:16px 18px;font-weight:800}.faq p{color:var(--muted);margin:0;padding:0 18px 16px}.link-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.link-list a{border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:14px;text-decoration:none;background:rgba(255,255,255,.035)}.link-list span{display:block;color:rgba(255,255,255,.58);font-size:.9rem;margin-top:4px}.mini{color:rgba(255,255,255,.55);font-size:.92rem}.site-footer{margin-top:0}
@media(max-width:640px){.wrap{width:min(100% - 28px,1120px)}.hero{padding-top:48px}.hero h1{font-size:2.35rem}.grid{grid-template-columns:1fr}}
${FOOTER_STYLE}`;

function pageHead({ title, description, slug, jsonLd }) {
  const url = `${SITE}/${slug}/`;
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
<meta property="og:type" content="website" />
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
<link rel="icon" href="/favicon.ico" />
<script type="application/ld+json">
${json(jsonLd)}
</script>
<style>${STYLE}</style>
</head>`;
}

function pageJsonLd(page) {
  const url = `${SITE}/${page.slug}/`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: pretty(page.title),
        headline: pretty(page.headline),
        description: pretty(page.description),
        inLanguage: 'de-DE',
        dateModified: TODAY,
        isPartOf: { '@id': `${SITE}/#website` },
        about: { '@id': `${url}#service` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        '@type': 'Service',
        '@id': `${url}#service`,
        name: pretty(page.eyebrow),
        serviceType: 'AI Voice Agent',
        provider: { '@type': 'Organization', name: 'Phonbot', url: `${SITE}/` },
        areaServed: { '@type': 'Country', name: 'Deutschland' },
        audience: { '@type': 'BusinessAudience', audienceType: pretty(page.audience) },
        description: pretty(page.intro),
        offers: { '@type': 'Offer', url, price: '8.99', priceCurrency: 'EUR' },
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        mainEntity: page.faq.map(([q, a]) => ({
          '@type': 'Question',
          name: pretty(q),
          acceptedAnswer: { '@type': 'Answer', text: pretty(a) },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Phonbot', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Branchen', item: `${SITE}/branchen/` },
          { '@type': 'ListItem', position: 3, name: pretty(page.name), item: url },
        ],
      },
    ],
  };
}

function renderNichePage(page) {
  const keywords = [page.primaryKeyword, ...page.secondaryKeywords]
    .map((k) => `<span class="chip">${esc(k)}</span>`)
    .join('');
  const useCases = page.useCases
    .map(([title, body]) => `<article class="card"><h3>${esc(title)}</h3><p>${esc(body)}</p></article>`)
    .join('');
  const flow = page.callFlow
    .map((step) => `<div class="step">${esc(step)}</div>`)
    .join('');
  const faq = page.faq
    .map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`)
    .join('');
  const related = CORE_INDUSTRY_PAGES.filter((item) => item.slug !== page.slug)
    .slice(0, 4)
    .map((item) => `<a href="/${item.slug}/">${esc(item.title)}<span>${esc(item.description)}</span></a>`)
    .join('');

  return `${pageHead({ ...page, jsonLd: pageJsonLd(page) })}
<body>
${NAV_HTML}
<main class="page">
  <header class="hero">
    <div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Phonbot</a><span>/</span><a href="/branchen/">Branchen</a><span>/</span><span>${esc(page.name)}</span></nav>
      <p class="eyebrow">${esc(page.eyebrow)}</p>
      <h1>${esc(page.headline)}</h1>
      <p class="lead">${esc(page.intro)}</p>
      <div class="actions"><a class="btn" href="/?page=register">Kostenlos testen</a><a class="btn secondary" href="/#demo">Chipy live hören</a></div>
    </div>
  </header>
  <section>
    <div class="wrap">
      <div class="section-head"><h2>Typische Anrufe in dieser Nische</h2><p>${esc(page.pain)}</p></div>
      <div class="grid">${useCases}</div>
    </div>
  </section>
  <section>
    <div class="wrap">
      <div class="section-head"><h2>So läuft ein Anruf mit Phonbot</h2><p>Der Agent bleibt nah am Telefonalltag: erst verstehen, dann gezielt fragen, dann buchen oder sauber weitergeben.</p></div>
      <div class="flow">${flow}</div>
    </div>
  </section>
  <section>
    <div class="wrap">
      <div class="section-head"><h2>Keyword-Fokus</h2><p>Diese Seite ist auf konkrete Suchintentionen rund um automatische Anrufannahme, Terminbuchung und KI-Telefonie ausgerichtet.</p></div>
      <div class="keywords">${keywords}</div>
    </div>
  </section>
  <section>
    <div class="wrap">
      <div class="notice">Phonbot ersetzt keine fachliche Beratung, wenn ein Anliegen rechtlich, medizinisch oder finanziell individuell bewertet werden muss. Der Agent nimmt Daten auf, beantwortet erlaubte Standardfragen und leitet komplexe Fälle an dein Team weiter.</div>
    </div>
  </section>
  <section>
    <div class="wrap">
      <div class="section-head"><h2>Häufige Fragen</h2><p>Kurze Antworten für Suchmaschinen, AI-Assistenten und echte Interessenten.</p></div>
      <div class="faq">${faq}</div>
    </div>
  </section>
  <section>
    <div class="wrap">
      <div class="section-head"><h2>Weitere Branchen</h2><p>Phonbot kann für mehrere lokale Geschäftsmodelle vorkonfiguriert werden.</p></div>
      <div class="link-list">${related}<a href="/branchen/">Alle Branchen ansehen<span>Hub mit allen statischen Nischen-Seiten</span></a></div>
    </div>
  </section>
</main>
${FOOTER_HTML}
<script src="/nav.js" defer></script>
</body>
</html>`;
}

function hubJsonLd() {
  const url = `${SITE}/branchen/`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${url}#webpage`,
        url,
        name: 'KI-Telefonassistent nach Branche',
        description: pretty('Alle Phonbot Branchen- und Nischen-Seiten fuer KI-Telefonassistenten in Deutschland.'),
        inLanguage: 'de-DE',
        dateModified: TODAY,
        isPartOf: { '@id': `${SITE}/#website` },
        mainEntity: { '@id': `${url}#itemlist` },
      },
      {
        '@type': 'ItemList',
        '@id': `${url}#itemlist`,
        itemListElement: ALL_INDUSTRY_PAGES.map((page, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: pretty(page.title),
          url: `${SITE}/${page.slug}/`,
        })),
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Phonbot', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Branchen', item: url },
        ],
      },
    ],
  };
}

function renderHubPage() {
  const core = CORE_INDUSTRY_PAGES
    .map((page) => `<a class="card" href="/${page.slug}/"><h3>${esc(page.title)}</h3><p>${esc(page.description)}</p></a>`)
    .join('');
  const niches = SEO_NICHE_PAGES
    .map((page) => `<a class="card" href="/${page.slug}/"><h3>${esc(page.eyebrow)}</h3><p>${esc(page.description)}</p></a>`)
    .join('');
  const hub = {
    slug: 'branchen',
    title: 'KI-Telefonassistent nach Branche | Phonbot',
    description: 'Alle Phonbot-Branchen: Friseure, Handwerker, Reinigung, Restaurants, Kosmetikstudios, Fahrschulen, Immobilienmakler und weitere Nischen.',
  };

  return `${pageHead({ ...hub, jsonLd: hubJsonLd() })}
<body>
${NAV_HTML}
<main class="page">
  <header class="hero">
    <div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Phonbot</a><span>/</span><span>Branchen</span></nav>
      <p class="eyebrow">Branchen-Hub für Google und AI-Suche</p>
      <h1>KI-Telefonassistent nach Branche: alle Nischen auf einen Blick.</h1>
      <p class="lead">Diese Übersicht bündelt alle crawlbaren Phonbot-Seiten für lokale Betriebe. Jede Seite hat eigene Inhalte, Canonical, FAQ-Schema, Service-Schema und interne Links, damit Google und AI-Assistenten die passende Nische klar erkennen.</p>
      <div class="actions"><a class="btn" href="/?page=register">Kostenlos testen</a><a class="btn secondary" href="/kontakt/">Kontakt aufnehmen</a></div>
    </div>
  </header>
  <section>
    <div class="wrap">
      <div class="section-head"><h2>Bestehende Hauptbranchen</h2><p>Diese Seiten sind bereits die wichtigsten Einstiege für direkte Kaufintention.</p></div>
      <div class="grid">${core}</div>
    </div>
  </section>
  <section>
    <div class="wrap">
      <div class="section-head"><h2>Neue Nischen-Seiten</h2><p>Zusätzliche Keyword-Cluster für Suchanfragen mit weniger Wettbewerb und klarerem Telefonproblem.</p></div>
      <div class="grid">${niches}</div>
    </div>
  </section>
  <section>
    <div class="wrap">
      <div class="notice">Priorität für SEO: erst indexierbare HTML-Seiten, dann saubere interne Links, dann echte Nachfrage-Daten aus Google Search Console. Diese Seite ist der technische Hub für alle weiteren Nischen.</div>
    </div>
  </section>
</main>
${FOOTER_HTML}
<script src="/nav.js" defer></script>
</body>
</html>`;
}

function contactJsonLd() {
  const url = `${SITE}/kontakt/`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ContactPage',
        '@id': `${url}#webpage`,
        url,
        name: 'Kontakt zu Phonbot',
        description: 'Kontakt zu Phonbot fuer Demo, Preise, DSGVO und Einrichtung.',
        inLanguage: 'de-DE',
        dateModified: TODAY,
        isPartOf: { '@id': `${SITE}/#website` },
      },
      {
        '@type': 'Organization',
        '@id': `${SITE}/#organization`,
        name: 'Phonbot',
        url: `${SITE}/`,
        email: 'info@phonbot.de',
        telephone: '+49-30-75937169',
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          email: 'info@phonbot.de',
          telephone: '+49-30-75937169',
          areaServed: 'DE',
          availableLanguage: ['German', 'English'],
        },
      },
    ],
  };
}

function renderContactPage() {
  const page = {
    slug: 'kontakt',
    title: 'Kontakt zu Phonbot | KI-Telefonassistent testen',
    description: 'Kontakt zu Phonbot: Demo anfragen, KI-Telefonassistent testen oder Fragen zu Preisen, DSGVO und Einrichtung klaeren.',
  };
  return `${pageHead({ ...page, jsonLd: contactJsonLd() })}
<body>
${NAV_HTML}
<main class="page">
  <header class="hero">
    <div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Phonbot</a><span>/</span><span>Kontakt</span></nav>
      <p class="eyebrow">Kontakt und Demo</p>
      <h1>Phonbot testen oder eine Frage zur KI-Telefonie klären.</h1>
      <p class="lead">Wenn du wissen willst, ob Phonbot zu deiner Branche passt, schreib kurz, welche Anrufe automatisiert werden sollen. Für die schnelle Demo kannst du auch direkt den Test im Browser starten.</p>
      <div class="actions"><a class="btn" href="mailto:info@phonbot.de">info@phonbot.de</a><a class="btn secondary" href="/#demo">Demo starten</a></div>
    </div>
  </header>
  <section>
    <div class="wrap">
      <div class="grid">
        <article class="card"><h3>E-Mail</h3><p><a href="mailto:info@phonbot.de">info@phonbot.de</a></p></article>
        <article class="card"><h3>Telefon</h3><p><a href="tel:+493075937169">+49 30 75937169</a></p></article>
        <article class="card"><h3>Typische Fragen</h3><p>Preise, Einrichtung, DSGVO, Rufweiterleitung, Kalender-Sync und passende Branchen-Templates.</p></article>
      </div>
    </div>
  </section>
  <section>
    <div class="wrap">
      <div class="section-head"><h2>Vor dem Gespräch hilfreich</h2><p>Damit der erste Termin konkret wird, reichen wenige Stichpunkte.</p></div>
      <div class="flow"><div class="step">Welche Branche und wie viele Anrufe pro Monat?</div><div class="step">Welche Anrufe soll der Agent sicher erledigen?</div><div class="step">Welcher Kalender oder welches Tool soll verbunden werden?</div><div class="step">Soll eine bestehende Nummer weitergeleitet werden?</div></div>
    </div>
  </section>
</main>
${FOOTER_HTML}
<script src="/nav.js" defer></script>
</body>
</html>`;
}

function writePage(slug, html) {
  const dir = path.join(OUT_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  console.log(`✓ ${slug}/index.html`);
}

writePage('branchen', renderHubPage());
writePage('kontakt', renderContactPage());
for (const page of SEO_NICHE_PAGES) writePage(page.slug, renderNichePage(page));
console.log(`\nGenerated ${SEO_NICHE_PAGES.length + 2} SEO cluster pages`);
