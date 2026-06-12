export type DrkallaDetectedProductType =
  | 'Farbentferner'
  | 'Blondierung'
  | 'Haarglättung'
  | 'Farbkarte'
  | 'Haarfarbe/Farbcreme'
  | 'Entwickler/Oxidant'
  | 'Shampoo'
  | 'Haarmaske'
  | 'Conditioner/Spülung'
  | 'Leave-in'
  | 'Serum'
  | 'Haarpflege'
  | 'Parfum/Duft'
  | 'Styling'
  | 'Salonmöbel/-ausstattung'
  | 'Salon-Verbrauchsmaterial'
  | 'Salon-Zubehör'
  | 'Friseur-Tool';

type DrkallaProductTypeRule = {
  label: DrkallaDetectedProductType;
  patterns: RegExp[];
};

const DRKALLA_PRODUCT_TYPE_RULES: DrkallaProductTypeRule[] = [
  {
    label: 'Farbentferner',
    patterns: [/\b(?:farbentferner|farbentfernung(?:st(?:\u00fc|ue)cher)?|farbe entfernen|color remover|remover)\b/u],
  },
  {
    label: 'Blondierung',
    patterns: [/\b(?:blondierung(?:en)?|blondierpulver|bleichpulver|aufheller|blondieren)\b/u],
  },
  {
    label: 'Haarglättung',
    patterns: [/\b(?:haargl(?:\u00e4|ae)ttung|gl(?:\u00e4|ae)ttung|gl(?:\u00e4|ae)ttungscreme|keratin|haare? gl(?:\u00e4|ae)tten)\b/u],
  },
  {
    label: 'Farbkarte',
    patterns: [/\b(?:farbkarten?|nuancenkarten?)\b/u],
  },
  {
    label: 'Haarfarbe/Farbcreme',
    patterns: [/\b(?:haarfarben?|farbcremes?|color creams?|coloration|haare? f(?:\u00e4|ae)rben|f(?:\u00e4|ae)rben|farben?)\b/u],
  },
  {
    label: 'Entwickler/Oxidant',
    patterns: [/\b(?:entwickler|oxidant|wasserstoffperoxid|peroxid|prozentst(?:\u00e4|ae)rke)\b/u],
  },
  {
    label: 'Shampoo',
    patterns: [/\b(?:shampoos?|silbershampoo|anti[-\s]?(?:gelb|yellow|orange)\s*shampoo)\b/u],
  },
  {
    label: 'Haarmaske',
    patterns: [/\b(?:haarmasken?|masken?|kuren?|anti[-\s]?(?:gelb|yellow|orange)\s*(?:maske|mask))\b/u],
  },
  {
    label: 'Conditioner/Spülung',
    patterns: [/\b(?:conditioner|sp(?:\u00fc|ue)lungen?|pflegesp(?:\u00fc|ue)lungen?)\b/u],
  },
  {
    label: 'Leave-in',
    patterns: [/\b(?:leave[-\s]?in|leave in)\b/u],
  },
  {
    label: 'Serum',
    patterns: [/\b(?:haarserum|seren|serum|(?:\u00f6l|oel)[-\s]?serum)\b/u],
  },
  {
    label: 'Haarpflege',
    patterns: [/\b(?:pflege|anti gelb|anti orange)\b/u],
  },
  {
    label: 'Parfum/Duft',
    patterns: [/\b(?:parfum|duft|eau de parfum|herrenduft|damenduft|unisexduft)\b/u],
  },
  {
    label: 'Styling',
    patterns: [/\b(?:haarspray|mousse|haargel|styling|wachs|pomade|dauerwellen?(?:l(?:\u00f6|oe)sung|mittel)?|dauerwelle)\b/u],
  },
  {
    label: 'Salonmöbel/-ausstattung',
    patterns: [
      /\b(?:salonwagen|friseurwagen|rollwagen|arbeitswagen|wascheinheiten?|waschbecken|waschpl(?:\u00e4|ae)tze?|waschplatz|r(?:\u00fc|ue)ckw(?:\u00e4|ae)rtswaschbecken|friseurst(?:\u00fc|ue)hle?|friseurstuhl|barberst(?:\u00fc|ue)hle?|barberstuhl|friseursessel|salonst(?:\u00fc|ue)hle?|stuhl|salonm(?:\u00f6|oe)bel|friseurm(?:\u00f6|oe)bel|ablagen?|ablagetische?|stehmatten?)\b/u,
    ],
  },
  {
    label: 'Salon-Verbrauchsmaterial',
    patterns: [
      /\b(?:spitzenpapier|watteschnur|spr(?:\u00fc|ue)hflaschen?|nackenpapier|halskrausen?|friseurumh(?:\u00e4|ae)nge?|friseurumhang|salonumh(?:\u00e4|ae)nge?|salonumhang|schneideumh(?:\u00e4|ae)nge?|schneideumhang|schneidecapes?|barbercapes?|umh(?:\u00e4|ae)nge?|umhang|handschuhe?|nitrilhandschuhe?)\b/u,
    ],
  },
  {
    label: 'Salon-Zubehör',
    patterns: [/\b(?:spiegel|kabinettspiegel|aufsteller|display(?:\s+stand)?|salonzubeh(?:\u00f6|oe)r|salon zubeh(?:\u00f6|oe)r)\b/u],
  },
  {
    label: 'Friseur-Tool',
    patterns: [
      /\b(?:kamm|k(?:\u00e4|ae)mme|b(?:\u00fc|ue)rsten?|scheren?|friseurscheren?|haarscheren?|clipper|trimmer|friseurtools?|tools?|f(?:\u00e4|ae)rbeschalen?|farbschalen?|f(?:\u00e4|ae)rbepinsel|farbpinsel|alufolie|str(?:\u00e4|ae)hnenfolie|f(?:\u00e4|ae)rbefolie|gl(?:\u00e4|ae)tteisen|haartrockner|f(?:\u00f6|oe)hn|shaver|rasierer|barttrimmer|haartrimmer|rasierpinsel|rasierklingen?|haarschneidemaschinen?|schneidemaschinen?|haarstaubwedel|nackenwedel)\b/u,
    ],
  },
];

export function detectDrkallaUserProductType(text: string): DrkallaDetectedProductType | null {
  const normalized = text.toLocaleLowerCase('de-DE');
  for (const rule of DRKALLA_PRODUCT_TYPE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return rule.label;
    }
  }
  return null;
}
