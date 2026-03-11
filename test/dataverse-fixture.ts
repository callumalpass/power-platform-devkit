import type { DataverseClient, EntityDefinition } from '@pp/dataverse';
import * as dataverseModule from '@pp/dataverse';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { vi } from 'vitest';

export interface DataverseFixture {
  query?: Record<string, unknown[]>;
  queryAll?: Record<string, unknown[]>;
  listTables?: EntityDefinition[];
}

export interface DataverseResolutionFixture {
  client: DataverseClient;
  environment?: Record<string, unknown>;
  authProfile?: Record<string, unknown>;
}

export function createFixtureDataverseClient(fixture: DataverseFixture): DataverseClient {
  const queryState = new Map(Object.entries(structuredClone(fixture.query ?? {})));
  const queryAllState = new Map(Object.entries(structuredClone(fixture.queryAll ?? {})));
  const updateState = (state: Map<string, unknown[]>, table: string, id: string, entity: Record<string, unknown>) => {
    const records = (state.get(table) ?? []) as Array<Record<string, unknown>>;
    const index = records.findIndex((record) => Object.values(record).includes(id));

    if (index === -1) {
      return false;
    }

    const updated = {
      ...records[index],
      ...entity,
    };
    state.set(table, records.map((record, recordIndex) => (recordIndex === index ? updated : record)));
    return true;
  };

  return {
    query: async <T>(options: { table: string }): Promise<OperationResult<T[]>> =>
      ok(((queryState.get(options.table) ?? []) as T[]), {
        supportTier: 'preview',
      }),
    queryAll: async <T>(options: { table: string }): Promise<OperationResult<T[]>> =>
      ok((resolveFixtureQueryAllRecords(queryAllState, queryState, options.table) as T[]), {
        supportTier: 'preview',
      }),
    listTables: async (): Promise<OperationResult<EntityDefinition[]>> =>
      ok(fixture.listTables ?? [], {
        supportTier: 'preview',
      }),
    create: async <TRecord extends Record<string, unknown>, TResult = TRecord>(
      table: string,
      entity: TRecord
    ): Promise<OperationResult<{ status: number; headers: Record<string, string>; entity?: TResult; entityId?: string }>> => {
      const records = (queryAllState.get(table) ?? []) as Array<Record<string, unknown>>;
      const entityId = `fixture-${table}-${records.length + 1}`;
      const idKey = inferIdKey(table, entity);
      const record = {
        ...entity,
        [idKey]: entityId,
      };
      queryAllState.set(table, [...records, record]);
      return ok(
        {
          status: 204,
          headers: {},
          entityId,
          entity: record as TResult,
        },
        {
          supportTier: 'preview',
        }
      );
    },
    invokeAction: async (
      name: string,
      parameters: Record<string, unknown> = {}
    ): Promise<OperationResult<{ status: number; headers: Record<string, string>; body?: unknown; entityId?: string }>> => {
      if (name === 'AddSolutionComponent') {
        const solutionUniqueName = typeof parameters.SolutionUniqueName === 'string' ? parameters.SolutionUniqueName : undefined;
        const componentId = typeof parameters.ComponentId === 'string' ? parameters.ComponentId : undefined;
        const componentType = typeof parameters.ComponentType === 'number' ? parameters.ComponentType : undefined;
        const solutions =
          (((queryState.get('solutions') ?? queryAllState.get('solutions')) as Array<Record<string, unknown>> | undefined) ?? []);
        const solutionId = solutions.find((record) => record.uniquename === solutionUniqueName)?.solutionid;
        const records = (queryAllState.get('solutioncomponents') ?? []) as Array<Record<string, unknown>>;

        queryAllState.set('solutioncomponents', [
          ...records,
          {
            solutioncomponentid: `fixture-solutioncomponent-${records.length + 1}`,
            objectid: componentId,
            componenttype: componentType,
            _solutionid_value: solutionId,
          },
        ]);
      }

      return ok(
        {
          status: 200,
          headers: {},
          body: {},
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
      const updatedQuery = updateState(queryState, table, id, entity);
      const updatedQueryAll = updateState(queryAllState, table, id, entity);

      if (!updatedQuery && !updatedQueryAll) {
        return fail(
          createDiagnostic('error', 'DATAVERSE_FIXTURE_ENTITY_NOT_FOUND', `Fixture entity ${table}/${id} was not found.`, {
            source: '@pp/test',
          })
        );
      }

      const updatedRecords =
        (((queryState.get(table) ?? queryAllState.get(table)) as Array<Record<string, unknown>> | undefined) ?? []);
      const updated = updatedRecords.find((record) => Object.values(record).includes(id)) ?? entity;
      return ok(
        {
          status: 204,
          headers: {},
          entityId: id,
          entity: updated as TResult,
        },
        {
          supportTier: 'preview',
        }
      );
    },
    delete: async (table: string, id: string) => {
      const deleteFrom = (state: Map<string, unknown[]>) => {
        const records = (state.get(table) ?? []) as Array<Record<string, unknown>>;
        const next = records.filter((record) => !Object.values(record).includes(id));
        state.set(table, next);
      };

      deleteFrom(queryState);
      deleteFrom(queryAllState);

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
  } as unknown as DataverseClient;
}

function resolveFixtureQueryAllRecords(queryAllState: Map<string, unknown[]>, queryState: Map<string, unknown[]>, table: string): unknown[] {
  const direct = queryAllState.get(table);
  if (direct) {
    return direct;
  }

  const queryFallback = queryState.get(table);
  if (queryFallback) {
    return queryFallback;
  }

  const appModuleComponentsMatch = table.match(/^appmodules\(([^)]+)\)\/appmodule_appmodulecomponent$/);
  if (appModuleComponentsMatch) {
    const appId = appModuleComponentsMatch[1]?.toLowerCase();
    const records = ((queryAllState.get('appmodulecomponents') ?? queryState.get('appmodulecomponents')) ?? []) as Array<
      Record<string, unknown>
    >;
    return records.filter((record) => {
      const componentAppId = [record._appmoduleidunique_value, record.appmoduleidunique]
        .find((value): value is string => typeof value === 'string')
        ?.toLowerCase();
      return componentAppId === appId;
    });
  }

  return [];
}

export function mockDataverseResolution(fixtures: Record<string, DataverseClient | DataverseResolutionFixture>): void {
  vi.spyOn(dataverseModule, 'resolveDataverseClient').mockImplementation(async (environmentAlias: string) => {
    const fixture = fixtures[environmentAlias];

    if (!fixture) {
      return fail(
        createDiagnostic('error', 'DATAVERSE_ENV_NOT_FOUND', `Environment alias ${environmentAlias} was not found in the test fixture.`, {
          source: '@pp/test',
        })
      );
    }

    const resolved = 'client' in fixture ? fixture : { client: fixture };

    return ok(
      {
        environment: {
          alias: environmentAlias,
          url: `https://${environmentAlias}.example.crm.dynamics.com`,
          authProfile: `${environmentAlias}-profile`,
          ...resolved.environment,
        } as never,
        authProfile: {
          name: `${environmentAlias}-profile`,
          kind: 'static-token',
          token: `${environmentAlias}-token`,
          ...resolved.authProfile,
        } as never,
        client: resolved.client,
      },
      {
        supportTier: 'preview',
      }
    );
  });
}

function inferIdKey(table: string, entity: Record<string, unknown>): string {
  const preferredKey = inferPreferredIdKey(table);

  if (preferredKey) {
    return preferredKey;
  }

  const explicitKey = Object.keys(entity).find((key) => key.endsWith('id'));

  if (explicitKey) {
    return explicitKey;
  }

  if (table.endsWith('ies')) {
    return `${table.slice(0, -3)}yid`;
  }

  return `${table.slice(0, -1)}id`;
}

function inferPreferredIdKey(table: string): string | undefined {
  switch (table) {
    case 'solutions':
      return 'solutionid';
    case 'connectionreferences':
      return 'connectionreferenceid';
    case 'environmentvariabledefinitions':
      return 'environmentvariabledefinitionid';
    case 'environmentvariablevalues':
      return 'environmentvariablevalueid';
    case 'appmodules':
      return 'appmoduleid';
    default:
      return undefined;
  }
}
