import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { readJsonFile } from '@pp/artifacts';
import { ok, type OperationResult } from '@pp/diagnostics';
import type { DataverseClient } from '@pp/dataverse';
import { buildCanvasApp, CanvasService, diffCanvasApps, importCanvasTemplateRegistry, inspectCanvasApp, validateCanvasApp } from './index';
import { expectGoldenJson, expectGoldenText, mapSnapshotStrings, repoRoot, resolveRepoPath } from '../../../test/golden';

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

async function unzipCanvasPackage(packagePath: string, root: string): Promise<string> {
  const unzipDir = join(root, 'unzipped');
  await mkdir(unzipDir, { recursive: true });
  new AdmZip(packagePath).extractAllTo(unzipDir, true, true);
  return unzipDir;
}

function normalizeNativeHeaderSnapshot<T>(value: T, ...tempPaths: string[]): T {
  const normalized = normalizeCanvasSnapshot(value, ...tempPaths);

  if (typeof normalized !== 'object' || normalized === null || !('LastSavedDateTimeUTC' in normalized)) {
    return normalized;
  }

  return {
    ...(normalized as Record<string, unknown>),
    LastSavedDateTimeUTC: '<LAST_SAVED_DATE_TIME_UTC>',
  } as T;
}

function normalizeCanvasBuildSnapshot<T>(value: T, ...tempPaths: string[]): T {
  const normalized = normalizeCanvasSnapshot(value, ...tempPaths);

  if (typeof normalized !== 'object' || normalized === null || !('outFileSha256' in normalized)) {
    return normalized;
  }

  return {
    ...(normalized as Record<string, unknown>),
    outFileSha256: '<OUT_FILE_SHA256>',
  } as T;
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

function createRemoteCanvasStubDataverseClient(): DataverseClient {
  return {
    query: async <T>(options: { table: string }): Promise<OperationResult<T[]>> => {
      if (options.table === 'solutions') {
        return ok(
          [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
            },
          ] as T[],
          {
            supportTier: 'preview',
          }
        );
      }

      return ok([] as T[], {
        supportTier: 'preview',
      });
    },
    queryAll: async <T>(options: { table: string }): Promise<OperationResult<T[]>> => {
      switch (options.table) {
        case 'canvasapps':
          return ok(
            [
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
            ] as T[],
            {
              supportTier: 'preview',
            }
          );
        case 'solutioncomponents':
          return ok(
            [
              {
                solutioncomponentid: 'comp-1',
                objectid: 'canvas-1',
                componenttype: 300,
              },
            ] as T[],
            {
              supportTier: 'preview',
            }
          );
        default:
          return ok([] as T[], {
            supportTier: 'preview',
          });
      }
    },
  } as unknown as DataverseClient;
}

describe('canvas fixture-backed goldens', () => {
  it('captures remote canvas discovery and inspect outputs from committed fixtures', async () => {
    const service = new CanvasService(createRemoteCanvasStubDataverseClient());

    const list = await service.listRemote({
      solutionUniqueName: 'Core',
    });
    const inspect = await service.inspectRemote('Harness Canvas', {
      solutionUniqueName: 'Core',
    });

    expect(list.success).toBe(true);
    expect(inspect.success).toBe(true);

    await expectGoldenJson(snapshotCanvasResult(list), 'fixtures/canvas/golden/remote/list-report.json');
    await expectGoldenJson(snapshotCanvasResult(inspect), 'fixtures/canvas/golden/remote/inspect-report.json');
  });

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

  it('captures formula-heavy canvas fixtures through inspect, validate, and build outputs', async () => {
    const tempDir = await createTempDir();
    const appPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'formula-app');
    const registryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'runtime-registry.json');
    const outPath = join(tempDir, 'FormulaCanvas.msapp');

    const inspect = await inspectCanvasApp(appPath, {
      mode: 'strict',
      registries: [registryPath],
    });
    const validation = await validateCanvasApp(appPath, {
      mode: 'strict',
      registries: [registryPath],
    });
    const build = await buildCanvasApp(appPath, {
      mode: 'strict',
      registries: [registryPath],
      outPath,
    });

    expect(inspect.success).toBe(true);
    expect(validation.success).toBe(true);
    expect(validation.data?.valid).toBe(true);
    expect(build.success).toBe(true);

    await expectGoldenJson(inspect.data, 'fixtures/canvas/golden/formula/inspect-report.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
    await expectGoldenJson(validation.data, 'fixtures/canvas/golden/formula/validation-report.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
    await expectGoldenJson(build.data, 'fixtures/canvas/golden/formula/build-result.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
    await expectGoldenJson(await readJsonFile(outPath), 'fixtures/canvas/golden/formula/build-package.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
  });

  it('captures native msapp build outputs for committed unpacked pa.yaml fixtures', async () => {
    const tempDir = await createTempDir();
    const appPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'native-app');
    const registryPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'native-app', 'controls.json');
    const outPath = join(tempDir, 'NativeCanvas.msapp');

    const inspect = await inspectCanvasApp(appPath, {
      mode: 'strict',
      registries: [registryPath],
    });
    const validation = await validateCanvasApp(appPath, {
      mode: 'strict',
      registries: [registryPath],
    });
    const build = await buildCanvasApp(appPath, {
      mode: 'strict',
      registries: [registryPath],
      root: appPath,
      outPath,
    });

    expect(inspect.success).toBe(true);
    expect(validation.success).toBe(true);
    expect(validation.data?.valid).toBe(true);
    expect(build.success).toBe(true);

    await expectGoldenJson(inspect.data, 'fixtures/canvas/golden/native/inspect-report.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
    await expectGoldenJson(validation.data, 'fixtures/canvas/golden/native/validation-report.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
    await expectGoldenJson(build.data, 'fixtures/canvas/golden/native/build-result.json', {
      normalize: (value) => normalizeCanvasBuildSnapshot(value, tempDir),
    });

    const unzipDir = await unzipCanvasPackage(outPath, tempDir);
    await expectGoldenJson(await readJsonFile(join(unzipDir, 'References', 'Templates.json')), 'fixtures/canvas/golden/native/package-templates.json');
    await expectGoldenJson(await readJsonFile(join(unzipDir, 'Controls', '4.json')), 'fixtures/canvas/golden/native/package-screen-control.json');
    await expectGoldenJson(await readJsonFile(join(unzipDir, 'Header.json')), 'fixtures/canvas/golden/native/package-header.json', {
      normalize: (value) => normalizeNativeHeaderSnapshot(value, tempDir),
    });
    await expectGoldenText(await readFile(join(unzipDir, 'Src', '_EditorState.pa.yaml'), 'utf8'), 'fixtures/canvas/golden/native/package-editor-state.pa.yaml');
  });

  it('auto-loads embedded controls registries for unpacked apps and reports changed pa.yaml properties in diffs', async () => {
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

    const inspect = await inspectCanvasApp(appPath, {
      mode: 'strict',
    });
    const validation = await validateCanvasApp(appPath, {
      mode: 'strict',
    });
    const build = await buildCanvasApp(appPath, {
      mode: 'strict',
      root: appPath,
      outPath,
    });
    const diff = await diffCanvasApps(appPath, changedAppPath);

    expect(inspect.success).toBe(true);
    expect(inspect.data?.registries).toHaveLength(1);
    expect(inspect.data?.registries[0]?.path).toContain('/fixtures/canvas/apps/native-app/controls.json');
    expect(validation.success).toBe(true);
    expect(validation.data?.valid).toBe(true);
    expect(build.success).toBe(true);
    expect(diff.success).toBe(true);
    expect(diff.data).toEqual({
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

  it('captures seeded-only and registry-only canvas mode failures when required template metadata is split across fixture sources', async () => {
    const tempDir = await createTempDir();
    const appPath = resolveRepoPath('fixtures', 'canvas', 'apps', 'base-app');
    const registryPath = resolveRepoPath('fixtures', 'canvas', 'registries', 'runtime-registry.json');
    const seededOutPath = join(tempDir, 'FixtureCanvas.seeded.msapp');
    const registryOutPath = join(tempDir, 'FixtureCanvas.registry.msapp');

    const seededInspect = await inspectCanvasApp(appPath, {
      mode: 'seeded',
      registries: [registryPath],
    });
    const seededValidation = await validateCanvasApp(appPath, {
      mode: 'seeded',
      registries: [registryPath],
    });
    const seededBuild = await buildCanvasApp(appPath, {
      mode: 'seeded',
      registries: [registryPath],
      outPath: seededOutPath,
    });

    const registryInspect = await inspectCanvasApp(appPath, {
      mode: 'registry',
      registries: [registryPath],
    });
    const registryValidation = await validateCanvasApp(appPath, {
      mode: 'registry',
      registries: [registryPath],
    });
    const registryBuild = await buildCanvasApp(appPath, {
      mode: 'registry',
      registries: [registryPath],
      outPath: registryOutPath,
    });

    expect(seededInspect.success).toBe(true);
    expect(seededValidation.success).toBe(true);
    expect(seededValidation.data?.valid).toBe(false);
    expect(seededBuild.success).toBe(false);

    expect(registryInspect.success).toBe(true);
    expect(registryValidation.success).toBe(true);
    expect(registryValidation.data?.valid).toBe(false);
    expect(registryBuild.success).toBe(false);

    await expectGoldenJson(snapshotCanvasResult(seededInspect), 'fixtures/canvas/golden/modes/seeded-inspect-report.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
    await expectGoldenJson(snapshotCanvasResult(seededValidation), 'fixtures/canvas/golden/modes/seeded-validation-report.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
    await expectGoldenJson(snapshotCanvasResult(seededBuild), 'fixtures/canvas/golden/modes/seeded-build-failure.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });

    await expectGoldenJson(snapshotCanvasResult(registryInspect), 'fixtures/canvas/golden/modes/registry-inspect-report.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
    await expectGoldenJson(snapshotCanvasResult(registryValidation), 'fixtures/canvas/golden/modes/registry-validation-report.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
    await expectGoldenJson(snapshotCanvasResult(registryBuild), 'fixtures/canvas/golden/modes/registry-build-failure.json', {
      normalize: (value) => normalizeCanvasSnapshot(value, tempDir),
    });
  });
});
