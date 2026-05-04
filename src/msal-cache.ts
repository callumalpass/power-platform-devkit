import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node';
import { getCredentialStoreDir, getCredentialStoreMode, getMsalCacheDir, type ConfigStoreOptions, type CredentialStoreMode } from './config.js';
import { createOsCredentialStore, isCredentialStoreUnavailableError, type CredentialStore } from './credential-store.js';

const MSAL_CREDENTIAL_SERVICE = 'pp';
const MSAL_CREDENTIAL_PREFIX = 'msal:';
const CROSS_PROCESS_LOCK_RETRY_MS = 100;
const CROSS_PROCESS_LOCK_TIMEOUT_MS = 120_000;
const CROSS_PROCESS_LOCK_STALE_MS = 10 * 60_000;

const fallbackCacheLocks = new Map<string, Promise<void>>();

async function withFallbackCacheLock<T>(cacheKey: string, options: ConfigStoreOptions, fn: () => Promise<T>): Promise<T> {
  const release = await acquireFallbackCacheLock(cacheKey, options);
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function acquireFallbackCacheLock(cacheKey: string, options: ConfigStoreOptions): Promise<() => Promise<void>> {
  const scope = fallbackCacheLockScope(cacheKey, options);
  const releaseInProcess = await acquireInProcessFallbackCacheLock(scope);
  let releaseCrossProcess: (() => Promise<void>) | undefined;
  let released = false;
  try {
    releaseCrossProcess = await acquireCrossProcessFallbackCacheLock(fallbackCacheLockPath(cacheKey, options));
    return async () => {
      if (released) return;
      released = true;
      try {
        await releaseCrossProcess?.();
      } finally {
        releaseInProcess();
      }
    };
  } catch (error) {
    releaseInProcess();
    throw error;
  }
}

export async function createMsalCachePlugin(cacheKey: string, options: ConfigStoreOptions, accountName: string): Promise<ICachePlugin> {
  const mode = getCredentialStoreMode(options);
  if (mode === 'file') return createFileMsalCachePlugin(cacheKey, options, accountName);

  const securePlugin = await createSecureMsalCachePlugin(cacheKey, options, accountName, mode);
  return securePlugin ?? createFileMsalCachePlugin(cacheKey, options, accountName);
}

export async function deleteMsalCache(key: string, options: ConfigStoreOptions): Promise<void> {
  const mode = getCredentialStoreMode(options);

  await withFallbackCacheLock(key, options, async () => {
    if (mode !== 'file') {
      try {
        await deleteSecureCache(key, options);
      } catch (error) {
        if (!(mode === 'auto' && isCredentialStoreUnavailableError(error))) throw error;
      }
    }
    await deleteMsalFileCache(key, options);
  });
}

export function accountCredentialCacheKeys(account: { name?: string; tokenCacheKey?: string }): string[] {
  const baseKeys = new Set<string>();
  if (account.name) baseKeys.add(account.name);
  if (account.tokenCacheKey) baseKeys.add(account.tokenCacheKey);

  const keys = new Set<string>();
  for (const key of baseKeys) {
    keys.add(key);
    keys.add(`${key}-canvas-authoring`);
  }
  return [...keys];
}

function createFileMsalCachePlugin(cacheKey: string, options: ConfigStoreOptions, accountName: string): ICachePlugin {
  return createLockedFallbackCachePlugin(cacheKey, options, {
    beforeCacheAccess: async (context) => {
      const cache = await readMsalFileCache(cacheKey, options);
      if (cache) context.tokenCache.deserialize(cache);
    },
    afterCacheAccess: async (context) => {
      if (!context.cacheHasChanged) return;
      await writeMsalFileCache(cacheKey, context.tokenCache.serialize(), options, accountName);
    }
  });
}

async function createSecureMsalCachePlugin(cacheKey: string, options: ConfigStoreOptions, accountName: string, mode: Exclude<CredentialStoreMode, 'file'>): Promise<ICachePlugin | undefined> {
  const store = createOsCredentialStore(options, MSAL_CREDENTIAL_SERVICE);
  if (!store) {
    if (mode === 'auto') return undefined;
    throw new Error(`OS credential storage is not available on ${process.platform}.`);
  }

  return createLockedFallbackCachePlugin(cacheKey, options, {
    beforeCacheAccess: async (context) => {
      const secureCache = await readSecureCache(cacheKey, options, mode, store);
      if (secureCache) {
        context.tokenCache.deserialize(secureCache);
        return;
      }

      const fileCache = await readMsalFileCache(cacheKey, options);
      if (!fileCache) return;
      const storage = await writeVerifiedSecureCache(store, cacheKey, fileCache, options, accountName, mode);
      if (storage === 'secure') await deleteMsalFileCache(cacheKey, options);
      context.tokenCache.deserialize(fileCache);
    },
    afterCacheAccess: async (context) => {
      if (!context.cacheHasChanged) return;
      const storage = await writeVerifiedSecureCache(store, cacheKey, context.tokenCache.serialize(), options, accountName, mode);
      if (storage === 'secure') await deleteMsalFileCache(cacheKey, options);
    }
  });
}

function createLockedFallbackCachePlugin(cacheKey: string, options: ConfigStoreOptions, plugin: ICachePlugin): ICachePlugin {
  const releases = new WeakMap<TokenCacheContext, () => Promise<void>>();

  return {
    beforeCacheAccess: async (context) => {
      const release = await acquireFallbackCacheLock(cacheKey, options);
      releases.set(context, release);
      try {
        await plugin.beforeCacheAccess(context);
      } catch (error) {
        releases.delete(context);
        await release();
        throw error;
      }
    },
    afterCacheAccess: async (context) => {
      const release = releases.get(context);
      if (!release) {
        await withFallbackCacheLock(cacheKey, options, async () => {
          await plugin.afterCacheAccess(context);
        });
        return;
      }

      releases.delete(context);
      try {
        await plugin.afterCacheAccess(context);
      } finally {
        await release();
      }
    }
  };
}

async function readSecureCache(cacheKey: string, options: ConfigStoreOptions, mode: Exclude<CredentialStoreMode, 'file'>, existingStore?: CredentialStore): Promise<string | undefined> {
  const store = existingStore ?? createOsCredentialStore(options, MSAL_CREDENTIAL_SERVICE);
  if (!store) {
    if (mode === 'auto') return undefined;
    throw new Error(`OS credential storage is not available on ${process.platform}.`);
  }
  try {
    const cache = await store.get(msalCredentialKey(cacheKey));
    if (!cache) return undefined;
    if (isValidMsalCache(cache)) return cache;
    await store.delete(msalCredentialKey(cacheKey)).catch(() => undefined);
    return undefined;
  } catch (error) {
    if (mode === 'auto' && isCredentialStoreUnavailableError(error)) return undefined;
    throw error;
  }
}

async function writeVerifiedSecureCache(
  store: CredentialStore,
  cacheKey: string,
  value: string,
  options: ConfigStoreOptions,
  accountName: string,
  mode: Exclude<CredentialStoreMode, 'file'>
): Promise<'secure' | 'file'> {
  try {
    await store.set(msalCredentialKey(cacheKey), value);
    const written = await store.get(msalCredentialKey(cacheKey));
    if (written === value && isValidMsalCache(written)) return 'secure';
    await store.delete(msalCredentialKey(cacheKey)).catch(() => undefined);
    throw new Error('OS credential storage returned a corrupted or truncated MSAL cache after write.');
  } catch (error) {
    if (mode === 'auto' && isRecoverableSecureCacheWriteFailure(error)) {
      await writeMsalFileCache(cacheKey, value, options, accountName);
      return 'file';
    }
    throw error;
  }
}

async function deleteSecureCache(cacheKey: string, options: ConfigStoreOptions): Promise<void> {
  const store = createOsCredentialStore(options, MSAL_CREDENTIAL_SERVICE);
  if (store) await store.delete(msalCredentialKey(cacheKey));
}

function isRecoverableSecureCacheWriteFailure(error: unknown): boolean {
  return isCredentialStoreUnavailableError(error) || /corrupted or truncated MSAL cache after write/i.test(errorMessage(error));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${'errorCode' in error && typeof error.errorCode === 'string' ? ` ${error.errorCode}` : ''}`;
  }
  return String(error);
}

function isValidMsalCache(cache: string | undefined | null): cache is string {
  if (!cache) return false;
  try {
    JSON.parse(cache);
    return true;
  } catch {
    return false;
  }
}

async function readMsalFileCache(key: string, options: ConfigStoreOptions): Promise<string | undefined> {
  const cachePath = msalFileCachePath(key, options);
  try {
    const cache = await readFile(cachePath, 'utf8');
    if (!isValidMsalCache(cache)) {
      await quarantineCorruptCacheFile(cachePath);
      return undefined;
    }
    return cache;
  } catch {
    return undefined;
  }
}

async function writeMsalFileCache(key: string, value: string, options: ConfigStoreOptions, accountName: string): Promise<void> {
  const cachePath = msalFileCachePath(key, options);
  try {
    await mkdir(getMsalCacheDir(options), { recursive: true, mode: 0o700 });
    await writeFile(cachePath, value, { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') await chmod(cachePath, 0o600).catch(() => undefined);
  } catch (error) {
    await quarantineCorruptCacheFile(cachePath);
    throw new Error(`Failed to write MSAL cache for ${accountName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function deleteMsalFileCache(key: string, options: ConfigStoreOptions): Promise<void> {
  await rm(msalFileCachePath(key, options), { force: true });
}

function msalFileCachePath(key: string, options: ConfigStoreOptions): string {
  return join(getMsalCacheDir(options), `${key}.json`);
}

function msalCredentialKey(key: string): string {
  return `${MSAL_CREDENTIAL_PREFIX}${key}`;
}

function encodeKey(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url');
}

function fallbackCacheLockScope(cacheKey: string, options: ConfigStoreOptions): string {
  return [process.platform, getCredentialStoreDir(options), getMsalCacheDir(options), cacheKey].join('\0');
}

function fallbackCacheLockPath(cacheKey: string, options: ConfigStoreOptions): string {
  return join(getCredentialStoreDir(options), 'locks', `${encodeKey(fallbackCacheLockScope(cacheKey, options))}.lockfile`);
}

async function acquireInProcessFallbackCacheLock(scope: string): Promise<() => void> {
  const previous = fallbackCacheLocks.get(scope) ?? Promise.resolve();
  let releaseCurrent: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const next = previous.catch(() => undefined).then(() => current);
  fallbackCacheLocks.set(scope, next);
  await previous.catch(() => undefined);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseCurrent();
    if (fallbackCacheLocks.get(scope) === next) {
      fallbackCacheLocks.delete(scope);
    }
  };
}

async function acquireCrossProcessFallbackCacheLock(lockPath: string): Promise<() => Promise<void>> {
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  const started = Date.now();
  while (true) {
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
      } catch (error) {
        await handle.close().catch(() => undefined);
        await rm(lockPath, { force: true }).catch(() => undefined);
        throw error;
      }
      return async () => {
        await handle.close().catch(() => undefined);
        await rm(lockPath, { force: true }).catch(() => undefined);
      };
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code !== 'EEXIST') throw error;
      if (await removeStaleCrossProcessLock(lockPath)) continue;
      if (Date.now() - started >= CROSS_PROCESS_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for MSAL cache lock ${lockPath}.`);
      }
      await sleep(CROSS_PROCESS_LOCK_RETRY_MS);
    }
  }
}

async function removeStaleCrossProcessLock(lockPath: string): Promise<boolean> {
  try {
    const [contents, info] = await Promise.all([readFile(lockPath, 'utf8').catch(() => ''), stat(lockPath)]);
    const pid = Number(contents.split(/\r?\n/, 1)[0]);
    const staleByAge = Date.now() - info.mtimeMs > CROSS_PROCESS_LOCK_STALE_MS;
    const staleByPid = Number.isFinite(pid) && pid > 0 && !isProcessRunning(pid);
    if (!staleByAge && !staleByPid) return false;
    await rm(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function isProcessRunning(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    return code === 'EPERM';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function quarantineCorruptCacheFile(cachePath: string): Promise<void> {
  const suffix = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  try {
    await rename(cachePath, `${cachePath}.corrupt-${suffix}`);
  } catch {}
}
