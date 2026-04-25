import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PpClient } from '../src/client.js';
import { saveAccount, saveEnvironment } from '../src/config.js';

test('PpClient wraps account helpers with configured config dir', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-client-accounts-'));
  await saveAccount({ name: 'work', kind: 'static-token', token: 'test-token' }, { configDir });

  const pp = new PpClient({ configDir });
  const accounts = await pp.accounts.list();

  assert.equal(accounts.success, true);
  assert.deepEqual(accounts.data?.map((account) => account.name), ['work']);
});

test('PpClient.request accepts env and account aliases', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-client-request-'));
  await saveAccount({ name: 'work', kind: 'static-token', token: 'test-token' }, { configDir });
  await saveEnvironment({
    alias: 'dev',
    account: 'work',
    url: 'https://org.crm.dynamics.com',
    makerEnvironmentId: 'f3f934b0-7b79-e09e-b393-f0b21c05fcce',
    tenantId: 'tenant-id',
  }, { configDir });

  const calls: Array<{ url: string; authorization: string | null }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), authorization: headers.get('authorization') });
    return new Response(JSON.stringify({ value: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const pp = new PpClient({ configDir });
    const result = await pp.request({
      env: 'dev',
      account: 'work',
      api: 'dv',
      path: '/accounts',
      readIntent: true,
    });

    assert.equal(result.success, true);
    assert.equal(calls.at(-1)?.url, 'https://org.crm.dynamics.com/api/data/v9.2/accounts');
    assert.equal(calls.at(-1)?.authorization, 'Bearer test-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PpClient environment operations report missing env as diagnostics', async () => {
  const pp = new PpClient();

  const results = await Promise.all([
    pp.whoami({}),
    pp.ping({}),
    pp.token({}),
  ]);

  for (const result of results) {
    assert.equal(result.success, false);
    assert.equal(result.diagnostics[0]?.code, 'ENVIRONMENT_ALIAS_REQUIRED');
    assert.equal(result.diagnostics[0]?.source, 'pp/client');
  }
});
