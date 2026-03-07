import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuthService, DEFAULT_PUBLIC_CLIENT_ID, summarizeProfile } from './index';

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
    });

    expect(summary).toMatchObject({
      name: 'user-profile',
      type: 'user',
      clientId: DEFAULT_PUBLIC_CLIENT_ID,
      loginHint: 'user@example.com',
      prompt: 'select_account',
      fallbackToDeviceCode: true,
      tokenCacheKey: 'user-profile',
    });
  });
});
