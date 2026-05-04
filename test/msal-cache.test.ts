import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getMsalCacheDir } from '../src/config.js';
import { CredentialStoreUnavailableError, setCredentialStoreFactoryForTest, type CredentialStore } from '../src/credential-store.js';
import { createMsalCachePlugin } from '../src/msal-cache.js';

class FakeCredentialStore implements CredentialStore {
  readonly kind = 'os' as const;
  readonly values = new Map<string, string>();
  readonly deleted: string[] = [];
  unavailable = false;
  corruptReads = false;

  async get(key: string): Promise<string | undefined> {
    if (this.unavailable) throw new CredentialStoreUnavailableError('fake store unavailable');
    const value = this.values.get(key);
    if (this.corruptReads && value !== undefined) return '{"Account":';
    return value;
  }

  async set(key: string, value: string): Promise<void> {
    if (this.unavailable) throw new CredentialStoreUnavailableError('fake store unavailable');
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.values.delete(key);
  }
}

type FakeTokenCacheContext = {
  cacheHasChanged: boolean;
  tokenCache: {
    serialize(): string;
    deserialize(value: string): void;
  };
};

function cacheContext(value: string, cacheHasChanged = false): FakeTokenCacheContext & { deserialized?: string } {
  const context: FakeTokenCacheContext & { deserialized?: string } = {
    cacheHasChanged,
    tokenCache: {
      serialize: () => value,
      deserialize: (cache) => {
        context.deserialized = cache;
      }
    }
  };
  return context;
}

test('MSAL cache behavior', async (t) => {
  t.after(() => setCredentialStoreFactoryForTest());

  await t.test('serializes fallback file cache access for the same cache key', async () => {
    setCredentialStoreFactoryForTest();
    const configDir = await mkdtemp(join(tmpdir(), 'pp-msal-cache-lock-'));
    const cacheKey = `work-cache-lock-${Date.now()}`;
    const firstCache = '{"Account":{"id":"first"}}';
    const plugin1 = await createMsalCachePlugin(cacheKey, { configDir, credentialStore: 'file' }, 'work');
    const plugin2 = await createMsalCachePlugin(cacheKey, { configDir, credentialStore: 'file' }, 'work');
    const events: string[] = [];
    const firstContext = cacheContext(firstCache, true);
    let secondDeserialized: string | undefined;

    await plugin1.beforeCacheAccess(firstContext as never);
    events.push('first:before');

    const second = (async () => {
      const secondContext = cacheContext('{}');
      await plugin2.beforeCacheAccess(secondContext as never);
      events.push('second:before');
      secondDeserialized = secondContext.deserialized;
      await plugin2.afterCacheAccess(secondContext as never);
    })();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(events, ['first:before']);

    events.push('first:release');
    await plugin1.afterCacheAccess(firstContext as never);
    await second;
    assert.deepEqual(events, ['first:before', 'first:release', 'second:before']);
    assert.equal(secondDeserialized, firstCache);
  });

  await t.test('migrates existing file cache to the OS credential store before deleting it', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-msal-cache-migrate-'));
    const cacheKey = `work-cache-migrate-${Date.now()}`;
    const fileCache = '{"Account":{"id":"cached"}}';
    const fileCachePath = join(getMsalCacheDir({ configDir }), `${cacheKey}.json`);
    const store = new FakeCredentialStore();
    setCredentialStoreFactoryForTest(() => store);
    await mkdir(getMsalCacheDir({ configDir }), { recursive: true });
    await writeFile(fileCachePath, fileCache, 'utf8');

    const plugin = await createMsalCachePlugin(cacheKey, { configDir, credentialStore: 'auto' }, 'work');
    const context = cacheContext('{}');
    await plugin.beforeCacheAccess(context as never);

    assert.equal(store.values.get(`msal:${cacheKey}`), fileCache);
    assert.equal(existsSync(fileCachePath), false);
    assert.equal(context.deserialized, fileCache);
  });

  await t.test('falls back to file mode when the OS credential store is unavailable in auto mode', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-msal-cache-file-fallback-'));
    const cacheKey = `work-cache-fallback-${Date.now()}`;
    const fileCache = '{"Account":{"id":"file"}}';
    const fileCachePath = join(getMsalCacheDir({ configDir }), `${cacheKey}.json`);
    setCredentialStoreFactoryForTest(() => undefined);
    await mkdir(getMsalCacheDir({ configDir }), { recursive: true });
    await writeFile(fileCachePath, fileCache, 'utf8');

    const plugin = await createMsalCachePlugin(cacheKey, { configDir, credentialStore: 'auto' }, 'work');
    const context = cacheContext('{}');
    await plugin.beforeCacheAccess(context as never);
    assert.equal(context.deserialized, fileCache);
  });

  await t.test('keeps the file cache when secure-store verification fails in auto mode', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-msal-cache-migrate-fallback-'));
    const cacheKey = `work-cache-migrate-fallback-${Date.now()}`;
    const fileCache = '{"Account":{"id":"migrated-file"}}';
    const fileCachePath = join(getMsalCacheDir({ configDir }), `${cacheKey}.json`);
    const store = new FakeCredentialStore();
    store.corruptReads = true;
    setCredentialStoreFactoryForTest(() => store);
    await mkdir(getMsalCacheDir({ configDir }), { recursive: true });
    await writeFile(fileCachePath, fileCache, 'utf8');

    const plugin = await createMsalCachePlugin(cacheKey, { configDir, credentialStore: 'auto' }, 'work');
    const context = cacheContext('{}');
    await plugin.beforeCacheAccess(context as never);

    assert.equal(existsSync(fileCachePath), true);
    assert.equal(await readFile(fileCachePath, 'utf8'), fileCache);
    assert.equal(context.deserialized, fileCache);
  });

  await t.test('reads and writes the OS credential store when it is available', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-msal-cache-secure-'));
    const cacheKey = `work-cache-secure-${Date.now()}`;
    const existingCache = '{"Account":{"id":"secure"}}';
    const nextCache = '{"Account":{"id":"next"}}';
    const store = new FakeCredentialStore();
    store.values.set(`msal:${cacheKey}`, existingCache);
    setCredentialStoreFactoryForTest(() => store);

    const plugin = await createMsalCachePlugin(cacheKey, { configDir, credentialStore: 'os' }, 'work');
    const context = cacheContext(nextCache, true);
    await plugin.beforeCacheAccess(context as never);
    await plugin.afterCacheAccess(context as never);

    assert.equal(context.deserialized, existingCache);
    assert.equal(store.values.get(`msal:${cacheKey}`), nextCache);
  });
});
