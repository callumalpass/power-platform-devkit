import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ok, type OperationResult } from '@pp/diagnostics';
import type { DataverseClient, EntityDefinition } from '@pp/dataverse';
import { SolutionService, type SolutionCommandInvocation, type SolutionCommandResult, type SolutionPublishProgressEvent } from './index';

interface StubData {
  solution: {
    solutionid: string;
    uniquename: string;
    friendlyname?: string;
    version?: string;
    ismanaged?: boolean;
    _publisherid_value?: string;
    publisherid?: {
      publisherid: string;
      uniquename?: string;
      friendlyname?: string;
      customizationprefix?: string;
      customizationoptionvalueprefix?: number;
    };
  };
  solutions?: Array<{
    solutionid: string;
    uniquename: string;
    friendlyname?: string;
    version?: string;
    ismanaged?: boolean;
  }>;
  publishers?: Array<Record<string, unknown>>;
  components: Array<Record<string, unknown>>;
  dependencies: Array<Record<string, unknown>>;
  connectionReferences?: Array<Record<string, unknown>>;
  environmentVariableDefinitions?: Array<Record<string, unknown>>;
  environmentVariableValues?: Array<Record<string, unknown>>;
  canvasApps?: Array<Record<string, unknown>>;
  workflows?: Array<Record<string, unknown>>;
  webResources?: Array<Record<string, unknown>>;
  sitemaps?: Array<Record<string, unknown>>;
  modelApps?: Array<Record<string, unknown>>;
  modelComponents?: Array<Record<string, unknown>>;
  modelForms?: Array<Record<string, unknown>>;
  modelViews?: Array<Record<string, unknown>>;
  modelSitemaps?: Array<Record<string, unknown>>;
  tables?: EntityDefinition[];
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

async function createSolutionArchive(path: string, managed: boolean): Promise<void> {
  const root = await createTempDir();
  await writeFile(
    join(root, 'Solution.xml'),
    [
      '<ImportExportXml>',
      '  <SolutionManifest>',
      `    <UniqueName>Core</UniqueName>`,
      `    <Version>1.2.3.4</Version>`,
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

function readManagedFlagFromArchive(path: string): string {
  const listResult = spawnSync('unzip', ['-Z1', path], {
    encoding: 'utf8',
  });
  expect(listResult.status).toBe(0);
  const metadataEntry = listResult.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.toLowerCase().endsWith('solution.xml') || entry.toLowerCase().endsWith('other.xml'));
  expect(metadataEntry).toBeTruthy();
  const readResult = spawnSync('unzip', ['-p', path, metadataEntry!], {
    encoding: 'utf8',
  });
  expect(readResult.status).toBe(0);
  const managedMatch = readResult.stdout.match(/<Managed>([^<]+)<\/Managed>/i);
  expect(managedMatch?.[1]).toBeTruthy();
  return managedMatch![1]!;
}

function createStubClient(data: StubData): DataverseClient {
  let currentSolution = structuredClone(data.solution);
  const publishers = structuredClone(data.publishers ?? []);

  return {
    query: async <T>(options: { table: string; filter?: string }): Promise<OperationResult<T[]>> => {
      if (options.table === 'solutions') {
        return ok([currentSolution] as T[], {
          supportTier: 'preview',
        });
      }

      if (options.table === 'publishers') {
        const matchingPublishers = publishers.filter((publisher) => {
          const filter = options.filter;
          if (!filter) {
            return true;
          }

          const match = /uniquename eq '([^']+)'/.exec(filter);
          if (!match) {
            return true;
          }

          return publisher.uniquename === match[1];
        });

        return ok(matchingPublishers as T[], {
          supportTier: 'preview',
        });
      }

      return ok([] as T[], {
        supportTier: 'preview',
      });
    },
    queryAll: async <T>(options: { table: string }): Promise<OperationResult<T[]>> => {
      const appModuleComponentsMatch = options.table.match(/^appmodules\(([^)]+)\)\/appmodule_appmodulecomponent$/);
      if (appModuleComponentsMatch) {
        const appId = appModuleComponentsMatch[1]?.toLowerCase();
        const records = (data.modelComponents ?? []).filter((record) => {
          const componentAppId = [record._appmoduleidunique_value, record.appmoduleidunique]
            .find((value): value is string => typeof value === 'string')
            ?.toLowerCase();
          return componentAppId === appId;
        });
        return ok(records as T[], { supportTier: 'preview' });
      }

      switch (options.table) {
        case 'solutions':
          return ok((data.solutions ?? [currentSolution]) as T[], { supportTier: 'preview' });
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
        case 'canvasapps':
          return ok((data.canvasApps ?? []) as T[], { supportTier: 'preview' });
        case 'workflows':
          return ok((data.workflows ?? []) as T[], { supportTier: 'preview' });
        case 'webresourceset':
          return ok((data.webResources ?? []) as T[], { supportTier: 'preview' });
        case 'sitemaps':
          return ok((data.sitemaps ?? data.modelSitemaps ?? []) as T[], { supportTier: 'preview' });
        case 'appmodules':
          return ok((data.modelApps ?? []) as T[], { supportTier: 'preview' });
        case 'appmodulecomponents':
          return ok((data.modelComponents ?? []) as T[], { supportTier: 'preview' });
        case 'systemforms':
          return ok((data.modelForms ?? []) as T[], { supportTier: 'preview' });
        case 'savedqueries':
          return ok((data.modelViews ?? []) as T[], { supportTier: 'preview' });
        default:
          return ok([] as T[], { supportTier: 'preview' });
      }
    },
    getById: async <T>(table: string, id: string): Promise<OperationResult<T>> => {
      if (table === 'publishers') {
        const publisher = publishers.find((candidate) => candidate.publisherid === id);
        return ok((publisher ?? {}) as T, {
          supportTier: 'preview',
        });
      }

      return ok({} as T, {
        supportTier: 'preview',
      });
    },
    listTables: async (): Promise<OperationResult<EntityDefinition[]>> =>
      ok(data.tables ?? [], {
        supportTier: 'preview',
      }),
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
        const publisherBind = entity['publisherid@odata.bind'];
        const publisherId =
          typeof publisherBind === 'string' ? /^\/publishers\(([^)]+)\)$/.exec(publisherBind)?.[1] : undefined;
        const expandedPublisher =
          typeof publisherId === 'string'
            ? (publishers.find((publisher) => publisher.publisherid === publisherId) as StubData['solution']['publisherid'] | undefined)
            : currentSolution.publisherid;
        currentSolution = {
          ...currentSolution,
          ...entity,
          solutionid: id,
          version: (entity.version as string | undefined) ?? currentSolution.version,
          _publisherid_value: publisherId ?? currentSolution._publisherid_value,
          publisherid: expandedPublisher,
        };

        return ok(
          {
            status: 200,
            headers: {},
            entityId: id,
            entity: {
              solutionid: id,
              uniquename: currentSolution.uniquename,
              friendlyname: currentSolution.friendlyname,
              version: currentSolution.version,
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
    invokeAction: async <T>(name: string, parameters?: Record<string, unknown>): Promise<OperationResult<{ status: number; headers: Record<string, string>; body?: T }>> => {
      data.requestRecorder?.push({
        path: name,
        body: parameters,
      });

      if (name === 'ExportSolution') {
        return ok(
          {
            status: 200,
            headers: {},
            body: {
              ExportSolutionFile: data.exportPayloadBase64 ?? Buffer.from('solution-zip').toString('base64'),
            } as T,
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
          body: {} as T,
        },
        {
          supportTier: 'preview',
        }
      );
    },
    request: async () => {
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
    requestJson: async <T>() =>
      ok({} as T, {
        supportTier: 'preview',
      }),
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
  it('inspects a solution with inline publisher metadata when Dataverse expands the lookup', async () => {
    const service = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          friendlyname: 'Core Solution',
          version: '1.0.1.0',
          ismanaged: false,
          publisherid: {
            publisherid: 'pub-1',
            uniquename: 'pp',
            friendlyname: 'Power Platform Publisher',
            customizationprefix: 'pp',
            customizationoptionvalueprefix: 12560,
          },
        },
        components: [],
        dependencies: [],
      })
    );

    const inspect = await service.inspect('Core');

    expect(inspect.success).toBe(true);
    expect(inspect.data).toMatchObject({
      solutionid: 'sol-1',
      uniquename: 'Core',
      ismanaged: false,
      publisher: {
        publisherid: 'pub-1',
        uniquename: 'pp',
        customizationprefix: 'pp',
        customizationoptionvalueprefix: 12560,
      },
    });
  });

  it('falls back to fetching publisher metadata when the solution row only exposes the lookup id', async () => {
    const service = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          friendlyname: 'Core Solution',
          version: '1.0.1.0',
          ismanaged: false,
          _publisherid_value: 'pub-1',
        },
        publishers: [
          {
            publisherid: 'pub-1',
            uniquename: 'pp',
            friendlyname: 'Power Platform Publisher',
            customizationprefix: 'pp',
            customizationoptionvalueprefix: 12560,
          },
        ],
        components: [],
        dependencies: [],
      })
    );

    const inspect = await service.inspect('Core');

    expect(inspect.success).toBe(true);
    expect(inspect.data).toMatchObject({
      solutionid: 'sol-1',
      uniquename: 'Core',
      publisher: {
        publisherid: 'pub-1',
        uniquename: 'pp',
        customizationprefix: 'pp',
        customizationoptionvalueprefix: 12560,
      },
    });
  });

  it('uses a direct publisher lookup by id when inspect only has the solution lookup column', async () => {
    const publisherLookups: string[] = [];
    const baseClient = createStubClient({
      solution: {
        solutionid: 'sol-1',
        uniquename: 'Core',
        friendlyname: 'Core Solution',
        version: '1.0.1.0',
        _publisherid_value: 'pub-1',
      },
      publishers: [
        {
          publisherid: 'pub-1',
          uniquename: 'pp',
          friendlyname: 'Power Platform Publisher',
          customizationprefix: 'pp',
          customizationoptionvalueprefix: 12560,
        },
      ],
      components: [],
      dependencies: [],
    });
    const service = new SolutionService(
      {
        ...baseClient,
        query: async <T>(options: { table: string }): Promise<OperationResult<T[]>> => {
          if (options.table === 'publishers') {
            return ok([] as T[], { supportTier: 'preview' });
          }

          return baseClient.query(options);
        },
        getById: async <T>(table: string, id: string): Promise<OperationResult<T>> => {
          publisherLookups.push(`${table}:${id}`);
          return ok(
            {
              publisherid: 'pub-1',
              uniquename: 'pp',
              friendlyname: 'Power Platform Publisher',
              customizationprefix: 'pp',
              customizationoptionvalueprefix: 12560,
            } as T,
            { supportTier: 'preview' }
          );
        },
      } as DataverseClient
    );

    const inspect = await service.inspect('Core');

    expect(inspect.success).toBe(true);
    expect(publisherLookups).toEqual(['publishers:pub-1']);
    expect(inspect.data).toMatchObject({
      solutionid: 'sol-1',
      uniquename: 'Core',
      publisher: {
        publisherid: 'pub-1',
        uniquename: 'pp',
        customizationprefix: 'pp',
      },
    });
  });

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
            objectid: 'canvas-1',
            componenttype: 300,
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
            requiredcomponentobjectid: 'entity-1',
            requiredcomponenttype: 1,
          },
          {
            dependencyid: 'dep-2',
            dependentcomponentobjectid: 'obj-1',
            dependentcomponenttype: 80,
            requiredcomponentobjectid: 'webres-1',
            requiredcomponenttype: 61,
          },
          {
            dependencyid: 'dep-3',
            dependentcomponentobjectid: 'canvas-1',
            dependentcomponenttype: 300,
            requiredcomponentobjectid: 'site-1',
            requiredcomponenttype: 62,
          },
        ],
        canvasApps: [
          {
            canvasappid: 'canvas-1',
            displayname: 'Shell App',
            name: 'ShellApp',
          },
        ],
        modelApps: [
          {
            appmoduleid: 'obj-1',
            uniquename: 'Core',
            name: 'Core',
          },
        ],
        webResources: [
          {
            webresourceid: 'webres-1',
            name: 'pp_/icons/nav.svg',
            displayname: 'Navigation Icon',
          },
        ],
        sitemaps: [
          {
            sitemapid: 'site-1',
            sitemapname: 'Sales Hub sitemap',
          },
        ],
        tables: [
          {
            MetadataId: 'entity-1',
            LogicalName: 'account',
            SchemaName: 'Account',
            DisplayName: {
              UserLocalizedLabel: {
                Label: 'Account',
              },
            },
          },
        ],
      })
    );

    const dependencies = await service.dependencies('Core');

    expect(dependencies.success).toBe(true);
    expect(dependencies.data).toEqual([
      expect.objectContaining({
        missingRequiredComponent: true,
        requiredComponentTypeLabel: 'entity',
        requiredComponentName: 'Account',
        requiredComponentLogicalName: 'account',
        requiredComponentTable: 'account',
        dependentComponentTypeLabel: 'app-module',
      }),
      expect.objectContaining({
        missingRequiredComponent: true,
        requiredComponentTypeLabel: 'web-resource',
        requiredComponentName: 'Navigation Icon',
        requiredComponentLogicalName: 'pp_/icons/nav.svg',
        dependentComponentName: 'Core',
      }),
      expect.objectContaining({
        missingRequiredComponent: true,
        requiredComponentTypeLabel: 'site-map',
        requiredComponentName: 'Sales Hub sitemap',
        dependentComponentTypeLabel: 'canvas-app',
        dependentComponentName: 'Shell App',
        dependentComponentLogicalName: 'ShellApp',
      }),
    ]);
  });

  it('lists all solution pages and can narrow results by prefix or unique name', async () => {
    const service = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          version: '1.0.0.0',
        },
        solutions: [
          {
            solutionid: 'sol-1',
            uniquename: 'Core',
            friendlyname: 'Core Solution',
            version: '1.0.0.0',
          },
          {
            solutionid: 'sol-2',
            uniquename: 'ppHarness20260310T200706248Z',
            friendlyname: 'PP Harness 20260310T200706248Z',
            version: '26.3.10.2007',
          },
          {
            solutionid: 'sol-3',
            uniquename: 'AnotherSolution',
            friendlyname: 'Another Solution',
            version: '1.2.3.4',
          },
        ],
        components: [],
        dependencies: [],
      })
    );

    const prefixed = await service.list({ prefix: 'ppHarness20260310T200706248Z' });
    const exact = await service.list({ uniqueName: 'Core' });

    expect(prefixed.success).toBe(true);
    expect(prefixed.data).toEqual([
      expect.objectContaining({
        solutionid: 'sol-2',
        uniquename: 'ppHarness20260310T200706248Z',
      }),
    ]);

    expect(exact.success).toBe(true);
    expect(exact.data).toEqual([
      expect.objectContaining({
        solutionid: 'sol-1',
        uniquename: 'Core',
      }),
    ]);
  });

  it('pushes solution list prefix filters down to the Dataverse query and requests exportability metadata', async () => {
    const queryAllCalls: Array<{ table: string; filter?: string; select?: string[] }> = [];
    const service = new SolutionService({
      query: async <T>(): Promise<OperationResult<T[]>> => ok([] as T[], { supportTier: 'preview' }),
      queryAll: async <T>(options: { table: string; filter?: string; select?: string[] }): Promise<OperationResult<T[]>> => {
        queryAllCalls.push(options);
        return ok(
          [
            {
              solutionid: 'sol-harness',
              uniquename: 'ppHarness20260310T233219225Z',
              friendlyname: 'PP Harness 20260310T233219225Z',
              version: '1.0.0.0',
              ismanaged: false,
            },
          ] as T[],
          { supportTier: 'preview' }
        );
      },
    } as unknown as DataverseClient);

    const result = await service.list({ prefix: 'ppHarness20260310T233219225Z' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      expect.objectContaining({
        uniquename: 'ppHarness20260310T233219225Z',
      }),
    ]);
    expect(queryAllCalls).toEqual([
      expect.objectContaining({
        table: 'solutions',
        select: ['solutionid', 'uniquename', 'friendlyname', 'version', 'ismanaged'],
        filter: "(startswith(uniquename,'ppHarness20260310T233219225Z') or startswith(friendlyname,'ppHarness20260310T233219225Z'))",
      }),
    ]);
  });

  it('falls back to a full scan when the filtered Dataverse query misses a case-insensitive prefix match', async () => {
    const queryAllCalls: Array<{ table: string; filter?: string }> = [];
    const service = new SolutionService({
      query: async <T>(): Promise<OperationResult<T[]>> => ok([] as T[], { supportTier: 'preview' }),
      queryAll: async <T>(options: { table: string; filter?: string }): Promise<OperationResult<T[]>> => {
        queryAllCalls.push(options);

        if (options.filter) {
          return ok([] as T[], { supportTier: 'preview' });
        }

        return ok(
          [
            {
              solutionid: 'sol-harness',
              uniquename: 'ppHarness20260310T233219225Z',
              friendlyname: 'PP Harness 20260310T233219225Z',
              version: '1.0.0.0',
            },
          ] as T[],
          { supportTier: 'preview' }
        );
      },
    } as unknown as DataverseClient);

    const result = await service.list({ prefix: 'ppharness20260310t233219225z' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      expect.objectContaining({
        uniquename: 'ppHarness20260310T233219225Z',
      }),
    ]);
    expect(queryAllCalls).toEqual([
      expect.objectContaining({
        table: 'solutions',
        filter: "(startswith(uniquename,'ppharness20260310t233219225z') or startswith(friendlyname,'ppharness20260310t233219225z'))",
      }),
      expect.objectContaining({
        table: 'solutions',
      }),
    ]);
  });

  it('fails components when the target solution does not exist', async () => {
    const service = new SolutionService({
      query: async <T>(options: { table: string }): Promise<OperationResult<T[]>> =>
        ok((options.table === 'solutions' ? [] : []) as T[], {
          supportTier: 'preview',
        }),
      queryAll: async <T>(): Promise<OperationResult<T[]>> =>
        ok([] as T[], {
          supportTier: 'preview',
        }),
    } as unknown as DataverseClient);

    const components = await service.components('MissingSolution');

    expect(components.success).toBe(false);
    expect(components.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SOLUTION_NOT_FOUND',
          message: 'Solution MissingSolution was not found.',
          source: '@pp/solution',
        }),
      ])
    );
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
        modelApps: [
          {
            appmoduleid: 'obj-1',
            uniquename: 'SalesHub',
            name: 'Sales Hub',
          },
        ],
        modelComponents: [
          {
            appmodulecomponentid: 'model-comp-app-table',
            componenttype: 1,
            objectid: 'entity-1',
            _appmoduleidunique_value: 'obj-1',
          },
          {
            appmodulecomponentid: 'model-comp-app-form',
            componenttype: 60,
            objectid: 'form-1',
            _appmoduleidunique_value: 'obj-1',
          },
        ],
        modelForms: [
          {
            formid: 'form-1',
            name: 'Account Main',
            objecttypecode: 'account',
            type: 2,
          },
        ],
        tables: [
          {
            MetadataId: 'entity-1',
            LogicalName: 'account',
            SchemaName: 'Account',
            DisplayName: {
              UserLocalizedLabel: {
                Label: 'Account',
              },
            },
          },
        ],
      })
    );

    const result = await service.analyze('Core');

    expect(result.success).toBe(true);
    expect(result.data?.missingDependencies).toHaveLength(1);
    expect(result.data?.invalidConnectionReferences).toHaveLength(1);
    expect(result.data?.missingEnvironmentVariables).toHaveLength(1);
    expect(result.data?.modelDriven.summary).toMatchObject({
      appCount: 1,
      artifactCount: 3,
      missingArtifactCount: 0,
    });
  });

  it('adds an explicit hint for unknown dependency component types', async () => {
    const client = createStubClient({
      solution: {
        solutionid: 'solution-1',
        uniquename: 'Harness',
        friendlyname: 'Harness',
        version: '1.0.0.0',
      },
      components: [
        {
          solutioncomponentid: 'component-1',
          objectid: 'workflow-1',
          componenttype: 29,
        },
      ],
      dependencies: [
        {
          dependencyid: 'dep-unknown',
          requiredcomponentobjectid: 'missing-1',
          requiredcomponenttype: 10154,
          dependentcomponentobjectid: 'workflow-1',
          dependentcomponenttype: 29,
        },
      ],
    });
    const service = new SolutionService(client);

    const result = await service.dependencies('Harness');

    expect(result.success).toBe(true);
    expect(result.data?.[0]).toMatchObject({
      requiredComponentTypeLabel: 'component-10154',
      requiredComponentTypeHint:
        'Unknown Dataverse solution component type 10154. Inspect the dependency in Maker or solution component metadata to identify the blocker.',
    });
  });

  it('skips model composition during analyze when the app still has unresolved solution dependencies', async () => {
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
            objectid: 'app-1',
            componenttype: 80,
          },
        ],
        dependencies: [
          {
            dependencyid: 'dep-1',
            dependentcomponentobjectid: 'app-1',
            dependentcomponenttype: 80,
            requiredcomponentobjectid: 'missing-site-map',
            requiredcomponenttype: 62,
          },
        ],
        connectionReferences: [],
        environmentVariableDefinitions: [],
        environmentVariableValues: [],
        modelApps: [
          {
            appmoduleid: 'app-1',
            uniquename: 'SalesHub',
            name: 'Sales Hub',
          },
        ],
        modelComponents: [
          {
            appmodulecomponentid: 'model-comp-app-table',
            componenttype: 1,
            objectid: 'entity-1',
            _appmoduleidunique_value: 'app-1',
          },
        ],
        tables: [
          {
            MetadataId: 'entity-1',
            LogicalName: 'account',
            SchemaName: 'Account',
            DisplayName: {
              UserLocalizedLabel: {
                Label: 'Account',
              },
            },
          },
        ],
      })
    );

    const result = await service.analyze('Core');

    expect(result.success).toBe(true);
    expect(result.data?.modelDriven.apps).toEqual([
      {
        appId: 'app-1',
        uniqueName: 'SalesHub',
        name: 'Sales Hub',
        compositionSkippedReason: 'Skipped model composition because the app still has unresolved solution dependencies.',
      },
    ]);
    expect(result.data?.modelDriven.summary).toMatchObject({
      appCount: 1,
      artifactCount: 0,
      missingArtifactCount: 0,
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SOLUTION_MODEL_ANALYZE_SKIPPED_UNRESOLVED_DEPENDENCIES',
        }),
      ])
    );
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
        modelApps: [
          {
            appmoduleid: 'obj-1',
            uniquename: 'SalesHub',
            name: 'Sales Hub',
          },
        ],
        modelComponents: [
          {
            appmodulecomponentid: 'src-model-table',
            componenttype: 1,
            objectid: 'entity-1',
            _appmoduleidunique_value: 'obj-1',
          },
          {
            appmodulecomponentid: 'src-model-form',
            componenttype: 60,
            objectid: 'form-1',
            _appmoduleidunique_value: 'obj-1',
          },
        ],
        modelForms: [
          {
            formid: 'form-1',
            name: 'Account Main',
            objecttypecode: 'account',
            type: 2,
          },
        ],
        tables: [
          {
            MetadataId: 'entity-1',
            LogicalName: 'account',
            SchemaName: 'Account',
            DisplayName: {
              UserLocalizedLabel: {
                Label: 'Account',
              },
            },
          },
        ],
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
        modelApps: [
          {
            appmoduleid: 'obj-1',
            uniquename: 'SalesHub',
            name: 'Sales Hub',
          },
        ],
        modelComponents: [
          {
            appmodulecomponentid: 'tgt-model-table',
            componenttype: 1,
            objectid: 'entity-1',
            _appmoduleidunique_value: 'obj-1',
          },
          {
            appmodulecomponentid: 'tgt-model-view',
            componenttype: 26,
            objectid: 'view-1',
            _appmoduleidunique_value: 'obj-1',
          },
        ],
        modelViews: [
          {
            savedqueryid: 'view-1',
            name: 'Active Accounts',
            returnedtypecode: 'account',
            querytype: 0,
          },
        ],
        tables: [
          {
            MetadataId: 'entity-1',
            LogicalName: 'account',
            SchemaName: 'Account',
            DisplayName: {
              UserLocalizedLabel: {
                Label: 'Account',
              },
            },
          },
        ],
      })
    );

    const result = await source.compare('Core', target);

    expect(result.success).toBe(true);
    expect(result.data?.drift.versionChanged).toBe(true);
    expect(result.data?.drift.componentsOnlyInSource).toHaveLength(1);
    expect(result.data?.drift.componentsOnlyInTarget).toHaveLength(0);
    expect(result.data?.drift.modelDriven.changedApps).toEqual([
      expect.objectContaining({
        uniqueName: 'SalesHub',
        artifactsOnlyInSource: ['form:form-1'],
        artifactsOnlyInTarget: ['view:view-1'],
      }),
    ]);
  });

  it('can skip model composition during analysis for faster compare flows', async () => {
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
        ],
        dependencies: [],
        connectionReferences: [],
        environmentVariableDefinitions: [],
        environmentVariableValues: [],
        modelApps: [
          {
            appmoduleid: 'obj-1',
            uniquename: 'SalesHub',
            name: 'Sales Hub',
          },
        ],
      })
    );

    const result = await service.analyze('Core', { includeModelComposition: false });

    expect(result.success).toBe(true);
    expect(result.data?.modelDriven.apps).toEqual([
      {
        appId: 'obj-1',
        uniqueName: 'SalesHub',
        name: 'Sales Hub',
        compositionSkippedReason:
          'Skipped model composition during solution compare; rerun with --include-model-composition for app-level artifact drift.',
      },
    ]);
    expect(result.data?.modelDriven.summary).toEqual({
      appCount: 1,
      artifactCount: 0,
      missingArtifactCount: 0,
    });
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

  it('surfaces available publishers when solution creation omits a publisher', async () => {
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
            friendlyname: 'Default Publisher',
          },
          {
            publisherid: 'pub-2',
            uniquename: 'pp',
            friendlyname: 'Power Platform',
          },
        ],
        components: [],
        dependencies: [],
      })
    );

    const result = await service.create('HarnessShell');

    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SOLUTION_PUBLISHER_REQUIRED',
          message: 'A publisher is required. Use --publisher-id or --publisher-unique-name.',
          detail: expect.stringContaining('DefaultPublisher'),
        }),
      ])
    );
    expect(result.suggestedNextActions).toEqual(
      expect.arrayContaining([
        'Retry with `pp solution create HarnessShell --environment <alias> --publisher-unique-name DefaultPublisher`.',
        'Retry with `pp solution create HarnessShell --environment <alias> --publisher-unique-name pp`.',
      ])
    );
  });

  it('surfaces available publishers when the requested publisher unique name does not exist', async () => {
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
            friendlyname: 'Default Publisher',
          },
        ],
        components: [],
        dependencies: [],
      })
    );

    const result = await service.create('HarnessShell', {
      publisherUniqueName: 'MissingPublisher',
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SOLUTION_PUBLISHER_NOT_FOUND',
          message: 'Publisher MissingPublisher was not found.',
        }),
      ])
    );
    expect(result.suggestedNextActions).toEqual(
      expect.arrayContaining([
        'Run `pp dv query publishers --environment <alias> --select publisherid,uniquename,friendlyname --format json` to inspect available publishers before retrying `pp solution create HarnessShell`.',
      ])
    );
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
            friendlyname: 'Harness Publisher',
            customizationprefix: 'pp',
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
      publisher: {
        publisherid: 'pub-1',
        uniquename: 'HarnessPublisher',
        friendlyname: 'Harness Publisher',
        customizationprefix: 'pp',
      },
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
      ImportJobId: expect.any(String),
      CustomizationFile: Buffer.from('managed-content').toString('base64'),
    });
    expect(result.data?.packageType).toBe('managed');
    expect(result.data?.manifest?.solution.uniqueName).toBe('Core');
    expect(result.data?.options.importJobId).toEqual(expect.any(String));
  });

  it('normalizes exported package metadata when Dataverse returns the wrong managed flag', async () => {
    const tempDir = await createTempDir();
    const upstreamPath = join(tempDir, 'upstream-managed.zip');
    await createSolutionArchive(upstreamPath, true);
    const upstreamBytes = await readFile(upstreamPath);

    const service = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          friendlyname: 'Core Solution',
          version: '1.2.3.4',
          ismanaged: false,
        },
        components: [],
        dependencies: [],
        exportPayloadBase64: upstreamBytes.toString('base64'),
      })
    );

    const result = await service.exportSolution('Core', {
      outDir: tempDir,
    });

    expect(result.success).toBe(true);
    expect(result.data?.packageType).toBe('unmanaged');
    expect(result.data?.manifest?.solution.packageType).toBe('unmanaged');
    expect(readManagedFlagFromArchive(result.data!.artifact.path)).toBe('0');
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'SOLUTION_EXPORT_PACKAGE_TYPE_NORMALIZED',
      })
    );
  });

  it('publishes a solution through PublishAllXml and warns when no sync checkpoint is requested', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> | undefined }> = [];
    const service = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
        },
        components: [
          { solutioncomponentid: 'comp-canvas', objectid: 'canvas-1', componenttype: 300 },
          { solutioncomponentid: 'comp-flow', objectid: 'flow-1', componenttype: 29 },
        ],
        dependencies: [],
        canvasApps: [
          {
            canvasappid: 'canvas-1',
            displayname: 'Harness Canvas',
            name: 'crd_HarnessCanvas',
            lastpublishtime: '2026-03-11T18:06:20.000Z',
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
        requestRecorder: requests,
      })
    );

    const result = await service.publish('Core');

    expect(result.success).toBe(true);
    expect(requests[0]?.path).toBe('PublishAllXml');
    expect(requests[0]?.body).toEqual({});
    expect(result.data).toMatchObject({
      published: true,
      waitForExport: false,
      synchronization: {
        kind: 'none',
        confirmed: false,
      },
      blockers: [
        {
          kind: 'workflow-state',
          componentType: 'workflow',
          id: 'flow-1',
          name: 'Harness Flow',
          logicalName: 'crd_HarnessFlow',
          workflowState: 'draft',
          reason: 'Workflow Harness Flow is still draft, so solution export readiness remains blocked.',
        },
      ],
      readBack: {
        summary: {
          componentCount: 2,
          canvasAppCount: 1,
          workflowCount: 1,
          modelDrivenAppCount: 0,
        },
        canvasApps: [
          expect.objectContaining({
            id: 'canvas-1',
            lastPublishTime: '2026-03-11T18:06:20.000Z',
          }),
        ],
        workflows: [
          expect.objectContaining({
            id: 'flow-1',
            workflowState: 'draft',
          }),
        ],
      },
    });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'SOLUTION_SYNC_STATUS_BLOCKED_WORKFLOW_STATE',
        detail: expect.stringContaining('Harness Flow state=draft'),
        hint: expect.stringContaining('pp flow inspect crd_HarnessFlow --environment <alias> --solution Core --format json'),
      })
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'SOLUTION_PUBLISH_SYNC_NOT_CONFIRMED',
        detail: expect.stringContaining('Harness Flow state=draft'),
        hint: expect.stringContaining('pp flow inspect crd_HarnessFlow --environment <alias> --solution Core --format json'),
      })
    );
  });

  it('publishes a solution and waits for an export checkpoint when requested', async () => {
    const tempDir = await createTempDir();
    const upstreamPath = join(tempDir, 'upstream.zip');
    await createSolutionArchive(upstreamPath, false);
    const upstreamBytes = await readFile(upstreamPath);
    const requests: Array<{ path: string; body: Record<string, unknown> | undefined }> = [];
    const progress: Array<{ stage: string; attempt?: number }> = [];
    const service = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          friendlyname: 'Core',
          version: '1.0.0.0',
        },
        components: [
          { solutioncomponentid: 'comp-canvas', objectid: 'canvas-1', componenttype: 300 },
          { solutioncomponentid: 'comp-flow', objectid: 'flow-1', componenttype: 29 },
        ],
        dependencies: [],
        canvasApps: [
          {
            canvasappid: 'canvas-1',
            displayname: 'Harness Canvas',
            name: 'crd_HarnessCanvas',
            lastpublishtime: '2026-03-11T18:06:20.000Z',
          },
        ],
        workflows: [
          {
            workflowid: 'flow-1',
            name: 'Harness Flow',
            uniquename: 'crd_HarnessFlow',
            category: 5,
            statecode: 1,
            statuscode: 2,
          },
        ],
        exportPayloadBase64: upstreamBytes.toString('base64'),
        requestRecorder: requests,
      })
    );

    const result = await service.publish('Core', {
      waitForExport: true,
      timeoutMs: 5_000,
      pollIntervalMs: 1_000,
      onProgress: (event) => {
        progress.push({ stage: event.stage, attempt: event.attempt });
      },
      exportOptions: {
        outPath: join(tempDir, 'Core.zip'),
      },
    });

    expect(result.success).toBe(true);
    expect(requests.map((request) => request.path)).toEqual(['PublishAllXml', 'ExportSolution']);
    expect(progress).toEqual([
      { stage: 'accepted', attempt: undefined },
      { stage: 'polling', attempt: 1 },
      { stage: 'confirmed', attempt: 1 },
    ]);
    expect(result.data).toMatchObject({
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

  it('reports sync status with readback and a successful export probe', async () => {
    const tempDir = await createTempDir();
    const upstreamPath = join(tempDir, 'upstream.zip');
    await createSolutionArchive(upstreamPath, false);
    const upstreamBytes = await readFile(upstreamPath);
    const service = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          friendlyname: 'Core',
          version: '1.0.0.0',
        },
        components: [
          { solutioncomponentid: 'comp-canvas', objectid: 'canvas-1', componenttype: 300 },
          { solutioncomponentid: 'comp-flow', objectid: 'flow-1', componenttype: 29 },
          { solutioncomponentid: 'comp-model', objectid: 'app-1', componenttype: 80 },
        ],
        dependencies: [],
        canvasApps: [
          {
            canvasappid: 'canvas-1',
            displayname: 'Harness Canvas',
            name: 'crd_HarnessCanvas',
            lastpublishtime: '2026-03-11T18:06:20.000Z',
          },
        ],
        workflows: [
          {
            workflowid: 'flow-1',
            name: 'Harness Flow',
            uniquename: 'crd_HarnessFlow',
            category: 5,
            statecode: 1,
            statuscode: 2,
          },
        ],
        modelApps: [
          {
            appmoduleid: 'app-1',
            name: 'Harness Hub',
            uniquename: 'crd_HarnessHub',
            statecode: 0,
            publishedon: '2026-03-11T18:07:00.000Z',
          },
        ],
        exportPayloadBase64: upstreamBytes.toString('base64'),
      })
    );

    const result = await service.syncStatus('Core', {
      outPath: join(tempDir, 'Core.zip'),
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
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
        modelDrivenApps: [
          {
            id: 'app-1',
            name: 'Harness Hub',
            uniqueName: 'crd_HarnessHub',
            stateCode: 0,
            publishedOn: '2026-03-11T18:07:00.000Z',
          },
        ],
      },
      exportCheck: {
        attempted: true,
        confirmed: true,
      },
    });
  });

  it('reports sync status export probe failures without failing the status command', async () => {
    const service = new SolutionService({
      ...createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          friendlyname: 'Core',
        },
        components: [
          {
            solutioncomponentid: 'comp-workflow',
            objectid: 'flow-1',
            componenttype: 29,
          },
        ],
        dependencies: [],
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
      }),
      invokeAction: async (name: string) =>
        name === 'ExportSolution'
          ? ({
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
            } as OperationResult<never>)
          : ({
              success: true,
              data: {
                status: 204,
                headers: {},
              },
              diagnostics: [],
              warnings: [],
              supportTier: 'preview',
            } as OperationResult<unknown>),
    } as unknown as DataverseClient);

    const result = await service.syncStatus('Core');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      synchronization: {
        confirmed: false,
      },
      blockers: [
        expect.objectContaining({
          kind: 'workflow-state',
          componentType: 'workflow',
          id: 'flow-1',
          logicalName: 'crd_HarnessFlow',
          workflowState: 'draft',
        }),
      ],
      exportCheck: {
        attempted: true,
        confirmed: false,
        failure: {
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: 'HTTP_REQUEST_FAILED',
            }),
          ]),
          warnings: expect.arrayContaining([
            expect.objectContaining({
              code: 'SOLUTION_EXPORT_WORKFLOW_CONTEXT',
            }),
          ]),
        },
      },
    });
    expect(result.data?.exportCheck.failure?.warnings).toContainEqual(
      expect.objectContaining({
        code: 'SOLUTION_SYNC_STATUS_BLOCKED_WORKFLOW_STATE',
        detail: expect.stringContaining('Harness Flow state=draft'),
      })
    );
    expect(result.data?.exportCheck.failure?.suggestedNextActions).toContain(
      'If crd_HarnessFlow should already be runnable, activate it in place with `pp flow activate crd_HarnessFlow --environment <alias> --solution Core --format json`.'
    );
  });

  it('includes the previous export failure and readback in subsequent publish polling events', async () => {
    let exportAttempts = 0;
    const progress: SolutionPublishProgressEvent[] = [];
    const tempDir = await createTempDir();
    const upstreamPath = join(tempDir, 'upstream.zip');
    await createSolutionArchive(upstreamPath, false);
    const upstreamBytes = await readFile(upstreamPath);
    const service = new SolutionService({
      ...createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          friendlyname: 'Core',
          version: '1.0.0.0',
        },
        components: [
          { solutioncomponentid: 'comp-flow', objectid: 'flow-1', componenttype: 29 },
        ],
        dependencies: [],
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
      }),
      invokeAction: async (name: string, parameters: Record<string, unknown> | undefined, options: unknown) => {
        if (name === 'ExportSolution' && exportAttempts++ === 0) {
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

        return createStubClient({
          solution: {
            solutionid: 'sol-1',
            uniquename: 'Core',
            friendlyname: 'Core',
            version: '1.0.0.0',
          },
          components: [{ solutioncomponentid: 'comp-flow', objectid: 'flow-1', componenttype: 29 }],
          dependencies: [],
          workflows: [
            {
              workflowid: 'flow-1',
              name: 'Harness Flow',
              uniquename: 'crd_HarnessFlow',
              category: 5,
              statecode: 1,
              statuscode: 2,
            },
          ],
          exportPayloadBase64: upstreamBytes.toString('base64'),
        }).invokeAction(name, parameters, options as never);
      },
    } as unknown as DataverseClient);

    const result = await service.publish('Core', {
      waitForExport: true,
      timeoutMs: 5_000,
      pollIntervalMs: 1_000,
      onProgress: (event) => {
        progress.push(event);
      },
      exportOptions: {
        outPath: join(tempDir, 'Core.zip'),
      },
    });

    expect(result.success).toBe(true);
    expect(progress).toContainEqual(
      expect.objectContaining({
        stage: 'polling',
        attempt: 2,
        latestExportDiagnostic: expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String),
        }),
        readBack: expect.objectContaining({
          workflows: [
            expect.objectContaining({
              workflowState: 'draft',
            }),
          ],
        }),
      })
    );
  });

  it('includes the last observed readback in publish timeout warnings', async () => {
    const service = new SolutionService({
      ...createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          friendlyname: 'Core',
        },
        components: [
          { solutioncomponentid: 'comp-canvas', objectid: 'canvas-1', componenttype: 300 },
          { solutioncomponentid: 'comp-flow', objectid: 'flow-1', componenttype: 29 },
        ],
        dependencies: [],
        canvasApps: [
          {
            canvasappid: 'canvas-1',
            displayname: 'Harness Canvas',
            name: 'crd_HarnessCanvas',
            lastpublishtime: '2026-03-11T18:06:20.000Z',
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
      }),
      invokeAction: async (name: string) =>
        name === 'PublishAllXml'
          ? ({
              success: true,
              data: {
                status: 204,
                headers: {},
              },
              diagnostics: [],
              warnings: [],
              supportTier: 'preview',
            } as OperationResult<unknown>)
          : ({
              success: false,
              diagnostics: [
                {
                  level: 'error',
                  code: 'HTTP_REQUEST_FAILED',
                  message: 'POST ExportSolution returned 500',
                },
              ],
              warnings: [],
              supportTier: 'preview',
            } as OperationResult<never>),
    } as unknown as DataverseClient);

    const result = await service.publish('Core', {
      waitForExport: true,
      timeoutMs: 1_000,
      pollIntervalMs: 1_000,
    });

    expect(result.success).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'SOLUTION_SYNC_STATUS_BLOCKED_WORKFLOW_STATE',
        detail: expect.stringContaining('Harness Flow state=draft'),
        hint: expect.stringContaining('pp flow inspect crd_HarnessFlow --environment <alias> --solution Core --format json'),
      })
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'SOLUTION_PUBLISH_LAST_READBACK',
        detail: expect.stringContaining('Harness Canvas lastPublishTime=2026-03-11T18:06:20.000Z'),
      })
    );
    expect(result.suggestedNextActions).toContain(
      'If crd_HarnessFlow should already be runnable, activate it in place with `pp flow activate crd_HarnessFlow --environment <alias> --solution Core --format json`.'
    );
    expect(result.suggestedNextActions).toContain(
      'Run `pp solution sync-status Core --environment <alias> --format json` to capture component read-back and the current export probe in one response.'
    );
  });

  it('enriches solution table components with logical names and entity set names', async () => {
    const service = new SolutionService(
      createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          version: '1.0.0.0',
        },
        components: [
          {
            solutioncomponentid: 'comp-table',
            objectid: 'entity-1',
            componenttype: 1,
            ismetadata: true,
          },
          {
            solutioncomponentid: 'comp-flow',
            objectid: 'flow-1',
            componenttype: 29,
          },
        ],
        dependencies: [],
        workflows: [
          {
            workflowid: 'flow-1',
            name: 'Harness Flow',
            uniquename: 'crd_HarnessFlow',
          },
        ],
        tables: [
          {
            MetadataId: 'entity-1',
            LogicalName: 'pph34135_project',
            SchemaName: 'pph34135_project',
            EntitySetName: 'pph34135_projects',
            DisplayName: {
              UserLocalizedLabel: {
                Label: 'Project',
              },
            },
          },
        ],
      })
    );

    const result = await service.components('Core');

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      expect.objectContaining({
        id: 'comp-table',
        componentType: 1,
        componentTypeLabel: 'entity',
        objectId: 'entity-1',
        name: 'Project',
        logicalName: 'pph34135_project',
        table: 'pph34135_project',
        entitySetName: 'pph34135_projects',
      }),
      expect.objectContaining({
        id: 'comp-flow',
        componentType: 29,
        componentTypeLabel: 'workflow',
        objectId: 'flow-1',
        name: 'Harness Flow',
        logicalName: 'crd_HarnessFlow',
      }),
    ]);
  });

  it('caps each export checkpoint attempt to the remaining publish timeout budget', async () => {
    const tempDir = await createTempDir();
    const upstreamPath = join(tempDir, 'upstream.zip');
    await createSolutionArchive(upstreamPath, false);
    const upstreamBytes = await readFile(upstreamPath);
    const actionOptions: Array<Record<string, unknown> | undefined> = [];
    const baseClient = createStubClient({
      solution: {
        solutionid: 'sol-1',
        uniquename: 'Core',
        friendlyname: 'Core',
        version: '1.0.0.0',
      },
      components: [],
      dependencies: [],
      exportPayloadBase64: upstreamBytes.toString('base64'),
    });
    const service = new SolutionService({
      ...baseClient,
      invokeAction: async <T>(name: string, parameters?: Record<string, unknown>, options?: { timeoutMs?: number }) => {
        actionOptions.push(name === 'ExportSolution' ? options : undefined);

        return baseClient.invokeAction<T>(name, parameters, options);
      },
    } as unknown as DataverseClient);

    const result = await service.publish('Core', {
      waitForExport: true,
      timeoutMs: 5_000,
      pollIntervalMs: 1_000,
      exportOptions: {
        outPath: join(tempDir, 'Core.zip'),
      },
    });

    expect(result.success).toBe(true);
    expect(actionOptions).toContainEqual(expect.objectContaining({ timeoutMs: expect.any(Number) }));
    expect((actionOptions.find((entry) => entry?.timeoutMs !== undefined)?.timeoutMs as number)).toBeLessThanOrEqual(5_000);
  });

  it('adds workflow packaging context when ExportSolution fails for a solution with workflow components', async () => {
    const service = new SolutionService({
      ...createStubClient({
        solution: {
          solutionid: 'sol-1',
          uniquename: 'Core',
          friendlyname: 'Core',
        },
        components: [
          {
            solutioncomponentid: 'comp-workflow',
            objectid: 'flow-1',
            componenttype: 29,
          },
        ],
        dependencies: [],
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
      }),
      invokeAction: async () =>
        ({
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
        }) as OperationResult<never>,
    } as unknown as DataverseClient);

    const result = await service.exportSolution('Core');

    expect(result.success).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'SOLUTION_EXPORT_WORKFLOW_CONTEXT',
        detail: expect.stringContaining('Harness Flow [id=flow-1; category=5; state=draft]'),
      })
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'SOLUTION_EXPORT_BLOCKED_WORKFLOW_STATE',
        detail: expect.stringContaining('Harness Flow state=draft'),
        hint: expect.stringContaining('pp flow inspect crd_HarnessFlow --environment <alias> --solution Core --format json'),
      })
    );
    expect(result.suggestedNextActions).toContain(
      'If crd_HarnessFlow should already be runnable, activate it in place with `pp flow activate crd_HarnessFlow --environment <alias> --solution Core --format json`.'
    );
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
