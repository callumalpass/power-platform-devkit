import { spawnSync } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJsonFile } from '@pp/artifacts';
import { AuthService } from '@pp/auth';
import type { DataverseClient } from '@pp/dataverse';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { chromium } from 'playwright-core';
import { type DataverseFixture, createFixtureDataverseClient, mockDataverseResolution } from '../../../test/dataverse-fixture';
import { expectGoldenJson, expectGoldenText, repoRoot, resolveRepoPath } from '../../../test/golden';
import { main } from './index';
import {
  cleanupTempDirs,
  createClassicButtonRegistry,
  createSolutionArchive,
  createTempDir,
  createZipPackage,
  normalizeCanvasTempRegistrySnapshot,
  normalizeCliSnapshot,
  normalizeImportedRegistryRoundTrip,
  normalizeNativeCanvasBuildSnapshot,
  normalizeNativeHeaderSnapshot,
  runCli,
  tempDirs,
  unzipCanvasPackage,
  writeNodeCommandFixture,
  writeSolutionExportMetadata,
  writeUnpackedCanvasFixture,
  type FlowRuntimeFixture,
  type SolutionFixtureEnvironments,
} from './integration-test-helpers';

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupTempDirs();
});

describe('cli fixture-backed workflows', () => {
  it('prints concise top-level help with concepts and next discovery steps', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write);

    const code = await main(['--help']);

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();

    expect(code).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Power Platform CLI for authenticated Dataverse access, solution lifecycle,');
    expect(stdout.join('')).toContain('auth profile        how pp gets credentials');
    expect(stdout.join('')).toContain('environment alias   named Dataverse target that points to a URL and auth profile');
    expect(stdout.join('')).toContain('Commands:');
    expect(stdout.join('')).toContain('  auth          manage auth profiles, browser profiles, login, and tokens');
    expect(stdout.join('')).toContain('  env           manage Dataverse environment aliases');
    expect(stdout.join('')).toContain('  solution      solution lifecycle');
    expect(stdout.join('')).toContain('  mcp           stdio MCP server for agent integration');
    expect(stdout.join('')).toContain('  diagnostics   installation and configuration diagnostics');
    expect(stdout.join('')).toContain('pp auth profile add-user --name work');
    expect(stdout.join('')).toContain('pp env add dev --url https://contoso.crm.dynamics.com --profile work');
    expect(stdout.join('')).toContain('pp dv whoami --env dev');
    expect(stdout.join('')).toContain('pp solution list --env dev');
    expect(stdout.join('')).toContain('pp.config.yaml');
  });

  it('prints version, completion, and diagnostics help as first-class product commands', async () => {
    const version = await runCli(['version', '--format', 'raw']);
    const completion = await runCli(['completion', 'bash']);
    const completionFish = await runCli(['completion', 'fish']);
    const completionPwsh = await runCli(['completion', 'pwsh']);
    const diagnosticsHelp = await runCli(['diagnostics', '--help']);

    expect(version.code).toBe(0);
    expect(version.stderr).toBe('');
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);

    expect(completion.code).toBe(0);
    expect(completion.stderr).toBe('');
    expect(completion.stdout).toContain('complete -F _pp_complete pp');
    expect(completion.stdout).toContain('diagnostics');
    expect(completion.stdout).toContain('mcp');
    expect(completion.stdout).toContain("'auth profile')");
    expect(completion.stdout).toContain('add-user');
    expect(completion.stdout).toContain('--environment');
    expect(completion.stdout).toContain('--kind');
    expect(completionFish.code).toBe(0);
    expect(completionFish.stderr).toBe('');
    expect(completionFish.stdout).toContain('function __pp_complete');
    expect(completionFish.stdout).toContain('case \'canvas patch\'');
    expect(completionPwsh.code).toBe(0);
    expect(completionPwsh.stderr).toBe('');
    expect(completionPwsh.stdout).toContain('Register-ArgumentCompleter -Native -CommandName pp');
    expect(completionPwsh.stdout).toContain("function Get-PpChildren");
    expect(completionPwsh.stdout).toContain("'canvas'");

    expect(diagnosticsHelp.code).toBe(0);
    expect(diagnosticsHelp.stderr).toBe('');
    expect(diagnosticsHelp.stdout).toContain('Usage: diagnostics <doctor|bundle> [path] [options]');
    expect(diagnosticsHelp.stdout).toContain('pp diagnostics bundle ./repo --format json > pp-diagnostics.json');
  });

  it('prints MCP help from the main CLI entrypoint', async () => {
    const mcpHelp = await runCli(['mcp', '--help']);
    const mcpServeHelp = await runCli(['mcp', 'serve', '--help']);

    expect(mcpHelp.code).toBe(0);
    expect(mcpHelp.stderr).toBe('');
    expect(mcpHelp.stdout).toContain('Usage: mcp <serve> [options]');
    expect(mcpHelp.stdout).toContain('pp mcp serve --project .');

    expect(mcpServeHelp.code).toBe(0);
    expect(mcpServeHelp.stderr).toBe('');
    expect(mcpServeHelp.stdout).toContain('Usage: mcp serve [--project path] [--config-dir path] [--allow-interactive-auth]');
    expect(mcpServeHelp.stdout).toContain('"command": "pp"');
    expect(mcpServeHelp.stdout).toContain('"args": ["mcp", "serve", "--project", "."]');
  });

  it('prints canvas-specific help with local and remote workflow guidance', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write);

    const code = await main(['canvas', '--help']);

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();

    expect(code).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('Usage: canvas <command> [options]');
    expect(stdout.join('')).toContain('Local canvas tooling:');
    expect(stdout.join('')).toContain('validate <path>');
    expect(stdout.join('')).toContain('build <path>');
    expect(stdout.join('')).toContain('pp canvas inspect ./apps/MyCanvas --mode strict');
    expect(stdout.join('')).toContain('pp canvas list --environment dev --solution Core');
  });

  it('routes nested help through the generic command dispatcher', async () => {
    const authAddUserHelp = await runCli(['auth', 'profile', 'add-user', '--help']);
    const environmentAliasHelp = await runCli(['environment', 'inspect', '--help']);

    expect(authAddUserHelp.code).toBe(0);
    expect(authAddUserHelp.stderr).toBe('');
    expect(authAddUserHelp.stdout).toContain('Usage: auth profile add-user --name NAME');

    expect(environmentAliasHelp.code).toBe(0);
    expect(environmentAliasHelp.stderr).toBe('');
    expect(environmentAliasHelp.stdout).toContain('Usage: env inspect <alias>');
  });

  it('prints stable help for remote canvas discovery commands', async () => {
    const listHelp = await runCli(['canvas', 'list', '--help']);
    const downloadHelp = await runCli(['canvas', 'download', '--help']);
    const inspectHelp = await runCli(['canvas', 'inspect', '--help']);
    const probeHelp = await runCli(['canvas', 'probe', '--help']);

    expect(listHelp.code).toBe(0);
    expect(listHelp.stderr).toBe('');
    expect(listHelp.stdout).toContain('Usage: canvas list --environment ALIAS [--solution UNIQUE_NAME] [options]');
    expect(listHelp.stdout).toContain('Lists remote canvas apps through Dataverse.');
    expect(listHelp.stdout).toContain('pp canvas list --environment dev --solution Core');

    expect(downloadHelp.code).toBe(0);
    expect(downloadHelp.stderr).toBe('');
    expect(downloadHelp.stdout).toContain(
      'Usage: canvas download <displayName|name|id> --environment ALIAS [--solution UNIQUE_NAME] [--out FILE] [--extract-to-directory DIR] [options]'
    );
    expect(downloadHelp.stdout).toContain('Exports the containing solution through Dataverse and extracts the matching CanvasApps/*.msapp entry.');
    expect(downloadHelp.stdout).toContain('auto-resolves it when the app belongs to exactly one solution');
    expect(downloadHelp.stdout).toContain('converting archive backslashes into portable folder separators');
    expect(downloadHelp.stdout).toContain('round-trip handoff details for rebuild/repack and Dataverse table metadata lookup');
    expect(downloadHelp.stdout).toContain('pp canvas download "Harness Canvas" --environment dev');
    expect(downloadHelp.stdout).toContain('pp canvas download "Harness Canvas" --environment dev --solution Core');

    expect(inspectHelp.code).toBe(0);
    expect(inspectHelp.stderr).toBe('');
    expect(inspectHelp.stdout).toContain('Usage: canvas inspect <path|displayName|name|id> [--environment ALIAS] [--solution UNIQUE_NAME] [options]');
    expect(inspectHelp.stdout).toContain('With `--environment`, inspects a remote canvas app by display name, logical name, or id.');
    expect(inspectHelp.stdout).toContain('portal provenance plus a runtime handoff block with the play URL, expected hosts, and browser-profile bootstrap guidance');
    expect(inspectHelp.stdout).toContain('includes a ready-to-run `pp canvas probe ...` command');
    expect(inspectHelp.stdout).toContain('pp canvas inspect "Harness Canvas" --environment dev --solution Core');

    expect(probeHelp.code).toBe(0);
    expect(probeHelp.stderr).toBe('');
    expect(probeHelp.stdout).toContain('Usage: canvas probe <displayName|name|id> --environment ALIAS [--solution UNIQUE_NAME] [options]');
    expect(probeHelp.stdout).toContain('opens its play URL in a persisted browser profile');
    expect(probeHelp.stdout).toContain('observed final URL, title, host, frames, and browser-profile launch details');
    expect(probeHelp.stdout).toContain('--artifacts-dir DIR');
  });

  it('prints stable help for Dataverse row workflows', async () => {
    const rowsHelp = await runCli(['dv', 'rows', '--help']);
    const exportHelp = await runCli(['dv', 'rows', 'export', '--help']);
    const applyHelp = await runCli(['dv', 'rows', 'apply', '--help']);
    const createHelp = await runCli(['dv', 'create', '--help']);

    expect(rowsHelp.code).toBe(0);
    expect(rowsHelp.stderr).toBe('');
    expect(rowsHelp.stdout).toContain('Usage: dv rows <command> [options]');
    expect(rowsHelp.stdout).toContain('export <table>');
    expect(rowsHelp.stdout).toContain('apply');

    expect(exportHelp.code).toBe(0);
    expect(exportHelp.stderr).toBe('');
    expect(exportHelp.stdout).toContain('Usage: dv rows export <table> --environment ALIAS [options]');
    expect(exportHelp.stdout).toContain('stable row-set artifact');
    expect(exportHelp.stdout).toContain('--out ./accounts.yaml');

    expect(applyHelp.code).toBe(0);
    expect(applyHelp.stderr).toBe('');
    expect(applyHelp.stdout).toContain('Usage: dv rows apply --file FILE --environment ALIAS [options]');
    expect(applyHelp.stdout).toContain('Supports `create`, `update`, `upsert`, and `delete` operations.');
    expect(applyHelp.stdout).toContain('--continue-on-error --solution Core');

    expect(createHelp.code).toBe(0);
    expect(createHelp.stderr).toBe('');
    expect(createHelp.stdout).toContain('Usage: dv create <table> --environment ALIAS (--body JSON | --body-file FILE) [options]');
    expect(createHelp.stdout).toContain('Date-only columns expect `YYYY-MM-DD` strings');
    expect(createHelp.stdout).toContain('Lookup binds use the navigation-property schema name');
    expect(createHelp.stdout).toContain('pp dv create pph34135_tasks --environment test');
  });

  it('exports Dataverse rows to a structured artifact and applies typed row manifests', async () => {
    const tempDir = await createTempDir();
    const exportPath = join(tempDir, 'accounts.yaml');
    const applyPath = join(tempDir, 'accounts-apply.yaml');

    mockDataverseResolution({
      dev: {
        exportRows: async () =>
          ok(
            {
              kind: 'dataverse-row-set',
              version: 1,
              table: 'accounts',
              exportedAt: '2026-03-10T12:00:00.000Z',
              environmentUrl: 'https://dev.example.crm.dynamics.com',
              query: {
                all: true,
                select: ['accountid', 'name'],
              },
              recordCount: 1,
              records: [{ accountid: 'acc-1', name: 'Acme' }],
            },
            {
              supportTier: 'preview',
            }
          ),
        applyRows: async () =>
          ok(
            [
              {
                index: 0,
                kind: 'create',
                table: 'accounts',
                path: 'accounts',
                status: 201,
                headers: {},
                contentId: 'create-1',
                entityId: 'acc-1',
              },
            ],
            {
              supportTier: 'preview',
            }
          ),
      } as unknown as DataverseClient,
    });

    const exportResult = await runCli([
      'dv',
      'rows',
      'export',
      'accounts',
      '--environment',
      'dev',
      '--select',
      'accountid,name',
      '--all',
      '--out',
      exportPath,
    ]);

    expect(exportResult.code).toBe(0);
    expect(exportResult.stderr).toBe('');
    expect(JSON.parse(exportResult.stdout)).toEqual({
      outPath: exportPath,
      table: 'accounts',
      recordCount: 1,
    });
    expect(await readFile(exportPath, 'utf8')).toContain('kind: dataverse-row-set');
    expect(await readFile(exportPath, 'utf8')).toContain('recordCount: 1');

    await writeFile(
      applyPath,
      [
        'table: accounts',
        'operations:',
        '  - kind: create',
        '    requestId: create-1',
        '    body:',
        '      name: Acme',
        '',
      ].join('\n'),
      'utf8'
    );

    const applyResult = await runCli(['dv', 'rows', 'apply', '--environment', 'dev', '--file', applyPath]);

    expect(applyResult.code).toBe(0);
    expect(applyResult.stderr).toBe('');
    expect(JSON.parse(applyResult.stdout)).toEqual({
      table: 'accounts',
      operationCount: 1,
      operations: [
        {
          index: 0,
          kind: 'create',
          table: 'accounts',
          path: 'accounts',
          status: 201,
          headers: {},
          contentId: 'create-1',
          entityId: 'acc-1',
        },
      ],
    });
  });

  it('prints stable help for solution mutation commands without validating arguments', async () => {
    const createHelp = await runCli(['solution', 'create', '--help']);
    const setMetadataHelp = await runCli(['solution', 'set-metadata', '--help']);
    const checkpointHelp = await runCli(['solution', 'checkpoint', '--help']);

    expect(createHelp.code).toBe(0);
    expect(createHelp.stderr).toBe('');
    expect(createHelp.stdout).toContain(
      'Usage: solution create <uniqueName> --environment ALIAS [--friendly-name NAME] [--version X.Y.Z.W] [--description TEXT] [--publisher-id GUID | --publisher-unique-name NAME]'
    );
    expect(createHelp.stdout).toContain('`--help` only prints this text and never validates the solution name or environment flags.');
    expect(createHelp.stdout).not.toContain('SOLUTION_CREATE_ARGS_REQUIRED');

    expect(setMetadataHelp.code).toBe(0);
    expect(setMetadataHelp.stderr).toBe('');
    expect(setMetadataHelp.stdout).toContain(
      'Usage: solution set-metadata <uniqueName> --environment ALIAS [--version X.Y.Z.W] [--publisher-id GUID | --publisher-unique-name NAME]'
    );
    expect(setMetadataHelp.stdout).toContain('Requires at least one of `--version`, `--publisher-id`, or `--publisher-unique-name`.');
    expect(setMetadataHelp.stdout).not.toContain('SOLUTION_SET_METADATA_ARGS_REQUIRED');

    expect(checkpointHelp.code).toBe(0);
    expect(checkpointHelp.stderr).toBe('');
    expect(checkpointHelp.stdout).toContain(
      'Usage: solution checkpoint <uniqueName> --environment ALIAS [--out PATH] [--managed] [--manifest FILE] [--checkpoint FILE]'
    );
    expect(checkpointHelp.stdout).toContain('Captures a rollback-oriented solution checkpoint in one command');
    expect(checkpointHelp.stdout).not.toContain('SOLUTION_CHECKPOINT_ARGS_REQUIRED');
  });

  it('runs through the repo wrapper without nested pnpm banners in stdout', async () => {
    const result = spawnSync(process.execPath, ['scripts/run-pp-dev.mjs', 'env', 'inspect', 'test', '--format', 'json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        INIT_CWD: repoRoot,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.startsWith('{')).toBe(true);
    expect(result.stdout).not.toContain('ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL');
    expect(result.stdout).not.toContain('@pp/cli@0.1.0 dev');
    expect(JSON.parse(result.stdout)).toMatchObject({
      alias: 'test',
      authProfile: 'test-user',
    });
  });

  it('creates an environment variable definition through the first-class CLI surface', async () => {
    mockDataverseResolution({
      fixture: createFixtureDataverseClient({
        queryAll: {
          environmentvariabledefinitions: [],
          environmentvariablevalues: [],
        },
      }),
    });

    const result = await runCli(
      [
        'envvar',
        'create',
        'pp_ApiUrl',
        '--env',
        'fixture',
        '--solution',
        'Core',
        '--display-name',
        'API URL',
        '--default-value',
        'https://default.example.test',
        '--format',
        'json',
      ]
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaName: 'pp_ApiUrl',
      displayName: 'API URL',
      defaultValue: 'https://default.example.test',
      effectiveValue: 'https://default.example.test',
      hasCurrentValue: false,
    });
  });

  it('covers real CLI protocol outputs for representative success paths', async () => {
    const solutionFixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'solution', 'runtime', 'core-solution-envs.json')
    )) as SolutionFixtureEnvironments;
    const flowRuntimeFixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'flow', 'runtime', 'invoice-sync-runtime.json')
    )) as FlowRuntimeFixture;

    mockDataverseResolution({
      source: createFixtureDataverseClient(solutionFixture.source),
      fixture: createFixtureDataverseClient(flowRuntimeFixture),
    });

    const solutionList = await runCli(['solution', 'list', '--env', 'source', '--format', 'table']);
    const solutionAnalyze = await runCli(['solution', 'analyze', 'Core', '--env', 'source', '--format', 'yaml']);
    const flowList = await runCli(['flow', 'list', '--env', 'fixture', '--solution', 'Core', '--format', 'ndjson']);

    expect(solutionList.code).toBe(0);
    expect(solutionList.stderr).toBe('');
    expect(solutionAnalyze.code).toBe(0);
    expect(solutionAnalyze.stderr).toBe('');
    expect(flowList.code).toBe(0);
    expect(flowList.stderr).toBe('');

    await expectGoldenText(solutionList.stdout, 'fixtures/cli/golden/protocol/solution-list.table.txt');
    await expectGoldenText(solutionAnalyze.stdout, 'fixtures/cli/golden/protocol/solution-analyze.yaml');
    await expectGoldenText(flowList.stdout, 'fixtures/cli/golden/protocol/flow-list.ndjson');
  });

  it('covers remote canvas list and inspect through the CLI entrypoint', async () => {
    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'sol-1',
                uniquename: 'Core',
              },
            ],
          },
          queryAll: {
            solutioncomponents: [
              {
                solutioncomponentid: 'comp-1',
                objectid: 'canvas-1',
                componenttype: 300,
              },
            ],
            canvasapps: [
              {
                canvasappid: 'canvas-2',
                displayname: 'Other Canvas',
                name: 'crd_OtherCanvas',
                tags: 'other',
              },
              {
                canvasappid: 'canvas-1',
                displayname: 'Harness Canvas',
                name: 'crd_HarnessCanvas',
                appopenuri: 'https://apps.powerapps.com/play/e/env-123/a/canvas-1?tenantId=tenant-1&hint=user-1',
                appversion: '1.2.3.4',
                createdbyclientversion: '3.25000.1',
                lastpublishtime: '2026-03-10T04:50:00.000Z',
                status: 'Published',
                tags: 'harness;solution',
              },
            ],
          },
        }),
        environment: {
          makerEnvironmentId: 'env-123',
        },
        authProfile: {
          name: 'fixture-user',
          type: 'user',
          defaultResource: 'https://fixture.crm.dynamics.com',
          browserProfile: 'fixture-browser',
        },
      },
    });

    const list = await runCli(['canvas', 'list', '--env', 'fixture', '--solution', 'Core', '--format', 'json']);
    const inspect = await runCli(['canvas', 'inspect', 'Harness Canvas', '--env', 'fixture', '--solution', 'Core', '--format', 'json']);

    expect(list.code).toBe(0);
    expect(list.stderr).toBe('');
    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    await expectGoldenJson(JSON.parse(list.stdout), 'fixtures/cli/golden/protocol/canvas-remote-list.json');
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      portalProvenance: {
        appOpenUri: 'https://apps.powerapps.com/play/e/env-123/a/canvas-1?tenantId=tenant-1&hint=user-1',
        makerEnvironmentId: 'env-123',
        makerStudioUrl:
          'https://make.powerapps.com/e/env-123/canvas/?action=edit&app-id=%2Fproviders%2FMicrosoft.PowerApps%2Fapps%2Fcanvas-1&tenantId=tenant-1&hint=user-1',
      },
      handoff: {
        makerStudio: {
          recommendedUrl:
            'https://make.powerapps.com/e/env-123/canvas/?action=edit&app-id=%2Fproviders%2FMicrosoft.PowerApps%2Fapps%2Fcanvas-1&tenantId=tenant-1&hint=user-1',
        },
        runtime: {
          playUrl: 'https://apps.powerapps.com/play/e/env-123/a/canvas-1?tenantId=tenant-1&hint=user-1',
          browserProfile: 'fixture-browser',
          bootstrapCommand:
            'pp auth browser-profile bootstrap fixture-browser --url "https://apps.powerapps.com/play/e/env-123/a/canvas-1?tenantId=tenant-1&hint=user-1" --no-wait',
          probeCommand:
            'pp canvas probe "Harness Canvas" --environment fixture --solution Core --browser-profile fixture-browser --format json',
          expectedHosts: {
            runtime: 'apps.powerapps.com',
            authRedirect: 'login.microsoftonline.com',
            makerStudio: 'make.powerapps.com',
          },
        },
      },
    });
    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/cli/golden/protocol/canvas-remote-inspect.json');
  });

  it('probes a remote canvas runtime handoff through a persisted browser profile', async () => {
    const configDir = await createTempDir();
    const artifactsDir = await createTempDir();
    const profileDir = await createTempDir();
    vi.spyOn(AuthService.prototype, 'getBrowserProfile').mockResolvedValue(
      ok({
        name: 'fixture-browser',
        kind: 'edge',
        directory: profileDir,
      })
    );

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue(
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=51f81489-12ee-4a9e-aaae-a2591f45987d'
      ),
      title: vi.fn().mockResolvedValue('Sign in to your account'),
      frames: vi.fn().mockReturnValue([
        {
          name: () => 'login',
          url: () => 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        },
      ]),
      screenshot: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(chromium, 'launchPersistentContext').mockResolvedValue({
      pages: () => [page],
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'Core',
              },
            ],
          },
          queryAll: {
            solutioncomponents: [
              {
                solutioncomponentid: 'comp-1',
                objectid: 'canvas-1',
                componenttype: 300,
              },
            ],
            canvasapps: [
              {
                canvasappid: 'canvas-1',
                displayname: 'Harness Canvas',
                name: 'crd_HarnessCanvas',
                appopenuri: 'https://apps.powerapps.com/play/e/env-123/a/canvas-1?tenantId=tenant-1&hint=user-1',
                appversion: '1.2.3.4',
                createdbyclientversion: '3.25000.1',
                lastpublishtime: '2026-03-10T04:50:00.000Z',
                status: 'Published',
                tags: 'harness;solution',
              },
            ],
          },
        }),
        environment: {
          makerEnvironmentId: 'env-123',
        },
        authProfile: {
          name: 'fixture-user',
          type: 'user',
          defaultResource: 'https://fixture.crm.dynamics.com',
          browserProfile: 'fixture-browser',
        },
      },
    });

    const probe = await runCli([
      'canvas',
      'probe',
      'Harness Canvas',
      '--environment',
      'fixture',
      '--solution',
      'Core',
      '--config-dir',
      configDir,
      '--artifacts-dir',
      artifactsDir,
      '--format',
      'json',
    ]);

    expect(probe.code).toBe(0);
    expect(probe.stderr).toBe('');
    expect(JSON.parse(probe.stdout)).toMatchObject({
      handoff: {
        runtime: {
          probeCommand:
            'pp canvas probe "Harness Canvas" --environment fixture --solution Core --browser-profile fixture-browser --format json',
        },
      },
      runtimeProbe: {
        requestedUrl: 'https://apps.powerapps.com/play/e/env-123/a/canvas-1?tenantId=tenant-1&hint=user-1',
        finalHost: 'login.microsoftonline.com',
        title: 'Sign in to your account',
        landingKind: 'auth-redirect',
        matchedExpectedHost: true,
        browserLaunch: {
          profileName: 'fixture-browser',
          requestedUserDataDir: profileDir,
          effectiveUserDataDir: profileDir,
        },
        artifacts: {
          screenshotPath: join(artifactsDir, 'harness-canvas.runtime-probe.png'),
          sessionPath: join(artifactsDir, 'harness-canvas.runtime-probe.json'),
        },
      },
    });
  });

  it('covers remote access inspection for canvas apps, flows, and model-driven apps', async () => {
    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'Core',
              },
            ],
          },
          queryAll: {
            canvasapps: [
              {
                canvasappid: 'canvas-1',
                displayname: 'Harness Canvas',
                name: 'crd_HarnessCanvas',
                _ownerid_value: 'user-1',
                '_ownerid_value@OData.Community.Display.V1.FormattedValue': 'Callum Alpass',
                '_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname': 'systemuser',
                _createdby_value: 'user-1',
                '_createdby_value@OData.Community.Display.V1.FormattedValue': 'Callum Alpass',
                '_createdby_value@Microsoft.Dynamics.CRM.lookuplogicalname': 'systemuser',
              },
            ],
            workflows: [
              {
                workflowid: 'flow-1',
                name: 'Invoice Sync',
                uniquename: 'crd_InvoiceSync',
                category: 5,
                _ownerid_value: 'system-user',
                '_ownerid_value@OData.Community.Display.V1.FormattedValue': 'SYSTEM',
                '_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname': 'systemuser',
                _createdby_value: 'maker-1',
                '_createdby_value@OData.Community.Display.V1.FormattedValue': 'Maker User',
                '_createdby_value@Microsoft.Dynamics.CRM.lookuplogicalname': 'systemuser',
              },
            ],
            appmodules: [
              {
                appmoduleid: 'model-1',
                name: 'Solution Health Hub',
                uniquename: 'msdyn_SolutionHealthHub',
              },
            ],
            principalobjectaccessset: [
              {
                principalobjectaccessid: 'poa-1',
                objectid: 'flow-1',
                _principalid_value: 'team-1',
                '_principalid_value@OData.Community.Display.V1.FormattedValue': 'Automation Owners',
                '_principalid_value@Microsoft.Dynamics.CRM.lookuplogicalname': 'team',
                principaltypecode: 9,
                accessrightsmask: 1,
                inheritedaccessrightsmask: 0,
                changedon: '2026-03-10T05:00:00.000Z',
              },
            ],
          },
        }),
        environment: {
          makerEnvironmentId: 'env-123',
        },
      },
    });

    const canvas = await runCli(['canvas', 'access', 'Harness Canvas', '--env', 'fixture', '--format', 'json']);
    const flow = await runCli(['flow', 'access', 'Invoice Sync', '--env', 'fixture', '--format', 'json']);
    const model = await runCli([
      'model',
      'access',
      'Solution Health Hub',
      '--env',
      'fixture',
      '--solution',
      'Core',
      '--format',
      'json',
    ]);

    expect(canvas.code).toBe(0);
    expect(canvas.stderr).toBe('');
    expect(JSON.parse(canvas.stdout)).toMatchObject({
      kind: 'canvas',
      ownership: {
        scope: 'principal',
        owner: {
          id: 'user-1',
          name: 'Callum Alpass',
        },
      },
      sharing: {
        explicitShareCount: 0,
      },
    });

    expect(flow.code).toBe(0);
    expect(flow.stderr).toBe('');
    expect(JSON.parse(flow.stdout)).toMatchObject({
      kind: 'flow',
      ownership: {
        owner: {
          id: 'system-user',
          name: 'SYSTEM',
        },
        createdBy: {
          id: 'maker-1',
          name: 'Maker User',
        },
      },
      sharing: {
        explicitShareCount: 1,
        explicitShares: [
          {
            principal: {
              id: 'team-1',
              name: 'Automation Owners',
              entityType: 'team',
            },
          },
        ],
      },
    });

    expect(model.code).toBe(0);
    expect(model.stderr).toBe('');
    expect(JSON.parse(model.stdout)).toMatchObject({
      kind: 'model',
      portalProvenance: {
        makerEnvironmentId: 'env-123',
        solutionUniqueName: 'Core',
        solutionAppsUrl: 'https://make.powerapps.com/environments/env-123/solutions/solution-1/apps',
      },
      ownership: {
        scope: 'organization',
        owner: null,
      },
      sharing: {
        explicitShareCount: 0,
      },
    });
  });

  it('adds Maker handoff metadata to model inspect, create, and attach output', async () => {
    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'Core',
              },
            ],
          },
          queryAll: {
            appmodules: [
              {
                appmoduleid: 'model-1',
                name: 'Solution Health Hub',
                uniquename: 'msdyn_SolutionHealthHub',
              },
            ],
            solutioncomponents: [
              {
                objectid: 'model-1',
                componenttype: 80,
                _solutionid_value: 'solution-1',
              },
            ],
          },
        }),
        environment: {
          makerEnvironmentId: 'env-123',
        },
      },
    });

    const inspect = await runCli(['model', 'inspect', 'Solution Health Hub', '--env', 'fixture', '--solution', 'Core', '--format', 'json']);
    const create = await runCli([
      'model',
      'create',
      'HarnessModel',
      '--env',
      'fixture',
      '--solution',
      'Core',
      '--name',
      'Harness Model',
      '--format',
      'json',
    ]);
    const attach = await runCli([
      'model',
      'attach',
      'Solution Health Hub',
      '--env',
      'fixture',
      '--solution',
      'Core',
      '--format',
      'json',
    ]);

    expect(inspect.code).toBe(0);
    expect(create.code).toBe(0);
    expect(attach.code).toBe(0);

    expect(JSON.parse(inspect.stdout)).toMatchObject({
      app: {
        id: 'model-1',
        portalProvenance: {
          makerEnvironmentId: 'env-123',
          solutionUniqueName: 'Core',
          solutionAppsUrl: 'https://make.powerapps.com/environments/env-123/solutions/solution-1/apps',
        },
        handoff: {
          makerSolutionApps: {
            recommendedUrl: 'https://make.powerapps.com/environments/env-123/solutions/solution-1/apps',
          },
        },
      },
    });

    expect(JSON.parse(create.stdout)).toMatchObject({
      id: 'fixture-appmodules-2',
      portalProvenance: {
        makerEnvironmentId: 'env-123',
        solutionUniqueName: 'Core',
        solutionAppsUrl: 'https://make.powerapps.com/environments/env-123/solutions/solution-1/apps',
      },
    });

    expect(JSON.parse(attach.stdout)).toMatchObject({
      attached: true,
      app: {
        id: 'model-1',
        portalProvenance: {
          makerEnvironmentId: 'env-123',
          solutionUniqueName: 'Core',
          solutionAppsUrl: 'https://make.powerapps.com/environments/env-123/solutions/solution-1/apps',
        },
      },
    });
  });

  it('returns remote canvas proof results for expected deployed bindings', async () => {
    const tempDir = await createTempDir();
    const msappSourceDir = join(tempDir, 'msapp-source');
    await mkdir(join(msappSourceDir, 'Src'), { recursive: true });
    await mkdir(join(msappSourceDir, 'References'), { recursive: true });
    await writeFile(join(msappSourceDir, 'Src', 'App.pa.yaml'), 'App:\n  Properties:\n    Theme: =PowerAppsTheme\n', 'utf8');
    await writeFile(
      join(msappSourceDir, 'Src', 'Screen1.pa.yaml'),
      [
        'Screens:',
        '  Screen1:',
        '    Children:',
        '      - Gallery1:',
        '          Control: Gallery@2.15.0',
        '          Properties:',
        "            Items: ='PP Harness Projects'",
      ].join('\n') + '\n',
      'utf8'
    );
    await writeFile(
      join(msappSourceDir, 'References', 'DataSources.json'),
      JSON.stringify(
        {
          DataSources: [
            {
              Name: 'PP Harness Projects',
              Type: 'Table',
              DatasetName: 'default.cds',
              EntityName: 'pph34135_projects',
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const msappPath = join(tempDir, 'Harness Canvas.msapp');
    await createZipPackage(msappSourceDir, msappPath);

    const solutionDir = join(tempDir, 'solution');
    await mkdir(join(solutionDir, 'CanvasApps'), { recursive: true });
    await writeFile(join(solutionDir, 'CanvasApps', 'crd_HarnessCanvas.msapp'), await readFile(msappPath));
    await writeSolutionExportMetadata(solutionDir);
    const solutionZip = join(tempDir, 'Core.zip');
    await createZipPackage(solutionDir, solutionZip);

    const client = {
      ...createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
            },
          ],
        },
        queryAll: {
          solutioncomponents: [
            {
              solutioncomponentid: 'comp-1',
              objectid: 'canvas-1',
              componenttype: 300,
            },
          ],
          canvasapps: [
            {
              canvasappid: 'canvas-1',
              displayname: 'Harness Canvas',
              name: 'crd_HarnessCanvas',
              tags: 'harness;solution',
            },
          ],
        },
      }),
      invokeAction: async <T>(name: string) =>
        ok(
          {
            body: {
              ExportSolutionFile: name === 'ExportSolution' ? (await readFile(solutionZip)).toString('base64') : undefined,
            } as T,
          },
          {
            supportTier: 'preview',
          }
        ),
    } as unknown as DataverseClient;

    mockDataverseResolution({
      fixture: {
        client,
      },
    });

    const inspect = await runCli([
      'canvas',
      'inspect',
      'Harness Canvas',
      '--env',
      'fixture',
      '--solution',
      'Core',
      '--expect-control-property',
      "Screen1/Gallery1::Items::='PP Harness Projects'",
      '--format',
      'json',
    ]);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toContain('Proof expectations were evaluated from the exported remote canvas source tree');
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      id: 'canvas-1',
      displayName: 'Harness Canvas',
      proof: {
        valid: true,
        dataSources: ['PP Harness Projects'],
        expectations: [
          {
            controlPath: 'Screen1/Gallery1',
            property: 'Items',
            found: true,
            matched: true,
            actualValueText: "='PP Harness Projects'",
          },
        ],
      },
    });
  });

  it('downloads a remote canvas app through the CLI entrypoint without pac', async () => {
    const tempDir = await createTempDir();
    const sourceDir = join(tempDir, 'solution');
    await mkdir(join(sourceDir, 'CanvasApps'), { recursive: true });
    await writeFile(join(sourceDir, 'CanvasApps', 'crd_HarnessCanvas.msapp'), 'cli-exported-msapp', 'utf8');
    await writeSolutionExportMetadata(sourceDir);
    const solutionZip = join(tempDir, 'Core.zip');
    await createZipPackage(sourceDir, solutionZip);

    const client = {
      ...createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
              friendlyname: 'Core',
              version: '1.0.0.0',
            },
          ],
        },
        queryAll: {
          solutioncomponents: [
            {
              solutioncomponentid: 'comp-1',
              objectid: 'canvas-1',
              componenttype: 300,
            },
          ],
          canvasapps: [
            {
              canvasappid: 'canvas-1',
              displayname: 'Harness Canvas',
              name: 'crd_HarnessCanvas',
              tags: 'harness;solution',
            },
          ],
        },
      }),
      invokeAction: async <T>(name: string) =>
        ok(
          {
            body: {
              ExportSolutionFile: name === 'ExportSolution' ? (await readFile(solutionZip)).toString('base64') : undefined,
            } as T,
          },
          {
            supportTier: 'preview',
          }
        ),
    } as unknown as DataverseClient;

    mockDataverseResolution({
      fixture: {
        client,
      },
    });

    const outPath = join(tempDir, 'artifacts', 'HarnessCanvas.msapp');
    const result = await runCli([
      'canvas',
      'download',
      'Harness Canvas',
      '--env',
      'fixture',
      '--solution',
      'Core',
      '--out',
      outPath,
      '--format',
      'json',
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('[pp] canvas download: resolving remote app');
    expect(result.stderr).toContain('[pp] canvas download: exporting solution package');
    expect(result.stderr).toContain('[pp] canvas download: reading solution archive');
    expect(result.stderr).toContain('[pp] canvas download: writing .msapp artifact');
    expect(JSON.parse(result.stdout)).toMatchObject({
      solutionUniqueName: 'Core',
      outPath,
      exportedEntry: 'CanvasApps/crd_HarnessCanvas.msapp',
      availableEntries: ['CanvasApps/crd_HarnessCanvas.msapp'],
      app: {
        id: 'canvas-1',
        displayName: 'Harness Canvas',
      },
    });
    expect(await readFile(outPath, 'utf8')).toBe('cli-exported-msapp');
  });

  it('downloads and extracts a remote canvas app through the CLI entrypoint without pac', async () => {
    const tempDir = await createTempDir();
    const msappSourceDir = join(tempDir, 'msapp-source');
    await mkdir(msappSourceDir, { recursive: true });
    await writeFile(join(msappSourceDir, 'Header.json'), '{"schemaVersion":1}', 'utf8');
    await writeFile(join(msappSourceDir, 'Src\\App.pa.yaml'), 'App:\n', 'utf8');
    await writeFile(join(msappSourceDir, 'Controls\\1.json'), '{"Name":"App"}', 'utf8');
    await writeFile(
      join(msappSourceDir, 'References\\DataSources.json'),
      JSON.stringify(
        {
          DataSources: [
            {
              Name: 'Harness Projects',
              Type: 'Table',
              DatasetName: 'default.cds',
              EntityName: 'pp_project',
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const msappPath = join(tempDir, 'Harness Canvas.msapp');
    await createZipPackage(msappSourceDir, msappPath);

    const sourceDir = join(tempDir, 'solution');
    await mkdir(join(sourceDir, 'CanvasApps'), { recursive: true });
    await writeFile(join(sourceDir, 'CanvasApps', 'crd_HarnessCanvas.msapp'), await readFile(msappPath));
    await writeSolutionExportMetadata(sourceDir);
    const solutionZip = join(tempDir, 'Core.zip');
    await createZipPackage(sourceDir, solutionZip);

    const client = {
      ...createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
              friendlyname: 'Core',
              version: '1.0.0.0',
            },
          ],
        },
        queryAll: {
          solutioncomponents: [
            {
              solutioncomponentid: 'comp-1',
              objectid: 'canvas-1',
              componenttype: 300,
            },
          ],
          canvasapps: [
            {
              canvasappid: 'canvas-1',
              displayname: 'Harness Canvas',
              name: 'crd_HarnessCanvas',
              tags: 'harness;solution',
            },
          ],
        },
      }),
      invokeAction: async <T>(name: string) =>
        ok(
          {
            body: {
              ExportSolutionFile: name === 'ExportSolution' ? (await readFile(solutionZip)).toString('base64') : undefined,
            } as T,
          },
          {
            supportTier: 'preview',
          }
        ),
    } as unknown as DataverseClient;

    mockDataverseResolution({
      fixture: {
        client,
      },
    });

    const outPath = join(tempDir, 'artifacts', 'HarnessCanvas.msapp');
    const extractedPath = join(tempDir, 'artifacts', 'HarnessCanvas');
    const result = await runCli([
      'canvas',
      'download',
      'Harness Canvas',
      '--env',
      'fixture',
      '--solution',
      'Core',
      '--out',
      outPath,
      '--extract-to-directory',
      extractedPath,
      '--format',
      'json',
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('[pp] canvas download: resolving remote app');
    expect(result.stderr).toContain('[pp] canvas download: exporting solution package');
    expect(result.stderr).toContain('[pp] canvas download: reading solution archive');
    expect(result.stderr).toContain('[pp] canvas download: writing .msapp artifact');
    expect(result.stderr).toContain('[pp] canvas download: extracting editable source');
    expect(JSON.parse(result.stdout)).toMatchObject({
      solutionUniqueName: 'Core',
      outPath,
      extractedPath,
      extractedEntries: ['Controls/1.json', 'Header.json', 'References/DataSources.json', 'Src/App.pa.yaml'],
      app: {
        id: 'canvas-1',
        displayName: 'Harness Canvas',
      },
      handoff: {
        roundTrip: {
          extractedPath,
          buildCommand: `pp canvas build ${extractedPath} --out <rebuilt-msapp>`,
          packCommand: 'pp solution pack <unpacked-solution-dir> --rebuild-canvas-apps --out <solution.zip>',
        },
        dataSources: [
          {
            name: 'Harness Projects',
            datasetName: 'default.cds',
            entityName: 'pp_project',
            metadataCommand: 'pp dv metadata table pp_project --environment fixture --format json',
          },
        ],
      },
    });
    expect(await readFile(join(extractedPath, 'Src', 'App.pa.yaml'), 'utf8')).toBe('App:\n');
  });

  it('resolves relative canvas download output paths from INIT_CWD', async () => {
    const tempDir = await createTempDir();
    const invocationRoot = join(tempDir, 'invocation-root');
    const msappSourceDir = join(tempDir, 'msapp-source');
    await mkdir(invocationRoot, { recursive: true });
    await mkdir(msappSourceDir, { recursive: true });
    await writeFile(join(msappSourceDir, 'Header.json'), '{"schemaVersion":1}', 'utf8');

    const msappPath = join(tempDir, 'Harness Canvas.msapp');
    await createZipPackage(msappSourceDir, msappPath);

    const sourceDir = join(tempDir, 'solution');
    await mkdir(join(sourceDir, 'CanvasApps'), { recursive: true });
    await writeFile(join(sourceDir, 'CanvasApps', 'crd_HarnessCanvas.msapp'), await readFile(msappPath));
    await writeSolutionExportMetadata(sourceDir);
    const solutionZip = join(tempDir, 'Core.zip');
    await createZipPackage(sourceDir, solutionZip);

    const client = {
      ...createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
              friendlyname: 'Core',
              version: '1.0.0.0',
            },
          ],
        },
        queryAll: {
          solutioncomponents: [
            {
              solutioncomponentid: 'comp-1',
              objectid: 'canvas-1',
              componenttype: 300,
            },
          ],
          canvasapps: [
            {
              canvasappid: 'canvas-1',
              displayname: 'Harness Canvas',
              name: 'crd_HarnessCanvas',
              tags: 'harness;solution',
            },
          ],
        },
      }),
      invokeAction: async <T>(name: string) =>
        ok(
          {
            body: {
              ExportSolutionFile: name === 'ExportSolution' ? (await readFile(solutionZip)).toString('base64') : undefined,
            } as T,
          },
          {
            supportTier: 'preview',
          }
        ),
    } as unknown as DataverseClient;

    mockDataverseResolution({
      fixture: {
        client,
      },
    });

    const result = await runCli(
      ['canvas', 'download', 'Harness Canvas', '--env', 'fixture', '--solution', 'Core', '--out', './artifacts/HarnessCanvas.msapp', '--format', 'json'],
      {
        env: {
          INIT_CWD: invocationRoot,
        },
      }
    );

    const expectedOutPath = join(invocationRoot, 'artifacts', 'HarnessCanvas.msapp');
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('[pp] canvas download: resolving remote app');
    expect(result.stderr).toContain('[pp] canvas download: exporting solution package');
    expect(result.stderr).toContain('[pp] canvas download: reading solution archive');
    expect(result.stderr).toContain('[pp] canvas download: writing .msapp artifact');
    expect(JSON.parse(result.stdout)).toMatchObject({
      outPath: expectedOutPath,
    });
    await expect(access(expectedOutPath)).resolves.toBeUndefined();
  });

  it('imports a rebuilt remote canvas app through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const msappSourceDir = join(tempDir, 'msapp-source');
    const msappPath = join(tempDir, 'Harness Canvas.msapp');
    const sourceDir = join(tempDir, 'solution-export');
    const solutionZip = join(tempDir, 'HarnessSolution.zip');
    const importedZip = join(tempDir, 'imported.zip');
    const importRequests: Array<Record<string, unknown>> = [];

    await mkdir(msappSourceDir, { recursive: true });
    await writeFile(join(msappSourceDir, 'Header.json'), '{"schemaVersion":2}', 'utf8');
    await writeFile(join(msappSourceDir, 'Src\\App.pa.yaml'), 'App:\n  Properties:\n    Theme: =RGBA(255,0,0,1)\n', 'utf8');
    await createZipPackage(msappSourceDir, msappPath);

    await mkdir(join(sourceDir, 'CanvasApps'), { recursive: true });
    await writeFile(join(sourceDir, 'CanvasApps', 'crd_HarnessCanvas.msapp'), 'stale-remote-msapp', 'utf8');
    await writeFile(join(sourceDir, 'Other.xml'), '<ImportExportXml />', 'utf8');
    await writeSolutionExportMetadata(sourceDir, false);
    await createZipPackage(sourceDir, solutionZip);

    const fixtureClient: DataverseClient = {
      ...createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'solution-1',
              uniquename: 'HarnessSolution',
              friendlyname: 'Harness Solution',
              version: '1.0.0.0',
              ismanaged: false,
            },
          ],
        },
        queryAll: {
          canvasapps: [
            {
              canvasappid: 'canvas-1',
              displayname: 'Harness Canvas',
              name: 'crd_HarnessCanvas',
              appopenuri: 'https://make.powerapps.com/apps/canvas-1',
            },
          ],
          solutioncomponents: [
            {
              solutioncomponentid: 'component-1',
              objectid: 'canvas-1',
              componenttype: 300,
              _solutionid_value: 'solution-1',
            },
          ],
        },
      }),
      invokeAction: async (name: string, parameters: Record<string, unknown> = {}) => {
        if (name === 'ExportSolution') {
          return ok(
            {
              status: 200,
              headers: {},
              body: {
                ExportSolutionFile: (await readFile(solutionZip)).toString('base64'),
              },
            },
            {
              supportTier: 'preview',
            }
          );
        }

        if (name === 'ImportSolution') {
          importRequests.push(parameters);
          await writeFile(importedZip, Buffer.from(String(parameters.CustomizationFile), 'base64'));
          return ok(
            {
              status: 204,
              headers: {},
            },
            {
              supportTier: 'preview',
            }
          );
        }

        return ok(
          {
            status: 200,
            headers: {},
            body: {},
          },
          {
            supportTier: 'preview',
          }
        );
      },
    } as DataverseClient;

    mockDataverseResolution({
      fixture: {
        client: fixtureClient,
      },
    });

    const result = await runCli([
      'canvas',
      'import',
      msappPath,
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--target',
      'Harness Canvas',
      '--format',
      'json',
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('[pp] canvas import: resolving target app');
    expect(result.stderr).toContain('[pp] canvas import: exporting solution package');
    expect(result.stderr).toContain('[pp] canvas import: rebuilding solution package');
    expect(result.stderr).toContain('[pp] canvas import: importing solution package');
    expect(JSON.parse(result.stdout)).toMatchObject({
      solutionUniqueName: 'HarnessSolution',
      sourcePath: msappPath,
      importedEntry: 'CanvasApps/crd_HarnessCanvas.msapp',
      handoff: {
        verification: {
          inspectCommand: 'pp canvas inspect "Harness Canvas" --environment fixture --solution HarnessSolution',
        },
      },
    });
    expect(importRequests).toHaveLength(1);

    const importedDir = await unzipCanvasPackage(importedZip, tempDir);
    expect(await readFile(join(importedDir, 'CanvasApps', 'crd_HarnessCanvas.msapp'))).toEqual(await readFile(msappPath));
  });

  it('requires remote targeting inputs for canvas import', async () => {
    const missingImportPath = await runCli(['canvas', 'import', '--env', 'fixture', '--format', 'json']);
    const missingTarget = await runCli([
      'canvas',
      'import',
      './dist/Harness App.msapp',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--format',
      'json',
    ]);

    expect(missingImportPath.code).toBe(1);
    expect(JSON.parse(missingImportPath.stdout)).toMatchObject({
      success: false,
      diagnostics: [
        {
          code: 'CANVAS_IMPORT_ARGS_REQUIRED',
          message:
            'Usage: canvas import <file.msapp> --environment ALIAS --solution UNIQUE_NAME --target <displayName|name|id> [--overwrite-unmanaged-customizations] [--no-publish-workflows]',
        },
      ],
    });
    expect(missingImportPath.stderr).toBe('');

    expect(missingTarget.code).toBe(1);
    expect(JSON.parse(missingTarget.stdout)).toMatchObject({
      success: false,
      diagnostics: [
        {
          code: 'CANVAS_IMPORT_ARGS_REQUIRED',
        },
      ],
    });
    expect(missingTarget.stderr).toBe('');
  });

  it('covers canvas inspect, validate, build, and diff through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const baseAppPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'base-app');
    const changedAppPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'changed-app');
    const registryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'runtime-registry.json');
    const outPath = join(tempDir, 'FixtureCanvas.msapp');

    const inspect = await runCli(['canvas', 'inspect', baseAppPath, '--mode', 'strict', '--registry', registryPath, '--format', 'json']);
    const validate = await runCli(['canvas', 'validate', baseAppPath, '--mode', 'strict', '--registry', registryPath, '--format', 'json']);
    const lint = await runCli(['canvas', 'lint', baseAppPath, '--mode', 'strict', '--registry', registryPath, '--format', 'json']);
    const build = await runCli(['canvas', 'build', baseAppPath, '--mode', 'strict', '--registry', registryPath, '--out', outPath, '--format', 'json']);
    const diff = await runCli(['canvas', 'diff', baseAppPath, changedAppPath, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(validate.code).toBe(0);
    expect(validate.stderr).toBe('');
    expect(lint.code).toBe(0);
    expect(lint.stderr).toBe('');
    expect(build.code).toBe(0);
    expect(build.stderr).toBe('');
    expect(diff.code).toBe(0);
    expect(diff.stderr).toBe('');
    expect(JSON.stringify(JSON.parse(inspect.stdout).templateRequirements)).not.toContain('templateXml');
    expect(JSON.stringify(JSON.parse(validate.stdout).templateRequirements)).not.toContain('templateXml');

    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/canvas/golden/inspect-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(validate.stdout), 'fixtures/canvas/golden/validation-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(lint.stdout), 'fixtures/canvas/golden/lint-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(build.stdout), 'fixtures/canvas/golden/build-result.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(await readJsonFile(outPath), 'fixtures/canvas/golden/build-package.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(diff.stdout), 'fixtures/canvas/golden/diff-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
  });

  it('auto-loads embedded controls registries for unpacked apps and reports property-level native diffs through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const appPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'native-app');
    const changedAppPath = join(tempDir, 'native-app-diff');
    const outPath = join(tempDir, 'NativeCanvas.msapp');

    await cp(appPath, changedAppPath, { recursive: true });
    await writeFile(
      join(changedAppPath, 'Src', 'Screen1.pa.yaml'),
      [
        'Screens:',
        '  Screen1:',
        '    Children:',
        '      - Button1:',
        '          Control: Classic/Button@2.2.0',
        '          Properties:',
        '            Text: =\"Shipped\"',
        '            OnSelect: =Notify(\"Done\")',
        '            X: =90',
        '            Y: =120',
        '',
      ].join('\n'),
      'utf8'
    );

    const inspect = await runCli(['canvas', 'inspect', appPath, '--mode', 'strict', '--format', 'json']);
    const validate = await runCli(['canvas', 'validate', appPath, '--mode', 'strict', '--format', 'json']);
    const build = await runCli(['canvas', 'build', appPath, '--mode', 'strict', '--out', outPath, '--format', 'json']);
    const diff = await runCli(['canvas', 'diff', appPath, changedAppPath, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(JSON.parse(inspect.stdout).registries).toHaveLength(1);
    expect(JSON.parse(inspect.stdout).registries[0]?.path).toContain('/fixtures/canvas/apps/native-app/controls.json');

    expect(validate.code).toBe(0);
    expect(validate.stderr).toBe('');
    expect(JSON.parse(validate.stdout).valid).toBe(true);

    expect(build.code).toBe(0);
    expect(build.stderr).toBe('');

    expect(diff.code).toBe(0);
    expect(diff.stderr).toBe('');
    expect(JSON.parse(diff.stdout)).toEqual({
      left: appPath,
      right: changedAppPath,
      appChanged: true,
      screensAdded: [],
      screensRemoved: [],
      controls: [
        {
          controlPath: 'Screen1/Button1',
          kind: 'changed',
          changedProperties: ['properties.Text'],
        },
      ],
      templateChanges: {
        added: [],
        removed: [],
      },
    });
  });

  it('rebuilds extracted canvas apps during solution pack when requested', async () => {
    const tempDir = await createTempDir();
    const pacPath = await writeNodeCommandFixture(join(tempDir, 'fake-pac'), [
      "const { writeFileSync } = require('node:fs');",
      'const args = process.argv.slice(2);',
      "const zipfile = args[args.indexOf('--zipfile') + 1];",
      "if (args[1] === 'pack') writeFileSync(zipfile, 'cli-packed');",
    ]);
    const solutionDir = join(tempDir, 'solution');
    const packedPath = join(tempDir, 'Harness.zip');
    const canvasDir = await writeUnpackedCanvasFixture(join(solutionDir, 'CanvasApps'), {
      name: 'HarnessCanvas',
      screenYaml: [
        'Screens:',
        '  Screen1:',
        '    Children:',
        '      - Button1:',
        '          Control: Classic/Button@2.2.0',
        '          Properties:',
        '            Text: ="Ship it"',
        '            OnSelect: =Notify("Done")',
        '            Width: =120',
        '            Height: =40',
        '',
      ].join('\n'),
      registry: createClassicButtonRegistry(),
    });

    await writeFile(join(solutionDir, 'Other.xml'), '<ImportExportXml />', 'utf8');
    await writeFile(join(solutionDir, 'CanvasApps', 'HarnessCanvas.msapp'), 'stale-msapp', 'utf8');
    const packResult = await runCli([
      'solution',
      'pack',
      solutionDir,
      '--out',
      packedPath,
      '--rebuild-canvas-apps',
      '--pac',
      pacPath,
      '--format',
      'json',
    ]);

    expect(packResult.code).toBe(0);
    expect(packResult.stderr).toBe('');
    expect(await readFile(packedPath, 'utf8')).toBe('cli-packed');
    expect(await readFile(join(solutionDir, 'CanvasApps', 'HarnessCanvas.msapp'), 'utf8')).not.toBe('stale-msapp');
    expect(JSON.parse(packResult.stdout)).toMatchObject({
      artifact: {
        path: packedPath,
      },
      rebuiltCanvasApps: [
        {
          extractedPath: canvasDir,
          msappPath: join(solutionDir, 'CanvasApps', 'HarnessCanvas.msapp'),
          mode: 'strict',
          supported: true,
        },
      ],
    });
  });

  it('auto-loads exported References/Templates.json payloads for unpacked live-style apps', async () => {
    const tempDir = await createTempDir();
    const appPath = await writeUnpackedCanvasFixture(tempDir, {
      name: 'live-export-app',
      screenYaml: [
        'Screens:',
        '  Screen1:',
        '    Children:',
        '      - Button1:',
        '          Control: Classic/Button@2.2.0',
        '          Properties:',
        '            Text: ="Live"',
        '            OnSelect: =Notify("Done")',
        '            X: =90',
        '            Y: =120',
        '',
      ].join('\n'),
      registry: createClassicButtonRegistry(),
    });
    const outPath = join(tempDir, 'LiveCanvas.msapp');
    const templateXml = ((createClassicButtonRegistry().templates as Array<Record<string, any>>)[0]?.files?.['References/Templates.json'] as Record<
      string,
      unknown
    >)?.templateXml as string;

    await rm(join(appPath, 'controls.json'));
    await writeFile(
      join(appPath, 'References', 'Templates.json'),
      JSON.stringify(
        {
          UsedTemplates: [
            {
              Name: 'Button',
              Version: '2.2.0',
              Template: templateXml,
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const inspect = await runCli(['canvas', 'inspect', appPath, '--mode', 'strict', '--format', 'json']);
    const validate = await runCli(['canvas', 'validate', appPath, '--mode', 'strict', '--format', 'json']);
    const build = await runCli(['canvas', 'build', appPath, '--mode', 'strict', '--out', outPath, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(JSON.parse(inspect.stdout).registries).toEqual([
      expect.objectContaining({
        path: join(appPath, 'References', 'Templates.json'),
      }),
    ]);

    expect(validate.code).toBe(0);
    expect(validate.stderr).toBe('');
    expect(JSON.parse(validate.stdout)).toMatchObject({
      valid: true,
    });

    expect(build.code).toBe(0);
    expect(build.stderr).toBe('');
    expect(JSON.parse(build.stdout)).toMatchObject({
      outPath,
    });
  });

  it('resolves relative canvas build output paths from INIT_CWD', async () => {
    const tempDir = await createTempDir();
    const invocationRoot = join(tempDir, 'invocation-root');
    const appPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'native-app');
    await mkdir(join(invocationRoot, 'dist'), { recursive: true });

    const build = await runCli(['canvas', 'build', appPath, '--mode', 'strict', '--out', './dist/NativeCanvas.msapp', '--format', 'json'], {
      env: {
        INIT_CWD: invocationRoot,
      },
    });

    const expectedOutPath = join(invocationRoot, 'dist', 'NativeCanvas.msapp');
    expect(build.code).toBe(0);
    expect(build.stderr).toBe('');
    expect(JSON.parse(build.stdout)).toMatchObject({
      outPath: expectedOutPath,
    });
  });

  it('covers canvas template imports through the CLI entrypoint and preserves re-import semantics', async () => {
    const tempDir = await createTempDir();
    const sourcePath = resolveRepoPath('fixtures', 'canvas', 'registries', 'import-source.json');
    const normalizedPath = join(tempDir, 'normalized.json');
    const reimportedPath = join(tempDir, 'reimported.json');
    const importArgs = [
      '--out',
      normalizedPath,
      '--kind',
      'official-artifact',
      '--source',
      'canvas-import-fixture',
      '--acquired-at',
      '2026-03-10T00:00:00.000Z',
      '--format',
      'json',
    ];

    const imported = await runCli(['canvas', 'templates', 'import', sourcePath, ...importArgs]);

    expect(imported.code).toBe(0);
    expect(imported.stderr).toBe('');

    await expectGoldenJson(JSON.parse(imported.stdout), 'fixtures/cli/golden/protocol/canvas-template-import.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(await readJsonFile(normalizedPath), 'fixtures/cli/golden/protocol/canvas-template-import.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });

    const reimported = await runCli([
      'canvas',
      'templates',
      'import',
      normalizedPath,
      '--out',
      reimportedPath,
      '--kind',
      'official-artifact',
      '--source',
      'canvas-import-fixture',
      '--acquired-at',
      '2026-03-10T00:00:00.000Z',
      '--format',
      'json',
    ]);

    expect(reimported.code).toBe(0);
    expect(reimported.stderr).toBe('');
    expect(normalizeImportedRegistryRoundTrip(JSON.parse(reimported.stdout), tempDir)).toEqual(
      normalizeImportedRegistryRoundTrip(JSON.parse(imported.stdout), tempDir)
    );
    expect(normalizeImportedRegistryRoundTrip(await readJsonFile(reimportedPath), tempDir)).toEqual(
      normalizeImportedRegistryRoundTrip(await readJsonFile(normalizedPath), tempDir)
    );
  });

  it('covers canvas workspace, registry lifecycle, and patch workflows through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const workspacePath = join(tempDir, 'canvas.workspace.json');
    const patchPath = join(tempDir, 'canvas.patch.json');
    const registryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'runtime-registry.json');
    const importSourcePath = resolveRepoPath('fixtures', 'canvas', 'registries', 'import-source.json');
    const refreshedPath = join(tempDir, 'refreshed-registry.json');
    const pinnedPath = join(tempDir, 'pinned-registry.json');
    const appPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'base-app');
    const patchedOutPath = join(tempDir, 'patched-app');

    await writeFile(
      workspacePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          name: 'Fixture Workspace',
          catalogs: [
            {
              name: 'runtime',
              registries: [registryPath],
            },
          ],
          apps: [
            {
              name: 'fixture-base',
              path: appPath,
              catalogs: ['runtime'],
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );
    await writeFile(
      patchPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          operations: [
            {
              op: 'set-property',
              controlPath: 'Home/Layout/Title',
              property: 'TextFormula',
              value: '="Workspace patched"',
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const workspaceInspect = await runCli(['canvas', 'workspace', 'inspect', workspacePath, '--format', 'json']);
    const registryInspect = await runCli(['canvas', 'templates', 'inspect', registryPath, '--format', 'json']);
    const registryAudit = await runCli(['canvas', 'templates', 'audit', registryPath, '--format', 'json']);
    const registryPin = await runCli(['canvas', 'templates', 'pin', registryPath, '--out', pinnedPath, '--format', 'json']);
    const registryRefresh = await runCli([
      'canvas',
      'templates',
      'refresh',
      importSourcePath,
      '--current',
      registryPath,
      '--out',
      refreshedPath,
      '--source',
      'canvas-import-fixture',
      '--kind',
      'official-artifact',
      '--format',
      'json',
    ]);
    const patchPlan = await runCli([
      'canvas',
      'patch',
      'plan',
      'fixture-base',
      '--workspace',
      workspacePath,
      '--file',
      patchPath,
      '--format',
      'json',
    ]);
    const patchApply = await runCli([
      'canvas',
      'patch',
      'apply',
      'fixture-base',
      '--workspace',
      workspacePath,
      '--file',
      patchPath,
      '--out',
      patchedOutPath,
      '--format',
      'json',
    ]);

    expect(workspaceInspect.code).toBe(0);
    expect(registryInspect.code).toBe(0);
    expect(registryAudit.code).toBe(0);
    expect(registryPin.code).toBe(0);
    expect(registryRefresh.code).toBe(0);
    expect(patchPlan.code).toBe(0);
    expect(patchApply.code).toBe(0);

    expect(JSON.parse(workspaceInspect.stdout).apps[0].name).toBe('fixture-base');
    expect(JSON.parse(registryInspect.stdout).templateCount).toBeGreaterThan(0);
    expect(JSON.parse(registryAudit.stdout).templateCount).toBeGreaterThan(0);
    expect(JSON.parse(registryPin.stdout).outPath.replaceAll('\\', '/')).toContain('/pinned-registry.json');
    expect(JSON.parse(registryRefresh.stdout).diff.templates.added.length).toBeGreaterThan(0);
    expect(JSON.parse(patchPlan.stdout).valid).toBe(true);
    expect(JSON.parse(patchApply.stdout).outPath.replaceAll('\\', '/')).toContain('/patched-app');

    const patchedScreen = JSON.parse(await readFile(join(patchedOutPath, 'screens', 'Home.json'), 'utf8'));
    expect(patchedScreen.controls[0].children[0].properties.TextFormula).toBe('="Workspace patched"');
  });

  it('covers unpacked .pa.yaml canvas roots through inspect, validate, and native build', async () => {
    const tempDir = await createTempDir();
    const registry = createClassicButtonRegistry();
    const validAppPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'native-app');
    const validRegistryPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'native-app', 'controls.json');
    const outPath = join(tempDir, 'dist', 'NativeCanvas.msapp');

    const inspect = await runCli([
      'canvas',
      'inspect',
      validAppPath,
      '--mode',
      'strict',
      '--registry',
      validRegistryPath,
      '--format',
      'json',
    ]);
    const validate = await runCli([
      'canvas',
      'validate',
      validAppPath,
      '--mode',
      'strict',
      '--registry',
      validRegistryPath,
      '--format',
      'json',
    ]);
    const build = await runCli([
      'canvas',
      'build',
      validAppPath,
      '--mode',
      'strict',
      '--registry',
      validRegistryPath,
      '--out',
      outPath,
      '--format',
      'json',
    ]);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(validate.code).toBe(0);
    expect(validate.stderr).toBe('');
    expect(build.code).toBe(0);
    expect(build.stderr).toBe('');

    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/canvas/golden/native/inspect-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(validate.stdout), 'fixtures/canvas/golden/native/validation-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(build.stdout), 'fixtures/cli/golden/protocol/canvas-native-build.json', {
      normalize: (value) => normalizeNativeCanvasBuildSnapshot(value, tempDir),
    });

    const unzipDir = await unzipCanvasPackage(outPath, tempDir);
    await expectGoldenJson(JSON.parse(await readFile(join(unzipDir, 'References', 'Templates.json'), 'utf8')), 'fixtures/canvas/golden/native/package-templates.json');
    await expectGoldenJson(JSON.parse(await readFile(join(unzipDir, 'Controls', '4.json'), 'utf8')), 'fixtures/canvas/golden/native/package-screen-control.json');
    await expectGoldenJson(JSON.parse(await readFile(join(unzipDir, 'Header.json'), 'utf8')), 'fixtures/canvas/golden/native/package-header.json', {
      normalize: (value) => normalizeNativeHeaderSnapshot(value),
    });
    await expectGoldenText(await readFile(join(unzipDir, 'Src', '_EditorState.pa.yaml'), 'utf8'), 'fixtures/canvas/golden/native/package-editor-state.pa.yaml');

    const invalidAppPath = await writeUnpackedCanvasFixture(tempDir, {
      name: 'YamlCanvasInvalid',
      screenYaml: [
        'Screens:',
        '  Screen1:',
        '    Children:',
        '      - Button1:',
        '          Control: Classic/Button@2.2.0',
        '          Properties:',
        '            Text: ="Save"',
        '            InvalidThing: =1',
        '',
      ].join('\n'),
      registry,
    });
    const invalidRegistryPath = join(invalidAppPath, 'controls.json');
    const invalidValidate = await runCli([
      'canvas',
      'validate',
      invalidAppPath,
      '--mode',
      'strict',
      '--registry',
      invalidRegistryPath,
      '--format',
      'json',
    ]);

    expect(invalidValidate.code).toBe(1);

    const invalidReport = JSON.parse(invalidValidate.stdout) as {
      valid: boolean;
      propertyChecks?: Array<{ controlPath: string; property: string; valid: boolean; source?: string }>;
    };
    const invalidDiagnostics = JSON.parse(invalidValidate.stderr) as {
      diagnostics: Array<{ code: string }>;
    };

    expect(invalidReport.valid).toBe(false);
    expect(invalidReport.propertyChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          controlPath: 'Screen1/Button1',
          property: 'InvalidThing',
          valid: false,
          source: 'templateXml',
        }),
      ])
    );
    expect(invalidDiagnostics.diagnostics.some((diagnostic) => diagnostic.code === 'CANVAS_CONTROL_PROPERTY_INVALID')).toBe(true);
  });

  it('covers metadata-aware canvas lint diagnostics for unpacked .pa.yaml apps', async () => {
    const tempDir = await createTempDir();
    const appPath = await writeUnpackedCanvasFixture(tempDir, {
      name: 'YamlCanvasLint',
      screenYaml: [
        'Screens:',
        '  Screen1:',
        '    Children:',
        '      - Button1:',
        '          Control: Classic/Button@2.2.0',
        '          Properties:',
        '            Text: =Contacts.MissingField',
        '            OnSelect: =If(IsBlank(varSelectedAccount), "none", \'Account Category\'.MissingValue)',
        '            InvalidThing: =1',
        '      - Button2:',
        '          Control: Classic/Button@2.2.0',
        '          Properties:',
        '            Text: ="Ship it"',
        '            OnSelect: =Set(varX, 1); Notify("done")',
        '',
      ].join('\n'),
      registry: createClassicButtonRegistry(),
    });
    const registryPath = join(appPath, 'controls.json');

    const lint = await runCli([
      'canvas',
      'lint',
      appPath,
      '--mode',
      'strict',
      '--registry',
      registryPath,
      '--format',
      'json',
    ]);

    expect(lint.code).toBe(1);
    await expectGoldenJson(JSON.parse(lint.stdout), 'fixtures/canvas/golden/native/lint-invalid-report.json', {
      normalize: (value) => normalizeCanvasTempRegistrySnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(lint.stderr), 'fixtures/cli/golden/protocol/canvas-lint-diagnostics.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
  });

  it('covers formula-heavy canvas fixtures through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const appPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'formula-app');
    const registryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'runtime-registry.json');
    const outPath = join(tempDir, 'FormulaCanvas.msapp');

    const inspect = await runCli(['canvas', 'inspect', appPath, '--mode', 'strict', '--registry', registryPath, '--format', 'json']);
    const validate = await runCli(['canvas', 'validate', appPath, '--mode', 'strict', '--registry', registryPath, '--format', 'json']);
    const build = await runCli(['canvas', 'build', appPath, '--mode', 'strict', '--registry', registryPath, '--out', outPath, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(validate.code).toBe(0);
    expect(validate.stderr).toBe('');
    expect(build.code).toBe(0);
    expect(build.stderr).toBe('');

    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/canvas/golden/formula/inspect-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(validate.stdout), 'fixtures/canvas/golden/formula/validation-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(build.stdout), 'fixtures/canvas/golden/formula/build-result.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(await readJsonFile(outPath), 'fixtures/canvas/golden/formula/build-package.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
  });

  it('covers invalid canvas semantic diagnostics and build failures through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const appPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'diagnostic-app');
    const runtimeRegistryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'runtime-registry.json');
    const semanticRegistryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'semantic-registry.json');
    const outPath = join(tempDir, 'DiagnosticCanvas.msapp');

    const inspect = await runCli([
      'canvas',
      'inspect',
      appPath,
      '--mode',
      'strict',
      '--registry',
      runtimeRegistryPath,
      '--registry',
      semanticRegistryPath,
      '--format',
      'json',
    ]);
    const validate = await runCli([
      'canvas',
      'validate',
      appPath,
      '--mode',
      'strict',
      '--registry',
      runtimeRegistryPath,
      '--registry',
      semanticRegistryPath,
      '--format',
      'json',
    ]);
    const build = await runCli([
      'canvas',
      'build',
      appPath,
      '--mode',
      'strict',
      '--registry',
      runtimeRegistryPath,
      '--registry',
      semanticRegistryPath,
      '--out',
      outPath,
      '--format',
      'json',
    ]);

    expect(inspect.code).toBe(0);
    expect(validate.code).toBe(1);
    expect(build.code).toBe(1);
    expect(JSON.parse(build.stdout)).toMatchObject({
      buildable: false,
      valid: false,
      outPath,
    });

    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/canvas/golden/semantic/cli-inspect-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(validate.stdout), 'fixtures/canvas/golden/semantic/cli-validation-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(build.stdout), 'fixtures/canvas/golden/semantic/cli-build-failure.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(build.stderr), 'fixtures/cli/golden/protocol/canvas-semantic-diagnostics.json');
    await expectGoldenJson(JSON.parse(inspect.stderr), 'fixtures/cli/golden/protocol/canvas-semantic-diagnostics.json');
    await expectGoldenJson(JSON.parse(validate.stderr), 'fixtures/cli/golden/protocol/canvas-semantic-diagnostics.json');
  });

  it('covers seeded-only and registry-only canvas mode failures through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const appPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'base-app');
    const registryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'runtime-registry.json');
    const seededOutPath = join(tempDir, 'FixtureCanvas.seeded.msapp');
    const registryOutPath = join(tempDir, 'FixtureCanvas.registry.msapp');

    const seededInspect = await runCli([
      'canvas',
      'inspect',
      appPath,
      '--mode',
      'seeded',
      '--registry',
      registryPath,
      '--format',
      'json',
    ]);
    const seededValidate = await runCli([
      'canvas',
      'validate',
      appPath,
      '--mode',
      'seeded',
      '--registry',
      registryPath,
      '--format',
      'json',
    ]);
    const seededBuild = await runCli([
      'canvas',
      'build',
      appPath,
      '--mode',
      'seeded',
      '--registry',
      registryPath,
      '--out',
      seededOutPath,
      '--format',
      'json',
    ]);

    const registryInspect = await runCli([
      'canvas',
      'inspect',
      appPath,
      '--mode',
      'registry',
      '--registry',
      registryPath,
      '--format',
      'json',
    ]);
    const registryValidate = await runCli([
      'canvas',
      'validate',
      appPath,
      '--mode',
      'registry',
      '--registry',
      registryPath,
      '--format',
      'json',
    ]);
    const registryBuild = await runCli([
      'canvas',
      'build',
      appPath,
      '--mode',
      'registry',
      '--registry',
      registryPath,
      '--out',
      registryOutPath,
      '--format',
      'json',
    ]);

    expect(seededInspect.code).toBe(0);
    expect(seededValidate.code).toBe(1);
    expect(seededBuild.code).toBe(1);
    expect(JSON.parse(seededBuild.stdout)).toMatchObject({
      buildable: false,
      valid: false,
      outPath: seededOutPath,
    });

    expect(registryInspect.code).toBe(0);
    expect(registryValidate.code).toBe(1);
    expect(registryBuild.code).toBe(1);
    expect(JSON.parse(registryBuild.stdout)).toMatchObject({
      buildable: false,
      valid: false,
      outPath: registryOutPath,
    });

    await expectGoldenJson(JSON.parse(seededInspect.stdout), 'fixtures/canvas/golden/modes/cli-seeded-inspect-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(seededValidate.stdout), 'fixtures/canvas/golden/modes/cli-seeded-validation-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(seededBuild.stdout), 'fixtures/canvas/golden/modes/cli-seeded-build-failure.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(seededBuild.stderr), 'fixtures/cli/golden/protocol/canvas-seeded-diagnostics.json');
    await expectGoldenJson(JSON.parse(seededInspect.stderr), 'fixtures/cli/golden/protocol/canvas-seeded-diagnostics.json');
    await expectGoldenJson(JSON.parse(seededValidate.stderr), 'fixtures/cli/golden/protocol/canvas-seeded-diagnostics.json');

    await expectGoldenJson(JSON.parse(registryInspect.stdout), 'fixtures/canvas/golden/modes/cli-registry-inspect-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(registryValidate.stdout), 'fixtures/canvas/golden/modes/cli-registry-validation-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(registryBuild.stdout), 'fixtures/canvas/golden/modes/cli-registry-build-failure.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(registryBuild.stderr), 'fixtures/cli/golden/protocol/canvas-registry-diagnostics.json');
    await expectGoldenJson(JSON.parse(registryInspect.stderr), 'fixtures/cli/golden/protocol/canvas-registry-diagnostics.json');
    await expectGoldenJson(JSON.parse(registryValidate.stderr), 'fixtures/cli/golden/protocol/canvas-registry-diagnostics.json');
  });

  it('activates a remote flow in place through the CLI entrypoint', async () => {
    const updateCalls: Array<{ solutionUniqueName?: string; entity: Record<string, unknown> }> = [];
    const baseClient = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'sol-1',
            uniquename: 'Core',
          },
        ],
      },
      queryAll: {
        workflows: [
          {
            workflowid: 'flow-1',
            name: 'Invoice Sync',
            uniquename: 'crd_InvoiceSync',
            category: 5,
            statecode: 0,
            statuscode: 1,
            clientdata: JSON.stringify({
              schemaVersion: 1,
              properties: {
                definition: {
                  actions: {},
                },
              },
            }),
          },
        ],
        solutioncomponents: [
          {
            solutioncomponentid: 'comp-1',
            objectid: 'flow-1',
            componenttype: 29,
          },
        ],
        connectionreferences: [],
        environmentvariabledefinitions: [],
        environmentvariablevalues: [],
      },
    });
    const environmentClient = {
      ...baseClient,
      update: async (table: string, id: string, entity: Record<string, unknown>, options?: { solutionUniqueName?: string }) => {
        updateCalls.push({ solutionUniqueName: options?.solutionUniqueName, entity });
        return baseClient.update(table, id, entity, options);
      },
    } as unknown as DataverseClient;

    mockDataverseResolution({
      test: { client: environmentClient },
    });

    const activate = await runCli([
      'flow',
      'activate',
      'Invoice Sync',
      '--environment',
      'test',
      '--solution',
      'Core',
      '--format',
      'json',
    ]);

    expect(activate.code).toBe(0);
    expect(activate.stderr).toBe('');
    expect(JSON.parse(activate.stdout)).toMatchObject({
      identifier: 'Invoice Sync',
      source: {
        id: 'flow-1',
        uniqueName: 'crd_InvoiceSync',
        workflowState: 'draft',
        solutionUniqueName: 'Core',
      },
      targetIdentifier: 'Invoice Sync',
      operation: 'updated',
      target: {
        id: 'flow-1',
        uniqueName: 'crd_InvoiceSync',
        workflowState: 'activated',
        solutionUniqueName: 'Core',
      },
      promotionMode: 'artifact',
    });

    const workflows = await environmentClient.queryAll<Record<string, unknown>>({
      table: 'workflows',
    });
    expect(workflows.success).toBe(true);
    expect(workflows.data?.[0]).toMatchObject({
      statecode: 1,
      statuscode: 2,
    });
    expect(updateCalls).toEqual([
      {
        solutionUniqueName: undefined,
        entity: {
          clientdata: expect.any(String),
          statecode: 1,
          statuscode: 2,
        },
      },
    ]);
    expect(JSON.parse(String(updateCalls[0]?.entity.clientdata))).toMatchObject({
      properties: {
        definition: {
          actions: {},
        },
      },
    });
  });

  it('returns post-failure inspect and sync-status details when flow activate cannot activate a solution-scoped flow in place', async () => {
    const environmentClient = {
      ...createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
              friendlyname: 'Core',
            },
          ],
        },
        queryAll: {
          workflows: [
            {
              workflowid: 'flow-1',
              name: 'Harness Flow',
              uniquename: 'crd_HarnessFlow',
              category: 5,
              statecode: 0,
              statuscode: 1,
              clientdata: JSON.stringify({
                definition: {
                  actions: {},
                },
              }),
            },
          ],
          solutioncomponents: [
            {
              solutioncomponentid: 'comp-flow-1',
              objectid: 'flow-1',
              componenttype: 29,
            },
          ],
          connectionreferences: [],
          environmentvariabledefinitions: [],
          environmentvariablevalues: [],
        },
      }),
      update: async () =>
        ({
          success: false,
          diagnostics: [
            {
              level: 'error',
              code: 'HTTP_REQUEST_FAILED',
              message: 'PATCH workflows(flow-1) returned 400',
              detail: JSON.stringify({
                error: {
                  code: 'DefinitionRequestMissingFields',
                  message: "The definition request is missing required field 'definition'. ",
                },
              }),
            },
          ],
          warnings: [],
          supportTier: 'preview',
        } as OperationResult<never>),
      invokeAction: async <T>(name: string) => {
        if (name === 'ExportSolution') {
          return {
            success: false,
            diagnostics: [
              {
                level: 'error',
                code: 'HTTP_REQUEST_FAILED',
                message: 'POST ExportSolution returned 405',
              },
            ],
            warnings: [],
            supportTier: 'preview',
          } as OperationResult<never>;
        }

        return ok(
          {
            status: 204,
            headers: {},
            body: undefined as T,
          },
          { supportTier: 'preview' }
        );
      },
    } as unknown as DataverseClient;

    mockDataverseResolution({
      test: {
        client: environmentClient,
        authProfile: {
          name: 'fixture-user',
          type: 'user',
          defaultResource: 'https://test.example.crm.dynamics.com',
          browserProfile: 'fixture-browser',
        },
      },
    });

    const activate = await runCli([
      'flow',
      'activate',
      'Harness Flow',
      '--environment',
      'test',
      '--solution',
      'Core',
      '--format',
      'json',
    ]);

    expect(activate.code).toBe(1);
    const activatePayload = JSON.parse(activate.stdout);
    expect(activatePayload).toMatchObject({
      success: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'FLOW_ACTIVATE_DEFINITION_REQUIRED',
        }),
      ]),
      details: {
        activationAttempts: ['normalized-clientdata', 'clientdata-with-top-level-definition', 'state-only', 'statecode-only'],
        flow: {
          id: 'flow-1',
          uniqueName: 'crd_HarnessFlow',
          workflowState: 'draft',
          solutionUniqueName: 'Core',
        },
        solutionSyncStatus: {
          synchronization: {
            confirmed: false,
          },
          blockers: [
            expect.objectContaining({
              category: 5,
              logicalName: 'crd_HarnessFlow',
              workflowState: 'draft',
              definitionAvailable: true,
              remediation: expect.objectContaining({
                kind: 'activate-in-place',
                mcpMutationAvailable: true,
                mcpTool: {
                  name: 'pp.flow.activate',
                  arguments: {
                    environment: '<alias>',
                    identifier: 'crd_HarnessFlow',
                    solutionUniqueName: '<solution>',
                  },
                },
                alternativeMcpTools: [
                  {
                    name: 'pp.flow.deploy',
                    arguments: {
                      environment: '<alias>',
                      path: '<local-flow-artifact>',
                      solutionUniqueName: '<solution>',
                      target: 'crd_HarnessFlow',
                      workflowState: 'activated',
                    },
                    summary: expect.stringContaining('Redeploy the local flow artifact'),
                  },
                ],
                cliCommand: 'pp flow activate crd_HarnessFlow --environment <alias> --solution <solution> --format json',
                alternativeCliCommands: [
                  'pp flow deploy <local-flow-artifact> --environment <alias> --solution <solution> --target crd_HarnessFlow --workflow-state activated --format json',
                ],
                limitationCode: 'FLOW_ACTIVATE_DEFINITION_REQUIRED',
              }),
            }),
          ],
          readBack: {
            workflows: [
              expect.objectContaining({
                logicalName: 'crd_HarnessFlow',
                workflowState: 'draft',
                definitionAvailable: true,
              }),
            ],
          },
          exportCheck: {
            attempted: false,
            confirmed: false,
            failure: {
              warnings: expect.arrayContaining([
                expect.objectContaining({
                  code: 'SOLUTION_SYNC_STATUS_BLOCKED_WORKFLOW_STATE',
                }),
                expect.objectContaining({
                  code: 'SOLUTION_EXPORT_CHECK_SKIPPED_BLOCKED_WORKFLOW_STATE',
                }),
              ]),
            },
          },
        },
      },
    });
    expect(activatePayload.knownLimitations).toContain(
      'pp already retried activation with normalized-clientdata, clientdata-with-top-level-definition, state-only, statecode-only payload strategies for this workflow before surfacing the remaining Dataverse limitation.'
    );
    expect(activatePayload.details.solutionSyncStatus.exportCheck.failure.diagnostics).toEqual([]);
  });

  it('returns post-failure inspect and sync-status details when Dataverse nests DefinitionRequestMissingFields inside an outer error envelope', async () => {
    const environmentClient = {
      ...createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
              friendlyname: 'Core',
            },
          ],
        },
        queryAll: {
          workflows: [
            {
              workflowid: 'flow-1',
              name: 'Harness Flow',
              uniquename: 'crd_HarnessFlow',
              category: 5,
              statecode: 0,
              statuscode: 1,
              clientdata: JSON.stringify({
                definition: {
                  actions: {},
                },
              }),
            },
          ],
          solutioncomponents: [
            {
              solutioncomponentid: 'comp-flow-1',
              objectid: 'flow-1',
              componenttype: 29,
            },
          ],
          connectionreferences: [],
          environmentvariabledefinitions: [],
          environmentvariablevalues: [],
        },
      }),
      update: async () =>
        ({
          success: false,
          diagnostics: [
            {
              level: 'error',
              code: 'HTTP_REQUEST_FAILED',
              message: 'PATCH workflows(flow-1) returned 400',
              detail: JSON.stringify({
                error: {
                  code: '0x80060467',
                  message:
                    'Flow client error returned with status code "BadRequest" and details "{\\"error\\":{\\"code\\":\\"DefinitionRequestMissingFields\\",\\"message\\":\\"The definition request is missing required field \\\'definition\\\'. \\"}}".',
                },
              }),
            },
          ],
          warnings: [],
          supportTier: 'preview',
        } as OperationResult<never>),
      invokeAction: async <T>(name: string) => {
        if (name === 'ExportSolution') {
          return {
            success: false,
            diagnostics: [
              {
                level: 'error',
                code: 'HTTP_REQUEST_FAILED',
                message: 'POST ExportSolution returned 405',
              },
            ],
            warnings: [],
            supportTier: 'preview',
          } as OperationResult<never>;
        }

        return ok(
          {
            status: 204,
            headers: {},
            body: undefined as T,
          },
          { supportTier: 'preview' }
        );
      },
    } as unknown as DataverseClient;

    mockDataverseResolution({
      test: { client: environmentClient },
    });

    const activate = await runCli([
      'flow',
      'activate',
      'Harness Flow',
      '--environment',
      'test',
      '--solution',
      'Core',
      '--format',
      'json',
    ]);

    expect(activate.code).toBe(1);
    expect(JSON.parse(activate.stdout)).toMatchObject({
      success: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'FLOW_ACTIVATE_DEFINITION_REQUIRED',
        }),
      ]),
      details: {
        flow: {
          id: 'flow-1',
          uniqueName: 'crd_HarnessFlow',
          workflowState: 'draft',
          solutionUniqueName: 'Core',
        },
        solutionSyncStatus: {
          synchronization: {
            confirmed: false,
          },
          blockers: [
            expect.objectContaining({
              category: 5,
              logicalName: 'crd_HarnessFlow',
              workflowState: 'draft',
              definitionAvailable: true,
              remediation: expect.objectContaining({
                kind: 'activate-in-place',
                mcpMutationAvailable: true,
                mcpTool: {
                  name: 'pp.flow.activate',
                  arguments: {
                    environment: '<alias>',
                    identifier: 'crd_HarnessFlow',
                    solutionUniqueName: '<solution>',
                  },
                },
                alternativeMcpTools: [
                  {
                    name: 'pp.flow.deploy',
                    arguments: {
                      environment: '<alias>',
                      path: '<local-flow-artifact>',
                      solutionUniqueName: '<solution>',
                      target: 'crd_HarnessFlow',
                      workflowState: 'activated',
                    },
                    summary: expect.stringContaining('Redeploy the local flow artifact'),
                  },
                ],
                cliCommand: 'pp flow activate crd_HarnessFlow --environment <alias> --solution <solution> --format json',
                alternativeCliCommands: [
                  'pp flow deploy <local-flow-artifact> --environment <alias> --solution <solution> --target crd_HarnessFlow --workflow-state activated --format json',
                ],
                limitationCode: 'FLOW_ACTIVATE_DEFINITION_REQUIRED',
              }),
            }),
          ],
          readBack: {
            workflows: [
              expect.objectContaining({
                logicalName: 'crd_HarnessFlow',
                workflowState: 'draft',
                definitionAvailable: true,
              }),
            ],
          },
          exportCheck: {
            attempted: false,
            confirmed: false,
          },
        },
        tooling: {
          pac: {
            selectedEnvironment: 'test',
            sharesPpAuthContext: false,
            organizationUrl: 'https://test.example.crm.dynamics.com',
            recommendedAction: expect.stringContaining('Treat pac as a separately authenticated tool.'),
          },
        },
      },
      suggestedNextActions: expect.arrayContaining([
        'Run `pp env inspect test --format json` to confirm the selected environment alias, bound auth profile, and pac/tooling guidance before attempting a non-pp fallback.',
        expect.stringContaining('Treat pac as a separately authenticated tool.'),
      ]),
    });
  });

  it('returns post-failure inspect and sync-status details when Dataverse rejects the definition payload shape', async () => {
    const environmentClient = {
      ...createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
              friendlyname: 'Core',
            },
          ],
        },
        queryAll: {
          workflows: [
            {
              workflowid: 'flow-1',
              name: 'Harness Flow',
              uniquename: 'crd_HarnessFlow',
              category: 5,
              statecode: 0,
              statuscode: 1,
              clientdata: JSON.stringify({
                definition: {
                  actions: {},
                },
              }),
            },
          ],
          solutioncomponents: [
            {
              solutioncomponentid: 'comp-flow-1',
              objectid: 'flow-1',
              componenttype: 29,
            },
          ],
          connectionreferences: [],
          environmentvariabledefinitions: [],
          environmentvariablevalues: [],
        },
      }),
      update: async () =>
        ({
          success: false,
          diagnostics: [
            {
              level: 'error',
              code: 'HTTP_REQUEST_FAILED',
              message: 'PATCH workflows(flow-1) returned 400',
              detail: JSON.stringify({
                error: {
                  code: '0x80048d19',
                  message:
                    "Error identified in Payload provided by the user for Entity :'', For more information on this error please follow this help link https://go.microsoft.com/fwlink/?linkid=2195293  ---->  InnerException : Microsoft.OData.ODataException: An unexpected 'StartObject' node was found for property named 'definition' when reading from the JSON reader. A 'PrimitiveValue' node was expected.",
                },
              }),
            },
          ],
          warnings: [],
          supportTier: 'preview',
        } as OperationResult<never>),
      invokeAction: async <T>(name: string) => {
        if (name === 'ExportSolution') {
          return {
            success: false,
            diagnostics: [
              {
                level: 'error',
                code: 'HTTP_REQUEST_FAILED',
                message: 'POST ExportSolution returned 405',
              },
            ],
            warnings: [],
            supportTier: 'preview',
          } as OperationResult<never>;
        }

        return ok(
          {
            status: 204,
            headers: {},
            body: undefined as T,
          },
          { supportTier: 'preview' }
        );
      },
    } as unknown as DataverseClient;

    mockDataverseResolution({
      test: { client: environmentClient },
    });

    const activate = await runCli([
      'flow',
      'activate',
      'Harness Flow',
      '--environment',
      'test',
      '--solution',
      'Core',
      '--format',
      'json',
    ]);

    expect(activate.code).toBe(1);
    expect(JSON.parse(activate.stdout)).toMatchObject({
      success: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'FLOW_ACTIVATE_DEFINITION_REQUIRED',
        }),
      ]),
      details: {
        flow: {
          id: 'flow-1',
          uniqueName: 'crd_HarnessFlow',
          workflowState: 'draft',
          solutionUniqueName: 'Core',
        },
        solutionSyncStatus: {
          synchronization: {
            confirmed: false,
          },
          blockers: [
            expect.objectContaining({
              category: 5,
              logicalName: 'crd_HarnessFlow',
              workflowState: 'draft',
              remediation: expect.objectContaining({
                kind: 'activate-in-place',
                mcpMutationAvailable: true,
                mcpTool: {
                  name: 'pp.flow.activate',
                  arguments: {
                    environment: '<alias>',
                    identifier: 'crd_HarnessFlow',
                    solutionUniqueName: '<solution>',
                  },
                },
                alternativeMcpTools: [
                  {
                    name: 'pp.flow.deploy',
                    arguments: {
                      environment: '<alias>',
                      path: '<local-flow-artifact>',
                      solutionUniqueName: '<solution>',
                      target: 'crd_HarnessFlow',
                      workflowState: 'activated',
                    },
                    summary: expect.stringContaining('Redeploy the local flow artifact'),
                  },
                ],
                cliCommand: 'pp flow activate crd_HarnessFlow --environment <alias> --solution <solution> --format json',
                alternativeCliCommands: [
                  'pp flow deploy <local-flow-artifact> --environment <alias> --solution <solution> --target crd_HarnessFlow --workflow-state activated --format json',
                ],
                limitationCode: 'FLOW_ACTIVATE_DEFINITION_REQUIRED',
              }),
            }),
          ],
          readBack: {
            workflows: [
              expect.objectContaining({
                logicalName: 'crd_HarnessFlow',
                workflowState: 'draft',
              }),
            ],
          },
          exportCheck: {
            attempted: false,
            confirmed: false,
          },
        },
      },
      suggestedNextActions: expect.arrayContaining([
        'Run `pp env inspect test --format json` to confirm the selected environment alias, bound auth profile, and pac/tooling guidance before attempting a non-pp fallback.',
      ]),
    });
  });

  it('returns machine-readable blockers when solution publish times out waiting for export readiness', async () => {
    const client = {
      ...createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
              friendlyname: 'Core',
            },
          ],
        },
        queryAll: {
          solutioncomponents: [
            {
              solutioncomponentid: 'comp-flow-1',
              objectid: 'flow-1',
              componenttype: 29,
            },
          ],
          workflows: [
            {
              workflowid: 'flow-1',
              name: 'Harness Flow',
              uniquename: 'crd_HarnessFlow',
              category: 5,
              statecode: 0,
              statuscode: 1,
            },
          ],
        },
      }),
      invokeAction: async <T>(name: string) => {
        if (name === 'PublishAllXml') {
          return ok(
            {
              status: 204,
              headers: {},
            } as T,
            { supportTier: 'preview' }
          );
        }

        return {
          success: false,
          diagnostics: [
            {
              level: 'error',
              code: 'HTTP_REQUEST_FAILED',
              message: 'POST ExportSolution returned 405',
            },
          ],
          warnings: [],
          supportTier: 'preview',
        } as OperationResult<never>;
      },
    } as unknown as DataverseClient;

    mockDataverseResolution({
      source: {
        client,
      },
    });

    const publishResult = await runCli([
      'solution',
      'publish',
      'Core',
      '--env',
      'source',
      '--wait-for-export',
      '--timeout-ms',
      '1000',
      '--poll-interval-ms',
      '1000',
      '--format',
      'json',
    ]);

    expect(publishResult.code).toBe(1);
    expect(publishResult.stderr).toContain('Waiting for publish checkpoint: attempt 1');
    const publishPayload = JSON.parse(publishResult.stdout);
    expect(publishPayload).toMatchObject({
      success: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'SOLUTION_PUBLISH_EXPORT_BLOCKED_WORKFLOW_STATE',
        }),
      ]),
      details: {
        progress: [
          expect.objectContaining({
            stage: 'accepted',
          }),
          expect.objectContaining({
            stage: 'polling',
            attempt: 1,
          }),
        ],
        published: false,
        action: {
          name: 'PublishAllXml',
          accepted: true,
        },
        readiness: {
          state: 'blocked',
          publishAccepted: true,
          prePublishBlockerCount: 1,
          unchangedFromPrePublish: true,
        },
        blockers: [
          expect.objectContaining({
            category: 5,
            logicalName: 'crd_HarnessFlow',
            workflowState: 'draft',
            remediation: expect.objectContaining({
              kind: 'activate-in-place',
              mcpMutationAvailable: true,
              mcpTool: {
                name: 'pp.flow.activate',
                arguments: {
                  environment: '<alias>',
                  identifier: 'crd_HarnessFlow',
                  solutionUniqueName: '<solution>',
                },
              },
              alternativeMcpTools: [
                {
                  name: 'pp.flow.deploy',
                  arguments: {
                    environment: '<alias>',
                    path: '<local-flow-artifact>',
                    solutionUniqueName: '<solution>',
                    target: 'crd_HarnessFlow',
                    workflowState: 'activated',
                  },
                  summary: expect.stringContaining('Redeploy the local flow artifact'),
                },
              ],
              cliCommand: 'pp flow activate crd_HarnessFlow --environment <alias> --solution <solution> --format json',
              alternativeCliCommands: [
                'pp flow deploy <local-flow-artifact> --environment <alias> --solution <solution> --target crd_HarnessFlow --workflow-state activated --format json',
              ],
              limitationCode: 'FLOW_ACTIVATE_DEFINITION_REQUIRED',
            }),
          }),
        ],
        readBack: {
          workflows: [
            expect.objectContaining({
              logicalName: 'crd_HarnessFlow',
              workflowState: 'draft',
            }),
          ],
        },
      },
    });
    expect(publishPayload.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: 'DATAVERSE_CONNREF_SCOPE_EMPTY',
      })
    );
    expect(publishPayload.warnings).toContainEqual(
      expect.objectContaining({
        code: 'SOLUTION_SYNC_STATUS_BLOCKED_WORKFLOW_STATE',
      })
    );
    expect(publishPayload.warnings).toContainEqual(
      expect.objectContaining({
        code: 'SOLUTION_PUBLISH_BLOCKERS_UNCHANGED',
        detail: expect.stringContaining('Harness Flow state=draft'),
      })
    );
    expect(publishPayload.warnings[0]).toMatchObject({
      code: 'SOLUTION_SYNC_STATUS_BLOCKED_WORKFLOW_STATE',
    });
  });

  it('covers solution analysis and environment comparison through the CLI entrypoint', async () => {
    const fixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'solution', 'runtime', 'core-solution-envs.json')
    )) as SolutionFixtureEnvironments;

    mockDataverseResolution({
      source: createFixtureDataverseClient(fixture.source),
      target: createFixtureDataverseClient(fixture.target),
    });

    const analyze = await runCli(['solution', 'analyze', 'Core', '--env', 'source', '--format', 'json']);
    const compare = await runCli([
      'solution',
      'compare',
      'Core',
      '--source-env',
      'source',
      '--target-env',
      'target',
      '--include-model-composition',
      '--format',
      'json',
    ]);

    expect(analyze.code).toBe(0);
    expect(analyze.stderr).toBe('');
    expect(compare.code).toBe(0);
    expect(compare.stderr).toBe('');

    expect(JSON.parse(analyze.stdout)).toMatchObject({
      solution: {
        uniquename: 'Core',
        version: '1.2.0.0',
      },
      missingDependencies: [
        {
          id: 'dep-source-missing-form',
          missingRequiredComponent: true,
          requiredComponentTypeLabel: 'form',
        },
      ],
      modelDriven: {
        apps: [
          {
            appId: 'obj-app',
            uniqueName: 'SalesHub',
            name: 'Sales Hub',
          },
        ],
      },
    });
    expect(JSON.parse(compare.stdout)).toMatchObject({
      uniqueName: 'Core',
      drift: {
        versionChanged: true,
        modelDriven: {
          changedApps: [
            {
              appId: 'obj-app',
              uniqueName: 'SalesHub',
              name: 'Sales Hub',
              artifactsOnlyInSource: ['form:form-account-main', 'sitemap:site-sales'],
              artifactsOnlyInTarget: ['view:view-active-accounts'],
              missingArtifactsChanged: false,
            },
          ],
        },
      },
    });
  });

  it('defaults environment solution compare to shell-only model analysis', async () => {
    const fixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'solution', 'runtime', 'core-solution-envs.json')
    )) as SolutionFixtureEnvironments;

    mockDataverseResolution({
      source: createFixtureDataverseClient(fixture.source),
      target: createFixtureDataverseClient(fixture.target),
    });

    const compare = await runCli(['solution', 'compare', 'Core', '--source-env', 'source', '--target-env', 'target', '--format', 'json']);

    expect(compare.code).toBe(0);
    expect(compare.stderr).toBe('');
    expect(JSON.parse(compare.stdout)).toMatchObject({
      source: {
        modelDriven: {
          apps: [
            {
              appId: 'obj-app',
              uniqueName: 'SalesHub',
              name: 'Sales Hub',
              compositionSkippedReason:
                'Skipped model composition during solution compare; rerun with --include-model-composition for app-level artifact drift.',
            },
          ],
          summary: {
            appCount: 1,
            artifactCount: 0,
            missingArtifactCount: 0,
          },
        },
      },
      target: {
        modelDriven: {
          apps: [
            {
              appId: 'obj-app',
              uniqueName: 'SalesHub',
              name: 'Sales Hub',
              compositionSkippedReason:
                'Skipped model composition during solution compare; rerun with --include-model-composition for app-level artifact drift.',
            },
          ],
        },
      },
      drift: {
        modelDriven: {
          changedApps: [],
        },
      },
    });
  });

  it('compares environment solutions against local solution artifacts through the CLI entrypoint', async () => {
    const fixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'solution', 'runtime', 'core-solution-envs.json')
    )) as SolutionFixtureEnvironments;
    const tempDir = await createTempDir();
    const pacPath = await writeNodeCommandFixture(join(tempDir, 'fake-pac'), [
      "const { mkdirSync, writeFileSync } = require('node:fs');",
      'const args = process.argv.slice(2);',
      "if (args[1] === 'unpack') {",
      "  const folder = args[args.indexOf('--folder') + 1];",
      "  mkdirSync(folder, { recursive: true });",
      "  writeFileSync(`${folder}/Other.xml`, '<ImportExportXml><SolutionManifest><UniqueName>Core</UniqueName><Version>9.9.9.9</Version></SolutionManifest></ImportExportXml>');",
      "  writeFileSync(`${folder}/customizations.xml`, '<Artifact />');",
      '}',
    ]);
    const packagePath = join(tempDir, 'Core_managed.zip');
    const manifestPath = join(tempDir, 'Core_managed.pp-solution.json');

    await writeFile(packagePath, 'zip-placeholder', 'utf8');
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'pp-solution-release',
        generatedAt: '2026-03-10T00:00:00.000Z',
        solution: {
          uniqueName: 'Core',
          friendlyName: 'Core Solution',
          version: '9.9.9.9',
          packageType: 'managed',
        },
        files: [],
      }),
      'utf8'
    );
    mockDataverseResolution({
      source: createFixtureDataverseClient(fixture.source),
    });

    const compare = await runCli([
      'solution',
      'compare',
      'Core',
      '--source-env',
      'source',
      '--target-zip',
      packagePath,
      '--pac',
      pacPath,
      '--format',
      'json',
    ]);

    expect(compare.code).toBe(0);
    expect(compare.stderr).toBe('');
    expect(normalizeCliSnapshot(JSON.parse(compare.stdout), tempDir)).toMatchObject({
      uniqueName: 'Core',
      source: {
        origin: {
          kind: 'environment',
        },
      },
      target: {
        origin: {
          kind: 'zip',
          path: '<TMP_DIR>/Core_managed.zip',
        },
      },
      drift: {
        versionChanged: true,
        artifactsOnlyInTarget: [
          {
            relativePath: 'Other.xml',
          },
          {
            relativePath: 'customizations.xml',
          },
        ],
      },
    });
  });

  it('covers solution list, inspect, components, and dependencies through the CLI entrypoint', async () => {
    const fixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'solution', 'runtime', 'core-solution-envs.json')
    )) as SolutionFixtureEnvironments;

    mockDataverseResolution({
      source: createFixtureDataverseClient(fixture.source),
    });

    const list = await runCli(['solution', 'list', '--env', 'source', '--format', 'json']);
    const inspect = await runCli(['solution', 'inspect', 'Core', '--env', 'source', '--format', 'json']);
    const components = await runCli(['solution', 'components', 'Core', '--env', 'source', '--format', 'json']);
    const dependencies = await runCli(['solution', 'dependencies', 'Core', '--env', 'source', '--format', 'json']);

    expect(list.code).toBe(0);
    expect(list.stderr).toBe('');
    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(components.code).toBe(0);
    expect(components.stderr).toBe('');
    expect(dependencies.code).toBe(0);
    expect(dependencies.stderr).toBe('');

    await expectGoldenJson(JSON.parse(list.stdout), 'fixtures/cli/golden/protocol/solution-list-report.json');
    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/cli/golden/protocol/solution-inspect-report.json');
    await expectGoldenJson(JSON.parse(components.stdout), 'fixtures/cli/golden/protocol/solution-components-report.json');
    await expectGoldenJson(JSON.parse(dependencies.stdout), 'fixtures/cli/golden/protocol/solution-dependencies-report.json');
  });

  it('rejects unsupported output formats instead of falling back to json', async () => {
    const fixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'solution', 'runtime', 'core-solution-envs.json')
    )) as SolutionFixtureEnvironments;

    mockDataverseResolution({
      source: createFixtureDataverseClient(fixture.source),
    });

    const components = await runCli(['solution', 'components', 'Core', '--env', 'source', '--format', 'csv']);

    expect(components.code).toBe(1);
    expect(JSON.parse(components.stdout)).toMatchObject({
      success: false,
      diagnostics: [
        expect.objectContaining({
          code: 'CLI_OUTPUT_FORMAT_INVALID',
        }),
      ],
    });
    expect(components.stderr).toBe('');
  });

  it('fails solution components for a missing solution instead of returning an empty list', async () => {
    mockDataverseResolution({
      fixture: createFixtureDataverseClient({
        query: {
          solutions: [],
        },
      }),
    });

    const components = await runCli(['solution', 'components', 'MissingSolution', '--env', 'fixture', '--format', 'json']);

    expect(components.code).toBe(1);
    expect(JSON.parse(components.stdout)).toMatchObject({
      success: false,
      diagnostics: [
        {
          code: 'SOLUTION_NOT_FOUND',
          message: 'Solution MissingSolution was not found.',
          source: '@pp/solution',
        },
      ],
    });
    expect(components.stderr).toBe('');
  });

  it('passes solution-scoped Dataverse queries through the CLI entrypoint', async () => {
    const query = vi.fn(async () =>
      ok(
        [
          {
            pp_projectid: 'proj-1',
            pp_name: 'Alpha',
          },
        ],
        {
          supportTier: 'preview',
        }
      )
    );

    mockDataverseResolution({
      fixture: {
        query,
      } as unknown as DataverseClient,
    });

    const result = await runCli([
      'dv',
      'query',
      'pp_project',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--select',
      'pp_projectid,pp_name',
      '--format',
      'json',
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(query).toHaveBeenCalledWith({
      table: 'pp_project',
      select: ['pp_projectid', 'pp_name'],
      top: undefined,
      filter: undefined,
      expand: undefined,
      orderBy: undefined,
      count: false,
      diagnoseEmptyFilter: true,
      maxPageSize: undefined,
      includeAnnotations: undefined,
      solutionUniqueName: 'HarnessSolution',
    });
    expect(JSON.parse(result.stdout)).toMatchObject({
      success: true,
      runs: [
        {
          pp_projectid: 'proj-1',
          pp_name: 'Alpha',
        },
      ],
    });
  });

  it('accepts --environment as an alias for --env on dv whoami', async () => {
    const client = {
      whoAmI: async () => ({
        success: true,
        data: {
          BusinessUnitId: 'bu-1',
          OrganizationId: 'org-1',
          UserId: 'user-1',
        },
        supportTier: 'preview',
      }),
    } as unknown as DataverseClient;

    mockDataverseResolution({
      source: {
        client,
        environment: {
          url: 'https://source.example.crm.dynamics.com',
        },
        authProfile: {
          name: 'source-user',
        },
      },
    });

    const whoami = await runCli(['dv', 'whoami', '--environment', 'source', '--format', 'json']);

    expect(whoami.code).toBe(0);
    expect(whoami.stderr).toBe('');
    expect(JSON.parse(whoami.stdout)).toMatchObject({
      success: true,
      supportTier: 'preview',
      environment: 'source',
      url: 'https://source.example.crm.dynamics.com',
      authProfile: 'source-user',
      BusinessUnitId: 'bu-1',
      OrganizationId: 'org-1',
      UserId: 'user-1',
    });
  });

  it('inherits the active project environment for dv whoami when --environment is omitted', async () => {
    const tempDir = await createTempDir();
    await writeFile(
      join(tempDir, 'pp.config.yaml'),
      ['defaults:', '  environment: fixture', ''].join('\n'),
      'utf8'
    );

    const client = {
      whoAmI: async () => ({
        success: true,
        data: {
          BusinessUnitId: 'bu-project',
          OrganizationId: 'org-project',
          UserId: 'user-project',
        },
        supportTier: 'preview',
      }),
    } as unknown as DataverseClient;

    mockDataverseResolution({
      fixture: {
        client,
        environment: {
          url: 'https://fixture.example.crm.dynamics.com',
        },
        authProfile: {
          name: 'fixture-user',
        },
      },
    });

    const whoami = await runCli(['dv', 'whoami', '--format', 'json'], { cwd: tempDir, env: { INIT_CWD: tempDir } });

    expect(whoami.code).toBe(0);
    expect(whoami.stderr).toBe('');
    expect(JSON.parse(whoami.stdout)).toMatchObject({
      success: true,
      supportTier: 'preview',
      environment: 'fixture',
      url: 'https://fixture.example.crm.dynamics.com',
      authProfile: 'fixture-user',
      BusinessUnitId: 'bu-project',
      OrganizationId: 'org-project',
      UserId: 'user-project',
    });
  });

  it('captures and diffs Dataverse metadata snapshots through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const leftPath = join(tempDir, 'columns-left.json');
    const rightPath = join(tempDir, 'columns-right.json');

    mockDataverseResolution({
      fixture: {
        snapshotColumnsMetadata: async () =>
          ok(
            {
              schemaVersion: 1,
              generatedAt: '2026-03-10T00:00:00.000Z',
              environmentUrl: 'https://fixture.example.crm.dynamics.com',
              kind: 'columns',
              target: {
                logicalName: 'pp_project',
              },
              value: [
                {
                  logicalName: 'pp_code',
                  schemaName: 'pp_Code',
                  displayName: 'Code',
                },
                {
                  logicalName: 'pp_name',
                  schemaName: 'pp_Name',
                  displayName: 'Name',
                },
              ],
            },
            {
              supportTier: 'preview',
            }
          ),
      } as unknown as DataverseClient,
    });

    const snapshot = await runCli(['dv', 'metadata', 'snapshot', 'columns', 'pp_project', '--env', 'fixture', '--out', leftPath, '--format', 'json']);

    expect(snapshot.code).toBe(0);
    expect(snapshot.stderr).toBe('');
    expect(JSON.parse(snapshot.stdout)).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-03-10T00:00:00.000Z',
      environmentUrl: 'https://fixture.example.crm.dynamics.com',
      kind: 'columns',
      target: {
        logicalName: 'pp_project',
      },
      value: [
        {
          logicalName: 'pp_code',
          schemaName: 'pp_Code',
          displayName: 'Code',
        },
        {
          logicalName: 'pp_name',
          schemaName: 'pp_Name',
          displayName: 'Name',
        },
      ],
    });
    expect(await readJsonFile(leftPath)).toEqual(JSON.parse(snapshot.stdout));

    await writeFile(
      rightPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: '2026-03-10T00:01:00.000Z',
          environmentUrl: 'https://fixture.example.crm.dynamics.com',
          kind: 'columns',
          target: {
            logicalName: 'pp_project',
          },
          value: [
            {
              logicalName: 'pp_code',
              schemaName: 'pp_Code',
              displayName: 'Project Code',
            },
            {
              logicalName: 'pp_name',
              schemaName: 'pp_Name',
              displayName: 'Name',
            },
            {
              logicalName: 'pp_status',
              schemaName: 'pp_Status',
              displayName: 'Status',
            },
          ],
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    const diff = await runCli(['dv', 'metadata', 'diff', '--left', leftPath, '--right', rightPath, '--format', 'json']);

    expect(diff.code).toBe(0);
    expect(diff.stderr).toBe('');
    expect(JSON.parse(diff.stdout)).toEqual({
      compatible: true,
      left: {
        kind: 'columns',
        target: {
          logicalName: 'pp_project',
        },
      },
      right: {
        kind: 'columns',
        target: {
          logicalName: 'pp_project',
        },
      },
      summary: {
        added: 1,
        removed: 0,
        changed: 1,
        total: 2,
      },
      changes: [
        {
          kind: 'changed',
          path: 'value[0].displayName',
          left: 'Code',
          right: 'Project Code',
        },
        {
          kind: 'added',
          path: 'value[2]',
          right: {
            logicalName: 'pp_status',
            schemaName: 'pp_Status',
            displayName: 'Status',
          },
        },
      ],
    });
  });

  it('emits validator-derived Dataverse metadata schemas through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();

    const createTable = await runCli(['dv', 'metadata', 'schema', 'create-table', '--format', 'json-schema'], { cwd: tempDir });
    const addColumn = await runCli(['dv', 'metadata', 'schema', 'add-column', '--kind', 'choice', '--format', 'json-schema'], {
      cwd: tempDir,
    });

    expect(createTable.code).toBe(0);
    expect(createTable.stderr).toBe('');
    expect(JSON.parse(createTable.stdout)).toMatchObject({
      definitions: {
        DataverseCreateTableSpec: {
          type: 'object',
          required: ['schemaName', 'displayName', 'pluralDisplayName', 'primaryName'],
        },
      },
    });

    expect(addColumn.code).toBe(0);
    expect(addColumn.stderr).toBe('');
    expect(JSON.parse(addColumn.stdout)).toMatchObject({
      definitions: {
        DataverseAddChoiceColumnSpec: {
          anyOf: expect.any(Array),
        },
      },
    });
  });

  it('prints Dataverse metadata starter scaffolds through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();

    const createTable = await runCli(['dv', 'metadata', 'init', 'create-table'], { cwd: tempDir });
    const addColumn = await runCli(['dv', 'metadata', 'init', 'add-column', '--kind', 'choice', '--format', 'json'], {
      cwd: tempDir,
    });

    expect(createTable.code).toBe(0);
    expect(createTable.stderr).toBe('');
    expect(createTable.stdout).toContain('schemaName: pp_Project');
    expect(createTable.stdout).toContain('primaryName:');

    expect(addColumn.code).toBe(0);
    expect(addColumn.stderr).toBe('');
    expect(JSON.parse(addColumn.stdout)).toMatchObject({
      kind: 'choice',
      schemaName: 'pp_Status',
      options: [{ label: 'Planned' }, { label: 'Active' }, { label: 'Closed' }],
    });
  });

  it('invokes Dataverse actions through the CLI entrypoint', async () => {
    const actionCalls: Array<{ name: string; parameters: Record<string, unknown>; options?: Record<string, unknown> }> = [];
    const client = {
      invokeAction: async (name: string, parameters: Record<string, unknown>, options?: Record<string, unknown>) => {
        actionCalls.push({ name, parameters, options });
        return ok(
          {
            status: 200,
            headers: {},
            body: {
              ExportSolutionFile: 'ZXhwb3J0',
            },
          },
          { supportTier: 'preview' }
        );
      },
    } as unknown as DataverseClient;

    mockDataverseResolution({
      source: { client },
    });

    const action = await runCli([
      'dv',
      'action',
      'ExportSolution',
      '--environment',
      'source',
      '--body',
      '{"SolutionName":"Core","Managed":false}',
      '--format',
      'json',
    ]);

    expect(action.code).toBe(0);
    expect(action.stderr).toBe('');
    expect(JSON.parse(action.stdout)).toEqual({
      status: 200,
      headers: {},
      body: {
        ExportSolutionFile: 'ZXhwb3J0',
      },
    });
    expect(actionCalls).toEqual([
      {
        name: 'ExportSolution',
        parameters: {
          SolutionName: 'Core',
          Managed: false,
        },
        options: {
          boundPath: undefined,
          responseType: 'json',
          headers: undefined,
          includeAnnotations: undefined,
          solutionUniqueName: undefined,
        },
      },
    ]);
  });

  it('invokes Dataverse batches through the CLI entrypoint', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pp-cli-dv-batch-'));
    tempDirs.push(tempDir);
    const batchPath = join(tempDir, 'batch.yaml');
    await writeFile(
      batchPath,
      [
        'requests:',
        '  - id: query',
        '    method: GET',
        "    path: accounts?$select=accountid",
        '  - id: update',
        '    method: PATCH',
        "    path: accounts(1)",
        '    atomicGroup: writes',
        '    body:',
        '      name: Acme',
      ].join('\n')
    );

    const batchCalls: Array<{ requests: unknown; options?: Record<string, unknown> }> = [];
    const client = {
      executeBatch: async (requests: unknown, options?: Record<string, unknown>) => {
        batchCalls.push({ requests, options });
        return ok(
          [
            {
              id: 'query',
              status: 200,
              headers: {},
              body: { value: [{ accountid: '1' }] },
              contentId: 'query',
            },
            {
              id: 'update',
              status: 204,
              headers: {},
              contentId: 'update',
            },
          ],
          { supportTier: 'preview' }
        );
      },
    } as unknown as DataverseClient;

    mockDataverseResolution({
      source: { client },
    });

    const batch = await runCli(['dv', 'batch', '--environment', 'source', '--file', batchPath, '--format', 'json']);

    expect(batch.code).toBe(0);
    expect(batch.stderr).toBe('');
    expect(JSON.parse(batch.stdout)).toMatchObject({
      success: true,
      runs: [
        {
          id: 'query',
          status: 200,
          headers: {},
          body: { value: [{ accountid: '1' }] },
          contentId: 'query',
        },
        {
          id: 'update',
          status: 204,
          headers: {},
          contentId: 'update',
        },
      ],
    });
    expect(batchCalls).toEqual([
      {
        requests: [
          {
            id: 'query',
            method: 'GET',
            path: 'accounts?$select=accountid',
            headers: undefined,
            body: undefined,
            atomicGroup: undefined,
          },
          {
            id: 'update',
            method: 'PATCH',
            path: 'accounts(1)',
            headers: undefined,
            body: { name: 'Acme' },
            atomicGroup: 'writes',
          },
        ],
        options: {
          continueOnError: false,
          includeAnnotations: undefined,
          solutionUniqueName: undefined,
        },
      },
    ]);
  });

  it('accepts --environment as an alias for --env on solution list', async () => {
    const fixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'solution', 'runtime', 'core-solution-envs.json')
    )) as SolutionFixtureEnvironments;

    mockDataverseResolution({
      source: createFixtureDataverseClient(fixture.source),
    });

    const list = await runCli(['solution', 'list', '--environment', 'source', '--format', 'json']);

    expect(list.code).toBe(0);
    expect(list.stderr).toBe('');
    await expectGoldenJson(JSON.parse(list.stdout), 'fixtures/cli/golden/protocol/solution-list-report.json');
  });

  it('lets explicit --environment override the active project environment for solution list', async () => {
    const tempDir = await createTempDir();
    await writeFile(
      join(tempDir, 'pp.config.yaml'),
      ['defaults:', '  environment: fixture', ''].join('\n'),
      'utf8'
    );

    const fixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'solution', 'runtime', 'core-solution-envs.json')
    )) as SolutionFixtureEnvironments;

    mockDataverseResolution({
      source: createFixtureDataverseClient(fixture.source),
      fixture: createFixtureDataverseClient({
        query: {
          solutions: [],
        },
      }),
    });

    const list = await runCli(['solution', 'list', '--environment', 'source', '--format', 'json'], { cwd: tempDir });

    expect(list.code).toBe(0);
    expect(list.stderr).toBe('');
    expect(JSON.parse(list.stdout)).toMatchObject({
      success: true,
      solutions: expect.arrayContaining([
        expect.objectContaining({
          uniquename: 'Core',
        }),
      ]),
    });
  });

  it('filters solution list results by prefix and exact unique name', async () => {
    const fixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'solution', 'runtime', 'core-solution-envs.json')
    )) as SolutionFixtureEnvironments;

    mockDataverseResolution({
      source: createFixtureDataverseClient({
        ...fixture.source,
        query: {
          ...(fixture.source.query ?? {}),
          solutions: [
            ...((fixture.source.query?.solutions as Record<string, unknown>[] | undefined) ?? []),
            {
              solutionid: 'sol-harness',
              uniquename: 'ppHarness20260310T200706248Z',
              friendlyname: 'PP Harness 20260310T200706248Z',
              version: '26.3.10.2007',
            },
          ],
        },
      }),
    });

    const byPrefix = await runCli([
      'solution',
      'list',
      '--environment',
      'source',
      '--prefix',
      'ppHarness20260310T200706248Z',
      '--format',
      'json',
    ]);
    const byUniqueName = await runCli([
      'solution',
      'list',
      '--environment',
      'source',
      '--unique-name',
      'Core',
      '--format',
      'json',
    ]);

    expect(byPrefix.code).toBe(0);
    expect(byPrefix.stderr).toBe('');
    expect(JSON.parse(byPrefix.stdout)).toMatchObject({
      success: true,
      solutions: [
        expect.objectContaining({
          solutionid: 'sol-harness',
          uniquename: 'ppHarness20260310T200706248Z',
        }),
      ],
    });

    expect(byUniqueName.code).toBe(0);
    expect(byUniqueName.stderr).toBe('');
    expect(JSON.parse(byUniqueName.stdout)).toMatchObject({
      success: true,
      solutions: [
        expect.objectContaining({
          uniquename: 'Core',
        }),
      ],
    });
  });

  it('renders solution list collections as row-oriented table output and one-record-per-line ndjson', async () => {
    const fixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'solution', 'runtime', 'core-solution-envs.json')
    )) as SolutionFixtureEnvironments;

    mockDataverseResolution({
      source: createFixtureDataverseClient(fixture.source),
    });

    const ndjson = await runCli(['solution', 'list', '--environment', 'source', '--format', 'ndjson']);
    const table = await runCli(['solution', 'list', '--environment', 'source', '--format', 'table']);

    expect(ndjson.code).toBe(0);
    expect(ndjson.stderr).toBe('');
    const ndjsonLines = ndjson.stdout.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(ndjsonLines.length).toBeGreaterThan(0);
    expect(ndjsonLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uniquename: 'Core',
        }),
      ])
    );

    expect(table.code).toBe(0);
    expect(table.stderr).toBe('');
    expect(table.stdout).toContain('uniquename');
    expect(table.stdout).toContain('friendlyname');
    expect(table.stdout).toContain('Core');
    expect(table.stdout).not.toContain('solutions  [');
  });

  it('preserves the collection envelope for empty solution list output across json, ndjson, and table', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        query: {
          solutions: [],
        },
      }),
    });

    const json = await runCli(['solution', 'list', '--environment', 'source', '--format', 'json']);
    const ndjson = await runCli(['solution', 'list', '--environment', 'source', '--format', 'ndjson']);
    const table = await runCli(['solution', 'list', '--environment', 'source', '--format', 'table']);

    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({
      success: true,
      solutions: [],
    });

    expect(ndjson.code).toBe(0);
    expect(ndjson.stderr).toBe('');
    expect(ndjson.stdout.trim()).not.toBe('');
    expect(ndjson.stdout.trim().split('\n').map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        success: true,
        solutions: [],
      }),
    ]);

    expect(table.code).toBe(0);
    expect(table.stderr).toBe('');
    expect(table.stdout).toContain('field');
    expect(table.stdout).toContain('solutions');
    expect(table.stdout).toContain('[]');
  });

  it('dispatches solution list when the argv starts with a wrapper separator', async () => {
    const fixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'solution', 'runtime', 'core-solution-envs.json')
    )) as SolutionFixtureEnvironments;

    mockDataverseResolution({
      source: createFixtureDataverseClient(fixture.source),
    });

    const list = await runCli(['--', 'solution', 'list', '--environment', 'source', '--format', 'json']);

    expect(list.code).toBe(0);
    expect(list.stderr).toBe('');
    await expectGoldenJson(JSON.parse(list.stdout), 'fixtures/cli/golden/protocol/solution-list-report.json');
  });

  it('exports and imports solution artifacts through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
    const client = {
      query: async <T>(options: { table: string }) =>
        ok(
          options.table === 'solutions'
            ? ([{ solutionid: 'sol-1', uniquename: 'Core', friendlyname: 'Core', version: '1.0.0.0' }] as T[])
            : ([] as T[]),
          { supportTier: 'preview' }
        ),
      queryAll: async <T>() => ok([] as T[], { supportTier: 'preview' }),
      invokeAction: async <T>(name: string, parameters?: Record<string, unknown>) => {
        requests.push({ path: name, body: parameters });

        return ok(
          {
            status: name === 'ExportSolution' ? 200 : 204,
            headers: {},
            body:
              name === 'ExportSolution'
                ? ({
                    ExportSolutionFile: Buffer.from('cli-export').toString('base64'),
                  } as T)
                : undefined,
          },
          { supportTier: 'preview' }
        );
      },
    } as unknown as DataverseClient;

    mockDataverseResolution({
      source: {
        client,
      },
    });

    const exportPath = join(tempDir, 'Core_managed.zip');
    const exportResult = await runCli(['solution', 'export', 'Core', '--env', 'source', '--managed', '--out', exportPath, '--format', 'json']);

    expect(exportResult.code).toBe(0);
    expect(exportResult.stderr).toBe('');
    expect(await readFile(exportPath, 'utf8')).toBe('cli-export');
    expect(requests[0]).toEqual({
      path: 'ExportSolution',
      body: {
        SolutionName: 'Core',
        Managed: true,
      },
    });

    const importResult = await runCli(['solution', 'import', exportPath, '--env', 'source', '--format', 'json']);

    expect(importResult.code).toBe(0);
    expect(importResult.stderr).toBe('');
    expect(requests[1]?.path).toBe('ImportSolution');
    expect(requests[1]?.body).toMatchObject({
      PublishWorkflows: true,
      OverwriteUnmanagedCustomizations: false,
      HoldingSolution: false,
      SkipProductUpdateDependencies: false,
      ImportJobId: expect.any(String),
      CustomizationFile: Buffer.from('cli-export').toString('base64'),
    });
  });

  it('surfaces draft workflow remediation when solution export is blocked by packaged flows', async () => {
    const client = {
      query: async <T>(options: {
        table: string;
        filter?: string;
      }) => {
        if (options.table === 'solutions') {
          return ok(
            [{ solutionid: 'sol-1', uniquename: 'Core', friendlyname: 'Core', version: '1.0.0.0' }] as T[],
            { supportTier: 'preview' }
          );
        }

        if (options.table === 'workflows') {
          return ok(
            [
              {
                workflowid: 'flow-1',
                name: 'Harness Flow',
                uniquename: 'crd_HarnessFlow',
                category: 5,
                statecode: 0,
                statuscode: 1,
                clientdata: JSON.stringify({
                  definition: {
                    actions: {},
                  },
                }),
              },
            ] as T[],
            { supportTier: 'preview' }
          );
        }

        return ok([] as T[], { supportTier: 'preview' });
      },
      queryAll: async <T>(options?: { table?: string }) => {
        if (options?.table === 'solutioncomponents') {
          return ok(
            [{ solutioncomponentid: 'comp-workflow', objectid: 'flow-1', componenttype: 29, ismetadata: false, rootcomponentbehavior: 0 }] as T[],
            { supportTier: 'preview' }
          );
        }

        if (options?.table === 'workflows') {
          return ok(
            [
              {
                workflowid: 'flow-1',
                name: 'Harness Flow',
                uniquename: 'crd_HarnessFlow',
                category: 5,
                statecode: 0,
                statuscode: 1,
                clientdata: JSON.stringify({
                  definition: {
                    actions: {},
                  },
                }),
              },
            ] as T[],
            { supportTier: 'preview' }
          );
        }

        return ok([] as T[], { supportTier: 'preview' });
      },
      invokeAction: async () =>
        fail(
          [
            {
              level: 'error',
              code: 'HTTP_REQUEST_FAILED',
              message: 'POST ExportSolution returned 405',
            },
          ],
          { supportTier: 'preview' }
        ),
    } as unknown as DataverseClient;

    mockDataverseResolution({
      source: {
        client,
      },
    });

    const exportResult = await runCli(['solution', 'export', 'Core', '--env', 'source', '--format', 'json']);

    expect(exportResult.code).toBe(1);
    expect(exportResult.stderr).toBe('');
    expect(JSON.parse(exportResult.stdout)).toMatchObject({
      success: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'HTTP_REQUEST_FAILED',
        }),
      ]),
      warnings: expect.arrayContaining([
        expect.objectContaining({
          code: 'SOLUTION_EXPORT_WORKFLOW_CONTEXT',
        }),
        expect.objectContaining({
          code: 'SOLUTION_EXPORT_BLOCKED_WORKFLOW_STATE',
          detail: expect.stringContaining('Harness Flow state=draft'),
        }),
      ]),
      suggestedNextActions: expect.arrayContaining([
        'Use MCP `pp.flow.activate` or `pp flow activate crd_HarnessFlow --environment <alias> --solution Core --format json` for one bounded in-session activation attempt. If you also have the local artifact, `pp.flow.deploy` can redeploy it back to crd_HarnessFlow in the same solution, but if either path returns `FLOW_ACTIVATE_DEFINITION_REQUIRED`, `pp` does not currently have another native completion path from draft modern flow to export-ready synchronized solution for this workflow.',
      ]),
      supportTier: 'preview',
    });
  });

  it('includes managed-state contradiction details in machine-readable solution export failures', async () => {
    const client = {
      query: async <T>(options: { table: string }) =>
        ok(
          options.table === 'solutions'
            ? ([{ solutionid: 'sol-1', uniquename: 'Core', friendlyname: 'Core', version: '1.0.0.0', ismanaged: false }] as T[])
            : ([] as T[]),
          { supportTier: 'preview' }
        ),
      queryAll: async <T>() => ok([] as T[], { supportTier: 'preview' }),
      invokeAction: async () =>
        fail(
          [
            {
              level: 'error',
              code: 'HTTP_REQUEST_FAILED',
              message: 'POST ExportSolution returned 400',
              detail: JSON.stringify({
                error: {
                  code: '0x80048036',
                  message: 'An error occurred while exporting a solution. Managed solutions cannot be exported.',
                },
              }),
            },
          ],
          { supportTier: 'preview' }
        ),
    } as unknown as DataverseClient;

    mockDataverseResolution({
      source: {
        client,
      },
    });

    const exportResult = await runCli(['solution', 'export', 'Core', '--env', 'source', '--format', 'json']);

    expect(exportResult.code).toBe(1);
    expect(exportResult.stderr).toBe('');
    expect(JSON.parse(exportResult.stdout)).toMatchObject({
      success: false,
      details: {
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          friendlyname: 'Core',
          version: '1.0.0.0',
          ismanaged: false,
        },
        packageType: 'unmanaged',
        managedStateContradiction: {
          inspect: {
            solutionid: 'sol-1',
            uniquename: 'Core',
            friendlyname: 'Core',
            version: '1.0.0.0',
            ismanaged: false,
          },
          export: {
            diagnosticCode: 'HTTP_REQUEST_FAILED',
            message: 'POST ExportSolution returned 400',
            detail: expect.stringContaining('0x80048036'),
          },
        },
      },
      warnings: expect.arrayContaining([
        expect.objectContaining({
          code: 'SOLUTION_EXPORT_MANAGED_STATE_CONTRADICTION',
        }),
      ]),
      suggestedNextActions: expect.arrayContaining([
        'Run `pp solution sync-status Core --environment <alias> --format json` to capture solution read-back and a fresh export probe in one response.',
      ]),
    });
  });

  it('captures a rollback checkpoint through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
    const client = {
      query: async <T>(options: { table: string }) =>
        ok(
          options.table === 'solutions'
            ? ([{ solutionid: 'sol-1', uniquename: 'Core', friendlyname: 'Core', version: '1.0.0.0' }] as T[])
            : ([] as T[]),
          { supportTier: 'preview' }
        ),
      queryAll: async <T>(options?: { table?: string }) =>
        ok(
          options?.table === 'solutioncomponents'
            ? ([{ solutioncomponentid: 'comp-1', objectid: 'canvas-1', componenttype: 300, ismetadata: false, rootcomponentbehavior: 0 }] as T[])
            : ([] as T[]),
          { supportTier: 'preview' }
        ),
      invokeAction: async <T>(name: string, parameters?: Record<string, unknown>) => {
        requests.push({ path: name, body: parameters });

        return ok(
          {
            status: 200,
            headers: {},
            body:
              name === 'ExportSolution'
                ? ({
                    ExportSolutionFile: Buffer.from('cli-checkpoint-export').toString('base64'),
                  } as T)
                : ({} as T),
          },
          { supportTier: 'preview' }
        );
      },
    } as unknown as DataverseClient;

    mockDataverseResolution({
      source: {
        environment: {
          alias: 'source',
          url: 'https://fixture.api.crm.dynamics.com',
        },
        client,
      },
    });

    const exportPath = join(tempDir, 'Core-pre-import.zip');
    const checkpointResult = await runCli([
      'solution',
      'checkpoint',
      'Core',
      '--env',
      'source',
      '--out',
      exportPath,
      '--format',
      'json',
    ]);

    expect(checkpointResult.code).toBe(0);
    expect(checkpointResult.stderr).toBe('');
    expect(await readFile(exportPath, 'utf8')).toBe('cli-checkpoint-export');
    expect(requests[0]).toEqual({
      path: 'ExportSolution',
      body: {
        SolutionName: 'Core',
        Managed: false,
      },
    });

    const parsed = JSON.parse(checkpointResult.stdout);
    expect(parsed).toMatchObject({
      kind: 'pp-solution-checkpoint',
      environment: {
        alias: 'source',
        url: 'https://fixture.api.crm.dynamics.com',
        pacOrganizationUrl: 'https://fixture.crm.dynamics.com',
      },
      solution: {
        uniqueName: 'Core',
        packageType: 'unmanaged',
        rollbackCandidateVersion: '1.0.0.0',
      },
      inspection: {
        componentCount: 1,
        components: [
          {
            id: 'comp-1',
            objectId: 'canvas-1',
            componentType: 300,
          },
        ],
      },
    });
    expect(JSON.parse(await readFile(parsed.checkpointPath, 'utf8'))).toMatchObject({
      kind: 'pp-solution-checkpoint',
      solution: {
        uniqueName: 'Core',
      },
    });
  });

  it('publishes a solution through the CLI entrypoint and can wait for an export checkpoint', async () => {
    const tempDir = await createTempDir();
    const upstreamPath = join(tempDir, 'upstream.zip');
    await createSolutionArchive(upstreamPath, false);
    const upstreamBytes = await readFile(upstreamPath);
    const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
    const client = {
      query: async <T>(options: { table: string }) =>
        ok(
          options.table === 'solutions'
            ? ([{ solutionid: 'sol-1', uniquename: 'Core', friendlyname: 'Core', version: '1.0.0.0' }] as T[])
            : ([] as T[]),
          { supportTier: 'preview' }
        ),
      queryAll: async <T>(options: { table: string }) => {
        if (options.table === 'solutioncomponents') {
          return ok(
            [
              { solutioncomponentid: 'comp-canvas', objectid: 'canvas-1', componenttype: 300 },
              { solutioncomponentid: 'comp-flow', objectid: 'flow-1', componenttype: 29 },
            ] as T[],
            { supportTier: 'preview' }
          );
        }

        if (options.table === 'canvasapps') {
          return ok(
            [
              {
                canvasappid: 'canvas-1',
                displayname: 'Harness Canvas',
                name: 'crd_HarnessCanvas',
                lastpublishtime: '2026-03-11T18:06:20.000Z',
              },
            ] as T[],
            { supportTier: 'preview' }
          );
        }

        if (options.table === 'workflows') {
          return ok(
            [
              {
                workflowid: 'flow-1',
                name: 'Harness Flow',
                uniquename: 'crd_HarnessFlow',
                category: 5,
                statecode: 1,
                statuscode: 2,
              },
            ] as T[],
            { supportTier: 'preview' }
          );
        }

        return ok([] as T[], { supportTier: 'preview' });
      },
      listTables: async () =>
        ok([], {
          supportTier: 'preview',
        }),
      invokeAction: async <T>(name: string, parameters?: Record<string, unknown>) => {
        requests.push({ path: name, body: parameters });

        const exportAttempts = requests.filter((r) => r.path === 'ExportSolution').length;
        if (name === 'ExportSolution' && exportAttempts <= 1) {
          return {
            success: false,
            diagnostics: [
              {
                level: 'error',
                code: 'HTTP_REQUEST_FAILED',
                message: 'POST ExportSolution returned 405',
              },
            ],
            warnings: [],
            supportTier: 'preview',
          } as OperationResult<never>;
        }

        if (name === 'ExportSolution') {
          return ok(
            {
              status: 200,
              headers: {},
              body: {
                ExportSolutionFile: upstreamBytes.toString('base64'),
              } as T,
            },
            { supportTier: 'preview' }
          );
        }

        return ok(
          {
            status: 204,
            headers: {},
            body: undefined,
          },
          { supportTier: 'preview' }
        );
      },
    } as unknown as DataverseClient;

    mockDataverseResolution({
      source: {
        client,
      },
    });

    const exportPath = join(tempDir, 'Core.zip');
    const publishResult = await runCli([
      'solution',
      'publish',
      'Core',
      '--env',
      'source',
      '--wait-for-export',
      '--poll-interval-ms',
      '50',
      '--timeout-ms',
      '4000',
      '--out',
      exportPath,
      '--format',
      'json',
    ]);

    expect(publishResult.code).toBe(0);
    expect(publishResult.stderr).toContain(
      'Waiting for publish checkpoint: solution Core accepted PublishAllXml; polling for export readiness'
    );
    expect(publishResult.stderr).toContain('Waiting for publish checkpoint: attempt 1');
    expect(publishResult.stderr).toContain('Publish checkpoint confirmed for solution Core');
    expect(await access(exportPath).then(() => true, () => false)).toBe(true);
    expect(requests.map((request) => request.path)).toContain('PublishAllXml');
    expect(requests.map((request) => request.path)).toContain('ExportSolution');
    expect(JSON.parse(publishResult.stdout)).toMatchObject({
      published: true,
      waitForExport: true,
      synchronization: {
        kind: 'solution-export',
        confirmed: true,
      },
      blockers: [],
      export: {
        packageType: 'unmanaged',
      },
      readBack: {
        summary: {
          componentCount: 2,
          canvasAppCount: 1,
          workflowCount: 1,
          modelDrivenAppCount: 0,
          componentTypeCounts: {
            'canvas-app': 1,
            workflow: 1,
          },
        },
        canvasApps: [
          {
            id: 'canvas-1',
            name: 'Harness Canvas',
            logicalName: 'crd_HarnessCanvas',
            lastPublishTime: '2026-03-11T18:06:20.000Z',
          },
        ],
        workflows: [
          {
            id: 'flow-1',
            name: 'Harness Flow',
            logicalName: 'crd_HarnessFlow',
            category: 5,
            workflowState: 'activated',
          },
        ],
      },
    });
  });

  it('publishes a solution through the CLI entrypoint and returns immediate readback without waiting for export', async () => {
    const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
    const client = {
      query: async <T>(options: { table: string }) =>
        ok(
          options.table === 'solutions'
            ? ([{ solutionid: 'sol-1', uniquename: 'Core', friendlyname: 'Core', version: '1.0.0.0' }] as T[])
            : ([] as T[]),
          { supportTier: 'preview' }
        ),
      queryAll: async <T>(options: { table: string }) => {
        if (options.table === 'solutioncomponents') {
          return ok(
            [
              { solutioncomponentid: 'comp-canvas', objectid: 'canvas-1', componenttype: 300 },
              { solutioncomponentid: 'comp-flow', objectid: 'flow-1', componenttype: 29 },
              { solutioncomponentid: 'comp-model', objectid: 'app-1', componenttype: 80 },
            ] as T[],
            { supportTier: 'preview' }
          );
        }

        if (options.table === 'canvasapps') {
          return ok(
            [
              {
                canvasappid: 'canvas-1',
                displayname: 'Harness Canvas',
                name: 'crd_HarnessCanvas',
                lastpublishtime: '2026-03-11T18:06:20.000Z',
              },
            ] as T[],
            { supportTier: 'preview' }
          );
        }

        if (options.table === 'workflows') {
          return ok(
            [
              {
                workflowid: 'flow-1',
                name: 'Harness Flow',
                uniquename: 'crd_HarnessFlow',
                category: 5,
                statecode: 0,
                statuscode: 1,
                clientdata: JSON.stringify({
                  definition: {
                    actions: {},
                  },
                }),
              },
            ] as T[],
            { supportTier: 'preview' }
          );
        }

        if (options.table === 'appmodules') {
          return ok(
            [
              {
                appmoduleid: 'app-1',
                name: 'Harness Hub',
                uniquename: 'crd_HarnessHub',
                statecode: 0,
                publishedon: '2026-03-11T18:07:00.000Z',
              },
            ] as T[],
            { supportTier: 'preview' }
          );
        }

        return ok([] as T[], { supportTier: 'preview' });
      },
      listTables: async () =>
        ok([], {
          supportTier: 'preview',
        }),
      invokeAction: async <T>(name: string, parameters?: Record<string, unknown>) => {
        requests.push({ path: name, body: parameters });

        if (name === 'ExportSolution') {
          return {
            success: false,
            diagnostics: [
              {
                level: 'error',
                code: 'HTTP_REQUEST_FAILED',
                message: 'POST ExportSolution returned 405',
              },
            ],
            warnings: [],
            supportTier: 'preview',
          } as OperationResult<never>;
        }

        return ok(
          {
            status: 204,
            headers: {},
            body: undefined as T,
          },
          { supportTier: 'preview' }
        );
      },
    } as unknown as DataverseClient;

    mockDataverseResolution({
      source: {
        client,
      },
    });

    const publishResult = await runCli(['solution', 'publish', 'Core', '--env', 'source', '--format', 'json']);

    expect(publishResult.code).toBe(0);
    expect(requests.map((request) => request.path)).toEqual(['PublishAllXml']);
    expect(JSON.parse(publishResult.stdout)).toMatchObject({
      published: true,
      waitForExport: false,
      synchronization: {
        kind: 'solution-export',
        confirmed: false,
      },
      readiness: {
        state: 'blocked',
        exportReadinessConfirmed: false,
        blockerCount: 1,
        publishAccepted: true,
        prePublishBlockerCount: 1,
        unchangedFromPrePublish: true,
        summary:
          'PublishAllXml was accepted for solution Core, but export readiness is still blocked by the same workflow Harness Flow in state draft even though Dataverse readback shows definitionAvailable=true; that blocker was already present before publish.',
        primaryBlocker: {
          logicalName: 'crd_HarnessFlow',
          workflowState: 'draft',
          definitionAvailable: true,
        },
      },
      exportCheck: {
        attempted: false,
        confirmed: false,
        packageType: 'unmanaged',
        failure: {
          diagnostics: [],
        },
      },
      blockers: [
        {
          kind: 'workflow-state',
          componentType: 'workflow',
          id: 'flow-1',
          name: 'Harness Flow',
          logicalName: 'crd_HarnessFlow',
          workflowState: 'draft',
          definitionAvailable: true,
        },
      ],
      readBack: {
        summary: {
          componentCount: 3,
          canvasAppCount: 1,
          workflowCount: 1,
          modelDrivenAppCount: 1,
        },
        signals: {
          canvasApps: {
            total: 1,
            published: 1,
            unknown: 0,
          },
          workflows: {
            total: 1,
            activated: 0,
            draft: 1,
            suspended: 0,
            other: 0,
            blocked: 1,
          },
          modelDrivenApps: {
            total: 1,
            published: 1,
            unknown: 0,
          },
        },
        workflows: [
          {
            id: 'flow-1',
            workflowState: 'draft',
            definitionAvailable: true,
          },
        ],
        modelDrivenApps: [
          {
            id: 'app-1',
            publishedOn: '2026-03-11T18:07:00.000Z',
          },
        ],
      },
    });
    expect(publishResult.stderr).toContain('SOLUTION_PUBLISH_BLOCKERS_UNCHANGED');
  });

  it('reports solution sync-status with an export probe and publish readback', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pp-cli-sync-status-'));
    tempDirs.push(tempDir);
    const upstreamPath = join(tempDir, 'upstream.zip');
    await createSolutionArchive(upstreamPath, false);
    const upstreamBytes = await readFile(upstreamPath);
    const requests: Array<{ path: string; body: Record<string, unknown> | undefined }> = [];
    const client = {
      query: async <T>(options: { table: string }): Promise<OperationResult<T[]>> => {
        if (options.table === 'solutions') {
          return ok(
            [
              {
                solutionid: 'sol-1',
                uniquename: 'Core',
                friendlyname: 'Core',
                version: '1.0.0.0',
              },
            ] as T[],
            { supportTier: 'preview' }
          );
        }

        return ok([] as T[], { supportTier: 'preview' });
      },
      queryAll: async <T>(options: { table: string }): Promise<OperationResult<T[]>> => {
        if (options.table === 'solutioncomponents') {
          return ok(
            [
              { solutioncomponentid: 'comp-canvas', objectid: 'canvas-1', componenttype: 300 },
              { solutioncomponentid: 'comp-flow', objectid: 'flow-1', componenttype: 29 },
              { solutioncomponentid: 'comp-model', objectid: 'app-1', componenttype: 80 },
            ] as T[],
            { supportTier: 'preview' }
          );
        }

        if (options.table === 'canvasapps') {
          return ok(
            [
              {
                canvasappid: 'canvas-1',
                displayname: 'Harness Canvas',
                name: 'crd_HarnessCanvas',
                lastpublishtime: '2026-03-11T18:06:20.000Z',
              },
            ] as T[],
            { supportTier: 'preview' }
          );
        }

        if (options.table === 'workflows') {
          return ok(
            [
              {
                workflowid: 'flow-1',
                name: 'Harness Flow',
                uniquename: 'crd_HarnessFlow',
                category: 5,
                statecode: 1,
                statuscode: 2,
              },
            ] as T[],
            { supportTier: 'preview' }
          );
        }

        if (options.table === 'appmodules') {
          return ok(
            [
              {
                appmoduleid: 'app-1',
                name: 'Harness Hub',
                uniquename: 'crd_HarnessHub',
                statecode: 0,
                publishedon: '2026-03-11T18:07:00.000Z',
              },
            ] as T[],
            { supportTier: 'preview' }
          );
        }

        return ok([] as T[], { supportTier: 'preview' });
      },
      listTables: async () => ok([], { supportTier: 'preview' }),
      invokeAction: async <T>(name: string, parameters?: Record<string, unknown>) => {
        requests.push({ path: name, body: parameters });

        return ok(
          {
            status: 200,
            headers: {},
            body:
              name === 'ExportSolution'
                ? ({
                    ExportSolutionFile: upstreamBytes.toString('base64'),
                  } as T)
                : undefined,
          },
          { supportTier: 'preview' }
        );
      },
    } as unknown as DataverseClient;

    mockDataverseResolution({
      source: {
        client,
      },
    });

    const exportPath = join(tempDir, 'Core.zip');
    const result = await runCli([
      'solution',
      'sync-status',
      'Core',
      '--env',
      'source',
      '--out',
      exportPath,
      '--format',
      'json',
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('captured publish readback for Core');
    expect(result.stderr).toContain('starting unmanaged export probe for Core');
    expect(result.stderr).toContain('export probe confirmed readiness for Core');
    expect(await access(exportPath).then(() => true, () => false)).toBe(true);
    expect(requests.map((request) => request.path)).toEqual(['ExportSolution']);
    expect(JSON.parse(result.stdout)).toMatchObject({
      progress: [
        expect.objectContaining({
          stage: 'readback-complete',
        }),
        expect.objectContaining({
          stage: 'export-check-started',
          packageType: 'unmanaged',
        }),
        expect.objectContaining({
          stage: 'export-check-complete',
          exportConfirmed: true,
        }),
      ],
      synchronization: {
        kind: 'solution-export',
        confirmed: true,
      },
      readiness: {
        state: 'ready',
        exportReadinessConfirmed: true,
        blockerCount: 0,
        summary: 'Solution Core is export-ready.',
      },
      blockers: [],
      readBack: {
        summary: {
          componentCount: 3,
          canvasAppCount: 1,
          workflowCount: 1,
          modelDrivenAppCount: 1,
        },
      },
      exportCheck: {
        attempted: true,
        confirmed: true,
      },
    });
  });

  it('passes solution sync-status timeout through to the export probe', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pp-cli-sync-status-timeout-'));
    tempDirs.push(tempDir);
    const requests: Array<{ path: string; body: Record<string, unknown> | undefined; timeoutMs?: number }> = [];
    const client = {
      query: async <T>(options: { table: string }): Promise<OperationResult<T[]>> => {
        if (options.table === 'solutions') {
          return ok(
            [
              {
                solutionid: 'sol-1',
                uniquename: 'Core',
                friendlyname: 'Core',
                version: '1.0.0.0',
              },
            ] as T[],
            { supportTier: 'preview' }
          );
        }

        return ok([] as T[], { supportTier: 'preview' });
      },
      queryAll: async <T>(options: { table: string }): Promise<OperationResult<T[]>> => {
        if (options.table === 'solutioncomponents') {
          return ok([] as T[], { supportTier: 'preview' });
        }

        return ok([] as T[], { supportTier: 'preview' });
      },
      listTables: async () => ok([], { supportTier: 'preview' }),
      invokeAction: async <T>(name: string, parameters?: Record<string, unknown>, options?: { timeoutMs?: number }) => {
        requests.push({ path: name, body: parameters, timeoutMs: options?.timeoutMs });

        return ok(
          {
            status: 200,
            headers: {},
            body: {
              ExportSolutionFile: Buffer.from('fixture').toString('base64'),
            } as T,
          },
          { supportTier: 'preview' }
        );
      },
    } as unknown as DataverseClient;

    mockDataverseResolution({
      source: {
        client,
      },
    });

    const result = await runCli([
      'solution',
      'sync-status',
      'Core',
      '--env',
      'source',
      '--timeout-ms',
      '20000',
      '--out',
      join(tempDir, 'Core.zip'),
      '--format',
      'json',
    ]);

    expect(result.code).toBe(0);
    expect(requests).toContainEqual(
      expect.objectContaining({
        path: 'ExportSolution',
        timeoutMs: 20_000,
      })
    );
  });

  it('packs and unpacks solution artifacts through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const pacPath = await writeNodeCommandFixture(join(tempDir, 'fake-pac'), [
      "const { mkdirSync, writeFileSync } = require('node:fs');",
      'const args = process.argv.slice(2);',
      "const zipfile = args[args.indexOf('--zipfile') + 1];",
      "const folder = args[args.indexOf('--folder') + 1];",
      "if (args[1] === 'pack') writeFileSync(zipfile, 'cli-packed');",
      "if (args[1] === 'unpack') { mkdirSync(folder, { recursive: true }); writeFileSync(`${folder}/Other.xml`, '<ImportExportXml />'); }",
    ]);
    const packedPath = join(tempDir, 'Harness.zip');
    const unpackDir = join(tempDir, 'unpacked');

    const packResult = await runCli([
      'solution',
      'pack',
      tempDir,
      '--out',
      packedPath,
      '--package-type',
      'managed',
      '--pac',
      pacPath,
      '--format',
      'json',
    ]);
    const unpackResult = await runCli([
      'solution',
      'unpack',
      packedPath,
      '--out',
      unpackDir,
      '--package-type',
      'both',
      '--allow-delete',
      '--pac',
      pacPath,
      '--format',
      'json',
    ]);

    expect(packResult.code).toBe(0);
    expect(packResult.stderr).toBe('');
    expect(await readFile(packedPath, 'utf8')).toBe('cli-packed');
    expect(JSON.parse(packResult.stdout)).toMatchObject({
      packageType: 'managed',
      artifact: {
        path: packedPath,
      },
    });

    expect(unpackResult.code).toBe(0);
    expect(unpackResult.stderr).toBe('');
    await access(join(unpackDir, 'Other.xml'));
    expect(JSON.parse(unpackResult.stdout)).toMatchObject({
      packageType: 'both',
      unpackedRoot: {
        path: unpackDir,
      },
    });
  });

  it('infers the solution unpack package type when the flag is omitted', async () => {
    const tempDir = await createTempDir();
    const pacPath = await writeNodeCommandFixture(join(tempDir, 'fake-pac'), [
      "const { mkdirSync, writeFileSync } = require('node:fs');",
      'const args = process.argv.slice(2);',
      "const packageType = args[args.indexOf('--packagetype') + 1];",
      "const folder = args[args.indexOf('--folder') + 1];",
      "if (args[1] !== 'unpack') process.exit(1);",
      "if (packageType !== 'Unmanaged') { console.error(`unexpected package type: ${packageType}`); process.exit(2); }",
      "mkdirSync(folder, { recursive: true });",
      "writeFileSync(`${folder}/Other.xml`, '<ImportExportXml />');",
    ]);
    const packedPath = join(tempDir, 'Harness_unmanaged.zip');
    const unpackDir = join(tempDir, 'unpacked');
    await createSolutionArchive(packedPath, false);

    const unpackResult = await runCli([
      'solution',
      'unpack',
      packedPath,
      '--out',
      unpackDir,
      '--pac',
      pacPath,
      '--format',
      'json',
    ]);

    expect(unpackResult.code).toBe(0);
    expect(unpackResult.stderr).toBe('');
    await access(join(unpackDir, 'Other.xml'));
    expect(JSON.parse(unpackResult.stdout)).toMatchObject({
      packageType: 'unmanaged',
      unpackedRoot: {
        path: unpackDir,
      },
    });
  });

  it('unpacks solution canvas apps into editable source trees when requested', async () => {
    const tempDir = await createTempDir();
    const packedPath = join(tempDir, 'Harness.zip');
    const unpackDir = join(tempDir, 'unpacked');
    const msappSourceDir = join(tempDir, 'msapp-source');
    const msappPath = join(tempDir, 'Harness Canvas.msapp');
    const pacPath = await writeNodeCommandFixture(join(tempDir, 'fake-pac'), [
      "const { mkdirSync, writeFileSync, copyFileSync } = require('node:fs');",
      'const args = process.argv.slice(2);',
      "const zipfile = args[args.indexOf('--zipfile') + 1];",
      "const folder = args[args.indexOf('--folder') + 1];",
      `const msappPath = ${JSON.stringify(msappPath)};`,
      "if (args[1] === 'pack') writeFileSync(zipfile, 'cli-packed');",
      "if (args[1] === 'unpack') { mkdirSync(`${folder}/CanvasApps`, { recursive: true }); writeFileSync(`${folder}/Other.xml`, '<ImportExportXml />'); copyFileSync(msappPath, `${folder}/CanvasApps/crd_HarnessCanvas.msapp`); }",
    ]);

    await mkdir(msappSourceDir, { recursive: true });
    await writeFile(join(msappSourceDir, 'Header.json'), '{"schemaVersion":1}', 'utf8');
    await writeFile(join(msappSourceDir, 'Src\\App.pa.yaml'), 'App:\n', 'utf8');
    await writeFile(join(msappSourceDir, 'Controls\\1.json'), '{"Name":"App"}', 'utf8');
    await createZipPackage(msappSourceDir, msappPath);

    await createSolutionArchive(packedPath, false);

    const unpackResult = await runCli([
      'solution',
      'unpack',
      packedPath,
      '--out',
      unpackDir,
      '--extract-canvas-apps',
      '--pac',
      pacPath,
      '--format',
      'json',
    ]);

    expect(unpackResult.code).toBe(0);
    expect(unpackResult.stderr).toBe('');
    expect(await readFile(join(unpackDir, 'CanvasApps', 'crd_HarnessCanvas', 'Src', 'App.pa.yaml'), 'utf8')).toBe('App:\n');
    expect(JSON.parse(unpackResult.stdout)).toMatchObject({
      unpackedRoot: {
        path: unpackDir,
      },
      extractedCanvasApps: [
        {
          msappPath: join(unpackDir, 'CanvasApps', 'crd_HarnessCanvas.msapp'),
          extractedPath: join(unpackDir, 'CanvasApps', 'crd_HarnessCanvas'),
          extractedEntries: ['Controls/1.json', 'Header.json', 'Src/App.pa.yaml'],
        },
      ],
    });
  });

  it('returns an already configured maker environment id without rediscovery', async () => {
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

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const resolve = await runCli(['env', 'resolve-maker-id', 'fixture', '--config-dir', configDir, '--format', 'json']);

    expect(resolve.code).toBe(0);
    expect(resolve.stderr).toBe('');
    expect(JSON.parse(resolve.stdout)).toEqual({
      environment: {
        alias: 'fixture',
        url: 'https://fixture.crm.dynamics.com',
        authProfile: 'fixture-user',
        makerEnvironmentId: 'env-123',
      },
      resolution: {
        source: 'configured',
        persisted: false,
        api: 'power-platform-environments',
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('discovers and persists a missing maker environment id onto the alias', async () => {
    const configDir = await createTempDir();
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          authProfiles: {
            'fixture-static': {
              name: 'fixture-static',
              type: 'static-token',
              token: 'bap-token',
            },
          },
          environments: {
            fixture: {
              alias: 'fixture',
              url: 'https://fixture.crm.dynamics.com',
              authProfile: 'fixture-static',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          value: [
            {
              name: 'env-123',
              properties: {
                linkedEnvironmentMetadata: {
                  instanceApiUrl: 'https://fixture.crm.dynamics.com',
                },
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      )
    );

    const resolve = await runCli(['env', 'resolve-maker-id', 'fixture', '--config-dir', configDir, '--format', 'json']);

    expect(resolve.code).toBe(0);
    expect(resolve.stderr).toBe('');
    expect(JSON.parse(resolve.stdout)).toEqual({
      environment: {
        alias: 'fixture',
        url: 'https://fixture.crm.dynamics.com',
        authProfile: 'fixture-static',
        makerEnvironmentId: 'env-123',
      },
      resolution: {
        source: 'discovered',
        persisted: true,
        api: 'power-platform-environments',
      },
    });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      'https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/environments?api-version=2020-10-01'
    );

    const savedConfig = JSON.parse(await readFile(join(configDir, 'config.json'), 'utf8')) as {
      environments: Record<string, { makerEnvironmentId?: string }>;
    };
    expect(savedConfig.environments.fixture?.makerEnvironmentId).toBe('env-123');
  });

  it('prints help for env baseline', async () => {
    const help = await runCli(['env', 'baseline', '--help']);

    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('Usage: env baseline <alias> --prefix PREFIX');
    expect(help.stdout).toContain('readyForBootstrap');
    expect(help.stdout).toContain('--expect-absent-solution NAME');
  });

  it('prints env group help with baseline workflow examples', async () => {
    const help = await runCli(['env', '--help']);

    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('Usage: env <command> [options]');
    expect(help.stdout).toContain('baseline <alias>');
    expect(help.stdout).toContain('pp env baseline test --prefix ppHarness20260310T013401820Z --format json');
  });

  it('renders env list markdown and raw distinctly from json', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-cli-env-list-'));
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          authProfiles: {
            'fixture-user': {
              name: 'fixture-user',
              type: 'user',
            },
          },
          browserProfiles: {},
          environments: {
            fixture: {
              alias: 'fixture',
              url: 'https://fixture.crm.dynamics.com',
              authProfile: 'fixture-user',
              makerEnvironmentId: 'env-123',
            },
          },
          preferences: {},
        },
        null,
        2
      ),
      'utf8'
    );

    const json = await runCli(['env', 'list', '--config-dir', configDir, '--format', 'json']);
    const markdown = await runCli(['env', 'list', '--config-dir', configDir, '--format', 'markdown']);
    const raw = await runCli(['env', 'list', '--config-dir', configDir, '--format', 'raw']);

    expect(json.code).toBe(0);
    expect(markdown.code).toBe(0);
    expect(raw.code).toBe(0);
    expect(markdown.stdout).toContain('| alias | url | authProfile | makerEnvironmentId |');
    expect(raw.stdout).toContain('alias');
    expect(raw.stdout).toContain('fixture.crm.dynamics.com');
    expect(markdown.stdout).not.toBe(json.stdout);
    expect(raw.stdout).not.toBe(json.stdout);
  });

  it('routes environment and solution export help to scoped help text', async () => {
    const environmentHelp = await runCli(['environment', 'list', '--help']);
    const solutionExportHelp = await runCli(['solution', 'export', '--help']);

    expect(environmentHelp.code).toBe(0);
    expect(environmentHelp.stderr).toBe('');
    expect(environmentHelp.stdout).toContain('Usage: env list [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]');
    expect(environmentHelp.stdout).not.toContain('Power Platform CLI for local project work');

    expect(solutionExportHelp.code).toBe(0);
    expect(solutionExportHelp.stderr).toBe('');
    expect(solutionExportHelp.stdout).toContain(
      'Usage: solution export <uniqueName> --environment ALIAS [--out PATH] [--managed] [--manifest FILE] [--plan] [--dry-run] [options]'
    );
    expect(solutionExportHelp.stdout).not.toContain('SOLUTION_EXPORT_ARGS_REQUIRED');
  });

  it('prints help for solution compare', async () => {
    const help = await runCli(['solution', 'compare', '--help']);

    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('Usage: solution compare [uniqueName]');
    expect(help.stdout).toContain('--include-model-composition');
    expect(help.stdout).toContain('shell-only model-driven pass');
  });

  it('deletes one solution through solution delete', async () => {
    mockDataverseResolution({
      fixture: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'HarnessShell',
              friendlyname: 'Harness Shell',
              version: '1.0.0.0',
            },
          ],
        },
      }),
    });

    const removal = await runCli(['solution', 'delete', 'HarnessShell', '--environment', 'fixture', '--format', 'json']);
    const inspect = await runCli(['solution', 'inspect', 'HarnessShell', '--environment', 'fixture', '--format', 'json']);

    expect(removal.code).toBe(0);
    expect(removal.stderr).toBe('');
    expect(JSON.parse(removal.stdout)).toMatchObject({
      removed: true,
      solution: {
        solutionid: 'sol-1',
        uniquename: 'HarnessShell',
      },
      verification: {
        inspectCommand: 'pp solution inspect HarnessShell --environment fixture --format json',
        absentSignal: 'SOLUTION_NOT_FOUND',
      },
    });
    expect(inspect.code).toBe(1);
    expect(inspect.stdout).toContain('SOLUTION_NOT_FOUND');
  });

  it('builds a target-aware plan for managed solution import', async () => {
    const tempDir = await createTempDir();
    const packagePath = join(tempDir, 'HarnessShell_managed.zip');
    const manifestPath = join(tempDir, 'HarnessShell_managed.pp-solution.json');

    await writeFile(packagePath, 'fixture-package', 'utf8');
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'pp-solution-release',
          generatedAt: '2026-03-11T18:00:00.000Z',
          solution: {
            uniqueName: 'HarnessShell',
            friendlyName: 'Harness Shell',
            version: '1.0.0.0',
            packageType: 'managed',
          },
          source: {
            environmentUrl: 'https://source.crm.dynamics.com',
          },
          files: [],
        },
        null,
        2
      ),
      'utf8'
    );

    mockDataverseResolution({
      fixture: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'HarnessShell',
              friendlyname: 'Harness Shell',
              version: '1.0.0.0',
              ismanaged: true,
            },
          ],
        },
      }),
    });

    const plan = await runCli(['solution', 'import', packagePath, '--environment', 'fixture', '--plan', '--format', 'json']);

    expect(plan.code).toBe(0);
    expect(plan.stderr).toBe('');
    expect(JSON.parse(plan.stdout)).toMatchObject({
      action: 'solution.import',
      mode: 'plan',
      willMutate: false,
      target: {
        environment: 'fixture',
        packagePath,
        solutionUniqueName: 'HarnessShell',
      },
      input: {
        package: {
          manifestPath,
          available: true,
          uniqueName: 'HarnessShell',
          version: '1.0.0.0',
          packageType: 'managed',
        },
      },
      analysis: {
        compatibility: {
          status: 'same-version-managed-installed',
          sameVersion: true,
          versionComparison: 'equal',
          recommendedWorkflow: 'review-target-first',
        },
        targetState: {
          found: true,
          uniqueName: 'HarnessShell',
          version: '1.0.0.0',
          isManaged: true,
        },
      },
    });
    expect(plan.stdout).toContain('holding-solution');
  });

  it('builds a target-aware import plan from package metadata when the adjacent manifest is missing', async () => {
    const tempDir = await createTempDir();
    const packagePath = join(tempDir, 'Core_managed.zip');
    await createSolutionArchive(packagePath, true);

    mockDataverseResolution({
      fixture: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
              friendlyname: 'Core',
              version: '1.0.0.0',
              ismanaged: true,
            },
          ],
        },
      }),
    });

    const plan = await runCli(['solution', 'import', packagePath, '--environment', 'fixture', '--plan', '--format', 'json']);

    expect(plan.code).toBe(0);
    expect(plan.stderr).toBe('');
    expect(JSON.parse(plan.stdout)).toMatchObject({
      action: 'solution.import',
      mode: 'plan',
      willMutate: false,
      target: {
        environment: 'fixture',
        packagePath,
        solutionUniqueName: 'Core',
      },
      input: {
        package: {
          available: true,
          metadataSource: 'archive',
          uniqueName: 'Core',
          version: '1.2.3.4',
          packageType: 'managed',
        },
      },
      analysis: {
        compatibility: {
          status: 'managed-upgrade-candidate',
          sameVersion: false,
          versionComparison: 'older',
          recommendedWorkflow: 'holding-upgrade',
        },
        targetState: {
          found: true,
          uniqueName: 'Core',
          version: '1.0.0.0',
          isManaged: true,
        },
      },
      knownLimitations: expect.arrayContaining([
        'Archive-derived plan metadata comes from solution.xml/Other.xml and may omit friendly name or other release-manifest-only provenance.',
      ]),
    });
  });

  it('prints help for env resolve-maker-id', async () => {
    const help = await runCli(['env', 'resolve-maker-id', '--help']);

    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('env resolve-maker-id <alias> [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]');
  });

  it('prints help for auth profile inspect --help without running validation', async () => {
    const inspect = await runCli(['auth', 'profile', 'inspect', '--help']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(inspect.stdout).toContain(
      'auth profile inspect <name> [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]'
    );
    expect(inspect.stdout).toContain(
      'auth profile inspect --environment ALIAS [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]'
    );
    expect(inspect.stdout).toContain('pp auth profile inspect environment:dev');
    expect(inspect.stdout).not.toContain('AUTH_PROFILE_NAME_REQUIRED');
  });

  it('scopes auth and env help to their own command trees with disambiguating guidance', async () => {
    const authHelp = await runCli(['auth', '--help']);
    const authProfileHelp = await runCli(['auth', 'profile', '--help']);
    const authAddEnvHelp = await runCli(['auth', 'profile', 'add-env', '--help']);
    const envHelp = await runCli(['env', '--help']);
    const envAddHelp = await runCli(['env', 'add', '--help']);

    expect(authHelp.code).toBe(0);
    expect(authHelp.stderr).toBe('');
    expect(authHelp.stdout).toContain('Usage: auth <command> [options]');
    expect(authHelp.stdout).toContain('Manage how pp authenticates to remote services.');
    expect(authHelp.stdout).toContain('profile         create, inspect, and remove auth profiles');
    expect(authHelp.stdout).toContain('Use `pp env add` to bind a Dataverse environment URL to an existing auth profile.');
    expect(authHelp.stdout).toContain('Need pp to read credentials from an environment variable? Use `pp auth profile add-env`.');
    expect(authHelp.stdout).toContain('Need a named Dataverse target such as `dev` or `test`? Use `pp env add`.');
    expect(authHelp.stdout).toContain('Need to see which profile an alias already uses? Use `pp auth profile inspect --environment dev`.');
    expect(authHelp.stdout).not.toContain('dv whoami');

    expect(authProfileHelp.code).toBe(0);
    expect(authProfileHelp.stderr).toBe('');
    expect(authProfileHelp.stdout).toContain('Usage: auth profile <command> [options]');
    expect(authProfileHelp.stdout).toContain('Use `pp env add` separately to bind a Dataverse environment URL to a profile.');
    expect(authProfileHelp.stdout).toContain('add-env              create a token-env auth profile, not a Dataverse environment alias');
    expect(authProfileHelp.stdout).toContain('`add-env` means "read a token from an environment variable", not "register a Dataverse environment".');
    expect(authProfileHelp.stdout).toContain(
      'Use `pp env add` for Dataverse aliases, then `pp auth profile inspect --environment <alias>` to confirm the binding later.'
    );
    expect(authProfileHelp.stdout).not.toContain('pp solution');

    expect(authAddEnvHelp.code).toBe(0);
    expect(authAddEnvHelp.stderr).toBe('');
    expect(authAddEnvHelp.stdout).toContain('Usage: auth profile add-env --name NAME --env-var ENV_VAR [--resource URL]');
    expect(authAddEnvHelp.stdout).toContain('This does not add a Dataverse environment alias.');
    expect(authAddEnvHelp.stdout).toContain('If you want to add a new Dataverse environment to pp, use `pp env add` instead.');
    expect(authAddEnvHelp.stdout).toContain(
      'If you already have an alias and want to see its bound profile, use `pp auth profile inspect --environment <alias>`.'
    );
    expect(authAddEnvHelp.stdout).toContain('pp auth profile inspect --environment dev');

    expect(envHelp.code).toBe(0);
    expect(envHelp.stderr).toBe('');
    expect(envHelp.stdout).toContain('Usage: env <command> [options]');
    expect(envHelp.stdout).toContain('An environment alias is a named Dataverse target that points to a URL and an existing auth profile.');
    expect(envHelp.stdout).toContain('Use `pp env add` when you need a saved Dataverse alias such as `dev`, `test`, or `uat`.');
    expect(envHelp.stdout).toContain(
      'Use `pp auth profile add-env` only when the credential source is an access token already present in an environment variable.'
    );
    expect(envHelp.stdout).toContain(
      'Use `pp auth profile inspect --environment <alias>` when the workflow starts from an alias and you need the concrete profile behind it.'
    );
    expect(envHelp.stdout).toContain('`pp env add` adds a Dataverse environment alias.');
    expect(envHelp.stdout).toContain('`pp auth profile add-env` adds an auth profile backed by a token environment variable.');
    expect(envHelp.stdout).not.toContain('dv whoami');

    expect(envAddHelp.code).toBe(0);
    expect(envAddHelp.stderr).toBe('');
    expect(envAddHelp.stdout).toContain(
      'Usage: env add <alias> --url URL --profile PROFILE [--default-solution NAME] [--maker-env-id GUID] [--config-dir path]'
    );
    expect(envAddHelp.stdout).toContain('Adds one Dataverse environment alias that points to an existing auth profile.');
    expect(envAddHelp.stdout).toContain('`--profile` must name an existing auth profile.');
    expect(envAddHelp.stdout).toContain(
      'If the profile should read a token from an environment variable, use `pp auth profile add-env` before this alias step.'
    );
    expect(envAddHelp.stdout).toContain(
      'To confirm which profile an existing alias resolves to, use `pp auth profile inspect --environment <alias>`.'
    );
    expect(envAddHelp.stdout).toContain('`--name ALIAS` is still accepted');
  });

  it('documents scope-aware auth help for login and profile creation commands', async () => {
    const authLoginHelp = await runCli(['auth', 'login', '--help']);
    const authAddUserHelp = await runCli(['auth', 'profile', 'add-user', '--help']);
    const authAddDeviceCodeHelp = await runCli(['auth', 'profile', 'add-device-code', '--help']);

    expect(authLoginHelp.code).toBe(0);
    expect(authLoginHelp.stderr).toBe('');
    expect(authLoginHelp.stdout).toContain('Usage: auth login --name NAME [--resource URL] [--scope s1,s2]');
    expect(authLoginHelp.stdout).toContain(
      'For normal Dataverse sign-in, prefer `--resource https://<org>.crm.dynamics.com`.'
    );
    expect(authLoginHelp.stdout).toContain(
      '`--scope` is an advanced escape hatch for exact OAuth scopes and those stored scopes take precedence over `--resource` on later logins.'
    );

    expect(authAddUserHelp.code).toBe(0);
    expect(authAddUserHelp.stderr).toBe('');
    expect(authAddUserHelp.stdout).toContain('Usage: auth profile add-user --name NAME [--resource URL] [--scope s1,s2]');
    expect(authAddUserHelp.stdout).toContain(
      'If `--scope` is supplied, pp stores those exact delegated scopes on the profile instead of deriving `<resource>/user_impersonation` later.'
    );

    expect(authAddDeviceCodeHelp.code).toBe(0);
    expect(authAddDeviceCodeHelp.stderr).toBe('');
    expect(authAddDeviceCodeHelp.stdout).toContain(
      'Usage: auth profile add-device-code --name NAME [--resource URL] [--scope s1,s2]'
    );
    expect(authAddDeviceCodeHelp.stdout).toContain(
      'If `--scope` is supplied, pp stores those exact scopes on the profile instead of deriving them from `--resource`.'
    );
  });

  it('accepts a positional alias for env add preview mode', async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      ['env', 'add', 'fixture', '--url', 'https://fixture.crm.dynamics.com', '--profile', 'work', '--plan', '--format', 'json'],
      {
        env: {
          PP_CONFIG_DIR: tempDir,
        },
      }
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      action: 'env.add',
      mode: 'plan',
      target: {
        alias: 'fixture',
        url: 'https://fixture.crm.dynamics.com',
        authProfile: 'work',
      },
    });
  });

  it('prints help for solution import without attempting validation', async () => {
    const help = await runCli(['solution', 'import', '--help']);

    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('Usage: solution import <path.zip> --environment ALIAS');
    expect(help.stdout).toContain('`--plan` reads the adjacent `.pp-solution.json` release manifest when present, otherwise falls back to solution package metadata');
    expect(help.stdout).toContain('--holding-solution                     Stage a managed holding import before the follow-up upgrade path');
    expect(help.stdout).not.toContain('SOLUTION_IMPORT_ARGS_REQUIRED');
  });

  it('scopes flow help and keeps local-vs-remote guidance discoverable', async () => {
    const flowHelp = await runCli(['flow', '--help']);
    const flowInspectHelp = await runCli(['flow', 'inspect', '--help']);
    const flowAttachHelp = await runCli(['flow', 'attach', '--help']);
    const flowActivateHelp = await runCli(['flow', 'activate', '--help']);

    expect(flowHelp.code).toBe(0);
    expect(flowHelp.stderr).toBe('');
    expect(flowHelp.stdout).toContain('Usage: flow <command> [options]');
    expect(flowHelp.stdout).not.toContain('pp auth profile add-user');

    expect(flowInspectHelp.code).toBe(0);
    expect(flowInspectHelp.stderr).toBe('');
    expect(flowInspectHelp.stdout).toContain(
      'Usage: flow inspect <name|id|uniqueName|path> [--environment ALIAS] [--solution UNIQUE_NAME] [--no-interactive-auth] [options]'
    );
    expect(flowInspectHelp.stdout).toContain('Without `--environment`, inspect a local flow artifact on disk.');
    expect(flowInspectHelp.stdout).toContain('With `--environment`, inspect a remote flow by name, id, or unique name.');
    expect(flowInspectHelp.stdout).toContain('--no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth');

    expect(flowAttachHelp.code).toBe(0);
    expect(flowAttachHelp.stderr).toBe('');
    expect(flowAttachHelp.stdout).toContain(
      'Usage: flow attach <name|id|uniqueName> --environment ALIAS --solution UNIQUE_NAME [--no-add-required-components] [--no-interactive-auth] [options]'
    );
    expect(flowAttachHelp.stdout).toContain('Dataverse AddSolutionComponent');

    expect(flowActivateHelp.code).toBe(0);
    expect(flowActivateHelp.stderr).toBe('');
    expect(flowActivateHelp.stdout).toContain('Usage: flow activate <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [options]');
    expect(flowActivateHelp.stdout).toContain('A remote flow already exists in one environment, but it is still draft or suspended');

    const flowExportHelp = await runCli(['flow', 'export', '--help']);
    expect(flowExportHelp.code).toBe(0);
    expect(flowExportHelp.stderr).toBe('');
    expect(flowExportHelp.stdout).toContain(
      'Usage: flow export <name|id|uniqueName> --environment ALIAS --out PATH [--solution UNIQUE_NAME] [--no-interactive-auth] [options]'
    );
    expect(flowExportHelp.stdout).toContain('--no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth');

    const flowConnrefsHelp = await runCli(['flow', 'connrefs', '--help']);
    expect(flowConnrefsHelp.code).toBe(0);
    expect(flowConnrefsHelp.stderr).toBe('');
    expect(flowConnrefsHelp.stdout).toContain(
      'Usage: flow connrefs <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [--since 7d] [--no-interactive-auth] [options]'
    );
    expect(flowConnrefsHelp.stdout).toContain('--no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth');
  });

  it('prints scoped help for local canvas validate, build, and diff commands', async () => {
    const validateHelp = await runCli(['canvas', 'validate', '--help']);
    const buildHelp = await runCli(['canvas', 'build', '--help']);
    const diffHelp = await runCli(['canvas', 'diff', '--help']);

    expect(validateHelp.code).toBe(0);
    expect(validateHelp.stderr).toBe('');
    expect(validateHelp.stdout).toContain(
      'Usage: canvas validate <path|workspaceApp> [--workspace FILE] [--project path] [--registry FILE] [--cache-dir DIR] [--mode strict|seeded|registry] [options]'
    );
    expect(validateHelp.stdout).toContain('`strict` prefers source-provided metadata first, then pinned registries');
    expect(validateHelp.stdout).not.toContain('CANVAS_PATH_REQUIRED');

    expect(buildHelp.code).toBe(0);
    expect(buildHelp.stderr).toBe('');
    expect(buildHelp.stdout).toContain(
      'Usage: canvas build <path|workspaceApp> [--workspace FILE] [--project path] [--registry FILE] [--cache-dir DIR] [--mode strict|seeded|registry] [--out FILE] [options]'
    );
    expect(buildHelp.stdout).toContain('Unpacked `.pa.yaml` roots can auto-consume embedded `References/Templates.json` payloads during strict builds.');
    expect(buildHelp.stdout).not.toContain('CANVAS_PATH_REQUIRED');

    expect(diffHelp.code).toBe(0);
    expect(diffHelp.stderr).toBe('');
    expect(diffHelp.stdout).toContain('Usage: canvas diff <leftPath> <rightPath> [options]');
    expect(diffHelp.stdout).toContain('Supports both legacy json-manifest roots and unpacked `.pa.yaml` roots.');
    expect(diffHelp.stdout).not.toContain('CANVAS_DIFF_ARGS_REQUIRED');
  });

  it('adds decision guidance to solution help pages', async () => {
    const solutionListHelp = await runCli(['solution', 'list', '--help']);
    const solutionInspectHelp = await runCli(['solution', 'inspect', '--help']);

    expect(solutionListHelp.stdout).toContain('Choose this when:');
    expect(solutionInspectHelp.stdout).toContain('metadata rather than the full inventory');
  });

  it('previews a multi-file dataverse metadata apply manifest through one command', async () => {
    const tempDir = await createTempDir();
    const manifestPath = join(tempDir, 'schema.apply.yaml');
    const tablePath = join(tempDir, 'project.table.yaml');
    const columnPath = join(tempDir, 'project-status.column.yaml');
    const relationshipPath = join(tempDir, 'task-project.relationship.yaml');

    await writeFile(
      manifestPath,
      [
        'operations:',
        '  - kind: create-relationship',
        '    file: task-project.relationship.yaml',
        '  - kind: add-column',
        '    tableLogicalName: pp_project',
        '    file: project-status.column.yaml',
        '  - kind: create-table',
        '    file: project.table.yaml',
      ].join('\n')
    );
    await writeFile(
      tablePath,
      [
        'schemaName: pp_Project',
        'displayName: Project',
        'pluralDisplayName: Projects',
        'primaryName:',
        '  schemaName: pp_Name',
        '  displayName: Name',
      ].join('\n')
    );
    await writeFile(
      columnPath,
      [
        'kind: choice',
        'schemaName: pp_Status',
        'displayName: Status',
        'options:',
        '  - label: New',
        '    value: 100000000',
      ].join('\n')
    );
    await writeFile(
      relationshipPath,
      [
        'schemaName: pp_project_task',
        'referencedEntity: pp_project',
        'referencingEntity: pp_task',
        'lookup:',
        '  schemaName: pp_ProjectId',
        '  displayName: Project',
      ].join('\n')
    );

    const preview = await runCli([
      'dv',
      'metadata',
      'apply',
      '--env',
      'source',
      '--file',
      manifestPath,
      '--dry-run',
      '--format',
      'json',
    ]);

    expect(preview.code).toBe(0);
    expect(preview.stderr).toBe('');
    expect(JSON.parse(preview.stdout)).toMatchObject({
      action: 'dv.metadata.apply',
      input: {
        operations: [
          { kind: 'create-table' },
          { kind: 'add-column', tableLogicalName: 'pp_project' },
          { kind: 'create-relationship' },
        ],
      },
    });
  });

  it('keeps normalized metadata column output narrowed to the requested select fields', async () => {
    const clientBase = createFixtureDataverseClient({});
    clientBase.listColumns = async () =>
      ok(
        [
          {
            LogicalName: 'pp_projectstatus',
            SchemaName: 'pp_ProjectStatus',
            AttributeType: 'Picklist',
            AttributeTypeName: { Value: 'PicklistType' },
            EntityLogicalName: 'pp_project',
            MetadataId: 'meta-1',
            IsCustomAttribute: true,
            IsManaged: false,
            IsLogical: false,
            IsValidForCreate: true,
            IsValidForRead: true,
            IsValidForUpdate: true,
            IsFilterable: true,
            IsSearchable: false,
            IsValidForAdvancedFind: { Value: true },
            IsSecured: false,
          },
        ],
        {
          supportTier: 'preview',
        },
      );
    const client: DataverseClient = clientBase;

    mockDataverseResolution({
      fixture: {
        client,
      },
    });

    const result = await runCli([
      'dv',
      'metadata',
      'columns',
      'pp_project',
      '--environment',
      'fixture',
      '--select',
      'LogicalName,SchemaName',
      '--format',
      'json',
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual([
      {
        logicalName: 'pp_projectstatus',
        schemaName: 'pp_ProjectStatus',
      },
    ]);
  });

  it('prints a compact normalized summary for dataverse metadata apply results', async () => {
    mockDataverseResolution({
      source: {
        client: {
          applyMetadataPlan: async () =>
            ok(
              {
                operations: [
                  {
                    kind: 'create-table',
                    status: 200,
                    entitySummary: {
                      logicalName: 'pp_project',
                      schemaName: 'pp_Project',
                      displayName: 'Project',
                    },
                  },
                  {
                    kind: 'add-column',
                    status: 200,
                    entitySummary: {
                      logicalName: 'pp_trackingcode',
                      entityLogicalName: 'pp_project',
                      displayName: 'Tracking Code',
                    },
                  },
                  {
                    kind: 'create-relationship',
                    status: 200,
                    entitySummary: {
                      schemaName: 'pp_project_account',
                      relationshipType: 'one-to-many',
                      referencedEntity: 'account',
                      referencingEntity: 'pp_project',
                    },
                  },
                ],
                summary: {
                  operationCount: 3,
                  operationsByKind: {
                    'create-table': 1,
                    'add-column': 1,
                    'create-relationship': 1,
                  },
                  tables: [{ logicalName: 'pp_project', schemaName: 'pp_Project', displayName: 'Project' }],
                  columns: [{ logicalName: 'pp_trackingcode', entityLogicalName: 'pp_project', displayName: 'Tracking Code' }],
                  relationships: [
                    {
                      schemaName: 'pp_project_account',
                      relationshipType: 'one-to-many',
                      referencedEntity: 'account',
                      referencingEntity: 'pp_project',
                    },
                  ],
                },
                published: true,
                publishTargets: ['account', 'pp_project'],
              },
              {
                supportTier: 'preview',
              }
            ),
        } as unknown as DataverseClient,
      },
    });

    const tempDir = await createTempDir();
    const manifestPath = join(tempDir, 'schema.apply.yaml');
    const tablePath = join(tempDir, 'project.table.yaml');

    await writeFile(
      manifestPath,
      ['operations:', '  - kind: create-table', '    file: project.table.yaml'].join('\n')
    );
    await writeFile(
      tablePath,
      [
        'schemaName: pp_Project',
        'displayName: Project',
        'pluralDisplayName: Projects',
        'primaryName:',
        '  schemaName: pp_Name',
        '  displayName: Name',
      ].join('\n')
    );

    const apply = await runCli(['dv', 'metadata', 'apply', '--env', 'source', '--file', manifestPath, '--format', 'json']);

    expect(apply.code).toBe(0);
    expect(apply.stderr).toContain('Applying Dataverse metadata plan: 1 operations (create-table=1); publish enabled.');
    expect(apply.stderr).toContain('Dataverse metadata apply completed: 3 operations; published 2 table target(s).');
    expect(JSON.parse(apply.stdout)).toMatchObject({
      operations: [
        {
          kind: 'create-table',
          status: 200,
          entitySummary: { logicalName: 'pp_project', schemaName: 'pp_Project' },
        },
        {
          kind: 'add-column',
          status: 200,
          entitySummary: { logicalName: 'pp_trackingcode', entityLogicalName: 'pp_project' },
        },
        {
          kind: 'create-relationship',
          status: 200,
          entitySummary: { schemaName: 'pp_project_account', referencedEntity: 'account', referencingEntity: 'pp_project' },
        },
      ],
      summary: {
        operationCount: 3,
        operationsByKind: {
          'create-table': 1,
          'add-column': 1,
          'create-relationship': 1,
        },
        tables: [{ logicalName: 'pp_project', schemaName: 'pp_Project' }],
        columns: [{ logicalName: 'pp_trackingcode', entityLogicalName: 'pp_project' }],
        relationships: [{ schemaName: 'pp_project_account', referencedEntity: 'account', referencingEntity: 'pp_project' }],
      },
      published: true,
      publishTargets: ['account', 'pp_project'],
    });
    expect(JSON.parse(apply.stdout).operations.every((operation: Record<string, unknown>) => !('entity' in operation))).toBe(true);
  });

  it('attaches a remote canvas app through the CLI entrypoint', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        query: {
          solutions: [{ solutionid: 'sol-1', uniquename: 'Core' }],
        },
        queryAll: {
          canvasapps: [
            {
              canvasappid: 'canvas-1',
              displayname: 'Harness Canvas',
              name: 'crd_HarnessCanvas',
            },
          ],
        },
      }),
    });

    const attach = await runCli(['canvas', 'attach', 'Harness Canvas', '--env', 'source', '--solution', 'Core', '--format', 'json']);

    expect(attach.code).toBe(0);
    expect(attach.stderr).toBe('');
    expect(JSON.parse(attach.stdout)).toMatchObject({
      attached: true,
      solutionUniqueName: 'Core',
      app: {
        id: 'canvas-1',
        displayName: 'Harness Canvas',
      },
      addRequiredComponents: true,
    });
  });

  it('renders a bounded read-only plan for remote canvas attach through the CLI entrypoint', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        query: {
          solutions: [{ solutionid: 'sol-1', uniquename: 'Core', friendlyname: 'Core Solution', version: '1.0.0.0', ismanaged: false }],
        },
        queryAll: {
          canvasapps: [
            {
              canvasappid: 'canvas-1',
              displayname: 'Harness Canvas',
              name: 'crd_HarnessCanvas',
            },
          ],
          solutioncomponents: [
            { solutioncomponentid: 'comp-canvas', objectid: 'canvas-1', componenttype: 300, _solutionid_value: 'sol-1' },
            { solutioncomponentid: 'comp-entity', objectid: 'entity-project', componenttype: 1, _solutionid_value: 'sol-1' },
          ],
          dependencies: [
            {
              dependencyid: 'dep-1',
              dependencytype: 0,
              requiredcomponentobjectid: 'entity-account',
              requiredcomponenttype: 1,
              dependentcomponentobjectid: 'canvas-1',
              dependentcomponenttype: 300,
            },
          ],
          solutions: [{ solutionid: 'sol-1', uniquename: 'Core', friendlyname: 'Core Solution', ismanaged: false }],
        },
        listTables: [
          { MetadataId: 'entity-project', LogicalName: 'pp_project', SchemaName: 'pp_Project', DisplayName: { UserLocalizedLabel: { Label: 'PP Harness Project' } } },
          { MetadataId: 'entity-account', LogicalName: 'account', SchemaName: 'Account', DisplayName: { UserLocalizedLabel: { Label: 'Account' } } },
        ],
      }),
    });

    const attach = await runCli(['canvas', 'attach', 'Harness Canvas', '--env', 'source', '--solution', 'Core', '--plan', '--format', 'json']);

    expect(attach.code).toBe(0);
    expect(attach.stderr).toBe('');
    expect(JSON.parse(attach.stdout)).toMatchObject({
      action: 'canvas.attach',
      mode: 'plan',
      willMutate: false,
      preview: {
        alreadyInTargetSolution: true,
        targetSolution: {
          uniquename: 'Core',
          friendlyname: 'Core Solution',
        },
        containingSolutions: [
          {
            uniqueName: 'Core',
          },
        ],
        targetSolutionBaseline: {
          summary: {
            componentCount: 2,
            canvasAppCount: 1,
            missingDependencyCount: 1,
          },
        },
      },
      knownLimitations: expect.arrayContaining([
        'This preview is read-only and cannot predict the exact component set Dataverse will add during AddSolutionComponent.',
      ]),
    });
  });

  it('inspects a solution-scoped remote canvas app by display name after attach through the CLI entrypoint', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        query: {
          solutions: [{ solutionid: 'sol-1', uniquename: 'Core' }],
        },
        queryAll: {
          canvasapps: [
            {
              canvasappid: 'canvas-1',
              displayname: 'Harness Canvas',
              name: 'crd_HarnessCanvas',
              appopenuri: 'https://make.powerapps.com/e/test/canvas/?app-id=canvas-1',
            },
          ],
          solutioncomponents: [{ solutioncomponentid: 'comp-1', objectid: 'canvas-1', componenttype: 300 }],
        },
      }),
    });

    const inspect = await runCli(['canvas', 'inspect', 'Harness Canvas', '--env', 'source', '--solution', 'Core', '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      id: 'canvas-1',
      displayName: 'Harness Canvas',
      name: 'crd_HarnessCanvas',
      portalProvenance: {
        makerStudioUrl: 'https://make.powerapps.com/e/test/canvas/?app-id=canvas-1&action=edit',
      },
      handoff: {
        makerStudio: {
          inspectCommand: 'pp canvas inspect "Harness Canvas" --environment source --solution Core',
        },
        runtime: {
          playUrl: 'https://make.powerapps.com/e/test/canvas/?app-id=canvas-1',
          expectedHosts: {
            runtime: 'make.powerapps.com',
            authRedirect: 'login.microsoftonline.com',
            makerStudio: 'make.powerapps.com',
          },
        },
        download: {
          solutionUniqueName: 'Core',
          downloadCommand: 'pp canvas download "Harness Canvas" --environment source --solution Core',
        },
      },
    });
  });

  it('downloads a remote canvas app through the CLI entrypoint by auto-resolving a unique containing solution', async () => {
    const tempDir = await createTempDir();
    const sourceDir = join(tempDir, 'solution');
    await mkdir(join(sourceDir, 'CanvasApps'), { recursive: true });
    await writeFile(join(sourceDir, 'CanvasApps', 'crd_HarnessCanvas.msapp'), 'cli-exported-msapp', 'utf8');
    await writeSolutionExportMetadata(sourceDir);
    const solutionZip = join(tempDir, 'Core.zip');
    await createZipPackage(sourceDir, solutionZip);

    const client = {
      ...createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
              friendlyname: 'Core',
              version: '1.0.0.0',
            },
          ],
        },
        queryAll: {
          canvasapps: [
            {
              canvasappid: 'canvas-1',
              displayname: 'Harness Canvas',
              name: 'crd_HarnessCanvas',
              tags: 'harness',
            },
          ],
          solutioncomponents: [
            {
              objectid: 'canvas-1',
              _solutionid_value: 'sol-1',
              componenttype: 300,
            },
          ],
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
              friendlyname: 'Core',
              ismanaged: false,
            },
          ],
        },
      }),
      invokeAction: async <T>(name: string) =>
        ok(
          {
            body: {
              ExportSolutionFile: name === 'ExportSolution' ? (await readFile(solutionZip)).toString('base64') : undefined,
            } as T,
          },
          {
            supportTier: 'preview',
          }
        ),
    } as unknown as DataverseClient;

    mockDataverseResolution({
      fixture: {
        client,
      },
    });

    const outPath = join(tempDir, 'artifacts', 'HarnessCanvas.msapp');
    const result = await runCli([
      'canvas',
      'download',
      'Harness Canvas',
      '--env',
      'fixture',
      '--out',
      outPath,
      '--format',
      'json',
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('[pp] canvas download: resolving remote app');
    expect(result.stderr).toContain('auto-resolved from solution membership');
    expect(JSON.parse(result.stdout)).toMatchObject({
      solutionUniqueName: 'Core',
      solutionResolution: {
        status: 'ready',
        autoResolved: true,
        resolvedSolutionUniqueName: 'Core',
      },
    });
    expect(await readFile(outPath, 'utf8')).toBe('cli-exported-msapp');
  });

  it('returns a stable not-found contract for missing environment variables', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        queryAll: {
          environmentvariabledefinitions: [],
          environmentvariablevalues: [],
        },
      }),
    });

    const inspect = await runCli(['envvar', 'inspect', 'definitely_missing', '--env', 'source', '--format', 'json']);

    expect(inspect.code).toBe(1);
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      success: false,
      diagnostics: [
        {
          code: 'ENVVAR_NOT_FOUND',
          message: 'Environment variable definitely_missing was not found.',
        },
      ],
      supportTier: 'preview',
    });
    expect(inspect.stderr).toBe('');
  });

  it('covers solution creation through the CLI entrypoint', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        query: {
          publishers: [
            {
              publisherid: 'pub-1',
              uniquename: 'DefaultPublisher',
            },
          ],
        },
      }),
    });

    const create = await runCli([
      'solution',
      'create',
      'HarnessShell',
      '--env',
      'source',
      '--friendly-name',
      'Harness Shell',
      '--publisher-unique-name',
      'DefaultPublisher',
      '--description',
      'Disposable harness solution',
      '--format',
      'json',
    ]);

    expect(create.code).toBe(0);
    expect(create.stderr).toBe('');
    expect(JSON.parse(create.stdout)).toMatchObject({
      solutionid: 'fixture-solutions-1',
      uniquename: 'HarnessShell',
      friendlyname: 'Harness Shell',
      version: '1.0.0.0',
    });
  });

  it('suggests available publishers when solution creation omits publisher selection', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        query: {
          publishers: [
            {
              publisherid: 'pub-1',
              uniquename: 'DefaultPublisher',
              friendlyname: 'Default Publisher',
            },
            {
              publisherid: 'pub-2',
              uniquename: 'pp',
              friendlyname: 'Power Platform',
            },
          ],
        },
      }),
    });

    const create = await runCli(['solution', 'create', 'HarnessShell', '--env', 'source', '--format', 'json']);

    expect(create.code).toBe(1);
    expect(JSON.parse(create.stdout)).toMatchObject({
      success: false,
      diagnostics: [
        expect.objectContaining({
          code: 'SOLUTION_PUBLISHER_REQUIRED',
          message: 'A publisher is required. Use --publisher-id or --publisher-unique-name.',
          detail: expect.stringContaining('DefaultPublisher'),
        }),
      ],
      suggestedNextActions: expect.arrayContaining([
        'Retry with `pp solution create HarnessShell --environment <alias> --publisher-unique-name DefaultPublisher`.',
        'Retry with `pp solution create HarnessShell --environment <alias> --publisher-unique-name pp`.',
      ]),
      supportTier: 'preview',
    });
    expect(create.stderr).toBe('');
  });

  it('infers the publisher during solution creation when the unique-name prefix matches one publisher', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        query: {
          publishers: [
            {
              publisherid: 'pub-1',
              uniquename: 'DefaultPublisher',
              friendlyname: 'Default Publisher',
              customizationprefix: 'new',
            },
            {
              publisherid: 'pub-2',
              uniquename: 'pp',
              friendlyname: 'Power Platform',
              customizationprefix: 'pp',
            },
          ],
        },
      }),
    });

    const create = await runCli(['solution', 'create', 'ppHarnessShell', '--env', 'source', '--format', 'json']);

    expect(create.code).toBe(0);
    expect(JSON.parse(create.stdout)).toMatchObject({
      solutionid: 'fixture-solutions-1',
      uniquename: 'ppHarnessShell',
    });
    expect(create.stderr).toBe('');
  });

  it('lists available publishers through a first-class solution command', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        query: {
          publishers: [
            {
              publisherid: 'pub-1',
              uniquename: 'DefaultPublisher',
              friendlyname: 'Default Publisher',
            },
            {
              publisherid: 'pub-2',
              uniquename: 'pp',
              friendlyname: 'Power Platform',
            },
          ],
        },
      }),
    });

    const publishers = await runCli(['solution', 'publishers', '--env', 'source', '--format', 'json']);

    expect(publishers.code).toBe(0);
    expect(publishers.stderr).toBe('');
    expect(JSON.parse(publishers.stdout)).toEqual({
      success: true,
      publishers: [
        {
          publisherid: 'pub-1',
          uniquename: 'DefaultPublisher',
          friendlyname: 'Default Publisher',
        },
        {
          publisherid: 'pub-2',
          uniquename: 'pp',
          friendlyname: 'Power Platform',
        },
      ],
      diagnostics: [],
      warnings: [],
      suggestedNextActions: [],
      supportTier: 'preview',
      provenance: [],
      knownLimitations: [],
    });
  });

  it('covers solution metadata updates through the CLI entrypoint', async () => {
    const sourceClient = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'sol-1',
            uniquename: 'HarnessShell',
            friendlyname: 'Harness Shell',
            version: '1.0.0.0',
            _publisherid_value: 'pub-0',
          },
        ],
        publishers: [
          {
            publisherid: 'pub-1',
            uniquename: 'HarnessPublisher',
            friendlyname: 'Harness Publisher',
            customizationprefix: 'pp',
          },
        ],
      },
      queryAll: {
        solutions: [
          {
            solutionid: 'sol-1',
            uniquename: 'HarnessShell',
            friendlyname: 'Harness Shell',
            version: '1.0.0.0',
            _publisherid_value: 'pub-0',
          },
        ],
      },
    });

    mockDataverseResolution({
      source: {
        client: {
          ...sourceClient,
          getById: async <T>(table: string, id: string) => {
            if (table === 'publishers' && id === 'pub-1') {
              return ok(
                {
                  publisherid: 'pub-1',
                  uniquename: 'HarnessPublisher',
                  friendlyname: 'Harness Publisher',
                  customizationprefix: 'pp',
                } as T,
                { supportTier: 'preview' }
              );
            }

            return ok({} as T, { supportTier: 'preview' });
          },
        } as unknown as DataverseClient,
      },
    });

    const update = await runCli([
      'solution',
      'set-metadata',
      'HarnessShell',
      '--env',
      'source',
      '--version',
      '2026.3.10.34135',
      '--publisher-unique-name',
      'HarnessPublisher',
      '--format',
      'json',
    ]);

    expect(update.code).toBe(0);
    expect(update.stderr).toBe('');
    expect(JSON.parse(update.stdout)).toMatchObject({
      solutionid: 'sol-1',
      uniquename: 'HarnessShell',
      friendlyname: 'Harness Shell',
      version: '2026.3.10.34135',
      publisher: {
        publisherid: 'pub-1',
        uniquename: 'HarnessPublisher',
        friendlyname: 'Harness Publisher',
        customizationprefix: 'pp',
      },
    });
  });

  it('surfaces publisher metadata in solution inspect output through the CLI entrypoint', async () => {
    const sourceClient = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'sol-1',
            uniquename: 'HarnessShell',
            friendlyname: 'Harness Shell',
            version: '2026.3.10.34135',
            ismanaged: false,
            _publisherid_value: 'pub-1',
          },
        ],
        publishers: [
          {
            publisherid: 'pub-1',
            uniquename: 'pp',
            friendlyname: 'pp',
            customizationprefix: 'pp',
            customizationoptionvalueprefix: 12560,
          },
        ],
      },
    });
    mockDataverseResolution({
      source: {
        client: {
          ...sourceClient,
          getById: async <T>(table: string, id: string) => {
            if (table === 'publishers' && id === 'pub-1') {
              return ok(
                {
                  publisherid: 'pub-1',
                  uniquename: 'pp',
                  friendlyname: 'pp',
                  customizationprefix: 'pp',
                  customizationoptionvalueprefix: 12560,
                } as T,
                { supportTier: 'preview' }
              );
            }

            return ok({} as T, { supportTier: 'preview' });
          },
        } as unknown as DataverseClient,
      },
    });

    const inspect = await runCli(['solution', 'inspect', 'HarnessShell', '--env', 'source', '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      success: true,
      supportTier: 'preview',
      solutionid: 'sol-1',
      uniquename: 'HarnessShell',
      friendlyname: 'Harness Shell',
      version: '2026.3.10.34135',
      ismanaged: false,
      publisher: {
        publisherid: 'pub-1',
        uniquename: 'pp',
        friendlyname: 'pp',
        customizationprefix: 'pp',
        customizationoptionvalueprefix: 12560,
      },
    });
  });

  it('covers connection reference validation with live display-name fields through the CLI entrypoint', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'solution-1',
              uniquename: 'HarnessShell',
              friendlyname: 'Harness Shell',
              version: '1.0.0.0',
            },
          ],
        },
        queryAll: {
          connectionreferences: [
            {
              connectionreferenceid: 'connref-1',
              connectionreferencelogicalname: 'pp_shared_sql',
              connectionreferencedisplayname: 'Shared SQL',
              connectorid: '/providers/Microsoft.PowerApps/apis/shared_sql',
              connectionid: 'connection-1',
              _solutionid_value: 'solution-1',
              statecode: 0,
            },
          ],
          solutioncomponents: [
            {
              objectid: 'connref-1',
            },
          ],
        },
      }),
    });

    const validate = await runCli(['connref', 'validate', '--env', 'source', '--solution', 'HarnessShell', '--format', 'json']);

    expect(validate.code).toBe(0);
    expect(validate.stderr).toBe('');
    expect(JSON.parse(validate.stdout)).toMatchObject({
      success: true,
      results: [
        {
          reference: {
            id: 'connref-1',
            logicalName: 'pp_shared_sql',
            displayName: 'Shared SQL',
            connectorId: '/providers/Microsoft.PowerApps/apis/shared_sql',
            connectionId: 'connection-1',
            solutionId: 'solution-1',
            stateCode: 0,
            connected: true,
          },
          valid: true,
          diagnostics: [],
          suggestedNextActions: [],
        },
      ],
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'DATAVERSE_CONNREF_LIST_SUMMARY',
        }),
        expect.objectContaining({
          code: 'DATAVERSE_CONNREF_VALIDATE_OK',
        }),
      ]),
    });
  });

  it('reports empty connection-reference validation scope through stderr diagnostics', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        queryAll: {
          connectionreferences: [],
        },
      }),
    });

    const validate = await runCli(['connref', 'validate', '--env', 'source', '--format', 'json']);

    expect(validate.code).toBe(0);
    expect(validate.stderr).toBe('');
    expect(JSON.parse(validate.stdout)).toMatchObject({
      success: true,
      results: [],
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'DATAVERSE_CONNREF_SCOPE_EMPTY',
        }),
        expect.objectContaining({
          code: 'DATAVERSE_CONNREF_VALIDATE_EMPTY',
        }),
      ]),
    });
  });

  it('creates and rebinds connection references through the CLI entrypoint', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'solution-1',
              uniquename: 'HarnessShell',
              friendlyname: 'Harness Shell',
              version: '1.0.0.0',
            },
          ],
        },
        queryAll: {
          connectionreferences: [
            {
              connectionreferenceid: 'connref-1',
              connectionreferencelogicalname: 'pp_shared_sql',
              connectionreferencedisplayname: 'Shared SQL',
              connectorid: '/providers/Microsoft.PowerApps/apis/shared_sql',
              connectionid: '/providers/Microsoft.PowerApps/apis/shared_sql/connections/shared-sql-123',
              _solutionid_value: 'solution-1',
              statecode: 0,
            },
          ],
          solutioncomponents: [
            {
              objectid: 'connref-1',
            },
          ],
        },
      }),
    });

    const created = await runCli([
      'connref',
      'create',
      'pp_shared_office365',
      '--env',
      'source',
      '--solution',
      'HarnessShell',
      '--display-name',
      'Shared Office 365',
      '--connector-id',
      '/providers/Microsoft.PowerApps/apis/shared_office365',
      '--connection-id',
      '/providers/Microsoft.PowerApps/apis/shared_office365/connections/shared-office365-123',
      '--format',
      'json',
    ]);
    const rebound = await runCli([
      'connref',
      'set',
      'pp_shared_sql',
      '--env',
      'source',
      '--solution',
      'HarnessShell',
      '--connection-id',
      '/providers/Microsoft.PowerApps/apis/shared_sql/connections/shared-sql-456',
      '--format',
      'json',
    ]);

    expect(created.code).toBe(0);
    expect(created.stderr).toBe('');
    expect(JSON.parse(created.stdout)).toMatchObject({
      logicalName: 'pp_shared_office365',
      displayName: 'Shared Office 365',
      connectorId: '/providers/Microsoft.PowerApps/apis/shared_office365',
      connectionId: '/providers/Microsoft.PowerApps/apis/shared_office365/connections/shared-office365-123',
      connected: true,
    });

    expect(rebound.code).toBe(0);
    expect(rebound.stderr).toBe('');
    expect(JSON.parse(rebound.stdout)).toMatchObject({
      logicalName: 'pp_shared_sql',
      displayName: 'Shared SQL',
      connectorId: '/providers/Microsoft.PowerApps/apis/shared_sql',
      connectionId: '/providers/Microsoft.PowerApps/apis/shared_sql/connections/shared-sql-456',
      connected: true,
    });
  });

  it('creates an unbound connection reference through the CLI entrypoint', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        queryAll: {
          connectionreferences: [],
        },
      }),
    });

    const created = await runCli([
      'connref',
      'create',
      'pp_dataverse',
      '--env',
      'source',
      '--display-name',
      'Dataverse',
      '--connector-id',
      '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
      '--allow-unbound',
      '--format',
      'json',
    ]);

    expect(created.code).toBe(0);
    expect(created.stderr).toBe('');
    expect(JSON.parse(created.stdout)).toMatchObject({
      logicalName: 'pp_dataverse',
      displayName: 'Dataverse',
      connectorId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
      connected: false,
    });
  });

  it('attaches an existing flow to a solution through the CLI entrypoint', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'solution-1',
              uniquename: 'Core',
            },
          ],
        },
        queryAll: {
          workflows: [
            {
              workflowid: 'flow-1',
              name: 'Invoice Sync',
              uniquename: 'crd_InvoiceSync',
              category: 5,
              statecode: 1,
              statuscode: 2,
              clientdata: JSON.stringify({ definition: { actions: {} } }),
            },
          ],
          solutioncomponents: [],
        },
      }),
    });

    const attached = await runCli([
      'flow',
      'attach',
      'Invoice Sync',
      '--env',
      'source',
      '--solution',
      'Core',
      '--format',
      'json',
    ]);

    expect(attached.code).toBe(0);
    expect(attached.stderr).toBe('');
    expect(JSON.parse(attached.stdout)).toMatchObject({
      success: true,
      attached: true,
      solutionUniqueName: 'Core',
      addRequiredComponents: true,
      flow: expect.objectContaining({
        id: 'flow-1',
        name: 'Invoice Sync',
        uniqueName: 'crd_InvoiceSync',
      }),
    });
  });

  it('covers model-driven app inspection workflows through the CLI entrypoint', async () => {
    const fixture = (await readJsonFile(resolveRepoPath('fixtures', 'model', 'runtime', 'sales-hub.json'))) as DataverseFixture;

    mockDataverseResolution({
      source: createFixtureDataverseClient(fixture),
    });

    const list = await runCli(['model', 'list', '--env', 'source', '--solution', 'Core', '--format', 'json']);
    const inspect = await runCli(['model', 'inspect', 'Sales Hub', '--env', 'source', '--solution', 'Core', '--format', 'json']);
    const sitemap = await runCli(['model', 'sitemap', 'Sales Hub', '--env', 'source', '--solution', 'Core', '--format', 'json']);
    const forms = await runCli(['model', 'forms', 'Sales Hub', '--env', 'source', '--solution', 'Core', '--format', 'json']);
    const views = await runCli(['model', 'views', 'Sales Hub', '--env', 'source', '--solution', 'Core', '--format', 'json']);
    const dependencies = await runCli([
      'model',
      'dependencies',
      'Sales Hub',
      '--env',
      'source',
      '--solution',
      'Core',
      '--format',
      'json',
    ]);

    expect(list.code).toBe(0);
    expect(list.stderr).toBe('');
    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(sitemap.code).toBe(0);
    expect(sitemap.stderr).toBe('');
    expect(forms.code).toBe(0);
    expect(forms.stderr).toBe('');
    expect(views.code).toBe(0);
    expect(views.stderr).toBe('');
    expect(dependencies.code).toBe(0);
    expect(dependencies.stderr).toBe('');

    await expectGoldenJson(JSON.parse(list.stdout), 'fixtures/cli/golden/protocol/model-list-report.json');
    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/cli/golden/protocol/model-inspect-report.json');
    await expectGoldenJson(JSON.parse(sitemap.stdout), 'fixtures/cli/golden/protocol/model-sitemap-report.json');
    await expectGoldenJson(JSON.parse(forms.stdout), 'fixtures/cli/golden/protocol/model-forms-report.json');
    await expectGoldenJson(JSON.parse(views.stdout), 'fixtures/cli/golden/protocol/model-views-report.json');
    await expectGoldenJson(JSON.parse(dependencies.stdout), 'fixtures/cli/golden/protocol/model-dependencies-report.json');
  });

  it('explains empty model artifact projections when component inspection is unavailable', async () => {
    const fixture = (await readJsonFile(resolveRepoPath('fixtures', 'model', 'runtime', 'sales-hub.json'))) as DataverseFixture;
    const baseClient = createFixtureDataverseClient(fixture);
    const client = {
      ...baseClient,
      queryAll: async <T>(options: { table: string }) => {
        if (options.table === 'appmodulecomponents') {
          return fail(
            createDiagnostic('error', 'HTTP_REQUEST_FAILED', 'appmodulecomponents query failed', {
              source: '@pp/http',
            })
          );
        }

        if (options.table === 'dependencies') {
          return ok(
            [
              {
                dependencyid: 'dep-1',
                dependentcomponentobjectid: 'app-1',
                dependentcomponenttype: 80,
                requiredcomponentobjectid: 'sitemap-1',
                requiredcomponenttype: 62,
              },
            ] as T[],
            {
              supportTier: 'preview',
            }
          );
        }

        return baseClient.queryAll<T>(options);
      },
    } as DataverseClient;

    mockDataverseResolution({
      source: client,
    });

    const sitemap = await runCli(['model', 'sitemap', 'Sales Hub', '--env', 'source', '--solution', 'Core', '--format', 'json']);

    expect(sitemap.code).toBe(0);
    expect(JSON.parse(sitemap.stdout)).toMatchObject({
      app: {
        id: 'app-1',
        name: 'Sales Hub',
        uniqueName: 'SalesHub',
      },
      items: [
        {
          id: 'sitemap-1',
          name: 'Sales Hub sitemap',
        },
      ],
      summary: {
        artifactKind: 'sitemap',
        count: 1,
        componentCount: 1,
        missingComponentCount: 0,
      },
      coverage: {
        componentMembershipSource: 'dependencies',
        componentInspectionAvailable: true,
        omissionReason: {
          code: 'MODEL_COMPONENTS_UNAVAILABLE',
          message: 'Model-driven app component inspection was unavailable for Sales Hub; inferred composition from Dataverse dependency rows instead.',
        },
        inferenceReason: {
          code: 'MODEL_COMPONENTS_INFERRED_FROM_DEPENDENCIES',
        },
      },
    });
    expect(JSON.parse(sitemap.stderr)).toMatchObject({
      success: true,
      warnings: [
        expect.objectContaining({
          code: 'MODEL_COMPONENTS_UNAVAILABLE',
        }),
        expect.objectContaining({
          code: 'MODEL_COMPONENTS_INFERRED_FROM_DEPENDENCIES',
        }),
      ],
    });
  });

  it('creates and attaches model-driven apps through the CLI entrypoint', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'solution-1',
              uniquename: 'Core',
            },
          ],
        },
        queryAll: {
          appmodules: [],
          solutioncomponents: [],
        },
      }),
    });

    const created = await runCli([
      'model',
      'create',
      'ServiceHub',
      '--env',
      'source',
      '--solution',
      'Core',
      '--name',
      'Service Hub',
      '--format',
      'json',
    ]);
    const attached = await runCli([
      'model',
      'attach',
      'ServiceHub',
      '--env',
      'source',
      '--solution',
      'Core',
      '--format',
      'json',
    ]);

    expect(created.code).toBe(0);
    expect(created.stderr).toBe('');
    expect(JSON.parse(created.stdout)).toMatchObject({
      id: 'fixture-appmodules-1',
      uniqueName: 'ServiceHub',
      name: 'Service Hub',
    });

    expect(attached.code).toBe(0);
    expect(attached.stderr).toBe('');
    expect(JSON.parse(attached.stdout)).toMatchObject({
      attached: true,
      solutionUniqueName: 'Core',
      addRequiredComponents: true,
      app: {
        id: 'fixture-appmodules-1',
        uniqueName: 'ServiceHub',
        name: 'Service Hub',
      },
    });
  });

  it('derives the model-driven app solution from the environment alias defaultSolution', async () => {
    const configDir = await createTempDir();

    mockDataverseResolution({
      source: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'solution-1',
              uniquename: 'Core',
            },
          ],
        },
        queryAll: {
          appmodules: [],
          solutioncomponents: [],
        },
      }),
    });

    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          environments: {
            source: {
              alias: 'source',
              url: 'https://source.crm.dynamics.com',
              authProfile: 'source-user',
              defaultSolution: 'Core',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const created = await runCli([
      'model',
      'create',
      'ServiceHub',
      '--env',
      'source',
      '--config-dir',
      configDir,
      '--name',
      'Service Hub',
      '--format',
      'json',
    ]);
    const attached = await runCli([
      'model',
      'attach',
      'ServiceHub',
      '--env',
      'source',
      '--config-dir',
      configDir,
      '--format',
      'json',
    ]);

    expect(created.code).toBe(0);
    expect(created.stderr).toBe('');
    expect(JSON.parse(created.stdout)).toMatchObject({
      id: 'fixture-appmodules-1',
      uniqueName: 'ServiceHub',
      name: 'Service Hub',
    });

    expect(attached.code).toBe(0);
    expect(attached.stderr).toBe('');
    expect(JSON.parse(attached.stdout)).toMatchObject({
      attached: true,
      solutionUniqueName: 'Core',
      addRequiredComponents: true,
      app: {
        id: 'fixture-appmodules-1',
        uniqueName: 'ServiceHub',
        name: 'Service Hub',
      },
    });
  });

  it('blocks Dataverse write commands against read-only environments', async () => {
    const configDir = await createTempDir();
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          authProfiles: {
            'prod-user': {
              name: 'prod-user',
              type: 'user',
            },
          },
          browserProfiles: {},
          environments: {
            prod: {
              alias: 'prod',
              url: 'https://prod.crm.dynamics.com',
              authProfile: 'prod-user',
              access: {
                mode: 'read-only',
              },
            },
          },
          preferences: {},
        },
        null,
        2
      ),
      'utf8'
    );

    const result = await runCli([
      'dv',
      'update',
      'accounts',
      '00000000-0000-0000-0000-000000000001',
      '--env',
      'prod',
      '--config-dir',
      configDir,
      '--body',
      '{"name":"Blocked"}',
      '--format',
      'json',
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      success: false,
      diagnostics: [
        expect.objectContaining({
          code: 'ENVIRONMENT_WRITE_BLOCKED',
          message: expect.stringContaining('configured read-only'),
        }),
      ],
    });
  });

  it('allows Dataverse read commands against read-only environments', async () => {
    const configDir = await createTempDir();
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          authProfiles: {
            'prod-user': {
              name: 'prod-user',
              type: 'user',
            },
          },
          browserProfiles: {},
          environments: {
            prod: {
              alias: 'prod',
              url: 'https://prod.crm.dynamics.com',
              authProfile: 'prod-user',
              access: {
                mode: 'read-only',
              },
            },
          },
          preferences: {},
        },
        null,
        2
      ),
      'utf8'
    );

    mockDataverseResolution({
      prod: createFixtureDataverseClient({
        query: {
          accounts: [
            {
              accountid: '00000000-0000-0000-0000-000000000001',
              name: 'Allowed Read',
            },
          ],
        },
      }),
    });

    const result = await runCli([
      'dv',
      'query',
      'accounts',
      '--env',
      'prod',
      '--config-dir',
      configDir,
      '--select',
      'accountid,name',
      '--format',
      'json',
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      success: true,
    });
  });
});
