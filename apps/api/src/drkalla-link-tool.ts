import crypto from 'node:crypto';

export const DRKALLA_LINK_TOOL_NAME = 'drkalla_send_link';
export const DRKALLA_LINK_TOOL_PATH = '/retell/tools/drkalla.send_link';

const ALLOWED_DRKALLA_HOSTS = new Set(['drkalla.com', 'www.drkalla.com']);

function drkallaToolAuthSecret(): string {
  const secret = process.env.RETELL_TOOL_AUTH_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('RETELL_TOOL_AUTH_SECRET (or JWT_SECRET) required in production for DrKalla link tool auth');
    }
    return 'dev-retell-tool-auth';
  }
  return secret;
}

export function drkallaLinkToolSignature(): string {
  return crypto.createHmac('sha256', drkallaToolAuthSecret()).update('drkalla-send-link:v1').digest('base64url');
}

export type DrkallaLinkKind = 'shop' | 'product' | 'category' | 'contact' | 'profi';

export function normalizeDrkallaLinkUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (!ALLOWED_DRKALLA_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  parsed.hash = '';
  return parsed.toString();
}

function compact(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function buildDrkallaLinkSmsBody(input: {
  label?: unknown;
  url: string;
  linkKind?: unknown;
}): string {
  const label = compact(input.label).slice(0, 90) || 'Dr.Kalla Link';
  const kind = compact(input.linkKind).toLowerCase();
  const intro = kind === 'contact' || kind === 'page'
    ? 'Hier ist der Kontaktlink von Dr.Kalla'
    : kind === 'profi'
      ? 'Hier ist der Profi-Zugang von Dr.Kalla'
    : kind === 'category'
      ? 'Hier ist die Dr.Kalla Kategorie'
      : kind === 'product'
        ? 'Hier ist der Dr.Kalla Produktlink'
        : 'Hier ist der Dr.Kalla Shoplink';
  return `${intro}: ${label} - ${input.url}`;
}
