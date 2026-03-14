import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readJsonFile } from '@pp/artifacts';
import { CanvasService } from '@pp/canvas';
import { createDiagnostic, fail, ok } from '@pp/diagnostics';
import { ConnectionReferenceService } from '@pp/dataverse';
import { FlowService } from '@pp/flow';
import { ModelService } from '@pp/model';
import { SolutionService } from '@pp/solution';
import { resolveRepoPath } from '../../../test/golden';
import { createFixtureDataverseClient, mockDataverseResolution } from '../../../test/dataverse-fixture';
import {
  addSolutionInspectRecoveryGuidance,
  createPpMcpServer,
  executeDataverseCreate,
  executeDataverseMetadataApply,
  buildEnvironmentCleanupPlan,
  compareSolutionAcrossEnvironments,
  executeDataverseDelete,
  executeEnvironmentCleanup,
  inspectAuthProfile,
} from './index';

describe('@pp/mcp', () => {
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.map(async (client) => client.close()));
    clients.length = 0;
    vi.restoreAllMocks();
  });

  async function createClient(args: { configDir: string; projectPath: string; env?: Record<string, string> }): Promise<Client> {
    const client = new Client({
      name: 'pp-mcp-test-client',
      version: '0.1.0',
    });
    clients.push(client);

    await client.connect(
      new StdioClientTransport({
        command: resolveRepoPath('node_modules', '.bin', 'tsx'),
        args: [
          resolveRepoPath('packages', 'mcp', 'src', 'server.ts'),
          '--config-dir',
          args.configDir,
          '--project',
          args.projectPath,
        ],
        cwd: resolveRepoPath(),
        env: {
          ...process.env,
          ...(args.env ?? {}),
        } as Record<string, string>,
        stderr: 'pipe',
      })
    );

    return client;
  }

  async function writeFixtureConfig(
    configDir: string,
    options: {
      readOnlyEnvironments?: string[];
    } = {}
  ): Promise<void> {
    const readOnlyEnvironments = new Set(options.readOnlyEnvironments ?? []);

    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          authProfiles: {
            'fixture-user': {
              name: 'fixture-user',
              type: 'user',
            },
          },
          browserProfiles: {},
          environments: {
            dev: {
              alias: 'dev',
              url: 'https://example.crm.dynamics.com',
              authProfile: 'fixture-user',
              defaultSolution: 'CoreDev',
              makerEnvironmentId: '00000000-0000-0000-0000-000000000001',
              ...(readOnlyEnvironments.has('dev')
                ? {
                    access: {
                      mode: 'read-only',
                    },
                  }
                : {}),
            },
            test: {
              alias: 'test',
              url: 'https://test.crm.dynamics.com',
              authProfile: 'fixture-user',
              defaultSolution: 'CoreTest',
              makerEnvironmentId: '00000000-0000-0000-0000-000000000002',
              ...(readOnlyEnvironments.has('test')
                ? {
                    access: {
                      mode: 'read-only',
                    },
                  }
                : {}),
            },
          },
          preferences: {},
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
  }

  it('adds explicit CLI recovery guidance for transport-level solution inspect failures', () => {
    const result = addSolutionInspectRecoveryGuidance(
      fail(createDiagnostic('error', 'HTTP_UNHANDLED_ERROR', 'fetch failed', { source: '@pp/http' })),
      'test',
      'AccessTeam',
    );

    expect(result.suggestedNextActions).toContain(
      'Run `pp solution inspect AccessTeam --environment test --format json` to determine whether the failure is MCP transport-specific or a live Dataverse inspect error.',
    );
    expect(result.knownLimitations).toContain(
      'MCP solution inspect can still fail before Dataverse returns a response when the underlying HTTP transport reports fetch failed.',
    );
  });

  it('blocks MCP write tools against read-only environments', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir, {
      readOnlyEnvironments: ['dev'],
    });
    const result = await executeDataverseCreate(
      {
        environment: 'dev',
        configDir,
        table: 'accounts',
        body: {
          name: 'Blocked',
        },
      },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ENVIRONMENT_WRITE_BLOCKED',
        }),
      ])
    );
  });

  it('connects over stdio and exposes the read and controlled mutation surface', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    const client = await createClient({
      configDir,
      projectPath: resolveRepoPath('fixtures', 'analysis', 'project'),
      env: {
        PP_TENANT_DOMAIN: 'contoso.example',
        PP_SQL_ENDPOINT: 'tcp:sql.example.test,1433',
        PP_SECRET_APP_TOKEN: 'fixture-secret',
      },
    });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'pp.environment.list',
        'pp.environment.cleanup-plan',
        'pp.environment.cleanup',
        'pp.auth-profile.inspect',
        'pp.solution.list',
        'pp.solution.inspect',
        'pp.solution.compare',
        'pp.solution.sync-status',
        'pp.solution.create',
        'pp.solution.set-metadata',
        'pp.solution.publish',
        'pp.solution.export',
        'pp.solution.import',
        'pp.solution.checkpoint',
        'pp.dataverse.metadata.apply',
        'pp.dataverse.metadata.table',
        'pp.dataverse.metadata.relationship',
        'pp.dataverse.query',
        'pp.dataverse.create',
        'pp.dataverse.delete',
        'pp.dataverse.whoami',
        'pp.model-app.create',
        'pp.model-app.attach',
        'pp.flow.inspect',
        'pp.flow.connrefs',
        'pp.flow.runs',
        'pp.flow.errors',
        'pp.flow.doctor',
        'pp.flow.monitor',
        'pp.flow.activate',
        'pp.flow.deploy',
        'pp.flow.export',
        'pp.canvas-app.inspect',
        'pp.canvas-app.access',
        'pp.canvas-app.plan-attach',
        'pp.canvas-app.attach',
        'pp.connection-reference.inspect',
        'pp.environment-variable.inspect',
        'pp.model-app.inspect',
        'pp.canvas-app.download',
        'pp.canvas-app.import',
        'pp.project.inspect',
        'pp.project.doctor',
        'pp.project.feedback',
        'pp.init.start',
        'pp.init.status',
        'pp.init.answer',
        'pp.init.resume',
        'pp.init.cancel',
        'pp.analysis.context',
        'pp.analysis.portfolio',
        'pp.analysis.drift',
        'pp.analysis.usage',
        'pp.analysis.policy',
        'pp.deploy.plan',
        'pp.deploy.apply',
        'pp.domain.list',
      ])
    );

    const environments = await client.callTool({
      name: 'pp.environment.list',
      arguments: {},
    });
    expect(environments.isError).toBeFalsy();
    expect(environments.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.environment.list',
        mutationPolicy: {
          mode: 'read-only',
          mutationsExposed: false,
        },
      },
    });
    expect((environments.structuredContent as { data: Array<{ alias: string }> }).data[0]?.alias).toBe('dev');

    const project = await client.callTool({
      name: 'pp.project.inspect',
      arguments: {
        environmentAlias: 'test',
      },
    });
    expect(project.isError).toBeFalsy();
    expect(project.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.project.inspect',
      },
    });
    expect((project.structuredContent as { data: { discovery: { resolvedRoot: string } } }).data.discovery.resolvedRoot).toBe(
      resolveRepoPath('fixtures', 'analysis', 'project')
    );
    expect(
      (project.structuredContent as { data: { contract: { deploymentRouteSummary: string } } }).data.contract.deploymentRouteSummary
    ).toContain('environment alias');
    expect((project.structuredContent as { data: { targetComparison: { relationship: string } } }).data.targetComparison.relationship).toBe(
      'unmapped'
    );

    const doctor = await client.callTool({
      name: 'pp.project.doctor',
      arguments: {},
    });
    expect(doctor.isError).toBeFalsy();
    expect(doctor.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.project.doctor',
      },
    });

    const feedback = await client.callTool({
      name: 'pp.project.feedback',
      arguments: {},
    });
    expect(feedback.isError).toBeFalsy();
    expect(feedback.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.project.feedback',
      },
    });

    const analysis = await client.callTool({
      name: 'pp.analysis.context',
      arguments: {
        focusAsset: 'solution:core',
        environmentAlias: 'test',
      },
    });
    expect(analysis.isError).toBeFalsy();
    expect(analysis.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.analysis.context',
      },
    });
    expect((analysis.structuredContent as { data: { targetComparison: { requestedEnvironmentAlias: string } } }).data.targetComparison.requestedEnvironmentAlias).toBe(
      'test'
    );
    expect((analysis.structuredContent as { data: { focusAsset: string } }).data.focusAsset).toBe('solution:core');

    const portfolio = await client.callTool({
      name: 'pp.analysis.portfolio',
      arguments: {},
    });
    expect(portfolio.isError).toBeFalsy();
    expect(portfolio.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.analysis.portfolio',
      },
    });
    expect((portfolio.structuredContent as { data: { summary: { projectCount: number } } }).data.summary.projectCount).toBe(1);

    const domains = await client.callTool({
      name: 'pp.domain.list',
      arguments: {},
    });
    expect(domains.isError).toBeFalsy();
    expect((domains.structuredContent as { data: Array<{ name: string }> }).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'auth',
          readTools: expect.arrayContaining(['pp.auth-profile.inspect', 'pp.environment.list']),
          notes: expect.stringContaining('bound auth profile'),
        }),
        expect.objectContaining({
          name: 'dataverse',
          mutationToolsAvailable: true,
          mutationTools: expect.arrayContaining([
            'pp.environment.cleanup',
            'pp.dataverse.metadata.apply',
            'pp.dataverse.create',
            'pp.dataverse.delete',
            'pp.model-app.create',
            'pp.model-app.attach',
          ]),
          readTools: expect.arrayContaining([
            'pp.environment.cleanup-plan',
            'pp.solution.compare',
            'pp.dataverse.metadata.table',
            'pp.dataverse.metadata.relationship',
            'pp.dataverse.query',
            'pp.dataverse.whoami',
            'pp.flow.inspect',
            'pp.flow.connrefs',
            'pp.canvas-app.inspect',
          ]),
          notes: expect.stringContaining('single-row create/delete'),
        }),
        expect.objectContaining({
          name: 'dataverse',
          readTools: expect.arrayContaining([
            'pp.dataverse.metadata.table',
            'pp.dataverse.metadata.relationship',
            'pp.dataverse.query',
            'pp.dataverse.whoami',
          ]),
          notes: expect.stringContaining('first-class table/relationship metadata inspection'),
        }),
        expect.objectContaining({
          name: 'solution-lifecycle',
          mutationToolsAvailable: true,
          mutationTools: expect.arrayContaining([
            'pp.solution.create',
            'pp.solution.set-metadata',
            'pp.solution.publish',
            'pp.solution.export',
            'pp.solution.import',
            'pp.solution.checkpoint',
          ]),
          readTools: expect.arrayContaining(['pp.solution.compare', 'pp.solution.sync-status']),
          notes: expect.stringContaining('PublishAllXml'),
        }),
        expect.objectContaining({
          name: 'flow-lifecycle',
          mutationToolsAvailable: true,
          readTools: expect.arrayContaining(['pp.flow.inspect', 'pp.flow.connrefs', 'pp.flow.runs', 'pp.flow.errors', 'pp.flow.doctor', 'pp.flow.monitor']),
          mutationTools: expect.arrayContaining(['pp.flow.activate', 'pp.flow.deploy', 'pp.flow.export']),
          notes: expect.stringContaining('in-place remediation attempt'),
        }),
        expect.objectContaining({
          name: 'canvas-lifecycle',
          mutationToolsAvailable: true,
          readTools: expect.arrayContaining(['pp.canvas-app.inspect', 'pp.canvas-app.plan-attach']),
          mutationTools: expect.arrayContaining(['pp.canvas-app.attach', 'pp.canvas-app.download', 'pp.canvas-app.import']),
          notes: expect.stringContaining('remote `.msapp`'),
        }),
        expect.objectContaining({
          name: 'model-lifecycle',
          mutationToolsAvailable: true,
          readTools: expect.arrayContaining(['pp.model-app.inspect']),
          mutationTools: expect.arrayContaining(['pp.model-app.create', 'pp.model-app.attach']),
          notes: expect.stringContaining('optional solution attachment'),
        }),
        expect.objectContaining({
          name: 'flow-local-artifacts',
          notes: expect.stringContaining('CLI-only today'),
        }),
        expect.objectContaining({
          name: 'project',
          readTools: expect.arrayContaining(['pp.project.inspect', 'pp.project.doctor', 'pp.project.feedback']),
          mutationToolsAvailable: true,
          mutationTools: expect.arrayContaining(['pp.init.start', 'pp.init.answer', 'pp.init.resume', 'pp.init.cancel', 'pp.deploy.plan', 'pp.deploy.apply']),
        }),
        expect.objectContaining({
          name: 'mcp',
          readTools: expect.arrayContaining(['pp.solution.sync-status']),
          mutationTools: expect.arrayContaining([
            'pp.environment.cleanup',
            'pp.dataverse.metadata.apply',
            'pp.dataverse.create',
            'pp.dataverse.delete',
            'pp.model-app.create',
            'pp.model-app.attach',
            'pp.solution.create',
            'pp.solution.set-metadata',
            'pp.solution.publish',
            'pp.solution.export',
            'pp.solution.import',
            'pp.solution.checkpoint',
            'pp.flow.activate',
            'pp.flow.deploy',
            'pp.flow.export',
            'pp.canvas-app.attach',
            'pp.canvas-app.download',
            'pp.canvas-app.import',
          ]),
        }),
      ])
    );
  });

  it('passes run-prefix and exact-name filters through the MCP solution list tool', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    mockDataverseResolution({
      dev: createFixtureDataverseClient({}),
    });
    const listSpy = vi.spyOn(SolutionService.prototype, 'list').mockResolvedValue(
      ok(
        [
          {
            solutionid: 'sol-harness',
            uniquename: 'ppHarness20260312T205428716ZShell',
            friendlyname: 'PP Harness Shell',
            version: '1.0.0.0',
            ismanaged: false,
          },
        ],
        {
          supportTier: 'preview',
        },
      ),
    );

    const server = createPpMcpServer({
      configDir,
      project: resolveRepoPath('fixtures', 'analysis', 'project'),
    }) as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }> }>;
    };
    const listTool = server._registeredTools['pp.solution.list'];

    const result = await listTool.handler({
      environment: 'dev',
      prefix: 'ppHarness20260312T205428716Z',
      uniqueName: 'ppHarness20260312T205428716ZShell',
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.solution.list',
        mutationPolicy: {
          mode: 'read-only',
          mutationsExposed: false,
        },
      },
      data: [
        {
          uniquename: 'ppHarness20260312T205428716ZShell',
        },
      ],
    });
    expect(listSpy).toHaveBeenCalledWith({
      prefix: 'ppHarness20260312T205428716Z',
      uniqueName: 'ppHarness20260312T205428716ZShell',
    });
  });

  it('inspects Dataverse table metadata through the MCP tool surface', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    const getTable = vi.fn().mockResolvedValue(
      ok(
        {
          LogicalName: 'pp_project',
          SchemaName: 'pp_Project',
          DisplayName: {
            UserLocalizedLabel: {
              Label: 'Project',
            },
          },
          DisplayCollectionName: {
            UserLocalizedLabel: {
              Label: 'Projects',
            },
          },
          PrimaryIdAttribute: 'pp_projectid',
          PrimaryNameAttribute: 'pp_name',
          EntitySetName: 'pp_projects',
          OwnershipType: 'UserOwned',
          IsCustomEntity: true,
        },
        {
          supportTier: 'preview',
        },
      ),
    );

    mockDataverseResolution({
      dev: {
        getTable,
      } as never,
    });

    const server = createPpMcpServer({
      configDir,
      project: resolveRepoPath('fixtures', 'analysis', 'project'),
    }) as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }> }>;
    };

    const result = await server._registeredTools['pp.dataverse.metadata.table'].handler({
      environment: 'dev',
      logicalName: 'pp_project',
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.dataverse.metadata.table',
        mutationPolicy: {
          mode: 'read-only',
          mutationsExposed: false,
        },
      },
      data: {
        logicalName: 'pp_project',
        schemaName: 'pp_Project',
        displayName: 'Project',
        pluralDisplayName: 'Projects',
      },
    });
    expect(getTable).toHaveBeenCalledWith('pp_project', {
      select: undefined,
      expand: undefined,
      includeAnnotations: undefined,
    });
  });

  it('inspects Dataverse relationship metadata through the MCP tool surface', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    const getRelationship = vi.fn().mockResolvedValue(
      ok(
        {
          SchemaName: 'pp_project_task',
          '@odata.type': '#Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata',
          RelationshipType: 'OneToManyRelationship',
          ReferencedEntity: 'pp_project',
          ReferencedAttribute: 'pp_projectid',
          ReferencingEntity: 'pp_task',
          ReferencingAttribute: 'pp_projectid',
          Lookup: {
            LogicalName: 'pp_projectid',
            SchemaName: 'pp_ProjectId',
            DisplayName: {
              UserLocalizedLabel: {
                Label: 'Project',
              },
            },
          },
        },
        {
          supportTier: 'preview',
        },
      ),
    );

    mockDataverseResolution({
      dev: {
        getRelationship,
      } as never,
    });

    const server = createPpMcpServer({
      configDir,
      project: resolveRepoPath('fixtures', 'analysis', 'project'),
    }) as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }> }>;
    };

    const result = await server._registeredTools['pp.dataverse.metadata.relationship'].handler({
      environment: 'dev',
      schemaName: 'pp_project_task',
      kind: 'one-to-many',
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.dataverse.metadata.relationship',
        mutationPolicy: {
          mode: 'read-only',
          mutationsExposed: false,
        },
      },
      data: {
        schemaName: 'pp_project_task',
        relationshipType: 'one-to-many',
        referencedEntity: 'pp_project',
        referencingEntity: 'pp_task',
        lookupSchemaName: 'pp_ProjectId',
      },
    });
    expect(getRelationship).toHaveBeenCalledWith('pp_project_task', {
      kind: 'one-to-many',
      select: undefined,
      expand: undefined,
      includeAnnotations: undefined,
    });
  });

  it('creates a model-driven app through the MCP tool surface', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    mockDataverseResolution({
      dev: createFixtureDataverseClient({}),
    });
    const createSpy = vi.spyOn(ModelService.prototype, 'create').mockResolvedValue(
      ok(
        {
          id: 'app-1',
          uniqueName: 'HarnessApp',
          name: 'Harness App',
        },
        {
          supportTier: 'preview',
        },
      ),
    );

    const server = createPpMcpServer({
      configDir,
      project: resolveRepoPath('fixtures', 'analysis', 'project'),
    }) as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }> }>;
    };

    const result = await server._registeredTools['pp.model-app.create'].handler({
      environment: 'dev',
      uniqueName: 'HarnessApp',
      name: 'Harness App',
      solutionUniqueName: 'Core',
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.model-app.create',
        mutationPolicy: {
          mode: 'controlled',
          mutationsExposed: true,
        },
      },
      data: {
        uniqueName: 'HarnessApp',
        name: 'Harness App',
      },
    });
    expect(createSpy).toHaveBeenCalledWith('HarnessApp', {
      name: 'Harness App',
      solutionUniqueName: 'Core',
    });
  });

  it('attaches a model-driven app through the MCP tool surface', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    mockDataverseResolution({
      dev: createFixtureDataverseClient({}),
    });
    const attachSpy = vi.spyOn(ModelService.prototype, 'attach').mockResolvedValue(
      ok(
        {
          attached: true,
          solutionUniqueName: 'Core',
          addRequiredComponents: false,
          app: {
            id: 'app-1',
            uniqueName: 'HarnessApp',
            name: 'Harness App',
          },
        },
        {
          supportTier: 'preview',
        },
      ),
    );

    const server = createPpMcpServer({
      configDir,
      project: resolveRepoPath('fixtures', 'analysis', 'project'),
    }) as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }> }>;
    };

    const result = await server._registeredTools['pp.model-app.attach'].handler({
      environment: 'dev',
      identifier: 'Harness App',
      solutionUniqueName: 'Core',
      addRequiredComponents: false,
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.model-app.attach',
        mutationPolicy: {
          mode: 'controlled',
          mutationsExposed: true,
        },
      },
      data: {
        attached: true,
        solutionUniqueName: 'Core',
        addRequiredComponents: false,
      },
    });
    expect(attachSpy).toHaveBeenCalledWith('Harness App', {
      solutionUniqueName: 'Core',
      addRequiredComponents: false,
    });
  });

  it('publishes a solution through the MCP tool surface with export-backed confirmation', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    mockDataverseResolution({
      dev: createFixtureDataverseClient({}),
    });
    const publishSpy = vi.spyOn(SolutionService.prototype, 'publish').mockResolvedValue(
      ok(
        {
          solution: {
            solutionid: 'sol-1',
            uniquename: 'Core',
            friendlyname: 'Core Solution',
            version: '1.0.0.0',
            ismanaged: false,
          },
          published: true,
          action: {
            name: 'PublishAllXml',
            accepted: true,
          },
          waitForExport: true,
          synchronization: {
            kind: 'solution-export',
            confirmed: true,
            attempts: 1,
            elapsedMs: 25,
          },
          blockers: [],
        },
        {
          supportTier: 'preview',
        },
      ),
    );

    const server = createPpMcpServer({
      configDir,
      project: resolveRepoPath('fixtures', 'analysis', 'project'),
    }) as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }> }>;
    };
    const publishTool = server._registeredTools['pp.solution.publish'];

    const result = await publishTool.handler({
      environment: 'dev',
      uniqueName: 'Core',
      waitForExport: true,
      timeoutMs: 30_000,
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.solution.publish',
        mutationPolicy: {
          mode: 'controlled',
          mutationsExposed: true,
        },
      },
      data: {
        published: true,
        action: {
          name: 'PublishAllXml',
          accepted: true,
        },
        waitForExport: true,
        synchronization: {
          confirmed: true,
        },
      },
    });
    expect(publishSpy).toHaveBeenCalledWith('Core', {
      waitForExport: true,
      timeoutMs: 30_000,
      pollIntervalMs: undefined,
      exportOptions: {
        managed: undefined,
        outPath: undefined,
        manifestPath: undefined,
        requestTimeoutMs: undefined,
      },
    });
  });

  it('activates a flow through the MCP tool surface', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    mockDataverseResolution({
      dev: createFixtureDataverseClient({}),
    });
    const activateSpy = vi.spyOn(FlowService.prototype, 'activate').mockResolvedValue(
      ok(
        {
          identifier: 'Harness Flow',
          sourcePath: 'dataverse://workflows/flow-1',
          targetEnvironment: 'dev',
          target: {
            id: 'flow-1',
            uniqueName: 'crd_HarnessFlow',
            workflowState: 'activated',
            stateCode: 1,
            statusCode: 2,
          },
        },
        {
          supportTier: 'preview',
        },
      ),
    );

    const server = createPpMcpServer({
      configDir,
      project: resolveRepoPath('fixtures', 'analysis', 'project'),
    }) as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }> }>;
    };
    const activateTool = server._registeredTools['pp.flow.activate'];

    const result = await activateTool.handler({
      environment: 'dev',
      identifier: 'Harness Flow',
      solutionUniqueName: 'Core',
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.flow.activate',
        mutationPolicy: {
          mode: 'controlled',
          mutationsExposed: true,
        },
      },
      data: {
        identifier: 'Harness Flow',
        target: {
          uniqueName: 'crd_HarnessFlow',
          workflowState: 'activated',
        },
      },
    });
    expect(activateSpy).toHaveBeenCalledWith('Harness Flow', {
      solutionUniqueName: 'Core',
    });
  });

  it('writes a durable JSON receipt when flow deploy is given resultOutPath through the MCP tool surface', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'pp-mcp-flow-deploy-'));
    const resultOutPath = join(outputDir, 'logs', 'deploy-result.json');
    await writeFixtureConfig(configDir);

    mockDataverseResolution({
      dev: createFixtureDataverseClient({}),
    });
    const deploySpy = vi.spyOn(FlowService.prototype, 'deployArtifact').mockResolvedValue(
      ok(
        {
          path: '/tmp/source-flow.json',
          targetIdentifier: 'crd_HarnessFlow',
          operation: 'created',
          target: {
            id: 'flow-1',
            uniqueName: 'crd_HarnessFlow',
            workflowState: 'draft',
            solutionUniqueName: 'Core',
          },
          updatedFields: ['clientdata', 'name'],
          summary: {
            path: '/tmp/source-flow.json',
            normalized: true,
            name: 'Harness Flow',
            definitionHash: 'abc123',
            connectionReferenceCount: 0,
            parameterCount: 1,
            environmentVariableCount: 1,
          },
          validation: {
            valid: true,
            warningCount: 0,
          },
        },
        {
          supportTier: 'preview',
        },
      ),
    );

    const server = createPpMcpServer({
      configDir,
      project: resolveRepoPath('fixtures', 'analysis', 'project'),
    }) as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }> }>;
    };

    const result = await server._registeredTools['pp.flow.deploy'].handler({
      environment: 'dev',
      inputPath: '/tmp/source-flow.json',
      solutionUniqueName: 'Core',
      createIfMissing: true,
      resultOutPath,
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.flow.deploy',
      },
      data: {
        operation: 'created',
        target: {
          uniqueName: 'crd_HarnessFlow',
          workflowState: 'draft',
        },
        resultLog: {
          kind: 'tool-result-json',
          path: resultOutPath,
        },
      },
      localWrites: [
        {
          kind: 'tool-result-json',
          path: resultOutPath,
        },
      ],
    });
    expect(deploySpy).toHaveBeenCalledWith('/tmp/source-flow.json', {
      solutionUniqueName: 'Core',
      target: undefined,
      createIfMissing: true,
      workflowState: undefined,
    });

    const receipt = JSON.parse(await readFile(resultOutPath, 'utf8')) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      success: true,
      tool: {
        name: 'pp.flow.deploy',
      },
      data: {
        operation: 'created',
        targetIdentifier: 'crd_HarnessFlow',
      },
    });
    expect(receipt).not.toHaveProperty('localWrites');
  });

  it('downloads a remote canvas app through the MCP tool surface', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    mockDataverseResolution({
      dev: createFixtureDataverseClient({}),
    });
    const downloadSpy = vi.spyOn(CanvasService.prototype, 'downloadRemote').mockResolvedValue(
      ok(
        {
          app: {
            id: 'canvas-1',
            name: 'crd_HarnessCanvas',
            displayName: 'Harness Canvas',
          },
          solutionUniqueName: 'Core',
          packagePath: '/tmp/HarnessCanvas.msapp',
          extractedPath: '/tmp/HarnessCanvas',
          exportedEntry: 'CanvasApps/crd_HarnessCanvas.msapp',
          availableEntries: ['CanvasApps/crd_HarnessCanvas.msapp'],
        },
        {
          supportTier: 'preview',
        },
      ),
    );

    const server = createPpMcpServer({
      configDir,
      project: resolveRepoPath('fixtures', 'analysis', 'project'),
    }) as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }> }>;
    };

    const result = await server._registeredTools['pp.canvas-app.download'].handler({
      environment: 'dev',
      identifier: 'Harness Canvas',
      solutionUniqueName: 'Core',
      outPath: 'artifacts/HarnessCanvas.msapp',
      extractToDirectory: 'artifacts/HarnessCanvas',
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.canvas-app.download',
      },
      data: {
        solutionUniqueName: 'Core',
        exportedEntry: 'CanvasApps/crd_HarnessCanvas.msapp',
      },
    });
    expect(downloadSpy).toHaveBeenCalledWith('Harness Canvas', {
      solutionUniqueName: 'Core',
      outPath: resolveRepoPath('artifacts', 'HarnessCanvas.msapp'),
      extractToDirectory: resolveRepoPath('artifacts', 'HarnessCanvas'),
    });
  });

  it('inspects remote canvas access through the MCP tool surface', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    mockDataverseResolution({
      dev: createFixtureDataverseClient({}),
    });
    const accessSpy = vi.spyOn(CanvasService.prototype, 'accessRemote').mockResolvedValue(
      ok(
        {
          assetType: 'canvas',
          id: 'canvas-1',
          name: 'crd_HarnessCanvas',
          displayName: 'Harness Canvas',
          owner: {
            id: 'user-1',
            type: 'systemuser',
            name: 'Fixture User',
          },
          explicitShares: [],
          explicitShareCount: 0,
        },
        {
          supportTier: 'preview',
        },
      ),
    );

    const server = createPpMcpServer({
      configDir,
      project: resolveRepoPath('fixtures', 'analysis', 'project'),
    }) as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }> }>;
    };

    const result = await server._registeredTools['pp.canvas-app.access'].handler({
      environment: 'dev',
      identifier: 'Harness Canvas',
      solutionUniqueName: 'Core',
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.canvas-app.access',
      },
      data: {
        displayName: 'Harness Canvas',
        explicitShareCount: 0,
      },
    });
    expect(accessSpy).toHaveBeenCalledWith('Harness Canvas', {
      solutionUniqueName: 'Core',
    });
  });

  it('plans a remote canvas attach through the MCP tool surface', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    mockDataverseResolution({
      dev: createFixtureDataverseClient({}),
    });
    const attachPlanSpy = vi.spyOn(CanvasService.prototype, 'planRemoteAttach').mockResolvedValue(
      ok(
        {
          app: {
            id: 'canvas-1',
            name: 'crd_HarnessCanvas',
            displayName: 'Harness Canvas',
          },
          targetSolution: {
            solutionid: 'sol-1',
            uniquename: 'Core',
            friendlyname: 'Core Solution',
            version: '1.0.0.0',
            ismanaged: false,
          },
          alreadyInTargetSolution: true,
          containingSolutions: [
            {
              solutionId: 'sol-1',
              uniqueName: 'Core',
              friendlyName: 'Core Solution',
            },
          ],
          targetSolutionBaseline: {
            components: [],
            missingDependencies: [],
            summary: {
              componentCount: 2,
              canvasAppCount: 1,
              missingDependencyCount: 0,
            },
          },
          previewLimitations: ['read-only preview'],
        },
        {
          supportTier: 'preview',
          knownLimitations: ['read-only preview'],
        },
      ),
    );

    const server = createPpMcpServer({
      configDir,
      project: resolveRepoPath('fixtures', 'analysis', 'project'),
    }) as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }> }>;
    };

    const result = await server._registeredTools['pp.canvas-app.plan-attach'].handler({
      environment: 'dev',
      identifier: 'Harness Canvas',
      solutionUniqueName: 'Core',
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.canvas-app.plan-attach',
      },
      data: {
        alreadyInTargetSolution: true,
        targetSolution: {
          uniquename: 'Core',
        },
      },
      knownLimitations: ['read-only preview'],
    });
    expect(attachPlanSpy).toHaveBeenCalledWith('Harness Canvas', {
      solutionUniqueName: 'Core',
    });
  });

  it('infers the publisher during solution create through the MCP tool surface', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    mockDataverseResolution({
      dev: createFixtureDataverseClient({
        query: {
          publishers: [
            {
              publisherid: 'pub-1',
              uniquename: 'DefaultPublisher',
              friendlyname: 'Default Publisher',
              customizationprefix: 'new',
            },
            {
              publisherid: 'pub-2',
              uniquename: 'pp',
              friendlyname: 'Power Platform',
              customizationprefix: 'pp',
            },
          ],
        },
      }),
    });

    const server = createPpMcpServer({
      configDir,
      project: resolveRepoPath('fixtures', 'analysis', 'project'),
    }) as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }> }>;
    };

    const result = await server._registeredTools['pp.solution.create'].handler({
      environment: 'dev',
      uniqueName: 'ppHarnessShell',
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.solution.create',
      },
      data: {
        uniquename: 'ppHarnessShell',
      },
      warnings: expect.arrayContaining([
        expect.objectContaining({
          code: 'SOLUTION_PUBLISHER_INFERRED',
        }),
      ]),
    });
  });

  it('imports a remote canvas app through the MCP tool surface', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    mockDataverseResolution({
      dev: createFixtureDataverseClient({}),
    });
    const importSpy = vi.spyOn(CanvasService.prototype, 'importRemote').mockResolvedValue(
      ok(
        {
          app: {
            id: 'canvas-1',
            name: 'crd_HarnessCanvas',
            displayName: 'Harness Canvas',
          },
          solutionUniqueName: 'Core',
          sourcePath: '/tmp/HarnessCanvas.msapp',
          importedEntry: 'CanvasApps/crd_HarnessCanvas.msapp',
        },
        {
          supportTier: 'preview',
        },
      ),
    );

    const server = createPpMcpServer({
      configDir,
      project: resolveRepoPath('fixtures', 'analysis', 'project'),
    }) as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }> }>;
    };

    const result = await server._registeredTools['pp.canvas-app.import'].handler({
      environment: 'dev',
      identifier: 'Harness Canvas',
      solutionUniqueName: 'Core',
      importPath: 'dist/HarnessCanvas.msapp',
      publishWorkflows: true,
    });

    expect(result.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.canvas-app.import',
      },
      data: {
        solutionUniqueName: 'Core',
        importedEntry: 'CanvasApps/crd_HarnessCanvas.msapp',
      },
    });
    expect(importSpy).toHaveBeenCalledWith('Harness Canvas', {
      solutionUniqueName: 'Core',
      importPath: resolveRepoPath('dist', 'HarnessCanvas.msapp'),
      publishWorkflows: true,
      overwriteUnmanagedCustomizations: undefined,
    });
  });

  it('passes flow monitor baseline comparison through the MCP tool surface', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T12:00:00.000Z'));
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    const runtimeFixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'flow', 'runtime', 'invoice-sync-runtime.json')
    )) as Record<string, unknown>;

    mockDataverseResolution({
      dev: createFixtureDataverseClient(runtimeFixture),
    });

    const server = createPpMcpServer({
      configDir,
      project: resolveRepoPath('fixtures', 'analysis', 'project'),
    }) as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }> }>;
    };
    const monitorTool = server._registeredTools['pp.flow.monitor'];

    const baseline = await monitorTool.handler({
        environment: 'dev',
        solutionUniqueName: 'Core',
        identifier: 'Invoice Sync',
        since: '7d',
    });
    expect(baseline.structuredContent).toMatchObject({
      success: true,
    });

    const changedClient = createFixtureDataverseClient(runtimeFixture);
    const baselineQueryAll = changedClient.queryAll.bind(changedClient);
    changedClient.queryAll = async <T>(options: { table: string }) => {
      if (options.table === 'flowruns') {
        const flowruns = await baselineQueryAll<T>(options);

        if (!flowruns.success || !flowruns.data) {
          return flowruns;
        }

        return {
          ...flowruns,
          data: [
            {
              flowrunid: 'run-3',
              workflowid: 'flow-1',
              workflowname: 'Invoice Sync',
              status: 'Failed',
              starttime: '2026-03-10T11:30:00.000Z',
              endtime: '2026-03-10T11:31:00.000Z',
              durationinms: 60000,
              retrycount: 0,
              errorcode: 'ConnectorTimeout',
              errormessage: 'shared_office365 timed out',
            } as T,
            ...flowruns.data,
          ],
        };
      }

      if (options.table === 'environmentvariablevalues') {
        return {
          success: true as const,
          data: [
            {
              environmentvariablevalueid: 'envvalue-1',
              _environmentvariabledefinitionid_value: 'env-1',
              value: 'https://api.example.test',
            } as T,
          ],
          diagnostics: [],
          warnings: [],
          supportTier: 'preview' as const,
        };
      }

      return baselineQueryAll<T>(options);
    };

    mockDataverseResolution({
      dev: changedClient,
    });

    const compared = await monitorTool.handler({
        environment: 'dev',
        solutionUniqueName: 'Core',
        identifier: 'Invoice Sync',
        since: '7d',
        baseline: baseline.structuredContent,
    });
    expect(compared.structuredContent).toMatchObject({
      success: true,
      data: {
        comparison: {
          changed: true,
          recentRuns: {
            totalDelta: 1,
            failedDelta: 1,
            latestFailureChanged: true,
          },
        },
        findings: expect.arrayContaining([
          'Compared against monitor baseline from 2026-03-10T12:00:00.000Z; runtime state changed since the prior capture.',
        ]),
      },
    });
  });

  it('passes flow doctor through the MCP tool surface without re-emitting optional flowrun schema warnings', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    const runtimeFixture = (await readJsonFile(
      resolveRepoPath('fixtures', 'flow', 'runtime', 'invoice-sync-runtime.json')
    )) as Record<string, unknown>;

    const sparseClient = createFixtureDataverseClient(runtimeFixture);
    const baseQueryAll = sparseClient.queryAll.bind(sparseClient);
    sparseClient.queryAll = async <T>(options: { table: string }) => {
      if (options.table === 'flowruns') {
        const select = 'select' in options && Array.isArray((options as { select?: unknown }).select)
          ? ((options as { select?: string[] }).select ?? [])
          : [];
        const missingOptionalColumn = select.find((column) => ['workflowname', 'durationinms', 'retrycount'].includes(column));
        if (missingOptionalColumn) {
          return fail(
            createDiagnostic('error', 'HTTP_REQUEST_FAILED', 'GET flowruns returned 400', {
              source: '@pp/http',
              detail: JSON.stringify({
                error: {
                  code: '0x80060888',
                  message: `Could not find a property named '${missingOptionalColumn}' on type 'Microsoft.Dynamics.CRM.flowrun'.`,
                },
              }),
            })
          ) as ReturnType<typeof sparseClient.queryAll<T>>;
        }
      }

      return baseQueryAll(options);
    };

    mockDataverseResolution({
      dev: sparseClient,
    });

    const server = createPpMcpServer({
      configDir,
      project: resolveRepoPath('fixtures', 'analysis', 'project'),
    }) as unknown as {
      _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }> }>;
    };
    const doctorTool = server._registeredTools['pp.flow.doctor'];

    const doctor = await doctorTool.handler({
      environment: 'dev',
      identifier: 'Invoice Sync',
      since: '7d',
    });

    expect(doctor.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.flow.doctor',
      },
      knownLimitations: expect.arrayContaining([
        expect.stringContaining('optional flowrun columns'),
      ]),
    });
    expect((doctor.structuredContent as { warnings: Array<{ code: string }> }).warnings).not.toContainEqual(
      expect.objectContaining({
        code: 'DATAVERSE_FLOWRUN_OPTIONAL_COLUMNS_UNAVAILABLE',
      })
    );
  });

  it('builds a bounded cleanup plan for run-scoped bootstrap prefixes', async () => {
    mockDataverseResolution({
      fixture: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'ppHarness20260312T114029287ZShell',
              friendlyname: 'ppHarness20260312T114029287Z Shell',
              version: '1.0.0.0',
              ismanaged: false,
            },
            {
              solutionid: 'sol-2',
              uniquename: 'ppHarness20260312T114029287ZExtras',
              friendlyname: 'ppHarness20260312T114029287Z Extras',
              version: '1.0.0.1',
              ismanaged: false,
            },
          ],
        },
        queryAll: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'ppHarness20260312T114029287ZShell',
              friendlyname: 'ppHarness20260312T114029287Z Shell',
              version: '1.0.0.0',
              ismanaged: false,
            },
            {
              solutionid: 'sol-2',
              uniquename: 'SharedFoundation',
              friendlyname: 'Shared Foundation',
              version: '2.0.0.0',
              ismanaged: false,
            },
          ],
          solutioncomponents: [
            {
              solutioncomponentid: 'component-1',
              objectid: 'canvas-contained',
              componenttype: 300,
              _solutionid_value: 'sol-1',
            },
          ],
          canvasapps: [
            {
              canvasappid: 'canvas-contained',
              displayname: 'ppHarness20260312T114029287Z App In Solution',
              name: 'ppHarness20260312T114029287ZAppInSolution',
            },
            {
              canvasappid: 'canvas-orphan',
              displayname: 'ppHarness20260312T114029287Z Orphan Canvas',
              name: 'ppHarness20260312T114029287ZOrphanCanvas',
            },
          ],
          workflows: [
            {
              workflowid: 'flow-orphan',
              name: 'ppHarness20260312T114029287Z Flow',
              uniquename: 'ppHarness20260312T114029287ZFlow',
              category: 5,
            },
          ],
          appmodules: [
            {
              appmoduleid: 'model-orphan',
              name: 'ppHarness20260312T114029287Z Model',
              uniquename: 'ppHarness20260312T114029287ZModel',
            },
          ],
          connectionreferences: [],
          environmentvariabledefinitions: [
            {
              environmentvariabledefinitionid: 'envvar-orphan',
              schemaname: 'ppHarness20260312T114029287Z_Flag',
              displayname: 'ppHarness20260312T114029287Z Flag',
            },
          ],
          environmentvariablevalues: [],
        },
      }),
    });

    const result = await buildEnvironmentCleanupPlan({
      environment: 'fixture',
      prefix: 'ppHarness20260312T114029287Z',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      environment: {
        alias: 'fixture',
      },
      prefix: 'ppHarness20260312T114029287Z',
      candidateCount: 5,
      solutionCandidateCount: 1,
      assetCandidateCount: 4,
      cleanupCandidates: [
        {
          solutionid: 'sol-1',
          uniquename: 'ppHarness20260312T114029287ZShell',
        },
      ],
      assetCandidates: expect.arrayContaining([
        expect.objectContaining({
          kind: 'canvas-app',
          id: 'canvas-orphan',
        }),
        expect.objectContaining({
          kind: 'cloud-flow',
          id: 'flow-orphan',
        }),
        expect.objectContaining({
          kind: 'model-app',
          id: 'model-orphan',
        }),
        expect.objectContaining({
          kind: 'environment-variable',
          id: 'envvar-orphan',
        }),
      ]),
    });
    expect(result.suggestedNextActions).toContain(
      'Call pp.environment.cleanup with environment fixture, prefix ppHarness20260312T114029287Z, and mode apply to delete the listed disposable solutions and orphaned prefixed assets through MCP.',
    );
  });

  it('suppresses unrelated connection-reference optional-column warnings during cleanup planning', async () => {
    mockDataverseResolution({
      fixture: createFixtureDataverseClient({
        query: {
          solutions: [],
        },
        queryAll: {
          solutions: [],
          solutioncomponents: [],
          canvasapps: [],
          workflows: [],
          appmodules: [],
          connectionreferences: [],
          environmentvariabledefinitions: [],
          environmentvariablevalues: [],
        },
      }),
    });
    vi.spyOn(ConnectionReferenceService.prototype, 'list').mockResolvedValue(
      ok([], {
        supportTier: 'preview',
        warnings: [
          createDiagnostic(
            'warning',
            'DATAVERSE_CONNREF_OPTIONAL_COLUMNS_UNAVAILABLE',
            'Connection reference query retried without unsupported columns.',
            {
              source: '@pp/dataverse',
            }
          ),
        ],
      }),
    );

    const result = await buildEnvironmentCleanupPlan({
      environment: 'fixture',
      prefix: 'ppHarness20260312T114029287Z',
    });

    expect(result.success).toBe(true);
    expect(result.warnings).not.toContainEqual(
      expect.objectContaining({
        code: 'DATAVERSE_CONNREF_OPTIONAL_COLUMNS_UNAVAILABLE',
      }),
    );
  });

  it('inspects an auth profile by resolving it from an environment alias', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-auth-config-'));
    await writeFixtureConfig(configDir);

    const result = await inspectAuthProfile({
      environment: 'dev',
      configDir,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      name: 'fixture-user',
      type: 'user',
      resolvedFromEnvironment: 'dev',
      resolvedEnvironmentUrl: 'https://example.crm.dynamics.com',
      targetResource: 'https://example.crm.dynamics.com',
      relationships: {
        environmentAliases: ['dev', 'test'],
        environmentCount: 2,
      },
    });
    expect(result.suggestedNextActions).toContain(
      'Call pp.dataverse.whoami with environment dev to confirm the resolved profile still has live Dataverse access.',
    );
  });

  it('lists auth profiles and alias relationships when inspect is called without a selector', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-auth-config-'));
    await writeFixtureConfig(configDir);

    const result = await inspectAuthProfile({
      configDir,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      mode: 'catalog',
      profiles: expect.arrayContaining([
        expect.objectContaining({
          name: 'fixture-user',
          type: 'user',
          relationships: {
            environmentAliases: ['dev', 'test'],
            environmentCount: 2,
          },
        }),
      ]),
    });
    expect(result.suggestedNextActions).toContain(
      'Call pp.auth-profile.inspect again with an environment alias when you want the alias-bound auth profile resolved in one step.',
    );
  });

  it('executes bounded environment cleanup through solution delete', async () => {
    mockDataverseResolution({
      fixture: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'ppHarness20260312T114029287ZShell',
              friendlyname: 'ppHarness20260312T114029287Z Shell',
              version: '1.0.0.0',
              ismanaged: false,
            },
            {
              solutionid: 'sol-2',
              uniquename: 'ppHarness20260312T114029287ZExtras',
              friendlyname: 'ppHarness20260312T114029287Z Extras',
              version: '1.0.0.1',
              ismanaged: false,
            },
          ],
        },
        queryAll: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'ppHarness20260312T114029287ZShell',
              friendlyname: 'ppHarness20260312T114029287Z Shell',
              version: '1.0.0.0',
              ismanaged: false,
            },
            {
              solutionid: 'sol-2',
              uniquename: 'ppHarness20260312T114029287ZExtras',
              friendlyname: 'ppHarness20260312T114029287Z Extras',
              version: '1.0.0.1',
              ismanaged: false,
            },
          ],
          solutioncomponents: [],
          canvasapps: [
            {
              canvasappid: 'canvas-1',
              displayname: 'ppHarness20260312T114029287Z Canvas',
              name: 'ppHarness20260312T114029287ZCanvas',
            },
          ],
          workflows: [],
          appmodules: [],
          connectionreferences: [],
          environmentvariabledefinitions: [],
          environmentvariablevalues: [],
        },
      }),
    });

    const result = await executeEnvironmentCleanup({
      environment: 'fixture',
      prefix: 'ppHarness20260312T114029287Z',
      mode: 'apply',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      mode: 'apply',
      candidateCount: 3,
      solutionCandidateCount: 2,
      assetCandidateCount: 1,
      deletedCount: 3,
      failedCount: 0,
      deletedSolutions: [
        {
          solution: {
            uniquename: 'ppHarness20260312T114029287ZShell',
          },
        },
        {
          solution: {
            uniquename: 'ppHarness20260312T114029287ZExtras',
          },
        },
      ],
      deletedAssets: [
        {
          asset: {
            kind: 'canvas-app',
            id: 'canvas-1',
          },
        },
      ],
    });

    const remaining = await buildEnvironmentCleanupPlan({
      environment: 'fixture',
      prefix: 'ppHarness20260312T114029287Z',
    });
    expect(remaining.success).toBe(true);
    expect(remaining.data?.candidateCount).toBe(0);
  });

  it('executes one bounded dataverse delete through the shared remote client path', async () => {
    const fixtureClient = createFixtureDataverseClient({
      queryAll: {
        accounts: [
          {
            accountid: 'account-1',
            name: 'Harness Account Seed',
          },
        ],
      },
    });

    mockDataverseResolution({
      fixture: fixtureClient,
    });

    const result = await executeDataverseDelete({
      environment: 'fixture',
      table: 'accounts',
      id: 'account-1',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      deleted: true,
      table: 'accounts',
      id: 'account-1',
      result: {
        status: 204,
        entityId: 'account-1',
      },
    });
    expect(result.suggestedNextActions).toContain(
      'Call pp.dataverse.query with environment fixture and a filter that targets account-1 if you need read-side confirmation that the row is gone.',
    );

    const remaining = await fixtureClient.queryAll<{ accountid: string }>({
      table: 'accounts',
    });
    expect(remaining.success).toBe(true);
    expect(remaining.data).toEqual([]);
  });

  it('executes one bounded dataverse create through the shared remote client path', async () => {
    const fixtureClient = createFixtureDataverseClient({
      queryAll: {
        accounts: [],
      },
    });

    mockDataverseResolution({
      fixture: fixtureClient,
    });

    const result = await executeDataverseCreate({
      environment: 'fixture',
      table: 'accounts',
      body: {
        name: 'Harness Account Seed',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      created: true,
      table: 'accounts',
      result: {
        status: 204,
        entityId: 'fixture-accounts-1',
      },
    });
    expect(result.suggestedNextActions).toContain(
      'Call pp.dataverse.query with environment fixture and a filter that targets fixture-accounts-1 if you need read-side confirmation of the inserted row.',
    );

    const remaining = await fixtureClient.queryAll<{ accountid: string; name: string }>({
      table: 'accounts',
    });
    expect(remaining.success).toBe(true);
    expect(remaining.data).toEqual([
      {
        accountid: 'fixture-accounts-1',
        name: 'Harness Account Seed',
      },
    ]);
  });

  it('previews one repo-local dataverse metadata manifest without mutating the target environment', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'pp-mcp-metadata-plan-'));
    await writeFile(
      join(projectRoot, 'schema.apply.yaml'),
      ['operations:', '  - kind: add-column', '    tableLogicalName: pp_project', '    file: project-status.column.yaml', '  - kind: create-table', '    file: project.table.yaml', ''].join('\n'),
      'utf8',
    );
    await writeFile(
      join(projectRoot, 'project.table.yaml'),
      ['schemaName: pp_Project', 'displayName: Project', 'pluralDisplayName: Projects', 'primaryName:', '  schemaName: pp_Name', '  displayName: Name', ''].join('\n'),
      'utf8',
    );
    await writeFile(
      join(projectRoot, 'project-status.column.yaml'),
      ['kind: string', 'schemaName: pp_Status', 'displayName: Status', 'maxLength: 100', ''].join('\n'),
      'utf8',
    );

    const result = await executeDataverseMetadataApply(
      {
        environment: 'fixture',
        manifestPath: 'schema.apply.yaml',
        mode: 'dry-run',
      },
      {
        projectPath: projectRoot,
      },
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      mode: 'dry-run',
      operationCount: 2,
      operationsByKind: {
        'create-table': 1,
        'add-column': 1,
      },
      publishRequested: true,
    });
    expect(result.data?.plan.operations.map((operation) => operation.kind)).toEqual(['create-table', 'add-column']);
    expect(result.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'harvested',
        }),
      ]),
    );
  });

  it('applies one repo-local dataverse metadata manifest through the shared remote client path', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'pp-mcp-metadata-apply-'));
    await writeFile(
      join(projectRoot, 'schema.apply.yaml'),
      ['operations:', '  - kind: create-table', '    file: project.table.yaml', ''].join('\n'),
      'utf8',
    );
    await writeFile(
      join(projectRoot, 'project.table.yaml'),
      ['schemaName: pp_Project', 'displayName: Project', 'pluralDisplayName: Projects', 'primaryName:', '  schemaName: pp_Name', '  displayName: Name', ''].join('\n'),
      'utf8',
    );

    const applyMetadataPlan = vi.fn(async () => ({
      success: true,
      data: {
        operations: [
          {
            kind: 'create-table',
            status: 204,
            entityId: 'entity-1',
            entitySummary: {
              kind: 'table',
              logicalName: 'pp_project',
            },
          },
        ],
        summary: {
          operationCount: 1,
          operationsByKind: {
            'create-table': 1,
          },
        },
        published: true,
        publishTargets: ['pp_project'],
      },
      diagnostics: [],
      warnings: [],
      supportTier: 'preview',
    }));

    mockDataverseResolution({
      fixture: {
        client: {
          applyMetadataPlan,
        } as never,
      },
    });

    const result = await executeDataverseMetadataApply(
      {
        environment: 'fixture',
        manifestPath: 'schema.apply.yaml',
        solutionUniqueName: 'Core',
        mode: 'apply',
        publish: false,
      },
      {
        projectPath: projectRoot,
      },
    );

    expect(result.success).toBe(true);
    expect(applyMetadataPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        operations: [expect.objectContaining({ kind: 'create-table' })],
      }),
      {
        solutionUniqueName: 'Core',
        publish: false,
      },
    );
    expect(result.data).toMatchObject({
      mode: 'apply',
      publishRequested: false,
      result: {
        published: true,
        publishTargets: ['pp_project'],
      },
    });
  });

  it('returns structured install-state drift when the target environment lacks the solution', async () => {
    mockDataverseResolution({
      source: createFixtureDataverseClient({
        query: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'canvasdemonstration',
              friendlyname: 'Canvas Demonstration',
              version: '1.0.0.0',
              ismanaged: false,
            },
          ],
        },
        queryAll: {
          solutions: [
            {
              solutionid: 'sol-1',
              uniquename: 'canvasdemonstration',
              friendlyname: 'Canvas Demonstration',
              version: '1.0.0.0',
              ismanaged: false,
            },
          ],
        },
      }),
      target: createFixtureDataverseClient({
        query: {
          solutions: [],
        },
        queryAll: {
          solutions: [],
        },
      }),
    });

    const result = await compareSolutionAcrossEnvironments({
      uniqueName: 'canvasdemonstration',
      sourceEnvironment: 'source',
      targetEnvironment: 'target',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      uniqueName: 'canvasdemonstration',
      sourceEnvironment: 'source',
      targetEnvironment: 'target',
      installState: {
        sourcePresent: true,
        targetPresent: false,
      },
      compare: {
        uniqueName: 'canvasdemonstration',
        source: {
          solution: {
            uniquename: 'canvasdemonstration',
          },
        },
      },
    });
    expect(result.suggestedNextActions).toContain(
      'Solution canvasdemonstration is present in source but absent from target; use this install-state drift as the compare result instead of treating the compare as a terminal failure.',
    );
  });

  it('exposes init setup sessions through MCP tools', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-init-config-'));
    await writeFixtureConfig(configDir);
    const projectRoot = await mkdtemp(join(tmpdir(), 'pp-mcp-init-project-'));

    const client = await createClient({
      configDir,
      projectPath: projectRoot,
      env: {
        PP_INIT_MCP_TOKEN: 'fixture-token',
      },
    });

    const started = await client.callTool({
      name: 'pp.init.start',
      arguments: {
        projectPath: projectRoot,
        goal: 'project',
        authMode: 'environment-token',
        authProfileName: 'ci',
        tokenEnvVar: 'PP_INIT_MCP_TOKEN',
        environmentAlias: 'dev2',
        environmentUrl: 'https://example.crm.dynamics.com',
        projectName: 'demo',
        solutionName: 'Core',
        stageName: 'dev',
      },
    });

    expect(started.isError).toBeFalsy();
    expect(started.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.init.start',
        mutationPolicy: {
          mode: 'controlled',
          approvalRequired: false,
          sessionRequired: false,
        },
      },
      data: {
        status: 'completed',
      },
    });

    const sessionId = (started.structuredContent as { data: { id: string } }).data.id;
    const status = await client.callTool({
      name: 'pp.init.status',
      arguments: {
        sessionId,
      },
    });

    expect(status.isError).toBeFalsy();
    expect(status.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.init.status',
      },
      data: {
        id: sessionId,
        status: 'completed',
      },
    });
  });

  it('supports deploy plan-then-apply with explicit approval gating', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
    await writeFixtureConfig(configDir);

    const projectRoot = await mkdtemp(join(tmpdir(), 'pp-mcp-deploy-project-'));
    await mkdir(join(projectRoot, 'flows', 'invoice'), { recursive: true });
    await writeFile(
      join(projectRoot, 'pp.config.yaml'),
      [
        'topology:',
        '  defaultStage: dev',
        '  stages:',
        '    dev: {}',
        'parameters:',
        '  apiBaseUrl:',
        '    type: string',
        '    value: https://contoso.example',
        '    mapsTo:',
        '      - kind: flow-parameter',
        '        path: flows/invoice/flow.json',
        '        target: ApiBaseUrl',
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      join(projectRoot, 'flows', 'invoice', 'flow.json'),
      await readFile(resolveRepoPath('fixtures', 'flow', 'golden', 'unpacked.flow.json'), 'utf8'),
      'utf8'
    );

    const client = await createClient({
      configDir,
      projectPath: projectRoot,
    });

    const plan = await client.callTool({
      name: 'pp.deploy.plan',
      arguments: {},
    });
    expect(plan.isError).toBeFalsy();
    expect(plan.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.deploy.plan',
        mutationPolicy: {
          mode: 'controlled',
          mutationsExposed: true,
          approvalRequired: true,
          sessionRequired: true,
        },
      },
      data: {
        session: {
          operationCount: 1,
          operationKinds: ['flow-parameter-set'],
        },
        preview: {
          mode: 'plan',
          preflight: {
            ok: true,
          },
        },
      },
    });

    const sessionId = (plan.structuredContent as { data: { session: { id: string } } }).data.session.id;

    const blockedApply = await client.callTool({
      name: 'pp.deploy.apply',
      arguments: {
        sessionId,
      },
    });
    expect(blockedApply.isError).toBeFalsy();
    expect(blockedApply.structuredContent).toMatchObject({
      success: true,
      data: {
        approval: {
          required: true,
          confirmed: false,
          matchedSession: false,
        },
        result: {
          mode: 'apply',
          confirmation: {
            required: true,
            confirmed: false,
            status: 'blocked',
          },
          preflight: {
            ok: false,
          },
        },
      },
    });

    const apply = await client.callTool({
      name: 'pp.deploy.apply',
      arguments: {
        sessionId,
        approval: {
          confirmed: true,
          sessionId,
          reason: 'fixture test',
        },
      },
    });
    expect(apply.isError).toBeFalsy();
    expect(apply.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.deploy.apply',
        mutationPolicy: {
          mode: 'controlled',
          mutationsExposed: true,
        },
      },
      data: {
        approval: {
          required: true,
          confirmed: true,
          matchedSession: true,
        },
        result: {
          mode: 'apply',
          confirmation: {
            required: true,
            confirmed: true,
            status: 'confirmed',
          },
          preflight: {
            ok: true,
          },
          apply: {
            summary: {
              applied: 1,
            },
            operations: [
              expect.objectContaining({
                kind: 'flow-parameter-set',
                status: 'applied',
                changed: true,
              }),
            ],
          },
        },
      },
    });

    const updatedArtifact = JSON.parse(await readFile(join(projectRoot, 'flows', 'invoice', 'flow.json'), 'utf8')) as {
      metadata: { parameters: Record<string, unknown> };
      definition: { parameters: Record<string, { defaultValue?: unknown }> };
    };
    expect(updatedArtifact.metadata.parameters.ApiBaseUrl).toBe('https://contoso.example');
    expect(updatedArtifact.definition.parameters.ApiBaseUrl?.defaultValue).toBe('https://contoso.example');
  });
});
