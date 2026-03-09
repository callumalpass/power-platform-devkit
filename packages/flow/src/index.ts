import { stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { readJsonFile, sha256Hex, stableStringify, writeJsonFile } from '@pp/artifacts';
import { type DataverseClient } from '@pp/dataverse';
import { createDiagnostic, fail, ok, type Diagnostic, type OperationResult } from '@pp/diagnostics';
import { SolutionService } from '@pp/solution';

export type FlowJsonValue = null | boolean | number | string | FlowJsonValue[] | { [key: string]: FlowJsonValue };

export interface FlowRecord {
  workflowid: string;
  name?: string;
  category?: number;
  statecode?: number;
  statuscode?: number;
  uniquename?: string;
  clientdata?: string;
}

export interface FlowConnectionReference {
  name: string;
  connectionReferenceLogicalName?: string;
  connectionId?: string;
  apiId?: string;
}

export interface FlowSummary {
  id: string;
  name?: string;
  uniqueName?: string;
  category?: number;
  stateCode?: number;
  statusCode?: number;
  definitionAvailable: boolean;
  connectionReferences: FlowConnectionReference[];
  parameters: string[];
  environmentVariables: string[];
}

export interface FlowInspectResult extends FlowSummary {
  clientData?: Record<string, FlowJsonValue>;
}

export interface FlowArtifact {
  schemaVersion: 1;
  kind: 'pp.flow.artifact';
  metadata: {
    id?: string;
    name?: string;
    displayName?: string;
    uniqueName?: string;
    stateCode?: number;
    statusCode?: number;
    sourcePath?: string;
    connectionReferences: FlowConnectionReference[];
    parameters: Record<string, FlowJsonValue>;
    environmentVariables: string[];
  };
  definition: Record<string, FlowJsonValue>;
  unknown?: Record<string, FlowJsonValue>;
}

export interface FlowArtifactSummary {
  path: string;
  normalized: boolean;
  name?: string;
  definitionHash: string;
  connectionReferenceCount: number;
  parameterCount: number;
  environmentVariableCount: number;
}

export interface FlowValidationReport {
  valid: boolean;
  path: string;
  name?: string;
  connectionReferences: FlowConnectionReference[];
  parameters: string[];
  environmentVariables: string[];
}

export interface FlowPatchDocument {
  connectionReferences?: Record<string, string>;
  parameters?: Record<string, FlowJsonValue>;
  expressions?: Record<string, string>;
  values?: Record<string, FlowJsonValue>;
}

export interface FlowUnpackResult {
  inputPath: string;
  outPath: string;
  summary: FlowArtifactSummary;
}

export interface FlowPatchResult {
  path: string;
  outPath: string;
  changed: boolean;
  appliedOperations: string[];
  summary: FlowArtifactSummary;
}

const NOISY_FLOW_KEYS = new Set([
  'createdTime',
  'lastModifiedTime',
  'changedTime',
  'lastModifiedBy',
  'creator',
  'owners',
]);

export class FlowService {
  constructor(private readonly dataverseClient?: DataverseClient) {}

  async list(options: { solutionUniqueName?: string } = {}): Promise<OperationResult<FlowSummary[]>> {
    if (!this.dataverseClient) {
      return fail(
        createDiagnostic('error', 'FLOW_DATAVERSE_CLIENT_REQUIRED', 'Dataverse client is required for remote flow listing.', {
          source: '@pp/flow',
        })
      );
    }

    const workflows = await this.dataverseClient.queryAll<FlowRecord>({
      table: 'workflows',
      select: ['workflowid', 'name', 'category', 'statecode', 'statuscode', 'uniquename', 'clientdata'],
      filter: 'category eq 5',
    });

    if (!workflows.success) {
      return workflows as unknown as OperationResult<FlowSummary[]>;
    }

    let allowedIds: Set<string> | undefined;
    let diagnostics = workflows.diagnostics;
    let warnings = workflows.warnings;

    if (options.solutionUniqueName) {
      const components = await new SolutionService(this.dataverseClient).components(options.solutionUniqueName);

      if (!components.success) {
        return components as unknown as OperationResult<FlowSummary[]>;
      }

      allowedIds = new Set(
        (components.data ?? [])
          .filter((component) => component.componentType === 29 && component.objectId)
          .map((component) => component.objectId as string)
      );
      diagnostics = [...diagnostics, ...components.diagnostics];
      warnings = [...warnings, ...components.warnings];
    }

    const records = (workflows.data ?? [])
      .filter((record) => !allowedIds || allowedIds.has(record.workflowid))
      .map((record) => normalizeRemoteFlow(record));

    return ok(records, {
      supportTier: 'preview',
      diagnostics,
      warnings,
    });
  }

  async inspect(identifier: string, options: { solutionUniqueName?: string } = {}): Promise<OperationResult<FlowInspectResult | undefined>> {
    const flows = await this.list(options);

    if (!flows.success) {
      return flows as unknown as OperationResult<FlowInspectResult | undefined>;
    }

    const match = (flows.data ?? []).find(
      (flow) => flow.id === identifier || flow.name === identifier || flow.uniqueName === identifier
    );

    return ok(match, {
      supportTier: 'preview',
      diagnostics: flows.diagnostics,
      warnings: flows.warnings,
    });
  }

  async loadArtifact(path: string): Promise<OperationResult<FlowArtifact>> {
    return loadFlowArtifact(path);
  }

  async inspectArtifact(path: string): Promise<OperationResult<FlowArtifactSummary>> {
    return inspectFlowArtifact(path);
  }

  async unpack(inputPath: string, outPath: string): Promise<OperationResult<FlowUnpackResult>> {
    return unpackFlowArtifact(inputPath, outPath);
  }

  async normalize(path: string, outPath?: string): Promise<OperationResult<FlowUnpackResult>> {
    return normalizeFlowArtifact(path, outPath);
  }

  async validate(path: string): Promise<OperationResult<FlowValidationReport>> {
    return validateFlowArtifact(path);
  }

  async patch(path: string, patch: FlowPatchDocument, outPath?: string): Promise<OperationResult<FlowPatchResult>> {
    return patchFlowArtifact(path, patch, outPath);
  }
}

export async function loadFlowArtifact(path: string): Promise<OperationResult<FlowArtifact>> {
  const resolvedPath = await resolveFlowArtifactPath(path);

  if (!resolvedPath.success || !resolvedPath.data) {
    return resolvedPath as unknown as OperationResult<FlowArtifact>;
  }

  const document = await readFlowJsonFile(resolvedPath.data);

  if (!document.success || document.data === undefined) {
    return document as unknown as OperationResult<FlowArtifact>;
  }

  return normalizeFlowArtifactDocument(document.data, resolvedPath.data);
}

export async function inspectFlowArtifact(path: string): Promise<OperationResult<FlowArtifactSummary>> {
  const artifact = await loadFlowArtifact(path);

  if (!artifact.success || !artifact.data) {
    return artifact as unknown as OperationResult<FlowArtifactSummary>;
  }

  return ok(buildFlowArtifactSummary(path, artifact.data), {
    supportTier: 'preview',
    diagnostics: artifact.diagnostics,
    warnings: artifact.warnings,
  });
}

export async function unpackFlowArtifact(inputPath: string, outPath: string): Promise<OperationResult<FlowUnpackResult>> {
  const artifact = await loadFlowArtifact(inputPath);

  if (!artifact.success || !artifact.data) {
    return artifact as unknown as OperationResult<FlowUnpackResult>;
  }

  const destination = resolveFlowOutputPath(outPath);
  await writeJsonFile(destination, artifact.data as unknown as Parameters<typeof writeJsonFile>[1]);

  return ok(
    {
      inputPath,
      outPath: destination,
      summary: buildFlowArtifactSummary(destination, artifact.data),
    },
    {
      supportTier: 'preview',
      diagnostics: artifact.diagnostics,
      warnings: artifact.warnings,
    }
  );
}

export async function normalizeFlowArtifact(path: string, outPath?: string): Promise<OperationResult<FlowUnpackResult>> {
  const artifact = await loadFlowArtifact(path);

  if (!artifact.success || !artifact.data) {
    return artifact as unknown as OperationResult<FlowUnpackResult>;
  }

  const destination = resolveFlowOutputPath(outPath ?? path);
  await writeJsonFile(destination, artifact.data as unknown as Parameters<typeof writeJsonFile>[1]);

  return ok(
    {
      inputPath: path,
      outPath: destination,
      summary: buildFlowArtifactSummary(destination, artifact.data),
    },
    {
      supportTier: 'preview',
      diagnostics: artifact.diagnostics,
      warnings: artifact.warnings,
    }
  );
}

export async function validateFlowArtifact(path: string): Promise<OperationResult<FlowValidationReport>> {
  const artifact = await loadFlowArtifact(path);

  if (!artifact.success || !artifact.data) {
    return artifact as unknown as OperationResult<FlowValidationReport>;
  }

  const diagnostics: Diagnostic[] = [];
  const seenConnrefs = new Set<string>();

  if (!artifact.data.metadata.name && !artifact.data.metadata.displayName) {
    diagnostics.push(
      createDiagnostic('error', 'FLOW_ARTIFACT_NAME_MISSING', `Flow artifact ${path} does not define a name or displayName.`, {
        source: '@pp/flow',
      })
    );
  }

  if (Object.keys(artifact.data.definition).length === 0) {
    diagnostics.push(
      createDiagnostic('error', 'FLOW_DEFINITION_MISSING', `Flow artifact ${path} does not include a definition payload.`, {
        source: '@pp/flow',
      })
    );
  }

  for (const reference of artifact.data.metadata.connectionReferences) {
    if (!reference.name) {
      diagnostics.push(
        createDiagnostic('error', 'FLOW_CONNREF_NAME_MISSING', `Flow artifact ${path} contains a connection reference with no name.`, {
          source: '@pp/flow',
        })
      );
      continue;
    }

    if (seenConnrefs.has(reference.name)) {
      diagnostics.push(
        createDiagnostic('error', 'FLOW_CONNREF_DUPLICATE', `Flow artifact ${path} contains duplicate connection reference ${reference.name}.`, {
          source: '@pp/flow',
        })
      );
    }

    seenConnrefs.add(reference.name);
  }

  return ok(
    {
      valid: diagnostics.length === 0,
      path,
      name: artifact.data.metadata.displayName ?? artifact.data.metadata.name,
      connectionReferences: artifact.data.metadata.connectionReferences,
      parameters: Object.keys(artifact.data.metadata.parameters).sort(),
      environmentVariables: artifact.data.metadata.environmentVariables,
    },
    {
      supportTier: 'preview',
      diagnostics,
      warnings: artifact.warnings,
    }
  );
}

export async function patchFlowArtifact(
  path: string,
  patch: FlowPatchDocument,
  outPath?: string
): Promise<OperationResult<FlowPatchResult>> {
  const artifact = await loadFlowArtifact(path);

  if (!artifact.success || !artifact.data) {
    return artifact as unknown as OperationResult<FlowPatchResult>;
  }

  const cloned = cloneJsonValue(artifact.data) as FlowArtifact;
  const appliedOperations: string[] = [];

  for (const [from, to] of Object.entries(patch.connectionReferences ?? {})) {
    renameConnectionReference(cloned, from, to);
    appliedOperations.push(`connectionReference:${from}->${to}`);
  }

  for (const [name, value] of Object.entries(patch.parameters ?? {})) {
    cloned.metadata.parameters[name] = normalizeFlowJsonValue(value);
    setFlowPathValue(cloned.definition, ['parameters', name, 'defaultValue'], normalizeFlowJsonValue(value));
    appliedOperations.push(`parameter:${name}`);
  }

  for (const [pathExpression, expression] of Object.entries(patch.expressions ?? {})) {
    setFlowPathValue(cloned.definition, parseFlowPath(pathExpression), expression);
    appliedOperations.push(`expression:${pathExpression}`);
  }

  for (const [pathExpression, value] of Object.entries(patch.values ?? {})) {
    setFlowPathValue(cloned.definition, parseFlowPath(pathExpression), normalizeFlowJsonValue(value));
    appliedOperations.push(`value:${pathExpression}`);
  }

  const destination = resolveFlowOutputPath(outPath ?? path);
  await writeJsonFile(destination, cloned as unknown as Parameters<typeof writeJsonFile>[1]);

  return ok(
    {
      path,
      outPath: destination,
      changed: appliedOperations.length > 0,
      appliedOperations,
      summary: buildFlowArtifactSummary(destination, cloned),
    },
    {
      supportTier: 'preview',
      diagnostics: artifact.diagnostics,
      warnings: artifact.warnings,
    }
  );
}

function normalizeRemoteFlow(record: FlowRecord): FlowInspectResult {
  const parsed = parseFlowClientData(record.clientdata);

  return {
    id: record.workflowid,
    name: record.name,
    uniqueName: record.uniquename,
    category: record.category,
    stateCode: record.statecode,
    statusCode: record.statuscode,
    definitionAvailable: parsed.definition !== undefined,
    connectionReferences: parsed.connectionReferences,
    parameters: parsed.parameters,
    environmentVariables: parsed.environmentVariables,
    clientData: parsed.clientData,
  };
}

async function resolveFlowArtifactPath(path: string): Promise<OperationResult<string>> {
  const directPath = resolve(path);

  if (await fileExists(directPath)) {
    const metadata = await stat(directPath);
    return ok(metadata.isDirectory() ? resolve(directPath, 'flow.json') : directPath, {
      supportTier: 'preview',
    });
  }

  const directoryPath = resolve(path, 'flow.json');

  if (await fileExists(directoryPath)) {
    return ok(directoryPath, {
      supportTier: 'preview',
    });
  }

  return fail(
    createDiagnostic('error', 'FLOW_ARTIFACT_NOT_FOUND', `Flow artifact ${path} was not found.`, {
      source: '@pp/flow',
      hint: 'Provide a raw flow export JSON file or a directory containing flow.json.',
    })
  );
}

async function readFlowJsonFile(path: string): Promise<OperationResult<unknown>> {
  try {
    return ok(await readJsonFile<unknown>(path), {
      supportTier: 'preview',
    });
  } catch (error) {
    return fail(
      createDiagnostic('error', 'FLOW_JSON_READ_FAILED', `Failed to read flow JSON from ${path}.`, {
        source: '@pp/flow',
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

function normalizeFlowArtifactDocument(value: unknown, sourcePath: string): OperationResult<FlowArtifact> {
  const record = asRecord(value);

  if (!record) {
    return fail(
      createDiagnostic('error', 'FLOW_ARTIFACT_INVALID', `Flow artifact ${sourcePath} must be a JSON object.`, {
        source: '@pp/flow',
      })
    );
  }

  if (record.kind === 'pp.flow.artifact' && record.schemaVersion === 1) {
    return normalizeCanonicalFlowArtifact(record, sourcePath);
  }

  return normalizeRawFlowArtifact(record, sourcePath);
}

function normalizeCanonicalFlowArtifact(record: Record<string, unknown>, sourcePath: string): OperationResult<FlowArtifact> {
  const metadata = asRecord(record.metadata);
  const definition = asRecord(record.definition);

  if (!metadata || !definition) {
    return fail(
      createDiagnostic('error', 'FLOW_CANONICAL_FIELDS_REQUIRED', `Canonical flow artifact ${sourcePath} must include metadata and definition objects.`, {
        source: '@pp/flow',
      })
    );
  }

  const connectionReferences = normalizeConnectionReferences(metadata.connectionReferences ?? []);
  const parameters = normalizeFlowParameters(metadata.parameters);
  const environmentVariables = collectEnvironmentVariablesFromValue(definition);

  return ok(
    {
      schemaVersion: 1,
      kind: 'pp.flow.artifact',
      metadata: {
        id: readString(metadata.id),
        name: readString(metadata.name),
        displayName: readString(metadata.displayName),
        uniqueName: readString(metadata.uniqueName),
        stateCode: readNumber(metadata.stateCode),
        statusCode: readNumber(metadata.statusCode),
        sourcePath: readString(metadata.sourcePath) ?? sourcePath,
        connectionReferences,
        parameters,
        environmentVariables,
      },
      definition: stripNoisyFlowValue(normalizeFlowJsonRecord(definition)) as Record<string, FlowJsonValue>,
      unknown: asRecord(record.unknown)
        ? (stripNoisyFlowValue(normalizeFlowJsonRecord(record.unknown as Record<string, unknown>)) as Record<string, FlowJsonValue>)
        : undefined,
    },
    {
      supportTier: 'preview',
    }
  );
}

function normalizeRawFlowArtifact(record: Record<string, unknown>, sourcePath: string): OperationResult<FlowArtifact> {
  const properties = asRecord(record.properties) ?? {};
  const definition = asRecord(properties.definition) ?? asRecord(record.definition) ?? {};
  const parsed = parseFlowClientDataFromValue({
    ...record,
    ...properties,
    definition,
  });
  const parameters = {
    ...normalizeFlowParameters(record.parameters),
    ...normalizeFlowParameters(properties.parameters),
    ...Object.fromEntries(parsed.parameters.map((name) => [name, null as FlowJsonValue])),
  };
  const unknown = Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !['properties', 'definition', 'clientdata'].includes(key))
      .map(([key, nested]) => [key, normalizeFlowJsonValue(nested)])
  );

  return ok(
    {
      schemaVersion: 1,
      kind: 'pp.flow.artifact',
      metadata: {
        id: readString(record.id) ?? readString(record.workflowid),
        name: readString(record.name) ?? readString(properties.name),
        displayName: readString(record.displayName) ?? readString(properties.displayName) ?? readString(record.name),
        uniqueName: readString(record.uniquename) ?? readString(properties.uniquename),
        stateCode: readNumber(record.statecode) ?? readNumber(properties.statecode),
        statusCode: readNumber(record.statuscode) ?? readNumber(properties.statuscode),
        sourcePath,
        connectionReferences: parsed.connectionReferences,
        parameters,
        environmentVariables: parsed.environmentVariables,
      },
      definition: stripNoisyFlowValue(normalizeFlowJsonRecord(definition)) as Record<string, FlowJsonValue>,
      unknown: Object.keys(unknown).length > 0 ? (stripNoisyFlowValue(unknown) as Record<string, FlowJsonValue>) : undefined,
    },
    {
      supportTier: 'preview',
    }
  );
}

function buildFlowArtifactSummary(path: string, artifact: FlowArtifact): FlowArtifactSummary {
  return {
    path,
    normalized: true,
    name: artifact.metadata.displayName ?? artifact.metadata.name,
    definitionHash: sha256Hex(stableStringify(artifact.definition as unknown as Parameters<typeof stableStringify>[0])),
    connectionReferenceCount: artifact.metadata.connectionReferences.length,
    parameterCount: Object.keys(artifact.metadata.parameters).length,
    environmentVariableCount: artifact.metadata.environmentVariables.length,
  };
}

function parseFlowClientData(clientdata: string | undefined): {
  clientData?: Record<string, FlowJsonValue>;
  definition?: Record<string, FlowJsonValue>;
  connectionReferences: FlowConnectionReference[];
  parameters: string[];
  environmentVariables: string[];
} {
  if (!clientdata) {
    return {
      connectionReferences: [],
      parameters: [],
      environmentVariables: [],
    };
  }

  try {
    const parsed = JSON.parse(clientdata) as unknown;
    return parseFlowClientDataFromValue(parsed);
  } catch {
    return {
      connectionReferences: [],
      parameters: [],
      environmentVariables: [],
    };
  }
}

function parseFlowClientDataFromValue(value: unknown): {
  clientData?: Record<string, FlowJsonValue>;
  definition?: Record<string, FlowJsonValue>;
  connectionReferences: FlowConnectionReference[];
  parameters: string[];
  environmentVariables: string[];
} {
  const record = asRecord(value);
  const definition = asRecord(record?.definition) ?? asRecord(asRecord(record?.properties)?.definition);
  const definitionParameters = asRecord(definition?.parameters);
  const definitionConnections = asRecord(asRecord(definitionParameters?.['$connections'])?.value);
  const connectionReferences = normalizeConnectionReferences(
    record?.connectionReferences ??
      asRecord(record?.properties)?.connectionReferences ??
      definitionConnections
  );
  const parameterNames = collectParameterNames(definition ?? {});
  const environmentVariables = collectEnvironmentVariablesFromValue(definition ?? {});

  return {
    clientData: record ? (normalizeFlowJsonRecord(record) as Record<string, FlowJsonValue>) : undefined,
    definition: definition ? (normalizeFlowJsonRecord(definition) as Record<string, FlowJsonValue>) : undefined,
    connectionReferences,
    parameters: parameterNames,
    environmentVariables,
  };
}

function normalizeConnectionReferences(value: unknown): FlowConnectionReference[] {
  const records =
    Array.isArray(value)
      ? value
      : asRecord(value)
        ? Object.entries(asRecord(value) ?? {}).map(([key, nested]) => ({ name: key, ...(asRecord(nested) ?? {}) }))
        : [];
  const normalized: FlowConnectionReference[] = [];

  for (const item of records) {
    const record = asRecord(item);

    if (!record) {
      continue;
    }

    const api = asRecord(record.api);
    const name = readString(record.name);

    if (!name) {
      continue;
    }

    normalized.push({
      name,
      connectionReferenceLogicalName:
        readString(record.connectionReferenceLogicalName) ??
        readString(record.connectionreferencelogicalname) ??
        readString(record.logicalName),
      connectionId: readString(record.connectionId) ?? readString(record.id) ?? readString(record.connectionid),
      apiId: readString(record.apiId) ?? readString(api?.id) ?? readString(record.connectorId),
    });
  }

  return normalized.sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeFlowParameters(value: unknown): Record<string, FlowJsonValue> {
  const record = asRecord(value);

  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => {
      const nestedRecord = asRecord(nested);
      const parameterValue = nestedRecord && 'defaultValue' in nestedRecord ? nestedRecord.defaultValue : nested;
      return [key, normalizeFlowJsonValue(parameterValue)];
    })
  );
}

function collectParameterNames(value: Record<string, unknown>): string[] {
  const parameterNames = new Set<string>();
  const definitionParameters = asRecord(value.parameters);

  for (const key of Object.keys(definitionParameters ?? {})) {
    if (key !== '$connections') {
      parameterNames.add(key);
    }
  }

  scanFlowStrings(value, /parameters\('([^']+)'\)/g, (match) => parameterNames.add(match));
  return Array.from(parameterNames).sort();
}

function collectEnvironmentVariablesFromValue(value: unknown): string[] {
  const variables = new Set<string>();
  scanFlowStrings(value, /environmentVariables\('([^']+)'\)/g, (match) => variables.add(match));
  return Array.from(variables).sort();
}

function scanFlowStrings(value: unknown, pattern: RegExp, register: (match: string) => void): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(pattern)) {
      if (match[1]) {
        register(match[1]);
      }
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      scanFlowStrings(item, pattern, register);
    }

    return;
  }

  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      scanFlowStrings(nested, pattern, register);
    }
  }
}

function renameConnectionReference(artifact: FlowArtifact, from: string, to: string): void {
  artifact.metadata.connectionReferences = artifact.metadata.connectionReferences.map((reference) =>
    reference.name === from ? { ...reference, name: to, connectionReferenceLogicalName: to } : reference
  );

  const parameters = asRecord(artifact.definition.parameters);
  const connections = asRecord(parameters?.['$connections']);
  const connectionValues = asRecord(connections?.value);

  if (connectionValues && connectionValues[from] !== undefined) {
    const value = connectionValues[from];
    delete connectionValues[from];
    connectionValues[to] = value as FlowJsonValue;
  }
}

function setFlowPathValue(root: Record<string, FlowJsonValue>, path: string[], value: FlowJsonValue): void {
  let current: FlowJsonValue = root;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index] as string;
    const nextSegment = path[index + 1];

    if (Array.isArray(current)) {
      const arrayIndex = Number(segment);

      if (!Number.isInteger(arrayIndex)) {
        return;
      }

      current[arrayIndex] ??= typeof nextSegment === 'string' && Number.isInteger(Number(nextSegment)) ? [] : {};
      current = current[arrayIndex] as FlowJsonValue;
      continue;
    }

    if (typeof current === 'object' && current !== null) {
      const record = current as Record<string, FlowJsonValue>;
      record[segment] ??= Number.isInteger(Number(nextSegment)) ? [] : {};
      current = record[segment] as FlowJsonValue;
      continue;
    }

    return;
  }

  const finalSegment = path[path.length - 1];

  if (finalSegment === undefined) {
    return;
  }

  if (Array.isArray(current)) {
    const arrayIndex = Number(finalSegment);

    if (Number.isInteger(arrayIndex)) {
      current[arrayIndex] = value;
    }

    return;
  }

  if (typeof current === 'object' && current !== null) {
    (current as Record<string, FlowJsonValue>)[finalSegment] = value;
  }
}

function parseFlowPath(pathExpression: string): string[] {
  return pathExpression
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function resolveFlowOutputPath(path: string): string {
  const resolved = resolve(path);
  return resolved.endsWith('.json') ? resolved : resolve(resolved, 'flow.json');
}

function stripNoisyFlowValue(value: FlowJsonValue): FlowJsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => stripNoisyFlowValue(item));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !NOISY_FLOW_KEYS.has(key))
        .map(([key, nested]) => [key, stripNoisyFlowValue(nested)])
    );
  }

  return value;
}

function normalizeFlowJsonRecord(record: Record<string, unknown>): Record<string, FlowJsonValue> {
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [key, normalizeFlowJsonValue(nested)]));
}

function normalizeFlowJsonValue(value: unknown): FlowJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeFlowJsonValue(item));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, normalizeFlowJsonValue(nested)])
    );
  }

  return String(value);
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
