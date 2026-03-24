import { createTokenProvider, decodeJwtClaims, type PublicClientLoginOptions, type TokenProvider } from './auth.js';
import { ensureEnvironmentAccess, getAuthProfile, getEnvironment, saveEnvironment, type ConfigStoreOptions, type Environment } from './config.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';
import { HttpClient, type HttpResponseType } from './http.js';

const POWER_PLATFORM_ENVIRONMENTS_API_VERSION = '2020-10-01';

export type ApiKind = 'dv' | 'flow' | 'graph' | 'custom';

export interface RequestInput {
  environmentAlias: string;
  path: string;
  method?: string;
  api?: ApiKind;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  responseType?: HttpResponseType;
  timeoutMs?: number;
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
}

export function resourceForApi(environment: Environment, api: Exclude<ApiKind, 'custom'>): string {
  switch (api) {
    case 'dv':
      return normalizeOrigin(environment.dataverseUrl);
    case 'flow':
      return 'https://service.flow.microsoft.com';
    case 'graph':
      return 'https://graph.microsoft.com';
  }
}

export async function executeRequest(input: RequestInput): Promise<OperationResult<{ request: PreparedRequest; response: unknown; status: number; headers: Record<string, string> }>> {
  const method = (input.method ?? 'GET').toUpperCase();
  const configOptions = input.configOptions ?? {};
  const access = await ensureEnvironmentAccess(input.environmentAlias, method, Boolean(input.readIntent), configOptions);
  if (!access.success) return fail(...access.diagnostics);

  const runtime = await resolveRuntime(input.environmentAlias, configOptions, input.loginOptions);
  if (!runtime.success || !runtime.data) return fail(...runtime.diagnostics);

  const request = buildRequest(runtime.data.environment, input.path, input.api);
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
    query: input.query,
    headers: input.headers,
    body: input.body,
    rawBody: input.rawBody,
    responseType: input.responseType ?? 'json',
    timeoutMs: input.timeoutMs,
  });
  if (!response.success || !response.data) {
    return fail(...response.diagnostics);
  }
  return ok({
    request: request.data,
    response: response.data.data,
    status: response.data.status,
    headers: response.data.headers,
  });
}

export async function addEnvironmentWithDiscovery(
  input: {
    alias: string;
    dataverseUrl: string;
    authProfile: string;
    displayName?: string;
    accessMode?: 'read-write' | 'read-only';
  },
  configOptions: ConfigStoreOptions = {},
  loginOptions: PublicClientLoginOptions = {},
): Promise<OperationResult<Environment>> {
  const profile = await getAuthProfile(input.authProfile, configOptions);
  if (!profile.success || !profile.data) {
    return profile.success
      ? fail(createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${input.authProfile} was not found.`, { source: 'pp/request' }))
      : fail(...profile.diagnostics);
  }
  const tokenProvider = createTokenProvider(profile.data, configOptions, loginOptions);
  if (!tokenProvider.success || !tokenProvider.data) return fail(...tokenProvider.diagnostics);

  const makerEnvironmentId = await discoverMakerEnvironmentId(input.dataverseUrl, tokenProvider.data);
  if (!makerEnvironmentId.success || !makerEnvironmentId.data) {
    return makerEnvironmentId.success
      ? fail(createDiagnostic('error', 'MAKER_ENVIRONMENT_ID_DISCOVERY_FAILED', `Could not discover maker environment id for ${input.dataverseUrl}.`, { source: 'pp/request' }))
      : fail(...makerEnvironmentId.diagnostics);
  }

  const dataverseTenant = await discoverTenantId(input.dataverseUrl, tokenProvider.data);
  if (!dataverseTenant.success || !dataverseTenant.data) {
    return dataverseTenant.success
      ? fail(createDiagnostic('error', 'TENANT_ID_DISCOVERY_FAILED', `Could not discover tenant id for ${input.dataverseUrl}.`, { source: 'pp/request' }))
      : fail(...dataverseTenant.diagnostics);
  }

  const environment: Environment = {
    alias: input.alias,
    authProfile: input.authProfile,
    dataverseUrl: normalizeOrigin(input.dataverseUrl),
    displayName: input.displayName,
    makerEnvironmentId: makerEnvironmentId.data,
    tenantId: dataverseTenant.data,
    ...(input.accessMode ? { access: { mode: input.accessMode } } : {}),
  };
  return saveEnvironment(environment, configOptions);
}

async function resolveRuntime(
  environmentAlias: string,
  configOptions: ConfigStoreOptions,
  loginOptions?: PublicClientLoginOptions,
): Promise<OperationResult<{ environment: Environment; tokenProvider: TokenProvider }>> {
  const environment = await getEnvironment(environmentAlias, configOptions);
  if (!environment.success || !environment.data) {
    return environment.success
      ? fail(createDiagnostic('error', 'ENVIRONMENT_NOT_FOUND', `Environment ${environmentAlias} was not found.`, { source: 'pp/request' }))
      : fail(...environment.diagnostics);
  }
  const profile = await getAuthProfile(environment.data.authProfile, configOptions);
  if (!profile.success || !profile.data) {
    return profile.success
      ? fail(createDiagnostic('error', 'AUTH_PROFILE_NOT_FOUND', `Auth profile ${environment.data.authProfile} was not found.`, { source: 'pp/request' }))
      : fail(...profile.diagnostics);
  }
  const tokenProvider = createTokenProvider(profile.data, configOptions, loginOptions);
  if (!tokenProvider.success || !tokenProvider.data) return fail(...tokenProvider.diagnostics);
  return ok({ environment: environment.data, tokenProvider: tokenProvider.data });
}

export function buildRequest(environment: Environment, originalPath: string, apiOverride?: ApiKind): OperationResult<PreparedRequest> {
  const api = detectApi(originalPath, apiOverride);
  const isUrl = isAbsoluteUrl(originalPath);
  if (api === 'custom') {
    if (!isUrl) {
      return fail(createDiagnostic('error', 'CUSTOM_REQUEST_URL_REQUIRED', 'Custom requests require an absolute URL.', { source: 'pp/request' }));
    }
    const url = new URL(originalPath);
    return ok({ api, baseUrl: url.origin, path: `${url.pathname}${url.search}`, authResource: url.origin, environment });
  }
  if (api === 'dv') {
    if (isUrl) {
      const url = new URL(originalPath);
      return ok({ api, baseUrl: url.origin, path: `${url.pathname}${url.search}`, authResource: url.origin, environment });
    }
    return ok({
      api,
      baseUrl: environment.dataverseUrl,
      path: normalizeDataversePath(originalPath),
      authResource: normalizeOrigin(environment.dataverseUrl),
      environment,
    });
  }
  if (api === 'flow') {
    if (isUrl) {
      const url = new URL(originalPath);
      return ok({ api, baseUrl: url.origin, path: `${url.pathname}${url.search}`, authResource: 'https://service.flow.microsoft.com', environment });
    }
    return ok({
      api,
      baseUrl: 'https://api.flow.microsoft.com',
      path: normalizeFlowPath(originalPath, environment.makerEnvironmentId),
      authResource: 'https://service.flow.microsoft.com',
      environment,
    });
  }
  if (isUrl) {
    const url = new URL(originalPath);
    return ok({ api, baseUrl: url.origin, path: `${url.pathname}${url.search}`, authResource: 'https://graph.microsoft.com', environment });
  }
  return ok({
    api,
    baseUrl: 'https://graph.microsoft.com',
    path: normalizeGraphPath(originalPath),
    authResource: 'https://graph.microsoft.com',
    environment,
  });
}

function detectApi(path: string, apiOverride?: ApiKind): ApiKind {
  if (apiOverride) return apiOverride;
  const value = isAbsoluteUrl(path) ? new URL(path).toString() : path;
  if (/graph\.microsoft\.com/i.test(value) || /^\/?(v1\.0|beta)\//i.test(value)) return 'graph';
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

async function discoverMakerEnvironmentId(dataverseUrl: string, tokenProvider: TokenProvider): Promise<OperationResult<string | undefined>> {
  const client = new HttpClient({
    baseUrl: 'https://api.bap.microsoft.com',
    tokenProvider,
  });
  const response = await client.request<{ value?: Array<{ name?: string; properties?: { linkedEnvironmentMetadata?: { instanceApiUrl?: string; instanceUrl?: string } } }> }>({
    path: '/providers/Microsoft.BusinessAppPlatform/environments',
    query: { 'api-version': POWER_PLATFORM_ENVIRONMENTS_API_VERSION },
  });
  if (!response.success || !response.data) return fail(...response.diagnostics);
  const origin = normalizeOrigin(dataverseUrl);
  const match = (response.data.data.value ?? []).find((candidate) => {
    const linked = candidate.properties?.linkedEnvironmentMetadata;
    return (
      (linked?.instanceApiUrl ? normalizeOrigin(linked.instanceApiUrl) : undefined) === origin ||
      (linked?.instanceUrl ? normalizeOrigin(linked.instanceUrl) : undefined) === origin
    );
  });
  return ok(match?.name);
}

async function discoverTenantId(dataverseUrl: string, tokenProvider: TokenProvider): Promise<OperationResult<string | undefined>> {
  try {
    const accessToken = await tokenProvider.getAccessToken(normalizeOrigin(dataverseUrl));
    const claims = decodeJwtClaims(accessToken);
    const tid = claims?.tid;
    return ok(typeof tid === 'string' ? tid : undefined);
  } catch (error) {
    return fail(createDiagnostic('error', 'TENANT_DISCOVERY_FAILED', 'Failed to acquire a token to determine tenant id.', {
      source: 'pp/request',
      detail: error instanceof Error ? error.message : String(error),
    }));
  }
}

export function normalizeOrigin(url: string): string {
  return new URL(url).origin;
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
