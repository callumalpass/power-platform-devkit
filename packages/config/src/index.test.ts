import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadGlobalConfigOrDefault,
  saveAuthProfile,
  saveEnvironmentAlias,
  type ConfigStoreOptions,
} from './index';

describe('global config store', () => {
  it('persists auth profiles and environments', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-config-'));
    const options: ConfigStoreOptions = { configDir };

    await saveAuthProfile(
      {
        name: 'dev-profile',
        type: 'user',
        loginHint: 'user@example.com',
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

    expect(config.success).toBe(true);
    expect(config.data?.config.authProfiles['dev-profile']?.type).toBe('user');
    expect(config.data?.config.authProfiles['dev-profile']?.loginHint).toBe('user@example.com');
    expect(config.data?.config.environments.dev?.url).toBe('https://example.crm.dynamics.com');
  });
});
