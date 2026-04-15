// App-level symmetric encryption for sensitive tokens (calendar OAuth, API keys).
// Uses AES-256-GCM with random IV per message. Key from env ENCRYPTION_KEY (64 hex chars = 32 bytes).
//
// Ciphertext format: "enc:v1:<iv-hex>:<auth-tag-hex>:<ciphertext-hex>"
// Plaintext legacy (no prefix) is passed through on decrypt (backwards-compat during rollout).
//
// Generate a key:  openssl rand -hex 32
import crypto from 'node:crypto';

const ENCRYPTION_KEY_HEX = process.env.ENCRYPTION_KEY;
const PREFIX = 'enc:v1:';

let key: Buffer | null = null;
if (ENCRYPTION_KEY_HEX) {
  if (!/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY_HEX)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[crypto] ENCRYPTION_KEY must be 64 hex chars — refusing to boot in production with invalid key');
    }
    process.stderr.write('[crypto] ENCRYPTION_KEY must be 64 hex chars (32 bytes) — encryption DISABLED\n');
  } else {
    key = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');
  }
} else {
  // Fail closed in prod — silent plaintext storage of OAuth tokens is unacceptable.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[crypto] ENCRYPTION_KEY is required in production (openssl rand -hex 32) — refusing to boot with plaintext token storage');
  }
  process.stderr.write('[crypto] ENCRYPTION_KEY not set — tokens stored plaintext. Generate: openssl rand -hex 32\n');
}

export const ENCRYPTION_ENABLED = key !== null;

export function encrypt(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === '') return plaintext ?? null;
  if (!key) return plaintext; // fallback: store plaintext when key not configured
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decrypt(value: string | null | undefined): string | null {
  if (value == null || value === '') return value ?? null;
  // Legacy plaintext passthrough
  if (!value.startsWith(PREFIX)) return value;
  if (!key) {
    process.stderr.write('[crypto] Encrypted value found but ENCRYPTION_KEY not set — cannot decrypt\n');
    return null;
  }
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0]!, 'hex');
    const tag = Buffer.from(parts[1]!, 'hex');
    const ct = Buffer.from(parts[2]!, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (e) {
    process.stderr.write(`[crypto] decrypt failed: ${(e as Error).message}\n`);
    return null;
  }
}
