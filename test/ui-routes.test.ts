import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleUiRequest, type UiRequestContext } from '../src/ui-routes.js';

function createContext(overrides: Partial<UiRequestContext> = {}): UiRequestContext {
  return {
    configOptions: {},
    allowInteractiveAuth: false,
    host: '127.0.0.1',
    port: 4733,
    jobs: {
      createJob() { throw new Error('not used'); },
      getJob() { return undefined; },
      cancelJob() { return undefined; },
    } as unknown as UiRequestContext['jobs'],
    fetchXmlCatalog: {
      analyze: async () => ({ diagnostics: [], completions: [], context: { from: 0, to: 0 } }),
    } as unknown as UiRequestContext['fetchXmlCatalog'],
    sendVendorModule: async () => { throw new Error('not used'); },
    instanceId: 'test-instance',
    serverUrl: 'http://127.0.0.1:4733',
    ...overrides,
  };
}

function createResponse() {
  const result = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(statusCode: number, headers: Record<string, string>) {
      result.statusCode = statusCode;
      result.headers = headers;
      return result;
    },
    end(chunk?: string) {
      result.body = chunk ?? '';
      return result;
    },
  };
  return result;
}

function createJsonRequest(method: string, url: string, body: unknown) {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
    },
  };
}

test('handleUiRequest serves client asset modules', async () => {
  const response = createResponse();
  await handleUiRequest({ method: 'GET', url: '/assets/ui/app.js' } as any, response as any, createContext());
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /app-root/);
});

test('handleUiRequest returns 404 for unknown routes', async () => {
  const response = createResponse();
  await handleUiRequest({ method: 'GET', url: '/api/unknown' } as any, response as any, createContext());
  assert.equal(response.statusCode, 404);
  assert.match(response.body, /NOT_FOUND/);
});

test('handleUiRequest exposes UI status metadata', async () => {
  const response = createResponse();
  await handleUiRequest({ method: 'GET', url: '/api/ui/status' } as any, response as any, createContext());
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /test-instance/);
  assert.match(response.body, /127\.0\.0\.1:4733/);
});

test('handleUiRequest saves non-interactive accounts with POST /api/accounts', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-ui-routes-'));
  const response = createResponse();
  const request = createJsonRequest('POST', '/api/accounts', {
    name: 'token-account',
    kind: 'environment-token',
    environmentVariable: 'PP_TEST_TOKEN',
  });

  await handleUiRequest(request as any, response as any, createContext({ configOptions: { configDir } }));

  assert.equal(response.statusCode, 201);
  assert.match(response.body, /token-account/);

  const config = JSON.parse(await readFile(join(configDir, 'config.json'), 'utf8'));
  assert.equal(config.accounts['token-account'].kind, 'environment-token');
  assert.equal(config.accounts['token-account'].environmentVariable, 'PP_TEST_TOKEN');
});

test('handleUiRequest validates Dataverse create route before execution', async () => {
  const response = createResponse();
  const request = createJsonRequest('POST', '/api/dv/records/create', {
    environmentAlias: 'dev',
    entitySetName: 'accounts',
    body: {},
  });
  await handleUiRequest(request as any, response as any, createContext());
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /DV_RECORD_BODY_REQUIRED/);
});
