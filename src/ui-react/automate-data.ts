import { api, prop } from './utils.js';
import type { ApiEnvelope, ApiExecuteResponse, FlowAction, FlowAnalysis, FlowItem, FlowRun } from './ui-types.js';

const DATAVERSE_FLOW_FALLBACK_PATH = "/workflows?$filter=category eq 5&$select=name,workflowid,createdon,modifiedon,statecode,statuscode,_ownerid_value,description,clientdata&$orderby=modifiedon desc&$top=200";

export type FlowListResult = {
  flows: FlowItem[];
  source: 'flow' | 'dv';
  usedFallback: boolean;
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

export async function analyzeFlowDocument(source: string): Promise<FlowAnalysis> {
  const payload = await api<ApiEnvelope<FlowAnalysis>>('/api/flow/language/analyze', {
    method: 'POST',
    body: JSON.stringify({ source, cursor: source.length }),
  });
  return payload.data;
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

async function executeRequest<T>(environment: string, apiKind: string, path: string, allowInteractive = true) {
  const result = await api<ApiEnvelope<ApiExecuteResponse<T>>>('/api/request/execute', {
    method: 'POST',
    body: JSON.stringify({ environment, api: apiKind, method: 'GET', path, allowInteractive }),
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
