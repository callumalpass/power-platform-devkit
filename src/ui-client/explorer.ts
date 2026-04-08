export function renderExplorerModule(): string {
  return String.raw`
import { app, api, esc, getDefaultSelectedColumns, pretty, getGlobalEnvironment, renderEntitySidebar, renderSelectedColumns, toggleColumn, registerSubTabs, toast } from '/assets/ui/shared.js'

const els = {
  entityList: document.getElementById('entity-list'),
  entityFilter: document.getElementById('entity-filter'),
  entityCount: document.getElementById('entity-count'),
  entityDetailEmpty: document.getElementById('entity-detail-empty'),
  entityDetail: document.getElementById('entity-detail'),
  entityTitle: document.getElementById('entity-title'),
  entitySubtitle: document.getElementById('entity-subtitle'),
  entityMetrics: document.getElementById('entity-metrics'),
  attributeTable: document.getElementById('attribute-table'),
  attrFilter: document.getElementById('attr-filter'),
  selectedCols: document.getElementById('selected-cols'),
  recordPreviewPath: document.getElementById('record-preview-path'),
  recordPreviewJson: document.getElementById('record-preview-json'),
  entityToQuery: document.getElementById('entity-to-query'),
  entityToFetchXml: document.getElementById('entity-to-fetchxml'),
  entityRefreshRecords: document.getElementById('entity-refresh-records'),
  detailPanel: document.getElementById('entity-detail-panel')
}

let actions = {}

function switchDvSubTab(tabName) {
  const area = document.getElementById('dv-workspace-area')
  if (!area) return
  area.querySelectorAll('.dv-sub-nav .sub-tab').forEach((t) => t.classList.toggle('active', t.dataset.dvtab === tabName))
  area.querySelectorAll('.dv-subpanel').forEach((p) => p.classList.toggle('active', p.id === 'dv-subpanel-' + tabName))
}

export function initExplorer(a) {
  actions = a

  els.entityFilter.addEventListener('input', renderExplorerEntities)
  els.attrFilter.addEventListener('input', renderAttributeTable)

  els.entityToQuery.addEventListener('click', () => {
    if (!app.currentEntityDetail) return
    actions.useEntityInQuery(app.currentEntityDetail)
    switchDvSubTab('dv-query')
  })
  els.entityToFetchXml.addEventListener('click', () => {
    if (!app.currentEntityDetail) return
    actions.useEntityInFetchXml(app.currentEntityDetail)
    switchDvSubTab('dv-fetchxml')
  })
  els.entityRefreshRecords.addEventListener('click', () => loadRecordPreview().catch((e) => toast(e.message, true)))

  registerSubTabs(els.detailPanel)

  // Column selection: click attribute rows to toggle
  els.attributeTable.addEventListener('click', (e) => {
    const row = e.target.closest('tr.attr-row')
    if (!row) return
    const col = row.dataset.col
    if (!col) return
    toggleColumn(col)
    renderAttributeTable()
    renderSelectedColumns(els.selectedCols)
  })

  // Remove column chips
  els.selectedCols.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-remove-col]')
    if (chip) {
      toggleColumn(chip.dataset.removeCol)
      renderAttributeTable()
      renderSelectedColumns(els.selectedCols)
      return
    }
    const clear = e.target.closest('[data-action="clear-cols"]')
    if (clear) {
      app.selectedColumns = []
      renderAttributeTable()
      renderSelectedColumns(els.selectedCols)
    }
  })
}

export function renderExplorerEntities() {
  if (!app.entities.length) {
    els.entityList.innerHTML = '<div class="entity-loading">Select an environment to load entities.</div>'
    els.entityCount.textContent = ''
    return
  }
  els.entityCount.textContent = app.entities.length + ' entities'
  renderEntitySidebar(els.entityList, els.entityFilter)
  els.entityList.onclick = (event) => {
    const item = event.target.closest('[data-entity]')
    if (item) loadEntityDetail(item.dataset.entity).catch((e) => toast(e.message, true))
  }
}

async function loadEntityDetail(logicalName) {
  const environment = getGlobalEnvironment()
  if (!environment) throw new Error('Select an environment first.')
  const payload = await api('/api/dv/entities/' + encodeURIComponent(logicalName) + '?environment=' + encodeURIComponent(environment))
  app.currentEntity = app.entities.find((e) => e.logicalName === logicalName) || { logicalName }
  app.currentEntityDetail = payload.data
  app.selectedColumns = getDefaultSelectedColumns(payload.data, 0)
  renderExplorerEntities()
  renderEntityDetail()
  renderSelectedColumns(els.selectedCols)
  loadRecordPreview().catch((e) => toast(e.message, true))
}

async function loadRecordPreview() {
  const detail = app.currentEntityDetail
  if (!detail || !detail.entitySetName) {
    app.currentRecordPreview = null
    renderRecordPreview()
    return
  }
  const environment = getGlobalEnvironment()
  const select = getDefaultSelectedColumns(detail, 3)
  if (!select.length) {
    app.currentRecordPreview = { entitySetName: detail.entitySetName, logicalName: detail.logicalName, path: '', records: [] }
    renderRecordPreview()
    return
  }
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
    els.entityDetailEmpty.classList.remove('hidden')
    els.entityDetail.classList.add('hidden')
    return
  }
  els.entityDetailEmpty.classList.add('hidden')
  els.entityDetail.classList.remove('hidden')

  els.entityTitle.textContent = detail.displayName || detail.logicalName
  els.entitySubtitle.textContent = detail.description || detail.logicalName

  const metrics = [
    ['Logical Name', detail.logicalName],
    ['Entity Set', detail.entitySetName],
    ['Primary ID', detail.primaryIdAttribute],
    ['Primary Name', detail.primaryNameAttribute],
    ['Ownership', detail.ownershipType],
    ['Attributes', (detail.attributes || []).length],
    ['Custom', detail.isCustomEntity],
    ['Change Tracking', detail.changeTrackingEnabled]
  ]
  els.entityMetrics.innerHTML = metrics.map((m) =>
    '<div class="metric"><div class="metric-label">' + esc(m[0]) + '</div><div class="metric-value">' + esc(m[1] == null ? '-' : m[1]) + '</div></div>'
  ).join('')

  els.attrFilter.value = ''
  renderAttributeTable()
}

function renderAttributeTable() {
  const detail = app.currentEntityDetail
  if (!detail) return
  const filter = (els.attrFilter.value || '').toLowerCase()
  const attrs = (detail.attributes || []).filter((a) => {
    if (!filter) return true
    return a.logicalName.includes(filter) || (a.displayName || '').toLowerCase().includes(filter)
  })
  els.attributeTable.innerHTML = attrs.map((a) => {
    const selected = app.selectedColumns.includes(a.logicalName)
    const flags = [
      a.isPrimaryId ? 'PK' : '',
      a.isPrimaryName ? 'name' : '',
      a.isValidForRead ? 'R' : '',
      a.isValidForCreate ? 'C' : '',
      a.isValidForUpdate ? 'U' : ''
    ].filter(Boolean).join(' ')
    return '<tr class="attr-row' + (selected ? ' selected' : '') + '" data-col="' + esc(a.logicalName) + '">' +
      '<td style="width:24px;text-align:center">' + (selected ? '\u2713' : '') + '</td>' +
      '<td><strong>' + esc(a.displayName || a.logicalName) + '</strong><br><code>' + esc(a.logicalName) + '</code></td>' +
      '<td><code>' + esc(a.attributeTypeName || a.attributeType || '') + '</code></td>' +
      '<td><code>' + esc(flags) + '</code></td>' +
    '</tr>'
  }).join('')
}

function renderRecordPreview() {
  if (!app.currentRecordPreview) {
    els.recordPreviewPath.textContent = ''
    els.recordPreviewJson.textContent = 'Select an entity to preview records.'
    return
  }
  els.recordPreviewPath.textContent = app.currentRecordPreview.path || ''
  els.recordPreviewJson.textContent = pretty(app.currentRecordPreview.records || [])
}
`;
}
