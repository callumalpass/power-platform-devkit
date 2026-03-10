import { FLOW_CONNECTOR_OPERATION_REGISTRY } from './generated/connector-operation-registry.generated';

export type FlowSupportedConnectorOperationParameterBucket = 'parameters' | 'queries' | 'pathParameters';
export type FlowSupportedConnectorOperationParameterKind = 'string' | 'integer' | 'boolean' | 'record' | 'binary';

export interface FlowSupportedConnectorOperationParameter {
  name: string;
  kind: FlowSupportedConnectorOperationParameterKind;
  bucket?: FlowSupportedConnectorOperationParameterBucket;
  buckets?: FlowSupportedConnectorOperationParameterBucket[];
  required?: boolean;
  allowPrefixedFields?: boolean;
}

export interface FlowSupportedConnectorOperation {
  apiId: string;
  operationId: string;
  parameters: FlowSupportedConnectorOperationParameter[];
}

export interface FlowConnectorOperationRegistryDocument {
  generatedAt: string;
  sourcePath: string;
  sourcePaths?: string[];
  derivedOperationCount?: number;
  overlayOperationCount?: number;
  operations: FlowSupportedConnectorOperation[];
}

const operationIndex = new Map<string, FlowSupportedConnectorOperation>(
  FLOW_CONNECTOR_OPERATION_REGISTRY.operations.map((operation) => [buildOperationKey(operation.apiId, operation.operationId), operation])
);

function buildOperationKey(apiId: string, operationId: string): string {
  return `${normalizeConnectorApiId(apiId) ?? ''}::${normalizeConnectorOperationId(operationId) ?? ''}`;
}

export function normalizeConnectorApiId(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

export function normalizeConnectorOperationId(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

export function listFlowSupportedConnectorOperations(): FlowSupportedConnectorOperation[] {
  return FLOW_CONNECTOR_OPERATION_REGISTRY.operations;
}

export function getFlowConnectorOperationRegistryMetadata(): Pick<
  FlowConnectorOperationRegistryDocument,
  'generatedAt' | 'sourcePath' | 'sourcePaths' | 'derivedOperationCount' | 'overlayOperationCount'
> {
  return {
    generatedAt: FLOW_CONNECTOR_OPERATION_REGISTRY.generatedAt,
    sourcePath: FLOW_CONNECTOR_OPERATION_REGISTRY.sourcePath,
    sourcePaths: FLOW_CONNECTOR_OPERATION_REGISTRY.sourcePaths,
    derivedOperationCount: FLOW_CONNECTOR_OPERATION_REGISTRY.derivedOperationCount,
    overlayOperationCount: FLOW_CONNECTOR_OPERATION_REGISTRY.overlayOperationCount,
  };
}

export function resolveFlowSupportedConnectorOperation(
  apiId: string | undefined,
  operationId: string | undefined
): FlowSupportedConnectorOperation | undefined {
  if (!apiId || !operationId) {
    return undefined;
  }

  return operationIndex.get(buildOperationKey(apiId, operationId));
}
