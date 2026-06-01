import { readFileSync } from 'node:fs';

type OwnKbRolloutConfig = {
  tenantId?: string | null;
  retellAgentId?: string | null;
  kbProvider?: unknown;
  shadowEnabled?: unknown;
  canaryEnabled?: unknown;
};

type OwnKbRolloutScope = {
  orgId?: string | null;
  tenantId?: string | null;
  agentId?: string | null;
};

function envFlag(name: string): boolean {
  return (process.env[name] ?? '').trim() === 'true';
}

function envValue(name: string): string {
  return (process.env[name] ?? '').trim();
}

function envNumberAtLeast(name: string, minimum: number): boolean {
  const parsed = Number.parseInt((process.env[name] ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed >= minimum;
}

function envEvidenceId(name: string): boolean {
  const value = envValue(name);
  return /^[a-z0-9][a-z0-9._:-]{7,127}$/i.test(value) &&
    !/^(true|false|yes|no|on|off|none|null|\*)$/i.test(value);
}

function envSha256(name: string): boolean {
  return /^[a-f0-9]{64}$/i.test(envValue(name));
}

function envDecision(name: string, allowed: string[]): boolean {
  const value = envValue(name);
  return allowed.includes(value);
}

type OwnKbPromotionKind = 'canary' | 'primary';

type OwnKbPromotionAttestation = {
  artifactId?: unknown;
  artifactSha256?: unknown;
  decision?: unknown;
  promotionEvidenceUsable?: unknown;
};

function attestationEnvName(kind: OwnKbPromotionKind): string {
  return kind === 'canary'
    ? 'OWN_KB_CANARY_APPROVED_0_5B_ATTESTATION_PATH'
    : 'OWN_KB_PRIMARY_APPROVED_0_5B_ATTESTATION_PATH';
}

function artifactIdEnvName(kind: OwnKbPromotionKind): string {
  return kind === 'canary'
    ? 'OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_ID'
    : 'OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_ID';
}

function artifactShaEnvName(kind: OwnKbPromotionKind): string {
  return kind === 'canary'
    ? 'OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_SHA256'
    : 'OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_SHA256';
}

function decisionEnvName(kind: OwnKbPromotionKind): string {
  return kind === 'canary'
    ? 'OWN_KB_CANARY_APPROVED_0_5B_DECISION'
    : 'OWN_KB_PRIMARY_APPROVED_0_5B_DECISION';
}

function readPromotionAttestation(kind: OwnKbPromotionKind): OwnKbPromotionAttestation | null {
  const path = envValue(attestationEnvName(kind));
  if (!path) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as OwnKbPromotionAttestation;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function persistedPromotionAttestationMatches(kind: OwnKbPromotionKind, allowedDecisions: string[]): boolean {
  const attestation = readPromotionAttestation(kind);
  const artifactId = envValue(artifactIdEnvName(kind));
  const artifactSha256 = envValue(artifactShaEnvName(kind)).toLowerCase();
  const decision = envValue(decisionEnvName(kind));
  return attestation?.promotionEvidenceUsable === true &&
    attestation.artifactId === artifactId &&
    typeof attestation.artifactSha256 === 'string' &&
    attestation.artifactSha256.toLowerCase() === artifactSha256 &&
    attestation.decision === decision &&
    allowedDecisions.includes(decision);
}

function envListIncludes(name: string, value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim();
  if (!normalized) return false;
  return (process.env[name] ?? '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .some((item) => item === normalized);
}

export function configRequestsOwnKbRollout(config: OwnKbRolloutConfig): boolean {
  return config.kbProvider === 'own_kb_shadow' ||
    config.kbProvider === 'own_kb_primary' ||
    config.shadowEnabled === true ||
    config.canaryEnabled === true;
}

export function ownKbRolloutAllowedForScope(scope: OwnKbRolloutScope): boolean {
  return envFlag('OWN_KB_ROLLOUT_ALLOW_ALL') ||
    envListIncludes('OWN_KB_ROLLOUT_ALLOWED_ORG_IDS', scope.orgId) ||
    envListIncludes('OWN_KB_ROLLOUT_ALLOWED_TENANT_IDS', scope.tenantId) ||
    envListIncludes('OWN_KB_ROLLOUT_ALLOWED_AGENT_IDS', scope.agentId);
}

export function ownKbCanaryPromotionGatesPassed(): boolean {
  const allowedDecisions = ['owkb_canary_candidate', 'owkb_primary_candidate'];
  return envFlag('OWN_KB_CANARY_DEPLOY_UNLOCKED') &&
    envEvidenceId('OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_ID') &&
    envSha256('OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_SHA256') &&
    envDecision('OWN_KB_CANARY_APPROVED_0_5B_DECISION', allowedDecisions) &&
    persistedPromotionAttestationMatches('canary', allowedDecisions) &&
    envFlag('OWN_KB_PRIMARY_RETELL_STANDBY_READY') &&
    envFlag('OWN_KB_PRIMARY_ROLLBACK_TESTED') &&
    envFlag('OWN_KB_PRIMARY_KILL_SWITCH_TESTED') &&
    envFlag('OWN_KB_PRIMARY_PRODUCT_KPI_GATES_PASSED') &&
    envFlag('OWN_KB_PRIMARY_EXCEPTION_PATH_SLO_REPORTED');
}

export function ownKbPrimaryPromotionGatesPassed(): boolean {
  const allowedDecisions = ['owkb_primary_candidate'];
  return ownKbCanaryPromotionGatesPassed() &&
    envFlag('OWN_KB_PRIMARY_DEPLOY_UNLOCKED') &&
    envEvidenceId('OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_ID') &&
    envSha256('OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_SHA256') &&
    envValue('OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_ID') !== envValue('OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_ID') &&
    envValue('OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_SHA256') !== envValue('OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_SHA256') &&
    envDecision('OWN_KB_PRIMARY_APPROVED_0_5B_DECISION', allowedDecisions) &&
    persistedPromotionAttestationMatches('primary', allowedDecisions) &&
    envNumberAtLeast('OWN_KB_PRIMARY_CANARY_WITHOUT_P0_DAYS', 14) &&
    envNumberAtLeast('OWN_KB_PRIMARY_RETELL_STANDBY_DAYS', 14) &&
    envFlag('OWN_KB_PRIMARY_NO_UNRESOLVED_P1') &&
    envFlag('OWN_KB_PRIMARY_LATENCY_GATES_PASSED') &&
    envFlag('OWN_KB_PRIMARY_QUALITY_GATES_PASSED') &&
    envFlag('OWN_KB_PRIMARY_SAFETY_GATES_PASSED');
}

export function ownKbPromotionEvidenceHashMatches(kind: 'canary' | 'primary', artifactHash?: string | null): boolean {
  const expected = envValue(kind === 'canary'
    ? 'OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_SHA256'
    : 'OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_SHA256');
  return /^[a-f0-9]{64}$/i.test(artifactHash ?? '') && expected.toLowerCase() === (artifactHash ?? '').toLowerCase();
}

export function ownKbSearchCallableForConfig(
  config: OwnKbRolloutConfig,
  scope: Pick<OwnKbRolloutScope, 'orgId'> = {},
): boolean {
  return process.env.OWN_KB_SEARCH_ENABLED === 'true' &&
    (
      (config.kbProvider === 'own_kb_primary' && ownKbPrimaryPromotionGatesPassed()) ||
      (config.kbProvider !== 'own_kb_primary' && config.canaryEnabled === true && ownKbCanaryPromotionGatesPassed())
    ) &&
    ownKbRolloutAllowedForScope({
      orgId: scope.orgId,
      tenantId: config.tenantId,
      agentId: config.retellAgentId,
    });
}

export function assertOwnKbRolloutAllowed(config: OwnKbRolloutConfig, orgId?: string | null): void {
  if (!configRequestsOwnKbRollout(config)) return;
  if (ownKbRolloutAllowedForScope({
    orgId,
    tenantId: config.tenantId,
    agentId: config.retellAgentId,
  })) {
    if (config.kbProvider === 'own_kb_primary') {
      if (ownKbPrimaryPromotionGatesPassed()) return;
      const err = new Error('OWN_KB_PRIMARY_PROMOTION_GATES_NOT_PASSED') as Error & { statusCode?: number };
      err.statusCode = 403;
      throw err;
    }
    if (config.canaryEnabled === true) {
      if (ownKbCanaryPromotionGatesPassed()) return;
      const err = new Error('OWN_KB_CANARY_PROMOTION_GATES_NOT_PASSED') as Error & { statusCode?: number };
      err.statusCode = 403;
      throw err;
    }
    return;
  }
  const err = new Error('OWN_KB_ROLLOUT_NOT_ALLOWED') as Error & { statusCode?: number };
  err.statusCode = 403;
  throw err;
}
