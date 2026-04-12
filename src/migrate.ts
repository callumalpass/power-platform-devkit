import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import YAML from 'yaml';
import {
  getConfigPath,
  getDefaultConfigDir,
  writeConfig,
  type Account,
  type ConfigStoreOptions,
  type Environment,
  type GlobalConfig,
} from './config.js';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from './diagnostics.js';

interface LegacyGlobalConfig {
  authProfiles?: Record<string, LegacyAuthProfile>;
  environments?: Record<string, LegacyEnvironment>;
}

type LegacyAuthProfile =
  | {
      name?: string;
      type?: 'static-token';
      description?: string;
      tenantId?: string;
      clientId?: string;
      scopes?: string[];
      token?: string;
    }
  | {
      name?: string;
      type?: 'environment-token';
      description?: string;
      tenantId?: string;
      clientId?: string;
      scopes?: string[];
      environmentVariable?: string;
    }
  | {
      name?: string;
      type?: 'client-secret';
      description?: string;
      tenantId?: string;
      clientId?: string;
      scopes?: string[];
      clientSecretEnv?: string;
    }
  | {
      name?: string;
      type?: 'user';
      description?: string;
      tenantId?: string;
      clientId?: string;
      scopes?: string[];
      tokenCacheKey?: string;
      loginHint?: string;
      accountUsername?: string;
      homeAccountId?: string;
      localAccountId?: string;
      prompt?: 'select_account' | 'login' | 'consent' | 'none';
      fallbackToDeviceCode?: boolean;
    }
  | {
      name?: string;
      type?: 'device-code';
      description?: string;
      tenantId?: string;
      clientId?: string;
      scopes?: string[];
      tokenCacheKey?: string;
      loginHint?: string;
      accountUsername?: string;
      homeAccountId?: string;
      localAccountId?: string;
    };

interface LegacyEnvironment {
  alias?: string;
  url?: string;
  authProfile?: string;
  tenantId?: string;
  displayName?: string;
  makerEnvironmentId?: string;
  access?: {
    mode?: 'read-write' | 'read-only';
  };
}

export interface MigrateConfigOptions {
  sourceConfigPath?: string;
  sourceDir?: string;
  targetConfigOptions?: ConfigStoreOptions;
  apply?: boolean;
}

export async function migrateLegacyConfig(options: MigrateConfigOptions = {}): Promise<
  OperationResult<{
    sourcePath: string;
    targetPath: string;
    backupPath?: string;
    migratedConfig: GlobalConfig;
    summary: {
      accountsMigrated: number;
      environmentsMigrated: number;
      environmentsSkipped: number;
    };
    skippedEnvironments: Array<{ alias: string; reason: string }>;
  }>
> {
  const sourcePath = resolve(
    options.sourceConfigPath ??
      (options.sourceDir ? join(resolve(options.sourceDir), 'config.json') : getConfigPath({ configDir: getDefaultConfigDir() })),
  );
  const targetOptions = options.targetConfigOptions ?? {};
  const targetPath = getConfigPath(targetOptions);

  let legacy: LegacyGlobalConfig;
  try {
    const raw = await readFile(sourcePath, 'utf8');
    legacy = sourcePath.endsWith('.yaml') || sourcePath.endsWith('.yml')
      ? (YAML.parse(raw) as LegacyGlobalConfig)
      : (JSON.parse(raw) as LegacyGlobalConfig);
  } catch (error) {
    return fail(
      createDiagnostic('error', 'LEGACY_CONFIG_READ_FAILED', `Failed to read legacy config from ${sourcePath}.`, {
        source: 'pp/migrate',
        path: sourcePath,
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  const diagnostics: Diagnostic[] = [];
  const accounts: Record<string, Account> = {};
  const environments: Record<string, Environment> = {};
  const skippedEnvironments: Array<{ alias: string; reason: string }> = [];

  for (const [key, value] of Object.entries(legacy.authProfiles ?? {})) {
    const migrated = migrateAccount(key, value);
    if (migrated.success) {
      accounts[migrated.data.name] = migrated.data;
    } else {
      diagnostics.push(
        createDiagnostic('warning', 'ACCOUNT_SKIPPED', `Skipped account ${key}.`, {
          source: 'pp/migrate',
          detail: migrated.reason,
        }),
      );
    }
  }

  for (const [key, value] of Object.entries(legacy.environments ?? {})) {
    const migrated = migrateEnvironment(key, value);
    if (migrated.success) {
      environments[migrated.data.alias] = migrated.data;
      continue;
    }
    skippedEnvironments.push({ alias: key, reason: migrated.reason });
    diagnostics.push(
      createDiagnostic('warning', 'ENVIRONMENT_SKIPPED', `Skipped environment ${key}.`, {
        source: 'pp/migrate',
        detail: migrated.reason,
      }),
    );
  }

  const migratedConfig: GlobalConfig = { accounts, environments, browserProfiles: {} };

  let backupPath: string | undefined;
  if (options.apply) {
    await mkdir(dirname(targetPath), { recursive: true });
    if (sourcePath === targetPath) {
      backupPath = `${targetPath}.legacy-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await copyFile(sourcePath, backupPath);
    }
    const written = await writeConfig(migratedConfig, targetOptions);
    if (!written.success) return fail(...written.diagnostics);
  }

  return ok(
    {
      sourcePath,
      targetPath,
      backupPath,
      migratedConfig,
      summary: {
        accountsMigrated: Object.keys(accounts).length,
        environmentsMigrated: Object.keys(environments).length,
        environmentsSkipped: skippedEnvironments.length,
      },
      skippedEnvironments,
    },
    diagnostics,
  );
}

function migrateAccount(name: string, account: LegacyAuthProfile): { success: true; data: Account } | { success: false; reason: string } {
  const base = {
    name: account.name ?? name,
    description: account.description,
    tenantId: account.tenantId,
    clientId: account.clientId,
    scopes: account.scopes,
  };

  switch (account.type) {
    case 'static-token':
      return account.token ? { success: true, data: { ...base, kind: 'static-token', token: account.token } } : { success: false, reason: 'Missing token.' };
    case 'environment-token':
      return account.environmentVariable
        ? { success: true, data: { ...base, kind: 'environment-token', environmentVariable: account.environmentVariable } }
        : { success: false, reason: 'Missing environmentVariable.' };
    case 'client-secret':
      return account.tenantId && account.clientId && account.clientSecretEnv
        ? {
            success: true,
            data: { ...base, kind: 'client-secret', tenantId: account.tenantId, clientId: account.clientId, clientSecretEnv: account.clientSecretEnv },
          }
        : { success: false, reason: 'Missing tenantId, clientId, or clientSecretEnv.' };
    case 'user':
      return {
        success: true,
        data: {
          ...base,
          kind: 'user',
          tokenCacheKey: account.tokenCacheKey,
          loginHint: account.loginHint,
          accountUsername: account.accountUsername,
          homeAccountId: account.homeAccountId,
          localAccountId: account.localAccountId,
          prompt: account.prompt,
          fallbackToDeviceCode: account.fallbackToDeviceCode,
        },
      };
    case 'device-code':
      return {
        success: true,
        data: {
          ...base,
          kind: 'device-code',
          tokenCacheKey: account.tokenCacheKey,
          loginHint: account.loginHint,
          accountUsername: account.accountUsername,
          homeAccountId: account.homeAccountId,
          localAccountId: account.localAccountId,
        },
      };
    default:
      return { success: false, reason: `Unsupported or missing auth profile type: ${(account as { type?: string }).type ?? 'unknown'}.` };
  }
}

function migrateEnvironment(alias: string, environment: LegacyEnvironment): { success: true; data: Environment } | { success: false; reason: string } {
  if (!environment.url) return { success: false, reason: 'Missing url.' };
  if (!environment.authProfile) return { success: false, reason: 'Missing authProfile.' };
  if (!environment.makerEnvironmentId) return { success: false, reason: 'Missing makerEnvironmentId. Re-add with `pp env add` to auto-discover it.' };
  if (!environment.tenantId) return { success: false, reason: 'Missing tenantId. Re-add with `pp env add` to auto-discover it.' };

  return {
    success: true,
    data: {
      alias: environment.alias ?? alias,
      account: environment.authProfile,
      url: environment.url,
      displayName: environment.displayName,
      makerEnvironmentId: environment.makerEnvironmentId,
      tenantId: environment.tenantId,
      ...(environment.access?.mode ? { access: { mode: environment.access.mode } } : {}),
    },
  };
}
