export function renderDomUtilsModule(): string {
  return String.raw`
import { esc } from '/assets/ui/runtime.js'

export function setTab(tab) {
  for (const el of document.querySelectorAll('.tab')) el.classList.toggle('active', el.dataset.tab === tab)
  for (const el of document.querySelectorAll('.tab-panel')) el.classList.toggle('active', el.id === 'panel-' + tab)
  window.location.hash = tab
}

export function registerTabHandlers() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => setTab(tab.dataset.tab))
  }
  const hash = window.location.hash.slice(1)
  if (hash && document.getElementById('panel-' + hash)) setTab(hash)
}

export function applyAccountKindVisibility() {
  const kind = document.getElementById('account-kind').value
  const form = document.getElementById('account-form')
  form.querySelectorAll('.conditional').forEach((el) => {
    el.classList.toggle('visible', el.classList.contains('cond-' + kind))
  })
}

export function readSelectedValue(id, label) {
  const value = document.getElementById(id).value
  if (!value) throw new Error('Select ' + label + ' first.')
  return value
}

export function registerSubTabs(containerEl) {
  containerEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.sub-tab')
    if (!tab) return
    const parent = tab.closest('.panel')
    parent.querySelectorAll('.sub-tab').forEach((t) => t.classList.toggle('active', t === tab))
    parent.querySelectorAll('.sub-panel').forEach((p) => p.classList.toggle('active', p.id === 'subpanel-' + tab.dataset.subtab))
  })
}

export function updateEntityContext(contextEl, detail) {
  if (!detail) {
    contextEl.innerHTML = '<span class="entity-context-empty">No entity selected \u2014 pick one in Explorer or type below</span>'
    return
  }
  contextEl.innerHTML =
    '<span class="entity-context-name">' + esc(detail.displayName || detail.logicalName) + '</span>' +
    (detail.entitySetName ? '<span class="entity-context-set">' + esc(detail.entitySetName) + '</span>' : '')
}
`;
}
