import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJsonFile } from '@pp/artifacts';
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
          solutioncomponents: [],
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
          solutioncomponents: [],
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
    expect(lint.stdout).toBe(validate.stdout);
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
