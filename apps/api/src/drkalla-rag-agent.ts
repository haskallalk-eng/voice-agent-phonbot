import crypto from 'node:crypto';

export const DRKALLA_SITE_ORIGIN = 'https://drkalla.com';
export const DRKALLA_SHOP_DISPLAY_NAME = 'Dr.Kalla Cosmetics';
export const DRKALLA_SHOP_DOMAIN = 'drkalla.com';
export const DRKALLA_PROFI_ACCESS_URL = 'https://drkalla.com/pages/als-friseur-registrieren';
export const DRKALLA_RAG_AGENT_NAME = 'DrKalla RAG Voice Agent';
export const DRKALLA_RAG_KB_NAME_PREFIX = 'DrKalla KB';
export const DRKALLA_RAG_KB_SCHEMA_VERSION = 'c3u';
export const DRKALLA_RAG_BEGIN_MESSAGE =
  'Hallo, hier ist der Dr. Kalla Assistent. Wie kann ich dir bei Friseurbedarf helfen?';

export const DRKALLA_RAG_KB_CONFIG = {
  top_k: 3,
  filter_score: 0.6,
} as const;

export const DRKALLA_RAG_PROMPT_MAX_CHARS = 3200;

export const DRKALLA_RAG_PROMPT_REQUIRED_ANCHORS = [
  'kein Friseursalon',
  'Erfinde keine Produkte',
  'Sprachname',
  'SMS-Link-Tool',
  'Akustische Reparatur',
  'Profi-Login',
  'Nimm keine Bestellung oder Zahlung',
  'Lege nur auf',
  '(inaudible speech)',
] as const;

export type DrkallaVariant = {
  id: number | string;
  title: string;
  price: string;
  compareAtPrice: string | null;
  available: boolean;
  sku: string | null;
};

export type DrkallaProductImage = {
  src: string;
  alt: string | null;
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
  images?: DrkallaProductImage[];
};

export type DrkallaProductVoiceName = {
  spokenName: string;
  searchAliases: string[];
};

export type DrkallaProductCatalogEntry = {
  productId: string;
  spokenName: string;
  websiteTitle: string;
  productKind: string;
  externalBrand: string | null;
  brandName: string;
  brandSource: 'external_brand' | 'house_brand';
  shopName: string;
  shopProvider: string | null;
  productLine: string | null;
  priceRange: string;
  variantCount: number;
  availableVariantCount: number;
  url: string;
  imageCount: number;
  imageAltTexts: string[];
  searchAliases: string[];
  description: string | null;
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

export const DRKALLA_RAG_PROMPT_BASELINE = `# Dr.Kalla Friseurbedarf Voice Agent

## Auftrag und Grenzen
- Dr.Kalla ist ein Berliner Friseurbedarf-Shop und Salonbedarf-Shop für Haarpflege, Farbe, Styling.
- Dr.Kalla ist kein Friseursalon: keine Salontermine, Haarschnitte.
- Sprich als Dr.Kalla-Team: "unser Shop". Vermeide Formulierungen wie "ich suche im Shop".
- Nutze zuerst die KB. Erfinde keine Produkte, Preise, Bestände, Lieferzeiten, Garantien/Profi-Zugänge.
- Produktpreise: "laut aktuellem Shop-Datenstand"; sie können sich ändern (koennen sich aendern).
- Keine Diagnose/verbindliche Farbberatung; bei Risiko, Allergie, Wunden, Haarausfall, Farbkorrektur/Blondierung an Fachprüfung verweisen.

## Voice/KB-Regeln
- Deutsch knapp: 1-2 Sätze, gesprochen mit ä, ö, ü, ß statt ae/oe/ue/ss; danach genau eine Frage.
- Verwende am Telefon den KB-Wert "Sprachname"; keine SKU-Ketten, Farbcodes oder langen Listen. Max. 3 Optionen.
- Wenn mehrere Produkte/Varianten zum selben Sprachname passen, sage "Ich sehe mehrere Varianten" und frage nach Größe, Prozentstärke, Farbton, Duftart oder Preisbereich. Widersprich dir nicht mit einem Einzelpreis.
- Bei Kontakt-, Adresse-, Öffnungszeiten- oder Besuchsfragen nutze die Kontakt-KB direkt: Adresse, Zeiten, E-Mail, Anfahrt nennen.
- Wenn nur nach E-Mail gefragt wird, nenne direkt kontakt at drkalla punkt com; nie "c om" oder falsche ASR-Adresse.
- Lies im Voice-Call keine langen URLs vor; nenne maximal drkalla.com oder den kurzen Produktnamen. Bei explizitem Link-/SMS-Wunsch nutze das SMS-Link-Tool; nicht bei "nenn mir", nicht nach unverständlichem Input, nicht doppelt; behaupte Versand erst nach Tool-Erfolg.
- Wiederhole nicht denselben Satz. Kontaktfacts nur einmal pro Antwort nennen. Wenn du Adresse, Telefon oder E-Mail gerade genannt hast, nicht wiederholen. Bei mehreren Anliegen: "Welche Kategorie oder welches Produkt zuerst?"

## Akustische Reparatur
- Wenn der letzte Nutzer-Turn "(inaudible speech)", leer, abgebrochen, nur Geräusch oder unverständlich ist, tu nicht so, als hättest du verstanden. Erstes Mal: "Wie bitte? Ich habe dich gerade schlecht verstanden."
- Wenn du den Anrufer zweimal hintereinander schlecht verstehst: bleibe im letzten klaren Thema. Frage gezielt nach: aktive Produktart, Marke oder Produkt, z.B. "Ich habe dich akustisch nicht verstanden. Bleiben wir bei der Haarfarbe?" Nur ohne klaren Kontext: "Geht es um ein Produkt, eine Bestellung oder Kontakt?" Beim dritten Mal: "Die Verbindung ist gerade schwer zu verstehen. Sag bitte etwas lauter."
- Antworte nicht mit "natuerlich". Antworte nicht mit "natürlich", wenn vorher nichts Verständliches gesagt wurde.

## Typische Korrekturen
- Friseurtermin/Haarschnittpreis: "Dr.Kalla ist ein Friseurbedarf-Shop, kein Salon. Ich kann dir aber Produkte oder Salonbedarf aus dem Shop suchen."
- Konkretes Produkt: in der KB genau dieses Produkt oder nahe Varianten nutzen.
- Wenn der Anrufer nach Profi-Login oder Profi-Preisen fragt, bestätige das nur, wenn die KB eine konkrete Profi-Seite oder einen konkreten Hinweis liefert. Wenn nicht, verweise auf Website/Kontakt.
- Bei Herren-, Damen- oder Unisex-Duft nicht ungefragt wechseln; bei ASR-Unsicherheit: "Meinst du einen Herrenduft, Damenduft oder Unisex?"
- Bei Entwickler/Oxidant/Wasserstoffperoxid immer Prozentstärke und Größe klären, wenn mehrere Shop-Varianten passen.
- Bei roten, kupfernen oder gefärbten Haaren nicht automatisch Anti-Gelb empfehlen. Frage nach Farbschutz, Rot-/Kupferpflege oder Farbberatung.
- Nimm keine Bestellung oder Zahlung am Telefon auf. Für Kauf, Checkout und tagesaktuelle Verfügbarkeit auf drkalla.com/Kontakt verweisen.

## Abschluss
- Am Ende kurz fragen: "Soll ich dir dazu noch eine Produktkategorie oder Kontaktmöglichkeit nennen?"
- Lege nur auf, wenn der Anrufer sich klar verabschiedet, explizit "leg auf/beende den Anruf" sagt oder Retell nach echter langer Stille beendet. "(inaudible speech)" ist keine Stille.`;

export const DRKALLA_RAG_PROMPT = `- Friseurbedarf, Salonbedarf-Shop;Dr.Kalla ist kein Friseursalon: keine Salontermine, Haarschnitte. Sprich als Dr.Kalla-Team: "unser Shop";vermeide "ich suche im Shop". "Doktor Color Punkt com";"d r k a l l a Punkt com";nie Drückalla.
- Nutze zuerst die KB. Erfinde keine Produkte/Preise. Produktpreise koennen sich aendern. Keine Diagnose/verbindliche Farbberatung.
- Deutsch knapp, gesprochen mit ä, ö, ü, ß;1 Frage. Sprachname;keine SKU-Ketten.
- Wenn mehrere Produkte/Varianten zum selben Sprachname passen: Größe/Stärke/Farbton/Duft/Preis klären. Widersprich dir nicht mit einem Einzelpreis.
- Kontakt/Adresse/Öffnungszeiten/Besuch: Kontakt-KB direkt; nie "keine Adresse". Kontaktfacts nur einmal pro Antwort nennen; Adresse/Telefon/E-Mail nur bei Nachfrage; Öffnungszeiten direkt nennen: Montag bis Freitag 10 bis 18 Uhr; E-Mail: kontakt at drkalla punkt com.
- Lies im Voice-Call keine langen URLs vor; keine Linklisten vorlesen; nenne maximal drkalla.com. SMS-Link-Tool; behaupte Versand erst nach Tool-Erfolg.
- Produkt-Funnel: aktives Produkt => keine Kategorie/Kontakt-Schleife; nächster Schritt Produktlink/Verfügbarkeit/Vergleich. aktive Produktart => Marken/Auswahl nennen; nicht nach einzelner Marke fragen; keine Pflege-/Sibling-Kategorien. Sortiment/Lieferant/viele Varianten => nicht auf einzelne Variante bohren. Kein Shoplink, wenn Produkt-URL bekannt. Kategorie nur ohne Produkt/Ziel. Produktfacts nicht wiederholen; Preis-Evidence halten, nicht erst "fehlt", dann "doch". Bei "Unterschied?" zuletzt genannte Produkte vergleichen, Serum vs. Leave-in; nicht auf Kategorie-Ebene springen; Produktlink anbieten.
- Paketshop oder Dr.Kalla Cosmetics? Paketshop: Öffnungszeiten nennen; keine Produktkategorie.
Akustische Reparatur:
- Bei "(inaudible speech)" oder nur Geräusch: nicht raten/auflegen. Erstes Mal: "Wie bitte? Ich habe dich gerade schlecht verstanden."
- 2x schlecht: bleibe im letzten klaren Thema; aktive Produktart, Marke oder Produkt: "akustisch schwer. Bleiben wir bei ...?" Nur ohne klaren Kontext: "Produkt/Bestellung/Kontakt?" Beim dritten Mal: "Die Verbindung ist gerade schwer zu verstehen. Bitte lauter." Antworte nicht mit "natürlich"/"natuerlich".
- Salontermin: kein Salon.
- Profi-Login/Profi-Preise: Profi-Zugang existiert;Friseure können Profi-Preise anfragen;Gewerbe-/Steuernachweis;nicht mit Entwicklerpreisen beantworten. Profi-Frage => Profi-Link per SMS anbieten; wenn gesendet, sagen;nie URL vorlesen. Kontaktlink nur bei Kontaktfragen. Keine Konditionen/Rabatte/Freischaltung erfinden.
- Preisfrage ausser Parfum: 1x sagen "Preis fuer normale Kaeufer; Profi-Friseurpreise telefonisch nicht; Profi-Zugang registrieren." Dann: "Produktlink oder Profi-Zugang per SMS?" Danach Profi-Hinweis nicht wiederholen.
- Bei Herren-, Damen- oder Unisex-Duft nicht wechseln. Entwickler/Oxidant/Wasserstoffperoxid: Prozentstärke und Größe klären. roten/kupfernen/gefärbten Haaren nicht automatisch Anti-Gelb empfehlen; Farbschutz/Rot-/Kupferpflege.
- Nimm keine Bestellung oder Zahlung am Telefon auf.
- Lege nur auf bei "tschüss/auf Wiederhören", "leg auf/beende den Anruf" oder langer Stille; nie bei "(inaudible speech)", "alles klar", Korrekturen/Fragen.`;

export const DRKALLA_RAG_PROMPT_COMPACT_CANDIDATE = DRKALLA_RAG_PROMPT;

export function evaluateDrkallaPromptCompression(prompt: string): {
  passed: boolean;
  length: number;
  maxChars: number;
  missingAnchors: string[];
} {
  const missingAnchors = DRKALLA_RAG_PROMPT_REQUIRED_ANCHORS.filter((anchor) => !prompt.includes(anchor));
  return {
    passed: prompt.length <= DRKALLA_RAG_PROMPT_MAX_CHARS && missingAnchors.length === 0,
    length: prompt.length,
    maxChars: DRKALLA_RAG_PROMPT_MAX_CHARS,
    missingAnchors,
  };
}

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
  if (/faerbeschale|färbeschale/i.test(title)) return 'Haarfärbeschale';
  if (/infrared\s+keratin\s+pro/i.test(title)) return 'Sthauer Infrared Keratin Glätteisen';
  if (/luxe[-\s]*oel|luxe[-\s]*öl/i.test(title) && /leave/i.test(title)) return 'Luxe-Öl Leave-in';
  if (/luxe[-\s]*oel|luxe[-\s]*öl/i.test(title) && /shampoo/i.test(title)) return 'Luxe-Öl Shampoo';
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
  if (/feuchtigkeitsspendende\s+maske/i.test(title)) return 'Feuchtigkeitsmaske für trockenes Haar';
  if (/plazenta\s+haar/i.test(title)) return 'Plazenta Haar-Ampullen';
  if (/london\s+easy/i.test(title) && /salonwagen/i.test(title)) return 'London Easy Salonwagen';
  if (/magnetico/i.test(title) && /salonwagen/i.test(title)) return 'Magnetico Salonwagen';
  if (/stahlrahmen/i.test(title) && /wasch/i.test(title)) return 'Stahlrahmen Ersatzteil für Wascheinheit';
  if (/shaver\s*3\s*pro/i.test(title)) return 'Sthauer Shaver 3 Pro';
  if (/astro\s+ionic/i.test(title)) return 'Sthauer Astro Ionic Haartrockner';
  if (/seidenprotein/i.test(title) && /spuelung|spülung/i.test(title)) return 'Seidenprotein Pflegespülung';
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
  if (/l[''`´’]?\s*or[eé]al|loreal|or[eé]al|inoa/i.test(`${product.vendor ?? ''} ${title} ${product.handle}`)) {
    aliases.push(
      "L'Oréal",
      "L'Oreal",
      'Loreal',
      'Lorian',
      'Lorial',
      'Loyal',
      "L'Orient",
      'Lorient',
      "L'Oréal Haarfarbe",
      "L'Oreal Haarfarbe",
    );
  }
  if (/lattafa/i.test(`${product.vendor ?? ''} ${title} ${product.handle}`)) {
    aliases.push('Lattafa', 'Latafa', 'Lattaffa', 'Latasse');
  }
  if (/\bwella\b|koleston\s+perfect/i.test(`${product.vendor ?? ''} ${title} ${product.handle}`)) {
    aliases.push('Wella', 'Vella', 'Koleston', 'Koleston Perfect', 'Wella Haarfarbe');
  }
  if (/\bschwarzkopf\b/i.test(`${product.vendor ?? ''} ${title} ${product.handle}`)) {
    aliases.push('Schwarzkopf');
  }
  if (/(?:eau de parfum|parfum|perfume|edp|cologne|extrait)\b/i.test(`${type} ${title}`)) {
    aliases.push('Parfum', 'Duft');
    if (titleHasMaleFragranceSignal(title)) aliases.push('Herrenduft', 'Herren Duft');
    if (titleHasFemaleFragranceSignal(title)) aliases.push('Damenduft', 'Damen Duft');
    if (/unisex/i.test(title)) aliases.push('Unisex Duft');
  }
  if (/haarfarbe|haarf[aä]rb|color cream|farb/i.test(`${type} ${title}`)) aliases.push('Haarfarbe', 'Farbcreme');
  if (/blond/i.test(`${type} ${title}`)) aliases.push('Blondierung', 'Blondierpulver');
  if (/wasserstoffperoxid|entwickler|oxidant/i.test(title)) aliases.push('Entwickler', 'Oxidant');
  if (/anti[-\s]?frizz/i.test(title)) aliases.push('Anti Frizz', 'Frizz Pflege');
  if (/anti[-\s]?(gelb|yellow)/i.test(title)) aliases.push('Anti Gelb', 'Silbershampoo');
  if (/anti[-\s]?orange/i.test(title)) aliases.push('Anti Orange');
  if (/kamm/i.test(title)) aliases.push('Kamm');
  return aliases;
}

function isShopProvider(value: string | null | undefined): boolean {
  return /^(?:dr\.?\s*kalla\s+cosmetics|cj\s+dropshipping)$/i.test(value?.trim() ?? '');
}

function knownExternalBrandFromText(input: string): string | null {
  if (/l[''`Â´â€™]?\s*or[eÃ©]al|loreal|\bor[eÃ©]al\b|inoa/i.test(input)) return "L'Oreal Professionnel Paris";
  if (/\bwella\b|koleston\s+perfect/i.test(input)) return 'Wella';
  if (/\bschwarzkopf\b/i.test(input)) return 'Schwarzkopf';
  if (/\blattafa\b/i.test(input)) return 'Lattafa';
  return null;
}

function externalBrand(product: DrkallaProduct): string | null {
  const vendor = product.vendor?.trim() ?? '';
  if (vendor && !isShopProvider(vendor)) return vendor;
  return knownExternalBrandFromText(`${product.title} ${product.handle}`);
}

function customerFacingBrand(product: DrkallaProduct): { brandName: string; brandSource: 'external_brand' | 'house_brand' } {
  const brand = externalBrand(product);
  return brand
    ? { brandName: brand, brandSource: 'external_brand' }
    : { brandName: DRKALLA_SHOP_DISPLAY_NAME, brandSource: 'house_brand' };
}

function productLineFromTitle(title: string): string | null {
  const normalized = normalizeForVoice(title);
  const knownLines = [
    /Koleston\s+Perfect/i,
    /L[''`´’]?\s*Or[eé]al(?:\s+Professionnel)?/i,
    /Sintesis(?:\s+Color\s+Cream)?/i,
    /PSN(?:\s+Essense)?/i,
    /Rouge\s+Color\s+Lock/i,
    /Turquoise\s+Hydra\s+Complex/i,
    /Black\s+Professional\s+Line/i,
    /Evelon\s+Pro/i,
    /Xanitalia/i,
    /Lattafa/i,
    /Sthauer/i,
  ];
  for (const pattern of knownLines) {
    const match = normalized.match(pattern);
    if (match?.[0]) return trimPunctuation(match[0]);
  }
  return null;
}

function canonicalProductKind(product: DrkallaProduct): string {
  const title = normalizeForVoice(product.title);
  const type = normalizeForVoice(product.productType ?? '');
  const haystack = `${type} ${title} ${product.tags.join(' ')}`;
  if (/farbentfernung|farbentfernungs|farbentferner|farbentfernungst/i.test(title)) return 'Farbentferner';
  if (/leinsamenkristalle/i.test(title)) return 'Serum';
  if (/gl.*ttungscreme|gl.*ttung|neutralisierendes\s+fixiermittel/i.test(title)) return 'Haargl\u00e4ttung';
  if (/farbkarte/i.test(title)) return 'Farbkarte';
  if (/koleston\s+perfect/i.test(title)) return 'Haarfarbe/Farbcreme';
  if (/bleichpulver|aufhellendes\s+bleichpulver/i.test(haystack)) return 'Blondierung';
  if (/ginseng|genseng|trockenes\s+und\s+lebloses\s+haar/i.test(title)) return 'Haarpflege';
  if (/shampoo/i.test(title)) return 'Shampoo';
  if (/conditioner|sp[üu]lung/i.test(title)) return 'Conditioner/Spülung';
  if (/maske|haarmaske/i.test(title)) return 'Haarmaske';
  if (/leave[-\s]?in/i.test(title)) return 'Leave-in';
  if (/serum|haarserum|leinsamenkristalle/i.test(title)) return 'Serum';
  if (/farbentfernung|farbentfernungs|farbentferner|farbentfernungst[Ã¼u]cher/i.test(title)) return 'Farbentferner';
  if (/gl[Ã¤a]ttungscreme|gl[Ã¤a]ttung|neutralisierendes\s+fixiermittel/i.test(title)) return 'HaarglÃ¤ttung';
  if (/farbkarte/i.test(title)) return 'Farbkarte';
  if (/entwickler|oxidant|wasserstoffperoxid/i.test(haystack)) return 'Entwickler/Oxidant';
  if (
    /haarfarbe\b|haarf[aä]rbemittel|farbcreme|color cream|inoa|sintesis\s+color\s+cream|synthesis\s+color\s+cream/i.test(title)
    || /haarf[aä]rbemittel|color cream/i.test(type)
  ) return 'Haarfarbe/Farbcreme';
  if (/blondier/i.test(haystack)) return 'Blondierung';
  if (/eau de parfum|parfum|perfume|edp|cologne|extrait|\bduft\b/i.test(haystack)) return 'Duft/Parfum';
  if (/kamm/i.test(haystack)) return 'Kamm';
  if (/haarspray|mousse|gel\b/i.test(haystack)) return 'Styling';
  if (/salonwagen|wascheinheit|stuhl|matte|ablage|m[oö]bel/i.test(haystack)) return 'Salonmöbel/-ausstattung';
  return type || 'Sonstiges Produkt';
}

function germanNumberWord(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(',', '.');
  const words: Record<string, string> = {
    '1.5': 'eins komma fünf',
    '3': 'drei',
    '4.5': 'vier komma fünf',
    '6': 'sechs',
    '9': 'neun',
    '12': 'zwölf',
    '20': 'zwanzig',
    '30': 'dreißig',
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

export function buildDrkallaProductCatalogEntries(snapshot: DrkallaKnowledgeSnapshot): DrkallaProductCatalogEntry[] {
  return snapshot.products.map((product) => {
    const voiceName = buildDrkallaProductVoiceName(product);
    const brand = customerFacingBrand(product);
    const imageAltTexts = uniqueAliases([
      ...(product.images ?? []).map((image) => image.alt),
      product.images?.length ? `Produktbild: ${voiceName.spokenName}` : null,
    ]).slice(0, 5);
    return {
      productId: String(product.id),
      spokenName: voiceName.spokenName,
      websiteTitle: product.title,
      productKind: canonicalProductKind(product),
      externalBrand: externalBrand(product),
      brandName: brand.brandName,
      brandSource: brand.brandSource,
      shopName: DRKALLA_SHOP_DISPLAY_NAME,
      shopProvider: product.vendor?.trim() || null,
      productLine: productLineFromTitle(product.title),
      priceRange: priceRange(product.variants),
      variantCount: product.variants.length,
      availableVariantCount: product.variants.filter((variant) => variant.available).length,
      url: product.url,
      imageCount: product.images?.length ?? 0,
      imageAltTexts,
      searchAliases: voiceName.searchAliases,
      description: product.description ? truncate(product.description, 320) : null,
    };
  });
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

function formatDrkallaStructuredProductCatalog(snapshot: DrkallaKnowledgeSnapshot, hash: string): { title: string; text: string } {
  const entries = buildDrkallaProductCatalogEntries(snapshot);
  const byKind = new Map<string, DrkallaProductCatalogEntry[]>();
  for (const entry of entries) {
    const list = byKind.get(entry.productKind) ?? [];
    list.push(entry);
    byKind.set(entry.productKind, list);
  }

  const kindLines = [...byKind.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'de'))
    .map(([kind, products]) => {
      const externalBrands = uniqueAliases(products.map((product) => product.externalBrand));
      const customerBrands = uniqueAliases(products.map((product) => product.brandName))
        .sort((a, b) => {
          if (a === DRKALLA_SHOP_DISPLAY_NAME) return -1;
          if (b === DRKALLA_SHOP_DISPLAY_NAME) return 1;
          return a.localeCompare(b, 'de');
        });
      const houseBrandCount = products.filter((product) => product.brandSource === 'house_brand').length;
      const productLines = uniqueAliases(products.map((product) => product.productLine)).slice(0, 8);
      const prices = products
        .flatMap((product) => product.priceRange.match(/\d+,\d{2}/g) ?? [])
        .map((value) => Number(value.replace(',', '.')))
        .filter((value) => Number.isFinite(value));
      const priceSummary = prices.length
        ? `von ${Math.min(...prices).toFixed(2).replace('.', ',')} EUR bis ${Math.max(...prices).toFixed(2).replace('.', ',')} EUR`
        : 'Preis nicht im Snapshot';
      const examples = products
        .slice(0, 4)
        .map((product) => `${product.spokenName} (${product.priceRange})`)
        .join(', ');
      return [
        `- Produktart: ${kind}`,
        `  Anzahl: ${products.length}`,
        `  Shop: ${DRKALLA_SHOP_DISPLAY_NAME} / ${DRKALLA_SHOP_DOMAIN}`,
        `  Marken: ${customerBrands.join(', ')}`,
        externalBrands.length ? `  Externe Marken: ${externalBrands.join(', ')}` : '',
        houseBrandCount ? `  Hausmarke/Shopmarke: ${DRKALLA_SHOP_DISPLAY_NAME} fuer ${houseBrandCount} Produkte ohne erkennbare externe Marke.` : '',
        productLines.length ? `  Produktlinien/Suchnamen: ${productLines.join(', ')}` : '',
        `  Preisbereich: ${priceSummary}`,
        examples ? `  Beispiele: ${examples}` : '',
      ].filter(Boolean).join('\n');
    });

  return {
    title: `DrKalla Strukturierter Produktkatalog ${hash}`,
    text: [
      'Dr.Kalla strukturierter Produktkatalog fuer RAG',
      `Shop: ${DRKALLA_SHOP_DISPLAY_NAME} / ${DRKALLA_SHOP_DOMAIN}`,
      'Zweck: Produktart, kundenverstaendliche Marke, externe Marke, Hausmarke, Produktlinie, Preisbereich, Varianten, Link und Beschreibung getrennt halten.',
      `Regel: ${DRKALLA_SHOP_DISPLAY_NAME} ist Shop und Hausmarke. Wenn keine externe Marke erkennbar ist, ist die kundenverstaendliche Marke ${DRKALLA_SHOP_DISPLAY_NAME}.`,
      'Regel: Technische Lieferanten- oder Importlabels wie CJ Dropshipping nicht als Kundenmarke nennen.',
      'Bei "Welche Marken habt ihr?" im Kontext einer Produktart die Marken dieser Produktart nennen: externe Marken plus Dr.Kalla Cosmetics als Hausmarke, falls Produkte ohne externe Marke dabei sind.',
      'Bei "Haarfarben-Marken" heisst das: Haarfarben-Marken aus der Produktart Haarfarbe/Farbcreme nennen; Produktlinien getrennt als Suchnamen/Serien nennen.',
      'Wenn ein Anrufer Lorian, Lorial, Loyal, L Orient, Lorient oder Loreal sagt, ist wahrscheinlich L Oréal gemeint.',
      'Bei aktivem konkretem Produkt den Produktlink aus der Produkt-KB verwenden; nicht stattdessen die Shop-Startseite senden.',
      ...kindLines,
    ].join('\n'),
  };
}

export function formatDrkallaProductFact(product: DrkallaProduct): string {
  const voiceName = buildDrkallaProductVoiceName(product);
  const brand = customerFacingBrand(product);
  const imageAltTexts = uniqueAliases((product.images ?? []).map((image) => image.alt)).slice(0, 5);
  const generatedImageHint = product.images?.length ? `Produktbild: ${voiceName.spokenName}` : null;
  const variantSummary = product.variants
    .slice(0, 12)
    .map((variant) => {
      const stock = variant.available ? 'verfügbar' : 'nicht verfügbar';
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
    `Produktart: ${canonicalProductKind(product)}`,
    `Shop: ${DRKALLA_SHOP_DISPLAY_NAME} / ${DRKALLA_SHOP_DOMAIN}`,
    `Marke: ${brand.brandName}${brand.brandSource === 'house_brand' ? ' (Hausmarke/Shopmarke)' : ' (externe Marke)'}`,
    externalBrand(product) ? `Externe Marke: ${externalBrand(product)}` : '',
    product.vendor && !isShopProvider(product.vendor) ? `Technischer Anbieter/Vendor aus Shopdaten: ${product.vendor}` : '',
    productLineFromTitle(product.title) ? `Produktlinie/Suchname: ${productLineFromTitle(product.title)}` : '',
    product.productType ? `Shop-Kategorie: ${product.productType}` : '',
    product.images?.length ? `Bilddaten: ${product.images.length} Bilder${imageAltTexts.length ? `; Alt-Texte: ${imageAltTexts.join(', ')}` : `; Bildhinweis: ${generatedImageHint}`}` : '',
    tags ? `Tags: ${tags}` : '',
    `Preisbereich: ${priceRange(product.variants)}`,
    variantSummary ? `Varianten: ${variantSummary}` : '',
    product.description ? `Beschreibung: ${truncate(product.description, 900)}` : '',
  ].filter(Boolean).join('\n');
}

export function buildDrkallaKnowledgeTexts(snapshot: DrkallaKnowledgeSnapshot): Array<{ title: string; text: string }> {
  const hash = drkallaSnapshotHash(snapshot);
  const overview = [
    'Dr.Kalla Cosmetics - öffentlicher Website-Snapshot',
    `Quelle: ${snapshot.source}`,
    `Scraped at: ${snapshot.scrapedAt}`,
    `Snapshot hash: ${hash}`,
    `Produktanzahl: ${snapshot.productCount}`,
    'Wichtige Regel: Dr.Kalla ist ein Friseurbedarf-Shop und kein Friseursalon.',
    'Keine Haarschnitt-, Farb- oder Salontermine anbieten.',
    snapshot.categories.length ? `Kategorien: ${snapshot.categories.join(', ')}` : '',
    snapshot.vendors.length ? `Marken/Anbieter: ${snapshot.vendors.join(', ')}` : '',
    'Kontakt laut öffentlicher Website: Silbersteinstraße 83, 12051 Berlin; kontakt@drkalla.com; E-Mail gesprochen: kontakt at drkalla punkt com; Montag bis Freitag 10 bis 18 Uhr.',
    `Profi-Link laut Website: ${DRKALLA_PROFI_ACCESS_URL}; fuer Friseure, Studios und gewerbliche Einkaeufer zur Registrierung/Anfrage.`,
    'Versandhinweis laut oeffentlicher Website: Versandinformationen werden im Checkout angezeigt; auf der Startseite wird kostenloser Versand ab 49 Euro genannt.',
    `Profi-Zugang laut oeffentlicher Website: Friseure/gewerbliche Einkaeufer koennen Profi-Preise anfragen; Profi-Link ${DRKALLA_PROFI_ACCESS_URL}; fuer Freischaltung kann ein Gewerbe- oder Steuernachweis noetig sein. Exakte Rabatte nicht erfinden.`,
  ].filter(Boolean).join('\n');

  const contact = [
    'Dr.Kalla Kontakt, Besuch und Öffnungszeiten',
    'Diese Angaben sind für direkte Kontaktfragen, Adresse, Besuch und Öffnungszeiten priorisiert.',
    'Dr.Kalla Cosmetics ist ein Friseurbedarf-Shop, kein Friseursalon.',
    'Adresse: Silbersteinstraße 83, 12051 Berlin.',
    'Öffnungszeiten: Montag bis Freitag von 10 bis 18 Uhr.',
    'E-Mail geschrieben: kontakt@drkalla.com.',
    'E-Mail gesprochen: kontakt at drkalla punkt com.',
    'Telefon und WhatsApp laut Kontaktseite: +49 30 62987736.',
    'Website: drkalla.com.',
    `Profi-Zugang: Profi-Preise koennen angefragt werden; Link ${DRKALLA_PROFI_ACCESS_URL}; fuer Friseure/gewerbliche Einkaeufer kann ein Gewerbe- oder Steuernachweis noetig sein. Keine Rabatte oder Freischaltung als sicher behaupten.`,
    'Anfahrt grob: Dr.Kalla liegt in Berlin-Neukölln nahe S+U Hermannstraße/Silbersteinstraße; von Hermannplatz ist die U8 Richtung Hermannstraße naheliegend. Genaue Verbindung tagesaktuell mit BVG oder Maps prüfen.',
    'Bei Unsicherheit zu tagesaktuellen Öffnungszeiten oder Produktverfügbarkeit an Kontakt oder Website verweisen.',
  ].join('\n');

  const texts: Array<{ title: string; text: string }> = [
    { title: `DrKalla Overview ${hash}`, text: overview },
    { title: `DrKalla Kontakt ${hash}`, text: contact },
  ];
  texts.push(formatDrkallaStructuredProductCatalog(snapshot, hash));

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
