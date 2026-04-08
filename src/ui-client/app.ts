export function renderAppModule(): string {
  return String.raw`
import { api, applyAccountKindVisibility, renderMeta, optionMarkup, getGlobalEnvironment, loadEntities, setTab, showLoading, toast } from '/assets/ui/shared.js'
import { clearDataverseSelection, getDataverseState, setShellPayload } from '/assets/ui/state.js'
import { setGlobalEnvironment } from '/assets/ui/runtime.js'
import { initSetup, renderSetupState, runInitialHealthChecks } from '/assets/ui/setup.js'
import { initExplorer, renderExplorerEntities } from '/assets/ui/explorer.js'
import { initQueryLab, useEntityInQuery, updateQueryContext } from '/assets/ui/query-lab.js'
import { initFetchXml, useEntityInFetchXml, updateFetchContext } from '/assets/ui/fetchxml.js'
import { initConsole } from '/assets/ui/console.js'
import { initAutomate, loadFlows, resetFlows } from '/assets/ui/automate.js'
import { initApps, loadApps, resetApps } from '/assets/ui/apps.js'
import { initPlatform, loadPlatformEnvironments, resetPlatform } from '/assets/ui/platform.js'
import { initRelationships, updateRelationshipsEntityList } from '/assets/ui/relationships.js'

const globalEnv = document.getElementById('global-environment')
let lastEnv = ''
let activeWorkspace = 'dataverse'
let entitiesNeedReload = true

const workspaceContainers = {
  dataverse: () => document.getElementById('dv-workspace-area'),
  automate: () => document.querySelector('#panel-automate .detail-area'),
  apps: () => document.querySelector('#panel-apps .detail-area'),
  platform: () => document.querySelector('#panel-platform .detail-area')
}

async function refreshState(silent) {
  const payload = await api('/api/state')
  setShellPayload(payload)
  renderMeta(payload.data)
  renderSetupState(payload.data)

  const environments = (payload.data.environments || []).map((e) => e.alias)
  const prev = globalEnv.value
  globalEnv.innerHTML = optionMarkup(environments, 'Select environment')
  if (prev && environments.includes(prev)) setGlobalEnvironment(prev)
  else if (environments.length) setGlobalEnvironment(environments[0])
  else setGlobalEnvironment('')

  runInitialHealthChecks(payload.data)
  updateEmptyStates(payload.data)
  if (!silent) toast('State refreshed')
  await onEnvironmentChange()
}

async function onEnvironmentChange() {
  const env = getGlobalEnvironment()
  if (!env || env === lastEnv) return
  lastEnv = env

  entitiesNeedReload = true
  resetFlows()
  resetApps()
  resetPlatform()

  await loadWorkspaceData()
}

async function loadWorkspaceData() {
  const containerFn = workspaceContainers[activeWorkspace]
  const container = containerFn && containerFn()
  let hideLoading = null

  try {
    if (activeWorkspace === 'dataverse' && entitiesNeedReload) {
      if (container) hideLoading = showLoading(container, 'Loading entities\u2026')
      await loadEntities(getGlobalEnvironment())
      entitiesNeedReload = false
      renderExplorerEntities()
      updateQueryContext()
      updateFetchContext()
      updateRelationshipsEntityList()
      toast('Loaded ' + getDataverseState().entities.length + ' entities')
    } else if (activeWorkspace === 'automate') {
      if (container) hideLoading = showLoading(container, 'Loading flows\u2026')
      await loadFlows()
    } else if (activeWorkspace === 'apps') {
      if (container) hideLoading = showLoading(container, 'Loading apps\u2026')
      await loadApps()
    } else if (activeWorkspace === 'platform') {
      if (container) hideLoading = showLoading(container, 'Loading environments\u2026')
      await loadPlatformEnvironments()
    }
  } catch (err) {
    toast(err.message, true)
  } finally {
    if (hideLoading) hideLoading()
  }
}

function updateEmptyStates(data) {
  const hasAccounts = (data.accounts || []).length > 0
  const hasEnvs = (data.environments || []).length > 0
  const emptyContainers = document.querySelectorAll('[data-empty-cta]')
  for (const el of emptyContainers) el.remove()

  if (!hasAccounts) {
    const panels = ['panel-dataverse', 'panel-automate', 'panel-apps', 'panel-platform', 'panel-console']
    for (const panelId of panels) {
      const panel = document.getElementById(panelId)
      if (!panel) continue
      const existing = panel.querySelector('.empty-cta')
      if (existing) existing.remove()
      const cta = document.createElement('div')
      cta.className = 'empty-cta'
      cta.setAttribute('data-empty-cta', '')
      cta.innerHTML = '<div class="empty-cta-icon">\u{1F511}</div><p>No accounts configured yet.<br>Add an account in Setup to get started.</p>' +
        '<button class="btn btn-primary" data-goto-setup>Go to Setup</button>'
      cta.querySelector('[data-goto-setup]').addEventListener('click', () => {
        origSetTab('setup')
        document.getElementById('add-account-section').open = true
      })
      panel.prepend(cta)
    }
  } else if (!hasEnvs) {
    const panels = ['panel-dataverse', 'panel-automate', 'panel-apps', 'panel-platform']
    for (const panelId of panels) {
      const panel = document.getElementById(panelId)
      if (!panel) continue
      const existing = panel.querySelector('.empty-cta')
      if (existing) existing.remove()
      const cta = document.createElement('div')
      cta.className = 'empty-cta'
      cta.setAttribute('data-empty-cta', '')
      cta.innerHTML = '<div class="empty-cta-icon">\u{1F310}</div><p>No environments configured.<br>Add an environment in Setup to start exploring.</p>' +
        '<button class="btn btn-primary" data-goto-setup>Go to Setup</button>'
      cta.querySelector('[data-goto-setup]').addEventListener('click', () => origSetTab('setup'))
      panel.prepend(cta)
    }
  }
}

globalEnv.addEventListener('change', () => {
  clearDataverseSelection()
  lastEnv = ''
  onEnvironmentChange().catch((err) => toast(err.message, true))
})

function initDvSubTabs() {
  const area = document.getElementById('dv-workspace-area')
  area.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-dvtab]')
    if (!tab) return
    area.querySelectorAll('.dv-sub-nav .sub-tab').forEach((t) => t.classList.toggle('active', t === tab))
    area.querySelectorAll('.dv-subpanel').forEach((p) => p.classList.toggle('active', p.id === 'dv-subpanel-' + tab.dataset.dvtab))
  })
}

function onTabChange(tabName) {
  activeWorkspace = tabName
  if (getGlobalEnvironment()) {
    loadWorkspaceData().catch((err) => toast(err.message, true))
  }
}

let origSetTab

// Listen for pp:open-console custom events from workspace modules
window.addEventListener('pp:open-console', (e) => {
  const detail = e.detail || {}
  origSetTab('console')
  if (detail.api) {
    const apiSelect = document.getElementById('console-api')
    if (apiSelect) apiSelect.value = detail.api
    apiSelect.dispatchEvent(new Event('change'))
  }
  if (detail.method) {
    const methodSelect = document.getElementById('console-method')
    if (methodSelect) methodSelect.value = detail.method
    methodSelect.dispatchEvent(new Event('change'))
  }
  if (detail.path) {
    const pathInput = document.getElementById('console-path')
    if (pathInput) pathInput.value = detail.path
  }
})

// Listen for record link clicks to navigate to Explorer
document.body.addEventListener('click', (e) => {
  const link = e.target.closest('.record-link')
  if (!link) return
  const entity = link.dataset.entity
  if (entity) {
    origSetTab('dataverse')
    // Switch to explorer sub-tab
    const area = document.getElementById('dv-workspace-area')
    if (area) {
      area.querySelectorAll('.dv-sub-nav .sub-tab').forEach((t) => t.classList.toggle('active', t.dataset.dvtab === 'dv-explorer'))
      area.querySelectorAll('.dv-subpanel').forEach((p) => p.classList.toggle('active', p.id === 'dv-subpanel-dv-explorer'))
    }
  }
})

function bootstrap() {
  origSetTab = (tab) => {
    for (const el of document.querySelectorAll('.tab')) el.classList.toggle('active', el.dataset.tab === tab)
    for (const el of document.querySelectorAll('.tab-panel')) el.classList.toggle('active', el.id === 'panel-' + tab)
    window.location.hash = tab
    onTabChange(tab)
  }

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => origSetTab(tab.dataset.tab))
  }
  const hash = window.location.hash.slice(1)
  if (hash && document.getElementById('panel-' + hash)) {
    origSetTab(hash)
  }

  document.getElementById('account-kind').addEventListener('change', applyAccountKindVisibility)
  applyAccountKindVisibility()

  initSetup(refreshState)
  initExplorer({ useEntityInQuery, useEntityInFetchXml })
  initQueryLab()
  initFetchXml()
  initConsole()
  initAutomate()
  initApps()
  initPlatform()
  initRelationships()
  initDvSubTabs()

  refreshState(true).catch((error) => toast(error.message, true))
}

bootstrap()
`;
}
