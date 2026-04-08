export function renderRenderUtilsModule(): string {
  return String.raw`
import { esc } from '/assets/ui/runtime.js'

export function highlightJson(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (!raw) return ''
  return esc(raw)
    .replace(/"([^"\\\\]|\\\\.)*"\s*:/g, (m) => '<span class="json-key">' + m + '</span>')
    .replace(/:\s*"([^"\\\\]|\\\\.)*"/g, (m) => ': <span class="json-str">' + m.slice(m.indexOf('"')) + '</span>')
    .replace(/:\s*(-?\d+\.?\d*([eE][+-]?\d+)?)\b/g, (m, n) => ': <span class="json-num">' + n + '</span>')
    .replace(/:\s*(true|false)\b/g, (m, b) => ': <span class="json-bool">' + b + '</span>')
    .replace(/:\s*(null)\b/g, (m, n) => ': <span class="json-null">' + n + '</span>')
}

export function renderResultTable(records, entityLogicalName) {
  if (!Array.isArray(records) || !records.length) return ''
  const allKeys = []
  const seen = new Set()
  for (const row of records) {
    for (const key of Object.keys(row)) {
      if (key.startsWith('@odata') || key.startsWith('_') && key.endsWith('_value')) continue
      if (!seen.has(key)) { seen.add(key); allKeys.push(key) }
    }
  }
  if (!allKeys.length) return ''
  const head = '<thead><tr>' + allKeys.map((k) => '<th>' + esc(k) + '</th>').join('') + '</tr></thead>'
  const body = '<tbody>' + records.map((row) =>
    '<tr>' + allKeys.map((k) => {
      const val = row[k]
      const display = val == null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
      const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(display)
      const inner = isId && entityLogicalName
        ? '<span class="record-link" data-entity="' + esc(entityLogicalName) + '" data-id="' + esc(display) + '">' + esc(display) + '</span>'
        : esc(display)
      return '<td>' + inner + '</td>'
    }).join('') + '</tr>'
  ).join('') + '</tbody>'
  return '<div class="result-table-wrap"><table class="result-table">' + head + body + '</table></div>'
}
`;
}
