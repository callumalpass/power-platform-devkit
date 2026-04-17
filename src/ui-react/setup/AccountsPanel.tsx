import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, formDataObject, formatDate, formatTimeRemaining } from '../utils.js';
import type { ToastFn } from '../ui-types.js';
import {
  API_SCOPE_OPTIONS,
  type AuthSession,
  type BrowserProfileResult,
  type BrowserProfileStatus,
  type TokenEntry,
} from './types.js';
import type { useAuthSession } from './login.js';
import { LoginProgress } from './login.js';
import type { useConfirm } from './ConfirmDialog.js';

type AccountKind = 'user' | 'device-code' | 'client-secret' | 'environment-token' | 'static-token';

// ---------------------------------------------------------------------------
// AccountCard
// ---------------------------------------------------------------------------

function AccountCard(props: {
  account: any;
  expanded: boolean;
  tokenStatus: TokenEntry;
  selectedApis: Record<string, boolean>;
  globalEnvironment: string;
  confirm: ReturnType<typeof useConfirm>;
  onToggle: () => void;
  onLoginStarted: (session: AuthSession) => void;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { account, expanded, tokenStatus: token, selectedApis, globalEnvironment, confirm, onToggle, onLoginStarted, refreshState, toast } = props;
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

  function handleBrowserProfileReset() {
    confirm.open({
      title: 'Reset browser profile?',
      body: <>This removes the saved browser data for account <strong>{account.name}</strong>. You will need to sign in again next time you open Maker or run a Playwright script.</>,
      confirmLabel: 'Reset profile',
      destructive: true,
      onConfirm: async () => {
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
      },
    });
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

  function handleRemove() {
    confirm.open({
      title: `Remove account "${account.name}"?`,
      body: <>This deletes the account configuration from <code>pp</code>. Cached tokens for this account will be discarded. Environments still pointing at this account will need to be reassigned.</>,
      confirmLabel: 'Remove account',
      destructive: true,
      typedConfirmation: account.name,
      onConfirm: async () => {
        try {
          await api(`/api/accounts/${encodeURIComponent(account.name)}`, { method: 'DELETE' });
          toast('Account removed');
          await refreshState(true);
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), true);
        }
      },
    });
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
      <div className="account-card-head-new">
        <button
          type="button"
          className="account-card-toggle"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={`account-body-${account.name}`}
        >
          <span className="account-card-chevron" aria-hidden="true">&#9656;</span>
          <span className="account-card-identity">
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
          </span>
        </button>
        <div className="account-card-actions">
          {interactive ? (
            <button className="btn btn-ghost btn-sm" type="button" onClick={handleLogin}>Login</button>
          ) : null}
          <button className="btn btn-danger" type="button" onClick={handleRemove}>Remove</button>
        </div>
      </div>
      <div className="account-card-body" id={`account-body-${account.name}`}>
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
          <div className="btn-group"><button type="submit" className="btn btn-secondary btn-sm">Save Changes</button></div>
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
// AddAccountForm  (with Basic/Advanced segmented control)
// ---------------------------------------------------------------------------

export function AddAccountForm(props: {
  accounts: any[];
  selectedApis: Record<string, boolean>;
  setSelectedApis: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  globalEnvironment: string;
  onLoginStarted: (session: AuthSession) => void;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { selectedApis, setSelectedApis, globalEnvironment, onLoginStarted, refreshState, toast } = props;
  const [accountKind, setAccountKind] = useState<AccountKind>('user');
  const [mode, setMode] = useState<'basic' | 'advanced'>('basic');
  const formRef = useRef<HTMLFormElement | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const connectAfterSave = submitter?.value === 'connect';
    const payload: any = formDataObject(form);
    payload.kind = accountKind;
    try {
      await api<any>('/api/accounts', {
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
  const showAdvanced = mode === 'advanced';

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      <div className="segmented" role="tablist" aria-label="Form complexity">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'basic'}
          className={`segmented-item ${mode === 'basic' ? 'active' : ''}`}
          onClick={() => setMode('basic')}
        >Basic</button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'advanced'}
          className={`segmented-item ${mode === 'advanced' ? 'active' : ''}`}
          onClick={() => setMode('advanced')}
        >Advanced options</button>
      </div>

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

      {showAdvanced ? (
        <div className="setup-advanced-fields">
          <div className="form-row">
            <div className="field">
              <span className="field-label">Authentication Method</span>
              <select name="kind" value={accountKind} onChange={(event) => setAccountKind(event.target.value as AccountKind)}>
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
// AccountsPanel
// ---------------------------------------------------------------------------

export function AccountsPanel(props: {
  accounts: any[];
  tokenStatus: Record<string, any>;
  selectedApis: Record<string, boolean>;
  setSelectedApis: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  globalEnvironment: string;
  login: ReturnType<typeof useAuthSession>;
  confirm: ReturnType<typeof useConfirm>;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { accounts, tokenStatus, selectedApis, setSelectedApis, globalEnvironment, login, confirm, refreshState, toast } = props;
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Accounts</h2>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void refreshState(false)}>Refresh</button>
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
              confirm={confirm}
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
