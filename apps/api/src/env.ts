import dotenv from 'dotenv';

// Load .env from apps/api/ directory, then fall back to repo root.
dotenv.config({ path: new URL('../.env', import.meta.url), override: true });
dotenv.config({ path: new URL('../../../.env', import.meta.url) });
