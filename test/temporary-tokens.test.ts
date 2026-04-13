import test from 'node:test';
import assert from 'node:assert/strict';
import type { Environment } from '../src/config.js';
import { TemporaryTokenStore } from '../src/temporary-tokens.js';

const environment: Environment = {
  alias: 'dev',
  account: 'admin',
  url: 'https://org.crm.dynamics.com',
  makerEnvironmentId: 'f3f934b0-7b79-e09e-b393-f0b21c05fcce',
  tenantId: 'tenant-id',
};

test('audience temporary tokens only match requests for that audience', async () => {
  const store = new TemporaryTokenStore();
  const added = store.add({
    name: 'sharepoint',
    token: fakeJwt({ aud: 'https://contoso.sharepoint.com', exp: Math.floor(Date.now() / 1000) + 3600 }),
    match: { kind: 'audience', audience: 'https://contoso.sharepoint.com' },
  });

  assert.equal(added.success, true);

  const graph = await store.resolve({
    environment,
    api: 'graph',
    path: '/me',
  });
  assert.equal(graph.success, true);
  assert.equal(graph.data, undefined);

  const sharePoint = await store.resolve({
    environment,
    api: 'custom',
    path: 'https://contoso.sharepoint.com/sites/demo/_api/web',
  });
  assert.equal(sharePoint.success, true);
  assert.equal(sharePoint.data?.summary.name, 'sharepoint');
});

function fakeJwt(claims: Record<string, unknown>): string {
  return `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url(claims)}.`;
}

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
