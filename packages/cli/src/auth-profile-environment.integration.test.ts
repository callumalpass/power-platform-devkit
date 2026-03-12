import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveRepoPath } from '../../../test/golden';
import { cleanupTempDirs, createTempDir, runCli } from './integration-test-helpers';

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupTempDirs();
});

describe('auth profile environment integration coverage', () => {
  it('resolves auth profile inspect from an environment alias', async () => {
    const configDir = await createTempDir();
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          authProfiles: {
            'fixture-user': {
              name: 'fixture-user',
              type: 'user',
              defaultResource: 'https://fixture.crm.dynamics.com',
              loginHint: 'fixture.user@example.com',
              browserProfile: 'fixture-browser',
            },
          },
          browserProfiles: {
            'fixture-browser': {
              name: 'fixture-browser',
              kind: 'edge',
              lastBootstrapUrl: 'https://make.powerapps.com/',
              lastBootstrappedAt: '2026-03-11T10:00:00.000Z',
            },
          },
          environments: {
            fixture: {
              alias: 'fixture',
              url: 'https://fixture.crm.dynamics.com',
              authProfile: 'fixture-user',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const inspect = await runCli(['auth', 'profile', 'inspect', '--env', 'fixture', '--config-dir', configDir, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(JSON.parse(inspect.stdout)).toEqual({
      success: true,
      diagnostics: [],
      warnings: [],
      supportTier: 'preview',
      suggestedNextActions: [],
      provenance: [],
      knownLimitations: [],
      name: 'fixture-user',
      type: 'user',
      tenantId: 'common',
      clientId: '51f81489-12ee-4a9e-aaae-a2591f45987d',
      tokenCacheKey: 'fixture-user',
      loginHint: 'fixture.user@example.com',
      browserProfile: 'fixture-browser',
      prompt: 'select_account',
      fallbackToDeviceCode: true,
      resolvedFromEnvironment: 'fixture',
      resolvedEnvironmentUrl: 'https://fixture.crm.dynamics.com',
      targetResource: 'https://fixture.crm.dynamics.com',
      profileDefaultResource: 'https://fixture.crm.dynamics.com',
      defaultResourceMatchesResolvedEnvironment: true,
      relationships: {
        environmentAliases: ['fixture'],
        environmentCount: 1,
      },
    });
  });

  it('resolves auth profile inspect from an environment-prefixed positional target', async () => {
    const configDir = await createTempDir();
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          authProfiles: {
            'fixture-user': {
              name: 'fixture-user',
              type: 'user',
              defaultResource: 'https://fixture.crm.dynamics.com',
              loginHint: 'fixture.user@example.com',
              browserProfile: 'fixture-browser',
            },
          },
          browserProfiles: {
            'fixture-browser': {
              name: 'fixture-browser',
              kind: 'edge',
            },
          },
          environments: {
            fixture: {
              alias: 'fixture',
              url: 'https://fixture.crm.dynamics.com',
              authProfile: 'fixture-user',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const inspect = await runCli(['auth', 'profile', 'inspect', 'environment:fixture', '--config-dir', configDir, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      name: 'fixture-user',
      resolvedFromEnvironment: 'fixture',
      resolvedEnvironmentUrl: 'https://fixture.crm.dynamics.com',
      targetResource: 'https://fixture.crm.dynamics.com',
      profileDefaultResource: 'https://fixture.crm.dynamics.com',
      defaultResourceMatchesResolvedEnvironment: true,
    });
  });

  it('dispatches auth profile inspect when the argv starts with a wrapper separator', async () => {
    const configDir = await createTempDir();
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          authProfiles: {
            'fixture-user': {
              name: 'fixture-user',
              type: 'user',
              defaultResource: 'https://fixture.crm.dynamics.com',
              loginHint: 'fixture.user@example.com',
              browserProfile: 'fixture-browser',
            },
          },
          browserProfiles: {
            'fixture-browser': {
              name: 'fixture-browser',
              kind: 'edge',
              lastBootstrapUrl: 'https://make.powerapps.com/',
              lastBootstrappedAt: '2026-03-11T10:00:00.000Z',
            },
          },
          environments: {
            fixture: {
              alias: 'fixture',
              url: 'https://fixture.crm.dynamics.com',
              authProfile: 'fixture-user',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const inspect = await runCli(['--', 'auth', 'profile', 'inspect', '--env', 'fixture', '--config-dir', configDir, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      success: true,
      diagnostics: [],
      warnings: [],
      supportTier: 'preview',
      name: 'fixture-user',
      type: 'user',
      tenantId: 'common',
      clientId: '51f81489-12ee-4a9e-aaae-a2591f45987d',
      tokenCacheKey: 'fixture-user',
      loginHint: 'fixture.user@example.com',
      browserProfile: 'fixture-browser',
      prompt: 'select_account',
      fallbackToDeviceCode: true,
      resolvedFromEnvironment: 'fixture',
      resolvedEnvironmentUrl: 'https://fixture.crm.dynamics.com',
      targetResource: 'https://fixture.crm.dynamics.com',
      profileDefaultResource: 'https://fixture.crm.dynamics.com',
      defaultResourceMatchesResolvedEnvironment: true,
      relationships: {
        environmentAliases: ['fixture'],
        environmentCount: 1,
      },
    });
  });

  it('resolves relative config-dir from INIT_CWD when running from the package directory', async () => {
    const workspaceRoot = await createTempDir();
    const configDir = join(workspaceRoot, '.tmp', 'pp-config');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          authProfiles: {
            'fixture-user': {
              name: 'fixture-user',
              type: 'user',
              defaultResource: 'https://fixture.crm.dynamics.com',
              loginHint: 'fixture.user@example.com',
            },
          },
          environments: {
            fixture: {
              alias: 'fixture',
              url: 'https://fixture.crm.dynamics.com',
              authProfile: 'fixture-user',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const originalCwd = process.cwd();
    process.chdir(resolveRepoPath('packages/cli'));

    try {
      const inspect = await runCli(['auth', 'profile', 'inspect', '--env', 'fixture', '--config-dir', './.tmp/pp-config', '--format', 'json'], {
        env: {
          INIT_CWD: workspaceRoot,
        },
      });

      expect(inspect.code).toBe(0);
      expect(inspect.stderr).toBe('');
      expect(JSON.parse(inspect.stdout)).toMatchObject({
        success: true,
        diagnostics: [],
        warnings: [],
        supportTier: 'preview',
        name: 'fixture-user',
        type: 'user',
        tenantId: 'common',
        clientId: '51f81489-12ee-4a9e-aaae-a2591f45987d',
        tokenCacheKey: 'fixture-user',
        loginHint: 'fixture.user@example.com',
        prompt: 'select_account',
        fallbackToDeviceCode: true,
        resolvedFromEnvironment: 'fixture',
        resolvedEnvironmentUrl: 'https://fixture.crm.dynamics.com',
        targetResource: 'https://fixture.crm.dynamics.com',
        profileDefaultResource: 'https://fixture.crm.dynamics.com',
        defaultResourceMatchesResolvedEnvironment: true,
        relationships: {
          environmentAliases: ['fixture'],
          environmentCount: 1,
        },
      });
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('flags when an environment-targeted auth profile points at a different default resource', async () => {
    const configDir = await createTempDir();
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          authProfiles: {
            'fixture-user': {
              name: 'fixture-user',
              type: 'user',
              defaultResource: 'https://other.crm.dynamics.com',
              loginHint: 'fixture.user@example.com',
            },
          },
          environments: {
            fixture: {
              alias: 'fixture',
              url: 'https://fixture.crm.dynamics.com',
              authProfile: 'fixture-user',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const inspect = await runCli(['auth', 'profile', 'inspect', '--env', 'fixture', '--config-dir', configDir, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      success: true,
      diagnostics: [],
      warnings: [],
      supportTier: 'preview',
      name: 'fixture-user',
      type: 'user',
      tenantId: 'common',
      clientId: '51f81489-12ee-4a9e-aaae-a2591f45987d',
      tokenCacheKey: 'fixture-user',
      loginHint: 'fixture.user@example.com',
      prompt: 'select_account',
      fallbackToDeviceCode: true,
      resolvedFromEnvironment: 'fixture',
      resolvedEnvironmentUrl: 'https://fixture.crm.dynamics.com',
      targetResource: 'https://fixture.crm.dynamics.com',
      profileDefaultResource: 'https://other.crm.dynamics.com',
      defaultResourceMatchesResolvedEnvironment: false,
      relationships: {
        environmentAliases: ['fixture'],
        environmentCount: 1,
      },
    });
  });

  it('fails auth profile inspect when --env points at a missing alias', async () => {
    const configDir = await createTempDir();
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.json'), JSON.stringify({ environments: {} }, null, 2), 'utf8');

    const inspect = await runCli(['auth', 'profile', 'inspect', '--env', 'missing', '--config-dir', configDir, '--format', 'json']);

    expect(inspect.code).toBe(1);
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      success: false,
      diagnostics: [
        {
          code: 'ENV_NOT_FOUND',
          message: 'Environment alias missing was not found.',
          source: '@pp/cli',
        },
      ],
    });
    expect(inspect.stderr).toBe('');
  });
});
