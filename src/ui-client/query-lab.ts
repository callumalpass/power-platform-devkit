export function renderQueryLabModule(): string {
  return String.raw`
import { app, api, formDataObject, getGlobalEnvironment, renderEntitySidebar, toast } from '/assets/ui/shared.js'

const els = {
  form: document.getElementById('query-form'),
  previewButton: document.getElementById('query-preview-btn'),
  runButton: document.getElementById('query-run-btn'),
  preview: document.getElementById('query-preview'),
  result: document.getElementById('query-result'),
  entitySet: document.getElementById('query-entity-set'),
  select: document.getElementById('query-select'),
  order: document.getElementById('query-order'),
  entityList: document.getElementById('query-entity-list'),
  entityFilter: document.getElementById('query-entity-filter')
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

  els.entityFilter.addEventListener('input', renderQueryEntities)
}

export function renderQueryEntities() {
  if (!app.entities.length) {
    els.entityList.innerHTML = '<div class="empty">No entities loaded.</div>'
    return
  }
  renderEntitySidebar(els.entityList, els.entityFilter, (logicalName) => {
    const entity = app.entities.find((e) => e.logicalName === logicalName)
    if (entity) {
      els.entitySet.value = entity.entitySetName || ''
      els.select.value = [entity.primaryIdAttribute, entity.primaryNameAttribute].filter(Boolean).join(',')
      els.order.value = entity.primaryNameAttribute ? entity.primaryNameAttribute + ' asc' : ''
      toast('Applied ' + entity.logicalName)
    }
  })
}

export function useEntityInQuery(detail, environment) {
  els.entitySet.value = detail.entitySetName || ''
  els.select.value = [detail.primaryIdAttribute, detail.primaryNameAttribute].filter(Boolean).join(',')
  els.order.value = detail.primaryNameAttribute ? detail.primaryNameAttribute + ' asc' : ''
}

function readQueryPayload() {
  const data = formDataObject(els.form)
  data.environmentAlias = getGlobalEnvironment()
  return data
}
`;
}
