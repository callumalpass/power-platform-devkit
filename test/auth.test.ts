import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthService } from '../src/auth.js';
import { getMsalCacheDir, loadConfig, saveAccount } from '../src/config.js';

test('AuthService.removeAccount deletes MSAL caches for account cache keys', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-remove-'));
  const msalDir = getMsalCacheDir({ configDir });
  await mkdir(msalDir, { recursive: true });
  await saveAccount({ name: 'work', kind: 'user', tokenCacheKey: 'work-cache' }, { configDir });

  const removedCachePaths = [join(msalDir, 'work.json'), join(msalDir, 'work-canvas-authoring.json'), join(msalDir, 'work-cache.json'), join(msalDir, 'work-cache-canvas-authoring.json')];
  const retainedCachePath = join(msalDir, 'other.json');
  for (const path of [...removedCachePaths, retainedCachePath]) {
    await writeFile(path, '{}\n', 'utf8');
  }

  const removed = await new AuthService({ configDir }).removeAccount('work');
  assert.equal(removed.success, true);
  assert.equal(removed.data, true);

  for (const path of removedCachePaths) {
    assert.equal(existsSync(path), false, `${path} should be deleted`);
  }
  assert.equal(existsSync(retainedCachePath), true);

  const config = await loadConfig({ configDir });
  assert.equal(config.success, true);
  assert.equal(config.data?.accounts.work, undefined);
});
