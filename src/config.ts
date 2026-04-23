import { access, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, win32 as win32Path } from 'node:path';
import { z } from 'zod';
import YAML from 'yaml';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';

export type AccountKind = 'user' | 'device-code' | 'client-secret' | 'environment-token' | 'static-token';
export type EnvironmentAccessMode = 'read-write' | 'read-only';

export interface AccountBase {
  name: string;
  description?: string;
  tenantId?: string;
  clientId?: string;
  scopes?: string[];
  tokenCacheKey?: string;
  loginHint?: string;
  accountUsername?: string;
  homeAccountId?: string;
  localAccountId?: string;
}

export type Account =
  | (AccountBase & { kind: 'static-token'; token: string })
  | (AccountBase & { kind: 'environment-token'; environmentVariable: string })
  | (AccountBase & { kind: 'client-secret'; tenantId: string; clientId: string; clientSecretEnv: string })
  | (AccountBase & {
      kind: 'user';
      prompt?: 'select_account' | 'login' | 'consent' | 'none';
      fallbackToDeviceCode?: boolean;
    })
  | (AccountBase & { kind: 'device-code' });

export interface Environment {
  alias: string;
  account: string;
  url: string;
  displayName?: string;
  makerEnvironmentId: string;
  tenantId: string;
  access?: { mode: EnvironmentAccessMode };
}

export interface BrowserProfile {
  account: string;
  kind: 'playwright-chromium';
  userDataDir: string;
  createdAt?: string;
  lastOpenedAt?: string;
  lastVerifiedAt?: string;
  lastVerificationUrl?: string;
}

export interface GlobalConfig {
  accounts: Record<string, Account>;
  environments: Record<string, Environment>;
  browserProfiles: Record<string, BrowserProfile>;
}

const accountBaseSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  tenantId: z.string().optional(),
  clientId: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  tokenCacheKey: z.string().optional(),
  loginHint: z.string().optional(),
  accountUsername: z.string().optional(),
  homeAccountId: z.string().optional(),
  localAccountId: z.string().optional(),
});

const accountSchema = z.discriminatedUnion('kind', [
  accountBaseSchema.extend({
    kind: z.literal('static-token'),
    token: z.string(),
  }),
  accountBaseSchema.extend({
    kind: z.literal('environment-token'),
    environmentVariable: z.string(),
  }),
  accountBaseSchema.extend({
    kind: z.literal('client-secret'),
    tenantId: z.string(),
    clientId: z.string(),
    clientSecretEnv: z.string(),
  }),
  accountBaseSchema.extend({
    kind: z.literal('user'),
    prompt: z.enum(['select_account', 'login', 'consent', 'none']).optional(),
    fallbackToDeviceCode: z.boolean().optional(),
  }),
  accountBaseSchema.extend({
    kind: z.literal('device-code'),
  }),
]);

const environmentSchema = z.object({
  alias: z.string(),
  account: z.string(),
  url: z.string().url(),
  displayName: z.string().optional(),
  makerEnvironmentId: z.string(),
  tenantId: z.string(),
  access: z.object({ mode: z.enum(['read-write', 'read-only']).default('read-write') }).optional(),
});

const browserProfileSchema = z.object({
  account: z.string(),
  kind: z.literal('playwright-chromium').default('playwright-chromium'),
  userDataDir: z.string(),
  createdAt: z.string().optional(),
  lastOpenedAt: z.string().optional(),
  lastVerifiedAt: z.string().optional(),
  lastVerificationUrl: z.string().optional(),
});

const globalConfigSchema = z.object({
  accounts: z.record(z.string(), accountSchema).default({}),
  environments: z.record(z.string(), environmentSchema).default({}),
  browserProfiles: z.record(z.string(), browserProfileSchema).default({}),
});

export interface ConfigStoreOptions {
  configDir?: string;
}

const configWriteQueue = new Map<string, Promise<void>>();

export function getDefaultConfigDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  if (platform === 'win32') {
    return win32Path.resolve(
      env.APPDATA ? win32Path.join(env.APPDATA, 'pp') : win32Path.join(homeDirectory, 'AppData', 'Roaming', 'pp'),
    );
  }
  if (env.XDG_CONFIG_HOME) {
    return resolve(join(env.XDG_CONFIG_HOME, 'pp'));
  }
  return resolve(join(homeDirectory, '.config', 'pp'));
}

export function getConfigDir(options: ConfigStoreOptions = {}): string {
  return resolve(options.configDir ?? getDefaultConfigDir());
}

export function getConfigPath(options: ConfigStoreOptions = {}): string {
  return join(getConfigDir(options), 'config.json');
}

export function getMsalCacheDir(options: ConfigStoreOptions = {}): string {
  return join(getConfigDir(options), 'msal');
}

export function getSavedRequestsPath(options: ConfigStoreOptions = {}): string {
  return join(getConfigDir(options), 'saved-requests.json');
}

export function getCanvasSessionsPath(options: ConfigStoreOptions = {}): string {
  return join(getConfigDir(options), 'canvas-sessions.json');
}

export function getBrowserProfilesRoot(options: ConfigStoreOptions = {}): string {
  return join(getConfigDir(options), 'browser-profiles');
}

export async function loadConfig(options: ConfigStoreOptions = {}): Promise<OperationResult<GlobalConfig>> {
  const path = getConfigPath(options);
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = path.endsWith('.json') ? JSON.parse(raw) : YAML.parse(raw);
    return ok(globalConfigSchema.parse(parsed));
  } catch (error) {
    if (await exists(path)) {
      return fail(
        createDiagnostic('error', 'CONFIG_READ_FAILED', `Failed to load config from ${path}.`, {
          source: 'pp/config',
          detail: error instanceof Error ? error.message : String(error),
          path,
        }),
      );
    }
    return ok(globalConfigSchema.parse({}));
  }
}

export async function writeConfig(config: GlobalConfig, options: ConfigStoreOptions = {}): Promise<OperationResult<GlobalConfig>> {
  const path = getConfigPath(options);
  try {
    const normalized = globalConfigSchema.parse(config);
    await enqueueConfigWrite(path, async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tempPath, JSON.stringify(normalized, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
      if (process.platform !== 'win32') await chmod(tempPath, 0o600).catch(() => undefined);
      await rename(tempPath, path);
    });
    return ok(normalized);
  } catch (error) {
    return fail(
      createDiagnostic('error', 'CONFIG_WRITE_FAILED', `Failed to write config ${path}.`, {
        source: 'pp/config',
        detail: error instanceof Error ? error.message : String(error),
        path,
      }),
    );
  }
}

export async function listAccounts(options: ConfigStoreOptions = {}): Promise<OperationResult<Account[]>> {
  const result = await loadConfig(options);
  if (!result.success || !result.data) return fail(...result.diagnostics);
  return ok(Object.values(result.data.accounts), result.diagnostics);
}

export async function getAccount(name: string, options: ConfigStoreOptions = {}): Promise<OperationResult<Account | undefined>> {
  const result = await loadConfig(options);
  if (!result.success || !result.data) return fail(...result.diagnostics);
  return ok(result.data.accounts[name], result.diagnostics);
}

export async function saveAccount(account: Account, options: ConfigStoreOptions = {}): Promise<OperationResult<Account>> {
  const loaded = await loadConfig(options);
  if (!loaded.success || !loaded.data) return fail(...loaded.diagnostics);
  loaded.data.accounts[account.name] = account;
  const written = await writeConfig(loaded.data, options);
  return written.success ? ok(account, written.diagnostics) : fail(...written.diagnostics);
}

export async function removeAccount(name: string, options: ConfigStoreOptions = {}): Promise<OperationResult<boolean>> {
  const loaded = await loadConfig(options);
  if (!loaded.success || !loaded.data) return fail(...loaded.diagnostics);
  const existed = Boolean(loaded.data.accounts[name]);
  delete loaded.data.accounts[name];
  for (const [alias, environment] of Object.entries(loaded.data.environments)) {
    if (environment.account === name) {
      delete loaded.data.environments[alias];
    }
  }
  delete loaded.data.browserProfiles[name];
  const written = await writeConfig(loaded.data, options);
  return written.success ? ok(existed, written.diagnostics) : fail(...written.diagnostics);
}

export async function listEnvironments(options: ConfigStoreOptions = {}): Promise<OperationResult<Environment[]>> {
  const result = await loadConfig(options);
  if (!result.success || !result.data) return fail(...result.diagnostics);
  return ok(Object.values(result.data.environments), result.diagnostics);
}

export async function getEnvironment(alias: string, options: ConfigStoreOptions = {}): Promise<OperationResult<Environment | undefined>> {
  const result = await loadConfig(options);
  if (!result.success || !result.data) return fail(...result.diagnostics);
  return ok(result.data.environments[alias], result.diagnostics);
}

export async function saveEnvironment(environment: Environment, options: ConfigStoreOptions = {}): Promise<OperationResult<Environment>> {
  const loaded = await loadConfig(options);
  if (!loaded.success || !loaded.data) return fail(...loaded.diagnostics);
  loaded.data.environments[environment.alias] = environment;
  const written = await writeConfig(loaded.data, options);
  return written.success ? ok(environment, written.diagnostics) : fail(...written.diagnostics);
}

export async function removeEnvironment(alias: string, options: ConfigStoreOptions = {}): Promise<OperationResult<boolean>> {
  const loaded = await loadConfig(options);
  if (!loaded.success || !loaded.data) return fail(...loaded.diagnostics);
  const existed = Boolean(loaded.data.environments[alias]);
  delete loaded.data.environments[alias];
  const written = await writeConfig(loaded.data, options);
  return written.success ? ok(existed, written.diagnostics) : fail(...written.diagnostics);
}

export async function ensureEnvironmentAccess(
  alias: string,
  method: string,
  readIntent: boolean,
  options: ConfigStoreOptions = {},
): Promise<OperationResult<{ allowed: true; mode: EnvironmentAccessMode }>> {
  const environment = await getEnvironment(alias, options);
  if (!environment.success) return fail(...environment.diagnostics);
  const mode = environment.data?.access?.mode ?? 'read-write';
  const upper = method.toUpperCase();
  const isReadMethod = upper === 'GET' || upper === 'HEAD';
  if (mode === 'read-only' && !isReadMethod && !readIntent) {
    return fail(
      createDiagnostic('error', 'ENVIRONMENT_WRITE_BLOCKED', `Environment ${alias} is configured read-only and blocks ${upper}.`, {
        source: 'pp/config',
        hint: 'Use a read-write environment or pass --read when a POST is known to be read-only.',
      }),
    );
  }
  return ok({ allowed: true, mode });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function enqueueConfigWrite(path: string, writer: () => Promise<void>): Promise<void> {
  const previous = configWriteQueue.get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  configWriteQueue.set(path, previous.then(() => current, () => current));
  await previous;
  try {
    await writer();
  } finally {
    release();
    if (configWriteQueue.get(path) === current) configWriteQueue.delete(path);
  }
}
