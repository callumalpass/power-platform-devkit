import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import type { TokenProvider } from '@pp/auth';

export interface HttpClientOptions {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  tokenProvider?: TokenProvider;
  retries?: number;
  retryDelayMs?: number;
}

export interface JsonRequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  authenticated?: boolean;
}

export interface HttpError extends Error {
  status?: number;
  body?: string;
}

export class HttpClient {
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(private readonly options: HttpClientOptions = {}) {
    this.retries = options.retries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 250;
  }

  async requestJson<T>(request: JsonRequestOptions): Promise<OperationResult<T>> {
    try {
      const response = await this.perform(request);
      const text = await response.text();
      const data = text ? (JSON.parse(text) as T) : (undefined as T);

      if (!response.ok) {
        return fail(
          createDiagnostic(
            'error',
            'HTTP_REQUEST_FAILED',
            `${request.method ?? 'GET'} ${request.path} returned ${response.status}`,
            {
              source: '@pp/http',
              detail: text,
            }
          ),
          {
            supportTier: 'preview',
          }
        );
      }

      return ok(data, {
        supportTier: 'preview',
      });
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

  async requestText(request: JsonRequestOptions): Promise<OperationResult<string>> {
    try {
      const response = await this.perform(request);
      const text = await response.text();

      if (!response.ok) {
        return fail(
          createDiagnostic(
            'error',
            'HTTP_REQUEST_FAILED',
            `${request.method ?? 'GET'} ${request.path} returned ${response.status}`,
            {
              source: '@pp/http',
              detail: text,
            }
          )
        );
      }

      return ok(text, { supportTier: 'preview' });
    } catch (error) {
      return fail(
        createDiagnostic(
          'error',
          'HTTP_UNHANDLED_ERROR',
          error instanceof Error ? error.message : 'Unknown HTTP error',
          {
            source: '@pp/http',
          }
        )
      );
    }
  }

  private async perform(request: JsonRequestOptions): Promise<Response> {
    const url = new URL(request.path, this.options.baseUrl);
    const headers = new Headers({
      ...(this.options.defaultHeaders ?? {}),
      ...(request.headers ?? {}),
    });

    if (request.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    if (request.authenticated !== false && this.options.tokenProvider) {
      headers.set('authorization', `Bearer ${await this.options.tokenProvider.getAccessToken(url.origin)}`);
    }

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const response = await fetch(url, {
        method: request.method ?? 'GET',
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      });

      if (!shouldRetry(response.status) || attempt === this.retries) {
        return response;
      }

      await delay(this.retryDelayMs * (attempt + 1));
    }

    throw new Error('Unreachable retry state');
  }
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
