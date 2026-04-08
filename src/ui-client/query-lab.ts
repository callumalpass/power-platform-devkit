export function renderQueryLabModule(): string {
  return String.raw`
import { api, formDataObject, getDefaultSelectedColumns, getGlobalEnvironment, updateEntityContext, highlightJson, renderResultTable, toast } from '/assets/ui/shared.js'
import { getDataverseState, subscribe } from '/assets/ui/state.js'

const els = {
  form: document.getElementById('query-form'),
  previewButton: document.getElementById('query-preview-btn'),
  runButton: document.getElementById('query-run-btn'),
  preview: document.getElementById('query-preview'),
  result: document.getElementById('query-result'),
  resultTable: document.getElementById('query-result-table'),
  resultToggle: document.getElementById('query-result-toggle'),
  entitySet: document.getElementById('query-entity-set'),
  select: document.getElementById('query-select'),
  order: document.getElementById('query-order'),
  entityContext: document.getElementById('query-entity-context')
}

let lastResultData = null
let resultView = 'table'

export function initQueryLab() {
  subscribe((scope) => {
    if (scope === 'dataverse') updateQueryContext()
  })
  els.previewButton.addEventListener('click', async () => {
    try {
      const payload = await api('/api/dv/query/preview', { method: 'POST', body: JSON.stringify(readQueryPayload()) })
      els.preview.textContent = payload.data.path || ''
    } catch (error) {
      toast(error.message, true)
    }
  })

  els.runButton.addEventListener('click', async () => {
    try {
      const payload = await api('/api/dv/query/execute', { method: 'POST', body: JSON.stringify(readQueryPayload()) })
      lastResultData = payload.data
      if (payload.data && payload.data.path) els.preview.textContent = payload.data.path
      renderResult()
      toast('Query executed')
    } catch (error) {
      toast(error.message, true)
    }
  })

  els.resultToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]')
    if (!btn) return
    resultView = btn.dataset.view
    els.resultToggle.querySelectorAll('.result-toggle-btn').forEach((b) => b.classList.toggle('active', b === btn))
    renderResult()
  })
}

function renderResult() {
  if (!lastResultData) return
  const records = lastResultData.records || []
  const entityName = lastResultData.logicalName || ''
  if (resultView === 'table' && records.length) {
    els.resultTable.innerHTML = renderResultTable(records, entityName)
    els.resultTable.style.display = ''
    els.result.style.display = 'none'
  } else {
    els.resultTable.style.display = 'none'
    els.result.style.display = ''
    els.result.innerHTML = highlightJson(lastResultData)
  }
}

export function useEntityInQuery(detail) {
  const dataverse = getDataverseState()
  els.entitySet.value = detail.entitySetName || ''
  const cols = dataverse.selectedColumns.length
    ? dataverse.selectedColumns.join(',')
    : getDefaultSelectedColumns(detail, 0).join(',')
  els.select.value = cols
  const orderColumn = getDefaultSelectedColumns(detail, 0).find((name) => name !== detail.primaryIdAttribute) || getDefaultSelectedColumns(detail, 0)[0] || ''
  els.order.value = orderColumn ? orderColumn + ' asc' : ''
  updateEntityContext(els.entityContext, detail)
}

export function updateQueryContext() {
  updateEntityContext(els.entityContext, getDataverseState().currentEntityDetail)
}

function readQueryPayload() {
  const data = formDataObject(els.form)
  data.environmentAlias = getGlobalEnvironment()
  return data
}
`;
}
