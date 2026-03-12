import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJsonFile } from '@pp/artifacts';
import { createFixtureDataverseClient, mockDataverseResolution } from '../../../test/dataverse-fixture';
import { resolveRepoPath } from '../../../test/golden';
import {
  cleanupTempDirs,
  createTempDir,
  runCli,
  type SolutionFixtureEnvironments,
} from './integration-test-helpers';

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupTempDirs();
});

describe('remote discovery help integration coverage', () => {
  it('prints group and subcommand help for remote discovery commands with the shared output contract', async () => {
    const dvHelp = await runCli(['dv', '--help']);
    const dvMetadataHelp = await runCli(['dv', 'metadata', '--help']);
    const whoAmIHelp = await runCli(['dv', 'whoami', '--help']);
    const solutionHelp = await runCli(['solution', '--help']);
    const solutionListHelp = await runCli(['solution', 'list', '--help']);
    const solutionPublishersHelp = await runCli(['solution', 'publishers', '--help']);
    const solutionInspectHelp = await runCli(['solution', 'inspect', '--help']);
    const solutionComponentsHelp = await runCli(['solution', 'components', '--help']);
    const solutionDependenciesHelp = await runCli(['solution', 'dependencies', '--help']);
    const solutionPublishHelp = await runCli(['solution', 'publish', '--help']);
    const solutionSyncStatusHelp = await runCli(['solution', 'sync-status', '--help']);
    const rootHelp = await runCli(['--help']);
    const connrefHelp = await runCli(['connref', '--help']);
    const connrefCreateHelp = await runCli(['connref', 'create', '--help']);
    const connrefListHelp = await runCli(['connref', 'list', '--help']);
    const connrefSetHelp = await runCli(['connref', 'set', '--help']);
    const connrefValidateHelp = await runCli(['connref', 'validate', '--help']);
    const envvarHelp = await runCli(['envvar', '--help']);
    const envvarCreateHelp = await runCli(['envvar', 'create', '--help']);
    const envvarListHelp = await runCli(['envvar', 'list', '--help']);
    const envvarInspectHelp = await runCli(['envvar', 'inspect', '--help']);
    const envvarSetHelp = await runCli(['envvar', 'set', '--help']);

    expect(dvHelp.code).toBe(0);
    expect(dvHelp.stderr).toBe('');
    expect(dvHelp.stdout).toContain('Usage: dv <command> [options]');
    expect(dvHelp.stdout).toContain('whoami');
    expect(dvHelp.stdout).toContain('--format table|json|yaml|ndjson|markdown|raw');

    expect(dvMetadataHelp.code).toBe(0);
    expect(dvMetadataHelp.stderr).toBe('');
    expect(dvMetadataHelp.stdout).toContain('Usage: dv metadata <command> [options]');
    expect(dvMetadataHelp.stdout).toContain('create-relationship --file FILE');
    expect(dvMetadataHelp.stdout).toContain('entitySummary');
    expect(dvMetadataHelp.stdout).not.toContain('DV_METADATA_ACTION_REQUIRED');

    expect(whoAmIHelp.code).toBe(0);
    expect(whoAmIHelp.stderr).toBe('');
    expect(whoAmIHelp.stdout).toContain('Usage: dv whoami --environment ALIAS [--no-interactive-auth] [options]');
    expect(whoAmIHelp.stdout).toContain('pp dv whoami --environment dev --format json');
    expect(whoAmIHelp.stdout).toContain('pp dv whoami --environment dev --no-interactive-auth --format json');
    expect(whoAmIHelp.stdout).toContain('--no-interactive-auth');
    expect(whoAmIHelp.stdout).not.toContain('DV_ENV_REQUIRED');

    expect(solutionHelp.code).toBe(0);
    expect(solutionHelp.stderr).toBe('');
    expect(solutionHelp.stdout).toContain('Usage: solution <command> [options]');
    expect(solutionHelp.stdout).toContain('delete <uniqueName>         delete one solution from an environment');
    expect(solutionHelp.stdout).toContain('publishers                  list available solution publishers in an environment');
    expect(solutionHelp.stdout).toContain('sync-status <uniqueName>    inspect publish readback and export readiness for one solution');
    expect(solutionHelp.stdout).toContain('`pp solution pack ... --rebuild-canvas-apps` rebuilds those extracted CanvasApps/* folders back into sibling .msapp files before zipping the solution.');
    expect(solutionHelp.stdout).toContain('list');
    expect(solutionHelp.stdout).toContain('--format table|json|yaml|ndjson|markdown|raw');

    expect(solutionListHelp.code).toBe(0);
    expect(solutionListHelp.stderr).toBe('');
    expect(solutionListHelp.stdout).toContain('Usage: solution list --environment ALIAS [--no-interactive-auth] [options]');
    expect(solutionListHelp.stdout).toContain('pp solution list --environment dev --format json');
    expect(solutionListHelp.stdout).toContain('pp solution list --environment dev --no-interactive-auth --format json');
    expect(solutionListHelp.stdout).toContain('--prefix PREFIX');
    expect(solutionListHelp.stdout).toContain('--unique-name NAME');
    expect(solutionListHelp.stdout).toContain('--no-interactive-auth');
    expect(solutionListHelp.stdout).not.toContain('DV_ENV_REQUIRED');

    expect(solutionPublishersHelp.code).toBe(0);
    expect(solutionPublishersHelp.stderr).toBe('');
    expect(solutionPublishersHelp.stdout).toContain('Usage: solution publishers --environment ALIAS [--no-interactive-auth] [options]');
    expect(solutionPublishersHelp.stdout).toContain('pp solution publishers --environment dev --format json');
    expect(solutionPublishersHelp.stdout).toContain('pp solution create Core --environment dev --publisher-unique-name DefaultPublisher');
    expect(solutionPublishersHelp.stdout).toContain('--no-interactive-auth');
    expect(solutionPublishersHelp.stdout).not.toContain('DV_ENV_REQUIRED');

    expect(solutionInspectHelp.code).toBe(0);
    expect(solutionInspectHelp.stderr).toBe('');
    expect(solutionInspectHelp.stdout).toContain('Usage: solution inspect <uniqueName> --environment ALIAS [options]');
    expect(solutionInspectHelp.stdout).toContain('pp solution inspect Core --environment dev --format json');
    expect(solutionInspectHelp.stdout).toContain('--format table|json|yaml|ndjson|markdown|raw');
    expect(solutionInspectHelp.stdout).not.toContain('SOLUTION_UNIQUE_NAME_REQUIRED');

    expect(solutionComponentsHelp.code).toBe(0);
    expect(solutionComponentsHelp.stderr).toBe('');
    expect(solutionComponentsHelp.stdout).toContain('Usage: solution components <uniqueName> --environment ALIAS [options]');
    expect(solutionComponentsHelp.stdout).toContain('pp solution components Core --environment dev --format json');
    expect(solutionComponentsHelp.stdout).toContain('--format table|json|yaml|ndjson|markdown|raw');
    expect(solutionComponentsHelp.stdout).not.toContain('SOLUTION_UNIQUE_NAME_REQUIRED');

    expect(solutionDependenciesHelp.code).toBe(0);
    expect(solutionDependenciesHelp.stderr).toBe('');
    expect(solutionDependenciesHelp.stdout).toContain(
      'Usage: solution dependencies <uniqueName> --environment ALIAS [--no-interactive-auth] [options]'
    );
    expect(solutionDependenciesHelp.stdout).toContain('pp solution dependencies Core --environment dev --format json');
    expect(solutionDependenciesHelp.stdout).toContain('--no-interactive-auth');
    expect(solutionDependenciesHelp.stdout).toContain('--format table|json|yaml|ndjson|markdown|raw');
    expect(solutionDependenciesHelp.stdout).not.toContain('SOLUTION_UNIQUE_NAME_REQUIRED');

    expect(solutionPublishHelp.code).toBe(0);
    expect(solutionPublishHelp.stderr).toBe('');
    expect(solutionPublishHelp.stdout).toContain(
      'Usage: solution publish <uniqueName> --environment ALIAS [--wait-for-export] [--timeout-ms N] [--poll-interval-ms N] [--managed] [--out PATH] [--manifest FILE]'
    );
    expect(solutionPublishHelp.stdout).toContain('pp solution publish Core --environment dev --format json');
    expect(solutionPublishHelp.stdout).toContain('--wait-for-export');
    expect(solutionPublishHelp.stdout).toContain(
      'Successful `solution publish --format json` output includes a `progress` history plus `readBack` and `blockers` summaries'
    );
    expect(solutionPublishHelp.stdout).not.toContain('SOLUTION_PUBLISH_ARGS_REQUIRED');

    expect(solutionSyncStatusHelp.code).toBe(0);
    expect(solutionSyncStatusHelp.stderr).toBe('');
    expect(solutionSyncStatusHelp.stdout).toContain(
      'Usage: solution sync-status <uniqueName> --environment ALIAS [--skip-export-check] [--timeout-ms N] [--managed] [--out PATH] [--manifest FILE]'
    );
    expect(solutionSyncStatusHelp.stdout).toContain('pp solution sync-status Core --environment dev --format json');
    expect(solutionSyncStatusHelp.stdout).toContain('--skip-export-check');
    expect(solutionSyncStatusHelp.stdout).toContain('--timeout-ms N');
    expect(solutionSyncStatusHelp.stdout).not.toContain('SOLUTION_SYNC_STATUS_ARGS_REQUIRED');

    expect(rootHelp.code).toBe(0);
    expect(rootHelp.stderr).toBe('');
    expect(rootHelp.stdout).toContain('Top-level areas:');
    expect(rootHelp.stdout).toContain('Use `pp env --help` to browse alias lifecycle commands before choosing `env add`, `env inspect`, or bootstrap cleanup flows.');
    expect(rootHelp.stdout).toContain(
      '`auth profile add-env` means "read a token from an environment variable", not "register a Dataverse environment alias".'
    );
    expect(rootHelp.stdout).toContain('pp auth profile add-env --help');
    expect(rootHelp.stdout).toContain('pp env --help');
    expect(rootHelp.stdout).toContain('  model         inspect model-driven apps');
    expect(rootHelp.stdout).toContain('  connref       inspect, validate, and mutate connection references');
    expect(rootHelp.stdout).toContain('  envvar        inspect and mutate environment variables');
    expect(rootHelp.stdout).toContain('pp solution list --help');

    expect(connrefHelp.code).toBe(0);
    expect(connrefHelp.stderr).toBe('');
    expect(connrefHelp.stdout).toContain('Usage: connref <command> [options]');
    expect(connrefHelp.stdout).toContain('create <logicalName>');
    expect(connrefHelp.stdout).toContain('set <identifier>');
    expect(connrefHelp.stdout).toContain('--no-interactive-auth');

    expect(connrefCreateHelp.code).toBe(0);
    expect(connrefCreateHelp.stderr).toBe('');
    expect(connrefCreateHelp.stdout).toContain(
      'Usage: connref create <logicalName> --environment ALIAS --connection-id CONNECTION_ID [--display-name NAME] [--connector-id CONNECTOR_ID] [--custom-connector-id CONNECTOR_ID] [--solution UNIQUE_NAME] [--no-interactive-auth] [options]'
    );
    expect(connrefCreateHelp.stdout).not.toContain('CONNREF_CREATE_ARGS_REQUIRED');

    expect(connrefListHelp.code).toBe(0);
    expect(connrefListHelp.stderr).toBe('');
    expect(connrefListHelp.stdout).toContain(
      'Usage: connref list --environment ALIAS [--solution UNIQUE_NAME] [--no-interactive-auth] [options]'
    );
    expect(connrefListHelp.stdout).toContain('Fail fast with structured diagnostics instead of opening browser auth');
    expect(connrefListHelp.stdout).not.toContain('DV_ENV_REQUIRED');

    expect(connrefSetHelp.code).toBe(0);
    expect(connrefSetHelp.stderr).toBe('');
    expect(connrefSetHelp.stdout).toContain(
      'Usage: connref set <logicalName|displayName|id> --environment ALIAS --connection-id CONNECTION_ID [--solution UNIQUE_NAME] [--no-interactive-auth] [options]'
    );
    expect(connrefSetHelp.stdout).not.toContain('CONNREF_SET_ARGS_REQUIRED');

    expect(connrefValidateHelp.code).toBe(0);
    expect(connrefValidateHelp.stderr).toBe('');
    expect(connrefValidateHelp.stdout).toContain(
      'Usage: connref validate --environment ALIAS [--solution UNIQUE_NAME] [--no-interactive-auth] [options]'
    );
    expect(connrefValidateHelp.stdout).not.toContain('DV_ENV_REQUIRED');

    expect(envvarHelp.code).toBe(0);
    expect(envvarHelp.stderr).toBe('');
    expect(envvarHelp.stdout).toContain('Usage: envvar <command> [options]');
    expect(envvarHelp.stdout).toContain('inspect <identifier>');
    expect(envvarHelp.stdout).toContain('--no-interactive-auth');
    expect(envvarHelp.stdout).toContain('--format table|json|yaml|ndjson|markdown|raw');

    expect(envvarCreateHelp.code).toBe(0);
    expect(envvarCreateHelp.stderr).toBe('');
    expect(envvarCreateHelp.stdout).toContain(
      'Usage: envvar create <schemaName> --environment ALIAS [--display-name NAME] [--default-value VALUE] [--type string|number|boolean|json|data-source|secret] [--solution UNIQUE_NAME] [--no-interactive-auth] [options]'
    );
    expect(envvarCreateHelp.stdout).not.toContain('ENVVAR_SCHEMA_REQUIRED');

    expect(envvarListHelp.code).toBe(0);
    expect(envvarListHelp.stderr).toBe('');
    expect(envvarListHelp.stdout).toContain(
      'Usage: envvar list --environment ALIAS [--solution UNIQUE_NAME] [--no-interactive-auth] [options]'
    );
    expect(envvarListHelp.stdout).not.toContain('DV_ENV_REQUIRED');

    expect(envvarInspectHelp.code).toBe(0);
    expect(envvarInspectHelp.stderr).toBe('');
    expect(envvarInspectHelp.stdout).toContain(
      'Usage: envvar inspect <schemaName|displayName|id> --environment ALIAS [--solution UNIQUE_NAME] [--no-interactive-auth] [options]'
    );
    expect(envvarInspectHelp.stdout).toContain('stable ENVVAR_NOT_FOUND diagnostic');
    expect(envvarInspectHelp.stdout).not.toContain('ENVVAR_IDENTIFIER_REQUIRED');

    expect(envvarSetHelp.code).toBe(0);
    expect(envvarSetHelp.stderr).toBe('');
    expect(envvarSetHelp.stdout).toContain(
      'Usage: envvar set <schemaName|displayName|id> --environment ALIAS --value VALUE [--solution UNIQUE_NAME] [--no-interactive-auth] [options]'
    );
    expect(envvarSetHelp.stdout).not.toContain('ENVVAR_SET_ARGS_REQUIRED');
  });

  it('keeps help-discoverable format support aligned with runtime on harness-reported commands', async () => {
    const solutionFixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'solution', 'runtime', 'core-solution-envs.json')
    )) as SolutionFixtureEnvironments;
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

    mockDataverseResolution({
      source: createFixtureDataverseClient(solutionFixture.source),
    });

    const solutionHelp = await runCli(['solution', 'list', '--help']);
    const solutionList = await runCli(['solution', 'list', '--environment', 'source', '--format', 'json']);
    const authHelp = await runCli(['auth', 'profile', 'inspect', '--help']);
    const authInspect = await runCli(['auth', 'profile', 'inspect', 'fixture-user', '--config-dir', configDir, '--format', 'json']);

    expect(solutionHelp.code).toBe(0);
    expect(solutionHelp.stderr).toBe('');
    expect(solutionHelp.stdout).toContain('--format table|json|yaml|ndjson|markdown|raw');
    expect(solutionList.code).toBe(0);
    expect(solutionList.stderr).toBe('');
    expect(JSON.parse(solutionList.stdout)).toMatchObject({
      solutions: [
        expect.objectContaining({
          uniquename: 'Core',
        }),
      ],
    });

    expect(authHelp.code).toBe(0);
    expect(authHelp.stderr).toBe('');
    expect(authHelp.stdout).toContain('--format table|json|yaml|ndjson|markdown|raw');
    expect(authInspect.code).toBe(0);
    expect(authInspect.stderr).toBe('');
    expect(JSON.parse(authInspect.stdout)).toMatchObject({
      name: 'fixture-user',
      type: 'user',
      defaultResource: 'https://fixture.crm.dynamics.com',
    });
  });
});
