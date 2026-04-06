import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AuthService, summarizeAccount, type LoginAccountInput } from './auth.js';
import { getAccount, getEnvironment, listAccounts, listEnvironments, removeAccount, removeEnvironment, saveAccount, type Account, type ConfigStoreOptions } from './config.js';
import { addEnvironmentWithDiscovery, executeRequest, resourceForApi, type ApiKind } from './request.js';

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
    async ({ configDir }) => toolResult(await listAccounts(config(configDir, defaults)).then((result) => result.success ? { ...result, data: (result.data ?? []).map(summarizeAccount) } : result)),
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
      const result = await getAccount(name, config(configDir, defaults));
      return toolResult(result.success ? { ...result, data: result.data ? summarizeAccount(result.data) : undefined } : result);
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
    async ({ name, configDir }) => toolResult(await removeAccount(name, config(configDir, defaults))),
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
    async ({ configDir, allowInteractiveAuth, preferredFlow, forcePrompt, ...input }) => {
      const auth = new AuthService(config(configDir, defaults));
      return toolResult(await auth.login(input as LoginAccountInput, { allowInteractive: allowInteractiveAuth ?? defaults.allowInteractiveAuth, preferredFlow, forcePrompt }));
    },
  );

  server.registerTool(
    'pp.environment.list',
    {
      title: 'List Environments',
      description: 'List configured environments.',
      inputSchema: z.object({ configDir: z.string().optional() }),
      outputSchema,
    },
    async ({ configDir }) => toolResult(await listEnvironments(config(configDir, defaults))),
  );

  server.registerTool(
    'pp.environment.inspect',
    {
      title: 'Inspect Environment',
      description: 'Inspect one environment.',
      inputSchema: z.object({ alias: z.string(), configDir: z.string().optional() }),
      outputSchema,
    },
    async ({ alias, configDir }) => toolResult(await getEnvironment(alias, config(configDir, defaults))),
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
        await addEnvironmentWithDiscovery(
          { alias, url, account, displayName, accessMode },
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
    async ({ alias, configDir }) => toolResult(await removeEnvironment(alias, config(configDir, defaults))),
  );

  const requestSchema = z.object({
    environment: z.string(),
    account: z.string().optional(),
    path: z.string(),
    method: z.string().optional(),
    api: z.enum(['dv', 'flow', 'graph', 'custom']).optional(),
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
        await executeRequest({
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
          configOptions: config(configDir, defaults),
          loginOptions: { allowInteractive: allowInteractiveAuth ?? defaults.allowInteractiveAuth },
        }),
      ),
  );

  for (const api of ['dv', 'flow', 'graph'] as const) {
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
          await executeRequest({
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
            configOptions: config(configDir, defaults),
            loginOptions: { allowInteractive: allowInteractiveAuth ?? defaults.allowInteractiveAuth },
          }),
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
    async ({ environment, account, configDir, allowInteractiveAuth }) =>
      toolResult(
        await executeRequest({
          environmentAlias: environment,
          accountName: account,
          api: 'dv',
          path: '/WhoAmI',
          method: 'POST',
          responseType: 'json',
          readIntent: true,
          configOptions: config(configDir, defaults),
          loginOptions: { allowInteractive: allowInteractiveAuth ?? defaults.allowInteractiveAuth },
        }),
      ),
  );

  server.registerTool(
    'pp.ping',
    {
      title: 'Ping',
      description: 'Run a minimal authenticated health check against Dataverse, Flow, or Graph.',
      inputSchema: z.object({
        environment: z.string(),
        account: z.string().optional(),
        api: z.enum(['dv', 'flow', 'graph']).optional(),
        configDir: z.string().optional(),
        allowInteractiveAuth: z.boolean().optional(),
      }),
      outputSchema,
    },
    async ({ environment, account, api = 'dv', configDir, allowInteractiveAuth }) => {
      const common = {
        environmentAlias: environment,
        accountName: account,
        api,
        responseType: 'json' as const,
        configOptions: config(configDir, defaults),
        loginOptions: { allowInteractive: allowInteractiveAuth ?? defaults.allowInteractiveAuth },
      };

      const result =
        api === 'dv'
          ? await executeRequest({ ...common, path: '/WhoAmI', method: 'POST', readIntent: true })
          : api === 'flow'
            ? await executeRequest({ ...common, path: '/flows', method: 'GET', query: { 'api-version': '2016-11-01', '$top': '1' } })
            : await executeRequest({ ...common, path: '/organization', method: 'GET', query: { '$top': '1' } });

      return toolResult(
        result.success && result.data
          ? { ...result, data: { ok: true, api, environment, account: result.data.request.accountName, status: result.data.status, request: result.data.request } }
          : result,
      );
    },
  );

  server.registerTool(
    'pp.token',
    {
      title: 'Get Token',
      description: 'Resolve an access token for one environment and API.',
      inputSchema: z.object({
        environment: z.string(),
        account: z.string().optional(),
        api: z.enum(['dv', 'flow', 'graph']).optional(),
        configDir: z.string().optional(),
        allowInteractiveAuth: z.boolean().optional(),
        preferredFlow: z.enum(['interactive', 'device-code']).optional(),
      }),
      outputSchema,
    },
    async ({ environment, account, api = 'dv', configDir, allowInteractiveAuth, preferredFlow }) => {
      const options = config(configDir, defaults);
      const environmentResult = await getEnvironment(environment, options);
      if (!environmentResult.success || !environmentResult.data) {
        return toolResult(
          environmentResult.success
            ? { success: false, diagnostics: [{ level: 'error', code: 'ENVIRONMENT_NOT_FOUND', message: `Environment ${environment} was not found.`, source: 'pp/mcp' }] }
            : environmentResult,
        );
      }

      const resolvedAccount = account ?? environmentResult.data.account;
      const auth = new AuthService(options);
      const tokenResult = await auth.getToken(resolvedAccount, resourceForApi(environmentResult.data, api), {
        allowInteractive: allowInteractiveAuth ?? defaults.allowInteractiveAuth,
        preferredFlow,
      });
      return toolResult(tokenResult);
    },
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
