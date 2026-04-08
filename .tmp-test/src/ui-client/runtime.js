export function renderRuntimeModule() {
    return String.raw `
export const els = {
  meta: document.getElementById('meta'),
  toasts: document.getElementById('toasts'),
  globalEnv: document.getElementById('global-environment')
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
  el.className = 'toast' + (isError ? ' error' : ' ok')
  el.textContent = message
  els.toasts.appendChild(el)
  setTimeout(() => {
    el.classList.add('fade-out')
    el.addEventListener('animationend', () => el.remove())
  }, isError ? 5000 : 2500)
}

export function summarizeError(data) {
  if (data && Array.isArray(data.diagnostics) && data.diagnostics.length) {
    return data.diagnostics[0].message || 'Request failed'
  }
  return 'Request failed'
}

export async function api(path, options) {
  const response = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {}))
  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch (error) {
    const snippet = text.length > 240 ? text.slice(0, 240) + '…' : text
    throw new Error('Invalid JSON from ' + path + ' (' + response.status + '). ' + summarizeParseError(error, snippet))
  }
  if (!response.ok || data.success === false) {
    throw new Error(summarizeError(data))
  }
  return data
}

function summarizeParseError(error, snippet) {
  const message = error && error.message ? error.message : 'Failed to parse response.'
  return snippet ? message + ' Response starts with: ' + snippet : message
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

export function getGlobalEnvironment() {
  return els.globalEnv.value
}

export function setGlobalEnvironment(value) {
  els.globalEnv.value = value || ''
}

export function renderMeta(data) {
  const accounts = data.accounts || []
  const environments = data.environments || []
  els.meta.innerHTML =
    '<span>' + accounts.length + ' accounts</span>' +
    '<span>' + environments.length + ' envs</span>'
}

export function setBtnLoading(btn, loading, label) {
  if (loading) {
    btn._origLabel = btn.textContent
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span>' + esc(label || btn._origLabel)
  } else {
    btn.disabled = false
    btn.textContent = btn._origLabel || label || ''
  }
}

export function showLoading(container, message) {
  const el = document.createElement('div')
  el.className = 'workspace-loading'
  el.innerHTML = '<span class="spinner"></span>' + esc(message || 'Loading\u2026')
  container.prepend(el)
  return () => el.remove()
}

export function copyToClipboard(text, label) {
  navigator.clipboard.writeText(text).then(
    () => toast((label || 'Copied') + ' to clipboard'),
    () => toast('Failed to copy', true)
  )
}

export function formatTimeRemaining(expiresAt) {
  if (!expiresAt) return null
  const exp = expiresAt > 1e12 ? expiresAt : expiresAt * 1000
  const diff = exp - Date.now()
  if (diff <= 0) return { text: 'expired', cls: 'expired' }
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return { text: mins + 'm left', cls: mins < 10 ? 'expiring-soon' : '' }
  const hours = Math.floor(mins / 60)
  return { text: hours + 'h ' + (mins % 60) + 'm left', cls: '' }
}

export function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}
`;
}
