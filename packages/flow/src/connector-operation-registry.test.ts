import { describe, expect, it } from 'vitest';
import {
  getFlowConnectorOperationRegistryMetadata,
  listFlowSupportedConnectorOperations,
  resolveFlowSupportedConnectorOperation,
} from './connector-operation-registry';
import { deriveFlowConnectorOperationsFromOpenApiSource } from './connector-operation-registry-ingestion';

describe('flow connector operation registry', () => {
  it('derives bounded connector contracts from checked-in openapi snapshots', () => {
    const operations = deriveFlowConnectorOperationsFromOpenApiSource({
      apiId: '/providers/microsoft.powerapps/apis/shared_office365',
      document: {
        swagger: '2.0',
        paths: {
          '/mail/send': {
            post: {
              operationId: 'SendEmailV2',
              parameters: [
                {
                  name: 'body',
                  in: 'body',
                  required: true,
                  schema: {
                    type: 'object',
                    properties: {
                      emailMessage: {
                        type: 'object',
                        required: ['To'],
                        properties: {
                          To: { type: 'string' },
                          Subject: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    });

    expect(operations).toEqual([
      {
        apiId: '/providers/microsoft.powerapps/apis/shared_office365',
        operationId: 'SendEmailV2',
        parameters: [
          { name: 'emailMessage/Subject', kind: 'string' },
          { name: 'emailMessage/To', kind: 'string', required: true },
        ],
      },
    ]);
  });

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

    expect(metadata.sourcePath).toBe('packages/flow/connector-operation-openapi.source.json');
    expect(metadata.sourcePaths).toEqual([
      'packages/flow/connector-operation-openapi.source.json',
      'packages/flow/connector-operation-registry.source.json',
    ]);
    expect(metadata.derivedOperationCount).toBeGreaterThan(0);
    expect(metadata.overlayOperationCount).toBeGreaterThan(10);
    expect(new Date(metadata.generatedAt).toISOString()).toBe(metadata.generatedAt);
    expect(operations.length).toBeGreaterThan(10);
  });
});
