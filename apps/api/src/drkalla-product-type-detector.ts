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
  | 'Kosmetikbedarf'
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
    patterns: [/\b(?:blondierung(?:en)?|blondierpulver|bleichpulver|blond[-\s]?booster|aufheller|blondieren)\b/u],
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
    patterns: [/\b(?:haarfarben?|haarf(?:\u00e4|ae)rbemittel|farbcremes?|color creams?|coloration|haare? f(?:\u00e4|ae)rben|f(?:\u00e4|ae)rben|farben?)\b/u],
  },
  {
    label: 'Entwickler/Oxidant',
    patterns: [/\b(?:entwickler|oxidant|wasserstoffperoxid|peroxid|prozentst(?:\u00e4|ae)rke)\b/u],
  },
  {
    label: 'Shampoo',
    patterns: [/\b(?:shampoos?|vorbereitungsshampoo|neutralshampoo|pflegeshampoo|hydratationsshampoo|restrukturierungsshampoo|st(?:\u00e4|ae)rkungsshampoo|silbershampoo|anti[-\s]?(?:gelb|yellow|orange)\s*shampoo)\b/u],
  },
  {
    label: 'Haarmaske',
    patterns: [/\b(?:haarmasken?|haarkur|masken?|kuren?|feuchtigkeitsmaske|lockenmaske|n(?:\u00e4|ae)hrmaske|pflegemaske|regenerierungsmaske|reparierungsmaske|anti[-\s]?(?:gelb|yellow|orange)\s*(?:maske|mask))\b/u],
  },
  {
    label: 'Conditioner/Spülung',
    patterns: [/\b(?:conditioner|kl(?:\u00e4|ae)rende\s+sp(?:\u00fc|ue)lung|sp(?:\u00fc|ue)lungen?|pflegesp(?:\u00fc|ue)lung(?:en)?|seidenprotein\s+sp(?:\u00fc|ue)lung)\b/u],
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
    // Compound "…pflege" forms included: "Nachpflege" missed the bare \bpflege\b
    // and the color category stayed active — the caller asking for aftercare got
    // a HAARFARBE recommended (live 2026-07-05).
    patterns: [/\b(?:(?:nach|farb|haar|spezial|farbnach)?pflege|hitzeschutz|ampullen?|vials?|8[-\s]?sekunden[-\s]?kur|anti gelb|anti orange)\b/u],
  },
  {
    label: 'Parfum/Duft',
    patterns: [/\b(?:parfum|duft|eau de parfum|herrenduft|damenduft|unisexduft)\b/u],
  },
  {
    label: 'Styling',
    patterns: [/\b(?:haarspray|glanz[-\s]?spray|laminier[-\s]?spray|gel[-\s]?spray|volumen[-\s]?puder|volumisierendes\s+spray|mousse|haarschaum|styling[-\s]?schaum|haargel|haarstyling|styling|stylingwax|wachs|bright[-\s]?wax|pomade|f(?:\u00e4|ae)rbesch(?:\u00e4|ae)um|alligator[-\s]?clips?|hair[-\s]?clips?|haarklammern?|dauerwellen?(?:l(?:\u00f6|oe)sung|mittel)?|dauerwelle)\b/u],
  },
  {
    label: 'Kosmetikbedarf',
    patterns: [/\b(?:kosmetikbedarf|depilationszubeh(?:\u00f6|oe)r|depilationswachs|depilation|waxing|enthaarungszubeh(?:\u00f6|oe)r)\b/u],
  },
  {
    label: 'Salonmöbel/-ausstattung',
    patterns: [
      /\b(?:salonwagen|friseurwagen|rollwagen|arbeitswagen|desinfektionswagen|wascheinheiten?|waschbecken|waschpl(?:\u00e4|ae)tze?|waschplatz|r(?:\u00fc|ue)ckw(?:\u00e4|ae)rtswaschbecken|friseurst(?:\u00fc|ue)hle?|friseurstuhl|barberst(?:\u00fc|ue)hle?|barberstuhl|friseursessel|salonst(?:\u00fc|ue)hle?|stuhl|salonm(?:\u00f6|oe)bel|friseurm(?:\u00f6|oe)bel|ablagen?|ablagetische?|stehmatten?)\b/u,
    ],
  },
  {
    label: 'Salon-Verbrauchsmaterial',
    patterns: [
      /\b(?:spitzenpapier|watteschnur|spr(?:\u00fc|ue|ay)h?flaschen?|handt(?:\u00fc|ue)cher|handtuch|professionelles\s+salonhandtuch|salon[-\s]?verbrauchsmaterial|nackenpapier|nackenstreifen|halskrausen?|friseurumh(?:\u00e4|ae)nge?|friseurumhang|salonumh(?:\u00e4|ae)nge?|salonumhang|schneideumh(?:\u00e4|ae)nge?|schneideumhang|schneidecapes?|barbercapes?|umh(?:\u00e4|ae)nge?|umhang|handschuhe?|einweghandschuhe?|nitrilhandschuhe?)\b/u,
    ],
  },
  {
    label: 'Salon-Zubehör',
    patterns: [/\b(?:spiegel|kabinettspiegel|aufsteller|display(?:\s+stand)?|servicewagen|kosmetikwagen|accessories|zubeh(?:\u00f6|oe)r|salonbedarf|salonzubeh(?:\u00f6|oe)r|salon zubeh(?:\u00f6|oe)r)\b/u],
  },
  {
    label: 'Friseur-Tool',
    patterns: [
      // Compound heads included (\p{L}* prefix): "Hitze-Gl\u00e4ttkamm" and other
      // compound tool names missed the bare \bkamm\b, stayed under the sticky
      // previous category and were unreachable (live 2026-07-05, a NEW product).
      /\b(?:\p{L}*kamm|\p{L}*k(?:\u00e4|ae)mme|\p{L}*b(?:\u00fc|ue)rsten?|\p{L}*scheren?|delrin\s+hair\s+comb|professional\s+comb|clipper|trimmer|friseurtools?|tools?|barber[-\s]?bedarf|f(?:\u00e4|ae)rbeschalen?|farbschalen?|f(?:\u00e4|ae)rbepinsel|farbpinsel|alufolie|str(?:\u00e4|ae)hnenfolie|str(?:\u00e4|ae)hnchenfolie|str(?:\u00e4|ae)hnenhauben?|f(?:\u00e4|ae)rbefolie|gl(?:\u00e4|ae)tteisen|kreppeisen|haartrockner|hair\s+dryer|f(?:\u00f6|oe)hn|haarsauger|clean\s+all|heizstab|uvc\s+lampen?|ersatzlampen?|shaver|rasierer|barttrimmer|haartrimmer|rasierpinsel|rasierklingen?|haarschneidemaschinen?|schneidemaschinen?|haarstaubwedel|nackenwedel)\b/u,
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
