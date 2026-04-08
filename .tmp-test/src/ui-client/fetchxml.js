export function renderFetchXmlModule() {
    return String.raw `
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, completionStatus, startCompletion } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { xml } from '@codemirror/lang-xml'
import { bracketMatching } from '@codemirror/language'
import { linter } from '@codemirror/lint'
import { getCM, vim } from '@replit/codemirror-vim'
import { searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { api, esc, formDataObject, getDefaultSelectedColumns, getGlobalEnvironment, getSelectableAttributes, updateEntityContext, highlightJson, renderResultTable, toast } from '/assets/ui/shared.js'
import { getDataverseState, subscribe } from '/assets/ui/state.js'

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
  resultTable: document.getElementById('fetch-result-table'),
  resultToggle: document.getElementById('fetch-result-toggle'),
  raw: document.getElementById('fetch-raw'),
  editorMount: document.getElementById('fetch-editor'),
  diagnostics: document.getElementById('fetch-diagnostics'),
  editorStatus: document.getElementById('fetch-editor-status'),
  vimMode: document.getElementById('fetch-vim-mode'),
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
const linkDetails = {}
let lastFetchResultData = null
let fetchResultView = 'table'

const diagnosticsCompartment = new Compartment()
let editorView = null
let latestDiagnostics = []

class FetchXmlLanguageClient {
  constructor() {
    this.inFlight = new Map()
  }

  analyze(source, cursor) {
    const payload = {
      source,
      cursor,
      environmentAlias: getGlobalEnvironment(),
      rootEntityName: els.entitySelect.value || (getDataverseState().currentEntityDetail && getDataverseState().currentEntityDetail.logicalName) || undefined
    }
    const key = JSON.stringify(payload)
    if (this.inFlight.has(key)) return this.inFlight.get(key)
    const request = api('/api/dv/fetchxml/intellisense', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
      .then((result) => result.data)
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, request)
    return request
  }
}

const languageClient = new FetchXmlLanguageClient()

export function initFetchXml() {
  initEditor()
  subscribe((scope) => {
    if (scope === 'dataverse') updateFetchContext()
  })

  els.runButton.addEventListener('click', async () => {
    try {
      const payload = await api('/api/dv/fetchxml/execute', { method: 'POST', body: JSON.stringify(readRunPayload()) })
      lastFetchResultData = payload.data
      renderFetchResult()
      toast('FetchXML executed')
    } catch (error) {
      toast(error.message, true)
    }
  })

  els.resultToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]')
    if (!btn) return
    fetchResultView = btn.dataset.view
    els.resultToggle.querySelectorAll('.result-toggle-btn').forEach((b) => b.classList.toggle('active', b === btn))
    renderFetchResult()
  })

  els.previewButton.addEventListener('click', async () => {
    try {
      const payload = await api('/api/dv/fetchxml/preview', { method: 'POST', body: JSON.stringify(readFormPayload()) })
      setRawXml(payload.data.fetchXml || '')
      await refreshDiagnostics()
      toast('XML generated')
    } catch (error) {
      toast(error.message, true)
    }
  })

  els.entitySelect.addEventListener('change', () => {
    const logicalName = els.entitySelect.value
    refreshDiagnostics().catch(() => {})
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
  refreshDiagnostics().catch(() => {})
}

function initEditor() {
  const acceptCompletionIfOpen = (view) => completionStatus(view.state) === 'active' ? acceptCompletion(view) : false

  const completionSource = async (context) => {
    const before = context.matchBefore(/[^\\s<>"'=\\/]*$/)
    const triggerChar = context.pos > 0 ? context.state.sliceDoc(context.pos - 1, context.pos) : ''
    if (!context.explicit && !before && !'<="/ '.includes(triggerChar)) return null
    const analysis = await languageClient.analyze(context.state.doc.toString(), context.pos)
    applyAnalysis(analysis)
    if (!analysis.completions.length) return null
    return {
      from: analysis.context.from,
      to: analysis.context.to,
      options: analysis.completions.map(toCompletionOption)
    }
  }

  const diagnosticSource = async (view) => {
    const analysis = await languageClient.analyze(view.state.doc.toString(), view.state.selection.main.head)
    applyAnalysis(analysis)
    return analysis.diagnostics.map((item) => ({
      from: item.from,
      to: item.to,
      severity: item.level === 'error' ? 'error' : item.level === 'warning' ? 'warning' : 'info',
      message: item.message,
      source: item.code
    }))
  }

  const theme = EditorView.theme({
    '&': { fontSize: '13px' },
    '.cm-content': { caretColor: 'var(--ink)' },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--ink)' },
    '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(37,99,235,0.18)' },
    '.cm-activeLine': { backgroundColor: 'rgba(37,99,235,0.06)' },
    '.cm-gutters': { backgroundColor: 'var(--bg)', borderRight: '1px solid var(--border)', color: 'var(--muted)' }
  })

  editorView = new EditorView({
    parent: els.editorMount,
    state: EditorState.create({
      doc: els.raw.value || '',
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        xml(),
        vim(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ override: [completionSource], activateOnTyping: true, defaultKeymap: false, icons: true }),
        diagnosticsCompartment.of(linter(diagnosticSource, { delay: 250 })),
        Prec.highest(keymap.of([
          { key: 'Tab', run: acceptCompletionIfOpen },
          { key: 'Enter', run: acceptCompletionIfOpen }
        ])),
        keymap.of([
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...completionKeymap
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) syncRawInput(update.state.doc.toString())
          if (update.docChanged || update.selectionSet) {
            queueMicrotask(() => refreshDiagnostics().catch(() => {}))
          }
          if (update.docChanged) startCompletion(update.view)
        }),
        theme
      ]
    })
  })

  const cm = getCM(editorView)
  if (cm && typeof cm.on === 'function') {
    cm.on('vim-mode-change', (event) => renderVimMode(event))
  }
  renderVimMode({ mode: 'normal' })
}

async function refreshDiagnostics() {
  if (!editorView) return
  const analysis = await languageClient.analyze(editorView.state.doc.toString(), editorView.state.selection.main.head)
  applyAnalysis(analysis)
}

function applyAnalysis(analysis) {
  latestDiagnostics = analysis.diagnostics || []
  renderDiagnostics(latestDiagnostics)
  renderEditorStatus(latestDiagnostics)
}

function renderDiagnostics(items) {
  if (!items.length) {
    els.diagnostics.innerHTML = ''
    return
  }
  els.diagnostics.innerHTML = items.slice(0, 6).map((item) =>
    '<div class="fetchxml-diagnostic ' + esc(item.level) + '">' +
      '<div class="fetchxml-diagnostic-code">' + esc(item.code) + ' @ ' + item.from + '</div>' +
      '<div class="fetchxml-diagnostic-message">' + esc(item.message) + '</div>' +
    '</div>'
  ).join('')
}

function renderEditorStatus(items) {
  const hasError = items.some((item) => item.level === 'error')
  const hasWarning = !hasError && items.some((item) => item.level === 'warning')
  if (hasError) {
    els.editorStatus.innerHTML = '<span class="fetchxml-status-dot error"></span>' + items.length + ' issue' + (items.length === 1 ? '' : 's')
    return
  }
  if (hasWarning) {
    els.editorStatus.innerHTML = '<span class="fetchxml-status-dot warn"></span>' + items.length + ' advisory warning' + (items.length === 1 ? '' : 's')
    return
  }
  els.editorStatus.innerHTML = '<span class="fetchxml-status-dot"></span>IntelliSense ready'
}

function renderVimMode(event) {
  const mode = String(event && event.mode ? event.mode : 'normal').toLowerCase()
  const subMode = String(event && event.subMode ? event.subMode : '').toLowerCase()
  const label = subMode ? (mode + ' ' + subMode) : mode
  els.vimMode.className = 'fetchxml-vim-mode ' + esc(mode)
  els.vimMode.textContent = label.toUpperCase()
}

function toCompletionOption(item) {
  return {
    label: item.label,
    type: item.type === 'keyword' ? 'keyword' : item.type,
    detail: item.detail,
    info: item.info,
    apply: item.apply || item.label,
    boost: item.boost
  }
}

function syncRawInput(value) {
  els.raw.value = value
}

function getRawXml() {
  return editorView ? editorView.state.doc.toString() : els.raw.value
}

function setRawXml(value) {
  syncRawInput(value)
  if (!editorView) return
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: value }
  })
}

async function loadBuilderEntity(logicalName) {
  const env = getGlobalEnvironment()
  if (!env) throw new Error('Select an environment first.')
  const match = getDataverseState().entities.find((e) => e.logicalName === logicalName)
  if (match) els.entitySet.value = match.entitySetName || ''
  const payload = await api('/api/dv/entities/' + encodeURIComponent(logicalName) + '?environment=' + encodeURIComponent(env))
  builderEntity = payload.data
  selectedAttrs = new Set(getDefaultSelectedColumns(builderEntity, 0))
  syncAttrsInput()
  renderAttrPicker()
  renderOrderSelect()
  rebuildConditionSelects()
  rebuildLinkFromSelects()
  refreshDiagnostics().catch(() => {})
}

export function useEntityInFetchXml(detail) {
  updateEntityContext(els.entityContext, detail)
  els.entitySelect.value = detail.logicalName || ''
  els.entitySet.value = detail.entitySetName || ''
  builderEntity = detail
  selectedAttrs = new Set()
  const dataverse = getDataverseState()
  const cols = dataverse.selectedColumns.length ? dataverse.selectedColumns : getDefaultSelectedColumns(detail, 0)
  for (const c of cols) selectedAttrs.add(c)
  syncAttrsInput()
  renderAttrPicker()
  renderOrderSelect()
  rebuildConditionSelects()
  rebuildLinkFromSelects()
  const attrs = Array.from(selectedAttrs).map((a) => '    <attribute name="' + a + '" />').join('\n')
  setRawXml('<fetch top="50">\n  <entity name="' + (detail.logicalName || '') + '">\n' + attrs + '\n  </entity>\n</fetch>')
  refreshDiagnostics().catch(() => {})
}

export function updateFetchContext() {
  updateEntityContext(els.entityContext, getDataverseState().currentEntityDetail)
  renderEntityDropdown()
  refreshDiagnostics().catch(() => {})
}

function renderEntityDropdown() {
  const prev = els.entitySelect.value
  els.entitySelect.innerHTML = '<option value="">select entity\u2026</option>' +
    getDataverseState().entities.map((e) =>
      '<option value="' + esc(e.logicalName) + '">' + esc((e.displayName || e.logicalName) + ' (' + e.logicalName + ')') + '</option>'
    ).join('')
  if (prev) els.entitySelect.value = prev
}

function buildEntityOptions(selectedValue) {
  return '<option value="">select entity\u2026</option>' +
    getDataverseState().entities.map((e) => {
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

  const entitySelect = card.querySelector('[data-role="link-entity"]')
  entitySelect.addEventListener('change', () => {
    loadLinkEntityDetail(id, entitySelect.value).catch((e) => toast(e.message, true))
  })

  const attrPicker = card.querySelector('[data-role="link-attrs"]')
  attrPicker.addEventListener('click', (e) => {
    const chip = e.target.closest('.attr-chip')
    if (!chip) return
    chip.classList.toggle('selected')
  })

  card.querySelector('[data-add-link-condition]').addEventListener('click', () => {
    const condContainer = card.querySelector('[data-role="link-conditions"]')
    const detail = linkDetails[id]
    addConditionRow(condContainer, detail)
  })

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

  const fromSelect = card.querySelector('[data-role="link-from"]')
  const prevFrom = fromSelect.value
  fromSelect.innerHTML = detail ? buildAttributeOptions(detail) : '<option value="">select\u2026</option>'
  if (prevFrom) fromSelect.value = prevFrom

  const attrPicker = card.querySelector('[data-role="link-attrs"]')
  if (!detail || !detail.attributes) {
    attrPicker.innerHTML = '<span style="color:var(--muted);font-size:0.6875rem">Select a linked entity first</span>'
    return
  }
  const attrs = getSelectableAttributes(detail)
  attrPicker.innerHTML = attrs.map((a) =>
    '<span class="attr-chip" data-attr="' + esc(a.logicalName) + '" title="' + esc(a.displayName || a.logicalName) + '">' + esc(a.logicalName) + '</span>'
  ).join('')

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
  const rawXml = getRawXml().trim()
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

function renderFetchResult() {
  if (!lastFetchResultData) return
  const records = lastFetchResultData.records || []
  const entityName = lastFetchResultData.logicalName || ''
  if (fetchResultView === 'table' && records.length) {
    els.resultTable.innerHTML = renderResultTable(records, entityName)
    els.resultTable.style.display = ''
    els.result.style.display = 'none'
  } else {
    els.resultTable.style.display = 'none'
    els.result.style.display = ''
    els.result.innerHTML = highlightJson(lastFetchResultData)
  }
}
`;
}
