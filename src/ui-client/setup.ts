export function renderSetupModule(): string {
  return String.raw`
import { app, api, applyAccountKindVisibility, esc, formDataObject, optionMarkup, setBtnLoading, summarizeError, toast } from '/assets/ui/shared.js'

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
  environmentAccount: document.getElementById('environment-account')
}

export function renderSetupState(data) {
  const accounts = data.accounts || []
  const environments = data.environments || []

  els.accountsList.innerHTML = accounts.length
    ? accounts.map((a) =>
        '<div class="card-item">' +
          '<div class="card-item-info"><div class="card-item-title">' + esc(a.name) + '</div><div class="card-item-sub">' + esc(a.kind) + '</div></div>' +
          '<button class="btn btn-danger" data-remove-account="' + esc(a.name) + '" type="button">Remove</button>' +
        '</div>'
      ).join('')
    : '<div class="empty">No accounts configured.</div>'

  els.environmentsList.innerHTML = environments.length
    ? environments.map((e) =>
        '<div class="card-item">' +
          '<div class="card-item-info"><div class="card-item-title">' + esc(e.alias) + ' <span class="badge">' + esc(e.account) + '</span></div><div class="card-item-sub">' + esc(e.url || '') + '</div></div>' +
          '<button class="btn btn-danger" data-remove-environment="' + esc(e.alias) + '" type="button">Remove</button>' +
        '</div>'
      ).join('')
    : '<div class="empty">No environments configured.</div>'

  const accountNames = accounts.map((a) => a.name)
  els.discoverAccount.innerHTML = optionMarkup(accountNames, 'select account')
  els.environmentAccount.innerHTML = optionMarkup(accountNames)
}

export function initSetup(refreshState) {
  els.refreshState.addEventListener('click', () => {
    refreshState(false).catch((err) => toast(err.message, true))
  })

  els.accountForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const btn = document.getElementById('account-submit')
    const kind = document.getElementById('account-kind').value
    const isInteractive = kind === 'user' || kind === 'device-code'
    setBtnLoading(btn, true, isInteractive ? 'Waiting for login\u2026' : 'Saving\u2026')
    els.accountCancel.classList.remove('hidden')
    try {
      const started = await api('/api/jobs/account-login', { method: 'POST', body: JSON.stringify(formDataObject(event.currentTarget)) })
      app.currentLoginJobId = started.data.id
      await waitForLoginJob(app.currentLoginJobId)
      event.currentTarget.reset()
      document.getElementById('account-kind').value = 'user'
      applyAccountKindVisibility()
      toast('Account saved')
      await refreshState(true)
    } catch (err) {
      toast(err.message, true)
    } finally {
      app.currentLoginJobId = null
      els.accountCancel.classList.add('hidden')
      setBtnLoading(btn, false, 'Save & Login')
    }
  })

  els.accountCancel.addEventListener('click', async () => {
    if (!app.currentLoginJobId) return
    try {
      await fetch('/api/jobs/' + encodeURIComponent(app.currentLoginJobId), { method: 'DELETE', headers: { 'content-type': 'application/json' } })
      toast('Pending login cancelled', true)
    } finally {
      app.currentLoginJobId = null
      els.accountCancel.classList.add('hidden')
    }
  })

  els.environmentForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const btn = document.getElementById('env-submit')
    setBtnLoading(btn, true, 'Discovering\u2026')
    try {
      await api('/api/environments', { method: 'POST', body: JSON.stringify(formDataObject(event.currentTarget)) })
      event.currentTarget.reset()
      els.discoveredList.innerHTML = ''
      toast('Environment added')
      await refreshState(true)
    } catch (err) {
      toast(err.message, true)
    } finally {
      setBtnLoading(btn, false, 'Discover & Save')
    }
  })

  els.discoverForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const btn = document.getElementById('discover-submit')
    setBtnLoading(btn, true, 'Discovering\u2026')
    try {
      const payload = await api('/api/environments/discover', { method: 'POST', body: JSON.stringify(formDataObject(event.currentTarget)) })
      const items = payload.data || []
      els.discoveredList.innerHTML = items.length
        ? items.map((item) =>
            '<div class="card-item">' +
              '<div class="card-item-info"><div class="card-item-title">' + esc(item.displayName || item.makerEnvironmentId || 'environment') + '</div><div class="card-item-sub">' + esc(item.environmentApiUrl || item.environmentUrl || '') + '</div></div>' +
              '<button class="btn btn-ghost" data-use-discovered="' + esc(encodeURIComponent(JSON.stringify(item))) + '" type="button">Use</button>' +
            '</div>'
          ).join('')
        : '<div class="empty">No environments returned.</div>'
      toast(items.length + ' environment' + (items.length === 1 ? '' : 's') + ' found')
    } catch (err) {
      toast(err.message, true)
    } finally {
      setBtnLoading(btn, false, 'Discover')
    }
  })

  document.body.addEventListener('click', (event) => {
    const removeAccount = event.target.closest('[data-remove-account]')
    if (removeAccount) {
      if (!confirm('Remove account "' + removeAccount.dataset.removeAccount + '"?')) return
      api('/api/accounts/' + encodeURIComponent(removeAccount.dataset.removeAccount), { method: 'DELETE' })
        .then(() => { toast('Account removed'); return refreshState(true) })
        .catch((err) => toast(err.message, true))
      return
    }
    const removeEnvironment = event.target.closest('[data-remove-environment]')
    if (removeEnvironment) {
      if (!confirm('Remove environment "' + removeEnvironment.dataset.removeEnvironment + '"?')) return
      api('/api/environments/' + encodeURIComponent(removeEnvironment.dataset.removeEnvironment), { method: 'DELETE' })
        .then(() => { toast('Environment removed'); return refreshState(true) })
        .catch((err) => toast(err.message, true))
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
    if (job.status === 'cancelled') throw new Error('Login cancelled.')
    if (job.result && job.result.success === false) throw new Error(summarizeError(job.result))
    return job.result
  }
}
`;
}
