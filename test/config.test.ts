import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 as win32Path } from 'node:path';
import { ensureEnvironmentAccess, getDefaultConfigDir, loadConfig, removeAccount, saveAccount, saveEnvironment, type Account, type Environment } from '../src/config.js';

function tempConfigDir() {
  return mkdtemp(join(tmpdir(), 'pp-config-test-'));
}

const account: Account = {
  name: 'admin',
  kind: 'environment-token',
  environmentVariable: 'PP_TEST_TOKEN'
};

const environment: Environment = {
  alias: 'dev',
  account: 'admin',
  url: 'https://org.crm.dynamics.com',
  makerEnvironmentId: 'maker-env-id',
  tenantId: 'tenant-id'
};

test('loadConfig returns an empty config when no config file exists', async () => {
  const configDir = await tempConfigDir();
  const result = await loadConfig({ configDir });
  assert.equal(result.success, true);
  assert.deepEqual(result.data, { accounts: {}, environments: {}, browserProfiles: {} });
});

test('saveAccount and saveEnvironment persist normalized config JSON', async () => {
  const configDir = await tempConfigDir();

  const accountResult = await saveAccount(account, { configDir });
  assert.equal(accountResult.success, true);

  const environmentResult = await saveEnvironment(environment, { configDir });
  assert.equal(environmentResult.success, true);

  const config = JSON.parse(await readFile(join(configDir, 'config.json'), 'utf8'));
  assert.equal(config.accounts.admin.kind, 'environment-token');
  assert.equal(config.environments.dev.url, 'https://org.crm.dynamics.com');
});

test('removeAccount also removes environments owned by that account', async () => {
  const configDir = await tempConfigDir();
  await saveAccount(account, { configDir });
  await saveAccount({ ...account, name: 'other', environmentVariable: 'PP_OTHER_TOKEN' }, { configDir });
  await saveEnvironment(environment, { configDir });
  await saveEnvironment({ ...environment, alias: 'other-env', account: 'other' }, { configDir });

  const removed = await removeAccount('admin', { configDir });
  assert.equal(removed.success, true);
  assert.equal(removed.data, true);

  const config = await loadConfig({ configDir });
  assert.equal(config.success, true);
  assert.equal(config.data?.accounts.admin, undefined);
  assert.equal(config.data?.environments.dev, undefined);
  assert.equal(config.data?.accounts.other?.name, 'other');
  assert.equal(config.data?.environments['other-env']?.account, 'other');
});

test('ensureEnvironmentAccess blocks writes to read-only environments but allows read intent', async () => {
  const configDir = await tempConfigDir();
  await saveAccount(account, { configDir });
  await saveEnvironment({ ...environment, access: { mode: 'read-only' } }, { configDir });

  const blocked = await ensureEnvironmentAccess('dev', 'POST', false, { configDir });
  assert.equal(blocked.success, false);
  assert.equal(blocked.diagnostics[0]?.code, 'ENVIRONMENT_WRITE_BLOCKED');

  const readIntent = await ensureEnvironmentAccess('dev', 'POST', true, { configDir });
  assert.equal(readIntent.success, true);
  assert.equal(readIntent.data?.mode, 'read-only');

  const get = await ensureEnvironmentAccess('dev', 'GET', false, { configDir });
  assert.equal(get.success, true);
  assert.equal(get.data?.mode, 'read-only');
});

test('getDefaultConfigDir follows platform conventions', () => {
  assert.equal(getDefaultConfigDir('linux', { XDG_CONFIG_HOME: '/xdg' }, '/home/alex'), '/xdg/pp');
  assert.equal(getDefaultConfigDir('linux', {}, '/home/alex'), '/home/alex/.config/pp');
  assert.equal(getDefaultConfigDir('win32', { APPDATA: 'C:\\Users\\Alex\\AppData\\Roaming' }, 'C:\\Users\\Alex'), win32Path.resolve('C:\\Users\\Alex\\AppData\\Roaming\\pp'));
});
