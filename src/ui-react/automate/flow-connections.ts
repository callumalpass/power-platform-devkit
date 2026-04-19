import { prop } from '../utils.js';
import type { FlowApiOperation } from '../ui-types.js';

export type FlowEnvironmentConnection = {
  name: string;
  id?: string;
  displayName?: string;
  apiName?: string;
  apiId?: string;
  status?: string;
  solutionReferences?: Array<{
    id?: string;
    logicalName?: string;
    displayName?: string;
  }>;
  raw?: unknown;
};

export type FlowConnectionIssue = {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  referenceName?: string;
  actionName?: string;
  path?: string;
};

export type FlowConnectionUsage = {
  name: string;
  kind: 'action' | 'trigger';
  path: string;
  actionType?: string;
  operationId?: string;
  apiName?: string;
  apiId?: string;
  referenceName?: string;
};

export type FlowConnectionReferenceStatus =
  | 'bound'
  | 'logical'
  | 'unbound'
  | 'missing-connection'
  | 'wrong-connector'
  | 'unused';

export type FlowConnectionReference = {
  name: string;
  apiName?: string;
  apiId?: string;
  apiDisplayName?: string;
  connectionName?: string;
  connectionId?: string;
  logicalName?: string;
  runtimeSource?: string;
  raw: unknown;
  connection?: FlowEnvironmentConnection;
  usages: FlowConnectionUsage[];
  status: FlowConnectionReferenceStatus;
  issues: FlowConnectionIssue[];
};

export type FlowConnectionModel = {
  references: FlowConnectionReference[];
  usages: FlowConnectionUsage[];
  issues: FlowConnectionIssue[];
  connections: FlowEnvironmentConnection[];
  unusedConnections: FlowEnvironmentConnection[];
};

type MutableJson = Record<string, unknown>;

type ParsedFlowRoot = {
  root: MutableJson;
  properties: MutableJson;
  definition: MutableJson | null;
};

export function buildFlowConnectionModel(source: string, connections: FlowEnvironmentConnection[]): FlowConnectionModel {
  const parsed = parseFlowRoot(source);
  if (!parsed) {
    return { references: [], usages: [], issues: [], connections, unusedConnections: connections };
  }

  const referenceMap = readConnectionReferences(parsed);
  const usages = collectConnectionUsages(parsed.definition);
  const issues: FlowConnectionIssue[] = [];

  for (const usage of usages) {
    if (!usage.referenceName) {
      issues.push({
        level: 'error',
        code: 'CONNECTION_REFERENCE_MISSING',
        message: `${usage.name} uses a connector but does not name a connection reference.`,
        actionName: usage.name,
        path: usage.path,
      });
      continue;
    }
    const reference = referenceMap.get(usage.referenceName);
    if (!reference) {
      issues.push({
        level: 'error',
        code: 'CONNECTION_REFERENCE_NOT_FOUND',
        message: `${usage.name} uses missing connection reference ${usage.referenceName}.`,
        referenceName: usage.referenceName,
        actionName: usage.name,
        path: usage.path,
      });
      continue;
    }
    reference.usages.push(usage);
    if (!apisCompatible(reference, usage)) {
      reference.issues.push({
        level: 'error',
        code: 'CONNECTION_REFERENCE_API_MISMATCH',
        message: `${usage.name} expects ${apiLabel(usage)}, but ${reference.name} is ${apiLabel(reference)}.`,
        referenceName: reference.name,
        actionName: usage.name,
        path: usage.path,
      });
    }
  }

  const matchedConnectionNames = new Set<string>();
  for (const reference of referenceMap.values()) {
    reference.connection = findConnectionForReference(reference, connections);
    if (reference.connection?.name) matchedConnectionNames.add(reference.connection.name);

    if (reference.connection && !apisCompatible(reference, reference.connection)) {
      reference.status = 'wrong-connector';
      reference.issues.push({
        level: 'error',
        code: 'CONNECTION_API_MISMATCH',
        message: `${reference.name} is for ${apiLabel(reference)}, but the bound connection is ${apiLabel(reference.connection)}.`,
        referenceName: reference.name,
      });
    } else if (reference.connection) {
      reference.status = 'bound';
    } else if (reference.connectionName || reference.connectionId) {
      reference.status = 'missing-connection';
      reference.issues.push({
        level: reference.usages.length ? 'error' : 'warning',
        code: 'CONNECTION_NOT_FOUND',
        message: `${reference.name} points at a connection that was not found in this environment.`,
        referenceName: reference.name,
      });
    } else if (reference.logicalName) {
      reference.status = 'logical';
      reference.issues.push({
        level: 'info',
        code: 'CONNECTION_REFERENCE_LOGICAL',
        message: `${reference.name} is bound through solution reference ${reference.logicalName}; no concrete environment connection was returned.`,
        referenceName: reference.name,
      });
    } else if (reference.usages.length) {
      reference.status = 'unbound';
      reference.issues.push({
        level: 'error',
        code: 'CONNECTION_REFERENCE_UNBOUND',
        message: `${reference.name} is used but has no bound connection.`,
        referenceName: reference.name,
      });
    } else {
      reference.status = 'unused';
    }

    if (!reference.usages.length) {
      reference.status = reference.status === 'bound' ? 'unused' : reference.status;
      reference.issues.push({
        level: 'info',
        code: 'CONNECTION_REFERENCE_UNUSED',
        message: `${reference.name} is not used by any connector action or trigger.`,
        referenceName: reference.name,
      });
    }

    issues.push(...reference.issues);
  }

  const references = [...referenceMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const unusedConnections = connections.filter((connection) => !matchedConnectionNames.has(connection.name));
  return { references, usages, issues, connections, unusedConnections };
}

export function compatibleConnectionReferences(model: FlowConnectionModel, operation: Pick<FlowApiOperation, 'apiId' | 'apiName'>): FlowConnectionReference[] {
  return model.references.filter((reference) => apisCompatible(reference, operation));
}

export function compatibleEnvironmentConnections(model: FlowConnectionModel, apiNameOrId: string | undefined): FlowEnvironmentConnection[] {
  if (!apiNameOrId) return model.connections;
  const api = apiDescriptorFromNameOrId(apiNameOrId);
  return model.connections.filter((connection) => apisCompatible(connection, api));
}

export function defaultReferenceNameForConnection(source: string, connection: FlowEnvironmentConnection | undefined): string {
  const base = sanitizeReferenceName(connection?.apiName || apiNameFromId(connection?.apiId) || 'shared_connector');
  let candidate = base;
  const existing = new Set(buildFlowConnectionModel(source, []).references.map((reference) => reference.name));
  for (let index = 2; existing.has(candidate); index += 1) candidate = `${base}_${index}`;
  return candidate;
}

export function setFlowConnectionReference(source: string, referenceName: string, connection: FlowEnvironmentConnection): string {
  const parsed = parseFlowRoot(source, true);
  if (!parsed) throw new Error('Flow definition JSON must be an object.');
  const name = sanitizeReferenceName(referenceName);
  if (!name) throw new Error('Connection reference name is required.');
  const refs = ensureObject(parsed.properties, 'connectionReferences');
  const existing = isObject(refs[name]) ? refs[name] as MutableJson : {};
  refs[name] = buildConnectionReferenceValue(existing, connection);
  return JSON.stringify(parsed.root, null, 2);
}

export function removeFlowConnectionReference(source: string, referenceName: string): string {
  const parsed = parseFlowRoot(source, true);
  if (!parsed) throw new Error('Flow definition JSON must be an object.');
  const refs = isObject(parsed.properties.connectionReferences) ? parsed.properties.connectionReferences as MutableJson : undefined;
  if (!refs || !Object.prototype.hasOwnProperty.call(refs, referenceName)) {
    throw new Error(`${referenceName} was not found.`);
  }
  delete refs[referenceName];
  return JSON.stringify(parsed.root, null, 2);
}

export function setActionConnectionReference(action: Record<string, unknown>, referenceName: string): Record<string, unknown> {
  const next = structuredClone(action) as MutableJson;
  const inputs = ensureObject(next, 'inputs');
  const host = ensureObject(inputs, 'host');
  host.connectionReferenceName = referenceName;
  if (typeof host.connectionName === 'string') host.connectionName = referenceName;
  if (isObject(host.connection)) {
    (host.connection as MutableJson).referenceName = referenceName;
    if (typeof (host.connection as MutableJson).name === 'string') (host.connection as MutableJson).name = referenceName;
  }
  return next;
}

export function findUsageForAction(model: FlowConnectionModel, actionName: string | undefined): FlowConnectionUsage | undefined {
  if (!actionName) return undefined;
  return model.usages.find((usage) => usage.name === actionName);
}

export function findReferenceForUsage(model: FlowConnectionModel, usage: FlowConnectionUsage | undefined): FlowConnectionReference | undefined {
  if (!usage?.referenceName) return undefined;
  return model.references.find((reference) => reference.name === usage.referenceName);
}

export function connectionStatusLabel(status: FlowConnectionReferenceStatus): string {
  switch (status) {
    case 'bound': return 'Bound';
    case 'logical': return 'Solution reference';
    case 'unbound': return 'Unbound';
    case 'missing-connection': return 'Missing connection';
    case 'wrong-connector': return 'Wrong connector';
    case 'unused': return 'Unused';
  }
}

export function connectionStatusLevel(status: FlowConnectionReferenceStatus): 'ok' | 'warning' | 'error' | 'muted' {
  if (status === 'bound') return 'ok';
  if (status === 'logical' || status === 'unused') return 'muted';
  if (status === 'wrong-connector' || status === 'missing-connection' || status === 'unbound') return 'error';
  return 'warning';
}

export function connectorLabel(value: { apiDisplayName?: string; apiName?: string; apiId?: string }): string {
  return value.apiDisplayName || value.apiName || apiNameFromId(value.apiId) || 'Unknown connector';
}

function readConnectionReferences(parsed: ParsedFlowRoot): Map<string, FlowConnectionReference> {
  const refs = new Map<string, FlowConnectionReference>();
  const addRefs = (source: unknown) => {
    if (!isObject(source)) return;
    for (const [name, value] of Object.entries(source)) {
      if (!isObject(value)) continue;
      const next = normalizeConnectionReference(name, value);
      const existing = refs.get(name);
      refs.set(name, existing ? mergeConnectionReference(existing, next) : next);
    }
  };

  addRefs(parsed.properties.connectionReferences);
  addRefs((prop(parsed.properties, 'parameters.$connections.value') || prop(parsed.definition, 'parameters.$connections.value')) as unknown);
  return refs;
}

function normalizeConnectionReference(name: string, raw: MutableJson): FlowConnectionReference {
  const apiId = firstString(prop(raw, 'api.id'), prop(raw, 'apiId'), prop(raw, 'connectorid'), apiIdFromMaybeApiId(prop(raw, 'id')));
  const apiName = firstString(apiNameFromId(apiId), prop(raw, 'api.name'), prop(raw, 'apiName'));
  const connectionId = firstString(prop(raw, 'connection.id'), connectionIdFromMaybeConnectionId(prop(raw, 'id')), prop(raw, 'connectionId'), prop(raw, 'connectionid'));
  const connectionName = firstString(
    prop(raw, 'connectionName'),
    prop(raw, 'connection.name'),
    connectionNameFromId(connectionId),
    connectionNameFromId(prop(raw, 'id')),
  );
  return {
    name,
    apiName,
    apiId,
    apiDisplayName: firstString(prop(raw, 'api.displayName'), prop(raw, 'displayName')),
    connectionName,
    connectionId,
    logicalName: firstString(prop(raw, 'connection.connectionReferenceLogicalName'), prop(raw, 'connectionReferenceLogicalName'), prop(raw, 'connectionreferencelogicalname')),
    runtimeSource: firstString(prop(raw, 'runtimeSource'), prop(raw, 'source')),
    raw,
    usages: [],
    status: 'unbound',
    issues: [],
  };
}

function mergeConnectionReference(existing: FlowConnectionReference, next: FlowConnectionReference): FlowConnectionReference {
  return {
    ...existing,
    apiName: existing.apiName || next.apiName,
    apiId: existing.apiId || next.apiId,
    apiDisplayName: existing.apiDisplayName || next.apiDisplayName,
    connectionName: existing.connectionName || next.connectionName,
    connectionId: existing.connectionId || next.connectionId,
    logicalName: existing.logicalName || next.logicalName,
    runtimeSource: existing.runtimeSource || next.runtimeSource,
  };
}

function collectConnectionUsages(definition: MutableJson | null): FlowConnectionUsage[] {
  if (!definition) return [];
  const usages: FlowConnectionUsage[] = [];
  collectNamedConnectorNodes(definition.triggers, 'trigger', 'triggers', usages);
  collectNamedConnectorNodes(definition.actions, 'action', 'actions', usages);
  return usages;
}

function collectNamedConnectorNodes(source: unknown, kind: 'action' | 'trigger', path: string, usages: FlowConnectionUsage[]) {
  if (!isObject(source)) return;
  for (const [name, value] of Object.entries(source)) {
    if (!isObject(value)) continue;
    const nodePath = `${path}.${name}`;
    const usage = readConnectorUsage(name, kind, nodePath, value);
    if (usage) usages.push(usage);
    collectNestedActions(value, nodePath, usages);
  }
}

function collectNestedActions(node: MutableJson, path: string, usages: FlowConnectionUsage[]) {
  collectNamedConnectorNodes(node.actions, 'action', `${path}.actions`, usages);
  collectNamedConnectorNodes(prop(node, 'else.actions'), 'action', `${path}.else.actions`, usages);
  collectNamedConnectorNodes(prop(node, 'default.actions'), 'action', `${path}.default.actions`, usages);
  if (isObject(node.cases)) {
    for (const [caseName, value] of Object.entries(node.cases)) {
      collectNamedConnectorNodes(prop(value, 'actions'), 'action', `${path}.cases.${caseName}.actions`, usages);
    }
  }
}

function readConnectorUsage(name: string, kind: 'action' | 'trigger', path: string, node: MutableJson): FlowConnectionUsage | null {
  const host = prop(node, 'inputs.host');
  const actionType = firstString(node.type);
  const apiId = firstString(prop(host, 'apiId'), prop(node, 'inputs.apiId'));
  const apiName = firstString(prop(host, 'apiName'), prop(node, 'inputs.apiName'), apiNameFromId(apiId));
  const operationId = firstString(prop(host, 'operationId'), prop(node, 'inputs.operationId'), prop(node, 'operationId'));
  const explicitReference = firstString(
    prop(host, 'connectionReferenceName'),
    prop(host, 'connection.referenceName'),
    referenceNameFromConnectionExpression(prop(host, 'connection.name')),
    prop(host, 'connectionName'),
  );
  const connectorLike = isConnectorActionType(actionType) || Boolean(host && typeof host === 'object' && (apiId || apiName || operationId || explicitReference));
  if (!connectorLike) return null;
  return { name, kind, path, actionType, operationId, apiName, apiId, referenceName: explicitReference };
}

function findConnectionForReference(reference: FlowConnectionReference, connections: FlowEnvironmentConnection[]): FlowEnvironmentConnection | undefined {
  const name = normalizeConnectionName(reference.connectionName);
  const id = normalizeConnectionId(reference.connectionId);
  const logicalName = normalizeConnectionName(reference.logicalName);
  return connections.find((connection) => {
    return (name && normalizeConnectionName(connection.name) === name)
      || (id && normalizeConnectionId(connection.id) === id)
      || (reference.connectionName && normalizeConnectionId(connection.id).endsWith(`/connections/${reference.connectionName.toLowerCase()}`))
      || (logicalName && (connection.solutionReferences || []).some((solutionReference) => normalizeConnectionName(solutionReference.logicalName) === logicalName));
  });
}

function buildConnectionReferenceValue(existing: MutableJson, connection: FlowEnvironmentConnection): MutableJson {
  const apiId = connection.apiId || (connection.apiName ? `/providers/Microsoft.PowerApps/apis/${connection.apiName}` : undefined);
  const apiName = connection.apiName || apiNameFromId(connection.apiId);
  const existingConnectionName = firstString(existing.connectionName, prop(existing, 'connection.name'));
  const logicalName = firstString(prop(existing, 'connection.connectionReferenceLogicalName'), existing.connectionReferenceLogicalName)
    || (!existingConnectionName ? connection.solutionReferences?.find((reference) => reference.logicalName)?.logicalName : undefined);
  if (logicalName && !existingConnectionName) {
    return {
      ...existing,
      runtimeSource: firstString(existing.runtimeSource) || 'embedded',
      api: {
        ...(isObject(existing.api) ? existing.api : {}),
        ...(apiName ? { name: apiName } : {}),
      },
      connection: {
        ...(isObject(existing.connection) ? existing.connection : {}),
        connectionReferenceLogicalName: logicalName,
      },
    };
  }
  return {
    ...existing,
    source: firstString(existing.source) || 'Embedded',
    runtimeSource: firstString(existing.runtimeSource) || 'embedded',
    id: apiId,
    connectionName: connection.name,
    api: {
      ...(isObject(existing.api) ? existing.api : {}),
      ...(apiId ? { id: apiId } : {}),
      ...(apiName ? { name: apiName } : {}),
    },
    connection: {
      ...(isObject(existing.connection) ? existing.connection : {}),
      ...(connection.id ? { id: connection.id } : {}),
      name: connection.name,
    },
  };
}

function parseFlowRoot(source: string, mutable = false): ParsedFlowRoot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  const root = mutable ? structuredClone(parsed) as MutableJson : parsed;
  const properties = isObject(root.properties) ? root.properties as MutableJson : root;
  const definition = isObject(properties.definition)
    ? properties.definition as MutableJson
    : isObject(root.definition)
      ? root.definition as MutableJson
      : (isObject(root.actions) || isObject(root.triggers)) ? root : null;
  return { root, properties, definition };
}

function ensureObject(source: MutableJson, key: string): MutableJson {
  if (!isObject(source[key])) source[key] = {};
  return source[key] as MutableJson;
}

function apisCompatible(left: { apiName?: string; apiId?: string }, right: { apiName?: string; apiId?: string }): boolean {
  const leftNames = apiIdentityCandidates(left);
  const rightNames = apiIdentityCandidates(right);
  if (!leftNames.size || !rightNames.size) return true;
  for (const candidate of leftNames) {
    if (rightNames.has(candidate)) return true;
  }
  return false;
}

function apiLabel(value: { apiDisplayName?: string; apiName?: string; apiId?: string }): string {
  return connectorLabel(value);
}

function isConnectorActionType(value: string | undefined): boolean {
  return value === 'OpenApiConnection'
    || value === 'ApiConnection'
    || value === 'OpenApiConnectionWebhook'
    || value === 'ApiConnectionWebhook';
}

function sanitizeReferenceName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'shared_connector';
}

function apiDescriptorFromNameOrId(value: string): { apiName?: string; apiId?: string } {
  return value.toLowerCase().includes('/apis/') ? { apiId: value } : { apiName: value };
}

function apiIdentityCandidates(value: { apiName?: string; apiId?: string }): Set<string> {
  const candidates = new Set<string>();
  addApiIdentityCandidate(candidates, apiNameFromId(value.apiId));
  addApiIdentityCandidate(candidates, value.apiName);
  return candidates;
}

function addApiIdentityCandidate(candidates: Set<string>, value: unknown) {
  const normalized = normalizeApiName(value);
  if (!normalized) return;
  candidates.add(normalized);
  if (normalized.startsWith('shared_')) candidates.add(normalized.slice('shared_'.length));
}

function normalizeApiName(value: unknown): string {
  const str = firstString(apiNameFromId(value), value);
  if (!str) return '';
  return str.toLowerCase().replace(/^\/?providers\/microsoft\.powerapps\/apis\//i, '');
}

function normalizeConnectionName(value: unknown): string {
  return firstString(value)?.toLowerCase() || '';
}

function normalizeConnectionId(value: unknown): string {
  return firstString(value)?.toLowerCase() || '';
}

function apiNameFromId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split('/').filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase() === 'apis');
  return index >= 0 ? parts[index + 1] : undefined;
}

function apiIdFromMaybeApiId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.toLowerCase().includes('/apis/') ? value : undefined;
}

function connectionNameFromId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split('/').filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase() === 'connections');
  return index >= 0 ? parts[index + 1] : undefined;
}

function connectionIdFromMaybeConnectionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.toLowerCase().includes('/connections/') ? value : undefined;
}

function referenceNameFromConnectionExpression(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/parameters\(['"]\$connections['"]\)\[['"]([^'"]+)['"]\]/i);
  return match?.[1];
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function isObject(value: unknown): value is MutableJson {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
