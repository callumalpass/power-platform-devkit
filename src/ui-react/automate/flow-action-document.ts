import { prop } from '../utils.js';
import type { FlowAnalysis, FlowAnalysisOutlineItem, FlowApiOperation, FlowApiOperationSchema, FlowApiOperationSchemaField } from '../ui-types.js';
import type { FlowActionEditTarget } from './types.js';
import { isActionLikeOutlineItem } from './outline-utils.js';

/**
 * Points at a specific `actions` map inside a flow definition. Undefined means the top-level
 * workflow actions map. For a nested action, `parentName` is the action that owns the container
 * and `branchPath` is the sequence of keys from the parent action's value to the actions map
 * itself. Examples:
 *   - Scope / Foreach / Until body:   branchPath = ['actions']
 *   - If 'then' branch:               branchPath = ['actions']
 *   - If 'else' branch:               branchPath = ['else', 'actions']
 *   - Switch case 'foo':              branchPath = ['cases', 'foo', 'actions']
 *   - Switch default:                 branchPath = ['default', 'actions']
 */
export type ActionContainerRef = {
  parentName: string;
  branchPath: string[];
  /** Human-readable target, shown in the Add Action modal header. */
  label?: string;
};

export function addActionToFlowDocument(
  source: string,
  actionName: string,
  action: Record<string, unknown>,
  insertAfter?: string,
  container?: ActionContainerRef,
): string {
  const root = JSON.parse(source) as unknown;
  if (!isObject(root)) throw new Error('Flow definition JSON must be an object.');

  let targetActions: Record<string, unknown>;
  let assign: (next: Record<string, unknown>) => void;

  if (container?.parentName) {
    const parent = findMutableActionByName(root, container.parentName);
    if (!parent) throw new Error(`Could not find action "${container.parentName}" to insert inside.`);
    const resolved = ensurePathActions(parent, container.branchPath);
    targetActions = resolved.container;
    assign = resolved.assign;
  } else {
    const definition = findMutableWorkflowDefinition(root);
    if (!definition) throw new Error('Could not find workflow definition actions.');
    const actions = isObject(definition.actions) ? definition.actions : {};
    definition.actions = actions;
    targetActions = actions;
    assign = (next) => { definition.actions = next; };
  }

  if (Object.prototype.hasOwnProperty.call(targetActions, actionName)) {
    throw new Error(`${actionName} already exists.`);
  }
  if (insertAfter && Object.prototype.hasOwnProperty.call(targetActions, insertAfter)) {
    const reordered: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(targetActions)) {
      reordered[key] = val;
      if (key === insertAfter) reordered[actionName] = action;
    }
    assign(reordered);
  } else {
    targetActions[actionName] = action;
  }
  return JSON.stringify(root, null, 2);
}

/**
 * Delete an action from the flow definition, and strip the removed name from every runAfter
 * map in the document so no dangling references remain. Throws if the name isn't found.
 */
export function removeActionFromFlowDocument(source: string, actionName: string): string {
  const root = JSON.parse(source) as unknown;
  if (!isObject(root)) throw new Error('Flow definition JSON must be an object.');
  const container = findActionsContainer(root, actionName);
  if (!container) throw new Error(`Could not find action "${actionName}".`);
  delete container[actionName];
  stripRunAfterReferences(root, actionName);
  return JSON.stringify(root, null, 2);
}

function stripRunAfterReferences(node: unknown, actionName: string) {
  if (!isObject(node)) return;
  if (isObject(node.runAfter)) {
    const runAfter = node.runAfter as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(runAfter, actionName)) {
      delete runAfter[actionName];
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') stripRunAfterReferences(value, actionName);
  }
}

/** Returns the action object itself (not its containing actions map). */
function findMutableActionByName(root: unknown, name: string): Record<string, unknown> | null {
  if (!isObject(root)) return null;
  if (isObject(root.actions)) {
    const actions = root.actions as Record<string, unknown>;
    if (isObject(actions[name])) return actions[name] as Record<string, unknown>;
    for (const val of Object.values(actions)) {
      const found = findMutableActionByName(val, name);
      if (found) return found;
    }
  }
  for (const key of ['else', 'default', 'definition', 'properties'] as const) {
    if (isObject(root[key])) {
      const found = findMutableActionByName(root[key], name);
      if (found) return found;
    }
  }
  if (isObject(root.cases)) {
    for (const val of Object.values(root.cases as Record<string, unknown>)) {
      const found = findMutableActionByName(val, name);
      if (found) return found;
    }
  }
  return null;
}

function ensurePathActions(parent: Record<string, unknown>, branchPath: string[]): { container: Record<string, unknown>; assign: (next: Record<string, unknown>) => void } {
  if (!branchPath.length) throw new Error('Container branch path must not be empty.');
  let current: Record<string, unknown> = parent;
  for (let i = 0; i < branchPath.length - 1; i++) {
    const key = branchPath[i]!;
    if (!isObject(current[key])) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = branchPath[branchPath.length - 1]!;
  if (!isObject(current[lastKey])) current[lastKey] = {};
  const container = current[lastKey] as Record<string, unknown>;
  return {
    container,
    assign: (next) => { current[lastKey] = next; },
  };
}

export function readOutlineEditTarget(source: string, item: FlowAnalysisOutlineItem): FlowActionEditTarget {
  if (item.from === undefined || item.to === undefined || !item.name) throw new Error('Outline item does not have a source range.');
  const direct = tryParseObjectSlice(source, item.from, item.to);
  if (direct) {
    return { item, name: item.name, value: direct, from: item.from, to: item.to, replaceMode: 'value', canRename: false };
  }
  const colon = source.indexOf(':', item.from);
  if (colon < 0 || colon > item.to) throw new Error(`Could not locate ${item.name} in the editor.`);
  const valueStart = firstNonWhitespaceOffset(source, colon + 1);
  if (valueStart < 0 || valueStart > item.to) throw new Error(`${item.name} does not have an editable JSON value.`);
  const parsed = tryParseObjectSlice(source, valueStart, item.to);
  if (!parsed) throw new Error(`${item.name} is not an editable JSON object.`);
  return { item, name: item.name, value: parsed, from: item.from, to: item.to, replaceMode: 'property', canRename: canRenameOutlineItem(item) };
}

export function replaceOutlineItemInFlowDocument(source: string, target: FlowActionEditTarget, itemName: string, value: Record<string, unknown>): string {
  const lineStart = source.lastIndexOf('\n', target.from - 1) + 1;
  const indent = source.slice(lineStart, target.from).match(/^\s*/)?.[0] || '';
  const body = JSON.stringify(value, null, 2).replace(/\n/g, `\n${indent}`);
  if (target.replaceMode === 'value') {
    return `${source.slice(0, target.from)}${body}${source.slice(target.to)}`;
  }
  return `${source.slice(0, target.from)}"${escapeJsonString(itemName)}": ${body}${source.slice(target.to)}`;
}

function tryParseObjectSlice(source: string, from: number, to: number): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(source.slice(from, to)) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function firstNonWhitespaceOffset(source: string, from: number) {
  for (let index = from; index < source.length; index += 1) {
    if (!/\s/.test(source[index] || '')) return index;
  }
  return -1;
}

function canRenameOutlineItem(item: FlowAnalysisOutlineItem) {
  return !['workflow', 'actions', 'parameters', 'triggers', 'variables'].includes(String(item.name || item.kind || ''));
}

function escapeJsonString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export type FlowActionOperationRef = {
  apiId?: string;
  apiName?: string;
  apiRef?: string;
  connectionName?: string;
  connectionReferenceName?: string;
  operationId?: string;
};

export function resolveActionOperation(source: string, action: Record<string, unknown>): FlowActionOperationRef {
  const operation = readActionOperation(action);
  const reference = operation.connectionReferenceName ? readConnectionReference(source, operation.connectionReferenceName) : {};
  const apiRef = operation.apiId || reference.apiId || operation.apiName || reference.apiName;
  return {
    ...operation,
    apiId: operation.apiId || reference.apiId,
    apiName: operation.apiName || reference.apiName,
    apiRef,
    connectionName: operation.connectionName || reference.connectionName,
  };
}

function readActionOperation(action: Record<string, unknown>): FlowActionOperationRef {
  const host = prop(action, 'inputs.host');
  const connectionReferenceName = firstNonEmptyString(
    prop(host, 'connectionReferenceName'),
    prop(host, 'connection.referenceName'),
    prop(host, 'connection.name'),
    prop(host, 'connectionName'),
  );
  return {
    connectionReferenceName,
    connectionName: firstNonEmptyString(
      prop(host, 'connectionName'),
      connectionNameFromId(prop(host, 'connection.id')),
      connectionNameFromId(prop(host, 'connection.name')),
      prop(host, 'connection.name'),
    ),
    apiId: firstNonEmptyString(prop(host, 'apiId'), prop(action, 'inputs.apiId')),
    apiName: firstNonEmptyString(prop(host, 'apiName'), prop(action, 'inputs.apiName')),
    operationId: firstNonEmptyString(prop(host, 'operationId'), prop(action, 'inputs.operationId'), prop(action, 'operationId')),
  };
}

function readConnectionReference(source: string, name: string): { apiId?: string; apiName?: string; connectionName?: string } {
  try {
    const root = JSON.parse(source) as unknown;
    if (!isObject(root)) return {};
    const properties = isObject(root.properties) ? root.properties : root;
    const refs = isObject(properties.connectionReferences) ? properties.connectionReferences : isObject(root.connectionReferences) ? root.connectionReferences : {};
    const ref = isObject(refs[name]) ? refs[name] : undefined;
    if (!ref) return {};
    const apiId = firstNonEmptyString(prop(ref, 'api.id'), prop(ref, 'apiId'), prop(ref, 'id'));
    return {
      apiId,
      apiName: firstNonEmptyString(apiNameFromId(apiId), prop(ref, 'api.name'), prop(ref, 'apiName')),
      connectionName: firstNonEmptyString(
        prop(ref, 'connectionName'),
        connectionNameFromId(prop(ref, 'connection.id')),
        connectionNameFromId(prop(ref, 'connection.name')),
        connectionNameFromId(prop(ref, 'id')),
        prop(ref, 'connection.name'),
      ),
    };
  } catch {
    return {};
  }
}

function apiNameFromId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split('/').filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase() === 'apis');
  return index >= 0 ? parts[index + 1] : undefined;
}

function connectionNameFromId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split('/').filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase() === 'connections');
  const candidate = index >= 0 ? parts[index + 1] : undefined;
  return candidate || undefined;
}

export function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

export function connectorFieldPath(field: FlowApiOperationSchemaField): string[] {
  if (field.path?.length) return field.path;
  if (field.location === 'header') return ['inputs', 'headers', field.name];
  if (field.location === 'query') return ['inputs', 'queries', field.name];
  if (field.location === 'body') return ['inputs', 'parameters', field.name || 'body'];
  if (field.location === 'path') return ['inputs', 'parameters', field.name];
  return ['inputs', 'parameters', field.name];
}

export function existingConnectorParameterFields(action: Record<string, unknown>, fields: FlowApiOperationSchemaField[]): FlowApiOperationSchemaField[] {
  const known = new Set(fields.map((field) => `${field.location || 'parameter'}:${field.name}`));
  const parameters = prop(action, 'inputs.parameters');
  if (!isObject(parameters)) return [];
  return Object.keys(parameters)
    .filter((name) => !known.has(`parameter:${name}`) && !known.has(`path:${name}`) && !known.has(`body:${name}`))
    .map((name) => ({ name, location: 'parameter', type: typeof parameters[name] }));
}

export function readPathValue(source: unknown, path: string[]): unknown {
  let current = source;
  for (const segment of path) {
    if (!isObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

export function setPathValue(source: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const clone = structuredClone(source) as Record<string, unknown>;
  let current: Record<string, unknown> = clone;
  for (const segment of path.slice(0, -1)) {
    if (!isObject(current[segment])) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[path[path.length - 1]!] = value;
  return clone;
}

export function parseEditableJson(value: string): unknown {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function valueToEditText(value: unknown, kind: 'text' | 'json' | 'select') {
  if (value === undefined || value === null) return '';
  if (kind === 'json') return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function shouldEditAsJson(field: FlowApiOperationSchemaField) {
  const type = field.type || schemaTypeLabel(field.schema);
  return type === 'object' || type === 'array';
}

export function schemaTypeLabel(schema: unknown) {
  return isObject(schema) && typeof schema.type === 'string' ? schema.type : undefined;
}

function findMutableWorkflowDefinition(root: Record<string, unknown>): Record<string, unknown> | null {
  if (isObject(root.actions) || isObject(root.triggers)) return root;
  if (isObject(root.definition) && (isObject(root.definition.actions) || isObject(root.definition.triggers))) return root.definition;
  if (isObject(root.properties) && isObject(root.properties.definition)) return root.properties.definition;
  return null;
}

function findActionsContainer(root: unknown, actionName: string): Record<string, unknown> | null {
  if (!isObject(root)) return null;
  if (isObject(root.actions)) {
    const actions = root.actions as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(actions, actionName)) return actions;
    for (const val of Object.values(actions)) {
      const found = findActionsContainer(val, actionName);
      if (found) return found;
    }
  }
  for (const key of ['else', 'definition', 'properties'] as const) {
    if (isObject(root[key])) {
      const found = findActionsContainer(root[key], actionName);
      if (found) return found;
    }
  }
  if (isObject(root.cases)) {
    for (const val of Object.values(root.cases as Record<string, unknown>)) {
      const found = findActionsContainer(val, actionName);
      if (found) return found;
    }
  }
  return null;
}

export function findSiblingActionNames(outline: FlowAnalysisOutlineItem[], actionName: string): string[] | null {
  for (const item of outline) {
    if (item.children) {
      const actionChildren = item.children.filter((c) => isActionLikeOutlineItem(c) && c.name);
      if (actionChildren.some((c) => c.name === actionName)) {
        return actionChildren.map((c) => c.name!);
      }
      const result = findSiblingActionNames(item.children, actionName);
      if (result) return result;
    }
  }
  return null;
}

export function reorderActionInFlowDocument(source: string, actionName: string, targetName: string, position: 'before' | 'after', siblingNames: string[]): string {
  const fromIdx = siblingNames.indexOf(actionName);
  const targetIdx = siblingNames.indexOf(targetName);
  if (fromIdx < 0 || targetIdx < 0) throw new Error('Action not found among siblings.');
  if (fromIdx === targetIdx) return source;

  // Build new order
  const newOrder = [...siblingNames];
  newOrder.splice(fromIdx, 1);
  const insertAt = position === 'before'
    ? newOrder.indexOf(targetName)
    : newOrder.indexOf(targetName) + 1;
  newOrder.splice(insertAt, 0, actionName);
  if (newOrder.every((name, i) => name === siblingNames[i])) return source;

  const root = JSON.parse(source) as unknown;
  if (!isObject(root)) throw new Error('Invalid flow definition.');
  const container = findActionsContainer(root, actionName);
  if (!container) throw new Error('Could not find actions container.');

  // Rebuild runAfter chain based on new order
  for (let i = 0; i < newOrder.length; i++) {
    const name = newOrder[i]!;
    const action = container[name];
    if (!isObject(action)) continue;
    action.runAfter = i === 0 ? {} : { [newOrder[i - 1]!]: ['Succeeded'] };
  }

  // Reorder JSON keys to match
  const reordered: Record<string, unknown> = {};
  for (const name of newOrder) reordered[name] = container[name];
  for (const key of Object.keys(container)) {
    if (!newOrder.includes(key)) reordered[key] = container[key];
  }
  for (const key of Object.keys(container)) delete container[key];
  for (const [key, val] of Object.entries(reordered)) container[key] = val;

  return JSON.stringify(root, null, 2);
}

export function buildApiOperationAction(source: string, operation: FlowApiOperation, runAfter: Record<string, string[]>, schema?: FlowApiOperationSchema, connectionReferenceNameOverride?: string): Record<string, unknown> {
  const connectionReferenceName = connectionReferenceNameOverride || findConnectionReferenceName(source, operation) || (operation.apiName ? `shared_${operation.apiName}` : 'shared_connector');
  const host: Record<string, unknown> = {
    connectionReferenceName,
    operationId: operation.name,
  };
  if (operation.apiId) host.apiId = operation.apiId;
  const action = {
    type: operation.operationType || 'OpenApiConnection',
    inputs: {
      host,
      parameters: {},
    },
    runAfter,
  };
  if (schema?.fields.length) {
    for (const field of schema.fields) {
      if (!field.required) continue;
      if (field.visibility === 'internal' || field.name === 'connectionId') continue;
      const value = defaultValueForSchemaField(field);
      if (value === undefined) continue;
      setPathValueInPlace(action, connectorFieldPath(field), value);
    }
  }
  return action;
}

function defaultValueForSchemaField(field: FlowApiOperationSchemaField): unknown {
  if (field.defaultValue !== undefined) return field.defaultValue;
  if (field.enum?.length) return field.enum[0];
  const type = field.type || schemaTypeLabel(field.schema);
  if (type === 'boolean') return false;
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'array') return [];
  if (type === 'object') return {};
  return '';
}

function setPathValueInPlace(source: Record<string, unknown>, path: string[], value: unknown) {
  let current: Record<string, unknown> = source;
  for (const segment of path.slice(0, -1)) {
    if (!isObject(current[segment])) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[path[path.length - 1]!] = value;
}

function findConnectionReferenceName(source: string, operation: FlowApiOperation): string | undefined {
  try {
    const root = JSON.parse(source) as unknown;
    if (!isObject(root)) return undefined;
    const properties = isObject(root.properties) ? root.properties : root;
    const refs = isObject(properties.connectionReferences) ? properties.connectionReferences : isObject(root.connectionReferences) ? root.connectionReferences : undefined;
    if (!refs) return undefined;
    for (const [key, value] of Object.entries(refs)) {
      if (!isObject(value)) continue;
      const apiId = String(prop(value, 'api.id') || prop(value, 'apiId') || '');
      const apiName = String(prop(value, 'api.name') || prop(value, 'apiName') || '');
      if (operation.apiId && apiId && apiId.toLowerCase() === operation.apiId.toLowerCase()) return key;
      if (operation.apiName && apiName && apiName.toLowerCase().includes(operation.apiName.toLowerCase())) return key;
      if (operation.apiName && key.toLowerCase().includes(operation.apiName.toLowerCase())) return key;
    }
  } catch {}
  return undefined;
}

export function buildRunAfter(actionName: string): Record<string, string[]> {
  return actionName ? { [actionName]: ['Succeeded'] } : {};
}

export function topLevelActionNames(analysis: FlowAnalysis | null): string[] {
  const workflow = analysis?.outline?.find((item) => item.kind === 'workflow') || analysis?.outline?.[0];
  const actions = workflow?.children?.find((item) => item.name === 'actions' || item.kind === 'action');
  return (actions?.children || []).map((item) => item.name).filter((name): name is string => Boolean(name));
}

export function uniqueActionName(source: string, preferred: string): string {
  const base = sanitizeActionName(preferred || 'Action') || 'Action';
  const existing = new Set<string>();
  try {
    const root = JSON.parse(source) as unknown;
    if (isObject(root)) {
      const definition = findMutableWorkflowDefinition(root);
      const actions = definition && isObject(definition.actions) ? definition.actions : {};
      for (const key of Object.keys(actions)) existing.add(key);
    }
  } catch {}
  if (!existing.has(base)) return base;
  for (let index = 2; index < 1000; index++) {
    const next = `${base}_${index}`;
    if (!existing.has(next)) return next;
  }
  return `${base}_${Date.now()}`;
}

export function sanitizeActionName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'Action';
}

export function formatOutlineEditName(item: FlowAnalysisOutlineItem, value: string): string {
  if (shouldSanitizeOutlineName(item)) return sanitizeActionName(value);
  return value;
}

function shouldSanitizeOutlineName(item: FlowAnalysisOutlineItem) {
  return ['action', 'scope', 'condition', 'foreach', 'switch', 'trigger'].includes(String(item.kind || ''));
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
