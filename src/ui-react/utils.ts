import type { DataverseAttribute, DataverseEntityDetail } from './ui-types.js';

export type JsonMap = Record<string, unknown>;

export class ApiRequestError extends Error {
  data: unknown;
  status: number;

  constructor(message: string, data: unknown, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.data = data;
    this.status = status;
  }
}

type ApiOptions = RequestInit & {
  allowFailure?: boolean;
};

type DesktopApiBridge = {
  request(input: { path: string; method?: string; body?: unknown }): Promise<{ status: number; body: unknown }>;
};

type DesktopApiTestHook = {
  request?(input: { path: string; method?: string; body?: unknown }): Promise<{ status: number; body: unknown } | undefined> | { status: number; body: unknown } | undefined;
};

export type AppMode = 'desktop' | 'setup';

declare global {
  interface Window {
    ppApp?: {
      mode?: AppMode;
      setupToken?: string;
    };
    ppDesktop?: DesktopApiBridge;
    ppDesktopTest?: DesktopApiTestHook;
  }
}

export async function api<T = unknown>(path: string, options?: ApiOptions): Promise<T> {
  const { allowFailure = false, ...fetchOptions } = options ?? {};
  if (window.ppDesktop?.request || window.ppDesktopTest?.request) {
    const request = {
      path,
      method: fetchOptions.method ?? 'GET',
      body: readDesktopRequestBody(fetchOptions.body)
    };
    const response = (await window.ppDesktopTest?.request?.(request)) ?? (await window.ppDesktop?.request(request));
    if (response) return readApiResponse<T>(response, allowFailure);
  }
  const headers = new Headers(fetchOptions.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  if (window.ppApp?.setupToken) headers.set('x-pp-setup-token', window.ppApp.setupToken);
  const response = await fetch(path, { ...fetchOptions, headers });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    const snippet = text.length > 240 ? `${text.slice(0, 240)}…` : text;
    throw new Error(`Invalid JSON from ${path} (${response.status}). ${summarizeParseError(error, snippet)}`);
  }
  if (!response.ok || (!allowFailure && readRecord(data)?.success === false)) {
    throw new ApiRequestError(summarizeError(data), data, response.status);
  }
  return data as T;
}

export function getAppMode(): AppMode {
  return window.ppApp?.mode === 'setup' ? 'setup' : 'desktop';
}

export function getAppDisplayName(): string {
  return getAppMode() === 'setup' ? 'PP Setup Manager' : 'PP Desktop';
}

function readApiResponse<T>(response: { status: number; body: unknown }, allowFailure: boolean): T {
  const data = response.body;
  if (response.status < 200 || response.status >= 300 || (!allowFailure && readRecord(data)?.success === false)) {
    throw new ApiRequestError(summarizeError(data), data, response.status);
  }
  return data as T;
}

function readDesktopRequestBody(body: BodyInit | null | undefined): unknown {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') {
    if (!body.trim()) return undefined;
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return body;
}

function summarizeParseError(error: unknown, snippet: string) {
  const message = error instanceof Error ? error.message : 'Failed to parse response.';
  return snippet ? `${message} Response starts with: ${snippet}` : message;
}

export function summarizeError(data: unknown) {
  const diagnostics = readRecord(data)?.diagnostics;
  if (Array.isArray(diagnostics) && diagnostics.length) {
    const first = readRecord(diagnostics[0]);
    return typeof first?.message === 'string' ? first.message : 'Request failed';
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

export function renderResultTable(records: Array<Record<string, unknown>>, entityLogicalName?: string) {
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
  const body = `<tbody>${records
    .map(
      (row) =>
        `<tr>${allKeys
          .map((key) => {
            const value = row[key];
            const display = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
            const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(display);
            const inner = isId && entityLogicalName ? `<span class="record-link" data-entity="${esc(entityLogicalName)}" data-id="${esc(display)}">${esc(display)}</span>` : esc(display);
            return `<td>${inner}</td>`;
          })
          .join('')}</tr>`
    )
    .join('')}</tbody>`;
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

export function prop<T = string | number | boolean | null | undefined>(obj: unknown, path: string): T | undefined {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current as T | undefined;
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

export function isSelectableAttribute(attribute: DataverseAttribute | null | undefined) {
  if (!attribute?.logicalName) return false;
  if (attribute.attributeOf) return false;
  if (attribute.isValidForRead === false) return false;
  const typeName = String(attribute.attributeTypeName || attribute.attributeType || '').toLowerCase();
  return !['partylisttype', 'virtualtype', 'entitynametype', 'managedpropertytype', 'image', 'filetype', 'multiselectpicklisttype'].includes(typeName);
}

export function getSelectableAttributes(detail: Pick<DataverseEntityDetail, 'attributes'> | null | undefined) {
  return (detail?.attributes || []).filter(isSelectableAttribute);
}

export function getDefaultSelectedColumns(detail: DataverseEntityDetail | null | undefined, extraCount = 3) {
  if (!detail) return [];
  const selectable = getSelectableAttributes(detail);
  const byName = new Map(selectable.map((attribute) => [attribute.logicalName, attribute]));
  const cols: string[] = [];
  if (detail.primaryIdAttribute && byName.has(detail.primaryIdAttribute)) cols.push(detail.primaryIdAttribute);
  if (detail.primaryNameAttribute && detail.primaryNameAttribute !== detail.primaryIdAttribute && byName.has(detail.primaryNameAttribute)) {
    cols.push(detail.primaryNameAttribute);
  }
  const wanted =
    extraCount +
    (detail.primaryIdAttribute && byName.has(detail.primaryIdAttribute) ? 1 : 0) +
    (detail.primaryNameAttribute && detail.primaryNameAttribute !== detail.primaryIdAttribute && byName.has(detail.primaryNameAttribute) ? 1 : 0);
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

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
