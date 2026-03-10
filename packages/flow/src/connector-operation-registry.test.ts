import { describe, expect, it } from 'vitest';
import {
  getFlowConnectorOperationRegistryMetadata,
  listFlowSupportedConnectorOperations,
  resolveFlowSupportedConnectorOperation,
} from './connector-operation-registry';

describe('flow connector operation registry', () => {
  it('resolves supported operations through the generated registry index', () => {
    const operation = resolveFlowSupportedConnectorOperation(
      '/providers/microsoft.powerapps/apis/shared_sharepointonline',
      'GetItems'
    );

    expect(operation).toMatchObject({
      apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
      operationId: 'GetItems',
    });
    expect(operation?.parameters.map((parameter) => parameter.name)).toContain('$top');
  });

  it('exposes generated registry metadata and inventory', () => {
    const metadata = getFlowConnectorOperationRegistryMetadata();
    const operations = listFlowSupportedConnectorOperations();

    expect(metadata.sourcePath).toBe('packages/flow/connector-operation-registry.source.json');
    expect(new Date(metadata.generatedAt).toISOString()).toBe(metadata.generatedAt);
    expect(operations.length).toBeGreaterThan(10);
  });
});
