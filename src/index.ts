export {
  DEFAULT_LOGIN_RESOURCE,
  DEFAULT_PUBLIC_CLIENT_ID,
  CANVAS_AUTHORING_PUBLIC_CLIENT_ID,
  DEFAULT_USER_TENANT,
  AuthService,
  createTokenProvider,
  decodeJwtClaims,
  summarizeAccount,
  type LoginAccountInput,
  type LoginTarget,
  type PublicClientLoginOptions,
  type TokenProvider,
} from './auth.js';

export {
  PpClient,
  type PpClientOptions,
  type PpRequestInput,
} from './client.js';

export {
  getBrowserProfilesRoot,
  getCanvasSessionsPath,
  getConfigDir,
  getConfigPath,
  getDefaultConfigDir,
  getEnvironment,
  getAccount,
  getMsalCacheDir,
  getSavedRequestsPath,
  listAccounts,
  listEnvironments,
  loadConfig,
  removeAccount,
  removeEnvironment,
  saveAccount,
  saveEnvironment,
  writeConfig,
  type Account,
  type AccountKind,
  type BrowserProfile,
  type ConfigStoreOptions,
  type Environment,
  type EnvironmentAccessMode,
  type GlobalConfig,
} from './config.js';

export {
  createDiagnostic,
  fail,
  ok,
  type Diagnostic,
  type OperationResult,
} from './diagnostics.js';

export {
  API_KINDS,
  ENVIRONMENT_TOKEN_API_KINDS,
  REQUEST_ALIAS_API_KINDS,
  accountForApi,
  addEnvironmentWithDiscovery,
  buildRequest,
  detectApi,
  discoverEnvironments,
  executeRequest,
  isAccountScopedApi,
  isApiKind,
  isEnvironmentTokenApi,
  normalizeOrigin,
  resourceForApi,
  type ApiKind,
  type DiscoveredEnvironment,
  type EnvironmentTokenApi,
  type PreparedRequest,
  type RequestInput,
} from './request.js';

export {
  checkAccountTokenStatus,
  inspectAccountSummary,
  listAccountSummaries,
  loginAccount,
  removeAccountByName,
} from './services/accounts.js';

export {
  executeApiRequest,
  getEnvironmentToken,
  runConnectivityPing,
  runWhoAmICheck,
  type ApiRequestResult,
} from './services/api.js';

export {
  buildDataverseDerivedAttributeMetadataSpecs,
  buildDataverseGenericAttributeSelect,
  buildDataverseODataPath,
  buildFetchXml,
  createDataverseRecord,
  executeFetchXml,
  getDataverseEntityDetail,
  listDataverseEntities,
  listDataverseRecords,
  type DataverseAttributeMetadataRequestSpec,
  type DataverseAttributeSummary,
  type DataverseCreateRecordInput,
  type DataverseCreateRecordResult,
  type DataverseEntityDetail,
  type DataverseEntitySummary,
  type DataverseQuerySpec,
  type DataverseRecordPage,
  type FetchXmlConditionSpec,
  type FetchXmlLinkEntitySpec,
  type FetchXmlOrderSpec,
  type FetchXmlSpec,
} from './services/dataverse.js';

export {
  addConfiguredEnvironment,
  discoverAccessibleEnvironments,
  inspectConfiguredEnvironment,
  listConfiguredEnvironments,
  removeConfiguredEnvironment,
} from './services/environments.js';

export {
  applyJqTransform,
  type JqTransformInput,
  type JqTransformOptions,
} from './jq-transform.js';

export {
  analyzeFetchXml,
  type FetchXmlCompletionItem,
  type FetchXmlCursorContext,
  type FetchXmlLanguageAttribute,
  type FetchXmlLanguageEntity,
  type FetchXmlLanguageMetadata,
  type FetchXmlLanguageResult,
  type FetchXmlRangeDiagnostic,
} from './fetchxml-language.js';

export {
  analyzeFlow,
  completeFlowExpression,
  explainFlowSymbol,
  type FlowAnalysisResult,
  type FlowCompletionItem,
  type FlowCursorContext,
  type FlowExplainResult,
  type FlowKnowledgeSummary,
  type FlowOutlineItem,
  type FlowRangeDiagnostic,
  type FlowReferenceSummary,
  type FlowSymbolSummary,
} from './flow-language.js';

export {
  createPpMcpServer,
  startPpMcpServer,
  type PpMcpServerOptions,
} from './mcp.js';

export { VERSION } from './version.js';
