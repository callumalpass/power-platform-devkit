import {
  CANVAS_AUTHORING_PUBLIC_CLIENT_ID,
  createTokenProvider,
  DEFAULT_PUBLIC_CLIENT_ID,
  type PublicClientLoginOptions,
  type TokenProvider,
} from './auth.js';
import { ensureEnvironmentAccess, getAccount, getEnvironment, type Account, type ConfigStoreOptions, type Environment } from './config.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';
import { HttpClient, type HttpResponseType } from './http.js';
import { applyJqTransform, type JqTransformInput } from './jq-transform.js';

export const API_KINDS = ['dv', 'flow', 'graph', 'bap', 'powerapps', 'powerautomate', 'canvas-authoring', 'sharepoint', 'custom'] as const;
export const REQUEST_ALIAS_API_KINDS = ['dv', 'flow', 'graph', 'bap', 'powerapps', 'canvas-authoring', 'sharepoint'] as const;
export const ENVIRONMENT_TOKEN_API_KINDS = ['dv', 'flow', 'graph', 'bap', 'powerapps', 'canvas-authoring'] as const;

export type ApiKind = typeof API_KINDS[number];
export type EnvironmentTokenApi = typeof ENVIRONMENT_TOKEN_API_KINDS[number];

export const FLOW_AUTH_RESOURCE = 'https://service.flow.microsoft.com';
export const CANVAS_AUTHORING_AUTH_RESOURCE = 'c6c4e5e1-0bc0-4d7d-b69b-954a907287e4/.default';

export interface RequestInput {
  environmentAlias?: string;
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
  tokenProviderOverride?: TokenProvider;
}

export interface PreparedRequest {
  api: ApiKind;
  baseUrl?: string;
  path: string;
  authResource: string;
  environment?: Environment;
  accountName: string;
}

type EnvironmentScopedApi = 'dv' | 'flow' | 'bap' | 'powerapps' | 'powerautomate' | 'canvas-authoring' | 'custom';
type AccountScopedApi = 'graph' | 'sharepoint';
type ApiScope = 'environment' | 'account';

interface ApiDescriptor {
  api: ApiKind;
  scope: ApiScope;
  detect?: (value: string) => boolean;
  environmentResource?: (environment: Environment) => string;
  build: (context: BuildContext) => OperationResult<PreparedRequest>;
  defaultHeaders?: Record<string, string>;
  defaultQuery?: Record<string, string>;
}

interface BuildContext {
  api: ApiKind;
  environment?: Environment;
  accountName: string;
  originalPath: string;
  isUrl: boolean;
  url?: URL;
}

const JSON_HEADERS = { accept: 'application/json' };
const DATAVERSE_HEADERS = {
  accept: 'application/json',
  'odata-version': '4.0',
  'odata-maxversion': '4.0',
};

const API_DESCRIPTORS: Record<ApiKind, ApiDescriptor> = {
  dv: {
    api: 'dv',
    scope: 'environment',
    detect: value => /\/api\/data\//i.test(value),
    environmentResource: environment => normalizeOrigin(environment.url),
    build: context => {
      const environment = requireEnvironment(context.environment, context.api);
      if (!environment.success || !environment.data) return fail(...environment.diagnostics);
      if (context.url) return ok(urlPreparedRequest(context, context.url.origin, environment.data));
      return ok({
        api: context.api,
        baseUrl: environment.data.url,
        path: normalizeDataversePath(context.originalPath),
        authResource: normalizeOrigin(environment.data.url),
        environment: environment.data,
        accountName: context.accountName,
      });
    },
    defaultHeaders: DATAVERSE_HEADERS,
  },
  flow: {
    api: 'flow',
    scope: 'environment',
    detect: value => /api\.flow\.microsoft\.com/i.test(value) || /Microsoft\.ProcessSimple/i.test(value),
    environmentResource: () => FLOW_AUTH_RESOURCE,
    build: context => {
      const environment = requireEnvironment(context.environment, context.api);
      if (!environment.success || !environment.data) return fail(...environment.diagnostics);
      if (context.url) return ok(urlPreparedRequest(context, FLOW_AUTH_RESOURCE, environment.data));
      return ok({
        api: context.api,
        baseUrl: 'https://api.flow.microsoft.com',
        path: normalizeFlowPath(context.originalPath, environment.data.makerEnvironmentId),
        authResource: FLOW_AUTH_RESOURCE,
        environment: environment.data,
        accountName: context.accountName,
      });
    },
    defaultHeaders: JSON_HEADERS,
    defaultQuery: { 'api-version': '2016-11-01' },
  },
  powerautomate: {
    api: 'powerautomate',
    scope: 'environment',
    detect: value => /environment\.api\.powerplatform\.com\/powerautomate/i.test(value) || /^\/?powerautomate(?:\/|$)/i.test(value),
    environmentResource: () => FLOW_AUTH_RESOURCE,
    build: context => {
      const environment = requireEnvironment(context.environment, context.api);
      if (!environment.success || !environment.data) return fail(...environment.diagnostics);
      if (context.url) return ok(urlPreparedRequest(context, FLOW_AUTH_RESOURCE, environment.data));
      return ok({
        api: context.api,
        baseUrl: canvasAuthoringDiscoveryBaseUrl(environment.data.makerEnvironmentId),
        path: normalizePowerAutomatePath(context.originalPath),
        authResource: FLOW_AUTH_RESOURCE,
        environment: environment.data,
        accountName: context.accountName,
      });
    },
    defaultHeaders: JSON_HEADERS,
    defaultQuery: { 'api-version': '1' },
  },
  graph: {
    api: 'graph',
    scope: 'account',
    detect: value => /graph\.microsoft\.com/i.test(value) || /^\/?(v1\.0|beta)\//i.test(value),
    environmentResource: () => 'https://graph.microsoft.com',
    build: context => {
      if (context.url) return ok(urlPreparedRequest(context, 'https://graph.microsoft.com', context.environment));
      return ok({
        api: context.api,
        baseUrl: 'https://graph.microsoft.com',
        path: normalizeGraphPath(context.originalPath),
        authResource: 'https://graph.microsoft.com',
        environment: context.environment,
        accountName: context.accountName,
      });
    },
    defaultHeaders: JSON_HEADERS,
  },
  bap: {
    api: 'bap',
    scope: 'environment',
    detect: value => /api\.bap\.microsoft\.com/i.test(value) || /Microsoft\.BusinessAppPlatform/i.test(value),
    environmentResource: () => 'https://service.powerapps.com',
    build: context => {
      const environment = requireEnvironment(context.environment, context.api);
      if (!environment.success || !environment.data) return fail(...environment.diagnostics);
      if (context.url) return ok(urlPreparedRequest(context, 'https://service.powerapps.com', environment.data));
      return ok({
        api: context.api,
        baseUrl: 'https://api.bap.microsoft.com',
        path: normalizeBapPath(context.originalPath),
        authResource: 'https://service.powerapps.com',
        environment: environment.data,
        accountName: context.accountName,
      });
    },
    defaultHeaders: JSON_HEADERS,
    defaultQuery: { 'api-version': '2020-10-01' },
  },
  powerapps: {
    api: 'powerapps',
    scope: 'environment',
    detect: value => /api\.powerapps\.com/i.test(value) || /Microsoft\.PowerApps/i.test(value),
    environmentResource: () => 'https://service.powerapps.com',
    build: context => {
      const environment = requireEnvironment(context.environment, context.api);
      if (!environment.success || !environment.data) return fail(...environment.diagnostics);
      if (context.url) return ok(urlPreparedRequest(context, 'https://service.powerapps.com', environment.data));
      return ok({
        api: context.api,
        baseUrl: 'https://api.powerapps.com',
        path: normalizePowerAppsPath(context.originalPath, environment.data.makerEnvironmentId),
        authResource: 'https://service.powerapps.com',
        environment: environment.data,
        accountName: context.accountName,
      });
    },
    defaultHeaders: JSON_HEADERS,
    defaultQuery: { 'api-version': '2016-11-01' },
  },
  'canvas-authoring': {
    api: 'canvas-authoring',
    scope: 'environment',
    detect: value => /environment\.api\.powerplatform\.com/i.test(value) || /authoring\..*\.powerapps\.com/i.test(value),
    environmentResource: () => CANVAS_AUTHORING_AUTH_RESOURCE,
    build: context => {
      const environment = requireEnvironment(context.environment, context.api);
      if (!environment.success || !environment.data) return fail(...environment.diagnostics);
      if (context.url) return ok(urlPreparedRequest(context, CANVAS_AUTHORING_AUTH_RESOURCE, environment.data));
      return ok({
        api: context.api,
        baseUrl: canvasAuthoringDiscoveryBaseUrl(environment.data.makerEnvironmentId),
        path: normalizeCanvasAuthoringPath(context.originalPath),
        authResource: CANVAS_AUTHORING_AUTH_RESOURCE,
        environment: environment.data,
        accountName: context.accountName,
      });
    },
    defaultHeaders: JSON_HEADERS,
  },
  sharepoint: {
    api: 'sharepoint',
    scope: 'account',
    detect: value => /https:\/\/[^/]+\.sharepoint\.com(?:\/|$)/i.test(value) || /https:\/\/[^/]+-my\.sharepoint\.com(?:\/|$)/i.test(value),
    build: context => {
      if (!context.url) {
        return fail(createDiagnostic('error', 'SHAREPOINT_REQUEST_URL_REQUIRED', 'SharePoint requests require an absolute SharePoint REST URL.', {
          source: 'pp/request',
          hint: 'Use a URL like https://contoso.sharepoint.com/sites/site/_api/web.',
        }));
      }
      return ok(urlPreparedRequest(context, context.url.origin, context.environment));
    },
    defaultHeaders: JSON_HEADERS,
  },
  custom: {
    api: 'custom',
    scope: 'environment',
    build: context => {
      const environment = requireEnvironment(context.environment, context.api);
      if (!environment.success || !environment.data) return fail(...environment.diagnostics);
      if (!context.url) {
        return fail(createDiagnostic('error', 'CUSTOM_REQUEST_URL_REQUIRED', 'Custom requests require an absolute URL.', { source: 'pp/request' }));
      }
      return ok(urlPreparedRequest(context, context.url.origin, environment.data));
    },
    defaultHeaders: JSON_HEADERS,
  },
};

const API_DETECTION_ORDER: ApiKind[] = ['graph', 'sharepoint', 'powerapps', 'powerautomate', 'canvas-authoring', 'bap', 'flow', 'dv'];

export function resourceForApi(environment: Environment, api: EnvironmentTokenApi): string {
  const resource = API_DESCRIPTORS[api].environmentResource;
  if (!resource) throw new Error(`API ${api} does not support environment token resources.`);
  return resource(environment);
}

export async function executeRequest(input: RequestInput): Promise<OperationResult<{ request: PreparedRequest; response: unknown; status: number; headers: Record<string, string> }>> {
  const method = (input.method ?? 'GET').toUpperCase();
  const configOptions = input.configOptions ?? {};
  const api = detectApi(input.path, input.api);
  if (isEnvironmentScopedApi(api) && input.environmentAlias) {
    const access = await ensureEnvironmentAccess(input.environmentAlias, method, Boolean(input.readIntent), configOptions);
    if (!access.success) return fail(...access.diagnostics);
  }
  const runtime = await resolveRuntime(input.environmentAlias, input.accountName, api, configOptions, input.loginOptions, input.tokenProviderOverride);
  if (!runtime.success || !runtime.data) return fail(...runtime.diagnostics);

  const request = buildRequest(runtime.data.environment, runtime.data.accountName, input.path, api);
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
  environmentAlias: string | undefined,
  accountName: string | undefined,
  api: ApiKind,
  configOptions: ConfigStoreOptions,
  loginOptions?: PublicClientLoginOptions,
  tokenProviderOverride?: TokenProvider,
): Promise<OperationResult<{ environment?: Environment; tokenProvider: TokenProvider; accountName: string }>> {
  const isAccountScoped = isAccountScopedApi(api);
  let environment: Environment | undefined;

  if (environmentAlias) {
    const environmentResult = await getEnvironment(environmentAlias, configOptions);
    if (!environmentResult.success || !environmentResult.data) {
      return environmentResult.success
        ? fail(createDiagnostic('error', 'ENVIRONMENT_NOT_FOUND', `Environment ${environmentAlias} was not found.`, { source: 'pp/request' }))
        : fail(...environmentResult.diagnostics);
    }
    environment = environmentResult.data;
  } else if (!isAccountScoped) {
    return fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', `API ${api} requires --env ALIAS.`, {
      source: 'pp/request',
      hint: 'Graph and SharePoint may use --account without --env; environment-scoped Power Platform APIs require --env.',
    }));
  }

  const resolvedAccountName = accountName ?? environment?.account;
  if (!resolvedAccountName) {
    return fail(createDiagnostic('error', 'ACCOUNT_REQUIRED', environmentAlias
      ? `Environment ${environmentAlias} does not define an account and none was provided.`
      : `API ${api} requires --account ACCOUNT when --env is not provided.`, {
      source: 'pp/request',
      hint: environmentAlias ? 'Pass --account ACCOUNT or update the environment to include an account.' : 'Pass --account ACCOUNT.',
    }));
  }

  const account = await getAccount(resolvedAccountName, configOptions);
  if (!account.success || !account.data) {
    return account.success
      ? fail(createDiagnostic('error', 'ACCOUNT_NOT_FOUND', `Account ${resolvedAccountName} was not found.`, { source: 'pp/request' }))
      : fail(...account.diagnostics);
  }
  if (tokenProviderOverride) {
    return ok({ environment, tokenProvider: tokenProviderOverride, accountName: resolvedAccountName });
  }
  const effectiveAccount = accountForApi(account.data, api);
  const effectiveLoginOptions = effectiveAccount === account.data
    ? loginOptions
    : { ...loginOptions, preferredFlow: loginOptions?.preferredFlow ?? 'device-code', persistAccount: false };
  const tokenProvider = createTokenProvider(effectiveAccount, configOptions, effectiveLoginOptions);
  if (!tokenProvider.success || !tokenProvider.data) return fail(...tokenProvider.diagnostics);
  return ok({ environment, tokenProvider: tokenProvider.data, accountName: resolvedAccountName });
}

export function accountForApi(account: Account, api: ApiKind): Account {
  if (api !== 'canvas-authoring') return account;
  if (account.kind !== 'user' && account.kind !== 'device-code') return account;
  if (account.clientId && account.clientId !== DEFAULT_PUBLIC_CLIENT_ID) return account;
  return {
    ...account,
    clientId: CANVAS_AUTHORING_PUBLIC_CLIENT_ID,
    tokenCacheKey: `${account.tokenCacheKey ?? account.name}-canvas-authoring`,
  };
}

export function buildRequest(environment: Environment | undefined, accountName: string, originalPath: string, apiOverride?: ApiKind): OperationResult<PreparedRequest> {
  const api = detectApi(originalPath, apiOverride);
  const isUrl = isAbsoluteUrl(originalPath);
  return API_DESCRIPTORS[api].build({
    api,
    environment,
    accountName,
    originalPath,
    isUrl,
    url: isUrl ? new URL(originalPath) : undefined,
  });
}

export function detectApi(path: string, apiOverride?: ApiKind): ApiKind {
  if (apiOverride) return apiOverride;
  const value = isAbsoluteUrl(path) ? new URL(path).toString() : path;
  for (const api of API_DETECTION_ORDER) {
    if (API_DESCRIPTORS[api].detect?.(value)) return api;
  }
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

function normalizePowerAutomatePath(path: string): string {
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  if (trimmed === '/powerautomate' || trimmed.startsWith('/powerautomate/')) return trimmed;
  return `/powerautomate${trimmed}`;
}

function canvasAuthoringDiscoveryBaseUrl(makerEnvironmentId: string): string {
  const isDefault = makerEnvironmentId.startsWith('Default-');
  const guidPart = isDefault ? makerEnvironmentId.slice('Default-'.length) : makerEnvironmentId;
  const hex = guidPart.replaceAll('-', '');
  const prefix = hex.slice(0, hex.length - 2);
  const suffix = hex.slice(hex.length - 2);
  const encoded = isDefault ? `default${prefix}.${suffix}` : `${prefix}.${suffix}`;
  return `https://${encoded}.environment.api.powerplatform.com`;
}

function normalizeCanvasAuthoringPath(path: string): string {
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  return trimmed === '/' ? '/gateway/cluster' : trimmed;
}

function defaultHeadersForApi(api: ApiKind): Record<string, string> {
  return { ...(API_DESCRIPTORS[api].defaultHeaders ?? JSON_HEADERS) };
}

function defaultQueryForApi(api: ApiKind): Record<string, string> | undefined {
  const query = API_DESCRIPTORS[api].defaultQuery;
  return query ? { ...query } : undefined;
}

export function normalizeOrigin(url: string): string {
  return new URL(url).origin;
}

export function isAccountScopedApi(api: ApiKind): api is AccountScopedApi {
  return API_DESCRIPTORS[api].scope === 'account';
}

export function isEnvironmentScopedApi(api: ApiKind): api is EnvironmentScopedApi {
  return API_DESCRIPTORS[api].scope === 'environment';
}

export function isApiKind(value: string): value is ApiKind {
  return Object.hasOwn(API_DESCRIPTORS, value);
}

export function isEnvironmentTokenApi(value: string): value is EnvironmentTokenApi {
  return (ENVIRONMENT_TOKEN_API_KINDS as readonly string[]).includes(value);
}

function requireEnvironment(environment: Environment | undefined, api: ApiKind): OperationResult<Environment> {
  return environment
    ? ok(environment)
    : fail(createDiagnostic('error', 'ENVIRONMENT_REQUIRED', `API ${api} requires --env ALIAS.`, { source: 'pp/request' }));
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function urlPreparedRequest(context: BuildContext, authResource: string, environment: Environment | undefined): PreparedRequest {
  const url = context.url ?? new URL(context.originalPath);
  return {
    api: context.api,
    baseUrl: url.origin,
    path: `${url.pathname}${url.search}`,
    authResource,
    environment,
    accountName: context.accountName,
  };
}
