import { AuthService } from '../auth.js';
import { getEnvironment } from '../config.js';
import { createDiagnostic, fail, ok } from '../diagnostics.js';
import { executeRequest, resourceForApi } from '../request.js';
export async function executeApiRequest(input, configOptions = {}, loginOptions = {}) {
    return executeRequest({
        ...input,
        configOptions,
        loginOptions: { ...loginOptions, ...(input.loginOptions ?? {}) },
    });
}
export async function getEnvironmentToken(input, configOptions = {}) {
    const api = input.api ?? 'dv';
    const environment = await getEnvironment(input.environmentAlias, configOptions);
    if (!environment.success || !environment.data) {
        return environment.success
            ? fail(createDiagnostic('error', 'ENVIRONMENT_NOT_FOUND', `Environment ${input.environmentAlias} was not found.`, { source: 'pp/services/api' }))
            : fail(...environment.diagnostics);
    }
    const auth = new AuthService(configOptions);
    return auth.getToken(input.accountName ?? environment.data.account, resourceForApi(environment.data, api), {
        preferredFlow: input.preferredFlow,
        allowInteractive: input.allowInteractive,
    });
}
export async function runWhoAmICheck(input, configOptions = {}) {
    return executeApiRequest({
        environmentAlias: input.environmentAlias,
        accountName: input.accountName,
        api: 'dv',
        path: '/WhoAmI',
        method: 'GET',
        responseType: 'json',
        readIntent: true,
    }, configOptions, { allowInteractive: input.allowInteractive });
}
export async function runConnectivityPing(input, configOptions = {}) {
    const api = input.api ?? 'dv';
    const common = {
        environmentAlias: input.environmentAlias,
        accountName: input.accountName,
        api,
        responseType: 'json',
        readIntent: true,
    };
    const result = api === 'dv'
        ? await executeApiRequest({ ...common, path: '/WhoAmI', method: 'GET' }, configOptions, { allowInteractive: input.allowInteractive })
        : api === 'flow'
            ? await executeApiRequest({ ...common, path: '/flows', method: 'GET', query: { 'api-version': '2016-11-01', '$top': '1' } }, configOptions, { allowInteractive: input.allowInteractive })
            : api === 'bap'
                ? await executeApiRequest({ ...common, path: '/environments', method: 'GET', query: { '$top': '1', 'api-version': '2020-10-01' } }, configOptions, { allowInteractive: input.allowInteractive })
                : api === 'powerapps'
                    ? await executeApiRequest({ ...common, path: '/apps', method: 'GET', query: { '$top': '1', 'api-version': '2016-11-01' } }, configOptions, { allowInteractive: input.allowInteractive })
                    : await executeApiRequest({ ...common, path: '/organization', method: 'GET', query: { '$top': '1' } }, configOptions, { allowInteractive: input.allowInteractive });
    return result.success && result.data
        ? ok({
            ok: true,
            api,
            environment: input.environmentAlias,
            account: result.data.request.accountName,
            status: result.data.status,
            request: result.data.request,
        }, result.diagnostics)
        : fail(...result.diagnostics);
}
