import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupTempDirs, createTempDir, runCli } from './integration-test-helpers';

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupTempDirs();
});

describe('environment command integration coverage', () => {
  it('surfaces bound auth and pac guidance in env inspect output', async () => {
    const configDir = await createTempDir();
    const recentBootstrapAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
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
              lastBootstrappedAt: recentBootstrapAt,
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

    const inspect = await runCli(['env', 'inspect', 'fixture', '--config-dir', configDir, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      alias: 'fixture',
      url: 'https://fixture.crm.dynamics.com',
      success: true,
      supportTier: 'preview',
      authProfile: 'fixture-user',
      auth: {
        name: 'fixture-user',
        type: 'user',
        browserProfile: 'fixture-browser',
        status: 'configured',
      },
      tooling: {
        pp: {
          authContextSource: 'pp-config',
          usesEnvironmentAuthProfile: true,
        },
        browser: {
          status: 'bootstrapped',
          name: 'fixture-browser',
          lastBootstrapUrl: 'https://make.powerapps.com/',
          lastBootstrappedAt: recentBootstrapAt,
          staleBootstrap: false,
          staleAfterHours: 24,
          bootstrapCommand: "pp auth browser-profile bootstrap fixture-browser --url 'https://make.powerapps.com/'",
          recommendedAction: expect.stringContaining('Refresh the browser profile before Maker-critical steps'),
        },
        pac: {
          sharesPpAuthContext: false,
          organizationUrl: 'https://fixture.crm.dynamics.com',
          verificationCommand: 'pac auth list',
          nonInteractiveVerification: expect.stringContaining('Do not assume pac supports pp-style `--no-interactive-auth` flags.'),
          risk: 'high',
          recommendedAction: expect.stringContaining('Run `pac auth list` and confirm the active profile targets https://fixture.crm.dynamics.com'),
          reason: expect.stringContaining('browser profile fixture-browser'),
        },
      },
      suggestedNextActions: expect.arrayContaining([
        'Run `pp auth profile inspect fixture-user --format json` to confirm the auth profile bound to environment alias fixture.',
        'Run `pp dv whoami --environment fixture --format json` to confirm live Dataverse access for this alias.',
      ]),
      knownLimitations: expect.arrayContaining([
        'Environment inspect summarizes local pp config and cached browser bootstrap state; it does not prove live Dataverse access on its own.',
      ]),
    });
  });

  it('warns when the bound auth profile default resource disagrees with the alias url', async () => {
    const configDir = await createTempDir();
    const recentBootstrapAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          authProfiles: {
            'fixture-user': {
              name: 'fixture-user',
              type: 'user',
              defaultResource: 'https://stale.crm.dynamics.com',
              loginHint: 'fixture.user@example.com',
              browserProfile: 'fixture-browser',
            },
          },
          browserProfiles: {
            'fixture-browser': {
              name: 'fixture-browser',
              kind: 'edge',
              lastBootstrapUrl: 'https://make.powerapps.com/',
              lastBootstrappedAt: recentBootstrapAt,
            },
          },
          environments: {
            fixture: {
              alias: 'fixture',
              url: 'https://live.crm.dynamics.com',
              authProfile: 'fixture-user',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const inspect = await runCli(['env', 'inspect', 'fixture', '--config-dir', configDir, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      warnings: expect.arrayContaining([
        expect.objectContaining({
          code: 'ENV_AUTH_PROFILE_RESOURCE_MISMATCH',
          message:
            'Environment alias fixture points at https://live.crm.dynamics.com, but bound auth profile fixture-user defaults to https://stale.crm.dynamics.com.',
        }),
      ]),
      suggestedNextActions: expect.arrayContaining([
        'Update environment alias fixture or auth profile fixture-user so both point at the same Dataverse URL before relying on stored environment provenance.',
      ]),
    });
  });

  it('flags browser profiles that were not bootstrapped against the resolved maker environment', async () => {
    const configDir = await createTempDir();
    const recentBootstrapAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
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
              lastBootstrappedAt: recentBootstrapAt,
            },
          },
          environments: {
            fixture: {
              alias: 'fixture',
              url: 'https://fixture.crm.dynamics.com',
              authProfile: 'fixture-user',
              makerEnvironmentId: 'env-123',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const inspect = await runCli(['env', 'inspect', 'fixture', '--config-dir', configDir, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      alias: 'fixture',
      makerEnvironmentId: 'env-123',
      tooling: {
        browser: {
          status: 'needs-targeted-bootstrap',
          name: 'fixture-browser',
          lastBootstrapUrl: 'https://make.powerapps.com/',
          targetsMakerEnvironment: false,
          targetMakerEnvironmentId: 'env-123',
          recommendedBootstrapUrl: 'https://make.powerapps.com/e/env-123/',
          bootstrapCommand: "pp auth browser-profile bootstrap fixture-browser --url 'https://make.powerapps.com/e/env-123/'",
          recommendedAction: expect.stringContaining('Bootstrap the browser profile against Maker environment env-123'),
        },
      },
    });
  });

  it('keeps env inspect readable when the bound auth profile is missing', async () => {
    const configDir = await createTempDir();
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          authProfiles: {},
          environments: {
            fixture: {
              alias: 'fixture',
              url: 'https://fixture.crm.dynamics.com',
              authProfile: 'missing-profile',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const inspect = await runCli(['env', 'inspect', 'fixture', '--config-dir', configDir, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      alias: 'fixture',
      success: true,
      supportTier: 'preview',
      authProfile: 'missing-profile',
      auth: {
        name: 'missing-profile',
        status: 'missing',
      },
      tooling: {
        pac: {
          sharesPpAuthContext: false,
          organizationUrl: 'https://fixture.crm.dynamics.com',
          verificationCommand: 'pac auth list',
          nonInteractiveVerification: expect.stringContaining('Use `pp env inspect <alias>` and `pp dv whoami --no-interactive-auth`'),
          risk: 'unknown',
        },
      },
      suggestedNextActions: expect.arrayContaining([
        'Repair the missing auth profile binding for environment alias fixture before using remote Dataverse commands.',
      ]),
    });
  });

  it('flags stale browser bootstrap metadata for maker-backed environments', async () => {
    const configDir = await createTempDir();
    const staleBootstrapAt = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
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
              lastBootstrapUrl: 'https://make.powerapps.com/e/env-123/',
              lastBootstrappedAt: staleBootstrapAt,
            },
          },
          environments: {
            fixture: {
              alias: 'fixture',
              url: 'https://fixture.crm.dynamics.com',
              authProfile: 'fixture-user',
              makerEnvironmentId: 'env-123',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const inspect = await runCli(['env', 'inspect', 'fixture', '--config-dir', configDir, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      tooling: {
        browser: {
          status: 'stale-bootstrap',
          name: 'fixture-browser',
          lastBootstrapUrl: 'https://make.powerapps.com/e/env-123/',
          lastBootstrappedAt: staleBootstrapAt,
          staleBootstrap: true,
          staleAfterHours: 24,
          targetsMakerEnvironment: true,
          targetMakerEnvironmentId: 'env-123',
          recommendedBootstrapUrl: 'https://make.powerapps.com/e/env-123/',
          bootstrapCommand: "pp auth browser-profile bootstrap fixture-browser --url 'https://make.powerapps.com/e/env-123/'",
          recommendedAction: expect.stringContaining('expired refresh token'),
        },
      },
    });
  });
});
