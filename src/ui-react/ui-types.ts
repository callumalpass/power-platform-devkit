export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonRecord = Record<string, JsonValue | unknown>;

export type ApiEnvelope<T> = {
  data: T;
  diagnostics?: Array<{ level?: string; code?: string; message?: string }>;
  success?: boolean;
};

export type ApiExecuteResponse<T> = {
  response?: T;
};

export type ToastFn = (message: string, isError?: boolean) => void;

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
  attributeType?: string;
  attributeTypeName?: string;
  isPrimaryId?: boolean;
  isPrimaryName?: boolean;
  isValidForRead?: boolean;
  isValidForCreate?: boolean;
  isValidForUpdate?: boolean;
  targets?: string[];
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
  currentEntity: DataverseEntitySummary | null;
  currentEntityDetail: DataverseEntityDetail | null;
  selectedColumns: string[];
  recordPreview: DataverseRecordPage | null;
  entityFilter: string;
  attrFilter: string;
  explorerSubTab: 'metadata' | 'records';
  dvSubTab: 'dv-explorer' | 'dv-query' | 'dv-fetchxml' | 'dv-relationships';
  queryPreview: string;
  queryResult: DataverseRecordPage | null;
  queryResultView: 'table' | 'json';
  recordPreviewView: 'table' | 'json';
};

export type FlowStatus = 'Succeeded' | 'Failed' | 'Running' | 'Skipped' | 'Started' | 'Stopped' | 'Unknown' | string;

export type FlowDefinitionSummary = {
  triggers?: Array<{ name?: string; type?: string }>;
  actions?: Array<{ name?: string; type?: string }>;
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
    creator?: { objectId?: string };
    definition?: unknown;
    connectionReferences?: unknown;
    definitionSummary?: FlowDefinitionSummary;
  };
};

export type FlowRun = {
  name?: string;
  properties?: {
    status?: FlowStatus;
    startTime?: string;
    endTime?: string;
    trigger?: { name?: string };
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
  };
};

export type FlowAnalysisOutlineItem = {
  name?: string;
  kind?: string;
  detail?: string;
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
  completions?: Array<{ label: string; type?: string; detail?: string; info?: string; apply?: string }>;
  context?: { from?: number; to?: number };
};
