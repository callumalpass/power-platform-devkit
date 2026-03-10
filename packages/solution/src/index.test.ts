import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ok, type OperationResult } from '@pp/diagnostics';
import type { DataverseClient } from '@pp/dataverse';
import { SolutionService, type SolutionCommandInvocation, type SolutionCommandResult } from './index';

interface StubData {
  solution: {
    solutionid: string;
    uniquename: string;
    friendlyname?: string;
    version?: string;
  };
  publishers?: Array<Record<string, unknown>>;
  components: Array<Record<string, unknown>>;
  dependencies: Array<Record<string, unknown>>;
  connectionReferences?: Array<Record<string, unknown>>;
  environmentVariableDefinitions?: Array<Record<string, unknown>>;
  environmentVariableValues?: Array<Record<string, unknown>>;
  exportPayloadBase64?: string;
  requestRecorder?: Array<{ path: string; body: Record<string, unknown> | undefined }>;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((path) => rm(path, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pp-solution-'));
  tempDirs.push(path);
  return path;
}

function createStubClient(data: StubData): DataverseClient {
  return {
    query: async <T>(options: { table: string }): Promise<OperationResult<T[]>> => {
      if (options.table === 'solutions') {
        return ok([data.solution] as T[], {
          supportTier: 'preview',
        });
      }

      if (options.table === 'publishers') {
        return ok((data.publishers ?? []) as T[], {
          supportTier: 'preview',
        });
      }

      return ok([] as T[], {
        supportTier: 'preview',
      });
    },
    queryAll: async <T>(options: { table: string }): Promise<OperationResult<T[]>> => {
      switch (options.table) {
        case 'solutioncomponents':
          return ok(data.components as T[], { supportTier: 'preview' });
        case 'dependencies':
          return ok(data.dependencies as T[], { supportTier: 'preview' });
        case 'connectionreferences':
          return ok((data.connectionReferences ?? []) as T[], { supportTier: 'preview' });
        case 'environmentvariabledefinitions':
          return ok((data.environmentVariableDefinitions ?? []) as T[], { supportTier: 'preview' });
        case 'environmentvariablevalues':
          return ok((data.environmentVariableValues ?? []) as T[], { supportTier: 'preview' });
        default:
          return ok([] as T[], { supportTier: 'preview' });
      }
    },
    create: async <TRecord extends Record<string, unknown>, TResult = TRecord>(
      table: string,
      entity: TRecord
    ): Promise<OperationResult<{ status: number; headers: Record<string, string>; entity?: TResult; entityId?: string }>> => {
      if (table === 'solutions') {
        return ok(
          {
            status: 204,
            headers: {},
            entityId: 'sol-created',
            entity: {
              solutionid: 'sol-created',
              uniquename: entity.uniquename,
              friendlyname: entity.friendlyname,
              version: entity.version,
            } as TResult,
          },
          {
            supportTier: 'preview',
          }
        );
      }

      return ok(
        {
          status: 204,
          headers: {},
        },
        {
          supportTier: 'preview',
        }
      );
    },
    update: async <TRecord extends Record<string, unknown>, TResult = TRecord>(
      table: string,
      id: string,
      entity: TRecord
    ): Promise<OperationResult<{ status: number; headers: Record<string, string>; entity?: TResult; entityId?: string }>> => {
      if (table === 'solutions') {
        return ok(
          {
            status: 200,
            headers: {},
            entityId: id,
            entity: {
              solutionid: id,
              uniquename: data.solution.uniquename,
              friendlyname: data.solution.friendlyname,
              version: entity.version ?? data.solution.version,
            } as TResult,
          },
          {
            supportTier: 'preview',
          }
        );
      }

      return ok(
        {
          status: 204,
          headers: {},
        },
        {
          supportTier: 'preview',
        }
      );
    },
    delete: async (table: string, id: string) => {
      if (table === 'solutions' && data.solution.solutionid === id) {
        return ok(
          {
            status: 204,
            headers: {},
            entityId: id,
          },
          {
            supportTier: 'preview',
          }
        );
      }

      return ok(
        {
          status: 204,
          headers: {},
          entityId: id,
        },
        {
          supportTier: 'preview',
        }
      );
    },
    requestJson: async <T>(options: { path: string; body?: Record<string, unknown> }): Promise<OperationResult<T>> => {
      data.requestRecorder?.push({
        path: options.path,
        body: options.body,
      });

      if (options.path === 'ExportSolution') {
        return ok(
          {
            ExportSolutionFile: data.exportPayloadBase64 ?? Buffer.from('solution-zip').toString('base64'),
          } as T,
          {
            supportTier: 'preview',
          }
        );
      }

      return ok({} as T, {
        supportTier: 'preview',
      });
    },
    request: async (options: { path: string; body?: Record<string, unknown> }) => {
      data.requestRecorder?.push({
        path: options.path,
        body: options.body,
      });

      return ok(
        {
          status: 204,
          headers: {},
          data: undefined,
        },
        {
          supportTier: 'preview',
        }
      );
    },
  } as unknown as DataverseClient;
}

function createStubCommandRunner(
  handler: (invocation: SolutionCommandInvocation) => Promise<void> | void
): { invocations: SolutionCommandInvocation[]; run: (invocation: SolutionCommandInvocation) => Promise<OperationResult<SolutionCommandResult>> } {
  const invocations: SolutionCommandInvocation[] = [];

  return {
    invocations,
    async run(invocation) {
      invocations.push(invocation);
      await handler(invocation);

      return ok(
        {
          ...invocation,
          exitCode: 0,
          stdout: '',
          stderr: '',
        },
        {
          supportTier: 'preview',
        }
      );
    },
  };
}

describe('SolutionService', () => {
  it('lists components and flags missing dependencies', async () => {
    const service = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          version: '1.0.0.0',
        },
        components: [
          {
            solutioncomponentid: 'comp-1',
            objectid: 'obj-1',
            componenttype: 80,
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
        dependencies: [
          {
            dependencyid: 'dep-1',
            dependentcomponentobjectid: 'obj-1',
            dependentcomponenttype: 80,
            requiredcomponentobjectid: 'obj-missing',
            requiredcomponenttype: 24,
          },
        ],
      })
    );

    const components = await service.components('Core');
    const dependencies = await service.dependencies('Core');

    expect(components.success).toBe(true);
    expect(components.data?.[0]).toMatchObject({
      componentTypeLabel: 'app-module',
    });
    expect(dependencies.success).toBe(true);
    expect(dependencies.data?.[0]).toMatchObject({
      missingRequiredComponent: true,
      requiredComponentTypeLabel: 'form',
    });
  });

  it('analyzes missing config and dependency blockers', async () => {
    const service = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          version: '1.0.0.0',
        },
        components: [
          {
            solutioncomponentid: 'comp-1',
            objectid: 'obj-1',
            componenttype: 80,
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
        dependencies: [
          {
            dependencyid: 'dep-1',
            dependentcomponentobjectid: 'obj-1',
            dependentcomponenttype: 80,
            requiredcomponentobjectid: 'obj-missing',
            requiredcomponenttype: 24,
          },
        ],
        connectionReferences: [
          {
            connectionreferenceid: 'ref-1',
            connectionreferencelogicalname: 'pp_shared',
            _solutionid_value: 'sol-1',
          },
        ],
        environmentVariableDefinitions: [
          {
            environmentvariabledefinitionid: 'env-1',
            schemaname: 'pp_ApiUrl',
            _solutionid_value: 'sol-1',
          },
        ],
        environmentVariableValues: [],
      })
    );

    const result = await service.analyze('Core');

    expect(result.success).toBe(true);
    expect(result.data?.missingDependencies).toHaveLength(1);
    expect(result.data?.invalidConnectionReferences).toHaveLength(1);
    expect(result.data?.missingEnvironmentVariables).toHaveLength(1);
  });

  it('compares the same solution across environments', async () => {
    const source = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          version: '1.0.0.0',
        },
        components: [
          {
            solutioncomponentid: 'comp-1',
            objectid: 'obj-1',
            componenttype: 80,
          },
          {
            solutioncomponentid: 'comp-2',
            objectid: 'obj-2',
            componenttype: 62,
          },
        ],
        dependencies: [],
        connectionReferences: [],
        environmentVariableDefinitions: [],
        environmentVariableValues: [],
      })
    );
    const target = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-2',
          uniquename: 'Core',
          version: '2.0.0.0',
        },
        components: [
          {
            solutioncomponentid: 'comp-1',
            objectid: 'obj-1',
            componenttype: 80,
          },
        ],
        dependencies: [],
        connectionReferences: [],
        environmentVariableDefinitions: [],
        environmentVariableValues: [],
      })
    );

    const result = await source.compare('Core', target);

    expect(result.success).toBe(true);
    expect(result.data?.drift.versionChanged).toBe(true);
    expect(result.data?.drift.componentsOnlyInSource).toHaveLength(1);
    expect(result.data?.drift.componentsOnlyInTarget).toHaveLength(0);
  });

  it('creates a solution through the solutions entity set', async () => {
    const service = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          version: '1.0.0.0',
        },
        publishers: [
          {
            publisherid: 'pub-1',
            uniquename: 'DefaultPublisher',
          },
        ],
        components: [],
        dependencies: [],
      })
    );

    const result = await service.create('HarnessShell', {
      friendlyName: 'Harness Shell',
      publisherUniqueName: 'DefaultPublisher',
      description: 'Disposable harness solution',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      solutionid: 'sol-created',
      uniquename: 'HarnessShell',
      friendlyname: 'Harness Shell',
      version: '1.0.0.0',
    });
  });

  it('updates solution version and publisher through a first-class metadata flow', async () => {
    const service = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'HarnessShell',
          friendlyname: 'Harness Shell',
          version: '1.0.0.0',
        },
        publishers: [
          {
            publisherid: 'pub-1',
            uniquename: 'HarnessPublisher',
          },
        ],
        components: [],
        dependencies: [],
      })
    );

    const result = await service.setMetadata('HarnessShell', {
      version: '2026.3.10.34135',
      publisherUniqueName: 'HarnessPublisher',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      solutionid: 'sol-1',
      uniquename: 'HarnessShell',
      friendlyname: 'Harness Shell',
      version: '2026.3.10.34135',
    });
  });

  it('deletes a solution through the solutions entity set', async () => {
    const service = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'HarnessShell',
          friendlyname: 'Harness Shell',
          version: '1.0.0.0',
        },
        components: [],
        dependencies: [],
      })
    );

    const result = await service.delete('HarnessShell');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      removed: true,
      solution: {
        solutionid: 'sol-1',
        uniquename: 'HarnessShell',
      },
    });
  });

  it('exports a solution package and writes a release manifest', async () => {
    const tempDir = await createTempDir();
    const requests: Array<{ path: string; body: Record<string, unknown> | undefined }> = [];
    const service = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          friendlyname: 'Core Solution',
          version: '1.2.3.4',
        },
        components: [
          {
            solutioncomponentid: 'comp-1',
            objectid: 'obj-1',
            componenttype: 80,
          },
        ],
        dependencies: [],
        connectionReferences: [],
        environmentVariableDefinitions: [],
        environmentVariableValues: [],
        exportPayloadBase64: Buffer.from('solution-zip-content').toString('base64'),
        requestRecorder: requests,
      })
    );

    const result = await service.exportSolution('Core', {
      outDir: tempDir,
    });

    expect(result.success).toBe(true);
    expect(requests[0]).toEqual({
      path: 'ExportSolution',
      body: {
        SolutionName: 'Core',
        Managed: false,
      },
    });
    expect(result.data?.artifact.path).toBe(join(tempDir, 'Core_unmanaged.zip'));
    expect(await readFile(result.data!.artifact.path, 'utf8')).toBe('solution-zip-content');
    expect(result.data?.manifest).toMatchObject({
      kind: 'pp-solution-release',
      solution: {
        uniqueName: 'Core',
        version: '1.2.3.4',
        packageType: 'unmanaged',
      },
      analysis: {
        componentCount: 1,
      },
    });
    expect(result.data?.manifestPath).toBe(join(tempDir, 'Core_unmanaged.pp-solution.json'));
  });

  it('imports a solution package through the Dataverse action', async () => {
    const tempDir = await createTempDir();
    const packagePath = join(tempDir, 'Core_managed.zip');
    const manifestPath = join(tempDir, 'Core_managed.pp-solution.json');
    const requests: Array<{ path: string; body: Record<string, unknown> | undefined }> = [];

    await writeFile(packagePath, 'managed-content', 'utf8');
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'pp-solution-release',
        generatedAt: '2026-03-10T00:00:00.000Z',
        solution: {
          uniqueName: 'Core',
          version: '2.0.0.0',
          packageType: 'managed',
        },
        files: [],
      }),
      'utf8'
    );

    const service = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
        },
        components: [],
        dependencies: [],
        requestRecorder: requests,
      })
    );

    const result = await service.importSolution(packagePath, {
      overwriteUnmanagedCustomizations: true,
    });

    expect(result.success).toBe(true);
    expect(requests[0]?.path).toBe('ImportSolution');
    expect(requests[0]?.body).toMatchObject({
      OverwriteUnmanagedCustomizations: true,
      PublishWorkflows: true,
      HoldingSolution: false,
      SkipProductUpdateDependencies: false,
      CustomizationFile: Buffer.from('managed-content').toString('base64'),
    });
    expect(result.data?.packageType).toBe('managed');
    expect(result.data?.manifest?.solution.uniqueName).toBe('Core');
  });

  it('packs and unpacks solution artifacts through the command runner seam', async () => {
    const tempDir = await createTempDir();
    const sourceFolder = join(tempDir, 'src');
    const packagePath = join(tempDir, 'packed.zip');
    const unpackDir = join(tempDir, 'unpacked');
    await writeFile(join(tempDir, 'placeholder.txt'), 'placeholder', 'utf8');
    const runner = createStubCommandRunner(async (invocation) => {
      if (invocation.args[1] === 'pack') {
        await writeFile(packagePath, 'packed-content', 'utf8');
      }

      if (invocation.args[1] === 'unpack') {
        await writeFile(join(unpackDir, 'Other.xml'), '<ImportExportXml />', 'utf8');
      }
    });
    const service = new SolutionService(createStubClient({
      solution: {
        solutionid: 'sol-1',
        uniquename: 'Core',
      },
      components: [],
      dependencies: [],
    }), {
      commandRunner: runner,
    });

    const packResult = await service.pack(sourceFolder, {
      outPath: packagePath,
      packageType: 'managed',
      pacExecutable: '/tmp/fake-pac',
    });
    const unpackResult = await service.unpack(packagePath, {
      outDir: unpackDir,
      packageType: 'both',
      pacExecutable: '/tmp/fake-pac',
      allowDelete: true,
    });

    expect(packResult.success).toBe(true);
    expect(unpackResult.success).toBe(true);
    expect(runner.invocations).toEqual([
      {
        executable: '/tmp/fake-pac',
        args: ['solution', 'pack', '--folder', sourceFolder, '--zipfile', packagePath, '--packagetype', 'Managed'],
        cwd: undefined,
      },
      {
        executable: '/tmp/fake-pac',
        args: ['solution', 'unpack', '--zipfile', packagePath, '--folder', unpackDir, '--packagetype', 'Both', '--allowDelete', 'true'],
        cwd: undefined,
      },
    ]);
    expect(packResult.data?.artifact.bytes).toBeGreaterThan(0);
    expect(unpackResult.data?.unpackedRoot.path).toBe(unpackDir);
  });

  it('analyzes unpacked local solution artifacts and compares file drift', async () => {
    const tempDir = await createTempDir();
    const sourceDir = join(tempDir, 'source');
    const targetDir = join(tempDir, 'target');
    await mkdir(sourceDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(sourceDir, 'Other.xml'), '<ImportExportXml><SolutionManifest><UniqueName>Core</UniqueName><Version>1.0.0.0</Version></SolutionManifest></ImportExportXml>', 'utf8');
    await writeFile(join(sourceDir, 'customizations.xml'), '<Source />', 'utf8');
    await writeFile(join(targetDir, 'Other.xml'), '<ImportExportXml><SolutionManifest><UniqueName>Core</UniqueName><Version>1.1.0.0</Version></SolutionManifest></ImportExportXml>', 'utf8');
    await writeFile(join(targetDir, 'customizations.xml'), '<Target />', 'utf8');
    await writeFile(join(targetDir, 'extra.txt'), 'target-only', 'utf8');

    const service = new SolutionService(createStubClient({
      solution: {
        solutionid: 'sol-1',
        uniquename: 'Core',
      },
      components: [],
      dependencies: [],
    }));

    const source = await service.analyzeArtifact({
      unpackedPath: sourceDir,
    });
    const target = await service.analyzeArtifact({
      unpackedPath: targetDir,
    });
    const compare = service.compareLocal('Core', source.data!, target.data!);

    expect(source.success).toBe(true);
    expect(source.data).toMatchObject({
      solution: {
        uniquename: 'Core',
        version: '1.0.0.0',
      },
      origin: {
        kind: 'unpacked',
        path: sourceDir,
      },
    });
    expect(compare.success).toBe(true);
    expect(compare.data?.drift.versionChanged).toBe(true);
    expect(compare.data?.drift.changedArtifacts).toHaveLength(2);
    expect(compare.data?.drift.artifactsOnlyInTarget).toHaveLength(1);
  });

  it('analyzes solution packages through the existing PAC unpack seam', async () => {
    const tempDir = await createTempDir();
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
          version: '2.0.0.0',
          packageType: 'managed',
        },
        files: [],
      }),
      'utf8'
    );
    const runner = createStubCommandRunner(async (invocation) => {
      if (invocation.args[1] === 'unpack') {
        const folder = invocation.args[invocation.args.indexOf('--folder') + 1]!;
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, 'Other.xml'), '<ImportExportXml />', 'utf8');
      }
    });
    const service = new SolutionService(createStubClient({
      solution: {
        solutionid: 'sol-1',
        uniquename: 'Core',
      },
      components: [],
      dependencies: [],
    }), {
      commandRunner: runner,
    });

    const result = await service.analyzeArtifact({
      packagePath,
      pacExecutable: '/tmp/fake-pac',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      solution: {
        uniquename: 'Core',
        friendlyname: 'Core Solution',
        version: '2.0.0.0',
      },
      origin: {
        kind: 'zip',
        path: packagePath,
      },
    });
    expect(runner.invocations[0]).toMatchObject({
      executable: '/tmp/fake-pac',
      args: expect.arrayContaining(['solution', 'unpack', '--zipfile', packagePath]),
    });
  });
});
