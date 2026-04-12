import { createTokenProvider, type PublicClientLoginOptions } from '../auth.js';
import { getAccount, getEnvironment, type ConfigStoreOptions } from '../config.js';
import { createDiagnostic, fail, ok, type OperationResult } from '../diagnostics.js';
import { accountForApi, executeRequest, resourceForApi, type ApiKind, type RequestInput } from '../request.js';

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

  const accountName = input.accountName ?? environment.data.account;
  const account = await getAccount(accountName, configOptions);
  if (!account.success || !account.data) {
    return account.success
      ? fail(createDiagnostic('error', 'ACCOUNT_NOT_FOUND', `Account ${accountName} was not found.`, { source: 'pp/services/api' }))
      : fail(...account.diagnostics);
  }

  const effectiveAccount = accountForApi(account.data, api);
  const tokenProvider = createTokenProvider(effectiveAccount, configOptions, {
    preferredFlow: input.preferredFlow ?? (effectiveAccount === account.data ? undefined : 'device-code'),
    allowInteractive: input.allowInteractive,
    persistAccount: effectiveAccount === account.data ? undefined : false,
  });
  if (!tokenProvider.success || !tokenProvider.data) return fail(...tokenProvider.diagnostics);
  try {
    return ok(await tokenProvider.data.getAccessToken(resourceForApi(environment.data, api)));
  } catch (error) {
    return fail(createDiagnostic('error', 'TOKEN_ACQUISITION_FAILED', `Failed to acquire a token for ${accountName}.`, {
      source: 'pp/services/api',
      detail: error instanceof Error ? error.message : String(error),
    }));
  }
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
            : api === 'canvas-authoring'
              ? await executeApiRequest({ ...common, path: '/gateway/cluster', method: 'GET' }, configOptions, { allowInteractive: input.allowInteractive })
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
