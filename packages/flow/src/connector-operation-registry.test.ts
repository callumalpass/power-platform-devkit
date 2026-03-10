import { describe, expect, it } from 'vitest';
import {
  getFlowConnectorOperationRegistryMetadata,
  listFlowSupportedConnectorOperations,
  resolveFlowSupportedConnectorOperation,
} from './connector-operation-registry';
import {
  deriveFlowConnectorOperationsFromOpenApiSource,
  mergeFlowConnectorOperations,
} from './connector-operation-registry-ingestion';

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

  it('can flatten query and path parameters onto the canonical parameters bucket', () => {
    const operations = deriveFlowConnectorOperationsFromOpenApiSource({
      apiId: '/providers/microsoft.powerapps/apis/shared_office365',
      bucketMode: 'flattened',
      document: {
        swagger: '2.0',
        paths: {
          '/messages/{messageId}': {
            get: {
              operationId: 'GetEmailV2',
              parameters: [
                {
                  name: 'messageId',
                  in: 'path',
                  required: true,
                  type: 'string',
                },
                {
                  name: 'mailboxAddress',
                  in: 'query',
                  type: 'string',
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
        operationId: 'GetEmailV2',
        parameters: [
          { name: 'mailboxAddress', kind: 'string' },
          { name: 'messageId', kind: 'string', required: true },
        ],
      },
    ]);
  });

  it('can preserve native buckets while also accepting compact parameters buckets', () => {
    const operations = deriveFlowConnectorOperationsFromOpenApiSource({
      apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
      bucketMode: 'native-plus-parameters',
      document: {
        swagger: '2.0',
        paths: {
          '/tables/{entityName}/items/{recordId}': {
            get: {
              operationId: 'GetItem',
              parameters: [
                {
                  name: 'entityName',
                  in: 'path',
                  required: true,
                  type: 'string',
                },
                {
                  name: 'recordId',
                  in: 'path',
                  required: true,
                  type: 'string',
                },
                {
                  name: '$select',
                  in: 'query',
                  type: 'string',
                },
              ],
            },
          },
        },
      },
    });

    expect(operations).toEqual([
      {
        apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
        operationId: 'GetItem',
        parameters: [
          { name: 'entityName', kind: 'string', buckets: ['parameters', 'pathParameters'], required: true },
          { name: 'recordId', kind: 'string', buckets: ['parameters', 'pathParameters'], required: true },
          { name: '$select', kind: 'string', buckets: ['parameters', 'queries'] },
        ],
      },
    ]);
  });

  it('can augment snapshot-derived operations with bounded manifest-only parameters', () => {
    const operations = deriveFlowConnectorOperationsFromOpenApiSource({
      apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
      bucketMode: 'native-plus-parameters',
      operationParameterAugmentations: {
        ListRecords: [{ name: 'x-ms-odata-metadata-full', kind: 'boolean', buckets: ['parameters', 'queries'] }],
      },
      document: {
        swagger: '2.0',
        paths: {
          '/tables/{entityName}/rows': {
            get: {
              operationId: 'ListRecords',
              parameters: [
                {
                  name: 'entityName',
                  in: 'path',
                  required: true,
                  type: 'string',
                },
                {
                  name: '$top',
                  in: 'query',
                  type: 'integer',
                  format: 'int32',
                },
              ],
            },
          },
        },
      },
    });

    expect(operations).toEqual([
      {
        apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
        operationId: 'ListRecords',
        parameters: [
          { name: 'entityName', kind: 'string', buckets: ['parameters', 'pathParameters'], required: true },
          { name: '$top', kind: 'integer', buckets: ['parameters', 'queries'] },
          { name: 'x-ms-odata-metadata-full', kind: 'boolean', buckets: ['parameters', 'queries'] },
        ],
      },
    ]);
  });

  it('merges overlay parameters onto derived operations instead of replacing them wholesale', () => {
    const operations = mergeFlowConnectorOperations(
      [
        {
          apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
          operationId: 'ListRecords',
          parameters: [
            { name: 'entityName', kind: 'string', buckets: ['parameters', 'pathParameters'], required: true },
            { name: '$top', kind: 'integer', buckets: ['parameters', 'queries'] },
          ],
        },
      ],
      [
        {
          apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
          operationId: 'ListRecords',
          parameters: [{ name: 'x-ms-odata-metadata-full', kind: 'boolean', buckets: ['parameters', 'queries'] }],
        },
      ]
    );

    expect(operations).toEqual([
      {
        apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
        operationId: 'ListRecords',
        parameters: [
          { name: 'entityName', kind: 'string', buckets: ['parameters', 'pathParameters'], required: true },
          { name: '$top', kind: 'integer', buckets: ['parameters', 'queries'] },
          { name: 'x-ms-odata-metadata-full', kind: 'boolean', buckets: ['parameters', 'queries'] },
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

  it('keeps derived Dataverse list parameters when a manifest augmentation adds metadata flags', () => {
    const operation = resolveFlowSupportedConnectorOperation(
      '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
      'ListRecords'
    );

    expect(operation).toMatchObject({
      apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
      operationId: 'ListRecords',
    });
    expect(operation?.parameters.map((parameter) => parameter.name)).toEqual(
      expect.arrayContaining(['entityName', '$top', 'returntotalrecordcount', 'x-ms-odata-metadata-full'])
    );
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
    expect(metadata.overlayOperationCount).toBeGreaterThan(0);
    expect(new Date(metadata.generatedAt).toISOString()).toBe(metadata.generatedAt);
    expect(operations.length).toBeGreaterThan(10);
  });
});
