import test from 'node:test';
import assert from 'node:assert/strict';
import { handleUiRequest, type UiRequestContext } from '../src/ui-routes.js';

function createContext(): UiRequestContext {
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

test('handleUiRequest serves client asset modules', async () => {
  const response = createResponse();
  await handleUiRequest({ method: 'GET', url: '/assets/ui/runtime.js' } as any, response as any, createContext());
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /export const els/);
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
