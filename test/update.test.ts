import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatUpdateNotice,
  getCachedUpdateCheck,
  shouldRunBackgroundUpdateCheck,
  type UpdateCheckResult,
} from '../src/update.js';

function tempConfigDir() {
  return mkdtemp(join(tmpdir(), 'pp-update-test-'));
}

async function writeCachedUpdate(configDir: string, checkedAt: string) {
  const cached: UpdateCheckResult = {
    current: '0.1.0',
    latest: '0.2.0',
    updateAvailable: true,
    releaseUrl: 'https://github.com/callumalpass/power-platform-devkit/releases/tag/v0.2.0',
    checkedAt,
  };
  await writeFile(join(configDir, 'update-check.json'), JSON.stringify(cached), 'utf8');
  return cached;
}

test('getCachedUpdateCheck returns fresh cached release data', async () => {
  const configDir = await tempConfigDir();
  const cached = await writeCachedUpdate(configDir, new Date().toISOString());

  const result = await getCachedUpdateCheck(configDir);

  assert.deepEqual(result, cached);
});

test('getCachedUpdateCheck ignores stale release data', async () => {
  const configDir = await tempConfigDir();
  const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  await writeCachedUpdate(configDir, stale);

  const result = await getCachedUpdateCheck(configDir);

  assert.equal(result, null);
});

test('shouldRunBackgroundUpdateCheck only runs for notice-eligible commands without a fresh cache', () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
  Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true });
  const cached: UpdateCheckResult = {
    current: '0.1.0',
    latest: '0.1.0',
    updateAvailable: false,
    releaseUrl: '',
    checkedAt: new Date().toISOString(),
  };

  try {
    assert.equal(shouldRunBackgroundUpdateCheck('auth', null), true);
    assert.equal(shouldRunBackgroundUpdateCheck('auth', cached), false);
    assert.equal(shouldRunBackgroundUpdateCheck('update', null), false);
    assert.equal(shouldRunBackgroundUpdateCheck(undefined, null), false);
  } finally {
    if (descriptor) Object.defineProperty(process.stderr, 'isTTY', descriptor);
  }
});

test('formatUpdateNotice gives npm users an explicit update command', () => {
  const notice = formatUpdateNotice({
    current: '0.1.0',
    latest: '0.2.0',
    updateAvailable: true,
    releaseUrl: 'https://github.com/callumalpass/power-platform-devkit/releases/tag/v0.2.0',
    checkedAt: new Date().toISOString(),
  });

  assert.match(notice, /Update available: 0\.1\.0/);
  assert.match(notice, /npm install -g pp@latest/);
});
