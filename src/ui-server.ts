import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import { DEFAULT_LOGIN_RESOURCE, type LoginAccountInput, type LoginTarget } from './auth.js';
import { getConfigDir, getConfigPath, getMsalCacheDir, type EnvironmentAccessMode } from './config.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';
import { FetchXmlMetadataCatalog, type FetchXmlLanguageRequest } from './fetchxml-language-service.js';
import { renderHtml } from './ui-app.js';
import { renderAppModule } from './ui-client/app.js';
import { renderAppsModule } from './ui-client/apps.js';
import { renderAutomateModule } from './ui-client/automate.js';
import { renderConsoleModule } from './ui-client/console.js';
import { renderExplorerModule } from './ui-client/explorer.js';
import { renderFetchXmlModule } from './ui-client/fetchxml.js';
import { renderPlatformModule } from './ui-client/platform.js';
import { renderQueryLabModule } from './ui-client/query-lab.js';
import { renderSetupModule } from './ui-client/setup.js';
import { renderSharedModule } from './ui-client/shared.js';
import { UiJobStore } from './ui-jobs.js';
import { normalizeOrigin, type ApiKind } from './request.js';
import { executeApiRequest } from './services/api.js';
import { checkAccountTokenStatus, listAccountSummaries, loginAccount, removeAccountByName } from './services/accounts.js';
import { runConnectivityPing, runWhoAmICheck } from './services/api.js';
import {
  buildDataverseODataPath,
  buildFetchXml,
  executeFetchXml,
  getDataverseEntityDetail,
  listDataverseEntities,
  listDataverseRecords,
  type DataverseQuerySpec,
  type FetchXmlSpec,
} from './services/dataverse.js';
import { addConfiguredEnvironment, discoverAccessibleEnvironments, listConfiguredEnvironments, removeConfiguredEnvironment } from './services/environments.js';

const moduleRequire: NodeJS.Require = (() => {
  try {
    return eval('require') as NodeJS.Require;
  } catch {
    const anchor = process.argv[1] ? path.resolve(process.argv[1]) : path.join(process.cwd(), '__pp_runtime__.js');
    return createRequire(anchor);
  }
})();

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
  const fetchXmlCatalog = new FetchXmlMetadataCatalog();

  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, {
        configOptions,
        allowInteractiveAuth,
        host,
        port,
        jobs,
        fetchXmlCatalog,
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
  fetchXmlCatalog: FetchXmlMetadataCatalog;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, context: RequestContext): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${context.host}:${context.port}`);

  if (method === 'GET' && url.pathname === '/assets/ui/shared.js') {
    sendJavaScript(response, renderSharedModule());
    return;
  }

  if (method === 'GET' && url.pathname === '/assets/ui/setup.js') {
    sendJavaScript(response, renderSetupModule());
    return;
  }

  if (method === 'GET' && url.pathname === '/assets/ui/explorer.js') {
    sendJavaScript(response, renderExplorerModule());
    return;
  }

  if (method === 'GET' && url.pathname === '/assets/ui/query-lab.js') {
    sendJavaScript(response, renderQueryLabModule());
    return;
  }

  if (method === 'GET' && url.pathname === '/assets/ui/fetchxml.js') {
    sendJavaScript(response, renderFetchXmlModule());
    return;
  }

  if (method === 'GET' && url.pathname === '/assets/ui/console.js') {
    sendJavaScript(response, renderConsoleModule());
    return;
  }

  if (method === 'GET' && url.pathname === '/assets/ui/automate.js') {
    sendJavaScript(response, renderAutomateModule());
    return;
  }

  if (method === 'GET' && url.pathname === '/assets/ui/apps.js') {
    sendJavaScript(response, renderAppsModule());
    return;
  }

  if (method === 'GET' && url.pathname === '/assets/ui/platform.js') {
    sendJavaScript(response, renderPlatformModule());
    return;
  }

  if (method === 'GET' && url.pathname === '/assets/ui/app.js') {
    sendJavaScript(response, renderAppModule());
    return;
  }

  if (method === 'GET' && url.pathname.startsWith('/assets/vendor/')) {
    await sendVendorModule(response, decodeURIComponent(url.pathname.slice('/assets/vendor/'.length)));
    return;
  }

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
    const environments = await listConfiguredEnvironments(context.configOptions);
    if (!environments.success || !environments.data) {
      sendJson(response, 400, fail(...environments.diagnostics));
      return;
    }
    const loginTargets = buildLoginTargets(input.data.name, environments.data, optionalString(bodyData.environmentAlias));
    const job = context.jobs.createJob('account-login', (update) =>
      loginAccount(input.data!, {
        preferredFlow: bodyData.preferredFlow === 'device-code' ? 'device-code' : 'interactive',
        forcePrompt: Boolean(bodyData.forcePrompt),
        allowInteractive: context.allowInteractiveAuth,
        loginTargets,
        onLoginTargetUpdate: async (progress) => {
          update({
            activeLoginTarget: {
              ...progress.target,
              status: progress.status,
              url: progress.url,
            },
          });
        },
      }, context.configOptions),
    );
    job.metadata = { ...(job.metadata ?? {}), loginTargets: loginTargets.map((target) => ({ ...target, status: 'pending' })) };
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

  if (method === 'GET' && url.pathname === '/api/accounts/token-status') {
    const name = optionalString(url.searchParams.get('account'));
    if (!name) {
      sendJson(response, 400, fail(createDiagnostic('error', 'ACCOUNT_REQUIRED', 'account query parameter is required.', { source: 'pp/ui' })));
      return;
    }
    const result = await checkAccountTokenStatus(name, context.configOptions);
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
      allowInteractive: false,
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
      allowInteractive: false,
    }, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/dv/entities') {
    const environmentAlias = optionalString(url.searchParams.get('environment'));
    const allowInteractive = optionalBoolean(url.searchParams.get('allowInteractive')) ?? context.allowInteractiveAuth;
    if (!environmentAlias) {
      sendJson(response, 400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/ui' })));
      return;
    }
    const top = optionalInteger(url.searchParams.get('top'));
    const result = await listDataverseEntities({
      environmentAlias,
      accountName: optionalString(url.searchParams.get('account')),
      search: optionalString(url.searchParams.get('search')),
      top: top ?? undefined,
    }, context.configOptions, { allowInteractive });
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'GET' && /^\/api\/dv\/entities\/[^/]+$/.test(url.pathname)) {
    const environmentAlias = optionalString(url.searchParams.get('environment'));
    if (!environmentAlias) {
      sendJson(response, 400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/ui' })));
      return;
    }
    const logicalName = decodeURIComponent(url.pathname.slice('/api/dv/entities/'.length));
    const result = await getDataverseEntityDetail({
      environmentAlias,
      logicalName,
      accountName: optionalString(url.searchParams.get('account')),
    }, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/dv/query/preview') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const spec = readDataverseQuerySpec(body.data);
    if (!spec.success || !spec.data) {
      sendJson(response, 400, spec);
      return;
    }
    sendJson(response, 200, ok({ path: buildDataverseODataPath(spec.data) }));
    return;
  }

  if (method === 'POST' && url.pathname === '/api/dv/query/execute') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const spec = readDataverseQuerySpec(body.data);
    if (!spec.success || !spec.data) {
      sendJson(response, 400, spec);
      return;
    }
    const result = await listDataverseRecords(spec.data, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/dv/fetchxml/preview') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const spec = readFetchXmlSpec(body.data);
    if (!spec.success || !spec.data) {
      sendJson(response, 400, spec);
      return;
    }
    sendJson(response, 200, ok({ fetchXml: buildFetchXml(spec.data) }));
    return;
  }

  if (method === 'POST' && url.pathname === '/api/dv/fetchxml/execute') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const spec = readFetchXmlSpec(body.data);
    if (!spec.success || !spec.data) {
      sendJson(response, 400, spec);
      return;
    }
    const result = await executeFetchXml(spec.data, context.configOptions);
    sendJson(response, result.success ? 200 : 400, result);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/dv/fetchxml/intellisense') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const languageRequest = readFetchXmlLanguageRequest(body.data);
    if (!languageRequest.success || !languageRequest.data) {
      sendJson(response, 400, languageRequest);
      return;
    }
    sendJson(response, 200, ok(await context.fetchXmlCatalog.analyze(languageRequest.data, context.configOptions)));
    return;
  }

  if (method === 'POST' && url.pathname === '/api/request/execute') {
    const body = await readJsonBody(request);
    if (!body.success || !body.data) {
      sendJson(response, 400, body);
      return;
    }
    const environment = optionalString(body.data.environment);
    const apiKind = readGenericApi(body.data.api);
    const reqMethod = optionalString(body.data.method) ?? 'GET';
    const reqPath = optionalString(body.data.path);
    if (!environment) {
      sendJson(response, 400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/ui' })));
      return;
    }
    if (!reqPath) {
      sendJson(response, 400, fail(createDiagnostic('error', 'PATH_REQUIRED', 'path is required.', { source: 'pp/ui' })));
      return;
    }
    const reqQuery = isRecord(body.data.query) ? body.data.query as Record<string, string> : undefined;
    const reqHeaders = isRecord(body.data.headers) ? body.data.headers as Record<string, string> : undefined;
    const reqBody = body.data.body;
    const isRead = reqMethod.toUpperCase() === 'GET' || reqMethod.toUpperCase() === 'HEAD';
    const allowInteractive = body.data.allowInteractive === undefined ? context.allowInteractiveAuth : Boolean(body.data.allowInteractive);
    const result = await executeApiRequest({
      environmentAlias: environment,
      accountName: optionalString(body.data.account),
      api: apiKind,
      method: reqMethod,
      path: reqPath,
      query: reqQuery,
      headers: reqHeaders,
      body: reqBody,
      responseType: 'json',
      readIntent: isRead,
    }, context.configOptions, { allowInteractive });
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

function buildLoginTargets(accountName: string, environments: Array<{ alias: string; account: string; url: string }>, selectedEnvironmentAlias?: string): LoginTarget[] {
  const targets: LoginTarget[] = [
    { resource: DEFAULT_LOGIN_RESOURCE, label: 'Graph', api: 'graph' },
    { resource: 'https://service.flow.microsoft.com', label: 'Flow', api: 'flow' },
    { resource: 'https://service.powerapps.com', label: 'Power Apps / BAP', api: 'powerapps' },
  ];
  const relevantEnvironments = [
    ...environments.filter((environment) => environment.alias === selectedEnvironmentAlias),
    ...environments.filter((environment) => environment.account === accountName && environment.alias !== selectedEnvironmentAlias),
  ];
  for (const environment of relevantEnvironments) {
    targets.push({
      resource: normalizeOrigin(environment.url),
      label: `Dataverse (${environment.alias})`,
      api: 'dv',
    });
  }
  return dedupeLoginTargets(targets);
}

function dedupeLoginTargets(targets: LoginTarget[]): LoginTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (!target.resource || seen.has(target.resource)) return false;
    seen.add(target.resource);
    return true;
  });
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

function sendJavaScript(response: ServerResponse, source: string): void {
  response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
  response.end(source);
}

async function sendVendorModule(response: ServerResponse, specifier: string): Promise<void> {
  try {
    const resolved = await resolveVendorModulePath(specifier);
    if (resolved.redirect) {
      response.writeHead(302, { location: resolved.redirect, 'cache-control': 'public, max-age=3600' });
      response.end();
      return;
    }
    const source = await readFile(resolved.path, 'utf8');
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    response.end(source);
  } catch (error) {
    sendJson(
      response,
      404,
      fail(createDiagnostic('error', 'UI_VENDOR_MODULE_NOT_FOUND', `Could not resolve browser module ${specifier}.`, {
        source: 'pp/ui',
        detail: error instanceof Error ? error.message : String(error),
      })),
    );
  }
}

async function resolveVendorModulePath(specifier: string): Promise<{ path: string; redirect?: string }> {
  const { packageName, packageSubpath } = splitPackageSpecifier(specifier);
  const cjsEntryPath = moduleRequire.resolve(packageName);
  const packageRoot = derivePackageRoot(cjsEntryPath, packageName);
  if (!packageSubpath) {
    const relativeEntry = readBrowserEntryRelativePath(packageRoot, cjsEntryPath);
    return { path: path.join(packageRoot, relativeEntry), redirect: `/assets/vendor/${packageName}/${relativeEntry}` };
  }
  const resolvedPath = path.resolve(packageRoot, packageSubpath);
  const normalizedRoot = packageRoot.endsWith(path.sep) ? packageRoot : `${packageRoot}${path.sep}`;
  if (!(resolvedPath === packageRoot || resolvedPath.startsWith(normalizedRoot))) {
    throw new Error(`Rejected vendor path traversal for ${specifier}.`);
  }
  return { path: resolvedPath };
}

function splitPackageSpecifier(specifier: string): { packageName: string; packageSubpath: string } {
  const parts = specifier.split('/').filter(Boolean);
  if (!parts.length) throw new Error('Empty vendor specifier.');
  if (specifier.startsWith('@')) {
    return {
      packageName: parts.slice(0, 2).join('/'),
      packageSubpath: parts.slice(2).join('/'),
    };
  }
  return {
    packageName: parts[0],
    packageSubpath: parts.slice(1).join('/'),
  };
}

function derivePackageRoot(entryPath: string, packageName: string): string {
  const marker = `${path.sep}${packageName.split('/').join(path.sep)}${path.sep}`;
  const index = entryPath.lastIndexOf(marker);
  if (index < 0) throw new Error(`Could not derive package root for ${packageName}.`);
  return entryPath.slice(0, index + marker.length - 1);
}

function readBrowserEntryRelativePath(packageRoot: string, cjsEntryPath: string): string {
  const packageJson = moduleRequire(path.join(packageRoot, 'package.json')) as {
    exports?: string | { import?: string };
    module?: string;
  };
  const exportsField = packageJson.exports;
  if (typeof exportsField === 'string') return stripLeadingDotSlash(exportsField);
  if (exportsField && typeof exportsField.import === 'string') return stripLeadingDotSlash(exportsField.import);
  if (typeof packageJson.module === 'string') return stripLeadingDotSlash(packageJson.module);
  return path.relative(packageRoot, cjsEntryPath).split(path.sep).join('/');
}

function stripLeadingDotSlash(value: string): string {
  return value.startsWith('./') ? value.slice(2) : value;
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

function readGenericApi(value: unknown): ApiKind {
  return value === 'dv' || value === 'flow' || value === 'graph' || value === 'bap' || value === 'powerapps' ? value : 'dv';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return value === true || value === 'true' ? true : value === false || value === 'false' ? false : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCsv(value: unknown): string[] | undefined {
  const text = optionalString(value);
  if (!text) return undefined;
  const items = text.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function readDataverseQuerySpec(value: Record<string, unknown>): OperationResult<DataverseQuerySpec> {
  const environmentAlias = optionalString(value.environmentAlias ?? value.environment);
  const entitySetName = optionalString(value.entitySetName);
  const rawPath = optionalString(value.rawPath);
  if (!environmentAlias) {
    return fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environmentAlias is required.', { source: 'pp/ui' }));
  }
  if (!entitySetName && !rawPath) {
    return fail(createDiagnostic('error', 'DV_ENTITY_SET_REQUIRED', 'entitySetName or rawPath is required.', { source: 'pp/ui' }));
  }
  return ok({
    environmentAlias,
    accountName: optionalString(value.accountName ?? value.account),
    entitySetName: entitySetName ?? '',
    select: readStringArray(value.select) ?? readCsv(value.selectCsv),
    filter: optionalString(value.filter),
    orderBy: readStringArray(value.orderBy) ?? readCsv(value.orderByCsv),
    expand: readStringArray(value.expand) ?? readCsv(value.expandCsv),
    top: readNumber(value.top),
    includeCount: value.includeCount === true,
    search: optionalString(value.search),
    rawPath,
  });
}

function readFetchXmlSpec(value: Record<string, unknown>): OperationResult<FetchXmlSpec> {
  const environmentAlias = optionalString(value.environmentAlias ?? value.environment);
  const entity = optionalString(value.entity);
  if (!environmentAlias) {
    return fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environmentAlias is required.', { source: 'pp/ui' }));
  }
  if (!entity && !optionalString(value.rawXml)) {
    return fail(createDiagnostic('error', 'DV_FETCHXML_ENTITY_REQUIRED', 'entity or rawXml is required.', { source: 'pp/ui' }));
  }
  return ok({
    environmentAlias,
    accountName: optionalString(value.accountName ?? value.account),
    entity: entity ?? 'unknown',
    entitySetName: optionalString(value.entitySetName),
    attributes: readStringArray(value.attributes) ?? readCsv(value.attributesCsv),
    top: readNumber(value.top),
    distinct: value.distinct === true,
    rawXml: optionalString(value.rawXml),
    conditions: readArrayOfRecords(value.conditions).map((condition) => ({
      attribute: optionalString(condition.attribute) ?? '',
      operator: optionalString(condition.operator) ?? '',
      value: optionalString(condition.value),
    })),
    orders: readArrayOfRecords(value.orders).map((order) => ({
      attribute: optionalString(order.attribute) ?? '',
      descending: order.descending === true,
    })),
    filterType: readFilterType(value.filterType),
    linkEntities: readArrayOfRecords(value.linkEntities).map((link) => ({
      name: optionalString(link.name) ?? '',
      from: optionalString(link.from) ?? '',
      to: optionalString(link.to) ?? '',
      alias: optionalString(link.alias),
      linkType: readLinkType(link.linkType),
      attributes: readStringArray(link.attributes) ?? readCsv(link.attributesCsv),
      conditions: readArrayOfRecords(link.conditions).map((c) => ({
        attribute: optionalString(c.attribute) ?? '',
        operator: optionalString(c.operator) ?? '',
        value: optionalString(c.value),
      })),
    })),
  });
}

function readFetchXmlLanguageRequest(value: Record<string, unknown>): OperationResult<FetchXmlLanguageRequest> {
  const cursor = readNumber(value.cursor);
  if (cursor === undefined || !Number.isInteger(cursor) || cursor < 0) {
    return fail(createDiagnostic('error', 'FETCHXML_CURSOR_REQUIRED', 'cursor must be a non-negative integer.', { source: 'pp/ui' }));
  }
  const safeCursor = cursor;
  return ok({
    environmentAlias: optionalString(value.environmentAlias ?? value.environment),
    source: typeof value.source === 'string' ? value.source : '',
    cursor: safeCursor,
    rootEntityName: optionalString(value.rootEntityName ?? value.entity),
  });
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => optionalString(item)).filter((item): item is string => Boolean(item));
  return items.length ? items : undefined;
}

function readArrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readFilterType(value: unknown): 'and' | 'or' | undefined {
  return value === 'and' || value === 'or' ? value : undefined;
}

function readLinkType(value: unknown): 'inner' | 'outer' | undefined {
  return value === 'inner' || value === 'outer' ? value : undefined;
}
