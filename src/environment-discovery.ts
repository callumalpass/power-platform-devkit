import { createTokenProvider, decodeJwtClaims, type PublicClientLoginOptions, type TokenProvider } from './auth.js';
import { getAccount, saveEnvironment, type ConfigStoreOptions, type Environment } from './config.js';
import { createDiagnostic, fail, ok, type OperationResult } from './diagnostics.js';
import { HttpClient } from './http.js';
import { normalizeOrigin } from './request-executor.js';

const POWER_PLATFORM_ENVIRONMENTS_API_VERSION = '2020-10-01';

export interface DiscoveredEnvironment {
  accountName: string;
  makerEnvironmentId: string;
  displayName?: string;
  environmentUrl?: string;
  environmentApiUrl?: string;
  tenantId?: string;
}

export async function addEnvironmentWithDiscovery(
  input: {
    alias: string;
    url: string;
    account: string;
    displayName?: string;
    accessMode?: 'read-write' | 'read-only';
  },
  configOptions: ConfigStoreOptions = {},
  loginOptions: PublicClientLoginOptions = {},
): Promise<OperationResult<Environment>> {
  const account = await getAccount(input.account, configOptions);
  if (!account.success || !account.data) {
    return account.success
      ? fail(createDiagnostic('error', 'ACCOUNT_NOT_FOUND', `Account ${input.account} was not found.`, { source: 'pp/request' }))
      : fail(...account.diagnostics);
  }
  const tokenProvider = createTokenProvider(account.data, configOptions, loginOptions);
  if (!tokenProvider.success || !tokenProvider.data) return fail(...tokenProvider.diagnostics);

  const makerEnvironmentId = await discoverMakerEnvironmentId(input.url, tokenProvider.data);
  if (!makerEnvironmentId.success || !makerEnvironmentId.data) {
    return makerEnvironmentId.success
      ? fail(createDiagnostic('error', 'MAKER_ENVIRONMENT_ID_DISCOVERY_FAILED', `Could not discover maker environment id for ${input.url}.`, { source: 'pp/request' }))
      : fail(...makerEnvironmentId.diagnostics);
  }

  const tenantId = await discoverTenantId(input.url, tokenProvider.data);
  if (!tenantId.success || !tenantId.data) {
    return tenantId.success
      ? fail(createDiagnostic('error', 'TENANT_ID_DISCOVERY_FAILED', `Could not discover tenant id for ${input.url}.`, { source: 'pp/request' }))
      : fail(...tenantId.diagnostics);
  }

  const environment: Environment = {
    alias: input.alias,
    account: input.account,
    url: normalizeOrigin(input.url),
    displayName: input.displayName,
    makerEnvironmentId: makerEnvironmentId.data,
    tenantId: tenantId.data,
    ...(input.accessMode ? { access: { mode: input.accessMode } } : {}),
  };
  return saveEnvironment(environment, configOptions);
}

export async function discoverEnvironments(
  input: {
    accountName: string;
  },
  configOptions: ConfigStoreOptions = {},
  loginOptions: PublicClientLoginOptions = {},
): Promise<OperationResult<DiscoveredEnvironment[]>> {
  const account = await getAccount(input.accountName, configOptions);
  if (!account.success || !account.data) {
    return account.success
      ? fail(createDiagnostic('error', 'ACCOUNT_NOT_FOUND', `Account ${input.accountName} was not found.`, { source: 'pp/request' }))
      : fail(...account.diagnostics);
  }
  const tokenProvider = createTokenProvider(account.data, configOptions, loginOptions);
  if (!tokenProvider.success || !tokenProvider.data) return fail(...tokenProvider.diagnostics);
  return listAccessibleEnvironments(tokenProvider.data, input.accountName);
}

async function discoverMakerEnvironmentId(url: string, tokenProvider: TokenProvider): Promise<OperationResult<string | undefined>> {
  const environments = await listAccessibleEnvironments(tokenProvider);
  if (!environments.success || !environments.data) return fail(...environments.diagnostics);
  const origin = normalizeOrigin(url);
  const match = environments.data.find((candidate) => candidate.environmentApiUrl === origin || candidate.environmentUrl === origin);
  return ok(match?.makerEnvironmentId);
}

async function listAccessibleEnvironments(tokenProvider: TokenProvider, accountName?: string): Promise<OperationResult<DiscoveredEnvironment[]>> {
  const client = new HttpClient({
    baseUrl: 'https://api.bap.microsoft.com',
    tokenProvider,
  });
  const response = await client.request<{
    value?: Array<{
      name?: string;
      properties?: {
        displayName?: string;
        azureTenantId?: string;
        linkedEnvironmentMetadata?: {
          instanceApiUrl?: string;
          instanceUrl?: string;
        };
      };
    }>;
  }>({
    path: '/providers/Microsoft.BusinessAppPlatform/environments',
    query: { 'api-version': POWER_PLATFORM_ENVIRONMENTS_API_VERSION },
  });
  if (!response.success || !response.data) return fail(...response.diagnostics);
  return ok(
    (response.data.data.value ?? [])
      .filter((candidate): candidate is NonNullable<typeof candidate> & { name: string } => typeof candidate?.name === 'string' && candidate.name.length > 0)
      .map((candidate) => ({
        accountName: accountName ?? '',
        makerEnvironmentId: candidate.name,
        displayName: candidate.properties?.displayName,
        environmentApiUrl: candidate.properties?.linkedEnvironmentMetadata?.instanceApiUrl
          ? normalizeOrigin(candidate.properties.linkedEnvironmentMetadata.instanceApiUrl)
          : undefined,
        environmentUrl: candidate.properties?.linkedEnvironmentMetadata?.instanceUrl
          ? normalizeOrigin(candidate.properties.linkedEnvironmentMetadata.instanceUrl)
          : undefined,
        tenantId: candidate.properties?.azureTenantId,
      })),
  );
}

async function discoverTenantId(url: string, tokenProvider: TokenProvider): Promise<OperationResult<string | undefined>> {
  try {
    const accessToken = await tokenProvider.getAccessToken(normalizeOrigin(url));
    const claims = decodeJwtClaims(accessToken);
    const tid = claims?.tid;
    return ok(typeof tid === 'string' ? tid : undefined);
  } catch (error) {
    return fail(createDiagnostic('error', 'TENANT_DISCOVERY_FAILED', 'Failed to acquire a token to determine tenant id.', {
      source: 'pp/request',
      detail: error instanceof Error ? error.message : String(error),
    }));
  }
}
