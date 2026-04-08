export function renderConsoleModule() {
    return String.raw `
import { api, esc, getGlobalEnvironment, setBtnLoading, highlightJson, copyToClipboard, formatBytes, toast } from '/assets/ui/shared.js'

const APIS = [
  {
    key: 'dv', label: 'Dataverse', scope: 'environment',
    defaultPath: '/WhoAmI',
    presets: [
      { label: 'WhoAmI', method: 'GET', path: '/WhoAmI', description: 'Current user identity' },
      { label: 'List Accounts', method: 'GET', path: '/accounts?$top=10&$select=name,accountid', description: 'Account records' },
      { label: 'Entity Metadata', method: 'GET', path: '/EntityDefinitions?$top=10&$select=LogicalName,DisplayName,EntitySetName', description: 'Entity definitions' },
      { label: 'Global Option Sets', method: 'GET', path: '/GlobalOptionSetDefinitions?$top=10', description: 'Global option set metadata' }
    ]
  },
  {
    key: 'flow', label: 'Power Automate', scope: 'environment',
    defaultPath: '/flows',
    presets: [
      { label: 'List Flows', method: 'GET', path: '/flows', description: 'All flows in environment' },
      { label: 'List Flow Runs', method: 'GET', path: '/flows/{flowId}/runs', description: 'Runs for a specific flow' }
    ]
  },
  {
    key: 'powerapps', label: 'Power Apps', scope: 'environment',
    defaultPath: '/apps',
    presets: [
      { label: 'List Apps', method: 'GET', path: '/apps', description: 'All apps in environment' }
    ]
  },
  {
    key: 'bap', label: 'Platform (BAP)', scope: 'environment',
    defaultPath: '/environments',
    presets: [
      { label: 'List Environments', method: 'GET', path: '/environments', description: 'All accessible environments' },
      { label: 'Connectors', method: 'GET', path: '/connectors', description: 'Available connectors' }
    ]
  },
  {
    key: 'graph', label: 'Microsoft Graph', scope: 'account',
    defaultPath: '/me',
    presets: [
      { label: 'My Profile', method: 'GET', path: '/me', description: 'Current user profile' },
      { label: 'Organization', method: 'GET', path: '/organization', description: 'Tenant info' },
      { label: 'Users (top 10)', method: 'GET', path: '/users?$top=10', description: 'Directory users' },
      { label: 'Groups (top 10)', method: 'GET', path: '/groups?$top=10', description: 'Directory groups' }
    ]
  }
]

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

const METHOD_COLORS = { GET: 'var(--ok)', POST: 'var(--accent)', PUT: '#d97706', PATCH: '#d97706', DELETE: 'var(--danger)' }

const els = {
  apiSelect: document.getElementById('console-api'),
  methodSelect: document.getElementById('console-method'),
  pathInput: document.getElementById('console-path'),
  presetSelect: document.getElementById('console-preset'),
  queryParams: document.getElementById('console-query-params'),
  addQueryParam: document.getElementById('console-add-query-param'),
  headersContainer: document.getElementById('console-headers'),
  addHeader: document.getElementById('console-add-header'),
  bodyInput: document.getElementById('console-body'),
  sendBtn: document.getElementById('console-send'),
  responseStatus: document.getElementById('console-response-status'),
  responseTime: document.getElementById('console-response-time'),
  responseBody: document.getElementById('console-response-body'),
  responseHeadersEl: document.getElementById('console-response-headers-body'),
  responseSize: document.getElementById('console-response-size'),
  copyResponse: document.getElementById('console-copy-response'),
  historyList: document.getElementById('console-history'),
  savedPanel: document.getElementById('console-saved-panel'),
  savedList: document.getElementById('console-saved'),
  bodySection: document.getElementById('console-body-section'),
  scopeHint: document.getElementById('console-scope-hint')
}

let history = []
let savedRequests = []

function loadPersistedState() {
  try { history = JSON.parse(localStorage.getItem('pp-console-history') || '[]') } catch { history = [] }
  try { savedRequests = JSON.parse(localStorage.getItem('pp-console-saved') || '[]') } catch { savedRequests = [] }
}

function persistHistory() {
  try { localStorage.setItem('pp-console-history', JSON.stringify(history.slice(0, 50))) } catch {}
}

function persistSaved() {
  try { localStorage.setItem('pp-console-saved', JSON.stringify(savedRequests.slice(0, 30))) } catch {}
}

export function initConsole() {
  els.apiSelect.innerHTML = APIS.map(a =>
    '<option value="' + esc(a.key) + '">' + esc(a.label) + '</option>'
  ).join('')

  els.methodSelect.innerHTML = METHODS.map(m =>
    '<option value="' + m + '">' + m + '</option>'
  ).join('')

  els.apiSelect.addEventListener('change', () => {
    const a = currentApi()
    if (a) {
      els.pathInput.value = a.defaultPath
      populatePresets(a)
      updateScopeHint(a)
    }
    updateBodyVisibility()
  })

  els.presetSelect.addEventListener('change', () => {
    const a = currentApi()
    if (!a) return
    const preset = a.presets.find(p => p.label === els.presetSelect.value)
    if (preset) {
      els.methodSelect.value = preset.method
      els.pathInput.value = preset.path
      if (preset.body) els.bodyInput.value = preset.body
      else els.bodyInput.value = ''
      updateMethodColor()
      updateBodyVisibility()
    }
  })

  els.methodSelect.addEventListener('change', () => {
    updateMethodColor()
    updateBodyVisibility()
  })

  els.sendBtn.addEventListener('click', () => sendRequest().catch(e => toast(e.message, true)))

  els.pathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      sendRequest().catch(err => toast(err.message, true))
    }
  })

  els.addQueryParam.addEventListener('click', () => addKvRow(els.queryParams))
  els.addHeader.addEventListener('click', () => addKvRow(els.headersContainer))

  els.copyResponse.addEventListener('click', () => {
    const text = els.responseBody.textContent || ''
    if (text && text !== 'Send a request to see the response.') copyToClipboard(text, 'Response copied')
  })

  loadPersistedState()
  renderHistory()
  renderSaved()

  const firstApi = APIS[0]
  if (firstApi) {
    els.pathInput.value = firstApi.defaultPath
    populatePresets(firstApi)
    updateScopeHint(firstApi)
  }
  updateMethodColor()
  updateBodyVisibility()
}

function currentApi() {
  return APIS.find(a => a.key === els.apiSelect.value)
}

function populatePresets(apiDef) {
  els.presetSelect.innerHTML = '<option value="">Presets\u2026</option>' +
    apiDef.presets.map(p =>
      '<option value="' + esc(p.label) + '">' + esc(p.label) + ' \u2014 ' + esc(p.description) + '</option>'
    ).join('')
}

function updateScopeHint(apiDef) {
  if (apiDef.scope === 'account') {
    els.scopeHint.innerHTML = '<span class="console-scope-badge account">account-scoped</span> Uses environment\u2019s account for auth, requests go to ' + esc(apiDef.label) + ' endpoints'
  } else {
    els.scopeHint.innerHTML = '<span class="console-scope-badge env">environment-scoped</span> Requests go through the selected environment'
  }
}

function updateMethodColor() {
  const method = els.methodSelect.value
  els.methodSelect.style.color = METHOD_COLORS[method] || 'var(--ink)'
}

function updateBodyVisibility() {
  const method = els.methodSelect.value
  const hasBody = method !== 'GET' && method !== 'DELETE'
  els.bodySection.style.display = hasBody ? '' : 'none'
}

function addKvRow(container) {
  const row = document.createElement('div')
  row.className = 'kv-row'
  row.innerHTML =
    '<input placeholder="key" data-role="kv-key">' +
    '<input placeholder="value" data-role="kv-value">' +
    '<button type="button" class="condition-remove" data-remove-kv>\u00d7</button>'
  row.querySelector('[data-remove-kv]').addEventListener('click', () => row.remove())
  container.appendChild(row)
}

function readKvPairs(container) {
  const result = {}
  for (const row of container.querySelectorAll('.kv-row')) {
    const key = row.querySelector('[data-role="kv-key"]').value.trim()
    const value = row.querySelector('[data-role="kv-value"]').value
    if (key) result[key] = value
  }
  return Object.keys(result).length ? result : undefined
}

async function sendRequest() {
  const env = getGlobalEnvironment()
  if (!env) throw new Error('Select an environment first.')
  const apiKey = els.apiSelect.value
  const method = els.methodSelect.value
  const path = els.pathInput.value.trim()
  if (!path) throw new Error('Enter a request path.')

  const query = readKvPairs(els.queryParams)
  const headers = readKvPairs(els.headersContainer)
  const bodyText = els.bodyInput.value.trim()
  let body = undefined
  if (bodyText && method !== 'GET' && method !== 'DELETE') {
    try { body = JSON.parse(bodyText) }
    catch { body = bodyText }
  }

  setBtnLoading(els.sendBtn, true, 'Sending\u2026')
  const startTime = performance.now()

  try {
    const payload = await api('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({
        environment: env,
        api: apiKey,
        method,
        path,
        query,
        headers,
        body
      })
    })

    const elapsed = Math.round(performance.now() - startTime)
    const data = payload.data || {}
    const status = data.status || 200
    const responseBody = data.response

    renderResponse(status, elapsed, responseBody, data.headers)
    addHistoryEntry({ api: apiKey, method, path, status, elapsed, response: responseBody })
  } catch (err) {
    const elapsed = Math.round(performance.now() - startTime)
    renderResponse(0, elapsed, { error: err.message }, {})
    addHistoryEntry({ api: apiKey, method, path, status: 0, elapsed, response: { error: err.message } })
    throw err
  } finally {
    setBtnLoading(els.sendBtn, false, 'Send')
  }
}

function renderResponse(status, elapsed, body, headers) {
  if (status >= 200 && status < 300) {
    els.responseStatus.className = 'console-status-badge success'
    els.responseStatus.textContent = status
  } else if (status >= 400) {
    els.responseStatus.className = 'console-status-badge error'
    els.responseStatus.textContent = status
  } else if (status === 0) {
    els.responseStatus.className = 'console-status-badge error'
    els.responseStatus.textContent = 'ERR'
  } else {
    els.responseStatus.className = 'console-status-badge'
    els.responseStatus.textContent = status
  }

  els.responseTime.textContent = elapsed + 'ms'
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body, null, 2)
  els.responseBody.innerHTML = highlightJson(bodyStr)
  els.responseSize.textContent = formatBytes(new Blob([bodyStr]).size)

  if (headers && Object.keys(headers).length) {
    els.responseHeadersEl.textContent = Object.entries(headers).map(([k, v]) => k + ': ' + v).join('\n')
    els.responseHeadersEl.parentElement.style.display = ''
  } else {
    els.responseHeadersEl.parentElement.style.display = 'none'
  }
}

function addHistoryEntry(entry) {
  history.unshift(entry)
  if (history.length > 50) history.pop()
  persistHistory()
  renderHistory()
}

function renderHistory() {
  if (!history.length) {
    els.historyList.innerHTML = '<div class="empty">No requests yet.</div>'
    return
  }
  const isPinned = (h) => savedRequests.some((s) => s.api === h.api && s.method === h.method && s.path === h.path)
  els.historyList.innerHTML = history.slice(0, 20).map((h, i) => {
    const statusCls = h.status >= 200 && h.status < 300 ? 'success' : h.status >= 400 ? 'error' : ''
    const pinned = isPinned(h)
    return '<div class="history-item" data-history-idx="' + i + '">' +
      '<div class="history-item-main">' +
        '<span class="history-method ' + esc(h.method.toLowerCase()) + '">' + esc(h.method) + '</span>' +
        '<span class="history-path">' + esc(h.path) + '</span>' +
      '</div>' +
      '<div class="history-item-meta">' +
        '<span class="console-status-badge small ' + statusCls + '">' + (h.status || 'ERR') + '</span>' +
        '<span class="history-time">' + h.elapsed + 'ms</span>' +
        '<span class="history-api">' + esc(h.api) + '</span>' +
        '<button class="pin-btn' + (pinned ? ' pinned' : '') + '" data-pin-idx="' + i + '" title="' + (pinned ? 'Unpin' : 'Save request') + '">\u2606</button>' +
      '</div>' +
    '</div>'
  }).join('')

  els.historyList.onclick = (e) => {
    const pinBtn = e.target.closest('[data-pin-idx]')
    if (pinBtn) {
      const idx = parseInt(pinBtn.dataset.pinIdx, 10)
      const entry = history[idx]
      if (!entry) return
      const existingIdx = savedRequests.findIndex((s) => s.api === entry.api && s.method === entry.method && s.path === entry.path)
      if (existingIdx >= 0) {
        savedRequests.splice(existingIdx, 1)
      } else {
        savedRequests.unshift({ api: entry.api, method: entry.method, path: entry.path, name: entry.method + ' ' + entry.path })
      }
      persistSaved()
      renderSaved()
      renderHistory()
      return
    }
    const item = e.target.closest('[data-history-idx]')
    if (!item) return
    const idx = parseInt(item.dataset.historyIdx, 10)
    const entry = history[idx]
    if (!entry) return
    applyRequest(entry)
  }
}

function applyRequest(entry) {
  els.apiSelect.value = entry.api
  els.methodSelect.value = entry.method
  els.pathInput.value = entry.path
  updateMethodColor()
  updateBodyVisibility()
  const a = currentApi()
  if (a) {
    populatePresets(a)
    updateScopeHint(a)
  }
}

function renderSaved() {
  if (!savedRequests.length) {
    els.savedPanel.style.display = 'none'
    return
  }
  els.savedPanel.style.display = ''
  els.savedList.innerHTML = savedRequests.map((s, i) =>
    '<div class="saved-item" data-saved-idx="' + i + '">' +
      '<div class="saved-item-main">' +
        '<span class="history-method ' + esc(s.method.toLowerCase()) + '">' + esc(s.method) + '</span>' +
        '<span class="saved-item-name">' + esc(s.path) + '</span>' +
        '<span class="history-api">' + esc(s.api) + '</span>' +
      '</div>' +
      '<button class="pin-btn pinned" data-unsave-idx="' + i + '" title="Remove">\u2716</button>' +
    '</div>'
  ).join('')

  els.savedList.onclick = (e) => {
    const unsaveBtn = e.target.closest('[data-unsave-idx]')
    if (unsaveBtn) {
      savedRequests.splice(parseInt(unsaveBtn.dataset.unsaveIdx, 10), 1)
      persistSaved()
      renderSaved()
      renderHistory()
      return
    }
    const item = e.target.closest('[data-saved-idx]')
    if (!item) return
    const entry = savedRequests[parseInt(item.dataset.savedIdx, 10)]
    if (entry) applyRequest(entry)
  }
}
`;
}
