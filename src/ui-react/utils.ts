export type JsonMap = Record<string, any>;

export class ApiRequestError extends Error {
  data: any;
  status: number;

  constructor(message: string, data: any, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.data = data;
    this.status = status;
  }
}

export async function api<T = any>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    const snippet = text.length > 240 ? `${text.slice(0, 240)}…` : text;
    throw new Error(
      `Invalid JSON from ${path} (${response.status}). ${summarizeParseError(error, snippet)}`,
    );
  }
  if (!response.ok || data.success === false) {
    throw new ApiRequestError(summarizeError(data), data, response.status);
  }
  return data as T;
}

function summarizeParseError(error: unknown, snippet: string) {
  const message = error instanceof Error ? error.message : 'Failed to parse response.';
  return snippet ? `${message} Response starts with: ${snippet}` : message;
}

export function summarizeError(data: any) {
  if (data && Array.isArray(data.diagnostics) && data.diagnostics.length) {
    return data.diagnostics[0].message || 'Request failed';
  }
  return 'Request failed';
}

export function esc(value: unknown) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function highlightJson(value: unknown) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!raw) return '';
  return esc(raw)
    .replace(/"([^"\\]|\\.)*"\s*:/g, (match) => `<span class="json-key">${match}</span>`)
    .replace(/:\s*"([^"\\]|\\.)*"/g, (match) => `: <span class="json-str">${match.slice(match.indexOf('"'))}</span>`)
    .replace(/:\s*(-?\d+\.?\d*([eE][+-]?\d+)?)\b/g, (_match, numberText) => `: <span class="json-num">${numberText}</span>`)
    .replace(/:\s*(true|false)\b/g, (_match, valueText) => `: <span class="json-bool">${valueText}</span>`)
    .replace(/:\s*(null)\b/g, (_match, valueText) => `: <span class="json-null">${valueText}</span>`);
}

export function renderResultTable(records: any[], entityLogicalName?: string) {
  if (!Array.isArray(records) || !records.length) return '';
  const allKeys: string[] = [];
  const seen = new Set<string>();
  for (const row of records) {
    for (const key of Object.keys(row)) {
      if (key.startsWith('@odata') || (key.startsWith('_') && key.endsWith('_value'))) continue;
      if (!seen.has(key)) {
        seen.add(key);
        allKeys.push(key);
      }
    }
  }
  if (!allKeys.length) return '';
  const head = `<thead><tr>${allKeys.map((key) => `<th>${esc(key)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${records.map((row) => `<tr>${allKeys.map((key) => {
    const value = row[key];
    const display = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(display);
    const inner = isId && entityLogicalName
      ? `<span class="record-link" data-entity="${esc(entityLogicalName)}" data-id="${esc(display)}">${esc(display)}</span>`
      : esc(display);
    return `<td>${inner}</td>`;
  }).join('')}</tr>`).join('')}</tbody>`;
  return `<div class="result-table-wrap"><table class="result-table">${head}${body}</table></div>`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function formatDate(value: unknown) {
  if (!value) return '-';
  try {
    const date = new Date(String(value));
    return `${date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return String(value);
  }
}

export function formatDateShort(value: unknown) {
  if (!value) return '-';
  try {
    const date = new Date(String(value));
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return String(value);
  }
}

export function formatTimeRemaining(expiresAt: number | string | null | undefined) {
  if (!expiresAt) return null;
  const numeric = Number(expiresAt);
  const exp = numeric > 1e12 ? numeric : numeric * 1000;
  const diff = exp - Date.now();
  if (diff <= 0) return { text: 'expired', cls: 'expired' };
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return { text: `${mins}m left`, cls: mins < 10 ? 'expiring-soon' : '' };
  const hours = Math.floor(mins / 60);
  return { text: `${hours}h ${mins % 60}m left`, cls: '' };
}

export function prop(obj: any, path: string) {
  return path.split('.').reduce<any>((current, key) => current?.[key], obj);
}

export function formDataObject(form: HTMLFormElement) {
  const data: JsonMap = {};
  const fd = new FormData(form);
  fd.forEach((value, key) => {
    if (typeof value === 'string' && value.trim() !== '') data[key] = value;
  });
  for (const checkbox of Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
    if (checkbox.name) data[checkbox.name] = checkbox.checked;
  }
  return data;
}

export function isSelectableAttribute(attribute: any) {
  if (!attribute?.logicalName) return false;
  if (attribute.attributeOf) return false;
  if (attribute.isValidForRead === false) return false;
  const typeName = String(attribute.attributeTypeName || attribute.attributeType || '').toLowerCase();
  return ![
    'partylisttype',
    'virtualtype',
    'entitynametype',
    'managedpropertytype',
    'image',
    'filetype',
    'multiselectpicklisttype',
  ].includes(typeName);
}

export function getSelectableAttributes(detail: any) {
  return (detail?.attributes || []).filter(isSelectableAttribute);
}

export function getDefaultSelectedColumns(detail: any, extraCount = 3) {
  if (!detail) return [];
  const selectable = getSelectableAttributes(detail);
  const byName = new Map(selectable.map((attribute: any) => [attribute.logicalName, attribute]));
  const cols: string[] = [];
  if (detail.primaryIdAttribute && byName.has(detail.primaryIdAttribute)) cols.push(detail.primaryIdAttribute);
  if (
    detail.primaryNameAttribute &&
    detail.primaryNameAttribute !== detail.primaryIdAttribute &&
    byName.has(detail.primaryNameAttribute)
  ) {
    cols.push(detail.primaryNameAttribute);
  }
  const wanted =
    extraCount +
    (detail.primaryIdAttribute && byName.has(detail.primaryIdAttribute) ? 1 : 0) +
    (detail.primaryNameAttribute &&
    detail.primaryNameAttribute !== detail.primaryIdAttribute &&
    byName.has(detail.primaryNameAttribute)
      ? 1
      : 0);
  for (const attribute of selectable) {
    if (attribute.isPrimaryId || attribute.isPrimaryName) continue;
    if (cols.includes(attribute.logicalName)) continue;
    cols.push(attribute.logicalName);
    if (cols.length >= wanted) break;
  }
  return cols;
}

export function optionList(values: string[], emptyLabel?: string) {
  const items = [];
  if (emptyLabel !== undefined) items.push({ value: '', label: emptyLabel });
  for (const value of values) items.push({ value, label: value });
  return items;
}
