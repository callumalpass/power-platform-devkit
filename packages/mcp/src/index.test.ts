import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createDiagnostic, fail } from '@pp/diagnostics';
import { resolveRepoPath } from '../../../test/golden';
import { addSolutionInspectRecoveryGuidance } from './index';

describe('@pp/mcp', () => {
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.map(async (client) => client.close()));
    clients.length = 0;
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

  async function writeFixtureConfig(configDir: string): Promise<void> {
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
        'pp.solution.list',
        'pp.solution.inspect',
        'pp.solution.export',
        'pp.dataverse.query',
        'pp.dataverse.whoami',
        'pp.connection-reference.inspect',
        'pp.environment-variable.inspect',
        'pp.model-app.inspect',
        'pp.project.inspect',
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
      arguments: {},
    });
    expect(project.isError).toBeFalsy();
    expect(project.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.project.inspect',
      },
    });
    expect(
      (project.structuredContent as { data: { discovery: { resolvedRoot: string } } }).data.discovery.resolvedRoot
    ).toBe(resolveRepoPath('fixtures', 'analysis', 'project'));

    const analysis = await client.callTool({
      name: 'pp.analysis.context',
      arguments: {
        focusAsset: 'solution:core',
      },
    });
    expect(analysis.isError).toBeFalsy();
    expect(analysis.structuredContent).toMatchObject({
      success: true,
      tool: {
        name: 'pp.analysis.context',
      },
    });
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
          name: 'dataverse',
          readTools: expect.arrayContaining(['pp.dataverse.query', 'pp.dataverse.whoami']),
          notes: expect.stringContaining('logical names like `solution`'),
        }),
        expect.objectContaining({
          name: 'solution-lifecycle',
          mutationToolsAvailable: true,
          mutationTools: expect.arrayContaining(['pp.solution.export']),
          notes: expect.stringContaining('pp.solution.export'),
        }),
        expect.objectContaining({
          name: 'flow-local-artifacts',
          notes: expect.stringContaining('CLI-only today'),
        }),
        expect.objectContaining({
          name: 'project',
          mutationToolsAvailable: true,
          mutationTools: expect.arrayContaining(['pp.init.start', 'pp.init.answer', 'pp.init.resume', 'pp.init.cancel', 'pp.deploy.plan', 'pp.deploy.apply']),
        }),
        expect.objectContaining({
          name: 'mcp',
          mutationTools: expect.arrayContaining(['pp.solution.export']),
        }),
      ])
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
