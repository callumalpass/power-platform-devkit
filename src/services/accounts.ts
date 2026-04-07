import { AuthService, summarizeAccount, type LoginAccountInput, type PublicClientLoginOptions } from '../auth.js';
import type { ConfigStoreOptions } from '../config.js';
import { fail, ok, type OperationResult } from '../diagnostics.js';

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

export async function checkAccountTokenStatus(name: string, configOptions: ConfigStoreOptions = {}): Promise<OperationResult<{ authenticated: boolean; expiresAt?: number }>> {
  const auth = new AuthService(configOptions);
  return auth.checkTokenStatus(name);
}

export async function removeAccountByName(name: string, configOptions: ConfigStoreOptions = {}): Promise<OperationResult<{ removed: boolean }>> {
  const auth = new AuthService(configOptions);
  const result = await auth.removeAccount(name);
  return result.success ? ok({ removed: Boolean(result.data) }, result.diagnostics) : fail(...result.diagnostics);
}
