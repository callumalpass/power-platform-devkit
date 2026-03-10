import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolveRepoPath } from '../../../test/golden';

describe('@pp/mcp', () => {
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.map(async (client) => client.close()));
    clients.length = 0;
  });

  it('connects over stdio and exposes the read-first tool surface', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-config-'));
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
          configDir,
          '--project',
          resolveRepoPath('fixtures', 'analysis', 'project'),
        ],
        cwd: resolveRepoPath(),
        env: {
          ...process.env,
          PP_TENANT_DOMAIN: 'contoso.example',
          PP_SQL_ENDPOINT: 'tcp:sql.example.test,1433',
          PP_SECRET_APP_TOKEN: 'fixture-secret',
        } as Record<string, string>,
        stderr: 'pipe',
      })
    );

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'pp.environment.list',
        'pp.solution.list',
        'pp.solution.inspect',
        'pp.dataverse.query',
        'pp.connection-reference.inspect',
        'pp.environment-variable.inspect',
        'pp.model-app.inspect',
        'pp.project.inspect',
        'pp.analysis.context',
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

    const domains = await client.callTool({
      name: 'pp.domain.list',
      arguments: {},
    });
    expect(domains.isError).toBeFalsy();
    expect((domains.structuredContent as { data: Array<{ name: string }> }).data.map((item) => item.name)).toContain('dataverse');
  });
});
