import type { TokenProvider } from './auth.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';

export type HttpQueryPrimitive = string | number | boolean;
export type HttpQueryValue = HttpQueryPrimitive | null | undefined | Array<HttpQueryPrimitive | null | undefined>;
export type HttpResponseType = 'json' | 'text' | 'void';

export interface HttpClientOptions {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  tokenProvider?: TokenProvider;
  authResource?: string;
}

export interface HttpRequestOptions {
  method?: string;
  path: string;
  query?: Record<string, HttpQueryValue>;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  responseType?: HttpResponseType;
  timeoutMs?: number;
}

export interface HttpResponse<T> {
  status: number;
  headers: Record<string, string>;
  data: T;
}

export class HttpClient {
  constructor(private readonly options: HttpClientOptions = {}) {}

  async request<T>(request: HttpRequestOptions): Promise<OperationResult<HttpResponse<T>>> {
    try {
      const url = new URL(request.path, this.options.baseUrl);
      applyQuery(url, request.query);
      const headers = new Headers({ ...(this.options.defaultHeaders ?? {}), ...(request.headers ?? {}) });
      if (this.options.tokenProvider) {
        headers.set('authorization', `Bearer ${await this.options.tokenProvider.getAccessToken(this.options.authResource ?? url.origin)}`);
      }
      const body = resolveRequestBody(request);
      if (request.body !== undefined && request.rawBody === undefined && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      const controller = request.timeoutMs ? new AbortController() : undefined;
      const timeoutHandle = request.timeoutMs
        ? setTimeout(() => {
            controller?.abort();
          }, request.timeoutMs)
        : undefined;
      try {
        const response = await fetch(url, {
          method: request.method ?? 'GET',
          headers,
          body,
          ...(controller ? { signal: controller.signal } : {}),
        });
        const parsed = await readResponse<T>(response, request.responseType ?? 'json');
        if (!response.ok) {
          return fail(
            createDiagnostic('error', 'HTTP_REQUEST_FAILED', `${request.method ?? 'GET'} ${url.toString()} returned ${response.status}.`, {
              source: 'pp/http',
              detail: parsed.text,
            }),
          );
        }
        return ok({
          status: response.status,
          headers: headersToObject(response.headers),
          data: parsed.data,
        });
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    } catch (error) {
      return fail(
        createDiagnostic('error', 'HTTP_UNHANDLED_ERROR', error instanceof Error ? error.message : String(error), {
          source: 'pp/http',
        }),
      );
    }
  }
}

function applyQuery(url: URL, query: Record<string, HttpQueryValue> | undefined): void {
  if (!query) return;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) parts.push(`${key}=${encodeODataValue(String(item))}`);
      }
      continue;
    }
    parts.push(`${key}=${encodeODataValue(String(value))}`);
  }
  if (!parts.length) return;
  const existing = url.search ? url.search.slice(1) : '';
  url.search = existing ? `${existing}&${parts.join('&')}` : parts.join('&');
}

function encodeODataValue(value: string): string {
  return value.replace(/ /g, '%20').replace(/#/g, '%23');
}

function resolveRequestBody(request: HttpRequestOptions): string | undefined {
  if (request.rawBody !== undefined) return request.rawBody;
  if (request.body === undefined) return undefined;
  if (typeof request.body === 'string') return request.body;
  return JSON.stringify(request.body);
}

async function readResponse<T>(response: Response, responseType: HttpResponseType): Promise<{ data: T; text?: string }> {
  if (responseType === 'void' || response.status === 204 || response.status === 205) {
    return { data: undefined as T };
  }
  const text = await response.text();
  if (responseType === 'text') {
    return { data: text as T, text };
  }
  if (!text) {
    return { data: undefined as T, text };
  }
  try {
    return { data: JSON.parse(text) as T, text };
  } catch {
    if (!response.ok) return { data: undefined as T, text };
    throw new Error('Expected JSON response.');
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const values: Record<string, string> = {};
  headers.forEach((value, key) => {
    values[key] = value;
  });
  return values;
}
