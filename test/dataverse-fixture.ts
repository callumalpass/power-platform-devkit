import type { DataverseClient } from '@pp/dataverse';
import * as dataverseModule from '@pp/dataverse';
import { createDiagnostic, fail, ok, type OperationResult } from '@pp/diagnostics';
import { vi } from 'vitest';

export interface DataverseFixture {
  query?: Record<string, unknown[]>;
  queryAll?: Record<string, unknown[]>;
}

export function createFixtureDataverseClient(fixture: DataverseFixture): DataverseClient {
  return {
    query: async <T>(options: { table: string }): Promise<OperationResult<T[]>> =>
      ok(((fixture.query?.[options.table] ?? []) as T[]), {
        supportTier: 'preview',
      }),
    queryAll: async <T>(options: { table: string }): Promise<OperationResult<T[]>> =>
      ok(((fixture.queryAll?.[options.table] ?? []) as T[]), {
        supportTier: 'preview',
      }),
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
