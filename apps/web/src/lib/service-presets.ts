import type { ServiceItem } from './api.js';

export const HAIRDRESSER_SERVICE_PRESET: ServiceItem[] = [
  { id: 'haircut-women', name: 'Damenhaarschnitt', duration: '45 min', tag: 'BELIEBT' },
  { id: 'haircut-men', name: 'Herrenschnitt', duration: '30 min', tag: 'BELIEBT' },
  { id: 'haircut-kids', name: 'Kinderhaarschnitt', duration: '30 min' },
  { id: 'wash-blowdry', name: 'Waschen & Föhnen', duration: '30 min' },
  { id: 'roots-color', name: 'Ansatzfarbe', duration: '75 min' },
  { id: 'full-color', name: 'Farbe komplett', duration: '90 min' },
  { id: 'highlights-partial', name: 'Strähnen Oberkopf', duration: '90 min' },
  { id: 'balayage', name: 'Balayage', duration: '150 min' },
  { id: 'glossing', name: 'Glossing / Tönung', duration: '60 min' },
  { id: 'beard-trim', name: 'Bart trimmen', duration: '20 min' },
];

export function serviceItemToStaffLabel(service: Pick<ServiceItem, 'name' | 'duration'>): string {
  const name = service.name.trim();
  const duration = service.duration?.trim();
  return duration ? `${name} (${duration})` : name;
}

export function serviceItemsToStaffLabels(services: ServiceItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const service of services) {
    const label = serviceItemToStaffLabel(service).trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}
