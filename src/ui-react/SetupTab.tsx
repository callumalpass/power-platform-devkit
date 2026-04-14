import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, formDataObject, formatDate, formatTimeRemaining, optionList } from './utils.js';
import { CopyButton, copyTextToClipboard } from './CopyButton.js';
import { RecordDetailModal, useRecordDetail } from './RecordDetailModal.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastFn = (message: string, isError?: boolean) => void;

type SetupTabProps = {
  active: boolean;
  shellData: any;
  globalEnvironment: string;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
};

type SetupSubTab = 'status' | 'accounts' | 'environments' | 'sharepoint' | 'access' | 'advanced' | 'mcp';

type HealthEntry = { status: string; summary: string; message?: string; detail?: string; code?: string };

type TokenEntry = { authenticated: boolean; expiresAt?: number | string } | undefined;

type TemporaryTokenSummary = {
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

type BrowserProfileStatus = {
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

type BrowserProfileResult = { data: BrowserProfileStatus };

type LoginTarget = {
  id?: string;
  api?: string;
  resource?: string;
  label?: string;
  status?: string;
  action?: { kind: 'browser-url'; url: string } | { kind: 'device-code'; verificationUri: string; userCode: string; message: string };
  error?: string;
};

type AuthSession = {
  id: string;
  accountName: string;
  status: 'pending' | 'waiting_for_user' | 'acquiring_token' | 'completed' | 'failed' | 'cancelled';
  targets: LoginTarget[];
  result?: { success?: boolean; diagnostics?: Array<{ message?: string; code?: string; detail?: string }> };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEALTH_APIS = ['dv', 'flow', 'graph', 'bap', 'powerapps'] as const;

const API_SCOPE_OPTIONS = [
  { key: 'dv', label: 'Dataverse' },
  { key: 'flow', label: 'Flow' },
  { key: 'powerapps', label: 'Power Apps' },
  { key: 'bap', label: 'Platform Admin' },
  { key: 'graph', label: 'Graph' },
] as const;

const SETUP_SUB_TAB_LABELS: Record<SetupSubTab, string> = {
  status: 'Status',
  accounts: 'Accounts',
  environments: 'Environments',
  sharepoint: 'SharePoint',
  access: 'My Access',
  advanced: 'Advanced',
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
// Shared auth-session flow
// ---------------------------------------------------------------------------

function useAuthSession(toast: ToastFn, refreshState: (silent?: boolean) => Promise<void>) {
  const [activeSession, setActiveSession] = useState<AuthSession | null>(null);
  const [loginTargets, setLoginTargets] = useState<LoginTarget[]>([]);

  function handleSessionUpdate(session: AuthSession) {
    setActiveSession(session);
    setLoginTargets(session.targets || []);
    if (session.status === 'completed') {
      refreshState(true);
      toast('Authentication complete');
    } else if (session.status === 'failed') {
      const message = session.result?.diagnostics?.[0]?.message || 'Authentication failed';
      toast(message, true);
    }
  }

  function handleLoginStarted(session: AuthSession) {
    setActiveSession(session);
    setLoginTargets(session.targets || []);
    const events = new EventSource(`/api/auth/sessions/${encodeURIComponent(session.id)}/events`);
    events.addEventListener('session', (event) => {
      const next = JSON.parse((event as MessageEvent).data) as AuthSession;
      handleSessionUpdate(next);
      if (next.status === 'completed' || next.status === 'failed' || next.status === 'cancelled') {
        events.close();
      }
    });
    events.onerror = () => {
      events.close();
      void fetch(`/api/auth/sessions/${encodeURIComponent(session.id)}`)
        .then((response) => response.json())
        .then((payload) => payload.data ? handleSessionUpdate(payload.data) : undefined)
        .catch(() => toast('Authentication status disconnected', true));
    };
  }

  async function handleCancelLogin() {
    if (!activeSession) return;
    try {
      await api(`/api/auth/sessions/${encodeURIComponent(activeSession.id)}/cancel`, { method: 'POST' });
    } catch { /* ignore */ }
    setActiveSession(null);
  }

  function clearCompletedLogin() {
    setActiveSession(null);
    setLoginTargets([]);
  }

  return { activeSession, loginTargets, handleLoginStarted, handleCancelLogin, clearCompletedLogin };
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
  onLoginStarted: (session: AuthSession) => void;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { account, expanded, tokenStatus: token, selectedApis, globalEnvironment, onToggle, onLoginStarted, refreshState, toast } = props;
  const interactive = account.kind === 'user' || account.kind === 'device-code';
  const tokenClass = token === undefined ? 'pending' : token?.authenticated ? 'ok' : 'error';
  const expiry = token?.authenticated ? formatTimeRemaining(token.expiresAt) : null;
  const [browserProfile, setBrowserProfile] = useState<BrowserProfileStatus | null>(null);
  const [browserProfileBusy, setBrowserProfileBusy] = useState(false);

  useEffect(() => {
    if (!expanded || !interactive) return;
    void loadBrowserProfileStatus();
  }, [expanded, interactive, account.name]);

  async function loadBrowserProfileStatus() {
    try {
      const result = await api<BrowserProfileResult>(`/api/accounts/${encodeURIComponent(account.name)}/browser-profile`);
      setBrowserProfile(result.data);
    } catch {
      setBrowserProfile(null);
    }
  }

  async function handleBrowserProfileOpen() {
    setBrowserProfileBusy(true);
    try {
      const result = await api<BrowserProfileResult>(`/api/accounts/${encodeURIComponent(account.name)}/browser-profile/open`, {
        method: 'POST',
        body: JSON.stringify({ url: 'https://make.powerapps.com' }),
      });
      setBrowserProfile(result.data);
      toast('Browser profile opened');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBrowserProfileBusy(false);
    }
  }

  async function handleBrowserProfileVerify() {
    setBrowserProfileBusy(true);
    try {
      const result = await api<BrowserProfileResult>(`/api/accounts/${encodeURIComponent(account.name)}/browser-profile/verify`, {
        method: 'POST',
        body: JSON.stringify({ url: 'https://make.powerapps.com' }),
      });
      setBrowserProfile(result.data);
      if (result.data.authenticated) {
        toast('Browser profile is signed in');
      } else {
        toast('Sign in in the opened browser, then verify again', true);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBrowserProfileBusy(false);
    }
  }

  async function handleBrowserProfileReset() {
    if (!confirm(`Reset browser profile for "${account.name}"? This removes the saved browser data for this account.`)) return;
    setBrowserProfileBusy(true);
    try {
      const result = await api<BrowserProfileResult>(`/api/accounts/${encodeURIComponent(account.name)}/browser-profile`, { method: 'DELETE' });
      setBrowserProfile(result.data);
      toast('Browser profile reset');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBrowserProfileBusy(false);
    }
  }

  async function handleLogin() {
    try {
      const started = await api<any>('/api/auth/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: account.name,
          kind: account.kind === 'device-code' ? 'device-code' : 'user',
          loginHint: account.loginHint || account.accountUsername,
          tenantId: account.tenantId,
          clientId: account.clientId,
          environmentAlias: globalEnvironment || undefined,
          excludeApis: ['dv', 'flow', 'powerapps', 'bap', 'graph'].filter((name) => !selectedApis[name]),
        }),
      });
      onLoginStarted(started.data);
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
        {interactive ? (
          <div className="browser-profile-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <h3>Browser Profile</h3>
                <p className="desc" style={{ marginBottom: 8 }}>A persistent Chromium profile for Maker, Studio, and Playwright scripts that need browser auth.</p>
              </div>
              <div className="btn-group">
                <button className="btn btn-secondary" type="button" disabled={browserProfileBusy} onClick={handleBrowserProfileOpen}>Open Maker</button>
                <button className="btn btn-ghost" type="button" disabled={browserProfileBusy} onClick={handleBrowserProfileVerify}>Verify</button>
                <button className="btn btn-ghost" type="button" disabled={browserProfileBusy || !browserProfile?.configured} onClick={handleBrowserProfileReset}>Reset</button>
              </div>
            </div>
            <div className="account-card-props" style={{ marginTop: 8, marginBottom: 0 }}>
              <div className="account-card-prop">
                <div className="account-card-prop-label">Status</div>
                <div className="account-card-prop-value">{browserProfile?.open ? 'Open' : browserProfile?.exists ? 'Ready' : 'Not created'}</div>
              </div>
              <div className="account-card-prop">
                <div className="account-card-prop-label">Last Opened</div>
                <div className="account-card-prop-value">{formatDate(browserProfile?.profile?.lastOpenedAt)}</div>
              </div>
              <div className="account-card-prop">
                <div className="account-card-prop-label">Last Verified</div>
                <div className="account-card-prop-value">{formatDate(browserProfile?.profile?.lastVerifiedAt)}</div>
              </div>
              <div className="account-card-prop">
                <div className="account-card-prop-label">Profile Path</div>
                <div className="account-card-prop-value">{browserProfile?.profile?.userDataDir || '-'}</div>
              </div>
            </div>
          </div>
        ) : null}
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
  onLoginStarted: (session: AuthSession) => void;
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
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const connectAfterSave = submitter?.value === 'connect';
    const payload: any = formDataObject(form);
    payload.kind = accountKind;
    try {
      const response = await api<any>('/api/accounts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      toast('Account saved');
      await refreshState(true);
      if (connectAfterSave && (accountKind === 'user' || accountKind === 'device-code')) {
        const session = await api<any>('/api/auth/sessions', {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            excludeApis: ['dv', 'flow', 'powerapps', 'bap', 'graph'].filter((name) => !selectedApis[name]),
            environmentAlias: globalEnvironment || undefined,
          }),
        });
        onLoginStarted(session.data);
      }
      if (connectAfterSave || accountKind !== 'user') form.reset();
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
        <button type="submit" className="btn btn-secondary" name="intent" value="save">Save account</button>
        {isInteractive ? <button type="submit" className="btn btn-primary" name="intent" value="connect">Save and connect</button> : null}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// LoginProgress  (step-through UX)
// ---------------------------------------------------------------------------

function LoginProgress(props: {
  session: AuthSession | null;
  loginTargets: LoginTarget[];
  onCancel: () => void;
  onDismiss: () => void;
  toast: ToastFn;
}) {
  const { session, loginTargets, onCancel, onDismiss, toast } = props;

  const completedCount = loginTargets.filter((t) => t.status === 'completed').length;
  const total = loginTargets.length;
  const currentTarget = loginTargets.find((t) => t.status === 'waiting_for_user' || t.status === 'acquiring_token');
  const currentIndex = currentTarget ? loginTargets.indexOf(currentTarget) + 1 : completedCount + 1;
  const currentDeviceCode = currentTarget?.action?.kind === 'device-code' ? currentTarget.action : null;
  const terminal = session?.status === 'completed' || session?.status === 'failed' || session?.status === 'cancelled';

  return (
    <div className="login-progress-panel">
      <div className="login-progress-header">
        <div className="login-progress-title">
          {session?.status === 'failed'
            ? 'Authentication needs attention'
            : completedCount === total && total > 0
            ? 'Authentication complete'
            : currentTarget
              ? currentTarget.status === 'waiting_for_user'
                ? `Sign in to ${currentTarget.label || currentTarget.api || 'service'} (${currentIndex} of ${total})`
                : `Connecting to ${currentTarget.label || currentTarget.api || 'service'} (${currentIndex} of ${total})`
              : 'Waiting for sign-in links...'}
        </div>
        <div className="login-progress-actions">
          <button type="button" className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => {
            const links = loginTargets
              .filter((t) => t.action?.kind === 'browser-url')
              .map((t) => `${t.label || t.api || t.resource}: ${t.action?.kind === 'browser-url' ? t.action.url : ''}`);
            void copyTextToClipboard(links.join('\n'))
              .then(() => toast('Copied login URLs'))
              .catch((error) => toast(`Copy failed: ${error instanceof Error ? error.message : String(error)}`, true));
          }}>Copy URLs</button>
          {terminal ? (
            <button type="button" className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={onDismiss}>Dismiss</button>
          ) : (
            <button type="button" className="btn btn-danger" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={onCancel}>Cancel</button>
          )}
        </div>
      </div>

      {currentDeviceCode ? (
        <div className="device-code-card">
          <div className="device-code-instruction">Go to the following URL and enter the code to sign in:</div>
          <div className="device-code-url-row">
            <a href={currentDeviceCode.verificationUri} target="_blank" rel="noreferrer" className="device-code-url">{currentDeviceCode.verificationUri}</a>
            <button type="button" className="btn btn-ghost device-code-open-btn" onClick={() => window.open(currentDeviceCode.verificationUri, '_blank', 'noreferrer')}>Open</button>
            <CopyButton value={currentDeviceCode.verificationUri} label="Copy URL" title="Copy verification URL" toast={toast} />
          </div>
          <div className="device-code-box">
            <span className="device-code-label">Your code</span>
            <span className="device-code-value">{currentDeviceCode.userCode}</span>
            <CopyButton value={currentDeviceCode.userCode} label="Copy" title="Copy device code" toast={toast} className="btn btn-ghost" />
          </div>
        </div>
      ) : null}

      <div className="login-progress-steps">
        {loginTargets.map((target, index) => {
          const isDone = target.status === 'completed';
          const isFailed = target.status === 'failed';
          const isActive = target.status === 'waiting_for_user' || target.status === 'acquiring_token';
          const isPending = !isDone && !isActive && !isFailed;
          const dotClass = isDone ? 'ok' : isFailed ? 'error' : isActive ? 'pending' : 'muted';
          const browserAction = target.action?.kind === 'browser-url' ? target.action : null;
          return (
            <div key={`${target.resource || target.api || index}`} className={`login-progress-step ${isActive ? 'active' : ''}`}>
              <div className="login-progress-step-head">
                <span className={`health-dot ${dotClass}`}></span>
                <strong>{target.label || target.api || target.resource}</strong>
                <span className={`login-progress-step-badge ${isDone ? 'done' : isFailed ? 'failed' : isActive ? 'active' : 'pending'}`}>
                  {isDone ? 'connected' : isFailed ? 'failed' : isActive ? (target.status === 'waiting_for_user' ? 'action required' : 'connecting') : 'pending'}
                </span>
              </div>
              {isActive && browserAction ? (
                <a href={browserAction.url} target="_blank" rel="noreferrer" className="login-progress-step-link btn btn-primary" style={{ fontSize: '0.75rem', padding: '5px 12px', display: 'inline-block', marginTop: 6 }}>
                  Open sign-in page
                </a>
              ) : isFailed ? (
                <span style={{ fontSize: '0.6875rem', color: 'var(--danger)' }}>{target.error || 'Authentication failed.'}</span>
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
// TemporaryAccessTokensPanel
// ---------------------------------------------------------------------------

function TemporaryAccessTokensPanel(props: { toast: ToastFn }) {
  const { toast } = props;
  const [tokens, setTokens] = useState<TemporaryTokenSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [matchKind, setMatchKind] = useState('');

  useEffect(() => {
    void loadTokens();
  }, []);

  async function loadTokens() {
    try {
      const payload = await api<any>('/api/temp-tokens');
      setTokens(payload.data || []);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formDataObject(form);
    setLoading(true);
    try {
      await api('/api/temp-tokens', {
        method: 'POST',
        body: JSON.stringify({
          name: values.name,
          token: values.token,
          matchKind: values.matchKind,
          origin: values.origin,
          api: values.api,
          audience: values.audience,
        }),
      });
      form.reset();
      setMatchKind('');
      await loadTokens();
      toast('Temporary access token added');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setLoading(false);
    }
  }

  async function removeToken(token: TemporaryTokenSummary) {
    try {
      await api(`/api/temp-tokens/${encodeURIComponent(token.id)}`, { method: 'DELETE' });
      setTokens((current) => current.filter((item) => item.id !== token.id));
      toast('Temporary access token forgotten');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  return (
    <div className="panel">
      <h2>Temporary Access Tokens</h2>
      <p className="desc">Use a short-lived bearer token for an API that <code>pp</code> cannot authenticate to directly. Tokens stay only in this running UI process, are never written to config, and are used only when a CLI request explicitly opts in with <code>--via-ui</code>.</p>
      <p className="desc" style={{ color: 'var(--danger)' }}>Treat pasted tokens like passwords. Use tokens only from accounts you control, and forget them when the request is complete.</p>

      <form onSubmit={submit} className="setup-add-form">
        <div className="form-row">
          <div className="field"><span className="field-label">Name</span><input name="name" placeholder="sharepoint" /></div>
          <div className="field">
            <span className="field-label">Match</span>
            <select name="matchKind" value={matchKind} onChange={(event) => setMatchKind(event.target.value)}>
              <option value="">Infer from token audience</option>
              <option value="origin">URL origin</option>
              <option value="api">pp API</option>
              <option value="audience">Token audience</option>
            </select>
          </div>
        </div>
        {matchKind === 'origin' ? (
          <div className="field"><span className="field-label">Origin</span><input name="origin" placeholder="https://contoso.sharepoint.com" /></div>
        ) : null}
        {matchKind === 'api' ? (
          <div className="field">
            <span className="field-label">API</span>
            <select name="api">
              <option value="graph">Graph</option>
              <option value="dv">Dataverse</option>
              <option value="flow">Flow</option>
              <option value="powerapps">Power Apps</option>
              <option value="bap">Platform Admin</option>
              <option value="sharepoint">SharePoint REST</option>
              <option value="canvas-authoring">Canvas Authoring</option>
            </select>
          </div>
        ) : null}
        {matchKind === 'audience' ? (
          <div className="field"><span className="field-label">Audience</span><input name="audience" placeholder="https://graph.microsoft.com" /></div>
        ) : null}
        <div className="field">
          <span className="field-label">Bearer Token</span>
          <textarea name="token" required placeholder="Bearer eyJ..." autoComplete="off" spellCheck={false} style={{ minHeight: 96, fontFamily: 'var(--mono)' }}></textarea>
        </div>
        <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Adding...' : 'Add temporary access token'}</button>
      </form>

      <div style={{ marginTop: 18 }}>
        {tokens.length ? tokens.map((token) => {
          const expiry = token.expiresAt ? formatTimeRemaining(token.expiresAt) : null;
          const cli = `pp request --via-ui --temp-token ${shellQuote(token.name)} custom <url> --env ALIAS`;
          return (
            <div className="card-item" key={token.id}>
              <div className="card-item-info">
                <div className="card-item-title">
                  {token.name}
                  {expiry ? <span className={`token-expiry ${expiry.cls || ''}`}> {expiry.text}</span> : null}
                </div>
                <div className="card-item-sub">{describeTemporaryTokenMatch(token.match)}</div>
                {token.audience ? <div className="card-item-sub">aud {token.audience}</div> : null}
                {token.subject ? <div className="card-item-sub">subject {token.subject}</div> : null}
                {token.scopes?.length ? <div className="card-item-sub">scopes {token.scopes.join(' ')}</div> : null}
                {token.roles?.length ? <div className="card-item-sub">roles {token.roles.join(' ')}</div> : null}
                <div className="card-item-sub copy-inline">
                  <span className="copy-inline-value">{cli}</span>
                  <CopyButton value={cli} label="copy CLI" title="Copy CLI command" toast={toast} />
                </div>
              </div>
              <button className="btn btn-ghost" type="button" style={{ color: 'var(--danger)' }} onClick={() => void removeToken(token)}>Forget</button>
            </div>
          );
        }) : <div className="empty">No temporary access tokens.</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SharePointPanel
// ---------------------------------------------------------------------------

function SharePointPanel(props: { accounts: any[]; toast: ToastFn }) {
  const { accounts, toast } = props;
  const [account, setAccount] = useState(accounts[0]?.name || '');
  const [siteUrl, setSiteUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  useEffect(() => {
    if (!account && accounts[0]?.name) setAccount(accounts[0].name);
  }, [accounts, account]);

  const requestUrl = normalizeSharePointWebUrl(siteUrl);
  const cli = account && requestUrl
    ? `pp sp ${shellQuote(requestUrl)} --account ${shellQuote(account)}`
    : '';

  async function checkAccess() {
    if (!account) {
      toast('Choose an account first.', true);
      return;
    }
    if (!requestUrl) {
      toast('Enter a SharePoint URL first.', true);
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch('/api/request/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          account,
          api: 'sharepoint',
          method: 'GET',
          path: requestUrl,
          softFail: true,
        }),
      });
      const payload = await response.json();
      setResult(payload);
      toast(payload.success === false ? 'SharePoint check failed' : 'SharePoint is reachable', payload.success === false);
    } catch (error) {
      setResult({ success: false, diagnostics: [{ message: error instanceof Error ? error.message : String(error) }] });
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setLoading(false);
    }
  }

  const web = result?.data?.response;
  const diagnostic = Array.isArray(result?.diagnostics) ? result.diagnostics[0] : null;

  return (
    <div className="panel">
      <h2>SharePoint</h2>
      <p className="desc">Check whether an account can acquire a SharePoint REST token for a site. SharePoint requests are account-scoped, so no Power Platform environment is required.</p>

      <div className="setup-add-form">
        <div className="form-row">
          <div className="field">
            <span className="field-label">Account</span>
            <select value={account} onChange={(event) => setAccount(event.target.value)}>
              {optionList(accounts.map((a: any) => a.name), 'select account').map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">SharePoint URL</span>
            <input value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} placeholder="https://contoso.sharepoint.com/sites/site" />
          </div>
        </div>
        <div className="field">
          <span className="field-label">Request</span>
          <input value={requestUrl || ''} readOnly placeholder="https://contoso.sharepoint.com/sites/site/_api/web" />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" type="button" disabled={loading || !account || !requestUrl} onClick={() => void checkAccess()}>
            {loading ? 'Checking...' : 'Check SharePoint access'}
          </button>
          {cli ? <CopyButton value={cli} label="copy CLI" title="Copy CLI command" toast={toast} /> : null}
        </div>
      </div>

      {cli ? (
        <div className="card-item" style={{ marginTop: 16 }}>
          <div className="card-item-info">
            <div className="card-item-title">CLI</div>
            <div className="card-item-sub copy-inline">
              <span className="copy-inline-value">{cli}</span>
              <CopyButton value={cli} label="copy" title="Copy CLI command" toast={toast} />
            </div>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="card-item" style={{ marginTop: 16 }}>
          <div className="card-item-info">
            <div className="card-item-title">
              {result.success === false ? 'Access check failed' : 'Access check succeeded'}
            </div>
            {result.success === false ? (
              <div className="card-item-sub">{diagnostic?.message || 'SharePoint request failed.'}</div>
            ) : (
              <>
                <div className="card-item-sub">Status {result.data?.status ?? '-'}</div>
                {web?.Title ? <div className="card-item-sub">Site {web.Title}</div> : null}
                {web?.Url ? <div className="card-item-sub">{web.Url}</div> : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function normalizeSharePointWebUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (!/\.sharepoint\.com$/i.test(url.hostname)) return undefined;
    if (url.pathname.includes('/_api/')) return `${url.origin}${url.pathname}${url.search}`;
    const path = url.pathname.replace(/\/$/, '');
    return `${url.origin}${path}/_api/web`;
  } catch {
    return undefined;
  }
}

function describeTemporaryTokenMatch(match: TemporaryTokenSummary['match']): string {
  if (match.kind === 'origin') return `origin ${match.origin}`;
  if (match.kind === 'api') return `api ${match.api}`;
  return `audience ${match.audience}`;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9._:@/-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
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
  const login = useAuthSession(toast, refreshState);

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
            {(login.activeSession || login.loginTargets.length > 0) ? (
              <LoginProgress session={login.activeSession} loginTargets={login.loginTargets} onCancel={login.handleCancelLogin} onDismiss={login.clearCompletedLogin} toast={toast} />
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

  const [issuesExpanded, setIssuesExpanded] = useState(false);

  // Gather issues that need attention
  const accountIssues: Array<{ message: string; action?: string }> = [];
  const envIssueGroups: Array<{ alias: string; errors: string[] }> = [];
  for (const account of accounts) {
    const token = tokenStatus[account.name];
    if (token && !token.authenticated) {
      accountIssues.push({ message: `Account "${account.name}" is not authenticated`, action: 'Go to Accounts to re-login' });
    }
    if (token?.authenticated) {
      const expiry = formatTimeRemaining(token.expiresAt);
      if (expiry?.cls === 'expired') {
        accountIssues.push({ message: `Token for "${account.name}" has expired`, action: 'Go to Accounts to re-login' });
      }
    }
  }
  for (const env of environments) {
    const envHealth = health[env.alias] || {};
    const errors: string[] = [];
    for (const apiName of HEALTH_APIS) {
      const state = envHealth[apiName];
      if (state?.status === 'error') errors.push(`${apiName}: ${state.summary}`);
    }
    if (errors.length > 0) envIssueGroups.push({ alias: env.alias, errors });
  }
  const totalIssues = accountIssues.length + envIssueGroups.reduce((n, g) => n + g.errors.length, 0);

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Status</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={recheckHealth}>Re-check</button>
          <button className="btn btn-ghost" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => void refreshState(false)}>Refresh</button>
        </div>
      </div>

      {totalIssues > 0 ? (
        <div className="status-issues">
          <button
            className="status-issues-toggle"
            type="button"
            onClick={() => setIssuesExpanded((v) => !v)}
          >
            <span className="health-dot error"></span>
            <span>{totalIssues} {totalIssues === 1 ? 'issue' : 'issues'} found</span>
            <span className={`status-issues-caret ${issuesExpanded ? 'expanded' : ''}`}>&#9656;</span>
          </button>
          {issuesExpanded ? (
            <div className="status-issues-detail">
              {accountIssues.map((issue, i) => (
                <div key={`a-${i}`} className="status-issue">
                  <span className="health-dot error"></span>
                  <span>{issue.message}</span>
                  {issue.action ? <span className="status-issue-hint">{issue.action}</span> : null}
                </div>
              ))}
              {envIssueGroups.map((group) => (
                <div key={group.alias} className="status-issue-group">
                  <div className="status-issue-group-title">{group.alias}</div>
                  {group.errors.map((err, i) => (
                    <div key={i} className="status-issue">
                      <span className="health-dot error"></span>
                      <span>{err}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
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
  login: ReturnType<typeof useAuthSession>;
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

      {(login.activeSession || login.loginTargets.length > 0) ? (
        <div style={{ marginTop: 14 }}>
          <LoginProgress session={login.activeSession} loginTargets={login.loginTargets} onCancel={login.handleCancelLogin} onDismiss={login.clearCompletedLogin} toast={toast} />
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
      body: JSON.stringify({ environment, api: 'dv', method: 'GET', path, headers: { Prefer: 'odata.include-annotations="*"' }, softFail: true }),
    });
    return result.data?.response;
  }

  async function graphGet(path: string) {
    const result = await api<any>('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({ environment, api: 'graph', method: 'GET', path, softFail: true }),
    });
    return result.data?.response;
  }

  async function graphGetOptional(path: string) {
    const response = await fetch('/api/request/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ environment, api: 'graph', method: 'GET', path, softFail: true }),
    });
    const result = await response.json();
    return result.success === false ? null : result.data?.response;
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
          graphGetOptional('/me/manager?$select=displayName'),
          graphGetOptional('/me/licenseDetails'),
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
  const { active, shellData, globalEnvironment, refreshState, toast } = props;
  const [setupSubTab, setSetupSubTab] = useState<SetupSubTab>('status');
  const [tokenStatus, setTokenStatus] = useState<Record<string, any>>({});
  const [health, setHealth] = useState<Record<string, Record<string, HealthEntry>>>({});
  const [selectedApis, setSelectedApis] = useState<Record<string, boolean>>({
    dv: true,
    flow: true,
    powerapps: true,
    bap: true,
    graph: false,
  });

  const login = useAuthSession(toast, refreshState);
  const accounts = shellData?.accounts || [];
  const environments = shellData?.environments || [];

  useEffect(() => {
    if (!active || !shellData) return;
    void checkTokenStatuses(accounts);
    void checkHealth(environments);
  }, [active, shellData]);

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
            body: JSON.stringify({ environment: environment.alias, api: apiName, softFail: true }),
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
        {(['status', 'accounts', 'environments', 'sharepoint', 'access', 'advanced', 'mcp'] as SetupSubTab[]).map((tabName) => (
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

      <div className={`dv-subpanel ${setupSubTab === 'sharepoint' ? 'active' : ''}`}>
        <SharePointPanel accounts={accounts} toast={toast} />
      </div>

      <div className={`dv-subpanel ${setupSubTab === 'advanced' ? 'active' : ''}`}>
        <TemporaryAccessTokensPanel toast={toast} />
      </div>

      <div className={`dv-subpanel ${setupSubTab === 'mcp' ? 'active' : ''}`}>
        <McpInfo shellData={shellData} toast={toast} />
      </div>
    </div>
  );
}
