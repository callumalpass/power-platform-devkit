import { createTokenProvider, decodeJwtClaims, type PublicClientLoginOptions, type TokenProvider } from './auth.js';
import { ensureEnvironmentAccess, getAccount, getEnvironment, saveEnvironment, type ConfigStoreOptions, type Environment } from './config.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';
import { HttpClient, type HttpResponseType } from './http.js';

const POWER_PLATFORM_ENVIRONMENTS_API_VERSION = '2020-10-01';

export type ApiKind = 'dv' | 'flow' | 'graph' | 'custom';

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

export interface DiscoveredEnvironment {
  accountName: string;
  makerEnvironmentId: string;
  displayName?: string;
  environmentUrl?: string;
  environmentApiUrl?: string;
  tenantId?: string;
}

export function resourceForApi(environment: Environment, api: Exclude<ApiKind, 'custom'>): string {
  switch (api) {
    case 'dv':
      return normalizeOrigin(environment.url);
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
    query: input.query,
    headers: input.headers,
    body: input.body,
    rawBody: input.rawBody,
    responseType: input.responseType ?? 'json',
    timeoutMs: input.timeoutMs,
  });
  if (!response.success || !response.data) return fail(...response.diagnostics);
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
    url: string;
    account: string;
    displayName?: string;
    accessMode?: 'read-write' | 'read-only';
  },
  configOptions: ConfigStoreOptions = {},
  loginOptions: PublicClientLoginOptions = {},
): Promise<OperationResult<Environment>> {
  const account = await getAccount(input.account, configOptions);
  if (!account.success || !account.data) {
    return account.success
      ? fail(createDiagnostic('error', 'ACCOUNT_NOT_FOUND', `Account ${input.account} was not found.`, { source: 'pp/request' }))
      : fail(...account.diagnostics);
  }
  const tokenProvider = createTokenProvider(account.data, configOptions, loginOptions);
  if (!tokenProvider.success || !tokenProvider.data) return fail(...tokenProvider.diagnostics);

  const makerEnvironmentId = await discoverMakerEnvironmentId(input.url, tokenProvider.data);
  if (!makerEnvironmentId.success || !makerEnvironmentId.data) {
    return makerEnvironmentId.success
      ? fail(createDiagnostic('error', 'MAKER_ENVIRONMENT_ID_DISCOVERY_FAILED', `Could not discover maker environment id for ${input.url}.`, { source: 'pp/request' }))
      : fail(...makerEnvironmentId.diagnostics);
  }

  const tenantId = await discoverTenantId(input.url, tokenProvider.data);
  if (!tenantId.success || !tenantId.data) {
    return tenantId.success
      ? fail(createDiagnostic('error', 'TENANT_ID_DISCOVERY_FAILED', `Could not discover tenant id for ${input.url}.`, { source: 'pp/request' }))
      : fail(...tenantId.diagnostics);
  }

  const environment: Environment = {
    alias: input.alias,
    account: input.account,
    url: normalizeOrigin(input.url),
    displayName: input.displayName,
    makerEnvironmentId: makerEnvironmentId.data,
    tenantId: tenantId.data,
    ...(input.accessMode ? { access: { mode: input.accessMode } } : {}),
  };
  return saveEnvironment(environment, configOptions);
}

export async function discoverEnvironments(
  input: {
    accountName: string;
  },
  configOptions: ConfigStoreOptions = {},
  loginOptions: PublicClientLoginOptions = {},
): Promise<OperationResult<DiscoveredEnvironment[]>> {
  const account = await getAccount(input.accountName, configOptions);
  if (!account.success || !account.data) {
    return account.success
      ? fail(createDiagnostic('error', 'ACCOUNT_NOT_FOUND', `Account ${input.accountName} was not found.`, { source: 'pp/request' }))
      : fail(...account.diagnostics);
  }
  const tokenProvider = createTokenProvider(account.data, configOptions, loginOptions);
  if (!tokenProvider.success || !tokenProvider.data) return fail(...tokenProvider.diagnostics);
  return listAccessibleEnvironments(tokenProvider.data, input.accountName);
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

async function discoverMakerEnvironmentId(url: string, tokenProvider: TokenProvider): Promise<OperationResult<string | undefined>> {
  const environments = await listAccessibleEnvironments(tokenProvider);
  if (!environments.success || !environments.data) return fail(...environments.diagnostics);
  const origin = normalizeOrigin(url);
  const match = environments.data.find((candidate) => candidate.environmentApiUrl === origin || candidate.environmentUrl === origin);
  return ok(match?.makerEnvironmentId);
}

async function listAccessibleEnvironments(tokenProvider: TokenProvider, accountName?: string): Promise<OperationResult<DiscoveredEnvironment[]>> {
  const client = new HttpClient({
    baseUrl: 'https://api.bap.microsoft.com',
    tokenProvider,
  });
  const response = await client.request<{
    value?: Array<{
      name?: string;
      properties?: {
        displayName?: string;
        azureTenantId?: string;
        linkedEnvironmentMetadata?: {
          instanceApiUrl?: string;
          instanceUrl?: string;
        };
      };
    }>;
  }>({
    path: '/providers/Microsoft.BusinessAppPlatform/environments',
    query: { 'api-version': POWER_PLATFORM_ENVIRONMENTS_API_VERSION },
  });
  if (!response.success || !response.data) return fail(...response.diagnostics);
  return ok(
    (response.data.data.value ?? [])
      .filter((candidate): candidate is NonNullable<typeof candidate> & { name: string } => typeof candidate?.name === 'string' && candidate.name.length > 0)
      .map((candidate) => ({
        accountName: accountName ?? '',
        makerEnvironmentId: candidate.name,
        displayName: candidate.properties?.displayName,
        environmentApiUrl: candidate.properties?.linkedEnvironmentMetadata?.instanceApiUrl
          ? normalizeOrigin(candidate.properties.linkedEnvironmentMetadata.instanceApiUrl)
          : undefined,
        environmentUrl: candidate.properties?.linkedEnvironmentMetadata?.instanceUrl
          ? normalizeOrigin(candidate.properties.linkedEnvironmentMetadata.instanceUrl)
          : undefined,
        tenantId: candidate.properties?.azureTenantId,
      })),
  );
}

async function discoverTenantId(url: string, tokenProvider: TokenProvider): Promise<OperationResult<string | undefined>> {
  try {
    const accessToken = await tokenProvider.getAccessToken(normalizeOrigin(url));
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
