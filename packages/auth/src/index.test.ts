import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuthService, DEFAULT_PUBLIC_CLIENT_ID, buildBrowserLaunchSpec, resolveBrowserProfileDirectory, summarizeBrowserProfile, summarizeProfile } from './index';

describe('AuthService', () => {
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
});
