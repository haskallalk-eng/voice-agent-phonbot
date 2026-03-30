const BASE = '/api';

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('vas_token');
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...authHeader(), ...init?.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// --- Agent Config ---

export type KnowledgeSource = {
  id: string;
  type: 'url' | 'pdf' | 'text';
  name: string;
  content: string; // URL, filename, or raw text
  status?: 'pending' | 'indexed' | 'error';
};

export type ExtractedVariable = {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  required: boolean;
};

export type InboundWebhook = {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
};

export type CallRoutingRule = {
  id: string;
  description: string;       // Natural language: "Wenn der Kunde nach Reklamation fragt..."
  action: 'transfer' | 'hangup' | 'voicemail' | 'ticket';
  target?: string;            // Phone number, department name, etc.
  enabled: boolean;
};

export type CalendarIntegration = {
  provider: 'google' | 'outlook' | 'calcom' | 'caldav';
  connected: boolean;
  email?: string;
  label?: string;
};

export type ApiIntegration = {
  id: string;
  name: string;
  type: 'rest' | 'webhook' | 'zapier';
  baseUrl: string;
  authType: 'none' | 'apikey' | 'bearer' | 'basic';
  authValue?: string;
  description: string;        // What can the agent use this for?
  enabled: boolean;
};

export type LiveWebAccess = {
  enabled: boolean;
  allowedDomains: string[];   // Which domains the agent may crawl live
};

export type AgentConfig = {
  tenantId: string;
  name: string;
  language: 'de' | 'en' | 'fr' | 'es' | 'it' | 'tr' | 'pl' | 'nl';
  voice: string;
  businessName: string;
  businessDescription: string;
  address: string;
  openingHours: string;
  servicesText: string;
  systemPrompt: string;
  tools: string[];
  fallback: { enabled: boolean; reason: string };
  retellAgentId?: string;
  retellLlmId?: string;

  // Knowledge sources
  knowledgeSources?: KnowledgeSource[];

  // Voice & behavior
  speakingSpeed?: number;        // 0.5 – 2.0
  temperature?: number;          // 0 – 1
  maxCallDuration?: number;      // seconds
  backgroundSound?: 'off' | 'office' | 'cafe' | 'nature';
  customVocabulary?: string[];   // domain-specific terms
  enableDtmf?: boolean;
  interruptionMode?: 'allow' | 'hold' | 'block';

  // Recording & privacy
  recordCalls?: boolean;
  dataRetentionDays?: number;    // 0 = don't store, 30/90/365 etc.

  // Variable extraction
  extractedVariables?: ExtractedVariable[];

  // Webhooks
  inboundWebhooks?: InboundWebhook[];

  // Capabilities
  callRoutingRules?: CallRoutingRule[];
  calendarIntegrations?: CalendarIntegration[];
  apiIntegrations?: ApiIntegration[];
  liveWebAccess?: LiveWebAccess;
};

export type AgentPreview = {
  instructions: string;
  tools: string[];
  fallback: { enabled: boolean; reason: string };
};

export type DeployResult = {
  ok: boolean;
  config: AgentConfig;
  retellAgentId?: string;
  retellLlmId?: string;
};

export type WebCallResult = {
  ok: boolean;
  call_id?: string;
  web_call_link?: string;
  access_token?: string;
  error?: string;
  message?: string;
  // Usage-limit error fields
  minutesUsed?: number;
  minutesLimit?: number;
};

export function getAgentConfigs() {
  return request<{ items: AgentConfig[] }>('/agent-configs');
}

export function getAgentConfig(tenantId?: string) {
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  return request<AgentConfig>(`/agent-config${qs}`);
}

export function createNewAgent(base?: Partial<AgentConfig>) {
  return request<AgentConfig>('/agent-config/new', {
    method: 'POST',
    body: JSON.stringify(base ?? {}),
  });
}

export function saveAgentConfig(config: AgentConfig) {
  return request<AgentConfig>('/agent-config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export function deployAgentConfig(config: AgentConfig) {
  return request<DeployResult>('/agent-config/deploy', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export function getAgentPreview() {
  return request<AgentPreview>(`/agent-config/preview`);
}

export function createWebCall() {
  return request<WebCallResult>('/agent-config/web-call', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// --- Demo (no auth) ---

export type DemoTemplate = {
  id: string;
  icon: string;
  name: string;
  description: string;
};

export function getDemoTemplates() {
  return request<{ templates: DemoTemplate[] }>('/demo/templates');
}

export function createDemoCall(templateId: string) {
  return request<{ ok: boolean; call_id?: string; access_token?: string }>('/demo/call', {
    method: 'POST',
    body: JSON.stringify({ templateId }),
  });
}

// --- Phone ---

export function getPhoneNumbers() {
  return request<{ items: PhoneNumber[] }>('/phone');
}

export type PhoneNumber = {
  id: string;
  number: string;
  numberPretty: string;
  status: string;
  // Additional fields returned by the backend
  number_pretty?: string;
  method?: 'direct' | 'forwarding';
  verified?: boolean;
};

export function provisionPhoneNumber(areaCode: string) {
  return request<{ ok: boolean; number: string; numberPretty: string }>('/phone/provision', {
    method: 'POST',
    body: JSON.stringify({ areaCode }),
  });
}

export function setupForwarding(number: string) {
  return request<{ ok: boolean; forwardTo: string; instructions: Record<string, string> }>('/phone/forward', {
    method: 'POST',
    body: JSON.stringify({ number }),
  });
}

export function importTwilioNumber(number: string) {
  return request<{ ok: boolean; number: string; retellPhoneNumberId: string | null }>('/phone/twilio/import', {
    method: 'POST',
    body: JSON.stringify({ number }),
  });
}

export function verifyPhoneNumber(phoneId: string) {
  return request<{ ok: boolean; verified: boolean }>('/phone/verify', {
    method: 'POST',
    body: JSON.stringify({ phoneId }),
  });
}

// --- Chat ---

export type ChatReply = { ok: boolean; reply: string };

export function sendChat(sessionId: string, text: string, tenantId = 'demo') {
  return request<ChatReply>('/chat', {
    method: 'POST',
    body: JSON.stringify({ sessionId, text, tenantId }),
  });
}

export type ConversationMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
};

export function getChatHistory(sessionId: string, tenantId = 'demo') {
  return request<{ sessionId: string; messages: ConversationMessage[] }>(
    `/chat/${encodeURIComponent(sessionId)}/history?tenantId=${encodeURIComponent(tenantId)}`,
  );
}

export function clearChat(sessionId: string) {
  return request<{ ok: boolean }>(`/chat/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

// --- Tickets ---

export type Ticket = {
  id: number;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  status: 'open' | 'assigned' | 'done';
  source: string | null;
  session_id: string | null;
  reason: string | null;
  customer_name: string | null;
  customer_phone: string;
  preferred_time: string | null;
  service: string | null;
  notes: string | null;
};

export function getTickets(limit = 50) {
  return request<{ items: Ticket[] }>(`/tickets?limit=${limit}`);
}

export function updateTicketStatus(id: number, status: Ticket['status']) {
  return request<Ticket>(`/tickets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function triggerTicketCallback(id: number) {
  return request<{ ok: boolean; callId?: string; error?: string }>(`/tickets/${id}/callback`, {
    method: 'POST',
    body: '{}',
  });
}

// --- Retell Calls ---

export type RetellCall = {
  call_id: string;
  agent_id: string;
  call_type: string;
  call_status: string;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  transcript?: string;
  recording_url?: string;
  call_analysis?: unknown;
  disconnection_reason?: string;
};

export function getCalls() {
  return request<{ items: RetellCall[] }>(`/calls`);
}

export function getCall(callId: string) {
  return request<RetellCall>(`/calls/${encodeURIComponent(callId)}`);
}

// --- Calendar ---

export function getCalendarStatus() {
  return request<{ connected: boolean; provider: string | null; email: string | null }>('/calendar/status');
}

export function connectCalcom(apiKey: string) {
  return request<{ ok: boolean; email?: string; username?: string }>('/calendar/calcom/connect', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  });
}

export function disconnectCalendar() {
  return request<{ ok: boolean }>('/calendar/disconnect', { method: 'DELETE' });
}

export function getGoogleCalendarAuthUrl() {
  return request<{ url: string }>('/calendar/google/auth-url');
}

export function getMicrosoftCalendarAuthUrl() {
  return request<{ url: string }>('/calendar/microsoft/auth-url');
}

// --- Billing ---

export type Plan = {
  id: string;
  name: string;
  price: number;
  minutesLimit: number;
  agentsLimit: number;
  hasYearly?: boolean;
};

export type BillingStatus = {
  plan: string;
  planName: string;
  planStatus: string;
  planInterval: string | null;
  currentPeriodEnd: string | null;
  minutesUsed: number;
  minutesLimit: number;
  minutesRemaining: number;
};

export function getBillingPlans() {
  return request<{ plans: Plan[] }>('/billing/plans');
}

export function getBillingStatus() {
  return request<BillingStatus>('/billing/status');
}

export function createCheckoutSession(planId: string, interval: 'month' | 'year' = 'month') {
  return request<{ url: string }>('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ planId, interval }),
  });
}

export function deleteAccount() {
  return request<{ ok: boolean }>('/auth/account', { method: 'DELETE', body: '{}' });
}

export function createPortalSession() {
  return request<{ url: string }>('/billing/portal', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// --- Voices ---

export type Voice = {
  voice_id: string;
  voice_name: string;
  voice_type: 'built_in' | 'cloned';
  provider?: string;
  accent?: string;
  gender?: string;
  age?: string;
  preview_audio_url?: string;
};

export function getVoices() {
  return request<{ voices: Voice[] }>('/voices');
}

export async function cloneVoice(name: string, audioFile: File, provider = 'elevenlabs'): Promise<Voice> {
  const form = new FormData();
  form.append('name', name);
  form.append('provider', provider);
  form.append('audio', audioFile);
  const token = localStorage.getItem('vas_token');
  const res = await fetch('/api/voices/clone', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<Voice>;
}

// --- Insights ---

export type BadMoment = {
  quote: string;
  issue: string;
  category: string;
  prompt_fix: string;
};

export type CallAnalysis = {
  call_id: string;
  score: number;
  bad_moments: BadMoment[];
  overall_feedback: string;
  created_at: string;
};

export type PromptSuggestion = {
  id: string;
  category: string;
  issue_summary: string;
  suggested_addition: string;
  occurrence_count: number;
  status: 'pending' | 'applied' | 'rejected' | 'auto_applied';
  applied_at: string | null;
  created_at: string;
};

export type PromptVersion = {
  id: string;
  reason: string;
  avg_score: number | null;
  call_count: number;
  prompt_preview: string;
  created_at: string;
};

export type AbTest = {
  id: string;
  status: 'running' | 'promoted' | 'rejected';
  decision_reason: string | null;
  control_avg_score: number | null;
  variant_avg_score: number | null;
  calls_target: number;
  variant_calls: number;
  created_at: string;
  completed_at: string | null;
};

export type InsightsData = {
  avg_score: number | null;
  trend: { direction: 'up' | 'down' | 'stable'; delta: number } | null;
  auto_apply_threshold: number;
  total_analyses: number;
  analyses: CallAnalysis[];
  suggestions: PromptSuggestion[];
  prompt_versions: PromptVersion[];
  ab_tests: AbTest[];
};

export function getInsights() {
  return request<InsightsData>('/insights');
}

export function applyInsightSuggestion(id: string) {
  return request<{ ok: boolean }>(`/insights/suggestions/${encodeURIComponent(id)}/apply`, { method: 'POST', body: '{}' });
}

export function rejectInsightSuggestion(id: string) {
  return request<{ ok: boolean }>(`/insights/suggestions/${encodeURIComponent(id)}/reject`, { method: 'POST', body: '{}' });
}

export function restorePromptVersion(id: string) {
  return request<{ ok: boolean }>(`/insights/versions/${encodeURIComponent(id)}/restore`, { method: 'POST', body: '{}' });
}

export function triggerConsolidation() {
  return request<{ ok: boolean }>(`/insights/consolidate`, { method: 'POST', body: '{}' });
}

// --- Outbound ---

export type OutboundCall = {
  id: string;
  call_id: string | null;
  to_number: string;
  contact_name: string | null;
  campaign: string | null;
  outcome: 'converted' | 'interested' | 'callback' | 'not_interested' | 'no_answer' | 'voicemail' | null;
  duration_s: number | null;
  conv_score: number | null;
  prompt_version: number;
  status: string;
  created_at: string;
};

export type OutboundStats = {
  total: number;
  converted: number;
  interested: number;
  notInterested: number;
  noAnswer: number;
  conversionRate: number;
  avgScore: number | null;
};

export type OutboundSuggestion = {
  id: string;
  category: string;
  issue_summary: string;
  suggested_change: string;
  occurrence_count: number;
  conv_lift_est: number | null;
  status: 'pending' | 'applied' | 'rejected' | 'auto_applied';
  created_at: string;
};

export type OutboundPromptVersion = {
  version: number;
  reason: string;
  avg_conv_score: number | null;
  call_count: number;
  prompt_preview: string;
  created_at: string;
};

export function triggerSalesCall(toNumber: string, contactName?: string, campaign?: string, campaignContext?: string) {
  return request<{ ok: boolean; callId?: string; outboundRecordId?: string }>('/outbound/call', {
    method: 'POST',
    body: JSON.stringify({ toNumber, contactName, campaign, campaignContext }),
  });
}

export function getOutboundCalls() {
  return request<{ items: OutboundCall[] }>('/outbound/calls');
}

export function getOutboundStats() {
  return request<OutboundStats>('/outbound/stats');
}

export function getOutboundPrompt() {
  return request<{ prompt: string; version: number; history: OutboundPromptVersion[] }>('/outbound/prompt');
}

export function getOutboundSuggestions() {
  return request<{ items: OutboundSuggestion[] }>('/outbound/suggestions');
}

export function applyOutboundSuggestion(id: string) {
  return request<{ ok: boolean }>(`/outbound/suggestions/${encodeURIComponent(id)}/apply`, { method: 'POST', body: '{}' });
}

export function rejectOutboundSuggestion(id: string) {
  return request<{ ok: boolean }>(`/outbound/suggestions/${encodeURIComponent(id)}/reject`, { method: 'POST', body: '{}' });
}

export function updateOutboundOutcome(callId: string, outcome: OutboundCall['outcome']) {
  return request<{ ok: boolean }>(`/outbound/call/${encodeURIComponent(callId)}/outcome`, {
    method: 'POST',
    body: JSON.stringify({ outcome }),
  });
}

// --- Auth helpers ---

export function forgotPassword(email: string) {
  return request<{ ok: boolean }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token: string, password: string) {
  return request<{ ok: boolean }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

export function resendVerification() {
  return request<{ ok: boolean }>('/auth/resend-verification', { method: 'POST', body: '{}' });
}
