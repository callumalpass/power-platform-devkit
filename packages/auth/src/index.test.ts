import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicClientApplication } from '@azure/msal-node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthService,
  DEFAULT_BROWSER_BOOTSTRAP_URL,
  DEFAULT_PUBLIC_CLIENT_ID,
  buildBrowserLaunchSpec,
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
    } finally {
      if (originalWaylandDisplay === undefined) {
        delete process.env.WAYLAND_DISPLAY;
      } else {
        process.env.WAYLAND_DISPLAY = originalWaylandDisplay;
      }
    }
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
