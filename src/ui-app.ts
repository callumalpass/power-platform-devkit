export function renderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>pp</title>
  <style>
    :root {
      --bg: #f9fafb;
      --surface: #ffffff;
      --ink: #111111;
      --muted: #6b7280;
      --border: #e5e7eb;
      --accent: #2563eb;
      --accent-hover: #1d4ed8;
      --accent-soft: #eff6ff;
      --danger: #dc2626;
      --ok: #16a34a;
      --ok-soft: #f0fdf4;
      --warn-soft: #fef2f2;
      --radius: 12px;
      --radius-sm: 8px;
      --mono: "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0a0a0b;
        --surface: #141416;
        --ink: #e4e4e7;
        --muted: #71717a;
        --border: #27272a;
        --accent: #3b82f6;
        --accent-hover: #60a5fa;
        --accent-soft: rgba(59,130,246,0.12);
        --danger: #ef4444;
        --ok: #22c55e;
        --ok-soft: rgba(34,197,94,0.1);
        --warn-soft: rgba(239,68,68,0.1);
      }
    }
    * { box-sizing: border-box; margin: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: var(--ink);
      background: var(--bg);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    button, input, select, textarea { font: inherit; }

    /* Toast */
    .toast-container { position: fixed; top: 16px; right: 16px; z-index: 100; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
    .toast { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 16px; font-size: 0.8125rem; box-shadow: 0 4px 12px rgba(0,0,0,0.1); pointer-events: auto; animation: toast-in 200ms ease; }
    .toast.error { border-left: 3px solid var(--danger); color: var(--danger); }
    .toast.ok { border-left: 3px solid var(--ok); }
    .toast.fade-out { animation: toast-out 200ms ease forwards; }
    @keyframes toast-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; } }
    @keyframes toast-out { to { opacity: 0; transform: translateX(20px); } }

    /* Header */
    .header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 20px; position: sticky; top: 0; z-index: 10; }
    .header-inner { max-width: 1400px; margin: 0 auto; display: flex; align-items: center; height: 52px; gap: 20px; }
    .logo { font-size: 1rem; font-weight: 700; letter-spacing: -0.02em; flex-shrink: 0; }
    .header-env { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
    .header-env label { font-size: 0.75rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0; }
    .header-env select { max-width: 280px; }
    .header-meta { display: flex; gap: 12px; align-items: center; font-size: 0.75rem; color: var(--muted); flex-shrink: 0; }

    /* Tabs */
    .tabs { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 20px; }
    .tabs-inner { max-width: 1400px; margin: 0 auto; display: flex; gap: 0; }
    .tab { padding: 10px 18px; font-size: 0.8125rem; font-weight: 500; color: var(--muted); cursor: pointer; border: none; background: none; border-bottom: 2px solid transparent; transition: color 150ms; white-space: nowrap; }
    .tab:hover { color: var(--ink); }
    .tab.active { color: var(--ink); border-bottom-color: var(--accent); }

    /* Layout */
    .main { max-width: 1400px; margin: 0 auto; padding: 20px; }
    .tab-panel { display: none; }
    .tab-panel.active { display: flex; gap: 20px; }
    .tab-panel.active.stack { flex-direction: column; }

    /* Panels */
    .panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
    .panel h2 { font-size: 0.9375rem; font-weight: 600; margin-bottom: 4px; }
    .panel .desc { font-size: 0.8125rem; color: var(--muted); margin-bottom: 16px; line-height: 1.5; }

    /* Entity sidebar */
    .entity-sidebar { width: 320px; flex-shrink: 0; display: flex; flex-direction: column; gap: 0; }
    .entity-sidebar .panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .entity-filter { margin-bottom: 12px; }
    .entity-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; max-height: calc(100vh - 220px); }
    .entity-item { padding: 10px 12px; border-radius: var(--radius-sm); cursor: pointer; transition: background 100ms; border: 1px solid transparent; }
    .entity-item:hover { background: var(--bg); }
    .entity-item.active { background: var(--accent-soft); border-color: var(--accent); }
    .entity-item-name { font-size: 0.8125rem; font-weight: 600; }
    .entity-item-logical { font-family: var(--mono); font-size: 0.6875rem; color: var(--muted); }
    .entity-item-set { font-family: var(--mono); font-size: 0.6875rem; color: var(--accent); }
    .entity-count { font-size: 0.75rem; color: var(--muted); margin-bottom: 8px; }
    .entity-loading { text-align: center; padding: 40px 16px; color: var(--muted); font-size: 0.8125rem; }

    /* Detail area */
    .detail-area { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 20px; }

    /* Metric row */
    .metrics { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .metric { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 14px; background: var(--bg); min-width: 140px; }
    .metric-label { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 600; margin-bottom: 2px; }
    .metric-value { font-family: var(--mono); font-size: 0.8125rem; word-break: break-all; }

    /* Table */
    .table-wrap { overflow: auto; max-height: 500px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
    th { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 600; position: sticky; top: 0; background: var(--surface); }
    td code { font-family: var(--mono); font-size: 0.75rem; }

    /* Buttons */
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; font-size: 0.8125rem; font-weight: 500; border: 1px solid transparent; border-radius: var(--radius-sm); cursor: pointer; transition: background 120ms; white-space: nowrap; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: var(--accent); color: white; }
    .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
    .btn-secondary { background: var(--surface); color: var(--ink); border-color: var(--border); }
    .btn-secondary:hover:not(:disabled) { background: var(--bg); }
    .btn-danger { background: none; color: var(--danger); font-size: 0.75rem; padding: 4px 10px; }
    .btn-danger:hover:not(:disabled) { background: var(--warn-soft); }
    .btn-ghost { background: none; color: var(--accent); }
    .btn-ghost:hover:not(:disabled) { background: var(--accent-soft); }
    .btn-group { display: flex; gap: 8px; flex-wrap: wrap; }
    .spinner { width: 14px; height: 14px; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: spin 600ms linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Forms */
    form { display: grid; gap: 14px; }
    .form-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    .form-row.three { grid-template-columns: repeat(3, 1fr); }
    .field { display: grid; gap: 4px; }
    .field-label { font-size: 0.75rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
    input, select, textarea { width: 100%; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 0.8125rem; background: var(--surface); color: var(--ink); transition: border-color 150ms; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
    textarea { font-family: var(--mono); font-size: 0.8125rem; line-height: 1.5; resize: vertical; }
    textarea.xml-editor { min-height: 300px; }
    .check-row { display: flex; align-items: center; gap: 8px; font-size: 0.8125rem; color: var(--muted); }
    .check-row input[type="checkbox"] { width: 16px; height: 16px; min-width: 16px; padding: 0; margin: 0; border-radius: 4px; accent-color: var(--accent); cursor: pointer; }
    .conditional { display: none; }
    .conditional.visible { display: grid; }
    .check-row.conditional.visible { display: flex; }

    /* Viewer */
    pre.viewer { margin: 0; padding: 14px; border-radius: var(--radius-sm); background: #1e1e2e; color: #cdd6f4; font-family: var(--mono); font-size: 0.8125rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word; min-height: 120px; overflow: auto; }

    /* Empty state */
    .empty { text-align: center; padding: 40px 16px; color: var(--muted); font-size: 0.8125rem; }

    /* Card list (setup) */
    .card-list { display: grid; gap: 8px; }
    .card-item { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .card-item-info { min-width: 0; }
    .card-item-title { font-size: 0.8125rem; font-weight: 600; }
    .card-item-sub { font-family: var(--mono); font-size: 0.6875rem; color: var(--muted); word-break: break-all; }
    .badge { font-size: 0.6875rem; font-weight: 500; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }

    /* Setup grid */
    .setup-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

    /* Hidden */
    .hidden { display: none !important; }

    @media (max-width: 900px) {
      .tab-panel.active { flex-direction: column; }
      .entity-sidebar { width: 100%; }
      .entity-list { max-height: 300px; }
      .setup-grid, .form-row, .form-row.three { grid-template-columns: 1fr; }
      .header-meta { display: none; }
    }
  </style>
</head>
<body>
  <div class="toast-container" id="toasts"></div>
  <header class="header">
    <div class="header-inner">
      <span class="logo">pp</span>
      <div class="header-env">
        <label>ENV</label>
        <select id="global-environment" style="flex:1"></select>
      </div>
      <div class="header-meta" id="meta"></div>
    </div>
  </header>
  <nav class="tabs">
    <div class="tabs-inner">
      <button class="tab active" data-tab="explorer">Explorer</button>
      <button class="tab" data-tab="query">Query</button>
      <button class="tab" data-tab="fetchxml">FetchXML</button>
      <button class="tab" data-tab="setup">Setup</button>
    </div>
  </nav>
  <div class="main">

    <!-- Explorer Tab -->
    <div class="tab-panel active" id="panel-explorer">
      <div class="entity-sidebar">
        <div class="panel">
          <h2>Entities</h2>
          <input type="text" id="entity-filter" class="entity-filter" placeholder="Filter entities\u2026">
          <div id="entity-count" class="entity-count"></div>
          <div id="entity-list" class="entity-list">
            <div class="entity-loading" id="entity-loading">Select an environment to load entities.</div>
          </div>
        </div>
      </div>
      <div class="detail-area">
        <div class="panel" id="entity-detail-panel">
          <h2 id="entity-title">Entity Detail</h2>
          <p class="desc" id="entity-subtitle">Select an entity from the list to inspect its metadata.</p>
          <div id="entity-detail-empty" class="empty">No entity selected.</div>
          <div id="entity-detail" class="hidden">
            <div id="entity-metrics" class="metrics"></div>
            <div class="btn-group" style="margin-bottom:14px">
              <button class="btn btn-secondary" id="entity-to-query" type="button">Use in Query</button>
              <button class="btn btn-secondary" id="entity-to-fetchxml" type="button">Use in FetchXML</button>
              <button class="btn btn-ghost" id="entity-refresh-records" type="button">Refresh Records</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Column</th><th>Type</th><th>Required</th><th>Flags</th><th>Targets / Options</th></tr></thead>
                <tbody id="attribute-table"></tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="panel">
          <h2>Record Preview</h2>
          <p class="desc" id="record-preview-desc">Select an entity to preview sample records.</p>
          <div id="record-preview-empty" class="empty">No entity selected.</div>
          <div id="record-preview" class="hidden">
            <div id="record-preview-path" style="font-family:var(--mono);font-size:0.75rem;color:var(--muted);margin-bottom:8px"></div>
            <pre class="viewer" id="record-preview-json"></pre>
          </div>
        </div>
      </div>
    </div>

    <!-- Query Tab -->
    <div class="tab-panel" id="panel-query">
      <div class="entity-sidebar" id="query-entity-sidebar">
        <div class="panel">
          <h2>Entities</h2>
          <input type="text" id="query-entity-filter" class="entity-filter" placeholder="Filter entities\u2026">
          <div id="query-entity-list" class="entity-list"></div>
        </div>
      </div>
      <div class="detail-area">
        <div class="panel">
          <h2>Web API Query</h2>
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
          <h2>Query Result</h2>
          <pre class="viewer" id="query-result">Run a query to see the response.</pre>
        </div>
      </div>
    </div>

    <!-- FetchXML Tab -->
    <div class="tab-panel" id="panel-fetchxml">
      <div class="entity-sidebar" id="fetch-entity-sidebar">
        <div class="panel">
          <h2>Entities</h2>
          <input type="text" id="fetch-entity-filter" class="entity-filter" placeholder="Filter entities\u2026">
          <div id="fetch-entity-list" class="entity-list"></div>
        </div>
      </div>
      <div class="detail-area">
        <div class="panel">
          <h2>FetchXML</h2>
          <form id="fetchxml-form">
            <div class="form-row">
              <div class="field">
                <span class="field-label">Entity Logical Name</span>
                <input name="entity" id="fetch-entity" placeholder="account">
              </div>
              <div class="field">
                <span class="field-label">Entity Set Name</span>
                <input name="entitySetName" id="fetch-entity-set" placeholder="accounts">
              </div>
            </div>
            <div class="form-row three">
              <div class="field">
                <span class="field-label">Attributes (CSV)</span>
                <input name="attributesCsv" id="fetch-attrs" placeholder="accountid,name">
              </div>
              <div class="field">
                <span class="field-label">Top</span>
                <input name="top" type="number" min="1" step="1" value="10">
              </div>
              <div class="field">
                <span class="field-label">Distinct</span>
                <select name="distinct" id="fetch-distinct"><option value="false">false</option><option value="true">true</option></select>
              </div>
            </div>
            <div class="form-row three">
              <div class="field"><span class="field-label">Condition Attr</span><input id="cond1-attribute" placeholder="name"></div>
              <div class="field"><span class="field-label">Operator</span><input id="cond1-operator" placeholder="like"></div>
              <div class="field"><span class="field-label">Value</span><input id="cond1-value" placeholder="%Contoso%"></div>
            </div>
            <div class="form-row three">
              <div class="field"><span class="field-label">Condition 2 Attr</span><input id="cond2-attribute" placeholder="statecode"></div>
              <div class="field"><span class="field-label">Operator</span><input id="cond2-operator" placeholder="eq"></div>
              <div class="field"><span class="field-label">Value</span><input id="cond2-value" placeholder="0"></div>
            </div>
            <div class="form-row">
              <div class="field"><span class="field-label">Order Attribute</span><input id="order-attribute" placeholder="name"></div>
              <div class="field"><span class="field-label">Descending</span><select id="order-desc"><option value="false">false</option><option value="true">true</option></select></div>
            </div>
            <div class="field">
              <span class="field-label">Raw XML (overrides form fields above)</span>
              <textarea name="rawXml" id="fetch-raw" class="xml-editor" placeholder='<fetch top="50">\\n  <entity name="account">\\n    <attribute name="name" />\\n  </entity>\\n</fetch>'></textarea>
            </div>
            <div class="btn-group">
              <button class="btn btn-secondary" id="fetch-preview-btn" type="button">Build XML</button>
              <button class="btn btn-primary" id="fetch-run-btn" type="button">Run FetchXML</button>
            </div>
          </form>
        </div>
        <div class="panel">
          <h2>Generated XML</h2>
          <pre class="viewer" id="fetch-preview">Build FetchXML here.</pre>
        </div>
        <div class="panel">
          <h2>FetchXML Result</h2>
          <pre class="viewer" id="fetch-result">Run FetchXML to see the response.</pre>
        </div>
      </div>
    </div>

    <!-- Setup Tab -->
    <div class="tab-panel stack" id="panel-setup">
      <div class="setup-grid">
        <div class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2>Accounts</h2>
            <button class="btn btn-secondary" id="refresh-state" type="button">Refresh</button>
          </div>
          <div class="card-list" id="accounts-list"></div>
        </div>
        <div class="panel">
          <h2>Environments</h2>
          <p class="desc">Configured environments.</p>
          <div class="card-list" id="environments-list"></div>
        </div>
      </div>
      <div class="setup-grid">
        <div class="panel">
          <h2>Add Account</h2>
          <p class="desc">Interactive logins run as background jobs.</p>
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
              <div class="field"><span class="field-label">Tenant ID</span><input name="tenantId"></div>
              <div class="field"><span class="field-label">Client ID</span><input name="clientId"></div>
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
            <div class="btn-group">
              <button type="submit" class="btn btn-primary" id="account-submit">Save & Login</button>
              <button type="button" class="btn btn-danger hidden" id="account-cancel">Cancel Pending Login</button>
            </div>
          </form>
        </div>
        <div class="panel">
          <h2>Add Environment</h2>
          <p class="desc">Discover from account or add manually.</p>
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
      </div>
    </div>
  </div>

  <script type="module" src="/assets/ui/app.js"></script>
</body>
</html>`;
}
