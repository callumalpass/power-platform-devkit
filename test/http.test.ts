import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeHttpQuery, HttpClient } from '../src/http.js';

test('encodeHttpQuery preserves OData query names and encodes reserved values', () => {
  assert.equal(
    encodeHttpQuery({
      $select: 'name,accountnumber',
      $filter: "name eq 'A & B #1' and code eq 'x=y%25'",
      search: 'snowman ☃'
    }),
    "$select=name%2Caccountnumber&$filter=name%20eq%20'A%20%26%20B%20%231'%20and%20code%20eq%20'x%3Dy%2525'&search=snowman%20%E2%98%83"
  );
});

test('encodeHttpQuery repeats array query values and skips nullish entries', () => {
  assert.equal(
    encodeHttpQuery({
      include: ['apps', undefined, 'flows', null],
      empty: undefined,
      active: true,
      top: 25
    }),
    'include=apps&include=flows&active=true&top=25'
  );
});

test('HttpClient appends encoded query values to existing URL queries', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const client = new HttpClient({ baseUrl: 'https://example.test' });
    const result = await client.request({
      path: '/api/data/v9.2/accounts?existing=yes',
      query: {
        $top: 1,
        q: 'a&b=c#d%'
      }
    });

    assert.equal(result.success, true);
    assert.equal(calls[0], 'https://example.test/api/data/v9.2/accounts?existing=yes&$top=1&q=a%26b%3Dc%23d%25');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
