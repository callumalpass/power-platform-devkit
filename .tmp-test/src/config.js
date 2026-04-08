import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, win32 as win32Path } from 'node:path';
import { z } from 'zod';
import YAML from 'yaml';
import { createDiagnostic, fail, ok } from './diagnostics.js';
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
const globalConfigSchema = z.object({
    accounts: z.record(z.string(), accountSchema).default({}),
    environments: z.record(z.string(), environmentSchema).default({}),
});
const configWriteQueue = new Map();
export function getDefaultConfigDir(platform = process.platform, env = process.env, homeDirectory = homedir()) {
    if (platform === 'win32') {
        return win32Path.resolve(env.APPDATA ? win32Path.join(env.APPDATA, 'pp') : win32Path.join(homeDirectory, 'AppData', 'Roaming', 'pp'));
    }
    if (env.XDG_CONFIG_HOME) {
        return resolve(join(env.XDG_CONFIG_HOME, 'pp'));
    }
    return resolve(join(homeDirectory, '.config', 'pp'));
}
export function getConfigDir(options = {}) {
    return resolve(options.configDir ?? getDefaultConfigDir());
}
export function getConfigPath(options = {}) {
    return join(getConfigDir(options), 'config.json');
}
export function getMsalCacheDir(options = {}) {
    return join(getConfigDir(options), 'msal');
}
export async function loadConfig(options = {}) {
    const path = getConfigPath(options);
    try {
        const raw = await readFile(path, 'utf8');
        const parsed = path.endsWith('.json') ? JSON.parse(raw) : YAML.parse(raw);
        return ok(globalConfigSchema.parse(parsed));
    }
    catch (error) {
        if (await exists(path)) {
            return fail(createDiagnostic('error', 'CONFIG_READ_FAILED', `Failed to load config from ${path}.`, {
                source: 'pp/config',
                detail: error instanceof Error ? error.message : String(error),
                path,
            }));
        }
        return ok(globalConfigSchema.parse({}));
    }
}
export async function writeConfig(config, options = {}) {
    const path = getConfigPath(options);
    try {
        const normalized = globalConfigSchema.parse(config);
        await enqueueConfigWrite(path, async () => {
            await mkdir(dirname(path), { recursive: true });
            const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
            await writeFile(tempPath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
            await rename(tempPath, path);
        });
        return ok(normalized);
    }
    catch (error) {
        return fail(createDiagnostic('error', 'CONFIG_WRITE_FAILED', `Failed to write config ${path}.`, {
            source: 'pp/config',
            detail: error instanceof Error ? error.message : String(error),
            path,
        }));
    }
}
export async function listAccounts(options = {}) {
    const result = await loadConfig(options);
    if (!result.success || !result.data)
        return fail(...result.diagnostics);
    return ok(Object.values(result.data.accounts), result.diagnostics);
}
export async function getAccount(name, options = {}) {
    const result = await loadConfig(options);
    if (!result.success || !result.data)
        return fail(...result.diagnostics);
    return ok(result.data.accounts[name], result.diagnostics);
}
export async function saveAccount(account, options = {}) {
    const loaded = await loadConfig(options);
    if (!loaded.success || !loaded.data)
        return fail(...loaded.diagnostics);
    loaded.data.accounts[account.name] = account;
    const written = await writeConfig(loaded.data, options);
    return written.success ? ok(account, written.diagnostics) : fail(...written.diagnostics);
}
export async function removeAccount(name, options = {}) {
    const loaded = await loadConfig(options);
    if (!loaded.success || !loaded.data)
        return fail(...loaded.diagnostics);
    const existed = Boolean(loaded.data.accounts[name]);
    delete loaded.data.accounts[name];
    for (const [alias, environment] of Object.entries(loaded.data.environments)) {
        if (environment.account === name) {
            delete loaded.data.environments[alias];
        }
    }
    const written = await writeConfig(loaded.data, options);
    return written.success ? ok(existed, written.diagnostics) : fail(...written.diagnostics);
}
export async function listEnvironments(options = {}) {
    const result = await loadConfig(options);
    if (!result.success || !result.data)
        return fail(...result.diagnostics);
    return ok(Object.values(result.data.environments), result.diagnostics);
}
export async function getEnvironment(alias, options = {}) {
    const result = await loadConfig(options);
    if (!result.success || !result.data)
        return fail(...result.diagnostics);
    return ok(result.data.environments[alias], result.diagnostics);
}
export async function saveEnvironment(environment, options = {}) {
    const loaded = await loadConfig(options);
    if (!loaded.success || !loaded.data)
        return fail(...loaded.diagnostics);
    loaded.data.environments[environment.alias] = environment;
    const written = await writeConfig(loaded.data, options);
    return written.success ? ok(environment, written.diagnostics) : fail(...written.diagnostics);
}
export async function removeEnvironment(alias, options = {}) {
    const loaded = await loadConfig(options);
    if (!loaded.success || !loaded.data)
        return fail(...loaded.diagnostics);
    const existed = Boolean(loaded.data.environments[alias]);
    delete loaded.data.environments[alias];
    const written = await writeConfig(loaded.data, options);
    return written.success ? ok(existed, written.diagnostics) : fail(...written.diagnostics);
}
export async function ensureEnvironmentAccess(alias, method, readIntent, options = {}) {
    const environment = await getEnvironment(alias, options);
    if (!environment.success)
        return fail(...environment.diagnostics);
    const mode = environment.data?.access?.mode ?? 'read-write';
    const upper = method.toUpperCase();
    const isReadMethod = upper === 'GET' || upper === 'HEAD';
    if (mode === 'read-only' && !isReadMethod && !readIntent) {
        return fail(createDiagnostic('error', 'ENVIRONMENT_WRITE_BLOCKED', `Environment ${alias} is configured read-only and blocks ${upper}.`, {
            source: 'pp/config',
            hint: 'Use a read-write environment or pass --read when a POST is known to be read-only.',
        }));
    }
    return ok({ allowed: true, mode });
}
async function exists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
async function enqueueConfigWrite(path, writer) {
    const previous = configWriteQueue.get(path) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    configWriteQueue.set(path, previous.then(() => current, () => current));
    await previous;
    try {
        await writer();
    }
    finally {
        release();
        if (configWriteQueue.get(path) === current)
            configWriteQueue.delete(path);
    }
}
