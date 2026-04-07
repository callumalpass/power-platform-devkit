export function renderSharedModule(): string {
  return String.raw`
export const app = {
  state: null,
  currentLoginJobId: null
}

export const els = {
  lastResponse: document.getElementById('last-response'),
  meta: document.getElementById('meta'),
  toasts: document.getElementById('toasts')
}

export function esc(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function pretty(value) {
  return JSON.stringify(value, null, 2)
}

export function toast(message, isError = false) {
  const el = document.createElement('div')
  el.className = 'toast' + (isError ? ' error' : '')
  el.textContent = message
  els.toasts.appendChild(el)
  setTimeout(() => el.remove(), isError ? 5000 : 2500)
}

export function showLastResponse(value) {
  els.lastResponse.textContent = pretty(value)
}

export function summarizeError(data) {
  if (data && Array.isArray(data.diagnostics) && data.diagnostics.length) {
    return data.diagnostics[0].message || 'Request failed'
  }
  return 'Request failed'
}

export async function api(path, options) {
  const response = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {}))
  const data = await response.json()
  showLastResponse(data)
  if (!response.ok || data.success === false) {
    throw new Error(summarizeError(data))
  }
  return data
}

export function optionMarkup(values, emptyLabel) {
  const items = []
  if (emptyLabel !== undefined) items.push('<option value="">' + esc(emptyLabel) + '</option>')
  for (const value of values) items.push('<option value="' + esc(value) + '">' + esc(value) + '</option>')
  return items.join('')
}

export function formDataObject(form) {
  const data = {}
  const fd = new FormData(form)
  for (const [key, value] of fd.entries()) {
    if (typeof value === 'string' && value.trim() !== '') data[key] = value
  }
  for (const checkbox of form.querySelectorAll('input[type="checkbox"]')) {
    data[checkbox.name] = checkbox.checked
  }
  return data
}

export function setTab(tab) {
  for (const el of document.querySelectorAll('.tab')) el.classList.toggle('active', el.dataset.tab === tab)
  for (const el of document.querySelectorAll('.panel')) el.classList.toggle('active', el.id === 'panel-' + tab)
}

export function registerTabHandlers() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => setTab(tab.dataset.tab))
  }
}

export function applyAccountKindVisibility() {
  const kind = document.getElementById('account-kind').value
  const kinds = ['user', 'device-code', 'client-secret', 'environment-token', 'static-token']
  for (const value of kinds) {
    for (const el of document.querySelectorAll('.account-' + value)) {
      el.hidden = !el.classList.contains('account-' + kind)
    }
  }
}

export function renderMeta(data) {
  const accounts = data.accounts || []
  const environments = data.environments || []
  els.meta.innerHTML =
    '<div class="chip">Config <code>' + esc(data.configDir) + '</code></div>' +
    '<div class="chip">Auth <code>' + esc(data.allowInteractiveAuth ? 'interactive' : 'non-interactive') + '</code></div>' +
    '<div class="chip">Accounts <code>' + esc(accounts.length) + '</code></div>' +
    '<div class="chip">Environments <code>' + esc(environments.length) + '</code></div>'
}

export function readSelectedValue(selectId, label = 'value') {
  const value = document.getElementById(selectId).value
  if (!value) throw new Error('Select ' + label + ' first.')
  return value
}
`;
}
