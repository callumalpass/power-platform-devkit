import { createTokenProvider, type AuthProfile } from '@pp/auth';
import { getAuthProfile, getEnvironmentAlias, type ConfigStoreOptions, type EnvironmentAlias } from '@pp/config';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { HttpClient, type HttpQueryValue, type HttpRequestOptions, type HttpResponse } from '@pp/http';
import {
  buildColumnCreatePayload,
  buildGlobalOptionSetCreatePayload,
  buildOneToManyRelationshipCreatePayload,
  buildTableCreatePayload,
  resolveLogicalName,
  type ColumnCreateSpec,
  type GlobalOptionSetCreateSpec,
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
}

export interface DataverseWriteOptions extends EntityReadOptions {
  ifMatch?: string;
  ifNoneMatch?: string;
  returnRepresentation?: boolean;
  prefer?: string[];
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
export type AttributeMetadataView = 'common' | 'detailed' | 'raw';

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
  ): Promise<OperationResult<Record<string, unknown>>> {
    return this.requestJson<Record<string, unknown>>({
      path: buildGlobalOptionSetPath(name, options),
      method: 'GET',
      responseType: 'json',
      includeAnnotations: options.includeAnnotations,
    });
  }

  async getRelationship(
    schemaName: string,
    options: EntityReadOptions = {}
  ): Promise<OperationResult<Record<string, unknown>>> {
    return this.requestJson<Record<string, unknown>>({
      path: buildRelationshipPath(schemaName, options),
      method: 'GET',
      responseType: 'json',
      includeAnnotations: options.includeAnnotations,
    });
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
  ): Promise<OperationResult<DataverseMetadataWriteResult<Record<string, unknown>>>> {
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

  async createOneToManyRelationship(
    spec: OneToManyRelationshipCreateSpec,
    options: DataverseMetadataWriteOptions = {}
  ): Promise<OperationResult<DataverseMetadataWriteResult<Record<string, unknown>>>> {
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
  options: Pick<ODataQueryOptions, 'select' | 'expand'> = {}
): string {
  return buildODataPath(
    `RelationshipDefinitions(SchemaName='${escapeODataLiteral(schemaName)}')/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata`,
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
  writeResponse: OperationResult<HttpResponse<void>>,
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

export {
  buildColumnCreatePayload,
  buildGlobalOptionSetCreatePayload,
  buildOneToManyRelationshipCreatePayload,
  buildTableCreatePayload,
  parseColumnCreateSpec,
  parseGlobalOptionSetCreateSpec,
  parseOneToManyRelationshipCreateSpec,
  parseTableCreateSpec,
  resolveLogicalName,
  type ColumnCreateSpec,
  type GlobalOptionSetCreateSpec,
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
