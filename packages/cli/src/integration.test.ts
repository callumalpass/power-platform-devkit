import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJsonFile } from '@pp/artifacts';
import { AuthService } from '@pp/auth';
import type { DataverseClient } from '@pp/dataverse';
import { ok } from '@pp/diagnostics';
import { type DataverseFixture, createFixtureDataverseClient, mockDataverseResolution } from '../../../test/dataverse-fixture';
import { expectGoldenJson, expectGoldenText, mapSnapshotStrings, repoRoot, resolveRepoPath } from '../../../test/golden';
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
  const originalEnv = new Map(Object.keys(options.env ?? {}).map((key) => [key, process.env[key]]));

  process.argv = ['node', 'pp', ...args];

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
  it('lists canvas remote mutation placeholders in root help', async () => {
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
    expect(stdout.join('')).toContain(
      'dv whoami --environment ALIAS [--no-interactive-auth] [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]'
    );
    expect(stdout.join('')).toContain(
      'solution list --environment ALIAS [--no-interactive-auth] [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]'
    );
    expect(stdout.join('')).toContain(
      'Remote Dataverse-backed commands accept [--no-interactive-auth] to fail fast with structured diagnostics instead of opening browser auth.'
    );
    expect(stdout.join('')).toContain('canvas create --environment ALIAS');
    expect(stdout.join('')).toContain('canvas import <file.msapp> --environment ALIAS [--solution UNIQUE_NAME] [--name DISPLAY_NAME]');
    expect(stdout.join('')).toContain('[preview: returns not-implemented diagnostics]');
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
    expect(stdout.join('')).toContain('Remote create/import commands are not implemented yet.');
    expect(stdout.join('')).toContain('Attempted remote create/import calls return machine-readable diagnostics with next steps.');
  });

  it('prints stable help for placeholder remote canvas mutations', async () => {
    const createHelp = await runCli(['canvas', 'create', '--help']);
    const importHelp = await runCli(['canvas', 'import', '--help']);

    expect(createHelp.code).toBe(0);
    expect(createHelp.stderr).toBe('');
    expect(createHelp.stdout).toContain('Usage: canvas create --environment ALIAS [--solution UNIQUE_NAME] [--name DISPLAY_NAME] [options]');
    expect(createHelp.stdout).toContain('Preview placeholder. Remote blank-app creation is not implemented yet.');
    expect(createHelp.stdout).toContain('--maker-env-id ID');
    expect(createHelp.stdout).toContain('--open');
    expect(createHelp.stdout).toContain('--browser-profile NAME');
    expect(createHelp.stdout).toContain('--dry-run');
    expect(createHelp.stdout).toContain('--plan');
    expect(createHelp.stdout).toContain('Finish blank-app creation in Maker when you need a new remote canvas app.');
    expect(createHelp.stdout).toContain('Use `--open --browser-profile <name>` to launch the resolved Maker handoff from pp.');

    expect(importHelp.code).toBe(0);
    expect(importHelp.stderr).toBe('');
    expect(importHelp.stdout).toContain('Usage: canvas import <file.msapp> --environment ALIAS [--solution UNIQUE_NAME] [--name DISPLAY_NAME] [options]');
    expect(importHelp.stdout).toContain('Preview placeholder. Remote canvas import is not implemented yet.');
    expect(importHelp.stdout).toContain('--name DISPLAY_NAME');
    expect(importHelp.stdout).toContain('--maker-env-id ID');
    expect(importHelp.stdout).toContain('--open');
    expect(importHelp.stdout).toContain('--browser-profile NAME');
    expect(importHelp.stdout).toContain('--dry-run');
    expect(importHelp.stdout).toContain('--plan');
    expect(importHelp.stdout).toContain('Use Maker or solution tooling for the remote import step until `pp canvas import` exists.');
    expect(importHelp.stdout).toContain('Use `--open --browser-profile <name>` to launch the resolved Maker handoff from pp.');
  });

  it('prints stable help for remote canvas discovery commands', async () => {
    const listHelp = await runCli(['canvas', 'list', '--help']);
    const inspectHelp = await runCli(['canvas', 'inspect', '--help']);

    expect(listHelp.code).toBe(0);
    expect(listHelp.stderr).toBe('');
    expect(listHelp.stdout).toContain('Usage: canvas list --environment ALIAS [--solution UNIQUE_NAME] [options]');
    expect(listHelp.stdout).toContain('Lists remote canvas apps through Dataverse.');
    expect(listHelp.stdout).toContain('pp canvas list --environment dev --solution Core');

    expect(inspectHelp.code).toBe(0);
    expect(inspectHelp.stderr).toBe('');
    expect(inspectHelp.stdout).toContain('Usage: canvas inspect <path|displayName|name|id> [--environment ALIAS] [--solution UNIQUE_NAME] [options]');
    expect(inspectHelp.stdout).toContain('With `--environment`, inspects a remote canvas app by display name, logical name, or id.');
    expect(inspectHelp.stdout).toContain('pp canvas inspect "Harness Canvas" --environment dev --solution Core');
  });

  it('prints stable help for project commands without mutating the target path', async () => {
    const tempDir = await createTempDir();
    const before = await readdir(tempDir);

    const projectHelp = await runCli(['project', '--help']);
    const initHelp = await runCli(['project', 'init', tempDir, '--help']);
    const doctorHelp = await runCli(['project', 'doctor', tempDir, '--help']);
    const inspectHelp = await runCli(['project', 'inspect', tempDir, '--help']);

    const after = await readdir(tempDir);

    expect(projectHelp.code).toBe(0);
    expect(projectHelp.stderr).toBe('');
    expect(projectHelp.stdout).toContain('Usage: project <command> [options]');
    expect(projectHelp.stdout).toContain('init [path]');
    expect(projectHelp.stdout).toContain('doctor [path]');
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

    expect(inspectHelp.code).toBe(0);
    expect(inspectHelp.stderr).toBe('');
    expect(inspectHelp.stdout).toContain('Usage: project inspect [path] [--stage STAGE] [--param NAME=VALUE] [options]');
    expect(inspectHelp.stdout).toContain('Reads project context without mutating the filesystem.');

    expect(after).toEqual(before);
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

    await expectGoldenJson(JSON.parse(projectInspect.stdout), 'fixtures/analysis/golden/project-inspect.json', {
      normalize: (value) => normalizeCliAnalysisSnapshot(value),
    });
    await expectGoldenText(report.stdout, 'fixtures/analysis/golden/report.md', {
      normalize: (value) => normalizeCliAnalysisSnapshot(value),
    });
    await expectGoldenJson(JSON.parse(context.stdout), 'fixtures/analysis/golden/context-pack.json', {
      normalize: (value) => normalizeCliAnalysisSnapshot(value),
    });
    await expectGoldenJson(JSON.parse(deployPlan.stdout), 'fixtures/analysis/golden/deploy-plan.json', {
      normalize: (value) => normalizeCliAnalysisSnapshot(value),
    });
    await expectGoldenJson(JSON.parse(deployApply.stdout), 'fixtures/analysis/golden/deploy-apply-dry-run.json', {
      normalize: (value) => normalizeCliAnalysisSnapshot(value),
    });
    await expectGoldenJson(JSON.parse(projectInspect.stderr), 'fixtures/cli/golden/protocol/project-discovery-diagnostics.json');
    await expectGoldenText(report.stderr, 'fixtures/cli/golden/protocol/project-discovery-diagnostics.raw.txt');
    await expectGoldenJson(JSON.parse(context.stderr), 'fixtures/cli/golden/protocol/project-discovery-diagnostics.json');
    await expectGoldenJson(JSON.parse(deployPlan.stderr), 'fixtures/cli/golden/protocol/project-discovery-diagnostics.json');
    await expectGoldenJson(JSON.parse(deployApply.stderr), 'fixtures/cli/golden/protocol/project-discovery-diagnostics.json');
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
      await readFile(resolveRepoPath('fixtures', 'flow', 'artifacts', 'diagnostic-flow', 'flow.json'), 'utf8'),
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

  it('auto-selects the descendant project root in project inspect and doctor JSON at repo root', async () => {
    const inspect = await runCli(['project', 'inspect', repoRoot, '--format', 'json']);
    const doctor = await runCli(['project', 'doctor', repoRoot, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(doctor.code).toBe(0);

    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/cli/golden/protocol/project-root-inspect.json', {
      normalize: (value) => normalizeCliSnapshot(value),
    });
    await expectGoldenJson(JSON.parse(doctor.stdout), 'fixtures/cli/golden/protocol/project-root-doctor.json', {
      normalize: (value) => normalizeCliSnapshot(value),
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
      fixture: createFixtureDataverseClient({
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
              appopenuri: 'https://make.powerapps.com/e/test/canvas/?app-id=canvas-1',
              appversion: '1.2.3.4',
              createdbyclientversion: '3.25000.1',
              lastpublishtime: '2026-03-10T04:50:00.000Z',
              status: 'Published',
              tags: 'harness;solution',
            },
          ],
        },
      }),
    });

    const list = await runCli(['canvas', 'list', '--env', 'fixture', '--solution', 'Core', '--format', 'json']);
    const inspect = await runCli(['canvas', 'inspect', 'Harness Canvas', '--env', 'fixture', '--solution', 'Core', '--format', 'json']);

    expect(list.code).toBe(0);
    expect(list.stderr).toBe('');
    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    await expectGoldenJson(JSON.parse(list.stdout), 'fixtures/cli/golden/protocol/canvas-remote-list.json');
    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/cli/golden/protocol/canvas-remote-inspect.json');
  });

  it('returns explicit diagnostics for unsupported remote canvas mutations', async () => {
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
      '--format',
      'json',
    ]);

    expect(create.code).toBe(1);
    expect(create.stdout).toBe('');
    await expectGoldenJson(JSON.parse(create.stderr), 'fixtures/cli/golden/protocol/canvas-remote-create-not-implemented.json');

    expect(importResult.code).toBe(1);
    expect(importResult.stdout).toBe('');
    await expectGoldenJson(JSON.parse(importResult.stderr), 'fixtures/cli/golden/protocol/canvas-remote-import-not-implemented.json');
  });

  it('lets placeholder canvas import guidance override the inferred display name', async () => {
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

    const importResult = await runCli([
      'canvas',
      'import',
      './dist/Harness App.msapp',
      '--env',
      'fixture',
      '--solution',
      'HarnessSolution',
      '--name',
      'Imported Harness Canvas',
      '--format',
      'json',
    ]);

    expect(importResult.code).toBe(1);
    await expectGoldenJson(JSON.parse(importResult.stderr), 'fixtures/cli/golden/protocol/canvas-remote-import-custom-name.json');
  });

  it('requires remote targeting inputs for placeholder canvas mutations', async () => {
    const missingEnv = await runCli(['canvas', 'create', '--format', 'json']);
    const missingImportPath = await runCli(['canvas', 'import', '--env', 'fixture', '--format', 'json']);

    expect(missingEnv.code).toBe(1);
    expect(JSON.parse(missingEnv.stderr)).toMatchObject({
      success: false,
      diagnostics: [
        {
          code: 'DV_ENV_REQUIRED',
          message: '--environment <alias> is required.',
        },
      ],
    });

    expect(missingImportPath.code).toBe(1);
    expect(JSON.parse(missingImportPath.stderr)).toMatchObject({
      success: false,
      diagnostics: [
        {
          code: 'CANVAS_IMPORT_PATH_REQUIRED',
          message: 'Usage: canvas import <file.msapp> --environment <alias> [--solution UNIQUE_NAME]',
        },
      ],
    });
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
    expect(JSON.parse(create.stderr)).toMatchObject({
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
        'Run `pp solution list --env fixture` to discover the available solution unique names in this environment.',
        'Retry with a valid `--solution` value, or configure fixture with `defaultSolution` if this workflow should stay solution-scoped by default.',
        'Once you have the right solution, use `pp solution inspect MissingSolution --env fixture` to confirm it resolves before retrying the canvas workflow.',
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
    expect(JSON.parse(create.stderr)).toMatchObject({
      success: false,
      suggestedNextActions: expect.arrayContaining([
        'Using default solution HarnessSolution from environment alias fixture, keep the Maker step and verification scoped to that solution.',
        'Open https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1 to start the solution-scoped blank canvas app flow in Maker.',
        'After saving in Maker, run `pp canvas inspect "Harness Canvas" --env fixture --solution HarnessSolution` to confirm the remote app id.',
        'After the Maker step, run `pp canvas list --env fixture --solution HarnessSolution` to confirm the new app is visible in Dataverse.',
        'Run `pp solution components HarnessSolution --env fixture --format json` to verify that the app was added to the solution.',
      ]),
    });

    expect(importResult.code).toBe(1);
    expect(JSON.parse(importResult.stderr)).toMatchObject({
      success: false,
      suggestedNextActions: expect.arrayContaining([
        'Using default solution HarnessSolution from environment alias fixture, keep the Maker step and verification scoped to that solution.',
        'Open https://make.powerapps.com/environments/env-123/solutions/solution-1/apps to continue the import from the solution-scoped apps view in Maker.',
        'After the import step, run `pp canvas inspect "Harness App" --env fixture --solution HarnessSolution` to confirm the remote app id.',
        'After the import step, run `pp canvas list --env fixture --solution HarnessSolution` to confirm the app is visible in Dataverse.',
        'Run `pp solution components HarnessSolution --env fixture --format json` to verify that the imported app was added to the solution.',
      ]),
    });
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
      '--config-dir',
      configDir,
      '--format',
      'json',
    ]);

    expect(create.code).toBe(1);
    expect(JSON.parse(create.stderr)).toMatchObject({
      success: false,
      suggestedNextActions: expect.arrayContaining([
        'Open https://make.powerapps.com/e/env-123/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1 to start the solution-scoped blank canvas app flow in Maker.',
      ]),
    });

    expect(importResult.code).toBe(1);
    expect(JSON.parse(importResult.stderr)).toMatchObject({
      success: false,
      suggestedNextActions: expect.arrayContaining([
        'Open https://make.powerapps.com/environments/env-123/solutions/solution-1/apps to continue the import from the solution-scoped apps view in Maker.',
      ]),
    });
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
    expect(JSON.parse(create.stderr)).toMatchObject({
      success: false,
      suggestedNextActions: expect.arrayContaining([
        'Open https://make.powerapps.com/e/env-override/canvas/?action=new-blank&form-factor=tablet&name=Harness+Canvas&solution-id=solution-1 to start the solution-scoped blank canvas app flow in Maker.',
      ]),
    });

    expect(importResult.code).toBe(1);
    expect(JSON.parse(importResult.stderr)).toMatchObject({
      success: false,
      suggestedNextActions: expect.arrayContaining([
        'Open https://make.powerapps.com/environments/env-override/solutions/solution-1/apps to continue the import from the solution-scoped apps view in Maker.',
      ]),
    });
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
        '--name',
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

  it('requires browser-profile launch context when opening a Maker handoff', async () => {
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
      '--format',
      'json',
    ]);

    expect(missingBrowserProfile.code).toBe(1);
    await expectGoldenJson(
      JSON.parse(missingBrowserProfile.stderr),
      'fixtures/cli/golden/protocol/canvas-remote-create-open-missing-browser-profile.json'
    );
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
    await expectGoldenJson(JSON.parse(create.stderr), 'fixtures/cli/golden/protocol/canvas-remote-create-open-unavailable.json');
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
    expect(build.stdout).toBe('');

    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/canvas/golden/semantic/cli-inspect-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(validate.stdout), 'fixtures/canvas/golden/semantic/cli-validation-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(build.stderr), 'fixtures/canvas/golden/semantic/cli-build-failure.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
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
    await expectGoldenText(flowValidateYaml.stderr, 'fixtures/cli/golden/protocol/flow-validate-diagnostics.yaml');
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
    expect(seededBuild.stdout).toBe('');

    expect(registryInspect.code).toBe(0);
    expect(registryValidate.code).toBe(1);
    expect(registryBuild.code).toBe(1);
    expect(registryBuild.stdout).toBe('');

    await expectGoldenJson(JSON.parse(seededInspect.stdout), 'fixtures/canvas/golden/modes/cli-seeded-inspect-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(seededValidate.stdout), 'fixtures/canvas/golden/modes/cli-seeded-validation-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(seededBuild.stderr), 'fixtures/canvas/golden/modes/cli-seeded-build-failure.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(seededInspect.stderr), 'fixtures/cli/golden/protocol/canvas-seeded-diagnostics.json');
    await expectGoldenJson(JSON.parse(seededValidate.stderr), 'fixtures/cli/golden/protocol/canvas-seeded-diagnostics.json');

    await expectGoldenJson(JSON.parse(registryInspect.stdout), 'fixtures/canvas/golden/modes/cli-registry-inspect-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(registryValidate.stdout), 'fixtures/canvas/golden/modes/cli-registry-validation-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(registryBuild.stderr), 'fixtures/canvas/golden/modes/cli-registry-build-failure.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(registryInspect.stderr), 'fixtures/cli/golden/protocol/canvas-registry-diagnostics.json');
    await expectGoldenJson(JSON.parse(registryValidate.stderr), 'fixtures/cli/golden/protocol/canvas-registry-diagnostics.json');
  });

  it('covers flow unpack, validate, patch, and normalize through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const rawPath = resolveRepoPath('fixtures', 'flow', 'raw', 'invoice-flow.raw.json');
    const patchPath = resolveRepoPath('fixtures', 'flow', 'patches', 'invoice-flow.patch.json');
    const unpackedPath = join(tempDir, 'unpacked');
    const patchedPath = join(tempDir, 'patched');
    const normalizedPath = join(tempDir, 'normalized');

    const inspect = await runCli(['flow', 'inspect', rawPath, '--format', 'json']);
    const unpack = await runCli(['flow', 'unpack', rawPath, '--out', unpackedPath, '--format', 'json']);
    const validate = await runCli(['flow', 'validate', unpackedPath, '--format', 'json']);
    const patch = await runCli(['flow', 'patch', unpackedPath, '--file', patchPath, '--out', patchedPath, '--format', 'json']);
    const normalize = await runCli(['flow', 'normalize', patchedPath, '--out', normalizedPath, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(unpack.code).toBe(0);
    expect(unpack.stderr).toBe('');
    expect(validate.code).toBe(0);
    expect(validate.stderr).toBe('');
    expect(patch.code).toBe(0);
    expect(patch.stderr).toBe('');
    expect(normalize.code).toBe(0);
    expect(normalize.stderr).toBe('');

    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/flow/golden/inspect-summary.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(unpack.stdout), 'fixtures/flow/golden/unpack-result.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(await readJsonFile(join(unpackedPath, 'flow.json')), 'fixtures/flow/golden/unpacked.flow.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(validate.stdout), 'fixtures/flow/golden/validation-report.json', {
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

  it('covers invalid flow validation diagnostics through the CLI entrypoint', async () => {
    const artifactPath = resolveRepoPath('fixtures', 'flow', 'artifacts', 'diagnostic-flow');
    const validate = await runCli(['flow', 'validate', artifactPath, '--format', 'json']);

    expect(validate.code).toBe(1);

    await expectGoldenJson(JSON.parse(validate.stdout), 'fixtures/flow/golden/semantic/cli-validation-report.json', {
      normalize: (value) => normalizeCliSnapshot(value),
    });
    await expectGoldenJson(JSON.parse(validate.stderr), 'fixtures/cli/golden/protocol/flow-validation-diagnostics.json');
  });

  it('covers semantic flow validation diagnostics through the CLI entrypoint', async () => {
    const artifactPath = resolveRepoPath('fixtures', 'flow', 'artifacts', 'semantic-diagnostic-flow');
    const validate = await runCli(['flow', 'validate', artifactPath, '--format', 'json']);

    expect(validate.code).toBe(1);

    await expectGoldenJson(JSON.parse(validate.stdout), 'fixtures/flow/golden/semantic/cli-lint-report.json', {
      normalize: (value) => normalizeCliSnapshot(value),
    });
    await expectGoldenJson(JSON.parse(validate.stderr), 'fixtures/cli/golden/protocol/flow-semantic-validation-diagnostics.json');
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

    await expectGoldenJson(JSON.parse(list.stdout), 'fixtures/flow/golden/runtime/list-report.json');
    await expectGoldenJson(JSON.parse(inspect.stdout), 'fixtures/flow/golden/runtime/inspect-report.json');
    await expectGoldenJson(JSON.parse(runs.stdout), 'fixtures/flow/golden/runtime/runs.json');
    await expectGoldenJson(JSON.parse(errors.stdout), 'fixtures/flow/golden/runtime/error-groups.json');
    await expectGoldenJson(JSON.parse(connrefs.stdout), 'fixtures/flow/golden/runtime/connection-health.json');
    await expectGoldenJson(JSON.parse(doctor.stdout), 'fixtures/flow/golden/runtime/doctor-report.json');
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
    const compare = await runCli(['solution', 'compare', 'Core', '--source-env', 'source', '--target-env', 'target', '--format', 'json']);

    expect(analyze.code).toBe(0);
    expect(analyze.stderr).toBe('');
    expect(compare.code).toBe(0);
    expect(compare.stderr).toBe('');

    await expectGoldenJson(JSON.parse(analyze.stdout), 'fixtures/solution/golden/analyze-report.json');
    await expectGoldenJson(JSON.parse(compare.stdout), 'fixtures/solution/golden/compare-report.json');
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
    expect(JSON.parse(whoami.stdout)).toEqual({
      environment: 'source',
      url: 'https://source.example.crm.dynamics.com',
      authProfile: 'source-user',
      BusinessUnitId: 'bu-1',
      OrganizationId: 'org-1',
      UserId: 'user-1',
    });
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
      requestJson: async <T>(options: { path: string; body?: Record<string, unknown> }) => {
        requests.push({ path: options.path, body: options.body });
        return ok(
          {
            ExportSolutionFile: Buffer.from('cli-export').toString('base64'),
          } as T,
          { supportTier: 'preview' }
        );
      },
      request: async (options: { path: string; body?: Record<string, unknown> }) => {
        requests.push({ path: options.path, body: options.body });
        return ok(
          {
            status: 204,
            headers: {},
            data: undefined,
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
      CustomizationFile: Buffer.from('cli-export').toString('base64'),
    });
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
      defaultResource: 'https://fixture.crm.dynamics.com',
      loginHint: 'fixture.user@example.com',
      accountUsername: undefined,
      homeAccountId: undefined,
      localAccountId: undefined,
      browserProfile: 'fixture-browser',
      prompt: 'select_account',
      fallbackToDeviceCode: true,
      resolvedFromEnvironment: 'fixture',
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
        defaultResource: 'https://fixture.crm.dynamics.com',
        loginHint: 'fixture.user@example.com',
        accountUsername: undefined,
        homeAccountId: undefined,
        localAccountId: undefined,
        browserProfile: undefined,
        prompt: 'select_account',
        fallbackToDeviceCode: true,
        resolvedFromEnvironment: 'fixture',
      });
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('fails auth profile inspect when --env points at a missing alias', async () => {
    const configDir = await createTempDir();
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.json'), JSON.stringify({ environments: {} }, null, 2), 'utf8');

    const inspect = await runCli(['auth', 'profile', 'inspect', '--env', 'missing', '--config-dir', configDir, '--format', 'json']);

    expect(inspect.code).toBe(1);
    expect(JSON.parse(inspect.stderr)).toMatchObject({
      success: false,
      diagnostics: [
        {
          code: 'ENV_NOT_FOUND',
          message: 'Environment alias missing was not found.',
          source: '@pp/cli',
        },
      ],
    });
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
      remoteResetSupported: false,
      candidateCount: 1,
      cleanupCandidates: [
        {
          solutionid: 'sol-1',
          uniquename: 'ppHarness20260310T073008100ZShell',
        },
      ],
      knownLimitations: [
        'pp can discover cleanup candidates for an environment alias, but it does not yet expose a first-class remote reset or solution deletion command.',
      ],
    });
  });

  it('prints help for env cleanup-plan', async () => {
    const help = await runCli(['env', 'cleanup-plan', '--help']);

    expect(help.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('env cleanup-plan <alias> --prefix PREFIX [--config-dir path] [--format table|json|yaml|ndjson|markdown|raw]');
  });

  it('prints help for auth profile inspect --help without running validation', async () => {
    const inspect = await runCli(['auth', 'profile', 'inspect', '--help']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(inspect.stdout).toContain('auth profile inspect <name> [--config-dir path]');
    expect(inspect.stdout).toContain('auth profile inspect --environment ALIAS [--config-dir path]');
    expect(inspect.stdout).not.toContain('AUTH_PROFILE_NAME_REQUIRED');
  });

  it('prints group and subcommand help for remote discovery commands with the shared output contract', async () => {
    const dvHelp = await runCli(['dv', '--help']);
    const whoAmIHelp = await runCli(['dv', 'whoami', '--help']);
    const solutionHelp = await runCli(['solution', '--help']);
    const solutionListHelp = await runCli(['solution', 'list', '--help']);
    const envvarHelp = await runCli(['envvar', '--help']);
    const envvarInspectHelp = await runCli(['envvar', 'inspect', '--help']);

    expect(dvHelp.code).toBe(0);
    expect(dvHelp.stderr).toBe('');
    expect(dvHelp.stdout).toContain('Usage: dv <command> [options]');
    expect(dvHelp.stdout).toContain('whoami');
    expect(dvHelp.stdout).toContain('--format table|json|yaml|ndjson|markdown|raw');

    expect(whoAmIHelp.code).toBe(0);
    expect(whoAmIHelp.stderr).toBe('');
    expect(whoAmIHelp.stdout).toContain('Usage: dv whoami --environment ALIAS [options]');
    expect(whoAmIHelp.stdout).toContain('pp dv whoami --environment dev --format json');
    expect(whoAmIHelp.stdout).not.toContain('DV_ENV_REQUIRED');

    expect(solutionHelp.code).toBe(0);
    expect(solutionHelp.stderr).toBe('');
    expect(solutionHelp.stdout).toContain('Usage: solution <command> [options]');
    expect(solutionHelp.stdout).toContain('list');
    expect(solutionHelp.stdout).toContain('--format table|json|yaml|ndjson|markdown|raw');

    expect(solutionListHelp.code).toBe(0);
    expect(solutionListHelp.stderr).toBe('');
    expect(solutionListHelp.stdout).toContain('Usage: solution list --environment ALIAS [options]');
    expect(solutionListHelp.stdout).toContain('pp solution list --environment dev --format json');
    expect(solutionListHelp.stdout).not.toContain('DV_ENV_REQUIRED');

    expect(envvarHelp.code).toBe(0);
    expect(envvarHelp.stderr).toBe('');
    expect(envvarHelp.stdout).toContain('Usage: envvar <command> [options]');
    expect(envvarHelp.stdout).toContain('inspect <identifier>');
    expect(envvarHelp.stdout).toContain('--format table|json|yaml|ndjson|markdown|raw');

    expect(envvarInspectHelp.code).toBe(0);
    expect(envvarInspectHelp.stderr).toBe('');
    expect(envvarInspectHelp.stdout).toContain(
      'Usage: envvar inspect <schemaName|displayName|id> --environment ALIAS [--solution UNIQUE_NAME] [options]'
    );
    expect(envvarInspectHelp.stdout).toContain('stable ENVVAR_NOT_FOUND diagnostic');
    expect(envvarInspectHelp.stdout).not.toContain('ENVVAR_IDENTIFIER_REQUIRED');
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
    expect(inspect.stdout).toBe('');
    expect(JSON.parse(inspect.stderr)).toMatchObject({
      success: false,
      diagnostics: [
        {
          code: 'ENVVAR_NOT_FOUND',
          message: 'Environment variable definitely_missing was not found.',
        },
      ],
      supportTier: 'preview',
    });
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

  it('covers solution metadata updates through the CLI entrypoint', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'HarnessShell',
              friendlyname: 'Harness Shell',
              version: '1.0.0.0',
            },
          ],
          publishers: [
            {
              publisherid: 'pub-1',
              uniquename: 'HarnessPublisher',
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
            },
          ],
        },
      }),
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
        },
      }),
    });

    const validate = await runCli(['connref', 'validate', '--env', 'source', '--solution', 'HarnessShell', '--format', 'json']);

    expect(validate.code).toBe(0);
    expect(validate.stderr).toBe('');
    expect(JSON.parse(validate.stdout)).toEqual([
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
    ]);
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
});
