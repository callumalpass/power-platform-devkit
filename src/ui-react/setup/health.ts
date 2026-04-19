import type { HealthEntry } from './types.js';

export function summarizeHealthFailure(payload: any): HealthEntry {
  const diagnostic = Array.isArray(payload?.diagnostics) ? payload.diagnostics[0] : null;
  const message = diagnostic?.message || 'Health check failed';
  const detail = diagnostic?.detail || '';
  const summary = /Interactive authentication is disabled/i.test(message)
    ? 'Needs login for this API'
    : /returned 401/i.test(message) || /returned 403/i.test(message)
      ? 'Permission or consent required'
      : /returned 404/i.test(message)
        ? 'API endpoint unavailable'
        : message;
  return { status: 'error', summary, message, detail, code: diagnostic?.code || '' };
}

export function healthHint(entry: HealthEntry): string | null {
  if (entry.status === 'ok' || entry.status === 'pending') return null;
  if (/Needs login/i.test(entry.summary)) return 'Re-authenticate this account to grant access.';
  if (/Permission or consent/i.test(entry.summary)) return 'Check API permissions or admin consent for this app registration.';
  if (/endpoint unavailable/i.test(entry.summary)) return 'This API may not be enabled for the environment.';
  if (entry.detail) return entry.detail;
  return entry.message || null;
}

export function shellQuote(value: string): string {
  return /^[A-Za-z0-9._:@/-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

export function normalizeSharePointWebUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (!/\.sharepoint\.com$/i.test(url.hostname)) return undefined;
    if (url.pathname.includes('/_api/')) return `${url.origin}${url.pathname}${url.search}`;
    const path = url.pathname.replace(/\/$/, '');
    return `${url.origin}${path}/_api/web`;
  } catch {
    return undefined;
  }
}
