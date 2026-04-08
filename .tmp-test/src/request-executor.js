import { createTokenProvider } from './auth.js';
import { ensureEnvironmentAccess, getAccount, getEnvironment } from './config.js';
import { createDiagnostic, fail, ok } from './diagnostics.js';
import { HttpClient } from './http.js';
export function resourceForApi(environment, api) {
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
export async function executeRequest(input) {
    const method = (input.method ?? 'GET').toUpperCase();
    const configOptions = input.configOptions ?? {};
    const access = await ensureEnvironmentAccess(input.environmentAlias, method, Boolean(input.readIntent), configOptions);
    if (!access.success)
        return fail(...access.diagnostics);
    const runtime = await resolveRuntime(input.environmentAlias, input.accountName, configOptions, input.loginOptions);
    if (!runtime.success || !runtime.data)
        return fail(...runtime.diagnostics);
    const request = buildRequest(runtime.data.environment, runtime.data.accountName, input.path, input.api);
    if (!request.success || !request.data)
        return fail(...request.diagnostics);
    const client = new HttpClient({
        baseUrl: request.data.baseUrl,
        authResource: request.data.authResource,
        tokenProvider: runtime.data.tokenProvider,
        defaultHeaders: defaultHeadersForApi(request.data.api),
    });
    const response = await client.request({
        method,
        path: request.data.path,
        query: { ...defaultQueryForApi(request.data.api), ...(input.query ?? {}) },
        headers: input.headers,
        body: input.body,
        rawBody: input.rawBody,
        responseType: input.responseType ?? 'json',
        timeoutMs: input.timeoutMs,
    });
    if (!response.success || !response.data)
        return fail(...response.diagnostics);
    return ok({
        request: request.data,
        response: response.data.data,
        status: response.data.status,
        headers: response.data.headers,
    });
}
async function resolveRuntime(environmentAlias, accountName, configOptions, loginOptions) {
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
    if (!tokenProvider.success || !tokenProvider.data)
        return fail(...tokenProvider.diagnostics);
    return ok({ environment: environment.data, tokenProvider: tokenProvider.data, accountName: resolvedAccountName });
}
export function buildRequest(environment, accountName, originalPath, apiOverride) {
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
function detectApi(path, apiOverride) {
    if (apiOverride)
        return apiOverride;
    const value = isAbsoluteUrl(path) ? new URL(path).toString() : path;
    if (/graph\.microsoft\.com/i.test(value) || /^\/?(v1\.0|beta)\//i.test(value))
        return 'graph';
    if (/api\.powerapps\.com/i.test(value) || /Microsoft\.PowerApps/i.test(value))
        return 'powerapps';
    if (/api\.bap\.microsoft\.com/i.test(value) || /Microsoft\.BusinessAppPlatform/i.test(value))
        return 'bap';
    if (/api\.flow\.microsoft\.com/i.test(value) || /Microsoft\.ProcessSimple/i.test(value))
        return 'flow';
    if (/\/api\/data\//i.test(value))
        return 'dv';
    return isAbsoluteUrl(path) ? 'custom' : 'dv';
}
function normalizeDataversePath(path) {
    const trimmed = path.startsWith('/') ? path : `/${path}`;
    if (trimmed.startsWith('/api/data/'))
        return trimmed;
    return `/api/data/v9.2${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;
}
function normalizeFlowPath(path, makerEnvironmentId) {
    const trimmed = path.startsWith('/') ? path : `/${path}`;
    if (trimmed.startsWith('/providers/Microsoft.ProcessSimple/'))
        return trimmed;
    return `/providers/Microsoft.ProcessSimple/environments/${encodeURIComponent(makerEnvironmentId)}${trimmed}`;
}
function normalizeGraphPath(path) {
    const trimmed = path.startsWith('/') ? path : `/${path}`;
    if (/^\/(v1\.0|beta)\//i.test(trimmed))
        return trimmed;
    return `/v1.0${trimmed}`;
}
function normalizeBapPath(path) {
    const trimmed = path.startsWith('/') ? path : `/${path}`;
    if (trimmed.startsWith('/providers/Microsoft.BusinessAppPlatform/'))
        return trimmed;
    return `/providers/Microsoft.BusinessAppPlatform${trimmed}`;
}
function normalizePowerAppsPath(path, makerEnvironmentId) {
    const trimmed = path.startsWith('/') ? path : `/${path}`;
    const withEnvironment = trimmed.replaceAll('{environment}', encodeURIComponent(makerEnvironmentId));
    if (withEnvironment.startsWith('/providers/Microsoft.PowerApps/'))
        return withEnvironment;
    return `/providers/Microsoft.PowerApps${withEnvironment}`;
}
function defaultHeadersForApi(api) {
    if (api === 'dv') {
        return {
            accept: 'application/json',
            'odata-version': '4.0',
            'odata-maxversion': '4.0',
        };
    }
    return { accept: 'application/json' };
}
function defaultQueryForApi(api) {
    if (api === 'flow')
        return { 'api-version': '2016-11-01' };
    if (api === 'bap')
        return { 'api-version': '2020-10-01' };
    if (api === 'powerapps')
        return { 'api-version': '2016-11-01' };
    return undefined;
}
export function normalizeOrigin(url) {
    return new URL(url).origin;
}
function isAbsoluteUrl(value) {
    return /^https?:\/\//i.test(value);
}
