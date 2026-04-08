export function renderAppsModule(): string {
  return String.raw`
import { app, api, esc, getGlobalEnvironment, toast } from '/assets/ui/shared.js'

const els = {
  appList: document.getElementById('app-list'),
  appFilter: document.getElementById('app-filter'),
  appCount: document.getElementById('app-count'),
  appDetailEmpty: document.getElementById('app-detail-empty'),
  appDetail: document.getElementById('app-detail'),
  appTitle: document.getElementById('app-title'),
  appSubtitle: document.getElementById('app-subtitle'),
  appMetrics: document.getElementById('app-metrics'),
  appConnections: document.getElementById('app-connections'),
  appRefresh: document.getElementById('app-refresh'),
  appOpenConsole: document.getElementById('app-open-console')
}

let apps = []
let currentApp = null
let appsEnvironment = null

export function initApps() {
  els.appFilter.addEventListener('input', renderAppList)
  els.appRefresh.addEventListener('click', () => {
    appsEnvironment = null
    loadApps().then(() => toast('Apps refreshed')).catch(e => toast(e.message, true))
  })
  els.appOpenConsole.addEventListener('click', () => {
    if (!currentApp) return
    window.dispatchEvent(new CustomEvent('pp:open-console', {
      detail: { api: 'powerapps', method: 'GET', path: '/apps/' + currentApp.name }
    }))
  })
}

export async function loadApps() {
  const env = getGlobalEnvironment()
  if (!env) return
  if (env === appsEnvironment && apps.length) return
  appsEnvironment = env
  try {
    const result = await api('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({ environment: env, api: 'powerapps', method: 'GET', path: '/apps', allowInteractive: false })
    })
    const data = result.data && result.data.response
    apps = (data && data.value) || []
    currentApp = null
    renderAppList()
    renderAppDetail()
  } catch (e) {
    apps = []
    currentApp = null
    renderAppList()
    renderAppDetail()
    toast(e.message, true)
  }
}

export function resetApps() {
  appsEnvironment = null
  apps = []
  currentApp = null
}

function renderAppList() {
  const filter = (els.appFilter.value || '').toLowerCase()
  const filtered = filter
    ? apps.filter(a => {
        const name = prop(a, 'properties.displayName') || a.name || ''
        return name.toLowerCase().includes(filter)
      })
    : apps

  els.appCount.textContent = apps.length ? apps.length + ' apps' : ''

  if (!apps.length) {
    els.appList.innerHTML = '<div class="entity-loading">Select an environment to load apps.</div>'
    return
  }

  els.appList.innerHTML = filtered.length
    ? filtered.map(a => {
        const displayName = prop(a, 'properties.displayName') || a.name || 'Unnamed'
        const appType = prop(a, 'properties.appType') || ''
        const active = currentApp && currentApp.name === a.name ? ' active' : ''
        return '<div class="entity-item' + active + '" data-app="' + esc(a.name) + '">' +
          '<div class="entity-item-name">' + esc(displayName) + '</div>' +
          '<div class="entity-item-logical">' + esc(a.name) + '</div>' +
          (appType ? '<div class="entity-item-badges"><span class="entity-item-flag">' + esc(formatAppType(appType)) + '</span></div>' : '') +
        '</div>'
      }).join('')
    : '<div class="empty">No apps match.</div>'

  els.appList.onclick = (e) => {
    const item = e.target.closest('[data-app]')
    if (!item) return
    const a = apps.find(ap => ap.name === item.dataset.app)
    if (a) {
      currentApp = a
      renderAppList()
      renderAppDetail()
    }
  }
}

function renderAppDetail() {
  if (!currentApp) {
    els.appDetailEmpty.classList.remove('hidden')
    els.appDetail.classList.add('hidden')
    return
  }
  els.appDetailEmpty.classList.add('hidden')
  els.appDetail.classList.remove('hidden')

  const p = currentApp.properties || {}
  els.appTitle.textContent = p.displayName || currentApp.name
  els.appSubtitle.textContent = p.description || currentApp.name

  const owner = p.owner || p.createdBy || {}
  const metrics = [
    ['App Type', formatAppType(p.appType)],
    ['Created', formatDate(p.createdTime)],
    ['Modified', formatDate(p.lastModifiedTime)],
    ['Owner', owner.displayName || owner.email || owner.id || '-'],
    ['Published', formatDate(p.lastPublishTime)],
    ['App ID', currentApp.name]
  ]
  els.appMetrics.innerHTML = metrics.map(m =>
    '<div class="metric"><div class="metric-label">' + esc(m[0]) + '</div><div class="metric-value">' + esc(m[1]) + '</div></div>'
  ).join('')

  const refs = p.connectionReferences || p.embeddedApp && p.embeddedApp.connectionReferences || {}
  const connections = Object.entries(refs)
  if (connections.length) {
    els.appConnections.innerHTML =
      '<h3 style="font-size:0.8125rem;font-weight:600;margin-bottom:8px">Connections (' + connections.length + ')</h3>' +
      connections.map(([key, ref]) =>
        '<div class="card-item" style="padding:8px 10px">' +
          '<div class="card-item-info">' +
            '<div class="card-item-title">' + esc(ref.displayName || key) + '</div>' +
            '<div class="card-item-sub">' + esc(ref.id || '') + '</div>' +
          '</div>' +
        '</div>'
      ).join('')
  } else {
    els.appConnections.innerHTML = ''
  }
}

function formatAppType(type) {
  if (!type) return '-'
  return type
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^Canvas Classic App$/, 'Canvas')
    .replace(/^Model Driven App$/, 'Model-driven')
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
