import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { saveAuthProfile, saveEnvironmentAlias } from '@pp/config';
import { ok, type OperationResult } from '@pp/diagnostics';
import { HttpClient, type HttpRequestOptions, type HttpResponse } from '@pp/http';
import {
  DataverseClient,
  buildMetadataAttributePath,
  buildQueryPath,
  normalizeAttributeDefinition,
  normalizeAttributeDefinitions,
  normalizeMetadataQueryOptions,
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
});

describe('normalizeMetadataQueryOptions', () => {
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
