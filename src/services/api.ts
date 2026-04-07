import { AuthService, type PublicClientLoginOptions } from '../auth.js';
import { getEnvironment, type ConfigStoreOptions } from '../config.js';
import { createDiagnostic, fail, ok, type OperationResult } from '../diagnostics.js';
import { executeRequest, resourceForApi, type ApiKind, type RequestInput } from '../request.js';

export async function executeApiRequest(
  input: RequestInput,
  configOptions: ConfigStoreOptions = {},
  loginOptions: PublicClientLoginOptions = {},
) {
  return executeRequest({
    ...input,
    configOptions,
    loginOptions: { ...loginOptions, ...(input.loginOptions ?? {}) },
  });
}

export async function getEnvironmentToken(
  input: {
    environmentAlias: string;
    accountName?: string;
    api?: Exclude<ApiKind, 'custom'>;
    preferredFlow?: 'interactive' | 'device-code';
    allowInteractive?: boolean;
  },
  configOptions: ConfigStoreOptions = {},
): Promise<OperationResult<string>> {
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

export async function runWhoAmICheck(
  input: {
    environmentAlias: string;
    accountName?: string;
    allowInteractive?: boolean;
  },
  configOptions: ConfigStoreOptions = {},
) {
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

export async function runConnectivityPing(
  input: {
    environmentAlias: string;
    accountName?: string;
    api?: Exclude<ApiKind, 'custom'>;
    allowInteractive?: boolean;
  },
  configOptions: ConfigStoreOptions = {},
): Promise<OperationResult<{ ok: true; api: Exclude<ApiKind, 'custom'>; environment: string; account: string; status: number; request: unknown }>> {
  const api = input.api ?? 'dv';
  const common = {
    environmentAlias: input.environmentAlias,
    accountName: input.accountName,
    api,
    responseType: 'json' as const,
    readIntent: true,
  };
  const result =
    api === 'dv'
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
