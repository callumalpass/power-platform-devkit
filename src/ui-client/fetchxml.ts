export function renderFetchXmlModule(): string {
  return String.raw`
import { app, api, esc, formDataObject, getDefaultSelectedColumns, getGlobalEnvironment, getSelectableAttributes, updateEntityContext, toast } from '/assets/ui/shared.js'

const OPERATORS = [
  'eq', 'ne', 'gt', 'ge', 'lt', 'le',
  'like', 'not-like', 'begins-with', 'not-begin-with', 'ends-with', 'not-end-with',
  'in', 'not-in', 'between', 'not-between',
  'null', 'not-null',
  'above', 'under', 'eq-or-above', 'eq-or-under',
  'contain-values', 'not-contain-values',
  'eq-userid', 'ne-userid', 'eq-businessid', 'ne-businessid',
  'yesterday', 'today', 'tomorrow',
  'last-x-hours', 'next-x-hours', 'last-x-days', 'next-x-days',
  'last-x-weeks', 'next-x-weeks', 'last-x-months', 'next-x-months',
  'last-x-years', 'next-x-years',
  'this-month', 'this-year', 'this-week', 'last-month', 'last-year', 'last-week',
  'next-month', 'next-year', 'next-week'
]

const els = {
  form: document.getElementById('fetchxml-form'),
  previewButton: document.getElementById('fetch-preview-btn'),
  runButton: document.getElementById('fetch-run-btn'),
  result: document.getElementById('fetch-result'),
  raw: document.getElementById('fetch-raw'),
  entitySelect: document.getElementById('fetch-entity'),
  entitySet: document.getElementById('fetch-entity-set'),
  attrs: document.getElementById('fetch-attrs'),
  attrPicker: document.getElementById('fetch-attr-picker'),
  distinct: document.getElementById('fetch-distinct'),
  filterType: document.getElementById('fetch-filter-type'),
  conditions: document.getElementById('fetch-conditions'),
  addCondition: document.getElementById('fetch-add-condition'),
  orderAttribute: document.getElementById('order-attribute'),
  orderDesc: document.getElementById('order-desc'),
  entityContext: document.getElementById('fetch-entity-context'),
  links: document.getElementById('fetch-links'),
  addLink: document.getElementById('fetch-add-link')
}

let builderEntity = null
let selectedAttrs = new Set()
let conditionCount = 0
let linkCount = 0
const linkDetails = {} // linkId -> loaded entity detail

export function initFetchXml() {
  els.runButton.addEventListener('click', async () => {
    try {
      const payload = await api('/api/dv/fetchxml/execute', { method: 'POST', body: JSON.stringify(readRunPayload()) })
      els.result.textContent = JSON.stringify(payload.data, null, 2)
      toast('FetchXML executed')
    } catch (error) {
      toast(error.message, true)
    }
  })

  els.previewButton.addEventListener('click', async () => {
    try {
      const payload = await api('/api/dv/fetchxml/preview', { method: 'POST', body: JSON.stringify(readFormPayload()) })
      els.raw.value = payload.data.fetchXml || ''
      toast('XML generated')
    } catch (error) {
      toast(error.message, true)
    }
  })

  els.entitySelect.addEventListener('change', () => {
    const logicalName = els.entitySelect.value
    if (!logicalName) {
      builderEntity = null
      renderAttrPicker()
      renderOrderSelect()
      clearConditions()
      clearLinks()
      els.entitySet.value = ''
      return
    }
    loadBuilderEntity(logicalName).catch((e) => toast(e.message, true))
  })

  els.attrPicker.addEventListener('click', (e) => {
    const chip = e.target.closest('.attr-chip')
    if (!chip) return
    const name = chip.dataset.attr
    if (selectedAttrs.has(name)) selectedAttrs.delete(name)
    else selectedAttrs.add(name)
    syncAttrsInput()
    renderAttrPicker()
  })

  els.addCondition.addEventListener('click', () => addConditionRow())
  els.addLink.addEventListener('click', () => addLinkCard())

  addConditionRow()
}

async function loadBuilderEntity(logicalName) {
  const env = getGlobalEnvironment()
  if (!env) throw new Error('Select an environment first.')
  const match = app.entities.find((e) => e.logicalName === logicalName)
  if (match) els.entitySet.value = match.entitySetName || ''
  const payload = await api('/api/dv/entities/' + encodeURIComponent(logicalName) + '?environment=' + encodeURIComponent(env))
  builderEntity = payload.data
  selectedAttrs = new Set(getDefaultSelectedColumns(builderEntity, 0))
  syncAttrsInput()
  renderAttrPicker()
  renderOrderSelect()
  rebuildConditionSelects()
  rebuildLinkFromSelects()
}

export function useEntityInFetchXml(detail) {
  updateEntityContext(els.entityContext, detail)
  els.entitySelect.value = detail.logicalName || ''
  els.entitySet.value = detail.entitySetName || ''
  builderEntity = detail
  selectedAttrs = new Set()
  const cols = app.selectedColumns.length ? app.selectedColumns : getDefaultSelectedColumns(detail, 0)
  for (const c of cols) selectedAttrs.add(c)
  syncAttrsInput()
  renderAttrPicker()
  renderOrderSelect()
  rebuildConditionSelects()
  rebuildLinkFromSelects()
  const attrs = Array.from(selectedAttrs).map((a) => '    <attribute name="' + a + '" />').join('\n')
  els.raw.value = '<fetch top="50">\n  <entity name="' + (detail.logicalName || '') + '">\n' + attrs + '\n  </entity>\n</fetch>'
}

export function updateFetchContext() {
  updateEntityContext(els.entityContext, app.currentEntityDetail)
  renderEntityDropdown()
}

function renderEntityDropdown() {
  const prev = els.entitySelect.value
  els.entitySelect.innerHTML = '<option value="">select entity\u2026</option>' +
    app.entities.map((e) =>
      '<option value="' + esc(e.logicalName) + '">' + esc((e.displayName || e.logicalName) + ' (' + e.logicalName + ')') + '</option>'
    ).join('')
  if (prev) els.entitySelect.value = prev
}

function buildEntityOptions(selectedValue) {
  return '<option value="">select entity\u2026</option>' +
    app.entities.map((e) => {
      const sel = e.logicalName === selectedValue ? ' selected' : ''
      return '<option value="' + esc(e.logicalName) + '"' + sel + '>' + esc((e.displayName || e.logicalName) + ' (' + e.logicalName + ')') + '</option>'
    }).join('')
}

function renderAttrPicker() {
  if (!builderEntity || !builderEntity.attributes) {
    els.attrPicker.innerHTML = '<span style="color:var(--muted);font-size:0.75rem">Select an entity to see attributes</span>'
    return
  }
  const attrs = getSelectableAttributes(builderEntity)
  els.attrPicker.innerHTML = attrs.map((a) => {
    const sel = selectedAttrs.has(a.logicalName) ? ' selected' : ''
    return '<span class="attr-chip' + sel + '" data-attr="' + esc(a.logicalName) + '" title="' + esc(a.displayName || a.logicalName) + ' (' + (a.attributeTypeName || a.attributeType || '') + ')">' + esc(a.logicalName) + '</span>'
  }).join('')
}

function renderOrderSelect() {
  const prev = els.orderAttribute.value
  if (!builderEntity || !builderEntity.attributes) {
    els.orderAttribute.innerHTML = '<option value="">none</option>'
    return
  }
  els.orderAttribute.innerHTML = '<option value="">none</option>' +
    getSelectableAttributes(builderEntity)
      .map((a) => '<option value="' + esc(a.logicalName) + '">' + esc(a.logicalName) + '</option>')
      .join('')
  if (prev) els.orderAttribute.value = prev
}

function buildAttributeOptions(detail) {
  const source = detail || builderEntity
  if (!source || !source.attributes) return '<option value="">select\u2026</option>'
  return '<option value="">select\u2026</option>' +
    getSelectableAttributes(source)
      .map((a) => '<option value="' + esc(a.logicalName) + '">' + esc(a.logicalName) + '</option>')
      .join('')
}

function buildOperatorOptions() {
  return '<option value="">select\u2026</option>' +
    OPERATORS.map((op) => '<option value="' + esc(op) + '">' + esc(op) + '</option>').join('')
}

// --- Conditions ---

function addConditionRow(container, detail, attr, op, val) {
  const target = container || els.conditions
  conditionCount++
  const id = conditionCount
  const row = document.createElement('div')
  row.className = 'condition-row'
  row.dataset.condId = String(id)
  row.innerHTML =
    '<select data-role="attr">' + buildAttributeOptions(detail) + '</select>' +
    '<select data-role="op">' + buildOperatorOptions() + '</select>' +
    '<input data-role="val" placeholder="value">' +
    '<button type="button" class="condition-remove" data-remove-cond="' + id + '">\u00d7</button>'
  if (attr) row.querySelector('[data-role="attr"]').value = attr
  if (op) row.querySelector('[data-role="op"]').value = op
  if (val) row.querySelector('[data-role="val"]').value = val
  row.querySelector('[data-remove-cond]').addEventListener('click', () => row.remove())
  target.appendChild(row)
}

function clearConditions() {
  els.conditions.innerHTML = ''
  conditionCount = 0
}

function rebuildConditionSelects() {
  const rows = els.conditions.querySelectorAll('.condition-row')
  for (const row of rows) {
    const attrSelect = row.querySelector('[data-role="attr"]')
    const prev = attrSelect.value
    attrSelect.innerHTML = buildAttributeOptions()
    if (prev) attrSelect.value = prev
  }
}

function readConditionsFrom(container) {
  const result = []
  for (const row of container.querySelectorAll('.condition-row')) {
    const attr = row.querySelector('[data-role="attr"]').value
    const op = row.querySelector('[data-role="op"]').value
    const val = row.querySelector('[data-role="val"]').value
    if (attr && op) result.push({ attribute: attr, operator: op, value: val || undefined })
  }
  return result
}

// --- Link entities ---

function addLinkCard() {
  linkCount++
  const id = linkCount
  const card = document.createElement('div')
  card.className = 'link-card'
  card.dataset.linkId = String(id)

  const fromOptions = buildAttributeOptions()

  card.innerHTML =
    '<div class="link-card-head"><span>Join #' + id + '</span><button type="button" class="condition-remove" data-remove-link="' + id + '">\u00d7</button></div>' +
    '<div class="form-row" style="margin-bottom:8px">' +
      '<div class="field"><span class="field-label">Linked Entity</span><select data-role="link-entity">' + buildEntityOptions() + '</select></div>' +
      '<div class="field"><span class="field-label">Link Type</span><select data-role="link-type"><option value="inner">inner</option><option value="outer">outer</option></select></div>' +
    '</div>' +
    '<div class="form-row" style="margin-bottom:8px">' +
      '<div class="field"><span class="field-label">From (linked entity attr)</span><select data-role="link-from"><option value="">select\u2026</option></select></div>' +
      '<div class="field"><span class="field-label">To (parent entity attr)</span><select data-role="link-to">' + fromOptions + '</select></div>' +
    '</div>' +
    '<div class="field" style="margin-bottom:8px"><span class="field-label">Alias</span><input data-role="link-alias" placeholder="Optional, e.g. contact"></div>' +
    '<div class="field" style="margin-bottom:8px"><span class="field-label">Linked Attributes</span><div class="attr-picker" data-role="link-attrs"></div></div>' +
    '<div class="field"><span class="field-label">Linked Conditions</span><div class="condition-list" data-role="link-conditions"></div>' +
    '<button type="button" class="btn btn-ghost" data-add-link-condition="' + id + '" style="margin-top:4px;padding:3px 8px;font-size:0.6875rem">+ Condition</button></div>'

  // Wire up entity change to load linked entity detail
  const entitySelect = card.querySelector('[data-role="link-entity"]')
  entitySelect.addEventListener('change', () => {
    loadLinkEntityDetail(id, entitySelect.value).catch((e) => toast(e.message, true))
  })

  // Wire up attribute chip clicks
  const attrPicker = card.querySelector('[data-role="link-attrs"]')
  attrPicker.addEventListener('click', (e) => {
    const chip = e.target.closest('.attr-chip')
    if (!chip) return
    chip.classList.toggle('selected')
  })

  // Wire up add condition
  card.querySelector('[data-add-link-condition]').addEventListener('click', () => {
    const condContainer = card.querySelector('[data-role="link-conditions"]')
    const detail = linkDetails[id]
    addConditionRow(condContainer, detail)
  })

  // Wire up remove
  card.querySelector('[data-remove-link]').addEventListener('click', () => {
    delete linkDetails[id]
    card.remove()
  })

  attrPicker.innerHTML = '<span style="color:var(--muted);font-size:0.6875rem">Select a linked entity first</span>'

  els.links.appendChild(card)
}

async function loadLinkEntityDetail(linkId, logicalName) {
  if (!logicalName) {
    delete linkDetails[linkId]
    renderLinkCard(linkId)
    return
  }
  const env = getGlobalEnvironment()
  if (!env) throw new Error('Select an environment first.')
  const payload = await api('/api/dv/entities/' + encodeURIComponent(logicalName) + '?environment=' + encodeURIComponent(env))
  linkDetails[linkId] = payload.data
  renderLinkCard(linkId)
}

function renderLinkCard(linkId) {
  const card = els.links.querySelector('[data-link-id="' + linkId + '"]')
  if (!card) return
  const detail = linkDetails[linkId]

  // Update "from" dropdown (linked entity attributes)
  const fromSelect = card.querySelector('[data-role="link-from"]')
  const prevFrom = fromSelect.value
  fromSelect.innerHTML = detail ? buildAttributeOptions(detail) : '<option value="">select\u2026</option>'
  if (prevFrom) fromSelect.value = prevFrom

  // Update attribute picker
  const attrPicker = card.querySelector('[data-role="link-attrs"]')
  if (!detail || !detail.attributes) {
    attrPicker.innerHTML = '<span style="color:var(--muted);font-size:0.6875rem">Select a linked entity first</span>'
    return
  }
  const attrs = getSelectableAttributes(detail)
  attrPicker.innerHTML = attrs.map((a) =>
    '<span class="attr-chip" data-attr="' + esc(a.logicalName) + '" title="' + esc(a.displayName || a.logicalName) + '">' + esc(a.logicalName) + '</span>'
  ).join('')

  // Rebuild condition attribute selects
  const condRows = card.querySelectorAll('.condition-row')
  for (const row of condRows) {
    const attrSelect = row.querySelector('[data-role="attr"]')
    const prev = attrSelect.value
    attrSelect.innerHTML = buildAttributeOptions(detail)
    if (prev) attrSelect.value = prev
  }
}

function clearLinks() {
  els.links.innerHTML = ''
  linkCount = 0
  for (const key of Object.keys(linkDetails)) delete linkDetails[key]
}

function rebuildLinkFromSelects() {
  // Rebuild the "to" (parent entity) selects in all link cards
  const cards = els.links.querySelectorAll('.link-card')
  for (const card of cards) {
    const toSelect = card.querySelector('[data-role="link-to"]')
    const prev = toSelect.value
    toSelect.innerHTML = buildAttributeOptions()
    if (prev) toSelect.value = prev
  }
}

function readLinkEntities() {
  const result = []
  for (const card of els.links.querySelectorAll('.link-card')) {
    const name = card.querySelector('[data-role="link-entity"]').value
    const from = card.querySelector('[data-role="link-from"]').value
    const to = card.querySelector('[data-role="link-to"]').value
    const linkType = card.querySelector('[data-role="link-type"]').value
    const alias = card.querySelector('[data-role="link-alias"]').value.trim()
    if (!name || !from || !to) continue

    const selectedChips = card.querySelectorAll('.attr-picker .attr-chip.selected')
    const attributes = Array.from(selectedChips).map((c) => c.dataset.attr).filter(Boolean)

    const condContainer = card.querySelector('[data-role="link-conditions"]')
    const conditions = readConditionsFrom(condContainer)

    result.push({
      name,
      from,
      to,
      linkType: linkType || 'inner',
      alias: alias || undefined,
      attributes: attributes.length ? attributes : undefined,
      conditions: conditions.length ? conditions : undefined
    })
  }
  return result
}

// --- Sync & payload ---

function syncAttrsInput() {
  els.attrs.value = Array.from(selectedAttrs).join(',')
}

function readFormPayload() {
  const payload = formDataObject(els.form)
  payload.environmentAlias = getGlobalEnvironment()
  payload.distinct = els.distinct.value === 'true'
  payload.conditions = readConditionsFrom(els.conditions)
  payload.filterType = els.filterType.value
  payload.orders = els.orderAttribute.value
    ? [{ attribute: els.orderAttribute.value, descending: els.orderDesc.value === 'true' }]
    : []
  payload.linkEntities = readLinkEntities()
  return payload
}

function readRunPayload() {
  const rawXml = els.raw.value.trim()
  if (rawXml) {
    return {
      environmentAlias: getGlobalEnvironment(),
      entity: els.entitySelect.value || 'unknown',
      entitySetName: els.entitySet.value || undefined,
      rawXml
    }
  }
  return readFormPayload()
}
`;
}
