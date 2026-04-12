import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, normalizeOrigin, resourceForApi, type ApiKind } from '../src/request-executor.js';
import type { Environment } from '../src/config.js';

const environment: Environment = {
  alias: 'dev',
  account: 'admin',
  url: 'https://org.crm.dynamics.com',
  makerEnvironmentId: 'maker-env-id',
  tenantId: 'tenant-id',
};

test('buildRequest normalizes relative paths for each Power Platform API', () => {
  const cases: Array<{ api: ApiKind; input: string; baseUrl?: string; path: string; authResource: string }> = [
    { api: 'dv', input: '/accounts', baseUrl: environment.url, path: '/api/data/v9.2/accounts', authResource: 'https://org.crm.dynamics.com' },
    { api: 'flow', input: '/flows', baseUrl: 'https://api.flow.microsoft.com', path: '/providers/Microsoft.ProcessSimple/environments/maker-env-id/flows', authResource: 'https://service.flow.microsoft.com' },
    { api: 'bap', input: '/environments', baseUrl: 'https://api.bap.microsoft.com', path: '/providers/Microsoft.BusinessAppPlatform/environments', authResource: 'https://service.powerapps.com' },
    { api: 'powerapps', input: '/apps/{environment}', baseUrl: 'https://api.powerapps.com', path: '/providers/Microsoft.PowerApps/apps/maker-env-id', authResource: 'https://service.powerapps.com' },
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
});
