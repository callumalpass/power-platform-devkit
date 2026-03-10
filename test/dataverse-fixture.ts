import type { DataverseClient, EntityDefinition } from '@pp/dataverse';
import * as dataverseModule from '@pp/dataverse';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { vi } from 'vitest';

export interface DataverseFixture {
  query?: Record<string, unknown[]>;
  queryAll?: Record<string, unknown[]>;
  listTables?: EntityDefinition[];
}

export function createFixtureDataverseClient(fixture: DataverseFixture): DataverseClient {
  const queryState = new Map(Object.entries(structuredClone(fixture.query ?? {})));
  const queryAllState = new Map(Object.entries(structuredClone(fixture.queryAll ?? {})));

  return {
    query: async <T>(options: { table: string }): Promise<OperationResult<T[]>> =>
      ok(((queryState.get(options.table) ?? []) as T[]), {
        supportTier: 'preview',
      }),
    queryAll: async <T>(options: { table: string }): Promise<OperationResult<T[]>> =>
      ok(((queryAllState.get(options.table) ?? []) as T[]), {
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
    update: async <TRecord extends Record<string, unknown>, TResult = TRecord>(
      table: string,
      id: string,
      entity: TRecord
    ): Promise<OperationResult<{ status: number; headers: Record<string, string>; entity?: TResult; entityId?: string }>> => {
      const records = (queryAllState.get(table) ?? []) as Array<Record<string, unknown>>;
      const index = records.findIndex((record) => Object.values(record).includes(id));

      if (index === -1) {
        return fail(
          createDiagnostic('error', 'DATAVERSE_FIXTURE_ENTITY_NOT_FOUND', `Fixture entity ${table}/${id} was not found.`, {
            source: '@pp/test',
          })
        );
      }

      const updated = {
        ...records[index],
        ...entity,
      };
      queryAllState.set(table, records.map((record, recordIndex) => (recordIndex === index ? updated : record)));
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
  } as unknown as DataverseClient;
}

export function mockDataverseResolution(fixtures: Record<string, DataverseClient>): void {
  vi.spyOn(dataverseModule, 'resolveDataverseClient').mockImplementation(async (environmentAlias: string) => {
    const client = fixtures[environmentAlias];

    if (!client) {
      return fail(
        createDiagnostic('error', 'DATAVERSE_ENV_NOT_FOUND', `Environment alias ${environmentAlias} was not found in the test fixture.`, {
          source: '@pp/test',
        })
      );
    }

    return ok(
      {
        environment: {
          name: environmentAlias,
          url: `https://${environmentAlias}.example.crm.dynamics.com`,
          authProfile: `${environmentAlias}-profile`,
        } as never,
        authProfile: {
          name: `${environmentAlias}-profile`,
          kind: 'static-token',
          token: `${environmentAlias}-token`,
        } as never,
        client,
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
    case 'connectionreferences':
      return 'connectionreferenceid';
    case 'environmentvariabledefinitions':
      return 'environmentvariabledefinitionid';
    case 'environmentvariablevalues':
      return 'environmentvariablevalueid';
    default:
      return undefined;
  }
}
