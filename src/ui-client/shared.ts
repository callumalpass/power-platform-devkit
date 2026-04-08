export function renderSharedModule(): string {
  return String.raw`
export const app = {
  state: null,
  currentLoginJobId: null,
  entities: [],
  currentEntity: null,
  currentEntityDetail: null,
  currentRecordPreview: null,
  entitiesEnvironment: null,
  selectedColumns: []
}

export const els = {
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
    '<span>' + environments.length + ' envs</span>'
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
  const payload = await api('/api/dv/entities?environment=' + encodeURIComponent(environment) + '&allowInteractive=false')
  app.entities = payload.data || []
  app.entitiesEnvironment = environment
  app.currentEntity = null
  app.currentEntityDetail = null
  app.currentRecordPreview = null
  app.selectedColumns = []
}

export function renderEntitySidebar(listEl, filterEl) {
  const filter = (filterEl.value || '').toLowerCase()
  const filtered = filter
    ? app.entities.filter((e) => e.logicalName.includes(filter) || (e.displayName || '').toLowerCase().includes(filter) || (e.entitySetName || '').toLowerCase().includes(filter))
    : app.entities
  listEl.innerHTML = filtered.length
    ? filtered.map((e) => {
        const active = app.currentEntity && app.currentEntity.logicalName === e.logicalName ? ' active' : ''
        const flags = []
        if (e.isCustomEntity) flags.push('<span class="entity-item-flag">custom</span>')
        if (e.isActivity) flags.push('<span class="entity-item-flag">activity</span>')
        return '<div class="entity-item' + active + '" data-entity="' + esc(e.logicalName) + '">' +
          '<div class="entity-item-name">' + esc(e.displayName || e.logicalName) + '</div>' +
          '<div class="entity-item-logical">' + esc(e.logicalName) + '</div>' +
          '<div class="entity-item-badges">' +
          (e.entitySetName ? '<span class="entity-item-set">' + esc(e.entitySetName) + '</span>' : '') +
          flags.join('') +
          '</div>' +
        '</div>'
      }).join('')
    : '<div class="empty">No entities match.</div>'
}

export function toggleColumn(logicalName) {
  const idx = app.selectedColumns.indexOf(logicalName)
  if (idx >= 0) app.selectedColumns.splice(idx, 1)
  else app.selectedColumns.push(logicalName)
}

export function isSelectableAttribute(attribute) {
  if (!attribute || !attribute.logicalName) return false
  if (attribute.attributeOf) return false
  if (attribute.isValidForRead === false) return false
  const typeName = String(attribute.attributeTypeName || attribute.attributeType || '').toLowerCase()
  return ![
    'partylisttype',
    'virtualtype',
    'entitynametype',
    'managedpropertytype',
    'image',
    'filetype',
    'multiselectpicklisttype'
  ].includes(typeName)
}

export function getSelectableAttributes(detail) {
  return (detail && Array.isArray(detail.attributes) ? detail.attributes : []).filter(isSelectableAttribute)
}

export function getDefaultSelectedColumns(detail, extraCount = 3) {
  if (!detail) return []
  const selectable = getSelectableAttributes(detail)
  const byName = new Map(selectable.map((attribute) => [attribute.logicalName, attribute]))
  const cols = []
  if (detail.primaryIdAttribute && byName.has(detail.primaryIdAttribute)) cols.push(detail.primaryIdAttribute)
  if (detail.primaryNameAttribute && detail.primaryNameAttribute !== detail.primaryIdAttribute && byName.has(detail.primaryNameAttribute)) {
    cols.push(detail.primaryNameAttribute)
  }
  for (const attribute of selectable) {
    if (attribute.isPrimaryId || attribute.isPrimaryName) continue
    if (cols.includes(attribute.logicalName)) continue
    cols.push(attribute.logicalName)
    if (cols.length >= extraCount + (detail.primaryIdAttribute && byName.has(detail.primaryIdAttribute) ? 1 : 0) + (detail.primaryNameAttribute && detail.primaryNameAttribute !== detail.primaryIdAttribute && byName.has(detail.primaryNameAttribute) ? 1 : 0)) {
      break
    }
  }
  return cols
}

export function renderSelectedColumns(containerEl) {
  if (!app.selectedColumns.length) {
    containerEl.innerHTML = '<span class="selected-cols-label">Selected:</span><span style="color:var(--muted);font-size:0.75rem">Click attributes below to select columns</span>'
    return
  }
  containerEl.innerHTML =
    '<span class="selected-cols-label">Selected:</span>' +
    app.selectedColumns.map((col) => '<span class="col-chip" data-remove-col="' + esc(col) + '">' + esc(col) + ' <span class="x">\u00d7</span></span>').join('') +
    '<button class="btn btn-ghost" style="padding:2px 8px;font-size:0.6875rem" data-action="clear-cols">Clear all</button>'
}

export function showLastResponse() {}

export function readSelectedValue(id, label) {
  const value = document.getElementById(id).value
  if (!value) throw new Error('Select ' + label + ' first.')
  return value
}

export function registerSubTabs(containerEl) {
  containerEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.sub-tab')
    if (!tab) return
    const parent = tab.closest('.panel')
    parent.querySelectorAll('.sub-tab').forEach((t) => t.classList.toggle('active', t === tab))
    parent.querySelectorAll('.sub-panel').forEach((p) => p.classList.toggle('active', p.id === 'subpanel-' + tab.dataset.subtab))
  })
}

export function updateEntityContext(contextEl, detail) {
  if (!detail) {
    contextEl.innerHTML = '<span class="entity-context-empty">No entity selected \u2014 pick one in Explorer or type below</span>'
    return
  }
  contextEl.innerHTML =
    '<span class="entity-context-name">' + esc(detail.displayName || detail.logicalName) + '</span>' +
    (detail.entitySetName ? '<span class="entity-context-set">' + esc(detail.entitySetName) + '</span>' : '')
}
`;
}
