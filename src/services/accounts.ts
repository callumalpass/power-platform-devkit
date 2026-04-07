import { AuthService, summarizeAccount, type LoginAccountInput, type PublicClientLoginOptions } from '../auth.js';
import { getEnvironment, type ConfigStoreOptions } from '../config.js';
import { createDiagnostic, fail, ok, type OperationResult } from '../diagnostics.js';
import { resourceForApi, type ApiKind } from '../request.js';

export async function listAccountSummaries(configOptions: ConfigStoreOptions = {}): Promise<OperationResult<Record<string, unknown>[]>> {
  const auth = new AuthService(configOptions);
  const result = await auth.listAccounts();
  return result.success ? ok((result.data ?? []).map(summarizeAccount), result.diagnostics) : fail(...result.diagnostics);
}

export async function inspectAccountSummary(name: string, configOptions: ConfigStoreOptions = {}): Promise<OperationResult<Record<string, unknown> | undefined>> {
  const auth = new AuthService(configOptions);
  const result = await auth.getAccount(name);
  return result.success ? ok(result.data ? summarizeAccount(result.data) : undefined, result.diagnostics) : fail(...result.diagnostics);
}

export async function loginAccount(
  input: LoginAccountInput,
  loginOptions: PublicClientLoginOptions = {},
  configOptions: ConfigStoreOptions = {},
): Promise<OperationResult<Record<string, unknown>>> {
  const auth = new AuthService(configOptions);
  return auth.login(input, loginOptions);
}

export async function removeAccountByName(name: string, configOptions: ConfigStoreOptions = {}): Promise<OperationResult<{ removed: boolean }>> {
  const auth = new AuthService(configOptions);
  const result = await auth.removeAccount(name);
  return result.success ? ok({ removed: Boolean(result.data) }, result.diagnostics) : fail(...result.diagnostics);
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
      ? fail(createDiagnostic('error', 'ENVIRONMENT_NOT_FOUND', `Environment ${input.environmentAlias} was not found.`, { source: 'pp/services/accounts' }))
      : fail(...environment.diagnostics);
  }

  const auth = new AuthService(configOptions);
  return auth.getToken(input.accountName ?? environment.data.account, resourceForApi(environment.data, api), {
    preferredFlow: input.preferredFlow,
    allowInteractive: input.allowInteractive,
  });
}
