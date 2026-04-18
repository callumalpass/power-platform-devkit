import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthSessionStore } from '../src/ui-auth-sessions.js';
import { CanvasSessionStore } from '../src/ui-canvas-sessions.js';
import { handleUiRequest, type UiRequestContext } from '../src/ui-routes.js';
import { applyResponsePreviewLimit } from '../src/ui-route-requests.js';
import { ok } from '../src/diagnostics.js';
import { TemporaryTokenStore } from '../src/temporary-tokens.js';

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
    authSessions: new AuthSessionStore(),
    canvasSessions: new CanvasSessionStore(),
    fetchXmlCatalog: {
      analyze: async () => ({ diagnostics: [], completions: [], context: { from: 0, to: 0 } }),
    } as unknown as UiRequestContext['fetchXmlCatalog'],
    temporaryTokens: new TemporaryTokenStore(),
    sendVendorModule: async () => { throw new Error('not used'); },
    instanceId: 'test-instance',
    cliSecret: 'test-secret',
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

test('applyResponsePreviewLimit strips oversized response bodies from UI envelopes', () => {
  const hugeValue = 'x'.repeat(10_000);
  const limited = applyResponsePreviewLimit(ok({
    request: { path: '/large' },
    response: { value: hugeValue },
    status: 200,
    headers: {},
  }), 512);

  assert.equal(limited.success, true);
  assert.equal((limited.data as any).response, undefined);
  assert.equal((limited.data as any).responsePreview.truncated, true);
  assert.equal((limited.data as any).responsePreview.shownBytes, 512);
  assert.equal(JSON.stringify(limited).includes(hugeValue), false);
  assert.equal(limited.diagnostics.at(-1)?.code, 'UI_RESPONSE_PREVIEW_TRUNCATED');
});

test('CanvasSessionStore keeps the UI session id stable after service start returns a server session id', async () => {
  const store = new CanvasSessionStore(
    async () => ok({
      appId: 'app-1',
      environmentId: 'env-1',
      account: 'user@example.com',
      sessionId: 'server-session-1',
      startRequestId: 'request-1',
      cluster: {},
      authoringBaseUrl: 'https://authoring.example.test',
      webAuthoringVersion: 'v1',
      sessionState: 'state-1',
      startPath: '/api/authoringsession/start',
      startStatus: 200,
      session: { sessionState: 'state-1', clientConfig: { webAuthoringVersion: 'v1' } },
    }),
    async () => undefined,
  );

  const created = await store.createSession({
    environmentAlias: 'dev',
    appId: 'app-1',
    allowInteractive: false,
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const session = store.getSession(created.id);
  assert.equal(session?.id, created.id);
  assert.equal(session?.status, 'active');
  assert.equal(session?.result?.sessionId, 'server-session-1');
  assert.equal(store.getSession('server-session-1'), undefined);
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

test('handleUiRequest saves interactive accounts without starting login', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-ui-routes-'));
  const response = createResponse();
  const request = createJsonRequest('POST', '/api/accounts', {
    name: 'work',
    kind: 'user',
    loginHint: 'admin@example.com',
  });

  await handleUiRequest(request as any, response as any, createContext({ configOptions: { configDir } }));

  assert.equal(response.statusCode, 201);
  assert.doesNotMatch(response.body, /loginJobId/);

  const config = JSON.parse(await readFile(join(configDir, 'config.json'), 'utf8'));
  assert.equal(config.accounts.work.kind, 'user');
  assert.equal(config.accounts.work.loginHint, 'admin@example.com');
});

test('handleUiRequest exposes browser profile status and reset routes per account', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-ui-routes-'));
  const createResponseResult = createResponse();
  const createRequest = createJsonRequest('POST', '/api/accounts', {
    name: 'work@example.com',
    kind: 'user',
    loginHint: 'work@example.com',
  });
  const context = createContext({ configOptions: { configDir } });

  await handleUiRequest(createRequest as any, createResponseResult as any, context);
  assert.equal(createResponseResult.statusCode, 201);

  const statusResponse = createResponse();
  await handleUiRequest({ method: 'GET', url: '/api/accounts/work%40example.com/browser-profile' } as any, statusResponse as any, context);
  assert.equal(statusResponse.statusCode, 200);
  const statusPayload = JSON.parse(statusResponse.body);
  assert.equal(statusPayload.data.configured, false);
  assert.equal(statusPayload.data.exists, false);

  const resetResponse = createResponse();
  await handleUiRequest({ method: 'DELETE', url: '/api/accounts/work%40example.com/browser-profile' } as any, resetResponse as any, context);
  assert.equal(resetResponse.statusCode, 200);
  const resetPayload = JSON.parse(resetResponse.body);
  assert.equal(resetPayload.data.configured, false);

  const config = JSON.parse(await readFile(join(configDir, 'config.json'), 'utf8'));
  assert.equal(config.accounts['work@example.com'].kind, 'user');
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
