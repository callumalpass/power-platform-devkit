import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readJsonFile } from '@pp/artifacts';
import { buildCanvasApp, diffCanvasApps, importCanvasTemplateRegistry, inspectCanvasApp, validateCanvasApp } from './index';
import { expectGoldenJson, mapSnapshotStrings, repoRoot, resolveRepoPath } from '../../../test/golden';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((path) => rm(path, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pp-canvas-golden-'));
  tempDirs.push(path);
  return path;
}

function normalizeCanvasSnapshot<T>(value: T, ...tempPaths: string[]): T {
  return mapSnapshotStrings(value, (entry) => {
    let normalized = entry.replaceAll(repoRoot, '<REPO_ROOT>').replaceAll('\\', '/');

    for (const tempPath of tempPaths) {
      normalized = normalized.replaceAll(tempPath.replaceAll('\\', '/'), '<TMP_DIR>');
    }

    return normalized;
  });
}

function normalizeImportedRegistryRoundTrip<T>(value: T, ...tempPaths: string[]): T {
  const normalized = normalizeCanvasSnapshot(value, ...tempPaths) as T;

  if (typeof normalized !== 'object' || normalized === null) {
    return normalized;
  }

  return mapSnapshotStrings(normalized, (entry) => (entry === '<TMP_DIR>/normalized.json' ? '<REPO_ROOT>/fixtures/canvas/registries/import-source.json' : entry));
}

function snapshotCanvasResult<T>(result: {
  success: boolean;
  data?: T;
  diagnostics: unknown[];
  warnings: unknown[];
  supportTier: string;
}): {
  success: boolean;
  data?: T;
  diagnostics: unknown[];
  warnings: unknown[];
  supportTier: string;
} {
  return {
    success: result.success,
    data: result.data,
    diagnostics: result.diagnostics,
    warnings: result.warnings,
    supportTier: result.supportTier,
  };
}

describe('canvas fixture-backed goldens', () => {
  it('captures normalized template imports and preserves re-import semantics', async () => {
    const tempDir = await createTempDir();
    const sourcePath = resolveRepoPath('fixtures', 'canvas', 'registries', 'import-source.json');
    const outPath = join(tempDir, 'normalized.json');
    const reimportedPath = join(tempDir, 'reimported.json');

    const imported = await importCanvasTemplateRegistry({
      sourcePath,
      outPath,
      provenance: {
        kind: 'official-artifact',
        source: 'canvas-import-fixture',
        acquiredAt: '2026-03-10T00:00:00.000Z',
      },
    });

    expect(imported.success).toBe(true);

    await expectGoldenJson(imported.data, 'fixtures/canvas/golden/imported-registry.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });

    const reimported = await importCanvasTemplateRegistry({
      sourcePath: outPath,
      outPath: reimportedPath,
      provenance: {
        kind: 'official-artifact',
        source: 'canvas-import-fixture',
        acquiredAt: '2026-03-10T00:00:00.000Z',
      },
    });

    expect(reimported.success).toBe(true);
    expect(
      normalizeImportedRegistryRoundTrip(reimported.data, tempDir)
    ).toEqual(normalizeImportedRegistryRoundTrip(imported.data, tempDir));
  });

  it('captures inspect, validate, build, and diff outputs for committed canvas fixtures', async () => {
    const tempDir = await createTempDir();
    const baseAppPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'base-app');
    const changedAppPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'changed-app');
    const registryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'runtime-registry.json');
    const outPath = join(tempDir, 'FixtureCanvas.msapp');

    const inspect = await inspectCanvasApp(baseAppPath, {
      mode: 'strict',
      registries: [registryPath],
    });
    const validation = await validateCanvasApp(baseAppPath, {
      mode: 'strict',
      registries: [registryPath],
    });
    const build = await buildCanvasApp(baseAppPath, {
      mode: 'strict',
      registries: [registryPath],
      outPath,
    });
    const diff = await diffCanvasApps(baseAppPath, changedAppPath);

    expect(inspect.success).toBe(true);
    expect(validation.success).toBe(true);
    expect(validation.data?.valid).toBe(true);
    expect(build.success).toBe(true);
    expect(diff.success).toBe(true);

    await expectGoldenJson(inspect.data, 'fixtures/canvas/golden/inspect-report.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
    await expectGoldenJson(validation.data, 'fixtures/canvas/golden/validation-report.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
    await expectGoldenJson(build.data, 'fixtures/canvas/golden/build-result.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
    await expectGoldenJson(await readJsonFile(outPath), 'fixtures/canvas/golden/build-package.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
    await expectGoldenJson(diff.data, 'fixtures/canvas/golden/diff-report.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
  });

  it('captures semantic validation diagnostics and build failures for invalid canvas fixtures', async () => {
    const tempDir = await createTempDir();
    const appPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'diagnostic-app');
    const runtimeRegistryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'runtime-registry.json');
    const semanticRegistryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'semantic-registry.json');
    const outPath = join(tempDir, 'DiagnosticCanvas.msapp');

    const inspect = await inspectCanvasApp(appPath, {
      mode: 'strict',
      registries: [runtimeRegistryPath, semanticRegistryPath],
    });
    const validation = await validateCanvasApp(appPath, {
      mode: 'strict',
      registries: [runtimeRegistryPath, semanticRegistryPath],
    });
    const build = await buildCanvasApp(appPath, {
      mode: 'strict',
      registries: [runtimeRegistryPath, semanticRegistryPath],
      outPath,
    });

    expect(inspect.success).toBe(true);
    expect(validation.success).toBe(true);
    expect(validation.data?.valid).toBe(false);
    expect(build.success).toBe(false);

    await expectGoldenJson(snapshotCanvasResult(inspect), 'fixtures/canvas/golden/semantic/inspect-report.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
    await expectGoldenJson(snapshotCanvasResult(validation), 'fixtures/canvas/golden/semantic/validation-report.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
    await expectGoldenJson(snapshotCanvasResult(build), 'fixtures/canvas/golden/semantic/build-failure.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
  });
});
