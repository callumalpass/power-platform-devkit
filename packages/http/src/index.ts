import { Buffer } from 'node:buffer';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import type { TokenProvider } from '@pp/auth';

export type HttpQueryPrimitive = string | number | boolean;
export type HttpQueryValue = HttpQueryPrimitive | null | undefined | Array<HttpQueryPrimitive | null | undefined>;
export type HttpResponseType = 'json' | 'text' | 'void';

export interface HttpClientOptions {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  tokenProvider?: TokenProvider;
  retries?: number;
  retryDelayMs?: number;
}

export interface HttpRequestOptions {
  method?: string;
  path: string;
  query?: Record<string, HttpQueryValue>;
  body?: unknown;
  rawBody?: string | Uint8Array | Buffer;
  headers?: Record<string, string>;
  authenticated?: boolean;
  responseType?: HttpResponseType;
}

export interface HttpError extends Error {
  status?: number;
  body?: string;
}

export interface HttpResponse<T> {
  status: number;
  headers: Record<string, string>;
  data: T;
}

type SupportedRequestBody = string | Uint8Array | Buffer;

export class HttpClient {
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(private readonly options: HttpClientOptions = {}) {
    this.retries = options.retries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 250;
  }

  async request<T>(request: HttpRequestOptions): Promise<OperationResult<HttpResponse<T>>> {
    try {
      const response = await this.perform(request);
      const parsed = await readResponse<T>(response, request.responseType ?? 'json');

      if (!response.ok) {
        return fail(
          createDiagnostic(
            'error',
            'HTTP_REQUEST_FAILED',
            `${request.method ?? 'GET'} ${request.path} returned ${response.status}`,
            {
              source: '@pp/http',
              detail: parsed.text ?? '',
            }
          ),
          {
            supportTier: 'preview',
          }
        );
      }

      return ok(
        {
          status: response.status,
          headers: headersToObject(response.headers),
          data: parsed.data,
        },
        {
          supportTier: 'preview',
        }
      );
    } catch (error) {
      return fail(
        createDiagnostic(
          'error',
          'HTTP_UNHANDLED_ERROR',
          error instanceof Error ? error.message : 'Unknown HTTP error',
          {
            source: '@pp/http',
          }
        ),
        {
          supportTier: 'preview',
        }
      );
    }
  }

  async requestJson<T>(request: HttpRequestOptions): Promise<OperationResult<T>> {
    const result = await this.request<T>({
      ...request,
      responseType: request.responseType ?? 'json',
    });

    if (!result.success) {
      return result as unknown as OperationResult<T>;
    }

    return ok(result.data?.data as T, {
      supportTier: result.supportTier,
      diagnostics: result.diagnostics,
      warnings: result.warnings,
      suggestedNextActions: result.suggestedNextActions,
      provenance: result.provenance,
      knownLimitations: result.knownLimitations,
    });
  }

  async requestText(request: HttpRequestOptions): Promise<OperationResult<string>> {
    const result = await this.request<string>({
      ...request,
      responseType: 'text',
    });

    if (!result.success) {
      return result as unknown as OperationResult<string>;
    }

    return ok(result.data?.data ?? '', {
      supportTier: result.supportTier,
      diagnostics: result.diagnostics,
      warnings: result.warnings,
      suggestedNextActions: result.suggestedNextActions,
      provenance: result.provenance,
      knownLimitations: result.knownLimitations,
    });
  }

  private async perform(request: HttpRequestOptions): Promise<Response> {
    const url = new URL(request.path, this.options.baseUrl);
    applyQuery(url.searchParams, request.query);

    const headers = new Headers({
      ...(this.options.defaultHeaders ?? {}),
      ...(request.headers ?? {}),
    });

    const body = resolveRequestBody(request);

    if (request.body !== undefined && request.rawBody === undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    if (request.authenticated !== false && this.options.tokenProvider) {
      headers.set('authorization', `Bearer ${await this.options.tokenProvider.getAccessToken(url.origin)}`);
    }

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const response = await fetch(url, {
        method: request.method ?? 'GET',
        headers,
        body,
      });

      if (!shouldRetry(response.status) || attempt === this.retries) {
        return response;
      }

      await delay(resolveRetryDelayMilliseconds(response, this.retryDelayMs * (attempt + 1)));
    }

    throw new Error('Unreachable retry state');
  }
}

function applyQuery(searchParams: URLSearchParams, query: Record<string, HttpQueryValue> | undefined): void {
  if (!query) {
    return;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) {
          continue;
        }

        searchParams.append(key, String(item));
      }

      continue;
    }

    searchParams.set(key, String(value));
  }
}

function resolveRequestBody(request: HttpRequestOptions): SupportedRequestBody | undefined {
  if (request.rawBody !== undefined) {
    return request.rawBody;
  }

  if (request.body === undefined) {
    return undefined;
  }

  if (typeof request.body === 'string') {
    return request.body;
  }

  if (request.body instanceof Uint8Array || Buffer.isBuffer(request.body)) {
    return request.body;
  }

  return JSON.stringify(request.body);
}

async function readResponse<T>(
  response: Response,
  responseType: HttpResponseType
): Promise<{ data: T; text?: string }> {
  if (responseType === 'void' || response.status === 204 || response.status === 205) {
    return {
      data: undefined as T,
    };
  }

  const text = await response.text();

  if (responseType === 'text') {
    return {
      data: text as T,
      text,
    };
  }

  if (!text) {
    return {
      data: undefined as T,
      text,
    };
  }

  try {
    return {
      data: JSON.parse(text) as T,
      text,
    };
  } catch (error) {
    if (!response.ok) {
      return {
        data: undefined as T,
        text,
      };
    }

    throw new Error(`Expected JSON response but received invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

function shouldRetry(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function resolveRetryDelayMilliseconds(response: Response, fallbackDelayMilliseconds: number): number {
  const retryAfter = response.headers.get('retry-after');

  if (!retryAfter) {
    return fallbackDelayMilliseconds;
  }

  const asSeconds = Number(retryAfter);

  if (!Number.isNaN(asSeconds)) {
    return Math.max(0, asSeconds * 1000);
  }

  const asDate = Date.parse(retryAfter);

  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }

  return fallbackDelayMilliseconds;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
