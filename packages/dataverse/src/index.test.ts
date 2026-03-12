import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveAuthProfile, saveEnvironmentAlias } from '@pp/config';
import { createDiagnostic, ok, fail, type OperationResult } from '@pp/diagnostics';
import { HttpClient, type HttpRequestOptions, type HttpResponse } from '@pp/http';
import {
  CloudFlowService,
  CanvasAppService,
  ConnectionReferenceService,
  DataverseClient,
  buildDataverseFunctionPath,
  EnvironmentVariableService,
  ModelDrivenAppService,
  buildMetadataAttributePath,
  buildGlobalOptionSetPath,
  buildRelationshipPath,
  buildQueryPath,
  diffDataverseMetadataSnapshots,
  normalizeAttributeDefinition,
  normalizeAttributeDefinitions,
  normalizeEntityDefinition,
  normalizeGlobalOptionSetDefinition,
  normalizeMetadataQueryOptions,
  normalizeRelationshipDefinition,
  resolveDataverseClient,
} from './index';

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
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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

  it('warns when an empty filtered query references unknown Dataverse columns', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          LogicalName: 'accounts',
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            { LogicalName: 'name', SchemaName: 'Name', IsFilterable: true },
            { LogicalName: 'accountnumber', SchemaName: 'AccountNumber', IsFilterable: true },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.query({
      table: 'accounts',
      filter: "nam eq 'Acme'",
      diagnoseEmptyFilter: true,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain('DATAVERSE_QUERY_FILTER_COLUMNS_UNRESOLVED');
    expect(result.warnings.find((warning) => warning.code === 'DATAVERSE_QUERY_FILTER_COLUMNS_UNRESOLVED')?.detail).toContain('nam: name');
  });

  it('warns when an empty filtered query used known filter columns', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          LogicalName: 'accounts',
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            { LogicalName: 'name', SchemaName: 'Name', IsFilterable: true },
            { LogicalName: 'accountnumber', SchemaName: 'AccountNumber', IsFilterable: true },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.query({
      table: 'accounts',
      filter: "name eq 'Acme'",
      diagnoseEmptyFilter: true,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain('DATAVERSE_QUERY_EMPTY_FILTER_VALIDATED');
    expect(result.warnings.find((warning) => warning.code === 'DATAVERSE_QUERY_EMPTY_FILTER_VALIDATED')?.detail).toContain('name');
  });

  it('retries a logical table name through its entity-set alias after a missing-collection 404', async () => {
    const httpClient = new FakeHttpClient([
      fail(
        createDiagnostic(
          'error',
          'HTTP_REQUEST_FAILED',
          'GET solution?$select=solutionid,uniquename,friendlyname,version&$top=5&$orderby=uniquename asc&$count=true returned 404',
          {
            source: '@pp/http',
            detail:
              '{"error":{"code":"0x80060888","message":"Resource not found for the segment \'solution\'."}}',
          }
        )
      ),
      ok({
        status: 200,
        headers: {},
        data: {
          LogicalName: 'solution',
          EntitySetName: 'solutions',
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [{ solutionid: 'sol-1', uniquename: 'Core', friendlyname: 'Core', version: '1.0.0.0' }],
          '@odata.count': 1,
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.queryPage<{ solutionid: string; uniquename: string; friendlyname: string; version: string }>({
      table: 'solution',
      select: ['solutionid', 'uniquename', 'friendlyname', 'version'],
      top: 5,
      orderBy: ['uniquename asc'],
      count: true,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      records: [{ solutionid: 'sol-1', uniquename: 'Core', friendlyname: 'Core', version: '1.0.0.0' }],
      count: 1,
      nextLink: undefined,
    });
    expect(httpClient.requests.map((request) => request.path)).toEqual([
      'solution?%24select=solutionid%2Cuniquename%2Cfriendlyname%2Cversion&%24top=5&%24orderby=uniquename+asc&%24count=true',
      "EntityDefinitions(LogicalName='solution')",
      'solutions?%24select=solutionid%2Cuniquename%2Cfriendlyname%2Cversion&%24top=5&%24orderby=uniquename+asc&%24count=true',
    ]);
    expect(result.warnings.map((warning) => warning.code)).toContain('DATAVERSE_QUERY_ENTITY_SET_ALIAS_APPLIED');
  });

  it('mirrors requested lookup ids onto logical field names when Dataverse only returns _value columns', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              systemuserid: 'user-1',
              fullname: 'Callum Alpass',
              _businessunitid_value: 'bu-1',
              isdisabled: false,
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.queryPage<{
      systemuserid: string;
      fullname: string;
      businessunitid?: string;
      isdisabled: boolean;
    }>({
      table: 'systemusers',
      select: ['systemuserid', 'fullname', 'businessunitid', 'isdisabled'],
      filter: 'systemuserid eq user-1',
      top: 1,
    });

    expect(result.success).toBe(true);
    expect(result.data?.records).toEqual([
      {
        systemuserid: 'user-1',
        fullname: 'Callum Alpass',
        businessunitid: 'bu-1',
        _businessunitid_value: 'bu-1',
        isdisabled: false,
      },
    ]);
    expect(result.warnings.map((warning) => warning.code)).toContain('DATAVERSE_QUERY_LOOKUP_VALUE_ALIAS_APPLIED');
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

  it('invokes Dataverse actions through a first-class helper', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {
          location: 'https://example.crm.dynamics.com/api/data/v9.2/ExportSolution',
        },
        data: {
          ExportSolutionFile: 'ZXhwb3J0',
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.invokeAction<{ ExportSolutionFile: string }>('ExportSolution', {
      SolutionName: 'Core',
      Managed: false,
    });

    expect(result.success).toBe(true);
    expect(result.data?.body).toEqual({
      ExportSolutionFile: 'ZXhwb3J0',
    });
    expect(httpClient.requests[0]?.path).toBe('ExportSolution');
    expect(httpClient.requests[0]?.method).toBe('POST');
    expect(httpClient.requests[0]?.body).toEqual({
      SolutionName: 'Core',
      Managed: false,
    });
  });

  it('builds Dataverse function paths with aliased parameters', () => {
    const path = buildDataverseFunctionPath('RetrieveTotalRecordCount', {
      EntityNames: 'account',
      IncludeInternal: false,
    });

    expect(path.success).toBe(true);
    expect(path.data).toBe('RetrieveTotalRecordCount(EntityNames=@p0,IncludeInternal=@p1)?%40p0=%27account%27&%40p1=false');
  });

  it('invokes Dataverse functions through a first-class helper', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          Count: 12,
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.invokeFunction<{ Count: number }>('sample_GetCount', {
      logicalName: 'account',
    });

    expect(result.success).toBe(true);
    expect(result.data?.body).toEqual({
      Count: 12,
    });
    expect(httpClient.requests[0]?.path).toBe("sample_GetCount(logicalName=@p0)?%40p0=%27account%27");
    expect(httpClient.requests[0]?.method).toBe('GET');
  });

  it('executes Dataverse batch requests and parses multipart responses', async () => {
    const boundary = 'batchresponse_123';
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {
          'content-type': `multipart/mixed;boundary=${boundary}`,
        },
        data: `--${boundary}\r
Content-Type: application/http\r
Content-Transfer-Encoding: binary\r
Content-ID: 1\r
\r
HTTP/1.1 200 OK\r
Content-Type: application/json; charset=utf-8\r
\r
{"value":[{"accountid":"1"}]}\r
--${boundary}\r
Content-Type: multipart/mixed;boundary=changesetresponse_456\r
\r
--changesetresponse_456\r
Content-Type: application/http\r
Content-Transfer-Encoding: binary\r
Content-ID: 2\r
\r
HTTP/1.1 204 No Content\r
OData-Version: 4.0\r
\r
\r
--changesetresponse_456--\r
--${boundary}--`,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.executeBatch([
      {
        id: '1',
        method: 'GET',
        path: 'accounts?$select=accountid',
      },
      {
        id: '2',
        method: 'PATCH',
        path: 'accounts(1)',
        body: { name: 'Acme' },
        atomicGroup: 'writes',
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      {
        id: '1',
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        body: {
          value: [{ accountid: '1' }],
        },
        contentId: '1',
      },
      {
        id: '2',
        status: 204,
        headers: {
          'odata-version': '4.0',
        },
        body: undefined,
        contentId: '2',
      },
    ]);
    expect(httpClient.requests[0]?.path).toBe('$batch');
    expect(httpClient.requests[0]?.method).toBe('POST');
    expect(httpClient.requests[0]?.headers?.['content-type']).toContain('multipart/mixed;boundary=batch_');
    expect(typeof httpClient.requests[0]?.rawBody).toBe('string');
    expect(String(httpClient.requests[0]?.rawBody)).toContain('GET /accounts?$select=accountid HTTP/1.1');
    expect(String(httpClient.requests[0]?.rawBody)).toContain('PATCH /accounts(1) HTTP/1.1');
  });

  it('exports row sets with stable query metadata', async () => {
    vi.setSystemTime(new Date('2026-03-10T12:00:00.000Z'));

    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [{ accountid: '1', name: 'Acme' }],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.exportRows<{ accountid: string; name: string }>({
      table: 'accounts',
      select: ['accountid', 'name'],
      filter: "statecode eq 0",
      top: 25,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      kind: 'dataverse-row-set',
      version: 1,
      table: 'accounts',
      exportedAt: '2026-03-10T12:00:00.000Z',
      environmentUrl: 'https://example.crm.dynamics.com',
      query: {
        select: ['accountid', 'name'],
        top: 25,
        filter: 'statecode eq 0',
      },
      recordCount: 1,
      records: [{ accountid: '1', name: 'Acme' }],
    });
  });

  it('applies typed row operations through batch requests', async () => {
    const boundary = 'batchresponse_789';
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {
          'content-type': `multipart/mixed;boundary=${boundary}`,
        },
        data: `--${boundary}\r
Content-Type: application/http\r
Content-Transfer-Encoding: binary\r
Content-ID: create-1\r
\r
HTTP/1.1 201 Created\r
OData-EntityId: https://example.crm.dynamics.com/api/data/v9.2/accounts(00000000-0000-0000-0000-000000000001)\r
Content-Type: application/json; charset=utf-8\r
\r
{"accountid":"00000000-0000-0000-0000-000000000001","name":"Acme"}\r
--${boundary}\r
Content-Type: application/http\r
Content-Transfer-Encoding: binary\r
Content-ID: upsert-1\r
\r
HTTP/1.1 204 No Content\r
OData-Version: 4.0\r
\r
\r
--${boundary}--`,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.applyRows<Record<string, unknown>>(
      [
        {
          kind: 'create',
          requestId: 'create-1',
          table: 'accounts',
          body: { name: 'Acme' },
          returnRepresentation: true,
        },
        {
          kind: 'upsert',
          requestId: 'upsert-1',
          path: "accounts(accountnumber='A-1000')",
          body: { name: 'Acme 2' },
          ifMatch: '*',
        },
      ],
      {
        continueOnError: true,
      }
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      {
        index: 0,
        kind: 'create',
        table: 'accounts',
        recordId: undefined,
        path: 'accounts',
        status: 201,
        headers: {
          'odata-entityid': 'https://example.crm.dynamics.com/api/data/v9.2/accounts(00000000-0000-0000-0000-000000000001)',
          'content-type': 'application/json; charset=utf-8',
        },
        body: {
          accountid: '00000000-0000-0000-0000-000000000001',
          name: 'Acme',
        },
        contentId: 'create-1',
        entityId: '00000000-0000-0000-0000-000000000001',
        location: 'https://example.crm.dynamics.com/api/data/v9.2/accounts(00000000-0000-0000-0000-000000000001)',
      },
      {
        index: 1,
        kind: 'upsert',
        table: undefined,
        recordId: undefined,
        path: "accounts(accountnumber='A-1000')",
        status: 204,
        headers: {
          'odata-version': '4.0',
        },
        body: undefined,
        contentId: 'upsert-1',
        entityId: undefined,
        location: undefined,
      },
    ]);
    expect(httpClient.requests[0]?.headers?.prefer).toContain('odata.continue-on-error');
    expect(String(httpClient.requests[0]?.rawBody)).toContain('POST /accounts HTTP/1.1');
    expect(String(httpClient.requests[0]?.rawBody)).toContain('PATCH /accounts(accountnumber=\'A-1000\') HTTP/1.1');
    expect(String(httpClient.requests[0]?.rawBody)).toContain('prefer: return=representation');
    expect(String(httpClient.requests[0]?.rawBody)).toContain('if-match: *');
  });

  it('adds solution headers to solution-scoped row writes', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 201,
        headers: {
          location: 'https://example.crm.dynamics.com/api/data/v9.2/environmentvariabledefinitions(def-1)',
        },
        data: {
          environmentvariabledefinitionid: 'def-1',
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.create(
      'environmentvariabledefinitions',
      {
        schemaname: 'pp_ApiUrl',
      },
      {
        returnRepresentation: true,
        solutionUniqueName: 'Core',
      }
    );

    expect(result.success).toBe(true);
    expect(httpClient.requests[0]?.headers?.['MSCRM.SolutionUniqueName']).toBe('Core');
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

  it('lists columns for a table from metadata endpoints', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [{ LogicalName: 'name' }, { LogicalName: 'accountnumber' }],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.listColumns('account', {
      select: ['LogicalName'],
      top: 1,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ LogicalName: 'name' }]);
    expect(httpClient.requests[0]?.path).toBe("EntityDefinitions(LogicalName='account')/Attributes?%24select=LogicalName");
    expect(result.warnings.map((warning) => warning.code)).toContain('DATAVERSE_METADATA_TOP_CLIENT_SIDE');
  });

  it('suggests nearby logical names when a query fails on a missing Dataverse property', async () => {
    const httpClient = new FakeHttpClient([
      fail(
        createDiagnostic(
          'error',
          'HTTP_REQUEST_FAILED',
          "GET organizations?%24select=organizationid%2Cfriendlyname returned 400",
          {
            source: '@pp/http',
            detail:
              '{"error":{"code":"0x80060888","message":"Could not find a property named \'friendlyname\' on type \'Microsoft.Dynamics.CRM.organization\'."}}',
          }
        )
      ),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [{ LogicalName: 'name' }, { LogicalName: 'organizationid' }, { LogicalName: 'versionnumber' }],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.query({
      table: 'organizations',
      select: ['organizationid', 'friendlyname'],
      top: 1,
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('HTTP_REQUEST_FAILED');
    expect(result.warnings.map((warning) => warning.code)).toContain('DATAVERSE_QUERY_COLUMNS_SUGGESTED');
    expect(result.suggestedNextActions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Retry the query against organizations'),
        expect.stringContaining('pp dv metadata columns organizations --environment <alias>'),
      ])
    );
    expect(httpClient.requests.map((request) => request.path)).toEqual([
      'organizations?%24select=organizationid%2Cfriendlyname&%24top=1',
      "EntityDefinitions(LogicalName='organizations')/Attributes?%24select=LogicalName",
    ]);
  });

  it('queries rows through a solution-scoped table contract', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [{ solutionid: 'sol-1', uniquename: 'HarnessSolution' }],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [{ objectid: 'entity-1' }],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          MetadataId: 'entity-1',
          LogicalName: 'pp_project',
          EntitySetName: 'pp_projects',
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [{ pp_projectid: 'proj-1', pp_name: 'Alpha' }],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.query({
      table: 'pp_project',
      select: ['pp_projectid', 'pp_name'],
      top: 1,
      solutionUniqueName: 'HarnessSolution',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ pp_projectid: 'proj-1', pp_name: 'Alpha' }]);
    expect(httpClient.requests.map((request) => request.path)).toEqual([
      "solutions?%24select=solutionid%2Cuniquename&%24top=1&%24filter=uniquename+eq+%27HarnessSolution%27",
      'solutioncomponents?%24select=objectid&%24filter=_solutionid_value+eq+sol-1+and+componenttype+eq+1',
      "EntityDefinitions(LogicalName='pp_project')",
      'pp_project?%24select=pp_projectid%2Cpp_name&%24top=1',
    ]);
    expect(httpClient.requests[3]?.headers).toMatchObject({
      'MSCRM.SolutionUniqueName': 'HarnessSolution',
    });
  });

  it('fails solution-scoped queries when the table is outside the requested solution', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [{ solutionid: 'sol-1', uniquename: 'HarnessSolution' }],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [{ objectid: 'entity-1' }],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          MetadataId: 'entity-2',
          LogicalName: 'pp_task',
          EntitySetName: 'pp_tasks',
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            { MetadataId: 'entity-1', LogicalName: 'pp_project', EntitySetName: 'pp_projects' },
            { MetadataId: 'entity-2', LogicalName: 'pp_task', EntitySetName: 'pp_tasks' },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.query({
      table: 'pp_task',
      solutionUniqueName: 'HarnessSolution',
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'DATAVERSE_QUERY_TABLE_NOT_IN_SOLUTION',
        message: 'Dataverse table pp_task is not part of solution HarnessSolution.',
      }),
    ]);
    expect(result.suggestedNextActions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('pp_project'),
        expect.stringContaining('Omit `--solution HarnessSolution`'),
      ])
    );
    expect(httpClient.requests).toHaveLength(4);
  });

  it('retries metadata list filters client-side when Dataverse rejects the server filter', async () => {
    const httpClient = new FakeHttpClient([
      fail(
        createDiagnostic(
          'error',
          'HTTP_REQUEST_FAILED',
          "GET EntityDefinitions?%24select=LogicalName&%24filter=startswith%28LogicalName%2C%27pp_%27%29 returned 501",
          {
            source: '@pp/http',
          }
        )
      ),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [{ LogicalName: 'account' }, { LogicalName: 'pp_project' }, { LogicalName: 'pp_task' }],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.listTables({
      select: ['LogicalName'],
      filter: "startswith(LogicalName,'pp_')",
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ LogicalName: 'pp_project' }, { LogicalName: 'pp_task' }]);
    expect(httpClient.requests).toHaveLength(2);
    expect(httpClient.requests[0]?.path).toBe(
      "EntityDefinitions?%24select=LogicalName&%24filter=startswith%28LogicalName%2C%27pp_%27%29"
    );
    expect(httpClient.requests[1]?.path).toBe('EntityDefinitions?%24select=LogicalName');
    expect(result.warnings.map((warning) => warning.code)).toContain('DATAVERSE_METADATA_FILTER_CLIENT_SIDE');
  });

  it('does not hide metadata filter failures that are not the Dataverse 501 limitation', async () => {
    const httpClient = new FakeHttpClient([
      fail(
        createDiagnostic('error', 'HTTP_REQUEST_FAILED', 'GET EntityDefinitions returned 400', {
          source: '@pp/http',
        })
      ),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.listTables({
      filter: "startswith(LogicalName,'pp_')",
    });

    expect(result.success).toBe(false);
    expect(httpClient.requests).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('returned 400');
  });

  it('gets a specific column from table metadata', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          LogicalName: 'name',
          SchemaName: 'Name',
          AttributeType: 'String',
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.getColumn('account', 'name', {
      select: ['LogicalName', 'SchemaName', 'AttributeType'],
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      LogicalName: 'name',
      SchemaName: 'Name',
      AttributeType: 'String',
    });
    expect(httpClient.requests[0]?.path).toBe(
      "EntityDefinitions(LogicalName='account')/Attributes(LogicalName='name')?%24select=LogicalName%2CSchemaName%2CAttributeType"
    );
  });

  it('suggests the lookup navigation-property schema name when a write payload uses the logical name binding', async () => {
    const httpClient = new FakeHttpClient([
      fail(
        createDiagnostic('error', 'HTTP_REQUEST_FAILED', 'POST pph34135_tasks returned 400', {
          source: '@pp/http',
          detail:
            '{"error":{"code":"0x80048d19","message":"An undeclared property \'pph34135_projectid\' which only has property annotations in the payload but no property value was found in the payload."}}',
        })
      ),
      ok({
        status: 200,
        headers: {},
        data: {
          LogicalName: 'pph34135_projectid',
          SchemaName: 'pph34135_ProjectId',
          AttributeType: 'Lookup',
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.create('pph34135_tasks', {
      'pph34135_projectid@odata.bind': '/pph34135_projects(00000000-0000-0000-0000-000000000001)',
    });

    expect(result.success).toBe(false);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DATAVERSE_WRITE_LOOKUP_BINDING_SUGGESTED',
          message:
            'Lookup column `pph34135_projectid` binds through navigation property `pph34135_ProjectId` on Dataverse table `pph34135_tasks`.',
        }),
      ])
    );
    expect(result.suggestedNextActions).toEqual(
      expect.arrayContaining([
        'Retry the write with `pph34135_ProjectId@odata.bind` instead of `pph34135_projectid@odata.bind`.',
      ])
    );
    expect(httpClient.requests.map((request) => request.path)).toEqual([
      'pph34135_tasks',
      "EntityDefinitions(LogicalName='pph34135_tasks')/Attributes(LogicalName='pph34135_projectid')?%24select=LogicalName%2CSchemaName%2CAttributeType",
    ]);
  });

  it('creates a table, reads it back, and publishes it', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 204,
        headers: {
          location: 'https://example.crm.dynamics.com/api/data/v9.2/EntityDefinitions(00000000-0000-0000-0000-000000000010)',
        },
        data: undefined,
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          LogicalName: 'pp_project',
          SchemaName: 'pp_Project',
          MetadataId: '00000000-0000-0000-0000-000000000010',
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.createTable(
      {
        schemaName: 'pp_Project',
        displayName: 'Project',
        pluralDisplayName: 'Projects',
        primaryName: {
          schemaName: 'pp_Name',
          displayName: 'Name',
          maxLength: 200,
        },
        hasActivities: false,
        hasNotes: true,
        isActivity: false,
        ownership: 'userOwned',
      },
      {
        solutionUniqueName: 'Core',
        publish: true,
      }
    );

    expect(result.success).toBe(true);
    expect(result.data?.published).toBe(true);
    expect(result.data?.publishTargets).toEqual(['pp_project']);
    expect(result.data?.entity).toMatchObject({
      LogicalName: 'pp_project',
      SchemaName: 'pp_Project',
    });
    expect(httpClient.requests[0]?.path).toBe('EntityDefinitions');
    expect(httpClient.requests[0]?.headers?.['MSCRM.SolutionUniqueName']).toBe('Core');
    expect(httpClient.requests[1]?.path).toBe("EntityDefinitions(LogicalName='pp_project')");
    expect(httpClient.requests[2]?.path).toBe('PublishXml');
    expect(httpClient.requests[2]?.body).toEqual({
      ParameterXml: '<importexportxml><entities><entity>pp_project</entity></entities></importexportxml>',
    });
  });

  it('retries throttled metadata create-table requests before failing', async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', {
          status: 429,
        })
      )
      .mockResolvedValueOnce(
        new Response('', {
          status: 429,
        })
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 204,
          headers: {
            location: 'https://example.crm.dynamics.com/api/data/v9.2/EntityDefinitions(00000000-0000-0000-0000-000000000010)',
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            LogicalName: 'pp_project',
            SchemaName: 'pp_Project',
            MetadataId: '00000000-0000-0000-0000-000000000010',
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 204,
        })
      );

    vi.stubGlobal('fetch', fetchMock);

    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' });
    const resultPromise = client.createTable(
      {
        schemaName: 'pp_Project',
        displayName: 'Project',
        pluralDisplayName: 'Projects',
        primaryName: {
          schemaName: 'pp_Name',
          displayName: 'Name',
          maxLength: 200,
        },
        hasActivities: false,
        hasNotes: true,
        isActivity: false,
        ownership: 'userOwned',
      },
      {
        solutionUniqueName: 'Core',
        publish: true,
      }
    );

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://example.crm.dynamics.com/api/data/v9.2/EntityDefinitions');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://example.crm.dynamics.com/api/data/v9.2/EntityDefinitions');
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe('https://example.crm.dynamics.com/api/data/v9.2/EntityDefinitions');
  });

  it('surfaces metadata role guidance when Dataverse rejects table creation with 403', async () => {
    const httpClient = new FakeHttpClient([
      fail(
        createDiagnostic('error', 'HTTP_REQUEST_FAILED', 'POST EntityDefinitions returned 403', {
          source: '@pp/http',
          detail: JSON.stringify({
            error: {
              code: '0x80040220',
              message: 'Principal user is missing prvCreateEntity privilege.',
            },
          }),
        })
      ),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.createTable({
      schemaName: 'pp_Project',
      displayName: 'Project',
      pluralDisplayName: 'Projects',
      ownership: 'userOwned',
      hasActivities: false,
      hasNotes: false,
      isActivity: false,
      primaryName: {
        schemaName: 'pp_Name',
        displayName: 'Name',
        maxLength: 100,
      },
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'DATAVERSE_METADATA_WRITE_FORBIDDEN',
      message:
        'Dataverse rejected create Dataverse table metadata with 403 Forbidden. The caller likely lacks metadata customization privileges in this environment.',
      source: '@pp/dataverse',
    });
    expect(result.diagnostics[0]?.detail).toContain('Endpoint: EntityDefinitions.');
    expect(result.diagnostics[0]?.detail).toContain('Dataverse error code: 0x80040220.');
    expect(result.diagnostics[0]?.detail).toContain('Principal user is missing prvCreateEntity privilege.');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'HTTP_REQUEST_FAILED',
          message: 'POST EntityDefinitions returned 403',
        }),
      ])
    );
    expect(result.suggestedNextActions).toEqual(
      expect.arrayContaining([
        'Confirm the signed-in user has Dataverse metadata customization privileges for tables, columns, and relationships in this environment.',
        'If the environment is locked down, ask a Dataverse admin to assign System Customizer, System Administrator, or an equivalent custom role before retrying.',
      ])
    );
    expect(result.details).toMatchObject({
      category: 'metadata-write-forbidden',
      endpoint: 'EntityDefinitions',
      operation: 'create Dataverse table metadata',
      httpStatus: 403,
      dataverseErrorCode: '0x80040220',
      dataverseErrorMessage: 'Principal user is missing prvCreateEntity privilege.',
    });
  });

  it('creates a global option set and publishes the option set definition', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          Name: 'pp_status',
          MetadataId: '00000000-0000-0000-0000-000000000020',
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.createGlobalOptionSet(
      {
        name: 'pp_status',
        displayName: 'Status',
        options: [{ label: 'New', value: 100000000 }],
      },
      {
        publish: true,
      }
    );

    expect(result.success).toBe(true);
    expect(result.data?.published).toBe(true);
    expect(httpClient.requests[0]?.path).toBe('GlobalOptionSetDefinitions');
    expect(httpClient.requests[1]?.path).toBe("GlobalOptionSetDefinitions(Name='pp_status')");
    expect(httpClient.requests[2]?.body).toEqual({
      ParameterXml: '<importexportxml><optionsets><optionset>pp_status</optionset></optionsets></importexportxml>',
    });
  });

  it('creates a one-to-many relationship and publishes both affected entities', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          SchemaName: 'pp_project_account',
          MetadataId: 'relationship-1',
          RelationshipType: 'OneToManyRelationship',
          ReferencedEntity: 'account',
          ReferencedAttribute: 'accountid',
          ReferencingEntity: 'pp_project',
          ReferencingAttribute: 'pp_accountid',
          AssociatedMenuConfiguration: {
            Behavior: 'UseCollectionName',
            Group: 'Details',
            Order: 10000,
            Label: {
              UserLocalizedLabel: {
                Label: 'Account',
              },
            },
          },
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.createOneToManyRelationship(
      {
        schemaName: 'pp_project_account',
        referencedEntity: 'account',
        referencedAttribute: 'id',
        referencingEntity: 'pp_project',
        lookup: {
          schemaName: 'pp_AccountId',
          displayName: 'Account',
        },
        associatedMenuBehavior: 'useCollectionName',
        associatedMenuGroup: 'details',
        associatedMenuOrder: 10000,
      },
      {
        publish: true,
      }
    );

    expect(result.success).toBe(true);
    expect(result.data?.entitySummary).toEqual({
      associatedMenuBehavior: 'UseCollectionName',
      associatedMenuGroup: 'Details',
      associatedMenuLabel: 'Account',
      associatedMenuOrder: 10000,
      metadataId: 'relationship-1',
      referencedAttribute: 'accountid',
      referencedEntity: 'account',
      referencingAttribute: 'pp_accountid',
      referencingEntity: 'pp_project',
      relationshipType: 'one-to-many',
      schemaName: 'pp_project_account',
      lookupLogicalName: 'pp_accountid',
    });
    expect(result.data?.publishTargets).toEqual(['account', 'pp_project']);
    expect(httpClient.requests[0]?.path).toBe('RelationshipDefinitions');
    expect(httpClient.requests[1]?.path).toBe(
      "RelationshipDefinitions(SchemaName='pp_project_account')/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata"
    );
    expect(httpClient.requests[2]?.body).toEqual({
      ParameterXml: '<importexportxml><entities><entity>account</entity><entity>pp_project</entity></entities></importexportxml>',
    });
  });

  it('updates a global option set through action calls and publishes the option set', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          NewOptionValue: 100000002,
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          Name: 'pp_status',
          MetadataId: '00000000-0000-0000-0000-000000000020',
          Options: [{ Value: 100000000 }, { Value: 100000001 }, { Value: 100000002 }],
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.updateGlobalOptionSet(
      {
        name: 'pp_status',
        add: [{ label: 'Paused' }],
        update: [{ value: 100000000, label: 'New', mergeLabels: true }],
        removeValues: [100000009],
        orderValues: [100000000, 100000001, 100000002],
      },
      {
        publish: true,
      }
    );

    expect(result.success).toBe(true);
    expect(result.data?.published).toBe(true);
    expect(httpClient.requests.map((request) => request.path)).toEqual([
      'InsertOptionValue',
      'UpdateOptionValue',
      'DeleteOptionValue',
      'OrderOption',
      "GlobalOptionSetDefinitions(Name='pp_status')",
      'PublishXml',
    ]);
    expect(httpClient.requests[0]?.body).toMatchObject({
      OptionSetName: 'pp_status',
    });
    expect(httpClient.requests[5]?.body).toEqual({
      ParameterXml: '<importexportxml><optionsets><optionset>pp_status</optionset></optionsets></importexportxml>',
    });
  });

  it('updates table metadata through a typed metadata PUT and publishes the entity', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          '@odata.type': 'Microsoft.Dynamics.CRM.EntityMetadata',
          LogicalName: 'pp_project',
          SchemaName: 'pp_Project',
          MetadataId: '00000000-0000-0000-0000-000000000010',
          DisplayName: {
            UserLocalizedLabel: {
              Label: 'Project',
            },
          },
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          '@odata.type': 'Microsoft.Dynamics.CRM.EntityMetadata',
          LogicalName: 'pp_project',
          SchemaName: 'pp_Project',
          MetadataId: '00000000-0000-0000-0000-000000000010',
          DisplayName: {
            UserLocalizedLabel: {
              Label: 'Projects',
            },
          },
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.updateTable(
      'pp_project',
      {
        displayName: 'Projects',
      },
      {
        publish: true,
      }
    );

    expect(result.success).toBe(true);
    expect(httpClient.requests.map((request) => request.path)).toEqual([
      "EntityDefinitions(LogicalName='pp_project')",
      "EntityDefinitions(LogicalName='pp_project')",
      "EntityDefinitions(LogicalName='pp_project')",
      'PublishXml',
    ]);
    expect(httpClient.requests[1]?.method).toBe('PUT');
    expect(httpClient.requests[1]?.body).toMatchObject({
      LogicalName: 'pp_project',
      DisplayName: {
        UserLocalizedLabel: {
          Label: 'Projects',
        },
      },
    });
  });

  it('updates column metadata through a typed metadata PUT and publishes the parent entity', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          '@odata.type': 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata',
          LogicalName: 'pp_active',
          SchemaName: 'pp_Active',
          MetadataId: '00000000-0000-0000-0000-000000000011',
          DisplayName: {
            UserLocalizedLabel: {
              Label: 'Active',
            },
          },
          OptionSet: {
            TrueOption: {
              Label: {
                UserLocalizedLabel: {
                  Label: 'Yes',
                },
              },
            },
            FalseOption: {
              Label: {
                UserLocalizedLabel: {
                  Label: 'No',
                },
              },
            },
          },
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          '@odata.type': 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata',
          LogicalName: 'pp_active',
          SchemaName: 'pp_Active',
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.updateColumn(
      'pp_project',
      'pp_active',
      {
        displayName: 'Enabled',
        trueLabel: 'Enabled',
        falseLabel: 'Disabled',
      },
      {
        publish: true,
      }
    );

    expect(result.success).toBe(true);
    expect(httpClient.requests[1]?.method).toBe('PUT');
    expect(httpClient.requests[1]?.path).toBe("EntityDefinitions(LogicalName='pp_project')/Attributes(LogicalName='pp_active')");
    expect(httpClient.requests[1]?.body).toMatchObject({
      LogicalName: 'pp_active',
      DisplayName: {
        UserLocalizedLabel: {
          Label: 'Enabled',
        },
      },
      OptionSet: {
        TrueOption: {
          Label: {
            UserLocalizedLabel: {
              Label: 'Enabled',
            },
          },
        },
        FalseOption: {
          Label: {
            UserLocalizedLabel: {
              Label: 'Disabled',
            },
          },
        },
      },
    });
  });

  it('updates one-to-many relationships through a typed metadata PUT and publishes both entities', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          '@odata.type': 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata',
          SchemaName: 'pp_project_account',
          ReferencedEntity: 'account',
          ReferencingEntity: 'pp_project',
          Lookup: {
            DisplayName: {
              UserLocalizedLabel: {
                Label: 'Account',
              },
            },
          },
          AssociatedMenuConfiguration: {
            Label: {
              UserLocalizedLabel: {
                Label: 'Account',
              },
            },
            Behavior: 'UseCollectionName',
            Group: 'Details',
            Order: 10000,
          },
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          '@odata.type': 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata',
          SchemaName: 'pp_project_account',
          ReferencedEntity: 'account',
          ReferencingEntity: 'pp_project',
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.updateRelationship(
      'pp_project_account',
      'one-to-many',
      {
        associatedMenuLabel: 'Customers',
        associatedMenuBehavior: 'useLabel',
      },
      {
        publish: true,
      }
    );

    expect(result.success).toBe(true);
    expect(httpClient.requests[1]?.method).toBe('PUT');
    expect(httpClient.requests[1]?.path).toBe(
      "RelationshipDefinitions(SchemaName='pp_project_account')/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata"
    );
    expect(httpClient.requests[1]?.body).toMatchObject({
      SchemaName: 'pp_project_account',
      AssociatedMenuConfiguration: {
        Behavior: 'UseLabel',
        Label: {
          UserLocalizedLabel: {
            Label: 'Customers',
          },
        },
      },
    });
    expect(httpClient.requests[3]?.body).toEqual({
      ParameterXml: '<importexportxml><entities><entity>account</entity><entity>pp_project</entity></entities></importexportxml>',
    });
  });

  it('applies a mixed metadata plan in dependency-safe order and publishes once', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          Name: 'pp_status',
          MetadataId: '00000000-0000-0000-0000-000000000020',
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          LogicalName: 'pp_project',
          SchemaName: 'pp_Project',
          MetadataId: '00000000-0000-0000-0000-000000000010',
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          LogicalName: 'pp_statusreason',
          SchemaName: 'pp_StatusReason',
          MetadataId: '00000000-0000-0000-0000-000000000011',
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          SchemaName: 'pp_project_task',
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.applyMetadataPlan(
      {
        operations: [
          {
            kind: 'create-relationship',
            spec: {
              schemaName: 'pp_project_task',
              referencedEntity: 'pp_project',
              referencedAttribute: 'id',
              referencingEntity: 'pp_task',
              lookup: {
                schemaName: 'pp_ProjectId',
                displayName: 'Project',
              },
              associatedMenuBehavior: 'useCollectionName',
              associatedMenuGroup: 'details',
              associatedMenuOrder: 10000,
            },
          },
          {
            kind: 'add-column',
            tableLogicalName: 'pp_project',
            spec: {
              kind: 'choice',
              schemaName: 'pp_StatusReason',
              displayName: 'Status Reason',
              globalOptionSetName: 'pp_status',
            },
          },
          {
            kind: 'create-table',
            spec: {
              schemaName: 'pp_Project',
              displayName: 'Project',
              pluralDisplayName: 'Projects',
              primaryName: {
                schemaName: 'pp_Name',
                displayName: 'Name',
                maxLength: 200,
              },
              hasActivities: false,
              hasNotes: true,
              isActivity: false,
              ownership: 'userOwned',
            },
          },
          {
            kind: 'create-option-set',
            spec: {
              name: 'pp_status',
              displayName: 'Status',
              options: [{ label: 'New', value: 100000000 }],
            },
          },
        ],
      },
      {
        solutionUniqueName: 'Core',
        publish: true,
      }
    );

    expect(result.success).toBe(true);
    expect(result.data?.published).toBe(true);
    expect(result.data?.publishTargets).toEqual(['pp_project', 'pp_task']);
    expect(result.data?.optionSetPublishTargets).toEqual(['pp_status']);
    expect(result.data?.operations.map((operation) => operation.kind)).toEqual([
      'create-option-set',
      'create-table',
      'add-column',
      'create-relationship',
    ]);
    expect(result.data?.operations[0]).toMatchObject({
      kind: 'create-option-set',
    });
    expect(result.data?.operations[1]).toMatchObject({
      kind: 'create-table',
      entitySummary: {
        logicalName: 'pp_project',
        schemaName: 'pp_Project',
      },
    });
    expect(result.data?.operations[2]).toMatchObject({
      kind: 'add-column',
      entitySummary: {
        logicalName: 'pp_statusreason',
      },
    });
    expect(result.data?.operations[3]).toMatchObject({
      kind: 'create-relationship',
      entitySummary: {
        schemaName: 'pp_project_task',
      },
    });
    expect(result.data?.summary).toEqual({
      operationCount: 4,
      operationsByKind: {
        'create-option-set': 1,
        'create-table': 1,
        'add-column': 1,
        'create-relationship': 1,
      },
      optionSets: [
        expect.objectContaining({
          name: 'pp_status',
        }),
      ],
      tables: [
        expect.objectContaining({
          logicalName: 'pp_project',
          schemaName: 'pp_Project',
        }),
      ],
      columns: [
        expect.objectContaining({
          logicalName: 'pp_statusreason',
        }),
      ],
      relationships: [
        expect.objectContaining({
          schemaName: 'pp_project_task',
        }),
      ],
    });
    expect(httpClient.requests.map((request) => request.path)).toEqual([
      'GlobalOptionSetDefinitions',
      "GlobalOptionSetDefinitions(Name='pp_status')",
      'EntityDefinitions',
      "EntityDefinitions(LogicalName='pp_project')",
      "EntityDefinitions(LogicalName='pp_project')/Attributes",
      "EntityDefinitions(LogicalName='pp_project')/Attributes(LogicalName='pp_statusreason')",
      'RelationshipDefinitions',
      "RelationshipDefinitions(SchemaName='pp_project_task')/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
      'PublishXml',
    ]);
    expect(httpClient.requests[8]?.body).toEqual({
      ParameterXml:
        '<importexportxml><entities><entity>pp_project</entity><entity>pp_task</entity></entities><optionsets><optionset>pp_status</optionset></optionsets></importexportxml>',
    });
  });

  it('creates a many-to-many relationship and publishes both entities', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          '@odata.type': '#Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata',
          SchemaName: 'pp_project_contact',
          Entity1LogicalName: 'pp_project',
          Entity2LogicalName: 'contact',
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.createManyToManyRelationship(
      {
        schemaName: 'pp_project_contact',
        entity1LogicalName: 'pp_project',
        entity2LogicalName: 'contact',
      },
      {
        publish: true,
      }
    );

    expect(result.success).toBe(true);
    expect(result.data?.publishTargets).toEqual(['pp_project', 'contact']);
    expect(httpClient.requests[1]?.path).toBe(
      "RelationshipDefinitions(SchemaName='pp_project_contact')/Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata"
    );
    expect(httpClient.requests[2]?.body).toEqual({
      ParameterXml: '<importexportxml><entities><entity>pp_project</entity><entity>contact</entity></entities></importexportxml>',
    });
  });

  it('creates customer relationships and publishes all affected entities', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {},
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          '@odata.type': '#Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata',
          SchemaName: 'pp_project_pp_customerid_account',
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          '@odata.type': '#Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata',
          SchemaName: 'pp_project_pp_customerid_contact',
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.createCustomerRelationship(
      {
        tableLogicalName: 'pp_project',
        lookup: {
          schemaName: 'pp_CustomerId',
          displayName: 'Customer',
        },
        accountReferencedAttribute: 'id',
        contactReferencedAttribute: 'id',
      },
      {
        publish: true,
      }
    );

    expect(result.success).toBe(true);
    expect(httpClient.requests[0]?.path).toBe('CreateCustomerRelationships');
    expect(httpClient.requests[1]?.path).toBe(
      "RelationshipDefinitions(SchemaName='pp_project_pp_customerid_account')/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata"
    );
    expect(httpClient.requests[2]?.path).toBe(
      "RelationshipDefinitions(SchemaName='pp_project_pp_customerid_contact')/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata"
    );
    expect(httpClient.requests[3]?.body).toEqual({
      ParameterXml: '<importexportxml><entities><entity>account</entity><entity>contact</entity><entity>pp_project</entity></entities></importexportxml>',
    });
  });

  it('falls back across relationship kinds when reading a relationship', async () => {
    const httpClient = new FakeHttpClient([
      {
        success: false,
        diagnostics: [
          {
            level: 'error',
            code: 'HTTP_REQUEST_FAILED',
            message: 'Not found',
          },
        ],
        warnings: [],
        supportTier: 'preview',
      },
      ok({
        status: 200,
        headers: {},
        data: {
          '@odata.type': '#Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata',
          SchemaName: 'pp_project_contact',
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.getRelationship('pp_project_contact');

    expect(result.success).toBe(true);
    expect(httpClient.requests.map((request) => request.path)).toEqual([
      "RelationshipDefinitions(SchemaName='pp_project_contact')/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
      "RelationshipDefinitions(SchemaName='pp_project_contact')/Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata",
    ]);
    expect(result.warnings.map((warning) => warning.code)).toContain('DATAVERSE_RELATIONSHIP_KIND_READ_FAILED');
  });
});

describe('ALM services', () => {
  it('lists and validates connection references', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              connectionreferenceid: 'ref-1',
              connectionreferencelogicalname: 'pp_shared',
              displayname: 'Shared Connector',
              connectorid: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
              connectionid: 'conn-1',
              statecode: 0,
            },
            {
              connectionreferenceid: 'ref-2',
              connectionreferencelogicalname: 'pp_missing',
              displayname: 'Broken Connector',
              statecode: 0,
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              connectionreferenceid: 'ref-1',
              connectionreferencelogicalname: 'pp_shared',
              displayname: 'Shared Connector',
              connectorid: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
              connectionid: 'conn-1',
              statecode: 0,
            },
            {
              connectionreferenceid: 'ref-2',
              connectionreferencelogicalname: 'pp_missing',
              displayname: 'Broken Connector',
              statecode: 0,
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ConnectionReferenceService(client);

    const listed = await service.list();
    const validated = await service.validate();

    expect(listed.success).toBe(true);
    expect(listed.data?.[0]).toMatchObject({
      id: 'ref-1',
      logicalName: 'pp_shared',
      connected: true,
    });
    expect(validated.success).toBe(true);
    expect(validated.data?.find((item) => item.reference.id === 'ref-2')).toMatchObject({
      valid: false,
    });
    expect(listed.diagnostics.map((diagnostic) => diagnostic.code)).toContain('DATAVERSE_CONNREF_LIST_SUMMARY');
    expect(validated.diagnostics.map((diagnostic) => diagnostic.code)).toContain('DATAVERSE_CONNREF_VALIDATE_SUMMARY');
  });

  it('falls back to per-record inspection for solution-scoped connection references when the bulk query fails', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              solutionid: 'solution-1',
              uniquename: 'HarnessShell',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              objectid: 'ref-1',
            },
          ],
        },
      }),
      fail(createDiagnostic('error', 'HTTP_UNHANDLED_ERROR', 'fetch failed', { source: '@pp/http' }), {
        supportTier: 'preview',
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          connectionreferenceid: 'ref-1',
          connectionreferencelogicalname: 'pp_shared',
          connectionreferencedisplayname: 'Shared Connector',
          connectorid: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
          connectionid: 'conn-1',
          statecode: 0,
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ConnectionReferenceService(client);

    const result = await service.list({ solutionUniqueName: 'HarnessShell' });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({
      id: 'ref-1',
      logicalName: 'pp_shared',
      displayName: 'Shared Connector',
    });
    expect(result.warnings.map((warning) => warning.code)).toContain('DATAVERSE_CONNREF_QUERY_FALLBACK');
  });

  it('reports empty validation scope explicitly', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ConnectionReferenceService(client);

    const result = await service.validate();

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DATAVERSE_CONNREF_SCOPE_EMPTY',
        }),
        expect.objectContaining({
          code: 'DATAVERSE_CONNREF_VALIDATE_EMPTY',
        }),
      ])
    );
  });

  it('surfaces embedded flow connection references when solution-scoped connrefs are empty', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              objectid: 'flow-1',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              workflowid: 'flow-1',
              name: 'Integrated Search API trigger flow',
              category: 5,
              clientdata: JSON.stringify({
                properties: {
                  connectionReferences: {
                    shared_commondataserviceforapps: {
                      connection: {
                        connectionReferenceLogicalName: 'msdyn_Dataverse',
                      },
                    },
                  },
                },
              }),
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ConnectionReferenceService(client);

    const result = await service.validate({ solutionUniqueName: 'Core' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      expect.objectContaining({
        reference: expect.objectContaining({
          id: 'inferred:msdyn_Dataverse',
          kind: 'inferred',
          logicalName: 'msdyn_Dataverse',
          displayName: 'msdyn_Dataverse',
          solutionId: 'sol-1',
          connected: false,
        }),
        valid: false,
      }),
    ]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DATAVERSE_CONNREF_INFERRED_FROM_FLOWS',
          message: expect.stringContaining('msdyn_Dataverse'),
        }),
      ])
    );
    expect(result.data?.[0]?.diagnostics.map((diagnostic) => diagnostic.code)).toContain('DATAVERSE_CONNREF_ROW_INFERRED');
  });

  it('queries connection references with the live display-name column', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              connectionreferenceid: 'ref-1',
              connectionreferencelogicalname: 'pp_shared',
              connectionreferencedisplayname: 'Shared Connector',
              connectorid: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
              connectionid: 'conn-1',
              statecode: 0,
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ConnectionReferenceService(client);

    const result = await service.list();

    expect(result.success).toBe(true);
    expect(result.data?.[0]).toMatchObject({
      id: 'ref-1',
      logicalName: 'pp_shared',
      displayName: 'Shared Connector',
      connected: true,
    });
    expect(httpClient.requests.at(-1)?.path).toBe(
      'connectionreferences?%24select=connectionreferenceid%2Cconnectionreferencelogicalname%2Cconnectionreferencedisplayname%2Cconnectorid%2Cconnectionid%2Cstatecode%2Ccustomconnectorid'
    );
  });

  it('retries connection references without unsupported optional columns', async () => {
    const httpClient = new FakeHttpClient([
      {
        success: false,
        diagnostics: [
          {
            level: 'error',
            code: 'HTTP_REQUEST_FAILED',
            message:
              'GET connectionreferences?%24select=connectionreferenceid%2Cconnectionreferencelogicalname%2Cconnectionreferencedisplayname%2Cconnectorid%2Cconnectionid%2Ccustomconnectorid%2Cstatecode returned 400',
            detail:
              '{"error":{"code":"0x80060888","message":"Could not find a property named \'customconnectorid\' on type \'Microsoft.Dynamics.CRM.connectionreference\'."}}',
            source: '@pp/http',
          },
        ],
        warnings: [],
        supportTier: 'preview',
      },
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              connectionreferenceid: 'ref-1',
              connectionreferencelogicalname: 'pp_shared',
              connectionreferencedisplayname: 'Shared Connector',
              connectorid: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
              connectionid: 'conn-1',
              statecode: 0,
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ConnectionReferenceService(client);

    const result = await service.list();

    expect(result.success).toBe(true);
    expect(result.data?.[0]).toMatchObject({
      id: 'ref-1',
      logicalName: 'pp_shared',
      customConnectorId: undefined,
      connected: true,
    });
    expect(httpClient.requests.map((request) => request.path)).toEqual([
      'connectionreferences?%24select=connectionreferenceid%2Cconnectionreferencelogicalname%2Cconnectionreferencedisplayname%2Cconnectorid%2Cconnectionid%2Cstatecode%2Ccustomconnectorid',
      'connectionreferences?%24select=connectionreferenceid%2Cconnectionreferencelogicalname%2Cconnectionreferencedisplayname%2Cconnectorid%2Cconnectionid%2Cstatecode',
    ]);
    expect(result.warnings.map((warning) => warning.code)).toContain('DATAVERSE_CONNREF_OPTIONAL_COLUMNS_UNAVAILABLE');
  });

  it('filters connection references by solution components when rows omit a solution lookup column', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              objectid: 'ref-1',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              connectionreferenceid: 'ref-1',
              connectionreferencelogicalname: 'pp_shared',
              connectionreferencedisplayname: 'Shared Connector',
              connectorid: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
              connectionid: 'conn-1',
              statecode: 0,
            },
            {
              connectionreferenceid: 'ref-2',
              connectionreferencelogicalname: 'pp_other',
              connectionreferencedisplayname: 'Other Connector',
              connectorid: '/providers/Microsoft.PowerApps/apis/shared_office365',
              connectionid: 'conn-2',
              statecode: 0,
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ConnectionReferenceService(client);

    const result = await service.list({ solutionUniqueName: 'Core' });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({
      id: 'ref-1',
      logicalName: 'pp_shared',
      displayName: 'Shared Connector',
      solutionId: 'sol-1',
      connected: true,
    });
    expect(httpClient.requests[1]?.path).toBe(
      'solutioncomponents?%24select=objectid&%24filter=_solutionid_value+eq+sol-1+and+componenttype+eq+371'
    );
  });

  it('validates an empty solution after retrying without unsupported optional columns', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              solutionid: 'sol-1',
              uniquename: 'Harness',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [],
        },
      }),
      {
        success: false,
        diagnostics: [
          {
            level: 'error',
            code: 'HTTP_REQUEST_FAILED',
            message:
              'GET connectionreferences?%24select=connectionreferenceid%2Cconnectionreferencelogicalname%2Cconnectionreferencedisplayname%2Cconnectorid%2Cconnectionid%2Ccustomconnectorid%2C_solutionid_value%2Cstatecode returned 400',
            detail:
              '{"error":{"code":"0x80060888","message":"Could not find a property named \'customconnectorid\' on type \'Microsoft.Dynamics.CRM.connectionreference\'."}}',
            source: '@pp/http',
          },
        ],
        warnings: [],
        supportTier: 'preview',
      },
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              connectionreferenceid: 'ref-1',
              connectionreferencelogicalname: 'pp_shared',
              connectionreferencedisplayname: 'Shared Connector',
              connectorid: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
              connectionid: 'conn-1',
              statecode: 0,
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ConnectionReferenceService(client);

    const result = await service.validate({ solutionUniqueName: 'Harness' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).not.toContain('DATAVERSE_CONNREF_OPTIONAL_COLUMNS_UNAVAILABLE');
    expect(httpClient.requests.map((request) => request.path)).toEqual([
      'solutions?%24select=solutionid%2Cuniquename&%24top=1&%24filter=uniquename+eq+%27Harness%27',
      'solutioncomponents?%24select=objectid&%24filter=_solutionid_value+eq+sol-1+and+componenttype+eq+371',
      'connectionreferences?%24select=connectionreferenceid%2Cconnectionreferencelogicalname%2Cconnectionreferencedisplayname%2Cconnectorid%2Cconnectionid%2Cstatecode%2Ccustomconnectorid',
      'connectionreferences?%24select=connectionreferenceid%2Cconnectionreferencelogicalname%2Cconnectionreferencedisplayname%2Cconnectorid%2Cconnectionid%2Cstatecode',
      'solutioncomponents?%24select=objectid&%24filter=_solutionid_value+eq+sol-1+and+componenttype+eq+29',
    ]);
  });

  it('joins environment variable definitions with current values', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              environmentvariabledefinitionid: 'def-1',
              schemaname: 'pp_ApiUrl',
              displayname: 'API URL',
              defaultvalue: 'https://default.example.test',
              type: 'String',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              environmentvariablevalueid: 'val-1',
              value: 'https://current.example.test',
              _environmentvariabledefinitionid_value: 'def-1',
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new EnvironmentVariableService(client);

    const result = await service.list();

    expect(result.success).toBe(true);
    expect(result.data?.[0]).toMatchObject({
      definitionId: 'def-1',
      schemaName: 'pp_ApiUrl',
      currentValue: 'https://current.example.test',
      effectiveValue: 'https://current.example.test',
      hasCurrentValue: true,
    });
    expect(httpClient.requests[0]?.path).toBe(
      'environmentvariabledefinitions?%24select=environmentvariabledefinitionid%2Cschemaname%2Cdisplayname%2Cdefaultvalue%2Ctype%2Cvalueschema%2Csecretstore'
    );
  });

  it('updates an existing environment variable value', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              environmentvariabledefinitionid: 'def-1',
              schemaname: 'pp_ApiUrl',
              displayname: 'API URL',
              defaultvalue: 'https://default.example.test',
              type: 'String',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              environmentvariablevalueid: 'val-1',
              value: 'https://current.example.test',
              _environmentvariabledefinitionid_value: 'def-1',
            },
          ],
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new EnvironmentVariableService(client);

    const result = await service.setValue('pp_ApiUrl', 'https://next.example.test');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      definitionId: 'def-1',
      currentValue: 'https://next.example.test',
      valueId: 'val-1',
      hasCurrentValue: true,
    });
    expect(httpClient.requests.at(-1)?.method).toBe('PATCH');
    expect(httpClient.requests.at(-1)?.path).toBe('environmentvariablevalues(val-1)');
  });

  it('creates a current environment variable value using the Dataverse navigation-property casing', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              environmentvariabledefinitionid: 'def-1',
              schemaname: 'pp_ApiUrl',
              displayname: 'API URL',
              defaultvalue: 'https://default.example.test',
              type: 'String',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [],
        },
      }),
      ok({
        status: 201,
        headers: {
          location: 'https://example.crm.dynamics.com/api/data/v9.2/environmentvariablevalues(val-2)',
        },
        data: undefined,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new EnvironmentVariableService(client);

    const result = await service.setValue('pp_ApiUrl', 'https://next.example.test');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      definitionId: 'def-1',
      currentValue: 'https://next.example.test',
      hasCurrentValue: true,
    });
    expect(httpClient.requests.at(-1)?.method).toBe('POST');
    expect(httpClient.requests.at(-1)?.path).toBe('environmentvariablevalues');
    expect(httpClient.requests.at(-1)?.body).toEqual({
      value: 'https://next.example.test',
      'EnvironmentVariableDefinitionId@odata.bind': '/environmentvariabledefinitions(def-1)',
    });
  });

  it('creates an environment variable definition within a solution', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 201,
        headers: {
          location: 'https://example.crm.dynamics.com/api/data/v9.2/environmentvariabledefinitions(def-1)',
        },
        data: {
          environmentvariabledefinitionid: 'def-1',
          schemaname: 'pp_ApiUrl',
          displayname: 'API URL',
          defaultvalue: 'https://default.example.test',
          type: '100000000',
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new EnvironmentVariableService(client);

    const result = await service.createDefinition('pp_ApiUrl', {
      displayName: 'API URL',
      defaultValue: 'https://default.example.test',
      solutionUniqueName: 'Core',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      definitionId: 'def-1',
      schemaName: 'pp_ApiUrl',
      displayName: 'API URL',
      defaultValue: 'https://default.example.test',
      effectiveValue: 'https://default.example.test',
      hasCurrentValue: false,
    });
    expect(httpClient.requests[0]?.method).toBe('POST');
    expect(httpClient.requests[0]?.path).toBe('environmentvariabledefinitions');
    expect(httpClient.requests[0]?.headers?.['MSCRM.SolutionUniqueName']).toBe('Core');
  });

  it('returns reuse guidance when creating an environment variable collides with an existing schema name', async () => {
    const httpClient = new FakeHttpClient([
      {
        success: false,
        diagnostics: [
          {
            level: 'error',
            code: 'HTTP_REQUEST_FAILED',
            message: 'POST environmentvariabledefinitions returned 400',
            detail: '{"error":{"code":"0x80040265","message":"A record with the specified key values already exists."}}',
            source: '@pp/http',
          },
        ],
        warnings: [],
        supportTier: 'preview',
      },
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              environmentvariabledefinitionid: 'def-1',
              schemaname: 'pp_ApiUrl',
              displayname: 'API URL',
              defaultvalue: 'https://default.example.test',
              type: 'String',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new EnvironmentVariableService(client);

    const result = await service.createDefinition('pp_ApiUrl', {
      solutionUniqueName: 'Core',
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DATAVERSE_ENVVAR_SCHEMA_EXISTS',
          message: 'Environment variable pp_ApiUrl already exists in the target environment.',
          detail: expect.stringContaining('not currently visible in requested solution Core'),
        }),
      ])
    );
    expect(result.suggestedNextActions).toEqual(
      expect.arrayContaining([
        'Run `pp envvar inspect pp_ApiUrl --environment <alias> --format json` to inspect the existing definition and current value.',
        'Reuse the existing definition with `pp envvar set pp_ApiUrl --environment <alias> --solution Core --value VALUE` if a shared definition is acceptable.',
      ])
    );
  });

  it('filters environment variables by solution components when definition rows omit solution lookup columns', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              environmentvariabledefinitionid: 'def-1',
              schemaname: 'pp_ApiUrl',
              displayname: 'API URL',
              defaultvalue: 'https://default.example.test',
              type: 'String',
            },
            {
              environmentvariabledefinitionid: 'def-2',
              schemaname: 'pp_Mode',
              displayname: 'Mode',
              defaultvalue: 'Default',
              type: 'String',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              environmentvariablevalueid: 'val-1',
              value: 'https://current.example.test',
              _environmentvariabledefinitionid_value: 'def-1',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              objectid: 'def-1',
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new EnvironmentVariableService(client);

    const result = await service.list({ solutionUniqueName: 'Core' });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({
      definitionId: 'def-1',
      schemaName: 'pp_ApiUrl',
      currentValue: 'https://current.example.test',
    });
    expect(httpClient.requests[3]?.path).toBe(
      'solutioncomponents?%24select=objectid&%24filter=_solutionid_value+eq+sol-1+and+componenttype+eq+380'
    );
  });

  it('prefers active populated current values when multiple value rows exist for one definition', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              environmentvariabledefinitionid: 'def-1',
              schemaname: 'pp_ApiUrl',
              displayname: 'API URL',
              defaultvalue: 'https://default.example.test',
              type: 'String',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              environmentvariablevalueid: 'val-empty',
              _environmentvariabledefinitionid_value: 'def-1',
              statecode: 0,
            },
            {
              environmentvariablevalueid: 'val-current',
              value: 'https://current.example.test',
              _environmentvariabledefinitionid_value: 'def-1',
              statecode: 0,
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              objectid: 'def-1',
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new EnvironmentVariableService(client);

    const result = await service.list({ solutionUniqueName: 'Core' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      expect.objectContaining({
        definitionId: 'def-1',
        currentValue: 'https://current.example.test',
        effectiveValue: 'https://current.example.test',
        hasCurrentValue: true,
        valueId: 'val-current',
      }),
    ]);
    expect(httpClient.requests[1]?.path).toBe(
      'environmentvariablevalues?%24select=environmentvariablevalueid%2Cvalue%2C_environmentvariabledefinitionid_value%2Cstatecode&%24filter=statecode+eq+0'
    );
  });

  it('updates an existing environment variable value within a solution without querying _solutionid_value on definitions', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              environmentvariabledefinitionid: 'def-1',
              schemaname: 'pp_ApiUrl',
              displayname: 'API URL',
              defaultvalue: 'https://default.example.test',
              type: 'String',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              environmentvariablevalueid: 'val-1',
              value: 'https://current.example.test',
              _environmentvariabledefinitionid_value: 'def-1',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              objectid: 'def-1',
            },
          ],
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new EnvironmentVariableService(client);

    const result = await service.setValue('pp_ApiUrl', 'https://next.example.test', { solutionUniqueName: 'Core' });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      definitionId: 'def-1',
      currentValue: 'https://next.example.test',
      valueId: 'val-1',
      hasCurrentValue: true,
    });
    expect(httpClient.requests[0]?.path).toBe(
      'environmentvariabledefinitions?%24select=environmentvariabledefinitionid%2Cschemaname%2Cdisplayname%2Cdefaultvalue%2Ctype%2Cvalueschema%2Csecretstore'
    );
    expect(httpClient.requests.at(-1)?.method).toBe('PATCH');
    expect(httpClient.requests.at(-1)?.path).toBe('environmentvariablevalues(val-1)');
  });

  it('updates an existing connection reference binding', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              connectionreferenceid: 'ref-1',
              connectionreferencelogicalname: 'pp_shared',
              displayname: 'Shared Connector',
              connectorid: '/providers/Microsoft.PowerApps/apis/shared_sql',
              connectionid: 'conn-old',
              statecode: 0,
            },
          ],
        },
      }),
      ok({
        status: 204,
        headers: {},
        data: undefined,
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ConnectionReferenceService(client);

    const result = await service.setConnectionId('pp_shared', 'conn-next');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      id: 'ref-1',
      logicalName: 'pp_shared',
      connectionId: 'conn-next',
      connected: true,
    });
    expect(httpClient.requests.at(-1)?.method).toBe('PATCH');
    expect(httpClient.requests.at(-1)?.path).toBe('connectionreferences(ref-1)');
    expect(httpClient.requests.at(-1)?.body).toEqual({
      connectionid: 'conn-next',
    });
  });

  it('creates a connection reference within a solution', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 204,
        headers: {
          'odata-entityid': "https://example.crm.dynamics.com/api/data/v9.2/connectionreferences(ref-1)",
        },
        data: {
          connectionreferenceid: 'ref-1',
          connectionreferencelogicalname: 'pp_shared_sql',
          connectionreferencedisplayname: 'Shared SQL',
          connectorid: '/providers/Microsoft.PowerApps/apis/shared_sql',
          connectionid: 'conn-next',
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ConnectionReferenceService(client);

    const result = await service.create('pp_shared_sql', 'conn-next', {
      displayName: 'Shared SQL',
      connectorId: '/providers/Microsoft.PowerApps/apis/shared_sql',
      solutionUniqueName: 'CoreManaged',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      id: 'ref-1',
      logicalName: 'pp_shared_sql',
      displayName: 'Shared SQL',
      connectorId: '/providers/Microsoft.PowerApps/apis/shared_sql',
      connectionId: 'conn-next',
      connected: true,
    });
    expect(httpClient.requests.at(-1)?.method).toBe('POST');
    expect(httpClient.requests.at(-1)?.path).toBe('connectionreferences');
    expect(httpClient.requests.at(-1)?.headers?.['MSCRM.SolutionUniqueName']).toBe('CoreManaged');
    expect(httpClient.requests.at(-1)?.body).toEqual({
      connectionreferencelogicalname: 'pp_shared_sql',
      connectionreferencedisplayname: 'Shared SQL',
      connectorid: '/providers/Microsoft.PowerApps/apis/shared_sql',
      connectionid: 'conn-next',
    });
  });
});

describe('normalizeMetadataQueryOptions', () => {
  it('lists, inspects, and reads cloud-flow runs through a typed service', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              workflowid: 'flow-2',
              name: 'Other Flow',
              uniquename: 'crd_OtherFlow',
              category: 5,
            },
            {
              workflowid: 'flow-1',
              name: 'Invoice Sync',
              uniquename: 'crd_InvoiceSync',
              category: 5,
              statecode: 1,
              statuscode: 2,
              clientdata: JSON.stringify({
                definition: {
                  parameters: {
                    '$connections': {
                      value: {
                        shared_office365: {
                          connectionId: '/connections/office365',
                          connectionReferenceLogicalName: 'shared_office365',
                        },
                      },
                    },
                    ApiBaseUrl: {
                      defaultValue: 'https://example.test',
                    },
                  },
                  actions: {
                    SendMail: {
                      inputs: {
                        subject: "@{parameters('ApiBaseUrl')}",
                        body: "@{environmentVariables('pp_ApiUrl')}",
                      },
                    },
                  },
                },
              }),
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              workflowid: 'flow-2',
              name: 'Other Flow',
              uniquename: 'crd_OtherFlow',
              category: 5,
            },
            {
              workflowid: 'flow-1',
              name: 'Invoice Sync',
              uniquename: 'crd_InvoiceSync',
              category: 5,
              statecode: 1,
              statuscode: 2,
              clientdata: JSON.stringify({
                definition: {
                  parameters: {
                    '$connections': {
                      value: {
                        shared_office365: {
                          connectionId: '/connections/office365',
                          connectionReferenceLogicalName: 'shared_office365',
                        },
                      },
                    },
                    ApiBaseUrl: {
                      defaultValue: 'https://example.test',
                    },
                  },
                  actions: {
                    SendMail: {
                      inputs: {
                        subject: "@{parameters('ApiBaseUrl')}",
                        body: "@{environmentVariables('pp_ApiUrl')}",
                      },
                    },
                  },
                },
              }),
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              flowrunid: 'run-2',
              workflowid: 'flow-1',
              workflowname: 'Invoice Sync',
              status: 'Succeeded',
              starttime: '2026-03-10T04:49:00.000Z',
            },
            {
              flowrunid: 'run-1',
              workflowid: 'flow-1',
              workflowname: 'Invoice Sync',
              status: 'Failed',
              starttime: '2026-03-10T04:50:00.000Z',
              endtime: '2026-03-10T04:52:00.000Z',
              durationinms: 120000,
              retrycount: 1,
              errorcode: 'ConnectorAuthFailed',
              errormessage: 'shared_office365 connection is not authorized',
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new CloudFlowService(client);

    const listed = await service.list();
    const inspected = await service.inspect('crd_InvoiceSync');
    const runs = await service.runs({
      workflowId: 'flow-1',
      workflowName: 'Invoice Sync',
      workflowUniqueName: 'crd_InvoiceSync',
      status: 'Failed',
    });

    expect(listed.success).toBe(true);
    expect(listed.data?.map((flow) => flow.id)).toEqual(['flow-1', 'flow-2']);
    expect(listed.data?.[0]).toMatchObject({
      id: 'flow-1',
      parameters: ['ApiBaseUrl'],
      environmentVariables: ['pp_ApiUrl'],
      connectionReferences: [
        {
          name: 'shared_office365',
          connectionReferenceLogicalName: 'shared_office365',
        },
      ],
    });
    expect(inspected.success).toBe(true);
    expect(inspected.data).toMatchObject({
      id: 'flow-1',
      uniqueName: 'crd_InvoiceSync',
      definitionAvailable: true,
    });
    expect(runs.success).toBe(true);
    expect(runs.data).toEqual([
      {
        id: 'run-1',
        workflowId: 'flow-1',
        workflowName: 'Invoice Sync',
        status: 'Failed',
        startTime: '2026-03-10T04:50:00.000Z',
        endTime: '2026-03-10T04:52:00.000Z',
        durationMs: 120000,
        retryCount: 1,
        errorCode: 'ConnectorAuthFailed',
        errorMessage: 'shared_office365 connection is not authorized',
      },
    ]);
    expect(httpClient.requests[2]?.path).toContain('flowruns?');
    expect(httpClient.requests[2]?.path).not.toContain('workflowname');
  });

  it('retries flow-run queries without unsupported optional columns', async () => {
    const httpClient = new FakeHttpClient([
      fail(
        createDiagnostic(
          'error',
          'HTTP_REQUEST_FAILED',
          'GET flowruns returned 400',
          {
            source: '@pp/http',
            detail:
              '{"error":{"code":"0x80060888","message":"Could not find a property named \'durationinms\' on type \'Microsoft.Dynamics.CRM.flowrun\'."}}',
          }
        )
      ),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              flowrunid: 'run-1',
              workflowid: 'flow-1',
              status: 'Failed',
              starttime: '2026-03-10T04:50:00.000Z',
              errorcode: 'ConnectorAuthFailed',
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new CloudFlowService(client);

    const runs = await service.runs({
      workflowId: 'flow-1',
      status: 'Failed',
    });

    expect(runs.success).toBe(true);
    expect(runs.data).toEqual([
      {
        id: 'run-1',
        workflowId: 'flow-1',
        workflowName: undefined,
        status: 'Failed',
        startTime: '2026-03-10T04:50:00.000Z',
        endTime: undefined,
        durationMs: undefined,
        retryCount: undefined,
        errorCode: 'ConnectorAuthFailed',
        errorMessage: undefined,
      },
    ]);
    expect(runs.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DATAVERSE_FLOWRUN_OPTIONAL_COLUMNS_UNAVAILABLE',
        }),
      ])
    );
    expect(httpClient.requests[0]?.path).toContain('durationinms');
    expect(httpClient.requests[1]?.path).not.toContain('durationinms');
    expect(httpClient.requests[1]?.path).toContain('retrycount');
  });

  it('lists and inspects canvas apps through a typed service', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              canvasappid: 'canvas-2',
              displayname: 'Other Canvas',
              name: 'crd_OtherCanvas',
              tags: 'other',
            },
            {
              canvasappid: 'canvas-1',
              displayname: 'Harness Canvas',
              name: 'crd_HarnessCanvas',
              appopenuri: 'https://make.powerapps.com/e/test/canvas/?app-id=canvas-1',
              appversion: '1.2.3.4',
              createdbyclientversion: '3.25000.1',
              lastpublishtime: '2026-03-10T04:50:00.000Z',
              status: 'Published',
              tags: 'harness;solution',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              canvasappid: 'canvas-2',
              displayname: 'Other Canvas',
              name: 'crd_OtherCanvas',
              tags: 'other',
            },
            {
              canvasappid: 'canvas-1',
              displayname: 'Harness Canvas',
              name: 'crd_HarnessCanvas',
              appopenuri: 'https://make.powerapps.com/e/test/canvas/?app-id=canvas-1',
              appversion: '1.2.3.4',
              createdbyclientversion: '3.25000.1',
              lastpublishtime: '2026-03-10T04:50:00.000Z',
              status: 'Published',
              tags: 'harness;solution',
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new CanvasAppService(client);

    const listed = await service.list();
    const inspected = await service.inspect('Harness Canvas');

    expect(listed.success).toBe(true);
    expect(listed.data?.map((app) => app.id)).toEqual(['canvas-1', 'canvas-2']);
    expect(listed.data?.[0]).toMatchObject({
      id: 'canvas-1',
      displayName: 'Harness Canvas',
      tags: ['harness', 'solution'],
    });
    expect(inspected.success).toBe(true);
    expect(inspected.data).toMatchObject({
      id: 'canvas-1',
      name: 'crd_HarnessCanvas',
    });
  });

  it('reports canvas app access state through a typed service', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              canvasappid: 'canvas-1',
              displayname: 'Harness Canvas',
              name: 'crd_HarnessCanvas',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              canvasappid: 'canvas-1',
              displayname: 'Harness Canvas',
              name: 'crd_HarnessCanvas',
              _ownerid_value: 'user-1',
              '_ownerid_value@OData.Community.Display.V1.FormattedValue': 'Callum Alpass',
              '_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname': 'systemuser',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new CanvasAppService(client);

    const access = await service.access('Harness Canvas');

    expect(access.success).toBe(true);
    expect(access.data).toMatchObject({
      kind: 'canvas',
      target: {
        table: 'canvasapps',
        id: 'canvas-1',
        displayName: 'Harness Canvas',
      },
      ownership: {
        scope: 'principal',
        owner: {
          id: 'user-1',
          name: 'Callum Alpass',
          entityType: 'systemuser',
        },
      },
      sharing: {
        hasExplicitShares: false,
        explicitShareCount: 0,
      },
    });
    expect(httpClient.requests.map((request) => request.path)).toEqual([
      'canvasapps?%24select=canvasappid%2Cdisplayname%2Cname%2Cappopenuri%2Cappversion%2Ccreatedbyclientversion%2Clastpublishtime%2Cstatus%2Ctags',
      'canvasapps?%24select=canvasappid%2Cdisplayname%2Cname%2C_ownerid_value&%24filter=canvasappid+eq+canvas-1',
      'principalobjectaccessset?%24select=principalobjectaccessid%2Cobjectid%2Cobjecttypecode%2Cprincipalid%2Cprincipaltypecode%2Caccessrightsmask%2Cinheritedaccessrightsmask%2Cchangedon&%24filter=objectid+eq+canvas-1',
    ]);
  });

  it('treats connection references without an active connection binding as invalid', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              connectionreferenceid: 'ref-1',
              connectionreferencelogicalname: 'msdyn_Dataverse',
              connectionreferencedisplayname: 'Dataverse',
              connectorid: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
              statecode: 0,
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ConnectionReferenceService(client);

    const result = await service.validate();

    expect(result.success).toBe(true);
    expect(result.data?.[0]).toMatchObject({
      valid: false,
      reference: {
        logicalName: 'msdyn_Dataverse',
        connected: false,
      },
      diagnostics: [
        expect.objectContaining({
          code: 'DATAVERSE_CONNREF_CONNECTION_MISSING',
          level: 'warning',
        }),
      ],
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DATAVERSE_CONNREF_VALIDATE_SUMMARY',
          message: 'Validated 1 connection reference: 0 valid, 1 invalid in the current environment scope.',
        }),
      ])
    );
  });

  it('attaches canvas apps through typed services', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              canvasappid: 'canvas-1',
              displayname: 'Harness Canvas',
              name: 'crd_HarnessCanvas',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {},
      }),
      ok({
        status: 200,
        headers: {},
        data: {},
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new CanvasAppService(client);

    const attached = await service.attachToSolution('Harness Canvas', 'Core');

    expect(attached.success).toBe(true);
    expect(attached.data).toMatchObject({
      attached: true,
      solutionUniqueName: 'Core',
      app: {
        id: 'canvas-1',
        name: 'crd_HarnessCanvas',
      },
      addRequiredComponents: true,
    });
    expect(httpClient.requests.map((request) => ({ path: request.path, method: request.method, body: request.body, headers: request.headers }))).toEqual([
      {
        path: 'canvasapps?%24select=canvasappid%2Cdisplayname%2Cname%2Cappopenuri%2Cappversion%2Ccreatedbyclientversion%2Clastpublishtime%2Cstatus%2Ctags',
        method: 'GET',
        body: undefined,
        headers: {},
      },
      {
        path: 'AddSolutionComponent',
        method: 'POST',
        body: {
          ComponentId: 'canvas-1',
          ComponentType: 300,
          SolutionUniqueName: 'Core',
          AddRequiredComponents: true,
        },
        headers: {
          'MSCRM.SolutionUniqueName': 'Core',
        },
      },
    ]);
  });

  it('lists model-driven app assets through typed services', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              appmoduleid: 'app-2',
              uniquename: 'OpsHub',
              name: 'Ops Hub',
            },
            {
              appmoduleid: 'app-1',
              uniquename: 'SalesHub',
              name: 'Sales Hub',
              appmoduleversion: '1.0.0.0',
              statecode: 0,
              publishedon: '2026-03-10T04:50:00.000Z',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              appmoduleid: 'app-2',
              uniquename: 'OpsHub',
              name: 'Ops Hub',
            },
            {
              appmoduleid: 'app-1',
              uniquename: 'SalesHub',
              name: 'Sales Hub',
              appmoduleversion: '1.0.0.0',
              statecode: 0,
              publishedon: '2026-03-10T04:50:00.000Z',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
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
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              formid: 'form-1',
              name: 'Account Main',
              objecttypecode: 'account',
              type: 2,
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              savedqueryid: 'view-1',
              name: 'Active Accounts',
              returnedtypecode: 'account',
              querytype: 0,
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              sitemapid: 'sitemap-1',
              sitemapname: 'Sales Hub sitemap',
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ModelDrivenAppService(client);

    const listed = await service.list();
    const inspected = await service.inspect('SalesHub');
    const components = await service.components('app-1');
    const forms = await service.forms();
    const views = await service.views();
    const sitemaps = await service.sitemaps();

    expect(listed.success).toBe(true);
    expect(listed.data?.map((app) => app.id)).toEqual(['app-2', 'app-1']);
    expect(inspected.success).toBe(true);
    expect(inspected.data).toMatchObject({
      id: 'app-1',
      uniqueName: 'SalesHub',
    });
    expect(components.success).toBe(true);
    expect(components.data).toEqual([
      {
        id: 'amc-1',
        componentType: 1,
        objectId: 'entity-1',
        appId: 'app-1',
      },
      {
        id: 'amc-2',
        componentType: 60,
        objectId: 'form-1',
        appId: 'app-1',
      },
    ]);
    expect(forms.data?.[0]).toMatchObject({
      id: 'form-1',
      name: 'Account Main',
      table: 'account',
    });
    expect(views.data?.[0]).toMatchObject({
      id: 'view-1',
      name: 'Active Accounts',
      table: 'account',
    });
    expect(sitemaps.data?.[0]).toMatchObject({
      id: 'sitemap-1',
      name: 'Sales Hub sitemap',
    });
  });

  it('queries model-driven app components through the appmodulecomponents table and filters by app id', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
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
              appmoduleidunique: 'app-2',
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ModelDrivenAppService(client);

    const result = await service.components('app-1');

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      {
        id: 'amc-1',
        componentType: 1,
        objectId: 'entity-1',
        appId: 'app-1',
      },
      {
        id: 'amc-2',
        componentType: 60,
        objectId: 'form-1',
        appId: 'app-1',
      },
    ]);
    expect(httpClient.requests.map((request) => request.path)).toEqual([
      'appmodulecomponents?%24select=appmodulecomponentid%2Ccomponenttype%2Cobjectid%2C_appmoduleidunique_value%2Cappmoduleidunique',
    ]);
  });

  it('warns explicitly when model-driven app composition rows are empty', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ModelDrivenAppService(client);

    const result = await service.components('missing-app');

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DATAVERSE_MODEL_APP_COMPONENTS_EMPTY',
        }),
      ])
    );
  });

  it('retries model-driven app components through the app-specific navigation path when optional columns are unsupported', async () => {
    const httpClient = new FakeHttpClient([
      fail([
        createDiagnostic(
          'error',
          'HTTP_REQUEST_FAILED',
          "Could not find a property named 'appmoduleidunique' on type Microsoft.Dynamics.CRM.appmodulecomponent.",
          {
            source: '@pp/http',
            detail:
              "Could not find a property named '_appmoduleidunique_value' on type Microsoft.Dynamics.CRM.appmodulecomponent.",
          }
        ),
      ]),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              appmodulecomponentid: 'amc-1',
              componenttype: 1,
              objectid: 'entity-1',
            },
            {
              appmodulecomponentid: 'amc-2',
              componenttype: 60,
              objectid: 'form-1',
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ModelDrivenAppService(client);

    const result = await service.components('app-1');

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      {
        id: 'amc-1',
        componentType: 1,
        objectId: 'entity-1',
        appId: 'app-1',
      },
      {
        id: 'amc-2',
        componentType: 60,
        objectId: 'form-1',
        appId: 'app-1',
      },
    ]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DATAVERSE_MODEL_APP_COMPONENT_OPTIONAL_COLUMNS_UNAVAILABLE',
        }),
      ])
    );
    expect(httpClient.requests.map((request) => request.path)).toEqual([
      'appmodulecomponents?%24select=appmodulecomponentid%2Ccomponenttype%2Cobjectid%2C_appmoduleidunique_value%2Cappmoduleidunique',
      'appmodules(app-1)/appmodule_appmodulecomponent?%24select=appmodulecomponentid%2Ccomponenttype%2Cobjectid',
    ]);
  });

  it('creates and attaches model-driven apps through typed services', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          appmoduleid: 'app-3',
          uniquename: 'ServiceHub',
          name: 'Service Hub',
          appmoduleversion: '1.0.0.0',
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {},
      }),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              appmoduleid: 'app-3',
              uniquename: 'ServiceHub',
              name: 'Service Hub',
            },
          ],
        },
      }),
      ok({
        status: 200,
        headers: {},
        data: {},
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ModelDrivenAppService(client);

    const created = await service.create('ServiceHub', {
      name: 'Service Hub',
      solutionUniqueName: 'Core',
    });
    const attached = await service.attachToSolution('ServiceHub', 'Core');

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
        id: 'app-3',
        uniqueName: 'ServiceHub',
      },
      addRequiredComponents: true,
    });
    expect(httpClient.requests.map((request) => ({ path: request.path, method: request.method, body: request.body, headers: request.headers }))).toEqual([
      {
        path: 'appmodules',
        method: 'POST',
        body: {
          uniquename: 'ServiceHub',
          name: 'Service Hub',
          webresourceid: '953b9fac-1e5e-e611-80d6-00155ded156f',
        },
        headers: {
          prefer: 'return=representation',
        },
      },
      {
        path: 'AddSolutionComponent',
        method: 'POST',
        body: {
          ComponentId: 'app-3',
          ComponentType: 80,
          SolutionUniqueName: 'Core',
          AddRequiredComponents: true,
        },
        headers: {
          'MSCRM.SolutionUniqueName': 'Core',
        },
      },
      {
        path: 'appmodules?%24select=appmoduleid%2Cuniquename%2Cname%2Cappmoduleversion%2Cstatecode%2Cpublishedon',
        method: 'GET',
        body: undefined,
        headers: {},
      },
      {
        path: 'AddSolutionComponent',
        method: 'POST',
        body: {
          ComponentId: 'app-3',
          ComponentType: 80,
          SolutionUniqueName: 'Core',
          AddRequiredComponents: true,
        },
        headers: {
          'MSCRM.SolutionUniqueName': 'Core',
        },
      },
    ]);
  });

  it('explains whether create failed before or after the model-driven app row persisted', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          appmoduleid: 'app-4',
          uniquename: 'TransientHub',
          name: 'Transient Hub',
        },
      }),
      fail(createDiagnostic('error', 'HTTP_REQUEST_FAILED', 'POST AddSolutionComponent returned 404', { source: '@pp/http' })),
      ok({
        status: 200,
        headers: {},
        data: {
          value: [],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);
    const service = new ModelDrivenAppService(client);

    const result = await service.create('TransientHub', {
      name: 'Transient Hub',
      solutionUniqueName: 'Core',
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DATAVERSE_MODEL_APP_ATTACH_AFTER_CREATE_FAILED',
          detail: 'Created app id: app-4. A follow-up inspect did not find the app row, so Dataverse likely rolled it back after the failed attach.',
        }),
      ])
    );
    expect(result.suggestedNextActions).toEqual([
      'Treat the create as rolled back and retry with a different unique name only after confirming the tenant no longer returns app id app-4.',
      'Use an existing app attach flow for the current solution if you need to keep the authoring step moving.',
    ]);
    expect(httpClient.requests.map((request) => request.path)).toEqual([
      'appmodules',
      'AddSolutionComponent',
      'appmodules?%24select=appmoduleid%2Cuniquename%2Cname%2Cappmoduleversion%2Cstatecode%2Cpublishedon',
    ]);
  });

  it('rejects unsupported metadata count requests', () => {
    const result = normalizeMetadataQueryOptions('EntityDefinitions', {
      count: true,
    });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('DATAVERSE_METADATA_COUNT_UNSUPPORTED');
  });

  it('builds metadata query paths against arbitrary metadata collections', () => {
    const result = normalizeMetadataQueryOptions("EntityDefinitions(LogicalName='account')/Attributes", {
      select: ['LogicalName', 'AttributeType'],
      filter: "AttributeType eq Microsoft.Dynamics.CRM.AttributeTypeCode'String'",
    });

    expect(result.success).toBe(true);
    expect(result.data?.path).toBe(
      "EntityDefinitions(LogicalName='account')/Attributes?%24select=LogicalName%2CAttributeType&%24filter=AttributeType+eq+Microsoft.Dynamics.CRM.AttributeTypeCode%27String%27"
    );
  });
});

describe('buildMetadataAttributePath', () => {
  it('builds a logical-name addressable metadata column path', () => {
    const path = buildMetadataAttributePath('account', 'name', {
      select: ['LogicalName', 'SchemaName'],
    });

    expect(path).toBe("EntityDefinitions(LogicalName='account')/Attributes(LogicalName='name')?%24select=LogicalName%2CSchemaName");
  });
});

describe('metadata definition paths', () => {
  it('builds a global option set metadata path', () => {
    expect(buildGlobalOptionSetPath('pp_status')).toBe("GlobalOptionSetDefinitions(Name='pp_status')");
  });

  it('builds a one-to-many relationship metadata path', () => {
    expect(buildRelationshipPath('pp_project_account')).toBe(
      "RelationshipDefinitions(SchemaName='pp_project_account')/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata"
    );
  });

  it('builds a many-to-many relationship metadata path', () => {
    expect(buildRelationshipPath('pp_project_contact', 'many-to-many')).toBe(
      "RelationshipDefinitions(SchemaName='pp_project_contact')/Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata"
    );
  });
});

describe('normalizeAttributeDefinition', () => {
  const rawAttribute = {
    '@odata.type': '#Microsoft.Dynamics.CRM.StringAttributeMetadata',
    LogicalName: 'name',
    SchemaName: 'Name',
    EntityLogicalName: 'account',
    MetadataId: '00000000-0000-0000-0000-000000000001',
    AttributeType: 'String',
    AttributeTypeName: { Value: 'StringType' },
    DisplayName: {
      UserLocalizedLabel: {
        Label: 'Account Name',
      },
    },
    Description: {
      UserLocalizedLabel: {
        Label: 'Type the company or business name.',
      },
    },
    RequiredLevel: { Value: 'ApplicationRequired' },
    IsPrimaryId: false,
    IsPrimaryName: true,
    IsCustomAttribute: false,
    IsManaged: true,
    IsLogical: false,
    IsValidForCreate: true,
    IsValidForRead: true,
    IsValidForUpdate: true,
    IsFilterable: false,
    IsSearchable: true,
    IsValidForAdvancedFind: { Value: true },
    IsSecured: false,
    IsCustomizable: { Value: true },
    IsRenameable: { Value: true },
    IsAuditEnabled: { Value: true },
    IsLocalizable: false,
    IsRequiredForForm: true,
    IsValidForForm: true,
    IsValidForGrid: true,
    IsValidODataAttribute: true,
    CanBeSecuredForCreate: false,
    CanBeSecuredForRead: false,
    CanBeSecuredForUpdate: false,
    IsSortableEnabled: { Value: true },
    SourceType: 0,
    SourceTypeMask: 0,
    IntroducedVersion: '5.0.0.0',
    Format: 'Text',
    MaxLength: 160,
    DatabaseLength: 320,
    ImeMode: 'Active',
  };

  it('produces a stable common view', () => {
    const normalized = normalizeAttributeDefinition(rawAttribute, 'common');

    expect(normalized).toEqual({
      logicalName: 'name',
      schemaName: 'Name',
      displayName: 'Account Name',
      description: 'Type the company or business name.',
      entityLogicalName: 'account',
      metadataId: '00000000-0000-0000-0000-000000000001',
      attributeType: 'String',
      attributeTypeName: 'StringType',
      odataType: '#Microsoft.Dynamics.CRM.StringAttributeMetadata',
      requiredLevel: 'ApplicationRequired',
      primaryId: false,
      primaryName: true,
      custom: false,
      managed: true,
      logical: false,
      createable: true,
      readable: true,
      updateable: true,
      filterable: false,
      searchable: true,
      advancedFind: true,
      secured: false,
    });
  });

  it('produces a richer detailed view', () => {
    const normalized = normalizeAttributeDefinition(rawAttribute, 'detailed');

    expect(normalized).toMatchObject({
      logicalName: 'name',
      attributeType: 'String',
      customizable: true,
      renameable: true,
      auditable: true,
      requiredForForm: true,
      sortable: true,
      typeDetails: {
        format: 'Text',
        maxLength: 160,
        databaseLength: 320,
        imeMode: 'Active',
      },
    });
  });

  it('normalizes collections of attributes', () => {
    const normalized = normalizeAttributeDefinitions([rawAttribute], 'common');

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      logicalName: 'name',
      attributeType: 'String',
    });
  });
});

describe('metadata normalization helpers', () => {
  it('normalizes entity definitions for snapshots', () => {
    const normalized = normalizeEntityDefinition({
      LogicalName: 'pp_project',
      SchemaName: 'pp_Project',
      DisplayName: {
        UserLocalizedLabel: {
          Label: 'Project',
        },
      },
      DisplayCollectionName: {
        UserLocalizedLabel: {
          Label: 'Projects',
        },
      },
      PrimaryIdAttribute: 'pp_projectid',
      PrimaryNameAttribute: 'pp_name',
      OwnershipType: 'UserOwned',
      EntitySetName: 'pp_projects',
      IsCustomEntity: true,
      IsManaged: false,
    });

    expect(normalized).toEqual({
      logicalName: 'pp_project',
      schemaName: 'pp_Project',
      displayName: 'Project',
      pluralDisplayName: 'Projects',
      ownershipType: 'UserOwned',
      entitySetName: 'pp_projects',
      primaryIdAttribute: 'pp_projectid',
      primaryNameAttribute: 'pp_name',
      custom: true,
      managed: false,
    });
  });

  it('normalizes global option set definitions', () => {
    const normalized = normalizeGlobalOptionSetDefinition({
      MetadataId: '00000000-0000-0000-0000-000000000020',
      Name: 'pp_status',
      DisplayName: {
        UserLocalizedLabel: {
          Label: 'Status',
        },
      },
      Description: {
        UserLocalizedLabel: {
          Label: 'Project status values',
        },
      },
      IsGlobal: true,
      OptionSetType: 'Picklist',
      Options: [
        {
          Value: 100000000,
          Label: {
            UserLocalizedLabel: {
              Label: 'New',
            },
          },
        },
      ],
    });

    expect(normalized).toEqual({
      metadataId: '00000000-0000-0000-0000-000000000020',
      name: 'pp_status',
      displayName: 'Status',
      description: 'Project status values',
      isGlobal: true,
      optionSetType: 'Picklist',
      options: [{ value: 100000000, label: 'New' }],
    });
  });

  it('normalizes one-to-many and many-to-many relationships', () => {
    const oneToMany = normalizeRelationshipDefinition({
      '@odata.type': '#Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata',
      SchemaName: 'pp_project_account',
      ReferencedEntity: 'account',
      ReferencedAttribute: 'accountid',
      ReferencingEntity: 'pp_project',
      ReferencingAttribute: 'pp_accountid',
      Lookup: {
        LogicalName: 'pp_accountid',
        SchemaName: 'pp_AccountId',
        DisplayName: {
          UserLocalizedLabel: {
            Label: 'Account',
          },
        },
      },
      CascadeConfiguration: {
        Delete: 'RemoveLink',
      },
    });
    const manyToMany = normalizeRelationshipDefinition({
      '@odata.type': '#Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata',
      SchemaName: 'pp_project_contact',
      Entity1LogicalName: 'pp_project',
      Entity2LogicalName: 'contact',
      IntersectEntityName: 'pp_project_contact',
    });

    expect(oneToMany).toEqual({
      schemaName: 'pp_project_account',
      odataType: '#Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata',
      relationshipType: 'one-to-many',
      referencedEntity: 'account',
      referencedAttribute: 'accountid',
      referencingEntity: 'pp_project',
      referencingAttribute: 'pp_accountid',
      lookupLogicalName: 'pp_accountid',
      lookupSchemaName: 'pp_AccountId',
      lookupDisplayName: 'Account',
      cascade: {
        delete: 'RemoveLink',
      },
    });
    expect(manyToMany).toEqual({
      schemaName: 'pp_project_contact',
      odataType: '#Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata',
      relationshipType: 'many-to-many',
      entity1LogicalName: 'pp_project',
      entity2LogicalName: 'contact',
      intersectEntityName: 'pp_project_contact',
    });
  });

  it('normalizes freshly created one-to-many relationships without odata type or lookup expansion', () => {
    const relationship = normalizeRelationshipDefinition({
      SchemaName: 'pph34135_project_pph34135_task',
      RelationshipType: 'OneToManyRelationship',
      MetadataId: 'ccf160a6-361c-f111-8341-6045bde68dac',
      ReferencedEntity: 'pph34135_project',
      ReferencedAttribute: 'pph34135_projectid',
      ReferencingEntity: 'pph34135_task',
      ReferencingAttribute: 'pph34135_projectid',
      AssociatedMenuConfiguration: {
        Behavior: 'UseCollectionName',
        Group: 'Details',
        Order: 10000,
        Label: {
          UserLocalizedLabel: {
            Label: 'Tasks',
          },
        },
      },
      CascadeConfiguration: {
        Assign: 'Cascade',
        Delete: 'RemoveLink',
      },
    });

    expect(relationship).toEqual({
      schemaName: 'pph34135_project_pph34135_task',
      metadataId: 'ccf160a6-361c-f111-8341-6045bde68dac',
      relationshipType: 'one-to-many',
      referencedEntity: 'pph34135_project',
      referencedAttribute: 'pph34135_projectid',
      referencingEntity: 'pph34135_task',
      referencingAttribute: 'pph34135_projectid',
      lookupLogicalName: 'pph34135_projectid',
      associatedMenuLabel: 'Tasks',
      associatedMenuBehavior: 'UseCollectionName',
      associatedMenuGroup: 'Details',
      associatedMenuOrder: 10000,
      cascade: {
        assign: 'Cascade',
        delete: 'RemoveLink',
      },
    });
  });

  it('creates deterministic metadata snapshots for columns', async () => {
    const httpClient = new FakeHttpClient([
      ok({
        status: 200,
        headers: {},
        data: {
          value: [
            {
              LogicalName: 'pp_name',
              SchemaName: 'pp_Name',
              DisplayName: { UserLocalizedLabel: { Label: 'Name' } },
            },
            {
              LogicalName: 'pp_code',
              SchemaName: 'pp_Code',
              DisplayName: { UserLocalizedLabel: { Label: 'Code' } },
            },
          ],
        },
      }),
    ]);
    const client = new DataverseClient({ url: 'https://example.crm.dynamics.com' }, httpClient);

    const result = await client.snapshotColumnsMetadata('pp_project');

    expect(result.success).toBe(true);
    expect(result.data?.kind).toBe('columns');
    expect(result.data?.target).toEqual({ logicalName: 'pp_project' });
    expect(result.data?.value).toEqual([
      {
        logicalName: 'pp_code',
        schemaName: 'pp_Code',
        displayName: 'Code',
      },
      {
        logicalName: 'pp_name',
        schemaName: 'pp_Name',
        displayName: 'Name',
      },
    ]);
  });

  it('diffs compatible metadata snapshots', () => {
    const result = diffDataverseMetadataSnapshots(
      {
        schemaVersion: 1,
        generatedAt: '2026-03-10T00:00:00.000Z',
        environmentUrl: 'https://left.example.crm.dynamics.com',
        kind: 'option-set',
        target: { name: 'pp_status' },
        value: {
          name: 'pp_status',
          options: [{ value: 100000000, label: 'New' }],
        },
      },
      {
        schemaVersion: 1,
        generatedAt: '2026-03-10T00:00:01.000Z',
        environmentUrl: 'https://right.example.crm.dynamics.com',
        kind: 'option-set',
        target: { name: 'pp_status' },
        value: {
          name: 'pp_status',
          options: [
            { value: 100000000, label: 'Draft' },
            { value: 100000001, label: 'Active' },
          ],
        },
      }
    );

    expect(result.success).toBe(true);
    expect(result.data?.summary).toEqual({
      added: 1,
      removed: 0,
      changed: 1,
      total: 2,
    });
    expect(result.data?.changes).toEqual([
      {
        kind: 'changed',
        path: 'value.options[0].label',
        left: 'New',
        right: 'Draft',
      },
      {
        kind: 'added',
        path: 'value.options[1]',
        right: { value: 100000001, label: 'Active' },
      },
    ]);
  });
});
