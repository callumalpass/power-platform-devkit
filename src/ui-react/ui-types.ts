import type { AccountKind, Environment } from '../config.js';
import type { CSSProperties } from 'react';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type JsonRecord = Record<string, JsonValue | unknown>;
export type UnknownRecord = Record<string, unknown>;
export type CssVariableStyle = CSSProperties & Record<`--${string}`, string | number | undefined>;

export type ApiEnvelope<T> = {
  data: T;
  diagnostics?: DiagnosticItem[];
  success?: boolean;
};

export type ApiExecuteResponse<T> = {
  response?: T;
  status?: number;
  headers?: Record<string, string>;
  request?: unknown;
};

export type ToastFn = (message: string, isError?: boolean) => void;

export type AccountSummary = {
  name: string;
  kind?: AccountKind;
  description?: string;
  tenantId?: string;
  clientId?: string;
  tokenCacheKey?: string;
  loginHint?: string;
  accountUsername?: string;
  homeAccountId?: string;
  localAccountId?: string;
  environmentVariable?: string;
  clientSecretEnv?: string;
  hasToken?: boolean;
  [key: string]: unknown;
};

export type EnvironmentSummary = Environment;

export type ShellState = {
  configDir: string;
  configPath: string;
  msalCacheDir: string;
  allowInteractiveAuth: boolean;
  accounts: AccountSummary[];
  environments: EnvironmentSummary[];
  mcp?: {
    transport?: string;
    tools?: string[];
    launchCommand?: string;
    note?: string;
  };
};

export type PowerPlatformInventoryItem = {
  name: string;
  displayName?: string;
  id?: string;
  type?: string;
  location?: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
};

export type DiagnosticItem = {
  level?: 'error' | 'warning' | 'info' | string;
  code?: string;
  message: string;
  detail?: string;
  from?: number;
  to?: number;
};

export type DataverseAttribute = {
  logicalName: string;
  attributeOf?: string;
  displayName?: string;
  description?: string;
  attributeType?: string;
  attributeTypeName?: string;
  requiredLevel?: string;
  maxLength?: number;
  maxValue?: number;
  minValue?: number;
  precision?: number;
  isPrimaryId?: boolean;
  isPrimaryName?: boolean;
  isValidForRead?: boolean;
  isValidForCreate?: boolean;
  isValidForUpdate?: boolean;
  targets?: string[];
  optionValues?: Array<{ value: number; label?: string }>;
};

export type DataverseEntitySummary = {
  logicalName: string;
  displayName?: string;
  entitySetName?: string;
  isActivity?: boolean;
  isCustomEntity?: boolean;
};

export type DataverseEntityDetail = DataverseEntitySummary & {
  description?: string;
  primaryIdAttribute?: string;
  primaryNameAttribute?: string;
  ownershipType?: string;
  changeTrackingEnabled?: boolean;
  attributes: DataverseAttribute[];
};

export type DataverseRecordPage = {
  entitySetName?: string;
  logicalName?: string;
  path?: string;
  records?: Array<Record<string, unknown>>;
  count?: number;
};

export type DataverseState = {
  entitiesEnvironment: string;
  entities: DataverseEntitySummary[];
  entitiesLoadError?: string;
  currentEntity: DataverseEntitySummary | null;
  currentEntityDetail: DataverseEntityDetail | null;
  currentEntityDiagnostics?: DiagnosticItem[];
  selectedColumns: string[];
  recordPreview: DataverseRecordPage | null;
  entityFilter: string;
  attrFilter: string;
  explorerSubTab: 'metadata' | 'records';
  dvSubTab: 'dv-explorer' | 'dv-query' | 'dv-fetchxml' | 'dv-relationships';
  queryPreview: string;
  queryResult: DataverseRecordPage | null;
};

export type FlowStatus = 'Succeeded' | 'Failed' | 'Running' | 'Skipped' | 'Started' | 'Stopped' | 'Unknown' | string;

export type FlowDefinitionSummary = {
  triggers?: Array<{ name?: string; type?: string }>;
  actions?: Array<{ name?: string; type?: string }>;
};

export type FlowApiOperation = {
  name: string;
  id?: string;
  summary?: string;
  description?: string;
  operationType?: string;
  apiId?: string;
  apiName?: string;
  apiDisplayName?: string;
  iconUri?: string;
  /**
   * True when the operation belongs to a first-party operationGroup (Control, DataOperation,
   * Variable, Http, Request, Schedule, Datetime, TextFunctions, NumberFunctions, etc.) — i.e. a
   * Workflow Definition Language primitive rather than a connector operation. Built-ins do not
   * have a discoverable schema at /apis/{group}; attempting to load one 404s.
   */
  isBuiltIn?: boolean;
  /**
   * True when loadFlowApiOperationSchema will produce a useful connector schema. Only true for
   * operationType === 'OpenApiConnection' | 'ApiConnection'.
   */
  hasConnectorSchema?: boolean;
  /**
   * True for connector-backed actions/triggers that need a flow connection reference, including
   * trigger catalog entries that use WDL Request but still belong to a connector operation group.
   */
  needsConnectionReference?: boolean;
  groupName?: string;
  raw?: unknown;
};

export type FlowApiOperationKind = 'action' | 'trigger';

export type FlowApiOperationSchemaField = {
  name: string;
  location?: string;
  path?: string[];
  required?: boolean;
  type?: string;
  title?: string;
  description?: string;
  enum?: string[];
  defaultValue?: unknown;
  schema?: unknown;
  dynamicValues?: unknown;
  dynamicSchema?: unknown;
  visibility?: string;
};

export type FlowDynamicValueOption = {
  value: string;
  title?: string;
  raw?: unknown;
};

export type FlowApiOperationResponseSchema = {
  statusCode: string;
  schema?: unknown;
  bodySchema?: unknown;
};

export type FlowApiOperationSchema = {
  apiId?: string;
  apiName?: string;
  apiDisplayName?: string;
  operationId: string;
  summary?: string;
  description?: string;
  fields: FlowApiOperationSchemaField[];
  responses?: FlowApiOperationResponseSchema[];
  raw?: unknown;
};

export type FlowItem = {
  id?: string;
  name?: string;
  workflowid?: string;
  type?: string;
  source: 'flow' | 'dv';
  definition?: unknown;
  properties?: {
    displayName?: string;
    description?: string;
    state?: FlowStatus;
    createdTime?: string;
    lastModifiedTime?: string;
    flowTriggerUri?: string;
    resourceId?: string;
    workflowEntityId?: string;
    workflowUniqueId?: string;
    installationStatus?: string;
    componentState?: string;
    creator?: { objectId?: string };
    definition?: unknown;
    connectionReferences?: unknown;
    installedConnectionReferences?: unknown;
    definitionSummary?: FlowDefinitionSummary;
  };
};

export type FlowRun = {
  name?: string;
  properties?: {
    actions?: Record<string, unknown>;
    status?: FlowStatus;
    code?: string;
    startTime?: string;
    endTime?: string;
    error?: unknown;
    correlation?: { clientTrackingId?: string };
    flow?: FlowItem;
    trigger?: {
      name?: string;
      status?: FlowStatus;
      code?: string;
      startTime?: string;
      endTime?: string;
      inputs?: unknown;
      outputs?: unknown;
      inputsLink?: { uri?: string };
      outputsLink?: { uri?: string };
    };
  };
};

export type FlowAction = {
  name?: string;
  properties?: {
    status?: FlowStatus;
    type?: string;
    code?: string;
    startTime?: string;
    endTime?: string;
    error?: unknown;
    inputs?: unknown;
    outputs?: unknown;
    inputsLink?: { uri?: string };
    outputsLink?: { uri?: string };
    trackedProperties?: unknown;
    retryHistory?: Array<{
      startTime?: string;
      endTime?: string;
      code?: string;
      error?: unknown;
    }>;
    repetitionCount?: number;
    canResubmit?: boolean;
    correlation?: { actionTrackingId?: string };
  };
};

export type FlowAnalysisOutlineItem = {
  name?: string;
  kind?: string;
  detail?: string;
  /** e.g. "OpenApiConnection", "ApiConnection", "Http" */
  type?: string;
  /** Connector or operation identifier, e.g. "shared_sharepointonline" */
  connector?: string;
  /** Inputs summary — key fields from the action's inputs config */
  inputs?: Record<string, unknown>;
  /** Expression text for conditions, filters, etc. */
  expression?: string;
  /** Variable name for Initialize/Set variable actions */
  variable?: string;
  /** Run-after configuration keys */
  runAfter?: string[];
  /** Human-readable control-flow/dependency hint, e.g. "after Compose" or "parallel" */
  dependency?: string;
  /** Stable reference to the run action represented by this outline node. */
  runActionRef?: string;
  from?: number;
  to?: number;
  children?: FlowAnalysisOutlineItem[];
};

export type FlowAnalysis = {
  summary?: {
    wrapperKind?: string;
    triggerCount?: number;
    actionCount?: number;
    variableCount?: number;
    parameterCount?: number;
  };
  references?: Array<{ resolved?: boolean }>;
  diagnostics?: DiagnosticItem[];
  outline?: FlowAnalysisOutlineItem[];
  completions?: Array<{ label: string; type?: string; detail?: string; info?: string; apply?: string; snippet?: boolean }>;
  context?: {
    kind?: 'expression' | 'property-key' | 'property-value' | 'value' | 'unknown' | string;
    text?: string;
    from?: number;
    to?: number;
    path?: string[];
    nearestAction?: string;
    propertyName?: string;
  };
};
