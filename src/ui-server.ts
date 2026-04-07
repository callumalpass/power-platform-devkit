import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import type { LoginAccountInput } from './auth.js';
import { getConfigDir, getConfigPath, getMsalCacheDir, type EnvironmentAccessMode } from './config.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';
import { renderHtml } from './ui-app.js';
import { UiJobStore } from './ui-jobs.js';
import type { ApiKind } from './request.js';
import { listAccountSummaries, loginAccount, removeAccountByName } from './services/accounts.js';
import { runConnectivityPing, runWhoAmICheck } from './services/checks.js';
import { addConfiguredEnvironment, discoverAccessibleEnvironments, listConfiguredEnvironments, removeConfiguredEnvironment } from './services/environments.js';

export interface PpUiOptions {
  configDir?: string;
  port?: number;
  openBrowser?: boolean;
  allowInteractiveAuth?: boolean;
}

const MCP_TOOLS = [
  'pp.account.list',
  'pp.account.inspect',
  'pp.account.save',
  'pp.account.remove',
  'pp.account.login',
  'pp.environment.list',
  'pp.environment.inspect',
  'pp.environment.add',
  'pp.environment.discover',
  'pp.environment.remove',
  'pp.request',
  'pp.dv_request',
  'pp.flow_request',
  'pp.graph_request',
  'pp.bap_request',
  'pp.powerapps_request',
  'pp.whoami',
  'pp.ping',
  'pp.token',
];

export async function startPpUi(options: PpUiOptions = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const configOptions = options.configDir ? { configDir: options.configDir } : {};
  const host = '127.0.0.1';
  const port = options.port ?? 4733;
  const allowInteractiveAuth = options.allowInteractiveAuth ?? true;
  const jobs = new UiJobStore();

  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, {
        configOptions,
        allowInteractiveAuth,
        host,
        port,
        jobs,
      });
    } catch (error) {
      sendJson(
        response,
        500,
        fail(
          createDiagnostic('error', 'UI_UNHANDLED_ERROR', error instanceof Error ? error.message : String(error), {
            source: 'pp/ui',
          }),
        ),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://${host}:${resolvedPort}`;
  process.stdout.write(`pp UI listening at ${url}\n`);
  if (options.openBrowser !== false) openBrowser(url);

  return {
    url,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

interface RequestContext {
  configOptions: { configDir?: string };
  allowInteractiveAuth: boolean;
  host: string;
  port: number;
  jobs: UiJobStore;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, context: RequestContext): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${context.host}:${context.port}`);

  if (method === 'GET' && url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(renderHtml());
    return;
  }

  if (method === 'GET' && url.pathname === '/api/state') {
    sendJson(response, 200, await loadState(context));
    return;
  }

  if (method === 'POST' && url.pathname === '/api/accounts/login') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const input = readLoginInput(body.data);
    if (!input.success || !input.data) {
      sendJson(response, 400, input);
      return;
    }
    const result = await loginAccount(input.data, {
      preferredFlow: body.data.preferredFlow === 'device-code' ? 'device-code' : 'interactive',
      forcePrompt: Boolean(body.data.forcePrompt),
      allowInteractive: context.allowInteractiveAuth,
    }, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/jobs/account-login') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const bodyData = body.data;
    const input = readLoginInput(bodyData);
    if (!input.success || !input.data) {
      sendJson(response, 400, input);
      return;
    }
    const job = context.jobs.createJob('account-login', () =>
      loginAccount(input.data!, {
        preferredFlow: bodyData.preferredFlow === 'device-code' ? 'device-code' : 'interactive',
        forcePrompt: Boolean(bodyData.forcePrompt),
        allowInteractive: context.allowInteractiveAuth,
      }, context.configOptions),
    );
    sendJson(response, 202, ok(job));
    return;
  }

  if (method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
    const jobId = decodeURIComponent(url.pathname.slice('/api/jobs/'.length));
    const job = context.jobs.getJob(jobId);
    if (!job) {
      sendJson(response, 404, fail(createDiagnostic('error', 'JOB_NOT_FOUND', `Job ${jobId} was not found.`, { source: 'pp/ui' })));
      return;
    }
    sendJson(response, 200, ok(job));
    return;
  }

  if (method === 'DELETE' && url.pathname.startsWith('/api/jobs/')) {
    const jobId = decodeURIComponent(url.pathname.slice('/api/jobs/'.length));
    const job = context.jobs.cancelJob(jobId);
    if (!job) {
      sendJson(response, 404, fail(createDiagnostic('error', 'JOB_NOT_FOUND', `Job ${jobId} was not found.`, { source: 'pp/ui' })));
      return;
    }
    sendJson(response, 200, ok(job));
    return;
  }

  if (method === 'DELETE' && url.pathname.startsWith('/api/accounts/')) {
    const name = decodeURIComponent(url.pathname.slice('/api/accounts/'.length));
    const result = await removeAccountByName(name, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/environments/discover') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const account = optionalString(body.data.account);
    if (!account) {
      sendJson(response, 400, fail(createDiagnostic('error', 'ACCOUNT_REQUIRED', 'account is required.', { source: 'pp/ui' })));
      return;
    }
    const result = await discoverAccessibleEnvironments(
      account,
      context.configOptions,
      { allowInteractive: context.allowInteractiveAuth },
    );
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/environments') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const input = readEnvironmentInput(body.data);
    if (!input.success || !input.data) {
      sendJson(response, 400, input);
      return;
    }
    const result = await addConfiguredEnvironment(input.data, context.configOptions, {
      allowInteractive: context.allowInteractiveAuth,
    });
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'DELETE' && url.pathname.startsWith('/api/environments/')) {
    const alias = decodeURIComponent(url.pathname.slice('/api/environments/'.length));
    const result = await removeConfiguredEnvironment(alias, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/checks/whoami') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const environment = optionalString(body.data.environment);
    if (!environment) {
      sendJson(response, 400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/ui' })));
      return;
    }
    const result = await runWhoAmICheck({
      environmentAlias: environment,
      accountName: optionalString(body.data.account),
      allowInteractive: context.allowInteractiveAuth,
    }, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/checks/ping') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const environment = optionalString(body.data.environment);
    const api = readPingApi(body.data.api);
    if (!environment) {
      sendJson(response, 400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/ui' })));
      return;
    }
    const result = await runConnectivityPing({
      environmentAlias: environment,
      accountName: optionalString(body.data.account),
      api,
      allowInteractive: context.allowInteractiveAuth,
    }, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  sendJson(response, 404, fail(createDiagnostic('error', 'NOT_FOUND', `No route for ${method} ${url.pathname}.`, { source: 'pp/ui' })));
}

async function loadState(context: RequestContext): Promise<OperationResult<Record<string, unknown>>> {
  const accounts = await listAccountSummaries(context.configOptions);
  if (!accounts.success) return fail(...accounts.diagnostics);
  const environments = await listConfiguredEnvironments(context.configOptions);
  if (!environments.success) return fail(...environments.diagnostics);
  return ok({
    configDir: getConfigDir(context.configOptions),
    configPath: getConfigPath(context.configOptions),
    msalCacheDir: getMsalCacheDir(context.configOptions),
    allowInteractiveAuth: context.allowInteractiveAuth,
    accounts: accounts.data ?? [],
    environments: environments.data ?? [],
    mcp: {
      transport: 'stdio',
      tools: MCP_TOOLS,
      launchCommand: buildMcpLaunchCommand(context),
      note: 'pp MCP uses stdio transport. Launch it from the consuming MCP client rather than from this UI.',
    },
  });
}

function buildMcpLaunchCommand(context: RequestContext): string {
  const parts = ['pp', 'mcp'];
  if (context.configOptions.configDir) parts.push('--config-dir', quoteShell(context.configOptions.configDir));
  if (context.allowInteractiveAuth) parts.push('--allow-interactive-auth');
  return parts.join(' ');
}

function quoteShell(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function readLoginInput(value: unknown): OperationResult<LoginAccountInput> {
  if (!isRecord(value)) {
    return fail(createDiagnostic('error', 'INVALID_LOGIN_INPUT', 'Request body must be a JSON object.', { source: 'pp/ui' }));
  }
  const name = optionalString(value.name);
  const kind = readAccountKind(value.kind);
  if (!name) return fail(createDiagnostic('error', 'ACCOUNT_NAME_REQUIRED', 'name is required.', { source: 'pp/ui' }));
  if (!kind) return fail(createDiagnostic('error', 'ACCOUNT_KIND_REQUIRED', 'kind must be one of user, device-code, client-secret, environment-token, static-token.', { source: 'pp/ui' }));
  return ok({
    name,
    kind,
    description: optionalString(value.description),
    tenantId: optionalString(value.tenantId),
    clientId: optionalString(value.clientId),
    loginHint: optionalString(value.loginHint),
    prompt: readPrompt(optionalString(value.prompt)),
    fallbackToDeviceCode: Boolean(value.fallbackToDeviceCode),
    clientSecretEnv: optionalString(value.clientSecretEnv),
    environmentVariable: optionalString(value.environmentVariable),
    token: optionalString(value.token),
  });
}

function readEnvironmentInput(
  value: unknown,
): OperationResult<{ alias: string; url: string; account: string; displayName?: string; accessMode?: EnvironmentAccessMode }> {
  if (!isRecord(value)) {
    return fail(createDiagnostic('error', 'INVALID_ENVIRONMENT_INPUT', 'Request body must be a JSON object.', { source: 'pp/ui' }));
  }
  const alias = optionalString(value.alias);
  const url = optionalString(value.url);
  const account = optionalString(value.account);
  const accessMode = readAccessMode(value.accessMode);
  if (!alias) return fail(createDiagnostic('error', 'ENV_ALIAS_REQUIRED', 'alias is required.', { source: 'pp/ui' }));
  if (!url) return fail(createDiagnostic('error', 'ENV_URL_REQUIRED', 'url is required.', { source: 'pp/ui' }));
  if (!account) return fail(createDiagnostic('error', 'ENV_ACCOUNT_REQUIRED', 'account is required.', { source: 'pp/ui' }));
  if (value.accessMode !== undefined && !accessMode) {
    return fail(createDiagnostic('error', 'ENV_ACCESS_MODE_INVALID', 'accessMode must be read-only or read-write.', { source: 'pp/ui' }));
  }
  return ok({
    alias,
    url,
    account,
    displayName: optionalString(value.displayName),
    accessMode,
  });
}

async function readJsonBody(request: IncomingMessage): Promise<OperationResult<Record<string, unknown>>> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) return ok({});
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) {
      return fail(createDiagnostic('error', 'INVALID_JSON_BODY', 'Request body must be a JSON object.', { source: 'pp/ui' }));
    }
    return ok(parsed);
  } catch (error) {
    return fail(
      createDiagnostic('error', 'INVALID_JSON_BODY', 'Failed to parse request JSON.', {
        source: 'pp/ui',
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function sendJson(response: ServerResponse, status: number, body: OperationResult<unknown>): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
      return;
    }
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
      child.unref();
      return;
    }
    const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    // Best effort only.
  }
}

function readAccountKind(value: unknown): LoginAccountInput['kind'] | undefined {
  return value === 'user' || value === 'device-code' || value === 'client-secret' || value === 'environment-token' || value === 'static-token'
    ? value
    : undefined;
}

function readPrompt(value: string | undefined): LoginAccountInput['prompt'] | undefined {
  return value === 'select_account' || value === 'login' || value === 'consent' || value === 'none' ? value : undefined;
}

function readAccessMode(value: unknown): EnvironmentAccessMode | undefined {
  return value === 'read-only' || value === 'read-write' ? value : undefined;
}

function readPingApi(value: unknown): Exclude<ApiKind, 'custom'> {
  return value === 'flow' || value === 'graph' || value === 'bap' || value === 'powerapps' ? value : 'dv';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
