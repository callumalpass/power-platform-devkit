import { describe, expect, it } from 'vitest';
import { ok, type OperationResult } from '@pp/diagnostics';
import { PowerBiClient } from './index';

describe('PowerBiClient', () => {
  it('inspects a workspace by name and enriches it with datasets and reports', async () => {
    const requests: string[] = [];
    const client = new PowerBiClient({
      requestJson: async <T>(options: { path: string }): Promise<OperationResult<T>> => {
        requests.push(options.path);

        if (options.path === '/v1.0/myorg/groups') {
          return ok(
            {
              value: [
                {
                  id: 'workspace-1',
                  name: 'Finance',
                },
              ],
            } as T,
            { supportTier: 'preview' }
          );
        }

        if (options.path.endsWith('/datasets')) {
          return ok(
            {
              value: [
                {
                  id: 'dataset-1',
                  name: 'Budget Model',
                },
              ],
            } as T,
            { supportTier: 'preview' }
          );
        }

        return ok(
          {
            value: [
              {
                id: 'report-1',
                name: 'Budget Overview',
                datasetId: 'dataset-1',
                webUrl: 'https://app.powerbi.com/report',
              },
            ],
          } as T,
          { supportTier: 'preview' }
        );
      },
    } as never);

    const result = await client.inspectWorkspace('Finance');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      id: 'workspace-1',
      name: 'Finance',
      isReadOnly: undefined,
      isOnDedicatedCapacity: undefined,
      capacityId: undefined,
      datasets: [
        {
          id: 'dataset-1',
          name: 'Budget Model',
        },
      ],
      reports: [
        {
          id: 'report-1',
          name: 'Budget Overview',
          datasetId: 'dataset-1',
          webUrl: 'https://app.powerbi.com/report',
        },
      ],
    });
    expect(requests).toEqual([
      '/v1.0/myorg/groups',
      '/v1.0/myorg/groups/workspace-1/datasets',
      '/v1.0/myorg/groups/workspace-1/reports',
    ]);
  });

  it('inspects a dataset and includes datasources and refresh metadata', async () => {
    const client = new PowerBiClient({
      requestJson: async <T>(options: { path: string }): Promise<OperationResult<T>> => {
        if (options.path === '/v1.0/myorg/groups/11111111-1111-4111-8111-111111111111') {
          return ok(
            {
              id: '11111111-1111-4111-8111-111111111111',
              name: 'Finance',
            } as T,
            { supportTier: 'preview' }
          );
        }

        if (options.path === '/v1.0/myorg/groups/11111111-1111-4111-8111-111111111111/datasets') {
          return ok(
            {
              value: [
                {
                  id: 'dataset-1',
                  name: 'Budget Model',
                },
              ],
            } as T,
            { supportTier: 'preview' }
          );
        }

        if (options.path === '/v1.0/myorg/groups/11111111-1111-4111-8111-111111111111/reports') {
          return ok(
            {
              value: [],
            } as T,
            { supportTier: 'preview' }
          );
        }

        if (options.path.endsWith('/datasources')) {
          return ok(
            {
              value: [
                {
                  datasourceType: 'Sql',
                  connectionDetails: {
                    server: 'sql.example.test',
                    database: 'Finance',
                  },
                },
              ],
            } as T,
            { supportTier: 'preview' }
          );
        }

        return ok(
          {
            enabled: true,
            timezone: 'UTC',
            times: ['06:00'],
            days: ['Monday'],
          } as T,
          { supportTier: 'preview' }
        );
      },
    } as never);

    const result = await client.inspectDataset('11111111-1111-4111-8111-111111111111', 'Budget Model');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      id: 'dataset-1',
      name: 'Budget Model',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      configuredBy: undefined,
      addRowsApiEnabled: undefined,
      isRefreshable: undefined,
      isEffectiveIdentityRequired: undefined,
      isOnPremGatewayRequired: undefined,
      targetStorageMode: undefined,
      datasources: [
        {
          datasourceType: 'Sql',
          connectionDetails: {
            server: 'sql.example.test',
            database: 'Finance',
          },
          gatewayId: undefined,
          datasourceId: undefined,
        },
      ],
      refreshSchedule: {
        enabled: true,
        timezone: 'UTC',
        times: ['06:00'],
        days: ['Monday'],
      },
    });
  });
});
