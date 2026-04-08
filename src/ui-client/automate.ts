export function renderAutomateModule(): string {
  return String.raw`
import { app, api, esc, getGlobalEnvironment, setBtnLoading, toast } from '/assets/ui/shared.js'

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
  flowRefresh: document.getElementById('flow-refresh'),
  flowOpenConsole: document.getElementById('flow-open-console')
}

let flows = []
let currentFlow = null
let flowsEnvironment = null

export function initAutomate() {
  els.flowFilter.addEventListener('input', renderFlowList)
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
      renderFlowList()
      renderFlowDetail()
      loadFlowRuns(f).catch(() => {})
    }
  }
}

function renderFlowDetail() {
  const runsPanel = document.getElementById('flow-runs-panel')
  if (!currentFlow) {
    els.flowDetailEmpty.classList.remove('hidden')
    els.flowDetail.classList.add('hidden')
    if (runsPanel) runsPanel.style.display = 'none'
    return
  }
  els.flowDetailEmpty.classList.add('hidden')
  els.flowDetail.classList.remove('hidden')
  if (runsPanel) runsPanel.style.display = ''

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
      body: JSON.stringify({ environment: env, api: 'flow', method: 'GET', path: '/flows/' + flow.name + '/runs?$top=10' })
    })
    const data = result.data && result.data.response
    const runs = (data && data.value) || []
    if (!runs.length) {
      els.flowRuns.innerHTML = '<div class="empty">No recent runs.</div>'
      return
    }
    els.flowRuns.innerHTML = runs.map(r => {
      const status = prop(r, 'properties.status') || 'Unknown'
      const startTime = prop(r, 'properties.startTime')
      const cls = status === 'Succeeded' ? 'ok' : status === 'Failed' ? 'error' : 'pending'
      return '<div class="run-item">' +
        '<span class="health-dot ' + cls + '"></span>' +
        '<span class="run-status">' + esc(status) + '</span>' +
        '<span class="run-time">' + esc(formatDate(startTime)) + '</span>' +
      '</div>'
    }).join('')
  } catch {
    els.flowRuns.innerHTML = '<div class="empty">Could not load runs.</div>'
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
`;
}
