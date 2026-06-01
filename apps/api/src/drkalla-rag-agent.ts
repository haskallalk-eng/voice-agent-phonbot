import crypto from 'node:crypto';

export const DRKALLA_SITE_ORIGIN = 'https://drkalla.com';
export const DRKALLA_RAG_AGENT_NAME = 'DrKalla RAG Voice Agent';
export const DRKALLA_RAG_KB_NAME_PREFIX = 'DrKalla KB';
export const DRKALLA_RAG_BEGIN_MESSAGE =
  'Hallo, hier ist der Dr. Kalla Assistent. Wie kann ich dir bei Friseurbedarf helfen?';

export const DRKALLA_RAG_KB_CONFIG = {
  top_k: 3,
  filter_score: 0.6,
} as const;

export type DrkallaVariant = {
  id: number | string;
  title: string;
  price: string;
  compareAtPrice: string | null;
  available: boolean;
  sku: string | null;
};

export type DrkallaProduct = {
  id: number | string;
  title: string;
  handle: string;
  url: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  description: string;
  variants: DrkallaVariant[];
};

export type DrkallaProductVoiceName = {
  spokenName: string;
  searchAliases: string[];
};

export type DrkallaPageFact = {
  title: string;
  url: string;
  text: string;
};

export type DrkallaKnowledgeSnapshot = {
  scrapedAt: string;
  source: string;
  productCount: number;
  products: DrkallaProduct[];
  pages: DrkallaPageFact[];
  categories: string[];
  vendors: string[];
};

export const DRKALLA_RAG_PROMPT = `# Dr.Kalla Friseurbedarf Voice Agent

## Auftrag und Grenzen
- Dr.Kalla ist ein Berliner Friseurbedarf-, Haarpflege-, Farb-, Styling-, Parfuem- und Salonbedarf-Shop.
- Dr.Kalla ist kein Friseursalon: keine Salontermine, Haarschnitte oder Friseur-Dienstleistungen.
- Hilf bei Sortiment, Produkten, Kategorien, Marken, Anwendung, Nachbestellung, Profi-/Salonbedarf, Kontakt und Versand, soweit die KB das hergibt.
- Nutze zuerst die KB. Erfinde keine Produkte, Preise, Rabatte, Lagerbestaende, Lieferzeiten, Inhaltsstoffe, Anwendungsgarantien oder Profi-Zugaenge.
- Produktpreise: "laut aktuellem Shop-Datenstand" oder "ich sehe im Shop"; koennen sich aendern.
- Keine Diagnose/verbindliche Farbberatung; bei Risiko, Allergie, Brennen, Wunden, Haarausfall, Farbkorrektur oder Blondierung an persoenliche fachliche Pruefung verweisen.

## Voice/KB-Regeln
- Deutsch, knapp: meistens 1 bis 2 Saetze, danach genau eine konkrete Frage.
- Verwende am Telefon den KB-Wert "Sprachname"; lies keine SKU-Ketten, langen Farbcodes, Marketingtitel oder langen Produktlisten vor. Max. 3 Optionen.
- Wenn mehrere Produkte oder Varianten zum selben Sprachname passen, sage "Ich sehe mehrere Varianten" und frage nach Groesse, Prozentstaerke, Farbton, Duftart oder Preisbereich. Widersprich dir nicht mit einem Einzelpreis.
- Bei Kontakt-, Adresse-, Oeffnungszeiten- oder Besuchsfragen nutze die Kontakt-KB direkt.
- Lies im Voice-Call keine langen URLs vor; nenne maximal drkalla.com oder den kurzen Produktnamen. Wenn der Anrufer einen Link will, nutze das SMS-Link-Tool und behaupte Versand erst nach Tool-Erfolg.
- Wiederhole nicht denselben Satz. Bei mehreren Anliegen frage: "Welche Kategorie oder welches Produkt soll ich zuerst suchen?"

## Akustische Reparatur
- Wenn der letzte Nutzer-Turn "(inaudible speech)", leer, abgebrochen, nur Geraeusch oder unverstaendlich ist, tu nicht so, als haettest du etwas verstanden. Erstes Mal: "Wie bitte? Ich habe dich gerade schlecht verstanden. Suchst du ein Produkt, eine Kategorie oder Hilfe zu einer Bestellung?"
- Wenn du den Anrufer zweimal hintereinander schlecht verstehst, sage: "Sag bitte nur ein Stichwort: Produkt, Kategorie, Bestellung oder Kontakt." Beim dritten Mal: "Die Verbindung ist gerade schwer zu verstehen. Sag bitte etwas lauter ein Stichwort, zum Beispiel Produkt, Kategorie, Bestellung oder Kontakt."
- Antworte nicht mit "natuerlich", wenn vorher nichts Verstaendliches gesagt wurde.

## Typische Korrekturen
- Friseurtermin/Haarschnittpreis: "Dr.Kalla ist ein Friseurbedarf-Shop, kein Salon. Ich kann dir aber Produkte oder Salonbedarf aus dem Shop suchen."
- Konkretes Produkt: in der KB genau dieses Produkt oder nahe Varianten suchen.
- Wenn der Anrufer nach Profi-Login oder Profi-Preisen fragt, bestaetige das nur, wenn die KB eine konkrete Profi-Seite oder einen konkreten Hinweis liefert. Wenn nicht, verweise auf die Website oder den Kontakt.
- Bei Herren-, Damen- oder Unisex-Duft nicht ungefragt wechseln; bei ASR-Unsicherheit: "Meinst du einen Herrenduft, Damenduft oder Unisex?"
- Bei Entwickler/Oxidant/Wasserstoffperoxid immer Prozentstaerke und Groesse klaeren, wenn mehrere Shop-Varianten passen.
- Bei roten, kupfernen oder gefaerbten Haaren nicht automatisch Anti-Gelb empfehlen. Frage nach Farbschutz, Rot-/Kupferpflege oder Farbberatung.
- Nimm keine Bestellung oder Zahlung am Telefon auf. Fuer Kauf, Checkout und tagesaktuelle Verfuegbarkeit auf drkalla.com/Kontakt verweisen.

## Abschluss
- Am Ende kurz fragen: "Soll ich dir dazu noch eine Produktkategorie oder Kontaktmoeglichkeit nennen?"
- Lege nur auf, wenn der Anrufer sich klar verabschiedet, explizit "leg auf/beende den Anruf" sagt oder Retell nach echter langer Stille beendet. "(inaudible speech)" ist keine Stille.`;

function compact(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function truncate(input: string, max: number): string {
  const text = compact(input);
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

function priceRange(variants: DrkallaVariant[]): string {
  const prices = variants
    .map((variant) => Number(String(variant.price).replace(',', '.')))
    .filter((price) => Number.isFinite(price));
  if (!prices.length) return 'Preis nicht im Snapshot';
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const format = (value: number) => `${value.toFixed(2).replace('.', ',')} EUR`;
  return min === max ? format(min) : `von ${format(min)} bis ${format(max)}`;
}

function decodeCommonEntities(input: string): string {
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&ndash;|&mdash;/gi, '-')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

function normalizeForVoice(input: string): string {
  return compact(decodeCommonEntities(input)
    .replace(/[•]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\s*:\s*/g, ': ')
    .replace(/\s+/g, ' '));
}

function trimPunctuation(input: string): string {
  return compact(input.replace(/^[\s\-:,/|]+|[\s\-:,/|]+$/g, ''));
}

function trimDanglingSpokenWords(input: string): string {
  let text = trimPunctuation(input);
  for (let i = 0; i < 3; i += 1) {
    const next = trimPunctuation(text
      .replace(/\s+(?:und|mit|fuer|für|von|and|with|the|&)\s*$/i, '')
      .replace(/\s+[,x]\s*$/i, ''));
    if (next === text) break;
    text = next;
  }
  return text;
}

function removePackagingNoise(input: string): string {
  return compact(input
    .replace(/^kopie von\s+/i, '')
    .replace(/\([^)]*(?:ml|oz|spray|edp|eau de parfum|personal care|beauty)[^)]*\)/gi, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|g|kg|oz|l|liter|cm|m|mm|blatt|stk|stueck|stück)\b/gi, '')
    .replace(/\b(?:profi[-\s]?qualitaet|profi[-\s]?qualität|professionelle?s?|professioneller|profi|qualitaet|qualität|salonqualitaet|salonqualität|salonbedarf|friseurbedarf|fuer salon und zuhause|für salon und zuhause)\b/gi, '')
    .replace(/\s+-\s*/g, ' ')
    .replace(/\s+\|\s+/g, ' ')
    .replace(/\s{2,}/g, ' '));
}

function shortenHumanName(input: string, max = 64): string {
  const text = trimPunctuation(input);
  if (text.length <= max) return trimDanglingSpokenWords(text);
  const words = text.split(' ');
  let shortened = '';
  for (const word of words) {
    const candidate = shortened ? `${shortened} ${word}` : word;
    if (candidate.length > max) break;
    shortened = candidate;
  }
  return trimDanglingSpokenWords(shortened || text.slice(0, max));
}

function uniqueAliases(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const value of values) {
    const alias = trimPunctuation(normalizeForVoice(value ?? ''));
    if (!alias || alias.length < 2) continue;
    const key = alias.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  return aliases;
}

function handleAlias(handle: string): string {
  return trimPunctuation(handle
    .replace(/-/g, ' ')
    .replace(/\b(?:und|mit|fuer|fur|the|de|la)\b/gi, ' ')
    .replace(/\s+/g, ' '));
}

function perfumeSpokenName(title: string): string | null {
  if (!/(parfum|perfume|edp|eau de parfum|cologne|extrait)/i.test(title)) return null;
  if (/i am the queen/i.test(title)) return 'Ana Almalika I Am The Queen';
  const beforeFragranceWords = title
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+(?:eau de parfum|edp|cologne|extrait|perfume|parfum)\b/i)[0] ?? title;
  const beforeDash = beforeFragranceWords.split(/\s+-\s+/)[0] ?? beforeFragranceWords;
  return shortenHumanName(removePackagingNoise(beforeDash), 54);
}

function specialSpokenName(title: string): string | null {
  if (/alufolie/i.test(title)) return 'Alufolie 12 cm Rolle';
  if (/delrin\s*-?\s*kamm\s*4054/i.test(title)) return 'Delrin 4054 Seitenscheidekamm';
  if (/anti\s*-?\s*frizz.*shampoo/i.test(title)) return /oil/i.test(title) ? 'Anti-Frizz-Oil Shampoo' : 'Anti-Frizz Shampoo';
  if (/anti\s*-?\s*orange/i.test(title) && /maske/i.test(title)) return 'Anti-Orange Maske';
  if (/anti\s*-?\s*orange/i.test(title) && /shampoo/i.test(title)) return 'Anti-Orange Shampoo';
  if (/anti\s*-?\s*(yellow|gelb)/i.test(title) && /shampoo/i.test(title)) return /gelb/i.test(title) ? 'Anti-Gelb-Shampoo' : 'Anti-Yellow Shampoo';
  if (/anti\s*-?\s*(yellow|gelb)/i.test(title) && /maske/i.test(title)) return /gelb/i.test(title) ? 'Anti-Gelb-Maske' : 'Anti-Yellow Maske';
  if (/yellow\s*-?\s*stopp\s*-?\s*mousse/i.test(title)) return 'Yellow-Stopp-Mousse';
  if (/sintesis\s+color\s+cream/i.test(title)) return 'Sintesis Color Cream Haarfarbe';
  if (/emulgiertes\s+wasserstoffperoxid|wasserstoffperoxid|oxidant|entwickler/i.test(title)) {
    return 'Emulgiertes Wasserstoffperoxid';
  }
  if (/psn\s*\|?\s*essense\s+reparatur/i.test(title) && /maske/i.test(title)) return 'PSN Essence Reparatur Maske';
  if (/psn\s*\|?\s*essense\s+reparatur/i.test(title) && /shampoo/i.test(title)) return 'PSN Essence Reparatur Shampoo';
  if (/rouge\s*\|?\s*color\s+lock/i.test(title)) return /mask|maske/i.test(title) ? 'Rouge Color Lock Maske' : 'Rouge Color Lock';
  if (/turquoise\s*\|?\s*hydra\s+complex/i.test(title) && /maske/i.test(title)) return 'Turquoise Hydra Complex Maske';
  if (/turquoise\s*\|?\s*hydra\s+complex/i.test(title) && /shampoo/i.test(title)) return 'Turquoise Hydra Complex Shampoo';
  if (/ultrastark/i.test(title) && /mousse/i.test(title)) return 'Ultrastark Mousse';
  if (/ultrastark/i.test(title) && /gel/i.test(title)) return 'Ultrastark Gel';
  if (/ultrastark/i.test(title) && /haarspray/i.test(title)) return 'Ultrastark Haarspray';
  if (/dea\s+placenta|plazenta/i.test(title) && /haarausfall|haarwurzel|schwach|brüchig|bruechig/i.test(title)) return 'Plazenta Haarausfall-Ampullen';
  if (/haarfaerb|haarfärb|faerbeschale|färbeschale/i.test(title)) return 'Haarfaerbeschale';
  if (/infrared\s+keratin\s+pro/i.test(title)) return 'Sthauer Infrared Keratin Glaetteisen';
  if (/luxe[-\s]*oel|luxe[-\s]*öl/i.test(title) && /leave/i.test(title)) return 'Luxe-Oel Leave-in';
  if (/luxe[-\s]*oel|luxe[-\s]*öl/i.test(title) && /shampoo/i.test(title)) return 'Luxe-Oel Shampoo';
  if (/new\s+york\s+secret/i.test(title)) return 'New York Secret Salonwagen';
  if (/new\s+york\s+sky/i.test(title)) return 'New York Sky Salonwagen';
  if (/next\s+basic/i.test(title) && /salonwagen/i.test(title)) return 'Next Basic Salonwagen';
  if (/^next\b/i.test(title) && /salonwagen/i.test(title)) return 'Next Salonwagen';
  if (/omega\s+plus/i.test(title) && /wascheinheit/i.test(title)) return 'Omega Plus Wascheinheit';
  if (/class\s+confort/i.test(title) && /wascheinheit/i.test(title)) return 'Class Confort Wascheinheit';
  if (/tutor\s+black/i.test(title)) return 'Tutor Black Ablagetisch';
  if (/stehmatte/i.test(title)) return 'Halbkreis Stehmatte';
  if (/repair[-\s]?haarmaske/i.test(title)) return 'Repair-Haarmaske';
  if (/restrukturierende\s+maske/i.test(title)) return 'Restrukturierende Maske';
  if (/restrukturierendes\s+shampoo/i.test(title)) return 'Restrukturierendes Shampoo';
  if (/feuchtigkeitsspendende\s+maske/i.test(title)) return 'Feuchtigkeitsmaske fuer trockenes Haar';
  if (/plazenta\s+haar/i.test(title)) return 'Plazenta Haar-Ampullen';
  if (/london\s+easy/i.test(title) && /salonwagen/i.test(title)) return 'London Easy Salonwagen';
  if (/magnetico/i.test(title) && /salonwagen/i.test(title)) return 'Magnetico Salonwagen';
  if (/stahlrahmen/i.test(title) && /wasch/i.test(title)) return 'Stahlrahmen Ersatzteil fuer Wascheinheit';
  if (/shaver\s*3\s*pro/i.test(title)) return 'Sthauer Shaver 3 Pro';
  if (/astro\s+ionic/i.test(title)) return 'Sthauer Astro Ionic Haartrockner';
  if (/seidenprotein/i.test(title) && /spuelung|spülung/i.test(title)) return 'Seidenprotein Pflegespuelung';
  if (/regenerierende\s+haarmaske/i.test(title)) return 'Regenerierende Haarmaske';
  if (/blondierpulver/i.test(title)) return shortenHumanName(title.replace(/professionelle?s?/gi, '').replace(/bis zu.*$/i, ''), 54);
  if (/baobab/i.test(title) && /haarserum/i.test(title)) return 'Baobab Haarserum';
  return null;
}

function defaultSpokenName(product: DrkallaProduct): string {
  const title = normalizeForVoice(product.title).replace(/^kopie von\s+/i, '');
  const beforePipe = title.split(/\s+\|\s+/)[0] ?? title;
  const firstUsefulPart = beforePipe.split(/\s+-\s+/).find((part) => trimPunctuation(part).length >= 8) ?? beforePipe;
  const beforeColon = firstUsefulPart.split(':')[0] ?? firstUsefulPart;
  const cleaned = removePackagingNoise(beforeColon)
    .replace(/\b(?:intensive pflege|aus berlin|luxusduft|direkt zum inhalt)\b/gi, '')
    .replace(/\s{2,}/g, ' ');
  const fallback = product.productType && cleaned.length < 5
    ? `${cleaned} ${product.productType}`
    : cleaned;
  return shortenHumanName(fallback, 64);
}

function titleHasMaleFragranceSignal(title: string): boolean {
  return /\bfor men\b|\bmen\b|herrenduft|herrenparfum|\bherren\b|pour homme|\bhomme\b/i.test(title);
}

function titleHasFemaleFragranceSignal(title: string): boolean {
  return /\bfor women\b|\bwomen\b|damenduft|damenparfum|\bdamen\b|pour femme|\bfemme\b|i am the queen/i.test(title);
}

function productTypeAliases(product: DrkallaProduct, title: string): string[] {
  const type = product.productType ?? '';
  const aliases: string[] = [];
  if (/lattafa/i.test(`${product.vendor ?? ''} ${title} ${product.handle}`)) {
    aliases.push('Lattafa', 'Latafa', 'Lattaffa', 'Latasse');
  }
  if (/(?:eau de parfum|parfum|perfume|edp|cologne|extrait)\b/i.test(`${type} ${title}`)) {
    aliases.push('Parfum', 'Duft');
    if (titleHasMaleFragranceSignal(title)) aliases.push('Herrenduft', 'Herren Duft');
    if (titleHasFemaleFragranceSignal(title)) aliases.push('Damenduft', 'Damen Duft');
    if (/unisex/i.test(title)) aliases.push('Unisex Duft');
  }
  if (/haarfarbe|color cream|farb/i.test(`${type} ${title}`)) aliases.push('Haarfarbe', 'Farbcreme');
  if (/blond/i.test(`${type} ${title}`)) aliases.push('Blondierung', 'Blondierpulver');
  if (/wasserstoffperoxid|entwickler|oxidant/i.test(title)) aliases.push('Entwickler', 'Oxidant');
  if (/anti[-\s]?frizz/i.test(title)) aliases.push('Anti Frizz', 'Frizz Pflege');
  if (/anti[-\s]?(gelb|yellow)/i.test(title)) aliases.push('Anti Gelb', 'Silbershampoo');
  if (/anti[-\s]?orange/i.test(title)) aliases.push('Anti Orange');
  if (/kamm/i.test(title)) aliases.push('Kamm');
  return aliases;
}

function germanNumberWord(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(',', '.');
  const words: Record<string, string> = {
    '1.5': 'eins komma fuenf',
    '3': 'drei',
    '4.5': 'vier komma fuenf',
    '6': 'sechs',
    '9': 'neun',
    '12': 'zwoelf',
    '20': 'zwanzig',
    '30': 'dreissig',
    '40': 'vierzig',
  };
  return words[normalized] ?? null;
}

function variantAliases(variants: DrkallaVariant[]): string[] {
  const aliases: string[] = [];
  for (const variant of variants.slice(0, 24)) {
    const title = normalizeForVoice(variant.title);
    if (!title || /^default title$/i.test(title) || /^standard$/i.test(title)) continue;
    aliases.push(title);

    const volPercent = title.match(/(\d{1,2})\s*vol(?:ume)?[^0-9]*(\d{1,2}(?:[.,]\d+)?)\s*%/i);
    if (volPercent) {
      const vol = volPercent[1];
      const percent = volPercent[2]?.replace('.', ',');
      aliases.push(`${vol} Vol`, `${vol} Vol Entwickler`, `${percent} Prozent`, `${percent} Prozent Entwickler`);
      const spokenVol = germanNumberWord(vol);
      const spokenPercent = germanNumberWord(percent);
      if (spokenVol) aliases.push(`${spokenVol} Vol`, `${spokenVol} Vol Entwickler`);
      if (spokenPercent) aliases.push(`${spokenPercent} Prozent`, `${spokenPercent} Prozent Entwickler`);
    }
    const percentOnly = title.match(/(\d{1,2}(?:[.,]\d+)?)\s*%/);
    if (percentOnly) {
      const percent = percentOnly[1]?.replace('.', ',');
      aliases.push(`${percent} Prozent`, `${percent} Prozent Entwickler`);
      const spokenPercent = germanNumberWord(percent);
      if (spokenPercent) aliases.push(`${spokenPercent} Prozent`, `${spokenPercent} Prozent Entwickler`);
    }
    if (/^\d+(?:[.,]\d+)?\b/.test(title) && /sintesis|color|cream|haarfarbe/i.test(title)) {
      aliases.push(`Farbton ${title}`);
    }
  }
  return aliases;
}

export function buildDrkallaProductVoiceName(product: DrkallaProduct): DrkallaProductVoiceName {
  const title = normalizeForVoice(product.title);
  const spokenName = shortenHumanName(
    specialSpokenName(title)
      ?? perfumeSpokenName(title)
      ?? defaultSpokenName(product),
    54,
  );
  const aliases = uniqueAliases([
    spokenName,
    title,
    handleAlias(product.handle),
    product.productType,
    product.vendor && product.vendor !== 'Dr.Kalla Cosmetics' ? product.vendor : null,
    ...productTypeAliases(product, title),
    ...product.tags.slice(0, 10),
    ...variantAliases(product.variants),
  ]).slice(0, 28);

  return { spokenName, searchAliases: aliases };
}

export function drkallaSnapshotHash(snapshot: DrkallaKnowledgeSnapshot): string {
  const stable = JSON.stringify({
    source: snapshot.source,
    productCount: snapshot.productCount,
    products: snapshot.products.map((product) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      variants: product.variants.map((variant) => ({
        id: variant.id,
        title: variant.title,
        price: variant.price,
        available: variant.available,
        sku: variant.sku,
      })),
    })),
  });
  return crypto.createHash('sha256').update(stable).digest('hex').slice(0, 12);
}

export function formatDrkallaProductFact(product: DrkallaProduct): string {
  const voiceName = buildDrkallaProductVoiceName(product);
  const variantSummary = product.variants
    .slice(0, 12)
    .map((variant) => {
      const stock = variant.available ? 'verfuegbar' : 'nicht verfuegbar';
      const sku = variant.sku ? `, SKU ${variant.sku}` : '';
      const compare = variant.compareAtPrice ? `, Vergleichspreis ${variant.compareAtPrice} EUR` : '';
      return `${variant.title}: ${variant.price} EUR${compare}, ${stock}${sku}`;
    })
    .join(' | ');
  const tags = product.tags.slice(0, 16).join(', ');
  return [
    `Produkt: ${voiceName.spokenName}`,
    `Sprachname: ${voiceName.spokenName}`,
    `Menschliche Suchnamen: ${voiceName.searchAliases.join(', ')}`,
    `Original-Shop-Titel: ${product.title}`,
    `URL: ${product.url}`,
    product.vendor ? `Marke/Anbieter: ${product.vendor}` : '',
    product.productType ? `Kategorie: ${product.productType}` : '',
    tags ? `Tags: ${tags}` : '',
    `Preisbereich: ${priceRange(product.variants)}`,
    variantSummary ? `Varianten: ${variantSummary}` : '',
    product.description ? `Beschreibung: ${truncate(product.description, 900)}` : '',
  ].filter(Boolean).join('\n');
}

export function buildDrkallaKnowledgeTexts(snapshot: DrkallaKnowledgeSnapshot): Array<{ title: string; text: string }> {
  const hash = drkallaSnapshotHash(snapshot);
  const overview = [
    'Dr.Kalla Cosmetics - oeffentlicher Website-Snapshot',
    `Quelle: ${snapshot.source}`,
    `Scraped at: ${snapshot.scrapedAt}`,
    `Snapshot hash: ${hash}`,
    `Produktanzahl: ${snapshot.productCount}`,
    'Wichtige Regel: Dr.Kalla ist ein Friseurbedarf-Shop und kein Friseursalon.',
    'Keine Haarschnitt-, Farb- oder Salontermine anbieten.',
    snapshot.categories.length ? `Kategorien: ${snapshot.categories.join(', ')}` : '',
    snapshot.vendors.length ? `Marken/Anbieter: ${snapshot.vendors.join(', ')}` : '',
    'Kontakt laut oeffentlicher Website: Silbersteinstrasse 83, 12051 Berlin; kontakt@drkalla.com; Montag bis Freitag 10 bis 18 Uhr.',
    'Versandhinweis laut oeffentlicher Website: Versandinformationen werden im Checkout angezeigt; auf der Startseite wird kostenloser Versand ab 49 Euro genannt.',
  ].filter(Boolean).join('\n');

  const contact = [
    'Dr.Kalla Kontakt, Besuch und Oeffnungszeiten',
    'Diese Angaben sind fuer direkte Kontaktfragen, Adresse, Besuch und Oeffnungszeiten priorisiert.',
    'Dr.Kalla Cosmetics ist ein Friseurbedarf-Shop, kein Friseursalon.',
    'Adresse: Silbersteinstrasse 83, 12051 Berlin.',
    'Oeffnungszeiten: Montag bis Freitag von 10 bis 18 Uhr.',
    'E-Mail: kontakt@drkalla.com.',
    'Telefon und WhatsApp laut Kontaktseite: +49 30 62987736.',
    'Website: drkalla.com.',
    'Bei Unsicherheit zu tagesaktuellen Oeffnungszeiten oder Produktverfuegbarkeit an Kontakt oder Website verweisen.',
  ].join('\n');

  const texts: Array<{ title: string; text: string }> = [
    { title: `DrKalla Overview ${hash}`, text: overview },
    { title: `DrKalla Kontakt ${hash}`, text: contact },
  ];

  for (const page of snapshot.pages) {
    if (!page.text.trim()) continue;
    texts.push({
      title: `DrKalla Page - ${truncate(page.title, 80)}`,
      text: [`Seite: ${page.title}`, `URL: ${page.url}`, truncate(page.text, 4500)].join('\n'),
    });
  }

  const chunkSize = 45;
  for (let i = 0; i < snapshot.products.length; i += chunkSize) {
    const products = snapshot.products.slice(i, i + chunkSize);
    texts.push({
      title: `DrKalla Products ${i + 1}-${i + products.length} ${hash}`,
      text: products.map(formatDrkallaProductFact).join('\n\n---\n\n'),
    });
  }

  return texts;
}
