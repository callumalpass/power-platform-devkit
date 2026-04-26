import { useEffect, useState } from 'react';
import { api, optionList, readRecord } from '../utils.js';
import { CopyButton } from '../CopyButton.js';
import { Select } from '../Select.js';
import type { AccountSummary, ApiEnvelope, ApiExecuteResponse, ShellState, ToastFn } from '../ui-types.js';
import { normalizeSharePointWebUrl, shellQuote } from './health.js';
import { TOOLS_SUB_TAB_LABELS, type ToolsSubTab } from './types.js';

// ---------------------------------------------------------------------------
// MCP info
// ---------------------------------------------------------------------------

type SharePointCheckResult = ApiEnvelope<ApiExecuteResponse<unknown>>;

function McpInfo(props: { shellData: ShellState | null; toast: ToastFn }) {
  const { shellData, toast } = props;
  const mcp = shellData?.mcp;
  const launchCommand = mcp?.launchCommand ?? '';
  const tools = mcp?.tools ?? [];
  return (
    <div className="panel">
      <h2>MCP Server</h2>
      <p className="desc">The MCP server uses stdio transport. Launch it from your MCP client.</p>
      {mcp ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <span className="field-label">Launch Command</span>
          </div>
          <div className="mcp-cmd-wrap">
            <div className="mcp-cmd">{launchCommand}</div>
            <CopyButton value={launchCommand} label="Copy" title="Copy launch command" toast={toast} className="mcp-copy" />
          </div>
          <div style={{ marginBottom: 8 }}>
            <span className="field-label">Available Tools ({tools.length})</span>
          </div>
          <div className="tool-grid">
            {tools.map((tool: string) => (
              <div key={tool} className="copy-inline">
                <code>{tool}</code>
                <CopyButton value={tool} label="copy" title="Copy tool name" toast={toast} />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SharePoint check
// ---------------------------------------------------------------------------

function SharePointPanel(props: { accounts: AccountSummary[]; toast: ToastFn }) {
  const { accounts, toast } = props;
  const [account, setAccount] = useState(accounts[0]?.name || '');
  const [siteUrl, setSiteUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SharePointCheckResult | null>(null);

  useEffect(() => {
    if (!account && accounts[0]?.name) setAccount(accounts[0].name);
  }, [accounts, account]);

  const requestUrl = normalizeSharePointWebUrl(siteUrl);
  const cli = account && requestUrl ? `pp sp ${shellQuote(requestUrl)} --account ${shellQuote(account)}` : '';

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
      const payload = await api<SharePointCheckResult>('/api/request/execute', {
        method: 'POST',
        body: JSON.stringify({
          account,
          api: 'sharepoint',
          method: 'GET',
          path: requestUrl,
          softFail: true
        }),
        allowFailure: true
      });
      setResult(payload);
      toast(payload.success === false ? 'SharePoint check failed' : 'SharePoint is reachable', payload.success === false);
    } catch (error) {
      setResult({ success: false, data: { response: undefined }, diagnostics: [{ message: error instanceof Error ? error.message : String(error) }] });
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setLoading(false);
    }
  }

  const web = readRecord(result?.data?.response);
  const webTitle = typeof web?.Title === 'string' ? web.Title : '';
  const webUrl = typeof web?.Url === 'string' ? web.Url : '';
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
              options={optionList(
                accounts.map((account) => account.name),
                'select account'
              ).map((option) => ({
                value: option.value,
                label: option.label
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
            <div className="card-item-title">{result.success === false ? 'Access check failed' : 'Access check succeeded'}</div>
            {result.success === false ? (
              <div className="card-item-sub">{diagnostic?.message || 'SharePoint request failed.'}</div>
            ) : (
              <>
                <div className="card-item-sub">Status {result.data?.status ?? '-'}</div>
                {webTitle ? <div className="card-item-sub">Site {webTitle}</div> : null}
                {webUrl ? <div className="card-item-sub">{webUrl}</div> : null}
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

export function ToolsPanel(props: { accounts: AccountSummary[]; shellData: ShellState | null; toast: ToastFn }) {
  const { accounts, shellData, toast } = props;
  const [activeTool, setActiveTool] = useState<ToolsSubTab>('sharepoint');

  return (
    <div className="setup-tools">
      <nav className="setup-tools-rail" aria-label="Tools">
        {(Object.keys(TOOLS_SUB_TAB_LABELS) as ToolsSubTab[]).map((key) => (
          <button key={key} type="button" className={`setup-tools-rail-item ${activeTool === key ? 'active' : ''}`} onClick={() => setActiveTool(key)}>
            {TOOLS_SUB_TAB_LABELS[key]}
          </button>
        ))}
      </nav>
      <div>
        {activeTool === 'sharepoint' ? <SharePointPanel accounts={accounts} toast={toast} /> : null}
        {activeTool === 'mcp' ? <McpInfo shellData={shellData} toast={toast} /> : null}
      </div>
    </div>
  );
}
