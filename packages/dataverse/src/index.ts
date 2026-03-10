import { createTokenProvider, type AuthProfile } from '@pp/auth';
import { getAuthProfile, getEnvironmentAlias, type ConfigStoreOptions, type EnvironmentAlias } from '@pp/config';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { HttpClient, type HttpQueryValue, type HttpRequestOptions, type HttpResponse } from '@pp/http';
import {
  buildColumnCreatePayload,
  buildCustomerRelationshipCreatePayload,
  buildGlobalOptionSetCreatePayload,
  buildManyToManyRelationshipCreatePayload,
  buildOneToManyRelationshipCreatePayload,
  buildTableCreatePayload,
  resolveLogicalName,
  type ColumnCreateSpec,
  type CustomerRelationshipCreateSpec,
  type GlobalOptionSetCreateSpec,
  type GlobalOptionSetUpdateSpec,
  type ManyToManyRelationshipCreateSpec,
  type MetadataBuildOptions,
  type OneToManyRelationshipCreateSpec,
  type TableCreateSpec,
} from './metadata-create';

export interface DataverseEnvironment {
  url: string;
  apiPath?: string;
}

export interface ODataQueryOptions {
  select?: string[];
  top?: number;
  filter?: string;
  expand?: string[];
  orderBy?: string[];
  count?: boolean;
}

export interface QueryOptions extends ODataQueryOptions {
  table: string;
  maxPageSize?: number;
  includeAnnotations?: string[];
}

export interface EntityReadOptions extends Pick<ODataQueryOptions, 'select' | 'expand'> {
  includeAnnotations?: string[];
}

export interface DataverseRequestOptions
  extends Pick<HttpRequestOptions, 'method' | 'body' | 'rawBody' | 'headers' | 'responseType' | 'authenticated'> {
  path: string;
  query?: Record<string, HttpQueryValue>;
  prefer?: string[];
  ifMatch?: string;
  ifNoneMatch?: string;
  includeAnnotations?: string[];
  solutionUniqueName?: string;
}

export interface DataverseWriteOptions extends EntityReadOptions {
  ifMatch?: string;
  ifNoneMatch?: string;
  returnRepresentation?: boolean;
  prefer?: string[];
  solutionUniqueName?: string;
}

export interface MetadataQueryOptions extends ODataQueryOptions {
  top?: number;
  maxPageSize?: number;
  includeAnnotations?: string[];
  all?: boolean;
}

export interface NormalizedMetadataQuery {
  path: string;
  top?: number;
  fetchAll: boolean;
  warnings: Diagnostic[];
}

export interface DataverseResolution {
  environment: EnvironmentAlias;
  authProfile: AuthProfile;
  client: DataverseClient;
}

export interface WhoAmIResult {
  BusinessUnitId: string;
  OrganizationId: string;
  UserId: string;
}

export interface DataverseCollectionResponse<T> {
  value?: T[];
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
}

export interface DataverseQueryPage<T> {
  records: T[];
  count?: number;
  nextLink?: string;
}

export interface DataverseWriteResult<T = unknown> {
  status: number;
  headers: Record<string, string>;
  entity?: T;
  entityId?: string;
  location?: string;
}

export interface DataverseMetadataWriteOptions extends MetadataBuildOptions {
  solutionUniqueName?: string;
  publish?: boolean;
  includeAnnotations?: string[];
}

export interface DataverseMetadataWriteResult<T = unknown> extends DataverseWriteResult<T> {
  published?: boolean;
  publishTargets?: string[];
}

export type EntityDefinition = Record<string, unknown>;
export type AttributeDefinition = Record<string, unknown>;
export type GlobalOptionSetDefinition = Record<string, unknown>;
export type RelationshipDefinition = Record<string, unknown>;
export type AttributeMetadataView = 'common' | 'detailed' | 'raw';
export type RelationshipMetadataKind = 'auto' | 'one-to-many' | 'many-to-many';

export interface NormalizedOptionDefinition {
  value?: number;
  label?: string;
  description?: string;
  color?: string;
  isManaged?: boolean;
}

export interface NormalizedOptionSetDefinition {
  name?: string;
  displayName?: string;
  description?: string;
  metadataId?: string;
  optionSetType?: string;
  isGlobal?: boolean;
  introducedVersion?: string;
  options?: NormalizedOptionDefinition[];
}

export interface NormalizedRelationshipDefinition {
  schemaName?: string;
  metadataId?: string;
  odataType?: string;
  relationshipType: 'one-to-many' | 'many-to-many' | 'unknown';
  referencedEntity?: string;
  referencedAttribute?: string;
  referencingEntity?: string;
  lookupLogicalName?: string;
  lookupSchemaName?: string;
  lookupDisplayName?: string;
  cascade?: Record<string, unknown>;
  entity1LogicalName?: string;
  entity2LogicalName?: string;
  intersectEntityName?: string;
  entity1NavigationPropertyName?: string;
  entity2NavigationPropertyName?: string;
}

export interface NormalizedAttributeDefinition {
  logicalName?: string;
  schemaName?: string;
  displayName?: string;
  description?: string;
  entityLogicalName?: string;
  metadataId?: string;
  attributeType?: string;
  attributeTypeName?: string;
  odataType?: string;
  requiredLevel?: string;
  primaryId?: boolean;
  primaryName?: boolean;
  custom?: boolean;
  managed?: boolean;
  logical?: boolean;
  createable?: boolean;
  readable?: boolean;
  updateable?: boolean;
  filterable?: boolean;
  searchable?: boolean;
  advancedFind?: boolean;
  secured?: boolean;
}

export interface DetailedAttributeDefinition extends NormalizedAttributeDefinition {
  customizable?: boolean;
  renameable?: boolean;
  auditable?: boolean;
  localizable?: boolean;
  requiredForForm?: boolean;
  validForForm?: boolean;
  validForGrid?: boolean;
  validODataAttribute?: boolean;
  secureCreate?: boolean;
  secureRead?: boolean;
  secureUpdate?: boolean;
  sortable?: boolean;
  sourceType?: number;
  sourceTypeMask?: number;
  introducedVersion?: string;
  typeDetails: Record<string, unknown>;
}

export interface ConnectionReferenceRecord {
  connectionreferenceid: string;
  connectionreferencelogicalname?: string;
  connectionreferencedisplayname?: string;
  displayname?: string;
  connectorid?: string;
  connectionid?: string;
  customconnectorid?: string;
  _solutionid_value?: string;
  statecode?: number;
}

export interface ConnectionReferenceSummary {
  id: string;
  logicalName?: string;
  displayName?: string;
  connectorId?: string;
  connectionId?: string;
  customConnectorId?: string;
  solutionId?: string;
  stateCode?: number;
  connected: boolean;
}

export interface ConnectionReferenceValidationResult {
  reference: ConnectionReferenceSummary;
  valid: boolean;
  diagnostics: Diagnostic[];
  suggestedNextActions: string[];
}

export interface EnvironmentVariableDefinitionRecord {
  environmentvariabledefinitionid: string;
  schemaname?: string;
  displayname?: string;
  defaultvalue?: string;
  type?: string;
  valueschema?: string;
  secretstore?: number;
  _solutionid_value?: string;
}

export interface EnvironmentVariableValueRecord {
  environmentvariablevalueid: string;
  value?: string;
  _environmentvariabledefinitionid_value?: string;
  statecode?: number;
}

export interface EnvironmentVariableSummary {
  definitionId: string;
  schemaName?: string;
  displayName?: string;
  type?: string;
  defaultValue?: string;
  currentValue?: string;
  effectiveValue?: string;
  valueId?: string;
  valueSchema?: string;
  secretStore?: number;
  solutionId?: string;
  hasCurrentValue: boolean;
}

export interface EnvironmentVariableCreateOptions {
  displayName?: string;
  defaultValue?: string;
  type?: string | number;
  valueSchema?: string;
  secretStore?: number;
  solutionUniqueName?: string;
}

interface SolutionComponentMembershipRecord {
  objectid?: string;
}

export class DataverseClient {
  private readonly httpClient: HttpClient;

  constructor(private readonly environment: DataverseEnvironment, httpClient?: HttpClient) {
    this.httpClient =
      httpClient ??
      new HttpClient({
        baseUrl: new URL(environment.apiPath ?? '/api/data/v9.2/', environment.url).toString(),
        defaultHeaders: {
          accept: 'application/json',
          'odata-version': '4.0',
          'odata-maxversion': '4.0',
        },
      });
  }

  async request<T>(options: DataverseRequestOptions): Promise<OperationResult<HttpResponse<T>>> {
    return this.httpClient.request<T>({
      path: options.path,
      method: options.method,
      query: options.query,
      body: options.body,
      rawBody: options.rawBody,
      headers: buildDataverseHeaders(options),
      authenticated: options.authenticated,
      responseType: options.responseType,
    });
  }

  async requestJson<T>(options: DataverseRequestOptions): Promise<OperationResult<T>> {
    return this.httpClient.requestJson<T>({
      path: options.path,
      method: options.method,
      query: options.query,
      body: options.body,
      rawBody: options.rawBody,
      headers: buildDataverseHeaders(options),
      authenticated: options.authenticated,
      responseType: options.responseType ?? 'json',
    });
  }

  async query<T>(options: QueryOptions): Promise<OperationResult<T[]>> {
    const page = await this.queryPage<T>(options);

    if (!page.success) {
      return page as unknown as OperationResult<T[]>;
    }

    return ok(page.data?.records ?? [], {
      supportTier: 'preview',
      diagnostics: page.diagnostics,
      warnings: page.warnings,
    });
  }

  async queryPage<T>(options: QueryOptions, continuationPath?: string): Promise<OperationResult<DataverseQueryPage<T>>> {
    const response = await this.request<DataverseCollectionResponse<T>>({
      path: continuationPath ?? buildQueryPath(options),
      method: 'GET',
      responseType: 'json',
      prefer: options.maxPageSize ? [`odata.maxpagesize=${options.maxPageSize}`] : undefined,
      includeAnnotations: options.includeAnnotations,
    });

    if (!response.success) {
      return response as unknown as OperationResult<DataverseQueryPage<T>>;
    }

    const payload = response.data?.data ?? {};

    return ok(
      {
        records: payload.value ?? [],
        count: payload['@odata.count'],
        nextLink: payload['@odata.nextLink'],
      },
      {
        supportTier: 'preview',
        diagnostics: response.diagnostics,
        warnings: response.warnings,
      }
    );
  }

  async queryAll<T>(options: QueryOptions): Promise<OperationResult<T[]>> {
    const records: T[] = [];
    let continuationPath: string | undefined;
    let attempts = 0;

    while (attempts < 1000) {
      const page = await this.queryPage<T>(options, continuationPath);

      if (!page.success) {
        return page as unknown as OperationResult<T[]>;
      }

      records.push(...(page.data?.records ?? []));
      continuationPath = page.data?.nextLink;

      if (!continuationPath) {
        return ok(records, {
          supportTier: 'preview',
          diagnostics: page.diagnostics,
          warnings: page.warnings,
        });
      }

      attempts += 1;
    }

    return fail(
      createDiagnostic('error', 'DATAVERSE_QUERY_PAGING_LIMIT', 'Query pagination exceeded the maximum page safety limit.', {
        source: '@pp/dataverse',
      })
    );
  }

  async getById<T>(table: string, id: string, options: EntityReadOptions = {}): Promise<OperationResult<T>> {
    return this.requestJson<T>({
      path: buildEntityPath(table, id, options),
      method: 'GET',
      responseType: 'json',
      includeAnnotations: options.includeAnnotations,
    });
  }

  async create<TRecord extends Record<string, unknown>, TResult = TRecord>(
    table: string,
    entity: TRecord,
    options: DataverseWriteOptions = {}
  ): Promise<OperationResult<DataverseWriteResult<TResult>>> {
    return this.write<TResult>('POST', buildCollectionPath(table, options), entity, options);
  }

  async update<TRecord extends Record<string, unknown>, TResult = TRecord>(
    table: string,
    id: string,
    entity: TRecord,
    options: DataverseWriteOptions = {}
  ): Promise<OperationResult<DataverseWriteResult<TResult>>> {
    return this.write<TResult>('PATCH', buildEntityPath(table, id, options), entity, options);
  }

  async upsert<TRecord extends Record<string, unknown>, TResult = TRecord>(
    entityPath: string,
    entity: TRecord,
    options: DataverseWriteOptions = {}
  ): Promise<OperationResult<DataverseWriteResult<TResult>>> {
    return this.write<TResult>('PATCH', entityPath, entity, options);
  }

  async delete(table: string, id: string, options: Pick<DataverseWriteOptions, 'ifMatch'> = {}): Promise<OperationResult<DataverseWriteResult>> {
    const response = await this.request<void>({
      path: buildEntityPath(table, id),
      method: 'DELETE',
      responseType: 'void',
      ifMatch: options.ifMatch,
    });

    if (!response.success) {
      return response as unknown as OperationResult<DataverseWriteResult>;
    }

    return ok(
      {
        status: response.data?.status ?? 204,
        headers: response.data?.headers ?? {},
        entityId: extractEntityId(response.data?.headers),
        location: extractLocation(response.data?.headers),
      },
      {
        supportTier: 'preview',
        diagnostics: response.diagnostics,
        warnings: response.warnings,
      }
    );
  }

  async whoAmI(): Promise<OperationResult<WhoAmIResult>> {
    return this.requestJson<WhoAmIResult>({
      path: 'WhoAmI()',
      method: 'GET',
      responseType: 'json',
    });
  }

  async listTables(options: MetadataQueryOptions = {}): Promise<OperationResult<EntityDefinition[]>> {
    return this.listMetadataCollection<EntityDefinition>('EntityDefinitions', options);
  }

  async getTable(logicalName: string, options: EntityReadOptions = {}): Promise<OperationResult<EntityDefinition>> {
    return this.requestJson<EntityDefinition>({
      path: buildMetadataEntityPath(logicalName, options),
      method: 'GET',
      responseType: 'json',
      includeAnnotations: options.includeAnnotations,
    });
  }

  async listColumns(logicalName: string, options: MetadataQueryOptions = {}): Promise<OperationResult<AttributeDefinition[]>> {
    return this.listMetadataCollection<AttributeDefinition>(buildAttributeCollectionPath(logicalName), options);
  }

  async getColumn(
    tableLogicalName: string,
    columnLogicalName: string,
    options: EntityReadOptions = {}
  ): Promise<OperationResult<AttributeDefinition>> {
    return this.requestJson<AttributeDefinition>({
      path: buildMetadataAttributePath(tableLogicalName, columnLogicalName, options),
      method: 'GET',
      responseType: 'json',
      includeAnnotations: options.includeAnnotations,
    });
  }

  async getGlobalOptionSet(
    name: string,
    options: EntityReadOptions = {}
  ): Promise<OperationResult<GlobalOptionSetDefinition>> {
    return this.requestJson<GlobalOptionSetDefinition>({
      path: buildGlobalOptionSetPath(name, options),
      method: 'GET',
      responseType: 'json',
      includeAnnotations: options.includeAnnotations,
    });
  }

  async getRelationship(
    schemaName: string,
    options: EntityReadOptions & { kind?: RelationshipMetadataKind } = {}
  ): Promise<OperationResult<RelationshipDefinition>> {
    const kinds = resolveRelationshipReadKinds(options.kind);
    const warnings: Diagnostic[] = [];

    for (const kind of kinds) {
      const response = await this.requestJson<RelationshipDefinition>({
        path: buildRelationshipPath(schemaName, kind, options),
        method: 'GET',
        responseType: 'json',
        includeAnnotations: options.includeAnnotations,
      });

      if (response.success) {
        return ok(response.data ?? {}, {
          supportTier: 'preview',
          diagnostics: response.diagnostics,
          warnings: [...warnings, ...response.warnings],
        });
      }

      warnings.push(
        createDiagnostic(
          'warning',
          'DATAVERSE_RELATIONSHIP_KIND_READ_FAILED',
          `Relationship ${schemaName} could not be read as ${kind}.`,
          {
            source: '@pp/dataverse',
            detail: response.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('; '),
          }
        ),
        ...demoteDiagnostics(response.diagnostics),
        ...response.warnings
      );
    }

    return fail(
      createDiagnostic('error', 'DATAVERSE_RELATIONSHIP_NOT_FOUND', `Relationship ${schemaName} could not be resolved.`, {
        source: '@pp/dataverse',
      }),
      {
        supportTier: 'preview',
        warnings,
      }
    );
  }

  async createTable(
    spec: TableCreateSpec,
    options: DataverseMetadataWriteOptions = {}
  ): Promise<OperationResult<DataverseMetadataWriteResult<EntityDefinition>>> {
    const logicalName = resolveLogicalName(spec.schemaName, spec.logicalName);
    const response = await this.request<void>({
      path: 'EntityDefinitions',
      method: 'POST',
      body: buildTableCreatePayload(spec, options),
      responseType: 'void',
      headers: buildMetadataWriteHeaders(options),
    });

    if (!response.success) {
      return response as unknown as OperationResult<DataverseMetadataWriteResult<EntityDefinition>>;
    }

    const entity = await this.getTable(logicalName, {
      includeAnnotations: options.includeAnnotations,
    });
    const publish = options.publish
      ? await this.publishEntities([logicalName], options.solutionUniqueName)
      : undefined;

    return buildMetadataWriteResult(response, entity, publish, [logicalName]);
  }

  async createColumn(
    tableLogicalName: string,
    spec: ColumnCreateSpec,
    options: DataverseMetadataWriteOptions = {}
  ): Promise<OperationResult<DataverseMetadataWriteResult<AttributeDefinition>>> {
    const logicalName = resolveLogicalName(spec.schemaName, spec.logicalName);
    const response = await this.request<void>({
      path: buildAttributeCollectionPath(tableLogicalName),
      method: 'POST',
      body: buildColumnCreatePayload(spec, options),
      responseType: 'void',
      headers: buildMetadataWriteHeaders(options),
    });

    if (!response.success) {
      return response as unknown as OperationResult<DataverseMetadataWriteResult<AttributeDefinition>>;
    }

    const entity = await this.getColumn(tableLogicalName, logicalName, {
      includeAnnotations: options.includeAnnotations,
    });
    const publish = options.publish
      ? await this.publishEntities([tableLogicalName], options.solutionUniqueName)
      : undefined;

    return buildMetadataWriteResult(response, entity, publish, [tableLogicalName]);
  }

  async createGlobalOptionSet(
    spec: GlobalOptionSetCreateSpec,
    options: DataverseMetadataWriteOptions = {}
  ): Promise<OperationResult<DataverseMetadataWriteResult<GlobalOptionSetDefinition>>> {
    const response = await this.request<void>({
      path: 'GlobalOptionSetDefinitions',
      method: 'POST',
      body: buildGlobalOptionSetCreatePayload(spec, options),
      responseType: 'void',
      headers: buildMetadataWriteHeaders(options),
    });

    if (!response.success) {
      return response as unknown as OperationResult<DataverseMetadataWriteResult<Record<string, unknown>>>;
    }

    const entity = await this.getGlobalOptionSet(spec.name, {
      includeAnnotations: options.includeAnnotations,
    });
    const publish = options.publish
      ? await this.publishOptionSets([spec.name], options.solutionUniqueName)
      : undefined;

    return buildMetadataWriteResult(response, entity, publish, [spec.name]);
  }

  async updateGlobalOptionSet(
    spec: GlobalOptionSetUpdateSpec,
    options: DataverseMetadataWriteOptions = {}
  ): Promise<OperationResult<DataverseMetadataWriteResult<GlobalOptionSetDefinition>>> {
    const hasChanges = Boolean(spec.add?.length || spec.update?.length || spec.removeValues?.length || spec.orderValues?.length);

    if (!hasChanges) {
      return fail(
        createDiagnostic(
          'error',
          'DATAVERSE_METADATA_OPTIONSET_UPDATE_EMPTY',
          'Global option set updates require at least one add, update, removeValues, or orderValues operation.',
          {
            source: '@pp/dataverse',
          }
        )
      );
    }

    let lastResponse: OperationResult<HttpResponse<unknown>> | undefined;

    for (const option of spec.add ?? []) {
      lastResponse = await this.request({
        path: 'InsertOptionValue',
        method: 'POST',
        body: compactObject({
          OptionSetName: spec.name,
          Label: buildDataverseLabel(option.label, options.languageCode),
          Description: option.description ? buildDataverseLabel(option.description, options.languageCode) : undefined,
          Color: option.color,
          Value: option.value,
        }),
        responseType: 'json',
        headers: buildMetadataWriteHeaders(options),
      });

      if (!lastResponse.success) {
        return lastResponse as unknown as OperationResult<DataverseMetadataWriteResult<GlobalOptionSetDefinition>>;
      }
    }

    for (const option of spec.update ?? []) {
      lastResponse = await this.request({
        path: 'UpdateOptionValue',
        method: 'POST',
        body: compactObject({
          OptionSetName: spec.name,
          Value: option.value,
          Label: option.label ? buildDataverseLabel(option.label, options.languageCode) : undefined,
          Description: option.description ? buildDataverseLabel(option.description, options.languageCode) : undefined,
          Color: option.color,
          MergeLabels: option.mergeLabels,
        }),
        responseType: 'void',
        headers: buildMetadataWriteHeaders(options),
      });

      if (!lastResponse.success) {
        return lastResponse as unknown as OperationResult<DataverseMetadataWriteResult<GlobalOptionSetDefinition>>;
      }
    }

    for (const value of spec.removeValues ?? []) {
      lastResponse = await this.request({
        path: 'DeleteOptionValue',
        method: 'POST',
        body: {
          OptionSetName: spec.name,
          Value: value,
        },
        responseType: 'void',
        headers: buildMetadataWriteHeaders(options),
      });

      if (!lastResponse.success) {
        return lastResponse as unknown as OperationResult<DataverseMetadataWriteResult<GlobalOptionSetDefinition>>;
      }
    }

    if (spec.orderValues && spec.orderValues.length > 0) {
      lastResponse = await this.request({
        path: 'OrderOption',
        method: 'POST',
        body: {
          OptionSetName: spec.name,
          Values: spec.orderValues,
        },
        responseType: 'void',
        headers: buildMetadataWriteHeaders(options),
      });

      if (!lastResponse.success) {
        return lastResponse as unknown as OperationResult<DataverseMetadataWriteResult<GlobalOptionSetDefinition>>;
      }
    }

    const entity = await this.getGlobalOptionSet(spec.name, {
      includeAnnotations: options.includeAnnotations,
    });
    const publish = options.publish
      ? await this.publishOptionSets([spec.name], options.solutionUniqueName)
      : undefined;

    return buildMetadataWriteResult(
      lastResponse ?? ok({ status: 204, headers: {}, data: undefined }, { supportTier: 'preview' }),
      entity,
      publish,
      [spec.name]
    );
  }

  async createOneToManyRelationship(
    spec: OneToManyRelationshipCreateSpec,
    options: DataverseMetadataWriteOptions = {}
  ): Promise<OperationResult<DataverseMetadataWriteResult<RelationshipDefinition>>> {
    const response = await this.request<void>({
      path: 'RelationshipDefinitions',
      method: 'POST',
      body: buildOneToManyRelationshipCreatePayload(spec, options),
      responseType: 'void',
      headers: buildMetadataWriteHeaders(options),
    });

    if (!response.success) {
      return response as unknown as OperationResult<DataverseMetadataWriteResult<Record<string, unknown>>>;
    }

    const entity = await this.getRelationship(spec.schemaName, {
      includeAnnotations: options.includeAnnotations,
    });
    const publishTargets = uniqueStrings([spec.referencedEntity, spec.referencingEntity]);
    const publish = options.publish
      ? await this.publishEntities(publishTargets, options.solutionUniqueName)
      : undefined;

    return buildMetadataWriteResult(response, entity, publish, publishTargets);
  }

  async createManyToManyRelationship(
    spec: ManyToManyRelationshipCreateSpec,
    options: DataverseMetadataWriteOptions = {}
  ): Promise<OperationResult<DataverseMetadataWriteResult<RelationshipDefinition>>> {
    const response = await this.request<void>({
      path: 'RelationshipDefinitions',
      method: 'POST',
      body: buildManyToManyRelationshipCreatePayload(spec, options),
      responseType: 'void',
      headers: buildMetadataWriteHeaders(options),
    });

    if (!response.success) {
      return response as unknown as OperationResult<DataverseMetadataWriteResult<RelationshipDefinition>>;
    }

    const entity = await this.getRelationship(spec.schemaName, {
      kind: 'many-to-many',
      includeAnnotations: options.includeAnnotations,
    });
    const publishTargets = uniqueStrings([spec.entity1LogicalName, spec.entity2LogicalName]);
    const publish = options.publish
      ? await this.publishEntities(publishTargets, options.solutionUniqueName)
      : undefined;

    return buildMetadataWriteResult(response, entity, publish, publishTargets);
  }

  async createCustomerRelationship(
    spec: CustomerRelationshipCreateSpec,
    options: DataverseMetadataWriteOptions = {}
  ): Promise<OperationResult<DataverseMetadataWriteResult<Record<string, unknown>>>> {
    const response = await this.request<Record<string, unknown>>({
      path: 'CreateCustomerRelationships',
      method: 'POST',
      body: buildCustomerRelationshipCreatePayload(spec, options),
      responseType: 'json',
      headers: buildMetadataWriteHeaders(options),
    });

    if (!response.success) {
      return response as unknown as OperationResult<DataverseMetadataWriteResult<Record<string, unknown>>>;
    }

    const lookupLogicalName = resolveLogicalName(spec.lookup.schemaName, spec.lookup.logicalName);
    const relationshipSchemaNames = [
      spec.accountRelationshipSchemaName ?? `${spec.tableLogicalName}_${lookupLogicalName}_account`,
      spec.contactRelationshipSchemaName ?? `${spec.tableLogicalName}_${lookupLogicalName}_contact`,
    ];

    const relationshipReads = await Promise.all(
      relationshipSchemaNames.map((schemaName) =>
        this.getRelationship(schemaName, {
          kind: 'one-to-many',
          includeAnnotations: options.includeAnnotations,
        })
      )
    );

    const readBack = combineReadResults(
      relationshipReads,
      {
        lookupLogicalName,
        relationships: relationshipReads.filter((result): result is OperationResult<RelationshipDefinition> & { success: true; data: RelationshipDefinition } => result.success && Boolean(result.data)).map((result) => result.data),
      },
      '@pp/dataverse',
      'DATAVERSE_METADATA_READBACK_FAILED',
      'Customer relationships were created, but relationship read-back did not fully succeed.'
    );

    const publishTargets = uniqueStrings(['account', 'contact', spec.tableLogicalName]);
    const publish = options.publish
      ? await this.publishEntities(publishTargets, options.solutionUniqueName)
      : undefined;

    return buildMetadataWriteResult(response, readBack, publish, publishTargets);
  }

  async publishXml(parameterXml: string, solutionUniqueName?: string): Promise<OperationResult<DataverseWriteResult>> {
    const response = await this.request<void>({
      path: 'PublishXml',
      method: 'POST',
      body: {
        ParameterXml: parameterXml,
      },
      responseType: 'void',
      headers: buildMetadataWriteHeaders({
        solutionUniqueName,
      }),
    });

    if (!response.success) {
      return response as unknown as OperationResult<DataverseWriteResult>;
    }

    return ok(
      {
        status: response.data?.status ?? 204,
        headers: response.data?.headers ?? {},
        entityId: extractEntityId(response.data?.headers),
        location: extractLocation(response.data?.headers),
      },
      {
        supportTier: 'preview',
        diagnostics: response.diagnostics,
        warnings: response.warnings,
      }
    );
  }

  async publishEntities(logicalNames: string[], solutionUniqueName?: string): Promise<OperationResult<DataverseWriteResult>> {
    const entities = uniqueStrings(logicalNames).map((logicalName) => `<entity>${escapeXml(logicalName)}</entity>`).join('');
    return this.publishXml(`<importexportxml><entities>${entities}</entities></importexportxml>`, solutionUniqueName);
  }

  async publishOptionSets(names: string[], solutionUniqueName?: string): Promise<OperationResult<DataverseWriteResult>> {
    const optionSets = uniqueStrings(names).map((name) => `<optionset>${escapeXml(name)}</optionset>`).join('');
    return this.publishXml(`<importexportxml><optionsets>${optionSets}</optionsets></importexportxml>`, solutionUniqueName);
  }

  private async metadataQuery<T>(
    path: string,
    maxPageSize?: number,
    includeAnnotations?: string[]
  ): Promise<OperationResult<T[]>> {
    const page = await this.request<DataverseCollectionResponse<T>>({
      path,
      method: 'GET',
      responseType: 'json',
      prefer: maxPageSize ? [`odata.maxpagesize=${maxPageSize}`] : undefined,
      includeAnnotations,
    });

    if (!page.success) {
      return page as unknown as OperationResult<T[]>;
    }

    return ok(page.data?.data.value ?? [], {
      supportTier: 'preview',
      diagnostics: page.diagnostics,
      warnings: page.warnings,
    });
  }

  private async metadataQueryAll<T>(
    path: string,
    maxPageSize?: number,
    includeAnnotations?: string[]
  ): Promise<OperationResult<T[]>> {
    const records: T[] = [];
    const warnings: Diagnostic[] = [];
    let continuationPath: string | undefined = path;
    let attempts = 0;

    while (continuationPath && attempts < 1000) {
      const page: OperationResult<HttpResponse<DataverseCollectionResponse<T>>> = await this.request<DataverseCollectionResponse<T>>({
        path: continuationPath,
        method: 'GET',
        responseType: 'json',
        prefer: maxPageSize ? [`odata.maxpagesize=${maxPageSize}`] : undefined,
        includeAnnotations,
      });

      if (!page.success) {
        return page as unknown as OperationResult<T[]>;
      }

      records.push(...(page.data?.data.value ?? []));
      warnings.push(...page.warnings);
      continuationPath = page.data?.data['@odata.nextLink'];
      attempts += 1;
    }

    if (continuationPath) {
      return fail(
        createDiagnostic('error', 'DATAVERSE_METADATA_PAGING_LIMIT', 'Metadata paging exceeded the maximum page safety limit.', {
          source: '@pp/dataverse',
        })
      );
    }

    return ok(records, {
      supportTier: 'preview',
      warnings,
    });
  }

  private async listMetadataCollection<T>(basePath: string, options: MetadataQueryOptions): Promise<OperationResult<T[]>> {
    const normalized = normalizeMetadataQueryOptions(basePath, options);

    if (!normalized.success || !normalized.data) {
      return normalized as unknown as OperationResult<T[]>;
    }

    const query = normalized.data.fetchAll
      ? await this.metadataQueryAll<T>(normalized.data.path, options.maxPageSize, options.includeAnnotations)
      : await this.metadataQuery<T>(normalized.data.path, options.maxPageSize, options.includeAnnotations);

    if (!query.success) {
      return {
        ...query,
        warnings: [...normalized.data.warnings, ...query.warnings],
      } as OperationResult<T[]>;
    }

    const records = normalized.data.top !== undefined ? (query.data ?? []).slice(0, normalized.data.top) : (query.data ?? []);

    return ok(records, {
      supportTier: 'preview',
      diagnostics: query.diagnostics,
      warnings: [...normalized.data.warnings, ...query.warnings],
    });
  }

  private async write<TResult>(
    method: 'POST' | 'PATCH',
    path: string,
    entity: Record<string, unknown>,
    options: DataverseWriteOptions
  ): Promise<OperationResult<DataverseWriteResult<TResult>>> {
    const returnRepresentation = shouldReturnRepresentation(options);
    const response = await this.request<TResult | undefined>({
      path,
      method,
      body: entity,
      responseType: returnRepresentation ? 'json' : 'void',
      ifMatch: options.ifMatch,
      ifNoneMatch: options.ifNoneMatch,
      prefer: mergePrefer(options.prefer, returnRepresentation ? ['return=representation'] : undefined),
      includeAnnotations: options.includeAnnotations,
      solutionUniqueName: options.solutionUniqueName,
    });

    if (!response.success) {
      return response as unknown as OperationResult<DataverseWriteResult<TResult>>;
    }

    return ok(
      {
        status: response.data?.status ?? 204,
        headers: response.data?.headers ?? {},
        entity: response.data?.data,
        entityId: extractEntityId(response.data?.headers),
        location: extractLocation(response.data?.headers),
      },
      {
        supportTier: 'preview',
        diagnostics: response.diagnostics,
        warnings: response.warnings,
      }
    );
  }
}

export class ConnectionReferenceService {
  constructor(private readonly dataverseClient: DataverseClient) {}

  async list(options: { solutionUniqueName?: string } = {}): Promise<OperationResult<ConnectionReferenceSummary[]>> {
    const [records, solutionId] = await Promise.all([
      this.dataverseClient.queryAll<ConnectionReferenceRecord>({
        table: 'connectionreferences',
        select: [
          'connectionreferenceid',
          'connectionreferencelogicalname',
          'connectionreferencedisplayname',
          'connectorid',
          'connectionid',
          'customconnectorid',
          '_solutionid_value',
          'statecode',
        ],
      }),
      options.solutionUniqueName ? resolveSolutionId(this.dataverseClient, options.solutionUniqueName) : Promise.resolve(ok(undefined, { supportTier: 'preview' })),
    ]);

    if (!records.success) {
      return records as unknown as OperationResult<ConnectionReferenceSummary[]>;
    }

    if (!solutionId.success) {
      return solutionId as unknown as OperationResult<ConnectionReferenceSummary[]>;
    }

    const summaries = (records.data ?? [])
      .filter((record) => !solutionId.data || record._solutionid_value === solutionId.data)
      .map(normalizeConnectionReference);

    return ok(summaries, {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(records.diagnostics, solutionId.diagnostics),
      warnings: mergeDiagnosticLists(records.warnings, solutionId.warnings),
    });
  }

  async inspect(identifier: string, options: { solutionUniqueName?: string } = {}): Promise<OperationResult<ConnectionReferenceSummary | undefined>> {
    const references = await this.list(options);

    if (!references.success) {
      return references as unknown as OperationResult<ConnectionReferenceSummary | undefined>;
    }

    return ok(
      (references.data ?? []).find((reference) => matchesConnectionReference(reference, identifier)),
      {
        supportTier: 'preview',
        diagnostics: references.diagnostics,
        warnings: references.warnings,
      }
    );
  }

  async validate(options: { solutionUniqueName?: string } = {}): Promise<OperationResult<ConnectionReferenceValidationResult[]>> {
    const references = await this.list(options);

    if (!references.success) {
      return references as unknown as OperationResult<ConnectionReferenceValidationResult[]>;
    }

    return ok(
      (references.data ?? []).map((reference) => {
        const diagnostics: Diagnostic[] = [];
        const suggestedNextActions: string[] = [];

        if (!reference.connectorId && !reference.customConnectorId) {
          diagnostics.push(
            createDiagnostic('error', 'DATAVERSE_CONNREF_CONNECTOR_MISSING', `Connection reference ${reference.displayName ?? reference.logicalName ?? reference.id} does not declare a connector id.`, {
              source: '@pp/dataverse',
            })
          );
          suggestedNextActions.push('Recreate or repair the connection reference so it binds to a connector.');
        }

        if (!reference.connectionId) {
          diagnostics.push(
            createDiagnostic('warning', 'DATAVERSE_CONNREF_CONNECTION_MISSING', `Connection reference ${reference.displayName ?? reference.logicalName ?? reference.id} has no active connection binding.`, {
              source: '@pp/dataverse',
            })
          );
          suggestedNextActions.push('Bind the connection reference to an active connection before deployment.');
        }

        return {
          reference,
          valid: diagnostics.every((diagnostic) => diagnostic.level !== 'error'),
          diagnostics,
          suggestedNextActions,
        };
      }),
      {
        supportTier: 'preview',
        diagnostics: references.diagnostics,
        warnings: references.warnings,
      }
    );
  }

  async setConnectionId(
    identifier: string,
    connectionId: string,
    options: { solutionUniqueName?: string } = {}
  ): Promise<OperationResult<ConnectionReferenceSummary>> {
    const reference = await this.inspect(identifier, options);

    if (!reference.success) {
      return reference as unknown as OperationResult<ConnectionReferenceSummary>;
    }

    if (!reference.data) {
      return fail(
        [
          ...reference.diagnostics,
          createDiagnostic('error', 'DATAVERSE_CONNREF_NOT_FOUND', `Connection reference ${identifier} was not found.`, {
            source: '@pp/dataverse',
          }),
        ],
        {
          supportTier: 'preview',
          warnings: reference.warnings,
        }
      );
    }

    const update = await this.dataverseClient.update(
      'connectionreferences',
      reference.data.id,
      {
        connectionid: connectionId,
      },
      {
        returnRepresentation: true,
      }
    );

    if (!update.success) {
      return update as unknown as OperationResult<ConnectionReferenceSummary>;
    }

    return ok(
      {
        ...reference.data,
        connectionId,
        connected: true,
      },
      {
        supportTier: 'preview',
        diagnostics: mergeDiagnosticLists(reference.diagnostics, update.diagnostics),
        warnings: mergeDiagnosticLists(reference.warnings, update.warnings),
      }
    );
  }
}

export class EnvironmentVariableService {
  constructor(private readonly dataverseClient: DataverseClient) {}

  async createDefinition(schemaName: string, options: EnvironmentVariableCreateOptions = {}): Promise<OperationResult<EnvironmentVariableSummary>> {
    const typeCode = normalizeEnvironmentVariableType(options.type);

    if (typeCode === undefined) {
      return fail(
        createDiagnostic(
          'error',
          'DATAVERSE_ENVVAR_TYPE_INVALID',
          `Environment variable type ${String(options.type)} is not supported. Use string, number, boolean, json, data-source, or secret.`,
          {
            source: '@pp/dataverse',
          }
        )
      );
    }

    const createResult = await this.dataverseClient.create<EnvironmentVariableDefinitionRecord, EnvironmentVariableDefinitionRecord>(
      'environmentvariabledefinitions',
      {
        schemaname: schemaName,
        displayname: options.displayName ?? schemaName,
        type: typeCode,
        ...(options.defaultValue !== undefined ? { defaultvalue: options.defaultValue } : {}),
        ...(options.valueSchema !== undefined ? { valueschema: options.valueSchema } : {}),
        ...(options.secretStore !== undefined ? { secretstore: options.secretStore } : {}),
      },
      {
        returnRepresentation: true,
        solutionUniqueName: options.solutionUniqueName,
      }
    );

    if (!createResult.success) {
      return createResult as unknown as OperationResult<EnvironmentVariableSummary>;
    }

    const created = createResult.data?.entity;

    return ok(
      normalizeEnvironmentVariable(
        {
          environmentvariabledefinitionid: created?.environmentvariabledefinitionid ?? createResult.data?.entityId ?? '',
          schemaname: created?.schemaname ?? schemaName,
          displayname: created?.displayname ?? options.displayName ?? schemaName,
          defaultvalue: created?.defaultvalue ?? options.defaultValue,
          type: created?.type ?? String(typeCode),
          valueschema: created?.valueschema ?? options.valueSchema,
          secretstore: created?.secretstore ?? options.secretStore,
        }
      ),
      {
        supportTier: 'preview',
        diagnostics: createResult.diagnostics,
        warnings: createResult.warnings,
      }
    );
  }

  async list(options: { solutionUniqueName?: string } = {}): Promise<OperationResult<EnvironmentVariableSummary[]>> {
    const [definitions, values, solutionId] = await Promise.all([
      this.dataverseClient.queryAll<EnvironmentVariableDefinitionRecord>({
        table: 'environmentvariabledefinitions',
        select: ['environmentvariabledefinitionid', 'schemaname', 'displayname', 'defaultvalue', 'type', 'valueschema', 'secretstore'],
      }),
      this.dataverseClient.queryAll<EnvironmentVariableValueRecord>({
        table: 'environmentvariablevalues',
        select: ['environmentvariablevalueid', 'value', '_environmentvariabledefinitionid_value', 'statecode'],
      }),
      options.solutionUniqueName ? resolveSolutionId(this.dataverseClient, options.solutionUniqueName) : Promise.resolve(ok(undefined, { supportTier: 'preview' })),
    ]);

    if (!definitions.success) {
      return definitions as unknown as OperationResult<EnvironmentVariableSummary[]>;
    }

    if (!values.success) {
      return values as unknown as OperationResult<EnvironmentVariableSummary[]>;
    }

    if (!solutionId.success) {
      return solutionId as unknown as OperationResult<EnvironmentVariableSummary[]>;
    }

    const solutionMembers = solutionId.data
      ? await listSolutionComponentObjectIds(this.dataverseClient, solutionId.data, 380)
      : ok<Set<string> | undefined>(undefined, { supportTier: 'preview' });

    if (!solutionMembers.success) {
      return solutionMembers as unknown as OperationResult<EnvironmentVariableSummary[]>;
    }

    const valueMap = new Map<string, EnvironmentVariableValueRecord>();

    for (const value of values.data ?? []) {
      if (value._environmentvariabledefinitionid_value && !valueMap.has(value._environmentvariabledefinitionid_value)) {
        valueMap.set(value._environmentvariabledefinitionid_value, value);
      }
    }

    return ok(
      (definitions.data ?? [])
        .filter((definition) => !solutionMembers.data || solutionMembers.data.has(definition.environmentvariabledefinitionid))
        .map((definition) => normalizeEnvironmentVariable(definition, valueMap.get(definition.environmentvariabledefinitionid))),
      {
        supportTier: 'preview',
        diagnostics: mergeDiagnosticLists(definitions.diagnostics, values.diagnostics, solutionId.diagnostics, solutionMembers.diagnostics),
        warnings: mergeDiagnosticLists(definitions.warnings, values.warnings, solutionId.warnings, solutionMembers.warnings),
      }
    );
  }

  async inspect(identifier: string, options: { solutionUniqueName?: string } = {}): Promise<OperationResult<EnvironmentVariableSummary | undefined>> {
    const variables = await this.list(options);

    if (!variables.success) {
      return variables as unknown as OperationResult<EnvironmentVariableSummary | undefined>;
    }

    return ok(
      (variables.data ?? []).find((variable) => matchesEnvironmentVariable(variable, identifier)),
      {
        supportTier: 'preview',
        diagnostics: variables.diagnostics,
        warnings: variables.warnings,
      }
    );
  }

  async setValue(identifier: string, value: string, options: { solutionUniqueName?: string } = {}): Promise<OperationResult<EnvironmentVariableSummary>> {
    const variable = await this.inspect(identifier, options);

    if (!variable.success) {
      return variable as unknown as OperationResult<EnvironmentVariableSummary>;
    }

    if (!variable.data) {
      return fail(
        createDiagnostic('error', 'DATAVERSE_ENVVAR_NOT_FOUND', `Environment variable ${identifier} was not found.`, {
          source: '@pp/dataverse',
        })
      );
    }

    const writeResult = variable.data.valueId
      ? await this.dataverseClient.update('environmentvariablevalues', variable.data.valueId, { value })
      : await this.dataverseClient.create('environmentvariablevalues', {
          value,
          'environmentvariabledefinitionid@odata.bind': `/environmentvariabledefinitions(${variable.data.definitionId})`,
        });

    if (!writeResult.success) {
      return writeResult as unknown as OperationResult<EnvironmentVariableSummary>;
    }

    return ok(
      {
        ...variable.data,
        currentValue: value,
        effectiveValue: value,
        valueId: variable.data.valueId ?? writeResult.data?.entityId,
        hasCurrentValue: true,
      },
      {
        supportTier: 'preview',
        diagnostics: mergeDiagnosticLists(variable.diagnostics, writeResult.diagnostics),
        warnings: mergeDiagnosticLists(variable.warnings, writeResult.warnings),
      }
    );
  }
}

export async function resolveDataverseClient(
  environmentAlias: string,
  options: ConfigStoreOptions = {}
): Promise<OperationResult<DataverseResolution>> {
  const environmentResult = await getEnvironmentAlias(environmentAlias, options);

  if (!environmentResult.success) {
    return environmentResult as unknown as OperationResult<DataverseResolution>;
  }

  if (!environmentResult.data) {
    return fail(
      createDiagnostic('error', 'DATAVERSE_ENV_NOT_FOUND', `Environment alias ${environmentAlias} was not found`, {
        source: '@pp/dataverse',
      })
    );
  }

  const authProfileResult = await getAuthProfile(environmentResult.data.authProfile, options);

  if (!authProfileResult.success) {
    return authProfileResult as unknown as OperationResult<DataverseResolution>;
  }

  if (!authProfileResult.data) {
    return fail(
      createDiagnostic(
        'error',
        'DATAVERSE_AUTH_PROFILE_NOT_FOUND',
        `Auth profile ${environmentResult.data.authProfile} referenced by ${environmentAlias} was not found`,
        {
          source: '@pp/dataverse',
        }
      )
    );
  }

  const tokenProvider = createTokenProvider(authProfileResult.data, options);

  if (!tokenProvider.success || !tokenProvider.data) {
    return tokenProvider as unknown as OperationResult<DataverseResolution>;
  }

  const client = new DataverseClient(
    {
      url: environmentResult.data.url,
      apiPath: environmentResult.data.apiPath,
    },
    new HttpClient({
      baseUrl: new URL(environmentResult.data.apiPath ?? '/api/data/v9.2/', environmentResult.data.url).toString(),
      defaultHeaders: {
        accept: 'application/json',
        'odata-version': '4.0',
        'odata-maxversion': '4.0',
      },
      tokenProvider: tokenProvider.data,
    })
  );

  return ok(
    {
      environment: environmentResult.data,
      authProfile: authProfileResult.data,
      client,
    },
    {
      supportTier: 'preview',
      provenance: [
        {
          kind: 'official-api',
          source: environmentResult.data.url,
        },
      ],
    }
  );
}

export function buildQueryPath(options: QueryOptions): string {
  return buildODataPath(options.table, options);
}

export function buildODataPath(basePath: string, options: ODataQueryOptions): string {
  const params = new URLSearchParams();

  if (options.select?.length) {
    params.set('$select', options.select.join(','));
  }

  if (options.top !== undefined) {
    params.set('$top', String(options.top));
  }

  if (options.filter) {
    params.set('$filter', options.filter);
  }

  if (options.expand?.length) {
    params.set('$expand', options.expand.join(','));
  }

  if (options.orderBy?.length) {
    params.set('$orderby', options.orderBy.join(','));
  }

  if (options.count) {
    params.set('$count', 'true');
  }

  const suffix = params.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
}

export function buildEntityPath(
  table: string,
  id: string,
  options: Pick<ODataQueryOptions, 'select' | 'expand'> = {}
): string {
  return buildODataPath(`${table}(${id})`, options);
}

export function buildCollectionPath(
  table: string,
  options: Pick<ODataQueryOptions, 'select' | 'expand'> = {}
): string {
  return buildODataPath(table, options);
}

export function buildMetadataEntityPath(
  logicalName: string,
  options: Pick<ODataQueryOptions, 'select' | 'expand'> = {}
): string {
  return buildODataPath(`EntityDefinitions(LogicalName='${escapeODataLiteral(logicalName)}')`, options);
}

export function buildAttributeCollectionPath(logicalName: string): string {
  return `${buildMetadataEntityPath(logicalName)}/Attributes`;
}

export function buildGlobalOptionSetPath(
  name: string,
  options: Pick<ODataQueryOptions, 'select' | 'expand'> = {}
): string {
  return buildODataPath(`GlobalOptionSetDefinitions(Name='${escapeODataLiteral(name)}')`, options);
}

export function buildRelationshipPath(
  schemaName: string,
  kind: Exclude<RelationshipMetadataKind, 'auto'> = 'one-to-many',
  options: Pick<ODataQueryOptions, 'select' | 'expand'> = {}
): string {
  const suffix =
    kind === 'many-to-many'
      ? '/Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata'
      : '/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata';

  return buildODataPath(
    `RelationshipDefinitions(SchemaName='${escapeODataLiteral(schemaName)}')${suffix}`,
    options
  );
}

export function buildMetadataAttributePath(
  tableLogicalName: string,
  columnLogicalName: string,
  options: Pick<ODataQueryOptions, 'select' | 'expand'> = {}
): string {
  return buildODataPath(
    `${buildAttributeCollectionPath(tableLogicalName)}(LogicalName='${escapeODataLiteral(columnLogicalName)}')`,
    options
  );
}

export function normalizeAttributeDefinition(
  attribute: AttributeDefinition,
  view: Exclude<AttributeMetadataView, 'raw'> = 'common'
): NormalizedAttributeDefinition | DetailedAttributeDefinition {
  const common: NormalizedAttributeDefinition = compactObject({
    logicalName: readString(attribute.LogicalName),
    schemaName: readString(attribute.SchemaName),
    displayName: readLocalizedLabel(attribute.DisplayName),
    description: readLocalizedLabel(attribute.Description),
    entityLogicalName: readString(attribute.EntityLogicalName),
    metadataId: readString(attribute.MetadataId),
    attributeType: readString(attribute.AttributeType),
    attributeTypeName: readManagedPrimitive<string>(attribute.AttributeTypeName),
    odataType: readString(attribute['@odata.type']),
    requiredLevel: readManagedPrimitive<string>(attribute.RequiredLevel),
    primaryId: readBoolean(attribute.IsPrimaryId),
    primaryName: readBoolean(attribute.IsPrimaryName),
    custom: readBoolean(attribute.IsCustomAttribute),
    managed: readBoolean(attribute.IsManaged),
    logical: readBoolean(attribute.IsLogical),
    createable: readBoolean(attribute.IsValidForCreate),
    readable: readBoolean(attribute.IsValidForRead),
    updateable: readBoolean(attribute.IsValidForUpdate),
    filterable: readBoolean(attribute.IsFilterable),
    searchable: readBoolean(attribute.IsSearchable),
    advancedFind: readManagedPrimitive<boolean>(attribute.IsValidForAdvancedFind),
    secured: readBoolean(attribute.IsSecured),
  });

  if (view === 'common') {
    return common;
  }

  return compactObject({
    ...common,
    customizable: readManagedPrimitive<boolean>(attribute.IsCustomizable),
    renameable: readManagedPrimitive<boolean>(attribute.IsRenameable),
    auditable: readManagedPrimitive<boolean>(attribute.IsAuditEnabled),
    localizable: readBoolean(attribute.IsLocalizable),
    requiredForForm: readBoolean(attribute.IsRequiredForForm),
    validForForm: readBoolean(attribute.IsValidForForm),
    validForGrid: readBoolean(attribute.IsValidForGrid),
    validODataAttribute: readBoolean(attribute.IsValidODataAttribute),
    secureCreate: readBoolean(attribute.CanBeSecuredForCreate),
    secureRead: readBoolean(attribute.CanBeSecuredForRead),
    secureUpdate: readBoolean(attribute.CanBeSecuredForUpdate),
    sortable: readManagedPrimitive<boolean>(attribute.IsSortableEnabled),
    sourceType: readNumber(attribute.SourceType),
    sourceTypeMask: readNumber(attribute.SourceTypeMask),
    introducedVersion: readString(attribute.IntroducedVersion),
    typeDetails: normalizeAttributeTypeDetails(attribute),
  }) as DetailedAttributeDefinition;
}

export function normalizeAttributeDefinitions(
  attributes: AttributeDefinition[],
  view: Exclude<AttributeMetadataView, 'raw'> = 'common'
): Array<NormalizedAttributeDefinition | DetailedAttributeDefinition> {
  return attributes.map((attribute) => normalizeAttributeDefinition(attribute, view));
}

export function normalizeGlobalOptionSetDefinition(optionSet: GlobalOptionSetDefinition): NormalizedOptionSetDefinition {
  const normalizedOptions = normalizeOptionSet(optionSet);

  return compactObject({
    ...(normalizedOptions ?? {}),
    description: readLocalizedLabel(optionSet.Description),
    metadataId: readString(optionSet.MetadataId),
    introducedVersion: readString(optionSet.IntroducedVersion),
  });
}

export function normalizeRelationshipDefinition(relationship: RelationshipDefinition): NormalizedRelationshipDefinition {
  const odataType = readString(relationship['@odata.type']);
  const relationshipType: NormalizedRelationshipDefinition['relationshipType'] = odataType?.includes('ManyToManyRelationshipMetadata')
    ? 'many-to-many'
    : odataType?.includes('OneToManyRelationshipMetadata')
      ? 'one-to-many'
      : 'unknown';

  if (relationshipType === 'many-to-many') {
    return compactObject({
      schemaName: readString(relationship.SchemaName),
      metadataId: readString(relationship.MetadataId),
      odataType,
      relationshipType,
      entity1LogicalName: readString(relationship.Entity1LogicalName),
      entity2LogicalName: readString(relationship.Entity2LogicalName),
      intersectEntityName: readString(relationship.IntersectEntityName),
      entity1NavigationPropertyName: readString(relationship.Entity1NavigationPropertyName),
      entity2NavigationPropertyName: readString(relationship.Entity2NavigationPropertyName),
    });
  }

  return compactObject({
    schemaName: readString(relationship.SchemaName),
    metadataId: readString(relationship.MetadataId),
    odataType,
    relationshipType,
    referencedEntity: readString(relationship.ReferencedEntity),
    referencedAttribute: readString(relationship.ReferencedAttribute),
    referencingEntity: readString(relationship.ReferencingEntity),
    lookupLogicalName: readString((relationship.Lookup as Record<string, unknown> | undefined)?.LogicalName),
    lookupSchemaName: readString((relationship.Lookup as Record<string, unknown> | undefined)?.SchemaName),
    lookupDisplayName: readLocalizedLabel((relationship.Lookup as Record<string, unknown> | undefined)?.DisplayName),
    cascade: normalizeCascadeConfiguration(relationship.CascadeConfiguration),
  });
}

export function normalizeMetadataQueryOptions(basePath: string, options: MetadataQueryOptions): OperationResult<NormalizedMetadataQuery> {
  if (options.orderBy && options.orderBy.length > 0) {
    return fail(
      createDiagnostic('error', 'DATAVERSE_METADATA_ORDERBY_UNSUPPORTED', 'Dataverse metadata queries do not support $orderby. Remove --orderby.', {
        source: '@pp/dataverse',
      })
    );
  }

  if (options.count) {
    return fail(
      createDiagnostic('error', 'DATAVERSE_METADATA_COUNT_UNSUPPORTED', 'Dataverse metadata queries do not support $count. Remove --count.', {
        source: '@pp/dataverse',
      })
    );
  }

  const warnings: Diagnostic[] = [];

  if (options.top !== undefined) {
    warnings.push(
      createDiagnostic(
        'warning',
        'DATAVERSE_METADATA_TOP_CLIENT_SIDE',
        'Dataverse metadata queries do not support $top. The limit was applied client-side after retrieval.',
        {
          source: '@pp/dataverse',
          hint: 'This may require reading more metadata than the final result count.',
        }
      )
    );
  }

  return ok(
    {
      path: buildODataPath(basePath, {
        select: options.select,
        filter: options.filter,
        expand: options.expand,
      }),
      top: options.top,
      fetchAll: Boolean(options.all || options.top !== undefined),
      warnings,
    },
    {
      supportTier: 'preview',
      warnings,
    }
  );
}

function normalizeConnectionReference(record: ConnectionReferenceRecord): ConnectionReferenceSummary {
  return {
    id: record.connectionreferenceid,
    logicalName: record.connectionreferencelogicalname,
    displayName: record.connectionreferencedisplayname ?? record.displayname,
    connectorId: record.connectorid,
    connectionId: record.connectionid,
    customConnectorId: record.customconnectorid,
    solutionId: record._solutionid_value,
    stateCode: record.statecode,
    connected: Boolean(record.connectionid),
  };
}

function normalizeEnvironmentVariable(
  definition: EnvironmentVariableDefinitionRecord,
  valueRecord?: EnvironmentVariableValueRecord
): EnvironmentVariableSummary {
  return {
    definitionId: definition.environmentvariabledefinitionid,
    schemaName: definition.schemaname,
    displayName: definition.displayname,
    type: definition.type,
    defaultValue: definition.defaultvalue,
    currentValue: valueRecord?.value,
    effectiveValue: valueRecord?.value ?? definition.defaultvalue,
    valueId: valueRecord?.environmentvariablevalueid,
    valueSchema: definition.valueschema,
    secretStore: definition.secretstore,
    solutionId: definition._solutionid_value,
    hasCurrentValue: valueRecord?.value !== undefined,
  };
}

function normalizeEnvironmentVariableType(type: string | number | undefined): number | undefined {
  if (type === undefined) {
    return 100000000;
  }

  if (typeof type === 'number' && Number.isInteger(type)) {
    return type;
  }

  const normalized = String(type)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');

  switch (normalized) {
    case '100000000':
    case 'string':
    case 'text':
      return 100000000;
    case '100000001':
    case 'number':
    case 'decimal':
      return 100000001;
    case '100000002':
    case 'boolean':
    case 'bool':
    case 'two-options':
    case 'yes-no':
      return 100000002;
    case '100000003':
    case 'json':
      return 100000003;
    case '100000004':
    case 'data-source':
    case 'datasource':
      return 100000004;
    case '100000005':
    case 'secret':
      return 100000005;
    default:
      return undefined;
  }
}

function matchesConnectionReference(reference: ConnectionReferenceSummary, identifier: string): boolean {
  const normalized = identifier.toLowerCase();
  return (
    reference.id.toLowerCase() === normalized ||
    reference.logicalName?.toLowerCase() === normalized ||
    reference.displayName?.toLowerCase() === normalized
  );
}

function matchesEnvironmentVariable(variable: EnvironmentVariableSummary, identifier: string): boolean {
  const normalized = identifier.toLowerCase();
  return (
    variable.definitionId.toLowerCase() === normalized ||
    variable.schemaName?.toLowerCase() === normalized ||
    variable.displayName?.toLowerCase() === normalized
  );
}

async function resolveSolutionId(client: DataverseClient, uniqueName: string): Promise<OperationResult<string | undefined>> {
  const solutions = await client.query<{ solutionid: string; uniquename: string }>({
    table: 'solutions',
    select: ['solutionid', 'uniquename'],
    filter: `uniquename eq '${escapeODataLiteral(uniqueName)}'`,
    top: 1,
  });

  if (!solutions.success) {
    return solutions as unknown as OperationResult<string | undefined>;
  }

  return ok(solutions.data?.[0]?.solutionid, {
    supportTier: 'preview',
    diagnostics: solutions.diagnostics,
    warnings: solutions.warnings,
  });
}

async function listSolutionComponentObjectIds(
  client: DataverseClient,
  solutionId: string,
  componentType: number
): Promise<OperationResult<Set<string>>> {
  const records = await client.queryAll<SolutionComponentMembershipRecord>({
    table: 'solutioncomponents',
    select: ['objectid'],
    filter: `_solutionid_value eq ${solutionId} and componenttype eq ${componentType}`,
  });

  if (!records.success) {
    return records as unknown as OperationResult<Set<string>>;
  }

  return ok(new Set((records.data ?? []).map((record) => record.objectid).filter((value): value is string => Boolean(value))), {
    supportTier: 'preview',
    diagnostics: records.diagnostics,
    warnings: records.warnings,
  });
}

function mergeDiagnosticLists(...lists: Array<Diagnostic[] | undefined>): Diagnostic[] {
  return lists.flatMap((list) => list ?? []);
}

function buildDataverseHeaders(options: DataverseRequestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  };
  const prefer = mergePrefer(options.prefer, buildAnnotationPrefer(options.includeAnnotations));

  if (prefer && prefer.length > 0) {
    headers.prefer = prefer.join(',');
  }

  if (options.ifMatch) {
    headers['if-match'] = options.ifMatch;
  }

  if (options.ifNoneMatch) {
    headers['if-none-match'] = options.ifNoneMatch;
  }

  const solutionUniqueName = (options as DataverseWriteOptions).solutionUniqueName;

  if (solutionUniqueName) {
    headers['MSCRM.SolutionUniqueName'] = solutionUniqueName;
  }

  return headers;
}

function buildMetadataWriteHeaders(options: Pick<DataverseMetadataWriteOptions, 'solutionUniqueName'>): Record<string, string> {
  const headers: Record<string, string> = {};

  if (options.solutionUniqueName) {
    headers['MSCRM.SolutionUniqueName'] = options.solutionUniqueName;
  }

  return headers;
}

function buildAnnotationPrefer(includeAnnotations: string[] | undefined): string[] | undefined {
  if (!includeAnnotations || includeAnnotations.length === 0) {
    return undefined;
  }

  return [`odata.include-annotations="${includeAnnotations.join(',')}"`];
}

function mergePrefer(...groups: Array<string[] | undefined>): string[] | undefined {
  const values = groups.flatMap((group) => group ?? []);
  return values.length > 0 ? values : undefined;
}

function shouldReturnRepresentation(options: DataverseWriteOptions): boolean {
  return Boolean(options.returnRepresentation || (options.select && options.select.length > 0) || (options.expand && options.expand.length > 0));
}

function extractEntityId(headers: Record<string, string> | undefined): string | undefined {
  const location = extractLocation(headers);

  if (!location) {
    return undefined;
  }

  const match = location.match(/\(([0-9a-fA-F-]{36})\)/);
  return match?.[1];
}

function extractLocation(headers: Record<string, string> | undefined): string | undefined {
  if (!headers) {
    return undefined;
  }

  return headers['odata-entityid'] ?? headers.location;
}

function buildMetadataWriteResult<T>(
  writeResponse: OperationResult<HttpResponse<unknown>>,
  readBack: OperationResult<T>,
  publishResponse: OperationResult<DataverseWriteResult> | undefined,
  publishTargets: string[]
): OperationResult<DataverseMetadataWriteResult<T>> {
  const writeHeaders = writeResponse.data?.headers ?? {};
  const warnings = [...writeResponse.warnings];
  const diagnostics = [...writeResponse.diagnostics];
  let entity: T | undefined;

  if (readBack.success) {
    entity = readBack.data;
    warnings.push(...readBack.warnings);
  } else {
    warnings.push(
      createDiagnostic('warning', 'DATAVERSE_METADATA_READBACK_FAILED', 'Metadata was created, but the follow-up read did not succeed.', {
        source: '@pp/dataverse',
        detail: readBack.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('; '),
      }),
      ...demoteDiagnostics(readBack.diagnostics),
      ...readBack.warnings
    );
  }

  let published: boolean | undefined;

  if (publishResponse) {
    if (publishResponse.success) {
      published = true;
      warnings.push(...publishResponse.warnings);
    } else {
      published = false;
      warnings.push(
        createDiagnostic('warning', 'DATAVERSE_METADATA_PUBLISH_FAILED', 'Metadata was created, but publish did not complete successfully.', {
          source: '@pp/dataverse',
          detail: publishResponse.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('; '),
        }),
        ...demoteDiagnostics(publishResponse.diagnostics),
        ...publishResponse.warnings
      );
    }
  }

  return ok(
    compactObject({
      status: writeResponse.data?.status ?? 204,
      headers: writeHeaders,
      entity,
      entityId: extractEntityId(writeHeaders) ?? readMetadataId(entity),
      location: extractLocation(writeHeaders),
      published,
      publishTargets: publishResponse ? publishTargets : undefined,
    }),
    {
      supportTier: 'preview',
      diagnostics,
      warnings,
    }
  );
}

function combineReadResults<T>(
  results: Array<OperationResult<unknown>>,
  entity: T,
  source: string,
  warningCode: string,
  warningMessage: string
): OperationResult<T> {
  const warnings: Diagnostic[] = [];

  for (const result of results) {
    if (result.success) {
      warnings.push(...result.warnings);
      continue;
    }

    warnings.push(
      createDiagnostic('warning', warningCode, warningMessage, {
        source,
        detail: result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('; '),
      }),
      ...demoteDiagnostics(result.diagnostics),
      ...result.warnings
    );
  }

  return ok(entity, {
    supportTier: 'preview',
    warnings,
  });
}

function escapeODataLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function normalizeAttributeTypeDetails(attribute: AttributeDefinition): Record<string, unknown> {
  const optionSet = normalizeOptionSet(attribute.OptionSet);

  return compactObject({
    format: readString(attribute.Format) ?? readManagedPrimitive<string>(attribute.FormatName),
    maxLength: readNumber(attribute.MaxLength),
    databaseLength: readNumber(attribute.DatabaseLength),
    minValue: readNumber(attribute.MinValue),
    maxValue: readNumber(attribute.MaxValue),
    precision: readNumber(attribute.Precision),
    precisionSource: readNumber(attribute.PrecisionSource),
    autoNumberFormat: readString(attribute.AutoNumberFormat),
    imeMode: readString(attribute.ImeMode),
    targets: readStringArray(attribute.Targets),
    defaultFormValue: readPrimitive(attribute.DefaultFormValue),
    formulaDefinition: readString(attribute.FormulaDefinition),
    optionSet,
  });
}

function normalizeOptionSet(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const optionSet = value as Record<string, unknown>;
  const options = Array.isArray(optionSet.Options)
    ? optionSet.Options.flatMap((option) => {
        if (!option || typeof option !== 'object' || Array.isArray(option)) {
          return [];
        }

        const entry = option as Record<string, unknown>;
        return [
          compactObject({
            value: readNumber(entry.Value),
            label: readLocalizedLabel(entry.Label),
            description: readLocalizedLabel(entry.Description),
            color: readString(entry.Color),
            isManaged: readBoolean(entry.IsManaged),
          }),
        ];
      })
    : undefined;

  const normalized = compactObject({
    name: readString(optionSet.Name),
    displayName: readLocalizedLabel(optionSet.DisplayName),
    isGlobal: readBoolean(optionSet.IsGlobal),
    optionSetType: readString(optionSet.OptionSetType),
    options,
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeCascadeConfiguration(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const cascade = value as Record<string, unknown>;
  const normalized = compactObject({
    assign: readString(cascade.Assign),
    delete: readString(cascade.Delete),
    merge: readString(cascade.Merge),
    reparent: readString(cascade.Reparent),
    share: readString(cascade.Share),
    unshare: readString(cascade.Unshare),
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function readMetadataId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return readString((value as Record<string, unknown>).MetadataId);
}

function demoteDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    level: 'warning',
  }));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function resolveRelationshipReadKinds(kind: RelationshipMetadataKind | undefined): Array<Exclude<RelationshipMetadataKind, 'auto'>> {
  if (kind === 'one-to-many' || kind === 'many-to-many') {
    return [kind];
  }

  return ['one-to-many', 'many-to-many'];
}

function buildDataverseLabel(text: string, languageCode = 1033): Record<string, unknown> {
  return {
    '@odata.type': 'Microsoft.Dynamics.CRM.Label',
    LocalizedLabels: [
      {
        '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel',
        Label: text,
        LanguageCode: languageCode,
        IsManaged: false,
      },
    ],
    UserLocalizedLabel: {
      '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel',
      Label: text,
      LanguageCode: languageCode,
      IsManaged: false,
    },
  };
}

export {
  buildColumnCreatePayload,
  buildCustomerRelationshipCreatePayload,
  buildGlobalOptionSetCreatePayload,
  buildManyToManyRelationshipCreatePayload,
  buildOneToManyRelationshipCreatePayload,
  buildTableCreatePayload,
  parseCustomerRelationshipCreateSpec,
  parseColumnCreateSpec,
  parseGlobalOptionSetCreateSpec,
  parseGlobalOptionSetUpdateSpec,
  parseManyToManyRelationshipCreateSpec,
  parseOneToManyRelationshipCreateSpec,
  parseTableCreateSpec,
  resolveLogicalName,
  type ColumnCreateSpec,
  type CustomerRelationshipCreateSpec,
  type GlobalOptionSetCreateSpec,
  type GlobalOptionSetUpdateSpec,
  type ManyToManyRelationshipCreateSpec,
  type MetadataBuildOptions,
  type OneToManyRelationshipCreateSpec,
  type TableCreateSpec,
} from './metadata-create';

function readManagedPrimitive<T extends string | number | boolean>(value: unknown): T | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value as T;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return readPrimitive((value as Record<string, unknown>).Value) as T | undefined;
}

function readLocalizedLabel(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const userLabel = record.UserLocalizedLabel;

  if (userLabel && typeof userLabel === 'object' && !Array.isArray(userLabel)) {
    const label = readString((userLabel as Record<string, unknown>).Label);

    if (label) {
      return label;
    }
  }

  const labels = record.LocalizedLabels;

  if (!Array.isArray(labels)) {
    return undefined;
  }

  for (const entry of labels) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const label = readString((entry as Record<string, unknown>).Label);

    if (label) {
      return label;
    }
  }

  return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry));
  return items.length > 0 ? items : undefined;
}

function readPrimitive(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
