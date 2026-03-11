import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ok, type OperationResult } from '@pp/diagnostics';
import type { DataverseClient } from '@pp/dataverse';
import {
  applyCanvasPatch,
  buildCanvasApp,
  CanvasService,
  diffCanvasApps,
  diffCanvasTemplateRegistries,
  importCanvasTemplateRegistry,
  inspectCanvasApp,
  inspectCanvasTemplateRegistry,
  inspectCanvasWorkspace,
  loadCanvasSource,
  loadCanvasTemplateRegistryBundle,
  pinCanvasTemplateRegistry,
  planCanvasPatch,
  refreshCanvasTemplateRegistry,
  resolveCanvasSupport,
  resolveCanvasTemplate,
  resolveCanvasTemplateRegistryPaths,
  resolveCanvasTemplateRequirements,
  validateCanvasApp,
  type CanvasRegistryBundle,
} from './index';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pp-canvas-'));
  tempDirs.push(path);
  return path;
}

async function createZip(sourceDir: string, outPath: string): Promise<void> {
  const result = spawnSync('zip', ['-rqX', outPath, '.'], {
    cwd: sourceDir,
    encoding: 'utf8',
  });

  expect(result.status).toBe(0);
}

async function writeCanvasApp(
  root: string,
  definition: {
    name: string;
    version?: string;
    screens: Array<{
      name: string;
      file: string;
      controls: Array<Record<string, unknown>>;
    }>;
    seededTemplates?: Record<string, unknown>;
  }
): Promise<string> {
  const appPath = join(root, definition.name);
  await mkdir(join(appPath, 'screens'), { recursive: true });

  await writeFile(
    join(appPath, 'canvas.json'),
    JSON.stringify(
      {
        name: definition.name,
        version: definition.version,
        screens: definition.screens.map((screen) => ({
          name: screen.name,
          file: screen.file,
        })),
      },
      null,
      2
    ),
    'utf8'
  );

  for (const screen of definition.screens) {
    await writeFile(
      join(appPath, screen.file),
      JSON.stringify(
        {
          name: screen.name,
          controls: screen.controls,
        },
        null,
        2
      ),
      'utf8'
    );
  }

  if (definition.seededTemplates) {
    await writeFile(join(appPath, 'seed.templates.json'), JSON.stringify(definition.seededTemplates, null, 2), 'utf8');
  }

  return appPath;
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

describe('canvas template registries', () => {
  it('loads registries, merges templates, and resolves support by alias', async () => {
    const dir = await createTempDir();
    const firstRegistryPath = join(dir, 'seed.json');
    const secondRegistryPath = join(dir, 'catalog.json');

    await writeFile(
      firstRegistryPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          templates: [
            {
              templateName: 'Button',
              templateVersion: '1.0.0',
              aliases: {
                displayNames: ['Primary Button'],
                constructors: ['Button'],
                yamlNames: ['button'],
              },
              files: {
                'Controls/Button.json': {
                  kind: 'button',
                },
              },
              provenance: {
                kind: 'official-artifact',
                source: 'seed-app',
              },
            },
          ],
          supportMatrix: [
            {
              templateName: 'Button',
              version: '1.*',
              status: 'supported',
              modes: ['strict', 'seeded', 'registry'],
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    await writeFile(
      secondRegistryPath,
      JSON.stringify(
        {
          templates: {
            Label: {
              version: '2.0.0',
              aliases: {
                yamlName: 'label',
              },
              files: {
                'Controls/Label.json': {
                  kind: 'label',
                },
              },
              provenance: {
                source: 'curated-catalog',
              },
            },
          },
          support: [
            {
              name: 'Label',
              version: '2.*',
              status: 'partial',
              modes: ['registry'],
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const bundle = await loadCanvasTemplateRegistryBundle({
      root: dir,
      registries: ['./seed.json', './catalog.json'],
    });

    expect(bundle.success).toBe(true);
    expect(bundle.data?.sources).toHaveLength(2);
    expect(bundle.data?.templates).toHaveLength(2);

    const match = resolveCanvasTemplate(bundle.data!, {
      name: 'Primary Button',
    });

    expect(match.template).toMatchObject({
      templateName: 'Button',
      templateVersion: '1.0.0',
    });
    expect(match.matchedBy).toBe('displayName');
    expect(match.support.status).toBe('supported');

    const labelSupport = resolveCanvasSupport(bundle.data!.supportMatrix, 'Label', '2.0.0');
    expect(labelSupport.status).toBe('partial');
    expect(labelSupport.modes).toEqual(['registry']);
  });

  it('imports non-canonical template catalogs and writes a normalized registry file', async () => {
    const dir = await createTempDir();
    const sourcePath = join(dir, 'import.json');
    const outPath = join(dir, 'normalized.json');

    await writeFile(
      sourcePath,
      JSON.stringify(
        {
          templates: {
            Slider: {
              version: '3.1.0',
              aliases: {
                yamlName: 'slider',
              },
              files: {
                'Controls/Slider.json': {
                  kind: 'slider',
                  minimum: 0,
                },
              },
            },
          },
          supportMatrix: [
            {
              templateName: 'Slider',
              version: '3.*',
              supported: true,
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const imported = await importCanvasTemplateRegistry({
      sourcePath,
      outPath,
      provenance: {
        source: 'demo-fixture',
        acquiredAt: '2026-03-09T00:00:00.000Z',
      },
    });

    expect(imported.success).toBe(true);
    expect(imported.data?.templates[0]).toMatchObject({
      templateName: 'Slider',
      templateVersion: '3.1.0',
      provenance: {
        source: 'demo-fixture',
        importedFrom: sourcePath,
      },
    });
    expect(imported.data?.templates[0]?.contentHash).toMatch(/[a-f0-9]{64}/);

    const written = JSON.parse(await readFile(outPath, 'utf8')) as {
      templates: Array<{ contentHash: string }>;
    };
    expect(written.templates[0]?.contentHash).toMatch(/[a-f0-9]{64}/);
  });

  it('enforces deterministic build-mode resolution across seeded and registry bundles', () => {
    const seededBundle: CanvasRegistryBundle = {
      sources: [],
      templates: [
        {
          templateName: 'Button',
          templateVersion: '1.0.0',
          contentHash: 'seed',
          provenance: {
            kind: 'official-artifact',
            source: 'seed-app',
          },
        },
      ],
      supportMatrix: [
        {
          templateName: 'Button',
          version: '1.*',
          status: 'supported',
          modes: ['strict', 'seeded'],
        },
      ],
      hash: 'seed-bundle',
    };
    const registryBundle: CanvasRegistryBundle = {
      sources: [],
      templates: [
        {
          templateName: 'Label',
          templateVersion: '2.0.0',
          contentHash: 'registry',
          provenance: {
            kind: 'official-artifact',
            source: 'catalog',
          },
        },
      ],
      supportMatrix: [
        {
          templateName: 'Label',
          version: '2.*',
          status: 'supported',
          modes: ['strict', 'registry'],
        },
      ],
      hash: 'registry-bundle',
    };

    const seededResolution = resolveCanvasTemplateRequirements(
      [
        {
          name: 'Button',
          version: '1.0.0',
        },
      ],
      {
        mode: 'seeded',
        seeded: seededBundle,
        registry: registryBundle,
      }
    );
    const strictResolution = resolveCanvasTemplateRequirements(
      [
        {
          name: 'Label',
          version: '2.0.0',
        },
      ],
      {
        mode: 'strict',
        seeded: seededBundle,
        registry: registryBundle,
      }
    );

    expect(seededResolution.supported).toBe(true);
    expect(seededResolution.missing).toHaveLength(0);
    expect(strictResolution.supported).toBe(true);
    expect(strictResolution.resolutions[0]?.template?.templateName).toBe('Label');
  });

  it('resolves project-relative and cache-backed registry paths deterministically', () => {
    const resolved = resolveCanvasTemplateRegistryPaths({
      root: '/repo',
      cacheDir: '/cache/canvas',
      registries: ['./registries/base.json', 'cache:seeded-controls'],
    });

    expect(resolved.success).toBe(true);
    expect(resolved.data).toEqual([
      '/repo/registries/base.json',
      '/cache/canvas/seeded-controls.json',
    ]);
  });
});

describe('remote canvas app workflows', () => {
  it('keeps the built package surface aligned for remote download support', async () => {
    const builtPackage = await import('../dist/index.js');

    expect(typeof builtPackage.CanvasService).toBe('function');
    expect(typeof builtPackage.CanvasService.prototype.downloadRemote).toBe('function');
  });

  it('lists and inspects remote canvas apps with solution filtering', async () => {
    const service = new CanvasService(createRemoteCanvasStubDataverseClient());

    const list = await service.listRemote({
      solutionUniqueName: 'Core',
    });
    const inspect = await service.inspectRemote('Harness Canvas', {
      solutionUniqueName: 'Core',
    });

    expect(list.success).toBe(true);
    expect(list.data).toHaveLength(1);
    expect(list.data?.[0]).toMatchObject({
      id: 'canvas-1',
      displayName: 'Harness Canvas',
      name: 'crd_HarnessCanvas',
      inSolution: true,
      tags: ['harness', 'solution'],
    });
    expect(inspect.success).toBe(true);
    expect(inspect.data).toMatchObject({
      id: 'canvas-1',
      openUri: 'https://make.powerapps.com/e/test/canvas/?app-id=canvas-1',
    });
  });

  it('downloads a remote canvas app by exporting the containing solution package', async () => {
    const dir = await createTempDir();
    const solutionRoot = join(dir, 'solution');
    await mkdir(join(solutionRoot, 'CanvasApps'), { recursive: true });
    await writeFile(join(solutionRoot, 'CanvasApps', 'crd_HarnessCanvas.msapp'), 'fixture-msapp', 'utf8');
    const solutionZip = join(dir, 'Core.zip');
    await createZip(solutionRoot, solutionZip);

    const service = new CanvasService({
      ...createRemoteCanvasStubDataverseClient(),
      invokeAction: async <T>(name: string): Promise<OperationResult<{ body?: T }>> => {
        if (name === 'ExportSolution') {
          return ok(
            {
              body: {
                ExportSolutionFile: (await readFile(solutionZip)).toString('base64'),
              } as T,
            },
            {
              supportTier: 'preview',
            }
          );
        }

        return ok(
          {
            body: {} as T,
          },
          {
            supportTier: 'preview',
          }
        );
      },
    } as unknown as DataverseClient);

    const outPath = join(dir, 'downloaded', 'Harness Canvas.msapp');
    const result = await service.downloadRemote('Harness Canvas', {
      solutionUniqueName: 'Core',
      outPath,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      solutionUniqueName: 'Core',
      outPath,
      exportedEntry: 'CanvasApps/crd_HarnessCanvas.msapp',
      availableEntries: ['CanvasApps/crd_HarnessCanvas.msapp'],
    });
    expect(await readFile(outPath, 'utf8')).toBe('fixture-msapp');
  });
});

describe('canvas app workflows', () => {
  it('loads, validates, and inspects a supported canvas source tree', async () => {
    const dir = await createTempDir();
    const registryPath = join(dir, 'controls.json');

    await writeFile(
      registryPath,
      JSON.stringify(
        {
          templates: [
            {
              templateName: 'Button',
              templateVersion: '1.0.0',
              provenance: {
                source: 'catalog',
              },
            },
            {
              templateName: 'Label',
              templateVersion: '1.0.0',
              provenance: {
                source: 'catalog',
              },
            },
          ],
          supportMatrix: [
            {
              templateName: 'Button',
              version: '1.*',
              status: 'supported',
              modes: ['strict', 'registry'],
            },
            {
              templateName: 'Label',
              version: '1.*',
              status: 'supported',
              modes: ['strict', 'registry'],
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const appPath = await writeCanvasApp(dir, {
      name: 'SalesCanvas',
      version: '1.0.0',
      screens: [
        {
          name: 'Home',
          file: 'screens/Home.json',
          controls: [
            {
              name: 'SaveButton',
              templateName: 'Button',
              templateVersion: '1.0.0',
              properties: {
                TextFormula: "\"Save\"",
              },
            },
            {
              name: 'SummaryLabel',
              templateName: 'Label',
              templateVersion: '1.0.0',
              properties: {
                Text: 'Ready',
              },
            },
          ],
        },
      ],
    });

    const source = await loadCanvasSource(appPath);
    const validation = await validateCanvasApp(appPath, {
      root: dir,
      registries: ['./controls.json'],
      mode: 'strict',
    });
    const inspect = await inspectCanvasApp(appPath, {
      root: dir,
      registries: ['./controls.json'],
      mode: 'strict',
    });

    expect(source.success).toBe(true);
    expect(source.data?.controls).toHaveLength(2);
    expect(validation.success).toBe(true);
    expect(validation.data?.valid).toBe(true);
    expect(validation.data?.templateRequirements.supported).toBe(true);
    expect(inspect.success).toBe(true);
    expect(inspect.data?.controls.map((control) => control.path)).toEqual([
      'Home/SaveButton',
      'Home/SummaryLabel',
    ]);
    expect(inspect.data?.registries).toHaveLength(1);
  });

  it('reports invalid formula surfaces during validation', async () => {
    const dir = await createTempDir();
    const registryPath = join(dir, 'controls.json');

    await writeFile(
      registryPath,
      JSON.stringify(
        {
          templates: [
            {
              templateName: 'Button',
              templateVersion: '1.0.0',
              provenance: {
                source: 'catalog',
              },
            },
          ],
          supportMatrix: [
            {
              templateName: 'Button',
              version: '1.*',
              status: 'supported',
              modes: ['strict'],
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const appPath = await writeCanvasApp(dir, {
      name: 'BrokenCanvas',
      screens: [
        {
          name: 'Home',
          file: 'screens/Home.json',
          controls: [
            {
              name: 'BadButton',
              templateName: 'Button',
              templateVersion: '1.0.0',
              properties: {
                TextFormula: 42,
              },
            },
          ],
        },
      ],
    });

    const validation = await validateCanvasApp(appPath, {
      root: dir,
      registries: ['./controls.json'],
      mode: 'strict',
    });

    expect(validation.success).toBe(true);
    expect(validation.data?.valid).toBe(false);
    expect(validation.data?.formulas).toEqual([
      {
        controlPath: 'Home/BadButton',
        property: 'TextFormula',
        valid: false,
      },
    ]);
  });

  it('builds a deterministic package and diffs canvas source trees', async () => {
    const dir = await createTempDir();
    const registryPath = join(dir, 'controls.json');

    await writeFile(
      registryPath,
      JSON.stringify(
        {
          templates: [
            {
              templateName: 'Button',
              templateVersion: '1.0.0',
              provenance: {
                source: 'catalog',
              },
            },
            {
              templateName: 'Label',
              templateVersion: '1.0.0',
              provenance: {
                source: 'catalog',
              },
            },
          ],
          supportMatrix: [
            {
              templateName: 'Button',
              version: '1.*',
              status: 'supported',
              modes: ['strict', 'registry'],
            },
            {
              templateName: 'Label',
              version: '1.*',
              status: 'supported',
              modes: ['strict', 'registry'],
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const firstApp = await writeCanvasApp(dir, {
      name: 'CanvasOne',
      version: '1.0.0',
      screens: [
        {
          name: 'Home',
          file: 'screens/Home.json',
          controls: [
            {
              name: 'SaveButton',
              templateName: 'Button',
              templateVersion: '1.0.0',
              properties: {
                TextFormula: "\"Save\"",
              },
            },
          ],
        },
      ],
    });
    const secondApp = await writeCanvasApp(dir, {
      name: 'CanvasTwo',
      version: '2.0.0',
      screens: [
        {
          name: 'Home',
          file: 'screens/Home.json',
          controls: [
            {
              name: 'SaveButton',
              templateName: 'Button',
              templateVersion: '1.0.0',
              properties: {
                TextFormula: "\"Submit\"",
              },
            },
            {
              name: 'StatusLabel',
              templateName: 'Label',
              templateVersion: '1.0.0',
              properties: {
                Text: 'New',
              },
            },
          ],
        },
      ],
    });

    const build = await buildCanvasApp(firstApp, {
      root: dir,
      registries: ['./controls.json'],
      mode: 'strict',
      outPath: join(dir, 'dist', 'CanvasOne.msapp'),
    });
    const diff = await diffCanvasApps(firstApp, secondApp);

    expect(build.success).toBe(true);
    expect(build.data?.outPath).toBe(join(dir, 'dist', 'CanvasOne.msapp'));
    expect(build.data?.packageHash).toMatch(/[a-f0-9]{64}/);

    const packageDocument = JSON.parse(await readFile(join(dir, 'dist', 'CanvasOne.msapp'), 'utf8')) as {
      kind: string;
      templates: Array<{ templateName: string }>;
    };
    expect(packageDocument.kind).toBe('pp.canvas.package');
    expect(packageDocument.templates).toHaveLength(1);

    expect(diff.success).toBe(true);
    expect(diff.data?.appChanged).toBe(true);
    expect(diff.data?.controls).toEqual([
      {
        controlPath: 'Home/StatusLabel',
        kind: 'added',
      },
    ]);
    expect(diff.data?.templateChanges.added).toEqual(['Label@1.0.0']);
  });
});

describe('canvas workspace and registry lifecycle workflows', () => {
  it('resolves multi-app workspace registries and shared catalogs', async () => {
    const dir = await createTempDir();
    const appOne = await writeCanvasApp(dir, {
      name: 'SalesCanvas',
      screens: [
        {
          name: 'Home',
          file: 'screens/Home.json',
          controls: [
            {
              name: 'Title',
              templateName: 'Label',
              templateVersion: '1.0.0',
              properties: {
                TextFormula: '="Sales"',
              },
            },
          ],
        },
      ],
    });
    const appTwo = await writeCanvasApp(dir, {
      name: 'OpsCanvas',
      screens: [
        {
          name: 'Home',
          file: 'screens/Home.json',
          controls: [
            {
              name: 'Title',
              templateName: 'Label',
              templateVersion: '1.0.0',
              properties: {
                TextFormula: '="Ops"',
              },
            },
          ],
        },
      ],
    });
    const sharedRegistryPath = join(dir, 'shared-registry.json');
    const appRegistryPath = join(dir, 'ops-registry.json');
    const workspacePath = join(dir, 'canvas.workspace.json');

    await writeFile(
      sharedRegistryPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          templates: [
            {
              templateName: 'Label',
              templateVersion: '1.0.0',
              files: {
                'Controls/Label.json': {
                  kind: 'label',
                },
              },
              provenance: {
                kind: 'official-artifact',
                source: 'shared',
              },
            },
          ],
          supportMatrix: [
            {
              templateName: 'Label',
              version: '1.*',
              status: 'supported',
              modes: ['strict', 'seeded', 'registry'],
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    await writeFile(
      appRegistryPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          templates: [
            {
              templateName: 'Button',
              templateVersion: '1.0.0',
              files: {
                'Controls/Button.json': {
                  kind: 'button',
                },
              },
              provenance: {
                kind: 'official-artifact',
                source: 'ops',
              },
            },
          ],
          supportMatrix: [
            {
              templateName: 'Button',
              version: '1.*',
              status: 'supported',
              modes: ['strict'],
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    await writeFile(
      workspacePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          name: 'Canvas Workspace',
          registries: ['./shared-registry.json'],
          catalogs: [
            {
              name: 'shared',
              registries: ['./shared-registry.json'],
            },
          ],
          apps: [
            {
              name: 'sales',
              path: './SalesCanvas',
              catalogs: ['shared'],
            },
            {
              name: 'ops',
              path: './OpsCanvas',
              catalogs: ['shared'],
              registries: ['./ops-registry.json'],
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    expect(appOne).toContain('SalesCanvas');
    expect(appTwo).toContain('OpsCanvas');

    const workspace = await inspectCanvasWorkspace(workspacePath);
    expect(workspace.success).toBe(true);
    expect(workspace.data?.apps).toHaveLength(2);
    expect(workspace.data?.apps.find((app) => app.name === 'ops')?.registries).toEqual([
      './shared-registry.json',
      './shared-registry.json',
      './ops-registry.json',
    ]);

    const resolved = await new CanvasService().resolveWorkspaceTarget('ops', {
      workspacePath,
    });
    expect(resolved.success).toBe(true);
    expect(resolved.data?.path).toBe(resolvePath(dir, 'OpsCanvas'));
    expect(resolved.data?.registries).toEqual(['./shared-registry.json', './shared-registry.json', './ops-registry.json']);
  });

  it('inspects, diffs, pins, refreshes, and audits template registries', async () => {
    const dir = await createTempDir();
    const leftPath = join(dir, 'left.json');
    const rightPath = join(dir, 'right.json');
    const importSourcePath = join(dir, 'import-source.json');
    const pinnedPath = join(dir, 'pinned.json');
    const refreshedPath = join(dir, 'refreshed.json');

    await writeFile(
      leftPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          templates: [
            {
              templateName: 'Label',
              templateVersion: '1.0.0',
              files: {
                'Controls/Label.json': {
                  kind: 'label',
                },
              },
              provenance: {
                kind: 'official-artifact',
                source: 'left',
                importedFrom: 'left.json',
                sourceArtifact: 'left-artifact.zip',
                platformVersion: '3.24011',
                appVersion: '1.0.0.0',
              },
            },
          ],
          supportMatrix: [
            {
              templateName: 'Label',
              version: '1.*',
              status: 'supported',
              modes: ['strict'],
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    await writeFile(
      rightPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          templates: [
            {
              templateName: 'Label',
              templateVersion: '1.0.0',
              files: {
                'Controls/Label.json': {
                  kind: 'label',
                  variant: 'updated',
                },
              },
              provenance: {
                kind: 'official-artifact',
                source: 'right',
                importedFrom: 'right.json',
              },
            },
            {
              templateName: 'Button',
              templateVersion: '1.0.0',
              files: {
                'Controls/Button.json': {
                  kind: 'button',
                },
              },
              provenance: {
                kind: 'official-artifact',
                source: 'right',
              },
            },
          ],
          supportMatrix: [
            {
              templateName: 'Label',
              version: '1.*',
              status: 'supported',
              modes: ['strict'],
            },
            {
              templateName: 'Button',
              version: '1.*',
              status: 'supported',
              modes: ['strict'],
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    await writeFile(
      importSourcePath,
      JSON.stringify(
        {
          templates: [
            {
              name: 'Label',
              version: '2.0.0',
              files: {
                'Controls/Label.json': {
                  kind: 'label',
                  variant: 'refresh',
                },
              },
            },
          ],
          supportMatrix: [
            {
              templateName: 'Label',
              version: '2.*',
              status: 'supported',
              modes: ['strict'],
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const inspect = await inspectCanvasTemplateRegistry(leftPath);
    expect(inspect.success).toBe(true);
    expect(inspect.data?.templateCount).toBe(1);

    const diff = await diffCanvasTemplateRegistries(leftPath, rightPath);
    expect(diff.success).toBe(true);
    expect(diff.data?.templates.added).toEqual(['Button@1.0.0']);
    expect(diff.data?.templates.changed).toEqual(['Label@1.0.0']);

    const pin = await pinCanvasTemplateRegistry(leftPath, pinnedPath);
    expect(pin.success).toBe(true);
    expect((await readFile(pinnedPath, 'utf8')).length).toBeGreaterThan(0);

    const audit = await new CanvasService().auditRegistry(leftPath);
    expect(audit.success).toBe(true);
    expect(audit.data?.missingImportedFromCount).toBe(0);

    const refresh = await refreshCanvasTemplateRegistry({
      sourcePath: importSourcePath,
      currentPath: leftPath,
      outPath: refreshedPath,
      provenance: {
        kind: 'official-artifact',
        source: 'refresh',
      },
    });
    expect(refresh.success).toBe(true);
    expect(refresh.data?.registry.templateCount).toBe(1);
    expect(refresh.data?.diff?.templates.added).toEqual(['Label@2.0.0']);
    expect(refresh.data?.diff?.templates.removed).toEqual(['Label@1.0.0']);
  });
});

describe('canvas patch workflows', () => {
  it('plans and applies bounded patches for json-manifest apps', async () => {
    const dir = await createTempDir();
    const appPath = await writeCanvasApp(dir, {
      name: 'PatchedCanvas',
      screens: [
        {
          name: 'Home',
          file: 'screens/Home.json',
          controls: [
            {
              name: 'Layout',
              templateName: 'groupContainer',
              templateVersion: '1.0.0',
              properties: {},
              children: [
                {
                  name: 'Title',
                  templateName: 'Label',
                  templateVersion: '1.0.0',
                  properties: {
                    TextFormula: '="Before"',
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const outputPath = join(dir, 'patched-out');
    const patch = {
      schemaVersion: 1,
      operations: [
        {
          op: 'set-property',
          controlPath: 'Home/Layout/Title',
          property: 'TextFormula',
          value: '="After"',
        },
        {
          op: 'add-control',
          screen: 'Home',
          parentPath: 'Home/Layout',
          control: {
            name: 'Submit',
            templateName: 'Button',
            templateVersion: '1.0.0',
            properties: {
              TextFormula: '="Save"',
            },
          },
        },
        {
          op: 'remove-control',
          controlPath: 'Home/Layout/Title',
        },
      ],
    } as const;

    const plan = await planCanvasPatch(appPath, patch);
    expect(plan.success).toBe(true);
    expect(plan.data?.valid).toBe(true);
    expect(plan.data?.operations).toHaveLength(3);

    const applied = await applyCanvasPatch(appPath, patch, outputPath);
    expect(applied.success).toBe(true);
    expect(applied.data?.outPath).toBe(outputPath);

    const reloaded = await loadCanvasSource(outputPath);
    expect(reloaded.success).toBe(true);
    expect(reloaded.data?.controls.map((control) => control.path)).toEqual(['Home/Layout', 'Home/Layout/Submit']);
  });
});
