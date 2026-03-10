import { createTokenProvider, type AuthProfile, type PublicClientLoginOptions } from '@pp/auth';
import { getAuthProfile, getEnvironmentAlias, type ConfigStoreOptions, type EnvironmentAlias } from '@pp/config';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { HttpClient, type HttpQueryValue, type HttpRequestOptions, type HttpResponse } from '@pp/http';
import {
  buildColumnCreatePayload,
  buildColumnUpdatePayload,
  buildCustomerRelationshipCreatePayload,
  buildGlobalOptionSetCreatePayload,
  buildManyToManyRelationshipUpdatePayload,
  buildManyToManyRelationshipCreatePayload,
  buildOneToManyRelationshipCreatePayload,
  buildOneToManyRelationshipUpdatePayload,
  buildTableCreatePayload,
  buildTableUpdatePayload,
  parseColumnUpdateSpec,
  parseManyToManyRelationshipUpdateSpec,
  parseOneToManyRelationshipUpdateSpec,
  parseTableUpdateSpec,
  resolveLogicalName,
  type ColumnUpdateSpec,
  type ColumnCreateSpec,
  type CustomerRelationshipCreateSpec,
  type GlobalOptionSetCreateSpec,
  type GlobalOptionSetUpdateSpec,
  type ManyToManyRelationshipUpdateSpec,
  type ManyToManyRelationshipCreateSpec,
  type MetadataApplyOperation,
  type MetadataApplyPlan,
  type MetadataBuildOptions,
  type OneToManyRelationshipUpdateSpec,
  type OneToManyRelationshipCreateSpec,
  type TableUpdateSpec,
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

type MetadataRecordPredicate<T> = (record: T) => boolean;

export interface DataverseResolution {
  environment: EnvironmentAlias;
  authProfile: AuthProfile;
  client: DataverseClient;
}

export interface ResolveDataverseClientOptions extends ConfigStoreOptions {
  publicClientLoginOptions?: PublicClientLoginOptions;
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

export interface DataverseOperationResult<T = unknown> {
  status: number;
  headers: Record<string, string>;
  body?: T;
  entityId?: string;
  location?: string;
}

export interface DataverseActionOptions
  extends Pick<DataverseRequestOptions, 'headers' | 'responseType' | 'includeAnnotations' | 'solutionUniqueName'> {
  boundPath?: string;
}

export interface DataverseFunctionOptions
  extends Pick<DataverseRequestOptions, 'headers' | 'responseType' | 'includeAnnotations'> {
  boundPath?: string;
}

export interface DataverseBatchRequest {
  id?: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  atomicGroup?: string;
}

export interface DataverseBatchOptions {
  continueOnError?: boolean;
  includeAnnotations?: string[];
  solutionUniqueName?: string;
}

export interface DataverseBatchResponse<T = unknown> {
  id?: string;
  status: number;
  headers: Record<string, string>;
  body?: T;
  contentId?: string;
}

export interface DataverseRowExport<T = Record<string, unknown>> {
  kind: 'dataverse-row-set';
  version: 1;
  table: string;
  exportedAt: string;
  environmentUrl: string;
  query: {
    select?: string[];
    top?: number;
    filter?: string;
    expand?: string[];
    orderBy?: string[];
    count?: boolean;
    all?: boolean;
  };
  recordCount: number;
  records: T[];
}

export interface DataverseRowExportOptions extends QueryOptions {
  all?: boolean;
}

export interface DataverseRowApplyOperation {
  kind: 'create' | 'update' | 'upsert' | 'delete';
  requestId?: string;
  table?: string;
  recordId?: string;
  path?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  atomicGroup?: string;
  ifMatch?: string;
  ifNoneMatch?: string;
  returnRepresentation?: boolean;
  select?: string[];
  expand?: string[];
  prefer?: string[];
}

export interface DataverseRowApplyOptions extends DataverseBatchOptions {
  table?: string;
}

export interface DataverseRowApplyResult<T = unknown> {
  index: number;
  kind: DataverseRowApplyOperation['kind'];
  table?: string;
  recordId?: string;
  path: string;
  status: number;
  headers: Record<string, string>;
  body?: T;
  contentId?: string;
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

export interface DataverseMetadataApplyOperationResult {
  kind: MetadataApplyOperation['kind'];
  status: number;
  entity?: unknown;
  entityId?: string;
  location?: string;
  publishTargets?: string[];
  optionSetPublishTargets?: string[];
}

export interface DataverseMetadataApplyResult {
  operations: DataverseMetadataApplyOperationResult[];
  published?: boolean;
  publishTargets?: string[];
  optionSetPublishTargets?: string[];
}

export type DataverseMetadataSnapshotKind = 'table' | 'columns' | 'option-set' | 'relationship';

export interface NormalizedEntityDefinition {
  logicalName?: string;
  schemaName?: string;
  displayName?: string;
  pluralDisplayName?: string;
  description?: string;
  metadataId?: string;
  ownershipType?: string;
  entitySetName?: string;
  primaryIdAttribute?: string;
  primaryNameAttribute?: string;
  introducedVersion?: string;
  custom?: boolean;
  managed?: boolean;
  activity?: boolean;
  activityTypeMask?: number;
  intersect?: boolean;
  auditEnabled?: boolean;
  changeTrackingEnabled?: boolean;
  connectionsEnabled?: boolean;
  hasActivities?: boolean;
  notesEnabled?: boolean;
}

export interface DataverseMetadataSnapshot<T = unknown> {
  schemaVersion: 1;
  generatedAt: string;
  environmentUrl: string;
  kind: DataverseMetadataSnapshotKind;
  target: {
    logicalName?: string;
    name?: string;
    schemaName?: string;
    relationshipKind?: Exclude<RelationshipMetadataKind, 'auto'>;
  };
  value: T;
}

export interface DataverseMetadataDiffEntry {
  kind: 'added' | 'removed' | 'changed';
  path: string;
  left?: unknown;
  right?: unknown;
}

export interface DataverseMetadataDiffResult {
  compatible: true;
  left: Pick<DataverseMetadataSnapshot, 'kind' | 'target'>;
  right: Pick<DataverseMetadataSnapshot, 'kind' | 'target'>;
  summary: {
    added: number;
    removed: number;
    changed: number;
    total: number;
  };
  changes: DataverseMetadataDiffEntry[];
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
  referencingAttribute?: string;
  lookupLogicalName?: string;
  lookupSchemaName?: string;
  lookupDisplayName?: string;
  associatedMenuLabel?: string;
  associatedMenuBehavior?: string;
  associatedMenuGroup?: string;
  associatedMenuOrder?: number;
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

export interface ConnectionReferenceCreateOptions {
  displayName?: string;
  connectorId?: string;
  customConnectorId?: string;
  solutionUniqueName?: string;
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

export interface CanvasAppRecord {
  canvasappid: string;
  displayname?: string;
  name?: string;
  appopenuri?: string;
  appversion?: string;
  createdbyclientversion?: string;
  lastpublishtime?: string;
  status?: string;
  tags?: string;
}

export interface CanvasAppSummary {
  id: string;
  displayName?: string;
  name?: string;
  openUri?: string;
  appVersion?: string;
  createdByClientVersion?: string;
  lastPublishTime?: string;
  status?: string;
  tags: string[];
}

export interface ModelDrivenAppRecord {
  appmoduleid: string;
  uniquename?: string;
  name?: string;
  appmoduleversion?: string;
  statecode?: number;
  publishedon?: string;
}

export interface ModelDrivenAppSummary {
  id: string;
  uniqueName?: string;
  name?: string;
  version?: string;
  stateCode?: number;
  publishedOn?: string;
}

export interface ModelDrivenAppComponentRecord {
  appmodulecomponentid: string;
  componenttype?: number;
  objectid?: string;
  appmoduleidunique?: string;
  _appmoduleidunique_value?: string;
}

export interface ModelDrivenAppComponentSummary {
  id: string;
  componentType?: number;
  objectId?: string;
  appId?: string;
}

export interface ModelDrivenAppFormRecord {
  formid: string;
  name?: string;
  objecttypecode?: string;
  type?: number;
}

export interface ModelDrivenAppFormSummary {
  id: string;
  name?: string;
  table?: string;
  formType?: number;
}

export interface ModelDrivenAppViewRecord {
  savedqueryid: string;
  name?: string;
  returnedtypecode?: string;
  querytype?: number;
}

export interface ModelDrivenAppViewSummary {
  id: string;
  name?: string;
  table?: string;
  queryType?: number;
}

export interface ModelDrivenAppSitemapRecord {
  sitemapid: string;
  sitemapname?: string;
}

export interface ModelDrivenAppSitemapSummary {
  id: string;
  name?: string;
}

export interface CloudFlowRecord {
  workflowid: string;
  name?: string;
  category?: number;
  statecode?: number;
  statuscode?: number;
  uniquename?: string;
  clientdata?: string;
}

export interface CloudFlowConnectionReference {
  name: string;
  connectionReferenceLogicalName?: string;
  connectionId?: string;
  apiId?: string;
}

export interface CloudFlowSummary {
  id: string;
  name?: string;
  uniqueName?: string;
  category?: number;
  stateCode?: number;
  statusCode?: number;
  definitionAvailable: boolean;
  connectionReferences: CloudFlowConnectionReference[];
  parameters: string[];
  environmentVariables: string[];
}

export interface CloudFlowInspectResult extends CloudFlowSummary {
  clientData?: Record<string, unknown>;
}

export interface CloudFlowRunRecord {
  flowrunid?: string;
  name?: string;
  workflowid?: string;
  workflowname?: string;
  status?: string;
  starttime?: string;
  endtime?: string;
  durationinms?: number;
  retrycount?: number;
  errorcode?: string;
  errormessage?: string;
}

export interface CloudFlowRunSummary {
  id: string;
  workflowId?: string;
  workflowName?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  retryCount?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface CloudFlowRunListOptions {
  workflowId?: string;
  workflowName?: string;
  workflowUniqueName?: string;
  status?: string;
  since?: string;
}

interface SolutionComponentMembershipRecord {
  objectid?: string;
}

const DATAVERSE_HTTP_RETRIES = 5;
const DATAVERSE_HTTP_RETRY_DELAY_MS = 1000;

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
        retries: DATAVERSE_HTTP_RETRIES,
        retryDelayMs: DATAVERSE_HTTP_RETRY_DELAY_MS,
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

  async invokeAction<TResult = unknown>(
    name: string,
    parameters: Record<string, unknown> = {},
    options: DataverseActionOptions = {}
  ): Promise<OperationResult<DataverseOperationResult<TResult>>> {
    const response = await this.request<TResult | undefined>({
      path: buildDataverseActionPath(name, options.boundPath),
      method: 'POST',
      body: parameters,
      responseType: options.responseType ?? 'json',
      headers: options.headers,
      includeAnnotations: options.includeAnnotations,
      solutionUniqueName: options.solutionUniqueName,
    });

    if (!response.success) {
      return response as unknown as OperationResult<DataverseOperationResult<TResult>>;
    }

    return ok(
      {
        status: response.data?.status ?? 204,
        headers: response.data?.headers ?? {},
        body: response.data?.data,
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

  async invokeFunction<TResult = unknown>(
    name: string,
    parameters: Record<string, unknown> = {},
    options: DataverseFunctionOptions = {}
  ): Promise<OperationResult<DataverseOperationResult<TResult>>> {
    const functionPath = buildDataverseFunctionPath(name, parameters, options.boundPath);

    if (!functionPath.success || !functionPath.data) {
      return functionPath as unknown as OperationResult<DataverseOperationResult<TResult>>;
    }

    const response = await this.request<TResult | undefined>({
      path: functionPath.data,
      method: 'GET',
      responseType: options.responseType ?? 'json',
      headers: options.headers,
      includeAnnotations: options.includeAnnotations,
    });

    if (!response.success) {
      return response as unknown as OperationResult<DataverseOperationResult<TResult>>;
    }

    return ok(
      {
        status: response.data?.status ?? 200,
        headers: response.data?.headers ?? {},
        body: response.data?.data,
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

  async executeBatch<TResult = unknown>(
    requests: DataverseBatchRequest[],
    options: DataverseBatchOptions = {}
  ): Promise<OperationResult<DataverseBatchResponse<TResult>[]>> {
    if (requests.length === 0) {
      return fail(
        createDiagnostic('error', 'DATAVERSE_BATCH_EMPTY', 'Dataverse batch execution requires at least one request.', {
          source: '@pp/dataverse',
        })
      );
    }

    const payload = buildDataverseBatchPayload(requests);
    const response = await this.request<string>({
      path: '$batch',
      method: 'POST',
      rawBody: payload.body,
      responseType: 'text',
      headers: {
        ...buildDataverseBatchHeaders(payload.boundary, options),
      },
      includeAnnotations: options.includeAnnotations,
      solutionUniqueName: options.solutionUniqueName,
    });

    if (!response.success) {
      return response as unknown as OperationResult<DataverseBatchResponse<TResult>[]>;
    }

    const parsed = parseDataverseBatchResponse<TResult>(response.data?.data ?? '', response.data?.headers['content-type']);

    if (!parsed.success || !parsed.data) {
      return parsed;
    }

    return ok(parsed.data, {
      supportTier: 'preview',
      diagnostics: response.diagnostics,
      warnings: response.warnings,
    });
  }

  async exportRows<T = Record<string, unknown>>(options: DataverseRowExportOptions): Promise<OperationResult<DataverseRowExport<T>>> {
    const queryResult = options.all ? await this.queryAll<T>(options) : await this.query<T>(options);

    if (!queryResult.success) {
      return queryResult as unknown as OperationResult<DataverseRowExport<T>>;
    }

    const records = queryResult.data ?? [];

    return ok(
      {
        kind: 'dataverse-row-set',
        version: 1,
        table: options.table,
        exportedAt: new Date().toISOString(),
        environmentUrl: this.environment.url,
        query: compactObject({
          select: options.select,
          top: options.top,
          filter: options.filter,
          expand: options.expand,
          orderBy: options.orderBy,
          count: options.count,
          all: options.all ? true : undefined,
        }),
        recordCount: records.length,
        records,
      },
      {
        supportTier: 'preview',
        diagnostics: queryResult.diagnostics,
        warnings: queryResult.warnings,
      }
    );
  }

  async applyRows<TResult = Record<string, unknown>>(
    operations: DataverseRowApplyOperation[],
    options: DataverseRowApplyOptions = {}
  ): Promise<OperationResult<DataverseRowApplyResult<TResult>[]>> {
    if (operations.length === 0) {
      return fail(
        createDiagnostic('error', 'DATAVERSE_ROW_APPLY_EMPTY', 'Dataverse row apply requires at least one operation.', {
          source: '@pp/dataverse',
        })
      );
    }

    const requests: DataverseBatchRequest[] = [];
    const normalizedOperations: Array<DataverseRowApplyOperation & { table?: string; recordId?: string; path: string }> = [];

    for (const operation of operations) {
      const normalized = normalizeRowApplyOperation(operation, options.table);

      if (!normalized.success || !normalized.data) {
        return normalized as unknown as OperationResult<DataverseRowApplyResult<TResult>[]>;
      }

      normalizedOperations.push(normalized.data);
      requests.push({
        id: normalized.data.requestId,
        method: mapRowApplyMethod(normalized.data.kind),
        path: normalized.data.path,
        headers: buildRowApplyHeaders(normalized.data),
        body: normalized.data.kind === 'delete' ? undefined : normalized.data.body,
        atomicGroup: normalized.data.atomicGroup,
      });
    }

    const response = await this.executeBatch<TResult>(requests, options);

    if (!response.success || !response.data) {
      return response as unknown as OperationResult<DataverseRowApplyResult<TResult>[]>;
    }

    return ok(
      response.data.map((entry, index) => {
        const operation = normalizedOperations[index];
        return {
          index,
          kind: operation.kind,
          table: operation.table,
          recordId: operation.recordId,
          path: operation.path,
          status: entry.status,
          headers: entry.headers,
          body: entry.body,
          contentId: entry.contentId,
          entityId: extractEntityId(entry.headers),
          location: extractLocation(entry.headers),
        };
      }),
      {
        supportTier: 'preview',
        diagnostics: response.diagnostics,
        warnings: response.warnings,
      }
    );
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

  async snapshotTableMetadata(logicalName: string): Promise<OperationResult<DataverseMetadataSnapshot<NormalizedEntityDefinition>>> {
    const table = await this.getTable(logicalName);

    if (!table.success || !table.data) {
      return table as unknown as OperationResult<DataverseMetadataSnapshot<NormalizedEntityDefinition>>;
    }

    return ok(
      createMetadataSnapshot(this.environment.url, 'table', { logicalName }, normalizeEntityDefinition(table.data)),
      {
        supportTier: 'preview',
        diagnostics: table.diagnostics,
        warnings: table.warnings,
      }
    );
  }

  async snapshotColumnsMetadata(
    logicalName: string
  ): Promise<OperationResult<DataverseMetadataSnapshot<NormalizedAttributeDefinition[]>>> {
    const columns = await this.listColumns(logicalName, { all: true });

    if (!columns.success || !columns.data) {
      return columns as unknown as OperationResult<DataverseMetadataSnapshot<NormalizedAttributeDefinition[]>>;
    }

    return ok(
      createMetadataSnapshot(
        this.environment.url,
        'columns',
        { logicalName },
        sortRecords(
          normalizeAttributeDefinitions(columns.data, 'common') as NormalizedAttributeDefinition[],
          (record) => `${record.logicalName ?? ''}:${record.schemaName ?? ''}`
        )
      ),
      {
        supportTier: 'preview',
        diagnostics: columns.diagnostics,
        warnings: columns.warnings,
      }
    );
  }

  async snapshotOptionSetMetadata(
    name: string
  ): Promise<OperationResult<DataverseMetadataSnapshot<NormalizedOptionSetDefinition>>> {
    const optionSet = await this.getGlobalOptionSet(name);

    if (!optionSet.success || !optionSet.data) {
      return optionSet as unknown as OperationResult<DataverseMetadataSnapshot<NormalizedOptionSetDefinition>>;
    }

    return ok(
      createMetadataSnapshot(this.environment.url, 'option-set', { name }, normalizeGlobalOptionSetDefinition(optionSet.data)),
      {
        supportTier: 'preview',
        diagnostics: optionSet.diagnostics,
        warnings: optionSet.warnings,
      }
    );
  }

  async snapshotRelationshipMetadata(
    schemaName: string,
    kind: RelationshipMetadataKind = 'auto'
  ): Promise<OperationResult<DataverseMetadataSnapshot<NormalizedRelationshipDefinition>>> {
    const relationship = await this.getRelationship(schemaName, { kind });

    if (!relationship.success || !relationship.data) {
      return relationship as unknown as OperationResult<DataverseMetadataSnapshot<NormalizedRelationshipDefinition>>;
    }

    const normalized = normalizeRelationshipDefinition(relationship.data);

    return ok(
      createMetadataSnapshot(
        this.environment.url,
        'relationship',
        {
          schemaName,
          relationshipKind:
            normalized.relationshipType === 'many-to-many'
              ? 'many-to-many'
              : normalized.relationshipType === 'one-to-many'
                ? 'one-to-many'
                : undefined,
        },
        normalized
      ),
      {
        supportTier: 'preview',
        diagnostics: relationship.diagnostics,
        warnings: relationship.warnings,
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

  async updateTable(
    logicalName: string,
    spec: TableUpdateSpec,
    options: DataverseMetadataWriteOptions = {}
  ): Promise<OperationResult<DataverseMetadataWriteResult<EntityDefinition>>> {
    const current = await this.getTable(logicalName, {
      includeAnnotations: options.includeAnnotations,
    });

    if (!current.success || !current.data) {
      return current as unknown as OperationResult<DataverseMetadataWriteResult<EntityDefinition>>;
    }

    const response = await this.request<void>({
      path: buildMetadataEntityPath(logicalName),
      method: 'PUT',
      body: mergeDataverseMetadataDefinition(current.data, buildTableUpdatePayload(spec, options)),
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

  async updateColumn(
    tableLogicalName: string,
    columnLogicalName: string,
    spec: ColumnUpdateSpec,
    options: DataverseMetadataWriteOptions = {}
  ): Promise<OperationResult<DataverseMetadataWriteResult<AttributeDefinition>>> {
    const current = await this.getColumn(tableLogicalName, columnLogicalName, {
      includeAnnotations: options.includeAnnotations,
    });

    if (!current.success || !current.data) {
      return current as unknown as OperationResult<DataverseMetadataWriteResult<AttributeDefinition>>;
    }

    const response = await this.request<void>({
      path: buildMetadataAttributePath(tableLogicalName, columnLogicalName),
      method: 'PUT',
      body: mergeDataverseMetadataDefinition(current.data, buildColumnUpdatePayload(spec, options)),
      responseType: 'void',
      headers: buildMetadataWriteHeaders(options),
    });

    if (!response.success) {
      return response as unknown as OperationResult<DataverseMetadataWriteResult<AttributeDefinition>>;
    }

    const entity = await this.getColumn(tableLogicalName, columnLogicalName, {
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

  async updateRelationship(
    schemaName: string,
    kind: Exclude<RelationshipMetadataKind, 'auto'>,
    spec: OneToManyRelationshipUpdateSpec | ManyToManyRelationshipUpdateSpec,
    options: DataverseMetadataWriteOptions = {}
  ): Promise<OperationResult<DataverseMetadataWriteResult<RelationshipDefinition>>> {
    const current = await this.getRelationship(schemaName, {
      kind,
      includeAnnotations: options.includeAnnotations,
    });

    if (!current.success || !current.data) {
      return current as unknown as OperationResult<DataverseMetadataWriteResult<RelationshipDefinition>>;
    }

    const response = await this.request<void>({
      path: buildRelationshipPath(schemaName, kind),
      method: 'PUT',
      body:
        kind === 'one-to-many'
          ? mergeDataverseMetadataDefinition(current.data, buildOneToManyRelationshipUpdatePayload(spec as OneToManyRelationshipUpdateSpec, {
              associatedMenuLabel: readLocalizedLabel(((current.data as Record<string, unknown>).AssociatedMenuConfiguration as Record<string, unknown> | undefined)?.Label),
              lookupDisplayName: readLocalizedLabel(((current.data as Record<string, unknown>).Lookup as Record<string, unknown> | undefined)?.DisplayName),
              associatedMenuBehavior: readAssociatedMenuBehavior((current.data as Record<string, unknown>).AssociatedMenuConfiguration),
              associatedMenuGroup: readAssociatedMenuGroup((current.data as Record<string, unknown>).AssociatedMenuConfiguration),
              associatedMenuOrder: readNumber(((current.data as Record<string, unknown>).AssociatedMenuConfiguration as Record<string, unknown> | undefined)?.Order),
            }, options))
          : mergeDataverseMetadataDefinition(current.data, buildManyToManyRelationshipUpdatePayload(spec as ManyToManyRelationshipUpdateSpec, {
              entity1LogicalName: readString((current.data as Record<string, unknown>).Entity1LogicalName),
              entity2LogicalName: readString((current.data as Record<string, unknown>).Entity2LogicalName),
              entity1Menu: readAssociatedMenuConfig((current.data as Record<string, unknown>).Entity1AssociatedMenuConfiguration),
              entity2Menu: readAssociatedMenuConfig((current.data as Record<string, unknown>).Entity2AssociatedMenuConfiguration),
            }, options)),
      responseType: 'void',
      headers: buildMetadataWriteHeaders(options),
    });

    if (!response.success) {
      return response as unknown as OperationResult<DataverseMetadataWriteResult<RelationshipDefinition>>;
    }

    const entity = await this.getRelationship(schemaName, {
      kind,
      includeAnnotations: options.includeAnnotations,
    });
    const relationship = normalizeRelationshipDefinition(current.data);
    const publishTargets =
      kind === 'many-to-many'
        ? uniqueStrings([relationship.entity1LogicalName ?? '', relationship.entity2LogicalName ?? ''])
        : uniqueStrings([relationship.referencedEntity ?? '', relationship.referencingEntity ?? '']);
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

  async applyMetadataPlan(
    plan: MetadataApplyPlan,
    options: DataverseMetadataWriteOptions = {}
  ): Promise<OperationResult<DataverseMetadataApplyResult>> {
    const orderedOperations = orderMetadataApplyOperations(plan.operations);
    const operationResults: DataverseMetadataApplyOperationResult[] = [];
    const diagnostics: Diagnostic[] = [];
    const warnings: Diagnostic[] = [];
    const entityPublishTargets: string[] = [];
    const optionSetPublishTargets: string[] = [];

    for (const operation of orderedOperations) {
      const result = await this.applyMetadataOperation(operation, {
        ...options,
        publish: false,
      });

      if (!result.success || !result.data) {
        return fail(result.diagnostics, {
          supportTier: 'preview',
          warnings: [...warnings, ...result.warnings],
        });
      }

      diagnostics.push(...result.diagnostics);
      warnings.push(...result.warnings);
      operationResults.push(result.data);
      entityPublishTargets.push(...(result.data.publishTargets ?? []));
      optionSetPublishTargets.push(...(result.data.optionSetPublishTargets ?? []));
    }

    let publishResponse: OperationResult<DataverseWriteResult> | undefined;

    if (options.publish !== false) {
      publishResponse = await this.publishMetadataTargets(
        {
          entities: uniqueStrings(entityPublishTargets),
          optionSets: uniqueStrings(optionSetPublishTargets),
        },
        options.solutionUniqueName
      );

      if (publishResponse.success) {
        warnings.push(...publishResponse.warnings);
      } else {
        warnings.push(
          createDiagnostic('warning', 'DATAVERSE_METADATA_PUBLISH_FAILED', 'Metadata was applied, but publish did not complete successfully.', {
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
        operations: operationResults,
        published: publishResponse ? publishResponse.success : undefined,
        publishTargets: publishResponse ? uniqueStrings(entityPublishTargets) : undefined,
        optionSetPublishTargets: publishResponse ? uniqueStrings(optionSetPublishTargets) : undefined,
      }),
      {
        supportTier: 'preview',
        diagnostics,
        warnings,
      }
    );
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

  async publishMetadataTargets(
    targets: { entities?: string[]; optionSets?: string[] },
    solutionUniqueName?: string
  ): Promise<OperationResult<DataverseWriteResult>> {
    const entities = uniqueStrings(targets.entities ?? []);
    const optionSets = uniqueStrings(targets.optionSets ?? []);

    if (entities.length === 0 && optionSets.length === 0) {
      return ok(
        {
          status: 204,
          headers: {},
        },
        {
          supportTier: 'preview',
        }
      );
    }

    const entityXml = entities.length > 0 ? `<entities>${entities.map((logicalName) => `<entity>${escapeXml(logicalName)}</entity>`).join('')}</entities>` : '';
    const optionSetXml =
      optionSets.length > 0 ? `<optionsets>${optionSets.map((name) => `<optionset>${escapeXml(name)}</optionset>`).join('')}</optionsets>` : '';

    return this.publishXml(`<importexportxml>${entityXml}${optionSetXml}</importexportxml>`, solutionUniqueName);
  }

  private async applyMetadataOperation(
    operation: MetadataApplyOperation,
    options: DataverseMetadataWriteOptions
  ): Promise<OperationResult<DataverseMetadataApplyOperationResult>> {
    switch (operation.kind) {
      case 'create-table': {
        const result = await this.createTable(operation.spec, {
          ...options,
          publish: false,
        });
        return mapApplyOperationResult(operation.kind, result, [resolveLogicalName(operation.spec.schemaName, operation.spec.logicalName)]);
      }
      case 'update-table': {
        const result = await this.updateTable(operation.tableLogicalName, operation.spec, {
          ...options,
          publish: false,
        });
        return mapApplyOperationResult(operation.kind, result, [operation.tableLogicalName]);
      }
      case 'add-column': {
        const result = await this.createColumn(operation.tableLogicalName, operation.spec, {
          ...options,
          publish: false,
        });
        return mapApplyOperationResult(operation.kind, result, [operation.tableLogicalName]);
      }
      case 'update-column': {
        const result = await this.updateColumn(operation.tableLogicalName, operation.columnLogicalName, operation.spec, {
          ...options,
          publish: false,
        });
        return mapApplyOperationResult(operation.kind, result, [operation.tableLogicalName]);
      }
      case 'create-option-set': {
        const result = await this.createGlobalOptionSet(operation.spec, {
          ...options,
          publish: false,
        });
        return mapApplyOperationResult(operation.kind, result, undefined, [operation.spec.name]);
      }
      case 'update-option-set': {
        const result = await this.updateGlobalOptionSet(operation.spec, {
          ...options,
          publish: false,
        });
        return mapApplyOperationResult(operation.kind, result, undefined, [operation.spec.name]);
      }
      case 'create-relationship': {
        const result = await this.createOneToManyRelationship(operation.spec, {
          ...options,
          publish: false,
        });
        return mapApplyOperationResult(operation.kind, result, [operation.spec.referencedEntity, operation.spec.referencingEntity]);
      }
      case 'update-relationship': {
        const result = await this.updateRelationship(operation.schemaName, operation.relationshipKind, operation.spec as never, {
          ...options,
          publish: false,
        });
        return mapApplyOperationResult(operation.kind, result);
      }
      case 'create-many-to-many': {
        const result = await this.createManyToManyRelationship(operation.spec, {
          ...options,
          publish: false,
        });
        return mapApplyOperationResult(operation.kind, result, [operation.spec.entity1LogicalName, operation.spec.entity2LogicalName]);
      }
      case 'create-customer-relationship': {
        const result = await this.createCustomerRelationship(operation.spec, {
          ...options,
          publish: false,
        });
        return mapApplyOperationResult(operation.kind, result, ['account', 'contact', operation.spec.tableLogicalName]);
      }
    }
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
      const fallback = await this.retryMetadataQueryWithClientSideFilter<T>(basePath, options, normalized.data, query);

      if (fallback) {
        return fallback;
      }

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

  private async retryMetadataQueryWithClientSideFilter<T>(
    basePath: string,
    options: MetadataQueryOptions,
    normalized: NormalizedMetadataQuery,
    failedQuery: OperationResult<T[]>
  ): Promise<OperationResult<T[]> | undefined> {
    if (!options.filter || !shouldRetryMetadataFilterClientSide(failedQuery)) {
      return undefined;
    }

    const predicate = buildMetadataClientFilter<T>(options.filter);

    if (!predicate) {
      return undefined;
    }

    const fallbackPath = buildODataPath(basePath, {
      select: options.select,
      expand: options.expand,
    });

    const fallback = await this.metadataQueryAll<T>(fallbackPath, options.maxPageSize, options.includeAnnotations);

    if (!fallback.success) {
      return {
        ...fallback,
        warnings: [...normalized.warnings, ...fallback.warnings],
      } as OperationResult<T[]>;
    }

    const filtered = (fallback.data ?? []).filter(predicate);
    const records = normalized.top !== undefined ? filtered.slice(0, normalized.top) : filtered;
    const warning = createDiagnostic(
      'warning',
      'DATAVERSE_METADATA_FILTER_CLIENT_SIDE',
      'Dataverse rejected the metadata filter, so pp retried without $filter and applied the filter client-side.',
      {
        source: '@pp/dataverse',
        detail: options.filter,
        hint: 'This fallback currently supports common string and comparison predicates such as startswith(LogicalName,\'pp_\').',
      }
    );

    return ok(records, {
      supportTier: 'preview',
      diagnostics: fallback.diagnostics,
      warnings: [...normalized.warnings, warning, ...fallback.warnings],
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
    const recordResult = await queryConnectionReferenceRecords(this.dataverseClient);
    const [records, solutionId] = await Promise.all([
      Promise.resolve(recordResult),
      options.solutionUniqueName ? resolveSolutionId(this.dataverseClient, options.solutionUniqueName) : Promise.resolve(ok(undefined, { supportTier: 'preview' })),
    ]);

    if (!records.success) {
      return records as unknown as OperationResult<ConnectionReferenceSummary[]>;
    }

    if (!solutionId.success) {
      return solutionId as unknown as OperationResult<ConnectionReferenceSummary[]>;
    }

    const solutionMembers = solutionId.data
      ? await listSolutionComponentObjectIds(this.dataverseClient, solutionId.data, 371)
      : ok<Set<string> | undefined>(undefined, { supportTier: 'preview' });

    if (!solutionMembers.success) {
      return solutionMembers as unknown as OperationResult<ConnectionReferenceSummary[]>;
    }

    const summaries = (records.data ?? [])
      .filter((record) => !solutionMembers.data || solutionMembers.data.has(record.connectionreferenceid))
      .map((record) => normalizeConnectionReference(record, solutionId.data && solutionMembers.data?.has(record.connectionreferenceid) ? solutionId.data : undefined));

    return ok(summaries, {
      supportTier: 'preview',
      diagnostics: mergeDiagnosticLists(records.diagnostics, solutionId.diagnostics, solutionMembers.diagnostics),
      warnings: mergeDiagnosticLists(records.warnings, solutionId.warnings, solutionMembers.warnings),
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

  async create(
    logicalName: string,
    connectionId: string,
    options: ConnectionReferenceCreateOptions = {}
  ): Promise<OperationResult<ConnectionReferenceSummary>> {
    if (!options.connectorId && !options.customConnectorId) {
      return fail(
        createDiagnostic(
          'error',
          'DATAVERSE_CONNREF_CONNECTOR_REQUIRED',
          `Connection reference ${logicalName} requires connector metadata before it can be created.`,
          {
            source: '@pp/dataverse',
          }
        )
      );
    }

    const createResult = await this.dataverseClient.create<Record<string, unknown>, ConnectionReferenceRecord>(
      'connectionreferences',
      {
        connectionreferencelogicalname: logicalName,
        connectionreferencedisplayname: options.displayName ?? logicalName,
        connectionid: connectionId,
        ...(options.connectorId ? { connectorid: options.connectorId } : {}),
        ...(options.customConnectorId ? { customconnectorid: options.customConnectorId } : {}),
      },
      {
        returnRepresentation: true,
        solutionUniqueName: options.solutionUniqueName,
      }
    );

    if (!createResult.success) {
      return createResult as unknown as OperationResult<ConnectionReferenceSummary>;
    }

    const created = createResult.data?.entity;

    return ok(
      normalizeConnectionReference({
        connectionreferenceid: created?.connectionreferenceid ?? createResult.data?.entityId ?? '',
        connectionreferencelogicalname: created?.connectionreferencelogicalname ?? logicalName,
        connectionreferencedisplayname: created?.connectionreferencedisplayname ?? options.displayName ?? logicalName,
        connectorid: created?.connectorid ?? options.connectorId,
        connectionid: created?.connectionid ?? connectionId,
        customconnectorid: created?.customconnectorid ?? options.customConnectorId,
      }),
      {
        supportTier: 'preview',
        diagnostics: createResult.diagnostics,
        warnings: createResult.warnings,
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

    const createResult = await this.dataverseClient.create<Record<string, unknown>, EnvironmentVariableDefinitionRecord>(
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
          'EnvironmentVariableDefinitionId@odata.bind': `/environmentvariabledefinitions(${variable.data.definitionId})`,
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

export class CanvasAppService {
  constructor(private readonly dataverseClient: DataverseClient) {}

  async list(): Promise<OperationResult<CanvasAppSummary[]>> {
    const records = await this.dataverseClient.queryAll<CanvasAppRecord>({
      table: 'canvasapps',
      select: [
        'canvasappid',
        'displayname',
        'name',
        'appopenuri',
        'appversion',
        'createdbyclientversion',
        'lastpublishtime',
        'status',
        'tags',
      ],
    });

    if (!records.success) {
      return records as unknown as OperationResult<CanvasAppSummary[]>;
    }

    return ok(sortRecords((records.data ?? []).map(normalizeCanvasApp), (record) => record.displayName ?? record.name ?? record.id), {
      supportTier: 'preview',
      diagnostics: records.diagnostics,
      warnings: records.warnings,
    });
  }

  async inspect(identifier: string): Promise<OperationResult<CanvasAppSummary | undefined>> {
    const apps = await this.list();

    if (!apps.success) {
      return apps as unknown as OperationResult<CanvasAppSummary | undefined>;
    }

    return ok((apps.data ?? []).find((app) => matchesCanvasApp(app, identifier)), {
      supportTier: 'preview',
      diagnostics: apps.diagnostics,
      warnings: apps.warnings,
    });
  }
}

export class CloudFlowService {
  constructor(private readonly dataverseClient: DataverseClient) {}

  async list(): Promise<OperationResult<CloudFlowInspectResult[]>> {
    const workflows = await this.dataverseClient.queryAll<CloudFlowRecord>({
      table: 'workflows',
      select: ['workflowid', 'name', 'category', 'statecode', 'statuscode', 'uniquename', 'clientdata'],
      filter: 'category eq 5',
    });

    if (!workflows.success) {
      return workflows as unknown as OperationResult<CloudFlowInspectResult[]>;
    }

    return ok(
      sortRecords((workflows.data ?? []).map(normalizeCloudFlow), (record) => record.name ?? record.uniqueName ?? record.id),
      {
        supportTier: 'preview',
        diagnostics: workflows.diagnostics,
        warnings: workflows.warnings,
      }
    );
  }

  async inspect(identifier: string): Promise<OperationResult<CloudFlowInspectResult | undefined>> {
    const workflows = await this.list();

    if (!workflows.success) {
      return workflows as unknown as OperationResult<CloudFlowInspectResult | undefined>;
    }

    return ok((workflows.data ?? []).find((workflow) => matchesCloudFlow(workflow, identifier)), {
      supportTier: 'preview',
      diagnostics: workflows.diagnostics,
      warnings: workflows.warnings,
    });
  }

  async runs(options: CloudFlowRunListOptions = {}): Promise<OperationResult<CloudFlowRunSummary[]>> {
    const runs = await this.dataverseClient.queryAll<CloudFlowRunRecord>({
      table: 'flowruns',
      select: ['flowrunid', 'name', 'workflowid', 'workflowname', 'status', 'starttime', 'endtime', 'durationinms', 'retrycount', 'errorcode', 'errormessage'],
    });

    if (!runs.success) {
      return runs as unknown as OperationResult<CloudFlowRunSummary[]>;
    }

    const filtered = (runs.data ?? [])
      .filter((run) => matchesCloudFlowRun(run, options))
      .filter((run) => !options.status || normalizeCloudFlowStatus(run.status) === normalizeCloudFlowStatus(options.status))
      .filter((run) => !options.since || isAfterRelativeTime(run.starttime, options.since))
      .map(normalizeCloudFlowRun)
      .sort(compareCloudFlowRunsDescending);

    return ok(filtered, {
      supportTier: 'experimental',
      diagnostics: runs.diagnostics,
      warnings: runs.warnings,
      knownLimitations: [
        'FlowRun data may be delayed or incomplete depending on ingestion and retention settings.',
      ],
    });
  }
}

export class ModelDrivenAppService {
  constructor(private readonly dataverseClient: DataverseClient) {}

  async list(): Promise<OperationResult<ModelDrivenAppSummary[]>> {
    const apps = await this.dataverseClient.queryAll<ModelDrivenAppRecord>({
      table: 'appmodules',
      select: ['appmoduleid', 'uniquename', 'name', 'appmoduleversion', 'statecode', 'publishedon'],
    });

    if (!apps.success) {
      return apps as unknown as OperationResult<ModelDrivenAppSummary[]>;
    }

    return ok(sortRecords((apps.data ?? []).map(normalizeModelDrivenApp), (record) => record.name ?? record.uniqueName ?? record.id), {
      supportTier: 'preview',
      diagnostics: apps.diagnostics,
      warnings: apps.warnings,
    });
  }

  async inspect(identifier: string): Promise<OperationResult<ModelDrivenAppSummary | undefined>> {
    const apps = await this.list();

    if (!apps.success) {
      return apps as unknown as OperationResult<ModelDrivenAppSummary | undefined>;
    }

    return ok((apps.data ?? []).find((app) => matchesModelDrivenApp(app, identifier)), {
      supportTier: 'preview',
      diagnostics: apps.diagnostics,
      warnings: apps.warnings,
    });
  }

  async components(appId: string): Promise<OperationResult<ModelDrivenAppComponentSummary[]>> {
    const components = await this.dataverseClient.queryAll<ModelDrivenAppComponentRecord>({
      table: 'appmodulecomponents',
      select: ['appmodulecomponentid', 'componenttype', 'objectid', 'appmoduleidunique', '_appmoduleidunique_value'],
    });

    if (!components.success) {
      return components as unknown as OperationResult<ModelDrivenAppComponentSummary[]>;
    }

    return ok(
      (components.data ?? []).filter((component) => matchesModelDrivenAppComponent(component, appId)).map(normalizeModelDrivenAppComponent),
      {
        supportTier: 'preview',
        diagnostics: components.diagnostics,
        warnings: components.warnings,
      }
    );
  }

  async forms(): Promise<OperationResult<ModelDrivenAppFormSummary[]>> {
    const forms = await this.dataverseClient.queryAll<ModelDrivenAppFormRecord>({
      table: 'systemforms',
      select: ['formid', 'name', 'objecttypecode', 'type'],
    });

    if (!forms.success) {
      return forms as unknown as OperationResult<ModelDrivenAppFormSummary[]>;
    }

    return ok((forms.data ?? []).map(normalizeModelDrivenAppForm), {
      supportTier: 'preview',
      diagnostics: forms.diagnostics,
      warnings: forms.warnings,
    });
  }

  async views(): Promise<OperationResult<ModelDrivenAppViewSummary[]>> {
    const views = await this.dataverseClient.queryAll<ModelDrivenAppViewRecord>({
      table: 'savedqueries',
      select: ['savedqueryid', 'name', 'returnedtypecode', 'querytype'],
    });

    if (!views.success) {
      return views as unknown as OperationResult<ModelDrivenAppViewSummary[]>;
    }

    return ok((views.data ?? []).map(normalizeModelDrivenAppView), {
      supportTier: 'preview',
      diagnostics: views.diagnostics,
      warnings: views.warnings,
    });
  }

  async sitemaps(): Promise<OperationResult<ModelDrivenAppSitemapSummary[]>> {
    const sitemaps = await this.dataverseClient.queryAll<ModelDrivenAppSitemapRecord>({
      table: 'sitemaps',
      select: ['sitemapid', 'sitemapname'],
    });

    if (!sitemaps.success) {
      return sitemaps as unknown as OperationResult<ModelDrivenAppSitemapSummary[]>;
    }

    return ok((sitemaps.data ?? []).map(normalizeModelDrivenAppSitemap), {
      supportTier: 'preview',
      diagnostics: sitemaps.diagnostics,
      warnings: sitemaps.warnings,
    });
  }
}

export async function resolveDataverseClient(
  environmentAlias: string,
  options: ResolveDataverseClientOptions = {}
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

  const tokenProvider = createTokenProvider(authProfileResult.data, options, options.publicClientLoginOptions);

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
      retries: DATAVERSE_HTTP_RETRIES,
      retryDelayMs: DATAVERSE_HTTP_RETRY_DELAY_MS,
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

export function buildDataverseActionPath(name: string, boundPath?: string): string {
  const normalizedName = name.trim();
  return boundPath ? `${trimDataversePath(boundPath)}/${normalizedName}` : normalizedName;
}

export function buildDataverseFunctionPath(
  name: string,
  parameters: Record<string, unknown> = {},
  boundPath?: string
): OperationResult<string> {
  const normalizedName = name.trim();
  const aliases: string[] = [];
  const queryEntries: Array<[string, string]> = [];
  let aliasIndex = 0;

  for (const [key, value] of Object.entries(parameters)) {
    const alias = `@p${aliasIndex}`;
    const serialized = serializeDataverseFunctionParameter(value);

    if (!serialized.success || serialized.data === undefined) {
      return serialized as OperationResult<string>;
    }

    aliases.push(`${key}=${alias}`);
    queryEntries.push([alias, serialized.data]);
    aliasIndex += 1;
  }

  const actionPath = buildDataverseActionPath(normalizedName, boundPath);
  const basePath = aliases.length > 0 ? `${actionPath}(${aliases.join(',')})` : `${actionPath}()`;

  if (queryEntries.length === 0) {
    return ok(basePath, {
      supportTier: 'preview',
    });
  }

  const query = new URLSearchParams();

  for (const [key, value] of queryEntries) {
    query.set(key, value);
  }

  return ok(`${basePath}?${query.toString()}`, {
    supportTier: 'preview',
  });
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

export function normalizeEntityDefinition(entity: EntityDefinition): NormalizedEntityDefinition {
  return compactObject({
    logicalName: readString(entity.LogicalName),
    schemaName: readString(entity.SchemaName),
    displayName: readLocalizedLabel(entity.DisplayName),
    pluralDisplayName: readLocalizedLabel(entity.DisplayCollectionName),
    description: readLocalizedLabel(entity.Description),
    metadataId: readString(entity.MetadataId),
    ownershipType: readString(entity.OwnershipType),
    entitySetName: readString(entity.EntitySetName),
    primaryIdAttribute: readString(entity.PrimaryIdAttribute),
    primaryNameAttribute: readString(entity.PrimaryNameAttribute),
    introducedVersion: readString(entity.IntroducedVersion),
    custom: readBoolean(entity.IsCustomEntity),
    managed: readBoolean(entity.IsManaged),
    activity: readBoolean(entity.IsActivity),
    activityTypeMask: readNumber(entity.ActivityTypeMask),
    intersect: readBoolean(entity.IsIntersect),
    auditEnabled: readManagedPrimitive<boolean>(entity.IsAuditEnabled),
    changeTrackingEnabled: readBoolean(entity.ChangeTrackingEnabled),
    connectionsEnabled: readManagedPrimitive<boolean>(entity.IsConnectionsEnabled),
    hasActivities: readBoolean(entity.HasActivities),
    notesEnabled: readManagedPrimitive<boolean>(entity.IsEnabledForNotes),
  });
}

export function normalizeRelationshipDefinition(relationship: RelationshipDefinition): NormalizedRelationshipDefinition {
  const odataType = readString(relationship['@odata.type']);
  const rawRelationshipType = readString(relationship.RelationshipType);
  const relationshipType: NormalizedRelationshipDefinition['relationshipType'] =
    odataType?.includes('ManyToManyRelationshipMetadata') || rawRelationshipType === 'ManyToManyRelationship'
      ? 'many-to-many'
      : odataType?.includes('OneToManyRelationshipMetadata') || rawRelationshipType === 'OneToManyRelationship'
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

  const lookup = relationship.Lookup as Record<string, unknown> | undefined;
  const associatedMenu = relationship.AssociatedMenuConfiguration as Record<string, unknown> | undefined;

  return compactObject({
    schemaName: readString(relationship.SchemaName),
    metadataId: readString(relationship.MetadataId),
    odataType,
    relationshipType,
    referencedEntity: readString(relationship.ReferencedEntity),
    referencedAttribute: readString(relationship.ReferencedAttribute),
    referencingEntity: readString(relationship.ReferencingEntity),
    referencingAttribute: readString(relationship.ReferencingAttribute),
    lookupLogicalName: readString(lookup?.LogicalName) ?? readString(relationship.ReferencingAttribute),
    lookupSchemaName: readString(lookup?.SchemaName),
    lookupDisplayName: readLocalizedLabel(lookup?.DisplayName),
    associatedMenuLabel: readLocalizedLabel(associatedMenu?.Label),
    associatedMenuBehavior: readString(associatedMenu?.Behavior),
    associatedMenuGroup: readString(associatedMenu?.Group),
    associatedMenuOrder: readNumber(associatedMenu?.Order),
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

export function diffDataverseMetadataSnapshots(
  left: DataverseMetadataSnapshot,
  right: DataverseMetadataSnapshot
): OperationResult<DataverseMetadataDiffResult> {
  if (left.schemaVersion !== 1 || right.schemaVersion !== 1) {
    return fail(
      createDiagnostic('error', 'DATAVERSE_METADATA_SNAPSHOT_SCHEMA_UNSUPPORTED', 'Metadata snapshot schemaVersion is unsupported.', {
        source: '@pp/dataverse',
      })
    );
  }

  if (left.kind !== right.kind) {
    return fail(
      createDiagnostic('error', 'DATAVERSE_METADATA_SNAPSHOT_KIND_MISMATCH', 'Metadata snapshots must have the same kind to diff.', {
        source: '@pp/dataverse',
        detail: `${left.kind} vs ${right.kind}`,
      })
    );
  }

  const changes: DataverseMetadataDiffEntry[] = [];
  collectMetadataDiffEntries(left.value, right.value, 'value', changes);

  const summary = {
    added: changes.filter((change) => change.kind === 'added').length,
    removed: changes.filter((change) => change.kind === 'removed').length,
    changed: changes.filter((change) => change.kind === 'changed').length,
    total: changes.length,
  };

  return ok(
    {
      compatible: true,
      left: {
        kind: left.kind,
        target: left.target,
      },
      right: {
        kind: right.kind,
        target: right.target,
      },
      summary,
      changes,
    },
    {
      supportTier: 'preview',
    }
  );
}

function createMetadataSnapshot<T>(
  environmentUrl: string,
  kind: DataverseMetadataSnapshotKind,
  target: DataverseMetadataSnapshot['target'],
  value: T
): DataverseMetadataSnapshot<T> {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environmentUrl,
    kind,
    target,
    value,
  };
}

function collectMetadataDiffEntries(left: unknown, right: unknown, basePath: string, changes: DataverseMetadataDiffEntry[]): void {
  if (deepEqual(left, right)) {
    return;
  }

  if (left === undefined) {
    changes.push({
      kind: 'added',
      path: basePath || '$',
      right,
    });
    return;
  }

  if (right === undefined) {
    changes.push({
      kind: 'removed',
      path: basePath || '$',
      left,
    });
    return;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const maxLength = Math.max(left.length, right.length);

    for (let index = 0; index < maxLength; index += 1) {
      collectMetadataDiffEntries(left[index], right[index], `${basePath}[${index}]`, changes);
    }

    return;
  }

  if (isRecord(left) && isRecord(right)) {
    const keys = uniqueStrings([...Object.keys(left), ...Object.keys(right)]).sort((a, b) => a.localeCompare(b));

    for (const key of keys) {
      collectMetadataDiffEntries(left[key], right[key], appendMetadataPath(basePath, key), changes);
    }

    return;
  }

  changes.push({
    kind: 'changed',
    path: basePath || '$',
    left,
    right,
  });
}

function appendMetadataPath(basePath: string, segment: string): string {
  return basePath ? `${basePath}.${segment}` : segment;
}

function sortRecords<T>(values: T[], selector: (value: T) => string): T[] {
  return [...values].sort((left, right) => selector(left).localeCompare(selector(right)));
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }

  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort((a, b) => a.localeCompare(b));
    const rightKeys = Object.keys(right).sort((a, b) => a.localeCompare(b));

    return deepEqual(leftKeys, rightKeys) && leftKeys.every((key) => deepEqual(left[key], right[key]));
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function shouldRetryMetadataFilterClientSide<T>(result: OperationResult<T[]>): boolean {
  return result.diagnostics.some(
    (diagnostic) => diagnostic.code === 'HTTP_REQUEST_FAILED' && /\breturned 501\b/.test(diagnostic.message)
  );
}

function buildMetadataClientFilter<T>(filter: string): MetadataRecordPredicate<T> | undefined {
  const expression = parseMetadataFilterExpression(filter);

  if (!expression) {
    return undefined;
  }

  return (record: T) => evaluateMetadataFilterExpression(expression, record as Record<string, unknown>);
}

type MetadataFilterExpression =
  | { kind: 'and' | 'or'; terms: MetadataFilterExpression[] }
  | { kind: 'not'; term: MetadataFilterExpression }
  | { kind: 'function'; name: 'startswith' | 'endswith' | 'contains'; field: string; value: string }
  | { kind: 'comparison'; field: string; operator: 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le'; value: string | number | boolean | null };

function parseMetadataFilterExpression(input: string): MetadataFilterExpression | undefined {
  const expression = trimOuterParentheses(input.trim());

  if (!expression) {
    return undefined;
  }

  const orTerms = splitTopLevel(expression, 'or');
  if (orTerms.length > 1) {
    return mapCompoundExpression('or', orTerms);
  }

  const andTerms = splitTopLevel(expression, 'and');
  if (andTerms.length > 1) {
    return mapCompoundExpression('and', andTerms);
  }

  if (/^not\s+/i.test(expression)) {
    const term = parseMetadataFilterExpression(expression.replace(/^not\s+/i, ''));
    return term ? { kind: 'not', term } : undefined;
  }

  const functionMatch = expression.match(
    /^(startswith|endswith|contains)\s*\(\s*([A-Za-z0-9_./]+)\s*,\s*(.+)\s*\)$/i
  );
  if (functionMatch) {
    const value = parseMetadataFilterLiteral(functionMatch[3] ?? '');
    if (typeof value !== 'string') {
      return undefined;
    }

    return {
      kind: 'function',
      name: (functionMatch[1] ?? '').toLowerCase() as 'startswith' | 'endswith' | 'contains',
      field: functionMatch[2] ?? '',
      value,
    };
  }

  const comparisonMatch = expression.match(/^([A-Za-z0-9_./]+)\s+(eq|ne|gt|ge|lt|le)\s+(.+)$/i);
  if (comparisonMatch) {
    const value = parseMetadataFilterLiteral(comparisonMatch[3] ?? '');
    if (value === undefined) {
      return undefined;
    }

    return {
      kind: 'comparison',
      field: comparisonMatch[1] ?? '',
      operator: (comparisonMatch[2] ?? '').toLowerCase() as 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le',
      value,
    };
  }

  return undefined;
}

function mapCompoundExpression(kind: 'and' | 'or', terms: string[]): MetadataFilterExpression | undefined {
  const parsedTerms = terms.map((term) => parseMetadataFilterExpression(term)).filter((term): term is MetadataFilterExpression => Boolean(term));

  return parsedTerms.length === terms.length ? { kind, terms: parsedTerms } : undefined;
}

function splitTopLevel(input: string, operator: 'and' | 'or'): string[] {
  const terms: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char === "'") {
      if (inString && input[index + 1] === "'") {
        index += 1;
        continue;
      }

      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      continue;
    }

    if (depth === 0 && isWordBoundary(input, index - 1) && input.slice(index, index + operator.length).toLowerCase() === operator) {
      const nextIndex = index + operator.length;
      if (isWordBoundary(input, nextIndex)) {
        terms.push(input.slice(start, index).trim());
        start = nextIndex;
        index = nextIndex - 1;
      }
    }
  }

  const tail = input.slice(start).trim();
  return tail ? [...terms, tail] : terms;
}

function isWordBoundary(input: string, index: number): boolean {
  if (index < 0 || index >= input.length) {
    return true;
  }

  return /\s|\(|\)/.test(input[index] ?? '');
}

function trimOuterParentheses(input: string): string {
  let trimmed = input.trim();

  while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    let depth = 0;
    let closesAtEnd = true;
    let inString = false;

    for (let index = 0; index < trimmed.length; index += 1) {
      const char = trimmed[index];

      if (char === "'") {
        if (inString && trimmed[index + 1] === "'") {
          index += 1;
          continue;
        }

        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;

        if (depth === 0 && index < trimmed.length - 1) {
          closesAtEnd = false;
          break;
        }
      }
    }

    if (!closesAtEnd || depth !== 0) {
      break;
    }

    trimmed = trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function parseMetadataFilterLiteral(input: string): string | number | boolean | null | undefined {
  const value = input.trim();

  if (/^null$/i.test(value)) {
    return null;
  }

  if (/^true$/i.test(value)) {
    return true;
  }

  if (/^false$/i.test(value)) {
    return false;
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }

  return undefined;
}

function evaluateMetadataFilterExpression(expression: MetadataFilterExpression, record: Record<string, unknown>): boolean {
  switch (expression.kind) {
    case 'and':
      return expression.terms.every((term) => evaluateMetadataFilterExpression(term, record));
    case 'or':
      return expression.terms.some((term) => evaluateMetadataFilterExpression(term, record));
    case 'not':
      return !evaluateMetadataFilterExpression(expression.term, record);
    case 'function': {
      const fieldValue = readMetadataFilterField(record, expression.field);

      if (typeof fieldValue !== 'string') {
        return false;
      }

      if (expression.name === 'startswith') {
        return fieldValue.startsWith(expression.value);
      }

      if (expression.name === 'endswith') {
        return fieldValue.endsWith(expression.value);
      }

      return fieldValue.includes(expression.value);
    }
    case 'comparison': {
      const fieldValue = readMetadataFilterField(record, expression.field);
      return compareMetadataFilterValues(fieldValue, expression.operator, expression.value);
    }
  }
}

function readMetadataFilterField(record: Record<string, unknown>, field: string): unknown {
  if (field in record) {
    return record[field];
  }

  const lowerField = field.toLowerCase();
  const matchedKey = Object.keys(record).find((key) => key.toLowerCase() === lowerField);
  return matchedKey ? record[matchedKey] : undefined;
}

function compareMetadataFilterValues(
  left: unknown,
  operator: 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le',
  right: string | number | boolean | null
): boolean {
  const normalizedLeft = left ?? null;

  if (operator === 'eq') {
    return normalizedLeft === right;
  }

  if (operator === 'ne') {
    return normalizedLeft !== right;
  }

  if (typeof normalizedLeft === 'number' && typeof right === 'number') {
    if (operator === 'gt') {
      return normalizedLeft > right;
    }

    if (operator === 'ge') {
      return normalizedLeft >= right;
    }

    if (operator === 'lt') {
      return normalizedLeft < right;
    }

    return normalizedLeft <= right;
  }

  if (typeof normalizedLeft === 'string' && typeof right === 'string') {
    if (operator === 'gt') {
      return normalizedLeft > right;
    }

    if (operator === 'ge') {
      return normalizedLeft >= right;
    }

    if (operator === 'lt') {
      return normalizedLeft < right;
    }

    return normalizedLeft <= right;
  }

  return false;
}

function normalizeConnectionReference(record: ConnectionReferenceRecord, inferredSolutionId?: string): ConnectionReferenceSummary {
  return {
    id: record.connectionreferenceid,
    logicalName: record.connectionreferencelogicalname,
    displayName: record.connectionreferencedisplayname ?? record.displayname,
    connectorId: record.connectorid,
    connectionId: record.connectionid,
    customConnectorId: record.customconnectorid,
    solutionId: inferredSolutionId ?? record._solutionid_value,
    stateCode: record.statecode,
    connected: Boolean(record.connectionid),
  };
}

const baseConnectionReferenceSelect = [
  'connectionreferenceid',
  'connectionreferencelogicalname',
  'connectionreferencedisplayname',
  'connectorid',
  'connectionid',
  'statecode',
] as const;

const optionalConnectionReferenceSelect = ['customconnectorid'] as const;

async function queryConnectionReferenceRecords(
  dataverseClient: DataverseClient
): Promise<OperationResult<ConnectionReferenceRecord[]>> {
  const initial = await dataverseClient.queryAll<ConnectionReferenceRecord>({
    table: 'connectionreferences',
    select: [...baseConnectionReferenceSelect, ...optionalConnectionReferenceSelect],
  });

  const unsupportedColumns = findUnsupportedConnectionReferenceColumns(initial.diagnostics);
  if (initial.success || unsupportedColumns.length === 0) {
    return initial;
  }

  const retry = await dataverseClient.queryAll<ConnectionReferenceRecord>({
    table: 'connectionreferences',
    select: [...baseConnectionReferenceSelect],
  });

  if (!retry.success) {
    return retry;
  }

  return ok(retry.data ?? [], {
    supportTier: retry.supportTier,
    diagnostics: retry.diagnostics,
    warnings: mergeDiagnosticLists(
      retry.warnings,
      [
        createDiagnostic(
          'warning',
          'DATAVERSE_CONNREF_OPTIONAL_COLUMNS_UNAVAILABLE',
          `Connection reference query retried without unsupported column${unsupportedColumns.length === 1 ? '' : 's'} ${unsupportedColumns.join(', ')}.`,
          {
            source: '@pp/dataverse',
            detail: initial.diagnostics
              .map((diagnostic) => diagnostic.detail ?? diagnostic.message)
              .filter((value) => value && value.length > 0)
              .join('\n'),
          }
        ),
      ]
    ),
  });
}

function findUnsupportedConnectionReferenceColumns(diagnostics: Diagnostic[]): string[] {
  const unsupported = new Set<string>();

  for (const diagnostic of diagnostics) {
    const message = `${diagnostic.message} ${diagnostic.detail ?? ''}`;

    for (const column of optionalConnectionReferenceSelect) {
      if (message.includes(`'${column}'`)) {
        unsupported.add(column);
      }
    }
  }

  return Array.from(unsupported);
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

function normalizeCanvasApp(record: CanvasAppRecord): CanvasAppSummary {
  return {
    id: record.canvasappid,
    displayName: record.displayname,
    name: record.name,
    openUri: record.appopenuri,
    appVersion: record.appversion,
    createdByClientVersion: record.createdbyclientversion,
    lastPublishTime: record.lastpublishtime,
    status: record.status,
    tags: parseSemicolonList(record.tags),
  };
}

function normalizeCloudFlow(record: CloudFlowRecord): CloudFlowInspectResult {
  const parsed = parseCloudFlowClientData(record.clientdata);

  return {
    id: record.workflowid,
    name: record.name,
    uniqueName: record.uniquename,
    category: record.category,
    stateCode: record.statecode,
    statusCode: record.statuscode,
    definitionAvailable: parsed.definition !== undefined,
    connectionReferences: parsed.connectionReferences,
    parameters: parsed.parameters,
    environmentVariables: parsed.environmentVariables,
    clientData: parsed.clientData,
  };
}

function normalizeCloudFlowRun(record: CloudFlowRunRecord): CloudFlowRunSummary {
  return {
    id: record.flowrunid ?? record.name ?? 'unknown-run',
    workflowId: record.workflowid,
    workflowName: record.workflowname,
    status: record.status,
    startTime: record.starttime,
    endTime: record.endtime,
    durationMs: record.durationinms,
    retryCount: record.retrycount,
    errorCode: record.errorcode,
    errorMessage: record.errormessage,
  };
}

function normalizeModelDrivenApp(record: ModelDrivenAppRecord): ModelDrivenAppSummary {
  return {
    id: record.appmoduleid,
    uniqueName: record.uniquename,
    name: record.name,
    version: record.appmoduleversion,
    stateCode: record.statecode,
    publishedOn: record.publishedon,
  };
}

function normalizeModelDrivenAppComponent(record: ModelDrivenAppComponentRecord): ModelDrivenAppComponentSummary {
  return {
    id: record.appmodulecomponentid,
    componentType: record.componenttype,
    objectId: record.objectid,
    appId: record._appmoduleidunique_value ?? record.appmoduleidunique,
  };
}

function normalizeModelDrivenAppForm(record: ModelDrivenAppFormRecord): ModelDrivenAppFormSummary {
  return {
    id: record.formid,
    name: record.name,
    table: record.objecttypecode,
    formType: record.type,
  };
}

function normalizeModelDrivenAppView(record: ModelDrivenAppViewRecord): ModelDrivenAppViewSummary {
  return {
    id: record.savedqueryid,
    name: record.name,
    table: record.returnedtypecode,
    queryType: record.querytype,
  };
}

function normalizeModelDrivenAppSitemap(record: ModelDrivenAppSitemapRecord): ModelDrivenAppSitemapSummary {
  return {
    id: record.sitemapid,
    name: record.sitemapname,
  };
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

function matchesCanvasApp(app: CanvasAppSummary, identifier: string): boolean {
  const normalized = identifier.toLowerCase();
  return app.id.toLowerCase() === normalized || app.name?.toLowerCase() === normalized || app.displayName?.toLowerCase() === normalized;
}

function matchesCloudFlow(flow: CloudFlowSummary, identifier: string): boolean {
  const normalized = identifier.toLowerCase();
  return flow.id.toLowerCase() === normalized || flow.uniqueName?.toLowerCase() === normalized || flow.name?.toLowerCase() === normalized;
}

function matchesCloudFlowRun(record: CloudFlowRunRecord, options: CloudFlowRunListOptions): boolean {
  const names = [options.workflowName, options.workflowUniqueName]
    .map((value) => value?.toLowerCase())
    .filter((value): value is string => Boolean(value));

  if (options.workflowId && record.workflowid === options.workflowId) {
    return true;
  }

  if (names.length > 0 && record.workflowname) {
    return names.includes(record.workflowname.toLowerCase());
  }

  return !options.workflowId && names.length === 0;
}

function matchesModelDrivenApp(app: ModelDrivenAppSummary, identifier: string): boolean {
  const normalized = identifier.toLowerCase();
  return app.id.toLowerCase() === normalized || app.uniqueName?.toLowerCase() === normalized || app.name?.toLowerCase() === normalized;
}

function normalizeCloudFlowStatus(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function compareCloudFlowRunsDescending(left: CloudFlowRunSummary, right: CloudFlowRunSummary): number {
  return (right.startTime ?? '').localeCompare(left.startTime ?? '');
}

function isAfterRelativeTime(value: string | undefined, relative: string): boolean {
  if (!value) {
    return false;
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return false;
  }

  const match = relative.match(/^(\d+)([dh])$/i);

  if (!match) {
    return true;
  }

  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const now = Date.now();
  const offset = unit === 'h' ? amount * 60 * 60 * 1000 : amount * 24 * 60 * 60 * 1000;

  return date.valueOf() >= now - offset;
}

function matchesModelDrivenAppComponent(component: ModelDrivenAppComponentRecord, appId: string): boolean {
  return normalizeMetadataId(component._appmoduleidunique_value ?? component.appmoduleidunique) === normalizeMetadataId(appId);
}

function normalizeMetadataId(value: string | undefined): string {
  return (value ?? '').toLowerCase();
}

function parseSemicolonList(value: string | undefined): string[] {
  return value
    ?.split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0) ?? [];
}

function parseCloudFlowClientData(clientdata: string | undefined): {
  clientData?: Record<string, unknown>;
  definition?: Record<string, unknown>;
  connectionReferences: CloudFlowConnectionReference[];
  parameters: string[];
  environmentVariables: string[];
} {
  if (!clientdata) {
    return {
      connectionReferences: [],
      parameters: [],
      environmentVariables: [],
    };
  }

  try {
    return parseCloudFlowClientDataValue(JSON.parse(clientdata) as unknown);
  } catch {
    return {
      connectionReferences: [],
      parameters: [],
      environmentVariables: [],
    };
  }
}

function parseCloudFlowClientDataValue(value: unknown): {
  clientData?: Record<string, unknown>;
  definition?: Record<string, unknown>;
  connectionReferences: CloudFlowConnectionReference[];
  parameters: string[];
  environmentVariables: string[];
} {
  const record = isRecord(value) ? value : undefined;
  const definition = (isRecord(record?.definition) ? record.definition : undefined) ?? (isRecord(record?.properties) ? readRecord(record.properties.definition) : undefined);
  const definitionParameters = readRecord(definition?.parameters);
  const definitionConnections = readRecord(readRecord(definitionParameters?.['$connections'])?.value);

  return {
    clientData: record ? normalizeUnknownRecord(record) : undefined,
    definition: definition ? normalizeUnknownRecord(definition) : undefined,
    connectionReferences: normalizeCloudFlowConnectionReferences(
      record?.connectionReferences ?? readRecord(record?.properties)?.connectionReferences ?? definitionConnections
    ),
    parameters: collectCloudFlowParameterNames(definition ?? {}),
    environmentVariables: collectCloudFlowEnvironmentVariables(definition ?? {}),
  };
}

function normalizeCloudFlowConnectionReferences(value: unknown): CloudFlowConnectionReference[] {
  const records = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.entries(value).map(([name, nested]) => ({ name, ...(readRecord(nested) ?? {}) }))
      : [];

  const normalized: CloudFlowConnectionReference[] = [];

  for (const item of records) {
    const record = readRecord(item);

    if (!record) {
      continue;
    }

    const api = readRecord(record.api);
    const name = readString(record.name);

    if (!name) {
      continue;
    }

    normalized.push({
      name,
      connectionReferenceLogicalName:
        readString(record.connectionReferenceLogicalName) ??
        readString(record.connectionreferencelogicalname) ??
        readString(record.logicalName),
      connectionId: readString(record.connectionId) ?? readString(record.id) ?? readString(record.connectionid),
      apiId: readString(record.apiId) ?? readString(api?.id) ?? readString(record.connectorId),
    });
  }

  return normalized.sort((left, right) => left.name.localeCompare(right.name));
}

function collectCloudFlowParameterNames(value: unknown): string[] {
  const seen = new Set<string>();

  visitCloudFlowStrings(value, (entry) => {
    for (const match of entry.matchAll(/parameters\('([^']+)'\)/g)) {
      const name = match[1]?.trim();

      if (name) {
        seen.add(name);
      }
    }
  });

  return [...seen].sort((left, right) => left.localeCompare(right));
}

function collectCloudFlowEnvironmentVariables(value: unknown): string[] {
  const seen = new Set<string>();

  visitCloudFlowStrings(value, (entry) => {
    for (const match of entry.matchAll(/environmentVariables\('([^']+)'\)/g)) {
      const name = match[1]?.trim();

      if (name) {
        seen.add(name);
      }
    }
  });

  return [...seen].sort((left, right) => left.localeCompare(right));
}

function visitCloudFlowStrings(value: unknown, visitor: (value: string) => void): void {
  if (typeof value === 'string') {
    visitor(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      visitCloudFlowStrings(entry, visitor);
    }
    return;
  }

  if (isRecord(value)) {
    for (const entry of Object.values(value)) {
      visitCloudFlowStrings(entry, visitor);
    }
  }
}

function normalizeUnknownRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, normalizeUnknownValue(entry)] as const)
      .filter(([, entry]) => entry !== undefined)
  );
}

function normalizeUnknownValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeUnknownValue(entry));
  }

  if (isRecord(value)) {
    return normalizeUnknownRecord(value);
  }

  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
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

function mapApplyOperationResult(
  kind: MetadataApplyOperation['kind'],
  result: OperationResult<DataverseMetadataWriteResult<unknown>>,
  publishTargets?: string[],
  optionSetPublishTargets?: string[]
): OperationResult<DataverseMetadataApplyOperationResult> {
  if (!result.success || !result.data) {
    return result as unknown as OperationResult<DataverseMetadataApplyOperationResult>;
  }

  return ok(
    compactObject({
      kind,
      status: result.data.status,
      entity: result.data.entity,
      entityId: result.data.entityId,
      location: result.data.location,
      publishTargets: publishTargets ? uniqueStrings(publishTargets) : undefined,
      optionSetPublishTargets: optionSetPublishTargets ? uniqueStrings(optionSetPublishTargets) : undefined,
    }),
    {
      supportTier: 'preview',
      diagnostics: result.diagnostics,
      warnings: result.warnings,
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
    ? sortRecords(optionSet.Options.flatMap((option) => {
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
      }), (entry) => `${String(entry.value ?? '')}:${String(entry.label ?? '')}`)
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

function orderMetadataApplyOperations(operations: MetadataApplyOperation[]): MetadataApplyOperation[] {
  const precedence: Record<MetadataApplyOperation['kind'], number> = {
    'create-option-set': 10,
    'update-option-set': 20,
    'create-table': 30,
    'update-table': 40,
    'add-column': 50,
    'update-column': 60,
    'create-relationship': 70,
    'update-relationship': 80,
    'create-many-to-many': 90,
    'create-customer-relationship': 100,
  };

  return operations
    .map((operation, index) => ({ operation, index }))
    .sort((left, right) => {
      const precedenceDelta = precedence[left.operation.kind] - precedence[right.operation.kind];
      return precedenceDelta !== 0 ? precedenceDelta : left.index - right.index;
    })
    .map((entry) => entry.operation);
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
  buildColumnUpdatePayload,
  buildCustomerRelationshipCreatePayload,
  buildGlobalOptionSetCreatePayload,
  buildManyToManyRelationshipUpdatePayload,
  buildManyToManyRelationshipCreatePayload,
  buildOneToManyRelationshipCreatePayload,
  buildOneToManyRelationshipUpdatePayload,
  buildTableCreatePayload,
  buildTableUpdatePayload,
  metadataApplyOperationSchema,
  metadataApplyPlanSchema,
  parseColumnUpdateSpec,
  parseMetadataApplyPlan,
  parseManyToManyRelationshipUpdateSpec,
  parseCustomerRelationshipCreateSpec,
  parseColumnCreateSpec,
  parseGlobalOptionSetCreateSpec,
  parseGlobalOptionSetUpdateSpec,
  parseOneToManyRelationshipUpdateSpec,
  parseManyToManyRelationshipCreateSpec,
  parseOneToManyRelationshipCreateSpec,
  parseTableUpdateSpec,
  parseTableCreateSpec,
  resolveLogicalName,
  type ColumnCreateSpec,
  type ColumnUpdateSpec,
  type CustomerRelationshipCreateSpec,
  type GlobalOptionSetCreateSpec,
  type GlobalOptionSetUpdateSpec,
  type ManyToManyRelationshipCreateSpec,
  type ManyToManyRelationshipUpdateSpec,
  type MetadataApplyOperation,
  type MetadataApplyPlan,
  type MetadataBuildOptions,
  type OneToManyRelationshipCreateSpec,
  type OneToManyRelationshipUpdateSpec,
  type TableCreateSpec,
  type TableUpdateSpec,
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

function readAssociatedMenuBehavior(
  value: unknown
): 'useCollectionName' | 'useLabel' | 'doNotDisplay' | undefined {
  const behavior = readString(value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).Behavior : undefined);

  switch (behavior) {
    case 'UseLabel':
      return 'useLabel';
    case 'DoNotDisplay':
      return 'doNotDisplay';
    case 'UseCollectionName':
      return 'useCollectionName';
    default:
      return undefined;
  }
}

function readAssociatedMenuGroup(value: unknown): 'details' | 'sales' | 'service' | 'marketing' | undefined {
  const group = readString(value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).Group : undefined);

  switch (group) {
    case 'Sales':
      return 'sales';
    case 'Service':
      return 'service';
    case 'Marketing':
      return 'marketing';
    case 'Details':
      return 'details';
    default:
      return undefined;
  }
}

function readAssociatedMenuConfig(value: unknown): {
  label?: string;
  behavior?: 'useCollectionName' | 'useLabel' | 'doNotDisplay';
  group?: 'details' | 'sales' | 'service' | 'marketing';
  order?: number;
} | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  return compactObject({
    label: readLocalizedLabel(record.Label),
    behavior: readAssociatedMenuBehavior(record),
    group: readAssociatedMenuGroup(record),
    order: readNumber(record.Order),
  });
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

function mergeDataverseMetadataDefinition(current: unknown, overlay: Record<string, unknown>): Record<string, unknown> {
  return mergeMetadataRecords(sanitizeDataverseMetadataDefinition(current), overlay);
}

function sanitizeDataverseMetadataDefinition(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;

  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => key === '@odata.type' || !key.startsWith('@odata.'))
      .map(([key, entry]) => [key, sanitizeMetadataValue(entry)])
  );
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeMetadataValue(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return sanitizeDataverseMetadataDefinition(value);
}

function mergeMetadataRecords(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) {
      continue;
    }

    const existing = merged[key];

    if (isPlainObject(existing) && isPlainObject(value)) {
      merged[key] = mergeMetadataRecords(existing, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function serializeDataverseFunctionParameter(value: unknown): OperationResult<string> {
  if (value === null) {
    return ok('null', {
      supportTier: 'preview',
    });
  }

  if (typeof value === 'string') {
    return ok(`'${escapeODataLiteral(value)}'`, {
      supportTier: 'preview',
    });
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return ok(String(value), {
      supportTier: 'preview',
    });
  }

  return fail(
    createDiagnostic(
      'error',
      'DATAVERSE_FUNCTION_PARAMETER_UNSUPPORTED',
      'Dataverse function parameters currently support string, number, boolean, and null values.',
      {
        source: '@pp/dataverse',
        detail: value === undefined ? 'undefined' : typeof value,
      }
    )
  );
}

function buildDataverseBatchHeaders(boundary: string, options: DataverseBatchOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': `multipart/mixed;boundary=${boundary}`,
  };

  const prefers = mergePrefer(
    options.continueOnError ? ['odata.continue-on-error'] : undefined,
    buildAnnotationPrefer(options.includeAnnotations)
  );

  if (prefers && prefers.length > 0) {
    headers.prefer = prefers.join(',');
  }

  if (options.solutionUniqueName) {
    headers['MSCRM.SolutionUniqueName'] = options.solutionUniqueName;
  }

  return headers;
}

function normalizeRowApplyOperation(
  operation: DataverseRowApplyOperation,
  defaultTable?: string
): OperationResult<DataverseRowApplyOperation & { table?: string; recordId?: string; path: string }> {
  const table = operation.table ?? defaultTable;

  switch (operation.kind) {
    case 'create': {
      if (!table) {
        return fail(
          createDiagnostic('error', 'DATAVERSE_ROW_APPLY_TABLE_REQUIRED', 'Create row operations require a table or a plan-level default table.', {
            source: '@pp/dataverse',
          })
        );
      }

      if (!operation.body || !isPlainObject(operation.body)) {
        return fail(
          createDiagnostic('error', 'DATAVERSE_ROW_APPLY_BODY_REQUIRED', 'Create row operations require an object body.', {
            source: '@pp/dataverse',
          })
        );
      }

      return ok(
        {
          ...operation,
          table,
          path: buildCollectionPath(table, operation),
        },
        {
          supportTier: 'preview',
        }
      );
    }
    case 'update':
    case 'upsert': {
      const path = operation.path ?? (table && operation.recordId ? buildEntityPath(table, operation.recordId, operation) : undefined);

      if (!path) {
        return fail(
          createDiagnostic(
            'error',
            'DATAVERSE_ROW_APPLY_TARGET_REQUIRED',
            `${operation.kind} row operations require either path or table plus recordId.`,
            {
              source: '@pp/dataverse',
            }
          )
        );
      }

      if (!operation.body || !isPlainObject(operation.body)) {
        return fail(
          createDiagnostic('error', 'DATAVERSE_ROW_APPLY_BODY_REQUIRED', `${operation.kind} row operations require an object body.`, {
            source: '@pp/dataverse',
          })
        );
      }

      return ok(
        {
          ...operation,
          table,
          path,
        },
        {
          supportTier: 'preview',
        }
      );
    }
    case 'delete': {
      const path = operation.path ?? (table && operation.recordId ? buildEntityPath(table, operation.recordId) : undefined);

      if (!path) {
        return fail(
          createDiagnostic('error', 'DATAVERSE_ROW_APPLY_TARGET_REQUIRED', 'Delete row operations require either path or table plus recordId.', {
            source: '@pp/dataverse',
          })
        );
      }

      return ok(
        {
          ...operation,
          table,
          path,
        },
        {
          supportTier: 'preview',
        }
      );
    }
    default:
      return fail(
        createDiagnostic('error', 'DATAVERSE_ROW_APPLY_KIND_INVALID', `Unsupported row apply operation ${(operation as { kind?: string }).kind}.`, {
          source: '@pp/dataverse',
        })
      );
  }
}

function mapRowApplyMethod(kind: DataverseRowApplyOperation['kind']): DataverseBatchRequest['method'] {
  switch (kind) {
    case 'create':
      return 'POST';
    case 'update':
    case 'upsert':
      return 'PATCH';
    case 'delete':
      return 'DELETE';
  }
}

function buildRowApplyHeaders(operation: DataverseRowApplyOperation): Record<string, string> {
  const headers = buildDataverseHeaders({
    path: operation.path ?? '',
    method: mapRowApplyMethod(operation.kind),
    headers: operation.headers,
    ifMatch: operation.ifMatch,
    ifNoneMatch: operation.ifNoneMatch,
    prefer: mergePrefer(operation.prefer, shouldReturnRepresentation(operation) ? ['return=representation'] : undefined),
  });

  delete headers['MSCRM.SolutionUniqueName'];
  return headers;
}

function buildDataverseBatchPayload(requests: DataverseBatchRequest[]): { boundary: string; body: string } {
  const boundary = `batch_${randomBoundaryId()}`;
  const lines: string[] = [];
  const groupedAtomicRequests = new Map<string, DataverseBatchRequest[]>();
  const emittedAtomicGroups = new Set<string>();

  const appendRequest = (request: DataverseBatchRequest, contentId?: string): void => {
    lines.push('--' + boundary);
    lines.push('Content-Type: application/http');
    lines.push('Content-Transfer-Encoding: binary');
    if (contentId) {
      lines.push(`Content-ID: ${contentId}`);
    }
    lines.push('');
    appendHttpRequest(lines, request);
    lines.push('');
  };

  for (const request of requests) {
    if (request.atomicGroup) {
      const group = groupedAtomicRequests.get(request.atomicGroup) ?? [];
      group.push(request);
      groupedAtomicRequests.set(request.atomicGroup, group);
      continue;
    }

    appendRequest(request, request.id);
  }

  for (const request of requests) {
    if (!request.atomicGroup || emittedAtomicGroups.has(request.atomicGroup)) {
      continue;
    }

    emittedAtomicGroups.add(request.atomicGroup);
    const changeSetBoundary = `changeset_${randomBoundaryId()}`;
    lines.push('--' + boundary);
    lines.push(`Content-Type: multipart/mixed;boundary=${changeSetBoundary}`);
    lines.push('');

    for (const atomicRequest of groupedAtomicRequests.get(request.atomicGroup) ?? []) {
      lines.push('--' + changeSetBoundary);
      lines.push('Content-Type: application/http');
      lines.push('Content-Transfer-Encoding: binary');
      if (atomicRequest.id) {
        lines.push(`Content-ID: ${atomicRequest.id}`);
      }
      lines.push('');
      appendHttpRequest(lines, atomicRequest);
      lines.push('');
    }

    lines.push('--' + changeSetBoundary + '--');
    lines.push('');
  }

  lines.push('--' + boundary + '--');

  return {
    boundary,
    body: lines.join('\r\n'),
  };
}

function appendHttpRequest(lines: string[], request: DataverseBatchRequest): void {
  lines.push(`${request.method} ${normalizeBatchRequestPath(request.path)} HTTP/1.1`);

  const headers = compactObject({
    accept: 'application/json',
    ...(request.body !== undefined ? { 'content-type': 'application/json; charset=utf-8' } : {}),
    ...(request.headers ?? {}),
  });

  for (const [key, value] of Object.entries(headers)) {
    lines.push(`${key}: ${value}`);
  }

  lines.push('');

  if (request.body !== undefined) {
    lines.push(JSON.stringify(request.body));
  }
}

function normalizeBatchRequestPath(path: string): string {
  const trimmed = trimDataversePath(path);
  if (trimmed.startsWith('$')) {
    return trimmed;
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function parseDataverseBatchResponse<T>(
  payload: string,
  contentType: string | undefined
): OperationResult<DataverseBatchResponse<T>[]> {
  const boundary = readMultipartBoundary(contentType);

  if (!boundary) {
    return fail(
      createDiagnostic('error', 'DATAVERSE_BATCH_BOUNDARY_MISSING', 'Dataverse batch response did not declare a multipart boundary.', {
        source: '@pp/dataverse',
      })
    );
  }

  try {
    return ok(parseMultipartResponses<T>(payload, boundary), {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'DATAVERSE_BATCH_PARSE_FAILED', 'Dataverse batch response could not be parsed.', {
        source: '@pp/dataverse',
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

function parseMultipartResponses<T>(payload: string, boundary: string): DataverseBatchResponse<T>[] {
  const responses: DataverseBatchResponse<T>[] = [];

  for (const part of splitMultipartBody(payload, boundary)) {
    const parsed = parseMultipartPartHeaders(part);

    if ((parsed.headers['content-type'] ?? '').toLowerCase().startsWith('multipart/mixed')) {
      const nestedBoundary = readMultipartBoundary(parsed.headers['content-type']);

      if (!nestedBoundary) {
        continue;
      }

      responses.push(...parseMultipartResponses<T>(parsed.body, nestedBoundary));
      continue;
    }

    responses.push(parseHttpBatchResponse<T>(parsed.body, parsed.headers['content-id']));
  }

  return responses;
}

function parseMultipartPartHeaders(part: string): { headers: Record<string, string>; body: string } {
  const separator = '\r\n\r\n';
  const headerEnd = part.indexOf(separator);

  if (headerEnd === -1) {
    return { headers: {}, body: part.trim() };
  }

  return {
    headers: parseHeaderLines(part.slice(0, headerEnd)),
    body: part.slice(headerEnd + separator.length),
  };
}

function parseHttpBatchResponse<T>(part: string, contentId?: string): DataverseBatchResponse<T> {
  const normalizedPart = part.trim();
  const separator = '\r\n\r\n';
  const headerEnd = normalizedPart.indexOf(separator);
  const head = headerEnd === -1 ? normalizedPart : normalizedPart.slice(0, headerEnd);
  const bodyText = headerEnd === -1 ? '' : normalizedPart.slice(headerEnd + separator.length).trim();
  const lines = head.split('\r\n');
  const statusLine = lines.shift() ?? '';
  const statusMatch = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})/i);

  if (!statusMatch) {
    throw new Error(`Unsupported batch status line: ${statusLine}`);
  }

  const headers = parseHeaderLines(lines.join('\r\n'));
  const contentType = headers['content-type']?.toLowerCase();
  const body = !bodyText
    ? undefined
    : contentType?.includes('application/json')
      ? (JSON.parse(bodyText) as T)
      : (bodyText as T);

  return {
    id: contentId,
    status: Number(statusMatch[1]),
    headers,
    body,
    contentId,
  };
}

function splitMultipartBody(payload: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  return payload
    .split(marker)
    .map((part) => part.trim())
    .filter((part) => part && part !== '--');
}

function parseHeaderLines(input: string): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const line of input.split('\r\n')) {
    const separatorIndex = line.indexOf(':');

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();

    if (key) {
      headers[key] = value;
    }
  }

  return headers;
}

function readMultipartBoundary(contentType: string | undefined): string | undefined {
  const match = contentType?.match(/boundary=([^;]+)/i);
  return match?.[1]?.replace(/^"|"$/g, '');
}

function trimDataversePath(path: string): string {
  return path.replace(/^\/+/, '').trim();
}

function randomBoundaryId(): string {
  return Math.random().toString(16).slice(2, 10);
}
