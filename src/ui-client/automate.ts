export function renderAutomateModule(): string {
  return String.raw`
import { app, api, esc, getGlobalEnvironment, highlightJson, toast } from '/assets/ui/shared.js'

const els = {
  flowList: document.getElementById('flow-list'),
  flowFilter: document.getElementById('flow-filter'),
  flowCount: document.getElementById('flow-count'),
  flowDetailEmpty: document.getElementById('flow-detail-empty'),
  flowDetail: document.getElementById('flow-detail'),
  flowTitle: document.getElementById('flow-title'),
  flowSubtitle: document.getElementById('flow-subtitle'),
  flowMetrics: document.getElementById('flow-metrics'),
  flowRuns: document.getElementById('flow-runs'),
  flowRunFilter: document.getElementById('flow-run-filter'),
  flowRunStatusFilter: document.getElementById('flow-run-status-filter'),
  flowRunsPanel: document.getElementById('flow-runs-panel'),
  flowActionsPanel: document.getElementById('flow-actions-panel'),
  flowRunSummary: document.getElementById('flow-run-summary'),
  flowActions: document.getElementById('flow-actions'),
  flowActionFilter: document.getElementById('flow-action-filter'),
  flowActionStatusFilter: document.getElementById('flow-action-status-filter'),
  flowActionsBack: document.getElementById('flow-actions-back'),
  flowActionDetailPanel: document.getElementById('flow-action-detail-panel'),
  flowActionTitle: document.getElementById('flow-action-title'),
  flowActionMetrics: document.getElementById('flow-action-metrics'),
  flowActionIo: document.getElementById('flow-action-io'),
  flowActionBack: document.getElementById('flow-action-back'),
  flowRefresh: document.getElementById('flow-refresh'),
  flowOpenConsole: document.getElementById('flow-open-console')
}

let flows = []
let currentFlow = null
let flowsEnvironment = null
let currentRuns = []
let currentRun = null
let currentActions = []
let currentAction = null

export function initAutomate() {
  els.flowFilter.addEventListener('input', renderFlowList)
  els.flowRunFilter.addEventListener('input', renderRuns)
  els.flowRunStatusFilter.addEventListener('change', renderRuns)
  els.flowActionFilter.addEventListener('input', renderActions)
  els.flowActionStatusFilter.addEventListener('change', renderActions)
  els.flowRefresh.addEventListener('click', () => {
    flowsEnvironment = null
    loadFlows().then(() => toast('Flows refreshed')).catch(e => toast(e.message, true))
  })
  els.flowOpenConsole.addEventListener('click', () => {
    if (!currentFlow) return
    window.dispatchEvent(new CustomEvent('pp:open-console', {
      detail: { api: 'flow', method: 'GET', path: '/flows/' + currentFlow.name }
    }))
  })
  els.flowActionsBack.addEventListener('click', () => {
    currentRun = null
    currentActions = []
    currentAction = null
    showView('runs')
  })
  els.flowActionBack.addEventListener('click', () => {
    currentAction = null
    showView('actions')
  })
}

function showView(view) {
  els.flowRunsPanel.style.display = view === 'runs' ? '' : 'none'
  els.flowActionsPanel.style.display = view === 'actions' ? '' : 'none'
  els.flowActionDetailPanel.style.display = view === 'action-detail' ? '' : 'none'
}

export async function loadFlows() {
  const env = getGlobalEnvironment()
  if (!env) return
  if (env === flowsEnvironment && flows.length) return
  flowsEnvironment = env
  try {
    const result = await api('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({ environment: env, api: 'flow', method: 'GET', path: '/flows', allowInteractive: false })
    })
    const data = result.data && result.data.response
    flows = (data && data.value) || []
    currentFlow = null
    currentRun = null
    currentActions = []
    currentAction = null
    renderFlowList()
    renderFlowDetail()
  } catch (e) {
    flows = []
    currentFlow = null
    renderFlowList()
    renderFlowDetail()
    toast(e.message, true)
  }
}

export function resetFlows() {
  flowsEnvironment = null
  flows = []
  currentFlow = null
  currentRun = null
  currentActions = []
  currentAction = null
}

function renderFlowList() {
  const filter = (els.flowFilter.value || '').toLowerCase()
  const filtered = filter
    ? flows.filter(f => {
        const name = prop(f, 'properties.displayName') || f.name || ''
        return name.toLowerCase().includes(filter)
      })
    : flows

  els.flowCount.textContent = flows.length ? flows.length + ' flows' : ''

  if (!flows.length) {
    els.flowList.innerHTML = '<div class="entity-loading">Select an environment to load flows.</div>'
    return
  }

  els.flowList.innerHTML = filtered.length
    ? filtered.map(f => {
        const displayName = prop(f, 'properties.displayName') || f.name || 'Unnamed'
        const state = prop(f, 'properties.state') || ''
        const active = currentFlow && currentFlow.name === f.name ? ' active' : ''
        const stateCls = state === 'Started' ? 'ok' : state === 'Stopped' ? 'error' : 'pending'
        return '<div class="entity-item' + active + '" data-flow="' + esc(f.name) + '">' +
          '<div class="entity-item-name">' +
            '<span class="health-dot ' + stateCls + '" style="margin-right:6px"></span>' +
            esc(displayName) +
          '</div>' +
          '<div class="entity-item-logical">' + esc(f.name) + '</div>' +
          (state ? '<div class="entity-item-badges"><span class="entity-item-flag">' + esc(state.toLowerCase()) + '</span></div>' : '') +
        '</div>'
      }).join('')
    : '<div class="empty">No flows match.</div>'

  els.flowList.onclick = (e) => {
    const item = e.target.closest('[data-flow]')
    if (!item) return
    const f = flows.find(fl => fl.name === item.dataset.flow)
    if (f) {
      currentFlow = f
      currentRun = null
      currentActions = []
      currentAction = null
      renderFlowList()
      renderFlowDetail()
      showView('runs')
      loadFlowRuns(f).catch(() => {})
    }
  }
}

function renderFlowDetail() {
  if (!currentFlow) {
    els.flowDetailEmpty.classList.remove('hidden')
    els.flowDetail.classList.add('hidden')
    els.flowRunsPanel.style.display = 'none'
    els.flowActionsPanel.style.display = 'none'
    els.flowActionDetailPanel.style.display = 'none'
    return
  }
  els.flowDetailEmpty.classList.add('hidden')
  els.flowDetail.classList.remove('hidden')
  els.flowRunsPanel.style.display = ''

  const p = currentFlow.properties || {}
  els.flowTitle.textContent = p.displayName || currentFlow.name
  els.flowSubtitle.textContent = p.description || currentFlow.name

  const metrics = [
    ['State', p.state || '-'],
    ['Created', formatDate(p.createdTime)],
    ['Modified', formatDate(p.lastModifiedTime)],
    ['Creator', prop(currentFlow, 'properties.creator.objectId') || '-'],
    ['Trigger', prop(currentFlow, 'properties.definitionSummary.triggers.0.type') || '-'],
    ['Actions', (prop(currentFlow, 'properties.definitionSummary.actions') || []).length || '-']
  ]
  els.flowMetrics.innerHTML = metrics.map(m =>
    '<div class="metric"><div class="metric-label">' + esc(m[0]) + '</div><div class="metric-value">' + esc(m[1]) + '</div></div>'
  ).join('')
}

async function loadFlowRuns(flow) {
  const env = getGlobalEnvironment()
  if (!env) return
  els.flowRuns.innerHTML = '<div class="empty">Loading runs\u2026</div>'
  try {
    const result = await api('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({ environment: env, api: 'flow', method: 'GET', path: '/flows/' + flow.name + '/runs?$top=20' })
    })
    const data = result.data && result.data.response
    currentRuns = (data && data.value) || []
    renderRuns()
  } catch {
    currentRuns = []
    els.flowRuns.innerHTML = '<div class="empty">Could not load runs.</div>'
  }
}

function renderRuns() {
  if (!currentRuns.length) {
    els.flowRuns.innerHTML = '<div class="empty">No recent runs.</div>'
    return
  }
  const textFilter = (els.flowRunFilter.value || '').toLowerCase().trim()
  const statusFilter = els.flowRunStatusFilter.value || ''
  const filteredRuns = currentRuns
    .map((run, index) => ({ run, index }))
    .filter(({ run }) => {
      const status = prop(run, 'properties.status') || ''
      const trigger = prop(run, 'properties.trigger.name') || ''
      const haystack = [run.name || '', status, trigger].join(' ').toLowerCase()
      return (!statusFilter || status === statusFilter) && (!textFilter || haystack.includes(textFilter))
    })
    .sort((a, b) => statusRank(prop(a.run, 'properties.status')) - statusRank(prop(b.run, 'properties.status')))

  if (!filteredRuns.length) {
    els.flowRuns.innerHTML = '<div class="empty">No runs match the current filters.</div>'
    return
  }

  els.flowRuns.innerHTML = filteredRuns.map(({ run: r, index: i }) => {
    const status = prop(r, 'properties.status') || 'Unknown'
    const startTime = prop(r, 'properties.startTime')
    const endTime = prop(r, 'properties.endTime')
    const trigger = prop(r, 'properties.trigger.name') || ''
    const cls = status === 'Succeeded' ? 'ok' : status === 'Failed' ? 'error' : status === 'Running' ? 'pending' : 'pending'
    const active = currentRun && currentRun.name === r.name ? ' active' : ''
    const duration = startTime && endTime ? formatDuration(new Date(startTime), new Date(endTime)) : ''
    return '<div class="run-item' + active + '" data-run-idx="' + i + '">' +
      '<div class="run-main">' +
        '<span class="health-dot ' + cls + '"></span>' +
        '<div class="run-text">' +
          '<div class="run-status">' + esc(status) + '</div>' +
          '<div class="run-sub">' +
            (trigger ? '<span class="action-item-type">' + esc(trigger) + '</span>' : '') +
            (duration ? '<span class="run-duration">' + esc(duration) + '</span>' : '') +
            (r.name ? '<span class="action-item-type">' + esc(shortId(r.name)) + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<span class="run-time">' + esc(formatDate(startTime)) + '</span>' +
    '</div>'
  }).join('')

  els.flowRuns.onclick = (e) => {
    const item = e.target.closest('[data-run-idx]')
    if (!item) return
    const idx = parseInt(item.dataset.runIdx, 10)
    const run = currentRuns[idx]
    if (run) {
      currentRun = run
      renderRuns()
      loadRunActions(run).catch(() => {})
    }
  }
}

async function loadRunActions(run) {
  if (!currentFlow) return
  const env = getGlobalEnvironment()
  if (!env) return

  showView('actions')

  const status = prop(run, 'properties.status') || 'Unknown'
  const startTime = prop(run, 'properties.startTime')
  const endTime = prop(run, 'properties.endTime')
  const duration = startTime && endTime ? formatDuration(new Date(startTime), new Date(endTime)) : '-'
  const statusCls = status === 'Succeeded' ? 'ok' : status === 'Failed' ? 'error' : 'pending'
  els.flowRunSummary.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">' +
      '<span class="health-dot ' + statusCls + '"></span>' +
      '<strong style="font-size:0.8125rem">' + esc(status) + '</strong>' +
      '<span style="font-size:0.75rem;color:var(--muted)">' + esc(formatDate(startTime)) + '</span>' +
      '<span class="run-duration">' + esc(duration) + '</span>' +
    '</div>' +
    '<div class="run-summary-grid">' +
      summaryCard('Run ID', run.name || '-') +
      summaryCard('Trigger', prop(run, 'properties.trigger.name') || '-') +
      summaryCard('Started', formatDate(startTime)) +
      summaryCard('Ended', formatDate(endTime)) +
    '</div>'

  els.flowActions.innerHTML = '<div class="empty">Loading actions\u2026</div>'

  try {
    const result = await api('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({ environment: env, api: 'flow', method: 'GET', path: '/flows/' + currentFlow.name + '/runs/' + run.name + '/actions' })
    })
    const data = result.data && result.data.response
    currentActions = (data && data.value) || []
    renderActions()
  } catch {
    currentActions = []
    els.flowActions.innerHTML = '<div class="empty">Could not load actions.</div>'
  }
}

function renderActions() {
  if (!currentActions.length) {
    els.flowActions.innerHTML = '<div class="empty">No actions in this run.</div>'
    return
  }
  const textFilter = (els.flowActionFilter.value || '').toLowerCase().trim()
  const statusFilter = els.flowActionStatusFilter.value || ''
  const filteredActions = currentActions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => {
      const name = action.name || ''
      const status = prop(action, 'properties.status') || ''
      const type = prop(action, 'properties.type') || ''
      const code = prop(action, 'properties.code') || ''
      const haystack = [name, status, type, code].join(' ').toLowerCase()
      return (!statusFilter || status === statusFilter) && (!textFilter || haystack.includes(textFilter))
    })
    .sort((a, b) => statusRank(prop(a.action, 'properties.status')) - statusRank(prop(b.action, 'properties.status')))

  if (!filteredActions.length) {
    els.flowActions.innerHTML = '<div class="empty">No actions match the current filters.</div>'
    return
  }

  const counts = summarizeActionCounts(currentActions)
  els.flowActions.innerHTML =
    '<div class="run-summary-grid" style="margin-bottom:12px">' +
      summaryCard('Actions', String(currentActions.length)) +
      summaryCard('Failed', String(counts.Failed || 0)) +
      summaryCard('Running', String(counts.Running || 0)) +
      summaryCard('Succeeded', String(counts.Succeeded || 0)) +
    '</div>' +
    filteredActions.map(({ action: a, index: i }) => {
    const name = a.name || 'Unknown'
    const status = prop(a, 'properties.status') || 'Unknown'
    const type = prop(a, 'properties.type') || ''
    const startTime = prop(a, 'properties.startTime')
    const endTime = prop(a, 'properties.endTime')
    const cls = status === 'Succeeded' ? 'ok' : status === 'Failed' ? 'error' : status === 'Skipped' ? 'pending' : 'pending'
    const active = currentAction && currentAction.name === a.name ? ' active' : ''
    const duration = startTime && endTime ? formatDuration(new Date(startTime), new Date(endTime)) : ''
    const code = prop(a, 'properties.code') || ''
    return '<div class="action-item' + active + '" data-action-idx="' + i + '">' +
      '<span class="health-dot ' + cls + '"></span>' +
      '<span class="action-item-name" title="' + esc(name) + '">' + esc(name) + '</span>' +
      '<div class="action-item-meta">' +
        '<span class="action-item-type">' + esc(status) + '</span>' +
        (type ? '<span class="action-item-type">' + esc(type) + '</span>' : '') +
        (code && code !== status ? '<span class="action-item-type">' + esc(code) + '</span>' : '') +
        (duration ? '<span class="run-duration">' + esc(duration) + '</span>' : '') +
      '</div>' +
    '</div>'
  }).join('')

  els.flowActions.onclick = (e) => {
    const item = e.target.closest('[data-action-idx]')
    if (!item) return
    const idx = parseInt(item.dataset.actionIdx, 10)
    const action = currentActions[idx]
    if (action) {
      currentAction = action
      renderActions()
      loadActionDetail(action).catch(() => {})
    }
  }
}

async function loadActionDetail(action) {
  if (!currentFlow || !currentRun) return
  const env = getGlobalEnvironment()
  if (!env) return

  showView('action-detail')
  els.flowActionTitle.textContent = action.name || 'Action Detail'

  const status = prop(action, 'properties.status') || '-'
  const type = prop(action, 'properties.type') || '-'
  const code = prop(action, 'properties.code') || '-'
  const startTime = prop(action, 'properties.startTime')
  const endTime = prop(action, 'properties.endTime')
  const duration = startTime && endTime ? formatDuration(new Date(startTime), new Date(endTime)) : '-'
  const error = prop(action, 'properties.error')

  const metrics = [
    ['Status', status],
    ['Type', type],
    ['Code', code],
    ['Started', formatDate(startTime)],
    ['Duration', duration]
  ]
  els.flowActionMetrics.innerHTML = metrics.map(m =>
    '<div class="metric"><div class="metric-label">' + esc(m[0]) + '</div><div class="metric-value">' + esc(m[1]) + '</div></div>'
  ).join('')

  // Try to load full action detail with inputs/outputs
  els.flowActionIo.innerHTML = '<div class="empty">Loading inputs and outputs\u2026</div>'

  try {
    const result = await api('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({
        environment: env,
        api: 'flow',
        method: 'GET',
        path: '/flows/' + currentFlow.name + '/runs/' + currentRun.name + '/actions/' + action.name
      })
    })
    const detail = result.data && result.data.response
    const inputs = prop(detail, 'properties.inputsLink')
    const outputs = prop(detail, 'properties.outputsLink')
    const inlineInputs = prop(detail, 'properties.inputs')
    const inlineOutputs = prop(detail, 'properties.outputs')
    const errorDetail = prop(detail, 'properties.error')

    let html = ''

    if (errorDetail) {
      html += '<div class="action-io-section">' +
        '<h3>Error</h3>' +
        '<pre class="viewer" style="border-left:3px solid var(--danger)">' + highlightJson(errorDetail) + '</pre>' +
      '</div>'
    }

    if (inlineInputs !== undefined && inlineInputs !== null) {
      html += '<div class="action-io-section">' +
        '<h3>Inputs</h3>' +
        '<pre class="viewer">' + highlightJson(inlineInputs) + '</pre>' +
      '</div>'
    } else if (inputs && inputs.uri) {
      html += '<div class="action-io-section">' +
        '<h3>Inputs</h3>' +
        '<div style="margin-bottom:8px"><button class="btn btn-secondary" data-fetch-link="input" data-link-uri="' + esc(inputs.uri) + '" style="font-size:0.75rem;padding:5px 12px">Fetch inputs</button></div>' +
        '<pre class="viewer" id="action-input-content" style="display:none"></pre>' +
      '</div>'
    }

    if (inlineOutputs !== undefined && inlineOutputs !== null) {
      html += '<div class="action-io-section">' +
        '<h3>Outputs</h3>' +
        '<pre class="viewer">' + highlightJson(inlineOutputs) + '</pre>' +
      '</div>'
    } else if (outputs && outputs.uri) {
      html += '<div class="action-io-section">' +
        '<h3>Outputs</h3>' +
        '<div style="margin-bottom:8px"><button class="btn btn-secondary" data-fetch-link="output" data-link-uri="' + esc(outputs.uri) + '" style="font-size:0.75rem;padding:5px 12px">Fetch outputs</button></div>' +
        '<pre class="viewer" id="action-output-content" style="display:none"></pre>' +
      '</div>'
    }

    if (!html && !errorDetail) {
      // Show raw properties if no structured I/O
      const rawProps = prop(detail, 'properties')
      html = '<div class="action-io-section">' +
        '<h3>Properties</h3>' +
        '<pre class="viewer">' + highlightJson(rawProps) + '</pre>' +
      '</div>'
    }

    els.flowActionIo.innerHTML = html || '<div class="empty">No input/output data available.</div>'

    // Wire up fetch buttons for linked content
    els.flowActionIo.querySelectorAll('[data-fetch-link]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uri = btn.dataset.linkUri
        const kind = btn.dataset.fetchLink
        const contentEl = document.getElementById('action-' + kind + '-content')
        btn.textContent = 'Loading\u2026'
        btn.disabled = true
        try {
          const resp = await fetch(uri)
          const text = await resp.text()
          let parsed
          try { parsed = JSON.parse(text) } catch { parsed = text }
          if (contentEl) {
            contentEl.innerHTML = highlightJson(parsed)
            contentEl.style.display = ''
          }
          btn.textContent = 'Fetched'
        } catch (err) {
          if (contentEl) {
            contentEl.textContent = 'Failed to fetch: ' + (err.message || err)
            contentEl.style.display = ''
          }
          btn.textContent = 'Failed'
        }
      })
    })

  } catch {
    // Fall back to inline properties from the action list item
    const inlineInputs = prop(action, 'properties.inputs')
    const inlineOutputs = prop(action, 'properties.outputs')
    let html = ''
    if (error) {
      html += '<div class="action-io-section"><h3>Error</h3><pre class="viewer" style="border-left:3px solid var(--danger)">' + highlightJson(error) + '</pre></div>'
    }
    if (inlineInputs) {
      html += '<div class="action-io-section"><h3>Inputs</h3><pre class="viewer">' + highlightJson(inlineInputs) + '</pre></div>'
    }
    if (inlineOutputs) {
      html += '<div class="action-io-section"><h3>Outputs</h3><pre class="viewer">' + highlightJson(inlineOutputs) + '</pre></div>'
    }
    els.flowActionIo.innerHTML = html || '<div class="empty">Could not load action detail.</div>'
  }
}

function prop(obj, path) {
  return path.split('.').reduce((o, k) => o && o[k], obj)
}

function formatDate(value) {
  if (!value) return '-'
  try {
    const d = new Date(value)
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch { return String(value) }
}

function formatDuration(start, end) {
  const ms = end - start
  if (ms < 0) return '-'
  if (ms < 1000) return ms + 'ms'
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return secs + 's'
  const mins = Math.floor(secs / 60)
  const remainSecs = secs % 60
  if (mins < 60) return mins + 'm ' + remainSecs + 's'
  const hours = Math.floor(mins / 60)
  return hours + 'h ' + (mins % 60) + 'm'
}

function statusRank(status) {
  switch (status) {
    case 'Failed': return 0
    case 'Running': return 1
    case 'Cancelled': return 2
    case 'Skipped': return 3
    case 'Succeeded': return 4
    default: return 5
  }
}

function summarizeActionCounts(actions) {
  const counts = {}
  for (const action of actions) {
    const status = prop(action, 'properties.status') || 'Unknown'
    counts[status] = (counts[status] || 0) + 1
  }
  return counts
}

function summaryCard(label, value) {
  return '<div class="run-summary-card"><div class="run-summary-card-label">' + esc(label) + '</div><div class="run-summary-card-value">' + esc(value) + '</div></div>'
}

function shortId(value) {
  const text = String(value || '')
  return text.length > 12 ? text.slice(0, 8) + '…' + text.slice(-4) : text
}
`;
}
