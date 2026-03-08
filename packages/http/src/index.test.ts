import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from './index';

describe('HttpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies query params, serializes JSON bodies, and returns detailed responses', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
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
});
