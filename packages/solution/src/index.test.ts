import { describe, expect, it } from 'vitest';
import { ok, type OperationResult } from '@pp/diagnostics';
import type { DataverseClient } from '@pp/dataverse';
import { SolutionService } from './index';

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
  } as unknown as DataverseClient;
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
});
