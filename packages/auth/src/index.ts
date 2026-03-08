import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ConfidentialClientApplication,
  PromptValue,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
} from '@azure/msal-node';
import {
  getAuthProfile,
  getMsalCacheDir,
  listAuthProfiles,
  removeAuthProfile,
  saveAuthProfile,
  type ConfigStoreOptions,
  type StoredAuthProfile,
} from '@pp/config';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';

export const DEFAULT_PUBLIC_CLIENT_ID = '51f81489-12ee-4a9e-aaae-a2591f45987d';
export const DEFAULT_USER_TENANT = 'common';

export type AuthProfile = StoredAuthProfile;
export type AuthProfileType = AuthProfile['type'];
export type UserAuthProfile = Extract<AuthProfile, { type: 'user' | 'device-code' }>;
export type PublicClientFlow = 'interactive' | 'device-code';

export interface TokenProvider {
  getAccessToken(resource: string): Promise<string>;
}

export interface PublicClientLoginOptions {
  forcePrompt?: boolean;
  preferredFlow?: PublicClientFlow;
}

export class StaticTokenProvider implements TokenProvider {
  constructor(private readonly token: string) {}

  async getAccessToken(): Promise<string> {
    return this.token;
  }
}

export class EnvironmentTokenProvider implements TokenProvider {
  constructor(private readonly variableName: string) {}

  async getAccessToken(): Promise<string> {
    const token = process.env[this.variableName];

    if (!token) {
      throw new Error(`Environment variable ${this.variableName} is not set`);
    }

    return token;
  }
}

export class ClientSecretTokenProvider implements TokenProvider {
  constructor(private readonly profile: Extract<AuthProfile, { type: 'client-secret' }>) {}

  async getAccessToken(resource: string): Promise<string> {
    const clientSecret = process.env[this.profile.clientSecretEnv];

    if (!clientSecret) {
      throw new Error(`Environment variable ${this.profile.clientSecretEnv} is not set`);
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

export class UserTokenProvider implements TokenProvider {
  constructor(
    private readonly profile: UserAuthProfile,
    private readonly options: ConfigStoreOptions = {}
  ) {}

  async getAccessToken(resource: string): Promise<string> {
    const result = await acquireAndPersistPublicClientToken(this.profile, this.options, resource, {
      preferredFlow: this.profile.type === 'device-code' ? 'device-code' : 'interactive',
    });

    return result.accessToken;
  }
}

export class AuthService {
  constructor(private readonly options: ConfigStoreOptions = {}) {}

  async listProfiles(): Promise<OperationResult<AuthProfile[]>> {
    return listAuthProfiles(this.options);
  }

  async getProfile(name: string): Promise<OperationResult<AuthProfile | undefined>> {
    return getAuthProfile(name, this.options);
  }

  async saveProfile(profile: AuthProfile): Promise<OperationResult<AuthProfile>> {
    return saveAuthProfile(profile, this.options);
  }

  async removeProfile(name: string): Promise<OperationResult<boolean>> {
    const profile = await this.getProfile(name);
    const removed = await removeAuthProfile(name, this.options);

    if (!removed.success || !removed.data || !profile.success || !profile.data) {
      return removed;
    }

    if (isPublicClientProfile(profile.data)) {
      await removeTokenCache(profile.data, this.options);
    }

    return removed;
  }

  async loginProfile(
    profile: UserAuthProfile,
    resource: string,
    options: PublicClientLoginOptions = {}
  ): Promise<OperationResult<{ profile: UserAuthProfile; token: string }>> {
    const saved = await this.saveProfile(profile);

    if (!saved.success || !saved.data) {
      return saved as unknown as OperationResult<{ profile: UserAuthProfile; token: string }>;
    }

    try {
      const acquired = await acquireAndPersistPublicClientToken(saved.data as UserAuthProfile, this.options, resource, options);

      return ok(
        {
          profile: acquired.profile,
          token: acquired.accessToken,
        },
        {
          supportTier: 'stable',
        }
      );
    } catch (error) {
      return fail(
        createDiagnostic('error', 'AUTH_TOKEN_ACQUISITION_FAILED', `Failed to authenticate profile ${profile.name}`, {
          source: '@pp/auth',
          detail: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }

  async getAccessToken(profileName: string, resource: string): Promise<OperationResult<{ profile: AuthProfile; token: string }>> {
    const profileResult = await this.getProfile(profileName);

    if (!profileResult.success) {
      return profileResult as unknown as OperationResult<{ profile: AuthProfile; token: string }>;
    }

    const profile = profileResult.data;

    if (!profile) {
      return fail(
        createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${profileName} was not found`, {
          source: '@pp/auth',
        })
      );
    }

    if (isPublicClientProfile(profile)) {
      try {
        const acquired = await acquireAndPersistPublicClientToken(profile, this.options, resource, {
          preferredFlow: profile.type === 'device-code' ? 'device-code' : 'interactive',
        });

        return ok(
          {
            profile: acquired.profile,
            token: acquired.accessToken,
          },
          {
            supportTier: 'stable',
          }
        );
      } catch (error) {
        return fail(
          createDiagnostic('error', 'AUTH_TOKEN_ACQUISITION_FAILED', `Failed to acquire token for profile ${profileName}`, {
            source: '@pp/auth',
            detail: error instanceof Error ? error.message : String(error),
          })
        );
      }
    }

    const tokenProviderResult = createTokenProvider(profile, this.options);

    if (!tokenProviderResult.success || !tokenProviderResult.data) {
      return tokenProviderResult as unknown as OperationResult<{ profile: AuthProfile; token: string }>;
    }

    try {
      const token = await tokenProviderResult.data.getAccessToken(resource);
      return ok(
        {
          profile,
          token,
        },
        {
          supportTier: profile.type === 'static-token' ? 'preview' : 'stable',
        }
      );
    } catch (error) {
      return fail(
        createDiagnostic('error', 'AUTH_TOKEN_ACQUISITION_FAILED', `Failed to acquire token for profile ${profileName}`, {
          source: '@pp/auth',
          detail: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }
}

export function createTokenProvider(
  profile: AuthProfile,
  options: ConfigStoreOptions = {}
): OperationResult<TokenProvider> {
  switch (profile.type) {
    case 'static-token':
      return ok(new StaticTokenProvider(profile.token), {
        supportTier: 'preview',
      });
    case 'environment-token':
      return ok(new EnvironmentTokenProvider(profile.environmentVariable), {
        supportTier: 'stable',
      });
    case 'client-secret':
      return ok(new ClientSecretTokenProvider(profile), {
        supportTier: 'stable',
      });
    case 'user':
    case 'device-code':
      return ok(new UserTokenProvider(profile, options), {
        supportTier: 'stable',
      });
    default:
      return fail(
        createDiagnostic(
          'error',
          'AUTH_PROFILE_INVALID',
          `Auth profile ${(profile as AuthProfile).name} is not a supported type`,
          {
            source: '@pp/auth',
          }
        )
      );
  }
}

export function summarizeProfile(profile: AuthProfile): Record<string, unknown> {
  switch (profile.type) {
    case 'static-token':
      return {
        name: profile.name,
        type: profile.type,
        tenantId: profile.tenantId,
        defaultResource: profile.defaultResource,
        hasToken: true,
      };
    case 'environment-token':
      return {
        name: profile.name,
        type: profile.type,
        tenantId: profile.tenantId,
        environmentVariable: profile.environmentVariable,
        defaultResource: profile.defaultResource,
      };
    case 'client-secret':
      return {
        name: profile.name,
        type: profile.type,
        tenantId: profile.tenantId,
        clientId: profile.clientId,
        clientSecretEnv: profile.clientSecretEnv,
        defaultResource: profile.defaultResource,
      };
    case 'user':
      return {
        name: profile.name,
        type: profile.type,
        tenantId: resolveUserTenant(profile),
        clientId: profile.clientId ?? DEFAULT_PUBLIC_CLIENT_ID,
        tokenCacheKey: resolveTokenCacheKey(profile),
        loginHint: profile.loginHint,
        accountUsername: profile.accountUsername,
        homeAccountId: profile.homeAccountId,
        localAccountId: profile.localAccountId,
        prompt: profile.prompt ?? 'select_account',
        fallbackToDeviceCode: profile.fallbackToDeviceCode ?? true,
        defaultResource: profile.defaultResource,
      };
    case 'device-code':
      return {
        name: profile.name,
        type: profile.type,
        tenantId: resolveUserTenant(profile),
        clientId: profile.clientId ?? DEFAULT_PUBLIC_CLIENT_ID,
        tokenCacheKey: resolveTokenCacheKey(profile),
        loginHint: profile.loginHint,
        accountUsername: profile.accountUsername,
        homeAccountId: profile.homeAccountId,
        localAccountId: profile.localAccountId,
        defaultResource: profile.defaultResource,
      };
  }
}

function resolveScopes(profile: AuthProfile, resource: string): string[] {
  if (profile.scopes && profile.scopes.length > 0) {
    return profile.scopes;
  }

  const effectiveResource = profile.defaultResource ?? resource;

  if (!effectiveResource) {
    throw new Error(`Profile ${profile.name} does not define scopes or a default resource`);
  }

  const normalizedResource = normalizeResourceForScopes(effectiveResource);
  return [`${normalizedResource}/.default`];
}

function normalizeResourceForScopes(resource: string): string {
  try {
    return new URL(resource).origin;
  } catch {
    return resource.replace(/\/+$/, '');
  }
}

function authorityForTenant(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}`;
}

function ensureAccessToken(result: AuthenticationResult | null, profileName: string): string {
  if (!result?.accessToken) {
    throw new Error(`No access token was returned for profile ${profileName}`);
  }

  return result.accessToken;
}

async function acquireAndPersistPublicClientToken(
  profile: UserAuthProfile,
  options: ConfigStoreOptions,
  resource: string,
  loginOptions: PublicClientLoginOptions = {}
): Promise<{ accessToken: string; profile: UserAuthProfile }> {
  const acquired = await acquirePublicClientToken(profile, options, resource, loginOptions);

  if (!publicProfilesEqual(profile, acquired.profile)) {
    await saveAuthProfile(acquired.profile, options);
  }

  return acquired;
}

async function acquirePublicClientToken(
  profile: UserAuthProfile,
  options: ConfigStoreOptions,
  resource: string,
  loginOptions: PublicClientLoginOptions = {}
): Promise<{ accessToken: string; profile: UserAuthProfile }> {
  const cachePath = resolveTokenCachePath(profile, options);
  const app = new PublicClientApplication({
    auth: {
      clientId: profile.clientId ?? DEFAULT_PUBLIC_CLIENT_ID,
      authority: authorityForTenant(resolveUserTenant(profile)),
    },
  });

  await restoreTokenCache(app, cachePath);
  const scopes = resolveScopes(profile, resource);

  if (!loginOptions.forcePrompt) {
    const account = await resolveCachedAccount(app, profile);

    if (account) {
      try {
        const silent = await app.acquireTokenSilent({
          account,
          scopes,
        });

        if (silent?.accessToken) {
          await persistTokenCache(app, cachePath);
          return {
            accessToken: silent.accessToken,
            profile: updateProfileAccount(profile, silent.account ?? account),
          };
        }
      } catch {
        // Silent auth can fail if the cached account needs fresh interaction.
      }
    }
  }

  const preferredFlow = loginOptions.preferredFlow ?? (profile.type === 'device-code' ? 'device-code' : 'interactive');

  if (preferredFlow === 'device-code') {
    return acquireTokenByDeviceCode(app, profile, scopes, cachePath);
  }

  if (!canAttemptInteractiveAuth()) {
    process.stderr.write('Interactive authentication is unavailable in this shell because no graphical desktop session was detected. Falling back to device code.\n');
    return acquireTokenByDeviceCode(app, profile, scopes, cachePath);
  }

  try {
    return await acquireTokenInteractively(app, profile, scopes, cachePath);
  } catch (error) {
    if (profile.type === 'user' && profile.fallbackToDeviceCode === false) {
      throw error;
    }

    process.stderr.write(
      `Interactive authentication failed for profile ${profile.name}: ${error instanceof Error ? error.message : String(error)}. Falling back to device code.\n`
    );
    return acquireTokenByDeviceCode(app, profile, scopes, cachePath);
  }
}

async function acquireTokenInteractively(
  app: PublicClientApplication,
  profile: UserAuthProfile,
  scopes: string[],
  cachePath: string
): Promise<{ accessToken: string; profile: UserAuthProfile }> {
  process.stderr.write('Opening browser for authentication...\n');

  const result = await app.acquireTokenInteractive({
    scopes,
    redirectUri: 'http://localhost',
    prompt: resolvePrompt(profile.type === 'user' ? profile.prompt : undefined),
    loginHint: profile.loginHint,
    openBrowser: openSystemBrowser,
    successTemplate: 'Authentication complete. You can close this window.',
    errorTemplate: 'Authentication failed. You can close this window.',
  });

  const accessToken = ensureAccessToken(result, profile.name);
  await persistTokenCache(app, cachePath);

  return {
    accessToken,
    profile: updateProfileAccount(profile, result.account),
  };
}

async function acquireTokenByDeviceCode(
  app: PublicClientApplication,
  profile: UserAuthProfile,
  scopes: string[],
  cachePath: string
): Promise<{ accessToken: string; profile: UserAuthProfile }> {
  if (profile.loginHint) {
    process.stderr.write(`Please authenticate as: ${profile.loginHint}\n`);
  }

  const result = await app.acquireTokenByDeviceCode({
    scopes,
    deviceCodeCallback: (response) => {
      process.stderr.write(`${response.message}\n`);
    },
  });

  const accessToken = ensureAccessToken(result, profile.name);
  await persistTokenCache(app, cachePath);

  return {
    accessToken,
    profile: updateProfileAccount(profile, result?.account),
  };
}

async function resolveCachedAccount(app: PublicClientApplication, profile: UserAuthProfile): Promise<AccountInfo | null> {
  const accounts = await app.getTokenCache().getAllAccounts();

  if (profile.homeAccountId) {
    const match = accounts.find((account) => account.homeAccountId === profile.homeAccountId);

    if (match) {
      return match;
    }
  }

  if (profile.localAccountId) {
    const match = accounts.find((account) => account.localAccountId === profile.localAccountId);

    if (match) {
      return match;
    }
  }

  const preferredUsername = profile.accountUsername ?? profile.loginHint;

  if (preferredUsername) {
    const normalizedUsername = preferredUsername.toLowerCase();
    const match = accounts.find((account) => account.username.toLowerCase() === normalizedUsername);

    if (match) {
      return match;
    }
  }

  return accounts[0] ?? null;
}

function updateProfileAccount(profile: UserAuthProfile, account: AccountInfo | null | undefined): UserAuthProfile {
  if (!account) {
    return profile;
  }

  return {
    ...profile,
    accountUsername: account.username,
    homeAccountId: account.homeAccountId,
    localAccountId: account.localAccountId,
  };
}

function publicProfilesEqual(left: UserAuthProfile, right: UserAuthProfile): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolvePrompt(prompt: Extract<AuthProfile, { type: 'user' }>['prompt']): string {
  switch (prompt) {
    case 'login':
      return PromptValue.LOGIN;
    case 'consent':
      return PromptValue.CONSENT;
    case 'none':
      return PromptValue.NONE;
    case 'select_account':
    default:
      return PromptValue.SELECT_ACCOUNT;
  }
}

function resolveUserTenant(profile: Pick<UserAuthProfile, 'tenantId'>): string {
  return profile.tenantId ?? DEFAULT_USER_TENANT;
}

function resolveTokenCacheKey(profile: Pick<UserAuthProfile, 'name' | 'tokenCacheKey'>): string {
  return profile.tokenCacheKey ?? profile.name.replaceAll(/[^a-zA-Z0-9_-]/g, '_');
}

function resolveTokenCachePath(profile: UserAuthProfile, options: ConfigStoreOptions): string {
  return join(getMsalCacheDir(options), `${resolveTokenCacheKey(profile)}.json`);
}

function isPublicClientProfile(profile: AuthProfile): profile is UserAuthProfile {
  return profile.type === 'user' || profile.type === 'device-code';
}

async function restoreTokenCache(app: PublicClientApplication, path: string): Promise<void> {
  try {
    const serialized = await readFile(path, 'utf8');
    app.getTokenCache().deserialize(serialized);
  } catch {
    // Ignore missing or unreadable caches and continue with interactive flow.
  }
}

async function persistTokenCache(app: PublicClientApplication, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const serialized = app.getTokenCache().serialize();
  await writeFile(path, serialized, 'utf8');
}

async function removeTokenCache(profile: UserAuthProfile, options: ConfigStoreOptions): Promise<void> {
  try {
    await rm(resolveTokenCachePath(profile, options), { force: true });
  } catch {
    // Ignore cache cleanup failures on profile removal.
  }
}

async function openSystemBrowser(url: string): Promise<void> {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.once('error', reject);
    child.once('spawn', resolve);
    child.unref();
  });
}

function canAttemptInteractiveAuth(): boolean {
  if (process.platform === 'linux') {
    return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  }

  return true;
}
