import type { PublicClientLoginOptions } from '../auth.js';
import { createDiagnostic, fail, ok, type OperationResult } from '../diagnostics.js';
import { executeApiRequest } from './api.js';
import type { ConfigStoreOptions } from '../config.js';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTRIBUTE_METADATA_SELECT = [
  'LogicalName',
  'AttributeOf',
  'SchemaName',
  'DisplayName',
  'Description',
  'AttributeType',
  'AttributeTypeName',
  'RequiredLevel',
  'IsPrimaryId',
  'IsPrimaryName',
  'IsValidForRead',
  'IsValidForCreate',
  'IsValidForUpdate',
  'IsValidForAdvancedFind'
].join(',');

const DERIVED_ATTRIBUTE_METADATA_SPECS = [
  { metadataType: 'StringAttributeMetadata', select: 'LogicalName,MaxLength', fields: ['maxLength'] as const },
  { metadataType: 'MemoAttributeMetadata', select: 'LogicalName,MaxLength', fields: ['maxLength'] as const },
  { metadataType: 'IntegerAttributeMetadata', select: 'LogicalName,MinValue,MaxValue', fields: ['minValue', 'maxValue'] as const },
  { metadataType: 'BigIntAttributeMetadata', select: 'LogicalName,MinValue,MaxValue', fields: ['minValue', 'maxValue'] as const },
  { metadataType: 'DecimalAttributeMetadata', select: 'LogicalName,MinValue,MaxValue,Precision', fields: ['minValue', 'maxValue', 'precision'] as const },
  { metadataType: 'DoubleAttributeMetadata', select: 'LogicalName,MinValue,MaxValue,Precision', fields: ['minValue', 'maxValue', 'precision'] as const },
  { metadataType: 'MoneyAttributeMetadata', select: 'LogicalName,MinValue,MaxValue,Precision', fields: ['minValue', 'maxValue', 'precision'] as const }
];

type AttributeConstraintField = 'maxLength' | 'minValue' | 'maxValue' | 'precision';

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
  attributeOf?: string;
  schemaName?: string;
  displayName?: string;
  description?: string;
  attributeType?: string;
  attributeTypeName?: string;
  requiredLevel?: string;
  maxLength?: number;
  maxValue?: number;
  minValue?: number;
  precision?: number;
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

export interface DataverseAttributeMetadataRequestSpec {
  metadataType: string;
  path: string;
  select: string;
  fields: readonly AttributeConstraintField[];
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

export interface DataverseCreateRecordInput {
  environmentAlias: string;
  accountName?: string;
  entitySetName: string;
  logicalName?: string;
  primaryIdAttribute?: string;
  body: Record<string, unknown>;
}

export interface DataverseCreateRecordResult {
  entitySetName: string;
  logicalName?: string;
  path: string;
  id?: string;
  record?: Record<string, unknown>;
  headers: Record<string, string>;
  status: number;
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
  linkType?: 'inner' | 'outer';
  attributes?: string[];
  conditions?: FetchXmlConditionSpec[];
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
  filterType?: 'and' | 'or';
  orders?: FetchXmlOrderSpec[];
  linkEntities?: FetchXmlLinkEntitySpec[];
  rawXml?: string;
}

export function buildDataverseGenericAttributeSelect(): string {
  return ATTRIBUTE_METADATA_SELECT;
}

export function buildDataverseDerivedAttributeMetadataSpecs(logicalName: string): DataverseAttributeMetadataRequestSpec[] {
  return DERIVED_ATTRIBUTE_METADATA_SPECS.map((spec) => ({
    metadataType: spec.metadataType,
    path: `/EntityDefinitions(LogicalName='${encodeODataLiteral(logicalName)}')/Attributes/Microsoft.Dynamics.CRM.${spec.metadataType}`,
    select: spec.select,
    fields: spec.fields
  }));
}

export async function listDataverseEntities(
  input: { environmentAlias: string; accountName?: string; search?: string; top?: number },
  configOptions: ConfigStoreOptions = {},
  loginOptions: PublicClientLoginOptions = {}
) {
  const top = clamp(input.top ?? 5000, 1, 5000);
  const result = await executeApiRequest(
    {
      environmentAlias: input.environmentAlias,
      accountName: input.accountName,
      api: 'dv',
      path: '/EntityDefinitions',
      method: 'GET',
      responseType: 'json',
      readIntent: true,
      query: {
        $select: [
          'LogicalName',
          'SchemaName',
          'EntitySetName',
          'DisplayName',
          'DisplayCollectionName',
          'PrimaryIdAttribute',
          'PrimaryNameAttribute',
          'OwnershipType',
          'IsActivity',
          'ObjectTypeCode'
        ].join(',')
      }
    },
    configOptions,
    loginOptions
  );
  if (!result.success || !result.data) return fail(...result.diagnostics);
  const entities = readArray(result.data.response).map((value) => mapEntitySummary(readObject(value) ?? {}));
  entities.sort((a, b) => a.logicalName.localeCompare(b.logicalName));
  const search = normalizeSearch(input.search);
  const filtered = entities.filter((entity) => {
    if (!search) return true;
    return [entity.logicalName, entity.schemaName, entity.displayName, entity.entitySetName].filter((value): value is string => Boolean(value)).some((value) => value.toLowerCase().includes(search));
  });
  return ok(top < filtered.length ? filtered.slice(0, top) : filtered, result.diagnostics);
}

export async function getDataverseEntityDetail(
  input: { environmentAlias: string; logicalName: string; accountName?: string },
  configOptions: ConfigStoreOptions = {},
  loginOptions: PublicClientLoginOptions = {}
): Promise<OperationResult<DataverseEntityDetail>> {
  const [expandedResult, lookupTargetsResult, optionValuesResult, constraintsResult] = await Promise.all([
    getDataverseEntityWithExpandedAttributes(input, configOptions, loginOptions),
    getDataverseLookupTargets(input, configOptions, loginOptions),
    getDataverseOptionValues(input, configOptions, loginOptions),
    getDataverseAttributeConstraints(input, configOptions, loginOptions)
  ]);
  let result = expandedResult;
  let attributes: unknown[] = [];
  let detailDiagnostics = [...expandedResult.diagnostics];
  if (expandedResult.success && expandedResult.data) {
    attributes = readArray(readObject(expandedResult.data.response)?.Attributes);
  } else {
    const [baseResult, attributesResult] = await Promise.all([getDataverseEntityBase(input, configOptions, loginOptions), getDataverseAttributes(input, configOptions, loginOptions)]);
    result = baseResult;
    attributes = attributesResult.success && attributesResult.data ? attributesResult.data : [];
    detailDiagnostics = [
      ...baseResult.diagnostics,
      ...normalizeMetadataDiagnostics(expandedResult.diagnostics, 'Expanded attributes'),
      ...normalizeMetadataDiagnostics(attributesResult.diagnostics, 'Attributes')
    ];
  }
  if (!result.success || !result.data) return fail(...result.diagnostics);
  const raw = readObject(result.data.response);
  if (!raw) {
    return fail(createDiagnostic('error', 'DV_ENTITY_NOT_FOUND', `No Dataverse entity metadata was returned for ${input.logicalName}.`, { source: 'pp/services/dataverse' }));
  }
  const lookupTargets = lookupTargetsResult.success && lookupTargetsResult.data ? lookupTargetsResult.data : new Map<string, string[]>();
  const optionValues = optionValuesResult.success && optionValuesResult.data ? optionValuesResult.data : new Map<string, Array<{ value: number; label?: string }>>();
  const constraints = constraintsResult.success && constraintsResult.data ? constraintsResult.data : new Map<string, Partial<DataverseAttributeSummary>>();
  const detail: DataverseEntityDetail = {
    ...mapEntitySummary(raw),
    description: labelText(raw.Description),
    metadataId: readString(raw.MetadataId),
    isAuditEnabled: readBooleanFlag(raw.IsAuditEnabled),
    isCustomEntity: readBoolean(raw.IsCustomEntity),
    isIntersect: readBoolean(raw.IsIntersect),
    changeTrackingEnabled: readBoolean(raw.ChangeTrackingEnabled),
    attributes: attributes
      .map(mapAttributeSummary)
      .map((attribute) => mergeLookupTargets(attribute, lookupTargets))
      .map((attribute) => mergeOptionValues(attribute, optionValues))
      .map((attribute) => mergeAttributeConstraints(attribute, constraints))
      .sort((a, b) => a.logicalName.localeCompare(b.logicalName))
  };
  return ok(detail, [
    ...detailDiagnostics,
    ...normalizeMetadataDiagnostics(lookupTargetsResult.diagnostics, 'Lookup targets'),
    ...normalizeMetadataDiagnostics(optionValuesResult.diagnostics, 'Choice options'),
    ...normalizeMetadataDiagnostics(constraintsResult.diagnostics, 'Attribute constraints')
  ]);
}

async function getDataverseEntityWithExpandedAttributes(
  input: { environmentAlias: string; logicalName: string; accountName?: string },
  configOptions: ConfigStoreOptions,
  loginOptions: PublicClientLoginOptions = {}
) {
  return executeApiRequest(
    {
      environmentAlias: input.environmentAlias,
      accountName: input.accountName,
      api: 'dv',
      path: `/EntityDefinitions(LogicalName='${encodeODataLiteral(input.logicalName)}')`,
      method: 'GET',
      responseType: 'json',
      readIntent: true,
      query: {
        $select: [
          'LogicalName',
          'SchemaName',
          'EntitySetName',
          'DisplayName',
          'DisplayCollectionName',
          'Description',
          'PrimaryIdAttribute',
          'PrimaryNameAttribute',
          'OwnershipType',
          'MetadataId',
          'ObjectTypeCode',
          'IsActivity'
        ].join(','),
        $expand: `Attributes($select=${ATTRIBUTE_METADATA_SELECT})`
      }
    },
    configOptions,
    loginOptions
  );
}

async function getDataverseEntityBase(input: { environmentAlias: string; logicalName: string; accountName?: string }, configOptions: ConfigStoreOptions, loginOptions: PublicClientLoginOptions = {}) {
  return executeApiRequest(
    {
      environmentAlias: input.environmentAlias,
      accountName: input.accountName,
      api: 'dv',
      path: `/EntityDefinitions(LogicalName='${encodeODataLiteral(input.logicalName)}')`,
      method: 'GET',
      responseType: 'json',
      readIntent: true,
      query: {
        $select: [
          'LogicalName',
          'SchemaName',
          'EntitySetName',
          'DisplayName',
          'DisplayCollectionName',
          'Description',
          'PrimaryIdAttribute',
          'PrimaryNameAttribute',
          'OwnershipType',
          'MetadataId',
          'ObjectTypeCode',
          'IsActivity'
        ].join(',')
      }
    },
    configOptions,
    loginOptions
  );
}

async function getDataverseAttributes(
  input: { environmentAlias: string; logicalName: string; accountName?: string },
  configOptions: ConfigStoreOptions,
  loginOptions: PublicClientLoginOptions = {}
): Promise<OperationResult<unknown[]>> {
  const result = await executeApiRequest(
    {
      environmentAlias: input.environmentAlias,
      accountName: input.accountName,
      api: 'dv',
      path: `/EntityDefinitions(LogicalName='${encodeODataLiteral(input.logicalName)}')/Attributes`,
      method: 'GET',
      responseType: 'json',
      readIntent: true,
      query: {
        $select: ATTRIBUTE_METADATA_SELECT
      }
    },
    configOptions,
    loginOptions
  );
  return result.success && result.data ? ok(readArray(result.data.response), result.diagnostics) : fail(...result.diagnostics);
}

export async function createDataverseRecord(
  input: DataverseCreateRecordInput,
  configOptions: ConfigStoreOptions = {},
  loginOptions: PublicClientLoginOptions = {}
): Promise<OperationResult<DataverseCreateRecordResult>> {
  if (!input.entitySetName.trim()) {
    return fail(createDiagnostic('error', 'DV_ENTITY_SET_REQUIRED', 'entitySetName is required.', { source: 'pp/services/dataverse' }));
  }
  const body = input.body && typeof input.body === 'object' && !Array.isArray(input.body) ? input.body : undefined;
  if (!body || !Object.keys(body).length) {
    return fail(createDiagnostic('error', 'DV_RECORD_BODY_REQUIRED', 'Record body must contain at least one field.', { source: 'pp/services/dataverse' }));
  }
  const path = normalizeDvPath(input.entitySetName);
  const result = await executeApiRequest(
    {
      environmentAlias: input.environmentAlias,
      accountName: input.accountName,
      api: 'dv',
      path,
      method: 'POST',
      headers: {
        Prefer: 'return=representation, odata.include-annotations="*"'
      },
      body,
      responseType: 'json'
    },
    configOptions,
    loginOptions
  );
  if (!result.success || !result.data) return fail(...result.diagnostics);
  const record = isRecord(result.data.response) ? result.data.response : undefined;
  return ok(
    {
      entitySetName: input.entitySetName,
      logicalName: input.logicalName,
      path,
      id: readCreatedRecordId(record, result.data.headers, input.primaryIdAttribute),
      record,
      headers: result.data.headers,
      status: result.data.status
    },
    result.diagnostics
  );
}

export async function listDataverseRecords(
  input: DataverseQuerySpec,
  configOptions: ConfigStoreOptions = {},
  loginOptions: PublicClientLoginOptions = {}
): Promise<OperationResult<DataverseRecordPage>> {
  const querySpec = {
    ...input,
    select: input.select ? [...input.select] : undefined,
    orderBy: input.orderBy ? [...input.orderBy] : undefined
  };
  const diagnostics = [];
  let result = await runDataverseRecordQuery(querySpec, configOptions, loginOptions);
  let invalidProperty = readMissingPropertyName(result.diagnostics);
  while ((!result.success || !result.data) && invalidProperty) {
    const removed = removeInvalidProperty(querySpec, invalidProperty);
    if (!removed) break;
    diagnostics.push(
      createDiagnostic('warning', 'DV_QUERY_PROPERTY_SKIPPED', `Skipped unsupported Dataverse property ${invalidProperty}.`, {
        source: 'pp/services/dataverse'
      })
    );
    result = await runDataverseRecordQuery(querySpec, configOptions, loginOptions);
    invalidProperty = readMissingPropertyName(result.diagnostics);
  }
  if (!result.success || !result.data) return fail(...result.diagnostics);
  const payload = readObject(result.data.response) ?? {};
  const records = readArray(payload.value).filter(isRecord);
  const path = buildDataverseODataPath(querySpec);
  return ok(
    {
      entitySetName: input.entitySetName,
      logicalName: input.entitySetName,
      path,
      records,
      count: typeof payload['@odata.count'] === 'number' ? payload['@odata.count'] : undefined,
      nextLink: readString(payload['@odata.nextLink'])
    },
    [...diagnostics, ...result.diagnostics]
  );
}

async function runDataverseRecordQuery(input: DataverseQuerySpec, configOptions: ConfigStoreOptions, loginOptions: PublicClientLoginOptions = {}) {
  const path = buildDataverseODataPath(input);
  return executeApiRequest(
    {
      environmentAlias: input.environmentAlias,
      accountName: input.accountName,
      api: 'dv',
      path,
      method: 'GET',
      headers: { Prefer: 'odata.include-annotations="*"' },
      responseType: 'json',
      readIntent: true
    },
    configOptions,
    loginOptions
  );
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
  const fetchAttrs = ['version="1.0"', 'mapping="logical"', spec.distinct ? 'distinct="true"' : undefined, spec.top ? `top="${Math.floor(spec.top)}"` : undefined].filter(Boolean);
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
    parts.push(`    <filter type="${escapeXml(spec.filterType ?? 'and')}">`);

    for (const condition of spec.conditions ?? []) {
      if (!condition.attribute.trim() || !condition.operator.trim()) continue;
      const value = condition.value?.trim();
      parts.push(
        value
          ? `      <condition attribute="${escapeXml(condition.attribute.trim())}" operator="${escapeXml(condition.operator.trim())}" value="${escapeXml(value)}" />`
          : `      <condition attribute="${escapeXml(condition.attribute.trim())}" operator="${escapeXml(condition.operator.trim())}" />`
      );
    }
    parts.push('    </filter>');
  }
  for (const link of spec.linkEntities ?? []) {
    if (!link.name.trim() || !link.from.trim() || !link.to.trim()) continue;
    const linkAttrs = [
      `name="${escapeXml(link.name.trim())}"`,
      `from="${escapeXml(link.from.trim())}"`,
      `to="${escapeXml(link.to.trim())}"`,
      link.linkType ? `link-type="${escapeXml(link.linkType)}"` : undefined,
      link.alias?.trim() ? `alias="${escapeXml(link.alias.trim())}"` : undefined
    ]
      .filter(Boolean)
      .join(' ');
    const hasContent = (link.attributes?.length ?? 0) > 0 || (link.conditions?.length ?? 0) > 0;
    if (!hasContent) {
      parts.push(`    <link-entity ${linkAttrs} />`);
    } else {
      parts.push(`    <link-entity ${linkAttrs}>`);
      for (const attr of link.attributes ?? []) {
        if (attr.trim()) parts.push(`      <attribute name="${escapeXml(attr.trim())}" />`);
      }
      if ((link.conditions?.length ?? 0) > 0) {
        parts.push('      <filter type="and">');
        for (const cond of link.conditions ?? []) {
          if (!cond.attribute.trim() || !cond.operator.trim()) continue;
          const val = cond.value?.trim();
          parts.push(
            val
              ? `        <condition attribute="${escapeXml(cond.attribute.trim())}" operator="${escapeXml(cond.operator.trim())}" value="${escapeXml(val)}" />`
              : `        <condition attribute="${escapeXml(cond.attribute.trim())}" operator="${escapeXml(cond.operator.trim())}" />`
          );
        }
        parts.push('      </filter>');
      }
      parts.push('    </link-entity>');
    }
  }
  parts.push('  </entity>');
  parts.push('</fetch>');
  return parts.join('\n');
}

export async function executeFetchXml(
  spec: FetchXmlSpec,
  configOptions: ConfigStoreOptions = {},
  loginOptions: PublicClientLoginOptions = {}
): Promise<OperationResult<DataverseRecordPage & { fetchXml: string }>> {
  const fetchXml = buildFetchXml(spec);
  const entitySetName = spec.entitySetName?.trim();
  if (!entitySetName) {
    return fail(createDiagnostic('error', 'DV_FETCHXML_ENTITY_SET_REQUIRED', 'entitySetName is required to execute FetchXML.', { source: 'pp/services/dataverse' }));
  }
  const path = `${normalizeDvPath(entitySetName)}?fetchXml=${encodeURIComponent(fetchXml)}`;
  const result = await executeApiRequest(
    {
      environmentAlias: spec.environmentAlias,
      accountName: spec.accountName,
      api: 'dv',
      path,
      method: 'GET',
      headers: { Prefer: 'odata.include-annotations="*"' },
      responseType: 'json',
      readIntent: true
    },
    configOptions,
    loginOptions
  );
  if (!result.success || !result.data) return fail(...result.diagnostics);
  const payload = readObject(result.data.response) ?? {};
  return ok(
    {
      entitySetName,
      logicalName: spec.entity,
      path,
      fetchXml,
      records: readArray(payload.value).filter(isRecord),
      count: typeof payload['@odata.count'] === 'number' ? payload['@odata.count'] : undefined,
      nextLink: readString(payload['@odata.nextLink'])
    },
    result.diagnostics
  );
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
    objectTypeCode: typeof value.ObjectTypeCode === 'number' ? value.ObjectTypeCode : undefined
  };
}

async function getDataverseLookupTargets(
  input: { environmentAlias: string; logicalName: string; accountName?: string },
  configOptions: ConfigStoreOptions,
  loginOptions: PublicClientLoginOptions = {}
): Promise<OperationResult<Map<string, string[]>>> {
  const result = await executeApiRequest(
    {
      environmentAlias: input.environmentAlias,
      accountName: input.accountName,
      api: 'dv',
      path: `/EntityDefinitions(LogicalName='${encodeODataLiteral(input.logicalName)}')/Attributes/Microsoft.Dynamics.CRM.LookupAttributeMetadata`,
      method: 'GET',
      responseType: 'json',
      readIntent: true,
      query: {
        $select: 'LogicalName,Targets'
      }
    },
    configOptions,
    loginOptions
  );
  if (!result.success || !result.data) return fail(...result.diagnostics);
  const lookupTargets = new Map<string, string[]>();
  for (const value of readArray(result.data.response)) {
    const record = readObject(value);
    const logicalName = readString(record?.LogicalName);
    if (!logicalName) continue;
    const targets = readArray(record?.Targets).filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    if (targets.length) lookupTargets.set(logicalName, targets);
  }
  return ok(lookupTargets, result.diagnostics);
}

async function getDataverseOptionValues(
  input: { environmentAlias: string; logicalName: string; accountName?: string },
  configOptions: ConfigStoreOptions,
  loginOptions: PublicClientLoginOptions = {}
): Promise<OperationResult<Map<string, Array<{ value: number; label?: string }>>>> {
  const metadataTypes = ['PicklistAttributeMetadata', 'MultiSelectPicklistAttributeMetadata', 'StateAttributeMetadata', 'StatusAttributeMetadata'];
  const results = await Promise.all(
    metadataTypes.map((metadataType) =>
      executeApiRequest(
        {
          environmentAlias: input.environmentAlias,
          accountName: input.accountName,
          api: 'dv',
          path: `/EntityDefinitions(LogicalName='${encodeODataLiteral(input.logicalName)}')/Attributes/Microsoft.Dynamics.CRM.${metadataType}`,
          method: 'GET',
          responseType: 'json',
          readIntent: true,
          query: {
            $select: 'LogicalName',
            $expand: 'OptionSet($select=Options)'
          }
        },
        configOptions,
        loginOptions
      )
    )
  );
  const optionValues = new Map<string, Array<{ value: number; label?: string }>>();
  const diagnostics = [];
  for (const result of results) {
    if (!result.success || !result.data) {
      diagnostics.push(...result.diagnostics);
      continue;
    }
    for (const value of readArray(result.data.response)) {
      const attribute = mapAttributeSummary(value);
      if (attribute.optionValues?.length) optionValues.set(attribute.logicalName, attribute.optionValues);
    }
    diagnostics.push(...result.diagnostics);
  }
  return ok(optionValues, diagnostics);
}

async function getDataverseAttributeConstraints(
  input: { environmentAlias: string; logicalName: string; accountName?: string },
  configOptions: ConfigStoreOptions,
  loginOptions: PublicClientLoginOptions = {}
): Promise<OperationResult<Map<string, Partial<DataverseAttributeSummary>>>> {
  const specs = buildDataverseDerivedAttributeMetadataSpecs(input.logicalName);
  const results = await Promise.all(
    specs.map((spec) =>
      executeApiRequest(
        {
          environmentAlias: input.environmentAlias,
          accountName: input.accountName,
          api: 'dv',
          path: spec.path,
          method: 'GET',
          responseType: 'json',
          readIntent: true,
          query: {
            $select: spec.select
          }
        },
        configOptions,
        loginOptions
      )
    )
  );
  const constraints = new Map<string, Partial<DataverseAttributeSummary>>();
  const diagnostics = [];
  for (const [index, result] of results.entries()) {
    const spec = specs[index];
    if (!result.success || !result.data) {
      diagnostics.push(...result.diagnostics);
      continue;
    }
    for (const value of readArray(result.data.response)) {
      const record = readObject(value);
      const logicalName = readString(record?.LogicalName);
      if (!logicalName) continue;
      const patch = constraints.get(logicalName) ?? {};
      for (const field of spec.fields) {
        const odataName = field === 'maxLength' ? 'MaxLength' : field === 'minValue' ? 'MinValue' : field === 'maxValue' ? 'MaxValue' : 'Precision';
        const fieldValue = record?.[odataName];
        if (typeof fieldValue === 'number') patch[field] = fieldValue;
      }
      if (Object.keys(patch).length) constraints.set(logicalName, patch);
    }
    diagnostics.push(...result.diagnostics);
  }
  return ok(constraints, diagnostics);
}

function mapAttributeSummary(value: unknown): DataverseAttributeSummary {
  const record = readObject(value) ?? {};
  const optionSet = readObject(record.OptionSet);
  const optionValues = readArray(optionSet?.Options)
    .map((option) => {
      const item = readObject(option);
      if (!item || typeof item.Value !== 'number') return undefined;
      return { value: item.Value, label: labelText(item.Label) };
    })
    .filter((item): item is { value: number; label: string | undefined } => item !== undefined);
  return {
    logicalName: readString(record.LogicalName) ?? 'unknown',
    attributeOf: readString(record.AttributeOf),
    schemaName: readString(record.SchemaName),
    displayName: labelText(record.DisplayName),
    description: labelText(record.Description),
    attributeType: readString(record.AttributeType),
    attributeTypeName: readString(readObject(record.AttributeTypeName)?.Value) ?? readString(record.AttributeTypeName),
    requiredLevel: readString(readObject(record.RequiredLevel)?.Value) ?? readString(record.RequiredLevel),
    maxLength: typeof record.MaxLength === 'number' ? record.MaxLength : undefined,
    maxValue: typeof record.MaxValue === 'number' ? record.MaxValue : undefined,
    minValue: typeof record.MinValue === 'number' ? record.MinValue : undefined,
    precision: typeof record.Precision === 'number' ? record.Precision : undefined,
    targets: readArray(record.Targets).filter((item): item is string => typeof item === 'string'),
    isPrimaryId: readBoolean(record.IsPrimaryId),
    isPrimaryName: readBoolean(record.IsPrimaryName),
    isValidForRead: readBooleanFlag(record.IsValidForRead),
    isValidForCreate: readBooleanFlag(record.IsValidForCreate),
    isValidForUpdate: readBooleanFlag(record.IsValidForUpdate),
    isValidForAdvancedFind: readBooleanFlag(record.IsValidForAdvancedFind),
    isValidForSort: readBooleanFlag(record.IsValidForSortEnabled),
    optionValues: optionValues.length ? optionValues : undefined
  };
}

function readCreatedRecordId(record: Record<string, unknown> | undefined, headers: Record<string, string>, primaryIdAttribute?: string): string | undefined {
  if (record && primaryIdAttribute && typeof record[primaryIdAttribute] === 'string') return record[primaryIdAttribute];
  if (record) {
    const idEntry = Object.entries(record).find(([key, value]) => key.endsWith('id') && typeof value === 'string' && GUID_RE.test(value));
    if (idEntry && typeof idEntry[1] === 'string') return idEntry[1];
    const odataId = readString(record['@odata.id']);
    const parsed = odataId ? parseEntityId(odataId) : undefined;
    if (parsed) return parsed;
  }
  const entityId = headers['odata-entityid'] ?? headers['OData-EntityId'];
  return entityId ? parseEntityId(entityId) : undefined;
}

function parseEntityId(value: string): string | undefined {
  const match = /\(([0-9a-f-]{36})\)/i.exec(value);
  return match?.[1];
}

function mergeLookupTargets(attribute: DataverseAttributeSummary, lookupTargets: Map<string, string[]>): DataverseAttributeSummary {
  if (attribute.targets?.length) return attribute;
  const targets = lookupTargets.get(attribute.logicalName);
  return targets?.length ? { ...attribute, targets } : attribute;
}

function mergeOptionValues(attribute: DataverseAttributeSummary, optionValues: Map<string, Array<{ value: number; label?: string }>>): DataverseAttributeSummary {
  const values = optionValues.get(attribute.logicalName);
  return values?.length ? { ...attribute, optionValues: values } : attribute;
}

function mergeAttributeConstraints(attribute: DataverseAttributeSummary, constraints: Map<string, Partial<DataverseAttributeSummary>>): DataverseAttributeSummary {
  const patch = constraints.get(attribute.logicalName);
  return patch ? { ...attribute, ...patch } : attribute;
}

function normalizeMetadataDiagnostics(diagnostics: ReturnType<typeof fail>['diagnostics'], label: string) {
  return diagnostics.map((diagnostic) => {
    if (diagnostic.level !== 'error') return diagnostic;
    return createDiagnostic('warning', diagnostic.code, `${label} are unavailable: ${diagnostic.message}`, {
      source: diagnostic.source,
      hint: diagnostic.hint,
      detail: diagnostic.detail,
      path: diagnostic.path
    });
  });
}

function readMissingPropertyName(diagnostics: ReturnType<typeof fail>['diagnostics']): string | undefined {
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== 'HTTP_REQUEST_FAILED' || !diagnostic.detail) continue;
    try {
      const payload = JSON.parse(diagnostic.detail) as { error?: { message?: string } };
      const message = payload.error?.message;
      const match = message?.match(/Could not find a property named '([^']+)'/);
      if (match?.[1]) return match[1];
    } catch {
      continue;
    }
  }
  return undefined;
}

function removeInvalidProperty(spec: DataverseQuerySpec, propertyName: string): boolean {
  let removed = false;
  if (spec.select?.length) {
    const next = spec.select.filter((item) => item !== propertyName);
    removed = removed || next.length !== spec.select.length;
    spec.select = next.length ? next : undefined;
  }
  if (spec.orderBy?.length) {
    const next = spec.orderBy.filter((item) => !readOrderByProperty(item, propertyName));
    removed = removed || next.length !== spec.orderBy.length;
    spec.orderBy = next.length ? next : undefined;
  }
  return removed;
}

function readOrderByProperty(value: string, propertyName: string): boolean {
  const [candidate] = value.trim().split(/\s+/, 1);
  return candidate === propertyName;
}

function labelText(value: unknown): string | undefined {
  const record = readObject(value);
  const userLocalized = readObject(record?.UserLocalizedLabel);
  const firstLocalized = readObject(readArray(record?.LocalizedLabels)[0]);
  return readString(userLocalized?.Label) ?? readString(firstLocalized?.Label);
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

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
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
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&apos;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
