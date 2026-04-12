import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, formDataObject, formatTimeRemaining, optionList } from './utils.js';
import { CopyButton, copyTextToClipboard } from './CopyButton.js';
import { RecordDetailModal, useRecordDetail } from './RecordDetailModal.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastFn = (message: string, isError?: boolean) => void;

type SetupTabProps = {
  shellData: any;
  globalEnvironment: string;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
};

type SetupSubTab = 'status' | 'accounts' | 'environments' | 'access' | 'mcp';

type HealthEntry = { status: string; summary: string; message?: string; detail?: string; code?: string };

type TokenEntry = { authenticated: boolean; expiresAt?: number | string } | undefined;

type LoginTarget = {
  api?: string;
  resource?: string;
  label?: string;
  url?: string;
  status?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEALTH_APIS = ['dv', 'flow', 'graph', 'bap', 'powerapps'] as const;

const API_SCOPE_OPTIONS = [
  { key: 'dv', label: 'Dataverse' },
  { key: 'flow', label: 'Flow' },
  { key: 'powerapps', label: 'Power Apps & BAP' },
  { key: 'graph', label: 'Graph' },
] as const;

const SETUP_SUB_TAB_LABELS: Record<SetupSubTab, string> = {
  status: 'Status',
  accounts: 'Accounts',
  environments: 'Environments',
  access: 'My Access',
  mcp: 'MCP',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeHealthFailure(payload: any): HealthEntry {
  const diagnostic = Array.isArray(payload?.diagnostics) ? payload.diagnostics[0] : null;
  const message = diagnostic?.message || 'Health check failed';
  const detail = diagnostic?.detail || '';
  const summary = /Interactive authentication is disabled/i.test(message)
    ? 'Needs login for this API'
    : /returned 401/i.test(message) || /returned 403/i.test(message)
      ? 'Permission or consent required'
      : /returned 404/i.test(message)
        ? 'API endpoint unavailable'
        : message;
  return { status: 'error', summary, message, detail, code: diagnostic?.code || '' };
}

function healthHint(entry: HealthEntry): string | null {
  if (entry.status === 'ok' || entry.status === 'pending') return null;
  if (/Needs login/i.test(entry.summary)) return 'Re-authenticate this account to grant access.';
  if (/Permission or consent/i.test(entry.summary)) return 'Check API permissions or admin consent for this app registration.';
  if (/endpoint unavailable/i.test(entry.summary)) return 'This API may not be enabled for the environment.';
  if (entry.detail) return entry.detail;
  return entry.message || null;
}

// ---------------------------------------------------------------------------
// Shared login-job polling
// ---------------------------------------------------------------------------

function useLoginJob(toast: ToastFn, refreshState: (silent?: boolean) => Promise<void>) {
  const [activeLoginJobId, setActiveLoginJobId] = useState<string | null>(null);
  const [loginTargets, setLoginTargets] = useState<LoginTarget[]>([]);
  const [deviceCode, setDeviceCode] = useState<any>(null);

  async function waitForLoginJob(jobId: string) {
    let parseFailures = 0;
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        headers: { 'content-type': 'application/json' },
      });
      const text = await response.text();
      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch {
        parseFailures++;
        if (parseFailures > 3) { toast('Login response could not be parsed', true); return; }
        continue;
      }
      parseFailures = 0;
      if (payload.data?.deviceCode) setDeviceCode(payload.data.deviceCode);
      if (payload.data?.metadata?.loginTargets) setLoginTargets(payload.data.metadata.loginTargets);
      if (payload.data?.status === 'completed' || payload.data?.status === 'failed') {
        if (payload.data.status === 'failed') toast('Login failed', true);
        return;
      }
    }
  }

  function handleLoginStarted(jobId: string, targets: LoginTarget[]) {
    setActiveLoginJobId(jobId);
    setLoginTargets(targets);
    waitForLoginJob(jobId).then(() => {
      setActiveLoginJobId(null);
      setLoginTargets([]);
      setDeviceCode(null);
      refreshState(true);
      toast('Authentication complete');
    });
  }

  async function handleCancelLogin() {
    if (!activeLoginJobId) return;
    try {
      await api(`/api/jobs/${encodeURIComponent(activeLoginJobId)}/cancel`, { method: 'POST' });
    } catch { /* ignore */ }
    setActiveLoginJobId(null);
    setLoginTargets([]);
    setDeviceCode(null);
  }

  return { activeLoginJobId, loginTargets, deviceCode, handleLoginStarted, handleCancelLogin };
}

// ---------------------------------------------------------------------------
// AccountCard
// ---------------------------------------------------------------------------

function AccountCard(props: {
  account: any;
  expanded: boolean;
  tokenStatus: TokenEntry;
  selectedApis: Record<string, boolean>;
  globalEnvironment: string;
  onToggle: () => void;
  onLoginStarted: (jobId: string, targets: LoginTarget[]) => void;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { account, expanded, tokenStatus: token, selectedApis, globalEnvironment, onToggle, onLoginStarted, refreshState, toast } = props;
  const interactive = account.kind === 'user' || account.kind === 'device-code';
  const tokenClass = token === undefined ? 'pending' : token?.authenticated ? 'ok' : 'error';
  const expiry = token?.authenticated ? formatTimeRemaining(token.expiresAt) : null;

  async function handleLogin() {
    try {
      const started = await api<any>('/api/jobs/account-login', {
        method: 'POST',
        body: JSON.stringify({
          name: account.name,
          kind: 'user',
          environmentAlias: globalEnvironment || undefined,
          excludeApis: ['dv', 'flow', 'powerapps', 'graph'].filter((name) => !selectedApis[name]),
        }),
      });
      onLoginStarted(started.data.id, started.data.metadata?.loginTargets || []);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function handleRemove() {
    if (!confirm(`Remove account "${account.name}"?`)) return;
    try {
      await api(`/api/accounts/${encodeURIComponent(account.name)}`, { method: 'DELETE' });
      toast('Account removed');
      await refreshState(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api(`/api/accounts/${encodeURIComponent(account.name)}`, {
        method: 'PUT',
        body: JSON.stringify(formDataObject(event.currentTarget)),
      });
      toast('Account updated');
      await refreshState(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  return (
    <div className={`account-card ${expanded ? 'expanded' : ''}`} data-account-card={account.name}>
      <div className="account-card-head" onClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        onToggle();
      }}>
        <div className="account-card-identity">
          <span><span className={`health-dot ${tokenClass}`}></span></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="account-card-name">{account.name}</span>
              <span className="badge">{account.kind}</span>
            </div>
            {account.accountUsername || account.loginHint ? (
              <div className="account-card-email">{account.accountUsername || account.loginHint}</div>
            ) : null}
            <div>{expiry ? <span className={`token-expiry ${expiry.cls || ''}`}>{expiry.text}</span> : null}</div>
          </div>
        </div>
        <div className="account-card-actions">
          {interactive ? (
            <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={handleLogin}>Login</button>
          ) : null}
          <button className="btn btn-danger" type="button" onClick={handleRemove}>Remove</button>
        </div>
      </div>
      <div className="account-card-body">
        <form onSubmit={handleEditSubmit}>
          <input type="hidden" name="name" defaultValue={account.name} />
          <input type="hidden" name="kind" defaultValue={account.kind} />
          <div className="form-row">
            <div className="field"><span className="field-label">Description</span><input name="description" defaultValue={account.description || ''} placeholder="Optional" /></div>
            <div className="field"><span className="field-label">Login Hint</span><input name="loginHint" defaultValue={account.loginHint || ''} placeholder="user@example.com" /></div>
          </div>
          <div className="form-row">
            <div className="field"><span className="field-label">Tenant ID</span><input name="tenantId" defaultValue={account.tenantId || ''} /></div>
            <div className="field"><span className="field-label">Client ID</span><input name="clientId" defaultValue={account.clientId || ''} /></div>
          </div>
          <div className="btn-group"><button type="submit" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '5px 12px' }}>Save Changes</button></div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddAccountForm  (with progressive disclosure)
// ---------------------------------------------------------------------------

function AddAccountForm(props: {
  accounts: any[];
  selectedApis: Record<string, boolean>;
  setSelectedApis: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  globalEnvironment: string;
  onLoginStarted: (jobId: string, targets: LoginTarget[]) => void;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { accounts, selectedApis, setSelectedApis, globalEnvironment, onLoginStarted, refreshState, toast } = props;
  const [accountKind, setAccountKind] = useState('user');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload: any = formDataObject(form);
    payload.kind = accountKind;
    if (accountKind === 'user' || accountKind === 'device-code') {
      payload.excludeApis = ['dv', 'flow', 'powerapps', 'graph'].filter((name) => !selectedApis[name]);
    }
    try {
      const response = await api<any>('/api/accounts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      toast('Account saved');
      await refreshState(true);
      if (response.data?.loginJobId) {
        onLoginStarted(response.data.loginJobId, response.data.loginTargets || []);
      }
      form.reset();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  const isInteractive = accountKind === 'user' || accountKind === 'device-code';
  const showTenantClient = isInteractive || accountKind === 'client-secret';

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      <div className="form-row">
        <div className="field"><span className="field-label">Name</span><input name="name" required placeholder="my-work-account" /></div>
        <div className="field"><span className="field-label">Login Hint</span><input name="loginHint" placeholder="user@example.com" /></div>
      </div>
      <div className="form-row">
        <div className="field"><span className="field-label">Description</span><input name="description" placeholder="Optional" /></div>
        <div className="field"></div>
      </div>

      {isInteractive ? (
        <div className="field">
          <span className="field-label">API Scopes to Authenticate</span>
          <div className="api-scope-checks">
            {API_SCOPE_OPTIONS.map((scope) => (
              <label key={scope.key} className="api-scope-check">
                <input
                  type="checkbox"
                  value={scope.key}
                  checked={selectedApis[scope.key]}
                  onChange={(event) => setSelectedApis((current) => ({ ...current, [scope.key]: event.target.checked }))}
                />
                {scope.label}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="btn btn-ghost setup-advanced-toggle"
        onClick={() => setShowAdvanced(!showAdvanced)}
        style={{ fontSize: '0.75rem', padding: '4px 0', marginBottom: showAdvanced ? 12 : 0, color: 'var(--muted)' }}
      >
        {showAdvanced ? 'Hide advanced options' : 'Advanced options'}
      </button>

      {showAdvanced ? (
        <div className="setup-advanced-fields">
          <div className="form-row">
            <div className="field">
              <span className="field-label">Authentication Method</span>
              <select name="kind" value={accountKind} onChange={(event) => setAccountKind(event.target.value)}>
                <option value="user">Interactive (browser login)</option>
                <option value="device-code">Device code</option>
                <option value="client-secret">Client secret</option>
                <option value="environment-token">Environment token variable</option>
                <option value="static-token">Static token</option>
              </select>
            </div>
            <div className="field"></div>
          </div>

          {showTenantClient ? (
            <div className="form-row">
              <div className="field"><span className="field-label">Tenant ID</span><input name="tenantId" placeholder="defaults to common" /></div>
              <div className="field"><span className="field-label">Client ID</span><input name="clientId" placeholder="defaults to built-in app" /></div>
            </div>
          ) : null}

          {isInteractive ? (
            <>
              <div className="form-row">
                <div className="field"><span className="field-label">Preferred Flow</span><select name="preferredFlow"><option value="interactive">interactive</option><option value="device-code">device-code</option></select></div>
                <div className="field"><span className="field-label">Prompt</span><select name="prompt"><option value="">default</option><option value="select_account">select_account</option><option value="login">login</option><option value="consent">consent</option><option value="none">none</option></select></div>
              </div>
              <div className="check-row"><input type="checkbox" name="forcePrompt" id="forcePrompt" /><label htmlFor="forcePrompt">Force prompt on next login</label></div>
              {accountKind === 'user' ? <div className="check-row"><input type="checkbox" name="fallbackToDeviceCode" id="fallbackToDeviceCode" /><label htmlFor="fallbackToDeviceCode">Allow fallback to device code</label></div> : null}
            </>
          ) : null}

          {accountKind === 'client-secret' ? <div className="field"><span className="field-label">Client Secret Env Var</span><input name="clientSecretEnv" placeholder="MY_CLIENT_SECRET" /></div> : null}
          {accountKind === 'environment-token' ? <div className="field"><span className="field-label">Token Env Var</span><input name="environmentVariable" placeholder="MY_TOKEN_VAR" /></div> : null}
          {accountKind === 'static-token' ? <div className="field"><span className="field-label">Static Token</span><textarea name="token" placeholder="Paste token"></textarea></div> : null}
        </div>
      ) : null}

      <div className="btn-group" style={{ marginTop: 12 }}>
        <button type="submit" className="btn btn-primary">Save & Login</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// LoginProgress  (step-through UX)
// ---------------------------------------------------------------------------

function LoginProgress(props: {
  loginTargets: LoginTarget[];
  deviceCode: any;
  onCancel: () => void;
  toast: ToastFn;
}) {
  const { loginTargets, deviceCode, onCancel, toast } = props;

  const completedCount = loginTargets.filter((t) => t.status === 'completed').length;
  const total = loginTargets.length;
  const currentTarget = loginTargets.find((t) => t.status === 'running' && t.url);
  const currentIndex = currentTarget ? loginTargets.indexOf(currentTarget) + 1 : completedCount + 1;

  return (
    <div className="login-progress-panel">
      <div className="login-progress-header">
        <div className="login-progress-title">
          {completedCount === total && total > 0
            ? 'Authentication complete'
            : currentTarget
              ? `Signing in to ${currentTarget.label || currentTarget.api || 'service'}... (${currentIndex} of ${total})`
              : 'Waiting for sign-in links...'}
        </div>
        <div className="login-progress-actions">
          <button type="button" className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => {
            const links = loginTargets.filter((t) => t.url).map((t) => `${t.label || t.api || t.resource}: ${t.url}`);
            void copyTextToClipboard(links.join('\n'))
              .then(() => toast('Copied login URLs'))
              .catch((error) => toast(`Copy failed: ${error instanceof Error ? error.message : String(error)}`, true));
          }}>Copy URLs</button>
          <button type="button" className="btn btn-danger" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={onCancel}>Cancel</button>
        </div>
      </div>

      {deviceCode ? (
        <div className="device-code-card">
          <div className="device-code-instruction">Go to the following URL and enter the code to sign in:</div>
          <div className="device-code-url-row">
            <a href={deviceCode.verificationUri} target="_blank" rel="noreferrer" className="device-code-url">{deviceCode.verificationUri}</a>
            <button type="button" className="btn btn-ghost device-code-open-btn" onClick={() => window.open(deviceCode.verificationUri, '_blank', 'noreferrer')}>Open</button>
            <CopyButton value={deviceCode.verificationUri} label="Copy URL" title="Copy verification URL" toast={toast} />
          </div>
          <div className="device-code-box">
            <span className="device-code-label">Your code</span>
            <span className="device-code-value">{deviceCode.userCode}</span>
            <CopyButton value={deviceCode.userCode} label="Copy" title="Copy device code" toast={toast} className="btn btn-ghost" />
          </div>
        </div>
      ) : null}

      <div className="login-progress-steps">
        {loginTargets.map((target, index) => {
          const isDone = target.status === 'completed';
          const isActive = target.status === 'running' && !!target.url;
          const isPending = !isDone && !isActive;
          const dotClass = isDone ? 'ok' : isActive ? 'pending' : 'muted';
          return (
            <div key={`${target.resource || target.api || index}`} className={`login-progress-step ${isActive ? 'active' : ''}`}>
              <div className="login-progress-step-head">
                <span className={`health-dot ${dotClass}`}></span>
                <strong>{target.label || target.api || target.resource}</strong>
                <span className={`login-progress-step-badge ${isDone ? 'done' : isActive ? 'active' : 'pending'}`}>
                  {isDone ? 'done' : isActive ? 'action required' : 'pending'}
                </span>
              </div>
              {isActive && target.url ? (
                <a href={target.url} target="_blank" rel="noreferrer" className="login-progress-step-link btn btn-primary" style={{ fontSize: '0.75rem', padding: '5px 12px', display: 'inline-block', marginTop: 6 }}>
                  Open sign-in page
                </a>
              ) : isPending ? (
                <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>Waiting...</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EnvironmentCard  (with inline health feedback)
// ---------------------------------------------------------------------------

function EnvironmentCard(props: {
  environment: any;
  health: Record<string, HealthEntry>;
  tokenStatus: TokenEntry;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { environment, health: envHealth, tokenStatus: accountInfo, refreshState, toast } = props;
  const [expandedHealth, setExpandedHealth] = useState<string | null>(null);
  const accountClass = accountInfo === undefined ? 'pending' : accountInfo?.authenticated ? 'ok' : 'error';
  const accountExpiry = accountInfo?.authenticated ? formatTimeRemaining(accountInfo.expiresAt) : null;

  async function handleRemove() {
    if (!confirm(`Remove environment "${environment.alias}"?`)) return;
    try {
      await api(`/api/environments/${encodeURIComponent(environment.alias)}`, { method: 'DELETE' });
      toast('Environment removed');
      await refreshState(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  return (
    <div className="env-card">
      <div className="env-card-head">
        <div>
          <div className="env-card-title">
            {environment.alias}
            {environment.displayName && environment.displayName !== environment.alias
              ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> {environment.displayName}</span>
              : null}
          </div>
          <div className="env-card-url">{environment.url || ''}</div>
          <div className="env-card-account">
            <span className={`health-dot ${accountClass}`}></span> {environment.account}
            {accountExpiry ? <span className={`token-expiry ${accountExpiry.cls || ''}`}> {accountExpiry.text}</span> : null}
          </div>
        </div>
        <button className="btn btn-danger" type="button" onClick={handleRemove}>Remove</button>
      </div>
      <div className="health-row">
        {HEALTH_APIS.map((apiName) => {
          const state = envHealth?.[apiName];
          const cls = !state || state.status === 'pending' ? 'pending' : state.status === 'ok' ? 'ok' : 'error';
          const isExpanded = expandedHealth === apiName && state?.status === 'error';
          const hint = state ? healthHint(state) : null;
          return (
            <div key={apiName} className="health-item-wrap">
              <button
                className="health-item health-item-btn"
                type="button"
                title={`${apiName}: ${state?.summary || 'Checking...'}`}
                onClick={() => setExpandedHealth(isExpanded ? null : apiName)}
              >
                <span className={`health-dot ${cls}`}></span>{apiName}
              </button>
              {isExpanded && hint ? (
                <div className="health-detail">
                  <span className="health-detail-summary">{state!.summary}</span>
                  <span className="health-detail-hint">{hint}</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddEnvironmentForm  (discovery-first)
// ---------------------------------------------------------------------------

function AddEnvironmentForm(props: {
  accounts: any[];
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { accounts, refreshState, toast } = props;
  const [discoveries, setDiscoveries] = useState<any[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [environmentDraft, setEnvironmentDraft] = useState({
    alias: '',
    account: accounts[0]?.name || '',
    url: '',
    displayName: '',
    accessMode: '',
  });
  const environmentFormRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!environmentDraft.account && accounts[0]?.name) {
      setEnvironmentDraft((current) => ({ ...current, account: accounts[0].name }));
    }
  }, [accounts]);

  async function handleDiscover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const payload = await api<any>('/api/environments/discover', {
        method: 'POST',
        body: JSON.stringify(formDataObject(event.currentTarget)),
      });
      setDiscoveries(payload.data || []);
      toast(`${(payload.data || []).length} environment${(payload.data || []).length === 1 ? '' : 's'} found`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function handleEnvironmentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api<any>('/api/environments', {
        method: 'POST',
        body: JSON.stringify(formDataObject(event.currentTarget)),
      });
      toast('Environment saved');
      await refreshState(true);
      setEnvironmentDraft({ alias: '', account: accounts[0]?.name || '', url: '', displayName: '', accessMode: '' });
      setDiscoveries([]);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  return (
    <div className="add-environment-body">
      <form style={{ marginBottom: 16 }} onSubmit={handleDiscover}>
        <p className="desc" style={{ marginBottom: 10 }}>Select an account to discover available environments automatically.</p>
        <div className="form-row">
          <div className="field">
            <span className="field-label">Account</span>
            <select name="account">
              {optionList(accounts.map((a: any) => a.name), 'select account').map((option) => (
                <option key={`${option.value}-${option.label}`} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ alignSelf: 'end' }}>
            <button type="submit" className="btn btn-primary">Discover Environments</button>
          </div>
        </div>
      </form>

      {discoveries.length ? (
        <div className="card-list" style={{ marginBottom: 16 }}>
          {discoveries.map((item, index) => (
            <div key={index} className="card-item">
              <div className="card-item-info">
                <div className="card-item-title">{item.displayName || item.makerEnvironmentId || 'environment'}</div>
                <div className="card-item-sub">{item.environmentApiUrl || item.environmentUrl || ''}</div>
              </div>
              <button className="btn btn-primary" type="button" style={{ fontSize: '0.75rem', padding: '5px 12px' }} onClick={() => {
                setEnvironmentDraft({
                  alias: item.displayName ? item.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : item.makerEnvironmentId || '',
                  account: item.accountName || '',
                  url: item.environmentApiUrl || item.environmentUrl || '',
                  displayName: item.displayName || '',
                  accessMode: '',
                });
                setShowManual(true);
              }}>Use</button>
            </div>
          ))}
        </div>
      ) : null}

      {!showManual && !discoveries.length ? (
        <button type="button" className="btn btn-ghost" style={{ fontSize: '0.75rem', color: 'var(--muted)', padding: '4px 0' }} onClick={() => setShowManual(true)}>
          Can't find your environment? Enter details manually
        </button>
      ) : null}

      {showManual || environmentDraft.url ? (
        <form ref={environmentFormRef} onSubmit={handleEnvironmentSubmit} style={{ marginTop: showManual && !environmentDraft.url ? 8 : 0 }}>
          <div className="form-row">
            <div className="field"><span className="field-label">Alias</span><input name="alias" required placeholder="dev, prod" value={environmentDraft.alias} onChange={(e) => setEnvironmentDraft((c) => ({ ...c, alias: e.target.value }))} /></div>
            <div className="field"><span className="field-label">Account</span>
              <select name="account" value={environmentDraft.account} onChange={(e) => setEnvironmentDraft((c) => ({ ...c, account: e.target.value }))}>
                {accounts.map((a: any) => <option key={a.name} value={a.name}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="field"><span className="field-label">URL</span><input name="url" required placeholder="https://org.crm.dynamics.com" value={environmentDraft.url} onChange={(e) => setEnvironmentDraft((c) => ({ ...c, url: e.target.value }))} /></div>
            <div className="field"><span className="field-label">Display Name</span><input name="displayName" placeholder="Optional" value={environmentDraft.displayName} onChange={(e) => setEnvironmentDraft((c) => ({ ...c, displayName: e.target.value }))} /></div>
          </div>
          <div className="field"><span className="field-label">Access</span>
            <select name="accessMode" value={environmentDraft.accessMode} onChange={(e) => setEnvironmentDraft((c) => ({ ...c, accessMode: e.target.value }))}>
              <option value="">read-write (default)</option>
              <option value="read-write">read-write</option>
              <option value="read-only">read-only</option>
            </select>
          </div>
          <div className="btn-group"><button type="submit" className="btn btn-primary">Save Environment</button></div>
        </form>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// McpInfo
// ---------------------------------------------------------------------------

function McpInfo(props: { shellData: any; toast: ToastFn }) {
  const { shellData, toast } = props;
  return (
    <div className="panel">
      <h2>MCP Server</h2>
      <p className="desc">The MCP server uses stdio transport. Launch it from your MCP client.</p>
      {shellData?.mcp ? (
        <>
          <div style={{ marginBottom: 12 }}><span className="field-label">Launch Command</span></div>
          <div className="mcp-cmd-wrap">
            <div className="mcp-cmd">{shellData.mcp.launchCommand}</div>
            <CopyButton value={shellData.mcp.launchCommand} label="Copy" title="Copy launch command" toast={toast} className="mcp-copy" />
          </div>
          <div style={{ marginBottom: 8 }}><span className="field-label">Available Tools ({shellData.mcp.tools.length})</span></div>
          <div className="tool-grid">{shellData.mcp.tools.map((tool: string) => (
            <div key={tool} className="copy-inline">
              <code>{tool}</code>
              <CopyButton value={tool} label="copy" title="Copy tool name" toast={toast} />
            </div>
          ))}</div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboarding  (first-run guided flow)
// ---------------------------------------------------------------------------

function OnboardingFlow(props: {
  shellData: any;
  globalEnvironment: string;
  selectedApis: Record<string, boolean>;
  setSelectedApis: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { shellData, globalEnvironment, selectedApis, setSelectedApis, refreshState, toast } = props;
  const accounts = shellData?.accounts || [];
  const environments = shellData?.environments || [];
  const login = useLoginJob(toast, refreshState);

  const hasAccounts = accounts.length > 0;
  const hasEnvironments = environments.length > 0;
  const step = hasEnvironments ? 'done' : hasAccounts ? 'environment' : 'account';

  if (step === 'done') return null;

  return (
    <div className="onboarding">
      <div className="onboarding-card panel">
        <div className="onboarding-steps">
          <div className={`onboarding-step-indicator ${step === 'account' ? 'active' : 'done'}`}>
            <span className={`health-dot ${hasAccounts ? 'ok' : 'pending'}`}></span>
            <span>1. Connect account</span>
          </div>
          <div className="onboarding-step-divider"></div>
          <div className={`onboarding-step-indicator ${step === 'environment' ? 'active' : hasEnvironments ? 'done' : ''}`}>
            <span className={`health-dot ${hasEnvironments ? 'ok' : step === 'environment' ? 'pending' : 'muted'}`}></span>
            <span>2. Add environment</span>
          </div>
        </div>

        {step === 'account' ? (
          <>
            <h2>Connect your first account</h2>
            <p className="desc">Add a Microsoft account to start working with Power Platform. You'll sign in through your browser.</p>
            {(login.activeLoginJobId || login.loginTargets.length > 0) ? (
              <LoginProgress loginTargets={login.loginTargets} deviceCode={login.deviceCode} onCancel={login.handleCancelLogin} toast={toast} />
            ) : (
              <AddAccountForm
                accounts={accounts}
                selectedApis={selectedApis}
                setSelectedApis={setSelectedApis}
                globalEnvironment={globalEnvironment}
                onLoginStarted={login.handleLoginStarted}
                refreshState={refreshState}
                toast={toast}
              />
            )}
          </>
        ) : step === 'environment' ? (
          <>
            <h2>Add an environment</h2>
            <p className="desc">Discover the Power Platform environments available to your account, or enter one manually.</p>
            <AddEnvironmentForm accounts={accounts} refreshState={refreshState} toast={toast} />
          </>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-tab panels: StatusPanel, AccountsPanel, EnvironmentsPanel
// ---------------------------------------------------------------------------

function StatusPanel(props: {
  accounts: any[];
  environments: any[];
  tokenStatus: Record<string, any>;
  health: Record<string, Record<string, HealthEntry>>;
  refreshState: (silent?: boolean) => Promise<void>;
  recheckHealth: () => void;
  toast: ToastFn;
}) {
  const { accounts, environments, tokenStatus, health, refreshState, recheckHealth, toast } = props;

  // Gather issues that need attention
  const issues: Array<{ type: string; message: string; action?: string }> = [];
  for (const account of accounts) {
    const token = tokenStatus[account.name];
    if (token && !token.authenticated) {
      issues.push({ type: 'account', message: `Account "${account.name}" is not authenticated`, action: 'Go to Accounts to re-login' });
    }
    if (token?.authenticated) {
      const expiry = formatTimeRemaining(token.expiresAt);
      if (expiry?.cls === 'expired') {
        issues.push({ type: 'account', message: `Token for "${account.name}" has expired`, action: 'Go to Accounts to re-login' });
      }
    }
  }
  for (const env of environments) {
    const envHealth = health[env.alias] || {};
    for (const apiName of HEALTH_APIS) {
      const state = envHealth[apiName];
      if (state?.status === 'error') {
        issues.push({ type: 'environment', message: `${env.alias}: ${apiName} - ${state.summary}` });
      }
    }
  }

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Status</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={recheckHealth}>Re-check</button>
          <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => void refreshState(false)}>Refresh</button>
        </div>
      </div>

      {issues.length > 0 ? (
        <div className="status-issues">
          {issues.map((issue, i) => (
            <div key={i} className="status-issue">
              <span className="health-dot error"></span>
              <span>{issue.message}</span>
              {issue.action ? <span className="status-issue-hint">{issue.action}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="status-ok-banner">
          <span className="health-dot ok"></span>
          All systems healthy
        </div>
      )}

      <div className="status-section">
        <h3>Accounts ({accounts.length})</h3>
        <div className="status-summary-list">
          {accounts.map((account: any) => {
            const token = tokenStatus[account.name];
            const cls = token === undefined ? 'pending' : token?.authenticated ? 'ok' : 'error';
            const expiry = token?.authenticated ? formatTimeRemaining(token.expiresAt) : null;
            return (
              <div key={account.name} className="status-summary-item">
                <span className={`health-dot ${cls}`}></span>
                <span className="status-summary-name">{account.name}</span>
                <span className="badge">{account.kind}</span>
                {account.accountUsername || account.loginHint ? (
                  <span className="status-summary-detail">{account.accountUsername || account.loginHint}</span>
                ) : null}
                {expiry ? <span className={`token-expiry ${expiry.cls || ''}`}>{expiry.text}</span> : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="status-section">
        <h3>Environments ({environments.length})</h3>
        <div className="card-list">
          {environments.map((env: any) => (
            <EnvironmentCard
              key={env.alias}
              environment={env}
              health={health[env.alias] || {}}
              tokenStatus={tokenStatus[env.account]}
              refreshState={refreshState}
              toast={toast}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AccountsPanel(props: {
  accounts: any[];
  tokenStatus: Record<string, any>;
  selectedApis: Record<string, boolean>;
  setSelectedApis: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  globalEnvironment: string;
  login: ReturnType<typeof useLoginJob>;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { accounts, tokenStatus, selectedApis, setSelectedApis, globalEnvironment, login, refreshState, toast } = props;
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Accounts</h2>
        <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => void refreshState(false)}>Refresh</button>
      </div>

      {accounts.length ? (
        <div className="card-list">
          {accounts.map((account: any) => (
            <AccountCard
              key={account.name}
              account={account}
              expanded={expandedAccount === account.name}
              tokenStatus={tokenStatus[account.name]}
              selectedApis={selectedApis}
              globalEnvironment={globalEnvironment}
              onToggle={() => setExpandedAccount((current) => current === account.name ? null : account.name)}
              onLoginStarted={login.handleLoginStarted}
              refreshState={refreshState}
              toast={toast}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>No accounts configured yet.</p>
          <p className="empty-state-hint">Add an account below to connect to Power Platform.</p>
        </div>
      )}

      {(login.activeLoginJobId || login.loginTargets.length > 0) ? (
        <div style={{ marginTop: 14 }}>
          <LoginProgress loginTargets={login.loginTargets} deviceCode={login.deviceCode} onCancel={login.handleCancelLogin} toast={toast} />
        </div>
      ) : null}

      <details className="setup-add-section">
        <summary className="setup-add-trigger">+ Add account</summary>
        <div className="setup-add-body">
          <AddAccountForm
            accounts={accounts}
            selectedApis={selectedApis}
            setSelectedApis={setSelectedApis}
            globalEnvironment={globalEnvironment}
            onLoginStarted={login.handleLoginStarted}
            refreshState={refreshState}
            toast={toast}
          />
        </div>
      </details>
    </div>
  );
}

function EnvironmentsPanel(props: {
  accounts: any[];
  environments: any[];
  tokenStatus: Record<string, any>;
  health: Record<string, Record<string, HealthEntry>>;
  recheckHealth: () => void;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { accounts, environments, tokenStatus, health, recheckHealth, refreshState, toast } = props;

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Environments</h2>
        <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={recheckHealth}>Re-check health</button>
      </div>

      {environments.length ? (
        <div className="card-list">
          {environments.map((env: any) => (
            <EnvironmentCard
              key={env.alias}
              environment={env}
              health={health[env.alias] || {}}
              tokenStatus={tokenStatus[env.account]}
              refreshState={refreshState}
              toast={toast}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>No environments configured yet.</p>
          <p className="empty-state-hint">Discover or add an environment below.</p>
        </div>
      )}

      <details className="setup-add-section">
        <summary className="setup-add-trigger">+ Add environment</summary>
        <div className="setup-add-body">
          <AddEnvironmentForm accounts={accounts} refreshState={refreshState} toast={toast} />
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MyAccessPanel
// ---------------------------------------------------------------------------

type AccessData = {
  userId?: string;
  businessUnitId?: string;
  user?: { fullname?: string; domainname?: string; internalemailaddress?: string; azureactivedirectoryobjectid?: string; businessunitid?: string };
  roles?: Array<{ name: string; roleid: string }>;
  teams?: Array<{ name: string; teamid: string; roles?: Array<{ name: string; roleid: string }> }>;
  graph?: { displayName?: string; jobTitle?: string; department?: string; officeLocation?: string; mail?: string; manager?: string; licenses?: string[] };
};

function MyAccessPanel(props: { environment: string; toast: ToastFn }) {
  const { environment, toast } = props;
  const [data, setData] = useState<AccessData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detail = useRecordDetail();

  async function dvGet(path: string) {
    const result = await api<any>('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({ environment, api: 'dv', method: 'GET', path, headers: { Prefer: 'odata.include-annotations="*"' } }),
    });
    return result.data?.response;
  }

  async function graphGet(path: string) {
    const result = await api<any>('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({ environment, api: 'graph', method: 'GET', path }),
    });
    return result.data?.response;
  }

  async function loadAccess() {
    if (!environment) { toast('Select an environment first.', true); return; }
    setLoading(true);
    setError(null);
    setData(null);
    try {
      // Step 1: WhoAmI
      const whoami = await dvGet('/WhoAmI');
      const userId = whoami?.UserId;
      const businessUnitId = whoami?.BusinessUnitId;
      if (!userId) throw new Error('Could not determine current user.');

      // Step 2: user details + roles + teams in parallel
      const [user, rolesResult, teamsResult] = await Promise.all([
        dvGet(`/systemusers(${userId})?$select=fullname,domainname,internalemailaddress,azureactivedirectoryobjectid`),
        dvGet(`/systemusers(${userId})/systemuserroles_association?$select=name,roleid`),
        dvGet(`/systemusers(${userId})/teammembership_association?$select=name,teamid`),
      ]);

      const roles: NonNullable<AccessData['roles']> = Array.isArray(rolesResult?.value) ? rolesResult.value.map((r: any) => ({ name: r.name, roleid: r.roleid })) : [];
      const teams: NonNullable<AccessData['teams']> = Array.isArray(teamsResult?.value) ? teamsResult.value.map((t: any) => ({ name: t.name, teamid: t.teamid })) : [];

      // Step 3: team roles in parallel
      await Promise.all(teams.map(async (team) => {
        try {
          const teamRolesResult = await dvGet(`/teams(${team.teamid})/teamroles_association?$select=name,roleid`);
          team.roles = Array.isArray(teamRolesResult?.value) ? teamRolesResult.value.map((r: any) => ({ name: r.name, roleid: r.roleid })) : [];
        } catch {
          team.roles = [];
        }
      }));

      // Step 4: Graph data (best-effort — may fail if Graph scope not authenticated)
      let graph: AccessData['graph'] | undefined;
      try {
        const [me, managerResult, licensesResult] = await Promise.all([
          graphGet('/me?$select=displayName,jobTitle,department,officeLocation,mail'),
          graphGet('/me/manager?$select=displayName').catch(() => null),
          graphGet('/me/licenseDetails').catch(() => null),
        ]);
        graph = {
          displayName: me?.displayName,
          jobTitle: me?.jobTitle,
          department: me?.department,
          officeLocation: me?.officeLocation,
          mail: me?.mail,
          manager: managerResult?.displayName,
          licenses: Array.isArray(licensesResult?.value)
            ? licensesResult.value.map((l: any) => l.skuPartNumber).filter(Boolean)
            : [],
        };
      } catch {
        // Graph not available — that's fine
      }

      setData({ userId, businessUnitId, user, roles, teams, graph });
      toast('Access data loaded');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toast(err instanceof Error ? err.message : String(err), true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (environment) void loadAccess();
  }, [environment]);

  if (!environment) {
    return <div className="panel"><p className="desc">Select an environment to view your access.</p></div>;
  }

  if (loading && !data) {
    return <div className="panel"><div className="rt-modal-loading">Loading access data...</div></div>;
  }

  if (error && !data) {
    return (
      <div className="panel">
        <div className="rt-modal-error">{error}</div>
        <button className="btn btn-primary" type="button" style={{ marginTop: 12 }} onClick={() => void loadAccess()}>Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const allRoleNames = new Set<string>();
  for (const r of data.roles || []) allRoleNames.add(r.name);
  for (const t of data.teams || []) for (const r of t.roles || []) allRoleNames.add(r.name);

  return (
    <>
      {/* Identity */}
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2>Identity</h2>
          <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => void loadAccess()}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        <div className="metrics">
          {[
            ['Name', data.user?.fullname, undefined, undefined],
            ['UPN', data.user?.domainname, undefined, undefined],
            ['Email', data.user?.internalemailaddress, undefined, undefined],
            ['User ID', data.userId, 'systemuser', 'systemusers'],
            ['Business Unit', data.businessUnitId, 'businessunit', 'businessunits'],
          ].map(([label, value, entity, entitySet]) => (
            <div key={String(label)} className="metric">
              <div className="metric-label">{label}</div>
              <div className="metric-value">
                {value && entity ? (
                  <span className="record-link" onClick={() => detail.open(String(entity), String(entitySet), String(value))}>{String(value).slice(0, 8)}...</span>
                ) : (value || '-')}
              </div>
            </div>
          ))}
        </div>
        {data.graph ? (
          <>
            <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8, marginTop: 16 }}>Azure AD</h3>
            <div className="metrics">
              {[
                ['Job Title', data.graph.jobTitle],
                ['Department', data.graph.department],
                ['Office', data.graph.officeLocation],
                ['Manager', data.graph.manager],
              ].filter(([, v]) => v).map(([label, value]) => (
                <div key={String(label)} className="metric">
                  <div className="metric-label">{label}</div>
                  <div className="metric-value">{value}</div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {/* Security Roles */}
      <div className="panel">
        <h2>Security Roles ({allRoleNames.size})</h2>
        <p className="desc">All security roles for your user, including roles inherited from teams.</p>

        {(data.roles?.length ?? 0) > 0 ? (
          <>
            <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8 }}>Direct Roles</h3>
            <div className="card-list" style={{ marginBottom: 16 }}>
              {data.roles!.map((role) => (
                <div key={role.roleid} className="card-item" style={{ cursor: 'pointer' }} onClick={() => detail.open('role', 'roles', role.roleid)}>
                  <span style={{ fontWeight: 500, fontSize: '0.8125rem' }}>{role.name}</span>
                  <span className="record-link" style={{ fontFamily: 'var(--mono)', fontSize: '0.6875rem' }}>{role.roleid.slice(0, 8)}...</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="desc">No roles directly assigned to your user.</p>
        )}
      </div>

      {/* Teams */}
      <div className="panel">
        <h2>Teams ({data.teams?.length || 0})</h2>
        <p className="desc">Team memberships and their associated security roles.</p>
        {(data.teams?.length ?? 0) > 0 ? (
          <div className="card-list">
            {data.teams!.map((team) => (
              <div key={team.teamid} className="access-team-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: team.roles?.length ? 8 : 0, cursor: 'pointer' }} onClick={() => detail.open('team', 'teams', team.teamid)}>
                  <span style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{team.name}</span>
                  <span className="record-link" style={{ fontFamily: 'var(--mono)', fontSize: '0.6875rem' }}>{team.teamid.slice(0, 8)}...</span>
                </div>
                {team.roles?.length ? (
                  <div className="access-team-roles">
                    {team.roles.map((role) => (
                      <span key={role.roleid} className="badge" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); detail.open('role', 'roles', role.roleid); }}>{role.name}</span>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>No roles</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="desc">No team memberships found.</p>
        )}
      </div>

      {/* Licenses */}
      {data.graph?.licenses?.length ? (
        <div className="panel">
          <h2>Licenses</h2>
          <p className="desc">Microsoft 365 license assignments from Azure AD.</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {data.graph.licenses.map((sku) => (
              <span key={sku} className="badge">{sku}</span>
            ))}
          </div>
        </div>
      ) : null}

      {detail.target && environment && (
        <RecordDetailModal initial={detail.target} environment={environment} onClose={detail.close} toast={toast} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// SetupTab  (main orchestrator with sub-tabs)
// ---------------------------------------------------------------------------

export function SetupTab(props: SetupTabProps) {
  const { shellData, globalEnvironment, refreshState, toast } = props;
  const [setupSubTab, setSetupSubTab] = useState<SetupSubTab>('status');
  const [tokenStatus, setTokenStatus] = useState<Record<string, any>>({});
  const [health, setHealth] = useState<Record<string, Record<string, HealthEntry>>>({});
  const [selectedApis, setSelectedApis] = useState<Record<string, boolean>>({
    dv: true,
    flow: true,
    powerapps: true,
    graph: false,
  });

  const login = useLoginJob(toast, refreshState);
  const accounts = shellData?.accounts || [];
  const environments = shellData?.environments || [];

  useEffect(() => {
    if (!shellData) return;
    void checkTokenStatuses(accounts);
    void checkHealth(environments);
  }, [shellData]);

  async function checkTokenStatuses(accountList: any[]) {
    await Promise.all(accountList.map(async (account) => {
      try {
        const response = await fetch(`/api/accounts/token-status?account=${encodeURIComponent(account.name)}`, {
          headers: { 'content-type': 'application/json' },
        });
        const data = await response.json();
        setTokenStatus((current) => ({
          ...current,
          [account.name]: data.success && data.data ? data.data : { authenticated: false },
        }));
      } catch {
        setTokenStatus((current) => ({ ...current, [account.name]: { authenticated: false } }));
      }
    }));
  }

  async function checkHealth(environmentList: any[]) {
    for (const environment of environmentList) {
      for (const apiName of HEALTH_APIS) {
        setHealth((current) => ({
          ...current,
          [environment.alias]: {
            ...(current[environment.alias] || {}),
            [apiName]: { status: 'pending', summary: 'Checking...' },
          },
        }));
        try {
          const response = await fetch('/api/checks/ping', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ environment: environment.alias, api: apiName }),
          });
          const payload = await response.json();
          const value = payload.success !== false ? { status: 'ok', summary: 'Reachable' } : summarizeHealthFailure(payload);
          setHealth((current) => ({
            ...current,
            [environment.alias]: { ...(current[environment.alias] || {}), [apiName]: value },
          }));
        } catch {
          setHealth((current) => ({
            ...current,
            [environment.alias]: {
              ...(current[environment.alias] || {}),
              [apiName]: { status: 'error', summary: 'Request failed', detail: 'The health check request did not complete.' },
            },
          }));
        }
      }
    }
  }

  function recheckHealth() {
    void checkHealth(environments);
    void checkTokenStatuses(accounts);
    toast('Health checks started');
  }

  // First-run onboarding
  const isFirstRun = accounts.length === 0 || environments.length === 0;
  if (isFirstRun) {
    return (
      <OnboardingFlow
        shellData={shellData}
        globalEnvironment={globalEnvironment}
        selectedApis={selectedApis}
        setSelectedApis={setSelectedApis}
        refreshState={refreshState}
        toast={toast}
      />
    );
  }

  // Normal view with sub-tabs
  return (
    <div className="setup-layout">
      <div className="dv-sub-nav">
        {(['status', 'accounts', 'environments', 'access', 'mcp'] as SetupSubTab[]).map((tabName) => (
          <button
            key={tabName}
            className={`sub-tab ${setupSubTab === tabName ? 'active' : ''}`}
            type="button"
            onClick={() => setSetupSubTab(tabName)}
          >
            {SETUP_SUB_TAB_LABELS[tabName]}
          </button>
        ))}
      </div>

      <div className={`dv-subpanel ${setupSubTab === 'status' ? 'active' : ''}`}>
        <StatusPanel
          accounts={accounts}
          environments={environments}
          tokenStatus={tokenStatus}
          health={health}
          refreshState={refreshState}
          recheckHealth={recheckHealth}
          toast={toast}
        />
      </div>

      <div className={`dv-subpanel ${setupSubTab === 'accounts' ? 'active' : ''}`}>
        <AccountsPanel
          accounts={accounts}
          tokenStatus={tokenStatus}
          selectedApis={selectedApis}
          setSelectedApis={setSelectedApis}
          globalEnvironment={globalEnvironment}
          login={login}
          refreshState={refreshState}
          toast={toast}
        />
      </div>

      <div className={`dv-subpanel ${setupSubTab === 'environments' ? 'active' : ''}`}>
        <EnvironmentsPanel
          accounts={accounts}
          environments={environments}
          tokenStatus={tokenStatus}
          health={health}
          recheckHealth={recheckHealth}
          refreshState={refreshState}
          toast={toast}
        />
      </div>

      <div className={`dv-subpanel ${setupSubTab === 'access' ? 'active' : ''}`}>
        <MyAccessPanel environment={globalEnvironment} toast={toast} />
      </div>

      <div className={`dv-subpanel ${setupSubTab === 'mcp' ? 'active' : ''}`}>
        <McpInfo shellData={shellData} toast={toast} />
      </div>
    </div>
  );
}
