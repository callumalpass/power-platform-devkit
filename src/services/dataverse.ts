import { createDiagnostic, fail, ok, type OperationResult } from '../diagnostics.js';
import { executeApiRequest } from './api.js';
import type { ConfigStoreOptions } from '../config.js';

export interface DataverseEntitySummary {
  logicalName: string;
  schemaName?: string;
  entitySetName?: string;
  displayName?: string;
  displayCollectionName?: string;
  primaryIdAttribute?: string;
  primaryNameAttribute?: string;
  ownershipType?: string;
  isActivity?: boolean;
  objectTypeCode?: number;
}

export interface DataverseAttributeSummary {
  logicalName: string;
  schemaName?: string;
  displayName?: string;
  description?: string;
  attributeType?: string;
  attributeTypeName?: string;
  requiredLevel?: string;
  maxLength?: number;
  maxValue?: number;
  minValue?: number;
  targets?: string[];
  isPrimaryId?: boolean;
  isPrimaryName?: boolean;
  isValidForRead?: boolean;
  isValidForCreate?: boolean;
  isValidForUpdate?: boolean;
  isValidForAdvancedFind?: boolean;
  isValidForSort?: boolean;
  optionValues?: Array<{ value: number; label?: string }>;
}

export interface DataverseEntityDetail extends DataverseEntitySummary {
  description?: string;
  metadataId?: string;
  ownershipTypeMask?: string;
  isAuditEnabled?: boolean;
  isCustomEntity?: boolean;
  isIntersect?: boolean;
  changeTrackingEnabled?: boolean;
  attributes: DataverseAttributeSummary[];
}

export interface DataverseRecordPage {
  entitySetName: string;
  logicalName: string;
  path: string;
  records: Array<Record<string, unknown>>;
  count?: number;
  nextLink?: string;
}

export interface DataverseQuerySpec {
  environmentAlias: string;
  accountName?: string;
  entitySetName: string;
  select?: string[];
  filter?: string;
  orderBy?: string[];
  expand?: string[];
  top?: number;
  includeCount?: boolean;
  search?: string;
  rawPath?: string;
}

export interface FetchXmlConditionSpec {
  attribute: string;
  operator: string;
  value?: string;
}

export interface FetchXmlOrderSpec {
  attribute: string;
  descending?: boolean;
}

export interface FetchXmlLinkEntitySpec {
  name: string;
  from: string;
  to: string;
  alias?: string;
}

export interface FetchXmlSpec {
  environmentAlias: string;
  accountName?: string;
  entity: string;
  entitySetName?: string;
  attributes?: string[];
  top?: number;
  distinct?: boolean;
  conditions?: FetchXmlConditionSpec[];
  orders?: FetchXmlOrderSpec[];
  linkEntities?: FetchXmlLinkEntitySpec[];
  rawXml?: string;
}

export async function listDataverseEntities(
  input: { environmentAlias: string; accountName?: string; search?: string; top?: number },
  configOptions: ConfigStoreOptions = {},
) {
  const top = clamp(input.top ?? 100, 1, 500);
  const result = await executeApiRequest({
    environmentAlias: input.environmentAlias,
    accountName: input.accountName,
    api: 'dv',
    path: '/EntityDefinitions',
    method: 'GET',
    responseType: 'json',
    readIntent: true,
    query: {
      '$select': [
        'LogicalName',
        'SchemaName',
        'EntitySetName',
        'DisplayName',
        'DisplayCollectionName',
        'PrimaryIdAttribute',
        'PrimaryNameAttribute',
        'OwnershipType',
        'IsActivity',
        'ObjectTypeCode',
      ].join(','),
      '$orderby': 'LogicalName asc',
      '$top': String(top),
    },
  }, configOptions);
  if (!result.success || !result.data) return fail(...result.diagnostics);
  const entities = readArray(result.data.response).map((value) => mapEntitySummary(readObject(value) ?? {}));
  const search = normalizeSearch(input.search);
  return ok(
    entities.filter((entity) => {
      if (!search) return true;
      return [entity.logicalName, entity.schemaName, entity.displayName, entity.entitySetName]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(search));
    }),
    result.diagnostics,
  );
}

export async function getDataverseEntityDetail(
  input: { environmentAlias: string; logicalName: string; accountName?: string },
  configOptions: ConfigStoreOptions = {},
): Promise<OperationResult<DataverseEntityDetail>> {
  const result = await executeApiRequest({
    environmentAlias: input.environmentAlias,
    accountName: input.accountName,
    api: 'dv',
    path: `/EntityDefinitions(LogicalName='${encodeODataLiteral(input.logicalName)}')`,
    method: 'GET',
    responseType: 'json',
    readIntent: true,
    query: {
      '$select': [
        'LogicalName',
        'SchemaName',
        'EntitySetName',
        'DisplayName',
        'DisplayCollectionName',
        'Description',
        'PrimaryIdAttribute',
        'PrimaryNameAttribute',
        'OwnershipType',
        'OwnershipTypeMask',
        'MetadataId',
        'ObjectTypeCode',
        'IsActivity',
        'IsAuditEnabled',
        'IsCustomEntity',
        'IsIntersect',
        'ChangeTrackingEnabled',
      ].join(','),
      '$expand': "Attributes($select=LogicalName,SchemaName,DisplayName,Description,AttributeType,AttributeTypeName,RequiredLevel,MaxLength,MinValue,MaxValue,Targets,IsPrimaryId,IsPrimaryName,IsValidForRead,IsValidForCreate,IsValidForUpdate,IsValidForAdvancedFind,IsValidForSortEnabled;)",
    },
  }, configOptions);
  if (!result.success || !result.data) return fail(...result.diagnostics);
  const raw = readObject(result.data.response);
  if (!raw) {
    return fail(createDiagnostic('error', 'DV_ENTITY_NOT_FOUND', `No Dataverse entity metadata was returned for ${input.logicalName}.`, { source: 'pp/services/dataverse' }));
  }
  const detail: DataverseEntityDetail = {
    ...mapEntitySummary(raw),
    description: labelText(raw.Description),
    metadataId: readString(raw.MetadataId),
    ownershipTypeMask: readString(raw.OwnershipTypeMask),
    isAuditEnabled: readBooleanFlag(raw.IsAuditEnabled),
    isCustomEntity: readBoolean(raw.IsCustomEntity),
    isIntersect: readBoolean(raw.IsIntersect),
    changeTrackingEnabled: readBoolean(raw.ChangeTrackingEnabled),
    attributes: readArray(raw.Attributes).map(mapAttributeSummary).sort((a, b) => a.logicalName.localeCompare(b.logicalName)),
  };
  return ok(detail, result.diagnostics);
}

export async function listDataverseRecords(
  input: DataverseQuerySpec,
  configOptions: ConfigStoreOptions = {},
): Promise<OperationResult<DataverseRecordPage>> {
  const path = buildDataverseODataPath(input);
  const result = await executeApiRequest({
    environmentAlias: input.environmentAlias,
    accountName: input.accountName,
    api: 'dv',
    path,
    method: 'GET',
    responseType: 'json',
    readIntent: true,
  }, configOptions);
  if (!result.success || !result.data) return fail(...result.diagnostics);
  const payload = readObject(result.data.response) ?? {};
  const records = readArray(payload.value).filter(isRecord);
  return ok({
    entitySetName: input.entitySetName,
    logicalName: input.entitySetName,
    path,
    records,
    count: typeof payload['@odata.count'] === 'number' ? payload['@odata.count'] : undefined,
    nextLink: readString(payload['@odata.nextLink']),
  }, result.diagnostics);
}

export function buildDataverseODataPath(spec: DataverseQuerySpec): string {
  if (spec.rawPath && spec.rawPath.trim()) {
    return normalizeDvPath(spec.rawPath.trim());
  }
  const path = normalizeDvPath(spec.entitySetName);
  const query = new URLSearchParams();
  if (spec.select?.length) query.set('$select', spec.select.join(','));
  if (spec.filter?.trim()) query.set('$filter', spec.filter.trim());
  if (spec.orderBy?.length) query.set('$orderby', spec.orderBy.join(','));
  if (spec.expand?.length) query.set('$expand', spec.expand.join(','));
  if (typeof spec.top === 'number' && Number.isFinite(spec.top) && spec.top > 0) query.set('$top', String(Math.floor(spec.top)));
  if (spec.includeCount) query.set('$count', 'true');
  if (spec.search?.trim()) query.set('$search', spec.search.trim());
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export function buildFetchXml(spec: FetchXmlSpec): string {
  if (spec.rawXml?.trim()) return spec.rawXml.trim();
  const parts: string[] = [];
  const fetchAttrs = [
    'version="1.0"',
    'mapping="logical"',
    spec.distinct ? 'distinct="true"' : undefined,
    spec.top ? `top="${Math.floor(spec.top)}"` : undefined,
  ].filter(Boolean);
  parts.push(`<fetch ${fetchAttrs.join(' ')}>`);
  parts.push(`  <entity name="${escapeXml(spec.entity)}">`);
  for (const attribute of spec.attributes ?? []) {
    if (attribute.trim()) parts.push(`    <attribute name="${escapeXml(attribute.trim())}" />`);
  }
  for (const order of spec.orders ?? []) {
    if (order.attribute.trim()) {
      parts.push(`    <order attribute="${escapeXml(order.attribute.trim())}"${order.descending ? ' descending="true"' : ''} />`);
    }
  }
  if ((spec.conditions?.length ?? 0) > 0) {
    parts.push('    <filter type="and">');
    for (const condition of spec.conditions ?? []) {
      if (!condition.attribute.trim() || !condition.operator.trim()) continue;
      const value = condition.value?.trim();
      parts.push(
        value
          ? `      <condition attribute="${escapeXml(condition.attribute.trim())}" operator="${escapeXml(condition.operator.trim())}" value="${escapeXml(value)}" />`
          : `      <condition attribute="${escapeXml(condition.attribute.trim())}" operator="${escapeXml(condition.operator.trim())}" />`,
      );
    }
    parts.push('    </filter>');
  }
  for (const link of spec.linkEntities ?? []) {
    if (!link.name.trim() || !link.from.trim() || !link.to.trim()) continue;
    parts.push(
      `    <link-entity name="${escapeXml(link.name.trim())}" from="${escapeXml(link.from.trim())}" to="${escapeXml(link.to.trim())}"${link.alias?.trim() ? ` alias="${escapeXml(link.alias.trim())}"` : ''} />`,
    );
  }
  parts.push('  </entity>');
  parts.push('</fetch>');
  return parts.join('\n');
}

export async function executeFetchXml(
  spec: FetchXmlSpec,
  configOptions: ConfigStoreOptions = {},
): Promise<OperationResult<DataverseRecordPage & { fetchXml: string }>> {
  const fetchXml = buildFetchXml(spec);
  const entitySetName = spec.entitySetName?.trim();
  if (!entitySetName) {
    return fail(createDiagnostic('error', 'DV_FETCHXML_ENTITY_SET_REQUIRED', 'entitySetName is required to execute FetchXML.', { source: 'pp/services/dataverse' }));
  }
  const path = `${normalizeDvPath(entitySetName)}?fetchXml=${encodeURIComponent(fetchXml)}`;
  const result = await executeApiRequest({
    environmentAlias: spec.environmentAlias,
    accountName: spec.accountName,
    api: 'dv',
    path,
    method: 'GET',
    responseType: 'json',
    readIntent: true,
  }, configOptions);
  if (!result.success || !result.data) return fail(...result.diagnostics);
  const payload = readObject(result.data.response) ?? {};
  return ok({
    entitySetName,
    logicalName: spec.entity,
    path,
    fetchXml,
    records: readArray(payload.value).filter(isRecord),
    count: typeof payload['@odata.count'] === 'number' ? payload['@odata.count'] : undefined,
    nextLink: readString(payload['@odata.nextLink']),
  }, result.diagnostics);
}

function mapEntitySummary(value: Record<string, unknown>): DataverseEntitySummary {
  return {
    logicalName: readString(value.LogicalName) ?? 'unknown',
    schemaName: readString(value.SchemaName),
    entitySetName: readString(value.EntitySetName),
    displayName: labelText(value.DisplayName),
    displayCollectionName: labelText(value.DisplayCollectionName),
    primaryIdAttribute: readString(value.PrimaryIdAttribute),
    primaryNameAttribute: readString(value.PrimaryNameAttribute),
    ownershipType: readString(value.OwnershipType),
    isActivity: readBoolean(value.IsActivity),
    objectTypeCode: typeof value.ObjectTypeCode === 'number' ? value.ObjectTypeCode : undefined,
  };
}

function mapAttributeSummary(value: unknown): DataverseAttributeSummary {
  const record = readObject(value) ?? {};
  const optionValues = readArray(record.OptionSet?.Options).map((option) => {
    const item = readObject(option);
    if (!item || typeof item.Value !== 'number') return undefined;
    return { value: item.Value, label: labelText(item.Label) };
  }).filter((item): item is { value: number; label: string | undefined } => item !== undefined);
  return {
    logicalName: readString(record.LogicalName) ?? 'unknown',
    schemaName: readString(record.SchemaName),
    displayName: labelText(record.DisplayName),
    description: labelText(record.Description),
    attributeType: readString(record.AttributeType),
    attributeTypeName: readString(readObject(record.AttributeTypeName)?.Value) ?? readString(record.AttributeTypeName),
    requiredLevel: readString(readObject(record.RequiredLevel)?.Value) ?? readString(record.RequiredLevel),
    maxLength: typeof record.MaxLength === 'number' ? record.MaxLength : undefined,
    maxValue: typeof record.MaxValue === 'number' ? record.MaxValue : undefined,
    minValue: typeof record.MinValue === 'number' ? record.MinValue : undefined,
    targets: readArray(record.Targets).filter((item): item is string => typeof item === 'string'),
    isPrimaryId: readBoolean(record.IsPrimaryId),
    isPrimaryName: readBoolean(record.IsPrimaryName),
    isValidForRead: readBooleanFlag(record.IsValidForRead),
    isValidForCreate: readBooleanFlag(record.IsValidForCreate),
    isValidForUpdate: readBooleanFlag(record.IsValidForUpdate),
    isValidForAdvancedFind: readBooleanFlag(record.IsValidForAdvancedFind),
    isValidForSort: readBooleanFlag(record.IsValidForSortEnabled),
    optionValues: optionValues.length ? optionValues : undefined,
  };
}

function labelText(value: unknown): string | undefined {
  const record = readObject(value);
  const userLocalized = readObject(record?.UserLocalizedLabel);
  return readString(userLocalized?.Label) ?? readString(record?.LocalizedLabels?.[0]?.Label);
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readBooleanFlag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && 'Value' in value) {
    return typeof (value as { Value?: unknown }).Value === 'boolean' ? (value as { Value: boolean }).Value : undefined;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = readObject(value);
  return Array.isArray(record?.value) ? record.value : [];
}

function readObject(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(readObject(value));
}

function normalizeSearch(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || undefined;
}

function encodeODataLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function normalizeDvPath(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  }
  const trimmed = value.startsWith('/') ? value : `/${value}`;
  return trimmed.startsWith('/api/data/') ? trimmed : `/api/data/v9.2${trimmed}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
