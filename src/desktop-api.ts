import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { summarizeAccount } from './auth.js';
import { readCanvasYamlDirectory, readCanvasYamlFetchFiles, writeCanvasYamlFiles } from './canvas-yaml-files.js';
import { getConfigDir, getConfigPath, getCredentialStoreMode, getEnvironment, getMsalCacheDir, saveAccount, saveEnvironment, type ConfigStoreOptions, type Environment } from './config.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';
import { FetchXmlMetadataCatalog } from './fetchxml-language-service.js';
import { FlowLanguageService } from './flow-language-service.js';
import { normalizeOrigin as normalizeRequestOrigin } from './request-executor.js';
import { loadSavedRequests, replaceSavedRequests } from './saved-requests.js';
import { checkAccountTokenStatus, listAccountSummaries, loginAccount, removeAccountByName } from './services/accounts.js';
import { executeApiRequest, runConnectivityPing, runWhoAmICheck } from './services/api.js';
import { getBrowserProfileStatus, openBrowserProfile, resetBrowserProfile, verifyBrowserProfile } from './services/browser-profiles.js';
import { buildDataverseODataPath, buildFetchXml, createDataverseRecord, executeFetchXml, getDataverseEntityDetail, listDataverseEntities, listDataverseRecords } from './services/dataverse.js';
import { addConfiguredEnvironment, discoverAccessibleEnvironments, listConfiguredEnvironments, removeConfiguredEnvironment } from './services/environments.js';
import { AuthSessionStore } from './ui-auth-sessions.js';
import { CanvasSessionStore } from './ui-canvas-sessions.js';
import { UiJobStore } from './ui-jobs.js';
import {
  optionalBoolean,
  optionalInteger,
  optionalString,
  readAccountUpdateInput,
  readApiRequestInput,
  readDataverseCreateRecordInput,
  readDataverseQuerySpec,
  readEnvironmentInput,
  readFetchXmlLanguageRequest,
  readFetchXmlSpec,
  readFlowLanguageRequest,
  readLoginInput,
  readPingApi
} from './ui-request-parsing.js';

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
  'pp.token'
];

export interface DesktopApiRequest {
  path: string;
  method?: string;
  body?: unknown;
}

export interface DesktopApiResponse {
  status: number;
  body: unknown;
}

export interface DesktopApiContext {
  configOptions: ConfigStoreOptions;
  allowInteractiveAuth: boolean;
  appKind: 'pp-desktop' | 'pp-setup';
  jobs: UiJobStore;
  authSessions: AuthSessionStore;
  canvasSessions: CanvasSessionStore;
  fetchXmlCatalog: FetchXmlMetadataCatalog;
  flowLanguage: FlowLanguageService;
  quit?: () => void;
}

type DesktopRouteHandler = (url: URL, body: unknown, context: DesktopApiContext) => DesktopApiResponse | Promise<DesktopApiResponse>;

type DesktopRoute = {
  method: string;
  path: string | RegExp;
  handler: DesktopRouteHandler;
};

const DESKTOP_ROUTES: DesktopRoute[] = [
  { method: 'GET', path: '/api/app/status', handler: (_url, _body, context) => appStatus(context) },
  { method: 'GET', path: '/api/ui/status', handler: (_url, _body, context) => appStatus(context) },
  { method: 'GET', path: '/api/state', handler: async (_url, _body, context) => json(200, await loadDesktopState(context)) },
  { method: 'GET', path: '/api/accounts/token-status', handler: (url, _body, context) => accountTokenStatus(url, context) },
  { method: 'GET', path: /^\/api\/accounts\/[^/]+\/browser-profile$/, handler: (url, _body, context) => accountBrowserProfileGet(url, context) },
  { method: 'GET', path: /^\/api\/auth\/sessions\/[^/]+$/, handler: (url, _body, context) => authSessionGet(url, context) },
  { method: 'GET', path: '/api/ui/saved-requests', handler: (_url, _body, context) => savedRequestsList(context) },
  { method: 'GET', path: '/api/canvas/sessions', handler: (_url, _body, context) => json(200, ok(context.canvasSessions.listSessions())) },
  { method: 'GET', path: /^\/api\/canvas\/sessions\/[^/]+$/, handler: (url, _body, context) => canvasSessionGet(url, context) },
  { method: 'GET', path: '/api/dv/entities', handler: (url, _body, context) => entityList(url, context) },
  { method: 'GET', path: /^\/api\/dv\/entities\/[^/]+$/, handler: (url, _body, context) => entityDetail(url, context) },

  { method: 'POST', path: '/api/app/quit', handler: (_url, _body, context) => appQuit(context) },
  { method: 'POST', path: '/api/ui/shutdown', handler: (_url, _body, context) => appQuit(context) },
  { method: 'POST', path: '/api/accounts', handler: (_url, body, context) => accountCreate(body, context) },
  { method: 'POST', path: '/api/accounts/login', handler: (_url, body, context) => accountLogin(body, context) },
  { method: 'POST', path: /^\/api\/accounts\/[^/]+\/browser-profile\/open$/, handler: (url, body, context) => accountBrowserProfileOpen(url, body, context) },
  { method: 'POST', path: /^\/api\/accounts\/[^/]+\/browser-profile\/verify$/, handler: (url, body, context) => accountBrowserProfileVerify(url, body, context) },
  { method: 'POST', path: '/api/auth/sessions', handler: (_url, body, context) => authSessionCreate(body, context) },
  { method: 'POST', path: /^\/api\/auth\/sessions\/[^/]+\/cancel$/, handler: (url, _body, context) => authSessionCancel(url, context) },
  { method: 'POST', path: '/api/environments/discover', handler: (_url, body, context) => environmentDiscover(body, context) },
  { method: 'POST', path: '/api/environments', handler: (_url, body, context) => environmentCreate(body, context) },
  { method: 'POST', path: '/api/checks/whoami', handler: (_url, body, context) => whoAmICheck(body, context) },
  { method: 'POST', path: '/api/checks/ping', handler: (_url, body, context) => ping(body, context) },
  { method: 'POST', path: '/api/dv/query/preview', handler: (_url, body) => dataverseQueryPreview(body) },
  { method: 'POST', path: '/api/dv/query/execute', handler: (_url, body, context) => dataverseQueryExecute(body, context) },
  { method: 'POST', path: '/api/dv/records/create', handler: (_url, body, context) => dataverseRecordCreate(body, context) },
  { method: 'POST', path: '/api/dv/fetchxml/preview', handler: (_url, body) => fetchXmlPreview(body) },
  { method: 'POST', path: '/api/dv/fetchxml/execute', handler: (_url, body, context) => fetchXmlExecute(body, context) },
  { method: 'POST', path: '/api/dv/fetchxml/intellisense', handler: (_url, body, context) => fetchXmlIntellisense(body, context) },
  { method: 'POST', path: '/api/canvas/sessions', handler: (_url, body, context) => canvasSessionCreate(body, context) },
  { method: 'POST', path: /^\/api\/canvas\/sessions\/[^/]+\/probe$/, handler: (url, _body, context) => canvasSessionProbe(url, context) },
  { method: 'POST', path: '/api/canvas/request', handler: (_url, body, context) => canvasRequest(body, context) },
  { method: 'POST', path: '/api/canvas/yaml/fetch', handler: (_url, body, context) => canvasYamlFetch(body, context) },
  { method: 'POST', path: '/api/canvas/yaml/validate', handler: (_url, body, context) => canvasYamlValidate(body, context) },
  { method: 'POST', path: '/api/flow/language/analyze', handler: (_url, body, context) => flowLanguageAnalyze(body, context) },
  { method: 'POST', path: '/api/request/execute', handler: (_url, body, context) => requestExecute(body, context) },

  { method: 'PUT', path: /^\/api\/accounts\/[^/]+$/, handler: (url, body, context) => accountUpdate(url, body, context) },
  { method: 'PUT', path: /^\/api\/environments\/[^/]+$/, handler: (url, body, context) => environmentUpdate(url, body, context) },
  { method: 'PUT', path: '/api/ui/saved-requests', handler: (_url, body, context) => savedRequestsReplace(body, context) },

  { method: 'DELETE', path: /^\/api\/accounts\/[^/]+\/browser-profile$/, handler: (url, _body, context) => accountBrowserProfileReset(url, context) },
  { method: 'DELETE', path: /^\/api\/accounts\/[^/]+$/, handler: (url, _body, context) => accountDelete(url, context) },
  { method: 'DELETE', path: /^\/api\/environments\/.+$/, handler: (url, _body, context) => environmentDelete(url, context) },
  { method: 'DELETE', path: /^\/api\/canvas\/sessions\/.+$/, handler: (url, _body, context) => canvasSessionDelete(url, context) }
];

export function createDesktopApiContext(
  options: {
    configDir?: string;
    allowInteractiveAuth?: boolean;
    appKind?: DesktopApiContext['appKind'];
    quit?: () => void;
  } = {}
): DesktopApiContext {
  const configOptions = options.configDir ? { configDir: options.configDir } : {};
  const canvasSessions = new CanvasSessionStore();
  void canvasSessions.loadPersistedSessions(configOptions);
  return {
    configOptions,
    allowInteractiveAuth: options.allowInteractiveAuth ?? true,
    appKind: options.appKind ?? 'pp-desktop',
    jobs: new UiJobStore(),
    authSessions: new AuthSessionStore(),
    canvasSessions,
    fetchXmlCatalog: new FetchXmlMetadataCatalog(),
    flowLanguage: new FlowLanguageService(),
    quit: options.quit
  };
}

export async function handleDesktopApiRequest(context: DesktopApiContext, request: DesktopApiRequest): Promise<DesktopApiResponse> {
  const method = (request.method ?? 'GET').toUpperCase();
  const url = new URL(request.path, 'app://pp');
  const body = request.body;

  try {
    const route = findDesktopRoute(method, url.pathname);
    if (route) return route.handler(url, body, context);

    return json(404, fail(createDiagnostic('error', 'NOT_FOUND', `No desktop API route for ${method} ${url.pathname}.`, { source: 'pp/desktop' })));
  } catch (error) {
    return json(500, fail(createDiagnostic('error', 'DESKTOP_API_UNHANDLED', error instanceof Error ? error.message : String(error), { source: 'pp/desktop' })));
  }
}

function findDesktopRoute(method: string, pathname: string): DesktopRoute | undefined {
  return DESKTOP_ROUTES.find((route) => route.method === method && routeMatches(route.path, pathname));
}

function routeMatches(path: DesktopRoute['path'], pathname: string): boolean {
  return typeof path === 'string' ? path === pathname : path.test(pathname);
}

function appStatus(context: DesktopApiContext): DesktopApiResponse {
  return json(
    200,
    ok({
      kind: context.appKind,
      configDir: getConfigDir(context.configOptions),
      pid: process.pid
    })
  );
}

async function loadDesktopState(context: DesktopApiContext): Promise<OperationResult<Record<string, unknown>>> {
  const accounts = await listAccountSummaries(context.configOptions);
  if (!accounts.success) return fail(...accounts.diagnostics);
  const environments = await listConfiguredEnvironments(context.configOptions);
  if (!environments.success) return fail(...environments.diagnostics);
  return ok({
    configDir: getConfigDir(context.configOptions),
    configPath: getConfigPath(context.configOptions),
    msalCacheDir: getMsalCacheDir(context.configOptions),
    credentialStore: getCredentialStoreMode(context.configOptions),
    allowInteractiveAuth: context.allowInteractiveAuth,
    accounts: accounts.data ?? [],
    environments: environments.data ?? [],
    mcp: {
      transport: 'stdio',
      tools: MCP_TOOLS,
      launchCommand: buildMcpLaunchCommand(context),
      note: 'pp MCP uses stdio transport. Launch it from the consuming MCP client rather than from Desktop.'
    }
  });
}

function buildMcpLaunchCommand(context: DesktopApiContext): string {
  const parts = ['pp-mcp'];
  if (context.configOptions.configDir) parts.push('--config-dir', quoteShell(context.configOptions.configDir));
  if (context.allowInteractiveAuth) parts.push('--allow-interactive-auth');
  return parts.join(' ');
}

async function accountCreate(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const input = readLoginInput(body);
  if (!input.success || !input.data) return json(400, input);
  const account = readAccountUpdateInput(input.data.name, body);
  if (!account.success || !account.data) return json(400, account);
  const result = await saveAccount(account.data, context.configOptions);
  return json(result.success && result.data ? 201 : 400, result.success && result.data ? ok({ account: summarizeAccount(result.data) }, result.diagnostics) : result);
}

async function accountLogin(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const input = readLoginInput(body);
  if (!input.success || !input.data) return json(400, input);
  const data = asRecord(body);
  const result = await loginAccount(
    input.data,
    {
      preferredFlow: data?.preferredFlow === 'device-code' ? 'device-code' : 'interactive',
      forcePrompt: Boolean(data?.forcePrompt),
      allowInteractive: context.allowInteractiveAuth
    },
    context.configOptions
  );
  return json(result.success ? 200 : 400, result);
}

async function authSessionCreate(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const input = readLoginInput(body);
  if (!input.success || !input.data) return json(400, input);
  const data = asRecord(body) ?? {};
  const excludeApis = Array.isArray(data.excludeApis) ? data.excludeApis.filter((value: unknown): value is string => typeof value === 'string') : undefined;
  const session = await context.authSessions.createSession({
    account: input.data,
    preferredFlow: data.preferredFlow === 'device-code' ? 'device-code' : 'interactive',
    forcePrompt: Boolean(data.forcePrompt),
    environmentAlias: optionalString(data.environmentAlias),
    excludeApis,
    allowInteractiveAuth: context.allowInteractiveAuth,
    configOptions: context.configOptions
  });
  return json(202, ok(session));
}

function authSessionGet(url: URL, context: DesktopApiContext): DesktopApiResponse {
  const id = decodeURIComponent(url.pathname.slice('/api/auth/sessions/'.length));
  const session = context.authSessions.getSession(id);
  return session ? json(200, ok(session)) : json(404, fail(createDiagnostic('error', 'AUTH_SESSION_NOT_FOUND', `Auth session ${id} was not found.`, { source: 'pp/desktop' })));
}

function authSessionCancel(url: URL, context: DesktopApiContext): DesktopApiResponse {
  const id = decodeURIComponent(url.pathname.slice('/api/auth/sessions/'.length, -'/cancel'.length));
  const session = context.authSessions.cancelSession(id);
  return session ? json(200, ok(session)) : json(404, fail(createDiagnostic('error', 'AUTH_SESSION_NOT_FOUND', `Auth session ${id} was not found.`, { source: 'pp/desktop' })));
}

async function accountDelete(url: URL, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const name = decodeURIComponent(url.pathname.slice('/api/accounts/'.length));
  const result = await removeAccountByName(name, context.configOptions);
  return json(result.success ? 200 : 400, result);
}

async function accountUpdate(url: URL, body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const name = decodeURIComponent(url.pathname.slice('/api/accounts/'.length));
  const account = readAccountUpdateInput(name, body);
  if (!account.success || !account.data) return json(400, account);
  const result = await saveAccount(account.data, context.configOptions);
  return json(result.success ? 200 : 400, result);
}

async function accountTokenStatus(url: URL, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const name = optionalString(url.searchParams.get('account'));
  if (!name) return json(400, fail(createDiagnostic('error', 'ACCOUNT_REQUIRED', 'account query parameter is required.', { source: 'pp/desktop' })));
  const result = await checkAccountTokenStatus(name, context.configOptions);
  return json(result.success ? 200 : 400, result);
}

async function accountBrowserProfileGet(url: URL, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const name = accountNameFromBrowserProfilePath(url, '/browser-profile');
  if (!name) return json(400, fail(createDiagnostic('error', 'ACCOUNT_REQUIRED', 'account path segment is required.', { source: 'pp/desktop' })));
  const result = await getBrowserProfileStatus(name, context.configOptions);
  return json(result.success ? 200 : 400, result);
}

async function accountBrowserProfileOpen(url: URL, body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const name = accountNameFromBrowserProfilePath(url, '/browser-profile/open');
  if (!name) return json(400, fail(createDiagnostic('error', 'ACCOUNT_REQUIRED', 'account path segment is required.', { source: 'pp/desktop' })));
  const result = await openBrowserProfile(name, { url: optionalString(asRecord(body)?.url) }, context.configOptions);
  return json(result.success ? 200 : 400, result);
}

async function accountBrowserProfileVerify(url: URL, body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const name = accountNameFromBrowserProfilePath(url, '/browser-profile/verify');
  if (!name) return json(400, fail(createDiagnostic('error', 'ACCOUNT_REQUIRED', 'account path segment is required.', { source: 'pp/desktop' })));
  const data = asRecord(body) ?? {};
  const result = await verifyBrowserProfile(name, { url: optionalString(data.url), headless: data.headless === true }, context.configOptions);
  return json(result.success ? 200 : 400, result);
}

async function accountBrowserProfileReset(url: URL, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const name = accountNameFromBrowserProfilePath(url, '/browser-profile');
  if (!name) return json(400, fail(createDiagnostic('error', 'ACCOUNT_REQUIRED', 'account path segment is required.', { source: 'pp/desktop' })));
  const result = await resetBrowserProfile(name, context.configOptions);
  return json(result.success ? 200 : 400, result);
}

async function environmentDiscover(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const account = optionalString(asRecord(body)?.account);
  if (!account) return json(400, fail(createDiagnostic('error', 'ACCOUNT_REQUIRED', 'account is required.', { source: 'pp/desktop' })));
  const result = await discoverAccessibleEnvironments(account, context.configOptions, { allowInteractive: context.allowInteractiveAuth });
  return json(result.success ? 200 : 400, result);
}

async function environmentCreate(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const input = readEnvironmentInput(body);
  if (!input.success || !input.data) return json(400, input);
  const result = await addConfiguredEnvironment(input.data, context.configOptions, { allowInteractive: context.allowInteractiveAuth });
  return json(result.success ? 200 : 400, result);
}

async function environmentDelete(url: URL, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const alias = decodeURIComponent(url.pathname.slice('/api/environments/'.length));
  const result = await removeConfiguredEnvironment(alias, context.configOptions);
  return json(result.success ? 200 : 400, result);
}

async function environmentUpdate(url: URL, body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const alias = decodeURIComponent(url.pathname.slice('/api/environments/'.length));
  const data = asRecord(body);
  if (!data) return json(400, fail(createDiagnostic('error', 'INVALID_ENVIRONMENT_INPUT', 'Request body must be a JSON object.', { source: 'pp/desktop' })));
  const existing = await getEnvironment(alias, context.configOptions);
  if (!existing.success) return json(400, existing);
  if (!existing.data) {
    return json(404, fail(createDiagnostic('error', 'ENVIRONMENT_NOT_FOUND', `Environment ${alias} was not found.`, { source: 'pp/desktop' })));
  }
  const nextAccount = optionalString(data.account) ?? existing.data.account;
  const nextUrl = optionalString(data.url) ?? existing.data.url;
  const nextDisplayName = data.displayName === undefined ? existing.data.displayName : optionalString(data.displayName);
  const nextAccessRaw = optionalString(data.accessMode);
  let nextAccess: Environment['access'] | undefined;
  if (data.accessMode === undefined) {
    nextAccess = existing.data.access;
  } else if (nextAccessRaw === 'read-only' || nextAccessRaw === 'read-write') {
    nextAccess = { mode: nextAccessRaw };
  } else if (!nextAccessRaw) {
    nextAccess = undefined;
  } else {
    return json(400, fail(createDiagnostic('error', 'ENV_ACCESS_MODE_INVALID', 'accessMode must be read-only or read-write.', { source: 'pp/desktop' })));
  }
  const { access: _existingAccess, ...existingWithoutAccess } = existing.data;
  const environmentBase = nextAccess === undefined ? existingWithoutAccess : existing.data;
  const merged: Environment = {
    ...environmentBase,
    account: nextAccount,
    url: normalizeRequestOrigin(nextUrl),
    ...(nextDisplayName === undefined ? {} : { displayName: nextDisplayName }),
    ...(nextAccess === undefined ? {} : { access: nextAccess })
  };
  const saved = await saveEnvironment(merged, context.configOptions);
  return json(saved.success ? 200 : 400, saved.success ? ok(saved.data, saved.diagnostics) : saved);
}

async function whoAmICheck(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const data = asRecord(body);
  const environment = optionalString(data?.environment);
  if (!environment) return json(400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/desktop' })));
  const result = await runWhoAmICheck({ environmentAlias: environment, accountName: optionalString(data?.account), allowInteractive: false }, context.configOptions);
  return json(result.success ? 200 : 400, result);
}

async function ping(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const data = asRecord(body);
  const environment = optionalString(data?.environment);
  if (!environment) return json(400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/desktop' })));
  const result = await runConnectivityPing(
    {
      environmentAlias: environment,
      accountName: optionalString(data?.account),
      api: readPingApi(data?.api),
      allowInteractive: false
    },
    context.configOptions
  );
  return json(result.success || data?.softFail === true ? 200 : 400, result);
}

async function entityList(url: URL, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const environmentAlias = optionalString(url.searchParams.get('environment'));
  const allowInteractive = optionalBoolean(url.searchParams.get('allowInteractive')) ?? context.allowInteractiveAuth;
  const softFail = optionalBoolean(url.searchParams.get('softFail')) ?? false;
  if (!environmentAlias) return json(400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/desktop' })));
  const top = optionalInteger(url.searchParams.get('top'));
  const result = await listDataverseEntities(
    {
      environmentAlias,
      accountName: optionalString(url.searchParams.get('account')),
      search: optionalString(url.searchParams.get('search')),
      top: top ?? undefined
    },
    context.configOptions,
    { allowInteractive }
  );
  return json(result.success || softFail ? 200 : 400, result);
}

async function entityDetail(url: URL, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const environmentAlias = optionalString(url.searchParams.get('environment'));
  if (!environmentAlias) return json(400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/desktop' })));
  const logicalName = decodeURIComponent(url.pathname.slice('/api/dv/entities/'.length));
  const result = await getDataverseEntityDetail({ environmentAlias, logicalName, accountName: optionalString(url.searchParams.get('account')) }, context.configOptions);
  return json(result.success ? 200 : 400, result);
}

async function dataverseQueryPreview(body: unknown): Promise<DesktopApiResponse> {
  const spec = readDataverseQuerySpec(body);
  if (!spec.success || !spec.data) return json(400, spec);
  return json(200, ok({ path: buildDataverseODataPath(spec.data) }));
}

async function dataverseQueryExecute(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const spec = readDataverseQuerySpec(body);
  if (!spec.success || !spec.data) return json(400, spec);
  const result = await listDataverseRecords(spec.data, context.configOptions);
  return json(result.success ? 200 : 400, result);
}

async function dataverseRecordCreate(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const input = readDataverseCreateRecordInput(body);
  if (!input.success || !input.data) return json(400, input);
  const result = await createDataverseRecord(input.data, context.configOptions, { allowInteractive: context.allowInteractiveAuth });
  return json(result.success ? 200 : 400, result);
}

async function fetchXmlPreview(body: unknown): Promise<DesktopApiResponse> {
  const spec = readFetchXmlSpec(body);
  if (!spec.success || !spec.data) return json(400, spec);
  return json(200, ok({ fetchXml: buildFetchXml(spec.data) }));
}

async function fetchXmlExecute(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const spec = readFetchXmlSpec(body);
  if (!spec.success || !spec.data) return json(400, spec);
  const result = await executeFetchXml(spec.data, context.configOptions);
  return json(result.success ? 200 : 400, result);
}

async function fetchXmlIntellisense(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const languageRequest = readFetchXmlLanguageRequest(body);
  if (!languageRequest.success || !languageRequest.data) return json(400, languageRequest);
  return json(200, ok(await context.fetchXmlCatalog.analyze(languageRequest.data, context.configOptions, { allowInteractive: false })));
}

async function flowLanguageAnalyze(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const languageRequest = readFlowLanguageRequest(body);
  if (!languageRequest.success || !languageRequest.data) return json(400, languageRequest);
  return json(200, ok(context.flowLanguage.analyze(languageRequest.data)));
}

async function requestExecute(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const input = readApiRequestInput(body, context.allowInteractiveAuth);
  if (!input.success || !input.data) return json(400, input);
  const data = asRecord(body) ?? {};
  const result = await executeApiRequest(
    {
      environmentAlias: input.data.environment,
      accountName: input.data.account,
      api: input.data.api,
      method: input.data.method,
      path: input.data.path,
      query: input.data.query,
      headers: input.data.headers,
      body: input.data.body,
      rawBody: optionalString(data.rawBody),
      responseType: readResponseType(data.responseType),
      timeoutMs: readNumber(data.timeoutMs),
      jq: optionalString(data.jq),
      readIntent: data.readIntent === undefined ? input.data.readIntent : Boolean(data.readIntent)
    },
    context.configOptions,
    { allowInteractive: input.data.allowInteractive }
  );
  return json(result.success || data.softFail === true ? 200 : 400, applyResponsePreviewLimit(result, readNumber(data.maxResponseBytes)));
}

async function savedRequestsList(context: DesktopApiContext): Promise<DesktopApiResponse> {
  const result = await loadSavedRequests(context.configOptions);
  return json(result.success ? 200 : 400, result);
}

async function savedRequestsReplace(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const data = asRecord(body);
  if (!data) return json(400, fail(createDiagnostic('error', 'INVALID_SAVED_REQUESTS_INPUT', 'Request body must be a JSON object.', { source: 'pp/desktop' })));
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const result = await replaceSavedRequests(entries, context.configOptions);
  return json(result.success ? 200 : 400, result);
}

async function canvasSessionCreate(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const data = asRecord(body);
  const environmentAlias = optionalString(data?.environment ?? data?.environmentAlias);
  const appId = optionalString(data?.appId);
  if (!environmentAlias) return json(400, fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', 'environment is required.', { source: 'pp/desktop' })));
  if (!appId) return json(400, fail(createDiagnostic('error', 'APP_ID_REQUIRED', 'appId is required.', { source: 'pp/desktop' })));
  const session = await context.canvasSessions.createSession({
    environmentAlias,
    appId,
    accountName: optionalString(data?.account),
    cadence: optionalString(data?.cadence),
    clusterCategory: optionalString(data?.clusterCategory),
    allowInteractive: context.allowInteractiveAuth,
    configOptions: context.configOptions
  });
  return json(202, ok(session));
}

function canvasSessionGet(url: URL, context: DesktopApiContext): DesktopApiResponse {
  const id = decodeURIComponent(url.pathname.slice('/api/canvas/sessions/'.length));
  const session = context.canvasSessions.getSession(id);
  return session ? json(200, ok(session)) : json(404, fail(createDiagnostic('error', 'CANVAS_SESSION_NOT_FOUND', `Canvas session ${id} was not found.`, { source: 'pp/desktop' })));
}

async function canvasSessionDelete(url: URL, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const id = decodeURIComponent(url.pathname.slice('/api/canvas/sessions/'.length));
  const session = await context.canvasSessions.endSession(id, context.configOptions);
  return session ? json(200, ok(session)) : json(404, fail(createDiagnostic('error', 'CANVAS_SESSION_NOT_FOUND', `Canvas session ${id} was not found.`, { source: 'pp/desktop' })));
}

async function canvasSessionProbe(url: URL, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const id = decodeURIComponent(url.pathname.slice('/api/canvas/sessions/'.length).replace(/\/probe$/, ''));
  const session = await context.canvasSessions.probeSession(id, context.configOptions);
  return session ? json(200, ok(session)) : json(404, fail(createDiagnostic('error', 'CANVAS_SESSION_NOT_FOUND', `Canvas session ${id} was not found.`, { source: 'pp/desktop' })));
}

async function canvasRequest(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const data = asRecord(body);
  const sessionId = optionalString(data?.sessionId);
  if (!sessionId) return json(400, fail(createDiagnostic('error', 'SESSION_ID_REQUIRED', 'sessionId is required.', { source: 'pp/desktop' })));
  const session = context.canvasSessions.getSession(sessionId);
  if (!session) return json(404, fail(createDiagnostic('error', 'CANVAS_SESSION_NOT_FOUND', `Canvas session ${sessionId} was not found.`, { source: 'pp/desktop' })));
  if (session.status !== 'active' || !session.result) {
    return json(400, fail(createDiagnostic('error', 'CANVAS_SESSION_NOT_ACTIVE', `Canvas session ${sessionId} is not active.`, { source: 'pp/desktop' })));
  }

  const endpointPath = optionalString(data?.path);
  if (!endpointPath) return json(400, fail(createDiagnostic('error', 'PATH_REQUIRED', 'path is required.', { source: 'pp/desktop' })));
  const method = optionalString(data?.method) ?? 'GET';
  const sessionResult = session.result;
  const sessionState = extractSessionState(sessionResult.session);
  const fullUrl = `${sessionResult.authoringBaseUrl}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;
  const result = await executeApiRequest(
    {
      environmentAlias: session.environmentAlias,
      accountName: session.accountName,
      api: 'canvas-authoring',
      path: fullUrl,
      method: method.toUpperCase(),
      headers: {
        'x-ms-client-session-id': sessionResult.sessionId,
        'x-ms-client-request-id': randomUUID(),
        ...(sessionState ? { 'x-ms-session-state': sessionState } : {}),
        ...(isRecord(data?.headers) ? (data.headers as Record<string, string>) : {})
      },
      body: data?.body,
      responseType: 'json',
      readIntent: method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD'
    },
    context.configOptions,
    { allowInteractive: context.allowInteractiveAuth }
  );
  return json(result.success ? 200 : 400, result);
}

async function canvasYamlFetch(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const data = asRecord(body);
  const sessionId = optionalString(data?.sessionId);
  const outDir = optionalString(data?.outDir);
  if (!sessionId) return json(400, fail(createDiagnostic('error', 'SESSION_ID_REQUIRED', 'sessionId is required.', { source: 'pp/desktop' })));
  if (!outDir) return json(400, fail(createDiagnostic('error', 'OUT_DIR_REQUIRED', 'outDir is required.', { source: 'pp/desktop' })));
  const session = context.canvasSessions.getSession(sessionId);
  if (!session || session.status !== 'active' || !session.result) {
    return json(400, fail(createDiagnostic('error', 'CANVAS_SESSION_NOT_ACTIVE', 'Session is not active.', { source: 'pp/desktop' })));
  }

  const sessionResult = session.result;
  const sessionState = extractSessionState(sessionResult.session);
  const version = readCanvasAuthoringVersion(sessionResult.session);
  const pathPrefix = version ? `/${version}` : '';
  const fullUrl = `${sessionResult.authoringBaseUrl}${pathPrefix}/api/yaml/fetch`;
  const fetchResult = await executeApiRequest(
    {
      environmentAlias: session.environmentAlias,
      accountName: session.accountName,
      api: 'canvas-authoring',
      path: fullUrl,
      method: 'GET',
      headers: {
        'x-ms-client-session-id': sessionResult.sessionId,
        'x-ms-client-request-id': randomUUID(),
        ...(sessionState ? { 'x-ms-session-state': sessionState } : {})
      },
      responseType: 'json',
      readIntent: true
    },
    context.configOptions,
    { allowInteractive: context.allowInteractiveAuth }
  );

  if (!fetchResult.success) return json(400, fetchResult);
  const files = readCanvasYamlFetchFiles(fetchResult.data?.response);
  if (!files) return json(400, fail(createDiagnostic('error', 'CANVAS_YAML_FETCH_SHAPE', 'YAML fetch response did not contain a files array.', { source: 'pp/desktop' })));

  try {
    const written = await writeCanvasYamlFiles(outDir, files);
    return json(200, ok({ files: written, outDir }));
  } catch (error) {
    return json(500, fail(createDiagnostic('error', 'CANVAS_YAML_WRITE_FAILED', `Failed to write YAML files: ${error instanceof Error ? error.message : String(error)}`, { source: 'pp/desktop' })));
  }
}

async function canvasYamlValidate(body: unknown, context: DesktopApiContext): Promise<DesktopApiResponse> {
  const data = asRecord(body);
  const sessionId = optionalString(data?.sessionId);
  const dir = optionalString(data?.dir);
  if (!sessionId) return json(400, fail(createDiagnostic('error', 'SESSION_ID_REQUIRED', 'sessionId is required.', { source: 'pp/desktop' })));
  if (!dir) return json(400, fail(createDiagnostic('error', 'DIR_REQUIRED', 'dir is required.', { source: 'pp/desktop' })));
  const session = context.canvasSessions.getSession(sessionId);
  if (!session || session.status !== 'active' || !session.result) {
    return json(400, fail(createDiagnostic('error', 'CANVAS_SESSION_NOT_ACTIVE', 'Session is not active.', { source: 'pp/desktop' })));
  }
  let yamlFiles: Array<{ path: string; content: string }>;
  try {
    yamlFiles = await readCanvasYamlDirectory(dir);
  } catch (error) {
    return json(
      400,
      fail(createDiagnostic('error', 'CANVAS_YAML_DIR_READ_FAILED', `Failed to read YAML directory: ${error instanceof Error ? error.message : String(error)}`, { source: 'pp/desktop' }))
    );
  }
  if (yamlFiles.length === 0) {
    return json(400, fail(createDiagnostic('error', 'CANVAS_YAML_DIR_EMPTY', `No .pa.yaml files found in ${dir}.`, { source: 'pp/desktop' })));
  }
  const sessionResult = session.result;
  const sessionState = extractSessionState(sessionResult.session);
  const version = readCanvasAuthoringVersion(sessionResult.session);
  const pathPrefix = version ? `/${version}` : '';
  const fullUrl = `${sessionResult.authoringBaseUrl}${pathPrefix}/api/yaml/validate-directory`;
  const validateResult = await executeApiRequest(
    {
      environmentAlias: session.environmentAlias,
      accountName: session.accountName,
      api: 'canvas-authoring',
      path: fullUrl,
      method: 'POST',
      headers: {
        'x-ms-client-session-id': sessionResult.sessionId,
        'x-ms-client-request-id': randomUUID(),
        ...(sessionState ? { 'x-ms-session-state': sessionState } : {})
      },
      body: { files: yamlFiles },
      responseType: 'json',
      readIntent: false
    },
    context.configOptions,
    { allowInteractive: context.allowInteractiveAuth }
  );
  return json(validateResult.success ? 200 : 400, validateResult);
}

function appQuit(context: DesktopApiContext): DesktopApiResponse {
  setTimeout(() => context.quit?.(), 20);
  return json(200, ok({ message: 'Quitting.' }));
}

function applyResponsePreviewLimit<T extends { response?: unknown }>(
  result: OperationResult<T>,
  maxResponseBytes: number | undefined
): OperationResult<T | (Omit<T, 'response'> & { responsePreview: ResponsePreview })> {
  if (!result.success || !result.data || maxResponseBytes === undefined || maxResponseBytes <= 0) return result;
  const preview = createResponsePreview(result.data.response, maxResponseBytes);
  if (!preview.truncated) return result;
  const { response: _response, ...rest } = result.data;
  return {
    ...result,
    data: {
      ...rest,
      responsePreview: preview
    },
    diagnostics: [
      ...result.diagnostics,
      createDiagnostic('info', 'DESKTOP_RESPONSE_PREVIEW_TRUNCATED', `Response preview was truncated to ${preview.shownBytes} bytes.`, {
        source: 'pp/desktop',
        detail: `${preview.originalBytes} bytes returned; ${preview.omittedBytes} bytes omitted from the renderer payload.`
      })
    ]
  };
}

interface ResponsePreview {
  text: string;
  truncated: boolean;
  originalBytes: number;
  shownBytes: number;
  omittedBytes: number;
}

function createResponsePreview(value: unknown, maxBytes: number): ResponsePreview {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text) return { text: '', truncated: false, originalBytes: 0, shownBytes: 0, omittedBytes: 0 };
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return { text, truncated: false, originalBytes: buffer.byteLength, shownBytes: buffer.byteLength, omittedBytes: 0 };
  }
  const shown = buffer.subarray(0, maxBytes);
  return {
    text: shown.toString('utf8'),
    truncated: true,
    originalBytes: buffer.byteLength,
    shownBytes: shown.byteLength,
    omittedBytes: buffer.byteLength - shown.byteLength
  };
}

function accountNameFromBrowserProfilePath(url: URL, suffix: string): string {
  const prefix = '/api/accounts/';
  if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith(suffix)) return '';
  return decodeURIComponent(url.pathname.slice(prefix.length, -suffix.length));
}

function extractSessionState(session: unknown): string | undefined {
  if (!session || typeof session !== 'object') return undefined;
  const value = (session as Record<string, unknown>).sessionState;
  return typeof value === 'string' ? value : undefined;
}

function readCanvasAuthoringVersion(session: unknown): string | undefined {
  const clientConfig = asRecord(asRecord(session)?.clientConfig);
  return optionalString(clientConfig?.webAuthoringVersion);
}

function readResponseType(value: unknown): 'json' | 'text' | 'void' {
  return value === 'text' || value === 'void' ? value : 'json';
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function quoteShell(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function json(status: number, body: unknown): DesktopApiResponse {
  return { status, body };
}
