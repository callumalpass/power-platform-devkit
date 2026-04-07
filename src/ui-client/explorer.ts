export function renderExplorerModule(): string {
  return String.raw`
import { api, esc, pretty, readSelectedValue, setTab, toast } from '/assets/ui/shared.js'

const state = {
  entities: [],
  currentEntity: null,
  currentEntityDetail: null,
  currentRecordPreview: null
}

const els = {
  entityList: document.getElementById('entity-list'),
  entityTitle: document.getElementById('entity-title'),
  entitySubtitle: document.getElementById('entity-subtitle'),
  entityDetailEmpty: document.getElementById('entity-detail-empty'),
  entityDetail: document.getElementById('entity-detail'),
  entityMetrics: document.getElementById('entity-metrics'),
  attributeTable: document.getElementById('attribute-table'),
  recordPreviewEmpty: document.getElementById('record-preview-empty'),
  recordPreview: document.getElementById('record-preview'),
  recordPreviewPath: document.getElementById('record-preview-path'),
  recordPreviewJson: document.getElementById('record-preview-json'),
  explorerEnvironment: document.getElementById('explorer-environment'),
  entitySearch: document.getElementById('entity-search'),
  entityLoad: document.getElementById('entity-load'),
  entityClear: document.getElementById('entity-clear'),
  entityToQuery: document.getElementById('entity-to-query'),
  entityToFetchXml: document.getElementById('entity-to-fetchxml'),
  entityRefreshRecords: document.getElementById('entity-refresh-records')
}

export function initExplorer(actions) {
  els.entityLoad.addEventListener('click', () => loadEntities().catch((error) => toast(error.message, true)))
  els.entityClear.addEventListener('click', clearExplorer)
  els.entityToQuery.addEventListener('click', () => {
    if (!state.currentEntityDetail) return
    actions.useEntityInQuery(state.currentEntityDetail, els.explorerEnvironment.value)
    setTab('query')
  })
  els.entityToFetchXml.addEventListener('click', () => {
    if (!state.currentEntityDetail) return
    actions.useEntityInFetchXml(state.currentEntityDetail, els.explorerEnvironment.value)
    setTab('fetchxml')
  })
  els.entityRefreshRecords.addEventListener('click', () => loadRecordPreview().catch((error) => toast(error.message, true)))
  els.entityList.addEventListener('click', (event) => {
    const item = event.target.closest('[data-entity]')
    if (!item) return
    loadEntityDetail(item.dataset.entity).catch((error) => toast(error.message, true))
  })
}

export function onStateUpdated() {}

function clearExplorer() {
  state.entities = []
  state.currentEntity = null
  state.currentEntityDetail = null
  state.currentRecordPreview = null
  renderEntityList()
  renderEntityDetail()
  renderRecordPreview()
}

async function loadEntities() {
  const environment = readSelectedValue('explorer-environment', 'an environment')
  const search = els.entitySearch.value.trim()
  const query = '/api/dv/entities?environment=' + encodeURIComponent(environment) + (search ? '&search=' + encodeURIComponent(search) : '')
  const payload = await api(query)
  state.entities = payload.data || []
  state.currentEntity = null
  state.currentEntityDetail = null
  state.currentRecordPreview = null
  renderEntityList()
  renderEntityDetail()
  renderRecordPreview()
  toast('Loaded ' + state.entities.length + ' entities')
}

async function loadEntityDetail(logicalName) {
  const environment = readSelectedValue('explorer-environment', 'an environment')
  const payload = await api('/api/dv/entities/' + encodeURIComponent(logicalName) + '?environment=' + encodeURIComponent(environment))
  state.currentEntity = (state.entities || []).find((item) => item.logicalName === logicalName) || { logicalName }
  state.currentEntityDetail = payload.data
  renderEntityList()
  renderEntityDetail()
  await loadRecordPreview()
}

async function loadRecordPreview() {
  const detail = state.currentEntityDetail
  if (!detail || !detail.entitySetName) {
    state.currentRecordPreview = null
    renderRecordPreview()
    return
  }
  const environment = readSelectedValue('explorer-environment', 'an environment')
  const select = []
  if (detail.primaryIdAttribute) select.push(detail.primaryIdAttribute)
  if (detail.primaryNameAttribute && detail.primaryNameAttribute !== detail.primaryIdAttribute) select.push(detail.primaryNameAttribute)
  const readable = (detail.attributes || [])
    .filter((attribute) => attribute.isValidForRead !== false && !attribute.isPrimaryId && !attribute.isPrimaryName)
    .slice(0, 3)
  for (const attribute of readable) select.push(attribute.logicalName)
  const payload = await api('/api/dv/query/execute', {
    method: 'POST',
    body: JSON.stringify({
      environmentAlias: environment,
      entitySetName: detail.entitySetName,
      select,
      top: 5
    })
  })
  state.currentRecordPreview = payload.data
  renderRecordPreview()
}

function renderEntityList() {
  els.entityList.innerHTML = state.entities.length
    ? state.entities.map((entity) => {
        const active = state.currentEntity && state.currentEntity.logicalName === entity.logicalName ? ' active' : ''
        return '<div class="item' + active + '" data-entity="' + esc(entity.logicalName) + '">' +
          '<div class="item-title">' + esc(entity.displayName || entity.logicalName) + '</div>' +
          '<div class="mono-subtle">' + esc(entity.logicalName) + '</div>' +
          '<div class="pill-row">' +
          (entity.entitySetName ? '<span class="pill">' + esc(entity.entitySetName) + '</span>' : '') +
          (entity.primaryNameAttribute ? '<span class="pill">' + esc(entity.primaryNameAttribute) + '</span>' : '') +
          '</div>' +
        '</div>'
      }).join('')
    : '<div class="empty">No entities loaded.</div>'
}

function renderEntityDetail() {
  const detail = state.currentEntityDetail
  if (!detail) {
    els.entityTitle.textContent = 'Entity Detail'
    els.entitySubtitle.textContent = 'Choose an entity to inspect its metadata and preview records.'
    els.entityDetailEmpty.hidden = false
    els.entityDetail.hidden = true
    return
  }

  els.entityTitle.textContent = detail.displayName || detail.logicalName
  els.entitySubtitle.textContent = detail.description || detail.logicalName
  els.entityDetailEmpty.hidden = true
  els.entityDetail.hidden = false

  const metrics = [
    ['Logical Name', detail.logicalName],
    ['Entity Set', detail.entitySetName],
    ['Primary ID', detail.primaryIdAttribute],
    ['Primary Name', detail.primaryNameAttribute],
    ['Ownership', detail.ownershipType],
    ['Schema Name', detail.schemaName],
    ['Object Type Code', detail.objectTypeCode],
    ['Custom', detail.isCustomEntity],
    ['Audit', detail.isAuditEnabled],
    ['Change Tracking', detail.changeTrackingEnabled]
  ]
  els.entityMetrics.innerHTML = metrics.map((entry) => {
    return '<div class="metric"><div class="label">' + esc(entry[0]) + '</div><div class="value">' + esc(entry[1] == null ? '' : entry[1]) + '</div></div>'
  }).join('')

  els.attributeTable.innerHTML = detail.attributes.map((attribute) => {
    const flags = [
      attribute.isPrimaryId ? 'primary id' : '',
      attribute.isPrimaryName ? 'primary name' : '',
      attribute.isValidForRead === true ? 'read' : '',
      attribute.isValidForCreate === true ? 'create' : '',
      attribute.isValidForUpdate === true ? 'update' : '',
      attribute.isValidForAdvancedFind === true ? 'find' : '',
      attribute.isValidForSort === true ? 'sort' : ''
    ].filter(Boolean).join(', ')
    const targets = attribute.targets && attribute.targets.length ? attribute.targets.join(', ') : ''
    const options = attribute.optionValues && attribute.optionValues.length
      ? attribute.optionValues.slice(0, 6).map((opt) => String(opt.value) + ':' + (opt.label || '')).join(', ')
      : ''
    return '<tr>' +
      '<td><div><strong>' + esc(attribute.displayName || attribute.logicalName) + '</strong></div><code>' + esc(attribute.logicalName) + '</code></td>' +
      '<td>' + esc(attribute.attributeTypeName || attribute.attributeType || '') + '</td>' +
      '<td>' + esc(attribute.requiredLevel || '') + '</td>' +
      '<td>' + esc(flags) + '</td>' +
      '<td><code>' + esc(targets || options) + '</code></td>' +
    '</tr>'
  }).join('')
}

function renderRecordPreview() {
  if (!state.currentRecordPreview) {
    els.recordPreviewEmpty.hidden = false
    els.recordPreview.hidden = true
    return
  }
  els.recordPreviewEmpty.hidden = true
  els.recordPreview.hidden = false
  els.recordPreviewPath.textContent = state.currentRecordPreview.path || ''
  els.recordPreviewJson.textContent = pretty(state.currentRecordPreview.records || [])
}
`;
}
