import { createTokenProvider, type PublicClientLoginOptions, type TokenProvider } from './auth.js';
import { ensureEnvironmentAccess, getAccount, getEnvironment, type ConfigStoreOptions, type Environment } from './config.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';
import { HttpClient, type HttpResponseType } from './http.js';
import { applyJqTransform, type JqTransformInput } from './jq-transform.js';

export type ApiKind = 'dv' | 'flow' | 'graph' | 'bap' | 'powerapps' | 'custom';

export interface RequestInput {
  environmentAlias: string;
  accountName?: string;
  path: string;
  method?: string;
  api?: ApiKind;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  responseType?: HttpResponseType;
  timeoutMs?: number;
  jq?: JqTransformInput;
  readIntent?: boolean;
  configOptions?: ConfigStoreOptions;
  loginOptions?: PublicClientLoginOptions;
}

export interface PreparedRequest {
  api: ApiKind;
  baseUrl?: string;
  path: string;
  authResource: string;
  environment: Environment;
  accountName: string;
}

export function resourceForApi(environment: Environment, api: Exclude<ApiKind, 'custom'>): string {
  switch (api) {
    case 'dv':
      return normalizeOrigin(environment.url);
    case 'flow':
      return 'https://service.flow.microsoft.com';
    case 'graph':
      return 'https://graph.microsoft.com';
    case 'bap':
    case 'powerapps':
      return 'https://service.powerapps.com';
  }
}

export async function executeRequest(input: RequestInput): Promise<OperationResult<{ request: PreparedRequest; response: unknown; status: number; headers: Record<string, string> }>> {
  const method = (input.method ?? 'GET').toUpperCase();
  const configOptions = input.configOptions ?? {};
  const access = await ensureEnvironmentAccess(input.environmentAlias, method, Boolean(input.readIntent), configOptions);
  if (!access.success) return fail(...access.diagnostics);

  const runtime = await resolveRuntime(input.environmentAlias, input.accountName, configOptions, input.loginOptions);
  if (!runtime.success || !runtime.data) return fail(...runtime.diagnostics);

  const request = buildRequest(runtime.data.environment, runtime.data.accountName, input.path, input.api);
  if (!request.success || !request.data) return fail(...request.diagnostics);

  const client = new HttpClient({
    baseUrl: request.data.baseUrl,
    authResource: request.data.authResource,
    tokenProvider: runtime.data.tokenProvider,
    defaultHeaders: defaultHeadersForApi(request.data.api),
  });
  const response = await client.request<unknown>({
    method,
    path: request.data.path,
    query: { ...defaultQueryForApi(request.data.api), ...(input.query ?? {}) },
    headers: input.headers,
    body: input.body,
    rawBody: input.rawBody,
    responseType: input.responseType ?? 'json',
    timeoutMs: input.timeoutMs,
  });
  if (!response.success || !response.data) return fail(...response.diagnostics);
  const responseData = input.jq !== undefined
    ? await applyJqTransform(response.data.data, input.jq)
    : ok(response.data.data);
  if (!responseData.success) return fail(...responseData.diagnostics);
  return ok({
    request: request.data,
    response: responseData.data,
    status: response.data.status,
    headers: response.data.headers,
  });
}

async function resolveRuntime(
  environmentAlias: string,
  accountName: string | undefined,
  configOptions: ConfigStoreOptions,
  loginOptions?: PublicClientLoginOptions,
): Promise<OperationResult<{ environment: Environment; tokenProvider: TokenProvider; accountName: string }>> {
  const environment = await getEnvironment(environmentAlias, configOptions);
  if (!environment.success || !environment.data) {
    return environment.success
      ? fail(createDiagnostic('error', 'ENVIRONMENT_NOT_FOUND', `Environment ${environmentAlias} was not found.`, { source: 'pp/request' }))
      : fail(...environment.diagnostics);
  }

  const resolvedAccountName = accountName ?? environment.data.account;
  if (!resolvedAccountName) {
    return fail(createDiagnostic('error', 'ENVIRONMENT_ACCOUNT_REQUIRED', `Environment ${environmentAlias} does not define an account and none was provided.`, {
      source: 'pp/request',
      hint: 'Pass --account ACCOUNT or update the environment to include an account.',
    }));
  }

  const account = await getAccount(resolvedAccountName, configOptions);
  if (!account.success || !account.data) {
    return account.success
      ? fail(createDiagnostic('error', 'ACCOUNT_NOT_FOUND', `Account ${resolvedAccountName} was not found.`, { source: 'pp/request' }))
      : fail(...account.diagnostics);
  }
  const tokenProvider = createTokenProvider(account.data, configOptions, loginOptions);
  if (!tokenProvider.success || !tokenProvider.data) return fail(...tokenProvider.diagnostics);
  return ok({ environment: environment.data, tokenProvider: tokenProvider.data, accountName: resolvedAccountName });
}

export function buildRequest(environment: Environment, accountName: string, originalPath: string, apiOverride?: ApiKind): OperationResult<PreparedRequest> {
  const api = detectApi(originalPath, apiOverride);
  const isUrl = isAbsoluteUrl(originalPath);
  if (api === 'custom') {
    if (!isUrl) {
      return fail(createDiagnostic('error', 'CUSTOM_REQUEST_URL_REQUIRED', 'Custom requests require an absolute URL.', { source: 'pp/request' }));
    }
    const url = new URL(originalPath);
    return ok({ api, baseUrl: url.origin, path: `${url.pathname}${url.search}`, authResource: url.origin, environment, accountName });
  }
  if (api === 'dv') {
    if (isUrl) {
      const url = new URL(originalPath);
      return ok({ api, baseUrl: url.origin, path: `${url.pathname}${url.search}`, authResource: url.origin, environment, accountName });
    }
    return ok({
      api,
      baseUrl: environment.url,
      path: normalizeDataversePath(originalPath),
      authResource: normalizeOrigin(environment.url),
      environment,
      accountName,
    });
  }
  if (api === 'flow') {
    if (isUrl) {
      const url = new URL(originalPath);
      return ok({ api, baseUrl: url.origin, path: `${url.pathname}${url.search}`, authResource: 'https://service.flow.microsoft.com', environment, accountName });
    }
    return ok({
      api,
      baseUrl: 'https://api.flow.microsoft.com',
      path: normalizeFlowPath(originalPath, environment.makerEnvironmentId),
      authResource: 'https://service.flow.microsoft.com',
      environment,
      accountName,
    });
  }
  if (api === 'bap') {
    if (isUrl) {
      const url = new URL(originalPath);
      return ok({ api, baseUrl: url.origin, path: `${url.pathname}${url.search}`, authResource: 'https://service.powerapps.com', environment, accountName });
    }
    return ok({
      api,
      baseUrl: 'https://api.bap.microsoft.com',
      path: normalizeBapPath(originalPath),
      authResource: 'https://service.powerapps.com',
      environment,
      accountName,
    });
  }
  if (api === 'powerapps') {
    if (isUrl) {
      const url = new URL(originalPath);
      return ok({ api, baseUrl: url.origin, path: `${url.pathname}${url.search}`, authResource: 'https://service.powerapps.com', environment, accountName });
    }
    return ok({
      api,
      baseUrl: 'https://api.powerapps.com',
      path: normalizePowerAppsPath(originalPath, environment.makerEnvironmentId),
      authResource: 'https://service.powerapps.com',
      environment,
      accountName,
    });
  }
  if (isUrl) {
    const url = new URL(originalPath);
    return ok({ api, baseUrl: url.origin, path: `${url.pathname}${url.search}`, authResource: 'https://graph.microsoft.com', environment, accountName });
  }
  return ok({
    api,
    baseUrl: 'https://graph.microsoft.com',
    path: normalizeGraphPath(originalPath),
    authResource: 'https://graph.microsoft.com',
    environment,
    accountName,
  });
}

function detectApi(path: string, apiOverride?: ApiKind): ApiKind {
  if (apiOverride) return apiOverride;
  const value = isAbsoluteUrl(path) ? new URL(path).toString() : path;
  if (/graph\.microsoft\.com/i.test(value) || /^\/?(v1\.0|beta)\//i.test(value)) return 'graph';
  if (/api\.powerapps\.com/i.test(value) || /Microsoft\.PowerApps/i.test(value)) return 'powerapps';
  if (/api\.bap\.microsoft\.com/i.test(value) || /Microsoft\.BusinessAppPlatform/i.test(value)) return 'bap';
  if (/api\.flow\.microsoft\.com/i.test(value) || /Microsoft\.ProcessSimple/i.test(value)) return 'flow';
  if (/\/api\/data\//i.test(value)) return 'dv';
  return isAbsoluteUrl(path) ? 'custom' : 'dv';
}

function normalizeDataversePath(path: string): string {
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  if (trimmed.startsWith('/api/data/')) return trimmed;
  return `/api/data/v9.2${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;
}

function normalizeFlowPath(path: string, makerEnvironmentId: string): string {
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  if (trimmed.startsWith('/providers/Microsoft.ProcessSimple/')) return trimmed;
  return `/providers/Microsoft.ProcessSimple/environments/${encodeURIComponent(makerEnvironmentId)}${trimmed}`;
}

function normalizeGraphPath(path: string): string {
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  if (/^\/(v1\.0|beta)\//i.test(trimmed)) return trimmed;
  return `/v1.0${trimmed}`;
}

function normalizeBapPath(path: string): string {
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  if (trimmed.startsWith('/providers/Microsoft.BusinessAppPlatform/')) return trimmed;
  return `/providers/Microsoft.BusinessAppPlatform${trimmed}`;
}

function normalizePowerAppsPath(path: string, makerEnvironmentId: string): string {
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  const withEnvironment = trimmed.replaceAll('{environment}', encodeURIComponent(makerEnvironmentId));
  if (withEnvironment.startsWith('/providers/Microsoft.PowerApps/')) return withEnvironment;
  return `/providers/Microsoft.PowerApps${withEnvironment}`;
}

function defaultHeadersForApi(api: ApiKind): Record<string, string> {
  if (api === 'dv') {
    return {
      accept: 'application/json',
      'odata-version': '4.0',
      'odata-maxversion': '4.0',
    };
  }
  return { accept: 'application/json' };
}

function defaultQueryForApi(api: ApiKind): Record<string, string> | undefined {
  if (api === 'flow') return { 'api-version': '2016-11-01' };
  if (api === 'bap') return { 'api-version': '2020-10-01' };
  if (api === 'powerapps') return { 'api-version': '2016-11-01' };
  return undefined;
}

export function normalizeOrigin(url: string): string {
  return new URL(url).origin;
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
