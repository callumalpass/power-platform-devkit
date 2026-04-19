import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSavedRequestsPath } from './config.js';
import type { ConfigStoreOptions } from './config.js';
import { ok, fail, createDiagnostic, type OperationResult } from './diagnostics.js';

export interface SavedRequestEntry {
  api: string;
  method: string;
  path: string;
  name?: string;
}

interface SavedRequestsFile {
  version: 1;
  entries: SavedRequestEntry[];
}

const MAX_ENTRIES = 100;

function sanitizeEntry(value: unknown): SavedRequestEntry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const api = typeof record.api === 'string' ? record.api.trim() : '';
  const method = typeof record.method === 'string' ? record.method.trim() : '';
  const requestPath = typeof record.path === 'string' ? record.path : '';
  if (!api || !method || !requestPath) return undefined;
  const entry: SavedRequestEntry = { api, method, path: requestPath };
  if (typeof record.name === 'string' && record.name.trim()) {
    entry.name = record.name.trim().slice(0, 120);
  }
  return entry;
}

export async function loadSavedRequests(options: ConfigStoreOptions = {}): Promise<OperationResult<SavedRequestEntry[]>> {
  const filePath = getSavedRequestsPath(options);
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SavedRequestsFile>;
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const sanitized = entries.map(sanitizeEntry).filter((entry): entry is SavedRequestEntry => Boolean(entry));
    return ok(sanitized.slice(0, MAX_ENTRIES));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return ok([]);
    return fail(createDiagnostic('error', 'SAVED_REQUESTS_READ_FAILED', `Could not read saved requests file: ${(error as Error).message}`, { source: 'pp/ui' }));
  }
}

export async function replaceSavedRequests(
  entries: unknown,
  options: ConfigStoreOptions = {},
): Promise<OperationResult<SavedRequestEntry[]>> {
  if (!Array.isArray(entries)) {
    return fail(createDiagnostic('error', 'SAVED_REQUESTS_INVALID', 'entries must be an array.', { source: 'pp/ui' }));
  }
  const sanitized = entries.map(sanitizeEntry).filter((entry): entry is SavedRequestEntry => Boolean(entry)).slice(0, MAX_ENTRIES);
  const filePath = getSavedRequestsPath(options);
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    const payload: SavedRequestsFile = { version: 1, entries: sanitized };
    await writeFile(filePath, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8' });
    return ok(sanitized);
  } catch (error) {
    return fail(createDiagnostic('error', 'SAVED_REQUESTS_WRITE_FAILED', `Could not write saved requests file: ${(error as Error).message}`, { source: 'pp/ui' }));
  }
}
