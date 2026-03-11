import { describe, expect, it } from 'vitest';
import { ok, type OperationResult } from '@pp/diagnostics';
import type { DataverseClient, EntityDefinition } from '@pp/dataverse';
import { ModelService } from './index';

function createStubClient(): DataverseClient {
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
        case 'appmodules':
          return ok(
            [
              {
                appmoduleid: 'app-1',
                uniquename: 'SalesHub',
                name: 'Sales Hub',
                appmoduleversion: '1.0.0.0',
              },
              {
                appmoduleid: 'app-2',
                uniquename: 'OpsHub',
                name: 'Ops Hub',
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
                objectid: 'app-1',
                componenttype: 80,
              },
            ] as T[],
            {
              supportTier: 'preview',
            }
          );
        case 'appmodulecomponents':
        case 'appmodules(app-1)/appmodule_appmodulecomponent':
          return ok(
            [
              {
                appmodulecomponentid: 'amc-1',
                componenttype: 1,
                objectid: 'entity-1',
                _appmoduleidunique_value: 'app-1',
              },
              {
                appmodulecomponentid: 'amc-2',
                componenttype: 60,
                objectid: 'form-1',
                _appmoduleidunique_value: 'app-1',
              },
              {
                appmodulecomponentid: 'amc-3',
                componenttype: 26,
                objectid: 'view-1',
                _appmoduleidunique_value: 'app-1',
              },
              {
                appmodulecomponentid: 'amc-4',
                componenttype: 62,
                objectid: 'sitemap-1',
                _appmoduleidunique_value: 'app-1',
              },
              {
                appmodulecomponentid: 'amc-5',
                componenttype: 60,
                objectid: 'missing-form',
                _appmoduleidunique_value: 'app-1',
              },
            ] as T[],
            {
              supportTier: 'preview',
            }
          );
        case 'systemforms':
          return ok(
            [
              {
                formid: 'form-1',
                name: 'Account Main',
                objecttypecode: 'account',
                type: 2,
              },
            ] as T[],
            {
              supportTier: 'preview',
            }
          );
        case 'savedqueries':
          return ok(
            [
              {
                savedqueryid: 'view-1',
                name: 'Active Accounts',
                returnedtypecode: 'account',
                querytype: 0,
              },
            ] as T[],
            {
              supportTier: 'preview',
            }
          );
        case 'sitemaps':
          return ok(
            [
              {
                sitemapid: 'sitemap-1',
                sitemapname: 'Sales Hub sitemap',
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
    create: async <TRecord extends Record<string, unknown>, TResult = TRecord>(
      table: string,
      entity: TRecord
    ): Promise<OperationResult<{ status: number; headers: Record<string, string>; entity?: TResult; entityId?: string }>> => {
      if (table !== 'appmodules') {
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
          status: 204,
          headers: {},
          entityId: 'app-3',
          entity: {
            appmoduleid: 'app-3',
            uniquename: entity.uniquename,
            name: entity.name,
          } as TResult,
        },
        {
          supportTier: 'preview',
        }
      );
    },
    invokeAction: async (): Promise<OperationResult<{ status: number; headers: Record<string, string>; body?: unknown; entityId?: string }>> =>
      ok(
        {
          status: 200,
          headers: {},
          body: {},
        },
        {
          supportTier: 'preview',
        }
      ),
    listTables: async (): Promise<OperationResult<EntityDefinition[]>> =>
      ok(
        [
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
        {
          supportTier: 'preview',
        }
      ),
  } as unknown as DataverseClient;
}

function createComponentFailureClient(): DataverseClient {
  return {
    ...createStubClient(),
    queryAll: async <T>(options: { table: string }): Promise<OperationResult<T[]>> => {
      if (options.table === 'appmodulecomponents') {
        return {
          success: false,
          diagnostics: [
            {
              level: 'error',
              code: 'HTTP_REQUEST_FAILED',
              message: 'appmodulecomponents query failed',
              source: '@pp/http',
            },
          ],
          warnings: [],
          supportTier: 'preview',
        };
      }

      return createStubClient().queryAll<T>(options);
    },
  } as DataverseClient;
}

describe('ModelService', () => {
  it('lists model-driven apps with optional solution filtering', async () => {
    const service = new ModelService(createStubClient());

    const result = await service.list({
      solutionUniqueName: 'Core',
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({
      id: 'app-1',
      uniqueName: 'SalesHub',
      name: 'Sales Hub',
    });
  });

  it('creates and attaches model-driven apps through the domain service', async () => {
    const service = new ModelService(createStubClient());

    const created = await service.create('ServiceHub', {
      name: 'Service Hub',
      solutionUniqueName: 'Core',
    });
    const attached = await service.attach('SalesHub', {
      solutionUniqueName: 'Core',
      addRequiredComponents: false,
    });

    expect(created.success).toBe(true);
    expect(created.data).toMatchObject({
      id: 'app-3',
      uniqueName: 'ServiceHub',
      name: 'Service Hub',
    });
    expect(attached.success).toBe(true);
    expect(attached.data).toMatchObject({
      attached: true,
      solutionUniqueName: 'Core',
      app: {
        id: 'app-1',
        uniqueName: 'SalesHub',
      },
      addRequiredComponents: false,
    });
  });

  it('inspects app composition and traces missing dependencies', async () => {
    const service = new ModelService(createStubClient());

    const result = await service.inspect('Sales Hub', {
      solutionUniqueName: 'Core',
    });

    expect(result.success).toBe(true);
    expect(result.data?.tables).toEqual([
      {
        id: 'entity-1',
        logicalName: 'account',
        schemaName: 'Account',
        displayName: 'Account',
      },
    ]);
    expect(result.data?.forms[0]).toMatchObject({
      name: 'Account Main',
      table: 'account',
    });
    expect(result.data?.views[0]).toMatchObject({
      name: 'Active Accounts',
      table: 'account',
    });
    expect(result.data?.sitemaps[0]).toMatchObject({
      name: 'Sales Hub sitemap',
    });
    expect(result.data?.missingComponents).toEqual([
      {
        componentId: 'amc-5',
        componentType: 60,
        componentTypeLabel: 'form',
        objectId: 'missing-form',
        name: undefined,
        table: undefined,
        status: 'missing',
      },
    ]);
  });

  it('returns a partial inspect payload when appmodulecomponents are unavailable', async () => {
    const service = new ModelService(createComponentFailureClient());

    const result = await service.inspect('Sales Hub', {
      solutionUniqueName: 'Core',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      app: {
        id: 'app-1',
        uniqueName: 'SalesHub',
        name: 'Sales Hub',
      },
      tables: [],
      forms: [],
      views: [],
      sitemaps: [],
      dependencies: [],
      missingComponents: [],
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MODEL_COMPONENTS_UNAVAILABLE',
        }),
      ])
    );
  });

  it('returns dependency-focused projections', async () => {
    const service = new ModelService(createStubClient());

    const dependencies = await service.dependencies('Sales Hub', {
      solutionUniqueName: 'Core',
    });

    expect(dependencies.success).toBe(true);
    expect(dependencies.data?.map((item) => item.componentTypeLabel)).toEqual([
      'table',
      'form',
      'view',
      'sitemap',
      'form',
    ]);
  });

  it('builds a normalized composition graph and previews impact for supported surfaces', async () => {
    const service = new ModelService(createStubClient());

    const composition = await service.composition('Sales Hub', {
      solutionUniqueName: 'Core',
    });
    const impact = await service.impact(
      'Sales Hub',
      {
        kind: 'form',
        identifier: 'Account Main',
      },
      {
        solutionUniqueName: 'Core',
      }
    );

    expect(composition.success).toBe(true);
    expect(composition.data?.summary).toMatchObject({
      totalArtifacts: 6,
      missingArtifacts: 1,
      byKind: {
        app: 1,
        table: 1,
        form: 2,
        view: 1,
        sitemap: 1,
      },
    });
    expect(composition.data?.relationships).toContainEqual({
      from: 'form:form-1',
      to: 'table:entity-1',
      relation: 'depends-on',
    });
    expect(impact.success).toBe(true);
    expect(impact.data?.target).toMatchObject({
      kind: 'form',
      name: 'Account Main',
    });
    expect(impact.data?.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'table',
          logicalName: 'account',
        }),
      ])
    );
    expect(impact.data?.dependents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'app',
          name: 'Sales Hub',
        }),
      ])
    );
  });

  it('emits a bounded rename mutation plan with impact context', async () => {
    const service = new ModelService(createStubClient());

    const result = await service.planMutation(
      'Sales Hub',
      {
        operation: 'rename',
        target: {
          kind: 'view',
          identifier: 'Active Accounts',
        },
        value: {
          name: 'Current Accounts',
        },
      },
      {
        solutionUniqueName: 'Core',
      }
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      valid: true,
      target: {
        kind: 'view',
        name: 'Active Accounts',
      },
      operations: [
        {
          scope: 'dataverse',
          action: 'update',
          table: 'savedqueries',
          id: 'view-1',
          patch: {
            name: 'Current Accounts',
          },
        },
      ],
    });
    expect(result.data?.impact?.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'table',
          logicalName: 'account',
        }),
      ])
    );
  });
});
