import { ApiRequestError, api, prop } from './utils.js';
import type { ApiEnvelope, ApiExecuteResponse, FlowAction, FlowAnalysis, FlowApiOperation, FlowApiOperationSchema, FlowApiOperationSchemaField, FlowDynamicValueOption, FlowItem, FlowRun } from './ui-types.js';

const DATAVERSE_FLOW_FALLBACK_PATH = "/workflows?$filter=category eq 5&$select=name,workflowid,createdon,modifiedon,statecode,statuscode,_ownerid_value,description,clientdata&$orderby=modifiedon desc&$top=200";

export type FlowListResult = {
  flows: FlowItem[];
  source: 'flow' | 'dv';
  usedFallback: boolean;
};

export type FlowValidationKind = 'errors' | 'warnings';

export type FlowValidationItem = {
  level: 'error' | 'warning' | 'info';
  code?: string;
  message: string;
  path?: string;
  actionName?: string;
  operationMetadataId?: string;
  from?: number;
  to?: number;
  raw: unknown;
};

export type FlowValidationResult = {
  kind: FlowValidationKind;
  items: FlowValidationItem[];
  raw: unknown;
  checkedAt: string;
};

export async function loadFlowList(environment: string): Promise<FlowListResult> {
  try {
    const result = await executeRequest<{ value?: unknown[] }>(environment, 'flow', '/flows', false);
    return {
      flows: (result.response?.value || []).map(normalizeFlowApiItem),
      source: 'flow',
      usedFallback: false,
    };
  } catch (error) {
    const result = await executeRequest<{ value?: unknown[] }>(environment, 'dv', DATAVERSE_FLOW_FALLBACK_PATH, false);
    const flows = (result.response?.value || []).map(normalizeDataverseFlow);
    if (!flows.length) throw error;
    return { flows, source: 'dv', usedFallback: true };
  }
}

export async function loadFlowDefinitionDocument(environment: string, flow: FlowItem): Promise<string> {
  let detail: unknown = flow;
  if (flow.source !== 'dv') {
    try {
      const result = await executeRequest<unknown>(environment, 'flow', `/flows/${flowIdentifier(flow)}`, false);
      detail = result.response || flow;
    } catch {
      detail = flow;
    }
  }
  return buildFlowDocument(detail as FlowItem);
}

export async function analyzeFlowDocument(source: string, cursor = source.length): Promise<FlowAnalysis> {
  const payload = await api<ApiEnvelope<FlowAnalysis>>('/api/flow/language/analyze', {
    method: 'POST',
    body: JSON.stringify({ source, cursor }),
  });
  return payload.data;
}

export async function checkFlowDefinition(environment: string, flow: FlowItem, source: string, kind: FlowValidationKind): Promise<FlowValidationResult> {
  const suffix = kind === 'errors' ? 'checkFlowErrors' : 'checkFlowWarnings';
  try {
    const result = await executeRequest<unknown>(
      environment,
      'flow',
      `/flows/${flowIdentifier(flow)}/${suffix}`,
      true,
      'POST',
      buildFlowServicePayload(source),
    );
    return normalizeFlowValidationResult(kind, result.response);
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return normalizeFlowValidationResult(kind, error.data);
    }
    throw error;
  }
}

export async function saveFlowDefinition(environment: string, flow: FlowItem, source: string): Promise<FlowItem> {
  const result = await executeRequest<unknown>(
    environment,
    'flow',
    `/flows/${flowIdentifier(flow)}?$expand=properties.connectionreferences.apidefinition,properties.definitionsummary.operations.apioperation,operationDefinition,plan,properties.throttleData,properties.estimatedsuspensiondata,properties.powerFlowType`,
    true,
    'PATCH',
    {
      ...buildFlowServicePayload(source),
      telemetryMetadata: { modifiedSources: 'pp-ui' },
    },
  );
  return normalizeFlowApiItem(result.response || flow);
}

export async function loadFlowApiOperations(environment: string, search: string): Promise<FlowApiOperation[]> {
  const result = await executeRequest<{ value?: unknown[] }>(
    environment,
    'flow',
    '/operations?api-version=2016-11-01&$top=250',
    true,
    'POST',
    {
      searchText: search.trim(),
      visibleHideKeys: [],
      allTagsToInclude: ['Action', 'Important'],
      anyTagsToExclude: ['Deprecated', 'Agentic', 'Trigger'],
    },
  );
  return (result.response?.value || []).map(normalizeFlowApiOperation);
}

export async function loadFlowApiOperationSchema(environment: string, apiRef: string | undefined, operationId: string): Promise<FlowApiOperationSchema | null> {
  const apiName = apiNameFromId(apiRef);
  if (!apiName || !operationId) return null;
  try {
    const detail = await executeRequest<Record<string, unknown>>(
      environment,
      'powerautomate',
      `/apis/${encodeURIComponent(apiName)}/apiOperations/${encodeURIComponent(operationId)}?$expand=properties%2FinputsDefinition,properties%2FresponsesDefinition,properties%2Fconnector`,
      true,
    );
    const detailSchema = normalizeFlowApiOperationSchema(apiName, apiRef, operationId, detail.response);
    if (detailSchema?.fields.length) return detailSchema;
  } catch {
    // The environment-scoped designer API is richer, but not present for every tenant/connector.
  }
  try {
    const detail = await executeRequest<Record<string, unknown>>(environment, 'flow', `/apis/${encodeURIComponent(apiName)}/apiOperations/${encodeURIComponent(operationId)}`, true);
    const detailSchema = normalizeFlowApiOperationSchema(apiName, apiRef, operationId, detail.response);
    if (detailSchema?.fields.length) return detailSchema;
  } catch {
    // Some environments do not expose the per-operation route. The full connector swagger is the durable fallback.
  }
  const result = await executeRequest<Record<string, unknown>>(environment, 'flow', `/apis/${encodeURIComponent(apiName)}`, true);
  return normalizeFlowApiOperationSchema(apiName, apiRef, operationId, result.response);
}

export async function loadFlowDynamicEnum(
  environment: string,
  apiName: string | undefined,
  connectionName: string | undefined,
  dynamicValues: unknown,
  parameters: Record<string, unknown>,
): Promise<FlowDynamicValueOption[]> {
  if (!apiName || !connectionName || !isRecord(dynamicValues)) return [];
  const dynamicInvocationDefinition = normalizeDynamicInvocationDefinition(dynamicValues);
  if (!dynamicInvocationDefinition.operationId) return [];
  const result = await executeRequest<unknown>(
    environment,
    'powerautomate',
    `/apis/${encodeURIComponent(apiName)}/connections/${encodeURIComponent(connectionName)}/listEnum`,
    true,
    'POST',
    {
      parameters: dynamicInvocationParameters(dynamicInvocationDefinition, parameters),
      dynamicInvocationDefinition,
    },
  );
  return normalizeDynamicEnumOptions(result.response, dynamicInvocationDefinition);
}

export function formatFlowDocument(source: string) {
  return JSON.stringify(JSON.parse(source), null, 2);
}

export function buildFlowServicePayload(source: string): Record<string, unknown> {
  const parsed = JSON.parse(source) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Flow definition JSON must be an object.');
  }

  const root = parsed as Record<string, unknown>;
  const properties = isRecord(root.properties) ? root.properties : root;
  const definition = properties.definition || root.definition || parsed;
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new Error('Flow definition JSON must contain a workflow definition object.');
  }

  const serviceProperties: Record<string, unknown> = {
    definition,
    connectionReferences: properties.connectionReferences || root.connectionReferences || {},
    displayName: properties.displayName || root.name || root.displayName || 'Flow',
  };

  for (const key of ['templateName', 'solutionId', 'workflowEntityId', 'plan'] as const) {
    const value = properties[key] ?? root[key];
    if (value !== undefined) serviceProperties[key] = value;
  }

  const environmentName = prop(properties, 'environment.name') || prop(root, 'environment.name');
  if (environmentName) serviceProperties.environment = { name: environmentName };

  return { properties: serviceProperties };
}

export async function loadFlowRuns(environment: string, flow: FlowItem): Promise<FlowRun[]> {
  const result = await executeRequest<{ value?: FlowRun[] }>(environment, 'flow', `/flows/${flowIdentifier(flow)}/runs?$top=20`);
  return result.response?.value || [];
}

export async function loadRunActions(environment: string, flow: FlowItem, run: FlowRun): Promise<FlowAction[]> {
  const result = await executeRequest<{ value?: FlowAction[] }>(environment, 'flow', `/flows/${flowIdentifier(flow)}/runs/${run.name}/actions`);
  return result.response?.value || [];
}

export async function loadRunDetail(environment: string, flow: FlowItem, run: FlowRun): Promise<FlowRun> {
  const result = await executeRequest<FlowRun>(
    environment,
    'flow',
    `/flows/${flowIdentifier(flow)}/runs/${run.name}?$expand=properties/actions,properties/flow&include=repetitionCount&isMigrationSource=false`,
  );
  return result.response || run;
}

export async function loadActionDetail(environment: string, flow: FlowItem, run: FlowRun, action: FlowAction): Promise<FlowAction> {
  const result = await executeRequest<FlowAction>(environment, 'flow', `/flows/${flowIdentifier(flow)}/runs/${run.name}/actions/${action.name}`);
  return result.response || action;
}

async function executeRequest<T>(
  environment: string,
  apiKind: string,
  path: string,
  allowInteractive = true,
  method = 'GET',
  body?: unknown,
) {
  const result = await api<ApiEnvelope<ApiExecuteResponse<T>>>('/api/request/execute', {
    method: 'POST',
    body: JSON.stringify({
      environment,
      api: apiKind,
      method,
      path,
      allowInteractive,
      softFail: !allowInteractive,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  });
  return result.data;
}

export function flowIdentifier(flow: FlowItem | null | undefined) {
  return flow && (flow.workflowid || flow.name) || '';
}

export function buildFlowDocument(detail: FlowItem | Record<string, unknown>) {
  const definition = prop(detail, 'properties.definition') || (detail as FlowItem).definition || detail;
  const connectionReferences = prop(detail, 'properties.connectionReferences');
  if (definition && typeof definition === 'object') {
    return JSON.stringify({
      name: (detail as FlowItem).name,
      id: (detail as FlowItem).id || (detail as FlowItem).workflowid,
      type: (detail as FlowItem).type,
      properties: {
        displayName: prop(detail, 'properties.displayName'),
        state: prop(detail, 'properties.state'),
        connectionReferences,
        definition,
      },
    }, null, 2);
  }
  if (typeof definition === 'string') return definition;
  return JSON.stringify(detail || {}, null, 2);
}

function normalizeFlowApiItem(value: unknown): FlowItem {
  const flow = value as FlowItem;
  return {
    ...flow,
    source: 'flow',
    workflowid: flow.workflowid || flow.name,
    properties: {
      ...(flow.properties || {}),
      displayName: prop(flow, 'properties.displayName') || flow.name || 'Unnamed',
      definition: prop(flow, 'properties.definition'),
      connectionReferences: prop(flow, 'properties.connectionReferences'),
    },
  };
}

function normalizeDataverseFlow(value: unknown): FlowItem {
  const flow = value as Record<string, unknown>;
  const clientData = parseJsonMaybe(flow.clientdata);
  const definition = prop(clientData, 'properties.definition') || prop(clientData, 'definition') || clientData || {};
  const triggerEntries = Object.entries(prop(definition, 'triggers') || {});
  const actionEntries = Object.entries(prop(definition, 'actions') || {});
  return {
    source: 'dv',
    name: String(flow.name || ''),
    workflowid: String(flow.workflowid || ''),
    properties: {
      displayName: String(flow.name || flow.workflowid || 'Unnamed'),
      description: String(flow.description || ''),
      state: flow.statecode === 0 ? 'Started' : flow.statecode === 1 ? 'Stopped' : 'Unknown',
      createdTime: typeof flow.createdon === 'string' ? flow.createdon : undefined,
      lastModifiedTime: typeof flow.modifiedon === 'string' ? flow.modifiedon : undefined,
      creator: { objectId: String(flow._ownerid_value || '') },
      definition,
      connectionReferences: prop(clientData, 'properties.connectionReferences') || {},
      definitionSummary: {
        triggers: triggerEntries.map(([name, item]) => ({ name, type: String(prop(item, 'type') || '-') })),
        actions: actionEntries.map(([name, item]) => ({ name, type: String(prop(item, 'type') || '-') })),
      },
    },
  };
}

function normalizeFlowApiOperation(value: unknown): FlowApiOperation {
  const operation = value as Record<string, unknown>;
  const properties = isRecord(operation.properties) ? operation.properties : {};
  const api = firstRecord(
    properties.api,
    properties.apiDefinition,
    properties.operationGroup,
    operation.api,
    operation.apiDefinition,
    operation.operationGroup,
    prop(operation, 'operation.api'),
  );
  const name = firstString(operation.name, properties.name, operation.operationId, properties.operationId, prop(operation, 'apiOperation.name')) || '';
  const apiName = firstString(api.apiName, api.name, properties.apiName, operation.apiName);
  const apiDisplayName = firstString(api.displayName, api.apiDisplayName, properties.apiDisplayName, operation.apiDisplayName);
  return {
    name,
    id: firstString(operation.id, properties.id),
    summary: firstString(properties.summary, operation.summary, properties.displayName, operation.displayName, name),
    description: firstString(properties.description, operation.description),
    operationType: firstString(properties.operationType, operation.operationType, properties.type, operation.type),
    apiId: firstString(api.id, properties.apiId, operation.apiId),
    apiName,
    apiDisplayName,
    iconUri: firstString(api.iconUri, api.iconUriValue, properties.iconUri, operation.iconUri),
    raw: value,
  };
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return {};
}

function firstRecordOrUndefined(...values: unknown[]): Record<string, unknown> | undefined {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return undefined;
}

function normalizeFlowApiOperationSchema(apiName: string, apiId: string | undefined, operationId: string, rawApi: unknown): FlowApiOperationSchema | null {
  const api = rawApi as Record<string, unknown>;
  const properties = isRecord(api.properties) ? api.properties : {};
  const swagger = isRecord(properties.swagger) ? properties.swagger : {};
  const operationDetail = findOperationDetailCandidate(api, operationId);
  if (operationDetail) {
    const parameters = operationParameters(operationDetail);
    const operationFields = normalizeSwaggerParameters(parameters, swagger);
    const definitionFields = normalizeOperationDefinitionFields(operationDetail, swagger);
    const fields = mergeSchemaFields([...operationFields, ...definitionFields]);
    return {
      apiId,
      apiName,
      apiDisplayName: firstString(properties.displayName, prop(operationDetail, 'connector.displayName'), prop(operationDetail, 'api.displayName'), prop(operationDetail, 'apiDefinition.displayName')),
      operationId,
      summary: firstString(operationDetail.summary, operationDetail.displayName, prop(operationDetail, 'inputsDefinition.summary'), properties.summary),
      description: firstString(operationDetail.description, properties.description),
      fields,
      raw: operationDetail,
    };
  }

  const paths = isRecord(swagger.paths) ? swagger.paths : {};
  for (const [, pathValue] of Object.entries(paths)) {
    if (!isRecord(pathValue)) continue;
    for (const [, methodValue] of Object.entries(pathValue)) {
      if (!isRecord(methodValue)) continue;
      if (methodValue.operationId !== operationId) continue;
      const parameters = Array.isArray(methodValue.parameters) ? methodValue.parameters : [];
      return {
        apiId,
        apiName,
        apiDisplayName: typeof properties.displayName === 'string' ? properties.displayName : undefined,
        operationId,
        summary: typeof methodValue.summary === 'string' ? methodValue.summary : undefined,
        description: typeof methodValue.description === 'string' ? methodValue.description : undefined,
        fields: normalizeSwaggerParameters(parameters, swagger),
        raw: methodValue,
      };
    }
  }
  return null;
}

function findOperationDetailCandidate(api: Record<string, unknown>, operationId: string): Record<string, unknown> | null {
  const candidates = [
    prop(api, 'properties.apiOperation'),
    prop(api, 'properties.operation'),
    prop(api, 'properties.inputsDefinition'),
    prop(api, 'properties'),
    prop(api, 'apiOperation'),
    api,
  ];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    if (
      candidate.operationId === operationId ||
      candidate.name === operationId ||
      Array.isArray(candidate.parameters) ||
      Array.isArray(candidate.inputs) ||
      isRecord(candidate.inputsDefinition) ||
      isRecord(prop(candidate, 'properties.inputsDefinition'))
    ) {
      return candidate;
    }
  }
  return null;
}

function operationParameters(operation: Record<string, unknown>): unknown[] {
  for (const value of [
    operation.parameters,
    prop(operation, 'inputs.parameters'),
    prop(operation, 'inputsDefinition.parameters'),
    prop(operation, 'properties.inputsDefinition.parameters'),
    prop(operation, 'properties.parameters'),
    operation.inputs,
    prop(operation, 'inputsDefinition.inputs'),
    prop(operation, 'properties.inputsDefinition.inputs'),
  ]) {
    if (Array.isArray(value)) return value;
    if (isRecord(value)) return Object.entries(value).map(([name, parameter]) => isRecord(parameter) ? { name, ...parameter } : { name, schema: parameter });
  }
  return [];
}

function normalizeOperationDefinitionFields(operation: Record<string, unknown>, swagger: Record<string, unknown>): FlowApiOperationSchemaField[] {
  const inputsDefinition = firstRecordOrUndefined(
    prop(operation, 'properties.inputsDefinition'),
    operation.inputsDefinition,
    operation,
  );
  if (!inputsDefinition) return [];
  const candidates = [
    prop(inputsDefinition, 'schema.properties.parameters'),
    prop(inputsDefinition, 'properties.parameters.properties'),
    prop(inputsDefinition, 'parameters.properties'),
    prop(inputsDefinition, 'parameters'),
    prop(inputsDefinition, 'schema.properties.body.properties'),
    prop(inputsDefinition, 'properties.body.properties'),
    prop(inputsDefinition, 'body.properties'),
    prop(inputsDefinition, 'properties'),
  ];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const required = requiredSetForDefinition(inputsDefinition, candidate);
    const fields = Object.entries(candidate)
      .filter(([, value]) => isRecord(value))
      .flatMap(([name, value]) => normalizeSchemaPropertyField(name, value as Record<string, unknown>, required, swagger));
    if (fields.length) return fields;
  }
  return [];
}

function normalizeSchemaPropertyField(
  name: string,
  schemaValue: Record<string, unknown>,
  required: Set<string>,
  swagger: Record<string, unknown>,
  path: string[] = ['inputs', 'parameters', name],
): FlowApiOperationSchemaField[] {
  const schema = resolveSwaggerSchema(schemaValue, swagger) || schemaValue;
  const enumValues = Array.isArray(schema.enum) ? schema.enum.map(String) : undefined;
  const field: FlowApiOperationSchemaField = {
    name,
    location: 'parameter',
    path,
    required: required.has(name),
    type: typeof schema.type === 'string' ? schema.type : undefined,
    title: firstString(schema['x-ms-summary'], schema.title),
    description: typeof schema.description === 'string' ? schema.description : undefined,
    enum: enumValues,
    defaultValue: schema.default,
    schema,
    dynamicValues: schema['x-ms-dynamic-values'] || schema['x-ms-dynamic-list'],
    dynamicSchema: schema['x-ms-dynamic-schema'],
    visibility: firstString(schema['x-ms-visibility']),
  };
  return [field, ...normalizeBodySchemaProperties(field, schema, swagger)];
}

function requiredSetForDefinition(definition: Record<string, unknown>, candidate: Record<string, unknown>): Set<string> {
  for (const value of [definition.required, prop(definition, 'schema.required'), prop(definition, 'properties.parameters.required'), prop(definition, 'parameters.required')]) {
    if (Array.isArray(value)) return new Set(value.map(String));
  }
  return new Set(Object.entries(candidate).filter(([, value]) => isRecord(value) && value.required === true).map(([name]) => name));
}

function mergeSchemaFields(fields: FlowApiOperationSchemaField[]): FlowApiOperationSchemaField[] {
  const seen = new Set<string>();
  const result: FlowApiOperationSchemaField[] = [];
  for (const field of fields) {
    const key = `${field.location || 'parameter'}:${(field.path || []).join('.')}:${field.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(field);
  }
  return result;
}

function normalizeSwaggerParameters(values: unknown[], swagger: Record<string, unknown>): FlowApiOperationSchemaField[] {
  return values.flatMap((value) => normalizeSwaggerParameter(value, swagger));
}

function normalizeSwaggerParameter(value: unknown, swagger: Record<string, unknown>): FlowApiOperationSchemaField[] {
  if (!isRecord(value)) return [];
  const schema = resolveSwaggerSchema(isRecord(value.schema) ? value.schema : undefined, swagger);
  const enumValues = Array.isArray(value.enum) ? value.enum : Array.isArray(schema?.enum) ? schema.enum : undefined;
  const name = String(value.name || '');
  const location = typeof value.in === 'string' ? value.in : undefined;
  const baseField: FlowApiOperationSchemaField = {
    name: String(value.name || ''),
    location,
    path: swaggerParameterPath(location, name),
    required: Boolean(value.required),
    type: typeof value.type === 'string' ? value.type : typeof schema?.type === 'string' ? schema.type : undefined,
    title: firstString(value['x-ms-summary'], value.title, schema?.['x-ms-summary'], schema?.title),
    description: typeof value.description === 'string' ? value.description : typeof schema?.description === 'string' ? schema.description : undefined,
    enum: enumValues?.map(String),
    defaultValue: value.default ?? schema?.default,
    schema,
    dynamicValues: value['x-ms-dynamic-values'] || value['x-ms-dynamic-list'] || schema?.['x-ms-dynamic-values'],
    dynamicSchema: value['x-ms-dynamic-schema'] || schema?.['x-ms-dynamic-schema'],
    visibility: firstString(value['x-ms-visibility'], schema?.['x-ms-visibility']),
  };
  return [baseField, ...normalizeBodySchemaProperties(baseField, schema, swagger)];
}

function normalizeBodySchemaProperties(parent: FlowApiOperationSchemaField, schema: Record<string, unknown> | undefined, swagger: Record<string, unknown>): FlowApiOperationSchemaField[] {
  if (parent.location !== 'body' || !schema || !isRecord(schema.properties)) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return Object.entries(schema.properties).flatMap(([name, value]) => {
    const childSchema = resolveSwaggerSchema(isRecord(value) ? value : undefined, swagger);
    const enumValues = Array.isArray(childSchema?.enum) ? childSchema.enum.map(String) : undefined;
    const child: FlowApiOperationSchemaField = {
      name,
      location: 'body',
      path: [...(parent.path || swaggerParameterPath(parent.location, parent.name)), name],
      required: required.has(name),
      type: typeof childSchema?.type === 'string' ? childSchema.type : undefined,
      title: firstString(childSchema?.['x-ms-summary'], childSchema?.title),
      description: typeof childSchema?.description === 'string' ? childSchema.description : undefined,
      enum: enumValues,
      defaultValue: childSchema?.default,
      schema: childSchema,
      dynamicValues: childSchema?.['x-ms-dynamic-values'] || childSchema?.['x-ms-dynamic-list'],
      dynamicSchema: childSchema?.['x-ms-dynamic-schema'],
      visibility: firstString(childSchema?.['x-ms-visibility'], parent.visibility),
    };
    return [child, ...normalizeBodySchemaProperties(child, childSchema, swagger)];
  });
}

function swaggerParameterPath(location: string | undefined, name: string): string[] {
  if (!name) return ['inputs', 'parameters'];
  return ['inputs', 'parameters', name];
}

function resolveSwaggerSchema(schema: Record<string, unknown> | undefined, swagger: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  const ref = typeof schema.$ref === 'string' ? schema.$ref : '';
  if (!ref.startsWith('#/')) return schema;
  const resolved = readJsonPointer(swagger, ref.slice(2));
  if (!isRecord(resolved)) return schema;
  const { $ref, ...rest } = schema;
  return { ...resolveSwaggerSchema(resolved, swagger), ...rest };
}

function readJsonPointer(source: unknown, pointer: string): unknown {
  return pointer.split('/').reduce((current, rawSegment) => {
    if (!isRecord(current)) return undefined;
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    return current[segment];
  }, source);
}

function normalizeDynamicInvocationDefinition(source: Record<string, unknown>): Record<string, unknown> {
  const operationId = firstString(source.operationId, source.operation, source.name);
  const parameters = normalizeDynamicInvocationParameterDefinitions(source.parameters);
  const result: Record<string, unknown> = {
    ...(operationId ? { operationId } : {}),
    parameters,
  };
  const itemsPath = firstString(source.itemsPath, source['value-collection'], source.valueCollection, source.collection);
  const itemValuePath = firstString(source.itemValuePath, source['value-path'], source.valuePath, source.value);
  const itemTitlePath = firstString(source.itemTitlePath, source['value-title'], source.valueTitle, source.title);
  if (itemsPath) result.itemsPath = itemsPath;
  if (itemValuePath) result.itemValuePath = itemValuePath;
  if (itemTitlePath) result.itemTitlePath = itemTitlePath;
  return result;
}

function normalizeDynamicInvocationParameterDefinitions(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw === 'string') {
      result[name] = { parameterReference: raw, required: true };
      continue;
    }
    if (!isRecord(raw)) continue;
    const reference = firstString(raw.parameterReference, raw.parameter, raw.name, raw.value);
    result[name] = reference ? { ...raw, parameterReference: reference, required: raw.required !== false } : raw;
  }
  return result;
}

function dynamicInvocationParameters(definition: Record<string, unknown>, currentParameters: Record<string, unknown>): Record<string, unknown> {
  const parameterDefinitions = isRecord(definition.parameters) ? definition.parameters : {};
  const result: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(parameterDefinitions)) {
    const parameterReference = isRecord(raw) ? firstString(raw.parameterReference, raw.parameter, raw.name) : undefined;
    const sourceName = parameterReference || name;
    if (Object.prototype.hasOwnProperty.call(currentParameters, sourceName)) result[name] = currentParameters[sourceName];
  }
  return result;
}

function normalizeDynamicEnumOptions(raw: unknown, definition: Record<string, unknown>): FlowDynamicValueOption[] {
  const itemsPath = firstString(definition.itemsPath, 'value') || 'value';
  const valuePath = firstString(definition.itemValuePath, 'value', 'name') || 'value';
  const titlePath = firstString(definition.itemTitlePath, definition.itemValuePath, 'displayName', 'name') || valuePath;
  const items = readDynamicPath(raw, itemsPath);
  const values = Array.isArray(items) ? items : Array.isArray(raw) ? raw : [];
  return values.flatMap((item) => {
    if (!isRecord(item)) return item === undefined || item === null ? [] : [{ value: String(item), title: String(item), raw: item }];
    const value = readDynamicPath(item, valuePath) ?? item.value ?? item.name ?? item.id;
    if (value === undefined || value === null) return [];
    const title = readDynamicPath(item, titlePath) ?? item.displayName ?? item.title ?? item.name;
    return [{ value: String(value), title: title === undefined || title === null ? String(value) : String(title), raw: item }];
  });
}

function readDynamicPath(source: unknown, path: string): unknown {
  if (!path) return undefined;
  const segments = path.split(/[/.]/).filter(Boolean);
  return segments.reduce((current, segment) => {
    if (!isRecord(current)) return undefined;
    return current[segment];
  }, source);
}

function apiNameFromId(apiId: string | undefined): string | undefined {
  if (!apiId) return undefined;
  const parts = apiId.split('/').filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase() === 'apis');
  return index >= 0 ? parts[index + 1] : parts[parts.length - 1];
}

function parseJsonMaybe(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeFlowValidationResult(kind: FlowValidationKind, raw: unknown): FlowValidationResult {
  return {
    kind,
    items: collectValidationItems(kind, raw).slice(0, 100),
    raw,
    checkedAt: new Date().toISOString(),
  };
}

function collectValidationItems(kind: FlowValidationKind, raw: unknown): FlowValidationItem[] {
  const items: FlowValidationItem[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (value == null || seen.has(value)) return;
    if (typeof value !== 'object') return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = value as Record<string, unknown>;
    const detail = parseServiceErrorDetail(record.detail);
    const message = detail?.message || firstString(record.message, record.errorMessage, record.localizedMessage, record.description, record.title);
    const code = firstString(record.code, record.ruleId, record.errorCode, record.name);
    if (message) {
      items.push({
        level: kind === 'errors' ? 'error' : 'warning',
        code: detail?.code || code,
        message,
        path: detail?.path || firstString(record.path, record.jsonPath, record.location, record.target),
        actionName: firstString(record.actionName, record.operationName, record.nodeName, record.target),
        operationMetadataId: firstString(record.operationMetadataId, record.anchor, record.nodeId),
        raw: record,
      });
    }

    for (const key of ['diagnostics', 'errors', 'warnings', 'value', 'details', 'innerErrors', 'issues'] as const) {
      if (record[key] !== undefined) visit(record[key]);
    }
  };
  visit(raw);
  return items;
}

function parseServiceErrorDetail(value: unknown): { code?: string; message?: string; path?: string } | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    const path = extractQuotedPath(value);
    return { message: value, path };
  }
  const error = prop(parsed, 'error') || parsed;
  const message = firstString(prop(error, 'message'), prop(error, 'ExceptionMessage'), prop(parsed, 'message'));
  return {
    code: firstString(prop(error, 'code'), prop(error, 'ErrorCode'), prop(parsed, 'code')),
    message,
    path: message ? extractQuotedPath(message) : undefined,
  };
}

function extractQuotedPath(value: string) {
  const match = value.match(/Path '([^']+)'/);
  return match?.[1];
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
