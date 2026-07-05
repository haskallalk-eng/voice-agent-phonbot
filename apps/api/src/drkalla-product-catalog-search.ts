/**
 * Deterministic category/need search over the DrKalla catalog snapshot.
 *
 * The product-name detector resolves a product the caller NAMES exactly; this
 * module answers the other half — "what do you have for Dauerwelle / blonde /
 * which brands?" — by matching the caller's content tokens against each
 * product's productType, tags and title. Without it the agent had nothing to
 * offer for open-ended needs and looped on clarifying questions (live call
 * 2026-06-13). Built once at startup; per-turn access is a pure in-memory scan
 * with no LLM/KB/network. Returns real product names only — never invents.
 *
 * Ranking weights a productType match far above a tag match and a tag match
 * above a title-only match, so a "Shampoo" need surfaces shampoos, not a comb
 * that merely carries a "lockiges Haar" tag (real-call failure 2026-06-13).
 * `shortName` is a speakable name (brand + type, no size/code/long title) for
 * the voice agent; the caller complained the full titles were unspeakable.
 */

export type DrkallaCatalogMatch = {
  productId: string;
  spokenName: string;
  shortName: string;
  productType: string | null;
  priceText: string | null;
  priceValue: number | null; // min variant price, for "cheapest" sorting
  score: number;
  categoryHit: boolean; // matched the productType or a tag (not title-only)
  typeHit: boolean;     // matched the productType itself (a clear category need)
  /** Number of currently available variants — 0 = fully sold out. */
  availableCount?: number;
};

export type DrkallaProductCatalogSearch = (text: string, limit?: number) => DrkallaCatalogMatch[];

export type DrkallaCatalogSearchRawProduct = {
  handle?: unknown;
  title?: unknown;
  productType?: unknown;
  tags?: unknown;
  vendor?: unknown;
  variants?: unknown;
};

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('de-DE')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Function words + meta-words ("marke", "produkt") + shop/quality tags that
// must never drive a category match.
const STOPWORDS = new Set([
  'ich', 'sie', 'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'einen', 'einem', 'einer',
  'und', 'oder', 'mit', 'fuer', 'von', 'vom', 'zum', 'zur', 'auf', 'aus', 'bei', 'habt', 'haben',
  'hast', 'hat', 'suche', 'suchen', 'sucht', 'brauche', 'brauchen', 'moechte', 'moechten', 'will',
  'wollen', 'was', 'wer', 'wie', 'wo', 'wann', 'warum', 'welche', 'welcher', 'welches', 'kostet',
  'kosten', 'preis', 'preise', 'mir', 'mich', 'uns', 'euch', 'bitte', 'gerne', 'mal', 'noch',
  'auch', 'etwas', 'eigentlich', 'denn', 'schon', 'gibt', 'gibts', 'eure', 'euer', 'euren', 'ihr',
  'ist', 'sind', 'man', 'so', 'nur', 'mehr', 'zwei', 'drei', 'dann', 'also', 'okay', 'aber',
  'marke', 'marken', 'produkt', 'produkte', 'artikel', 'sortiment', 'empfehlen', 'empfiehlst',
  'empfehlung', 'haar', 'haare', 'haaren', 'meine', 'mein', 'machen', 'kann', 'koennen',
  // shop/quality tags that appear on nearly every product
  'dr', 'kalla', 'cosmetics', 'profi', 'salon', 'geeignet', 'sortiment',
]);

const SHADE_TOKEN = /^\d/; // drop bare size/shade tokens like "500", "100ml"

function contentTokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !SHADE_TOKEN.test(t));
}

// Add each token AND its stem to a set, so a stemmed query token matches.
// Catalog tokens are additionally decomposed on their compound HEAD NOUN
// ("Haarschneidemaschine" also indexes "maschine"), so a caller's bare class
// word reaches the compound-titled product. Without this, "eine Maschine"
// matched ONLY a Friseurstuhl via its SEO tag and the agent pitched a comb,
// then denied stocking machines at all (real call 2026-06-27).
function addTokensWithStems(set: Set<string>, tokens: string[]): void {
  for (const t of tokens) {
    set.add(t);
    const s = stem(t);
    if (s !== t) set.add(s);
    for (const suffix of HEAD_NOUN_INDEX_SUFFIXES) {
      if (t.length > suffix.length + 2 && t.endsWith(suffix)) {
        set.add(suffix);
        const ss = stem(suffix);
        if (ss !== suffix) set.add(ss);
        break;
      }
    }
  }
}

// Light German plural/inflection stem so a plural request matches a singular
// catalog word: "Scheren" -> "scher" matches "Schere" -> "scher" (live call:
// "Scheren" found no scissors because the token stayed plural). Conservative:
// strips ONE common suffix and only when the stem stays >= 4 chars, so it never
// collapses short distinct words. Applied symmetrically to catalog + query
// tokens, so it only ever helps recall on inflection.
function stem(token: string): string {
  for (const suffix of ['ern', 'en', 'er', 'es', 'e', 'n', 's']) {
    if (token.length - suffix.length >= 4 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

// Spoken product-CLASS words. When the caller names one, results are restricted
// to products of that class, so a "Shampoo" request can never surface a
// Lockenstab and a "Schere" request can never surface a Kamm (live call
// 2026-06-28: both leaked because they shared a modifier token like "Locken").
// Stems are precomputed so plural/inflected requests ("Scheren", "Masken") map
// to the same class. The filter only narrows; if the class has no match it does
// not fire (the honest "haben wir nicht / clarify" path stays intact).
// Only DISTINCTIVE class stems (>= 4 chars) are hard-filtered. Short, collision-
// prone stems (gel/oel/wax/kur — "gel" lives inside "spiegel"/"gelb"/"Gelée")
// and umlaut-spelling-fragile ones (tönung vs the catalog's "Tonung…") are
// deliberately EXCLUDED: they fall back to the type-weighted scoring instead of a
// brittle hard filter, so a genuine "Haargel"/"Stylingwax" is never dropped.
const PRODUCT_CLASS_STEMS = new Set(
  [
    'shampoo', 'conditioner', 'spuelung', 'maske', 'serum', 'schaum',
    'spray', 'puder', 'farbe', 'blondierung', 'schere',
    'effilierschere', 'kamm', 'buerste', 'foehn', 'haartrockner', 'lockenstab',
    'glaetteisen', 'rasierer', 'klinge', 'handtuch', 'umhang', 'handschuh', 'folie',
    'creme', 'lotion', 'fixierer', 'booster', 'maschine', 'pinsel', 'parfum',
  ].map(stem).filter((s) => s.length >= 4),
);

// Head nouns that close a German compound, so a one-word caller request can be
// split into modifier + class ("Lockenshampoo" -> "locken" + "shampoo",
// "Haaröl" -> "haar" + "oel", "Volumenshampoo" -> "volumen" + "shampoo"). The
// caller says compounds the catalog stores as two words; without this split the
// request matched nothing or the wrong product (verified live 2026-06-29).
// Normalized spelling (ä/ö/ü folded), longest first so "haarmaske" splits on
// "maske" not a shorter suffix.
const COMPOUND_SPLIT_SUFFIXES = [
  'haartrockner', 'conditioner', 'blondierung', 'lockenstab', 'spuelung', 'shampoo',
  'haarmaske', 'balsam', 'serum', 'schaum', 'spray', 'puder', 'creme', 'lotion',
  'maske', 'farbe', 'wachs', 'kur', 'oel', 'gel', 'wax', 'sortiment', 'maschine',
].sort((a, b) => b.length - a.length);

// Head nouns used to DECOMPOSE catalog tokens at index time (superset of the
// query-side split list, plus tool classes). "Haarschneidemaschine" indexes
// "maschine", "Rundbürste" indexes "buerste" — so the caller's bare class word
// finds the compound-titled product ("Scherensortiment"/"Maschine", live
// 2026-06-27/-29). Symmetric with the class filter: the decomposed head lands
// in classTokens too, so the hard class filter keeps working.
const HEAD_NOUN_INDEX_SUFFIXES = [
  ...COMPOUND_SPLIT_SUFFIXES.filter((s) => s !== 'sortiment'),
  'buerste', 'kamm', 'schere', 'pinsel',
].sort((a, b) => b.length - a.length);

// Spoken synonyms / morphology the catalog does not spell the caller's way:
// "Föhn" (catalog: Haartrockner/"Hair Dryer"), "Wachs" (catalog: "Wax"),
// "glatt(e)" (catalog: "glättend"). Mapped to the catalog's tokens so the
// request reaches the right products. Keys are normalized (umlauts folded).
const QUERY_SYNONYMS: Record<string, string[]> = {
  foehn: ['haartrockner', 'trockner', 'dryer'],
  haarfoehn: ['haartrockner', 'trockner', 'dryer'],
  wachs: ['wax'],
  // "Möbel kaufen" found nothing although 73 products are typed Salonmöbel
  // (live 2026-07-04: the agent first denied carrying furniture).
  moebel: ['salonmoebel', 'stuhl', 'sessel'],
  salonmoebel: ['salonmoebel', 'stuhl', 'sessel'],
  glatt: ['glaettend', 'glaettendes'],
  glatte: ['glaettend', 'glaettendes'],
  glatten: ['glaettend', 'glaettendes'],
  glaetten: ['glaettend', 'glaettendes'],
  trockenshampoo: ['trockenshampoo', 'trocken', 'shampoo'],
  // The caller describes curly hair with the ADJECTIVE ("lockige Haare"), the
  // catalog tags the NOUN ("Locken") — the one-suffix stemmer cannot unify
  // lockig/locken, so "lockige Haare" matched ONLY a comb via its "Lockiges"
  // SEO tag and the agent recommended a brush for a curly-hair need (real call
  // 2026-07-02). Map the adjective family onto the catalog noun.
  lockig: ['locken'],
  lockige: ['locken'],
  lockigen: ['locken'],
  lockiges: ['locken'],
  lockiger: ['locken'],
  kraus: ['locken'],
  krause: ['locken'],
  krausen: ['locken'],
  krauses: ['locken'],
  // Color AFTERCARE lives in the "Farbschutz …" products (Anti-Fading), but the
  // caller says "Nachpflege" / "rot gefärbte Haare" — those tokens never reached
  // them and the agent looped on Glanz-Shampoo (live 2026-07-05: "es gibt doch
  // was für Rotfarben").
  nachpflege: ['farbschutz', 'pflege', 'coloriert', 'fading'],
  farbnachpflege: ['farbschutz', 'pflege', 'coloriert', 'fading'],
  gefaerbt: ['coloriert', 'farbschutz'],
  gefaerbte: ['coloriert', 'farbschutz'],
  gefaerbten: ['coloriert', 'farbschutz'],
  gefaerbtes: ['coloriert', 'farbschutz'],
  // Deliberately NO bare rot->farbschutz mapping: "Rot, grün." as a COLOR
  // direction answer must stay with the Farb-Beleg model path, not get a
  // color-protect shampoo pitched (sim regression). The aftercare context
  // words above are enough to reach the Anti-Fading products.
  // The caller says "Parfüm"/"Duft" (folded: parfuem), the catalog spells the
  // French "Parfum" — 39 Eau-de-Parfum products were unreachable by the spoken
  // German word (audit 2026-07-05).
  parfuem: ['parfum'],
  parfuems: ['parfum'],
  duft: ['parfum'],
  duefte: ['parfum'],
};

// Expand a caller token into itself + any compound split + any synonyms, so the
// scorer + class filter see the catalog's vocabulary. Pure, in-memory.
function expandQueryToken(token: string): string[] {
  const out = [token];
  for (const suffix of COMPOUND_SPLIT_SUFFIXES) {
    if (token.length > suffix.length + 2 && token.endsWith(suffix)) {
      out.push(token.slice(0, token.length - suffix.length), suffix);
      break;
    }
  }
  for (const syn of QUERY_SYNONYMS[token] ?? []) out.push(syn);
  // German UMLAUT PLURALS ("Kämme" -> Kamm, "Lockenstäbe" -> Lockenstab,
  // "Färbeschäume" -> Schaum): after umlaut folding the plural reads kaemme/
  // staebe, which the one-suffix stemmer can never unify with the singular
  // kamm/stab. Adding the de-umlauted variant lets the shared stemmer close
  // the gap (funnel battery 2026-07-05: "Verkauft ihr auch Kämme?" and "Gibt
  // es bei euch Lockenstäbe?" found nothing). Additive only — the original
  // token stays, so nothing that matched before stops matching.
  if (/(?:ae|oe|ue)/.test(token)) {
    out.push(token.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u'));
  }
  return out;
}

// German cent words so a decimal price is SPOKEN naturally ("7 Euro sechzig")
// instead of digit-by-digit ("sieben Komma sechs null" — the trailing "null"
// is the "Euro o" the caller kept hearing, live 2026-06-30). Cents 1..99.
const CENT_ONES = ['', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const CENT_TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
function germanCents(n: number): string {
  if (n < 20) return CENT_ONES[n] ?? '';
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  if (ones === 0) return CENT_TENS[tens] ?? '';
  return `${ones === 1 ? 'ein' : (CENT_ONES[ones] ?? '')}und${CENT_TENS[tens] ?? ''}`;
}

// TTS-safe German money for this voice stack: whole euros read "12 Euro", decimal
// prices read the cents as a WORD ("7 Euro sechzig") so the flash TTS never reads
// the cents digit-by-digit (no "null"/"o", no "Komma"). This is the price the
// model is grounded on for the Katalog-Treffer list, so it fixes the model path
// too (model frames bypass the deterministic TTS layer).
export function formatDrkallaPrice(value: number): string {
  const cents = Math.round(value * 100);
  const euros = Math.floor(cents / 100);
  const c = cents % 100;
  return c === 0 ? `${euros} Euro` : `${euros} Euro ${germanCents(c)}`;
}

function formatEuro(value: number): string {
  return formatDrkallaPrice(value);
}

function pricesFromVariants(variants: unknown): { text: string | null; min: number | null } {
  if (!Array.isArray(variants)) return { text: null, min: null };
  const prices: number[] = [];
  for (const v of variants) {
    if (!v || typeof v !== 'object') continue;
    const p = Number(String((v as { price?: unknown }).price ?? '').replace(',', '.'));
    if (Number.isFinite(p) && p > 0) prices.push(p);
  }
  if (!prices.length) return { text: null, min: null };
  const min = Math.min(...prices), max = Math.max(...prices);
  return { text: min === max ? formatEuro(min) : `von ${formatEuro(min)} bis ${formatEuro(max)}`, min };
}

function cleanSpokenName(title: string): string {
  return title.replace(/^[^0-9A-Za-zÄÖÜäöüß]+/u, '').replace(/\s+/g, ' ').trim();
}

// Size/volume/quantity tokens that make a spoken name long and unnatural.
const SIZE_RE = /\b\d+[.,]?\d*\s?(?:ml|milliliter|liter|gramm|gr|kg|stk|st(?:ü|ue)ck|cm|mm|prozent|%|x)\b/gi;

// A token a German voice cannot say as a word: an ALL-CAPS code (CLR, LCH, EDP,
// ARGENT, BARCELONA), a vowel-less consonant cluster (Lch, CLR), or a token with
// an embedded digit (B3-PLEX, 10in1). These read as letter-spelling and break
// prosody, so they are stripped from the spoken short name.
function isUnpronounceableToken(word: string): boolean {
  if (/\d/.test(word)) return true;                      // embedded digit code
  if (word.length === 1 && /\p{L}/u.test(word)) return true; // stray single letter ("I AM THE KING")
  if (word.length >= 2 && /^[A-ZÄÖÜ]+$/.test(word)) return true; // ALL-CAPS code
  if (word.length >= 2 && !/[aeiouäöüy]/i.test(word)) return true; // no vowel
  return false;
}

// A SHOUTING-case real word ("OSCAR", "LÉONIE", "MATT-EFFEKTWACHS") is a NAME,
// not a letter code — the perfume lines carry their distinguishing name in caps,
// and dropping it left meaningless short names like "I Eau de" or a bare
// "Herrenparfum" shared by 39 products (audit 2026-07-05). Re-cased to title
// case (per hyphen part) when it is long enough to be a word and has vowels;
// short vowel-less codes (EDP, PSN, CLR, AISI) stay dropped by the code filter.
function recaseShoutedWord(word: string): string {
  if (word.length < 5) return word;
  if (!/^\p{Lu}[\p{Lu}-]+$/u.test(word)) return word;
  if (!/[AEIOUYÄÖÜÉÈÁÀÍÓÚ]/.test(word)) return word;
  return word
    .toLocaleLowerCase('de-DE')
    .replace(/(^|-)(\p{L})/gu, (_m, sep: string, ch: string) => `${sep}${ch.toLocaleUpperCase('de-DE')}`);
}

/**
 * A short, speakable product name for voice: drop leading bullets, size/volume
 * tokens, numeric and unpronounceable codes, de-duplicate repeated words (e.g.
 * "Pro Pro") and keep the first few meaningful words. Falls back to the cleaned
 * title (without codes, else the raw clean title) if nothing speakable remains.
 * The caller said the full catalog titles ("... Haarmaske für häufige Haarpflege
 * 500 Ml", "ARGENT Glanz-Shampoo & B3-PLEX") were unspeakable.
 */
// Strip a dangling tail so a truncated name never ends on a preposition/
// article ("Delrin Kamm in") or a spoken-unfriendly abbreviation ("versch.",
// "inkl."). Looped: "Delrin Kamm in versch." drops "versch." THEN "in"
// (real call 2026-07-02: the literal "in versch." was read out by the TTS).
function trimDanglingTail(name: string): string {
  let short = name;
  for (;;) {
    const next = short
      .replace(/\s+(?:für|von|mit|und|oder|der|die|das|den|dem|im|in|am|an|auf|zu|aus|bei|ohne|gegen|pro|fuer)$/i, '')
      .replace(/\s+\p{L}{1,7}\.$/u, '')
      .trim();
    if (!next || next === short) break;
    short = next;
  }
  return short || name;
}

export function buildDrkallaShortName(title: string): string {
  // Titles often join two marketing phrases with & | / – — keep the first.
  const segments = cleanSpokenName(title).split(/\s*[&|/–—]+\s*/);
  const firstSegment = segments[0] ?? '';
  const base = firstSegment
    .replace(SIZE_RE, ' ')
    .replace(/\b\d{2,}\b/g, ' ')   // standalone numeric size/article codes
    // Drop quality-tier / shop-channel suffixes that read as noise on a voice
    // name ("Colorationscreme Haarfarbe Profi-Salonbedarf" -> "Colorationscreme
    // Haarfarbe"). These trail many titles WITHOUT a leading "&", so the
    // first-segment cut above does not remove them (real call 2026-06-15).
    .replace(/\bProfi-?\s?(?:Salonbedarf|Qualit(?:ä|ae)t|Friseurbedarf)\b/gi, ' ')
    .replace(/\b(?:Salonbedarf|Friseurbedarf|Salonqualit(?:ä|ae)t)\b/gi, ' ')
    // Re-close a bracket whose tail was stripped ("(Haarschneiden, )" ->
    // "(Haarschneiden)"), drop brackets left empty — the orphan ", )" was
    // spoken aloud on the Doppelfunktionskamm (real call 2026-06-27).
    .replace(/\(\s*([^)]*?)[\s,;]*\)/g, (_m, inner: string) => (inner.trim() ? `(${inner.trim()})` : ' '))
    .replace(/\s+/g, ' ')
    .trim();
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of base.split(' ')) {
    const w = recaseShoutedWord(raw);
    if (!w) continue;
    // A token with no letter or digit at all (⌀, stray dashes) is never speakable.
    if (!/[\p{L}\p{N}]/u.test(w)) continue;
    const key = w.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(w);
  }
  const speakable = words.filter((w) => !isUnpronounceableToken(w));
  // Prefer the code-free words; if stripping leaves nothing, keep the originals
  // so we never return an empty name.
  const chosen = [...(speakable.length ? speakable : words)];
  // A leading article/filler must not eat the 4-word budget before the class
  // noun ("Ein Set aus zehn Kämmen …" got sliced to "Ein Set aus zehn" and the
  // caller never heard WHAT the set contains, audit 2026-07-05).
  while (chosen.length > 4 && /^(?:ein|eine|einen|der|die|das)$/i.test(chosen[0] ?? '')) chosen.shift();
  let short = chosen.slice(0, 4).join(' ').trim();
  if (short.length > 42) short = short.slice(0, 42).replace(/\s+\S*$/, '').trim();
  // A truncated name must not dangle on a preposition/article/conjunction
  // ("Feuchtigkeitsspendende Maske für" -> "Feuchtigkeitsspendende Maske"), which
  // reads as an unfinished sentence in TTS (real battery 2026-06-16).
  short = trimDanglingTail(short);
  // A single-word name is usually a bare marketing line ("PSN", "Noir") that
  // tells the caller NOTHING about the product class — the descriptive part
  // lives in the next title segment ("Noir – Reparaturmaske mit ..."). Append
  // up to two speakable words from it; SHOUTING-case real words are re-cased
  // ("REPARATUR" -> "Reparatur") so the code filter does not eat them.
  // (Live 2026-06-30: "Alternativ haben wir PSN und Noir" was meaningless.)
  const shortHasClassWord = normalize(short).split(' ').some((t) => {
    const s = stem(t);
    for (const c of PRODUCT_CLASS_STEMS) {
      if (s === c || s.endsWith(c)) return true;
    }
    return false;
  });
  if (short && !short.includes(' ') && !shortHasClassWord && segments.length > 1) {
    const extras = segments.slice(1).join(' ')
      .replace(SIZE_RE, ' ')
      .replace(/\b\d{2,}\b/g, ' ')
      .split(/\s+/)
      .map((w) => (/^[A-ZÄÖÜ]{5,}$/.test(w) && /[AEIOUÄÖÜY]/.test(w)
        ? w.charAt(0) + w.slice(1).toLocaleLowerCase('de-DE')
        : w))
      .filter((w) => w
        && /[\p{L}]/u.test(w)
        && !isUnpronounceableToken(w)
        // Foreign particles ("Eau de Parfum", "pour homme") read as broken
        // German when a 2-word cap chops the phrase ("Malik Eau de") — keep
        // the content nouns, skip the particles (audit 2026-07-05).
        && !/^(?:eau|de|du|le|la|les|pour|el|al)$/i.test(w)
        && w.toLocaleLowerCase('de-DE') !== short.toLocaleLowerCase('de-DE'));
    // Make sure the product-CLASS word (Maske/Shampoo/...) survives the 2-word
    // cap — otherwise two sibling products collapse to the same short name
    // ("PSN Essense Reparatur" for both the Maske AND the Shampoo) and the
    // spoken-name dedup silently drops one of them.
    const classWord = extras.find((w) => {
      const s = stem(normalize(w));
      for (const c of PRODUCT_CLASS_STEMS) {
        if (s === c || s.endsWith(c)) return true;
      }
      return false;
    });
    const picked = [...new Set(classWord && extras[0] !== classWord ? [extras[0]!, classWord] : extras.slice(0, 2))];
    if (picked.length) short = trimDanglingTail(`${short} ${picked.join(' ')}`.trim());
  }
  return short || cleanSpokenName(title);
}

type IndexedProduct = {
  productId: string;
  spokenName: string;
  shortName: string;
  productType: string | null;
  priceText: string | null;
  priceValue: number | null;
  available: number;
  typeTokens: Set<string>; // productType only (strongest signal)
  catTokens: Set<string>;  // productType + tags (category-level)
  allTokens: Set<string>;  // + title (product-level)
  classTokens: Set<string>; // productType + TITLE only (what the product genuinely IS — excludes SEO tags)
};

// Shopify data hygiene at INDEX time: the live snapshot has 18 products with
// an EMPTY productType and a couple of English ones — those were unreachable
// for every type-weighted query (typeHits=0 forever). Map known English types
// to German; derive a usable type from the title's head noun when empty.
const ENGLISH_TYPE_MAP: Record<string, string> = {
  'delrin hair comb / professional comb': 'Kamm',
  'salon display stand / floor display': 'Salon-Zubehör',
};

function normalizeDrkallaProductType(rawType: string | null, title: string): string | null {
  if (rawType) {
    return ENGLISH_TYPE_MAP[rawType.toLocaleLowerCase('de-DE')] ?? rawType;
  }
  for (const tok of contentTokens(title)) {
    const s = stem(tok);
    if (PRODUCT_CLASS_STEMS.has(s)) return tok.charAt(0).toUpperCase() + tok.slice(1);
    for (const suffix of HEAD_NOUN_INDEX_SUFFIXES) {
      if (s.endsWith(suffix) && s.length > suffix.length) {
        return tok.charAt(0).toUpperCase() + tok.slice(1);
      }
    }
  }
  return null;
}

export function buildDrkallaProductCatalogSearch(
  products: DrkallaCatalogSearchRawProduct[],
): DrkallaProductCatalogSearch {
  const indexed: IndexedProduct[] = [];
  for (const product of products) {
    if (typeof product?.handle !== 'string' || !product.handle) continue;
    if (typeof product.title !== 'string' || !product.title.trim()) continue;
    const rawProductType = typeof product.productType === 'string' && product.productType.trim()
      ? product.productType.trim()
      : null;
    const productType = normalizeDrkallaProductType(rawProductType, product.title);
    const tags = Array.isArray(product.tags)
      ? product.tags.filter((t): t is string => typeof t === 'string')
      : [];
    const typeTokens = new Set<string>();
    addTokensWithStems(typeTokens, contentTokens(productType ?? ''));
    const catTokens = new Set<string>(typeTokens);
    for (const tag of tags) {
      addTokensWithStems(catTokens, contentTokens(tag));
    }
    // Vendor tokens are category-level (×2) so a vendor word can help rank. NOTE
    // this is NOT a reliable "is this brand stocked" signal: normalize() splits
    // accents (é) so the L'Oréal vendor token is lost, and house products carry
    // competitor SEO tags ("wella"), so a token search for an unstocked brand
    // still returns house hits. Vendor-strict brand stock lives in
    // buildDrkallaExternalBrandStock below; use that for "do we carry brand X?".
    const vendor = typeof product.vendor === 'string' ? product.vendor : '';
    addTokensWithStems(catTokens, contentTokens(vendor));
    const titleTokens = new Set<string>();
    addTokensWithStems(titleTokens, contentTokens(product.title));
    const allTokens = new Set<string>(catTokens);
    for (const tok of titleTokens) allTokens.add(tok);
    // What the product genuinely IS = productType + title, deliberately EXCLUDING
    // SEO/competitor tags (a Friseurstuhl tagged "Schere" is not a scissors). Used
    // only by the product-class filter so a class request stays on-category.
    const classTokens = new Set<string>(typeTokens);
    for (const tok of titleTokens) classTokens.add(tok);
    if (!allTokens.size) continue;
    let available = 0;
    if (Array.isArray(product.variants)) {
      for (const v of product.variants) {
        if (v && typeof v === 'object' && (v as { available?: unknown }).available === true) available += 1;
      }
    }
    const prices = pricesFromVariants(product.variants);
    indexed.push({
      productId: product.handle,
      spokenName: cleanSpokenName(product.title),
      shortName: buildDrkallaShortName(product.title),
      productType,
      priceText: prices.text,
      priceValue: prices.min,
      available,
      typeTokens,
      catTokens,
      allTokens,
      classTokens,
    });
  }

  return (text: string, limit = 4): DrkallaCatalogMatch[] => {
    // Expand caller tokens: split German one-word compounds into modifier+class
    // and add catalog synonyms, so "Lockenshampoo"/"Haaröl"/"Föhn" reach the
    // right products.
    const userTokens = [...new Set(contentTokens(text).flatMap(expandQueryToken))];
    if (!userTokens.length) return [];
    // Each user token contributes its raw form AND its stem, so a plural/inflected
    // request matches the singular catalog word ("Scheren" -> "scher").
    const userStems = userTokens.map(stem);
    // Product classes the caller explicitly named (Shampoo, Schere, …). If any,
    // results are restricted to that class so a styling tool can't answer a
    // shampoo request and a comb can't answer a scissors request.
    const requestedClasses = userStems.filter((s) => PRODUCT_CLASS_STEMS.has(s));
    const matchesHit = (set: Set<string>, raw: string, s: string): boolean => set.has(raw) || set.has(s);
    const scored: Array<{ p: IndexedProduct; score: number; typeHits: number; catHits: number; allHits: number }> = [];
    for (const p of indexed) {
      let typeHits = 0;
      let catHits = 0;
      let allHits = 0;
      for (let i = 0; i < userTokens.length; i += 1) {
        const t = userTokens[i]!;
        const s = userStems[i]!;
        if (matchesHit(p.typeTokens, t, s)) typeHits += 1;
        if (matchesHit(p.catTokens, t, s)) catHits += 1;
        if (matchesHit(p.allTokens, t, s)) allHits += 1;
      }
      if (allHits === 0) continue;
      // A productType match is the strongest "this is the right kind of product"
      // signal; a tag match is next; a title-only match is weakest. This keeps a
      // comb out of a shampoo result even when the comb carries a topical tag.
      const score = typeHits * 4 + (catHits - typeHits) * 2 + (allHits - catHits);
      scored.push({ p, score, typeHits, catHits, allHits });
    }
    if (!scored.length) return [];

    // Hard product-class filter: when the caller named a class, drop every result
    // that does not actually belong to that class (its tokens lack the class
    // word). Only applied when it leaves at least one match, so an unstocked
    // class still falls through to the honest clarify/"haben wir nicht" path
    // rather than silently offering the wrong category.
    let classFiltered = false;
    if (requestedClasses.length) {
      // A product is in class `c` if a productType/title token equals `c` or ENDS
      // WITH it. German compounds are head-final and the class word is the head
      // noun ("Locken·shampoo", "Effilier·schere", "Haar·farbe", "Styling·schaum"),
      // so an endsWith match is both compound-correct and collision-safe (it does
      // not match a class word sitting at the front/middle, e.g. "Tonungs·aktivator"
      // is not a Tönung). The candidate set is already query-matched, so this only
      // narrows genuine candidates to the requested class.
      const inClass = scored.filter(({ p }) =>
        requestedClasses.some((c) => {
          if (p.classTokens.has(c)) return true;
          for (const t of p.classTokens) if (t.endsWith(c)) return true;
          return false;
        }));
      if (inClass.length) {
        scored.length = 0;
        scored.push(...inClass);
        classFiltered = true;
      }
    }
    scored.sort((a, b) =>
      (b.score - a.score)
      || (b.catHits - a.catHits)
      || (b.p.available - a.p.available)
      || (a.p.shortName.length - b.p.shortName.length)); // shorter speakable name first
    // Two different products can share a spoken short name; for voice that reads
    // as "X und X", so keep only the first (highest-scored) of each spoken name.
    const seenSpoken = new Set<string>();
    const deduped = scored.filter((s) => {
      const key = s.p.shortName.toLocaleLowerCase('de-DE');
      if (seenSpoken.has(key)) return false;
      seenSpoken.add(key);
      return true;
    });
    return deduped.slice(0, Math.max(1, limit)).map(({ p, score, typeHits, catHits }) => ({
      productId: p.productId,
      spokenName: p.spokenName,
      shortName: p.shortName,
      productType: p.productType,
      priceText: p.priceText,
      priceValue: p.priceValue,
      score,
      availableCount: p.available,
      categoryHit: catHits > 0,
      // The caller naming a product CLASS ("Scheren") is as strong a category
      // signal as a productType hit — scissors are typed "Friseur-Tool", so
      // pure typeHits left every scissors request un-answerable by the
      // deterministic recommender AND stripped them from the model grounding
      // (live 2026-06-29: the caller got a comb link for "Scherensortiment").
      typeHit: typeHits > 0 || classFiltered,
    }));
  };
}

/**
 * Rotate products WITHIN equal-score groups by a per-call seed, so score-tied
 * candidates share exposure across calls instead of one product always winning
 * the deterministic tie-break (audit 2026-07-05: 75/188 category queries had a
 * top-score tie, and the shortest-name winner — e.g. the Glanz-Shampoo — was
 * the example on every single call). Order BETWEEN score groups is unchanged,
 * so ranking quality is untouched; a 0/undefined seed is the identity, which
 * keeps every existing test and simulation byte-identical. Within one call the
 * seed is constant, so answers stay consistent and anti-repeat keeps working.
 */
export function rotateDrkallaEqualScoreGroups(hits: DrkallaCatalogMatch[], seed?: number): DrkallaCatalogMatch[] {
  const s = Math.trunc(Math.abs(seed ?? 0));
  if (!s || hits.length < 2) return hits;
  const out: DrkallaCatalogMatch[] = [];
  let i = 0;
  while (i < hits.length) {
    let j = i + 1;
    while (j < hits.length && hits[j]!.score === hits[i]!.score) j += 1;
    const group = hits.slice(i, j);
    const k = s % group.length;
    out.push(...group.slice(k), ...group.slice(0, k));
    i = j;
  }
  return out;
}

/**
 * Stable per-call seed for the tie rotation: FNV-1a over the call id, reduced
 * to a small positive int. Same call -> same seed (answers stay consistent
 * within a call); different calls -> different seeds (tied products share
 * exposure). Empty input -> 0 (identity rotation).
 */
export function drkallaVarietySeedFromCallId(callId: string): number {
  if (!callId) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < callId.length; i += 1) {
    h ^= callId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 997; // small prime keeps the modulo well-distributed
}

// EN/DE variant-title tokens -> spoken German color family. The Shopify color
// products carry their shades ONLY in variant titles ("1.0 Black", "6.0 Dark
// Blond", "4.5 Mahegony Medium Brown" — typos included), which no injection
// path ever surfaced: "Was habt ihr für Farben?" was unanswerable (live
// 2026-07-01, asked twice). Mapped offline at index build; purely additive.
const COLOR_FAMILY_TOKENS: Array<{ re: RegExp; family: string }> = [
  { re: /\bblack\b|\bschwarz\w*/i, family: 'Schwarz' },
  { re: /\bbrown\b|\bbraun\w*|\bchoc?olate\b|\bchoclate\b/i, family: 'Braun' },
  { re: /\bblond\w*/i, family: 'Blond' },
  { re: /\bred\b|\brot\w*/i, family: 'Rot' },
  { re: /\bcopper\b|\bkupfer\w*/i, family: 'Kupfer' },
  { re: /\bmah?[ae]gon\w*/i, family: 'Mahagoni' },
  { re: /\bviolett?\b|\bpurple\b|\blila\b/i, family: 'Violett' },
  { re: /\bash\b|\basch\w*/i, family: 'Asch' },
  { re: /\bgr[ae]y\b|\bgrau\w*|\bsilver\b|\bsilber\w*/i, family: 'Grau und Silber' },
  { re: /\bplatin\w*/i, family: 'Platinblond' },
  { re: /\bgold\w*/i, family: 'Gold' },
  { re: /\bgreen\b|\bgr(?:ü|ue)n\w*/i, family: 'Grün' },
  { re: /\bblue\b|\bblau\w*/i, family: 'Blau' },
];

const COLOR_PRODUCT_TYPE = /haarfarbe|blondierung|coloration|t(?:ö|oe)nung|farbcreme/i;

export type DrkallaColorShadeSummary = {
  totalShades: number;
  families: string[];
  /** Ready-to-speak fragment: "über 140 Nuancen, zum Beispiel Schwarz, Braun, …" */
  spoken: string;
};

/**
 * Aggregate the color products' variant titles into a SPOKEN shade summary, so
 * the agent can actually answer "Was habt ihr für Farben?" instead of pitching
 * an arbitrary product line. Built once at startup; null when the catalog has
 * no recognizable shades (the honest abstain path stays intact).
 */
export function buildDrkallaColorShadeSummary(
  products: DrkallaCatalogSearchRawProduct[],
): DrkallaColorShadeSummary | null {
  const families: string[] = [];
  let totalShades = 0;
  for (const product of products) {
    const type = typeof product?.productType === 'string' ? product.productType : '';
    const title = typeof product?.title === 'string' ? product.title : '';
    if (!COLOR_PRODUCT_TYPE.test(type) && !COLOR_PRODUCT_TYPE.test(title)) continue;
    if (!Array.isArray(product.variants)) continue;
    for (const v of product.variants) {
      if (!v || typeof v !== 'object') continue;
      const variantTitle = String((v as { title?: unknown }).title ?? '');
      if (!variantTitle || variantTitle === 'Default Title') continue;
      totalShades += 1;
      for (const { re, family } of COLOR_FAMILY_TOKENS) {
        if (re.test(variantTitle) && !families.includes(family)) families.push(family);
      }
    }
  }
  if (totalShades < 5 || families.length < 3) return null;
  const spokenFamilies = families.slice(0, 7);
  const list = `${spokenFamilies.slice(0, -1).join(', ')} und ${spokenFamilies[spokenFamilies.length - 1]}`;
  return {
    totalShades,
    families,
    spoken: `über ${Math.floor(totalShades / 10) * 10} Nuancen, zum Beispiel in ${list}`,
  };
}

export type DrkallaBrandStockMatch = {
  productId: string;
  spokenName: string;
  shortName: string;
  productType: string | null;
  priceText: string | null;
  priceValue: number | null;
  available: number;
};

export type DrkallaExternalBrandStock = (brandName: string) => DrkallaBrandStockMatch[];

// Brand key: lowercase, fold accents (é -> e via NFD), drop every non-alphanumeric
// so "L'Oréal" and a vendor "L'Oreal Professionnel Paris" collapse to comparable
// "loreal" / "lorealprofessionnelparis". normalize() above only folds umlauts and
// SPLITS on é, which silently dropped the L'Oréal vendor token; this keeps brand
// matching independent of accents and punctuation.
function brandKey(value: string): string {
  return value
    .toLocaleLowerCase('de-DE')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '');
}

// House/dropship vendors are never an external "brand the caller asked for".
const DRKALLA_HOUSE_VENDOR = /(?:dr\.?\s*kalla|cj\s*dropshipping)/i;

/**
 * Vendor-strict external-brand stock lookup. Unlike the token search above it
 * matches ONLY the product's vendor field (never tags/title), so competitor SEO
 * tags (house products are tagged "Wella" for search) cannot make an unstocked
 * brand look stocked, and the accent-folded key finds the L'Oréal vendor that
 * normalize() drops. Returns the real products of a brand we actually carry, []
 * for a brand we do not (-> the honest "führen wir nicht" path). Built once at
 * startup; lookup is a pure in-memory scan.
 */
export function buildDrkallaExternalBrandStock(
  products: DrkallaCatalogSearchRawProduct[],
): DrkallaExternalBrandStock {
  const indexed: Array<{ key: string; match: DrkallaBrandStockMatch }> = [];
  for (const product of products) {
    if (typeof product?.handle !== 'string' || !product.handle) continue;
    if (typeof product.title !== 'string' || !product.title.trim()) continue;
    const vendor = typeof product.vendor === 'string' ? product.vendor : '';
    if (!vendor.trim() || DRKALLA_HOUSE_VENDOR.test(vendor)) continue;
    const key = brandKey(vendor);
    if (key.length < 3) continue;
    let available = 0;
    if (Array.isArray(product.variants)) {
      for (const v of product.variants) {
        if (v && typeof v === 'object' && (v as { available?: unknown }).available === true) available += 1;
      }
    }
    const prices = pricesFromVariants(product.variants);
    const productType = typeof product.productType === 'string' && product.productType.trim()
      ? product.productType.trim()
      : null;
    indexed.push({
      key,
      match: {
        productId: product.handle,
        spokenName: cleanSpokenName(product.title),
        shortName: buildDrkallaShortName(product.title),
        productType,
        priceText: prices.text,
        priceValue: prices.min,
        available,
      },
    });
  }
  return (brandName: string): DrkallaBrandStockMatch[] => {
    const bk = brandKey(brandName);
    if (bk.length < 3) return [];
    const hits = indexed.filter((e) => e.key.includes(bk)).map((e) => e.match);
    // Available first, then cheapest, so we name something the caller can buy.
    hits.sort((a, b) =>
      (b.available - a.available)
      || ((a.priceValue ?? Number.POSITIVE_INFINITY) - (b.priceValue ?? Number.POSITIVE_INFINITY)));
    return hits;
  };
}
