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
});
