export function renderPlatformModule() {
    return String.raw `
import { api, esc, getGlobalEnvironment, toast } from '/assets/ui/shared.js'

const els = {
  envList: document.getElementById('plat-env-list'),
  envFilter: document.getElementById('plat-env-filter'),
  envCount: document.getElementById('plat-env-count'),
  envDetailEmpty: document.getElementById('plat-env-detail-empty'),
  envDetail: document.getElementById('plat-env-detail'),
  envTitle: document.getElementById('plat-env-title'),
  envSubtitle: document.getElementById('plat-env-subtitle'),
  envMetrics: document.getElementById('plat-env-metrics'),
  envLinked: document.getElementById('plat-env-linked'),
  envRefresh: document.getElementById('plat-env-refresh'),
  envOpenConsole: document.getElementById('plat-env-open-console')
}

let environments = []
let currentEnv = null
let envLoaded = false

export function initPlatform() {
  els.envFilter.addEventListener('input', renderEnvList)
  els.envRefresh.addEventListener('click', () => {
    envLoaded = false
    loadPlatformEnvironments().then(() => toast('Environments refreshed')).catch(e => toast(e.message, true))
  })
  els.envOpenConsole.addEventListener('click', () => {
    if (!currentEnv) return
    window.dispatchEvent(new CustomEvent('pp:open-console', {
      detail: { api: 'bap', method: 'GET', path: '/environments/' + currentEnv.name }
    }))
  })
}

export async function loadPlatformEnvironments() {
  const env = getGlobalEnvironment()
  if (!env) return
  if (envLoaded) return
  envLoaded = true
  try {
    const result = await api('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({ environment: env, api: 'bap', method: 'GET', path: '/environments', allowInteractive: false })
    })
    const data = result.data && result.data.response
    environments = (data && data.value) || []
    currentEnv = null
    renderEnvList()
    renderEnvDetail()
  } catch (e) {
    environments = []
    currentEnv = null
    renderEnvList()
    renderEnvDetail()
    toast(e.message, true)
  }
}

export function resetPlatform() {
  envLoaded = false
  environments = []
  currentEnv = null
}

function renderEnvList() {
  const filter = (els.envFilter.value || '').toLowerCase()
  const filtered = filter
    ? environments.filter(e => {
        const name = prop(e, 'properties.displayName') || e.name || ''
        return name.toLowerCase().includes(filter) || (e.name || '').toLowerCase().includes(filter)
      })
    : environments

  els.envCount.textContent = environments.length ? environments.length + ' environments' : ''

  if (!environments.length) {
    els.envList.innerHTML = '<div class="entity-loading">Select an environment to discover platform environments.</div>'
    return
  }

  els.envList.innerHTML = filtered.length
    ? filtered.map(e => {
        const displayName = prop(e, 'properties.displayName') || e.name || 'Unnamed'
        const sku = prop(e, 'properties.environmentSku') || ''
        const isDefault = prop(e, 'properties.isDefault')
        const state = prop(e, 'properties.states.management.id') || ''
        const active = currentEnv && currentEnv.name === e.name ? ' active' : ''
        const stateCls = state === 'Ready' ? 'ok' : state === 'Deleting' ? 'error' : 'pending'
        const flags = []
        if (sku) flags.push('<span class="entity-item-flag">' + esc(sku.toLowerCase()) + '</span>')
        if (isDefault) flags.push('<span class="entity-item-set">default</span>')
        return '<div class="entity-item' + active + '" data-plat-env="' + esc(e.name) + '">' +
          '<div class="entity-item-name">' +
            '<span class="health-dot ' + stateCls + '" style="margin-right:6px"></span>' +
            esc(displayName) +
          '</div>' +
          '<div class="entity-item-logical">' + esc(e.name) + '</div>' +
          (flags.length ? '<div class="entity-item-badges">' + flags.join('') + '</div>' : '') +
        '</div>'
      }).join('')
    : '<div class="empty">No environments match.</div>'

  els.envList.onclick = (e) => {
    const item = e.target.closest('[data-plat-env]')
    if (!item) return
    const env = environments.find(en => en.name === item.dataset.platEnv)
    if (env) {
      currentEnv = env
      renderEnvList()
      renderEnvDetail()
    }
  }
}

function renderEnvDetail() {
  if (!currentEnv) {
    els.envDetailEmpty.classList.remove('hidden')
    els.envDetail.classList.add('hidden')
    return
  }
  els.envDetailEmpty.classList.add('hidden')
  els.envDetail.classList.remove('hidden')

  const p = currentEnv.properties || {}
  els.envTitle.textContent = p.displayName || currentEnv.name
  els.envSubtitle.textContent = currentEnv.name

  const linked = p.linkedEnvironmentMetadata || {}
  const metrics = [
    ['SKU', p.environmentSku || '-'],
    ['Location', currentEnv.location || '-'],
    ['State', prop(currentEnv, 'properties.states.management.id') || '-'],
    ['Default', p.isDefault ? 'Yes' : 'No'],
    ['Created', formatDate(p.createdTime)],
    ['Type', p.environmentType || currentEnv.type || '-']
  ]
  els.envMetrics.innerHTML = metrics.map(m =>
    '<div class="metric"><div class="metric-label">' + esc(m[0]) + '</div><div class="metric-value">' + esc(m[1]) + '</div></div>'
  ).join('')

  if (linked && (linked.instanceUrl || linked.domainName)) {
    els.envLinked.innerHTML =
      '<h3 style="font-size:0.8125rem;font-weight:600;margin-bottom:8px">Linked Dataverse</h3>' +
      '<div class="metrics">' +
        (linked.instanceUrl ? '<div class="metric"><div class="metric-label">Instance URL</div><div class="metric-value">' + esc(linked.instanceUrl) + '</div></div>' : '') +
        (linked.domainName ? '<div class="metric"><div class="metric-label">Domain</div><div class="metric-value">' + esc(linked.domainName) + '</div></div>' : '') +
        (linked.version ? '<div class="metric"><div class="metric-label">Version</div><div class="metric-value">' + esc(linked.version) + '</div></div>' : '') +
        (linked.baseLanguage ? '<div class="metric"><div class="metric-label">Language</div><div class="metric-value">' + esc(String(linked.baseLanguage)) + '</div></div>' : '') +
      '</div>'
  } else {
    els.envLinked.innerHTML = ''
  }
}

function prop(obj, path) {
  return path.split('.').reduce((o, k) => o && o[k], obj)
}

function formatDate(value) {
  if (!value) return '-'
  try {
    const d = new Date(value)
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return String(value) }
}
`;
}
