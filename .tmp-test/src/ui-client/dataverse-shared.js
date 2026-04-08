export function renderDataverseSharedModule() {
    return String.raw `
import { api, esc } from '/assets/ui/runtime.js'
import { ensureEntitiesLoaded, getDataverseState, toggleSelectedColumn } from '/assets/ui/state.js'

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
`;
}
