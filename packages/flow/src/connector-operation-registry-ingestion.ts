import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import type {
  FlowConnectorOperationRegistryDocument,
  FlowSupportedConnectorOperation,
  FlowSupportedConnectorOperationParameter,
  FlowSupportedConnectorOperationParameterBucket,
  FlowSupportedConnectorOperationParameterKind,
} from './connector-operation-registry';

interface OpenApiParameter {
  name?: string;
  in?: string;
  required?: boolean;
  type?: string;
  format?: string;
  schema?: OpenApiSchema;
}

interface OpenApiOperation {
  operationId?: string;
  parameters?: OpenApiParameter[];
}

interface OpenApiPathItem {
  get?: OpenApiOperation;
  put?: OpenApiOperation;
  post?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
}

interface OpenApiDocument {
  swagger?: string;
  openapi?: string;
  paths?: Record<string, OpenApiPathItem>;
}

interface OpenApiSchema {
  type?: string;
  format?: string;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
}

export interface FlowConnectorOperationOpenApiSource {
  apiId: string;
  sourcePath: string;
  includeOperations?: string[];
  bucketMode?: 'native' | 'flattened' | 'native-plus-parameters';
}

export interface FlowConnectorOperationOpenApiSourceManifest {
  sources: FlowConnectorOperationOpenApiSource[];
}

export interface FlowConnectorOperationOverlayDocument {
  operations: FlowSupportedConnectorOperation[];
}

export interface FlowConnectorOperationRegistryBuildResult {
  metadata: Pick<
    FlowConnectorOperationRegistryDocument,
    'sourcePath' | 'sourcePaths' | 'derivedOperationCount' | 'overlayOperationCount'
  >;
  operations: FlowSupportedConnectorOperation[];
}

const OPERATION_METHODS = ['get', 'put', 'post', 'patch', 'delete'] as const;

export async function readFlowConnectorOperationOpenApiManifest(
  path: string
): Promise<FlowConnectorOperationOpenApiSourceManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as FlowConnectorOperationOpenApiSourceManifest;
}

export async function readFlowConnectorOperationOverlayDocument(
  path: string
): Promise<FlowConnectorOperationOverlayDocument> {
  return JSON.parse(await readFile(path, 'utf8')) as FlowConnectorOperationOverlayDocument;
}

export async function buildFlowConnectorOperationRegistryFromSources(options: {
  packageRoot: string;
  manifestPath: string;
  overlayPath: string;
}): Promise<FlowConnectorOperationRegistryBuildResult> {
  const manifest = await readFlowConnectorOperationOpenApiManifest(options.manifestPath);
  const overlay = await readFlowConnectorOperationOverlayDocument(options.overlayPath);
  const derivedOperations = await collectDerivedOperations(manifest, options.packageRoot);

  return buildFlowConnectorOperationRegistry({
    manifestPath: options.manifestPath,
    overlayPath: options.overlayPath,
    derivedOperations,
    overlayOperations: overlay.operations,
  });
}

export function buildFlowConnectorOperationRegistry(input: {
  manifestPath: string;
  overlayPath: string;
  derivedOperations: FlowSupportedConnectorOperation[];
  overlayOperations: FlowSupportedConnectorOperation[];
}): FlowConnectorOperationRegistryBuildResult {
  return {
    metadata: {
      sourcePath: 'packages/flow/connector-operation-openapi.source.json',
      sourcePaths: [
        'packages/flow/connector-operation-openapi.source.json',
        'packages/flow/connector-operation-registry.source.json',
      ],
      derivedOperationCount: input.derivedOperations.length,
      overlayOperationCount: input.overlayOperations.length,
    },
    operations: mergeFlowConnectorOperations(input.derivedOperations, input.overlayOperations),
  };
}

export function deriveFlowConnectorOperationsFromOpenApiSource(input: {
  apiId: string;
  document: OpenApiDocument;
  includeOperations?: string[];
  bucketMode?: FlowConnectorOperationOpenApiSource['bucketMode'];
}): FlowSupportedConnectorOperation[] {
  const includedOperationIds = input.includeOperations ? new Set(input.includeOperations) : undefined;
  const operations: FlowSupportedConnectorOperation[] = [];

  for (const pathItem of Object.values(input.document.paths ?? {})) {
    for (const method of OPERATION_METHODS) {
      const operation = pathItem?.[method];

      if (!operation?.operationId) {
        continue;
      }

      if (includedOperationIds && !includedOperationIds.has(operation.operationId)) {
        continue;
      }

      operations.push({
        apiId: input.apiId,
        operationId: operation.operationId,
        parameters: normalizeOpenApiOperationParameters(operation.parameters ?? [], input.bucketMode),
      });
    }
  }

  return operations.sort(compareOperations);
}

export function mergeFlowConnectorOperations(
  derivedOperations: FlowSupportedConnectorOperation[],
  overlayOperations: FlowSupportedConnectorOperation[]
): FlowSupportedConnectorOperation[] {
  const index = new Map<string, FlowSupportedConnectorOperation>();

  for (const operation of derivedOperations) {
    index.set(buildOperationKey(operation), operation);
  }

  for (const operation of overlayOperations) {
    index.set(buildOperationKey(operation), operation);
  }

  return Array.from(index.values()).sort(compareOperations);
}

async function collectDerivedOperations(
  manifest: FlowConnectorOperationOpenApiSourceManifest,
  packageRoot: string
): Promise<FlowSupportedConnectorOperation[]> {
  const operations: FlowSupportedConnectorOperation[] = [];

  for (const source of manifest.sources) {
    const documentPath = resolvePath(packageRoot, source.sourcePath);
    const document = JSON.parse(await readFile(documentPath, 'utf8')) as OpenApiDocument;
    operations.push(
      ...deriveFlowConnectorOperationsFromOpenApiSource({
        apiId: source.apiId,
        document,
        includeOperations: source.includeOperations,
        bucketMode: source.bucketMode,
      })
    );
  }

  return operations.sort(compareOperations);
}

function normalizeOpenApiOperationParameters(
  parameters: OpenApiParameter[],
  bucketMode: FlowConnectorOperationOpenApiSource['bucketMode'] = 'native'
): FlowSupportedConnectorOperationParameter[] {
  const collected: FlowSupportedConnectorOperationParameter[] = [];

  for (const parameter of parameters) {
    const location = normalizeBucket(parameter.in, bucketMode);

    if (parameter.in === 'body' && parameter.schema) {
      collected.push(...flattenBodySchema(parameter.schema, '', location, parameter.required ?? false));
      continue;
    }

    const name = parameter.name?.trim();

    if (!name) {
      continue;
    }

    collected.push({
      name,
      kind: normalizeSchemaKind(parameter.schema, parameter.type, parameter.format),
      ...(location.bucket === 'parameters' ? {} : { bucket: location.bucket }),
      ...(location.buckets ? { buckets: location.buckets } : {}),
      required: parameter.required ? true : undefined,
    });
  }

  return dedupeAndSortParameters(collected);
}

function flattenBodySchema(
  schema: OpenApiSchema,
  prefix: string,
  bucket: {
    bucket: FlowSupportedConnectorOperationParameterBucket;
    buckets?: FlowSupportedConnectorOperationParameterBucket[];
  },
  required: boolean
): FlowSupportedConnectorOperationParameter[] {
  const properties = schema.properties ?? {};
  const propertyEntries = Object.entries(properties);

  if (schema.type === 'object' && propertyEntries.length > 0) {
    const requiredProperties = new Set(schema.required ?? []);
    const collected: FlowSupportedConnectorOperationParameter[] = [];

    for (const [propertyName, propertySchema] of propertyEntries) {
      const propertyPath = prefix ? `${prefix}/${propertyName}` : propertyName;
      const propertyRequired = requiredProperties.has(propertyName);
      collected.push(...flattenBodySchema(propertySchema, propertyPath, bucket, propertyRequired));
    }

    return collected;
  }

  if (!prefix) {
    return [];
  }

  return [
    {
      name: prefix,
      kind: normalizeSchemaKind(schema),
      ...(bucket.bucket === 'parameters' ? {} : { bucket: bucket.bucket }),
      ...(bucket.buckets ? { buckets: bucket.buckets } : {}),
      required: required ? true : undefined,
    },
  ];
}

function normalizeSchemaKind(
  schema: OpenApiSchema | undefined,
  fallbackType?: string,
  fallbackFormat?: string
): FlowSupportedConnectorOperationParameterKind {
  const type = schema?.type ?? fallbackType;
  const format = schema?.format ?? fallbackFormat;

  if (type === 'integer' || format === 'int32' || format === 'int64') {
    return 'integer';
  }

  if (type === 'boolean') {
    return 'boolean';
  }

  if (type === 'file' || format === 'binary' || format === 'byte') {
    return 'binary';
  }

  if (type === 'object') {
    return 'record';
  }

  return 'string';
}

function normalizeBucket(
  value: string | undefined,
  bucketMode: FlowConnectorOperationOpenApiSource['bucketMode']
): {
  bucket: FlowSupportedConnectorOperationParameterBucket;
  buckets?: FlowSupportedConnectorOperationParameterBucket[];
} {
  const normalized =
    value === 'query' ? 'queries' : value === 'path' ? 'pathParameters' : ('parameters' as FlowSupportedConnectorOperationParameterBucket);

  if (bucketMode === 'flattened') {
    return {
      bucket: 'parameters',
    };
  }

  if (bucketMode === 'native-plus-parameters' && normalized !== 'parameters') {
    return {
      bucket: 'parameters',
      buckets: ['parameters', normalized],
    };
  }

  return {
    bucket: normalized,
  };
}

function dedupeAndSortParameters(
  parameters: FlowSupportedConnectorOperationParameter[]
): FlowSupportedConnectorOperationParameter[] {
  const index = new Map<string, FlowSupportedConnectorOperationParameter>();

  for (const parameter of parameters) {
    index.set(buildParameterKey(parameter), parameter);
  }

  return Array.from(index.values()).sort(compareParameters);
}

function buildOperationKey(operation: FlowSupportedConnectorOperation): string {
  return `${operation.apiId}::${operation.operationId}`;
}

function buildParameterKey(parameter: FlowSupportedConnectorOperationParameter): string {
  return `${parameter.bucket ?? 'parameters'}::${parameter.name}`;
}

function compareOperations(left: FlowSupportedConnectorOperation, right: FlowSupportedConnectorOperation): number {
  return left.apiId.localeCompare(right.apiId) || left.operationId.localeCompare(right.operationId);
}

function compareParameters(
  left: FlowSupportedConnectorOperationParameter,
  right: FlowSupportedConnectorOperationParameter
): number {
  return (
    (left.bucket ?? 'parameters').localeCompare(right.bucket ?? 'parameters') || left.name.localeCompare(right.name)
  );
}
