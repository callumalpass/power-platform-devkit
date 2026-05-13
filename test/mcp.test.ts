import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveAccount, saveEnvironment } from '../src/config.js';
import { createPpMcpServer } from '../src/mcp.js';

type ToolHandlerResult = { structuredContent?: { success?: boolean; data?: unknown; diagnostics?: Array<{ code?: string }> } };
type RegisteredTool = { handler: (args: Record<string, unknown>) => Promise<ToolHandlerResult> | ToolHandlerResult };
type McpServerWithTools = { _registeredTools: Record<string, RegisteredTool> };

test('MCP registers auth session tools', () => {
  const tools = registeredTools();

  assert.ok(tools['pp.auth.start']);
  assert.ok(tools['pp.auth.status']);
  assert.ok(tools['pp.auth.cancel']);
});

test('MCP auth session tools start and poll a session', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-auth-session-'));
  const tools = registeredTools();

  const started = await tools['pp.auth.start']?.handler({
    configDir,
    name: 'local-token',
    kind: 'static-token',
    token: 'not-a-jwt',
    apis: ['graph']
  });
  assert.equal(started?.structuredContent?.success, true);
  const sessionId = readSessionId(started);

  const completed = await waitForMcpSession(tools, sessionId, 'completed');
  assert.equal(completed.structuredContent?.success, true);
});

test('MCP request tools return MCP_AUTH_REQUIRED instead of starting hidden interactive auth', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'pp-mcp-auth-required-'));
  await saveAccount({ name: 'work', kind: 'user', tokenCacheKey: 'work-cache' }, { configDir, credentialStore: 'file' });
  await saveEnvironment(
    {
      alias: 'dev',
      account: 'work',
      url: 'https://example.crm.dynamics.com',
      makerEnvironmentId: '00000000-0000-0000-0000-000000000001',
      tenantId: '00000000-0000-0000-0000-000000000002'
    },
    { configDir, credentialStore: 'file' }
  );

  const tools = registeredTools();
  const result = await tools['pp.request']?.handler({
    configDir,
    environment: 'dev',
    path: '/WhoAmI',
    method: 'GET',
    readIntent: true,
    allowInteractiveAuth: true
  });

  assert.equal(result?.structuredContent?.success, false);
  assert.equal(result?.structuredContent?.diagnostics?.[0]?.code, 'MCP_AUTH_REQUIRED');
});

function registeredTools(): Record<string, RegisteredTool> {
  return (createPpMcpServer() as unknown as McpServerWithTools)._registeredTools;
}

function readSessionId(result: ToolHandlerResult | undefined): string {
  const data = result?.structuredContent?.data;
  assert.ok(data && typeof data === 'object' && 'id' in data && typeof data.id === 'string');
  return data.id;
}

async function waitForMcpSession(tools: Record<string, RegisteredTool>, sessionId: string, status: string): Promise<ToolHandlerResult> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await tools['pp.auth.status']?.handler({ sessionId });
    const data = result?.structuredContent?.data;
    if (data && typeof data === 'object' && 'status' in data && data.status === status) return result;
    await delay(10);
  }
  assert.fail(`Timed out waiting for MCP auth session ${sessionId} to reach ${status}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
