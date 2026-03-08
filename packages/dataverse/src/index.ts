import { createTokenProvider, type AuthProfile } from '@pp/auth';
import { getAuthProfile, getEnvironmentAlias, type ConfigStoreOptions, type EnvironmentAlias } from '@pp/config';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { HttpClient, type HttpQueryValue, type HttpRequestOptions, type HttpResponse } from '@pp/http';

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

export type EntityDefinition = Record<string, unknown>;

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
    const normalized = normalizeMetadataQueryOptions(options);

    if (!normalized.success || !normalized.data) {
      return normalized as unknown as OperationResult<EntityDefinition[]>;
    }

    const path = normalized.data.path;

    const query = normalized.data.fetchAll
      ? await this.metadataQueryAll<EntityDefinition>(path, options.maxPageSize, options.includeAnnotations)
      : await this.metadataQuery<EntityDefinition>(path, options.maxPageSize, options.includeAnnotations);

    if (!query.success) {
      return {
        ...query,
        warnings: [...normalized.data.warnings, ...query.warnings],
      } as OperationResult<EntityDefinition[]>;
    }

    const records = normalized.data.top !== undefined ? (query.data ?? []).slice(0, normalized.data.top) : (query.data ?? []);

    return ok(records, {
      supportTier: 'preview',
      diagnostics: query.diagnostics,
      warnings: [...normalized.data.warnings, ...query.warnings],
    });
  }

  async getTable(logicalName: string, options: EntityReadOptions = {}): Promise<OperationResult<EntityDefinition>> {
    return this.requestJson<EntityDefinition>({
      path: buildMetadataEntityPath(logicalName, options),
      method: 'GET',
      responseType: 'json',
      includeAnnotations: options.includeAnnotations,
    });
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

export function normalizeMetadataQueryOptions(options: MetadataQueryOptions): OperationResult<NormalizedMetadataQuery> {
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
      path: buildODataPath('EntityDefinitions', {
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

function escapeODataLiteral(value: string): string {
  return value.replaceAll("'", "''");
}
