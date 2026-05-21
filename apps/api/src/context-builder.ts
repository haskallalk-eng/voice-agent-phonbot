import { buildCurrentDateDynamicVariables } from './time-context.js';

export type VoiceContext = {
  time: ReturnType<typeof buildCurrentDateDynamicVariables>;
  org: {
    orgId: string | null;
    businessName: string;
    language: string;
  };
  rag: {
    enabled: boolean;
    rule: 'facts_only_never_permission';
  };
};

export function buildVoiceContext(input: {
  orgId?: string | null;
  businessName?: string | null;
  language?: string | null;
  ragEnabled?: boolean;
  now?: Date;
} = {}): VoiceContext {
  return {
    time: buildCurrentDateDynamicVariables(input.now),
    org: {
      orgId: input.orgId ?? null,
      businessName: input.businessName?.trim() || 'dieses Unternehmen',
      language: input.language?.trim() || 'de-DE',
    },
    rag: {
      enabled: input.ragEnabled === true,
      rule: 'facts_only_never_permission',
    },
  };
}

