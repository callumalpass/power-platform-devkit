import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok, type OperationResult } from '@pp/diagnostics';
import type { DataverseClient } from '@pp/dataverse';
import {
  FlowService,
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

    const normalized = JSON.parse(await readFile(join(dir, 'artifacts', 'flow.json'), 'utf8')) as {
      definition: Record<string, unknown>;
    };
    expect(normalized.definition.lastModifiedTime).toBeUndefined();
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
    expect(doctor.data?.invalidConnectionReferences).toHaveLength(1);
    expect(doctor.data?.missingEnvironmentVariables).toHaveLength(1);
    expect(doctor.data?.findings).toContain('Connection reference shared_office365 is invalid for this flow.');
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
            environmentVariables: [],
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
      'parameter:ApiBaseUrl',
      'expression:actions.SendMail.inputs.subject',
      'value:actions.SendMail.inputs.priority',
    ]);

    const document = JSON.parse(await readFile(join(dir, 'patched', 'flow.json'), 'utf8')) as {
      metadata: {
        connectionReferences: Array<{ name: string }>;
        parameters: Record<string, string>;
      };
      definition: {
        parameters: {
          '$connections': {
            value: Record<string, unknown>;
          };
          ApiBaseUrl: {
            defaultValue: string;
          };
        };
        actions: {
          SendMail: {
            inputs: {
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
    expect(document.metadata.parameters.ApiBaseUrl).toBe('https://next.example.test');
    expect(document.definition.parameters['$connections'].value.shared_exchangeonline).toBeDefined();
    expect(document.definition.parameters.ApiBaseUrl.defaultValue).toBe('https://next.example.test');
    expect(document.definition.actions.SendMail.inputs.subject).toBe("@{parameters('ApiBaseUrl')}");
    expect(document.definition.actions.SendMail.inputs.priority).toBe('High');
    expect(document.definition.actions.SendMail.inputs.metadata.keepMe).toBe(true);
    expect(document.unknown.sourceVersion).toBe('v1');
  });
});
