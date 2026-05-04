import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node';
import { getCredentialStoreDir, getCredentialStoreMode, getMsalCacheDir, type ConfigStoreOptions, type CredentialStoreMode } from './config.js';
import { createOsCredentialStore, isCredentialStoreUnavailableError, type CredentialStore } from './credential-store.js';

const MSAL_CREDENTIAL_SERVICE = 'pp';
const MSAL_CREDENTIAL_PREFIX = 'msal:';
const AUTO_EXTENSION_UNAVAILABLE_RETRY_MS = 30_000;
const CROSS_PROCESS_LOCK_RETRY_MS = 100;
const CROSS_PROCESS_LOCK_TIMEOUT_MS = 120_000;
const CROSS_PROCESS_LOCK_STALE_MS = 10 * 60_000;

const autoExtensionUnavailableUntil = new Map<string, number>();
const fallbackCacheLocks = new Map<string, Promise<void>>();

type MsalPersistence = {
  save(contents: string): Promise<void>;
  load(): Promise<string | null>;
  delete(): Promise<boolean>;
  reloadNecessary(lastSync: number): Promise<boolean>;
  getFilePath(): string;
  verifyPersistence(): Promise<boolean>;
  createForPersistenceValidation(): Promise<MsalPersistence>;
};

type MsalExtensionsModule = {
  DataProtectionScope: { CurrentUser: string };
  PersistenceCreator: {
    createPersistence(config: Record<string, unknown>): Promise<MsalPersistence>;
  };
  PersistenceCachePlugin: new (persistence: MsalPersistence) => ICachePlugin;
};

type MsalExtensionsLoader = () => Promise<MsalExtensionsModule>;

let msalExtensionsLoader: MsalExtensionsLoader = async () => (await import('@azure/msal-node-extensions')) as unknown as MsalExtensionsModule;

export function setMsalExtensionsLoaderForTest(loader?: MsalExtensionsLoader): void {
  msalExtensionsLoader = loader ?? (async () => (await import('@azure/msal-node-extensions')) as unknown as MsalExtensionsModule);
}

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
  if (process.platform === 'win32') {
    const legacyPlugin = await createLegacySecureMsalCachePlugin(cacheKey, options, accountName, mode);
    if (legacyPlugin) return legacyPlugin;
    return createFileMsalCachePlugin(cacheKey, options, accountName);
  }
  if (mode === 'auto' && isAutoExtensionRecentlyUnavailable(options)) {
    return (await createLegacySecureMsalCachePlugin(cacheKey, options, accountName, mode)) ?? createFileMsalCachePlugin(cacheKey, options, accountName);
  }

  try {
    return await createExtensionMsalCachePlugin(cacheKey, options, accountName, mode);
  } catch (error) {
    if (mode === 'auto' && isCredentialPersistenceUnavailable(error)) {
      markAutoExtensionUnavailable(options);
      return (await createLegacySecureMsalCachePlugin(cacheKey, options, accountName, mode)) ?? createFileMsalCachePlugin(cacheKey, options, accountName);
    }
    if (mode === 'os' && isCredentialPersistenceUnavailable(error)) {
      const legacyPlugin = await createLegacySecureMsalCachePlugin(cacheKey, options, accountName, mode);
      if (legacyPlugin) return legacyPlugin;
    }
    throw error;
  }
}

export async function deleteMsalCache(key: string, options: ConfigStoreOptions): Promise<void> {
  const mode = getCredentialStoreMode(options);
  if (mode !== 'file' && process.platform !== 'win32') {
    try {
      const persistence = await createExtensionPersistence(key, options);
      await persistence.delete();
    } catch (error) {
      if (!(mode === 'auto' && isCredentialPersistenceUnavailable(error))) throw error;
    }
  }

  await withFallbackCacheLock(key, options, async () => {
    if (mode !== 'file') {
      try {
        await deleteLegacySecureCache(key, options);
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

async function createExtensionMsalCachePlugin(cacheKey: string, options: ConfigStoreOptions, accountName: string, mode: Exclude<CredentialStoreMode, 'file'>): Promise<ICachePlugin> {
  const extensions = await msalExtensionsLoader();
  const persistence = await createExtensionPersistence(cacheKey, options, extensions);
  await migrateLegacyCachesToPersistence(persistence, cacheKey, options, accountName, mode);
  return new VerifiedPersistenceCachePlugin(new extensions.PersistenceCachePlugin(persistence), persistence, cacheKey, options, accountName, mode);
}

async function createExtensionPersistence(cacheKey: string, options: ConfigStoreOptions, extensions?: MsalExtensionsModule): Promise<MsalPersistence> {
  const resolvedExtensions = extensions ?? (await msalExtensionsLoader());
  return resolvedExtensions.PersistenceCreator.createPersistence({
    cachePath: msalExtensionCachePath(cacheKey, options),
    dataProtectionScope: resolvedExtensions.DataProtectionScope.CurrentUser,
    serviceName: MSAL_CREDENTIAL_SERVICE,
    accountName: msalCredentialKey(cacheKey),
    usePlaintextFileOnLinux: false
  });
}

class VerifiedPersistenceCachePlugin implements ICachePlugin {
  private skipNextOfficialAfter = false;

  constructor(
    private readonly plugin: ICachePlugin,
    private readonly persistence: MsalPersistence,
    private readonly cacheKey: string,
    private readonly options: ConfigStoreOptions,
    private readonly accountName: string,
    private readonly mode: Exclude<CredentialStoreMode, 'file'>
  ) {}

  async beforeCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    try {
      await this.plugin.beforeCacheAccess(cacheContext);
    } catch (error) {
      if (!isUnreadablePersistenceCache(error)) throw error;
      try {
        await this.plugin.beforeCacheAccess(cacheContext);
        return;
      } catch (retryError) {
        if (!isUnreadablePersistenceCache(retryError)) throw retryError;
      }
      await this.persistence.delete().catch(() => false);
      this.skipNextOfficialAfter = true;
    }
  }

  async afterCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    if (this.skipNextOfficialAfter) {
      this.skipNextOfficialAfter = false;
      await this.afterOfficialCacheAccess(cacheContext);
      return;
    }

    await this.afterOfficialCacheAccess(cacheContext);
  }

  private async afterOfficialCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    try {
      await this.plugin.afterCacheAccess(cacheContext);
    } catch (error) {
      const serialized = cacheContext.cacheHasChanged ? cacheContext.tokenCache.serialize() : undefined;
      if (this.mode === 'auto' && isRecoverablePersistenceWriteFailure(error) && serialized !== undefined) {
        await withFallbackCacheLock(this.cacheKey, this.options, async () => {
          await writeMsalFileCache(this.cacheKey, serialized, this.options, this.accountName);
        });
        return;
      }
      throw error;
    }
  }
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

async function createLegacySecureMsalCachePlugin(cacheKey: string, options: ConfigStoreOptions, accountName: string, mode: Exclude<CredentialStoreMode, 'file'>): Promise<ICachePlugin | undefined> {
  const store = createOsCredentialStore(options, MSAL_CREDENTIAL_SERVICE);
  if (!store) {
    if (mode === 'auto') return undefined;
    throw new Error(`OS credential storage is not available on ${process.platform}.`);
  }

  return createLockedFallbackCachePlugin(cacheKey, options, {
    beforeCacheAccess: async (context) => {
      const secureCache = await readLegacySecureCache(cacheKey, options, mode, store);
      if (secureCache) {
        context.tokenCache.deserialize(secureCache);
        return;
      }

      const fileCache = await readMsalFileCache(cacheKey, options);
      if (!fileCache) return;
      const storage = await writeVerifiedLegacySecureCache(store, cacheKey, fileCache, options, accountName, mode);
      if (storage === 'secure') await deleteMsalFileCache(cacheKey, options);
      context.tokenCache.deserialize(fileCache);
    },
    afterCacheAccess: async (context) => {
      if (!context.cacheHasChanged) return;
      const storage = await writeVerifiedLegacySecureCache(store, cacheKey, context.tokenCache.serialize(), options, accountName, mode);
      if (storage === 'secure') await deleteMsalFileCache(cacheKey, options);
    }
  });
}

async function migrateLegacyCachesToPersistence(
  persistence: MsalPersistence,
  cacheKey: string,
  options: ConfigStoreOptions,
  accountName: string,
  mode: Exclude<CredentialStoreMode, 'file'>
): Promise<void> {
  await withFallbackCacheLock(cacheKey, options, async () => {
    const existing = await readValidPersistenceCache(persistence, mode);
    if (existing) return;

    const fileCache = await readMsalFileCache(cacheKey, options);
    const legacySecureCache = fileCache ? undefined : await readLegacySecureCache(cacheKey, options, mode);
    const source = fileCache ?? legacySecureCache;
    if (!source) return;

    const storage = await saveVerifiedPersistenceCache(persistence, source, cacheKey, options, accountName, mode);
    if (storage !== 'persistence') return;
    await deleteMsalFileCache(cacheKey, options);
    await deleteLegacySecureCache(cacheKey, options).catch(() => undefined);
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

async function readValidPersistenceCache(persistence: MsalPersistence, mode: Exclude<CredentialStoreMode, 'file'>): Promise<string | undefined> {
  try {
    const cache = await persistence.load();
    if (!cache) return undefined;
    if (isValidMsalCache(cache)) return cache;
    await persistence.delete().catch(() => false);
    return undefined;
  } catch (error) {
    if (isUnreadablePersistenceCache(error)) {
      await persistence.delete().catch(() => false);
      return undefined;
    }
    if (mode === 'auto' && isCredentialPersistenceUnavailable(error)) return undefined;
    throw error;
  }
}

async function saveVerifiedPersistenceCache(
  persistence: MsalPersistence,
  value: string,
  cacheKey: string,
  options: ConfigStoreOptions,
  accountName: string,
  mode: Exclude<CredentialStoreMode, 'file'>
): Promise<'persistence' | 'file'> {
  try {
    await persistence.save(value);
    await verifyPersistenceCache(persistence, value);
    return 'persistence';
  } catch (error) {
    await persistence.delete().catch(() => false);
    if (mode === 'auto' && isRecoverablePersistenceWriteFailure(error)) {
      await writeMsalFileCache(cacheKey, value, options, accountName);
      return 'file';
    }
    throw error;
  }
}

async function verifyPersistenceCache(persistence: MsalPersistence, expected: string): Promise<void> {
  const written = await persistence.load();
  if (written === expected && isValidMsalCache(written)) return;
  await persistence.delete().catch(() => false);
  throw new Error('OS credential storage returned a corrupted or truncated MSAL cache after write.');
}

async function readLegacySecureCache(cacheKey: string, options: ConfigStoreOptions, mode: Exclude<CredentialStoreMode, 'file'>, existingStore?: CredentialStore): Promise<string | undefined> {
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

async function writeVerifiedLegacySecureCache(
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
    if (mode === 'auto' && (isCredentialStoreUnavailableError(error) || isRecoverablePersistenceWriteFailure(error))) {
      await writeMsalFileCache(cacheKey, value, options, accountName);
      return 'file';
    }
    throw error;
  }
}

async function deleteLegacySecureCache(cacheKey: string, options: ConfigStoreOptions): Promise<void> {
  const store = createOsCredentialStore(options, MSAL_CREDENTIAL_SERVICE);
  if (store) await store.delete(msalCredentialKey(cacheKey));
}

function isCredentialPersistenceUnavailable(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    isCredentialStoreUnavailableError(error) ||
    /Cannot find module|MODULE_NOT_FOUND|bindings unavailable|not supported on this platform|Persistence could not be verified|Persistence check failed|LibSecret|Secret Service|D-Bus|keychain|ENOENT/i.test(
      message
    )
  );
}

function isUnreadablePersistenceCache(error: unknown): boolean {
  return /FilePersistenceWithDataProtection|EncryptedFileError|Encryption\/Decryption failed|Unprotect|decrypt|The parameter is incorrect|Key not valid for use in specified state|Unexpected token|Unterminated string|not valid JSON/i.test(
    errorMessage(error)
  );
}

function isRecoverablePersistenceWriteFailure(error: unknown): boolean {
  return isCredentialPersistenceUnavailable(error) || /corrupted or truncated MSAL cache after write/i.test(errorMessage(error));
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

function msalExtensionCachePath(key: string, options: ConfigStoreOptions): string {
  return join(getCredentialStoreDir(options), 'msal-node-extensions', `${encodeKey(key)}.cache`);
}

function msalCredentialKey(key: string): string {
  return `${MSAL_CREDENTIAL_PREFIX}${key}`;
}

function encodeKey(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url');
}

function isAutoExtensionRecentlyUnavailable(options: ConfigStoreOptions): boolean {
  return (autoExtensionUnavailableUntil.get(autoExtensionScope(options)) ?? 0) > Date.now();
}

function markAutoExtensionUnavailable(options: ConfigStoreOptions): void {
  autoExtensionUnavailableUntil.set(autoExtensionScope(options), Date.now() + AUTO_EXTENSION_UNAVAILABLE_RETRY_MS);
}

function autoExtensionScope(options: ConfigStoreOptions): string {
  return `${process.platform}:${getCredentialStoreDir(options)}`;
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
