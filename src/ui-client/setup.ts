export function renderSetupModule(): string {
  return String.raw`
import { app, api, applyAccountKindVisibility, esc, formDataObject, optionMarkup, showLastResponse, summarizeError, toast } from '/assets/ui/shared.js'

const els = {
  refreshState: document.getElementById('refresh-state'),
  accountsList: document.getElementById('accounts-list'),
  environmentsList: document.getElementById('environments-list'),
  discoveredList: document.getElementById('discovered-list'),
  accountForm: document.getElementById('account-form'),
  accountCancel: document.getElementById('account-cancel'),
  environmentForm: document.getElementById('environment-form'),
  discoverForm: document.getElementById('discover-form'),
  discoverAccount: document.getElementById('discover-account'),
  environmentAccount: document.getElementById('environment-account'),
  explorerEnvironment: document.getElementById('explorer-environment'),
  queryEnvironment: document.getElementById('query-environment'),
  fetchEnvironment: document.getElementById('fetch-environment'),
  queryAccount: document.getElementById('query-account'),
  fetchAccount: document.getElementById('fetch-account')
}

export function renderSetupState(data) {
  const accounts = data.accounts || []
  const environments = data.environments || []

  els.accountsList.innerHTML = accounts.length
    ? accounts.map((account) => {
        return '<div class="item">' +
          '<div class="item-title">' + esc(account.name) + '</div>' +
          '<div class="mono-subtle">' + esc(account.kind) + '</div>' +
          '<div class="pill-row"><button class="btn danger" data-remove-account="' + esc(account.name) + '" type="button">Remove</button></div>' +
        '</div>'
      }).join('')
    : '<div class="empty">No accounts configured yet.</div>'

  els.environmentsList.innerHTML = environments.length
    ? environments.map((environment) => {
        const subtitle = environment.url || ''
        return '<div class="item">' +
          '<div class="item-title">' + esc(environment.alias) + '</div>' +
          '<div class="mono-subtle">' + esc(subtitle) + '</div>' +
          '<div class="pill-row">' +
          '<span class="pill">' + esc(environment.account) + '</span>' +
          (environment.makerEnvironmentId ? '<span class="pill">' + esc(environment.makerEnvironmentId) + '</span>' : '') +
          '<button class="btn danger" data-remove-environment="' + esc(environment.alias) + '" type="button">Remove</button>' +
          '</div>' +
        '</div>'
      }).join('')
    : '<div class="empty">No environments configured yet.</div>'

  const accountNames = accounts.map((account) => account.name)
  const environmentAliases = environments.map((environment) => environment.alias)
  els.discoverAccount.innerHTML = optionMarkup(accountNames, 'select account')
  els.environmentAccount.innerHTML = optionMarkup(accountNames)
  els.explorerEnvironment.innerHTML = optionMarkup(environmentAliases, 'select environment')
  els.queryEnvironment.innerHTML = optionMarkup(environmentAliases, 'select environment')
  els.fetchEnvironment.innerHTML = optionMarkup(environmentAliases, 'select environment')
  els.queryAccount.innerHTML = optionMarkup(accountNames, 'environment default')
  els.fetchAccount.innerHTML = optionMarkup(accountNames, 'environment default')
}

export function initSetup(refreshState) {
  els.refreshState.addEventListener('click', () => {
    refreshState(false).catch((error) => toast(error.message, true))
  })

  els.accountForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    try {
      const started = await api('/api/jobs/account-login', { method: 'POST', body: JSON.stringify(formDataObject(event.currentTarget)) })
      app.currentLoginJobId = started.data.id
      els.accountCancel.hidden = false
      await waitForLoginJob(app.currentLoginJobId)
      event.currentTarget.reset()
      document.getElementById('account-kind').value = 'user'
      applyAccountKindVisibility()
      els.accountCancel.hidden = true
      app.currentLoginJobId = null
      toast('Account saved')
      await refreshState(true)
    } catch (error) {
      toast(error.message, true)
    }
  })

  els.accountCancel.addEventListener('click', async () => {
    if (!app.currentLoginJobId) return
    try {
      await fetch('/api/jobs/' + encodeURIComponent(app.currentLoginJobId), { method: 'DELETE', headers: { 'content-type': 'application/json' } })
      toast('Pending login cancelled', true)
    } finally {
      app.currentLoginJobId = null
      els.accountCancel.hidden = true
    }
  })

  els.environmentForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    try {
      await api('/api/environments', { method: 'POST', body: JSON.stringify(formDataObject(event.currentTarget)) })
      event.currentTarget.reset()
      els.discoveredList.innerHTML = ''
      toast('Environment added')
      await refreshState(true)
    } catch (error) {
      toast(error.message, true)
    }
  })

  els.discoverForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    try {
      const payload = await api('/api/environments/discover', { method: 'POST', body: JSON.stringify(formDataObject(event.currentTarget)) })
      const items = payload.data || []
      els.discoveredList.innerHTML = items.length
        ? items.map((item) => {
            return '<div class="item">' +
              '<div class="item-title">' + esc(item.displayName || item.makerEnvironmentId || 'environment') + '</div>' +
              '<div class="mono-subtle">' + esc(item.environmentApiUrl || item.environmentUrl || '') + '</div>' +
              '<div class="pill-row"><button class="btn ghost" data-use-discovered="' + esc(encodeURIComponent(JSON.stringify(item))) + '" type="button">Use</button></div>' +
            '</div>'
          }).join('')
        : '<div class="empty">No environments returned for that account.</div>'
      toast(items.length + ' environment' + (items.length === 1 ? '' : 's') + ' found')
    } catch (error) {
      toast(error.message, true)
    }
  })

  document.body.addEventListener('click', (event) => {
    const removeAccount = event.target.closest('[data-remove-account]')
    if (removeAccount) {
      if (!confirm('Remove account "' + removeAccount.dataset.removeAccount + '"?')) return
      api('/api/accounts/' + encodeURIComponent(removeAccount.dataset.removeAccount), { method: 'DELETE' })
        .then(() => {
          toast('Account removed')
          return refreshState(true)
        })
        .catch((error) => toast(error.message, true))
      return
    }

    const removeEnvironment = event.target.closest('[data-remove-environment]')
    if (removeEnvironment) {
      if (!confirm('Remove environment "' + removeEnvironment.dataset.removeEnvironment + '"?')) return
      api('/api/environments/' + encodeURIComponent(removeEnvironment.dataset.removeEnvironment), { method: 'DELETE' })
        .then(() => {
          toast('Environment removed')
          return refreshState(true)
        })
        .catch((error) => toast(error.message, true))
      return
    }

    const useDiscovered = event.target.closest('[data-use-discovered]')
    if (useDiscovered) {
      const payload = JSON.parse(decodeURIComponent(useDiscovered.dataset.useDiscovered))
      const form = els.environmentForm
      form.elements.alias.value = payload.displayName
        ? payload.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        : (payload.makerEnvironmentId || '')
      form.elements.account.value = payload.accountName || ''
      form.elements.url.value = payload.environmentApiUrl || payload.environmentUrl || ''
      form.elements.displayName.value = payload.displayName || ''
    }
  })
}

async function waitForLoginJob(jobId) {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const response = await fetch('/api/jobs/' + encodeURIComponent(jobId), { headers: { 'content-type': 'application/json' } })
    const payload = await response.json()
    const job = payload.data
    if (!job || job.status === 'pending') continue
    showLastResponse(payload)
    if (job.status === 'cancelled') throw new Error('Login cancelled.')
    if (job.result && job.result.success === false) throw new Error(summarizeError(job.result))
    return job.result
  }
}
`;
}
