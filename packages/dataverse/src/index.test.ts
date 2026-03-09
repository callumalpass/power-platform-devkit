import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { saveAuthProfile, saveEnvironmentAlias } from '@pp/config';
import { ok, type OperationResult } from '@pp/diagnostics';
import { HttpClient, type HttpRequestOptions, type HttpResponse } from '@pp/http';
import {
  ConnectionReferenceService,
  DataverseClient,
  EnvironmentVariableService,
  buildMetadataAttributePath,
  buildGlobalOptionSetPath,
  buildRelationshipPath,
  buildQueryPath,
  normalizeAttributeDefinition,
  normalizeAttributeDefinitions,
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
});
