import type { ServiceItem } from './api.js';

export const HAIRDRESSER_SERVICE_PRESET: ServiceItem[] = [
  { id: 'haircut-women', name: 'Damenhaarschnitt', duration: '45 min', bufferMinutes: 5, tag: 'BELIEBT' },
  { id: 'haircut-men', name: 'Herrenschnitt', duration: '30 min', bufferMinutes: 5, tag: 'BELIEBT' },
  { id: 'haircut-kids', name: 'Kinderhaarschnitt', duration: '30 min', bufferMinutes: 5 },
  { id: 'wash-blowdry', name: 'Waschen & Föhnen', duration: '30 min', bufferMinutes: 5 },
  { id: 'roots-color', name: 'Ansatzfarbe', duration: '75 min', bufferMinutes: 10 },
  { id: 'full-color', name: 'Farbe komplett', duration: '90 min', bufferMinutes: 15 },
  { id: 'highlights-partial', name: 'Strähnen Oberkopf', duration: '90 min', bufferMinutes: 15 },
  { id: 'balayage', name: 'Balayage', duration: '150 min', bufferMinutes: 15 },
  { id: 'glossing', name: 'Glossing / Tönung', duration: '60 min', bufferMinutes: 10 },
  { id: 'beard-trim', name: 'Bart trimmen', duration: '20 min', bufferMinutes: 5 },
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
