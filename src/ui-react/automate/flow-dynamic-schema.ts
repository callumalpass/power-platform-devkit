import { useEffect, useMemo, useState } from 'react';
import { loadFlowDynamicEnum, loadFlowDynamicProperties } from '../automate-data.js';
import { prop } from '../utils.js';
import type { FlowApiOperationSchema, FlowApiOperationSchemaField, FlowDynamicValueOption, ToastFn } from '../ui-types.js';
import { firstNonEmptyString, isObject, type FlowActionOperationRef } from './flow-action-document.js';

export function useFlowDynamicOptions(
  environment: string,
  action: Record<string, unknown> | null,
  schema: FlowApiOperationSchema | null,
  operationRef: FlowActionOperationRef,
  toast: ToastFn
): Record<string, FlowDynamicValueOption[]> {
  const [options, setOptions] = useState<Record<string, FlowDynamicValueOption[]>>({});
  const fields = useMemo(() => visibleConnectorSchemaFields(schema?.fields || []).filter((field) => field.dynamicValues), [schema]);
  const parameters = useMemo(() => readConnectorParameters(action), [action]);
  const dynamicParameters = useMemo(
    () =>
      pickDynamicParameters(
        fields.map((field) => field.dynamicValues),
        parameters
      ),
    [fields, parameters]
  );
  const apiRef = dynamicApiRef(operationRef, schema);
  const signature = useMemo(
    () =>
      JSON.stringify({
        environment,
        apiRef,
        connectionName: operationRef.connectionName,
        fields: fields.map((field) => [fieldSchemaKey(field), field.dynamicValues]),
        parameters: dynamicParameters
      }),
    [apiRef, dynamicParameters, environment, fields, operationRef.connectionName]
  );

  useEffect(() => {
    let cancelled = false;
    if (!environment || !apiRef || !fields.length) {
      setOptions({});
      return;
    }
    void Promise.all(
      fields.map(async (field) => {
        const values = await loadFlowDynamicEnum(environment, apiRef, operationRef.connectionName, field.dynamicValues, dynamicParameters);
        return [fieldSchemaKey(field), values] as const;
      })
    )
      .then((entries) => {
        if (cancelled) return;
        setOptions(Object.fromEntries(entries.filter(([, values]) => values.length)));
      })
      .catch((error) => {
        if (!cancelled) toast(error instanceof Error ? error.message : String(error), true);
      });
    return () => {
      cancelled = true;
    };
  }, [apiRef, environment, fields, operationRef.connectionName, signature, toast]);

  return options;
}

export function useFlowDynamicSchemaFields(
  environment: string,
  action: Record<string, unknown> | null,
  schema: FlowApiOperationSchema | null,
  operationRef: FlowActionOperationRef,
  toast: ToastFn
): Record<string, FlowApiOperationSchemaField[]> {
  const [fieldsByParent, setFieldsByParent] = useState<Record<string, FlowApiOperationSchemaField[]>>({});
  const fields = useMemo(() => visibleConnectorSchemaFields(schema?.fields || []).filter((field) => field.dynamicSchema), [schema]);
  const parameters = useMemo(() => readConnectorParameters(action), [action]);
  const dynamicParameters = useMemo(
    () =>
      pickDynamicParameters(
        fields.map((field) => field.dynamicSchema),
        parameters
      ),
    [fields, parameters]
  );
  const apiRef = dynamicApiRef(operationRef, schema);
  const signature = useMemo(
    () =>
      JSON.stringify({
        environment,
        apiRef,
        connectionName: operationRef.connectionName,
        fields: fields.map((field) => [fieldSchemaKey(field), field.dynamicSchema]),
        parameters: dynamicParameters
      }),
    [apiRef, dynamicParameters, environment, fields, operationRef.connectionName]
  );

  useEffect(() => {
    let cancelled = false;
    if (!environment || !apiRef || !fields.length) {
      setFieldsByParent({});
      return;
    }
    void Promise.all(
      fields.map(async (field) => {
        const values = await loadFlowDynamicProperties(environment, apiRef, operationRef.connectionName, field, dynamicParameters);
        return [fieldSchemaKey(field), values] as const;
      })
    )
      .then((entries) => {
        if (cancelled) return;
        setFieldsByParent(Object.fromEntries(entries.filter(([, values]) => values.length)));
      })
      .catch((error) => {
        if (!cancelled) toast(error instanceof Error ? error.message : String(error), true);
      });
    return () => {
      cancelled = true;
    };
  }, [apiRef, environment, fields, operationRef.connectionName, signature, toast]);

  return fieldsByParent;
}

export function expandDynamicSchemaFields(fields: FlowApiOperationSchemaField[], dynamicFields: Record<string, FlowApiOperationSchemaField[]>): FlowApiOperationSchemaField[] {
  return fields.flatMap((field) => {
    const expanded = dynamicFields[fieldSchemaKey(field)] || [];
    return expanded.length ? expanded : [field];
  });
}

export function readConnectorParameters(action: Record<string, unknown> | null): Record<string, unknown> {
  const parameters = prop(action || {}, 'inputs.parameters');
  return isObject(parameters) ? parameters : {};
}

export function pickDynamicParameters(metadatas: unknown[], parameters: Record<string, unknown>): Record<string, unknown> {
  const refs = new Set<string>();
  for (const metadata of metadatas) {
    for (const ref of dynamicParameterReferences(metadata)) refs.add(ref);
  }
  const result: Record<string, unknown> = {};
  for (const ref of refs) {
    if (Object.prototype.hasOwnProperty.call(parameters, ref)) result[ref] = parameters[ref];
  }
  return result;
}

export function dynamicParameterReferences(metadata: unknown): string[] {
  const rawParameters = prop(metadata, 'parameters');
  if (!isObject(rawParameters)) return [];
  return Object.entries(rawParameters).flatMap(([name, raw]) => {
    if (typeof raw === 'string') return raw ? [raw] : [];
    if (!isObject(raw)) return [];
    const ref = firstNonEmptyString(raw.parameterReference, raw.parameter, raw.name, raw.value, name);
    return ref ? [ref] : [];
  });
}

export function fieldSchemaKey(field: FlowApiOperationSchemaField) {
  return `${field.location || 'parameter'}:${(field.path || []).join('.')}:${field.name}`;
}

export function dynamicApiRef(operationRef: FlowActionOperationRef, schema: FlowApiOperationSchema | null): string | undefined {
  return operationRef.apiId || operationRef.apiRef || operationRef.apiName || schema?.apiId || schema?.apiName;
}

export function groupConnectorFields(fields: FlowApiOperationSchemaField[]): Array<{ location: string; fields: FlowApiOperationSchemaField[] }> {
  const order = ['path', 'query', 'body', 'header', 'parameter', 'internal'];
  const groups = new Map<string, FlowApiOperationSchemaField[]>();
  for (const field of fields) {
    const location = field.visibility === 'internal' ? 'internal' : field.location || 'parameter';
    if (!groups.has(location)) groups.set(location, []);
    groups.get(location)!.push(field);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => (order.indexOf(left) < 0 ? 99 : order.indexOf(left)) - (order.indexOf(right) < 0 ? 99 : order.indexOf(right)))
    .map(([location, groupFields]) => ({ location, fields: groupFields }));
}

export function visibleConnectorSchemaFields(fields: FlowApiOperationSchemaField[]) {
  return fields.filter((field) => field.visibility !== 'internal' && field.name !== 'connectionId');
}

export function connectorLocationLabel(location: string) {
  const labels: Record<string, string> = {
    path: 'Path',
    query: 'Query',
    body: 'Body',
    header: 'Headers',
    parameter: 'Parameters',
    internal: 'Internal'
  };
  return labels[location] || location;
}

export function summarizeDynamicMetadata(field: FlowApiOperationSchemaField) {
  if (isObject(field.dynamicValues)) {
    const operationId = prop(field.dynamicValues, 'operationId');
    return operationId ? `Dynamic values from ${operationId}.` : 'Dynamic values are available.';
  }
  if (field.dynamicSchema) return 'Dynamic schema is available.';
  return '';
}
