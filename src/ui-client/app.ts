export function renderAppModule(): string {
  return String.raw`
import { app, applyAccountKindVisibility, registerTabHandlers, renderMeta, showLastResponse, toast } from '/assets/ui/shared.js'
import { initSetup, renderSetupState } from '/assets/ui/setup.js'
import { initExplorer } from '/assets/ui/explorer.js'
import { initQueryLab, useEntityInQuery } from '/assets/ui/query-lab.js'
import { initFetchXml, useEntityInFetchXml } from '/assets/ui/fetchxml.js'
import { api } from '/assets/ui/shared.js'

async function refreshState(silent) {
  const payload = await api('/api/state')
  app.state = payload
  renderMeta(payload.data)
  renderSetupState(payload.data)
  if (!silent) toast('State refreshed')
}

function bootstrap() {
  showLastResponse('Waiting for the first response...')
  registerTabHandlers()
  document.getElementById('account-kind').addEventListener('change', applyAccountKindVisibility)
  applyAccountKindVisibility()

  initSetup(refreshState)
  initQueryLab()
  initFetchXml()
  initExplorer({
    useEntityInQuery,
    useEntityInFetchXml
  })

  refreshState(true).catch((error) => toast(error.message, true))
}

bootstrap()
`;
}
