const trustedScopeBrand: unique symbol = Symbol('TrustedScope');

export type TrustedScope = {
  orgId: string;
  tenantId: string;
  agentId: string;
  callId?: string;
  sessionId?: string;
  source: 'server';
  resolvedFrom: 'call_registry' | 'session_registry' | 'authenticated_request' | 'internal_job';
  readonly [trustedScopeBrand]: true;
};

export type TrustedScopeInput = Omit<TrustedScope, typeof trustedScopeBrand>;
export type UntrustedToolArgs = Record<string, unknown>;

const SCOPE_LIKE_TOOL_ARG_FIELDS = [
  'orgId',
  'tenantId',
  'agentId',
  'callId',
  'sessionId',
  'source',
  'resolvedFrom',
  'customerId',
  'customerIdentity',
  'authorization',
  'authContext',
] as const;

export const knowledgeSearchTrustedScopeArgFields = [...SCOPE_LIKE_TOOL_ARG_FIELDS];

function requireNonEmptyScopeValue(value: string, field: 'orgId' | 'tenantId'): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`TrustedScope.${field} is required`);
  return trimmed;
}

function requireNonEmptyOptionalScopeValue(value: string | undefined, field: 'agentId'): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`TrustedScope.${field} is required`);
  return trimmed;
}

export function createTrustedScope(input: TrustedScopeInput): TrustedScope {
  return {
    ...input,
    orgId: requireNonEmptyScopeValue(input.orgId, 'orgId'),
    tenantId: requireNonEmptyScopeValue(input.tenantId, 'tenantId'),
    agentId: requireNonEmptyOptionalScopeValue(input.agentId, 'agentId'),
    callId: input.callId?.trim() || undefined,
    sessionId: input.sessionId?.trim() || undefined,
    source: 'server',
    [trustedScopeBrand]: true,
  };
}

export function isTrustedScope(value: unknown): value is TrustedScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const scope = value as TrustedScope;
  return scope[trustedScopeBrand] === true
    && scope.source === 'server'
    && typeof scope.orgId === 'string'
    && scope.orgId.trim().length > 0
    && typeof scope.tenantId === 'string'
    && scope.tenantId.trim().length > 0
    && typeof scope.agentId === 'string'
    && scope.agentId.trim().length > 0
    && (
      scope.resolvedFrom === 'call_registry' ||
      scope.resolvedFrom === 'session_registry' ||
      scope.resolvedFrom === 'authenticated_request' ||
      scope.resolvedFrom === 'internal_job'
    );
}

export function scopeLikeToolArgFields(args: UntrustedToolArgs): string[] {
  return SCOPE_LIKE_TOOL_ARG_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(args, field));
}

export function stripScopeLikeToolArgs(args: UntrustedToolArgs): UntrustedToolArgs {
  const clean: UntrustedToolArgs = { ...args };
  for (const field of SCOPE_LIKE_TOOL_ARG_FIELDS) delete clean[field];
  return clean;
}
