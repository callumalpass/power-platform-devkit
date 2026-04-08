export function renderAutomateModule(): string {
  return String.raw`
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, completionStatus, startCompletion } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching } from '@codemirror/language'
import { linter } from '@codemirror/lint'
import { searchKeymap } from '@codemirror/search'
import { EditorState, Prec } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { api, esc, getGlobalEnvironment, highlightJson, toast } from '/assets/ui/shared.js'

const els = {
  flowList: document.getElementById('flow-list'),
  flowFilter: document.getElementById('flow-filter'),
  flowCount: document.getElementById('flow-count'),
  flowDetailEmpty: document.getElementById('flow-detail-empty'),
  flowDetail: document.getElementById('flow-detail'),
  flowTitle: document.getElementById('flow-title'),
  flowSubtitle: document.getElementById('flow-subtitle'),
  flowMetrics: document.getElementById('flow-metrics'),
  flowLanguagePanel: document.getElementById('flow-language-panel'),
  flowLanguageStatus: document.getElementById('flow-language-status'),
  flowLanguageSummaryText: document.getElementById('flow-language-summary-text'),
  flowLanguageLoad: document.getElementById('flow-language-load'),
  flowLanguageAnalyze: document.getElementById('flow-language-analyze'),
  flowLanguageEditor: document.getElementById('flow-language-editor'),
  flowLanguageSummary: document.getElementById('flow-language-summary'),
  flowLanguageDiagnostics: document.getElementById('flow-language-diagnostics'),
  flowLanguageOutline: document.getElementById('flow-language-outline'),
  flowOutlinePanel: document.getElementById('flow-outline-panel'),
  flowOutlineCanvas: document.getElementById('flow-outline-canvas'),
  flowCanvasContainer: document.getElementById('flow-canvas-container'),
  flowOutlineZoomFit: document.getElementById('flow-outline-zoom-fit'),
  flowOutlineZoomIn: document.getElementById('flow-outline-zoom-in'),
  flowOutlineZoomOut: document.getElementById('flow-outline-zoom-out'),
  flowRuns: document.getElementById('flow-runs'),
  flowRunFilter: document.getElementById('flow-run-filter'),
  flowRunStatusFilter: document.getElementById('flow-run-status-filter'),
  flowRunsPanel: document.getElementById('flow-runs-panel'),
  flowActionsPanel: document.getElementById('flow-actions-panel'),
  flowRunSummary: document.getElementById('flow-run-summary'),
  flowActions: document.getElementById('flow-actions'),
  flowActionFilter: document.getElementById('flow-action-filter'),
  flowActionStatusFilter: document.getElementById('flow-action-status-filter'),
  flowActionsBack: document.getElementById('flow-actions-back'),
  flowActionDetailPanel: document.getElementById('flow-action-detail-panel'),
  flowActionTitle: document.getElementById('flow-action-title'),
  flowActionMetrics: document.getElementById('flow-action-metrics'),
  flowActionIo: document.getElementById('flow-action-io'),
  flowActionBack: document.getElementById('flow-action-back'),
  flowRefresh: document.getElementById('flow-refresh'),
  flowOpenConsole: document.getElementById('flow-open-console')
}

let flows = []
let currentFlow = null
let flowsEnvironment = null
let currentRuns = []
let currentRun = null
let currentActions = []
let currentAction = null
let flowListSource = 'flow'
let flowEditorView = null
let latestFlowAnalysis = null
let latestFlowDocumentText = ''
let analysisTimer = null
let canvasView = { x: 0, y: 0, scale: 1 }
let canvasPan = null
let canvasNodes = []

class FlowLanguageClient {
  constructor() {
    this.inFlight = new Map()
  }

  analyze(source, cursor) {
    const payload = { source, cursor }
    const key = JSON.stringify(payload)
    if (this.inFlight.has(key)) return this.inFlight.get(key)
    const request = api('/api/flow/language/analyze', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
      .then((result) => result.data)
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, request)
    return request
  }
}

const flowLanguageClient = new FlowLanguageClient()

export function initAutomate() {
  initFlowEditor()
  els.flowFilter.addEventListener('input', renderFlowList)
  els.flowRunFilter.addEventListener('input', renderRuns)
  els.flowRunStatusFilter.addEventListener('change', renderRuns)
  els.flowActionFilter.addEventListener('input', renderActions)
  els.flowActionStatusFilter.addEventListener('change', renderActions)
  els.flowRefresh.addEventListener('click', () => {
    flowsEnvironment = null
    loadFlows().then(() => toast('Flows refreshed')).catch(e => toast(e.message, true))
  })
  els.flowOpenConsole.addEventListener('click', () => {
    if (!currentFlow) return
    window.dispatchEvent(new CustomEvent('pp:open-console', {
      detail: currentFlow.source === 'dv'
        ? { api: 'dv', method: 'GET', path: '/workflows(' + flowIdentifier(currentFlow) + ')' }
        : { api: 'flow', method: 'GET', path: '/flows/' + flowIdentifier(currentFlow) }
    }))
  })
  if (els.flowActionsBack) {
    els.flowActionsBack.addEventListener('click', () => {
      currentRun = null
      currentActions = []
      currentAction = null
      showView('runs')
    })
  }
  if (els.flowActionBack) {
    els.flowActionBack.addEventListener('click', () => {
      currentAction = null
      showView('actions')
    })
  }
  els.flowLanguageLoad.addEventListener('click', () => {
    if (!currentFlow) return
    loadSelectedFlowDefinition(currentFlow).catch((e) => toast(e.message, true))
  })
  els.flowLanguageAnalyze.addEventListener('click', () => {
    analyzeCurrentFlowDocument().catch((e) => toast(e.message, true))
  })

  const canvas = els.flowOutlineCanvas
  if (canvas) {
    canvas.addEventListener('mousedown', (e) => {
      canvasPan = { x: e.clientX, y: e.clientY, vx: canvasView.x, vy: canvasView.y }
      e.preventDefault()
    })
    canvas.addEventListener('mousemove', (e) => {
      if (!canvasPan) return
      canvasView.x = canvasPan.vx + (e.clientX - canvasPan.x) / canvasView.scale
      canvasView.y = canvasPan.vy + (e.clientY - canvasPan.y) / canvasView.scale
      drawOutlineCanvas()
    })
    canvas.addEventListener('mouseup', () => { canvasPan = null })
    canvas.addEventListener('mouseleave', () => { canvasPan = null })
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const factor = e.deltaY > 0 ? 0.9 : 1.1
      canvasView.scale = Math.max(0.2, Math.min(3, canvasView.scale * factor))
      drawOutlineCanvas()
    }, { passive: false })
  }
  if (els.flowOutlineZoomFit) els.flowOutlineZoomFit.addEventListener('click', fitCanvas)
  if (els.flowOutlineZoomIn) els.flowOutlineZoomIn.addEventListener('click', () => { canvasView.scale = Math.min(3, canvasView.scale * 1.3); drawOutlineCanvas() })
  if (els.flowOutlineZoomOut) els.flowOutlineZoomOut.addEventListener('click', () => { canvasView.scale = Math.max(0.2, canvasView.scale / 1.3); drawOutlineCanvas() })
}

function showView(view) {
  els.flowRunsPanel.style.display = view === 'runs' ? '' : 'none'
  els.flowActionsPanel.style.display = view === 'actions' ? '' : 'none'
  els.flowActionDetailPanel.style.display = view === 'action-detail' ? '' : 'none'
}

export async function loadFlows() {
  const env = getGlobalEnvironment()
  if (!env) return
  if (env === flowsEnvironment && flows.length) return
  flowsEnvironment = env
  try {
    try {
      const result = await api('/api/request/execute', {
        method: 'POST',
        body: JSON.stringify({ environment: env, api: 'flow', method: 'GET', path: '/flows', allowInteractive: false })
      })
      const data = result.data && result.data.response
      flows = ((data && data.value) || []).map(normalizeFlowApiItem)
      flowListSource = 'flow'
    } catch (error) {
      const result = await api('/api/request/execute', {
        method: 'POST',
        body: JSON.stringify({
          environment: env,
          api: 'dv',
          method: 'GET',
          path: "/workflows?$filter=category eq 5&$select=name,workflowid,createdon,modifiedon,statecode,statuscode,_ownerid_value,description,clientdata&$orderby=modifiedon desc&$top=200",
          allowInteractive: false
        })
      })
      const data = result.data && result.data.response
      flows = ((data && data.value) || []).map(normalizeDataverseFlow)
      flowListSource = 'dv'
      if (flows.length) {
        toast('Flow list API failed for this environment. Showing Dataverse workflow fallback instead.', true)
      } else {
        throw error
      }
    }
    currentFlow = null
    currentRun = null
    currentActions = []
    currentAction = null
    resetFlowLanguage()
    renderFlowList()
    renderFlowDetail()
  } catch (e) {
    flowListSource = 'flow'
    flows = []
    currentFlow = null
    resetFlowLanguage()
    renderFlowList()
    renderFlowDetail()
    toast(e.message, true)
  }
}

export function resetFlows() {
  flowsEnvironment = null
  flowListSource = 'flow'
  flows = []
  currentFlow = null
  currentRun = null
  currentActions = []
  currentAction = null
  resetFlowLanguage()
}

function renderFlowList() {
  const filter = (els.flowFilter.value || '').toLowerCase()
  const filtered = filter
    ? flows.filter(f => {
        const name = prop(f, 'properties.displayName') || f.name || ''
        return name.toLowerCase().includes(filter)
      })
    : flows

  els.flowCount.textContent = flows.length
    ? flows.length + ' flows' + (flowListSource === 'dv' ? ' via Dataverse fallback' : '')
    : ''

  if (!flows.length) {
    els.flowList.innerHTML = '<div class="entity-loading">Select an environment to load flows.</div>'
    return
  }

  els.flowList.innerHTML = filtered.length
    ? filtered.map(f => {
        const displayName = prop(f, 'properties.displayName') || f.name || 'Unnamed'
        const state = prop(f, 'properties.state') || ''
        const active = currentFlow && flowIdentifier(currentFlow) === flowIdentifier(f) ? ' active' : ''
        const stateCls = state === 'Started' ? 'ok' : state === 'Stopped' ? 'error' : 'pending'
        const modified = prop(f, 'properties.lastModifiedTime')
        const trigger = prop(f, 'properties.definitionSummary.triggers.0.type') || ''
        return '<div class="entity-item' + active + '" data-flow="' + esc(flowIdentifier(f)) + '">' +
          '<div class="entity-item-name">' +
            '<span class="health-dot ' + stateCls + '" style="margin-right:6px"></span>' +
            esc(displayName) +
          '</div>' +
          '<div class="entity-item-logical">' + (trigger ? esc(trigger) + ' \u00b7 ' : '') + esc(modified ? formatDateShort(modified) : '-') + '</div>' +
          (state ? '<div class="entity-item-badges"><span class="entity-item-flag">' + esc(state.toLowerCase()) + '</span></div>' : '') +
        '</div>'
      }).join('')
    : '<div class="empty">No flows match.</div>'

  els.flowList.onclick = (e) => {
    const item = e.target.closest('[data-flow]')
    if (!item) return
    const f = flows.find(fl => flowIdentifier(fl) === item.dataset.flow)
    if (f) {
      currentFlow = f
      currentRun = null
      currentActions = []
      currentAction = null
      renderFlowList()
      renderFlowDetail()
      showView('runs')
      loadFlowRuns(f).catch(() => {})
      loadSelectedFlowDefinition(f).catch(() => {})
    }
  }
}

function renderFlowDetail() {
  if (!currentFlow) {
    els.flowDetailEmpty.classList.remove('hidden')
    els.flowDetail.classList.add('hidden')
    els.flowLanguagePanel.style.display = 'none'
    if (els.flowOutlinePanel) els.flowOutlinePanel.style.display = 'none'
    els.flowRunsPanel.style.display = 'none'
    els.flowActionsPanel.style.display = 'none'
    els.flowActionDetailPanel.style.display = 'none'
    return
  }
  els.flowDetailEmpty.classList.add('hidden')
  els.flowDetail.classList.remove('hidden')
  els.flowLanguagePanel.style.display = ''
  if (els.flowOutlinePanel) els.flowOutlinePanel.style.display = ''
  els.flowRunsPanel.style.display = ''

  const p = currentFlow.properties || {}
  els.flowTitle.textContent = p.displayName || currentFlow.name
  els.flowSubtitle.textContent = p.description || (currentFlow.source === 'dv' ? flowIdentifier(currentFlow) : currentFlow.name)

  const state = (p.state || '').toLowerCase()
  const stateBadgeCls = state === 'started' ? 'started' : state === 'stopped' ? 'stopped' : 'unknown'
  const badgeContainer = document.getElementById('flow-state-badge-container')
  if (badgeContainer) {
    badgeContainer.innerHTML = '<span class="flow-state-badge ' + stateBadgeCls + '"><span class="health-dot ' + (state === 'started' ? 'ok' : state === 'stopped' ? 'error' : 'pending') + '"></span>' + esc(p.state || 'Unknown') + '</span>'
  }

  const metrics = [
    ['Created', formatDate(p.createdTime)],
    ['Modified', formatDate(p.lastModifiedTime)],
    ['Creator', prop(currentFlow, 'properties.creator.objectId') || '-'],
    ['Trigger', prop(currentFlow, 'properties.definitionSummary.triggers.0.type') || '-'],
    ['Actions', (prop(currentFlow, 'properties.definitionSummary.actions') || []).length || '-'],
    ['Source', currentFlow.source === 'dv' ? 'Dataverse fallback' : 'Flow API']
  ]
  els.flowMetrics.innerHTML = metrics.map(m =>
    '<div class="metric"><div class="metric-label">' + esc(m[0]) + '</div><div class="metric-value">' + esc(m[1]) + '</div></div>'
  ).join('')
}

function initFlowEditor() {
  const acceptCompletionIfOpen = (view) => completionStatus(view.state) === 'active' ? acceptCompletion(view) : false
  const completionSource = async (context) => {
    const before = context.matchBefore(/[A-Za-z0-9_'"@.?()[\]-]*$/)
    if (!context.explicit && !before) return null
    const analysis = await flowLanguageClient.analyze(context.state.doc.toString(), context.pos)
    applyFlowAnalysis(analysis)
    if (!analysis.completions || !analysis.completions.length) return null
    return {
      from: analysis.context ? analysis.context.from : context.pos,
      to: analysis.context ? analysis.context.to : context.pos,
      options: analysis.completions.map(toCompletionOption)
    }
  }

  const diagnosticSource = async (view) => {
    const analysis = await flowLanguageClient.analyze(view.state.doc.toString(), view.state.selection.main.head)
    applyFlowAnalysis(analysis)
    return (analysis.diagnostics || []).map((item) => ({
      from: item.from,
      to: item.to,
      severity: item.level === 'error' ? 'error' : item.level === 'warning' ? 'warning' : 'info',
      message: item.message
    }))
  }

  flowEditorView = new EditorView({
    state: EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        drawSelection(),
        highlightActiveLine(),
        history(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ override: [completionSource] }),
        linter(diagnosticSource),
        EditorView.lineWrapping,
        Prec.high(keymap.of([
          { key: 'Tab', run: acceptCompletionIfOpen },
          { key: 'Ctrl-Space', run: startCompletion },
          { key: 'Mod-Space', run: startCompletion },
          indentWithTab,
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap
        ])),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged && !update.selectionSet) return
          latestFlowDocumentText = update.state.doc.toString()
          scheduleFlowAnalysis()
        })
      ]
    }),
    parent: els.flowLanguageEditor
  })
}

function resetFlowLanguage() {
  latestFlowAnalysis = null
  latestFlowDocumentText = ''
  if (analysisTimer) {
    clearTimeout(analysisTimer)
    analysisTimer = null
  }
  setFlowEditorText('')
  els.flowLanguageStatus.innerHTML = '<span class="fetchxml-status-dot warn"></span>Definition not loaded'
  els.flowLanguageSummaryText.textContent = 'No analysis yet'
  els.flowLanguageSummary.innerHTML = ''
  els.flowLanguageDiagnostics.innerHTML = '<div class="empty">Load a flow definition to analyze it.</div>'
  els.flowLanguageOutline.innerHTML = '<div class="empty">No outline yet.</div>'
}

async function loadSelectedFlowDefinition(flow) {
  const env = getGlobalEnvironment()
  if (!env || !flow) return
  els.flowLanguageStatus.innerHTML = '<span class="fetchxml-status-dot warn"></span>Loading definition'
  let detail = flow
  if (flow.source !== 'dv') {
    try {
      const result = await api('/api/request/execute', {
        method: 'POST',
        body: JSON.stringify({ environment: env, api: 'flow', method: 'GET', path: '/flows/' + flowIdentifier(flow), allowInteractive: false })
      })
      detail = (result.data && result.data.response) || flow
    } catch {
      detail = flow
    }
  }
  const document = buildFlowDocument(detail)
  setFlowEditorText(document)
  latestFlowDocumentText = document
  els.flowLanguageStatus.innerHTML = '<span class="fetchxml-status-dot"></span>Definition loaded'
  await analyzeCurrentFlowDocument()
}

function buildFlowDocument(detail) {
  const definition = prop(detail, 'properties.definition') || detail.definition || detail
  const connectionReferences = prop(detail, 'properties.connectionReferences')
  if (definition && typeof definition === 'object') {
    return JSON.stringify({
      name: detail.name,
      id: detail.id || detail.workflowid,
      type: detail.type,
      properties: {
        displayName: prop(detail, 'properties.displayName'),
        state: prop(detail, 'properties.state'),
        connectionReferences,
        definition
      }
    }, null, 2)
  }
  if (typeof definition === 'string') return definition
  return JSON.stringify(detail || {}, null, 2)
}

function setFlowEditorText(text) {
  if (!flowEditorView) return
  const next = String(text || '')
  const current = flowEditorView.state.doc.toString()
  if (current === next) return
  flowEditorView.dispatch({ changes: { from: 0, to: current.length, insert: next } })
}

function scheduleFlowAnalysis() {
  if (!flowEditorView) return
  if (analysisTimer) clearTimeout(analysisTimer)
  analysisTimer = setTimeout(() => {
    analyzeCurrentFlowDocument().catch(() => {})
  }, 220)
}

async function analyzeCurrentFlowDocument() {
  if (!flowEditorView) return
  const source = flowEditorView.state.doc.toString()
  latestFlowDocumentText = source
  const analysis = await flowLanguageClient.analyze(source, flowEditorView.state.selection.main.head)
  applyFlowAnalysis(analysis)
}

function applyFlowAnalysis(analysis) {
  latestFlowAnalysis = analysis
  const diagnostics = analysis.diagnostics || []
  const errors = diagnostics.filter((item) => item.level === 'error').length
  const warnings = diagnostics.filter((item) => item.level === 'warning').length
  if (errors) {
    els.flowLanguageStatus.innerHTML = '<span class="fetchxml-status-dot error"></span>' + errors + ' error' + (errors === 1 ? '' : 's')
  } else if (warnings) {
    els.flowLanguageStatus.innerHTML = '<span class="fetchxml-status-dot warn"></span>' + warnings + ' warning' + (warnings === 1 ? '' : 's')
  } else {
    els.flowLanguageStatus.innerHTML = '<span class="fetchxml-status-dot"></span>Analysis clean'
  }
  const summary = analysis.summary || {}
  els.flowLanguageSummaryText.textContent =
    (summary.actionCount || 0) + ' actions, ' +
    (summary.triggerCount || 0) + ' trigger' + ((summary.triggerCount || 0) === 1 ? '' : 's') +
    ', wrapper: ' + (summary.wrapperKind || 'unknown')
  renderFlowLanguageSummary(analysis)
  renderFlowLanguageDiagnostics(diagnostics)
  renderFlowLanguageOutline(analysis.outline || [])
}

function renderFlowLanguageSummary(analysis) {
  const summary = analysis.summary || {}
  const refs = analysis.references || []
  const unresolved = refs.filter((item) => item.resolved === false).length
  const cards = [
    ['Wrapper', summary.wrapperKind || 'unknown'],
    ['Triggers', String(summary.triggerCount || 0)],
    ['Actions', String(summary.actionCount || 0)],
    ['Variables', String(summary.variableCount || 0)],
    ['Parameters', String(summary.parameterCount || 0)],
    ['Unresolved refs', String(unresolved)]
  ]
  els.flowLanguageSummary.innerHTML = cards.map((item) =>
    '<div class="metric"><div class="metric-label">' + esc(item[0]) + '</div><div class="metric-value">' + esc(item[1]) + '</div></div>'
  ).join('')
}

function renderFlowLanguageDiagnostics(items) {
  if (!items.length) {
    els.flowLanguageDiagnostics.innerHTML = '<div class="empty">No diagnostics.</div>'
    return
  }
  els.flowLanguageDiagnostics.innerHTML = items.slice(0, 30).map((item) =>
    '<div class="fetchxml-diagnostic ' + esc(item.level) + '">' +
      '<div class="fetchxml-diagnostic-code">' + esc(item.code) + ' @ ' + item.from + '</div>' +
      '<div class="fetchxml-diagnostic-message">' + esc(item.message) + '</div>' +
      (item.detail ? '<div class="flow-outline-detail">' + esc(item.detail) + '</div>' : '') +
    '</div>'
  ).join('')
}

function renderFlowLanguageOutline(items) {
  canvasNodes = []
  if (!items.length) {
    drawOutlineCanvas()
    return
  }
  layoutOutlineNodes(items, 0, 0, 0)
  fitCanvas()
}

const NODE_PAD_X = 20
const NODE_PAD_Y = 16
const NODE_GAP_Y = 14
const NODE_GAP_X = 24
const NODE_MIN_W = 180
const NODE_H = 46
const SCOPE_PAD = 12
const CONNECTOR_R = 3

const KIND_COLORS = {
  trigger: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
  action: { bg: '#f0fdf4', border: '#22c55e', text: '#166534' },
  scope: { bg: '#fefce8', border: '#eab308', text: '#854d0e' },
  condition: { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' },
  foreach: { bg: '#f5f3ff', border: '#8b5cf6', text: '#5b21b6' },
  switch: { bg: '#fff7ed', border: '#f97316', text: '#9a3412' },
  default: { bg: '#f9fafb', border: '#9ca3af', text: '#374151' }
}

function layoutOutlineNodes(items, depth, startX, startY) {
  let cursorY = startY
  for (const item of items) {
    const kind = (item.kind || '').toLowerCase()
    const hasChildren = item.children && item.children.length
    const colors = KIND_COLORS[kind] || KIND_COLORS.default

    if (hasChildren) {
      const headerH = NODE_H
      const childStartY = cursorY + headerH + NODE_GAP_Y
      const childStartX = startX + SCOPE_PAD
      const childBottom = layoutOutlineNodes(item.children, depth + 1, childStartX, childStartY)
      const scopeW = Math.max(NODE_MIN_W + SCOPE_PAD * 2, getSubtreeWidth(item.children) + SCOPE_PAD * 2)
      const scopeH = childBottom - cursorY + SCOPE_PAD

      canvasNodes.push({
        type: 'scope',
        x: startX, y: cursorY,
        w: scopeW, h: scopeH,
        label: item.name,
        kind: item.kind || kind,
        detail: item.detail,
        colors,
        depth
      })

      canvasNodes.push({
        type: 'node',
        x: startX + SCOPE_PAD, y: cursorY + 6,
        w: NODE_MIN_W, h: NODE_H - 12,
        label: item.name,
        kind: item.kind || kind,
        detail: item.detail,
        colors,
        depth: depth + 1
      })

      cursorY += scopeH + NODE_GAP_Y
    } else {
      canvasNodes.push({
        type: 'node',
        x: startX, y: cursorY,
        w: NODE_MIN_W, h: NODE_H,
        label: item.name,
        kind: item.kind || kind,
        detail: item.detail,
        colors,
        depth
      })
      cursorY += NODE_H + NODE_GAP_Y
    }
  }
  return cursorY
}

function getSubtreeWidth(items) {
  let maxW = NODE_MIN_W
  for (const item of items) {
    if (item.children && item.children.length) {
      maxW = Math.max(maxW, getSubtreeWidth(item.children) + SCOPE_PAD * 2)
    }
  }
  return maxW
}

function drawOutlineCanvas() {
  const canvas = els.flowOutlineCanvas
  if (!canvas) return
  const container = els.flowCanvasContainer
  const dpr = window.devicePixelRatio || 1
  const w = container.clientWidth
  const h = container.clientHeight || 500
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'

  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  if (!canvasNodes.length) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#6b7280'
    ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Load a flow definition to see the outline', w / 2, h / 2)
    return
  }

  ctx.save()
  ctx.translate(w / 2, 20)
  ctx.scale(canvasView.scale, canvasView.scale)
  ctx.translate(canvasView.x, canvasView.y)

  const isDark = document.documentElement.classList.contains('dark')
  const borderColor = isDark ? '#27272a' : '#e5e7eb'
  const textColor = isDark ? '#e4e4e7' : '#111111'
  const mutedColor = isDark ? '#71717a' : '#6b7280'

  // Draw scopes first (backgrounds)
  for (const node of canvasNodes) {
    if (node.type !== 'scope') continue
    ctx.fillStyle = isDark ? adjustAlpha(node.colors.bg, 0.15) : node.colors.bg
    ctx.strokeStyle = node.colors.border
    ctx.lineWidth = 1.5
    roundRect(ctx, node.x, node.y, node.w, node.h, 10)
    ctx.fill()
    ctx.stroke()
  }

  // Draw connectors between sequential nodes
  const regularNodes = canvasNodes.filter(n => n.type === 'node')
  for (let i = 0; i < regularNodes.length - 1; i++) {
    const a = regularNodes[i]
    const b = regularNodes[i + 1]
    if (a.depth !== b.depth) continue
    const ax = a.x + a.w / 2
    const ay = a.y + a.h
    const bx = b.x + b.w / 2
    const by = b.y
    ctx.strokeStyle = borderColor
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax, ay + NODE_GAP_Y / 2)
    if (Math.abs(ax - bx) > 1) {
      ctx.lineTo(bx, ay + NODE_GAP_Y / 2)
    }
    ctx.lineTo(bx, by)
    ctx.stroke()

    // Arrow dot
    ctx.fillStyle = borderColor
    ctx.beginPath()
    ctx.arc(bx, by, CONNECTOR_R, 0, Math.PI * 2)
    ctx.fill()
  }

  // Draw nodes
  for (const node of canvasNodes) {
    if (node.type !== 'node') continue
    ctx.fillStyle = isDark ? adjustAlpha(node.colors.bg, 0.25) : node.colors.bg
    ctx.strokeStyle = node.colors.border
    ctx.lineWidth = 1.5
    roundRect(ctx, node.x, node.y, node.w, node.h, 8)
    ctx.fill()
    ctx.stroke()

    // Kind badge
    ctx.fillStyle = node.colors.text
    ctx.font = 'bold 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.textAlign = 'left'
    const kindText = (node.kind || '').toUpperCase()
    ctx.fillText(kindText, node.x + 10, node.y + 14)

    // Name
    ctx.fillStyle = textColor
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    const maxTextW = node.w - 20
    let nameText = node.label || ''
    if (ctx.measureText(nameText).width > maxTextW) {
      while (nameText.length > 3 && ctx.measureText(nameText + '\u2026').width > maxTextW) {
        nameText = nameText.slice(0, -1)
      }
      nameText += '\u2026'
    }
    ctx.fillText(nameText, node.x + 10, node.y + 30)

    // Detail
    if (node.detail) {
      ctx.fillStyle = mutedColor
      ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      let detailText = node.detail
      if (ctx.measureText(detailText).width > maxTextW) {
        while (detailText.length > 3 && ctx.measureText(detailText + '\u2026').width > maxTextW) {
          detailText = detailText.slice(0, -1)
        }
        detailText += '\u2026'
      }
      ctx.fillText(detailText, node.x + 10, node.y + 42)
    }
  }

  ctx.restore()
}

function fitCanvas() {
  if (!canvasNodes.length) { drawOutlineCanvas(); return }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of canvasNodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.w)
    maxY = Math.max(maxY, n.y + n.h)
  }
  const container = els.flowCanvasContainer
  const cw = container.clientWidth || 600
  const ch = container.clientHeight || 400
  const contentW = maxX - minX + 60
  const contentH = maxY - minY + 60
  canvasView.scale = Math.min(1.5, Math.min((cw - 40) / contentW, (ch - 40) / contentH))
  canvasView.x = -(minX + maxX) / 2
  canvasView.y = -(minY) + 10
  drawOutlineCanvas()
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function adjustAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')'
}

function toCompletionOption(item) {
  return {
    label: item.label,
    type: item.type,
    detail: item.detail,
    info: item.info,
    apply: item.apply
  }
}

async function loadFlowRuns(flow) {
  const env = getGlobalEnvironment()
  if (!env) return
  els.flowRuns.innerHTML = '<div class="empty">Loading runs\u2026</div>'
  try {
    const result = await api('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({ environment: env, api: 'flow', method: 'GET', path: '/flows/' + flowIdentifier(flow) + '/runs?$top=20' })
    })
    const data = result.data && result.data.response
    currentRuns = (data && data.value) || []
    renderRuns()
  } catch {
    currentRuns = []
    els.flowRuns.innerHTML = '<div class="empty">Could not load runs.</div>'
  }
}

function renderRuns() {
  if (!currentRuns.length) {
    els.flowRuns.innerHTML = '<div class="empty">No recent runs.</div>'
    return
  }
  const textFilter = (els.flowRunFilter.value || '').toLowerCase().trim()
  const statusFilter = els.flowRunStatusFilter.value || ''
  const filteredRuns = currentRuns
    .map((run, index) => ({ run, index }))
    .filter(({ run }) => {
      const status = prop(run, 'properties.status') || ''
      const trigger = prop(run, 'properties.trigger.name') || ''
      const haystack = [run.name || '', status, trigger].join(' ').toLowerCase()
      return (!statusFilter || status === statusFilter) && (!textFilter || haystack.includes(textFilter))
    })
    .sort((a, b) => statusRank(prop(a.run, 'properties.status')) - statusRank(prop(b.run, 'properties.status')))

  if (!filteredRuns.length) {
    els.flowRuns.innerHTML = '<div class="empty">No runs match the current filters.</div>'
    return
  }

  els.flowRuns.innerHTML = filteredRuns.map(({ run: r, index: i }) => {
    const status = prop(r, 'properties.status') || 'Unknown'
    const startTime = prop(r, 'properties.startTime')
    const endTime = prop(r, 'properties.endTime')
    const trigger = prop(r, 'properties.trigger.name') || ''
    const cls = status === 'Succeeded' ? 'ok' : status === 'Failed' ? 'error' : status === 'Running' ? 'pending' : 'pending'
    const active = currentRun && currentRun.name === r.name ? ' active' : ''
    const duration = startTime && endTime ? formatDuration(new Date(startTime), new Date(endTime)) : ''
    return '<div class="run-item status-' + cls + active + '" data-run-idx="' + i + '">' +
      '<div class="run-main">' +
        '<span class="health-dot ' + cls + '"></span>' +
        '<div class="run-text">' +
          '<div class="run-status">' + esc(status) + '</div>' +
          '<div class="run-sub">' +
            (trigger ? '<span class="action-item-type">' + esc(trigger) + '</span>' : '') +
            (duration ? '<span class="run-duration">' + esc(duration) + '</span>' : '') +
            (r.name ? '<span class="action-item-type">' + esc(shortId(r.name)) + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<span class="run-time">' + esc(formatDate(startTime)) + '</span>' +
    '</div>'
  }).join('')

  els.flowRuns.onclick = (e) => {
    const item = e.target.closest('[data-run-idx]')
    if (!item) return
    const idx = parseInt(item.dataset.runIdx, 10)
    const run = currentRuns[idx]
    if (run) {
      currentRun = run
      renderRuns()
      loadRunActions(run).catch(() => {})
    }
  }
}

async function loadRunActions(run) {
  if (!currentFlow) return
  const env = getGlobalEnvironment()
  if (!env) return

  showView('actions')

  const flowName = prop(currentFlow, 'properties.displayName') || currentFlow.name || 'Flow'
  const bcEl = document.getElementById('flow-actions-breadcrumb')
  if (bcEl) {
    bcEl.innerHTML =
      '<span class="flow-breadcrumb-item" data-bc-runs>Runs</span>' +
      '<span class="flow-breadcrumb-sep">\u203A</span>' +
      '<span class="flow-breadcrumb-current">' + esc(shortId(run.name)) + '</span>'
    bcEl.querySelector('[data-bc-runs]').addEventListener('click', () => {
      currentRun = null
      currentActions = []
      currentAction = null
      showView('runs')
    })
  }

  const status = prop(run, 'properties.status') || 'Unknown'
  const startTime = prop(run, 'properties.startTime')
  const endTime = prop(run, 'properties.endTime')
  const duration = startTime && endTime ? formatDuration(new Date(startTime), new Date(endTime)) : '-'
  const statusCls = status === 'Succeeded' ? 'ok' : status === 'Failed' ? 'error' : 'pending'
  els.flowRunSummary.innerHTML =
    '<div class="run-summary-grid">' +
      summaryCard('Status', status) +
      summaryCard('Trigger', prop(run, 'properties.trigger.name') || '-') +
      summaryCard('Started', formatDate(startTime)) +
      summaryCard('Duration', duration) +
    '</div>'

  els.flowActions.innerHTML = '<div class="empty">Loading actions\u2026</div>'

  try {
    const result = await api('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({ environment: env, api: 'flow', method: 'GET', path: '/flows/' + flowIdentifier(currentFlow) + '/runs/' + run.name + '/actions' })
    })
    const data = result.data && result.data.response
    currentActions = (data && data.value) || []
    renderActions()
  } catch {
    currentActions = []
    els.flowActions.innerHTML = '<div class="empty">Could not load actions.</div>'
  }
}

function renderActions() {
  if (!currentActions.length) {
    els.flowActions.innerHTML = '<div class="empty">No actions in this run.</div>'
    return
  }
  const textFilter = (els.flowActionFilter.value || '').toLowerCase().trim()
  const statusFilter = els.flowActionStatusFilter.value || ''
  const filteredActions = currentActions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => {
      const name = action.name || ''
      const status = prop(action, 'properties.status') || ''
      const type = prop(action, 'properties.type') || ''
      const code = prop(action, 'properties.code') || ''
      const haystack = [name, status, type, code].join(' ').toLowerCase()
      return (!statusFilter || status === statusFilter) && (!textFilter || haystack.includes(textFilter))
    })
    .sort((a, b) => statusRank(prop(a.action, 'properties.status')) - statusRank(prop(b.action, 'properties.status')))

  if (!filteredActions.length) {
    els.flowActions.innerHTML = '<div class="empty">No actions match the current filters.</div>'
    return
  }

  const counts = summarizeActionCounts(currentActions)
  els.flowActions.innerHTML =
    '<div class="run-summary-grid" style="margin-bottom:12px">' +
      summaryCard('Actions', String(currentActions.length)) +
      summaryCard('Failed', String(counts.Failed || 0)) +
      summaryCard('Running', String(counts.Running || 0)) +
      summaryCard('Succeeded', String(counts.Succeeded || 0)) +
    '</div>' +
    filteredActions.map(({ action: a, index: i }) => {
    const name = a.name || 'Unknown'
    const status = prop(a, 'properties.status') || 'Unknown'
    const type = prop(a, 'properties.type') || ''
    const startTime = prop(a, 'properties.startTime')
    const endTime = prop(a, 'properties.endTime')
    const cls = status === 'Succeeded' ? 'ok' : status === 'Failed' ? 'error' : status === 'Skipped' ? 'pending' : 'pending'
    const active = currentAction && currentAction.name === a.name ? ' active' : ''
    const duration = startTime && endTime ? formatDuration(new Date(startTime), new Date(endTime)) : ''
    const code = prop(a, 'properties.code') || ''
    return '<div class="action-item' + active + '" data-action-idx="' + i + '">' +
      '<span class="health-dot ' + cls + '"></span>' +
      '<span class="action-item-name" title="' + esc(name) + '">' + esc(name) + '</span>' +
      '<div class="action-item-meta">' +
        '<span class="action-item-type">' + esc(status) + '</span>' +
        (type ? '<span class="action-item-type">' + esc(type) + '</span>' : '') +
        (code && code !== status ? '<span class="action-item-type">' + esc(code) + '</span>' : '') +
        (duration ? '<span class="run-duration">' + esc(duration) + '</span>' : '') +
      '</div>' +
    '</div>'
  }).join('')

  els.flowActions.onclick = (e) => {
    const item = e.target.closest('[data-action-idx]')
    if (!item) return
    const idx = parseInt(item.dataset.actionIdx, 10)
    const action = currentActions[idx]
    if (action) {
      currentAction = action
      renderActions()
      loadActionDetail(action).catch(() => {})
    }
  }
}

async function loadActionDetail(action) {
  if (!currentFlow || !currentRun) return
  const env = getGlobalEnvironment()
  if (!env) return

  showView('action-detail')

  const bcEl = document.getElementById('flow-action-breadcrumb')
  if (bcEl) {
    bcEl.innerHTML =
      '<span class="flow-breadcrumb-item" data-bc-runs>Runs</span>' +
      '<span class="flow-breadcrumb-sep">\u203A</span>' +
      '<span class="flow-breadcrumb-item" data-bc-actions>' + esc(shortId(currentRun.name)) + '</span>' +
      '<span class="flow-breadcrumb-sep">\u203A</span>' +
      '<span class="flow-breadcrumb-current">' + esc(action.name) + '</span>'
    bcEl.querySelector('[data-bc-runs]').addEventListener('click', () => {
      currentRun = null
      currentActions = []
      currentAction = null
      showView('runs')
    })
    bcEl.querySelector('[data-bc-actions]').addEventListener('click', () => {
      currentAction = null
      showView('actions')
    })
  }

  els.flowActionTitle.textContent = action.name || 'Action Detail'

  const status = prop(action, 'properties.status') || '-'
  const type = prop(action, 'properties.type') || '-'
  const code = prop(action, 'properties.code') || '-'
  const startTime = prop(action, 'properties.startTime')
  const endTime = prop(action, 'properties.endTime')
  const duration = startTime && endTime ? formatDuration(new Date(startTime), new Date(endTime)) : '-'
  const error = prop(action, 'properties.error')

  const metrics = [
    ['Status', status],
    ['Type', type],
    ['Code', code],
    ['Started', formatDate(startTime)],
    ['Duration', duration]
  ]
  els.flowActionMetrics.innerHTML = metrics.map(m =>
    '<div class="metric"><div class="metric-label">' + esc(m[0]) + '</div><div class="metric-value">' + esc(m[1]) + '</div></div>'
  ).join('')

  // Try to load full action detail with inputs/outputs
  els.flowActionIo.innerHTML = '<div class="empty">Loading inputs and outputs\u2026</div>'

  try {
    const result = await api('/api/request/execute', {
      method: 'POST',
      body: JSON.stringify({
        environment: env,
        api: 'flow',
        method: 'GET',
        path: '/flows/' + flowIdentifier(currentFlow) + '/runs/' + currentRun.name + '/actions/' + action.name
      })
    })
    const detail = result.data && result.data.response
    const inputs = prop(detail, 'properties.inputsLink')
    const outputs = prop(detail, 'properties.outputsLink')
    const inlineInputs = prop(detail, 'properties.inputs')
    const inlineOutputs = prop(detail, 'properties.outputs')
    const errorDetail = prop(detail, 'properties.error')

    let html = ''

    if (errorDetail) {
      html += '<div class="action-io-section">' +
        '<h3>Error</h3>' +
        '<pre class="viewer" style="border-left:3px solid var(--danger)">' + highlightJson(errorDetail) + '</pre>' +
      '</div>'
    }

    if (inlineInputs !== undefined && inlineInputs !== null) {
      html += '<div class="action-io-section">' +
        '<h3>Inputs</h3>' +
        '<pre class="viewer">' + highlightJson(inlineInputs) + '</pre>' +
      '</div>'
    } else if (inputs && inputs.uri) {
      html += '<div class="action-io-section">' +
        '<h3>Inputs</h3>' +
        '<div style="margin-bottom:8px"><button class="btn btn-secondary" data-fetch-link="input" data-link-uri="' + esc(inputs.uri) + '" style="font-size:0.75rem;padding:5px 12px">Fetch inputs</button></div>' +
        '<pre class="viewer" id="action-input-content" style="display:none"></pre>' +
      '</div>'
    }

    if (inlineOutputs !== undefined && inlineOutputs !== null) {
      html += '<div class="action-io-section">' +
        '<h3>Outputs</h3>' +
        '<pre class="viewer">' + highlightJson(inlineOutputs) + '</pre>' +
      '</div>'
    } else if (outputs && outputs.uri) {
      html += '<div class="action-io-section">' +
        '<h3>Outputs</h3>' +
        '<div style="margin-bottom:8px"><button class="btn btn-secondary" data-fetch-link="output" data-link-uri="' + esc(outputs.uri) + '" style="font-size:0.75rem;padding:5px 12px">Fetch outputs</button></div>' +
        '<pre class="viewer" id="action-output-content" style="display:none"></pre>' +
      '</div>'
    }

    if (!html && !errorDetail) {
      // Show raw properties if no structured I/O
      const rawProps = prop(detail, 'properties')
      html = '<div class="action-io-section">' +
        '<h3>Properties</h3>' +
        '<pre class="viewer">' + highlightJson(rawProps) + '</pre>' +
      '</div>'
    }

    els.flowActionIo.innerHTML = html || '<div class="empty">No input/output data available.</div>'

    // Wire up fetch buttons for linked content
    els.flowActionIo.querySelectorAll('[data-fetch-link]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uri = btn.dataset.linkUri
        const kind = btn.dataset.fetchLink
        const contentEl = document.getElementById('action-' + kind + '-content')
        btn.textContent = 'Loading\u2026'
        btn.disabled = true
        try {
          const resp = await fetch(uri)
          const text = await resp.text()
          let parsed
          try { parsed = JSON.parse(text) } catch { parsed = text }
          if (contentEl) {
            contentEl.innerHTML = highlightJson(parsed)
            contentEl.style.display = ''
          }
          btn.textContent = 'Fetched'
        } catch (err) {
          if (contentEl) {
            contentEl.textContent = 'Failed to fetch: ' + (err.message || err)
            contentEl.style.display = ''
          }
          btn.textContent = 'Failed'
        }
      })
    })

  } catch {
    // Fall back to inline properties from the action list item
    const inlineInputs = prop(action, 'properties.inputs')
    const inlineOutputs = prop(action, 'properties.outputs')
    let html = ''
    if (error) {
      html += '<div class="action-io-section"><h3>Error</h3><pre class="viewer" style="border-left:3px solid var(--danger)">' + highlightJson(error) + '</pre></div>'
    }
    if (inlineInputs) {
      html += '<div class="action-io-section"><h3>Inputs</h3><pre class="viewer">' + highlightJson(inlineInputs) + '</pre></div>'
    }
    if (inlineOutputs) {
      html += '<div class="action-io-section"><h3>Outputs</h3><pre class="viewer">' + highlightJson(inlineOutputs) + '</pre></div>'
    }
    els.flowActionIo.innerHTML = html || '<div class="empty">Could not load action detail.</div>'
  }
}

function prop(obj, path) {
  return path.split('.').reduce((o, k) => o && o[k], obj)
}

function flowIdentifier(flow) {
  return flow && (flow.workflowid || flow.name)
}

function normalizeFlowApiItem(flow) {
  return {
    ...flow,
    source: 'flow',
    workflowid: flow.workflowid || flow.name,
    properties: {
      ...(flow.properties || {}),
      displayName: prop(flow, 'properties.displayName') || flow.name || 'Unnamed',
      definition: prop(flow, 'properties.definition'),
      connectionReferences: prop(flow, 'properties.connectionReferences')
    }
  }
}

function normalizeDataverseFlow(flow) {
  const definition = parseClientdataDefinition(flow.clientdata)
  const triggerEntries = Object.entries((definition && definition.triggers) || {})
  const actionEntries = Object.entries((definition && definition.actions) || {})
  return {
    source: 'dv',
    name: flow.name,
    workflowid: flow.workflowid,
    properties: {
      displayName: flow.name || flow.workflowid || 'Unnamed',
      description: flow.description || '',
      state: flow.statecode === 0 ? 'Started' : flow.statecode === 1 ? 'Stopped' : 'Unknown',
      createdTime: flow.createdon,
      lastModifiedTime: flow.modifiedon,
      creator: { objectId: flow._ownerid_value || '' },
      definition,
      connectionReferences: parseClientdataConnectionReferences(flow.clientdata),
      definitionSummary: {
        triggers: triggerEntries.map(([name, value]) => ({ name, type: value && value.type ? value.type : '-' })),
        actions: actionEntries.map(([name, value]) => ({ name, type: value && value.type ? value.type : '-' }))
      }
    }
  }
}

function parseClientdataDefinition(clientdata) {
  if (!clientdata) return null
  try {
    const parsed = JSON.parse(clientdata)
    return parsed && parsed.properties && parsed.properties.definition ? parsed.properties.definition : null
  } catch {
    return null
  }
}

function parseClientdataConnectionReferences(clientdata) {
  if (!clientdata) return null
  try {
    const parsed = JSON.parse(clientdata)
    return parsed && parsed.properties && parsed.properties.connectionReferences
      ? parsed.properties.connectionReferences
      : null
  } catch {
    return null
  }
}

function formatDate(value) {
  if (!value) return '-'
  try {
    const d = new Date(value)
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch { return String(value) }
}

function formatDateShort(value) {
  if (!value) return '-'
  try {
    const d = new Date(value)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch { return String(value) }
}

function formatDuration(start, end) {
  const ms = end - start
  if (ms < 0) return '-'
  if (ms < 1000) return ms + 'ms'
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return secs + 's'
  const mins = Math.floor(secs / 60)
  const remainSecs = secs % 60
  if (mins < 60) return mins + 'm ' + remainSecs + 's'
  const hours = Math.floor(mins / 60)
  return hours + 'h ' + (mins % 60) + 'm'
}

function statusRank(status) {
  switch (status) {
    case 'Failed': return 0
    case 'Running': return 1
    case 'Cancelled': return 2
    case 'Skipped': return 3
    case 'Succeeded': return 4
    default: return 5
  }
}

function summarizeActionCounts(actions) {
  const counts = {}
  for (const action of actions) {
    const status = prop(action, 'properties.status') || 'Unknown'
    counts[status] = (counts[status] || 0) + 1
  }
  return counts
}

function summaryCard(label, value) {
  return '<div class="run-summary-card"><div class="run-summary-card-label">' + esc(label) + '</div><div class="run-summary-card-value">' + esc(value) + '</div></div>'
}

function shortId(value) {
  const text = String(value || '')
  return text.length > 12 ? text.slice(0, 8) + '…' + text.slice(-4) : text
}
`;
}
