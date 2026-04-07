export function renderAppModule(): string {
  return String.raw`
import { app, api, applyAccountKindVisibility, registerTabHandlers, renderMeta, optionMarkup, getGlobalEnvironment, loadEntities, toast } from '/assets/ui/shared.js'
import { initSetup, renderSetupState, runInitialHealthChecks } from '/assets/ui/setup.js'
import { initExplorer, renderExplorerEntities } from '/assets/ui/explorer.js'
import { initQueryLab, useEntityInQuery, updateQueryContext } from '/assets/ui/query-lab.js'
import { initFetchXml, useEntityInFetchXml, updateFetchContext } from '/assets/ui/fetchxml.js'

const globalEnv = document.getElementById('global-environment')
let lastEnv = ''

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
  try {
    await loadEntities(env)
    renderExplorerEntities()
    updateQueryContext()
    updateFetchContext()
    toast('Loaded ' + app.entities.length + ' entities')
  } catch (err) {
    toast(err.message, true)
  }
}

globalEnv.addEventListener('change', () => {
  app.entitiesEnvironment = null
  lastEnv = ''
  onEnvironmentChange().catch((err) => toast(err.message, true))
})

function bootstrap() {
  registerTabHandlers()
  document.getElementById('account-kind').addEventListener('change', applyAccountKindVisibility)
  applyAccountKindVisibility()

  initSetup(refreshState)
  initExplorer({ useEntityInQuery, useEntityInFetchXml })
  initQueryLab()
  initFetchXml()

  refreshState(true).catch((error) => toast(error.message, true))
}

bootstrap()
`;
}
