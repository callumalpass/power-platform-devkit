import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from './index';

describe('HttpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies query params, serializes JSON bodies, and returns detailed responses', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://example.com/api/accounts?%24select=name&tag=active&tag=priority');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(JSON.stringify({ name: 'Acme' }));
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json');

      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-1',
        },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpClient({
      baseUrl: 'https://example.com/api/',
    });

    const response = await client.request<{ ok: boolean }>({
      path: 'accounts',
      method: 'POST',
      query: {
        '$select': 'name',
        tag: ['active', 'priority'],
      },
      body: {
        name: 'Acme',
      },
    });

    expect(response.success).toBe(true);
    expect(response.data).toEqual({
      status: 201,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req-1',
      },
      data: {
        ok: true,
      },
    });
  });

  it('preserves error response bodies for void requests', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: '0x80040203', message: 'Invalid option set metadata.' } }), {
        status: 400,
        headers: {
          'content-type': 'application/json',
        },
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpClient({
      baseUrl: 'https://example.com/api/',
    });

    const response = await client.request<void>({
      path: 'EntityDefinitions(LogicalName=\'pp_project\')/Attributes',
      method: 'POST',
      responseType: 'void',
      body: { test: true },
    });

    expect(response.success).toBe(false);
    expect(response.diagnostics[0]).toMatchObject({
      code: 'HTTP_REQUEST_FAILED',
      message: "POST EntityDefinitions(LogicalName='pp_project')/Attributes returned 400",
      detail: '{"error":{"code":"0x80040203","message":"Invalid option set metadata."}}',
    });
  });

  it('preserves structured token acquisition diagnostics', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    class InteractiveAuthRequiredError extends Error {
      readonly code = 'AUTH_INTERACTIVE_LOGIN_REQUIRED';
      readonly hint = 'Run `pp auth login --name test-user --resource https://example.crm.dynamics.com` to refresh the cached session.';
      readonly detail = 'Browser profile test-user was last bootstrapped for https://make.powerapps.com/.';
    }

    const client = new HttpClient({
      baseUrl: 'https://example.com/api/',
      tokenProvider: {
        getAccessToken: async () => {
          throw new InteractiveAuthRequiredError('Interactive browser authentication is required for profile test-user.');
        },
      },
    });

    const response = await client.requestJson<{ ok: boolean }>({
      path: 'accounts',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.success).toBe(false);
    expect(response.diagnostics[0]).toMatchObject({
      code: 'AUTH_INTERACTIVE_LOGIN_REQUIRED',
      message: 'Interactive browser authentication is required for profile test-user.',
      hint: 'Run `pp auth login --name test-user --resource https://example.crm.dynamics.com` to refresh the cached session.',
      detail: 'Browser profile test-user was last bootstrapped for https://make.powerapps.com/.',
    });
  });

  it('aborts requests that exceed the configured timeout', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      });
      return new Response(null, { status: 204 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpClient({
      baseUrl: 'https://example.com/api/',
    });

    const response = await client.requestJson<{ ok: boolean }>({
      path: 'ExportSolution',
      method: 'POST',
      timeoutMs: 10,
    });

    expect(response.success).toBe(false);
    expect(response.diagnostics[0]).toMatchObject({
      code: 'HTTP_REQUEST_TIMEOUT',
      message: 'POST ExportSolution timed out after 10ms',
    });
  });

  it('adds request context and retry guidance for unhandled fetch failures', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpClient({
      baseUrl: 'https://example.com/api/',
      retries: 1,
    });

    const response = await client.requestJson<{ ok: boolean }>({
      path: 'workflows',
      query: {
        '$top': 1,
      },
    });

    expect(response.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.diagnostics[0]).toMatchObject({
      code: 'HTTP_UNHANDLED_ERROR',
      message: 'fetch failed',
      hint: expect.stringContaining('Retry once'),
      detail: expect.stringContaining('GET https://example.com/api/workflows?%24top=1'),
    });
    expect(response.diagnostics[0]?.detail).toContain('Attempted up to 2 request time(s) including retries.');
  });
});
