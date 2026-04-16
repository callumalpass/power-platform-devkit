import { api, prop } from './utils.js';
import type { ApiEnvelope, ApiExecuteResponse, FlowAction, FlowAnalysis, FlowItem, FlowRun } from './ui-types.js';

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
  const result = await executeRequest<unknown>(
    environment,
    'flow',
    `/flows/${flowIdentifier(flow)}/${suffix}`,
    true,
    'POST',
    buildFlowServicePayload(source),
  );
  return normalizeFlowValidationResult(kind, result.response);
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
    const message = firstString(record.message, record.errorMessage, record.localizedMessage, record.description, record.title);
    const code = firstString(record.code, record.ruleId, record.errorCode, record.name);
    if (message) {
      items.push({
        level: kind === 'errors' ? 'error' : 'warning',
        code,
        message,
        path: firstString(record.path, record.jsonPath, record.location, record.target),
        actionName: firstString(record.actionName, record.operationName, record.nodeName, record.target),
        operationMetadataId: firstString(record.operationMetadataId, record.anchor, record.nodeId),
        raw: record,
      });
    }

    for (const key of ['errors', 'warnings', 'value', 'details', 'innerErrors', 'issues'] as const) {
      if (record[key] !== undefined) visit(record[key]);
    }
  };
  visit(raw);
  return items;
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
