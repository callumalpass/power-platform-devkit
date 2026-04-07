import { getEnvironment, listEnvironments, removeEnvironment, type ConfigStoreOptions, type EnvironmentAccessMode } from '../config.js';
import { addEnvironmentWithDiscovery, discoverEnvironments, type DiscoveredEnvironment } from '../request.js';
import { ok, fail, type OperationResult } from '../diagnostics.js';

export async function listConfiguredEnvironments(configOptions: ConfigStoreOptions = {}) {
  return listEnvironments(configOptions);
}

export async function inspectConfiguredEnvironment(alias: string, configOptions: ConfigStoreOptions = {}) {
  return getEnvironment(alias, configOptions);
}

export async function addConfiguredEnvironment(
  input: {
    alias: string;
    url: string;
    account: string;
    displayName?: string;
    accessMode?: EnvironmentAccessMode;
  },
  configOptions: ConfigStoreOptions = {},
  loginOptions: { allowInteractive?: boolean } = {},
) {
  return addEnvironmentWithDiscovery(input, configOptions, loginOptions);
}

export async function discoverAccessibleEnvironments(
  accountName: string,
  configOptions: ConfigStoreOptions = {},
  loginOptions: { allowInteractive?: boolean } = {},
): Promise<OperationResult<DiscoveredEnvironment[]>> {
  return discoverEnvironments({ accountName }, configOptions, loginOptions);
}

export async function removeConfiguredEnvironment(alias: string, configOptions: ConfigStoreOptions = {}): Promise<OperationResult<{ removed: boolean }>> {
  const result = await removeEnvironment(alias, configOptions);
  return result.success ? ok({ removed: Boolean(result.data) }, result.diagnostics) : fail(...result.diagnostics);
}
