import { UI_CSS } from './ui-style.js';

type AppMode = 'desktop' | 'setup';

export function renderHtml(options: { scriptSrc?: string; appMode?: AppMode; setupToken?: string; title?: string } = {}): string {
  const scriptSrc = options.scriptSrc ?? '/assets/ui/app.js';
  const title = options.title ?? 'pp';
  const boot = {
    mode: options.appMode ?? 'desktop',
    setupToken: options.setupToken,
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2aWV3Qm94PSIwIDAgMjU2IDI1NiIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsbGVkYnk9InRpdGxlIGRlc2MiPgogIDx0aXRsZSBpZD0idGl0bGUiPnBwIGljb248L3RpdGxlPgogIDxkZXNjIGlkPSJkZXNjIj5Qb3dlciBQbGF0Zm9ybSBDTEkgbW9ub2dyYW0uPC9kZXNjPgogIDxyZWN0IHdpZHRoPSIyNTYiIGhlaWdodD0iMjU2IiByeD0iNTIiIGZpbGw9IiMxYTFhMTkiLz4KICA8cGF0aAogICAgZmlsbD0iI2Y2ZjZmNSIKICAgIGQ9Im0gMzguMjAwMDY0LDEyNC42IGMgMi45LC0yLjggNS45LC01LjIgOC45LC03LjMgbCAtMjcuOCwxMDAuNyBjIC0xLjMsNC44IC0yLjQsNi40IC04LjcsOC4yIC0yLjk5OTk5OTksMS42IC00LjE5OTk5OTksMyAtNC4xOTk5OTk5LDUgMCwyLjYgMS43LDQuMiA0LjU5OTk5OTksNC4yIGwgNDUuOSwtMC44IGMgMy4zLDAgNS41LC0xLjkgNS41LC00LjkgMCwtMS44IC0xLjEsLTMuMSAtMy44LC0zLjggbCAtNi4yLC0xLjEgYyAtNC4yLC0wLjggLTQuNCwtMy42IC0zLC04LjkgbCA4LjIsLTMwLjYgYyA0LjUsMi42IDEwLjMsNC4yIDE3LjUsNC4yIDI0LjYsMC4xIDQ2LjQ5OTk5NiwtMTkuMyA0OC41OTk5OTYsLTUwLjggMS45LC0yNC44IC0xMS42LC00MS43IC0zNy4yOTk5OTYsLTQxLjkgLTEuOCwwIC0zLjUsMC4xIC01LjIsMC4xIGwgMS4yLC00LjcgYyAyLC03LjcgMC41LC0xMS43IC00LjgsLTExLjcgLTUuOSwwIC0yMyw5IC0yNSwxNi43IGwgLTIsNy40IGMgLTYuMywzLjMgLTExLjcsNy40IC0xNi4yLDEyLjEgLTIuOSwyLjkgLTQsNi41IC0yLjIsOC40IDEuNCwxLjUgMy44LDEuNCA2LC0wLjUgeiBtIDI5LjMsNTQuMiBjIC0yLjksLTAuMSAtNS40LC0wLjggLTcuNiwtMi4zIGwgMTguNiwtNjkuNiBjIDAuNCwwIDAuOCwwIDEuMywwIDkuNiwwLjIgMTYsOSAxMywzMC40IC0zLjEsMjYuMiAtMTMuOCw0MS42IC0yNS4zLDQxLjUgeiBNIDE0MC40LDEyNC42IGMgMi45LC0yLjggNS45LC01LjIgOC45LC03LjMgTCAxMjEuNSwyMTggYyAtMS4zLDQuOCAtMi40LDYuNCAtOC43LDguMiAtMywxLjYgLTQuMiwzIC00LjIsNSAwLDIuNiAxLjcsNC4yIDQuNiw0LjIgbCA0NS45LC0wLjggYyAzLjMsMCA1LjUsLTEuOSA1LjUsLTQuOSAwLC0xLjggLTEuMSwtMy4xIC0zLjgsLTMuOCBsIC02LjIsLTEuMSBjIC00LjIsLTAuOCAtNC40LC0zLjYgLTMsLTguOSBsIDguMiwtMzAuNiBjIDQuNSwyLjYgMTAuMyw0LjIgMTcuNSw0LjIgMjQuNiwwLjEgNDYuNSwtMTkuMyA0OC42LC01MC44IDEuOSwtMjQuOCAtMTEuNiwtNDEuNyAtMzcuMywtNDEuOSAtMS44LDAgLTMuNSwwLjEgLTUuMiwwLjEgbCAxLjIsLTQuNyBjIDIsLTcuNyAwLjUsLTExLjcgLTQuOCwtMTEuNyAtNS45LDAgLTIzLDkgLTI1LDE2LjcgbCAtMiw3LjQgYyAtNi4zLDMuMyAtMTEuNyw3LjQgLTE2LjIsMTIuMSAtMi45LDIuOSAtNCw2LjUgLTIuMiw4LjQgMS40LDEuNSAzLjgsMS40IDYsLTAuNSB6IG0gMjkuMyw1NC4yIGMgLTIuOSwtMC4xIC01LjQsLTAuOCAtNy42LC0yLjMgbCAxOC42LC02OS42IGMgMC40LDAgMC44LDAgMS4zLDAgOS42LDAuMiAxNiw5IDEzLDMwLjQgLTMuMSwyNi4yIC0xMy44LDQxLjYgLTI1LjMsNDEuNSB6IgogIC8+Cjwvc3ZnPgo=">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&family=Geist:wght@100..900&display=swap" rel="stylesheet">
  <title>${escapeHtml(title)}</title>
  <style>${UI_CSS}</style>
</head>
<body>
  <div id="app-root"></div>
  <div id="legacy-shell" hidden>
  <div class="toast-container" id="toasts"></div>
  <header class="header">
    <div class="header-inner">
      <span class="logo"><svg width="24" height="24" viewBox="46 43 172 174" aria-label="pp"><mask id="pp-m"><rect x="46" y="43" width="172" height="174" fill="white"/><circle cx="100" cy="88" r="18" fill="black"/><circle cx="164" cy="88" r="18" fill="black"/></mask><g fill="currentColor" mask="url(#pp-m)"><rect x="64" y="52" width="18" height="156" rx="9"/><circle cx="100" cy="88" r="36"/><rect x="128" y="52" width="18" height="156" rx="9"/><circle cx="164" cy="88" r="36"/></g></svg></span>
      <div class="header-env">
        <label>ENV</label>
        <select id="global-environment" style="flex:1"></select>
      </div>
      <div class="header-meta" id="meta"></div>
      <button class="theme-toggle" id="theme-toggle" title="Toggle dark/light mode">&#9790;</button>
    </div>
  </header>
  <nav class="tabs">
    <div class="tabs-inner">
      <button class="tab" data-tab="setup">Setup</button>
      <button class="tab" data-tab="console">Console</button>
      <div class="tab-sep"></div>
      <button class="tab active" data-tab="dataverse">Dataverse</button>
      <button class="tab" data-tab="automate">Automate</button>
      <button class="tab" data-tab="apps">Apps</button>
      <button class="tab" data-tab="platform">Platform</button>
    </div>
  </nav>
  <div class="app-main">

    <!-- ===== Setup ===== -->
    <div class="tab-panel stack" id="panel-setup">
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2>Accounts</h2>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost" id="refresh-state" type="button" style="font-size:0.75rem;padding:4px 10px">Refresh</button>
          </div>
        </div>
        <div class="card-list" id="accounts-list"></div>
        <div id="login-link-panel" class="login-link-panel hidden" style="margin-top:14px">
          <div class="login-link-head">
            <span class="field-label">Authentication Links</span>
            <button type="button" class="btn btn-ghost" id="login-link-copy" style="font-size:0.75rem;padding:4px 10px">Copy URLs</button>
          </div>
          <div id="login-link-status" class="login-link-status">Waiting for the identity provider to return a sign-in link\u2026</div>
          <div id="login-link-targets" style="display:grid;gap:8px"></div>
        </div>
        <details class="setup-add-section" id="add-account-section">
          <summary class="setup-add-trigger">+ Add account</summary>
          <div class="setup-add-body">
            <form id="account-form">
              <div class="form-row">
                <div class="field"><span class="field-label">Name</span><input name="name" required placeholder="my-work-account"></div>
                <div class="field"><span class="field-label">Kind</span>
                  <select name="kind" id="account-kind">
                    <option value="user">user</option>
                    <option value="device-code">device-code</option>
                    <option value="client-secret">client-secret</option>
                    <option value="environment-token">environment-token</option>
                    <option value="static-token">static-token</option>
                  </select>
                </div>
              </div>
              <div class="form-row">
                <div class="field"><span class="field-label">Description</span><input name="description" placeholder="Optional"></div>
                <div class="field conditional cond-user cond-device-code"><span class="field-label">Preferred Flow</span><select name="preferredFlow"><option value="interactive">interactive</option><option value="device-code">device-code</option></select></div>
              </div>
              <div class="form-row conditional cond-user cond-device-code cond-client-secret">
                <div class="field"><span class="field-label">Tenant ID <span style="text-transform:none;font-weight:400;letter-spacing:0">(optional)</span></span><input name="tenantId" placeholder="defaults to common"></div>
                <div class="field"><span class="field-label">Client ID <span style="text-transform:none;font-weight:400;letter-spacing:0">(optional)</span></span><input name="clientId" placeholder="defaults to built-in app"></div>
              </div>
              <div class="form-row conditional cond-user cond-device-code">
                <div class="field"><span class="field-label">Login Hint</span><input name="loginHint" placeholder="user@example.com"></div>
                <div class="field"><span class="field-label">Prompt</span><select name="prompt"><option value="">default</option><option value="select_account">select_account</option><option value="login">login</option><option value="consent">consent</option><option value="none">none</option></select></div>
              </div>
              <div class="form-row conditional cond-client-secret"><div class="field"><span class="field-label">Client Secret Env Var</span><input name="clientSecretEnv" placeholder="MY_CLIENT_SECRET"></div><div class="field"></div></div>
              <div class="form-row conditional cond-environment-token"><div class="field"><span class="field-label">Token Env Var</span><input name="environmentVariable" placeholder="MY_TOKEN_VAR"></div><div class="field"></div></div>
              <div class="conditional cond-static-token"><div class="field"><span class="field-label">Static Token</span><textarea name="token" placeholder="Paste token"></textarea></div></div>
              <div class="check-row conditional cond-user cond-device-code"><input type="checkbox" name="forcePrompt" id="forcePrompt"><label for="forcePrompt">Force prompt on next login</label></div>
              <div class="check-row conditional cond-user"><input type="checkbox" name="fallbackToDeviceCode" id="fallbackToDeviceCode"><label for="fallbackToDeviceCode">Allow fallback to device code</label></div>
              <div class="conditional cond-user cond-device-code" id="api-scope-section">
                <div class="field">
                  <span class="field-label">API Scopes to Authenticate</span>
                  <div class="api-scope-checks" id="api-scope-checks">
                    <label class="api-scope-check"><input type="checkbox" value="dv" checked> Dataverse</label>
                    <label class="api-scope-check"><input type="checkbox" value="flow" checked> Flow</label>
                    <label class="api-scope-check"><input type="checkbox" value="powerapps" checked> Power Apps & BAP <span class="api-scope-note">shared token</span></label>
                    <label class="api-scope-check"><input type="checkbox" value="graph"> Graph <span class="api-scope-note">optional</span></label>
                  </div>
                </div>
              </div>
              <div class="btn-group">
                <button type="submit" class="btn btn-primary" id="account-submit">Save & Login</button>
                <button type="button" class="btn btn-danger hidden" id="account-cancel">Cancel Pending Login</button>
              </div>
            </form>
          </div>
        </details>
      </div>

      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2>Environments</h2>
          <button class="btn btn-ghost" id="recheck-health" type="button" style="font-size:0.75rem;padding:4px 10px">Re-check health</button>
        </div>
        <div class="card-list" id="environments-list"></div>
        <details class="setup-add-section">
          <summary class="setup-add-trigger">+ Add environment</summary>
          <div class="setup-add-body">
            <form id="discover-form" style="margin-bottom:16px">
              <div class="form-row">
                <div class="field"><span class="field-label">Account</span><select name="account" id="discover-account"></select></div>
                <div class="field" style="align-self:end"><button type="submit" class="btn btn-secondary" id="discover-submit">Discover</button></div>
              </div>
            </form>
            <div class="card-list" id="discovered-list" style="margin-bottom:16px"></div>
            <form id="environment-form">
              <div class="form-row">
                <div class="field"><span class="field-label">Alias</span><input name="alias" required placeholder="dev, prod"></div>
                <div class="field"><span class="field-label">Account</span><select name="account" id="environment-account"></select></div>
              </div>
              <div class="form-row">
                <div class="field"><span class="field-label">URL</span><input name="url" required placeholder="https://org.crm.dynamics.com"></div>
                <div class="field"><span class="field-label">Display Name</span><input name="displayName" placeholder="Optional"></div>
              </div>
              <div class="field"><span class="field-label">Access</span><select name="accessMode"><option value="">read-write (default)</option><option value="read-write">read-write</option><option value="read-only">read-only</option></select></div>
              <div class="btn-group"><button type="submit" class="btn btn-primary" id="env-submit">Discover & Save</button></div>
            </form>
          </div>
        </details>
      </div>

      <details class="setup-add-section" style="border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);padding:0">
        <summary class="setup-add-trigger" style="padding:16px 20px">MCP Server</summary>
        <div style="padding:0 20px 20px">
          <p class="desc">The MCP server uses stdio transport. Launch it from your MCP client.</p>
          <div id="mcp-content"></div>
        </div>
      </details>
    </div>

    <!-- ===== API Console ===== -->
    <div class="tab-panel stack" id="panel-console">
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2>API Console</h2>
          <select id="console-preset" style="max-width:260px;font-size:0.8125rem"></select>
        </div>
        <div class="console-bar">
          <select id="console-api"></select>
          <select id="console-method"></select>
          <input type="text" id="console-path" placeholder="/WhoAmI">
          <button class="btn btn-primary" id="console-send">Send</button>
        </div>
        <div class="console-scope-hint" id="console-scope-hint"></div>
        <div class="console-sections">
          <details>
            <summary>Query Parameters</summary>
            <div class="section-body">
              <div id="console-query-params" class="kv-list"></div>
              <button class="btn btn-ghost" id="console-add-query-param" type="button" style="margin-top:6px;padding:4px 10px;font-size:0.75rem">+ Add parameter</button>
            </div>
          </details>
          <details>
            <summary>Headers</summary>
            <div class="section-body">
              <div id="console-headers" class="kv-list"></div>
              <button class="btn btn-ghost" id="console-add-header" type="button" style="margin-top:6px;padding:4px 10px;font-size:0.75rem">+ Add header</button>
            </div>
          </details>
          <details id="console-body-section">
            <summary>Request Body</summary>
            <div class="section-body">
              <textarea id="console-body" rows="8" placeholder='{ "key": "value" }'></textarea>
            </div>
          </details>
        </div>
      </div>
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h2>Response <span id="console-response-status" class="console-status-badge" style="margin-left:8px"></span></h2>
          <span id="console-response-time" style="font-size:0.75rem;color:var(--muted);font-family:var(--mono)"></span>
        </div>
        <details style="margin-bottom:8px;display:none">
          <summary style="cursor:pointer;font-size:0.75rem;color:var(--muted)">Response Headers</summary>
          <pre class="viewer" id="console-response-headers-body" style="min-height:40px;margin-top:6px"></pre>
        </details>
        <div class="response-toolbar">
          <div class="response-meta">
            <span id="console-response-size" class="response-size"></span>
          </div>
          <button class="btn btn-ghost" id="console-copy-response" type="button" style="font-size:0.75rem;padding:4px 10px">Copy</button>
        </div>
        <pre class="viewer" id="console-response-body">Send a request to see the response.</pre>
      </div>
      <div class="panel" id="console-saved-panel" style="display:none">
        <h2 style="margin-bottom:12px">Saved Requests</h2>
        <div id="console-saved" class="card-list"></div>
      </div>
      <div class="panel">
        <h2 style="margin-bottom:12px">History</h2>
        <div id="console-history" class="card-list">
          <div class="empty">No requests yet.</div>
        </div>
      </div>
    </div>

    <!-- ===== Dataverse Workspace ===== -->
    <div class="tab-panel active" id="panel-dataverse">
      <div class="entity-sidebar">
        <div class="panel">
          <h2>Entities</h2>
          <input type="text" id="entity-filter" class="entity-filter" placeholder="Filter entities\u2026">
          <div id="entity-count" class="entity-count"></div>
          <div id="entity-list" class="entity-list">
            <div class="entity-loading">Select an environment to load entities.</div>
          </div>
        </div>
      </div>
      <div class="detail-area" id="dv-workspace-area">
        <div class="dv-sub-nav">
          <button class="sub-tab active" data-dvtab="dv-explorer">Explorer</button>
          <button class="sub-tab" data-dvtab="dv-query">Query</button>
          <button class="sub-tab" data-dvtab="dv-fetchxml">FetchXML</button>
          <button class="sub-tab" data-dvtab="dv-relationships">Relationships</button>
        </div>

        <!-- Explorer sub-panel -->
        <div class="dv-subpanel active" id="dv-subpanel-dv-explorer">
          <div class="panel" id="entity-detail-panel">
            <div id="entity-detail-empty">
              <h2>Entity Detail</h2>
              <p class="desc">Select an entity from the list to inspect its metadata and preview records.</p>
              <div class="empty">No entity selected.</div>
            </div>
            <div id="entity-detail" class="hidden">
              <div class="sub-tabs">
                <button class="sub-tab active" data-subtab="metadata">Metadata</button>
                <button class="sub-tab" data-subtab="records">Records</button>
              </div>

              <!-- Metadata sub-panel -->
              <div class="sub-panel active" id="subpanel-metadata">
                <h2 id="entity-title"></h2>
                <p class="desc" id="entity-subtitle"></p>
                <div id="entity-metrics" class="metrics"></div>
                <div class="btn-group" style="margin-bottom:12px">
                  <button class="btn btn-primary btn-sm" id="entity-to-query" type="button">Use in Query</button>
                  <button class="btn btn-primary btn-sm" id="entity-to-fetchxml" type="button">Use in FetchXML</button>
                </div>
                <div class="selected-cols" id="selected-cols">
                  <span class="selected-cols-label">Selected:</span>
                  <span style="color:var(--muted);font-size:0.75rem">Click attributes below to select columns</span>
                </div>
                <input type="text" id="attr-filter" class="attr-filter" placeholder="Filter attributes\u2026">
                <div class="table-wrap">
                  <table>
                    <thead><tr><th></th><th>Column</th><th>Type</th><th>Flags</th></tr></thead>
                    <tbody id="attribute-table"></tbody>
                  </table>
                </div>
              </div>

              <!-- Records sub-panel -->
              <div class="sub-panel" id="subpanel-records">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                  <h2>Record Preview</h2>
                  <button class="btn btn-secondary" id="entity-refresh-records" type="button">Refresh</button>
                </div>
                <div id="record-preview-path" style="font-family:var(--mono);font-size:0.75rem;color:var(--muted);margin-bottom:8px"></div>
                <div class="result-toggle" id="record-preview-toggle" style="margin-top:8px">
                  <button class="result-toggle-btn active" data-view="table">Table</button>
                  <button class="result-toggle-btn" data-view="json">JSON</button>
                </div>
                <div id="record-preview-table"></div>
                <pre class="viewer" id="record-preview-json" style="display:none">Select an entity to preview records.</pre>
              </div>
            </div>
          </div>
        </div>

        <!-- Query sub-panel -->
        <div class="dv-subpanel" id="dv-subpanel-dv-query">
          <div class="panel">
            <h2>Web API Query</h2>
            <div class="entity-context" id="query-entity-context">
              <span class="entity-context-empty">No entity selected \u2014 pick one in Explorer or type an entity set below</span>
            </div>
            <form id="query-form">
              <div class="form-row">
                <div class="field">
                  <span class="field-label">Entity Set</span>
                  <input name="entitySetName" id="query-entity-set" placeholder="accounts">
                </div>
                <div class="field">
                  <span class="field-label">Top</span>
                  <input name="top" type="number" min="1" step="1" value="10">
                </div>
              </div>
              <div class="field">
                <span class="field-label">Select Columns (CSV)</span>
                <input name="selectCsv" id="query-select" placeholder="accountid,name,accountnumber">
              </div>
              <div class="field">
                <span class="field-label">Filter</span>
                <input name="filter" id="query-filter" placeholder="contains(name,'Contoso')">
              </div>
              <div class="form-row">
                <div class="field">
                  <span class="field-label">Order By (CSV)</span>
                  <input name="orderByCsv" id="query-order" placeholder="name asc,createdon desc">
                </div>
                <div class="field">
                  <span class="field-label">Expand (CSV)</span>
                  <input name="expandCsv" id="query-expand" placeholder="primarycontactid($select=fullname)">
                </div>
              </div>
              <div class="field">
                <span class="field-label">Raw Path Override</span>
                <input name="rawPath" id="query-raw-path" placeholder="/api/data/v9.2/accounts?$select=name">
              </div>
              <div class="check-row"><input type="checkbox" name="includeCount" id="query-count"><label for="query-count">Include count</label></div>
              <div class="btn-group">
                <button class="btn btn-secondary" id="query-preview-btn" type="button">Preview Path</button>
                <button class="btn btn-primary" id="query-run-btn" type="button">Run Query</button>
              </div>
            </form>
          </div>
          <div class="panel">
            <h2>Generated Path</h2>
            <pre class="viewer" id="query-preview">Preview a Dataverse path here.</pre>
          </div>
          <div class="panel">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <h2>Query Result</h2>
              <div class="result-toggle" id="query-result-toggle">
                <button class="result-toggle-btn active" data-view="table">Table</button>
                <button class="result-toggle-btn" data-view="json">JSON</button>
              </div>
            </div>
            <div id="query-result-table"></div>
            <pre class="viewer" id="query-result" style="display:none">Run a query to see the response.</pre>
          </div>
        </div>

        <!-- FetchXML sub-panel -->
        <div class="dv-subpanel" id="dv-subpanel-dv-fetchxml">
          <div class="panel">
            <h2>FetchXML</h2>
            <div class="entity-context" id="fetch-entity-context">
              <span class="entity-context-empty">No entity selected \u2014 pick one in Explorer or fill in the fields below</span>
            </div>
            <form id="fetchxml-form">
              <div class="field">
                <span class="field-label">FetchXML</span>
                <div class="fetchxml-editor-shell">
                  <div class="fetchxml-editor-toolbar">
                    <div class="fetchxml-editor-toolbar-left">
                      <span id="fetch-editor-status"><span class="fetchxml-status-dot"></span>IntelliSense ready</span>
                      <span id="fetch-vim-mode" class="monaco-vim-toggle">Vim Off</span>
                    </div>
                    <div class="fetchxml-editor-toolbar-right">
                      <span>Autocomplete for FetchXML structure, entities, attributes, operators, and join fields.</span>
                    </div>
                  </div>
                  <div id="fetch-editor" class="fetchxml-editor-mount"></div>
                </div>
                <textarea name="rawXml" id="fetch-raw" class="xml-editor" hidden placeholder='<fetch top="50">&#10;  <entity name="account">&#10;    <attribute name="name" />&#10;    <filter>&#10;      <condition attribute="statecode" operator="eq" value="0" />&#10;    </filter>&#10;  </entity>&#10;</fetch>'></textarea>
                <div id="fetch-diagnostics" class="fetchxml-diagnostics"></div>
              </div>
              <div class="btn-group">
                <button class="btn btn-primary" id="fetch-run-btn" type="button">Run FetchXML</button>
                <button class="btn btn-secondary" id="fetch-preview-btn" type="button">Build from fields below</button>
              </div>
              <details style="margin-top:4px" id="fetch-builder">
                <summary style="cursor:pointer;font-size:0.8125rem;font-weight:500;color:var(--muted)">Form builder</summary>
                <div style="display:grid;gap:14px;margin-top:14px">
                  <div class="form-row">
                    <div class="field">
                      <span class="field-label">Entity</span>
                      <select name="entity" id="fetch-entity"><option value="">select entity\u2026</option></select>
                    </div>
                    <div class="field">
                      <span class="field-label">Entity Set Name</span>
                      <input name="entitySetName" id="fetch-entity-set" placeholder="accounts" readonly tabindex="-1" style="color:var(--muted)">
                    </div>
                  </div>
                  <div class="field">
                    <span class="field-label">Attributes</span>
                    <div id="fetch-attr-picker" class="attr-picker"></div>
                    <input name="attributesCsv" id="fetch-attrs" type="hidden">
                  </div>
                  <div class="form-row three">
                    <div class="field"><span class="field-label">Top</span><input name="top" type="number" min="1" step="1" value="50"></div>
                    <div class="field"><span class="field-label">Distinct</span><select name="distinct" id="fetch-distinct"><option value="false">false</option><option value="true">true</option></select></div>
                    <div class="field"><span class="field-label">Filter Type</span><select id="fetch-filter-type"><option value="and">and</option><option value="or">or</option></select></div>
                  </div>
                  <div class="field">
                    <span class="field-label">Conditions</span>
                    <div id="fetch-conditions" class="condition-list"></div>
                    <button type="button" class="btn btn-ghost" id="fetch-add-condition" style="margin-top:6px;padding:4px 10px;font-size:0.75rem">+ Add condition</button>
                  </div>
                  <div class="form-row">
                    <div class="field">
                      <span class="field-label">Order By</span>
                      <select id="order-attribute"><option value="">none</option></select>
                    </div>
                    <div class="field">
                      <span class="field-label">Direction</span>
                      <select id="order-desc"><option value="false">ascending</option><option value="true">descending</option></select>
                    </div>
                  </div>
                  <div class="field">
                    <span class="field-label">Link Entities (Joins)</span>
                    <div id="fetch-links" class="link-list"></div>
                    <button type="button" class="btn btn-ghost" id="fetch-add-link" style="margin-top:6px;padding:4px 10px;font-size:0.75rem">+ Add join</button>
                  </div>
                </div>
              </details>
            </form>
          </div>
          <div class="panel">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <h2>FetchXML Result</h2>
              <div class="result-toggle" id="fetch-result-toggle">
                <button class="result-toggle-btn active" data-view="table">Table</button>
                <button class="result-toggle-btn" data-view="json">JSON</button>
              </div>
            </div>
            <div id="fetch-result-table"></div>
            <pre class="viewer" id="fetch-result" style="display:none">Run FetchXML to see the response.</pre>
          </div>
        </div>

        <!-- Relationships sub-panel -->
        <div class="dv-subpanel" id="dv-subpanel-dv-relationships">
          <div class="panel" style="padding:14px">
            <div class="rel-toolbar">
              <select id="rel-entity" style="max-width:240px"></select>
              <div class="rel-toolbar-group">
                <label class="rel-toolbar-label">Depth</label>
                <select id="rel-depth" style="width:60px">
                  <option value="1">1</option>
                  <option value="2" selected>2</option>
                  <option value="3">3</option>
                </select>
              </div>
              <label class="rel-toolbar-check"><input type="checkbox" id="rel-hide-system" checked> Hide system</label>
              <button class="btn btn-primary" id="rel-load" style="padding:5px 14px;font-size:0.75rem">Load Graph</button>
              <span id="rel-status" style="font-size:0.6875rem;color:var(--muted);margin-left:auto"></span>
            </div>
            <div class="rel-canvas-container" id="rel-container">
              <svg id="rel-svg" class="rel-svg" xmlns="http://www.w3.org/2000/svg"></svg>
              <div id="rel-tooltip" class="rel-tooltip hidden"></div>
              <div class="rel-hint">Select an entity and click Load Graph. Click a node to expand or explore. Drag to rearrange. Scroll to zoom.</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== Automate Workspace ===== -->
    <div class="tab-panel" id="panel-automate">
      <div class="inventory-sidebar">
        <div class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h2>Flows</h2>
            <button class="btn btn-ghost" id="flow-refresh" type="button" style="font-size:0.75rem;padding:4px 10px">Refresh</button>
          </div>
          <input type="text" id="flow-filter" class="entity-filter" placeholder="Filter flows\u2026">
          <div id="flow-count" class="entity-count"></div>
          <div id="flow-list" class="entity-list">
            <div class="entity-loading">Select an environment to load flows.</div>
          </div>
        </div>
      </div>
      <div class="detail-area">
        <div class="panel">
          <div id="flow-detail-empty">
            <h2>Flow Detail</h2>
            <p class="desc">Select a flow from the list to inspect its properties and recent runs.</p>
            <div class="empty">No flow selected.</div>
          </div>
          <div id="flow-detail" class="hidden">
            <div class="flow-header">
              <div class="flow-header-info">
                <div class="flow-header-title" id="flow-title"></div>
                <div class="flow-header-sub" id="flow-subtitle"></div>
                <div id="flow-state-badge-container"></div>
              </div>
              <div class="flow-header-actions">
                <button class="btn btn-ghost" id="flow-open-console" type="button" style="font-size:0.75rem">Open in Console</button>
              </div>
            </div>
            <div id="flow-metrics" class="metrics"></div>
          </div>
        </div>
        <div class="panel" id="flow-language-panel" style="display:none">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
            <div>
              <h2>Definition Lab</h2>
              <p class="desc" style="margin-bottom:0">Inspect the selected flow definition with shared validation, graph diagnostics, and expression-aware completions.</p>
            </div>
            <div class="btn-group">
              <span id="flow-language-status" style="font-size:0.75rem;color:var(--muted)"><span class="fetchxml-status-dot warn"></span>Definition not loaded</span>
              <button class="btn btn-secondary" id="flow-language-load" type="button">Load definition</button>
              <button class="btn btn-primary" id="flow-language-analyze" type="button">Analyze</button>
            </div>
          </div>
          <div class="fetchxml-editor-shell">
            <div class="fetchxml-editor-toolbar">
              <div class="fetchxml-editor-toolbar-left">
                <span>Workflow definition JSON</span>
              </div>
              <div class="fetchxml-editor-toolbar-right">
                <span id="flow-language-summary-text">No analysis yet</span>
              </div>
            </div>
            <div id="flow-language-editor" class="fetchxml-editor-mount"></div>
          </div>
          <div style="margin-top:14px">
            <div id="flow-language-summary" class="flow-summary-grid" style="margin-bottom:12px"></div>
            <div id="flow-language-diagnostics" class="fetchxml-diagnostics"></div>
          </div>
        </div>
        <div class="panel" id="flow-outline-panel" style="display:none">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h2>Flow Outline</h2>
            <div class="btn-group">
              <button class="btn btn-ghost flow-outline-zoom-btn" id="flow-outline-zoom-fit" type="button" style="font-size:0.6875rem;padding:3px 8px">Fit</button>
              <button class="btn btn-ghost flow-outline-zoom-btn" id="flow-outline-zoom-in" type="button" style="font-size:0.6875rem;padding:3px 8px">+</button>
              <button class="btn btn-ghost flow-outline-zoom-btn" id="flow-outline-zoom-out" type="button" style="font-size:0.6875rem;padding:3px 8px">\u2212</button>
            </div>
          </div>
          <div class="flow-canvas-container" id="flow-canvas-container">
            <canvas id="flow-outline-canvas" class="flow-outline-canvas"></canvas>
            <div id="flow-language-outline" class="hidden"></div>
          </div>
        </div>
        <div class="panel" id="flow-runs-panel" style="display:none">
          <h2 style="margin-bottom:12px">Runs</h2>
          <div class="run-toolbar">
            <input type="text" id="flow-run-filter" placeholder="Filter runs by status or trigger…">
            <select id="flow-run-status-filter">
              <option value="">All statuses</option>
              <option value="Failed">Failed</option>
              <option value="Running">Running</option>
              <option value="Succeeded">Succeeded</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
          <div id="flow-runs" class="card-list">
            <div class="empty">Select a flow to see runs.</div>
          </div>
        </div>
        <div class="panel" id="flow-actions-panel" style="display:none">
          <div id="flow-actions-breadcrumb" class="flow-breadcrumb"></div>
          <div id="flow-run-summary" style="margin-bottom:14px"></div>
          <div class="action-toolbar">
            <input type="text" id="flow-action-filter" placeholder="Filter actions by name, type, or code…">
            <select id="flow-action-status-filter">
              <option value="">All statuses</option>
              <option value="Failed">Failed</option>
              <option value="Running">Running</option>
              <option value="Succeeded">Succeeded</option>
              <option value="Skipped">Skipped</option>
            </select>
          </div>
          <div id="flow-actions" class="card-list"></div>
        </div>
        <div class="panel" id="flow-action-detail-panel" style="display:none">
          <div id="flow-action-breadcrumb" class="flow-breadcrumb"></div>
          <h2 id="flow-action-title" style="margin-bottom:12px">Action Detail</h2>
          <div id="flow-action-metrics" class="metrics" style="margin-bottom:12px"></div>
          <div id="flow-action-io"></div>
        </div>
      </div>
    </div>

    <!-- ===== Apps Workspace ===== -->
    <div class="tab-panel" id="panel-apps">
      <div class="inventory-sidebar">
        <div class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h2>Apps</h2>
            <button class="btn btn-ghost" id="app-refresh" type="button" style="font-size:0.75rem;padding:4px 10px">Refresh</button>
          </div>
          <input type="text" id="app-filter" class="entity-filter" placeholder="Filter apps\u2026">
          <div id="app-count" class="entity-count"></div>
          <div id="app-list" class="entity-list">
            <div class="entity-loading">Select an environment to load apps.</div>
          </div>
        </div>
      </div>
      <div class="detail-area">
        <div class="panel">
          <div id="app-detail-empty">
            <h2>App Detail</h2>
            <p class="desc">Select an app from the list to inspect its metadata and connections.</p>
            <div class="empty">No app selected.</div>
          </div>
          <div id="app-detail" class="hidden">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <div>
                <h2 id="app-title"></h2>
                <p class="desc" id="app-subtitle" style="margin-bottom:0"></p>
              </div>
              <button class="btn btn-ghost" id="app-open-console" type="button" style="font-size:0.75rem">Open in Console</button>
            </div>
            <div id="app-metrics" class="metrics"></div>
            <div id="app-connections"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== Platform Workspace ===== -->
    <div class="tab-panel" id="panel-platform">
      <div class="inventory-sidebar">
        <div class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h2>Environments</h2>
            <button class="btn btn-ghost" id="plat-env-refresh" type="button" style="font-size:0.75rem;padding:4px 10px">Refresh</button>
          </div>
          <input type="text" id="plat-env-filter" class="entity-filter" placeholder="Filter environments\u2026">
          <div id="plat-env-count" class="entity-count"></div>
          <div id="plat-env-list" class="entity-list">
            <div class="entity-loading">Select an environment to discover platform environments.</div>
          </div>
        </div>
      </div>
      <div class="detail-area">
        <div class="panel">
          <div id="plat-env-detail-empty">
            <h2>Environment Detail</h2>
            <p class="desc">Select an environment from the list to inspect its platform metadata.</p>
            <div class="empty">No environment selected.</div>
          </div>
          <div id="plat-env-detail" class="hidden">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <div>
                <h2 id="plat-env-title"></h2>
                <p class="desc" id="plat-env-subtitle" style="margin-bottom:0"></p>
              </div>
              <button class="btn btn-ghost" id="plat-env-open-console" type="button" style="font-size:0.75rem">Open in Console</button>
            </div>
            <div id="plat-env-metrics" class="metrics"></div>
            <div id="plat-env-linked"></div>
          </div>
        </div>
      </div>
    </div>

  </div>
  </div>

  <script>window.ppApp=${JSON.stringify(boot)};</script>
  <script type="module" src="${escapeAttribute(scriptSrc)}"></script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}
