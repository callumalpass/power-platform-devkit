import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok, type OperationResult } from '@pp/diagnostics';
import type { DataverseClient } from '@pp/dataverse';
import {
  FlowService,
  packFlowArtifact,
  parseFlowIntermediateRepresentation,
  patchFlowArtifact,
  unpackFlowArtifact,
  validateFlowArtifact,
} from './index';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((path) => rm(path, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'pp-flow-'));
  tempDirs.push(path);
  return path;
}

function createStubDataverseClient(): DataverseClient {
  return {
    query: async <T>(options: { table: string }): Promise<OperationResult<T[]>> => {
      if (options.table === 'solutions') {
        return ok(
          [
            {
              solutionid: 'sol-1',
              uniquename: 'Core',
            },
          ] as T[],
          {
            supportTier: 'preview',
          }
        );
      }

      return ok([] as T[], {
        supportTier: 'preview',
      });
    },
    queryAll: async <T>(options: { table: string }): Promise<OperationResult<T[]>> => {
      switch (options.table) {
        case 'workflows':
          return ok(
            [
              {
                workflowid: 'flow-1',
                name: 'Invoice Sync',
                uniquename: 'crd_InvoiceSync',
                category: 5,
                statecode: 1,
                statuscode: 2,
                clientdata: JSON.stringify({
                  definition: {
                    parameters: {
                      '$connections': {
                        value: {
                          shared_office365: {
                            connectionId: '/connections/office365',
                            connectionReferenceLogicalName: 'shared_office365',
                          },
                        },
                      },
                      ApiBaseUrl: {
                        defaultValue: 'https://example.test',
                      },
                    },
                    actions: {
                      SendMail: {
                        inputs: {
                          subject: "@{parameters('ApiBaseUrl')}",
                          body: "@{environmentVariables('pp_ApiUrl')}",
                        },
                      },
                    },
                  },
                }),
              },
              {
                workflowid: 'flow-2',
                name: 'Other Flow',
                uniquename: 'crd_Other',
                category: 5,
              },
            ] as T[],
            {
              supportTier: 'preview',
            }
          );
        case 'solutioncomponents':
          return ok(
            [
              {
                solutioncomponentid: 'comp-1',
                objectid: 'flow-1',
                componenttype: 29,
              },
              {
                solutioncomponentid: 'comp-2',
                objectid: 'env-1',
                componenttype: 380,
              },
            ] as T[],
            {
              supportTier: 'preview',
            }
          );
        case 'flowruns':
          return ok(
            [
              {
                flowrunid: 'run-1',
                workflowid: 'flow-1',
                workflowname: 'Invoice Sync',
                status: 'Failed',
                starttime: '2026-03-09T09:00:00.000Z',
                endtime: '2026-03-09T09:02:00.000Z',
                durationinms: 120000,
                retrycount: 1,
                errorcode: 'ConnectorAuthFailed',
                errormessage: 'shared_office365 connection is not authorized',
              },
              {
                flowrunid: 'run-2',
                workflowid: 'flow-1',
                workflowname: 'Invoice Sync',
                status: 'Succeeded',
                starttime: '2026-03-09T08:00:00.000Z',
                endtime: '2026-03-09T08:01:00.000Z',
                durationinms: 60000,
              },
            ] as T[],
            {
              supportTier: 'preview',
            }
          );
        case 'connectionreferences':
          return ok(
            [
              {
                connectionreferenceid: 'ref-1',
                connectionreferencelogicalname: 'shared_office365',
                connectorid: '/providers/microsoft.powerapps/apis/shared_office365',
                _solutionid_value: 'sol-1',
              },
            ] as T[],
            {
              supportTier: 'preview',
            }
          );
        case 'environmentvariabledefinitions':
          return ok(
            [
              {
                environmentvariabledefinitionid: 'env-1',
                schemaname: 'pp_ApiUrl',
                _solutionid_value: 'sol-1',
              },
            ] as T[],
            {
              supportTier: 'preview',
            }
          );
        case 'environmentvariablevalues':
          return ok([] as T[], {
            supportTier: 'preview',
          });
        default:
          return ok([] as T[], {
            supportTier: 'preview',
          });
      }
    },
  } as unknown as DataverseClient;
}

describe('FlowService', () => {
  it('lists and inspects remote flows with solution filtering', async () => {
    const service = new FlowService(createStubDataverseClient());

    const list = await service.list({
      solutionUniqueName: 'Core',
    });
    const inspect = await service.inspect('Invoice Sync', {
      solutionUniqueName: 'Core',
    });

    expect(list.success).toBe(true);
    expect(list.data).toHaveLength(1);
    expect(list.data?.[0]).toMatchObject({
      id: 'flow-1',
      name: 'Invoice Sync',
      parameters: ['ApiBaseUrl'],
      environmentVariables: ['pp_ApiUrl'],
    });
    expect(inspect.success).toBe(true);
    expect(inspect.data?.connectionReferences[0]).toMatchObject({
      name: 'shared_office365',
    });
  });

  it('unpacks and validates raw flow exports into canonical artifacts', async () => {
    const dir = await createTempDir();
    const rawPath = join(dir, 'invoice-flow.raw.json');

    await writeFile(
      rawPath,
      JSON.stringify(
        {
          name: 'Invoice Flow',
          properties: {
            displayName: 'Invoice Flow',
            definition: {
              parameters: {
                '$connections': {
                  value: {
                    shared_office365: {
                      connectionReferenceLogicalName: 'shared_office365',
                      connectionId: '/connections/office365',
                    },
                  },
                },
                ApiBaseUrl: {
                  defaultValue: 'https://example.test',
                },
              },
              actions: {
                SendMail: {
                  inputs: {
                    body: "@{environmentVariables('pp_ApiUrl')}",
                  },
                },
              },
              lastModifiedTime: '2026-03-09T00:00:00.000Z',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const unpack = await unpackFlowArtifact(rawPath, join(dir, 'artifacts'));
    const validation = await validateFlowArtifact(join(dir, 'artifacts'));

    expect(unpack.success).toBe(true);
    expect(unpack.data?.summary.name).toBe('Invoice Flow');
    expect(validation.success).toBe(true);
    expect(validation.data?.valid).toBe(true);
    expect(validation.data?.environmentVariables).toEqual(['pp_ApiUrl']);
    expect(validation.data?.semanticSummary).toMatchObject({
      actionCount: 1,
      triggerCount: 0,
      scopeCount: 0,
      referenceCounts: {
        parameters: 0,
        environmentVariables: 1,
        actions: 0,
        variables: 0,
      },
    });

    const normalized = JSON.parse(await readFile(join(dir, 'artifacts', 'flow.json'), 'utf8')) as {
      definition: Record<string, unknown>;
    };
    expect(normalized.definition.lastModifiedTime).toBeUndefined();
  });

  it('packs canonical flow artifacts back into a raw export shape without losing normalized semantics', async () => {
    const dir = await createTempDir();
    const rawPath = join(dir, 'invoice-flow.raw.json');
    const unpackedPath = join(dir, 'unpacked');
    const packedPath = join(dir, 'repacked.json');

    await writeFile(
      rawPath,
      JSON.stringify(
        {
          extraTopLevel: {
            preserve: true,
          },
          properties: {
            displayName: 'Invoice Flow',
            name: 'Invoice Flow',
            uniquename: 'crd_InvoiceFlow',
            statecode: 1,
            statuscode: 2,
            definition: {
              parameters: {
                '$connections': {
                  value: {
                    shared_office365: {
                      connectionReferenceLogicalName: 'shared_office365',
                      connectionId: '/connections/office365',
                      apiId: '/providers/microsoft.powerapps/apis/shared_office365',
                    },
                  },
                },
                ApiBaseUrl: {
                  defaultValue: 'https://example.test',
                },
              },
              actions: {
                SendMail: {
                  type: 'Compose',
                  inputs: {
                    body: "@{environmentVariables('pp_ApiUrl')}",
                  },
                },
              },
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const unpack = await unpackFlowArtifact(rawPath, unpackedPath);
    const packed = await packFlowArtifact(unpackedPath, packedPath);
    const reloaded = await validateFlowArtifact(packedPath);
    const packedDocument = JSON.parse(await readFile(packedPath, 'utf8')) as Record<string, unknown>;

    expect(unpack.success).toBe(true);
    expect(packed.success).toBe(true);
    expect(reloaded.success).toBe(true);
    expect(reloaded.data?.valid).toBe(true);
    expect(packed.data).toMatchObject({
      path: unpackedPath,
      outPath: packedPath,
      format: 'raw-json',
    });
    expect(packedDocument).toMatchObject({
      extraTopLevel: {
        preserve: true,
      },
      properties: {
        displayName: 'Invoice Flow',
        name: 'Invoice Flow',
        uniquename: 'crd_InvoiceFlow',
        statecode: 1,
        statuscode: 2,
      },
    });
    expect((packedDocument.properties as { definition: Record<string, unknown> }).definition.lastModifiedTime).toBeUndefined();
  });

  it('accepts supported Dataverse connector parameters across path and query buckets', async () => {
    const dir = await createTempDir();
    const artifactPath = join(dir, 'flow.json');

    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'pp.flow.artifact',
          metadata: {
            name: 'Dataverse Multi Bucket Flow',
            parameters: {},
            environmentVariables: [],
            connectionReferences: [
              {
                name: 'shared_commondataserviceforapps',
                connectionReferenceLogicalName: 'shared_commondataserviceforapps',
                apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
              },
            ],
          },
          definition: {
            parameters: {
              '$connections': {
                value: {
                  shared_commondataserviceforapps: {
                    connectionReferenceLogicalName: 'shared_commondataserviceforapps',
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connectionId: '/connections/dataverse',
                  },
                },
              },
            },
            actions: {
              DataverseGetRow: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetItem',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  pathParameters: {
                    entityName: 'accounts',
                    recordId: '00000000-0000-0000-0000-000000000001',
                  },
                  queries: {
                    '$select': 'name',
                    'x-ms-odata-metadata-full': true,
                  },
                },
              },
              DataverseListRows: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'ListRecords',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  pathParameters: {
                    entityName: 'accounts',
                  },
                  queries: {
                    '$top': 5,
                    '$filter': "name eq 'Contoso'",
                  },
                },
              },
              DataverseCreateRow: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'CreateRecord',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  pathParameters: {
                    entityName: 'accounts',
                  },
                  parameters: {
                    'item/name': 'Contoso',
                    'item/accountnumber': 'A-100',
                  },
                },
              },
              DataverseUpdateRow: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'UpdateOnlyRecord',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  pathParameters: {
                    entityName: 'accounts',
                    recordId: '00000000-0000-0000-0000-000000000001',
                  },
                  parameters: {
                    item: {
                      name: 'Updated Contoso',
                    },
                  },
                  queries: {
                    'x-ms-odata-metadata-full': false,
                  },
                },
              },
              DataverseDeleteRow: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'DeleteRecord',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  pathParameters: {
                    entityName: 'accounts',
                    recordId: '00000000-0000-0000-0000-000000000099',
                  },
                  queries: {
                    partitionId: 'NA',
                  },
                },
              },
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const validation = await validateFlowArtifact(artifactPath);

    expect(validation.success).toBe(true);
    expect(validation.data?.valid).toBe(true);
    expect(validation.diagnostics).toEqual([]);
    expect(validation.warnings).toEqual([]);
  });

  it('accepts supported SharePoint item and file connector parameters', async () => {
    const dir = await createTempDir();
    const artifactPath = join(dir, 'flow.json');

    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'pp.flow.artifact',
          metadata: {
            name: 'SharePoint Connector Flow',
            parameters: {},
            environmentVariables: [],
            connectionReferences: [
              {
                name: 'shared_sharepointonline',
                connectionReferenceLogicalName: 'shared_sharepointonline',
                apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
              },
            ],
          },
          definition: {
            parameters: {
              '$connections': {
                value: {
                  shared_sharepointonline: {
                    connectionReferenceLogicalName: 'shared_sharepointonline',
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connectionId: '/connections/sharepointonline',
                  },
                },
              },
            },
            actions: {
              SharePointGetItem: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetItem',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Documents',
                    id: 42,
                    view: 'All Items',
                  },
                },
              },
              SharePointGetItems: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetItems',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Documents',
                    $filter: "startswith(Title,'Draft')",
                    $top: 25,
                    includeNestedItems: false,
                    limitColumnsByView: "@equals(1, 1)",
                  },
                },
              },
              SharePointPatchItem: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'PatchItem',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Documents',
                    id: 42,
                    'item/Title': 'Updated draft',
                  },
                },
              },
              SharePointDeleteItem: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'DeleteItem',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Documents',
                    id: 43,
                  },
                },
              },
              SharePointCreateFolder: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'CreateNewFolder',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Shared Documents',
                    path: '/Shared Documents/Drafts',
                  },
                },
              },
              SharePointCreateFile: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'CreateFile',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    folderPath: '/Shared Documents/Drafts',
                    name: 'draft.txt',
                    body: {
                      '$content-type': 'text/plain',
                      '$content': "@{base64('hello')}",
                    },
                  },
                },
              },
              SharePointGetFileMetadata: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetFileMetadata',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    id: 'file-42',
                  },
                },
              },
              SharePointGetFileMetadataByPath: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetFileMetadataByPath',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    path: '/Shared Documents/Drafts/draft.txt',
                  },
                },
              },
              SharePointGetFileContent: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetFileContent',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    id: 'file-42',
                    inferContentType: true,
                  },
                },
              },
              SharePointGetFileContentByPath: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetFileContentByPath',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    path: '/Shared Documents/Drafts/draft.txt',
                    inferContentType: '@equals(1, 1)',
                  },
                },
              },
              SharePointGetFileItem: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetFileItem',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Documents',
                    id: 42,
                    view: 'All Documents',
                  },
                },
              },
              SharePointGetFileItems: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetFileItems',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Documents',
                    $orderby: 'Modified desc',
                    $top: 10,
                    folderPath: '/Shared Documents/Drafts',
                    viewScopeOption: 'RecursiveAll',
                  },
                },
              },
              SharePointUpdateFile: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'UpdateFile',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    id: 'file-42',
                    body: '@body(\'SharePointGetFileContent\')',
                  },
                },
              },
              SharePointGetFolderMetadata: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetFolderMetadata',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    id: 'folder-42',
                  },
                },
              },
              SharePointGetFolderMetadataByPath: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetFolderMetadataByPath',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    path: '/Shared Documents/Drafts',
                  },
                },
              },
              SharePointDeleteFile: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'DeleteFile',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    id: 'file-43',
                  },
                },
              },
              SharePointCopyFile: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'CopyFileAsync',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    sourceFileId: 'file-42',
                    destinationDataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    destinationFolderPath: '/Shared Documents/Archive',
                    nameConflictBehavior: 1,
                  },
                },
              },
              SharePointMoveFile: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'MoveFileAsync',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    sourceFileId: 'file-43',
                    destinationDataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    destinationFolderPath: '/Shared Documents/Published',
                    nameConflictBehavior: '@int(1)',
                  },
                },
              },
              SharePointCopyFolder: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'CopyFolderAsync',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    sourceFolderId: 'folder-42',
                    destinationDataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    destinationFolderPath: '/Shared Documents/Archive',
                    nameConflictBehavior: 0,
                  },
                },
              },
              SharePointMoveFolder: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'MoveFolderAsync',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    sourceFolderId: 'folder-43',
                    destinationDataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    destinationFolderPath: '/Shared Documents/Published',
                    nameConflictBehavior: 2,
                  },
                },
              },
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const validation = await validateFlowArtifact(artifactPath);

    expect(validation.success).toBe(true);
    expect(validation.data?.valid).toBe(true);
    expect(validation.diagnostics).toEqual([]);
    expect(validation.warnings).toEqual([]);
  });

  it('summarizes runtime failures and doctor findings from flow runs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T12:00:00.000Z'));

    const service = new FlowService(createStubDataverseClient());

    const runs = await service.runs('Invoice Sync', {
      solutionUniqueName: 'Core',
      since: '7d',
    });
    const errors = await service.errors('Invoice Sync', {
      solutionUniqueName: 'Core',
      since: '7d',
      groupBy: 'connectionReference',
    });
    const connrefs = await service.connrefs('Invoice Sync', {
      solutionUniqueName: 'Core',
      since: '7d',
    });
    const doctor = await service.doctor('Invoice Sync', {
      solutionUniqueName: 'Core',
      since: '7d',
    });

    expect(runs.success).toBe(true);
    expect(runs.data).toHaveLength(2);
    expect(runs.data?.[0]).toMatchObject({
      id: 'run-1',
      status: 'Failed',
      errorCode: 'ConnectorAuthFailed',
    });

    expect(errors.success).toBe(true);
    expect(errors.data?.[0]).toMatchObject({
      group: 'shared_office365',
      count: 1,
    });

    expect(connrefs.success).toBe(true);
    expect(connrefs.data?.connectionReferences[0]).toMatchObject({
      name: 'shared_office365',
      valid: false,
      recentFailures: 1,
    });
    expect(connrefs.data?.environmentVariables[0]).toMatchObject({
      name: 'pp_ApiUrl',
      hasValue: false,
    });

    expect(doctor.success).toBe(true);
    expect(doctor.data?.recentRuns).toMatchObject({
      total: 2,
      failed: 1,
    });
    expect(doctor.data?.invalidConnectionReferences).toHaveLength(0);
    expect(doctor.data?.missingEnvironmentVariables).toHaveLength(1);
    expect(doctor.data?.findings).toContain('Environment variable pp_ApiUrl does not have an effective value.');
  });

  it('validates supported semantic references and reliability settings locally', async () => {
    const dir = await createTempDir();
    const artifactPath = join(dir, 'flow.json');

    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'pp.flow.artifact',
          metadata: {
            name: 'Semantic Diagnostic Flow',
            connectionReferences: [
              {
                name: 'shared_office365',
                connectionReferenceLogicalName: 'shared_office365',
                apiId: '/providers/microsoft.powerapps/apis/shared_office365',
              },
              {
                name: 'shared_declared_only',
                connectionReferenceLogicalName: 'shared_declared_only',
                apiId: '/providers/microsoft.powerapps/apis/shared_declared_only',
              },
              {
                name: 'shared_sharepointonline',
                connectionReferenceLogicalName: 'shared_sharepointonline',
                apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
              },
              {
                name: 'shared_commondataserviceforapps',
                connectionReferenceLogicalName: 'shared_commondataserviceforapps',
                apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
              },
            ],
            parameters: {
              ApiBaseUrl: 'https://example.test',
            },
            environmentVariables: [],
          },
          definition: {
            parameters: {
              '$connections': {
                value: {
                  shared_office365: {
                    connectionReferenceLogicalName: 'shared_office365_runtime',
                    apiId: '/providers/microsoft.powerapps/apis/shared_exchangeonline',
                    connectionId: '/connections/office365',
                  },
                    shared_definition_only: {
                      connectionReferenceLogicalName: 'shared_definition_only',
                      apiId: '/providers/microsoft.powerapps/apis/shared_definition_only',
                      connectionId: '/connections/definition-only',
                    },
                  shared_sharepointonline: {
                    connectionReferenceLogicalName: 'shared_sharepointonline',
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connectionId: '/connections/sharepointonline',
                  },
                  shared_commondataserviceforapps: {
                    connectionReferenceLogicalName: 'shared_commondataserviceforapps',
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connectionId: '/connections/dataverse',
                  },
                },
              },
            },
            triggers: {
              Manual: {
                type: 'Request',
                runtimeConfiguration: {
                  concurrency: {
                    runs: 4,
                  },
                },
              },
            },
            actions: {
              InitCounter: {
                type: 'InitializeVariable',
                inputs: {
                  variables: [
                    {
                      name: 'Counter',
                      type: 'integer',
                      value: 0,
                    },
                  ],
                },
              },
              ComposeBadParam: {
                type: 'Compose',
                runAfter: {
                  MissingStep: ['Succeeded'],
                },
                inputs: "@{parameters('MissingParam')}",
              },
              ComposeBadAction: {
                type: 'Compose',
                inputs: "@{body('MissingAction')}",
              },
              ComposeBadVariable: {
                type: 'Compose',
                inputs: "@{variables('MissingVariable')}",
              },
              RetryHot: {
                type: 'Compose',
                runtimeConfiguration: {
                  retryPolicy: {
                    count: 12,
                  },
                },
                inputs: "@environmentVariables('pp_ApiUrl')",
              },
              ComposeTemplateSummary: {
                type: 'Compose',
                inputs: "Counter @{variables('Counter')} via @{parameters('ApiBaseUrl')}",
              },
              SendMail: {
                type: 'OpenApiConnection',
                inputs: {
                  host: {
                    connection: {
                      name: "@parameters('$connections')['shared_missing']['connectionId']",
                    },
                  },
                },
              },
              ConnectorMismatch: {
                type: 'OpenApiConnection',
                inputs: {
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_office365']['connectionId']",
                    },
                  },
                },
              },
              ConnectorUnsupportedShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'SendEmailV2',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_office365',
                    connection: {
                      name: '/connections/direct-office365',
                    },
                  },
                },
              },
              ConnectorMissingParameters: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'SendEmailV2',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_office365',
                    connection: {
                      name: "@parameters('$connections')['shared_office365']['connectionId']",
                    },
                  },
                  parameters: {
                    'emailMessage/To': 'agent@example.test',
                    'emailMessage/Body': 'Hello from flow validation',
                  },
                },
              },
              ConnectorBadParameterShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'SendEmailV2',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_office365',
                    connection: {
                      name: "@parameters('$connections')['shared_office365']['connectionId']",
                    },
                  },
                  parameters: {
                    'emailMessage/To': ['agent@example.test'],
                    'emailMessage/Subject': 'Subject',
                    'emailMessage/Body': 'Body',
                  },
                },
              },
              SharePointCreateMissingDataset: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'CreateItem',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    table: 'Documents',
                    'item/Title': 'Draft item',
                  },
                },
              },
              SharePointCreateBadTitleShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'CreateItem',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Documents',
                    'item/Title': {
                      value: 'Draft item',
                    },
                  },
                },
              },
              SharePointGetItemMissingId: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetItem',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Documents',
                  },
                },
              },
              SharePointGetItemsMissingTable: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetItems',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    $top: 25,
                  },
                },
              },
              SharePointGetItemsBadLimitColumnsShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetItems',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Documents',
                    limitColumnsByView: {
                      enabled: true,
                    },
                  },
                },
              },
              SharePointPatchItemBadTitleShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'PatchItem',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Documents',
                    id: 42,
                    'item/Title': {
                      value: 'Draft item',
                    },
                  },
                },
              },
              SharePointDeleteItemMissingId: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'DeleteItem',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Documents',
                  },
                },
              },
              SharePointDeleteItemBadIdShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'DeleteItem',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Documents',
                    id: {
                      value: 77,
                    },
                  },
                },
              },
              SharePointCreateFolderMissingPath: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'CreateNewFolder',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Shared Documents',
                  },
                },
              },
              SharePointCreateFileMissingBody: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'CreateFile',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    folderPath: '/Shared Documents/Drafts',
                    name: 'draft.txt',
                  },
                },
              },
              SharePointCreateFileBadBodyShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'CreateFile',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    folderPath: '/Shared Documents/Drafts',
                    name: 'draft.txt',
                    body: {
                      value: 'aGVsbG8=',
                    },
                  },
                },
              },
              SharePointGetFileMetadataByPathBadPathShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetFileMetadataByPath',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    path: {
                      value: '/Shared Documents/Drafts/draft.txt',
                    },
                  },
                },
              },
              SharePointGetFileContentMissingId: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetFileContent',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                  },
                },
              },
              SharePointGetFileItemMissingId: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetFileItem',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Documents',
                  },
                },
              },
              SharePointGetFileItemsBadViewScopeShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetFileItems',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    table: 'Documents',
                    viewScopeOption: {
                      recursive: true,
                    },
                  },
                },
              },
              SharePointUpdateFileBadBodyShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'UpdateFile',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    id: 'file-42',
                    body: ['aGVsbG8='],
                  },
                },
              },
              SharePointGetFolderMetadataMissingId: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetFolderMetadata',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                  },
                },
              },
              SharePointDeleteFileMissingId: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'DeleteFile',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                  },
                },
              },
              SharePointCopyFileMissingDestinationDataset: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'CopyFileAsync',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    sourceFileId: 'file-77',
                    destinationFolderPath: '/Shared Documents/Archive',
                    nameConflictBehavior: 1,
                  },
                },
              },
              SharePointMoveFileBadConflictShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'MoveFileAsync',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    sourceFileId: 'file-78',
                    destinationDataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    destinationFolderPath: '/Shared Documents/Published',
                    nameConflictBehavior: {
                      replace: true,
                    },
                  },
                },
              },
              SharePointCopyFolderMissingSourceFolderId: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'CopyFolderAsync',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    destinationDataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    destinationFolderPath: '/Shared Documents/Archive',
                    nameConflictBehavior: 0,
                  },
                },
              },
              SharePointMoveFolderBadDestinationShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'MoveFolderAsync',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_sharepointonline',
                    connection: {
                      name: "@parameters('$connections')['shared_sharepointonline']['connectionId']",
                    },
                  },
                  parameters: {
                    dataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    sourceFolderId: 'folder-77',
                    destinationDataset: 'https://contoso.sharepoint.com/sites/Engineering',
                    destinationFolderPath: {
                      path: '/Shared Documents/Published',
                    },
                    nameConflictBehavior: 2,
                  },
                },
              },
              DataverseListRowsMissingEntity: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'ListRecords',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  parameters: {
                    $top: 10,
                  },
                },
              },
              DataverseListRowsBadTopShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'ListRecords',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  parameters: {
                    entityName: 'accounts',
                    $top: {
                      value: 10,
                    },
                  },
                },
              },
              DataverseListRowsBadCountShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'ListRecords',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  parameters: {
                    entityName: 'accounts',
                    returntotalrecordcount: ['true'],
                  },
                },
              },
              DataverseGetRowMissingRecordId: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetItem',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  parameters: {
                    entityName: 'accounts',
                  },
                },
              },
              DataverseGetRowBadMetadataShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'GetItem',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  parameters: {
                    entityName: 'accounts',
                    recordId: '00000000-0000-0000-0000-000000000001',
                    'x-ms-odata-metadata-full': {
                      value: true,
                    },
                  },
                },
              },
              DataverseCreateRowMissingItem: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'CreateRecord',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  parameters: {
                    entityName: 'accounts',
                  },
                },
              },
              DataverseCreateRowBadItemFieldShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'CreateRecord',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  parameters: {
                    entityName: 'accounts',
                    'item/name': {
                      value: 'Contoso',
                    },
                  },
                },
              },
              DataverseUpdateRowMissingItem: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'UpdateOnlyRecord',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  parameters: {
                    entityName: 'accounts',
                    recordId: '00000000-0000-0000-0000-000000000010',
                  },
                },
              },
              DataverseUpdateRowBadItemFieldShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'UpdateOnlyRecord',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  parameters: {
                    entityName: 'accounts',
                    recordId: '00000000-0000-0000-0000-000000000011',
                    'item/name': ['Contoso'],
                  },
                },
              },
              DataverseDeleteRowMissingRecordId: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'DeleteRecord',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  pathParameters: {
                    entityName: 'accounts',
                  },
                },
              },
              DataverseDeleteRowBadPartitionShape: {
                type: 'OpenApiConnection',
                inputs: {
                  operationId: 'DeleteRecord',
                  host: {
                    apiId: '/providers/microsoft.powerapps/apis/shared_commondataserviceforapps',
                    connection: {
                      name: "@parameters('$connections')['shared_commondataserviceforapps']['connectionId']",
                    },
                  },
                  pathParameters: {
                    entityName: 'accounts',
                    recordId: '00000000-0000-0000-0000-000000000012',
                  },
                  queries: {
                    partitionId: {
                      value: 'NA',
                    },
                  },
                },
              },
              SetGhost: {
                type: 'SetVariable',
                inputs: {
                  name: 'Ghost',
                  value: 1,
                },
              },
              ScopeA: {
                type: 'Scope',
                actions: {
                  SetCounter: {
                    type: 'SetVariable',
                    inputs: {
                      name: 'Counter',
                      value: "@{variables('Counter')}",
                    },
                  },
                },
              },
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const validation = await validateFlowArtifact(artifactPath);

    expect(validation.success).toBe(true);
    expect(validation.data?.valid).toBe(false);
    expect(validation.data?.semanticSummary).toEqual({
      triggerCount: 1,
      actionCount: 47,
      scopeCount: 1,
      expressionCount: 44,
      templateExpressionCount: 2,
      initializedVariables: ['Counter'],
      variableUsage: {
        reads: 3,
        writes: 3,
      },
      dynamicContentReferenceCount: 44,
      controlFlowEdgeCount: 0,
      referenceCounts: {
        parameters: 2,
        environmentVariables: 1,
        actions: 1,
        variables: 3,
        connectionReferences: 37,
      },
    });
    expect(validation.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'FLOW_RUN_AFTER_TARGET_MISSING',
        'FLOW_CONNECTOR_API_ID_MISMATCH',
        'FLOW_CONNECTOR_OPERATION_ID_MISSING',
        'FLOW_CONNECTOR_PARAMETER_REQUIRED_MISSING',
        'FLOW_CONNECTOR_PARAMETER_SHAPE_UNSUPPORTED',
        'FLOW_CONNECTOR_PARAMETERS_OBJECT_MISSING',
        'FLOW_ACTION_REFERENCE_UNRESOLVED',
        'FLOW_PARAMETER_REFERENCE_UNRESOLVED',
        'FLOW_VARIABLE_REFERENCE_UNRESOLVED',
        'FLOW_CONNECTOR_CONNECTION_REFERENCE_UNSUPPORTED',
        'FLOW_CONNREF_REFERENCE_UNRESOLVED',
        'FLOW_VARIABLE_TARGET_UNRESOLVED',
        'FLOW_CONNREF_DEFINITION_ENTRY_MISSING',
        'FLOW_CONNREF_METADATA_MISSING',
        'FLOW_CONNREF_API_ID_MISMATCH',
        'FLOW_CONNREF_LOGICAL_NAME_MISMATCH',
      ])
    );
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLOW_CONNECTOR_PARAMETER_REQUIRED_MISSING',
        path: 'actions.SharePointDeleteItemMissingId.inputs.parameters.id',
      })
    );
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLOW_CONNECTOR_PARAMETER_SHAPE_UNSUPPORTED',
        path: 'actions.SharePointDeleteItemBadIdShape.inputs.parameters.id',
      })
    );
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLOW_CONNECTOR_PARAMETER_REQUIRED_MISSING',
        path: 'actions.SharePointCreateFolderMissingPath.inputs.parameters.path',
      })
    );
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLOW_CONNECTOR_PARAMETER_SHAPE_UNSUPPORTED',
        path: 'actions.SharePointGetFileMetadataByPathBadPathShape.inputs.parameters.path',
      })
    );
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLOW_CONNECTOR_PARAMETER_REQUIRED_MISSING',
        path: 'actions.SharePointCreateFileMissingBody.inputs.parameters.body',
      })
    );
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLOW_CONNECTOR_PARAMETER_SHAPE_UNSUPPORTED',
        path: 'actions.SharePointUpdateFileBadBodyShape.inputs.parameters.body',
      })
    );
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLOW_CONNECTOR_PARAMETER_REQUIRED_MISSING',
        path: 'actions.SharePointGetFileItemMissingId.inputs.parameters.id',
      })
    );
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLOW_CONNECTOR_PARAMETER_SHAPE_UNSUPPORTED',
        path: 'actions.SharePointGetFileItemsBadViewScopeShape.inputs.parameters.viewScopeOption',
      })
    );
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLOW_CONNECTOR_PARAMETER_REQUIRED_MISSING',
        path: 'actions.SharePointGetFolderMetadataMissingId.inputs.parameters.id',
      })
    );
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLOW_CONNECTOR_PARAMETER_REQUIRED_MISSING',
        path: 'actions.SharePointCopyFileMissingDestinationDataset.inputs.parameters.destinationDataset',
      })
    );
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLOW_CONNECTOR_PARAMETER_SHAPE_UNSUPPORTED',
        path: 'actions.SharePointMoveFileBadConflictShape.inputs.parameters.nameConflictBehavior',
      })
    );
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLOW_CONNECTOR_PARAMETER_REQUIRED_MISSING',
        path: 'actions.SharePointCopyFolderMissingSourceFolderId.inputs.parameters.sourceFolderId',
      })
    );
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLOW_CONNECTOR_PARAMETER_SHAPE_UNSUPPORTED',
        path: 'actions.SharePointMoveFolderBadDestinationShape.inputs.parameters.destinationFolderPath',
      })
    );
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLOW_CONNECTOR_PARAMETER_REQUIRED_MISSING',
        path: 'actions.DataverseDeleteRowMissingRecordId.inputs.parameters.recordId',
      })
    );
    expect(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FLOW_CONNECTOR_PARAMETER_SHAPE_UNSUPPORTED',
        path: 'actions.DataverseDeleteRowBadPartitionShape.inputs.queries.partitionId',
      })
    );
    expect(validation.warnings.map((item) => item.code)).toEqual([
      'FLOW_RETRY_POLICY_HIGH',
      'FLOW_TRIGGER_CONCURRENCY_ENABLED',
    ]);
    expect(validation.data?.intermediateRepresentation).toEqual({
      nodeCount: 48,
      triggerCount: 1,
      actionCount: 47,
      scopeCount: 1,
      controlFlowEdgeCount: 0,
      expressionCount: 44,
      templateExpressionCount: 2,
      dynamicContentReferenceCount: 44,
      variableReadCount: 3,
      variableWriteCount: 3,
    });
  });

  it('parses unpacked flow definitions into a stable intermediate representation', async () => {
    const dir = await createTempDir();
    const artifactPath = join(dir, 'flow.json');

    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'pp.flow.artifact',
          metadata: {
            name: 'IR Flow',
            parameters: {},
            connectionReferences: [],
            environmentVariables: [],
          },
          definition: {
            triggers: {
              Manual: {
                type: 'Request',
              },
            },
            actions: {
              ScopeA: {
                type: 'Scope',
                actions: {
                  ComposeInside: {
                    type: 'Compose',
                  },
                },
                else: {
                  actions: {
                    ComposeElse: {
                      type: 'Compose',
                    },
                  },
                },
              },
              SwitchA: {
                type: 'Switch',
                cases: {
                  First: {
                    actions: {
                      ComposeCase: {
                        type: 'Compose',
                        runAfter: {
                          ScopeA: ['Succeeded'],
                        },
                      },
                    },
                  },
                },
                default: {
                  actions: {
                    ComposeDefault: {
                      type: 'Compose',
                    },
                  },
                },
              },
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const parsed = await parseFlowIntermediateRepresentation(artifactPath);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      artifactName: 'IR Flow',
      nodeCount: 7,
      triggerCount: 1,
      actionCount: 6,
      scopeCount: 2,
      controlFlowEdgeCount: 1,
      expressionCount: 0,
      templateExpressionCount: 0,
      dynamicContentReferenceCount: 0,
      variableReadCount: 0,
      variableWriteCount: 0,
    });
    expect(parsed.data?.nodes).toEqual([
      {
        id: 'scope:actions.ScopeA',
        name: 'ScopeA',
        kind: 'scope',
        type: 'Scope',
        path: 'actions.ScopeA',
        branch: 'root',
        runAfter: [],
        childIds: [
          'action:actions.ScopeA.actions.ComposeInside',
          'action:actions.ScopeA.else.actions.ComposeElse',
        ],
        controlFlow: {
          dependsOn: [],
          unresolvedDependsOn: [],
          dependentIds: ['action:actions.SwitchA.cases.First.actions.ComposeCase'],
        },
        dataFlow: {
          expressions: [],
          reads: [],
          writes: [],
          dynamicContentReferences: [],
        },
        variableUsage: {
          initializes: [],
          reads: [],
          writes: [],
        },
      },
      {
        id: 'action:actions.ScopeA.actions.ComposeInside',
        name: 'ComposeInside',
        kind: 'action',
        type: 'Compose',
        path: 'actions.ScopeA.actions.ComposeInside',
        parentId: 'scope:actions.ScopeA',
        branch: 'actions',
        runAfter: [],
        childIds: [],
        controlFlow: {
          dependsOn: [],
          unresolvedDependsOn: [],
          dependentIds: [],
        },
        dataFlow: {
          expressions: [],
          reads: [],
          writes: [],
          dynamicContentReferences: [],
        },
        variableUsage: {
          initializes: [],
          reads: [],
          writes: [],
        },
      },
      {
        id: 'action:actions.ScopeA.else.actions.ComposeElse',
        name: 'ComposeElse',
        kind: 'action',
        type: 'Compose',
        path: 'actions.ScopeA.else.actions.ComposeElse',
        parentId: 'scope:actions.ScopeA',
        branch: 'else',
        runAfter: [],
        childIds: [],
        controlFlow: {
          dependsOn: [],
          unresolvedDependsOn: [],
          dependentIds: [],
        },
        dataFlow: {
          expressions: [],
          reads: [],
          writes: [],
          dynamicContentReferences: [],
        },
        variableUsage: {
          initializes: [],
          reads: [],
          writes: [],
        },
      },
      {
        id: 'scope:actions.SwitchA',
        name: 'SwitchA',
        kind: 'scope',
        type: 'Switch',
        path: 'actions.SwitchA',
        branch: 'root',
        runAfter: [],
        childIds: [
          'action:actions.SwitchA.cases.First.actions.ComposeCase',
          'action:actions.SwitchA.default.actions.ComposeDefault',
        ],
        controlFlow: {
          dependsOn: [],
          unresolvedDependsOn: [],
          dependentIds: [],
        },
        dataFlow: {
          expressions: [],
          reads: [],
          writes: [],
          dynamicContentReferences: [],
        },
        variableUsage: {
          initializes: [],
          reads: [],
          writes: [],
        },
      },
      {
        id: 'action:actions.SwitchA.cases.First.actions.ComposeCase',
        name: 'ComposeCase',
        kind: 'action',
        type: 'Compose',
        path: 'actions.SwitchA.cases.First.actions.ComposeCase',
        parentId: 'scope:actions.SwitchA',
        branch: 'case:First',
        runAfter: ['ScopeA'],
        childIds: [],
        controlFlow: {
          dependsOn: ['scope:actions.ScopeA'],
          unresolvedDependsOn: [],
          dependentIds: [],
        },
        dataFlow: {
          expressions: [],
          reads: [],
          writes: [],
          dynamicContentReferences: [],
        },
        variableUsage: {
          initializes: [],
          reads: [],
          writes: [],
        },
      },
      {
        id: 'action:actions.SwitchA.default.actions.ComposeDefault',
        name: 'ComposeDefault',
        kind: 'action',
        type: 'Compose',
        path: 'actions.SwitchA.default.actions.ComposeDefault',
        parentId: 'scope:actions.SwitchA',
        branch: 'default',
        runAfter: [],
        childIds: [],
        controlFlow: {
          dependsOn: [],
          unresolvedDependsOn: [],
          dependentIds: [],
        },
        dataFlow: {
          expressions: [],
          reads: [],
          writes: [],
          dynamicContentReferences: [],
        },
        variableUsage: {
          initializes: [],
          reads: [],
          writes: [],
        },
      },
      {
        id: 'trigger:triggers.Manual',
        name: 'Manual',
        kind: 'trigger',
        type: 'Request',
        path: 'triggers.Manual',
        branch: 'root',
        runAfter: [],
        childIds: [],
        controlFlow: {
          dependsOn: [],
          unresolvedDependsOn: [],
          dependentIds: [],
        },
        dataFlow: {
          expressions: [],
          reads: [],
          writes: [],
          dynamicContentReferences: [],
        },
        variableUsage: {
          initializes: [],
          reads: [],
          writes: [],
        },
      },
    ]);
  });

  it('builds a local graph report from the parsed flow model', async () => {
    const graph = await new FlowService().graphArtifact('fixtures/flow/artifacts/semantic-diagnostic-flow');

    expect(graph.success).toBe(true);
    expect(graph.data).toMatchObject({
      artifactName: 'Semantic Diagnostic Flow',
      summary: {
        nodeCount: 51,
        unresolvedEdgeCount: 6,
      },
      resources: {
        parameters: ['ApiBaseUrl'],
      },
    });
    expect(graph.data?.edges).toContainEqual(
      expect.objectContaining({
        from: 'action:actions.ComposeBadParam',
        to: 'action:MissingStep',
        kind: 'runAfter',
        resolved: false,
      })
    );
  });

  it('applies bounded patches without dropping unknown fields', async () => {
    const dir = await createTempDir();
    const artifactPath = join(dir, 'flow.json');

    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'pp.flow.artifact',
          metadata: {
            name: 'Invoice Flow',
            connectionReferences: [
              {
                name: 'shared_office365',
                connectionReferenceLogicalName: 'shared_office365',
              },
            ],
            parameters: {
              ApiBaseUrl: 'https://example.test',
            },
            environmentVariables: ['pp_ApiUrl'],
          },
          definition: {
            parameters: {
              '$connections': {
                value: {
                  shared_office365: {
                    connectionReferenceLogicalName: 'shared_office365',
                  },
                },
              },
              ApiBaseUrl: {
                defaultValue: 'https://example.test',
              },
            },
            actions: {
              SendMail: {
                inputs: {
                  subject: 'Initial',
                  body: "@{environmentVariables('pp_ApiUrl')}",
                  metadata: {
                    keepMe: true,
                  },
                },
              },
            },
          },
          unknown: {
            sourceVersion: 'v1',
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const patched = await patchFlowArtifact(
      artifactPath,
      {
        connectionReferences: {
          shared_office365: 'shared_exchangeonline',
        },
        environmentVariables: {
          pp_ApiUrl: 'pp_RuntimeUrl',
        },
        parameters: {
          ApiBaseUrl: 'https://next.example.test',
        },
        expressions: {
          'actions.SendMail.inputs.subject': "@{parameters('ApiBaseUrl')}",
        },
        values: {
          'actions.SendMail.inputs.priority': 'High',
        },
      },
      join(dir, 'patched')
    );

    expect(patched.success).toBe(true);
    expect(patched.data?.changed).toBe(true);
    expect(patched.data?.appliedOperations).toEqual([
      'connectionReference:shared_office365->shared_exchangeonline',
      'environmentVariable:pp_ApiUrl->pp_RuntimeUrl',
      'parameter:ApiBaseUrl',
      'expression:actions.SendMail.inputs.subject',
      'value:actions.SendMail.inputs.priority',
    ]);

    const document = JSON.parse(await readFile(join(dir, 'patched', 'flow.json'), 'utf8')) as {
      metadata: {
        connectionReferences: Array<{ name: string; connectionReferenceLogicalName?: string }>;
        environmentVariables: string[];
        parameters: Record<string, string>;
      };
      definition: {
        parameters: {
          '$connections': {
            value: Record<string, { connectionReferenceLogicalName?: string; name?: string }>;
          };
          ApiBaseUrl: {
            defaultValue: string;
          };
        };
        actions: {
          SendMail: {
            inputs: {
              body: string;
              subject: string;
              priority: string;
              metadata: {
                keepMe: boolean;
              };
            };
          };
        };
      };
      unknown: {
        sourceVersion: string;
      };
    };

    expect(document.metadata.connectionReferences[0]?.name).toBe('shared_exchangeonline');
    expect(document.metadata.connectionReferences[0]?.connectionReferenceLogicalName).toBe('shared_exchangeonline');
    expect(document.metadata.environmentVariables).toEqual(['pp_RuntimeUrl']);
    expect(document.metadata.parameters.ApiBaseUrl).toBe('https://next.example.test');
    expect(document.definition.parameters['$connections'].value.shared_exchangeonline).toBeDefined();
    expect(document.definition.parameters['$connections'].value.shared_exchangeonline?.connectionReferenceLogicalName).toBe(
      'shared_exchangeonline'
    );
    expect(document.definition.parameters['$connections'].value.shared_office365).toBeUndefined();
    expect(document.definition.parameters.ApiBaseUrl.defaultValue).toBe('https://next.example.test');
    expect(document.definition.actions.SendMail.inputs.body).toBe("@{environmentVariables('pp_RuntimeUrl')}");
    expect(document.definition.actions.SendMail.inputs.subject).toBe("@{parameters('ApiBaseUrl')}");
    expect(document.definition.actions.SendMail.inputs.priority).toBe('High');
    expect(document.definition.actions.SendMail.inputs.metadata.keepMe).toBe(true);
    expect(document.unknown.sourceVersion).toBe('v1');
  });
});
