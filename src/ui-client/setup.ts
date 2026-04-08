export function renderSetupModule(): string {
  return String.raw`
import { app, api, applyAccountKindVisibility, esc, formDataObject, formatTimeRemaining, optionMarkup, setBtnLoading, summarizeError, toast } from '/assets/ui/shared.js'

const HEALTH_APIS = ['dv', 'flow', 'graph', 'bap', 'powerapps']

const els = {
  refreshState: document.getElementById('refresh-state'),
  recheckHealth: document.getElementById('recheck-health'),
  accountsList: document.getElementById('accounts-list'),
  environmentsList: document.getElementById('environments-list'),
  discoveredList: document.getElementById('discovered-list'),
  accountForm: document.getElementById('account-form'),
  accountCancel: document.getElementById('account-cancel'),
  environmentForm: document.getElementById('environment-form'),
  discoverForm: document.getElementById('discover-form'),
  discoverAccount: document.getElementById('discover-account'),
  environmentAccount: document.getElementById('environment-account'),
  mcpContent: document.getElementById('mcp-content'),
  themeToggle: document.getElementById('theme-toggle'),
  loginLinkPanel: document.getElementById('login-link-panel'),
  loginLinkStatus: document.getElementById('login-link-status'),
  loginLinkTargets: document.getElementById('login-link-targets'),
  loginLinkCopy: document.getElementById('login-link-copy')
}

const health = {}
const tokenStatus = {}
let loginTargets = []

function initTheme() {
  const saved = localStorage.getItem('pp-theme')
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark')
  }
  updateThemeIcon()
}

function toggleTheme() {
  document.documentElement.classList.toggle('dark')
  localStorage.setItem('pp-theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  updateThemeIcon()
}

function updateThemeIcon() {
  els.themeToggle.textContent = document.documentElement.classList.contains('dark') ? '\u2600' : '\u263D'
  els.themeToggle.title = document.documentElement.classList.contains('dark') ? 'Switch to light mode' : 'Switch to dark mode'
}

function showLoginLinkPanel() {
  els.loginLinkPanel.classList.remove('hidden')
  renderLoginLink()
}

function hideLoginLinkPanel() {
  loginTargets = []
  els.loginLinkPanel.classList.add('hidden')
  clearDeviceCode()
  renderLoginLink()
}

function setLoginTargets(targets) {
  loginTargets = Array.isArray(targets) ? targets.slice() : []
  renderLoginLink()
}

function applyLoginTargetUpdate(update) {
  if (!update || !update.resource) return
  const idx = loginTargets.findIndex((target) => target.resource === update.resource)
  if (idx >= 0) loginTargets[idx] = { ...loginTargets[idx], ...update }
  else loginTargets.push(update)
  renderLoginLink()
}

function renderLoginLink() {
  const active = loginTargets.find((target) => target.status === 'running')
  const available = loginTargets.filter((target) => target.url)
  els.loginLinkStatus.textContent = active
    ? 'Follow the current link, then continue through the remaining API logins below.'
    : available.length
      ? 'Authentication links captured for this login session.'
      : 'Waiting for the identity provider to return sign-in links\u2026'
  els.loginLinkTargets.innerHTML = loginTargets.length
    ? loginTargets.map((target) => {
        const tone = target.status === 'completed' ? 'ok' : target.status === 'running' ? 'pending' : 'error'
        const statusLabel = target.status === 'completed' ? 'completed' : target.status === 'running' ? (target.url ? 'action required' : 'waiting') : 'pending'
        const statusCls = target.status === 'completed' ? 'completed' : target.status === 'running' ? 'running' : 'pending'
        const isActive = target.status === 'running' && target.url
        const link = target.url
          ? '<a href="' + esc(target.url) + '" target="_blank" rel="noreferrer" class="login-target-url">' + esc(target.url) + '</a>'
          : '<span style="font-size:0.6875rem;color:var(--muted)">Waiting\u2026</span>'
        return '<div class="login-target' + (isActive ? ' active' : '') + '">' +
          '<div class="login-target-head">' +
            '<div class="login-target-head-left">' +
              '<span class="health-dot ' + tone + '"></span>' +
              '<strong>' + esc(target.label || target.api || target.resource) + '</strong>' +
            '</div>' +
            '<span class="login-target-status ' + statusCls + '">' + esc(statusLabel) + '</span>' +
          '</div>' +
          link +
        '</div>'
      }).join('')
    : ''
  els.loginLinkCopy.disabled = !available.length
}

let activeDeviceCode = null

function showDeviceCode(info) {
  activeDeviceCode = info
  els.loginLinkPanel.classList.remove('hidden')
  renderDeviceCode()
}

function clearDeviceCode() {
  activeDeviceCode = null
  const el = document.getElementById('device-code-panel')
  if (el) el.remove()
}

function renderDeviceCode() {
  if (!activeDeviceCode) return
  let panel = document.getElementById('device-code-panel')
  if (!panel) {
    panel = document.createElement('div')
    panel.id = 'device-code-panel'
    els.loginLinkTargets.parentNode.insertBefore(panel, els.loginLinkTargets)
  }
  const info = activeDeviceCode
  panel.innerHTML =
    '<div class="device-code-card">' +
      '<div class="device-code-instruction">Go to the following URL and enter the code to sign in:</div>' +
      '<div class="device-code-url-row">' +
        '<a href="' + esc(info.verificationUri) + '" target="_blank" rel="noreferrer" class="device-code-url">' + esc(info.verificationUri) + '</a>' +
        '<button type="button" class="btn btn-ghost device-code-open-btn" data-open-device-url="' + esc(info.verificationUri) + '">Open</button>' +
      '</div>' +
      '<div class="device-code-box">' +
        '<span class="device-code-label">Your code</span>' +
        '<span class="device-code-value" id="device-code-value">' + esc(info.userCode) + '</span>' +
        '<button type="button" class="btn btn-ghost" id="device-code-copy" style="font-size:0.75rem;padding:4px 10px">Copy</button>' +
      '</div>' +
    '</div>'
  const copyBtn = panel.querySelector('#device-code-copy')
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(info.userCode).then(
        () => { toast('Code copied'); copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy' }, 1500) },
        () => toast('Failed to copy', true)
      )
    })
  }
  const openBtn = panel.querySelector('[data-open-device-url]')
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      window.open(info.verificationUri, '_blank', 'noreferrer')
    })
  }
}

function tokenDotHtml(accountName) {
  const info = tokenStatus[accountName]
  if (info === undefined) return '<span class="health-dot pending" title="Checking\u2026"></span>'
  if (info && info.authenticated) return '<span class="health-dot ok" title="Authenticated"></span>'
  return '<span class="health-dot error" title="Not authenticated"></span>'
}

function tokenExpiryHtml(accountName) {
  const info = tokenStatus[accountName]
  if (!info || !info.authenticated || !info.expiresAt) return ''
  const expiry = formatTimeRemaining(info.expiresAt)
  if (!expiry) return ''
  return '<span class="token-expiry ' + (expiry.cls || '') + '">' + esc(expiry.text) + '</span>'
}

function checkTokenStatuses(accounts) {
  for (const a of accounts) {
    tokenStatus[a.name] = undefined
    updateAccountDot(a.name)
    fetch('/api/accounts/token-status?account=' + encodeURIComponent(a.name), { headers: { 'content-type': 'application/json' } })
      .then((r) => r.json())
      .then((data) => {
        tokenStatus[a.name] = data.success && data.data ? data.data : { authenticated: false }
        updateAccountDot(a.name)
      })
      .catch(() => {
        tokenStatus[a.name] = { authenticated: false }
        updateAccountDot(a.name)
      })
  }
}

function updateAccountDot(accountName) {
  const el = document.getElementById('token-dot-' + accountName)
  if (el) el.innerHTML = tokenDotHtml(accountName)
  const expiryEl = document.getElementById('token-expiry-' + accountName)
  if (expiryEl) expiryEl.innerHTML = tokenExpiryHtml(accountName)
}

export function renderSetupState(data) {
  const accounts = data.accounts || []
  const environments = data.environments || []

  els.accountsList.innerHTML = accounts.length
    ? accounts.map((a) => {
        const isInteractive = a.kind === 'user' || a.kind === 'device-code'
        const email = a.accountUsername || a.loginHint || ''
        const loginBtn = isInteractive
          ? '<button class="btn btn-ghost" data-login-account="' + esc(a.name) + '" type="button" style="font-size:0.75rem;padding:4px 10px">Login</button>'
          : ''

        const detailProps = []
        if (a.description) detailProps.push({ label: 'Description', value: a.description })
        if (a.tenantId) detailProps.push({ label: 'Tenant ID', value: a.tenantId })
        if (a.clientId) detailProps.push({ label: 'Client ID', value: a.clientId })
        if (a.accountUsername) detailProps.push({ label: 'Username', value: a.accountUsername })
        if (a.loginHint) detailProps.push({ label: 'Login Hint', value: a.loginHint })
        if (a.tokenCacheKey) detailProps.push({ label: 'Cache Key', value: a.tokenCacheKey })
        if (a.clientSecretEnv) detailProps.push({ label: 'Secret Env', value: a.clientSecretEnv })
        if (a.environmentVariable) detailProps.push({ label: 'Token Env', value: a.environmentVariable })

        const propsHtml = detailProps.length
          ? '<div class="account-card-props">' + detailProps.map((p) =>
              '<div class="account-card-prop"><div class="account-card-prop-label">' + esc(p.label) + '</div><div class="account-card-prop-value">' + esc(p.value) + '</div></div>'
            ).join('') + '</div>'
          : ''

        const editFields = isInteractive
          ? '<div class="form-row"><div class="field"><span class="field-label">Description</span><input name="description" value="' + esc(a.description || '') + '" placeholder="Optional"></div>' +
            '<div class="field"><span class="field-label">Login Hint</span><input name="loginHint" value="' + esc(a.loginHint || '') + '" placeholder="user@example.com"></div></div>' +
            '<div class="form-row"><div class="field"><span class="field-label">Tenant ID</span><input name="tenantId" value="' + esc(a.tenantId || '') + '" placeholder="common"></div>' +
            '<div class="field"><span class="field-label">Client ID</span><input name="clientId" value="' + esc(a.clientId || '') + '" placeholder="default"></div></div>'
          : a.kind === 'client-secret'
            ? '<div class="form-row"><div class="field"><span class="field-label">Description</span><input name="description" value="' + esc(a.description || '') + '" placeholder="Optional"></div>' +
              '<div class="field"><span class="field-label">Client Secret Env</span><input name="clientSecretEnv" value="' + esc(a.clientSecretEnv || '') + '"></div></div>' +
              '<div class="form-row"><div class="field"><span class="field-label">Tenant ID</span><input name="tenantId" value="' + esc(a.tenantId || '') + '"></div>' +
              '<div class="field"><span class="field-label">Client ID</span><input name="clientId" value="' + esc(a.clientId || '') + '"></div></div>'
            : '<div class="field"><span class="field-label">Description</span><input name="description" value="' + esc(a.description || '') + '" placeholder="Optional"></div>'

        return '<div class="account-card" data-account-card="' + esc(a.name) + '">' +
          '<div class="account-card-head" data-toggle-account="' + esc(a.name) + '">' +
            '<div class="account-card-identity">' +
              '<span id="token-dot-' + esc(a.name) + '">' + tokenDotHtml(a.name) + '</span>' +
              '<div style="min-width:0">' +
                '<div style="display:flex;align-items:center;gap:8px">' +
                  '<span class="account-card-name">' + esc(a.name) + '</span>' +
                  '<span class="badge">' + esc(a.kind) + '</span>' +
                '</div>' +
                (email ? '<div class="account-card-email">' + esc(email) + '</div>' : '') +
                '<div id="token-expiry-' + esc(a.name) + '">' + tokenExpiryHtml(a.name) + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="account-card-actions">' + loginBtn +
              '<button class="btn btn-danger" data-remove-account="' + esc(a.name) + '" type="button">Remove</button>' +
            '</div>' +
          '</div>' +
          '<div class="account-card-body">' +
            propsHtml +
            '<form class="account-edit-form" data-edit-account="' + esc(a.name) + '">' +
              '<input type="hidden" name="name" value="' + esc(a.name) + '">' +
              '<input type="hidden" name="kind" value="' + esc(a.kind) + '">' +
              '<input type="hidden" name="accountUsername" value="' + esc(a.accountUsername || '') + '">' +
              '<input type="hidden" name="homeAccountId" value="' + esc(a.homeAccountId || '') + '">' +
              '<input type="hidden" name="localAccountId" value="' + esc(a.localAccountId || '') + '">' +
              '<input type="hidden" name="tokenCacheKey" value="' + esc(a.tokenCacheKey || '') + '">' +
              editFields +
              '<div class="btn-group"><button type="submit" class="btn btn-secondary" style="font-size:0.75rem;padding:5px 12px">Save Changes</button></div>' +
            '</form>' +
          '</div>' +
        '</div>'
      }).join('')
    : '<div class="empty">No accounts configured.</div>'

  els.environmentsList.innerHTML = environments.length
    ? environments.map((e) => {
        const alias = esc(e.alias)
        const h = health[e.alias] || {}
        const healthDots = HEALTH_APIS.map((apiName) => {
          const state = h[apiName]
          const cls = !state || state.status === 'pending' ? 'pending' : state.status === 'ok' ? 'ok' : 'error'
          const label = state && state.summary ? state.summary : (cls === 'ok' ? 'OK' : cls === 'error' ? 'Failed' : 'Checking…')
          return '<button class="health-item health-item-btn" data-health-alias="' + alias + '" data-health-api="' + apiName + '" title="' + esc(apiName + ': ' + label) + '">' +
            '<span class="health-dot ' + cls + '"></span>' + apiName +
          '</button>'
        }).join('')
        const failed = HEALTH_APIS.filter((apiName) => h[apiName] && h[apiName].status === 'error')
        const summary = failed.length
          ? failed.length + ' failing: ' + failed.join(', ')
          : HEALTH_APIS.some((apiName) => h[apiName] && h[apiName].status === 'ok')
            ? 'Health checks available. Click an API for details.'
            : 'Running health checks…'
        const props = []
        if (e.makerEnvironmentId) props.push('<span class="env-card-prop">Maker ID <code>' + esc(e.makerEnvironmentId) + '</code></span>')
        if (e.tenantId) props.push('<span class="env-card-prop">Tenant <code>' + esc(e.tenantId) + '</code></span>')
        if (e.accessMode) props.push('<span class="env-card-prop">Access <code>' + esc(e.accessMode) + '</code></span>')
        const acctInfo = tokenStatus[e.account]
        const acctAuth = acctInfo && acctInfo.authenticated
        const acctDotCls = acctInfo === undefined ? 'pending' : acctAuth ? 'ok' : 'error'
        const acctLabel = acctInfo === undefined ? 'Checking\u2026' : acctAuth ? 'Authenticated' : 'Not authenticated'
        const acctExpiry = acctAuth ? formatTimeRemaining(acctInfo.expiresAt) : null
        const acctExpiryHtml = acctExpiry ? ' <span class="token-expiry ' + (acctExpiry.cls || '') + '">' + esc(acctExpiry.text) + '</span>' : ''

        return '<div class="env-card">' +
          '<div class="env-card-head">' +
            '<div>' +
              '<div class="env-card-title">' + alias + (e.displayName && e.displayName !== e.alias ? ' <span style="color:var(--muted);font-weight:400">' + esc(e.displayName) + '</span>' : '') + '</div>' +
              '<div class="env-card-url">' + esc(e.url || '') + '</div>' +
              '<div class="env-card-account"><span class="health-dot ' + acctDotCls + '" title="' + esc(acctLabel) + '"></span> ' + esc(e.account) + acctExpiryHtml + '</div>' +
            '</div>' +
            '<button class="btn btn-danger" data-remove-environment="' + esc(e.alias) + '" type="button">Remove</button>' +
          '</div>' +
          (props.length ? '<div class="env-card-props">' + props.join('') + '</div>' : '') +
          '<div class="health-row" id="health-' + alias + '">' + healthDots + '</div>' +
          '<div class="health-summary">' + esc(summary) + '</div>' +
          '<div class="health-detail hidden" id="health-detail-' + alias + '"></div>' +
        '</div>'
      }).join('')
    : '<div class="empty">No environments configured.</div>'

  const accountNames = accounts.map((a) => a.name)
  els.discoverAccount.innerHTML = optionMarkup(accountNames, 'select account')
  els.environmentAccount.innerHTML = optionMarkup(accountNames)

  if (data.mcp) {
    els.mcpContent.innerHTML =
      '<div style="margin-bottom:12px"><span class="field-label">Launch Command</span></div>' +
      '<div class="mcp-cmd-wrap"><div class="mcp-cmd" id="mcp-cmd">' + esc(data.mcp.launchCommand) + '</div><button class="mcp-copy" id="mcp-copy-btn">Copy</button></div>' +
      '<div style="margin-bottom:8px"><span class="field-label">Available Tools (' + data.mcp.tools.length + ')</span></div>' +
      '<div class="tool-grid">' + data.mcp.tools.map((t) => '<code>' + esc(t) + '</code>').join('') + '</div>'
  }
}

function checkHealth(environments) {
  for (const env of environments) {
    if (!health[env.alias]) health[env.alias] = {}
    for (const apiName of HEALTH_APIS) {
      health[env.alias][apiName] = { status: 'pending', summary: 'Checking…' }
      updateHealthDot(env.alias, apiName, 'pending')
      fetch('/api/checks/ping', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ environment: env.alias, api: apiName })
      })
        .then((r) => r.json())
        .then((data) => {
          const ok = data.success !== false
          health[env.alias][apiName] = ok
            ? { status: 'ok', summary: 'Reachable' }
            : summarizeHealthFailure(data)
          updateHealthDot(env.alias, apiName, ok ? 'ok' : 'error')
        })
        .catch(() => {
          health[env.alias][apiName] = { status: 'error', summary: 'Request failed', detail: 'The health check request did not complete.' }
          updateHealthDot(env.alias, apiName, 'error')
        })
    }
  }
}

function updateHealthDot(alias, apiName, cls) {
  const row = document.getElementById('health-' + alias)
  if (!row) return
  const items = row.querySelectorAll('.health-item')
  const idx = HEALTH_APIS.indexOf(apiName)
  if (idx >= 0 && items[idx]) {
    const dot = items[idx].querySelector('.health-dot')
    if (dot) dot.className = 'health-dot ' + cls
  }
}

function summarizeHealthFailure(payload) {
  const diagnostic = payload && Array.isArray(payload.diagnostics) ? payload.diagnostics[0] : null
  const message = diagnostic && diagnostic.message ? diagnostic.message : 'Health check failed'
  const detail = diagnostic && diagnostic.detail ? diagnostic.detail : ''
  const summary = /Interactive authentication is disabled/i.test(message)
    ? 'Needs login for this API'
    : /returned 401/i.test(message) || /returned 403/i.test(message)
      ? 'Permission or consent required'
      : /returned 404/i.test(message)
        ? 'API endpoint unavailable'
        : message
  return { status: 'error', summary, message, detail, code: diagnostic && diagnostic.code ? diagnostic.code : '' }
}

function renderHealthDetail(alias, apiName) {
  const detailEl = document.getElementById('health-detail-' + alias)
  if (!detailEl) return
  const state = health[alias] && health[alias][apiName]
  if (!state || (!detailEl.classList.contains('hidden') && detailEl.dataset.activeApi === apiName)) {
    detailEl.classList.add('hidden')
    detailEl.innerHTML = ''
    detailEl.dataset.activeApi = ''
    return
  }
  detailEl.dataset.activeApi = apiName
  const statusIcon = state.status === 'ok' ? '\u2713' : state.status === 'error' ? '\u2717' : '\u2026'
  const lines = []
  lines.push('<div style="display:flex;justify-content:space-between;align-items:flex-start">')
  lines.push('<div class="health-detail-title">' + esc(statusIcon + ' ' + apiName) + ' \u2014 ' + esc(state.summary || 'Status unknown') + '</div>')
  lines.push('<button class="condition-remove" data-dismiss-health style="flex-shrink:0">\u00d7</button>')
  lines.push('</div>')
  if (state.message && state.message !== state.summary) lines.push('<div style="margin-top:4px;line-height:1.4">' + esc(state.message) + '</div>')
  if (state.code) lines.push('<div class="health-detail-meta">Code: ' + esc(state.code) + '</div>')
  if (state.detail) lines.push('<pre class="health-detail-pre">' + esc(trimHealthDetail(state.detail)) + '</pre>')
  if (state.status === 'error' && /login|consent|permission/i.test((state.summary || '') + ' ' + (state.message || ''))) {
    lines.push('<div class="health-detail-hint">This usually means the account is valid but no cached token is available for this API. Use the Login button on your account above, then re-check health.</div>')
  }
  detailEl.innerHTML = lines.join('')
  detailEl.classList.remove('hidden')

  const dismissBtn = detailEl.querySelector('[data-dismiss-health]')
  if (dismissBtn) {
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      detailEl.classList.add('hidden')
      detailEl.innerHTML = ''
      detailEl.dataset.activeApi = ''
    })
  }
}

function trimHealthDetail(detail) {
  const text = String(detail || '').trim()
  return text.length > 700 ? text.slice(0, 700) + '…' : text
}

export function initSetup(refreshState) {
  initTheme()
  els.themeToggle.addEventListener('click', toggleTheme)

  els.refreshState.addEventListener('click', () => {
    refreshState(false).catch((err) => toast(err.message, true))
  })

  els.recheckHealth.addEventListener('click', () => {
    if (app.state && app.state.data) {
      checkHealth(app.state.data.environments || [])
      checkTokenStatuses(app.state.data.accounts || [])
      toast('Health checks started')
    }
  })

  els.accountForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const btn = document.getElementById('account-submit')
    const kind = document.getElementById('account-kind').value
    const isInteractive = kind === 'user' || kind === 'device-code'
    setBtnLoading(btn, true, isInteractive ? 'Waiting for login\u2026' : 'Saving\u2026')
    if (isInteractive) {
      els.accountCancel.classList.remove('hidden')
      showLoginLinkPanel()
    }
    try {
      const started = await api('/api/jobs/account-login', {
        method: 'POST',
        body: JSON.stringify({ ...formDataObject(form), environmentAlias: getSelectedEnvironment(), excludeApis: getExcludedApis() })
      })
      app.currentLoginJobId = started.data.id
      if (started.data.metadata && Array.isArray(started.data.metadata.loginTargets)) {
        setLoginTargets(started.data.metadata.loginTargets)
      }
      const result = await waitForLoginJob(app.currentLoginJobId)
      form.reset()
      document.getElementById('account-kind').value = 'user'
      applyAccountKindVisibility()
      if (result && result.data && result.data.expiresAt) {
        toast('Account saved and authenticated')
      } else {
        toast('Account saved but login may not have completed', true)
      }
      await refreshState(true)
    } catch (err) {
      toast(err.message, true)
    } finally {
      app.currentLoginJobId = null
      els.accountCancel.classList.add('hidden')
      hideLoginLinkPanel()
      setBtnLoading(btn, false, 'Save & Login')
    }
  })

  els.accountCancel.addEventListener('click', async () => {
    if (!app.currentLoginJobId) return
    try {
      await fetch('/api/jobs/' + encodeURIComponent(app.currentLoginJobId), { method: 'DELETE', headers: { 'content-type': 'application/json' } })
      toast('Pending login cancelled', true)
    } finally {
      app.currentLoginJobId = null
      els.accountCancel.classList.add('hidden')
      hideLoginLinkPanel()
    }
  })

  els.environmentForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const btn = document.getElementById('env-submit')
    setBtnLoading(btn, true, 'Discovering\u2026')
    try {
      await api('/api/environments', { method: 'POST', body: JSON.stringify(formDataObject(form)) })
      form.reset()
      els.discoveredList.innerHTML = ''
      toast('Environment added')
      await refreshState(true)
    } catch (err) {
      toast(err.message, true)
    } finally {
      setBtnLoading(btn, false, 'Discover & Save')
    }
  })

  els.discoverForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const btn = document.getElementById('discover-submit')
    setBtnLoading(btn, true, 'Discovering\u2026')
    try {
      const payload = await api('/api/environments/discover', { method: 'POST', body: JSON.stringify(formDataObject(form)) })
      const items = payload.data || []
      els.discoveredList.innerHTML = items.length
        ? items.map((item) =>
            '<div class="card-item">' +
              '<div class="card-item-info"><div class="card-item-title">' + esc(item.displayName || item.makerEnvironmentId || 'environment') + '</div><div class="card-item-sub">' + esc(item.environmentApiUrl || item.environmentUrl || '') + '</div></div>' +
              '<button class="btn btn-ghost" data-use-discovered="' + esc(encodeURIComponent(JSON.stringify(item))) + '" type="button">Use</button>' +
            '</div>'
          ).join('')
        : '<div class="empty">No environments returned.</div>'
      toast(items.length + ' environment' + (items.length === 1 ? '' : 's') + ' found')
    } catch (err) {
      toast(err.message, true)
    } finally {
      setBtnLoading(btn, false, 'Discover')
    }
  })

  document.body.addEventListener('click', (event) => {
    const removeAccount = event.target.closest('[data-remove-account]')
    if (removeAccount) {
      if (!confirm('Remove account "' + removeAccount.dataset.removeAccount + '"?')) return
      api('/api/accounts/' + encodeURIComponent(removeAccount.dataset.removeAccount), { method: 'DELETE' })
        .then(() => { toast('Account removed'); return refreshState(true) })
        .catch((err) => toast(err.message, true))
      return
    }
    const removeEnvironment = event.target.closest('[data-remove-environment]')
    if (removeEnvironment) {
      if (!confirm('Remove environment "' + removeEnvironment.dataset.removeEnvironment + '"?')) return
      api('/api/environments/' + encodeURIComponent(removeEnvironment.dataset.removeEnvironment), { method: 'DELETE' })
        .then(() => { toast('Environment removed'); return refreshState(true) })
        .catch((err) => toast(err.message, true))
      return
    }
    const loginAccount = event.target.closest('[data-login-account]')
    if (loginAccount) {
      const name = loginAccount.dataset.loginAccount
      const btn = loginAccount
      setBtnLoading(btn, true, 'Logging in\u2026')
      showLoginLinkPanel()
      api('/api/jobs/account-login', {
        method: 'POST',
        body: JSON.stringify({ name, kind: 'user', environmentAlias: getSelectedEnvironment(), excludeApis: getExcludedApis() })
      })
        .then(async (started) => {
          app.currentLoginJobId = started.data.id
          if (started.data.metadata && Array.isArray(started.data.metadata.loginTargets)) {
            setLoginTargets(started.data.metadata.loginTargets)
          }
          const result = await waitForLoginJob(app.currentLoginJobId)
          app.currentLoginJobId = null
          if (result && result.data && result.data.expiresAt) {
            toast(name + ' authenticated')
          } else {
            toast(name + ' login may not have completed', true)
          }
          await refreshState(true)
        })
        .catch((err) => { toast(err.message, true); app.currentLoginJobId = null })
        .finally(() => { hideLoginLinkPanel(); setBtnLoading(btn, false, 'Login') })
      return
    }
    const useDiscovered = event.target.closest('[data-use-discovered]')
    if (useDiscovered) {
      const payload = JSON.parse(decodeURIComponent(useDiscovered.dataset.useDiscovered))
      const form = els.environmentForm
      form.elements.alias.value = payload.displayName
        ? payload.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        : (payload.makerEnvironmentId || '')
      form.elements.account.value = payload.accountName || ''
      form.elements.url.value = payload.environmentApiUrl || payload.environmentUrl || ''
      form.elements.displayName.value = payload.displayName || ''
      return
    }
    if (event.target.id === 'mcp-copy-btn' || event.target.closest('#mcp-copy-btn')) {
      const cmd = document.getElementById('mcp-cmd')
      if (cmd) {
        navigator.clipboard.writeText(cmd.textContent).then(
          () => { toast('Copied to clipboard'); event.target.textContent = 'Copied!'; setTimeout(() => { event.target.textContent = 'Copy' }, 1500) },
          () => toast('Failed to copy', true)
        )
      }
      return
    }
    if (event.target.id === 'login-link-copy' || event.target.closest('#login-link-copy')) {
      const links = loginTargets.filter((target) => target.url).map((target) => (target.label || target.api || target.resource) + ': ' + target.url)
      if (!links.length) return
      navigator.clipboard.writeText(links.join('\n')).then(
        () => toast('Copied login URLs'),
        () => toast('Failed to copy login URLs', true)
      )
      return
    }
    const toggleAccount = event.target.closest('[data-toggle-account]')
    if (toggleAccount && !event.target.closest('button')) {
      const name = toggleAccount.dataset.toggleAccount
      const card = document.querySelector('[data-account-card="' + name + '"]')
      if (card) card.classList.toggle('expanded')
      return
    }
    const healthItem = event.target.closest('[data-health-alias][data-health-api]')
    if (healthItem) {
      renderHealthDetail(healthItem.dataset.healthAlias, healthItem.dataset.healthApi)
    }
  })

  document.body.addEventListener('submit', async (event) => {
    const editForm = event.target.closest('[data-edit-account]')
    if (!editForm) return
    event.preventDefault()
    const name = editForm.dataset.editAccount
    const data = formDataObject(editForm)
    try {
      await api('/api/accounts/' + encodeURIComponent(name), {
        method: 'PUT',
        body: JSON.stringify(data)
      })
      toast('Account updated')
      await refreshState(true)
    } catch (err) {
      toast(err.message, true)
    }
  })
}

export function runInitialHealthChecks(data) {
  checkHealth(data.environments || [])
  checkTokenStatuses(data.accounts || [])
}

async function waitForLoginJob(jobId) {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const response = await fetch('/api/jobs/' + encodeURIComponent(jobId), { headers: { 'content-type': 'application/json' } })
    const payload = await response.json()
    const job = payload.data
    if (job && job.metadata) {
      if (Array.isArray(job.metadata.loginTargets)) {
        setLoginTargets(job.metadata.loginTargets)
      }
      if (job.metadata.activeLoginTarget && typeof job.metadata.activeLoginTarget === 'object') {
        applyLoginTargetUpdate(job.metadata.activeLoginTarget)
      }
      if (job.metadata.deviceCode && typeof job.metadata.deviceCode === 'object') {
        showDeviceCode(job.metadata.deviceCode)
      }
    }
    if (!job || job.status === 'pending') continue
    if (job.status === 'cancelled') throw new Error('Login cancelled.')
    if (job.result && job.result.success === false) throw new Error(summarizeError(job.result))
    return job.result
  }
}

function getSelectedEnvironment() {
  const global = document.getElementById('global-environment')
  return global && global.value ? global.value : undefined
}

function getExcludedApis() {
  const allApis = ['dv', 'flow', 'powerapps', 'graph']
  const checks = document.querySelectorAll('#api-scope-checks input[type="checkbox"]')
  const checked = new Set()
  for (const cb of checks) if (cb.checked) checked.add(cb.value)
  return allApis.filter((api) => !checked.has(api))
}
`;
}
