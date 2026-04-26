import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopApiContext, handleDesktopApiRequest, type DesktopApiContext } from '../src/desktop-api.js';
import { CanvasSessionStore } from '../src/ui-canvas-sessions.js';
import { ok } from '../src/diagnostics.js';

function createContext(overrides: Partial<DesktopApiContext> = {}): DesktopApiContext {
  return {
    ...createDesktopApiContext({ allowInteractiveAuth: false }),
    ...overrides
  };
}

function responseBody<T>(body: unknown): { success?: boolean; data: T; diagnostics?: Array<{ code?: string; message?: string }> } {
  return body as { success?: boolean; data: T; diagnostics?: Array<{ code?: string; message?: string }> };
}

test('handleDesktopApiRequest returns 404 for unknown routes', async () => {
  const response = await handleDesktopApiRequest(createContext(), { method: 'GET', path: '/api/unknown' });
  assert.equal(response.status, 404);
  assert.match(JSON.stringify(response.body), /NOT_FOUND/);
});

test('handleDesktopApiRequest exposes desktop status metadata', async () => {
  const response = await handleDesktopApiRequest(createContext(), { method: 'GET', path: '/api/app/status' });
  assert.equal(response.status, 200);
  assert.match(JSON.stringify(response.body), /pp-desktop/);
});

test('handleDesktopApiRequest saves non-interactive accounts with POST /api/accounts', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-desktop-api-'));
  const response = await handleDesktopApiRequest(createContext({ configOptions: { configDir } }), {
    method: 'POST',
    path: '/api/accounts',
    body: {
      name: 'token-account',
      kind: 'environment-token',
      environmentVariable: 'PP_TEST_TOKEN'
    }
  });

  assert.equal(response.status, 201);
  assert.match(JSON.stringify(response.body), /token-account/);

  const config = JSON.parse(await readFile(join(configDir, 'config.json'), 'utf8'));
  assert.equal(config.accounts['token-account'].kind, 'environment-token');
  assert.equal(config.accounts['token-account'].environmentVariable, 'PP_TEST_TOKEN');
});

test('handleDesktopApiRequest saves interactive accounts without starting login', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-desktop-api-'));
  const response = await handleDesktopApiRequest(createContext({ configOptions: { configDir } }), {
    method: 'POST',
    path: '/api/accounts',
    body: {
      name: 'work',
      kind: 'user',
      loginHint: 'admin@example.com'
    }
  });

  assert.equal(response.status, 201);
  assert.doesNotMatch(JSON.stringify(response.body), /loginJobId/);

  const config = JSON.parse(await readFile(join(configDir, 'config.json'), 'utf8'));
  assert.equal(config.accounts.work.kind, 'user');
  assert.equal(config.accounts.work.loginHint, 'admin@example.com');
});

test('handleDesktopApiRequest exposes browser profile status and reset routes per account', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-desktop-api-'));
  const context = createContext({ configOptions: { configDir } });

  const createResponse = await handleDesktopApiRequest(context, {
    method: 'POST',
    path: '/api/accounts',
    body: {
      name: 'work@example.com',
      kind: 'user',
      loginHint: 'work@example.com'
    }
  });
  assert.equal(createResponse.status, 201);

  const statusResponse = await handleDesktopApiRequest(context, {
    method: 'GET',
    path: '/api/accounts/work%40example.com/browser-profile'
  });
  assert.equal(statusResponse.status, 200);
  assert.equal(responseBody<{ configured: boolean; exists: boolean }>(statusResponse.body).data.configured, false);
  assert.equal(responseBody<{ configured: boolean; exists: boolean }>(statusResponse.body).data.exists, false);

  const resetResponse = await handleDesktopApiRequest(context, {
    method: 'DELETE',
    path: '/api/accounts/work%40example.com/browser-profile'
  });
  assert.equal(resetResponse.status, 200);
  assert.equal(responseBody<{ configured: boolean }>(resetResponse.body).data.configured, false);

  const config = JSON.parse(await readFile(join(configDir, 'config.json'), 'utf8'));
  assert.equal(config.accounts['work@example.com'].kind, 'user');
});

test('handleDesktopApiRequest validates Dataverse create route before execution', async () => {
  const response = await handleDesktopApiRequest(createContext(), {
    method: 'POST',
    path: '/api/dv/records/create',
    body: {
      environmentAlias: 'dev',
      entitySetName: 'accounts',
      body: {}
    }
  });
  assert.equal(response.status, 400);
  assert.match(JSON.stringify(response.body), /DV_RECORD_BODY_REQUIRED/);
});

test('handleDesktopApiRequest serves flow language analysis over IPC-style routing', async () => {
  const source = await readFile(join(process.cwd(), 'test/fixtures/flows/broken-power-automate-wrapper.json'), 'utf8');
  const response = await handleDesktopApiRequest(createContext(), {
    method: 'POST',
    path: '/api/flow/language/analyze',
    body: { source, cursor: 0 }
  });
  assert.equal(response.status, 200);
  const body = responseBody<{ summary: { wrapperKind?: string }; diagnostics: Array<{ code?: string }> }>(response.body);
  assert.equal(body.success, true);
  assert.equal(body.data.summary.wrapperKind, 'resource-properties-definition');
  assert.equal(
    body.data.diagnostics.some((item) => item.code === 'FLOW_REFERENCE_UNRESOLVED'),
    false
  );
});

test('CanvasSessionStore keeps the UI session id stable after service start returns a server session id', async () => {
  const store = new CanvasSessionStore(
    async () =>
      ok({
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
        session: { sessionState: 'state-1', clientConfig: { webAuthoringVersion: 'v1' } }
      }),
    async () => undefined
  );

  const created = await store.createSession({
    environmentAlias: 'dev',
    appId: 'app-1',
    allowInteractive: false
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const session = store.getSession(created.id);
  assert.equal(session?.id, created.id);
  assert.equal(session?.status, 'active');
  assert.equal(session?.result?.sessionId, 'server-session-1');
  assert.equal(store.getSession('server-session-1'), undefined);
});
