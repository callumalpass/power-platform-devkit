import { randomUUID } from 'node:crypto';
import { appendFile, chmod, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getQueryLogPath, getQueryLogSettings, type ConfigStoreOptions } from './config.js';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from './diagnostics.js';
import type { ApiKind, ExecuteRequestResult, RequestInput } from './request.js';

export type QueryLogSource = 'cli' | 'mcp' | 'desktop-console' | 'desktop-action';

export interface QueryLogIntent {
  source: QueryLogSource;
  enabled?: boolean;
  captureResults?: boolean;
  captureRequestBody?: boolean;
  maxResultBytes?: number;
}

export interface QueryLogPreview {
  contentType: 'json' | 'text' | 'void';
  text: string;
  truncated: boolean;
  originalBytes: number;
  shownBytes: number;
  omittedBytes: number;
}

export interface QueryLogEntry {
  version: 1;
  id: string;
  timestamp: string;
  source: QueryLogSource;
  api?: ApiKind;
  method: string;
  environmentAlias?: string;
  accountName?: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  responseType?: string;
  jq?: unknown;
  readIntent?: boolean;
  requestBodyCaptured: boolean;
  requestBodyPreview?: QueryLogPreview;
  preparedRequest?: {
    api: ApiKind;
    baseUrl?: string;
    path: string;
    environmentAlias?: string;
    accountName: string;
  };
  success: boolean;
  status?: number;
  elapsedMs: number;
  diagnostics: Diagnostic[];
  resultCaptured: boolean;
  responsePreview?: QueryLogPreview;
  responseHeaders?: Record<string, string>;
}

interface QueueApiRequestLogOptions<T> {
  input: RequestInput;
  result: OperationResult<ExecuteRequestResult<T>>;
  elapsedMs: number;
  configOptions?: ConfigStoreOptions;
  intent: QueryLogIntent;
}

const logWriteQueues = new Map<string, Promise<void>>();
const SECRET_NAME_PATTERN = /authorization|cookie|token|secret|password|api[-_]?key|client[-_]?secret|session[-_]?id|session[-_]?state/i;

export function queueApiRequestLog<T>(options: QueueApiRequestLogOptions<T>): void {
  const configOptions = options.configOptions ?? {};
  const settings = getQueryLogSettings(configOptions);
  const enabled = options.intent.enabled ?? settings.enabled;
  if (!enabled) return;

  const captureResults = options.intent.captureResults ?? settings.captureResults;
  const captureRequestBody = options.intent.captureRequestBody ?? settings.captureRequestBody;
  const maxResultBytes = options.intent.maxResultBytes ?? settings.maxResultBytes;
  const entry = createQueryLogEntry(options, { captureResults, captureRequestBody, maxResultBytes });
  const filePath = getQueryLogPath(configOptions);
  enqueueLogWrite(filePath, async () => {
    await rotateQueryLogIfNeeded(filePath, settings.maxFileBytes);
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await appendFile(filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') await chmod(filePath, 0o600).catch(() => undefined);
  });
}

export async function flushQueryLogWrites(): Promise<void> {
  await Promise.all(Array.from(logWriteQueues.values()).map((promise) => promise.catch(() => undefined)));
}

export async function loadQueryLogEntries(options: ConfigStoreOptions = {}, limit = 200): Promise<OperationResult<QueryLogEntry[]>> {
  const filePath = getQueryLogPath(options);
  try {
    const entries = [...(await readQueryLogFile(rotatedQueryLogPath(filePath))), ...(await readQueryLogFile(filePath))]
      .map(sanitizeQueryLogEntry)
      .filter((entry): entry is QueryLogEntry => Boolean(entry))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return ok(entries.slice(0, Math.max(1, Math.min(1000, Math.trunc(limit)))));
  } catch (error) {
    return fail(createDiagnostic('error', 'QUERY_LOG_READ_FAILED', `Could not read query log: ${error instanceof Error ? error.message : String(error)}`, { source: 'pp/query-log' }));
  }
}

export async function clearQueryLog(options: ConfigStoreOptions = {}): Promise<OperationResult<{ cleared: true }>> {
  const filePath = getQueryLogPath(options);
  try {
    await Promise.all([unlinkIfExists(filePath), unlinkIfExists(rotatedQueryLogPath(filePath))]);
    return ok({ cleared: true });
  } catch (error) {
    return fail(createDiagnostic('error', 'QUERY_LOG_CLEAR_FAILED', `Could not clear query log: ${error instanceof Error ? error.message : String(error)}`, { source: 'pp/query-log' }));
  }
}

function createQueryLogEntry<T>(options: QueueApiRequestLogOptions<T>, capture: { captureResults: boolean; captureRequestBody: boolean; maxResultBytes: number }): QueryLogEntry {
  const input = options.input;
  const data = options.result.success ? options.result.data : undefined;
  const prepared = data?.request;
  const requestBody = input.rawBody !== undefined ? input.rawBody : input.body;
  const requestBodyPreview = capture.captureRequestBody && requestBody !== undefined ? previewValue(requestBody, capture.maxResultBytes) : undefined;
  const responsePreview = capture.captureResults && data ? previewValue(data.response, capture.maxResultBytes) : undefined;
  return omitUndefined({
    version: 1 as const,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    source: options.intent.source,
    api: prepared?.api ?? input.api,
    method: (input.method ?? 'GET').toUpperCase(),
    environmentAlias: input.environmentAlias ?? prepared?.environment?.alias,
    accountName: input.accountName ?? prepared?.accountName,
    path: redactUrlSecrets(input.path),
    query: redactRecord(input.query),
    headers: redactRecord(input.headers),
    responseType: input.responseType,
    jq: input.jq,
    readIntent: input.readIntent,
    requestBodyCaptured: Boolean(requestBodyPreview),
    requestBodyPreview,
    preparedRequest: prepared
      ? omitUndefined({
          api: prepared.api,
          baseUrl: prepared.baseUrl,
          path: redactUrlSecrets(prepared.path),
          environmentAlias: prepared.environment?.alias,
          accountName: prepared.accountName
        })
      : undefined,
    success: options.result.success,
    status: data?.status,
    elapsedMs: Math.max(0, Math.round(options.elapsedMs)),
    diagnostics: options.result.diagnostics,
    resultCaptured: Boolean(responsePreview),
    responsePreview,
    responseHeaders: responsePreview ? redactRecord(data?.headers) : undefined
  });
}

function previewValue(value: unknown, maxBytes: number): QueryLogPreview | undefined {
  if (value === undefined) return { contentType: 'void', text: '', truncated: false, originalBytes: 0, shownBytes: 0, omittedBytes: 0 };
  const redacted = redactValue(value);
  const isText = typeof redacted === 'string';
  const contentType = isText ? 'text' : 'json';
  const text = isText ? redacted : (JSON.stringify(redacted, null, 2) ?? String(redacted));
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return { contentType, text, truncated: false, originalBytes: buffer.byteLength, shownBytes: buffer.byteLength, omittedBytes: 0 };
  }
  const shown = buffer.subarray(0, maxBytes);
  return {
    contentType,
    text: shown.toString('utf8'),
    truncated: true,
    originalBytes: buffer.byteLength,
    shownBytes: shown.byteLength,
    omittedBytes: buffer.byteLength - shown.byteLength
  };
}

function redactValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactValue);
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = isSecretName(key) ? '[redacted]' : redactValue(item);
  }
  return result;
}

function redactRecord(record: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!record) return undefined;
  const entries = Object.entries(record).map(([key, value]) => [key, isSecretName(key) ? '[redacted]' : String(value)] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function redactUrlSecrets(value: string): string {
  try {
    const url = new URL(value, 'https://pp.local');
    let changed = false;
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSecretName(key)) {
        url.searchParams.set(key, '[redacted]');
        changed = true;
      }
    }
    if (!changed) return value;
    if (/^https?:\/\//i.test(value)) return url.toString();
    return `${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function isSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name);
}

function enqueueLogWrite(filePath: string, writer: () => Promise<void>): void {
  const previous = logWriteQueues.get(filePath) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(writer);
  const stored = current.catch(() => undefined);
  logWriteQueues.set(filePath, stored);
  void stored.finally(() => {
    if (logWriteQueues.get(filePath) === stored) logWriteQueues.delete(filePath);
  });
}

async function rotateQueryLogIfNeeded(filePath: string, maxFileBytes: number): Promise<void> {
  try {
    const info = await stat(filePath);
    if (info.size < maxFileBytes) return;
    const rotated = rotatedQueryLogPath(filePath);
    await unlinkIfExists(rotated);
    await rename(filePath, rotated);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw error;
  }
}

async function readQueryLogFile(filePath: string): Promise<unknown[]> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return undefined;
        }
      })
      .filter((entry) => entry !== undefined);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw error;
  }
}

async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
}

function rotatedQueryLogPath(filePath: string): string {
  return `${filePath}.1`;
}

function sanitizeQueryLogEntry(value: unknown): QueryLogEntry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as QueryLogEntry;
  if (record.version !== 1 || typeof record.id !== 'string' || typeof record.timestamp !== 'string' || typeof record.path !== 'string') return undefined;
  if (record.source !== 'cli' && record.source !== 'mcp' && record.source !== 'desktop-console' && record.source !== 'desktop-action') return undefined;
  return record;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
