import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '../src/diagnostics.js';
import { AuthSessionStore, type AuthSession, type AuthSessionLogin } from '../src/ui-auth-sessions.js';

test('AuthSessionStore exposes interactive browser URLs while login continues in the background', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-session-url-'));
  const login: AuthSessionLogin = async (account, options = {}) => {
    const target = options.loginTargets?.[0] ?? { resource: 'https://graph.microsoft.com', label: 'Graph', api: 'graph' };
    await options.onLoginTargetUpdate?.({ target, index: 0, total: 1, status: 'running', url: 'https://login.example.test/authorize' });
    await delay(20);
    return ok({ account: { name: account.name }, resource: target.resource, resources: [target.resource] });
  };
  const store = new AuthSessionStore(login);

  const created = await store.createSession({
    account: { name: 'work', kind: 'user' },
    allowInteractiveAuth: true,
    includeApis: ['graph'],
    configOptions: { configDir }
  });

  const waiting = await store.waitForFirstActionOrTerminal(created.id);
  assert.ok(waiting);
  assert.equal(waiting.targets.length, 1);
  assert.deepEqual(waiting.targets[0]?.action, { kind: 'browser-url', url: 'https://login.example.test/authorize' });

  const completed = await waitForSession(store, created.id, (session) => session.status === 'completed');
  assert.equal(completed.result?.success, true);
});

test('AuthSessionStore exposes device-code prompts while login continues in the background', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-session-device-'));
  const login: AuthSessionLogin = async (account, options = {}) => {
    await options.onDeviceCode?.({
      verificationUri: 'https://microsoft.com/devicelogin',
      userCode: 'ABCD-EFGH',
      message: 'Use code ABCD-EFGH at https://microsoft.com/devicelogin'
    });
    await delay(20);
    return ok({ account: { name: account.name }, resource: 'https://graph.microsoft.com', resources: ['https://graph.microsoft.com'] });
  };
  const store = new AuthSessionStore(login);

  const created = await store.createSession({
    account: { name: 'work', kind: 'device-code' },
    preferredFlow: 'device-code',
    allowInteractiveAuth: true,
    includeApis: ['graph'],
    configOptions: { configDir }
  });

  const waiting = await store.waitForFirstActionOrTerminal(created.id);
  assert.ok(waiting);
  assert.deepEqual(waiting.targets[0]?.action, {
    kind: 'device-code',
    verificationUri: 'https://microsoft.com/devicelogin',
    userCode: 'ABCD-EFGH',
    message: 'Use code ABCD-EFGH at https://microsoft.com/devicelogin'
  });

  const completed = await waitForSession(store, created.id, (session) => session.status === 'completed');
  assert.equal(completed.result?.success, true);
});

test('AuthSessionStore can target SharePoint auth for a specific tenant host', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-session-sharepoint-'));
  const seenTargets: Array<{ resource: string; label?: string; api?: string }> = [];
  const login: AuthSessionLogin = async (account, options = {}) => {
    seenTargets.push(...(options.loginTargets ?? []));
    const target = options.loginTargets?.[0] ?? { resource: 'https://graph.microsoft.com', label: 'Graph', api: 'graph' };
    await options.onLoginTargetUpdate?.({ target, index: 0, total: 1, status: 'running', url: 'https://login.example.test/authorize' });
    return ok({ account: { name: account.name }, resource: target.resource, resources: [target.resource] });
  };
  const store = new AuthSessionStore(login);

  const created = await store.createSession({
    account: { name: 'work', kind: 'user' },
    allowInteractiveAuth: true,
    includeApis: ['sharepoint'],
    sharePointUrl: 'https://contoso.sharepoint.com/sites/team/_api/web',
    configOptions: { configDir }
  });

  assert.equal(created.targets.length, 1);
  assert.equal(created.targets[0]?.resource, 'https://contoso.sharepoint.com');
  assert.equal(created.targets[0]?.label, 'SharePoint');

  const completed = await waitForSession(store, created.id, (session) => session.status === 'completed');
  assert.equal(completed.result?.success, true);
  assert.deepEqual(seenTargets, [{ resource: 'https://contoso.sharepoint.com', label: 'SharePoint', api: 'sharepoint' }]);
});

test('AuthSessionStore does not include SharePoint in default login targets', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-session-default-targets-'));
  const seenTargets: Array<{ resource: string; label?: string; api?: string }> = [];
  const login: AuthSessionLogin = async (account, options = {}) => {
    seenTargets.push(...(options.loginTargets ?? []));
    return ok({ account: { name: account.name }, resources: options.loginTargets?.map((target) => target.resource) ?? [] });
  };
  const store = new AuthSessionStore(login);

  const created = await store.createSession({
    account: { name: 'work', kind: 'user' },
    allowInteractiveAuth: true,
    configOptions: { configDir }
  });

  assert.equal(created.status, 'pending');
  const completed = await waitForSession(store, created.id, (session) => session.status === 'completed');
  assert.equal(completed.result?.success, true);
  assert.equal(
    seenTargets.some((target) => target.api === 'sharepoint'),
    false
  );
});

test('AuthSessionStore rejects SharePoint auth sessions without a SharePoint URL', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-session-sharepoint-missing-'));
  const store = new AuthSessionStore(async () => ok({}));

  const created = await store.createSession({
    account: { name: 'work', kind: 'user' },
    allowInteractiveAuth: true,
    includeApis: ['sharepoint'],
    configOptions: { configDir }
  });

  assert.equal(created.status, 'failed');
  assert.equal(created.result?.diagnostics[0]?.code, 'SHAREPOINT_AUTH_URL_REQUIRED');
});

async function waitForSession(store: AuthSessionStore, id: string, predicate: (session: AuthSession) => boolean): Promise<AuthSession> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const session = store.getSession(id);
    if (session && predicate(session)) return session;
    await delay(10);
  }
  assert.fail(`Timed out waiting for auth session ${id}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
