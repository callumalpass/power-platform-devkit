import test from 'node:test';
import assert from 'node:assert/strict';
import { accountForApi, buildRequest, normalizeOrigin, resourceForApi, type ApiKind } from '../src/request-executor.js';
import type { Account, Environment } from '../src/config.js';

const environment: Environment = {
  alias: 'dev',
  account: 'admin',
  url: 'https://org.crm.dynamics.com',
  makerEnvironmentId: 'f3f934b0-7b79-e09e-b393-f0b21c05fcce',
  tenantId: 'tenant-id',
};

test('buildRequest normalizes relative paths for each Power Platform API', () => {
  const cases: Array<{ api: ApiKind; input: string; baseUrl?: string; path: string; authResource: string }> = [
    { api: 'dv', input: '/accounts', baseUrl: environment.url, path: '/api/data/v9.2/accounts', authResource: 'https://org.crm.dynamics.com' },
    { api: 'flow', input: '/flows', baseUrl: 'https://api.flow.microsoft.com', path: '/providers/Microsoft.ProcessSimple/environments/f3f934b0-7b79-e09e-b393-f0b21c05fcce/flows', authResource: 'https://service.flow.microsoft.com' },
    { api: 'bap', input: '/environments', baseUrl: 'https://api.bap.microsoft.com', path: '/providers/Microsoft.BusinessAppPlatform/environments', authResource: 'https://service.powerapps.com' },
    { api: 'powerapps', input: '/apps/{environment}', baseUrl: 'https://api.powerapps.com', path: '/providers/Microsoft.PowerApps/apps/f3f934b0-7b79-e09e-b393-f0b21c05fcce', authResource: 'https://service.powerapps.com' },
    { api: 'canvas-authoring', input: '/gateway/cluster', baseUrl: 'https://f3f934b07b79e09eb393f0b21c05fc.ce.environment.api.powerplatform.com', path: '/gateway/cluster', authResource: 'c6c4e5e1-0bc0-4d7d-b69b-954a907287e4/.default' },
    { api: 'graph', input: '/me', baseUrl: 'https://graph.microsoft.com', path: '/v1.0/me', authResource: 'https://graph.microsoft.com' },
  ];

  for (const item of cases) {
    const result = buildRequest(environment, 'admin', item.input, item.api);
    assert.equal(result.success, true);
    assert.equal(result.data?.api, item.api);
    assert.equal(result.data?.baseUrl, item.baseUrl);
    assert.equal(result.data?.path, item.path);
    assert.equal(result.data?.authResource, item.authResource);
  }
});

test('buildRequest preserves fully-qualified URLs for detected APIs', () => {
  const dv = buildRequest(environment, 'admin', 'https://other.crm.dynamics.com/api/data/v9.2/accounts?$top=1');
  assert.equal(dv.success, true);
  assert.equal(dv.data?.api, 'dv');
  assert.equal(dv.data?.baseUrl, 'https://other.crm.dynamics.com');
  assert.equal(dv.data?.path, '/api/data/v9.2/accounts?$top=1');
  assert.equal(dv.data?.authResource, 'https://other.crm.dynamics.com');

  const graph = buildRequest(environment, 'admin', 'https://graph.microsoft.com/v1.0/users?$top=1');
  assert.equal(graph.success, true);
  assert.equal(graph.data?.api, 'graph');
  assert.equal(graph.data?.baseUrl, 'https://graph.microsoft.com');
  assert.equal(graph.data?.path, '/v1.0/users?$top=1');

  const canvasAuthoring = buildRequest(environment, 'admin', 'https://authoring.seau-il102.gateway.prod.island.powerapps.com/v3/api/yaml/fetch');
  assert.equal(canvasAuthoring.success, true);
  assert.equal(canvasAuthoring.data?.api, 'canvas-authoring');
  assert.equal(canvasAuthoring.data?.baseUrl, 'https://authoring.seau-il102.gateway.prod.island.powerapps.com');
  assert.equal(canvasAuthoring.data?.path, '/v3/api/yaml/fetch');
  assert.equal(canvasAuthoring.data?.authResource, 'c6c4e5e1-0bc0-4d7d-b69b-954a907287e4/.default');
});

test('buildRequest requires absolute URLs for custom API requests', () => {
  const result = buildRequest(environment, 'admin', '/relative', 'custom');
  assert.equal(result.success, false);
  assert.equal(result.diagnostics[0]?.code, 'CUSTOM_REQUEST_URL_REQUIRED');
});

test('resourceForApi and normalizeOrigin select expected auth resources', () => {
  assert.equal(normalizeOrigin('https://org.crm.dynamics.com/main.aspx?id=1'), 'https://org.crm.dynamics.com');
  assert.equal(resourceForApi(environment, 'dv'), 'https://org.crm.dynamics.com');
  assert.equal(resourceForApi(environment, 'flow'), 'https://service.flow.microsoft.com');
  assert.equal(resourceForApi(environment, 'graph'), 'https://graph.microsoft.com');
  assert.equal(resourceForApi(environment, 'bap'), 'https://service.powerapps.com');
  assert.equal(resourceForApi(environment, 'powerapps'), 'https://service.powerapps.com');
  assert.equal(resourceForApi(environment, 'canvas-authoring'), 'c6c4e5e1-0bc0-4d7d-b69b-954a907287e4/.default');
});

test('accountForApi swaps the saved pp default client for canvas authoring only', () => {
  const account: Account = {
    name: 'admin',
    kind: 'user',
    tenantId: 'common',
    clientId: '51f81489-12ee-4a9e-aaae-a2591f45987d',
    tokenCacheKey: 'admin',
  };

  assert.equal(accountForApi(account, 'dv'), account);

  const canvasAccount = accountForApi(account, 'canvas-authoring');
  assert.notEqual(canvasAccount, account);
  assert.equal(canvasAccount.clientId, '4e291c71-d680-4d0e-9640-0a3358e31177');
  assert.equal(canvasAccount.tokenCacheKey, 'admin-canvas-authoring');
});
