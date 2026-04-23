import type { LoginAccountInput, PublicClientLoginOptions } from './auth.js';
import type { ConfigStoreOptions } from './config.js';
import type { EnvironmentTokenApi, RequestInput } from './request.js';
import {
  checkAccountTokenStatus,
  inspectAccountSummary,
  listAccountSummaries,
  loginAccount,
  removeAccountByName,
} from './services/accounts.js';
import {
  type ApiRequestResult,
  executeApiRequest,
  getEnvironmentToken,
  runConnectivityPing,
  runWhoAmICheck,
} from './services/api.js';
import {
  buildDataverseODataPath,
  buildFetchXml,
  createDataverseRecord,
  executeFetchXml,
  getDataverseEntityDetail,
  listDataverseEntities,
  listDataverseRecords,
  type DataverseCreateRecordInput,
  type DataverseQuerySpec,
  type FetchXmlSpec,
} from './services/dataverse.js';
import {
  addConfiguredEnvironment,
  discoverAccessibleEnvironments,
  inspectConfiguredEnvironment,
  listConfiguredEnvironments,
  removeConfiguredEnvironment,
} from './services/environments.js';
import type { OperationResult } from './diagnostics.js';

export interface PpClientOptions extends ConfigStoreOptions {
  loginOptions?: PublicClientLoginOptions;
}

export type PpRequestInput = RequestInput & {
  env?: string;
  account?: string;
};

export class PpClient {
  readonly accounts = {
    list: () => listAccountSummaries(this.configOptions),
    inspect: (name: string) => inspectAccountSummary(name, this.configOptions),
    login: (input: LoginAccountInput, loginOptions?: PublicClientLoginOptions) =>
      loginAccount(input, this.loginOptions(loginOptions), this.configOptions),
    tokenStatus: (name: string) => checkAccountTokenStatus(name, this.configOptions),
    remove: (name: string) => removeAccountByName(name, this.configOptions),
  };

  readonly environments = {
    list: () => listConfiguredEnvironments(this.configOptions),
    inspect: (alias: string) => inspectConfiguredEnvironment(alias, this.configOptions),
    add: (
      input: Parameters<typeof addConfiguredEnvironment>[0],
      loginOptions?: { allowInteractive?: boolean },
    ) => addConfiguredEnvironment(input, this.configOptions, loginOptions),
    discover: (accountName: string, loginOptions?: { allowInteractive?: boolean }) =>
      discoverAccessibleEnvironments(accountName, this.configOptions, loginOptions),
    remove: (alias: string) => removeConfiguredEnvironment(alias, this.configOptions),
  };

  readonly dataverse = {
    listEntities: (
      input: Parameters<typeof listDataverseEntities>[0],
      loginOptions?: PublicClientLoginOptions,
    ) => listDataverseEntities(input, this.configOptions, this.loginOptions(loginOptions)),
    getEntityDetail: (
      input: Parameters<typeof getDataverseEntityDetail>[0],
      loginOptions?: PublicClientLoginOptions,
    ) => getDataverseEntityDetail(input, this.configOptions, this.loginOptions(loginOptions)),
    listRecords: (input: DataverseQuerySpec, loginOptions?: PublicClientLoginOptions) =>
      listDataverseRecords(input, this.configOptions, this.loginOptions(loginOptions)),
    createRecord: (input: DataverseCreateRecordInput, loginOptions?: PublicClientLoginOptions) =>
      createDataverseRecord(input, this.configOptions, this.loginOptions(loginOptions)),
    executeFetchXml: (input: FetchXmlSpec, loginOptions?: PublicClientLoginOptions) =>
      executeFetchXml(input, this.configOptions, this.loginOptions(loginOptions)),
    buildODataPath: buildDataverseODataPath,
    buildFetchXml,
  };

  constructor(private readonly options: PpClientOptions = {}) {}

  request<T = unknown>(input: PpRequestInput, loginOptions?: PublicClientLoginOptions): Promise<OperationResult<ApiRequestResult<T>>> {
    return executeApiRequest<T>(normalizeRequestInput(input), this.configOptions, this.loginOptions(loginOptions));
  }

  whoami(input: { environmentAlias?: string; env?: string; accountName?: string; account?: string; allowInteractive?: boolean }) {
    return runWhoAmICheck({
      environmentAlias: requiredEnvironment(input.environmentAlias ?? input.env, 'whoami'),
      accountName: input.accountName ?? input.account,
      allowInteractive: input.allowInteractive,
    }, this.configOptions);
  }

  ping(input: { environmentAlias?: string; env?: string; accountName?: string; account?: string; api?: EnvironmentTokenApi; allowInteractive?: boolean }) {
    return runConnectivityPing({
      environmentAlias: requiredEnvironment(input.environmentAlias ?? input.env, 'ping'),
      accountName: input.accountName ?? input.account,
      api: input.api,
      allowInteractive: input.allowInteractive,
    }, this.configOptions);
  }

  token(input: { environmentAlias?: string; env?: string; accountName?: string; account?: string; api?: EnvironmentTokenApi; preferredFlow?: 'interactive' | 'device-code'; allowInteractive?: boolean }) {
    return getEnvironmentToken({
      environmentAlias: requiredEnvironment(input.environmentAlias ?? input.env, 'token'),
      accountName: input.accountName ?? input.account,
      api: input.api,
      preferredFlow: input.preferredFlow,
      allowInteractive: input.allowInteractive,
    }, this.configOptions);
  }

  private get configOptions(): ConfigStoreOptions {
    return this.options.configDir ? { configDir: this.options.configDir } : {};
  }

  private loginOptions(overrides?: PublicClientLoginOptions): PublicClientLoginOptions {
    return { ...(this.options.loginOptions ?? {}), ...(overrides ?? {}) };
  }
}

function normalizeRequestInput(input: PpRequestInput): RequestInput {
  const { env, account, ...rest } = input;
  return {
    ...rest,
    environmentAlias: rest.environmentAlias ?? env,
    accountName: rest.accountName ?? account,
  };
}

function requiredEnvironment(value: string | undefined, operation: string): string {
  if (!value) throw new Error(`PpClient.${operation} requires environmentAlias or env.`);
  return value;
}
