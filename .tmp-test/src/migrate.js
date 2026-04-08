import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import YAML from 'yaml';
import { getConfigPath, getDefaultConfigDir, writeConfig, } from './config.js';
import { createDiagnostic, fail, ok } from './diagnostics.js';
export async function migrateLegacyConfig(options = {}) {
    const sourcePath = resolve(options.sourceConfigPath ??
        (options.sourceDir ? join(resolve(options.sourceDir), 'config.json') : getConfigPath({ configDir: getDefaultConfigDir() })));
    const targetOptions = options.targetConfigOptions ?? {};
    const targetPath = getConfigPath(targetOptions);
    let legacy;
    try {
        const raw = await readFile(sourcePath, 'utf8');
        legacy = sourcePath.endsWith('.yaml') || sourcePath.endsWith('.yml')
            ? YAML.parse(raw)
            : JSON.parse(raw);
    }
    catch (error) {
        return fail(createDiagnostic('error', 'LEGACY_CONFIG_READ_FAILED', `Failed to read legacy config from ${sourcePath}.`, {
            source: 'pp/migrate',
            path: sourcePath,
            detail: error instanceof Error ? error.message : String(error),
        }));
    }
    const diagnostics = [];
    const accounts = {};
    const environments = {};
    const skippedEnvironments = [];
    for (const [key, value] of Object.entries(legacy.authProfiles ?? {})) {
        const migrated = migrateAccount(key, value);
        if (migrated.success) {
            accounts[migrated.data.name] = migrated.data;
        }
        else {
            diagnostics.push(createDiagnostic('warning', 'ACCOUNT_SKIPPED', `Skipped account ${key}.`, {
                source: 'pp/migrate',
                detail: migrated.reason,
            }));
        }
    }
    for (const [key, value] of Object.entries(legacy.environments ?? {})) {
        const migrated = migrateEnvironment(key, value);
        if (migrated.success) {
            environments[migrated.data.alias] = migrated.data;
            continue;
        }
        skippedEnvironments.push({ alias: key, reason: migrated.reason });
        diagnostics.push(createDiagnostic('warning', 'ENVIRONMENT_SKIPPED', `Skipped environment ${key}.`, {
            source: 'pp/migrate',
            detail: migrated.reason,
        }));
    }
    const migratedConfig = { accounts, environments };
    let backupPath;
    if (options.apply) {
        await mkdir(dirname(targetPath), { recursive: true });
        if (sourcePath === targetPath) {
            backupPath = `${targetPath}.legacy-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
            await copyFile(sourcePath, backupPath);
        }
        const written = await writeConfig(migratedConfig, targetOptions);
        if (!written.success)
            return fail(...written.diagnostics);
    }
    return ok({
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
    }, diagnostics);
}
function migrateAccount(name, account) {
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
            return { success: false, reason: `Unsupported or missing auth profile type: ${account.type ?? 'unknown'}.` };
    }
}
function migrateEnvironment(alias, environment) {
    if (!environment.url)
        return { success: false, reason: 'Missing url.' };
    if (!environment.authProfile)
        return { success: false, reason: 'Missing authProfile.' };
    if (!environment.makerEnvironmentId)
        return { success: false, reason: 'Missing makerEnvironmentId. Re-add with `pp env add` to auto-discover it.' };
    if (!environment.tenantId)
        return { success: false, reason: 'Missing tenantId. Re-add with `pp env add` to auto-discover it.' };
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
