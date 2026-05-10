import fs from 'node:fs';
import path from 'node:path';

const SITE = 'https://phonbot.de';
const HOST = 'phonbot.de';
const ENDPOINT = process.env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow';
const EXECUTE = process.argv.includes('--execute');
const MAX_URLS = 10_000;

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
}

const key = process.env.INDEXNOW_KEY || readText(path.resolve('.indexnow-key'));
if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) {
  console.error('INDEXNOW_KEY missing or invalid. Expected 8-128 alphanumeric/dash chars.');
  process.exit(1);
}

const keyFile = path.resolve('apps/web/public', `${key}.txt`);
const keyFileContent = readText(keyFile);
if (keyFileContent !== key) {
  console.error(`IndexNow key file mismatch: ${path.relative(process.cwd(), keyFile)} must contain the key.`);
  process.exit(1);
}

const sitemap = readText(path.resolve('apps/web/public/sitemap.xml'));
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((match) => match[1])
  .filter((url) => url.startsWith(`${SITE}/`));

if (!urls.length) {
  console.error('No phonbot.de URLs found in sitemap.');
  process.exit(1);
}
if (urls.length > MAX_URLS) {
  console.error(`Too many URLs for one IndexNow request: ${urls.length} > ${MAX_URLS}`);
  process.exit(1);
}

const payload = {
  host: HOST,
  key,
  keyLocation: `${SITE}/${key}.txt`,
  urlList: urls,
};

if (!EXECUTE) {
  console.log(`[dry-run] would submit ${urls.length} URL(s) to ${ENDPOINT}`);
  console.log(JSON.stringify(payload, null, 2));
  console.log('Run with --execute to notify IndexNow participants.');
  process.exit(0);
}

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
});

const body = await response.text();
if (!response.ok && response.status !== 202) {
  console.error(`IndexNow submission failed: HTTP ${response.status}`);
  if (body) console.error(body.slice(0, 800));
  process.exit(1);
}

console.log(`IndexNow accepted ${urls.length} URL(s): HTTP ${response.status}`);
