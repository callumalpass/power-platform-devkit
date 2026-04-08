export function renderAppModule(): string {
  return String.raw`
import { app, api, applyAccountKindVisibility, renderMeta, optionMarkup, getGlobalEnvironment, loadEntities, setTab, toast } from '/assets/ui/shared.js'
import { initSetup, renderSetupState, runInitialHealthChecks } from '/assets/ui/setup.js'
import { initExplorer, renderExplorerEntities } from '/assets/ui/explorer.js'
import { initQueryLab, useEntityInQuery, updateQueryContext } from '/assets/ui/query-lab.js'
import { initFetchXml, useEntityInFetchXml, updateFetchContext } from '/assets/ui/fetchxml.js'
import { initConsole } from '/assets/ui/console.js'
import { initAutomate, loadFlows, resetFlows } from '/assets/ui/automate.js'
import { initApps, loadApps, resetApps } from '/assets/ui/apps.js'
import { initPlatform, loadPlatformEnvironments, resetPlatform } from '/assets/ui/platform.js'

const globalEnv = document.getElementById('global-environment')
let lastEnv = ''
let activeWorkspace = 'dataverse'
let entitiesNeedReload = true

async function refreshState(silent) {
  const payload = await api('/api/state')
  app.state = payload
  renderMeta(payload.data)
  renderSetupState(payload.data)

  const environments = (payload.data.environments || []).map((e) => e.alias)
  const prev = globalEnv.value
  globalEnv.innerHTML = optionMarkup(environments, 'Select environment')
  if (prev && environments.includes(prev)) globalEnv.value = prev
  else if (environments.length) globalEnv.value = environments[0]

  runInitialHealthChecks(payload.data)
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
  try {
    if (activeWorkspace === 'dataverse' && entitiesNeedReload) {
      await loadEntities(getGlobalEnvironment())
      entitiesNeedReload = false
      renderExplorerEntities()
      updateQueryContext()
      updateFetchContext()
      toast('Loaded ' + app.entities.length + ' entities')
    } else if (activeWorkspace === 'automate') {
      await loadFlows()
    } else if (activeWorkspace === 'apps') {
      await loadApps()
    } else if (activeWorkspace === 'platform') {
      await loadPlatformEnvironments()
    }
  } catch (err) {
    toast(err.message, true)
  }
}

globalEnv.addEventListener('change', () => {
  app.entitiesEnvironment = null
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

// Listen for pp:open-console custom events from workspace modules
window.addEventListener('pp:open-console', (e) => {
  const detail = e.detail || {}
  setTab('console')
  onTabChange('console')
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

function bootstrap() {
  // Wrap registerTabHandlers to hook into tab changes
  const origSetTab = (tab) => {
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
  initDvSubTabs()

  refreshState(true).catch((error) => toast(error.message, true))
}

bootstrap()
`;
}
