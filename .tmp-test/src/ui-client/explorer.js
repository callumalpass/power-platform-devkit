export function renderExplorerModule() {
    return String.raw `
import { api, esc, getDefaultSelectedColumns, getGlobalEnvironment, renderEntitySidebar, renderSelectedColumns, toggleColumn, registerSubTabs, highlightJson, renderResultTable, toast } from '/assets/ui/shared.js'
import { clearSelectedColumns, getDataverseState, setCurrentEntity, setCurrentEntityDetail, setCurrentRecordPreview, setSelectedColumns, subscribe } from '/assets/ui/state.js'

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
  recordPreviewTable: document.getElementById('record-preview-table'),
  recordPreviewJson: document.getElementById('record-preview-json'),
  recordPreviewToggle: document.getElementById('record-preview-toggle'),
  entityToQuery: document.getElementById('entity-to-query'),
  entityToFetchXml: document.getElementById('entity-to-fetchxml'),
  entityRefreshRecords: document.getElementById('entity-refresh-records'),
  detailPanel: document.getElementById('entity-detail-panel')
}

let actions = {}
let recordPreviewView = 'table'

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
    const detail = getDataverseState().currentEntityDetail
    if (!detail) return
    actions.useEntityInQuery(detail)
    switchDvSubTab('dv-query')
  })
  els.entityToFetchXml.addEventListener('click', () => {
    const detail = getDataverseState().currentEntityDetail
    if (!detail) return
    actions.useEntityInFetchXml(detail)
    switchDvSubTab('dv-fetchxml')
  })
  els.entityRefreshRecords.addEventListener('click', () => loadRecordPreview().catch((e) => toast(e.message, true)))

  registerSubTabs(els.detailPanel)

  els.recordPreviewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]')
    if (!btn) return
    recordPreviewView = btn.dataset.view
    els.recordPreviewToggle.querySelectorAll('.result-toggle-btn').forEach((b) => b.classList.toggle('active', b === btn))
    renderRecordPreview()
  })

  subscribe((scope) => {
    if (scope !== 'dataverse') return
    renderSelectedColumns(els.selectedCols)
  })

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
      clearSelectedColumns()
      renderAttributeTable()
    }
  })
}

export function renderExplorerEntities() {
  const dataverse = getDataverseState()
  if (!dataverse.entities.length) {
    els.entityList.innerHTML = '<div class="entity-loading">Select an environment to load entities.</div>'
    els.entityCount.textContent = ''
    return
  }
  els.entityCount.textContent = dataverse.entities.length + ' entities'
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
  const dataverse = getDataverseState()
  setCurrentEntity(dataverse.entities.find((e) => e.logicalName === logicalName) || { logicalName })
  setCurrentEntityDetail(payload.data)
  setSelectedColumns(getDefaultSelectedColumns(payload.data, 0))
  renderExplorerEntities()
  renderEntityDetail()
  renderSelectedColumns(els.selectedCols)
  loadRecordPreview().catch((e) => toast(e.message, true))
}

async function loadRecordPreview() {
  const detail = getDataverseState().currentEntityDetail
  if (!detail || !detail.entitySetName) {
    setCurrentRecordPreview(null)
    renderRecordPreview()
    return
  }
  const environment = getGlobalEnvironment()
  const select = getDefaultSelectedColumns(detail, 3)
  if (!select.length) {
    setCurrentRecordPreview({ entitySetName: detail.entitySetName, logicalName: detail.logicalName, path: '', records: [] })
    renderRecordPreview()
    return
  }
  const payload = await api('/api/dv/query/execute', {
    method: 'POST',
    body: JSON.stringify({ environmentAlias: environment, entitySetName: detail.entitySetName, select, top: 5 })
  })
  setCurrentRecordPreview(payload.data)
  renderRecordPreview()
}

function renderEntityDetail() {
  const detail = getDataverseState().currentEntityDetail
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
  const detail = getDataverseState().currentEntityDetail
  if (!detail) return
  const filter = (els.attrFilter.value || '').toLowerCase()
  const attrs = (detail.attributes || []).filter((a) => {
    if (!filter) return true
    return a.logicalName.includes(filter) || (a.displayName || '').toLowerCase().includes(filter)
  })
  els.attributeTable.innerHTML = attrs.map((a) => {
    const selected = getDataverseState().selectedColumns.includes(a.logicalName)
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
  const recordPreview = getDataverseState().currentRecordPreview
  if (!recordPreview) {
    els.recordPreviewPath.textContent = ''
    els.recordPreviewTable.innerHTML = ''
    els.recordPreviewTable.style.display = 'none'
    els.recordPreviewJson.style.display = ''
    els.recordPreviewJson.textContent = 'Select an entity to preview records.'
    return
  }
  els.recordPreviewPath.textContent = recordPreview.path || ''
  const records = recordPreview.records || []
  const entityName = recordPreview.logicalName || ''
  if (recordPreviewView === 'table' && records.length) {
    els.recordPreviewTable.innerHTML = renderResultTable(records, entityName)
    els.recordPreviewTable.style.display = ''
    els.recordPreviewJson.style.display = 'none'
  } else {
    els.recordPreviewTable.style.display = 'none'
    els.recordPreviewJson.style.display = ''
    els.recordPreviewJson.innerHTML = highlightJson(records)
  }
}
`;
}
