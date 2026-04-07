export function renderExplorerModule(): string {
  return String.raw`
import { app, api, esc, pretty, getGlobalEnvironment, renderEntitySidebar, setTab, toast } from '/assets/ui/shared.js'

const els = {
  entityList: document.getElementById('entity-list'),
  entityFilter: document.getElementById('entity-filter'),
  entityCount: document.getElementById('entity-count'),
  entityLoading: document.getElementById('entity-loading'),
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
  entityToQuery: document.getElementById('entity-to-query'),
  entityToFetchXml: document.getElementById('entity-to-fetchxml'),
  entityRefreshRecords: document.getElementById('entity-refresh-records')
}

let actions = {}

export function initExplorer(a) {
  actions = a

  els.entityFilter.addEventListener('input', renderExplorerEntities)

  els.entityToQuery.addEventListener('click', () => {
    if (!app.currentEntityDetail) return
    actions.useEntityInQuery(app.currentEntityDetail, getGlobalEnvironment())
    setTab('query')
  })
  els.entityToFetchXml.addEventListener('click', () => {
    if (!app.currentEntityDetail) return
    actions.useEntityInFetchXml(app.currentEntityDetail, getGlobalEnvironment())
    setTab('fetchxml')
  })
  els.entityRefreshRecords.addEventListener('click', () => loadRecordPreview().catch((e) => toast(e.message, true)))
}

export function renderExplorerEntities() {
  if (!app.entities.length) {
    els.entityList.innerHTML = '<div class="entity-loading">Select an environment to load entities.</div>'
    els.entityCount.textContent = ''
    return
  }
  els.entityCount.textContent = app.entities.length + ' entities'
  renderEntitySidebar(els.entityList, els.entityFilter, (logicalName) => {
    loadEntityDetail(logicalName).catch((e) => toast(e.message, true))
  })
}

async function loadEntityDetail(logicalName) {
  const environment = getGlobalEnvironment()
  if (!environment) throw new Error('Select an environment first.')
  const payload = await api('/api/dv/entities/' + encodeURIComponent(logicalName) + '?environment=' + encodeURIComponent(environment))
  app.currentEntity = app.entities.find((e) => e.logicalName === logicalName) || { logicalName }
  app.currentEntityDetail = payload.data
  renderExplorerEntities()
  renderEntityDetail()
  await loadRecordPreview()
}

async function loadRecordPreview() {
  const detail = app.currentEntityDetail
  if (!detail || !detail.entitySetName) {
    app.currentRecordPreview = null
    renderRecordPreview()
    return
  }
  const environment = getGlobalEnvironment()
  const select = []
  if (detail.primaryIdAttribute) select.push(detail.primaryIdAttribute)
  if (detail.primaryNameAttribute && detail.primaryNameAttribute !== detail.primaryIdAttribute) select.push(detail.primaryNameAttribute)
  const readable = (detail.attributes || [])
    .filter((a) => a.isValidForRead !== false && !a.isPrimaryId && !a.isPrimaryName)
    .slice(0, 3)
  for (const a of readable) select.push(a.logicalName)
  const payload = await api('/api/dv/query/execute', {
    method: 'POST',
    body: JSON.stringify({ environmentAlias: environment, entitySetName: detail.entitySetName, select, top: 5 })
  })
  app.currentRecordPreview = payload.data
  renderRecordPreview()
}

function renderEntityDetail() {
  const detail = app.currentEntityDetail
  if (!detail) {
    els.entityTitle.textContent = 'Entity Detail'
    els.entitySubtitle.textContent = 'Select an entity from the list to inspect its metadata.'
    els.entityDetailEmpty.classList.remove('hidden')
    els.entityDetailEmpty.style.display = ''
    els.entityDetail.classList.add('hidden')
    return
  }
  els.entityTitle.textContent = detail.displayName || detail.logicalName
  els.entitySubtitle.textContent = detail.description || detail.logicalName
  els.entityDetailEmpty.classList.add('hidden')
  els.entityDetail.classList.remove('hidden')

  const metrics = [
    ['Logical Name', detail.logicalName],
    ['Entity Set', detail.entitySetName],
    ['Primary ID', detail.primaryIdAttribute],
    ['Primary Name', detail.primaryNameAttribute],
    ['Ownership', detail.ownershipType],
    ['Schema Name', detail.schemaName],
    ['Object Type Code', detail.objectTypeCode],
    ['Custom', detail.isCustomEntity],
    ['Change Tracking', detail.changeTrackingEnabled]
  ]
  els.entityMetrics.innerHTML = metrics.map((m) =>
    '<div class="metric"><div class="metric-label">' + esc(m[0]) + '</div><div class="metric-value">' + esc(m[1] == null ? '-' : m[1]) + '</div></div>'
  ).join('')

  els.attributeTable.innerHTML = (detail.attributes || []).map((a) => {
    const flags = [
      a.isPrimaryId ? 'PK' : '',
      a.isPrimaryName ? 'name' : '',
      a.isValidForRead ? 'R' : '',
      a.isValidForCreate ? 'C' : '',
      a.isValidForUpdate ? 'U' : ''
    ].filter(Boolean).join(' ')
    const targets = a.targets && a.targets.length ? a.targets.join(', ') : ''
    const options = a.optionValues && a.optionValues.length
      ? a.optionValues.slice(0, 6).map((o) => o.value + ':' + (o.label || '')).join(', ')
      : ''
    return '<tr>' +
      '<td><strong>' + esc(a.displayName || a.logicalName) + '</strong><br><code>' + esc(a.logicalName) + '</code></td>' +
      '<td><code>' + esc(a.attributeTypeName || a.attributeType || '') + '</code></td>' +
      '<td>' + esc(a.requiredLevel || '') + '</td>' +
      '<td><code>' + esc(flags) + '</code></td>' +
      '<td><code>' + esc(targets || options) + '</code></td>' +
    '</tr>'
  }).join('')
}

function renderRecordPreview() {
  if (!app.currentRecordPreview) {
    els.recordPreviewEmpty.classList.remove('hidden')
    els.recordPreview.classList.add('hidden')
    return
  }
  els.recordPreviewEmpty.classList.add('hidden')
  els.recordPreview.classList.remove('hidden')
  els.recordPreviewPath.textContent = app.currentRecordPreview.path || ''
  els.recordPreviewJson.textContent = pretty(app.currentRecordPreview.records || [])
}
`;
}
