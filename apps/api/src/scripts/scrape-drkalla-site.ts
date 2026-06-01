import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DRKALLA_SITE_ORIGIN,
  buildDrkallaKnowledgeTexts,
  type DrkallaKnowledgeSnapshot,
  type DrkallaPageFact,
  type DrkallaProduct,
  type DrkallaVariant,
} from '../drkalla-rag-agent.js';

const DEFAULT_OUT_DIR = path.resolve(process.cwd(), 'tmp/drkalla-rag');
const PRODUCT_PAGE_SIZE = 250;
const MAX_PRODUCT_PAGES = 20;
const PAGE_URLS = [
  `${DRKALLA_SITE_ORIGIN}/`,
  `${DRKALLA_SITE_ORIGIN}/collections`,
  `${DRKALLA_SITE_ORIGIN}/pages/contact`,
  `${DRKALLA_SITE_ORIGIN}/pages/uber-uns`,
  `${DRKALLA_SITE_ORIGIN}/policies/shipping-policy`,
  `${DRKALLA_SITE_ORIGIN}/policies/refund-policy`,
  `${DRKALLA_SITE_ORIGIN}/policies/privacy-policy`,
  `${DRKALLA_SITE_ORIGIN}/policies/terms-of-service`,
  `${DRKALLA_SITE_ORIGIN}/policies/legal-notice`,
];

type ShopifyProduct = {
  id: number | string;
  title?: string;
  handle?: string;
  body_html?: string | null;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string[] | string | null;
  variants?: Array<{
    id: number | string;
    title?: string | null;
    price?: string | number | null;
    compare_at_price?: string | number | null;
    available?: boolean | null;
    sku?: string | null;
  }>;
};

function compact(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(input: string): string {
  return compact(decodeEntities(input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      accept: 'text/html,application/json,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': 'PhoneBot-DrKalla-RAG-Builder/1.0',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`FETCH_FAILED:${res.status}:${url}`);
  return res.text();
}

function productTags(tags: ShopifyProduct['tags']): string[] {
  if (Array.isArray(tags)) return tags.map(String).map(compact).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map(compact).filter(Boolean);
  return [];
}

function normalizeProduct(product: ShopifyProduct): DrkallaProduct | null {
  const title = compact(product.title ?? '');
  const handle = compact(product.handle ?? '');
  if (!title || !handle) return null;
  const variants: DrkallaVariant[] = (product.variants ?? []).map((variant) => ({
    id: variant.id,
    title: compact(variant.title ?? 'Standard'),
    price: String(variant.price ?? '').trim(),
    compareAtPrice: variant.compare_at_price == null ? null : String(variant.compare_at_price),
    available: variant.available === true,
    sku: variant.sku ? compact(variant.sku) : null,
  }));
  return {
    id: product.id,
    title,
    handle,
    url: `${DRKALLA_SITE_ORIGIN}/products/${handle}`,
    vendor: product.vendor ? compact(product.vendor) : null,
    productType: product.product_type ? compact(product.product_type) : null,
    tags: productTags(product.tags),
    description: stripHtml(product.body_html ?? ''),
    variants,
  };
}

async function fetchProducts(): Promise<DrkallaProduct[]> {
  const products: DrkallaProduct[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PRODUCT_PAGES; page += 1) {
    const url = `${DRKALLA_SITE_ORIGIN}/products.json?limit=${PRODUCT_PAGE_SIZE}&page=${page}`;
    const json = JSON.parse(await fetchText(url)) as { products?: ShopifyProduct[] };
    const batch = Array.isArray(json.products) ? json.products : [];
    for (const rawProduct of batch) {
      const product = normalizeProduct(rawProduct);
      if (!product) continue;
      const key = String(product.id);
      if (seen.has(key)) continue;
      seen.add(key);
      products.push(product);
    }
    if (batch.length < PRODUCT_PAGE_SIZE) break;
  }
  return products.sort((a, b) => a.title.localeCompare(b.title, 'de'));
}

function pageTitle(html: string, url: string): string {
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
  const title = titleMatch ? stripHtml(titleMatch[1] ?? '') : '';
  return title || url;
}

async function fetchPages(): Promise<DrkallaPageFact[]> {
  const pages: DrkallaPageFact[] = [];
  for (const url of PAGE_URLS) {
    try {
      const html = await fetchText(url);
      const text = stripHtml(html).slice(0, 8000);
      if (text) pages.push({ title: pageTitle(html, url), url, text });
    } catch {
      // Some Shopify policy/page URLs may not exist. The product scrape remains useful.
    }
  }
  return pages;
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => compact(value ?? '')).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'de'))
    .slice(0, 80);
}

export async function scrapeDrkallaSite(now = new Date()): Promise<DrkallaKnowledgeSnapshot> {
  const [products, pages] = await Promise.all([fetchProducts(), fetchPages()]);
  return {
    scrapedAt: now.toISOString(),
    source: DRKALLA_SITE_ORIGIN,
    productCount: products.length,
    products,
    pages,
    categories: uniqueSorted(products.map((product) => product.productType)),
    vendors: uniqueSorted(products.map((product) => product.vendor)),
  };
}

async function writeSnapshot(outDir: string): Promise<void> {
  const snapshot = await scrapeDrkallaSite();
  const texts = buildDrkallaKnowledgeTexts(snapshot);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'drkalla-products.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await writeFile(
    path.join(outDir, 'drkalla-knowledge.md'),
    texts.map((entry) => `# ${entry.title}\n\n${entry.text}`).join('\n\n---\n\n'),
    'utf8',
  );
  console.log(JSON.stringify({
    ok: true,
    outDir,
    productCount: snapshot.productCount,
    pageCount: snapshot.pages.length,
    categoryCount: snapshot.categories.length,
    vendorCount: snapshot.vendors.length,
    knowledgeTextCount: texts.length,
  }, null, 2));
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  const outDirArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
  const outDir = outDirArg ? path.resolve(outDirArg.slice('--out-dir='.length)) : DEFAULT_OUT_DIR;
  writeSnapshot(outDir).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
