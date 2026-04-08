import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { DEFAULT_LOGIN_RESOURCE, type LoginTarget } from './auth.js';
import { getConfigDir, getConfigPath, getMsalCacheDir, saveAccount } from './config.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';
import type { FetchXmlMetadataCatalog } from './fetchxml-language-service.js';
import { renderHtml } from './ui-app.js';
import { sendJavaScript, sendJson, readJsonBody } from './ui-http.js';
import {
  optionalBoolean,
  optionalInteger,
  optionalString,
  readAccountUpdateInput,
  readApiRequestInput,
  readDataverseQuerySpec,
  readEnvironmentInput,
  readFetchXmlLanguageRequest,
  readFetchXmlSpec,
  readLoginInput,
  readPingApi,
} from './ui-request-parsing.js';
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
import type { UiJobStore } from './ui-jobs.js';
import { normalizeOrigin } from './request.js';
import { checkAccountTokenStatus, listAccountSummaries, loginAccount, removeAccountByName } from './services/accounts.js';
import { executeApiRequest, runConnectivityPing, runWhoAmICheck } from './services/api.js';
import {
  buildDataverseODataPath,
  buildFetchXml,
  executeFetchXml,
  getDataverseEntityDetail,
  listDataverseEntities,
  listDataverseRecords,
} from './services/dataverse.js';
import { addConfiguredEnvironment, discoverAccessibleEnvironments, listConfiguredEnvironments, removeConfiguredEnvironment } from './services/environments.js';

export interface UiRequestContext {
  configOptions: { configDir?: string };
  allowInteractiveAuth: boolean;
  host: string;
  port: number;
  jobs: UiJobStore;
  fetchXmlCatalog: FetchXmlMetadataCatalog;
  sendVendorModule: (response: ServerResponse, specifier: string) => Promise<void>;
}

const UI_ASSET_MODULES: Record<string, () => string> = {
  '/assets/ui/shared.js': renderSharedModule,
  '/assets/ui/setup.js': renderSetupModule,
  '/assets/ui/explorer.js': renderExplorerModule,
  '/assets/ui/query-lab.js': renderQueryLabModule,
  '/assets/ui/fetchxml.js': renderFetchXmlModule,
  '/assets/ui/console.js': renderConsoleModule,
  '/assets/ui/automate.js': renderAutomateModule,
  '/assets/ui/apps.js': renderAppsModule,
  '/assets/ui/platform.js': renderPlatformModule,
  '/assets/ui/app.js': renderAppModule,
};

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

export async function handleUiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: UiRequestContext,
): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${context.host}:${context.port}`);

  if (method === 'GET') {
    const assetModule = UI_ASSET_MODULES[url.pathname];
    if (assetModule) {
      sendJavaScript(response, assetModule());
      return;
    }
    if (url.pathname.startsWith('/assets/vendor/')) {
      await context.sendVendorModule(response, decodeURIComponent(url.pathname.slice('/assets/vendor/'.length)));
      return;
    }
    if (url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(renderHtml());
      return;
    }
    if (url.pathname === '/api/state') {
      sendJson(response, 200, await loadState(context));
      return;
    }
    if (url.pathname === '/api/accounts/token-status') {
      await handleAccountTokenStatus(url, response, context);
      return;
    }
    if (url.pathname === '/api/dv/entities') {
      await handleEntityList(url, response, context);
      return;
    }
    if (/^\/api\/dv\/entities\/[^/]+$/.test(url.pathname)) {
      await handleEntityDetail(url, response, context);
      return;
    }
    if (url.pathname.startsWith('/api/jobs/')) {
      await handleJobGet(url, response, context);
      return;
    }
  }

  if (method === 'POST') {
    if (url.pathname === '/api/accounts/login') {
      await handleAccountLogin(request, response, context);
      return;
    }
    if (url.pathname === '/api/jobs/account-login') {
      await handleAccountLoginJob(request, response, context);
      return;
    }
    if (url.pathname === '/api/environments/discover') {
      await handleEnvironmentDiscover(request, response, context);
      return;
    }
    if (url.pathname === '/api/environments') {
      await handleEnvironmentCreate(request, response, context);
      return;
    }
    if (url.pathname === '/api/checks/whoami') {
      await handleWhoAmICheck(request, response, context);
      return;
    }
    if (url.pathname === '/api/checks/ping') {
      await handlePing(request, response, context);
      return;
    }
    if (url.pathname === '/api/dv/query/preview') {
      await handleDataverseQueryPreview(request, response);
      return;
    }
    if (url.pathname === '/api/dv/query/execute') {
      await handleDataverseQueryExecute(request, response, context);
      return;
    }
    if (url.pathname === '/api/dv/fetchxml/preview') {
      await handleFetchXmlPreview(request, response);
      return;
    }
    if (url.pathname === '/api/dv/fetchxml/execute') {
      await handleFetchXmlExecute(request, response, context);
      return;
    }
    if (url.pathname === '/api/dv/fetchxml/intellisense') {
      await handleFetchXmlIntellisense(request, response, context);
      return;
    }
    if (url.pathname === '/api/request/execute') {
      await handleRequestExecute(request, response, context);
      return;
    }
  }

  if (method === 'PUT' && url.pathname.startsWith('/api/accounts/')) {
    await handleAccountUpdate(request, response, url, context);
    return;
  }

  if (method === 'DELETE') {
    if (url.pathname.startsWith('/api/jobs/')) {
      await handleJobDelete(url, response, context);
      return;
    }
    if (url.pathname.startsWith('/api/accounts/')) {
      await handleAccountDelete(url, response, context);
      return;
    }
    if (url.pathname.startsWith('/api/environments/')) {
      await handleEnvironmentDelete(url, response, context);
      return;
    }
  }

  sendJson(response, 404, fail(createDiagnostic('error', 'NOT_FOUND', `No route for ${method} ${url.pathname}.`, { source: 'pp/ui' })));
}

async function handleAccountLogin(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
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
  const result = await loginAccount(
    input.data,
    {
      preferredFlow: body.data.preferredFlow === 'device-code' ? 'device-code' : 'interactive',
      forcePrompt: Boolean(body.data.forcePrompt),
      allowInteractive: context.allowInteractiveAuth,
    },
    context.configOptions,
  );
  sendJson(response, result.success ? 200 : 400, result);
}

async function handleAccountLoginJob(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
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
  const excludeApis = Array.isArray(bodyData.excludeApis) ? bodyData.excludeApis.filter((v: unknown): v is string => typeof v === 'string') : undefined;
  const loginTargets = buildLoginTargets(input.data.name, environments.data, optionalString(bodyData.environmentAlias), excludeApis);
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
      onDeviceCode: async (info) => {
        update({
          deviceCode: {
            verificationUri: info.verificationUri,
            userCode: info.userCode,
            message: info.message,
          },
        });
      },
    }, context.configOptions),
  );
  job.metadata = { ...(job.metadata ?? {}), loginTargets: loginTargets.map((target) => ({ ...target, status: 'pending' })) };
  sendJson(response, 202, ok(job));
}

async function handleJobGet(url: URL, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const jobId = decodeURIComponent(url.pathname.slice('/api/jobs/'.length));
  const job = context.jobs.getJob(jobId);
  if (!job) {
    sendJson(response, 404, fail(createDiagnostic('error', 'JOB_NOT_FOUND', `Job ${jobId} was not found.`, { source: 'pp/ui' })));
    return;
  }
  sendJson(response, 200, ok(job));
}

async function handleJobDelete(url: URL, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const jobId = decodeURIComponent(url.pathname.slice('/api/jobs/'.length));
  const job = context.jobs.cancelJob(jobId);
  if (!job) {
    sendJson(response, 404, fail(createDiagnostic('error', 'JOB_NOT_FOUND', `Job ${jobId} was not found.`, { source: 'pp/ui' })));
    return;
  }
  sendJson(response, 200, ok(job));
}

async function handleAccountDelete(url: URL, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const name = decodeURIComponent(url.pathname.slice('/api/accounts/'.length));
  const result = await removeAccountByName(name, context.configOptions);
  sendJson(response, result.success ? 200 : 400, result);
}

async function handleAccountUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: UiRequestContext,
): Promise<void> {
  const name = decodeURIComponent(url.pathname.slice('/api/accounts/'.length));
  const body = await readJsonBody(request);
  if (!body.success || !body.data) {
    sendJson(response, 400, body);
    return;
  }
  const account = readAccountUpdateInput(name, body.data);
  if (!account.success || !account.data) {
    sendJson(response, 400, account);
    return;
  }
  const result = await saveAccount(account.data, context.configOptions);
  sendJson(response, result.success ? 200 : 400, result);
}

async function handleAccountTokenStatus(url: URL, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const name = optionalString(url.searchParams.get('account'));
  if (!name) {
    sendJson(response, 400, fail(createDiagnostic('error', 'ACCOUNT_REQUIRED', 'account query parameter is required.', { source: 'pp/ui' })));
    return;
  }
  const result = await checkAccountTokenStatus(name, context.configOptions);
  sendJson(response, result.success ? 200 : 400, result);
}

async function handleEnvironmentDiscover(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
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
  const result = await discoverAccessibleEnvironments(account, context.configOptions, { allowInteractive: context.allowInteractiveAuth });
  sendJson(response, result.success ? 200 : 400, result);
}

async function handleEnvironmentCreate(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
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
  const result = await addConfiguredEnvironment(input.data, context.configOptions, { allowInteractive: context.allowInteractiveAuth });
  sendJson(response, result.success ? 200 : 400, result);
}

async function handleEnvironmentDelete(url: URL, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const alias = decodeURIComponent(url.pathname.slice('/api/environments/'.length));
  const result = await removeConfiguredEnvironment(alias, context.configOptions);
  sendJson(response, result.success ? 200 : 400, result);
}

async function handleWhoAmICheck(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
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
}

async function handlePing(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
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
  const result = await runConnectivityPing({
    environmentAlias: environment,
    accountName: optionalString(body.data.account),
    api: readPingApi(body.data.api),
    allowInteractive: false,
  }, context.configOptions);
  sendJson(response, result.success ? 200 : 400, result);
}

async function handleEntityList(url: URL, response: ServerResponse, context: UiRequestContext): Promise<void> {
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
}

async function handleEntityDetail(url: URL, response: ServerResponse, context: UiRequestContext): Promise<void> {
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
}

async function handleDataverseQueryPreview(request: IncomingMessage, response: ServerResponse): Promise<void> {
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
}

async function handleDataverseQueryExecute(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
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
}

async function handleFetchXmlPreview(request: IncomingMessage, response: ServerResponse): Promise<void> {
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
}

async function handleFetchXmlExecute(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
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
}

async function handleFetchXmlIntellisense(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
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
}

async function handleRequestExecute(request: IncomingMessage, response: ServerResponse, context: UiRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.success || !body.data) {
    sendJson(response, 400, body);
    return;
  }
  const input = readApiRequestInput(body.data, context.allowInteractiveAuth);
  if (!input.success || !input.data) {
    sendJson(response, 400, input);
    return;
  }
  const result = await executeApiRequest({
    environmentAlias: input.data.environment,
    accountName: input.data.account,
    api: input.data.api,
    method: input.data.method,
    path: input.data.path,
    query: input.data.query,
    headers: input.data.headers,
    body: input.data.body,
    responseType: 'json',
    readIntent: input.data.readIntent,
  }, context.configOptions, { allowInteractive: input.data.allowInteractive });
  sendJson(response, result.success ? 200 : 400, result);
}

async function loadState(context: UiRequestContext): Promise<OperationResult<Record<string, unknown>>> {
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

function buildMcpLaunchCommand(context: UiRequestContext): string {
  const parts = ['pp', 'mcp'];
  if (context.configOptions.configDir) parts.push('--config-dir', quoteShell(context.configOptions.configDir));
  if (context.allowInteractiveAuth) parts.push('--allow-interactive-auth');
  return parts.join(' ');
}

function quoteShell(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function buildLoginTargets(
  accountName: string,
  environments: Array<{ alias: string; account: string; url: string }>,
  selectedEnvironmentAlias?: string,
  excludeApis?: string[],
): LoginTarget[] {
  const excluded = new Set(excludeApis ?? []);
  const targets: LoginTarget[] = [];
  if (!excluded.has('dv')) {
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
  }
  if (!excluded.has('flow')) {
    targets.push({ resource: 'https://service.flow.microsoft.com', label: 'Flow', api: 'flow' });
  }
  if (!excluded.has('powerapps') && !excluded.has('bap')) {
    targets.push({ resource: 'https://service.powerapps.com', label: 'Power Apps & BAP', api: 'powerapps' });
  }
  if (!excluded.has('graph')) {
    targets.push({ resource: DEFAULT_LOGIN_RESOURCE, label: 'Graph', api: 'graph' });
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
