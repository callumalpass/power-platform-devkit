export function renderQueryLabModule(): string {
  return String.raw`
import { api, formDataObject, toast } from '/assets/ui/shared.js'

const els = {
  form: document.getElementById('query-form'),
  previewButton: document.getElementById('query-preview-btn'),
  runButton: document.getElementById('query-run-btn'),
  preview: document.getElementById('query-preview'),
  result: document.getElementById('query-result'),
  environment: document.getElementById('query-environment'),
  entitySet: document.getElementById('query-entity-set'),
  select: document.getElementById('query-select'),
  order: document.getElementById('query-order')
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

  els.preview.textContent = 'Preview a Dataverse path here.'
  els.result.textContent = 'Run a query to inspect the response payload.'
}

export function useEntityInQuery(detail, environment) {
  els.environment.value = environment || ''
  els.entitySet.value = detail.entitySetName || ''
  els.select.value = [detail.primaryIdAttribute, detail.primaryNameAttribute].filter(Boolean).join(',')
  els.order.value = detail.primaryNameAttribute ? detail.primaryNameAttribute + ' asc' : ''
}

function readQueryPayload() {
  return formDataObject(els.form)
}
`;
}
