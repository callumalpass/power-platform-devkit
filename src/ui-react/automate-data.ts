import { ApiRequestError, api, prop } from './utils.js';
import type {
  ApiEnvelope,
  ApiExecuteResponse,
  FlowAction,
  FlowAnalysis,
  FlowApiOperation,
  FlowApiOperationKind,
  FlowApiOperationResponseSchema,
  FlowApiOperationSchema,
  FlowApiOperationSchemaField,
  FlowDynamicValueOption,
  FlowItem,
  FlowRun
} from './ui-types.js';
import type { FlowEnvironmentConnection } from './automate/flow-connections.js';

const DATAVERSE_FLOW_FALLBACK_PATH =
  '/workflows?$filter=category eq 5&$select=name,workflowid,workflowidunique,createdon,modifiedon,statecode,statuscode,_ownerid_value,description,clientdata&$orderby=modifiedon desc&$top=200';
const CONNECTIONS_FOR_ENVIRONMENT_PATH = '/connections?$filter=environment%20eq%20%27{environment}%27';

const connectionNameCache = new Map<string, Promise<Map<string, string>>>();

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

export type FlowCallbackUrlResult = {
  value: string;
  kind: 'signed' | 'authenticated';
  raw: unknown;
};

export type FlowLifecycleRequest = {
  api: 'dv' | 'flow';
  method: 'PATCH' | 'POST';
  path: string;
  body?: Record<string, unknown>;
  responseType?: 'json' | 'text' | 'void';
};

export async function loadFlowList(environment: string): Promise<FlowListResult> {
  try {
    const result = await executeRequest<{ value?: unknown[] }>(environment, 'flow', '/flows', false);
    return {
      flows: (result.response?.value || []).map(normalizeFlowApiItem),
      source: 'flow',
      usedFallback: false
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
    body: JSON.stringify({ source, cursor })
  });
  return payload.data;
}

export async function checkFlowDefinition(environment: string, flow: FlowItem, source: string, kind: FlowValidationKind): Promise<FlowValidationResult> {
  const suffix = kind === 'errors' ? 'checkFlowErrors' : 'checkFlowWarnings';
  const flowId = flowWorkflowId(flow) || flowIdentifier(flow);
  try {
    const result = await executeRequest<unknown>(environment, 'flow', `/flows/${flowId}/${suffix}`, true, 'POST', buildFlowServicePayload(source));
    return normalizeFlowValidationResult(kind, result.response);
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return normalizeFlowValidationResult(kind, error.data);
    }
    throw error;
  }
}

export function flowValidationFromError(kind: FlowValidationKind, error: unknown): FlowValidationResult {
  if (error instanceof ApiRequestError) {
    const result = normalizeFlowValidationResult(kind, error.data);
    if (result.items.length) return result;
    return {
      ...result,
      items: [
        {
          level: 'error',
          code: `HTTP_${error.status}`,
          message: error.message,
          raw: error.data
        }
      ]
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return normalizeFlowValidationResult(kind, {
    error: {
      code: error instanceof Error ? error.name : undefined,
      message
    }
  });
}

export async function saveFlowDefinition(environment: string, flow: FlowItem, source: string): Promise<FlowItem> {
  const flowId = flowWorkflowId(flow) || flowIdentifier(flow);
  const result = await executeRequest<unknown>(
    environment,
    'flow',
    `/flows/${flowId}?$expand=properties.connectionreferences.apidefinition,properties.definitionsummary.operations.apioperation,operationDefinition,plan,properties.throttleData,properties.estimatedsuspensiondata,properties.powerFlowType`,
    true,
    'PATCH',
    {
      ...buildFlowServicePayload(source),
      telemetryMetadata: { modifiedSources: 'pp-desktop' }
    }
  );
  return normalizeFlowApiItem(result.response || flow);
}

export async function loadFlowCallbackUrl(environment: string, flow: FlowItem, source = ''): Promise<FlowCallbackUrlResult> {
  const existing = extractFlowCallbackUrl(flow);
  if (existing) return flowTriggerUrlResult(existing, flow);
  const sourcePayload = parseJsonMaybe(source);
  const sourceValue = extractFlowCallbackUrl(sourcePayload);
  if (sourceValue) return flowTriggerUrlResult(sourceValue, sourcePayload);
  const triggerNames = flowCallbackTriggerNames(flow, source);
  const flowIds = uniqueStrings([flowRuntimeId(flow), flowWorkflowId(flow), flowIdentifier(flow)]);
  const attempts = flowIds.flatMap((flowId) => [
    ...triggerNames.map((triggerName) => ({
      label: `trigger ${triggerName}`,
      path: `/flows/${flowId}/triggers/${encodeURIComponent(triggerName)}/listCallbackUrl`,
      query: { 'api-version': '1' }
    })),
    {
      label: 'flow callback',
      path: `/flows/${flowId}/listCallbackUrl`,
      query: { 'api-version': '1' }
    }
  ]);
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const result = await executeRequest<unknown>(environment, 'flow', attempt.path, true, 'POST', undefined, attempt.query);
      const value = extractFlowCallbackUrl(result.response);
      if (value) return flowTriggerUrlResult(value, result.response);
      errors.push(`${attempt.label}: response did not include a URL`);
    } catch (error) {
      errors.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(errors.length ? `Could not load flow callback URL. ${errors.join(' ')}` : 'Could not load flow callback URL.');
}

export function extractFlowCallbackUrl(response: unknown): string {
  for (const candidate of [prop(response, 'response.value'), prop(response, 'value'), prop(response, 'properties.flowTriggerUri'), prop(response, 'flowTriggerUri')]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return '';
}

export function flowRunTriggerNames(flow: FlowItem, source = ''): string[] {
  const names = flowDefinitionTriggerNames(flow, source);
  const triggerName = flowTriggerNameFromUrl(extractFlowCallbackUrl(flow) || extractFlowCallbackUrl(parseJsonMaybe(source)));
  if (triggerName && !names.includes(triggerName)) names.push(triggerName);
  return names.length ? names : ['manual'];
}

export function flowCallbackTriggerNames(flow: FlowItem, source = ''): string[] {
  const names = new Set(flowRunTriggerNames(flow, source));
  names.add('manual');
  return [...names];
}

function flowDefinitionTriggerNames(flow: FlowItem, source = ''): string[] {
  const names = new Set<string>();
  const addDefinition = (definition: unknown) => {
    const triggers = prop(definition, 'triggers');
    if (triggers && typeof triggers === 'object' && !Array.isArray(triggers)) {
      for (const name of Object.keys(triggers)) {
        if (name.trim()) names.add(name);
      }
    }
  };

  if (source.trim()) {
    try {
      const parsed = JSON.parse(source);
      addDefinition(prop(parsed, 'properties.definition') || prop(parsed, 'definition') || parsed);
    } catch {
      // Ignore invalid editor content. The service call below will surface the real outcome.
    }
  }
  addDefinition(prop(flow, 'properties.definition') || flow.definition);

  const summaryTriggers = prop(flow, 'properties.definitionSummary.triggers');
  if (Array.isArray(summaryTriggers)) {
    for (const trigger of summaryTriggers) {
      const name = prop(trigger, 'name');
      if (typeof name === 'string' && name.trim()) names.add(name);
    }
  }

  return [...names];
}

function flowTriggerNameFromUrl(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    const triggerIndex = parts.findIndex((part) => part.toLowerCase() === 'triggers');
    return triggerIndex >= 0 ? decodeURIComponent(parts[triggerIndex + 1] || '') : '';
  } catch {
    const match = value.match(/\/triggers\/([^/]+)\/run(?:[/?#]|$)/i);
    return match ? decodeURIComponent(match[1]) : '';
  }
}

function flowIdFromTriggerUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const pathValue = flowIdFromPath(value);
  if (pathValue) return pathValue;
  try {
    const url = new URL(value);
    return flowIdFromPath(url.pathname);
  } catch {
    const match = value.match(/\/flows\/([^/]+)\/triggers\//i);
    return match ? decodeURIComponent(match[1]) : undefined;
  }
}

function flowIdFromResourceId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return flowIdFromPath(trimmed) || (trimmed.includes('/') ? undefined : trimmed);
}

function flowIdFromPath(value: string): string | undefined {
  const path = value.split(/[?#]/, 1)[0];
  const parts = path.split('/').filter(Boolean);
  const flowIndex = parts.findIndex((part) => part.toLowerCase() === 'flows');
  return flowIndex >= 0 ? decodeURIComponent(parts[flowIndex + 1] || '') || undefined : undefined;
}

function flowTriggerUrlResult(value: string, raw: unknown): FlowCallbackUrlResult {
  return {
    value,
    kind: isSignedTriggerUrl(value) ? 'signed' : 'authenticated',
    raw
  };
}

function isSignedTriggerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.searchParams.has('sig') || url.searchParams.has('code') || url.searchParams.has('sp');
  } catch {
    return /\b(sig|code|sp)=/i.test(value);
  }
}

export async function loadFlowApiOperations(environment: string, search: string, kind: FlowApiOperationKind = 'action'): Promise<FlowApiOperation[]> {
  const result = await executeRequest<{ value?: unknown[] }>(environment, 'flow', '/operations?api-version=2016-11-01&$top=250', true, 'POST', buildFlowOperationSearchBody(search, kind));
  return (result.response?.value || []).map(normalizeFlowApiOperation);
}

export function buildFlowOperationSearchBody(search: string, kind: FlowApiOperationKind) {
  return {
    searchText: search.trim(),
    visibleHideKeys: [],
    allTagsToInclude: kind === 'trigger' ? ['Trigger'] : ['Action', 'Important'],
    anyTagsToExclude: kind === 'trigger' ? ['Deprecated', 'Agentic', 'Action'] : ['Deprecated', 'Agentic', 'Trigger']
  };
}

export async function loadFlowApiConnections(environment: string): Promise<FlowEnvironmentConnection[]> {
  const result = await executeRequest<{ value?: unknown[] }>(environment, 'powerapps', CONNECTIONS_FOR_ENVIRONMENT_PATH, true);
  const connections = (result.response?.value || []).map(normalizeFlowApiConnection).filter((connection) => connection.name);
  try {
    const refs = await loadSolutionConnectionReferences(environment);
    return mergeSolutionConnectionReferences(connections, refs);
  } catch {
    return connections;
  }
}

type SolutionConnectionReference = {
  id?: string;
  logicalName?: string;
  displayName?: string;
  connectorId?: string;
  connectionId?: string;
};

async function loadSolutionConnectionReferences(environment: string): Promise<SolutionConnectionReference[]> {
  const result = await executeRequest<{ value?: unknown[] }>(
    environment,
    'dv',
    '/connectionreferences?$select=connectionreferenceid,connectionreferencelogicalname,connectionreferencedisplayname,connectorid,connectionid',
    false
  );
  return (result.response?.value || []).map(normalizeSolutionConnectionReference).filter((reference) => reference.logicalName || reference.connectionId);
}

function mergeSolutionConnectionReferences(connections: FlowEnvironmentConnection[], references: SolutionConnectionReference[]): FlowEnvironmentConnection[] {
  if (!references.length) return connections;
  return connections.map((connection) => {
    const matches = references.filter((reference) => {
      return (
        normalizeConnectionName(reference.connectionId) === normalizeConnectionName(connection.name) ||
        normalizeConnectionName(reference.connectionId) === normalizeConnectionName(connectionNameFromId(connection.id)) ||
        Boolean(reference.connectionId && normalizeConnectionId(connection.id).endsWith(`/connections/${normalizeConnectionName(reference.connectionId)}`))
      );
    });
    if (!matches.length) return connection;
    return {
      ...connection,
      solutionReferences: matches.map((reference) => ({
        id: reference.id,
        logicalName: reference.logicalName,
        displayName: reference.displayName
      }))
    };
  });
}

export async function loadFlowApiOperationSchema(environment: string, apiRef: string | undefined, operationId: string): Promise<FlowApiOperationSchema | null> {
  const apiName = apiNameFromId(apiRef);
  if (!apiName || !operationId) return null;
  try {
    const detail = await executeRequest<Record<string, unknown>>(
      environment,
      'powerautomate',
      `/apis/${encodeURIComponent(apiName)}/apiOperations/${encodeURIComponent(operationId)}?$expand=properties%2FinputsDefinition,properties%2FresponsesDefinition,properties%2Fconnector`,
      true
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
  apiRef: string | undefined,
  connectionName: string | undefined,
  dynamicValues: unknown,
  parameters: Record<string, unknown>
): Promise<FlowDynamicValueOption[]> {
  if (!apiRef || !isRecord(dynamicValues)) return [];
  const resolvedConnectionName = await resolveFlowConnectionName(environment, apiRef, connectionName);
  if (!resolvedConnectionName) return [];
  const resolvedApiName = await resolveFlowApiName(environment, apiRef, resolvedConnectionName);
  if (!resolvedApiName) return [];
  const dynamicInvocationDefinition = normalizeDynamicInvocationDefinition(dynamicValues);
  if (!dynamicInvocationDefinition.operationId) return [];
  if (hasMissingRequiredDynamicParameters(dynamicInvocationDefinition, parameters)) return [];
  const result = await executeRequest<unknown>(
    environment,
    'powerautomate',
    `/apis/${encodeURIComponent(resolvedApiName)}/connections/${encodeURIComponent(resolvedConnectionName)}/listEnum`,
    true,
    'POST',
    {
      parameters: dynamicInvocationParameters(dynamicInvocationDefinition, parameters),
      dynamicInvocationDefinition
    }
  );
  return normalizeDynamicEnumOptions(result.response, dynamicInvocationDefinition);
}

export async function loadFlowDynamicProperties(
  environment: string,
  apiRef: string | undefined,
  connectionName: string | undefined,
  field: FlowApiOperationSchemaField,
  parameters: Record<string, unknown>,
  options: { location?: 'input' | 'output'; contextParameterAlias?: string } = {}
): Promise<FlowApiOperationSchemaField[]> {
  if (!apiRef || !isRecord(field.dynamicSchema)) return [];
  const resolvedConnectionName = await resolveFlowConnectionName(environment, apiRef, connectionName);
  if (!resolvedConnectionName) return [];
  const resolvedApiName = await resolveFlowApiName(environment, apiRef, resolvedConnectionName);
  if (!resolvedApiName) return [];
  const dynamicInvocationDefinition = normalizeDynamicInvocationDefinition(field.dynamicSchema);
  if (!dynamicInvocationDefinition.operationId || hasMissingRequiredDynamicParameters(dynamicInvocationDefinition, parameters)) return [];
  const result = await executeRequest<unknown>(
    environment,
    'powerautomate',
    `/apis/${encodeURIComponent(resolvedApiName)}/connections/${encodeURIComponent(resolvedConnectionName)}/listDynamicProperties`,
    true,
    'POST',
    {
      parameters: dynamicInvocationParameters(dynamicInvocationDefinition, parameters),
      contextParameterAlias: options.contextParameterAlias || field.name || 'body',
      dynamicInvocationDefinition,
      location: options.location || 'input'
    }
  );
  const schema = isRecord(result.response)
    ? result.response
    : isRecord(readDynamicPath(result.response, String(dynamicInvocationDefinition.itemValuePath || 'schema')))
      ? (readDynamicPath(result.response, String(dynamicInvocationDefinition.itemValuePath || 'schema')) as Record<string, unknown>)
      : undefined;
  return normalizeDynamicPropertiesSchema(field, schema);
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
    displayName: properties.displayName || root.name || root.displayName || 'Flow'
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
  const flowId = flowRuntimeId(flow) || flowWorkflowId(flow) || flowIdentifier(flow);
  const result = await executeRequest<{ value?: FlowRun[] }>(environment, 'flow', `/flows/${flowId}/runs?$top=20`);
  return result.response?.value || [];
}

export async function loadRunActions(environment: string, flow: FlowItem, run: FlowRun): Promise<FlowAction[]> {
  const flowId = flowRuntimeId(flow) || flowWorkflowId(flow) || flowIdentifier(flow);
  const result = await executeRequest<{ value?: FlowAction[] }>(environment, 'flow', `/flows/${flowId}/runs/${run.name}/actions`);
  return result.response?.value || [];
}

export async function loadRunDetail(environment: string, flow: FlowItem, run: FlowRun): Promise<FlowRun> {
  const flowId = flowRuntimeId(flow) || flowWorkflowId(flow) || flowIdentifier(flow);
  const result = await executeRequest<FlowRun>(environment, 'flow', `/flows/${flowId}/runs/${run.name}?$expand=properties/actions,properties/flow&include=repetitionCount&isMigrationSource=false`);
  return result.response || run;
}

export async function loadActionDetail(environment: string, flow: FlowItem, run: FlowRun, action: FlowAction): Promise<FlowAction> {
  const flowId = flowRuntimeId(flow) || flowWorkflowId(flow) || flowIdentifier(flow);
  const result = await executeRequest<FlowAction>(environment, 'flow', `/flows/${flowId}/runs/${run.name}/actions/${action.name}`);
  return result.response || action;
}

export async function setFlowActivationState(environment: string, flow: FlowItem, active: boolean): Promise<void> {
  const request = flowActivationRequest(flow, active);
  await executeRequest<unknown>(environment, request.api, request.path, true, request.method, request.body, undefined, request.responseType);
}

export function flowActivationRequest(flow: FlowItem, active: boolean): FlowLifecycleRequest {
  const workflowId = flowWorkflowId(flow);
  if (workflowId) {
    return {
      api: 'dv',
      method: 'PATCH',
      path: `/workflows(${workflowId})`,
      body: { statecode: active ? 1 : 0 },
      responseType: 'void'
    };
  }
  const runtimeId = flowRuntimeId(flow) || flowIdentifier(flow);
  if (!runtimeId) throw new Error('Flow id is not available.');
  return {
    api: 'flow',
    method: 'POST',
    path: `/flows/${runtimeId}/${active ? 'start' : 'stop'}`
  };
}

async function executeRequest<T>(
  environment: string,
  apiKind: string,
  path: string,
  allowInteractive = true,
  method = 'GET',
  body?: unknown,
  query?: Record<string, string>,
  responseType?: 'json' | 'text' | 'void'
) {
  const result = await api<ApiEnvelope<ApiExecuteResponse<T>>>('/api/request/execute', {
    method: 'POST',
    body: JSON.stringify({
      environment,
      api: apiKind,
      method,
      path,
      ...(query ? { query } : {}),
      allowInteractive,
      softFail: !allowInteractive,
      ...(responseType ? { responseType } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  });
  return result.data;
}

export function flowIdentifier(flow: FlowItem | null | undefined) {
  return (flow && (flowWorkflowId(flow) || flowRuntimeId(flow) || flow.name)) || '';
}

export function flowWorkflowId(flow: FlowItem | null | undefined): string {
  if (!flow) return '';
  return firstString(prop(flow, 'properties.workflowEntityId'), flow.workflowid, prop(flow, 'workflowEntityId'), prop(flow, 'properties.workflowid')) || '';
}

export function flowRuntimeId(flow: FlowItem | null | undefined): string {
  if (!flow) return '';
  return (
    firstString(
      flowIdFromResourceId(prop(flow, 'properties.resourceId')),
      flowIdFromResourceId(prop(flow, 'resourceId')),
      flowIdFromTriggerUrl(extractFlowCallbackUrl(flow)),
      flow.source === 'flow' ? flow.name : undefined
    ) || ''
  );
}

export function flowIdentityKeys(flow: FlowItem | null | undefined): string[] {
  if (!flow) return [];
  return uniqueStrings([flowWorkflowId(flow), flowRuntimeId(flow), flow.name, flow.id, prop(flow, 'properties.workflowUniqueId'), prop(flow, 'properties.flowTriggerUri')]);
}

export function sameFlowIdentity(left: FlowItem | null | undefined, right: FlowItem | null | undefined): boolean {
  const leftKeys = new Set(flowIdentityKeys(left));
  if (!leftKeys.size) return false;
  return flowIdentityKeys(right).some((key) => leftKeys.has(key));
}

export function buildFlowDocument(detail: FlowItem | Record<string, unknown>) {
  const definition = prop(detail, 'properties.definition') || (detail as FlowItem).definition || detail;
  const connectionReferences = prop(detail, 'properties.connectionReferences');
  if (definition && typeof definition === 'object') {
    return JSON.stringify(
      {
        name: (detail as FlowItem).name,
        id: (detail as FlowItem).id || (detail as FlowItem).workflowid,
        type: (detail as FlowItem).type,
        properties: {
          displayName: prop(detail, 'properties.displayName'),
          state: prop(detail, 'properties.state'),
          flowTriggerUri: prop(detail, 'properties.flowTriggerUri'),
          connectionReferences,
          definition
        }
      },
      null,
      2
    );
  }
  if (typeof definition === 'string') return definition;
  return JSON.stringify(detail || {}, null, 2);
}

function normalizeFlowApiItem(value: unknown): FlowItem {
  const flow = value as FlowItem;
  const workflowEntityId = firstString(prop(flow, 'properties.workflowEntityId'), flow.workflowid);
  const resourceId = firstString(
    flowIdFromResourceId(prop(flow, 'properties.resourceId')),
    flowIdFromResourceId(prop(flow, 'properties.resourceid')),
    flowIdFromTriggerUrl(prop(flow, 'properties.flowTriggerUri'))
  );
  return {
    ...flow,
    source: 'flow',
    workflowid: workflowEntityId,
    properties: {
      ...(flow.properties || {}),
      displayName: prop(flow, 'properties.displayName') || flow.name || 'Unnamed',
      definition: prop(flow, 'properties.definition'),
      connectionReferences: prop(flow, 'properties.connectionReferences'),
      installedConnectionReferences: prop(flow, 'properties.installedConnectionReferences'),
      ...(workflowEntityId ? { workflowEntityId } : {}),
      ...(resourceId ? { resourceId } : {})
    }
  };
}

export function normalizeDataverseFlow(value: unknown): FlowItem {
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
      state: flow.statecode === 1 ? 'Started' : flow.statecode === 0 ? 'Stopped' : 'Unknown',
      createdTime: typeof flow.createdon === 'string' ? flow.createdon : undefined,
      lastModifiedTime: typeof flow.modifiedon === 'string' ? flow.modifiedon : undefined,
      creator: { objectId: String(flow._ownerid_value || '') },
      workflowEntityId: String(flow.workflowid || ''),
      workflowUniqueId: typeof flow.workflowidunique === 'string' ? flow.workflowidunique : undefined,
      definition,
      connectionReferences: prop(clientData, 'properties.connectionReferences') || {},
      definitionSummary: {
        triggers: triggerEntries.map(([name, item]) => ({ name, type: String(prop(item, 'type') || '-') })),
        actions: actionEntries.map(([name, item]) => ({ name, type: String(prop(item, 'type') || '-') }))
      }
    }
  };
}

function normalizeFlowApiOperation(value: unknown): FlowApiOperation {
  const operation = value as Record<string, unknown>;
  const properties = isRecord(operation.properties) ? operation.properties : {};
  const api = firstRecord(properties.api, properties.apiDefinition, properties.operationGroup, operation.api, operation.apiDefinition, operation.operationGroup, prop(operation, 'operation.api'));
  const name = firstString(operation.name, properties.name, operation.operationId, properties.operationId, prop(operation, 'apiOperation.name')) || '';
  const apiName = firstString(api.apiName, api.name, properties.apiName, operation.apiName);
  const apiDisplayName = firstString(api.displayName, api.apiDisplayName, properties.apiDisplayName, operation.apiDisplayName);
  const operationType = firstString(properties.operationType, operation.operationType, properties.type, operation.type);
  const tagsValue = properties.tags ?? operation.tags;
  const tags = Array.isArray(tagsValue) ? tagsValue.map((item) => String(item)) : [];
  const isBuiltIn = api.isBuiltIn === true || tags.includes('BuiltIn');
  const rawApiId = firstString(api.id, properties.apiId, operation.apiId);
  const apiId = normalizeOperationApiId(rawApiId, apiName);
  const needsConnectionReference =
    !isBuiltIn && Boolean(apiName && (tags.includes('Api') || tags.includes('OpenApi') || operationType === 'OpenApiConnection' || operationType === 'ApiConnection' || rawApiId));
  const hasConnectorSchema = operationType === 'OpenApiConnection' || operationType === 'ApiConnection';
  return {
    name,
    id: firstString(operation.id, properties.id),
    summary: firstString(properties.summary, operation.summary, properties.displayName, operation.displayName, name),
    description: firstString(properties.description, operation.description),
    operationType,
    apiId,
    apiName,
    apiDisplayName,
    iconUri: firstString(api.iconUri, api.iconUriValue, properties.iconUri, operation.iconUri),
    isBuiltIn,
    hasConnectorSchema,
    needsConnectionReference,
    groupName: firstString(api.name),
    raw: value
  };
}

function normalizeOperationApiId(value: string | undefined, apiName: string | undefined): string | undefined {
  if (!value) return apiName && apiName.startsWith('shared_') ? `/providers/Microsoft.PowerApps/apis/${apiName}` : value;
  if (apiName && value.toLowerCase().includes('/operationgroups/')) return `/providers/Microsoft.PowerApps/apis/${apiName}`;
  return value;
}

function normalizeFlowApiConnection(value: unknown): FlowEnvironmentConnection {
  const connection = value as Record<string, unknown>;
  const apiId = firstString(prop(connection, 'properties.apiId'), prop(connection, 'properties.api.id'), prop(connection, 'apiId'));
  return {
    name: firstString(connection.name, connectionNameFromId(connection.id)) || '',
    id: firstString(connection.id),
    apiId,
    apiName: firstString(prop(connection, 'properties.apiName'), prop(connection, 'properties.api.name'), apiNameFromId(apiId)),
    displayName: firstString(prop(connection, 'properties.displayName'), connection.displayName),
    status: firstString(prop(connection, 'properties.statuses.0.status'), prop(connection, 'properties.overallStatus')),
    raw: value
  };
}

function normalizeSolutionConnectionReference(value: unknown): SolutionConnectionReference {
  const reference = value as Record<string, unknown>;
  return {
    id: firstString(reference.connectionreferenceid, reference.id),
    logicalName: firstString(reference.connectionreferencelogicalname, prop(reference, 'properties.connectionreferencelogicalname')),
    displayName: firstString(reference.connectionreferencedisplayname, prop(reference, 'properties.connectionreferencedisplayname')),
    connectorId: firstString(reference.connectorid, prop(reference, 'properties.connectorid')),
    connectionId: firstString(reference.connectionid, prop(reference, 'properties.connectionid'))
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

export function normalizeFlowApiOperationSchema(apiName: string, apiId: string | undefined, operationId: string, rawApi: unknown): FlowApiOperationSchema | null {
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
      responses: normalizeOperationResponses(operationDetail, swagger),
      raw: operationDetail
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
        responses: normalizeOperationResponses(methodValue, swagger),
        raw: methodValue
      };
    }
  }
  return null;
}

function findOperationDetailCandidate(api: Record<string, unknown>, operationId: string): Record<string, unknown> | null {
  const candidates = [prop(api, 'properties.apiOperation'), prop(api, 'properties.operation'), prop(api, 'properties.inputsDefinition'), prop(api, 'properties'), prop(api, 'apiOperation'), api];
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
    prop(operation, 'properties.inputsDefinition.inputs')
  ]) {
    if (Array.isArray(value)) return value;
    if (isRecord(value)) return Object.entries(value).map(([name, parameter]) => (isRecord(parameter) ? { name, ...parameter } : { name, schema: parameter }));
  }
  return [];
}

function normalizeOperationResponses(operation: Record<string, unknown>, swagger: Record<string, unknown>): FlowApiOperationResponseSchema[] {
  const responseMap = firstRecordOrUndefined(prop(operation, 'properties.responsesDefinition'), operation.responsesDefinition, prop(operation, 'properties.responses'), operation.responses);
  if (!responseMap) return [];
  return Object.entries(responseMap).flatMap(([statusCode, response]) => {
    const schema = normalizeResponseSchema(response, swagger);
    if (!schema) return [];
    return [
      {
        statusCode,
        schema,
        bodySchema: responseBodySchema(schema, swagger)
      }
    ];
  });
}

function normalizeResponseSchema(response: unknown, swagger: Record<string, unknown>): unknown {
  if (!isRecord(response)) return undefined;
  const schema = isRecord(response.schema) ? response.schema : isRecord(prop(response, 'properties.schema')) ? prop(response, 'properties.schema') : response;
  return resolveSwaggerSchemaDeep(schema, swagger);
}

function responseBodySchema(schema: unknown, swagger: Record<string, unknown>): unknown {
  if (!isRecord(schema)) return undefined;
  const body = prop(schema, 'properties.body');
  return isRecord(body) ? resolveSwaggerSchemaDeep(body, swagger) : undefined;
}

function normalizeOperationDefinitionFields(operation: Record<string, unknown>, swagger: Record<string, unknown>): FlowApiOperationSchemaField[] {
  const inputsDefinition = firstRecordOrUndefined(prop(operation, 'properties.inputsDefinition'), operation.inputsDefinition, operation);
  if (!inputsDefinition) return [];
  const candidates = [
    prop(inputsDefinition, 'schema.properties.parameters'),
    prop(inputsDefinition, 'properties.parameters.properties'),
    prop(inputsDefinition, 'parameters.properties'),
    prop(inputsDefinition, 'parameters'),
    prop(inputsDefinition, 'schema.properties.body.properties'),
    prop(inputsDefinition, 'properties.body.properties'),
    prop(inputsDefinition, 'body.properties'),
    prop(inputsDefinition, 'properties')
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
  location = 'parameter'
): FlowApiOperationSchemaField[] {
  const schema = resolveSwaggerSchema(schemaValue, swagger) || schemaValue;
  const enumValues = Array.isArray(schema.enum) ? schema.enum.map(String) : undefined;
  const field: FlowApiOperationSchemaField = {
    name,
    location,
    path,
    required: required.has(name),
    type: typeof schema.type === 'string' ? schema.type : undefined,
    title: firstString(schema['x-ms-summary'], schema.title),
    description: typeof schema.description === 'string' ? schema.description : undefined,
    enum: enumValues,
    defaultValue: schema.default,
    schema,
    dynamicValues: schema['x-ms-dynamic-values'] || schema['x-ms-dynamic-list'],
    dynamicSchema: schema['x-ms-dynamic-schema'] || schema['x-ms-dynamic-properties'],
    visibility: firstString(schema['x-ms-visibility'])
  };
  return [field, ...normalizeBodySchemaProperties(field, schema, swagger)];
}

function normalizeDynamicPropertiesSchema(parent: FlowApiOperationSchemaField, schema: Record<string, unknown> | undefined): FlowApiOperationSchemaField[] {
  if (!schema || !isRecord(schema.properties)) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const parentPath = parent.path?.length ? parent.path : ['inputs', 'parameters', parent.name || 'body'];
  return Object.entries(schema.properties)
    .filter(([, value]) => isRecord(value))
    .flatMap(([name, value]) => normalizeSchemaPropertyField(name, value as Record<string, unknown>, required, {}, [...parentPath, name], parent.location || 'parameter'));
}

function requiredSetForDefinition(definition: Record<string, unknown>, candidate: Record<string, unknown>): Set<string> {
  for (const value of [definition.required, prop(definition, 'schema.required'), prop(definition, 'properties.parameters.required'), prop(definition, 'parameters.required')]) {
    if (Array.isArray(value)) return new Set(value.map(String));
  }
  return new Set(
    Object.entries(candidate)
      .filter(([, value]) => isRecord(value) && value.required === true)
      .map(([name]) => name)
  );
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
    dynamicSchema: value['x-ms-dynamic-schema'] || value['x-ms-dynamic-properties'] || schema?.['x-ms-dynamic-schema'] || schema?.['x-ms-dynamic-properties'],
    visibility: firstString(value['x-ms-visibility'], schema?.['x-ms-visibility'])
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
      dynamicSchema: childSchema?.['x-ms-dynamic-schema'] || childSchema?.['x-ms-dynamic-properties'],
      visibility: firstString(childSchema?.['x-ms-visibility'], parent.visibility)
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
  const { $ref: _ref, ...rest } = schema;
  return { ...resolveSwaggerSchema(resolved, swagger), ...rest };
}

function resolveSwaggerSchemaDeep(schema: unknown, swagger: Record<string, unknown>, seen = new Set<string>()): unknown {
  if (!isRecord(schema)) return schema;
  const ref = typeof schema.$ref === 'string' ? schema.$ref : '';
  let resolved = schema;
  if (ref.startsWith('#/') && !seen.has(ref)) {
    const target = readJsonPointer(swagger, ref.slice(2));
    if (isRecord(target)) {
      seen.add(ref);
      const { $ref: _ref, ...rest } = schema;
      resolved = {
        ...(resolveSwaggerSchemaDeep(target, swagger, seen) as Record<string, unknown>),
        ...rest
      };
      seen.delete(ref);
    }
  }

  const next: Record<string, unknown> = { ...resolved };
  if (isRecord(next.properties)) {
    next.properties = Object.fromEntries(Object.entries(next.properties).map(([key, value]) => [key, resolveSwaggerSchemaDeep(value, swagger, seen)]));
  }
  if (isRecord(next.items)) {
    next.items = resolveSwaggerSchemaDeep(next.items, swagger, seen);
  }
  if (isRecord(next.additionalProperties)) {
    next.additionalProperties = resolveSwaggerSchemaDeep(next.additionalProperties, swagger, seen);
  }
  return next;
}

function readJsonPointer(source: unknown, pointer: string): unknown {
  return pointer.split('/').reduce((current, rawSegment) => {
    if (!isRecord(current)) return undefined;
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    return current[segment];
  }, source);
}

async function resolveFlowConnectionName(environment: string, apiName: string, preferredConnectionName: string | undefined): Promise<string | undefined> {
  if (preferredConnectionName) return preferredConnectionName;
  const key = environment;
  let cached = connectionNameCache.get(key);
  if (!cached) {
    cached = loadConnectionNamesByApi(environment);
    connectionNameCache.set(key, cached);
  }
  const connections = await cached;
  for (const alias of apiNameAliases(apiName)) {
    const match = connections.get(alias);
    if (match) return match;
  }
  return undefined;
}

async function resolveFlowApiName(environment: string, apiRef: string, connectionName: string | undefined): Promise<string | undefined> {
  const direct = apiNameFromId(apiRef) || apiRef;
  if (!connectionName) return direct;
  const connections = await loadFlowApiConnections(environment);
  const connection = connections.find((item) => item.name === connectionName || connectionNameFromId(item.id) === connectionName);
  return apiNameFromId(connection?.apiId) || connection?.apiName || direct;
}

async function loadConnectionNamesByApi(environment: string): Promise<Map<string, string>> {
  const connections = await loadFlowApiConnections(environment);
  const result = new Map<string, string>();
  for (const connection of connections) {
    const names = [connection.apiName, apiNameFromId(connection.apiId), connection.apiId].filter((value): value is string => Boolean(value));
    for (const name of names) {
      const normalized = apiNameFromId(name) || name;
      for (const alias of apiNameAliases(normalized)) {
        if (!result.has(alias)) result.set(alias, connection.name);
      }
    }
  }
  return result;
}

function apiNameAliases(value: string): string[] {
  const normalized = (apiNameFromId(value) || value).toLowerCase();
  if (!normalized) return [];
  const aliases = new Set([normalized]);
  if (normalized.startsWith('shared_')) aliases.add(normalized.slice('shared_'.length));
  else aliases.add(`shared_${normalized}`);
  return [...aliases];
}

function normalizeDynamicInvocationDefinition(source: Record<string, unknown>): Record<string, unknown> {
  const operationId = firstString(source.operationId, source.operation, source.name);
  const parameters = normalizeDynamicInvocationParameterDefinitions(source.parameters);
  const result: Record<string, unknown> = {
    ...(operationId ? { operationId } : {}),
    parameters
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
    result[name] = reference ? { ...raw, parameterReference: reference } : raw;
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

function hasMissingRequiredDynamicParameters(definition: Record<string, unknown>, currentParameters: Record<string, unknown>): boolean {
  const parameterDefinitions = isRecord(definition.parameters) ? definition.parameters : {};
  return Object.entries(parameterDefinitions).some(([name, raw]) => {
    if (!isRecord(raw) || raw.required !== true) return false;
    const parameterReference = firstString(raw.parameterReference, raw.parameter, raw.name);
    const sourceName = parameterReference || name;
    return (
      !Object.prototype.hasOwnProperty.call(currentParameters, sourceName) ||
      currentParameters[sourceName] === '' ||
      currentParameters[sourceName] === undefined ||
      currentParameters[sourceName] === null
    );
  });
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

function connectionNameFromId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split('/').filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase() === 'connections');
  return index >= 0 ? parts[index + 1] : undefined;
}

function normalizeConnectionName(value: unknown): string {
  return firstString(value)?.toLowerCase() || '';
}

function normalizeConnectionId(value: unknown): string {
  return firstString(value)?.toLowerCase() || '';
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
    checkedAt: new Date().toISOString()
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
    const fixInstructions = isRecord(record.fixInstructions) ? record.fixInstructions : {};
    const message =
      detail?.message ||
      firstString(record.errorDescription, record.message, record.errorMessage, record.localizedMessage, record.description, record.title, fixInstructions.markdownText, fixInstructions.textTemplate);
    const code = firstString(record.code, record.ruleId, record.errorCode, record.name);
    if (message) {
      items.push({
        level: kind === 'errors' ? 'error' : 'warning',
        code: detail?.code || code,
        message,
        path: detail?.path || firstString(record.path, record.jsonPath, record.location, record.target),
        actionName: firstString(record.actionName, record.operationName, record.nodeName, record.target),
        operationMetadataId: firstString(record.operationMetadataId, record.anchor, record.nodeId),
        raw: record
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
  const extendedMessage = firstString(prop(error, 'extendedData.message'), prop(parsed, 'extendedData.message'));
  const detailCode = extractDetailsCode(message) || extractDetailsCode(extendedMessage);
  return {
    code: firstString(detailCode, prop(error, 'code'), prop(error, 'ErrorCode'), prop(error, 'extendedData.code'), prop(parsed, 'code')),
    message: firstString(message, extendedMessage),
    path: message ? extractQuotedPath(message) : undefined
  };
}

function extractQuotedPath(value: string) {
  const match = value.match(/Path '([^']+)'/);
  return match?.[1];
}

function extractDetailsCode(value: string | undefined) {
  const match = value?.match(/details\s+["']([^"']+)["']/i);
  return match?.[1];
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
