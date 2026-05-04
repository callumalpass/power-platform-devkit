import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getMsalCacheDir } from '../src/config.js';
import { createMsalCachePlugin, setMsalExtensionsLoaderForTest } from '../src/msal-cache.js';

class FakePersistence {
  value: string | null = null;
  deleted = 0;
  afterAccesses = 0;
  loadResponses: Array<string | null | Error> = [];
  corruptLoadsAfterSave = false;

  async save(contents: string): Promise<void> {
    this.value = contents;
  }

  async load(): Promise<string | null> {
    const response = this.loadResponses.length ? this.loadResponses.shift() : this.value;
    if (response instanceof Error) throw response;
    if (this.corruptLoadsAfterSave && this.value !== null) return '{"Account":';
    return response ?? null;
  }

  async delete(): Promise<boolean> {
    this.deleted += 1;
    this.value = null;
    return true;
  }

  async reloadNecessary(): Promise<boolean> {
    return true;
  }

  getFilePath(): string {
    return 'fake-msal-cache';
  }

  async verifyPersistence(): Promise<boolean> {
    return true;
  }

  async createForPersistenceValidation(): Promise<FakePersistence> {
    return new FakePersistence();
  }
}

class FakePersistenceCachePlugin {
  constructor(private readonly persistence: FakePersistence) {}

  async beforeCacheAccess(context: FakeTokenCacheContext): Promise<void> {
    const cache = await this.persistence.load();
    if (cache) context.tokenCache.deserialize(cache);
  }

  async afterCacheAccess(context: FakeTokenCacheContext): Promise<void> {
    this.persistence.afterAccesses += 1;
    if (context.cacheHasChanged) await this.persistence.save(context.tokenCache.serialize());
  }
}

type FakeTokenCacheContext = {
  cacheHasChanged: boolean;
  tokenCache: {
    serialize(): string;
    deserialize(value: string): void;
  };
};

function installFakeExtensions(persistence: FakePersistence): void {
  setMsalExtensionsLoaderForTest(async () => ({
    DataProtectionScope: { CurrentUser: 'CurrentUser' },
    PersistenceCreator: {
      createPersistence: async () => persistence
    },
    PersistenceCachePlugin: FakePersistenceCachePlugin as never
  }));
}

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

test('MSAL extension cache behavior', async (t) => {
  t.after(() => setMsalExtensionsLoaderForTest());

  await t.test('serializes fallback file cache access for the same cache key', async () => {
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

  await t.test('migrates existing file cache before deleting it', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-msal-cache-migrate-'));
    const cacheKey = `work-cache-migrate-${Date.now()}`;
    const fileCache = '{"Account":{"id":"cached"}}';
    const fileCachePath = join(getMsalCacheDir({ configDir }), `${cacheKey}.json`);
    await mkdir(getMsalCacheDir({ configDir }), { recursive: true });
    await writeFile(fileCachePath, fileCache, 'utf8');

    const persistence = new FakePersistence();
    installFakeExtensions(persistence);

    const plugin = await createMsalCachePlugin(cacheKey, { configDir, credentialStore: 'auto' }, 'work');
    assert.equal(persistence.value, fileCache);
    assert.equal(existsSync(fileCachePath), false);

    const context = cacheContext('{}');
    await plugin.beforeCacheAccess(context as never);
    assert.equal(context.deserialized, fileCache);
  });

  await t.test('falls back to file mode when extension loading is unavailable in auto mode', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-msal-cache-file-fallback-'));
    const cacheKey = `work-cache-fallback-${Date.now()}`;
    const fileCache = '{"Account":{"id":"file"}}';
    const fileCachePath = join(getMsalCacheDir({ configDir }), `${cacheKey}.json`);
    await mkdir(getMsalCacheDir({ configDir }), { recursive: true });
    await writeFile(fileCachePath, fileCache, 'utf8');

    setMsalExtensionsLoaderForTest(async () => {
      throw Object.assign(new Error("Cannot find module '../build/Release/keytar.node'"), { code: 'MODULE_NOT_FOUND' });
    });

    const plugin = await createMsalCachePlugin(cacheKey, { configDir, credentialStore: 'auto' }, 'work');
    const context = cacheContext('{}');
    await plugin.beforeCacheAccess(context as never);
    assert.equal(context.deserialized, fileCache);
    setMsalExtensionsLoaderForTest();
  });

  await t.test('does not re-read persistence after the official after hook writes cache', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-msal-cache-write-no-reread-'));
    const cacheKey = `work-cache-write-${Date.now()}`;
    const nextCache = '{"Account":{"id":"next"}}';
    const persistence = new FakePersistence();
    persistence.loadResponses.push(null);
    installFakeExtensions(persistence);

    const plugin = await createMsalCachePlugin(cacheKey, { configDir, credentialStore: 'auto' }, 'work');
    persistence.corruptLoadsAfterSave = true;
    await plugin.afterCacheAccess(cacheContext(nextCache, true) as never);

    const fileCachePath = join(getMsalCacheDir({ configDir }), `${cacheKey}.json`);
    assert.equal(existsSync(fileCachePath), false);
    assert.equal(persistence.value, nextCache);
    assert.equal(persistence.deleted, 0);
  });

  await t.test('keeps the file cache when migration falls back after failed persistence verification', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-msal-cache-migrate-fallback-'));
    const cacheKey = `work-cache-migrate-fallback-${Date.now()}`;
    const fileCache = '{"Account":{"id":"migrated-file"}}';
    const fileCachePath = join(getMsalCacheDir({ configDir }), `${cacheKey}.json`);
    await mkdir(getMsalCacheDir({ configDir }), { recursive: true });
    await writeFile(fileCachePath, fileCache, 'utf8');

    const persistence = new FakePersistence();
    persistence.corruptLoadsAfterSave = true;
    installFakeExtensions(persistence);

    await createMsalCachePlugin(cacheKey, { configDir, credentialStore: 'auto' }, 'work');

    assert.equal(existsSync(fileCachePath), true);
    assert.equal(await readFile(fileCachePath, 'utf8'), fileCache);
    assert.equal(persistence.deleted > 0, true);
  });

  await t.test('runs the official after hook after dropping unreadable persistence', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-msal-cache-unreadable-'));
    const cacheKey = `work-cache-unreadable-${Date.now()}`;
    const nextCache = '{"Account":{"id":"recovered"}}';
    const persistence = new FakePersistence();
    installFakeExtensions(persistence);

    const plugin = await createMsalCachePlugin(cacheKey, { configDir, credentialStore: 'auto' }, 'work');
    persistence.loadResponses.push(new Error('EncryptedFileError: The parameter is incorrect'), new Error('EncryptedFileError: The parameter is incorrect'));
    const context = cacheContext(nextCache, true);

    await plugin.beforeCacheAccess(context as never);
    await plugin.afterCacheAccess(context as never);

    assert.equal(persistence.afterAccesses, 1);
    assert.equal(persistence.value, nextCache);
    assert.equal(persistence.deleted > 0, true);
  });
});
