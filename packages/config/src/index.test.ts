import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadGlobalConfigOrDefault,
  saveBrowserProfile,
  saveAuthProfile,
  saveEnvironmentAlias,
  type ConfigStoreOptions,
} from './index';

describe('global config store', () => {
  it('persists auth profiles and environments', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-config-'));
    const options: ConfigStoreOptions = { configDir };

    await saveBrowserProfile(
      {
        name: 'tenant-a',
        kind: 'edge',
        lastBootstrapUrl: 'https://make.powerapps.com/',
        lastBootstrappedAt: '2026-03-09T09:00:00.000Z',
      },
      options
    );

    await saveAuthProfile(
      {
        name: 'dev-profile',
        type: 'user',
        loginHint: 'user@example.com',
        browserProfile: 'tenant-a',
        fallbackToDeviceCode: true,
      },
      options
    );

    await saveEnvironmentAlias(
      {
        alias: 'dev',
        url: 'https://example.crm.dynamics.com',
        authProfile: 'dev-profile',
      },
      options
    );

    const config = await loadGlobalConfigOrDefault(options);
    const profile = config.data?.config.authProfiles['dev-profile'];

    expect(config.success).toBe(true);
    expect(config.data?.config.browserProfiles['tenant-a']?.kind).toBe('edge');
    expect(config.data?.config.browserProfiles['tenant-a']?.lastBootstrapUrl).toBe('https://make.powerapps.com/');
    expect(config.data?.config.browserProfiles['tenant-a']?.lastBootstrappedAt).toBe('2026-03-09T09:00:00.000Z');
    expect(profile?.type).toBe('user');
    expect(profile && profile.type === 'user' ? profile.loginHint : undefined).toBe('user@example.com');
    expect(profile && profile.type === 'user' ? profile.browserProfile : undefined).toBe('tenant-a');
    expect(config.data?.config.environments.dev?.url).toBe('https://example.crm.dynamics.com');
  });
});
