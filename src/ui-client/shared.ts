export function renderSharedModule(): string {
  return String.raw`
export const app = {
  state: null,
  currentLoginJobId: null,
  entities: [],
  currentEntity: null,
  currentEntityDetail: null,
  currentRecordPreview: null,
  entitiesEnvironment: null
}

export const els = {
  lastResponse: null,
  meta: document.getElementById('meta'),
  toasts: document.getElementById('toasts'),
  globalEnv: document.getElementById('global-environment')
}

export function esc(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function pretty(value) {
  return JSON.stringify(value, null, 2)
}

export function toast(message, isError = false) {
  const el = document.createElement('div')
  el.className = 'toast' + (isError ? ' error' : ' ok')
  el.textContent = message
  els.toasts.appendChild(el)
  setTimeout(() => {
    el.classList.add('fade-out')
    el.addEventListener('animationend', () => el.remove())
  }, isError ? 5000 : 2500)
}

export function summarizeError(data) {
  if (data && Array.isArray(data.diagnostics) && data.diagnostics.length) {
    return data.diagnostics[0].message || 'Request failed'
  }
  return 'Request failed'
}

export async function api(path, options) {
  const response = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {}))
  const data = await response.json()
  if (!response.ok || data.success === false) {
    throw new Error(summarizeError(data))
  }
  return data
}

export function optionMarkup(values, emptyLabel) {
  const items = []
  if (emptyLabel !== undefined) items.push('<option value="">' + esc(emptyLabel) + '</option>')
  for (const value of values) items.push('<option value="' + esc(value) + '">' + esc(value) + '</option>')
  return items.join('')
}

export function formDataObject(form) {
  const data = {}
  const fd = new FormData(form)
  for (const [key, value] of fd.entries()) {
    if (typeof value === 'string' && value.trim() !== '') data[key] = value
  }
  for (const checkbox of form.querySelectorAll('input[type="checkbox"]')) {
    data[checkbox.name] = checkbox.checked
  }
  return data
}

export function setTab(tab) {
  for (const el of document.querySelectorAll('.tab')) el.classList.toggle('active', el.dataset.tab === tab)
  for (const el of document.querySelectorAll('.tab-panel')) el.classList.toggle('active', el.id === 'panel-' + tab)
  window.location.hash = tab
}

export function registerTabHandlers() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => setTab(tab.dataset.tab))
  }
  const hash = window.location.hash.slice(1)
  if (hash && document.getElementById('panel-' + hash)) setTab(hash)
}

export function applyAccountKindVisibility() {
  const kind = document.getElementById('account-kind').value
  const form = document.getElementById('account-form')
  form.querySelectorAll('.conditional').forEach((el) => {
    el.classList.toggle('visible', el.classList.contains('cond-' + kind))
  })
}

export function renderMeta(data) {
  const accounts = data.accounts || []
  const environments = data.environments || []
  els.meta.innerHTML =
    '<span>' + accounts.length + ' accounts</span>' +
    '<span>' + environments.length + ' environments</span>'
}

export function getGlobalEnvironment() {
  return els.globalEnv.value
}

export function setBtnLoading(btn, loading, label) {
  if (loading) {
    btn._origLabel = btn.textContent
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span>' + esc(label || btn._origLabel)
  } else {
    btn.disabled = false
    btn.textContent = btn._origLabel || label || ''
  }
}

export async function loadEntities(environment) {
  if (!environment) return
  if (app.entitiesEnvironment === environment && app.entities.length) return
  const payload = await api('/api/dv/entities?environment=' + encodeURIComponent(environment))
  app.entities = payload.data || []
  app.entitiesEnvironment = environment
  app.currentEntity = null
  app.currentEntityDetail = null
  app.currentRecordPreview = null
}

export function renderEntitySidebar(listEl, filterEl, onSelect) {
  const filter = (filterEl.value || '').toLowerCase()
  const filtered = filter
    ? app.entities.filter((e) => e.logicalName.includes(filter) || (e.displayName || '').toLowerCase().includes(filter) || (e.entitySetName || '').toLowerCase().includes(filter))
    : app.entities
  listEl.innerHTML = filtered.length
    ? filtered.map((e) => {
        const active = app.currentEntity && app.currentEntity.logicalName === e.logicalName ? ' active' : ''
        return '<div class="entity-item' + active + '" data-entity="' + esc(e.logicalName) + '">' +
          '<div class="entity-item-name">' + esc(e.displayName || e.logicalName) + '</div>' +
          '<div class="entity-item-logical">' + esc(e.logicalName) + '</div>' +
          (e.entitySetName ? '<div class="entity-item-set">' + esc(e.entitySetName) + '</div>' : '') +
        '</div>'
      }).join('')
    : '<div class="empty">No entities match.</div>'

  listEl.onclick = (event) => {
    const item = event.target.closest('[data-entity]')
    if (item) onSelect(item.dataset.entity)
  }
}

export function showLastResponse() {}

export function readSelectedValue(id, label) {
  const value = document.getElementById(id).value
  if (!value) throw new Error('Select ' + label + ' first.')
  return value
}
`;
}
