import { AuthService, summarizeAccount } from '../auth.js';
import { fail, ok } from '../diagnostics.js';
export async function listAccountSummaries(configOptions = {}) {
    const auth = new AuthService(configOptions);
    const result = await auth.listAccounts();
    return result.success ? ok((result.data ?? []).map(summarizeAccount), result.diagnostics) : fail(...result.diagnostics);
}
export async function inspectAccountSummary(name, configOptions = {}) {
    const auth = new AuthService(configOptions);
    const result = await auth.getAccount(name);
    return result.success ? ok(result.data ? summarizeAccount(result.data) : undefined, result.diagnostics) : fail(...result.diagnostics);
}
export async function loginAccount(input, loginOptions = {}, configOptions = {}) {
    const auth = new AuthService(configOptions);
    return auth.login(input, loginOptions);
}
export async function checkAccountTokenStatus(name, configOptions = {}) {
    const auth = new AuthService(configOptions);
    return auth.checkTokenStatus(name);
}
export async function removeAccountByName(name, configOptions = {}) {
    const auth = new AuthService(configOptions);
    const result = await auth.removeAccount(name);
    return result.success ? ok({ removed: Boolean(result.data) }, result.diagnostics) : fail(...result.diagnostics);
}
