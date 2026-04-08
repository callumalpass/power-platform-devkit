export function renderRelationshipsModule(): string {
  return String.raw`
import { api, esc, getGlobalEnvironment, toast } from '/assets/ui/shared.js'
import { getDataverseState, subscribe } from '/assets/ui/state.js'

const els = {
  svg: document.getElementById('rel-svg'),
  container: document.getElementById('rel-container'),
  entitySelect: document.getElementById('rel-entity'),
  depthSelect: document.getElementById('rel-depth'),
  hideSystem: document.getElementById('rel-hide-system'),
  loadBtn: document.getElementById('rel-load'),
  status: document.getElementById('rel-status'),
  tooltip: document.getElementById('rel-tooltip')
}

const SYSTEM_ENTITIES = new Set([
  'systemuser', 'team', 'businessunit', 'organization', 'transactioncurrency',
  'calendar', 'activityparty', 'activitypointer', 'principalobjectaccess',
  'principalobjectattributeaccess', 'audit', 'asyncoperation', 'bulkdeletefailure',
  'importdata', 'importfile', 'importlog', 'duplicaterecord', 'duplicaterule',
  'plugintracelog', 'sdkmessageprocessingstep', 'workflow', 'sla', 'slaitem'
])

let nodes = []
let edges = []
let entityCache = {}
let dragNode = null
let dragOffset = { x: 0, y: 0 }
let viewBox = { x: -500, y: -400, w: 1000, h: 800 }
let isPanning = false
let panStart = { x: 0, y: 0 }
let panViewStart = { x: 0, y: 0 }
let lastClickTime = 0
let lastClickNodeId = null
let needsRender = false
let dragMoved = false

const NODE_W = 160
const NODE_H = 44
const NODE_RX = 10

export function initRelationships() {
  els.loadBtn.addEventListener('click', () => loadGraph().catch(e => toast(e.message, true)))

  els.svg.addEventListener('mousedown', onMouseDown)
  els.svg.addEventListener('mousemove', onMouseMove)
  els.svg.addEventListener('mouseup', onMouseUp)
  els.svg.addEventListener('mouseleave', onMouseUp)
  els.svg.addEventListener('wheel', onWheel, { passive: false })
  els.svg.addEventListener('touchstart', onTouchStart, { passive: false })
  els.svg.addEventListener('touchmove', onTouchMove, { passive: false })
  els.svg.addEventListener('touchend', onMouseUp)

  els.svg.addEventListener('click', (e) => {
    if (!e.target.closest('[data-node-id]') && !e.target.closest('#rel-tooltip')) {
      els.tooltip.classList.add('hidden')
    }
  })

  subscribe((scope) => {
    if (scope === 'dataverse') updateRelationshipsEntityList()
  })
}

export function updateRelationshipsEntityList() {
  const dataverse = getDataverseState()
  const prev = els.entitySelect.value
  els.entitySelect.innerHTML = '<option value="">select entity\u2026</option>' +
    dataverse.entities.map(e =>
      '<option value="' + esc(e.logicalName) + '">' + esc((e.displayName || e.logicalName) + ' (' + e.logicalName + ')') + '</option>'
    ).join('')
  if (dataverse.currentEntityDetail) {
    els.entitySelect.value = dataverse.currentEntityDetail.logicalName
  } else if (prev) {
    els.entitySelect.value = prev
  }
}

async function loadGraph() {
  const entity = els.entitySelect.value
  if (!entity) { toast('Select an entity first', true); return }
  const depth = parseInt(els.depthSelect.value, 10) || 1
  const env = getGlobalEnvironment()
  if (!env) { toast('Select an environment first', true); return }

  nodes = []
  edges = []
  entityCache = {}
  els.status.textContent = 'Loading\u2026'

  await loadEntityRelationships(entity, depth, env)
  layoutRadial()
  render()
  els.status.textContent = nodes.length + ' entities, ' + edges.length + ' relationships'
}

async function loadEntityRelationships(entityName, remainingDepth, env) {
  if (entityCache[entityName]) return
  const hideSystem = els.hideSystem.checked
  let detail
  try {
    const payload = await api('/api/dv/entities/' + encodeURIComponent(entityName) + '?environment=' + encodeURIComponent(env))
    detail = payload.data
    entityCache[entityName] = detail
  } catch {
    entityCache[entityName] = { logicalName: entityName, attributes: [], error: true }
    return
  }
  if (!nodes.find(n => n.id === entityName)) {
    nodes.push({
      id: entityName,
      label: detail.displayName || entityName,
      logicalName: entityName,
      isRoot: nodes.length === 0,
      isCustom: detail.isCustomEntity,
      attrCount: (detail.attributes || []).length,
      entitySetName: detail.entitySetName,
      depth: 0,
      x: 0, y: 0
    })
  }
  if (remainingDepth <= 0) return
  const lookups = (detail.attributes || []).filter(a => {
    const type = (a.attributeTypeName || a.attributeType || '').toLowerCase()
    return (type === 'lookuptype' || type === 'lookup' || type === 'customer' || type === 'owner') && a.targets && a.targets.length
  })
  const targets = new Set()
  for (const attr of lookups) {
    for (const target of attr.targets) {
      if (hideSystem && SYSTEM_ENTITIES.has(target)) continue
      if (attr.targets.length > 8) continue
      targets.add(target)
      const edgeId = entityName + '.' + attr.logicalName + '>' + target
      if (!edges.find(e => e.id === edgeId)) {
        edges.push({ id: edgeId, source: entityName, target: target, label: attr.logicalName, displayName: attr.displayName || attr.logicalName })
      }
    }
  }
  const pending = [...targets].filter(t => !entityCache[t])
  for (const t of pending) {
    await loadEntityRelationships(t, remainingDepth - 1, env)
  }
}

async function expandNode(node) {
  const env = getGlobalEnvironment()
  if (!env) return
  els.status.textContent = 'Expanding ' + node.label + '\u2026'
  const before = nodes.length
  await loadEntityRelationships(node.id, 1, env)
  const newNodes = nodes.slice(before)
  const count = newNodes.length
  if (count) {
    const radius = Math.max(180, count * 40)
    newNodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2
      n.x = node.x + Math.cos(angle) * radius
      n.y = node.y + Math.sin(angle) * radius
    })
  }
  render()
  els.status.textContent = nodes.length + ' entities, ' + edges.length + ' relationships'
}

function layoutRadial() {
  if (!nodes.length) return
  const root = nodes[0]
  root.x = 0
  root.y = 0

  const byDepth = new Map()
  const visited = new Set()
  const queue = [{ id: root.id, depth: 0 }]
  visited.add(root.id)

  while (queue.length) {
    const { id, depth } = queue.shift()
    if (!byDepth.has(depth)) byDepth.set(depth, [])
    byDepth.get(depth).push(id)
    for (const edge of edges) {
      const neighbor = edge.source === id ? edge.target : edge.target === id ? edge.source : null
      if (neighbor && !visited.has(neighbor)) {
        visited.add(neighbor)
        queue.push({ id: neighbor, depth: depth + 1 })
      }
    }
  }
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      const d = (byDepth.size || 1)
      if (!byDepth.has(d)) byDepth.set(d, [])
      byDepth.get(d).push(node.id)
    }
  }

  for (const [depth, ids] of byDepth) {
    if (depth === 0) continue
    const radius = depth * 260
    ids.forEach((id, i) => {
      const node = nodes.find(n => n.id === id)
      if (!node) return
      const angle = (2 * Math.PI * i) / ids.length - Math.PI / 2
      node.x = Math.cos(angle) * radius
      node.y = Math.sin(angle) * radius
    })
  }
}

function render() {
  const edgeGroups = {}
  for (const edge of edges) {
    const key = [edge.source, edge.target].sort().join('|')
    if (!edgeGroups[key]) edgeGroups[key] = []
    edgeGroups[key].push(edge)
  }

  const edgesSvg = edges.map(edge => {
    const a = nodes.find(n => n.id === edge.source)
    const b = nodes.find(n => n.id === edge.target)
    if (!a || !b) return ''
    const key = [edge.source, edge.target].sort().join('|')
    const group = edgeGroups[key]
    const idx = group.indexOf(edge)
    const offset = (idx - (group.length - 1) / 2) * 14
    const dx = b.x - a.x, dy = b.y - a.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 1
    const nx = -dy / dist, ny = dx / dist
    const sx = a.x + (dx / dist) * (NODE_W / 2) + nx * offset
    const sy = a.y + (dy / dist) * (NODE_H / 2) + ny * offset
    const tx = b.x - (dx / dist) * (NODE_W / 2) + nx * offset
    const ty = b.y - (dy / dist) * (NODE_H / 2) + ny * offset
    const mx = (sx + tx) / 2 + nx * offset * 0.3
    const my = (sy + ty) / 2 + ny * offset * 0.3
    return '<g class="rel-edge">' +
      '<line x1="' + sx + '" y1="' + sy + '" x2="' + tx + '" y2="' + ty + '" />' +
      '<line x1="' + sx + '" y1="' + sy + '" x2="' + tx + '" y2="' + ty + '" class="rel-edge-hit" />' +
      '<circle cx="' + tx + '" cy="' + ty + '" r="3" class="rel-arrowhead" />' +
      '<text x="' + mx + '" y="' + (my - 6) + '" class="rel-edge-label">' + esc(edge.label) + '</text>' +
    '</g>'
  }).join('')

  const nodesSvg = nodes.map(node => {
    const x = node.x - NODE_W / 2
    const y = node.y - NODE_H / 2
    const cls = node.isRoot ? 'rel-node root' : node.isCustom ? 'rel-node custom' : 'rel-node'
    return '<g class="' + cls + '" data-node-id="' + esc(node.id) + '" transform="translate(' + x + ',' + y + ')">' +
      '<rect width="' + NODE_W + '" height="' + NODE_H + '" rx="' + NODE_RX + '" />' +
      '<text x="' + (NODE_W / 2) + '" y="17" class="rel-node-label">' + esc(node.label) + '</text>' +
      '<text x="' + (NODE_W / 2) + '" y="32" class="rel-node-sub">' + esc(node.logicalName) + '</text>' +
    '</g>'
  }).join('')

  els.svg.innerHTML = edgesSvg + nodesSvg
  els.svg.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h)
}

function scheduleRender() {
  if (needsRender) return
  needsRender = true
  requestAnimationFrame(() => { needsRender = false; render() })
}

function showTooltip(node, event) {
  const detail = entityCache[node.id]
  const lookupCount = detail && detail.attributes ? detail.attributes.filter(a => (a.targets && a.targets.length)).length : 0
  const outEdges = edges.filter(e => e.source === node.id)
  const inEdges = edges.filter(e => e.target === node.id)
  let html = '<strong>' + esc(node.label) + '</strong><br>' +
    '<span style="font-family:var(--mono);font-size:0.6875rem">' + esc(node.logicalName) + '</span><br>' +
    '<span style="color:var(--muted)">' + node.attrCount + ' attrs \u00b7 ' + lookupCount + ' lookups</span>'
  if (node.entitySetName) html += '<br><span style="color:var(--accent);font-size:0.6875rem">' + esc(node.entitySetName) + '</span>'
  if (outEdges.length) html += '<br><span style="font-size:0.625rem;color:var(--muted)">References: ' + outEdges.map(e => esc(e.label)).join(', ') + '</span>'
  if (inEdges.length) html += '<br><span style="font-size:0.625rem;color:var(--muted)">Referenced by: ' + inEdges.map(e => esc(e.source + '.' + e.label)).join(', ') + '</span>'
  html += '<br><span style="font-size:0.625rem;color:var(--accent)">Double-click to expand \u00b7 Drag to move</span>'
  els.tooltip.innerHTML = html
  els.tooltip.classList.remove('hidden')
  const rect = els.container.getBoundingClientRect()
  let tx = event.clientX - rect.left + 12
  let ty = event.clientY - rect.top + 12
  if (tx + 280 > rect.width) tx = rect.width - 290
  if (ty + 200 > rect.height) ty = ty - 200
  els.tooltip.style.left = Math.max(4, tx) + 'px'
  els.tooltip.style.top = Math.max(4, ty) + 'px'
}

function svgPoint(e) {
  const rect = els.svg.getBoundingClientRect()
  return {
    x: ((e.clientX - rect.left) / rect.width) * viewBox.w + viewBox.x,
    y: ((e.clientY - rect.top) / rect.height) * viewBox.h + viewBox.y
  }
}

function onMouseDown(e) {
  const nodeEl = e.target.closest('[data-node-id]')
  if (nodeEl) {
    const node = nodes.find(n => n.id === nodeEl.dataset.nodeId)
    if (!node) return
    dragNode = node
    dragMoved = false
    const pt = svgPoint(e)
    dragOffset.x = pt.x - node.x
    dragOffset.y = pt.y - node.y
    return
  }
  isPanning = true
  panStart = { x: e.clientX, y: e.clientY }
  panViewStart = { x: viewBox.x, y: viewBox.y }
  e.preventDefault()
}

function onMouseMove(e) {
  if (dragNode) {
    dragMoved = true
    const pt = svgPoint(e)
    dragNode.x = pt.x - dragOffset.x
    dragNode.y = pt.y - dragOffset.y
    scheduleRender()
    e.preventDefault()
    return
  }
  if (isPanning) {
    const rect = els.svg.getBoundingClientRect()
    viewBox.x = panViewStart.x - (e.clientX - panStart.x) * (viewBox.w / rect.width)
    viewBox.y = panViewStart.y - (e.clientY - panStart.y) * (viewBox.h / rect.height)
    scheduleRender()
    e.preventDefault()
  }
}

function onMouseUp(e) {
  if (dragNode && !dragMoved) {
    const node = dragNode
    dragNode = null
    const now = Date.now()
    if (lastClickNodeId === node.id && now - lastClickTime < 400) {
      lastClickTime = 0
      lastClickNodeId = null
      els.tooltip.classList.add('hidden')
      expandNode(node).catch(err => toast(err.message, true))
    } else {
      lastClickTime = now
      lastClickNodeId = node.id
      showTooltip(node, e)
    }
    return
  }
  dragNode = null
  isPanning = false
}

function onWheel(e) {
  e.preventDefault()
  const factor = e.deltaY > 0 ? 1.1 : 0.9
  const rect = els.svg.getBoundingClientRect()
  const mx = ((e.clientX - rect.left) / rect.width) * viewBox.w + viewBox.x
  const my = ((e.clientY - rect.top) / rect.height) * viewBox.h + viewBox.y
  viewBox.x = mx - (mx - viewBox.x) * factor
  viewBox.y = my - (my - viewBox.y) * factor
  viewBox.w *= factor
  viewBox.h *= factor
  scheduleRender()
}

function onTouchStart(e) {
  if (e.touches.length === 1) {
    const t = e.touches[0]
    onMouseDown({ clientX: t.clientX, clientY: t.clientY, target: e.target, closest: s => e.target.closest(s), preventDefault: () => e.preventDefault() })
  }
}

function onTouchMove(e) {
  if (e.touches.length === 1) {
    onMouseMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY, preventDefault: () => e.preventDefault() })
  }
}
`;
}
