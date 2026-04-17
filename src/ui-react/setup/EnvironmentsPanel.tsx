import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, formDataObject, formatTimeRemaining, optionList } from '../utils.js';
import type { ToastFn } from '../ui-types.js';
import { HEALTH_APIS, type HealthEntry, type TokenEntry } from './types.js';
import { healthHint } from './health.js';
import type { useConfirm } from './ConfirmDialog.js';

// ---------------------------------------------------------------------------
// EnvironmentCard
// ---------------------------------------------------------------------------

export function EnvironmentCard(props: {
  environment: any;
  health: Record<string, HealthEntry>;
  tokenStatus: TokenEntry;
  confirm: ReturnType<typeof useConfirm>;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { environment, health: envHealth, tokenStatus: accountInfo, confirm, refreshState, toast } = props;
  const [expandedHealth, setExpandedHealth] = useState<string | null>(null);
  const accountClass = accountInfo === undefined ? 'pending' : accountInfo?.authenticated ? 'ok' : 'error';
  const accountExpiry = accountInfo?.authenticated ? formatTimeRemaining(accountInfo.expiresAt) : null;

  function handleRemove() {
    confirm.open({
      title: `Remove environment "${environment.alias}"?`,
      body: <>This removes the environment configuration from <code>pp</code>. The Dataverse organisation itself is unaffected; you can re-add this environment later.</>,
      confirmLabel: 'Remove environment',
      destructive: true,
      onConfirm: async () => {
        try {
          await api(`/api/environments/${encodeURIComponent(environment.alias)}`, { method: 'DELETE' });
          toast('Environment removed');
          await refreshState(true);
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), true);
        }
      },
    });
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
// AddEnvironmentForm
// ---------------------------------------------------------------------------

export function AddEnvironmentForm(props: {
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
              <button className="btn btn-primary btn-sm" type="button" onClick={() => {
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
        <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--muted)' }} onClick={() => setShowManual(true)}>
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
// EnvironmentsPanel
// ---------------------------------------------------------------------------

export function EnvironmentsPanel(props: {
  accounts: any[];
  environments: any[];
  tokenStatus: Record<string, any>;
  health: Record<string, Record<string, HealthEntry>>;
  confirm: ReturnType<typeof useConfirm>;
  recheckHealth: () => void;
  refreshState: (silent?: boolean) => Promise<void>;
  toast: ToastFn;
}) {
  const { accounts, environments, tokenStatus, health, confirm, recheckHealth, refreshState, toast } = props;

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Environments</h2>
        <button className="btn btn-ghost btn-sm" type="button" onClick={recheckHealth}>Re-check health</button>
      </div>

      {environments.length ? (
        <div className="card-list">
          {environments.map((env: any) => (
            <EnvironmentCard
              key={env.alias}
              environment={env}
              health={health[env.alias] || {}}
              tokenStatus={tokenStatus[env.account]}
              confirm={confirm}
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
