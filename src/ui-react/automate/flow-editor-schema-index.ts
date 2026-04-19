import { useEffect, useState } from 'react';
import { loadFlowApiOperationSchema, loadFlowDynamicEnum, loadFlowDynamicProperties } from '../automate-data.js';
import type { FlowAnalysis, FlowAnalysisOutlineItem, FlowApiOperationSchema, FlowApiOperationSchemaField, FlowDynamicValueOption, ToastFn } from '../ui-types.js';
import { analyzeFlow } from '../../flow-language.js';
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
};

type FlowEditorCursorContext = {
  kind?: string;
  path?: string[];
  nearestAction?: string;
  propertyName?: string;
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

async function loadFlowEditorSchemaEntry(environment: string, target: FlowEditorSchemaActionTarget): Promise<FlowEditorSchemaActionEntry> {
  try {
    const schema = await cachedOperationSchema(environment, target.operationRef.apiRef, target.operationRef.operationId);
    const baseFields = visibleConnectorSchemaFields(schema?.fields || []);
    const dynamicFields = await loadDynamicSchemaFields(environment, target, schema, baseFields);
    const fields = visibleConnectorSchemaFields(expandDynamicSchemaFields(baseFields, dynamicFields));
    const options = await loadDynamicOptions(environment, target, schema, fields);
    return {
      ...target,
      schema,
      fields,
      options,
      status: 'ready',
    };
  } catch (error) {
    return {
      ...target,
      schema: null,
      fields: [],
      options: {},
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
    .map((field) => ({
      label: field.name,
      kind: 'property' as const,
      detail: fieldDetail(field),
      documentation: field.description || undefined,
      insertText: escapeJsonStringContent(field.name),
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
      });
    }
  }
  return completions;
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
