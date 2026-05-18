import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthService, resolveScopes } from '../src/auth.js';
import { getCredentialStoreDir, getMsalCacheDir, loadConfig, saveAccount } from '../src/config.js';
import { createWindowsDpapiCredentialStore } from '../src/windows-dpapi-store.js';
import { discoverAccessibleEnvironments } from '../src/services/environments.js';

test('AuthService.removeAccount deletes MSAL caches for account cache keys', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-remove-'));
  const configOptions = { configDir, credentialStore: 'file' as const };
  const msalDir = getMsalCacheDir(configOptions);
  await mkdir(msalDir, { recursive: true });
  await saveAccount({ name: 'work', kind: 'user', tokenCacheKey: 'work-cache' }, configOptions);

  const removedCachePaths = [join(msalDir, 'work.json'), join(msalDir, 'work-canvas-authoring.json'), join(msalDir, 'work-cache.json'), join(msalDir, 'work-cache-canvas-authoring.json')];
  const retainedCachePath = join(msalDir, 'other.json');
  for (const path of [...removedCachePaths, retainedCachePath]) {
    await writeFile(path, '{}\n', 'utf8');
  }

  const removed = await new AuthService(configOptions).removeAccount('work');
  assert.equal(removed.success, true);
  assert.equal(removed.data, true);

  for (const path of removedCachePaths) {
    assert.equal(existsSync(path), false, `${path} should be deleted`);
  }
  assert.equal(existsSync(retainedCachePath), true);

  const config = await loadConfig(configOptions);
  assert.equal(config.success, true);
  assert.equal(config.data?.accounts.work, undefined);
});

test('resolveScopes uses resource-specific scopes for SharePoint even when account scopes are configured', () => {
  const account = {
    name: 'work',
    kind: 'user' as const,
    scopes: ['https://graph.microsoft.com/.default']
  };

  assert.deepEqual(resolveScopes(account, 'https://contoso.sharepoint.com'), ['https://contoso.sharepoint.com/.default']);
  assert.deepEqual(resolveScopes(account, 'https://graph.microsoft.com'), ['https://graph.microsoft.com/.default']);
  assert.deepEqual(resolveScopes(account, 'https://custom.example.test'), ['https://graph.microsoft.com/.default']);
});

test('environment discovery ignores corrupt OS-backed MSAL cache instead of surfacing raw JSON parse errors', async (t) => {
  if (process.platform !== 'linux') {
    t.skip('fake secret-tool test only applies on Linux');
    return;
  }

  const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-corrupt-secure-cache-'));
  const binDir = await mkdtemp(join(tmpdir(), 'pp-auth-fake-bin-'));
  const secretToolPath = join(binDir, 'secret-tool');
  await writeFile(
    secretToolPath,
    `#!/usr/bin/env node
const command = process.argv[2];
if (command === 'lookup') {
  process.stdout.write('{"bad":"'.padEnd(8192, 'x'));
  process.exit(0);
}
if (command === 'clear') process.exit(0);
if (command === 'store') {
  process.stdin.resume();
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('error', () => process.exit(0));
}
`,
    'utf8'
  );
  await chmod(secretToolPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}:${previousPath ?? ''}`;
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  });

  const configOptions = { configDir, credentialStore: 'auto' as const };
  await saveAccount({ name: 'work', kind: 'user', tokenCacheKey: 'work-cache' }, configOptions);

  const result = await discoverAccessibleEnvironments('work', configOptions, { allowInteractive: false });
  assert.equal(result.success, false);
  assert.doesNotMatch(JSON.stringify(result.diagnostics), /Unterminated string|position 8192/);
  assert.match(JSON.stringify(result.diagnostics), /Interactive authentication is disabled/);
});

test('Windows DPAPI credential store drops unreadable blobs', async (t) => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-win-dpapi-corrupt-'));
  const binDir = await mkdtemp(join(tmpdir(), 'pp-auth-fake-powershell-'));
  const fakePowerShell = `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', () => {
  process.stderr.write('Exception calling "Unprotect" with "3" argument(s): "The parameter is incorrect.\\r\\n"\\nFullyQualifiedErrorId : CryptographicException\\n');
  process.exit(1);
});
`;

  for (const command of ['pwsh', 'powershell.exe']) {
    const commandPath = join(binDir, command);
    await writeFile(commandPath, fakePowerShell, 'utf8');
    await chmod(commandPath, 0o755);
  }

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}:${previousPath ?? ''}`;
  const previousPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousPlatform) Object.defineProperty(process, 'platform', previousPlatform);
  });

  const credentialKey = 'msal:work-cache';
  const blobDir = join(getCredentialStoreDir({ configDir }), 'secure-cache', 'pp');
  const blobPath = join(blobDir, `${Buffer.from(credentialKey, 'utf8').toString('base64url')}.blob`);
  await mkdir(blobDir, { recursive: true });
  await writeFile(blobPath, Buffer.from('not a DPAPI blob', 'utf8').toString('base64'), 'utf8');

  const store = createWindowsDpapiCredentialStore({ configDir }, 'pp');

  assert.equal(await store.get(credentialKey), undefined);
  assert.equal(existsSync(blobPath), false);
});
