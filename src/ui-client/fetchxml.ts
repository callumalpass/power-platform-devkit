export function renderFetchXmlModule(): string {
  return String.raw`
import { app, api, formDataObject, getGlobalEnvironment, renderEntitySidebar, toast } from '/assets/ui/shared.js'

const els = {
  form: document.getElementById('fetchxml-form'),
  previewButton: document.getElementById('fetch-preview-btn'),
  runButton: document.getElementById('fetch-run-btn'),
  preview: document.getElementById('fetch-preview'),
  result: document.getElementById('fetch-result'),
  entity: document.getElementById('fetch-entity'),
  entitySet: document.getElementById('fetch-entity-set'),
  attributes: document.getElementById('fetch-attrs'),
  distinct: document.getElementById('fetch-distinct'),
  cond1Attribute: document.getElementById('cond1-attribute'),
  cond1Operator: document.getElementById('cond1-operator'),
  cond1Value: document.getElementById('cond1-value'),
  cond2Attribute: document.getElementById('cond2-attribute'),
  cond2Operator: document.getElementById('cond2-operator'),
  cond2Value: document.getElementById('cond2-value'),
  orderAttribute: document.getElementById('order-attribute'),
  orderDesc: document.getElementById('order-desc'),
  entityList: document.getElementById('fetch-entity-list'),
  entityFilter: document.getElementById('fetch-entity-filter')
}

export function initFetchXml() {
  els.previewButton.addEventListener('click', async () => {
    try {
      const payload = await api('/api/dv/fetchxml/preview', { method: 'POST', body: JSON.stringify(readFetchPayload()) })
      els.preview.textContent = payload.data.fetchXml || ''
    } catch (error) {
      toast(error.message, true)
    }
  })

  els.runButton.addEventListener('click', async () => {
    try {
      const payload = await api('/api/dv/fetchxml/execute', { method: 'POST', body: JSON.stringify(readFetchPayload()) })
      els.result.textContent = JSON.stringify(payload.data, null, 2)
      if (payload.data && payload.data.fetchXml) els.preview.textContent = payload.data.fetchXml
      toast('FetchXML executed')
    } catch (error) {
      toast(error.message, true)
    }
  })

  els.entityFilter.addEventListener('input', renderFetchEntities)
}

export function renderFetchEntities() {
  if (!app.entities.length) {
    els.entityList.innerHTML = '<div class="empty">No entities loaded.</div>'
    return
  }
  renderEntitySidebar(els.entityList, els.entityFilter, (logicalName) => {
    const entity = app.entities.find((e) => e.logicalName === logicalName)
    if (entity) {
      els.entity.value = entity.logicalName
      els.entitySet.value = entity.entitySetName || ''
      els.attributes.value = [entity.primaryIdAttribute, entity.primaryNameAttribute].filter(Boolean).join(',')
      toast('Applied ' + entity.logicalName)
    }
  })
}

export function useEntityInFetchXml(detail, environment) {
  els.entity.value = detail.logicalName || ''
  els.entitySet.value = detail.entitySetName || ''
  els.attributes.value = [detail.primaryIdAttribute, detail.primaryNameAttribute].filter(Boolean).join(',')
}

function readFetchPayload() {
  const payload = formDataObject(els.form)
  payload.environmentAlias = getGlobalEnvironment()
  payload.distinct = els.distinct.value === 'true'
  payload.conditions = [
    { attribute: els.cond1Attribute.value, operator: els.cond1Operator.value, value: els.cond1Value.value },
    { attribute: els.cond2Attribute.value, operator: els.cond2Operator.value, value: els.cond2Value.value }
  ].filter((c) => c.attribute && c.operator)
  payload.orders = els.orderAttribute.value
    ? [{ attribute: els.orderAttribute.value, descending: els.orderDesc.value === 'true' }]
    : []
  return payload
}
`;
}
