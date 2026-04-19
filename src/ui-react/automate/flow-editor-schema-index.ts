import { useEffect, useState } from 'react';
import { loadFlowApiOperationSchema, loadFlowDynamicEnum, loadFlowDynamicProperties } from '../automate-data.js';
import type { FlowAnalysis, FlowAnalysisOutlineItem, FlowApiOperationSchema, FlowApiOperationSchemaField, FlowDynamicValueOption, ToastFn } from '../ui-types.js';
import { analyzeFlow } from '../../flow-language.js';
import { findFlowExpressionCompletionContext } from '../../flow-expression-completions.js';
import type { FlowExpressionCallNode, FlowExpressionNode } from '../../flow-expression-parser.js';
import {
  connectorFieldPath,
  isObject,
  readOutlineEditTarget,
  resolveActionOperation,
  type FlowActionOperationRef,
} from './flow-action-document.js';
import {
  dynamicApiRef,
  expandDynamicSchemaFields,
  fieldSchemaKey,
  pickDynamicParameters,
  readConnectorParameters,
  visibleConnectorSchemaFields,
} from './flow-dynamic-schema.js';
import { isActionLikeOutlineItem } from './outline-utils.js';

export type FlowEditorSchemaActionTarget = {
  name: string;
  from: number;
  to: number;
  action: Record<string, unknown>;
  operationRef: FlowActionOperationRef;
};

export type FlowEditorSchemaActionEntry = FlowEditorSchemaActionTarget & {
  schema: FlowApiOperationSchema | null;
  fields: FlowApiOperationSchemaField[];
  options: Record<string, FlowDynamicValueOption[]>;
  outputFields?: Record<string, FlowApiOperationSchemaField[]>;
  status: 'loading' | 'ready' | 'error';
  error?: string;
};

export type FlowEditorSchemaIndex = {
  version: number;
  loading: boolean;
  actions: FlowEditorSchemaActionEntry[];
  byActionName: Record<string, FlowEditorSchemaActionEntry>;
};

export type FlowEditorSchemaCompletionItem = {
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

type AccessorBase = {
  functionName: 'body' | 'outputs';
  actionName: string;
};

type AccessorRoot = {
  schema: unknown;
  path: string[];
};

export const EMPTY_FLOW_EDITOR_SCHEMA_INDEX: FlowEditorSchemaIndex = {
  version: 0,
  loading: false,
  actions: [],
  byActionName: {},
};

const operationSchemaCache = new Map<string, Promise<FlowApiOperationSchema | null>>();
const dynamicSchemaCache = new Map<string, Promise<FlowApiOperationSchemaField[]>>();
const dynamicOptionsCache = new Map<string, Promise<FlowDynamicValueOption[]>>();

export function useFlowEditorSchemaIndex(
  environment: string,
  source: string,
  analysis: FlowAnalysis | null,
  toast: ToastFn,
): FlowEditorSchemaIndex {
  const [index, setIndex] = useState<FlowEditorSchemaIndex>(EMPTY_FLOW_EDITOR_SCHEMA_INDEX);

  useEffect(() => {
    let cancelled = false;
    const effectiveAnalysis = analysis || analyzeFlowIfPossible(source);
    const targets = collectFlowEditorSchemaTargets(source, effectiveAnalysis);
    if (!environment || !targets.length) {
      setIndex(EMPTY_FLOW_EDITOR_SCHEMA_INDEX);
      return;
    }

    setIndex((previous) => buildFlowEditorSchemaIndex(targets.map((target) => {
      const previousEntry = previous.byActionName[target.name];
      if (previousEntry && actionTargetsMatch(previousEntry, target)) return previousEntry;
      return loadingEntry(target);
    }), true));

    const timer = window.setTimeout(() => {
      void Promise.all(targets.map((target) => loadFlowEditorSchemaEntry(environment, target)))
        .then((entries) => {
          if (!cancelled) setIndex(buildFlowEditorSchemaIndex(entries, false));
        })
        .catch((error) => {
          if (!cancelled) toast(error instanceof Error ? error.message : String(error), true);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [analysis, environment, source, toast]);

  return index;
}

export function collectFlowEditorSchemaTargets(source: string, analysis: FlowAnalysis | null): FlowEditorSchemaActionTarget[] {
  if (!analysis?.outline?.length) return [];
  const targets: FlowEditorSchemaActionTarget[] = [];
  const seen = new Set<string>();
  for (const item of flattenOutline(analysis.outline)) {
    if (!isActionLikeOutlineItem(item) || !item.name || item.from === undefined || item.to === undefined) continue;
    let action: Record<string, unknown>;
    try {
      action = readOutlineEditTarget(source, item).value;
    } catch {
      continue;
    }
    if (!isObject(action) || !isConnectorActionType(action.type || item.type)) continue;
    const operationRef = resolveActionOperation(source, action);
    if (!operationRef.apiRef || !operationRef.operationId) continue;
    const key = `${item.name}:${operationRef.apiRef}:${operationRef.operationId}:${item.from}:${item.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      name: item.name,
      from: item.from,
      to: item.to,
      action,
      operationRef,
    });
  }
  return targets;
}

export function buildFlowEditorSchemaIndex(entries: FlowEditorSchemaActionEntry[], loading: boolean): FlowEditorSchemaIndex {
  const byActionName: Record<string, FlowEditorSchemaActionEntry> = {};
  for (const entry of entries) byActionName[entry.name] = entry;
  return {
    version: Date.now(),
    loading,
    actions: entries,
    byActionName,
  };
}

export function flowEditorSchemaCompletionItems(
  cursor: number,
  analysis: FlowAnalysis | null,
  index: FlowEditorSchemaIndex | null,
): FlowEditorSchemaCompletionItem[] {
  const context = analysis?.context as FlowEditorCursorContext | undefined;
  if (!context || !index?.actions.length || !Array.isArray(context.path)) return [];
  if (context.kind !== 'property-key' && context.kind !== 'property-value') return [];

  const entry = schemaEntryForContext(cursor, context, index);
  if (!entry || entry.status === 'error' || !entry.fields.length) return [];

  const relativePath = actionRelativePath(context.path, entry.name);
  if (!relativePath.length) return [];

  if (context.kind === 'property-key') {
    const parentPath = relativePath.slice(0, -1);
    return fieldKeyCompletions(entry, parentPath, context.propertyName);
  }

  return fieldValueCompletions(entry, relativePath);
}

export function flowEditorExpressionSchemaCompletionItems(
  source: string,
  cursor: number,
  index: FlowEditorSchemaIndex | null,
): FlowEditorSchemaCompletionItem[] {
  const context = findFlowExpressionCompletionContext(source, cursor);
  if (context?.kind !== 'accessor' || !context.accessor || !index?.actions.length) return [];
  const resolved = context.accessor.expression
    ? schemaNodeForExpression(index, context.accessor.expression)
    : schemaNodeForLegacyAccessor(index, context.accessor.baseExpression, context.accessor.segments);
  if (!resolved) return [];
  return outputSchemaCompletions(resolved.entry, resolved.schema, resolved.path, context.accessor.prefix);
}

async function loadFlowEditorSchemaEntry(environment: string, target: FlowEditorSchemaActionTarget): Promise<FlowEditorSchemaActionEntry> {
  try {
    const schema = await cachedOperationSchema(environment, target.operationRef.apiRef, target.operationRef.operationId);
    const baseFields = visibleConnectorSchemaFields(schema?.fields || []);
    const dynamicFields = await loadDynamicSchemaFields(environment, target, schema, baseFields);
    const fields = visibleConnectorSchemaFields(expandDynamicSchemaFields(baseFields, dynamicFields));
    const options = await loadDynamicOptions(environment, target, schema, fields);
    const outputFields = await loadDynamicOutputSchemaFields(environment, target, schema);
    return {
      ...target,
      schema,
      fields,
      options,
      outputFields,
      status: 'ready',
    };
  } catch (error) {
    return {
      ...target,
      schema: null,
      fields: [],
      options: {},
      outputFields: {},
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function cachedOperationSchema(environment: string, apiRef: string | undefined, operationId: string | undefined): Promise<FlowApiOperationSchema | null> {
  if (!apiRef || !operationId) return null;
  const key = `${environment}:${apiRef}:${operationId}`;
  let promise = operationSchemaCache.get(key);
  if (!promise) {
    promise = loadFlowApiOperationSchema(environment, apiRef, operationId)
      .catch((error) => {
        operationSchemaCache.delete(key);
        throw error;
      });
    operationSchemaCache.set(key, promise);
  }
  return promise;
}

async function loadDynamicSchemaFields(
  environment: string,
  target: FlowEditorSchemaActionTarget,
  schema: FlowApiOperationSchema | null,
  fields: FlowApiOperationSchemaField[],
): Promise<Record<string, FlowApiOperationSchemaField[]>> {
  const dynamicFields = fields.filter((field) => field.dynamicSchema);
  if (!dynamicFields.length) return {};
  const apiRef = dynamicApiRef(target.operationRef, schema);
  if (!apiRef) return {};
  const parameters = readConnectorParameters(target.action);
  const dynamicParameters = pickDynamicParameters(dynamicFields.map((field) => field.dynamicSchema), parameters);
  const entries = await Promise.all(dynamicFields.map(async (field) => {
    const values = await cachedDynamicSchemaFields(environment, apiRef, target.operationRef.connectionName, field, dynamicParameters);
    return [fieldSchemaKey(field), values] as const;
  }));
  return Object.fromEntries(entries.filter(([, values]) => values.length));
}

async function loadDynamicOptions(
  environment: string,
  target: FlowEditorSchemaActionTarget,
  schema: FlowApiOperationSchema | null,
  fields: FlowApiOperationSchemaField[],
): Promise<Record<string, FlowDynamicValueOption[]>> {
  const dynamicFields = fields.filter((field) => field.dynamicValues);
  if (!dynamicFields.length) return {};
  const apiRef = dynamicApiRef(target.operationRef, schema);
  if (!apiRef) return {};
  const parameters = readConnectorParameters(target.action);
  const dynamicParameters = pickDynamicParameters(dynamicFields.map((field) => field.dynamicValues), parameters);
  const entries = await Promise.all(dynamicFields.map(async (field) => {
    const values = await cachedDynamicOptions(environment, apiRef, target.operationRef.connectionName, field.dynamicValues, dynamicParameters);
    return [fieldSchemaKey(field), values] as const;
  }));
  return Object.fromEntries(entries.filter(([, values]) => values.length));
}

async function loadDynamicOutputSchemaFields(
  environment: string,
  target: FlowEditorSchemaActionTarget,
  schema: FlowApiOperationSchema | null,
): Promise<Record<string, FlowApiOperationSchemaField[]>> {
  const dynamicFields = collectDynamicOutputFields(schema);
  if (!dynamicFields.length) return {};
  const apiRef = dynamicApiRef(target.operationRef, schema);
  if (!apiRef) return {};
  const parameters = readConnectorParameters(target.action);
  const dynamicParameters = pickDynamicParameters(dynamicFields.map((field) => field.dynamicSchema), parameters);
  if (hasExpressionLikeParameter(dynamicParameters)) return {};

  const entries = await Promise.all(dynamicFields.map(async (field) => {
    try {
      const key = outputPathKey(field.path || []);
      const values = await cachedDynamicOutputSchemaFields(environment, apiRef, target.operationRef.connectionName, field, dynamicParameters);
      return [key, values] as const;
    } catch {
      return [outputPathKey(field.path || []), []] as const;
    }
  }));
  return Object.fromEntries(entries.filter(([, values]) => values.length));
}

function cachedDynamicSchemaFields(
  environment: string,
  apiRef: string,
  connectionName: string | undefined,
  field: FlowApiOperationSchemaField,
  parameters: Record<string, unknown>,
): Promise<FlowApiOperationSchemaField[]> {
  const key = stableCacheKey(['schema', environment, apiRef, connectionName || '', fieldSchemaKey(field), field.dynamicSchema, parameters]);
  let promise = dynamicSchemaCache.get(key);
  if (!promise) {
    promise = loadFlowDynamicProperties(environment, apiRef, connectionName, field, parameters)
      .catch((error) => {
        dynamicSchemaCache.delete(key);
        throw error;
      });
    dynamicSchemaCache.set(key, promise);
  }
  return promise;
}

function cachedDynamicOutputSchemaFields(
  environment: string,
  apiRef: string,
  connectionName: string | undefined,
  field: FlowApiOperationSchemaField,
  parameters: Record<string, unknown>,
): Promise<FlowApiOperationSchemaField[]> {
  const contextParameterAlias = outputPathKey(field.path || []);
  const key = stableCacheKey(['output-schema', environment, apiRef, connectionName || '', contextParameterAlias, field.dynamicSchema, parameters]);
  let promise = dynamicSchemaCache.get(key);
  if (!promise) {
    promise = loadFlowDynamicProperties(environment, apiRef, connectionName, field, parameters, {
      location: 'output',
      contextParameterAlias,
    })
      .catch((error) => {
        dynamicSchemaCache.delete(key);
        throw error;
      });
    dynamicSchemaCache.set(key, promise);
  }
  return promise;
}

function cachedDynamicOptions(
  environment: string,
  apiRef: string,
  connectionName: string | undefined,
  dynamicValues: unknown,
  parameters: Record<string, unknown>,
): Promise<FlowDynamicValueOption[]> {
  const key = stableCacheKey(['options', environment, apiRef, connectionName || '', dynamicValues, parameters]);
  let promise = dynamicOptionsCache.get(key);
  if (!promise) {
    promise = loadFlowDynamicEnum(environment, apiRef, connectionName, dynamicValues, parameters)
      .catch((error) => {
        dynamicOptionsCache.delete(key);
        throw error;
      });
    dynamicOptionsCache.set(key, promise);
  }
  return promise;
}

function fieldKeyCompletions(entry: FlowEditorSchemaActionEntry, parentPath: string[], currentName: string | undefined): FlowEditorSchemaCompletionItem[] {
  const existing = existingKeysAtPath(entry.action, parentPath);
  return entry.fields
    .filter((field) => pathsEqual(connectorFieldPath(field).slice(0, -1), parentPath))
    .filter((field) => !existing.has(field.name) || field.name === currentName)
    .sort((left, right) => fieldSortKey(left).localeCompare(fieldSortKey(right)))
    .map((field) => ({
      label: field.name,
      kind: 'property' as const,
      detail: fieldDetail(field),
      documentation: field.description || undefined,
      insertText: escapeJsonStringContent(field.name),
      sortText: fieldSortKey(field),
    }));
}

function fieldValueCompletions(entry: FlowEditorSchemaActionEntry, valuePath: string[]): FlowEditorSchemaCompletionItem[] {
  const fields = entry.fields.filter((field) => pathsEqual(connectorFieldPath(field), valuePath));
  const completions: FlowEditorSchemaCompletionItem[] = [];
  for (const field of fields) {
    const options = [
      ...(field.enum || []).map((value) => ({ value, title: undefined as string | undefined })),
      ...(entry.options[fieldSchemaKey(field)] || []),
    ];
    for (const option of options) {
      completions.push({
        label: option.title ? `${option.title} (${option.value})` : option.value,
        kind: 'value',
        detail: fieldDetail(field),
        documentation: option.title || field.description || undefined,
        insertText: escapeJsonStringContent(option.value),
        sortText: `${field.required ? '10' : '20'}_${field.name}_${String(option.title || option.value).toLowerCase()}`,
      });
    }
    if (!options.length) {
      for (const fallback of fallbackValueCompletions(field)) completions.push(fallback);
    }
  }
  return completions;
}

function fallbackValueCompletions(field: FlowApiOperationSchemaField): FlowEditorSchemaCompletionItem[] {
  if (field.defaultValue !== undefined && field.defaultValue !== null) {
    const value = typeof field.defaultValue === 'string' ? field.defaultValue : JSON.stringify(field.defaultValue);
    return [{
      label: value,
      kind: 'value',
      detail: fieldDetail(field),
      documentation: field.description || undefined,
      insertText: escapeJsonStringContent(value),
      sortText: `${field.required ? '30' : '40'}_${field.name}_default`,
    }];
  }
  if (field.type === 'boolean') {
    return ['true', 'false'].map((value, index) => ({
      label: value,
      kind: 'value' as const,
      detail: fieldDetail(field),
      documentation: field.description || undefined,
      insertText: value,
      sortText: `${field.required ? '30' : '40'}_${field.name}_${index}`,
    }));
  }
  return [];
}

function collectDynamicOutputFields(schema: FlowApiOperationSchema | null): FlowApiOperationSchemaField[] {
  const response = preferredResponse(schema);
  if (!response?.schema) return [];
  const fields: FlowApiOperationSchemaField[] = [];
  collectDynamicOutputFieldsFromSchema(response.schema, responseHasBodyEnvelope(response) ? [] : ['body'], fields);
  return mergeOutputFields(fields);
}

function collectDynamicOutputFieldsFromSchema(schema: unknown, path: string[], fields: FlowApiOperationSchemaField[]): void {
  if (!isObject(schema)) return;
  const dynamicSchema = schema['x-ms-dynamic-properties'] || schema['x-ms-dynamic-schema'];
  if (dynamicSchema) {
    fields.push({
      name: outputPathKey(path),
      location: 'output',
      path,
      type: typeof schema.type === 'string' ? schema.type : undefined,
      schema,
      dynamicSchema,
    });
  }

  if (isObject(schema.items)) {
    collectDynamicOutputFieldsFromSchema(schema.items, path, fields);
  }
  if (isObject(schema.properties)) {
    for (const [name, value] of Object.entries(schema.properties)) {
      collectDynamicOutputFieldsFromSchema(value, [...path, name], fields);
    }
  }
}

function mergeOutputFields(fields: FlowApiOperationSchemaField[]): FlowApiOperationSchemaField[] {
  const seen = new Set<string>();
  const result: FlowApiOperationSchemaField[] = [];
  for (const field of fields) {
    const key = `${outputPathKey(field.path || [])}:${stableCacheKey(field.dynamicSchema)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(field);
  }
  return result;
}

function readAccessorBase(value: string): AccessorBase | null {
  const match = value.match(/^\s*(body|outputs)\(\s*'((?:''|[^'])*)'\s*\)/i);
  const functionName = match?.[1]?.toLowerCase();
  const actionName = match?.[2]?.replace(/''/g, "'");
  if ((functionName !== 'body' && functionName !== 'outputs') || !actionName) return null;
  return { functionName, actionName };
}

function schemaNodeForLegacyAccessor(
  index: FlowEditorSchemaIndex,
  baseExpression: string,
  segments: string[],
): { entry: FlowEditorSchemaActionEntry; schema: unknown; path: string[] } | null {
  const base = readAccessorBase(baseExpression);
  if (!base) return null;
  const entry = index.byActionName[base.actionName];
  if (!entry || entry.status !== 'ready' || !entry.schema?.responses?.length) return null;
  const root = rootSchemaForAccessorBase(entry.schema, base.functionName);
  if (!root) return null;
  const resolved = schemaNodeForAccessorSegments(root.schema, root.path, segments);
  return resolved ? { entry, ...resolved } : null;
}

function schemaNodeForExpression(
  index: FlowEditorSchemaIndex,
  node: FlowExpressionNode,
): { entry: FlowEditorSchemaActionEntry; schema: unknown; path: string[] } | null {
  if (node.kind === 'call') return schemaNodeForCallExpression(index, node);
  if (node.kind === 'access') {
    const target = schemaNodeForExpression(index, node.target);
    if (!target) return null;
    const property = node.property;
    if (property.kind === 'number') {
      const itemSchema = arrayItemSchema(target.schema);
      return itemSchema ? { ...target, schema: itemSchema } : null;
    }
    if (property.kind !== 'string' && property.kind !== 'identifier') return null;
    const accessed = schemaPropertyAccess(target.schema, property.value);
    if (!accessed) return null;
    return {
      ...target,
      schema: accessed.schema,
      path: [...target.path, property.value],
    };
  }
  return null;
}

function schemaNodeForCallExpression(
  index: FlowEditorSchemaIndex,
  node: FlowExpressionCallNode,
): { entry: FlowEditorSchemaActionEntry; schema: unknown; path: string[] } | null {
  const functionName = node.name.toLowerCase();
  if (functionName === 'body' || functionName === 'outputs') {
    const actionName = firstStringArgument(node);
    if (!actionName) return null;
    const entry = index.byActionName[actionName];
    if (!entry || entry.status !== 'ready' || !entry.schema?.responses?.length) return null;
    const root = rootSchemaForAccessorBase(entry.schema, functionName);
    return root ? { entry, ...root } : null;
  }

  if (functionName === 'first' || functionName === 'last') {
    const collection = node.args[0] ? schemaNodeForExpression(index, node.args[0]) : null;
    if (!collection) return null;
    const itemSchema = arrayItemSchema(collection.schema);
    return itemSchema ? { ...collection, schema: itemSchema } : null;
  }

  if (functionName === 'coalesce') {
    for (const arg of node.args) {
      const resolved = schemaNodeForExpression(index, arg);
      if (resolved) return resolved;
    }
  }

  if (functionName === 'if') {
    for (const arg of node.args.slice(1)) {
      const resolved = schemaNodeForExpression(index, arg);
      if (resolved) return resolved;
    }
  }

  return null;
}

function firstStringArgument(node: FlowExpressionCallNode): string | undefined {
  const arg = node.args[0];
  return arg?.kind === 'string' ? arg.value : undefined;
}

function rootSchemaForAccessorBase(schema: FlowApiOperationSchema, functionName: AccessorBase['functionName']): AccessorRoot | null {
  const response = preferredResponse(schema);
  if (!response?.schema) return null;
  if (functionName === 'body') {
    return {
      schema: response.bodySchema || schemaProperty(response.schema, 'body') || response.schema,
      path: ['body'],
    };
  }
  if (responseHasBodyEnvelope(response)) {
    return { schema: response.schema, path: [] };
  }
  return {
    schema: {
      type: 'object',
      properties: {
        body: response.bodySchema || response.schema,
      },
    },
    path: [],
  };
}

function preferredResponse(schema: FlowApiOperationSchema | null): NonNullable<FlowApiOperationSchema['responses']>[number] | undefined {
  const responses = schema?.responses || [];
  return responses.find((item) => item.statusCode === '200')
    || responses.find((item) => /^2\d\d$/.test(item.statusCode))
    || responses.find((item) => item.statusCode === 'default')
    || responses[0];
}

function responseHasBodyEnvelope(response: NonNullable<FlowApiOperationSchema['responses']>[number]): boolean {
  return schemaProperty(response.schema, 'body') !== undefined;
}

function schemaNodeForAccessorSegments(
  root: unknown,
  initialPath: string[],
  segments: string[],
): { schema: unknown; path: string[] } | null {
  let schema = root;
  let path = initialPath;
  for (const segment of segments) {
    const property = schemaPropertyAccess(schema, segment);
    if (!property) return null;
    schema = property.schema;
    path = [...path, segment];
  }
  return { schema, path };
}

function schemaPropertyAccess(schema: unknown, segment: string): { schema: unknown } | null {
  const container = propertyContainerSchema(schema);
  const property = schemaProperty(container, segment);
  return property === undefined ? null : { schema: property };
}

function arrayItemSchema(schema: unknown): unknown {
  return isObject(schema) && isObject(schema.items) ? schema.items : undefined;
}

function outputSchemaCompletions(
  entry: FlowEditorSchemaActionEntry,
  schema: unknown,
  path: string[],
  prefix: string,
): FlowEditorSchemaCompletionItem[] {
  const container = propertyContainerSchema(schema);
  const dynamicFields = entry.outputFields?.[outputPathKey(path)] || [];
  const items = new Map<string, FlowEditorSchemaCompletionItem>();

  for (const field of dynamicFields) {
    items.set(field.name, outputFieldCompletion(field, true));
  }
  const properties = schemaProperties(container);
  if (properties) {
    for (const [name, property] of Object.entries(properties)) {
      if (!isObject(property) || outputPropertyVisibility(property) === 'internal') continue;
      if (!items.has(name)) items.set(name, outputPropertyCompletion(name, property));
    }
  }

  return filterSchemaOutputCompletions([...items.values()], prefix);
}

function outputFieldCompletion(field: FlowApiOperationSchemaField, dynamic: boolean): FlowEditorSchemaCompletionItem {
  return {
    label: field.name,
    kind: 'property',
    detail: outputFieldDetail(field, dynamic),
    documentation: field.description || undefined,
    insertText: escapeWdlStringContent(field.name),
    sortText: `${field.visibility === 'important' ? '10' : '20'}_${field.name.toLowerCase()}`,
  };
}

function outputPropertyCompletion(name: string, schema: Record<string, unknown>): FlowEditorSchemaCompletionItem {
  const field: FlowApiOperationSchemaField = {
    name,
    location: 'output',
    type: typeof schema.type === 'string' ? schema.type : undefined,
    title: firstString(schema['x-ms-summary'], schema.title),
    description: typeof schema.description === 'string' ? schema.description : undefined,
    visibility: outputPropertyVisibility(schema),
    schema,
  };
  return outputFieldCompletion(field, false);
}

function outputFieldDetail(field: FlowApiOperationSchemaField, dynamic: boolean): string {
  const parts = [
    dynamic ? 'Dynamic output' : 'Output',
    field.title,
    field.type || schemaType(field.schema),
  ].filter(Boolean);
  return parts.join(' · ');
}

function filterSchemaOutputCompletions(items: FlowEditorSchemaCompletionItem[], prefix: string): FlowEditorSchemaCompletionItem[] {
  const normalized = prefix.toLowerCase();
  const filtered = normalized ? items.filter((item) => item.label.toLowerCase().includes(normalized)) : items;
  return filtered
    .sort((left, right) => outputCompletionScore(left, normalized) - outputCompletionScore(right, normalized))
    .slice(0, 80);
}

function outputCompletionScore(item: FlowEditorSchemaCompletionItem, prefix: string): number {
  const sortRank = item.sortText?.startsWith('10_') ? -10 : 0;
  if (!prefix) return sortRank;
  const label = item.label.toLowerCase();
  if (label.startsWith(prefix)) return sortRank;
  const index = label.indexOf(prefix);
  return index >= 0 ? index + 5 + sortRank : 1000 + sortRank;
}

function propertyContainerSchema(schema: unknown): unknown {
  const node = isObject(schema) ? schema : {};
  if (isObject(node.items) && (node.type === 'array' || !isObject(node.properties))) return node.items;
  return node;
}

function schemaProperty(schema: unknown, name: string): unknown {
  const properties = schemaProperties(schema);
  return properties ? properties[name] : undefined;
}

function schemaProperties(schema: unknown): Record<string, unknown> | undefined {
  return isObject(schema) && isObject(schema.properties) ? schema.properties : undefined;
}

function outputPropertyVisibility(schema: Record<string, unknown>): string | undefined {
  return firstString(schema['x-ms-visibility']);
}

function schemaType(schema: unknown): string | undefined {
  return isObject(schema) && typeof schema.type === 'string' ? schema.type : undefined;
}

function outputPathKey(path: string[]): string {
  return path.length ? path.join('/') : 'body';
}

function escapeWdlStringContent(value: string): string {
  return value.replace(/'/g, "''");
}

function hasExpressionLikeParameter(parameters: Record<string, unknown>): boolean {
  return Object.values(parameters).some((value) => typeof value === 'string' && value.trim().startsWith('@'));
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function fieldSortKey(field: FlowApiOperationSchemaField): string {
  return `${field.required ? '10' : '20'}_${connectorFieldPath(field).join('.')}_${field.name}`;
}

function schemaEntryForContext(cursor: number, context: FlowEditorCursorContext, index: FlowEditorSchemaIndex): FlowEditorSchemaActionEntry | undefined {
  if (context.nearestAction && index.byActionName[context.nearestAction]) return index.byActionName[context.nearestAction];
  return index.actions
    .filter((entry) => cursor >= entry.from && cursor <= entry.to)
    .sort((left, right) => (left.to - left.from) - (right.to - right.from))[0];
}

function actionRelativePath(path: string[], actionName: string): string[] {
  const index = path.lastIndexOf(actionName);
  return index >= 0 ? path.slice(index + 1) : [];
}

function existingKeysAtPath(action: Record<string, unknown>, path: string[]): Set<string> {
  let current: unknown = action;
  for (const segment of path) {
    if (!isObject(current)) return new Set();
    current = current[segment];
  }
  return isObject(current) ? new Set(Object.keys(current)) : new Set();
}

function fieldDetail(field: FlowApiOperationSchemaField): string {
  const parts = [
    field.required ? 'Required' : undefined,
    field.title,
    field.type,
    connectorFieldPath(field).join('.'),
  ].filter(Boolean);
  return parts.join(' · ');
}

function loadingEntry(target: FlowEditorSchemaActionTarget): FlowEditorSchemaActionEntry {
  return {
    ...target,
    schema: null,
    fields: [],
    options: {},
    status: 'loading',
  };
}

function actionTargetsMatch(entry: FlowEditorSchemaActionEntry, target: FlowEditorSchemaActionTarget): boolean {
  return entry.operationRef.apiRef === target.operationRef.apiRef
    && entry.operationRef.operationId === target.operationRef.operationId
    && entry.operationRef.connectionName === target.operationRef.connectionName;
}

function analyzeFlowIfPossible(source: string): FlowAnalysis | null {
  if (!source.trim()) return null;
  try {
    return analyzeFlow(source, 0);
  } catch {
    return null;
  }
}

function flattenOutline(items: FlowAnalysisOutlineItem[]): FlowAnalysisOutlineItem[] {
  return items.flatMap((item) => [item, ...flattenOutline(item.children || [])]);
}

function isConnectorActionType(value: unknown): boolean {
  return value === 'OpenApiConnection' || value === 'ApiConnection';
}

function pathsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function escapeJsonStringContent(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function stableCacheKey(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
