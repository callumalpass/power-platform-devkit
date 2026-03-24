import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  getAuthProfile,
  getMsalCacheDir,
  listAuthProfiles,
  removeAuthProfile,
  saveAuthProfile,
  type AuthProfile,
  type ConfigStoreOptions,
} from './config.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';

export const DEFAULT_PUBLIC_CLIENT_ID = '51f81489-12ee-4a9e-aaae-a2591f45987d';
export const DEFAULT_USER_TENANT = 'common';

export interface TokenProvider {
  getAccessToken(resource: string): Promise<string>;
}

export interface PublicClientLoginOptions {
  forcePrompt?: boolean;
  preferredFlow?: 'interactive' | 'device-code';
  allowInteractive?: boolean;
}

type UserAuthProfile = Extract<AuthProfile, { type: 'user' | 'device-code' }>;

export class AuthService {
  constructor(private readonly options: ConfigStoreOptions = {}) {}

  listProfiles(): Promise<OperationResult<AuthProfile[]>> {
    return listAuthProfiles(this.options);
  }

  getProfile(name: string): Promise<OperationResult<AuthProfile | undefined>> {
    return getAuthProfile(name, this.options);
  }

  saveProfile(profile: AuthProfile): Promise<OperationResult<AuthProfile>> {
    return saveAuthProfile(profile, this.options);
  }

  removeProfile(name: string): Promise<OperationResult<boolean>> {
    return removeAuthProfile(name, this.options);
  }

  async login(name: string, resource: string, options: PublicClientLoginOptions = {}): Promise<OperationResult<Record<string, unknown>>> {
    const profileResult = await this.getProfile(name);
    if (!profileResult.success || !profileResult.data) {
      return profileResult.success
        ? fail(createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${name} was not found.`, { source: 'pp/auth' }))
        : fail(...profileResult.diagnostics);
    }

    const provider = createTokenProvider(profileResult.data, this.options, options);
    if (!provider.success || !provider.data) return fail(...provider.diagnostics);
    const accessToken = await provider.data.getAccessToken(resource);
    const claims = decodeJwtClaims(accessToken);
    const refreshed = await this.getProfile(name);

    return ok({
      profile: summarizeProfile(refreshed.success && refreshed.data ? refreshed.data : profileResult.data),
      resource: normalizeResource(resource),
      tenantId: readStringClaim(claims, 'tid'),
      expiresAt: readNumericClaim(claims, 'exp'),
    });
  }

  async getToken(name: string, resource: string, options: PublicClientLoginOptions = {}): Promise<OperationResult<string>> {
    const profileResult = await this.getProfile(name);
    if (!profileResult.success || !profileResult.data) {
      return profileResult.success
        ? fail(createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${name} was not found.`, { source: 'pp/auth' }))
        : fail(...profileResult.diagnostics);
    }
    const provider = createTokenProvider(profileResult.data, this.options, options);
    if (!provider.success || !provider.data) return fail(...provider.diagnostics);
    return ok(await provider.data.getAccessToken(resource));
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
    if (!token) {
      throw new Error(`Environment variable ${this.variableName} is not set.`);
    }
    return token;
  }
}

class ClientSecretTokenProvider implements TokenProvider {
  constructor(private readonly profile: Extract<AuthProfile, { type: 'client-secret' }>) {}

  async getAccessToken(resource: string): Promise<string> {
    const clientSecret = process.env[this.profile.clientSecretEnv];
    if (!clientSecret) {
      throw new Error(`Environment variable ${this.profile.clientSecretEnv} is not set.`);
    }
    const app = new ConfidentialClientApplication({
      auth: {
        clientId: this.profile.clientId,
        clientSecret,
        authority: authorityForTenant(this.profile.tenantId),
      },
    });
    const result = await app.acquireTokenByClientCredential({
      scopes: resolveScopes(this.profile, resource),
    });
    return ensureAccessToken(result, this.profile.name);
  }
}

class UserTokenProvider implements TokenProvider {
  constructor(
    private readonly profile: UserAuthProfile,
    private readonly options: ConfigStoreOptions,
    private readonly loginOptions: PublicClientLoginOptions,
  ) {}

  async getAccessToken(resource: string): Promise<string> {
    const acquired = await acquireAndPersistPublicClientToken(this.profile, this.options, resource, this.loginOptions);
    return acquired.accessToken;
  }
}

export function createTokenProvider(
  profile: AuthProfile,
  options: ConfigStoreOptions = {},
  loginOptions: PublicClientLoginOptions = {},
): OperationResult<TokenProvider> {
  switch (profile.type) {
    case 'static-token':
      return ok(new StaticTokenProvider(profile.token));
    case 'environment-token':
      return ok(new EnvironmentTokenProvider(profile.environmentVariable));
    case 'client-secret':
      return ok(new ClientSecretTokenProvider(profile));
    case 'user':
    case 'device-code':
      return ok(new UserTokenProvider(profile, options, loginOptions));
  }
}

export function summarizeProfile(profile: AuthProfile): Record<string, unknown> {
  switch (profile.type) {
    case 'static-token':
      return { name: profile.name, type: profile.type, tenantId: profile.tenantId, hasToken: true };
    case 'environment-token':
      return { name: profile.name, type: profile.type, tenantId: profile.tenantId, environmentVariable: profile.environmentVariable };
    case 'client-secret':
      return {
        name: profile.name,
        type: profile.type,
        tenantId: profile.tenantId,
        clientId: profile.clientId,
        clientSecretEnv: profile.clientSecretEnv,
      };
    case 'user':
      return {
        name: profile.name,
        type: profile.type,
        tenantId: profile.tenantId ?? DEFAULT_USER_TENANT,
        clientId: profile.clientId ?? DEFAULT_PUBLIC_CLIENT_ID,
        tokenCacheKey: resolveTokenCacheKey(profile),
        loginHint: profile.loginHint,
        accountUsername: profile.accountUsername,
        homeAccountId: profile.homeAccountId,
        localAccountId: profile.localAccountId,
      };
    case 'device-code':
      return {
        name: profile.name,
        type: profile.type,
        tenantId: profile.tenantId ?? DEFAULT_USER_TENANT,
        clientId: profile.clientId ?? DEFAULT_PUBLIC_CLIENT_ID,
        tokenCacheKey: resolveTokenCacheKey(profile),
        loginHint: profile.loginHint,
        accountUsername: profile.accountUsername,
        homeAccountId: profile.homeAccountId,
        localAccountId: profile.localAccountId,
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

async function acquireAndPersistPublicClientToken(
  profile: UserAuthProfile,
  options: ConfigStoreOptions,
  resource: string,
  loginOptions: PublicClientLoginOptions,
): Promise<{ accessToken: string; profile: UserAuthProfile }> {
  const app = await createPublicClientApplication(profile, options);
  const scopes = resolveScopes(profile, resource);
  const account = await resolveStoredAccount(app, profile);
  let result: AuthenticationResult | null = null;

  if (account) {
    try {
      result = await app.acquireTokenSilent({ account, scopes });
    } catch {
      result = null;
    }
  }

  if (!result) {
    const flow = loginOptions.preferredFlow ?? (profile.type === 'device-code' ? 'device-code' : 'interactive');
    if (flow === 'device-code') {
      result = await app.acquireTokenByDeviceCode({
        scopes,
        deviceCodeCallback: (response) => {
          process.stderr.write(`${response.message}\n`);
        },
      });
    } else {
      if (loginOptions.allowInteractive === false) {
        throw new Error(`Interactive authentication is disabled for profile ${profile.name}.`);
      }
      result = await app.acquireTokenInteractive({
        scopes,
        prompt:
          loginOptions.forcePrompt
            ? PromptValue.LOGIN
            : profile.type === 'user' && profile.prompt
              ? promptValue(profile.prompt)
              : undefined,
        loginHint: profile.loginHint,
        openBrowser: async (url) => {
          await openBrowser(url);
        },
      });
    }
  }

  const accessToken = ensureAccessToken(result, profile.name);
  const accountInfo = result?.account;
  const nextProfile: UserAuthProfile = {
    ...profile,
    accountUsername: accountInfo?.username ?? profile.accountUsername,
    homeAccountId: accountInfo?.homeAccountId ?? profile.homeAccountId,
    localAccountId: accountInfo?.localAccountId ?? profile.localAccountId,
    tokenCacheKey: resolveTokenCacheKey(profile),
  };
  await saveAuthProfile(nextProfile, options);
  return { accessToken, profile: nextProfile };
}

async function createPublicClientApplication(profile: UserAuthProfile, options: ConfigStoreOptions): Promise<PublicClientApplication> {
  const cacheDir = getMsalCacheDir(options);
  await mkdir(cacheDir, { recursive: true });
  const cachePath = join(cacheDir, `${resolveTokenCacheKey(profile)}.json`);
  const cachePlugin: ICachePlugin = {
    beforeCacheAccess: async (context) => {
      try {
        const cache = await readFile(cachePath, 'utf8');
        context.tokenCache.deserialize(cache);
      } catch {}
    },
    afterCacheAccess: async (context) => {
      if (!context.cacheHasChanged) return;
      await writeFile(cachePath, context.tokenCache.serialize(), 'utf8');
    },
  };
  return new PublicClientApplication({
    auth: {
      clientId: profile.clientId ?? DEFAULT_PUBLIC_CLIENT_ID,
      authority: authorityForTenant(profile.tenantId ?? DEFAULT_USER_TENANT),
    },
    cache: { cachePlugin },
  });
}

async function resolveStoredAccount(app: PublicClientApplication, profile: UserAuthProfile): Promise<AccountInfo | null> {
  const accounts = await app.getTokenCache().getAllAccounts();
  if (accounts.length === 0) return null;
  return (
    accounts.find((account) => profile.homeAccountId && account.homeAccountId === profile.homeAccountId) ??
    accounts.find((account) => profile.localAccountId && account.localAccountId === profile.localAccountId) ??
    accounts.find((account) => profile.accountUsername && account.username === profile.accountUsername) ??
    accounts[0] ??
    null
  );
}

function resolveScopes(profile: AuthProfile, resource: string): string[] {
  if (profile.scopes?.length) {
    return profile.scopes;
  }
  const normalized = normalizeResource(resource);
  if (profile.type === 'user' || profile.type === 'device-code') {
    if (normalized === 'https://graph.microsoft.com') {
      return [`${normalized}/.default`];
    }
    return [`${normalized}/user_impersonation`];
  }
  return [`${normalized}/.default`];
}

function authorityForTenant(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}`;
}

function ensureAccessToken(result: AuthenticationResult | null, profileName: string): string {
  if (!result?.accessToken) {
    throw new Error(`No access token was returned for profile ${profileName}.`);
  }
  return result.accessToken;
}

function resolveTokenCacheKey(profile: UserAuthProfile): string {
  return profile.tokenCacheKey ?? profile.name ?? randomUUID();
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
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args =
    process.platform === 'darwin'
      ? [url]
      : process.platform === 'win32'
        ? ['/c', 'start', '', url]
        : [url];
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: process.platform !== 'win32' });
    child.on('error', reject);
    child.unref();
    resolvePromise();
  });
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
