import { pool } from './db.js';
import { DEFAULT_VOICE_ID } from './retell.js';
import type { RetellVoice } from './retell.js';
import { VOICE_CATALOG } from './voice-catalog.js';

const CURATED_VOICE_IDS = new Set<string>([
  DEFAULT_VOICE_ID,
  ...Object.values(VOICE_CATALOG).flat().map((voice) => voice.id),
]);

export function requiresVoiceOwnership(voiceId: string): boolean {
  return voiceId.startsWith('custom_voice_') && !CURATED_VOICE_IDS.has(voiceId);
}

export async function recordVoiceCloneOwnership(args: {
  orgId: string;
  voiceId: string;
  name?: string | null;
  provider?: string | null;
}): Promise<void> {
  if (!pool) throw new Error('Database not configured');
  const res = await pool.query(
    `INSERT INTO voice_clones (voice_id, org_id, name, provider)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (voice_id) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, voice_clones.name),
       provider = COALESCE(EXCLUDED.provider, voice_clones.provider)
     WHERE voice_clones.org_id = EXCLUDED.org_id
     RETURNING voice_id`,
    [args.voiceId, args.orgId, args.name ?? null, args.provider ?? null],
  );
  if (!res.rowCount) throw new Error('Voice clone already belongs to another org');
}

export async function isVoiceAllowedForOrg(orgId: string, voiceId: string): Promise<boolean> {
  if (!requiresVoiceOwnership(voiceId)) return true;
  if (!pool) return false;

  const owned = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok FROM voice_clones WHERE org_id = $1 AND voice_id = $2 LIMIT 1`,
    [orgId, voiceId],
  );
  if (owned.rowCount) return true;

  // Backward compatibility: before voice_clones existed, clone ownership was
  // implicit in existing agent configs. Keep those configs deployable, but do
  // not expose unrelated clone IDs to other orgs.
  const legacyConfig = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok
       FROM agent_configs
      WHERE org_id = $1 AND data->>'voice' = $2
      LIMIT 1`,
    [orgId, voiceId],
  );
  return Boolean(legacyConfig.rowCount);
}

export async function filterVoicesForOrg(orgId: string, voices: RetellVoice[]): Promise<RetellVoice[]> {
  if (!pool) return voices.filter((voice) => !requiresVoiceOwnership(voice.voice_id));

  const allowed = await pool.query<{ voice_id: string }>(
    `SELECT voice_id FROM voice_clones WHERE org_id = $1
     UNION
     SELECT DISTINCT data->>'voice' AS voice_id
       FROM agent_configs
      WHERE org_id = $1
        AND data->>'voice' IS NOT NULL`,
    [orgId],
  );
  const allowedCloneIds = new Set(allowed.rows.map((row) => row.voice_id));

  return voices.filter((voice) => (
    !requiresVoiceOwnership(voice.voice_id) || allowedCloneIds.has(voice.voice_id)
  ));
}
