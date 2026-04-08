import { getEnvironment, listEnvironments, removeEnvironment } from '../config.js';
import { addEnvironmentWithDiscovery, discoverEnvironments } from '../request.js';
import { ok, fail } from '../diagnostics.js';
export async function listConfiguredEnvironments(configOptions = {}) {
    return listEnvironments(configOptions);
}
export async function inspectConfiguredEnvironment(alias, configOptions = {}) {
    return getEnvironment(alias, configOptions);
}
export async function addConfiguredEnvironment(input, configOptions = {}, loginOptions = {}) {
    return addEnvironmentWithDiscovery(input, configOptions, loginOptions);
}
export async function discoverAccessibleEnvironments(accountName, configOptions = {}, loginOptions = {}) {
    return discoverEnvironments({ accountName }, configOptions, loginOptions);
}
export async function removeConfiguredEnvironment(alias, configOptions = {}) {
    const result = await removeEnvironment(alias, configOptions);
    return result.success ? ok({ removed: Boolean(result.data) }, result.diagnostics) : fail(...result.diagnostics);
}
