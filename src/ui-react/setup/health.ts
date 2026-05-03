import type { HealthEntry } from './types.js';
import { readRecord } from '../utils.js';

const INTERACTIVE_AUTH_REQUIRED_PATTERN = /Interactive authentication is disabled|not authenticated|no cached account|sign in required|login required/i;

export function summarizeHealthFailure(payload: unknown): HealthEntry {
  const payloadRecord = readRecord(payload);
  const diagnostic = Array.isArray(payloadRecord?.diagnostics) ? readRecord(payloadRecord.diagnostics[0]) : undefined;
  const message = typeof diagnostic?.message === 'string' ? diagnostic.message : 'Health check failed';
  const detail = typeof diagnostic?.detail === 'string' ? diagnostic.detail : '';
  const code = typeof diagnostic?.code === 'string' ? diagnostic.code : '';
  if (isInteractiveAuthRequiredText(`${code}\n${message}\n${detail}`)) {
    return {
      status: 'error',
      summary: 'Needs login for this API',
      message: 'Sign in to this account before checking API access.',
      detail: '',
      code
    };
  }
  const summary = /returned 401/i.test(message) || /returned 403/i.test(message) ? 'Permission or consent required' : /returned 404/i.test(message) ? 'API endpoint unavailable' : message;
  return { status: 'error', summary, message, detail, code };
}

export function authRequiredHealthEntry(): HealthEntry {
  return {
    status: 'error',
    summary: 'Needs login for this API',
    message: 'Sign in to this account before checking API access.',
    detail: '',
    code: 'ACCOUNT_AUTH_REQUIRED'
  };
}

export function isInteractiveAuthRequiredText(value: string): boolean {
  return INTERACTIVE_AUTH_REQUIRED_PATTERN.test(value);
}

export function isInteractiveAuthRequiredHealthEntry(entry: HealthEntry): boolean {
  return /Needs login/i.test(entry.summary) || entry.code === 'ACCOUNT_AUTH_REQUIRED' || isInteractiveAuthRequiredText(`${entry.code ?? ''}\n${entry.message ?? ''}\n${entry.detail ?? ''}`);
}

export function summarizeAccessError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const detail = stringifyErrorData(error);
  if (isInteractiveAuthRequiredText(`${message}\n${detail}`)) {
    return 'Sign in to the environment account before viewing access.';
  }
  return message;
}

function stringifyErrorData(error: unknown): string {
  if (!error || typeof error !== 'object' || !('data' in error)) return '';
  try {
    return JSON.stringify((error as { data?: unknown }).data);
  } catch {
    return '';
  }
}

export function healthHint(entry: HealthEntry): string | null {
  if (entry.status === 'ok' || entry.status === 'pending') return null;
  if (isInteractiveAuthRequiredHealthEntry(entry)) return 'Sign in to this account, then re-check health.';
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
