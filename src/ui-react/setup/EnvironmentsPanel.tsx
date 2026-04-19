import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api, formDataObject, formatTimeRemaining, optionList } from '../utils.js';
import type { ToastFn } from '../ui-types.js';
import { HEALTH_APIS, type HealthEntry, type TokenEntry } from './types.js';
import { healthHint } from './health.js';
import type { useConfirm } from './ConfirmDialog.js';
import { DetailPanel } from './DetailPanel.js';
import { OverflowMenu } from './OverflowMenu.js';
import { useResizableWidth } from './use-resizable-width.js';
import { CopyButton } from '../CopyButton.js';

type DrawerState =
  | { mode: 'closed' }
  | { mode: 'new' }
  | { mode: 'edit'; alias: string };

type SortKey = 'alias' | 'account' | 'health';
type SortDir = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hostFromUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function worstHealth(statuses: Record<string, HealthEntry> | undefined): 'pending' | 'ok' | 'error' {
  if (!statuses) return 'pending';
  let anyPending = false;
  for (const apiName of HEALTH_APIS) {
    const entry = statuses[apiName];
    if (!entry || entry.status === 'pending') { anyPending = true; continue; }
    if (entry.status === 'error') return 'error';
  }
  return anyPending ? 'pending' : 'ok';
}

// ---------------------------------------------------------------------------
// Edit-environment drawer body
// ---------------------------------------------------------------------------

function EditEnvironmentBody(props: {
  environment: any;
  accounts: any[];
  health: Record<string, HealthEntry>;
  tokenStatus: TokenEntry;
  confirm: ReturnType<typeof useConfirm>;
  refreshState: (silent?: boolean) => Promise<void>;
  recheckApi: (alias: string, apiName?: string) => void;
  onClose: () => void;
  toast: ToastFn;
}) {
  const { environment, accounts, health, tokenStatus, confirm, refreshState, recheckApi, onClose, toast } = props;
  const [draft, setDraft] = useState({
    displayName: environment.displayName || '',
    account: environment.account || '',
    url: environment.url || '',
    accessMode: environment.access?.mode === 'read-only' ? 'read-only' : '',
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api(`/api/environments/${encodeURIComponent(environment.alias)}`, {
        method: 'PUT',
        body: JSON.stringify(formDataObject(event.currentTarget)),
      });
      toast('Environment updated');
      await refreshState(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function handleRemove() {
    confirm.open({
      title: `Remove environment "${environment.alias}"?`,
      body: <>This removes the environment configuration from <code>pp</code>. The Dataverse organisation itself is unaffected; you can re-add this environment later.</>,
      confirmLabel: 'Remove environment',
      destructive: true,
      typedConfirmation: environment.alias,
      onConfirm: async () => {
        try {
          await api(`/api/environments/${encodeURIComponent(environment.alias)}`, { method: 'DELETE' });
          toast('Environment removed');
          onClose();
          await refreshState(true);
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), true);
        }
      },
    });
  }

  const tokenExpiry = tokenStatus?.authenticated ? formatTimeRemaining(tokenStatus.expiresAt) : null;
  const tokenClass = tokenStatus === undefined ? 'pending' : tokenStatus.authenticated ? 'ok' : 'error';

  return (
    <>
      <div className="drawer-meta-grid">
        <div className="drawer-meta-item">
          <span className="drawer-meta-label">Alias</span>
          <span className="drawer-meta-value drawer-meta-mono">{environment.alias}</span>
        </div>
        <div className="drawer-meta-item">
          <span className="drawer-meta-label">Host</span>
          <span className="drawer-meta-value drawer-meta-mono">{hostFromUrl(environment.url)}</span>
        </div>
        <div className="drawer-meta-item drawer-meta-wide">
          <span className="drawer-meta-label">Account</span>
          <span className="drawer-meta-value">
            <span className={`health-dot ${tokenClass}`} /> {environment.account || '—'}
            {tokenExpiry ? <span className={`token-expiry ${tokenExpiry.cls || ''}`} style={{ marginLeft: 8 }}>{tokenExpiry.text}</span> : null}
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="drawer-form">
        <input type="hidden" name="alias" value={environment.alias} />
        <div className="form-row">
          <div className="field">
            <span className="field-label">Account<span className="field-required" aria-label="required">*</span></span>
            <select name="account" value={draft.account} onChange={(e) => setDraft((c) => ({ ...c, account: e.target.value }))} required>
              {accounts.map((a: any) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Display Name</span>
            <input name="displayName" placeholder="Optional" value={draft.displayName} onChange={(e) => setDraft((c) => ({ ...c, displayName: e.target.value }))} />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <span className="field-label">URL<span className="field-required" aria-label="required">*</span></span>
            <input name="url" required placeholder="https://org.crm.dynamics.com" value={draft.url} onChange={(e) => setDraft((c) => ({ ...c, url: e.target.value }))} />
          </div>
          <div className="field">
            <span className="field-label">Access</span>
            <select name="accessMode" value={draft.accessMode} onChange={(e) => setDraft((c) => ({ ...c, accessMode: e.target.value }))}>
              <option value="">read-write (default)</option>
              <option value="read-only">read-only</option>
            </select>
          </div>
        </div>
        <div className="btn-group"><button type="submit" className="btn btn-primary btn-sm">Save changes</button></div>
      </form>

      <section className="drawer-section">
        <div className="drawer-section-header">
          <div>
            <h3>Health</h3>
            <p className="desc">Click any API to see the diagnosis and re-check just that one.</p>
          </div>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => recheckApi(environment.alias)}>Re-check all</button>
        </div>
        <div className="drawer-health-list">
          {HEALTH_APIS.map((apiName) => {
            const entry = health?.[apiName];
            const cls = !entry || entry.status === 'pending' ? 'pending' : entry.status === 'ok' ? 'ok' : 'error';
            const hint = entry ? healthHint(entry) : null;
            return (
              <div key={apiName} className={`drawer-health-item ${cls}`}>
                <div className="drawer-health-head">
                  <span className={`health-dot ${cls}`} />
                  <span className="drawer-health-label">{apiName}</span>
                  <span className="drawer-health-summary">{entry?.summary || 'Checking…'}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => recheckApi(environment.alias, apiName)}>Re-check</button>
                </div>
                {entry?.status === 'error' && hint ? (
                  <div className="drawer-health-hint">{hint}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <div className="drawer-bottom-actions">
        <button className="btn btn-danger btn-sm" type="button" onClick={handleRemove}>Remove environment</button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// AddEnvironmentForm (still exported for OnboardingFlow; used by drawer)
// ---------------------------------------------------------------------------

export function AddEnvironmentForm(props: {
  accounts: any[];
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
  onSaved?: () => void;
}) {
  const { accounts, refreshState, toast, onSaved } = props;
  const [discoveries, setDiscoveries] = useState<any[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [selectedDiscoveryAccount, setSelectedDiscoveryAccount] = useState<string>(accounts[0]?.name || '');
  const [draft, setDraft] = useState({
    alias: '',
    account: accounts[0]?.name || '',
    url: '',
    displayName: '',
    accessMode: '',
  });
  const aliasTouchedRef = useRef(false);
  const environmentFormRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!draft.account && accounts[0]?.name) {
      setDraft((current) => ({ ...current, account: accounts[0].name }));
    }
    if (!selectedDiscoveryAccount && accounts[0]?.name) {
      setSelectedDiscoveryAccount(accounts[0].name);
    }
  }, [accounts, draft.account, selectedDiscoveryAccount]);

  async function handleDiscover() {
    if (!selectedDiscoveryAccount) {
      toast('Select an account to discover environments.', true);
      return;
    }
    setDiscovering(true);
    try {
      const payload = await api<any>('/api/environments/discover', {
        method: 'POST',
        body: JSON.stringify({ account: selectedDiscoveryAccount }),
      });
      setDiscoveries(payload.data || []);
      toast(`${(payload.data || []).length} environment${(payload.data || []).length === 1 ? '' : 's'} found`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setDiscovering(false);
    }
  }

  function applyDiscovery(item: any) {
    const alias = item.displayName
      ? item.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      : item.makerEnvironmentId || '';
    aliasTouchedRef.current = false;
    setDraft({
      alias,
      account: item.accountName || selectedDiscoveryAccount || accounts[0]?.name || '',
      url: item.environmentApiUrl || item.environmentUrl || '',
      displayName: item.displayName || '',
      accessMode: '',
    });
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
      setDraft({ alias: '', account: accounts[0]?.name || '', url: '', displayName: '', accessMode: '' });
      setDiscoveries([]);
      aliasTouchedRef.current = false;
      onSaved?.();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  return (
    <div className="drawer-form">
      <section className="drawer-section drawer-section-tight">
        <h3>Discover from account</h3>
        <p className="desc">Pick an account and pull its available environments from the Power Platform admin API.</p>
        <div className="form-row">
          <div className="field">
            <span className="field-label">Account</span>
            <select value={selectedDiscoveryAccount} onChange={(e) => setSelectedDiscoveryAccount(e.target.value)}>
              {optionList(accounts.map((a: any) => a.name), 'select account').map((option) => (
                <option key={`${option.value}-${option.label}`} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ alignSelf: 'end' }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={discovering || !selectedDiscoveryAccount} onClick={() => void handleDiscover()}>
              {discovering ? 'Discovering…' : 'Discover'}
            </button>
          </div>
        </div>
        {discoveries.length ? (
          <div className="drawer-discovery-list">
            {discoveries.map((item, index) => (
              <button
                key={index}
                type="button"
                className="drawer-discovery-item"
                onClick={() => applyDiscovery(item)}
              >
                <div className="drawer-discovery-title">{item.displayName || item.makerEnvironmentId || 'environment'}</div>
                <div className="drawer-discovery-sub">{item.environmentApiUrl || item.environmentUrl || ''}</div>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="drawer-section">
        <h3>Environment details</h3>
        <p className="desc">Confirm the auto-filled values or enter everything by hand.</p>
        <form ref={environmentFormRef} onSubmit={handleEnvironmentSubmit}>
          <div className="form-row">
            <div className="field">
              <span className="field-label">Alias<span className="field-required" aria-label="required">*</span></span>
              <input
                name="alias"
                required
                placeholder="dev, prod"
                value={draft.alias}
                onChange={(e) => { aliasTouchedRef.current = true; setDraft((c) => ({ ...c, alias: e.target.value })); }}
              />
            </div>
            <div className="field">
              <span className="field-label">Account<span className="field-required" aria-label="required">*</span></span>
              <select name="account" value={draft.account} onChange={(e) => setDraft((c) => ({ ...c, account: e.target.value }))} required>
                {accounts.map((a: any) => <option key={a.name} value={a.name}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <span className="field-label">URL<span className="field-required" aria-label="required">*</span></span>
              <input name="url" required placeholder="https://org.crm.dynamics.com" value={draft.url} onChange={(e) => setDraft((c) => ({ ...c, url: e.target.value }))} />
            </div>
            <div className="field">
              <span className="field-label">Display Name</span>
              <input name="displayName" placeholder="Optional" value={draft.displayName} onChange={(e) => setDraft((c) => ({ ...c, displayName: e.target.value }))} />
            </div>
          </div>
          <div className="field">
            <span className="field-label">Access</span>
            <select name="accessMode" value={draft.accessMode} onChange={(e) => setDraft((c) => ({ ...c, accessMode: e.target.value }))}>
              <option value="">read-write (default)</option>
              <option value="read-only">read-only</option>
            </select>
          </div>
          <div className="btn-group"><button type="submit" className="btn btn-primary btn-sm">Save environment</button></div>
        </form>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EnvironmentsPanel (dense table)
// ---------------------------------------------------------------------------

export function EnvironmentsPanel(props: {
  accounts: any[];
  environments: any[];
  tokenStatus: Record<string, any>;
  health: Record<string, Record<string, HealthEntry>>;
  confirm: ReturnType<typeof useConfirm>;
  recheckHealth: () => void;
  recheckApi: (alias: string, apiName?: string) => void;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { accounts, environments, tokenStatus, health, confirm, recheckHealth, recheckApi, refreshState, toast } = props;
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'alias', dir: 'asc' });
  const [drawer, setDrawer] = useState<DrawerState>({ mode: 'closed' });
  const { width: detailWidth, startDrag: startDetailResize } = useResizableWidth('pp-setup-environments-detail', { min: 360, max: 820, initial: 440 });

  const rows = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const filtered = query
      ? environments.filter((env: any) => {
          const haystack = [env.alias, env.displayName, env.account, env.url].filter(Boolean).join(' ').toLowerCase();
          return haystack.includes(query);
        })
      : environments;
    const severityRank: Record<string, number> = { error: 0, pending: 1, ok: 2 };
    const sorted = [...filtered].sort((a: any, b: any) => {
      const direction = sort.dir === 'asc' ? 1 : -1;
      switch (sort.key) {
        case 'account':
          return String(a.account || '').localeCompare(String(b.account || '')) * direction;
        case 'health': {
          const aRank = severityRank[worstHealth(health[a.alias])] ?? 3;
          const bRank = severityRank[worstHealth(health[b.alias])] ?? 3;
          return (aRank - bRank) * direction;
        }
        default:
          return String(a.alias || '').localeCompare(String(b.alias || '')) * direction;
      }
    });
    return sorted;
  }, [environments, filter, sort, health]);

  function toggleSort(key: SortKey) {
    setSort((current) => {
      if (current.key !== key) return { key, dir: 'asc' };
      return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
    });
  }

  function handleRemove(env: any) {
    confirm.open({
      title: `Remove environment "${env.alias}"?`,
      body: <>This removes the environment configuration from <code>pp</code>. The Dataverse organisation itself is unaffected.</>,
      confirmLabel: 'Remove environment',
      destructive: true,
      typedConfirmation: env.alias,
      onConfirm: async () => {
        try {
          await api(`/api/environments/${encodeURIComponent(env.alias)}`, { method: 'DELETE' });
          toast('Environment removed');
          await refreshState(true);
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), true);
        }
      },
    });
  }

  const editingEnv = drawer.mode === 'edit'
    ? environments.find((env: any) => env.alias === drawer.alias)
    : null;

  return (
    <div className="panel setup-table-panel">
      <div className="setup-table-toolbar">
        <h2>Environments</h2>
        <div className="setup-table-toolbar-actions">
          <input
            type="search"
            className="setup-table-filter"
            placeholder="Filter environments…"
            aria-label="Filter environments"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <button className="btn btn-ghost btn-sm" type="button" onClick={recheckHealth}>Re-check health</button>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setDrawer({ mode: 'new' })} disabled={!accounts.length}>+ Add environment</button>
        </div>
      </div>

      {environments.length === 0 ? (
        <div className="setup-table-empty">
          <p>No environments configured yet.</p>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setDrawer({ mode: 'new' })} disabled={!accounts.length}>
            {accounts.length ? 'Add your first environment' : 'Add an account first'}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="setup-table-empty">No environments match “{filter}”.</div>
      ) : (
        <div
          className={`setup-table-area ${drawer.mode !== 'closed' ? 'with-detail' : ''}`}
          style={drawer.mode !== 'closed' ? { ['--detail-width' as any]: `${detailWidth}px` } : undefined}
        >
          <div className="setup-table-scroll">
            <table className="setup-table">
              <thead>
                <tr>
                  <th className="setup-table-sortable" aria-sort={sort.key === 'alias' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" onClick={() => toggleSort('alias')}>Environment{sort.key === 'alias' ? <span className="setup-table-sort-arrow">{sort.dir === 'asc' ? '↑' : '↓'}</span> : null}</button>
                  </th>
                  <th className="setup-table-sortable" aria-sort={sort.key === 'account' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" onClick={() => toggleSort('account')}>Account{sort.key === 'account' ? <span className="setup-table-sort-arrow">{sort.dir === 'asc' ? '↑' : '↓'}</span> : null}</button>
                  </th>
                  <th>Host</th>
                  <th className="setup-table-sortable" aria-sort={sort.key === 'health' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" onClick={() => toggleSort('health')}>Health{sort.key === 'health' ? <span className="setup-table-sort-arrow">{sort.dir === 'asc' ? '↑' : '↓'}</span> : null}</button>
                  </th>
                  <th>Mode</th>
                  <th className="setup-table-actions-col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((env: any) => {
                  const envHealth = health[env.alias] || {};
                  const overall = worstHealth(envHealth);
                  const accountToken = tokenStatus[env.account];
                  const accountClass = accountToken === undefined ? 'pending' : accountToken?.authenticated ? 'ok' : 'error';
                  const readOnly = env.access?.mode === 'read-only';
                  const isSelected = drawer.mode === 'edit' && drawer.alias === env.alias;
                  return (
                    <tr
                      key={env.alias}
                      className={`setup-table-row ${isSelected ? 'selected' : ''}`}
                      tabIndex={0}
                      aria-selected={isSelected}
                      onClick={() => setDrawer({ mode: 'edit', alias: env.alias })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setDrawer({ mode: 'edit', alias: env.alias });
                        }
                      }}
                    >
                      <td>
                        <span className="setup-row-primary">
                          <span className={`health-dot ${overall}`} aria-label={`Overall health: ${overall}`} />
                          <span className="setup-row-name">{env.alias}</span>
                        </span>
                        {env.displayName && env.displayName !== env.alias ? (
                          <div className="setup-row-sub">{env.displayName}</div>
                        ) : null}
                      </td>
                      <td>
                        <span className="setup-row-primary">
                          <span className={`health-dot ${accountClass}`} />
                          <span className="setup-row-name">{env.account || '—'}</span>
                        </span>
                      </td>
                      <td className="setup-row-mono">{hostFromUrl(env.url)}</td>
                      <td>
                        <div className="setup-row-health-dots" onClick={(event) => event.stopPropagation()}>
                          {HEALTH_APIS.map((apiName) => {
                            const entry = envHealth[apiName];
                            const cls = !entry || entry.status === 'pending' ? 'pending' : entry.status === 'ok' ? 'ok' : 'error';
                            const summary = entry?.summary || 'Checking…';
                            return (
                              <button
                                key={apiName}
                                type="button"
                                className={`setup-health-dot ${cls}`}
                                title={`${apiName}: ${summary}`}
                                aria-label={`${apiName} health: ${summary}`}
                                onClick={() => setDrawer({ mode: 'edit', alias: env.alias })}
                              >
                                <span className="setup-health-dot-label">{apiName}</span>
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td>{readOnly ? <span className="badge badge-readonly">read-only</span> : <span className="setup-row-muted">rw</span>}</td>
                      <td className="setup-table-actions-col">
                        <div className="setup-row-actions" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            title="Re-check health for this environment"
                            onClick={() => recheckApi(env.alias)}
                          >Re-check</button>
                          <CopyButton
                            value={env.url || ''}
                            label="Copy"
                            title="Copy environment URL"
                            toast={toast}
                            stopPropagation
                          />
                          <OverflowMenu
                            items={[
                              { label: 'Edit details', onClick: () => setDrawer({ mode: 'edit', alias: env.alias }) },
                              { label: 'Remove environment', destructive: true, onClick: () => handleRemove(env) },
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
              <div
                className="setup-detail-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize detail panel"
                onMouseDown={startDetailResize}
              />
              <DetailPanel
                open={drawer.mode === 'new'}
                title="Add environment"
                subtitle="Discover from an account or enter details manually."
                onClose={() => setDrawer({ mode: 'closed' })}
              >
                <AddEnvironmentForm
                  accounts={accounts}
                  refreshState={refreshState}
                  toast={toast}
                  onSaved={() => setDrawer({ mode: 'closed' })}
                />
              </DetailPanel>

              <DetailPanel
                open={drawer.mode === 'edit' && !!editingEnv}
                title={editingEnv?.alias || 'Environment'}
                subtitle={editingEnv ? <>{editingEnv.displayName || hostFromUrl(editingEnv.url)} · {editingEnv.account}</> : undefined}
                onClose={() => setDrawer({ mode: 'closed' })}
              >
                {editingEnv ? (
                  <EditEnvironmentBody
                    key={editingEnv.alias}
                    environment={editingEnv}
                    accounts={accounts}
                    health={health[editingEnv.alias] || {}}
                    tokenStatus={tokenStatus[editingEnv.account]}
                    confirm={confirm}
                    refreshState={refreshState}
                    recheckApi={recheckApi}
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
