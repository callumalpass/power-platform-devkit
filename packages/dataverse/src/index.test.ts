import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { saveAuthProfile, saveEnvironmentAlias } from '@pp/config';
import { ok, type OperationResult } from '@pp/diagnostics';
import { HttpClient, type HttpRequestOptions, type HttpResponse } from '@pp/http';
import { DataverseClient, buildQueryPath, normalizeMetadataQueryOptions, resolveDataverseClient } from './index';

class FakeHttpClient extends HttpClient {
  readonly requests: HttpRequestOptions[] = [];

  constructor(private readonly responses: Array<OperationResult<HttpResponse<unknown>>>) {
    super();
  }

  override async request<T>(request: HttpRequestOptions): Promise<OperationResult<HttpResponse<T>>> {
    this.requests.push(request);
    const response = this.responses.shift();

    if (!response) {
      throw new Error('No fake response queued');
    }

    return response as OperationResult<HttpResponse<T>>;
  }

  override async requestJson<T>(request: HttpRequestOptions): Promise<OperationResult<T>> {
    const response = await this.request<T>(request);

    if (!response.success) {
      return response as unknown as OperationResult<T>;
    }

    return ok(response.data?.data as T, {
      supportTier: response.supportTier,
      diagnostics: response.diagnostics,
      warnings: response.warnings,
    });
  }
}

describe('buildQueryPath', () => {
  it('builds extended odata query strings', () => {
    const path = buildQueryPath({
      table: 'accounts',
      select: ['name', 'accountnumber'],
      top: 10,
      filter: 'statecode eq 0',
      expand: ['primarycontactid($select=fullname)'],
      orderBy: ['name asc'],
      count: true,
    });

    expect(path).toContain('%24select=name%2Caccountnumber');
    expect(path).toContain('%24expand=primarycontactid%28%24select%3Dfullname%29');
    expect(path).toContain('%24orderby=name+asc');
    expect(path).toContain('%24count=true');
  });

  it('resolves a configured environment and auth profile', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-dv-'));

    await saveAuthProfile(
      {
        name: 'env-profile',
        type: 'environment-token',
        environmentVariable: 'PP_DV_TOKEN',
      },
      { configDir }
    );

    await saveEnvironmentAlias(
      {
        alias: 'dev',
        url: 'https://example.crm.dynamics.com',
        authProfile: 'env-profile',
      },
      { configDir }
    );

    const resolved = await resolveDataverseClient('dev', { configDir });

    expect(resolved.success).toBe(true);
    expect(resolved.data?.environment.alias).toBe('dev');
    expect(resolved.data?.authProfile.name).toBe('env-profile');
  });
});

describe('DataverseClient', () => {
  it('follows paging links when querying all records', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [{ accountid: '1' }],
          '@odata.nextLink': 'https://example.crm.dynamics.com/api/data/v9.2/accounts?$skiptoken=abc',
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [{ accountid: '2' }],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.queryAll<{ accountid: string }>({
      table: 'accounts',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ accountid: '1' }, { accountid: '2' }]);
    expect(httpClient.requests).toHaveLength(2);
    expect(httpClient.requests[1]?.path).toBe('https://example.crm.dynamics.com/api/data/v9.2/accounts?$skiptoken=abc');
  });

  it('extracts entity ids from write responses', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 201,
        headers: {
          location: 'https://example.crm.dynamics.com/api/data/v9.2/accounts(00000000-0000-0000-0000-000000000001)',
        },
        data: {
          accountid: '00000000-0000-0000-0000-000000000001',
          name: 'Acme',
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.create('accounts', { name: 'Acme' }, { returnRepresentation: true });

    expect(result.success).toBe(true);
    expect(result.data?.entityId).toBe('00000000-0000-0000-0000-000000000001');
    expect(result.data?.entity).toEqual({
      accountid: '00000000-0000-0000-0000-000000000001',
      name: 'Acme',
    });
    expect(httpClient.requests[0]?.method).toBe('POST');
    expect(httpClient.requests[0]?.headers?.prefer).toContain('return=representation');
  });

  it('applies metadata top client-side without sending $top to Dataverse', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [{ LogicalName: 'account' }, { LogicalName: 'contact' }, { LogicalName: 'lead' }],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.listTables({
      select: ['LogicalName'],
      top: 2,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ LogicalName: 'account' }, { LogicalName: 'contact' }]);
    expect(httpClient.requests[0]?.path).toBe('EntityDefinitions?%24select=LogicalName');
    expect(result.warnings.map((warning) => warning.code)).toContain('DATAVERSE_METADATA_TOP_CLIENT_SIDE');
  });

  it('rejects unsupported metadata orderBy requests before calling Dataverse', async () => {
    const httpClient = new FakeHttpClient([]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.listTables({
      orderBy: ['LogicalName asc'],
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('DATAVERSE_METADATA_ORDERBY_UNSUPPORTED');
    expect(httpClient.requests).toHaveLength(0);
  });
});

describe('normalizeMetadataQueryOptions', () => {
  it('rejects unsupported metadata count requests', () => {
    const result = normalizeMetadataQueryOptions({
      count: true,
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('DATAVERSE_METADATA_COUNT_UNSUPPORTED');
  });
});
