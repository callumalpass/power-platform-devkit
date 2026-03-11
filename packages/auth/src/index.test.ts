import { chmod, mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfidentialClientApplication, PublicClientApplication } from '@azure/msal-node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthService,
  DEFAULT_BROWSER_BOOTSTRAP_URL,
  DEFAULT_PUBLIC_CLIENT_ID,
  buildBrowserLaunchSpec,
  createTokenProvider,
  resolveBrowserProfileDirectory,
  summarizeBrowserProfile,
  summarizeProfile,
} from './index';

describe('AuthService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads tokens from environment-backed profiles', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-'));
    const auth = new AuthService({ configDir });

    await auth.saveProfile({
      name: 'env-profile',
      type: 'environment-token',
      environmentVariable: 'PP_TEST_TOKEN',
    });

    process.env.PP_TEST_TOKEN = 'token-value';

    const token = await auth.getAccessToken('env-profile', 'https://example.crm.dynamics.com');

    expect(token.success).toBe(true);
    expect(token.data?.token).toBe('token-value');
  });

  it('prefers an explicit resource over the stored default resource when acquiring tokens', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-'));
    const auth = new AuthService({ configDir });
    const credentialSpy = vi.spyOn(ConfidentialClientApplication.prototype, 'acquireTokenByClientCredential').mockResolvedValue({
      accessToken: 'token-value',
    } as never);

    process.env.PP_TEST_CLIENT_SECRET = 'secret-value';

    await auth.saveProfile({
      name: 'client-profile',
      type: 'client-secret',
      tenantId: 'tenant-id',
      clientId: 'client-id',
      clientSecretEnv: 'PP_TEST_CLIENT_SECRET',
      defaultResource: 'https://example.crm.dynamics.com',
    });

    const token = await auth.getAccessToken('client-profile', 'https://api.bap.microsoft.com/');

    expect(token.success).toBe(true);
    expect(token.data?.token).toBe('token-value');
    expect(credentialSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ['https://api.bap.microsoft.com/.default'],
      })
    );
  });

  it('summarizes user profiles with effective defaults', () => {
    const summary = summarizeProfile({
      name: 'user-profile',
      type: 'user',
      loginHint: 'user@example.com',
      browserProfile: 'tenant-a',
    });

    expect(summary).toMatchObject({
      name: 'user-profile',
      type: 'user',
      clientId: DEFAULT_PUBLIC_CLIENT_ID,
      browserProfile: 'tenant-a',
      loginHint: 'user@example.com',
      prompt: 'select_account',
      fallbackToDeviceCode: true,
      tokenCacheKey: 'user-profile',
    });
  });

  it('resolves managed browser profile directories under the config store', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-browser-'));
    const auth = new AuthService({ configDir });

    await auth.saveBrowserProfile({
      name: 'tenant-a',
      kind: 'edge',
    });

    const summary = summarizeBrowserProfile(
      {
        name: 'tenant-a',
        kind: 'edge',
      },
      { configDir }
    );

    expect(resolveBrowserProfileDirectory({ name: 'tenant-a', kind: 'edge' }, { configDir })).toBe(
      join(configDir, 'browser-profiles', 'tenant-a')
    );
    expect(summary).toMatchObject({
      name: 'tenant-a',
      kind: 'edge',
      profileDir: join(configDir, 'browser-profiles', 'tenant-a'),
    });
  });

  it('summarizes browser profile bootstrap metadata', () => {
    const summary = summarizeBrowserProfile({
      name: 'tenant-a',
      kind: 'edge',
      lastBootstrapUrl: DEFAULT_BROWSER_BOOTSTRAP_URL,
      lastBootstrappedAt: '2026-03-09T09:00:00.000Z',
    });

    expect(summary).toMatchObject({
      name: 'tenant-a',
      lastBootstrapUrl: DEFAULT_BROWSER_BOOTSTRAP_URL,
      lastBootstrappedAt: '2026-03-09T09:00:00.000Z',
    });
  });

  it('builds launch specs for managed browser profiles', () => {
    const spec = buildBrowserLaunchSpec(
      {
        name: 'tenant-a',
        kind: 'custom',
        command: '/usr/bin/fake-browser',
        args: ['--disable-sync'],
        directory: '/tmp/tenant-a-browser',
      },
      'https://login.microsoftonline.com',
      {},
      'linux'
    );

    expect(spec.command).toBe('/usr/bin/fake-browser');
    expect(spec.profileDir).toBe('/tmp/tenant-a-browser');
    expect(spec.args).toContain('--user-data-dir=/tmp/tenant-a-browser');
    expect(spec.args).toContain('--disable-sync');
    expect(spec.args.at(-1)).toBe('https://login.microsoftonline.com');
  });

  it('does not send redirectUri in interactive auth requests', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-'));
    const auth = new AuthService({ configDir });
    const originalWaylandDisplay = process.env.WAYLAND_DISPLAY;

    process.env.WAYLAND_DISPLAY = 'wayland-0';

    const interactiveSpy = vi
      .spyOn(PublicClientApplication.prototype, 'acquireTokenInteractive')
      .mockImplementation(async (request) => {
        expect(request.redirectUri).toBeUndefined();
        expect(request.loginHint).toBe('user@example.com');
        expect(request.scopes).toEqual(['https://example.crm.dynamics.com/user_impersonation']);
        return {
          accessToken: 'token-value',
          account: {
            homeAccountId: 'home-account',
            localAccountId: 'local-account',
            username: 'user@example.com',
            tenantId: 'tenant-id',
            environment: 'login.microsoftonline.com',
          },
        } as never;
      });

    try {
      const result = await auth.loginProfile(
        {
          name: 'user-profile',
          type: 'user',
          loginHint: 'user@example.com',
        },
        'https://example.crm.dynamics.com',
        { forcePrompt: true }
      );

      expect(result.success).toBe(true);
      expect(result.data?.token).toBe('token-value');
      expect(interactiveSpy).toHaveBeenCalledOnce();
    } finally {
      if (originalWaylandDisplay === undefined) {
        delete process.env.WAYLAND_DISPLAY;
      } else {
        process.env.WAYLAND_DISPLAY = originalWaylandDisplay;
      }
    }
  });

  it('requests user_impersonation scopes for device-code profiles derived from a resource url', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-'));
    const auth = new AuthService({ configDir });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const deviceCodeSpy = vi
      .spyOn(PublicClientApplication.prototype, 'acquireTokenByDeviceCode')
      .mockImplementation(async (request) => {
        expect(request.scopes).toEqual(['https://example.crm.dynamics.com/user_impersonation']);
        request.deviceCodeCallback({
          deviceCode: 'device-code-value',
          userCode: 'ABC-123',
          verificationUri: 'https://microsoft.com/devicelogin',
          expiresIn: 900,
          interval: 5,
          message: 'Authenticate',
        });
        return {
          accessToken: 'token-value',
          account: {
            homeAccountId: 'home-account',
            localAccountId: 'local-account',
            username: 'user@example.com',
            tenantId: 'tenant-id',
            environment: 'login.microsoftonline.com',
          },
        } as never;
      });

    const result = await auth.loginProfile(
      {
        name: 'device-profile',
        type: 'device-code',
        loginHint: 'user@example.com',
      },
      'https://example.crm.dynamics.com',
      {
        preferredFlow: 'device-code',
      }
    );

    expect(result.success).toBe(true);
    expect(result.data?.token).toBe('token-value');
    expect(deviceCodeSpy).toHaveBeenCalledOnce();
    expect(stderrSpy).toHaveBeenCalledWith('Please authenticate as: user@example.com\n');
  });

  it('returns a specific diagnostic when the token cache is corrupt', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-'));
    const auth = new AuthService({ configDir });
    const cacheDir = join(configDir, 'msal');
    const cachePath = join(cacheDir, 'user-profile.json');

    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, '{"Account":{}}:{}}', 'utf8');

    const result = await auth.loginProfile(
      {
        name: 'user-profile',
        type: 'user',
        loginHint: 'user@example.com',
      },
      'https://example.crm.dynamics.com',
      { forcePrompt: true }
    );

    expect(result.success).toBe(false);
    expect(result.diagnostics).toMatchObject([
      {
        code: 'AUTH_TOKEN_CACHE_CORRUPT',
        message: `Token cache ${cachePath} is corrupt and could not be parsed.`,
        hint: `Remove or rename ${cachePath} and retry authentication.`,
      },
    ]);
    expect(result.diagnostics[0]?.detail).toContain('Unexpected non-whitespace character after JSON');
  });

  it('returns a specific diagnostic when a token cache lock times out', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-'));
    const auth = new AuthService({ configDir });
    const lockPath = join(configDir, 'msal', 'user-profile.json.lock');

    await mkdir(lockPath, { recursive: true });
    await writeFile(
      join(lockPath, 'owner.json'),
      JSON.stringify({
        pid: 4242,
        acquiredAt: '2026-03-11T00:00:00.000Z',
        cachePath: join(configDir, 'msal', 'user-profile.json'),
      }),
      'utf8'
    );

    const result = await auth.loginProfile(
      {
        name: 'user-profile',
        type: 'user',
        loginHint: 'user@example.com',
      },
      'https://example.crm.dynamics.com',
      {
        forcePrompt: true,
        cacheLockTimeoutMs: 25,
        cacheLockRetryDelayMs: 5,
        cacheLockStaleAfterMs: 60_000,
      }
    );

    expect(result.success).toBe(false);
    expect(result.diagnostics).toMatchObject([
      {
        code: 'AUTH_TOKEN_CACHE_LOCK_TIMEOUT',
        message: `Timed out waiting for token cache lock ${lockPath}.`,
        hint: `Wait for the other pp auth command to finish, or remove stale lock ${lockPath} if no auth process is active.`,
      },
    ]);
    expect(result.diagnostics[0]?.detail).toContain(`Waited for ${lockPath}`);
    expect(result.diagnostics[0]?.detail).toContain('pid 4242');
  });

  it('removes stale token cache locks before continuing authentication', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-'));
    const auth = new AuthService({ configDir });
    const lockPath = join(configDir, 'msal', 'user-profile.json.lock');
    const originalWaylandDisplay = process.env.WAYLAND_DISPLAY;

    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, 'owner.json'), '{"pid":4242}\n', 'utf8');
    await utimes(lockPath, new Date('2026-03-10T00:00:00.000Z'), new Date('2026-03-10T00:00:00.000Z'));

    process.env.WAYLAND_DISPLAY = 'wayland-0';

    const tokenCache = {
      deserialize: vi.fn(),
      serialize: vi.fn(() => '{"Account":{}}'),
      getAllAccounts: vi.fn(async () => []),
    };

    vi.spyOn(PublicClientApplication.prototype, 'getTokenCache').mockReturnValue(tokenCache as never);
    vi.spyOn(PublicClientApplication.prototype, 'acquireTokenInteractive').mockResolvedValue({
      accessToken: 'token-value',
      account: {
        homeAccountId: 'home-account',
        localAccountId: 'local-account',
        username: 'user@example.com',
        tenantId: 'tenant-id',
        environment: 'login.microsoftonline.com',
      },
    } as never);

    try {
      const result = await auth.loginProfile(
        {
          name: 'user-profile',
          type: 'user',
          loginHint: 'user@example.com',
        },
        'https://example.crm.dynamics.com',
        {
          forcePrompt: true,
          cacheLockStaleAfterMs: 1_000,
          cacheLockRetryDelayMs: 5,
        }
      );

      expect(result.success).toBe(true);
      expect((await readdir(join(configDir, 'msal'))).filter((entry) => entry.endsWith('.lock'))).toEqual([]);
    } finally {
      if (originalWaylandDisplay === undefined) {
        delete process.env.WAYLAND_DISPLAY;
      } else {
        process.env.WAYLAND_DISPLAY = originalWaylandDisplay;
      }
    }
  });

  it('writes token caches atomically without leaving temp files behind', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-'));
    const auth = new AuthService({ configDir });
    const originalWaylandDisplay = process.env.WAYLAND_DISPLAY;

    process.env.WAYLAND_DISPLAY = 'wayland-0';

    const tokenCache = {
      deserialize: vi.fn(),
      serialize: vi.fn(() => '{"Account":{}}'),
      getAllAccounts: vi.fn(async () => []),
    };

    vi.spyOn(PublicClientApplication.prototype, 'getTokenCache').mockReturnValue(tokenCache as never);
    vi.spyOn(PublicClientApplication.prototype, 'acquireTokenInteractive').mockResolvedValue({
      accessToken: 'token-value',
      account: {
        homeAccountId: 'home-account',
        localAccountId: 'local-account',
        username: 'user@example.com',
        tenantId: 'tenant-id',
        environment: 'login.microsoftonline.com',
      },
    } as never);

    try {
      const result = await auth.loginProfile(
        {
          name: 'user-profile',
          type: 'user',
          loginHint: 'user@example.com',
        },
        'https://example.crm.dynamics.com',
        { forcePrompt: true }
      );

      expect(result.success).toBe(true);

      const cachePath = join(configDir, 'msal', 'user-profile.json');
      expect(await readFile(cachePath, 'utf8')).toBe('{"Account":{}}');
      expect((await readdir(join(configDir, 'msal'))).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
    } finally {
      if (originalWaylandDisplay === undefined) {
        delete process.env.WAYLAND_DISPLAY;
      } else {
        process.env.WAYLAND_DISPLAY = originalWaylandDisplay;
      }
    }
  });

  it('reports silent auth failure before falling back to interactive auth', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-'));
    const auth = new AuthService({ configDir });
    const originalWaylandDisplay = process.env.WAYLAND_DISPLAY;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    process.env.WAYLAND_DISPLAY = 'wayland-0';

    const tokenCache = {
      deserialize: vi.fn(),
      serialize: vi.fn(() => '{}'),
      getAllAccounts: vi.fn(async () => [
        {
          homeAccountId: 'home-account',
          localAccountId: 'local-account',
          username: 'user@example.com',
          tenantId: 'tenant-id',
          environment: 'login.microsoftonline.com',
        },
      ]),
    };

    vi.spyOn(PublicClientApplication.prototype, 'getTokenCache').mockReturnValue(tokenCache as never);
    vi.spyOn(PublicClientApplication.prototype, 'acquireTokenSilent').mockRejectedValue(
      Object.assign(new Error('refresh token expired'), { errorCode: 'invalid_grant' })
    );
    vi.spyOn(PublicClientApplication.prototype, 'acquireTokenInteractive').mockResolvedValue({
      accessToken: 'token-value',
      account: {
        homeAccountId: 'home-account',
        localAccountId: 'local-account',
        username: 'user@example.com',
        tenantId: 'tenant-id',
        environment: 'login.microsoftonline.com',
      },
    } as never);

    try {
      const result = await auth.loginProfile(
        {
          name: 'user-profile',
          type: 'user',
          loginHint: 'user@example.com',
        },
        'https://example.crm.dynamics.com'
      );

      expect(result.success).toBe(true);
      expect(result.data?.token).toBe('token-value');
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Silent authentication failed for profile user-profile: refresh token expired errorCode=invalid_grant. Falling back to interactive authentication.\n')
      );
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cached account user@example.com could not be refreshed silently: refresh token expired errorCode=invalid_grant.')
      );
    } finally {
      if (originalWaylandDisplay === undefined) {
        delete process.env.WAYLAND_DISPLAY;
      } else {
        process.env.WAYLAND_DISPLAY = originalWaylandDisplay;
      }
    }
  });

  it('reuses one public-client token request per resource within a process', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-'));
    const tokenProvider = createTokenProvider(
      {
        name: 'user-profile',
        type: 'user',
        loginHint: 'user@example.com',
      },
      { configDir }
    );

    expect(tokenProvider.success).toBe(true);
    expect(tokenProvider.data).toBeDefined();

    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const accessToken = `header.${Buffer.from(JSON.stringify({ exp: futureExp })).toString('base64url')}.signature`;
    const tokenCache = {
      deserialize: vi.fn(),
      serialize: vi.fn(() => '{}'),
      getAllAccounts: vi.fn(async () => [
        {
          homeAccountId: 'home-account',
          localAccountId: 'local-account',
          username: 'user@example.com',
          tenantId: 'tenant-id',
          environment: 'login.microsoftonline.com',
        },
      ]),
    };

    vi.spyOn(PublicClientApplication.prototype, 'getTokenCache').mockReturnValue(tokenCache as never);
    const silentSpy = vi.spyOn(PublicClientApplication.prototype, 'acquireTokenSilent').mockResolvedValue({
      accessToken,
      account: {
        homeAccountId: 'home-account',
        localAccountId: 'local-account',
        username: 'user@example.com',
        tenantId: 'tenant-id',
        environment: 'login.microsoftonline.com',
      },
    } as never);

    const [first, second, third] = await Promise.all([
      tokenProvider.data!.getAccessToken('https://example.crm.dynamics.com'),
      tokenProvider.data!.getAccessToken('https://example.crm.dynamics.com'),
      tokenProvider.data!.getAccessToken('https://example.crm.dynamics.com'),
    ]);

    expect(first).toBe(accessToken);
    expect(second).toBe(accessToken);
    expect(third).toBe(accessToken);
    expect(silentSpy).toHaveBeenCalledOnce();

    const fourth = await tokenProvider.data!.getAccessToken('https://example.crm.dynamics.com');

    expect(fourth).toBe(accessToken);
    expect(silentSpy).toHaveBeenCalledOnce();
  });

  it('prints interactive auth diagnostics when no cached account or browser bootstrap exists', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-'));
    const auth = new AuthService({ configDir });
    const originalWaylandDisplay = process.env.WAYLAND_DISPLAY;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    process.env.WAYLAND_DISPLAY = 'wayland-0';

    await auth.saveBrowserProfile({
      name: 'tenant-a',
      kind: 'edge',
    });

    const tokenCache = {
      deserialize: vi.fn(),
      serialize: vi.fn(() => '{}'),
      getAllAccounts: vi.fn(async () => []),
    };

    vi.spyOn(PublicClientApplication.prototype, 'getTokenCache').mockReturnValue(tokenCache as never);
    vi.spyOn(PublicClientApplication.prototype, 'acquireTokenInteractive').mockResolvedValue({
      accessToken: 'token-value',
      account: {
        homeAccountId: 'home-account',
        localAccountId: 'local-account',
        username: 'user@example.com',
        tenantId: 'tenant-id',
        environment: 'login.microsoftonline.com',
      },
    } as never);

    try {
      const result = await auth.loginProfile(
        {
          name: 'user-profile',
          type: 'user',
          loginHint: 'user@example.com',
          browserProfile: 'tenant-a',
        },
        'https://example.crm.dynamics.com'
      );

      expect(result.success).toBe(true);
      expect(result.data?.token).toBe('token-value');
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Opening browser for authentication with browser profile tenant-a for auth profile user-profile.')
      );
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('No cached account was available for silent token refresh. This usually means the browser session needs sign-in or consent.')
      );
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Browser profile tenant-a has no recorded bootstrap yet. If this stalls, complete an initial sign-in or consent flow in that profile first.')
      );
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("Bootstrap it with: pp auth browser-profile bootstrap tenant-a --url 'https://make.powerapps.com/'.")
      );
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('If no browser window appears, the browser handoff likely failed.'));
    } finally {
      if (originalWaylandDisplay === undefined) {
        delete process.env.WAYLAND_DISPLAY;
      } else {
        process.env.WAYLAND_DISPLAY = originalWaylandDisplay;
      }
    }
  });

  it('returns a structured failure when browser auth is required but disabled', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-'));
    const auth = new AuthService({ configDir });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await auth.saveBrowserProfile({
      name: 'tenant-a',
      kind: 'edge',
      lastBootstrappedAt: '2026-03-10T07:00:00.000Z',
      lastBootstrapUrl: DEFAULT_BROWSER_BOOTSTRAP_URL,
    });

    const tokenCache = {
      deserialize: vi.fn(),
      serialize: vi.fn(() => '{}'),
      getAllAccounts: vi.fn(async () => [
        {
          homeAccountId: 'home-account',
          localAccountId: 'local-account',
          username: 'user@example.com',
          tenantId: 'tenant-id',
          environment: 'login.microsoftonline.com',
        },
      ]),
    };

    vi.spyOn(PublicClientApplication.prototype, 'getTokenCache').mockReturnValue(tokenCache as never);
    vi.spyOn(PublicClientApplication.prototype, 'acquireTokenSilent').mockRejectedValue(
      Object.assign(new Error('refresh token expired'), { errorCode: 'invalid_grant' })
    );
    const interactiveSpy = vi.spyOn(PublicClientApplication.prototype, 'acquireTokenInteractive');

    const result = await auth.loginProfile(
      {
        name: 'user-profile',
        type: 'user',
        loginHint: 'user@example.com',
        browserProfile: 'tenant-a',
      },
      'https://example.crm.dynamics.com',
      {
        allowInteractive: false,
      }
    );

    expect(result.success).toBe(false);
    expect(result.diagnostics).toMatchObject([
      {
        code: 'AUTH_INTERACTIVE_LOGIN_REQUIRED',
        message: 'Interactive browser authentication is required for profile user-profile.',
        hint:
          'Re-run without --no-interactive-auth after bootstrapping the browser profile, or switch the environment to a device-code or non-browser auth profile.',
      },
    ]);
    expect(result.diagnostics[0]?.detail).toContain('Cached account user@example.com could not be refreshed silently: refresh token expired errorCode=invalid_grant.');
    expect(result.diagnostics[0]?.detail).toContain(
      'Browser profile tenant-a was last bootstrapped at 2026-03-10T07:00:00.000Z for https://make.powerapps.com/.'
    );
    expect(result.diagnostics[0]?.detail).toContain(
      "Refresh it with: pp auth browser-profile bootstrap tenant-a --url 'https://make.powerapps.com/'."
    );
    expect(stderrSpy).not.toHaveBeenCalled();
    expect(interactiveSpy).not.toHaveBeenCalled();
  });

  it('prefers installed stable Linux browser binaries when generic names are absent', async () => {
    const browserBinDir = await mkdtemp(join(tmpdir(), 'pp-browser-bin-'));
    const originalPath = process.env.PATH;

    await writeFile(join(browserBinDir, 'microsoft-edge-stable'), '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(join(browserBinDir, 'microsoft-edge-stable'), 0o755);

    try {
      process.env.PATH = browserBinDir;

      const edgeSpec = buildBrowserLaunchSpec(
        {
          name: 'tenant-edge',
          kind: 'edge',
        },
        'https://login.microsoftonline.com',
        {},
        'linux'
      );

      expect(edgeSpec.command).toBe('microsoft-edge-stable');
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('marks a browser profile as bootstrapped', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-auth-'));
    const auth = new AuthService({ configDir });

    await auth.saveBrowserProfile({
      name: 'tenant-a',
      kind: 'edge',
    });

    const updated = await auth.markBrowserProfileBootstrapped('tenant-a', {
      url: DEFAULT_BROWSER_BOOTSTRAP_URL,
      completedAt: '2026-03-09T09:30:00.000Z',
    });

    expect(updated.success).toBe(true);
    expect(updated.data).toMatchObject({
      name: 'tenant-a',
      lastBootstrapUrl: DEFAULT_BROWSER_BOOTSTRAP_URL,
      lastBootstrappedAt: '2026-03-09T09:30:00.000Z',
    });
  });
});
