import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJsonFile } from '@pp/artifacts';
import { AuthService } from '@pp/auth';
import type { DataverseClient } from '@pp/dataverse';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { PowerBiClient } from '@pp/powerbi';
import { SharePointClient } from '@pp/sharepoint';
import { type DataverseFixture, createFixtureDataverseClient, mockDataverseResolution } from '../../../test/dataverse-fixture';
import { expectGoldenJson, expectGoldenText, mapSnapshotStrings, repoRoot, resolveRepoPath } from '../../../test/golden';
import * as canvasCreateDelegate from './canvas-create-delegate';
import { main } from './index';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((path) => rm(path, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pp-cli-integration-'));
  tempDirs.push(path);
  return path;
}

async function createSolutionArchive(path: string, managed: boolean): Promise<void> {
  const root = await createTempDir();
  await writeFile(
    join(root, 'Solution.xml'),
    [
      '<ImportExportXml>',
      '  <SolutionManifest>',
      '    <UniqueName>Core</UniqueName>',
      '    <Version>1.2.3.4</Version>',
      `    <Managed>${managed ? '1' : '0'}</Managed>`,
      '  </SolutionManifest>',
      '</ImportExportXml>',
      '',
    ].join('\n'),
    'utf8'
  );

  const zipResult = spawnSync('zip', ['-rqX', path, '.'], {
    cwd: root,
    encoding: 'utf8',
  });

  expect(zipResult.status).toBe(0);
}

async function writePortfolioFixtureProject(
  root: string,
  config: {
    owner?: string;
    docsPaths?: string[];
    providerKind: string;
    providerTarget: string;
    defaultEnvironment: string;
    stageEnvironment: string;
    solutionUniqueName: string;
    assetRoot: string;
    includeMissingAsset?: boolean;
    includeRequiredSecret?: boolean;
    sensitiveLiteral?: boolean;
  }
): Promise<string> {
  await mkdir(join(root, config.assetRoot), { recursive: true });
  await mkdir(join(root, 'docs'), { recursive: true });

  const docsSection =
    config.owner || (config.docsPaths ?? []).length > 0
      ? [
          'docs:',
          ...(config.owner ? [`  owner: ${config.owner}`] : []),
          ...((config.docsPaths ?? []).length > 0 ? ['  paths:', ...(config.docsPaths ?? []).map((path) => `    - ${path}`)] : []),
        ]
      : [];
  const missingAssetSection = config.includeMissingAsset ? ['  flows: flows'] : [];
  const parameterLines = [
    'parameters:',
    '  tenantDomain:',
    '    type: string',
    '    fromEnv: PP_TENANT_DOMAIN',
    '    required: true',
    ...(config.sensitiveLiteral
      ? [
          '  apiToken:',
          '    type: string',
          '    value: super-secret',
          '    secretRef: api_token',
          '    required: true',
        ]
      : []),
    ...(config.includeRequiredSecret
      ? [
          '  deployKey:',
          '    type: string',
          '    secretRef: deploy_key',
          '    required: true',
        ]
      : []),
  ];

  await writeFile(
    join(root, 'pp.config.yaml'),
    [
      'name: portfolio-fixture',
      'defaults:',
      `  environment: ${config.defaultEnvironment}`,
      '  solution: core',
      'solutions:',
      '  core:',
      `    environment: ${config.defaultEnvironment}`,
      `    uniqueName: ${config.solutionUniqueName}`,
      'assets:',
      `  apps: ${config.assetRoot}`,
      ...missingAssetSection,
      'providerBindings:',
      '  primaryDataverse:',
      `    kind: ${config.providerKind}`,
      `    target: ${config.providerTarget}`,
      ...parameterLines,
      'topology:',
      '  defaultStage: prod',
      '  stages:',
      '    prod:',
      `      environment: ${config.stageEnvironment}`,
      '      solution: core',
      ...docsSection,
      '',
    ].join('\n'),
    'utf8'
  );

  return root;
}

async function writeUnpackedCanvasFixture(
  root: string,
  options: {
    name: string;
    screenYaml: string;
    registry: Record<string, unknown>;
  }
): Promise<string> {
  const appRoot = join(root, options.name);
  await mkdir(join(appRoot, 'Src'), { recursive: true });
  await mkdir(join(appRoot, 'Controls'), { recursive: true });
  await mkdir(join(appRoot, 'References'), { recursive: true });
  await mkdir(join(appRoot, 'Resources'), { recursive: true });

  await writeFile(
    join(appRoot, 'Src', 'App.pa.yaml'),
    ['App:', '  Properties:', '    Theme: =PowerAppsTheme', ''].join('\n'),
    'utf8'
  );
  await writeFile(join(appRoot, 'Src', 'Screen1.pa.yaml'), options.screenYaml, 'utf8');
  await writeFile(
    join(appRoot, 'Src', '_EditorState.pa.yaml'),
    ['EditorState:', '  ScreensOrder:', '    - Screen1', ''].join('\n'),
    'utf8'
  );
  await writeFile(
    join(appRoot, 'Header.json'),
    JSON.stringify(
      {
        DocVersion: '1.349',
        MinVersionToLoad: '1.349',
        MSAppStructureVersion: '2.4.0',
        LastSavedDateTimeUTC: '03/10/2026 00:00:00',
      },
      null,
      2
    ),
    'utf8'
  );
  await writeFile(join(appRoot, 'Properties.json'), JSON.stringify({ AppVersion: '1.0.0' }, null, 2), 'utf8');
  await writeFile(
    join(appRoot, 'Controls', '1.json'),
    JSON.stringify(
      {
        TopParent: {
          Name: 'App',
        },
      },
      null,
      2
    ),
    'utf8'
  );
  await writeFile(
    join(appRoot, 'References', 'DataSources.json'),
    JSON.stringify(
      {
        DataSources: [
          {
            Name: 'Accounts',
            Type: 'Table',
            DatasetName: 'default.cds',
            EntityName: 'account',
            Metadata: {
              Name: 'Accounts',
              LogicalName: 'account',
              Columns: [
                { Name: 'Account Name', Type: 'Text' },
                { Name: 'Category', Type: 'Choice' },
              ],
              Relationships: [{ Name: 'Primary Contact', Target: 'Contacts' }],
              OptionSets: [
                {
                  Name: 'Account Category',
                  Values: [{ Name: 'Preferred', Value: 1000 }],
                },
              ],
            },
          },
          {
            Name: 'Contacts',
            Type: 'Table',
            DatasetName: 'default.cds',
            EntityName: 'contact',
            Metadata: {
              Name: 'Contacts',
              LogicalName: 'contact',
              Columns: [
                { Name: 'Email', Type: 'Text' },
                { Name: 'Full Name', Type: 'Text' },
              ],
              Relationships: [],
              OptionSets: [],
            },
          },
        ],
      },
      null,
      2
    ),
    'utf8'
  );
  await writeFile(join(appRoot, 'References', 'Themes.json'), JSON.stringify({ CurrentTheme: 'defaultTheme' }, null, 2), 'utf8');
  await writeFile(join(appRoot, 'Resources', 'PublishInfo.json'), JSON.stringify({ published: false }, null, 2), 'utf8');
  await writeFile(join(appRoot, 'controls.json'), JSON.stringify(options.registry, null, 2), 'utf8');

  return appRoot;
}

function createClassicButtonRegistry(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    templates: [
      {
        templateName: 'Button',
        templateVersion: '2.2.0',
        aliases: {
          constructors: ['Classic/Button'],
        },
        files: {
          'References/Templates.json': {
            name: 'Button',
            version: '2.2.0',
            templateXml: [
              '<widget xmlns="http://openajax.org/metadata" xmlns:appMagic="http://schemas.microsoft.com/appMagic" id="http://microsoft.com/appmagic/button" name="button" version="2.2.0">',
              '  <properties>',
              '    <property name="Text" datatype="String" defaultValue="&quot;Button&quot;" isExpr="true">',
              '      <appMagic:category>data</appMagic:category>',
              '    </property>',
              '    <property name="OnSelect" datatype="Behavior" defaultValue="" isExpr="true">',
              '      <appMagic:category>behavior</appMagic:category>',
              '    </property>',
              '  </properties>',
              '  <appMagic:includeProperties>',
              '    <appMagic:includeProperty name="X" defaultValue="0" />',
              '    <appMagic:includeProperty name="Y" defaultValue="0" />',
              '    <appMagic:includeProperty name="Width" defaultValue="120" />',
              '    <appMagic:includeProperty name="Height" defaultValue="40" />',
              '  </appMagic:includeProperties>',
              '</widget>',
            ].join(''),
          },
        },
        provenance: {
          source: 'test-registry',
        },
      },
    ],
    supportMatrix: [
      {
        templateName: 'Button',
        version: '2.2.0',
        status: 'supported',
        modes: ['strict', 'registry'],
      },
    ],
  };
}

function normalizeCliSnapshot<T>(value: T, ...tempPaths: string[]): T {
  return mapSnapshotStrings(value, (entry) => {
    let normalized = entry.replaceAll(repoRoot, '<REPO_ROOT>').replaceAll('\\', '/');

    for (const tempPath of tempPaths) {
      normalized = normalized.replaceAll(tempPath.replaceAll('\\', '/'), '<TMP_DIR>');
    }

    return normalized;
  });
}

function normalizeCliAnalysisSnapshot<T>(value: T): T {
  const normalizedStrings = mapSnapshotStrings(normalizeCliSnapshot(value), (entry) =>
    entry.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<GENERATED_AT>')
  );

  return normalizeDurationMs(normalizedStrings);
}

function normalizeCanvasTempRegistrySnapshot<T>(value: T, ...tempPaths: string[]): T {
  const normalized = normalizeCliSnapshot(value, ...tempPaths);

  if (typeof normalized !== 'object' || normalized === null) {
    return normalized;
  }

  return mapSnapshotStrings(normalized, (entry) => {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry)) {
      return '<GENERATED_AT>';
    }

    if (/^[a-f0-9]{64}$/.test(entry)) {
      return '<HASH>';
    }

    return entry;
  });
}

function normalizeDurationMs<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDurationMs(item)) as T;
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, key === 'durationMs' ? 0 : normalizeDurationMs(nested)])
    ) as T;
  }

  return value;
}

function normalizeImportedRegistryRoundTrip<T>(value: T, ...tempPaths: string[]): T {
  const normalized = normalizeCliSnapshot(value, ...tempPaths) as T;

  if (typeof normalized !== 'object' || normalized === null) {
    return normalized;
  }

  return mapSnapshotStrings(normalized, (entry) =>
    entry === '<TMP_DIR>/normalized.json' ? '<REPO_ROOT>/fixtures/canvas/registries/import-source.json' : entry
  );
}

async function unzipCanvasPackage(packagePath: string, root: string): Promise<string> {
  const unzipDir = join(root, 'unzipped');
  await mkdir(unzipDir, { recursive: true });
  const unzipResult = spawnSync('unzip', ['-o', packagePath, '-d', unzipDir], {
    encoding: 'utf8',
  });

  expect(unzipResult.status).toBe(0);
  return unzipDir;
}

async function createZipPackage(sourceDir: string, outPath: string): Promise<void> {
  const zipResult = spawnSync('zip', ['-rqX', outPath, '.'], {
    cwd: sourceDir,
    encoding: 'utf8',
  });

  expect(zipResult.status).toBe(0);
}

async function writeSolutionExportMetadata(root: string, managed = false): Promise<void> {
  await writeFile(
    join(root, 'solution.xml'),
    `<ImportExportXml><SolutionManifest><UniqueName>Core</UniqueName><Version>1.0.0.0</Version><Managed>${managed ? '1' : '0'}</Managed></SolutionManifest></ImportExportXml>`,
    'utf8'
  );
}

function normalizeNativeHeaderSnapshot<T>(value: T): T {
  const normalized = normalizeCliSnapshot(value);

  if (typeof normalized !== 'object' || normalized === null || !('LastSavedDateTimeUTC' in normalized)) {
    return normalized;
  }

  return {
    ...(normalized as Record<string, unknown>),
    LastSavedDateTimeUTC: '<LAST_SAVED_DATE_TIME_UTC>',
  } as T;
}

interface FlowRuntimeFixture {
  query?: DataverseFixture['query'];
  queryAll?: DataverseFixture['queryAll'];
}

interface SolutionFixtureEnvironments {
  source: DataverseFixture;
  target: DataverseFixture;
}

async function runCli(
  args: string[],
  options: {
    env?: Record<string, string | undefined>;
    cwd?: string;
  } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
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
  const originalArgv = process.argv;
  const originalCwd = process.cwd();
  const originalEnv = new Map(Object.keys(options.env ?? {}).map((key) => [key, process.env[key]]));

  process.argv = ['node', 'pp', ...args];

  if (options.cwd) {
    process.chdir(options.cwd);
  }

  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    const code = await main(args);
    return {
      code,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
    };
  } finally {
    process.argv = originalArgv;
    process.chdir(originalCwd);

    for (const [key, value] of originalEnv.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

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
    expect(stdout.join('')).toContain('Power Platform CLI for local project work, Dataverse environments, solutions, and deployment workflows.');
    expect(stdout.join('')).toContain('auth profile        how pp gets credentials');
    expect(stdout.join('')).toContain('environment alias   named Dataverse target that points to a URL and auth profile');
    expect(stdout.join('')).toContain('project/stage -> environment alias -> auth profile -> token -> Dataverse/solution');
    expect(stdout.join('')).toContain('Top-level areas:');
    expect(stdout.join('')).toContain('  auth          manage auth profiles, browser profiles, login, and tokens');
    expect(stdout.join('')).toContain('  env           manage Dataverse environment aliases');
    expect(stdout.join('')).toContain('  solution      inspect and mutate solutions');
    expect(stdout.join('')).toContain('  diagnostics   install/config/project diagnostics');
    expect(stdout.join('')).toContain('pp auth profile add-user --name work');
    expect(stdout.join('')).toContain('pp env add dev --url https://contoso.crm.dynamics.com --profile work');
    expect(stdout.join('')).toContain('pp auth profile --help');
    expect(stdout.join('')).not.toContain('canvas import <file.msapp>');
  });

  it('prints version, completion, and diagnostics help as first-class product commands', async () => {
    const version = await runCli(['version', '--format', 'raw']);
    const completion = await runCli(['completion', 'bash']);
    const diagnosticsHelp = await runCli(['diagnostics', '--help']);

    expect(version.code).toBe(0);
    expect(version.stderr).toBe('');
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);

    expect(completion.code).toBe(0);
    expect(completion.stderr).toBe('');
    expect(completion.stdout).toContain('complete -F _pp_complete pp');
    expect(completion.stdout).toContain('diagnostics');

    expect(diagnosticsHelp.code).toBe(0);
    expect(diagnosticsHelp.stderr).toBe('');
    expect(diagnosticsHelp.stdout).toContain('Usage: diagnostics <doctor|bundle> [path] [options]');
    expect(diagnosticsHelp.stdout).toContain('pp diagnostics bundle ./repo --format json > pp-diagnostics.json');
  });

  it('prints canvas-specific help with remote workflow guidance', async () => {
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
    expect(stdout.join('')).toContain('pp canvas list --environment dev --solution Core');
    expect(stdout.join('')).toContain('pp canvas download "Harness Canvas" --environment dev --solution Core --out ./artifacts/HarnessCanvas.msapp');
    expect(stdout.join('')).toContain('pp canvas import ./dist/HarnessCanvas.msapp --environment dev --solution Core --target "Harness Canvas"');
    expect(stdout.join('')).toContain(
      'Remote canvas download exports the containing solution through Dataverse and extracts CanvasApps/*.msapp without leaving pp.'
    );
    expect(stdout.join('')).toContain(
      'Remote canvas import replaces one explicit CanvasApps/*.msapp entry by exporting and re-importing the containing solution through Dataverse.'
    );
    expect(stdout.join('')).toContain('`canvas create --delegate` can drive the Maker blank-app flow and wait for the created app id through Dataverse.');
    expect(stdout.join('')).toContain(
      '`canvas create` remains a guided preview flow, while `canvas import` now requires `--solution` plus an explicit `--target` to avoid destructive guesses.'
    );
  });

  it('prints stable help for remote canvas create and import', async () => {
    const createHelp = await runCli(['canvas', 'create', '--help']);
    const importHelp = await runCli(['canvas', 'import', '--help']);

    expect(createHelp.code).toBe(0);
    expect(createHelp.stderr).toBe('');
    expect(createHelp.stdout).toContain('Usage: canvas create --environment ALIAS [--solution UNIQUE_NAME] [--name DISPLAY_NAME] [options]');
    expect(createHelp.stdout).toContain('Preview handoff by default. `--delegate` can drive the Maker blank-app flow through a persisted browser profile.');
    expect(createHelp.stdout).toContain('Choose this when:');
    expect(createHelp.stdout).toContain('Choose a different path when:');
    expect(createHelp.stdout).toContain('Recommended flow:');
    expect(createHelp.stdout).toContain('--maker-env-id ID');
    expect(createHelp.stdout).toContain('--delegate');
    expect(createHelp.stdout).toContain('--open');
    expect(createHelp.stdout).toContain('--browser-profile NAME');
    expect(createHelp.stdout).toContain('--artifacts-dir DIR');
    expect(createHelp.stdout).toContain('--timeout-ms N');
    expect(createHelp.stdout).toContain('--poll-timeout-ms N');
    expect(createHelp.stdout).toContain('--settle-ms N');
    expect(createHelp.stdout).toContain('--slow-mo-ms N');
    expect(createHelp.stdout).toContain('--debug');
    expect(createHelp.stdout).toContain('--dry-run');
    expect(createHelp.stdout).toContain('--plan');
    expect(createHelp.stdout).toContain(
      'Use `--delegate --browser-profile <name> --solution <solution> --name <display-name>` to let pp drive the Maker blank-app flow and return the created app id when Studio save/publish succeeds.'
    );
    expect(createHelp.stdout).toContain('Prefer `--delegate` when you want pp to wait for the created app id through Dataverse.');

    expect(importHelp.code).toBe(0);
    expect(importHelp.stderr).toBe('');
    expect(importHelp.stdout).toContain(
      'Usage: canvas import <file.msapp> --environment ALIAS --solution UNIQUE_NAME --target <displayName|name|id> [options]'
    );
    expect(importHelp.stdout).toContain('Choose this when:');
    expect(importHelp.stdout).toContain('Recommended flow:');
    expect(importHelp.stdout).toContain('--target <name|id>');
    expect(importHelp.stdout).toContain('--overwrite-unmanaged-customizations');
    expect(importHelp.stdout).toContain('--no-publish-workflows');
    expect(importHelp.stdout).toContain('--dry-run');
    expect(importHelp.stdout).toContain('--plan');
    expect(importHelp.stdout).toContain(
      '`pp canvas import` exports the solution, replaces one `CanvasApps/*.msapp` entry, and imports the rebuilt package back through Dataverse.'
    );
    expect(importHelp.stdout).toContain(
      'Run `pp canvas import <file.msapp> --environment <alias> --solution <solution> --target <displayName|name|id>`.'
    );
  });

  it('prints stable help for remote canvas discovery commands', async () => {
    const listHelp = await runCli(['canvas', 'list', '--help']);
    const downloadHelp = await runCli(['canvas', 'download', '--help']);
    const inspectHelp = await runCli(['canvas', 'inspect', '--help']);

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
    expect(inspectHelp.stdout).toContain('portal provenance with the Dataverse app open URI and a canonical Maker studio edit URL');
    expect(inspectHelp.stdout).toContain('pp canvas inspect "Harness Canvas" --environment dev --solution Core');
  });

  it('prints stable help for Dataverse row workflows', async () => {
    const rowsHelp = await runCli(['dv', 'rows', '--help']);
    const exportHelp = await runCli(['dv', 'rows', 'export', '--help']);
    const applyHelp = await runCli(['dv', 'rows', 'apply', '--help']);

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

  it('prints stable help for project commands without mutating the target path', async () => {
    const tempDir = await createTempDir();
    const before = await readdir(tempDir);

    const projectHelp = await runCli(['project', '--help']);
    const initHelp = await runCli(['project', 'init', tempDir, '--help']);
    const doctorHelp = await runCli(['project', 'doctor', tempDir, '--help']);
    const feedbackHelp = await runCli(['project', 'feedback', tempDir, '--help']);
    const inspectHelp = await runCli(['project', 'inspect', tempDir, '--help']);

    const after = await readdir(tempDir);

    expect(projectHelp.code).toBe(0);
    expect(projectHelp.stderr).toBe('');
    expect(projectHelp.stdout).toContain('Usage: project <command> [options]');
    expect(projectHelp.stdout).toContain('init [path]');
    expect(projectHelp.stdout).toContain('doctor [path]');
    expect(projectHelp.stdout).toContain('feedback [path]');
    expect(projectHelp.stdout).toContain('inspect [path]');

    expect(initHelp.code).toBe(0);
    expect(initHelp.stderr).toBe('');
    expect(initHelp.stdout).toContain(
      'Usage: project init [path] [--name NAME] [--environment ALIAS] [--solution UNIQUE_NAME] [--stage STAGE] [options]'
    );
    expect(initHelp.stdout).toContain('`--help` only prints this text and never inspects or mutates the target path.');
    expect(initHelp.stdout).toContain('`pp.config.yaml`');

    expect(doctorHelp.code).toBe(0);
    expect(doctorHelp.stderr).toBe('');
    expect(doctorHelp.stdout).toContain('Usage: project doctor [path] [--stage STAGE] [--param NAME=VALUE] [options]');
    expect(doctorHelp.stdout).toContain('Reads project context without mutating the filesystem.');
    expect(doctorHelp.stdout).toContain('Machine-readable formats emit one payload on stdout');
    expect(doctorHelp.stdout).toContain('Separates repo-local layout checks from external environment-registry and auth-resolution findings');
    expect(doctorHelp.stdout).toContain('canonical `artifacts/solutions/` bundle path');

    expect(feedbackHelp.code).toBe(0);
    expect(feedbackHelp.stderr).toBe('');
    expect(feedbackHelp.stdout).toContain('Usage: project feedback [path] [--stage STAGE] [--param NAME=VALUE] [options]');
    expect(feedbackHelp.stdout).toContain('Captures retrospective conceptual feedback for a local pp project.');
    expect(feedbackHelp.stdout).toContain('can stay inside `pp`.');

    expect(inspectHelp.code).toBe(0);
    expect(inspectHelp.stderr).toBe('');
    expect(inspectHelp.stdout).toContain('Usage: project inspect [path] [--stage STAGE] [--param NAME=VALUE] [options]');
    expect(inspectHelp.stdout).toContain('Reads project context without mutating the filesystem.');
    expect(inspectHelp.stdout).toContain('Auto-selects the lone descendant `pp.config.*` under the inspected path');
    expect(inspectHelp.stdout).toContain('generated solution zips belong under `artifacts/solutions/`');
    expect(inspectHelp.stdout).toContain('Includes per-root placement guidance');
    expect(inspectHelp.stdout).toContain('Pair with `pp project doctor` for layout validation and `pp project init`');

    expect(after).toEqual(before);
  });

  it('guides init setup with resumable sessions and machine-readable status', async () => {
    const root = await createTempDir();
    const configDir = await createTempDir();
    const start = await runCli(
      [
        'init',
        root,
        '--goal',
        'project',
        '--auth-mode',
        'environment-token',
        '--profile',
        'ci',
        '--token-env',
        'PP_INIT_CLI_TOKEN',
        '--env',
        'dev',
        '--url',
        'https://example.crm.dynamics.com',
        '--name',
        'demo',
        '--solution',
        'Core',
        '--stage',
        'dev',
        '--config-dir',
        configDir,
        '--format',
        'json',
      ],
      {
        env: {
          PP_INIT_CLI_TOKEN: 'fixture-token',
        },
      }
    );

    expect(start.code).toBe(0);
    expect(start.stderr).toBe('');
    expect(JSON.parse(start.stdout)).toMatchObject({
      status: 'completed',
      verification: {
        auth: 'verified',
        project: 'verified',
      },
      artifacts: {
        authProfile: {
          name: 'ci',
        },
      },
    });
  });

  it('prints help for the init workflow and subcommands', async () => {
    const help = await runCli(['init', '--help']);
    const answerHelp = await runCli(['init', 'answer', '--help']);

    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Guided setup for first-run pp use.');
    expect(help.stdout).toContain('pp init');
    expect(answerHelp.code).toBe(0);
    expect(answerHelp.stdout).toContain('Usage: init answer <session-id> --set field=value');
  });

  it('prints stable help for solution mutation commands without validating arguments', async () => {
    const createHelp = await runCli(['solution', 'create', '--help']);
    const setMetadataHelp = await runCli(['solution', 'set-metadata', '--help']);
    const checkpointHelp = await runCli(['solution', 'checkpoint', '--help']);

    expect(createHelp.code).toBe(0);
    expect(createHelp.stderr).toBe('');
    expect(createHelp.stdout).toContain(
      'Usage: solution create <uniqueName> --environment ALIAS [--friendly-name NAME] [--version X.Y.Z.W] [--description TEXT] (--publisher-id GUID | --publisher-unique-name NAME)'
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

  it('renders analysis report and context outputs from the fixture project', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const env = {
      PP_TENANT_DOMAIN: 'contoso.example',
      PP_SECRET_app_token: 'super-secret',
      PP_SQL_ENDPOINT: undefined,
    };

    mockDataverseResolution({
      prod: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'solution-prod-1',
              uniquename: 'CoreManaged',
              friendlyname: 'Core Managed',
              version: '1.0.0.0',
            },
          ],
        },
        queryAll: {
          solutioncomponents: [{ objectid: 'envvar-def-1' }],
          dependencies: [],
          connectionreferences: [],
          environmentvariabledefinitions: [
            {
              environmentvariabledefinitionid: 'envvar-def-1',
              schemaname: 'pp_TenantDomain',
              displayname: 'Tenant Domain',
              defaultvalue: '',
              type: 'string',
              _solutionid_value: 'solution-prod-1',
            },
          ],
          environmentvariablevalues: [
            {
              environmentvariablevalueid: 'envvar-value-1',
              value: 'old.example',
              _environmentvariabledefinitionid_value: 'envvar-def-1',
              statecode: 0,
            },
          ],
        },
      }),
    });

    const projectInspect = await runCli(['project', 'inspect', fixtureRoot, '--format', 'json'], {
      env,
    });
    const report = await runCli(['analysis', 'report', fixtureRoot, '--format', 'markdown'], {
      env,
    });
    const context = await runCli(['analysis', 'context', '--project', fixtureRoot, '--asset', 'apps', '--format', 'json'], {
      env,
    });
    const deployPlan = await runCli(['deploy', 'plan', '--project', fixtureRoot, '--format', 'json'], {
      env,
    });
    const deployApply = await runCli(['deploy', 'apply', '--project', fixtureRoot, '--dry-run', '--format', 'json'], {
      env,
    });

    expect(projectInspect.code).toBe(0);
    expect(report.code).toBe(0);
    expect(context.code).toBe(0);
    expect(deployPlan.code).toBe(0);
    expect(deployApply.code).toBe(1);

    expect(projectInspect.stderr).toBe('');

    await expectGoldenJson(JSON.parse(projectInspect.stdout), 'fixtures/cli/golden/protocol/project-inspect.json', {
      normalize: (value) => normalizeCliAnalysisSnapshot(value),
    });
    await expectGoldenText(report.stdout, 'fixtures/analysis/golden/report.md', {
      normalize: (value) => normalizeCliAnalysisSnapshot(value),
    });
    await expectGoldenJson(JSON.parse(context.stdout), 'fixtures/analysis/golden/context-pack.json', {
      normalize: (value) => normalizeCliAnalysisSnapshot(value),
    });
    expect(JSON.parse(context.stdout)).toMatchObject({
      discovery: {
        inspectedPath: fixtureRoot,
        resolvedProjectRoot: fixtureRoot,
        configPath: resolveRepoPath('fixtures', 'analysis', 'project', 'pp.config.yaml'),
        descendantProjectRoots: [],
        descendantProjectConfigs: [],
      },
    });
    await expectGoldenJson(JSON.parse(deployPlan.stdout), 'fixtures/analysis/golden/deploy-plan.json', {
      normalize: (value) => normalizeCliAnalysisSnapshot(value),
    });
    await expectGoldenJson(JSON.parse(deployApply.stdout), 'fixtures/analysis/golden/deploy-apply-dry-run.json', {
      normalize: (value) => normalizeCliAnalysisSnapshot(value),
    });
    await expectGoldenText(report.stderr, 'fixtures/cli/golden/protocol/project-discovery-diagnostics.raw.txt');
    await expectGoldenJson(JSON.parse(context.stderr), 'fixtures/cli/golden/protocol/project-discovery-diagnostics.json');
    await expectGoldenJson(JSON.parse(deployPlan.stderr), 'fixtures/cli/golden/protocol/project-discovery-diagnostics.json');
    await expectGoldenJson(JSON.parse(deployApply.stderr), 'fixtures/cli/golden/protocol/project-discovery-diagnostics.json');
  });

  it('aggregates portfolio, drift, usage, and policy analysis across multiple projects', async () => {
    const firstRoot = await createTempDir();
    const secondRoot = await createTempDir();
    await writePortfolioFixtureProject(firstRoot, {
      owner: 'team-alpha',
      docsPaths: ['docs'],
      providerKind: 'dataverse',
      providerTarget: 'dev',
      defaultEnvironment: 'dev',
      stageEnvironment: 'dev',
      solutionUniqueName: 'CoreDev',
      assetRoot: 'apps',
    });
    await writePortfolioFixtureProject(secondRoot, {
      providerKind: 'custom-connector',
      providerTarget: 'prod-api',
      defaultEnvironment: 'prod',
      stageEnvironment: 'prod',
      solutionUniqueName: 'CoreProd',
      assetRoot: 'client-apps',
      includeMissingAsset: true,
      includeRequiredSecret: true,
      sensitiveLiteral: true,
    });

    const env = {
      PP_TENANT_DOMAIN: 'contoso.example',
    };

    const portfolio = await runCli(
      ['analysis', 'portfolio', '--project', firstRoot, '--project', secondRoot, '--allow-provider-kind', 'dataverse', '--format', 'json'],
      { env }
    );
    const drift = await runCli(['analysis', 'drift', firstRoot, secondRoot, '--allow-provider-kind', 'dataverse', '--format', 'json'], {
      env,
    });
    const usage = await runCli(['analysis', 'usage', firstRoot, secondRoot, '--format', 'json'], {
      env,
    });
    const policy = await runCli(['analysis', 'policy', firstRoot, secondRoot, '--allow-provider-kind', 'dataverse', '--format', 'json'], {
      env,
    });

    expect(portfolio.code).toBe(0);
    expect(drift.code).toBe(0);
    expect(usage.code).toBe(0);
    expect(policy.code).toBe(0);

    const portfolioJson = JSON.parse(portfolio.stdout) as {
      summary: { projectCount: number; driftCount: number; governanceFindingCount: number };
    };
    const driftJson = JSON.parse(drift.stdout) as { findings: Array<{ code: string }> };
    const usageJson = JSON.parse(usage.stdout) as { owners: Array<{ owner: string }>; assetUsage: Array<{ assetName: string }> };
    const policyJson = JSON.parse(policy.stdout) as { findings: Array<{ code: string }> };
    const portfolioDiagnostics = JSON.parse(portfolio.stderr) as { warnings: Array<{ code: string }> };
    const driftDiagnostics = JSON.parse(drift.stderr) as { warnings: Array<{ code: string }> };
    const usageDiagnostics = JSON.parse(usage.stderr) as { warnings: Array<{ code: string }> };
    const policyDiagnostics = JSON.parse(policy.stderr) as { warnings: Array<{ code: string }> };

    expect(portfolioJson.summary.projectCount).toBe(2);
    expect(portfolioJson.summary.driftCount).toBeGreaterThanOrEqual(3);
    expect(portfolioJson.summary.governanceFindingCount).toBeGreaterThanOrEqual(4);
    expect(portfolioDiagnostics.warnings.map((warning) => warning.code)).toContain('PROJECT_SECRET_PROVIDER_UNSET');
    expect(driftDiagnostics.warnings.map((warning) => warning.code)).toContain('PROJECT_SECRET_PROVIDER_UNSET');
    expect(usageDiagnostics.warnings.map((warning) => warning.code)).toContain('PROJECT_SECRET_PROVIDER_UNSET');
    expect(policyDiagnostics.warnings.map((warning) => warning.code)).toContain('PROJECT_SECRET_PROVIDER_UNSET');
    expect(driftJson.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'PORTFOLIO_STAGE_DRIFT',
        'PORTFOLIO_PROVIDER_BINDING_DRIFT',
        'PORTFOLIO_ASSET_DRIFT',
      ])
    );
    expect(usageJson.owners.map((entry) => entry.owner)).toContain('team-alpha');
    expect(usageJson.assetUsage.map((entry) => entry.assetName)).toEqual(expect.arrayContaining(['apps', 'flows']));
    expect(policyJson.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'PORTFOLIO_OWNER_MISSING',
        'PORTFOLIO_PROVENANCE_MISSING',
        'PORTFOLIO_UNSUPPORTED_PROVIDER_KIND',
        'PORTFOLIO_MISSING_ASSET',
        'PORTFOLIO_REQUIRED_PARAMETER_MISSING',
        'PORTFOLIO_UNSAFE_SENSITIVE_VALUE',
      ])
    );
  });

  it('covers confirmed live deploy apply through the CLI entrypoint', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const env = {
      PP_TENANT_DOMAIN: 'contoso.example',
      PP_SECRET_app_token: 'super-secret',
      PP_SQL_ENDPOINT: 'sql.contoso.example',
    };

    mockDataverseResolution({
      prod: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'solution-prod-1',
              uniquename: 'CoreManaged',
              friendlyname: 'Core Managed',
              version: '1.0.0.0',
            },
          ],
        },
        queryAll: {
          solutioncomponents: [{ objectid: 'envvar-def-1' }],
          dependencies: [],
          connectionreferences: [],
          environmentvariabledefinitions: [
            {
              environmentvariabledefinitionid: 'envvar-def-1',
              schemaname: 'pp_TenantDomain',
              displayname: 'Tenant Domain',
              defaultvalue: '',
              type: 'string',
              _solutionid_value: 'solution-prod-1',
            },
          ],
          environmentvariablevalues: [
            {
              environmentvariablevalueid: 'envvar-value-1',
              value: 'old.example',
              _environmentvariabledefinitionid_value: 'envvar-def-1',
              statecode: 0,
            },
          ],
        },
      }),
    });

    const deployApply = await runCli(['deploy', 'apply', '--project', fixtureRoot, '--yes', '--format', 'json'], {
      env,
    });

    expect(deployApply.code).toBe(0);

    await expectGoldenJson(JSON.parse(deployApply.stdout), 'fixtures/analysis/golden/deploy-apply-live.json', {
      normalize: (value) => normalizeCliAnalysisSnapshot(value),
    });
    expect(deployApply.stderr).toBe('');
  });

  it('covers confirmed live flow artifact deploy apply through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    await mkdir(join(tempDir, 'flows', 'invoice'), { recursive: true });
    await writeFile(
      join(tempDir, 'pp.config.yaml'),
      [
        'topology:',
        '  defaultStage: dev',
        '  stages:',
        '    dev: {}',
        'parameters:',
        '  apiBaseUrl:',
        '    type: string',
        '    value: https://contoso.example',
        '    mapsTo:',
        '      - kind: flow-parameter',
        '        path: flows/invoice/flow.json',
        '        target: ApiBaseUrl',
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      join(tempDir, 'flows', 'invoice', 'flow.json'),
      await readFile(resolveRepoPath('fixtures', 'flow', 'golden', 'unpacked.flow.json'), 'utf8'),
      'utf8'
    );

    const deployApply = await runCli(['deploy', 'apply', '--project', tempDir, '--yes', '--format', 'json']);

    expect(deployApply.code).toBe(0);
    expect(deployApply.stderr).toBe('');

    await expectGoldenJson(JSON.parse(deployApply.stdout), 'fixtures/cli/golden/protocol/deploy-apply-flow-live.json', {
      normalize: (value) => normalizeCliAnalysisSnapshot(normalizeCliSnapshot(value, tempDir)),
    });

    const updatedArtifact = JSON.parse(await readFile(join(tempDir, 'flows', 'invoice', 'flow.json'), 'utf8')) as {
      metadata: { parameters: Record<string, unknown> };
      definition: { parameters: Record<string, { defaultValue?: unknown }> };
    };
    expect(updatedArtifact.metadata.parameters.ApiBaseUrl).toBe('https://contoso.example');
    expect(updatedArtifact.definition.parameters.ApiBaseUrl?.defaultValue).toBe('https://contoso.example');
  });

  it('covers confirmed live deploy apply from a saved deploy plan file', async () => {
    const tempDir = await createTempDir();
    const planPath = join(tempDir, 'deploy-plan.json');
    const env = {
      PP_SQL_ENDPOINT: 'sql.contoso.example',
    };

    await writeFile(
      join(tempDir, 'pp.config.yaml'),
      [
        'defaults:',
        '  stage: prod',
        'topology:',
        '  defaultStage: prod',
        '  stages:',
        '    prod:',
        '      environment: prod',
        'parameters:',
        '  sqlEndpoint:',
        '    type: string',
        '    fromEnv: PP_SQL_ENDPOINT',
        '    required: true',
        '    mapsTo:',
        '      - kind: deploy-input',
        '        target: sql-endpoint',
      ].join('\n'),
      'utf8'
    );

    const deployPlan = await runCli(['deploy', 'plan', '--project', tempDir, '--format', 'json'], {
      env,
    });
    await writeFile(planPath, deployPlan.stdout, 'utf8');

    const deployApply = await runCli(['deploy', 'apply', '--project', tempDir, '--plan', planPath, '--yes', '--format', 'json'], {
      env,
    });

    expect(deployPlan.code).toBe(0);
    expect(deployApply.code).toBe(0);
    expect(deployApply.stderr).toBe('');

    const result = normalizeCliAnalysisSnapshot(JSON.parse(deployApply.stdout)) as Record<string, any>;
    expect(result.preflight.checks).toContainEqual(
      expect.objectContaining({
        code: 'DEPLOY_PREFLIGHT_PLAN_MATCH',
        status: 'pass',
      })
    );
    expect(result.apply.operations).toContainEqual(
      expect.objectContaining({
        kind: 'deploy-input-bind',
        status: 'resolved',
        target: 'sql-endpoint',
      })
    );
  });

  it('covers staged release planning through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const manifestPath = join(tempDir, 'release.yaml');

    await writeFile(
      join(tempDir, 'pp.config.yaml'),
      [
        'defaults:',
        '  stage: test',
        'topology:',
        '  defaultStage: test',
        '  stages:',
        '    test:',
        '      environment: test',
        '      solution: core',
        '    prod:',
        '      environment: prod',
        '      solution: core',
        'solutions:',
        '  core:',
        '    uniqueName: CoreManaged',
        'parameters:',
        '  tenantDomain:',
        '    type: string',
        '    value: contoso.example',
        '    mapsTo:',
        '      - kind: dataverse-envvar',
        '        target: pp_TenantDomain',
      ].join('\n'),
      'utf8'
    );

    await writeFile(
      manifestPath,
      [
        'schemaVersion: 1',
        "kind: 'pp.release'",
        'name: release-preview',
        'projectRoot: .',
        'stages:',
        '  - id: test',
        '    stage: test',
        '    validations:',
        '      - kind: preflight-ok',
        '  - id: prod',
        '    stage: prod',
        '    approvals:',
        '      - id: prod-approval',
      ].join('\n'),
      'utf8'
    );

    const fixtureClient = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'solution-1',
            uniquename: 'CoreManaged',
            friendlyname: 'Core Managed',
            version: '1.0.0.0',
          },
        ],
      },
      queryAll: {
        solutioncomponents: [{ objectid: 'envvar-def-1' }],
        dependencies: [],
        connectionreferences: [],
        environmentvariabledefinitions: [
          {
            environmentvariabledefinitionid: 'envvar-def-1',
            schemaname: 'pp_TenantDomain',
            displayname: 'Tenant Domain',
            defaultvalue: '',
            type: 'string',
            _solutionid_value: 'solution-1',
          },
        ],
        environmentvariablevalues: [
          {
            environmentvariablevalueid: 'envvar-value-1',
            value: 'old.example',
            _environmentvariabledefinitionid_value: 'envvar-def-1',
            statecode: 0,
          },
        ],
      },
    });

    mockDataverseResolution({
      test: fixtureClient,
      prod: fixtureClient,
    });

    const releasePlan = await runCli(['deploy', 'release', 'plan', '--file', manifestPath, '--format', 'json']);

    expect(releasePlan.code).toBe(1);
    expect(releasePlan.stderr).toBe('');

    const result = JSON.parse(releasePlan.stdout) as {
      summary: { totalStages: number; completed: number; blocked: number };
      stages: Array<{ status: string; approval: { ok: boolean } }>;
    };
    expect(result.summary.totalStages).toBe(2);
    expect(result.stages[0]?.status).toBe('completed');
    expect(result.stages[1]?.status).toBe('blocked');
    expect(result.stages[1]?.approval.ok).toBe(false);
  });

  it('covers detached saved-plan deploy apply without rediscovering a project', async () => {
    const tempDir = await createTempDir();
    const planPath = join(tempDir, 'deploy-plan.json');

    await writeFile(
      planPath,
      JSON.stringify(
        {
          projectRoot: '/tmp/detached-plan',
          generatedAt: '2026-03-10T00:00:00.000Z',
          executionStages: ['resolve', 'preflight', 'plan', 'apply', 'report'],
          supportedAdapters: ['github-actions', 'azure-devops', 'power-platform-pipelines'],
          target: {
            stage: 'prod',
            environmentAlias: 'prod',
            solutionUniqueName: 'CoreManaged',
          },
          inputs: [
            {
              name: 'tenantDomain',
              value: 'contoso.example',
              source: 'value',
              hasValue: true,
              sensitive: false,
              mappings: [
                {
                  kind: 'dataverse-envvar',
                  target: 'pp_TenantDomain',
                },
              ],
            },
          ],
          providerBindings: [],
          topology: [],
          templateRegistries: [],
          build: {},
          assets: [],
          bindings: {
            inputs: [],
            secrets: [],
          },
          operations: [
            {
              kind: 'dataverse-envvar-set',
              parameter: 'tenantDomain',
              source: 'value',
              sensitive: false,
              target: 'pp_TenantDomain',
              valuePreview: 'contoso.example',
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const client = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'solution-prod-1',
            uniquename: 'CoreManaged',
            friendlyname: 'Core Managed',
            version: '1.0.0.0',
          },
        ],
      },
      queryAll: {
        solutioncomponents: [{ objectid: 'envvar-def-1' }],
        dependencies: [],
        connectionreferences: [],
        environmentvariabledefinitions: [
          {
            environmentvariabledefinitionid: 'envvar-def-1',
            schemaname: 'pp_TenantDomain',
            displayname: 'Tenant Domain',
            defaultvalue: '',
            type: 'string',
            _solutionid_value: 'solution-prod-1',
          },
        ],
        environmentvariablevalues: [
          {
            environmentvariablevalueid: 'envvar-value-1',
            value: 'old.example',
            _environmentvariabledefinitionid_value: 'envvar-def-1',
            statecode: 0,
          },
        ],
      },
    });

    mockDataverseResolution({ prod: client });

    const deployApply = await runCli(['deploy', 'apply', '--plan', planPath, '--yes', '--format', 'json']);

    expect(deployApply.code).toBe(0);
    expect(deployApply.stderr).toBe('');

    const result = normalizeCliAnalysisSnapshot(JSON.parse(deployApply.stdout)) as Record<string, any>;
    expect(result.preflight.ok).toBe(true);
    expect(result.plan.projectRoot).toBe('/tmp/detached-plan');
    expect(result.apply.operations).toContainEqual(
      expect.objectContaining({
        kind: 'dataverse-envvar-set',
        status: 'applied',
        target: 'pp_TenantDomain',
      })
    );
  });

  it('covers detached saved-plan deploy apply with explicit parameter overrides for redacted values', async () => {
    const tempDir = await createTempDir();
    const planPath = join(tempDir, 'deploy-plan.json');

    await writeFile(
      planPath,
      JSON.stringify(
        {
          projectRoot: '/tmp/detached-plan',
          generatedAt: '2026-03-10T00:00:00.000Z',
          executionStages: ['resolve', 'preflight', 'plan', 'apply', 'report'],
          supportedAdapters: ['github-actions', 'azure-devops', 'power-platform-pipelines'],
          target: {
            stage: 'prod',
            environmentAlias: 'prod',
            solutionUniqueName: 'CoreManaged',
          },
          inputs: [
            {
              name: 'tenantDomain',
              source: 'secret',
              hasValue: true,
              sensitive: true,
              reference: 'tenant_domain',
              mappings: [
                {
                  kind: 'dataverse-envvar',
                  target: 'pp_TenantDomain',
                },
              ],
            },
          ],
          providerBindings: [],
          topology: [],
          templateRegistries: [],
          build: {},
          assets: [],
          bindings: {
            inputs: [],
            secrets: [],
          },
          operations: [
            {
              kind: 'dataverse-envvar-set',
              parameter: 'tenantDomain',
              source: 'secret',
              sensitive: true,
              target: 'pp_TenantDomain',
              valuePreview: '<redacted>',
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const client = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'solution-prod-1',
            uniquename: 'CoreManaged',
            friendlyname: 'Core Managed',
            version: '1.0.0.0',
          },
        ],
      },
      queryAll: {
        solutioncomponents: [{ objectid: 'envvar-def-1' }],
        dependencies: [],
        connectionreferences: [],
        environmentvariabledefinitions: [
          {
            environmentvariabledefinitionid: 'envvar-def-1',
            schemaname: 'pp_TenantDomain',
            displayname: 'Tenant Domain',
            defaultvalue: '',
            type: 'string',
            _solutionid_value: 'solution-prod-1',
          },
        ],
        environmentvariablevalues: [
          {
            environmentvariablevalueid: 'envvar-value-1',
            value: 'old.example',
            _environmentvariabledefinitionid_value: 'envvar-def-1',
            statecode: 0,
          },
        ],
      },
    });

    mockDataverseResolution({ prod: client });

    const deployApply = await runCli(
      ['deploy', 'apply', '--plan', planPath, '--param', 'tenantDomain=contoso.example', '--yes', '--format', 'json']
    );

    expect(deployApply.code).toBe(0);
    expect(deployApply.stderr).toBe('');

    const result = normalizeCliAnalysisSnapshot(JSON.parse(deployApply.stdout)) as Record<string, any>;
    expect(result.preflight.ok).toBe(true);
    expect(result.plan.inputs).toContainEqual(
      expect.objectContaining({
        name: 'tenantDomain',
        source: 'value',
        value: '<redacted>',
      })
    );
    expect(result.apply.operations).toContainEqual(
      expect.objectContaining({
        kind: 'dataverse-envvar-set',
        status: 'applied',
        nextValue: 'contoso.example',
      })
    );
  });

  it('covers project init and doctor through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();

    const initPlan = await runCli(
      ['project', 'init', tempDir, '--name', 'HarnessDemo', '--env', 'sandbox', '--solution', 'CoreLifecycle', '--plan', '--format', 'json']
    );
    const initApply = await runCli(
      ['project', 'init', tempDir, '--name', 'HarnessDemo', '--env', 'sandbox', '--solution', 'CoreLifecycle', '--format', 'json']
    );
    const doctor = await runCli(['project', 'doctor', tempDir, '--format', 'json']);

    expect(initPlan.code).toBe(0);
    expect(initPlan.stderr).toBe('');
    expect(initApply.code).toBe(0);
    expect(initApply.stderr).toBe('');
    expect(doctor.code).toBe(0);
    expect(doctor.stderr).toBe('');

    await expectGoldenJson(JSON.parse(initPlan.stdout), 'fixtures/cli/golden/protocol/project-init-plan.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(initApply.stdout), 'fixtures/cli/golden/protocol/project-init-result.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(doctor.stdout), 'fixtures/cli/golden/protocol/project-doctor.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
  });

  it('renders a scaffold preview for project init in markdown output', async () => {
    const tempDir = await createTempDir();

    const initPlan = await runCli([
      'project',
      'init',
      tempDir,
      '--name',
      'HarnessDemo',
      '--env',
      'sandbox',
      '--solution',
      'CoreLifecycle',
      '--plan',
      '--format',
      'markdown',
    ]);

    expect(initPlan.code).toBe(0);
    expect(initPlan.stderr).toBe('');
    expect(initPlan.stdout).toContain('# Scaffold plan');
    expect(initPlan.stdout).toContain('## Scaffold Shape');
    expect(initPlan.stdout).toContain('`solutions` (editable-root): Editable solution source root for unpacked solution content.');
    expect(initPlan.stdout).toContain('./artifacts/solutions/CoreLifecycle.zip  # recommended packaged solution output');
    expect(initPlan.stdout).toContain(
      '`artifacts/solutions/CoreLifecycle.zip` (recommended-bundle): Canonical packaged solution zip path for later pack/export output; `project init` creates the directory, not the zip.'
    );
    expect(initPlan.stdout).toContain(
      'Packaged solution exports belong under `artifacts/solutions/CoreLifecycle.zip`, separate from source assets.'
    );
    expect(initPlan.stdout).toContain(
      '`project init` creates `artifacts/solutions/` but leaves `artifacts/solutions/CoreLifecycle.zip` absent until a later pack/export step writes the bundle.'
    );
  });

  it('resolves relative project init targets from INIT_CWD when running from the package directory', async () => {
    const invocationRoot = await createTempDir();
    const originalCwd = process.cwd();

    process.chdir(resolveRepoPath('packages', 'cli'));

    try {
      const initPlan = await runCli(
        ['project', 'init', 'relative-target', '--name', 'HarnessDemo', '--env', 'sandbox', '--solution', 'CoreLifecycle', '--plan', '--format', 'json'],
        {
          env: {
            INIT_CWD: invocationRoot,
          },
        }
      );

      expect(initPlan.code).toBe(0);
      expect(initPlan.stderr).toBe('');

      const payload = JSON.parse(initPlan.stdout) as Record<string, any>;
      expect(payload.input.root).toBe(join(invocationRoot, 'relative-target'));
      expect(payload.target.root).toBe(join(invocationRoot, 'relative-target'));
      expect(payload.input.configPath).toBe(join(invocationRoot, 'relative-target', 'pp.config.yaml'));
      expect(JSON.stringify(payload)).not.toContain('/packages/cli/relative-target');
    } finally {
      process.chdir(originalCwd);
    }
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

  it('derives conceptual feedback for the fixture project through the CLI entrypoint', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const feedback = await runCli(['project', 'feedback', fixtureRoot, '--format', 'json'], {
      env: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
        PP_SQL_ENDPOINT: undefined,
      },
    });

    expect(feedback.code).toBe(0);
    expect(feedback.stderr).toBe('');

    await expectGoldenJson(JSON.parse(feedback.stdout), 'fixtures/cli/golden/protocol/project-feedback.json', {
      normalize: (value) => normalizeCliSnapshot(value),
    });
  });

  it('renders project feedback in markdown instead of JSON and keeps feedback in stdout', async () => {
    const fixtureRoot = resolveRepoPath('fixtures', 'analysis', 'project');
    const feedback = await runCli(['project', 'feedback', fixtureRoot, '--format', 'markdown'], {
      env: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SECRET_app_token: 'super-secret',
        PP_SQL_ENDPOINT: undefined,
      },
    });

    expect(feedback.code).toBe(0);
    expect(feedback.stdout).toContain('# Project Feedback');
    expect(feedback.stdout).toContain(`- Canonical project root: \`${fixtureRoot}\``);
    expect(feedback.stdout).toContain('- Bundle status: `not generated yet`');
    expect(feedback.stdout).toContain('- Bundle placement: `inline-noncanonical`');
    expect(feedback.stdout).toContain('- Bundle placement summary: Non-canonical bundle placement: solutions/Core.zip is generated artifact output inside editable source space.');
    expect(feedback.stdout).toContain(
      '- Deployment route: pp.config.yaml maps stage prod to environment alias prod and solution CoreManaged.'
    );
    expect(feedback.stdout).toContain('The alias resolves later through the external pp environment registry and its auth context.');
    expect(feedback.stdout).toContain(
      'The canonical bundle artifacts/solutions/core.zip is not generated yet; create it with `pp solution pack <solution-folder> --out artifacts/solutions/core.zip`'
    );
    expect(feedback.stdout).toContain('## Deployment Route');
    expect(feedback.stdout).toContain('1. pp.config.yaml maps stage prod to environment alias prod and solution CoreManaged.');
    expect(feedback.stdout).toContain('## Workflow Wins');
    expect(feedback.stdout).toContain('## Frictions');
    expect(feedback.stdout).toContain('Stage-to-environment-to-solution mapping');
    expect(feedback.stdout).toContain('Deployment route still needs one canonical explanation');
    expect(feedback.stdout).not.toContain('- Active environment:');
    expect(feedback.stdout).not.toContain('- Active solution:');
    expect(feedback.stdout).not.toContain('- Active mapping:');
    expect(feedback.stdout).not.toContain('Environment alias provenance is still easy to miss');
    expect(feedback.stdout).not.toContain('"canonicalProjectRoot"');
    expect(feedback.stderr).toContain('PROJECT_PARAMETER_MISSING');
  });

  it('auto-selects the descendant project root in project inspect and doctor JSON at repo root', async () => {
    const inspect = await runCli(['project', 'inspect', repoRoot, '--format', 'json']);
    const doctor = await runCli(['project', 'doctor', repoRoot, '--format', 'json']);
    const context = await runCli(['analysis', 'context', '--project', repoRoot, '--format', 'json'], {
      env: {
        PP_TENANT_DOMAIN: undefined,
        PP_SQL_ENDPOINT: undefined,
        PP_SECRET_app_token: undefined,
      },
    });

    expect(inspect.code).toBe(0);
    expect(doctor.code).toBe(0);
    expect(context.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(doctor.stderr).toBe('');

    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/cli/golden/protocol/project-root-inspect.json', {
      normalize: (value) => normalizeCliSnapshot(value),
    });
    await expectGoldenJson(JSON.parse(doctor.stdout), 'fixtures/cli/golden/protocol/project-root-doctor.json', {
      normalize: (value) => normalizeCliSnapshot(value),
    });
    if (context.stderr.trim().length > 0) {
      expect(JSON.parse(context.stderr)).toMatchObject({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'PROJECT_PARAMETER_MISSING',
          }),
        ]),
        warnings: [],
      });
    }
    const parsedContext = JSON.parse(context.stdout);
    const expectedAutoSelectedRoot = resolveRepoPath('fixtures', 'analysis', 'project');

    if (parsedContext.discovery?.autoSelectedProjectRoot) {
      expect(parsedContext).toMatchObject({
        discovery: {
          inspectedPath: repoRoot,
          resolvedProjectRoot: expectedAutoSelectedRoot,
          configPath: resolveRepoPath('fixtures', 'analysis', 'project', 'pp.config.yaml'),
          autoSelectedProjectRoot: 'fixtures/analysis/project',
          autoSelectedReason: 'only-descendant-project',
        },
        project: {
          root: expectedAutoSelectedRoot,
        },
      });
    } else {
      expect(parsedContext).toMatchObject({
        discovery: {
          inspectedPath: repoRoot,
          resolvedProjectRoot: repoRoot,
          configPath: resolveRepoPath('pp.config.yaml'),
        },
        project: {
          root: repoRoot,
        },
      });
    }
  });

  it('surfaces canonical project root directly in project inspect and doctor markdown at repo root', async () => {
    const inspect = await runCli(['project', 'inspect', repoRoot, '--format', 'markdown']);
    const doctor = await runCli(['project', 'doctor', repoRoot, '--format', 'markdown']);
    expect(inspect.code).toBe(0);
    expect(doctor.code).toBe(0);
    expect(inspect.stdout).toContain('# Project Inspect');
    expect(inspect.stdout).toContain(`- Canonical project root: \`${repoRoot}\``);
    expect(inspect.stdout).toContain('- Editable roots: `apps`, `flows`, `solutions`, `docs`');
    expect(inspect.stdout).toContain('- Solution source root: `solutions`');
    expect(inspect.stdout).toContain('- Canonical bundle path: `artifacts/solutions/Core.zip`');
    expect(inspect.stdout).toContain(
      'Layout contract: editable assets belong under apps, flows, solutions, docs; keep unpacked solution source in solutions; write generated solution zips to artifacts/solutions/Core.zip.'
    );
    expect(inspect.stdout).toContain('Deployment route: pp.config.yaml maps stage dev to environment alias dev and solution Core.');
    expect(inspect.stdout).toContain('Resolved relationship: stage dev -> environment dev -> auth profile <missing> -> solution Core (Core)');
    expect(inspect.stdout).toContain('Project auth usage: No auth profile could be resolved from the current project stage mappings.');
    expect(inspect.stdout).toContain('## Placement Guidance');
    expect(inspect.stdout).toContain('`solutions` -> `solutions`: Keep unpacked solution source trees under `solutions/<solution>/`');
    expect(doctor.stdout).toContain('# Project Doctor');
    expect(doctor.stdout).toContain(`- Canonical project root: \`${repoRoot}\``);
    expect(doctor.stdout).toContain('- Bundle status: `not generated yet`');
    expect(doctor.stdout).toContain('- Bundle placement: `absent`');
    expect(doctor.stdout).toContain('Bundle placement summary: No generated bundle is currently present.');
    expect(doctor.stdout).toContain('Environment alias provenance: Stage dev in pp.config.yaml selects environment alias dev.');
    expect(doctor.stdout).toContain('Resolved relationship: stage dev -> environment dev -> auth profile <missing> -> solution Core (Core)');
    expect(doctor.stdout).toContain('Project auth usage: No auth profile could be resolved from the current project stage mappings.');
    expect(doctor.stdout).toContain('Bundle lifecycle: The canonical bundle path is artifacts/solutions/Core.zip');
    expect(doctor.stdout).toContain('## Deployment Route');
    expect(doctor.stdout).toContain('## Placement Guidance');
    expect(doctor.stdout).toContain('## Local Layout Checks');
    expect(doctor.stdout).toContain('## External Target Checks');
    expect(doctor.stdout).toContain('1. pp.config.yaml maps stage dev to environment alias dev and solution Core.');
    expect(inspect.stdout).not.toContain('"summary"');
    expect(doctor.stdout).not.toContain('"canonicalProjectRoot"');
  });

  it('resolves SharePoint provider bindings through the CLI', async () => {
    const tempDir = await createTempDir();
    await writeFile(
      join(tempDir, 'pp.config.yaml'),
      [
        'providerBindings:',
        '  financeSite:',
        '    kind: sharepoint-site',
        '    target: https://example.sharepoint.com/sites/finance',
        '    metadata:',
        '      authProfile: graph-user',
        '  financeBudget:',
        '    kind: sharepoint-file',
        '    target: /Shared Documents/Budget.xlsx',
        '    metadata:',
        '      site: financeSite',
        '      drive: Documents',
      ].join('\n'),
      'utf8'
    );

    vi.spyOn(AuthService.prototype, 'getProfile').mockResolvedValue(
      ok(
        {
          name: 'graph-user',
          type: 'static-token',
          token: 'token',
        },
        { supportTier: 'preview' }
      )
    );
    vi.spyOn(SharePointClient.prototype, 'inspectDriveItem').mockResolvedValue(
      ok(
        {
          id: 'item-1',
          name: 'Budget.xlsx',
          driveId: 'drive-1',
        },
        { supportTier: 'preview' }
      )
    );

    const result = await runCli(['sharepoint', 'file', 'inspect', 'financeBudget', '--project', tempDir, '--format', 'json']);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      target: {
        kind: 'sharepoint-file',
        bindingName: 'financeBudget',
        authProfile: 'graph-user',
        metadata: {
          site: 'financeSite',
          drive: 'Documents',
        },
        site: {
          bindingName: 'financeSite',
          value: 'https://example.sharepoint.com/sites/finance',
          source: 'binding',
          referenceType: 'url',
        },
        drive: {
          value: 'Documents',
          source: 'binding',
          referenceType: 'name',
        },
        file: {
          bindingName: 'financeBudget',
          value: '/Shared Documents/Budget.xlsx',
          source: 'binding',
          referenceType: 'path',
        },
      },
      file: {
        id: 'item-1',
        name: 'Budget.xlsx',
        driveId: 'drive-1',
      },
    });
    expect(SharePointClient.prototype.inspectDriveItem).toHaveBeenCalledWith(
      'https://example.sharepoint.com/sites/finance',
      '/Shared Documents/Budget.xlsx',
      {
        drive: 'Documents',
      }
    );
  });

  it('resolves Power BI provider bindings through the CLI', async () => {
    const tempDir = await createTempDir();
    await writeFile(
      join(tempDir, 'pp.config.yaml'),
      [
        'providerBindings:',
        '  financeWorkspace:',
        '    kind: powerbi-workspace',
        '    target: Finance',
        '    metadata:',
        '      authProfile: powerbi-user',
        '  financeDataset:',
        '    kind: powerbi-dataset',
        '    target: Budget Model',
        '    metadata:',
        '      workspace: financeWorkspace',
      ].join('\n'),
      'utf8'
    );

    vi.spyOn(AuthService.prototype, 'getProfile').mockResolvedValue(
      ok(
        {
          name: 'powerbi-user',
          type: 'static-token',
          token: 'token',
        },
        { supportTier: 'preview' }
      )
    );
    vi.spyOn(PowerBiClient.prototype, 'inspectDataset').mockResolvedValue(
      ok(
        {
          id: 'dataset-1',
          name: 'Budget Model',
          workspaceId: 'workspace-1',
          datasources: [],
        },
        { supportTier: 'preview' }
      ) as never
    );

    const result = await runCli(['powerbi', 'dataset', 'inspect', 'financeDataset', '--project', tempDir, '--format', 'json']);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      target: {
        kind: 'powerbi-dataset',
        bindingName: 'financeDataset',
        authProfile: 'powerbi-user',
        metadata: {
          workspace: 'financeWorkspace',
        },
        workspace: {
          bindingName: 'financeWorkspace',
          value: 'Finance',
          source: 'binding',
          referenceType: 'name',
        },
        dataset: {
          bindingName: 'financeDataset',
          value: 'Budget Model',
          source: 'binding',
          referenceType: 'name',
        },
      },
      dataset: {
        id: 'dataset-1',
        name: 'Budget Model',
        workspaceId: 'workspace-1',
        datasources: [],
      },
    });
    expect(PowerBiClient.prototype.inspectDataset).toHaveBeenCalledWith('Finance', 'Budget Model');
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

  it('keeps deploy plan metadata in the success payload instead of only stderr diagnostics', async () => {
    const plan = await runCli(['deploy', 'plan', '--project', resolveRepoPath('fixtures', 'analysis', 'project'), '--format', 'json'], {
      env: {
        PP_TENANT_DOMAIN: undefined,
        PP_SQL_ENDPOINT: undefined,
        PP_SECRET_app_token: undefined,
      },
    });

    expect(plan.code).toBe(0);
    expect(JSON.parse(plan.stdout)).toMatchObject({
      success: true,
      supportTier: 'preview',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'DEPLOY_TARGET_ENVIRONMENT_UNRESOLVED',
        }),
      ]),
      suggestedNextActions: expect.arrayContaining([expect.stringContaining('pp env inspect prod --format json')]),
    });
  });

  it('fails deploy plan closed when the requested stage is not defined', async () => {
    const plan = await runCli(['deploy', 'plan', '--project', '.', '--stage', 'test', '--format', 'json']);

    expect(plan.code).toBe(1);
    expect(JSON.parse(plan.stdout)).toMatchObject({
      requestedStage: 'test',
      projectRoot: repoRoot,
      defaultStage: 'dev',
      activeEnvironment: 'dev',
      activeSolution: 'Core',
      availableStages: ['dev'],
    });
    expect(JSON.parse(plan.stderr)).toMatchObject({
      success: false,
      diagnostics: [
        expect.objectContaining({
          code: 'PROJECT_STAGE_NOT_FOUND',
        }),
      ],
      suggestedNextActions: expect.arrayContaining([expect.stringContaining('configured project stages')]),
    });
  });

  it('fails project inspect closed when the requested stage is not defined', async () => {
    const inspect = await runCli(['project', 'inspect', '--stage', 'test', '--format', 'json']);

    expect(inspect.code).toBe(1);
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      requestedStage: 'test',
      projectRoot: repoRoot,
      defaultStage: 'dev',
      activeEnvironment: 'dev',
      activeSolution: 'Core',
      availableStages: ['dev'],
    });
    expect(JSON.parse(inspect.stderr)).toMatchObject({
      success: false,
      diagnostics: [
        expect.objectContaining({
          code: 'PROJECT_STAGE_NOT_FOUND',
        }),
      ],
      suggestedNextActions: expect.arrayContaining([
        expect.stringContaining('configured project stages'),
        expect.stringContaining('without `--stage`'),
      ]),
    });
  });

  it('adds concrete environment-registry next actions to project inspect output', async () => {
    const inspect = await runCli(['project', 'inspect', '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      success: true,
      suggestedNextActions: expect.arrayContaining([
        'Run `pp env inspect dev --format json` to inspect the external environment registry entry for alias dev.',
      ]),
    });
  });

  it('suggests explicit stage inspection when project topology exposes multiple stages', async () => {
    const tempDir = await createTempDir();
    await writeFile(
      join(tempDir, 'pp.config.yaml'),
      [
        'name: staged-fixture',
        'defaults:',
        '  environment: dev',
        '  solution: core',
        'solutions:',
        '  core:',
        '    environment: dev',
        '    uniqueName: Core',
        'assets:',
        '  solutions: solutions',
        'topology:',
        '  defaultStage: dev',
        '  stages:',
        '    dev:',
        '      environment: dev',
        '      solution: core',
        '    test:',
        '      environment: test',
        '      solution: core',
        '',
      ].join('\n'),
      'utf8'
    );
    await mkdir(join(tempDir, 'solutions'), { recursive: true });

    const inspect = await runCli(['project', 'inspect', tempDir, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      success: true,
      suggestedNextActions: expect.arrayContaining([
        'Project topology exposes multiple stages (dev, test); re-run `pp project inspect --stage <stage> --format json` before mutating a non-default environment target.',
        'Run `pp project inspect --stage test --format json` to inspect that stage\'s environment and solution mapping explicitly.',
      ]),
    });
  });

  it('flags when the selected project solution disagrees with the environment registry default solution', async () => {
    const tempDir = await createTempDir();
    const configDir = await createTempDir();
    await writeFile(
      join(tempDir, 'pp.config.yaml'),
      [
        'name: staged-fixture',
        'defaults:',
        '  environment: test',
        '  solution: core',
        'solutions:',
        '  core:',
        '    environment: test',
        '    uniqueName: Core',
        'assets:',
        '  solutions: solutions',
        'topology:',
        '  defaultStage: test',
        '  stages:',
        '    test:',
        '      environment: test',
        '      solution: core',
        '',
      ].join('\n'),
      'utf8'
    );
    await mkdir(join(tempDir, 'solutions'), { recursive: true });
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          environments: {
            test: {
              alias: 'test',
              url: 'https://example.crm.dynamics.com',
              authProfile: 'fixture-user',
              defaultSolution: 'ppHarnessShell',
            },
          },
          authProfiles: {
            'fixture-user': {
              name: 'fixture-user',
              type: 'user',
              tenantId: '11111111-1111-1111-1111-111111111111',
              clientId: '00000000-0000-0000-0000-000000000000',
              scopes: ['https://example.crm.dynamics.com/.default'],
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const inspect = await runCli(['project', 'inspect', tempDir, '--config-dir', configDir, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(JSON.parse(inspect.stdout)).toMatchObject({
      success: true,
      relationships: {
        stageRelationships: expect.arrayContaining([
          expect.objectContaining({
            stage: 'test',
            environmentAlias: 'test',
            environmentDefaultSolution: 'ppHarnessShell',
            solutionUniqueName: 'Core',
            solutionAlignment: 'mismatch',
          }),
        ]),
      },
      suggestedNextActions: expect.arrayContaining([
        'Environment alias test defaults to solution ppHarnessShell, but the selected project stage targets Core; re-run `pp project inspect --stage <stage> --format json` or update `pp.config.yaml` if this workflow should follow the registry default.',
      ]),
    });
  });

  it('preserves runtime metadata in flow runs, doctor, and monitor JSON success payloads', async () => {
    const flowRuntimeFixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'flow', 'runtime', 'invoice-sync-runtime.json')
    )) as FlowRuntimeFixture;

    mockDataverseResolution({
      fixture: createFixtureDataverseClient(flowRuntimeFixture),
    });

    const runs = await runCli(['flow', 'runs', 'Invoice Sync', '--env', 'fixture', '--solution', 'Core', '--format', 'json']);
    const doctor = await runCli(['flow', 'doctor', 'Invoice Sync', '--env', 'fixture', '--solution', 'Core', '--format', 'json']);
    const monitor = await runCli(['flow', 'monitor', 'Invoice Sync', '--env', 'fixture', '--solution', 'Core', '--format', 'json']);

    expect(runs.code).toBe(0);
    expect(doctor.code).toBe(0);
    expect(monitor.code).toBe(0);
    expect(runs.stderr).toBe('');
    expect(doctor.stderr).toBe('');
    expect(monitor.stderr).toBe('');
    expect(JSON.parse(runs.stdout)).toMatchObject({
      success: true,
      supportTier: 'experimental',
      runs: expect.any(Array),
      knownLimitations: expect.arrayContaining([expect.stringContaining('FlowRun data may be delayed or incomplete')]),
      provenance: expect.arrayContaining([
        expect.objectContaining({
          source: 'Dataverse FlowRun history',
        }),
      ]),
    });
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      success: true,
      supportTier: 'experimental',
      findings: expect.any(Array),
      suggestedNextActions: expect.arrayContaining([expect.stringContaining('pp flow inspect Invoice Sync --environment <alias>')]),
      provenance: expect.arrayContaining([
        expect.objectContaining({
          source: '@pp/flow source correlation',
        }),
      ]),
    });
    expect(JSON.parse(monitor.stdout)).toMatchObject({
      success: true,
      supportTier: 'experimental',
      checkedAt: expect.any(String),
      health: {
        status: expect.any(String),
        telemetryState: expect.any(String),
      },
      findings: expect.arrayContaining([expect.stringContaining('Runtime monitoring')]),
    });
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
      },
    });
    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/cli/golden/protocol/canvas-remote-inspect.json');
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
    expect(result.stderr).toContain('[pp] canvas download: extracting editable source');
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

  it('keeps remote canvas create as an explicit preview placeholder', async () => {
    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'HarnessSolution',
                friendlyname: 'Harness Solution',
                version: '1.0.0.0',
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
          browserProfile: 'maker-from-auth',
        },
      },
    });

    const create = await runCli([
      'canvas',
      'create',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--name',
      'Harness Canvas',
      '--format',
      'json',
    ]);

    expect(create.code).toBe(1);
    await expectGoldenJson(JSON.parse(create.stdout), 'fixtures/cli/golden/protocol/canvas-remote-create-not-implemented.json');
    expect(create.stderr).toBe('');
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

  it('requires remote targeting inputs for canvas create and import', async () => {
    const missingEnv = await runCli(['canvas', 'create', '--format', 'json']);
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

    expect(missingEnv.code).toBe(1);
    expect(JSON.parse(missingEnv.stdout)).toMatchObject({
      success: false,
      diagnostics: [
        {
          code: 'DV_ENV_REQUIRED',
          message: '--environment <alias> is required.',
        },
      ],
    });
    expect(missingEnv.stderr).toBe('');

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

  it('returns solution-aware diagnostics when placeholder canvas mutations target a missing solution', async () => {
    mockDataverseResolution({
      fixture: createFixtureDataverseClient({
        query: {
          solutions: [],
        },
      }),
    });

    const create = await runCli(['canvas', 'create', '--env', 'fixture', '--solution', 'MissingSolution', '--format', 'json']);

    expect(create.code).toBe(1);
    expect(JSON.parse(create.stdout)).toMatchObject({
      success: false,
      diagnostics: [
        {
          code: 'SOLUTION_NOT_FOUND',
          message: 'Solution MissingSolution was not found.',
          source: '@pp/cli',
        },
        {
          code: 'CANVAS_REMOTE_CREATE_NOT_IMPLEMENTED',
          message: 'Remote canvas create is not implemented yet.',
          source: '@pp/cli',
        },
      ],
      suggestedNextActions: [
        'Run `pp solution list --environment fixture` to discover the available solution unique names in this environment.',
        'Retry with a valid `--solution` value, or configure fixture with `defaultSolution` if this workflow should stay solution-scoped by default.',
        'Once you have the right solution, use `pp solution inspect MissingSolution --environment fixture` to confirm it resolves before retrying the canvas workflow.',
      ],
      knownLimitations: expect.arrayContaining(['Remote canvas coverage in pp is currently read-only.']),
    });
  });

  it('reuses the environment default solution in placeholder canvas mutation guidance', async () => {
    const configDir = await createTempDir();
    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'HarnessSolution',
                friendlyname: 'Harness Solution',
                version: '1.0.0.0',
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
          browserProfile: 'maker-from-auth',
        },
      },
    });

    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          environments: {
            fixture: {
              alias: 'fixture',
              url: 'https://fixture.crm.dynamics.com',
              authProfile: 'fixture-user',
              defaultSolution: 'HarnessSolution',
              makerEnvironmentId: 'env-123',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const create = await runCli(['canvas', 'create', '--env', 'fixture', '--name', 'Harness Canvas', '--config-dir', configDir, '--format', 'json']);
    const importResult = await runCli([
      'canvas',
      'import',
      './dist/Harness App.msapp',
      '--env',
      'fixture',
      '--config-dir',
      configDir,
      '--format',
      'json',
    ]);

    expect(create.code).toBe(1);
    expect(JSON.parse(create.stdout)).toMatchObject({
      success: false,
      suggestedNextActions: expect.arrayContaining([
        'Using default solution HarnessSolution from environment alias fixture, keep the Maker step and verification scoped to that solution.',
        'Open https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1 to start the solution-scoped blank canvas app flow in Maker.',
        'After saving in Maker, run `pp canvas inspect "Harness Canvas" --environment fixture --solution HarnessSolution` to confirm the remote app id.',
        'After the Maker step, run `pp canvas list --environment fixture --solution HarnessSolution` to confirm the new app is visible in Dataverse.',
        'Run `pp solution components HarnessSolution --environment fixture --format json` to verify that the app was added to the solution.',
      ]),
    });
    expect(create.stderr).toBe('');

    expect(importResult.code).toBe(1);
    expect(JSON.parse(importResult.stdout)).toMatchObject({
      success: false,
      suggestedNextActions: expect.arrayContaining([
        'Using default solution HarnessSolution from environment alias fixture, keep the Maker step and verification scoped to that solution.',
        'Open https://make.powerapps.com/environments/env-123/solutions/solution-1/apps to continue the import from the solution-scoped apps view in Maker.',
        'After the import step, run `pp canvas inspect "Harness App" --environment fixture --solution HarnessSolution` to confirm the remote app id.',
        'After the import step, run `pp canvas list --environment fixture --solution HarnessSolution` to confirm the app is visible in Dataverse.',
        'Run `pp solution components HarnessSolution --environment fixture --format json` to verify that the imported app was added to the solution.',
      ]),
    });
    expect(importResult.stderr).toBe('');
  });

  it('uses maker deep links in placeholder canvas mutation guidance when the environment alias provides them', async () => {
    const configDir = await createTempDir();
    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'HarnessSolution',
                friendlyname: 'Harness Solution',
                version: '1.0.0.0',
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
        },
      },
    });

    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
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

    const create = await runCli([
      'canvas',
      'create',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--name',
      'Harness Canvas',
      '--config-dir',
      configDir,
      '--format',
      'json',
    ]);
    const importResult = await runCli([
      'canvas',
      'import',
      './dist/Harness App.msapp',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--target',
      'Harness App',
      '--config-dir',
      configDir,
      '--format',
      'json',
    ]);

    expect(create.code).toBe(1);
    expect(JSON.parse(create.stdout)).toMatchObject({
      success: false,
      suggestedNextActions: expect.arrayContaining([
        'Open https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1 to start the solution-scoped blank canvas app flow in Maker.',
      ]),
    });
    expect(create.stderr).toBe('');

    expect(importResult.code).toBe(1);
    expect(JSON.parse(importResult.stdout)).toMatchObject({
      success: false,
    });
    expect(importResult.stderr).toBe('');
  });

  it('discovers the maker environment id for placeholder canvas handoffs when the alias does not store it', async () => {
    const launchBrowserProfile = vi.spyOn(AuthService.prototype, 'launchBrowserProfile').mockResolvedValue({
      success: true,
      diagnostics: [],
      warnings: [],
      supportTier: 'preview',
      data: {
        profile: {
          name: 'maker-fixture',
          kind: 'edge',
        },
        url: 'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1',
        command: 'fake-browser',
        args: ['--user-data-dir=/tmp/maker-fixture', 'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1'],
        profileDir: '/tmp/maker-fixture',
      },
    });
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

    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'HarnessSolution',
                friendlyname: 'Harness Solution',
                version: '1.0.0.0',
              },
            ],
          },
        }),
        environment: {
          url: 'https://fixture.crm.dynamics.com',
        },
        authProfile: {
          name: 'fixture-static',
          type: 'static-token',
          token: 'bap-token',
        },
      },
    });

    const create = await runCli([
      'canvas',
      'create',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--name',
      'Harness Canvas',
      '--open',
      '--browser-profile',
      'maker-fixture',
      '--format',
      'json',
    ]);

    expect(create.code).toBe(0);
    expect(create.stderr).toBe('');
    expect(JSON.parse(create.stdout)).toMatchObject({
      target: {
        envAlias: 'fixture',
        makerEnvironmentId: 'env-123',
        solutionId: 'solution-1',
        solutionUniqueName: 'HarnessSolution',
      },
      handoff: {
        handoff: {
          recommendedUrl:
            'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1',
        },
      },
    });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      'https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/environments?api-version=2020-10-01'
    );
    expect(launchBrowserProfile).toHaveBeenCalledWith(
      'maker-fixture',
      'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1'
    );
  });

  it('persists a discovered maker environment id onto the saved alias during apply-mode canvas create', async () => {
    const configDir = await createTempDir();
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

    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'HarnessSolution',
                friendlyname: 'Harness Solution',
                version: '1.0.0.0',
              },
            ],
          },
        }),
        environment: {
          url: 'https://fixture.crm.dynamics.com',
        },
        authProfile: {
          name: 'fixture-static',
          type: 'static-token',
          token: 'bap-token',
        },
      },
    });

    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          environments: {
            fixture: {
              alias: 'fixture',
              url: 'https://fixture.crm.dynamics.com',
              authProfile: 'fixture-static',
            },
          },
          authProfiles: {
            'fixture-static': {
              name: 'fixture-static',
              type: 'static-token',
              token: 'bap-token',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const create = await runCli([
      'canvas',
      'create',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--name',
      'Harness Canvas',
      '--config-dir',
      configDir,
      '--format',
      'json',
    ]);

    expect(create.code).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const savedConfig = JSON.parse(await readFile(join(configDir, 'config.json'), 'utf8')) as {
      environments: Record<string, { makerEnvironmentId?: string }>;
    };
    expect(savedConfig.environments.fixture?.makerEnvironmentId).toBe('env-123');
  });

  it('lets placeholder canvas mutation guidance override the alias maker environment id per command', async () => {
    const configDir = await createTempDir();
    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'HarnessSolution',
                friendlyname: 'Harness Solution',
                version: '1.0.0.0',
              },
            ],
          },
        }),
        environment: {},
      },
    });

    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
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

    const create = await runCli([
      'canvas',
      'create',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--name',
      'Harness Canvas',
      '--maker-env-id',
      'env-override',
      '--config-dir',
      configDir,
      '--format',
      'json',
    ]);
    const importResult = await runCli([
      'canvas',
      'import',
      './dist/Harness App.msapp',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--maker-env-id',
      'env-override',
      '--config-dir',
      configDir,
      '--format',
      'json',
    ]);

    expect(create.code).toBe(1);
    expect(JSON.parse(create.stdout)).toMatchObject({
      success: false,
      suggestedNextActions: expect.arrayContaining([
        'Open https://make.powerapps.com/e/env-override/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1 to start the solution-scoped blank canvas app flow in Maker.',
      ]),
    });
    expect(create.stderr).toBe('');

    expect(importResult.code).toBe(1);
    expect(JSON.parse(importResult.stdout)).toMatchObject({
      success: false,
      suggestedNextActions: expect.arrayContaining([
        'Open https://make.powerapps.com/environments/env-override/solutions/solution-1/apps to continue the import from the solution-scoped apps view in Maker.',
      ]),
    });
    expect(importResult.stderr).toBe('');
  });

  it('renders structured preview output for placeholder remote canvas mutations', async () => {
    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'HarnessSolution',
                friendlyname: 'Harness Solution',
                version: '1.0.0.0',
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
          browserProfile: 'maker-from-auth',
        },
      },
    });

    for (const previewCase of [
      { flag: '--dry-run', mode: 'dry-run' },
      { flag: '--plan', mode: 'plan' },
    ] as const) {
      const create = await runCli([
        'canvas',
        'create',
        '--env',
        'fixture',
        '--solution',
        'HarnessSolution',
        '--name',
        'Harness Canvas',
        previewCase.flag,
        '--format',
        'json',
      ]);
      const importResult = await runCli([
        'canvas',
        'import',
        './dist/Harness App.msapp',
        '--env',
        'fixture',
        '--solution',
        'HarnessSolution',
        '--target',
        'Imported Harness Canvas',
        previewCase.flag,
        '--format',
        'json',
      ]);

      expect(create.code).toBe(0);
      expect(create.stderr).toBe('');
      expect(JSON.parse(create.stdout)).toMatchObject({
        supportTier: 'preview',
        knownLimitations: expect.arrayContaining(['Remote canvas coverage in pp is currently read-only.']),
        provenance: expect.arrayContaining([
          expect.objectContaining({
            kind: 'official-api',
          }),
          expect.objectContaining({
            kind: 'inferred',
          }),
        ]),
      });
      await expectGoldenJson(
        JSON.parse(create.stdout),
        `fixtures/cli/golden/protocol/canvas-remote-create-${previewCase.mode}.json`
      );

      expect(importResult.code).toBe(0);
      expect(importResult.stderr).toBe('');
      expect(JSON.parse(importResult.stdout)).toMatchObject({
        supportTier: 'preview',
        knownLimitations: [],
        provenance: [],
      });
      await expectGoldenJson(
        JSON.parse(importResult.stdout),
        `fixtures/cli/golden/protocol/canvas-remote-import-${previewCase.mode}.json`
      );
    }
  });

  it('launches the Maker handoff for placeholder canvas mutations through a persisted browser profile', async () => {
    const launchBrowserProfile = vi.spyOn(AuthService.prototype, 'launchBrowserProfile').mockResolvedValue({
      success: true,
      diagnostics: [],
      warnings: [],
      supportTier: 'preview',
      data: {
        profile: {
          name: 'maker-fixture',
          kind: 'edge',
        },
        url: 'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1',
        command: 'fake-browser',
        args: ['--user-data-dir=/tmp/maker-fixture', 'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1'],
        profileDir: '/tmp/maker-fixture',
      },
    });

    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'HarnessSolution',
                friendlyname: 'Harness Solution',
                version: '1.0.0.0',
              },
            ],
          },
        }),
        environment: {
          makerEnvironmentId: 'env-123',
        },
      },
    });

    const create = await runCli([
      'canvas',
      'create',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--name',
      'Harness Canvas',
      '--open',
      '--browser-profile',
      'maker-fixture',
      '--format',
      'json',
    ]);

    expect(create.code).toBe(0);
    expect(create.stderr).toBe('');
    await expectGoldenJson(JSON.parse(create.stdout), 'fixtures/cli/golden/protocol/canvas-remote-create-open.json');

    expect(launchBrowserProfile).toHaveBeenCalledWith(
      'maker-fixture',
      'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1'
    );
  });

  it('can delegate canvas create through Maker automation and return the created app id', async () => {
    const artifactsDir = await createTempDir();
    vi.spyOn(AuthService.prototype, 'getBrowserProfile').mockResolvedValue(
      ok({
        name: 'maker-fixture',
        kind: 'edge',
      })
    );
    vi.spyOn(canvasCreateDelegate, 'runDelegatedCanvasCreate').mockResolvedValue(
      ok({
        appName: 'Harness Canvas',
        envAlias: 'fixture',
        solutionUniqueName: 'HarnessSolution',
        targetUrl: 'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1',
        browserProfile: 'maker-fixture',
        baselineMatches: [],
        studioRuntimeTarget: 'frame:EmbeddedStudio',
        pageUrl: 'https://make.powerapps.com/e/env-123/canvas/?action=edit&id=app-1',
        title: 'Power Apps Studio',
        frames: [{ name: 'EmbeddedStudio', url: 'https://make.powerapps.com/studio' }],
        createdApp: {
          id: 'app-1',
          name: 'pp_harnesscanvas',
          displayName: 'Harness Canvas',
          appVersion: '1.0.0.0',
          solutionUniqueNames: ['HarnessSolution'],
          openUri: 'https://make.powerapps.com/play/app-1',
          tags: ['Canvas'],
          inSolution: true,
        },
        screenshotPath: join(artifactsDir, 'harness-canvas.png'),
        sessionPath: join(artifactsDir, 'harness-canvas.session.json'),
      })
    );

    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'HarnessSolution',
                friendlyname: 'Harness Solution',
                version: '1.0.0.0',
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
          browserProfile: 'maker-fixture',
        },
      },
    });

    const create = await runCli([
      'canvas',
      'create',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--name',
      'Harness Canvas',
      '--delegate',
      '--artifacts-dir',
      artifactsDir,
      '--format',
      'json',
    ]);

    expect(create.code).toBe(0);
    expect(create.stderr).toBe('');
    expect(normalizeCliSnapshot(JSON.parse(create.stdout), artifactsDir)).toEqual({
      action: 'canvas.create.remote.delegated',
      delegated: true,
      input: {
        displayName: 'Harness Canvas',
      },
      target: {
        envAlias: 'fixture',
        solutionUniqueName: 'HarnessSolution',
        solutionId: 'solution-1',
        makerEnvironmentId: 'env-123',
        supported: false,
      },
      handoff: {
        handoff: {
          displayName: 'Harness Canvas',
          kind: 'maker-blank-app',
          makerUrls: {
            blankAppUrl:
              'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1',
            solutionAppsUrl: 'https://make.powerapps.com/environments/env-123/solutions/solution-1/apps',
            solutionsUrl: 'https://make.powerapps.com/environments/env-123/solutions',
          },
          recommendedUrl:
            'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1',
        },
        verification: {
          inspectCommand: 'pp canvas inspect "Harness Canvas" --environment fixture --solution HarnessSolution',
          listCommand: 'pp canvas list --environment fixture --solution HarnessSolution',
          solutionComponentsCommand: 'pp solution components HarnessSolution --environment fixture --format json',
        },
      },
      automation: {
        appName: 'Harness Canvas',
        envAlias: 'fixture',
        solutionUniqueName: 'HarnessSolution',
        targetUrl:
          'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1',
        browserProfile: 'maker-fixture',
        baselineMatches: [],
        studioRuntimeTarget: 'frame:EmbeddedStudio',
        pageUrl: 'https://make.powerapps.com/e/env-123/canvas/?action=edit&id=app-1',
        title: 'Power Apps Studio',
        frames: [{ name: 'EmbeddedStudio', url: 'https://make.powerapps.com/studio' }],
        createdApp: {
          id: 'app-1',
          name: 'pp_harnesscanvas',
          displayName: 'Harness Canvas',
          appVersion: '1.0.0.0',
          solutionUniqueNames: ['HarnessSolution'],
          openUri: 'https://make.powerapps.com/play/app-1',
          tags: ['Canvas'],
          inSolution: true,
        },
        screenshotPath: '<TMP_DIR>/harness-canvas.png',
        sessionPath: '<TMP_DIR>/harness-canvas.session.json',
      },
      createdApp: {
        id: 'app-1',
        name: 'pp_harnesscanvas',
        displayName: 'Harness Canvas',
        appVersion: '1.0.0.0',
        solutionUniqueNames: ['HarnessSolution'],
        openUri: 'https://make.powerapps.com/play/app-1',
        tags: ['Canvas'],
        inSolution: true,
      },
      supportTier: 'preview',
      suggestedNextActions: [
        'Run `pp canvas inspect "Harness Canvas" --environment fixture --solution HarnessSolution` to confirm the delegated flow returned the same remote app id through pp.',
        'Run `pp canvas list --environment fixture --solution HarnessSolution` to confirm the new app remains visible in Dataverse.',
        'Run `pp solution components HarnessSolution --environment fixture --format json` to confirm the app remains attached to the solution.',
      ],
      knownLimitations: [
        'Remote canvas creation still depends on delegated Maker browser automation.',
        'Studio readiness and publish timing can still vary by tenant and browser session.',
      ],
      provenance: [
        {
          detail: 'Environment alias fixture was resolved through configured Dataverse metadata and solution HarnessSolution.',
          kind: 'official-api',
          source: '@pp/cli canvas remote mutation resolution',
        },
        {
          detail: 'Maker handoff URLs and verification commands were synthesized from the resolved environment (env-123) and command inputs.',
          kind: 'inferred',
          source: '@pp/cli canvas Maker fallback guidance',
        },
        {
          detail:
            'pp drove the solution-scoped blank-app flow through persisted browser profile maker-fixture and waited for the Dataverse canvas app row.',
          kind: 'inferred',
          source: '@pp/cli delegated Maker browser automation',
        },
      ],
    });
    expect(create.stderr).toBe('');
  });

  it('normalizes delegated canvas create failures that return an empty envelope', async () => {
    const artifactsDir = await createTempDir();
    vi.spyOn(AuthService.prototype, 'getBrowserProfile').mockResolvedValue(
      ok({
        name: 'maker-fixture',
        kind: 'edge',
      })
    );
    vi.spyOn(canvasCreateDelegate, 'runDelegatedCanvasCreate').mockResolvedValue({
      success: false,
      diagnostics: [],
      warnings: [],
      supportTier: 'preview',
    });

    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'HarnessSolution',
                friendlyname: 'Harness Solution',
                version: '1.0.0.0',
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
          browserProfile: 'maker-fixture',
        },
      },
    });

    const create = await runCli([
      'canvas',
      'create',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--name',
      'Harness Canvas',
      '--delegate',
      '--artifacts-dir',
      artifactsDir,
      '--format',
      'json',
    ]);

    expect(create.code).toBe(1);
    expect(normalizeCliSnapshot(JSON.parse(create.stdout), artifactsDir)).toEqual({
      success: false,
      diagnostics: [
        {
          code: 'CANVAS_CREATE_DELEGATE_EMPTY_FAILURE',
          hint:
            'Inspect artifacts under <TMP_DIR> and retry with --debug if the Maker session did not finish loading.',
          level: 'error',
          message: 'Delegated canvas create for Harness Canvas failed without diagnostics.',
          source: '@pp/cli',
        },
      ],
      warnings: [],
      details: {
        handoff: {
          handoff: {
            displayName: 'Harness Canvas',
            kind: 'maker-blank-app',
            makerUrls: {
              blankAppUrl:
                'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1',
              solutionAppsUrl: 'https://make.powerapps.com/environments/env-123/solutions/solution-1/apps',
              solutionsUrl: 'https://make.powerapps.com/environments/env-123/solutions',
            },
            recommendedUrl:
              'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1',
          },
          verification: {
            inspectCommand: 'pp canvas inspect "Harness Canvas" --environment fixture --solution HarnessSolution',
            listCommand: 'pp canvas list --environment fixture --solution HarnessSolution',
            solutionComponentsCommand: 'pp solution components HarnessSolution --environment fixture --format json',
          },
        },
        automation: {
          appName: 'Harness Canvas',
          envAlias: 'fixture',
          solutionUniqueName: 'HarnessSolution',
          browserProfile: 'maker-fixture',
          artifacts: {
            artifactsDir: '<TMP_DIR>',
            screenshotPath: '<TMP_DIR>/harness-canvas.png',
            sessionPath: '<TMP_DIR>/harness-canvas.session.json',
          },
        },
      },
      supportTier: 'preview',
      suggestedNextActions: [
        'Inspect <TMP_DIR>/harness-canvas.session.json and the paired screenshot before retrying.',
        'Retry with `--debug` to keep the delegated browser session visible if Studio readiness is timing-sensitive.',
        'Use `pp canvas create --environment fixture --solution HarnessSolution --name "Harness Canvas" --delegate --browser-profile maker-fixture` to let pp drive the Maker blank-app flow and wait for the created app id.',
        'Use Maker blank-app creation for now when you need a new remote canvas app.',
        'Open https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1 to start the solution-scoped blank canvas app flow in Maker.',
        'After saving in Maker, run `pp canvas inspect "Harness Canvas" --environment fixture --solution HarnessSolution` to confirm the remote app id.',
        'After the Maker step, run `pp canvas list --environment fixture --solution HarnessSolution` to confirm the new app is visible in Dataverse.',
        'Run `pp solution components HarnessSolution --environment fixture --format json` to verify that the app was added to the solution.',
      ],
      provenance: [
        {
          detail: 'Environment alias fixture was resolved through configured Dataverse metadata and solution HarnessSolution.',
          kind: 'official-api',
          source: '@pp/cli canvas remote mutation resolution',
        },
        {
          detail: 'Maker handoff URLs and verification commands were synthesized from the resolved environment (env-123) and command inputs.',
          kind: 'inferred',
          source: '@pp/cli canvas Maker fallback guidance',
        },
        {
          detail:
            'pp attempted the solution-scoped blank-app flow through persisted browser profile maker-fixture.',
          kind: 'inferred',
          source: '@pp/cli delegated Maker browser automation',
        },
      ],
      knownLimitations: [
        'Remote canvas creation still depends on delegated Maker browser automation.',
        'Studio readiness and publish timing can still vary by tenant and browser session.',
      ],
    });
  });

  it('reuses the environment auth profile browser profile when opening a Maker handoff', async () => {
    const configDir = await createTempDir();
    const launchBrowserProfile = vi.spyOn(AuthService.prototype, 'launchBrowserProfile').mockResolvedValue({
      success: true,
      diagnostics: [],
      warnings: [],
      supportTier: 'preview',
      data: {
        profile: {
          name: 'maker-from-auth',
          kind: 'edge',
        },
        url: 'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1',
        command: 'fake-browser',
        args: ['--user-data-dir=/tmp/maker-from-auth', 'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1'],
        profileDir: '/tmp/maker-from-auth',
      },
    });

    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'HarnessSolution',
                friendlyname: 'Harness Solution',
                version: '1.0.0.0',
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
          browserProfile: 'maker-from-auth',
        },
      },
    });
    expect(create.stderr).toBe('');

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
              browserProfile: 'maker-from-auth',
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

    const create = await runCli([
      'canvas',
      'create',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--name',
      'Harness Canvas',
      '--open',
      '--config-dir',
      configDir,
      '--format',
      'json',
    ]);

    expect(create.code).toBe(0);
    expect(create.stderr).toBe('');
    await expectGoldenJson(JSON.parse(create.stdout), 'fixtures/cli/golden/protocol/canvas-remote-create-open-inferred-browser-profile.json');
    expect(launchBrowserProfile).toHaveBeenCalledWith(
      'maker-from-auth',
      'https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1'
    );
  });

  it('requires browser-profile launch context when neither the command nor auth profile provides one', async () => {
    const configDir = await createTempDir();
    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'HarnessSolution',
                friendlyname: 'Harness Solution',
                version: '1.0.0.0',
              },
            ],
          },
        }),
        environment: {
          makerEnvironmentId: 'env-123',
        },
      },
    });

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

    const missingBrowserProfile = await runCli([
      'canvas',
      'create',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--name',
      'Harness Canvas',
      '--open',
      '--config-dir',
      configDir,
      '--format',
      'json',
    ]);

    expect(missingBrowserProfile.code).toBe(1);
    await expectGoldenJson(
      JSON.parse(missingBrowserProfile.stdout),
      'fixtures/cli/golden/protocol/canvas-remote-create-open-missing-browser-profile.json'
    );
    expect(missingBrowserProfile.stderr).toBe('');
  });

  it('returns a stable diagnostic when a Maker handoff URL cannot be opened yet', async () => {
    mockDataverseResolution({
      fixture: {
        client: createFixtureDataverseClient({
          query: {
            solutions: [
              {
                solutionid: 'solution-1',
                uniquename: 'HarnessSolution',
                friendlyname: 'Harness Solution',
                version: '1.0.0.0',
              },
            ],
          },
        }),
        environment: {},
      },
    });

    const create = await runCli([
      'canvas',
      'create',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--name',
      'Harness Canvas',
      '--open',
      '--browser-profile',
      'maker-fixture',
      '--format',
      'json',
    ]);

    expect(create.code).toBe(1);
    await expectGoldenJson(JSON.parse(create.stdout), 'fixtures/cli/golden/protocol/canvas-remote-create-open-unavailable.json');
    expect(create.stderr).toBe('');
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
    const pacPath = join(tempDir, 'fake-pac.js');
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
    await writeFile(
      pacPath,
      [
        '#!/usr/bin/env node',
        "const { writeFileSync } = require('node:fs');",
        'const args = process.argv.slice(2);',
        "const zipfile = args[args.indexOf('--zipfile') + 1];",
        "if (args[1] === 'pack') writeFileSync(zipfile, 'cli-packed');",
      ].join('\n'),
      'utf8'
    );
    await chmod(pacPath, 0o755);

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
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
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

  it('covers dry-run and plan previews for canvas and flow mutation commands without side effects', async () => {
    const tempDir = await createTempDir();
    const baseAppPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'base-app');
    const registryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'runtime-registry.json');
    const rawPath = resolveRepoPath('fixtures', 'flow', 'raw', 'invoice-flow.raw.json');
    const patchPath = resolveRepoPath('fixtures', 'flow', 'patches', 'invoice-flow.patch.json');
    for (const previewCase of [
      {
        flag: '--dry-run',
        name: 'dry-run',
      },
      {
        flag: '--plan',
        name: 'plan',
      },
    ] as const) {
      const canvasOutPath = join(tempDir, `FixtureCanvas.${previewCase.name}.msapp`);
      const unpackedPath = join(tempDir, `unpacked-${previewCase.name}`);
      const normalizedPath = join(tempDir, `normalized-${previewCase.name}`);
      const patchedPath = join(tempDir, `patched-${previewCase.name}`);

      const canvasBuild = await runCli([
        'canvas',
        'build',
        baseAppPath,
        '--mode',
        'strict',
        '--registry',
        registryPath,
        '--out',
        canvasOutPath,
        previewCase.flag,
        '--format',
        'json',
      ]);
      const flowUnpack = await runCli([
        'flow',
        'unpack',
        rawPath,
        '--out',
        unpackedPath,
        previewCase.flag,
        '--format',
        'json',
      ]);
      const flowNormalize = await runCli([
        'flow',
        'normalize',
        unpackedPath,
        '--out',
        normalizedPath,
        previewCase.flag,
        '--format',
        'json',
      ]);
      const flowPatch = await runCli([
        'flow',
        'patch',
        unpackedPath,
        '--file',
        patchPath,
        '--out',
        patchedPath,
        previewCase.flag,
        '--format',
        'json',
      ]);

      expect(canvasBuild.code).toBe(0);
      expect(canvasBuild.stderr).toBe('');
      expect(flowUnpack.code).toBe(0);
      expect(flowUnpack.stderr).toBe('');
      expect(flowNormalize.code).toBe(0);
      expect(flowNormalize.stderr).toBe('');
      expect(flowPatch.code).toBe(0);
      expect(flowPatch.stderr).toBe('');

      await expectGoldenJson(JSON.parse(canvasBuild.stdout), `fixtures/cli/golden/mutation/canvas-build-${previewCase.name}.json`, {
        normalize: (value) => normalizeCliSnapshot(value, tempDir),
      });
      await expectGoldenJson(JSON.parse(flowUnpack.stdout), `fixtures/cli/golden/mutation/flow-unpack-${previewCase.name}.json`, {
        normalize: (value) => normalizeCliSnapshot(value, tempDir),
      });
      await expectGoldenJson(JSON.parse(flowNormalize.stdout), `fixtures/cli/golden/mutation/flow-normalize-${previewCase.name}.json`, {
        normalize: (value) => normalizeCliSnapshot(value, tempDir),
      });
      await expectGoldenJson(JSON.parse(flowPatch.stdout), `fixtures/cli/golden/mutation/flow-patch-${previewCase.name}.json`, {
        normalize: (value) => normalizeCliSnapshot(value, tempDir),
      });

      await expect(access(canvasOutPath)).rejects.toThrow();
      await expect(access(unpackedPath)).rejects.toThrow();
      await expect(access(normalizedPath)).rejects.toThrow();
      await expect(access(patchedPath)).rejects.toThrow();
    }
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

  it('covers real CLI failure protocol outputs for fixture-backed canvas and flow diagnostics', async () => {
    const tempDir = await createTempDir();
    const canvasAppPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'diagnostic-app');
    const runtimeRegistryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'runtime-registry.json');
    const semanticRegistryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'semantic-registry.json');
    const canvasOutPath = join(tempDir, 'DiagnosticCanvas.msapp');
    const flowArtifactPath = resolveRepoPath('fixtures', 'flow', 'artifacts', 'diagnostic-flow');

    const canvasValidate = await runCli([
      'canvas',
      'validate',
      canvasAppPath,
      '--mode',
      'strict',
      '--registry',
      runtimeRegistryPath,
      '--registry',
      semanticRegistryPath,
      '--format',
      'table',
    ]);
    const canvasBuild = await runCli([
      'canvas',
      'build',
      canvasAppPath,
      '--mode',
      'strict',
      '--registry',
      runtimeRegistryPath,
      '--registry',
      semanticRegistryPath,
      '--out',
      canvasOutPath,
      '--format',
      'raw',
    ]);
    const flowValidateTable = await runCli(['flow', 'validate', flowArtifactPath, '--format', 'table']);
    const flowValidateYaml = await runCli(['flow', 'validate', flowArtifactPath, '--format', 'yaml']);

    expect(canvasValidate.code).toBe(1);
    expect(canvasBuild.code).toBe(1);
    expect(canvasBuild.stdout).toBe('');
    expect(flowValidateTable.code).toBe(1);
    expect(flowValidateYaml.code).toBe(1);

    await expectGoldenText(canvasValidate.stdout, 'fixtures/cli/golden/protocol/canvas-validate-failure.table.txt', {
      normalize: (value) => normalizeCliSnapshot(value),
    });
    await expectGoldenText(canvasValidate.stderr, 'fixtures/cli/golden/protocol/canvas-validate-diagnostics.table.txt');
    await expectGoldenText(canvasBuild.stderr, 'fixtures/cli/golden/protocol/canvas-build-failure.raw.txt', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenText(flowValidateTable.stdout, 'fixtures/cli/golden/protocol/flow-validate-failure.table.txt', {
      normalize: (value) => normalizeCliSnapshot(value),
    });
    await expectGoldenText(flowValidateTable.stderr, 'fixtures/cli/golden/protocol/flow-validate-diagnostics.table.txt');
    await expectGoldenText(flowValidateYaml.stdout, 'fixtures/cli/golden/protocol/flow-validate-failure.yaml', {
      normalize: (value) => normalizeCliSnapshot(value),
    });
    expect(flowValidateYaml.stderr).toBe('');
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

  it('covers flow export, unpack, pack, validate, patch, and normalize through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const rawPath = resolveRepoPath('fixtures', 'flow', 'raw', 'invoice-flow.raw.json');
    const patchPath = resolveRepoPath('fixtures', 'flow', 'patches', 'invoice-flow.patch.json');
    const exportedPath = join(tempDir, 'exported');
    const unpackedPath = join(tempDir, 'unpacked');
    const packedPath = join(tempDir, 'repacked.json');
    const patchedPath = join(tempDir, 'patched');
    const normalizedPath = join(tempDir, 'normalized');
    const exportClient = createFixtureDataverseClient({
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
            type: 1,
            mode: 0,
            ondemand: false,
            primaryentity: 'none',
            statecode: 1,
            statuscode: 2,
            clientdata: JSON.stringify({
              definition: {
                parameters: {
                  '$connections': {
                    value: {
                      shared_office365: {
                        connectionId: '/connections/office365',
                        connectionReferenceLogicalName: 'shared_office365',
                      },
                    },
                  },
                  ApiBaseUrl: {
                    defaultValue: 'https://example.test',
                  },
                },
                actions: {
                  SendMail: {
                    inputs: {
                      subject: "@{parameters('ApiBaseUrl')}",
                      body: "@{environmentVariables('pp_ApiUrl')}",
                    },
                  },
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
          {
            solutioncomponentid: 'comp-2',
            objectid: 'ref-1',
            componenttype: 371,
          },
          {
            solutioncomponentid: 'comp-3',
            objectid: 'env-1',
            componenttype: 380,
          },
        ],
        connectionreferences: [
          {
            connectionreferenceid: 'ref-1',
            connectionreferencelogicalname: 'shared_office365',
            connectorid: '/providers/microsoft.powerapps/apis/shared_office365',
            connectionid: '/connections/office365',
            _solutionid_value: 'sol-1',
          },
        ],
        environmentvariabledefinitions: [
          {
            environmentvariabledefinitionid: 'env-1',
            schemaname: 'pp_ApiUrl',
            defaultvalue: 'https://api.example.test',
            _solutionid_value: 'sol-1',
          },
        ],
        environmentvariablevalues: [
          {
            environmentvariablevalueid: 'env-value-1',
            value: 'https://api.example.test',
            _environmentvariabledefinitionid_value: 'env-1',
            statecode: 0,
          },
        ],
      },
    });

    mockDataverseResolution({
      fixture: exportClient,
    });

    const inspect = await runCli(['flow', 'inspect', rawPath, '--format', 'json']);
    const exportResult = await runCli([
      'flow',
      'export',
      'Invoice Sync',
      '--env',
      'fixture',
      '--solution',
      'Core',
      '--out',
      exportedPath,
      '--format',
      'json',
    ]);
    const unpack = await runCli(['flow', 'unpack', rawPath, '--out', unpackedPath, '--format', 'json']);
    const pack = await runCli(['flow', 'pack', unpackedPath, '--out', packedPath, '--format', 'json']);
    const validate = await runCli(['flow', 'validate', unpackedPath, '--format', 'json']);
    const graph = await runCli([
      'flow',
      'graph',
      resolveRepoPath('fixtures', 'flow', 'artifacts', 'semantic-diagnostic-flow'),
      '--format',
      'json',
    ]);
    const patch = await runCli(['flow', 'patch', unpackedPath, '--file', patchPath, '--out', patchedPath, '--format', 'json']);
    const normalize = await runCli(['flow', 'normalize', patchedPath, '--out', normalizedPath, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(exportResult.code).toBe(0);
    expect(exportResult.stderr).toBe('');
    expect(unpack.code).toBe(0);
    expect(unpack.stderr).toBe('');
    expect(pack.code).toBe(0);
    expect(pack.stderr).toBe('');
    expect(validate.code).toBe(0);
    expect(validate.stderr).toBe('');
    expect(graph.code).toBe(0);
    expect(graph.stderr).toBe('');
    expect(patch.code).toBe(0);
    expect(patch.stderr).toBe('');
    expect(normalize.code).toBe(0);
    expect(normalize.stderr).toBe('');

    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/flow/golden/inspect-summary.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    expect(JSON.parse(exportResult.stdout)).toMatchObject({
      identifier: 'Invoice Sync',
      outPath: join(exportedPath, 'flow.json'),
      source: {
        id: 'flow-1',
        uniqueName: 'crd_InvoiceSync',
        workflowMetadata: {
          type: 1,
          mode: 0,
          onDemand: false,
          primaryEntity: 'none',
        },
        solutionUniqueName: 'Core',
      },
    });
    expect(await readJsonFile(join(exportedPath, 'flow.json'))).toMatchObject({
      schemaVersion: 1,
      kind: 'pp.flow.artifact',
      metadata: {
        id: 'flow-1',
        uniqueName: 'crd_InvoiceSync',
        workflowMetadata: {
          type: 1,
          mode: 0,
          onDemand: false,
          primaryEntity: 'none',
        },
        sourcePath: 'dataverse://workflows/flow-1',
      },
    });
    await expectGoldenJson(JSON.parse(unpack.stdout), 'fixtures/flow/golden/unpack-result.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(await readJsonFile(join(unpackedPath, 'flow.json')), 'fixtures/flow/golden/unpacked.flow.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(pack.stdout), 'fixtures/flow/golden/pack-result.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(await readJsonFile(packedPath), 'fixtures/flow/golden/packed.raw.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(validate.stdout), 'fixtures/flow/golden/validation-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(graph.stdout), 'fixtures/flow/golden/semantic/graph-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(patch.stdout), 'fixtures/flow/golden/patched-result.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(await readJsonFile(join(patchedPath, 'flow.json')), 'fixtures/flow/golden/patched.flow.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(normalize.stdout), 'fixtures/flow/golden/normalized-after-patch.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
  });

  it('promotes a flow through a packaged solution via the CLI entrypoint', async () => {
    const sourceRequests: Array<{ path: string; body?: Record<string, unknown> }> = [];
    const targetRequests: Array<{ path: string; body?: Record<string, unknown> }> = [];
    const sourceClient = {
      query: async <T>(options: { table: string }) =>
        ok(
          options.table === 'solutions'
            ? ([{ solutionid: 'sol-1', uniquename: 'Core', friendlyname: 'Core', version: '1.0.0.0' }] as T[])
            : ([] as T[]),
          { supportTier: 'preview' }
        ),
      queryAll: async <T>(options: { table: string }) =>
        ok(
          options.table === 'workflows'
            ? ([
                {
                  workflowid: 'flow-1',
                  name: 'Invoice Sync',
                  uniquename: 'crd_InvoiceSync',
                  category: 5,
                  statecode: 1,
                  statuscode: 2,
                  clientdata: JSON.stringify({
                    definition: {
                      actions: {
                        SendMail: {
                          type: 'Compose',
                        },
                      },
                    },
                  }),
                },
              ] as T[])
            : options.table === 'solutioncomponents'
              ? ([
                  {
                    solutioncomponentid: 'comp-1',
                    objectid: 'flow-1',
                    componenttype: 29,
                  },
                ] as T[])
              : ([] as T[]),
          { supportTier: 'preview' }
        ),
      invokeAction: async <T>(name: string, parameters?: Record<string, unknown>) => {
        sourceRequests.push({ path: name, body: parameters });
        return ok(
          {
            status: 200,
            headers: {},
            body: {
              ExportSolutionFile: Buffer.from('cli-solution-package').toString('base64'),
            } as T,
          },
          { supportTier: 'preview' }
        );
      },
    } as unknown as DataverseClient;
    const targetClient = {
      invokeAction: async (_name: string, parameters?: Record<string, unknown>) => {
        targetRequests.push({ path: 'ImportSolution', body: parameters });
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
      source: { client: sourceClient },
      target: { client: targetClient },
    });

    const promote = await runCli([
      'flow',
      'promote',
      'Invoice Sync',
      '--source-environment',
      'source',
      '--source-solution',
      'Core',
      '--target-environment',
      'target',
      '--solution-package',
      '--managed-solution-package',
      '--overwrite-unmanaged-customizations',
      '--holding-solution',
      '--skip-product-update-dependencies',
      '--no-publish-workflows',
      '--import-job-id',
      'job-123',
      '--format',
      'json',
    ]);

    expect(promote.code).toBe(0);
    expect(promote.stderr).toContain('DATAVERSE_CONNREF_SCOPE_EMPTY');
    expect(promote.stderr).toContain('DATAVERSE_CONNREF_VALIDATE_EMPTY');
    expect(JSON.parse(promote.stdout)).toMatchObject({
      identifier: 'Invoice Sync',
      operation: 'imported-solution',
      promotionMode: 'solution-package',
      targetSolutionUniqueName: 'Core',
      solutionPackage: {
        packageType: 'managed',
      },
      importOptions: {
        publishWorkflows: false,
        overwriteUnmanagedCustomizations: true,
        holdingSolution: true,
        skipProductUpdateDependencies: true,
        importJobId: 'job-123',
      },
      validation: {
        valid: true,
      },
    });
    expect(sourceRequests).toEqual([
      {
        path: 'ExportSolution',
        body: {
          SolutionName: 'Core',
          Managed: true,
        },
      },
    ]);
    expect(targetRequests).toHaveLength(1);
    expect(targetRequests[0]?.path).toBe('ImportSolution');
    expect(targetRequests[0]?.body).toMatchObject({
      PublishWorkflows: false,
      OverwriteUnmanagedCustomizations: true,
      HoldingSolution: true,
      SkipProductUpdateDependencies: true,
      ImportJobId: 'job-123',
      CustomizationFile: Buffer.from('cli-solution-package').toString('base64'),
    });
  });

  it('rejects solution-package import override flags on artifact-mode flow promote', async () => {
    mockDataverseResolution({
      source: { client: createFixtureDataverseClient({}) },
      target: { client: createFixtureDataverseClient({}) },
    });

    const promote = await runCli([
      'flow',
      'promote',
      'Invoice Sync',
      '--source-environment',
      'source',
      '--target-environment',
      'target',
      '--no-publish-workflows',
      '--format',
      'json',
    ]);

    expect(promote.code).toBe(1);
    expect(JSON.parse(promote.stdout)).toMatchObject({
      code: 'FLOW_PROMOTE_PACKAGE_IMPORT_OPTIONS_UNSUPPORTED',
    });
    expect(promote.stderr).toBe('');
  });

  it('deploys a validated flow artifact through the CLI entrypoint', async () => {
    const client = createFixtureDataverseClient({
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
            name: 'Invoice Flow',
            uniquename: 'crd_InvoiceFlow',
            category: 5,
            statecode: 1,
            statuscode: 2,
          },
        ],
        solutioncomponents: [
          {
            solutioncomponentid: 'comp-1',
            objectid: 'flow-1',
            componenttype: 29,
          },
          {
            solutioncomponentid: 'comp-2',
            objectid: 'ref-1',
            componenttype: 371,
          },
          {
            solutioncomponentid: 'comp-3',
            objectid: 'env-1',
            componenttype: 380,
          },
        ],
        connectionreferences: [
          {
            connectionreferenceid: 'ref-1',
            connectionreferencelogicalname: 'shared_office365',
            connectorid: '/providers/microsoft.powerapps/apis/shared_office365',
            connectionid: '/connections/office365',
            _solutionid_value: 'sol-1',
          },
        ],
        environmentvariabledefinitions: [
          {
            environmentvariabledefinitionid: 'env-1',
            schemaname: 'pp_ApiUrl',
            defaultvalue: 'https://api.example.test',
            _solutionid_value: 'sol-1',
          },
        ],
        environmentvariablevalues: [
          {
            environmentvariablevalueid: 'env-value-1',
            value: 'https://api.example.test',
            _environmentvariabledefinitionid_value: 'env-1',
            statecode: 0,
          },
        ],
      },
    });

    mockDataverseResolution({
      fixture: client,
    });

    const deploy = await runCli([
      'flow',
      'deploy',
      resolveRepoPath('fixtures', 'flow', 'raw', 'invoice-flow.raw.json'),
      '--env',
      'fixture',
      '--solution',
      'Core',
      '--format',
      'json',
    ]);
    expect(deploy.code).toBe(0);
    expect(JSON.parse(deploy.stderr)).toMatchObject({
      success: true,
      diagnostics: [
        expect.objectContaining({
          code: 'DATAVERSE_CONNREF_LIST_SUMMARY',
        }),
      ],
    });
    expect(JSON.parse(deploy.stdout)).toMatchObject({
      targetIdentifier: 'crd_InvoiceFlow',
      operation: 'updated',
      target: {
        id: 'flow-1',
        uniqueName: 'crd_InvoiceFlow',
        solutionUniqueName: 'Core',
      },
      updatedFields: expect.arrayContaining(['clientdata', 'name', 'description', 'category', 'statecode', 'statuscode']),
    });

    const workflows = await client.queryAll<Record<string, unknown>>({
      table: 'workflows',
    });
    expect(workflows.success).toBe(true);
    expect(workflows.data?.[0]?.clientdata).toContain('"definition"');
  });

  it('creates a missing remote flow through the CLI when create-if-missing is enabled', async () => {
    const client = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'sol-1',
            uniquename: 'Core',
          },
        ],
      },
      queryAll: {
        workflows: [],
        solutioncomponents: [
          {
            solutioncomponentid: 'comp-2',
            objectid: 'ref-1',
            componenttype: 371,
          },
          {
            solutioncomponentid: 'comp-3',
            objectid: 'env-1',
            componenttype: 380,
          },
        ],
        connectionreferences: [
          {
            connectionreferenceid: 'ref-1',
            connectionreferencelogicalname: 'shared_office365',
            connectorid: '/providers/microsoft.powerapps/apis/shared_office365',
            connectionid: '/connections/office365',
            _solutionid_value: 'sol-1',
          },
        ],
        environmentvariabledefinitions: [
          {
            environmentvariabledefinitionid: 'env-1',
            schemaname: 'pp_ApiUrl',
            defaultvalue: 'https://api.example.test',
            _solutionid_value: 'sol-1',
          },
        ],
        environmentvariablevalues: [
          {
            environmentvariablevalueid: 'env-value-1',
            value: 'https://api.example.test',
            _environmentvariabledefinitionid_value: 'env-1',
            statecode: 0,
          },
        ],
      },
    });

    mockDataverseResolution({
      fixture: client,
    });

    const deploy = await runCli([
      'flow',
      'deploy',
      resolveRepoPath('fixtures', 'flow', 'raw', 'invoice-flow.raw.json'),
      '--env',
      'fixture',
      '--solution',
      'Core',
      '--create-if-missing',
      '--format',
      'json',
    ]);

    expect(deploy.code).toBe(0);
    expect(deploy.stderr).toBe('');
    expect(JSON.parse(deploy.stdout)).toMatchObject({
      targetIdentifier: 'crd_InvoiceFlow',
      operation: 'created',
      target: {
        uniqueName: 'crd_InvoiceFlow',
        solutionUniqueName: 'Core',
      },
    });

    const workflows = await client.queryAll<Record<string, unknown>>({
      table: 'workflows',
    });
    expect(workflows.success).toBe(true);
    expect(workflows.data).toHaveLength(1);
    expect(workflows.data?.[0]).toMatchObject({
      category: 5,
      name: 'Invoice Flow',
      uniquename: 'crd_InvoiceFlow',
      statecode: 1,
      statuscode: 2,
    });
    expect(String(workflows.data?.[0]?.clientdata)).toContain('"definition"');
  });

  it('overrides the workflow state during flow deploy through the CLI entrypoint', async () => {
    const client = createFixtureDataverseClient({
      queryAll: {
        workflows: [
          {
            workflowid: 'flow-state-cli-1',
            name: 'Invoice Flow',
            uniquename: 'crd_InvoiceFlow',
            category: 5,
            statecode: 1,
            statuscode: 2,
          },
        ],
      },
    });

    mockDataverseResolution({
      fixture: client,
    });

    const deploy = await runCli([
      'flow',
      'deploy',
      resolveRepoPath('fixtures', 'flow', 'raw', 'invoice-flow.raw.json'),
      '--env',
      'fixture',
      '--workflow-state',
      'suspended',
      '--format',
      'json',
    ]);

    expect(deploy.code).toBe(0);
    expect(deploy.stderr).toBe('');
    expect(JSON.parse(deploy.stdout)).toMatchObject({
      operation: 'updated',
      target: {
        id: 'flow-state-cli-1',
        uniqueName: 'crd_InvoiceFlow',
        workflowState: 'suspended',
        stateCode: 2,
        statusCode: 3,
      },
    });

    const workflows = await client.queryAll<Record<string, unknown>>({
      table: 'workflows',
    });
    expect(workflows.success).toBe(true);
    expect(workflows.data?.[0]).toMatchObject({
      statecode: 2,
      statuscode: 3,
    });
  });

  it('promotes a remote flow between environments through the CLI entrypoint', async () => {
    const sourceClient = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'sol-source',
            uniquename: 'CoreSource',
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
            clientdata: JSON.stringify({
              definition: {
                parameters: {
                  '$connections': {
                    value: {
                      shared_office365: {
                        connectionId: '/connections/office365',
                        connectionReferenceLogicalName: 'shared_office365',
                      },
                    },
                  },
                  ApiBaseUrl: {
                    defaultValue: 'https://example.test',
                  },
                },
                actions: {
                  SendMail: {
                    inputs: {
                      subject: "@{parameters('ApiBaseUrl')}",
                      body: "@{environmentVariables('pp_ApiUrl')}",
                    },
                  },
                },
              },
            }),
          },
        ],
        solutioncomponents: [
          {
            solutioncomponentid: 'comp-source-1',
            objectid: 'flow-1',
            componenttype: 29,
          },
        ],
      },
    });
    const targetClient = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'sol-target',
            uniquename: 'CoreTarget',
          },
        ],
      },
      queryAll: {
        workflows: [
          {
            workflowid: 'target-flow-1',
            name: 'Invoice Sync',
            uniquename: 'crd_InvoiceSync',
            category: 5,
            statecode: 1,
            statuscode: 2,
          },
        ],
        solutioncomponents: [
          {
            solutioncomponentid: 'comp-target-1',
            objectid: 'target-flow-1',
            componenttype: 29,
          },
          {
            solutioncomponentid: 'comp-target-2',
            objectid: 'ref-target-1',
            componenttype: 371,
          },
          {
            solutioncomponentid: 'comp-target-3',
            objectid: 'env-target-1',
            componenttype: 380,
          },
        ],
        connectionreferences: [
          {
            connectionreferenceid: 'ref-target-1',
            connectionreferencelogicalname: 'shared_office365',
            connectorid: '/providers/microsoft.powerapps/apis/shared_office365',
            connectionid: '/connections/office365',
            _solutionid_value: 'sol-target',
          },
        ],
        environmentvariabledefinitions: [
          {
            environmentvariabledefinitionid: 'env-target-1',
            schemaname: 'pp_ApiUrl',
            defaultvalue: 'https://api.example.test',
            _solutionid_value: 'sol-target',
          },
        ],
        environmentvariablevalues: [
          {
            environmentvariablevalueid: 'env-target-value-1',
            value: 'https://api.example.test',
            _environmentvariabledefinitionid_value: 'env-target-1',
            statecode: 0,
          },
        ],
      },
    });

    mockDataverseResolution({
      source: sourceClient,
      target: targetClient,
    });

    const promote = await runCli([
      'flow',
      'promote',
      'Invoice Sync',
      '--source-environment',
      'source',
      '--source-solution',
      'CoreSource',
      '--target-environment',
      'target',
      '--target-solution',
      'CoreTarget',
      '--format',
      'json',
    ]);
    expect(promote.code).toBe(0);
    expect(promote.stderr).toBe('');
    expect(JSON.parse(promote.stdout)).toMatchObject({
      identifier: 'Invoice Sync',
      source: {
        id: 'flow-1',
        uniqueName: 'crd_InvoiceSync',
        workflowState: 'activated',
        solutionUniqueName: 'CoreSource',
      },
      targetIdentifier: 'crd_InvoiceSync',
      operation: 'updated',
      target: {
        id: 'target-flow-1',
        uniqueName: 'crd_InvoiceSync',
        workflowState: 'activated',
        solutionUniqueName: 'CoreTarget',
      },
    });

    const workflows = await targetClient.queryAll<Record<string, unknown>>({
      table: 'workflows',
    });
    expect(workflows.success).toBe(true);
    expect(String(workflows.data?.[0]?.clientdata)).toContain('"definition"');
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
          statecode: 1,
          statuscode: 2,
        },
      },
    ]);
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
              logicalName: 'crd_HarnessFlow',
              workflowState: 'draft',
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
              logicalName: 'crd_HarnessFlow',
              workflowState: 'draft',
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
              logicalName: 'crd_HarnessFlow',
              workflowState: 'draft',
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
          code: 'SOLUTION_PUBLISH_EXPORT_TIMEOUT',
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
        blockers: [
          expect.objectContaining({
            logicalName: 'crd_HarnessFlow',
            workflowState: 'draft',
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
    expect(publishPayload.warnings[0]).toMatchObject({
      code: 'SOLUTION_SYNC_STATUS_BLOCKED_WORKFLOW_STATE',
    });
  });

  it('rejects workflow-state overrides on solution-package flow promote through the CLI entrypoint', async () => {
    mockDataverseResolution({
      source: {
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
            workflows: [
              {
                workflowid: 'flow-1',
                name: 'Invoice Sync',
                uniquename: 'crd_InvoiceSync',
                category: 5,
                statecode: 1,
                statuscode: 2,
                clientdata: JSON.stringify({
                  definition: {
                    actions: {},
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
          },
        }),
      },
      target: { client: createFixtureDataverseClient({}) },
    });

    const promote = await runCli([
      'flow',
      'promote',
      'Invoice Sync',
      '--source-environment',
      'source',
      '--source-solution',
      'Core',
      '--target-environment',
      'target',
      '--solution-package',
      '--workflow-state',
      'activated',
      '--format',
      'json',
    ]);

    expect(promote.code).toBe(1);
    expect(JSON.parse(promote.stdout)).toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: 'FLOW_PROMOTE_PACKAGE_WORKFLOW_STATE_UNSUPPORTED',
        }),
      ],
    });
    expect(promote.stderr).toBe('');
  });

  it('covers invalid flow validation diagnostics through the CLI entrypoint', async () => {
    const artifactPath = resolveRepoPath('fixtures', 'flow', 'artifacts', 'diagnostic-flow');
    const validate = await runCli(['flow', 'validate', artifactPath, '--format', 'json']);

    expect(validate.code).toBe(1);
    expect(validate.stderr).toBe('');

    await expectGoldenJson(JSON.parse(validate.stdout), 'fixtures/flow/golden/semantic/cli-validation-report.json', {
      normalize: (value) => normalizeCliSnapshot(value),
    });
  });

  it('covers semantic flow validation diagnostics through the CLI entrypoint', async () => {
    const artifactPath = resolveRepoPath('fixtures', 'flow', 'artifacts', 'semantic-diagnostic-flow');
    const validate = await runCli(['flow', 'validate', artifactPath, '--format', 'json']);

    expect(validate.code).toBe(1);
    expect(validate.stderr).toBe('');

    await expectGoldenJson(JSON.parse(validate.stdout), 'fixtures/flow/golden/semantic/cli-lint-report.json', {
      normalize: (value) => normalizeCliSnapshot(value),
    });
  });

  it('covers Office 365 semantic flow validation diagnostics through the CLI entrypoint', async () => {
    const artifactPath = resolveRepoPath('fixtures', 'flow', 'artifacts', 'office365-semantic-diagnostic-flow');
    const validate = await runCli(['flow', 'validate', artifactPath, '--format', 'json']);

    expect(validate.code).toBe(1);
    expect(validate.stderr).toBe('');

    await expectGoldenJson(JSON.parse(validate.stdout), 'fixtures/flow/golden/semantic/office365-validation-report.json', {
      normalize: (value) => normalizeCliSnapshot(value),
    });
  });

  it('covers remote flow runtime diagnostics through the CLI entrypoint', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T12:00:00.000Z'));

    const runtimeFixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'flow', 'runtime', 'invoice-sync-runtime.json')
    )) as FlowRuntimeFixture;

    mockDataverseResolution({
      fixture: createFixtureDataverseClient(runtimeFixture),
    });

    const list = await runCli(['flow', 'list', '--env', 'fixture', '--solution', 'Core', '--format', 'json']);
    const inspect = await runCli(['flow', 'inspect', 'Invoice Sync', '--env', 'fixture', '--solution', 'Core', '--format', 'json']);
    const runs = await runCli(['flow', 'runs', 'Invoice Sync', '--env', 'fixture', '--solution', 'Core', '--since', '7d', '--format', 'json']);
    const errors = await runCli([
      'flow',
      'errors',
      'Invoice Sync',
      '--env',
      'fixture',
      '--solution',
      'Core',
      '--since',
      '7d',
      '--group-by',
      'connectionReference',
      '--format',
      'json',
    ]);
    const connrefs = await runCli(['flow', 'connrefs', 'Invoice Sync', '--env', 'fixture', '--solution', 'Core', '--since', '7d', '--format', 'json']);
    const doctor = await runCli(['flow', 'doctor', 'Invoice Sync', '--env', 'fixture', '--solution', 'Core', '--since', '7d', '--format', 'json']);
    const monitor = await runCli(['flow', 'monitor', 'Invoice Sync', '--env', 'fixture', '--solution', 'Core', '--since', '7d', '--format', 'json']);

    expect(list.code).toBe(0);
    expect(list.stderr).toBe('');
    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(runs.code).toBe(0);
    expect(runs.stderr).toBe('');
    expect(errors.code).toBe(0);
    expect(errors.stderr).toBe('');
    expect(connrefs.code).toBe(0);
    expect(connrefs.stderr).toBe('');
    expect(doctor.code).toBe(0);
    expect(doctor.stderr).toBe('');
    expect(monitor.code).toBe(0);
    expect(monitor.stderr).toBe('');

    await expectGoldenJson(JSON.parse(list.stdout), 'fixtures/flow/golden/runtime/list-report.json');
    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/flow/golden/runtime/inspect-report.json');
    await expectGoldenJson(JSON.parse(runs.stdout), 'fixtures/flow/golden/runtime/runs.json');
    await expectGoldenJson(JSON.parse(errors.stdout), 'fixtures/flow/golden/runtime/error-groups.json');
    await expectGoldenJson(JSON.parse(connrefs.stdout), 'fixtures/flow/golden/runtime/connection-health.json');
    await expectGoldenJson(JSON.parse(doctor.stdout), 'fixtures/flow/golden/runtime/doctor-report.json');
    expect(JSON.parse(monitor.stdout)).toMatchObject({
      health: {
        status: 'degraded',
        telemetryState: 'active',
      },
      recentRuns: {
        total: 2,
        failed: 1,
      },
      observationWindow: '7d',
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
    const pacPath = join(tempDir, 'fake-pac.js');
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
    await writeFile(
      pacPath,
      [
        '#!/usr/bin/env node',
        "const { mkdirSync, writeFileSync } = require('node:fs');",
        'const args = process.argv.slice(2);',
        "if (args[1] === 'unpack') {",
        "  const folder = args[args.indexOf('--folder') + 1];",
        "  mkdirSync(folder, { recursive: true });",
        "  writeFileSync(`${folder}/Other.xml`, '<ImportExportXml><SolutionManifest><UniqueName>Core</UniqueName><Version>9.9.9.9</Version></SolutionManifest></ImportExportXml>');",
        "  writeFileSync(`${folder}/customizations.xml`, '<Artifact />');",
        '}',
      ].join('\n'),
      'utf8'
    );
    await chmod(pacPath, 0o755);

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

    await expectGoldenJson(JSON.parse(list.stdout), 'fixtures/solution/golden/list-report.json');
    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/solution/golden/inspect-report.json');
    await expectGoldenJson(JSON.parse(components.stdout), 'fixtures/solution/golden/components-report.json');
    await expectGoldenJson(JSON.parse(dependencies.stdout), 'fixtures/solution/golden/dependencies-report.json');
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

    const whoami = await runCli(['dv', 'whoami', '--format', 'json'], { cwd: tempDir });

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
    expect(JSON.parse(batch.stdout)).toEqual([
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
    ]);
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
    await expectGoldenJson(JSON.parse(list.stdout), 'fixtures/solution/golden/list-report.json');
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
    expect(JSON.parse(list.stdout)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uniquename: 'Core',
        }),
      ])
    );
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
    await expectGoldenJson(JSON.parse(list.stdout), 'fixtures/solution/golden/list-report.json');
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
        'Treat crd_HarnessFlow as a blocked draft Modern Flow until a supported activation path is available; current `pp flow activate` in-place remediation can still fail with `FLOW_ACTIVATE_DEFINITION_REQUIRED` for this Dataverse workflow path.',
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
            status: name === 'ExportSolution' ? 200 : 204,
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
    const publishResult = await runCli([
      'solution',
      'publish',
      'Core',
      '--env',
      'source',
      '--wait-for-export',
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
    expect(requests.map((request) => request.path)).toEqual(['PublishAllXml', 'ExportSolution']);
    expect(JSON.parse(publishResult.stdout)).toMatchObject({
      published: true,
      waitForExport: true,
      synchronization: {
        kind: 'solution-export',
        confirmed: true,
        attempts: 1,
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
    expect(requests.map((request) => request.path)).toEqual(['PublishAllXml', 'ExportSolution']);
    expect(JSON.parse(publishResult.stdout)).toMatchObject({
      published: true,
      waitForExport: false,
      synchronization: {
        kind: 'solution-export',
        confirmed: false,
      },
      exportCheck: {
        attempted: true,
        confirmed: false,
        packageType: 'unmanaged',
        failure: {
          diagnostics: [
            {
              code: 'HTTP_REQUEST_FAILED',
              message: 'POST ExportSolution returned 405',
            },
          ],
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
        },
      ],
      readBack: {
        summary: {
          componentCount: 3,
          canvasAppCount: 1,
          workflowCount: 1,
          modelDrivenAppCount: 1,
        },
        workflows: [
          {
            id: 'flow-1',
            workflowState: 'draft',
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
    const pacPath = join(tempDir, 'fake-pac.js');
    const packedPath = join(tempDir, 'Harness.zip');
    const unpackDir = join(tempDir, 'unpacked');

    await writeFile(
      pacPath,
      [
        '#!/usr/bin/env node',
        "const { mkdirSync, writeFileSync } = require('node:fs');",
        'const args = process.argv.slice(2);',
        "const zipfile = args[args.indexOf('--zipfile') + 1];",
        "const folder = args[args.indexOf('--folder') + 1];",
        "if (args[1] === 'pack') writeFileSync(zipfile, 'cli-packed');",
        "if (args[1] === 'unpack') { mkdirSync(folder, { recursive: true }); writeFileSync(`${folder}/Other.xml`, '<ImportExportXml />'); }",
      ].join('\n'),
      'utf8'
    );
    await chmod(pacPath, 0o755);

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

  it('unpacks solution canvas apps into editable source trees when requested', async () => {
    const tempDir = await createTempDir();
    const pacPath = join(tempDir, 'fake-pac.js');
    const packedPath = join(tempDir, 'Harness.zip');
    const unpackDir = join(tempDir, 'unpacked');
    const msappSourceDir = join(tempDir, 'msapp-source');
    const msappPath = join(tempDir, 'Harness Canvas.msapp');

    await mkdir(msappSourceDir, { recursive: true });
    await writeFile(join(msappSourceDir, 'Header.json'), '{"schemaVersion":1}', 'utf8');
    await writeFile(join(msappSourceDir, 'Src\\App.pa.yaml'), 'App:\n', 'utf8');
    await writeFile(join(msappSourceDir, 'Controls\\1.json'), '{"Name":"App"}', 'utf8');
    await createZipPackage(msappSourceDir, msappPath);

    await writeFile(
      pacPath,
      [
        '#!/usr/bin/env node',
        "const { mkdirSync, writeFileSync, copyFileSync } = require('node:fs');",
        'const args = process.argv.slice(2);',
        "const zipfile = args[args.indexOf('--zipfile') + 1];",
        "const folder = args[args.indexOf('--folder') + 1];",
        `const msappPath = ${JSON.stringify(msappPath)};`,
        "if (args[1] === 'pack') writeFileSync(zipfile, 'cli-packed');",
        "if (args[1] === 'unpack') { mkdirSync(`${folder}/CanvasApps`, { recursive: true }); writeFileSync(`${folder}/Other.xml`, '<ImportExportXml />'); copyFileSync(msappPath, `${folder}/CanvasApps/crd_HarnessCanvas.msapp`); }",
      ].join('\n'),
      'utf8'
    );
    await chmod(pacPath, 0o755);
    await writeFile(packedPath, 'placeholder-solution-zip', 'utf8');

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
    expect(JSON.parse(inspect.stdout)).toEqual({
      name: 'fixture-user',
      type: 'user',
      tenantId: 'common',
      clientId: '51f81489-12ee-4a9e-aaae-a2591f45987d',
      tokenCacheKey: 'fixture-user',
      loginHint: 'fixture.user@example.com',
      accountUsername: undefined,
      homeAccountId: undefined,
      localAccountId: undefined,
      browserProfile: 'fixture-browser',
      prompt: 'select_account',
      fallbackToDeviceCode: true,
      resolvedFromEnvironment: 'fixture',
      resolvedEnvironmentUrl: 'https://fixture.crm.dynamics.com',
      targetResource: 'https://fixture.crm.dynamics.com',
      profileDefaultResource: 'https://fixture.crm.dynamics.com',
      defaultResourceMatchesResolvedEnvironment: true,
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
      expect(JSON.parse(inspect.stdout)).toEqual({
        name: 'fixture-user',
        type: 'user',
        tenantId: 'common',
        clientId: '51f81489-12ee-4a9e-aaae-a2591f45987d',
        tokenCacheKey: 'fixture-user',
        loginHint: 'fixture.user@example.com',
        accountUsername: undefined,
        homeAccountId: undefined,
        localAccountId: undefined,
        browserProfile: undefined,
        prompt: 'select_account',
        fallbackToDeviceCode: true,
        resolvedFromEnvironment: 'fixture',
        resolvedEnvironmentUrl: 'https://fixture.crm.dynamics.com',
        targetResource: 'https://fixture.crm.dynamics.com',
        profileDefaultResource: 'https://fixture.crm.dynamics.com',
        defaultResourceMatchesResolvedEnvironment: true,
      });
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('defaults project discovery to INIT_CWD when running from the package directory', async () => {
    const originalCwd = process.cwd();
    process.chdir(resolveRepoPath('packages/cli'));

    try {
      const inspect = await runCli(['project', 'inspect', '--format', 'json'], {
        env: {
          INIT_CWD: repoRoot,
        },
      });
      const doctor = await runCli(['project', 'doctor', '--format', 'json'], {
        env: {
          INIT_CWD: repoRoot,
        },
      });

      expect(inspect.code).toBe(0);
      expect(doctor.code).toBe(0);
      expect(inspect.stderr).toBe('');
      expect(doctor.stderr).toBe('');
      expect(JSON.parse(doctor.stdout)).toMatchObject({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'PROJECT_PARAMETER_MISSING',
          }),
        ]),
        canonicalProjectRoot: resolveRepoPath('fixtures', 'analysis', 'project'),
      });
      expect(JSON.parse(inspect.stdout)).toMatchObject({
        summary: {
          root: resolveRepoPath('fixtures', 'analysis', 'project'),
        },
        discovery: {
          inspectedPath: repoRoot,
          resolvedRoot: resolveRepoPath('fixtures', 'analysis', 'project'),
          autoSelectedProjectRoot: 'fixtures/analysis/project',
        },
      });
      expect(JSON.parse(doctor.stdout)).toMatchObject({
        inspectedPath: repoRoot,
        canonicalProjectRoot: resolveRepoPath('fixtures', 'analysis', 'project'),
        discovery: {
          inspectedPath: repoRoot,
          resolvedRoot: resolveRepoPath('fixtures', 'analysis', 'project'),
          autoSelectedProjectRoot: 'fixtures/analysis/project',
        },
      });
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('resolves analysis context --project relative paths from INIT_CWD when running from the package directory', async () => {
    const originalCwd = process.cwd();
    process.chdir(resolveRepoPath('packages/cli'));

    try {
      const context = await runCli(['analysis', 'context', '--project', '.', '--format', 'json'], {
        env: {
          INIT_CWD: repoRoot,
        },
      });

      expect(context.code).toBe(0);
      expect(context.stderr).toBe('');
      expect(JSON.parse(context.stdout)).toMatchObject({
        discovery: {
          inspectedPath: repoRoot,
          resolvedProjectRoot: repoRoot,
        },
      });
      expect(context.stdout).not.toContain('/packages/cli');
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
    expect(JSON.parse(inspect.stdout)).toEqual({
      name: 'fixture-user',
      type: 'user',
      tenantId: 'common',
      clientId: '51f81489-12ee-4a9e-aaae-a2591f45987d',
      tokenCacheKey: 'fixture-user',
      loginHint: 'fixture.user@example.com',
      accountUsername: undefined,
      homeAccountId: undefined,
      localAccountId: undefined,
      browserProfile: undefined,
      prompt: 'select_account',
      fallbackToDeviceCode: true,
      resolvedFromEnvironment: 'fixture',
      resolvedEnvironmentUrl: 'https://fixture.crm.dynamics.com',
      targetResource: 'https://fixture.crm.dynamics.com',
      profileDefaultResource: 'https://other.crm.dynamics.com',
      defaultResourceMatchesResolvedEnvironment: false,
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

  it('builds an environment cleanup plan for a run-scoped prefix', async () => {
    mockDataverseResolution({
      fixture: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'ppHarness20260310T073008100ZShell',
              friendlyname: 'ppHarness20260310T073008100Z Shell',
              version: '1.0.0.0',
            },
            {
              solutionid: 'sol-2',
              uniquename: 'ppHarness20260309T215614036ZShell',
              friendlyname: 'ppHarness20260309T215614036Z Shell',
              version: '1.0.0.0',
            },
            {
              solutionid: 'sol-3',
              uniquename: 'SharedCore',
              friendlyname: 'Shared Core',
              version: '5.0.0.0',
            },
          ],
        },
      }),
    });

    const plan = await runCli(['env', 'cleanup-plan', 'fixture', '--prefix', 'ppHarness20260310T073008100Z', '--format', 'json']);

    expect(plan.code).toBe(0);
    expect(plan.stderr).toBe('');
    expect(JSON.parse(plan.stdout)).toMatchObject({
      environment: {
        alias: 'fixture',
        url: 'https://fixture.example.crm.dynamics.com',
        authProfile: 'fixture-profile',
      },
      prefix: 'ppHarness20260310T073008100Z',
      remoteResetSupported: true,
      candidateCount: 1,
      cleanupCandidates: [
        {
          solutionid: 'sol-1',
          uniquename: 'ppHarness20260310T073008100ZShell',
        },
      ],
      suggestedNextActions: [
        'Review the matching solutions before deleting anything remotely.',
        'Run `pp env cleanup fixture --prefix ppHarness20260310T073008100Z` to delete the listed disposable solutions through pp.',
        'Re-run `pp env cleanup-plan fixture --prefix ppHarness20260310T073008100Z` to confirm the environment is clean before bootstrap.',
      ],
      knownLimitations: [],
    });
  });

  it('builds a bootstrap baseline report for a run-scoped prefix', async () => {
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
    const baseClient = createFixtureDataverseClient({
      query: {
        solutions: [
          {
            solutionid: 'sol-1',
            uniquename: 'ppHarness20260310T073008100ZShell',
            friendlyname: 'ppHarness20260310T073008100Z Shell',
            version: '1.0.0.0',
          },
          {
            solutionid: 'sol-2',
            uniquename: 'LegacyHarnessShell',
            friendlyname: 'Legacy Harness Shell',
            version: '5.0.0.0',
            ismanaged: false,
          },
        ],
      },
    });

    const client = {
      ...baseClient,
      query: async <T>(options: { table: string; filter?: string }) => {
        const result = await baseClient.query<T>(options);
        if (options.table !== 'solutions' || !result.success || !result.data) {
          return result;
        }

        const match = options.filter?.match(/uniquename eq '([^']+)'/);
        if (!match) {
          return result;
        }

        return ok(
          result.data.filter((record) => (record as { uniquename?: string }).uniquename === match[1]),
          {
            supportTier: 'preview',
            diagnostics: result.diagnostics,
            warnings: result.warnings,
          }
        );
      },
    } as unknown as DataverseClient;

    mockDataverseResolution({
      fixture: {
        client,
        environment: {
          url: 'https://fixture.crm.dynamics.com',
          authProfile: 'fixture-user',
        },
        authProfile: {
          name: 'fixture-user',
          type: 'user',
        },
      },
    });

    const baseline = await runCli([
      'env',
      'baseline',
      'fixture',
      '--prefix',
      'ppHarness20260310T073008100Z',
      '--expect-absent-solution',
      'LegacyHarnessShell',
      '--expect-absent-solution',
      'AlreadyGoneShell',
      '--config-dir',
      configDir,
      '--format',
      'json',
    ]);

    expect(baseline.code).toBe(0);
    expect(baseline.stderr).toBe('');
    expect(JSON.parse(baseline.stdout)).toMatchObject({
      environment: {
        alias: 'fixture',
        authProfile: 'fixture-user',
        auth: {
          status: 'configured',
        },
      },
      baseline: {
        prefix: 'ppHarness20260310T073008100Z',
        remoteResetSupported: true,
        readyForBootstrap: false,
        candidateCount: 1,
        cleanupCandidates: [
          {
            solutionid: 'sol-1',
            uniquename: 'ppHarness20260310T073008100ZShell',
          },
        ],
        absenceChecks: [
          {
            uniqueName: 'LegacyHarnessShell',
            status: 'present',
            solution: {
              solutionid: 'sol-2',
              uniquename: 'LegacyHarnessShell',
            },
          },
          {
            uniqueName: 'AlreadyGoneShell',
            status: 'absent',
          },
        ],
      },
    });
    const parsed = JSON.parse(baseline.stdout) as { baseline: { suggestedNextActions: string[] } };
    expect(parsed.baseline.suggestedNextActions).toContain(
      'Run `pp env cleanup fixture --prefix ppHarness20260310T073008100Z` to delete the listed disposable solutions through pp.'
    );
    expect(parsed.baseline.suggestedNextActions).toContain(
      'Delete LegacyHarnessShell with `pp solution delete LegacyHarnessShell --environment fixture` or clear it through the broader reset workflow before bootstrap.'
    );
  });

  it('prints help for env cleanup-plan', async () => {
    const help = await runCli(['env', 'cleanup-plan', '--help']);

    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('env cleanup-plan <alias> --prefix PREFIX [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]');
    expect(help.stdout).toContain('env reset <alias> --prefix PREFIX [--config-dir path] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]');
    expect(help.stdout).toContain('env cleanup <alias> --prefix PREFIX [--config-dir path] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]');
    expect(help.stdout).toContain('stale disposable harness assets');
  });

  it('prints help for env baseline', async () => {
    const help = await runCli(['env', 'baseline', '--help']);

    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('Usage: env baseline <alias> --prefix PREFIX');
    expect(help.stdout).toContain('readyForBootstrap');
    expect(help.stdout).toContain('--expect-absent-solution NAME');
  });

  it('prints help for env reset', async () => {
    const help = await runCli(['env', 'reset', '--help']);

    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('Usage: env reset <alias> --prefix PREFIX [--config-dir path] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]');
    expect(help.stdout).toContain('first-class bootstrap reset command');
    expect(help.stdout).toContain('Equivalent remote deletion behavior to `pp env cleanup`');
  });

  it('prints help for env cleanup', async () => {
    const help = await runCli(['env', 'cleanup', '--help']);

    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('env cleanup <alias> --prefix PREFIX [--config-dir path] [--dry-run|--plan] [--format table|json|yaml|ndjson|markdown|raw]');
    expect(help.stdout).toContain('Use `--dry-run` or `--plan` first to preview the matching solutions without mutating the environment.');
  });

  it('prints env group help with cleanup workflow examples', async () => {
    const help = await runCli(['env', '--help']);

    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('Usage: env <command> [options]');
    expect(help.stdout).toContain('cleanup-plan <alias>');
    expect(help.stdout).toContain('baseline <alias>');
    expect(help.stdout).toContain('reset <alias>');
    expect(help.stdout).toContain('cleanup <alias>');
    expect(help.stdout).toContain('pp env baseline test --prefix ppHarness20260310T013401820Z --format json');
    expect(help.stdout).toContain('pp env cleanup-plan test --prefix ppHarness20260310T013401820Z --format json');
  });

  it('prints help for solution compare', async () => {
    const help = await runCli(['solution', 'compare', '--help']);

    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('Usage: solution compare [uniqueName]');
    expect(help.stdout).toContain('--include-model-composition');
    expect(help.stdout).toContain('shell-only model-driven pass');
  });

  it('deletes matching disposable solutions through env cleanup', async () => {
    mockDataverseResolution({
      fixture: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'ppHarness20260310T073008100ZShell',
              friendlyname: 'ppHarness20260310T073008100Z Shell',
              version: '1.0.0.0',
            },
            {
              solutionid: 'sol-2',
              uniquename: 'SharedCore',
              friendlyname: 'Shared Core',
              version: '5.0.0.0',
            },
          ],
        },
      }),
    });

    const cleanup = await runCli(['env', 'cleanup', 'fixture', '--prefix', 'ppHarness20260310T073008100Z', '--format', 'json']);
    const remaining = await runCli(['env', 'cleanup-plan', 'fixture', '--prefix', 'ppHarness20260310T073008100Z', '--format', 'json']);

    expect(cleanup.code).toBe(0);
    expect(cleanup.stderr).toBe('');
    expect(JSON.parse(cleanup.stdout)).toMatchObject({
      prefix: 'ppHarness20260310T073008100Z',
      candidateCount: 1,
      deletedCount: 1,
      failedCount: 0,
      deleted: [
        {
          removed: true,
          solution: {
            solutionid: 'sol-1',
            uniquename: 'ppHarness20260310T073008100ZShell',
          },
        },
      ],
    });
    expect(JSON.parse(remaining.stdout)).toMatchObject({
      candidateCount: 0,
      cleanupCandidates: [],
    });
  });

  it('deletes matching disposable solutions through env reset', async () => {
    mockDataverseResolution({
      fixture: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'ppHarness20260310T073008100ZShell',
              friendlyname: 'ppHarness20260310T073008100Z Shell',
              version: '1.0.0.0',
            },
            {
              solutionid: 'sol-2',
              uniquename: 'SharedCore',
              friendlyname: 'Shared Core',
              version: '5.0.0.0',
            },
          ],
        },
      }),
    });

    const reset = await runCli(['env', 'reset', 'fixture', '--prefix', 'ppHarness20260310T073008100Z', '--format', 'json']);
    const remaining = await runCli(['env', 'cleanup-plan', 'fixture', '--prefix', 'ppHarness20260310T073008100Z', '--format', 'json']);

    expect(reset.code).toBe(0);
    expect(reset.stderr).toBe('');
    expect(JSON.parse(reset.stdout)).toMatchObject({
      prefix: 'ppHarness20260310T073008100Z',
      candidateCount: 1,
      deletedCount: 1,
      failedCount: 0,
      deleted: [
        {
          removed: true,
          solution: {
            solutionid: 'sol-1',
            uniquename: 'ppHarness20260310T073008100ZShell',
          },
        },
      ],
    });
    expect(JSON.parse(remaining.stdout)).toMatchObject({
      candidateCount: 0,
      cleanupCandidates: [],
    });
  });

  it('renders an env cleanup dry-run preview without mutating remote state', async () => {
    mockDataverseResolution({
      fixture: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'ppHarness20260310T073008100ZShell',
              friendlyname: 'ppHarness20260310T073008100Z Shell',
              version: '1.0.0.0',
            },
          ],
        },
      }),
    });

    const preview = await runCli(['env', 'cleanup', 'fixture', '--prefix', 'ppHarness20260310T073008100Z', '--dry-run', '--format', 'json']);
    const remaining = await runCli(['env', 'cleanup-plan', 'fixture', '--prefix', 'ppHarness20260310T073008100Z', '--format', 'json']);

    expect(preview.code).toBe(0);
    expect(preview.stderr).toBe('');
    expect(JSON.parse(preview.stdout)).toMatchObject({
      action: 'env.cleanup',
      mode: 'dry-run',
      confirmed: false,
      willMutate: false,
      target: {
        prefix: 'ppHarness20260310T073008100Z',
        candidateCount: 1,
      },
      input: {
        cleanupCandidates: [
          {
            solutionid: 'sol-1',
            uniquename: 'ppHarness20260310T073008100ZShell',
          },
        ],
      },
    });
    expect(JSON.parse(remaining.stdout)).toMatchObject({
      candidateCount: 1,
    });
  });

  it('renders an env reset dry-run preview without mutating remote state', async () => {
    mockDataverseResolution({
      fixture: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'ppHarness20260310T073008100ZShell',
              friendlyname: 'ppHarness20260310T073008100Z Shell',
              version: '1.0.0.0',
            },
          ],
        },
      }),
    });

    const preview = await runCli(['env', 'reset', 'fixture', '--prefix', 'ppHarness20260310T073008100Z', '--dry-run', '--format', 'json']);
    const remaining = await runCli(['env', 'cleanup-plan', 'fixture', '--prefix', 'ppHarness20260310T073008100Z', '--format', 'json']);

    expect(preview.code).toBe(0);
    expect(preview.stderr).toBe('');
    expect(JSON.parse(preview.stdout)).toMatchObject({
      action: 'env.reset',
      mode: 'dry-run',
      confirmed: false,
      willMutate: false,
      target: {
        prefix: 'ppHarness20260310T073008100Z',
        candidateCount: 1,
      },
      input: {
        cleanupCandidates: [
          {
            solutionid: 'sol-1',
            uniquename: 'ppHarness20260310T073008100ZShell',
          },
        ],
      },
    });
    expect(JSON.parse(remaining.stdout)).toMatchObject({
      candidateCount: 1,
    });
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
    expect(inspect.stderr).toContain('SOLUTION_NOT_FOUND');
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

  it('prints help for env resolve-maker-id', async () => {
    const help = await runCli(['env', 'resolve-maker-id', '--help']);

    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('env resolve-maker-id <alias> [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]');
  });

  it('surfaces bound auth and pac guidance in env inspect output', async () => {
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
          lastBootstrappedAt: '2026-03-11T10:00:00.000Z',
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
              lastBootstrappedAt: '2026-03-11T10:00:00.000Z',
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
    expect(help.stdout).toContain('`--plan` reads the adjacent `.pp-solution.json` release manifest plus the live target solution state');
    expect(help.stdout).toContain('--holding-solution                     Stage a managed holding import before the follow-up upgrade path');
    expect(help.stdout).not.toContain('SOLUTION_IMPORT_ARGS_REQUIRED');
  });

  it('prints help for analysis context --help without executing the command', async () => {
    const help = await runCli(['analysis', 'context', '--help']);

    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('Usage: analysis context [--project path] [--asset assetRef] [--stage STAGE] [--param NAME=VALUE] [options]');
    expect(help.stdout).toContain('Reports the inspected path, resolved project root, and any descendant auto-selection directly in the structured output.');
    expect(help.stdout).toContain('Relative `--project` paths resolve from the invocation root (`INIT_CWD` when wrapped by pnpm)');
    expect(help.stdout).not.toContain('"project"');
  });

  it('scopes analysis and deploy help with guidance instead of falling back to root help', async () => {
    const analysisHelp = await runCli(['analysis', '--help']);
    const analysisReportHelp = await runCli(['analysis', 'report', '--help']);
    const deployHelp = await runCli(['deploy', '--help']);
    const deployApplyHelp = await runCli(['deploy', 'apply', '--help']);
    const deployReleaseHelp = await runCli(['deploy', 'release', '--help']);

    expect(analysisHelp.code).toBe(0);
    expect(analysisHelp.stderr).toBe('');
    expect(analysisHelp.stdout).toContain('Usage: analysis <command> [options]');
    expect(analysisHelp.stdout).toContain('`context` is the most direct machine-readable entrypoint for an agent.');
    expect(analysisHelp.stdout).toContain('pp analysis context --project . --format json');
    expect(analysisHelp.stdout).not.toContain('pp auth profile add-user');

    expect(analysisReportHelp.code).toBe(0);
    expect(analysisReportHelp.stderr).toBe('');
    expect(analysisReportHelp.stdout).toContain('Usage: analysis report [path] [--stage STAGE] [--param NAME=VALUE] [options]');
    expect(analysisReportHelp.stdout).toContain('Defaults to markdown for human-readable output; use `--format json` for a structured context pack.');
    expect(analysisReportHelp.stdout).toContain('Choose `analysis context` instead when:');

    expect(deployHelp.code).toBe(0);
    expect(deployHelp.stderr).toBe('');
    expect(deployHelp.stdout).toContain('Usage: deploy <command> [options]');
    expect(deployHelp.stdout).toContain('`deploy plan` turns project topology into concrete operations.');
    expect(deployHelp.stdout).toContain('pp deploy apply --project . --stage dev --dry-run --format json');
    expect(deployHelp.stdout).not.toContain('pp auth profile add-user');

    expect(deployApplyHelp.code).toBe(0);
    expect(deployApplyHelp.stderr).toBe('');
    expect(deployApplyHelp.stdout).toContain(
      'Usage: deploy apply [--project path] [--stage STAGE] [--param NAME=VALUE] [--dry-run|--plan|--plan FILE] [--yes] [options]'
    );
    expect(deployApplyHelp.stdout).toContain('Use `--plan FILE` to apply a previously saved deploy plan without rediscovering the project.');

    expect(deployReleaseHelp.code).toBe(0);
    expect(deployReleaseHelp.stderr).toBe('');
    expect(deployReleaseHelp.stdout).toContain('deploy release plan --file MANIFEST.yml');
    expect(deployReleaseHelp.stdout).toContain('deploy release apply --file MANIFEST.yml');
    expect(deployReleaseHelp.stdout).toContain('Choose `deploy plan` / `deploy apply` instead when:');
    expect(deployReleaseHelp.stdout).toContain('Recommended flow:');
  });

  it('scopes flow help and keeps local-vs-remote guidance discoverable', async () => {
    const flowHelp = await runCli(['flow', '--help']);
    const flowInspectHelp = await runCli(['flow', 'inspect', '--help']);
    const flowActivateHelp = await runCli(['flow', 'activate', '--help']);
    const flowDeployHelp = await runCli(['flow', 'deploy', '--help']);
    const flowPromoteHelp = await runCli(['flow', 'promote', '--help']);

    expect(flowHelp.code).toBe(0);
    expect(flowHelp.stderr).toBe('');
    expect(flowHelp.stdout).toContain('Usage: flow <command> [options]');
    expect(flowHelp.stdout).toContain('Work with Power Automate flows in two modes:');
    expect(flowHelp.stdout).toContain('`deploy` updates one target environment from a local artifact; `promote` copies a remote flow between environments.');
    expect(flowHelp.stdout).not.toContain('pp auth profile add-user');

    expect(flowInspectHelp.code).toBe(0);
    expect(flowInspectHelp.stderr).toBe('');
    expect(flowInspectHelp.stdout).toContain('Without `--environment`, inspect a local flow artifact on disk.');
    expect(flowInspectHelp.stdout).toContain('With `--environment`, inspect a remote flow by name, id, or unique name.');

    expect(flowActivateHelp.code).toBe(0);
    expect(flowActivateHelp.stderr).toBe('');
    expect(flowActivateHelp.stdout).toContain('Usage: flow activate <name|id|uniqueName> --environment ALIAS [--solution UNIQUE_NAME] [options]');
    expect(flowActivateHelp.stdout).toContain('A remote flow already exists in one environment, but it is still draft or suspended');

    expect(flowDeployHelp.code).toBe(0);
    expect(flowDeployHelp.stderr).toBe('');
    expect(flowDeployHelp.stdout).toContain('Choose `flow promote` instead when:');
    expect(flowDeployHelp.stdout).toContain('Your source of truth is a local flow artifact on disk and you want to push it into one environment.');

    expect(flowPromoteHelp.code).toBe(0);
    expect(flowPromoteHelp.stderr).toBe('');
    expect(flowPromoteHelp.stdout).toContain('Choose `flow deploy` instead when:');
    expect(flowPromoteHelp.stdout).toContain('Recommended flow:');
  });

  it('adds decision guidance to solution and project help pages', async () => {
    const solutionListHelp = await runCli(['solution', 'list', '--help']);
    const solutionInspectHelp = await runCli(['solution', 'inspect', '--help']);
    const projectInitHelp = await runCli(['project', 'init', '--help']);
    const projectDoctorHelp = await runCli(['project', 'doctor', '--help']);
    const projectInspectHelp = await runCli(['project', 'inspect', '--help']);

    expect(solutionListHelp.stdout).toContain('Choose this when:');
    expect(solutionInspectHelp.stdout).toContain('metadata rather than the full inventory');

    expect(projectInitHelp.stdout).toContain('Choose `project inspect` or `project doctor` instead when:');
    expect(projectDoctorHelp.stdout).toContain('Choose `project inspect` instead when:');
    expect(projectInspectHelp.stdout).toContain('the resolved project model that an agent, analysis command, or deploy workflow will actually see');
  });

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
    expect(solutionComponentsHelp.stdout).toContain(
      'Usage: solution components <uniqueName> --environment ALIAS [options]'
    );
    expect(solutionComponentsHelp.stdout).toContain('pp solution components Core --environment dev --format json');
    expect(solutionComponentsHelp.stdout).toContain('--format table|json|yaml|ndjson|markdown|raw');
    expect(solutionComponentsHelp.stdout).not.toContain('SOLUTION_UNIQUE_NAME_REQUIRED');

    expect(solutionDependenciesHelp.code).toBe(0);
    expect(solutionDependenciesHelp.stderr).toBe('');
    expect(solutionDependenciesHelp.stdout).toContain(
      'Usage: solution dependencies <uniqueName> --environment ALIAS [options]'
    );
    expect(solutionDependenciesHelp.stdout).toContain('pp solution dependencies Core --environment dev --format json');
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
      'Successful `solution publish --format json` output includes a `readBack` summary for packaged canvas apps, flows, and model-driven apps'
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
    expect(solutionHelp.stdout).toContain('pp solution list --environment dev --format json');
    expect(solutionHelp.stdout).toContain('--format table|json|yaml|ndjson|markdown|raw');
    expect(solutionList.code).toBe(0);
    expect(solutionList.stderr).toBe('');
    expect(JSON.parse(solutionList.stdout)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uniquename: 'Core',
        }),
      ])
    );

    expect(authHelp.code).toBe(0);
    expect(authHelp.stderr).toBe('');
    expect(authHelp.stdout).toContain('Usage:');
    expect(authHelp.stdout).toContain('auth profile inspect <name> [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]');
    expect(authHelp.stdout).toContain('auth profile inspect --environment ALIAS [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]');
    expect(authInspect.code).toBe(0);
    expect(authInspect.stderr).toBe('');
    expect(JSON.parse(authInspect.stdout)).toMatchObject({
      name: 'fixture-user',
      type: 'user',
      defaultResource: 'https://fixture.crm.dynamics.com',
    });
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
    expect(JSON.parse(publishers.stdout)).toEqual([
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
    ]);
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

    await expectGoldenJson(JSON.parse(list.stdout), 'fixtures/model/golden/list-report.json');
    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/model/golden/inspect-report.json');
    await expectGoldenJson(JSON.parse(sitemap.stdout), 'fixtures/model/golden/sitemap-report.json');
    await expectGoldenJson(JSON.parse(forms.stdout), 'fixtures/model/golden/forms-report.json');
    await expectGoldenJson(JSON.parse(views.stdout), 'fixtures/model/golden/views-report.json');
    await expectGoldenJson(JSON.parse(dependencies.stdout), 'fixtures/model/golden/dependencies-report.json');
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
      items: [],
      summary: {
        artifactKind: 'sitemap',
        count: 0,
        componentCount: 0,
        missingComponentCount: 0,
      },
      coverage: {
        componentMembershipSource: 'appmodulecomponents',
        componentInspectionAvailable: false,
        omissionReason: {
          code: 'MODEL_COMPONENTS_UNAVAILABLE',
          message: 'Model-driven app component inspection was unavailable for Sales Hub; returning the app shell without composition rows.',
        },
      },
    });
    expect(JSON.parse(sitemap.stderr)).toMatchObject({
      success: true,
      warnings: [
        expect.objectContaining({
          code: 'MODEL_COMPONENTS_UNAVAILABLE',
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
});
