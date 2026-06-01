import crypto from 'node:crypto';

export type OwnKbRetellSyncRisk = 'low' | 'medium' | 'high' | 'pricing' | 'legal' | 'policy';

export type OwnKbSourceVersionStatus =
  | 'approved'
  | 'current'
  | 'verified'
  | 'pending'
  | 'draft'
  | 'expired'
  | 'archived'
  | 'rejected'
  | 'unsafe';

export type RetellKbSyncStatus =
  | 'active'
  | 'pending'
  | 'disabled'
  | 'removed'
  | 'failed'
  | 'needs_update';

export type RetellKbSyncActor = 'system' | 'admin' | 'worker' | 'model';

export type RetellKbSyncAction =
  | 'create_or_update_retell_content'
  | 'disable_retell_content'
  | 'remove_retell_content'
  | 'retry_failed_sync'
  | 'noop';

export type RetellKbSyncBlocker =
  | 'MODEL_MUST_NOT_CONTROL_SYNC'
  | 'MISSING_ORG_ID'
  | 'MISSING_TENANT_ID'
  | 'MISSING_AGENT_ID'
  | 'SYNC_SCOPE_MISMATCH'
  | 'MISSING_OWN_SOURCE_ID'
  | 'MISSING_SOURCE_VERSION_ID'
  | 'MISSING_SOURCE_VERSION_HASH'
  | 'MISSING_RETELL_KB_ID'
  | 'MISSING_EXPIRES_AT'
  | 'EXPIRES_AT_INVALID'
  | 'SOURCE_NOT_APPROVED_CURRENT'
  | 'SOURCE_EXPIRED'
  | 'SOURCE_ARCHIVED'
  | 'SOURCE_REJECTED'
  | 'SOURCE_UNSAFE'
  | 'SOURCE_ALLOWED_USE_DISALLOWED'
  | 'RETELL_AUTO_REFRESH_UNVERIFIED'
  | 'RETELL_AUTO_CRAWL_UNVERIFIED';

export type OwnKbSourceVersionForRetellSync = {
  org_id: string;
  tenant_id: string;
  agent_id: string;
  own_source_id: string;
  source_version_id: string;
  source_version_hash: string;
  status: OwnKbSourceVersionStatus;
  current: boolean;
  approved: boolean;
  expires_at: string | null;
  risk: OwnKbRetellSyncRisk;
  allowed_use: string;
  unsafe?: boolean;
  retell_auto_refresh_enabled?: boolean;
  retell_auto_crawl_enabled?: boolean;
  retell_refresh_verified_by_own_kb?: boolean;
};

export type RetellKbSyncState = {
  org_id: string;
  tenant_id: string;
  agent_id: string;
  own_source_id: string;
  source_version_id: string;
  source_version_hash: string;
  retell_knowledge_base_id: string;
  retell_source_id?: string | null;
  retell_auto_refresh_enabled: boolean;
  retell_auto_crawl_enabled: boolean;
  synced_at: string;
  expires_at: string | null;
  risk: OwnKbRetellSyncRisk;
  allowed_use: string;
  sync_status: RetellKbSyncStatus;
  last_sync_error: string | null;
};

export type RetellKbSyncDecision = {
  action: RetellKbSyncAction;
  eligible: boolean;
  blockers: RetellKbSyncBlocker[];
  idempotencyKey: string | null;
  nextState: RetellKbSyncState | null;
  auditEvent: {
    type:
      | 'retell_kb_sync_create_or_update_planned'
      | 'retell_kb_sync_disable_planned'
      | 'retell_kb_sync_remove_planned'
      | 'retell_kb_sync_retry_planned'
      | 'retell_kb_sync_noop';
    own_source_id?: string;
    org_id?: string;
    tenant_id?: string;
    agent_id?: string;
    source_version_id?: string;
    retell_knowledge_base_id?: string;
    retell_source_id?: string | null;
    blockers: RetellKbSyncBlocker[];
  };
};

export const RETELL_KB_SYNC_STATE_FIELDS = [
  'org_id',
  'tenant_id',
  'agent_id',
  'own_source_id',
  'source_version_id',
  'source_version_hash',
  'retell_knowledge_base_id',
  'retell_source_id',
  'retell_auto_refresh_enabled',
  'retell_auto_crawl_enabled',
  'synced_at',
  'expires_at',
  'risk',
  'allowed_use',
  'sync_status',
  'last_sync_error',
] as const satisfies ReadonlyArray<keyof RetellKbSyncState>;

const APPROVED_CURRENT_STATUSES = new Set<OwnKbSourceVersionStatus>(['approved', 'current', 'verified']);
const DISALLOWED_STATUSES = new Set<OwnKbSourceVersionStatus>(['archived', 'rejected', 'unsafe', 'expired']);
const ALLOWED_RETELL_RUNTIME_USES = new Set([
  'agent_facts',
  'customer_faq',
  'voice_agent',
  'voice_factual_answer',
  'public_faq',
]);

function compact(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function idempotencyKey(action: RetellKbSyncAction, source: OwnKbSourceVersionForRetellSync, state?: RetellKbSyncState | null): string {
  const payload = {
    action,
    org_id: source.org_id,
    tenant_id: source.tenant_id,
    agent_id: source.agent_id,
    own_source_id: source.own_source_id,
    source_version_id: source.source_version_id,
    source_version_hash: source.source_version_hash,
    retell_knowledge_base_id: state?.retell_knowledge_base_id ?? null,
    retell_source_id: state?.retell_source_id ?? null,
  };
  return crypto.createHash('sha256').update(stableJson(payload)).digest('hex');
}

export function retellKbSyncEligibility(
  source: OwnKbSourceVersionForRetellSync,
  options: { now?: Date | string } = {},
): { eligible: boolean; blockers: RetellKbSyncBlocker[] } {
  const blockers = new Set<RetellKbSyncBlocker>();
  if (!compact(source.org_id)) blockers.add('MISSING_ORG_ID');
  if (!compact(source.tenant_id)) blockers.add('MISSING_TENANT_ID');
  if (!compact(source.agent_id)) blockers.add('MISSING_AGENT_ID');
  if (!compact(source.own_source_id)) blockers.add('MISSING_OWN_SOURCE_ID');
  if (!compact(source.source_version_id)) blockers.add('MISSING_SOURCE_VERSION_ID');
  if (!compact(source.source_version_hash)) blockers.add('MISSING_SOURCE_VERSION_HASH');

  const status = source.status;
  if (!source.approved || !source.current || !APPROVED_CURRENT_STATUSES.has(status)) {
    blockers.add('SOURCE_NOT_APPROVED_CURRENT');
  }
  if (status === 'archived') blockers.add('SOURCE_ARCHIVED');
  if (status === 'rejected') blockers.add('SOURCE_REJECTED');
  if (status === 'unsafe' || source.unsafe === true) blockers.add('SOURCE_UNSAFE');
  if (DISALLOWED_STATUSES.has(status) && status === 'expired') blockers.add('SOURCE_EXPIRED');

  const nowMs = options.now instanceof Date
    ? options.now.getTime()
    : typeof options.now === 'string'
      ? parseTime(options.now)
      : Date.now();
  const expiresAtMs = parseTime(source.expires_at);
  if (!compact(source.expires_at)) {
    blockers.add('MISSING_EXPIRES_AT');
  } else if (expiresAtMs == null) {
    blockers.add('EXPIRES_AT_INVALID');
  }
  if (expiresAtMs != null && expiresAtMs <= (nowMs ?? Date.now())) blockers.add('SOURCE_EXPIRED');

  const allowedUse = compact(source.allowed_use).toLowerCase();
  if (!ALLOWED_RETELL_RUNTIME_USES.has(allowedUse)) blockers.add('SOURCE_ALLOWED_USE_DISALLOWED');

  const runtimeRefreshEnabled = source.retell_auto_refresh_enabled === true || source.retell_auto_crawl_enabled === true;
  if (runtimeRefreshEnabled && source.retell_refresh_verified_by_own_kb !== true) {
    if (source.retell_auto_refresh_enabled === true) blockers.add('RETELL_AUTO_REFRESH_UNVERIFIED');
    if (source.retell_auto_crawl_enabled === true) blockers.add('RETELL_AUTO_CRAWL_UNVERIFIED');
  }

  return { eligible: blockers.size === 0, blockers: [...blockers] };
}

export function buildRetellKbSyncState(input: {
  source: OwnKbSourceVersionForRetellSync;
  retell_knowledge_base_id: string;
  retell_source_id?: string | null;
  synced_at: string;
  sync_status?: RetellKbSyncStatus;
  last_sync_error?: string | null;
}): RetellKbSyncState {
  return {
    org_id: input.source.org_id,
    tenant_id: input.source.tenant_id,
    agent_id: input.source.agent_id,
    own_source_id: input.source.own_source_id,
    source_version_id: input.source.source_version_id,
    source_version_hash: input.source.source_version_hash,
    retell_knowledge_base_id: input.retell_knowledge_base_id,
    retell_source_id: input.retell_source_id ?? null,
    retell_auto_refresh_enabled: input.source.retell_auto_refresh_enabled === true,
    retell_auto_crawl_enabled: input.source.retell_auto_crawl_enabled === true,
    synced_at: input.synced_at,
    expires_at: input.source.expires_at,
    risk: input.source.risk,
    allowed_use: input.source.allowed_use,
    sync_status: input.sync_status ?? 'active',
    last_sync_error: input.last_sync_error ?? null,
  };
}

function inactiveActionFor(blockers: RetellKbSyncBlocker[], state?: RetellKbSyncState | null): RetellKbSyncAction {
  if (!state || state.sync_status === 'removed') return 'noop';
  if (
    blockers.includes('SOURCE_ARCHIVED')
    || blockers.includes('SOURCE_REJECTED')
    || blockers.includes('SOURCE_UNSAFE')
    || blockers.includes('SOURCE_ALLOWED_USE_DISALLOWED')
  ) {
    return 'remove_retell_content';
  }
  return 'disable_retell_content';
}

function auditTypeFor(action: RetellKbSyncAction): RetellKbSyncDecision['auditEvent']['type'] {
  if (action === 'create_or_update_retell_content') return 'retell_kb_sync_create_or_update_planned';
  if (action === 'disable_retell_content') return 'retell_kb_sync_disable_planned';
  if (action === 'remove_retell_content') return 'retell_kb_sync_remove_planned';
  if (action === 'retry_failed_sync') return 'retell_kb_sync_retry_planned';
  return 'retell_kb_sync_noop';
}

export function planRetellKbSync(input: {
  source: OwnKbSourceVersionForRetellSync;
  existingState?: RetellKbSyncState | null;
  actor: RetellKbSyncActor;
  now?: Date | string;
  retell_knowledge_base_id?: string;
  retell_source_id?: string | null;
}): RetellKbSyncDecision {
  const eligibility = retellKbSyncEligibility(input.source, { now: input.now });
  const blockers = [...eligibility.blockers];
  if (input.actor === 'model') blockers.unshift('MODEL_MUST_NOT_CONTROL_SYNC');
  if (eligibility.eligible && !compact(input.retell_knowledge_base_id) && !compact(input.existingState?.retell_knowledge_base_id)) {
    blockers.push('MISSING_RETELL_KB_ID');
  }
  if (
    input.existingState
    && (
      input.existingState.org_id !== input.source.org_id
      || input.existingState.tenant_id !== input.source.tenant_id
      || input.existingState.agent_id !== input.source.agent_id
    )
  ) {
    blockers.push('SYNC_SCOPE_MISMATCH');
  }

  const hasBlockingModelActor = blockers.includes('MODEL_MUST_NOT_CONTROL_SYNC');
  const hasScopeMismatch = blockers.includes('SYNC_SCOPE_MISMATCH');
  const hasMissingRetellKbId = blockers.includes('MISSING_RETELL_KB_ID');
  let action: RetellKbSyncAction;
  if (hasBlockingModelActor || hasScopeMismatch || hasMissingRetellKbId) {
    action = 'noop';
  } else if (!eligibility.eligible) {
    action = inactiveActionFor(blockers, input.existingState);
  } else if (input.existingState?.sync_status === 'failed') {
    action = 'retry_failed_sync';
  } else if (
    !input.existingState
    || input.existingState.source_version_id !== input.source.source_version_id
    || input.existingState.source_version_hash !== input.source.source_version_hash
    || input.existingState.sync_status !== 'active'
  ) {
    action = 'create_or_update_retell_content';
  } else {
    action = 'noop';
  }

  const syncedAt = input.now instanceof Date
    ? input.now.toISOString()
    : typeof input.now === 'string'
      ? new Date(input.now).toISOString()
      : new Date().toISOString();
  const retellKnowledgeBaseId = input.retell_knowledge_base_id
    ?? input.existingState?.retell_knowledge_base_id
    ?? '';
  const retellSourceId = input.retell_source_id ?? input.existingState?.retell_source_id ?? null;

  const nextState = (hasBlockingModelActor || hasScopeMismatch || hasMissingRetellKbId)
    ? null
    : action === 'noop' && !input.existingState
    ? null
    : buildRetellKbSyncState({
      source: input.source,
      retell_knowledge_base_id: retellKnowledgeBaseId,
      retell_source_id: retellSourceId,
      synced_at: syncedAt,
      sync_status: action === 'disable_retell_content'
        ? 'disabled'
        : action === 'remove_retell_content'
          ? 'removed'
          : action === 'retry_failed_sync'
            ? 'pending'
            : eligibility.eligible && action !== 'noop'
              ? 'active'
              : input.existingState?.sync_status ?? 'pending',
      last_sync_error: blockers.length > 0 ? blockers.join(',') : null,
    });

  const key = action === 'noop' ? null : idempotencyKey(action, input.source, input.existingState);
  return {
    action,
    eligible: eligibility.eligible && !hasBlockingModelActor && !hasScopeMismatch && !hasMissingRetellKbId,
    blockers,
    idempotencyKey: key,
    nextState,
    auditEvent: {
      type: auditTypeFor(action),
      org_id: input.source.org_id || undefined,
      tenant_id: input.source.tenant_id || undefined,
      agent_id: input.source.agent_id || undefined,
      own_source_id: input.source.own_source_id || undefined,
      source_version_id: input.source.source_version_id || undefined,
      retell_knowledge_base_id: retellKnowledgeBaseId || undefined,
      retell_source_id: retellSourceId,
      blockers,
    },
  };
}
