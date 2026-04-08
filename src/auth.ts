import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ConfidentialClientApplication,
  PublicClientApplication,
  PromptValue,
  type AccountInfo,
  type AuthenticationResult,
  type ICachePlugin,
} from '@azure/msal-node';
import {
  getAccount,
  getMsalCacheDir,
  listAccounts,
  removeAccount,
  saveAccount,
  type Account,
  type ConfigStoreOptions,
} from './config.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';

export const DEFAULT_PUBLIC_CLIENT_ID = '51f81489-12ee-4a9e-aaae-a2591f45987d';
export const DEFAULT_USER_TENANT = 'common';
export const DEFAULT_LOGIN_RESOURCE = 'https://graph.microsoft.com';

export interface LoginTarget {
  resource: string;
  label?: string;
  api?: 'dv' | 'flow' | 'graph' | 'bap' | 'powerapps';
}

export interface TokenProvider {
  getAccessToken(resource: string): Promise<string>;
}

export interface PublicClientLoginOptions {
  forcePrompt?: boolean;
  preferredFlow?: 'interactive' | 'device-code';
  allowInteractive?: boolean;
  onInteractiveUrl?: (url: string) => void | Promise<void>;
  onDeviceCode?: (info: { verificationUri: string; userCode: string; message: string }) => void | Promise<void>;
  loginTargets?: LoginTarget[];
  onLoginTargetUpdate?: (update: {
    target: LoginTarget;
    index: number;
    total: number;
    status: 'running' | 'completed';
    url?: string;
  }) => void | Promise<void>;
}

export interface LoginAccountInput {
  name: string;
  kind: Account['kind'];
  description?: string;
  tenantId?: string;
  clientId?: string;
  scopes?: string[];
  loginHint?: string;
  prompt?: 'select_account' | 'login' | 'consent' | 'none';
  fallbackToDeviceCode?: boolean;
  clientSecretEnv?: string;
  environmentVariable?: string;
  token?: string;
}

type UserAccount = Extract<Account, { kind: 'user' | 'device-code' }>;

export class AuthService {
  constructor(private readonly options: ConfigStoreOptions = {}) {}

  listAccounts(): Promise<OperationResult<Account[]>> {
    return listAccounts(this.options);
  }

  getAccount(name: string): Promise<OperationResult<Account | undefined>> {
    return getAccount(name, this.options);
  }

  saveAccount(account: Account): Promise<OperationResult<Account>> {
    return saveAccount(account, this.options);
  }

  removeAccount(name: string): Promise<OperationResult<boolean>> {
    return removeAccount(name, this.options);
  }

  async login(input: LoginAccountInput, options: PublicClientLoginOptions = {}): Promise<OperationResult<Record<string, unknown>>> {
    let accountToSave: Account;
    try {
      accountToSave = buildAccount(input);
    } catch (error) {
      return fail(
        createDiagnostic('error', 'ACCOUNT_LOGIN_INPUT_INVALID', error instanceof Error ? error.message : String(error), {
          source: 'pp/auth',
        }),
      );
    }

    const accountResult = await this.saveAccount(accountToSave);
    if (!accountResult.success || !accountResult.data) return fail(...accountResult.diagnostics);

    const targets = normalizeLoginTargets(options.loginTargets);
    let primaryToken: string | undefined;
    const collectedDiagnostics: import('./diagnostics.js').Diagnostic[] = [];
    for (const [index, target] of targets.entries()) {
      await options.onLoginTargetUpdate?.({
        target,
        index,
        total: targets.length,
        status: 'running',
      });
      const tokenResult = await this.getToken(accountResult.data.name, target.resource, {
        ...options,
        loginTargets: undefined,
        onLoginTargetUpdate: undefined,
        onInteractiveUrl: async (url) => {
          await options.onInteractiveUrl?.(url);
          await options.onLoginTargetUpdate?.({
            target,
            index,
            total: targets.length,
            status: 'running',
            url,
          });
        },
      });
      if (!tokenResult.success || !tokenResult.data) {
        if (!primaryToken) {
          // First target failure is fatal — no token at all
          return fail(...tokenResult.diagnostics);
        }
        // Subsequent target failures are non-fatal — collect as warnings and continue
        for (const d of tokenResult.diagnostics) {
          collectedDiagnostics.push({
            ...d,
            level: 'warning',
            message: `${target.label ?? target.resource}: ${d.message}`,
          });
        }
        await options.onLoginTargetUpdate?.({
          target,
          index,
          total: targets.length,
          status: 'completed',
        });
        continue;
      }
      if (!primaryToken) primaryToken = tokenResult.data;
      await options.onLoginTargetUpdate?.({
        target,
        index,
        total: targets.length,
        status: 'completed',
      });
    }

    const claims = decodeJwtClaims(primaryToken ?? '');
    const refreshed = await this.getAccount(accountResult.data.name);

    return ok({
      account: summarizeAccount(refreshed.success && refreshed.data ? refreshed.data : accountResult.data),
      resources: targets.map((target) => target.resource),
      resource: targets[0]?.resource ?? DEFAULT_LOGIN_RESOURCE,
      tenantId: readStringClaim(claims, 'tid'),
      expiresAt: readNumericClaim(claims, 'exp'),
    }, collectedDiagnostics);
  }

  async getToken(name: string, resource: string, options: PublicClientLoginOptions = {}): Promise<OperationResult<string>> {
    const accountResult = await this.getAccount(name);
    if (!accountResult.success || !accountResult.data) {
      return accountResult.success
        ? fail(createDiagnostic('error', 'ACCOUNT_NOT_FOUND', `Account ${name} was not found.`, { source: 'pp/auth' }))
        : fail(...accountResult.diagnostics);
    }
    const account = accountResult.data;
    const provider = createTokenProvider(accountResult.data, this.options, options);
    if (!provider.success || !provider.data) return fail(...provider.diagnostics);
    try {
      return ok(await provider.data.getAccessToken(resource));
    } catch (error) {
      return fail(loginFailureDiagnostic(account, resource, error));
    }
  }

  async checkTokenStatus(name: string, resource?: string): Promise<OperationResult<{ authenticated: boolean; expiresAt?: number }>> {
    const accountResult = await this.getAccount(name);
    if (!accountResult.success || !accountResult.data) {
      return ok({ authenticated: false });
    }
    const account = accountResult.data;
    const targetResource = resource ?? DEFAULT_LOGIN_RESOURCE;

    if (account.kind === 'static-token') {
      return ok({ authenticated: Boolean(account.token) });
    }
    if (account.kind === 'environment-token') {
      return ok({ authenticated: Boolean(process.env[account.environmentVariable]) });
    }
    if (account.kind === 'client-secret') {
      return ok({ authenticated: Boolean(process.env[account.clientSecretEnv]) });
    }

    // user / device-code: try silent acquisition only
    try {
      const app = await createPublicClientApplication(account, this.options);
      const scopes = resolveScopes(account, targetResource);
      const storedAccount = await resolveStoredAccount(app, account);
      if (!storedAccount) return ok({ authenticated: false });
      const result = await app.acquireTokenSilent({ account: storedAccount, scopes });
      if (!result || !result.accessToken) return ok({ authenticated: false });
      const claims = decodeJwtClaims(result.accessToken);
      return ok({ authenticated: true, expiresAt: readNumericClaim(claims, 'exp') });
    } catch {
      return ok({ authenticated: false });
    }
  }
}

class StaticTokenProvider implements TokenProvider {
  constructor(private readonly token: string) {}
  async getAccessToken(): Promise<string> {
    return this.token;
  }
}

class EnvironmentTokenProvider implements TokenProvider {
  constructor(private readonly variableName: string) {}
  async getAccessToken(): Promise<string> {
    const token = process.env[this.variableName];
    if (!token) throw new Error(`Environment variable ${this.variableName} is not set.`);
    return token;
  }
}

class ClientSecretTokenProvider implements TokenProvider {
  constructor(private readonly account: Extract<Account, { kind: 'client-secret' }>) {}

  async getAccessToken(resource: string): Promise<string> {
    const clientSecret = process.env[this.account.clientSecretEnv];
    if (!clientSecret) throw new Error(`Environment variable ${this.account.clientSecretEnv} is not set.`);
    const app = new ConfidentialClientApplication({
      auth: {
        clientId: this.account.clientId,
        clientSecret,
        authority: authorityForTenant(this.account.tenantId),
      },
    });
    const result = await app.acquireTokenByClientCredential({
      scopes: resolveScopes(this.account, resource),
    });
    return ensureAccessToken(result, this.account.name);
  }
}

class UserTokenProvider implements TokenProvider {
  constructor(
    private readonly account: UserAccount,
    private readonly options: ConfigStoreOptions,
    private readonly loginOptions: PublicClientLoginOptions,
  ) {}

  async getAccessToken(resource: string): Promise<string> {
    const acquired = await acquireAndPersistPublicClientToken(this.account, this.options, resource, this.loginOptions);
    return acquired.accessToken;
  }
}

export function createTokenProvider(
  account: Account,
  options: ConfigStoreOptions = {},
  loginOptions: PublicClientLoginOptions = {},
): OperationResult<TokenProvider> {
  switch (account.kind) {
    case 'static-token':
      return ok(new StaticTokenProvider(account.token));
    case 'environment-token':
      return ok(new EnvironmentTokenProvider(account.environmentVariable));
    case 'client-secret':
      return ok(new ClientSecretTokenProvider(account));
    case 'user':
    case 'device-code':
      return ok(new UserTokenProvider(account, options, loginOptions));
  }
}

export function summarizeAccount(account: Account): Record<string, unknown> {
  switch (account.kind) {
    case 'static-token':
      return { name: account.name, kind: account.kind, tenantId: account.tenantId, hasToken: true };
    case 'environment-token':
      return { name: account.name, kind: account.kind, tenantId: account.tenantId, environmentVariable: account.environmentVariable };
    case 'client-secret':
      return {
        name: account.name,
        kind: account.kind,
        tenantId: account.tenantId,
        clientId: account.clientId,
        clientSecretEnv: account.clientSecretEnv,
      };
    case 'user':
    case 'device-code':
      return {
        name: account.name,
        kind: account.kind,
        tenantId: account.tenantId ?? DEFAULT_USER_TENANT,
        clientId: account.clientId ?? DEFAULT_PUBLIC_CLIENT_ID,
        tokenCacheKey: resolveTokenCacheKey(account),
        loginHint: account.loginHint,
        accountUsername: account.accountUsername,
        homeAccountId: account.homeAccountId,
        localAccountId: account.localAccountId,
      };
  }
}

export function decodeJwtClaims(token: string): Record<string, unknown> | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.length % 4 === 0 ? normalized : `${normalized}${'='.repeat(4 - (normalized.length % 4))}`;
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function buildAccount(input: LoginAccountInput): Account {
  const base = {
    name: input.name,
    description: input.description,
    tenantId: input.tenantId,
    clientId: input.clientId,
    scopes: input.scopes,
    loginHint: input.loginHint,
  };

  switch (input.kind) {
    case 'static-token':
      if (!input.token) throw new Error('Static-token accounts require --token.');
      return { ...base, kind: 'static-token', token: input.token };
    case 'environment-token':
      if (!input.environmentVariable) throw new Error('Environment-token accounts require --env-var.');
      return { ...base, kind: 'environment-token', environmentVariable: input.environmentVariable };
    case 'client-secret':
      if (!input.tenantId || !input.clientId || !input.clientSecretEnv) {
        throw new Error('Client-secret accounts require --tenant-id, --client-id, and --client-secret-env.');
      }
      return {
        ...base,
        kind: 'client-secret',
        tenantId: input.tenantId,
        clientId: input.clientId,
        clientSecretEnv: input.clientSecretEnv,
      };
    case 'device-code':
      return { ...base, kind: 'device-code' };
    case 'user':
      return {
        ...base,
        kind: 'user',
        prompt: input.prompt,
        fallbackToDeviceCode: input.fallbackToDeviceCode,
      };
  }
}

async function acquireAndPersistPublicClientToken(
  account: UserAccount,
  options: ConfigStoreOptions,
  resource: string,
  loginOptions: PublicClientLoginOptions,
): Promise<{ accessToken: string; account: UserAccount }> {
  const app = await createPublicClientApplication(account, options);
  const scopes = resolveScopes(account, resource);
  const storedAccount = await resolveStoredAccount(app, account);
  let result: AuthenticationResult | null = null;

  if (storedAccount) {
    try {
      result = await app.acquireTokenSilent({ account: storedAccount, scopes });
    } catch {
      result = null;
    }
  }

  if (!result) {
    const flow = loginOptions.preferredFlow ?? (account.kind === 'device-code' ? 'device-code' : 'interactive');
    if (flow === 'device-code') {
      result = await app.acquireTokenByDeviceCode({
        scopes,
        deviceCodeCallback: async (response) => {
          process.stderr.write(`${response.message}\n`);
          await loginOptions.onDeviceCode?.({
            verificationUri: response.verificationUri,
            userCode: response.userCode,
            message: response.message,
          });
        },
      });
    } else {
      if (loginOptions.allowInteractive === false) {
        throw new Error(`Interactive authentication is disabled for account ${account.name}.`);
      }
      result = await app.acquireTokenInteractive({
        scopes,
        prompt:
          loginOptions.forcePrompt
            ? PromptValue.LOGIN
            : account.kind === 'user' && account.prompt
              ? promptValue(account.prompt)
              : undefined,
        loginHint: account.loginHint,
        openBrowser: async (url) => {
          await loginOptions.onInteractiveUrl?.(url);
          await openBrowser(url);
        },
      });
    }
  }

  const accessToken = ensureAccessToken(result, account.name);
  const accountInfo = result?.account;
  const nextAccount: UserAccount = {
    ...account,
    accountUsername: accountInfo?.username ?? account.accountUsername,
    homeAccountId: accountInfo?.homeAccountId ?? account.homeAccountId,
    localAccountId: accountInfo?.localAccountId ?? account.localAccountId,
    tokenCacheKey: resolveTokenCacheKey(account),
  };
  await saveAccount(nextAccount, options);
  return { accessToken, account: nextAccount };
}

function loginFailureDiagnostic(account: Account, resource: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedResource = normalizeResource(resource);
  const isInteractive = account.kind === 'user' || account.kind === 'device-code';
  const code =
    isInteractive && /JSON/i.test(message)
      ? 'INTERACTIVE_LOGIN_RESPONSE_INVALID'
      : isInteractive
        ? 'INTERACTIVE_LOGIN_FAILED'
        : 'TOKEN_ACQUISITION_FAILED';
  return createDiagnostic('error', code, `Failed to acquire a token for ${account.name} on ${normalizedResource}.`, {
    source: 'pp/auth',
    detail: message + (error instanceof Error && error.stack ? `\n\n${error.stack}` : ''),
    hint: isInteractive
      ? 'Try device code for this account or re-run login for just this API to isolate the failing resource.'
      : undefined,
  });
}

async function createPublicClientApplication(account: UserAccount, options: ConfigStoreOptions): Promise<PublicClientApplication> {
  const cacheDir = getMsalCacheDir(options);
  await mkdir(cacheDir, { recursive: true });
  const cachePath = join(cacheDir, `${resolveTokenCacheKey(account)}.json`);
  const cachePlugin: ICachePlugin = {
    beforeCacheAccess: async (context) => {
      try {
        const cache = await readFile(cachePath, 'utf8');
        try {
          JSON.parse(cache);
        } catch {
          await quarantineCorruptCacheFile(cachePath);
          return;
        }
        context.tokenCache.deserialize(cache);
      } catch {}
    },
    afterCacheAccess: async (context) => {
      if (!context.cacheHasChanged) return;
      try {
        await writeFile(cachePath, context.tokenCache.serialize(), 'utf8');
      } catch (error) {
        await quarantineCorruptCacheFile(cachePath);
        throw new Error(`Failed to write MSAL cache for ${account.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
  return new PublicClientApplication({
    auth: {
      clientId: account.clientId ?? DEFAULT_PUBLIC_CLIENT_ID,
      authority: authorityForTenant(account.tenantId ?? DEFAULT_USER_TENANT),
    },
    cache: { cachePlugin },
  });
}

async function resolveStoredAccount(app: PublicClientApplication, account: UserAccount): Promise<AccountInfo | null> {
  const accounts = await app.getTokenCache().getAllAccounts();
  if (accounts.length === 0) return null;
  return (
    accounts.find((candidate) => account.homeAccountId && candidate.homeAccountId === account.homeAccountId) ??
    accounts.find((candidate) => account.localAccountId && candidate.localAccountId === account.localAccountId) ??
    accounts.find((candidate) => account.accountUsername && candidate.username === account.accountUsername) ??
    accounts[0] ??
    null
  );
}

function resolveScopes(account: Account, resource: string): string[] {
  if (account.scopes?.length) return account.scopes;
  const normalized = normalizeResource(resource);
  if (account.kind === 'user' || account.kind === 'device-code') {
    if (normalized === 'https://graph.microsoft.com') return [`${normalized}/.default`];
    return [`${normalized}/user_impersonation`];
  }
  return [`${normalized}/.default`];
}

function authorityForTenant(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}`;
}

function ensureAccessToken(result: AuthenticationResult | null, accountName: string): string {
  if (!result?.accessToken) throw new Error(`No access token was returned for account ${accountName}.`);
  return result.accessToken;
}

function resolveTokenCacheKey(account: UserAccount): string {
  return account.tokenCacheKey ?? account.name ?? randomUUID();
}

function normalizeLoginTargets(targets?: LoginTarget[]): LoginTarget[] {
  const seen = new Set<string>();
  const defaultTarget: LoginTarget = { resource: DEFAULT_LOGIN_RESOURCE, label: 'Graph', api: 'graph' };
  const normalized = (targets?.length ? targets : [defaultTarget])
    .map((target) => ({
      ...target,
      resource: normalizeResource(target.resource),
    }))
    .filter((target) => {
      if (!target.resource || seen.has(target.resource)) return false;
      seen.add(target.resource);
      return true;
    });
  return normalized.length ? normalized : [defaultTarget];
}

async function quarantineCorruptCacheFile(cachePath: string): Promise<void> {
  const suffix = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  try {
    await rename(cachePath, `${cachePath}.corrupt-${suffix}`);
  } catch {}
}

function promptValue(prompt: 'select_account' | 'login' | 'consent' | 'none') {
  switch (prompt) {
    case 'select_account':
      return PromptValue.SELECT_ACCOUNT;
    case 'login':
      return PromptValue.LOGIN;
    case 'consent':
      return PromptValue.CONSENT;
    case 'none':
      return PromptValue.NONE;
  }
}

async function openBrowser(url: string): Promise<void> {
  process.stderr.write(`Open this login URL to continue authentication:\n${url}\n`);
}

function normalizeResource(resource: string): string {
  try {
    return new URL(resource).origin;
  } catch {
    return resource.replace(/\/+$/, '');
  }
}

function readStringClaim(claims: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = claims?.[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumericClaim(claims: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = claims?.[key];
  return typeof value === 'number' ? value : undefined;
}
