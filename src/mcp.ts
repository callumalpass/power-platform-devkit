import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { LoginAccountInput } from './auth.js';
import { saveAccount, type Account, type ConfigStoreOptions } from './config.js';
import type { ApiKind } from './request.js';
import { inspectAccountSummary, listAccountSummaries, loginAccount, removeAccountByName } from './services/accounts.js';
import { executeApiRequest, getEnvironmentToken, runConnectivityPing, runWhoAmICheck } from './services/api.js';
import { addConfiguredEnvironment, discoverAccessibleEnvironments, inspectConfiguredEnvironment, listConfiguredEnvironments, removeConfiguredEnvironment } from './services/environments.js';

export interface PpMcpServerOptions {
  configDir?: string;
  allowInteractiveAuth?: boolean;
}

const outputSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  diagnostics: z.array(
    z.object({
      level: z.string(),
      code: z.string(),
      message: z.string(),
      source: z.string().optional(),
      hint: z.string().optional(),
      detail: z.string().optional(),
      path: z.string().optional(),
    }),
  ),
});

export function createPpMcpServer(options: PpMcpServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'pp', version: '0.1.0' });
  registerTools(server, options);
  return server;
}

export async function startPpMcpServer(options: PpMcpServerOptions = {}): Promise<{ server: McpServer; transport: StdioServerTransport }> {
  const server = createPpMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { server, transport };
}

function registerTools(server: McpServer, defaults: PpMcpServerOptions): void {
  server.registerTool(
    'pp.account.list',
    {
      title: 'List Accounts',
      description: 'List configured accounts.',
      inputSchema: z.object({ configDir: z.string().optional() }),
      outputSchema,
    },
    async ({ configDir }) => toolResult(await listAccountSummaries(config(configDir, defaults))),
  );

  server.registerTool(
    'pp.account.inspect',
    {
      title: 'Inspect Account',
      description: 'Inspect one account.',
      inputSchema: z.object({ name: z.string(), configDir: z.string().optional() }),
      outputSchema,
    },
    async ({ name, configDir }) => {
      const result = await inspectAccountSummary(name, config(configDir, defaults));
      return toolResult(result);
    },
  );

  server.registerTool(
    'pp.account.save',
    {
      title: 'Save Account',
      description: 'Create or update one account.',
      inputSchema: z.object({
        configDir: z.string().optional(),
        name: z.string(),
        kind: z.enum(['user', 'device-code', 'client-secret', 'environment-token', 'static-token']),
        tenantId: z.string().optional(),
        clientId: z.string().optional(),
        scopes: z.array(z.string()).optional(),
        loginHint: z.string().optional(),
        tokenCacheKey: z.string().optional(),
        prompt: z.enum(['select_account', 'login', 'consent', 'none']).optional(),
        fallbackToDeviceCode: z.boolean().optional(),
        clientSecretEnv: z.string().optional(),
        environmentVariable: z.string().optional(),
        token: z.string().optional(),
        description: z.string().optional(),
      }),
      outputSchema,
    },
    async ({ configDir, ...input }) => toolResult(await saveAccount(input as Account, config(configDir, defaults))),
  );

  server.registerTool(
    'pp.account.remove',
    {
      title: 'Remove Account',
      description: 'Remove one account.',
      inputSchema: z.object({ name: z.string(), configDir: z.string().optional() }),
      outputSchema,
    },
    async ({ name, configDir }) => toolResult(await removeAccountByName(name, config(configDir, defaults))),
  );

  server.registerTool(
    'pp.account.login',
    {
      title: 'Login Account',
      description: 'Create or update one account and run a login flow.',
      inputSchema: z.object({
        configDir: z.string().optional(),
        allowInteractiveAuth: z.boolean().optional(),
        preferredFlow: z.enum(['interactive', 'device-code']).optional(),
        forcePrompt: z.boolean().optional(),
        name: z.string(),
        kind: z.enum(['user', 'device-code', 'client-secret', 'environment-token', 'static-token']),
        tenantId: z.string().optional(),
        clientId: z.string().optional(),
        scopes: z.array(z.string()).optional(),
        loginHint: z.string().optional(),
        prompt: z.enum(['select_account', 'login', 'consent', 'none']).optional(),
        fallbackToDeviceCode: z.boolean().optional(),
        clientSecretEnv: z.string().optional(),
        environmentVariable: z.string().optional(),
        token: z.string().optional(),
        description: z.string().optional(),
      }),
      outputSchema,
    },
    async ({ configDir, allowInteractiveAuth, preferredFlow, forcePrompt, ...input }) =>
      toolResult(await loginAccount(input as LoginAccountInput, { allowInteractive: allowInteractiveAuth ?? defaults.allowInteractiveAuth, preferredFlow, forcePrompt }, config(configDir, defaults))),
  );

  server.registerTool(
    'pp.environment.list',
    {
      title: 'List Environments',
      description: 'List configured environments.',
      inputSchema: z.object({ configDir: z.string().optional() }),
      outputSchema,
    },
    async ({ configDir }) => toolResult(await listConfiguredEnvironments(config(configDir, defaults))),
  );

  server.registerTool(
    'pp.environment.inspect',
    {
      title: 'Inspect Environment',
      description: 'Inspect one environment.',
      inputSchema: z.object({ alias: z.string(), configDir: z.string().optional() }),
      outputSchema,
    },
    async ({ alias, configDir }) => toolResult(await inspectConfiguredEnvironment(alias, config(configDir, defaults))),
  );

  server.registerTool(
    'pp.environment.add',
    {
      title: 'Add Environment',
      description: 'Create or update one environment and auto-discover makerEnvironmentId and tenantId.',
      inputSchema: z.object({
        alias: z.string(),
        url: z.string().url(),
        account: z.string(),
        displayName: z.string().optional(),
        accessMode: z.enum(['read-write', 'read-only']).optional(),
        configDir: z.string().optional(),
        allowInteractiveAuth: z.boolean().optional(),
      }),
      outputSchema,
    },
    async ({ alias, url, account, displayName, accessMode, configDir, allowInteractiveAuth }) =>
      toolResult(
        await addConfiguredEnvironment(
          { alias, url, account, displayName, accessMode },
          config(configDir, defaults),
          { allowInteractive: allowInteractiveAuth ?? defaults.allowInteractiveAuth },
        ),
      ),
  );

  server.registerTool(
    'pp.environment.discover',
    {
      title: 'Discover Environments',
      description: 'List environments accessible to one account.',
      inputSchema: z.object({
        account: z.string(),
        configDir: z.string().optional(),
        allowInteractiveAuth: z.boolean().optional(),
      }),
      outputSchema,
    },
    async ({ account, configDir, allowInteractiveAuth }) =>
      toolResult(
        await discoverAccessibleEnvironments(
          account,
          config(configDir, defaults),
          { allowInteractive: allowInteractiveAuth ?? defaults.allowInteractiveAuth },
        ),
      ),
  );

  server.registerTool(
    'pp.environment.remove',
    {
      title: 'Remove Environment',
      description: 'Remove one environment.',
      inputSchema: z.object({ alias: z.string(), configDir: z.string().optional() }),
      outputSchema,
    },
    async ({ alias, configDir }) => toolResult(await removeConfiguredEnvironment(alias, config(configDir, defaults))),
  );

  const requestSchema = z.object({
    environment: z.string(),
    account: z.string().optional(),
    path: z.string(),
    method: z.string().optional(),
    api: z.enum(['dv', 'flow', 'graph', 'bap', 'powerapps', 'custom']).optional(),
    query: z.record(z.string(), z.string()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.unknown().optional(),
    rawBody: z.string().optional(),
    responseType: z.enum(['json', 'text', 'void']).optional(),
    timeoutMs: z.number().int().positive().optional(),
    readIntent: z.boolean().optional(),
    configDir: z.string().optional(),
    allowInteractiveAuth: z.boolean().optional(),
  });

  server.registerTool(
    'pp.request',
    {
      title: 'Request',
      description: 'Make an authenticated request with resource auto-detection.',
      inputSchema: requestSchema,
      outputSchema,
    },
    async ({ environment, account, path, method, api, query, headers, body, rawBody, responseType, timeoutMs, readIntent, configDir, allowInteractiveAuth }) =>
      toolResult(
        await executeApiRequest({
          environmentAlias: environment,
          accountName: account,
          path,
          method,
          api: api as ApiKind | undefined,
          query,
          headers,
          body,
          rawBody,
          responseType,
          timeoutMs,
          readIntent,
        }, config(configDir, defaults), { allowInteractive: allowInteractiveAuth ?? defaults.allowInteractiveAuth }),
      ),
  );

  for (const api of ['dv', 'flow', 'graph', 'bap', 'powerapps'] as const) {
    server.registerTool(
      `pp.${api}_request`,
      {
        title: `${api.toUpperCase()} Request`,
        description: `Make an authenticated ${api.toUpperCase()} request.`,
        inputSchema: requestSchema.omit({ api: true }),
        outputSchema,
      },
      async ({ environment, account, path, method, query, headers, body, rawBody, responseType, timeoutMs, readIntent, configDir, allowInteractiveAuth }) =>
        toolResult(
          await executeApiRequest({
            environmentAlias: environment,
            accountName: account,
            path,
            method,
            api,
            query,
            headers,
            body,
            rawBody,
            responseType,
            timeoutMs,
            readIntent,
          }, config(configDir, defaults), { allowInteractive: allowInteractiveAuth ?? defaults.allowInteractiveAuth }),
        ),
    );
  }

  server.registerTool(
    'pp.whoami',
    {
      title: 'Who Am I',
      description: 'Run Dataverse WhoAmI against one environment.',
      inputSchema: z.object({
        environment: z.string(),
        account: z.string().optional(),
        configDir: z.string().optional(),
        allowInteractiveAuth: z.boolean().optional(),
      }),
      outputSchema,
    },
    async ({ environment, account, configDir, allowInteractiveAuth }) => toolResult(await runWhoAmICheck({
      environmentAlias: environment,
      accountName: account,
      allowInteractive: allowInteractiveAuth ?? defaults.allowInteractiveAuth,
    }, config(configDir, defaults))),
  );

  server.registerTool(
    'pp.ping',
    {
      title: 'Ping',
      description: 'Run a minimal authenticated health check against Dataverse, Flow, or Graph.',
      inputSchema: z.object({
        environment: z.string(),
        account: z.string().optional(),
        api: z.enum(['dv', 'flow', 'graph', 'bap', 'powerapps']).optional(),
        configDir: z.string().optional(),
        allowInteractiveAuth: z.boolean().optional(),
      }),
      outputSchema,
    },
    async ({ environment, account, api = 'dv', configDir, allowInteractiveAuth }) =>
      toolResult(await runConnectivityPing({
        environmentAlias: environment,
        accountName: account,
        api,
        allowInteractive: allowInteractiveAuth ?? defaults.allowInteractiveAuth,
      }, config(configDir, defaults))),
  );

  server.registerTool(
    'pp.token',
    {
      title: 'Get Token',
      description: 'Resolve an access token for one environment and API.',
      inputSchema: z.object({
        environment: z.string(),
        account: z.string().optional(),
        api: z.enum(['dv', 'flow', 'graph', 'bap', 'powerapps']).optional(),
        configDir: z.string().optional(),
        allowInteractiveAuth: z.boolean().optional(),
        preferredFlow: z.enum(['interactive', 'device-code']).optional(),
      }),
      outputSchema,
    },
    async ({ environment, account, api = 'dv', configDir, allowInteractiveAuth, preferredFlow }) =>
      toolResult(await getEnvironmentToken({
        environmentAlias: environment,
        accountName: account,
        api,
        allowInteractive: allowInteractiveAuth ?? defaults.allowInteractiveAuth,
        preferredFlow,
      }, config(configDir, defaults))),
  );
}

function config(configDir: string | undefined, defaults: PpMcpServerOptions): ConfigStoreOptions {
  return configDir ? { configDir } : defaults.configDir ? { configDir: defaults.configDir } : {};
}

function toolResult(result: { success: boolean; data?: unknown; diagnostics: unknown[] }) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}
