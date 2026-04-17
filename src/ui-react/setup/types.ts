export type SetupSubTab = 'accounts' | 'environments' | 'access' | 'tools';
export type ToolsSubTab = 'sharepoint' | 'temp-tokens' | 'mcp';

export type HealthEntry = {
  status: string;
  summary: string;
  message?: string;
  detail?: string;
  code?: string;
};

export type TokenEntry = { authenticated: boolean; expiresAt?: number | string } | undefined;

export type TemporaryTokenSummary = {
  id: string;
  name: string;
  audience?: string;
  subject?: string;
  tenantId?: string;
  scopes?: string[];
  roles?: string[];
  expiresAt?: number;
  match: { kind: 'origin'; origin: string } | { kind: 'api'; api: string } | { kind: 'audience'; audience: string };
  createdAt: string;
};

export type BrowserProfileStatus = {
  account: string;
  configured: boolean;
  exists: boolean;
  open: boolean;
  profile?: {
    userDataDir?: string;
    lastOpenedAt?: string;
    lastVerifiedAt?: string;
    lastVerificationUrl?: string;
  };
  authenticated?: boolean;
  finalUrl?: string;
};

export type BrowserProfileResult = { data: BrowserProfileStatus };

export type LoginTarget = {
  id?: string;
  api?: string;
  resource?: string;
  label?: string;
  status?: string;
  action?:
    | { kind: 'browser-url'; url: string }
    | { kind: 'device-code'; verificationUri: string; userCode: string; message: string };
  error?: string;
};

export type AuthSession = {
  id: string;
  accountName: string;
  status: 'pending' | 'waiting_for_user' | 'acquiring_token' | 'completed' | 'failed' | 'cancelled';
  targets: LoginTarget[];
  result?: { success?: boolean; diagnostics?: Array<{ message?: string; code?: string; detail?: string }> };
};

export const HEALTH_APIS = ['dv', 'flow', 'graph', 'bap', 'powerapps'] as const;

export const API_SCOPE_OPTIONS = [
  { key: 'dv', label: 'Dataverse' },
  { key: 'flow', label: 'Flow' },
  { key: 'powerapps', label: 'Power Apps' },
  { key: 'bap', label: 'Platform Admin' },
  { key: 'graph', label: 'Graph' },
] as const;

export const SETUP_SUB_TAB_LABELS: Record<SetupSubTab, string> = {
  accounts: 'Accounts',
  environments: 'Environments',
  access: 'My Access',
  tools: 'Tools',
};

export const TOOLS_SUB_TAB_LABELS: Record<ToolsSubTab, string> = {
  sharepoint: 'SharePoint',
  'temp-tokens': 'Temporary Tokens',
  mcp: 'MCP',
};
