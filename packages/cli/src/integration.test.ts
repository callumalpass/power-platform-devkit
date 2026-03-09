import { access, mkdtemp, rm } from 'node:fs/promises';
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
  return mapSnapshotStrings(normalizeCliSnapshot(value), (entry) =>
    entry.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<GENERATED_AT>')
  );
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

    const report = await runCli(['analysis', 'report', fixtureRoot, '--format', 'markdown'], {
      env,
    });
    const context = await runCli(['analysis', 'context', '--project', fixtureRoot, '--asset', 'apps', '--format', 'json'], {
      env,
    });

    expect(report.code).toBe(0);
    expect(report.stderr).toBe('');
    expect(context.code).toBe(0);
    expect(context.stderr).toBe('');

    await expectGoldenText(report.stdout, 'fixtures/analysis/golden/report.md', {
      normalize: (value) => normalizeCliAnalysisSnapshot(value),
    });
    await expectGoldenJson(JSON.parse(context.stdout), 'fixtures/analysis/golden/context-pack.json', {
      normalize: (value) => normalizeCliAnalysisSnapshot(value),
    });
  });

  it('covers canvas inspect, validate, build, and diff through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const baseAppPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'base-app');
    const changedAppPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'changed-app');
    const registryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'runtime-registry.json');
    const outPath = join(tempDir, 'FixtureCanvas.msapp');

    const inspect = await runCli(['canvas', 'inspect', baseAppPath, '--mode', 'strict', '--registry', registryPath, '--format', 'json']);
    const validate = await runCli(['canvas', 'validate', baseAppPath, '--mode', 'strict', '--registry', registryPath, '--format', 'json']);
    const build = await runCli(['canvas', 'build', baseAppPath, '--mode', 'strict', '--registry', registryPath, '--out', outPath, '--format', 'json']);
    const diff = await runCli(['canvas', 'diff', baseAppPath, changedAppPath, '--format', 'json']);

    expect(inspect.code).toBe(0);
    expect(inspect.stderr).toBe('');
    expect(validate.code).toBe(0);
    expect(validate.stderr).toBe('');
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

  it('covers dry-run previews for canvas and flow mutation commands without side effects', async () => {
    const tempDir = await createTempDir();
    const baseAppPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'base-app');
    const registryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'runtime-registry.json');
    const rawPath = resolveRepoPath('fixtures', 'flow', 'raw', 'invoice-flow.raw.json');
    const patchPath = resolveRepoPath('fixtures', 'flow', 'patches', 'invoice-flow.patch.json');
    const canvasOutPath = join(tempDir, 'FixtureCanvas.msapp');
    const unpackedPath = join(tempDir, 'unpacked');
    const normalizedPath = join(tempDir, 'normalized');
    const patchedPath = join(tempDir, 'patched');

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
      '--dry-run',
      '--format',
      'json',
    ]);
    const flowUnpack = await runCli(['flow', 'unpack', rawPath, '--out', unpackedPath, '--dry-run', '--format', 'json']);
    const flowNormalize = await runCli(['flow', 'normalize', unpackedPath, '--out', normalizedPath, '--dry-run', '--format', 'json']);
    const flowPatch = await runCli([
      'flow',
      'patch',
      unpackedPath,
      '--file',
      patchPath,
      '--out',
      patchedPath,
      '--dry-run',
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

    await expectGoldenJson(JSON.parse(canvasBuild.stdout), 'fixtures/cli/golden/mutation/canvas-build-dry-run.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(flowUnpack.stdout), 'fixtures/cli/golden/mutation/flow-unpack-dry-run.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(flowNormalize.stdout), 'fixtures/cli/golden/mutation/flow-normalize-dry-run.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(flowPatch.stdout), 'fixtures/cli/golden/mutation/flow-patch-dry-run.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });

    await expect(access(canvasOutPath)).rejects.toThrow();
    await expect(access(unpackedPath)).rejects.toThrow();
    await expect(access(normalizedPath)).rejects.toThrow();
    await expect(access(patchedPath)).rejects.toThrow();
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
    expect(inspect.stderr).toBe('');
    expect(validate.code).toBe(1);
    expect(validate.stderr).toBe('');
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
    expect(seededInspect.stderr).toBe('');
    expect(seededValidate.code).toBe(1);
    expect(seededValidate.stderr).toBe('');
    expect(seededBuild.code).toBe(1);
    expect(seededBuild.stdout).toBe('');

    expect(registryInspect.code).toBe(0);
    expect(registryInspect.stderr).toBe('');
    expect(registryValidate.code).toBe(1);
    expect(registryValidate.stderr).toBe('');
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

    await expectGoldenJson(JSON.parse(registryInspect.stdout), 'fixtures/canvas/golden/modes/cli-registry-inspect-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(registryValidate.stdout), 'fixtures/canvas/golden/modes/cli-registry-validation-report.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
    await expectGoldenJson(JSON.parse(registryBuild.stderr), 'fixtures/canvas/golden/modes/cli-registry-build-failure.json', {
      normalize: (value) => normalizeCliSnapshot(value, tempDir),
    });
  });

  it('covers flow unpack, validate, patch, and normalize through the CLI entrypoint', async () => {
    const tempDir = await createTempDir();
    const rawPath = resolveRepoPath('fixtures', 'flow', 'raw', 'invoice-flow.raw.json');
    const patchPath = resolveRepoPath('fixtures', 'flow', 'patches', 'invoice-flow.patch.json');
    const unpackedPath = join(tempDir, 'unpacked');
    const patchedPath = join(tempDir, 'patched');
    const normalizedPath = join(tempDir, 'normalized');

    const unpack = await runCli(['flow', 'unpack', rawPath, '--out', unpackedPath, '--format', 'json']);
    const validate = await runCli(['flow', 'validate', unpackedPath, '--format', 'json']);
    const patch = await runCli(['flow', 'patch', unpackedPath, '--file', patchPath, '--out', patchedPath, '--format', 'json']);
    const normalize = await runCli(['flow', 'normalize', patchedPath, '--out', normalizedPath, '--format', 'json']);

    expect(unpack.code).toBe(0);
    expect(unpack.stderr).toBe('');
    expect(validate.code).toBe(0);
    expect(validate.stderr).toBe('');
    expect(patch.code).toBe(0);
    expect(patch.stderr).toBe('');
    expect(normalize.code).toBe(0);
    expect(normalize.stderr).toBe('');

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
    expect(validate.stderr).toBe('');

    await expectGoldenJson(JSON.parse(validate.stdout), 'fixtures/flow/golden/semantic/cli-validation-report.json', {
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
});
