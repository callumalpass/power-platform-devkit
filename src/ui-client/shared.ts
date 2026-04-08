export function renderSharedModule(): string {
  return String.raw`
import {
  api,
  copyToClipboard,
  els,
  esc,
  formatBytes,
  formatTimeRemaining,
  formDataObject,
  getGlobalEnvironment,
  optionMarkup,
  pretty,
  renderMeta,
  setBtnLoading,
  showLoading,
  toast
} from '/assets/ui/runtime.js'
import { app, ensureEntitiesLoaded, getDataverseState, toggleSelectedColumn } from '/assets/ui/state.js'

export { api, app, copyToClipboard, els, esc, formatBytes, formatTimeRemaining, formDataObject, getGlobalEnvironment, optionMarkup, pretty, renderMeta, setBtnLoading, showLoading, toast }

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

export async function loadEntities(environment) {
  return ensureEntitiesLoaded(environment, async (targetEnvironment) => {
    const payload = await api('/api/dv/entities?environment=' + encodeURIComponent(targetEnvironment) + '&allowInteractive=false')
    return payload.data || []
  })
}

export function renderEntitySidebar(listEl, filterEl) {
  const dataverse = getDataverseState()
  const filter = (filterEl.value || '').toLowerCase()
  const filtered = filter
    ? dataverse.entities.filter((e) => e.logicalName.includes(filter) || (e.displayName || '').toLowerCase().includes(filter) || (e.entitySetName || '').toLowerCase().includes(filter))
    : dataverse.entities
  listEl.innerHTML = filtered.length
    ? filtered.map((e) => {
        const active = dataverse.currentEntity && dataverse.currentEntity.logicalName === e.logicalName ? ' active' : ''
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
  toggleSelectedColumn(logicalName)
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
  const dataverse = getDataverseState()
  if (!dataverse.selectedColumns.length) {
    containerEl.innerHTML = '<span class="selected-cols-label">Selected:</span><span style="color:var(--muted);font-size:0.75rem">Click attributes below to select columns</span>'
    return
  }
  containerEl.innerHTML =
    '<span class="selected-cols-label">Selected:</span>' +
    dataverse.selectedColumns.map((col) => '<span class="col-chip" data-remove-col="' + esc(col) + '">' + esc(col) + ' <span class="x">\u00d7</span></span>').join('') +
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

export function highlightJson(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (!raw) return ''
  return esc(raw)
    .replace(/"([^"\\\\]|\\\\.)*"\s*:/g, (m) => '<span class="json-key">' + m + '</span>')
    .replace(/:\s*"([^"\\\\]|\\\\.)*"/g, (m) => ': <span class="json-str">' + m.slice(m.indexOf('"')) + '</span>')
    .replace(/:\s*(-?\d+\.?\d*([eE][+-]?\d+)?)\b/g, (m, n) => ': <span class="json-num">' + n + '</span>')
    .replace(/:\s*(true|false)\b/g, (m, b) => ': <span class="json-bool">' + b + '</span>')
    .replace(/:\s*(null)\b/g, (m, n) => ': <span class="json-null">' + n + '</span>')
}

export function renderResultTable(records, entityLogicalName) {
  if (!Array.isArray(records) || !records.length) return ''
  const allKeys = []
  const seen = new Set()
  for (const row of records) {
    for (const key of Object.keys(row)) {
      if (key.startsWith('@odata') || key.startsWith('_') && key.endsWith('_value')) continue
      if (!seen.has(key)) { seen.add(key); allKeys.push(key) }
    }
  }
  if (!allKeys.length) return ''
  const head = '<thead><tr>' + allKeys.map((k) => '<th>' + esc(k) + '</th>').join('') + '</tr></thead>'
  const body = '<tbody>' + records.map((row) =>
    '<tr>' + allKeys.map((k) => {
      const val = row[k]
      const display = val == null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
      const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(display)
      const inner = isId && entityLogicalName
        ? '<span class="record-link" data-entity="' + esc(entityLogicalName) + '" data-id="' + esc(display) + '">' + esc(display) + '</span>'
        : esc(display)
      return '<td>' + inner + '</td>'
    }).join('') + '</tr>'
  ).join('') + '</tbody>'
  return '<div class="result-table-wrap"><table class="result-table">' + head + body + '</table></div>'
}

`;
}
