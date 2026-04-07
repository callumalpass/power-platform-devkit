import { executeRequest, type ApiKind } from '../request.js';
import type { ConfigStoreOptions } from '../config.js';
import { ok, fail, type OperationResult } from '../diagnostics.js';

export async function runWhoAmICheck(
  input: {
    environmentAlias: string;
    accountName?: string;
    allowInteractive?: boolean;
  },
  configOptions: ConfigStoreOptions = {},
): Promise<OperationResult<{ request: unknown; response: unknown; status: number; headers: Record<string, string> }>> {
  return executeRequest({
    environmentAlias: input.environmentAlias,
    accountName: input.accountName,
    api: 'dv',
    path: '/WhoAmI',
    method: 'GET',
    responseType: 'json',
    readIntent: true,
    configOptions,
    loginOptions: { allowInteractive: input.allowInteractive },
  });
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
    configOptions,
    loginOptions: { allowInteractive: input.allowInteractive },
  };
  const result =
    api === 'dv'
      ? await executeRequest({ ...common, path: '/WhoAmI', method: 'GET', readIntent: true })
      : api === 'flow'
        ? await executeRequest({ ...common, path: '/flows', method: 'GET', query: { 'api-version': '2016-11-01', '$top': '1' } })
        : api === 'bap'
          ? await executeRequest({ ...common, path: '/environments', method: 'GET', query: { '$top': '1', 'api-version': '2020-10-01' } })
          : api === 'powerapps'
            ? await executeRequest({ ...common, path: '/apps', method: 'GET', query: { '$top': '1', 'api-version': '2016-11-01' } })
        : await executeRequest({ ...common, path: '/organization', method: 'GET', query: { '$top': '1' } });

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
