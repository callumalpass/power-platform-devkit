import { FormEvent, useEffect, useState } from 'react';
import { api, formDataObject, formatTimeRemaining, optionList } from '../utils.js';
import { CopyButton } from '../CopyButton.js';
import { Select } from '../Select.js';
import type { ToastFn } from '../ui-types.js';
import { describeTemporaryTokenMatch, normalizeSharePointWebUrl, shellQuote } from './health.js';
import { TOOLS_SUB_TAB_LABELS, type TemporaryTokenSummary, type ToolsSubTab } from './types.js';

// ---------------------------------------------------------------------------
// MCP info
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
// Temporary access tokens
// ---------------------------------------------------------------------------

function TemporaryAccessTokensPanel(props: { toast: ToastFn }) {
  const { toast } = props;
  const [tokens, setTokens] = useState<TemporaryTokenSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [matchKind, setMatchKind] = useState('');
  const [tempApi, setTempApi] = useState('graph');

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
            <Select
              name="matchKind"
              value={matchKind}
              onChange={setMatchKind}
              options={[
                { value: '', label: 'Infer from token audience' },
                { value: 'origin', label: 'URL origin' },
                { value: 'api', label: 'pp API' },
                { value: 'audience', label: 'Token audience' },
              ]}
            />
          </div>
        </div>
        {matchKind === 'origin' ? (
          <div className="field"><span className="field-label">Origin</span><input name="origin" placeholder="https://contoso.sharepoint.com" /></div>
        ) : null}
        {matchKind === 'api' ? (
          <div className="field">
            <span className="field-label">API</span>
            <Select
              name="api"
              value={tempApi}
              onChange={setTempApi}
              options={[
                { value: 'graph', label: 'Graph' },
                { value: 'dv', label: 'Dataverse' },
                { value: 'flow', label: 'Flow' },
                { value: 'powerapps', label: 'Power Apps' },
                { value: 'bap', label: 'Platform Admin' },
                { value: 'sharepoint', label: 'SharePoint REST' },
                { value: 'canvas-authoring', label: 'Canvas Authoring' },
              ]}
            />
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
// SharePoint check
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
            <Select
              aria-label="Account"
              value={account}
              onChange={setAccount}
              options={optionList(accounts.map((a: any) => a.name), 'select account').map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
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

// ---------------------------------------------------------------------------
// ToolsPanel  (combines SharePoint, Temp Tokens, MCP under a left rail)
// ---------------------------------------------------------------------------

export function ToolsPanel(props: { accounts: any[]; shellData: any; toast: ToastFn }) {
  const { accounts, shellData, toast } = props;
  const [activeTool, setActiveTool] = useState<ToolsSubTab>('sharepoint');

  return (
    <div className="setup-tools">
      <nav className="setup-tools-rail" aria-label="Tools">
        {(Object.keys(TOOLS_SUB_TAB_LABELS) as ToolsSubTab[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`setup-tools-rail-item ${activeTool === key ? 'active' : ''}`}
            onClick={() => setActiveTool(key)}
          >
            {TOOLS_SUB_TAB_LABELS[key]}
          </button>
        ))}
      </nav>
      <div>
        {activeTool === 'sharepoint' ? <SharePointPanel accounts={accounts} toast={toast} /> : null}
        {activeTool === 'temp-tokens' ? <TemporaryAccessTokensPanel toast={toast} /> : null}
        {activeTool === 'mcp' ? <McpInfo shellData={shellData} toast={toast} /> : null}
      </div>
    </div>
  );
}
