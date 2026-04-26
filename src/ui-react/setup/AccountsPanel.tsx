import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api, formDataObject, formatDate, formatTimeRemaining } from '../utils.js';
import type { ApiEnvelope, ToastFn } from '../ui-types.js';
import {
  API_SCOPE_OPTIONS,
  type AuthSession,
  type BrowserProfileResult,
  type BrowserProfileStatus,
  type SetupAccount,
  type SetupDetailStyle,
  type SetupEnvironment,
  type TokenEntry,
  type TokenStatusMap
} from './types.js';
import type { useAuthSession } from './login.js';
import type { useConfirm } from './ConfirmDialog.js';
import { DetailPanel } from './DetailPanel.js';
import { OverflowMenu } from './OverflowMenu.js';
import { useResizableWidth } from './use-resizable-width.js';
import { Select } from '../Select.js';
import { CopyButton } from '../CopyButton.js';

type AccountKind = 'user' | 'device-code' | 'client-secret' | 'environment-token' | 'static-token';
type SortKey = 'name' | 'kind' | 'identity' | 'expiry';
type SortDir = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenExpiryMs(token: TokenEntry): number | null {
  if (!token?.authenticated || !token.expiresAt) return null;
  const numeric = Number(token.expiresAt);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 1e12 ? numeric : numeric * 1000;
}

function tokenState(token: TokenEntry): 'pending' | 'ok' | 'error' {
  if (token === undefined) return 'pending';
  if (!token?.authenticated) return 'error';
  const expiresMs = tokenExpiryMs(token);
  if (expiresMs !== null && expiresMs < Date.now()) return 'error';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Edit-account drawer body
// ---------------------------------------------------------------------------

function EditAccountBody(props: {
  account: SetupAccount;
  tokenStatus: TokenEntry;
  confirm: ReturnType<typeof useConfirm>;
  refreshState: (silent?: boolean) => Promise<void>;
  onClose: () => void;
  toast: ToastFn;
}) {
  const { account, tokenStatus, confirm, refreshState, onClose, toast } = props;
  const interactive = account.kind === 'user' || account.kind === 'device-code';
  const [browserProfile, setBrowserProfile] = useState<BrowserProfileStatus | null>(null);
  const [browserProfileBusy, setBrowserProfileBusy] = useState(false);
  const [browserProfileLoaded, setBrowserProfileLoaded] = useState(false);

  useEffect(() => {
    if (!interactive) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await api<BrowserProfileResult>(`/api/accounts/${encodeURIComponent(account.name)}/browser-profile`);
        if (!cancelled) setBrowserProfile(result.data);
      } catch {
        if (!cancelled) setBrowserProfile(null);
      } finally {
        if (!cancelled) setBrowserProfileLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [interactive, account.name]);

  async function handleBrowserProfileOpen() {
    setBrowserProfileBusy(true);
    try {
      const result = await api<BrowserProfileResult>(`/api/accounts/${encodeURIComponent(account.name)}/browser-profile/open`, {
        method: 'POST',
        body: JSON.stringify({ url: 'https://make.powerapps.com' })
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
        body: JSON.stringify({ url: 'https://make.powerapps.com' })
      });
      setBrowserProfile(result.data);
      if (result.data.authenticated) toast('Browser profile is signed in');
      else toast('Sign in in the opened browser, then verify again', true);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBrowserProfileBusy(false);
    }
  }

  function handleBrowserProfileReset() {
    confirm.open({
      title: 'Reset browser profile?',
      body: (
        <>
          This removes the saved browser data for account <strong>{account.name}</strong>. You will need to sign in again next time you open Maker or run a Playwright script.
        </>
      ),
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
      }
    });
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api(`/api/accounts/${encodeURIComponent(account.name)}`, {
        method: 'PUT',
        body: JSON.stringify(formDataObject(event.currentTarget))
      });
      toast('Account updated');
      await refreshState(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function handleRemove() {
    confirm.open({
      title: `Remove account "${account.name}"?`,
      body: (
        <>
          This deletes the account configuration from <code>pp</code>. Cached tokens for this account will be discarded. Environments still pointing at this account will need to be reassigned.
        </>
      ),
      confirmLabel: 'Remove account',
      destructive: true,
      typedConfirmation: account.name,
      onConfirm: async () => {
        try {
          await api(`/api/accounts/${encodeURIComponent(account.name)}`, { method: 'DELETE' });
          toast('Account removed');
          onClose();
          await refreshState(true);
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), true);
        }
      }
    });
  }

  const tokenExpiry = tokenStatus?.authenticated ? formatTimeRemaining(tokenStatus.expiresAt) : null;
  const tokenClass = tokenState(tokenStatus);

  return (
    <>
      <div className="drawer-meta-grid">
        <div className="drawer-meta-item">
          <span className="drawer-meta-label">Kind</span>
          <span className="drawer-meta-value">
            <span className="badge">{account.kind}</span>
          </span>
        </div>
        <div className="drawer-meta-item">
          <span className="drawer-meta-label">Token</span>
          <span className="drawer-meta-value">
            <span className={`health-dot ${tokenClass}`} />
            {tokenExpiry ? <span className={`token-expiry ${tokenExpiry.cls || ''}`}>{tokenExpiry.text}</span> : tokenClass === 'pending' ? 'checking…' : 'not signed in'}
          </span>
        </div>
        {account.accountUsername || account.loginHint ? (
          <div className="drawer-meta-item drawer-meta-wide">
            <span className="drawer-meta-label">Identity</span>
            <span className="drawer-meta-value">{account.accountUsername || account.loginHint}</span>
          </div>
        ) : null}
        {account.tenantId ? (
          <div className="drawer-meta-item drawer-meta-wide">
            <span className="drawer-meta-label">Tenant</span>
            <span className="drawer-meta-value drawer-meta-mono">{account.tenantId}</span>
          </div>
        ) : null}
      </div>

      <form onSubmit={handleEditSubmit} className="drawer-form">
        <input type="hidden" name="name" defaultValue={account.name} />
        <input type="hidden" name="kind" defaultValue={account.kind} />
        <div className="form-row">
          <div className="field">
            <span className="field-label">Description</span>
            <input name="description" defaultValue={account.description || ''} placeholder="Optional" />
          </div>
          <div className="field">
            <span className="field-label">Login Hint</span>
            <input name="loginHint" defaultValue={account.loginHint || ''} placeholder="user@example.com" />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <span className="field-label">Tenant ID</span>
            <input name="tenantId" defaultValue={account.tenantId || ''} />
          </div>
          <div className="field">
            <span className="field-label">Client ID</span>
            <input name="clientId" defaultValue={account.clientId || ''} />
          </div>
        </div>
        <div className="btn-group">
          <button type="submit" className="btn btn-primary btn-sm">
            Save changes
          </button>
        </div>
      </form>

      {interactive ? (
        <section className="drawer-section">
          <div className="drawer-section-header">
            <div>
              <h3>Browser profile</h3>
              <p className="desc">Persistent Chromium profile for Maker, Studio, and Playwright scripts.</p>
            </div>
            <div className="btn-group">
              <button className="btn btn-secondary btn-sm" type="button" disabled={browserProfileBusy} onClick={handleBrowserProfileOpen}>
                Open Maker
              </button>
              <button className="btn btn-ghost btn-sm" type="button" disabled={browserProfileBusy} onClick={handleBrowserProfileVerify}>
                Verify
              </button>
              <button className="btn btn-ghost btn-sm" type="button" disabled={browserProfileBusy || !browserProfile?.configured} onClick={handleBrowserProfileReset}>
                Reset
              </button>
            </div>
          </div>
          <dl className="drawer-definitions">
            <div>
              <dt>Status</dt>
              <dd>{browserProfile?.open ? 'Open' : browserProfile?.exists ? 'Ready' : browserProfileLoaded ? 'Not created' : 'Loading…'}</dd>
            </div>
            <div>
              <dt>Last opened</dt>
              <dd>{formatDate(browserProfile?.profile?.lastOpenedAt)}</dd>
            </div>
            <div>
              <dt>Last verified</dt>
              <dd>{formatDate(browserProfile?.profile?.lastVerifiedAt)}</dd>
            </div>
            <div>
              <dt>Profile path</dt>
              <dd className="drawer-meta-mono">{browserProfile?.profile?.userDataDir || '—'}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <div className="drawer-bottom-actions">
        <button className="btn btn-danger btn-sm" type="button" onClick={handleRemove}>
          Remove account
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// AddAccountForm (still exported for OnboardingFlow; also used by the drawer)
// ---------------------------------------------------------------------------

export function AddAccountForm(props: {
  accounts: SetupAccount[];
  selectedApis: Record<string, boolean>;
  setSelectedApis: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  globalEnvironment: string;
  onLoginStarted: (session: AuthSession) => void;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
  onSaved?: () => void;
}) {
  const { selectedApis, setSelectedApis, globalEnvironment, onLoginStarted, refreshState, toast, onSaved } = props;
  const [accountKind, setAccountKind] = useState<AccountKind>('user');
  const [mode, setMode] = useState<'basic' | 'advanced'>('basic');
  const [preferredFlow, setPreferredFlow] = useState<string>('interactive');
  const [prompt, setPrompt] = useState<string>('');
  const formRef = useRef<HTMLFormElement | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const connectAfterSave = submitter?.value === 'connect';
    const payload = formDataObject(form);
    payload.kind = accountKind;
    try {
      await api('/api/accounts', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      toast('Account saved');
      await refreshState(true);
      if (connectAfterSave && (accountKind === 'user' || accountKind === 'device-code')) {
        const session = await api<ApiEnvelope<AuthSession>>('/api/auth/sessions', {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            excludeApis: ['dv', 'flow', 'powerapps', 'bap', 'graph'].filter((name) => !selectedApis[name]),
            environmentAlias: globalEnvironment || undefined
          })
        });
        onLoginStarted(session.data);
      }
      if (connectAfterSave || accountKind !== 'user') form.reset();
      onSaved?.();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  const isInteractive = accountKind === 'user' || accountKind === 'device-code';
  const showTenantClient = isInteractive || accountKind === 'client-secret';
  const showAdvanced = mode === 'advanced';

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="drawer-form">
      <div className="segmented" role="tablist" aria-label="Form complexity">
        <button type="button" role="tab" aria-selected={mode === 'basic'} className={`segmented-item ${mode === 'basic' ? 'active' : ''}`} onClick={() => setMode('basic')}>
          Basic
        </button>
        <button type="button" role="tab" aria-selected={mode === 'advanced'} className={`segmented-item ${mode === 'advanced' ? 'active' : ''}`} onClick={() => setMode('advanced')}>
          Advanced options
        </button>
      </div>

      <div className="form-row">
        <div className="field">
          <span className="field-label">
            Name
            <span className="field-required" aria-label="required">
              *
            </span>
          </span>
          <input name="name" required placeholder="my-work-account" />
        </div>
        <div className="field">
          <span className="field-label">
            Login Hint
            <span
              className="field-tooltip"
              role="img"
              aria-label="Help"
              data-tooltip="The username pre-filled at sign-in. Required for device-code and silent refresh; optional but recommended for interactive login to skip the account picker."
            >
              ?
            </span>
          </span>
          <input name="loginHint" placeholder="user@example.com" />
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <span className="field-label">Description</span>
          <input name="description" placeholder="Optional" />
        </div>
        <div className="field"></div>
      </div>

      {isInteractive ? (
        <div className="field">
          <span className="field-label">API Scopes to Authenticate</span>
          <div className="api-scope-checks">
            {API_SCOPE_OPTIONS.map((scope) => (
              <label key={scope.key} className="api-scope-check">
                <input type="checkbox" value={scope.key} checked={selectedApis[scope.key]} onChange={(event) => setSelectedApis((current) => ({ ...current, [scope.key]: event.target.checked }))} />
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
              <Select
                name="kind"
                value={accountKind}
                onChange={(next) => setAccountKind(next as AccountKind)}
                options={[
                  { value: 'user', label: 'Interactive (browser login)' },
                  { value: 'device-code', label: 'Device code' },
                  { value: 'client-secret', label: 'Client secret' },
                  { value: 'environment-token', label: 'Environment token variable' },
                  { value: 'static-token', label: 'Static token' }
                ]}
              />
            </div>
            <div className="field"></div>
          </div>

          {showTenantClient ? (
            <div className="form-row">
              <div className="field">
                <span className="field-label">Tenant ID</span>
                <input name="tenantId" placeholder="defaults to common" />
              </div>
              <div className="field">
                <span className="field-label">Client ID</span>
                <input name="clientId" placeholder="defaults to built-in app" />
              </div>
            </div>
          ) : null}

          {isInteractive ? (
            <>
              <div className="form-row">
                <div className="field">
                  <span className="field-label">Preferred Flow</span>
                  <Select
                    name="preferredFlow"
                    value={preferredFlow}
                    onChange={setPreferredFlow}
                    options={[
                      { value: 'interactive', label: 'interactive' },
                      { value: 'device-code', label: 'device-code' }
                    ]}
                  />
                </div>
                <div className="field">
                  <span className="field-label">Prompt</span>
                  <Select
                    name="prompt"
                    value={prompt}
                    onChange={setPrompt}
                    options={[
                      { value: '', label: 'default' },
                      { value: 'select_account', label: 'select_account' },
                      { value: 'login', label: 'login' },
                      { value: 'consent', label: 'consent' },
                      { value: 'none', label: 'none' }
                    ]}
                  />
                </div>
              </div>
              <div className="check-row">
                <input type="checkbox" name="forcePrompt" id="forcePrompt" />
                <label htmlFor="forcePrompt">Force prompt on next login</label>
              </div>
              {accountKind === 'user' ? (
                <div className="check-row">
                  <input type="checkbox" name="fallbackToDeviceCode" id="fallbackToDeviceCode" />
                  <label htmlFor="fallbackToDeviceCode">Allow fallback to device code</label>
                </div>
              ) : null}
            </>
          ) : null}

          {accountKind === 'client-secret' ? (
            <div className="field">
              <span className="field-label">
                Client Secret Env Var
                <span
                  className="field-tooltip"
                  role="img"
                  aria-label="Help"
                  data-tooltip="The name of an environment variable (on the machine running pp) whose value holds the client secret. pp reads it at login time — the secret itself is never stored on disk."
                >
                  ?
                </span>
              </span>
              <input name="clientSecretEnv" placeholder="MY_CLIENT_SECRET" />
            </div>
          ) : null}
          {accountKind === 'environment-token' ? (
            <div className="field">
              <span className="field-label">
                Token Env Var
                <span
                  className="field-tooltip"
                  role="img"
                  aria-label="Help"
                  data-tooltip="Environment variable name that contains a pre-issued bearer token pp will send as-is. Useful for CI or when you already have a token from another tool."
                >
                  ?
                </span>
              </span>
              <input name="environmentVariable" placeholder="MY_TOKEN_VAR" />
            </div>
          ) : null}
          {accountKind === 'static-token' ? (
            <div className="field">
              <span className="field-label">
                Static Token
                <span className="field-tooltip" role="img" aria-label="Help" data-tooltip="A bearer token stored directly in pp config. Avoid in shared repos — prefer environment-token.">
                  ?
                </span>
              </span>
              <textarea name="token" placeholder="Paste token"></textarea>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="btn-group" style={{ marginTop: 12 }}>
        {isInteractive ? (
          <button type="submit" className="btn btn-primary" name="intent" value="connect">
            Save &amp; log in
          </button>
        ) : null}
        <button type="submit" className="btn btn-secondary" name="intent" value="save">
          {isInteractive ? 'Save without logging in' : 'Save account'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// AccountsPanel (dense table)
// ---------------------------------------------------------------------------

type DrawerState = { mode: 'closed' } | { mode: 'new' } | { mode: 'edit'; accountName: string };

export function AccountsPanel(props: {
  accounts: SetupAccount[];
  environments: SetupEnvironment[];
  tokenStatus: TokenStatusMap;
  selectedApis: Record<string, boolean>;
  setSelectedApis: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  globalEnvironment: string;
  login: ReturnType<typeof useAuthSession>;
  confirm: ReturnType<typeof useConfirm>;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { accounts, environments, tokenStatus, selectedApis, setSelectedApis, globalEnvironment, login, confirm, refreshState, toast } = props;
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const [drawer, setDrawer] = useState<DrawerState>({ mode: 'closed' });
  const { width: detailWidth, startDrag: startDetailResize } = useResizableWidth('pp-setup-accounts-detail', { min: 360, max: 820, initial: 440 });
  const detailStyle: SetupDetailStyle | undefined = drawer.mode !== 'closed' ? { '--detail-width': `${detailWidth}px` } : undefined;

  const envCountByAccount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const env of environments || []) {
      if (env.account) counts[env.account] = (counts[env.account] || 0) + 1;
    }
    return counts;
  }, [environments]);

  const rows = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const filtered = query
      ? accounts.filter((account) => {
          const haystack = [account.name, account.kind, account.accountUsername, account.loginHint, account.tenantId, account.description].filter(Boolean).join(' ').toLowerCase();
          return haystack.includes(query);
        })
      : accounts;
    const sorted = [...filtered].sort((a, b) => {
      const direction = sort.dir === 'asc' ? 1 : -1;
      switch (sort.key) {
        case 'kind':
          return String(a.kind || '').localeCompare(String(b.kind || '')) * direction;
        case 'identity': {
          const aId = a.accountUsername || a.loginHint || '';
          const bId = b.accountUsername || b.loginHint || '';
          return String(aId).localeCompare(String(bId)) * direction;
        }
        case 'expiry': {
          const aExp = tokenExpiryMs(tokenStatus[a.name]) ?? 0;
          const bExp = tokenExpiryMs(tokenStatus[b.name]) ?? 0;
          return (aExp - bExp) * direction;
        }
        default:
          return String(a.name || '').localeCompare(String(b.name || '')) * direction;
      }
    });
    return sorted;
  }, [accounts, filter, sort, tokenStatus]);

  function toggleSort(key: SortKey) {
    setSort((current) => {
      if (current.key !== key) return { key, dir: 'asc' };
      return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
    });
  }

  async function handleLogin(account: SetupAccount) {
    const accountEnvironmentAlias =
      globalEnvironment && environments.some((environment) => environment.alias === globalEnvironment && environment.account === account.name) ? globalEnvironment : undefined;
    try {
      const started = await api<ApiEnvelope<AuthSession>>('/api/auth/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: account.name,
          kind: account.kind === 'device-code' ? 'device-code' : 'user',
          loginHint: account.loginHint || account.accountUsername,
          tenantId: account.tenantId,
          clientId: account.clientId,
          environmentAlias: accountEnvironmentAlias,
          excludeApis: ['dv', 'flow', 'powerapps', 'bap', 'graph'].filter((name) => !selectedApis[name])
        })
      });
      login.handleLoginStarted(started.data);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function handleRemove(account: SetupAccount) {
    confirm.open({
      title: `Remove account "${account.name}"?`,
      body: (
        <>
          This deletes the account configuration from <code>pp</code>. Cached tokens for this account will be discarded. Environments still pointing at this account will need to be reassigned.
        </>
      ),
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
      }
    });
  }

  function accountAsJson(account: SetupAccount): string {
    return JSON.stringify(account, null, 2);
  }

  const editingAccount = drawer.mode === 'edit' ? accounts.find((account) => account.name === drawer.accountName) : null;

  return (
    <div className="panel setup-table-panel">
      <div className="setup-table-toolbar">
        <h2>Accounts</h2>
        <div className="setup-table-toolbar-actions">
          <input type="search" className="setup-table-filter" placeholder="Filter accounts…" aria-label="Filter accounts" value={filter} onChange={(event) => setFilter(event.target.value)} />
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void refreshState(false)}>
            Refresh
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setDrawer({ mode: 'new' })}>
            + Add account
          </button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="setup-table-empty">
          <p>No accounts configured yet.</p>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setDrawer({ mode: 'new' })}>
            Add your first account
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="setup-table-empty">No accounts match “{filter}”.</div>
      ) : (
        <div className={`setup-table-area ${drawer.mode !== 'closed' ? 'with-detail' : ''}`} style={detailStyle}>
          <div className="setup-table-scroll">
            <table className="setup-table">
              <thead>
                <tr>
                  <th className="setup-table-sortable" aria-sort={sort.key === 'name' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" onClick={() => toggleSort('name')}>
                      Name{sort.key === 'name' ? <span className="setup-table-sort-arrow">{sort.dir === 'asc' ? '↑' : '↓'}</span> : null}
                    </button>
                  </th>
                  <th className="setup-table-sortable" aria-sort={sort.key === 'kind' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" onClick={() => toggleSort('kind')}>
                      Kind{sort.key === 'kind' ? <span className="setup-table-sort-arrow">{sort.dir === 'asc' ? '↑' : '↓'}</span> : null}
                    </button>
                  </th>
                  <th className="setup-table-sortable" aria-sort={sort.key === 'identity' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" onClick={() => toggleSort('identity')}>
                      Identity{sort.key === 'identity' ? <span className="setup-table-sort-arrow">{sort.dir === 'asc' ? '↑' : '↓'}</span> : null}
                    </button>
                  </th>
                  <th className="setup-table-sortable" aria-sort={sort.key === 'expiry' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" onClick={() => toggleSort('expiry')}>
                      Token{sort.key === 'expiry' ? <span className="setup-table-sort-arrow">{sort.dir === 'asc' ? '↑' : '↓'}</span> : null}
                    </button>
                  </th>
                  <th className="setup-table-count">Envs</th>
                  <th className="setup-table-actions-col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((account) => {
                  const token = tokenStatus[account.name];
                  const state = tokenState(token);
                  const expiry = token?.authenticated ? formatTimeRemaining(token.expiresAt) : null;
                  const interactive = account.kind === 'user' || account.kind === 'device-code';
                  const primaryAction = interactive
                    ? state === 'ok' && expiry?.cls === 'expiring-soon'
                      ? { label: 'Re-auth', variant: 'btn-secondary' }
                      : state !== 'ok'
                        ? { label: 'Log in', variant: 'btn-primary' }
                        : null
                    : null;
                  const isSelected = drawer.mode === 'edit' && drawer.accountName === account.name;
                  return (
                    <tr
                      key={account.name}
                      className={`setup-table-row ${isSelected ? 'selected' : ''}`}
                      tabIndex={0}
                      aria-selected={isSelected}
                      onClick={() => setDrawer({ mode: 'edit', accountName: account.name })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setDrawer({ mode: 'edit', accountName: account.name });
                        }
                      }}
                    >
                      <td>
                        <span className="setup-row-primary">
                          <span className={`health-dot ${state}`} aria-label={`Token state: ${state}`} />
                          <span className="setup-row-name">{account.name}</span>
                        </span>
                        {account.description ? <div className="setup-row-sub">{account.description}</div> : null}
                      </td>
                      <td>
                        <span className="badge">{account.kind}</span>
                      </td>
                      <td className="setup-row-muted">{account.accountUsername || account.loginHint || '—'}</td>
                      <td>
                        {expiry ? (
                          <span className={`token-expiry ${expiry.cls || ''}`}>{expiry.text}</span>
                        ) : state === 'pending' ? (
                          <span className="setup-row-muted">checking…</span>
                        ) : (
                          <span className="token-expiry expired">not signed in</span>
                        )}
                      </td>
                      <td className="setup-table-count">{envCountByAccount[account.name] || 0}</td>
                      <td className="setup-table-actions-col">
                        <div className="setup-row-actions" onClick={(event) => event.stopPropagation()}>
                          {primaryAction ? (
                            <button type="button" className={`btn ${primaryAction.variant} btn-sm`} onClick={() => void handleLogin(account)}>
                              {primaryAction.label}
                            </button>
                          ) : null}
                          <CopyButton value={accountAsJson(account)} label="Copy" title="Copy account config as JSON" toast={toast} stopPropagation />
                          <OverflowMenu
                            items={[
                              { label: 'Edit details', onClick: () => setDrawer({ mode: 'edit', accountName: account.name }) },
                              { label: 'Remove account', destructive: true, onClick: () => handleRemove(account) }
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {drawer.mode !== 'closed' ? (
            <div className="setup-split-detail">
              <div className="setup-detail-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize detail panel" onMouseDown={startDetailResize} />
              <DetailPanel open={drawer.mode === 'new'} title="Add account" subtitle="Connect to Power Platform via Microsoft identity." onClose={() => setDrawer({ mode: 'closed' })}>
                <AddAccountForm
                  accounts={accounts}
                  selectedApis={selectedApis}
                  setSelectedApis={setSelectedApis}
                  globalEnvironment={globalEnvironment}
                  onLoginStarted={login.handleLoginStarted}
                  refreshState={refreshState}
                  toast={toast}
                  onSaved={() => setDrawer({ mode: 'closed' })}
                />
              </DetailPanel>

              <DetailPanel
                open={drawer.mode === 'edit' && !!editingAccount}
                title={editingAccount?.name || 'Account'}
                subtitle={
                  editingAccount ? (
                    <>
                      {editingAccount.kind} · {editingAccount.accountUsername || editingAccount.loginHint || 'no identity'}
                    </>
                  ) : undefined
                }
                onClose={() => setDrawer({ mode: 'closed' })}
              >
                {editingAccount ? (
                  <EditAccountBody
                    key={editingAccount.name}
                    account={editingAccount}
                    tokenStatus={tokenStatus[editingAccount.name]}
                    confirm={confirm}
                    refreshState={refreshState}
                    onClose={() => setDrawer({ mode: 'closed' })}
                    toast={toast}
                  />
                ) : null}
              </DetailPanel>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
