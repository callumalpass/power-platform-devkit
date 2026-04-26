import type { FlowAnalysis } from '../ui-types.js';
import { compatibleConnectionReferences, type FlowConnectionModel, type FlowConnectionReference } from './flow-connections.js';

export type FlowEditorConnectionCompletionItem = {
  label: string;
  kind: 'property' | 'value';
  detail?: string;
  documentation?: string;
  insertText: string;
  sortText?: string;
};

type FlowEditorCursorContext = {
  kind?: string;
  path?: string[];
  nearestAction?: string;
  propertyName?: string;
};

const HOST_KEYS = ['connectionReferenceName', 'operationId', 'apiId', 'apiName', 'connectionName'];

export function flowEditorConnectionCompletionItems(analysis: FlowAnalysis | null, model: FlowConnectionModel | null | undefined): FlowEditorConnectionCompletionItem[] {
  const context = analysis?.context as FlowEditorCursorContext | undefined;
  if (!context || !model || !Array.isArray(context.path)) return [];
  if (!isHostContext(context)) return [];

  if (context.kind === 'property-key') {
    const path = context.path;
    const currentName = context.propertyName;
    return HOST_KEYS.filter((key) => key === currentName || !hostPathHasKey(path, key)).map((key, index) => ({
      label: key,
      kind: 'property' as const,
      detail: 'Connector host field',
      documentation: hostKeyDocumentation(key),
      insertText: escapeJsonStringContent(key),
      sortText: `10_${index}_${key}`
    }));
  }

  if (context.kind !== 'property-value') return [];
  const propertyName = String(context.propertyName || '');
  if (propertyName === 'connectionReferenceName' || propertyName === 'referenceName') {
    return connectionReferenceValueCompletions(model, context.nearestAction);
  }
  if (propertyName === 'connectionName' || propertyName === 'name') {
    return connectionNameValueCompletions(model, context.nearestAction);
  }
  if (propertyName === 'operationId') {
    return operationIdValueCompletions(model, context.nearestAction);
  }
  if (propertyName === 'apiId') {
    return uniqueValues([...model.references.map((reference) => reference.apiId), ...model.connections.map((connection) => connection.apiId)]).map((value, index) =>
      valueCompletion(value, 'Connector API id', index)
    );
  }
  if (propertyName === 'apiName') {
    return uniqueValues([...model.references.map((reference) => reference.apiName), ...model.connections.map((connection) => connection.apiName)]).map((value, index) =>
      valueCompletion(value, 'Connector API name', index)
    );
  }
  return [];
}

function isHostContext(context: FlowEditorCursorContext): boolean {
  const path = context.path || [];
  if (context.kind === 'property-key') {
    const parent = path.slice(0, -1);
    return endsWithPath(parent, ['inputs', 'host']) || endsWithPath(parent, ['inputs', 'host', 'connection']);
  }
  return path.includes('inputs') && path.includes('host');
}

function hostPathHasKey(path: string[], key: string): boolean {
  return path[path.length - 1] === key;
}

function connectionReferenceValueCompletions(model: FlowConnectionModel, actionName: string | undefined): FlowEditorConnectionCompletionItem[] {
  const usage = actionName ? model.usages.find((item) => item.name === actionName) : undefined;
  const candidates = usage ? compatibleConnectionReferences(model, { apiId: usage.apiId, apiName: usage.apiName }) : model.references;
  return candidates.map((reference, index) => ({
    label: reference.name,
    kind: 'value' as const,
    detail: referenceDetail(reference),
    documentation: reference.connection?.displayName || reference.apiDisplayName || reference.apiName,
    insertText: escapeJsonStringContent(reference.name),
    sortText: `10_${index}_${reference.name}`
  }));
}

function connectionNameValueCompletions(model: FlowConnectionModel, actionName: string | undefined): FlowEditorConnectionCompletionItem[] {
  const usage = actionName ? model.usages.find((item) => item.name === actionName) : undefined;
  const references = usage ? compatibleConnectionReferences(model, { apiId: usage.apiId, apiName: usage.apiName }) : model.references;
  const names = uniqueValues([
    ...references.map((reference) => reference.connectionName),
    ...references.map((reference) => reference.connection?.name),
    ...model.connections.filter((connection) => !usage || apiCompatible(connection.apiId, usage.apiId) || apiCompatible(connection.apiName, usage.apiName)).map((connection) => connection.name)
  ]);
  return names.map((name, index) => valueCompletion(name, 'Connection name', index));
}

function operationIdValueCompletions(model: FlowConnectionModel, actionName: string | undefined): FlowEditorConnectionCompletionItem[] {
  const usage = actionName ? model.usages.find((item) => item.name === actionName) : undefined;
  const names = uniqueValues([
    usage?.operationId,
    ...model.usages.filter((item) => !usage || apiCompatible(item.apiId, usage.apiId) || apiCompatible(item.apiName, usage.apiName)).map((item) => item.operationId)
  ]);
  return names.map((name, index) => valueCompletion(name, 'Operation id used in this flow', index));
}

function valueCompletion(value: string, detail: string, index: number): FlowEditorConnectionCompletionItem {
  return {
    label: value,
    kind: 'value',
    detail,
    insertText: escapeJsonStringContent(value),
    sortText: `10_${index}_${value}`
  };
}

function referenceDetail(reference: FlowConnectionReference): string {
  return [reference.status, reference.apiDisplayName || reference.apiName, reference.connection?.displayName || reference.connectionName].filter(Boolean).join(' · ');
}

function hostKeyDocumentation(key: string): string {
  if (key === 'connectionReferenceName') return 'Reference name from properties.connectionReferences.';
  if (key === 'operationId') return 'Connector operation id from the Flow operation catalog.';
  if (key === 'apiId') return 'Connector API resource id.';
  if (key === 'apiName') return 'Connector API name.';
  if (key === 'connectionName') return 'Legacy connection name used by some Flow definitions.';
  return 'Connector host field.';
}

function uniqueValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

function apiCompatible(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return normalizeApiName(left) === normalizeApiName(right);
}

function normalizeApiName(value: string): string {
  const match = value.match(/\/apis\/([^/]+)/i);
  return (match?.[1] || value).toLowerCase();
}

function endsWithPath(path: string[], suffix: string[]): boolean {
  if (suffix.length > path.length) return false;
  return suffix.every((part, index) => path[path.length - suffix.length + index] === part);
}

function escapeJsonStringContent(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
