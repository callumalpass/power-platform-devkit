export function renderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>pp workbench</title>
  <style>
    :root {
      --bg: #f3f0ea;
      --surface: rgba(255, 252, 248, 0.94);
      --surface-strong: #fffdf9;
      --ink: #1e1c18;
      --muted: #6b655c;
      --line: rgba(102, 87, 63, 0.16);
      --line-strong: rgba(102, 87, 63, 0.28);
      --accent: #005c53;
      --accent-soft: rgba(0, 92, 83, 0.09);
      --danger: #b42318;
      --shadow: 0 18px 50px rgba(32, 24, 12, 0.08);
      --radius: 18px;
      --radius-sm: 12px;
      --mono: "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace;
      --sans: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif;
      --ui: "Segoe UI", "Inter", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--ui);
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(164, 70, 31, 0.08), transparent 28%),
        radial-gradient(circle at top right, rgba(0, 92, 83, 0.08), transparent 30%),
        linear-gradient(180deg, #f8f5ef 0%, var(--bg) 100%);
      min-height: 100vh;
    }
    button, input, select, textarea { font: inherit; }
    .page { max-width: 1480px; margin: 0 auto; padding: 24px; }
    .hero {
      padding: 24px 28px;
      border: 1px solid var(--line);
      border-radius: 28px;
      background:
        linear-gradient(135deg, rgba(255,255,255,0.85), rgba(255,248,240,0.94)),
        linear-gradient(135deg, rgba(0,92,83,0.05), rgba(164,70,31,0.05));
      box-shadow: var(--shadow);
      margin-bottom: 20px;
    }
    .hero-top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
    .brand { font-family: var(--sans); font-size: 2rem; font-weight: 700; letter-spacing: -0.03em; margin: 0; }
    .subtitle { margin: 8px 0 0; max-width: 760px; color: var(--muted); line-height: 1.5; font-size: 0.97rem; }
    .meta { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.72);
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 0.82rem;
      color: var(--muted);
    }
    .chip code { font-family: var(--mono); color: var(--ink); font-size: 0.77rem; }
    .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
    .tab {
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.74);
      border-radius: 999px;
      padding: 10px 16px;
      cursor: pointer;
      color: var(--muted);
      font-weight: 600;
      transition: 120ms ease;
    }
    .tab.active { background: var(--accent); color: white; border-color: var(--accent); }
    .panel { display: none; }
    .panel.active { display: block; }
    .grid { display: grid; gap: 18px; }
    .grid.two { grid-template-columns: 360px minmax(0, 1fr); }
    .grid.split { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .card {
      background: var(--surface);
      backdrop-filter: blur(12px);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 20px;
    }
    .card h2, .card h3 { margin: 0 0 6px; font-size: 1.05rem; }
    .card h2 { font-family: var(--sans); font-size: 1.25rem; }
    .desc { margin: 0 0 16px; color: var(--muted); line-height: 1.5; font-size: 0.9rem; }
    .toolbar, .btn-row, .inline-fields { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .toolbar { margin-bottom: 14px; }
    .field-grid { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .field-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .field { display: grid; gap: 6px; min-width: 0; }
    .field label {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      font-weight: 700;
    }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface-strong);
      color: var(--ink);
      padding: 10px 12px;
    }
    textarea { min-height: 120px; resize: vertical; font-family: var(--mono); font-size: 0.83rem; line-height: 1.5; }
    .btn { border: 1px solid transparent; border-radius: 999px; padding: 10px 16px; cursor: pointer; font-weight: 700; transition: 120ms ease; }
    .btn.primary { background: var(--accent); color: white; }
    .btn.secondary { background: rgba(255,255,255,0.74); border-color: var(--line); color: var(--ink); }
    .btn.ghost { background: transparent; color: var(--accent); border-color: var(--line); }
    .btn.danger { background: transparent; color: var(--danger); border-color: rgba(180,35,24,0.18); }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .list { display: grid; gap: 10px; max-height: 720px; overflow: auto; padding-right: 4px; }
    .item { border: 1px solid var(--line); border-radius: 14px; background: rgba(255,255,255,0.68); padding: 14px; cursor: pointer; transition: 120ms ease; }
    .item.active { border-color: var(--accent); background: var(--accent-soft); }
    .item-title { font-weight: 700; font-size: 0.92rem; margin-bottom: 4px; }
    .item-subtle, .mono-subtle { color: var(--muted); font-size: 0.79rem; font-family: var(--mono); word-break: break-word; }
    .pill-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    .pill { border-radius: 999px; background: rgba(0,92,83,0.08); color: var(--accent); padding: 5px 10px; font-size: 0.73rem; font-weight: 700; }
    .metric-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-bottom: 16px; }
    .metric { border: 1px solid var(--line); border-radius: 14px; padding: 12px; background: rgba(255,255,255,0.65); }
    .metric .label { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700; margin-bottom: 4px; }
    .metric .value { font-family: var(--mono); font-size: 0.82rem; word-break: break-word; }
    table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
    th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--line); }
    th { color: var(--muted); font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700; }
    td code, pre { font-family: var(--mono); font-size: 0.81rem; white-space: pre-wrap; word-break: break-word; }
    pre.viewer {
      margin: 0;
      padding: 16px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: #211d18;
      color: #f7f1e9;
      min-height: 180px;
      overflow: auto;
    }
    .empty { border: 1px dashed var(--line-strong); border-radius: 16px; padding: 24px; text-align: center; color: var(--muted); background: rgba(255,255,255,0.45); }
    .toast-wrap { position: fixed; top: 18px; right: 18px; display: grid; gap: 10px; z-index: 1000; }
    .toast { border-radius: 12px; border: 1px solid var(--line); background: var(--surface-strong); padding: 10px 14px; box-shadow: var(--shadow); font-size: 0.85rem; }
    .toast.error { border-color: rgba(180,35,24,0.22); color: var(--danger); }
    .result-dock { margin-top: 18px; }
    @media (max-width: 1120px) {
      .grid.two, .grid.split, .field-grid, .field-grid.three { grid-template-columns: 1fr; }
      .page { padding: 14px; }
    }
  </style>
</head>
<body>
  <div class="toast-wrap" id="toasts"></div>
  <div class="page">
    <section class="hero">
      <div class="hero-top">
        <div>
          <h1 class="brand">pp workbench</h1>
          <p class="subtitle">Dataverse-first exploration, metadata inspection, record preview, Web API query construction, and FetchXML authoring. The server-side model is adapter-friendly so Graph, Flow, and the rest can slot in next.</p>
        </div>
        <div class="meta" id="meta"></div>
      </div>
    </section>

    <nav class="tabs">
      <button class="tab active" data-tab="setup">Setup</button>
      <button class="tab" data-tab="explorer">Explorer</button>
      <button class="tab" data-tab="query">Query Lab</button>
      <button class="tab" data-tab="fetchxml">FetchXML</button>
    </nav>

    <section class="panel active" id="panel-setup">
      <div class="grid split">
        <div class="card">
          <div class="toolbar">
            <div>
              <h2>Accounts</h2>
              <p class="desc">Configured authentication accounts.</p>
            </div>
            <button class="btn secondary" id="refresh-state" type="button">Refresh</button>
          </div>
          <div id="accounts-list" class="list"></div>
        </div>
        <div class="card">
          <h2>Environments</h2>
          <p class="desc">Configured environments drive the Dataverse workbench.</p>
          <div id="environments-list" class="list"></div>
        </div>
      </div>

      <div class="grid split" style="margin-top:18px">
        <div class="card">
          <h2>Add Account</h2>
          <p class="desc">Interactive logins run as background jobs so the browser stays responsive.</p>
          <form id="account-form" class="grid">
            <div class="field-grid">
              <div class="field"><label>Name</label><input name="name" required></div>
              <div class="field">
                <label>Kind</label>
                <select name="kind" id="account-kind">
                  <option value="user">user</option>
                  <option value="device-code">device-code</option>
                  <option value="client-secret">client-secret</option>
                  <option value="environment-token">environment-token</option>
                  <option value="static-token">static-token</option>
                </select>
              </div>
            </div>
            <div class="field-grid">
              <div class="field"><label>Description</label><input name="description"></div>
              <div class="field account-user account-device-code"><label>Preferred Flow</label><select name="preferredFlow"><option value="interactive">interactive</option><option value="device-code">device-code</option></select></div>
            </div>
            <div class="field-grid account-user account-device-code account-client-secret">
              <div class="field"><label>Tenant ID</label><input name="tenantId"></div>
              <div class="field"><label>Client ID</label><input name="clientId"></div>
            </div>
            <div class="field-grid account-user account-device-code">
              <div class="field"><label>Login Hint</label><input name="loginHint"></div>
              <div class="field"><label>Prompt</label><select name="prompt"><option value="">default</option><option value="select_account">select_account</option><option value="login">login</option><option value="consent">consent</option><option value="none">none</option></select></div>
            </div>
            <div class="field account-client-secret"><label>Client Secret Env Var</label><input name="clientSecretEnv"></div>
            <div class="field account-environment-token"><label>Token Environment Variable</label><input name="environmentVariable"></div>
            <div class="field account-static-token"><label>Static Token</label><textarea name="token"></textarea></div>
            <div class="inline-fields account-user account-device-code"><label><input type="checkbox" name="forcePrompt"> Force prompt</label></div>
            <div class="inline-fields account-user"><label><input type="checkbox" name="fallbackToDeviceCode"> Allow fallback to device code</label></div>
            <div class="btn-row">
              <button class="btn primary" id="account-submit" type="submit">Save & Login</button>
              <button class="btn danger" id="account-cancel" type="button" hidden>Cancel Pending Login</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h2>Add Environment</h2>
          <p class="desc">Use a configured Dataverse environment or discover one from an account.</p>
          <form id="discover-form" class="grid" style="margin-bottom:18px">
            <div class="field-grid">
              <div class="field"><label>Account</label><select name="account" id="discover-account"></select></div>
              <div class="field" style="align-self:end"><button class="btn secondary" id="discover-submit" type="submit">Discover</button></div>
            </div>
          </form>
          <div id="discovered-list" class="list" style="margin-bottom:18px"></div>
          <form id="environment-form" class="grid">
            <div class="field-grid">
              <div class="field"><label>Alias</label><input name="alias" required></div>
              <div class="field"><label>Account</label><select name="account" id="environment-account"></select></div>
            </div>
            <div class="field-grid">
              <div class="field"><label>URL</label><input name="url" required></div>
              <div class="field"><label>Display Name</label><input name="displayName"></div>
            </div>
            <div class="field"><label>Access</label><select name="accessMode"><option value="">read-write (default)</option><option value="read-write">read-write</option><option value="read-only">read-only</option></select></div>
            <div class="btn-row"><button class="btn primary" id="environment-submit" type="submit">Discover & Save</button></div>
          </form>
        </div>
      </div>
    </section>

    <section class="panel" id="panel-explorer">
      <div class="grid two">
        <div class="card">
          <h2>Entities</h2>
          <p class="desc">Browse Dataverse entity metadata and jump straight into records or query composition.</p>
          <div class="grid">
            <div class="field"><label>Environment</label><select id="explorer-environment"></select></div>
            <div class="field"><label>Search</label><input id="entity-search" placeholder="account, contact, incident"></div>
            <div class="btn-row">
              <button class="btn primary" id="entity-load" type="button">Load Entities</button>
              <button class="btn secondary" id="entity-clear" type="button">Clear</button>
            </div>
          </div>
          <div id="entity-list" class="list" style="margin-top:16px"></div>
        </div>

        <div class="grid">
          <div class="card">
            <h2 id="entity-title">Entity Detail</h2>
            <p class="desc" id="entity-subtitle">Choose an entity to inspect its metadata and preview records.</p>
            <div id="entity-detail-empty" class="empty">No entity selected yet.</div>
            <div id="entity-detail" hidden>
              <div id="entity-metrics" class="metric-grid"></div>
              <div class="btn-row" style="margin-bottom:14px">
                <button class="btn secondary" id="entity-to-query" type="button">Use In Query Lab</button>
                <button class="btn secondary" id="entity-to-fetchxml" type="button">Use In FetchXML</button>
                <button class="btn ghost" id="entity-refresh-records" type="button">Refresh Records</button>
              </div>
              <div style="overflow:auto">
                <table>
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th>Type</th>
                      <th>Required</th>
                      <th>Flags</th>
                      <th>Targets / Options</th>
                    </tr>
                  </thead>
                  <tbody id="attribute-table"></tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="card">
            <h2>Record Preview</h2>
            <p class="desc">Sample records from the selected entity set. This keeps metadata and live data tied together.</p>
            <div id="record-preview-empty" class="empty">Select an entity with an entity set name to preview records.</div>
            <div id="record-preview" hidden>
              <div class="mono-subtle" id="record-preview-path" style="margin-bottom:10px"></div>
              <pre class="viewer" id="record-preview-json"></pre>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="panel" id="panel-query">
      <div class="grid split">
        <div class="card">
          <h2>Web API Query Builder</h2>
          <p class="desc">Build typed Dataverse query specs, preview the generated path, then execute it with the standard request pipeline.</p>
          <form id="query-form" class="grid">
            <div class="field-grid">
              <div class="field"><label>Environment</label><select name="environmentAlias" id="query-environment"></select></div>
              <div class="field"><label>Account Override</label><select name="accountName" id="query-account"><option value="">environment default</option></select></div>
            </div>
            <div class="field-grid">
              <div class="field"><label>Entity Set</label><input name="entitySetName" id="query-entity-set" placeholder="accounts"></div>
              <div class="field"><label>Top</label><input name="top" type="number" min="1" step="1" value="10"></div>
            </div>
            <div class="field"><label>Select Columns (CSV)</label><input name="selectCsv" id="query-select" placeholder="accountid,name,accountnumber"></div>
            <div class="field"><label>Filter</label><input name="filter" id="query-filter" placeholder="contains(name,'OpenAI')"></div>
            <div class="field-grid">
              <div class="field"><label>Order By (CSV)</label><input name="orderByCsv" id="query-order" placeholder="name asc,createdon desc"></div>
              <div class="field"><label>Expand (CSV)</label><input name="expandCsv" id="query-expand" placeholder="primarycontactid($select=fullname)"></div>
            </div>
            <div class="field"><label>Raw Path Override</label><input name="rawPath" id="query-raw-path" placeholder="/api/data/v9.2/accounts?$select=name"></div>
            <div class="inline-fields"><label><input type="checkbox" name="includeCount"> Include count</label></div>
            <div class="btn-row">
              <button class="btn secondary" id="query-preview-btn" type="button">Preview Path</button>
              <button class="btn primary" id="query-run-btn" type="button">Run Query</button>
            </div>
          </form>
        </div>
        <div class="grid">
          <div class="card">
            <h2>Generated Path</h2>
            <p class="desc">The exact Dataverse path that will be sent.</p>
            <pre class="viewer" id="query-preview"></pre>
          </div>
          <div class="card">
            <h2>Query Result</h2>
            <p class="desc">Raw response payload from the workbench endpoint.</p>
            <pre class="viewer" id="query-result"></pre>
          </div>
        </div>
      </div>
    </section>

    <section class="panel" id="panel-fetchxml">
      <div class="grid split">
        <div class="card">
          <h2>FetchXML Builder</h2>
          <p class="desc">Use the form as a structured starting point, then drop to raw XML whenever needed.</p>
          <form id="fetchxml-form" class="grid">
            <div class="field-grid">
              <div class="field"><label>Environment</label><select name="environmentAlias" id="fetch-environment"></select></div>
              <div class="field"><label>Account Override</label><select name="accountName" id="fetch-account"><option value="">environment default</option></select></div>
            </div>
            <div class="field-grid">
              <div class="field"><label>Entity Logical Name</label><input name="entity" id="fetch-entity" placeholder="account"></div>
              <div class="field"><label>Entity Set Name</label><input name="entitySetName" id="fetch-entity-set" placeholder="accounts"></div>
            </div>
            <div class="field-grid three">
              <div class="field"><label>Attributes (CSV)</label><input name="attributesCsv" id="fetch-attrs" placeholder="accountid,name"></div>
              <div class="field"><label>Top</label><input name="top" type="number" min="1" step="1" value="10"></div>
              <div class="field"><label>Distinct</label><select name="distinct" id="fetch-distinct"><option value="false">false</option><option value="true">true</option></select></div>
            </div>
            <div class="field-grid three">
              <div class="field"><label>Condition 1</label><input id="cond1-attribute" placeholder="name"></div>
              <div class="field"><label>Operator</label><input id="cond1-operator" placeholder="like"></div>
              <div class="field"><label>Value</label><input id="cond1-value" placeholder="%OpenAI%"></div>
            </div>
            <div class="field-grid three">
              <div class="field"><label>Condition 2</label><input id="cond2-attribute" placeholder="statecode"></div>
              <div class="field"><label>Operator</label><input id="cond2-operator" placeholder="eq"></div>
              <div class="field"><label>Value</label><input id="cond2-value" placeholder="0"></div>
            </div>
            <div class="field-grid">
              <div class="field"><label>Order Attribute</label><input id="order-attribute" placeholder="name"></div>
              <div class="field"><label>Descending</label><select id="order-desc"><option value="false">false</option><option value="true">true</option></select></div>
            </div>
            <div class="field"><label>Raw XML Override</label><textarea name="rawXml" id="fetch-raw"></textarea></div>
            <div class="btn-row">
              <button class="btn secondary" id="fetch-preview-btn" type="button">Build XML</button>
              <button class="btn primary" id="fetch-run-btn" type="button">Run FetchXML</button>
            </div>
          </form>
        </div>
        <div class="grid">
          <div class="card">
            <h2>Generated XML</h2>
            <p class="desc">The exact FetchXML payload the server will execute.</p>
            <pre class="viewer" id="fetch-preview"></pre>
          </div>
          <div class="card">
            <h2>FetchXML Result</h2>
            <p class="desc">Raw result payload from Dataverse.</p>
            <pre class="viewer" id="fetch-result"></pre>
          </div>
        </div>
      </div>
    </section>

    <section class="result-dock card">
      <h2>Last Response</h2>
      <p class="desc">The most recent server response, successful or not.</p>
      <pre class="viewer" id="last-response"></pre>
    </section>
  </div>
  <script type="module" src="/assets/ui/app.js"></script>
</body>
</html>`;
}
