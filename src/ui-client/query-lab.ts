export function renderQueryLabModule(): string {
  return String.raw`
import { app, api, formDataObject, getDefaultSelectedColumns, getGlobalEnvironment, updateEntityContext, toast } from '/assets/ui/shared.js'

const els = {
  form: document.getElementById('query-form'),
  previewButton: document.getElementById('query-preview-btn'),
  runButton: document.getElementById('query-run-btn'),
  preview: document.getElementById('query-preview'),
  result: document.getElementById('query-result'),
  entitySet: document.getElementById('query-entity-set'),
  select: document.getElementById('query-select'),
  order: document.getElementById('query-order'),
  entityContext: document.getElementById('query-entity-context')
}

export function initQueryLab() {
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
      els.result.textContent = JSON.stringify(payload.data, null, 2)
      if (payload.data && payload.data.path) els.preview.textContent = payload.data.path
      toast('Query executed')
    } catch (error) {
      toast(error.message, true)
    }
  })
}

export function useEntityInQuery(detail) {
  els.entitySet.value = detail.entitySetName || ''
  const cols = app.selectedColumns.length
    ? app.selectedColumns.join(',')
    : getDefaultSelectedColumns(detail, 0).join(',')
  els.select.value = cols
  const orderColumn = getDefaultSelectedColumns(detail, 0).find((name) => name !== detail.primaryIdAttribute) || getDefaultSelectedColumns(detail, 0)[0] || ''
  els.order.value = orderColumn ? orderColumn + ' asc' : ''
  updateEntityContext(els.entityContext, detail)
}

export function updateQueryContext() {
  updateEntityContext(els.entityContext, app.currentEntityDetail)
}

function readQueryPayload() {
  const data = formDataObject(els.form)
  data.environmentAlias = getGlobalEnvironment()
  return data
}
`;
}
